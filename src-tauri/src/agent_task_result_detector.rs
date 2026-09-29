use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde_json::Value;

type InputLifecycle =
    crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_LIVE_TASKS: usize = 256;
const MAX_OBSERVED_TASKS: usize = 4096;
const MAX_ID_BYTES: usize = 256;
const MAX_RETIRED_SESSIONS: usize = 16;

/// Owns only lifecycle evidence from root Claude JSONL messages. A foreground
/// result is not the end of the stream while native background tasks are live.
/// Terminal tombstones prevent delayed progress and updates from resurrecting tasks.
/// A terminal task update followed by a root result settles this per-run CLI.
#[derive(Default)]
pub struct ResultLineDetector {
    line: Vec<u8>,
    skipping_line: bool,
    fired: bool,
    live: HashMap<String, TaskScope>,
    inherited: HashSet<String>,
    terminal: HashMap<String, Tombstone>,
    buried: VecDeque<String>,
    session: Option<String>,
    retired: VecDeque<String>,
    lifecycle: Option<Arc<InputLifecycle>>,
    result_candidate: bool,
    result_seen: bool,
    root_output: bool,
    reset_pending: bool,
    drain_suspended: bool,
    policy: ResultSettlePolicy,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ResultSettlePolicy {
    #[default]
    SettleOnFailure,
    AwaitBackgroundWork,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TaskScope {
    Foreground,
    Background,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tombstone {
    Finished,
    Retired,
}

impl ResultLineDetector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_lifecycle(mut self, lifecycle: Option<Arc<InputLifecycle>>) -> Self {
        self.lifecycle = lifecycle;
        self
    }

    pub fn with_settle_policy(mut self, policy: ResultSettlePolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn rearm(&mut self, lifecycle: Option<Arc<InputLifecycle>>) {
        self.fired = false;
        self.result_candidate = false;
        self.result_seen = false;
        self.root_output = false;
        self.drain_suspended = false;
        self.lifecycle = lifecycle;
        self.inherited = self.live.keys().cloned().collect();
    }

    pub fn suspend_drain_settlement(&mut self) {
        self.drain_suspended = true;
    }

    pub fn resume_drain_settlement(&mut self) {
        self.drain_suspended = false;
    }

    pub fn track_message(&mut self, message: &Value) -> Result<(), &'static str> {
        if !self.accepts_root(message) {
            return Ok(());
        }
        if message.get("type").and_then(Value::as_str) != Some("system") {
            return Ok(());
        }
        let task = message
            .get("task_id")
            .and_then(Value::as_str)
            .filter(|task| !self.live.contains_key(*task))
            .map(str::to_string);
        self.consume_task(message)?;
        if let Some(task) = task.filter(|task| self.live.contains_key(task)) {
            self.inherited.insert(task);
        }
        if !self.armed_live_empty() {
            self.result_candidate = false;
        }
        Ok(())
    }

    pub fn observe_command(&mut self, message: &Value) -> Result<(), &'static str> {
        if message.get("type").and_then(Value::as_str) != Some("command_lifecycle") {
            return Ok(());
        }
        let Some(lifecycle) = &self.lifecycle else {
            return Ok(());
        };
        lifecycle.observe(message)
    }

    pub fn command_finished(&mut self) {
        self.result_seen = true;
        if self.armed_live_empty() {
            self.result_candidate = true;
        }
    }

    pub fn settle_interrupted(&mut self) -> bool {
        if self.fired {
            return false;
        }
        self.fired = self
            .lifecycle
            .as_ref()
            .is_none_or(|lifecycle| lifecycle.close_if_settled());
        self.fired
    }

    pub fn settle_finished_foreground(&mut self) -> bool {
        if self.fired || !self.result_seen || self.armed_foreground_live() {
            return false;
        }
        self.fired = self
            .lifecycle
            .as_ref()
            .is_none_or(|lifecycle| lifecycle.close_if_settled());
        self.fired
    }

    pub fn settle_if_ready(&mut self) -> bool {
        if self.fired {
            return false;
        }
        if self.drains() && self.result_seen && self.armed_live_empty() {
            self.result_candidate = true;
        }
        self.fired = self.settled();
        self.fired
    }

    pub fn live_task_count(&self) -> usize {
        self.live.len()
    }

    pub fn live_background_task_count(&self) -> usize {
        self.live
            .values()
            .filter(|scope| **scope == TaskScope::Background)
            .count()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session.as_deref()
    }

    pub fn consume_message(&mut self, message: &Value) -> Result<bool, &'static str> {
        if self.fired {
            return Ok(false);
        }
        let settled = self.consume_value(message)?;
        if settled {
            self.fired = true;
        }
        Ok(settled)
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Result<bool, &'static str> {
        if self.fired {
            return Ok(false);
        }
        let mut close = false;
        for byte in chunk {
            if *byte == b'\n' {
                if !self.skipping_line {
                    let line = std::mem::take(&mut self.line);
                    close = self.consume_line(&line)?;
                    if close {
                        self.fired = true;
                        break;
                    }
                }
                self.line.clear();
                self.skipping_line = false;
            } else if !self.skipping_line {
                if self.line.len() == MAX_LINE_BYTES {
                    // A lifecycle frame must never disappear silently. Ordinary
                    // oversized assistant/tool output does not affect ownership.
                    if lifecycle_candidate(&self.line) {
                        return Err("Claude background lifecycle frame exceeded its size limit.");
                    }
                    self.line.clear();
                    self.skipping_line = true;
                } else {
                    self.line.push(*byte);
                }
            }
        }
        Ok(close)
    }

    fn consume_line(&mut self, line: &[u8]) -> Result<bool, &'static str> {
        let Ok(message) = serde_json::from_slice::<Value>(line) else {
            return Ok(false);
        };
        self.consume_value(&message)
    }

    fn accepts_root(&mut self, message: &Value) -> bool {
        if !message.get("parent_tool_use_id").is_none_or(Value::is_null) {
            return false;
        }
        let Some(session) = message.get("session_id").and_then(Value::as_str) else {
            return true;
        };
        if !valid_id(session) || self.retired.iter().any(|retired| retired == session) {
            return false;
        }
        match &self.session {
            Some(expected) => expected == session,
            None => {
                self.session = Some(session.to_string());
                true
            }
        }
    }

    fn drains(&self) -> bool {
        self.policy == ResultSettlePolicy::AwaitBackgroundWork && !self.drain_suspended
    }

    fn unprompted_result(&self, message: &Value) -> bool {
        if self.policy != ResultSettlePolicy::AwaitBackgroundWork {
            return false;
        }
        let uuid = message.get("user_message_uuid");
        if !uuid.is_none_or(Value::is_null) {
            return false;
        }
        let named = message
            .get("user_message_uuids")
            .and_then(Value::as_array)
            .is_some_and(|ids| {
                ids.iter().filter_map(Value::as_str).any(|id| {
                    self.lifecycle
                        .as_ref()
                        .is_some_and(|lifecycle| lifecycle.names_command(id))
                })
            });
        if named {
            return false;
        }
        uuid.is_some()
            || message
                .pointer("/origin/kind")
                .is_some_and(Value::is_string)
    }

    fn consume_value(&mut self, message: &Value) -> Result<bool, &'static str> {
        if !self.accepts_root(message) {
            return Ok(false);
        }
        let kind = message.get("type").and_then(Value::as_str);
        if kind == Some("result") && self.unprompted_result(message) {
            return Ok(false);
        }
        let failed = kind == Some("result") && failed_result(message);
        if kind == Some("result") && !failed && !self.root_output && !did_work(message) {
            return Ok(false);
        }
        if let Some(lifecycle) = &self.lifecycle {
            lifecycle.observe(message)?;
        }
        match kind {
            Some("result") => {
                self.result_candidate = self.armed_live_empty();
                self.result_seen = true;
                let settle_on_failure =
                    failed && self.policy == ResultSettlePolicy::SettleOnFailure;
                Ok(settle_on_failure || self.settled())
            }
            Some("assistant") => {
                self.root_output = true;
                Ok(false)
            }
            Some("conversation_reset") => {
                self.retire_session();
                self.root_output = true;
                self.reset_pending = true;
                Ok(false)
            }
            Some("system") => {
                match message.get("subtype").and_then(Value::as_str) {
                    Some("init") => self.root_output = std::mem::take(&mut self.reset_pending),
                    Some("compact_boundary") => self.root_output = true,
                    _ => {}
                }
                let had_live = !self.armed_live_empty();
                self.consume_task(message)?;
                if !self.armed_live_empty() {
                    self.result_candidate = false;
                    return Ok(false);
                }
                if !had_live || !self.result_seen || !self.drains() {
                    return Ok(false);
                }
                self.result_candidate = true;
                Ok(self.settled())
            }
            Some("command_lifecycle") => Ok(self.settled()),
            _ => Ok(false),
        }
    }

    fn settled(&self) -> bool {
        self.result_candidate
            && self.armed_live_empty()
            && self
                .lifecycle
                .as_ref()
                .is_none_or(|lifecycle| lifecycle.close_if_settled())
    }

    fn armed_live_empty(&self) -> bool {
        self.live.keys().all(|task| self.inherited.contains(task))
    }

    fn armed_foreground_live(&self) -> bool {
        self.live
            .iter()
            .any(|(task, scope)| *scope == TaskScope::Foreground && !self.inherited.contains(task))
    }

    fn retire_session(&mut self) {
        if let Some(session) = self.session.take() {
            if self.retired.len() == MAX_RETIRED_SESSIONS {
                self.retired.pop_front();
            }
            self.retired.push_back(session);
        }
        self.inherited.clear();
        let retired: Vec<String> = self.live.drain().map(|(task, _)| task).collect();
        for task in retired {
            self.bury(task, Tombstone::Retired);
        }
    }

    fn bury(&mut self, task: String, tombstone: Tombstone) {
        if self.terminal.contains_key(&task) {
            return;
        }
        self.buried.push_back(task.clone());
        self.terminal.insert(task, tombstone);
    }

    fn exhume(&mut self, task: &str) {
        self.terminal.remove(task);
        self.buried.retain(|buried| buried != task);
    }

    fn make_room(&mut self) -> Result<(), &'static str> {
        while self.terminal.len() + self.live.len() >= MAX_OBSERVED_TASKS {
            if self.policy != ResultSettlePolicy::AwaitBackgroundWork {
                return Err("Claude background task history exceeded its tracking limit.");
            }
            let Some(oldest) = self.buried.pop_front() else {
                return Err("Claude background tasks exceeded their tracking limit.");
            };
            self.terminal.remove(&oldest);
        }
        Ok(())
    }

    fn consume_task(&mut self, message: &Value) -> Result<(), &'static str> {
        let Some(kind @ ("task_started" | "task_progress" | "task_notification" | "task_updated")) =
            message.get("subtype").and_then(Value::as_str)
        else {
            return Ok(());
        };
        let Some(id) = message
            .get("task_id")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
        else {
            return Ok(());
        };
        let status = if kind == "task_updated" {
            message.get("patch").and_then(|patch| patch.get("status"))
        } else {
            message.get("status")
        }
        .and_then(Value::as_str);
        let scope = match message.get("is_backgrounded").and_then(Value::as_bool) {
            Some(false) => TaskScope::Foreground,
            Some(true) | None => TaskScope::Background,
        };
        let inert = message
            .get("task_type")
            .and_then(Value::as_str)
            .is_some_and(|kind| matches!(kind, "plan" | "dream"));
        let terminal = inert
            || status.is_some_and(|status| {
                matches!(
                    status,
                    "completed" | "failed" | "killed" | "cancelled" | "stopped" | "interrupted"
                )
            });
        if !terminal
            && kind == "task_started"
            && self.terminal.get(id) == Some(&Tombstone::Finished)
        {
            if self.live.len() >= MAX_LIVE_TASKS {
                return Err("Claude background tasks exceeded their tracking limit.");
            }
            self.exhume(id);
            self.inherited.remove(id);
            self.live.insert(id.to_string(), scope);
            return Ok(());
        }
        if terminal {
            if !self.terminal.contains_key(id) && !self.live.contains_key(id) {
                self.make_room()?;
            }
            self.live.remove(id);
            self.inherited.remove(id);
            self.bury(id.to_string(), Tombstone::Finished);
        } else if kind == "task_started"
            && !self.terminal.contains_key(id)
            && !self.live.contains_key(id)
        {
            if self.live.len() >= MAX_LIVE_TASKS {
                return Err("Claude background tasks exceeded their tracking limit.");
            }
            if self.make_room().is_err() {
                return Err("Claude background tasks exceeded their tracking limit.");
            }
            self.live.insert(id.to_string(), scope);
        }
        Ok(())
    }
}

pub fn failed_result(message: &Value) -> bool {
    message.get("is_error").and_then(Value::as_bool) == Some(true)
        || message
            .get("subtype")
            .and_then(Value::as_str)
            .is_some_and(|subtype| subtype.starts_with("error"))
}

fn did_work(message: &Value) -> bool {
    let positive = |value: Option<&Value>| value.and_then(Value::as_u64).is_some_and(|n| n > 0);
    positive(message.get("num_turns"))
        || positive(message.pointer("/usage/output_tokens"))
        || message
            .get("result")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_BYTES && !id.chars().any(char::is_control)
}

pub fn lifecycle_candidate(line: &[u8]) -> bool {
    // Provider JSONL uses type first. Unknown field ordering on an oversized
    // record cannot safely prove it is ordinary output, so fail closed as well.
    !line.starts_with(b"{\"type\":\"assistant\"")
        && !line.starts_with(b"{\"type\":\"stream_event\"")
        && !line.starts_with(b"{\"type\":\"user\"")
}

#[cfg(test)]
#[path = "agent_task_result_detector_tests.rs"]
mod tests;
