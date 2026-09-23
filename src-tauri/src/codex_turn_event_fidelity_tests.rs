use super::super::codex_app_server_protocol::classify_notification;
use super::items::clip_head_tail;
use super::*;
use serde_json::{json, Value};

const ROOT_THREAD: &str = "01a0a00e-5c49-7bd0-afbd-71f072731dd2";
const FOREIGN_THREAD: &str = "01a0a0ff-0000-0000-0000-000000000000";
const TURN_ID: &str = "01a0a00e-5cad-7103-9c18-48e452bc69db";

fn rooted() -> CodexTurnProjection {
    CodexTurnProjection::new(Some(ROOT_THREAD.to_string()))
}

fn project(
    projection: &mut CodexTurnProjection,
    method: &str,
    params: Value,
) -> Vec<CodexTurnEvent> {
    projection.project(classify_notification(method, params))
}

fn item(projection: &mut CodexTurnProjection, method: &str, item: Value) -> Vec<CodexTurnEvent> {
    project(
        projection,
        method,
        json!({ "threadId": ROOT_THREAD, "turnId": TURN_ID, "item": item }),
    )
}

fn only_result(events: &[CodexTurnEvent]) -> (&str, &CodexClippedText, bool) {
    let [CodexTurnEvent::Item(CodexItemEvent::ToolResult {
        tool_id,
        output_summary,
        is_error,
    })] = events
    else {
        panic!("expected exactly one tool result, got {events:?}");
    };
    (tool_id.as_str(), output_summary, *is_error)
}

fn only_call(events: &[CodexTurnEvent]) -> (&str, &CodexClippedText) {
    let [CodexTurnEvent::Item(CodexItemEvent::ToolCall {
        name,
        input_summary,
        ..
    })] = events
    else {
        panic!("expected exactly one tool call, got {events:?}");
    };
    (name.text.as_str(), input_summary)
}

fn only_notice(events: &[CodexTurnEvent]) -> (CodexNoticeSeverity, &str) {
    let [CodexTurnEvent::Notice {
        severity, message, ..
    }] = events
    else {
        panic!("expected exactly one notice, got {events:?}");
    };
    (*severity, message.text.as_str())
}

fn file_change(status: &str) -> Value {
    json!({
        "type": "fileChange",
        "id": "patch-1",
        "status": status,
        "changes": [
            { "path": "src/a.ts", "kind": { "type": "add" }, "diff": "+a" },
            { "path": "src/b.ts", "kind": { "type": "update", "move_path": null }, "diff": "" },
            { "path": "src/c.ts", "kind": { "type": "update", "move_path": "src/d.ts" }, "diff": "" },
            { "path": "src/e.ts", "kind": { "type": "delete" }, "diff": "" },
        ],
    })
}

#[test]
fn a_completed_file_change_settles_the_row_with_a_per_file_summary() {
    let mut projection = rooted();

    let events = item(&mut projection, "item/completed", file_change("completed"));

    let (tool_id, summary, is_error) = only_result(&events);
    assert_eq!(tool_id, "patch-1");
    assert!(!is_error);
    assert_eq!(
        summary.text,
        "add src/a.ts\nupdate src/b.ts\nmove src/c.ts -> src/d.ts\ndelete src/e.ts"
    );
}

#[test]
fn a_declined_or_failed_file_change_is_an_error_result() {
    for (status, label) in [
        ("declined", "patch declined"),
        ("failed", "patch failed"),
        ("somethingNew", "patch status unknown"),
    ] {
        let mut projection = rooted();

        let events = item(&mut projection, "item/completed", file_change(status));

        let (_, summary, is_error) = only_result(&events);
        assert!(is_error, "{status} must be an error");
        assert!(
            summary.text.starts_with(label),
            "{status}: {}",
            summary.text
        );
    }
}

#[test]
fn a_file_change_summary_stays_inside_the_tool_summary_budget() {
    let mut projection = rooted();
    let changes = (0..200)
        .map(|index| json!({ "path": format!("src/{index}/{}", "é".repeat(40)), "kind": { "type": "add" } }))
        .collect::<Vec<_>>();

    let events = item(
        &mut projection,
        "item/completed",
        json!({ "type": "fileChange", "id": "patch-1", "status": "completed", "changes": changes }),
    );

    let (_, summary, _) = only_result(&events);
    assert!(summary.clipped);
    assert!(summary.text.len() <= MAX_AGENT_TOOL_SUMMARY_BYTES);
}

fn mcp_call(status: &str, extra: Value) -> Value {
    let mut call = json!({
        "type": "mcpToolCall",
        "id": "mcp-1",
        "status": status,
        "server": "linear",
        "tool": "list_issues",
        "arguments": { "team": "ENG", "apiToken": "sk-live-secret", "nested": { "password": "hunter2" } },
    });
    let (Value::Object(target), Value::Object(source)) = (&mut call, extra) else {
        panic!("objects expected");
    };
    target.extend(source);
    call
}

#[test]
fn a_started_mcp_call_summarises_redacted_arguments() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/started",
        mcp_call("inProgress", json!({})),
    );

    let (name, summary) = only_call(&events);
    assert_eq!(name, "linear/list_issues");
    assert!(summary.text.contains(r#""team":"ENG""#));
    assert!(!summary.text.contains("sk-live-secret"));
    assert!(!summary.text.contains("hunter2"));
    assert!(summary.text.contains("[redacted]"));
}

#[test]
fn mcp_arguments_are_bounded_by_depth_and_bytes() {
    let mut deep = json!("leaf");
    for _ in 0..64 {
        deep = json!({ "level": deep });
    }
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/started",
        json!({
            "type": "mcpToolCall",
            "id": "mcp-1",
            "status": "inProgress",
            "server": "s",
            "tool": "t",
            "arguments": { "deep": deep, "wide": "x".repeat(4096) },
        }),
    );

    let (_, summary) = only_call(&events);
    assert!(summary.clipped);
    assert!(summary.text.len() <= MAX_AGENT_TOOL_SUMMARY_BYTES);
    assert!(!summary.text.contains("leaf"));
}

#[test]
fn a_failed_mcp_call_is_an_error_result_with_the_bounded_message() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/completed",
        mcp_call(
            "failed",
            json!({ "error": { "message": "permission denied" }, "result": null }),
        ),
    );

    let (tool_id, summary, is_error) = only_result(&events);
    assert_eq!(tool_id, "mcp-1");
    assert!(is_error);
    assert_eq!(summary.text, "permission denied");
}

#[test]
fn a_completed_mcp_call_summarises_its_content() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/completed",
        mcp_call(
            "completed",
            json!({
                "error": null,
                "result": {
                    "content": [
                        { "type": "text", "text": "3 issues" },
                        { "type": "image", "data": "AAAA", "mimeType": "image/png" },
                    ],
                },
            }),
        ),
    );

    let (_, summary, is_error) = only_result(&events);
    assert!(!is_error);
    assert_eq!(summary.text, "3 issues\n[image]");
}

#[test]
fn a_completed_mcp_call_falls_back_to_structured_content() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/completed",
        mcp_call(
            "completed",
            json!({ "result": { "content": [], "structuredContent": { "count": 3 } } }),
        ),
    );

    let (_, summary, is_error) = only_result(&events);
    assert!(!is_error);
    assert_eq!(summary.text, r#"{"count":3}"#);
}

#[test]
fn a_completed_web_search_reports_the_query_and_result_count() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/completed",
        json!({
            "type": "webSearch",
            "id": "search-1",
            "query": "codex app server",
            "action": { "type": "search", "query": "codex app server", "queries": null },
            "results": [{ "title": "a" }, { "title": "b" }],
        }),
    );

    let (tool_id, summary, is_error) = only_result(&events);
    assert_eq!(tool_id, "search-1");
    assert!(!is_error);
    assert_eq!(summary.text, "codex app server\n2 results");
}

#[test]
fn a_completed_page_open_reports_the_url() {
    let mut projection = rooted();

    let events = item(
        &mut projection,
        "item/completed",
        json!({
            "type": "webSearch",
            "id": "search-1",
            "query": "",
            "action": { "type": "openPage", "url": "https://example.com" },
        }),
    );

    let (_, summary, _) = only_result(&events);
    assert_eq!(summary.text, "opened https://example.com");
}

#[test]
fn a_failed_command_keeps_the_exit_code_and_the_output_tail() {
    let mut projection = rooted();
    let output = format!(
        "{}\nFAIL src/a.test.ts: expected 1 to be 2\n",
        "ok line\n".repeat(400)
    );

    let events = item(
        &mut projection,
        "item/completed",
        json!({
            "type": "commandExecution",
            "id": "exec-1",
            "status": "failed",
            "aggregatedOutput": output,
            "exitCode": 1,
        }),
    );

    let (_, summary, is_error) = only_result(&events);
    assert!(is_error);
    assert!(summary.clipped);
    assert!(summary.text.starts_with("exit 1\nok line"));
    assert!(summary
        .text
        .ends_with("FAIL src/a.test.ts: expected 1 to be 2\n"));
    assert!(summary.text.contains("bytes omitted"));
    assert!(summary.text.len() <= MAX_AGENT_TOOL_SUMMARY_BYTES);
}

#[test]
fn head_tail_clipping_is_utf8_safe_bounded_and_reports_the_omitted_bytes() {
    for limit in [0, 1, 8, 31, 32, 64, 65, 200, 512] {
        for unit in ["a", "é", "€", "𝄞"] {
            let text = unit.repeat(300);
            let clipped = clip_head_tail(text.as_str(), limit);

            assert!(clipped.text.len() <= limit, "{limit} {unit}");
            if text.len() <= limit {
                assert_eq!(clipped.text, text);
                assert!(!clipped.clipped);
                continue;
            }
            assert!(clipped.clipped);
            let Some((head, rest)) = clipped.text.split_once("\n\u{2026} ") else {
                continue;
            };
            let (count, tail) = rest.split_once(" bytes omitted \u{2026}\n").unwrap();
            let omitted: usize = count.parse().unwrap();
            assert_eq!(head.len() + omitted + tail.len(), text.len());
            assert!(text.starts_with(head));
            assert!(text.ends_with(tail));
        }
    }
}

#[test]
fn head_tail_clipping_replaces_nul_and_marks_it_clipped() {
    let clipped = clip_head_tail("a\0b", 64);

    assert_eq!(clipped.text, "a\u{fffd}b");
    assert!(clipped.clipped);
}

#[test]
fn a_retrying_error_is_an_info_notice_and_not_an_error() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "error",
        json!({
            "threadId": ROOT_THREAD,
            "turnId": TURN_ID,
            "error": { "message": "Reconnecting... 2/5" },
            "willRetry": true,
        }),
    );

    let (severity, message) = only_notice(&events);
    assert_eq!(severity, CodexNoticeSeverity::Info);
    assert!(message.contains("Reconnecting... 2/5"));
    assert!(!events
        .iter()
        .any(|event| matches!(event, CodexTurnEvent::Error { .. })));
}

#[test]
fn a_model_reroute_is_a_visible_warning_notice() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "model/rerouted",
        json!({
            "threadId": ROOT_THREAD,
            "turnId": TURN_ID,
            "fromModel": "gpt-5.5",
            "toModel": "gpt-5.5-mini",
            "reason": "highRiskCyberActivity",
        }),
    );

    let (severity, message) = only_notice(&events);
    assert_eq!(severity, CodexNoticeSeverity::Warning);
    assert_eq!(
        message,
        "Codex switched this turn from model gpt-5.5 to gpt-5.5-mini (reason: highRiskCyberActivity)."
    );
    assert_eq!(
        serde_json::from_str::<Value>(events[0].ndjson_line().as_str()).unwrap(),
        json!({
            "v": 1,
            "t": "notice",
            "noticeId": "codex-notice-1",
            "severity": "warning",
            "message": message,
            "clipped": false,
        })
    );
}

#[test]
fn a_foreign_model_reroute_is_an_unknown_frame() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "model/rerouted",
        json!({
            "threadId": FOREIGN_THREAD,
            "turnId": TURN_ID,
            "fromModel": "a",
            "toModel": "b",
            "reason": "highRiskCyberActivity",
        }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::UnknownFrame {
            method: "model/rerouted".to_string()
        }]
    );
}

#[test]
fn notices_are_capped_per_turn_with_unique_ids() {
    let mut projection = rooted();
    let mut ids = Vec::new();

    for _ in 0..(MAX_CODEX_NOTICES_PER_TURN + 4) {
        for event in projection.notice(CodexNoticeSeverity::Info, "retrying") {
            let CodexTurnEvent::Notice { notice_id, .. } = event else {
                panic!("notice expected");
            };
            ids.push(notice_id);
        }
    }

    let unique = ids.iter().collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), MAX_CODEX_NOTICES_PER_TURN);
    assert_eq!(unique.len(), ids.len());
}

#[test]
fn notices_are_bounded_and_nul_free() {
    let mut projection = rooted();
    let message = format!("a\0{}", "€".repeat(MAX_CODEX_NOTICE_BYTES));

    let events = projection.notice(CodexNoticeSeverity::Warning, message.as_str());

    let (_, text) = only_notice(&events);
    assert!(text.len() <= MAX_CODEX_NOTICE_BYTES);
    assert!(!text.contains('\0'));
}

#[test]
fn an_mcp_completion_that_is_not_completed_is_an_error_with_a_status_label() {
    for (status, label) in [
        ("inProgress", "MCP call did not finish"),
        ("failed", "MCP call failed"),
        ("paused", "MCP call status unknown: paused"),
    ] {
        let mut projection = rooted();

        let events = item(
            &mut projection,
            "item/completed",
            mcp_call(
                status,
                json!({ "result": { "content": [{ "type": "text", "text": "ok" }] } }),
            ),
        );

        let (_, summary, is_error) = only_result(&events);
        assert!(is_error, "{status} must be an error");
        assert_eq!(summary.text, label);
    }
}
