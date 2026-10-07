use super::super::schema::{decode_loss, encode_loss};
use super::super::validation::validate_loss;
use super::contract_tests::fixture;
use super::*;

const PRECEDENCE: [(AgentTurnLogLossKind, &str); 8] = [
    (AgentTurnLogLossKind::None, "none"),
    (AgentTurnLogLossKind::LegacyWindow, "legacyWindow"),
    (AgentTurnLogLossKind::BackgroundBuffer, "backgroundBuffer"),
    (AgentTurnLogLossKind::SupervisorGap, "supervisorGap"),
    (AgentTurnLogLossKind::WriteFailure, "writeFailure"),
    (AgentTurnLogLossKind::TurnCeiling, "turnCeiling"),
    (AgentTurnLogLossKind::DiskBudget, "diskBudget"),
    (AgentTurnLogLossKind::Unreadable, "unreadable"),
];

fn of(kind: AgentTurnLogLossKind) -> AgentTurnLogLoss {
    AgentTurnLogLoss {
        kind,
        at_epoch_ms: (kind == AgentTurnLogLossKind::DiskBudget).then_some(1_750_000_000_000),
    }
}

fn disk_budget(at_epoch_ms: u64) -> AgentTurnLogLoss {
    AgentTurnLogLoss {
        kind: AgentTurnLogLossKind::DiskBudget,
        at_epoch_ms: Some(at_epoch_ms),
    }
}

fn more_severe(earlier: AgentTurnLogLossKind, later: AgentTurnLogLossKind) -> AgentTurnLogLossKind {
    if later.severity() > earlier.severity() {
        return later;
    }
    earlier
}

fn stored_loss(store: &AgentTurnLogStore) -> AgentTurnLogLoss {
    store.summarize(&summarize_request()).expect("summaries")[0].loss
}

fn raw_stored_loss(temp: &TempLogStore) -> String {
    let connection = rusqlite::Connection::open(temp.database()).expect("open raw connection");
    connection
        .query_row(
            "SELECT loss FROM turn_meta WHERE turn_id = ?1",
            [TURN_ID],
            |row| row.get(0),
        )
        .expect("read the stored loss")
}

fn force_stored_loss(temp: &TempLogStore, raw: &str) {
    let connection = rusqlite::Connection::open(temp.database()).expect("open raw connection");
    let changed = connection
        .execute(
            "UPDATE turn_meta SET loss = ?2 WHERE turn_id = ?1",
            rusqlite::params![TURN_ID, raw],
        )
        .expect("force the stored loss");
    assert_eq!(changed, 1);
}

fn open_with(store: &AgentTurnLogStore, prior_loss: AgentTurnLogLoss) -> i64 {
    let mut request = open_request(TURN_ID);
    request.prior_loss = prior_loss;
    store
        .open(&request)
        .expect("open with a prior loss")
        .writer_epoch
}

fn report(store: &AgentTurnLogStore, epoch: i64, next_seq: i64, reported: AgentTurnLogLoss) {
    let mut request = append_request(TURN_ID, epoch, next_seq, Vec::new());
    request.loss = reported;
    store.append(&request).expect("report a loss");
}

#[test]
fn every_loss_kind_serializes_to_its_pinned_wire_string_in_precedence_order() {
    let mut previous: Option<u8> = None;
    for (kind, wire) in PRECEDENCE {
        assert_eq!(serde_json::to_value(kind).expect("kind"), json!(wire));
        assert_eq!(
            serde_json::from_value::<AgentTurnLogLossKind>(json!(wire)).expect("known kind"),
            kind
        );
        assert!(previous.is_none_or(|severity| severity < kind.severity()));
        previous = Some(kind.severity());
    }
}

#[test]
fn the_shared_fixture_pins_the_same_loss_precedence_as_the_rust_store() {
    let Some(wire) = fixture() else {
        return;
    };
    let pinned: Vec<&str> = PRECEDENCE.iter().map(|(_, wire)| *wire).collect();
    let mut accepted: Vec<String> = wire["losses"]
        .as_array()
        .expect("losses must be an array")
        .iter()
        .map(|loss| loss["kind"].as_str().expect("a loss kind").to_string())
        .collect();
    let mut expected: Vec<String> = pinned.iter().map(|kind| kind.to_string()).collect();
    accepted.sort();
    expected.sort();

    assert_eq!(wire["lossPrecedence"], json!(pinned));
    assert_eq!(accepted, expected);
}

#[test]
fn the_new_loss_kinds_round_trip_through_the_wire_and_the_stored_column() {
    for (kind, wire) in [
        (AgentTurnLogLossKind::BackgroundBuffer, "backgroundBuffer"),
        (AgentTurnLogLossKind::WriteFailure, "writeFailure"),
    ] {
        let decoded: AgentTurnLogLoss =
            serde_json::from_value(json!({ "kind": wire })).expect("a known loss");

        assert_eq!(decoded, loss(kind));
        assert!(validate_loss(decoded).is_ok());
        assert_eq!(
            serde_json::to_value(decoded).expect("loss"),
            json!({ "kind": wire })
        );
        assert_eq!(encode_loss(decoded), format!("{{\"kind\":\"{wire}\"}}"));
        assert_eq!(decode_loss(&encode_loss(decoded)), decoded);
    }
}

#[test]
fn an_unknown_or_malformed_loss_is_refused_on_the_wire() {
    for value in [
        json!({ "kind": "backgroundbuffer" }),
        json!({ "kind": "write_failure" }),
        json!({ "kind": "diskFull" }),
        json!({ "kind": "writeFailure", "detail": "x" }),
        json!({ "kind": 4 }),
        json!("writeFailure"),
    ] {
        assert!(
            serde_json::from_value::<AgentTurnLogLoss>(value.clone()).is_err(),
            "{value} must not deserialize"
        );
    }
    for kind in [
        AgentTurnLogLossKind::BackgroundBuffer,
        AgentTurnLogLossKind::WriteFailure,
    ] {
        let timestamped = AgentTurnLogLoss {
            kind,
            at_epoch_ms: Some(1),
        };
        assert!(validate_loss(timestamped).is_err());
    }
}

#[test]
fn the_new_loss_kinds_persist_through_the_store_and_survive_a_reopen() {
    for (label, kind, wire) in [
        (
            "loss-background",
            AgentTurnLogLossKind::BackgroundBuffer,
            "backgroundBuffer",
        ),
        (
            "loss-write-failure",
            AgentTurnLogLossKind::WriteFailure,
            "writeFailure",
        ),
    ] {
        let temp = TempLogStore::create(label);
        let store = temp.store();
        let epoch = seed(&store, TURN_ID, 2);
        report(&store, epoch, 3, loss(kind));

        let page = store
            .read_page(&page_request(TURN_ID, tail(), 10, 8_192))
            .expect("page");
        let reopened = temp.store();
        reopened.open(&open_request(TURN_ID)).expect("reopen");

        assert_eq!(raw_stored_loss(&temp), format!("{{\"kind\":\"{wire}\"}}"));
        assert_eq!(page.loss, loss(kind));
        assert_eq!(stored_loss(&reopened), loss(kind));
    }
}

#[test]
fn a_turn_opened_with_a_known_loss_never_stores_a_lossless_row() {
    let temp = TempLogStore::create("loss-open-known");
    let store = temp.store();

    open_with(&store, loss(AgentTurnLogLossKind::BackgroundBuffer));

    assert_eq!(raw_stored_loss(&temp), "{\"kind\":\"backgroundBuffer\"}");
    assert_eq!(
        stored_loss(&store),
        loss(AgentTurnLogLossKind::BackgroundBuffer)
    );
}

#[test]
fn rows_written_before_the_loss_kinds_were_split_still_load_as_a_supervisor_gap() {
    let temp = TempLogStore::create("loss-legacy-row");
    let store = temp.store();
    seed(&store, TURN_ID, 2);
    force_stored_loss(&temp, "{\"kind\":\"supervisorGap\"}");

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 10, 8_192))
        .expect("page");
    let reopened = store.open(&open_request(TURN_ID)).expect("reopen");

    assert_eq!(page.loss, loss(AgentTurnLogLossKind::SupervisorGap));
    assert_eq!(
        stored_loss(&store),
        loss(AgentTurnLogLossKind::SupervisorGap)
    );
    assert_eq!(reopened.next_seq, 3);
    assert_eq!(raw_stored_loss(&temp), "{\"kind\":\"supervisorGap\"}");
}

#[test]
fn a_stored_loss_of_an_unknown_kind_reads_as_unreadable() {
    let temp = TempLogStore::create("loss-unknown-row");
    let store = temp.store();
    seed(&store, TURN_ID, 2);
    force_stored_loss(&temp, "{\"kind\":\"somethingNewer\"}");

    assert_eq!(stored_loss(&store), loss(AgentTurnLogLossKind::Unreadable));
}

#[test]
fn an_append_keeps_the_most_severe_loss_for_every_pair_of_kinds() {
    for (stored_kind, _) in PRECEDENCE {
        for (reported_kind, _) in PRECEDENCE {
            let temp = TempLogStore::create("loss-append-pair");
            let store = temp.store();
            let epoch = open_with(&store, of(stored_kind));
            report(&store, epoch, AGENT_TURN_LOG_SEQ_BASE, of(reported_kind));

            assert_eq!(
                stored_loss(&store).kind,
                more_severe(stored_kind, reported_kind),
                "{stored_kind:?} then {reported_kind:?}"
            );
        }
    }
}

#[test]
fn a_reopen_keeps_the_most_severe_loss_for_every_pair_of_kinds() {
    for (stored_kind, _) in PRECEDENCE {
        for (prior_kind, _) in PRECEDENCE {
            let temp = TempLogStore::create("loss-reopen-pair");
            let store = temp.store();
            open_with(&store, of(stored_kind));
            open_with(&store, of(prior_kind));

            assert_eq!(
                stored_loss(&store).kind,
                more_severe(stored_kind, prior_kind),
                "{stored_kind:?} then {prior_kind:?}"
            );
        }
    }
}

#[test]
fn a_loss_of_equal_severity_keeps_the_earlier_report() {
    let temp = TempLogStore::create("loss-equal");
    let store = temp.store();
    let epoch = open_with(&store, disk_budget(10));

    report(&store, epoch, AGENT_TURN_LOG_SEQ_BASE, disk_budget(20));
    open_with(&store, disk_budget(30));

    assert_eq!(stored_loss(&store), disk_budget(10));
}

#[test]
fn a_milder_loss_never_replaces_a_stored_write_failure_or_supervisor_gap() {
    let temp = TempLogStore::create("loss-milder");
    let store = temp.store();
    let epoch = open_with(&store, loss(AgentTurnLogLossKind::BackgroundBuffer));

    report(
        &store,
        epoch,
        AGENT_TURN_LOG_SEQ_BASE,
        loss(AgentTurnLogLossKind::SupervisorGap),
    );
    let gap = stored_loss(&store);
    report(
        &store,
        epoch,
        AGENT_TURN_LOG_SEQ_BASE,
        loss(AgentTurnLogLossKind::WriteFailure),
    );
    let failure = stored_loss(&store);
    report(
        &store,
        epoch,
        AGENT_TURN_LOG_SEQ_BASE,
        loss(AgentTurnLogLossKind::SupervisorGap),
    );
    report(
        &store,
        epoch,
        AGENT_TURN_LOG_SEQ_BASE,
        loss(AgentTurnLogLossKind::BackgroundBuffer),
    );
    report(
        &store,
        epoch,
        AGENT_TURN_LOG_SEQ_BASE,
        loss(AgentTurnLogLossKind::None),
    );

    assert_eq!(gap, loss(AgentTurnLogLossKind::SupervisorGap));
    assert_eq!(failure, loss(AgentTurnLogLossKind::WriteFailure));
    assert_eq!(
        stored_loss(&store),
        loss(AgentTurnLogLossKind::WriteFailure)
    );
}

#[test]
fn a_loss_only_append_with_a_stale_sequence_stores_nothing_and_keeps_the_stored_loss() {
    let temp = TempLogStore::create("loss-stale-sequence");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);
    report(&store, epoch, 3, loss(AgentTurnLogLossKind::SupervisorGap));
    let before = raw_stored_loss(&temp);
    let mut stale = append_request(TURN_ID, epoch, 2, Vec::new());
    stale.loss = loss(AgentTurnLogLossKind::WriteFailure);

    let refused = store
        .append(&stale)
        .expect_err("a stale sequence is refused");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(code(refused), "sequenceGap");
    assert_eq!(before, "{\"kind\":\"supervisorGap\"}");
    assert_eq!(raw_stored_loss(&temp), before);
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::SupervisorGap));
    assert_eq!(summaries[0].event_count, 2);
    assert!(!summaries[0].sealed);
}

#[test]
fn a_loss_only_append_from_a_superseded_writer_stores_nothing_and_keeps_the_stored_loss() {
    let temp = TempLogStore::create("loss-stale-writer");
    let store = temp.store();
    let stale_epoch = seed(&store, TURN_ID, 2);
    let current_epoch = store
        .open(&open_request(TURN_ID))
        .expect("a newer writer")
        .writer_epoch;
    let before = raw_stored_loss(&temp);
    let mut stale = append_request(TURN_ID, stale_epoch, 3, Vec::new());
    stale.loss = loss(AgentTurnLogLossKind::WriteFailure);

    let refused = store
        .append(&stale)
        .expect_err("a superseded writer is refused");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert!(current_epoch > stale_epoch);
    assert_eq!(code(refused), "supersededWriter");
    assert_eq!(before, "{\"kind\":\"none\"}");
    assert_eq!(raw_stored_loss(&temp), before);
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::None));
    assert_eq!(summaries[0].event_count, 2);
}
