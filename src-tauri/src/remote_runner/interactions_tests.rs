use super::super::interactions_fake::*;
use super::super::interactions_ledger::{APPROVALS_PROBE_INTERVAL, LEGACY_PROBE_INTERVAL};
use super::*;
use serde_json::json;

#[test]
fn runner_snapshot_crosses_ipc_unchanged_with_its_source() {
    for name in [
        "livePendingQuestionAndApproval",
        "everySettleReasonOnApprovals",
        "olderQuestionsEvicted",
        "settledApprovalsLeftOut",
    ] {
        let runner = FakeRunner::replying(vec![Ok(snapshot(name))]);
        let mut expected = snapshot(name);
        expected["source"] = "snapshot".into();
        assert_eq!(
            wire(&read_at(&runner, Instant::now()).unwrap()),
            expected,
            "{name}"
        );
        assert_eq!(
            runner.calls(),
            [("GET".to_string(), route("interactions"), None)]
        );
    }
}

#[test]
fn missing_snapshot_route_composes_one_shape_from_the_legacy_lists() {
    let mut approved = legacy_approval("approved");
    approved["id"] = "b0000000-0000-4000-8000-000000000002".into();
    approved["decision"] = "allowOnce".into();
    let mut timed_out = legacy_approval("timedOut");
    timed_out["id"] = "b0000000-0000-4000-8000-000000000003".into();
    let mut expired = legacy_question("expired");
    expired["id"] = "a0000000-0000-4000-8000-000000000002".into();
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending"), expired.clone()]),
        items(vec![
            legacy_approval("pending"),
            approved.clone(),
            timed_out.clone(),
        ]),
        not_found(),
    ]);
    let live_capability = json!({"type": "live"});
    let unknown = json!({"type": "notResumable", "reason": "unknown"});
    assert_eq!(
        wire(&read_at(&runner, Instant::now()).unwrap()),
        json!({
            "taskId": TASK,
            "sequence": 1,
            "questions": [
                composed(legacy_question("pending"), Some(live_capability.clone())),
                composed(expired, Some(unknown.clone())),
            ],
            "questionsTruncated": false,
            "approvals": [
                composed(legacy_approval("pending"), Some(live_capability)),
                composed(approved, None),
                composed(timed_out, Some(unknown)),
            ],
            "approvalsTruncated": false,
            "source": "legacy",
        })
    );
    assert_eq!(
        runner.routes(),
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("interactions")),
        ]
    );
}

#[test]
fn legacy_approval_expiry_is_carried_and_never_decided_locally() {
    let mut pending = legacy_approval("pending");
    pending["expiresAt"] = "2020-01-01T00:00:00.000Z".into();
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![]),
        items(vec![pending]),
        not_found(),
    ]);
    let read = read_at(&runner, Instant::now()).unwrap();
    assert_eq!(read.approvals[0].expires_at, "2020-01-01T00:00:00.000Z");
    assert_eq!(
        wire(&read.approvals[0])["responseCapability"],
        json!({"type": "live"})
    );
    let mut malformed = legacy_approval("pending");
    malformed["expiresAt"] = "tomorrow".into();
    let runner = FakeRunner::replying(vec![not_found(), items(vec![]), items(vec![malformed])]);
    assert_eq!(
        read_at(&runner, Instant::now()).unwrap_err(),
        InteractionError::Wire(WireError::InvalidItem)
    );
}

#[test]
fn runner_without_approvals_is_confirmed_twice_and_then_asked_for_questions_only() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        not_found(),
        items(vec![legacy_question("pending")]),
        not_found(),
        not_found(),
    ]);
    let first = read_at(&runner, now).unwrap();
    assert_eq!(first.source, InteractionSource::Legacy);
    assert_eq!(first.questions.len(), 1);
    assert!(first.approvals.is_empty());
    assert!(!first.approvals_truncated);
    assert!(runner.ledger.is_legacy_runner(now));
    assert!(runner.ledger.lacks_approvals(now));
    assert_eq!(
        runner.routes(),
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("interactions")),
        ]
    );
    runner.queue(vec![items(vec![legacy_question("pending")])]);
    let second = read_at(&runner, now + APPROVALS_PROBE_INTERVAL / 2).unwrap();
    assert_eq!(second, first);
    assert_eq!(
        runner.routes()[6..],
        [format!("GET {}", route("questions"))]
    );
    runner.queue(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        items(vec![legacy_approval("pending")]),
        not_found(),
    ]);
    let later = read_at(&runner, now + APPROVALS_PROBE_INTERVAL).unwrap();
    assert_eq!(later.approvals.len(), 1);
    assert!(!runner
        .ledger
        .lacks_approvals(now + APPROVALS_PROBE_INTERVAL));
    assert_eq!(
        runner.routes()[7..],
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("interactions")),
        ]
    );
}

#[test]
fn missing_approvals_route_is_remembered_only_on_definitive_evidence() {
    let now = Instant::now();
    let unavailable = || Err("Runner request failed (HTTP 503).".to_string());
    let question = || items(vec![legacy_question("pending")]);
    let vanished = FakeRunner::replying(vec![not_found(), question(), not_found(), not_found()]);
    assert_eq!(
        read_at(&vanished, now).unwrap_err(),
        InteractionError::TaskNotFound
    );
    assert!(!vanished.ledger.lacks_approvals(now));
    assert!(!vanished.ledger.is_legacy_runner(now));
    let unproven = FakeRunner::replying(vec![not_found(), question(), not_found(), unavailable()]);
    assert_eq!(
        read_at(&unproven, now).unwrap_err(),
        InteractionError::Transport("Runner request failed (HTTP 503).".into())
    );
    assert!(!unproven.ledger.lacks_approvals(now));
    let malformed_proof = FakeRunner::replying(vec![
        not_found(),
        question(),
        not_found(),
        Ok(json!({"items": "none"})),
    ]);
    assert_eq!(
        read_at(&malformed_proof, now).unwrap_err(),
        InteractionError::Wire(WireError::Malformed)
    );
    assert!(!malformed_proof.ledger.lacks_approvals(now));
    let unconfirmed = FakeRunner::replying(vec![
        not_found(),
        question(),
        not_found(),
        question(),
        unavailable(),
    ]);
    assert_eq!(
        read_at(&unconfirmed, now).unwrap_err(),
        InteractionError::Transport("Runner request failed (HTTP 503).".into())
    );
    assert!(!unconfirmed.ledger.lacks_approvals(now));
    let transient = FakeRunner::replying(vec![
        not_found(),
        question(),
        not_found(),
        question(),
        items(vec![legacy_approval("pending")]),
        not_found(),
    ]);
    let read = read_at(&transient, now).unwrap();
    assert_eq!(read.approvals.len(), 1);
    assert!(!transient.ledger.lacks_approvals(now));
    assert!(transient.ledger.is_legacy_runner(now));
    let superseded = FakeRunner {
        revoke_on_call: Some(5),
        ..FakeRunner::replying(vec![
            not_found(),
            question(),
            not_found(),
            question(),
            not_found(),
        ])
    };
    assert_eq!(
        read_at(&superseded, now).unwrap_err(),
        InteractionError::Superseded
    );
    assert!(!superseded.ledger.lacks_approvals(now));
    assert_eq!(superseded.calls().len(), 5);
}

#[test]
fn task_level_404_does_not_mark_the_connection_as_a_legacy_runner() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        items(vec![legacy_approval("pending")]),
        Ok(live()),
    ]);
    let read = read_at(&runner, now).unwrap();
    assert_eq!(read.source, InteractionSource::Snapshot);
    assert_eq!(read.sequence, 3);
    assert!(!runner.ledger.is_legacy_runner(now));
    runner.queue(vec![Ok(snapshot("answeredAndDecided"))]);
    let next = read_at(&runner, now).unwrap();
    assert_eq!(next.source, InteractionSource::Snapshot);
    assert_eq!(next.sequence, 6);
    assert_eq!(
        runner.routes(),
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("interactions")),
            format!("GET {}", route("interactions")),
        ]
    );
    assert_eq!(runner.ledger.stamp(TASK, [0; 32]), 1);
}

#[test]
fn route_absence_is_remembered_only_when_an_existing_task_still_has_no_snapshot() {
    let now = Instant::now();
    let lists = || {
        vec![
            not_found(),
            items(vec![legacy_question("pending")]),
            items(vec![legacy_approval("pending")]),
        ]
    };
    for (confirmation, expected) in [
        (
            Err("Runner request failed (HTTP 503).".to_string()),
            InteractionError::Transport("Runner request failed (HTTP 503).".into()),
        ),
        (
            Ok(json!({"taskId": TASK})),
            InteractionError::Wire(WireError::Malformed),
        ),
    ] {
        let runner = FakeRunner::replying(lists());
        runner.queue(vec![confirmation]);
        assert_eq!(read_at(&runner, now).unwrap_err(), expected);
        assert!(!runner.ledger.is_legacy_runner(now));
        assert_eq!(runner.ledger.stamp(TASK, [0; 32]), 1);
    }
    let old = FakeRunner::replying(lists());
    old.queue(vec![not_found()]);
    assert_eq!(
        read_at(&old, now).unwrap().source,
        InteractionSource::Legacy
    );
    assert!(old.ledger.is_legacy_runner(now));
    assert!(!old.ledger.is_legacy_runner(now + LEGACY_PROBE_INTERVAL));
}

#[test]
fn fallback_sequence_advances_only_when_composed_content_changes() {
    let now = Instant::now();
    let pending = || items(vec![legacy_question("pending")]);
    let expired = || items(vec![legacy_question("expired")]);
    let approvals = |status: &str| items(vec![legacy_approval(status)]);
    let runner = FakeRunner::replying(vec![
        not_found(),
        pending(),
        approvals("pending"),
        not_found(),
        pending(),
        approvals("pending"),
        expired(),
        approvals("pending"),
        expired(),
        approvals("cancelled"),
        pending(),
        approvals("pending"),
        pending(),
        approvals("pending"),
    ]);
    let sequences: Vec<u64> = (0..6)
        .map(|_| read_at(&runner, now).unwrap().sequence)
        .collect();
    assert_eq!(sequences[0], sequences[1]);
    assert!(sequences[2] > sequences[1]);
    assert!(sequences[3] > sequences[2]);
    assert!(sequences[4] > sequences[3]);
    assert_eq!(sequences[5], sequences[4]);
    runner.queue(vec![items(vec![]), items(vec![])]);
    let other = Exchange::open(&runner, RUNNER, OTHER_TASK, now)
        .unwrap()
        .read()
        .unwrap();
    assert_eq!(other.task_id, OTHER_TASK);
    assert!(other.sequence > sequences[5]);
    runner.queue(vec![pending(), approvals("pending")]);
    assert_eq!(read_at(&runner, now).unwrap().sequence, sequences[5]);
}

#[test]
fn upgraded_runner_is_found_again_after_the_probe_interval() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![not_found(), items(vec![]), items(vec![]), not_found()]);
    assert_eq!(
        read_at(&runner, now).unwrap().source,
        InteractionSource::Legacy
    );
    runner.queue(vec![Ok(live())]);
    let upgraded = read_at(&runner, now + LEGACY_PROBE_INTERVAL).unwrap();
    assert_eq!(upgraded.source, InteractionSource::Snapshot);
    assert_eq!(upgraded.sequence, 3);
    assert_eq!(
        runner.routes().last(),
        Some(&format!("GET {}", route("interactions")))
    );
}

#[test]
fn unknown_task_is_an_error_and_is_not_remembered_as_a_legacy_runner() {
    let now = Instant::now();
    let runner = FakeRunner::replying(vec![not_found(), not_found()]);
    assert_eq!(
        read_at(&runner, now).unwrap_err(),
        InteractionError::TaskNotFound
    );
    runner.queue(vec![Ok(snapshot("empty"))]);
    assert_eq!(
        read_at(&runner, now).unwrap().source,
        InteractionSource::Snapshot
    );
    assert_eq!(
        runner.routes(),
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("interactions")),
        ]
    );
}

#[test]
fn only_a_missing_route_falls_back() {
    let mut foreign = snapshot("empty");
    foreign["taskId"] = OTHER_TASK.into();
    for (reply, expected) in [
        (
            Err("Runner request failed (HTTP 503).".to_string()),
            InteractionError::Transport("Runner request failed (HTTP 503).".into()),
        ),
        (
            conflict(),
            InteractionError::Transport("Runner request failed (HTTP 409).".into()),
        ),
        (
            Ok(json!({"taskId": TASK})),
            InteractionError::Wire(WireError::Malformed),
        ),
        (Ok(foreign), InteractionError::Wire(WireError::ForeignTask)),
    ] {
        let runner = FakeRunner::replying(vec![reply]);
        assert_eq!(read_at(&runner, Instant::now()).unwrap_err(), expected);
        assert_eq!(runner.calls().len(), 1);
    }
    let runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        Err("Runner request failed (HTTP 503).".into()),
    ]);
    assert_eq!(
        read_at(&runner, Instant::now()).unwrap_err(),
        InteractionError::Transport("Runner request failed (HTTP 503).".into())
    );
    assert_eq!(runner.ledger.stamp(TASK, [0; 32]), 1);
}

#[test]
fn question_answer_is_posted_once_and_confirmed() {
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
    let runner = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": answered.clone()}))]);
    let outcome = answer(&runner, QUESTION, &choose("sqlite")).unwrap();
    let mut request = answered;
    request["createdAt"] = live()["questions"][0]["createdAt"].clone();
    request["settledAt"] = Value::Null;
    assert_eq!(
        wire(&outcome),
        json!({"kind": "answered", "request": request})
    );
    assert_eq!(
        runner.calls(),
        [
            ("GET".to_string(), route("interactions"), None),
            (
                "POST".to_string(),
                route(&format!("questions/{QUESTION}/answer")),
                Some(
                    json!({"answers": [{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]})
                )
            ),
        ]
    );
}

#[test]
fn approval_decision_is_posted_once_and_confirmed() {
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowForSession".into();
    let runner = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": approved.clone()}))]);
    let outcome = answer(&runner, APPROVAL, &decide("allowForSession")).unwrap();
    let mut request = approved;
    request["createdAt"] = live()["approvals"][0]["createdAt"].clone();
    request["settledAt"] = Value::Null;
    assert_eq!(request["expiresAt"], "2026-10-13T09:10:00.000Z");
    assert_eq!(
        wire(&outcome),
        json!({"kind": "answered", "request": request})
    );
    assert_eq!(
        runner.calls()[1],
        (
            "POST".to_string(),
            route(&format!("approvals/{APPROVAL}/answer")),
            Some(json!({"decision": "allowForSession"}))
        )
    );
}

#[test]
fn conflict_rereads_the_snapshot_and_returns_the_item_with_its_reason() {
    let mut settled = live();
    settled["sequence"] = 4.into();
    settled["approvals"][0]["status"] = "timedOut".into();
    settled["approvals"][0]["settledAt"] = "2026-10-13T09:10:00.000Z".into();
    settled["approvals"][0]["responseCapability"] =
        json!({"type": "notResumable", "reason": "timedOut"});
    settled["questions"][0]["status"] = "expired".into();
    settled["questions"][0]["settledAt"] = "2026-10-13T09:05:00.000Z".into();
    settled["questions"][0]["responseCapability"] =
        json!({"type": "notResumable", "reason": "runnerRestarted"});
    for (request_id, response, key) in [
        (APPROVAL, decide("allowOnce"), "approvals"),
        (QUESTION, choose("postgres"), "questions"),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live()), conflict(), Ok(settled.clone())]);
        let outcome = answer(&runner, request_id, &response).unwrap();
        assert_eq!(
            wire(&outcome),
            json!({"kind": "notAnswerable", "request": settled[key][0]}),
            "{key}"
        );
        let routes = runner.routes();
        assert_eq!(routes.len(), 3);
        assert_eq!(routes[0], format!("GET {}", route("interactions")));
        assert!(routes[1].starts_with("POST "));
        assert_eq!(routes[2], format!("GET {}", route("interactions")));
    }
}

#[test]
fn refused_request_is_never_returned_as_live() {
    let runner = FakeRunner::replying(vec![Ok(live()), conflict(), Ok(live())]);
    let outcome = answer(&runner, APPROVAL, &decide("deny")).unwrap();
    let request = &wire(&outcome)["request"];
    assert_eq!(wire(&outcome)["kind"], "notAnswerable");
    assert_eq!(request["status"], "pending");
    assert_eq!(
        request["responseCapability"],
        json!({"type": "notResumable", "reason": "unknown"})
    );
    let now = Instant::now();
    let legacy_runner = FakeRunner::replying(vec![
        not_found(),
        items(vec![legacy_question("pending")]),
        not_found(),
        items(vec![legacy_question("pending")]),
        not_found(),
        not_found(),
        conflict(),
        items(vec![legacy_question("pending")]),
    ]);
    let outcome = answer_at(&legacy_runner, QUESTION, &choose("sqlite"), now).unwrap();
    assert_eq!(
        wire(&outcome),
        json!({
            "kind": "notAnswerable",
            "request": composed(
                legacy_question("pending"),
                Some(json!({"type": "notResumable", "reason": "unknown"}))
            ),
        })
    );
}

#[test]
fn conflict_after_another_client_answered_returns_the_answered_item() {
    let runner = FakeRunner::replying(vec![
        Ok(live()),
        conflict(),
        Ok(snapshot("answeredAndDecided")),
    ]);
    let outcome = answer(&runner, QUESTION, &choose("postgres")).unwrap();
    assert_eq!(
        wire(&outcome),
        json!({
            "kind": "notAnswerable",
            "request": snapshot("answeredAndDecided")["questions"][0],
        })
    );
    assert!(wire(&outcome)["request"]
        .get("responseCapability")
        .is_none());
}

#[test]
fn request_that_is_already_not_resumable_is_not_posted() {
    let settled = snapshot("everySettleReasonOnQuestions");
    let runner = FakeRunner::replying(vec![Ok(settled.clone())]);
    let outcome = answer(
        &runner,
        "a0000000-0000-4000-8000-000000000003",
        &choose("sqlite"),
    )
    .unwrap();
    assert_eq!(
        wire(&outcome),
        json!({"kind": "notAnswerable", "request": settled["questions"][2]})
    );
    assert_eq!(
        wire(&outcome)["request"]["responseCapability"]["reason"],
        "turnEnded"
    );
    assert_eq!(runner.calls().len(), 1);
}

#[test]
fn invalid_responses_never_reach_the_answer_route() {
    let mut narrow = live();
    narrow["approvals"][0]["decisions"] = json!(["allowOnce", "deny"]);
    let empty: RemoteRequestResponse = serde_json::from_value(json!({
        "kind": "question",
        "answers": [{"questionId": "storage", "optionIds": [], "text": " "}]
    }))
    .unwrap();
    for (snapshot, request_id, response, expected) in [
        (
            live(),
            QUESTION,
            choose("oracle"),
            InteractionError::InvalidRequest,
        ),
        (live(), QUESTION, empty, InteractionError::InvalidRequest),
        (
            narrow,
            APPROVAL,
            decide("allowForSession"),
            InteractionError::InvalidRequest,
        ),
        (
            live(),
            QUESTION,
            decide("deny"),
            InteractionError::RequestGone,
        ),
        (
            live(),
            APPROVAL,
            choose("sqlite"),
            InteractionError::RequestGone,
        ),
        (
            live(),
            "c0000000-0000-4000-8000-000000000009",
            decide("deny"),
            InteractionError::RequestGone,
        ),
    ] {
        let runner = FakeRunner::replying(vec![Ok(snapshot)]);
        assert_eq!(
            answer(&runner, request_id, &response).unwrap_err(),
            expected
        );
        assert_eq!(runner.routes(), [format!("GET {}", route("interactions"))]);
    }
    let oversized: RemoteRequestResponse = serde_json::from_value(json!({
        "kind": "question",
        "answers": [{"questionId": "storage", "optionIds": [], "text": "x".repeat(256 * 1024)}]
    }))
    .unwrap();
    for (request_id, response) in [
        (QUESTION, oversized),
        ("../questions", choose("sqlite")),
        ("", decide("deny")),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live())]);
        assert_eq!(
            answer(&runner, request_id, &response).unwrap_err(),
            InteractionError::InvalidRequest
        );
        assert!(runner.calls().is_empty());
    }
}

#[test]
fn answer_route_failures_stay_typed() {
    let runner = FakeRunner::replying(vec![Ok(live()), not_found()]);
    assert_eq!(
        answer(&runner, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::RequestGone
    );
    let runner = FakeRunner::replying(vec![
        Ok(live()),
        Err("Runner request failed (HTTP 429).".into()),
    ]);
    assert_eq!(
        answer(&runner, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::Transport("Runner request failed (HTTP 429).".into())
    );
    let runner = FakeRunner::replying(vec![Ok(live()), conflict(), Ok(snapshot("empty"))]);
    assert_eq!(
        answer(&runner, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::RequestGone
    );
}

#[test]
fn unconfirmed_answers_are_errors() {
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["postgres"], "text": ""}]);
    let mut other_question = answered.clone();
    other_question["answers"][0]["optionIds"] = json!(["sqlite"]);
    other_question["questions"][0]["prompt"] = "Something else?".into();
    let mut other_id = answered.clone();
    other_id["answers"][0]["optionIds"] = json!(["sqlite"]);
    other_id["id"] = "a0000000-0000-4000-8000-000000000009".into();
    for (reply, expected) in [
        (answered, InteractionError::Unconfirmed),
        (other_question, InteractionError::Unconfirmed),
        (other_id, InteractionError::Unconfirmed),
        (legacy_question("pending"), InteractionError::Unconfirmed),
        (
            live()["questions"][0].clone(),
            InteractionError::Wire(WireError::Malformed),
        ),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": reply}))]);
        assert_eq!(
            answer(&runner, QUESTION, &choose("sqlite")).unwrap_err(),
            expected
        );
    }
    let mut denied = legacy_approval("denied");
    denied["decision"] = "deny".into();
    let mut other_detail = legacy_approval("approved");
    other_detail["decision"] = "allowOnce".into();
    other_detail["detail"] = "rm -rf /".into();
    let mut other_expiry = legacy_approval("approved");
    other_expiry["decision"] = "allowOnce".into();
    other_expiry["expiresAt"] = "2026-10-13T09:20:00.000Z".into();
    for reply in [
        denied,
        other_detail,
        other_expiry,
        legacy_approval("pending"),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": reply}))]);
        assert_eq!(
            answer(&runner, APPROVAL, &decide("allowOnce")).unwrap_err(),
            InteractionError::Unconfirmed
        );
    }
}

#[test]
fn foreign_or_superseded_connection_is_refused_before_any_call() {
    let foreign = FakeRunner {
        runner: "other-runner".into(),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        read_at(&foreign, Instant::now()).unwrap_err(),
        InteractionError::RunnerChanged
    );
    assert_eq!(
        answer(&foreign, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::RunnerChanged
    );
    assert!(foreign.calls().is_empty());
    let stale = FakeRunner::replying(vec![Ok(live())]);
    stale.current.set(false);
    assert_eq!(
        read_at(&stale, Instant::now()).unwrap_err(),
        InteractionError::Superseded
    );
    assert!(stale.calls().is_empty());
    let invalid = FakeRunner::replying(vec![Ok(live())]);
    for task in [
        "",
        "../task",
        "task-1",
        "8C0D1F5E-2A3B-4C4D-9E5F-6A7B8C9D0E1F",
    ] {
        assert_eq!(
            Exchange::open(&invalid, RUNNER, task, Instant::now()).err(),
            Some(InteractionError::InvalidRequest),
            "{task}"
        );
    }
    assert!(invalid.calls().is_empty());
}

#[test]
fn connection_change_during_a_call_discards_the_response() {
    let revoked = FakeRunner {
        revoke_on_call: Some(1),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        read_at(&revoked, Instant::now()).unwrap_err(),
        InteractionError::Superseded
    );
    let swapped = FakeRunner {
        swap_on_call: Some(1),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        read_at(&swapped, Instant::now()).unwrap_err(),
        InteractionError::RunnerChanged
    );
    let now = Instant::now();
    let during_legacy = FakeRunner {
        revoke_on_call: Some(3),
        ..FakeRunner::replying(vec![not_found(), items(vec![]), items(vec![])])
    };
    assert_eq!(
        read_at(&during_legacy, now).unwrap_err(),
        InteractionError::Superseded
    );
    assert!(!during_legacy.ledger.is_legacy_runner(now));
    assert_eq!(during_legacy.ledger.stamp(TASK, [0; 32]), 1);
    let during_confirmation = FakeRunner {
        revoke_on_call: Some(4),
        ..FakeRunner::replying(vec![not_found(), items(vec![]), items(vec![]), not_found()])
    };
    assert_eq!(
        read_at(&during_confirmation, now).unwrap_err(),
        InteractionError::Superseded
    );
    assert!(!during_confirmation.ledger.is_legacy_runner(now));
    assert_eq!(during_confirmation.ledger.stamp(TASK, [0; 32]), 1);
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let during_answer = FakeRunner {
        revoke_on_call: Some(2),
        ..FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": approved}))])
    };
    assert_eq!(
        answer(&during_answer, APPROVAL, &decide("allowOnce")).unwrap_err(),
        InteractionError::DeliveryUncertain
    );
    assert_eq!(during_answer.calls().len(), 2);
    let mut denied = legacy_approval("denied");
    denied["decision"] = "deny".into();
    let swapped_during_answer = FakeRunner {
        swap_on_call: Some(2),
        ..FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": denied}))])
    };
    assert_eq!(
        answer(&swapped_during_answer, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::DeliveryUncertain
    );
    let before_answer = FakeRunner {
        revoke_on_call: Some(1),
        ..FakeRunner::replying(vec![Ok(live())])
    };
    assert_eq!(
        answer(&before_answer, APPROVAL, &decide("deny")).unwrap_err(),
        InteractionError::Superseded
    );
    assert_eq!(before_answer.calls().len(), 1);
}

#[test]
fn result_that_outlives_its_connection_is_rejected_after_the_worker_finished() {
    let now = Instant::now();
    let reader = FakeRunner::replying(vec![Ok(live())]);
    let finished = read_under(&reader, RUNNER, TASK, now);
    assert_eq!(finished.as_ref().map(|read| read.sequence), Ok(3));
    reader.current.set(false);
    assert_eq!(
        settle_read(&reader, finished).unwrap_err(),
        InteractionError::Superseded
    );
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let answered = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": approved}))]);
    let delivery = deliver(&answered, RUNNER, TASK, APPROVAL, &decide("allowOnce"), now);
    answered.current.set(false);
    assert_eq!(
        delivery.settle(&answered).unwrap_err(),
        InteractionError::DeliveryUncertain
    );
    let refused = FakeRunner::replying(vec![Ok(live()), conflict(), Ok(live())]);
    let delivery = deliver(&refused, RUNNER, TASK, APPROVAL, &decide("deny"), now);
    refused.current.set(false);
    assert_eq!(
        delivery.settle(&refused).unwrap_err(),
        InteractionError::DeliveryUncertain
    );
    let settled = FakeRunner::replying(vec![Ok(snapshot("everySettleReasonOnQuestions"))]);
    let delivery = deliver(
        &settled,
        RUNNER,
        TASK,
        "a0000000-0000-4000-8000-000000000003",
        &choose("sqlite"),
        now,
    );
    settled.current.set(false);
    assert_eq!(
        delivery.settle(&settled).unwrap_err(),
        InteractionError::Superseded
    );
    assert_eq!(settled.calls().len(), 1);
    let invalid = FakeRunner::replying(vec![Ok(live())]);
    let delivery = deliver(&invalid, RUNNER, TASK, QUESTION, &choose("oracle"), now);
    invalid.current.set(false);
    assert_eq!(
        delivery.settle(&invalid).unwrap_err(),
        InteractionError::Superseded
    );
}

#[test]
fn oversized_responses_are_refused_before_any_read_or_encoding() {
    let question = |answers: Value| -> RemoteRequestResponse {
        serde_json::from_value(json!({"kind": "question", "answers": answers}))
            .expect("question response")
    };
    let answer_item = |text: String, options: Vec<String>, question_id: String| json!({"questionId": question_id, "optionIds": options, "text": text});
    let plain = || answer_item(String::new(), vec!["sqlite".into()], "storage".into());
    for response in [
        question(json!([plain(), plain(), plain(), plain(), plain()])),
        question(json!([answer_item(
            "x".repeat(8193),
            vec![],
            "storage".into()
        )])),
        question(json!([answer_item(
            "x".repeat(64 * 1024 * 1024),
            vec![],
            "storage".into()
        )])),
        question(json!([answer_item(
            String::new(),
            vec!["sqlite".to_string(); 13],
            "storage".into()
        )])),
        question(json!([answer_item(
            String::new(),
            vec!["o".repeat(129)],
            "storage".into()
        )])),
        question(json!([answer_item(
            String::new(),
            vec!["sqlite".into()],
            "q".repeat(129)
        )])),
    ] {
        let runner = FakeRunner::replying(vec![Ok(live())]);
        assert_eq!(
            answer(&runner, QUESTION, &response).unwrap_err(),
            InteractionError::InvalidRequest
        );
        assert!(runner.calls().is_empty());
    }
}

#[test]
fn outgoing_answer_text_is_blank_by_the_runner_definition() {
    let custom = |text: &str| -> RemoteRequestResponse {
        serde_json::from_value(json!({
            "kind": "question",
            "answers": [{"questionId": "storage", "optionIds": [], "text": text}]
        }))
        .expect("question response")
    };
    let runner = FakeRunner::replying(vec![Ok(live())]);
    assert_eq!(
        answer(&runner, QUESTION, &custom("\u{FEFF}")).unwrap_err(),
        InteractionError::InvalidRequest
    );
    assert_eq!(runner.calls().len(), 1);
    let mut answered = legacy_question("answered");
    answered["answers"] = json!([{"questionId": "storage", "optionIds": [], "text": "\u{85}"}]);
    let runner = FakeRunner::replying(vec![Ok(live()), Ok(json!({"request": answered}))]);
    let outcome = answer(&runner, QUESTION, &custom("\u{85}")).unwrap();
    assert_eq!(wire(&outcome)["kind"], "answered");
    assert_eq!(
        runner.calls()[1].2,
        Some(json!({"answers": [{"questionId": "storage", "optionIds": [], "text": "\u{85}"}]}))
    );
}

#[test]
fn ipc_requests_are_closed() {
    let read = json!({"serverId": "linux", "runnerId": RUNNER, "taskId": TASK});
    assert!(serde_json::from_value::<RemoteInteractionsRequest>(read.clone()).is_ok());
    let mut extra = read.clone();
    extra["host"] = "foreign".into();
    assert!(serde_json::from_value::<RemoteInteractionsRequest>(extra).is_err());
    let respond = |response: Value| {
        serde_json::from_value::<RemoteRespondRequest>(json!({
            "serverId": "linux",
            "runnerId": RUNNER,
            "taskId": TASK,
            "requestId": APPROVAL,
            "response": response,
        }))
    };
    assert!(respond(json!({"kind": "approval", "decision": "deny"})).is_ok());
    assert!(respond(json!({"kind": "question", "answers": []})).is_ok());
    for invalid in [
        json!({"kind": "approval"}),
        json!({"kind": "approval", "decision": "always"}),
        json!({"kind": "approval", "decision": "deny", "answers": []}),
        json!({"kind": "approval", "decision": "deny", "path": "/tmp/x"}),
        json!({"kind": "question", "answers": [], "decision": "deny"}),
        json!({"kind": "question", "answers": [{"questionId": "q", "optionIds": [], "text": "", "url": "x"}]}),
        json!({"kind": "steer", "text": "x"}),
        json!({"decision": "deny"}),
        json!("deny"),
        Value::Null,
    ] {
        assert!(respond(invalid.clone()).is_err(), "{invalid}");
    }
    let mut extra = json!({
        "serverId": "linux",
        "runnerId": RUNNER,
        "taskId": TASK,
        "requestId": APPROVAL,
        "response": {"kind": "approval", "decision": "deny"},
    });
    extra["url"] = "http://localhost".into();
    assert!(serde_json::from_value::<RemoteRespondRequest>(extra).is_err());
}

#[test]
fn unknown_or_malformed_server_never_yields_a_connection() {
    let directory = std::env::temp_dir().join(format!(
        "codevo-remote-interactions-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let state = RemoteRunnerState::new(directory).expect("runner state");
    assert_eq!(
        admit_connection(&state, "server-b", RUNNER).err(),
        Some(InteractionError::Transport(
            "Server is not connected".into()
        ))
    );
    for (server, runner) in [
        ("../server", RUNNER),
        ("", RUNNER),
        ("server-a", ""),
        ("server-a", "runner\nid"),
    ] {
        assert_eq!(
            admit_connection(&state, server, runner).err(),
            Some(InteractionError::InvalidRequest),
            "{server:?} {runner:?}"
        );
    }
}

#[cfg(unix)]
#[path = "interactions_transport_tests.rs"]
mod transport;
