use super::super::interactions_fake::*;
use super::super::interactions_ledger::LEGACY_PROBE_INTERVAL;
use super::super::interactions_wire::WireError;
use super::super::thread_requests_budget::{MAX_PAGE_CALLS, PAGE_BUDGET};
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};
use std::time::Duration;

#[test]
fn page_reads_each_turn_once_into_one_message_bound_to_the_server_and_thread() {
    let runner = FakeRunner::replying(vec![
        reply(1, "answeredAndDecided", 6),
        reply(2, "livePendingQuestionAndApproval", 3),
    ]);
    let page = list(&runner, vec![ended(1, Some(6)), running(2, Some(3))], None).unwrap();
    let wire = wire(&page);
    assert_eq!(wire["nextCursor"], Value::Null);
    assert_eq!(wire["message"]["workspaceId"], SERVER);
    assert_eq!(wire["message"]["threadId"], THREAD);
    assert_eq!(wire["message"]["epoch"], "rr1-snapshot");
    assert_eq!(wire["message"]["journal"], "saved");
    assert_eq!(wire["message"]["truncated"], false);
    assert_eq!(wire["message"]["unreadable"], 0);
    assert_eq!(wire["message"]["reset"], false);
    let records = records(&page);
    let turns: Vec<&Value> = records.iter().map(|record| &record["turnId"]).collect();
    let first = json!(task(1));
    let second = json!(task(2));
    assert_eq!(turns, [&first, &first, &first, &first, &second, &second]);
    let orders: Vec<&Value> = records.iter().map(|record| &record["order"]).collect();
    assert_eq!(
        orders,
        [
            &json!(0),
            &json!(1),
            &json!(2),
            &json!(3),
            &json!(0),
            &json!(1)
        ]
    );
    assert_eq!(records[0]["version"], 13);
    assert_eq!(records[4]["version"], 7);
    assert_eq!(records[4]["status"], "pending");
    assert_eq!(records[4]["createdAtEpochMs"], CREATED);
    assert_eq!(
        runner.routes(),
        [
            format!("GET /v1/tasks/{}/interactions", task(1)),
            format!("GET /v1/tasks/{}/interactions", task(2)),
        ]
    );
}

#[test]
fn sequence_zero_and_an_empty_turn_list_never_reach_the_runner() {
    let runner = FakeRunner::replying(vec![]);
    for turns in [
        vec![],
        vec![running(1, Some(0))],
        vec![ended(1, Some(0)), running(2, Some(0)), ended(3, Some(0))],
    ] {
        let page = list(&runner, turns, None).unwrap();
        assert_eq!(
            wire(&page),
            json!({
                "message": {
                    "workspaceId": SERVER,
                    "threadId": THREAD,
                    "epoch": "rr1-snapshot",
                    "journal": "saved",
                    "requests": [],
                    "truncated": false,
                    "unreadable": 0,
                    "reset": false,
                },
                "nextCursor": null,
            })
        );
    }
    assert!(runner.calls().is_empty());
    assert_eq!(runner.ledger.requests().usage(), (0, 0));
}

#[test]
fn page_stops_after_eight_runner_calls_and_the_cursor_resumes_at_that_turn() {
    let turns = || -> Vec<TurnDescriptor> {
        std::iter::once(running(0, Some(0)))
            .chain((1..=10).map(|index| running(index, None)))
            .collect()
    };
    let runner = FakeRunner::replying((1..=10).map(|index| reply(index, "empty", 1)).collect());
    let first = list(&runner, turns(), None).unwrap();
    let cursor = first.next_cursor.clone().expect("next cursor");
    assert!(cursor.starts_with("t:9:"));
    assert_eq!(runner.calls().len(), MAX_PAGE_CALLS);
    let second = list(&runner, turns(), Some(&cursor)).unwrap();
    assert_eq!(second.next_cursor, None);
    assert_eq!(runner.calls().len(), 10);
    assert_eq!(
        runner.routes()[8..],
        [
            format!("GET /v1/tasks/{}/interactions", task(9)),
            format!("GET /v1/tasks/{}/interactions", task(10)),
        ]
    );
    assert_eq!(MAX_PAGE_CALLS, 8);
}

#[test]
fn page_deadline_bounds_every_call_after_the_first_turn_and_keeps_finished_turns() {
    let turns = || -> Vec<TurnDescriptor> { (1..=5).map(|index| running(index, None)).collect() };
    let paced = |delay: Duration| FakeRunner {
        call_delay: delay,
        ..FakeRunner::replying((1..=5).map(|index| reply(index, "empty", 1)).collect())
    };
    let page_of = |runner: &FakeRunner, cursor: Option<&str>| {
        let tasks: Vec<String> = turns().iter().map(|turn| turn.turn_id.clone()).collect();
        runner.joined(&tasks, THREAD);
        let clock = || runner.clock();
        list_under(
            runner,
            &query(turns(), cursor),
            &clock,
            runner.clock() + LIST_CEILING,
        )
        .unwrap()
    };
    let runner = paced(Duration::from_millis(900));
    let first = page_of(&runner, None);
    let cursor = first.next_cursor.clone().expect("next cursor");
    assert!(cursor.starts_with("t:2:"));
    assert_eq!(runner.calls().len(), 3);
    assert_eq!(runner.elapsed.get(), PAGE_BUDGET);
    let deadlines = runner.deadlines.borrow().clone();
    assert_eq!(deadlines[0], Some(runner.base + LIST_CEILING));
    assert_eq!(deadlines[1], Some(runner.base + PAGE_BUDGET));
    assert_eq!(deadlines[2], Some(runner.base + PAGE_BUDGET));
    let second = page_of(&runner, Some(&cursor));
    assert!(second
        .next_cursor
        .as_deref()
        .is_some_and(|next| next.starts_with("t:4:")));
    assert_eq!(
        runner.deadlines.borrow()[3],
        Some(runner.base + PAGE_BUDGET + LIST_CEILING)
    );
    let slow = paced(Duration::from_secs(5));
    let page = page_of(&slow, None);
    assert!(page
        .next_cursor
        .as_deref()
        .is_some_and(|next| next.starts_with("t:1:")));
    assert_eq!(slow.calls().len(), 1);
    assert_eq!(slow.elapsed.get(), Duration::from_secs(5));
    assert_eq!(PAGE_BUDGET, Duration::from_secs(2));
}

#[test]
fn page_stops_before_the_turn_that_would_exceed_sixty_four_records() {
    let turns = || {
        vec![
            running(1, Some(3)),
            running(2, Some(3)),
            running(3, Some(3)),
        ]
    };
    let runner = FakeRunner::replying(vec![crowded(1, 32, 28), crowded(2, 2, 2), crowded(3, 1, 0)]);
    let first = list(&runner, turns(), None).unwrap();
    assert_eq!(records(&first).len(), MAX_PAGE_RECORDS);
    let cursor = first.next_cursor.clone().expect("next cursor");
    assert!(cursor.starts_with("t:2:"));
    assert_eq!(runner.calls().len(), 3);
    let second = list(&runner, turns(), Some(&cursor)).unwrap();
    assert_eq!(records(&second).len(), 1);
    assert_eq!(records(&second)[0]["turnId"], task(3));
    assert_eq!(second.next_cursor, None);
    assert_eq!(runner.calls().len(), 3);
    let full = FakeRunner::replying(vec![crowded(1, 32, 32), crowded(2, 1, 0)]);
    let first = list(&full, vec![running(1, Some(3)), running(2, Some(3))], None).unwrap();
    assert_eq!(records(&first).len(), 64);
    assert!(first
        .next_cursor
        .as_deref()
        .is_some_and(|cursor| cursor.starts_with("t:1:")));
    assert_eq!(MAX_PAGE_RECORDS, 64);
}

#[test]
fn cursor_that_was_not_issued_for_this_exact_turn_list_is_refused_before_any_call() {
    let runner = FakeRunner::replying(vec![crowded(1, 32, 32), crowded(2, 1, 0)]);
    let turns = || vec![running(1, Some(3)), running(2, Some(3))];
    let first = list(&runner, turns(), None).unwrap();
    let issued = first.next_cursor.clone().expect("next cursor");
    let calls = runner.calls().len();
    let longest = "t".repeat(256);
    let replaced = vec![running(3, Some(3)), running(2, Some(3))];
    let reordered = vec![running(2, Some(3)), running(1, Some(3))];
    let moved = vec![running(1, Some(3)), running(2, Some(4))];
    for (turns, cursor) in [
        (turns(), "t:0"),
        (turns(), "t:1"),
        (turns(), "t:2"),
        (turns(), "t:99"),
        (turns(), "t:"),
        (turns(), "x"),
        (turns(), longest.as_str()),
        (replaced, issued.as_str()),
        (reordered, issued.as_str()),
        (moved, issued.as_str()),
        (vec![], issued.as_str()),
    ] {
        assert_eq!(
            list(&runner, turns, Some(cursor)).unwrap_err(),
            ThreadRequestError::StaleCursor,
            "{cursor}"
        );
    }
    let mut other_thread = query(turns(), Some(&issued));
    other_thread.thread_id = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d".into();
    let now = Instant::now();
    assert_eq!(
        list_under(&runner, &other_thread, &move || now, far()).unwrap_err(),
        ThreadRequestError::StaleCursor
    );
    let reconnected = FakeRunner::replying(vec![]);
    assert_eq!(
        list(&reconnected, turns(), Some(&issued)).unwrap_err(),
        ThreadRequestError::StaleCursor
    );
    assert_eq!(runner.calls().len(), calls);
    assert!(reconnected.calls().is_empty());
    let resumed = list(&runner, turns(), Some(&issued)).unwrap();
    assert_eq!(records(&resumed).len(), 1);
}

#[test]
fn cached_snapshot_is_served_until_the_requested_sequence_moves_past_it() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let first = list(&runner, vec![running(1, Some(3))], None).unwrap();
    let again = list(&runner, vec![running(1, Some(3))], None).unwrap();
    let older = list(&runner, vec![running(1, Some(2))], None).unwrap();
    assert_eq!(first, again);
    assert_eq!(first, older);
    assert_eq!(runner.calls().len(), 1);
    runner.queue(vec![reply(1, "answeredAndDecided", 6)]);
    let moved = list(&runner, vec![running(1, Some(4))], None).unwrap();
    assert_eq!(runner.calls().len(), 2);
    assert_eq!(records(&moved).len(), 4);
    assert_eq!(records(&moved)[0]["version"], 13);
    let settled = list(&runner, vec![running(1, Some(6))], None).unwrap();
    assert_eq!(settled, moved);
    assert_eq!(runner.calls().len(), 2);
}

#[test]
fn unknown_sequence_is_served_from_cache_only_for_an_ended_turn_read_after_it_ended() {
    let runner = FakeRunner::replying(vec![
        reply(1, "answeredAndDecided", 6),
        reply(1, "answeredAndDecided", 6),
        reply(1, "answeredAndDecided", 6),
    ]);
    list(&runner, vec![running(1, None)], None).unwrap();
    list(&runner, vec![running(1, None)], None).unwrap();
    assert_eq!(runner.calls().len(), 2);
    let after_end = list(&runner, vec![ended(1, None)], None).unwrap();
    assert_eq!(runner.calls().len(), 3);
    let cached = list(&runner, vec![ended(1, None)], None).unwrap();
    assert_eq!(cached, after_end);
    assert_eq!(runner.calls().len(), 3);
}

#[test]
fn ended_turn_that_still_holds_an_open_request_is_read_again_until_it_closes() {
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    list(&runner, vec![running(1, Some(3))], None).unwrap();
    assert!(runner.ledger.requests().holds(&task(1)));
    runner.queue(vec![
        reply(1, "livePendingQuestionAndApproval", 3),
        reply(1, "pendingWithoutWaiter", 3),
        reply(1, "everySettleReasonOnApprovals", 5),
    ]);
    let still_open = list(&runner, vec![ended(1, Some(3))], None).unwrap();
    assert_eq!(records(&still_open)[0]["status"], "pending");
    assert!(!runner.ledger.requests().holds(&task(1)));
    let waiting = list(&runner, vec![ended(1, Some(3))], None).unwrap();
    assert_eq!(records(&waiting)[0]["status"], "submitting");
    assert!(!runner.ledger.requests().holds(&task(1)));
    let closed = list(&runner, vec![ended(1, Some(3))], None).unwrap();
    assert_eq!(records(&closed)[0]["status"], "expired");
    assert_eq!(runner.calls().len(), 4);
    assert_eq!(
        list(&runner, vec![ended(1, Some(3))], None).unwrap(),
        closed
    );
    assert_eq!(list(&runner, vec![ended(1, None)], None).unwrap(), closed);
    assert_eq!(runner.calls().len(), 4);
}

#[test]
fn legacy_rows_take_the_turn_start_and_running_legacy_reads_are_never_cached() {
    let now = Instant::now();
    let runner = FakeRunner::replying(first_legacy_read(1, "pending"));
    let first = list_at(&runner, vec![running(1, None)], None, now).unwrap();
    assert_eq!(epoch_of(&first), legacy_epoch(&runner));
    let records_first = records(&first);
    assert_eq!(records_first.len(), 2);
    for (record, order) in records_first.iter().zip(0..) {
        assert_eq!(record["createdAtEpochMs"], STARTED + 1);
        assert_eq!(record["resolvedAtEpochMs"], Value::Null);
        assert_eq!(record["status"], "pending");
        assert_eq!(record["order"], order);
        assert_eq!(record["version"], 3);
    }
    assert_eq!(runner.ledger.requests().usage(), (0, 0));
    runner.queue(legacy_lists(1, "pending"));
    let unchanged = list_at(&runner, vec![running(1, None)], None, now).unwrap();
    assert_eq!(unchanged, first);
    assert_eq!(runner.calls().len(), 6);
    runner.queue(legacy_lists(1, "expired"));
    let ended_turn = list_at(&runner, vec![ended(1, None)], None, now).unwrap();
    let records_ended = records(&ended_turn);
    for record in &records_ended {
        assert_eq!(record["status"], "expired");
        assert_eq!(record["createdAtEpochMs"], STARTED + 1);
        assert_eq!(record["resolvedAtEpochMs"], STARTED + 1);
        assert_eq!(record["responseCapability"]["reason"], "unknown");
        assert_eq!(record["version"], 5);
    }
    assert_eq!(runner.calls().len(), 8);
    assert!(runner.ledger.requests().holds(&task(1)));
    assert_eq!(
        list_at(&runner, vec![ended(1, None)], None, now).unwrap(),
        ended_turn
    );
    assert_eq!(runner.calls().len(), 8);
}

#[test]
fn legacy_runner_reads_only_the_latest_or_running_turns_and_reports_the_rest_as_truncated() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(3, "expired"));
    runner.ledger.remember_legacy_runner(now);
    let turns = || vec![ended(3, None), ended(1, None), ended(2, None)];
    let page = list_at(&runner, turns(), None, now).unwrap();
    assert!(page.message.parts().truncated);
    assert_eq!(epoch_of(&page), legacy_epoch(&runner));
    assert_eq!(records(&page).len(), 2);
    assert!(records(&page)
        .iter()
        .all(|record| record["turnId"] == task(3)));
    assert_eq!(
        runner.routes(),
        [
            format!("GET /v1/tasks/{}/questions", task(3)),
            format!("GET /v1/tasks/{}/approvals", task(3)),
        ]
    );
    assert_eq!(list_at(&runner, turns(), None, now).unwrap(), page);
    assert_eq!(runner.calls().len(), 2);
    runner.queue(legacy_lists(4, "pending"));
    let with_running = vec![
        ended(3, None),
        ended(1, None),
        running(4, None),
        ended(5, None),
    ];
    runner.queue(legacy_lists(5, "expired"));
    let page = list_at(&runner, with_running, None, now).unwrap();
    assert!(page.message.parts().truncated);
    assert_eq!(records(&page).len(), 6);
    assert_eq!(runner.calls().len(), 6);
    let only_latest = list_at(&runner, vec![ended(5, None)], None, now).unwrap();
    assert!(!only_latest.message.parts().truncated);
    assert_eq!(runner.calls().len(), 6);
}

#[test]
fn snapshot_truncation_of_any_included_turn_marks_the_message() {
    let runner = FakeRunner::replying(vec![
        reply(1, "answeredAndDecided", 6),
        reply(2, "settledApprovalsLeftOut", 90),
    ]);
    let page = list(&runner, vec![ended(1, Some(6)), running(2, Some(90))], None).unwrap();
    assert!(page.message.parts().truncated);
    let evicted = FakeRunner::replying(vec![reply(1, "olderQuestionsEvicted", 70)]);
    let page = list(&evicted, vec![running(1, Some(70))], None).unwrap();
    assert!(page.message.parts().truncated);
    let mut older_runner = retasked(live(), &task(1));
    older_runner
        .as_object_mut()
        .expect("snapshot")
        .remove("questionsTruncated");
    let tolerant = FakeRunner::replying(vec![Ok(older_runner)]);
    let page = list(&tolerant, vec![running(1, Some(3))], None).unwrap();
    assert!(!page.message.parts().truncated);
    assert_eq!(records(&page).len(), 2);
    assert_eq!(epoch_of(&page), "rr1-snapshot");
}

#[test]
fn epoch_is_constant_for_snapshots_and_names_the_lease_for_legacy_lists() {
    let now = Instant::now();
    let first = FakeRunner::replying(vec![reply(1, "empty", 1)]);
    let reconnected = FakeRunner::replying(vec![reply(1, "empty", 1)]);
    let turns = || vec![running(1, Some(1))];
    assert_eq!(
        epoch_of(&list_at(&first, turns(), None, now).unwrap()),
        "rr1-snapshot"
    );
    assert_eq!(
        epoch_of(&list_at(&reconnected, turns(), None, now).unwrap()),
        "rr1-snapshot"
    );
    let old = FakeRunner::replying(first_legacy_read(1, "pending"));
    let old_again = FakeRunner::replying(first_legacy_read(1, "pending"));
    let before = epoch_of(&list_at(&old, vec![running(1, None)], None, now).unwrap());
    let after = epoch_of(&list_at(&old_again, vec![running(1, None)], None, now).unwrap());
    assert_eq!(before, legacy_epoch(&old));
    assert_eq!(after, legacy_epoch(&old_again));
    assert_ne!(before, after);
    for later in [
        now,
        now + LEGACY_PROBE_INTERVAL,
        now + LEGACY_PROBE_INTERVAL * 5,
    ] {
        assert_eq!(
            epoch_of(&list_at(&old, vec![], None, later).unwrap()),
            legacy_epoch(&old)
        );
        assert_eq!(
            epoch_of(&list_at(&old, vec![running(9, Some(0))], None, later).unwrap()),
            legacy_epoch(&old)
        );
    }
    assert_eq!(old.calls().len(), 4);
    old.queue(vec![reply(1, "empty", 1), reply(1, "empty", 1)]);
    let upgraded = list_at(
        &old,
        vec![running(1, None)],
        None,
        now + LEGACY_PROBE_INTERVAL,
    );
    let returned = format!("rr1-snapshot-{}-1", old.ledger.serial());
    assert_eq!(epoch_of(&upgraded.unwrap()), returned);
    assert_eq!(
        epoch_of(&list_at(&old, vec![], None, now).unwrap()),
        returned
    );
}

#[test]
fn epoch_names_are_never_reused_within_a_lease_after_a_source_switch() {
    let now = Instant::now();
    let later = now + LEGACY_PROBE_INTERVAL;
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    let turns = || vec![running(1, None)];
    let mut epochs = vec![epoch_of(&list_at(&runner, turns(), None, now).unwrap())];
    runner.queue(first_legacy_read(1, "pending"));
    runner.queue(legacy_lists(1, "pending"));
    epochs.push(epoch_of(&list_at(&runner, turns(), None, now).unwrap()));
    runner.queue(vec![
        reply(1, "livePendingQuestionAndApproval", 4),
        reply(1, "livePendingQuestionAndApproval", 4),
    ]);
    epochs.push(epoch_of(&list_at(&runner, turns(), None, later).unwrap()));
    runner.queue(first_legacy_read(1, "pending"));
    runner.queue(legacy_lists(1, "pending"));
    epochs.push(epoch_of(&list_at(&runner, turns(), None, later).unwrap()));
    assert_eq!(runner.replies.borrow().len(), 0);
    let serial = runner.ledger.serial();
    assert_eq!(
        epochs,
        [
            "rr1-snapshot".to_string(),
            format!("rr1-legacy-{serial}-1"),
            format!("rr1-snapshot-{serial}-2"),
            format!("rr1-legacy-{serial}-3"),
        ]
    );
    let distinct: std::collections::HashSet<&String> = epochs.iter().collect();
    assert_eq!(distinct.len(), 4);
    assert!(epochs
        .iter()
        .all(|epoch| crate::agent_runtime_requests::model::is_identifier(epoch)));
}

#[test]
fn legacy_page_stops_once_eight_runner_calls_were_made() {
    let now = Instant::now();
    let turns = || -> Vec<TurnDescriptor> { (1..=6).map(|index| running(index, None)).collect() };
    let runner = FakeRunner::replying(first_legacy_read(1, "pending"));
    for index in 2..=6 {
        runner.queue(legacy_lists(index, "pending"));
    }
    let first = list_at(&runner, turns(), None, now).unwrap();
    let cursor = first.next_cursor.clone().expect("next cursor");
    assert!(cursor.starts_with("t:3:"));
    assert_eq!(runner.calls().len(), 8);
    assert_eq!(records(&first).len(), 6);
    let second = list_at(&runner, turns(), Some(&cursor), now).unwrap();
    assert_eq!(second.next_cursor, None);
    assert_eq!(runner.calls().len(), 14);
    assert_eq!(epoch_of(&first), epoch_of(&second));
}

#[test]
fn ended_legacy_turn_with_an_open_request_is_read_until_it_closes_even_when_it_is_not_the_latest() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(1, "pending"));
    runner.ledger.remember_legacy_runner(now);
    let while_running = list_at(&runner, vec![running(1, None)], None, now).unwrap();
    assert!(records(&while_running)
        .iter()
        .all(|record| record["status"] == "pending"));
    assert!(runner.ledger.evidence().has_open_requests(&task(1)));
    let oldest = || turn(&task(3), STARTED, None, true);
    let turns = || vec![running(2, None), ended(1, None), oldest()];
    let mut later = legacy_lists(2, "pending");
    later.extend(legacy_lists(1, "pending"));
    later.extend(legacy_lists(2, "pending"));
    later.extend(legacy_lists(1, "expired"));
    later.extend(legacy_lists(2, "pending"));
    runner.queue(later);
    let still_open = list_at(&runner, turns(), None, now).unwrap();
    let of_first = |page: &ThreadRequestsPage| -> Vec<Value> {
        records(page)
            .into_iter()
            .filter(|record| record["turnId"] == task(1))
            .collect()
    };
    assert!(of_first(&still_open)
        .iter()
        .all(|record| record["status"] == "pending"));
    assert_eq!(of_first(&still_open).len(), 2);
    assert!(still_open.message.parts().truncated);
    let closed = list_at(&runner, turns(), None, now).unwrap();
    assert!(of_first(&closed)
        .iter()
        .all(|record| record["status"] == "expired"));
    assert!(!runner.ledger.evidence().has_open_requests(&task(1)));
    assert!(runner.ledger.requests().holds(&task(1)));
    assert_eq!(runner.calls().len(), 10);
    let cached = list_at(&runner, turns(), None, now).unwrap();
    assert_eq!(of_first(&cached), of_first(&closed));
    assert_eq!(runner.calls().len(), 12);
    assert!(!records(&cached)
        .iter()
        .any(|record| record["turnId"] == task(3)));
}

#[test]
fn first_page_that_sees_the_source_change_is_rebuilt_in_the_new_epoch() {
    let now = Instant::now();
    let runner = FakeRunner::replying(legacy_lists(1, "expired"));
    runner.ledger.remember_legacy_runner(now);
    let legacy = list_at(&runner, vec![ended(1, None)], None, now).unwrap();
    assert_eq!(epoch_of(&legacy), legacy_epoch(&runner));
    assert!(runner.ledger.requests().holds(&task(1)));
    let later = now + LEGACY_PROBE_INTERVAL;
    let turns = || vec![ended(1, None), running(2, Some(3))];
    runner.queue(vec![
        reply(2, "livePendingQuestionAndApproval", 3),
        reply(1, "answeredAndDecided", 6),
    ]);
    let rebuilt = list_at(&runner, turns(), None, later).unwrap();
    let returned = format!("rr1-snapshot-{}-1", runner.ledger.serial());
    assert_eq!(epoch_of(&rebuilt), returned);
    assert_eq!(rebuilt.next_cursor, None);
    assert_eq!(records(&rebuilt).len(), 6);
    assert_eq!(runner.calls().len(), 4);
    let again = list_at(&runner, turns(), None, later).unwrap();
    assert_eq!(again, rebuilt);
    assert_eq!(runner.calls().len(), 4);
}

#[test]
fn snapshot_to_legacy_switch_rebuilds_the_first_page_in_one_epoch() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![reply(1, "livePendingQuestionAndApproval", 3)]);
    list_at(&runner, vec![running(1, Some(3))], None, now).unwrap();
    let turns = || vec![running(1, Some(3)), running(2, None)];
    runner.queue(first_legacy_read(2, "pending"));
    runner.queue(legacy_lists(1, "pending"));
    runner.queue(legacy_lists(2, "pending"));
    let page = list_at(&runner, turns(), None, now).unwrap();
    assert_eq!(
        epoch_of(&page),
        format!("rr1-legacy-{}-1", runner.ledger.serial())
    );
    assert_eq!(page.next_cursor, None);
    assert_eq!(records(&page).len(), 4);
    assert!(!page.message.parts().truncated);
    assert_eq!(runner.replies.borrow().len(), 0);
}

#[test]
fn continuation_that_spans_an_epoch_change_is_refused() {
    let now = Instant::now();
    let turns = || -> Vec<TurnDescriptor> { (1..=6).map(|index| running(index, None)).collect() };
    let runner = FakeRunner::replying(first_legacy_read(1, "pending"));
    for index in 2..=3 {
        runner.queue(legacy_lists(index, "pending"));
    }
    let first = list_at(&runner, turns(), None, now).unwrap();
    let cursor = first.next_cursor.clone().expect("next cursor");
    runner.ledger.requests().request_bump();
    list_at(&runner, vec![], None, now).unwrap();
    assert_eq!(
        list_at(&runner, turns(), Some(&cursor), now).unwrap_err(),
        ThreadRequestError::StaleCursor
    );
    assert_eq!(runner.calls().len(), 8);
}

#[test]
fn unknown_task_reads_as_an_empty_turn_and_leaves_no_trace() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![
        not_found(),
        not_found(),
        not_found(),
        reply(2, "livePendingQuestionAndApproval", 3),
    ]);
    let page = list_at(
        &runner,
        vec![ended(1, None), running(2, Some(3))],
        None,
        now,
    )
    .unwrap();
    assert_eq!(records(&page).len(), 2);
    assert!(records(&page)
        .iter()
        .all(|record| record["turnId"] == task(2)));
    assert_eq!(page.next_cursor, None);
    assert!(!page.message.parts().truncated);
    assert!(!runner.ledger.is_legacy_runner(now));
    assert!(!runner.ledger.requests().holds(&task(1)));
    runner.queue(vec![not_found(), not_found(), not_found()]);
    let only = list_at(&runner, vec![running(1, None)], None, now).unwrap();
    assert!(records(&only).is_empty());
    assert_eq!(epoch_of(&only), "rr1-snapshot");
}

#[test]
fn foreign_task_or_runner_failure_fails_the_page_instead_of_presenting_it_as_empty() {
    let foreign = FakeRunner::replying(vec![reply(2, "livePendingQuestionAndApproval", 3)]);
    assert_eq!(
        list(&foreign, vec![running(1, Some(3))], None).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Wire(WireError::ForeignTask))
    );
    let mut smuggled = retasked(live(), &task(1));
    smuggled["approvals"][0]["taskId"] = task(2).into();
    let item = FakeRunner::replying(vec![Ok(smuggled)]);
    assert_eq!(
        list(&item, vec![running(1, Some(3))], None).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Wire(WireError::ForeignTask))
    );
    assert_eq!(item.ledger.requests().usage(), (0, 0));
    let failing = FakeRunner::replying(vec![
        reply(1, "answeredAndDecided", 6),
        Err(UNAVAILABLE.to_string()),
    ]);
    let turns = || vec![ended(1, Some(6)), running(2, Some(3))];
    assert_eq!(
        list(&failing, turns(), None).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Transport(UNAVAILABLE.into()))
    );
    failing.queue(vec![reply(2, "livePendingQuestionAndApproval", 3)]);
    assert_eq!(records(&list(&failing, turns(), None).unwrap()).len(), 6);
    assert_eq!(failing.calls().len(), 3);
}

#[test]
fn another_runner_or_a_superseded_lease_is_refused_even_for_cached_turns() {
    let runner = FakeRunner::replying(vec![reply(1, "answeredAndDecided", 6)]);
    list(&runner, vec![ended(1, Some(6))], None).unwrap();
    let mut other = query(vec![ended(1, Some(6))], None);
    other.runner_id = "other-runner".into();
    let now = Instant::now();
    assert_eq!(
        list_under(&runner, &other, &move || now, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::RunnerChanged)
    );
    let cached = list_under(
        &runner,
        &query(vec![ended(1, Some(6))], None),
        &move || now,
        far(),
    );
    assert!(cached.is_ok());
    runner.current.set(false);
    assert_eq!(
        settle_page(&runner, cached, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    assert_eq!(
        list(&runner, vec![ended(1, Some(6))], None).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    assert_eq!(runner.calls().len(), 1);
    let revoked = FakeRunner {
        revoke_on_call: Some(1),
        ..FakeRunner::replying(vec![reply(1, "answeredAndDecided", 6)])
    };
    assert_eq!(
        list(&revoked, vec![ended(1, Some(6))], None).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    assert_eq!(revoked.ledger.requests().usage(), (0, 0));
}

#[test]
fn errors_never_carry_a_location_or_a_credential() {
    let disclosing = [
        "error sending request for url (http://127.0.0.1:49152/v1/tasks/x/interactions)",
        "connect to /private/tmp/codevo/runner.sock failed",
        "ssh: codex@192.168.1.110 refused",
        "C:\\Users\\runner\\token.txt",
        "listen tcp :9229 in use",
    ];
    for message in disclosing {
        let error = ThreadRequestError::Interaction(InteractionError::Transport(message.into()));
        assert_eq!(error.message(), "Runner request failed.", "{message}");
        assert_eq!(String::from(error), "Runner request failed.");
    }
    let plain = [
        ThreadRequestError::StaleCursor,
        ThreadRequestError::Projection(RequestError::Integer),
        ThreadRequestError::Interaction(InteractionError::InvalidRequest),
        ThreadRequestError::Interaction(InteractionError::RunnerChanged),
        ThreadRequestError::Interaction(InteractionError::Superseded),
        ThreadRequestError::Interaction(InteractionError::DeliveryUncertain),
        ThreadRequestError::Interaction(InteractionError::TaskNotFound),
        ThreadRequestError::Interaction(InteractionError::RequestGone),
        ThreadRequestError::Interaction(InteractionError::Unconfirmed),
        ThreadRequestError::Interaction(InteractionError::Wire(WireError::ForeignTask)),
        ThreadRequestError::Interaction(InteractionError::Transport(UNAVAILABLE.into())),
        ThreadRequestError::Interaction(InteractionError::Transport(
            "Server is not connected".into(),
        )),
    ];
    for error in plain {
        let message = error.message();
        assert_ne!(message, "Runner request failed.", "{error:?}");
        assert!(!message.is_empty() && message.len() <= 160, "{message}");
        for fragment in [
            "/",
            "\\",
            "@",
            "http",
            "localhost",
            "127.0.0.1",
            "sock",
            "Bearer",
            TASK,
            THREAD,
        ] {
            assert!(!message.contains(fragment), "{message}");
        }
    }
}

#[cfg(unix)]
#[path = "thread_requests_transport_tests.rs"]
mod transport;
