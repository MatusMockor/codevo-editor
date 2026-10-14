use super::{
    commands::{blocking, OperationClass},
    interactions::{admit_connection, InteractionError, InteractionRunnerPort},
    interactions_respond::{deliver_until, Delivery, RemoteRespondOutcome, Responded},
    service::RemoteRunnerState,
    thread_requests::ThreadRequestError,
    thread_requests_cache::Standing,
    thread_requests_ipc::{ThreadRespondRequest, ThreadRespondResult},
    thread_requests_map::{self as map, MessageScope},
    thread_requests_membership::{membership, Membership},
};
use crate::agent_runtime_requests::model::{
    RequestError, RequestStatus, RuntimeRequest, ThreadRequests,
};
use std::time::{Duration, Instant};

pub(super) const RESPOND_CEILING: Duration = Duration::from_secs(120);

pub(super) enum Attempt {
    Refused(ThreadRequestError),
    Gone,
    Made(Box<Delivery>, Standing),
}

fn refused<P: InteractionRunnerPort>(
    port: &P,
    ceiling: Instant,
    error: impl Into<ThreadRequestError>,
) -> Attempt {
    if port.has_passed(ceiling) {
        return Attempt::Refused(InteractionError::DeadlineExceeded.into());
    }
    Attempt::Refused(error.into())
}

pub(super) fn respond_under<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    now: Instant,
    ceiling: Instant,
) -> Attempt {
    let task = &request.turn.turn_id;
    let deadline = Some(ceiling);
    let standing = port.ledger().requests().current();
    match membership(
        port,
        &request.runner_id,
        task,
        &request.thread_id,
        now,
        deadline,
    ) {
        Ok(Membership::Member) => {}
        Ok(Membership::Foreign) => {
            return refused(port, ceiling, ThreadRequestError::ForeignConversation)
        }
        Err(InteractionError::TaskNotFound) if !port.has_passed(ceiling) => return Attempt::Gone,
        Err(error) => return refused(port, ceiling, error),
    }
    let delivery = deliver_until(
        port,
        &request.runner_id,
        task,
        (&request.request_id, &request.response),
        now,
        deadline,
    );
    port.ledger().requests().forget(task);
    Attempt::Made(Box::new(delivery), standing)
}

fn publish<P: InteractionRunnerPort>(port: &P, task: &str, record: &RuntimeRequest) {
    let ledger = port.ledger();
    let parts = record.parts();
    let open = matches!(
        record.status(),
        RequestStatus::Pending | RequestStatus::Submitting
    );
    let evidence = ledger.evidence();
    evidence.published(task, (parts.body.kind(), parts.id.clone()), open);
    if evidence.take_bump_due() {
        ledger.requests().request_bump();
    }
}

fn bound_epoch<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    responded: &Responded,
    standing: Standing,
) -> Option<String> {
    let ledger = port.ledger();
    let epoch = map::epoch(responded.read.source, ledger.serial(), standing.generation);
    let cache = ledger.requests();
    let bound = cache.current() == standing
        && standing
            .source
            .is_none_or(|source| source == responded.read.source)
        && cache.was_rebuilt_in(&request.thread_id, &epoch);
    bound.then_some(epoch)
}

fn responded_message<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    responded: &Responded,
    standing: Standing,
) -> Result<Option<ThreadRequests>, RequestError> {
    let record = map::responded(
        &responded.read,
        &responded.outcome,
        responded.delivered,
        request.turn.started_at_epoch_ms,
    )?;
    let task = &request.turn.turn_id;
    publish(port, task, &record);
    let Some(epoch) = bound_epoch(port, request, responded, standing) else {
        return Ok(None);
    };
    let ledger = port.ledger();
    let scope = MessageScope {
        server_id: &request.server_id,
        thread_id: &request.thread_id,
        epoch,
    };
    let truncated = ledger.evidence().is_incomplete(task);
    Ok(Some(map::message(scope, vec![record], truncated)?))
}

fn responded_result<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    responded: &Responded,
    standing: Standing,
) -> Result<ThreadRespondResult, RequestError> {
    let message = responded_message(port, request, responded, standing)?;
    match responded.outcome {
        RemoteRespondOutcome::Answered { .. } => Ok(ThreadRespondResult::answered(message)),
        RemoteRespondOutcome::NotAnswerable { .. } => {
            Ok(ThreadRespondResult::not_answerable(message))
        }
    }
}

fn past_ceiling(possibly_sent: bool) -> Result<ThreadRespondResult, ThreadRequestError> {
    if possibly_sent {
        return Ok(ThreadRespondResult::delivery_uncertain());
    }
    Err(InteractionError::DeadlineExceeded.into())
}

pub(super) fn settle_response<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    attempt: Attempt,
    ceiling: Instant,
) -> Result<ThreadRespondResult, ThreadRequestError> {
    let possibly_sent = matches!(&attempt, Attempt::Made(delivery, _) if delivery.posted());
    if port.has_passed(ceiling) {
        return past_ceiling(possibly_sent);
    }
    let result = settle_attempt(port, request, attempt)?;
    if port.has_passed(ceiling) {
        return past_ceiling(possibly_sent);
    }
    Ok(result)
}

fn settle_attempt<P: InteractionRunnerPort>(
    port: &P,
    request: &ThreadRespondRequest,
    attempt: Attempt,
) -> Result<ThreadRespondResult, ThreadRequestError> {
    let (delivery, standing) = match attempt {
        Attempt::Made(delivery, standing) => (*delivery, standing),
        _ if !port.is_current() => return Err(InteractionError::Superseded.into()),
        Attempt::Refused(error) => return Err(error),
        Attempt::Gone => return Ok(ThreadRespondResult::not_answerable(None)),
    };
    let posted = delivery.posted();
    let result = delivery
        .settle_responded(port)
        .map_err(ThreadRequestError::from)
        .and_then(|responded| Ok(responded_result(port, request, &responded, standing)?));
    match (result, posted) {
        (Ok(result), _) => Ok(result),
        (Err(_), true) => Ok(ThreadRespondResult::delivery_uncertain()),
        (
            Err(ThreadRequestError::Interaction(
                InteractionError::RequestGone | InteractionError::TaskNotFound,
            )),
            false,
        ) => Ok(ThreadRespondResult::not_answerable(None)),
        (Err(error), false) => Err(error),
    }
}

#[tauri::command]
pub async fn respond_remote_agent_thread_request(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadRespondRequest,
) -> Result<ThreadRespondResult, String> {
    let lease = admit_connection(state.inner(), &request.server_id, &request.runner_id)
        .map_err(ThreadRequestError::from)?;
    let worker = lease.clone();
    let ceiling = Instant::now() + RESPOND_CEILING;
    let (request, attempt) = blocking(OperationClass::Control, move || {
        let attempt = respond_under(&worker, &request, Instant::now(), ceiling);
        Ok((request, attempt))
    })
    .await?;
    Ok(settle_response(&lease, &request, attempt, ceiling)?)
}

#[cfg(test)]
#[path = "thread_requests_respond_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "thread_requests_respond_contract_tests.rs"]
mod contract_tests;
