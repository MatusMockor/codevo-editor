use super::super::delta::{
    history_events_digest, HistoryDeltaOutcome, HistoryDeltaRefusal, HistoryEventEdit,
    HistoryTurnDelta, MAX_HISTORY_DELTA_EDITS,
};
use super::*;
use legacy::{AgentTurnEvent, AgentTurnStatus};

const WIRE: &str = include_str!("../../../contracts/agent-history-delta-save-wire.json");

fn text(value: &str) -> AgentTurnEvent {
    AgentTurnEvent::AssistantText {
        text: value.to_string(),
        parent_tool_id: None,
    }
}

fn running_turn(events: Vec<AgentTurnEvent>, output_sequence: u64) -> AgentTurn {
    let mut item = turn(0);
    item.status = AgentTurnStatus::Running;
    item.ended_at_epoch_ms = None;
    item.events = events;
    item.last_output_sequence = output_sequence;
    item
}

fn with_turn(item: AgentTurn) -> AgentThread {
    let mut saved = thread();
    saved.turns = vec![item];
    saved
}

fn header_only(full: &AgentThread) -> AgentThread {
    let mut header = full.clone();
    for item in &mut header.turns {
        item.events.clear();
    }
    header
}

fn numbered(range: std::ops::Range<usize>) -> Vec<AgentTurnEvent> {
    range.map(|index| text(&format!("event-{index}"))).collect()
}

fn digest_of(events: &[AgentTurnEvent]) -> String {
    history_events_digest(events).unwrap()
}

fn saved(fixture: &Fixture, revision: u64) -> HistoryDeltaOutcome {
    HistoryDeltaOutcome::Saved {
        revision,
        events_digest: digest_of(&stored_turn(fixture).events),
    }
}

fn append(base: &[AgentTurnEvent], inserted: Vec<AgentTurnEvent>) -> HistoryTurnDelta {
    let base_event_count = base.len() as u32;
    let mut edits = Vec::new();
    if base_event_count > 0 {
        edits.push(HistoryEventEdit::Copy {
            start: 0,
            count: base_event_count,
        });
    }
    if !inserted.is_empty() {
        edits.push(HistoryEventEdit::Insert { events: inserted });
    }
    HistoryTurnDelta {
        base_event_count,
        base_events_digest: digest_of(base),
        edits,
    }
}

fn stored_turn(fixture: &Fixture) -> AgentTurn {
    let page = fixture
        .store
        .read_turns(ROOT, &owner(), "agt-thread-0001", None)
        .unwrap();
    page.turns.into_iter().next().unwrap()
}

fn stored_revision(fixture: &Fixture) -> u64 {
    fixture
        .store
        .read_turns(ROOT, &owner(), "agt-thread-0001", None)
        .unwrap()
        .revision
}

fn seeded(events: Vec<AgentTurnEvent>) -> Fixture {
    let fixture = Fixture::new();
    fixture
        .store
        .save(ROOT, &owner(), &with_turn(running_turn(events, 1)), 0)
        .unwrap();
    fixture
}

fn save_delta(
    fixture: &Fixture,
    next: &AgentThread,
    expected_revision: u64,
    delta: &HistoryTurnDelta,
) -> HistoryDeltaOutcome {
    fixture
        .store
        .save_turn_delta(
            ROOT,
            &owner(),
            &header_only(next),
            expected_revision,
            delta,
            &[],
        )
        .unwrap()
}

fn refused(reason: HistoryDeltaRefusal) -> HistoryDeltaOutcome {
    HistoryDeltaOutcome::NeedsFullSave { reason }
}

#[test]
fn appended_events_rebuild_exactly_the_turn_a_full_save_would_store() {
    let fixture = seeded(numbered(0..3));
    let mut next = with_turn(running_turn(numbered(0..5), 2));
    next.title = "Renamed".to_string();
    next.updated_at_epoch_ms = 3;

    let outcome = save_delta(&fixture, &next, 1, &append(&numbered(0..3), numbered(3..5)));

    assert_eq!(outcome, saved(&fixture, 2));
    let full = Fixture::new();
    full.store
        .save(
            ROOT,
            &owner(),
            &with_turn(running_turn(numbered(0..3), 1)),
            0,
        )
        .unwrap();
    full.store.save(ROOT, &owner(), &next, 1).unwrap();
    assert_eq!(stored_turn(&fixture), stored_turn(&full));
    assert_eq!(stored_turn(&fixture).events, numbered(0..5));
    let loaded = fixture.store.load(ROOT, &owner()).unwrap();
    assert_eq!(loaded.threads[0].title, "Renamed");
    assert_eq!(loaded.revisions["agt-thread-0001"], 2);
}

#[test]
fn copy_ranges_replace_a_merged_trailing_event_and_drop_evicted_head_events() {
    let fixture = seeded(numbered(0..4));
    let mut events = numbered(1..3);
    events.push(text("event-3 merged"));
    events.push(text("event-4"));
    let next = with_turn(running_turn(events.clone(), 2));
    let delta = HistoryTurnDelta {
        base_event_count: 4,
        base_events_digest: digest_of(&numbered(0..4)),
        edits: vec![
            HistoryEventEdit::Copy { start: 1, count: 2 },
            HistoryEventEdit::Insert {
                events: events[2..].to_vec(),
            },
        ],
    };

    assert_eq!(save_delta(&fixture, &next, 1, &delta), saved(&fixture, 2));
    assert_eq!(stored_turn(&fixture).events, events);
}

#[test]
fn a_stale_base_revision_or_event_count_requests_a_full_save_and_changes_nothing() {
    let fixture = seeded(numbered(0..3));
    let next = with_turn(running_turn(numbered(0..4), 2));

    assert_eq!(
        save_delta(&fixture, &next, 0, &append(&numbered(0..3), numbered(3..4))),
        refused(HistoryDeltaRefusal::BaseMismatch)
    );
    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..2), numbered(2..4))),
        refused(HistoryDeltaRefusal::BaseMismatch)
    );
    assert_eq!(stored_turn(&fixture).events, numbered(0..3));
    assert_eq!(stored_revision(&fixture), 1);
}

#[test]
fn a_missing_thread_turn_or_deleted_thread_requests_a_full_save() {
    let empty = Fixture::new();
    let next = with_turn(running_turn(numbered(0..1), 2));
    assert_eq!(
        save_delta(&empty, &next, 0, &append(&numbered(0..0), numbered(0..1))),
        refused(HistoryDeltaRefusal::MissingBase)
    );

    let fixture = seeded(numbered(0..1));
    let mut other = running_turn(numbered(0..1), 2);
    other.turn_id = "agt-turn-0009".to_string();
    assert_eq!(
        save_delta(
            &fixture,
            &with_turn(other),
            1,
            &append(&numbered(0..1), Vec::new())
        ),
        refused(HistoryDeltaRefusal::MissingBase)
    );

    fixture
        .store
        .delete(ROOT, &owner(), "agt-thread-0001")
        .unwrap();
    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..1), numbered(1..2))),
        refused(HistoryDeltaRefusal::MissingBase)
    );
}

#[test]
fn a_corrupt_stored_turn_requests_a_full_save() {
    let fixture = seeded(numbered(0..1));
    fixture
        .store
        .with_connection(ROOT, &owner(), |connection| {
            sql(connection.execute("UPDATE turns SET payload='{not json'", []))
        })
        .unwrap();
    let next = with_turn(running_turn(numbered(0..2), 2));

    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..1), numbered(1..2))),
        refused(HistoryDeltaRefusal::BaseMismatch)
    );
}

#[test]
fn malformed_or_oversized_deltas_are_refused_before_touching_the_store() {
    let fixture = seeded(numbered(0..2));
    let next = with_turn(running_turn(numbered(0..3), 2));
    let out_of_range = HistoryTurnDelta {
        base_event_count: 2,
        base_events_digest: digest_of(&numbered(0..2)),
        edits: vec![HistoryEventEdit::Copy { start: 1, count: 2 }],
    };
    let empty_copy = HistoryTurnDelta {
        base_event_count: 2,
        base_events_digest: digest_of(&numbered(0..2)),
        edits: vec![HistoryEventEdit::Copy { start: 0, count: 0 }],
    };
    let too_many_edits = HistoryTurnDelta {
        base_event_count: 2,
        base_events_digest: digest_of(&numbered(0..2)),
        edits: (0..=MAX_HISTORY_DELTA_EDITS)
            .map(|_| HistoryEventEdit::Copy { start: 0, count: 1 })
            .collect(),
    };
    let too_many_events = append(
        &numbered(0..2),
        numbered(2..(legacy::MAX_AGENT_EVENTS_PER_TURN + 1)),
    );
    for delta in [out_of_range, empty_copy, too_many_edits, too_many_events] {
        assert_eq!(
            save_delta(&fixture, &next, 1, &delta),
            refused(HistoryDeltaRefusal::InvalidDelta)
        );
    }

    let mut carrying_events = next.clone();
    carrying_events.turns[0].events = numbered(0..1);
    let outcome = fixture
        .store
        .save_turn_delta(
            ROOT,
            &owner(),
            &carrying_events,
            1,
            &append(&numbered(0..2), numbered(2..3)),
            &[],
        )
        .unwrap();
    assert_eq!(outcome, refused(HistoryDeltaRefusal::InvalidDelta));
    assert!(fixture
        .store
        .save_turn_delta(
            ROOT,
            &owner(),
            &header_only(&next),
            legacy::MAX_AGENT_SAFE_INTEGER,
            &append(&numbered(0..2), numbered(2..3)),
            &[],
        )
        .is_err());
    assert_eq!(stored_turn(&fixture).events, numbered(0..2));
    assert_eq!(stored_revision(&fixture), 1);
}

fn large_events(count: usize, label: &str) -> Vec<AgentTurnEvent> {
    let width = legacy::MAX_AGENT_EVENT_TEXT_BYTES - 64;
    (0..count)
        .map(|index| text(&format!("{:x<width$}", format!("{label}-{index}-"))))
        .collect()
}

fn history_directory_exists(fixture: &Fixture) -> bool {
    fixture.base.join("agent-history").exists()
}

#[test]
fn an_oversized_or_invalid_delta_is_refused_before_the_store_is_opened() {
    let fixture = Fixture::new();
    let inserted = large_events(
        MAX_PAGE_BYTES / legacy::MAX_AGENT_EVENT_TEXT_BYTES + 8,
        "big",
    );
    let next = with_turn(running_turn(inserted.clone(), 2));
    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..1), inserted)),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );

    let oversized_text = text(&"y".repeat(legacy::MAX_AGENT_EVENT_TEXT_BYTES + 1));
    assert_eq!(
        save_delta(
            &fixture,
            &next,
            1,
            &append(&numbered(0..1), vec![oversized_text])
        ),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );

    let mut malformed_digest = append(&numbered(0..1), numbered(1..2));
    malformed_digest.base_events_digest = "Z".repeat(64);
    assert_eq!(
        save_delta(&fixture, &next, 1, &malformed_digest),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );

    let mut long_title = next.clone();
    long_title.title = "t".repeat(legacy::MAX_AGENT_THREAD_TITLE_BYTES + 1);
    assert_eq!(
        save_delta(
            &fixture,
            &long_title,
            1,
            &append(&numbered(0..1), numbered(1..2))
        ),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );
    assert!(!history_directory_exists(&fixture));
}

#[test]
fn a_rebuilt_turn_over_the_page_budget_requests_a_full_save() {
    let base = large_events(250, "base");
    let fixture = seeded(base.clone());
    let inserted = large_events(30, "tail");
    let mut events = base.clone();
    events.extend(inserted.iter().cloned());
    let next = with_turn(running_turn(events, 2));

    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&base, inserted)),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );
    assert_eq!(stored_revision(&fixture), 1);
    assert_eq!(stored_turn(&fixture).events, base);
}

#[test]
fn a_second_writer_with_the_same_event_count_cannot_be_copied_from() {
    let fixture = seeded(numbered(0..2));
    let cached = numbered(0..2);
    let foreign = vec![text("x"), text("y")];
    fixture
        .store
        .save(
            ROOT,
            &owner(),
            &with_turn(running_turn(foreign.clone(), 2)),
            1,
        )
        .unwrap();
    let mut events = cached.clone();
    events.push(text("c"));

    assert_eq!(
        save_delta(
            &fixture,
            &with_turn(running_turn(events, 3)),
            2,
            &append(&cached, vec![text("c")])
        ),
        refused(HistoryDeltaRefusal::BaseMismatch)
    );
    assert_eq!(stored_turn(&fixture).events, foreign);
    assert_eq!(stored_revision(&fixture), 2);
}

#[test]
fn full_save_receipts_carry_the_digest_a_delta_must_present() {
    let fixture = Fixture::new();
    let receipt = fixture
        .store
        .save(
            ROOT,
            &owner(),
            &with_turn(running_turn(numbered(0..2), 1)),
            0,
        )
        .unwrap();
    assert_eq!(receipt.events_digest, Some(digest_of(&numbered(0..2))));
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &thread(), 1)
            .unwrap()
            .events_digest,
        None
    );
}

#[test]
fn a_failure_after_partial_writes_rolls_back_the_whole_delta() {
    let fixture = seeded(numbered(0..2));
    let mut next = with_turn(running_turn(numbered(0..3), 0));
    next.title = "Must not persist".to_string();
    next.updated_at_epoch_ms = 9;

    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..2), numbered(2..3))),
        refused(HistoryDeltaRefusal::InvalidDelta)
    );
    assert_eq!(stored_turn(&fixture).events, numbered(0..2));
    assert_eq!(stored_revision(&fixture), 1);
    let loaded = fixture.store.load(ROOT, &owner()).unwrap();
    assert_eq!(loaded.threads[0].title, "History");
    assert_eq!(loaded.threads[0].updated_at_epoch_ms, 2);
}

#[test]
fn replaying_an_acknowledged_delta_is_idempotent_and_a_different_delta_is_stale() {
    let fixture = seeded(numbered(0..2));
    let next = with_turn(running_turn(numbered(0..3), 2));
    let delta = append(&numbered(0..2), numbered(2..3));

    assert_eq!(save_delta(&fixture, &next, 1, &delta), saved(&fixture, 2));
    assert_eq!(save_delta(&fixture, &next, 1, &delta), saved(&fixture, 2));
    assert_eq!(stored_turn(&fixture).events, numbered(0..3));

    let other = with_turn(running_turn(numbered(0..4), 3));
    assert_eq!(
        save_delta(
            &fixture,
            &other,
            1,
            &append(&numbered(0..2), numbered(2..4))
        ),
        refused(HistoryDeltaRefusal::BaseMismatch)
    );
    assert!(fixture.store.save(ROOT, &owner(), &next, 1).is_err());
}

#[test]
fn a_full_save_after_a_delta_continues_the_same_revision_chain() {
    let fixture = seeded(numbered(0..2));
    let next = with_turn(running_turn(numbered(0..3), 2));
    assert_eq!(
        save_delta(&fixture, &next, 1, &append(&numbered(0..2), numbered(2..3))),
        saved(&fixture, 2)
    );
    let later = with_turn(running_turn(numbered(0..5), 3));

    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &later, 2)
            .unwrap()
            .revision,
        3
    );
    assert_eq!(
        save_delta(
            &fixture,
            &with_turn(running_turn(numbered(0..6), 4)),
            3,
            &append(&numbered(0..5), numbered(5..6))
        ),
        saved(&fixture, 4)
    );
    assert_eq!(stored_turn(&fixture).events, numbered(0..6));
}

#[test]
fn delta_payloads_reject_unknown_fields_and_variants() {
    let unknown_top = serde_json::from_value::<HistoryTurnDelta>(json!({
        "baseEventCount": 1, "baseEventsDigest": "0".repeat(64), "edits": [], "extra": true
    }));
    let unknown_copy = serde_json::from_value::<HistoryTurnDelta>(json!({
        "baseEventCount": 1, "baseEventsDigest": "0".repeat(64), "edits": [{ "kind": "copy", "start": 0, "count": 1, "extra": 1 }]
    }));
    let unknown_kind = serde_json::from_value::<HistoryTurnDelta>(json!({
        "baseEventCount": 1, "baseEventsDigest": "0".repeat(64), "edits": [{ "kind": "replace", "events": [] }]
    }));
    let negative = serde_json::from_value::<HistoryTurnDelta>(json!({
        "baseEventCount": -1, "baseEventsDigest": "0".repeat(64), "edits": []
    }));

    assert!(unknown_top.is_err());
    assert!(unknown_copy.is_err());
    assert!(unknown_kind.is_err());
    assert!(negative.is_err());
}

#[test]
fn delta_wire_contract_matches_the_shared_fixture() {
    let wire: serde_json::Value = serde_json::from_str(WIRE).unwrap();
    let request = &wire["validRequest"];
    let delta: HistoryTurnDelta = serde_json::from_value(request["delta"].clone()).unwrap();
    assert_eq!(serde_json::to_value(&delta).unwrap(), request["delta"]);
    let base: Vec<AgentTurnEvent> = serde_json::from_value(wire["baseEvents"].clone()).unwrap();
    assert_eq!(digest_of(&base), delta.base_events_digest);
    let header: AgentThread = serde_json::from_value(request["thread"].clone()).unwrap();
    assert!(header.turns[0].events.is_empty());
    for invalid in wire["invalidDeltas"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<HistoryTurnDelta>(invalid.clone()).is_err(),
            "{invalid}"
        );
    }
    let kinds: Vec<_> = [
        HistoryEventEdit::Copy { start: 0, count: 1 },
        HistoryEventEdit::Insert {
            events: numbered(0..1),
        },
    ]
    .iter()
    .map(|edit| serde_json::to_value(edit).unwrap()["kind"].clone())
    .collect();
    assert_eq!(json!(kinds), wire["editKinds"]);
    let reasons = [
        HistoryDeltaRefusal::BaseMismatch,
        HistoryDeltaRefusal::MissingBase,
        HistoryDeltaRefusal::InvalidDelta,
    ];
    assert_eq!(json!(reasons), wire["refusalReasons"]);
    assert_eq!(
        serde_json::to_value(HistoryDeltaOutcome::Saved {
            revision: 4,
            events_digest: digest_of(&base),
        })
        .unwrap(),
        wire["outcomes"][0]
    );
    assert_eq!(
        serde_json::to_value(HistorySaveReceipt {
            revision: 4,
            events_digest: Some(digest_of(&base)),
        })
        .unwrap(),
        wire["fullSaveReceipt"]
    );
    assert_eq!(
        serde_json::to_value(refused(HistoryDeltaRefusal::BaseMismatch)).unwrap(),
        wire["outcomes"][1]
    );
}
