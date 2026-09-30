use super::claude_session_router::MAX_REPORTED_BACKGROUND_TASKS;
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;

pub const MAX_PENDING_TASK_STOPS: usize = MAX_REPORTED_BACKGROUND_TASKS;
pub const MAX_TASK_STOP_REASON_BYTES: usize = 256;
pub const MAX_STOPPABLE_TASK_ID_BYTES: usize = 256;
const MAX_RETIRED_TASK_STOPS: usize = 2 * MAX_PENDING_TASK_STOPS;
const UNEXPLAINED_REFUSAL: &str = "Claude did not say why.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClaudeBackgroundTaskStopOutcome {
    Stopping,
    Refused { reason: String },
    Unconfirmed,
    NotLive,
    NoSession,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskStopReply {
    Accepted,
    Refused(String),
}

impl TaskStopReply {
    pub fn outcome(self) -> ClaudeBackgroundTaskStopOutcome {
        match self {
            Self::Accepted => ClaudeBackgroundTaskStopOutcome::Stopping,
            Self::Refused(reason) => ClaudeBackgroundTaskStopOutcome::Refused { reason },
        }
    }
}

struct PendingTaskStop {
    request_id: String,
    reply: Option<TaskStopReply>,
}

#[derive(Default)]
pub struct PendingTaskStops {
    pending: Vec<PendingTaskStop>,
    retired: VecDeque<String>,
}

impl PendingTaskStops {
    pub fn begin(&mut self, request_id: String) -> bool {
        if self.pending.len() >= MAX_PENDING_TASK_STOPS || self.known(&request_id) {
            return false;
        }
        self.pending.push(PendingTaskStop {
            request_id,
            reply: None,
        });
        true
    }

    pub fn resolve(&mut self, message: &Value) -> bool {
        if message.get("type").and_then(Value::as_str) != Some("control_response") {
            return false;
        }
        let Some(request_id) = message
            .pointer("/response/request_id")
            .and_then(Value::as_str)
        else {
            return false;
        };
        let reply = match message.pointer("/response/subtype").and_then(Value::as_str) {
            Some("success") => TaskStopReply::Accepted,
            Some("error") => TaskStopReply::Refused(bounded_reason(
                message.pointer("/response/error").and_then(Value::as_str),
            )),
            _ => return false,
        };
        if self.retired.iter().any(|retired| retired == request_id) {
            return true;
        }
        let Some(entry) = self
            .pending
            .iter_mut()
            .find(|entry| entry.request_id == request_id)
        else {
            return false;
        };
        entry.reply.get_or_insert(reply);
        true
    }

    pub fn take(&mut self, request_id: &str) -> Option<TaskStopReply> {
        let index = self
            .pending
            .iter()
            .position(|entry| entry.request_id == request_id && entry.reply.is_some())?;
        let entry = self.pending.remove(index);
        self.retire(entry.request_id);
        entry.reply
    }

    pub fn withdraw(&mut self, request_id: &str) {
        let Some(index) = self
            .pending
            .iter()
            .position(|entry| entry.request_id == request_id)
        else {
            return;
        };
        let entry = self.pending.remove(index);
        self.retire(entry.request_id);
    }

    fn known(&self, request_id: &str) -> bool {
        self.pending
            .iter()
            .any(|entry| entry.request_id == request_id)
            || self.retired.iter().any(|retired| retired == request_id)
    }

    fn retire(&mut self, request_id: String) {
        self.retired.push_back(request_id);
        while self.retired.len() > MAX_RETIRED_TASK_STOPS {
            self.retired.pop_front();
        }
    }
}

pub fn valid_stoppable_task_id(task_id: &str) -> bool {
    !task_id.is_empty()
        && task_id.len() <= MAX_STOPPABLE_TASK_ID_BYTES
        && !task_id.chars().any(char::is_control)
}

pub fn stop_task_frame(request_id: &str, task_id: &str) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": {"subtype": "stop_task", "task_id": task_id}
    }))
    .unwrap_or_default();
    frame.push(b'\n');
    frame
}

fn bounded_reason(error: Option<&str>) -> String {
    let mut reason = String::new();
    for character in error
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
    {
        if reason.len() + character.len_utf8() > MAX_TASK_STOP_REASON_BYTES {
            break;
        }
        reason.push(character);
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return UNEXPLAINED_REFUSAL.to_string();
    }
    reason.to_string()
}

#[cfg(test)]
#[path = "claude_session_task_stop_tests.rs"]
mod tests;
