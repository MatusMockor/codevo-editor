use super::*;
use crate::agent_questions::approvals::{
    AgentApprovalDecision, AgentApprovalKind, AgentApprovalRequest, AgentApprovalStatus,
};
use crate::agent_questions::{
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionRequest, AgentQuestionResponse,
    AgentQuestionSession, AgentQuestionStatus,
};
use crate::agent_runtime_requests::health::{JournalFailure, TurnFailure};
use crate::agent_runtime_requests::journal::TurnTracking;
use crate::agent_runtime_requests::journal::{
    new_run_id, AnswerAttempt, AnswerTarget, JournalClock, JournalLimits, RuntimeRequestJournal,
    ANSWER_INTENT_BUDGET, JOURNAL_SHUTDOWN_DEADLINE,
};
use crate::agent_runtime_requests::model::{is_identifier, JournalState, RequestResolution};
use crate::agent_runtime_requests::scopes::HistoryScope;
use crate::agent_runtime_requests::store::{IntentSettlement, StoreErrorKind, StoredRequests};
use crate::agent_task_admission::AgentTaskHistoryScope;
use runtime_requests::HistoryRuntimeRequestStore;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const THREAD: &str = "agt-thread-0001";
const TURN: &str = "agt-turn-0001";
const OTHER_ROOT: &str = "/workspace/other";
const FLUSH: Duration = Duration::from_secs(20);
const WRITABLE: u32 = 0o700;
const READ_ONLY: u32 = 0o500;

fn scope_of(root: &str) -> HistoryScope {
    HistoryScope {
        root_key: root.to_string(),
        owner_id: legacy::agent_root_owner_id(root),
    }
}

fn patient_answers() -> JournalLimits {
    JournalLimits {
        retry_backoff: Duration::from_millis(15),
        answer_budget: FLUSH,
        ..JournalLimits::default()
    }
}

fn released_answer_budget() -> JournalLimits {
    JournalLimits {
        retry_backoff: Duration::from_millis(15),
        ..JournalLimits::default()
    }
}

fn eventually(check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + FLUSH;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    check()
}

struct Boot {
    journal: Arc<RuntimeRequestJournal>,
    sequence: Arc<AtomicU64>,
}

impl Boot {
    fn start(fixture: &Fixture, run_id: &str) -> Self {
        Self::start_with(fixture, run_id, patient_answers())
    }

    fn start_with(fixture: &Fixture, run_id: &str, limits: JournalLimits) -> Self {
        let store = Arc::new(HistoryRuntimeRequestStore::new(fixture.base.clone()));
        Self::start_over(store, run_id, limits)
    }

    fn start_over(
        store: Arc<dyn crate::agent_runtime_requests::store::RuntimeRequestStore>,
        run_id: &str,
        limits: JournalLimits,
    ) -> Self {
        let ticks = AtomicU64::new(1_760_000_000_000);
        let clock: JournalClock = Arc::new(move || ticks.fetch_add(1, Ordering::SeqCst));
        let journal = Arc::new(RuntimeRequestJournal::start_with_limits(
            store,
            run_id.to_string(),
            clock,
            limits,
        ));
        let sequence = Arc::new(AtomicU64::new(0));
        assert!(journal.share_sequence(Arc::clone(&sequence)));
        Self { journal, sequence }
    }

    fn next_version(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn turn(&self, thread_id: &str, turn_id: &str, workspace_id: &str) -> LiveTurn {
        self.turn_in(ROOT, thread_id, turn_id, workspace_id)
    }

    fn turn_in(&self, root: &str, thread_id: &str, turn_id: &str, workspace_id: &str) -> LiveTurn {
        self.observed_turn(
            Some(scope_of(root)),
            (thread_id, turn_id, workspace_id),
            AgentQuestionSession::new(),
        )
    }

    fn unbound_turn(&self, thread_id: &str, turn_id: &str, workspace_id: &str) -> LiveTurn {
        self.observed_turn(
            None,
            (thread_id, turn_id, workspace_id),
            AgentQuestionSession::new(),
        )
    }

    fn observed_turn(
        &self,
        scope: Option<HistoryScope>,
        (thread_id, turn_id, workspace_id): (&str, &str, &str),
        session: AgentQuestionSession,
    ) -> LiveTurn {
        let tracking = scope.as_ref().map(|scope| {
            self.journal
                .track_turn(scope, thread_id, turn_id)
                .expect("track the turn")
        });
        let scope = tracking.as_ref().map(TurnTracking::task_scope);
        let session = Arc::new(session);
        session.share_sequence(Arc::clone(&self.sequence));
        let publisher = Arc::downgrade(&session);
        let journal = Arc::downgrade(&self.journal);
        let carried = scope.clone();
        let (thread, turn, workspace) = (
            thread_id.to_string(),
            turn_id.to_string(),
            workspace_id.to_string(),
        );
        session.observe(Arc::new(move || {
            let (Some(session), Some(journal)) = (publisher.upgrade(), journal.upgrade()) else {
                return;
            };
            journal.observe(
                carried.as_ref(),
                &thread,
                session.snapshot(&turn, &workspace),
            );
        }));
        LiveTurn {
            session,
            scope,
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
            delivered: Arc::new(AtomicUsize::new(0)),
            tracking,
        }
    }

    fn begin(&self, turn: &LiveTurn, request_id: &str) -> AnswerAttempt {
        self.journal
            .begin_answer(turn.target(request_id), || self.next_version())
    }

    fn settled(&self) -> Vec<Value> {
        assert!(self.journal.flush(FLUSH), "journal did not settle");
        wire(&self.read(ROOT, THREAD))
    }

    fn read(&self, root: &str, thread_id: &str) -> StoredRequests {
        self.journal
            .read(&scope_of(root), thread_id, 256)
            .expect("read journaled requests")
    }
}

fn resolution_for(request_id: &str) -> RequestResolution {
    if request_id.starts_with("approval") {
        return RequestResolution::Decision {
            decision: AgentApprovalDecision::AllowOnce,
        };
    }
    RequestResolution::Answers { answers: answers() }
}

fn wire(read: &StoredRequests) -> Vec<Value> {
    read.requests
        .iter()
        .map(|request| serde_json::to_value(request).expect("encode request"))
        .collect()
}

struct LiveTurn {
    session: Arc<AgentQuestionSession>,
    thread_id: String,
    turn_id: String,
    delivered: Arc<AtomicUsize>,
    scope: Option<AgentTaskHistoryScope>,
    tracking: Option<TurnTracking>,
}

impl LiveTurn {
    fn target(&self, request_id: &str) -> AnswerTarget {
        AnswerTarget {
            task_scope: self.scope.clone(),
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            request_id: request_id.to_string(),
            resolution: resolution_for(request_id),
        }
    }

    fn ask(&self, request_id: &str) {
        self.ask_with(request_id, "Anything else to consider?", Ok(()));
    }

    fn ask_with(&self, request_id: &str, prompt: &str, delivery: Result<(), String>) {
        let delivered = Arc::clone(&self.delivered);
        let registered = self.session.register(
            AgentQuestionRequest {
                id: request_id.to_string(),
                task_id: String::new(),
                provider: "codex".into(),
                questions: vec![AgentQuestion {
                    id: "notes".into(),
                    header: String::new(),
                    prompt: prompt.to_string(),
                    options: Vec::new(),
                    multiple: false,
                    allow_custom: true,
                }],
                status: AgentQuestionStatus::Pending,
                answers: None,
            },
            Arc::new(move |_| {
                delivered.fetch_add(1, Ordering::SeqCst);
                delivery.clone()
            }),
        );
        assert_eq!(registered, Ok(()));
    }

    fn ask_approval(&self, request_id: &str) {
        let delivered = Arc::clone(&self.delivered);
        let registered = self.session.approvals().register(
            AgentApprovalRequest {
                id: request_id.to_string(),
                task_id: String::new(),
                provider: "claudeCode".into(),
                kind: AgentApprovalKind::Command,
                title: "Run the test suite".into(),
                detail: "npm test -- --run".into(),
                detail_truncated: false,
                facts: Vec::new(),
                decisions: vec![
                    AgentApprovalDecision::AllowOnce,
                    AgentApprovalDecision::Deny,
                ],
                status: AgentApprovalStatus::Pending,
                decision: None,
            },
            Arc::new(move |_| {
                delivered.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
        );
        assert_eq!(registered, Ok(()));
    }

    fn answer(&self, request_id: &str) -> Result<AgentQuestionRequest, String> {
        self.session.answer(
            &self.turn_id,
            request_id,
            AgentQuestionResponse { answers: answers() },
        )
    }

    fn delivered(&self) -> usize {
        self.delivered.load(Ordering::SeqCst)
    }
}

fn answers() -> Vec<AgentQuestionAnswerItem> {
    vec![AgentQuestionAnswerItem {
        question_id: "notes".into(),
        option_ids: Vec::new(),
        text: "Nothing else.".into(),
    }]
}

fn dump_of(fixture: &Fixture, root: &str) -> Vec<String> {
    let connection = rusqlite::Connection::open(connection::database_path(&fixture.base, root))
        .expect("open the history database");
    connection
        .busy_timeout(Duration::from_secs(5))
        .expect("busy timeout");
    let mut statement = connection
        .prepare(
            "SELECT thread_id||'/'||turn_id||'/'||request_id||':'||status||':'||IFNULL(reason,'-')
                ||':'||version||':'||run_id
             FROM runtime_requests ORDER BY thread_id,turn_id,reg_index",
        )
        .expect("dump statement");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("dump rows");
    rows.map(|row| row.expect("dump row")).collect()
}

fn dump(fixture: &Fixture) -> Vec<String> {
    dump_of(fixture, ROOT)
}

fn summary(requests: &[Value]) -> Vec<String> {
    requests
        .iter()
        .map(|request| {
            format!(
                "{}:{}:{}",
                request["id"].as_str().unwrap_or("?"),
                request["status"].as_str().unwrap_or("?"),
                request["responseCapability"]["reason"]
                    .as_str()
                    .unwrap_or("-")
            )
        })
        .collect()
}

fn set_base_mode(fixture: &Fixture, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&fixture.base, fs::Permissions::from_mode(mode)).expect("set permissions");
}

fn failures(boot: &Boot, thread_id: &str) -> Vec<(String, JournalFailure)> {
    boot.journal
        .thread_failures(thread_id)
        .into_iter()
        .map(|TurnFailure { turn_id, failure }| (turn_id, failure))
        .collect()
}

#[test]
fn every_session_change_lands_as_exactly_one_durable_transition() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.observed_turn(
        Some(scope_of(ROOT)),
        (THREAD, TURN, "workspace-1"),
        AgentQuestionSession::with_approval_timeout(Duration::ZERO),
    );
    let mut history = Vec::new();
    let mut step = |label: &str| {
        let requests = boot.settled();
        let rows = dump(&fixture);
        assert!(boot.journal.flush(FLUSH));
        assert_eq!(dump(&fixture), rows, "{label}: settled rows changed");
        history.push(rows);
        summary(&requests)
    };

    turn.ask("question-answered");
    turn.ask("question-cancelled");
    assert_eq!(
        step("register"),
        [
            "question-answered:pending:-",
            "question-cancelled:pending:-"
        ]
    );

    let attempt = boot.begin(&turn, "question-answered");
    assert!(attempt.is_recorded());
    assert_eq!(turn.answer("question-answered").map(|_| ()), Ok(()));
    attempt.delivered();
    assert_eq!(
        step("answer"),
        [
            "question-answered:resolved:unknown",
            "question-cancelled:pending:-"
        ]
    );

    turn.session.cancel("question-cancelled");
    assert_eq!(
        step("cancel")[1],
        "question-cancelled:cancelled:providerCancelled"
    );

    turn.ask_approval("approval-timed-out");
    turn.session.expire_overdue();
    assert_eq!(step("timeout")[2], "approval-timed-out:timedOut:timedOut");

    turn.ask("question-finished");
    turn.session.finish();
    assert_eq!(step("finish")[3], "question-finished:expired:turnEnded");

    turn.session.close();
    let closed = step("close");
    assert_eq!(closed.len(), 4);
    assert_eq!(history[4], history[5], "close after finish changes nothing");

    let versions = |rows: &Vec<String>| -> Vec<String> {
        rows.iter()
            .map(|row| row.rsplit(':').nth(1).unwrap_or("?").to_string())
            .collect()
    };
    let last = versions(&history[5]);
    for earlier in &history {
        for (index, version) in versions(earlier).iter().enumerate() {
            let closed_earlier = !earlier[index].contains(":pending:");
            if closed_earlier {
                assert_eq!(version, &last[index], "closed request was rewritten");
            }
        }
    }
    assert_eq!(turn.delivered(), 2);
    assert_eq!(boot.journal.health().state, JournalState::Saved);
    assert_eq!(boot.journal.queued_turns(), 0);
}

#[test]
fn snapshots_queued_during_an_answer_coalesce_to_the_latest_one() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    assert_eq!(summary(&boot.settled()), ["question-1:pending:-"]);

    let attempt = boot.begin(&turn, "question-1");
    assert!(attempt.is_recorded());
    turn.ask("question-2");
    turn.ask("question-3");
    turn.session.cancel("question-2");
    assert!(!boot.journal.flush(Duration::from_millis(60)));
    assert_eq!(boot.journal.queued_turns(), 1);
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD))),
        ["question-1:submitting:unknown"]
    );
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();

    let coalesced = boot.settled();
    assert_eq!(
        summary(&coalesced),
        [
            "question-1:resolved:unknown",
            "question-2:cancelled:providerCancelled",
            "question-3:pending:-"
        ]
    );
    assert_eq!(boot.journal.queued_turns(), 0);
    assert!(
        coalesced[1]["createdAtEpochMs"].as_u64() < coalesced[1]["resolvedAtEpochMs"].as_u64(),
        "a coalesced request keeps the time it was first observed"
    );
    assert_eq!(
        coalesced[1]["createdAtEpochMs"],
        coalesced[2]["createdAtEpochMs"]
    );
}

#[test]
fn stale_snapshot_never_replaces_a_newer_queued_or_applied_one() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    boot.settled();
    let stale = turn.session.snapshot(TURN, "workspace-1");
    let attempt = boot.begin(&turn, "question-1");
    turn.ask("question-2");
    boot.journal
        .observe(turn.scope.as_ref(), THREAD, stale.clone());
    attempt.settle(IntentSettlement::Reverted, boot.next_version());

    assert_eq!(
        summary(&boot.settled()),
        ["question-1:pending:-", "question-2:pending:-"]
    );
    boot.journal.observe(turn.scope.as_ref(), THREAD, stale);
    assert_eq!(
        summary(&boot.settled()),
        ["question-1:pending:-", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn refused_and_failed_answers_settle_truthfully() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-refused");
    turn.ask_with(
        "question-undelivered",
        "Anything else to consider?",
        Err("pipe closed".to_string()),
    );
    boot.settled();

    let refused = boot.begin(&turn, "question-refused");
    assert!(refused.is_recorded());
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD)))[0],
        "question-refused:submitting:unknown"
    );
    refused.settle(IntentSettlement::Reverted, boot.next_version());
    assert_eq!(summary(&boot.settled())[0], "question-refused:pending:-");

    let undelivered = boot.begin(&turn, "question-undelivered");
    assert!(undelivered.is_recorded());
    assert_eq!(
        turn.answer("question-undelivered").map(|_| ()),
        Err("pipe closed".to_string())
    );
    undelivered.settle(IntentSettlement::DeliveryFailed, boot.next_version());
    let settled = boot.settled();
    assert_eq!(
        summary(&settled),
        [
            "question-refused:pending:-",
            "question-undelivered:expired:deliveryFailed"
        ]
    );
    assert_eq!(settled[1]["resolution"], Value::Null);
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn intent_version_is_allocated_only_after_the_turns_queued_snapshots_are_applied() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    let rows_at_allocation: Mutex<Vec<String>> = Mutex::default();
    turn.ask("question-1");
    turn.ask("question-2");

    let attempt = boot.journal.begin_answer(turn.target("question-1"), || {
        rows_at_allocation
            .lock()
            .expect("rows lock")
            .extend(dump(&fixture));
        boot.next_version()
    });

    let rows = rows_at_allocation.lock().expect("rows lock").clone();
    assert_eq!(rows.len(), 2, "{rows:?}");
    assert!(rows.iter().all(|row| row.contains(":pending:")), "{rows:?}");
    assert!(attempt.is_recorded());
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();
    assert_eq!(
        summary(&boot.settled()),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.health().unsaved_answers, 0);
}

#[test]
fn answer_delivered_without_a_recorded_intent_degrades_its_turn_until_it_is_reconciled() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    turn.ask("question-2");
    boot.settled();
    let blocker = boot.begin(&turn, "question-2");
    assert!(blocker.is_recorded());

    let outdated = boot.journal.begin_answer(turn.target("question-1"), || 0);
    assert!(!outdated.is_recorded());
    assert_eq!(boot.journal.health().unsaved_answers, 0);
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    outdated.delivered();

    assert_eq!(boot.journal.health().unsaved_answers, 1);
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Degraded);
    assert_eq!(
        failures(&boot, THREAD),
        [(TURN.to_string(), JournalFailure::AnswerUnsaved)]
    );
    blocker.settle(IntentSettlement::Reverted, boot.next_version());
    assert_eq!(
        summary(&boot.settled()),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn reopening_under_a_new_run_id_recovers_an_unsettled_intent_as_answer_unconfirmed() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-sent");
    turn.ask("question-waiting");
    turn.ask_approval("approval-sent");
    boot.settled();
    assert!(boot.begin(&turn, "question-sent").is_recorded());
    assert!(boot.begin(&turn, "approval-sent").is_recorded());
    assert!(boot.journal.flush(FLUSH));
    drop(boot);
    drop(turn);
    assert_eq!(
        dump(&fixture)
            .iter()
            .map(|row| row.split(':').nth(1).unwrap_or("?").to_string())
            .collect::<Vec<_>>(),
        ["submitting", "pending", "submitting"]
    );

    let reopened = Boot::start(&fixture, "boot-0002");
    let requests = reopened.settled();

    assert_eq!(
        summary(&requests),
        [
            "question-sent:expired:answerUnconfirmed",
            "question-waiting:expired:appRestarted",
            "approval-sent:expired:answerUnconfirmed"
        ]
    );
    assert_eq!(
        requests[0]["resolution"],
        json!({"kind": "answers", "answers": [
            {"questionId": "notes", "optionIds": [], "text": "Nothing else."}
        ]})
    );
    assert_eq!(requests[1]["resolution"], Value::Null);
    assert_eq!(
        requests[2]["resolution"],
        json!({"kind": "decision", "decision": "allowOnce"})
    );
    assert!(requests
        .iter()
        .all(|request| request["resolvedAtEpochMs"].is_u64()));
    let recovered = dump(&fixture);
    assert_eq!(summary(&reopened.settled()), summary(&requests));
    assert_eq!(dump(&fixture), recovered);
}

#[test]
fn second_running_instance_never_expires_the_first_instances_live_requests() {
    let fixture = Fixture::new();
    let first = Boot::start(&fixture, "boot-0001");
    let first_turn = first.turn(THREAD, TURN, "workspace-1");
    first_turn.ask("question-1");
    first_turn.ask("question-2");
    assert_eq!(first.settled().len(), 2);
    let live = dump(&fixture);

    let second = Boot::start(&fixture, "boot-0002");
    let second_turn = second.turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    second_turn.ask("question-1");
    assert!(second.journal.flush(FLUSH));
    let unsaved = second.begin(&second_turn, "question-1");
    assert!(!unsaved.is_recorded());
    let answered = second_turn.answer("question-1");
    unsaved.delivered();
    assert!(second.journal.flush(FLUSH));

    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(second_turn.delivered(), 1);
    assert_eq!(
        second
            .journal
            .read(&scope_of(ROOT), THREAD, 256)
            .map_err(|error| error.kind),
        Err(StoreErrorKind::HeldByAnotherInstance)
    );
    assert_eq!(
        second.journal.thread_state("agt-thread-0002"),
        JournalState::Degraded
    );
    assert_eq!(
        failures(&second, "agt-thread-0002"),
        [(
            "agt-turn-0002".to_string(),
            JournalFailure::HeldByAnotherInstance
        )]
    );
    assert_eq!(dump(&fixture), live);
    assert_eq!(first.journal.health().state, JournalState::Saved);

    let attempt = first.begin(&first_turn, "question-1");
    assert!(attempt.is_recorded());
    assert_eq!(first_turn.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();
    assert_eq!(
        summary(&first.settled()),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );

    drop(first);
    drop(first_turn);
    second_turn.ask("question-2");
    assert!(second.journal.flush(FLUSH));
    assert_eq!(
        summary(&wire(&second.read(ROOT, THREAD))),
        [
            "question-1:resolved:unknown",
            "question-2:expired:appRestarted"
        ]
    );
    assert_eq!(
        summary(&wire(&second.read(ROOT, "agt-thread-0002"))),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );
    assert_eq!(
        second.journal.thread_state("agt-thread-0002"),
        JournalState::Saved
    );
}

#[test]
fn unwritable_history_still_delivers_the_answer_and_degrades_health() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    set_base_mode(&fixture, READ_ONLY);
    let turn = boot.turn(THREAD, TURN, "workspace-1");

    turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let attempt = boot.begin(&turn, "question-1");
    let recorded = attempt.is_recorded();
    let answered = turn.answer("question-1");
    attempt.delivered();
    assert!(boot.journal.flush(FLUSH));
    let degraded = boot.journal.health();
    let thread_state = boot.journal.thread_state(THREAD);
    let unreadable = boot.journal.read(&scope_of(ROOT), THREAD, 256);
    set_base_mode(&fixture, WRITABLE);

    assert!(!recorded);
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(turn.delivered(), 1);
    assert_eq!(degraded.state, JournalState::Degraded);
    assert_eq!(thread_state, JournalState::Degraded);
    assert!(degraded.failed_writes >= 2, "{degraded:?}");
    assert_eq!(degraded.unsaved_answers, 1);
    assert_eq!(
        degraded.last_failure,
        Some(JournalFailure::WriteFailed(StoreErrorKind::Unavailable))
    );
    assert!(unreadable.is_err());
    assert_eq!(
        boot.journal.thread_state("agt-thread-untouched"),
        JournalState::Saved
    );

    turn.ask("question-2");
    assert_eq!(
        summary(&boot.settled()),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn transient_write_failure_is_retried_without_waiting_for_another_snapshot() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        retry_backoff: Duration::from_millis(400),
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    set_base_mode(&fixture, READ_ONLY);
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    let failed = eventually(|| boot.journal.health().failed_writes >= 2);
    let degraded = boot.journal.thread_state(THREAD);
    set_base_mode(&fixture, WRITABLE);

    assert!(failed);
    assert_eq!(degraded, JournalState::Degraded);
    assert_eq!(summary(&boot.settled()), ["question-1:pending:-"]);
    let health = boot.journal.health();
    assert!(health.retried_writes >= 1, "{health:?}");
    assert_eq!(health.state, JournalState::Saved);
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
}

#[test]
fn failed_turn_keeps_its_thread_degraded_until_that_turn_is_reconciled() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        write_attempts: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    set_base_mode(&fixture, READ_ONLY);
    let failed_turn = boot.turn(THREAD, "agt-turn-0001", "workspace-1");
    let healthy_turn = boot.turn(THREAD, "agt-turn-0002", "workspace-1");
    failed_turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    set_base_mode(&fixture, WRITABLE);
    assert_eq!(boot.journal.health().retried_writes, 0);

    healthy_turn.ask("question-1");
    assert_eq!(summary(&boot.settled()), ["question-1:pending:-"]);
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Degraded);
    assert_eq!(
        failures(&boot, THREAD),
        [(
            "agt-turn-0001".to_string(),
            JournalFailure::WriteFailed(StoreErrorKind::Unavailable)
        )]
    );

    failed_turn.ask("question-2");
    assert_eq!(boot.settled().len(), 3);
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
    assert!(failures(&boot, THREAD).is_empty());
}

#[test]
fn turn_without_a_bound_history_scope_is_not_journaled_and_degrades_its_thread() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let unbound = boot.unbound_turn("agt-thread-unbound", TURN, "workspace-1");

    unbound.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let attempt = boot.begin(&unbound, "question-1");

    assert!(!attempt.is_recorded());
    assert_eq!(unbound.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();
    let health = boot.journal.health();
    assert_eq!(health.state, JournalState::Degraded);
    assert!(health.unscoped_snapshots >= 2, "{health:?}");
    assert_eq!(health.unsaved_answers, 1);
    assert_eq!(health.failed_writes, 0);
    assert_eq!(
        boot.journal.thread_state("agt-thread-unbound"),
        JournalState::Degraded
    );
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
    assert!(!connection::database_path(&fixture.base, ROOT).exists());
}

#[test]
fn rejected_start_reusing_the_ids_of_a_completing_turn_never_redirects_its_final_snapshot() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let mut first = boot.turn_in(ROOT, THREAD, "agt-turn-0001", "workspace-generation-1");
    first.ask("question-1");
    first.ask("question-2");
    let late = first
        .session
        .snapshot("agt-turn-0001", "workspace-generation-1");
    let attempt = boot.begin(&first, "question-1");
    assert!(attempt.is_recorded());
    assert_eq!(first.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();
    assert_eq!(boot.settled().len(), 2);

    drop(first.tracking.take());
    for root in [ROOT, OTHER_ROOT] {
        let reused = boot
            .journal
            .track_turn(&scope_of(root), THREAD, "agt-turn-0001");
        assert!(reused.is_err(), "{root}");
    }
    let second = boot.turn_in(
        OTHER_ROOT,
        THREAD,
        "agt-turn-0002",
        "workspace-generation-2",
    );
    second.ask("question-1");
    first.session.finish();
    boot.journal.observe(first.scope.as_ref(), THREAD, late);

    assert_eq!(
        summary(&boot.settled()),
        [
            "question-1:resolved:unknown",
            "question-2:expired:turnEnded"
        ]
    );
    assert_eq!(
        summary(&wire(&boot.read(OTHER_ROOT, THREAD))),
        ["question-1:pending:-"]
    );
    assert_eq!(dump_of(&fixture, ROOT).len(), 2);
    assert_eq!(dump_of(&fixture, OTHER_ROOT).len(), 1);
    assert!(dump_of(&fixture, OTHER_ROOT)[0].contains("/agt-turn-0002/"));
    let stored = [dump_of(&fixture, ROOT), dump_of(&fixture, OTHER_ROOT)].concat();
    assert!(!stored.join("\n").contains("workspace-generation"));
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn snapshot_of_a_turn_forgotten_after_retirement_is_refused_and_its_watermark_is_swept() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        retired_turns: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let live = boot.turn(THREAD, "agt-turn-live", "workspace-1");
    live.ask("question-1");
    let mut finished: Vec<LiveTurn> = (0..3)
        .map(|index| {
            let turn = boot.turn(THREAD, &format!("agt-turn-000{index}"), "workspace-1");
            turn.ask("question-1");
            turn.session.finish();
            turn
        })
        .collect();
    assert!(boot.journal.flush(FLUSH));
    let watermarks = || -> Vec<String> {
        let connection = raw_history(&fixture);
        let mut statement = connection
            .prepare("SELECT turn_id FROM runtime_request_turns ORDER BY turn_id")
            .expect("watermark statement");
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("watermark rows");
        rows.map(|row| row.expect("watermark row")).collect()
    };
    assert_eq!(watermarks().len(), 4);

    for turn in &mut finished {
        drop(turn.tracking.take());
    }
    assert!(boot.journal.flush(FLUSH));
    assert_eq!(watermarks(), ["agt-turn-0002", "agt-turn-live"]);
    let settled = dump(&fixture);

    let forgotten = &finished[0];
    let late = forgotten.session.snapshot("agt-turn-0000", "workspace-1");
    boot.journal.observe(forgotten.scope.as_ref(), THREAD, late);
    let retired = &finished[2];
    let accepted = retired.session.snapshot("agt-turn-0002", "workspace-1");
    boot.journal
        .observe(retired.scope.as_ref(), THREAD, accepted);
    live.ask("question-2");
    assert!(boot.journal.flush(FLUSH));

    let health = boot.journal.health();
    assert_eq!(health.late_snapshots, 1);
    assert_eq!(
        failures(&boot, THREAD),
        [("agt-turn-0000".to_string(), JournalFailure::TurnForgotten)]
    );
    assert_eq!(watermarks(), ["agt-turn-0002", "agt-turn-live"]);
    let rows = dump(&fixture);
    assert_eq!(rows.len(), settled.len() + 1);
    assert!(rows
        .iter()
        .any(|row| row.contains("/agt-turn-live/question-2:pending:")));
}

#[test]
fn thread_deleted_while_its_turn_is_live_keeps_no_requests() {
    let fixture = Fixture::new();
    fixture.store.save(ROOT, &owner(), &thread(), 0).unwrap();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    assert_eq!(summary(&boot.settled()), ["question-1:pending:-"]);

    fixture.store.delete(ROOT, &owner(), THREAD).unwrap();
    turn.ask("question-2");
    let attempt = boot.begin(&turn, "question-1");
    let answered = turn.answer("question-1");
    attempt.delivered();
    turn.session.close();

    assert!(boot.settled().is_empty());
    assert!(dump(&fixture).is_empty());
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    let health = boot.journal.health();
    assert_eq!((health.failed_writes, health.unsaved_answers), (0, 0));
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Saved);
}

#[test]
fn queue_refuses_snapshots_beyond_its_turn_and_byte_limits_and_marks_their_turns() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        queued_turns: 2,
        queued_bytes: 4_096,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let turns: Vec<LiveTurn> = (1..=3)
        .map(|index| {
            let turn = boot.turn(
                &format!("agt-thread-000{index}"),
                &format!("agt-turn-000{index}"),
                "workspace-1",
            );
            turn.ask("question-1");
            assert!(boot.journal.flush(FLUSH));
            turn
        })
        .collect();
    let holds: Vec<AnswerAttempt> = turns
        .iter()
        .map(|turn| boot.begin(turn, "question-1"))
        .collect();
    assert!(holds.iter().all(AnswerAttempt::is_recorded));

    for turn in &turns {
        turn.ask("question-2");
    }
    assert_eq!(boot.journal.queued_turns(), 2);
    let health = boot.journal.health();
    assert_eq!(health.dropped_snapshots, 1);
    assert_eq!(
        failures(&boot, "agt-thread-0003"),
        [("agt-turn-0003".to_string(), JournalFailure::QueueFull)]
    );
    turns[0].ask_with("question-large", &"x".repeat(5_000), Ok(()));
    assert_eq!(boot.journal.queued_turns(), 1);
    assert_eq!(boot.journal.health().dropped_snapshots, 2);

    for hold in holds {
        hold.settle(IntentSettlement::Reverted, boot.next_version());
    }
    assert!(boot.journal.flush(FLUSH));
    let stored = |index: usize| summary(&wire(&boot.read(ROOT, &format!("agt-thread-000{index}"))));
    assert_eq!(stored(1), ["question-1:pending:-"]);
    assert_eq!(stored(2), ["question-1:pending:-", "question-2:pending:-"]);
    assert_eq!(stored(3), ["question-1:pending:-"]);
    assert_eq!(
        boot.journal.thread_state("agt-thread-0001"),
        JournalState::Degraded
    );
    assert_eq!(
        boot.journal.thread_state("agt-thread-0002"),
        JournalState::Saved
    );
    assert_eq!(
        boot.journal.thread_state("agt-thread-0003"),
        JournalState::Degraded
    );

    turns[2].ask("question-3");
    assert!(boot.journal.flush(FLUSH));
    assert_eq!(
        stored(3),
        [
            "question-1:pending:-",
            "question-2:pending:-",
            "question-3:pending:-"
        ]
    );
    assert_eq!(
        boot.journal.thread_state("agt-thread-0003"),
        JournalState::Saved
    );
}

#[test]
fn final_snapshot_refused_by_a_full_queue_still_closes_the_requests_already_saved() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        queued_turns: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let finishing = boot.turn("agt-thread-0001", "agt-turn-0001", "workspace-1");
    finishing.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let busy = boot.turn("agt-thread-0002", "agt-turn-0002", "workspace-1");
    busy.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let hold = boot.begin(&busy, "question-1");
    assert!(hold.is_recorded());

    busy.ask("question-2");
    finishing.session.finish();
    assert_eq!(boot.journal.queued_turns(), 1);
    assert_eq!(boot.journal.health().dropped_snapshots, 1);
    let closed = eventually(|| {
        summary(&wire(&boot.read(ROOT, "agt-thread-0001"))) == ["question-1:expired:turnEnded"]
    });
    assert!(
        closed,
        "the saved request was not closed while the queue stayed full"
    );
    assert_eq!(boot.journal.queued_turns(), 1);
    assert!(eventually(|| {
        boot.journal.thread_state("agt-thread-0001") == JournalState::Saved
    }));
    hold.settle(IntentSettlement::Reverted, boot.next_version());
    assert!(boot.journal.flush(FLUSH));

    assert_eq!(
        summary(&wire(&boot.read(ROOT, "agt-thread-0002"))),
        ["question-1:pending:-", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.health().state, JournalState::Saved);
}

#[test]
fn answer_intent_gives_up_at_its_deadline_while_the_database_is_locked() {
    let fixture = Fixture::new();
    let boot = Boot::start_with(&fixture, "boot-0001", released_answer_budget());
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    turn.ask("question-2");
    boot.settled();
    let locker = raw_history(&fixture);
    locker.execute_batch("BEGIN IMMEDIATE").expect("lock");

    let started = Instant::now();
    let blocked_write = boot.begin(&turn, "question-1");
    let write_wait = started.elapsed();
    let recorded = blocked_write.is_recorded();
    let answered = turn.answer("question-1");
    blocked_write.delivered();
    let waiting_started = Instant::now();
    let undrained = boot.begin(&turn, "question-2");
    let drain_wait = waiting_started.elapsed();
    let undrained_recorded = undrained.is_recorded();
    drop(undrained);
    locker.execute_batch("ROLLBACK").expect("unlock");

    assert!(!recorded);
    assert!(!undrained_recorded);
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    for waited in [write_wait, drain_wait] {
        assert!(waited >= ANSWER_INTENT_BUDGET / 2, "{waited:?}");
        assert!(waited < Duration::from_secs(3), "{waited:?}");
    }
    assert_eq!(
        summary(&boot.settled()),
        ["question-1:resolved:unknown", "question-2:pending:-"]
    );
    let health = boot.journal.health();
    assert_eq!(health.unsaved_answers, 1);
    assert_eq!(health.state, JournalState::Saved);
}

#[test]
fn dropping_the_journal_is_bounded_and_abandons_snapshots_it_has_not_started_writing() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let writing = boot.turn(THREAD, "agt-turn-0001", "workspace-1");
    let queued = boot.turn(THREAD, "agt-turn-0002", "workspace-1");
    writing.ask("question-1");
    boot.settled();
    let locker = raw_history(&fixture);
    locker.execute_batch("BEGIN IMMEDIATE").expect("lock");
    writing.ask("question-2");
    assert!(eventually(|| boot.journal.queued_turns() == 0));
    queued.ask("question-1");
    assert_eq!(boot.journal.queued_turns(), 1);

    let started = Instant::now();
    drop(boot);
    let waited = started.elapsed();
    locker.execute_batch("ROLLBACK").expect("unlock");

    assert!(waited >= JOURNAL_SHUTDOWN_DEADLINE / 2, "{waited:?}");
    assert!(waited < JOURNAL_SHUTDOWN_DEADLINE * 3, "{waited:?}");
    assert!(eventually(|| dump(&fixture).len() == 2));
    std::thread::sleep(Duration::from_millis(300));
    let rows = dump(&fixture);
    assert_eq!(rows.len(), 2, "{rows:?}");
    assert!(rows.iter().all(|row| row.contains("/agt-turn-0001/")));
}

#[test]
fn flush_reports_whether_the_journal_settled_before_its_deadline() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    assert!(boot.journal.flush(Duration::ZERO) || boot.journal.flush(FLUSH));
    turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));

    let attempt = boot.begin(&turn, "question-1");
    turn.ask("question-2");
    let started = Instant::now();
    assert!(!boot.journal.flush(Duration::from_millis(80)));
    assert!(started.elapsed() >= Duration::from_millis(80));
    assert!(started.elapsed() < Duration::from_secs(5));
    drop(attempt);

    assert!(boot.journal.flush(FLUSH));
    assert_eq!(boot.journal.queued_turns(), 0);
}

#[test]
fn boot_identity_is_a_wire_identifier_and_differs_between_boots() {
    let first = new_run_id();
    let second = new_run_id();
    assert!(is_identifier(&first), "{first}");
    assert!(first.starts_with("boot-"));
    assert_ne!(first, second);
    let fixture = Fixture::new();
    assert_eq!(Boot::start(&fixture, &first).journal.run_id(), first);
}

#[path = "feed_tests.rs"]
mod feed;
#[path = "journal_loss_tests.rs"]
mod loss;
#[path = "projection_tests.rs"]
mod projection;
#[path = "projection_race_tests.rs"]
mod projection_race;
#[path = "journal_reuse_tests.rs"]
mod reuse;
#[path = "rotation_tests.rs"]
mod rotation;
#[path = "unserved_tests.rs"]
mod unserved;
