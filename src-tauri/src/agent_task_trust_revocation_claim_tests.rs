use super::super::{
    AgentProcessGroupSignalSender, AgentProcessGroupState, AgentTaskIsolation, AgentTaskMetadata,
    WatchdogGate, KILL_PROCESS_GROUP_SIGNAL,
};
use super::*;
use std::{collections::VecDeque, path::PathBuf, sync::Mutex, time::Duration};

const TRUST_ROOT: &str = "/project";
const NESTED_REPOSITORY: &str = "/project/nested";
const TASK: &str = "agt-claim";
const PROCESS_GROUP: i32 = 4242;

#[derive(Default)]
struct RecordingSignals(Mutex<Vec<(i32, i32)>>);

impl RecordingSignals {
    fn sent(&self) -> Vec<(i32, i32)> {
        self.0.lock().expect("signals lock").clone()
    }
}

impl AgentProcessGroupSignalSender for RecordingSignals {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.0
            .lock()
            .expect("signals lock")
            .push((process_group_id, signal));
        Ok(())
    }
}

fn running_turn(signals: &Arc<RecordingSignals>) -> AgentTaskRegistryState {
    let group = AgentProcessGroup::new(
        PROCESS_GROUP,
        Arc::clone(signals) as Arc<dyn AgentProcessGroupSignalSender>,
        Duration::ZERO,
    );
    let mut state = AgentTaskRegistryState::default();
    state.entries.insert(
        TASK.to_string(),
        AgentTaskEntry {
            completion_claimed: false,
            cwd_authority: None,
            admission: None,
            metadata: AgentTaskMetadata {
                task_id: TASK.to_string(),
                thread_id: "thread".to_string(),
                workspace_id: "ws-retired".to_string(),
                trust_root: PathBuf::from(TRUST_ROOT),
                repository_root: PathBuf::from(NESTED_REPOSITORY),
                cwd: PathBuf::from(NESTED_REPOSITORY),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
            },
            phase: AgentTaskPhase::Running,
            acknowledged: true,
            flushing: false,
            queued: VecDeque::new(),
            status_sequence: 0,
            output_sequence: 0,
            output_incomplete_reported: false,
            outstanding_output: VecDeque::new(),
            last_acknowledged_output: 0,
            stdout_at_line_boundary: true,
            stderr_at_line_boundary: true,
            stop_requested: false,
            outcome_authority: AgentTaskOutcomeAuthority::Undecided,
            interrupt_requested: false,
            watchdog_timed_out: false,
            group: Some(group),
            input: None,
            questions: None,
            watchdog: Arc::new(WatchdogGate::default()),
        },
    );
    state
}

fn turn(state: &AgentTaskRegistryState) -> &AgentTaskEntry {
    state.entries.get(TASK).expect("turn entry")
}

fn explains_revoked_trust(payload: AgentTaskStatusPayload) -> bool {
    matches!(
        payload,
        AgentTaskStatusPayload::Failed { message } if message == AGENT_TASK_TRUST_REVOKED_MESSAGE
    )
}

#[test]
fn an_outcome_the_waiter_decided_before_the_claim_stays_its_own_and_its_group_is_still_killed() {
    let signals = Arc::new(RecordingSignals::default());
    let mut state = running_turn(&signals);

    note_own_outcome_in(&mut state, TASK);
    let claim = claim_revoked_trust(&mut state, Path::new(TRUST_ROOT));

    assert_eq!(
        turn(&state).outcome_authority,
        AgentTaskOutcomeAuthority::Own
    );
    assert!(!turn(&state).stop_requested);
    assert_eq!(claim.settling.len(), 1);
    assert!(signals.sent().is_empty());
    for group in &claim.settling {
        group.kill_unreaped();
    }
    assert_eq!(
        signals.sent(),
        vec![(PROCESS_GROUP, KILL_PROCESS_GROUP_SIGNAL)]
    );
    assert!(!claim.settling[0].force_requested());
    assert!(claim.revoked.into_groups().is_empty());
}

#[test]
fn an_outcome_decided_after_the_claim_is_attributed_to_the_revocation() {
    let signals = Arc::new(RecordingSignals::default());
    let mut state = running_turn(&signals);

    let claim = claim_revoked_trust(&mut state, Path::new(TRUST_ROOT));
    note_own_outcome_in(&mut state, TASK);

    assert_eq!(
        turn(&state).outcome_authority,
        AgentTaskOutcomeAuthority::RevokedTrust
    );
    assert!(turn(&state).stop_requested);
    assert!(claim.settling.is_empty());
    assert_eq!(claim.revoked.into_groups().len(), 1);
}

#[test]
fn a_turn_the_user_already_stopped_is_stopped_again_without_changing_its_outcome() {
    let signals = Arc::new(RecordingSignals::default());
    let mut state = running_turn(&signals);
    state
        .entries
        .get_mut(TASK)
        .expect("turn entry")
        .stop_requested = true;

    let claim = claim_revoked_trust(&mut state, Path::new(TRUST_ROOT));

    assert_eq!(
        turn(&state).outcome_authority,
        AgentTaskOutcomeAuthority::Undecided
    );
    assert_eq!(claim.revoked.into_groups().len(), 1);
}

#[test]
fn a_foreign_trust_root_and_a_reaped_group_are_left_alone() {
    let signals = Arc::new(RecordingSignals::default());
    let mut state = running_turn(&signals);

    for foreign_root in [NESTED_REPOSITORY, "/", "/other", "/project/.", "/project/"] {
        let foreign = claim_revoked_trust(&mut state, Path::new(foreign_root));
        assert!(foreign.settling.is_empty());
        assert!(foreign.revoked.into_groups().is_empty());
        assert_eq!(
            turn(&state).outcome_authority,
            AgentTaskOutcomeAuthority::Undecided
        );
        assert!(!turn(&state).stop_requested);
    }

    note_own_outcome_in(&mut state, TASK);
    let claim = claim_revoked_trust(&mut state, Path::new(TRUST_ROOT));
    *claim.settling[0].state() = AgentProcessGroupState::Released;
    claim.settling[0].kill_unreaped();
    assert!(signals.sent().is_empty());
}

#[test]
fn only_a_turn_attributed_to_the_revocation_reports_revoked_trust() {
    let failure = AgentTaskStatusPayload::Failed {
        message:
            "Agent task wait failed: Claude exited before completing an accepted follow-up message."
                .to_string(),
    };
    let exited = AgentTaskStatusPayload::Exited { exit_code: 143 };

    assert!(explains_revoked_trust(revoked_trust_payload(
        AgentTaskOutcomeAuthority::RevokedTrust,
        failure.clone()
    )));
    assert!(explains_revoked_trust(revoked_trust_payload(
        AgentTaskOutcomeAuthority::RevokedTrust,
        exited
    )));
    for authority in [
        AgentTaskOutcomeAuthority::Own,
        AgentTaskOutcomeAuthority::Undecided,
    ] {
        assert!(!explains_revoked_trust(revoked_trust_payload(
            authority,
            failure.clone()
        )));
    }
}
