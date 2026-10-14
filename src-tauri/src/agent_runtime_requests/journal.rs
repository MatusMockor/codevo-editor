use super::health::{JournalHealth, JournalLedger, TurnFailure};
use super::model::{JournalState, RequestResolution};
use super::observed::{observe_snapshot, retained_bytes, ObservedTurn};
use super::scopes::{
    HistoryScope, TurnAuthority, TurnIdentityConflict, TurnTracker, MAX_RETIRED_TURNS,
};
use crate::agent_task_admission::AgentTaskHistoryScope;
use super::store::{
    AnswerIntent, IntentReceipt, IntentSettle, IntentSettlement, RootClaim, RuntimeRequestStore,
    StoreError, StoreErrorKind, StoredRequests, TurnKey, TurnObservation,
};
use crate::agent_questions::interactions::AgentInteractionSnapshot;
use std::collections::HashMap;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const ANSWER_INTENT_BUDGET: Duration = Duration::from_millis(250);
pub const MAX_QUEUED_TURNS: usize = 256;
pub const MAX_QUEUED_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_QUEUED_DIGESTS: usize = 1024;
pub const MAX_WRITE_ATTEMPTS: u32 = 4;
pub const JOURNAL_SHUTDOWN_DEADLINE: Duration = Duration::from_secs(1);
const WRITE_RETRY_BACKOFF: Duration = Duration::from_millis(200);
const UNSCOPED_SINCE_SEQUENCE: u64 = u64::MAX;

pub type JournalClock = Arc<dyn Fn() -> u64 + Send + Sync>;

pub fn system_clock() -> JournalClock {
    Arc::new(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            })
    })
}

pub fn new_run_id() -> String {
    let mut seed = [0u8; 8];
    let random = std::fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut seed))
        .is_ok();
    if !random {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let mixed = nanos ^ (u128::from(std::process::id()) << 64);
        seed.copy_from_slice(&mixed.to_le_bytes()[..8]);
    }
    let token: String = seed.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("boot-{}-{token}", std::process::id())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JournalLimits {
    pub queued_turns: usize,
    pub queued_bytes: usize,
    pub queued_digests: usize,
    pub write_attempts: u32,
    pub retry_backoff: Duration,
    pub answer_budget: Duration,
    pub retired_turns: usize,
}

impl Default for JournalLimits {
    fn default() -> Self {
        Self {
            queued_turns: MAX_QUEUED_TURNS,
            queued_bytes: MAX_QUEUED_SNAPSHOT_BYTES,
            queued_digests: MAX_QUEUED_DIGESTS,
            write_attempts: MAX_WRITE_ATTEMPTS,
            retry_backoff: WRITE_RETRY_BACKOFF,
            answer_budget: ANSWER_INTENT_BUDGET,
            retired_turns: MAX_RETIRED_TURNS,
        }
    }
}

enum SnapshotContent {
    Raw(AgentInteractionSnapshot),
    Observed(ObservedTurn),
}

impl SnapshotContent {
    fn into_observed(self) -> ObservedTurn {
        match self {
            Self::Raw(snapshot) => observe_snapshot(snapshot),
            Self::Observed(turn) => turn,
        }
    }
}

struct QueuedSnapshot {
    content: SnapshotContent,
    sequence: u64,
    bytes: usize,
    digest: bool,
    first_observed_at_epoch_ms: u64,
    observed_at_epoch_ms: u64,
    attempts: u32,
    not_before: Option<Instant>,
}

impl QueuedSnapshot {
    fn into_digest(self) -> Self {
        let turn = self.content.into_observed().into_digest();
        Self {
            bytes: turn.digest_bytes(),
            digest: true,
            content: SnapshotContent::Observed(turn),
            ..self
        }
    }
}

#[derive(Default)]
struct Slot {
    latest: Option<QueuedSnapshot>,
    answers_in_flight: usize,
}

impl Slot {
    fn is_idle(&self) -> bool {
        self.latest.is_none() && self.answers_in_flight == 0
    }
}

enum Offer {
    Queued,
    Superseded,
    Full(Box<QueuedSnapshot>),
}

enum Ready {
    Job(TurnAuthority, Box<QueuedSnapshot>),
    Sweep(HistoryScope),
    NotBefore(Instant),
    Idle,
}

struct Queue {
    limits: JournalLimits,
    slots: HashMap<TurnAuthority, Slot>,
    sweeps: Vec<HistoryScope>,
    writing: Option<TurnAuthority>,
    sweeping: bool,
    queued_turns: usize,
    queued_digests: usize,
    queued_bytes: usize,
    closed: bool,
    writer_exited: bool,
}

impl Queue {
    fn new(limits: JournalLimits) -> Self {
        Self {
            limits,
            slots: HashMap::new(),
            sweeps: Vec::new(),
            writing: None,
            sweeping: false,
            queued_turns: 0,
            queued_digests: 0,
            queued_bytes: 0,
            closed: false,
            writer_exited: false,
        }
    }

    fn take(&mut self, key: &TurnAuthority) -> Option<QueuedSnapshot> {
        let taken = self.slots.get_mut(key)?.latest.take()?;
        if taken.digest {
            self.queued_digests = self.queued_digests.saturating_sub(1);
            return Some(taken);
        }
        self.queued_turns = self.queued_turns.saturating_sub(1);
        self.queued_bytes = self.queued_bytes.saturating_sub(taken.bytes);
        Some(taken)
    }

    fn fits(&self, queued: &QueuedSnapshot) -> bool {
        if queued.digest {
            return self.queued_digests < self.limits.queued_digests;
        }
        self.queued_turns < self.limits.queued_turns
            && self.queued_bytes.saturating_add(queued.bytes) <= self.limits.queued_bytes
    }

    fn offer(&mut self, key: &TurnAuthority, mut queued: QueuedSnapshot) -> Offer {
        let waiting = self.slots.get(key).and_then(|slot| slot.latest.as_ref());
        if waiting.is_some_and(|waiting| waiting.sequence >= queued.sequence) {
            return Offer::Superseded;
        }
        if let Some(replaced) = self.take(key) {
            queued.first_observed_at_epoch_ms = replaced
                .first_observed_at_epoch_ms
                .min(queued.first_observed_at_epoch_ms);
        }
        if !self.fits(&queued) {
            self.drop_idle_slots();
            return Offer::Full(Box::new(queued));
        }
        if queued.digest {
            self.queued_digests += 1;
        }
        if !queued.digest {
            self.queued_turns += 1;
            self.queued_bytes += queued.bytes;
        }
        self.slots.entry(key.clone()).or_default().latest = Some(queued);
        Offer::Queued
    }

    fn take_ready(&mut self, now: Instant) -> Ready {
        let mut earliest: Option<Instant> = None;
        let mut ready: Option<TurnAuthority> = None;
        for (key, slot) in &self.slots {
            let Some(latest) = slot.latest.as_ref().filter(|_| slot.answers_in_flight == 0)
            else {
                continue;
            };
            let Some(not_before) = latest.not_before.filter(|not_before| *not_before > now) else {
                ready = Some(key.clone());
                break;
            };
            earliest = Some(earliest.map_or(not_before, |known| known.min(not_before)));
        }
        if let Some((key, queued)) = ready.and_then(|key| Some((key.clone(), self.take(&key)?))) {
            self.writing = Some(key.clone());
            return Ready::Job(key, Box::new(queued));
        }
        if let Some(scope) = self.sweeps.pop() {
            self.sweeping = true;
            return Ready::Sweep(scope);
        }
        earliest.map_or(Ready::Idle, Ready::NotBefore)
    }

    fn is_settled(&self) -> bool {
        self.writing.is_none()
            && !self.sweeping
            && self.sweeps.is_empty()
            && self.queued_turns == 0
            && self.queued_digests == 0
    }

    fn turn_is_settled(&self, key: &TurnAuthority) -> bool {
        self.writing.as_ref() != Some(key)
            && self.slots.get(key).is_none_or(|slot| slot.latest.is_none())
    }

    fn has_work_of(&self, key: &TurnKey) -> bool {
        self.turns_with_work().any(|turn| &turn.key == key)
    }

    fn turns_with_work(&self) -> impl Iterator<Item = &TurnAuthority> {
        self.writing.iter().chain(self.slots.keys())
    }

    fn enqueue(&mut self, key: &TurnAuthority, queued: QueuedSnapshot) -> Enqueued {
        let rejected = match self.offer(key, queued) {
            Offer::Queued => return Enqueued::Queued,
            Offer::Superseded => return Enqueued::Superseded,
            Offer::Full(rejected) => *rejected,
        };
        if rejected.digest {
            return Enqueued::Dropped;
        }
        match self.offer(key, rejected.into_digest()) {
            Offer::Queued => Enqueued::Digested,
            Offer::Superseded => Enqueued::Superseded,
            Offer::Full(_) => Enqueued::Dropped,
        }
    }

    fn drop_idle_slots(&mut self) {
        self.slots.retain(|_, slot| !slot.is_idle());
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Enqueued {
    Queued,
    Superseded,
    Digested,
    Dropped,
}

struct Shared {
    limits: JournalLimits,
    store: Arc<dyn RuntimeRequestStore>,
    tracker: TurnTracker,
    run_id: String,
    clock: JournalClock,
    queue: Mutex<Queue>,
    work: Condvar,
    settled: Condvar,
    ledger: Mutex<JournalLedger>,
}

struct WriterExit<'a>(&'a Shared);

impl Drop for WriterExit<'_> {
    fn drop(&mut self) {
        self.0.queue().writer_exited = true;
        self.0.settled.notify_all();
    }
}

impl Shared {
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn ledger(&self) -> MutexGuard<'_, JournalLedger> {
        self.ledger.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn claim(&self, scope: &HistoryScope) -> Result<(), StoreError> {
        let claim = self
            .store
            .claim_root(scope, &self.run_id, (self.clock)())?;
        if claim == RootClaim::HeldByAnotherInstance {
            return Err(StoreError::new(
                StoreErrorKind::HeldByAnotherInstance,
                "another running instance owns the request journal of this project",
            ));
        }
        Ok(())
    }

    fn retry_of(&self, mut failed: QueuedSnapshot, error: &StoreError) -> Option<QueuedSnapshot> {
        let retryable = matches!(
            error.kind,
            StoreErrorKind::Busy | StoreErrorKind::Full | StoreErrorKind::Unavailable
        );
        failed.attempts += 1;
        if !retryable || failed.attempts >= self.limits.write_attempts {
            return None;
        }
        failed.not_before =
            Some(Instant::now() + self.limits.retry_backoff * failed.attempts);
        Some(failed)
    }

    fn write(&self, key: &TurnAuthority, queued: QueuedSnapshot) -> Option<QueuedSnapshot> {
        if let Err(error) = self.claim(&key.scope) {
            self.ledger().write_failed(key, &error, queued.sequence);
            return self.retry_of(queued, &error);
        }
        let QueuedSnapshot {
            content,
            sequence,
            bytes,
            digest,
            first_observed_at_epoch_ms,
            observed_at_epoch_ms,
            attempts,
            ..
        } = queued;
        let observation = TurnObservation {
            key: key.key.clone(),
            incarnation: key.incarnation,
            first_observed_at_epoch_ms,
            observed_at_epoch_ms,
            turn: content.into_observed(),
        };
        let applied = self
            .store
            .apply_snapshot(&key.scope, &self.run_id, &observation);
        let error = match applied {
            Ok(report) => {
                self.ledger()
                    .snapshot_applied(key, &report, &observation.turn);
                return None;
            }
            Err(error) => error,
        };
        self.ledger().write_failed(key, &error, sequence);
        let failed = QueuedSnapshot {
            content: SnapshotContent::Observed(observation.turn),
            sequence,
            bytes,
            digest,
            first_observed_at_epoch_ms,
            observed_at_epoch_ms,
            attempts,
            not_before: None,
        };
        self.retry_of(failed, &error)
    }

    fn enqueue_known(&self, key: &TurnAuthority, queued: QueuedSnapshot) -> Option<Enqueued> {
        let mut queue = self.queue();
        if !self.tracker.is_known(key) {
            return None;
        }
        Some(queue.enqueue(key, queued))
    }

    fn turns_to_retain(&self, scope: &HistoryScope) -> Vec<TurnKey> {
        let queue = self.queue();
        let mut retained = self.tracker.known_turns(scope);
        let working = queue
            .turns_with_work()
            .filter(|turn| &turn.scope == scope)
            .map(|turn| turn.key.clone());
        retained.extend(working);
        retained
    }

    fn sweep(&self, scope: &HistoryScope) {
        if self.claim(scope).is_err() {
            return;
        }
        let retained = self.turns_to_retain(scope);
        let _ = self
            .store
            .retain_turn_states(scope, &self.run_id, &retained);
    }

    fn next_work(&self) -> Option<Ready> {
        let mut queue = self.queue();
        loop {
            if queue.closed {
                return None;
            }
            let now = Instant::now();
            match queue.take_ready(now) {
                Ready::NotBefore(not_before) => {
                    queue = self
                        .work
                        .wait_timeout(queue, not_before.saturating_duration_since(now))
                        .unwrap_or_else(PoisonError::into_inner)
                        .0;
                }
                Ready::Idle => {
                    queue = self
                        .work
                        .wait(queue)
                        .unwrap_or_else(PoisonError::into_inner);
                }
                work => return Some(work),
            }
        }
    }

    fn write_job(&self, key: TurnAuthority, queued: QueuedSnapshot) {
        let sequence = queued.sequence;
        let written = catch_unwind(AssertUnwindSafe(|| self.write(&key, queued)));
        let retry = written.unwrap_or_else(|_| {
            self.ledger().writer_panicked(&key, sequence);
            None
        });
        let retried = {
            let mut queue = self.queue();
            let retried = retry.is_some_and(|retry| {
                matches!(
                    queue.enqueue(&key, retry),
                    Enqueued::Queued | Enqueued::Digested
                )
            });
            queue.writing = None;
            queue.drop_idle_slots();
            retried
        };
        if retried {
            self.ledger().write_retried();
        }
    }

    fn run_writer(&self) {
        let _exit = WriterExit(self);
        while let Some(work) = self.next_work() {
            match work {
                Ready::Job(key, queued) => self.write_job(key, *queued),
                Ready::Sweep(scope) => {
                    let _ = catch_unwind(AssertUnwindSafe(|| self.sweep(&scope)));
                    self.queue().sweeping = false;
                }
                Ready::NotBefore(_) | Ready::Idle => {}
            }
            self.settled.notify_all();
        }
    }
}

pub struct TurnTracking {
    shared: Arc<Shared>,
    turn: TurnAuthority,
}

impl TurnTracking {
    pub fn authority(&self) -> &TurnAuthority {
        &self.turn
    }

    pub fn task_scope(&self) -> AgentTaskHistoryScope {
        self.turn.task_scope()
    }
}

impl Drop for TurnTracking {
    fn drop(&mut self) {
        let forgotten_roots = self.shared.tracker.retire(&self.turn);
        if forgotten_roots.is_empty() {
            return;
        }
        {
            let mut queue = self.shared.queue();
            for scope in forgotten_roots {
                if !queue.sweeps.contains(&scope) {
                    queue.sweeps.push(scope);
                }
            }
        }
        self.shared.work.notify_all();
    }
}

struct AnswerHold {
    shared: Arc<Shared>,
    key: TurnAuthority,
}

impl AnswerHold {
    fn acquire(
        shared: &Arc<Shared>,
        key: &TurnAuthority,
        deadline: Instant,
    ) -> Option<(Self, bool)> {
        let mut queue = shared.queue();
        let mut drained = queue.turn_is_settled(key);
        while !drained {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            queue = shared
                .settled
                .wait_timeout(queue, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            drained = queue.turn_is_settled(key);
        }
        if !shared.tracker.is_known(key) {
            return None;
        }
        queue
            .slots
            .entry(key.clone())
            .or_default()
            .answers_in_flight += 1;
        let hold = Self {
            shared: Arc::clone(shared),
            key: key.clone(),
        };
        Some((hold, drained))
    }
}

impl Drop for AnswerHold {
    fn drop(&mut self) {
        {
            let mut queue = self.shared.queue();
            if let Some(slot) = queue.slots.get_mut(&self.key) {
                slot.answers_in_flight = slot.answers_in_flight.saturating_sub(1);
            }
            queue.drop_idle_slots();
        }
        self.shared.work.notify_all();
        self.shared.settled.notify_all();
    }
}

pub struct AnswerTarget {
    pub task_scope: Option<AgentTaskHistoryScope>,
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub resolution: RequestResolution,
}

struct RecordedIntent {
    request_id: String,
    version: u64,
}

enum AttemptState {
    Recorded(RecordedIntent),
    UnsavedIfDelivered { since_sequence: u64 },
    NothingToSave,
}

pub struct AnswerAttempt {
    shared: Arc<Shared>,
    key: TurnAuthority,
    state: AttemptState,
    _hold: Option<AnswerHold>,
}

impl AnswerAttempt {
    pub fn is_recorded(&self) -> bool {
        matches!(self.state, AttemptState::Recorded(_))
    }

    pub fn delivered(self) {
        let AttemptState::UnsavedIfDelivered { since_sequence } = self.state else {
            return;
        };
        self.shared
            .ledger()
            .answer_unsaved(&self.key, since_sequence);
    }

    pub fn settle(self, settlement: IntentSettlement, version: u64) {
        let AttemptState::Recorded(recorded) = &self.state else {
            return;
        };
        let settle = IntentSettle {
            key: self.key.key.clone(),
            incarnation: self.key.incarnation,
            request_id: recorded.request_id.clone(),
            intent_version: recorded.version,
            settlement,
            version,
            at_epoch_ms: (self.shared.clock)(),
        };
        let settled = self.shared.store.settle_intent(
            &self.key.scope,
            &self.shared.run_id,
            &settle,
            Instant::now() + self.shared.limits.answer_budget,
        );
        if let Err(error) = settled {
            self.shared.ledger().write_failed(&self.key, &error, version);
        }
    }
}

pub struct RuntimeRequestJournal {
    shared: Arc<Shared>,
    writer: Mutex<Option<JoinHandle<()>>>,
}

impl RuntimeRequestJournal {
    pub fn start(store: Arc<dyn RuntimeRequestStore>, run_id: String, clock: JournalClock) -> Self {
        Self::start_with_limits(store, run_id, clock, JournalLimits::default())
    }

    pub fn start_with_limits(
        store: Arc<dyn RuntimeRequestStore>,
        run_id: String,
        clock: JournalClock,
        limits: JournalLimits,
    ) -> Self {
        let shared = Arc::new(Shared {
            limits,
            store,
            tracker: TurnTracker::with_retired_capacity(limits.retired_turns),
            run_id,
            clock,
            queue: Mutex::new(Queue::new(limits)),
            work: Condvar::new(),
            settled: Condvar::new(),
            ledger: Mutex::default(),
        });
        let writer_shared = Arc::clone(&shared);
        let writer = std::thread::Builder::new()
            .name("agent-request-journal".into())
            .spawn(move || writer_shared.run_writer())
            .ok();
        if writer.is_none() {
            {
                let mut queue = shared.queue();
                queue.closed = true;
                queue.writer_exited = true;
            }
            shared.ledger().writer_unavailable();
        }
        Self {
            shared,
            writer: Mutex::new(writer),
        }
    }

    pub fn run_id(&self) -> &str {
        &self.shared.run_id
    }

    pub fn track_turn(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<TurnTracking, TurnIdentityConflict> {
        let key = TurnKey {
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
        };
        let turn = {
            let queue = self.shared.queue();
            if queue.has_work_of(&key) {
                return Err(TurnIdentityConflict);
            }
            self.shared.tracker.track(scope, key)?
        };
        Ok(TurnTracking {
            shared: Arc::clone(&self.shared),
            turn,
        })
    }

    pub fn forget_refused_start(&self, turn: &TurnAuthority) {
        self.shared.tracker.forget(turn);
    }

    pub fn observe(
        &self,
        task_scope: Option<&AgentTaskHistoryScope>,
        thread_id: &str,
        snapshot: AgentInteractionSnapshot,
    ) {
        let sequence = snapshot.sequence;
        let Some(task_scope) = task_scope else {
            let unscoped = TurnAuthority::unscoped(thread_id, &snapshot.task_id);
            self.shared.ledger().snapshot_unscoped(&unscoped, sequence);
            return;
        };
        let key = TurnAuthority::of_task(task_scope, thread_id, &snapshot.task_id);
        if self.shared.queue().closed {
            return;
        }
        let observed_at_epoch_ms = (self.shared.clock)();
        let queued = QueuedSnapshot {
            bytes: retained_bytes(&snapshot),
            digest: false,
            content: SnapshotContent::Raw(snapshot),
            sequence,
            first_observed_at_epoch_ms: observed_at_epoch_ms,
            observed_at_epoch_ms,
            attempts: 0,
            not_before: None,
        };
        let Some(enqueued) = self.shared.enqueue_known(&key, queued) else {
            self.shared.ledger().snapshot_late(&key);
            return;
        };
        if matches!(enqueued, Enqueued::Digested | Enqueued::Dropped) {
            self.shared.ledger().snapshot_dropped(&key, sequence);
        }
        self.shared.work.notify_all();
        self.shared.settled.notify_all();
    }

    pub fn begin_answer(
        &self,
        target: AnswerTarget,
        next_version: impl FnOnce() -> u64,
    ) -> AnswerAttempt {
        let Some(task_scope) = target.task_scope.as_ref() else {
            let unscoped = TurnAuthority::unscoped(&target.thread_id, &target.turn_id);
            return self.unjournaled_answer(unscoped);
        };
        let key = TurnAuthority::of_task(task_scope, &target.thread_id, &target.turn_id);
        let deadline = Instant::now() + self.shared.limits.answer_budget;
        let Some((hold, drained)) = AnswerHold::acquire(&self.shared, &key, deadline) else {
            return self.unjournaled_answer(key);
        };
        let version = next_version();
        let timing = IntentTiming {
            version,
            deadline,
            drained,
        };
        let state = self.record(&key, target.request_id, target.resolution, timing);
        AnswerAttempt {
            shared: Arc::clone(&self.shared),
            key,
            state,
            _hold: Some(hold),
        }
    }

    fn unjournaled_answer(&self, key: TurnAuthority) -> AnswerAttempt {
        AnswerAttempt {
            shared: Arc::clone(&self.shared),
            key,
            state: AttemptState::UnsavedIfDelivered {
                since_sequence: UNSCOPED_SINCE_SEQUENCE,
            },
            _hold: None,
        }
    }

    fn record(
        &self,
        key: &TurnAuthority,
        request_id: String,
        resolution: RequestResolution,
        timing: IntentTiming,
    ) -> AttemptState {
        let unsaved = AttemptState::UnsavedIfDelivered {
            since_sequence: timing.version,
        };
        if !timing.drained {
            return unsaved;
        }
        let intent = AnswerIntent {
            key: key.key.clone(),
            incarnation: key.incarnation,
            request_id,
            resolution,
            version: timing.version,
            at_epoch_ms: (self.shared.clock)(),
        };
        let receipt =
            self.shared
                .store
                .record_intent(&key.scope, &self.shared.run_id, &intent, timing.deadline);
        let recorded = AttemptState::Recorded(RecordedIntent {
            request_id: intent.request_id,
            version: timing.version,
        });
        match receipt {
            Ok(IntentReceipt::Recorded) => recorded,
            Ok(IntentReceipt::RecordedWithoutAnswer) => {
                self.shared.ledger().answer_unsaved(key, timing.version);
                recorded
            }
            Ok(IntentReceipt::AlreadyAnswered | IntentReceipt::ThreadDeleted) => {
                AttemptState::NothingToSave
            }
            Ok(IntentReceipt::NotJournaled | IntentReceipt::Refused) => unsaved,
            Err(error) => {
                self.shared
                    .ledger()
                    .write_failed(key, &error, timing.version);
                unsaved
            }
        }
    }

    pub fn read(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        limit: usize,
    ) -> Result<StoredRequests, StoreError> {
        self.shared.claim(scope)?;
        self.shared.store.read(scope, thread_id, limit)
    }

    pub fn flush(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut queue = self.shared.queue();
        loop {
            if queue.is_settled() {
                return true;
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            queue = self
                .shared
                .settled
                .wait_timeout(queue, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    pub fn queued_turns(&self) -> usize {
        self.shared.queue().queued_turns
    }

    pub fn health(&self) -> JournalHealth {
        self.shared.ledger().health()
    }

    pub fn thread_state(&self, thread_id: &str) -> JournalState {
        self.shared.ledger().thread_state(thread_id)
    }

    pub fn thread_failures(&self, thread_id: &str) -> Vec<TurnFailure> {
        self.shared.ledger().thread_failures(thread_id)
    }

    fn writer_exited_by(&self, deadline: Instant) -> bool {
        let mut queue = self.shared.queue();
        while !queue.writer_exited {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            queue = self
                .shared
                .settled
                .wait_timeout(queue, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        true
    }
}

struct IntentTiming {
    version: u64,
    deadline: Instant,
    drained: bool,
}

impl Drop for RuntimeRequestJournal {
    fn drop(&mut self) {
        self.shared.queue().closed = true;
        self.shared.work.notify_all();
        let writer = self
            .writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if !self.writer_exited_by(Instant::now() + JOURNAL_SHUTDOWN_DEADLINE) {
            return;
        }
        if let Some(writer) = writer {
            let _ = writer.join();
        }
    }
}
