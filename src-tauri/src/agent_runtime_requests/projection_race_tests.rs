use super::*;
use crate::agent_runtime_requests::model::{wire_name, RuntimeRequest, ThreadRequests};
use crate::agent_runtime_requests::projection::{
    ProjectionError, RequestProjection, STALE_THREAD_REQUESTS_CURSOR_ERROR,
};
use crate::agent_runtime_requests::store::{
    AnswerIntent, ApplyReport, IntentReceipt, IntentSettle, RootClaim, RuntimeRequestStore,
    StoreError, StoredEntry, ThreadRead, ThreadRows, ThreadSummary, TurnKey, TurnObservation,
};
use std::collections::HashMap;

pub(super) type Hook = Box<dyn FnOnce() + Send>;

pub(super) struct PausingStore {
    pub(super) inner: HistoryRuntimeRequestStore,
    pub(super) after_first_entries: Mutex<Option<Hook>>,
    pub(super) panic_next_apply: std::sync::atomic::AtomicBool,
}

impl PausingStore {
    pub(super) fn over(fixture: &Fixture) -> Self {
        Self {
            inner: HistoryRuntimeRequestStore::new(fixture.base.clone()),
            after_first_entries: Mutex::new(None),
            panic_next_apply: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

struct PausingRows<'a, 'r> {
    inner: &'a mut (dyn ThreadRows + 'r),
    hook: &'a Mutex<Option<Hook>>,
}

impl ThreadRows for PausingRows<'_, '_> {
    fn summary(&mut self) -> Result<ThreadSummary, StoreError> {
        self.inner.summary()
    }

    fn entries(&mut self, turn_id: &str) -> Result<Vec<StoredEntry>, StoreError> {
        let entries = self.inner.entries(turn_id)?;
        let hook = self.hook.lock().expect("hook").take();
        if let Some(hook) = hook {
            hook();
        }
        Ok(entries)
    }

    fn load(
        &mut self,
        turn_id: &str,
        request_id: &str,
    ) -> Result<Option<RuntimeRequest>, StoreError> {
        self.inner.load(turn_id, request_id)
    }
}

impl RuntimeRequestStore for PausingStore {
    fn claim_root(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        now_epoch_ms: u64,
    ) -> Result<RootClaim, StoreError> {
        self.inner.claim_root(scope, run_id, now_epoch_ms)
    }

    fn apply_snapshot(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        observation: &TurnObservation,
    ) -> Result<ApplyReport, StoreError> {
        if self.panic_next_apply.swap(false, Ordering::SeqCst) {
            panic!("the store failed while it was writing");
        }
        self.inner.apply_snapshot(scope, run_id, observation)
    }

    fn record_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        intent: &AnswerIntent,
        deadline: Instant,
    ) -> Result<IntentReceipt, StoreError> {
        self.inner.record_intent(scope, run_id, intent, deadline)
    }

    fn settle_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        settle: &IntentSettle,
        deadline: Instant,
    ) -> Result<bool, StoreError> {
        self.inner.settle_intent(scope, run_id, settle, deadline)
    }

    fn read(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        limit: usize,
    ) -> Result<StoredRequests, StoreError> {
        self.inner.read(scope, thread_id, limit)
    }

    fn retain_turn_states(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        known_turns: &[TurnKey],
    ) -> Result<u64, StoreError> {
        self.inner.retain_turn_states(scope, run_id, known_turns)
    }

    fn holds_root(&self, scope: &HistoryScope) -> Result<bool, StoreError> {
        self.inner.holds_root(scope)
    }

    fn read_thread(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        deadline: Instant,
        read: &mut ThreadRead<'_>,
    ) -> Result<(), StoreError> {
        self.inner
            .read_thread(scope, thread_id, deadline, &mut |rows| {
                read(&mut PausingRows {
                    inner: rows,
                    hook: &self.after_first_entries,
                })
            })
    }
}

fn described(request: &RuntimeRequest) -> String {
    let status = wire_name(&request.status()).expect("status name");
    format!("{}:{status}", request.parts().id)
}

#[derive(Default)]
struct Client {
    known: HashMap<String, (u64, String)>,
}

impl Client {
    fn merge(&mut self, message: &ThreadRequests) {
        for request in &message.parts().requests {
            let newer = self
                .known
                .get(&request.parts().id)
                .is_none_or(|(version, _)| request.parts().version > *version);
            if newer {
                self.known.insert(
                    request.parts().id.clone(),
                    (request.parts().version, described(request)),
                );
            }
        }
    }

    fn state(&self, id: &str) -> Option<&str> {
        self.known.get(id).map(|(_, state)| state.as_str())
    }
}

fn pull(projection: &RequestProjection) -> ThreadRequests {
    projection
        .page(&scope_of(ROOT), THREAD, &[TURN.to_string()], None)
        .expect("pull")
        .message
}

#[test]
fn stale_read_never_reports_a_closure_above_the_answer_that_landed() {
    let fixture = Fixture::new();
    let store = Arc::new(PausingStore::over(&fixture));
    let boot = Boot::start_over(
        Arc::clone(&store) as Arc<dyn RuntimeRequestStore>,
        "boot-0001",
        patient_answers(),
    );
    let mut turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let projection = RequestProjection::new(Arc::clone(&boot.journal));
    let mut client = Client::default();
    client.merge(&pull(&projection));
    assert_eq!(client.state("question-1"), Some("question-1:pending"));
    drop(turn.tracking.take());
    let session = Arc::clone(&turn.session);
    let journal = Arc::clone(&boot.journal);
    *store.after_first_entries.lock().expect("hook") = Some(Box::new(move || {
        let answered = session.answer(
            TURN,
            "question-1",
            AgentQuestionResponse { answers: answers() },
        );
        assert_eq!(answered.map(|_| ()), Ok(()));
        assert!(journal.flush(FLUSH));
    }));

    let raced = pull(&projection);
    client.merge(&raced);
    let settled = pull(&projection);
    client.merge(&settled);

    assert_eq!(client.state("question-1"), Some("question-1:resolved"));
    let answered_at = settled.parts().requests[0].parts().version;
    assert!(raced
        .parts()
        .requests
        .iter()
        .all(|request| request.parts().version <= answered_at));
}

#[test]
fn first_page_that_meets_an_undecodable_body_reports_it_as_unreadable() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    turn.ask("question-2");
    assert!(boot.journal.flush(FLUSH));
    raw_history(&fixture)
        .execute_batch(
            "UPDATE runtime_requests SET body='{not json' WHERE request_id='question-1';",
        )
        .expect("corrupt a body");

    let page = RequestProjection::new(Arc::clone(&boot.journal))
        .page(&scope_of(ROOT), THREAD, &[TURN.to_string()], None)
        .expect("pull");

    let parts = page.message.parts();
    let listed: Vec<String> = parts.requests.iter().map(described).collect();
    assert_eq!(listed, ["question-2:pending"]);
    assert_eq!(parts.unreadable, 1);
    assert_eq!(page.next_cursor, None);
}

#[test]
fn stale_cursor_error_text_is_the_one_the_frontend_matches() {
    assert_eq!(
        ProjectionError::StaleCursor.to_string(),
        "Agent thread request cursor is no longer valid."
    );
    assert_eq!(
        STALE_THREAD_REQUESTS_CURSOR_ERROR,
        "Agent thread request cursor is no longer valid."
    );
}

#[test]
fn claim_failures_are_kept_only_while_a_caller_waits_for_them() {
    let fixture = Fixture::new();
    let store = Arc::new(HistoryRuntimeRequestStore::with_snapshot_busy_timeout(
        fixture.base.clone(),
        Duration::from_millis(300),
    ));
    let boot = Boot::start_over(store, "boot-0001", patient_answers());
    let roots = [
        "/workspace/cold-a",
        "/workspace/cold-b",
        "/workspace/cold-c",
    ];
    let mut blockers = Vec::new();
    for root in roots {
        AgentHistoryStore::new(fixture.base.clone())
            .load(root, &scope_of(root).owner_id)
            .expect("create the history");
        let blocker = rusqlite::Connection::open(connection::database_path(&fixture.base, root))
            .expect("open the history");
        blocker
            .execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
            .expect("lock the history");
        blockers.push(blocker);
    }
    let projection = RequestProjection::with_limits(
        Arc::clone(&boot.journal),
        crate::agent_runtime_requests::projection::ProjectionLimits {
            read_budget: Duration::from_millis(20),
            ..Default::default()
        },
    );

    for root in roots {
        let refused = projection.page(&scope_of(root), THREAD, &[TURN.to_string()], None);
        assert!(refused.is_err());
    }

    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(boot.journal.remembered_claim_results(), 0);
    drop(blockers);
}
