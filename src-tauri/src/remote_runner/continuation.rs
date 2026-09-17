use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid, validate_parts, Part, TaskRequest},
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinueRequest {
    pub server_id: String,
    pub task_id: String,
    pub idempotency_key: String,
    pub parts: Vec<Part>,
    #[serde(default, deserialize_with = "super::instruction_wire::optional")]
    pub(super) instructions: Option<super::instruction_wire::InstructionSnapshot>,
    #[serde(default, deserialize_with = "super::launch::optional")]
    pub(super) launch: Option<super::launch::Launch>,
}

impl ContinueRequest {
    pub(super) fn body(&self) -> Result<Value, String> {
        id(&self.server_id)?;
        uuid(&self.task_id)?;
        uuid(&self.idempotency_key)?;
        validate_parts(&self.parts)?;
        let mut body = json!({"idempotencyKey": self.idempotency_key, "parts": self.parts});
        if let Some(launch) = &self.launch {
            body["launch"] = serde_json::to_value(launch).map_err(|_| "Invalid launch options")?;
        }
        if let Some(instructions) = &self.instructions {
            instructions.validate()?;
            body["instructions"] =
                serde_json::to_value(instructions).map_err(|_| "Invalid instructions")?;
        }
        Ok(body)
    }
}

fn resume_path(task_id: &str, continuing: bool) -> Result<String, String> {
    uuid(task_id)?;
    Ok(format!(
        "/v1/tasks/{task_id}/{}",
        if continuing { "continue" } else { "resume" }
    ))
}

#[tauri::command]
pub async fn remote_runner_get_task_resume(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        state.call(
            &request.server_id,
            "GET",
            &resume_path(&request.task_id, false)?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_continue_task(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ContinueRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        let body = request.body()?;
        state.call(
            &request.server_id,
            "POST",
            &resume_path(&request.task_id, true)?,
            Some(body),
            vec![],
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";

    fn input() -> Value {
        json!({"serverId":"linux", "taskId":UUID, "idempotencyKey":UUID,
            "parts":[{"type":"text","text":"Continue"}]})
    }

    #[test]
    fn continuation_accepts_only_semantic_fields() {
        let request: ContinueRequest = serde_json::from_value(input()).unwrap();
        assert_eq!(
            request.body().unwrap(),
            json!({"idempotencyKey":UUID,
            "parts":[{"type":"text","text":"Continue"}]})
        );
        for field in [
            "sessionId",
            "provider",
            "projectId",
            "cwd",
            "command",
            "isolation",
        ] {
            let mut invalid = input();
            invalid[field] = "foreign".into();
            assert!(serde_json::from_value::<ContinueRequest>(invalid).is_err());
        }
    }

    #[test]
    fn continuation_preserves_exact_validated_launch() {
        let mut value = input();
        let launch = json!({"provider":"codex","model":"gpt-6-astra","mode":"readOnly"});
        value["launch"] = launch.clone();
        let request: ContinueRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(request.body().unwrap()["launch"], launch);
        value["launch"] = Value::Null;
        assert!(serde_json::from_value::<ContinueRequest>(value).is_err());
    }

    #[test]
    fn continuation_and_pending_preserve_instruction_snapshot() {
        let mut value = input();
        let snapshot = json!({"version":1,"files":[{"scope":"project","path":"CLAUDE.local.md","content":"Local rules"}]});
        value["instructions"] = snapshot.clone();
        let request: ContinueRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(request.body().unwrap()["instructions"], snapshot);
        value["instructions"] = Value::Null;
        assert!(serde_json::from_value::<ContinueRequest>(value).is_err());
    }

    #[test]
    fn continuation_bounds_parts_and_utf8_bytes() {
        let mut request: ContinueRequest = serde_json::from_value(input()).unwrap();
        request.parts = vec![Part::Text {
            text: "é".repeat(24_000),
        }];
        assert!(request.body().is_ok());
        request.parts = vec![Part::Text {
            text: "é".repeat(24_001),
        }];
        assert!(request.body().is_err());
        request.parts = (0..8)
            .map(|index| Part::Attachment {
                attachment_id: format!("7389088c-29b8-4cec-9a15-{index:012x}"),
            })
            .collect();
        assert!(request.body().is_ok());
        request.parts.push(Part::Attachment {
            attachment_id: UUID.into(),
        });
        assert!(request.body().is_err());
        request.parts = (0..17).map(|_| Part::Text { text: "x".into() }).collect();
        assert!(request.body().is_err());
        request.parts.clear();
        assert!(request.body().is_err());
        request.parts = vec![Part::Attachment {
            attachment_id: "../image".into(),
        }];
        assert!(request.body().is_err());
    }

    #[test]
    fn rejects_blank_nul_and_duplicate_attachments() {
        let mut request: ContinueRequest = serde_json::from_value(input()).unwrap();
        for text in ["", " ", "hello\0world"] {
            request.parts = vec![Part::Text { text: text.into() }];
            assert!(request.body().is_err());
        }
        request.parts = vec![Part::Attachment {
            attachment_id: UUID.into(),
        }];
        assert!(request.body().is_ok());
        request.parts.push(Part::Attachment {
            attachment_id: UUID.into(),
        });
        assert!(request.body().is_err());
        request.parts = vec![Part::Attachment {
            attachment_id: "image".into(),
        }];
        assert!(request.body().is_err());
    }

    #[test]
    fn continuation_rejects_endpoint_injection() {
        assert_eq!(
            resume_path(UUID, false).unwrap(),
            format!("/v1/tasks/{UUID}/resume")
        );
        assert_eq!(
            resume_path(UUID, true).unwrap(),
            format!("/v1/tasks/{UUID}/continue")
        );
        for invalid in ["", "../task", "task?x=y", "task/continue", "task\n"] {
            assert!(resume_path(invalid, true).is_err());
        }
        for field in ["serverId", "taskId", "idempotencyKey"] {
            let mut invalid = input();
            invalid[field] = "../foreign".into();
            let request: ContinueRequest = serde_json::from_value(invalid).unwrap();
            assert!(request.body().is_err());
        }
    }
}
