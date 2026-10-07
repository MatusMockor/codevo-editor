use crate::agent_mcp_servers_domain::{
    claude_mcp_servers, codex_mcp_servers, mark_codex_disabled_servers, AgentMcpServerStatus,
    AgentMcpServers, AGENT_MCP_SERVERS_TIMED_OUT_ERROR, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
    MAX_MCP_SERVERS,
};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const MAX_CLAUDE_MCP_STATUS_LINE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_CODEX_MCP_STATUS_LINE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_CLAUDE_MCP_STATUS_POLLS: u64 = 48;
pub const MAX_CLAUDE_MCP_STATUS_STREAM_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_CODEX_MCP_STATUS_STREAM_BYTES: usize = 2 * MAX_CODEX_MCP_STATUS_LINE_BYTES;
pub const CLAUDE_MCP_INITIALIZE_REQUEST_ID: &str = "codevo-mcp-servers-initialize";
pub const CLAUDE_MCP_INITIALIZE_REQUEST: &str = "{\"type\":\"control_request\",\"request_id\":\"codevo-mcp-servers-initialize\",\"request\":{\"subtype\":\"initialize\"}}\n";
pub const CODEX_MCP_STATUS_REQUEST_ID: u64 = 1;
pub const CODEX_MCP_CONFIG_REQUEST_ID: u64 = 2;
pub const CODEX_MCP_CONFIG_READ_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_HANDSHAKE_REQUEST_ID: u64 = 0;
const LINE_LIMIT_ERROR: &str = "Provider MCP server status response line exceeds size limit.";
const HANDSHAKE_ERROR: &str = "Provider MCP server status handshake failed.";
const REQUEST_ERROR: &str = "Provider MCP server status request failed.";
const PAYLOAD_ERROR: &str = "Provider MCP server status response is invalid.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpServersProbeFailure {
    TimedOut,
    Unavailable,
}

impl McpServersProbeFailure {
    pub fn message(self) -> &'static str {
        match self {
            Self::TimedOut => AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
            Self::Unavailable => AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct McpStatusTiming {
    pub poll_interval: Duration,
    pub stable_for: Duration,
    pub settle_deadline: Duration,
}

impl McpStatusTiming {
    pub const PRODUCTION: Self = Self {
        poll_interval: Duration::from_millis(500),
        stable_for: Duration::from_secs(2),
        settle_deadline: Duration::from_secs(20),
    };
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpProbeStep {
    Wait,
    Write(Vec<u8>),
    Done,
    Failed(String),
}

#[derive(Debug)]
struct BoundedLines {
    limit: usize,
    pending: Vec<u8>,
    overflowed: bool,
}

impl BoundedLines {
    fn new(limit: usize) -> Self {
        Self {
            limit,
            pending: Vec::new(),
            overflowed: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        if self.overflowed {
            return Err(LINE_LIMIT_ERROR.to_string());
        }
        let mut lines = Vec::new();
        for chunk in bytes.split_inclusive(|byte| *byte == b'\n') {
            let (body, complete) = match chunk.strip_suffix(b"\n") {
                Some(body) => (body, true),
                None => (chunk, false),
            };
            if self.pending.len().saturating_add(body.len()) > self.limit {
                self.overflowed = true;
                self.pending = Vec::new();
                return Err(LINE_LIMIT_ERROR.to_string());
            }
            self.pending.extend_from_slice(body);
            if !complete {
                continue;
            }
            lines.push(std::mem::take(&mut self.pending));
        }
        Ok(lines)
    }
}

pub fn claude_mcp_status_request_id(poll: u64) -> String {
    format!("codevo-mcp-servers-status-{poll}")
}

pub fn claude_mcp_status_request(request_id: &str) -> Vec<u8> {
    let mut request = serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": { "subtype": "mcp_status" },
    })
    .to_string();
    request.push('\n');
    request.into_bytes()
}

pub fn codex_mcp_status_request() -> Vec<u8> {
    let mut request = serde_json::json!({
        "method": "mcpServerStatus/list",
        "id": CODEX_MCP_STATUS_REQUEST_ID,
        "params": { "detail": "toolsAndAuthOnly", "limit": MAX_MCP_SERVERS },
    })
    .to_string();
    request.push('\n');
    request.into_bytes()
}

pub fn codex_mcp_config_request(workspace_root: &str) -> Vec<u8> {
    let mut request = serde_json::json!({
        "method": "config/read",
        "id": CODEX_MCP_CONFIG_REQUEST_ID,
        "params": { "cwd": workspace_root, "includeLayers": false },
    })
    .to_string();
    request.push('\n');
    request.into_bytes()
}

fn claude_control_response(line: &[u8]) -> Option<Value> {
    let mut value = serde_json::from_slice::<Value>(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("control_response") {
        return None;
    }
    value.get_mut("response").map(Value::take)
}

#[derive(Debug)]
pub struct ClaudeMcpStatusPoll {
    timing: McpStatusTiming,
    lines: BoundedLines,
    initialized_at: Option<Instant>,
    polls: u64,
    outstanding: Option<String>,
    last_sent: Option<Instant>,
    latest: Option<AgentMcpServers>,
    stable_since: Option<Instant>,
    confirmed_at: Option<Instant>,
    failure: Option<String>,
    done: bool,
}

impl ClaudeMcpStatusPoll {
    pub fn new(timing: McpStatusTiming) -> Self {
        Self {
            timing,
            lines: BoundedLines::new(MAX_CLAUDE_MCP_STATUS_LINE_BYTES),
            initialized_at: None,
            polls: 0,
            outstanding: None,
            last_sent: None,
            latest: None,
            stable_since: None,
            confirmed_at: None,
            failure: None,
            done: false,
        }
    }

    pub fn observe(&mut self, bytes: &[u8], now: Instant) {
        if self.done || self.failure.is_some() {
            return;
        }
        match self.lines.push(bytes) {
            Ok(lines) => lines.iter().for_each(|line| self.observe_line(line, now)),
            Err(error) => self.failure = Some(error),
        }
    }

    fn observe_line(&mut self, line: &[u8], now: Instant) {
        if self.failure.is_some() {
            return;
        }
        let Some(body) = claude_control_response(line) else {
            return;
        };
        let Some(request_id) = body.get("request_id").and_then(Value::as_str) else {
            return;
        };
        let succeeded = body.get("subtype").and_then(Value::as_str) == Some("success");
        if request_id == CLAUDE_MCP_INITIALIZE_REQUEST_ID {
            self.observe_initialize(succeeded, now);
            return;
        }
        if self.outstanding.as_deref() != Some(request_id) {
            return;
        }
        self.outstanding = None;
        if !succeeded {
            self.failure = Some(REQUEST_ERROR.to_string());
            return;
        }
        match body.get("response").map(claude_mcp_servers) {
            Some(Ok(snapshot)) => self.accept(snapshot, now),
            _ => self.failure = Some(PAYLOAD_ERROR.to_string()),
        }
    }

    fn observe_initialize(&mut self, succeeded: bool, now: Instant) {
        if !succeeded {
            self.failure = Some(HANDSHAKE_ERROR.to_string());
            return;
        }
        self.initialized_at.get_or_insert(now);
    }

    fn accept(&mut self, snapshot: AgentMcpServers, now: Instant) {
        if self.latest.as_ref() != Some(&snapshot) {
            self.stable_since = Some(now);
        }
        self.confirmed_at = Some(now);
        self.latest = Some(snapshot);
    }

    fn is_settled(&self) -> bool {
        let connecting = self.latest.as_ref().is_none_or(|snapshot| {
            snapshot
                .servers
                .iter()
                .any(|server| server.status == AgentMcpServerStatus::Connecting)
        });
        let confirmed_for = self
            .stable_since
            .zip(self.confirmed_at)
            .map(|(since, confirmed)| confirmed.saturating_duration_since(since));
        !connecting && confirmed_for.is_some_and(|stable| stable >= self.timing.stable_for)
    }

    fn is_expired(&self, initialized_at: Instant, now: Instant) -> bool {
        now.saturating_duration_since(initialized_at) >= self.timing.settle_deadline
            || (self.polls >= MAX_CLAUDE_MCP_STATUS_POLLS && self.outstanding.is_none())
    }

    fn is_poll_due(&self, now: Instant) -> bool {
        self.last_sent
            .is_none_or(|sent| now.saturating_duration_since(sent) >= self.timing.poll_interval)
    }

    pub fn step(&mut self, now: Instant) -> McpProbeStep {
        if let Some(failure) = &self.failure {
            return McpProbeStep::Failed(failure.clone());
        }
        if self.done {
            return McpProbeStep::Done;
        }
        let Some(initialized_at) = self.initialized_at else {
            return McpProbeStep::Wait;
        };
        let expired = self.is_expired(initialized_at, now);
        if self.latest.is_some() && (expired || self.is_settled()) {
            self.done = true;
            return McpProbeStep::Done;
        }
        if expired || self.outstanding.is_some() || !self.is_poll_due(now) {
            return McpProbeStep::Wait;
        }
        self.polls = self.polls.saturating_add(1);
        let request_id = claude_mcp_status_request_id(self.polls);
        let request = claude_mcp_status_request(&request_id);
        self.outstanding = Some(request_id);
        self.last_sent = Some(now);
        McpProbeStep::Write(request)
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn take_snapshot(&mut self) -> Option<AgentMcpServers> {
        self.latest.take()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CodexConfigRead {
    Pending,
    Requested(Instant),
    Settled,
}

#[derive(Debug)]
pub struct CodexMcpStatusRequest {
    workspace_root: String,
    lines: BoundedLines,
    handshake_completed: bool,
    requested: bool,
    latest: Option<AgentMcpServers>,
    config: CodexConfigRead,
    failure: Option<String>,
}

impl CodexMcpStatusRequest {
    pub fn new(workspace_root: &str) -> Self {
        Self {
            workspace_root: workspace_root.to_string(),
            lines: BoundedLines::new(MAX_CODEX_MCP_STATUS_LINE_BYTES),
            handshake_completed: false,
            requested: false,
            latest: None,
            config: CodexConfigRead::Pending,
            failure: None,
        }
    }

    fn is_settled(&self) -> bool {
        self.failure.is_some() || (self.latest.is_some() && self.config == CodexConfigRead::Settled)
    }

    pub fn observe(&mut self, bytes: &[u8]) {
        if self.is_settled() {
            return;
        }
        match self.lines.push(bytes) {
            Ok(lines) => lines.iter().for_each(|line| self.observe_line(line)),
            Err(error) => self.observe_overflow(error),
        }
    }

    fn observe_overflow(&mut self, error: String) {
        if self.latest.is_some() {
            self.config = CodexConfigRead::Settled;
            return;
        }
        self.failure = Some(error);
    }

    fn observe_line(&mut self, line: &[u8]) {
        if self.is_settled() {
            return;
        }
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        if value.get("method").is_some() {
            return;
        }
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            return;
        };
        if self.latest.is_some() {
            self.observe_config(id, &value);
            return;
        }
        if id == CODEX_HANDSHAKE_REQUEST_ID {
            self.observe_handshake(&value);
            return;
        }
        if id != CODEX_MCP_STATUS_REQUEST_ID || !self.requested {
            return;
        }
        if value.get("error").is_some() {
            self.failure = Some(REQUEST_ERROR.to_string());
            return;
        }
        match value.get("result").map(codex_mcp_servers) {
            Some(Ok(snapshot)) => self.latest = Some(snapshot),
            _ => self.failure = Some(PAYLOAD_ERROR.to_string()),
        }
    }

    fn observe_handshake(&mut self, value: &Value) {
        if value.get("error").is_some() {
            self.failure = Some(HANDSHAKE_ERROR.to_string());
            return;
        }
        if value.get("result").is_some() {
            self.handshake_completed = true;
        }
    }

    fn observe_config(&mut self, id: u64, value: &Value) {
        if id != CODEX_MCP_CONFIG_REQUEST_ID
            || !matches!(self.config, CodexConfigRead::Requested(_))
        {
            return;
        }
        self.config = CodexConfigRead::Settled;
        if value.get("error").is_some() {
            return;
        }
        let Some((snapshot, config)) = self.latest.as_mut().zip(value.get("result")) else {
            return;
        };
        mark_codex_disabled_servers(snapshot, config);
    }

    fn is_config_read_expired(requested_at: Instant, now: Instant) -> bool {
        now.saturating_duration_since(requested_at) >= CODEX_MCP_CONFIG_READ_TIMEOUT
    }

    fn config_step(&mut self, now: Instant) -> McpProbeStep {
        match self.config {
            CodexConfigRead::Settled => McpProbeStep::Done,
            CodexConfigRead::Requested(at) if !Self::is_config_read_expired(at, now) => {
                McpProbeStep::Wait
            }
            CodexConfigRead::Requested(_) => {
                self.config = CodexConfigRead::Settled;
                McpProbeStep::Done
            }
            CodexConfigRead::Pending => {
                self.config = CodexConfigRead::Requested(now);
                McpProbeStep::Write(codex_mcp_config_request(&self.workspace_root))
            }
        }
    }

    pub fn step(&mut self, now: Instant) -> McpProbeStep {
        if let Some(failure) = &self.failure {
            return McpProbeStep::Failed(failure.clone());
        }
        if self.latest.is_some() {
            return self.config_step(now);
        }
        if !self.handshake_completed || self.requested {
            return McpProbeStep::Wait;
        }
        self.requested = true;
        McpProbeStep::Write(codex_mcp_status_request())
    }

    pub fn is_done(&self) -> bool {
        self.latest.is_some() && self.failure.is_none()
    }

    pub fn take_snapshot(&mut self) -> Option<AgentMcpServers> {
        self.latest.take()
    }
}

#[cfg(test)]
#[path = "agent_mcp_servers_protocol_tests.rs"]
mod tests;
