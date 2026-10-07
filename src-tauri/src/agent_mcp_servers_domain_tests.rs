use super::*;
use crate::agent_command_catalog_domain::MAX_REPOSITORY_ROOT_BYTES;
use regex::Regex;
use serde_json::{json, Value};

const CONTRACT: &[u8] = include_bytes!("../../contracts/agent-mcp-servers-wire.json");
const MARKER: &str = "MARKER_SECRET";

fn contract() -> Value {
    serde_json::from_slice(CONTRACT).unwrap()
}

fn contract_cases(key: &str) -> Vec<(String, Value)> {
    contract()[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            (
                case["name"].as_str().unwrap().to_string(),
                case["value"].clone(),
            )
        })
        .collect()
}

fn origin_pattern() -> Regex {
    Regex::new(
        contract()["limits"]["endpointOriginPattern"]
            .as_str()
            .unwrap(),
    )
    .unwrap()
}

fn claude(servers: Value) -> AgentMcpServers {
    claude_mcp_servers(&json!({ "mcpServers": servers })).expect("claude snapshot")
}

fn codex(data: Value) -> AgentMcpServers {
    codex_mcp_servers(&json!({ "data": data, "nextCursor": null })).expect("codex snapshot")
}

fn server<'a>(snapshot: &'a AgentMcpServers, name: &str) -> &'a AgentMcpServer {
    snapshot
        .servers
        .iter()
        .find(|server| server.name == name)
        .unwrap_or_else(|| panic!("server {name} is missing"))
}

fn names(snapshot: &AgentMcpServers) -> Vec<&str> {
    snapshot
        .servers
        .iter()
        .map(|server| server.name.as_str())
        .collect()
}

fn codex_entry(name: &str) -> Value {
    json!({
        "name": name,
        "runtimeStatus": null,
        "pluginId": null,
        "httpOrigin": null,
        "serverInfo": null,
        "serverCapabilities": null,
        "tools": {},
        "toolsError": null,
        "resources": [],
        "resourceTemplates": [],
        "authStatus": "unsupported",
    })
}

fn codex_with(name: &str, overrides: Value) -> Value {
    let mut entry = codex_entry(name);
    entry
        .as_object_mut()
        .unwrap()
        .extend(overrides.as_object().unwrap().clone());
    entry
}

fn all_statuses() -> Vec<AgentMcpServerStatus> {
    use AgentMcpServerStatus::*;
    let all = vec![Connected, Connecting, NeedsAuth, Failed, Disabled, Unknown];
    all.iter().for_each(|status| match status {
        Connected | Connecting | NeedsAuth | Failed | Disabled | Unknown => {}
    });
    all
}

fn all_scopes() -> Vec<AgentMcpServerScope> {
    use AgentMcpServerScope::*;
    let all = vec![User, Project, Local, Account, Plugin, Managed, Unknown];
    all.iter().for_each(|scope| match scope {
        User | Project | Local | Account | Plugin | Managed | Unknown => {}
    });
    all
}

fn all_transports() -> Vec<AgentMcpServerTransport> {
    use AgentMcpServerTransport::*;
    let all = vec![Stdio, Http, Sse, Unknown];
    all.iter().for_each(|transport| match transport {
        Stdio | Http | Sse | Unknown => {}
    });
    all
}

#[test]
fn contract_limits_match_the_domain_constants() {
    let limits = &contract()["limits"];
    assert_eq!(limits["maxServers"], json!(MAX_MCP_SERVERS));
    assert_eq!(limits["maxNameBytes"], json!(MAX_MCP_SERVER_NAME_BYTES));
    assert_eq!(
        limits["maxEndpointOriginBytes"],
        json!(MAX_MCP_ENDPOINT_ORIGIN_BYTES)
    );
    assert_eq!(limits["maxDetailBytes"], json!(MAX_MCP_DETAIL_BYTES));
    assert_eq!(limits["maxToolCount"], json!(MAX_MCP_TOOL_COUNT));
    assert_eq!(
        limits["maxRepositoryRootBytes"],
        json!(MAX_REPOSITORY_ROOT_BYTES)
    );
    assert_eq!(limits.as_object().unwrap().len(), 7);
}

#[test]
fn contract_enumerations_match_the_wire_enums() {
    let contract = contract();
    assert_eq!(contract["statuses"], json!(all_statuses()));
    assert_eq!(contract["scopes"], json!(all_scopes()));
    assert_eq!(contract["transports"], json!(all_transports()));
}

#[test]
fn contract_errors_match_the_error_constants() {
    assert_eq!(
        contract()["errors"],
        json!({
            "unknownWorkspace": AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR,
            "untrustedWorkspace": AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR,
            "providerDisabled": AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR,
            "busy": AGENT_MCP_SERVERS_BUSY_ERROR,
            "timedOut": AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
            "unavailable": AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
            "unsupportedRunner": AGENT_MCP_SERVERS_UNSUPPORTED_RUNNER_ERROR,
            "serverUnavailable": AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR,
        })
    );
}

#[test]
fn contract_requests_are_accepted_and_rejected_requests_fail_closed() {
    let accepted = contract_cases("requests");
    assert!(!accepted.is_empty());
    for (name, value) in accepted {
        let request: AgentMcpServersRequest =
            serde_json::from_value(value).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(validate_request(&request), Ok(()), "{name}");
    }
    let rejected = contract_cases("rejectedRequests");
    assert!(!rejected.is_empty());
    for (name, value) in rejected {
        let outcome = serde_json::from_value::<AgentMcpServersRequest>(value)
            .map_err(|error| error.to_string())
            .and_then(|request| validate_request(&request));
        assert!(outcome.is_err(), "{name} must be rejected");
    }
}

#[test]
fn requests_follow_the_command_catalog_root_rules() {
    let request = |root: &str| AgentMcpServersRequest {
        repository_root: root.to_string(),
        provider: AgentCliInvocation::ClaudeCode,
    };
    assert_eq!(validate_request(&request("/work/project")), Ok(()));
    let oversized = format!("/{}", "a".repeat(MAX_REPOSITORY_ROOT_BYTES));
    for root in [
        "",
        "project",
        "/work/../project",
        "/work/./project",
        "/work//project",
        "/work/project/",
        "/work/pro\nject",
        oversized.as_str(),
    ] {
        assert_eq!(
            validate_request(&request(root)).err().as_deref(),
            Some(INVALID_REQUEST_ERROR),
            "{root:?}"
        );
    }
}

#[test]
fn contract_responses_round_trip_through_the_wire_type() {
    let responses = contract_cases("responses");
    assert!(!responses.is_empty());
    for (name, value) in responses {
        let snapshot =
            parse_mcp_servers(value.clone()).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(serde_json::to_value(&snapshot).unwrap(), value, "{name}");
    }
}

#[test]
fn contract_rejected_responses_fail_closed() {
    let rejected = contract_cases("rejectedResponses");
    assert!(!rejected.is_empty());
    for (name, value) in rejected {
        assert!(parse_mcp_servers(value).is_err(), "{name} must be rejected");
    }
}

#[test]
fn claude_statuses_scopes_and_transports_map_to_the_closed_wire_enums() {
    let snapshot = claude(json!([
        {"name": "claude.ai Claude Docs", "status": "connected", "serverInfo": {"name": "Claude Docs", "version": "0.1.0"}, "config": {"type": "claudeai-proxy", "url": "https://api.anthropic.com/v1/pages/mcp", "id": "mcpsrv_014"}, "scope": "claudeai", "source": "claudeai", "tools": [{"name": "create", "annotations": {}}, {"name": "read", "annotations": {}}]},
        {"name": "claude.ai Gmail", "status": "needs-auth", "config": {"type": "claudeai-proxy", "url": "https://gmailmcp.googleapis.com/mcp/v1", "id": "mcpsrv_01T"}, "scope": "claudeai", "source": "claudeai"},
        {"name": "slow-indexer", "status": "pending", "config": {"type": "stdio", "command": "/bin/sleep", "args": ["8"]}, "scope": "local", "source": "local"},
        {"name": "broken-stdio", "status": "failed", "error": "Connection closed", "config": {"command": "/bin/false", "args": []}, "scope": "project", "source": "project"},
        {"name": "legacy-events", "status": "disabled", "config": {"type": "sse", "url": "http://127.0.0.1:8931/sse"}, "scope": "user", "source": "user"},
        {"name": "policy", "status": "connected", "config": {"type": "http", "url": "https://mcp.corp.example:8443/mcp"}, "scope": "managed", "tools": []},
        {"name": "enterprise", "status": "connected", "config": {"type": "http", "url": "https://mcp.corp.example"}, "scope": "enterprise"},
        {"name": "ide", "status": "reconnecting", "config": {"type": "ws-ide", "url": "ws://127.0.0.1:4000"}, "scope": "dynamic"},
        {"name": "typed-oddly", "status": 7, "config": {"type": 3}, "scope": null},
        {"name": "bare"},
    ]));
    assert_eq!(snapshot.version, 1);
    assert_eq!(snapshot.provider, AgentCliInvocation::ClaudeCode);
    assert!(!snapshot.truncated);
    assert_eq!(
        names(&snapshot),
        [
            "bare",
            "broken-stdio",
            "claude.ai Claude Docs",
            "claude.ai Gmail",
            "enterprise",
            "ide",
            "legacy-events",
            "policy",
            "slow-indexer",
            "typed-oddly",
        ]
    );
    assert_eq!(
        server(&snapshot, "claude.ai Claude Docs"),
        &AgentMcpServer {
            name: "claude.ai Claude Docs".to_string(),
            status: AgentMcpServerStatus::Connected,
            scope: AgentMcpServerScope::Account,
            transport: AgentMcpServerTransport::Http,
            endpoint_origin: Some("https://api.anthropic.com".to_string()),
            tool_count: Some(2),
            detail: None,
        }
    );
    assert_eq!(
        server(&snapshot, "claude.ai Gmail"),
        &AgentMcpServer {
            name: "claude.ai Gmail".to_string(),
            status: AgentMcpServerStatus::NeedsAuth,
            scope: AgentMcpServerScope::Account,
            transport: AgentMcpServerTransport::Http,
            endpoint_origin: Some("https://gmailmcp.googleapis.com".to_string()),
            tool_count: None,
            detail: None,
        }
    );
    assert_eq!(
        server(&snapshot, "slow-indexer"),
        &AgentMcpServer {
            name: "slow-indexer".to_string(),
            status: AgentMcpServerStatus::Connecting,
            scope: AgentMcpServerScope::Local,
            transport: AgentMcpServerTransport::Stdio,
            endpoint_origin: None,
            tool_count: None,
            detail: None,
        }
    );
    assert_eq!(
        server(&snapshot, "broken-stdio"),
        &AgentMcpServer {
            name: "broken-stdio".to_string(),
            status: AgentMcpServerStatus::Failed,
            scope: AgentMcpServerScope::Project,
            transport: AgentMcpServerTransport::Stdio,
            endpoint_origin: None,
            tool_count: None,
            detail: Some("Connection closed".to_string()),
        }
    );
    assert_eq!(
        server(&snapshot, "legacy-events"),
        &AgentMcpServer {
            name: "legacy-events".to_string(),
            status: AgentMcpServerStatus::Disabled,
            scope: AgentMcpServerScope::User,
            transport: AgentMcpServerTransport::Sse,
            endpoint_origin: Some("http://127.0.0.1:8931".to_string()),
            tool_count: None,
            detail: None,
        }
    );
    let policy = server(&snapshot, "policy");
    assert_eq!(policy.scope, AgentMcpServerScope::Managed);
    assert_eq!(
        policy.endpoint_origin.as_deref(),
        Some("https://mcp.corp.example:8443")
    );
    assert_eq!(policy.tool_count, Some(0));
    assert_eq!(
        server(&snapshot, "enterprise").scope,
        AgentMcpServerScope::Managed
    );
    let ide = server(&snapshot, "ide");
    assert_eq!(ide.status, AgentMcpServerStatus::Unknown);
    assert_eq!(ide.scope, AgentMcpServerScope::Unknown);
    assert_eq!(ide.transport, AgentMcpServerTransport::Unknown);
    assert_eq!(ide.endpoint_origin, None);
    let odd = server(&snapshot, "typed-oddly");
    assert_eq!(odd.status, AgentMcpServerStatus::Unknown);
    assert_eq!(odd.scope, AgentMcpServerScope::Unknown);
    assert_eq!(odd.transport, AgentMcpServerTransport::Unknown);
    let bare = server(&snapshot, "bare");
    assert_eq!(bare.status, AgentMcpServerStatus::Unknown);
    assert_eq!(bare.transport, AgentMcpServerTransport::Stdio);
    assert_eq!(validate_servers(&snapshot), Ok(()));
}

#[test]
fn codex_statuses_scopes_and_transports_map_to_the_closed_wire_enums() {
    let tools = json!({
        "search": {"name": "search", "description": "Search", "inputSchema": {"type": "object"}},
        "fetch": {"name": "fetch", "description": "Fetch", "inputSchema": {"type": "object"}},
    });
    let snapshot = codex(json!([
        codex_with(
            "codex_apps",
            json!({"httpOrigin": "https://chatgpt.com", "serverInfo": {"name": "codex-apps"}, "tools": tools, "authStatus": "bearerToken"})
        ),
        codex_with(
            "broken",
            json!({"toolsError": "MCP startup failed: handshaking with MCP server failed: connection closed: initialize response"})
        ),
        codex_with("off", json!({})),
        codex_with(
            "oauth",
            json!({"httpOrigin": "https://mcp.linear.app", "authStatus": "notLoggedIn", "toolsError": "login required"})
        ),
        codex_with(
            "plugin-docs",
            json!({"pluginId": "docs@openai", "serverInfo": {"name": "docs"}, "authStatus": "oAuth"})
        ),
        codex_with("blank-error", json!({"toolsError": "  \n"})),
        codex_with(
            "rt-connected",
            json!({"runtimeStatus": "connected", "toolsError": "ignored"})
        ),
        codex_with("rt-starting", json!({"runtimeStatus": "starting"})),
        codex_with(
            "rt-auth",
            json!({"runtimeStatus": "authenticationRequired"})
        ),
        codex_with(
            "rt-failed",
            json!({"runtimeStatus": "failed", "toolsError": "spawn failed"})
        ),
        codex_with("rt-cancelled", json!({"runtimeStatus": "cancelled"})),
        codex_with(
            "rt-disabled",
            json!({"runtimeStatus": "disabled", "serverInfo": {"name": "x"}})
        ),
        codex_with(
            "rt-not-started",
            json!({"runtimeStatus": "notStarted", "serverInfo": {"name": "x"}})
        ),
        codex_with(
            "rt-future",
            json!({"runtimeStatus": "hibernating", "authStatus": "notLoggedIn"})
        ),
        codex_with("rt-typed-oddly", json!({"runtimeStatus": 4})),
        json!({"name": "minimal"}),
    ]));
    assert_eq!(snapshot.provider, AgentCliInvocation::CodexExec);
    assert!(!snapshot.truncated);
    let status = |name: &str| server(&snapshot, name).status;
    assert_eq!(
        server(&snapshot, "codex_apps"),
        &AgentMcpServer {
            name: "codex_apps".to_string(),
            status: AgentMcpServerStatus::Connected,
            scope: AgentMcpServerScope::Unknown,
            transport: AgentMcpServerTransport::Http,
            endpoint_origin: Some("https://chatgpt.com".to_string()),
            tool_count: Some(2),
            detail: None,
        }
    );
    assert_eq!(
        server(&snapshot, "broken"),
        &AgentMcpServer {
            name: "broken".to_string(),
            status: AgentMcpServerStatus::Failed,
            scope: AgentMcpServerScope::Unknown,
            transport: AgentMcpServerTransport::Stdio,
            endpoint_origin: None,
            tool_count: Some(0),
            detail: Some(
                "MCP startup failed: handshaking with MCP server failed: connection closed: initialize response"
                    .to_string()
            ),
        }
    );
    assert_eq!(status("off"), AgentMcpServerStatus::Unknown);
    let oauth = server(&snapshot, "oauth");
    assert_eq!(oauth.status, AgentMcpServerStatus::NeedsAuth);
    assert_eq!(oauth.detail, None);
    assert_eq!(
        oauth.endpoint_origin.as_deref(),
        Some("https://mcp.linear.app")
    );
    let plugin = server(&snapshot, "plugin-docs");
    assert_eq!(plugin.status, AgentMcpServerStatus::Connected);
    assert_eq!(plugin.scope, AgentMcpServerScope::Plugin);
    assert_eq!(plugin.transport, AgentMcpServerTransport::Stdio);
    assert_eq!(status("blank-error"), AgentMcpServerStatus::Unknown);
    let connected = server(&snapshot, "rt-connected");
    assert_eq!(connected.status, AgentMcpServerStatus::Connected);
    assert_eq!(connected.detail, None);
    assert_eq!(status("rt-starting"), AgentMcpServerStatus::Connecting);
    assert_eq!(status("rt-auth"), AgentMcpServerStatus::NeedsAuth);
    let failed = server(&snapshot, "rt-failed");
    assert_eq!(failed.status, AgentMcpServerStatus::Failed);
    assert_eq!(failed.detail.as_deref(), Some("spawn failed"));
    let cancelled = server(&snapshot, "rt-cancelled");
    assert_eq!(cancelled.status, AgentMcpServerStatus::Failed);
    assert_eq!(cancelled.detail, None);
    assert_eq!(status("rt-disabled"), AgentMcpServerStatus::Disabled);
    assert_eq!(status("rt-not-started"), AgentMcpServerStatus::Unknown);
    assert_eq!(status("rt-future"), AgentMcpServerStatus::Unknown);
    assert_eq!(status("rt-typed-oddly"), AgentMcpServerStatus::Unknown);
    let minimal = server(&snapshot, "minimal");
    assert_eq!(minimal.status, AgentMcpServerStatus::Unknown);
    assert_eq!(minimal.transport, AgentMcpServerTransport::Stdio);
    assert_eq!(minimal.tool_count, None);
    assert_eq!(validate_servers(&snapshot), Ok(()));
}

#[test]
fn servers_are_sorted_by_name_in_byte_order() {
    let snapshot = claude(json!([
        {"name": "zeta"}, {"name": "alpha"}, {"name": "Zulu"}, {"name": "émile"}, {"name": "beta 2"}, {"name": "beta"},
    ]));
    assert_eq!(
        names(&snapshot),
        ["Zulu", "alpha", "beta", "beta 2", "zeta", "émile"]
    );
    assert!(!snapshot.truncated);
}

#[test]
fn invalid_and_duplicate_names_are_dropped_and_mark_the_snapshot_truncated() {
    let long = "n".repeat(MAX_MCP_SERVER_NAME_BYTES + 1);
    let widest = "n".repeat(MAX_MCP_SERVER_NAME_BYTES);
    for invalid in [
        json!({"name": ""}),
        json!({"name": " docs"}),
        json!({"name": "docs "}),
        json!({"name": "docs\nrm -rf"}),
        json!({"name": "docs\u{7f}"}),
        json!({"name": "docs\u{202e}"}),
        json!({"name": "\u{2066}docs"}),
        json!({"name": "do\u{200f}cs"}),
        json!({"name": "do\u{200e}cs\u{2069}"}),
        json!({"name": long}),
        json!({"name": 12}),
        json!({"status": "connected"}),
        json!("docs"),
        json!(null),
    ] {
        let snapshot = claude(json!([{"name": "kept", "status": "connected"}, invalid]));
        assert_eq!(names(&snapshot), ["kept"], "{invalid}");
        assert!(snapshot.truncated, "{invalid}");
        let snapshot = codex(json!([codex_entry("kept"), invalid]));
        assert_eq!(names(&snapshot), ["kept"], "{invalid}");
        assert!(snapshot.truncated, "{invalid}");
    }
    let snapshot = claude(json!([
        {"name": "docs", "status": "connected"},
        {"name": "docs", "status": "failed", "error": "second"},
        {"name": widest, "status": "connected"},
    ]));
    assert_eq!(names(&snapshot), ["docs", widest.as_str()]);
    assert_eq!(
        server(&snapshot, "docs").status,
        AgentMcpServerStatus::Connected
    );
    assert!(snapshot.truncated);
}

#[test]
fn more_servers_than_the_limit_are_truncated() {
    let entries = |count: usize| -> Vec<Value> {
        (0..count)
            .map(|index| json!({"name": format!("server-{index:04}"), "status": "connected"}))
            .collect()
    };
    let exact = claude(json!(entries(MAX_MCP_SERVERS)));
    assert_eq!(exact.servers.len(), MAX_MCP_SERVERS);
    assert!(!exact.truncated);
    let over = claude(json!(entries(MAX_MCP_SERVERS + 1)));
    assert_eq!(over.servers.len(), MAX_MCP_SERVERS);
    assert!(over.truncated);
    assert_eq!(validate_servers(&over), Ok(()));
    let codex_over = codex(json!((0..MAX_MCP_SERVERS + 5)
        .map(|index| codex_entry(&format!("server-{index:04}")))
        .collect::<Vec<_>>()));
    assert_eq!(codex_over.servers.len(), MAX_MCP_SERVERS);
    assert!(codex_over.truncated);
}

#[test]
fn a_codex_next_cursor_marks_the_snapshot_truncated() {
    let page = |cursor: Value| {
        codex_mcp_servers(&json!({"data": [codex_entry("docs")], "nextCursor": cursor})).unwrap()
    };
    assert!(page(json!("2")).truncated);
    assert!(page(json!(7)).truncated);
    assert!(!page(json!(null)).truncated);
    assert!(
        !codex_mcp_servers(&json!({"data": [codex_entry("docs")]}))
            .unwrap()
            .truncated
    );
}

#[test]
fn payloads_without_a_server_list_are_rejected() {
    for payload in [
        json!({}),
        json!({"mcpServers": null}),
        json!({"mcpServers": {}}),
        json!([]),
    ] {
        assert!(claude_mcp_servers(&payload).is_err(), "{payload}");
    }
    for payload in [
        json!({}),
        json!({"data": null}),
        json!({"data": {}}),
        json!("x"),
    ] {
        assert!(codex_mcp_servers(&payload).is_err(), "{payload}");
    }
    assert!(claude(json!([])).servers.is_empty());
    assert!(codex(json!([])).servers.is_empty());
}

#[test]
fn tool_counts_are_reported_only_when_present_and_within_the_limit() {
    let tools = |count: usize| -> Vec<Value> {
        (0..count)
            .map(|index| json!({"name": format!("tool-{index}")}))
            .collect()
    };
    let tool_map = |count: usize| -> Value {
        Value::Object(
            (0..count)
                .map(|index| (format!("tool-{index}"), json!({})))
                .collect(),
        )
    };
    let limit = MAX_MCP_TOOL_COUNT as usize;
    let snapshot = claude(json!([
        {"name": "limit", "tools": tools(limit)},
        {"name": "over", "tools": tools(limit + 1)},
        {"name": "absent"},
        {"name": "mistyped", "tools": {"a": 1}},
    ]));
    assert_eq!(
        server(&snapshot, "limit").tool_count,
        Some(MAX_MCP_TOOL_COUNT)
    );
    assert_eq!(server(&snapshot, "over").tool_count, None);
    assert_eq!(server(&snapshot, "absent").tool_count, None);
    assert_eq!(server(&snapshot, "mistyped").tool_count, None);
    let snapshot = codex(json!([
        codex_with("limit", json!({"tools": tool_map(limit)})),
        codex_with("over", json!({"tools": tool_map(limit + 1)})),
        codex_with("null", json!({"tools": null})),
        codex_with("mistyped", json!({"tools": [1, 2]})),
    ]));
    assert_eq!(
        server(&snapshot, "limit").tool_count,
        Some(MAX_MCP_TOOL_COUNT)
    );
    assert_eq!(server(&snapshot, "over").tool_count, None);
    assert_eq!(server(&snapshot, "null").tool_count, None);
    assert_eq!(server(&snapshot, "mistyped").tool_count, None);
}

#[test]
fn failure_details_are_single_line_bounded_and_only_present_for_failed_servers() {
    let detail = |status: &str, error: Value| {
        let snapshot = claude(json!([{"name": "docs", "status": status, "error": error}]));
        assert_eq!(validate_servers(&snapshot), Ok(()));
        snapshot.servers[0].detail.clone()
    };
    assert_eq!(
        detail(
            "failed",
            json!("  spawn failed\r\n\tENOENT\u{0}\u{1b}[31m  ")
        )
        .as_deref(),
        Some("spawn failed ENOENT [31m")
    );
    assert_eq!(detail("failed", json!("")), None);
    assert_eq!(detail("failed", json!(" \n\t ")), None);
    assert_eq!(detail("failed", json!(null)), None);
    assert_eq!(detail("failed", json!({"message": "nested"})), None);
    for status in ["connected", "pending", "needs-auth", "disabled", "other"] {
        assert_eq!(detail(status, json!("Connection closed")), None, "{status}");
    }
    let long = detail("failed", json!("é".repeat(400))).expect("long detail");
    assert_eq!(long.len(), MAX_MCP_DETAIL_BYTES);
    assert!(long.chars().all(|character| character == 'é'));
    let odd = detail("failed", json!(format!("a{}", "é".repeat(400)))).expect("odd detail");
    assert_eq!(odd.len(), MAX_MCP_DETAIL_BYTES - 1);
    let huge = detail("failed", json!("word ".repeat(200_000))).expect("huge detail");
    assert!(huge.len() <= MAX_MCP_DETAIL_BYTES);
    assert_eq!(huge.trim(), huge);
}

#[test]
fn urls_inside_failure_details_are_reduced_to_their_origin() {
    let detail = |error: &str| {
        let snapshot = codex(json!([codex_with("web", json!({"toolsError": error}))]));
        assert_eq!(validate_servers(&snapshot), Ok(()));
        snapshot.servers[0].detail.clone().expect("detail")
    };
    assert_eq!(
        detail("HTTP request failed: error sending request for url (http://127.0.0.1:9/mcp/path?token=MARKER_SECRET), when send initialize request"),
        "HTTP request failed: error sending request for url (http://127.0.0.1:9 when send initialize request"
    );
    assert_eq!(
        detail("dial https://user:MARKER_SECRET@Mcp.Example.com:8443/v1?key=MARKER_SECRET#MARKER_SECRET failed"),
        "dial https://mcp.example.com:8443 failed"
    );
    assert_eq!(
        detail("TypeError dialing http://REDACTED:REDACTED@127.0.0.1:9[redacted]?token=MARKER_SECRET (ECONNREFUSED)"),
        "TypeError dialing [redacted] (ECONNREFUSED)"
    );
    assert_eq!(
        detail("connect url=postgres://admin:MARKER_SECRET@db/prod and wss://h/MARKER_SECRET"),
        "connect [redacted] and [redacted]"
    );
    assert_eq!(
        detail("a=https://one.example/MARKER_SECRET,b=https://two.example/x?MARKER_SECRET"),
        "[redacted]"
    );
    assert_eq!(
        detail("see (https://one.example/MARKER_SECRET) and \"wss://h/MARKER_SECRET\""),
        "see (https://one.example and \"[redacted]"
    );
    assert_eq!(
        detail("é://MARKER_SECRET ://MARKER_SECRET"),
        "é[redacted] [redacted]"
    );
    let tail = format!(
        "{} https://tail.example/MARKER_SECRET",
        "x".repeat(MAX_RAW_DETAIL_BYTES - 30)
    );
    assert_eq!(detail(&tail), "[redacted]");
}

#[test]
fn ordinary_failure_messages_stay_readable() {
    for message in [
        "Connection closed",
        "MCP error -32000: Connection closed",
        "Connection timed out after 30000ms",
        "No such file or directory (os error 2)",
        "HTTP 401 Unauthorized",
        "SSE error: ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
        "MCP startup failed: handshaking with MCP server failed: connection closed: initialize response",
        "exited with code -1.",
        "value -0.5 rejected - retry later",
        "stdin -- closed (a -> b)",
        "fifteen abcdefghijklmno and split abcdefgh.ijklmnop runs",
    ] {
        let claude = claude(json!([{"name": "docs", "status": "failed", "error": message}]));
        assert_eq!(claude.servers[0].detail.as_deref(), Some(message));
        let codex = codex(json!([codex_with("docs", json!({"toolsError": message}))]));
        assert_eq!(codex.servers[0].detail.as_deref(), Some(message));
    }
}

#[test]
fn sensitive_words_inside_failure_details_are_redacted() {
    for (message, expected) in [
        (
            "failed to spawn `/opt/acme/server --token MARKER_SECRET`: No such file",
            "failed to spawn [redacted] No such file",
        ),
        ("spawn /opt/acme/server ENOENT", "spawn [redacted] ENOENT"),
        (
            "env API_KEY=MARKER_SECRET rejected",
            "env [redacted] rejected",
        ),
        ("\"TOKEN=MARKER_SECRET\" rejected", "[redacted] rejected"),
        ("(path/MARKER_SECRET) missing", "[redacted] missing"),
        ("C:\\Users\\MARKER_SECRET missing", "[redacted] missing"),
        (
            "login as user@MARKER_SECRET failed",
            "login as [redacted] failed",
        ),
        (
            "bad key sk_live_MARKER_SECRET_0123456789 used",
            "bad key [redacted] used",
        ),
        ("sixteen abcdefghijklmno1", "sixteen [redacted]"),
        (
            "args: --api-key MARKER_SECRET -p MARKER_SECRET done",
            "args: [redacted] done",
        ),
        ("'--token' 'MARKER_SECRET' failed", "[redacted] failed"),
        ("run (`-k` MARKER_SECRET", "run [redacted]"),
        ("--flag=MARKER_SECRET next kept", "[redacted] kept"),
        ("-5s MARKER_SECRET kept", "[redacted] kept"),
        (
            "--url https://one.example/MARKER_SECRET kept",
            "[redacted] kept",
        ),
        (
            "TOKEN=MARKER_SECRET,https://one.example/x kept",
            "[redacted] kept",
        ),
        ("Connection\u{202e} closed\u{2066}", "Connection closed"),
        ("split abcdefg1\u{200e}ijklmnop run", "split [redacted] run"),
        ("\u{200f}/opt/MARKER_SECRET\u{202a}", "[redacted]"),
    ] {
        let claude = claude(json!([{"name": "docs", "status": "failed", "error": message}]));
        assert_eq!(
            claude.servers[0].detail.as_deref(),
            Some(expected),
            "{message}"
        );
        assert_eq!(validate_servers(&claude), Ok(()));
        let codex = codex(json!([codex_with("docs", json!({"toolsError": message}))]));
        assert_eq!(
            codex.servers[0].detail.as_deref(),
            Some(expected),
            "{message}"
        );
        assert_eq!(validate_servers(&codex), Ok(()));
    }
}

#[test]
fn long_token_runs_are_redacted_only_with_a_digit_or_from_32_characters() {
    let detail = |word: &str| {
        let message = format!("server {word} reported");
        let claude = claude(json!([{"name": "docs", "status": "failed", "error": message}]));
        let codex = codex(json!([codex_with("docs", json!({"toolsError": message}))]));
        assert_eq!(claude.servers[0].detail, codex.servers[0].detail, "{word}");
        assert_eq!(validate_servers(&codex), Ok(()));
        codex.servers[0].detail.clone().expect("detail")
    };
    let letters_31 = "abcdefghijklmnopqrstuvwxyzABCDE";
    let letters_32 = "abcdefghijklmnopqrstuvwxyzABCDEF";
    assert_eq!((letters_31.len(), letters_32.len()), (31, 32));
    for word in [
        "misconfiguration",
        "authenticationRequired",
        "abcdefghijklmnop",
        "initialize_response_closed",
        "connection-closed-early",
        "abcdefghijklmn1",
        "30000ms",
        letters_31,
    ] {
        assert_eq!(detail(word), format!("server {word} reported"), "{word}");
    }
    for token in [
        "ghp_abcdefghij0123456789",
        "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2Nzg5MA",
        "abcdefghijklmno1",
        "sk-proj-abcdefghij1",
        "MARKER_SECRET_0123456789",
        letters_32,
    ] {
        assert_eq!(detail(token), "server [redacted] reported", "{token}");
    }
    assert_eq!(
        detail("misconfiguration.da39a3ee5e6b4b0d3255bfef95601890afd80709"),
        "server [redacted] reported"
    );
}

#[test]
fn a_word_cut_by_the_raw_detail_bound_is_dropped() {
    let cut = format!(
        "{}MARKER_SECRET_0123456789",
        "/x ".repeat(MAX_RAW_DETAIL_BYTES / 3 - 1)
    );
    assert!(cut.len() > MAX_RAW_DETAIL_BYTES);
    let unbroken = "y".repeat(MAX_RAW_DETAIL_BYTES + 1);
    for (message, expected) in [
        (cut.as_str(), Some("[redacted]")),
        (unbroken.as_str(), None),
    ] {
        let snapshot = claude(json!([{"name": "docs", "status": "failed", "error": message}]));
        assert_eq!(snapshot.servers[0].detail.as_deref(), expected);
    }
}

#[test]
fn non_url_secrets_in_error_text_never_reach_the_serialized_snapshot() {
    for message in [
        format!("spawn /opt/{MARKER}/server ENOENT"),
        format!("open C:\\tools\\{MARKER}\\server.exe failed"),
        format!("env API_TOKEN={MARKER} rejected"),
        format!("env \"API_TOKEN={MARKER}\", rejected"),
        format!("failed: server --token {MARKER} exited"),
        format!("failed: server -t '{MARKER}' exited"),
        format!("failed to spawn `/opt/acme/server --token {MARKER}`: No such file"),
        format!("failed to spawn \"/opt/{MARKER}/server\" \"--api-key\" \"{MARKER}\""),
        format!("failed to spawn `server --key={MARKER}`"),
        format!("invalid key sk_live_{MARKER}_0123456789abcdef"),
        format!("invalid key ({MARKER}{MARKER}{MARKER}),"),
    ] {
        let claude = claude(json!([{"name": "docs", "status": "failed", "error": message}]));
        let codex = codex(json!([codex_with("docs", json!({"toolsError": message}))]));
        for snapshot in [&claude, &codex] {
            let serialized = serde_json::to_string(snapshot).unwrap();
            assert!(!serialized.contains(MARKER), "{message}: {serialized}");
            assert!(
                snapshot.servers[0]
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("[redacted]")),
                "{message}: {serialized}"
            );
            assert_eq!(validate_servers(snapshot), Ok(()));
        }
    }
}

#[test]
fn bidi_control_characters_are_rejected_in_wire_names() {
    for name in ["docs\u{202e}", "\u{2066}docs", "do\u{200e}cs"] {
        let wire = json!({
            "version": 1,
            "provider": "codex",
            "truncated": false,
            "servers": [{
                "name": name,
                "status": "connected",
                "scope": "unknown",
                "transport": "stdio",
                "endpointOrigin": null,
                "toolCount": null,
                "detail": null,
            }],
        });
        assert!(parse_mcp_servers(wire).is_err(), "{name:?}");
        assert!(!is_valid_server_name(name), "{name:?}");
    }
    assert!(is_valid_server_name("claude.ai Gmail"));
}

#[test]
fn bidi_control_characters_are_rejected_in_wire_details() {
    let wire = |detail: &str| {
        json!({
            "version": 1,
            "provider": "codex",
            "truncated": false,
            "servers": [{
                "name": "docs",
                "status": "failed",
                "scope": "unknown",
                "transport": "stdio",
                "endpointOrigin": null,
                "toolCount": null,
                "detail": detail,
            }],
        })
    };
    assert!(parse_mcp_servers(wire("Connection closed")).is_ok());
    for detail in [
        "Connection\u{202e}desolc",
        "\u{2066}Connection closed",
        "Connection closed\u{2069}",
        "Connection\u{200e} closed",
        "Connection \u{200f}closed",
        "Connection\u{202a}closed",
    ] {
        let snapshot: AgentMcpServers = serde_json::from_value(wire(detail)).unwrap();
        assert_eq!(
            validate_servers(&snapshot).err().as_deref(),
            Some(INVALID_SERVER_ERROR),
            "{detail:?}"
        );
        assert!(parse_mcp_servers(wire(detail)).is_err(), "{detail:?}");
    }
    let stripped =
        claude(json!([{"name": "docs", "status": "failed", "error": "Connection\u{202e} closed"}]));
    assert_eq!(
        stripped.servers[0].detail.as_deref(),
        Some("Connection closed")
    );
    assert_eq!(validate_servers(&stripped), Ok(()));
}

#[test]
fn endpoint_origins_keep_only_scheme_host_and_port() {
    let pattern = origin_pattern();
    for (url, expected) in [
        (
            "https://mcp.sentry.dev/mcp?token=secret",
            "https://mcp.sentry.dev",
        ),
        (
            "https://user:secret@mcp.sentry.dev",
            "https://mcp.sentry.dev",
        ),
        (
            "https://user:p@ss@mcp.sentry.dev/x",
            "https://mcp.sentry.dev",
        ),
        (
            "HTTPS://MCP.Sentry.DEV:8443/Path",
            "https://mcp.sentry.dev:8443",
        ),
        ("http://127.0.0.1:8931/sse", "http://127.0.0.1:8931"),
        ("http://localhost#fragment", "http://localhost"),
        ("http://[::1]:9000/mcp", "http://[::1]:9000"),
        ("http://[2001:DB8::1]", "http://[2001:db8::1]"),
        (
            "https://evil.example\\@good.example/x",
            "https://evil.example",
        ),
        ("https://chatgpt.com", "https://chatgpt.com"),
        ("https://host:65535/x", "https://host:65535"),
        ("http://host:1", "http://host:1"),
        ("http://[::1]:65535", "http://[::1]:65535"),
    ] {
        let origin = endpoint_origin(url);
        assert_eq!(origin.as_deref(), Some(expected), "{url}");
        assert!(pattern.is_match(expected), "{expected}");
        assert!(is_valid_endpoint_origin(expected), "{expected}");
    }
    let oversized = format!(
        "https://{}.example/x",
        "a".repeat(MAX_MCP_ENDPOINT_ORIGIN_BYTES)
    );
    for url in [
        "",
        "mcp.sentry.dev",
        "ws://127.0.0.1:4000",
        "file:///etc/passwd",
        "https://",
        "https:///path",
        "https://?query",
        "https://user@",
        "https://host:port",
        "https://host:123456",
        "https://host:0",
        "https://host:00000",
        "https://host:65536",
        "https://host:99999",
        "http://[::1]:0",
        "http://[::1]:70000",
        "https://host:",
        "https://ho st/path",
        "https://host\u{0}",
        "https://[::1",
        "https://[::1]x",
        "https://[zz]",
        "https://émile.example",
        " https://mcp.sentry.dev",
        "é",
        oversized.as_str(),
    ] {
        assert_eq!(endpoint_origin(url), None, "{url:?}");
    }
    for invalid in [
        "https://mcp.sentry.dev/",
        "https://mcp.sentry.dev/mcp",
        "https://user:secret@mcp.sentry.dev",
        "https://mcp.sentry.dev?x",
        "https://mcp.sentry.dev#x",
        "HTTPS://mcp.sentry.dev",
        "ftp://mcp.sentry.dev",
        "https://mcp sentry.dev",
        "https://",
    ] {
        assert!(!is_valid_endpoint_origin(invalid), "{invalid}");
    }
}

#[test]
fn stdio_servers_never_carry_an_endpoint_origin() {
    let snapshot = claude(json!([
        {"name": "typed", "config": {"type": "stdio", "command": "npx", "url": "https://leak.example/x"}},
        {"name": "untyped", "config": {"command": "npx", "url": "https://leak.example/x"}},
    ]));
    assert!(snapshot
        .servers
        .iter()
        .all(|server| server.endpoint_origin.is_none()));
    let snapshot = codex(json!([
        codex_with("typed-oddly", json!({"httpOrigin": 5})),
        codex_with(
            "with-path",
            json!({"httpOrigin": "https://user:pw@chatgpt.com/backend?x=1"})
        ),
        codex_with("invalid", json!({"httpOrigin": "not a url"})),
    ]));
    let odd = server(&snapshot, "typed-oddly");
    assert_eq!(odd.transport, AgentMcpServerTransport::Http);
    assert_eq!(odd.endpoint_origin, None);
    assert_eq!(
        server(&snapshot, "with-path").endpoint_origin.as_deref(),
        Some("https://chatgpt.com")
    );
    assert_eq!(server(&snapshot, "invalid").endpoint_origin, None);
    assert_eq!(validate_servers(&snapshot), Ok(()));
}

#[test]
fn provider_secrets_never_reach_the_serialized_snapshot() {
    let claude = claude(json!([
        {
            "name": "local-tools",
            "status": "failed",
            "error": format!("spawn failed for https://internal.example/{MARKER}?token={MARKER}"),
            "config": {
                "type": "stdio",
                "command": format!("/opt/{MARKER}/server"),
                "args": ["--api-key", MARKER],
                "env": {"API_TOKEN": MARKER},
            },
            "scope": "project",
            "source": format!("project-{MARKER}"),
            "serverInfo": {"name": MARKER, "version": MARKER},
            "tools": [{"name": format!("tool-{MARKER}"), "description": MARKER, "annotations": {"title": MARKER}}],
        },
        {
            "name": "remote-tools",
            "status": "connected",
            "config": {
                "type": "http",
                "url": format!("https://user:{MARKER}@mcp.example.com:8443/v1/{MARKER}?token={MARKER}#{MARKER}"),
                "headers": {"Authorization": format!("Bearer {MARKER}")},
                "id": format!("mcpsrv_{MARKER}"),
            },
            "scope": "user",
            "pid": 4242,
            "tools": [{"name": MARKER, "inputSchema": {"description": MARKER}}],
        },
    ]));
    let codex = codex(json!([codex_with(
        "remote-tools",
        json!({
            "httpOrigin": format!("https://user:{MARKER}@mcp.example.com:8443/v1/{MARKER}?token={MARKER}"),
            "pluginId": format!("plugin-{MARKER}"),
            "serverInfo": {"name": MARKER},
            "serverCapabilities": {"experimental": MARKER},
            "tools": {MARKER: {"name": MARKER, "description": MARKER, "inputSchema": {"title": MARKER}}},
            "toolsError": format!("request to https://mcp.example.com:8443/v1/{MARKER}?token={MARKER} failed"),
            "resources": [{"uri": MARKER}],
            "resourceTemplates": [{"uriTemplate": MARKER}],
            "authStatus": "bearerToken",
        })
    )]));
    for snapshot in [&claude, &codex] {
        let serialized = serde_json::to_string(snapshot).unwrap();
        assert!(!serialized.contains(MARKER), "{serialized}");
        assert!(!serialized.contains("4242"), "{serialized}");
        assert_eq!(validate_servers(snapshot), Ok(()));
    }
    let local = server(&claude, "local-tools");
    assert_eq!(local.endpoint_origin, None);
    assert_eq!(
        local.detail.as_deref(),
        Some("spawn failed for https://internal.example")
    );
    let remote = server(&claude, "remote-tools");
    assert_eq!(
        remote.endpoint_origin.as_deref(),
        Some("https://mcp.example.com:8443")
    );
    assert_eq!(remote.tool_count, Some(1));
    let remote = server(&codex, "remote-tools");
    assert_eq!(
        remote.endpoint_origin.as_deref(),
        Some("https://mcp.example.com:8443")
    );
    assert_eq!(remote.status, AgentMcpServerStatus::Failed);
    assert_eq!(
        remote.detail.as_deref(),
        Some("request to https://mcp.example.com:8443 failed")
    );
    assert_eq!(
        serde_json::to_value(&codex).unwrap(),
        json!({
            "version": 1,
            "provider": "codex",
            "truncated": false,
            "servers": [{
                "name": "remote-tools",
                "status": "failed",
                "scope": "plugin",
                "transport": "http",
                "endpointOrigin": "https://mcp.example.com:8443",
                "toolCount": 1,
                "detail": "request to https://mcp.example.com:8443 failed",
            }],
        })
    );
}

#[test]
fn codex_servers_disabled_in_the_config_are_reported_as_disabled_without_leaking_it() {
    let secret_entry = |enabled: Value| {
        json!({
            "command": format!("/opt/{MARKER}/server"),
            "args": ["--api-key", MARKER],
            "env": {"API_TOKEN": MARKER},
            "url": format!("https://user:{MARKER}@mcp.example.com/{MARKER}?token={MARKER}"),
            "http_headers": {"Authorization": format!("Bearer {MARKER}")},
            "bearer_token_env_var": MARKER,
            "environment_id": "local",
            "enabled": enabled,
            "tool_timeout_sec": null,
        })
    };
    let config = json!({
        "config": {
            "model": MARKER,
            "mcp_servers": {
                "off": secret_entry(json!(false)),
                "on": secret_entry(json!(true)),
                "needs-login": secret_entry(json!(false)),
                "broken": secret_entry(json!(false)),
                "live": secret_entry(json!(false)),
                "starting": secret_entry(json!(false)),
                "mistyped": secret_entry(json!("false")),
                "zero": secret_entry(json!(0)),
                "null-flag": secret_entry(json!(null)),
                "flagless": {"command": MARKER},
                "not-listed": secret_entry(json!(false)),
                MARKER: secret_entry(json!(false)),
            },
        },
        "origins": {"mcp_servers.off.enabled": {"name": {"type": "user", "file": MARKER}}},
    });
    let mut snapshot = codex(json!([
        codex_entry("off"),
        codex_entry("on"),
        codex_entry("absent"),
        codex_with("needs-login", json!({"authStatus": "notLoggedIn"})),
        codex_with("broken", json!({"toolsError": "Connection closed"})),
        codex_with("live", json!({"serverInfo": {"name": "live"}})),
        codex_with("starting", json!({"runtimeStatus": "starting"})),
        codex_entry("mistyped"),
        codex_entry("zero"),
        codex_entry("null-flag"),
        codex_entry("flagless"),
    ]));
    assert_eq!(
        server(&snapshot, "broken").detail.as_deref(),
        Some("Connection closed")
    );
    mark_codex_disabled_servers(&mut snapshot, &config);
    use AgentMcpServerStatus::*;
    for (name, status) in [
        ("off", Disabled),
        ("on", Unknown),
        ("absent", Unknown),
        ("needs-login", Disabled),
        ("broken", Disabled),
        ("live", Connected),
        ("starting", Connecting),
        ("mistyped", Unknown),
        ("zero", Unknown),
        ("null-flag", Unknown),
        ("flagless", Unknown),
    ] {
        assert_eq!(server(&snapshot, name).status, status, "{name}");
    }
    assert_eq!(server(&snapshot, "broken").detail, None);
    assert_eq!(snapshot.servers.len(), 11);
    assert_eq!(validate_servers(&snapshot), Ok(()));
    assert!(!serde_json::to_string(&snapshot).unwrap().contains(MARKER));
}

#[test]
fn a_malformed_codex_config_changes_nothing() {
    let original = codex(json!([codex_entry("off")]));
    for config in [
        json!(null),
        json!("config"),
        json!({}),
        json!({"config": null}),
        json!({"config": {"mcp_servers": null}}),
        json!({"config": {"mcp_servers": [{"name": "off", "enabled": false}]}}),
        json!({"config": {"mcp_servers": {"off": false}}}),
        json!({"config": {"mcp_servers": {"off": {"enabled": "false"}}}}),
        json!({"config": {"mcp_servers": {"OFF": {"enabled": false}}}}),
        json!({"mcp_servers": {"off": {"enabled": false}}}),
        json!({"config": {"off": {"enabled": false}}}),
    ] {
        let mut snapshot = original.clone();
        mark_codex_disabled_servers(&mut snapshot, &config);
        assert_eq!(snapshot, original, "{config}");
    }
}
