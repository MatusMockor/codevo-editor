use super::super::codex_app_server_protocol::{ServerNotification, ThreadItem};
use crate::agent_questions::approvals::{
    bounded_text, AgentApprovalDecision, AgentApprovalFact, AgentApprovalKind,
    AgentApprovalRegistry, AgentApprovalRequest, AgentApprovalStatus,
    MAX_AGENT_APPROVAL_DETAIL_BYTES, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES,
    MAX_AGENT_APPROVAL_TITLE_BYTES, TOO_MANY_PENDING_APPROVALS,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::Arc;

pub const CODEX_COMMAND_APPROVAL: &str = "item/commandExecution/requestApproval";
pub const CODEX_FILE_CHANGE_APPROVAL: &str = "item/fileChange/requestApproval";
pub const CODEX_MCP_ELICITATION: &str = "mcpServer/elicitation/request";
pub const CODEX_INTERACTIVE_APPROVAL_METHODS: [&str; 3] = [
    CODEX_COMMAND_APPROVAL,
    CODEX_FILE_CHANGE_APPROVAL,
    CODEX_MCP_ELICITATION,
];
const MAX_SERVER_NAME_BYTES: usize = 128;
pub const MAX_TRACKED_CODEX_ITEMS: usize = 64;
pub const MAX_LISTED_CODEX_FILES: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexApprovalRejection {
    ForeignTurn,
    MissingCommand,
    UnsupportedInput,
    Unsupported,
    Unavailable,
    TooManyPending,
}

impl CodexApprovalRejection {
    pub fn notice(self) -> &'static str {
        match self {
            Self::ForeignTurn => {
                "Codex asked for approval from another thread or an earlier turn, so it was declined."
            }
            Self::MissingCommand => {
                "Codex asked to run a command without naming it, so the request was declined."
            }
            Self::UnsupportedInput => {
                "An MCP server asked for input this editor cannot collect yet, so the request was declined."
            }
            Self::Unsupported => "Codex sent an approval request this editor does not support, so it was declined.",
            Self::Unavailable => "Codex asked for approval after the turn stopped accepting input, so it was declined.",
            Self::TooManyPending => {
                "Too many approvals were already waiting, so Codex's newest request was declined."
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexItemContext {
    Files { paths: Vec<String>, total: usize },
    Command { command: String },
}

#[derive(Debug, Default)]
pub struct CodexApprovalItems {
    entries: VecDeque<(String, CodexItemContext)>,
}

impl CodexApprovalItems {
    pub fn observe(&mut self, notification: &ServerNotification, thread_id: &str, turn_id: &str) {
        let ServerNotification::ItemStarted(started) = notification else {
            return;
        };
        if started.thread_id != thread_id || started.turn_id.as_deref() != Some(turn_id) {
            return;
        }
        let (id, context) = match &started.item {
            ThreadItem::FileChange(item) => (
                item.id.clone(),
                CodexItemContext::Files {
                    paths: item
                        .changes
                        .iter()
                        .take(MAX_LISTED_CODEX_FILES)
                        .map(|change| {
                            bounded_text(&change.path, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES).0
                        })
                        .collect(),
                    total: item.changes.len(),
                },
            ),
            ThreadItem::CommandExecution(item) => match &item.command {
                Some(command) => (
                    item.id.clone(),
                    CodexItemContext::Command {
                        command: bounded_text(command, MAX_AGENT_APPROVAL_DETAIL_BYTES).0,
                    },
                ),
                None => return,
            },
            _ => return,
        };
        self.entries.retain(|(known, _)| known != &id);
        if self.entries.len() == MAX_TRACKED_CODEX_ITEMS {
            self.entries.pop_front();
        }
        self.entries.push_back((id, context));
    }

    fn get(&self, params: &Value) -> Option<&CodexItemContext> {
        let id = params.get("itemId").and_then(Value::as_str)?;
        self.entries
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, context)| context)
    }
}

pub type CodexApprovalWriter = Arc<dyn Fn(Value) -> Result<(), String> + Send + Sync>;

pub struct CodexApprovalRoute<'a> {
    pub thread_id: &'a str,
    pub turn_id: &'a str,
}

pub fn is_interactive_approval(method: &str) -> bool {
    CODEX_INTERACTIVE_APPROVAL_METHODS.contains(&method)
}

pub fn approval_request_id(rpc_id: &Value) -> String {
    format!(
        "codex-question-{:x}",
        Sha256::digest(rpc_id.to_string().as_bytes())
    )
}

pub fn decline_result(method: &str) -> Option<Value> {
    match method {
        CODEX_COMMAND_APPROVAL | CODEX_FILE_CHANGE_APPROVAL => {
            Some(json!({ "decision": "decline" }))
        }
        "execCommandApproval" | "applyPatchApproval" => Some(json!({ "decision": "denied" })),
        "item/permissions/requestApproval" => Some(json!({ "permissions": {}, "scope": "turn" })),
        CODEX_MCP_ELICITATION => Some(json!({ "action": "decline" })),
        "item/tool/call" => Some(json!({
            "success": false,
            "contentItems": [{
                "type": "inputText",
                "text": "Codevo cannot run client-side tools for Codex.",
            }],
        })),
        _ => None,
    }
}

pub fn register(
    approvals: &AgentApprovalRegistry,
    route: &CodexApprovalRoute<'_>,
    rpc_id: &Value,
    method: &str,
    params: &Value,
    items: &CodexApprovalItems,
    write: CodexApprovalWriter,
) -> Result<(), CodexApprovalRejection> {
    ensure_route(route, method, params)?;
    let approval = describe(approval_request_id(rpc_id), method, params, items)?;
    let method = method.to_string();
    approvals
        .register(
            approval,
            Arc::new(move |decision| write(result_for(&method, decision)?)),
        )
        .map_err(|error| match error.as_str() {
            TOO_MANY_PENDING_APPROVALS => CodexApprovalRejection::TooManyPending,
            _ => CodexApprovalRejection::Unavailable,
        })
}

fn ensure_route(
    route: &CodexApprovalRoute<'_>,
    method: &str,
    params: &Value,
) -> Result<(), CodexApprovalRejection> {
    let thread = params.get("threadId").and_then(Value::as_str);
    let turn = params.get("turnId").and_then(Value::as_str);
    let turn_matches = match (method, turn) {
        (CODEX_MCP_ELICITATION, None) => true,
        (_, Some(turn)) => turn == route.turn_id,
        (_, None) => false,
    };
    if thread != Some(route.thread_id) || !turn_matches {
        return Err(CodexApprovalRejection::ForeignTurn);
    }
    Ok(())
}

fn result_for(method: &str, decision: AgentApprovalDecision) -> Result<Value, String> {
    match (method, decision) {
        (CODEX_MCP_ELICITATION, AgentApprovalDecision::AllowOnce) => {
            Ok(json!({ "action": "accept", "content": {} }))
        }
        (CODEX_MCP_ELICITATION, AgentApprovalDecision::Deny) => Ok(json!({ "action": "decline" })),
        (CODEX_MCP_ELICITATION, AgentApprovalDecision::AllowForSession) => {
            Err("Session approval is unavailable for this request.".into())
        }
        (_, AgentApprovalDecision::AllowOnce) => Ok(json!({ "decision": "accept" })),
        (_, AgentApprovalDecision::AllowForSession) => {
            Ok(json!({ "decision": "acceptForSession" }))
        }
        (_, AgentApprovalDecision::Deny) => Ok(json!({ "decision": "decline" })),
    }
}

fn describe(
    id: String,
    method: &str,
    params: &Value,
    items: &CodexApprovalItems,
) -> Result<AgentApprovalRequest, CodexApprovalRejection> {
    let (kind, title, raw_detail, facts, decisions) = match method {
        CODEX_COMMAND_APPROVAL => command(params, items)?,
        CODEX_FILE_CHANGE_APPROVAL => file_change(params, items)?,
        CODEX_MCP_ELICITATION => elicitation(params)?,
        _ => return Err(CodexApprovalRejection::Unsupported),
    };
    let (detail, detail_truncated) = bounded_text(&raw_detail, MAX_AGENT_APPROVAL_DETAIL_BYTES);
    Ok(AgentApprovalRequest {
        id,
        task_id: String::new(),
        provider: "codex".into(),
        kind,
        title: bounded_text(&title, MAX_AGENT_APPROVAL_TITLE_BYTES).0,
        detail,
        detail_truncated,
        facts,
        decisions,
        status: AgentApprovalStatus::Pending,
        decision: None,
    })
}

type Description = (
    AgentApprovalKind,
    String,
    String,
    Vec<AgentApprovalFact>,
    Vec<AgentApprovalDecision>,
);

fn command(
    params: &Value,
    items: &CodexApprovalItems,
) -> Result<Description, CodexApprovalRejection> {
    let known_command = || match items.get(params) {
        Some(CodexItemContext::Command { command }) => Some(command.clone()),
        _ => None,
    };
    match params
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("command")
    {
        "command" => (),
        "writeStdin" => {
            return Ok((
                AgentApprovalKind::Command,
                "Send input to a running command?".into(),
                text(params, "command")
                    .or_else(known_command)
                    .unwrap_or_default(),
                facts(&[
                    (
                        "Action",
                        Some("Codex wants to type into a terminal it already started.".into()),
                    ),
                    ("Directory", text(params, "cwd")),
                    ("Reason", text(params, "reason")),
                ]),
                decisions(params)?,
            ))
        }
        _ => return Err(CodexApprovalRejection::Unsupported),
    }
    let network = params
        .get("networkApprovalContext")
        .and_then(|context| context.get("host"))
        .and_then(Value::as_str);
    let command = text(params, "command");
    if command.is_none() && network.is_none() {
        return Err(CodexApprovalRejection::MissingCommand);
    }
    let title = match network {
        Some(_) => "Allow network access?",
        None => "Run a command?",
    };
    Ok((
        AgentApprovalKind::Command,
        title.into(),
        command.unwrap_or_default(),
        facts(&[
            ("Directory", text(params, "cwd")),
            ("Reason", text(params, "reason")),
            ("Network host", network.map(str::to_string)),
        ]),
        decisions(params)?,
    ))
}

fn file_change(
    params: &Value,
    items: &CodexApprovalItems,
) -> Result<Description, CodexApprovalRejection> {
    let (detail, files_fact) = match items.get(params) {
        Some(CodexItemContext::Files { paths, total }) if !paths.is_empty() => {
            let mut lines = paths.clone();
            if *total > paths.len() {
                lines.push(format!("+{} more", total - paths.len()));
            }
            (lines.join("\n"), None)
        }
        _ => (
            String::new(),
            Some("Codex did not list the files for this change.".to_string()),
        ),
    };
    Ok((
        AgentApprovalKind::FileChange,
        "Apply file changes?".into(),
        detail,
        facts(&[
            ("Files", files_fact),
            ("Reason", text(params, "reason")),
            ("Write access requested for", text(params, "grantRoot")),
        ]),
        decisions(params)?,
    ))
}

fn elicitation(params: &Value) -> Result<Description, CodexApprovalRejection> {
    let mode = params.get("mode").and_then(Value::as_str).unwrap_or("form");
    let fields = params
        .get("requestedSchema")
        .and_then(|schema| schema.get("properties"))
        .and_then(Value::as_object)
        .map_or(0, serde_json::Map::len);
    if mode != "form" || fields != 0 {
        return Err(CodexApprovalRejection::UnsupportedInput);
    }
    let server = text(params, "serverName").ok_or(CodexApprovalRejection::Unsupported)?;
    let (server, _) = bounded_text(&server, MAX_SERVER_NAME_BYTES);
    Ok((
        AgentApprovalKind::McpElicitation,
        format!("{server} asks for confirmation"),
        text(params, "message").unwrap_or_default(),
        facts(&[("MCP server", Some(server.clone()))]),
        vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny,
        ],
    ))
}

fn decisions(params: &Value) -> Result<Vec<AgentApprovalDecision>, CodexApprovalRejection> {
    let Some(available) = params.get("availableDecisions").filter(|v| !v.is_null()) else {
        return Ok(vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::AllowForSession,
            AgentApprovalDecision::Deny,
        ]);
    };
    let available = available
        .as_array()
        .ok_or(CodexApprovalRejection::Unsupported)?;
    let offered = |name: &str| available.iter().any(|item| item.as_str() == Some(name));
    let mut decisions = Vec::new();
    if offered("accept") {
        decisions.push(AgentApprovalDecision::AllowOnce);
    }
    if offered("acceptForSession") {
        decisions.push(AgentApprovalDecision::AllowForSession);
    }
    decisions.push(AgentApprovalDecision::Deny);
    Ok(decisions)
}

fn text(params: &Value, field: &str) -> Option<String> {
    params
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn facts(candidates: &[(&str, Option<String>)]) -> Vec<AgentApprovalFact> {
    candidates
        .iter()
        .filter_map(|(label, value)| {
            let value = value.as_ref()?;
            Some(AgentApprovalFact {
                label: (*label).into(),
                value: bounded_text(value, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES).0,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "codex_app_server_approvals_tests.rs"]
mod tests;
