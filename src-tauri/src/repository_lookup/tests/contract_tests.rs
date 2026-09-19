use serde_json::Value;

use super::super::wire::{
    RepositoryHostsSnapshot, RepositoryLookupOutcome, RepositoryLookupRequest,
    RepositoryLookupRequestWire,
};

const CONTRACT: &str = include_str!("../../../../contracts/repository-lookup-wire.json");

fn contract() -> Value {
    serde_json::from_str::<Value>(CONTRACT).expect("parse the repository lookup contract")
}

fn fixtures(key: &str) -> Vec<(String, Value)> {
    contract()
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .map(|entry| {
            (
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                entry.get("value").cloned().unwrap_or(Value::Null),
            )
        })
        .collect()
}

fn request_is_accepted(value: &Value) -> bool {
    let Ok(wire) = serde_json::from_value::<RepositoryLookupRequestWire>(value.clone()) else {
        return false;
    };
    RepositoryLookupRequest::validate(&wire).is_some()
}

fn snapshot_round_trips(value: &Value) -> bool {
    let Ok(snapshot) = serde_json::from_value::<RepositoryHostsSnapshot>(value.clone()) else {
        return false;
    };
    if snapshot.clone().sanitized() != snapshot {
        return false;
    }
    serde_json::to_value(&snapshot).is_ok_and(|encoded| &encoded == value)
}

fn outcome_round_trips(value: &Value) -> bool {
    let Ok(outcome) = serde_json::from_value::<RepositoryLookupOutcome>(value.clone()) else {
        return false;
    };
    if outcome.clone().sanitized() != outcome {
        return false;
    }
    serde_json::to_value(&outcome).is_ok_and(|encoded| &encoded == value)
}

#[test]
fn the_contract_declares_the_expected_schema_version() {
    assert_eq!(contract().get("schemaVersion"), Some(&Value::from(1)));
    assert_eq!(fixtures("requests").len(), 3);
    assert!(!fixtures("outcomes").is_empty());
    assert!(!fixtures("hostsSnapshots").is_empty());
}

#[test]
fn every_request_fixture_is_accepted() {
    for (name, value) in fixtures("requests") {
        assert!(request_is_accepted(&value), "{name}");
    }
}

#[test]
fn every_rejected_request_fixture_is_refused() {
    for (name, value) in fixtures("rejectedRequests") {
        assert!(!request_is_accepted(&value), "{name}");
    }
}

#[test]
fn every_hosts_snapshot_fixture_round_trips() {
    for (name, value) in fixtures("hostsSnapshots") {
        assert!(snapshot_round_trips(&value), "{name}");
    }
}

#[test]
fn every_rejected_hosts_snapshot_fixture_never_round_trips() {
    for (name, value) in fixtures("rejectedHostsSnapshots") {
        assert!(!snapshot_round_trips(&value), "{name}");
    }
}

#[test]
fn every_outcome_fixture_round_trips() {
    for (name, value) in fixtures("outcomes") {
        assert!(outcome_round_trips(&value), "{name}");
    }
}

#[test]
fn every_rejected_outcome_fixture_never_round_trips() {
    for (name, value) in fixtures("rejectedOutcomes") {
        assert!(!outcome_round_trips(&value), "{name}");
    }
}
