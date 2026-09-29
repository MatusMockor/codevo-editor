//! Correlates accepted stdin commands with provider lifecycle, not output timing.
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, PoisonError,
    },
};

const MAX_REMEMBERED_ABANDONED: usize = 64;
const FOLLOW_UP_NOT_COMPLETED: &str = "Claude did not complete an accepted follow-up message.";

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
    interrupted: VecDeque<String>,
    interrupting: bool,
    withdrawable: HashMap<String, Pending>,
}
impl State {
    fn remember_interrupted(&mut self, id: String) {
        if self.interrupted.len() == MAX_REMEMBERED_ABANDONED {
            self.interrupted.pop_front();
        }
        self.interrupted.push_back(id);
    }
    fn discharge_finished(&mut self) {
        let results = self.results;
        self.pending.retain(|_, pending| {
            !(pending.completed && pending.started_after.is_some_and(|start| results > start))
        });
    }
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
                interrupted: VecDeque::new(),
                interrupting: false,
                withdrawable: HashMap::new(),
            }),
        }
    }
    pub(crate) fn initial_command_id(&self) -> &str {
        &self.initial_id
    }
    pub fn initial_frame(&self, frame: &[u8]) -> Vec<u8> {
        tagged_frame(frame, &self.initial_id)
    }
    pub fn reserve(
        &self,
        frame: &[u8],
    ) -> Result<(String, Vec<u8>), super::AgentTaskSteerRejection> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.interrupting && !state.closed {
            return Err(super::AgentTaskSteerRejection::Stopping);
        }
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
    pub(crate) fn names_command(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        if id == self.initial_id {
            return true;
        }
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.pending.contains_key(id) || state.interrupted.iter().any(|known| known == id)
    }
    pub fn abandon_all(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let abandoned: Vec<String> = state.pending.drain().map(|(id, _)| id).collect();
        for id in abandoned {
            state.remember_interrupted(id);
        }
    }
    pub fn begin_interrupt(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.interrupting = true;
        state.withdrawable.clear();
        let abandoned: Vec<(String, Pending)> = state.pending.drain().collect();
        for (id, progress) in abandoned {
            state.remember_interrupted(id.clone());
            state.withdrawable.insert(id, progress);
        }
    }
    pub fn withdraw_interrupt(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if !state.interrupting {
            return;
        }
        state.interrupting = false;
        let restored: Vec<(String, Pending)> = state.withdrawable.drain().collect();
        for (id, progress) in restored {
            state.interrupted.retain(|known| *known != id);
            state.pending.insert(id, progress);
        }
        state.discharge_finished();
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
                advance(pending, phase, results)?;
            }
            let withdrawn_failed = state
                .withdrawable
                .get_mut(id)
                .is_some_and(|progress| advance(progress, phase, results).is_err());
            if withdrawn_failed {
                state.withdrawable.remove(id);
            }
        }
        state.discharge_finished();
        Ok(())
    }
    pub fn is_closed(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .closed
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
fn advance(pending: &mut Pending, phase: &str, results: u64) -> Result<(), &'static str> {
    match phase {
        "started" => {
            pending.started_after.get_or_insert(results);
        }
        "completed" => pending.completed = true,
        "cancelled" | "discarded" | "refused" => return Err(FOLLOW_UP_NOT_COMPLETED),
        _ => {}
    }
    Ok(())
}
fn tagged_frame(frame: &[u8], id: &str) -> Vec<u8> {
    let mut tagged = format!("{{\"uuid\":\"{id}\",").into_bytes();
    tagged.extend_from_slice(frame.strip_prefix(b"{").unwrap_or(frame));
    tagged
}
pub(crate) fn command_id() -> String {
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
    #[test]
    fn abandon_all_lets_an_interrupted_turn_settle_and_ignores_late_cancellations() {
        let ledger = ready();
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.abandon_all();
        ledger.observe(&event(&id, "cancelled")).unwrap();
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(ledger.close_if_settled());
    }
    #[test]
    fn initial_command_id_is_the_tag_of_the_initial_frame() {
        let ledger = ClaudeInputLifecycle::new();
        let frame = ledger.initial_frame(b"{\"type\":\"user\"}\n");
        let tagged: Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(tagged["uuid"], ledger.initial_command_id());
        assert_ne!(
            ledger.initial_command_id(),
            ClaudeInputLifecycle::new().initial_command_id()
        );
    }
    #[test]
    fn is_closed_reports_only_a_settled_close() {
        let ledger = ready();
        assert!(!ledger.is_closed());
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        assert!(!ledger.close_if_settled());
        assert!(!ledger.is_closed());
        ledger.abandon(&id);
        assert!(ledger.close_if_settled());
        assert!(ledger.is_closed());
        assert!(!ClaudeInputLifecycle::new().is_closed());
    }
    #[test]
    fn names_command_covers_the_initial_pending_and_interrupted_ids_only() {
        let ledger = ready();
        let (first, _) = ledger.reserve(b"{}\n").unwrap();
        assert!(ledger.names_command(ledger.initial_command_id()));
        assert!(ledger.names_command(&first));
        ledger.abandon_all();
        assert!(
            ledger.names_command(&first),
            "an interrupted steer stays ours"
        );
        let (second, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.abandon(&second);
        assert!(!ledger.names_command(&second));
        assert!(!ledger.names_command("foreign"));
        assert!(!ledger.names_command(""));
    }
    #[test]
    fn repeated_abandon_all_remembers_every_interrupted_steer_within_its_bound() {
        let ledger = ready();
        let (first, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.abandon_all();
        let (second, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.abandon_all();
        assert!(ledger.names_command(&first));
        assert!(ledger.names_command(&second));
        for _ in 0..MAX_REMEMBERED_ABANDONED {
            ledger.reserve(b"{}\n").unwrap();
            ledger.abandon_all();
        }
        assert!(!ledger.names_command(&first), "the oldest id is evicted");
        let state = ledger.state.lock().unwrap();
        assert_eq!(state.interrupted.len(), MAX_REMEMBERED_ABANDONED);
    }
    #[test]
    fn an_interrupt_refuses_later_steers_as_stopping_until_it_is_withdrawn() {
        let ledger = ready();
        let (queued, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.begin_interrupt();
        assert!(!ledger.has_pending());
        assert!(ledger.names_command(&queued));
        assert_eq!(
            ledger.reserve(b"{}\n").map(|_| ()),
            Err(super::super::AgentTaskSteerRejection::Stopping)
        );
        assert!(!ledger.has_pending());
        ledger.withdraw_interrupt();
        assert!(ledger.has_pending(), "the withdrawn steer is awaited again");
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(!ledger.close_if_settled());
        assert!(ledger.reserve(b"{}\n").is_ok());
    }
    #[test]
    fn a_withdrawn_interrupt_keeps_progress_seen_meanwhile_and_drops_cancelled_steers() {
        let ledger = ready();
        let (started, _) = ledger.reserve(b"{}\n").unwrap();
        let (cancelled, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.begin_interrupt();
        ledger.observe(&event(&started, "started")).unwrap();
        ledger.observe(&event(&started, "completed")).unwrap();
        ledger.observe(&event(&cancelled, "cancelled")).unwrap();
        ledger.withdraw_interrupt();
        assert!(ledger.has_pending(), "the started steer awaits its result");
        assert!(!ledger.close_if_settled());
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(!ledger.has_pending());
        assert!(ledger.close_if_settled());
    }
    #[test]
    fn withdrawing_without_an_interrupt_changes_nothing() {
        let ledger = ready();
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.withdraw_interrupt();
        assert!(ledger.has_pending());
        ledger.abandon(&id);
        ledger.begin_interrupt();
        ledger.withdraw_interrupt();
        ledger.begin_interrupt();
        assert!(ledger.reserve(b"{}\n").is_err());
        assert!(!ledger.has_pending());
    }
}
