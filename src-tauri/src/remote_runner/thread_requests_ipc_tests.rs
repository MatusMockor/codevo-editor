use super::*;
use crate::agent_runtime_requests::model::{MAX_REQUESTS_PER_MESSAGE, MAX_REQUEST_ID_BYTES};
use serde_json::{json, Value};

const IPC: &str = include_str!("../../../contracts/remote-agent-thread-requests-ipc.json");

fn contract() -> Value {
    serde_json::from_str(IPC).expect("ipc contract is JSON")
}

fn valid(section: &str) -> Vec<(String, Value, Option<String>)> {
    contract()[section]["valid"]
        .as_array()
        .expect("valid cases")
        .iter()
        .map(|case| {
            (
                case["name"].as_str().expect("case name").to_string(),
                case["value"].clone(),
                case["request"].as_str().map(str::to_string),
            )
        })
        .collect()
}

fn valid_value(section: &str, name: &str) -> Value {
    valid(section)
        .into_iter()
        .find(|(candidate, _, _)| candidate == name)
        .map(|(_, value, _)| value)
        .expect("named valid case")
}

fn answered_request(section: &str, name: &str) -> String {
    valid(section)
        .into_iter()
        .find(|(candidate, _, _)| candidate == name)
        .and_then(|(_, _, request)| request)
        .expect("valid response names its request")
}

fn invalid(section: &str) -> Vec<(String, String, Value)> {
    contract()[section]["invalid"]
        .as_array()
        .expect("invalid cases")
        .iter()
        .map(|case| {
            let base = case["base"].as_str().expect("base").to_string();
            let mut value = valid_value(section, &base);
            let fields = value.as_object_mut().expect("record case");
            for (key, replacement) in case["patch"].as_object().into_iter().flatten() {
                fields.insert(key.clone(), replacement.clone());
            }
            for key in case["omit"].as_array().into_iter().flatten() {
                fields.remove(key.as_str().expect("omitted key"));
            }
            (
                case["name"].as_str().expect("case name").to_string(),
                base,
                value,
            )
        })
        .collect()
}

fn query(name: &str) -> ThreadRequestsQuery {
    serde_json::from_value(valid_value("listRequests", name)).expect("valid list request")
}

fn respond(name: &str) -> ThreadRespondRequest {
    serde_json::from_value(valid_value("respondRequests", name)).expect("valid respond request")
}

fn bound_message(value: &Value, server_id: &str, thread_id: &str) -> Option<ThreadRequests> {
    let message: ThreadRequests = serde_json::from_value(value.clone()).ok()?;
    let parts = message.parts();
    let bound = parts.workspace_id.as_deref() == Some(server_id) && parts.thread_id == thread_id;
    bound.then_some(message)
}

fn nullable_cursor(value: &Value) -> Option<Option<String>> {
    match value {
        Value::Null => Some(None),
        Value::String(cursor) if is_cursor(cursor) => Some(Some(cursor.clone())),
        _ => None,
    }
}

fn page(value: &Value, request: &ThreadRequestsQuery) -> Option<ThreadRequestsPage> {
    let fields = value.as_object().filter(|fields| fields.len() == 2)?;
    Some(ThreadRequestsPage {
        message: bound_message(
            fields.get("message")?,
            &request.server_id,
            &request.thread_id,
        )?,
        next_cursor: nullable_cursor(fields.get("nextCursor")?)?,
    })
}

fn respond_result(value: &Value, request: &ThreadRespondRequest) -> Option<ThreadRespondResult> {
    let fields = value.as_object().filter(|fields| fields.len() == 2)?;
    let message = match fields.get("message")? {
        Value::Null => None,
        message => Some(bound_message(
            message,
            &request.server_id,
            &request.thread_id,
        )?),
    };
    match (fields.get("outcome")?.as_str()?, message) {
        ("answered", message) => Some(ThreadRespondResult::answered(message)),
        ("notAnswerable", message) => Some(ThreadRespondResult::not_answerable(message)),
        ("deliveryUncertain", None) => Some(ThreadRespondResult::delivery_uncertain()),
        _ => None,
    }
}

#[test]
fn contract_names_the_commands_bounds_and_closed_sets_this_side_implements() {
    let contract = contract();
    assert_eq!(contract["schemaVersion"], 1);
    assert_eq!(
        contract["commands"],
        json!({
            "list": "get_remote_agent_thread_requests",
            "respond": "respond_remote_agent_thread_request",
        })
    );
    assert_eq!(
        contract["limits"],
        json!({
            "serverIdBytes": 64,
            "runnerIdBytes": MAX_RUNNER_ID_BYTES,
            "idBytes": MAX_REQUEST_ID_BYTES,
            "turnsPerRequest": MAX_TURNS,
            "cursorChars": MAX_CURSOR_CHARS,
            "answersPerResponse": MAX_AGENT_QUESTIONS_PER_REQUEST,
            "optionIdsPerAnswer": MAX_AGENT_QUESTION_OPTIONS,
            "answerTextBytes": MAX_AGENT_QUESTION_ANSWER_TEXT_BYTES,
            "requestsPerMessage": MAX_REQUESTS_PER_MESSAGE,
        })
    );
    let outcomes: Vec<Value> = [
        ThreadRespondOutcome::Answered,
        ThreadRespondOutcome::NotAnswerable,
        ThreadRespondOutcome::DeliveryUncertain,
    ]
    .iter()
    .map(|outcome| serde_json::to_value(outcome).expect("outcome"))
    .collect();
    assert_eq!(contract["outcomes"], json!(outcomes));
    assert_eq!(contract["responseKinds"], json!(["question", "approval"]));
    for decision in contract["decisions"].as_array().expect("decisions") {
        let response = json!({"kind": "approval", "decision": decision});
        assert!(serde_json::from_value::<RemoteRequestResponse>(response).is_ok());
    }
    assert_eq!(contract["decisions"].as_array().map(Vec::len), Some(3));
}

#[test]
fn every_valid_list_request_is_admitted_as_written() {
    let cases = valid("listRequests");
    assert!(cases.len() >= 8, "{}", cases.len());
    for (name, value, _) in cases {
        let parsed = serde_json::from_value::<ThreadRequestsQuery>(value.clone());
        assert!(parsed.is_ok(), "{name}: {:?}", parsed.err());
        let parsed = parsed.unwrap();
        assert_eq!(parsed.server_id, value["serverId"], "{name}");
        assert_eq!(parsed.runner_id, value["runnerId"], "{name}");
        assert_eq!(parsed.thread_id, value["threadId"], "{name}");
        assert_eq!(json!(parsed.cursor), value["cursor"], "{name}");
        let turns = value["turns"].as_array().expect("turns");
        assert_eq!(parsed.turns.len(), turns.len(), "{name}");
        for (turn, expected) in parsed.turns.iter().zip(turns) {
            assert_eq!(turn.turn_id, expected["turnId"], "{name}");
            assert_eq!(
                turn.started_at_epoch_ms, expected["startedAtEpochMs"],
                "{name}"
            );
            assert_eq!(
                json!(turn.interaction_sequence),
                expected["interactionSequence"]
            );
            assert_eq!(turn.terminal, expected["terminal"], "{name}");
        }
    }
    assert!(query("noTurns").turns.is_empty());
    assert_eq!(query("maximumTurns").turns.len(), MAX_TURNS);
    assert_eq!(
        query("longestCursor").cursor.map(|cursor| cursor.len()),
        Some(MAX_CURSOR_CHARS)
    );
    assert_eq!(query("sequenceZero").turns[0].interaction_sequence, Some(0));
    assert_eq!(
        query("turnsWithAndWithoutSequence").turns[0].interaction_sequence,
        None
    );
}

#[test]
fn every_invalid_list_request_is_rejected() {
    let cases = invalid("listRequests");
    assert!(cases.len() >= 30, "{}", cases.len());
    let admitted: Vec<String> = cases
        .into_iter()
        .filter(|(_, _, value)| {
            serde_json::from_value::<ThreadRequestsQuery>(value.clone()).is_ok()
        })
        .map(|(name, _, _)| name)
        .collect();
    assert_eq!(admitted, Vec::<String>::new());
}

#[test]
fn every_valid_respond_request_is_admitted_as_written() {
    let cases = valid("respondRequests");
    assert!(cases.len() >= 5, "{}", cases.len());
    for (name, value, _) in cases {
        let parsed = serde_json::from_value::<ThreadRespondRequest>(value.clone());
        assert!(parsed.is_ok(), "{name}: {:?}", parsed.err());
        let parsed = parsed.unwrap();
        assert_eq!(parsed.server_id, value["serverId"], "{name}");
        assert_eq!(parsed.runner_id, value["runnerId"], "{name}");
        assert_eq!(parsed.thread_id, value["threadId"], "{name}");
        assert_eq!(parsed.request_id, value["requestId"], "{name}");
        assert_eq!(parsed.turn.turn_id, value["turn"]["turnId"], "{name}");
        assert_eq!(
            parsed.turn.started_at_epoch_ms, value["turn"]["startedAtEpochMs"],
            "{name}"
        );
        assert_eq!(
            serde_json::to_value(&parsed.response).expect("response"),
            value["response"],
            "{name}"
        );
    }
}

#[test]
fn every_invalid_respond_request_is_rejected() {
    let cases = invalid("respondRequests");
    assert!(cases.len() >= 28, "{}", cases.len());
    let admitted: Vec<String> = cases
        .into_iter()
        .filter(|(_, _, value)| {
            serde_json::from_value::<ThreadRespondRequest>(value.clone()).is_ok()
        })
        .map(|(name, _, _)| name)
        .collect();
    assert_eq!(admitted, Vec::<String>::new());
}

#[test]
fn every_valid_list_response_is_what_this_side_serializes() {
    let cases = valid("listResponses");
    assert!(cases.len() >= 5, "{}", cases.len());
    for (name, value, request) in cases {
        let request = query(&request.expect("answered request"));
        let parsed = page(&value, &request);
        assert!(parsed.is_some(), "{name}");
        assert_eq!(
            serde_json::to_value(parsed.unwrap()).unwrap(),
            value,
            "{name}"
        );
    }
}

#[test]
fn every_invalid_list_response_is_rejected() {
    let cases = invalid("listResponses");
    assert!(cases.len() >= 12, "{}", cases.len());
    let admitted: Vec<String> = cases
        .into_iter()
        .filter(|(_, base, value)| {
            let request = query(&answered_request("listResponses", base));
            page(value, &request).is_some()
        })
        .map(|(name, _, _)| name)
        .collect();
    assert_eq!(admitted, Vec::<String>::new());
}

#[test]
fn every_valid_respond_response_is_what_this_side_serializes() {
    let cases = valid("respondResponses");
    assert!(cases.len() >= 6, "{}", cases.len());
    for (name, value, request) in cases {
        let request = respond(&request.expect("answered request"));
        let parsed = respond_result(&value, &request);
        assert!(parsed.is_some(), "{name}");
        let parsed = parsed.unwrap();
        assert_eq!(json!(parsed.outcome()), value["outcome"], "{name}");
        assert_eq!(parsed.message().is_some(), !value["message"].is_null());
        assert_eq!(serde_json::to_value(parsed).unwrap(), value, "{name}");
    }
}

#[test]
fn every_invalid_respond_response_is_rejected() {
    let cases = invalid("respondResponses");
    assert!(cases.len() >= 9, "{}", cases.len());
    let admitted: Vec<String> = cases
        .into_iter()
        .filter(|(_, base, value)| {
            let request = respond(&answered_request("respondResponses", base));
            respond_result(value, &request).is_some()
        })
        .map(|(name, _, _)| name)
        .collect();
    assert_eq!(admitted, Vec::<String>::new());
}

#[test]
fn rejections_name_the_broken_part_without_echoing_the_input() {
    let error = |patch: Value| {
        let mut value = valid_value("listRequests", "singleRunningTurn");
        for (key, replacement) in patch.as_object().expect("patch") {
            value[key] = replacement.clone();
        }
        serde_json::from_value::<ThreadRequestsQuery>(value)
            .expect_err("rejected")
            .to_string()
    };
    assert_eq!(
        error(json!({"serverId": "../etc/passwd"})),
        "Invalid remote thread request server."
    );
    assert_eq!(
        error(json!({"runnerId": "runner\u{7}"})),
        "Invalid remote thread request runner."
    );
    assert_eq!(
        error(json!({"threadId": "http://127.0.0.1:9229/token"})),
        "Invalid remote thread request thread."
    );
    assert_eq!(
        error(json!({"cursor": "/tmp/cursor"})),
        "Invalid remote thread request cursor."
    );
    let turns = error(json!({"turns": vec![json!({
        "turnId": "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918",
        "startedAtEpochMs": 1,
        "interactionSequence": null,
        "terminal": false,
    }); 2]}));
    assert_eq!(turns, "Invalid remote thread request turn list.");
    let turn = error(json!({"turns": [{
        "turnId": "/v1/tasks/secret",
        "startedAtEpochMs": 1,
        "interactionSequence": null,
        "terminal": false,
    }]}));
    assert_eq!(turn, "Invalid remote thread request turn.");
    let mut respond = valid_value("respondRequests", "approvalDenied");
    respond["requestId"] = "../secret".into();
    assert_eq!(
        serde_json::from_value::<ThreadRespondRequest>(respond)
            .expect_err("rejected")
            .to_string(),
        "Invalid remote thread request request id."
    );
    let mut respond = valid_value("respondRequests", "questionAnswer");
    respond["response"] = json!({"kind": "question", "answers": []});
    assert_eq!(
        serde_json::from_value::<ThreadRespondRequest>(respond)
            .expect_err("rejected")
            .to_string(),
        "Invalid remote thread request response."
    );
}
