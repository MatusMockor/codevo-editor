use super::{
    interactions::InteractionSource,
    interactions_fake::*,
    interactions_respond::RemoteRequestResponse,
    thread_requests::LIST_CEILING,
    thread_requests::{list_under, settle_page, ThreadRequestError},
    thread_requests_ipc::{
        ThreadRequestsPage, ThreadRequestsQuery, ThreadRespondRequest, ThreadRespondResult,
        TurnDescriptor,
    },
    thread_requests_map::epoch,
    thread_requests_respond::{respond_under, settle_response, Attempt, RESPOND_CEILING},
};
use serde_json::{json, Value};
use std::time::Instant;

pub(super) const SERVER: &str = "srv-alpha";
pub(super) const THREAD: &str = "5f0c2a9e-7b1d-4c3e-8a6f-0d1e2f3a4b5c";
pub(super) const STARTED: u64 = 1_760_000_000_000;
pub(super) const CREATED: u64 = 1_791_882_000_000;
pub(super) fn far() -> Instant {
    Instant::now() + LIST_CEILING + RESPOND_CEILING
}

pub(super) const UNAVAILABLE: &str = "Runner request failed (HTTP 503).";

pub(super) fn query(turns: Vec<TurnDescriptor>, cursor: Option<&str>) -> ThreadRequestsQuery {
    ThreadRequestsQuery {
        server_id: SERVER.into(),
        runner_id: RUNNER.into(),
        thread_id: THREAD.into(),
        turns,
        cursor: cursor.map(str::to_string),
    }
}

pub(super) fn list_at(
    runner: &FakeRunner,
    turns: Vec<TurnDescriptor>,
    cursor: Option<&str>,
    now: Instant,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    let tasks: Vec<String> = turns.iter().map(|turn| turn.turn_id.clone()).collect();
    runner.joined(&tasks, THREAD);
    let ceiling = now.max(runner.clock()) + LIST_CEILING;
    settle_page(
        runner,
        list_under(runner, &query(turns, cursor), &move || now, ceiling),
        ceiling,
    )
}

pub(super) fn list(
    runner: &FakeRunner,
    turns: Vec<TurnDescriptor>,
    cursor: Option<&str>,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    list_at(runner, turns, cursor, Instant::now())
}

pub(super) fn running(index: usize, sequence: Option<u64>) -> TurnDescriptor {
    turn(&task(index), STARTED + index as u64, sequence, false)
}

pub(super) fn ended(index: usize, sequence: Option<u64>) -> TurnDescriptor {
    turn(&task(index), STARTED + index as u64, sequence, true)
}

pub(super) fn reply(index: usize, name: &str, sequence: u64) -> Reply {
    Ok(sequenced(retasked(snapshot(name), &task(index)), sequence))
}

pub(super) fn legacy_lists(index: usize, status: &str) -> Vec<Reply> {
    let mut question = legacy_question(status);
    question["taskId"] = task(index).into();
    let mut approval = legacy_approval(status);
    approval["taskId"] = task(index).into();
    vec![items(vec![question]), items(vec![approval])]
}

pub(super) fn first_legacy_read(index: usize, status: &str) -> Vec<Reply> {
    let mut replies = vec![not_found()];
    replies.extend(legacy_lists(index, status));
    replies.push(not_found());
    replies
}

pub(super) fn crowded(index: usize, questions: usize, approvals: usize) -> Reply {
    let mut value = retasked(live(), &task(index));
    let numbered = |item: &Value, prefix: char, count: usize| -> Value {
        (0..count)
            .map(|number| {
                let mut item = item.clone();
                item["id"] = format!("{prefix}0000000-0000-4000-8000-{number:012}").into();
                item
            })
            .collect::<Vec<_>>()
            .into()
    };
    value["questions"] = numbered(&value["questions"][0], 'a', questions);
    value["approvals"] = numbered(&value["approvals"][0], 'b', approvals);
    Ok(value)
}

pub(super) fn records(page: &ThreadRequestsPage) -> Vec<Value> {
    wire(page)["message"]["requests"]
        .as_array()
        .expect("requests")
        .clone()
}

pub(super) fn epoch_of(page: &ThreadRequestsPage) -> String {
    page.message.parts().epoch.clone()
}

pub(super) fn legacy_epoch(runner: &FakeRunner) -> String {
    format!("rr1-legacy-{}", runner.ledger.serial())
}

pub(super) fn respond_request(
    task: &str,
    request_id: &str,
    response: RemoteRequestResponse,
) -> ThreadRespondRequest {
    ThreadRespondRequest {
        server_id: SERVER.into(),
        runner_id: RUNNER.into(),
        thread_id: THREAD.into(),
        turn: turn(task, STARTED, Some(3), false),
        request_id: request_id.into(),
        response,
    }
}

pub(super) fn attempt(
    runner: &FakeRunner,
    request: &ThreadRespondRequest,
    now: Instant,
) -> Attempt {
    runner.joined(
        std::slice::from_ref(&request.turn.turn_id),
        &request.thread_id,
    );
    rebuilt_by_client(runner, &request.thread_id);
    respond_under(runner, request, now, runner.clock() + RESPOND_CEILING)
}

pub(super) fn respond(
    runner: &FakeRunner,
    request_id: &str,
    response: RemoteRequestResponse,
) -> Result<ThreadRespondResult, ThreadRequestError> {
    let request = respond_request(TASK, request_id, response);
    let attempt = attempt(runner, &request, Instant::now());
    settle_response(runner, &request, attempt, far())
}

pub(super) fn posts(runner: &FakeRunner) -> usize {
    runner
        .calls()
        .iter()
        .filter(|(method, _, _)| method == "POST")
        .count()
}

pub(super) fn approved(decision: &str) -> Reply {
    let mut approved = legacy_approval("approved");
    approved["decision"] = decision.into();
    Ok(json!({"request": approved}))
}

pub(super) const EXPIRES_AT: &str = "2026-10-13T09:10:00.000Z";

pub(super) fn iso(epoch_ms: u64) -> String {
    let rest = epoch_ms % 86_400_000;
    let shifted = i64::try_from(epoch_ms / 86_400_000).expect("day count") + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = (shifted_month + 2) % 12 + 1;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1_000 % 60,
        rest % 1_000
    )
}

pub(super) fn runner_status(record: &Value) -> &str {
    let status = record["status"].as_str().expect("status");
    let question = record["body"]["kind"] == "question";
    let denied = record["resolution"]["decision"] == "deny";
    match (status, question, denied) {
        ("pending" | "submitting", _, _) => "pending",
        ("resolved", true, _) => "answered",
        ("resolved", false, true) => "denied",
        ("resolved", false, false) => "approved",
        (other, _, _) => other,
    }
}

pub(super) fn runner_capability(record: &Value) -> Option<Value> {
    let reason = match record["responseCapability"]["reason"].as_str() {
        Some("providerCancelled") => "providerWithdrew",
        Some(reason) => reason,
        None => "unknown",
    };
    match record["status"].as_str().expect("status") {
        "pending" => Some(json!({"type": "live"})),
        "resolved" => None,
        _ => Some(json!({"type": "notResumable", "reason": reason})),
    }
}

pub(super) fn runner_item(record: &Value, started: u64) -> Value {
    let created = record["createdAtEpochMs"].as_u64().expect("created");
    let created_at = Some(created).filter(|created| *created != started).map(iso);
    let settled_at = record["resolvedAtEpochMs"]
        .as_u64()
        .filter(|resolved| *resolved != created)
        .map(iso);
    let mut item = json!({
        "id": record["id"],
        "taskId": record["turnId"],
        "provider": record["provider"],
        "status": runner_status(record),
        "createdAt": created_at,
        "settledAt": settled_at,
    });
    if let Some(capability) = runner_capability(record) {
        item["responseCapability"] = capability;
    }
    let body = &record["body"];
    if body["kind"] == "question" {
        item["questions"] = body["questions"].clone();
        if record["status"] == "resolved" {
            item["answers"] = record["resolution"]["answers"].clone();
        }
        return item;
    }
    for key in ["title", "detail", "detailTruncated", "facts", "decisions"] {
        item[key] = body[key].clone();
    }
    item["kind"] = body["approvalKind"].clone();
    item["expiresAt"] = EXPIRES_AT.into();
    if record["status"] == "resolved" {
        item["decision"] = record["resolution"]["decision"].clone();
    }
    item
}

pub(super) fn rebuilt_by_client(runner: &FakeRunner, thread: &str) {
    let cache = runner.ledger.requests();
    if cache.has_rebuilt(thread) {
        return;
    }
    let standing = cache.current();
    let source = standing.source.unwrap_or(InteractionSource::Snapshot);
    cache.mark_rebuilt(
        thread,
        &epoch(source, runner.ledger.serial(), standing.generation),
    );
}
