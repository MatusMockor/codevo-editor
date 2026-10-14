use super::live::{LiveTurn, SeenRequest};
use super::model::{
    CloseReason, RequestKind, RequestLifecycle, RequestParts, RequestResolution, RequestStatus,
    RuntimeRequest,
};
use super::observed::{observe_snapshot, ObservedRequest, ObservedState};
use super::store::StoredEntry;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

enum Held<'a> {
    Pending,
    Resolved(&'a RequestResolution),
    Closed(RequestStatus, CloseReason),
    Unknown,
    Absent,
}

pub struct TurnLive {
    pub(super) sequence: u64,
    observed_at_epoch_ms: u64,
    ended: bool,
    pub(super) requests: Vec<ObservedRequest>,
    unknown: HashSet<String>,
    seen: Arc<HashMap<String, SeenRequest>>,
}

impl TurnLive {
    pub fn of(live: &LiveTurn) -> Self {
        let turn = observe_snapshot((*live.snapshot).clone());
        Self {
            sequence: turn.sequence,
            observed_at_epoch_ms: live.observed_at_epoch_ms,
            ended: live.ended,
            unknown: turn.rejected.into_iter().collect(),
            requests: turn.requests,
            seen: Arc::clone(&live.seen),
        }
    }

    fn held(&self, id: &str, kind: RequestKind) -> Held<'_> {
        let listed = self
            .requests
            .iter()
            .find(|request| request.id == id && request.body.kind() == kind);
        let Some(listed) = listed else {
            if self.unknown.contains(id) {
                return Held::Unknown;
            }
            return Held::Absent;
        };
        match &listed.state {
            ObservedState::Pending => Held::Pending,
            ObservedState::Resolved(resolution) => Held::Resolved(resolution),
            ObservedState::Closed { status, reason } => Held::Closed(status.status(), *reason),
        }
    }

    fn changed_at(&self, id: &str) -> u64 {
        self.seen
            .get(id)
            .map_or(self.sequence, |seen| seen.changed_at_sequence)
            .max(1)
    }

    fn first_seen_at(&self, id: &str) -> u64 {
        self.seen
            .get(id)
            .map_or(self.observed_at_epoch_ms, |seen| seen.first_seen_at_epoch_ms)
    }
}

enum Fate<'a> {
    Keep,
    Resolve(&'a RequestResolution),
    Close(RequestStatus, CloseReason),
}

struct Outcome<'a> {
    fate: Fate<'a>,
    version: u64,
    at_epoch_ms: u64,
    abandoned: bool,
}

fn closing(stored: RequestStatus, status: RequestStatus, reason: CloseReason) -> Fate<'static> {
    if stored == RequestStatus::Submitting {
        return Fate::Close(RequestStatus::Expired, CloseReason::AnswerUnconfirmed);
    }
    Fate::Close(status, reason)
}

fn abandoned(stored: RequestStatus) -> Fate<'static> {
    closing(stored, RequestStatus::Expired, CloseReason::TurnEnded)
}

pub(super) struct StoredState<'a> {
    pub(super) id: &'a str,
    pub(super) kind: RequestKind,
    pub(super) status: RequestStatus,
    pub(super) version: u64,
}

fn outcome<'a>(stored: &StoredState<'_>, live: Option<&'a TurnLive>, now: u64) -> Outcome<'a> {
    let kept = |at_epoch_ms: u64| Outcome {
        fate: Fate::Keep,
        version: stored.version,
        at_epoch_ms,
        abandoned: false,
    };
    if stored.status.is_terminal() {
        return kept(now);
    }
    let abandon = |at_epoch_ms: u64| Outcome {
        fate: abandoned(stored.status),
        version: stored.version,
        at_epoch_ms,
        abandoned: true,
    };
    let Some(live) = live else {
        return abandon(now);
    };
    let at = live.observed_at_epoch_ms;
    let changed = |fate: Fate<'a>| Outcome {
        fate,
        version: stored.version.max(live.changed_at(stored.id)),
        at_epoch_ms: at,
        abandoned: false,
    };
    let answering = stored.status == RequestStatus::Submitting;
    match live.held(stored.id, stored.kind) {
        Held::Pending | Held::Unknown if live.ended && !answering => abandon(at),
        Held::Pending | Held::Unknown => kept(at),
        Held::Resolved(resolution) => changed(Fate::Resolve(resolution)),
        Held::Closed(status, reason) => changed(closing(stored.status, status, reason)),
        Held::Absent => abandon(at),
    }
}

pub(super) fn closed_lifecycle(
    status: RequestStatus,
    reason: CloseReason,
    resolved_at_epoch_ms: u64,
    kept: Option<RequestResolution>,
) -> RequestLifecycle {
    match status {
        RequestStatus::Cancelled => RequestLifecycle::Cancelled {
            reason,
            resolved_at_epoch_ms,
        },
        RequestStatus::TimedOut => RequestLifecycle::TimedOut {
            reason,
            resolved_at_epoch_ms,
        },
        _ => RequestLifecycle::Expired {
            reason,
            resolved_at_epoch_ms,
            resolution: kept.filter(|_| reason == CloseReason::AnswerUnconfirmed),
        },
    }
}

pub(super) fn overlaid(stored: RuntimeRequest, live: Option<&TurnLive>, now: u64) -> RuntimeRequest {
    let parts = stored.parts();
    let state = StoredState {
        id: &parts.id,
        kind: parts.body.kind(),
        status: stored.status(),
        version: parts.version,
    };
    let outcome = outcome(&state, live, now);
    let lifecycle = match outcome.fate {
        Fate::Keep => return stored,
        Fate::Resolve(resolution) => RequestLifecycle::Resolved {
            reason: CloseReason::Unknown,
            resolved_at_epoch_ms: outcome.at_epoch_ms,
            resolution: resolution.clone(),
        },
        Fate::Close(status, reason) => closed_lifecycle(
            status,
            reason,
            outcome.at_epoch_ms,
            parts.lifecycle.resolution().cloned(),
        ),
    };
    let version = outcome.version;
    let mut parts = stored.clone().into_parts();
    parts.lifecycle = lifecycle;
    parts.version = version;
    RuntimeRequest::new(parts).unwrap_or(stored)
}

fn abandoned_live(request: &ObservedRequest, live: &TurnLive) -> bool {
    live.ended && request.state == ObservedState::Pending
}

pub(super) fn live_only(
    request: &ObservedRequest,
    turn_id: &str,
    order: u64,
    live: &TurnLive,
) -> Option<RuntimeRequest> {
    let at = live.observed_at_epoch_ms;
    let lifecycle = match &request.state {
        ObservedState::Pending if live.ended => {
            closed_lifecycle(RequestStatus::Expired, CloseReason::TurnEnded, at, None)
        }
        ObservedState::Pending => RequestLifecycle::Pending,
        ObservedState::Resolved(resolution) => RequestLifecycle::Resolved {
            reason: CloseReason::Unknown,
            resolved_at_epoch_ms: at,
            resolution: resolution.clone(),
        },
        ObservedState::Closed { status, reason } => {
            closed_lifecycle(status.status(), *reason, at, None)
        }
    };
    RuntimeRequest::new(RequestParts {
        id: request.id.clone(),
        turn_id: turn_id.to_string(),
        provider: request.provider,
        created_at_epoch_ms: live.first_seen_at(&request.id),
        order,
        version: live.changed_at(&request.id),
        anchor_tool_id: None,
        body: request.body.clone(),
        lifecycle,
    })
    .ok()
}

pub(super) fn encoded_bytes<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |encoded| encoded.len())
}

#[derive(Clone)]
pub(super) struct Candidate {
    pub(super) id: String,
    pub(super) order: u64,
    pub(super) version: u64,
    pub(super) open: bool,
    pub(super) estimate: usize,
    pub(super) live_only: Option<usize>,
    pub(super) abandoned: bool,
}

impl Candidate {
    pub(super) fn follows(&self, after: Option<&(u64, String)>) -> bool {
        after.is_none_or(|(order, id)| (self.order, self.id.as_str()) > (*order, id.as_str()))
    }
}

fn stored_candidate(entry: &StoredEntry, live: Option<&TurnLive>, now: u64) -> Candidate {
    let state = StoredState {
        id: &entry.request_id,
        kind: entry.kind,
        status: entry.status,
        version: entry.version,
    };
    let outcome = outcome(&state, live, now);
    let (open, answer) = match outcome.fate {
        Fate::Keep => (!entry.status.is_terminal(), 0),
        Fate::Resolve(resolution) => (false, encoded_bytes(resolution)),
        Fate::Close(..) => (false, 0),
    };
    Candidate {
        id: entry.request_id.clone(),
        order: entry.order,
        version: outcome.version,
        open,
        estimate: entry.bytes.saturating_add(answer),
        live_only: None,
        abandoned: outcome.abandoned,
    }
}

fn live_candidate((index, request): (usize, &ObservedRequest), order: u64, live: &TurnLive) -> Candidate {
    let answer = match &request.state {
        ObservedState::Resolved(resolution) => encoded_bytes(resolution),
        ObservedState::Pending | ObservedState::Closed { .. } => 0,
    };
    Candidate {
        id: request.id.clone(),
        order,
        version: live.changed_at(&request.id),
        open: request.state == ObservedState::Pending && !live.ended,
        estimate: encoded_bytes(&request.body).saturating_add(answer),
        live_only: Some(index),
        abandoned: abandoned_live(request, live),
    }
}

pub(super) fn candidates(
    entries: &[StoredEntry],
    live: Option<&TurnLive>,
    now: u64,
) -> Vec<Candidate> {
    let mut candidates: Vec<Candidate> = entries
        .iter()
        .map(|entry| stored_candidate(entry, live, now))
        .collect();
    let stored: HashSet<&str> = entries.iter().map(|entry| entry.request_id.as_str()).collect();
    let first_order = entries.iter().map(|entry| entry.order + 1).max().unwrap_or(0);
    let unsaved = live.into_iter().flat_map(|live| {
        live.requests
            .iter()
            .enumerate()
            .filter(|(_, request)| !stored.contains(request.id.as_str()))
            .map(move |listed| (listed, live))
    });
    let provisional = (first_order..)
        .zip(unsaved)
        .map(|(order, (listed, live))| live_candidate(listed, order, live));
    candidates.extend(provisional);
    candidates.sort_by(|left, right| {
        (left.order, left.id.as_str()).cmp(&(right.order, right.id.as_str()))
    });
    candidates
}
