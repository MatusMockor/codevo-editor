use super::super::canonical_wire::Canonical;
use super::*;
use serde::de::DeserializeOwned;
use serde_json::json;
use std::collections::BTreeSet;

const CONTRACT: &str = include_str!("../../../contracts/remote-git-sync-wire.json");

fn contract() -> Value {
    serde_json::from_str(CONTRACT).expect("git sync wire contract is JSON")
}

fn body<T: DeserializeOwned + Serialize>(
    value: Value,
    validate: fn(&T) -> Result<(), String>,
) -> Result<(), String> {
    let parsed: T = canonical(value).ok_or("not canonical")?;
    validate(&parsed)
}

fn response<T: Serialize>(
    value: Value,
    parse: impl Fn(Value) -> Result<T, String>,
) -> Result<(), String> {
    let parsed = parse(value.clone())?;
    let echoed = serde_json::to_value(parsed).map_err(|error| error.to_string())?;
    assert_eq!(
        echoed, value,
        "validated response must round-trip unchanged"
    );
    Ok(())
}

fn editor_request(value: Value) -> Result<(), String> {
    let request: Canonical<RemoteGitRequest> =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    request.0.validate()
}

fn check_section(section: &str, value: Value) -> Result<(), String> {
    match section {
        "startBody" => body(value, StartBody::validate),
        "fetchOrUpdateBody" => body(value, IdempotentBody::validate),
        "commitBody" => body(value, CommitBody::validate),
        "pushBody" => body(value, PushBody::validate),
        "branchList" => response(value, |v| {
            parse_branch_list(v).map(RemoteGitResponse::Branches)
        }),
        "checkoutStatus" => response(value, |v| {
            parse_checkout_status(v).map(RemoteGitResponse::CheckoutStatus)
        }),
        "threadGitStatus" => response(value, |v| {
            parse_thread_status(v).map(RemoteGitResponse::ThreadStatus)
        }),
        "commitResult" => response(value, |v| {
            parse_commit_result(v).map(RemoteGitResponse::Commit)
        }),
        "gitOperation" => response(value, |v| {
            parse_operation(v).map(RemoteGitResponse::Operation)
        }),
        "errorBody" => response(value, parse_error_body),
        "editorGitRequest" => editor_request(value),
        other => panic!("unmapped git sync wire section {other}"),
    }
}

fn cases<'a>(section: &'a Value, verdict: &str) -> &'a Vec<Value> {
    let cases = section[verdict].as_array().expect("fixture cases");
    assert!(!cases.is_empty(), "fixture section without {verdict} cases");
    cases
}

#[test]
fn contract_pins_schema_capability_and_error_codes() {
    let contract = contract();
    assert_eq!(contract["schemaVersion"], 1);
    assert_eq!(contract["capability"], "gitSync");
    let codes = contract["errorCodes"].as_array().expect("error codes");
    assert_eq!(codes.len(), 17);
    for code in codes {
        let parsed: GitErrorCode = serde_json::from_value(code.clone()).expect("known code");
        assert_eq!(&serde_json::to_value(parsed).unwrap(), code);
    }
    assert!(serde_json::from_value::<GitErrorCode>(json!("invalid_input")).is_err());
}

#[test]
fn contract_sections_are_exactly_the_mapped_wire_shapes() {
    let contract = contract();
    let sections: BTreeSet<&str> = contract["sections"]
        .as_object()
        .expect("sections")
        .keys()
        .map(String::as_str)
        .collect();
    let expected: BTreeSet<&str> = [
        "startBody",
        "fetchOrUpdateBody",
        "commitBody",
        "pushBody",
        "branchList",
        "checkoutStatus",
        "threadGitStatus",
        "commitResult",
        "gitOperation",
        "errorBody",
        "editorGitRequest",
    ]
    .into_iter()
    .collect();
    assert_eq!(sections, expected);
}

#[test]
fn contract_accepts_every_accepted_case() {
    let contract = contract();
    for (section, cases_value) in contract["sections"].as_object().unwrap() {
        for case in cases(cases_value, "accepted") {
            let result = check_section(section, case["value"].clone());
            assert!(
                result.is_ok(),
                "{section}/{} rejected: {result:?}",
                case["name"]
            );
        }
    }
}

#[test]
fn contract_rejects_every_rejected_case() {
    let contract = contract();
    for (section, cases_value) in contract["sections"].as_object().unwrap() {
        for case in cases(cases_value, "rejected") {
            assert!(
                check_section(section, case["value"].clone()).is_err(),
                "{section}/{} accepted",
                case["name"]
            );
        }
    }
}

#[test]
fn branch_list_is_bounded_at_the_runner_limit() {
    let list = |count: usize| {
        json!({
            "defaultBranch": "main", "checkoutBranch": null, "fetchedAt": null,
            "branches": (0..count).map(|index| json!({
                "name": format!("feature/{index}"),
                "sha": "3f786850e387550fdab836ed7e6dc881de23001b",
                "committedAt": "2026-10-02T09:15:00Z"
            })).collect::<Vec<_>>(),
            "truncated": true
        })
    };
    assert!(parse_branch_list(list(MAX_BRANCHES)).is_ok());
    assert!(parse_branch_list(list(MAX_BRANCHES + 1)).is_err());
}

#[test]
fn start_body_serialises_base_only_when_present() {
    let without = StartBody {
        project_id: "storefront".into(),
        base: None,
    };
    assert_eq!(
        serde_json::to_value(&without).unwrap(),
        json!({"projectId": "storefront"})
    );
    let with = StartBody {
        project_id: "storefront".into(),
        base: Some(StartBase::OriginBranch {
            branch: "main".into(),
        }),
    };
    assert_eq!(
        serde_json::to_value(&with).unwrap(),
        json!({"projectId": "storefront", "base": {"kind": "origin-branch", "branch": "main"}})
    );
}

#[test]
fn timestamps_follow_the_strict_iso_grammar() {
    for valid in [
        "2026-10-02T09:15:00Z",
        "2026-10-02T09:15:00.000Z",
        "2026-10-02T09:15:00.123456789+02:00",
        "2026-10-02T23:59:59-05:30",
    ] {
        assert!(timestamp(valid), "{valid}");
    }
    for invalid in [
        "2026-10-02",
        "2026-13-02T09:15:00Z",
        "2026-10-02T24:00:00Z",
        "2026-10-02T09:15:00",
        "2026-10-02T09:15:00.Z",
        "2026-10-02T09:15:00.1234567890Z",
        "2026-10-02 09:15:00Z",
        "2026-10-02T09:15:00+0200",
    ] {
        assert!(!timestamp(invalid), "{invalid}");
    }
}

#[test]
fn stub_command_validates_then_reports_unavailable() {
    let request: RemoteGitRequest = serde_json::from_value(json!({
        "operation": "projectStatus", "serverId": "linux", "runnerId": "linux-runner",
        "projectId": "storefront"
    }))
    .unwrap();
    assert_eq!(
        super::super::git_sync::unavailable(&request).unwrap_err(),
        GIT_SYNC_UNAVAILABLE
    );
    let invalid: RemoteGitRequest = serde_json::from_value(json!({
        "operation": "projectStatus", "serverId": "linux runner", "runnerId": "linux-runner",
        "projectId": "storefront"
    }))
    .unwrap();
    assert_ne!(
        super::super::git_sync::unavailable(&invalid).unwrap_err(),
        GIT_SYNC_UNAVAILABLE
    );
}

#[test]
fn push_target_is_a_closed_enum() {
    for (wire, target) in [
        ("thread-branch", PushTarget::ThreadBranch),
        ("base-branch", PushTarget::BaseBranch),
    ] {
        let request: RemoteGitRequest = serde_json::from_value(json!({
            "operation": "threadPush", "serverId": "linux", "runnerId": "linux-runner",
            "taskId": "7389088c-29b8-4cec-9a15-e825e1fb2f66",
            "idempotencyKey": "0b9d6f3e-6a51-4c1f-8d2e-7f1a2b3c4d5e", "target": wire
        }))
        .unwrap();
        let RemoteGitRequest::ThreadPush(push) = request else {
            panic!("threadPush must parse as ThreadPush");
        };
        assert_eq!(push.target, target);
    }
}
