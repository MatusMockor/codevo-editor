use super::scopes::{HistoryScope, TurnAuthority};
use super::store::TurnKey;
use crate::agent_questions::approvals::AgentApprovalStatus;
use crate::agent_questions::interactions::AgentInteractionSnapshot;
use crate::agent_questions::AgentQuestionStatus;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

pub const MAX_ENDED_TURNS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ListedState {
    Pending,
    Expired,
    Settled(u8),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeenRequest {
    pub first_seen_at_epoch_ms: u64,
    pub changed_at_sequence: u64,
    state: ListedState,
}

#[derive(Clone)]
pub struct LiveTurn {
    pub workspace_id: String,
    pub observed_at_epoch_ms: u64,
    pub ended: bool,
    pub snapshot: Arc<AgentInteractionSnapshot>,
    pub seen: Arc<HashMap<String, SeenRequest>>,
    finished: bool,
    applied_sequence: u64,
}

impl LiveTurn {
    fn is_saved(&self) -> bool {
        self.applied_sequence >= self.snapshot.sequence
    }

    fn is_settled(&self) -> bool {
        self.ended && self.finished && self.is_saved()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnLiveness {
    Live,
    Ended,
    Forgotten,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscardedTurn {
    pub turn: TurnAuthority,
    pub workspace_id: String,
}

#[derive(Default)]
pub struct Observation {
    pub changed: bool,
    pub finished: bool,
    pub revision: Option<u64>,
    pub seen: Option<Arc<HashMap<String, SeenRequest>>>,
    pub discarded: Vec<DiscardedTurn>,
}

struct Turns {
    ended_capacity: usize,
    known: HashMap<TurnAuthority, LiveTurn>,
    ended: VecDeque<TurnAuthority>,
}

fn lists_open(known: &LiveTurn) -> bool {
    known
        .seen
        .values()
        .any(|request| request.state == ListedState::Pending)
}

impl Turns {
    fn discard(&mut self, turn: &TurnAuthority) -> Option<DiscardedTurn> {
        let known = self.known.remove(turn)?;
        if known.is_saved() && !lists_open(&known) {
            return None;
        }
        Some(DiscardedTurn {
            turn: turn.clone(),
            workspace_id: known.workspace_id,
        })
    }

    fn end(&mut self, turn: &TurnAuthority) -> Vec<DiscardedTurn> {
        let Some(known) = self.known.get_mut(turn) else {
            return Vec::new();
        };
        if known.ended {
            return Vec::new();
        }
        known.ended = true;
        self.ended.push_back(turn.clone());
        let mut discarded = Vec::new();
        while self.ended.len() > self.ended_capacity {
            let Some(oldest) = self.ended.pop_front() else {
                break;
            };
            discarded.extend(self.discard(&oldest));
        }
        discarded
    }

    fn drop_settled(&mut self, turn: &TurnAuthority) {
        if !self.known.get(turn).is_some_and(LiveTurn::is_settled) {
            return;
        }
        self.known.remove(turn);
        self.ended.retain(|ended| ended != turn);
    }

    fn latest(&self, scope: &HistoryScope, key: &TurnKey) -> Option<TurnAuthority> {
        self.known
            .keys()
            .filter(|turn| &turn.scope == scope && &turn.key == key)
            .max_by_key(|turn| turn.incarnation)
            .cloned()
    }
}

pub struct LiveTurns {
    turns: Mutex<Turns>,
}

fn question_state(status: &AgentQuestionStatus) -> ListedState {
    match status {
        AgentQuestionStatus::Pending => ListedState::Pending,
        AgentQuestionStatus::Expired => ListedState::Expired,
        AgentQuestionStatus::Answered => ListedState::Settled(1),
        AgentQuestionStatus::Cancelled => ListedState::Settled(2),
    }
}

fn approval_state(status: AgentApprovalStatus) -> ListedState {
    match status {
        AgentApprovalStatus::Pending => ListedState::Pending,
        AgentApprovalStatus::Expired => ListedState::Expired,
        AgentApprovalStatus::Approved => ListedState::Settled(3),
        AgentApprovalStatus::Denied => ListedState::Settled(4),
        AgentApprovalStatus::Cancelled => ListedState::Settled(5),
        AgentApprovalStatus::TimedOut => ListedState::Settled(6),
    }
}

fn listed(snapshot: &AgentInteractionSnapshot) -> Vec<(&str, ListedState)> {
    let questions = snapshot
        .questions
        .iter()
        .map(|request| (request.id.as_str(), question_state(&request.status)));
    let approvals = snapshot
        .approvals
        .iter()
        .map(|request| (request.id.as_str(), approval_state(request.status)));
    questions.chain(approvals).collect()
}

struct Revisions<'a> {
    drawn: Option<u64>,
    draw: &'a dyn Fn() -> u64,
}

impl Revisions<'_> {
    fn fresh(&mut self) -> u64 {
        let draw = self.draw;
        *self.drawn.get_or_insert_with(draw)
    }
}

fn seen_after(
    known: Option<&LiveTurn>,
    snapshot: &AgentInteractionSnapshot,
    at_epoch_ms: u64,
    revisions: &mut Revisions<'_>,
) -> HashMap<String, SeenRequest> {
    let listed = listed(snapshot);
    let ids: HashSet<&str> = listed.iter().map(|(id, _)| *id).collect();
    let mut seen: HashMap<String, SeenRequest> = known
        .map(|known| known.seen.as_ref().clone())
        .unwrap_or_default();
    seen.retain(|id, _| ids.contains(id.as_str()));
    for (id, state) in listed {
        let Some(request) = seen.get_mut(id) else {
            let registered = SeenRequest {
                first_seen_at_epoch_ms: at_epoch_ms,
                changed_at_sequence: revisions.fresh(),
                state,
            };
            seen.insert(id.to_string(), registered);
            continue;
        };
        if request.state == state {
            continue;
        }
        request.changed_at_sequence = revisions.fresh();
        request.state = state;
    }
    seen
}

impl LiveTurns {
    pub fn with_ended_capacity(ended_capacity: usize) -> Self {
        Self {
            turns: Mutex::new(Turns {
                ended_capacity,
                known: HashMap::new(),
                ended: VecDeque::new(),
            }),
        }
    }

    fn locked(&self) -> MutexGuard<'_, Turns> {
        self.turns.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn observe(
        &self,
        turn: &TurnAuthority,
        snapshot: &Arc<AgentInteractionSnapshot>,
        at_epoch_ms: u64,
        liveness: impl FnOnce() -> TurnLiveness,
        draw: &dyn Fn() -> u64,
    ) -> Observation {
        let mut turns = self.locked();
        let liveness = liveness();
        if liveness == TurnLiveness::Forgotten {
            return Observation::default();
        }
        let known = turns.known.get(turn);
        if known.is_some_and(|known| known.snapshot.sequence >= snapshot.sequence) {
            return Observation {
                seen: known.map(|known| Arc::clone(&known.seen)),
                ..Observation::default()
            };
        }
        let mut revisions = Revisions { drawn: None, draw };
        let seen = Arc::new(seen_after(known, snapshot, at_epoch_ms, &mut revisions));
        let changed = revisions.drawn.is_some();
        let was_ended = known.is_some_and(|known| known.ended);
        let applied_sequence = known.map_or(0, |known| known.applied_sequence);
        turns.known.insert(
            turn.clone(),
            LiveTurn {
                workspace_id: snapshot.workspace_id.clone(),
                observed_at_epoch_ms: at_epoch_ms,
                ended: was_ended,
                snapshot: Arc::clone(snapshot),
                seen: Arc::clone(&seen),
                finished: liveness == TurnLiveness::Ended,
                applied_sequence,
            },
        );
        let discarded = match liveness {
            TurnLiveness::Ended => turns.end(turn),
            TurnLiveness::Live | TurnLiveness::Forgotten => Vec::new(),
        };
        Observation {
            changed,
            finished: liveness == TurnLiveness::Ended,
            revision: revisions.drawn,
            seen: Some(seen),
            discarded,
        }
    }

    pub fn end(&self, turn: &TurnAuthority) -> Vec<DiscardedTurn> {
        let mut turns = self.locked();
        let discarded = turns.end(turn);
        turns.drop_settled(turn);
        discarded
    }

    pub fn applied(&self, turn: &TurnAuthority, sequence: u64) {
        let mut turns = self.locked();
        let Some(known) = turns.known.get_mut(turn) else {
            return;
        };
        known.applied_sequence = known.applied_sequence.max(sequence);
        turns.drop_settled(turn);
    }

    pub fn forget(&self, turn: &TurnAuthority) {
        let mut turns = self.locked();
        turns.known.remove(turn);
        turns.ended.retain(|ended| ended != turn);
    }

    pub fn of(&self, turn: &TurnAuthority) -> Option<LiveTurn> {
        self.locked().known.get(turn).cloned()
    }

    pub fn latest(&self, scope: &HistoryScope, key: &TurnKey) -> Option<TurnAuthority> {
        self.locked().latest(scope, key)
    }

    pub fn count(&self) -> usize {
        self.locked().known.len()
    }
}
