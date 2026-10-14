use super::interactions::AgentInteractionChanges;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

pub const AGENT_APPROVAL_TIMEOUT: Duration = Duration::from_secs(600);
pub const MAX_PENDING_AGENT_APPROVALS: usize = 16;
pub const MAX_RETAINED_AGENT_APPROVALS: usize = 32;
pub const TOO_MANY_PENDING_APPROVALS: &str = "Too many approvals are already waiting for the user.";
pub const MAX_AGENT_APPROVAL_TITLE_BYTES: usize = 256;
pub const MAX_AGENT_APPROVAL_DETAIL_BYTES: usize = 16 * 1024;
pub const MAX_AGENT_APPROVAL_FACTS: usize = 8;
pub const MAX_AGENT_APPROVAL_FACT_LABEL_BYTES: usize = 64;
pub const MAX_AGENT_APPROVAL_FACT_VALUE_BYTES: usize = 2048;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentApprovalKind {
    Command,
    FileChange,
    Tool,
    Plan,
    McpElicitation,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AgentApprovalDecision {
    AllowOnce,
    AllowForSession,
    Deny,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentApprovalStatus {
    Pending,
    Approved,
    Denied,
    Cancelled,
    Expired,
    TimedOut,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentApprovalFact {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentApprovalRequest {
    pub id: String,
    pub task_id: String,
    pub provider: String,
    pub kind: AgentApprovalKind,
    pub title: String,
    pub detail: String,
    pub detail_truncated: bool,
    pub facts: Vec<AgentApprovalFact>,
    pub decisions: Vec<AgentApprovalDecision>,
    pub status: AgentApprovalStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<AgentApprovalDecision>,
}

pub type AgentApprovalResponder =
    Arc<dyn Fn(AgentApprovalDecision) -> Result<(), String> + Send + Sync>;

pub fn bounded_text(value: &str, max_bytes: usize) -> (String, bool) {
    let cleaned: String = value.chars().filter(|c| *c != '\0').collect();
    if cleaned.len() <= max_bytes {
        let stripped = cleaned.len() != value.len();
        return (cleaned, stripped);
    }
    let mut end = max_bytes;
    while !cleaned.is_char_boundary(end) {
        end -= 1;
    }
    (cleaned[..end].to_string(), true)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
}

fn valid_text(value: &str, max: usize, empty: bool) -> bool {
    value.len() <= max && !value.contains('\0') && (empty || !super::is_blank(value))
}

pub fn validate_approval(request: &AgentApprovalRequest) -> Result<(), String> {
    let mut decisions = std::collections::HashSet::new();
    if !valid_id(&request.id)
        || !matches!(request.provider.as_str(), "codex" | "claudeCode")
        || !valid_text(&request.title, MAX_AGENT_APPROVAL_TITLE_BYTES, false)
        || !valid_text(&request.detail, MAX_AGENT_APPROVAL_DETAIL_BYTES, true)
        || request.facts.len() > MAX_AGENT_APPROVAL_FACTS
        || request.decisions.is_empty()
        || !request.decisions.iter().all(|d| decisions.insert(*d))
        || !request.decisions.contains(&AgentApprovalDecision::Deny)
    {
        return Err("Invalid agent approval.".into());
    }
    if request.facts.iter().any(|fact| {
        !valid_text(&fact.label, MAX_AGENT_APPROVAL_FACT_LABEL_BYTES, false)
            || !valid_text(&fact.value, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES, true)
    }) {
        return Err("Invalid agent approval detail.".into());
    }
    Ok(())
}

struct Entry {
    request: AgentApprovalRequest,
    responder: Option<AgentApprovalResponder>,
    submitting: bool,
    deadline: Instant,
}

#[derive(Default)]
struct State {
    entries: Vec<Entry>,
    closed: bool,
    timer_running: bool,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    timeout: Duration,
    changes: AgentInteractionChanges,
}

impl Shared {
    fn locked(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct AgentApprovalRegistry {
    shared: Arc<Shared>,
}

impl Default for AgentApprovalRegistry {
    fn default() -> Self {
        Self::with_timeout(AGENT_APPROVAL_TIMEOUT)
    }
}

impl Drop for AgentApprovalRegistry {
    fn drop(&mut self) {
        self.settle_all(true);
    }
}

impl AgentApprovalRegistry {
    pub fn with_timeout(timeout: Duration) -> Self {
        Self::observed(timeout, AgentInteractionChanges::default())
    }

    pub(super) fn observed(timeout: Duration, changes: AgentInteractionChanges) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State::default()),
                wake: Condvar::new(),
                timeout,
                changes,
            }),
        }
    }

    pub fn has_pending(&self) -> bool {
        self.shared
            .locked()
            .entries
            .iter()
            .any(|entry| entry.request.status == AgentApprovalStatus::Pending)
    }

    pub fn contains(&self, request_id: &str) -> bool {
        self.shared
            .locked()
            .entries
            .iter()
            .any(|entry| entry.request.id == request_id)
    }

    pub fn register(
        &self,
        request: AgentApprovalRequest,
        responder: AgentApprovalResponder,
    ) -> Result<(), String> {
        validate_approval(&request)?;
        if request.status != AgentApprovalStatus::Pending || request.decision.is_some() {
            return Err("Only pending approvals may be registered.".into());
        }
        let start_timer = {
            let mut state = self.shared.locked();
            if state.closed || state.entries.iter().any(|e| e.request.id == request.id) {
                return Err("Approval session unavailable.".into());
            }
            if state
                .entries
                .iter()
                .filter(|e| e.request.status == AgentApprovalStatus::Pending)
                .count()
                >= MAX_PENDING_AGENT_APPROVALS
            {
                return Err(TOO_MANY_PENDING_APPROVALS.into());
            }
            if state.entries.len() >= MAX_RETAINED_AGENT_APPROVALS {
                let index = state
                    .entries
                    .iter()
                    .position(|e| e.request.status != AgentApprovalStatus::Pending)
                    .ok_or("Approval limit reached.")?;
                state.entries.remove(index);
            }
            state.entries.push(Entry {
                request,
                responder: Some(responder),
                submitting: false,
                deadline: Instant::now() + self.shared.timeout,
            });
            let start = !state.timer_running;
            state.timer_running = true;
            start
        };
        self.shared.wake.notify_all();
        if start_timer {
            self.spawn_timer();
        }
        self.shared.changes.notify();
        Ok(())
    }

    fn spawn_timer(&self) {
        let weak = Arc::downgrade(&self.shared);
        let spawned = std::thread::Builder::new()
            .name("agent-approval-timeout".into())
            .spawn(move || run_timer(&weak));
        if spawned.is_err() {
            self.shared.locked().timer_running = false;
            self.expire_overdue(Instant::now() + self.shared.timeout);
        }
    }

    pub fn list(&self, task_id: &str) -> Vec<AgentApprovalRequest> {
        self.expire_overdue(Instant::now());
        self.requests(task_id)
    }

    pub(super) fn requests(&self, task_id: &str) -> Vec<AgentApprovalRequest> {
        self.shared
            .locked()
            .entries
            .iter()
            .map(|entry| {
                let mut request = entry.request.clone();
                request.task_id = task_id.into();
                request
            })
            .collect()
    }

    pub fn cancel(&self, request_id: &str) {
        if self.mark_cancelled(request_id) {
            self.shared.changes.notify();
        }
    }

    pub fn expire(&self, request_id: &str) {
        if self.mark_expired(request_id) {
            self.shared.changes.notify();
        }
    }

    pub fn finish(&self) {
        if self.settle_all(false) {
            self.shared.changes.notify();
        }
    }

    pub fn close(&self) {
        if self.settle_all(true) {
            self.shared.changes.notify();
        }
    }

    pub(super) fn mark_cancelled(&self, request_id: &str) -> bool {
        self.settle_entry(request_id, AgentApprovalStatus::Cancelled, true)
    }

    pub(super) fn mark_expired(&self, request_id: &str) -> bool {
        self.settle_entry(request_id, AgentApprovalStatus::Expired, false)
    }

    fn settle_entry(
        &self,
        request_id: &str,
        status: AgentApprovalStatus,
        include_submitting: bool,
    ) -> bool {
        let mut state = self.shared.locked();
        let Some(entry) = state
            .entries
            .iter_mut()
            .find(|entry| entry.request.id == request_id)
        else {
            return false;
        };
        if entry.request.status != AgentApprovalStatus::Pending
            || (entry.submitting && !include_submitting)
        {
            return false;
        }
        entry.request.status = status;
        entry.responder = None;
        true
    }

    pub(super) fn settle_all(&self, include_submitting: bool) -> bool {
        let changed = {
            let mut state = self.shared.locked();
            let mut changed = !state.closed;
            state.closed = true;
            for entry in &mut state.entries {
                if entry.request.status == AgentApprovalStatus::Pending
                    && (include_submitting || !entry.submitting)
                {
                    entry.request.status = AgentApprovalStatus::Expired;
                    entry.responder = None;
                    changed = true;
                }
            }
            changed
        };
        self.shared.wake.notify_all();
        changed
    }

    pub(super) fn expire_overdue(&self, now: Instant) {
        expire_overdue(&self.shared, now);
    }

    pub fn answer(
        &self,
        task_id: &str,
        request_id: &str,
        decision: AgentApprovalDecision,
    ) -> Result<AgentApprovalRequest, String> {
        let _settlement = self.shared.changes.settling();
        self.expire_overdue(Instant::now());
        let responder = {
            let mut state = self.shared.locked();
            let closed = state.closed;
            let entry = state
                .entries
                .iter_mut()
                .find(|entry| entry.request.id == request_id)
                .ok_or("Unknown approval.")?;
            if !entry.request.decisions.contains(&decision) {
                return Err("This decision is not available for the approval.".into());
            }
            if entry.request.decision == Some(decision) {
                let mut request = entry.request.clone();
                request.task_id = task_id.into();
                return Ok(request);
            }
            if closed || entry.request.status != AgentApprovalStatus::Pending || entry.submitting {
                return Err("Approval is no longer pending.".into());
            }
            entry.submitting = true;
            entry
                .responder
                .take()
                .ok_or("Approval is no longer pending.")?
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| responder(decision)))
            .unwrap_or_else(|_| Err("Approval response failed.".into()));
        let (changed, outcome) = {
            let mut state = self.shared.locked();
            let entry = state
                .entries
                .iter_mut()
                .find(|entry| entry.request.id == request_id)
                .ok_or("Approval expired.")?;
            entry.submitting = false;
            record_answer(entry, task_id, decision, result)
        };
        if changed {
            self.shared.changes.notify();
        }
        outcome
    }
}

fn record_answer(
    entry: &mut Entry,
    task_id: &str,
    decision: AgentApprovalDecision,
    result: Result<(), String>,
) -> (bool, Result<AgentApprovalRequest, String>) {
    if let Err(error) = result {
        let pending = entry.request.status == AgentApprovalStatus::Pending;
        if pending {
            entry.request.status = AgentApprovalStatus::Expired;
        }
        return (pending, Err(error));
    }
    entry.request.status = match decision {
        AgentApprovalDecision::Deny => AgentApprovalStatus::Denied,
        AgentApprovalDecision::AllowOnce | AgentApprovalDecision::AllowForSession => {
            AgentApprovalStatus::Approved
        }
    };
    entry.request.decision = Some(decision);
    let mut request = entry.request.clone();
    request.task_id = task_id.into();
    (true, Ok(request))
}

fn expire_overdue(shared: &Shared, now: Instant) {
    let mut timed_out = false;
    let overdue: Vec<AgentApprovalResponder> = {
        let mut state = shared.locked();
        state
            .entries
            .iter_mut()
            .filter(|entry| {
                entry.request.status == AgentApprovalStatus::Pending
                    && !entry.submitting
                    && entry.deadline <= now
            })
            .filter_map(|entry| {
                entry.request.status = AgentApprovalStatus::TimedOut;
                timed_out = true;
                entry.responder.take()
            })
            .collect()
    };
    if timed_out {
        shared.changes.notify();
    }
    for responder in overdue {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            responder(AgentApprovalDecision::Deny)
        }));
    }
}

fn run_timer(weak: &Weak<Shared>) {
    loop {
        let Some(shared) = weak.upgrade() else {
            return;
        };
        let next = {
            let mut state = shared.locked();
            let next = state
                .entries
                .iter()
                .filter(|e| e.request.status == AgentApprovalStatus::Pending && !e.submitting)
                .map(|e| e.deadline)
                .min();
            if state.closed || next.is_none() {
                state.timer_running = false;
                return;
            }
            let wait = next
                .map(|deadline| deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_default();
            let (_state, _) = shared
                .wake
                .wait_timeout(state, wait.min(Duration::from_secs(1)))
                .unwrap_or_else(PoisonError::into_inner);
            next
        };
        if next.is_some_and(|deadline| deadline <= Instant::now()) {
            expire_overdue(&shared, Instant::now());
        }
    }
}

#[cfg(test)]
#[path = "agent_approvals_tests.rs"]
mod tests;
