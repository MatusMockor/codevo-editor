use super::{AgentTaskInputSlot, AgentTaskPhase, AgentTaskRegistry};
use crate::agent_task_spawner::agent_task_input::AgentTaskInterruptRejection;
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

const AGENT_INTERRUPT_DEADLINE: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentTaskInterruptOutcome {
    Interrupting,
    Unsupported,
    Unavailable,
    Stopping,
}

enum InterruptClaim {
    Claimed(Arc<AgentTaskInputSlot>),
    Settled(AgentTaskInterruptOutcome),
}

impl AgentTaskRegistry {
    pub fn interrupt_for_thread(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
    ) -> AgentTaskInterruptOutcome {
        let input = match self.claim_interrupt(task_id, workspace_id, thread_id) {
            InterruptClaim::Claimed(input) => input,
            InterruptClaim::Settled(outcome) => return outcome,
        };
        match input.interrupt(Instant::now() + AGENT_INTERRUPT_DEADLINE) {
            Ok(()) => AgentTaskInterruptOutcome::Interrupting,
            Err(AgentTaskInterruptRejection::WriteFailed) => {
                let _ = self.stop_owned(task_id, Some(workspace_id));
                AgentTaskInterruptOutcome::Stopping
            }
            Err(AgentTaskInterruptRejection::Unsupported) => {
                self.release_interrupt(task_id, &input);
                AgentTaskInterruptOutcome::Unsupported
            }
            Err(AgentTaskInterruptRejection::Unavailable) => {
                self.release_interrupt(task_id, &input);
                AgentTaskInterruptOutcome::Unavailable
            }
        }
    }

    fn claim_interrupt(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
    ) -> InterruptClaim {
        let mut state = self.shared.state();
        let Some(entry) = state.entries.get_mut(task_id) else {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Unavailable);
        };
        if entry.metadata.workspace_id != workspace_id || entry.metadata.thread_id != thread_id {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Unavailable);
        }
        if entry.stop_requested
            || entry.watchdog_timed_out
            || !matches!(entry.phase, AgentTaskPhase::Running)
        {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Unavailable);
        }
        if entry.interrupt_requested {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Interrupting);
        }
        let Some(input) = entry.input.clone() else {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Unsupported);
        };
        if !input.provider_owns_settlement() {
            return InterruptClaim::Settled(AgentTaskInterruptOutcome::Unsupported);
        }
        entry.interrupt_requested = true;
        InterruptClaim::Claimed(input)
    }

    fn release_interrupt(&self, task_id: &str, input: &Arc<AgentTaskInputSlot>) {
        let mut state = self.shared.state();
        let Some(entry) = state.entries.get_mut(task_id) else {
            return;
        };
        if !entry
            .input
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, input))
        {
            return;
        }
        entry.interrupt_requested = false;
    }
}
