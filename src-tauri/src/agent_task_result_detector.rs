use std::collections::HashSet;

use serde_json::Value;

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_LIVE_TASKS: usize = 256;
const MAX_OBSERVED_TASKS: usize = 4096;
const MAX_ID_BYTES: usize = 256;

/// Owns only lifecycle evidence from root Claude JSONL messages. A foreground
/// result is not the end of the stream while native background tasks are live.
/// Terminal tombstones prevent delayed progress/starts from resurrecting tasks.
/// A terminal task update followed by a root result settles this per-run CLI.
/// This does not retain idle sessions for hypothetical later notifications.
#[derive(Default)]
pub struct ResultLineDetector {
    line: Vec<u8>,
    skipping_line: bool,
    fired: bool,
    live: HashSet<String>,
    terminal: HashSet<String>,
    session: Option<String>,
}

impl ResultLineDetector {
    pub fn new() -> Self {
        Self::default()
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
        if !message.get("parent_tool_use_id").is_none_or(Value::is_null) {
            return Ok(false);
        }
        if let Some(session) = message.get("session_id").and_then(Value::as_str) {
            if !valid_id(session) {
                return Ok(false);
            }
            match &self.session {
                Some(expected) if expected != session => return Ok(false),
                None => self.session = Some(session.to_string()),
                _ => {}
            }
        }
        match message.get("type").and_then(Value::as_str) {
            Some("result") => {
                let failed = message.get("is_error").and_then(Value::as_bool) == Some(true)
                    || message
                        .get("subtype")
                        .and_then(Value::as_str)
                        .is_some_and(|subtype| subtype.starts_with("error"));
                Ok(failed || self.live.is_empty())
            }
            Some("system") => {
                self.consume_task(&message)?;
                Ok(false)
            }
            _ => Ok(false),
        }
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
        if terminal {
            if !self.terminal.contains(id)
                && !self.live.contains(id)
                && self.terminal.len() + self.live.len() >= MAX_OBSERVED_TASKS
            {
                return Err("Claude background task history exceeded its tracking limit.");
            }
            self.live.remove(id);
            self.terminal.insert(id.to_string());
        } else if kind == "task_started" && !self.terminal.contains(id) && !self.live.contains(id) {
            if self.live.len() >= MAX_LIVE_TASKS
                || self.terminal.len() + self.live.len() >= MAX_OBSERVED_TASKS
            {
                return Err("Claude background tasks exceeded their tracking limit.");
            }
            self.live.insert(id.to_string());
        }
        Ok(())
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_BYTES && !id.chars().any(char::is_control)
}

fn lifecycle_candidate(line: &[u8]) -> bool {
    // Provider JSONL uses type first. Unknown field ordering on an oversized
    // record cannot safely prove it is ordinary output, so fail closed as well.
    !line.starts_with(b"{\"type\":\"assistant\"")
        && !line.starts_with(b"{\"type\":\"stream_event\"")
        && !line.starts_with(b"{\"type\":\"user\"")
}

#[cfg(test)]
#[path = "agent_task_result_detector_tests.rs"]
mod tests;
