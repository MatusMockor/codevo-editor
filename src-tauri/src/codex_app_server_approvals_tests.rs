use super::*;
use crate::agent_questions::approvals::MAX_PENDING_AGENT_APPROVALS;
use std::sync::Mutex;

const ROUTE: CodexApprovalRoute<'static> = CodexApprovalRoute {
    thread_id: "thread-1",
    turn_id: "turn-1",
};

fn capture() -> (CodexApprovalWriter, Arc<Mutex<Vec<Value>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    (
        Arc::new(move |value| {
            sink.lock().unwrap().push(value);
            Ok(())
        }),
        seen,
    )
}

#[test]
fn command_approval_shows_command_cwd_reason_and_maps_decisions() {
    let registry = AgentApprovalRegistry::default();
    let params = json!({"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","command":"cargo build","cwd":"/repo","reason":"needs network"});
    let (writer, seen) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(7),
        CODEX_COMMAND_APPROVAL,
        &params,
        &CodexApprovalItems::default(),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    let id = approval_request_id(&json!(7));
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].kind, AgentApprovalKind::Command);
    assert_eq!(listed[0].detail, "cargo build");
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Directory" && f.value == "/repo"));
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Reason" && f.value == "needs network"));
    registry
        .answer("task", &id, AgentApprovalDecision::AllowForSession)
        .unwrap();
    assert_eq!(
        seen.lock().unwrap()[0],
        json!({"decision":"acceptForSession"})
    );
}

#[test]
fn file_change_deny_declines_and_available_decisions_are_respected() {
    let registry = AgentApprovalRegistry::default();
    let params = json!({"threadId":"thread-1","turnId":"turn-1","itemId":"item-2","reason":"write config","grantRoot":"/etc","availableDecisions":["accept","decline"]});
    let (writer, seen) = capture();
    register(
        &registry,
        &ROUTE,
        &json!("r-2"),
        CODEX_FILE_CHANGE_APPROVAL,
        &params,
        &CodexApprovalItems::default(),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].kind, AgentApprovalKind::FileChange);
    assert_eq!(
        listed[0].decisions,
        vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny
        ]
    );
    assert!(listed[0].facts.iter().any(|f| f.value == "/etc"));
    registry
        .answer("task", &listed[0].id, AgentApprovalDecision::Deny)
        .unwrap();
    assert_eq!(seen.lock().unwrap()[0], json!({"decision":"decline"}));
}

#[test]
fn confirmation_elicitation_accepts_with_empty_content() {
    let registry = AgentApprovalRegistry::default();
    let params = json!({"threadId":"thread-1","turnId":"turn-1","serverName":"db","mode":"form","message":"Drop the cache?","requestedSchema":{"type":"object","properties":{}}});
    let (writer, seen) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(9),
        CODEX_MCP_ELICITATION,
        &params,
        &CodexApprovalItems::default(),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].kind, AgentApprovalKind::McpElicitation);
    assert_eq!(listed[0].detail, "Drop the cache?");
    registry
        .answer("task", &listed[0].id, AgentApprovalDecision::AllowOnce)
        .unwrap();
    assert_eq!(
        seen.lock().unwrap()[0],
        json!({"action":"accept","content":{}})
    );
}

#[test]
fn foreign_turn_form_input_and_empty_commands_fail_closed() {
    let registry = AgentApprovalRegistry::default();
    let (writer, _) = capture();
    let foreign = json!({"threadId":"thread-2","turnId":"turn-1","command":"ls"});
    assert!(register(
        &registry,
        &ROUTE,
        &json!(1),
        CODEX_COMMAND_APPROVAL,
        &foreign,
        &CodexApprovalItems::default(),
        Arc::clone(&writer)
    )
    .is_err());
    let stale = json!({"threadId":"thread-1","turnId":"turn-0","command":"ls"});
    assert!(register(
        &registry,
        &ROUTE,
        &json!(2),
        CODEX_COMMAND_APPROVAL,
        &stale,
        &CodexApprovalItems::default(),
        Arc::clone(&writer)
    )
    .is_err());
    let form = json!({"threadId":"thread-1","serverName":"db","message":"Token?","requestedSchema":{"type":"object","properties":{"token":{"type":"string"}}}});
    assert!(register(
        &registry,
        &ROUTE,
        &json!(3),
        CODEX_MCP_ELICITATION,
        &form,
        &CodexApprovalItems::default(),
        Arc::clone(&writer)
    )
    .is_err());
    let empty = json!({"threadId":"thread-1","turnId":"turn-1"});
    assert!(register(
        &registry,
        &ROUTE,
        &json!(4),
        CODEX_COMMAND_APPROVAL,
        &empty,
        &CodexApprovalItems::default(),
        Arc::clone(&writer)
    )
    .is_err());
    assert!(register(
        &registry,
        &ROUTE,
        &json!(5),
        "item/tool/call",
        &empty,
        &CodexApprovalItems::default(),
        writer
    )
    .is_err());
    assert!(registry.list("task").is_empty());
}

#[test]
fn provider_resolution_expires_the_matching_approval() {
    let registry = AgentApprovalRegistry::default();
    let params = json!({"threadId":"thread-1","turnId":"turn-1","command":"ls"});
    let (writer, seen) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(11),
        CODEX_COMMAND_APPROVAL,
        &params,
        &CodexApprovalItems::default(),
        writer,
    )
    .unwrap();
    registry.expire(&approval_request_id(&json!(11)));
    assert_eq!(
        registry.list("task")[0].status,
        AgentApprovalStatus::Expired
    );
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn only_interactive_methods_are_routed_and_every_known_kind_has_a_decline() {
    assert!(is_interactive_approval(CODEX_COMMAND_APPROVAL));
    assert!(!is_interactive_approval("item/permissions/requestApproval"));
    for method in CODEX_INTERACTIVE_APPROVAL_METHODS {
        assert!(decline_result(method).is_some());
    }
    assert!(decline_result("future/serverRequest").is_none());
}

fn started(item: Value) -> ServerNotification {
    super::super::super::codex_app_server_protocol::classify_notification(
        "item/started",
        json!({"threadId":"thread-1","turnId":"turn-1","item":item}),
    )
}

#[test]
fn file_change_lists_the_started_items_files_and_hides_an_empty_reason() {
    let mut items = CodexApprovalItems::default();
    let changes: Vec<Value> = (0..MAX_LISTED_CODEX_FILES + 3)
        .map(|index| json!({"path":format!("src/file-{index}.ts"),"kind":{"type":"update"}}))
        .collect();
    items.observe(
        &started(
            json!({"type":"fileChange","id":"item-9","status":"inProgress","changes":changes}),
        ),
        "thread-1",
        "turn-1",
    );
    let registry = AgentApprovalRegistry::default();
    let params = json!({"threadId":"thread-1","turnId":"turn-1","itemId":"item-9","reason":"  "});
    let (writer, _) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(1),
        CODEX_FILE_CHANGE_APPROVAL,
        &params,
        &items,
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert!(listed[0].detail.starts_with("src/file-0.ts\nsrc/file-1.ts"));
    assert!(listed[0].detail.ends_with("+3 more"));
    assert_eq!(listed[0].detail.lines().count(), MAX_LISTED_CODEX_FILES + 1);
    assert!(listed[0].facts.is_empty());
}

#[test]
fn file_change_without_a_known_item_says_the_files_are_unlisted() {
    let registry = AgentApprovalRegistry::default();
    let params =
        json!({"threadId":"thread-1","turnId":"turn-1","itemId":"unknown","reason":"needs /etc"});
    let (writer, _) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(2),
        CODEX_FILE_CHANGE_APPROVAL,
        &params,
        &CodexApprovalItems::default(),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert!(listed[0].detail.is_empty());
    assert!(listed[0].facts.iter().any(|f| f.label == "Files"));
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Reason" && f.value == "needs /etc"));
}

#[test]
fn stdin_writes_have_their_own_title_and_do_not_need_a_command() {
    let mut items = CodexApprovalItems::default();
    items.observe(
        &started(json!({"type":"commandExecution","id":"item-3","status":"inProgress","command":"npm run dev"})),
        "thread-1",
        "turn-1",
    );
    let registry = AgentApprovalRegistry::default();
    let params = json!({"kind":"writeStdin","threadId":"thread-1","turnId":"turn-1","itemId":"item-3","command":null});
    let (writer, seen) = capture();
    register(
        &registry,
        &ROUTE,
        &json!(3),
        CODEX_COMMAND_APPROVAL,
        &params,
        &items,
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].title, "Send input to a running command?");
    assert_eq!(listed[0].detail, "npm run dev");
    registry
        .answer("task", &listed[0].id, AgentApprovalDecision::Deny)
        .unwrap();
    assert_eq!(seen.lock().unwrap()[0], json!({"decision":"decline"}));
}

#[test]
fn rejections_are_classified_for_distinct_notices() {
    let registry = AgentApprovalRegistry::default();
    let items = CodexApprovalItems::default();
    let (writer, _) = capture();
    let reject = |id: i64, method: &str, params: Value| {
        register(
            &registry,
            &ROUTE,
            &json!(id),
            method,
            &params,
            &items,
            Arc::clone(&writer),
        )
        .unwrap_err()
    };
    assert_eq!(
        reject(
            1,
            CODEX_COMMAND_APPROVAL,
            json!({"threadId":"thread-1","turnId":"old","command":"ls"})
        ),
        CodexApprovalRejection::ForeignTurn
    );
    assert_eq!(
        reject(
            2,
            CODEX_COMMAND_APPROVAL,
            json!({"threadId":"thread-1","turnId":"turn-1","command":null})
        ),
        CodexApprovalRejection::MissingCommand
    );
    assert_eq!(
        reject(
            3,
            CODEX_MCP_ELICITATION,
            json!({"threadId":"thread-1","turnId":null,"serverName":"db","mode":"url","message":"Log in","url":"https://x","elicitationId":"e"})
        ),
        CodexApprovalRejection::UnsupportedInput
    );
    for index in 0..MAX_PENDING_AGENT_APPROVALS {
        register(
            &registry,
            &ROUTE,
            &json!(100 + index),
            CODEX_COMMAND_APPROVAL,
            &json!({"threadId":"thread-1","turnId":"turn-1","command":"ls"}),
            &items,
            Arc::clone(&writer),
        )
        .unwrap();
    }
    assert_eq!(
        reject(
            4,
            CODEX_COMMAND_APPROVAL,
            json!({"threadId":"thread-1","turnId":"turn-1","command":"ls"})
        ),
        CodexApprovalRejection::TooManyPending
    );
    let notices = [
        CodexApprovalRejection::ForeignTurn,
        CodexApprovalRejection::MissingCommand,
        CodexApprovalRejection::UnsupportedInput,
        CodexApprovalRejection::TooManyPending,
    ]
    .map(CodexApprovalRejection::notice);
    assert_eq!(
        notices
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        4
    );
}
