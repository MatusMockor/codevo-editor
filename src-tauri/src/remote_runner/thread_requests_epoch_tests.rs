use super::super::interactions::InteractionSource;
use super::super::interactions_fake::*;
use super::super::thread_requests_respond::{settle_response, RESPOND_CEILING};
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Default)]
struct Client {
    epoch: Option<String>,
    records: HashMap<(String, String), Value>,
}

impl Client {
    fn merge(&mut self, message: &Value) {
        if message.is_null() {
            return;
        }
        let epoch = message["epoch"].as_str().expect("epoch").to_string();
        if self.epoch.as_deref() != Some(epoch.as_str()) {
            self.records.clear();
            self.epoch = Some(epoch);
        }
        for record in message["requests"].as_array().expect("requests") {
            let key = (
                record["turnId"].as_str().expect("turn").to_string(),
                record["id"].as_str().expect("id").to_string(),
            );
            let newer = self
                .records
                .get(&key)
                .is_none_or(|known| record["version"].as_u64() > known["version"].as_u64());
            if newer {
                self.records.insert(key, record.clone());
            }
        }
    }

    fn status(&self, turn: &str, id: &str) -> String {
        self.records
            .get(&(turn.to_string(), id.to_string()))
            .and_then(|record| record["status"].as_str())
            .unwrap_or("absent")
            .to_string()
    }
}

fn approved() -> Reply {
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    Ok(json!({"request": approved}))
}

#[test]
fn answer_delivered_across_another_threads_bump_never_deletes_a_live_request() {
    let now = Instant::now();
    let turns = || vec![turn(TASK, STARTED, Some(3), false)];
    let runner = FakeRunner::replying(vec![Ok(live())]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, turns(), None, now).unwrap())["message"]);
    assert_eq!(client.status(TASK, QUESTION), "pending");
    assert_eq!(client.status(TASK, APPROVAL), "pending");
    runner.ledger.requests().request_bump();
    let mut other = query(vec![], None);
    other.thread_id = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d".into();
    list_under(&runner, &other, &move || now, now + LIST_CEILING).unwrap();
    runner.queue(vec![Ok(live()), approved()]);
    let result = respond(&runner, APPROVAL, decide("allowOnce")).unwrap();
    let result = wire(&result);
    assert_eq!(result, json!({"outcome": "answered", "message": null}));
    client.merge(&result["message"]);
    assert_eq!(client.status(TASK, QUESTION), "pending");
    assert_eq!(client.status(TASK, APPROVAL), "pending");
    runner.queue(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    client.merge(&wire(&list_at(&runner, turns(), None, now).unwrap())["message"]);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-snapshot-{}-1", runner.ledger.serial()).as_str())
    );
    assert_eq!(client.status(TASK, APPROVAL), "resolved");
}

#[test]
fn answer_built_while_a_bump_waits_keeps_the_epoch_the_client_holds() {
    let now = Instant::now();
    let turns = || vec![turn(TASK, STARTED, Some(3), false)];
    let runner = FakeRunner::replying(vec![Ok(live())]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, turns(), None, now).unwrap())["message"]);
    runner.ledger.requests().request_bump();
    runner.queue(vec![Ok(live()), approved()]);
    let result = wire(&respond(&runner, APPROVAL, decide("allowOnce")).unwrap());
    assert_eq!(result["message"]["epoch"], "rr1-snapshot");
    client.merge(&result["message"]);
    assert_eq!(client.status(TASK, APPROVAL), "resolved");
    assert_eq!(client.status(TASK, QUESTION), "pending");
}

#[test]
fn first_page_that_observes_a_disappearance_is_republished_in_the_new_epoch() {
    let runner = FakeRunner::replying(vec![
        reply(1, "livePendingQuestionAndApproval", 3),
        reply(2, "livePendingQuestionAndApproval", 3),
    ]);
    let turns = |sequence| vec![running(1, Some(3)), ended(2, sequence)];
    let mut client = Client::default();
    client.merge(&wire(&list(&runner, turns(Some(3)), None).unwrap())["message"]);
    assert_eq!(client.status(&task(2), QUESTION), "pending");
    let mut retained = sequenced(retasked(live(), &task(2)), 9);
    retained["questions"] = json!([]);
    runner.queue(vec![Ok(retained.clone()), Ok(retained)]);
    let page = list(&runner, turns(Some(9)), None).unwrap();
    client.merge(&wire(&page)["message"]);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-snapshot-{}-1", runner.ledger.serial()).as_str())
    );
    assert_eq!(client.status(&task(2), QUESTION), "absent");
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert_eq!(client.status(&task(2), APPROVAL), "pending");
}

#[test]
fn rebuilt_projection_never_resurrects_an_answer_as_pending() {
    let now = Instant::now();
    let turns = || vec![turn(TASK, STARTED, Some(3), false)];
    let runner = FakeRunner::replying(vec![Ok(live())]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, turns(), None, now).unwrap())["message"]);
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
    runner.queue(vec![Ok(live()), Ok(json!({"request": answered}))]);
    client.merge(&wire(&respond(&runner, QUESTION, choose("sqlite")).unwrap())["message"]);
    assert_eq!(client.status(TASK, QUESTION), "resolved");
    runner.queue(vec![Ok(live())]);
    client.merge(&wire(&list_at(&runner, turns(), None, now).unwrap())["message"]);
    assert!(runner.ledger.requests().holds(TASK));
    runner.ledger.requests().request_bump();
    let rebuilt = list_at(&runner, turns(), None, now).unwrap();
    client.merge(&wire(&rebuilt)["message"]);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-snapshot-{}-1", runner.ledger.serial()).as_str())
    );
    assert_ne!(client.status(TASK, QUESTION), "pending");
    assert_eq!(client.status(TASK, APPROVAL), "pending");
}

#[test]
fn delayed_read_of_the_previous_source_cannot_take_authority_back() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 100)]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    runner.queue(first_legacy_read(1, "pending"));
    runner.queue(legacy_lists(1, "pending"));
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    let legacy_epoch = client.epoch.clone();
    let later = now + super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
    runner.queue(vec![reply(1, "empty", 90)]);
    let delayed = list_at(&runner, vec![running(1, None)], None, later).unwrap();
    client.merge(&wire(&delayed)["message"]);
    assert_eq!(client.epoch, legacy_epoch);
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert_eq!(
        runner.ledger.requests().current().source,
        Some(InteractionSource::Legacy)
    );
    assert!(!runner.ledger.evidence().is_incomplete(&task(1)));
}

#[test]
fn settlement_that_crosses_the_ceiling_is_rechecked_before_returning() {
    let runner = FakeRunner::replying(vec![Ok(live()), approved()]);
    let request = respond_request(TASK, APPROVAL, decide("allowOnce"));
    let delivery = attempt(&runner, &request, runner.clock());
    let ceiling = runner.clock() + std::time::Duration::from_secs(90);
    runner.now_tick.set(std::time::Duration::from_secs(60));
    assert_eq!(
        wire(&settle_response(&runner, &request, delivery, ceiling).unwrap()),
        json!({"outcome": "deliveryUncertain", "message": null})
    );
    let gone = FakeRunner::replying(vec![Ok(snapshot("empty"))]);
    let delivery = attempt(&gone, &request, gone.clock());
    let ceiling = gone.clock() + std::time::Duration::from_secs(90);
    gone.now_tick.set(std::time::Duration::from_secs(60));
    assert_eq!(
        settle_response(&gone, &request, delivery, ceiling).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert_eq!(RESPOND_CEILING, std::time::Duration::from_secs(120));
}

#[test]
fn every_message_of_a_connection_that_forgot_an_invalidation_is_truncated_even_when_empty() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![]);
    let evidence = runner.ledger.evidence();
    evidence.observe(&observed(
        retasked(live(), &task(1)),
        InteractionSource::Snapshot,
    ));
    evidence.vanish(&task(1));
    for index in 2..=300 {
        evidence.observe(&observed(
            retasked(snapshot("answeredAndDecided"), &task(index)),
            InteractionSource::Snapshot,
        ));
    }
    assert!(evidence.is_connection_incomplete());
    let empty = list_at(&runner, vec![], None, now).unwrap();
    assert!(empty.message.parts().truncated);
}

#[test]
fn continuation_whose_own_read_switches_the_source_is_refused() {
    let now = Instant::now();
    let turns = || -> Vec<TurnDescriptor> { (1..=6).map(|index| running(index, None)).collect() };
    let runner = FakeRunner::replying(first_legacy_read(1, "pending"));
    for index in 2..=3 {
        runner.queue(legacy_lists(index, "pending"));
    }
    let first = list_at(&runner, turns(), None, now).unwrap();
    let cursor = first.next_cursor.clone().expect("next cursor");
    let later = now + super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
    runner.queue(vec![reply(4, "empty", 1)]);
    assert_eq!(
        list_at(&runner, turns(), Some(&cursor), later).unwrap_err(),
        ThreadRequestError::StaleCursor
    );
    assert_eq!(runner.ledger.requests().current().generation, 1);
}

#[test]
fn settlement_published_by_a_page_is_never_undone_by_a_delayed_pending_read() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    let settled_lists = || {
        let mut question = legacy_question("answered");
        question["taskId"] = task(1).into();
        question["answers"] =
            json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
        let mut approval = legacy_approval("approved");
        approval["taskId"] = task(1).into();
        approval["decision"] = "allowOnce".into();
        vec![items(vec![question]), items(vec![approval])]
    };
    runner.queue(vec![not_found()]);
    runner.queue(settled_lists());
    runner.queue(vec![not_found()]);
    runner.queue(settled_lists());
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    assert_eq!(client.status(&task(1), QUESTION), "resolved");
    assert_eq!(client.status(&task(1), APPROVAL), "resolved");
    let later = now + super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
    runner.queue(vec![
        reply(1, "livePendingQuestionAndApproval", 3),
        reply(1, "livePendingQuestionAndApproval", 3),
    ]);
    let delayed = list_at(&runner, vec![running(1, None)], None, later).unwrap();
    client.merge(&wire(&delayed)["message"]);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-snapshot-{}-2", runner.ledger.serial()).as_str())
    );
    assert_ne!(client.status(&task(1), QUESTION), "pending");
    assert_ne!(client.status(&task(1), APPROVAL), "pending");
    assert_eq!(runner.replies.borrow().len(), 0);
}

#[test]
fn another_threads_complete_read_cannot_cut_a_deferred_approval_short() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 100)]);
    let mut client = Client::default();
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    let approvals_unavailable = || {
        let mut question = legacy_question("pending");
        question["taskId"] = task(1).into();
        let questions = || items(vec![question.clone()]);
        vec![
            not_found(),
            questions(),
            not_found(),
            questions(),
            not_found(),
            not_found(),
        ]
    };
    runner.queue(approvals_unavailable());
    client.merge(&wire(&list_at(&runner, vec![running(1, None)], None, now).unwrap())["message"]);
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    let later = now + super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
    let other_thread = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
    runner.joined(&[task(2)], other_thread);
    runner.queue(first_legacy_read(2, "expired"));
    let mut other = query(vec![running(2, None)], None);
    other.thread_id = other_thread.into();
    let deferred = list_under(&runner, &other, &move || later, later + LIST_CEILING).unwrap();
    assert!(deferred.message.parts().truncated);
    assert_eq!(
        runner.ledger.requests().current().source,
        Some(InteractionSource::Snapshot)
    );
    runner.queue(approvals_unavailable());
    client.merge(
        &wire(
            &list_at(
                &runner,
                vec![running(1, None)],
                None,
                later + later.duration_since(now),
            )
            .unwrap(),
        )["message"],
    );
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert_eq!(runner.replies.borrow().len(), 0);
}
