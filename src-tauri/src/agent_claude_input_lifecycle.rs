//! Correlates accepted stdin commands with provider lifecycle, not output timing.
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, PoisonError,
    },
};

#[derive(Default)]
struct Pending {
    started_after: Option<u64>,
    completed: bool,
}
struct State {
    supported: bool,
    closed: bool,
    results: u64,
    pending: HashMap<String, Pending>,
}
pub struct ClaudeInputLifecycle {
    initial_id: String,
    state: Mutex<State>,
}
impl Default for ClaudeInputLifecycle {
    fn default() -> Self {
        Self::new()
    }
}
impl ClaudeInputLifecycle {
    pub fn new() -> Self {
        Self {
            initial_id: command_id(),
            state: Mutex::new(State {
                supported: false,
                closed: false,
                results: 0,
                pending: HashMap::new(),
            }),
        }
    }
    pub fn initial_frame(&self, frame: &[u8]) -> Vec<u8> {
        tagged_frame(frame, &self.initial_id)
    }
    pub fn reserve(
        &self,
        frame: &[u8],
    ) -> Result<(String, Vec<u8>), super::AgentTaskSteerRejection> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if !state.supported || state.closed || state.pending.len() >= 32 {
            return Err(super::AgentTaskSteerRejection::NotSteerable);
        }
        let id = command_id();
        state.pending.insert(id.clone(), Pending::default());
        Ok((id.clone(), tagged_frame(frame, &id)))
    }
    pub fn has_pending(&self) -> bool {
        !self
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pending
            .is_empty()
    }
    pub fn abandon(&self, id: &str) {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pending
            .remove(id);
    }
    pub fn observe(&self, message: &Value) -> Result<(), &'static str> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if message.get("type").and_then(Value::as_str) == Some("result") {
            state.results = state.results.saturating_add(1);
        }
        if message.get("type").and_then(Value::as_str) == Some("command_lifecycle") {
            let id = message
                .get("command_uuid")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let phase = message
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if id == self.initial_id && matches!(phase, "queued" | "started") {
                state.supported = true;
            }
            let results = state.results;
            if let Some(pending) = state.pending.get_mut(id) {
                match phase {
                    "started" => {
                        pending.started_after.get_or_insert(results);
                    }
                    "completed" => pending.completed = true,
                    "cancelled" | "discarded" | "refused" => {
                        return Err("Claude did not complete an accepted follow-up message.")
                    }
                    _ => {}
                }
            }
        }
        let results = state.results;
        state.pending.retain(|_, pending| {
            !(pending.completed && pending.started_after.is_some_and(|start| results > start))
        });
        Ok(())
    }
    pub fn close_if_settled(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if !state.pending.is_empty() {
            return false;
        }
        state.closed = true;
        true
    }
}
fn tagged_frame(frame: &[u8], id: &str) -> Vec<u8> {
    let mut tagged = format!("{{\"uuid\":\"{id}\",").into_bytes();
    tagged.extend_from_slice(frame.strip_prefix(b"{").unwrap_or(frame));
    tagged
}
fn command_id() -> String {
    use sha2::{Digest, Sha256};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let mut digest = Sha256::new();
    digest.update(std::process::id().to_le_bytes());
    digest.update(SEQUENCE.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    digest.update(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_le_bytes(),
    );
    let mut bytes = digest.finalize();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn event(id: &str, state: &str) -> Value {
        json!({"type":"command_lifecycle","command_uuid":id,"state":state})
    }
    fn ready() -> ClaudeInputLifecycle {
        let ledger = ClaudeInputLifecycle::new();
        ledger
            .observe(&event(&ledger.initial_id, "started"))
            .unwrap();
        ledger
    }
    #[test]
    fn unknown_cli_cannot_accept_live_input() {
        assert!(ClaudeInputLifecycle::new()
            .reserve(b"{\"type\":\"user\"}\n")
            .is_err());
    }
    #[test]
    fn prior_result_cannot_settle_queued_input_in_either_terminal_order() {
        for completed_first in [false, true] {
            let ledger = ready();
            let (id, frame) = ledger.reserve(b"{\"type\":\"user\"}\n").unwrap();
            assert_eq!(serde_json::from_slice::<Value>(&frame).unwrap()["uuid"], id);
            ledger.observe(&json!({"type":"result"})).unwrap();
            assert!(!ledger.close_if_settled());
            ledger.observe(&event(&id, "started")).unwrap();
            if completed_first {
                ledger.observe(&event(&id, "completed")).unwrap();
            }
            assert!(!ledger.close_if_settled());
            ledger.observe(&json!({"type":"result"})).unwrap();
            if !completed_first {
                assert!(!ledger.close_if_settled());
                ledger.observe(&event(&id, "completed")).unwrap();
            }
            assert!(ledger.close_if_settled());
            assert!(ledger.reserve(b"{}\n").is_err());
        }
    }
    #[test]
    fn foreign_duplicate_and_reordered_events_never_discharge_pending_input() {
        let ledger = ready();
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.observe(&event("foreign", "completed")).unwrap();
        ledger.observe(&event(&id, "completed")).unwrap();
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(!ledger.close_if_settled());
        ledger.observe(&event(&id, "started")).unwrap();
        ledger.observe(&event(&id, "started")).unwrap();
        assert!(!ledger.close_if_settled());
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(ledger.close_if_settled());
    }
    #[test]
    fn refused_input_is_explicit_failure_and_tracking_is_bounded() {
        let ledger = ready();
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        assert!(ledger.observe(&event(&id, "refused")).is_err());
        ledger.abandon(&id);
        for _ in 0..32 {
            ledger.reserve(b"{}\n").unwrap();
        }
        assert!(ledger.reserve(b"{}\n").is_err());
    }
    #[test]
    fn ids_are_distinct_uuid_values() {
        let a = command_id();
        let b = command_id();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
    }
}
