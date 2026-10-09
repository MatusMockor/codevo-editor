use super::{git_sync_wire::StartBody, service::RemoteRunnerState, types::*};
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(super) const OPERATIONS_BUSY: &str = "Runner is busy; retry shortly";
static OPERATIONS: AtomicUsize = AtomicUsize::new(0);
struct OperationPermit;
impl OperationPermit {
    fn acquire() -> Result<Self, String> {
        OPERATIONS
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 8).then_some(count + 1)
            })
            .map_err(|_| OPERATIONS_BUSY)?;
        Ok(Self)
    }
}
impl Drop for OperationPermit {
    fn drop(&mut self) {
        OPERATIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = OperationPermit::acquire()?;
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
    blocking(move || state.list()).await
}

#[tauri::command]
pub async fn remote_runner_connect_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ConnectRequest,
) -> Result<Server, String> {
    let state = state.inner().clone();
    blocking(move || state.connect(request)).await
}

#[tauri::command]
pub async fn remote_runner_disconnect_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || state.disconnect(&request.server_id, false)).await
}

#[tauri::command]
pub async fn remote_runner_remove_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || state.disconnect(&request.server_id, true)).await
}

#[tauri::command]
pub async fn remote_runner_get_runner(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || state.call(&request.server_id, "GET", "/v1/runner", None, vec![])).await
}

#[tauri::command]
pub async fn remote_runner_list_projects(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || state.call(&request.server_id, "GET", "/v1/projects", None, vec![])).await
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
    blocking(move || {
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
    blocking(move || state.create(request)).await
}

#[tauri::command]
pub async fn remote_runner_start_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: StartRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
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
    blocking(move || {
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
    blocking(move || {
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
    blocking(move || {
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
    blocking(move || {
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
    blocking(move || state.upload(request)).await
}

#[cfg(test)]
mod tests {
    use super::{EventDirection, EventsRequest, OperationPermit};

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
    fn ninth_operation_is_refused_with_the_fixed_busy_text_until_a_permit_drops() {
        let mut held: Vec<OperationPermit> = (0..8)
            .map(|_| OperationPermit::acquire().expect("eight operations are admitted"))
            .collect();
        assert_eq!(
            OperationPermit::acquire().err(),
            Some("Runner is busy; retry shortly".to_string())
        );
        held.pop();
        let replacement = OperationPermit::acquire().expect("a released permit is reusable");
        assert_eq!(
            OperationPermit::acquire().err(),
            Some("Runner is busy; retry shortly".to_string())
        );
        drop(replacement);
        drop(held);
        assert!(OperationPermit::acquire().is_ok());
    }
}
