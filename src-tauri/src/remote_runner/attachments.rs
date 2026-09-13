use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentRequest {
    pub server_id: String,
    pub attachment_id: String,
}

impl AttachmentRequest {
    fn path(&self) -> Result<String, String> {
        id(&self.server_id)?;
        uuid(&self.attachment_id)?;
        Ok(format!("/v1/attachments/{}", self.attachment_id))
    }
}

#[tauri::command]
pub async fn remote_runner_get_attachment(
    state: tauri::State<'_, RemoteRunnerState>,
    request: AttachmentRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || state.call(&request.server_id, "GET", &request.path()?, None, vec![])).await
}

#[tauri::command]
pub async fn remote_runner_read_attachment(
    state: tauri::State<'_, RemoteRunnerState>,
    request: AttachmentRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        state.call(
            &request.server_id,
            "GET",
            &format!("{}/content", request.path()?),
            None,
            vec![],
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";

    #[test]
    fn attachment_requests_accept_only_registered_server_and_uuid() {
        let input = json!({"serverId":"linux", "attachmentId":UUID});
        let request: AttachmentRequest = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(request.path().unwrap(), format!("/v1/attachments/{UUID}"));
        for field in ["path", "url", "headers", "host", "token"] {
            let mut invalid = input.clone();
            invalid[field] = "foreign".into();
            assert!(serde_json::from_value::<AttachmentRequest>(invalid).is_err());
        }
        for field in ["serverId", "attachmentId"] {
            for value in [
                "",
                "../image",
                "image?token=secret",
                "image/content",
                "image\n",
            ] {
                let mut invalid = input.clone();
                invalid[field] = value.into();
                let request: AttachmentRequest = serde_json::from_value(invalid).unwrap();
                assert!(request.path().is_err());
            }
        }
    }
}
