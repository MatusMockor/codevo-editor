use super::model::JournalState;
use super::observed::ObservedTurn;
use super::scopes::{HistoryScope, TurnAuthority};
use super::store::{ApplyReport, StoreError, StoreErrorKind};
use std::collections::HashMap;

pub const MAX_UNRESOLVED_TURNS: usize = 1024;
pub const MAX_REPORTED_TURN_FAILURES: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JournalFailure {
    WriteFailed(StoreErrorKind),
    HeldByAnotherInstance,
    NotScoped,
    TurnForgotten,
    TurnSuperseded,
    AnswerUnsaved,
    AnswerLost,
    RequestRejected,
    RequestNotPlaced,
    QueueFull,
    WriterStopped,
}

impl JournalFailure {
    fn of(error: &StoreError) -> Self {
        if error.kind == StoreErrorKind::HeldByAnotherInstance {
            return Self::HeldByAnotherInstance;
        }
        Self::WriteFailed(error.kind)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnFailure {
    pub turn_id: String,
    pub failure: JournalFailure,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JournalHealth {
    pub state: JournalState,
    pub unresolved_turns: usize,
    pub tracker_overflowed: bool,
    pub writer_available: bool,
    pub failed_writes: u64,
    pub retried_writes: u64,
    pub unscoped_snapshots: u64,
    pub late_snapshots: u64,
    pub dropped_snapshots: u64,
    pub rejected_requests: u64,
    pub skipped_requests: u64,
    pub pruned_requests: u64,
    pub unsaved_answers: u64,
    pub lost_answers: u64,
    pub last_failure: Option<JournalFailure>,
}

const NEVER_RECONCILED: u64 = u64::MAX;

fn state_of(degraded: bool) -> JournalState {
    if degraded {
        return JournalState::Degraded;
    }
    JournalState::Saved
}

#[derive(Clone, Copy)]
struct Unresolved {
    failure: JournalFailure,
    since_sequence: u64,
}

#[derive(Default)]
pub(super) struct JournalLedger {
    unresolved: HashMap<TurnAuthority, Unresolved>,
    overflowed: bool,
    writer_unavailable: bool,
    failed_writes: u64,
    retried_writes: u64,
    unscoped_snapshots: u64,
    late_snapshots: u64,
    dropped_snapshots: u64,
    rejected_requests: u64,
    skipped_requests: u64,
    pruned_requests: u64,
    unsaved_answers: u64,
    lost_answers: u64,
    last_failure: Option<JournalFailure>,
}

impl JournalLedger {
    fn fail(&mut self, key: &TurnAuthority, failure: JournalFailure, since_sequence: u64) {
        self.last_failure = Some(failure);
        if let Some(known) = self.unresolved.get_mut(key) {
            if known.failure == JournalFailure::AnswerLost {
                return;
            }
            let permanent = known.since_sequence == NEVER_RECONCILED;
            if permanent && since_sequence != NEVER_RECONCILED {
                return;
            }
            known.failure = failure;
            known.since_sequence = since_sequence.max(known.since_sequence);
            return;
        }
        if self.unresolved.len() >= MAX_UNRESOLVED_TURNS {
            self.overflowed = true;
            return;
        }
        self.unresolved.insert(
            key.clone(),
            Unresolved {
                failure,
                since_sequence,
            },
        );
    }

    pub(super) fn writer_unavailable(&mut self) {
        self.writer_unavailable = true;
        self.last_failure = Some(JournalFailure::WriterStopped);
    }

    pub(super) fn writer_panicked(&mut self, key: &TurnAuthority, sequence: u64) {
        self.failed_writes += 1;
        self.fail(key, JournalFailure::WriterStopped, sequence);
    }

    pub(super) fn write_failed(&mut self, key: &TurnAuthority, error: &StoreError, sequence: u64) {
        self.failed_writes += 1;
        self.fail(key, JournalFailure::of(error), sequence);
    }

    pub(super) fn write_retried(&mut self) {
        self.retried_writes += 1;
    }

    pub(super) fn snapshot_unscoped(&mut self, key: &TurnAuthority, sequence: u64) {
        self.unscoped_snapshots += 1;
        self.fail(key, JournalFailure::NotScoped, sequence);
    }

    pub(super) fn snapshot_late(&mut self, key: &TurnAuthority) {
        self.late_snapshots += 1;
        self.fail(key, JournalFailure::TurnForgotten, NEVER_RECONCILED);
    }

    pub(super) fn snapshot_dropped(&mut self, key: &TurnAuthority, sequence: u64) {
        self.dropped_snapshots += 1;
        self.fail(key, JournalFailure::QueueFull, sequence);
    }

    pub(super) fn answer_unsaved(&mut self, key: &TurnAuthority, version: u64) {
        self.unsaved_answers += 1;
        self.fail(key, JournalFailure::AnswerUnsaved, version);
    }

    pub(super) fn snapshot_applied(
        &mut self,
        key: &TurnAuthority,
        report: &ApplyReport,
        turn: &ObservedTurn,
    ) {
        let rejected = u64::try_from(turn.rejected.len()).unwrap_or(u64::MAX);
        self.rejected_requests += rejected;
        self.skipped_requests += report.skipped;
        self.pruned_requests += report.pruned;
        self.lost_answers += report.lost_answers;
        if report.superseded {
            self.fail(key, JournalFailure::TurnSuperseded, NEVER_RECONCILED);
            return;
        }
        if report.stale {
            return;
        }
        if report.lost_answers > 0 {
            self.fail(key, JournalFailure::AnswerLost, NEVER_RECONCILED);
            return;
        }
        if rejected > 0 {
            self.fail(key, JournalFailure::RequestRejected, turn.sequence);
            return;
        }
        if report.skipped > 0 {
            self.fail(key, JournalFailure::RequestNotPlaced, turn.sequence);
            return;
        }
        let reconciled = self
            .unresolved
            .get(key)
            .is_some_and(|known| known.since_sequence <= turn.sequence);
        if reconciled {
            self.unresolved.remove(key);
        }
    }

    fn is_degraded_everywhere(&self) -> bool {
        self.writer_unavailable || self.overflowed
    }

    pub(super) fn thread_state(&self, thread_id: &str) -> JournalState {
        state_of(
            self.is_degraded_everywhere()
                || self
                    .unresolved
                    .keys()
                    .any(|turn| turn.key.thread_id == thread_id),
        )
    }

    pub(super) fn has_failure(&self, key: &TurnAuthority) -> bool {
        self.unresolved.contains_key(key)
    }

    pub(super) fn thread_state_in(&self, scope: &HistoryScope, thread_id: &str) -> JournalState {
        state_of(
            self.is_degraded_everywhere()
                || self.unresolved.keys().any(|turn| {
                    turn.key.thread_id == thread_id
                        && (&turn.scope == scope || turn.scope.root_key.is_empty())
                }),
        )
    }

    pub(super) fn thread_failures(&self, thread_id: &str) -> Vec<TurnFailure> {
        let mut failures: Vec<TurnFailure> = self
            .unresolved
            .iter()
            .filter(|(turn, _)| turn.key.thread_id == thread_id)
            .map(|(turn, known)| TurnFailure {
                turn_id: turn.key.turn_id.clone(),
                failure: known.failure,
            })
            .collect();
        failures.sort_by(|left, right| left.turn_id.cmp(&right.turn_id));
        failures.truncate(MAX_REPORTED_TURN_FAILURES);
        failures
    }

    pub(super) fn health(&self) -> JournalHealth {
        JournalHealth {
            state: state_of(self.is_degraded_everywhere() || !self.unresolved.is_empty()),
            unresolved_turns: self.unresolved.len(),
            tracker_overflowed: self.overflowed,
            writer_available: !self.writer_unavailable,
            failed_writes: self.failed_writes,
            retried_writes: self.retried_writes,
            unscoped_snapshots: self.unscoped_snapshots,
            late_snapshots: self.late_snapshots,
            dropped_snapshots: self.dropped_snapshots,
            rejected_requests: self.rejected_requests,
            skipped_requests: self.skipped_requests,
            pruned_requests: self.pruned_requests,
            unsaved_answers: self.unsaved_answers,
            lost_answers: self.lost_answers,
            last_failure: self.last_failure,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime_requests::scopes::HistoryScope;
    use crate::agent_runtime_requests::store::TurnKey;

    fn key(thread_id: &str, turn_id: &str) -> TurnAuthority {
        incarnation(thread_id, turn_id, 1)
    }

    fn incarnation(thread_id: &str, turn_id: &str, incarnation: u64) -> TurnAuthority {
        TurnAuthority {
            scope: HistoryScope {
                root_key: "/workspace".to_string(),
                owner_id: "agent-root:workspace".to_string(),
            },
            key: TurnKey {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
            },
            incarnation,
        }
    }

    #[test]
    fn another_incarnation_of_the_same_turn_ids_never_clears_a_failure() {
        let mut ledger = JournalLedger::default();
        let (report, turn) = clean(9);
        ledger.answer_unsaved(&incarnation("thread", "turn", 1), 3);

        ledger.snapshot_applied(&incarnation("thread", "turn", 2), &report, &turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
        let superseded = ApplyReport {
            superseded: true,
            ..report
        };
        ledger.snapshot_applied(&incarnation("thread", "turn", 1), &superseded, &turn);
        assert_eq!(
            ledger.thread_failures("thread"),
            [TurnFailure {
                turn_id: "turn".to_string(),
                failure: JournalFailure::TurnSuperseded,
            }]
        );
        ledger.snapshot_applied(&incarnation("thread", "turn", 1), &report, &turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
    }

    #[test]
    fn lost_answer_degrades_its_turn_for_the_rest_of_the_run() {
        let mut ledger = JournalLedger::default();
        let (report, turn) = clean(4);
        ledger.answer_unsaved(&key("thread", "turn"), 3);
        let lost = ApplyReport {
            lost_answers: 1,
            transitions: 1,
            ..report
        };

        ledger.snapshot_applied(&key("thread", "turn"), &lost, &turn);
        let (later_report, later_turn) = clean(9);
        ledger.snapshot_applied(&key("thread", "turn"), &later_report, &later_turn);
        ledger.write_failed(
            &key("thread", "turn"),
            &StoreError::new(StoreErrorKind::Busy, "locked"),
            10,
        );
        let (latest_report, latest_turn) = clean(11);
        ledger.snapshot_applied(&key("thread", "turn"), &latest_report, &latest_turn);
        ledger.snapshot_late(&key("thread", "turn"));
        let superseded = ApplyReport {
            superseded: true,
            ..latest_report
        };
        ledger.snapshot_applied(&key("thread", "turn"), &superseded, &latest_turn);
        ledger.answer_unsaved(&key("thread", "turn"), u64::MAX);

        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
        assert_eq!(
            ledger.thread_failures("thread"),
            [TurnFailure {
                turn_id: "turn".to_string(),
                failure: JournalFailure::AnswerLost,
            }]
        );
        let health = ledger.health();
        assert_eq!((health.lost_answers, health.unsaved_answers), (1, 2));
        assert_eq!(health.late_snapshots, 1);
        assert_eq!(health.state, JournalState::Degraded);
        assert_eq!(ledger.thread_state("other"), JournalState::Saved);
    }

    fn clean(sequence: u64) -> (ApplyReport, ObservedTurn) {
        (
            ApplyReport::default(),
            ObservedTurn {
                sequence,
                requests: Vec::new(),
                digested: Vec::new(),
                rejected: Vec::new(),
            },
        )
    }

    #[test]
    fn failure_of_one_turn_is_cleared_only_by_reconciling_that_turn() {
        let mut ledger = JournalLedger::default();
        let (report, turn) = clean(7);
        ledger.write_failed(
            &key("thread", "turn-a"),
            &StoreError::new(StoreErrorKind::Busy, "locked"),
            7,
        );

        ledger.snapshot_applied(&key("thread", "turn-b"), &report, &turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
        let stale = ApplyReport {
            stale: true,
            ..report
        };
        ledger.snapshot_applied(&key("thread", "turn-a"), &stale, &turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
        let (older_report, older_turn) = clean(6);
        ledger.snapshot_applied(&key("thread", "turn-a"), &older_report, &older_turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Degraded);
        assert_eq!(
            ledger.thread_failures("thread"),
            [TurnFailure {
                turn_id: "turn-a".to_string(),
                failure: JournalFailure::WriteFailed(StoreErrorKind::Busy),
            }]
        );
        assert_eq!(ledger.thread_state("other"), JournalState::Saved);

        ledger.snapshot_applied(&key("thread", "turn-a"), &report, &turn);
        assert_eq!(ledger.thread_state("thread"), JournalState::Saved);
        assert_eq!(ledger.health().state, JournalState::Saved);
        assert_eq!(ledger.health().failed_writes, 1);
    }

    #[test]
    fn tracker_overflow_stays_degraded_for_every_thread() {
        let mut ledger = JournalLedger::default();
        let (report, turn) = clean(1);
        for index in 0..=MAX_UNRESOLVED_TURNS {
            ledger.snapshot_unscoped(&key("thread", &format!("turn-{index}")), 1);
        }
        assert!(ledger.health().tracker_overflowed);
        assert_eq!(ledger.health().unresolved_turns, MAX_UNRESOLVED_TURNS);

        for index in 0..=MAX_UNRESOLVED_TURNS {
            ledger.snapshot_applied(&key("thread", &format!("turn-{index}")), &report, &turn);
        }

        assert_eq!(ledger.health().unresolved_turns, 0);
        assert_eq!(ledger.health().state, JournalState::Degraded);
        assert_eq!(ledger.thread_state("untouched"), JournalState::Degraded);
    }

    #[test]
    fn lease_conflict_is_reported_with_its_own_reason() {
        let mut ledger = JournalLedger::default();
        ledger.write_failed(
            &key("thread", "turn"),
            &StoreError::new(StoreErrorKind::HeldByAnotherInstance, "held"),
            1,
        );
        assert_eq!(
            ledger.health().last_failure,
            Some(JournalFailure::HeldByAnotherInstance)
        );
        assert_eq!(
            ledger.thread_failures("thread")[0].failure,
            JournalFailure::HeldByAnotherInstance
        );
    }
}
