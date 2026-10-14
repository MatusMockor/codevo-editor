use super::super::interactions_fake::*;
use super::super::interactions_respond::RemoteRequestResponse;
use super::super::thread_requests_support::*;
use super::*;
use serde_json::{json, Value};

const IPC: &str = include_str!("../../../contracts/remote-agent-thread-requests-ipc.json");
const UNAVAILABLE_AFTER_POST: &str = "Runner request failed (HTTP 503).";

fn contract() -> Value {
    serde_json::from_str(IPC).expect("ipc contract is JSON")
}

fn valid<'a>(contract: &'a Value, section: &str, name: &str) -> &'a Value {
    contract[section]["valid"]
        .as_array()
        .expect("valid cases")
        .iter()
        .find(|case| case["name"] == name)
        .expect("named case")
}

fn pending(record: &Value) -> Value {
    let mut record = record.clone();
    record["status"] = "pending".into();
    record["responseCapability"] = json!({"kind": "live"});
    record["resolution"] = Value::Null;
    record["resolvedAtEpochMs"] = Value::Null;
    record
}

fn runner_snapshot(records: &[Value], request: &ThreadRespondRequest, sequence: u64) -> Value {
    let started = request.turn.started_at_epoch_ms;
    let of_kind = |kind: &str| -> Vec<Value> {
        records
            .iter()
            .filter(|record| record["body"]["kind"] == kind)
            .map(|record| runner_item(record, started))
            .collect()
    };
    json!({
        "taskId": request.turn.turn_id,
        "sequence": sequence,
        "questions": of_kind("question"),
        "questionsTruncated": false,
        "approvals": of_kind("approval"),
        "approvalsTruncated": false,
    })
}

fn runner_of(request: &ThreadRespondRequest, replies: Vec<Reply>) -> FakeRunner {
    FakeRunner {
        runner: request.runner_id.clone(),
        ..FakeRunner::replying(replies)
    }
}

fn message_records(expected: &Value) -> Vec<Value> {
    expected["message"]["requests"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn answered_runner(expected: &Value, request: &ThreadRespondRequest) -> FakeRunner {
    let records = message_records(expected);
    let target = records
        .iter()
        .find(|record| record["id"] == request.request_id.as_str())
        .expect("answered record");
    let sequence = (target["version"].as_u64().expect("version") - 1) / 2;
    runner_of(
        request,
        vec![Ok(runner_snapshot(&records, request, sequence))],
    )
}

fn refused_runner(expected: &Value, request: &ThreadRespondRequest) -> FakeRunner {
    let records: Vec<Value> = message_records(expected).iter().map(pending).collect();
    let sequence = (records[0]["version"].as_u64().expect("version") - 1) / 2;
    let snapshot = runner_snapshot(&records, request, sequence);
    runner_of(
        request,
        vec![Ok(snapshot.clone()), conflict(), Ok(snapshot)],
    )
}

fn uncertain_runner(contract: &Value, request: &ThreadRespondRequest) -> FakeRunner {
    let answered = &valid(contract, "respondResponses", "answeredQuestion")["value"];
    let records: Vec<Value> = message_records(answered).iter().map(pending).collect();
    runner_of(
        request,
        vec![
            Ok(runner_snapshot(&records, request, 3)),
            Err(UNAVAILABLE_AFTER_POST.into()),
        ],
    )
}

fn gone_runner(request: &ThreadRespondRequest) -> FakeRunner {
    runner_of(request, vec![Ok(runner_snapshot(&[], request, 0))])
}

fn without_requests(message: &Value) -> Value {
    let mut message = message.clone();
    message.as_object_mut().expect("message").remove("requests");
    message
}

#[test]
fn every_valid_respond_case_of_the_contract_is_produced_by_the_respond_orchestration() {
    let contract = contract();
    let cases = contract["respondResponses"]["valid"]
        .as_array()
        .expect("valid cases")
        .clone();
    assert_eq!(cases.len(), 6);
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let request_case = valid(
            &contract,
            "respondRequests",
            case["request"].as_str().expect("request"),
        );
        let request: ThreadRespondRequest =
            serde_json::from_value(request_case["value"].clone()).expect(name);
        let expected = &case["value"];
        let setup = match name {
            "answeredQuestion" | "answeredApproval" => {
                Some((answered_runner(expected, &request), 0))
            }
            "notAnswerableWithRefusedRecord" => Some((refused_runner(expected, &request), 1)),
            "notAnswerableWithoutMessage" => Some((gone_runner(&request), 0)),
            "deliveryUncertainWithoutMessage" => Some((uncertain_runner(&contract, &request), 1)),
            "answeredWhileEpochMoved" => {
                let answered = &valid(&contract, "respondResponses", "answeredApproval")["value"];
                Some((answered_runner(answered, &request), 0))
            }
            _ => None,
        };
        assert!(setup.is_some(), "unexpected contract case {name}");
        let (runner, posts_expected) = setup.expect("known contract case");
        let attempt = attempt(&runner, &request, Instant::now());
        if name == "answeredWhileEpochMoved" {
            runner.ledger.requests().request_bump();
            runner.ledger.requests().rebuild(runner.clock());
        }
        let result = wire(&settle_response(&runner, &request, attempt, far()).expect(name));
        assert_eq!(result["outcome"], expected["outcome"], "{name}");
        assert_eq!(
            runner
                .calls()
                .iter()
                .filter(|(method, _, _)| method == "POST")
                .count(),
            posts_expected,
            "{name}"
        );
        if expected["message"].is_null() {
            assert_eq!(&result, expected, "{name}");
            continue;
        }
        assert_eq!(
            without_requests(&result["message"]),
            without_requests(&expected["message"]),
            "{name}"
        );
        let produced = result["message"]["requests"].as_array().expect("requests");
        assert_eq!(produced.len(), 1, "{name}");
        let target = message_records(expected)
            .into_iter()
            .find(|record| record["id"] == request.request_id.as_str())
            .expect("targeted record");
        assert_eq!(produced[0], target, "{name}");
    }
}

#[test]
fn identical_answer_to_a_settled_request_is_reported_as_observed_without_posting() {
    let mut answers = snapshot("answeredAndDecided")["questions"][0]["answers"].clone();
    let same: RemoteRequestResponse =
        serde_json::from_value(json!({"kind": "question", "answers": answers.clone()})).unwrap();
    let runner = FakeRunner::replying(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    let result = respond(&runner, QUESTION, same).unwrap();
    let record = wire(&result)["message"]["requests"][0].clone();
    assert_eq!(wire(&result)["outcome"], "answered");
    assert_eq!(record["version"], 9);
    assert_eq!(record["resolvedAtEpochMs"], 1_791_882_300_000_u64);
    assert_eq!(runner.calls().len(), 1);
    answers[0]["text"] = "Something else.".into();
    let different: RemoteRequestResponse =
        serde_json::from_value(json!({"kind": "question", "answers": answers})).unwrap();
    let runner = FakeRunner::replying(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    let result = respond(&runner, QUESTION, different).unwrap();
    assert_eq!(wire(&result)["outcome"], "notAnswerable");
    assert_eq!(wire(&result)["message"]["requests"][0]["version"], 9);
    assert_eq!(runner.calls().len(), 1);
    let decided = FakeRunner::replying(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    let result = respond(&decided, APPROVAL, decide("allowOnce")).unwrap();
    assert_eq!(wire(&result)["outcome"], "answered");
    assert_eq!(wire(&result)["message"]["requests"][0]["version"], 9);
    let other = FakeRunner::replying(vec![Ok(sequenced(snapshot("answeredAndDecided"), 4))]);
    let result = respond(&other, APPROVAL, decide("deny")).unwrap();
    assert_eq!(wire(&result)["outcome"], "notAnswerable");
    for runner in [&decided, &other] {
        assert_eq!(runner.calls().len(), 1);
    }
}
