use super::scopes::HistoryScope;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const MAX_UNSERVED_SCOPES: usize = 64;
pub const MAX_UNSERVED_THREADS: usize = 256;
pub const UNSERVED_PROBE_INTERVAL: Duration = Duration::from_secs(5);

struct Unserved {
    threads: Vec<String>,
    overflowed: bool,
    probed_at: Instant,
    failed_at: u64,
}

#[derive(Default)]
struct Scopes {
    entries: HashMap<HistoryScope, Unserved>,
    sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadMark(u64);

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Healed {
    pub threads: Vec<String>,
    pub rotate: bool,
}

#[derive(Default)]
pub struct UnservedScopes {
    scopes: Mutex<Scopes>,
}

impl UnservedScopes {
    fn locked(&self) -> MutexGuard<'_, Scopes> {
        self.scopes.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn mark(&self) -> ReadMark {
        ReadMark(self.locked().sequence)
    }

    pub fn failed(&self, scope: &HistoryScope, thread_id: &str, now: Instant) -> bool {
        let mut scopes = self.locked();
        scopes.sequence += 1;
        let failed_at = scopes.sequence;
        let entries = &mut scopes.entries;
        let evicted = !entries.contains_key(scope) && entries.len() >= MAX_UNSERVED_SCOPES;
        if evicted {
            let victim = entries.keys().next().cloned();
            if let Some(victim) = victim {
                entries.remove(&victim);
            }
        }
        let entry = entries.entry(scope.clone()).or_insert_with(|| Unserved {
            threads: Vec::new(),
            overflowed: false,
            probed_at: now,
            failed_at,
        });
        entry.probed_at = now;
        entry.failed_at = failed_at;
        if entry.threads.iter().any(|known| known == thread_id) {
            return evicted;
        }
        if entry.threads.len() >= MAX_UNSERVED_THREADS {
            entry.overflowed = true;
            return evicted;
        }
        entry.threads.push(thread_id.to_string());
        evicted
    }

    pub fn served(&self, scope: &HistoryScope, mark: ReadMark) -> Option<Healed> {
        let mut scopes = self.locked();
        let failed_since = scopes.entries.get(scope)?.failed_at > mark.0;
        if failed_since {
            return None;
        }
        let healed = scopes.entries.remove(scope)?;
        Some(Healed {
            threads: healed.threads,
            rotate: healed.overflowed,
        })
    }

    pub fn degraded(&self, scope: &HistoryScope) -> bool {
        self.locked().entries.contains_key(scope)
    }

    pub fn due_probe(&self, now: Instant, interval: Duration) -> Option<(HistoryScope, String)> {
        let mut scopes = self.locked();
        let (scope, entry) = scopes
            .entries
            .iter_mut()
            .filter(|(_, entry)| entry.probed_at + interval <= now)
            .min_by_key(|(_, entry)| entry.probed_at)?;
        entry.probed_at = now;
        let thread_id = entry.threads.first()?.clone();
        Some((scope.clone(), thread_id))
    }

    pub fn next_probe_in(&self, now: Instant, interval: Duration) -> Duration {
        self.locked()
            .entries
            .values()
            .map(|entry| (entry.probed_at + interval).saturating_duration_since(now))
            .min()
            .unwrap_or(interval)
            .min(interval)
    }

    pub fn failing(&self) -> usize {
        self.locked().entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(root: &str) -> HistoryScope {
        HistoryScope {
            root_key: root.to_string(),
            owner_id: format!("agent-root:{root}"),
        }
    }

    #[test]
    fn read_that_began_before_a_later_failure_never_clears_it() {
        let unserved = UnservedScopes::default();
        let now = Instant::now();
        unserved.failed(&scope("/a"), "thread-1", now);
        let early = unserved.mark();
        unserved.failed(&scope("/a"), "thread-2", now);

        assert_eq!(unserved.served(&scope("/a"), early), None);
        assert!(unserved.degraded(&scope("/a")));
        let healed = unserved.served(&scope("/a"), unserved.mark());
        assert_eq!(
            healed,
            Some(Healed {
                threads: vec!["thread-1".to_string(), "thread-2".to_string()],
                rotate: false,
            })
        );
        assert!(!unserved.degraded(&scope("/a")));
        assert_eq!(unserved.served(&scope("/a"), unserved.mark()), None);
    }

    #[test]
    fn overflowing_threads_or_scopes_falls_back_to_a_rotation() {
        let unserved = UnservedScopes::default();
        let now = Instant::now();
        for index in 0..=MAX_UNSERVED_THREADS {
            assert!(!unserved.failed(&scope("/a"), &format!("thread-{index}"), now));
        }
        let healed = unserved.served(&scope("/a"), unserved.mark()).expect("healed");
        assert_eq!(healed.threads.len(), MAX_UNSERVED_THREADS);
        assert!(healed.rotate);

        for index in 0..MAX_UNSERVED_SCOPES {
            assert!(!unserved.failed(&scope(&format!("/{index}")), "thread", now));
        }
        assert!(unserved.failed(&scope("/beyond"), "thread", now));
        assert_eq!(unserved.failing(), MAX_UNSERVED_SCOPES);
        assert!(unserved.degraded(&scope("/beyond")));
    }

    #[test]
    fn each_failing_scope_is_probed_at_most_once_per_interval() {
        let unserved = UnservedScopes::default();
        let start = Instant::now();
        let interval = Duration::from_secs(5);
        unserved.failed(&scope("/a"), "thread-1", start);

        assert_eq!(unserved.due_probe(start, interval), None);
        let due = start + interval;
        assert_eq!(
            unserved.due_probe(due, interval),
            Some((scope("/a"), "thread-1".to_string()))
        );
        assert_eq!(unserved.due_probe(due, interval), None);
    }
}
