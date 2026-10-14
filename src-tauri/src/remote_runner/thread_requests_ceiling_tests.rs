use super::super::interactions_fake::*;
use super::super::interactions_respond::RemoteRequestResponse;
use super::super::thread_requests_ipc::ThreadRespondResult;
use super::super::thread_requests_respond::{respond_under, settle_response, RESPOND_CEILING};
use super::super::thread_requests_support::*;
use super::*;

fn paced(delay: Duration, silent_from: Option<usize>, replies: Vec<Reply>) -> FakeRunner {
    FakeRunner {
        call_delay: delay,
        silent_from,
        ..FakeRunner::replying(replies)
    }
}

fn list_paced(
    runner: &FakeRunner,
    turns: Vec<TurnDescriptor>,
) -> Result<ThreadRequestsPage, ThreadRequestError> {
    let tasks: Vec<String> = turns.iter().map(|turn| turn.turn_id.clone()).collect();
    runner.joined(&tasks, THREAD);
    let clock = || runner.clock();
    let ceiling = runner.clock() + LIST_CEILING;
    list_under(runner, &query(turns, None), &clock, ceiling)
}

fn respond_paced(
    runner: &FakeRunner,
    (request_id, response): (&str, RemoteRequestResponse),
) -> Result<ThreadRespondResult, ThreadRequestError> {
    let request = respond_request(TASK, request_id, response);
    runner.joined(std::slice::from_ref(&request.turn.turn_id), THREAD);
    let ceiling = runner.clock() + RESPOND_CEILING;
    let attempt = respond_under(runner, &request, runner.clock(), ceiling);
    settle_response(runner, &request, attempt, ceiling)
}

fn posts(runner: &FakeRunner) -> usize {
    runner
        .calls()
        .iter()
        .filter(|(method, _, _)| method == "POST")
        .count()
}

#[test]
fn list_against_a_runner_that_never_answers_rejects_within_the_ceiling() {
    let silent = paced(Duration::ZERO, Some(1), vec![]);
    let error = list_paced(&silent, vec![running(1, None)]).unwrap_err();
    assert!(matches!(
        error,
        ThreadRequestError::Interaction(InteractionError::Transport(_))
    ));
    assert_eq!(silent.elapsed.get(), TRANSPORT_TIMEOUT);
    assert!(silent.elapsed.get() <= LIST_CEILING);
    let slow = paced(
        Duration::from_secs(25),
        None,
        vec![not_found(), items(vec![legacy_question("pending")])],
    );
    assert_eq!(
        list_paced(&slow, vec![turn(TASK, STARTED, None, false)]).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert_eq!(slow.elapsed.get(), LIST_CEILING);
    assert_eq!(slow.calls().len(), 3);
    let deadlines = slow.deadlines.borrow().clone();
    assert!(deadlines
        .iter()
        .all(|deadline| *deadline == Some(slow.base + LIST_CEILING)));
    assert_eq!(
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded).message(),
        "Runner did not answer in time"
    );
    assert_eq!(LIST_CEILING, Duration::from_secs(60));
}

#[test]
fn list_that_finished_its_first_turn_before_the_ceiling_returns_it() {
    let runner = paced(
        Duration::from_secs(59),
        None,
        vec![reply(1, "livePendingQuestionAndApproval", 3)],
    );
    let page = list_paced(&runner, vec![running(1, Some(3)), running(2, Some(3))]).unwrap();
    assert_eq!(records(&page).len(), 2);
    assert!(page.next_cursor.is_some());
    assert_eq!(runner.calls().len(), 1);
}

#[test]
fn list_whose_worker_starts_after_the_ceiling_rejects_without_calling_the_runner() {
    let runner = FakeRunner::replying(vec![reply(1, "empty", 1)]);
    runner.joined(&[task(1)], THREAD);
    let clock = || runner.clock();
    let ceiling = runner.clock();
    assert_eq!(
        list_under(
            &runner,
            &query(vec![running(1, Some(1))], None),
            &clock,
            ceiling
        )
        .unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert!(runner.calls().is_empty());
}

#[test]
fn answer_to_a_runner_that_never_answers_before_the_post_is_rejected_unsent() {
    let silent = paced(Duration::ZERO, Some(1), vec![]);
    let error = respond_paced(&silent, (APPROVAL, decide("allowOnce"))).unwrap_err();
    assert!(matches!(
        error,
        ThreadRequestError::Interaction(InteractionError::Transport(_))
    ));
    assert_eq!(silent.elapsed.get(), TRANSPORT_TIMEOUT);
    assert_eq!(posts(&silent), 0);
    let slow_legacy = paced(Duration::from_secs(70), None, vec![not_found()]);
    assert_eq!(
        respond_paced(&slow_legacy, (APPROVAL, decide("allowOnce"))).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert_eq!(slow_legacy.elapsed.get(), RESPOND_CEILING);
    assert_eq!(posts(&slow_legacy), 0);
    let read_at_the_ceiling = paced(RESPOND_CEILING, None, vec![Ok(live())]);
    assert_eq!(
        respond_paced(&read_at_the_ceiling, (APPROVAL, decide("allowOnce"))).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert_eq!(posts(&read_at_the_ceiling), 0);
    assert_eq!(read_at_the_ceiling.calls().len(), 1);
    assert_eq!(RESPOND_CEILING, Duration::from_secs(120));
}

#[test]
fn answer_whose_post_gets_no_reply_is_an_uncertain_delivery_within_the_ceiling() {
    let silent_post = paced(Duration::ZERO, Some(2), vec![Ok(live())]);
    let result = respond_paced(&silent_post, (APPROVAL, decide("allowOnce"))).unwrap();
    assert_eq!(
        wire(&result),
        serde_json::json!({"outcome": "deliveryUncertain", "message": null})
    );
    assert_eq!(posts(&silent_post), 1);
    assert_eq!(silent_post.elapsed.get(), TRANSPORT_TIMEOUT);
    let slow_post = paced(Duration::from_secs(70), None, vec![Ok(live())]);
    let result = respond_paced(&slow_post, (APPROVAL, decide("allowOnce"))).unwrap();
    assert_eq!(
        wire(&result),
        serde_json::json!({"outcome": "deliveryUncertain", "message": null})
    );
    assert_eq!(posts(&slow_post), 1);
    assert_eq!(slow_post.elapsed.get(), RESPOND_CEILING);
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let confirmed_late = paced(
        Duration::from_secs(60),
        None,
        vec![Ok(live()), Ok(serde_json::json!({"request": approved}))],
    );
    let result = respond_paced(&confirmed_late, (APPROVAL, decide("allowOnce"))).unwrap();
    assert_eq!(
        wire(&result),
        serde_json::json!({"outcome": "deliveryUncertain", "message": null})
    );
    let deadlines = confirmed_late.deadlines.borrow().clone();
    assert!(deadlines
        .iter()
        .all(|deadline| *deadline == Some(confirmed_late.base + RESPOND_CEILING)));
}

#[test]
fn answer_that_settles_before_the_ceiling_keeps_its_outcome() {
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let runner = paced(
        Duration::from_secs(59),
        None,
        vec![Ok(live()), Ok(serde_json::json!({"request": approved}))],
    );
    let result = respond_paced(&runner, (APPROVAL, decide("allowOnce"))).unwrap();
    assert_eq!(wire(&result)["outcome"], "answered");
    assert_eq!(runner.elapsed.get(), Duration::from_secs(118));
}

#[test]
fn list_worker_that_starts_after_the_ceiling_rejects_even_with_everything_cached() {
    let runner = FakeRunner::replying(vec![reply(1, "answeredAndDecided", 6)]);
    let page = list_paced(&runner, vec![ended(1, Some(6))]).unwrap();
    assert_eq!(records(&page).len(), 4);
    assert!(runner.ledger.requests().holds(&task(1)));
    let clock = || runner.clock();
    let ceiling = runner.clock();
    assert_eq!(
        list_under(
            &runner,
            &query(vec![ended(1, Some(6))], None),
            &clock,
            ceiling
        )
        .unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    let finished = list_under(
        &runner,
        &query(vec![ended(1, Some(6))], None),
        &clock,
        runner.clock() + LIST_CEILING,
    );
    runner.elapsed.set(runner.elapsed.get() + LIST_CEILING);
    assert_eq!(
        settle_page(&runner, finished, runner.base + LIST_CEILING).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert_eq!(runner.calls().len(), 1);
}

#[test]
fn response_settled_after_the_ceiling_follows_the_delivery_evidence() {
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let delivered = FakeRunner::replying(vec![
        Ok(live()),
        Ok(serde_json::json!({"request": approved})),
    ]);
    let request = respond_request(TASK, APPROVAL, decide("allowOnce"));
    delivered.joined(std::slice::from_ref(&request.turn.turn_id), THREAD);
    let ceiling = delivered.clock() + RESPOND_CEILING;
    let attempt = respond_under(&delivered, &request, delivered.clock(), ceiling);
    delivered.elapsed.set(RESPOND_CEILING);
    assert_eq!(
        wire(&settle_response(&delivered, &request, attempt, ceiling).unwrap()),
        serde_json::json!({"outcome": "deliveryUncertain", "message": null})
    );
    let gone = FakeRunner::replying(vec![not_found()]);
    let ceiling = gone.clock() + RESPOND_CEILING;
    let attempt = respond_under(&gone, &request, gone.clock(), ceiling);
    gone.elapsed.set(RESPOND_CEILING);
    assert_eq!(
        settle_response(&gone, &request, attempt, ceiling).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    let settled = FakeRunner::replying(vec![Ok(snapshot("everySettleReasonOnApprovals"))]);
    settled.joined(std::slice::from_ref(&request.turn.turn_id), THREAD);
    let ceiling = settled.clock() + RESPOND_CEILING;
    let attempt = respond_under(&settled, &request, settled.clock(), ceiling);
    settled.elapsed.set(RESPOND_CEILING);
    assert_eq!(
        settle_response(&settled, &request, attempt, ceiling).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
}

#[test]
fn answer_that_never_left_the_desktop_is_not_an_uncertain_delivery() {
    let unsent = FakeRunner {
        unsent_posts: true,
        ..FakeRunner::replying(vec![Ok(live())])
    };
    let error = respond_paced(&unsent, (APPROVAL, decide("allowOnce"))).unwrap_err();
    assert_eq!(
        error,
        ThreadRequestError::Interaction(InteractionError::Transport(
            "Runner connection was superseded.".into()
        ))
    );
    assert_eq!(posts(&unsent), 1);
    let late = FakeRunner {
        unsent_posts: true,
        ..FakeRunner::replying(vec![Ok(live())])
    };
    let request = respond_request(TASK, APPROVAL, decide("allowOnce"));
    late.joined(std::slice::from_ref(&request.turn.turn_id), THREAD);
    let ceiling = late.clock() + RESPOND_CEILING;
    let attempt = respond_under(&late, &request, late.clock(), ceiling);
    late.elapsed.set(RESPOND_CEILING);
    assert_eq!(
        settle_response(&late, &request, attempt, ceiling).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
}
