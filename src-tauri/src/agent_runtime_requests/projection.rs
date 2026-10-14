use super::journal::RuntimeRequestJournal;
use super::model::{
    is_identifier, JournalState, RuntimeRequest, ThreadRequests, ThreadRequestsParts,
    MAX_REQUESTS_PER_MESSAGE,
};
pub use super::projection_cursor::{MAX_CURSOR_BYTES, MAX_PULL_PAGES};
use super::projection_cursor::{binding, generation, Continuation, Phase, Position};
pub use super::projection_overlay::TurnLive;
use super::projection_overlay::{candidates, encoded_bytes, live_only, overlaid, Candidate};
use super::scopes::{HistoryScope, TurnAuthority};
use super::store::{StoreError, ThreadRows, ThreadSummary, TurnKey};
use serde::Serialize;
use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

pub const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
pub const PAGE_ENVELOPE_BYTES: usize = 1024;
pub const MAX_PULL_TURNS: usize = 32;
pub const PROJECTION_READ_BUDGET: Duration = Duration::from_millis(1500);
pub const INVALID_THREAD_REQUESTS_QUERY_ERROR: &str = "Agent thread request query is invalid.";
pub const STALE_THREAD_REQUESTS_CURSOR_ERROR: &str =
    "Agent thread request cursor is no longer valid.";
pub const DELETED_THREAD_REQUESTS_ERROR: &str = "Agent thread was deleted.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProjectionLimits {
    pub page_bytes: usize,
    pub read_budget: Duration,
}

impl Default for ProjectionLimits {
    fn default() -> Self {
        Self {
            page_bytes: MAX_PAGE_BYTES,
            read_budget: PROJECTION_READ_BUDGET,
        }
    }
}

impl ProjectionLimits {
    fn record_budget(self) -> usize {
        self.page_bytes.saturating_sub(PAGE_ENVELOPE_BYTES)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectionError {
    InvalidQuery,
    StaleCursor,
    ThreadDeleted,
    Store(StoreError),
}

impl fmt::Display for ProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidQuery => formatter.write_str(INVALID_THREAD_REQUESTS_QUERY_ERROR),
            Self::StaleCursor => formatter.write_str(STALE_THREAD_REQUESTS_CURSOR_ERROR),
            Self::ThreadDeleted => formatter.write_str(DELETED_THREAD_REQUESTS_ERROR),
            Self::Store(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ProjectionError {}

pub const PROJECTION_ATTEMPTS: usize = 2;

struct TurnView<'a> {
    turn_id: String,
    authority: TurnAuthority,
    live: Option<TurnLive>,
    journal: &'a RuntimeRequestJournal,
}

impl TurnView<'_> {
    fn listed(
        &self,
        rows: Option<&mut (dyn ThreadRows + '_)>,
        now: u64,
    ) -> Result<Vec<Candidate>, StoreError> {
        let entries = match rows {
            Some(rows) => rows.entries(&self.turn_id)?,
            None => Vec::new(),
        };
        let listed = candidates(&entries, self.live.as_ref(), now);
        let abandoned = listed
            .iter()
            .filter(|candidate| candidate.abandoned)
            .map(|candidate| candidate.version)
            .max();
        if let Some(revision) = abandoned.filter(|_| !self.journal.is_obsolete(&self.authority)) {
            self.journal.note_abandoned(&self.authority, revision);
        }
        Ok(listed)
    }

    fn record(
        &self,
        rows: Option<&mut (dyn ThreadRows + '_)>,
        candidate: &Candidate,
        now: u64,
    ) -> Result<Option<RuntimeRequest>, StoreError> {
        let live = self.live.as_ref();
        if let Some(index) = candidate.live_only {
            let unsaved = live.and_then(|live| {
                let request = live.requests.get(index)?;
                live_only(request, &self.turn_id, candidate.order, live)
            });
            return Ok(unsaved);
        }
        let Some(rows) = rows else {
            return Ok(None);
        };
        let stored = rows.load(&self.turn_id, &candidate.id)?;
        Ok(stored.map(|stored| overlaid(stored, live, now)))
    }
}

fn wire_cost(request: &RuntimeRequest) -> usize {
    encoded_bytes(request).saturating_add(1)
}

enum Taken {
    Added,
    Skipped,
    Full,
}

struct PageBuilder<'a, 'r> {
    rows: &'a mut (dyn ThreadRows + 'r),
    turns: &'a [TurnView<'a>],
    listed: &'a [Vec<Candidate>],
    now: u64,
    budget: usize,
    records: Vec<RuntimeRequest>,
    used: usize,
    incomplete: bool,
}

impl PageBuilder<'_, '_> {
    fn next_candidate(&self, position: &Position) -> Option<Candidate> {
        let open = position.phase == Phase::Open;
        self.listed[position.turn]
            .iter()
            .find(|candidate| candidate.open == open && candidate.follows(position.after.as_ref()))
            .cloned()
    }

    fn take(&mut self, turn: usize, candidate: &Candidate) -> Result<Taken, StoreError> {
        let remaining = self.budget.saturating_sub(self.used);
        let full = self.records.len() >= MAX_REQUESTS_PER_MESSAGE
            || (!self.records.is_empty() && candidate.estimate > remaining);
        if full {
            return Ok(Taken::Full);
        }
        let Some(request) = self.turns[turn].record(Some(&mut *self.rows), candidate, self.now)?
        else {
            return Ok(Taken::Skipped);
        };
        let cost = wire_cost(&request);
        if cost > self.budget {
            self.incomplete = true;
            return Ok(Taken::Skipped);
        }
        if cost > remaining {
            return Ok(Taken::Full);
        }
        self.used += cost;
        self.records.push(request);
        Ok(Taken::Added)
    }

    fn fill(&mut self, start: &Position) -> Result<Option<Position>, StoreError> {
        let mut position = start.clone();
        loop {
            if position.turn >= self.turns.len() && position.phase == Phase::Closed {
                return Ok(None);
            }
            if position.turn >= self.turns.len() {
                position.phase = Phase::Closed;
                position.turn = 0;
                position.after = None;
                continue;
            }
            let Some(candidate) = self.next_candidate(&position) else {
                position.turn += 1;
                position.after = None;
                continue;
            };
            if let Taken::Full = self.take(position.turn, &candidate)? {
                return Ok(Some(position));
            }
            position.after = Some((candidate.order, candidate.id.clone()));
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRequestsPage {
    pub message: ThreadRequests,
    pub next_cursor: Option<String>,
}

#[derive(Default)]
pub struct TurnUpdate {
    pub requests: Vec<RuntimeRequest>,
    pub overflow: bool,
    pub considered_through: u64,
    pub summary: Option<ThreadSummary>,
    pub workspace_id: Option<String>,
}

struct Changed {
    requests: Vec<RuntimeRequest>,
    overflow: bool,
    considered_through: u64,
}

fn changed_since(
    mut rows: Option<&mut (dyn ThreadRows + '_)>,
    turn: &TurnView<'_>,
    (watermark, budget): (u64, usize),
    now: u64,
) -> Result<Changed, StoreError> {
    let listed = turn.listed(rows.as_deref_mut(), now)?;
    let considered_through = listed
        .iter()
        .map(|candidate| candidate.version)
        .fold(watermark, u64::max);
    let changed: Vec<&Candidate> = listed
        .iter()
        .filter(|candidate| candidate.version > watermark)
        .collect();
    let overflowed = Changed {
        requests: Vec::new(),
        overflow: true,
        considered_through,
    };
    if changed.len() > MAX_REQUESTS_PER_MESSAGE {
        return Ok(overflowed);
    }
    let mut requests = Vec::new();
    let mut used = 0usize;
    for candidate in changed {
        let Some(request) = turn.record(rows.as_deref_mut(), candidate, now)? else {
            continue;
        };
        used = used.saturating_add(wire_cost(&request));
        if used > budget {
            return Ok(overflowed);
        }
        requests.push(request);
    }
    Ok(Changed {
        requests,
        overflow: false,
        considered_through,
    })
}

pub struct RequestProjection {
    journal: Arc<RuntimeRequestJournal>,
    limits: ProjectionLimits,
}

struct PageRead {
    summary: ThreadSummary,
    requests: Vec<RuntimeRequest>,
    resume: Option<Position>,
    generation: String,
    incomplete: bool,
}

enum PageOutcome {
    Read(PageRead),
    Stale,
}

impl RequestProjection {
    pub fn new(journal: Arc<RuntimeRequestJournal>) -> Self {
        Self::with_limits(journal, ProjectionLimits::default())
    }

    pub fn with_limits(journal: Arc<RuntimeRequestJournal>, limits: ProjectionLimits) -> Self {
        Self { journal, limits }
    }

    pub fn epoch(&self) -> String {
        self.journal.epoch()
    }

    fn view(&self, scope: &HistoryScope, (thread_id, turn_id): (&str, &str)) -> TurnView<'_> {
        let key = TurnKey {
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
        };
        let authority = self.journal.latest_turn(scope, &key);
        self.exact_view(&authority)
    }

    fn exact_view(&self, turn: &TurnAuthority) -> TurnView<'_> {
        TurnView {
            turn_id: turn.key.turn_id.clone(),
            authority: turn.clone(),
            live: self
                .journal
                .live_turn(turn)
                .map(|live| TurnLive::of(&live)),
            journal: &self.journal,
        }
    }

    pub fn journal_state(&self, scope: &HistoryScope, thread_id: &str) -> JournalState {
        if self.lost_history(scope, thread_id) {
            return JournalState::Degraded;
        }
        self.journal.thread_state_in(scope, thread_id)
    }

    pub fn lost_history(&self, scope: &HistoryScope, thread_id: &str) -> bool {
        self.journal.lost_history(scope, thread_id)
    }

    pub fn message(
        &self,
        scope: &HistoryScope,
        (thread_id, workspace_id): (&str, Option<String>),
        requests: Vec<RuntimeRequest>,
        summary: ThreadSummary,
        reset: bool,
    ) -> Option<ThreadRequests> {
        self.message_in(
            &self.journal.epoch(),
            scope,
            (thread_id, workspace_id),
            (requests, summary, reset),
        )
    }

    fn message_in(
        &self,
        epoch: &str,
        scope: &HistoryScope,
        (thread_id, workspace_id): (&str, Option<String>),
        (requests, summary, reset): (Vec<RuntimeRequest>, ThreadSummary, bool),
    ) -> Option<ThreadRequests> {
        ThreadRequests::new(ThreadRequestsParts {
            workspace_id,
            thread_id: thread_id.to_string(),
            epoch: epoch.to_string(),
            journal: self.journal_state(scope, thread_id),
            requests,
            truncated: summary.incomplete || self.lost_history(scope, thread_id),
            unreadable: summary.unreadable,
            reset,
        })
        .ok()
    }

    fn read_page(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        turn_ids: &[String],
        continuation: Option<&Continuation>,
    ) -> Result<PageOutcome, ProjectionError> {
        let now = self.journal.now_epoch_ms();
        let mut outcome: Option<PageOutcome> = None;
        self.journal
            .read_thread(scope, thread_id, self.limits.read_budget, &mut |rows| {
                let turns: Vec<TurnView<'_>> = turn_ids
                    .iter()
                    .map(|turn_id| self.view(scope, (thread_id, turn_id)))
                    .collect();
                let mut listed = Vec::with_capacity(turns.len());
                for turn in &turns {
                    listed.push(turn.listed(Some(&mut *rows), now)?);
                }
                let generation = generation(listed.iter().map(Vec::as_slice));
                if continuation.is_some_and(|continuation| continuation.generation != generation)
                {
                    outcome = Some(PageOutcome::Stale);
                    return Ok(());
                }
                let start = continuation
                    .map(|continuation| continuation.position.clone())
                    .unwrap_or_else(Position::start);
                let mut builder = PageBuilder {
                    rows: &mut *rows,
                    turns: &turns,
                    listed: &listed,
                    now,
                    budget: self.limits.record_budget(),
                    records: Vec::new(),
                    used: 0,
                    incomplete: false,
                };
                let resume = builder.fill(&start)?;
                let (requests, incomplete) = (builder.records, builder.incomplete);
                let summary = rows.summary()?;
                outcome = Some(PageOutcome::Read(PageRead {
                    summary,
                    requests,
                    resume,
                    generation,
                    incomplete,
                }));
                Ok(())
            })
            .map_err(ProjectionError::Store)?;
        outcome.ok_or(ProjectionError::InvalidQuery)
    }

    fn page_in(
        &self,
        epoch: &str,
        scope: &HistoryScope,
        (thread_id, turn_ids): (&str, &[String]),
        cursor: Option<&str>,
    ) -> Result<Option<ThreadRequestsPage>, ProjectionError> {
        let binding = binding(epoch, scope, thread_id, turn_ids);
        let continuation = match cursor {
            None => None,
            Some(cursor) => Some(
                Continuation::decoded(cursor, &binding, turn_ids.len())
                    .ok_or(ProjectionError::StaleCursor)?,
            ),
        };
        let PageOutcome::Read(read) =
            self.read_page(scope, thread_id, turn_ids, continuation.as_ref())?
        else {
            return Err(ProjectionError::StaleCursor);
        };
        if self.journal.epoch() != epoch {
            return Ok(None);
        }
        if read.summary.deleted {
            return Err(ProjectionError::ThreadDeleted);
        }
        let page = continuation.map_or(0, |continuation| continuation.position.page);
        let next = read.resume.map(|resume| Continuation {
            generation: read.generation,
            position: Position {
                page: page + 1,
                ..resume
            },
        });
        let exhausted = next
            .as_ref()
            .is_some_and(|next| next.position.page >= MAX_PULL_PAGES);
        let summary = ThreadSummary {
            incomplete: read.summary.incomplete || read.incomplete || exhausted,
            ..read.summary
        };
        let message = self
            .message_in(
                epoch,
                scope,
                (thread_id, None),
                (read.requests, summary, false),
            )
            .ok_or(ProjectionError::InvalidQuery)?;
        Ok(Some(ThreadRequestsPage {
            message,
            next_cursor: next
                .filter(|_| !exhausted)
                .map(|next| next.encoded(&binding)),
        }))
    }

    pub fn page(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        turn_ids: &[String],
        cursor: Option<&str>,
    ) -> Result<ThreadRequestsPage, ProjectionError> {
        let distinct: HashSet<&str> = turn_ids.iter().map(String::as_str).collect();
        if !is_identifier(thread_id)
            || turn_ids.len() > MAX_PULL_TURNS
            || distinct.len() != turn_ids.len()
            || !turn_ids.iter().all(|turn_id| is_identifier(turn_id))
        {
            return Err(ProjectionError::InvalidQuery);
        }
        for _ in 0..PROJECTION_ATTEMPTS {
            let epoch = self.journal.epoch();
            if let Some(page) = self.page_in(&epoch, scope, (thread_id, turn_ids), cursor)? {
                return Ok(page);
            }
            if cursor.is_some() {
                return Err(ProjectionError::StaleCursor);
            }
        }
        Err(ProjectionError::StaleCursor)
    }

    pub fn turn_update(&self, turn: &TurnAuthority, watermark: u64) -> TurnUpdate {
        let now = self.journal.now_epoch_ms();
        let bounds = (watermark, self.limits.record_budget());
        let unchanged = TurnUpdate {
            requests: Vec::new(),
            overflow: false,
            considered_through: watermark,
            summary: None,
            workspace_id: None,
        };
        if self.journal.is_obsolete(turn) {
            return unchanged;
        }
        let mut saved: Option<TurnUpdate> = None;
        let read = self.journal.read_thread(
            &turn.scope,
            &turn.key.thread_id,
            self.limits.read_budget,
            &mut |rows| {
                let view = self.exact_view(turn);
                let changed = changed_since(Some(&mut *rows), &view, bounds, now)?;
                let summary = rows.summary()?;
                saved = Some(TurnUpdate {
                    requests: changed.requests,
                    overflow: changed.overflow,
                    considered_through: changed.considered_through,
                    summary: Some(summary),
                    workspace_id: self.journal.live_turn(turn).map(|live| live.workspace_id),
                });
                Ok(())
            },
        );
        if self.journal.is_obsolete(turn) {
            return unchanged;
        }
        if let Some(saved) = saved.filter(|_| read.is_ok()) {
            return saved;
        }
        let view = self.exact_view(turn);
        let Ok(unsaved) = changed_since(None, &view, bounds, now) else {
            return unchanged;
        };
        TurnUpdate {
            requests: unsaved.requests,
            overflow: unsaved.overflow,
            considered_through: unsaved.considered_through,
            summary: None,
            workspace_id: self.journal.live_turn(turn).map(|live| live.workspace_id),
        }
    }
}
