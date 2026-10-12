use crate::agent_mcp_server_manage_domain::{
    is_valid_change, AgentMcpServerChange, AgentMcpServerConfigScope, AgentMcpServerLaunch,
    AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR, AGENT_MCP_SERVER_EXISTS_ERROR,
    AGENT_MCP_SERVER_NOT_FOUND_ERROR,
};
use crate::agent_mcp_servers_domain::{
    AGENT_MCP_SERVERS_TIMED_OUT_ERROR, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
};
use crate::agent_mcp_servers_protocol::{
    claude_control_response, codex_mcp_config_request, BoundedLines, McpProbeStep,
    CLAUDE_MCP_INITIALIZE_REQUEST_ID, CODEX_MCP_CONFIG_REQUEST_ID,
    MAX_CLAUDE_MCP_STATUS_LINE_BYTES, MAX_CODEX_MCP_STATUS_LINE_BYTES,
};
use crate::agent_task_spawner::AgentCliInvocation;
use serde_json::{json, Value};

pub const CODEX_HANDSHAKE_REPLY_ID: u64 = 0;
pub const CODEX_MCP_CONFIG_WRITE_REQUEST_ID: u64 = 3;
pub const CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID: &str = "codevo-mcp-server-clear-auth";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpChangeFailure {
    ServerExists,
    ServerNotFound,
    ChangeUnsupported,
    TimedOut,
    Unavailable,
}

impl McpChangeFailure {
    pub fn message(self) -> &'static str {
        match self {
            Self::ServerExists => AGENT_MCP_SERVER_EXISTS_ERROR,
            Self::ServerNotFound => AGENT_MCP_SERVER_NOT_FOUND_ERROR,
            Self::ChangeUnsupported => AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR,
            Self::TimedOut => AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
            Self::Unavailable => AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderRefusal {
    ServerNotFound,
    Unsupported,
    Other,
}

impl ProviderRefusal {
    fn change_failure(self) -> McpChangeFailure {
        match self {
            Self::ServerNotFound => McpChangeFailure::ServerNotFound,
            Self::Unsupported => McpChangeFailure::ChangeUnsupported,
            Self::Other => McpChangeFailure::Unavailable,
        }
    }
}

const CODEX_LOGIN_UNSUPPORTED_MESSAGE: &str =
    "OAuth login is only supported for streamable HTTP servers.";
const CODEX_LOGOUT_UNSUPPORTED_LINE: &str =
    "Error: OAuth logout is only supported for streamable_http transports.";

fn is_transport_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn names_unsupported_transport(error: &str, prefix: &str, suffix: &str) -> bool {
    error
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_suffix(suffix))
        .is_some_and(is_transport_token)
}

fn claude_refusal(error: &str, name: &str) -> ProviderRefusal {
    if error.strip_prefix("Server not found: ") == Some(name) {
        return ProviderRefusal::ServerNotFound;
    }
    if names_unsupported_transport(
        error,
        "Server type \"",
        "\" does not support OAuth authentication",
    ) || names_unsupported_transport(error, "Cannot clear auth for server type \"", "\"")
    {
        return ProviderRefusal::Unsupported;
    }
    ProviderRefusal::Other
}

fn codex_refusal(message: &str, name: &str) -> ProviderRefusal {
    let named = message
        .strip_prefix("No MCP server named '")
        .and_then(|rest| rest.strip_suffix("' found."));
    if named == Some(name) {
        return ProviderRefusal::ServerNotFound;
    }
    if message == CODEX_LOGIN_UNSUPPORTED_MESSAGE {
        return ProviderRefusal::Unsupported;
    }
    ProviderRefusal::Other
}

pub(crate) struct ClaudeControlReply {
    pub(crate) request_id: String,
    pub(crate) result: Result<Value, ProviderRefusal>,
}

pub(crate) fn claude_control_reply(line: &[u8], name: &str) -> Option<ClaudeControlReply> {
    let mut body = claude_control_response(line)?;
    let request_id = body.get("request_id")?.as_str()?.to_string();
    if body.get("subtype").and_then(Value::as_str) == Some("success") {
        let response = body.get_mut("response").map_or(Value::Null, Value::take);
        return Some(ClaudeControlReply {
            request_id,
            result: Ok(response),
        });
    }
    let refusal = claude_refusal(
        body.get("error")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        name,
    );
    Some(ClaudeControlReply {
        request_id,
        result: Err(refusal),
    })
}

fn json_line(value: &Value) -> Vec<u8> {
    let mut line = value.to_string();
    line.push('\n');
    line.into_bytes()
}

pub(crate) fn claude_control_request(request_id: &str, request: Value) -> Vec<u8> {
    json_line(&json!({
        "type": "control_request",
        "request_id": request_id,
        "request": request,
    }))
}

pub(crate) fn codex_request(id: u64, method: &str, params: Value) -> Vec<u8> {
    json_line(&json!({ "method": method, "id": id, "params": params }))
}

pub(crate) struct CodexReply {
    pub(crate) id: u64,
    pub(crate) result: Result<Value, ProviderRefusal>,
}

pub(crate) fn codex_reply(message: &mut Value, name: &str) -> Option<CodexReply> {
    if message.get("method").is_some() {
        return None;
    }
    let id = message.get("id").and_then(Value::as_u64)?;
    if let Some(error) = message.get("error") {
        let refusal = codex_refusal(
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            name,
        );
        return Some(CodexReply {
            id,
            result: Err(refusal),
        });
    }
    let result = message.get_mut("result").map(Value::take)?;
    Some(CodexReply {
        id,
        result: Ok(result),
    })
}

fn scope_argument(scope: AgentMcpServerConfigScope) -> &'static str {
    match scope {
        AgentMcpServerConfigScope::User => "user",
        AgentMcpServerConfigScope::Project => "project",
        AgentMcpServerConfigScope::Local => "local",
    }
}

fn has_line(output: &[u8], expected: &str) -> bool {
    String::from_utf8_lossy(output)
        .lines()
        .any(|line| line.trim() == expected)
}

fn claude_missing_location(scope: AgentMcpServerConfigScope) -> &'static str {
    match scope {
        AgentMcpServerConfigScope::User => "user scope",
        AgentMcpServerConfigScope::Local => "local scope",
        AgentMcpServerConfigScope::Project => ".mcp.json",
    }
}

pub enum McpCommandCompletion<'a> {
    Succeeded { stdout: &'a [u8] },
    Failed { stderr: &'a [u8] },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpChangeCommand {
    ClaudeAdd {
        name: String,
        scope: AgentMcpServerConfigScope,
        launch: AgentMcpServerLaunch,
    },
    ClaudeRemove {
        name: String,
        scope: AgentMcpServerConfigScope,
    },
    CodexRemove {
        name: String,
    },
    CodexSignOut {
        name: String,
    },
}

fn claude_add_args(
    name: &str,
    scope: AgentMcpServerConfigScope,
    launch: &AgentMcpServerLaunch,
) -> Vec<String> {
    let (transport, target, extra): (&str, &str, &[String]) = match launch {
        AgentMcpServerLaunch::Http { url } => ("http", url, &[]),
        AgentMcpServerLaunch::Sse { url } => ("sse", url, &[]),
        AgentMcpServerLaunch::Stdio { command, args } => ("stdio", command, args),
    };
    [
        "mcp",
        "add",
        "--scope",
        scope_argument(scope),
        "--transport",
        transport,
        "--",
        name,
        target,
    ]
    .into_iter()
    .map(str::to_string)
    .chain(extra.iter().cloned())
    .collect()
}

fn fixed_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_string()).collect()
}

impl McpChangeCommand {
    pub fn args(&self) -> Vec<String> {
        match self {
            Self::ClaudeAdd {
                name,
                scope,
                launch,
            } => claude_add_args(name, *scope, launch),
            Self::ClaudeRemove { name, scope } => fixed_args(&[
                "mcp",
                "remove",
                "--scope",
                scope_argument(*scope),
                "--",
                name,
            ]),
            Self::CodexRemove { name } => fixed_args(&["mcp", "remove", "--", name]),
            Self::CodexSignOut { name } => fixed_args(&["mcp", "logout", "--", name]),
        }
    }

    pub fn outcome(&self, completion: McpCommandCompletion<'_>) -> Result<(), McpChangeFailure> {
        match (self, completion) {
            (Self::CodexRemove { name }, McpCommandCompletion::Succeeded { stdout }) => {
                if has_line(stdout, &format!("No MCP server named '{name}' found.")) {
                    return Err(McpChangeFailure::ServerNotFound);
                }
                Ok(())
            }
            (_, McpCommandCompletion::Succeeded { .. }) => Ok(()),
            (Self::ClaudeAdd { name, scope, .. }, McpCommandCompletion::Failed { stderr }) => {
                let exists = format!(
                    "MCP server {name} already exists in {} config",
                    scope_argument(*scope)
                );
                if has_line(stderr, &exists) {
                    return Err(McpChangeFailure::ServerExists);
                }
                Err(McpChangeFailure::Unavailable)
            }
            (Self::ClaudeRemove { name, scope }, McpCommandCompletion::Failed { stderr }) => {
                let missing = format!(
                    "No MCP server named \"{name}\" in {}",
                    claude_missing_location(*scope)
                );
                if has_line(stderr, &missing) {
                    return Err(McpChangeFailure::ServerNotFound);
                }
                Err(McpChangeFailure::Unavailable)
            }
            (Self::CodexSignOut { name }, McpCommandCompletion::Failed { stderr }) => {
                Err(codex_sign_out_failure(name, stderr))
            }
            (Self::CodexRemove { .. }, McpCommandCompletion::Failed { .. }) => {
                Err(McpChangeFailure::Unavailable)
            }
        }
    }
}

fn codex_sign_out_failure(name: &str, stderr: &[u8]) -> McpChangeFailure {
    let missing = format!("Error: No MCP server named '{name}' found in configuration.");
    if has_line(stderr, &missing) {
        return McpChangeFailure::ServerNotFound;
    }
    if has_line(stderr, CODEX_LOGOUT_UNSUPPORTED_LINE) {
        return McpChangeFailure::ChangeUnsupported;
    }
    McpChangeFailure::Unavailable
}

enum ClaudeClearAuthPhase {
    Initializing,
    Initialized,
    Requested,
    Settled(Result<(), McpChangeFailure>),
}

pub struct ClaudeMcpClearAuth {
    name: String,
    lines: BoundedLines,
    phase: ClaudeClearAuthPhase,
}

impl ClaudeMcpClearAuth {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            lines: BoundedLines::new(MAX_CLAUDE_MCP_STATUS_LINE_BYTES),
            phase: ClaudeClearAuthPhase::Initializing,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        if matches!(self.phase, ClaudeClearAuthPhase::Settled(_)) {
            return;
        }
        let Ok(lines) = self.lines.push(bytes) else {
            self.phase = ClaudeClearAuthPhase::Settled(Err(McpChangeFailure::Unavailable));
            return;
        };
        lines.iter().for_each(|line| self.observe_line(line));
    }

    fn observe_line(&mut self, line: &[u8]) {
        let Some(reply) = claude_control_reply(line, &self.name) else {
            return;
        };
        let next = match (&self.phase, reply.request_id.as_str()) {
            (ClaudeClearAuthPhase::Initializing, CLAUDE_MCP_INITIALIZE_REQUEST_ID) => {
                match reply.result {
                    Ok(_) => ClaudeClearAuthPhase::Initialized,
                    Err(_) => ClaudeClearAuthPhase::Settled(Err(McpChangeFailure::Unavailable)),
                }
            }
            (ClaudeClearAuthPhase::Requested, CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID) => {
                ClaudeClearAuthPhase::Settled(
                    reply
                        .result
                        .map(|_| ())
                        .map_err(ProviderRefusal::change_failure),
                )
            }
            _ => return,
        };
        self.phase = next;
    }

    fn step(&mut self) -> McpProbeStep {
        match self.phase {
            ClaudeClearAuthPhase::Initializing | ClaudeClearAuthPhase::Requested => {
                McpProbeStep::Wait
            }
            ClaudeClearAuthPhase::Settled(_) => McpProbeStep::Done,
            ClaudeClearAuthPhase::Initialized => {
                self.phase = ClaudeClearAuthPhase::Requested;
                McpProbeStep::Write(claude_clear_auth_request(
                    CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID,
                    &self.name,
                ))
            }
        }
    }

    fn outcome(&self) -> Option<Result<(), McpChangeFailure>> {
        match self.phase {
            ClaudeClearAuthPhase::Settled(outcome) => Some(outcome),
            _ => None,
        }
    }
}

pub(crate) fn claude_clear_auth_request(request_id: &str, name: &str) -> Vec<u8> {
    claude_control_request(
        request_id,
        json!({ "subtype": "mcp_clear_auth", "serverName": name }),
    )
}

enum CodexAddPhase {
    Handshake,
    Connected,
    Reading,
    Absent,
    Writing,
    Settled(Result<(), McpChangeFailure>),
}

pub struct CodexMcpServerAdd {
    name: String,
    launch: Value,
    workspace_root: String,
    lines: BoundedLines,
    phase: CodexAddPhase,
}

fn codex_launch_value(launch: &AgentMcpServerLaunch) -> Option<Value> {
    match launch {
        AgentMcpServerLaunch::Http { url } => Some(json!({ "url": url })),
        AgentMcpServerLaunch::Stdio { command, args } => {
            Some(json!({ "command": command, "args": args }))
        }
        AgentMcpServerLaunch::Sse { .. } => None,
    }
}

fn configured_codex_servers(result: &Value) -> Option<Option<&Value>> {
    let config = result.get("config").filter(|config| config.is_object())?;
    Some(
        config
            .get("mcp_servers")
            .filter(|servers| !servers.is_null()),
    )
}

fn is_configured_in_codex(result: &Value, name: &str) -> Option<bool> {
    let servers = configured_codex_servers(result)?;
    Some(servers.is_some_and(|servers| servers.get(name).is_some_and(|server| !server.is_null())))
}

impl CodexMcpServerAdd {
    fn new(name: &str, launch: Value, workspace_root: &str) -> Self {
        Self {
            name: name.to_string(),
            launch,
            workspace_root: workspace_root.to_string(),
            lines: BoundedLines::new(MAX_CODEX_MCP_STATUS_LINE_BYTES),
            phase: CodexAddPhase::Handshake,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        if matches!(self.phase, CodexAddPhase::Settled(_)) {
            return;
        }
        let Ok(lines) = self.lines.push(bytes) else {
            self.phase = CodexAddPhase::Settled(Err(McpChangeFailure::Unavailable));
            return;
        };
        lines.iter().for_each(|line| self.observe_line(line));
    }

    fn observe_line(&mut self, line: &[u8]) {
        let Ok(mut message) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        let Some(reply) = codex_reply(&mut message, &self.name) else {
            return;
        };
        let unavailable = CodexAddPhase::Settled(Err(McpChangeFailure::Unavailable));
        let next = match (&self.phase, reply.id, reply.result) {
            (CodexAddPhase::Handshake, CODEX_HANDSHAKE_REPLY_ID, Ok(_)) => CodexAddPhase::Connected,
            (CodexAddPhase::Handshake, CODEX_HANDSHAKE_REPLY_ID, Err(_)) => unavailable,
            (CodexAddPhase::Reading, CODEX_MCP_CONFIG_REQUEST_ID, Ok(result)) => {
                match is_configured_in_codex(&result, &self.name) {
                    Some(false) => CodexAddPhase::Absent,
                    Some(true) => CodexAddPhase::Settled(Err(McpChangeFailure::ServerExists)),
                    None => unavailable,
                }
            }
            (CodexAddPhase::Reading, CODEX_MCP_CONFIG_REQUEST_ID, Err(_)) => unavailable,
            (CodexAddPhase::Writing, CODEX_MCP_CONFIG_WRITE_REQUEST_ID, Ok(_)) => {
                CodexAddPhase::Settled(Ok(()))
            }
            (CodexAddPhase::Writing, CODEX_MCP_CONFIG_WRITE_REQUEST_ID, Err(_)) => unavailable,
            _ => return,
        };
        self.phase = next;
    }

    fn write_request(&self) -> Vec<u8> {
        codex_request(
            CODEX_MCP_CONFIG_WRITE_REQUEST_ID,
            "config/batchWrite",
            json!({
                "edits": [{
                    "keyPath": format!("mcp_servers.{}", self.name),
                    "mergeStrategy": "replace",
                    "value": self.launch,
                }],
            }),
        )
    }

    fn step(&mut self) -> McpProbeStep {
        match self.phase {
            CodexAddPhase::Handshake | CodexAddPhase::Reading | CodexAddPhase::Writing => {
                McpProbeStep::Wait
            }
            CodexAddPhase::Settled(_) => McpProbeStep::Done,
            CodexAddPhase::Connected => {
                self.phase = CodexAddPhase::Reading;
                McpProbeStep::Write(codex_mcp_config_request(&self.workspace_root))
            }
            CodexAddPhase::Absent => {
                self.phase = CodexAddPhase::Writing;
                McpProbeStep::Write(self.write_request())
            }
        }
    }

    fn outcome(&self) -> Option<Result<(), McpChangeFailure>> {
        match self.phase {
            CodexAddPhase::Settled(outcome) => Some(outcome),
            _ => None,
        }
    }
}

pub enum McpChangeExchange {
    ClaudeClearAuth(ClaudeMcpClearAuth),
    CodexAdd(CodexMcpServerAdd),
}

impl McpChangeExchange {
    pub fn observe(&mut self, bytes: &[u8]) {
        match self {
            Self::ClaudeClearAuth(exchange) => exchange.observe(bytes),
            Self::CodexAdd(exchange) => exchange.observe(bytes),
        }
    }

    pub fn step(&mut self) -> McpProbeStep {
        match self {
            Self::ClaudeClearAuth(exchange) => exchange.step(),
            Self::CodexAdd(exchange) => exchange.step(),
        }
    }

    pub fn outcome(&self) -> Option<Result<(), McpChangeFailure>> {
        match self {
            Self::ClaudeClearAuth(exchange) => exchange.outcome(),
            Self::CodexAdd(exchange) => exchange.outcome(),
        }
    }
}

pub enum McpChangeOperation {
    Command(McpChangeCommand),
    Exchange(McpChangeExchange),
}

pub fn mcp_change_operation(
    provider: AgentCliInvocation,
    change: &AgentMcpServerChange,
    workspace_root: &str,
) -> Result<McpChangeOperation, McpChangeFailure> {
    if !is_valid_change(provider, change) {
        return Err(McpChangeFailure::Unavailable);
    }
    let operation = match (provider, change) {
        (
            AgentCliInvocation::ClaudeCode,
            AgentMcpServerChange::Add {
                name,
                scope,
                launch,
            },
        ) => McpChangeOperation::Command(McpChangeCommand::ClaudeAdd {
            name: name.clone(),
            scope: *scope,
            launch: launch.clone(),
        }),
        (AgentCliInvocation::ClaudeCode, AgentMcpServerChange::Remove { name, scope }) => {
            McpChangeOperation::Command(McpChangeCommand::ClaudeRemove {
                name: name.clone(),
                scope: *scope,
            })
        }
        (AgentCliInvocation::ClaudeCode, AgentMcpServerChange::SignOut { name }) => {
            McpChangeOperation::Exchange(McpChangeExchange::ClaudeClearAuth(
                ClaudeMcpClearAuth::new(name),
            ))
        }
        (AgentCliInvocation::CodexExec, AgentMcpServerChange::Add { name, launch, .. }) => {
            let launch = codex_launch_value(launch).ok_or(McpChangeFailure::ChangeUnsupported)?;
            McpChangeOperation::Exchange(McpChangeExchange::CodexAdd(CodexMcpServerAdd::new(
                name,
                launch,
                workspace_root,
            )))
        }
        (AgentCliInvocation::CodexExec, AgentMcpServerChange::Remove { name, .. }) => {
            McpChangeOperation::Command(McpChangeCommand::CodexRemove { name: name.clone() })
        }
        (AgentCliInvocation::CodexExec, AgentMcpServerChange::SignOut { name }) => {
            McpChangeOperation::Command(McpChangeCommand::CodexSignOut { name: name.clone() })
        }
    };
    Ok(operation)
}

#[cfg(test)]
#[path = "agent_mcp_server_manage_protocol_tests.rs"]
mod tests;
