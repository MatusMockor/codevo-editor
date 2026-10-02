use super::super::canonical_wire::{canonical, Canonical};
use super::wire::*;
use super::{unavailable, PORT_PREVIEW_UNAVAILABLE};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const CONTRACT: &str = include_str!("../../../../contracts/remote-port-preview-wire.json");

fn contract() -> Value {
    serde_json::from_str(CONTRACT).expect("port preview wire contract is JSON")
}

fn request<T: DeserializeOwned + Serialize>(
    value: Value,
    validate: fn(&T) -> Result<(), String>,
) -> Result<(), String> {
    let parsed: Canonical<T> = serde_json::from_value(value).map_err(|error| error.to_string())?;
    validate(&parsed.0)
}

fn response<T: DeserializeOwned + Serialize>(
    value: Value,
    valid: fn(&T) -> bool,
) -> Result<(), String> {
    let parsed: T = canonical(value.clone()).ok_or("not canonical")?;
    if !valid(&parsed) {
        return Err("invalid".into());
    }
    assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
    Ok(())
}

fn check_section(section: &str, value: Value) -> Result<(), String> {
    match section {
        "portList" => parse_port_list(value.clone()).map(|list| {
            assert_eq!(serde_json::to_value(list).unwrap(), value);
        }),
        "portScope" => request(value, PortScope::validate),
        "portListRequest" => request(value, PortListRequest::validate),
        "portOpenRequest" => request(value, PortOpenRequest::validate),
        "portCloseRequest" => request(value, PortCloseRequest::validate),
        "portReleaseOwnerRequest" => request(value, PortReleaseOwnerRequest::validate),
        "portListing" => response(value, PortListing::valid),
        "portOpenResponse" => response(value, PortOpenResponse::valid),
        other => panic!("unmapped port preview wire section {other}"),
    }
}

fn cases<'a>(section: &'a Value, verdict: &str) -> &'a Vec<Value> {
    let cases = section[verdict].as_array().expect("fixture cases");
    assert!(!cases.is_empty(), "fixture section without {verdict} cases");
    cases
}

#[test]
fn contract_pins_schema_and_sections() {
    let contract = contract();
    assert_eq!(contract["schemaVersion"], 1);
    assert_eq!(contract["capability"], "portPreview");
    let sections: BTreeSet<&str> = contract["sections"]
        .as_object()
        .expect("sections")
        .keys()
        .map(String::as_str)
        .collect();
    let expected: BTreeSet<&str> = [
        "portList",
        "portScope",
        "portListRequest",
        "portOpenRequest",
        "portCloseRequest",
        "portReleaseOwnerRequest",
        "portListing",
        "portOpenResponse",
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
fn stubs_validate_then_report_unavailable() {
    let open: PortOpenRequest = serde_json::from_value(json!({
        "serverId": "linux", "runnerId": "linux-runner", "ownerId": "workspace-1",
        "scope": {"kind": "task", "taskId": "7389088c-29b8-4cec-9a15-e825e1fb2f66"},
        "port": 3000, "scheme": "http", "path": "/"
    }))
    .unwrap();
    assert_eq!(
        unavailable::<PortOpenResponse>(open.validate()).unwrap_err(),
        PORT_PREVIEW_UNAVAILABLE
    );
    let invalid: PortOpenRequest = serde_json::from_value(json!({
        "serverId": "linux", "runnerId": "linux-runner", "ownerId": "workspace-1",
        "scope": {"kind": "task", "taskId": "7389088c-29b8-4cec-9a15-e825e1fb2f66"},
        "port": 80, "scheme": "http", "path": "/"
    }))
    .unwrap();
    assert_ne!(
        unavailable::<PortOpenResponse>(invalid.validate()).unwrap_err(),
        PORT_PREVIEW_UNAVAILABLE
    );
}

#[test]
fn open_scheme_is_a_closed_enum() {
    for (wire, scheme) in [("http", PortScheme::Http), ("https", PortScheme::Https)] {
        let open: PortOpenRequest = serde_json::from_value(json!({
            "serverId": "linux", "runnerId": "linux-runner", "ownerId": "workspace-1",
            "scope": {"kind": "project", "projectId": "storefront"},
            "port": 3000, "scheme": wire, "path": "/"
        }))
        .unwrap();
        assert_eq!(open.scheme, scheme);
    }
}
