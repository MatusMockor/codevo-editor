use super::MAX_INPUT;
use base64::Engine;
use serde_json::{json, Value};

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
    if !matches!(method, "GET" | "POST" | "PUT" | "DELETE")
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
    let body = if parsed
        .get("content-type")
        .is_some_and(|v| v.as_bytes().starts_with(b"image/"))
    {
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
async fn execute(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
) -> Result<(Vec<u8>, Option<String>), String> {
    let mut request = client
        .request(
            prepared.method,
            format!("http://localhost{}", prepared.path),
        )
        .headers(prepared.headers)
        .bearer_auth(token)
        .body(prepared.body);
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
pub(super) async fn request(
    client: &reqwest::Client,
    token: &str,
    expected: Option<&str>,
    prepared: Prepared,
    limit: usize,
) -> Result<Value, String> {
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
    if image {
        let media = media
            .filter(|m| {
                matches!(m.as_str(), "image/png" | "image/jpeg")
                    || (artifact
                        && matches!(
                            m.as_str(),
                            "image/webp" | "text/html" | "text/html; charset=utf-8"
                        ))
            })
            .ok_or("Invalid runner image media type.")?;
        let media = media.split(';').next().unwrap_or_default();
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
    fn request_input_rejects_injection_and_unbounded_payloads() {
        for path in [
            "/v1/tasks\r\nx: y",
            "http://evil/v1/tasks",
            "/v1/tasks#x",
            "/v1/\\evil",
        ] {
            assert!(prepare("POST", path, None, vec![]).is_err());
        }
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
        responses: Vec<(u16, &'static str)>,
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
        responses: Vec<(u16, &'static str, &'static str)>,
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
                    && r.contains("x-codevo-runner-id: expected")));
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
