use super::tunnel_http::{self, Prepared};
use super::tunnel_stall::{Evidence, Load, StallDetector, StallPolicy, Step};
use crate::remote_runner::send_gate::SendGate;
use serde_json::Value;
use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::Duration;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;

const CLOSED: &str = "Runner connection changed during request.";
pub(super) const TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lifecycle {
    Open,
    Closed,
    Stalled,
}

impl Lifecycle {
    fn ended(self) -> Result<(), String> {
        match self {
            Self::Open => Ok(()),
            Self::Closed => Err(CLOSED.into()),
            Self::Stalled => Err(tunnel_http::CONNECTION_FAILED.into()),
        }
    }
}

fn end(lifecycle: &watch::Sender<Lifecycle>, outcome: Lifecycle) {
    lifecycle.send_if_modified(|current| {
        if *current != Lifecycle::Open {
            return false;
        }
        *current = outcome;
        true
    });
}

fn unanswered(result: &Result<Value, String>) -> bool {
    result
        .as_ref()
        .is_err_and(|error| error == TIMED_OUT || error == tunnel_http::CONNECTION_FAILED)
}

fn load(waiting: bool, held: Option<Instant>, suspended: Option<Instant>) -> Load {
    match (waiting, held, suspended) {
        (_, Some(until), _) => Load::Held(until),
        (false, None, _) => Load::Idle,
        (true, None, Some(until)) => Load::Suspended(until),
        (true, None, None) => Load::Waiting,
    }
}

fn abandon(probe: &mut Option<JoinHandle<()>>) {
    if let Some(task) = probe.take() {
        task.abort();
    }
}

async fn settled(probe: &mut Option<JoinHandle<()>>) {
    if let Some(task) = probe.as_mut() {
        let _ = task.await;
    }
    *probe = None;
}

struct Job {
    request: Prepared,
    expected: Option<String>,
    limit: usize,
    deadline: Instant,
    gate: Option<Arc<SendGate>>,
    reply: oneshot::Sender<Result<Value, String>>,
}

/// An outgoing queue belongs to one exact tunnel. Dispatch never waits for an
/// earlier response, so a long read cannot block a user action or another server.
/// Request counts are deliberately unrestricted; each payload and lifetime is bounded.
pub(super) struct Dispatch {
    sender: Mutex<Option<mpsc::UnboundedSender<Job>>>,
    lifecycle: Arc<watch::Sender<Lifecycle>>,
    evidence: Arc<Evidence>,
}

#[derive(Clone)]
pub(super) struct Authority {
    lifecycle: watch::Receiver<Lifecycle>,
    evidence: Arc<Evidence>,
}

impl Authority {
    pub(super) fn ended(&self) -> Result<(), String> {
        self.lifecycle.borrow().ended()
    }

    pub(super) async fn revoked(&mut self) -> String {
        let _ = self.lifecycle.changed().await;
        self.ended().err().unwrap_or_else(|| CLOSED.into())
    }

    pub(super) fn evidence(&self) -> Arc<Evidence> {
        Arc::clone(&self.evidence)
    }
}

impl Dispatch {
    pub(super) fn new(client: reqwest::Client, token: String, policy: StallPolicy) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Job>();
        let (lifecycle, mut cancellation) = watch::channel(Lifecycle::Open);
        let lifecycle = Arc::new(lifecycle);
        let evidence = Arc::new(Evidence::new(policy));
        let verdict = Arc::clone(&lifecycle);
        let observed = Arc::clone(&evidence);
        tauri::async_runtime::spawn(async move {
            let mut active = tokio::task::JoinSet::new();
            let mut probe: Option<JoinHandle<()>> = None;
            let mut detector = StallDetector::new(policy);
            loop {
                let now = Instant::now();
                let load = load(
                    !active.is_empty(),
                    observed.held(now),
                    observed.suspended(now),
                );
                let probing = probe.as_ref().is_some_and(|task| !task.is_finished());
                detector.suspect(observed.suspected());
                let wake = match detector.step(now, load, observed.inbound(), probing) {
                    Step::Rest(wake) => {
                        abandon(&mut probe);
                        wake
                    }
                    Step::Wake(at) => Some(at),
                    Step::Probe(at) if probing => Some(at),
                    Step::Probe(at) => {
                        let client = client.clone();
                        let observed = Arc::clone(&observed);
                        abandon(&mut probe);
                        probe = Some(tokio::spawn(async move {
                            tunnel_http::answered(&client, policy.probe).await;
                            observed.record_inbound();
                        }));
                        Some(at)
                    }
                    Step::Stalled => {
                        end(&verdict, Lifecycle::Stalled);
                        break;
                    }
                };
                let waking = wake.map(tokio::time::Instant::from_std);
                let probed = probe.is_some();
                tokio::select! {
                    biased;
                    _ = cancellation.changed() => break,
                    _ = observed.revised() => {},
                    Some(_) = active.join_next(), if !active.is_empty() => {},
                    _ = settled(&mut probe), if probed => {},
                    job = receiver.recv() => {
                        let Some(job) = job else { break };
                        let client = client.clone();
                        let token = token.clone();
                        let mut canceled = cancellation.clone();
                        let observed = Arc::clone(&observed);
                        active.spawn(async move {
                            if job.reply.is_closed() { return; }
                            if Instant::now() >= job.deadline {
                                let _ = job.reply.send(Err(TIMED_OUT.into()));
                                return;
                            }
                            let started = Instant::now();
                            let _upload = observed.upload(job.request.body_bytes(), started);
                            let authority = canceled.clone();
                            let result = tokio::select! {
                                biased;
                                _ = canceled.changed() => canceled.borrow().ended().and(Err(CLOSED.into())),
                                result = tokio::time::timeout_at(
                                tokio::time::Instant::from_std(job.deadline),
                                tunnel_http::request_with_authority(&client, &token, job.expected.as_deref(), (job.request, job.limit), || {
                                    authority.borrow().ended()?;
                                    if Instant::now() >= job.deadline { return Err(TIMED_OUT.into()); }
                                    Ok(())
                                }, || observed.record_inbound(), || match job.gate.as_ref() {
                                    Some(gate) if !gate.claim() => Err(TIMED_OUT.into()),
                                    _ => Ok(()),
                                }),
                            ) => {
                                let result = result.unwrap_or_else(|_| Err(TIMED_OUT.into()));
                                if unanswered(&result) { observed.suspect(started, Instant::now()); }
                                result
                            },
                            };
                            let _ = job.reply.send(result);
                        });
                    }
                    _ = tokio::time::sleep_until(waking.unwrap_or_else(tokio::time::Instant::now)), if waking.is_some() => {},
                }
            }
            // Dropping the receiver settles all queued callers. Dropping JoinSet
            // aborts every in-flight HTTP future without replaying any mutation.
            drop(receiver);
            active.abort_all();
            if let Some(task) = probe.take() {
                task.abort();
                let _ = task.await;
            }
            while active.join_next().await.is_some() {}
        });
        Self {
            sender: Mutex::new(Some(sender)),
            lifecycle,
            evidence,
        }
    }

    pub(super) fn authority(&self) -> Authority {
        Authority {
            lifecycle: self.lifecycle.subscribe(),
            evidence: Arc::clone(&self.evidence),
        }
    }

    #[cfg(test)]
    pub(super) fn request(
        &self,
        request: Prepared,
        expected: Option<String>,
        limit: usize,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.request_until(request, expected, limit, Instant::now() + timeout, None)
    }

    pub(super) fn request_until(
        &self,
        request: Prepared,
        expected: Option<String>,
        limit: usize,
        deadline: Instant,
        gate: Option<Arc<SendGate>>,
    ) -> Result<Value, String> {
        let (reply, response) = oneshot::channel();
        let queued = self
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|sender| {
                sender
                    .send(Job {
                        request,
                        expected,
                        limit,
                        deadline,
                        gate,
                        reply,
                    })
                    .is_ok()
            });
        if !queued {
            return Err(self.ended());
        }
        tauri::async_runtime::block_on(async {
            tokio::time::timeout_at(tokio::time::Instant::from_std(deadline), response)
                .await
                .map_err(|_| TIMED_OUT)?
                .map_err(|_| self.ended())?
        })
    }

    #[cfg(test)]
    pub(super) fn retained_tasks(&self) -> usize {
        Arc::strong_count(&self.evidence) - 1
    }

    pub(super) fn is_stalled(&self) -> bool {
        *self.lifecycle.borrow() == Lifecycle::Stalled
    }

    fn ended(&self) -> String {
        match self.lifecycle.borrow().ended() {
            Ok(()) => CLOSED.into(),
            Err(error) => error,
        }
    }

    pub(super) fn close(&self) {
        self.sender.lock().unwrap_or_else(|e| e.into_inner()).take();
        end(&self.lifecycle, Lifecycle::Closed);
    }
}

impl Drop for Dispatch {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn expired_queued_mutation_is_not_sent() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let path = std::env::temp_dir().join(format!("cv-expired-{}.sock", std::process::id()));
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        listener.set_nonblocking(true).unwrap();
        let client = reqwest::Client::builder()
            .unix_socket(path.clone())
            .no_proxy()
            .build()
            .unwrap();
        let dispatch = Dispatch::new(client, "test-only".into(), StallPolicy::DEFAULT);
        let (reply, response) = oneshot::channel();
        dispatch
            .sender
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .send(Job {
                request: tunnel_http::prepare("POST", "/v1/tasks", None, vec![]).unwrap(),
                expected: None,
                limit: 4096,
                deadline: Instant::now() - Duration::from_secs(1),
                gate: None,
                reply,
            })
            .unwrap_or_else(|_| panic!("fixture queue unexpectedly closed"));
        let result = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), response)
                .await
                .unwrap()
                .unwrap()
        });
        assert_eq!(result.unwrap_err(), TIMED_OUT);
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
        dispatch.close();
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn the_first_ending_of_a_tunnel_is_final() {
        let (closed, _) = watch::channel(Lifecycle::Open);
        end(&closed, Lifecycle::Closed);
        end(&closed, Lifecycle::Stalled);
        assert_eq!(closed.borrow().ended().unwrap_err(), CLOSED);
        let (stalled, _) = watch::channel(Lifecycle::Open);
        assert!(stalled.borrow().ended().is_ok());
        end(&stalled, Lifecycle::Stalled);
        end(&stalled, Lifecycle::Closed);
        assert_eq!(
            stalled.borrow().ended().unwrap_err(),
            tunnel_http::CONNECTION_FAILED
        );
    }

    #[test]
    fn callers_caught_by_an_ended_queue_learn_how_the_tunnel_ended() {
        for (outcome, expected) in [
            (Lifecycle::Stalled, tunnel_http::CONNECTION_FAILED),
            (Lifecycle::Closed, CLOSED),
        ] {
            let (sender, receiver) = mpsc::unbounded_channel::<Job>();
            let (lifecycle, _) = watch::channel(Lifecycle::Open);
            let dispatch = Arc::new(Dispatch {
                sender: Mutex::new(Some(sender)),
                lifecycle: Arc::new(lifecycle),
                evidence: Arc::new(Evidence::new(StallPolicy::DEFAULT)),
            });
            let caller = Arc::clone(&dispatch);
            let queued = std::thread::spawn(move || {
                let request = tunnel_http::prepare("POST", "/v1/tasks", None, vec![]).unwrap();
                caller.request(request, None, 4096, Duration::from_secs(30))
            });
            let started = Instant::now();
            while receiver.is_empty() {
                assert!(started.elapsed() < Duration::from_secs(5));
                std::thread::sleep(Duration::from_millis(1));
            }
            end(&dispatch.lifecycle, outcome);
            drop(receiver);
            assert_eq!(queued.join().unwrap().unwrap_err(), expected);
            let request = tunnel_http::prepare("POST", "/v1/tasks", None, vec![]).unwrap();
            assert!(dispatch.sender.lock().unwrap().is_some());
            assert_eq!(
                dispatch
                    .request(request, None, 4096, Duration::from_secs(30))
                    .unwrap_err(),
                expected
            );
            assert!(started.elapsed() < Duration::from_secs(5));
        }
    }

    #[test]
    fn dropping_the_dispatch_aborts_a_running_probe_and_its_pending_request() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let path = std::env::temp_dir().join(format!("cv-dropped-{}.sock", std::process::id()));
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        let client = reqwest::Client::builder()
            .unix_socket(path.clone())
            .no_proxy()
            .build()
            .unwrap();
        let policy = StallPolicy {
            quiet: Duration::from_millis(30),
            probe: Duration::from_secs(20),
            ..StallPolicy::DEFAULT
        };
        let dispatch = Dispatch::new(client, "test-only".into(), policy);
        let evidence = Arc::clone(&dispatch.evidence);
        let (reply, response) = oneshot::channel();
        dispatch
            .sender
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .send(Job {
                request: tunnel_http::prepare("GET", "/v1/tasks", None, vec![]).unwrap(),
                expected: None,
                limit: 4096,
                deadline: Instant::now() + Duration::from_secs(30),
                gate: None,
                reply,
            })
            .unwrap_or_else(|_| panic!("fixture queue unexpectedly closed"));
        let mut held: Vec<_> = (0..2).map(|_| listener.accept().unwrap().0).collect();
        let started = Instant::now();
        drop(dispatch);
        let settled = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(5), response).await
        });
        assert!(!matches!(settled, Ok(Ok(Ok(_))) | Err(_)));
        while Arc::strong_count(&evidence) > 1 {
            assert!(started.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(held
            .iter_mut()
            .all(super::super::dispatch_tests::reaches_end_of_stream));
        assert!(started.elapsed() < policy.probe / 2);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_dispatch_deadline_is_an_mcp_server_status_time_out_and_a_closed_tunnel_is_not() {
        use crate::agent_mcp_servers_domain::{
            AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR, AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
        };
        use crate::remote_runner::mcp_servers::contract_error;
        assert_eq!(contract_error(TIMED_OUT), AGENT_MCP_SERVERS_TIMED_OUT_ERROR);
        assert_eq!(
            contract_error(CLOSED),
            AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR
        );
    }
}
