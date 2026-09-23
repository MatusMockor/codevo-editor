use crate::agent_questions::approvals::{
    bounded_text, AgentApprovalDecision, AgentApprovalFact, AgentApprovalKind,
    AgentApprovalRegistry, AgentApprovalRequest, AgentApprovalStatus,
    MAX_AGENT_APPROVAL_DETAIL_BYTES, MAX_AGENT_APPROVAL_FACTS, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES,
    MAX_AGENT_APPROVAL_TITLE_BYTES,
};
use serde_json::{json, Value};
use std::sync::Arc;

const MAX_SESSION_RULES: usize = 16;
const MAX_RULE_TOOL_BYTES: usize = 128;
const MAX_RULE_CONTENT_BYTES: usize = 1024;
const PLAN_TOOL: &str = "ExitPlanMode";
const KEEP_PLANNING_MESSAGE: &str =
    "The user wants to keep planning. Stay in plan mode and refine the plan.";
const DENIED_MESSAGE: &str = "The user denied this action.";

pub type ClaudeControlWriter = Arc<dyn Fn(Value) -> Result<(), String> + Send + Sync>;

pub struct ClaudePermissionRequest<'a> {
    pub public_id: String,
    pub tool_name: &'a str,
    pub input: &'a Value,
    pub request: &'a Value,
}

pub fn register(
    approvals: &AgentApprovalRegistry,
    permission: ClaudePermissionRequest<'_>,
    write: ClaudeControlWriter,
) -> Result<(), String> {
    let session_rules = session_rules(permission.request, permission.tool_name);
    let approval = describe(&permission, session_rules.as_ref())?;
    let original = permission.input.clone();
    let tool_use_id = permission.request.get("tool_use_id").cloned();
    let plan = approval.kind == AgentApprovalKind::Plan;
    approvals.register(
        approval,
        Arc::new(move |decision| {
            write(response_for(
                decision,
                &original,
                tool_use_id.as_ref(),
                session_rules.as_ref(),
                plan,
            )?)
        }),
    )
}

fn response_for(
    decision: AgentApprovalDecision,
    original: &Value,
    tool_use_id: Option<&Value>,
    session_rules: Option<&Value>,
    plan: bool,
) -> Result<Value, String> {
    if decision == AgentApprovalDecision::Deny {
        let message = if plan {
            KEEP_PLANNING_MESSAGE
        } else {
            DENIED_MESSAGE
        };
        return Ok(json!({"behavior":"deny","message":message}));
    }
    let mut result = json!({"behavior":"allow","updatedInput":original});
    if let Some(tool_use_id) = tool_use_id {
        result["toolUseID"] = tool_use_id.clone();
    }
    if decision == AgentApprovalDecision::AllowOnce {
        return Ok(result);
    }
    let rules = session_rules.ok_or("Session approval is unavailable for this request.")?;
    result["updatedPermissions"] = json!([{
        "type": "addRules",
        "rules": rules,
        "behavior": "allow",
        "destination": "session",
    }]);
    Ok(result)
}

fn session_rules(request: &Value, tool: &str) -> Option<Value> {
    let suggestions = request.get("permission_suggestions")?.as_array()?;
    let mut rules = Vec::new();
    for suggestion in suggestions.iter().take(MAX_SESSION_RULES) {
        if suggestion.get("type").and_then(Value::as_str) != Some("addRules")
            || suggestion.get("behavior").and_then(Value::as_str) != Some("allow")
        {
            continue;
        }
        let Some(items) = suggestion.get("rules").and_then(Value::as_array) else {
            continue;
        };
        for rule in items {
            if rules.len() == MAX_SESSION_RULES {
                break;
            }
            if let Some(rule) = session_rule(rule).filter(|rule| rule["toolName"] == tool) {
                rules.push(rule);
            }
        }
    }
    if rules.is_empty() {
        return None;
    }
    Some(Value::Array(rules))
}

fn session_rule(rule: &Value) -> Option<Value> {
    let tool = rule.get("toolName")?.as_str()?;
    if tool.is_empty()
        || tool.len() > MAX_RULE_TOOL_BYTES
        || !tool
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-.:".contains(&b))
    {
        return None;
    }
    let Some(content) = rule.get("ruleContent") else {
        return Some(json!({"toolName":tool}));
    };
    let content = content.as_str()?;
    if content.len() > MAX_RULE_CONTENT_BYTES || content.contains('\0') {
        return None;
    }
    Some(json!({"toolName":tool,"ruleContent":content}))
}

fn describe(
    permission: &ClaudePermissionRequest<'_>,
    session_rules: Option<&Value>,
) -> Result<AgentApprovalRequest, String> {
    let tool = permission.tool_name;
    if tool.is_empty() || tool.len() > MAX_RULE_TOOL_BYTES {
        return Err("Invalid tool name.".into());
    }
    let input = permission.input;
    let (kind, title, raw_detail) = match tool {
        PLAN_TOOL => (
            AgentApprovalKind::Plan,
            "Approve the plan?".to_string(),
            string_field(input, "plan").unwrap_or_default(),
        ),
        "Bash" => (
            AgentApprovalKind::Command,
            "Run a command?".to_string(),
            string_field(input, "command").ok_or("Missing command.")?,
        ),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => (
            AgentApprovalKind::FileChange,
            format!("Allow {tool} to change a file?"),
            file_preview(input),
        ),
        _ => (
            AgentApprovalKind::Tool,
            format!("Allow {tool}?"),
            serde_json::to_string_pretty(input).unwrap_or_default(),
        ),
    };
    let (detail, detail_truncated) = bounded_text(&raw_detail, MAX_AGENT_APPROVAL_DETAIL_BYTES);
    let (title, _) = bounded_text(
        &provider_title(permission.request).unwrap_or(title),
        MAX_AGENT_APPROVAL_TITLE_BYTES,
    );
    let session_rules = session_rules.filter(|_| kind != AgentApprovalKind::Plan);
    let mut decisions = vec![AgentApprovalDecision::AllowOnce];
    if session_rules.is_some() {
        decisions.push(AgentApprovalDecision::AllowForSession);
    }
    decisions.push(AgentApprovalDecision::Deny);
    let mut facts = facts(tool, input, permission.request);
    if let Some(scope) = session_rules.map(session_scope) {
        facts.truncate(MAX_AGENT_APPROVAL_FACTS - 1);
        facts.push(AgentApprovalFact {
            label: "Session approval covers".into(),
            value: bounded_text(&scope, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES).0,
        });
    }
    Ok(AgentApprovalRequest {
        id: permission.public_id.clone(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        kind,
        title,
        detail,
        detail_truncated,
        facts,
        decisions,
        status: AgentApprovalStatus::Pending,
        decision: None,
    })
}

fn session_scope(rules: &Value) -> String {
    rules
        .as_array()
        .map(|rules| {
            rules
                .iter()
                .filter_map(|rule| {
                    let tool = rule.get("toolName")?.as_str()?;
                    Some(match rule.get("ruleContent").and_then(Value::as_str) {
                        Some(content) => format!("{tool}({content})"),
                        None if tool == "Bash" => "all Bash commands".to_string(),
                        None => format!("all {tool} requests"),
                    })
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

fn provider_title(request: &Value) -> Option<String> {
    request
        .get("title")
        .and_then(Value::as_str)
        .filter(|title| !title.trim().is_empty())
        .map(str::to_string)
}

fn string_field(input: &Value, field: &str) -> Option<String> {
    input.get(field).and_then(Value::as_str).map(str::to_string)
}

fn file_preview(input: &Value) -> String {
    let body = ["content", "new_string", "new_source"]
        .iter()
        .find_map(|field| string_field(input, field));
    if let Some(body) = body {
        return body;
    }
    let Some(edits) = input.get("edits").and_then(Value::as_array) else {
        return String::new();
    };
    edits
        .iter()
        .filter_map(|edit| string_field(edit, "new_string"))
        .collect::<Vec<_>>()
        .join("\n---\n")
}

fn facts(tool: &str, input: &Value, request: &Value) -> Vec<AgentApprovalFact> {
    let candidates = [
        ("Tool", Some(tool.to_string())),
        (
            "File",
            string_field(input, "file_path").or_else(|| string_field(input, "notebook_path")),
        ),
        ("Purpose", string_field(input, "description")),
        ("Blocked path", string_field(request, "blocked_path")),
        ("Reason", string_field(request, "decision_reason")),
        ("Details", string_field(request, "description")),
    ];
    candidates
        .into_iter()
        .filter_map(|(label, value)| {
            let value = value.filter(|value| !value.trim().is_empty())?;
            Some(AgentApprovalFact {
                label: label.into(),
                value: bounded_text(&value, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES).0,
            })
        })
        .take(MAX_AGENT_APPROVAL_FACTS)
        .collect()
}

#[cfg(test)]
#[path = "agent_claude_approvals_tests.rs"]
mod tests;
