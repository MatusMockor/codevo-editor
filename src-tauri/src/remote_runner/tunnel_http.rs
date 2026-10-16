use super::{is_mcp_servers_route, MAX_INPUT, MCP_SERVERS_TIMEOUT};
use crate::remote_runner::git_sync_wire;
use crate::remote_runner::mcp_device_sync_wire;
use crate::remote_runner::mcp_server_manage_wire;
use crate::remote_runner::mcp_servers;
use base64::Engine;
use serde_json::{json, Value};

const ERROR_BODY_LIMIT: usize = 1024;
pub(super) const CONNECTION_FAILED: &str =
    "Runner connection failed. The request outcome may be unknown.";
const PROBE_RETRY_PAUSE: std::time::Duration = std::time::Duration::from_millis(250);

pub(super) const CLIENT_CAPABILITIES: &str =
    "subagentLifecycleRetention,projectManagement,threadManagement,turnChanges,gitSync,portPreview,accountUsage,commandCatalog,speechTranscription,mcpServers,mcpServerManagement,eventBackwardPaging,runtimeRequests,interactiveApprovals,fileAttachments,folderProjects";
pub(super) const CLIENT_CAPABILITIES_2: &str = "mcpDeviceSync";

pub(super) struct Prepared {
    method: reqwest::Method,
    path: String,
    body: Vec<u8>,
    headers: reqwest::header::HeaderMap,
}
impl Prepared {
    pub(super) fn body_bytes(&self) -> usize {
        self.body.len()
    }
}
pub(super) fn prepare(
    method: &str,
    path: &str,
    body: Option<Value>,
    headers: Vec<(String, String)>,
) -> Result<Prepared, String> {
    let metadata_patch = method == "PATCH"
        && path
            .strip_prefix("/v1/tasks/")
            .and_then(|rest| rest.strip_suffix("/thread-metadata"))
            .is_some_and(|task| crate::remote_runner::types::uuid(task).is_ok());
    if !(matches!(method, "GET" | "POST" | "PUT" | "DELETE") || metadata_patch)
        || !(path.starts_with("/v1/") || path == "/healthz")
        || path.len() > 4096
        || path
            .bytes()
            .any(|b| !(33..=126).contains(&b) || b == b'#' || b == b'\\')
    {
        return Err("Invalid runner request.".into());
    }
    let mut parsed = reqwest::header::HeaderMap::new();
    for (name, value) in headers {
        if !matches!(
            name.to_ascii_lowercase().as_str(),
            "content-type" | "x-file-name"
        ) || value.len() > 1024
            || value.bytes().any(|b| !(32..=126).contains(&b))
        {
            return Err("Invalid runner header.".into());
        }
        parsed.insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| "Invalid runner header.")?,
            reqwest::header::HeaderValue::from_str(&value).map_err(|_| "Invalid runner header.")?,
        );
    }
    let body = if parsed.get("content-type").is_some_and(|v| {
        v.as_bytes().starts_with(b"image/")
            || v.as_bytes() == b"text/plain"
            || v.as_bytes() == b"application/octet-stream"
    }) {
        let encoded = body
            .as_ref()
            .and_then(|v| v.get("base64"))
            .and_then(Value::as_str)
            .ok_or("Invalid runner image.")?;
        if encoded.len() > MAX_INPUT {
            return Err("Runner request exceeds upload limit.".into());
        }
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid runner image.")?
    } else if let Some(body) = body {
        parsed.insert(
            "content-type",
            reqwest::header::HeaderValue::from_static("application/json"),
        );
        serde_json::to_vec(&body).map_err(|_| "Invalid runner request.")?
    } else {
        Vec::new()
    };
    if body.len() > MAX_INPUT {
        return Err("Runner request exceeds upload limit.".into());
    }
    Ok(Prepared {
        method: reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| "Invalid runner method.")?,
        path: path.into(),
        body,
        headers: parsed,
    })
}
async fn bounded_error_body(
    response: &mut reqwest::Response,
    inbound: &impl Fn(),
) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        inbound();
        if chunk.len() > ERROR_BODY_LIMIT.saturating_sub(body.len()) {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}
fn speech_error_code(body: &[u8]) -> Option<&'static str> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ErrorBody {
        error: String,
    }
    if body.len() > ERROR_BODY_LIMIT {
        return None;
    }
    let body = serde_json::from_slice::<ErrorBody>(body).ok()?;
    match body.error.as_str() {
        "not_found" => Some("not_found"),
        "invalid_input" => Some("invalid_input"),
        "too_large" => Some("too_large"),
        "unsupported_media" => Some("unsupported_media"),
        "busy" => Some("busy"),
        "speech_unavailable" => Some("speech_unavailable"),
        _ => None,
    }
}
fn request_timeout(method: &str, path: &str) -> Option<std::time::Duration> {
    if crate::remote_runner::speech::is_route(method, path) {
        return Some(std::time::Duration::from_secs(35));
    }
    if path.ends_with("/steer") {
        return Some(std::time::Duration::from_secs(60));
    }
    if is_mcp_servers_route(method, path) {
        return Some(MCP_SERVERS_TIMEOUT);
    }
    if mcp_device_sync_wire::is_route(method, path) {
        return Some(mcp_device_sync_wire::SYNC_TIMEOUT);
    }
    mcp_server_manage_wire::Route::of(method, path)?.timeout()
}
async fn execute(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
    inbound: &impl Fn(),
) -> Result<(Vec<u8>, Option<String>), String> {
    let speech = crate::remote_runner::speech::is_route(prepared.method.as_str(), &prepared.path);
    let mcp_status = is_mcp_servers_route(prepared.method.as_str(), &prepared.path);
    let mcp_management =
        mcp_server_manage_wire::Route::of(prepared.method.as_str(), &prepared.path).is_some()
            || mcp_device_sync_wire::is_route(prepared.method.as_str(), &prepared.path);
    let git_read = prepared.method == reqwest::Method::GET
        && git_sync_wire::repository_read_route(&prepared.path);
    let timeout = request_timeout(prepared.method.as_str(), &prepared.path);
    let mut request = client
        .request(
            prepared.method,
            format!("http://localhost{}", prepared.path),
        )
        .headers(prepared.headers)
        .bearer_auth(token)
        .header(
            "x-codevo-client-capabilities",
            reqwest::header::HeaderValue::from_static(CLIENT_CAPABILITIES),
        )
        .header(
            "x-codevo-client-capabilities-2",
            reqwest::header::HeaderValue::from_static(CLIENT_CAPABILITIES_2),
        )
        .body(prepared.body);
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    if let Some(id) = expected {
        request = request.header("x-codevo-runner-id", id);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| CONNECTION_FAILED.to_string())?;
    inbound();
    if response.status().as_u16() == 409 && prepared.path == "/v1/runner" {
        return Err("Runner identity changed. Reconnect the server before continuing.".into());
    }
    if !response.status().is_success() {
        let status = response.status().as_u16();
        if speech {
            if status == 401 {
                return Err("Runner request failed (HTTP 401).".into());
            }
            let error = bounded_error_body(&mut response, inbound)
                .await
                .as_deref()
                .and_then(speech_error_code);
            if let Some(error) = error {
                return Err(format!(
                    "Runner speech transcription failed: {error} (HTTP {status})."
                ));
            }
            return Err(format!("Runner request failed (HTTP {status})."));
        }
        if mcp_management && status != 401 {
            if let Some(refusal) = bounded_error_body(&mut response, inbound)
                .await
                .as_deref()
                .and_then(mcp_server_manage_wire::RunnerRefusal::from_body)
            {
                return Err(refusal.message().into());
            }
            return Err(format!("Runner request failed (HTTP {status})."));
        }
        if status == 400 {
            let fallback = "Runner request failed (HTTP 400).";
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| fallback)? {
                inbound();
                if chunk.len() > 1024_usize.saturating_sub(body.len()) {
                    return Err(fallback.into());
                }
                body.extend_from_slice(&chunk);
            }
            if serde_json::from_slice::<Value>(&body)
                .ok()
                .is_some_and(|value| {
                    value.get("error").and_then(Value::as_str) == Some("invalid_input")
                })
            {
                return Err("The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.".into());
            }
        }
        if status == 409 && prepared.path.ends_with("/steer") {
            let mut body = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Runner steering delivery was not confirmed.")?
            {
                inbound();
                if chunk.len() > 1024_usize.saturating_sub(body.len()) {
                    return Err("Runner steering delivery was not confirmed.".into());
                }
                body.extend_from_slice(&chunk);
            }
            let value = serde_json::from_slice::<Value>(&body).ok();
            if value.as_ref() != Some(&json!({"error":"conflict"})) {
                return Err("Runner steering delivery was not confirmed.".into());
            }
        }
        if status == 409 && git_sync_wire::refusable_route(&prepared.path) {
            if let Some(refusal) = bounded_error_body(&mut response, inbound)
                .await
                .as_deref()
                .and_then(git_sync_wire::refusal_error)
            {
                return Err(refusal);
            }
        }
        if status == 409 && git_read {
            if let Some(refusal) = bounded_error_body(&mut response, inbound)
                .await
                .as_deref()
                .and_then(git_sync_wire::not_repository_error)
            {
                return Err(refusal);
            }
        }
        if status == 404 && git_sync_wire::operation_route(&prepared.path) {
            return Err(git_sync_wire::GIT_OPERATION_UNKNOWN.into());
        }
        if mcp_status && status != 401 {
            if let Some(refusal) = bounded_error_body(&mut response, inbound)
                .await
                .as_deref()
                .and_then(mcp_servers::RunnerRefusal::from_body)
            {
                return Err(refusal.message().into());
            }
        }
        return Err(format!("Runner request failed (HTTP {status})."));
    }
    if speech && response.status().as_u16() != 200 {
        return Err(format!(
            "Runner request failed (HTTP {}).",
            response.status().as_u16()
        ));
    }
    let media = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Unable to read runner response.")?
    {
        inbound();
        if chunk.len() > limit.saturating_sub(output.len()) {
            return Err("Runner response exceeds output limit.".into());
        }
        output.extend_from_slice(&chunk);
    }
    Ok((output, media))
}
pub(super) async fn answered(client: &reqwest::Client, patience: std::time::Duration) {
    loop {
        let probe = client
            .get("http://localhost/healthz")
            .header(reqwest::header::CONNECTION, "close")
            .timeout(patience);
        if probe.send().await.is_ok() {
            return;
        }
        tokio::time::sleep(PROBE_RETRY_PAUSE).await;
    }
}
pub(super) async fn descriptor(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    inbound: &impl Fn(),
) -> Result<Value, String> {
    let identity = execute(
        client,
        token,
        expected,
        prepare("GET", "/v1/runner", None, vec![])?,
        65536,
        inbound,
    )
    .await?;
    let identity: Value =
        serde_json::from_slice(&identity.0).map_err(|_| "Invalid runner identity.")?;
    let runner = identity.get("runnerId").and_then(Value::as_str);
    if identity.get("protocolVersion").and_then(Value::as_u64) != Some(1)
        || expected.is_some_and(|expected| runner != Some(expected))
    {
        return Err("Runner identity changed. Reconnect the server before continuing.".into());
    }
    Ok(identity)
}

pub(super) async fn pinned_identity(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    inbound: &impl Fn(),
) -> Result<(), String> {
    if expected.is_none() {
        return Ok(());
    }
    descriptor(client, token, expected, inbound)
        .await
        .map(|_| ())
}

#[cfg(test)]
pub(super) async fn request(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
) -> Result<Value, String> {
    request_with_authority(
        client,
        token,
        expected,
        (prepared, limit),
        || Ok(()),
        || {},
        || Ok(()),
    )
    .await
}

pub(super) async fn request_with_authority(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    (prepared, limit): (Prepared, usize),
    authority: impl Fn() -> Result<(), String>,
    inbound: impl Fn(),
    claim: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    authority()?;
    if prepared.path != "/v1/runner" {
        pinned_identity(client, token, expected, &inbound).await?;
    }
    authority()?;
    claim()?;
    let artifact = super::super::super::artifacts::is_content_path(&prepared.path);
    let image = prepared.method == reqwest::Method::GET && limit > super::super::MAX_OUTPUT;
    let (output, media) = execute(
        client,
        token,
        expected,
        prepared,
        if image { 8 * 1024 * 1024 } else { limit },
        &inbound,
    )
    .await?;
    authority()?;
    if image {
        let media = media
            .filter(|m| {
                (matches!(m.as_str(), "image/png" | "image/jpeg")
                    || (!artifact && m == "text/plain"))
                    || (artifact
                        && matches!(
                            m.as_str(),
                            "image/webp" | "text/html" | "text/html; charset=utf-8"
                        ))
            })
            .ok_or("Invalid runner image media type.")?;
        let media = media.split(';').next().unwrap_or_default();
        if media == "text/plain"
            && (output.len() > 5 * 1024 * 1024
                || output.contains(&0)
                || std::str::from_utf8(&output).is_err())
        {
            return Err("Runner returned invalid text attachment.".into());
        }
        if output.is_empty()
            || (media == "text/html"
                && (output.len() > 2 * 1024 * 1024 || std::str::from_utf8(&output).is_err()))
        {
            return Err("Runner returned invalid or oversized artifact content.".into());
        }
        return Ok(
            json!({"base64":base64::engine::general_purpose::STANDARD.encode(output),"mediaType":media}),
        );
    }
    if output.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_slice(&output).map_err(|_| "Runner returned an invalid response.".into())
    }
}

#[cfg(test)]
#[path = "tunnel_http_tests.rs"]
mod tests;
