use super::*;
use crate::remote_runner::mcp_device_config::{select, ProjectKind, MAX_CANDIDATES};
use serde_json::json;

const ROOT: &str = "/Users/dev/work";
const PATH: &str = "/v1/projects/codevo-editor/mcp-servers/claude/device-sync";

fn selection(value: Value) -> DeviceMcpSelection {
    select(
        &serde_json::to_vec(&value).unwrap(),
        ROOT,
        ProjectKind::Folder,
    )
    .unwrap()
}

fn sample() -> DeviceMcpSelection {
    selection(json!({ "mcpServers": {
        "files": { "command": "npx", "args": ["-y", "files"], "env": { "TOKEN": "env-secret" } },
        "linear": { "type": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer header-secret" } },
        "events": { "type": "sse", "url": "https://events.example/sse" },
        "socket": { "type": "ws", "url": "wss://x.example" },
        "bad name": { "command": "npx" },
        "rtl\u{202e}": { "command": "npx" },
    } }))
}

fn outcomes(pairs: &[(&str, RunnerOutcome)]) -> BTreeMap<String, RunnerOutcome> {
    pairs
        .iter()
        .map(|(name, outcome)| ((*name).to_owned(), *outcome))
        .collect()
}

#[test]
fn the_route_is_the_exact_claude_put_path() {
    assert_eq!(path("codevo-editor").unwrap(), PATH);
    assert!(is_route("PUT", PATH));
    for method in ["GET", "POST", "DELETE", "PATCH"] {
        assert!(!is_route(method, PATH), "{method}");
    }
    for candidate in [
        "/v1/projects/codevo-editor/mcp-servers/codex/device-sync",
        "/v1/projects/codevo-editor/mcp-servers/claude/device-sync/",
        "/v1/projects/codevo-editor/mcp-servers/claude/device-sync?x=1",
        "/v1/projects/codevo-editor/mcp-servers/claude/changes",
        "/v1/projects/a/b/mcp-servers/claude/device-sync",
        "/v1/projects//mcp-servers/claude/device-sync",
        "/v1/projects/../mcp-servers/claude/device-sync",
        "/v1/mcp-servers/claude/device-sync",
    ] {
        assert!(!is_route("PUT", candidate), "{candidate}");
    }
    for project in ["", "../x", "a/b", "a b", "-a", &"x".repeat(65)] {
        assert!(path(project).is_err(), "{project:?}");
    }
    assert_eq!(SYNC_TIMEOUT, Duration::from_secs(45));
    assert_eq!(MAX_OUTPUT, 16 * 1024);
}

#[test]
fn the_request_body_has_the_exact_contract_shape() {
    let body = request_body(&sample()).unwrap();
    assert_eq!(
        body,
        json!({
            "version": 1,
            "servers": [
                { "name": "events", "launch": { "kind": "sse", "url": "https://events.example/sse", "headers": {} } },
                { "name": "files", "launch": { "kind": "stdio", "command": "npx", "args": ["-y", "files"], "env": { "TOKEN": "env-secret" } } },
                { "name": "linear", "launch": { "kind": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer header-secret" } } },
            ],
            "retain": ["socket"],
        })
    );
    assert_eq!(
        request_body(&DeviceMcpSelection::empty()).unwrap(),
        json!({ "version": 1, "servers": [], "retain": [] })
    );
}

#[test]
fn a_body_over_the_request_limit_is_refused_without_values_in_the_error() {
    let env: serde_json::Map<String, Value> = (0..3)
        .map(|index| (format!("K{index}"), json!("s".repeat(8192))))
        .collect();
    let large = selection(json!({ "mcpServers": { "a": { "command": "x", "env": env.clone() } } }));
    assert!(request_body(&large).is_ok());
    let servers = |count: usize| -> serde_json::Map<String, Value> {
        (0..count)
            .map(|index| (format!("s{index}"), json!({ "command": "x", "env": env })))
            .collect()
    };
    let fitting = selection(json!({ "mcpServers": servers(10) }));
    assert_eq!(fitting.transferable().count(), 10);
    assert!(request_body(&fitting).is_ok());
    let oversize = selection(json!({ "mcpServers": servers(11) }));
    assert_eq!(oversize.transferable().count(), 11);
    assert_eq!(request_body(&oversize), Err(REQUEST_TOO_LARGE));
    assert!(!REQUEST_TOO_LARGE.contains("sss"));
}

#[test]
fn runner_responses_are_closed_bounded_and_unique() {
    let parsed = parse_response(json!({ "version": 1, "results": [
        { "name": "a", "outcome": "added" },
        { "name": "b", "outcome": "updated" },
        { "name": "c", "outcome": "unchanged" },
        { "name": "d", "outcome": "removed" },
        { "name": "e", "outcome": "keptServerEntry" },
        { "name": "f", "outcome": "commandMissing" },
        { "name": "g", "outcome": "failed" },
    ] }))
    .unwrap();
    assert_eq!(parsed.len(), 7);
    assert_eq!(parsed["e"], RunnerOutcome::KeptServerEntry);
    let max: Vec<Value> = (0..MAX_RUNNER_RESULTS)
        .map(|index| json!({ "name": format!("n{index}"), "outcome": "unchanged" }))
        .collect();
    assert!(parse_response(json!({ "version": 1, "results": max })).is_ok());
    let over: Vec<Value> = (0..=MAX_RUNNER_RESULTS)
        .map(|index| json!({ "name": format!("n{index}"), "outcome": "unchanged" }))
        .collect();
    for invalid in [
        json!({ "version": 1, "results": over }),
        json!({ "version": 2, "results": [] }),
        json!({ "version": 1 }),
        json!({ "results": [] }),
        json!({ "version": 1, "results": [], "extra": true }),
        json!({ "version": 1, "results": [{ "name": "a", "outcome": "skipped" }] }),
        json!({ "version": 1, "results": [{ "name": "a", "outcome": "conflict" }] }),
        json!({ "version": 1, "results": [{ "name": "a", "outcome": "Added" }] }),
        json!({ "version": 1, "results": [{ "name": "a", "outcome": "added", "detail": "x" }] }),
        json!({ "version": 1, "results": [{ "name": "a" }] }),
        json!({ "version": 1, "results": [{ "name": "a b", "outcome": "added" }] }),
        json!({ "version": 1, "results": [{ "name": "", "outcome": "added" }] }),
        json!({ "version": 1, "results": [{ "name": "a", "outcome": "added" }, { "name": "a", "outcome": "failed" }] }),
        json!([]),
        Value::Null,
    ] {
        assert_eq!(
            parse_response(invalid.clone()),
            Err(UNAVAILABLE),
            "{invalid}"
        );
    }
}

#[test]
fn the_report_merges_runner_outcomes_with_local_skips_and_runner_only_removals() {
    let report = merge(
        &sample(),
        outcomes(&[
            ("files", RunnerOutcome::Added),
            ("linear", RunnerOutcome::KeptServerEntry),
            ("socket", RunnerOutcome::Unchanged),
            ("old", RunnerOutcome::Removed),
            ("edited", RunnerOutcome::KeptServerEntry),
        ]),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&report).unwrap(),
        json!({
            "version": 1,
            "results": [
                { "name": "bad name", "transport": "stdio", "outcome": "skipped", "hints": ["invalidName"] },
                { "name": "edited", "transport": "unknown", "outcome": "keptServerEntry", "hints": [] },
                { "name": "events", "transport": "sse", "outcome": "failed", "hints": ["mayNeedSignIn"] },
                { "name": "files", "transport": "stdio", "outcome": "added", "hints": [] },
                { "name": "linear", "transport": "http", "outcome": "keptServerEntry", "hints": [] },
                { "name": "old", "transport": "unknown", "outcome": "removed", "hints": [] },
                { "name": "socket", "transport": "unknown", "outcome": "skipped", "hints": ["unsupportedTransport"] },
            ],
            "omitted": 1,
        })
    );
}

#[test]
fn contradictory_runner_outcomes_are_unavailable() {
    for runner in [
        outcomes(&[("files", RunnerOutcome::Removed)]),
        outcomes(&[("ghost", RunnerOutcome::Added)]),
        outcomes(&[("ghost", RunnerOutcome::Updated)]),
        outcomes(&[("ghost", RunnerOutcome::Unchanged)]),
        outcomes(&[("ghost", RunnerOutcome::CommandMissing)]),
    ] {
        assert_eq!(merge(&sample(), runner), Err(UNAVAILABLE));
    }
    assert!(merge(&sample(), outcomes(&[("ghost", RunnerOutcome::Failed)])).is_ok());
}

#[test]
fn a_report_over_the_ipc_limit_is_unavailable() {
    let servers: serde_json::Map<String, Value> = (0..MAX_CANDIDATES)
        .map(|index| (format!("s{index:03}"), json!({ "command": "x" })))
        .collect();
    let full = selection(json!({ "mcpServers": servers }));
    let removed: Vec<(String, RunnerOutcome)> = (0..=(MAX_REPORTED_RESULTS - MAX_CANDIDATES))
        .map(|index| (format!("r{index}"), RunnerOutcome::Removed))
        .collect();
    let mut runner: BTreeMap<String, RunnerOutcome> = removed.into_iter().collect();
    assert_eq!(merge(&full, runner.clone()), Err(UNAVAILABLE));
    runner.pop_last();
    assert_eq!(
        merge(&full, runner).unwrap().results.len(),
        MAX_REPORTED_RESULTS
    );
}

#[test]
fn the_report_never_carries_configuration_values() {
    let report = merge(
        &sample(),
        outcomes(&[
            ("files", RunnerOutcome::Added),
            ("linear", RunnerOutcome::Updated),
        ]),
    )
    .unwrap();
    let wire = serde_json::to_string(&report).unwrap();
    let debug = format!("{report:?}");
    for secret in [
        "env-secret",
        "header-secret",
        "Bearer",
        "npx",
        "mcp.linear.app",
        "events.example",
        "TOKEN",
        "Authorization",
    ] {
        assert!(!wire.contains(secret), "{secret}");
        assert!(!debug.contains(secret), "{secret}");
    }
}
