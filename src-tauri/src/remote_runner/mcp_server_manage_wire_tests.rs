use super::*;
use crate::agent_mcp_server_manage_domain::MAX_MCP_AUTHORIZATION_URL_BYTES;

const BASE: &str = "/v1/projects/codevo-editor/mcp-servers";
const LOGIN: &str = "login-0123456789";
const AUTHORIZATION: &str = "https://auth.example/authorize?client_id=codevo&state=abc";

fn started(step: Value) -> Value {
    json!({ "version": 1, "step": step })
}

fn awaiting(delivery: &str) -> Value {
    json!({
        "kind": "awaitingCallback",
        "loginId": LOGIN,
        "authorizationUrl": AUTHORIZATION,
        "delivery": delivery,
    })
}

fn browser(url: &str) -> Value {
    json!({ "kind": "finishInBrowser", "authorizationUrl": url })
}

fn started_error(value: Value) -> Option<&'static str> {
    parse_login_started(value).err()
}

#[test]
fn only_the_five_exact_management_routes_are_recognised() {
    for provider in ["claude", "codex"] {
        let base = format!("{BASE}/{provider}");
        for (method, path, route) in [
            ("POST", format!("{base}/changes"), Route::Change),
            ("POST", format!("{base}/logins"), Route::LoginStart),
            ("GET", format!("{base}/logins/{LOGIN}"), Route::LoginState),
            (
                "POST",
                format!("{base}/logins/{LOGIN}/callback"),
                Route::LoginCallback,
            ),
            (
                "DELETE",
                format!("{base}/logins/{LOGIN}"),
                Route::LoginCancel,
            ),
        ] {
            assert_eq!(Route::of(method, &path), Some(route), "{method} {path}");
            for other in ["GET", "POST", "PUT", "DELETE", "PATCH"] {
                if other == method {
                    continue;
                }
                assert_ne!(Route::of(other, &path), Some(route), "{other} {path}");
            }
        }
        assert_eq!(Route::of("GET", &base), None);
        assert_eq!(Route::of("POST", &base), None);
    }
    for (method, path) in [
        ("POST", format!("{BASE}/gemini/changes")),
        ("POST", format!("{BASE}/claudeCode/changes")),
        ("POST", format!("{BASE}/codex/changes/")),
        ("POST", format!("{BASE}/codex/changes?x=1")),
        ("POST", format!("{BASE}/codex/change")),
        ("PUT", format!("{BASE}/codex/changes")),
        ("GET", format!("{BASE}/codex/logins")),
        ("GET", format!("{BASE}/codex/logins/")),
        ("GET", format!("{BASE}/codex/logins/short")),
        ("GET", format!("{BASE}/codex/logins/{}", "a".repeat(65))),
        ("GET", format!("{BASE}/codex/logins/login_0123456789")),
        ("GET", format!("{BASE}/codex/logins/..%2f..%2frunner")),
        ("GET", format!("{BASE}/codex/logins/{LOGIN}?x=1")),
        ("GET", format!("{BASE}/codex/logins/{LOGIN}/callback")),
        ("POST", format!("{BASE}/codex/logins/{LOGIN}")),
        ("POST", format!("{BASE}/codex/logins/{LOGIN}/callback/")),
        ("POST", format!("{BASE}/codex/logins/{LOGIN}/callbacks")),
        ("DELETE", format!("{BASE}/codex/logins/{LOGIN}/callback")),
        (
            "POST",
            "/v1/projects/a/b/mcp-servers/codex/changes".to_string(),
        ),
        (
            "POST",
            "/v1/projects//mcp-servers/codex/changes".to_string(),
        ),
        (
            "POST",
            "/v1/projects/../mcp-servers/codex/changes".to_string(),
        ),
        ("POST", "/v1/mcp-servers/codex/changes".to_string()),
        (
            "POST",
            "/v1/projects/codevo-editor/command-catalog/codex".to_string(),
        ),
        ("GET", "/v1/runner".to_string()),
    ] {
        assert_eq!(Route::of(method, &path), None, "{method} {path}");
    }
}

#[test]
fn only_a_change_and_a_login_start_receive_a_longer_time_budget() {
    assert_eq!(CHANGE_TIMEOUT, Duration::from_secs(35));
    assert_eq!(LOGIN_START_TIMEOUT, Duration::from_secs(40));
    assert_eq!(MAX_OUTPUT, 16 * 1024);
    assert_eq!(Route::Change.timeout(), Some(CHANGE_TIMEOUT));
    assert_eq!(Route::LoginStart.timeout(), Some(LOGIN_START_TIMEOUT));
    for route in [Route::LoginState, Route::LoginCallback, Route::LoginCancel] {
        assert_eq!(route.timeout(), None, "{route:?}");
    }
}

#[test]
fn every_runner_refusal_maps_to_its_exact_contract_error() {
    let expected = [
        (
            "mcp_server_exists",
            "An MCP server with this name is already configured.",
        ),
        ("mcp_server_not_found", "The MCP server is not configured."),
        (
            "mcp_change_unsupported",
            "This MCP server cannot be changed from Codevo.",
        ),
        (
            "mcp_login_unsupported",
            "This MCP server does not support sign-in.",
        ),
        (
            "mcp_login_inactive",
            "The MCP server sign-in is no longer active.",
        ),
        (
            "mcp_callback_rejected",
            "The MCP server sign-in did not accept this address.",
        ),
        ("invalid_input", "Agent MCP server request is invalid."),
        ("busy", "Agent MCP server status check is already running."),
        (
            "storage_unavailable",
            "Agent MCP server status is unavailable.",
        ),
    ];
    assert_eq!(expected.len(), RunnerRefusal::ALL.len());
    for ((code, error), refusal) in expected.into_iter().zip(RunnerRefusal::ALL) {
        let body = json!({ "error": code }).to_string();
        assert_eq!(
            RunnerRefusal::from_body(body.as_bytes()),
            Some(refusal),
            "{code}"
        );
        assert_eq!(refusal.contract_error(), error, "{code}");
        assert_eq!(
            RunnerRefusal::from_message(refusal.message()),
            Some(refusal)
        );
        assert_ne!(refusal.message(), error, "{code}");
        assert!(!refusal.message().contains("(HTTP "), "{code}");
    }
    assert_eq!(
        CALLBACK_REJECTED,
        "The MCP server sign-in did not accept this address."
    );
    let messages: std::collections::HashSet<&str> = RunnerRefusal::ALL
        .into_iter()
        .map(RunnerRefusal::message)
        .collect();
    assert_eq!(messages.len(), RunnerRefusal::ALL.len());
    for failure in [
        "",
        "Runner MCP server status check is busy.",
        "Runner request failed (HTTP 409).",
        "The MCP server sign-in is no longer active.",
    ] {
        assert_eq!(RunnerRefusal::from_message(failure), None, "{failure:?}");
    }
}

#[test]
fn only_exact_refusal_bodies_are_management_refusals() {
    assert_eq!(
        RunnerRefusal::from_body(b" { \"error\" : \"mcp_login_inactive\" } "),
        Some(RunnerRefusal::McpLoginInactive)
    );
    for body in [
        "",
        "{}",
        "mcp_server_exists",
        "\"mcp_server_exists\"",
        "{\"error\":\"McpServerExists\"}",
        "{\"error\":\"mcpServerExists\"}",
        "{\"error\":\"not_found\"}",
        "{\"error\":\"conflict\"}",
        "{\"error\":\"too_large\"}",
        "{\"error\":\"internal_error\"}",
        "{\"error\":\"runner_identity_mismatch\"}",
        "{\"error\":\"mcp_server_exists\",\"extra\":true}",
        "{\"error\":\"mcp_callback_rejected\",\"callbackUrl\":\"http://localhost/?code=1\"}",
        "{\"error\":\"busy\",\"error\":\"busy\"}",
        "{\"error\":[\"busy\"]}",
        "{\"error\":\"busy\"",
    ] {
        assert_eq!(RunnerRefusal::from_body(body.as_bytes()), None, "{body}");
    }
}

#[test]
fn every_change_is_encoded_in_the_closed_runner_shape() {
    for change in [
        json!({ "kind": "add", "name": "docs", "scope": "local",
            "launch": { "kind": "http", "url": "https://docs.example/mcp" } }),
        json!({ "kind": "add", "name": "events", "scope": "user",
            "launch": { "kind": "sse", "url": "https://events.example/sse" } }),
        json!({ "kind": "add", "name": "files", "scope": "user",
            "launch": { "kind": "stdio", "command": "npx", "args": ["-y", "server files", ""] } }),
        json!({ "kind": "add", "name": "bare", "scope": "user",
            "launch": { "kind": "stdio", "command": "/usr/bin/server", "args": [] } }),
        json!({ "kind": "remove", "name": "docs", "scope": "project" }),
        json!({ "kind": "signOut", "name": "claude.ai Linear" }),
    ] {
        let parsed: AgentMcpServerChange = serde_json::from_value(change.clone()).unwrap();
        assert_eq!(change_body(&parsed), json!({ "change": change }));
    }
}

#[test]
fn login_and_callback_bodies_hold_exactly_the_runner_fields() {
    assert_eq!(
        login_body("docs", AgentMcpServerLoginMode::SignIn),
        json!({ "name": "docs", "mode": "signIn" })
    );
    assert_eq!(
        login_body("claude.ai Linear", AgentMcpServerLoginMode::SignInAgain),
        json!({ "name": "claude.ai Linear", "mode": "signInAgain" })
    );
    assert_eq!(
        callback_body("http://localhost:33418/callback?code=abc&state=xyz"),
        json!({ "callbackUrl": "http://localhost:33418/callback?code=abc&state=xyz" })
    );
}

#[test]
fn a_callback_address_is_a_bounded_loopback_http_url_with_a_result() {
    let longest = format!("http://localhost/callback?code={}", "a".repeat(8192 - 31));
    assert_eq!(longest.len(), MAX_CALLBACK_URL_BYTES);
    for accepted in [
        "http://localhost:33418/callback?code=abc&state=xyz",
        "http://127.0.0.1:8976/callback?state=xyz&code=abc",
        "http://localhost/callback?error=access_denied",
        "http://127.0.0.1/?code=",
        "HTTP://LOCALHOST:1234/callback?code=abc",
        longest.as_str(),
    ] {
        assert!(is_valid_callback_url(accepted), "{accepted}");
    }
    let oversized = format!("{longest}a");
    for rejected in [
        "",
        "localhost:33418/callback?code=abc",
        "https://localhost:33418/callback?code=abc",
        "http://example.com/callback?code=abc",
        "http://localhost.example.com/callback?code=abc",
        "http://127.0.0.2/callback?code=abc",
        "http://[::1]/callback?code=abc",
        "http://localhost/callback",
        "http://localhost/callback?state=xyz",
        "http://localhost/callback?codes=abc",
        "http://localhost/callback#code=abc",
        "http://localhost/callback?code=a b",
        " http://localhost/callback?code=abc",
        "http://localhost/callback?code=abc\n",
        "http://localhost/callback?code=abc\u{0}",
        "http:/localhost/callback?code=abc",
        "ftp://localhost/callback?code=abc",
        "file:///callback?code=abc",
        oversized.as_str(),
    ] {
        assert!(!is_valid_callback_url(rejected), "{rejected:?}");
    }
}

#[test]
fn an_acknowledgement_is_exactly_version_one() {
    let ack = parse_ack(json!({ "version": 1 })).expect("ack");
    assert_eq!(serde_json::to_value(ack).unwrap(), json!({ "version": 1 }));
    for value in [
        json!({ "version": 2 }),
        json!({ "version": 0 }),
        json!({ "version": "1" }),
        json!({ "version": 1.5 }),
        json!({ "version": 1, "extra": true }),
        json!({ "version": 1, "step": { "kind": "completed" } }),
        json!({}),
        json!([]),
        json!(null),
        json!("ok"),
    ] {
        assert_eq!(parse_ack(value.clone()).err(), Some(UNAVAILABLE), "{value}");
    }
}

#[test]
fn every_login_step_is_returned_in_the_local_wire_shape() {
    for step in [
        json!({ "kind": "completed" }),
        browser(AUTHORIZATION),
        browser("http://localhost:33418/authorize?state=abc"),
        browser("http://127.0.0.1:33418/authorize"),
        awaiting("paste"),
    ] {
        let parsed = parse_login_started(started(step.clone())).expect("started");
        assert_eq!(serde_json::to_value(&parsed).unwrap(), started(step));
    }
    let longest = format!(
        "https://auth.example/{}",
        "a".repeat(MAX_MCP_AUTHORIZATION_URL_BYTES - 21)
    );
    assert_eq!(longest.len(), MAX_MCP_AUTHORIZATION_URL_BYTES);
    assert!(parse_login_started(started(browser(&longest))).is_ok());
    assert_eq!(
        started_error(started(browser(&format!("{longest}a")))),
        Some(UNAVAILABLE)
    );
}

#[test]
fn a_login_start_with_an_unexpected_shape_is_unavailable() {
    let mut wrong_version = started(awaiting("paste"));
    wrong_version["version"] = 2.into();
    let mut unknown_envelope_field = started(awaiting("paste"));
    unknown_envelope_field["state"] = "pending".into();
    let mut unknown_step_field = awaiting("paste");
    unknown_step_field["callbackPort"] = 33418.into();
    let mut unknown_browser_field = browser(AUTHORIZATION);
    unknown_browser_field["loginId"] = LOGIN.into();
    let mut missing_login = awaiting("paste");
    missing_login.as_object_mut().unwrap().remove("loginId");
    let mut missing_delivery = awaiting("paste");
    missing_delivery.as_object_mut().unwrap().remove("delivery");
    let mut short_login = awaiting("paste");
    short_login["loginId"] = "short".into();
    let mut hostile_login = awaiting("paste");
    hostile_login["loginId"] = "../../../runner".into();
    for value in [
        wrong_version,
        unknown_envelope_field,
        started(unknown_step_field),
        started(unknown_browser_field),
        started(missing_login),
        started(missing_delivery),
        started(short_login),
        started(hostile_login),
        started(awaiting("automatic")),
        started(awaiting("Paste")),
        started(awaiting("")),
        started(json!({ "kind": "completed", "authorizationUrl": AUTHORIZATION })),
        started(json!({ "kind": "completed", "extra": true })),
        started(json!({ "kind": "pending" })),
        started(json!({ "kind": "Completed" })),
        started(json!({})),
        started(json!("completed")),
        json!({ "version": 1 }),
        json!({ "step": { "kind": "completed" } }),
        json!({ "version": 1, "state": "pending" }),
        json!([]),
        json!(null),
    ] {
        assert_eq!(started_error(value.clone()), Some(UNAVAILABLE), "{value}");
    }
}

#[test]
fn a_login_start_with_an_unsafe_authorization_address_is_unavailable() {
    for url in [
        "",
        "http://auth.example/authorize",
        "http://localhost.example/authorize",
        "ftp://auth.example/authorize",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://user:secret@auth.example/authorize",
        "https://auth.example/authorize?state=a b",
        "https://auth.example/authorize\n",
        "auth.example/authorize",
        "HTTPS://auth.example/authorize",
    ] {
        assert_eq!(
            started_error(started(browser(url))),
            Some(UNAVAILABLE),
            "{url:?}"
        );
        let mut step = awaiting("paste");
        step["authorizationUrl"] = url.into();
        assert_eq!(started_error(started(step)), Some(UNAVAILABLE), "{url:?}");
    }
}

#[test]
fn a_login_state_is_one_of_the_three_closed_states() {
    for state in ["pending", "succeeded", "failed"] {
        let value = json!({ "version": 1, "state": state });
        let status = parse_login_status(value.clone()).expect(state);
        assert_eq!(serde_json::to_value(status).unwrap(), value);
    }
    for value in [
        json!({ "version": 2, "state": "pending" }),
        json!({ "version": 1, "state": "Pending" }),
        json!({ "version": 1, "state": "cancelled" }),
        json!({ "version": 1, "state": null }),
        json!({ "version": 1, "state": "pending", "loginId": LOGIN }),
        json!({ "version": 1 }),
        json!({ "state": "pending" }),
        json!("pending"),
        json!(null),
    ] {
        assert_eq!(
            parse_login_status(value.clone()).err(),
            Some(UNAVAILABLE),
            "{value}"
        );
    }
}
