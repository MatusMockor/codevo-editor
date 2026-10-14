use super::super::interactions::InteractionSource;
use super::super::interactions_fake::*;
use super::super::thread_requests_budget::MAX_PAGE_CALLS;
use super::super::thread_requests_respond::{settle_response, Attempt};
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};

const OTHER_THREAD: &str = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

fn record_of(index: usize, conversation: Option<&str>) -> Reply {
    let mut record = json!({"id": task(index), "status": "running", "parts": []});
    if let Some(conversation) = conversation {
        record["conversationId"] = conversation.into();
    }
    Ok(record)
}

fn unjoined_list(
    runner: &FakeRunner,
    turns: Vec<TurnDescriptor>,
    thread: &str,
    cursor: Option<&str>,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    let mut request = query(turns, cursor);
    request.thread_id = thread.into();
    let now = Instant::now();
    settle_page(
        runner,
        list_under(runner, &request, &move || now, now + LIST_CEILING),
        far(),
    )
}

#[test]
fn tasks_of_another_conversation_are_refused_before_any_read() {
    let runner = FakeRunner::replying(vec![record_of(1, Some(OTHER_THREAD))]);
    assert_eq!(
        unjoined_list(&runner, vec![running(1, Some(3))], THREAD, None).unwrap_err(),
        ThreadRequestError::ForeignConversation
    );
    assert_eq!(runner.routes(), [format!("GET /v1/tasks/{}", task(1))]);
    assert_eq!(
        runner
            .ledger
            .conversations()
            .conversation(&task(1))
            .as_deref(),
        Some(OTHER_THREAD)
    );
    assert_eq!(
        unjoined_list(&runner, vec![running(1, Some(3))], THREAD, None).unwrap_err(),
        ThreadRequestError::ForeignConversation
    );
    assert_eq!(runner.calls().len(), 1);
    assert_eq!(
        ThreadRequestError::ForeignConversation.message(),
        "Runner task belongs to another conversation."
    );
}

#[test]
fn cached_reads_of_one_conversation_are_never_served_under_another() {
    let runner = FakeRunner::replying(vec![
        record_of(1, Some(THREAD)),
        reply(1, "answeredAndDecided", 6),
    ]);
    let own = unjoined_list(&runner, vec![ended(1, Some(6))], THREAD, None).unwrap();
    assert_eq!(records(&own).len(), 4);
    assert!(runner.ledger.requests().holds(&task(1)));
    assert_eq!(
        unjoined_list(&runner, vec![ended(1, Some(6))], OTHER_THREAD, None).unwrap_err(),
        ThreadRequestError::ForeignConversation
    );
    assert_eq!(runner.calls().len(), 2);
    let mixed = vec![ended(1, Some(6)), running(2, Some(3))];
    runner.queue(vec![record_of(2, None)]);
    assert_eq!(
        unjoined_list(&runner, mixed, THREAD, None).unwrap_err(),
        ThreadRequestError::ForeignConversation
    );
    runner.queue(vec![reply(2, "livePendingQuestionAndApproval", 3)]);
    let own_conversation =
        unjoined_list(&runner, vec![running(2, Some(3))], &task(2), None).unwrap();
    assert_eq!(records(&own_conversation).len(), 2);
    assert_eq!(own_conversation.message.parts().thread_id, task(2));
}

#[test]
fn answers_for_a_task_of_another_conversation_are_never_sent() {
    let runner = FakeRunner::replying(vec![record_of(1, Some(OTHER_THREAD))]);
    let mut request = respond_request(&task(1), APPROVAL, decide("allowOnce"));
    request.thread_id = THREAD.into();
    let attempt = super::super::thread_requests_respond::respond_under(
        &runner,
        &request,
        Instant::now(),
        far(),
    );
    assert!(matches!(
        attempt,
        Attempt::Refused(ThreadRequestError::ForeignConversation)
    ));
    assert_eq!(
        settle_response(&runner, &request, attempt, far()).unwrap_err(),
        ThreadRequestError::ForeignConversation
    );
    assert_eq!(runner.routes(), [format!("GET /v1/tasks/{}", task(1))]);
    let gone = FakeRunner::replying(vec![not_found()]);
    let attempt = super::super::thread_requests_respond::respond_under(
        &gone,
        &request,
        Instant::now(),
        far(),
    );
    assert_eq!(
        wire(&settle_response(&gone, &request, attempt, far()).unwrap()),
        json!({"outcome": "notAnswerable", "message": null})
    );
    let malformed = FakeRunner::replying(vec![Ok(json!({"id": task(1), "conversationId": 7}))]);
    let attempt = super::super::thread_requests_respond::respond_under(
        &malformed,
        &request,
        Instant::now(),
        far(),
    );
    assert!(settle_response(&malformed, &request, attempt, far()).is_err());
    for runner in [&runner, &gone, &malformed] {
        assert!(runner.calls().iter().all(|(method, _, _)| method == "GET"));
        assert_eq!(runner.calls().len(), 1);
    }
}

#[test]
fn conversation_lookups_count_against_the_page_budget() {
    let turns = || -> Vec<TurnDescriptor> { (1..=6).map(|index| running(index, None)).collect() };
    let mut replies = Vec::new();
    for index in 1..=6 {
        replies.push(record_of(index, Some(THREAD)));
        replies.push(reply(index, "empty", 1));
    }
    let runner = FakeRunner::replying(replies);
    let first = unjoined_list(&runner, turns(), THREAD, None).unwrap();
    assert!(first
        .next_cursor
        .as_deref()
        .is_some_and(|cursor| cursor.starts_with("t:4:")));
    assert_eq!(runner.calls().len(), MAX_PAGE_CALLS);
    let cursor = first.next_cursor.clone().expect("cursor");
    let rest = unjoined_list(&runner, turns(), THREAD, Some(&cursor)).unwrap();
    assert_eq!(rest.next_cursor, None);
    assert_eq!(runner.calls().len(), 12);
}

#[test]
fn request_that_leaves_runner_retention_while_open_is_dropped_by_a_new_epoch() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let first = list(&runner, vec![running(1, Some(3))], None).unwrap();
    assert_eq!(first.message.parts().epoch, "rr1-snapshot");
    let mut retained = sequenced(retasked(live(), &task(1)), 9);
    retained["questions"] = json!([]);
    runner.queue(vec![Ok(retained.clone()), Ok(retained)]);
    let page = list(&runner, vec![ended(1, Some(9))], None).unwrap();
    let bumped = format!("rr1-snapshot-{}-1", runner.ledger.serial());
    assert_eq!(page.message.parts().epoch, bumped);
    assert!(page.message.parts().truncated);
    assert_eq!(records(&page).len(), 1);
    assert!(records(&page).iter().all(|record| record["id"] != QUESTION));
    let mut settled = sequenced(
        retasked(snapshot("everySettleReasonOnApprovals"), &task(1)),
        10,
    );
    let mut approval = settled["approvals"][0].clone();
    approval["id"] = APPROVAL.into();
    settled["approvals"] = json!([approval]);
    runner.queue(vec![Ok(settled)]);
    let ended_page = list(&runner, vec![ended(1, Some(10))], None).unwrap();
    assert!(runner.ledger.requests().holds(&task(1)));
    let cached = list(&runner, vec![ended(1, Some(10))], None).unwrap();
    assert_eq!(cached, ended_page);
    assert_eq!(cached.message.parts().epoch, bumped);
    assert!(cached.message.parts().truncated);
    assert!(records_of(&cached, QUESTION).is_empty());
    assert_eq!(runner.calls().len(), 4);
    let other = list(&runner, vec![running(2, Some(0))], None).unwrap();
    assert_eq!(other.message.parts().epoch, bumped);
    assert!(!other.message.parts().truncated);
}

fn records_of(page: &ThreadRequestsPage, id: &str) -> Vec<Value> {
    records(page)
        .into_iter()
        .filter(|record| record["id"] == id)
        .collect()
}

#[test]
fn task_that_disappears_while_a_request_is_open_starts_a_new_epoch_once() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    list(&runner, vec![running(1, Some(3))], None).unwrap();
    runner.queue(vec![not_found(), not_found(), not_found()]);
    runner.queue(vec![not_found(), not_found(), not_found()]);
    let page = list(&runner, vec![ended(1, None)], None).unwrap();
    let bumped = format!("rr1-snapshot-{}-1", runner.ledger.serial());
    assert!(records(&page).is_empty());
    assert_eq!(page.message.parts().epoch, bumped);
    assert!(page.message.parts().truncated);
    assert!(!runner.ledger.requests().holds(&task(1)));
    runner.queue(vec![not_found(), not_found(), not_found()]);
    let again = list(&runner, vec![ended(1, None)], None).unwrap();
    assert_eq!(again, page);
    let never_open = FakeRunner::replying(vec![not_found(), not_found(), not_found()]);
    let quiet = list(&never_open, vec![ended(1, None)], None).unwrap();
    assert_eq!(quiet.message.parts().epoch, "rr1-snapshot");
    assert!(!quiet.message.parts().truncated);
}

#[test]
fn lost_evidence_of_open_requests_stops_legacy_history_from_being_skipped() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(2, "expired"));
    runner.ledger.remember_legacy_runner(now);
    let turns = || vec![ended(1, None), ended(2, None)];
    let skipped = list_at(&runner, turns(), None, now).unwrap();
    assert!(skipped.message.parts().truncated);
    assert_eq!(runner.routes().len(), 2);
    let open = runner.ledger.evidence();
    for index in 100..=400 {
        open.observe(&observed(
            retasked(live(), &task(index)),
            InteractionSource::Snapshot,
        ));
    }
    assert!(open.has_lost_open_evidence());
    runner.queue(legacy_lists(1, "expired"));
    let read = list_at(&runner, turns(), None, now).unwrap();
    assert!(read.message.parts().truncated);
    assert_eq!(
        epoch_of(&read),
        format!("rr1-legacy-{}-1", runner.ledger.serial())
    );
    assert_eq!(records(&read).len(), 4);
    assert_eq!(runner.calls().len(), 4);
}
