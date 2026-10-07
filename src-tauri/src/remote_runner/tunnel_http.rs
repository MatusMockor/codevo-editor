use super::{is_mcp_servers_route, MAX_INPUT, MCP_SERVERS_TIMEOUT};
use crate::remote_runner::git_sync_wire;
use crate::remote_runner::mcp_servers;
use base64::Engine;
use serde_json::{json, Value};

const ERROR_BODY_LIMIT: usize = 1024;

const CLIENT_CAPABILITIES: &str =
    "subagentLifecycleRetention,projectManagement,threadManagement,turnChanges,gitSync,portPreview,accountUsage,commandCatalog,speechTranscription,mcpServers";

pub(super) struct Prepared {
    method: reqwest::Method,
    path: String,
    body: Vec<u8>,
    headers: reqwest::header::HeaderMap,
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
async fn bounded_error_body(response: &mut reqwest::Response) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
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
    None
}
async fn execute(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
) -> Result<(Vec<u8>, Option<String>), String> {
    let speech = crate::remote_runner::speech::is_route(prepared.method.as_str(), &prepared.path);
    let mcp_status = is_mcp_servers_route(prepared.method.as_str(), &prepared.path);
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
        .map_err(|_| "Runner connection failed. The request outcome may be unknown.".to_string())?;
    if response.status().as_u16() == 409 && prepared.path == "/v1/runner" {
        return Err("Runner identity changed. Reconnect the server before continuing.".into());
    }
    if !response.status().is_success() {
        let status = response.status().as_u16();
        if speech {
            if status == 401 {
                return Err("Runner request failed (HTTP 401).".into());
            }
            let error = bounded_error_body(&mut response)
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
        if status == 400 {
            let fallback = "Runner request failed (HTTP 400).";
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| fallback)? {
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
            if let Some(refusal) = bounded_error_body(&mut response)
                .await
                .as_deref()
                .and_then(git_sync_wire::refusal_error)
            {
                return Err(refusal);
            }
        }
        if status == 404 && git_sync_wire::operation_route(&prepared.path) {
            return Err(git_sync_wire::GIT_OPERATION_UNKNOWN.into());
        }
        if mcp_status && status != 401 {
            if let Some(refusal) = bounded_error_body(&mut response)
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
        if chunk.len() > limit.saturating_sub(output.len()) {
            return Err("Runner response exceeds output limit.".into());
        }
        output.extend_from_slice(&chunk);
    }
    Ok((output, media))
}
#[cfg(test)]
pub(super) async fn request(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
) -> Result<Value, String> {
    request_with_authority(client, token, expected, prepared, limit, || Ok(())).await
}

pub(super) async fn request_with_authority(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
    authority: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    authority()?;
    if expected.is_some() && prepared.path != "/v1/runner" {
        let identity = execute(
            client,
            token,
            expected,
            prepare("GET", "/v1/runner", None, vec![])?,
            65536,
        )
        .await?;
        let identity: Value =
            serde_json::from_slice(&identity.0).map_err(|_| "Invalid runner identity.")?;
        if identity.get("protocolVersion").and_then(Value::as_u64) != Some(1)
            || identity.get("runnerId").and_then(Value::as_str) != expected
        {
            return Err("Runner identity changed. Reconnect the server before continuing.".into());
        }
    }
    authority()?;
    let artifact = super::super::super::artifacts::is_content_path(&prepared.path);
    let image = prepared.method == reqwest::Method::GET && limit > super::super::MAX_OUTPUT;
    let (output, media) = execute(
        client,
        token,
        expected,
        prepared,
        if image { 8 * 1024 * 1024 } else { limit },
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
mod tests {
    use super::*;
    use std::io::{Read, Write};
    #[test]
    fn text_upload_preserves_raw_bytes_and_media_type() {
        let bytes = "hello 🦀".as_bytes();
        let prepared = prepare(
            "PUT",
            "/v1/attachments/7389088c-29b8-4cec-9a15-e825e1fb2f66",
            Some(json!({"base64": base64::engine::general_purpose::STANDARD.encode(bytes)})),
            vec![("content-type".into(), "text/plain".into())],
        )
        .unwrap();
        assert_eq!(prepared.body, bytes);
        assert_eq!(prepared.headers.get("content-type").unwrap(), "text/plain");
    }

    #[test]
    fn octet_stream_upload_decodes_only_the_exact_media_type() {
        let bytes = [0_u8, 128, 255, 127];
        let body = json!({"base64": base64::engine::general_purpose::STANDARD.encode(bytes)});
        let route = "/v1/speech/transcriptions?language=sk";
        let prepared = prepare(
            "POST",
            route,
            Some(body.clone()),
            vec![("content-type".into(), "application/octet-stream".into())],
        )
        .unwrap();
        assert_eq!(prepared.path, route);
        assert_eq!(prepared.method, reqwest::Method::POST);
        assert_eq!(prepared.body, bytes);
        assert_eq!(
            prepared.headers.get("content-type").unwrap(),
            "application/octet-stream"
        );
        for media in [
            "application/octet-stream; charset=utf-8",
            "Application/octet-stream",
            "audio/pcm",
            "application/json",
        ] {
            let prepared = prepare(
                "POST",
                route,
                Some(body.clone()),
                vec![("content-type".into(), media.into())],
            )
            .unwrap();
            assert_eq!(prepared.body, serde_json::to_vec(&body).unwrap());
            assert_eq!(
                prepared.headers.get("content-type").unwrap(),
                "application/json"
            );
        }
        assert!(prepare(
            "POST",
            route,
            Some(json!({"base64":"not-base64"})),
            vec![("content-type".into(), "application/octet-stream".into())]
        )
        .is_err());
    }

    #[test]
    fn speech_http_timeout_is_scoped_to_exact_post_routes() {
        for language in ["sk", "en", "cs"] {
            let path = format!("/v1/speech/transcriptions?language={language}");
            assert_eq!(
                request_timeout("POST", &path),
                Some(std::time::Duration::from_secs(35))
            );
            assert_eq!(request_timeout("GET", &path), None);
        }
        for path in [
            "/v1/speech/transcriptions",
            "/v1/speech/transcriptions?language=de",
            "/v1/speech/transcriptions?language=sk&extra=1",
            "/v1/tasks",
        ] {
            assert_eq!(request_timeout("POST", path), None);
        }
        assert_eq!(
            request_timeout("POST", "/v1/tasks/id/steer"),
            Some(std::time::Duration::from_secs(60))
        );
    }

    #[test]
    fn mcp_server_status_http_timeout_is_scoped_to_exact_get_routes() {
        for provider in ["claude", "codex"] {
            let path = format!("/v1/projects/codevo-editor/mcp-servers/{provider}");
            assert_eq!(request_timeout("GET", &path), Some(MCP_SERVERS_TIMEOUT));
            assert_eq!(request_timeout("POST", &path), None);
            assert_eq!(request_timeout("GET", &format!("{path}?x=1")), None);
        }
        for path in [
            "/v1/projects/codevo-editor/mcp-servers/gemini",
            "/v1/projects/a/b/mcp-servers/codex",
            "/v1/projects/codevo-editor/command-catalog/codex",
            "/v1/runner",
        ] {
            assert_eq!(request_timeout("GET", path), None, "{path}");
        }
    }

    #[test]
    fn speech_errors_are_closed_strict_and_bounded() {
        for code in [
            "not_found",
            "invalid_input",
            "too_large",
            "unsupported_media",
            "busy",
            "speech_unavailable",
        ] {
            let body = serde_json::to_vec(&json!({"error":code})).unwrap();
            assert_eq!(speech_error_code(&body), Some(code));
        }
        for body in [
            b"{}".as_slice(),
            b"{\"error\":\"unknown\"}",
            b"{\"error\":\"busy\",\"extra\":true}",
            b"{\"error\":1}",
            b"{\"error\":\"busy\",\"error\":\"busy\"}",
        ] {
            assert_eq!(speech_error_code(body), None);
        }
        let oversized = format!("{{\"error\":\"busy\"}}{}", " ".repeat(ERROR_BODY_LIMIT));
        assert_eq!(speech_error_code(oversized.as_bytes()), None);
    }

    #[test]
    fn request_input_rejects_injection_and_unbounded_payloads() {
        for path in [
            "/v1/tasks\r\nx: y",
            "http://evil/v1/tasks",
            "/v1/tasks#x",
            "/v1/\\evil",
        ] {
            assert!(prepare("POST", path, None, vec![]).is_err());
        }
        assert!(prepare(
            "PATCH",
            "/v1/tasks/00000000-0000-4000-8000-000000000001/thread-metadata",
            Some(serde_json::json!({"expectedRevision":0,"pinned":true})),
            vec![]
        )
        .is_ok());
        assert!(prepare("PATCH", "/v1/tasks/../thread-metadata", None, vec![]).is_err());
        assert!(prepare("PATCH", "/v1/tasks", None, vec![]).is_err());
        assert!(prepare(
            "GET",
            "/v1/tasks",
            None,
            vec![("authorization".into(), "override".into())]
        )
        .is_err());
        assert!(prepare(
            "POST",
            "/v1/tasks",
            Some(json!("x".repeat(MAX_INPUT))),
            vec![]
        )
        .is_err());
    }

    #[test]
    fn announced_capabilities_stay_inside_the_runner_header_grammar() {
        assert!(!CLIENT_CAPABILITIES.is_empty() && CLIENT_CAPABILITIES.len() <= 512);
        assert!(CLIENT_CAPABILITIES.bytes().all(|b| (32..=126).contains(&b)));
        let tokens: Vec<&str> = CLIENT_CAPABILITIES.split(',').collect();
        assert!(tokens.len() <= 16);
        assert!(tokens.contains(&"subagentLifecycleRetention"));
        assert!(tokens.contains(&"projectManagement"));
        assert!(tokens.contains(&"threadManagement"));
        assert!(tokens.contains(&"turnChanges"));
        assert!(tokens.contains(&"gitSync"));
        assert!(tokens.contains(&"portPreview"));
        assert!(tokens.contains(&"accountUsage"));
        assert!(tokens.contains(&"commandCatalog"));
        assert!(tokens.contains(&"speechTranscription"));
        assert!(tokens.contains(&"mcpServers"));
        for token in tokens {
            assert_eq!(token, token.trim());
            assert!(!token.is_empty() && token.len() <= 64);
            assert!(token.as_bytes()[0].is_ascii_alphabetic());
            assert!(token.bytes().all(|b| b.is_ascii_alphanumeric()));
        }
    }

    #[test]
    fn history_search_accepts_maximum_encoded_unicode_with_bounded_path() {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("q", &"界".repeat(256))
            .append_pair("after", "9007199254740991")
            .append_pair("projectId", &"界".repeat(128))
            .finish();
        let path = format!("/v1/history/search?{query}");
        assert!(path.len() > 2048);
        assert!(prepare("GET", &path, None, vec![]).is_ok());
        assert!(prepare("GET", &format!("/v1/{}", "x".repeat(4092)), None, vec![]).is_ok());
        assert!(prepare("GET", &format!("/v1/{}", "x".repeat(4093)), None, vec![]).is_err());
    }

    #[cfg(unix)]
    fn test_server(
        responses: Vec<(u16, &str)>,
    ) -> (std::path::PathBuf, std::thread::JoinHandle<Vec<String>>) {
        test_server_with_media(
            responses
                .into_iter()
                .map(|(status, body)| (status, "application/json", body))
                .collect(),
        )
    }
    #[cfg(unix)]
    fn test_server_with_media(
        responses: Vec<(u16, &str, &str)>,
    ) -> (std::path::PathBuf, std::thread::JoinHandle<Vec<String>>) {
        use std::os::unix::net::UnixListener;
        let _ = rustls::crypto::ring::default_provider().install_default();
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "cv-http-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let listener = UnixListener::bind(&path).unwrap();
        let saved = path.clone();
        let responses: Vec<_> = responses
            .into_iter()
            .map(|(status, media, body)| (status, media.to_owned(), body.to_owned()))
            .collect();
        let thread = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, media, body) in responses {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                    if bytes.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: {media}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            std::fs::remove_file(saved).unwrap();
            requests
        });
        (path, thread)
    }
    #[cfg(unix)]
    #[test]
    fn pinned_identity_checked_before_mutation_and_redirect_is_not_followed() {
        for (status, body, expected_calls) in [
            (200, "{\"protocolVersion\":1,\"runnerId\":\"expected\"}", 2),
            (
                200,
                "{\"protocolVersion\":1,\"runnerId\":\"replacement\"}",
                1,
            ),
            (302, "{}", 1),
        ] {
            let mut responses = vec![(status, body)];
            if expected_calls == 2 {
                responses.push((200, "{\"ok\":true}"));
            }
            let (path, server) = test_server(responses);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(path)
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .retry(reqwest::retry::never())
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    Some("expected"),
                    prepare("POST", "/v1/tasks", None, vec![]).unwrap(),
                    4096,
                )
                .await
            });
            assert_eq!(result.is_ok(), expected_calls == 2);
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), expected_calls);
            assert!(requests[0].starts_with("GET /v1/runner "));
            assert!(requests
                .iter()
                .all(|r| r.contains("authorization: Bearer private-token")
                    && r.contains("x-codevo-runner-id: expected")
                    && r.contains("x-codevo-client-capabilities: subagentLifecycleRetention")));
            if expected_calls == 2 {
                assert!(requests[1].starts_with("POST /v1/tasks "));
            }
            if let Err(error) = result {
                assert!(!error.contains("private-token"));
            }
        }
    }
    #[cfg(unix)]
    #[test]
    fn lost_authority_after_identity_preflight_prevents_mutation() {
        let (path, server) = test_server(vec![(
            200,
            "{\"protocolVersion\":1,\"runnerId\":\"expected\"}",
        )]);
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(path)
                .no_proxy()
                .build()
                .unwrap();
            request_with_authority(
                &client,
                "private-token",
                Some("expected"),
                prepare("POST", "/v1/tasks", None, vec![]).unwrap(),
                4096,
                || {
                    if checks.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
                        Ok(())
                    } else {
                        Err("Runner connection changed during request.".into())
                    }
                },
            )
            .await
        });
        assert_eq!(
            result.unwrap_err(),
            "Runner connection changed during request."
        );
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /v1/runner "));
        assert_eq!(checks.load(std::sync::atomic::Ordering::Relaxed), 2);
    }

    #[cfg(unix)]
    #[test]
    fn speech_requests_pin_identity_and_preserve_scoped_error_codes() {
        for (method, route, status, body, expected) in [
            (
                "POST",
                "/v1/speech/transcriptions?language=sk",
                409,
                "{\"error\":\"busy\"}",
                "Runner speech transcription failed: busy (HTTP 409).",
            ),
            (
                "POST",
                "/v1/speech/transcriptions?language=en",
                503,
                "{\"error\":\"speech_unavailable\"}",
                "Runner speech transcription failed: speech_unavailable (HTTP 503).",
            ),
            (
                "POST",
                "/v1/speech/transcriptions?language=cs",
                400,
                "{\"error\":\"invalid_input\"}",
                "Runner speech transcription failed: invalid_input (HTTP 400).",
            ),
            (
                "POST",
                "/v1/speech/transcriptions?language=sk",
                409,
                "{\"error\":\"busy\",\"extra\":1}",
                "Runner request failed (HTTP 409).",
            ),
            (
                "GET",
                "/v1/speech/transcriptions?language=sk",
                409,
                "{\"error\":\"busy\"}",
                "Runner request failed (HTTP 409).",
            ),
            (
                "POST",
                "/v1/tasks",
                409,
                "{\"error\":\"busy\"}",
                "Runner request failed (HTTP 409).",
            ),
        ] {
            let (socket, server) = test_server(vec![
                (200, "{\"protocolVersion\":1,\"runnerId\":\"expected\"}"),
                (status, body),
            ]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(socket)
                    .no_proxy()
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    Some("expected"),
                    prepare(method, route, None, vec![]).unwrap(),
                    32768,
                )
                .await
            });
            assert_eq!(result.unwrap_err(), expected);
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), 2);
            assert!(requests[1].starts_with(&format!("{method} {route} ")));
            assert!(requests
                .iter()
                .all(|request| request.contains("x-codevo-runner-id: expected")));
        }
    }

    #[cfg(unix)]
    #[test]
    fn operational_conflict_is_not_reported_as_identity_replacement() {
        let (path, server) = test_server(vec![(409, "{}")]);
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(path)
                .no_proxy()
                .build()
                .unwrap();
            request(
                &client,
                "private-token",
                None,
                prepare("POST", "/v1/tasks", None, vec![]).unwrap(),
                4096,
            )
            .await
        });
        assert_eq!(result.unwrap_err(), "Runner request failed (HTTP 409).");
        server.join().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn invalid_input_has_a_bounded_fixed_message_only_for_bad_requests() {
        let mapped = "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.";
        let oversized = format!(
            "{{\"error\":\"invalid_input\",\"padding\":\"{}\"}}",
            "x".repeat(1024)
        );
        let boundary = format!("{{\"error\":\"invalid_input\"}}{}", " ".repeat(999));
        assert_eq!(boundary.len(), 1024);
        for (status, body, expected) in [
            (400, "{\"error\":\"invalid_input\"}", mapped),
            (400, boundary.as_str(), mapped),
            (
                400,
                "{\"error\":\"other\"}",
                "Runner request failed (HTTP 400).",
            ),
            (400, "{}", "Runner request failed (HTTP 400)."),
            (400, "{\"error\":", "Runner request failed (HTTP 400)."),
            (400, oversized.as_str(), "Runner request failed (HTTP 400)."),
            (
                401,
                "{\"error\":\"invalid_input\"}",
                "Runner request failed (HTTP 401).",
            ),
            (
                404,
                "{\"error\":\"invalid_input\"}",
                "Runner request failed (HTTP 404).",
            ),
            (
                409,
                "{\"error\":\"invalid_input\"}",
                "Runner request failed (HTTP 409).",
            ),
        ] {
            let (path, server) = test_server(vec![(status, body)]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(path)
                    .no_proxy()
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    None,
                    prepare("POST", "/v1/tasks", None, vec![]).unwrap(),
                    4096,
                )
                .await
            });
            assert_eq!(result.unwrap_err(), expected);
            server.join().unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn git_refusals_and_forgotten_operations_map_only_on_their_routes() {
        let update = "/v1/projects/storefront/git/update";
        let status = "/v1/projects/storefront/git/status";
        let poll = "/v1/git-operations/5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
        let refusal = git_sync_wire::refusal_error(b"{\"error\":\"git_dirty\"}").unwrap();
        let oversized = format!("{{\"error\":\"git_dirty\",\"x\":\"{}\"}}", "x".repeat(1024));
        for (method, path, status_code, body, expected) in [
            (
                "POST",
                update,
                409,
                "{\"error\":\"git_dirty\"}",
                refusal.as_str(),
            ),
            (
                "POST",
                update,
                409,
                "{\"error\":\"invalid_input\"}",
                "Runner request failed (HTTP 409).",
            ),
            (
                "POST",
                update,
                409,
                oversized.as_str(),
                "Runner request failed (HTTP 409).",
            ),
            (
                "GET",
                status,
                409,
                "{\"error\":\"git_dirty\"}",
                "Runner request failed (HTTP 409).",
            ),
            ("GET", poll, 404, "{}", git_sync_wire::GIT_OPERATION_UNKNOWN),
            (
                "GET",
                status,
                404,
                "{}",
                "Runner request failed (HTTP 404).",
            ),
            (
                "POST",
                "/v1/tasks",
                409,
                "{\"error\":\"busy\"}",
                "Runner request failed (HTTP 409).",
            ),
        ] {
            let (socket, server) = test_server(vec![(status_code, body)]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(socket)
                    .no_proxy()
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    None,
                    prepare(method, path, None, vec![]).unwrap(),
                    4096,
                )
                .await
            });
            assert_eq!(
                result.unwrap_err(),
                expected,
                "{method} {path} {status_code}"
            );
            server.join().unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn steering_uncertainty_is_not_a_definite_rejection() {
        for (body, definite) in [
            ("{\"error\":\"conflict\"}", true),
            ("{\"error\":\"delivery_uncertain\"}", false),
            ("{}", false),
        ] {
            let (path, server) = test_server(vec![(409, body)]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(path)
                    .no_proxy()
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    None,
                    prepare("POST", "/v1/tasks/id/steer", None, vec![]).unwrap(),
                    4096,
                )
                .await
            });
            assert_eq!(
                result.unwrap_err(),
                if definite {
                    "Runner request failed (HTTP 409)."
                } else {
                    "Runner steering delivery was not confirmed."
                }
            );
            server.join().unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn response_read_budget_is_enforced() {
        let (path, server) = test_server(vec![(200, "{\"tooLong\":true}")]);
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(path)
                .no_proxy()
                .build()
                .unwrap();
            request(
                &client,
                "private-token",
                None,
                prepare("GET", "/v1/tasks", None, vec![]).unwrap(),
                4,
            )
            .await
        });
        assert!(result.unwrap_err().contains("output limit"));
        server.join().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn speech_response_has_a_small_transport_budget_and_exact_success_status() {
        let large = format!("{{\"text\":\"{}\"}}", "x".repeat(32 * 1024));
        for (status, body, expected) in [
            (200, large.as_str(), "Runner response exceeds output limit."),
            (
                201,
                "{\"text\":\"hello\"}",
                "Runner request failed (HTTP 201).",
            ),
            (204, "", "Runner request failed (HTTP 204)."),
            (
                401,
                "{\"error\":\"busy\"}",
                "Runner request failed (HTTP 401).",
            ),
        ] {
            let (socket, server) = test_server(vec![(status, body)]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(socket)
                    .no_proxy()
                    .build()
                    .unwrap();
                let route = "/v1/speech/transcriptions?language=sk";
                request(
                    &client,
                    "private-token",
                    None,
                    prepare("POST", route, None, vec![]).unwrap(),
                    super::super::super::response_limit("POST", route),
                )
                .await
            });
            assert_eq!(result.unwrap_err(), expected);
            server.join().unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn account_usage_response_has_its_own_small_transport_budget() {
        let body = format!("{{\"padding\":\"{}\"}}", "x".repeat(16 * 1024));
        let (path, server) = test_server(vec![(200, body.as_str())]);
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(path)
                .no_proxy()
                .build()
                .unwrap();
            request(
                &client,
                "private-token",
                None,
                prepare("GET", "/v1/account-usage/codex", None, vec![]).unwrap(),
                super::super::super::response_limit("GET", "/v1/account-usage/codex"),
            )
            .await
        });
        assert!(result.unwrap_err().contains("output limit"));
        server.join().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn generated_binary_content_is_not_parsed_as_json_and_media_is_closed() {
        let route = "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/artifacts/7389088c-29b8-4cec-9a15-e825e1fb2f66/content";
        for (media, accepted) in [
            ("text/html; charset=utf-8", true),
            ("image/webp", true),
            ("image/svg+xml", false),
            ("application/json", false),
        ] {
            let (path, server) = test_server_with_media(vec![(200, media, "<html>preview</html>")]);
            let result = tauri::async_runtime::block_on(async {
                let client = reqwest::Client::builder()
                    .unix_socket(path)
                    .no_proxy()
                    .build()
                    .unwrap();
                request(
                    &client,
                    "private-token",
                    None,
                    prepare("GET", route, None, vec![]).unwrap(),
                    super::super::super::MAX_IMAGE_OUTPUT,
                )
                .await
            });
            if accepted {
                let result = result.unwrap();
                assert_eq!(result["mediaType"], media.split(';').next().unwrap());
                assert_eq!(
                    base64::engine::general_purpose::STANDARD
                        .decode(result["base64"].as_str().unwrap())
                        .unwrap(),
                    b"<html>preview</html>"
                );
            } else {
                assert!(result.is_err());
            }
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }
}
