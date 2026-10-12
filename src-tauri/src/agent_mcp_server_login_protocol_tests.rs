use super::*;

const AUTH_URL: &str =
    "https://auth.example/authorize?client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A41001%2Fcallback&state=s";
const POLL: Duration = Duration::from_millis(1_500);

fn request(mode: AgentMcpServerLoginMode) -> McpLoginRequest {
    McpLoginRequest {
        name: "docs".to_string(),
        mode,
        timing: McpLoginTiming::PRODUCTION,
    }
}

fn claude(mode: AgentMcpServerLoginMode) -> McpLoginProtocol {
    McpLoginProtocol::new(AgentCliInvocation::ClaudeCode, &request(mode))
}

fn codex() -> McpLoginProtocol {
    McpLoginProtocol::new(
        AgentCliInvocation::CodexExec,
        &request(AgentMcpServerLoginMode::SignIn),
    )
}

fn line(value: Value) -> Vec<u8> {
    let mut line = value.to_string();
    line.push('\n');
    line.into_bytes()
}

fn claude_success(request_id: &str, response: Value) -> Vec<u8> {
    line(json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response },
    }))
}

fn claude_error(request_id: &str, error: &str) -> Vec<u8> {
    line(json!({
        "type": "control_response",
        "response": { "subtype": "error", "request_id": request_id, "error": error },
    }))
}

fn written(step: McpProbeStep) -> Value {
    let McpProbeStep::Write(bytes) = step else {
        panic!("expected a write, got {step:?}");
    };
    assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    serde_json::from_slice(&bytes).expect("request is one JSON line")
}

fn authenticating(mode: AgentMcpServerLoginMode, now: Instant) -> McpLoginProtocol {
    let mut login = claude(mode);
    login.observe(&claude_success(CLAUDE_MCP_INITIALIZE_REQUEST_ID, json!({})));
    let request = written(login.step(now));
    assert_eq!(
        request,
        json!({
            "type": "control_request",
            "request_id": CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
            "request": { "subtype": "mcp_authenticate", "serverName": "docs" },
        })
    );
    login
}

fn awaiting_callback(now: Instant) -> McpLoginProtocol {
    let mut login = authenticating(AgentMcpServerLoginMode::SignIn, now);
    login.observe(&claude_success(
        CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
        json!({
            "authUrl": AUTH_URL,
            "requiresUserAction": true,
            "callbackExpected": true,
            "redirectScheme": "localhost",
            "state": "s",
            "callbackPort": 41001,
        }),
    ));
    assert_eq!(
        login.take_announcement(),
        Some(Ok(McpLoginProviderStep::AwaitingCallback(
            AUTH_URL.to_string()
        )))
    );
    assert_eq!(login.take_announcement(), None);
    assert!(!login.is_ended());
    login
}

fn poll(login: &mut McpLoginProtocol, now: Instant) -> String {
    let request = written(login.step(now));
    assert_eq!(request["request"], json!({ "subtype": "mcp_status" }));
    request["request_id"]
        .as_str()
        .expect("request id")
        .to_string()
}

fn status(request_id: &str, servers: Value) -> Vec<u8> {
    claude_success(request_id, json!({ "mcpServers": servers }))
}

#[test]
fn production_timing_matches_the_contract() {
    assert_eq!(McpLoginTiming::PRODUCTION.poll_interval, POLL);
    assert_eq!(
        McpLoginTiming::PRODUCTION.deadline,
        Duration::from_secs(300)
    );
    assert_eq!(
        McpLoginTiming::PRODUCTION.step_timeout,
        Duration::from_secs(25)
    );
    assert_eq!(
        McpLoginTiming::PRODUCTION.authority_check_interval,
        Duration::from_millis(250)
    );
    assert_eq!(CODEX_MCP_LOGIN_TIMEOUT_SECS, 300);
}

#[test]
fn failures_map_to_the_closed_error_strings() {
    assert_eq!(
        McpLoginFailure::LoginUnsupported.message(),
        "This MCP server does not support sign-in."
    );
    assert_eq!(
        McpLoginFailure::ServerNotFound.message(),
        "The MCP server is not configured."
    );
    assert_eq!(
        McpLoginFailure::Inactive.message(),
        "The MCP server sign-in is no longer active."
    );
    assert_eq!(
        McpLoginFailure::TimedOut.message(),
        "Agent MCP server status check timed out."
    );
    assert_eq!(
        McpLoginFailure::Unavailable.message(),
        "Agent MCP server status is unavailable."
    );
}

#[test]
fn a_provider_step_never_prints_its_authorization_url() {
    let step = McpLoginProviderStep::AwaitingCallback(AUTH_URL.to_string());
    assert_eq!(format!("{step:?}"), "AwaitingCallback");
    let announcement: McpLoginAnnouncement =
        Ok(McpLoginProviderStep::FinishInBrowser(AUTH_URL.to_string()));
    assert!(!format!("{announcement:?}").contains("auth.example"));
}

#[test]
fn claude_waits_for_initialize_before_authenticating() {
    let now = Instant::now();
    let mut login = claude(AgentMcpServerLoginMode::SignIn);
    assert_eq!(login.step(now), McpProbeStep::Wait);
    login.observe(&claude_success(
        CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
        json!({ "requiresUserAction": false, "callbackExpected": false }),
    ));
    assert_eq!(login.step(now), McpProbeStep::Wait);
    assert_eq!(login.take_announcement(), None);
    let mut refused = claude(AgentMcpServerLoginMode::SignIn);
    refused.observe(&claude_error(CLAUDE_MCP_INITIALIZE_REQUEST_ID, "nope"));
    assert_eq!(
        refused.take_announcement(),
        Some(Err(McpLoginFailure::Unavailable))
    );
    assert_eq!(refused.step(now), McpProbeStep::Done);
    assert!(!refused.succeeded());
}

#[test]
fn claude_maps_the_three_authentication_shapes_to_steps() {
    let now = Instant::now();
    awaiting_callback(now);
    let mut browser = authenticating(AgentMcpServerLoginMode::SignIn, now);
    browser.observe(&claude_success(
        CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
        json!({ "authUrl": "https://claude.ai/connect/docs", "requiresUserAction": true, "callbackExpected": false }),
    ));
    assert_eq!(
        browser.take_announcement(),
        Some(Ok(McpLoginProviderStep::FinishInBrowser(
            "https://claude.ai/connect/docs".to_string()
        )))
    );
    assert!(browser.is_ended());
    assert_eq!(browser.step(now), McpProbeStep::Done);
    let mut completed = authenticating(AgentMcpServerLoginMode::SignIn, now);
    completed.observe(&claude_success(
        CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
        json!({ "requiresUserAction": false, "callbackExpected": false }),
    ));
    assert_eq!(
        completed.take_announcement(),
        Some(Ok(McpLoginProviderStep::Completed))
    );
    assert!(completed.is_ended());
    assert_eq!(completed.step(now), McpProbeStep::Done);
}

#[test]
fn claude_fails_closed_on_unknown_shapes_and_invalid_authorization_urls() {
    let now = Instant::now();
    for body in [
        json!({}),
        json!({ "requiresUserAction": true, "callbackExpected": true }),
        json!({ "authUrl": AUTH_URL, "requiresUserAction": true }),
        json!({ "authUrl": AUTH_URL, "callbackExpected": true }),
        json!({ "authUrl": 7, "requiresUserAction": true, "callbackExpected": true }),
        json!({ "authUrl": "http://auth.example/authorize", "requiresUserAction": true, "callbackExpected": true }),
        json!({ "authUrl": "javascript:alert(1)", "requiresUserAction": true, "callbackExpected": false }),
        json!({ "authUrl": "https://auth.example/a b", "requiresUserAction": true, "callbackExpected": true }),
        json!({ "authUrl": format!("https://auth.example/{}", "a".repeat(4096)), "requiresUserAction": true, "callbackExpected": true }),
        json!(null),
    ] {
        let mut login = authenticating(AgentMcpServerLoginMode::SignIn, now);
        login.observe(&claude_success(
            CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
            body.clone(),
        ));
        assert_eq!(
            login.take_announcement(),
            Some(Err(McpLoginFailure::Unavailable)),
            "{body}"
        );
        assert!(login.is_ended());
        assert!(!login.succeeded());
        assert_eq!(login.step(now), McpProbeStep::Done);
    }
}

#[test]
fn claude_control_errors_map_to_closed_failures() {
    let now = Instant::now();
    for (error, failure) in [
        ("Server not found: docs", McpLoginFailure::ServerNotFound),
        (
            "Server type \"stdio\" does not support OAuth authentication",
            McpLoginFailure::LoginUnsupported,
        ),
        (
            "SDK auth failed: getaddrinfo ENOTFOUND docs.example",
            McpLoginFailure::Unavailable,
        ),
    ] {
        let mut login = authenticating(AgentMcpServerLoginMode::SignIn, now);
        login.observe(&claude_error(
            CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
            error,
        ));
        assert_eq!(login.take_announcement(), Some(Err(failure)), "{error}");
        assert_eq!(login.step(now), McpProbeStep::Done);
    }
}

#[test]
fn claude_sign_in_again_clears_stored_credentials_before_authenticating() {
    let now = Instant::now();
    let mut login = claude(AgentMcpServerLoginMode::SignInAgain);
    login.observe(&claude_success(CLAUDE_MCP_INITIALIZE_REQUEST_ID, json!({})));
    assert_eq!(
        written(login.step(now)),
        json!({
            "type": "control_request",
            "request_id": CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID,
            "request": { "subtype": "mcp_clear_auth", "serverName": "docs" },
        })
    );
    assert_eq!(login.step(now), McpProbeStep::Wait);
    login.observe(&claude_success(
        CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID,
        json!({}),
    ));
    assert_eq!(
        written(login.step(now))["request"],
        json!({ "subtype": "mcp_authenticate", "serverName": "docs" })
    );
    for (error, failure) in [
        ("Server not found: docs", McpLoginFailure::ServerNotFound),
        (
            "Cannot clear auth for server type \"stdio\"",
            McpLoginFailure::LoginUnsupported,
        ),
        ("keychain is locked", McpLoginFailure::Unavailable),
    ] {
        let mut refused = claude(AgentMcpServerLoginMode::SignInAgain);
        refused.observe(&claude_success(CLAUDE_MCP_INITIALIZE_REQUEST_ID, json!({})));
        assert!(matches!(refused.step(now), McpProbeStep::Write(_)));
        refused.observe(&claude_error(CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID, error));
        assert_eq!(refused.take_announcement(), Some(Err(failure)), "{error}");
        assert_eq!(refused.step(now), McpProbeStep::Done);
    }
}

#[test]
fn claude_polls_status_at_the_interval_until_the_server_connects() {
    let start = Instant::now();
    let mut login = awaiting_callback(start);
    let first = poll(&mut login, start);
    assert_eq!(first, "codevo-mcp-server-login-status-1");
    assert_eq!(login.step(start + POLL * 2), McpProbeStep::Wait);
    login.observe(&status(
        &first,
        json!([{ "name": "other", "status": "connected" }, { "name": "docs", "status": "needs-auth" }]),
    ));
    assert!(!login.is_ended());
    assert_eq!(
        login.step(start + POLL - Duration::from_millis(1)),
        McpProbeStep::Wait
    );
    let second = poll(&mut login, start + POLL);
    assert_eq!(second, "codevo-mcp-server-login-status-2");
    login.observe(&status(
        &first,
        json!([{ "name": "docs", "status": "connected" }]),
    ));
    assert!(!login.is_ended());
    login.observe(&status(
        &second,
        json!([{ "name": "docs", "status": "pending" }]),
    ));
    let third = poll(&mut login, start + POLL * 2);
    login.observe(&status(
        &third,
        json!([{ "name": "docs", "status": "connected" }]),
    ));
    assert!(login.is_ended());
    assert!(login.succeeded());
    assert_eq!(login.step(start + POLL * 3), McpProbeStep::Done);
    assert_eq!(login.take_announcement(), None);
}

#[test]
fn claude_keeps_the_callback_listener_through_failed_statuses_until_connected() {
    let start = Instant::now();
    let mut login = awaiting_callback(start);
    let statuses = [
        "needs-auth",
        "failed",
        "pending",
        "failed",
        "disabled",
        "failed",
    ];
    for (index, status_name) in statuses.iter().enumerate() {
        let at = start + POLL * u32::try_from(index).expect("index");
        let id = poll(&mut login, at);
        login.observe(&status(
            &id,
            json!([{ "name": "docs", "status": status_name, "error": "401" }]),
        ));
        assert!(!login.is_ended(), "{status_name}");
        assert!(!login.succeeded());
        assert_eq!(login.step(at), McpProbeStep::Wait);
    }
    let at = start + POLL * 6;
    let id = poll(&mut login, at);
    login.observe(&status(
        &id,
        json!([{ "name": "docs", "status": "connected" }]),
    ));
    assert!(login.is_ended());
    assert!(login.succeeded());
}

#[test]
fn claude_keeps_polling_when_a_status_poll_is_refused_or_unreadable() {
    let start = Instant::now();
    let mut login = awaiting_callback(start);
    let replies: [fn(&str) -> Vec<u8>; 4] = [
        |id| status(id, json!("not a list")),
        |id| claude_success(id, json!({})),
        |id| claude_error(id, "session busy"),
        |id| status(id, json!([{ "name": "docs" }])),
    ];
    for (index, reply) in replies.iter().enumerate() {
        let at = start + POLL * u32::try_from(index).expect("index");
        let id = poll(&mut login, at);
        login.observe(&reply(&id));
        assert!(!login.is_ended());
        assert!(!login.succeeded());
    }
    let id = poll(&mut login, start + POLL * 4);
    login.observe(&status(
        &id,
        json!([{ "name": "docs", "status": "connected" }]),
    ));
    assert!(login.succeeded());
}

#[test]
fn claude_fails_early_only_when_the_server_disappears_or_the_stream_overflows() {
    let start = Instant::now();
    for servers in [
        json!([{ "name": "other", "status": "connected" }]),
        json!([]),
    ] {
        let mut login = awaiting_callback(start);
        let id = poll(&mut login, start);
        login.observe(&status(&id, servers));
        assert!(login.is_ended());
        assert!(!login.succeeded());
        assert_eq!(login.step(start), McpProbeStep::Done);
    }
    let mut flooded = awaiting_callback(start);
    flooded.observe(&vec![b'x'; MAX_CLAUDE_MCP_STATUS_LINE_BYTES + 1]);
    assert!(flooded.is_ended());
    assert!(!flooded.succeeded());
}

fn codex_requesting() -> McpLoginProtocol {
    let now = Instant::now();
    let mut login = codex();
    assert_eq!(login.step(now), McpProbeStep::Wait);
    login.observe(&line(
        json!({ "method": "remoteControl/status/changed", "params": {} }),
    ));
    login.observe(&line(json!({ "id": 0, "result": { "userAgent": "x" } })));
    assert_eq!(
        written(login.step(now)),
        json!({
            "method": "mcpServer/oauth/login",
            "id": CODEX_MCP_LOGIN_REQUEST_ID,
            "params": { "name": "docs", "timeoutSecs": 300 },
        })
    );
    assert_eq!(login.step(now), McpProbeStep::Wait);
    login
}

fn codex_awaiting(login_id: Value) -> McpLoginProtocol {
    let mut login = codex_requesting();
    login.observe(&line(json!({
        "id": CODEX_MCP_LOGIN_REQUEST_ID,
        "result": { "authorizationUrl": AUTH_URL, "loginId": login_id },
    })));
    assert_eq!(
        login.take_announcement(),
        Some(Ok(McpLoginProviderStep::AwaitingCallback(
            AUTH_URL.to_string()
        )))
    );
    assert!(!login.is_ended());
    assert_eq!(login.step(Instant::now()), McpProbeStep::Wait);
    login
}

fn completed(name: &str, success: bool, login_id: Value) -> Vec<u8> {
    line(json!({
        "method": "mcpServer/oauthLogin/completed",
        "params": { "name": name, "success": success, "error": null, "loginId": login_id },
    }))
}

#[test]
fn codex_succeeds_on_the_completion_notification_for_its_login() {
    let mut login = codex_awaiting(json!("login-1"));
    login.observe(&completed("other", true, json!("login-1")));
    login.observe(&completed("docs", true, json!("login-0")));
    login.observe(&line(
        json!({ "method": "mcpServer/startupStatus/updated", "params": { "name": "docs" } }),
    ));
    login.observe(&line(json!({ "id": 9, "result": {} })));
    assert!(!login.is_ended());
    login.observe(&completed("docs", true, json!("login-1")));
    assert!(login.is_ended());
    assert!(login.succeeded());
    assert_eq!(login.step(Instant::now()), McpProbeStep::Done);
}

#[test]
fn codex_fails_on_an_unsuccessful_completion() {
    let mut login = codex_awaiting(json!("login-1"));
    login.observe(&line(json!({
        "method": "mcpServer/oauthLogin/completed",
        "params": { "name": "docs", "success": false, "error": "access_denied", "loginId": "login-1" },
    })));
    assert!(login.is_ended());
    assert!(!login.succeeded());
    let mut malformed = codex_awaiting(json!("login-1"));
    malformed.observe(&line(json!({
        "method": "mcpServer/oauthLogin/completed",
        "params": { "name": "docs", "success": "yes", "loginId": "login-1" },
    })));
    assert!(malformed.is_ended());
    assert!(!malformed.succeeded());
}

#[test]
fn codex_accepts_a_completion_without_login_ids_from_older_servers() {
    let mut without_response_id = codex_awaiting(json!(null));
    without_response_id.observe(&completed("docs", true, json!("anything")));
    assert!(without_response_id.succeeded());
    let mut without_notification_id = codex_awaiting(json!("login-1"));
    without_notification_id.observe(&completed("docs", true, json!(null)));
    assert!(without_notification_id.succeeded());
}

#[test]
fn codex_maps_request_errors_and_rejects_invalid_authorization_urls() {
    for (message, failure) in [
        (
            "No MCP server named 'docs' found.",
            McpLoginFailure::ServerNotFound,
        ),
        (
            "OAuth login is only supported for streamable HTTP servers.",
            McpLoginFailure::LoginUnsupported,
        ),
        (
            "failed to login to MCP server 'docs': Registration failed",
            McpLoginFailure::Unavailable,
        ),
    ] {
        let mut login = codex_requesting();
        login.observe(&line(json!({
            "id": CODEX_MCP_LOGIN_REQUEST_ID,
            "error": { "code": -32600, "message": message },
        })));
        assert_eq!(login.take_announcement(), Some(Err(failure)), "{message}");
        assert!(login.is_ended());
        assert_eq!(login.step(Instant::now()), McpProbeStep::Done);
    }
    for result in [
        json!({}),
        json!({ "authorizationUrl": "http://auth.example/authorize", "loginId": "l" }),
        json!({ "authorizationUrl": "https://auth.example/a\nb", "loginId": "l" }),
        json!({ "authorizationUrl": ["https://auth.example"], "loginId": "l" }),
    ] {
        let mut login = codex_requesting();
        login.observe(&line(
            json!({ "id": CODEX_MCP_LOGIN_REQUEST_ID, "result": result }),
        ));
        assert_eq!(
            login.take_announcement(),
            Some(Err(McpLoginFailure::Unavailable))
        );
        assert!(login.is_ended());
        assert!(!login.succeeded());
    }
    let mut refused = codex();
    refused.observe(&line(
        json!({ "id": 0, "error": { "code": -1, "message": "no" } }),
    ));
    assert_eq!(
        refused.take_announcement(),
        Some(Err(McpLoginFailure::Unavailable))
    );
    let mut early = codex();
    early.observe(&completed("docs", true, json!(null)));
    assert!(!early.is_ended());
    let mut flooded = codex_awaiting(json!("login-1"));
    flooded.observe(&vec![b'x'; MAX_CODEX_MCP_STATUS_LINE_BYTES + 1]);
    assert!(flooded.is_ended());
    assert!(!flooded.succeeded());
}
