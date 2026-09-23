use super::*;
use std::sync::Mutex;

fn capture() -> (ClaudeControlWriter, Arc<Mutex<Vec<Value>>>) {
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

fn permission<'a>(
    id: &str,
    tool: &'a str,
    input: &'a Value,
    request: &'a Value,
) -> ClaudePermissionRequest<'a> {
    ClaudePermissionRequest {
        public_id: id.into(),
        tool_name: tool,
        input,
        request,
    }
}

#[test]
fn bash_permission_is_shown_and_allow_once_echoes_the_original_input() {
    let registry = AgentApprovalRegistry::default();
    let input = json!({"command":"npm test","description":"Run tests"});
    let request =
        json!({"subtype":"can_use_tool","tool_name":"Bash","input":input,"tool_use_id":"toolu_1"});
    let (writer, seen) = capture();
    register(
        &registry,
        permission("claude-1", "Bash", &input, &request),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].kind, AgentApprovalKind::Command);
    assert_eq!(listed[0].detail, "npm test");
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Purpose" && f.value == "Run tests"));
    assert_eq!(
        listed[0].decisions,
        vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny
        ]
    );
    registry
        .answer("task", "claude-1", AgentApprovalDecision::AllowOnce)
        .unwrap();
    let written = seen.lock().unwrap();
    assert_eq!(written[0]["behavior"], "allow");
    assert_eq!(written[0]["updatedInput"], input);
    assert_eq!(written[0]["toolUseID"], "toolu_1");
    assert!(written[0].get("updatedPermissions").is_none());
}

#[test]
fn exit_plan_mode_is_a_plan_approval_and_deny_keeps_planning() {
    let registry = AgentApprovalRegistry::default();
    let input = json!({"plan":"1. Add tests\n2. Fix bug"});
    let request = json!({"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":input,
        "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"ExitPlanMode"}],"behavior":"allow","destination":"session"}]});
    let (writer, seen) = capture();
    register(
        &registry,
        permission("claude-2", "ExitPlanMode", &input, &request),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].kind, AgentApprovalKind::Plan);
    assert_eq!(listed[0].detail, "1. Add tests\n2. Fix bug");
    assert!(!listed[0]
        .decisions
        .contains(&AgentApprovalDecision::AllowForSession));
    registry
        .answer("task", "claude-2", AgentApprovalDecision::Deny)
        .unwrap();
    let written = seen.lock().unwrap();
    assert_eq!(written[0]["behavior"], "deny");
    assert_eq!(written[0]["message"], KEEP_PLANNING_MESSAGE);
}

#[test]
fn session_approval_uses_only_validated_allow_rules_scoped_to_the_session() {
    let registry = AgentApprovalRegistry::default();
    let input = json!({"command":"cargo test"});
    let request = json!({"subtype":"can_use_tool","tool_name":"Bash","input":input,"permission_suggestions":[
        {"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"cargo test:*"},{"toolName":"bad tool"},{"toolName":"Write"}],"behavior":"allow","destination":"localSettings"},
        {"type":"setMode","mode":"bypassPermissions","destination":"session"},
        {"type":"addRules","rules":[{"toolName":"Bash"}],"behavior":"deny","destination":"session"}
    ]});
    let (writer, seen) = capture();
    register(
        &registry,
        permission("claude-3", "Bash", &input, &request),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert!(listed[0]
        .decisions
        .contains(&AgentApprovalDecision::AllowForSession));
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Session approval covers" && f.value == "Bash(cargo test:*)"));
    registry
        .answer("task", "claude-3", AgentApprovalDecision::AllowForSession)
        .unwrap();
    let written = seen.lock().unwrap();
    assert_eq!(
        written[0]["updatedPermissions"],
        json!([{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"cargo test:*"}],"behavior":"allow","destination":"session"}])
    );
}

#[test]
fn file_changes_and_unknown_tools_are_bounded() {
    let registry = AgentApprovalRegistry::default();
    let huge = "x".repeat(MAX_AGENT_APPROVAL_DETAIL_BYTES * 2);
    let input = json!({"file_path":"/repo/a.ts","content":huge});
    let request = json!({"subtype":"can_use_tool","tool_name":"Write","input":input});
    let (writer, _) = capture();
    register(
        &registry,
        permission("claude-4", "Write", &input, &request),
        writer,
    )
    .unwrap();
    let mcp_input = json!({"query":"select 1"});
    let mcp_request =
        json!({"subtype":"can_use_tool","tool_name":"mcp__db__query","input":mcp_input});
    let (writer, _) = capture();
    register(
        &registry,
        permission("claude-5", "mcp__db__query", &mcp_input, &mcp_request),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert_eq!(listed[0].kind, AgentApprovalKind::FileChange);
    assert!(listed[0].detail_truncated);
    assert!(listed[0].detail.len() <= MAX_AGENT_APPROVAL_DETAIL_BYTES);
    assert!(listed[0]
        .facts
        .iter()
        .any(|f| f.label == "File" && f.value == "/repo/a.ts"));
    assert_eq!(listed[1].kind, AgentApprovalKind::Tool);
    assert!(listed[1].detail.contains("select 1"));
}

#[test]
fn bash_without_command_fails_closed() {
    let registry = AgentApprovalRegistry::default();
    let input = json!({});
    let request = json!({"subtype":"can_use_tool","tool_name":"Bash","input":input});
    let (writer, _) = capture();
    assert!(register(
        &registry,
        permission("claude-6", "Bash", &input, &request),
        writer
    )
    .is_err());
    assert!(registry.list("task").is_empty());
}

#[test]
fn session_rules_for_other_tools_do_not_offer_session_approval() {
    let registry = AgentApprovalRegistry::default();
    let input = json!({"command":"ls"});
    let request = json!({"subtype":"can_use_tool","tool_name":"Bash","input":input,"permission_suggestions":[
        {"type":"addRules","rules":[{"toolName":"Write"}],"behavior":"allow","destination":"session"}
    ]});
    let (writer, _) = capture();
    register(
        &registry,
        permission("claude-7", "Bash", &input, &request),
        writer,
    )
    .unwrap();
    let listed = registry.list("task");
    assert!(!listed[0]
        .decisions
        .contains(&AgentApprovalDecision::AllowForSession));
    assert!(!listed[0]
        .facts
        .iter()
        .any(|f| f.label == "Session approval covers"));
}

#[test]
fn a_whole_tool_rule_is_described_as_covering_every_use() {
    let rules = json!([{"toolName":"Bash"},{"toolName":"WebFetch","ruleContent":"domain:docs.rs"}]);
    assert_eq!(
        session_scope(&rules),
        "all Bash commands, WebFetch(domain:docs.rs)"
    );
}
