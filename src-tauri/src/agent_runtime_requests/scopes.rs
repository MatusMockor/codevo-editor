use super::store::TurnKey;
use crate::agent_task_admission::AgentTaskHistoryScope;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub const MAX_RETIRED_TURNS: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct HistoryScope {
    pub root_key: String,
    pub owner_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TurnAuthority {
    pub scope: HistoryScope,
    pub key: TurnKey,
    pub incarnation: u64,
}

impl TurnAuthority {
    pub fn of_task(task: &AgentTaskHistoryScope, thread_id: &str, turn_id: &str) -> Self {
        Self {
            scope: HistoryScope {
                root_key: task.root_key.clone(),
                owner_id: task.owner_id.clone(),
            },
            key: TurnKey {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
            },
            incarnation: task.incarnation,
        }
    }

    pub fn unscoped(thread_id: &str, turn_id: &str) -> Self {
        Self {
            scope: HistoryScope {
                root_key: String::new(),
                owner_id: String::new(),
            },
            key: TurnKey {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
            },
            incarnation: 0,
        }
    }

    pub fn task_scope(&self) -> AgentTaskHistoryScope {
        AgentTaskHistoryScope {
            root_key: self.scope.root_key.clone(),
            owner_id: self.scope.owner_id.clone(),
            incarnation: self.incarnation,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TurnIdentityConflict;

impl fmt::Display for TurnIdentityConflict {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("An earlier agent turn with these identifiers is still journaled.")
    }
}

impl std::error::Error for TurnIdentityConflict {}

#[derive(Default)]
struct Turns {
    live: HashMap<TurnAuthority, u64>,
    retired: HashMap<TurnAuthority, u64>,
    retirement_order: VecDeque<TurnAuthority>,
    issued: u64,
}

impl Turns {
    fn remembers(&self, key: &TurnKey) -> bool {
        self.live
            .keys()
            .chain(self.retired.keys())
            .any(|turn| &turn.key == key)
    }
}

pub struct TurnTracker {
    retired_capacity: usize,
    turns: Mutex<Turns>,
}

impl Default for TurnTracker {
    fn default() -> Self {
        Self::with_retired_capacity(MAX_RETIRED_TURNS)
    }
}

impl TurnTracker {
    pub fn with_retired_capacity(retired_capacity: usize) -> Self {
        Self {
            retired_capacity,
            turns: Mutex::default(),
        }
    }

    fn locked(&self) -> MutexGuard<'_, Turns> {
        self.turns.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn track(
        &self,
        scope: &HistoryScope,
        key: TurnKey,
    ) -> Result<TurnAuthority, TurnIdentityConflict> {
        let mut turns = self.locked();
        if turns.remembers(&key) {
            return Err(TurnIdentityConflict);
        }
        turns.issued += 1;
        let authority = TurnAuthority {
            scope: scope.clone(),
            key,
            incarnation: turns.issued,
        };
        turns.live.insert(authority.clone(), 0);
        Ok(authority)
    }

    pub fn retire(&self, turn: &TurnAuthority) -> Vec<HistoryScope> {
        let mut turns = self.locked();
        let Some(pushed) = turns.live.remove(turn) else {
            return Vec::new();
        };
        turns.retired.insert(turn.clone(), pushed);
        turns.retirement_order.push_back(turn.clone());
        let mut forgotten_roots = Vec::new();
        while turns.retired.len() > self.retired_capacity {
            let Some(oldest) = turns.retirement_order.pop_front() else {
                break;
            };
            turns.retired.remove(&oldest);
            if !forgotten_roots.contains(&oldest.scope) {
                forgotten_roots.push(oldest.scope);
            }
        }
        forgotten_roots
    }

    pub fn forget(&self, turn: &TurnAuthority) {
        let mut turns = self.locked();
        turns.live.remove(turn);
        if turns.retired.remove(turn).is_some() {
            turns.retirement_order.retain(|candidate| candidate != turn);
        }
    }

    pub fn is_live(&self, turn: &TurnAuthority) -> bool {
        self.locked().live.contains_key(turn)
    }

    pub fn is_known(&self, turn: &TurnAuthority) -> bool {
        let turns = self.locked();
        turns.live.contains_key(turn) || turns.retired.contains_key(turn)
    }

    pub fn has_successor(&self, turn: &TurnAuthority) -> bool {
        let turns = self.locked();
        turns
            .live
            .keys()
            .chain(turns.retired.keys())
            .any(|known| {
                known.scope == turn.scope
                    && known.key == turn.key
                    && known.incarnation > turn.incarnation
            })
    }

    pub fn pushed_through(&self, turn: &TurnAuthority) -> Option<u64> {
        let turns = self.locked();
        turns
            .live
            .get(turn)
            .or_else(|| turns.retired.get(turn))
            .copied()
    }

    pub fn mark_pushed(&self, turn: &TurnAuthority, version: u64) {
        let mut turns = self.locked();
        let known = match turns.live.get_mut(turn) {
            Some(known) => Some(known),
            None => turns.retired.get_mut(turn),
        };
        if let Some(known) = known {
            *known = (*known).max(version);
        }
    }

    pub fn known_turns(&self, scope: &HistoryScope) -> Vec<TurnKey> {
        let turns = self.locked();
        turns
            .live
            .keys()
            .chain(turns.retired.keys())
            .filter(|turn| &turn.scope == scope)
            .map(|turn| turn.key.clone())
            .collect()
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

    fn key(turn_id: &str) -> TurnKey {
        TurnKey {
            thread_id: "thread".to_string(),
            turn_id: turn_id.to_string(),
        }
    }

    #[test]
    fn live_turn_is_never_forgotten_and_retired_turns_are_bounded() {
        let tracker = TurnTracker::with_retired_capacity(2);
        let live = tracker.track(&scope("/a"), key("live")).expect("live turn");
        let mut finished = Vec::new();
        let mut forgotten = Vec::new();
        for index in 0..5 {
            let turn = tracker
                .track(&scope("/a"), key(&format!("turn-{index}")))
                .expect("finished turn");
            forgotten.extend(tracker.retire(&turn));
            finished.push(turn);
        }

        assert_eq!(forgotten.len(), 3);
        assert!(forgotten.iter().all(|root| root == &scope("/a")));
        assert!(tracker.is_known(&live));
        assert!(!tracker.is_known(&finished[2]));
        assert!(tracker.is_known(&finished[3]));
        assert!(tracker.is_known(&finished[4]));
        let mut known: Vec<String> = tracker
            .known_turns(&scope("/a"))
            .into_iter()
            .map(|key| key.turn_id)
            .collect();
        known.sort();
        assert_eq!(known, ["live", "turn-3", "turn-4"]);
        assert!(tracker.known_turns(&scope("/b")).is_empty());
    }

    #[test]
    fn identifiers_of_a_remembered_turn_are_refused_under_any_root() {
        let tracker = TurnTracker::default();
        let first = tracker.track(&scope("/a"), key("turn")).expect("first");

        assert_eq!(
            tracker.track(&scope("/a"), key("turn")),
            Err(TurnIdentityConflict)
        );
        assert_eq!(
            tracker.track(&scope("/b"), key("turn")),
            Err(TurnIdentityConflict)
        );
        tracker.retire(&first);
        assert_eq!(
            tracker.track(&scope("/b"), key("turn")),
            Err(TurnIdentityConflict)
        );
        assert!(tracker.is_known(&first));
        assert!(tracker.track(&scope("/b"), key("other")).is_ok());
    }

    #[test]
    fn turn_whose_start_was_refused_is_forgotten_and_its_identifiers_are_free_again() {
        let tracker = TurnTracker::default();
        let refused = tracker.track(&scope("/a"), key("turn")).expect("refused");
        tracker.retire(&refused);

        tracker.forget(&refused);

        assert!(!tracker.is_known(&refused));
        let retried = tracker.track(&scope("/a"), key("turn")).expect("retried");
        assert!(retried.incarnation > refused.incarnation);
        tracker.forget(&retried);
        assert!(tracker.known_turns(&scope("/a")).is_empty());
    }

    #[test]
    fn identifiers_reused_after_the_turn_is_forgotten_get_a_new_incarnation() {
        let tracker = TurnTracker::with_retired_capacity(0);
        let first = tracker.track(&scope("/a"), key("turn")).expect("first");
        assert_eq!(tracker.retire(&first), [scope("/a")]);
        assert!(tracker.retire(&first).is_empty());

        let second = tracker.track(&scope("/a"), key("turn")).expect("second");

        assert!(second.incarnation > first.incarnation);
        assert_eq!(second.key, first.key);
        assert!(!tracker.is_known(&first));
        assert!(tracker.is_known(&second));
        assert_eq!(second.task_scope().incarnation, second.incarnation);
        assert_eq!(
            TurnAuthority::of_task(&second.task_scope(), "thread", "turn"),
            second
        );
    }
}
