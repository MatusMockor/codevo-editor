use super::{
    commands::blocking,
    service::RemoteRunnerState,
    transport::Session,
    types::{id, Server},
};
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
        let result = fetch_identity(&session, lease.server(), &path);
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        result
    })
    .await
}

fn fetch_identity(
    session: &Session,
    server: &Server,
    path: &str,
) -> Result<RepositoryIdentityResponse, String> {
    let result = match session.request(server, "GET", path, None, vec![]) {
        Err(error) if error == "Runner request failed (HTTP 404)." => {
            return Ok(RepositoryIdentityResponse {
                repository_key: None,
            });
        }
        result => result?,
    };
    parse_response(result)
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

#[cfg(all(test, unix))]
mod transport_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};

    const RUNNER_REQUEST: &str = "GET /v1/runner ";
    const IDENTITY_REQUEST: &str = "GET /v1/projects/project/repository-identity ";

    fn server() -> Server {
        Server {
            id: "fixture".into(),
            name: "Fixture".into(),
            host: "localhost".into(),
            username: "test".into(),
            port: 22,
            connected: true,
            runner_id: Some("runner".into()),
        }
    }

    fn take_request(buffer: &mut Vec<u8>) -> Option<String> {
        let end = buffer.windows(4).position(|bytes| bytes == b"\r\n\r\n")? + 4;
        let request: Vec<u8> = buffer.drain(..end).collect();
        Some(String::from_utf8_lossy(&request).into_owned())
    }

    fn response(request: &str, identity: (u16, &'static str)) -> (u16, &'static str) {
        if request.starts_with(RUNNER_REQUEST) {
            return (200, r#"{"protocolVersion":1,"runnerId":"runner"}"#);
        }
        if request.starts_with(IDENTITY_REQUEST) {
            return identity;
        }
        (500, "{}")
    }

    fn fake_runner(
        listener: UnixListener,
        identity: (u16, &'static str),
        stop: Arc<AtomicBool>,
    ) -> std::thread::JoinHandle<Vec<String>> {
        listener.set_nonblocking(true).unwrap();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut connections: Vec<(UnixStream, Vec<u8>)> = Vec::new();
            let mut requests = Vec::new();
            while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
                if let Ok((socket, _)) = listener.accept() {
                    socket.set_nonblocking(false).unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_millis(10)))
                        .unwrap();
                    connections.push((socket, Vec::new()));
                }
                for (socket, buffer) in &mut connections {
                    let mut chunk = [0; 1024];
                    let read = socket.read(&mut chunk).unwrap_or(0);
                    buffer.extend_from_slice(&chunk[..read]);
                    while let Some(request) = take_request(buffer) {
                        let (status, body) = response(&request, identity);
                        write!(
                            socket,
                            "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        )
                        .unwrap();
                        let served = request.starts_with(IDENTITY_REQUEST);
                        requests.push(request);
                        if served {
                            return requests;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            requests
        })
    }

    fn header_values<'a>(request: &'a str, name: &str) -> Vec<&'a str> {
        request
            .lines()
            .skip(1)
            .filter_map(|line| line.split_once(':'))
            .filter(|(header, _)| header.trim().eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
            .collect()
    }

    #[test]
    fn identity_lookup_reaches_runner_with_one_transport_owned_runner_header() {
        let path = RepositoryIdentityRequest {
            server_id: "fixture".into(),
            runner_id: "runner".into(),
            project_id: "project".into(),
        }
        .path()
        .unwrap();
        for (status, body, expected) in [
            (
                200,
                r#"{"repositoryKey":"github.com/org/repo"}"#,
                Some("github.com/org/repo"),
            ),
            (404, r#"{"error":"not_found"}"#, None),
        ] {
            let session = Session::fixture();
            let listener = UnixListener::bind(session.socket_path()).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let runner = fake_runner(listener, (status, body), stop.clone());
            let result = fetch_identity(&session, &server(), &path);
            stop.store(true, Ordering::Release);
            let requests = runner.join().unwrap();
            assert_eq!(
                result.map(|response| response.repository_key),
                Ok(expected.map(str::to_owned)),
                "HTTP {status}"
            );
            assert_eq!(requests.len(), 2, "HTTP {status}");
            assert!(requests[0].starts_with(RUNNER_REQUEST));
            assert!(requests[1].starts_with(IDENTITY_REQUEST));
            assert_eq!(
                header_values(&requests[1], "x-codevo-runner-id"),
                ["runner"],
                "HTTP {status}"
            );
        }
    }
}
