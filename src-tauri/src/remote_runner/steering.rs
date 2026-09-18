use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid, validate_parts, Part},
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SteerRequest {
    server_id: String,
    task_id: String,
    idempotency_key: String,
    parts: Vec<Part>,
}

impl SteerRequest {
    fn body(&self) -> Result<Value, String> {
        id(&self.server_id)?;
        uuid(&self.task_id)?;
        uuid(&self.idempotency_key)?;
        validate_parts(&self.parts)?;
        Ok(json!({"idempotencyKey": self.idempotency_key, "parts": self.parts}))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SteerPendingRequest {
    server_id: String,
    task_id: String,
    pending_id: String,
}

fn path(task_id: &str, pending_id: Option<&str>) -> Result<String, String> {
    uuid(task_id)?;
    match pending_id {
        Some(pending_id) => {
            uuid(pending_id)?;
            Ok(format!("/v1/tasks/{task_id}/pending/{pending_id}/steer"))
        }
        None => Ok(format!("/v1/tasks/{task_id}/steer")),
    }
}

fn response(value: Value, task_id: &str, message_id: &str) -> Result<Value, String> {
    if value != json!({"taskId":task_id,"messageId":message_id,"status":"accepted"}) {
        return Err("Runner returned an invalid steering response.".into());
    }
    Ok(value)
}

#[tauri::command]
pub async fn remote_runner_steer_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: SteerRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        let body = request.body()?;
        let result = state.call(
            &request.server_id,
            "POST",
            &path(&request.task_id, None)?,
            Some(body),
            vec![],
        )?;
        response(result, &request.task_id, &request.idempotency_key)
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_steer_pending_message(
    state: tauri::State<'_, RemoteRunnerState>,
    request: SteerPendingRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        id(&request.server_id)?;
        let result = state.call(
            &request.server_id,
            "POST",
            &path(&request.task_id, Some(&request.pending_id))?,
            None,
            vec![],
        )?;
        response(result, &request.task_id, &request.pending_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";

    fn input() -> Value {
        json!({"serverId":"linux","taskId":UUID,"idempotencyKey":UUID,
            "parts":[{"type":"text","text":"Change direction"}]})
    }

    #[test]
    fn steering_accepts_only_exact_semantic_request() {
        let request: SteerRequest = serde_json::from_value(input()).unwrap();
        assert_eq!(
            request.body().unwrap(),
            json!({"idempotencyKey":UUID,
            "parts":[{"type":"text","text":"Change direction"}]})
        );
        for field in [
            "instructions",
            "launch",
            "provider",
            "command",
            "cwd",
            "sessionId",
        ] {
            let mut invalid = input();
            invalid[field] = "foreign".into();
            assert!(serde_json::from_value::<SteerRequest>(invalid).is_err());
        }
        for field in ["serverId", "taskId", "idempotencyKey"] {
            let mut invalid = input();
            invalid[field] = "../foreign".into();
            let request: SteerRequest = serde_json::from_value(invalid).unwrap();
            assert!(request.body().is_err());
        }
    }

    #[test]
    fn steering_bounds_utf8_and_attachment_references() {
        let mut request: SteerRequest = serde_json::from_value(input()).unwrap();
        request.parts = vec![Part::Text {
            text: "é".repeat(24_000),
        }];
        assert!(request.body().is_ok());
        request.parts = vec![Part::Text {
            text: "é".repeat(24_001),
        }];
        assert!(request.body().is_err());
        request.parts = vec![Part::Attachment {
            attachment_id: UUID.into(),
        }];
        assert!(request.body().is_ok());
        request.parts.push(Part::Attachment {
            attachment_id: UUID.into(),
        });
        assert!(request.body().is_err());
        for parts in [
            json!([]),
            json!([{"type":"attachment","attachmentId":"/tmp/a.png"}]),
            json!([{"type":"text","text":"\u{0000}"}]),
        ] {
            let mut invalid = input();
            invalid["parts"] = parts;
            let request: SteerRequest = serde_json::from_value(invalid).unwrap();
            assert!(request.body().is_err());
        }
    }

    #[test]
    fn pending_paths_and_requests_reject_extra_authority() {
        assert_eq!(path(UUID, None).unwrap(), format!("/v1/tasks/{UUID}/steer"));
        assert_eq!(
            path(UUID, Some(UUID)).unwrap(),
            format!("/v1/tasks/{UUID}/pending/{UUID}/steer")
        );
        for invalid in ["", "../task", "task?x=y", "task/steer", "task\n"] {
            assert!(path(invalid, None).is_err());
            assert!(path(UUID, Some(invalid)).is_err());
        }
        let mut value = json!({"serverId":"linux","taskId":UUID,"pendingId":UUID});
        assert!(serde_json::from_value::<SteerPendingRequest>(value.clone()).is_ok());
        value["parts"] = json!([]);
        assert!(serde_json::from_value::<SteerPendingRequest>(value).is_err());
    }

    #[test]
    fn response_requires_exact_identity_and_closed_shape() {
        let valid = json!({"taskId":UUID,"messageId":UUID,"status":"accepted"});
        assert!(response(valid.clone(), UUID, UUID).is_ok());
        for field in ["taskId", "messageId", "status", "extra"] {
            let mut invalid = valid.clone();
            invalid[field] = "foreign".into();
            assert!(response(invalid, UUID, UUID).is_err());
        }
    }
}
