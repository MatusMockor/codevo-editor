use super::{
    commands::blocking,
    continuation::ContinueRequest,
    service::RemoteRunnerState,
    types::{id, uuid, TaskRequest},
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelPendingRequest {
    server_id: String,
    task_id: String,
    pending_id: String,
}

fn pending_path(task_id: &str, pending_id: Option<&str>) -> Result<String, String> {
    uuid(task_id)?;
    let base = format!("/v1/tasks/{task_id}/pending");
    match pending_id {
        Some(value) => {
            uuid(value)?;
            Ok(format!("{base}/{value}"))
        }
        None => Ok(base),
    }
}

#[tauri::command]
pub async fn remote_runner_list_pending_messages(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        id(&request.server_id)?;
        state.call(
            &request.server_id,
            "GET",
            &pending_path(&request.task_id, None)?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_enqueue_message(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ContinueRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        let body = request.body()?;
        state.call(
            &request.server_id,
            "POST",
            &pending_path(&request.task_id, None)?,
            Some(body),
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_cancel_pending_message(
    state: tauri::State<'_, RemoteRunnerState>,
    request: CancelPendingRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        id(&request.server_id)?;
        state.call(
            &request.server_id,
            "DELETE",
            &pending_path(&request.task_id, Some(&request.pending_id))?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_resume_pending_messages(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        id(&request.server_id)?;
        let path = format!("{}/resume", pending_path(&request.task_id, None)?);
        state.call(&request.server_id, "POST", &path, None, vec![])
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";

    #[test]
    fn paths_reject_injection_and_preserve_exact_pending_identity() {
        assert_eq!(
            pending_path(UUID, None).unwrap(),
            format!("/v1/tasks/{UUID}/pending")
        );
        assert_eq!(
            pending_path(UUID, Some(UUID)).unwrap(),
            format!("/v1/tasks/{UUID}/pending/{UUID}")
        );
        for invalid in ["", "../task", "task?x=y", "task/resume", "task\n"] {
            assert!(pending_path(invalid, None).is_err());
            assert!(pending_path(UUID, Some(invalid)).is_err());
        }
    }

    #[test]
    fn cancellation_rejects_unknown_executable_fields() {
        let value = serde_json::json!({"serverId":"linux","taskId":UUID,"pendingId":UUID});
        assert!(serde_json::from_value::<CancelPendingRequest>(value.clone()).is_ok());
        for field in ["command", "cwd", "sessionId", "provider"] {
            let mut invalid = value.clone();
            invalid[field] = "foreign".into();
            assert!(serde_json::from_value::<CancelPendingRequest>(invalid).is_err());
        }
    }
}
