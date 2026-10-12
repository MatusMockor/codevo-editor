use super::{git_sync_wire::StartBody, service::RemoteRunnerState, types::*};
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(super) const OPERATIONS_BUSY: &str =
    "Too many server requests are still in progress; retry shortly";
static OPERATIONS: OperationLimiter = OperationLimiter::new();

#[derive(Clone, Copy)]
pub(super) enum OperationClass {
    Control,
    Bulk,
}

struct OperationLimiter {
    control: AtomicUsize,
    bulk: AtomicUsize,
}

impl OperationLimiter {
    const fn new() -> Self {
        Self {
            control: AtomicUsize::new(0),
            bulk: AtomicUsize::new(0),
        }
    }

    fn acquire(&self, class: OperationClass) -> Result<OperationPermit<'_>, String> {
        let counter = match class {
            OperationClass::Control => &self.control,
            OperationClass::Bulk => &self.bulk,
        };
        counter
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 8).then_some(count + 1)
            })
            .map_err(|_| OPERATIONS_BUSY)?;
        Ok(OperationPermit { counter })
    }
}

struct OperationPermit<'a> {
    counter: &'a AtomicUsize,
}

impl Drop for OperationPermit<'_> {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) async fn blocking<T: Send + 'static>(
    class: OperationClass,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = OPERATIONS.acquire(class)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(|_| "Runner operation failed")?
}

#[tauri::command]
pub async fn remote_runner_list_servers(
    state: tauri::State<'_, RemoteRunnerState>,
) -> Result<Vec<Server>, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || state.list()).await
}

#[tauri::command]
pub async fn remote_runner_connect_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ConnectRequest,
) -> Result<Server, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || state.connect(request)).await
}

#[tauri::command]
pub async fn remote_runner_disconnect_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || {
        state.disconnect(&request.server_id, false)
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_remove_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || {
        state.disconnect(&request.server_id, true)
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_get_runner(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || {
        state.call(&request.server_id, "GET", "/v1/runner", None, vec![])
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_list_projects(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || {
        state.call(&request.server_id, "GET", "/v1/projects", None, vec![])
    })
    .await
}

fn cursor_path(path: String, after: Option<u64>) -> Result<String, String> {
    match after {
        Some(value) if value > 9_007_199_254_740_991 => Err("Invalid runner cursor".into()),
        Some(value) => Ok(format!("{path}?after={value}")),
        None => Ok(path),
    }
}

enum EventDirection {
    Forward(Option<u64>),
    Backward(u64),
}

impl EventDirection {
    fn parse(after: Option<u64>, before: Option<u64>) -> Result<Self, String> {
        if after.is_some() && before.is_some() {
            return Err("Runner event cursors are mutually exclusive".into());
        }
        if let Some(value) = before {
            if !(1..=9_007_199_254_740_991).contains(&value) {
                return Err("Invalid runner cursor".into());
            }
            return Ok(Self::Backward(value));
        }
        if after.is_some_and(|value| value > 9_007_199_254_740_991) {
            return Err("Invalid runner cursor".into());
        }
        Ok(Self::Forward(after))
    }

    fn path(self, task_id: &str) -> Result<String, String> {
        let path = task_path(task_id, "/events")?;
        match self {
            Self::Forward(after) => cursor_path(path, after),
            Self::Backward(before) => Ok(format!("{path}?before={before}")),
        }
    }
}

fn task_path(task_id: &str, suffix: &str) -> Result<String, String> {
    id(task_id)?;
    Ok(format!("/v1/tasks/{task_id}{suffix}"))
}

#[tauri::command]
pub async fn remote_runner_list_tasks(
    state: tauri::State<'_, RemoteRunnerState>,
    request: PageRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || {
        state.call(
            &request.server_id,
            "GET",
            &cursor_path("/v1/tasks".into(), request.after)?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_create_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: CreateRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || state.create(request)).await
}

#[tauri::command]
pub async fn remote_runner_start_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: StartRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || {
        let body = StartBody {
            project_id: request.project_id,
            base: request.base,
        };
        body.validate()?;
        let body = serde_json::to_value(&body).map_err(|_| "Invalid start request")?;
        state.call(
            &request.server_id,
            "POST",
            &task_path(&request.task_id, "/start")?,
            Some(body),
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_get_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || {
        state.call(
            &request.server_id,
            "GET",
            &task_path(&request.task_id, "")?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_cancel_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Control, move || {
        state.call(
            &request.server_id,
            "POST",
            &task_path(&request.task_id, "/cancel")?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_list_events(
    state: tauri::State<'_, RemoteRunnerState>,
    request: EventsRequest,
) -> Result<Value, String> {
    let direction = EventDirection::parse(request.after, request.before)?;
    let path = direction.path(&request.task_id)?;
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || {
        let page = state.call(&request.server_id, "GET", &path, None, vec![])?;
        super::event_page::validate(page)
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_get_diff(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || {
        state.call(
            &request.server_id,
            "GET",
            &task_path(&request.task_id, "/diff")?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_upload_attachment(
    state: tauri::State<'_, RemoteRunnerState>,
    request: UploadRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(OperationClass::Bulk, move || state.upload(request)).await
}

#[cfg(test)]
mod tests {
    use super::{EventDirection, EventsRequest, OperationClass, OperationLimiter};

    #[test]
    fn event_cursor_paths_preserve_forward_and_support_backward() {
        for (after, before, expected) in [
            (None, None, "/v1/tasks/task/events".to_string()),
            (Some(0), None, "/v1/tasks/task/events?after=0".to_string()),
            (Some(7), None, "/v1/tasks/task/events?after=7".to_string()),
            (None, Some(1), "/v1/tasks/task/events?before=1".to_string()),
            (
                None,
                Some(9_007_199_254_740_991),
                "/v1/tasks/task/events?before=9007199254740991".to_string(),
            ),
            (
                Some(9_007_199_254_740_991),
                None,
                "/v1/tasks/task/events?after=9007199254740991".to_string(),
            ),
        ] {
            assert_eq!(
                EventDirection::parse(after, before)
                    .unwrap()
                    .path("task")
                    .unwrap(),
                expected
            );
        }
    }

    #[test]
    fn event_cursors_reject_conflicts_and_invalid_bounds() {
        assert_eq!(
            EventDirection::parse(Some(0), Some(1)).err(),
            Some("Runner event cursors are mutually exclusive".into())
        );
        for before in [0, 9_007_199_254_740_992, u64::MAX] {
            assert_eq!(
                EventDirection::parse(None, Some(before)).err(),
                Some("Invalid runner cursor".into())
            );
        }
        assert_eq!(
            EventDirection::parse(Some(9_007_199_254_740_992), None).err(),
            Some("Invalid runner cursor".into())
        );
    }

    #[test]
    fn event_request_accepts_before_and_rejects_unknown_fields() {
        let value = serde_json::json!({"serverId":"server","taskId":"task","before":7});
        let request: EventsRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(request.before, Some(7));
        assert_eq!(request.after, None);
        let mut unknown = value;
        unknown["unexpected"] = true.into();
        assert!(serde_json::from_value::<EventsRequest>(unknown).is_err());
    }

    #[test]
    fn saturated_lanes_admit_operations_in_the_other_lane() {
        for (saturated, available) in [
            (OperationClass::Bulk, OperationClass::Control),
            (OperationClass::Control, OperationClass::Bulk),
        ] {
            let limiter = OperationLimiter::new();
            let _held: Vec<_> = (0..8)
                .map(|_| limiter.acquire(saturated).unwrap())
                .collect();
            assert!(limiter.acquire(available).is_ok());
        }
    }

    #[test]
    fn ninth_operation_is_refused_with_the_fixed_busy_text_until_a_permit_drops() {
        for class in [OperationClass::Control, OperationClass::Bulk] {
            let limiter = OperationLimiter::new();
            let mut held: Vec<_> = (0..8)
                .map(|_| {
                    limiter
                        .acquire(class)
                        .expect("eight operations are admitted")
                })
                .collect();
            assert_eq!(
                limiter.acquire(class).err(),
                Some("Too many server requests are still in progress; retry shortly".to_string())
            );
            held.pop();
            let replacement = limiter
                .acquire(class)
                .expect("a released permit is reusable");
            assert_eq!(
                limiter.acquire(class).err(),
                Some("Too many server requests are still in progress; retry shortly".to_string())
            );
            drop(replacement);
            drop(held);
            let _reacquired: Vec<_> = (0..8).map(|_| limiter.acquire(class).unwrap()).collect();
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_black_hole_tunnel_returns_every_permit_within_the_stall_bound() {
        use super::super::transport::{Session, StallPolicy};
        use std::time::{Duration, Instant};
        let policy = StallPolicy {
            quiet: Duration::from_millis(150),
            probe: Duration::from_millis(600),
            ..StallPolicy::DEFAULT
        };
        let server = super::Server {
            id: "fixture".into(),
            name: "Fixture".into(),
            host: "localhost".into(),
            username: "test".into(),
            port: 22,
            connected: true,
            runner_id: None,
        };
        for class in [OperationClass::Control, OperationClass::Bulk] {
            let limiter = OperationLimiter::new();
            let session = Session::fixture_with_stall_policy(policy);
            let _unanswering =
                std::os::unix::net::UnixListener::bind(session.socket_path()).unwrap();
            let permits: Vec<_> = (0..8).map(|_| limiter.acquire(class).unwrap()).collect();
            assert_eq!(
                limiter.acquire(class).err(),
                Some(super::OPERATIONS_BUSY.to_string())
            );
            let gate = std::sync::Barrier::new(9);
            let elapsed = std::thread::scope(|scope| {
                let stuck: Vec<_> = permits
                    .into_iter()
                    .map(|permit| {
                        let (session, server, gate) = (&session, &server, &gate);
                        scope.spawn(move || {
                            let _permit = permit;
                            gate.wait();
                            session.request(server, "GET", "/v1/tasks", None, vec![])
                        })
                    })
                    .collect();
                let started = Instant::now();
                gate.wait();
                for operation in stuck {
                    assert_eq!(
                        operation.join().unwrap().unwrap_err(),
                        "Runner connection failed. The request outcome may be unknown."
                    );
                }
                started.elapsed()
            });
            assert!(elapsed >= policy.quiet + policy.probe, "{elapsed:?}");
            assert!(elapsed < Duration::from_secs(5), "{elapsed:?}");
            assert!(!session.is_alive());
            let _readmitted: Vec<_> = (0..8).map(|_| limiter.acquire(class).unwrap()).collect();
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_reconnect_returns_the_permits_of_every_operation_that_waited_for_it() {
        use super::super::{service::ConnectionLease, transport::Session};
        use std::sync::{atomic::AtomicUsize, atomic::Ordering, mpsc, Arc, Mutex};
        use std::time::{Duration, Instant};
        const TIMED_OUT: &str = "SSH tunnel connection timed out.";
        let server = super::Server {
            id: "fixture".into(),
            name: "Fixture".into(),
            host: "localhost".into(),
            username: "test".into(),
            port: 22,
            connected: true,
            runner_id: None,
        };
        let attempts = Arc::new(AtomicUsize::new(0));
        let (entered, connecting) = mpsc::channel();
        let (fail, failing) = mpsc::channel::<()>();
        let (counted, failing) = (Arc::clone(&attempts), Mutex::new(failing));
        let lost = Arc::new(Session::fixture());
        lost.close();
        let lease = ConnectionLease::with_connect(
            server,
            lost,
            Box::new(move |_, _| {
                counted.fetch_add(1, Ordering::SeqCst);
                entered.send(()).unwrap();
                let _ = failing.lock().unwrap().recv_timeout(Duration::from_secs(5));
                Err(TIMED_OUT.into())
            }),
        );
        let limiter = OperationLimiter::new();
        let (waiting, waited) = mpsc::channel();
        let elapsed = std::thread::scope(|scope| {
            let operation = |announce: bool| {
                let permit = limiter.acquire(OperationClass::Bulk).unwrap();
                let (lease, waiting) = (lease.clone(), waiting.clone());
                scope.spawn(move || {
                    let _permit = permit;
                    let checks = std::cell::Cell::new(0);
                    lease
                        .session_with_cancellation(|| {
                            checks.set(checks.get() + 1);
                            if announce && checks.get() == 3 {
                                waiting.send(()).unwrap();
                            }
                            false
                        })
                        .map(|_| ())
                })
            };
            let mut operations = vec![operation(false)];
            connecting.recv_timeout(Duration::from_secs(5)).unwrap();
            operations.extend((0..7).map(|_| operation(true)));
            for _ in 0..7 {
                waited.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            assert_eq!(
                limiter.acquire(OperationClass::Bulk).err(),
                Some(super::OPERATIONS_BUSY.to_string())
            );
            let started = Instant::now();
            fail.send(()).unwrap();
            for operation in operations {
                assert_eq!(operation.join().unwrap(), Err(TIMED_OUT.to_string()));
            }
            started.elapsed()
        });
        assert!(elapsed < Duration::from_secs(3), "{elapsed:?}");
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        let _readmitted: Vec<_> = (0..8)
            .map(|_| limiter.acquire(OperationClass::Bulk).unwrap())
            .collect();
    }

    #[test]
    fn permits_are_released_when_work_panics() {
        for class in [OperationClass::Control, OperationClass::Bulk] {
            let limiter = OperationLimiter::new();
            let _held: Vec<_> = (0..7).map(|_| limiter.acquire(class).unwrap()).collect();
            let permit = limiter.acquire(class).unwrap();
            let result = std::panic::catch_unwind(move || {
                let _permit = permit;
                panic!("operation failed");
            });
            assert!(result.is_err());
            assert!(limiter.acquire(class).is_ok());
        }
    }
}
