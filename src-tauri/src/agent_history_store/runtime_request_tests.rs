use super::*;
use crate::agent_questions::approvals::{AgentApprovalDecision, AgentApprovalKind};
use crate::agent_questions::{AgentQuestion, AgentQuestionAnswerItem};
use crate::agent_runtime_requests::model::{
    CloseReason, RequestBody, RequestProvider, RequestResolution,
};
use crate::agent_runtime_requests::observed::{
    ClosedStatus, ObservedRequest, ObservedState, ObservedTurn,
};
use crate::agent_runtime_requests::scopes::HistoryScope;
use crate::agent_runtime_requests::store::{
    AnswerIntent, ApplyReport, IntentReceipt, IntentSettle, IntentSettlement, RecoveryReport,
    RootClaim, RuntimeRequestStore, StoreErrorKind, StoredRequests, TurnKey, TurnObservation,
    MAX_REQUESTS_PER_THREAD, MAX_REQUESTS_PER_TURN, MAX_REQUEST_BODY_BYTES,
    ORPHAN_REQUEST_RETENTION_MS,
};
use runtime_requests::HistoryRuntimeRequestStore;
use serde_json::Value;
use std::time::{Duration, Instant};

const THREAD: &str = "agt-thread-0001";
const TURN: &str = "agt-turn-0001";
const RUN: &str = "boot-0001";
const INCARNATION: u64 = 1;
const NEXT_RUN: &str = "boot-0002";
const BUDGET: Duration = Duration::from_millis(250);
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

struct Journaled {
    fixture: Fixture,
    store: HistoryRuntimeRequestStore,
    scope: HistoryScope,
}

fn before_deadline() -> Instant {
    Instant::now() + BUDGET
}

impl Journaled {
    fn new() -> Self {
        Self::over(Fixture::new())
    }

    fn over(fixture: Fixture) -> Self {
        let journaled = Self {
            store: HistoryRuntimeRequestStore::new(fixture.base.clone()),
            scope: HistoryScope {
                root_key: ROOT.to_string(),
                owner_id: owner(),
            },
            fixture,
        };
        assert_eq!(
            journaled.store.claim_root(&journaled.scope, RUN, 0),
            Ok(RootClaim::Acquired(RecoveryReport::default()))
        );
        journaled
    }

    fn recover_as(&self, run_id: &str, now_epoch_ms: u64) -> RecoveryReport {
        runtime_requests::recover(&mut self.raw(), run_id, now_epoch_ms).expect("recover")
    }

    fn apply(&self, run_id: &str, observation: &TurnObservation) -> ApplyReport {
        self.store
            .apply_snapshot(&self.scope, run_id, observation)
            .expect("apply snapshot")
    }

    fn intend(&self, run_id: &str, request_id: &str, version: u64) -> IntentReceipt {
        self.store
            .record_intent(
                &self.scope,
                run_id,
                &intent(request_id, resolution_for(request_id), version),
                before_deadline(),
            )
            .expect("record intent")
    }

    fn settle(
        &self,
        run_id: &str,
        request_id: &str,
        versions: (u64, u64),
        settlement: IntentSettlement,
    ) -> bool {
        self.store
            .settle_intent(
                &self.scope,
                run_id,
                &IntentSettle {
                    key: key(TURN),
                    incarnation: INCARNATION,
                    request_id: request_id.to_string(),
                    intent_version: versions.0,
                    settlement,
                    version: versions.1,
                    at_epoch_ms: 9_000,
                },
                before_deadline(),
            )
            .expect("settle intent")
    }

    fn read(&self) -> StoredRequests {
        self.store
            .read(&self.scope, THREAD, 256)
            .expect("read requests")
    }

    fn wire(&self) -> Vec<Value> {
        self.read()
            .requests
            .iter()
            .map(|request| serde_json::to_value(request).expect("encode request"))
            .collect()
    }

    fn only(&self) -> Value {
        let mut wire = self.wire();
        assert_eq!(wire.len(), 1, "{wire:?}");
        wire.remove(0)
    }

    fn raw(&self) -> rusqlite::Connection {
        raw_history(&self.fixture)
    }

    fn turn_state_count(&self) -> i64 {
        self.raw()
            .query_row("SELECT COUNT(*) FROM runtime_request_turns", [], |row| {
                row.get(0)
            })
            .expect("turn state count")
    }

    fn row_count(&self) -> i64 {
        self.raw()
            .query_row("SELECT COUNT(*) FROM runtime_requests", [], |row| {
                row.get(0)
            })
            .expect("row count")
    }

    fn dump(&self) -> Vec<String> {
        let connection = self.raw();
        let mut statement = connection
            .prepare(
                "SELECT turn_id||'/'||request_id||':'||
                    CASE typeof(status) WHEN 'blob' THEN 'blob' ELSE status END
                    ||':'||IFNULL(reason,'-')||':'||
                    version||':'||IFNULL(outcome,'-')||':'||IFNULL(resolved_at,'-')||':'||run_id
                 FROM runtime_requests ORDER BY turn_id,reg_index",
            )
            .expect("dump statement");
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("dump rows");
        rows.map(|row| row.expect("dump row")).collect()
    }
}

fn key(turn_id: &str) -> TurnKey {
    TurnKey {
        thread_id: THREAD.to_string(),
        turn_id: turn_id.to_string(),
    }
}

fn question_body(prompt: &str) -> RequestBody {
    RequestBody::Question {
        questions: vec![AgentQuestion {
            id: "notes".into(),
            header: String::new(),
            prompt: prompt.into(),
            options: Vec::new(),
            multiple: false,
            allow_custom: true,
        }],
    }
}

fn question(id: &str, state: ObservedState) -> ObservedRequest {
    ObservedRequest {
        id: id.to_string(),
        provider: RequestProvider::Codex,
        body: question_body("Anything else to consider?"),
        state,
    }
}

fn approval(id: &str, state: ObservedState) -> ObservedRequest {
    ObservedRequest {
        id: id.to_string(),
        provider: RequestProvider::ClaudeCode,
        body: RequestBody::Approval {
            approval_kind: AgentApprovalKind::Command,
            title: "Run the test suite".into(),
            detail: "npm test -- --run".into(),
            detail_truncated: false,
            facts: Vec::new(),
            decisions: vec![
                AgentApprovalDecision::AllowOnce,
                AgentApprovalDecision::Deny,
            ],
        },
        state,
    }
}

fn answers(text: &str) -> RequestResolution {
    RequestResolution::Answers {
        answers: vec![AgentQuestionAnswerItem {
            question_id: "notes".into(),
            option_ids: Vec::new(),
            text: text.into(),
        }],
    }
}

fn decision() -> RequestResolution {
    RequestResolution::Decision {
        decision: AgentApprovalDecision::Deny,
    }
}

fn resolution_for(request_id: &str) -> RequestResolution {
    if request_id.starts_with("approval") {
        return decision();
    }
    answers("Nothing else.")
}

fn closed(status: ClosedStatus, reason: CloseReason) -> ObservedState {
    ObservedState::Closed { status, reason }
}

fn expired() -> ObservedState {
    closed(ClosedStatus::Expired, CloseReason::TurnEnded)
}

fn snapshot_of(
    turn_id: &str,
    sequence: u64,
    at: u64,
    requests: Vec<ObservedRequest>,
) -> TurnObservation {
    TurnObservation {
        key: key(turn_id),
        incarnation: INCARNATION,
        first_observed_at_epoch_ms: at,
        observed_at_epoch_ms: at,
        turn: ObservedTurn {
            sequence,
            requests,
            digested: Vec::new(),
            rejected: Vec::new(),
        },
    }
}

fn snapshot(sequence: u64, requests: Vec<ObservedRequest>) -> TurnObservation {
    snapshot_of(TURN, sequence, 1_000 + sequence, requests)
}

fn intent(request_id: &str, resolution: RequestResolution, version: u64) -> AnswerIntent {
    AnswerIntent {
        key: key(TURN),
        incarnation: INCARNATION,
        request_id: request_id.to_string(),
        resolution,
        version,
        at_epoch_ms: 5_000,
    }
}

#[test]
fn registration_is_one_durable_pending_request_in_the_frozen_wire_shape() {
    let journaled = Journaled::new();
    let registered = snapshot(
        3,
        vec![
            question("question-1", ObservedState::Pending),
            approval("approval-1", ObservedState::Pending),
        ],
    );

    assert_eq!(journaled.apply(RUN, &registered).transitions, 2);
    assert_eq!(
        journaled.apply(RUN, &registered),
        ApplyReport {
            stale: true,
            ..ApplyReport::default()
        }
    );

    let read = journaled.read();
    assert!(!read.truncated);
    assert_eq!(read.unreadable, 0);
    let wire = journaled.wire();
    assert_eq!(
        wire[0],
        json!({
            "id": "question-1",
            "turnId": TURN,
            "provider": "codex",
            "createdAtEpochMs": 1_003,
            "resolvedAtEpochMs": null,
            "order": 0,
            "version": 3,
            "anchorToolId": null,
            "body": {"kind": "question", "questions": [{
                "id": "notes", "header": "", "prompt": "Anything else to consider?",
                "options": [], "multiple": false, "allowCustom": true,
            }]},
            "status": "pending",
            "responseCapability": {"kind": "live"},
            "resolution": null,
        })
    );
    assert_eq!(wire[1]["id"], json!("approval-1"));
    assert_eq!(wire[1]["order"], json!(1));
    assert_eq!(wire[1]["provider"], json!("claudeCode"));
    assert_eq!(wire[1]["body"]["approvalKind"], json!("command"));
}

#[test]
fn answer_is_recorded_before_delivery_and_resolved_once() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );

    assert_eq!(
        journaled.intend(RUN, "question-1", 2),
        IntentReceipt::Recorded
    );
    assert_eq!(
        journaled.intend(RUN, "question-1", 3),
        IntentReceipt::NotJournaled
    );
    let submitting = journaled.only();
    assert_eq!(submitting["status"], json!("submitting"));
    assert_eq!(submitting["version"], json!(2));
    assert_eq!(submitting["resolvedAtEpochMs"], Value::Null);
    assert_eq!(
        submitting["responseCapability"],
        json!({"kind": "notResumable", "reason": "unknown"})
    );
    assert_eq!(
        submitting["resolution"]["answers"][0]["text"],
        json!("Nothing else.")
    );

    let in_flight = snapshot(4, vec![question("question-1", ObservedState::Pending)]);
    assert_eq!(journaled.apply(RUN, &in_flight).transitions, 0);
    let answered = snapshot(
        5,
        vec![question(
            "question-1",
            ObservedState::Resolved(answers("Nothing else.")),
        )],
    );
    assert_eq!(journaled.apply(RUN, &answered).transitions, 1);
    assert_eq!(journaled.apply(RUN, &answered).transitions, 0);

    let resolved = journaled.only();
    assert_eq!(resolved["status"], json!("resolved"));
    assert_eq!(resolved["version"], json!(5));
    assert_eq!(resolved["resolvedAtEpochMs"], json!(1_005));
    assert_eq!(
        resolved["resolution"],
        json!({"kind": "answers", "answers": [
            {"questionId": "notes", "optionIds": [], "text": "Nothing else."}
        ]})
    );

    let settled = journaled.dump();
    assert_eq!(
        journaled.intend(RUN, "question-1", 6),
        IntentReceipt::AlreadyAnswered
    );
    let another_answer = journaled.store.record_intent(
        &journaled.scope,
        RUN,
        &intent("question-1", answers("Something else."), 7),
        before_deadline(),
    );
    assert_eq!(another_answer, Ok(IntentReceipt::NotJournaled));
    assert_eq!(
        journaled.intend(NEXT_RUN, "question-1", 8),
        IntentReceipt::NotJournaled
    );
    assert_eq!(journaled.dump(), settled);
}

#[test]
fn answer_without_a_saved_intent_still_resolves_in_one_transition() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![approval("approval-1", ObservedState::Pending)]),
    );
    let decided = snapshot(
        2,
        vec![approval("approval-1", ObservedState::Resolved(decision()))],
    );

    assert_eq!(journaled.apply(RUN, &decided).transitions, 1);

    let resolved = journaled.only();
    assert_eq!(resolved["status"], json!("resolved"));
    assert_eq!(
        resolved["resolution"],
        json!({"kind": "decision", "decision": "deny"})
    );
}

#[test]
fn request_first_seen_closed_is_recorded_once_as_closed() {
    let journaled = Journaled::new();
    let coalesced = snapshot(
        9,
        vec![
            question(
                "question-1",
                ObservedState::Resolved(answers("Nothing else.")),
            ),
            approval(
                "approval-1",
                closed(ClosedStatus::TimedOut, CloseReason::TimedOut),
            ),
        ],
    );

    assert_eq!(journaled.apply(RUN, &coalesced).transitions, 2);
    assert_eq!(journaled.apply(RUN, &coalesced).transitions, 0);

    let wire = journaled.wire();
    assert_eq!(wire[0]["status"], json!("resolved"));
    assert_eq!(wire[0]["createdAtEpochMs"], wire[0]["resolvedAtEpochMs"]);
    assert_eq!(wire[1]["status"], json!("timedOut"));
    assert_eq!(wire[1]["responseCapability"]["reason"], json!("timedOut"));
}

#[test]
fn cancel_timeout_finish_and_close_each_produce_exactly_one_transition() {
    let cases = [
        (
            closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled),
            "cancelled",
            "providerCancelled",
        ),
        (
            closed(ClosedStatus::TimedOut, CloseReason::TimedOut),
            "timedOut",
            "timedOut",
        ),
        (expired(), "expired", "turnEnded"),
    ];
    for (state, status, reason) in cases {
        let journaled = Journaled::new();
        journaled.apply(
            RUN,
            &snapshot(1, vec![approval("approval-1", ObservedState::Pending)]),
        );
        let closing = snapshot(2, vec![approval("approval-1", state.clone())]);

        assert_eq!(journaled.apply(RUN, &closing).transitions, 1, "{status}");
        let before = journaled.dump();
        assert_eq!(journaled.apply(RUN, &closing).transitions, 0, "{status}");
        let later = snapshot(3, vec![approval("approval-1", state)]);
        assert_eq!(journaled.apply(RUN, &later).transitions, 0, "{status}");
        assert_eq!(journaled.dump(), before, "{status}");

        let closed = journaled.only();
        assert_eq!(closed["status"], json!(status));
        assert_eq!(closed["responseCapability"]["reason"], json!(reason));
        assert_eq!(closed["resolvedAtEpochMs"], json!(1_002));
        assert_eq!(closed["resolution"], Value::Null);
        assert_eq!(closed["version"], json!(2));
    }
}

#[test]
fn duplicate_and_reordered_snapshots_are_no_ops() {
    let journaled = Journaled::new();
    let first = snapshot(4, vec![question("question-1", ObservedState::Pending)]);
    let second = snapshot(
        6,
        vec![
            question("question-1", ObservedState::Pending),
            question("question-2", ObservedState::Pending),
        ],
    );
    let third = snapshot(
        8,
        vec![
            question("question-1", expired()),
            question("question-2", ObservedState::Pending),
        ],
    );
    journaled.apply(RUN, &first);
    journaled.apply(RUN, &second);
    journaled.apply(RUN, &third);
    let settled = journaled.dump();

    for stale in [&first, &second, &third, &first] {
        assert_eq!(journaled.apply(RUN, stale).transitions, 0);
        assert_eq!(journaled.dump(), settled);
    }
    let stale_close = snapshot(5, vec![question("question-2", expired())]);
    assert_eq!(journaled.apply(RUN, &stale_close).transitions, 0);
    assert_eq!(journaled.dump(), settled);
}

#[test]
fn pending_request_missing_from_a_newer_snapshot_expires_as_turn_ended() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            2,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    journaled.intend(RUN, "question-2", 3);

    let stale = snapshot(1, Vec::new());
    assert_eq!(journaled.apply(RUN, &stale).transitions, 0);
    let foreign = snapshot(9, Vec::new());
    assert_eq!(journaled.apply(NEXT_RUN, &foreign).transitions, 0);

    let evicted = snapshot(4, Vec::new());
    assert_eq!(journaled.apply(RUN, &evicted).transitions, 2);
    assert_eq!(journaled.apply(RUN, &evicted).transitions, 0);
    let wire = journaled.wire();
    assert_eq!(wire[0]["status"], json!("expired"));
    assert_eq!(wire[0]["responseCapability"]["reason"], json!("turnEnded"));
    assert_eq!(wire[0]["resolution"], Value::Null);
    assert_eq!(wire[1]["status"], json!("expired"));
    assert_eq!(
        wire[1]["responseCapability"]["reason"],
        json!("answerUnconfirmed")
    );
    assert_eq!(
        wire[1]["resolution"]["answers"][0]["text"],
        json!("Nothing else.")
    );
}

#[test]
fn request_listed_but_rejected_is_not_treated_as_missing() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    let mut rejected = snapshot(2, Vec::new());
    rejected.turn.rejected.push("question-1".to_string());

    assert_eq!(journaled.apply(RUN, &rejected).transitions, 0);

    assert_eq!(journaled.only()["status"], json!("pending"));
}

#[test]
fn submitting_request_closed_by_the_session_keeps_the_unconfirmed_answer() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    journaled.intend(RUN, "question-1", 2);

    let cancelled = closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled);
    let closing = snapshot(3, vec![question("question-1", cancelled)]);
    assert_eq!(journaled.apply(RUN, &closing).transitions, 1);

    let unconfirmed = journaled.only();
    assert_eq!(unconfirmed["status"], json!("expired"));
    assert_eq!(
        unconfirmed["responseCapability"]["reason"],
        json!("answerUnconfirmed")
    );
    assert_eq!(
        unconfirmed["resolution"]["answers"][0]["text"],
        json!("Nothing else.")
    );
}

#[test]
fn failed_delivery_and_refused_answer_settle_only_their_own_intent() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                question("question-3", ObservedState::Pending),
            ],
        ),
    );
    for request_id in ["question-1", "question-2", "question-3"] {
        assert_eq!(
            journaled.intend(RUN, request_id, 2),
            IntentReceipt::Recorded
        );
    }
    let before = journaled.dump();

    let stale_owner = journaled.settle(RUN, "question-1", (7, 8), IntentSettlement::Reverted);
    let foreign_run = journaled.settle(NEXT_RUN, "question-1", (2, 3), IntentSettlement::Reverted);
    let backwards = journaled.settle(RUN, "question-1", (2, 2), IntentSettlement::Reverted);
    assert_eq!((stale_owner, foreign_run, backwards), (false, false, false));
    assert_eq!(journaled.dump(), before);

    assert!(journaled.settle(RUN, "question-1", (2, 3), IntentSettlement::Reverted));
    assert!(journaled.settle(RUN, "question-2", (2, 4), IntentSettlement::DeliveryFailed));
    assert!(journaled.settle(RUN, "question-3", (2, 5), IntentSettlement::Unconfirmed));
    assert!(!journaled.settle(RUN, "question-2", (2, 6), IntentSettlement::Reverted));

    let wire = journaled.wire();
    assert_eq!(wire[0]["status"], json!("pending"));
    assert_eq!(wire[0]["version"], json!(3));
    assert_eq!(wire[0]["resolution"], Value::Null);
    assert_eq!(wire[0]["responseCapability"], json!({"kind": "live"}));
    assert_eq!(wire[1]["status"], json!("expired"));
    assert_eq!(
        wire[1]["responseCapability"]["reason"],
        json!("deliveryFailed")
    );
    assert_eq!(wire[1]["resolution"], Value::Null);
    assert_eq!(wire[1]["resolvedAtEpochMs"], json!(9_000));
    assert_eq!(wire[2]["status"], json!("expired"));
    assert_eq!(
        wire[2]["responseCapability"]["reason"],
        json!("answerUnconfirmed")
    );
    assert_eq!(
        wire[2]["resolution"]["answers"][0]["text"],
        json!("Nothing else.")
    );

    assert_eq!(
        journaled.intend(RUN, "question-1", 9),
        IntentReceipt::Recorded
    );
}

#[test]
fn intent_is_refused_for_an_answer_the_request_cannot_take() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                approval("approval-1", ObservedState::Pending),
            ],
        ),
    );
    let record = |request_id: &str, resolution: RequestResolution, run_id: &str, version: u64| {
        journaled
            .store
            .record_intent(
                &journaled.scope,
                run_id,
                &intent(request_id, resolution, version),
                before_deadline(),
            )
            .expect("record intent")
    };
    let not_offered = RequestResolution::Decision {
        decision: AgentApprovalDecision::AllowForSession,
    };
    let unknown_question = RequestResolution::Answers {
        answers: vec![AgentQuestionAnswerItem {
            question_id: "other".into(),
            option_ids: Vec::new(),
            text: "x".into(),
        }],
    };

    for receipt in [
        record("question-1", decision(), RUN, 2),
        record("approval-1", answers("x"), RUN, 2),
        record("approval-1", not_offered, RUN, 2),
        record("question-1", unknown_question, RUN, 2),
    ] {
        assert_eq!(receipt, IntentReceipt::Refused);
    }
    for receipt in [
        record("question-9", answers("x"), RUN, 2),
        record("question-1", answers("x"), NEXT_RUN, 2),
        record("question-1", answers("x"), RUN, 1),
    ] {
        assert_eq!(receipt, IntentReceipt::NotJournaled);
    }
    assert!(journaled
        .wire()
        .iter()
        .all(|request| request["status"] == json!("pending")));
}

#[test]
fn recovery_under_a_new_run_id_expires_pending_requests_and_keeps_unconfirmed_answers() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                approval("approval-1", ObservedState::Pending),
                question("question-2", expired()),
            ],
        ),
    );
    assert_eq!(
        journaled.intend(RUN, "approval-1", 2),
        IntentReceipt::Recorded
    );
    let live = journaled.recover_as(RUN, 50_000);
    assert_eq!((live.expired, live.unconfirmed), (0, 0));

    let recovered = journaled.recover_as(NEXT_RUN, 60_000);
    assert_eq!((recovered.expired, recovered.unconfirmed), (1, 1));
    let again = journaled.recover_as(NEXT_RUN, 70_000);
    assert_eq!((again.expired, again.unconfirmed), (0, 0));

    let wire = journaled.wire();
    assert_eq!(wire[0]["status"], json!("expired"));
    assert_eq!(
        wire[0]["responseCapability"],
        json!({"kind": "notResumable", "reason": "appRestarted"})
    );
    assert_eq!(wire[0]["resolvedAtEpochMs"], json!(60_000));
    assert_eq!(wire[0]["version"], json!(2));
    assert_eq!(wire[1]["status"], json!("expired"));
    assert_eq!(
        wire[1]["responseCapability"]["reason"],
        json!("answerUnconfirmed")
    );
    assert_eq!(
        wire[1]["resolution"],
        json!({"kind": "decision", "decision": "deny"})
    );
    assert_eq!(wire[1]["version"], json!(3));
    assert_eq!(wire[2]["responseCapability"]["reason"], json!("turnEnded"));
    assert_eq!(wire[2]["version"], json!(1));

    let late = snapshot(
        9,
        vec![question(
            "question-1",
            ObservedState::Resolved(answers("late")),
        )],
    );
    assert_eq!(journaled.apply(RUN, &late).transitions, 0);
    assert_eq!(journaled.apply(NEXT_RUN, &late).transitions, 0);
    assert_eq!(journaled.wire()[0]["status"], json!("expired"));
}

#[test]
fn no_sequence_of_writes_ever_changes_a_closed_request() {
    let states = [
        ObservedState::Pending,
        ObservedState::Resolved(answers("Nothing else.")),
        expired(),
        closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled),
    ];
    let settlements = [
        IntentSettlement::Reverted,
        IntentSettlement::DeliveryFailed,
        IntentSettlement::Unconfirmed,
    ];
    let mut seed = 0x2545_f491_4f6c_dd1d_u64;
    let mut next = |bound: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % bound
    };
    for _ in 0..12 {
        let journaled = Journaled::new();
        let mut closed_rows: std::collections::BTreeMap<String, String> = Default::default();
        let mut last_intent = [0u64; 3];
        for version in 1..40u64 {
            let request = next(3) as usize;
            let request_id = format!("question-{request}");
            match next(4) {
                0 => {
                    let mut listed = Vec::new();
                    for index in 0..3 {
                        if next(4) == 0 {
                            continue;
                        }
                        let state = states[next(4) as usize].clone();
                        listed.push(question(&format!("question-{index}"), state));
                    }
                    journaled.apply(RUN, &snapshot(1 + next(version + 1), listed));
                }
                1 => {
                    if journaled.intend(RUN, &request_id, version) == IntentReceipt::Recorded {
                        last_intent[request] = version;
                    }
                }
                2 => {
                    journaled.settle(
                        RUN,
                        &request_id,
                        (last_intent[request], version),
                        settlements[next(3) as usize],
                    );
                }
                _ => {
                    let run_id = [RUN, RUN, RUN, RUN, NEXT_RUN][next(5) as usize];
                    journaled.apply(run_id, &snapshot(version, Vec::new()));
                }
            }
            for row in journaled.dump() {
                let (id, rest) = row.split_once(':').expect("dumped row");
                let status = rest.split(':').next().expect("dumped status");
                let open = ["pending", "submitting"].contains(&status);
                match closed_rows.get(id) {
                    Some(closed) => assert_eq!(closed, &row, "closed request changed"),
                    None if open => {}
                    None => {
                        closed_rows.insert(id.to_string(), row.clone());
                    }
                }
            }
            assert_eq!(journaled.read().unreadable, 0);
        }
    }
}

#[test]
fn deleted_thread_loses_its_requests_and_refuses_later_writes() {
    let journaled = Journaled::new();
    journaled
        .fixture
        .store
        .save(ROOT, &owner(), &thread(), 0)
        .unwrap();
    let pending = snapshot(1, vec![question("question-1", ObservedState::Pending)]);
    journaled.apply(RUN, &pending);
    journaled
        .raw()
        .execute(
            "INSERT INTO runtime_request_marks(thread_id,pruned,skipped) VALUES(?1,3,0)",
            [THREAD],
        )
        .unwrap();
    assert_eq!(journaled.row_count(), 1);

    journaled
        .fixture
        .store
        .delete(ROOT, &owner(), THREAD)
        .unwrap();

    assert_eq!(journaled.row_count(), 0);
    let marks: i64 = journaled
        .raw()
        .query_row("SELECT COUNT(*) FROM runtime_request_marks", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(marks, 0);
    assert_eq!(journaled.turn_state_count(), 0);
    let live = snapshot(
        2,
        vec![
            question("question-1", ObservedState::Pending),
            question("question-2", ObservedState::Pending),
        ],
    );
    let refused = journaled.apply(RUN, &live);
    assert!(refused.tombstoned);
    assert_eq!(refused.transitions, 0);
    assert_eq!(
        journaled.intend(RUN, "question-1", 3),
        IntentReceipt::ThreadDeleted
    );
    assert_eq!(journaled.row_count(), 0);
    let read = journaled.read();
    assert!(read.requests.is_empty());
    assert!(!read.truncated);
}

#[test]
fn recovery_purges_tombstoned_threads_and_sweeps_old_orphans_only() {
    let journaled = Journaled::new();
    journaled
        .fixture
        .store
        .save(ROOT, &owner(), &thread(), 0)
        .unwrap();
    let now = 100 * DAY_MS;
    let old = now - ORPHAN_REQUEST_RETENTION_MS - 1;
    let recent = now - ORPHAN_REQUEST_RETENTION_MS;
    let closed_at = |turn_id: &str, at: u64| {
        snapshot_of(turn_id, 1, at, vec![question("question-1", expired())])
    };
    journaled.apply(RUN, &closed_at("agt-turn-saved", old));
    for (thread_id, at, run_id) in [
        ("agt-thread-old-orphan", old, RUN),
        ("agt-thread-recent-orphan", recent, RUN),
        ("agt-thread-tombstoned", recent, RUN),
        ("agt-thread-live-orphan", old, NEXT_RUN),
    ] {
        let mut observation = closed_at(TURN, at);
        observation.key.thread_id = thread_id.to_string();
        journaled.apply(run_id, &observation);
    }
    journaled
        .raw()
        .execute_batch(
            "INSERT INTO tombstones(thread_id) VALUES('agt-thread-tombstoned');
             INSERT INTO runtime_request_marks(thread_id,pruned,skipped)
                VALUES('agt-thread-tombstoned',1,0),('agt-thread-old-orphan',1,0);",
        )
        .unwrap();

    let report = journaled.recover_as(NEXT_RUN, now);

    assert_eq!((report.purged, report.swept), (1, 1));
    let mut remaining: Vec<String> = journaled
        .raw()
        .prepare("SELECT thread_id FROM runtime_requests ORDER BY thread_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();
    remaining.dedup();
    assert_eq!(
        remaining,
        [
            "agt-thread-0001",
            "agt-thread-live-orphan",
            "agt-thread-recent-orphan"
        ]
    );
    let marks: i64 = journaled
        .raw()
        .query_row("SELECT COUNT(*) FROM runtime_request_marks", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(marks, 0);
}

#[cfg(unix)]
#[path = "runtime_request_lease_tests.rs"]
mod lease_identity;
#[path = "runtime_request_retention_tests.rs"]
mod retention_and_ownership;
#[cfg(unix)]
#[path = "runtime_request_reuse_tests.rs"]
mod reuse_and_leases;
#[path = "runtime_request_size_tests.rs"]
mod sizes;
