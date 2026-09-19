use super::super::errors::{classify_sqlite_error, MAX_SEQUENCE_GAP_HINT};
use super::super::wire::{DeleteAgentThreadLogResult, AGENT_TURN_LOG_SEQ_BASE};
use super::contract_tests::{cases, decoded, fixture, ERROR_CODES};
use super::*;

#[test]
fn every_closed_error_code_is_reachable_and_stable() {
    let produced = [
        AgentTurnLogError::SupersededWriter,
        AgentTurnLogError::SequenceGap(None),
        AgentTurnLogError::Sealed,
        AgentTurnLogError::OwnerMismatch,
        AgentTurnLogError::BudgetExhausted,
        AgentTurnLogError::DiskFull,
        AgentTurnLogError::Foreign,
        AgentTurnLogError::Unreadable,
        AgentTurnLogError::Busy,
    ]
    .map(code);

    assert_eq!(produced, ERROR_CODES);
    assert_eq!(code(AgentTurnLogError::Corrupt), "unreadable");
    assert!(AgentTurnLogError::Busy.retains_connection());
    assert!(!AgentTurnLogError::Corrupt.retains_connection());
}

#[test]
fn every_sqlite_failure_class_maps_to_the_retry_policy_the_writer_expects() {
    let cases = [
        ("SQLITE_FULL", 13, AgentTurnLogError::DiskFull),
        ("SQLITE_BUSY", 5, AgentTurnLogError::Busy),
        ("SQLITE_BUSY_SNAPSHOT", 517, AgentTurnLogError::Busy),
        ("SQLITE_LOCKED", 6, AgentTurnLogError::Busy),
        ("SQLITE_LOCKED_SHAREDCACHE", 262, AgentTurnLogError::Busy),
        ("SQLITE_IOERR", 10, AgentTurnLogError::Unreadable),
        ("SQLITE_IOERR_WRITE", 778, AgentTurnLogError::Unreadable),
        ("SQLITE_CANTOPEN", 14, AgentTurnLogError::Unreadable),
        (
            "SQLITE_CANTOPEN_NOTEMPDIR",
            270,
            AgentTurnLogError::Unreadable,
        ),
        ("SQLITE_READONLY", 8, AgentTurnLogError::Unreadable),
        (
            "SQLITE_READONLY_RECOVERY",
            264,
            AgentTurnLogError::Unreadable,
        ),
        ("SQLITE_NOMEM", 7, AgentTurnLogError::Unreadable),
        ("SQLITE_CORRUPT", 11, AgentTurnLogError::Corrupt),
        ("SQLITE_CORRUPT_VTAB", 267, AgentTurnLogError::Corrupt),
        ("SQLITE_NOTADB", 26, AgentTurnLogError::Corrupt),
    ];

    for (label, result_code, expected) in cases {
        let failure = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(result_code), None);
        assert_eq!(
            classify_sqlite_error(&failure),
            expected,
            "{label} must classify as {}",
            expected.code()
        );
    }

    assert_eq!(
        classify_sqlite_error(&rusqlite::Error::QueryReturnedNoRows),
        AgentTurnLogError::Unreadable,
        "a failure without a sqlite code must stay retryable"
    );
    assert!(AgentTurnLogError::Busy.retains_connection());
    assert!(AgentTurnLogError::DiskFull.retains_connection());
    assert!(!AgentTurnLogError::Unreadable.retains_connection());
    assert!(!AgentTurnLogError::Corrupt.retains_connection());
    assert_eq!(code(AgentTurnLogError::DiskFull), "diskFull");
    assert_eq!(code(AgentTurnLogError::Busy), "busy");
    assert_eq!(code(AgentTurnLogError::Unreadable), "unreadable");
    assert_eq!(code(AgentTurnLogError::Corrupt), "unreadable");
}

#[test]
fn the_shared_fixture_pins_the_structured_sequence_gap_form() {
    let Some(wire) = fixture() else {
        return;
    };
    let structured = wire["sequenceGapErrors"]
        .as_array()
        .expect("sequenceGapErrors must be an array");
    assert!(!structured.is_empty());
    for case in structured {
        let next_seq = case["nextSeq"].as_i64().expect("a decimal next sequence");
        let raw = case["value"].as_str().expect("a wire string");
        assert_eq!(
            AgentTurnLogError::SequenceGap(Some(next_seq)).message(),
            raw,
            "the structured sequence gap must match the fixture"
        );
    }
    let plain = wire["plainSequenceGapErrors"]
        .as_array()
        .expect("plainSequenceGapErrors must be an array");
    let produced = every_hint_message();
    for case in plain {
        let raw = case["value"].as_str().expect("a wire string");
        if raw == AgentTurnLogError::SequenceGap(None).code() {
            continue;
        }
        assert!(
            !produced.iter().any(|message| message == raw),
            "{raw} must never be produced by the store"
        );
    }
}

fn every_hint_message() -> Vec<String> {
    [
        Some(i64::MIN),
        Some(-1),
        Some(0),
        Some(AGENT_TURN_LOG_SEQ_BASE),
        Some(7),
        Some(MAX_SEQUENCE_GAP_HINT),
        Some(MAX_SEQUENCE_GAP_HINT + 1),
        Some(i64::MAX),
        None,
    ]
    .into_iter()
    .map(|hint| AgentTurnLogError::SequenceGap(hint).message())
    .collect()
}

#[test]
fn an_out_of_range_sequence_hint_falls_back_to_the_bare_code() {
    assert_eq!(
        AgentTurnLogError::SequenceGap(None).message(),
        "sequenceGap"
    );
    assert_eq!(
        AgentTurnLogError::SequenceGap(Some(0)).message(),
        "sequenceGap"
    );
    assert_eq!(
        AgentTurnLogError::SequenceGap(Some(-1)).message(),
        "sequenceGap"
    );
    assert_eq!(
        AgentTurnLogError::SequenceGap(Some(MAX_SEQUENCE_GAP_HINT + 1)).message(),
        "sequenceGap"
    );
    assert_eq!(
        AgentTurnLogError::SequenceGap(Some(MAX_SEQUENCE_GAP_HINT)).message(),
        "sequenceGap:9007199254740991"
    );
    assert_eq!(
        AgentTurnLogError::Busy.message(),
        "busy",
        "only the sequence gap carries a structured form"
    );
}

#[test]
fn the_shared_fixture_delete_results_round_trip_and_the_rejected_ones_fail_closed() {
    let Some(wire) = fixture() else {
        return;
    };
    let accepted = cases(&wire, "deleteThreadLogResults");
    assert!(!accepted.is_empty());
    for value in accepted {
        decoded::<DeleteAgentThreadLogResult>(value, "fixture delete result");
    }
    for value in cases(&wire, "rejectedDeleteThreadLogResults") {
        assert!(
            serde_json::from_value::<DeleteAgentThreadLogResult>(value.clone()).is_err(),
            "the fixture rejected delete result must fail closed: {value}"
        );
    }
    assert_eq!(
        wire["commands"]["deleteThreadLog"],
        json!("delete_agent_thread_log")
    );
}
