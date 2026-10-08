use super::agent_task_steering::AgentTaskStopTargets;
use super::agent_task_stop_escalation::escalate_group_stop;
use super::{
    AgentProcessGroup, AgentTaskEntry, AgentTaskPhase, AgentTaskRegistry, AgentTaskRegistryState,
    AgentTaskShared, AgentTaskStatusPayload,
};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::Arc,
};

pub const AGENT_TASK_TRUST_REVOKED_MESSAGE: &str =
    "This turn was stopped because trust in its project was revoked. Trust the project again to continue.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AgentTaskOutcomeAuthority {
    Undecided,
    Own,
    RevokedTrust,
}

struct RevokedTrustClaim {
    revoked: AgentTaskStopTargets,
    settling: Vec<Arc<AgentProcessGroup>>,
}

type RevocationWorker = Box<dyn FnOnce() + Send>;

impl AgentTaskRegistry {
    pub fn stop_for_revoked_trust(&self, trust_root: &Path, end_sessions: impl FnOnce()) {
        self.stop_revoked_trust(trust_root, end_sessions, |work| {
            self.spawn_worker("agent-task-revoke", work).is_ok()
        });
    }

    #[cfg(test)]
    pub fn stop_for_revoked_trust_without_workers_for_tests(&self, trust_root: &Path) {
        self.stop_revoked_trust(trust_root, || {}, |_| false);
    }

    fn stop_revoked_trust(
        &self,
        trust_root: &Path,
        end_sessions: impl FnOnce(),
        spawn: impl Fn(RevocationWorker) -> bool,
    ) {
        let claim = claim_revoked_trust(&mut self.shared.state(), trust_root);
        let _ = catch_unwind(AssertUnwindSafe(end_sessions));
        for group in &claim.settling {
            group.kill_unreaped();
        }
        claim.revoked.close_inputs();
        let tuning = self.shared.tuning;
        for group in claim.revoked.into_groups() {
            let escalated = Arc::clone(&group);
            let spawned = spawn(Box::new(move || {
                escalate_group_stop(&escalated, tuning.graceful_timeout, tuning.force_timeout);
            }));
            if spawned {
                continue;
            }
            let _ = group.force_stop();
        }
    }
}

fn claim_revoked_trust(state: &mut AgentTaskRegistryState, trust_root: &Path) -> RevokedTrustClaim {
    let settling = state
        .entries
        .values()
        .filter(|entry| {
            entry.metadata.trust_root.as_os_str() == trust_root.as_os_str()
                && keeps_own_outcome(entry)
        })
        .filter_map(|entry| entry.group.clone())
        .collect();
    let revoked = AgentTaskStopTargets::claim(
        state
            .entries
            .values_mut()
            .filter(|entry| {
                entry.metadata.trust_root.as_os_str() == trust_root.as_os_str()
                    && !keeps_own_outcome(entry)
            })
            .map(attribute_to_revoked_trust),
    );
    RevokedTrustClaim { revoked, settling }
}

fn keeps_own_outcome(entry: &AgentTaskEntry) -> bool {
    matches!(entry.phase, AgentTaskPhase::Terminal)
        || entry.completion_claimed
        || entry.outcome_authority == AgentTaskOutcomeAuthority::Own
}

fn attribute_to_revoked_trust(entry: &mut AgentTaskEntry) -> &mut AgentTaskEntry {
    if !entry.stop_requested {
        entry.outcome_authority = AgentTaskOutcomeAuthority::RevokedTrust;
    }
    entry
}

pub(super) fn note_own_outcome(shared: &AgentTaskShared, task_id: &str) {
    note_own_outcome_in(&mut shared.state(), task_id);
}

fn note_own_outcome_in(state: &mut AgentTaskRegistryState, task_id: &str) {
    let Some(entry) = state.entries.get_mut(task_id) else {
        return;
    };
    if entry.outcome_authority == AgentTaskOutcomeAuthority::Undecided {
        entry.outcome_authority = AgentTaskOutcomeAuthority::Own;
    }
}

pub(super) fn revoked_trust_payload(
    authority: AgentTaskOutcomeAuthority,
    payload: AgentTaskStatusPayload,
) -> AgentTaskStatusPayload {
    if authority != AgentTaskOutcomeAuthority::RevokedTrust {
        return payload;
    }
    AgentTaskStatusPayload::Failed {
        message: AGENT_TASK_TRUST_REVOKED_MESSAGE.to_string(),
    }
}

#[cfg(test)]
#[path = "agent_task_trust_revocation_claim_tests.rs"]
mod tests;
