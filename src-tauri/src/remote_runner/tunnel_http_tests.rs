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
    for language in ["auto", "sk", "en", "cs"] {
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
fn mcp_server_management_http_timeouts_are_scoped_to_exact_routes() {
    use mcp_server_manage_wire::{CHANGE_TIMEOUT, LOGIN_START_TIMEOUT};
    let login = "login-0123456789";
    for provider in ["claude", "codex"] {
        let base = format!("/v1/projects/codevo-editor/mcp-servers/{provider}");
        for (method, path, timeout) in [
            ("POST", format!("{base}/changes"), Some(CHANGE_TIMEOUT)),
            ("POST", format!("{base}/logins"), Some(LOGIN_START_TIMEOUT)),
            ("GET", format!("{base}/logins/{login}"), None),
            ("POST", format!("{base}/logins/{login}/callback"), None),
            ("DELETE", format!("{base}/logins/{login}"), None),
            ("GET", format!("{base}/changes"), None),
            ("PUT", format!("{base}/logins"), None),
            ("POST", format!("{base}/changes?x=1"), None),
        ] {
            assert_eq!(request_timeout(method, &path), timeout, "{method} {path}");
        }
    }
    assert_eq!(
        request_timeout(
            "POST",
            "/v1/projects/codevo-editor/mcp-servers/gemini/changes"
        ),
        None
    );
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
    assert!(tokens.contains(&"mcpServerManagement"));
    assert!(tokens.contains(&"eventBackwardPaging"));
    assert!(tokens.contains(&"fileAttachments"));
    assert!(tokens.contains(&"folderProjects"));
    for token in tokens {
        assert_eq!(token, token.trim());
        assert!(!token.is_empty() && token.len() <= 64);
        assert!(token.as_bytes()[0].is_ascii_alphabetic());
        assert!(token.bytes().all(|b| b.is_ascii_alphanumeric()));
    }
}

#[test]
fn announced_token_count_is_pinned_below_the_runner_limit_of_sixteen() {
    const RUNNER_TOKEN_LIMIT: usize = 16;
    const INTERACTION_TOKENS: [&str; 2] = ["runtimeRequests", "interactiveApprovals"];
    let tokens: Vec<&str> = CLIENT_CAPABILITIES.split(',').collect();
    let unique: std::collections::HashSet<&str> = tokens.iter().copied().collect();
    assert_eq!(tokens.len(), 16);
    assert_eq!(unique.len(), tokens.len());
    assert!(tokens.len() <= RUNNER_TOKEN_LIMIT);
    for token in INTERACTION_TOKENS {
        assert!(tokens.contains(&token), "{token}");
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
            (prepare("POST", "/v1/tasks", None, vec![]).unwrap(), 4096),
            || {
                if checks.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
                    Ok(())
                } else {
                    Err("Runner connection changed during request.".into())
                }
            },
            || {},
            || Ok(()),
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
fn every_response_head_and_body_read_is_reported_as_inbound_evidence() {
    let (path, server) = test_server(vec![
        (200, "{\"protocolVersion\":1,\"runnerId\":\"expected\"}"),
        (200, "{\"ok\":true}"),
    ]);
    let inbound = std::sync::atomic::AtomicUsize::new(0);
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
            (prepare("GET", "/v1/tasks", None, vec![]).unwrap(), 4096),
            || Ok(()),
            || {
                inbound.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            },
            || Ok(()),
        )
        .await
    });
    assert_eq!(result.unwrap()["ok"], true);
    assert_eq!(server.join().unwrap().len(), 2);
    assert!(inbound.load(std::sync::atomic::Ordering::Relaxed) >= 4);
}
#[cfg(unix)]
#[test]
fn a_failed_exchange_reports_the_response_head_but_a_refused_connection_reports_nothing() {
    let (path, server) = test_server(vec![(503, "{}")]);
    let missing = path.with_extension("missing");
    for (socket, expected, evidence) in [
        (path, "Runner request failed (HTTP 503).", 1),
        (missing, CONNECTION_FAILED, 0),
    ] {
        let inbound = std::sync::atomic::AtomicUsize::new(0);
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(socket)
                .no_proxy()
                .build()
                .unwrap();
            request_with_authority(
                &client,
                "private-token",
                None,
                (prepare("GET", "/v1/tasks", None, vec![]).unwrap(), 4096),
                || Ok(()),
                || {
                    inbound.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                },
                || Ok(()),
            )
            .await
        });
        assert_eq!(result.unwrap_err(), expected);
        assert_eq!(inbound.load(std::sync::atomic::Ordering::Relaxed), evidence);
    }
    server.join().unwrap();
}
#[cfg(unix)]
async fn answers(
    client: &reqwest::Client,
    patience: std::time::Duration,
    within: std::time::Duration,
) -> bool {
    tokio::time::timeout(within, answered(client, patience))
        .await
        .is_ok()
}
#[cfg(unix)]
#[test]
fn a_liveness_probe_is_answered_by_any_status_and_carries_no_credentials() {
    for status in [200, 401, 404, 503] {
        let (path, server) = test_server(vec![(status, "{}")]);
        let answered = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(path)
                .no_proxy()
                .build()
                .unwrap();
            let patience = std::time::Duration::from_secs(5);
            answers(&client, patience, patience).await
        });
        assert!(answered, "{status}");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /healthz "));
        assert!(requests[0].contains("connection: close\r\n"));
        assert!(!requests[0].to_ascii_lowercase().contains("authorization"));
        assert!(!requests[0].contains("x-codevo-runner-id"));
    }
}
#[cfg(unix)]
#[test]
fn a_liveness_probe_retries_past_a_connection_that_closes_without_answering() {
    use std::os::unix::net::UnixListener;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let path = std::env::temp_dir().join(format!("cv-reprobe-{}.sock", std::process::id()));
    let listener = UnixListener::bind(&path).unwrap();
    let server = std::thread::spawn(move || {
        drop(listener.accept().unwrap());
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut byte = [0];
        while !bytes.ends_with(b"\r\n\r\n") {
            socket.read_exact(&mut byte).unwrap();
            bytes.push(byte[0]);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let started = std::time::Instant::now();
    let answered = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .unix_socket(path.clone())
            .no_proxy()
            .retry(reqwest::retry::never())
            .build()
            .unwrap();
        let patience = std::time::Duration::from_secs(20);
        answers(&client, patience, patience).await
    });
    assert!(answered);
    assert!(started.elapsed() >= PROBE_RETRY_PAUSE);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    server.join().unwrap();
    std::fs::remove_file(path).unwrap();
}
#[cfg(unix)]
#[test]
fn a_liveness_probe_keeps_trying_through_silence_and_a_refused_connection() {
    use std::os::unix::net::UnixListener;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let path = std::env::temp_dir().join(format!("cv-probe-{}.sock", std::process::id()));
    let listener = UnixListener::bind(&path).unwrap();
    let (silent, missing) = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .unix_socket(path.clone())
            .no_proxy()
            .build()
            .unwrap();
        let refused = reqwest::Client::builder()
            .unix_socket(path.with_extension("missing"))
            .no_proxy()
            .build()
            .unwrap();
        let started = std::time::Instant::now();
        let patience = std::time::Duration::from_millis(60);
        let within = PROBE_RETRY_PAUSE + patience * 2;
        let silent = answers(&client, patience, within).await;
        let missing = answers(&refused, patience, within).await;
        assert!(started.elapsed() >= within * 2);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        (silent, missing)
    });
    assert!(!silent);
    assert!(!missing);
    drop(listener);
    std::fs::remove_file(path).unwrap();
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
    let branches = "/v1/projects/storefront/git/branches";
    let task_status = "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/status";
    let task_files = "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/files";
    let refusal = git_sync_wire::refusal_error(b"{\"error\":\"git_dirty\"}").unwrap();
    let oversized = format!("{{\"error\":\"git_dirty\",\"x\":\"{}\"}}", "x".repeat(1024));
    let not_repository =
        git_sync_wire::refusal_error(b"{\"error\":\"git_not_repository\"}").unwrap();
    let oversized_not_repository = format!(
        "{{\"error\":\"git_not_repository\",\"x\":\"{}\"}}",
        "x".repeat(1024)
    );
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
        (
            "GET",
            status,
            409,
            "{\"error\":\"conflict\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "GET",
            branches,
            409,
            "{\"error\":\"git_dirty\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "GET",
            task_status,
            409,
            "{\"error\":\"busy\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "GET",
            status,
            409,
            "{\"error\":\"git_not_repository\"}",
            not_repository.as_str(),
        ),
        (
            "GET",
            branches,
            409,
            "{\"error\":\"git_not_repository\"}",
            not_repository.as_str(),
        ),
        (
            "GET",
            task_status,
            409,
            "{\"error\":\"git_not_repository\"}",
            not_repository.as_str(),
        ),
        (
            "GET",
            status,
            409,
            "{\"error\":\"git_not_repository\",\"kind\":\"folder\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "GET",
            status,
            409,
            oversized_not_repository.as_str(),
            "Runner request failed (HTTP 409).",
        ),
        (
            "POST",
            status,
            409,
            "{\"error\":\"git_not_repository\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "GET",
            task_files,
            409,
            "{\"error\":\"git_not_repository\"}",
            "Runner request failed (HTTP 409).",
        ),
        (
            "POST",
            update,
            409,
            "{\"error\":\"git_not_repository\"}",
            not_repository.as_str(),
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
struct SocketGitRunner {
    socket: std::path::PathBuf,
}
#[cfg(unix)]
impl crate::remote_runner::git_sync::GitRunnerPort for SocketGitRunner {
    fn runner_id(&self) -> &str {
        "linux-runner"
    }

    fn is_current(&self) -> bool {
        true
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String> {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .unix_socket(self.socket.clone())
                .no_proxy()
                .build()
                .unwrap();
            request(
                &client,
                "private-token",
                None,
                prepare(method, path, body, vec![])?,
                4096,
            )
            .await
        })
    }
}
#[cfg(unix)]
fn git_settled(request: Value, body: &str) -> Result<Value, String> {
    use crate::remote_runner::{canonical_wire::Canonical, git_sync};
    let request = serde_json::from_value::<Canonical<git_sync_wire::RemoteGitRequest>>(request)
        .unwrap()
        .0;
    let (socket, server) = test_server(vec![(409, body)]);
    let settled = git_sync::execute(&SocketGitRunner { socket }, &request)
        .map(|response| serde_json::to_value(response).unwrap());
    assert_eq!(server.join().unwrap().len(), 1);
    settled
}
#[cfg(unix)]
#[test]
fn a_folder_project_git_read_settles_as_not_a_repository_end_to_end() {
    let task = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
    let key = "0b9d6f3e-6a51-4c1f-8d2e-7f1a2b3c4d5e";
    let project = |operation: &str| json!({"operation": operation, "serverId": "linux", "runnerId": "linux-runner", "projectId": "storefront"});
    let reads = [
        project("projectBranches"),
        project("projectStatus"),
        json!({"operation": "threadStatus", "serverId": "linux", "runnerId": "linux-runner", "taskId": task}),
    ];
    for read in reads {
        assert_eq!(
            git_settled(read.clone(), "{\"error\":\"git_not_repository\"}"),
            Err(git_sync_wire::GIT_NOT_REPOSITORY.into()),
            "{read}"
        );
        for code in ["git_dirty", "conflict", "busy", "invalid_input"] {
            assert_eq!(
                git_settled(read.clone(), &json!({ "error": code }).to_string()),
                Err("Runner request failed (HTTP 409).".into()),
                "{read} {code}"
            );
        }
    }
    let update = json!({"operation": "projectUpdate", "serverId": "linux", "runnerId": "linux-runner", "projectId": "storefront", "idempotencyKey": key});
    for code in ["git_not_repository", "git_dirty"] {
        assert_eq!(
            git_settled(update.clone(), &json!({ "error": code }).to_string()),
            Ok(json!({ "error": code })),
            "{code}"
        );
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
