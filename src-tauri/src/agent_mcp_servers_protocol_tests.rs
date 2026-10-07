use super::*;
use crate::agent_mcp_servers_domain::AgentMcpServerScope;
use crate::agent_task_spawner::AgentCliInvocation;
use serde_json::json;

const TIMING: McpStatusTiming = McpStatusTiming::PRODUCTION;

fn at(base: Instant, milliseconds: u64) -> Instant {
    base + Duration::from_millis(milliseconds)
}

fn line(value: Value) -> Vec<u8> {
    let mut line = serde_json::to_vec(&value).unwrap();
    line.push(b'\n');
    line
}

fn claude_success(request_id: &str, response: Value) -> Vec<u8> {
    line(json!({
        "type": "control_response",
        "response": {"subtype": "success", "request_id": request_id, "response": response},
    }))
}

fn claude_servers(request_id: &str, servers: Value) -> Vec<u8> {
    claude_success(request_id, json!({ "mcpServers": servers }))
}

fn claude_initialized() -> Vec<u8> {
    claude_success(
        CLAUDE_MCP_INITIALIZE_REQUEST_ID,
        json!({"commands": [{"name": "review"}], "pid": 4242}),
    )
}

fn written_request_id(step: McpProbeStep) -> String {
    let McpProbeStep::Write(request) = step else {
        panic!("expected a written request, got {step:?}");
    };
    assert_eq!(request.last(), Some(&b'\n'));
    assert_eq!(request.iter().filter(|byte| **byte == b'\n').count(), 1);
    let value: Value = serde_json::from_slice(&request).unwrap();
    assert_eq!(value["type"], "control_request");
    assert_eq!(value["request"], json!({"subtype": "mcp_status"}));
    assert_eq!(value.as_object().unwrap().len(), 3);
    value["request_id"].as_str().unwrap().to_string()
}

fn initialized_claude(base: Instant) -> ClaudeMcpStatusPoll {
    let mut poll = ClaudeMcpStatusPoll::new(TIMING);
    assert_eq!(poll.step(base), McpProbeStep::Wait);
    poll.observe(&claude_initialized(), base);
    poll
}

fn answer(poll: &mut ClaudeMcpStatusPoll, now: Instant, servers: &Value) -> McpProbeStep {
    let step = poll.step(now);
    if let McpProbeStep::Write(_) = &step {
        let request_id = written_request_id(step.clone());
        poll.observe(&claude_servers(&request_id, servers.clone()), now);
    }
    step
}

fn answer_every_100ms(
    poll: &mut ClaudeMcpStatusPoll,
    base: Instant,
    range: std::ops::Range<u64>,
    servers: &Value,
) -> u64 {
    range
        .step_by(100)
        .filter(|milliseconds| {
            matches!(
                answer(poll, at(base, *milliseconds), servers),
                McpProbeStep::Write(_)
            )
        })
        .count() as u64
}

fn statuses(snapshot: &AgentMcpServers) -> Vec<(&str, AgentMcpServerStatus)> {
    snapshot
        .servers
        .iter()
        .map(|server| (server.name.as_str(), server.status))
        .collect()
}

fn codex_entry(name: &str) -> Value {
    json!({
        "name": name,
        "runtimeStatus": null,
        "pluginId": null,
        "httpOrigin": null,
        "serverInfo": {"name": name},
        "tools": {"search": {"name": "search", "inputSchema": {"type": "object"}}},
        "toolsError": null,
        "authStatus": "unsupported",
    })
}

fn requested_codex() -> CodexMcpStatusRequest {
    let mut request = CodexMcpStatusRequest::new();
    assert_eq!(request.step(), McpProbeStep::Wait);
    request.observe(b"{\"id\":0,\"result\":{\"userAgent\":\"codevo_editor\"}}\n");
    assert!(matches!(request.step(), McpProbeStep::Write(_)));
    request
}

#[test]
fn the_initialize_request_is_a_single_control_request_line() {
    let value: Value = serde_json::from_str(CLAUDE_MCP_INITIALIZE_REQUEST).unwrap();
    assert_eq!(
        value,
        json!({
            "type": "control_request",
            "request_id": CLAUDE_MCP_INITIALIZE_REQUEST_ID,
            "request": {"subtype": "initialize"},
        })
    );
    assert!(CLAUDE_MCP_INITIALIZE_REQUEST.ends_with('\n'));
    assert_eq!(CLAUDE_MCP_INITIALIZE_REQUEST.matches('\n').count(), 1);
}

#[test]
fn claude_requests_status_only_after_initialize_succeeds() {
    let base = Instant::now();
    let mut poll = ClaudeMcpStatusPoll::new(TIMING);
    assert_eq!(poll.step(base), McpProbeStep::Wait);
    assert_eq!(poll.step(at(base, 5_000)), McpProbeStep::Wait);
    poll.observe(&claude_initialized(), at(base, 5_000));
    let request_id = written_request_id(poll.step(at(base, 5_000)));
    assert_eq!(request_id, claude_mcp_status_request_id(1));
    assert_eq!(poll.step(at(base, 9_000)), McpProbeStep::Wait);
    assert!(!poll.is_done());
    assert_eq!(poll.take_snapshot(), None);
}

#[test]
fn claude_fails_when_initialize_is_rejected() {
    let base = Instant::now();
    let mut poll = ClaudeMcpStatusPoll::new(TIMING);
    poll.observe(
        &line(json!({
            "type": "control_response",
            "response": {"subtype": "error", "request_id": CLAUDE_MCP_INITIALIZE_REQUEST_ID, "error": "nope"},
        })),
        base,
    );
    assert_eq!(
        poll.step(base),
        McpProbeStep::Failed(HANDSHAKE_ERROR.to_string())
    );
    assert!(!poll.is_done());
}

#[test]
fn claude_polls_again_while_a_server_is_pending_and_settles_once_stable() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(&claude_servers(&first, json!([])), at(base, 100));
    assert_eq!(poll.step(at(base, 400)), McpProbeStep::Wait);
    let second = written_request_id(poll.step(at(base, 500)));
    assert_ne!(second, first);
    poll.observe(
        &claude_servers(
            &second,
            json!([
                {"name": "docs", "status": "pending", "config": {"type": "http", "url": "https://docs.example/mcp"}, "scope": "user"},
                {"name": "gmail", "status": "needs-auth", "scope": "claudeai"},
            ]),
        ),
        at(base, 600),
    );
    assert_eq!(poll.step(at(base, 999)), McpProbeStep::Wait);
    let third = written_request_id(poll.step(at(base, 1_000)));
    poll.observe(
        &claude_servers(
            &third,
            json!([
                {"name": "docs", "status": "pending", "config": {"type": "http", "url": "https://docs.example/mcp"}, "scope": "user"},
                {"name": "gmail", "status": "needs-auth", "scope": "claudeai"},
            ]),
        ),
        at(base, 1_100),
    );
    let settled = json!([
        {"name": "docs", "status": "connected", "config": {"type": "http", "url": "https://docs.example/mcp"}, "scope": "user", "tools": [{"name": "search"}]},
        {"name": "gmail", "status": "needs-auth", "scope": "claudeai"},
    ]);
    assert_eq!(
        answer_every_100ms(&mut poll, base, 4_000..6_000, &settled),
        4
    );
    assert!(!poll.is_done());
    assert!(matches!(
        answer(&mut poll, at(base, 6_000), &settled),
        McpProbeStep::Write(_)
    ));
    assert!(!poll.is_done());
    assert_eq!(poll.step(at(base, 6_000)), McpProbeStep::Done);
    assert!(poll.is_done());
    assert_eq!(poll.step(at(base, 9_000)), McpProbeStep::Done);
    let snapshot = poll.take_snapshot().expect("snapshot");
    assert_eq!(snapshot.provider, AgentCliInvocation::ClaudeCode);
    assert!(!snapshot.truncated);
    assert_eq!(
        statuses(&snapshot),
        [
            ("docs", AgentMcpServerStatus::Connected),
            ("gmail", AgentMcpServerStatus::NeedsAuth),
        ]
    );
    assert_eq!(snapshot.servers[0].tool_count, Some(1));
    assert_eq!(snapshot.servers[1].scope, AgentMcpServerScope::Account);
}

#[test]
fn claude_does_not_settle_on_an_early_empty_list_that_later_gains_servers() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(&claude_servers(&first, json!([])), at(base, 100));
    let late = json!([{"name": "late", "status": "connected"}]);
    assert_eq!(
        answer_every_100ms(&mut poll, base, 500..1_900, &json!([])),
        3
    );
    assert!(matches!(
        answer(&mut poll, at(base, 2_000), &late),
        McpProbeStep::Write(_)
    ));
    assert_eq!(poll.step(at(base, 2_300)), McpProbeStep::Wait);
    assert_eq!(answer_every_100ms(&mut poll, base, 2_400..4_000, &late), 3);
    assert!(!poll.is_done());
    assert!(matches!(
        answer(&mut poll, at(base, 4_000), &late),
        McpProbeStep::Write(_)
    ));
    assert_eq!(poll.step(at(base, 4_000)), McpProbeStep::Done);
    assert_eq!(
        statuses(&poll.take_snapshot().unwrap()),
        [("late", AgentMcpServerStatus::Connected)]
    );
}

#[test]
fn claude_settles_on_a_stable_empty_list() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(&claude_servers(&first, json!([])), at(base, 50));
    assert!(matches!(
        poll.step(at(base, 10_000)),
        McpProbeStep::Write(_)
    ));
    assert_eq!(poll.step(at(base, 15_000)), McpProbeStep::Wait);
    assert!(!poll.is_done());
    let mut poll = initialized_claude(base);
    assert_eq!(answer_every_100ms(&mut poll, base, 0..2_000, &json!([])), 4);
    assert!(!poll.is_done());
    assert!(matches!(
        answer(&mut poll, at(base, 2_000), &json!([])),
        McpProbeStep::Write(_)
    ));
    assert_eq!(poll.step(at(base, 2_000)), McpProbeStep::Done);
    let snapshot = poll.take_snapshot().unwrap();
    assert!(snapshot.servers.is_empty());
    assert!(!snapshot.truncated);
}

#[test]
fn claude_returns_the_latest_snapshot_at_the_deadline_with_servers_still_connecting() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let pending = json!([
        {"name": "slow", "status": "pending", "config": {"type": "stdio", "command": "/bin/sleep"}, "scope": "project"},
        {"name": "ready", "status": "connected", "scope": "user"},
    ]);
    let requests = answer_every_100ms(&mut poll, base, 0..20_000, &pending);
    assert_eq!(requests, 40);
    assert!(requests < MAX_CLAUDE_MCP_STATUS_POLLS);
    assert!(!poll.is_done());
    assert_eq!(poll.step(at(base, 20_000)), McpProbeStep::Done);
    assert_eq!(
        statuses(&poll.take_snapshot().unwrap()),
        [
            ("ready", AgentMcpServerStatus::Connected),
            ("slow", AgentMcpServerStatus::Connecting),
        ]
    );
}

#[test]
fn claude_keeps_waiting_past_the_deadline_when_no_snapshot_arrived() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    written_request_id(poll.step(base));
    assert_eq!(poll.step(at(base, 20_000)), McpProbeStep::Wait);
    assert_eq!(poll.step(at(base, 60_000)), McpProbeStep::Wait);
    assert!(!poll.is_done());
    assert_eq!(poll.take_snapshot(), None);
}

#[test]
fn claude_starts_the_settle_clock_when_a_late_initialize_is_answered() {
    let base = Instant::now();
    let mut poll = ClaudeMcpStatusPoll::new(TIMING);
    assert_eq!(poll.step(base), McpProbeStep::Wait);
    assert_eq!(poll.step(at(base, 21_000)), McpProbeStep::Wait);
    poll.observe(&claude_initialized(), at(base, 21_000));
    let pending = json!([{"name": "slow", "status": "pending"}]);
    assert!(matches!(
        answer(&mut poll, at(base, 21_000), &pending),
        McpProbeStep::Write(_)
    ));
    poll.observe(&claude_initialized(), at(base, 30_000));
    assert_eq!(
        answer_every_100ms(&mut poll, base, 21_100..41_000, &pending),
        39
    );
    assert!(!poll.is_done());
    assert_eq!(poll.step(at(base, 41_000)), McpProbeStep::Done);
    assert_eq!(
        statuses(&poll.take_snapshot().unwrap()),
        [("slow", AgentMcpServerStatus::Connecting)]
    );

    let mut settled = ClaudeMcpStatusPoll::new(TIMING);
    settled.observe(&claude_initialized(), at(base, 24_000));
    let ready = json!([{"name": "ready", "status": "connected"}]);
    assert_eq!(
        answer_every_100ms(&mut settled, base, 24_000..26_000, &ready),
        4
    );
    assert!(matches!(
        answer(&mut settled, at(base, 26_000), &ready),
        McpProbeStep::Write(_)
    ));
    assert_eq!(settled.step(at(base, 26_000)), McpProbeStep::Done);
    assert_eq!(
        statuses(&settled.take_snapshot().unwrap()),
        [("ready", AgentMcpServerStatus::Connected)]
    );
}

#[test]
fn claude_stops_polling_at_the_poll_cap_and_returns_the_latest_snapshot() {
    let base = Instant::now();
    let timing = McpStatusTiming {
        poll_interval: Duration::from_millis(1),
        stable_for: Duration::from_secs(2),
        settle_deadline: Duration::from_secs(3_600),
    };
    let mut poll = ClaudeMcpStatusPoll::new(timing);
    poll.observe(&claude_initialized(), base);
    let pending = json!([{"name": "slow", "status": "pending"}]);
    for index in 0..MAX_CLAUDE_MCP_STATUS_POLLS {
        let now = at(base, index * 10);
        let request_id = written_request_id(poll.step(now));
        assert_eq!(request_id, claude_mcp_status_request_id(index + 1));
        if index + 1 < MAX_CLAUDE_MCP_STATUS_POLLS {
            poll.observe(&claude_servers(&request_id, pending.clone()), now);
            continue;
        }
        assert_eq!(poll.step(at(base, 5_000)), McpProbeStep::Wait);
        poll.observe(
            &claude_servers(&request_id, pending.clone()),
            at(base, 5_000),
        );
    }
    assert_eq!(poll.step(at(base, 5_001)), McpProbeStep::Done);
    assert_eq!(
        statuses(&poll.take_snapshot().unwrap()),
        [("slow", AgentMcpServerStatus::Connecting)]
    );
}

#[test]
fn claude_fails_on_an_error_response_to_the_status_request() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(
        &claude_servers(&first, json!([{"name": "docs", "status": "connected"}])),
        at(base, 10),
    );
    let second = written_request_id(poll.step(at(base, 500)));
    poll.observe(
        &line(json!({
            "type": "control_response",
            "response": {"subtype": "error", "request_id": second, "error": "Unsupported control request subtype: mcp_status"},
        })),
        at(base, 510),
    );
    assert_eq!(
        poll.step(at(base, 520)),
        McpProbeStep::Failed(REQUEST_ERROR.to_string())
    );
    assert_eq!(
        poll.step(at(base, 30_000)),
        McpProbeStep::Failed(REQUEST_ERROR.to_string())
    );
    assert!(!poll.is_done());
}

#[test]
fn claude_fails_on_a_success_response_without_a_server_list() {
    for response in [
        json!({}),
        json!({"mcpServers": "none"}),
        json!({"mcpServers": {"docs": {}}}),
    ] {
        let base = Instant::now();
        let mut poll = initialized_claude(base);
        let first = written_request_id(poll.step(base));
        poll.observe(&claude_success(&first, response), base);
        assert_eq!(
            poll.step(base),
            McpProbeStep::Failed(PAYLOAD_ERROR.to_string())
        );
    }
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(
        &line(json!({
            "type": "control_response",
            "response": {"subtype": "success", "request_id": first},
        })),
        base,
    );
    assert_eq!(
        poll.step(base),
        McpProbeStep::Failed(PAYLOAD_ERROR.to_string())
    );
}

#[test]
fn claude_ignores_foreign_stale_and_decoy_lines() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    let decoy = json!([{"name": "decoy", "status": "connected"}]);
    poll.observe(b"not json\n\n{\"truncated\":\n", base);
    poll.observe(&claude_servers("someone-else", decoy.clone()), base);
    poll.observe(
        &claude_servers(&claude_mcp_status_request_id(2), decoy.clone()),
        base,
    );
    poll.observe(
        &line(json!({"type": "system", "subtype": "init", "mcp_servers": [{"name": "decoy", "status": "connected"}], "request_id": first})),
        base,
    );
    poll.observe(
        &line(json!({"type": "control_request", "response": {"subtype": "success", "request_id": first, "response": {"mcpServers": decoy}}})),
        base,
    );
    poll.observe(
        &line(json!({"type": "assistant", "message": {"content": format!("\"request_id\":\"{first}\" \"mcpServers\":[]")}})),
        base,
    );
    poll.observe(
        &line(json!({"type": "control_response", "response": {"subtype": "success", "request_id": 7, "response": {"mcpServers": decoy}}})),
        base,
    );
    poll.observe(&line(json!({"type": "control_response"})), base);
    poll.observe(
        &line(json!({"type": "control_response", "response": "text"})),
        base,
    );
    poll.observe(&line(json!([1, 2, 3])), base);
    assert_eq!(poll.step(at(base, 400)), McpProbeStep::Wait);
    assert_eq!(poll.take_snapshot(), None);

    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    poll.observe(
        &claude_servers(&first, json!([{"name": "real", "status": "connected"}])),
        at(base, 10),
    );
    poll.observe(&claude_servers(&first, decoy.clone()), at(base, 20));
    poll.observe(&claude_initialized(), at(base, 30));
    let second = written_request_id(poll.step(at(base, 500)));
    poll.observe(&claude_servers(&first, decoy), at(base, 510));
    assert_eq!(poll.step(at(base, 3_000)), McpProbeStep::Wait);
    poll.observe(
        &claude_servers(&second, json!([{"name": "real", "status": "connected"}])),
        at(base, 3_000),
    );
    assert_eq!(poll.step(at(base, 3_000)), McpProbeStep::Done);
    assert!(second.ends_with("-2"));
    assert_eq!(
        statuses(&poll.take_snapshot().unwrap()),
        [("real", AgentMcpServerStatus::Connected)]
    );
}

#[test]
fn claude_assembles_a_response_split_across_reads() {
    let base = Instant::now();
    let mut poll = ClaudeMcpStatusPoll::new(TIMING);
    let initialized = claude_initialized();
    let (head, tail) = initialized.split_at(17);
    poll.observe(head, base);
    assert_eq!(poll.step(base), McpProbeStep::Wait);
    poll.observe(tail, base);
    let first = written_request_id(poll.step(base));
    let response = claude_servers(
        &first,
        json!([{"name": "docs", "status": "failed", "error": "Connection closed"}]),
    );
    response
        .chunks(7)
        .for_each(|chunk| poll.observe(chunk, at(base, 10)));
    let snapshot = poll.take_snapshot().expect("snapshot");
    assert_eq!(
        snapshot.servers[0].detail.as_deref(),
        Some("Connection closed")
    );
}

#[test]
fn claude_fails_closed_on_an_oversized_line() {
    let base = Instant::now();
    let mut poll = initialized_claude(base);
    let first = written_request_id(poll.step(base));
    let chunk = vec![b'x'; 64 * 1024];
    let reads = MAX_CLAUDE_MCP_STATUS_LINE_BYTES / chunk.len();
    (0..reads).for_each(|_| poll.observe(&chunk, base));
    assert_eq!(poll.step(base), McpProbeStep::Wait);
    poll.observe(b"x", base);
    assert_eq!(
        poll.step(base),
        McpProbeStep::Failed(LINE_LIMIT_ERROR.to_string())
    );
    poll.observe(b"\n", base);
    poll.observe(
        &claude_servers(&first, json!([{"name": "docs", "status": "connected"}])),
        base,
    );
    assert_eq!(
        poll.step(at(base, 30_000)),
        McpProbeStep::Failed(LINE_LIMIT_ERROR.to_string())
    );
    assert_eq!(poll.take_snapshot(), None);
    assert!(!poll.is_done());
}

#[test]
fn a_line_at_the_limit_is_accepted_and_the_limit_resets_per_line() {
    let mut lines = BoundedLines::new(8);
    assert_eq!(
        lines.push(b"12345678\n1234"),
        Ok(vec![b"12345678".to_vec()])
    );
    assert_eq!(
        lines.push(b"5678\n\nab"),
        Ok(vec![b"12345678".to_vec(), Vec::new()])
    );
    assert_eq!(lines.push(b"cdefgh"), Ok(Vec::new()));
    assert_eq!(lines.push(b"i"), Err(LINE_LIMIT_ERROR.to_string()));
    assert_eq!(lines.push(b"\nok\n"), Err(LINE_LIMIT_ERROR.to_string()));
    assert!(lines.pending.is_empty());
}

#[test]
fn codex_requests_the_status_list_once_after_the_handshake() {
    let mut request = CodexMcpStatusRequest::new();
    assert_eq!(request.step(), McpProbeStep::Wait);
    request.observe(
        b"{\"method\":\"remoteControl/status/changed\",\"params\":{\"status\":\"disabled\"}}\n",
    );
    assert_eq!(request.step(), McpProbeStep::Wait);
    request.observe(b"{\"id\":0,\"result\":{\"userAgent\":\"codevo_editor\"}}\n");
    let McpProbeStep::Write(written) = request.step() else {
        panic!("expected the status request");
    };
    assert_eq!(written.last(), Some(&b'\n'));
    assert_eq!(written.iter().filter(|byte| **byte == b'\n').count(), 1);
    assert_eq!(
        serde_json::from_slice::<Value>(&written).unwrap(),
        json!({
            "method": "mcpServerStatus/list",
            "id": CODEX_MCP_STATUS_REQUEST_ID,
            "params": {"detail": "toolsAndAuthOnly", "limit": MAX_MCP_SERVERS},
        })
    );
    assert_eq!(request.step(), McpProbeStep::Wait);
    assert_eq!(request.step(), McpProbeStep::Wait);
    assert!(!request.is_done());
    assert_eq!(request.take_snapshot(), None);
}

#[test]
fn codex_ignores_interleaved_notifications_and_decoys_then_completes() {
    let mut request = CodexMcpStatusRequest::new();
    request.observe(&line(
        json!({"id": 1, "result": {"data": [codex_entry("early-decoy")]}}),
    ));
    request.observe(b"{\"id\":0,\"result\":{}}\n");
    assert!(matches!(request.step(), McpProbeStep::Write(_)));
    request.observe(b"not json\n");
    request.observe(&line(
        json!({"method": "account/updated", "params": {"authMode": "chatgpt"}}),
    ));
    request.observe(&line(json!({"id": 1, "method": "item/tool/requestUserInput", "params": {"data": [codex_entry("server-request")]}})));
    request.observe(&line(
        json!({"id": 2, "result": {"data": [codex_entry("other-id")]}}),
    ));
    request.observe(&line(
        json!({"id": "1", "result": {"data": [codex_entry("string-id")]}}),
    ));
    request.observe(&line(json!({"result": {"data": [codex_entry("no-id")]}})));
    request.observe(&line(
        json!({"id": 0, "result": {"data": [codex_entry("handshake-again")]}}),
    ));
    assert_eq!(request.step(), McpProbeStep::Wait);
    assert!(!request.is_done());
    let mut response = line(json!({
        "id": 1,
        "result": {"data": [codex_entry("docs"), codex_entry("apps")], "nextCursor": null},
    }));
    response.extend(line(
        json!({"id": 1, "result": {"data": [codex_entry("late-decoy")]}}),
    ));
    response.chunks(11).for_each(|chunk| request.observe(chunk));
    assert_eq!(request.step(), McpProbeStep::Done);
    assert!(request.is_done());
    let snapshot = request.take_snapshot().expect("snapshot");
    assert_eq!(snapshot.provider, AgentCliInvocation::CodexExec);
    assert!(!snapshot.truncated);
    assert_eq!(
        statuses(&snapshot),
        [
            ("apps", AgentMcpServerStatus::Connected),
            ("docs", AgentMcpServerStatus::Connected),
        ]
    );
    assert_eq!(snapshot.servers[0].tool_count, Some(1));
}

#[test]
fn codex_marks_a_paged_response_truncated() {
    let mut request = requested_codex();
    request.observe(&line(json!({
        "id": 1,
        "result": {"data": [codex_entry("docs")], "nextCursor": "128"},
    })));
    assert_eq!(request.step(), McpProbeStep::Done);
    let snapshot = request.take_snapshot().unwrap();
    assert!(snapshot.truncated);
    assert_eq!(
        statuses(&snapshot),
        [("docs", AgentMcpServerStatus::Connected)]
    );
}

#[test]
fn codex_fails_on_error_responses() {
    let mut handshake = CodexMcpStatusRequest::new();
    handshake.observe(b"{\"id\":0,\"error\":{\"code\":-32600,\"message\":\"Invalid request\"}}\n");
    assert_eq!(
        handshake.step(),
        McpProbeStep::Failed(HANDSHAKE_ERROR.to_string())
    );
    assert!(!handshake.is_done());

    let mut request = requested_codex();
    request.observe(
        b"{\"error\":{\"code\":-32600,\"message\":\"Invalid request: unknown variant `mcpServerStatus/list`\"},\"id\":1}\n",
    );
    assert_eq!(
        request.step(),
        McpProbeStep::Failed(REQUEST_ERROR.to_string())
    );
    request.observe(&line(
        json!({"id": 1, "result": {"data": [codex_entry("docs")]}}),
    ));
    assert_eq!(
        request.step(),
        McpProbeStep::Failed(REQUEST_ERROR.to_string())
    );
    assert!(!request.is_done());
    assert_eq!(request.take_snapshot(), None);
}

#[test]
fn codex_fails_on_a_response_without_a_server_list() {
    for response in [
        json!({"id": 1, "result": {}}),
        json!({"id": 1, "result": {"data": "none"}}),
        json!({"id": 1, "result": null}),
        json!({"id": 1}),
    ] {
        let mut request = requested_codex();
        request.observe(&line(response.clone()));
        assert_eq!(
            request.step(),
            McpProbeStep::Failed(PAYLOAD_ERROR.to_string()),
            "{response}"
        );
    }
}

#[test]
fn codex_assembles_a_large_response_and_fails_closed_above_the_line_limit() {
    let tools: serde_json::Map<String, Value> = (0..2_000)
        .map(|index| {
            (
                format!("tool-{index}"),
                json!({"name": format!("tool-{index}"), "description": "d".repeat(400), "inputSchema": {"type": "object"}}),
            )
        })
        .collect();
    let mut entry = codex_entry("codex_apps");
    entry["tools"] = Value::Object(tools);
    let response = line(json!({"id": 1, "result": {"data": [entry], "nextCursor": null}}));
    assert!(response.len() > 512 * 1024);
    assert!(response.len() < MAX_CODEX_MCP_STATUS_LINE_BYTES);
    let mut request = requested_codex();
    response
        .chunks(4096)
        .for_each(|chunk| request.observe(chunk));
    assert_eq!(request.step(), McpProbeStep::Done);
    assert_eq!(
        request.take_snapshot().unwrap().servers[0].tool_count,
        Some(2_000)
    );

    let mut request = requested_codex();
    let chunk = vec![b' '; 1024 * 1024];
    let reads = MAX_CODEX_MCP_STATUS_LINE_BYTES / chunk.len();
    (0..reads).for_each(|_| request.observe(&chunk));
    assert_eq!(request.step(), McpProbeStep::Wait);
    request.observe(b" ");
    assert_eq!(
        request.step(),
        McpProbeStep::Failed(LINE_LIMIT_ERROR.to_string())
    );
    request.observe(&line(
        json!({"id": 1, "result": {"data": [codex_entry("docs")]}}),
    ));
    assert_eq!(
        request.step(),
        McpProbeStep::Failed(LINE_LIMIT_ERROR.to_string())
    );
    assert_eq!(request.take_snapshot(), None);
}

#[test]
fn probe_failures_map_to_the_contract_errors() {
    assert_eq!(
        McpServersProbeFailure::TimedOut.message(),
        AGENT_MCP_SERVERS_TIMED_OUT_ERROR
    );
    assert_eq!(
        McpServersProbeFailure::Unavailable.message(),
        AGENT_MCP_SERVERS_UNAVAILABLE_ERROR
    );
    assert_eq!(MAX_CLAUDE_MCP_STATUS_LINE_BYTES, 2 * 1024 * 1024);
    assert_eq!(MAX_CODEX_MCP_STATUS_LINE_BYTES, 8 * 1024 * 1024);
    assert_eq!(MAX_CLAUDE_MCP_STATUS_STREAM_BYTES, 16 * 1024 * 1024);
    assert_eq!(
        MAX_CODEX_MCP_STATUS_STREAM_BYTES,
        2 * MAX_CODEX_MCP_STATUS_LINE_BYTES
    );
    assert!(TIMING.settle_deadline > TIMING.stable_for);
    assert!(TIMING.stable_for > TIMING.poll_interval);
}
