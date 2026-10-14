use super::super::interactions_fake::*;
use super::super::interactions_ledger::{APPROVALS_PROBE_INTERVAL, LEGACY_PROBE_INTERVAL};
use super::super::thread_requests_cache::BUMP_INTERVAL;
use super::super::thread_requests_evidence::MAX_SWITCH_DEFERRAL;
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Default)]
struct Client {
    epoch: Option<String>,
    truncated: bool,
    records: HashMap<(String, String), Value>,
}

impl Client {
    fn merge(&mut self, message: &Value) {
        let epoch = message["epoch"].as_str().expect("epoch").to_string();
        if self.epoch.as_deref() != Some(epoch.as_str()) {
            self.records.clear();
            self.truncated = false;
            self.epoch = Some(epoch);
        }
        self.truncated |= message["truncated"].as_bool().expect("truncated");
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

    fn page(&mut self, page: &ThreadRequestsPage) {
        self.merge(&wire(page)["message"]);
    }

    fn status(&self, turn: &str, id: &str) -> String {
        self.records
            .get(&(turn.to_string(), id.to_string()))
            .and_then(|record| record["status"].as_str())
            .unwrap_or("absent")
            .to_string()
    }

    fn never_closed(&self, turn: &str, id: &str) -> bool {
        matches!(
            self.status(turn, id).as_str(),
            "pending" | "submitting" | "absent"
        )
    }
}

fn record_of(index: usize) -> Reply {
    Ok(json!({"id": task(index), "conversationId": THREAD, "status": "running", "parts": []}))
}

fn bumped(runner: &FakeRunner, generation: u64) -> String {
    format!("rr1-snapshot-{}-{generation}", runner.ledger.serial())
}

#[test]
fn delayed_older_read_is_neither_cached_nor_published_and_nothing_is_closed() {
    let runner = FakeRunner::replying(vec![
        reply(1, "livePendingQuestionAndApproval", 4),
        reply(1, "empty", 3),
        reply(1, "answeredAndDecided", 5),
    ]);
    let mut client = Client::default();
    client.page(&list(&runner, vec![ended(1, None)], None).unwrap());
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert!(!runner.ledger.requests().holds(&task(1)));
    let stale = list(&runner, vec![ended(1, None)], None).unwrap();
    client.page(&stale);
    assert!(records(&stale).is_empty());
    assert!(!runner.ledger.requests().holds(&task(1)));
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    client.page(&list(&runner, vec![ended(1, None)], None).unwrap());
    assert_eq!(client.status(&task(1), QUESTION), "resolved");
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
    assert!(!client.truncated);
    assert_eq!(runner.calls().len(), 3);
}

fn approvals_unavailable(index: usize) -> Vec<Reply> {
    let mut question = legacy_question("pending");
    question["taskId"] = task(index).into();
    let questions = || items(vec![question.clone()]);
    vec![
        not_found(),
        questions(),
        not_found(),
        questions(),
        not_found(),
        not_found(),
    ]
}

#[test]
fn source_switch_is_deferred_while_known_open_approvals_cannot_be_read() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 100)]);
    let mut client = Client::default();
    client.page(&list_at(&runner, vec![running(1, None)], None, now).unwrap());
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    runner.queue(approvals_unavailable(1));
    let withheld = list_at(&runner, vec![running(1, None)], None, now).unwrap();
    client.page(&withheld);
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
    assert!(records(&withheld).is_empty());
    assert!(withheld.message.parts().truncated);
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert!(runner.ledger.evidence().has_open_requests(&task(1)));
    let recovered = now + LEGACY_PROBE_INTERVAL.max(APPROVALS_PROBE_INTERVAL);
    runner.queue(vec![reply(1, "livePendingQuestionAndApproval", 101)]);
    client.page(&list_at(&runner, vec![running(1, None)], None, recovered).unwrap());
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    assert_eq!(runner.replies.borrow().len(), 0);
}

#[test]
fn deferred_switch_gives_up_after_its_bound_without_showing_the_approval_closed() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 100)]);
    let mut client = Client::default();
    client.page(&list_at(&runner, vec![running(1, None)], None, now).unwrap());
    runner.queue(approvals_unavailable(1));
    client.page(&list_at(&runner, vec![running(1, None)], None, now).unwrap());
    let late = now + MAX_SWITCH_DEFERRAL;
    runner.queue(approvals_unavailable(1));
    let mut question = legacy_question("pending");
    question["taskId"] = task(1).into();
    runner.queue(vec![items(vec![question])]);
    let switched = list_at(&runner, vec![running(1, None)], None, late).unwrap();
    client.page(&switched);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-legacy-{}-1", runner.ledger.serial()).as_str())
    );
    assert!(client.never_closed(&task(1), APPROVAL));
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert_eq!(runner.replies.borrow().len(), 0);
}

#[test]
fn delayed_pending_read_after_an_answer_never_reopens_or_closes_it() {
    let turns = |sequence| vec![turn(TASK, STARTED, Some(sequence), false)];
    let runner = FakeRunner::replying(vec![Ok(live())]);
    let mut client = Client::default();
    client.page(&list(&runner, turns(3), None).unwrap());
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
    runner.queue(vec![Ok(live()), Ok(json!({"request": answered}))]);
    let result = respond(&runner, QUESTION, choose("sqlite")).unwrap();
    client.merge(&wire(&result)["message"]);
    assert_eq!(client.status(TASK, QUESTION), "resolved");
    runner.queue(vec![Ok(live())]);
    client.page(&list(&runner, turns(3), None).unwrap());
    assert_eq!(client.status(TASK, QUESTION), "resolved");
    let mut evicted = sequenced(live(), 90);
    evicted["questions"] = json!([]);
    evicted["questionsTruncated"] = true.into();
    runner.queue(vec![Ok(evicted)]);
    let page = list(&runner, turns(90), None).unwrap();
    client.page(&page);
    assert_eq!(client.status(TASK, QUESTION), "resolved");
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
}

#[test]
fn open_request_dropped_by_runner_retention_starts_a_new_epoch_without_inventing_a_record() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let mut client = Client::default();
    client.page(&list(&runner, vec![running(1, Some(3))], None).unwrap());
    let mut crowded = sequenced(retasked(live(), &task(1)), 90);
    let question = crowded["questions"][0].clone();
    crowded["questions"] = (0..32)
        .map(|number| {
            let mut item = question.clone();
            item["id"] = format!("a0000000-0000-4000-8000-{:012}", number + 500).into();
            item["status"] = "expired".into();
            item["settledAt"] = "2026-10-13T09:05:00.000Z".into();
            item["responseCapability"] = json!({"type": "notResumable", "reason": "turnEnded"});
            item
        })
        .collect::<Vec<_>>()
        .into();
    crowded["questionsTruncated"] = true.into();
    runner.queue(vec![Ok(crowded.clone()), Ok(crowded)]);
    let page = list(&runner, vec![ended(1, Some(90))], None).unwrap();
    client.page(&page);
    assert_eq!(client.epoch.as_deref(), Some(bumped(&runner, 1).as_str()));
    assert_eq!(client.status(&task(1), QUESTION), "absent");
    assert_eq!(client.status(&task(1), APPROVAL), "pending");
    assert!(client.truncated);
    assert!(records(&page)
        .iter()
        .all(|record| record["status"] != "expired" || record["id"] != QUESTION));
}

#[test]
fn abandoned_pull_that_saw_the_task_disappear_still_moves_the_client_to_a_new_epoch() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(1, "pending"));
    runner.ledger.remember_legacy_runner(now);
    let mut client = Client::default();
    client.page(&list_at(&runner, vec![running(1, None)], None, now).unwrap());
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    let turns = || vec![ended(1, None), ended(2, None)];
    runner.queue(vec![not_found(), not_found()]);
    runner.queue(legacy_lists(2, "expired"));
    let abandoned = list_at(&runner, turns(), None, now).unwrap();
    assert!(abandoned.message.parts().truncated);
    assert!(!runner.ledger.evidence().has_open_requests(&task(1)));
    let next = list_at(&runner, turns(), None, now).unwrap();
    client.page(&next);
    assert_eq!(
        client.epoch.as_deref(),
        Some(format!("rr1-legacy-{}-1", runner.ledger.serial()).as_str())
    );
    assert_eq!(client.status(&task(1), QUESTION), "absent");
    assert!(client.truncated);
}

#[test]
fn interaction_routes_that_answer_404_for_a_living_task_change_nothing() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let mut client = Client::default();
    client.page(&list(&runner, vec![running(1, Some(3))], None).unwrap());
    runner.queue(vec![not_found(), not_found(), record_of(1)]);
    let unrouted = list(&runner, vec![running(1, None)], None).unwrap();
    client.page(&unrouted);
    assert!(records(&unrouted).is_empty());
    assert_eq!(client.status(&task(1), QUESTION), "pending");
    assert_eq!(client.epoch.as_deref(), Some("rr1-snapshot"));
    assert!(runner.ledger.evidence().has_open_requests(&task(1)));
    runner.queue(vec![not_found(), not_found(), not_found()]);
    runner.queue(vec![not_found(), not_found(), not_found()]);
    let gone = list(&runner, vec![ended(1, None)], None).unwrap();
    client.page(&gone);
    assert_eq!(client.epoch.as_deref(), Some(bumped(&runner, 1).as_str()));
    assert_eq!(client.status(&task(1), QUESTION), "absent");
    assert!(client.truncated);
}

#[test]
fn busy_server_moves_to_a_new_epoch_at_most_once_per_interval() {
    let start = Instant::now();
    let runner = FakeRunner::replying(vec![]);
    let mut epochs = Vec::new();
    for (step, offset) in [0_u64, 10, 20, 29, 31, 40, 62].into_iter().enumerate() {
        let index = step + 1;
        let now = start + std::time::Duration::from_secs(offset);
        runner.queue(vec![reply(index, "livePendingQuestionAndApproval", 3)]);
        list_at(&runner, vec![running(index, Some(3))], None, now).unwrap();
        runner.queue(vec![not_found(), not_found(), not_found()]);
        if step == 0 {
            runner.queue(vec![not_found(), not_found(), not_found()]);
        }
        let page = list_at(&runner, vec![ended(index, None)], None, now).unwrap();
        epochs.push(epoch_of(&page));
    }
    assert_eq!(
        epochs,
        [
            bumped(&runner, 1),
            bumped(&runner, 1),
            bumped(&runner, 1),
            bumped(&runner, 1),
            bumped(&runner, 2),
            bumped(&runner, 2),
            bumped(&runner, 3),
        ]
    );
    assert_eq!(BUMP_INTERVAL, std::time::Duration::from_secs(30));
    assert_eq!(runner.replies.borrow().len(), 0);
}

#[test]
fn cached_read_older_than_the_task_mark_is_never_served() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    list(&runner, vec![running(1, Some(3))], None).unwrap();
    assert!(runner.ledger.requests().holds(&task(1)));
    let newer = observed(
        sequenced(retasked(snapshot("answeredAndDecided"), &task(1)), 6),
        super::super::interactions::InteractionSource::Snapshot,
    );
    runner.ledger.evidence().observe(&newer);
    runner.queue(vec![reply(1, "answeredAndDecided", 6)]);
    let page = list(&runner, vec![running(1, Some(3))], None).unwrap();
    assert_eq!(runner.calls().len(), 2);
    assert!(records(&page)
        .iter()
        .all(|record| record["status"] == "resolved"));
}
