use super::{AgentTaskMetadata, AgentTaskShared};
use crate::agent_questions::interactions::AgentInteractionSettlement;
use crate::agent_questions::AgentQuestionSession;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};

struct AgentInteractionLease {
    superseded: Arc<AtomicBool>,
    sequence: Arc<AtomicU64>,
}

#[derive(Default)]
pub(super) struct AgentInteractionLeases {
    sequence: Arc<AtomicU64>,
    superseded_by_task: HashMap<String, Weak<AtomicBool>>,
}

impl AgentInteractionLeases {
    pub(super) fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn issue(&mut self, task_id: &str) -> AgentInteractionLease {
        self.superseded_by_task
            .retain(|_, lease| lease.strong_count() > 0);
        let superseded = Arc::new(AtomicBool::new(false));
        let previous = self
            .superseded_by_task
            .insert(task_id.to_string(), Arc::downgrade(&superseded));
        if let Some(previous) = previous.and_then(|lease| lease.upgrade()) {
            previous.store(true, Ordering::SeqCst);
        }
        AgentInteractionLease {
            superseded,
            sequence: Arc::clone(&self.sequence),
        }
    }
}

struct AgentInteractionPublisher {
    shared: Weak<AgentTaskShared>,
    session: Weak<AgentQuestionSession>,
    superseded: Arc<AtomicBool>,
    metadata: AgentTaskMetadata,
}

impl AgentInteractionPublisher {
    fn publish(&self) {
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let Some(session) = self.session.upgrade() else {
            return;
        };
        if self.superseded.load(Ordering::SeqCst) {
            return;
        }
        let snapshot = session.snapshot(&self.metadata.task_id, &self.metadata.workspace_id);
        if self.superseded.load(Ordering::SeqCst) {
            return;
        }
        shared.sink.interactions(&self.metadata, snapshot);
    }
}

pub(super) struct AgentInteractionSubscription {
    session: Weak<AgentQuestionSession>,
}

impl AgentInteractionSubscription {
    pub(super) fn open(
        shared: &Arc<AgentTaskShared>,
        metadata: &AgentTaskMetadata,
        session: Option<&Arc<AgentQuestionSession>>,
    ) -> Option<Self> {
        let session = session?;
        let lease = shared.state().interaction_leases.issue(&metadata.task_id);
        session.share_sequence(lease.sequence);
        let publisher = AgentInteractionPublisher {
            shared: Arc::downgrade(shared),
            session: Arc::downgrade(session),
            superseded: lease.superseded,
            metadata: metadata.clone(),
        };
        let subscription = Self {
            session: Arc::downgrade(session),
        };
        session.observe(Arc::new(move || publisher.publish()));
        Some(subscription)
    }
}

impl Drop for AgentInteractionSubscription {
    fn drop(&mut self) {
        let Some(session) = self.session.upgrade() else {
            return;
        };
        session.release_observer();
    }
}

pub(super) struct AgentSettlingSession {
    session: Arc<AgentQuestionSession>,
    _settlement: AgentInteractionSettlement,
}

impl AgentSettlingSession {
    pub(super) fn retain(session: Option<&Arc<AgentQuestionSession>>) -> Option<Self> {
        let session = session?;
        Some(Self {
            session: Arc::clone(session),
            _settlement: session.settling(),
        })
    }

    pub(super) fn finish(self) {
        self.session.finish();
    }
}

#[cfg(test)]
#[path = "agent_task_interactions_tests.rs"]
mod tests;
