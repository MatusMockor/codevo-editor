use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

const MAX_TRACKED_TASKS: usize = 256;
pub(super) const LEGACY_PROBE_INTERVAL: Duration = Duration::from_secs(60);

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

#[derive(Default)]
pub(in crate::remote_runner) struct InteractionLedger(Mutex<Ledger>);

impl InteractionLedger {
    fn locked(&self) -> MutexGuard<'_, Ledger> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
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
}
