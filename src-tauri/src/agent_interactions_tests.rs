use super::super::approvals::{
    AgentApprovalDecision, AgentApprovalFact, AgentApprovalKind, AgentApprovalRequest,
    AgentApprovalStatus, MAX_RETAINED_AGENT_APPROVALS,
};
use super::super::{
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionRequest, AgentQuestionResponse,
    AgentQuestionSession, AgentQuestionStatus,
};
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Barrier;
use std::thread;
use std::time::{Duration, Instant};

const TASK: &str = "agt-interactions";
const WORKSPACE: &str = "ws-interactions";

type Seen = Arc<Mutex<Vec<AgentInteractionSnapshot>>>;

fn question(id: &str) -> AgentQuestionRequest {
    AgentQuestionRequest {
        id: id.into(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        questions: vec![AgentQuestion {
            id: "q".into(),
            header: "Choice".into(),
            prompt: "Which?".into(),
            options: Vec::new(),
            multiple: false,
            allow_custom: true,
        }],
        status: AgentQuestionStatus::Pending,
        answers: None,
    }
}

fn response() -> AgentQuestionResponse {
    AgentQuestionResponse {
        answers: vec![AgentQuestionAnswerItem {
            question_id: "q".into(),
            option_ids: Vec::new(),
            text: "answer".into(),
        }],
    }
}

fn approval(id: &str) -> AgentApprovalRequest {
    AgentApprovalRequest {
        id: id.into(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        kind: AgentApprovalKind::Command,
        title: "Run a command".into(),
        detail: "npm test".into(),
        detail_truncated: false,
        facts: vec![AgentApprovalFact {
            label: "Directory".into(),
            value: "/repo".into(),
        }],
        decisions: vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny,
        ],
        status: AgentApprovalStatus::Pending,
        decision: None,
    }
}

fn observe(session: &Arc<AgentQuestionSession>) -> Seen {
    let seen = Seen::default();
    let recorded = Arc::clone(&seen);
    let weak = Arc::downgrade(session);
    session.observe(Arc::new(move || {
        let Some(session) = weak.upgrade() else {
            return;
        };
        let snapshot = session.snapshot(TASK, WORKSPACE);
        recorded.lock().expect("seen lock").push(snapshot);
    }));
    seen
}

fn pushed(seen: &Seen) -> Vec<AgentInteractionSnapshot> {
    seen.lock().expect("seen lock").clone()
}

fn last_pushed(seen: &Seen) -> AgentInteractionSnapshot {
    pushed(seen)
        .pop()
        .unwrap_or_else(|| AgentInteractionSnapshot::empty(TASK, WORKSPACE))
}

fn wait_until(mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if predicate() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

fn question_statuses(snapshot: &AgentInteractionSnapshot) -> Vec<AgentQuestionStatus> {
    snapshot
        .questions
        .iter()
        .map(|request| request.status.clone())
        .collect()
}

fn approval_statuses(snapshot: &AgentInteractionSnapshot) -> Vec<AgentApprovalStatus> {
    snapshot
        .approvals
        .iter()
        .map(|request| request.status)
        .collect()
}

#[test]
fn snapshot_serializes_to_the_pinned_wire_shape() {
    let session = AgentQuestionSession::new();
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let value = serde_json::to_value(session.snapshot(TASK, WORKSPACE)).expect("snapshot json");
    assert_eq!(
        value,
        serde_json::json!({
            "taskId": TASK,
            "workspaceId": WORKSPACE,
            "sequence": 1,
            "questions": [{
                "id": "question-1",
                "taskId": TASK,
                "provider": "claudeCode",
                "questions": [{
                    "id": "q",
                    "header": "Choice",
                    "prompt": "Which?",
                    "options": [],
                    "multiple": false,
                    "allowCustom": true
                }],
                "status": "pending"
            }],
            "approvals": [{
                "id": "approval-1",
                "taskId": TASK,
                "provider": "claudeCode",
                "kind": "command",
                "title": "Run a command",
                "detail": "npm test",
                "detailTruncated": false,
                "facts": [{"label": "Directory", "value": "/repo"}],
                "decisions": ["allowOnce", "deny"],
                "status": "pending"
            }]
        })
    );
}

#[test]
fn empty_snapshot_serializes_sequence_zero_and_no_requests() {
    let value = serde_json::to_value(AgentInteractionSnapshot::empty(TASK, WORKSPACE))
        .expect("snapshot json");
    assert_eq!(
        value,
        serde_json::json!({
            "taskId": TASK,
            "workspaceId": WORKSPACE,
            "sequence": 0,
            "questions": [],
            "approvals": []
        })
    );
}

#[test]
fn observing_delivers_the_current_state_once() {
    let session = Arc::new(AgentQuestionSession::new());
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let seen = observe(&session);
    let snapshots = pushed(&seen);
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].sequence, 1);
    assert_eq!(
        question_statuses(&snapshots[0]),
        vec![AgentQuestionStatus::Pending]
    );
}

#[test]
fn every_question_mutation_pushes_one_snapshot_with_the_new_state() {
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    let mut expected = 1;
    let mut assert_pushed = |label: &str, statuses: Vec<AgentQuestionStatus>| {
        expected += 1;
        let snapshots = pushed(&seen);
        assert_eq!(snapshots.len(), expected, "{label}");
        assert_eq!(
            question_statuses(&snapshots[expected - 1]),
            statuses,
            "{label}"
        );
    };
    let pending = AgentQuestionStatus::Pending;
    let answered = AgentQuestionStatus::Answered;
    let expired = AgentQuestionStatus::Expired;
    let cancelled = AgentQuestionStatus::Cancelled;

    assert_eq!(
        session.register(question("answered"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed("register", vec![pending.clone()]);
    assert_eq!(
        session
            .answer(TASK, "answered", response())
            .map(|request| request.status),
        Ok(answered.clone())
    );
    assert_pushed("answer", vec![answered.clone()]);
    assert_eq!(
        session.register(
            question("undelivered"),
            Arc::new(|_| Err("write failed".into()))
        ),
        Ok(())
    );
    assert_pushed("register", vec![answered.clone(), pending.clone()]);
    assert_eq!(
        session.answer(TASK, "undelivered", response()),
        Err("write failed".to_string())
    );
    assert_pushed("failed answer", vec![answered.clone(), expired.clone()]);
    assert_eq!(
        session.register(question("expired"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed(
        "register",
        vec![answered.clone(), expired.clone(), pending.clone()],
    );
    session.expire("expired");
    assert_pushed(
        "expire",
        vec![answered.clone(), expired.clone(), expired.clone()],
    );
    assert_eq!(
        session.register(question("cancelled"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed(
        "register",
        vec![
            answered.clone(),
            expired.clone(),
            expired.clone(),
            pending.clone(),
        ],
    );
    session.cancel("cancelled");
    assert_pushed(
        "cancel",
        vec![
            answered.clone(),
            expired.clone(),
            expired.clone(),
            cancelled.clone(),
        ],
    );
    assert_eq!(
        session.register(question("finished"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed(
        "register",
        vec![
            answered.clone(),
            expired.clone(),
            expired.clone(),
            cancelled.clone(),
            pending,
        ],
    );
    session.finish();
    assert_pushed(
        "finish",
        vec![
            answered,
            expired.clone(),
            expired.clone(),
            cancelled,
            expired,
        ],
    );
}

#[test]
fn every_approval_mutation_pushes_one_snapshot_with_the_new_state() {
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    let mut expected = 1;
    let mut assert_pushed = |label: &str, statuses: Vec<AgentApprovalStatus>| {
        expected += 1;
        let snapshots = pushed(&seen);
        assert_eq!(snapshots.len(), expected, "{label}");
        assert_eq!(
            approval_statuses(&snapshots[expected - 1]),
            statuses,
            "{label}"
        );
    };
    let pending = AgentApprovalStatus::Pending;
    let approved = AgentApprovalStatus::Approved;
    let expired = AgentApprovalStatus::Expired;
    let cancelled = AgentApprovalStatus::Cancelled;
    let approvals = session.approvals();

    assert_eq!(
        approvals.register(approval("approved"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed("register", vec![pending]);
    assert_eq!(
        approvals
            .answer(TASK, "approved", AgentApprovalDecision::AllowOnce)
            .map(|request| request.status),
        Ok(approved)
    );
    assert_pushed("answer", vec![approved]);
    assert_eq!(
        approvals.register(
            approval("undelivered"),
            Arc::new(|_| Err("write failed".into()))
        ),
        Ok(())
    );
    assert_pushed("register", vec![approved, pending]);
    assert_eq!(
        approvals.answer(TASK, "undelivered", AgentApprovalDecision::Deny),
        Err("write failed".to_string())
    );
    assert_pushed("failed answer", vec![approved, expired]);
    assert_eq!(
        approvals.register(approval("expired"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed("register", vec![approved, expired, pending]);
    session.expire("expired");
    assert_pushed("expire", vec![approved, expired, expired]);
    assert_eq!(
        approvals.register(approval("cancelled"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed("register", vec![approved, expired, expired, pending]);
    approvals.cancel("cancelled");
    assert_pushed("cancel", vec![approved, expired, expired, cancelled]);
    assert_eq!(
        approvals.register(approval("closed"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_pushed(
        "register",
        vec![approved, expired, expired, cancelled, pending],
    );
    session.close();
    assert_pushed(
        "close",
        vec![approved, expired, expired, cancelled, expired],
    );
}

#[test]
fn unchanged_state_does_not_push() {
    let session = Arc::new(AgentQuestionSession::new());
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session.answer(TASK, "question-1", response()).map(|_| ()),
        Ok(())
    );
    let seen = observe(&session);
    session.expire("question-1");
    session.cancel("question-1");
    session.expire("unknown");
    session.approvals().cancel("unknown");
    assert_eq!(
        session.answer(TASK, "question-1", response()).map(|_| ()),
        Ok(())
    );
    assert!(session
        .register(question("question-1"), Arc::new(|_| Ok(())))
        .is_err());
    assert_eq!(pushed(&seen).len(), 1);
    session.close();
    session.close();
    session.finish();
    assert_eq!(pushed(&seen).len(), 2);
}

#[test]
fn failing_a_session_pushes_the_expired_requests() {
    let session = Arc::new(AgentQuestionSession::new());
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let seen = observe(&session);
    session.fail("provider stream ended");
    let snapshots = pushed(&seen);
    assert_eq!(snapshots.len(), 2);
    assert_eq!(
        question_statuses(&snapshots[1]),
        vec![AgentQuestionStatus::Expired]
    );
    assert_eq!(
        approval_statuses(&snapshots[1]),
        vec![AgentApprovalStatus::Expired]
    );
    assert_eq!(session.failure().as_deref(), Some("provider stream ended"));
}

#[test]
fn approval_timeout_pushes_the_timed_out_request_without_a_reader() {
    let session = Arc::new(AgentQuestionSession::with_approval_timeout(
        Duration::from_millis(30),
    ));
    let seen = observe(&session);
    let denied = Arc::new(AtomicBool::new(false));
    let responder_denied = Arc::clone(&denied);
    assert_eq!(
        session.approvals().register(
            approval("approval-1"),
            Arc::new(move |decision| {
                responder_denied.store(decision == AgentApprovalDecision::Deny, Ordering::SeqCst);
                Ok(())
            })
        ),
        Ok(())
    );
    assert!(
        wait_until(|| approval_statuses(&last_pushed(&seen)) == vec![AgentApprovalStatus::TimedOut]),
        "the timeout transition was never pushed: {:?}",
        pushed(&seen)
    );
    assert!(wait_until(|| denied.load(Ordering::SeqCst)));
}

#[test]
fn overdue_approval_settled_before_a_pull_is_pushed_too() {
    let session = Arc::new(AgentQuestionSession::with_approval_timeout(Duration::ZERO));
    let seen = observe(&session);
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    session.expire_overdue();
    let pulled = session.snapshot(TASK, WORKSPACE);
    assert_eq!(
        approval_statuses(&pulled),
        vec![AgentApprovalStatus::TimedOut]
    );
    assert!(
        wait_until(|| pushed(&seen)
            .iter()
            .any(|snapshot| approval_statuses(snapshot) == vec![AgentApprovalStatus::TimedOut])),
        "the overdue approval was never pushed: {:?}",
        pushed(&seen)
    );
    assert!(pushed(&seen)
        .iter()
        .all(|snapshot| snapshot.sequence != pulled.sequence));
}

#[test]
fn sequences_strictly_increase_across_pushes_and_pulls() {
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    let mut sequences = vec![last_pushed(&seen).sequence];
    sequences.push(session.snapshot(TASK, WORKSPACE).sequence);
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    sequences.push(last_pushed(&seen).sequence);
    sequences.push(session.snapshot(TASK, WORKSPACE).sequence);
    sequences.push(session.snapshot(TASK, WORKSPACE).sequence);
    session.close();
    sequences.push(last_pushed(&seen).sequence);
    sequences.push(session.snapshot(TASK, WORKSPACE).sequence);
    assert_eq!(sequences, vec![1, 2, 3, 4, 5, 6, 7]);
}

fn settled(snapshot: &AgentInteractionSnapshot) -> usize {
    let questions = snapshot
        .questions
        .iter()
        .filter(|request| request.status != AgentQuestionStatus::Pending)
        .count();
    let approvals = snapshot
        .approvals
        .iter()
        .filter(|request| request.status != AgentApprovalStatus::Pending)
        .count();
    questions + approvals
}

fn registered(snapshot: &AgentInteractionSnapshot) -> usize {
    snapshot.questions.len() + snapshot.approvals.len()
}

#[test]
fn concurrent_mutations_never_number_older_state_above_newer_state() {
    const WRITERS: usize = 4;
    const ROUNDS: usize = MAX_RETAINED_AGENT_APPROVALS / WRITERS;
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    let barrier = Arc::new(Barrier::new(WRITERS + 1));
    let pulled = Seen::default();
    let writers: Vec<_> = (0..WRITERS)
        .map(|writer| {
            let session = Arc::clone(&session);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                (0..ROUNDS)
                    .map(|round| {
                        let id = format!("approval-{writer}-{round}");
                        let approvals = session.approvals();
                        let registered = approvals.register(approval(&id), Arc::new(|_| Ok(())));
                        let answered = approvals
                            .answer(TASK, &id, AgentApprovalDecision::AllowOnce)
                            .map(|request| request.status);
                        (registered, answered)
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    let reader = {
        let session = Arc::clone(&session);
        let barrier = Arc::clone(&barrier);
        let pulled = Arc::clone(&pulled);
        thread::spawn(move || {
            barrier.wait();
            for _ in 0..(WRITERS * ROUNDS) {
                let snapshot = session.snapshot(TASK, WORKSPACE);
                pulled.lock().expect("pulled lock").push(snapshot);
            }
        })
    };
    for writer in writers {
        let outcomes = writer.join().expect("writer thread");
        for (registered, answered) in outcomes {
            assert_eq!(registered, Ok(()));
            assert_eq!(answered, Ok(AgentApprovalStatus::Approved));
        }
    }
    reader.join().expect("reader thread");

    let mut snapshots = pushed(&seen);
    snapshots.extend(pushed(&pulled));
    snapshots.sort_by_key(|snapshot| snapshot.sequence);
    assert_eq!(snapshots.len(), 1 + WRITERS * ROUNDS * 3);
    for pair in snapshots.windows(2) {
        assert!(
            pair[0].sequence < pair[1].sequence,
            "sequence {} was issued twice",
            pair[0].sequence
        );
        assert!(
            registered(&pair[0]) <= registered(&pair[1]) && settled(&pair[0]) <= settled(&pair[1]),
            "sequence {} carries newer state than sequence {}",
            pair[0].sequence,
            pair[1].sequence
        );
    }
    let newest = snapshots.last().expect("at least one snapshot");
    assert_eq!(registered(newest), WRITERS * ROUNDS);
    assert_eq!(settled(newest), WRITERS * ROUNDS);
}

#[test]
fn released_observer_receives_no_further_pushes() {
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    session.release_observer();
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    session.close();
    assert_eq!(pushed(&seen).len(), 1);
    assert_eq!(session.snapshot(TASK, WORKSPACE).sequence, 2);
}

#[test]
fn panicking_observer_does_not_strand_the_session() {
    let session = Arc::new(AgentQuestionSession::new());
    session.observe(Arc::new(|| panic!("observer panic injected")));
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        session
            .answer(TASK, "question-1", response())
            .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        session
            .approvals()
            .answer(TASK, "approval-1", AgentApprovalDecision::Deny)
            .map(|request| request.status),
        Ok(AgentApprovalStatus::Denied)
    );
    session.close();
    let snapshot = session.snapshot(TASK, WORKSPACE);
    assert_eq!(
        question_statuses(&snapshot),
        vec![AgentQuestionStatus::Answered]
    );
    assert_eq!(
        approval_statuses(&snapshot),
        vec![AgentApprovalStatus::Denied]
    );
}

#[test]
fn observer_does_not_keep_the_session_alive() {
    let session = Arc::new(AgentQuestionSession::new());
    let seen = observe(&session);
    let weak = Arc::downgrade(&session);
    assert_eq!(Arc::strong_count(&session), 1);
    drop(session);
    assert!(weak.upgrade().is_none());
    assert_eq!(pushed(&seen).len(), 1);
}

#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    signal: std::sync::Condvar,
}

impl Gate {
    fn open(&self) {
        *self.open.lock().expect("gate lock") = true;
        self.signal.notify_all();
    }

    fn wait_open(&self) -> bool {
        let open = self.open.lock().expect("gate lock");
        let (open, _) = self
            .signal
            .wait_timeout_while(open, Duration::from_secs(5), |open| !*open)
            .expect("gate wait");
        *open
    }
}

struct PausedDelivery {
    entered: Arc<Gate>,
    resume: Arc<Gate>,
}

impl PausedDelivery {
    fn new() -> Self {
        Self {
            entered: Arc::new(Gate::default()),
            resume: Arc::new(Gate::default()),
        }
    }

    fn deliver(&self) -> impl Fn() -> Result<(), String> + Send + Sync + 'static {
        let entered = Arc::clone(&self.entered);
        let resume = Arc::clone(&self.resume);
        move || {
            entered.open();
            if resume.wait_open() {
                return Ok(());
            }
            Err("the test never resumed the paused delivery".to_string())
        }
    }
}

fn observe_with_ownership_token(session: &Arc<AgentQuestionSession>) -> (Seen, Arc<()>) {
    let seen = Seen::default();
    let token = Arc::new(());
    let recorded = Arc::clone(&seen);
    let held = Arc::clone(&token);
    let weak = Arc::downgrade(session);
    session.observe(Arc::new(move || {
        let _held = &held;
        let Some(session) = weak.upgrade() else {
            return;
        };
        let snapshot = session.snapshot(TASK, WORKSPACE);
        recorded.lock().expect("seen lock").push(snapshot);
    }));
    (seen, token)
}

#[test]
fn releasing_with_no_answer_in_flight_drops_the_observer_at_once() {
    let session = Arc::new(AgentQuestionSession::new());
    let (seen, token) = observe_with_ownership_token(&session);
    assert_eq!(Arc::strong_count(&token), 2);
    session.release_observer();
    assert_eq!(Arc::strong_count(&token), 1);
    assert_eq!(
        session.register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(pushed(&seen).len(), 1);
}

#[test]
fn release_keeps_publishing_until_an_in_flight_question_answer_settles() {
    let session = Arc::new(AgentQuestionSession::new());
    let (seen, token) = observe_with_ownership_token(&session);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        session.register(question("question-1"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| session.answer(TASK, "question-1", response()));
        assert!(delivery.entered.wait_open());
        session.finish();
        session.release_observer();
        assert_eq!(Arc::strong_count(&token), 2);
        assert_eq!(
            question_statuses(&last_pushed(&seen)),
            vec![AgentQuestionStatus::Pending]
        );
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        question_statuses(&last_pushed(&seen)),
        vec![AgentQuestionStatus::Answered]
    );
    assert_eq!(Arc::strong_count(&token), 1);
}

#[test]
fn release_keeps_publishing_until_an_approval_answered_across_a_stop_settles() {
    let session = Arc::new(AgentQuestionSession::new());
    let (seen, token) = observe_with_ownership_token(&session);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        session
            .approvals()
            .register(approval("approval-1"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| {
            session
                .approvals()
                .answer(TASK, "approval-1", AgentApprovalDecision::AllowOnce)
        });
        assert!(delivery.entered.wait_open());
        session.close();
        session.release_observer();
        assert_eq!(Arc::strong_count(&token), 2);
        assert_eq!(
            approval_statuses(&last_pushed(&seen)),
            vec![AgentApprovalStatus::Expired]
        );
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentApprovalStatus::Approved)
    );
    assert_eq!(
        approval_statuses(&last_pushed(&seen)),
        vec![AgentApprovalStatus::Approved]
    );
    assert_eq!(Arc::strong_count(&token), 1);
}

#[test]
fn an_in_flight_answer_that_settles_nothing_still_releases_the_observer() {
    let session = Arc::new(AgentQuestionSession::new());
    let (seen, token) = observe_with_ownership_token(&session);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        session.register(question("question-1"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| session.answer(TASK, "question-1", response()));
        assert!(delivery.entered.wait_open());
        session.close();
        session.release_observer();
        assert_eq!(Arc::strong_count(&token), 2);
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(
        answered,
        Err("Question expired while sending answer.".to_string())
    );
    let snapshots = pushed(&seen);
    assert_eq!(snapshots.len(), 3);
    assert_eq!(
        question_statuses(&snapshots[2]),
        vec![AgentQuestionStatus::Expired]
    );
    assert_eq!(Arc::strong_count(&token), 1);
}

#[test]
fn an_answer_that_panics_after_release_still_drops_the_observer() {
    let session = Arc::new(AgentQuestionSession::new());
    let (seen, token) = observe_with_ownership_token(&session);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        session.approvals().register(
            approval("approval-1"),
            Arc::new(move |_| {
                assert_eq!(deliver(), Ok(()));
                panic!("delivery panic injected")
            })
        ),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| {
            session
                .approvals()
                .answer(TASK, "approval-1", AgentApprovalDecision::Deny)
        });
        assert!(delivery.entered.wait_open());
        session.release_observer();
        assert_eq!(Arc::strong_count(&token), 2);
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(answered, Err("Approval response failed.".to_string()));
    assert_eq!(
        approval_statuses(&last_pushed(&seen)),
        vec![AgentApprovalStatus::Expired]
    );
    assert_eq!(pushed(&seen).len(), 3);
    assert_eq!(Arc::strong_count(&token), 1);
}

#[test]
fn sessions_sharing_a_sequence_source_never_reuse_or_lower_a_number() {
    let earlier = AgentQuestionSession::new();
    assert_eq!(earlier.snapshot(TASK, WORKSPACE).sequence, 1);
    assert_eq!(earlier.snapshot(TASK, WORKSPACE).sequence, 2);
    let shared = Arc::new(std::sync::atomic::AtomicU64::new(0));
    earlier.share_sequence(Arc::clone(&shared));
    assert_eq!(earlier.snapshot(TASK, WORKSPACE).sequence, 3);
    let replacement = AgentQuestionSession::new();
    replacement.share_sequence(Arc::clone(&shared));
    assert_eq!(replacement.snapshot(TASK, WORKSPACE).sequence, 4);
    assert_eq!(earlier.snapshot(TASK, WORKSPACE).sequence, 5);
    assert_eq!(replacement.snapshot(TASK, WORKSPACE).sequence, 6);
}
