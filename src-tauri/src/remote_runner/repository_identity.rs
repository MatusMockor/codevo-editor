use super::{commands::blocking, service::RemoteRunnerState, types::id};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryIdentityRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryIdentityResponse {
    #[serde(deserialize_with = "required_nullable")]
    repository_key: Option<String>,
}

fn required_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

impl RepositoryIdentityRequest {
    fn path(&self) -> Result<String, String> {
        id(&self.server_id)?;
        id(&self.runner_id)?;
        id(&self.project_id)?;
        Ok(format!(
            "/v1/projects/{}/repository-identity",
            self.project_id
        ))
    }
}

#[tauri::command]
pub async fn remote_runner_repository_identity(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RepositoryIdentityRequest,
) -> Result<RepositoryIdentityResponse, String> {
    let state = state.inner().clone();
    blocking(move || {
        let path = request.path()?;
        let lease = state.connection_lease(&request.server_id)?;
        if lease.server().runner_id.as_deref() != Some(request.runner_id.as_str()) {
            return Err("Remote repository owner changed".into());
        }
        let session = lease.session()?;
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        let result = session.request(
            lease.server(),
            "GET",
            &path,
            None,
            vec![("x-codevo-runner-id".into(), request.runner_id)],
        );
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        let result = match result {
            Err(error) if error == "Runner request failed (HTTP 404)." => {
                return Ok(RepositoryIdentityResponse {
                    repository_key: None,
                });
            }
            result => result?,
        };
        parse_response(result)
    })
    .await
}

fn parse_response(result: serde_json::Value) -> Result<RepositoryIdentityResponse, String> {
    let response: RepositoryIdentityResponse = serde_json::from_value(result)
        .map_err(|_| "Invalid remote repository identity response")?;
    if response.repository_key.as_ref().is_some_and(|key| {
        ["ssh", "https"].iter().all(|scheme| {
            crate::repository_identity::canonical_identity(&format!("{scheme}://{key}")).as_deref()
                != Some(key.as_str())
        })
    }) {
        return Err("Invalid remote repository identity response".into());
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validates_nullable_canonical_identity() {
        assert!(parse_response(json!({"repositoryKey": null})).is_ok());
        for key in [
            "github.com/org/repo",
            "example.com:22/Org/repo",
            "example.com:443/Org/repo",
        ] {
            assert!(parse_response(json!({"repositoryKey": key})).is_ok());
        }
        for key in [
            "user:secret@example.com/repo",
            "example.com/../repo",
            "example.com/repo?token=x",
            "github.com/UPPER/repo",
        ] {
            assert!(parse_response(json!({"repositoryKey": key})).is_err());
        }
        assert!(parse_response(json!({})).is_err());
        assert!(parse_response(json!({"repositoryKey": null, "secret": "x"})).is_err());
    }
    #[test]
    fn exact_closed_owner_and_path() {
        let request: RepositoryIdentityRequest = serde_json::from_value(json!({
            "serverId":"server", "runnerId":"runner", "projectId":"project"
        }))
        .unwrap();
        assert_eq!(
            request.path().unwrap(),
            "/v1/projects/project/repository-identity"
        );
        for project in ["../other", "project?secret", "", "a/b"] {
            assert!(RepositoryIdentityRequest {
                server_id: "server".into(),
                runner_id: "runner".into(),
                project_id: project.into()
            }
            .path()
            .is_err());
        }
        assert!(serde_json::from_value::<RepositoryIdentityRequest>(json!({
            "serverId":"server", "runnerId":"runner", "projectId":"project", "url":"secret"
        }))
        .is_err());
        assert!(serde_json::from_value::<RepositoryIdentityResponse>(json!({})).is_err());
        assert!(serde_json::from_value::<RepositoryIdentityResponse>(json!({
            "repositoryKey":null, "url":"secret"
        }))
        .is_err());
    }
}
