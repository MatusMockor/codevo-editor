use super::*;
use serde_json::json;

const FIXTURE: &str = include_str!("fixtures/agent-interactions-wire.json");
const TASK: &str = "8c0d1f5e-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
const OTHER_TASK: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const UNKNOWN: ResponseCapability = ResponseCapability::NotResumable {
    reason: SettleReason::Unknown,
};

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("interaction fixture is JSON")
}

fn cases(section: &str) -> Vec<(String, Value)> {
    fixture()[section]
        .as_array()
        .expect("fixture section")
        .iter()
        .map(|case| {
            (
                case["name"].as_str().expect("case name").to_string(),
                case["value"].clone(),
            )
        })
        .collect()
}

fn case(section: &str, name: &str) -> Value {
    cases(section)
        .into_iter()
        .find(|(candidate, _)| candidate == name)
        .map(|(_, value)| value)
        .expect("named fixture case")
}

fn live() -> Value {
    case("snapshots", "livePendingQuestionAndApproval")
}

fn with_question(edit: impl FnOnce(&mut Value)) -> Value {
    let mut snapshot = live();
    edit(&mut snapshot["questions"][0]);
    snapshot
}

fn with_approval(edit: impl FnOnce(&mut Value)) -> Value {
    let mut snapshot = live();
    edit(&mut snapshot["approvals"][0]);
    snapshot
}

fn error(value: Value) -> Option<WireError> {
    parse_snapshot(value, TASK).err()
}

fn legacy(item: &Value) -> Value {
    let mut item = item.clone();
    let fields = item.as_object_mut().expect("wire item");
    for added in ["createdAt", "settledAt", "responseCapability"] {
        fields.remove(added);
    }
    item
}

fn numbered(item: &Value, prefix: char, index: usize) -> Value {
    let mut item = item.clone();
    item["id"] = format!("{prefix}0000000-0000-4000-8000-{index:012}").into();
    item
}

fn settled_approval(index: usize) -> Value {
    let mut item = numbered(&legacy(&live()["approvals"][0]), 'b', index);
    item["status"] = "expired".into();
    item
}

fn pending_approval(index: usize) -> Value {
    numbered(&legacy(&live()["approvals"][0]), 'b', index)
}

#[test]
fn fixture_metadata_matches_the_desktop_contract() {
    let fixture = fixture();
    assert_eq!(fixture["schemaVersion"], 1);
    assert_eq!(
        fixture["remoteRunnerRoute"],
        "/v1/tasks/{taskId}/interactions"
    );
    assert_eq!(fixture["limits"]["maxQuestions"], MAX_QUESTIONS);
    assert_eq!(fixture["limits"]["maxApprovals"], MAX_APPROVALS);
    assert_eq!(
        fixture["responseCapabilityTypes"],
        json!(["live", "notResumable"])
    );
    let reasons = fixture["settleReasons"].as_array().expect("settle reasons");
    assert_eq!(reasons.len(), 7);
    for reason in reasons {
        let parsed: SettleReason = serde_json::from_value(reason.clone()).expect("known reason");
        assert_eq!(&serde_json::to_value(parsed).unwrap(), reason);
        let capability: ResponseCapability =
            serde_json::from_value(json!({"type": "notResumable", "reason": reason}))
                .expect("capability");
        assert_eq!(
            capability,
            ResponseCapability::NotResumable { reason: parsed }
        );
    }
}

#[test]
fn every_valid_fixture_snapshot_round_trips_unchanged() {
    let snapshots = cases("snapshots");
    let names: Vec<&str> = snapshots.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(
        names,
        [
            "empty",
            "livePendingQuestionAndApproval",
            "pendingWithoutWaiter",
            "answeredAndDecided",
            "everySettleReasonOnQuestions",
            "everySettleReasonOnApprovals",
            "legacyRowsWithoutTimesOrReason",
            "olderQuestionsEvicted",
            "settledApprovalsLeftOut",
        ]
    );
    for (name, value) in snapshots {
        let task = value["taskId"].as_str().expect("task id").to_string();
        let parsed = parse_snapshot(value.clone(), &task);
        assert!(parsed.is_ok(), "{name}: {parsed:?}");
        assert_eq!(
            serde_json::to_value(parsed.unwrap()).unwrap(),
            value,
            "{name}"
        );
    }
}

#[test]
fn fixture_snapshots_keep_truncation_flags_reasons_and_expiry() {
    let evicted = parse_snapshot(case("snapshots", "olderQuestionsEvicted"), TASK).unwrap();
    assert!(evicted.questions_truncated);
    assert!(!evicted.approvals_truncated);
    let left_out = parse_snapshot(case("snapshots", "settledApprovalsLeftOut"), TASK).unwrap();
    assert!(left_out.approvals_truncated);
    assert!(!left_out.questions_truncated);
    let reasons = parse_snapshot(case("snapshots", "everySettleReasonOnApprovals"), TASK).unwrap();
    let seen: Vec<_> = reasons
        .approvals
        .iter()
        .map(|approval| approval.response_capability)
        .collect();
    let expected: Vec<_> = [
        SettleReason::RunnerRestarted,
        SettleReason::RunnerStopped,
        SettleReason::TurnEnded,
        SettleReason::TaskCancelled,
        SettleReason::ProviderWithdrew,
        SettleReason::TimedOut,
        SettleReason::Unknown,
    ]
    .into_iter()
    .map(|reason| Some(ResponseCapability::NotResumable { reason }))
    .collect();
    assert_eq!(seen, expected);
    assert!(reasons
        .approvals
        .iter()
        .all(|approval| approval.expires_at == "2026-10-13T09:10:00.000Z"));
    let waiting = parse_snapshot(case("snapshots", "pendingWithoutWaiter"), TASK).unwrap();
    assert_eq!(waiting.questions[0].response_capability, Some(UNKNOWN));
    assert_eq!(waiting.approvals[0].response_capability, Some(UNKNOWN));
    let answered = parse_snapshot(case("snapshots", "answeredAndDecided"), TASK).unwrap();
    assert_eq!(answered.questions[0].response_capability, None);
    assert!(answered
        .approvals
        .iter()
        .all(|approval| approval.response_capability.is_none() && approval.decision.is_some()));
}

#[test]
fn every_rejected_fixture_snapshot_fails_closed() {
    let rejected = cases("rejectedSnapshots");
    assert!(rejected.len() >= 40, "{}", rejected.len());
    let mut accepted = Vec::new();
    for (name, value) in rejected {
        let own_task = value
            .get("taskId")
            .and_then(Value::as_str)
            .unwrap_or(TASK)
            .to_string();
        if parse_snapshot(value.clone(), TASK).is_ok() || parse_snapshot(value, &own_task).is_ok() {
            accepted.push(name);
        }
    }
    assert_eq!(accepted, Vec::<String>::new());
}

#[test]
fn rejected_fixture_snapshots_fail_for_the_documented_reason() {
    for (name, expected) in [
        ("unknownRootField", WireError::Malformed),
        ("missingQuestionsTruncated", WireError::Malformed),
        ("questionsTruncatedNotBoolean", WireError::Malformed),
        ("questionsTruncatedNull", WireError::Malformed),
        ("missingApprovalsTruncated", WireError::Malformed),
        ("negativeSequence", WireError::Malformed),
        ("fractionalSequence", WireError::Malformed),
        ("sequenceBeyondSafeInteger", WireError::Malformed),
        ("questionsNotArray", WireError::Malformed),
        ("approvalsMissing", WireError::Malformed),
        ("unknownItemField", WireError::Malformed),
        ("unknownStatus", WireError::Malformed),
        ("unknownApprovalStatus", WireError::Malformed),
        ("createdAtMissing", WireError::Malformed),
        ("settledAtMissing", WireError::Malformed),
        ("createdAtAsNumber", WireError::Malformed),
        ("unknownCapabilityType", WireError::Malformed),
        ("liveWithReason", WireError::Malformed),
        ("capabilityAsString", WireError::Malformed),
        ("capabilityNull", WireError::Malformed),
        ("notResumableWithoutReason", WireError::Malformed),
        ("unknownSettleReason", WireError::Malformed),
        ("settleReasonAsFreeText", WireError::Malformed),
        ("notResumableWithExtraField", WireError::Malformed),
        ("questionOfAnotherTask", WireError::ForeignTask),
        ("approvalOfAnotherTask", WireError::ForeignTask),
        ("duplicateQuestionIds", WireError::Duplicate),
        ("duplicateApprovalIds", WireError::Duplicate),
        ("createdAtNotIso", WireError::InvalidItem),
        ("pendingWithSettledAt", WireError::InvalidItem),
        ("pendingWithoutCapability", WireError::InvalidItem),
        ("pendingNotResumableWithKnownReason", WireError::InvalidItem),
        ("settledButLive", WireError::InvalidItem),
        ("settledWithoutCapability", WireError::InvalidItem),
        ("answeredWithCapability", WireError::InvalidItem),
        ("approvedWithCapability", WireError::InvalidItem),
    ] {
        assert_eq!(
            error(case("rejectedSnapshots", name)),
            Some(expected),
            "{name}"
        );
    }
    assert_eq!(
        parse_snapshot(case("rejectedSnapshots", "taskIdNotUuid"), "task-1").err(),
        Some(WireError::Malformed)
    );
}

#[test]
fn snapshot_of_another_task_is_foreign() {
    for (name, value) in cases("snapshots") {
        assert_eq!(
            parse_snapshot(value, OTHER_TASK).err(),
            Some(WireError::ForeignTask),
            "{name}"
        );
    }
}

#[test]
fn item_counts_are_bounded_at_thirty_two_per_kind() {
    let question = live()["questions"][0].clone();
    let approval = live()["approvals"][0].clone();
    let questions = |count: usize| -> Vec<Value> {
        (0..count)
            .map(|index| numbered(&question, 'a', index))
            .collect()
    };
    let approvals = |count: usize| -> Vec<Value> {
        (0..count)
            .map(|index| numbered(&approval, 'b', index))
            .collect()
    };
    let mut full = live();
    full["questions"] = questions(MAX_QUESTIONS).into();
    full["approvals"] = approvals(MAX_APPROVALS).into();
    let parsed = parse_snapshot(full.clone(), TASK).unwrap();
    assert_eq!(parsed.questions.len(), 32);
    assert_eq!(parsed.approvals.len(), 32);
    let mut many_questions = full.clone();
    many_questions["questions"] = questions(MAX_QUESTIONS + 1).into();
    assert_eq!(error(many_questions), Some(WireError::TooMany));
    let mut many_approvals = full;
    many_approvals["approvals"] = approvals(MAX_APPROVALS + 1).into();
    assert_eq!(error(many_approvals), Some(WireError::TooMany));
}

#[test]
fn oversize_sections_are_rejected_before_items_are_parsed() {
    let options: Vec<Value> = (0..12)
        .map(|index| json!({"id": format!("o{index}"), "label": "Option", "description": "d".repeat(2048)}))
        .collect();
    let prompts: Vec<Value> = (0..4)
        .map(|index| {
            json!({"id": format!("q{index}"), "header": "Header", "prompt": "p".repeat(8192), "options": options, "multiple": false, "allowCustom": true})
        })
        .collect();
    let mut heavy = live()["questions"][0].clone();
    heavy["questions"] = prompts.into();
    let mut one = live();
    one["questions"] = json!([heavy.clone()]);
    assert!(parse_snapshot(one, TASK).is_ok());
    let mut snapshot = live();
    snapshot["questions"] = (0..MAX_QUESTIONS)
        .map(|index| numbered(&heavy, 'a', index))
        .collect::<Vec<_>>()
        .into();
    assert!(serde_json::to_vec(&snapshot["questions"]).unwrap().len() > MAX_SECTION_BYTES);
    assert_eq!(error(snapshot), Some(WireError::Oversize));
    let mut detail = live();
    detail["approvals"][0]["detail"] = "x".repeat(MAX_SECTION_BYTES).into();
    assert_eq!(error(detail), Some(WireError::Oversize));
    let mut long_detail = live();
    long_detail["approvals"][0]["detail"] = "x".repeat(16 * 1024 + 1).into();
    assert_eq!(error(long_detail), Some(WireError::InvalidItem));
}

#[test]
fn timestamps_are_strict_utc_milliseconds_on_real_calendar_days() {
    for valid in [
        "2026-10-13T09:00:00.000Z",
        "2024-02-29T23:59:59.999Z",
        "2000-02-29T00:00:00.000Z",
        "0000-01-01T00:00:00.000Z",
    ] {
        assert!(timestamp(valid), "{valid}");
    }
    for invalid in [
        "",
        "2026-10-13",
        "2026-10-13T09:00:00Z",
        "2026-10-13T09:00:00.00Z",
        "2026-10-13T09:00:00.0000Z",
        "2026-10-13T09:00:00.000z",
        "2026-10-13T09:00:00.000+00:00",
        "2026-10-13 09:00:00.000Z",
        "2026-10-13T09:00:00.000Z ",
        "2026-02-29T09:00:00.000Z",
        "1900-02-29T09:00:00.000Z",
        "2026-04-31T09:00:00.000Z",
        "2026-13-01T09:00:00.000Z",
        "2026-00-10T09:00:00.000Z",
        "2026-10-00T09:00:00.000Z",
        "2026-10-13T24:00:00.000Z",
        "2026-10-13T09:60:00.000Z",
        "2026-10-13T09:00:60.000Z",
        "2026-10-13T09:00:00.0a0Z",
        "٢٠٢٦-10-13T09:00:00Z",
        "+026-10-13T09:00:00.000Z",
    ] {
        assert!(!timestamp(invalid), "{invalid}");
    }
}

#[test]
fn approval_expiry_is_required_strict_and_preserved() {
    let parsed = parse_snapshot(live(), TASK).unwrap();
    assert_eq!(parsed.approvals[0].expires_at, "2026-10-13T09:10:00.000Z");
    assert_eq!(
        serde_json::to_value(&parsed.approvals[0]).unwrap()["expiresAt"],
        "2026-10-13T09:10:00.000Z"
    );
    let missing = with_approval(|approval| {
        approval.as_object_mut().unwrap().remove("expiresAt");
    });
    assert_eq!(error(missing), Some(WireError::Malformed));
    for (expires_at, expected) in [
        (Value::Null, WireError::Malformed),
        (json!(1_791_882_600_000_u64), WireError::Malformed),
        (json!("2026-10-13T09:10:00Z"), WireError::InvalidItem),
        (json!("2026-02-30T09:10:00.000Z"), WireError::InvalidItem),
        (json!("soon"), WireError::InvalidItem),
    ] {
        let snapshot = with_approval(|approval| approval["expiresAt"] = expires_at.clone());
        assert_eq!(error(snapshot), Some(expected), "{expires_at}");
    }
    let past = with_approval(|approval| approval["expiresAt"] = "2020-01-01T00:00:00.000Z".into());
    let parsed = parse_snapshot(past, TASK).unwrap();
    assert_eq!(
        parsed.approvals[0].response_capability,
        Some(ResponseCapability::Live)
    );
}

#[test]
fn approval_decision_must_agree_with_status_and_offered_decisions() {
    let decided = |status: &str, decision: Value| {
        with_approval(|approval| {
            approval["status"] = status.into();
            approval["settledAt"] = "2026-10-13T09:05:00.000Z".into();
            approval
                .as_object_mut()
                .unwrap()
                .remove("responseCapability");
            approval["decision"] = decision;
        })
    };
    assert!(parse_snapshot(decided("approved", "allowOnce".into()), TASK).is_ok());
    assert!(parse_snapshot(decided("denied", "deny".into()), TASK).is_ok());
    assert_eq!(
        error(decided("approved", "deny".into())),
        Some(WireError::InvalidItem)
    );
    assert_eq!(
        error(decided("denied", "allowOnce".into())),
        Some(WireError::InvalidItem)
    );
    assert_eq!(
        error(decided("approved", Value::Null)),
        Some(WireError::Malformed)
    );
    assert_eq!(
        error(decided("approved", "always".into())),
        Some(WireError::Malformed)
    );
    let not_offered = with_approval(|approval| {
        approval["decisions"] = json!(["allowOnce", "deny"]);
        approval["status"] = "approved".into();
        approval["settledAt"] = "2026-10-13T09:05:00.000Z".into();
        approval
            .as_object_mut()
            .unwrap()
            .remove("responseCapability");
        approval["decision"] = "allowForSession".into();
    });
    assert_eq!(error(not_offered), Some(WireError::InvalidItem));
    let undecided = with_approval(|approval| {
        approval["status"] = "approved".into();
        approval
            .as_object_mut()
            .unwrap()
            .remove("responseCapability");
    });
    assert_eq!(error(undecided), Some(WireError::InvalidItem));
    let pending_decided = with_approval(|approval| approval["decision"] = "deny".into());
    assert_eq!(error(pending_decided), Some(WireError::InvalidItem));
    let without_deny = with_approval(|approval| approval["decisions"] = json!(["allowOnce"]));
    assert_eq!(error(without_deny), Some(WireError::InvalidItem));
    let foreign_kind = with_approval(|approval| approval["kind"] = "mcpElicitation".into());
    assert_eq!(error(foreign_kind), Some(WireError::Malformed));
    let bad_id = with_approval(|approval| approval["id"] = "approval-1".into());
    assert_eq!(error(bad_id), Some(WireError::InvalidItem));
}

#[test]
fn question_answers_must_agree_with_status() {
    let null_answers = with_question(|question| question["answers"] = Value::Null);
    assert_eq!(error(null_answers), Some(WireError::Malformed));
    let pending_answered = with_question(|question| {
        question["answers"] =
            json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}])
    });
    assert_eq!(error(pending_answered), Some(WireError::InvalidItem));
    let unanswered = with_question(|question| {
        question["status"] = "answered".into();
        question
            .as_object_mut()
            .unwrap()
            .remove("responseCapability");
    });
    assert_eq!(error(unanswered), Some(WireError::InvalidItem));
    let unknown_option = with_question(|question| {
        question["status"] = "answered".into();
        question
            .as_object_mut()
            .unwrap()
            .remove("responseCapability");
        question["answers"] =
            json!([{"questionId": "storage", "optionIds": ["oracle"], "text": ""}]);
    });
    assert_eq!(error(unknown_option), Some(WireError::InvalidItem));
}

#[test]
fn legacy_questions_gain_null_times_and_a_capability_from_status() {
    let question = legacy(&live()["questions"][0]);
    let mut answered = numbered(&question, 'a', 2);
    answered["status"] = "answered".into();
    answered["answers"] = json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]);
    let mut cancelled = numbered(&question, 'a', 3);
    cancelled["status"] = "cancelled".into();
    let mut expired = numbered(&question, 'a', 4);
    expired["status"] = "expired".into();
    let items = json!({"items": [question, answered, cancelled, expired]});
    let parsed = parse_legacy_questions(items, TASK).unwrap();
    let capabilities: Vec<_> = parsed
        .iter()
        .map(|question| question.response_capability)
        .collect();
    assert_eq!(
        capabilities,
        [
            Some(ResponseCapability::Live),
            None,
            Some(UNKNOWN),
            Some(UNKNOWN)
        ]
    );
    assert!(parsed
        .iter()
        .all(|question| question.created_at.is_none() && question.settled_at.is_none()));
    let wire = serde_json::to_value(&parsed[0]).unwrap();
    assert_eq!(wire["createdAt"], Value::Null);
    assert_eq!(wire["settledAt"], Value::Null);
    assert_eq!(wire["responseCapability"], json!({"type": "live"}));
    assert!(serde_json::to_value(&parsed[1])
        .unwrap()
        .get("responseCapability")
        .is_none());
}

#[test]
fn legacy_question_lists_fail_closed() {
    let question = legacy(&live()["questions"][0]);
    assert!(parse_legacy_questions(json!({"items": [question.clone()]}), TASK).is_ok());
    for (value, expected) in [
        (json!({"items": [question.clone()]}), WireError::ForeignTask),
        (json!({"items": {}}), WireError::Malformed),
        (json!([]), WireError::Malformed),
    ] {
        assert_eq!(
            parse_legacy_questions(value, OTHER_TASK).err(),
            Some(expected)
        );
    }
    for (value, expected) in [
        (
            json!({"items": [question.clone(), question.clone()]}),
            WireError::Duplicate,
        ),
        (
            json!({"items": [question.clone()], "cursor": 1}),
            WireError::Malformed,
        ),
        (
            json!({"items": [live()["questions"][0].clone()]}),
            WireError::Malformed,
        ),
        (
            json!({"items": (0..33).map(|index| numbered(&question, 'a', index)).collect::<Vec<_>>()}),
            WireError::TooMany,
        ),
    ] {
        assert_eq!(parse_legacy_questions(value, TASK).err(), Some(expected));
    }
}

#[test]
fn legacy_approvals_keep_every_pending_and_the_newest_settled() {
    let within: Vec<Value> = (0..MAX_APPROVALS).map(settled_approval).collect();
    let (kept, truncated) = parse_legacy_approvals(json!({"items": within}), TASK).unwrap();
    assert_eq!(kept.len(), MAX_APPROVALS);
    assert!(!truncated);
    assert!(kept.iter().all(|approval| approval.created_at.is_none()
        && approval.settled_at.is_none()
        && approval.response_capability == Some(UNKNOWN)
        && approval.expires_at == "2026-10-13T09:10:00.000Z"));
    let mut items: Vec<Value> = vec![pending_approval(0), settled_approval(1)];
    items.extend((2..47).map(settled_approval));
    items.push(pending_approval(47));
    assert_eq!(items.len(), MAX_LEGACY_APPROVALS);
    let (kept, truncated) = parse_legacy_approvals(json!({"items": items}), TASK).unwrap();
    assert!(truncated);
    assert_eq!(kept.len(), MAX_APPROVALS);
    let ids: Vec<&str> = kept.iter().map(|approval| approval.id.as_str()).collect();
    let mut expected = vec!["b0000000-0000-4000-8000-000000000000".to_string()];
    expected.extend((17..=47).map(|index| format!("b0000000-0000-4000-8000-{index:012}")));
    assert_eq!(ids, expected);
    assert_eq!(kept[0].response_capability, Some(ResponseCapability::Live));
    assert_eq!(kept[31].response_capability, Some(ResponseCapability::Live));
}

#[test]
fn legacy_approval_lists_fail_closed() {
    let approval = pending_approval(1);
    assert!(parse_legacy_approvals(json!({"items": [approval.clone()]}), TASK).is_ok());
    assert_eq!(
        parse_legacy_approvals(json!({"items": [approval.clone()]}), OTHER_TASK).err(),
        Some(WireError::ForeignTask)
    );
    let mut without_expiry = approval.clone();
    without_expiry.as_object_mut().unwrap().remove("expiresAt");
    for (value, expected) in [
        (
            json!({"items": [approval.clone(), approval.clone()]}),
            WireError::Duplicate,
        ),
        (
            json!({"items": [live()["approvals"][0].clone()]}),
            WireError::Malformed,
        ),
        (json!({"items": [without_expiry]}), WireError::Malformed),
        (
            json!({"items": (0..49).map(settled_approval).collect::<Vec<_>>()}),
            WireError::TooMany,
        ),
        (
            json!({"items": (0..33).map(pending_approval).collect::<Vec<_>>()}),
            WireError::TooMany,
        ),
    ] {
        assert_eq!(parse_legacy_approvals(value, TASK).err(), Some(expected));
    }
}

#[test]
fn a_refused_pending_request_is_never_reported_live() {
    let snapshot = parse_snapshot(live(), TASK).unwrap();
    assert_eq!(
        snapshot.questions[0].clone().refused().response_capability,
        Some(UNKNOWN)
    );
    assert_eq!(
        snapshot.approvals[0].clone().refused().response_capability,
        Some(UNKNOWN)
    );
    let settled = parse_snapshot(case("snapshots", "everySettleReasonOnQuestions"), TASK).unwrap();
    assert_eq!(
        settled.questions[0].clone().refused().response_capability,
        Some(ResponseCapability::NotResumable {
            reason: SettleReason::RunnerRestarted
        })
    );
    let answered = parse_snapshot(case("snapshots", "answeredAndDecided"), TASK).unwrap();
    assert_eq!(
        answered.questions[0].clone().refused().response_capability,
        None
    );
    assert_eq!(
        answered.approvals[0].clone().refused().response_capability,
        None
    );
}

#[test]
fn answer_results_are_closed_and_scoped_to_the_task() {
    let question = legacy(&live()["questions"][0]);
    let approval = pending_approval(1);
    assert!(parse_question_result(json!({"request": question.clone()}), TASK).is_ok());
    assert!(parse_approval_result(json!({"request": approval.clone()}), TASK).is_ok());
    assert_eq!(
        parse_question_result(json!({"request": question.clone()}), OTHER_TASK).err(),
        Some(WireError::ForeignTask)
    );
    assert_eq!(
        parse_approval_result(json!({"request": approval.clone()}), OTHER_TASK).err(),
        Some(WireError::ForeignTask)
    );
    assert_eq!(
        parse_question_result(json!({"request": question, "token": "x"}), TASK).err(),
        Some(WireError::Malformed)
    );
    assert_eq!(
        parse_approval_result(json!({"request": approval, "token": "x"}), TASK).err(),
        Some(WireError::Malformed)
    );
}

#[test]
fn blank_text_follows_the_runner_definition_at_the_wire_boundary() {
    let visible = "\u{85}";
    let blank = "\u{FEFF}";
    for path in [
        "/questions/0/questions/0/prompt",
        "/questions/0/questions/0/options/0/label",
        "/approvals/0/title",
        "/approvals/0/facts/0/label",
    ] {
        let mut accepted = live();
        *accepted.pointer_mut(path).expect("fixture field") = visible.into();
        assert!(parse_snapshot(accepted, TASK).is_ok(), "{path}");
        let mut rejected = live();
        *rejected.pointer_mut(path).expect("fixture field") = blank.into();
        assert_eq!(error(rejected), Some(WireError::InvalidItem), "{path}");
    }
    let answered = |text: &str| {
        with_question(|question| {
            question["status"] = "answered".into();
            question["settledAt"] = "2026-10-13T09:05:00.000Z".into();
            question
                .as_object_mut()
                .unwrap()
                .remove("responseCapability");
            question["answers"] = json!([{"questionId": "storage", "optionIds": [], "text": text}]);
        })
    };
    assert!(parse_snapshot(answered(visible), TASK).is_ok());
    assert_eq!(error(answered(blank)), Some(WireError::InvalidItem));
    assert_eq!(error(answered(" \n")), Some(WireError::InvalidItem));
}
