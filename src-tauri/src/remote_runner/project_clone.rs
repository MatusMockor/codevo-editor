use super::types::uuid;
use super::{commands::blocking, service::RemoteRunnerState};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloneProjectRequest {
    pub server_id: String,
    pub idempotency_key: String,
    pub url: String,
    pub name: String,
    #[serde(default, deserialize_with = "optional_branch")]
    pub branch: Option<String>,
    #[serde(default, deserialize_with = "optional_branch")]
    pub parent_path: Option<String>,
}

fn optional_branch<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectCloneRequest {
    pub server_id: String,
    pub clone_id: String,
}

#[tauri::command]
pub async fn remote_runner_clone_project(
    state: tauri::State<'_, RemoteRunnerState>,
    request: CloneProjectRequest,
) -> Result<Value, String> {
    let body = request.body()?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        super::project_management::call_lease(lease, "POST", "/v1/projects/clone", Some(body))
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_get_project_clone(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ProjectCloneRequest,
) -> Result<Value, String> {
    super::types::id(&request.server_id)?;
    let path = clone_path(&request.clone_id, false)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || super::project_management::call_lease(lease, "GET", &path, None)).await
}

#[tauri::command]
pub async fn remote_runner_cancel_project_clone(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ProjectCloneRequest,
) -> Result<Value, String> {
    super::types::id(&request.server_id)?;
    let path = clone_path(&request.clone_id, true)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || super::project_management::call_lease(lease, "POST", &path, None)).await
}

fn clone_path(clone_id: &str, cancel: bool) -> Result<String, String> {
    uuid(clone_id)?;
    Ok(format!(
        "/v1/project-clones/{clone_id}{}",
        if cancel { "/cancel" } else { "" }
    ))
}

impl CloneProjectRequest {
    fn body(&self) -> Result<Value, String> {
        super::types::id(&self.server_id)?;
        uuid(&self.idempotency_key)?;
        super::types::id(&self.name)?;
        if !repository_url(&self.url)
            || self
                .branch
                .as_deref()
                .is_some_and(|branch| !branch_name(branch))
        {
            return Err("Invalid repository URL or branch".into());
        }
        let mut body =
            json!({"idempotencyKey": self.idempotency_key, "url": self.url, "name": self.name});
        if let Some(branch) = &self.branch {
            body["branch"] = branch.clone().into();
        }
        if let Some(path) = &self.parent_path {
            if !super::project_management::valid_directory_path(path) {
                return Err("Invalid project directory".into());
            }
            body["parentPath"] = path.clone().into();
        }
        Ok(body)
    }
}

pub(crate) fn repository_url(value: &str) -> bool {
    if value.len() > 2048 || !value.is_ascii() {
        return false;
    }
    let (authority, path, ssh) = if let Some(rest) = value.strip_prefix("https://") {
        let Some((authority, path)) = rest.split_once('/') else {
            return false;
        };
        (authority, path, false)
    } else if let Some(rest) = value.strip_prefix("ssh://") {
        let Some((authority, path)) = rest.split_once('/') else {
            return false;
        };
        (authority, path, true)
    } else {
        let Some((authority, path)) = value.split_once(':') else {
            return false;
        };
        (authority, path, true)
    };
    let authority = if ssh {
        let Some((username, host)) = authority.split_once('@') else {
            return false;
        };
        if username.is_empty()
            || username.len() > 64
            || !username
                .as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            || !username
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return false;
        }
        host
    } else {
        authority
    };
    let host = if value.starts_with("ssh://") {
        if let Some((host, port)) = authority.split_once(':') {
            if port.is_empty()
                || port.len() > 5
                || !port.bytes().all(|b| b.is_ascii_digit())
                || !port.parse::<u16>().is_ok_and(|port| port > 0)
            {
                return false;
            }
            host
        } else {
            authority
        }
    } else {
        authority
    };
    !host.is_empty()
        && host.len() <= 253
        && host.as_bytes()[0].is_ascii_alphanumeric()
        && host
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
        && !path.is_empty()
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._/-".contains(&b))
}

pub(crate) fn branch_name(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 255
        && !value
            .chars()
            .any(|c| c <= ' ' || c == '\u{7f}' || "~^:?*[\\".contains(c))
        && !value.contains("..")
        && !value.contains("@{")
        && !value.contains("//")
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.ends_with('.')
        && value != "@"
        && value
            .split('/')
            .all(|part| !part.starts_with('.') && !part.ends_with(".lock"))
}

#[cfg(test)]
mod tests {
    use super::*;
    const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
    #[test]
    fn optional_parent_is_validated_and_preserved() {
        let base = json!({"serverId":"server", "idempotencyKey":UUID,"url":"https://github.com/org/repo.git","name":"repo","parentPath":"/projects/apps"});
        let request: CloneProjectRequest = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(request.body().unwrap()["parentPath"], "/projects/apps");
        for path in [
            "relative",
            "/projects/../etc",
            "/projects//apps",
            "/projects\n",
        ] {
            let mut input = base.clone();
            input["parentPath"] = path.into();
            assert!(serde_json::from_value::<CloneProjectRequest>(input)
                .unwrap()
                .body()
                .is_err());
        }
        let mut input = base;
        input["parentPath"] = Value::Null;
        assert!(serde_json::from_value::<CloneProjectRequest>(input).is_err());
    }
    #[test]
    fn accepts_closed_remote_transports_and_refs() {
        for url in [
            "https://github.com/org/repo.git",
            "ssh://git@example.org:2222/org/repo.git",
            "git@example.org:org/repo.git",
        ] {
            assert!(repository_url(url), "{url}");
        }
        for branch in ["main", "feature/project-clone", "release/1.0"] {
            assert!(branch_name(branch));
        }
    }
    #[test]
    fn rejects_local_paths_credentials_and_git_option_injection() {
        for url in [
            "/tmp/repo",
            "file:///tmp/repo",
            "-uanything",
            "https://token@host/repo",
            "https://host/repo?token=x",
            "https://host/repo#x",
            "https://host/%2frepo",
            "git@host:../repo",
            "https://host:0/repo",
            "https://host:65536/repo",
            "https://host/repo\n",
        ] {
            assert!(!repository_url(url), "{url}");
        }
        for branch in [
            "", "-main", "a..b", "a//b", "a/.b", "a/b.lock", "a.", "a/", "HEAD~1", "@{",
        ] {
            assert!(!branch_name(branch), "{branch}");
        }
    }
    #[test]
    fn serializes_only_semantic_fields_and_rejects_unknowns() {
        let input = json!({"serverId":"server", "idempotencyKey":UUID,"url":"https://github.com/org/repo.git","name":"repo"});
        let request: CloneProjectRequest = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(
            request.body().unwrap(),
            json!({"idempotencyKey":UUID,"url":"https://github.com/org/repo.git","name":"repo"})
        );
        let mut extra = input;
        extra["command"] = "id".into();
        assert!(serde_json::from_value::<CloneProjectRequest>(extra).is_err());
        assert!(serde_json::from_value::<CloneProjectRequest>(json!({
            "serverId":"server", "idempotencyKey":UUID,
            "url":"https://github.com/org/repo.git", "name":"repo", "branch":null
        }))
        .is_err());
        assert!(serde_json::from_value::<ProjectCloneRequest>(
            json!({"serverId":"server","cloneId":UUID,"extra":true})
        )
        .is_err());
    }
    #[test]
    fn bounds_identifiers_before_building_endpoint() {
        assert_eq!(
            clone_path(UUID, true).unwrap(),
            format!("/v1/project-clones/{UUID}/cancel")
        );
        for invalid in [
            "",
            "../task",
            "000000000000000000000000000000000000",
            "7389088c-29b8-4cec-9a15-e825e1fb2f6z",
        ] {
            assert!(clone_path(invalid, false).is_err());
        }
    }
}
