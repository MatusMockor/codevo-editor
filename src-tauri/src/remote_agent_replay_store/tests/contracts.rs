use super::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

const LOAD_FIXTURE: &str = r#"{"key":{"serverId":"server","endpoint":"[\"server\",\"host\",\"user\",22]","runnerId":"runner","threadKey":"thread"}}"#;
const PUT_FIXTURE: &str = r#"{"key":{"serverId":"server","endpoint":"[\"server\",\"host\",\"user\",22]","runnerId":"runner","threadKey":"thread"},"taskId":"task","record":"{}"}"#;
const REMOVE_THREAD_FIXTURE: &str = r#"{"key":{"serverId":"server","endpoint":"[\"server\",\"host\",\"user\",22]","runnerId":"runner","threadKey":"thread"}}"#;
const REMOVE_SERVER_FIXTURE: &str = r#"{"serverId":"server"}"#;
const CLEAR_FIXTURE: &str = "{}";
const HIT_FIXTURE: &str = r#"{"kind":"hit","records":[{"taskId":"task","record":"{}"}]}"#;
const MISS_FIXTURE: &str = r#"{"kind":"miss"}"#;
const STORED_FIXTURE: &str = r#"{"kind":"stored"}"#;
const UNAVAILABLE_FIXTURE: &str = r#"{"kind":"unavailable"}"#;
const REMOVED_FIXTURE: &str = r#"{"kind":"removed"}"#;
const REJECTED_FIXTURES: [&str; 5] = [
    r#"{"kind":"rejected","reason":"invalidIdentifier"}"#,
    r#"{"kind":"rejected","reason":"recordTooLarge"}"#,
    r#"{"kind":"rejected","reason":"invalidRecord"}"#,
    r#"{"kind":"rejected","reason":"threadTooLarge"}"#,
    r#"{"kind":"rejected","reason":"tooManyTasks"}"#,
];

fn pins_fixture<T: DeserializeOwned + Serialize + std::fmt::Debug + PartialEq>(
    fixture: &str,
    expected: T,
) {
    let parsed: T = serde_json::from_str(fixture).expect("parse wire fixture");
    assert_eq!(parsed, expected);
    assert_eq!(
        serde_json::to_string(&parsed).expect("encode wire fixture"),
        fixture
    );
}

#[test]
fn literal_request_fixtures_pin_typescript_rust_contract() {
    pins_fixture(LOAD_FIXTURE, LoadThreadRequest { key: key("thread") });
    pins_fixture(
        REMOVE_THREAD_FIXTURE,
        RemoveThreadRequest { key: key("thread") },
    );
    let request = PutTaskRequest {
        key: key("thread"),
        task_id: "task".into(),
        record: "{}".into(),
    };
    assert_eq!(validate_put_request(&request), Ok(()));
    pins_fixture(PUT_FIXTURE, request);
    pins_fixture(
        REMOVE_SERVER_FIXTURE,
        RemoveServerRequest {
            server_id: "server".into(),
        },
    );
    pins_fixture(CLEAR_FIXTURE, ClearRequest {});
}

#[test]
fn literal_response_fixtures_pin_typescript_rust_contract() {
    pins_fixture(
        HIT_FIXTURE,
        LoadThreadResponse::Hit {
            records: vec![TaskRecord {
                task_id: "task".into(),
                record: "{}".into(),
            }],
        },
    );
    pins_fixture(MISS_FIXTURE, LoadThreadResponse::Miss {});
    pins_fixture(STORED_FIXTURE, PutTaskResponse::Stored {});
    pins_fixture(UNAVAILABLE_FIXTURE, PutTaskResponse::Unavailable {});
    pins_fixture(UNAVAILABLE_FIXTURE, RemoveResponse::Unavailable {});
    pins_fixture(REMOVED_FIXTURE, RemoveResponse::Removed {});
    for (fixture, reason) in REJECTED_FIXTURES.into_iter().zip([
        RejectionReason::InvalidIdentifier,
        RejectionReason::RecordTooLarge,
        RejectionReason::InvalidRecord,
        RejectionReason::ThreadTooLarge,
        RejectionReason::TooManyTasks,
    ]) {
        pins_fixture(fixture, PutTaskResponse::Rejected { reason });
    }
}

fn rejects_unknown<T: DeserializeOwned>(mut value: Value) {
    value
        .as_object_mut()
        .expect("object fixture")
        .insert("unexpected".into(), json!(1));
    assert!(serde_json::from_value::<T>(value).is_err());
}

#[test]
fn every_wire_request_rejects_unknown_fields_including_nested_keys() {
    rejects_unknown::<PutTaskRequest>(serde_json::from_str(PUT_FIXTURE).expect("put fixture"));
    rejects_unknown::<LoadThreadRequest>(json!({"key":key("thread")}));
    rejects_unknown::<RemoveThreadRequest>(json!({"key":key("thread")}));
    rejects_unknown::<RemoveServerRequest>(json!({"serverId":"server"}));
    rejects_unknown::<ClearRequest>(json!({}));
    rejects_unknown::<RemoteReplayCacheKey>(json!(key("thread")));
    let mut nested: Value = serde_json::from_str(PUT_FIXTURE).expect("put fixture");
    nested["key"]["unexpected"] = json!(1);
    assert!(serde_json::from_value::<PutTaskRequest>(nested).is_err());
    assert!(serde_json::from_value::<ClearRequest>(json!({"workspacePath":"/tmp"})).is_err());
}

#[test]
fn responses_are_closed_and_reject_unknown_fields() {
    rejects_unknown::<LoadThreadResponse>(json!({"kind":"miss"}));
    rejects_unknown::<PutTaskResponse>(json!({"kind":"stored"}));
    rejects_unknown::<RemoveResponse>(json!({"kind":"removed"}));
    rejects_unknown::<TaskRecord>(json!({"taskId":"task","record":"{}"}));
    assert!(serde_json::from_value::<LoadThreadResponse>(json!({"kind":"unknown"})).is_err());
    assert!(serde_json::from_value::<PutTaskResponse>(
        json!({"kind":"rejected","reason":"unknown"})
    )
    .is_err());
}
