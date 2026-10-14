use super::scopes::{HistoryScope, TurnAuthority};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const MAX_ABANDONED_TURNS: usize = 1024;
pub const MAX_RECONCILED_TURNS: usize = 4096;
pub const MAX_UNRECONCILED_TURNS: usize = 4096;
pub const EPOCH_ROTATION_INTERVAL: Duration = Duration::from_secs(30);
pub const ABANDONMENT_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RotationPolicy {
    pub interval: Duration,
    pub grace: Duration,
    pub reconciled: usize,
}

impl Default for RotationPolicy {
    fn default() -> Self {
        Self {
            interval: EPOCH_ROTATION_INTERVAL,
            grace: ABANDONMENT_GRACE,
            reconciled: MAX_RECONCILED_TURNS,
        }
    }
}

#[derive(Clone, Copy)]
struct Need {
    since: Instant,
    revision: u64,
}

#[derive(Default)]
struct Needs {
    turns: HashMap<TurnAuthority, Need>,
    overflowed_since: Option<Instant>,
    requested_since: Option<Instant>,
    last_rotation: Option<Instant>,
    reconciled: HashMap<TurnAuthority, u64>,
    reconciled_order: VecDeque<TurnAuthority>,
    memory_overflowed: bool,
    unreconciled: HashMap<(HistoryScope, String), HashSet<TurnAuthority>>,
    unreconciled_turns: usize,
    unreconciled_everywhere: bool,
}

impl Needs {
    fn oldest(&self) -> Option<Instant> {
        self.turns
            .values()
            .map(|need| need.since)
            .chain(self.overflowed_since)
            .chain(self.requested_since)
            .min()
    }

    fn reconcile(&mut self, turn: TurnAuthority, revision: u64) {
        let known = self.reconciled.entry(turn.clone()).or_insert(0);
        let fresh = *known == 0;
        *known = (*known).max(revision);
        if fresh {
            self.reconciled_order.push_back(turn);
        }
    }

    fn give_up(&mut self, turn: TurnAuthority) {
        if self.unreconciled_everywhere {
            return;
        }
        let thread = (turn.scope.clone(), turn.key.thread_id.clone());
        if !self.unreconciled.entry(thread).or_default().insert(turn) {
            return;
        }
        self.unreconciled_turns += 1;
        if self.unreconciled_turns <= MAX_UNRECONCILED_TURNS {
            return;
        }
        self.unreconciled.clear();
        self.unreconciled_turns = 0;
        self.unreconciled_everywhere = true;
    }

    fn forget_unreconciled(&mut self, turn: &TurnAuthority) {
        let thread = (turn.scope.clone(), turn.key.thread_id.clone());
        let Some(turns) = self.unreconciled.get_mut(&thread) else {
            return;
        };
        if !turns.remove(turn) {
            return;
        }
        self.unreconciled_turns = self.unreconciled_turns.saturating_sub(1);
        if turns.is_empty() {
            self.unreconciled.remove(&thread);
        }
    }
}

#[derive(Default)]
pub struct Abandonment {
    needs: Mutex<Needs>,
}

impl Abandonment {
    fn locked(&self) -> MutexGuard<'_, Needs> {
        self.needs.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn note(&self, turn: &TurnAuthority, revision: u64, now: Instant) {
        let mut needs = self.locked();
        let reconciled = needs.reconciled.get(turn).copied();
        if reconciled.is_some_and(|known| known >= revision) {
            return;
        }
        if needs.memory_overflowed && reconciled.is_none() {
            needs.give_up(turn.clone());
            return;
        }
        if let Some(need) = needs.turns.get_mut(turn) {
            need.revision = need.revision.max(revision);
            return;
        }
        if needs.turns.len() >= MAX_ABANDONED_TURNS {
            needs.overflowed_since.get_or_insert(now);
            return;
        }
        needs.turns.insert(turn.clone(), Need { since: now, revision });
    }

    pub fn request(&self, now: Instant) {
        self.locked().requested_since.get_or_insert(now);
    }

    pub fn settle(&self, turn: &TurnAuthority) {
        let mut needs = self.locked();
        needs.turns.remove(turn);
        needs.forget_unreconciled(turn);
        if needs.reconciled.remove(turn).is_some() {
            needs.reconciled_order.retain(|known| known != turn);
        }
    }

    pub fn noted(&self) -> Vec<TurnAuthority> {
        let needs = self.locked();
        let unreconciled = needs.unreconciled.values().flatten();
        needs.turns.keys().chain(unreconciled).cloned().collect()
    }

    pub fn lost_history(&self, scope: &HistoryScope, thread_id: &str) -> bool {
        let needs = self.locked();
        needs.unreconciled_everywhere
            || needs
                .unreconciled
                .contains_key(&(scope.clone(), thread_id.to_string()))
    }

    pub fn due_at(&self, policy: RotationPolicy) -> Option<Instant> {
        let needs = self.locked();
        let ripe = needs.oldest()? + policy.grace;
        let allowed = needs
            .last_rotation
            .map_or(ripe, |last| last + policy.interval);
        Some(ripe.max(allowed))
    }

    pub fn rotated(&self, now: Instant, policy: RotationPolicy) {
        let mut needs = self.locked();
        let rotated: Vec<(TurnAuthority, Need)> = needs.turns.drain().collect();
        for (turn, need) in rotated {
            needs.reconcile(turn, need.revision);
        }
        needs.overflowed_since = None;
        needs.requested_since = None;
        needs.last_rotation = Some(now);
        while needs.reconciled_order.len() > policy.reconciled {
            let Some(oldest) = needs.reconciled_order.pop_front() else {
                break;
            };
            needs.reconciled.remove(&oldest);
            needs.memory_overflowed = true;
            needs.give_up(oldest);
        }
    }

    pub fn pending(&self) -> usize {
        self.locked().turns.len()
    }

    pub fn reconciled(&self) -> usize {
        self.locked().reconciled.len()
    }

    pub fn unreconciled(&self) -> usize {
        self.locked().unreconciled_turns
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime_requests::store::TurnKey;

    fn scope() -> HistoryScope {
        HistoryScope {
            root_key: "/a".to_string(),
            owner_id: "agent-root:/a".to_string(),
        }
    }

    fn turn(thread_id: &str, turn_id: &str) -> TurnAuthority {
        TurnAuthority {
            scope: scope(),
            key: TurnKey {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
            },
            incarnation: 1,
        }
    }

    fn policy(reconciled: usize) -> RotationPolicy {
        RotationPolicy {
            reconciled,
            ..RotationPolicy::default()
        }
    }

    #[test]
    fn turn_forgotten_after_overflow_marks_its_thread_until_it_is_settled() {
        let abandonment = Abandonment::default();
        let (forgotten, kept) = (turn("thread-1", "turn-1"), turn("thread-2", "turn-2"));
        let now = Instant::now();
        abandonment.note(&forgotten, 3, now);
        abandonment.rotated(now, policy(1));
        abandonment.note(&kept, 4, now);
        abandonment.rotated(now, policy(1));

        assert!(abandonment.lost_history(&scope(), "thread-1"));
        assert!(!abandonment.lost_history(&scope(), "thread-2"));
        abandonment.note(&forgotten, 3, now);
        abandonment.note(&turn("thread-3", "turn-3"), 5, now);
        assert_eq!(abandonment.due_at(policy(1)), None);
        assert!(abandonment.lost_history(&scope(), "thread-3"));
        abandonment.note(&kept, 6, now);
        assert_eq!(abandonment.pending(), 1);
        assert_eq!(abandonment.reconciled(), 1);

        abandonment.settle(&forgotten);
        assert!(!abandonment.lost_history(&scope(), "thread-1"));
        assert_eq!(abandonment.unreconciled(), 1);
    }

    #[test]
    fn beyond_the_unreconciled_bound_every_thread_reports_lost_history() {
        let abandonment = Abandonment::default();
        let now = Instant::now();
        abandonment.note(&turn("thread-0", "turn-0"), 1, now);
        abandonment.rotated(now, policy(0));
        for index in 0..MAX_UNRECONCILED_TURNS {
            abandonment.note(&turn("thread-1", &format!("turn-{index}")), 1, now);
        }

        assert_eq!(abandonment.unreconciled(), 0);
        assert!(abandonment.lost_history(&scope(), "thread-unrelated"));
        assert_eq!(abandonment.due_at(policy(0)), None);
        assert!(abandonment.noted().is_empty());
    }
}
