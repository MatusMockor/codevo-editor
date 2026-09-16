//! Task-scoped generated output access; credentials remain in the native transport.
use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveArtifactRequest {
    pub server_id: String,
    pub runner_id: String,
    pub task_id: String,
    pub path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadArtifactRequest {
    pub server_id: String,
    pub runner_id: String,
    pub task_id: String,
    pub artifact_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactMetadata {
    id: String,
    task_id: String,
    name: String,
    media_type: String,
    size_bytes: usize,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveResponse {
    artifact: ArtifactMetadata,
    created: bool,
}
fn resolve_response(value: serde_json::Value, task: &str) -> Result<ArtifactMetadata, String> {
    let response: ResolveResponse =
        serde_json::from_value(value).map_err(|_| "Invalid runner artifact response")?;
    // New and already durable snapshots follow the same validated contract.
    let _ = response.created;
    response.artifact.validate(task)?;
    Ok(response.artifact)
}
fn call(
    state: &RemoteRunnerState,
    server_id: &str,
    runner_id: &str,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if runner_id.is_empty() || runner_id.len() > 128 || runner_id.chars().any(char::is_control) {
        return Err("Invalid artifact runner identity".into());
    }
    let lease = state.connection_lease(server_id)?;
    if lease.server().runner_id.as_deref() != Some(runner_id) {
        return Err("Artifact runner identity changed".into());
    }
    let session = lease.session()?;
    if !lease.is_current() {
        return Err("Artifact connection changed".into());
    }
    let result = session.request(lease.server(), method, path, body, vec![])?;
    if !lease.is_current() {
        return Err("Artifact connection changed".into());
    }
    Ok(result)
}
fn task_path(server: &str, task: &str) -> Result<String, String> {
    id(server)?;
    uuid(task)?;
    Ok(format!("/v1/tasks/{task}/artifacts"))
}
pub(super) fn is_content_path(path: &str) -> bool {
    let Some(parts) = path
        .strip_prefix("/v1/tasks/")
        .and_then(|p| p.strip_suffix("/content"))
    else {
        return false;
    };
    let Some((task, artifact)) = parts.split_once("/artifacts/") else {
        return false;
    };
    uuid(task).is_ok() && uuid(artifact).is_ok()
}
fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 4096
        || path.chars().any(char::is_control)
        || path.contains(['\\', '?', '#', ':'])
        || path.starts_with("//")
        || path
            .split('/')
            .any(|p| matches!(p, "." | "..") || p.eq_ignore_ascii_case(".git"))
    {
        return Err("Invalid artifact path".into());
    }
    Ok(())
}
fn media_limit(media: &str) -> Result<usize, String> {
    match media {
        "text/html" => Ok(2 * 1024 * 1024),
        "image/png" | "image/jpeg" | "image/webp" => Ok(8 * 1024 * 1024),
        _ => Err("Unsupported artifact media type".into()),
    }
}
impl ArtifactMetadata {
    fn validate(&self, task: &str) -> Result<(), String> {
        uuid(&self.id)?;
        if self.task_id != task
            || self.name.is_empty()
            || self.name.len() > 255
            || self.name.chars().any(char::is_control)
            || self.name.contains(['/', '\\'])
            || self.size_bytes == 0
            || self.size_bytes > media_limit(&self.media_type)?
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err("Invalid runner artifact metadata".into());
        }
        Ok(())
    }
}
#[tauri::command]
pub async fn resolve_remote_agent_artifact(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ResolveArtifactRequest,
) -> Result<ArtifactMetadata, String> {
    let state = state.inner().clone();
    blocking(move || {
        validate_path(&request.path)?;
        let value = call(
            &state,
            &request.server_id,
            &request.runner_id,
            "POST",
            &task_path(&request.server_id, &request.task_id)?,
            Some(json!({"path":request.path})),
        )?;
        resolve_response(value, &request.task_id)
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Content {
    base64: String,
    media_type: String,
}
fn decode_content(value: serde_json::Value) -> Result<Vec<u8>, String> {
    let content: Content =
        serde_json::from_value(value).map_err(|_| "Invalid runner artifact content")?;
    let limit = media_limit(&content.media_type)?;
    if content.base64.len() > limit.div_ceil(3) * 4 {
        return Err("Artifact exceeds content limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content.base64)
        .map_err(|_| "Invalid artifact encoding")?;
    if bytes.is_empty()
        || bytes.len() > limit
        || (content.media_type == "text/html" && std::str::from_utf8(&bytes).is_err())
    {
        return Err("Invalid artifact content".into());
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn read_remote_agent_artifact(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ReadArtifactRequest,
) -> Result<tauri::ipc::Response, String> {
    let state = state.inner().clone();
    blocking(move || {
        uuid(&request.artifact_id)?;
        let path = format!(
            "{}/{}/content",
            task_path(&request.server_id, &request.task_id)?,
            request.artifact_id
        );
        let value = call(
            &state,
            &request.server_id,
            &request.runner_id,
            "GET",
            &path,
            None,
        )?;
        Ok(tauri::ipc::Response::new(decode_content(value)?))
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
    #[test]
    fn content_routes_are_exact_owner_scoped_and_bounded() {
        let path = format!("/v1/tasks/{ID}/artifacts/{ID}/content");
        assert!(is_content_path(&path));
        for invalid in [
            format!("{path}?x=1"),
            path.replace(ID, "../x"),
            format!("{path}/"),
            "/v1/tasks/x/artifacts/y/content".into(),
        ] {
            assert!(!is_content_path(&invalid));
        }
        assert!(validate_path("/home/codex/Developer/project/design.html").is_ok());
        for invalid in [
            "../x.png",
            "a/../b.png",
            "a/.git/x.html",
            "//etc/a.html",
            "https://a/a.png",
            "a\0.png",
        ] {
            assert!(validate_path(invalid).is_err());
        }
    }
    #[test]
    fn strict_requests_reject_authority_injection() {
        assert!(serde_json::from_value::<ReadArtifactRequest>(
            json!({"serverId":"linux","runnerId":"runner-id","taskId":ID,"artifactId":ID})
        )
        .is_ok());
        assert!(serde_json::from_value::<ReadArtifactRequest>(
            json!({"serverId":"linux","taskId":ID,"artifactId":ID})
        )
        .is_err());
        assert!(serde_json::from_value::<ReadArtifactRequest>(
            json!({"serverId":"linux","runnerId":"runner-id","taskId":ID,"artifactId":ID,"token":"secret"})
        )
        .is_err());
        assert!(serde_json::from_value::<ResolveArtifactRequest>(
            json!({"serverId":"linux","runnerId":"runner-id","taskId":ID,"path":"x.png","host":"foreign"})
        )
        .is_err());
    }
    #[test]
    fn content_rejects_unsupported_media_invalid_utf8_and_excess() {
        assert_eq!(
            decode_content(json!({"base64":"PGgxPng8L2gxPg==","mediaType":"text/html"})).unwrap(),
            b"<h1>x</h1>"
        );
        for value in [
            json!({"base64":"/w==","mediaType":"text/html"}),
            json!({"base64":"YWJj","mediaType":"image/svg+xml"}),
            json!({"base64":"","mediaType":"image/png"}),
            json!({"base64":"!","mediaType":"image/png"}),
        ] {
            assert!(decode_content(value).is_err());
        }
        assert!(decode_content(json!({"base64":"A".repeat((2 * 1024 * 1024_usize).div_ceil(3) * 4 + 1),"mediaType":"text/html"})).is_err());
    }
    #[test]
    fn metadata_is_closed_and_rejects_foreign_task() {
        let input = json!({"id":ID,"taskId":ID,"name":"design.html","mediaType":"text/html","sizeBytes":5,"sha256":"a".repeat(64)});
        let metadata: ArtifactMetadata = serde_json::from_value(input.clone()).unwrap();
        assert!(metadata.validate(ID).is_ok());
        for created in [true, false] {
            assert!(
                resolve_response(json!({"artifact":input.clone(),"created":created}), ID).is_ok()
            );
        }
        assert!(resolve_response(input.clone(), ID).is_err());
        assert!(resolve_response(
            json!({"artifact":input.clone(),"created":true,"unknown":1}),
            ID
        )
        .is_err());
        assert!(metadata.validate("foreign").is_err());
        let mut input = input;
        input["token"] = json!("secret");
        assert!(serde_json::from_value::<ArtifactMetadata>(input).is_err());
    }
}
