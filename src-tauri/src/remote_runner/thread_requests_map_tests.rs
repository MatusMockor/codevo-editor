use super::super::interactions_fake::{
    live, observed, retasked, sequenced, snapshot, task, APPROVAL, QUESTION, TASK,
};
use super::super::interactions_wire::MAX_APPROVALS;
use super::super::thread_requests_support::{iso, runner_item, EXPIRES_AT};
use super::*;
use serde_json::{json, Value};

const WIRE: &str = include_str!("../../../contracts/agent-runtime-request-wire.json");
const IPC: &str = include_str!("../../../contracts/remote-agent-thread-requests-ipc.json");
const STARTED: u64 = 1_700_000_000_000;
const CREATED: u64 = 1_791_882_000_000;
const SETTLED: u64 = 1_791_882_300_000;

fn records(read: &RemoteInteractions) -> Vec<Value> {
    requests(read, STARTED)
        .expect("mapped requests")
        .iter()
        .map(|request| serde_json::to_value(request).expect("wire request"))
        .collect()
}

fn mapped(name: &str) -> Vec<Value> {
    records(&observed(snapshot(name), InteractionSource::Snapshot))
}

#[test]
fn live_pending_rows_become_pending_records_in_creation_order() {
    let source = live();
    let records = mapped("livePendingQuestionAndApproval");
    assert_eq!(
        records,
        [
            json!({
                "id": QUESTION,
                "turnId": TASK,
                "provider": "claudeCode",
                "createdAtEpochMs": CREATED,
                "resolvedAtEpochMs": null,
                "order": 0,
                "version": 7,
                "anchorToolId": null,
                "body": {"kind": "question", "questions": source["questions"][0]["questions"]},
                "status": "pending",
                "responseCapability": {"kind": "live"},
                "resolution": null,
            }),
            json!({
                "id": APPROVAL,
                "turnId": TASK,
                "provider": "codex",
                "createdAtEpochMs": CREATED,
                "resolvedAtEpochMs": null,
                "order": 1,
                "version": 7,
                "anchorToolId": null,
                "body": {
                    "kind": "approval",
                    "approvalKind": "command",
                    "title": "Run a command?",
                    "detail": "npm test",
                    "detailTruncated": false,
                    "facts": [{"label": "Directory", "value": "/srv/project"}],
                    "decisions": ["allowOnce", "allowForSession", "deny"],
                },
                "status": "pending",
                "responseCapability": {"kind": "live"},
                "resolution": null,
            }),
        ]
    );
    assert_eq!(source["approvals"][0]["expiresAt"], EXPIRES_AT);
    assert!(!json!(records).to_string().contains("expires"));
}

#[test]
fn pending_rows_without_a_waiter_become_submitting_records_above_the_live_version() {
    let records = mapped("pendingWithoutWaiter");
    assert_eq!(records.len(), 2);
    for record in &records {
        assert_eq!(record["status"], "submitting");
        assert_eq!(
            record["responseCapability"],
            json!({"kind": "notResumable", "reason": "unknown"})
        );
        assert_eq!(record["resolution"], Value::Null);
        assert_eq!(record["resolvedAtEpochMs"], Value::Null);
        assert_eq!(record["version"], 4);
    }
    let live_again = sequenced(live(), 1);
    let live_records = records_of(live_again);
    assert!(live_records.iter().all(|record| record["version"] == 3));
}

fn records_of(snapshot: Value) -> Vec<Value> {
    records(&observed(snapshot, InteractionSource::Snapshot))
}

#[test]
fn answered_and_decided_rows_become_resolved_records_with_their_resolution() {
    let source = snapshot("answeredAndDecided");
    let records = mapped("answeredAndDecided");
    assert_eq!(records.len(), 4);
    for record in &records {
        assert_eq!(record["status"], "resolved");
        assert_eq!(
            record["responseCapability"],
            json!({"kind": "notResumable", "reason": "unknown"})
        );
        assert_eq!(record["createdAtEpochMs"], CREATED);
        assert_eq!(record["resolvedAtEpochMs"], SETTLED);
        assert_eq!(record["version"], 13);
    }
    assert_eq!(
        records[0]["resolution"],
        json!({"kind": "answers", "answers": source["questions"][0]["answers"]})
    );
    let decisions: Vec<&Value> = records[1..]
        .iter()
        .map(|record| &record["resolution"])
        .collect();
    assert_eq!(
        decisions,
        [
            &json!({"kind": "decision", "decision": "allowOnce"}),
            &json!({"kind": "decision", "decision": "allowForSession"}),
            &json!({"kind": "decision", "decision": "deny"}),
        ]
    );
    let orders: Vec<&Value> = records.iter().map(|record| &record["order"]).collect();
    assert_eq!(orders, [&json!(0), &json!(1), &json!(2), &json!(3)]);
}

#[test]
fn unanswered_rows_keep_their_status_and_map_every_settle_reason() {
    let expected_reason = |reason: &str| match reason {
        "providerWithdrew" => "providerCancelled".to_string(),
        other => other.to_string(),
    };
    let mut reasons = std::collections::BTreeSet::new();
    let mut statuses = std::collections::BTreeSet::new();
    for (name, section, version) in [
        ("everySettleReasonOnQuestions", "questions", 25),
        ("everySettleReasonOnApprovals", "approvals", 29),
    ] {
        let source = snapshot(name);
        let items = source[section].as_array().expect("items");
        let records = mapped(name);
        assert_eq!(records.len(), items.len(), "{name}");
        for (item, record) in items.iter().zip(&records) {
            let reason = item["responseCapability"]["reason"]
                .as_str()
                .expect("reason");
            assert_eq!(record["id"], item["id"], "{name}");
            assert_eq!(record["status"], item["status"], "{name}");
            assert_eq!(
                record["responseCapability"],
                json!({"kind": "notResumable", "reason": expected_reason(reason)}),
                "{name}"
            );
            assert_eq!(record["resolution"], Value::Null);
            assert_eq!(record["resolvedAtEpochMs"], SETTLED);
            assert_eq!(record["version"], version);
            reasons.insert(reason.to_string());
            statuses.insert(item["status"].as_str().expect("status").to_string());
        }
    }
    assert_eq!(reasons.len(), 7);
    assert_eq!(
        statuses.into_iter().collect::<Vec<_>>(),
        ["cancelled", "expired", "timedOut"]
    );
    assert_eq!(
        close_reason(SettleReason::ProviderWithdrew),
        CloseReason::ProviderCancelled
    );
}

#[test]
fn rows_without_times_take_the_turn_start_for_creation_and_resolution() {
    let records = mapped("legacyRowsWithoutTimesOrReason");
    let statuses: Vec<&Value> = records.iter().map(|record| &record["status"]).collect();
    assert_eq!(
        statuses,
        [
            &json!("resolved"),
            &json!("expired"),
            &json!("resolved"),
            &json!("timedOut")
        ]
    );
    for (record, order) in records.iter().zip(0..) {
        assert_eq!(record["createdAtEpochMs"], STARTED);
        assert_eq!(record["resolvedAtEpochMs"], STARTED);
        assert_eq!(record["order"], order);
        assert_eq!(record["version"], 1);
        assert_eq!(record["anchorToolId"], Value::Null);
    }
    let mut timed = snapshot("legacyRowsWithoutTimesOrReason");
    timed["approvals"][1]["settledAt"] = "2026-10-13T09:05:00.000Z".into();
    timed["questions"][1]["settledAt"] = "1999-01-01T00:00:00.000Z".into();
    let records = records_of(timed);
    assert_eq!(records[3]["createdAtEpochMs"], STARTED);
    assert_eq!(records[3]["resolvedAtEpochMs"], SETTLED);
    assert_eq!(records[1]["resolvedAtEpochMs"], STARTED);
}

#[test]
fn order_merges_questions_and_approvals_by_creation_with_untimed_rows_first() {
    let mut mixed = live();
    let question = mixed["questions"][0].clone();
    let approval = mixed["approvals"][0].clone();
    let numbered = |item: &Value, prefix: char, index: usize, created: Value| {
        let mut item = item.clone();
        item["id"] = format!("{prefix}0000000-0000-4000-8000-{index:012}").into();
        item["createdAt"] = created;
        item
    };
    mixed["questions"] = json!([
        numbered(&question, 'a', 1, "2026-10-13T09:00:03.000Z".into()),
        numbered(&question, 'a', 2, Value::Null),
        numbered(&question, 'a', 3, "2026-10-13T09:00:01.000Z".into()),
    ]);
    mixed["approvals"] = json!([
        numbered(&approval, 'b', 1, "2026-10-13T09:00:02.000Z".into()),
        numbered(&approval, 'b', 2, Value::Null),
        numbered(&approval, 'b', 3, "2026-10-13T09:00:01.000Z".into()),
    ]);
    let records = records_of(mixed);
    let ids: Vec<String> = records
        .iter()
        .map(|record| {
            record["id"].as_str().expect("id")[..1].to_string()
                + &record["id"].as_str().expect("id")[35..]
        })
        .collect();
    assert_eq!(ids, ["a2", "b2", "a3", "b3", "b1", "a1"]);
    for (record, order) in records.iter().zip(0..) {
        assert_eq!(record["order"], order);
    }
    assert_eq!(records[0]["createdAtEpochMs"], STARTED);
    assert_eq!(records[2]["createdAtEpochMs"], CREATED + 1_000);
}

#[test]
fn every_remote_approval_kind_maps_to_the_same_local_kind() {
    for kind in ["command", "fileChange", "tool", "plan"] {
        let mut source = live();
        source["approvals"][0]["kind"] = kind.into();
        assert_eq!(records_of(source)[1]["body"]["approvalKind"], kind);
    }
}

#[test]
fn every_fixture_snapshot_maps_to_records_the_request_model_accepts() {
    let fixture: Value = serde_json::from_str(super::super::interactions_fake::FIXTURE).unwrap();
    for case in fixture["snapshots"].as_array().expect("snapshots") {
        let name = case["name"].as_str().expect("name");
        let read = observed(case["value"].clone(), InteractionSource::Snapshot);
        let mapped = requests(&read, STARTED).expect(name);
        assert_eq!(
            mapped.len(),
            read.questions.len() + read.approvals.len(),
            "{name}"
        );
        for request in &mapped {
            let wire = serde_json::to_value(request).expect("wire request");
            let parsed: RuntimeRequest = serde_json::from_value(wire).expect(name);
            assert_eq!(&parsed, request, "{name}");
            assert_eq!(request.parts().turn_id, TASK);
            assert_eq!(request.parts().anchor_tool_id, None);
            assert_eq!(
                request.parts().version % 2 == 0,
                name == "pendingWithoutWaiter"
            );
        }
        let scope = MessageScope {
            server_id: "srv-alpha",
            thread_id: TASK,
            epoch: epoch(InteractionSource::Snapshot, 9, 0),
        };
        let message = message(scope, mapped, is_truncated(&read)).expect(name);
        let wire = serde_json::to_value(&message).expect("wire message");
        assert_eq!(wire["workspaceId"], "srv-alpha");
        assert_eq!(wire["threadId"], TASK);
        assert_eq!(wire["epoch"], "rr1-snapshot");
        assert_eq!(wire["journal"], "saved");
        assert_eq!(wire["unreadable"], 0);
        assert_eq!(wire["reset"], false);
        assert_eq!(
            wire["truncated"],
            matches!(name, "olderQuestionsEvicted" | "settledApprovalsLeftOut"),
            "{name}"
        );
        assert_eq!(
            holds_open_request(&read),
            matches!(
                name,
                "livePendingQuestionAndApproval"
                    | "pendingWithoutWaiter"
                    | "olderQuestionsEvicted"
                    | "settledApprovalsLeftOut"
            ),
            "{name}"
        );
        assert!(
            serde_json::from_value::<ThreadRequests>(wire).is_ok(),
            "{name}"
        );
    }
}

#[test]
fn epoch_names_the_source_and_the_lease_only_for_legacy_lists() {
    assert_eq!(epoch(InteractionSource::Snapshot, 1, 0), "rr1-snapshot");
    assert_eq!(epoch(InteractionSource::Snapshot, 2, 0), "rr1-snapshot");
    assert_eq!(epoch(InteractionSource::Legacy, 1, 0), "rr1-legacy-1");
    assert_eq!(
        epoch(InteractionSource::Legacy, u64::MAX, 0),
        format!("rr1-legacy-{}", u64::MAX)
    );
    assert_eq!(SNAPSHOT_EPOCH, "rr1-snapshot");
    assert_eq!(epoch(InteractionSource::Snapshot, 7, 2), "rr1-snapshot-7-2");
    assert_eq!(epoch(InteractionSource::Legacy, 7, 1), "rr1-legacy-7-1");
}

#[test]
fn already_settled_answer_keeps_the_observed_version_and_settlement() {
    let read = observed(
        sequenced(snapshot("answeredAndDecided"), 4),
        InteractionSource::Snapshot,
    );
    let observed_answer = RemoteRespondOutcome::Answered {
        request: RemoteRequestItem::Question(read.questions[0].clone()),
    };
    let wire =
        serde_json::to_value(responded(&read, &observed_answer, false, STARTED).unwrap()).unwrap();
    assert_eq!(wire["version"], 9);
    assert_eq!(wire["resolvedAtEpochMs"], SETTLED);
    let delivered =
        serde_json::to_value(responded(&read, &observed_answer, true, STARTED).unwrap()).unwrap();
    assert_eq!(delivered["version"], 10);
}

#[test]
fn rows_the_model_cannot_represent_fail_closed() {
    let mut read = observed(live(), InteractionSource::Snapshot);
    read.sequence = MAX_SAFE_SEQUENCE;
    assert_eq!(requests(&read, STARTED).err(), Some(RequestError::Integer));
    read.sequence = u64::MAX;
    assert_eq!(requests(&read, STARTED).err(), Some(RequestError::Integer));
    let mut read = observed(live(), InteractionSource::Snapshot);
    read.questions[0].response_capability = None;
    assert_eq!(
        requests(&read, STARTED).err(),
        Some(RequestError::Capability)
    );
    let mut read = observed(snapshot("answeredAndDecided"), InteractionSource::Snapshot);
    read.questions[0].answers = None;
    assert_eq!(
        requests(&read, STARTED).err(),
        Some(RequestError::Resolution)
    );
    let mut read = observed(snapshot("answeredAndDecided"), InteractionSource::Snapshot);
    read.approvals[0].decision = None;
    assert_eq!(
        requests(&read, STARTED).err(),
        Some(RequestError::Resolution)
    );
    let mut read = observed(live(), InteractionSource::Snapshot);
    read.approvals[0].provider = "other".into();
    assert_eq!(requests(&read, STARTED).err(), Some(RequestError::Provider));
    let mut read = observed(live(), InteractionSource::Snapshot);
    read.approvals[0].created_at = Some("yesterday".into());
    assert_eq!(requests(&read, STARTED).err(), Some(RequestError::Integer));
    let mut read = observed(live(), InteractionSource::Snapshot);
    read.approvals[0].id = read.questions[0].id.clone();
    let colliding = requests(&read, STARTED).expect("distinct kinds map");
    let scope = MessageScope {
        server_id: "srv-alpha",
        thread_id: TASK,
        epoch: epoch(InteractionSource::Snapshot, 1, 0),
    };
    assert_eq!(
        message(scope, colliding, false).err(),
        Some(RequestError::DuplicateRequest)
    );
}

const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[test]
fn full_task_fits_one_message() {
    let mut full = live();
    let question = full["questions"][0].clone();
    let approval = full["approvals"][0].clone();
    let numbered = |item: &Value, prefix: char, index: usize| {
        let mut item = item.clone();
        item["id"] = format!("{prefix}0000000-0000-4000-8000-{index:012}").into();
        item
    };
    full["questions"] = (0..MAX_APPROVALS)
        .map(|index| numbered(&question, 'a', index))
        .collect::<Vec<_>>()
        .into();
    full["approvals"] = (0..MAX_APPROVALS)
        .map(|index| numbered(&approval, 'b', index))
        .collect::<Vec<_>>()
        .into();
    let read = observed(full, InteractionSource::Legacy);
    let mapped = requests(&read, STARTED).expect("mapped");
    assert_eq!(mapped.len(), 64);
    let scope = MessageScope {
        server_id: "srv-alpha",
        thread_id: TASK,
        epoch: epoch(InteractionSource::Legacy, 3, 0),
    };
    let message = message(scope, mapped, false).expect("message at the limit");
    assert_eq!(message.parts().epoch, "rr1-legacy-3");
}

fn answered_outcome(read: &RemoteInteractions) -> RemoteRespondOutcome {
    let mut question = read.questions[0].clone();
    question.status = AgentQuestionStatus::Answered;
    question.answers = serde_json::from_value(
        json!([{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]),
    )
    .expect("answers");
    question.response_capability = None;
    RemoteRespondOutcome::Answered {
        request: RemoteRequestItem::Question(question),
    }
}

#[test]
fn confirmed_answer_supersedes_the_live_record_of_the_same_sequence() {
    let read = observed(live(), InteractionSource::Snapshot);
    let record = responded(&read, &answered_outcome(&read), true, STARTED).expect("record");
    let wire = serde_json::to_value(&record).expect("wire");
    assert_eq!(wire["status"], "resolved");
    assert_eq!(wire["version"], 8);
    assert_eq!(wire["order"], 0);
    assert_eq!(wire["createdAtEpochMs"], CREATED);
    assert_eq!(wire["resolvedAtEpochMs"], CREATED);
    assert_eq!(
        wire["resolution"],
        json!({"kind": "answers", "answers": [{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]})
    );
    let mut approval = read.approvals[0].clone();
    approval.status = AgentApprovalStatus::Denied;
    approval.decision = serde_json::from_value(json!("deny")).expect("decision");
    approval.response_capability = None;
    let decided = RemoteRespondOutcome::Answered {
        request: RemoteRequestItem::Approval(approval),
    };
    let wire =
        serde_json::to_value(responded(&read, &decided, true, STARTED).expect("record")).unwrap();
    assert_eq!(wire["version"], 8);
    assert_eq!(wire["order"], 1);
    assert_eq!(
        wire["resolution"],
        json!({"kind": "decision", "decision": "deny"})
    );
}

#[test]
fn refused_and_settled_items_keep_the_observed_version_rule() {
    let read = observed(live(), InteractionSource::Snapshot);
    let refused = RemoteRespondOutcome::NotAnswerable {
        request: RemoteRequestItem::Approval(read.approvals[0].clone().refused()),
    };
    let wire =
        serde_json::to_value(responded(&read, &refused, true, STARTED).expect("record")).unwrap();
    assert_eq!(wire["status"], "submitting");
    assert_eq!(wire["version"], 8);
    assert_eq!(wire["order"], 1);
    assert_eq!(wire["resolution"], Value::Null);
    let settled = observed(
        snapshot("everySettleReasonOnQuestions"),
        InteractionSource::Snapshot,
    );
    let gone = RemoteRespondOutcome::NotAnswerable {
        request: RemoteRequestItem::Question(settled.questions[2].clone()),
    };
    let wire =
        serde_json::to_value(responded(&settled, &gone, true, STARTED).expect("record")).unwrap();
    assert_eq!(wire["status"], "expired");
    assert_eq!(wire["version"], 25);
    assert_eq!(wire["order"], 2);
    assert_eq!(wire["responseCapability"]["reason"], "turnEnded");
    let foreign = observed(retasked(live(), &task(7)), InteractionSource::Snapshot);
    let mut unknown = foreign.questions[0].clone();
    unknown.id = "a0000000-0000-4000-8000-000000000099".into();
    let missing = RemoteRespondOutcome::NotAnswerable {
        request: RemoteRequestItem::Question(unknown),
    };
    assert_eq!(
        responded(&foreign, &missing, true, STARTED).err(),
        Some(RequestError::Identifier)
    );
}

fn runner_read(
    turn_id: &str,
    wire: &[&Value],
    started: u64,
    source: InteractionSource,
) -> RemoteInteractions {
    let version = wire[0]["version"].as_u64().expect("version");
    let mut read = RemoteInteractions {
        task_id: turn_id.into(),
        sequence: (version - 1) / 2,
        questions: Vec::new(),
        questions_truncated: false,
        approvals: Vec::new(),
        approvals_truncated: false,
        source,
        approvals_complete: true,
    };
    for record in wire {
        let item = runner_item(record, started);
        if record["body"]["kind"] == "question" {
            read.questions
                .push(serde_json::from_value(item).expect("runner question"));
            continue;
        }
        read.approvals
            .push(serde_json::from_value(item).expect("runner approval"));
    }
    read
}

fn reproduced(
    wire: &[Value],
    starts: &[(String, u64)],
    source: InteractionSource,
) -> Vec<RuntimeRequest> {
    let mut reproduced = Vec::new();
    for (turn_id, started) in starts {
        let of_turn: Vec<&Value> = wire
            .iter()
            .filter(|record| record["turnId"] == turn_id.as_str())
            .collect();
        if of_turn.is_empty() {
            continue;
        }
        let read = runner_read(turn_id, &of_turn, *started, source);
        reproduced.extend(requests(&read, *started).expect("reproduced requests"));
    }
    reproduced
}

fn named<'a>(section: &'a Value, name: &str) -> &'a Value {
    section["valid"]
        .as_array()
        .expect("valid cases")
        .iter()
        .find(|case| case["name"] == name)
        .expect("named case")
}

#[test]
fn turn_start_cases_of_the_request_contract_are_reproduced_from_runner_rows() {
    let contract: Value = serde_json::from_str(WIRE).expect("request contract");
    let expected: Vec<Value> = [
        "resolvedWithTurnStartAsCreationTime",
        "runnerRestartedWithTurnStartAsCreationTime",
    ]
    .into_iter()
    .map(|name| named(&contract["requests"], name)["value"].clone())
    .collect();
    let started = expected[0]["createdAtEpochMs"].as_u64().expect("created");
    let turn_id = expected[0]["turnId"].as_str().expect("turn").to_string();
    let reproduced = reproduced(
        &expected,
        &[(turn_id, started)],
        InteractionSource::Snapshot,
    );
    assert_eq!(serde_json::to_value(&reproduced).unwrap(), json!(expected));
    assert_eq!(
        expected[1]["responseCapability"]["reason"],
        "runnerRestarted"
    );
    assert_eq!(expected[1]["resolvedAtEpochMs"], started + 60_000);
}

#[test]
fn every_message_of_the_ipc_contract_is_reproduced_from_runner_rows() {
    let contract: Value = serde_json::from_str(IPC).expect("ipc contract");
    let mut reproduced_records = 0;
    for (responses, requests_section) in [
        ("listResponses", "listRequests"),
        ("respondResponses", "respondRequests"),
    ] {
        for case in contract[responses]["valid"]
            .as_array()
            .expect("valid cases")
        {
            let name = case["name"].as_str().expect("name");
            let request = &named(
                &contract[requests_section],
                case["request"].as_str().expect("request"),
            )["value"];
            let expected = &case["value"]["message"];
            if expected.is_null() {
                continue;
            }
            let turns = match request.get("turn") {
                Some(turn) => vec![turn.clone()],
                None => request["turns"].as_array().expect("turns").clone(),
            };
            let starts: Vec<(String, u64)> = turns
                .iter()
                .map(|turn| {
                    (
                        turn["turnId"].as_str().expect("turn id").to_string(),
                        turn["startedAtEpochMs"].as_u64().expect("start"),
                    )
                })
                .collect();
            let expected_epoch = expected["epoch"].as_str().expect("epoch");
            let (source, serial) = match expected_epoch.strip_prefix("rr1-legacy-") {
                Some(serial) => (InteractionSource::Legacy, serial.parse().expect("serial")),
                None => (InteractionSource::Snapshot, 1),
            };
            let wire = expected["requests"].as_array().expect("requests");
            let mapped = reproduced(wire, &starts, source);
            reproduced_records += mapped.len();
            let scope = MessageScope {
                server_id: request["serverId"].as_str().expect("server"),
                thread_id: request["threadId"].as_str().expect("thread"),
                epoch: epoch(source, serial, 0),
            };
            let truncated = expected["truncated"].as_bool().expect("truncated");
            let message = message(scope, mapped, truncated).expect(name);
            assert_eq!(&serde_json::to_value(&message).unwrap(), expected, "{name}");
        }
    }
    assert!(reproduced_records >= 8, "{reproduced_records}");
}

#[test]
fn test_clock_text_round_trips_through_the_runner_timestamp_parser() {
    for epoch_ms in [
        0,
        1,
        CREATED,
        SETTLED,
        1_760_000_164_000,
        253_402_300_799_999,
    ] {
        assert_eq!(epoch_millis(&iso(epoch_ms)), Some(epoch_ms));
    }
    assert_eq!(iso(CREATED), "2026-10-13T09:00:00.000Z");
}
