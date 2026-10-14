use super::{
    commands::{blocking, OperationClass},
    interactions::{
        admit_connection, read_until, Exchange, InteractionError, InteractionRunnerPort,
        InteractionSource,
    },
    service::RemoteRunnerState,
    thread_requests_budget::PageBudget,
    thread_requests_cache::{Standing, TurnRead},
    thread_requests_cursor as cursor,
    thread_requests_evidence::Verdict,
    thread_requests_ipc::{ThreadRequestsPage, ThreadRequestsQuery, TurnDescriptor},
    thread_requests_map::{self as map, MessageScope},
    thread_requests_membership::{membership, Membership},
};
use crate::agent_runtime_requests::model::{
    RequestError, RuntimeRequest, MAX_REQUESTS_PER_MESSAGE,
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) const MAX_PAGE_RECORDS: usize = MAX_REQUESTS_PER_MESSAGE;
pub(super) const LIST_CEILING: Duration = Duration::from_secs(60);
const UNDISCLOSED_FAILURE: &str = "Runner request failed.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ThreadRequestError {
    Interaction(InteractionError),
    Projection(RequestError),
    StaleCursor,
    ForeignConversation,
}

fn discloses_location(message: &str) -> bool {
    let bytes = message.as_bytes();
    message.contains(['/', '\\', '@'])
        || bytes
            .windows(2)
            .any(|pair| pair[0] == b':' && pair[1].is_ascii_digit())
}

impl ThreadRequestError {
    pub(super) fn message(&self) -> String {
        let message = match self {
            Self::Interaction(error) => error.message().to_string(),
            Self::Projection(error) => error.to_string(),
            Self::StaleCursor => "Remote thread request cursor is no longer valid.".to_string(),
            Self::ForeignConversation => "Runner task belongs to another conversation.".to_string(),
        };
        if discloses_location(&message) {
            return UNDISCLOSED_FAILURE.to_string();
        }
        message
    }
}

impl From<ThreadRequestError> for String {
    fn from(error: ThreadRequestError) -> Self {
        error.message()
    }
}

impl From<InteractionError> for ThreadRequestError {
    fn from(error: InteractionError) -> Self {
        Self::Interaction(error)
    }
}

impl From<RequestError> for ThreadRequestError {
    fn from(error: RequestError) -> Self {
        Self::Projection(error)
    }
}

fn latest_turn(turns: &[TurnDescriptor]) -> Option<usize> {
    turns
        .iter()
        .enumerate()
        .max_by_key(|(index, turn)| (turn.started_at_epoch_ms, *index))
        .map(|(index, _)| index)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Route {
    Task,
    Interactions,
}

enum Step {
    Empty,
    Skipped,
    Deferred,
    Read(Arc<TurnRead>),
}

struct Page {
    requests: Vec<RuntimeRequest>,
    source: Option<InteractionSource>,
    truncated: bool,
    next: Option<usize>,
}

impl Page {
    fn fits(&self, added: usize) -> bool {
        self.requests.is_empty() || self.requests.len() + added <= MAX_PAGE_RECORDS
    }
}

struct Pager<'a, P> {
    budget: PageBudget<'a, P>,
    runner: &'a str,
    thread: &'a str,
    latest: Option<usize>,
    generation: u64,
}

impl<P: InteractionRunnerPort> Pager<'_, P> {
    fn is_skipped_history(&self, turn: &TurnDescriptor, index: usize) -> bool {
        let ledger = self.budget.ledger();
        let evidence = ledger.evidence();
        ledger.is_legacy_runner(self.budget.now())
            && turn.terminal
            && Some(index) != self.latest
            && !evidence.has_lost_open_evidence()
            && !evidence.has_open_requests(&turn.turn_id)
    }

    fn invalidate(&self, verdict: Verdict) {
        let ledger = self.budget.ledger();
        let lost = ledger.evidence().take_bump_due();
        if verdict == Verdict::Vanished || lost {
            ledger.requests().request_bump();
        }
    }

    fn gone(&self, turn: &TurnDescriptor) -> Result<Step, ThreadRequestError> {
        let ledger = self.budget.ledger();
        ledger.requests().forget(&turn.turn_id);
        self.invalidate(ledger.evidence().vanish(&turn.turn_id));
        Ok(Step::Empty)
    }

    fn confirm_gone(
        &self,
        turn: &TurnDescriptor,
        progressed: bool,
    ) -> Result<Step, ThreadRequestError> {
        let exchange = Exchange::open(&self.budget, self.runner, &turn.turn_id, self.budget.now())?;
        match exchange.task_record() {
            Ok(_) => Ok(Step::Empty),
            Err(error) => self.failed(turn, error, progressed, Route::Task),
        }
    }

    fn failed(
        &self,
        turn: &TurnDescriptor,
        error: InteractionError,
        progressed: bool,
        route: Route,
    ) -> Result<Step, ThreadRequestError> {
        if error == InteractionError::TaskNotFound && route == Route::Task {
            return self.gone(turn);
        }
        if error == InteractionError::TaskNotFound {
            return self.confirm_gone(turn, progressed);
        }
        if self.budget.is_overdue() && !progressed {
            return Err(InteractionError::DeadlineExceeded.into());
        }
        if self.budget.ran_out() || self.budget.is_overdue() {
            return Ok(Step::Deferred);
        }
        Err(error.into())
    }

    fn cached(&self, turn: &TurnDescriptor) -> Option<Arc<TurnRead>> {
        let ledger = self.budget.ledger();
        ledger
            .requests()
            .serve(turn)
            .filter(|read| !ledger.evidence().is_stale(read.interactions()))
    }

    fn step(
        &self,
        turn: &TurnDescriptor,
        index: usize,
        progressed: bool,
    ) -> Result<Step, ThreadRequestError> {
        if turn.interaction_sequence == Some(0) {
            return Ok(Step::Empty);
        }
        self.budget.bind(progressed);
        let ledger = self.budget.ledger();
        let cached = self.cached(turn);
        if cached.is_none() && self.is_skipped_history(turn, index) {
            return Ok(Step::Skipped);
        }
        if cached.is_none() && !progressed && self.budget.is_overdue() {
            return Err(InteractionError::DeadlineExceeded.into());
        }
        if cached.is_none() && self.budget.is_spent() {
            return Ok(Step::Deferred);
        }
        let now = self.budget.now();
        match membership(
            &self.budget,
            self.runner,
            &turn.turn_id,
            self.thread,
            now,
            None,
        ) {
            Ok(Membership::Member) => {}
            Ok(Membership::Foreign) => return Err(ThreadRequestError::ForeignConversation),
            Err(error) => return self.failed(turn, error, progressed, Route::Task),
        }
        if let Some(read) = cached {
            return Ok(Step::Read(read));
        }
        let interactions = match read_until(&self.budget, self.runner, &turn.turn_id, now, None) {
            Ok(interactions) => interactions,
            Err(error) => return self.failed(turn, error, progressed, Route::Interactions),
        };
        if ledger.evidence().is_stale(&interactions) {
            return Ok(Step::Empty);
        }
        let switching = ledger
            .requests()
            .current()
            .source
            .is_some_and(|source| source != interactions.source);
        if switching && ledger.evidence().defers_switch(&interactions, now) {
            return Ok(Step::Skipped);
        }
        let verdict = ledger.evidence().observe(&interactions);
        if verdict == Verdict::Stale {
            return Ok(Step::Empty);
        }
        self.invalidate(verdict);
        let read = Arc::new(TurnRead::new(interactions, turn.terminal));
        ledger.requests().retain(&read);
        Ok(Step::Read(read))
    }

    fn admit(
        &self,
        page: &mut Page,
        turn: &TurnDescriptor,
        read: &TurnRead,
    ) -> Result<bool, RequestError> {
        let interactions = read.interactions();
        if page
            .source
            .is_some_and(|source| source != interactions.source)
        {
            return Ok(false);
        }
        let requests = self.budget.ledger().evidence().fenced(
            &turn.turn_id,
            map::requests(interactions, turn.started_at_epoch_ms)?,
        );
        if !page.fits(requests.len()) {
            return Ok(false);
        }
        self.budget
            .ledger()
            .evidence()
            .fence_settled(&turn.turn_id, &requests);
        page.source = Some(interactions.source);
        page.truncated |= map::is_truncated(interactions);
        page.requests.extend(requests);
        Ok(true)
    }
}

fn read_page<P: InteractionRunnerPort>(
    pager: &Pager<'_, P>,
    turns: &[TurnDescriptor],
    start: usize,
) -> Result<Page, ThreadRequestError> {
    let evidence = pager.budget.ledger().evidence();
    let mut page = Page {
        requests: Vec::new(),
        source: None,
        truncated: evidence.is_connection_incomplete(),
        next: None,
    };
    for (index, turn) in turns.iter().enumerate().skip(start) {
        let fits = match pager.step(turn, index, index > start)? {
            Step::Empty => true,
            Step::Skipped => {
                page.truncated = true;
                true
            }
            Step::Deferred => false,
            Step::Read(read) => pager.admit(&mut page, turn, &read)?,
        };
        if pager.budget.ledger().requests().current().generation != pager.generation {
            return Err(ThreadRequestError::StaleCursor);
        }
        if !fits {
            page.next = Some(index);
            break;
        }
        page.truncated |= evidence.is_incomplete(&turn.turn_id);
    }
    Ok(page)
}

struct Built {
    page: Page,
    standing: Standing,
}

fn build<P: InteractionRunnerPort>(
    port: &P,
    query: &ThreadRequestsQuery,
    (clock, ceiling): (&dyn Fn() -> Instant, Instant),
    start: usize,
    standing: Standing,
) -> Result<Built, ThreadRequestError> {
    let pager = Pager {
        budget: PageBudget::new(port, clock, ceiling),
        runner: &query.runner_id,
        thread: &query.thread_id,
        latest: latest_turn(&query.turns),
        generation: standing.generation,
    };
    let page = read_page(&pager, &query.turns, start)?;
    Ok(Built { page, standing })
}

fn rebuilt<P: InteractionRunnerPort>(
    port: &P,
    query: &ThreadRequestsQuery,
    timing: (&dyn Fn() -> Instant, Instant),
) -> Result<Built, ThreadRequestError> {
    let cache = port.ledger().requests();
    let first = match build(port, query, timing, 0, cache.rebuild((timing.0)())) {
        Err(ThreadRequestError::StaleCursor) => None,
        built => Some(built?),
    };
    if let Some(first) = first.filter(|_| !cache.bump_is_due((timing.0)())) {
        if cache.current().generation == first.standing.generation {
            return Ok(first);
        }
    }
    build(port, query, timing, 0, cache.rebuild((timing.0)()))
}

fn continued<P: InteractionRunnerPort>(
    port: &P,
    query: &ThreadRequestsQuery,
    timing: (&dyn Fn() -> Instant, Instant),
) -> Result<Built, ThreadRequestError> {
    let standing = port.ledger().requests().current();
    let start = cursor::resume(query, port.ledger().serial(), standing.generation)
        .ok_or(ThreadRequestError::StaleCursor)?;
    build(port, query, timing, start, standing)
}

pub(super) fn list_under<P: InteractionRunnerPort>(
    port: &P,
    query: &ThreadRequestsQuery,
    clock: &dyn Fn() -> Instant,
    ceiling: Instant,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    if port.runner_id() != query.runner_id {
        return Err(InteractionError::RunnerChanged.into());
    }
    if !port.is_current() {
        return Err(InteractionError::Superseded.into());
    }
    if clock() >= ceiling {
        return Err(InteractionError::DeadlineExceeded.into());
    }
    let serial = port.ledger().serial();
    let built = match query.cursor {
        None => rebuilt(port, query, (clock, ceiling))?,
        Some(_) => continued(port, query, (clock, ceiling))?,
    };
    let Built { page, standing } = built;
    let source = page
        .source
        .or(standing.source)
        .unwrap_or(InteractionSource::Snapshot);
    let epoch = map::epoch(source, serial, standing.generation);
    let scope = MessageScope {
        server_id: &query.server_id,
        thread_id: &query.thread_id,
        epoch: epoch.clone(),
    };
    let next_cursor = page
        .next
        .map(|index| {
            cursor::issue(index, query, serial, standing.generation).ok_or(RequestError::Identifier)
        })
        .transpose()?;
    let message = map::message(scope, page.requests, page.truncated)?;
    if query.cursor.is_none() {
        port.ledger()
            .requests()
            .mark_rebuilt(&query.thread_id, &epoch);
    }
    Ok(ThreadRequestsPage {
        message,
        next_cursor,
    })
}

pub(super) fn settle_page<P: InteractionRunnerPort>(
    port: &P,
    page: Result<ThreadRequestsPage, ThreadRequestError>,
    ceiling: Instant,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    if !port.is_current() {
        return Err(InteractionError::Superseded.into());
    }
    if port.has_passed(ceiling) {
        return Err(InteractionError::DeadlineExceeded.into());
    }
    page
}

#[tauri::command]
pub async fn get_remote_agent_thread_requests(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadRequestsQuery,
) -> Result<ThreadRequestsPage, String> {
    let lease = admit_connection(state.inner(), &request.server_id, &request.runner_id)
        .map_err(ThreadRequestError::from)?;
    let worker = lease.clone();
    let ceiling = Instant::now() + LIST_CEILING;
    let page = blocking(OperationClass::Bulk, move || {
        Ok(list_under(&worker, &request, &Instant::now, ceiling))
    })
    .await?;
    Ok(settle_page(&lease, page, ceiling)?)
}

#[cfg(test)]
#[path = "thread_requests_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "thread_requests_guard_tests.rs"]
mod guard_tests;

#[cfg(test)]
#[path = "thread_requests_ceiling_tests.rs"]
mod ceiling_tests;

#[cfg(test)]
#[path = "thread_requests_invalidation_tests.rs"]
mod invalidation_tests;

#[cfg(test)]
#[path = "thread_requests_epoch_tests.rs"]
mod epoch_tests;
