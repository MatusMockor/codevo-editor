use crate::agent_command_catalog_domain::{
    codex_skills_request, parse_codex_skills_value, CLAUDE_CONTROL_REQUEST_ID,
    MAX_CATALOG_OUTPUT_BYTES,
};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const CODEX_SKILLS_POLL_INTERVAL: Duration = Duration::from_millis(400);
pub const CODEX_SKILLS_STABLE_FOR: Duration = Duration::from_secs(2);
pub const CODEX_SKILLS_POLL_CAP: Duration = Duration::from_secs(6);
pub const MAX_CODEX_SKILLS_POLLS: u64 = 16;
pub const MAX_CODEX_SKILLS_STREAM_BYTES: usize =
    (MAX_CODEX_SKILLS_POLLS as usize + 1) * MAX_CATALOG_OUTPUT_BYTES;
const LINE_LIMIT_ERROR: &str = "Provider command catalog response line exceeds size limit.";
const HANDSHAKE_ERROR: &str = "Codex skill catalog handshake failed.";
const REQUEST_ERROR: &str = "Codex skill catalog request failed.";
const NO_RESPONSE_ERROR: &str = "Codex skill catalog did not respond.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProbeStep {
    Wait,
    Write(Vec<u8>),
    Done,
    Failed(String),
}

#[derive(Debug, Default)]
struct LineAssembler {
    pending: Vec<u8>,
    overflowed: bool,
}

impl LineAssembler {
    fn push(&mut self, bytes: &[u8], mut on_line: impl FnMut(&[u8])) -> Result<(), String> {
        if self.overflowed {
            return Err(LINE_LIMIT_ERROR.to_string());
        }
        for chunk in bytes.split_inclusive(|byte| *byte == b'\n') {
            let (body, complete) = match chunk.strip_suffix(b"\n") {
                Some(body) => (body, true),
                None => (chunk, false),
            };
            if self.pending.len().saturating_add(body.len()) > MAX_CATALOG_OUTPUT_BYTES {
                self.overflowed = true;
                self.pending = Vec::new();
                return Err(LINE_LIMIT_ERROR.to_string());
            }
            self.pending.extend_from_slice(body);
            if !complete {
                continue;
            }
            let line = std::mem::take(&mut self.pending);
            on_line(&line);
        }
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct ClaudeInitializeWatch {
    lines: LineAssembler,
    result: Option<Vec<u8>>,
    failure: Option<String>,
    done: bool,
}

fn is_claude_catalog_response(line: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        return false;
    };
    value.get("type").and_then(Value::as_str) == Some("control_response")
        && value
            .get("response")
            .and_then(|body| body.get("request_id"))
            .and_then(Value::as_str)
            == Some(CLAUDE_CONTROL_REQUEST_ID)
}

impl ClaudeInitializeWatch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, bytes: &[u8]) {
        if self.done || self.failure.is_some() {
            return;
        }
        let mut result = None;
        let pushed = self.lines.push(bytes, |line| {
            if result.is_none() && is_claude_catalog_response(line) {
                result = Some(line.to_vec());
            }
        });
        if let Err(error) = pushed {
            self.failure = Some(error);
            return;
        }
        if result.is_some() {
            self.done = true;
            self.result = result;
        }
    }

    pub fn step(&self) -> ProbeStep {
        if let Some(failure) = &self.failure {
            return ProbeStep::Failed(failure.clone());
        }
        if self.done {
            return ProbeStep::Done;
        }
        ProbeStep::Wait
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn take_result(&mut self) -> Option<Vec<u8>> {
        self.result.take()
    }
}

#[derive(Debug)]
pub struct CodexSkillsPoll {
    workspace_root: String,
    lines: LineAssembler,
    handshake_completed: Option<Instant>,
    next_id: u64,
    polls: u64,
    outstanding: Option<u64>,
    last_sent: Option<Instant>,
    latest: Option<Vec<u8>>,
    names: Vec<String>,
    stable_since: Option<Instant>,
    failure: Option<String>,
    done: bool,
}

impl CodexSkillsPoll {
    pub fn new(workspace_root: &str) -> Self {
        Self {
            workspace_root: workspace_root.to_string(),
            lines: LineAssembler::default(),
            handshake_completed: None,
            next_id: 1,
            polls: 0,
            outstanding: None,
            last_sent: None,
            latest: None,
            names: Vec::new(),
            stable_since: None,
            failure: None,
            done: false,
        }
    }

    pub fn observe(&mut self, bytes: &[u8], now: Instant) {
        if self.done || self.failure.is_some() {
            return;
        }
        let mut lines = Vec::new();
        if let Err(error) = self.lines.push(bytes, |line| lines.push(line.to_vec())) {
            self.failure = Some(error);
            return;
        }
        for line in lines {
            self.observe_line(&line, now);
        }
    }

    fn observe_line(&mut self, line: &[u8], now: Instant) {
        if self.failure.is_some() {
            return;
        }
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            return;
        };
        if id == 0 {
            if value.get("error").is_some() {
                self.failure = Some(HANDSHAKE_ERROR.to_string());
            } else if value.get("result").is_some() && self.handshake_completed.is_none() {
                self.handshake_completed = Some(now);
            }
            return;
        }
        if self.outstanding != Some(id) {
            return;
        }
        self.outstanding = None;
        if value.get("error").is_some() {
            self.failure = Some(REQUEST_ERROR.to_string());
            return;
        }
        let names = match parse_codex_skills_value(&value, &self.workspace_root) {
            Ok(catalog) => catalog
                .entries
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            Err(error) => {
                self.failure = Some(error);
                return;
            }
        };
        if self.latest.is_none() || names != self.names {
            self.names = names;
            self.stable_since = Some(now);
        }
        self.latest = Some(line.to_vec());
    }

    pub fn step(&mut self, now: Instant) -> ProbeStep {
        if let Some(failure) = &self.failure {
            return ProbeStep::Failed(failure.clone());
        }
        if self.done {
            return ProbeStep::Done;
        }
        let Some(handshake_completed) = self.handshake_completed else {
            return ProbeStep::Wait;
        };
        let since_handshake = now.saturating_duration_since(handshake_completed);
        let stable = self
            .stable_since
            .is_some_and(|since| now.saturating_duration_since(since) >= CODEX_SKILLS_STABLE_FOR);
        let capped =
            since_handshake >= CODEX_SKILLS_POLL_CAP || self.polls >= MAX_CODEX_SKILLS_POLLS;
        if self.latest.is_some() && (stable || capped) {
            self.done = true;
            return ProbeStep::Done;
        }
        if capped {
            self.failure = Some(NO_RESPONSE_ERROR.to_string());
            return ProbeStep::Failed(NO_RESPONSE_ERROR.to_string());
        }
        let due = self
            .last_sent
            .is_none_or(|sent| now.saturating_duration_since(sent) >= CODEX_SKILLS_POLL_INTERVAL);
        if self.outstanding.is_some() || !due {
            return ProbeStep::Wait;
        }
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.polls = self.polls.saturating_add(1);
        self.outstanding = Some(id);
        self.last_sent = Some(now);
        ProbeStep::Write(codex_skills_request(&self.workspace_root, id).into_bytes())
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn take_result(&mut self) -> Option<Vec<u8>> {
        if !self.done {
            return None;
        }
        self.latest.take()
    }
}

#[cfg(test)]
#[path = "agent_command_catalog_protocol_tests.rs"]
mod tests;
