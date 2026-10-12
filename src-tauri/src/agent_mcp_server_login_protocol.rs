use crate::agent_mcp_server_manage_domain::{
    is_valid_authorization_url, AgentMcpServerLoginMode, AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR,
    AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR, AGENT_MCP_SERVER_NOT_FOUND_ERROR,
};
use crate::agent_mcp_server_manage_protocol::{
    claude_clear_auth_request, claude_control_reply, claude_control_request, codex_reply,
    codex_request, ClaudeControlReply, ProviderRefusal, CODEX_HANDSHAKE_REPLY_ID,
};
use crate::agent_mcp_servers_domain::{
    AGENT_MCP_SERVERS_TIMED_OUT_ERROR, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
};
use crate::agent_mcp_servers_protocol::{
    claude_mcp_status_request, BoundedLines, McpProbeStep, CLAUDE_MCP_INITIALIZE_REQUEST_ID,
    MAX_CLAUDE_MCP_STATUS_LINE_BYTES, MAX_CODEX_MCP_STATUS_LINE_BYTES,
};
use crate::agent_task_spawner::AgentCliInvocation;
use serde_json::{json, Value};
use std::{
    fmt,
    time::{Duration, Instant},
};

pub const CODEX_MCP_LOGIN_REQUEST_ID: u64 = 1;
pub const CODEX_MCP_LOGIN_TIMEOUT_SECS: u64 = 300;
pub const CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID: &str = "codevo-mcp-server-login-clear-auth";
pub const CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID: &str = "codevo-mcp-server-login-authenticate";
const CODEX_LOGIN_COMPLETED_METHOD: &str = "mcpServer/oauthLogin/completed";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct McpLoginTiming {
    pub poll_interval: Duration,
    pub deadline: Duration,
    pub step_timeout: Duration,
    pub sign_out_timeout: Duration,
    pub authority_check_interval: Duration,
}

impl McpLoginTiming {
    pub const PRODUCTION: Self = Self {
        poll_interval: Duration::from_millis(1_500),
        deadline: Duration::from_secs(CODEX_MCP_LOGIN_TIMEOUT_SECS),
        step_timeout: Duration::from_secs(25),
        sign_out_timeout: Duration::from_secs(10),
        authority_check_interval: Duration::from_millis(250),
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpLoginFailure {
    LoginUnsupported,
    ServerNotFound,
    TimedOut,
    Inactive,
    Unavailable,
}

impl McpLoginFailure {
    pub fn message(self) -> &'static str {
        match self {
            Self::LoginUnsupported => AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR,
            Self::ServerNotFound => AGENT_MCP_SERVER_NOT_FOUND_ERROR,
            Self::TimedOut => AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
            Self::Inactive => AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR,
            Self::Unavailable => AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
        }
    }

    fn refused(refusal: ProviderRefusal) -> Self {
        match refusal {
            ProviderRefusal::ServerNotFound => Self::ServerNotFound,
            ProviderRefusal::Unsupported => Self::LoginUnsupported,
            ProviderRefusal::Other => Self::Unavailable,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum McpLoginProviderStep {
    Completed,
    FinishInBrowser(String),
    AwaitingCallback(String),
}

impl fmt::Debug for McpLoginProviderStep {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Completed => "Completed",
            Self::FinishInBrowser(_) => "FinishInBrowser",
            Self::AwaitingCallback(_) => "AwaitingCallback",
        })
    }
}

pub type McpLoginAnnouncement = Result<McpLoginProviderStep, McpLoginFailure>;

pub trait McpLoginEvents: Send + Sync {
    fn step_known(&self, step: McpLoginAnnouncement);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpLoginRequest {
    pub name: String,
    pub mode: AgentMcpServerLoginMode,
    pub timing: McpLoginTiming,
}

#[derive(Default)]
struct ClaudeLoginPoll {
    polls: u64,
    outstanding: Option<String>,
    last_sent: Option<Instant>,
}

enum ClaudeServerPresence {
    Connected,
    Waiting,
    Missing,
}

enum ClaudeLoginPhase {
    Initializing,
    Initialized,
    Clearing,
    Cleared,
    Authenticating,
    Polling(ClaudeLoginPoll),
    Ended,
}

pub struct ClaudeMcpLogin {
    name: String,
    mode: AgentMcpServerLoginMode,
    poll_interval: Duration,
    lines: BoundedLines,
    phase: ClaudeLoginPhase,
    announcement: Option<McpLoginAnnouncement>,
    succeeded: bool,
}

fn claude_login_step(body: &Value) -> McpLoginAnnouncement {
    let requires_action = body.get("requiresUserAction").and_then(Value::as_bool);
    let callback_expected = body.get("callbackExpected").and_then(Value::as_bool);
    let url = body
        .get("authUrl")
        .and_then(Value::as_str)
        .filter(|url| is_valid_authorization_url(url));
    match (requires_action, callback_expected, url) {
        (Some(false), _, _) => Ok(McpLoginProviderStep::Completed),
        (Some(true), Some(true), Some(url)) => {
            Ok(McpLoginProviderStep::AwaitingCallback(url.to_string()))
        }
        (Some(true), Some(false), Some(url)) => {
            Ok(McpLoginProviderStep::FinishInBrowser(url.to_string()))
        }
        _ => Err(McpLoginFailure::Unavailable),
    }
}

fn claude_server_presence(response: &Value, name: &str) -> ClaudeServerPresence {
    let Some(servers) = response.get("mcpServers").and_then(Value::as_array) else {
        return ClaudeServerPresence::Waiting;
    };
    let Some(server) = servers
        .iter()
        .find(|server| server.get("name").and_then(Value::as_str) == Some(name))
    else {
        return ClaudeServerPresence::Missing;
    };
    if server.get("status").and_then(Value::as_str) == Some("connected") {
        return ClaudeServerPresence::Connected;
    }
    ClaudeServerPresence::Waiting
}

impl ClaudeMcpLogin {
    pub fn new(request: &McpLoginRequest) -> Self {
        Self {
            name: request.name.clone(),
            mode: request.mode,
            poll_interval: request.timing.poll_interval,
            lines: BoundedLines::new(MAX_CLAUDE_MCP_STATUS_LINE_BYTES),
            phase: ClaudeLoginPhase::Initializing,
            announcement: None,
            succeeded: false,
        }
    }

    fn fail(&mut self, failure: McpLoginFailure) {
        self.announcement.get_or_insert(Err(failure));
        self.phase = ClaudeLoginPhase::Ended;
    }

    fn end(&mut self, succeeded: bool) {
        self.succeeded = succeeded;
        self.phase = ClaudeLoginPhase::Ended;
    }

    fn observe(&mut self, bytes: &[u8]) {
        if matches!(self.phase, ClaudeLoginPhase::Ended) {
            return;
        }
        let Ok(lines) = self.lines.push(bytes) else {
            self.fail(McpLoginFailure::Unavailable);
            return;
        };
        for line in &lines {
            if let Some(reply) = claude_control_reply(line, &self.name) {
                self.observe_reply(reply);
            }
        }
    }

    fn observe_reply(&mut self, reply: ClaudeControlReply) {
        let id = reply.request_id.as_str();
        match (&mut self.phase, reply.result) {
            (ClaudeLoginPhase::Initializing, result) if id == CLAUDE_MCP_INITIALIZE_REQUEST_ID => {
                match result {
                    Ok(_) => self.phase = ClaudeLoginPhase::Initialized,
                    Err(_) => self.fail(McpLoginFailure::Unavailable),
                }
            }
            (ClaudeLoginPhase::Clearing, result) if id == CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID => {
                match result {
                    Ok(_) => self.phase = ClaudeLoginPhase::Cleared,
                    Err(refusal) => self.fail(McpLoginFailure::refused(refusal)),
                }
            }
            (ClaudeLoginPhase::Authenticating, result)
                if id == CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID =>
            {
                match result {
                    Ok(body) => self.accept_authentication(&body),
                    Err(refusal) => self.fail(McpLoginFailure::refused(refusal)),
                }
            }
            (ClaudeLoginPhase::Polling(poll), result)
                if poll.outstanding.as_deref() == Some(id) =>
            {
                poll.outstanding = None;
                let presence = result
                    .as_ref()
                    .map_or(ClaudeServerPresence::Waiting, |response| {
                        claude_server_presence(response, &self.name)
                    });
                match presence {
                    ClaudeServerPresence::Connected => self.end(true),
                    ClaudeServerPresence::Missing => self.end(false),
                    ClaudeServerPresence::Waiting => {}
                }
            }
            _ => {}
        }
    }

    fn accept_authentication(&mut self, body: &Value) {
        let step = claude_login_step(body);
        self.phase = match step {
            Ok(McpLoginProviderStep::AwaitingCallback(_)) => {
                ClaudeLoginPhase::Polling(ClaudeLoginPoll::default())
            }
            _ => ClaudeLoginPhase::Ended,
        };
        self.announcement.get_or_insert(step);
    }

    fn authenticate_request(&self) -> Vec<u8> {
        claude_control_request(
            CLAUDE_MCP_LOGIN_AUTHENTICATE_REQUEST_ID,
            json!({ "subtype": "mcp_authenticate", "serverName": self.name }),
        )
    }

    fn step(&mut self, now: Instant) -> McpProbeStep {
        let poll_interval = self.poll_interval;
        match &mut self.phase {
            ClaudeLoginPhase::Ended => McpProbeStep::Done,
            ClaudeLoginPhase::Initializing
            | ClaudeLoginPhase::Clearing
            | ClaudeLoginPhase::Authenticating => McpProbeStep::Wait,
            ClaudeLoginPhase::Initialized if self.mode == AgentMcpServerLoginMode::SignInAgain => {
                self.phase = ClaudeLoginPhase::Clearing;
                McpProbeStep::Write(claude_clear_auth_request(
                    CLAUDE_MCP_LOGIN_CLEAR_REQUEST_ID,
                    &self.name,
                ))
            }
            ClaudeLoginPhase::Initialized | ClaudeLoginPhase::Cleared => {
                self.phase = ClaudeLoginPhase::Authenticating;
                McpProbeStep::Write(self.authenticate_request())
            }
            ClaudeLoginPhase::Polling(poll) => {
                let due = poll
                    .last_sent
                    .is_none_or(|sent| now.saturating_duration_since(sent) >= poll_interval);
                if poll.outstanding.is_some() || !due {
                    return McpProbeStep::Wait;
                }
                poll.polls = poll.polls.saturating_add(1);
                let request_id = format!("codevo-mcp-server-login-status-{}", poll.polls);
                let request = claude_mcp_status_request(&request_id);
                poll.outstanding = Some(request_id);
                poll.last_sent = Some(now);
                McpProbeStep::Write(request)
            }
        }
    }
}

enum CodexLoginPhase {
    Handshake,
    Connected,
    Requesting,
    Awaiting { provider_login_id: Option<String> },
    Ended,
}

pub struct CodexMcpLogin {
    name: String,
    lines: BoundedLines,
    phase: CodexLoginPhase,
    announcement: Option<McpLoginAnnouncement>,
    succeeded: bool,
}

fn codex_completion(message: &Value, name: &str, provider_login_id: Option<&str>) -> Option<bool> {
    if message.get("method").and_then(Value::as_str) != Some(CODEX_LOGIN_COMPLETED_METHOD) {
        return None;
    }
    let params = message.get("params")?;
    if params.get("name").and_then(Value::as_str) != Some(name) {
        return None;
    }
    let completed_login_id = params.get("loginId").and_then(Value::as_str);
    if provider_login_id
        .zip(completed_login_id)
        .is_some_and(|(expected, completed)| expected != completed)
    {
        return None;
    }
    Some(params.get("success").and_then(Value::as_bool) == Some(true))
}

impl CodexMcpLogin {
    pub fn new(request: &McpLoginRequest) -> Self {
        Self {
            name: request.name.clone(),
            lines: BoundedLines::new(MAX_CODEX_MCP_STATUS_LINE_BYTES),
            phase: CodexLoginPhase::Handshake,
            announcement: None,
            succeeded: false,
        }
    }

    fn fail(&mut self, failure: McpLoginFailure) {
        self.announcement.get_or_insert(Err(failure));
        self.phase = CodexLoginPhase::Ended;
    }

    fn observe(&mut self, bytes: &[u8]) {
        if matches!(self.phase, CodexLoginPhase::Ended) {
            return;
        }
        let Ok(lines) = self.lines.push(bytes) else {
            self.fail(McpLoginFailure::Unavailable);
            return;
        };
        lines.iter().for_each(|line| self.observe_line(line));
    }

    fn observe_line(&mut self, line: &[u8]) {
        let Ok(mut message) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        if let CodexLoginPhase::Awaiting { provider_login_id } = &self.phase {
            let Some(succeeded) =
                codex_completion(&message, &self.name, provider_login_id.as_deref())
            else {
                return;
            };
            self.succeeded = succeeded;
            self.phase = CodexLoginPhase::Ended;
            return;
        }
        let Some(reply) = codex_reply(&mut message, &self.name) else {
            return;
        };
        match (&self.phase, reply.id, reply.result) {
            (CodexLoginPhase::Handshake, CODEX_HANDSHAKE_REPLY_ID, Ok(_)) => {
                self.phase = CodexLoginPhase::Connected;
            }
            (CodexLoginPhase::Handshake, CODEX_HANDSHAKE_REPLY_ID, Err(_)) => {
                self.fail(McpLoginFailure::Unavailable);
            }
            (CodexLoginPhase::Requesting, CODEX_MCP_LOGIN_REQUEST_ID, Ok(result)) => {
                self.accept_login(&result);
            }
            (CodexLoginPhase::Requesting, CODEX_MCP_LOGIN_REQUEST_ID, Err(refusal)) => {
                self.fail(McpLoginFailure::refused(refusal));
            }
            _ => {}
        }
    }

    fn accept_login(&mut self, result: &Value) {
        let Some(url) = result
            .get("authorizationUrl")
            .and_then(Value::as_str)
            .filter(|url| is_valid_authorization_url(url))
        else {
            self.fail(McpLoginFailure::Unavailable);
            return;
        };
        self.announcement
            .get_or_insert(Ok(McpLoginProviderStep::AwaitingCallback(url.to_string())));
        self.phase = CodexLoginPhase::Awaiting {
            provider_login_id: result
                .get("loginId")
                .and_then(Value::as_str)
                .map(str::to_string),
        };
    }

    fn step(&mut self) -> McpProbeStep {
        match self.phase {
            CodexLoginPhase::Ended => McpProbeStep::Done,
            CodexLoginPhase::Handshake
            | CodexLoginPhase::Requesting
            | CodexLoginPhase::Awaiting { .. } => McpProbeStep::Wait,
            CodexLoginPhase::Connected => {
                self.phase = CodexLoginPhase::Requesting;
                McpProbeStep::Write(codex_request(
                    CODEX_MCP_LOGIN_REQUEST_ID,
                    "mcpServer/oauth/login",
                    json!({ "name": self.name, "timeoutSecs": CODEX_MCP_LOGIN_TIMEOUT_SECS }),
                ))
            }
        }
    }
}

pub enum McpLoginProtocol {
    Claude(ClaudeMcpLogin),
    Codex(CodexMcpLogin),
}

impl McpLoginProtocol {
    pub fn new(provider: AgentCliInvocation, request: &McpLoginRequest) -> Self {
        match provider {
            AgentCliInvocation::ClaudeCode => Self::Claude(ClaudeMcpLogin::new(request)),
            AgentCliInvocation::CodexExec => Self::Codex(CodexMcpLogin::new(request)),
        }
    }

    pub fn observe(&mut self, bytes: &[u8]) {
        match self {
            Self::Claude(login) => login.observe(bytes),
            Self::Codex(login) => login.observe(bytes),
        }
    }

    pub fn step(&mut self, now: Instant) -> McpProbeStep {
        match self {
            Self::Claude(login) => login.step(now),
            Self::Codex(login) => login.step(),
        }
    }

    pub fn take_announcement(&mut self) -> Option<McpLoginAnnouncement> {
        match self {
            Self::Claude(login) => login.announcement.take(),
            Self::Codex(login) => login.announcement.take(),
        }
    }

    pub fn is_ended(&self) -> bool {
        match self {
            Self::Claude(login) => matches!(login.phase, ClaudeLoginPhase::Ended),
            Self::Codex(login) => matches!(login.phase, CodexLoginPhase::Ended),
        }
    }

    pub fn succeeded(&self) -> bool {
        match self {
            Self::Claude(login) => login.succeeded,
            Self::Codex(login) => login.succeeded,
        }
    }
}

#[cfg(test)]
#[path = "agent_mcp_server_login_protocol_tests.rs"]
mod tests;
