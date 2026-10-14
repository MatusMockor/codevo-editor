use super::{
    interactions::{InteractionSource, RemoteInteractions},
    thread_requests_ipc::TurnDescriptor,
    thread_requests_map::holds_open_request,
};
use std::{
    collections::HashMap,
    io,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

pub(super) const MAX_CACHED_TASKS: usize = 128;
pub(super) const MAX_CACHED_BYTES: usize = 8 * 1024 * 1024;
pub(super) const BUMP_INTERVAL: Duration = Duration::from_secs(30);
pub(super) const MAX_REBUILT_THREADS: usize = 256;

struct ByteCount(usize);

impl io::Write for ByteCount {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len());
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Standing {
    pub(super) source: Option<InteractionSource>,
    pub(super) generation: u64,
}

pub(super) struct TurnRead {
    interactions: RemoteInteractions,
    after_end: bool,
    open: bool,
}

impl TurnRead {
    pub(super) fn new(interactions: RemoteInteractions, after_end: bool) -> Self {
        let open = holds_open_request(&interactions);
        Self {
            interactions,
            after_end,
            open,
        }
    }

    pub(super) fn interactions(&self) -> &RemoteInteractions {
        &self.interactions
    }

    fn is_cacheable(&self) -> bool {
        match (self.interactions.source, self.after_end) {
            (InteractionSource::Legacy, false) => false,
            (InteractionSource::Snapshot, false) => true,
            (_, true) => !self.open,
        }
    }

    fn serves(&self, turn: &TurnDescriptor) -> bool {
        if turn.terminal && self.open {
            return false;
        }
        match (self.interactions.source, turn.interaction_sequence) {
            (InteractionSource::Snapshot, Some(requested)) => {
                self.interactions.sequence >= requested
            }
            _ => turn.terminal && self.after_end,
        }
    }

    fn bytes(&self) -> Option<usize> {
        let mut count = ByteCount(0);
        serde_json::to_writer(&mut count, &self.interactions).ok()?;
        Some(count.0)
    }
}

struct Entry {
    read: Arc<TurnRead>,
    bytes: usize,
    touched: u64,
}

struct Entries {
    max_tasks: usize,
    max_bytes: usize,
    clock: u64,
    bytes: usize,
    tasks: HashMap<String, Entry>,
    observed: Option<InteractionSource>,
    generation: u64,
    bump_requested: bool,
    last_bump: Option<Instant>,
    rebuilt: HashMap<String, (String, u64)>,
}

impl Entries {
    fn bump_is_due(&self, now: Instant) -> bool {
        let held = self
            .last_bump
            .is_some_and(|last| now.saturating_duration_since(last) < BUMP_INTERVAL);
        self.bump_requested && !held
    }

    fn standing(&self) -> Standing {
        Standing {
            source: self.observed,
            generation: self.generation,
        }
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn remove(&mut self, task: &str) {
        if let Some(entry) = self.tasks.remove(task) {
            self.bytes -= entry.bytes;
        }
    }

    fn observe(&mut self, source: InteractionSource) {
        if self.observed.is_some_and(|observed| observed != source) {
            self.generation += 1;
            self.bump_requested = false;
        }
        self.observed = Some(source);
        self.tasks
            .retain(|_, entry| entry.read.interactions.source == source);
        self.bytes = self.tasks.values().map(|entry| entry.bytes).sum();
    }

    fn evict(&mut self) {
        while self.tasks.len() > self.max_tasks || self.bytes > self.max_bytes {
            let oldest = self
                .tasks
                .iter()
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(task, _)| task.clone());
            let Some(task) = oldest else {
                return;
            };
            self.remove(&task);
        }
    }
}

pub(in crate::remote_runner) struct ThreadRequestCache(Mutex<Entries>);

impl Default for ThreadRequestCache {
    fn default() -> Self {
        Self::with_limits(MAX_CACHED_TASKS, MAX_CACHED_BYTES)
    }
}

impl ThreadRequestCache {
    pub(super) fn with_limits(max_tasks: usize, max_bytes: usize) -> Self {
        Self(Mutex::new(Entries {
            max_tasks,
            max_bytes,
            clock: 0,
            bytes: 0,
            tasks: HashMap::new(),
            observed: None,
            generation: 0,
            bump_requested: false,
            last_bump: None,
            rebuilt: HashMap::new(),
        }))
    }

    fn locked(&self) -> MutexGuard<'_, Entries> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn serve(&self, turn: &TurnDescriptor) -> Option<Arc<TurnRead>> {
        let mut entries = self.locked();
        let touched = entries.tick();
        let entry = entries
            .tasks
            .get_mut(&turn.turn_id)
            .filter(|entry| entry.read.serves(turn))?;
        entry.touched = touched;
        Some(Arc::clone(&entry.read))
    }

    pub(super) fn retain(&self, read: &Arc<TurnRead>) {
        let bytes = Some(read)
            .filter(|read| read.is_cacheable())
            .and_then(|read| read.bytes());
        let mut entries = self.locked();
        entries.observe(read.interactions.source);
        if entries
            .tasks
            .get(&read.interactions.task_id)
            .is_some_and(|entry| entry.read.interactions.sequence > read.interactions.sequence)
        {
            return;
        }
        entries.remove(&read.interactions.task_id);
        let Some(bytes) = bytes.filter(|bytes| *bytes <= entries.max_bytes) else {
            return;
        };
        let touched = entries.tick();
        entries.bytes += bytes;
        entries.tasks.insert(
            read.interactions.task_id.clone(),
            Entry {
                read: Arc::clone(read),
                bytes,
                touched,
            },
        );
        entries.evict();
    }

    #[cfg(test)]
    pub(super) fn observe(&self, source: InteractionSource) {
        self.locked().observe(source);
    }

    pub(super) fn current(&self) -> Standing {
        self.locked().standing()
    }

    pub(super) fn rebuild(&self, now: Instant) -> Standing {
        let mut entries = self.locked();
        if entries.bump_is_due(now) {
            entries.generation += 1;
            entries.bump_requested = false;
            entries.last_bump = Some(now);
        }
        entries.standing()
    }

    pub(super) fn bump_is_due(&self, now: Instant) -> bool {
        self.locked().bump_is_due(now)
    }

    pub(super) fn mark_rebuilt(&self, thread: &str, epoch: &str) {
        let mut entries = self.locked();
        let touched = entries.tick();
        entries
            .rebuilt
            .insert(thread.to_string(), (epoch.to_string(), touched));
        while entries.rebuilt.len() > MAX_REBUILT_THREADS {
            let oldest = entries
                .rebuilt
                .iter()
                .min_by_key(|(_, (_, touched))| *touched)
                .map(|(thread, _)| thread.clone());
            let Some(oldest) = oldest else {
                return;
            };
            entries.rebuilt.remove(&oldest);
        }
    }

    #[cfg(test)]
    pub(super) fn has_rebuilt(&self, thread: &str) -> bool {
        self.locked().rebuilt.contains_key(thread)
    }

    pub(super) fn was_rebuilt_in(&self, thread: &str, epoch: &str) -> bool {
        self.locked()
            .rebuilt
            .get(thread)
            .is_some_and(|(rebuilt, _)| rebuilt == epoch)
    }

    pub(super) fn request_bump(&self) {
        self.locked().bump_requested = true;
    }

    pub(super) fn forget(&self, task: &str) {
        self.locked().remove(task);
    }

    #[cfg(test)]
    pub(super) fn is_unlocked(&self) -> bool {
        self.0.try_lock().is_ok()
    }

    #[cfg(test)]
    pub(super) fn usage(&self) -> (usize, usize) {
        let entries = self.locked();
        (entries.tasks.len(), entries.bytes)
    }

    #[cfg(test)]
    pub(super) fn holds(&self, task: &str) -> bool {
        self.locked().tasks.contains_key(task)
    }
}

#[cfg(test)]
#[path = "thread_requests_cache_tests.rs"]
mod tests;
