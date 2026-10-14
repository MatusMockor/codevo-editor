use super::super::interactions_fake::*;
use super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
use super::super::thread_requests_ipc::ThreadRespondOutcome;
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};

#[test]
fn delivered_answer_returns_a_resolved_record_above_the_live_one_and_drops_the_cache_entry() {
    let runner = FakeRunner::replying(vec![Ok(live())]);
    let turns = || vec![turn(TASK, STARTED, Some(3), false)];
    let before = list(&runner, turns(), None).unwrap();
    assert_eq!(records(&before)[1]["version"], 7);
    assert!(runner.ledger.requests().holds(TASK));
    runner.queue(vec![Ok(live()), approved("allowOnce")]);
    let result = respond(&runner, APPROVAL, decide("allowOnce")).unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::Answered);
    let message = wire(&result)["message"].clone();
    assert_eq!(message["workspaceId"], SERVER);
    assert_eq!(message["threadId"], THREAD);
    assert_eq!(message["epoch"], "rr1-snapshot");
    assert_eq!(message["truncated"], false);
    assert_eq!(message["reset"], false);
    let record = &message["requests"][0];
    assert_eq!(message["requests"].as_array().map(Vec::len), Some(1));
    assert_eq!(record["id"], APPROVAL);
    assert_eq!(record["turnId"], TASK);
    assert_eq!(record["status"], "resolved");
    assert_eq!(record["version"], 8);
    assert_eq!(record["order"], 1);
    assert_eq!(record["createdAtEpochMs"], CREATED);
    assert_eq!(record["resolvedAtEpochMs"], CREATED);
    assert_eq!(
        record["resolution"],
        json!({"kind": "decision", "decision": "allowOnce"})
    );
    assert_eq!(posts(&runner), 1);
    assert!(!runner.ledger.requests().holds(TASK));
    runner.queue(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    let after = list(&runner, turns(), None).unwrap();
    assert_eq!(runner.calls().len(), 4);
    assert_eq!(records(&after)[1]["version"], 9);
}

#[test]
fn conflict_closes_the_request_as_a_submitting_record_and_is_never_sent_again() {
    let runner = FakeRunner::replying(vec![Ok(live()), conflict(), Ok(live())]);
    let result = respond(&runner, QUESTION, choose("sqlite")).unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::NotAnswerable);
    let record = wire(&result)["message"]["requests"][0].clone();
    assert_eq!(record["id"], QUESTION);
    assert_eq!(record["status"], "submitting");
    assert_eq!(
        record["responseCapability"],
        json!({"kind": "notResumable", "reason": "unknown"})
    );
    assert_eq!(record["resolution"], Value::Null);
    assert_eq!(record["resolvedAtEpochMs"], Value::Null);
    assert_eq!(record["version"], 8);
    assert_eq!(record["order"], 0);
    assert_eq!(posts(&runner), 1);
    assert_eq!(runner.calls().len(), 3);
    let moved_on = FakeRunner::replying(vec![
        Ok(live()),
        conflict(),
        Ok(snapshot("answeredAndDecided")),
    ]);
    let result = respond(&moved_on, QUESTION, choose("postgres")).unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::NotAnswerable);
    let record = wire(&result)["message"]["requests"][0].clone();
    assert_eq!(record["status"], "resolved");
    assert_eq!(record["version"], 13);
    assert_eq!(posts(&moved_on), 1);
}

#[test]
fn request_that_cannot_be_answered_is_reported_without_posting() {
    let settled = FakeRunner::replying(vec![Ok(snapshot("everySettleReasonOnQuestions"))]);
    let result = respond(
        &settled,
        "a0000000-0000-4000-8000-000000000003",
        choose("sqlite"),
    )
    .unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::NotAnswerable);
    let record = wire(&result)["message"]["requests"][0].clone();
    assert_eq!(record["status"], "expired");
    assert_eq!(record["responseCapability"]["reason"], "turnEnded");
    assert_eq!(record["version"], 25);
    assert_eq!(record["order"], 2);
    let waiting = FakeRunner::replying(vec![Ok(snapshot("pendingWithoutWaiter"))]);
    let result = respond(&waiting, APPROVAL, decide("deny")).unwrap();
    let record = wire(&result)["message"]["requests"][0].clone();
    assert_eq!(record["status"], "submitting");
    assert_eq!(record["version"], 4);
    let gone = FakeRunner::replying(vec![Ok(snapshot("empty"))]);
    let result = respond(&gone, APPROVAL, decide("deny")).unwrap();
    assert_eq!(
        wire(&result),
        json!({"outcome": "notAnswerable", "message": null})
    );
    let unknown_task = FakeRunner::replying(vec![not_found(), not_found()]);
    let result = respond(&unknown_task, APPROVAL, decide("deny")).unwrap();
    assert_eq!(
        wire(&result),
        json!({"outcome": "notAnswerable", "message": null})
    );
    for runner in [&settled, &waiting, &gone, &unknown_task] {
        assert_eq!(posts(runner), 0);
    }
}

#[test]
fn request_that_was_never_sent_fails_with_its_reason() {
    let stale = FakeRunner::replying(vec![Ok(live())]);
    stale.current.set(false);
    assert_eq!(
        respond(&stale, APPROVAL, decide("deny")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    assert!(stale.calls().is_empty());
    let revoked_before_post = FakeRunner {
        revoke_on_call: Some(1),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        respond(&revoked_before_post, APPROVAL, decide("deny")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    let finished_then_revoked = FakeRunner::replying(vec![Ok(snapshot("pendingWithoutWaiter"))]);
    let request = respond_request(TASK, APPROVAL, decide("deny"));
    let delivery = attempt(&finished_then_revoked, &request, Instant::now());
    finished_then_revoked.current.set(false);
    assert_eq!(
        settle_response(&finished_then_revoked, &request, delivery, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    let foreign = FakeRunner {
        runner: "other-runner".into(),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        respond(&foreign, APPROVAL, decide("deny")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::RunnerChanged)
    );
    let unreadable = FakeRunner::replying(vec![Err(UNAVAILABLE.to_string())]);
    assert_eq!(
        respond(&unreadable, APPROVAL, decide("deny")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Transport(UNAVAILABLE.into()))
    );
    let not_offered = FakeRunner::replying(vec![Ok(live())]);
    assert_eq!(
        respond(&not_offered, QUESTION, choose("oracle")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::InvalidRequest)
    );
    let wire_id = FakeRunner::replying(vec![Ok(live())]);
    assert_eq!(
        respond(&wire_id, "req-0002", decide("deny")).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::InvalidRequest)
    );
    assert!(wire_id.calls().is_empty());
    for runner in [
        &revoked_before_post,
        &finished_then_revoked,
        &foreign,
        &unreadable,
        &not_offered,
    ] {
        assert_eq!(posts(runner), 0);
    }
}

#[test]
fn every_failure_after_the_post_was_sent_is_an_uncertain_delivery_and_is_not_retried() {
    let uncertain = json!({"outcome": "deliveryUncertain", "message": null});
    let mut other = legacy_approval("approved");
    other["decision"] = "allowForSession".into();
    for (name, after_post) in [
        ("unavailable", Err(UNAVAILABLE.to_string())),
        (
            "connection lost",
            Err("Runner connection failed. The request outcome may be unknown.".to_string()),
        ),
        ("gone", not_found()),
        ("malformed", Ok(json!({"request": "done"}))),
        ("unconfirmed", Ok(json!({"request": other}))),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live()), after_post]);
        let result = respond(&runner, APPROVAL, decide("allowOnce")).unwrap();
        assert_eq!(wire(&result), uncertain, "{name}");
        assert_eq!(posts(&runner), 1, "{name}");
        assert_eq!(runner.calls().len(), 2, "{name}");
    }
    let reread_fails =
        FakeRunner::replying(vec![Ok(live()), conflict(), Err(UNAVAILABLE.to_string())]);
    let result = respond(&reread_fails, APPROVAL, decide("allowOnce")).unwrap();
    assert_eq!(wire(&result), uncertain);
    assert_eq!(posts(&reread_fails), 1);
    let revoked_during_post = FakeRunner {
        revoke_on_call: Some(2),
        ..FakeRunner::replying(vec![Ok(live()), approved("allowOnce")])
    };
    let result = respond(&revoked_during_post, APPROVAL, decide("allowOnce")).unwrap();
    assert_eq!(wire(&result), uncertain);
    let swapped_during_post = FakeRunner {
        swap_on_call: Some(2),
        ..FakeRunner::replying(vec![Ok(live()), approved("allowOnce")])
    };
    let result = respond(&swapped_during_post, APPROVAL, decide("allowOnce")).unwrap();
    assert_eq!(wire(&result), uncertain);
    let finished_then_revoked = FakeRunner::replying(vec![Ok(live()), approved("allowOnce")]);
    let request = respond_request(TASK, APPROVAL, decide("allowOnce"));
    let delivery = attempt(&finished_then_revoked, &request, Instant::now());
    finished_then_revoked.current.set(false);
    let result = settle_response(&finished_then_revoked, &request, delivery, far()).unwrap();
    assert_eq!(wire(&result), uncertain);
    for runner in [
        &revoked_during_post,
        &swapped_during_post,
        &finished_then_revoked,
    ] {
        assert_eq!(posts(runner), 1);
        assert_eq!(runner.calls().len(), 2);
    }
}

#[test]
fn legacy_answer_carries_the_legacy_epoch_the_client_rebuilt_into() {
    let now = Instant::now();
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        items(vec![legacy_approval("pending")]),
        not_found(),
        items(vec![legacy_question("pending")]),
        items(vec![legacy_approval("pending")]),
        Ok(json!({"request": answered})),
    ]);
    let pulled = list_at(&runner, vec![turn(TASK, STARTED, None, false)], None, now).unwrap();
    assert_eq!(epoch_of(&pulled), legacy_epoch(&runner));
    let request = respond_request(TASK, QUESTION, choose("sqlite"));
    let delivery = attempt(&runner, &request, now);
    let result = settle_response(&runner, &request, delivery, far()).unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::Answered);
    let message = wire(&result)["message"].clone();
    assert_eq!(message["epoch"], legacy_epoch(&runner));
    let record = &message["requests"][0];
    assert_eq!(record["status"], "resolved");
    assert_eq!(record["version"], 4);
    assert_eq!(record["createdAtEpochMs"], STARTED);
    assert_eq!(record["resolvedAtEpochMs"], STARTED);
}

#[test]
fn answer_read_from_another_source_than_the_client_holds_returns_no_message() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(1, "expired"));
    runner.ledger.remember_legacy_runner(now);
    let legacy = list_at(&runner, vec![ended(1, None)], None, now).unwrap();
    assert_eq!(epoch_of(&legacy), legacy_epoch(&runner));
    runner.queue(vec![Ok(live()), approved("allowOnce")]);
    let request = respond_request(TASK, APPROVAL, decide("allowOnce"));
    let delivery = attempt(&runner, &request, now + LEGACY_PROBE_INTERVAL);
    let result = settle_response(&runner, &request, delivery, far()).unwrap();
    assert_eq!(
        wire(&result),
        json!({"outcome": "answered", "message": null})
    );
    assert!(runner.ledger.requests().holds(&task(1)));
    assert_eq!(
        epoch_of(&list_at(&runner, vec![], None, now).unwrap()),
        legacy_epoch(&runner)
    );
}

#[test]
fn no_ledger_or_cache_lock_is_held_while_the_runner_is_called() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![
        reply(1, "answeredAndDecided", 6),
        reply(2, "livePendingQuestionAndApproval", 3),
    ]);
    let turns = || vec![ended(1, Some(6)), running(2, Some(3))];
    list_at(&runner, turns(), None, now).unwrap();
    let legacy = FakeRunner::replying(first_legacy_read(3, "pending"));
    legacy.queue(legacy_lists(3, "pending"));
    list_at(&legacy, vec![running(3, None)], None, now).unwrap();
    list_at(&legacy, vec![running(3, None)], None, now).unwrap();
    let snapshot_runner =
        FakeRunner::replying(vec![Ok(live()), Ok(live()), conflict(), Ok(live())]);
    list(
        &snapshot_runner,
        vec![turn(TASK, STARTED, Some(3), false)],
        None,
    )
    .unwrap();
    respond(&snapshot_runner, APPROVAL, decide("deny")).unwrap();
    assert!(!legacy.called_under_lock.get());
    assert_eq!(legacy.calls().len(), 6);
    assert_eq!(snapshot_runner.calls().len(), 4);
    assert!(!runner.called_under_lock.get());
    assert!(!snapshot_runner.called_under_lock.get());
    assert!(runner.ledger.is_unlocked());
}

#[test]
fn results_carry_no_route_runner_identity_or_connection_detail() {
    let runner = FakeRunner::replying(vec![
        reply(1, "everySettleReasonOnQuestions", 12),
        Ok(live()),
        conflict(),
        Ok(live()),
    ]);
    let page = list(&runner, vec![ended(1, Some(12))], None).unwrap();
    let result = respond(&runner, QUESTION, choose("sqlite")).unwrap();
    let page_wire = wire(&page);
    let result_wire = wire(&result);
    let keys = |value: &Value| -> Vec<String> {
        let mut keys: Vec<String> = value.as_object().expect("record").keys().cloned().collect();
        keys.sort();
        keys
    };
    assert_eq!(keys(&page_wire), ["message", "nextCursor"]);
    assert_eq!(keys(&result_wire), ["message", "outcome"]);
    for message in [&page_wire["message"], &result_wire["message"]] {
        assert_eq!(
            keys(message),
            [
                "epoch",
                "journal",
                "requests",
                "reset",
                "threadId",
                "truncated",
                "unreadable",
                "workspaceId"
            ]
        );
    }
    let text = format!("{page_wire}{result_wire}");
    for fragment in [
        "/v1/",
        "interactions",
        "/answer",
        "http",
        "localhost",
        RUNNER,
        "Bearer",
        "expiresAt",
        "sequence",
    ] {
        assert!(!text.contains(fragment), "{fragment}");
    }
}
