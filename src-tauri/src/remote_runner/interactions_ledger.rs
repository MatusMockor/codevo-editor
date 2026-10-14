use super::{
    thread_requests_cache::ThreadRequestCache, thread_requests_evidence::TaskEvidence,
    thread_requests_membership::ConversationIndex,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, PoisonError,
    },
    time::{Duration, Instant},
};

const MAX_TRACKED_TASKS: usize = 256;
pub(super) const LEGACY_PROBE_INTERVAL: Duration = Duration::from_secs(60);
pub(super) const APPROVALS_PROBE_INTERVAL: Duration = Duration::from_secs(60);

static ISSUED_SERIALS: AtomicU64 = AtomicU64::new(0);

pub(super) type ContentDigest = [u8; 32];

struct Stamp {
    digest: ContentDigest,
    sequence: u64,
    touched: u64,
}

#[derive(Default)]
struct Ledger {
    sequence: u64,
    clock: u64,
    tasks: HashMap<String, Stamp>,
    legacy_until: Option<Instant>,
    approvals_missing_until: Option<Instant>,
}

impl Ledger {
    fn evict(&mut self) {
        while self.tasks.len() > MAX_TRACKED_TASKS {
            let oldest = self
                .tasks
                .iter()
                .min_by_key(|(_, stamp)| stamp.touched)
                .map(|(task, _)| task.clone());
            match oldest {
                Some(task) => self.tasks.remove(&task),
                None => return,
            };
        }
    }
}

pub(in crate::remote_runner) struct InteractionLedger {
    serial: u64,
    state: Mutex<Ledger>,
    requests: ThreadRequestCache,
    conversations: ConversationIndex,
    evidence: TaskEvidence,
}

impl Default for InteractionLedger {
    fn default() -> Self {
        Self {
            serial: ISSUED_SERIALS.fetch_add(1, Ordering::Relaxed) + 1,
            state: Mutex::default(),
            requests: ThreadRequestCache::default(),
            conversations: ConversationIndex::default(),
            evidence: TaskEvidence::default(),
        }
    }
}

impl InteractionLedger {
    fn locked(&self) -> MutexGuard<'_, Ledger> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn serial(&self) -> u64 {
        self.serial
    }

    pub(super) fn requests(&self) -> &ThreadRequestCache {
        &self.requests
    }

    pub(super) fn conversations(&self) -> &ConversationIndex {
        &self.conversations
    }

    pub(super) fn evidence(&self) -> &TaskEvidence {
        &self.evidence
    }

    #[cfg(test)]
    pub(super) fn is_unlocked(&self) -> bool {
        self.state.try_lock().is_ok() && self.requests.is_unlocked()
    }

    pub(super) fn stamp(&self, task: &str, digest: ContentDigest) -> u64 {
        let mut ledger = self.locked();
        ledger.clock += 1;
        let touched = ledger.clock;
        if let Some(stamp) = ledger
            .tasks
            .get_mut(task)
            .filter(|stamp| stamp.digest == digest)
        {
            stamp.touched = touched;
            return stamp.sequence;
        }
        ledger.sequence += 1;
        let sequence = ledger.sequence;
        ledger.tasks.insert(
            task.into(),
            Stamp {
                digest,
                sequence,
                touched,
            },
        );
        ledger.evict();
        sequence
    }

    pub(super) fn is_legacy_runner(&self, now: Instant) -> bool {
        self.locked().legacy_until.is_some_and(|until| now < until)
    }

    pub(super) fn remember_legacy_runner(&self, now: Instant) {
        self.locked().legacy_until = Some(now + LEGACY_PROBE_INTERVAL);
    }

    pub(super) fn lacks_approvals(&self, now: Instant) -> bool {
        self.locked()
            .approvals_missing_until
            .is_some_and(|until| now < until)
    }

    pub(super) fn remember_missing_approvals(&self, now: Instant) {
        self.locked().approvals_missing_until = Some(now + APPROVALS_PROBE_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(seed: u8) -> ContentDigest {
        [seed; 32]
    }

    #[test]
    fn sequence_advances_only_when_content_changes_and_never_decreases() {
        let ledger = InteractionLedger::default();
        let first = ledger.stamp("task-a", digest(1));
        assert_eq!(ledger.stamp("task-a", digest(1)), first);
        assert_eq!(ledger.stamp("task-a", digest(1)), first);
        let second = ledger.stamp("task-a", digest(2));
        assert!(second > first);
        let reverted = ledger.stamp("task-a", digest(1));
        assert!(reverted > second);
        let other = ledger.stamp("task-b", digest(1));
        assert!(other > reverted);
        assert_eq!(ledger.stamp("task-a", digest(1)), reverted);
    }

    #[test]
    fn evicted_task_restarts_above_every_issued_sequence() {
        let ledger = InteractionLedger::default();
        let first = ledger.stamp("task-0", digest(7));
        let mut highest = first;
        for index in 1..=MAX_TRACKED_TASKS {
            highest = ledger.stamp(&format!("task-{index}"), digest(7));
        }
        assert_eq!(ledger.locked().tasks.len(), MAX_TRACKED_TASKS);
        assert!(!ledger.locked().tasks.contains_key("task-0"));
        assert!(ledger.stamp("task-0", digest(7)) > highest);
        assert!(highest > first);
    }

    #[test]
    fn recently_read_task_survives_eviction() {
        let ledger = InteractionLedger::default();
        let kept = ledger.stamp("kept", digest(1));
        for index in 0..MAX_TRACKED_TASKS - 1 {
            ledger.stamp(&format!("task-{index}"), digest(1));
        }
        assert_eq!(ledger.stamp("kept", digest(1)), kept);
        ledger.stamp("overflow", digest(1));
        assert_eq!(ledger.stamp("kept", digest(1)), kept);
        assert!(!ledger.locked().tasks.contains_key("task-0"));
    }

    #[test]
    fn legacy_runner_memo_expires_so_an_upgraded_runner_is_probed_again() {
        let ledger = InteractionLedger::default();
        let start = Instant::now();
        assert!(!ledger.is_legacy_runner(start));
        ledger.remember_legacy_runner(start);
        assert!(ledger.is_legacy_runner(start));
        assert!(ledger.is_legacy_runner(start + LEGACY_PROBE_INTERVAL - Duration::from_millis(1)));
        assert!(!ledger.is_legacy_runner(start + LEGACY_PROBE_INTERVAL));
    }

    #[test]
    fn missing_approvals_memo_expires_and_is_independent_of_the_legacy_memo() {
        let ledger = InteractionLedger::default();
        let start = Instant::now();
        assert!(!ledger.lacks_approvals(start));
        ledger.remember_missing_approvals(start);
        assert!(ledger.lacks_approvals(start));
        assert!(!ledger.is_legacy_runner(start));
        assert!(ledger.lacks_approvals(start + APPROVALS_PROBE_INTERVAL - Duration::from_millis(1)));
        assert!(!ledger.lacks_approvals(start + APPROVALS_PROBE_INTERVAL));
        assert_eq!(APPROVALS_PROBE_INTERVAL, Duration::from_secs(60));
    }

    #[test]
    fn every_ledger_carries_its_own_serial_and_request_cache() {
        let first = InteractionLedger::default();
        let second = InteractionLedger::default();
        assert!(first.serial() >= 1);
        assert_ne!(first.serial(), second.serial());
        assert!(!std::ptr::eq(first.requests(), second.requests()));
        assert!(first.is_unlocked());
        let held = first.locked();
        assert!(!first.is_unlocked());
        drop(held);
        assert!(first.is_unlocked());
    }
}
