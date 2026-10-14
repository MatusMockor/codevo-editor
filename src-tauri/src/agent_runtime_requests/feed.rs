use super::abandonment::RotationPolicy;
use super::journal::{RuntimeRequestJournal, TurnChangeObserver};
use super::model::{JournalState, ThreadRequests};
use super::probe::ProbeWorker;
use super::projection::{ProjectionLimits, RequestProjection, TurnUpdate};
use super::scopes::{HistoryScope, TurnAuthority};
use super::store::ThreadSummary;
use super::unserved::UNSERVED_PROBE_INTERVAL;
use std::collections::{HashMap, VecDeque};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const MAX_FEED_TURNS: usize = 2048;
pub const MAX_FEED_THREADS: usize = 1024;
pub const MAX_FEED_RESETS: usize = 4096;

pub trait ThreadRequestsSink: Send + Sync {
    fn publish(&self, message: ThreadRequests);

    fn invalidate(&self, epoch: &str);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ThreadFlags {
    journal: JournalState,
    truncated: bool,
    unreadable: u64,
}

impl ThreadFlags {
    const CLEAN: Self = Self {
        journal: JournalState::Saved,
        truncated: false,
        unreadable: 0,
    };
}

type ThreadKey = (HistoryScope, String);

fn thread_key(turn: &TurnAuthority) -> ThreadKey {
    (turn.scope.clone(), turn.key.thread_id.clone())
}

struct ThreadMemory {
    workspace_id: String,
    flags: Option<ThreadFlags>,
}

pub const FEED_IDLE_POLL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy)]
pub struct FeedLimits {
    pub turns: usize,
    pub threads: usize,
    pub resets: usize,
    pub rotation: RotationPolicy,
    pub probe: Duration,
}

impl Default for FeedLimits {
    fn default() -> Self {
        Self {
            turns: MAX_FEED_TURNS,
            threads: MAX_FEED_THREADS,
            resets: MAX_FEED_RESETS,
            rotation: RotationPolicy::default(),
            probe: UNSERVED_PROBE_INTERVAL,
        }
    }
}

#[derive(Clone, Default)]
struct Hint {
    workspace_id: Option<String>,
    pushed_through: Option<u64>,
}

#[derive(Clone)]
struct ResetTarget {
    key: ThreadKey,
    workspace_id: Option<String>,
}

#[derive(Default)]
struct FeedState {
    dirty: VecDeque<TurnAuthority>,
    hints: HashMap<TurnAuthority, Hint>,
    threads: HashMap<ThreadKey, ThreadMemory>,
    thread_order: VecDeque<ThreadKey>,
    resets: VecDeque<ResetTarget>,
    reset_all: bool,
    emitting: bool,
    closed: bool,
}

impl FeedState {
    fn remember(&mut self, key: &ThreadKey, workspace_id: &str, limits: FeedLimits) {
        if let Some(known) = self.threads.get_mut(key) {
            known.workspace_id = workspace_id.to_string();
            return;
        }
        self.threads.insert(
            key.clone(),
            ThreadMemory {
                workspace_id: workspace_id.to_string(),
                flags: None,
            },
        );
        self.thread_order.push_back(key.clone());
        while self.thread_order.len() > limits.threads {
            let Some(oldest) = self.thread_order.pop_front() else {
                break;
            };
            self.threads.remove(&oldest);
        }
    }

    fn reset(&mut self, key: ThreadKey, workspace_id: Option<String>, limits: FeedLimits) {
        let workspace_id = workspace_id.or_else(|| self.workspace_of(&key));
        if let Some(queued) = self.resets.iter_mut().find(|queued| queued.key == key) {
            queued.workspace_id = queued.workspace_id.take().or(workspace_id);
            return;
        }
        if self.resets.len() >= limits.resets {
            self.reset_all = true;
            return;
        }
        self.resets.push_back(ResetTarget { key, workspace_id });
    }

    fn mark(&mut self, turn: &TurnAuthority, hint: Hint, limits: FeedLimits) {
        let key = thread_key(turn);
        if let Some(workspace_id) = hint.workspace_id.as_deref() {
            self.remember(&key, workspace_id, limits);
        }
        if let Some(known) = self.hints.get_mut(turn) {
            known.workspace_id = hint.workspace_id.or(known.workspace_id.take());
            known.pushed_through = known.pushed_through.or(hint.pushed_through);
            return;
        }
        if self.hints.len() >= limits.turns {
            self.reset(key, hint.workspace_id, limits);
            return;
        }
        self.hints.insert(turn.clone(), hint);
        self.dirty.push_back(turn.clone());
    }

    fn reset_every_known_thread(&mut self) {
        let known: Vec<ThreadKey> = self.thread_order.iter().cloned().collect();
        for key in known {
            if self.resets.iter().any(|queued| queued.key == key) {
                continue;
            }
            let workspace_id = self.workspace_of(&key);
            self.resets.push_back(ResetTarget { key, workspace_id });
        }
        self.reset_all = false;
    }

    fn workspace_of(&self, key: &ThreadKey) -> Option<String> {
        self.threads
            .get(key)
            .map(|known| known.workspace_id.clone())
    }

    fn flags_of(&self, key: &ThreadKey) -> Option<ThreadFlags> {
        self.threads.get(key).and_then(|known| known.flags)
    }
}

enum Next {
    Work(Work),
    Idle,
    Closed,
}

enum Work {
    Invalidate,
    Reset {
        target: ResetTarget,
        flags: Option<ThreadFlags>,
    },
    Turn {
        turn: TurnAuthority,
        hint: Hint,
        flags: Option<ThreadFlags>,
    },
}

impl Work {
    fn key(&self) -> Option<ThreadKey> {
        match self {
            Self::Invalidate => None,
            Self::Reset { target, .. } => Some(target.key.clone()),
            Self::Turn { turn, .. } => Some(thread_key(turn)),
        }
    }
}

struct FeedShared {
    limits: FeedLimits,
    state: Mutex<FeedState>,
    wake: Condvar,
    idle: Condvar,
}

impl FeedShared {
    fn locked(&self) -> MutexGuard<'_, FeedState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn next(&self, wait: Duration) -> Next {
        let mut state = self.locked();
        if state.closed {
            return Next::Closed;
        }
        if state.dirty.is_empty() && state.resets.is_empty() && !state.reset_all {
            state = self
                .wake
                .wait_timeout(state, wait)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        if state.closed {
            return Next::Closed;
        }
        if state.reset_all {
            state.reset_every_known_thread();
            state.emitting = true;
            return Next::Work(Work::Invalidate);
        }
        if let Some(target) = state.resets.pop_front() {
            state.emitting = true;
            return Next::Work(Work::Reset {
                flags: state.flags_of(&target.key),
                target,
            });
        }
        let Some(turn) = state.dirty.pop_front() else {
            return Next::Idle;
        };
        let mut hint = state.hints.remove(&turn).unwrap_or_default();
        let key = thread_key(&turn);
        hint.workspace_id = hint.workspace_id.or_else(|| state.workspace_of(&key));
        state.emitting = true;
        Next::Work(Work::Turn {
            flags: state.flags_of(&key),
            turn,
            hint,
        })
    }

    fn finished(&self, key: Option<&ThreadKey>, emitted: Option<(Option<String>, ThreadFlags)>) {
        let mut state = self.locked();
        state.emitting = false;
        let remembered = key.zip(emitted);
        if let Some((key, (workspace_id, flags))) = remembered {
            if let Some(workspace_id) = workspace_id {
                state.remember(key, &workspace_id, self.limits);
            }
            if let Some(known) = state.threads.get_mut(key) {
                known.flags = Some(flags);
            }
        }
        drop(state);
        self.idle.notify_all();
    }
}

fn flags_of(
    projection: &RequestProjection,
    key: &ThreadKey,
    summary: Option<ThreadSummary>,
    known: Option<ThreadFlags>,
) -> ThreadFlags {
    let journal = projection.journal_state(&key.0, &key.1);
    let stored = summary.map(|summary| (summary.incomplete, summary.unreadable));
    let remembered = known.map(|known| (known.truncated, known.unreadable));
    let (truncated, unreadable) = stored.or(remembered).unwrap_or((false, 0));
    ThreadFlags {
        journal,
        truncated,
        unreadable,
    }
}

fn summary_of(flags: ThreadFlags) -> ThreadSummary {
    ThreadSummary {
        deleted: false,
        incomplete: flags.truncated,
        unreadable: flags.unreadable,
    }
}

struct Emitter<'a> {
    projection: &'a RequestProjection,
    journal: &'a RuntimeRequestJournal,
    sink: &'a dyn ThreadRequestsSink,
    rotation: RotationPolicy,
}

impl Emitter<'_> {
    fn reset(
        &self,
        target: &ResetTarget,
        known: Option<ThreadFlags>,
    ) -> Option<(Option<String>, ThreadFlags)> {
        let key = &target.key;
        let flags = flags_of(self.projection, key, None, known);
        let message = self.projection.message(
            &key.0,
            (&key.1, target.workspace_id.clone()),
            Vec::new(),
            summary_of(flags),
            true,
        )?;
        self.sink.publish(message);
        Some((target.workspace_id.clone(), flags))
    }

    fn turn(
        &self,
        turn: &TurnAuthority,
        hint: &Hint,
        known: Option<ThreadFlags>,
    ) -> Option<(Option<String>, ThreadFlags)> {
        let watermark = self
            .journal
            .pushed_through(turn)
            .or(hint.pushed_through)
            .unwrap_or(u64::MAX);
        let update: TurnUpdate = self.projection.turn_update(turn, watermark);
        self.journal.mark_pushed(turn, update.considered_through);
        let key = thread_key(turn);
        let flags = flags_of(self.projection, &key, update.summary, known);
        let workspace_id = update.workspace_id.or(hint.workspace_id.clone());
        let recovered = known.is_some_and(|known| known.journal == JournalState::Degraded)
            && flags.journal == JournalState::Saved;
        let reset = update.overflow || recovered;
        let flagged = flags != known.unwrap_or(ThreadFlags::CLEAN);
        if update.requests.is_empty() && !reset && !flagged {
            return None;
        }
        let message = self.projection.message(
            &turn.scope,
            (&turn.key.thread_id, workspace_id.clone()),
            update.requests,
            summary_of(flags),
            reset,
        )?;
        self.sink.publish(message);
        Some((workspace_id, flags))
    }

    fn emit(&self, work: &Work) -> Option<(Option<String>, ThreadFlags)> {
        match work {
            Work::Invalidate => {
                self.sink.invalidate(&self.journal.rotate_epoch(self.rotation));
                None
            }
            Work::Reset { target, flags } => self.reset(target, *flags),
            Work::Turn { turn, hint, flags } => self.turn(turn, hint, *flags),
        }
    }
}

pub struct RequestFeed {
    shared: Arc<FeedShared>,
    emitter: Mutex<Option<JoinHandle<()>>>,
    _probe: Option<ProbeWorker>,
}

struct FeedObserver(Arc<FeedShared>);

impl TurnChangeObserver for FeedObserver {
    fn turn_changed(
        &self,
        turn: &TurnAuthority,
        workspace_id: Option<&str>,
        pushed_through: Option<u64>,
    ) {
        let hint = Hint {
            workspace_id: workspace_id.map(str::to_string),
            pushed_through,
        };
        self.0.locked().mark(turn, hint, self.0.limits);
        self.0.wake.notify_all();
    }

    fn thread_reset(&self, scope: &HistoryScope, thread_id: &str, workspace_id: &str) {
        let key = (scope.clone(), thread_id.to_string());
        {
            let mut state = self.0.locked();
            state.remember(&key, workspace_id, self.0.limits);
            state.reset(key, Some(workspace_id.to_string()), self.0.limits);
        }
        self.0.wake.notify_all();
    }

    fn thread_readable_again(&self, scope: &HistoryScope, thread_id: &str) {
        let key = (scope.clone(), thread_id.to_string());
        self.0.locked().reset(key, None, self.0.limits);
        self.0.wake.notify_all();
    }
}

fn rotate_when_due(
    shared: &FeedShared,
    journal: &RuntimeRequestJournal,
    sink: &dyn ThreadRequestsSink,
) -> Duration {
    let Some(due) = journal.rotation_due_at(shared.limits.rotation) else {
        return FEED_IDLE_POLL;
    };
    let now = Instant::now();
    if due > now {
        return (due - now).min(FEED_IDLE_POLL);
    }
    let rotated = catch_unwind(AssertUnwindSafe(|| {
        sink.invalidate(&journal.rotate_epoch(shared.limits.rotation));
    }));
    drop(rotated);
    shared.idle.notify_all();
    FEED_IDLE_POLL.min(shared.limits.rotation.grace)
}

fn run(
    shared: &FeedShared,
    journal: &Weak<RuntimeRequestJournal>,
    sink: &dyn ThreadRequestsSink,
    limits: ProjectionLimits,
) {
    while let Some(wait) = journal
        .upgrade()
        .map(|journal| rotate_when_due(shared, &journal, sink))
    {
        let work = match shared.next(wait) {
            Next::Closed => break,
            Next::Idle => continue,
            Next::Work(work) => work,
        };
        let key = work.key();
        let Some(journal) = journal.upgrade() else {
            shared.finished(key.as_ref(), None);
            break;
        };
        let projection = RequestProjection::with_limits(Arc::clone(&journal), limits);
        let emitter = Emitter {
            projection: &projection,
            journal: &journal,
            sink,
            rotation: shared.limits.rotation,
        };
        let emitted = catch_unwind(AssertUnwindSafe(|| emitter.emit(&work)))
            .ok()
            .flatten();
        drop(projection);
        shared.finished(key.as_ref(), emitted);
    }
}

impl RequestFeed {
    pub fn start(journal: &Arc<RuntimeRequestJournal>, sink: Arc<dyn ThreadRequestsSink>) -> Self {
        Self::start_with_limits(
            journal,
            sink,
            FeedLimits::default(),
            ProjectionLimits::default(),
        )
    }

    pub fn start_with_limits(
        journal: &Arc<RuntimeRequestJournal>,
        sink: Arc<dyn ThreadRequestsSink>,
        limits: FeedLimits,
        projection: ProjectionLimits,
    ) -> Self {
        let shared = Arc::new(FeedShared {
            limits,
            state: Mutex::default(),
            wake: Condvar::new(),
            idle: Condvar::new(),
        });
        let observed = journal.observe_changes(Arc::new(FeedObserver(Arc::clone(&shared))));
        let emitter_shared = Arc::clone(&shared);
        let weak = Arc::downgrade(journal);
        let emitter = observed
            .then(|| {
                std::thread::Builder::new()
                    .name("agent-request-feed".into())
                    .spawn(move || run(&emitter_shared, &weak, sink.as_ref(), projection))
                    .ok()
            })
            .flatten();
        let probe = emitter
            .is_some()
            .then(|| ProbeWorker::start(journal, limits.probe, projection))
            .flatten();
        Self {
            shared,
            emitter: Mutex::new(emitter),
            _probe: probe,
        }
    }

    pub fn is_running(&self) -> bool {
        self.emitter
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    pub fn settle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.shared.locked();
        loop {
            let idle = state.dirty.is_empty()
                && state.resets.is_empty()
                && !state.reset_all
                && !state.emitting;
            if idle {
                return true;
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            state = self
                .shared
                .idle
                .wait_timeout(state, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

impl Drop for RequestFeed {
    fn drop(&mut self) {
        self.shared.locked().closed = true;
        self.shared.wake.notify_all();
        self.emitter
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }
}
