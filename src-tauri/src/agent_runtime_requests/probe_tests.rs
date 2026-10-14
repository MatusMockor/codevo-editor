use super::rotation::{feed, Sink};
use super::*;
use crate::agent_runtime_requests::feed::FeedLimits;
use crate::agent_runtime_requests::probe::{probe_due, ProbeWorker};
use crate::agent_runtime_requests::projection::{ProjectionLimits, RequestProjection};
use crate::agent_runtime_requests::store::{
    AnswerIntent, ApplyReport, IntentReceipt, IntentSettle, RootClaim, RuntimeRequestStore,
    StoreError, ThreadRead, TurnKey, TurnObservation,
};
use crate::agent_runtime_requests::unserved::MAX_UNSERVED_SCOPES;
use std::cell::Cell;
use std::sync::Condvar;

const PROBED_ROOTS: &str = "/probed/";

struct ProbedStore {
    inner: HistoryRuntimeRequestStore,
    probes: Mutex<Vec<String>>,
    held: Mutex<bool>,
    released: Condvar,
}

impl ProbedStore {
    fn over(fixture: &Fixture, held: bool) -> Self {
        Self {
            inner: HistoryRuntimeRequestStore::new(fixture.base.clone()),
            probes: Mutex::new(Vec::new()),
            held: Mutex::new(held),
            released: Condvar::new(),
        }
    }

    fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.probes.lock().expect("probes"))
    }

    fn entered(&self) -> usize {
        self.probes.lock().expect("probes").len()
    }

    fn release(&self) {
        *self.held.lock().expect("held") = false;
        self.released.notify_all();
    }

    fn probe(&self, scope: &HistoryScope) -> Result<(), StoreError> {
        self.probes
            .lock()
            .expect("probes")
            .push(scope.root_key.clone());
        let mut held = self.held.lock().expect("held");
        while *held {
            held = self.released.wait(held).expect("held");
        }
        Err(StoreError::new(
            StoreErrorKind::Unavailable,
            "the request history cannot be read",
        ))
    }
}

fn probed(scope: &HistoryScope) -> bool {
    scope.root_key.starts_with(PROBED_ROOTS)
}

impl RuntimeRequestStore for ProbedStore {
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
        if probed(scope) {
            return Ok(true);
        }
        self.inner.holds_root(scope)
    }

    fn read_thread(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        deadline: Instant,
        read: &mut ThreadRead<'_>,
    ) -> Result<(), StoreError> {
        if probed(scope) {
            return self.probe(scope);
        }
        self.inner.read_thread(scope, thread_id, deadline, read)
    }
}

fn probed_root(index: usize) -> String {
    format!("{PROBED_ROOTS}{index}")
}

fn start_over(store: &Arc<ProbedStore>) -> Boot {
    Boot::start_over(
        Arc::clone(store) as Arc<dyn RuntimeRequestStore>,
        "boot-0001",
        patient_answers(),
    )
}

#[test]
fn every_one_of_the_most_failing_projects_is_probed_on_its_own_cadence() {
    let fixture = Fixture::new();
    let store = Arc::new(ProbedStore::over(&fixture, false));
    let boot = start_over(&store);
    let start = Instant::now();
    let interval = Duration::from_secs(5);
    let roots: Vec<String> = (0..MAX_UNSERVED_SCOPES).map(probed_root).collect();
    for root in &roots {
        assert!(!boot
            .journal
            .unserved()
            .failed(&scope_of(root), THREAD, start));
    }
    let projection = RequestProjection::new(Arc::clone(&boot.journal));
    let now = Cell::new(start);
    let clock = || now.get();

    let mut passes = Vec::new();
    while now.get() < start + Duration::from_secs(21) {
        let wait = probe_due(&projection, &clock, interval, &|| false);
        let mut probed = store.drain();
        let attempts = probed.len();
        probed.sort();
        probed.dedup();
        passes.push((now.get() - start, attempts, probed.len(), wait));
        now.set(now.get() + wait);
    }

    assert_eq!(
        passes,
        [0, 5, 10, 15, 20]
            .into_iter()
            .map(|second| {
                let probed = if second == 0 { 0 } else { roots.len() };
                (Duration::from_secs(second), probed, probed, interval)
            })
            .collect::<Vec<_>>()
    );
    assert_eq!(boot.journal.unserved().failing(), MAX_UNSERVED_SCOPES);
}

#[test]
fn a_probe_due_beside_one_already_probed_waits_only_until_its_own_deadline() {
    let fixture = Fixture::new();
    let store = Arc::new(ProbedStore::over(&fixture, false));
    let boot = start_over(&store);
    let start = Instant::now();
    let interval = Duration::from_secs(5);
    let unserved = boot.journal.unserved();
    unserved.failed(&scope_of(&probed_root(0)), THREAD, start);
    unserved.failed(
        &scope_of(&probed_root(1)),
        THREAD,
        start + Duration::from_secs(2),
    );
    let projection = RequestProjection::new(Arc::clone(&boot.journal));
    let now = Cell::new(start + interval);
    let clock = || now.get();

    assert_eq!(
        probe_due(&projection, &clock, interval, &|| false),
        Duration::from_secs(2)
    );
    assert_eq!(store.drain(), [probed_root(0)]);
    now.set(start + Duration::from_secs(7));
    assert_eq!(
        probe_due(&projection, &clock, interval, &|| false),
        Duration::from_secs(3)
    );
    assert_eq!(store.drain(), [probed_root(1)]);
}

#[test]
fn dropping_a_probe_worker_waits_for_the_in_flight_read_and_skips_remaining_projects() {
    let fixture = Fixture::new();
    let store = Arc::new(ProbedStore::over(&fixture, true));
    let boot = start_over(&store);
    let interval = Duration::from_secs(5);
    let due = Instant::now() - interval;
    for index in 0..4 {
        boot.journal
            .unserved()
            .failed(&scope_of(&probed_root(index)), THREAD, due);
    }
    let worker = ProbeWorker::start(&boot.journal, interval, ProjectionLimits::default())
        .expect("probe worker");
    let entered = eventually(|| store.entered() == 1);
    let closed = worker.shutdown_check();
    let (dropped, drop_returned) = std::sync::mpsc::channel();
    let dropping = std::thread::spawn(move || {
        drop(worker);
        dropped.send(()).expect("drop returned");
    });

    let shutdown_requested = eventually(closed);
    let returned_while_held = drop_returned.recv_timeout(Duration::from_millis(100));
    store.release();
    let drop_finished = returned_while_held.is_ok() || drop_returned.recv_timeout(FLUSH).is_ok();
    dropping.join().expect("drop thread");

    assert!(entered);
    assert!(shutdown_requested);
    assert_eq!(
        returned_while_held,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout)
    );
    assert!(drop_finished);
    assert_eq!(store.entered(), 1);
}

#[test]
fn a_slow_probe_does_not_delay_a_push() {
    let fixture = Fixture::new();
    let store = Arc::new(ProbedStore::over(&fixture, true));
    let boot = start_over(&store);
    boot.journal
        .unserved()
        .failed(&scope_of(&probed_root(0)), THREAD, Instant::now());
    let limits = FeedLimits {
        probe: Duration::from_millis(20),
        ..FeedLimits::default()
    };
    let (sink, feed) = feed(&boot, limits);
    assert!(eventually(|| store.entered() == 1));

    let live = boot.turn(THREAD, TURN, "workspace-1");
    live.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let pushed = eventually(|| pushed_request(&sink, "question-1"));
    let still_probing = store.entered() == 1;
    store.release();
    drop(feed);

    assert!(pushed);
    assert!(still_probing);
}

fn pushed_request(sink: &Sink, id: &str) -> bool {
    sink.messages
        .lock()
        .expect("messages")
        .iter()
        .any(|message| {
            message
                .parts()
                .requests
                .iter()
                .any(|request| request.parts().id == id)
        })
}
