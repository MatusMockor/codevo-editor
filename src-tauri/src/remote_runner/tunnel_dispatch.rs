use super::tunnel_http::{self, Prepared};
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, watch};

const CLOSED: &str = "Runner connection changed during request.";
const TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";

struct Job {
    request: Prepared,
    expected: Option<String>,
    limit: usize,
    deadline: Instant,
    reply: oneshot::Sender<Result<Value, String>>,
}

/// An outgoing queue belongs to one exact tunnel. Dispatch never waits for an
/// earlier response, so a long read cannot block a user action or another server.
/// Request counts are deliberately unrestricted; each payload and lifetime is bounded.
pub(super) struct Dispatch {
    sender: Mutex<Option<mpsc::UnboundedSender<Job>>>,
    closed: watch::Sender<bool>,
}

impl Dispatch {
    pub(super) fn new(client: reqwest::Client, token: String) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Job>();
        let (closed, mut cancellation) = watch::channel(false);
        tauri::async_runtime::spawn(async move {
            let mut active = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    biased;
                    _ = cancellation.changed() => break,
                    Some(_) = active.join_next(), if !active.is_empty() => {},
                    job = receiver.recv() => {
                        let Some(job) = job else { break };
                        let client = client.clone();
                        let token = token.clone();
                        let mut canceled = cancellation.clone();
                        active.spawn(async move {
                            if job.reply.is_closed() { return; }
                            if Instant::now() >= job.deadline {
                                let _ = job.reply.send(Err(TIMED_OUT.into()));
                                return;
                            }
                            let authority = canceled.clone();
                            let result = tokio::select! {
                                biased;
                                _ = canceled.changed() => Err(CLOSED.into()),
                                result = tokio::time::timeout_at(
                                tokio::time::Instant::from_std(job.deadline),
                                tunnel_http::request_with_authority(&client, &token, job.expected.as_deref(), job.request, job.limit, || {
                                    if *authority.borrow() { return Err(CLOSED.into()); }
                                    if Instant::now() >= job.deadline { return Err(TIMED_OUT.into()); }
                                    Ok(())
                                }),
                            ) => result.unwrap_or_else(|_| Err(TIMED_OUT.into())),
                            };
                            let _ = job.reply.send(result);
                        });
                    }
                }
            }
            // Dropping the receiver settles all queued callers. Dropping JoinSet
            // aborts every in-flight HTTP future without replaying any mutation.
            drop(receiver);
            active.abort_all();
            while active.join_next().await.is_some() {}
        });
        Self {
            sender: Mutex::new(Some(sender)),
            closed,
        }
    }

    pub(super) fn request(
        &self,
        request: Prepared,
        expected: Option<String>,
        limit: usize,
        timeout: Duration,
    ) -> Result<Value, String> {
        let deadline = Instant::now() + timeout;
        let (reply, response) = oneshot::channel();
        self.sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .ok_or(CLOSED)?
            .send(Job {
                request,
                expected,
                limit,
                deadline,
                reply,
            })
            .map_err(|_| CLOSED)?;
        tauri::async_runtime::block_on(async {
            tokio::time::timeout_at(tokio::time::Instant::from_std(deadline), response)
                .await
                .map_err(|_| TIMED_OUT)?
                .map_err(|_| CLOSED.to_owned())?
        })
    }

    pub(super) fn close(&self) {
        self.sender.lock().unwrap_or_else(|e| e.into_inner()).take();
        let _ = self.closed.send(true);
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
        let dispatch = Dispatch::new(client, "test-only".into());
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
}
