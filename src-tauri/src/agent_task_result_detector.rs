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
pub const MAX_BACKGROUND_TASK_DESCRIPTION_BYTES: usize = 512;

/// Owns only lifecycle evidence from root Claude JSONL messages. A foreground
/// result is not the end of the stream while native background tasks are live.
/// A terminal task update followed by a root result settles this per-run CLI.
#[derive(Default)]
pub struct ResultLineDetector {
    line: Vec<u8>,
    skipping_line: bool,
    fired: bool,
    live: HashMap<String, LiveTask>,
    level: BackgroundLevel,
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
    started: u64,
    background_revision: u64,
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
pub enum BackgroundTaskKind {
    Agent,
    Shell,
    Monitor,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveBackgroundTask {
    pub task_id: String,
    pub kind: BackgroundTaskKind,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TaskFacts {
    kind: BackgroundTaskKind,
    description: Option<String>,
    run: Option<String>,
    inert: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LiveTask {
    scope: TaskScope,
    facts: TaskFacts,
    order: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Tombstone {
    Finished(TaskFacts),
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
        self.expire_level_ended(message);
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
            .filter(|task| task.scope == TaskScope::Background)
            .count()
    }

    pub fn has_live_background_task(&self, task_id: &str) -> bool {
        self.live
            .get(task_id)
            .is_some_and(|task| task.scope == TaskScope::Background)
    }

    pub fn background_revision(&self) -> u64 {
        self.background_revision
    }

    pub fn background_tasks(&self) -> Vec<LiveBackgroundTask> {
        let mut tasks: Vec<(&String, &LiveTask)> = self
            .live
            .iter()
            .filter(|(_, task)| task.scope == TaskScope::Background)
            .collect();
        tasks.sort_by_key(|(_, task)| task.order);
        tasks
            .into_iter()
            .map(|(id, task)| LiveBackgroundTask {
                task_id: id.clone(),
                kind: task.facts.kind,
                description: task.facts.description.clone(),
            })
            .collect()
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
        self.expire_level_ended(message);
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
            .any(|(id, task)| task.scope == TaskScope::Foreground && !self.inherited.contains(id))
    }

    fn retire_session(&mut self) {
        if let Some(session) = self.session.take() {
            if self.retired.len() == MAX_RETIRED_SESSIONS {
                self.retired.pop_front();
            }
            self.retired.push_back(session);
        }
        self.inherited.clear();
        self.level = BackgroundLevel::default();
        let retired: Vec<(String, LiveTask)> = self.live.drain().collect();
        for (task, live) in retired {
            self.note_background(live.scope);
            self.bury(task, Tombstone::Retired);
        }
    }

    fn note_background(&mut self, scope: TaskScope) {
        if scope == TaskScope::Background {
            self.background_revision = self.background_revision.wrapping_add(1);
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

    pub fn expire_level_ended(&mut self, message: &Value) -> bool {
        if !self.level.has_ended() || !self.own_root(message) || self.level.awaits(message) {
            return false;
        }
        for task in self.level.take_ended() {
            self.finish(task, message);
        }
        true
    }

    fn own_root(&self, message: &Value) -> bool {
        message.get("parent_tool_use_id").is_none_or(Value::is_null)
            && message
                .get("session_id")
                .and_then(Value::as_str)
                .is_none_or(|session| self.session.as_deref().is_none_or(|own| own == session))
    }

    fn start(&mut self, task: &str, scope: TaskScope, facts: TaskFacts, message: &Value) {
        self.level.started(task, leveled_task(message));
        self.started = self.started.wrapping_add(1);
        self.note_background(scope);
        self.live.insert(
            task.to_string(),
            LiveTask {
                scope,
                facts,
                order: self.started,
            },
        );
    }

    fn finish(&mut self, task: String, message: &Value) {
        let facts = match self.live.remove(&task) {
            Some(live) => {
                self.note_background(live.scope);
                live.facts
            }
            None => task_facts(message, None),
        };
        self.inherited.remove(&task);
        self.level.forget(&task);
        self.bury(task, Tombstone::Finished(facts));
    }

    fn consume_task(&mut self, message: &Value) -> Result<(), &'static str> {
        let subtype = message.get("subtype").and_then(Value::as_str);
        if subtype == Some("background_tasks_changed") {
            self.level.replace(message);
            return Ok(());
        }
        let Some(kind @ ("task_started" | "task_progress" | "task_notification" | "task_updated")) =
            subtype
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
        let inert = message.get("ambient").and_then(Value::as_bool) == Some(true)
            || message
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
        let finished = matches!(self.terminal.get(id), Some(Tombstone::Finished(_)));
        if !terminal && kind == "task_started" && finished {
            if self.live.len() >= MAX_LIVE_TASKS {
                return Err("Claude background tasks exceeded their tracking limit.");
            }
            self.exhume(id);
            self.inherited.remove(id);
            self.start(id, scope, task_facts(message, None), message);
            return Ok(());
        }
        if !terminal && kind != "task_started" {
            return self.revive_resumed(id, message);
        }
        if terminal {
            if !self.terminal.contains_key(id) && !self.live.contains_key(id) {
                self.make_room()?;
            }
            self.finish(id.to_string(), message);
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
            self.start(id, scope, task_facts(message, None), message);
        }
        Ok(())
    }

    fn revive_resumed(&mut self, id: &str, message: &Value) -> Result<(), &'static str> {
        let Some(Tombstone::Finished(previous)) = self.terminal.get(id) else {
            return Ok(());
        };
        let Some(run) = previous.run.as_deref() else {
            return Ok(());
        };
        let resumed = message
            .get("tool_use_id")
            .and_then(Value::as_str)
            .filter(|tool| valid_id(tool))
            .is_some_and(|tool| tool != run);
        if !resumed || previous.inert || previous.kind != BackgroundTaskKind::Agent {
            return Ok(());
        }
        if self.live.len() >= MAX_LIVE_TASKS {
            return Err("Claude background tasks exceeded their tracking limit.");
        }
        let facts = task_facts(message, Some(previous));
        self.exhume(id);
        self.start(id, TaskScope::Background, facts, message);
        self.inherited.insert(id.to_string());
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

fn task_facts(message: &Value, previous: Option<&TaskFacts>) -> TaskFacts {
    let kind = match message.get("task_type").and_then(Value::as_str) {
        Some("agent" | "local_agent" | "remote_agent") => BackgroundTaskKind::Agent,
        Some("shell" | "local_bash") => BackgroundTaskKind::Shell,
        Some("monitor" | "monitor_mcp" | "monitor_ws") => BackgroundTaskKind::Monitor,
        Some(_) => BackgroundTaskKind::Other,
        None => previous.map_or(BackgroundTaskKind::Other, |facts| facts.kind),
    };
    let description = match message.get("subtype").and_then(Value::as_str) {
        Some("task_started") => bounded_description(message.get("description")),
        _ => previous.and_then(|facts| facts.description.clone()),
    };
    let run = message
        .get("tool_use_id")
        .and_then(Value::as_str)
        .filter(|tool| valid_id(tool))
        .map(str::to_string)
        .or_else(|| previous.and_then(|facts| facts.run.clone()));
    let inert = message.get("ambient").and_then(Value::as_bool) == Some(true)
        || message
            .get("task_type")
            .and_then(Value::as_str)
            .is_some_and(|kind| matches!(kind, "plan" | "dream"));
    TaskFacts {
        kind,
        description,
        run,
        inert,
    }
}

fn bounded_description(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    if text.is_empty() || text.chars().any(char::is_control) {
        return None;
    }
    let mut end = text.len().min(MAX_BACKGROUND_TASK_DESCRIPTION_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Some(text[..end].to_string())
}

fn leveled_task(message: &Value) -> bool {
    message
        .get("task_type")
        .and_then(Value::as_str)
        .is_some_and(|kind| matches!(kind, "local_bash" | "monitor_mcp" | "monitor_ws"))
}

fn task_bookend(message: &Value) -> Option<&str> {
    let subtype = message.get("subtype").and_then(Value::as_str)?;
    if !matches!(
        subtype,
        "task_progress" | "task_notification" | "task_updated" | "background_tasks_changed"
    ) {
        return None;
    }
    Some(
        message
            .get("task_id")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
}

#[derive(Default)]
struct BackgroundLevel {
    announced: HashSet<String>,
    tracked: HashSet<String>,
    listed: HashSet<String>,
    ended: HashSet<String>,
}

impl BackgroundLevel {
    fn replace(&mut self, message: &Value) {
        let Some(tasks) = message
            .get("tasks")
            .and_then(Value::as_array)
            .filter(|tasks| tasks.len() <= MAX_OBSERVED_TASKS)
        else {
            return;
        };
        self.announced = tasks
            .iter()
            .filter(|task| task.get("ambient").and_then(Value::as_bool) != Some(true))
            .filter_map(|task| task.get("task_id").and_then(Value::as_str))
            .filter(|task| valid_id(task))
            .map(str::to_string)
            .collect();
        let announced = &self.announced;
        self.ended.extend(
            self.listed
                .iter()
                .filter(|task| !announced.contains(*task))
                .cloned(),
        );
        self.ended.retain(|task| !announced.contains(task));
        self.listed.extend(
            self.tracked
                .iter()
                .filter(|task| announced.contains(*task))
                .cloned(),
        );
    }

    fn started(&mut self, task: &str, leveled: bool) {
        self.forget(task);
        if !leveled {
            return;
        }
        self.tracked.insert(task.to_string());
        if self.announced.contains(task) {
            self.listed.insert(task.to_string());
        }
    }

    fn forget(&mut self, task: &str) {
        self.tracked.remove(task);
        self.listed.remove(task);
        self.ended.remove(task);
    }

    fn has_ended(&self) -> bool {
        !self.ended.is_empty()
    }

    fn awaits(&self, message: &Value) -> bool {
        task_bookend(message).is_some_and(|task| task.is_empty() || self.ended.contains(task))
    }

    fn take_ended(&mut self) -> Vec<String> {
        self.ended.drain().collect()
    }
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

#[cfg(test)]
#[path = "agent_task_result_detector_revival_tests.rs"]
mod revival_tests;
