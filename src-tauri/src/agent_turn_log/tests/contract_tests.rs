use super::super::projection::{
    validate_lease, validate_page, validate_receipt, validate_summaries,
};
use super::super::validation::{
    validate_append_request, validate_delete_request, validate_digest, validate_loss,
    validate_open_request, validate_page_request, validate_summarize_request,
};
use super::super::wire::{
    AgentTurnDigestWire, AgentTurnLogLease, AgentTurnLogPage, AgentTurnLogSummary,
    AppendAgentTurnLogReceipt, AGENT_TURN_LOG_SEQ_BASE, MAX_APPEND_BYTES, MAX_APPEND_OPS,
    MAX_DIGEST_BYTES, MAX_DIGEST_CAPACITIES, MAX_PAGE_BYTES, MAX_PAGE_EVENTS,
    MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES, MAX_SUMMARY_PROMPT_RESPONSE_BYTES,
    MAX_TURN_LIFECYCLE_BYTES, MAX_TURN_PROMPT_BYTES, MAX_TURN_SUMMARIES,
};
use super::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

const FIXTURE_RELATIVE_PATH: &str = "../contracts/agent-turn-log-wire.json";
pub(super) const ERROR_CODES: [&str; 9] = [
    "supersededWriter",
    "sequenceGap",
    "sealed",
    "ownerMismatch",
    "budgetExhausted",
    "diskFull",
    "foreign",
    "unreadable",
    "busy",
];

pub(super) fn fixture() -> Option<Value> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_RELATIVE_PATH);
    let Ok(raw) = fs::read_to_string(&path) else {
        eprintln!(
            "skipping: {} is not present yet; the TypeScript stream owns it",
            path.display()
        );
        return None;
    };
    Some(serde_json::from_str(&raw).expect("the shared fixture must be valid JSON"))
}

pub(super) fn decoded<T: DeserializeOwned + Serialize>(value: &Value, label: &str) -> T {
    let decoded: T = serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("{label} must deserialize: {error}"));
    let encoded = serde_json::to_value(&decoded)
        .unwrap_or_else(|error| panic!("{label} must serialize: {error}"));
    assert_eq!(&encoded, value, "{label} must round trip unchanged");
    decoded
}

fn accepted<T: DeserializeOwned + Serialize>(
    value: &Value,
    label: &str,
    check: impl Fn(&T) -> bool,
) {
    let decoded: T = decoded(value, label);
    assert!(check(&decoded), "{label} must pass validation");
}

fn refused<T: DeserializeOwned>(value: &Value, label: &str, check: impl Fn(&T) -> bool) {
    let Ok(decoded) = serde_json::from_value::<T>(value.clone()) else {
        return;
    };
    assert!(!check(&decoded), "{label} must be refused");
}

pub(super) fn cases<'wire>(wire: &'wire Value, key: &str) -> Vec<&'wire Value> {
    let Some(value) = wire.get(key) else {
        return Vec::new();
    };
    let items = value
        .as_array()
        .unwrap_or_else(|| panic!("the fixture key {key} must be an array"));
    items.iter().map(unwrapped).collect()
}

fn keyed_cases<'wire>(wire: &'wire Value, key: &str) -> Vec<(String, &'wire Value)> {
    let Some(value) = wire.get(key) else {
        return Vec::new();
    };
    let group = value
        .as_object()
        .unwrap_or_else(|| panic!("the fixture key {key} must be an object keyed by command"));
    let mut collected = Vec::new();
    for (command, values) in group {
        let items = values
            .as_array()
            .unwrap_or_else(|| panic!("the fixture key {key}.{command} must be an array"));
        for item in items {
            collected.push((command.clone(), unwrapped(item)));
        }
    }
    collected
}

fn unwrapped(case: &Value) -> &Value {
    case.get("value").unwrap_or(case)
}

#[test]
fn the_shared_fixture_pins_the_same_bounds_as_the_rust_store() {
    let Some(wire) = fixture() else {
        return;
    };
    let limits = &wire["limits"];

    assert_eq!(wire["schemaVersion"], json!(1));
    assert_eq!(limits["seqBase"], json!(AGENT_TURN_LOG_SEQ_BASE));
    assert_eq!(limits["appendOps"], json!(MAX_APPEND_OPS));
    assert_eq!(limits["appendBytes"], json!(MAX_APPEND_BYTES));
    assert_eq!(limits["pageEvents"], json!(MAX_PAGE_EVENTS));
    assert_eq!(limits["pageBytes"], json!(MAX_PAGE_BYTES));
    assert_eq!(limits["digestBytes"], json!(MAX_DIGEST_BYTES));
    assert_eq!(limits["digestCapacities"], json!(MAX_DIGEST_CAPACITIES));
    assert_eq!(limits["summaries"], json!(MAX_TURN_SUMMARIES));
    assert_eq!(limits["promptBytes"], json!(MAX_TURN_PROMPT_BYTES));
    assert_eq!(
        limits["summaryPromptBytes"],
        json!(MAX_SUMMARY_PROMPT_RESPONSE_BYTES)
    );
    assert_eq!(limits["lifecycleBytes"], json!(MAX_TURN_LIFECYCLE_BYTES));
    assert_eq!(
        limits["summaryLifecycleBytes"],
        json!(MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES)
    );
    assert_eq!(wire["errors"], json!(ERROR_CODES));
    assert_eq!(
        wire["scope"]["ownerId"],
        json!(agent_root_owner_id(
            wire["scope"]["rootKey"].as_str().expect("a root key")
        )),
        "the fixture owner id must be derived from the root key"
    );
}

#[test]
fn the_turn_prompt_ceiling_matches_the_spawned_agent_prompt_ceiling() {
    assert_eq!(
        MAX_TURN_PROMPT_BYTES,
        crate::agent_task_spawner::MAX_AGENT_PROMPT_BYTES
    );
}

#[test]
fn the_shared_fixture_requests_round_trip_and_the_rejected_ones_fail_closed() {
    let Some(wire) = fixture() else {
        return;
    };
    for (command, value) in keyed_cases(&wire, "requests") {
        match command.as_str() {
            "open" => accepted(value, "fixture open request", |request| {
                validate_open_request(request).is_ok()
            }),
            "append" => accepted(value, "fixture append request", |request| {
                validate_append_request(request).is_ok()
            }),
            "page" => accepted(value, "fixture page request", |request| {
                validate_page_request(request).is_ok()
            }),
            "summarize" => accepted(value, "fixture summarize request", |request| {
                validate_summarize_request(request).is_ok()
            }),
            "deleteThreadLog" => accepted(value, "fixture delete request", |request| {
                validate_delete_request(request).is_ok()
            }),
            other => panic!("the fixture carries an unmapped request kind: {other}"),
        }
    }
    for (command, value) in keyed_cases(&wire, "rejectedRequests") {
        match command.as_str() {
            "open" => refused(value, "fixture rejected open", |request| {
                validate_open_request(request).is_ok()
            }),
            "append" => refused(value, "fixture rejected append", |request| {
                validate_append_request(request).is_ok()
            }),
            "page" => refused(value, "fixture rejected page", |request| {
                validate_page_request(request).is_ok()
            }),
            "summarize" => refused(value, "fixture rejected summarize", |request| {
                validate_summarize_request(request).is_ok()
            }),
            "deleteThreadLog" => refused(value, "fixture rejected delete", |request| {
                validate_delete_request(request).is_ok()
            }),
            other => panic!("the fixture carries an unmapped rejected request kind: {other}"),
        }
    }
}

#[test]
fn the_shared_fixture_projections_round_trip_and_the_rejected_ones_fail_closed() {
    let Some(wire) = fixture() else {
        return;
    };
    for value in cases(&wire, "losses") {
        accepted(value, "fixture loss", |loss| validate_loss(*loss).is_ok());
    }
    for value in cases(&wire, "rejectedLosses") {
        refused(value, "fixture rejected loss", |loss| {
            validate_loss(*loss).is_ok()
        });
    }
    for value in cases(&wire, "digests") {
        accepted::<AgentTurnDigestWire>(value, "fixture digest", |digest| {
            validate_digest(digest).is_ok()
        });
    }
    for value in cases(&wire, "rejectedDigests") {
        refused::<AgentTurnDigestWire>(value, "fixture rejected digest", |digest| {
            validate_digest(digest).is_ok()
        });
    }
    for value in cases(&wire, "leases") {
        accepted::<AgentTurnLogLease>(value, "fixture lease", |lease| {
            validate_lease(lease).is_ok()
        });
    }
    for value in cases(&wire, "rejectedLeases") {
        refused::<AgentTurnLogLease>(value, "fixture rejected lease", |lease| {
            validate_lease(lease).is_ok()
        });
    }
    for value in cases(&wire, "receipts") {
        accepted::<AppendAgentTurnLogReceipt>(value, "fixture receipt", |receipt| {
            validate_receipt(receipt).is_ok()
        });
    }
    for value in cases(&wire, "rejectedReceipts") {
        refused::<AppendAgentTurnLogReceipt>(value, "fixture rejected receipt", |receipt| {
            validate_receipt(receipt).is_ok()
        });
    }
    for value in cases(&wire, "pages") {
        accepted::<AgentTurnLogPage>(value, "fixture page", |page| validate_page(page).is_ok());
    }
    for value in cases(&wire, "rejectedPages") {
        refused::<AgentTurnLogPage>(value, "fixture rejected page", |page| {
            validate_page(page).is_ok()
        });
    }
    for value in cases(&wire, "summaries") {
        accepted::<Vec<AgentTurnLogSummary>>(value, "fixture summaries", |summaries| {
            validate_summaries(summaries).is_ok()
        });
    }
    for value in cases(&wire, "rejectedSummaries") {
        refused::<Vec<AgentTurnLogSummary>>(value, "fixture rejected summaries", |summaries| {
            validate_summaries(summaries).is_ok()
        });
    }
}

#[test]
fn the_shared_fixture_events_survive_the_thread_store_validator() {
    let Some(wire) = fixture() else {
        return;
    };
    for value in cases(&wire, "events") {
        let event: AgentTurnEvent = decoded(value, "fixture event");
        super::super::agent_thread_store::validate_agent_turn_event(&event)
            .expect("fixture events must pass the shared validator");
    }
}

#[test]
fn a_rejected_error_string_is_never_one_of_the_closed_codes() {
    let Some(wire) = fixture() else {
        return;
    };
    for value in wire["rejectedErrors"]
        .as_array()
        .expect("rejectedErrors must be an array")
    {
        let raw = value.as_str().expect("a rejected error must be a string");
        assert!(
            !ERROR_CODES.contains(&raw),
            "{raw} must not be a valid code"
        );
    }
}
