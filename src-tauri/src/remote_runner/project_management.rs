use super::{
    commands::blocking,
    service::{ConnectionLease, RemoteRunnerState},
    types::{id, ServerRequest},
};
use crate::lib_composition::repository_lookup::{
    RepositoryLookupRequest, RepositoryLookupRequestWire,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Retain the exact admitted connection across blocking dispatch and network I/O.
pub(super) fn call_lease(
    lease: ConnectionLease,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let session = lease.session()?;
    if !lease.is_current() {
        return Err("Server connection changed during request".into());
    }
    let result = session.request(lease.server(), method, path, body, vec![]);
    if !lease.is_current() {
        return Err("Server connection changed during request".into());
    }
    result
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Provider {
    Github,
    Gitlab,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupInput {
    provider: Provider,
    host: String,
    path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupRequest {
    server_id: String,
    request: LookupInput,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchInput {
    provider: Provider,
    host: String,
    query: String,
    page: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    server_id: String,
    request: SearchInput,
}

fn lookup_body(input: &LookupInput) -> Result<Value, String> {
    let body = serde_json::to_value(input).map_err(|_| "Invalid repository request")?;
    let wire: RepositoryLookupRequestWire =
        serde_json::from_value(body.clone()).map_err(|_| "Invalid repository request")?;
    RepositoryLookupRequest::validate(&wire).ok_or("Invalid repository request")?;
    Ok(body)
}
fn search_body(input: &SearchInput) -> Result<Value, String> {
    // Reuse authoritative host/provider/path validation before admitting a search.
    lookup_body(&LookupInput {
        provider: match input.provider {
            Provider::Github => Provider::Github,
            Provider::Gitlab => Provider::Gitlab,
        },
        host: input.host.clone(),
        path: "owner/repository".into(),
    })?;
    if !(1..=10).contains(&input.page)
        || input.query.len() > 100
        || !input
            .query
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        || input.query.trim() != input.query
        || input.query.contains("..")
        || !input
            .query
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._ /-".contains(&b))
    {
        return Err("Invalid repository search".into());
    }
    serde_json::to_value(input).map_err(|_| "Invalid repository search".into())
}

#[tauri::command]
pub async fn remote_runner_repository_hosts(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ServerRequest,
) -> Result<Value, String> {
    id(&request.server_id)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || call_lease(lease, "GET", "/v1/repositories/hosts", None)).await
}
#[tauri::command]
pub async fn remote_runner_lookup_repository(
    state: tauri::State<'_, RemoteRunnerState>,
    request: LookupRequest,
) -> Result<Value, String> {
    id(&request.server_id)?;
    let body = lookup_body(&request.request)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || call_lease(lease, "POST", "/v1/repositories/lookup", Some(body))).await
}
#[tauri::command]
pub async fn remote_runner_search_repositories(
    state: tauri::State<'_, RemoteRunnerState>,
    request: SearchRequest,
) -> Result<Value, String> {
    id(&request.server_id)?;
    let body = search_body(&request.request)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || call_lease(lease, "POST", "/v1/repositories/search", Some(body))).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryRequest {
    server_id: String,
    #[serde(default, deserialize_with = "optional_path")]
    path: Option<String>,
}
fn optional_path<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
pub(super) fn valid_directory_path(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= 4096
        && !path.chars().any(char::is_control)
        && !path.contains('\\')
        && (path == "/"
            || path[1..]
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryEntry {
    name: String,
    path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryResponse {
    path: String,
    #[serde(deserialize_with = "nullable_path")]
    parent_path: Option<String>,
    entries: Vec<DirectoryEntry>,
    truncated: bool,
}
fn nullable_path<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
fn validate_directories(value: Value) -> Result<Value, String> {
    let response: DirectoryResponse =
        serde_json::from_value(value.clone()).map_err(|_| "Invalid directory response")?;
    let _ = response.truncated;
    if !valid_directory_path(&response.path)
        || response.entries.len() > 256
        || response.parent_path.as_deref().is_some_and(|p| {
            !valid_directory_path(p)
                || std::path::Path::new(&response.path).parent() != Some(std::path::Path::new(p))
        })
    {
        return Err("Invalid directory response".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total_bytes = 0;
    for entry in response.entries {
        total_bytes += entry.path.len() + entry.name.len();
        if total_bytes > 128 * 1024 {
            return Err("Invalid directory response".into());
        }
        if entry.name.is_empty()
            || entry.name.len() > 255
            || entry.name.chars().any(char::is_control)
            || !valid_directory_path(&entry.path)
            || !seen.insert(entry.path.clone())
            || std::path::Path::new(&entry.path).parent()
                != Some(std::path::Path::new(&response.path))
            || std::path::Path::new(&entry.path)
                .file_name()
                .and_then(|s| s.to_str())
                != Some(&entry.name)
        {
            return Err("Invalid directory response".into());
        }
    }
    Ok(value)
}
#[tauri::command]
pub async fn remote_runner_project_directories(
    state: tauri::State<'_, RemoteRunnerState>,
    request: DirectoryRequest,
) -> Result<Value, String> {
    id(&request.server_id)?;
    if request
        .path
        .as_deref()
        .is_some_and(|path| !valid_directory_path(path))
    {
        return Err("Invalid project directory".into());
    }
    let lease = state.connection_lease(&request.server_id)?;
    let body = request
        .path
        .map_or_else(|| json!({}), |path| json!({"path":path}));
    blocking(move || {
        validate_directories(call_lease(
            lease,
            "POST",
            "/v1/project-directories",
            Some(body),
        )?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn revoked_admission_cannot_rebind_to_a_new_connection() {
        use std::sync::Arc;
        let server = super::super::types::Server {
            id: "server".into(),
            name: "Test".into(),
            host: "127.0.0.1".into(),
            username: "codex".into(),
            port: 22,
            connected: true,
            runner_id: Some("runner".into()),
        };
        let old = ConnectionLease::new(
            server.clone(),
            Arc::new(super::super::transport::Session::fixture()),
        );
        old.revoke();
        let replacement = ConnectionLease::new(
            server,
            Arc::new(super::super::transport::Session::fixture()),
        );
        assert!(call_lease(old, "POST", "/v1/projects/clone", Some(json!({}))).is_err());
        assert!(replacement.is_current());
    }
    #[test]
    fn closed_search_and_lookup_inputs_reject_injection() {
        for query in ["", "-x", "a..b", "a\n", "x:token", " x"] {
            let input = SearchInput {
                provider: Provider::Github,
                host: "github.com".into(),
                query: query.into(),
                page: 1,
            };
            assert!(search_body(&input).is_err(), "{query}");
        }
        let mut input = SearchInput {
            provider: Provider::Github,
            host: "github.com".into(),
            query: "crm app".into(),
            page: 1,
        };
        assert!(search_body(&input).is_ok());
        input.page = 11;
        assert!(search_body(&input).is_err());
        assert!(serde_json::from_value::<LookupRequest>(json!({"serverId":"linux","request":{"provider":"github","host":"github.com","path":"org/repo","command":"id"}})).is_err());
    }
    #[test]
    fn directories_are_closed_bounded_and_immediate_children() {
        let value = json!({"path":"/projects","parentPath":null,"entries":[{"name":"crm","path":"/projects/crm"}],"truncated":false});
        assert!(validate_directories(value.clone()).is_ok());
        for path in ["/elsewhere/crm", "/projects/a/crm", "/projects/../crm"] {
            let mut wrong = value.clone();
            wrong["entries"][0]["path"] = path.into();
            assert!(validate_directories(wrong).is_err());
        }
        for path in ["relative", "/a/../b", "/a//b", "/a\n", "/a/"] {
            assert!(!valid_directory_path(path));
        }
        assert!(
            serde_json::from_value::<DirectoryRequest>(json!({"serverId":"s","path":null}))
                .is_err()
        );
    }
}
