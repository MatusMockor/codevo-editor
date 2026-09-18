use super::super::codex_app_server_protocol::{classify_notification, JsonRpcIncoming};
use super::*;
use serde_json::{json, Value};
use std::path::PathBuf;

const ROOT_THREAD: &str = "01a0a00e-5c49-7bd0-afbd-71f072731dd2";
const SUB_THREAD: &str = "01a0a00f-9ca4-7b73-b47b-15d287ee0374";
const FOREIGN_THREAD: &str = "01a0a0ff-0000-0000-0000-000000000000";
const TURN_ID: &str = "01a0a00e-5cad-7103-9c18-48e452bc69db";

fn rooted() -> CodexTurnProjection {
    CodexTurnProjection::new(Some(ROOT_THREAD.to_string()))
}

fn with_subagent() -> CodexTurnProjection {
    let mut projection = rooted();
    let events = projection.project(classify_notification(
        "item/started",
        item_params(
            ROOT_THREAD,
            subagent_activity_item("call-1", "started", SUB_THREAD),
        ),
    ));
    assert_eq!(events.len(), 1);
    projection
}

fn item_params(thread_id: &str, item: Value) -> Value {
    json!({ "threadId": thread_id, "turnId": TURN_ID, "item": item })
}

fn subagent_activity_item(id: &str, kind: &str, agent_thread_id: &str) -> Value {
    json!({
        "type": "subAgentActivity",
        "id": id,
        "kind": kind,
        "agentThreadId": agent_thread_id,
        "agentPath": "/root/echo_check",
    })
}

fn project(
    projection: &mut CodexTurnProjection,
    method: &str,
    params: Value,
) -> Vec<CodexTurnEvent> {
    projection.project(classify_notification(method, params))
}

fn lines(events: &[CodexTurnEvent]) -> String {
    events
        .iter()
        .map(CodexTurnEvent::ndjson_line)
        .collect::<Vec<_>>()
        .concat()
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("codex_app_server")
        .join(name)
}

fn fixture_text(name: &str) -> String {
    let path = fixture_path(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("fixture {} must be readable: {error}", path.display()))
}

fn projected_fixture(name: &str) -> String {
    let mut projection = CodexTurnProjection::new(None);
    let mut projected = String::new();
    for line in fixture_text(name).lines() {
        if line.trim().is_empty() {
            continue;
        }
        let incoming: JsonRpcIncoming = serde_json::from_str(line)
            .unwrap_or_else(|error| panic!("fixture {name} line must decode: {error}"));
        let JsonRpcIncoming::Notification { method, params } = incoming else {
            continue;
        };
        for event in projection.project(classify_notification(method.as_str(), params)) {
            projected.push_str(event.ndjson_line().as_str());
        }
    }
    projected
}

#[test]
fn adopting_the_thread_start_result_emits_a_session_event() {
    let mut projection = CodexTurnProjection::new(None);

    let events = projection.adopt_root(ROOT_THREAD);

    assert_eq!(
        events,
        vec![CodexTurnEvent::Session {
            thread_id: ROOT_THREAD.to_string()
        }]
    );
    assert_eq!(projection.root_thread_id(), Some(ROOT_THREAD));
}

#[test]
fn the_first_thread_started_notification_becomes_the_root_session() {
    let mut projection = CodexTurnProjection::new(None);

    let events = project(
        &mut projection,
        "thread/started",
        json!({ "thread": { "id": ROOT_THREAD, "parentThreadId": null } }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Session {
            thread_id: ROOT_THREAD.to_string()
        }]
    );
}

#[test]
fn a_foreign_thread_started_notification_is_an_unknown_frame() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "thread/started",
        json!({ "thread": { "id": FOREIGN_THREAD } }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::UnknownFrame {
            method: "thread/started".to_string()
        }]
    );
    assert_eq!(projection.unknown_frames_emitted(), 1);
}

#[test]
fn a_completed_agent_message_projects_assistant_text() {
    let mut projection = rooted();
    let item = json!({ "type": "agentMessage", "id": "msg-1", "text": "OK" });

    let started = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item.clone()),
    );
    let completed = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(started, Vec::new());
    assert_eq!(
        completed,
        vec![CodexTurnEvent::text(
            CodexTextRole::Assistant,
            CodexClippedText {
                text: "OK".to_string(),
                clipped: false
            }
        )]
    );
}

#[test]
fn a_completed_reasoning_item_prefers_the_summary_over_the_content() {
    let mut projection = rooted();
    let item = json!({
        "type": "reasoning",
        "id": "rs-1",
        "summary": ["first", "second"],
        "content": ["ignored"],
    });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::text(
            CodexTextRole::Reasoning,
            CodexClippedText {
                text: "first\nsecond".to_string(),
                clipped: false
            }
        )]
    );
}

#[test]
fn an_empty_reasoning_item_is_dropped() {
    let mut projection = rooted();
    let item = json!({ "type": "reasoning", "id": "rs-1", "summary": [], "content": [] });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(events, Vec::new());
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn a_started_command_execution_projects_a_shell_tool_call() {
    let mut projection = rooted();
    let item = json!({
        "type": "commandExecution",
        "id": "exec-1",
        "status": "inProgress",
        "command": "/bin/zsh -lc 'echo hi'",
    });

    let events = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::tool_call(
            "exec-1".to_string(),
            CodexClippedText {
                text: SHELL_TOOL_NAME.to_string(),
                clipped: false
            },
            CodexClippedText {
                text: "/bin/zsh -lc 'echo hi'".to_string(),
                clipped: false
            }
        )]
    );
}

#[test]
fn a_completed_command_execution_projects_a_tool_result_keyed_on_the_exit_code() {
    let mut projection = rooted();
    let ok = json!({
        "type": "commandExecution",
        "id": "exec-1",
        "status": "completed",
        "aggregatedOutput": "hello\n",
        "exitCode": 0,
    });
    let failed = json!({
        "type": "commandExecution",
        "id": "exec-2",
        "status": "completed",
        "aggregatedOutput": "boom\n",
        "exitCode": 1,
    });

    let ok_events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, ok),
    );
    let failed_events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, failed),
    );

    assert_eq!(
        ok_events,
        vec![CodexTurnEvent::tool_result(
            "exec-1".to_string(),
            CodexClippedText {
                text: "hello\n".to_string(),
                clipped: false
            },
            false
        )]
    );
    assert_eq!(
        failed_events,
        vec![CodexTurnEvent::tool_result(
            "exec-2".to_string(),
            CodexClippedText {
                text: "boom\n".to_string(),
                clipped: false
            },
            true
        )]
    );
}

#[test]
fn a_declined_command_execution_is_an_error_result() {
    let mut projection = rooted();
    let item = json!({
        "type": "commandExecution",
        "id": "exec-1",
        "status": "declined",
        "aggregatedOutput": null,
        "exitCode": null,
    });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::tool_result(
            "exec-1".to_string(),
            CodexClippedText::default(),
            true
        )]
    );
}

#[test]
fn a_started_file_change_projects_an_apply_patch_tool_call() {
    let mut projection = rooted();
    let item = json!({
        "type": "fileChange",
        "id": "patch-1",
        "status": "inProgress",
        "changes": [
            { "path": "src/a.ts", "kind": { "type": "add" } },
            { "path": "src/b.ts", "kind": { "type": "update" } },
        ],
    });

    let events = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::tool_call(
            "patch-1".to_string(),
            CodexClippedText {
                text: APPLY_PATCH_TOOL_NAME.to_string(),
                clipped: false
            },
            CodexClippedText {
                text: "src/a.ts, src/b.ts".to_string(),
                clipped: false
            }
        )]
    );
}

#[test]
fn a_started_mcp_tool_call_projects_a_server_qualified_tool_name() {
    let mut projection = rooted();
    let item = json!({
        "type": "mcpToolCall",
        "id": "mcp-1",
        "status": "inProgress",
        "server": "linear",
        "tool": "list_issues",
    });

    let events = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::tool_call(
            "mcp-1".to_string(),
            CodexClippedText {
                text: "linear/list_issues".to_string(),
                clipped: false
            },
            CodexClippedText::default()
        )]
    );
}

#[test]
fn a_started_web_search_projects_a_web_search_tool_call() {
    let mut projection = rooted();
    let item = json!({ "type": "webSearch", "id": "search-1", "query": "codex app server" });

    let events = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::tool_call(
            "search-1".to_string(),
            CodexClippedText {
                text: WEB_SEARCH_TOOL_NAME.to_string(),
                clipped: false
            },
            CodexClippedText {
                text: "codex app server".to_string(),
                clipped: false
            }
        )]
    );
}

#[test]
fn a_subagent_activity_registers_the_thread_and_emits_once_per_item_id() {
    let mut projection = rooted();
    let item = subagent_activity_item("call-1", "started", SUB_THREAD);

    let started = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item.clone()),
    );
    let completed = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        started,
        vec![CodexTurnEvent::Subagent {
            kind: CodexSubagentKind::Started,
            agent_thread_id: SUB_THREAD.to_string(),
            agent_path: CodexClippedText {
                text: "/root/echo_check".to_string(),
                clipped: false
            },
        }]
    );
    assert_eq!(completed, Vec::new());
    assert_eq!(
        projection.subagent_threads(),
        &[CodexSubagentThread {
            thread_id: SUB_THREAD.to_string(),
            agent_path: "/root/echo_check".to_string(),
        }]
    );
}

#[test]
fn an_unrecognized_subagent_activity_kind_is_an_unknown_frame() {
    let mut projection = rooted();
    let item = subagent_activity_item("call-1", "teleported", SUB_THREAD);

    let events = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::UnknownFrame {
            method: "item/started".to_string()
        }]
    );
    assert_eq!(projection.subagent_threads(), &[]);
}

#[test]
fn subagent_items_wrap_and_never_merge_into_the_root_log() {
    let mut projection = with_subagent();
    let item = json!({ "type": "agentMessage", "id": "msg-sub", "text": "from-subagent" });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(SUB_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::SubagentItem {
            agent_thread_id: SUB_THREAD.to_string(),
            inner: CodexItemEvent::Text {
                role: CodexTextRole::Assistant,
                text: CodexClippedText {
                    text: "from-subagent".to_string(),
                    clipped: false
                },
            },
        }]
    );
    assert!(lines(&events).contains(r#""t":"subagentItem""#));
    assert!(!lines(&events).contains(r#""inner":{"t":"subagentItem""#));
}

#[test]
fn a_nested_subagent_activity_on_a_subagent_thread_is_an_unknown_frame() {
    let mut projection = with_subagent();
    let item = subagent_activity_item("call-2", "started", "thread-grandchild");

    let events = project(
        &mut projection,
        "item/started",
        item_params(SUB_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::UnknownFrame {
            method: "item/started".to_string()
        }]
    );
    assert_eq!(projection.subagent_threads().len(), 1);
}

#[test]
fn items_on_an_unregistered_thread_are_unknown_frames() {
    let mut projection = rooted();
    let item = json!({ "type": "agentMessage", "id": "msg-1", "text": "leak" });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(FOREIGN_THREAD, item),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::UnknownFrame {
            method: "item/completed".to_string()
        }]
    );
}

#[test]
fn token_usage_carries_the_thread_scope_for_the_root_and_the_subagent_scope_for_a_child() {
    let mut projection = with_subagent();
    let usage = json!({
        "total": { "totalTokens": 10, "inputTokens": 7, "cachedInputTokens": 3,
                   "cacheWriteInputTokens": 0, "outputTokens": 3, "reasoningOutputTokens": 1 },
        "last": { "totalTokens": 5, "inputTokens": 4, "cachedInputTokens": 2,
                  "cacheWriteInputTokens": 0, "outputTokens": 1, "reasoningOutputTokens": 0 },
        "modelContextWindow": 258_400,
    });

    let root = project(
        &mut projection,
        "thread/tokenUsage/updated",
        json!({ "threadId": ROOT_THREAD, "turnId": TURN_ID, "tokenUsage": usage.clone() }),
    );
    let subagent = project(
        &mut projection,
        "thread/tokenUsage/updated",
        json!({ "threadId": SUB_THREAD, "turnId": TURN_ID, "tokenUsage": usage }),
    );

    assert!(matches!(
        root.as_slice(),
        [CodexTurnEvent::Usage {
            scope: CodexUsageScope::Thread,
            ..
        }]
    ));
    assert!(matches!(
        subagent.as_slice(),
        [CodexTurnEvent::Usage {
            scope: CodexUsageScope::Subagent,
            ..
        }]
    ));
}

#[test]
fn a_completed_root_turn_projects_a_result_carrying_the_last_root_usage() {
    let mut projection = rooted();
    project(
        &mut projection,
        "thread/tokenUsage/updated",
        json!({
            "threadId": ROOT_THREAD,
            "tokenUsage": {
                "total": { "totalTokens": 32_688, "inputTokens": 32_577, "cachedInputTokens": 24_064,
                           "cacheWriteInputTokens": 0, "outputTokens": 111, "reasoningOutputTokens": 0 },
                "last": { "totalTokens": 16_360, "inputTokens": 16_355, "cachedInputTokens": 12_032,
                          "cacheWriteInputTokens": 0, "outputTokens": 5, "reasoningOutputTokens": 0 },
                "modelContextWindow": 258_400,
            },
        }),
    );

    let events = project(
        &mut projection,
        "turn/completed",
        json!({
            "threadId": ROOT_THREAD,
            "turn": { "id": TURN_ID, "status": "completed", "durationMs": 7_576, "error": null },
        }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Result {
            is_error: false,
            duration_ms: Some(7_576),
            text: CodexClippedText::default(),
            usage: Some(CodexUsage {
                last: CodexTokenBreakdown {
                    input_tokens: 16_355,
                    cached_input_tokens: 12_032,
                    cache_write_input_tokens: 0,
                    output_tokens: 5,
                    reasoning_output_tokens: 0,
                    total_tokens: 16_360,
                },
                total: CodexTokenBreakdown {
                    input_tokens: 32_577,
                    cached_input_tokens: 24_064,
                    cache_write_input_tokens: 0,
                    output_tokens: 111,
                    reasoning_output_tokens: 0,
                    total_tokens: 32_688,
                },
                context_window: Some(258_400),
            }),
        }]
    );
}

#[test]
fn a_failed_root_turn_projects_an_error_result_with_the_bounded_message() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "turn/completed",
        json!({
            "threadId": ROOT_THREAD,
            "turn": {
                "id": TURN_ID,
                "status": "failed",
                "durationMs": null,
                "error": { "message": "stream closed", "additionalDetails": "retry later" },
            },
        }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Result {
            is_error: true,
            duration_ms: None,
            text: CodexClippedText {
                text: "stream closed\nretry later".to_string(),
                clipped: false
            },
            usage: None,
        }]
    );
}

#[test]
fn a_completed_subagent_turn_projects_a_subagent_turn_completed_event() {
    let mut projection = with_subagent();
    project(
        &mut projection,
        "turn/started",
        json!({"threadId":SUB_THREAD, "turn":{"id":"turn-sub", "status":"inProgress"}}),
    );

    let events = project(
        &mut projection,
        "turn/completed",
        json!({
            "threadId": SUB_THREAD,
            "turn": { "id": "turn-sub", "status": "completed", "durationMs": 1_234, "error": null },
        }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::SubagentTurnCompleted {
            agent_thread_id: SUB_THREAD.to_string(),
            duration_ms: Some(1_234),
            is_error: false,
        }]
    );
}

#[test]
fn a_compacted_root_thread_projects_a_compaction_without_token_counts() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "thread/compacted",
        json!({ "threadId": ROOT_THREAD, "turnId": TURN_ID }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Compaction {
            before_tokens: None,
            after_tokens: None,
        }]
    );
}

#[test]
fn a_queue_change_on_the_root_thread_projects_a_queued_event() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "thread/queue/changed",
        json!({ "threadId": ROOT_THREAD }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Queued {
            thread_id: ROOT_THREAD.to_string(),
            client_user_message_id: None,
        }]
    );
}

#[test]
fn an_error_notification_projects_a_bounded_error_for_any_thread() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "error",
        json!({
            "threadId": FOREIGN_THREAD,
            "error": { "message": "model unavailable" },
            "willRetry": false,
        }),
    );

    assert_eq!(
        events,
        vec![CodexTurnEvent::Error {
            message: CodexClippedText {
                text: "model unavailable".to_string(),
                clipped: false
            },
            thread_id: Some(FOREIGN_THREAD.to_string()),
        }]
    );
}

#[test]
fn ignored_notifications_project_nothing() {
    let mut projection = rooted();

    let events = project(
        &mut projection,
        "item/commandExecution/outputDelta",
        json!({ "threadId": ROOT_THREAD }),
    );

    assert_eq!(events, Vec::new());
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn echoed_user_messages_and_collab_tool_calls_are_dropped_rather_than_counted() {
    let mut projection = rooted();
    let user_message = json!({ "type": "userMessage", "id": "user-1", "content": [] });
    let collab = json!({ "type": "collabAgentToolCall", "id": "call-1", "tool": "wait" });

    let echoed = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, user_message),
    );
    let waiting = project(
        &mut projection,
        "item/started",
        item_params(ROOT_THREAD, collab),
    );

    assert_eq!(echoed, Vec::new());
    assert_eq!(waiting, Vec::new());
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn unknown_notifications_project_unknown_frames_capped_at_eight() {
    let mut projection = rooted();
    let mut emitted = 0;

    for index in 0..(MAX_CODEX_UNKNOWN_FRAMES_PER_TURN + 4) {
        emitted += project(
            &mut projection,
            format!("invented/method/{index}").as_str(),
            json!({}),
        )
        .len();
    }

    assert_eq!(emitted, MAX_CODEX_UNKNOWN_FRAMES_PER_TURN);
    assert_eq!(
        projection.unknown_frames_emitted(),
        MAX_CODEX_UNKNOWN_FRAMES_PER_TURN
    );
}

#[test]
fn subagent_registration_stops_at_thirty_two_threads_and_keeps_insertion_order() {
    let mut projection = rooted();

    for index in 0..MAX_SUBAGENT_THREADS_PER_TURN {
        let item = subagent_activity_item(
            format!("call-{index}").as_str(),
            "started",
            format!("thread-{index}").as_str(),
        );
        project(
            &mut projection,
            "item/started",
            item_params(ROOT_THREAD, item),
        );
    }
    let overflow = project(
        &mut projection,
        "item/started",
        item_params(
            ROOT_THREAD,
            subagent_activity_item("call-overflow", "started", "thread-overflow"),
        ),
    );

    assert_eq!(
        projection.subagent_threads().len(),
        MAX_SUBAGENT_THREADS_PER_TURN
    );
    assert_eq!(projection.subagent_threads()[0].thread_id, "thread-0");
    assert_eq!(projection.subagent_threads()[31].thread_id, "thread-31");
    assert_eq!(
        overflow,
        vec![CodexTurnEvent::UnknownFrame {
            method: "item/started".to_string()
        }]
    );
}

#[test]
fn command_output_is_clipped_to_the_tool_summary_budget_on_a_character_boundary() {
    let mut projection = rooted();
    let item = json!({
        "type": "commandExecution",
        "id": "exec-1",
        "status": "completed",
        "aggregatedOutput": "€".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES),
        "exitCode": 0,
    });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    let CodexTurnEvent::Item(CodexItemEvent::ToolResult { output_summary, .. }) = &events[0] else {
        panic!("a completed command execution must project a tool result");
    };
    assert!(output_summary.clipped);
    assert_eq!(
        output_summary.text,
        "€".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES / 3)
    );
    assert!(output_summary.text.len() <= MAX_AGENT_TOOL_SUMMARY_BYTES);
    assert!(lines(&events).contains(r#""clipped":true"#));
}

#[test]
fn assistant_text_is_clipped_to_the_event_text_budget() {
    let mut projection = rooted();
    let item = json!({
        "type": "agentMessage",
        "id": "msg-1",
        "text": "𝄞".repeat(MAX_CODEX_EVENT_TEXT_BYTES),
    });

    let events = project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, item),
    );

    let CodexTurnEvent::Item(CodexItemEvent::Text { text, .. }) = &events[0] else {
        panic!("a completed agent message must project text");
    };
    assert!(text.clipped);
    assert_eq!(text.text.len(), MAX_CODEX_EVENT_TEXT_BYTES);
    assert_eq!(text.text, "𝄞".repeat(MAX_CODEX_EVENT_TEXT_BYTES / 4));
}

#[test]
fn the_event_text_budget_matches_the_typescript_contract() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("domain")
        .join("agentThreadLimits.ts");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()));

    assert!(text.contains("export const MAX_AGENT_EVENT_TEXT_BYTES = 16 * 1_024;"));
    assert_eq!(MAX_CODEX_EVENT_TEXT_BYTES, 16 * 1_024);
    assert_eq!(MAX_AGENT_TOOL_SUMMARY_BYTES, 512);
}

#[test]
fn every_event_line_is_a_single_versioned_json_object() {
    let mut projection = with_subagent();
    let item = json!({ "type": "agentMessage", "id": "msg-sub", "text": "from-subagent" });
    let events = project(
        &mut projection,
        "item/completed",
        item_params(SUB_THREAD, item),
    );

    let line = lines(&events);

    assert!(line.ends_with('\n'));
    assert_eq!(line.matches('\n').count(), 1);
    assert!(line.starts_with(r#"{"v":1,"t":"#));
}

#[test]
fn the_golden_basic_session_projects_byte_identically() {
    assert_eq!(
        projected_fixture("session-basic.jsonl"),
        fixture_text("session-basic.events.jsonl")
    );
}

#[test]
fn the_golden_subagent_session_projects_byte_identically() {
    assert_eq!(
        projected_fixture("session-subagent.jsonl"),
        fixture_text("session-subagent.events.jsonl")
    );
}

#[test]
fn the_golden_subagent_session_never_merges_child_items_into_the_root() {
    let projected = projected_fixture("session-subagent.jsonl");

    assert!(projected.contains(r#""t":"subagentItem""#));
    assert!(projected.contains(r#""t":"subagentTurnCompleted""#));
    assert!(projected.contains(r#""scope":"subagent""#));
    assert!(!projected.contains(r#""inner":{"t":"subagentItem""#));
    for line in projected.lines() {
        let value: Value = serde_json::from_str(line).expect("a projected line must be json");
        assert_eq!(value.get("v").and_then(Value::as_u64), Some(1));
    }
}

#[test]
fn a_supervisor_correlated_queued_event_carries_a_bounded_client_user_message_id() {
    let correlated = CodexTurnEvent::queued(ROOT_THREAD.to_string(), Some("steer-1"));
    let oversized = CodexTurnEvent::queued(
        ROOT_THREAD.to_string(),
        Some(
            "s".repeat(MAX_CODEX_CLIENT_USER_MESSAGE_ID_BYTES + 1)
                .as_str(),
        ),
    );

    assert_eq!(
        correlated,
        CodexTurnEvent::Queued {
            thread_id: ROOT_THREAD.to_string(),
            client_user_message_id: Some("steer-1".to_string()),
        }
    );
    assert_eq!(
        oversized,
        CodexTurnEvent::Queued {
            thread_id: ROOT_THREAD.to_string(),
            client_user_message_id: None,
        }
    );
}

#[test]
fn completed_only_subagent_activity_does_not_register_a_thread() {
    let mut projection = rooted();
    assert!(project(
        &mut projection,
        "item/completed",
        item_params(
            ROOT_THREAD,
            subagent_activity_item("call", "started", SUB_THREAD)
        )
    )
    .is_empty());
    assert!(projection.subagent_threads().is_empty());
}

#[test]
fn duplicate_activity_cannot_register_a_different_thread() {
    let mut projection = with_subagent();
    assert!(project(
        &mut projection,
        "item/started",
        item_params(
            ROOT_THREAD,
            subagent_activity_item("call-1", "started", FOREIGN_THREAD)
        )
    )
    .is_empty());
    assert_eq!(projection.subagent_threads().len(), 1);
}

#[test]
fn invalid_subagent_identity_is_never_retained() {
    for (id, thread) in [
        ("x".repeat(MAX_CODEX_TOOL_ID_BYTES + 1), SUB_THREAD),
        ("call".to_string(), ROOT_THREAD),
    ] {
        let mut projection = rooted();
        let events = project(
            &mut projection,
            "item/started",
            item_params(ROOT_THREAD, subagent_activity_item(&id, "started", thread)),
        );
        assert!(matches!(
            events.as_slice(),
            [CodexTurnEvent::UnknownFrame { .. }]
        ));
        assert!(projection.subagent_threads().is_empty());
    }
}

#[test]
fn activity_dedupe_budget_exhaustion_is_visible_and_fail_closed() {
    let mut projection = rooted();
    for index in 0..MAX_CODEX_SUBAGENT_ACTIVITY_IDS {
        project(
            &mut projection,
            "item/started",
            item_params(
                ROOT_THREAD,
                subagent_activity_item(&format!("call-{index}"), "started", SUB_THREAD),
            ),
        );
    }
    let events = project(
        &mut projection,
        "item/started",
        item_params(
            ROOT_THREAD,
            subagent_activity_item("overflow", "started", FOREIGN_THREAD),
        ),
    );
    assert!(matches!(
        events.as_slice(),
        [CodexTurnEvent::UnknownFrame { .. }]
    ));
    assert_eq!(projection.subagent_threads().len(), 1);
    assert_eq!(
        projection.subagent_activity_ids.len(),
        MAX_CODEX_SUBAGENT_ACTIVITY_IDS
    );
}

#[test]
fn steered_user_echoes_with_client_ids_do_not_duplicate_local_bubbles() {
    let mut projection = rooted();
    for method in ["item/started", "item/completed"] {
        for _ in 0..2 {
            assert!(project(
                &mut projection,
                method,
                item_params(
                    ROOT_THREAD,
                    json!({"type":"userMessage", "id":"user-1", "clientId":"steer-1", "content":[]})
                )
            )
            .is_empty());
        }
    }
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn conflicting_root_adoption_preserves_the_original_authority() {
    let mut projection = with_subagent();
    let events = projection.adopt_root(FOREIGN_THREAD);
    assert!(matches!(
        events.as_slice(),
        [CodexTurnEvent::UnknownFrame { .. }]
    ));
    assert_eq!(projection.root_thread_id(), Some(ROOT_THREAD));
    let foreign = project(
        &mut projection,
        "item/completed",
        item_params(
            FOREIGN_THREAD,
            json!({"type":"agentMessage", "id":"m", "text":"foreign"}),
        ),
    );
    assert!(matches!(
        foreign.as_slice(),
        [CodexTurnEvent::UnknownFrame { .. }]
    ));
}

#[test]
fn invalid_token_metrics_fail_closed_before_serialization() {
    for invalid in [-1, i64::MAX] {
        let mut projection = rooted();
        let events = project(
            &mut projection,
            "thread/tokenUsage/updated",
            json!({
                "threadId": ROOT_THREAD, "turnId": TURN_ID,
                "tokenUsage": {"last": {"inputTokens": invalid}, "total": {}}
            }),
        );
        assert!(matches!(
            events.as_slice(),
            [CodexTurnEvent::UnknownFrame { .. }]
        ));
        assert!(projection.root_usage.is_none());
    }
}

#[test]
fn invalid_duration_is_not_published_as_a_numeric_metric() {
    let mut projection = rooted();
    let events = project(
        &mut projection,
        "turn/completed",
        json!({
            "threadId": ROOT_THREAD,
            "turn": {"id": TURN_ID, "status":"completed", "durationMs": -1}
        }),
    );
    assert!(matches!(
        events.as_slice(),
        [CodexTurnEvent::Result {
            duration_ms: None,
            ..
        }]
    ));
}

#[test]
fn projected_text_replaces_nul_and_preserves_utf8_byte_budget() {
    assert_eq!(
        clipped_text("a\0b", 5),
        CodexClippedText {
            text: "a\u{fffd}b".into(),
            clipped: true
        }
    );
    assert_eq!(
        clipped_text("a\0b", 3),
        CodexClippedText {
            text: "a".into(),
            clipped: true
        }
    );
    assert!(bounded_identity("tool\0id", MAX_CODEX_TOOL_ID_BYTES).is_none());
}

#[test]
fn session_events_obey_shared_session_id_grammar() {
    for invalid in [
        "short".to_string(),
        "-invalid-id".to_string(),
        "bad/session".to_string(),
        "a".repeat(129),
    ] {
        let mut projection = CodexTurnProjection::new(None);
        assert!(matches!(
            projection.adopt_root(&invalid).as_slice(),
            [CodexTurnEvent::UnknownFrame { .. }]
        ));
        assert!(projection.root_thread_id().is_none());
    }
    let domain = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/domain/agentTask.ts"),
    )
    .unwrap();
    assert!(domain.contains("/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/"));
    let domain = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/domain/agentThread.ts"),
    )
    .unwrap();
    assert!(domain.contains("export const MAX_AGENT_TOOL_SUMMARY_BYTES = 512;"));
}

#[test]
fn adapter_session_fallback_serializes_a_closed_identity_transition() {
    let event = CodexTurnEvent::session_fallback("previous-thread", "replacement-thread").unwrap();
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({"v":1,"t":"sessionFallback","previousThreadId":"previous-thread","threadId":"replacement-thread"})
    );
    assert!(CodexTurnEvent::session_fallback("same-thread", "same-thread").is_none());
    for invalid in ["short", "bad thread", "../thread", "bad\nthread"] {
        assert!(CodexTurnEvent::session_fallback(invalid, "replacement-thread").is_none());
        assert!(CodexTurnEvent::session_fallback("previous-thread", invalid).is_none());
    }
    assert!(CodexTurnEvent::session_fallback(&"a".repeat(129), "replacement-thread").is_none());
}

fn child_turn(projection: &mut CodexTurnProjection, method: &str, id: &str) -> Vec<CodexTurnEvent> {
    project(
        projection,
        method,
        json!({"threadId":SUB_THREAD,"turn":{"id":id,"status":if method=="turn/started" {"inProgress"} else {"completed"}}}),
    )
}
fn child_activity(projection: &mut CodexTurnProjection, id: &str, kind: &str) {
    project(
        projection,
        "item/started",
        item_params(ROOT_THREAD, subagent_activity_item(id, kind, SUB_THREAD)),
    );
}
#[test]
fn a_reused_child_cannot_be_completed_by_a_prior_turn() {
    let mut projection = with_subagent();
    child_turn(&mut projection, "turn/started", "child-1");
    assert_eq!(
        child_turn(&mut projection, "turn/completed", "child-1").len(),
        1
    );
    child_activity(&mut projection, "interaction-2", "interacted");
    assert!(child_turn(&mut projection, "turn/completed", "child-1").is_empty());
    child_turn(&mut projection, "turn/started", "child-2");
    child_turn(&mut projection, "turn/started", "child-1");
    assert!(child_turn(&mut projection, "turn/completed", "child-1").is_empty());
    assert_eq!(
        child_turn(&mut projection, "turn/completed", "child-2").len(),
        1
    );
    assert!(child_turn(&mut projection, "turn/completed", "child-2").is_empty());
}
#[test]
fn child_interaction_or_interrupt_retires_the_previous_active_turn() {
    for kind in ["interacted", "interrupted"] {
        let mut projection = with_subagent();
        child_turn(&mut projection, "turn/started", "child-1");
        child_activity(&mut projection, "activity-2", kind);
        child_turn(&mut projection, "turn/started", "child-1");
        assert!(child_turn(&mut projection, "turn/completed", "child-1").is_empty());
        child_turn(&mut projection, "turn/started", "child-2");
        assert_eq!(
            child_turn(&mut projection, "turn/completed", "child-2").len(),
            1
        );
    }
}
#[test]
fn unknown_child_completion_is_tombstoned_without_retiring_the_current_turn() {
    let mut projection = with_subagent();
    child_turn(&mut projection, "turn/started", "current");
    assert!(child_turn(&mut projection, "turn/completed", "old-unseen").is_empty());
    child_turn(&mut projection, "turn/started", "old-unseen");
    assert_eq!(
        child_turn(&mut projection, "turn/completed", "current").len(),
        1
    );
}
#[test]
fn duplicate_current_start_and_foreign_start_do_not_change_child_authority() {
    let mut projection = with_subagent();
    child_turn(&mut projection, "turn/started", "current");
    child_turn(&mut projection, "turn/started", "current");
    project(
        &mut projection,
        "turn/started",
        json!({"threadId":FOREIGN_THREAD,"turn":{"id":"foreign","status":"inProgress"}}),
    );
    assert_eq!(projection.subagent_turns.len(), 1);
    assert_eq!(
        child_turn(&mut projection, "turn/completed", "current").len(),
        1
    );
}
#[test]
fn child_turn_tombstones_never_evict_and_exhaustion_fails_closed() {
    let mut projection = with_subagent();
    for index in 0..MAX_CODEX_SUBAGENT_TURN_IDS {
        child_turn(&mut projection, "turn/started", &format!("turn-{index}"));
    }
    assert_eq!(
        projection.observed_subagent_turns.len(),
        MAX_CODEX_SUBAGENT_TURN_IDS
    );
    child_turn(&mut projection, "turn/started", "overflow");
    assert!(child_turn(&mut projection, "turn/completed", "overflow").is_empty());
    child_turn(&mut projection, "turn/started", "turn-0");
    assert!(child_turn(&mut projection, "turn/completed", "turn-0").is_empty());
    assert!(projection.subagent_turns.is_empty());
    assert_eq!(
        projection.observed_subagent_turns.len(),
        MAX_CODEX_SUBAGENT_TURN_IDS
    );
}
