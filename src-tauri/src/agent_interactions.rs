use super::approvals::AgentApprovalRequest;
use super::AgentQuestionRequest;
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInteractionSnapshot {
    pub task_id: String,
    pub workspace_id: String,
    pub sequence: u64,
    pub questions: Vec<AgentQuestionRequest>,
    pub approvals: Vec<AgentApprovalRequest>,
}

impl AgentInteractionSnapshot {
    pub fn empty(task_id: &str, workspace_id: &str) -> Self {
        Self {
            task_id: task_id.into(),
            workspace_id: workspace_id.into(),
            sequence: 0,
            questions: Vec::new(),
            approvals: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct AgentInteractionSequence {
    last: u64,
    shared: Option<Arc<AtomicU64>>,
}

impl AgentInteractionSequence {
    pub fn share(&mut self, shared: Arc<AtomicU64>) {
        shared.fetch_max(self.last, Ordering::SeqCst);
        self.shared = Some(shared);
    }

    pub fn advance(&mut self) -> u64 {
        self.last = self.shared.as_ref().map_or(self.last + 1, |shared| {
            shared.fetch_add(1, Ordering::SeqCst) + 1
        });
        self.last
    }
}

pub type AgentInteractionObserver = Arc<dyn Fn() + Send + Sync>;

#[derive(Default)]
struct Subscription {
    observer: Option<AgentInteractionObserver>,
    settling: usize,
    released: bool,
}

impl Subscription {
    fn take_released(&mut self) -> Option<AgentInteractionObserver> {
        if !self.released || self.settling > 0 {
            return None;
        }
        self.observer.take()
    }
}

#[derive(Clone, Default)]
pub struct AgentInteractionChanges {
    subscription: Arc<Mutex<Subscription>>,
}

impl AgentInteractionChanges {
    fn locked(&self) -> MutexGuard<'_, Subscription> {
        self.subscription
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn observe(&self, observer: AgentInteractionObserver) {
        let previous = {
            let mut subscription = self.locked();
            subscription.released = false;
            subscription.observer.replace(observer)
        };
        drop(previous);
    }

    pub fn release(&self) {
        let released = {
            let mut subscription = self.locked();
            subscription.released = true;
            subscription.take_released()
        };
        drop(released);
    }

    pub fn settling(&self) -> AgentInteractionSettlement {
        self.locked().settling += 1;
        AgentInteractionSettlement {
            changes: self.clone(),
        }
    }

    pub fn notify(&self) {
        let observer = self.locked().observer.clone();
        let Some(observer) = observer else {
            return;
        };
        let _ = catch_unwind(AssertUnwindSafe(|| observer()));
    }
}

pub struct AgentInteractionSettlement {
    changes: AgentInteractionChanges,
}

impl Drop for AgentInteractionSettlement {
    fn drop(&mut self) {
        let released = {
            let mut subscription = self.changes.locked();
            subscription.settling = subscription.settling.saturating_sub(1);
            subscription.take_released()
        };
        drop(released);
    }
}

#[cfg(test)]
#[path = "agent_interactions_tests.rs"]
mod tests;
