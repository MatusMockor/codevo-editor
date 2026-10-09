use super::*;
use halt_requests::{
    TurnHaltEscalation, TurnHaltEscalationSource, TurnHaltMode, TurnHaltRequest, TurnHaltSource,
};

const OTHER_THREAD: &str = "agt-thread-0002";

fn turn_id(index: usize) -> String {
    format!("agt-turn-{index:04}")
}

fn interrupt_request(index: usize) -> TurnHaltRequest {
    TurnHaltRequest {
        turn_id: turn_id(index),
        source: TurnHaltSource::ComposerEscape,
        mode: TurnHaltMode::SoftInterrupt,
        requested_at_epoch_ms: 1_000,
        escalation: None,
    }
}

fn hard_stop_request(index: usize) -> TurnHaltRequest {
    TurnHaltRequest {
        turn_id: turn_id(index),
        source: TurnHaltSource::ThreadMenu,
        mode: TurnHaltMode::HardStop,
        requested_at_epoch_ms: 2_000,
        escalation: None,
    }
}

fn escalated(request: TurnHaltRequest, source: TurnHaltEscalationSource) -> TurnHaltRequest {
    TurnHaltRequest {
        escalation: Some(TurnHaltEscalation {
            source,
            requested_at_epoch_ms: request.requested_at_epoch_ms + 500,
        }),
        ..request
    }
}

fn running_thread(index: usize) -> AgentThread {
    let mut saved = thread();
    saved.turns = vec![running_turn(index)];
    saved
}

fn save_halted(fixture: &Fixture, saved: &AgentThread, revision: u64, halts: &[TurnHaltRequest]) {
    fixture
        .store
        .save_with_halt_requests(ROOT, &owner(), saved, revision, halts)
        .unwrap();
}

fn stored_halts(fixture: &Fixture, thread_id: &str) -> Vec<TurnHaltRequest> {
    AgentHistoryStore::new(fixture.base.clone())
        .read_turns(ROOT, &owner(), thread_id, None)
        .unwrap()
        .halt_requests
}

fn halt_row_count(fixture: &Fixture) -> i64 {
    raw_history(fixture)
        .query_row("SELECT COUNT(*) FROM turn_halt_requests", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn halt_request_survives_save_and_restart_on_every_read_path() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    let request = escalated(
        interrupt_request(0),
        TurnHaltEscalationSource::InterruptRefused,
    );
    save_halted(&fixture, &saved, 0, std::slice::from_ref(&request));

    let reopened = AgentHistoryStore::new(fixture.base.clone());
    let snapshot = reopened.load(ROOT, &owner()).unwrap();
    assert_eq!(
        snapshot.halt_requests.get(&saved.thread_id),
        Some(&vec![request.clone()])
    );
    assert_eq!(snapshot.threads[0].turns, saved.turns);
    let page = reopened
        .read_turns(ROOT, &owner(), &saved.thread_id, None)
        .unwrap();
    assert_eq!(page.halt_requests, vec![request]);
}

#[test]
fn halt_request_stays_out_of_the_turn_and_thread_payloads() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);

    let raw = raw_history(&fixture);
    let turn_payload: String = raw
        .query_row("SELECT payload FROM turns", [], |row| row.get(0))
        .unwrap();
    let thread_payload: String = raw
        .query_row("SELECT payload FROM threads", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        turn_payload,
        serde_json::to_string(&saved.turns[0]).unwrap()
    );
    assert!(!turn_payload.contains("halt"));
    assert!(!thread_payload.contains("halt"));
    assert!(serde_json::from_str::<AgentTurn>(&turn_payload).is_ok());
}

#[test]
fn halt_table_is_additive_and_keeps_the_released_schema_version() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);
    let version = |fixture: &Fixture| -> i64 {
        raw_history(fixture)
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    };
    assert_eq!(version(&fixture), 2);

    raw_history(&fixture)
        .execute_batch("CREATE TABLE from_a_newer_build(id INTEGER PRIMARY KEY);")
        .unwrap();
    for _ in 0..2 {
        let reopened = AgentHistoryStore::new(fixture.base.clone());
        assert_eq!(reopened.load(ROOT, &owner()).unwrap().threads.len(), 1);
    }

    assert_eq!(version(&fixture), 2);
    assert_eq!(halt_row_count(&fixture), 1);
    assert_eq!(
        stored_halts(&fixture, &saved.thread_id),
        vec![interrupt_request(0)]
    );
}

#[test]
fn history_written_before_the_halt_table_existed_gains_it_on_open() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    raw_history(&fixture)
        .execute_batch("DROP TABLE turn_halt_requests;")
        .unwrap();

    save_halted(&fixture, &saved, 1, &[interrupt_request(0)]);

    assert_eq!(
        stored_halts(&fixture, &saved.thread_id),
        vec![interrupt_request(0)]
    );
}

#[test]
fn first_halt_request_wins_and_one_escalation_is_kept() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    let first = interrupt_request(0);
    save_halted(&fixture, &saved, 0, std::slice::from_ref(&first));

    save_halted(&fixture, &saved, 1, &[hard_stop_request(0)]);
    assert_eq!(
        stored_halts(&fixture, &saved.thread_id),
        vec![first.clone()]
    );

    let once = escalated(first.clone(), TurnHaltEscalationSource::ComposerStopButton);
    save_halted(&fixture, &saved, 2, std::slice::from_ref(&once));
    save_halted(
        &fixture,
        &saved,
        3,
        &[escalated(first, TurnHaltEscalationSource::SessionDock)],
    );

    assert_eq!(stored_halts(&fixture, &saved.thread_id), vec![once]);
    assert_eq!(halt_row_count(&fixture), 1);
}

#[test]
fn hard_stop_request_never_gains_an_escalation() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    let first = hard_stop_request(0);
    save_halted(&fixture, &saved, 0, std::slice::from_ref(&first));

    save_halted(
        &fixture,
        &saved,
        1,
        &[escalated(
            interrupt_request(0),
            TurnHaltEscalationSource::ComposerEscape,
        )],
    );

    assert_eq!(stored_halts(&fixture, &saved.thread_id), vec![first]);
}

#[test]
fn turn_saved_without_a_request_has_no_halt_record() {
    let fixture = Fixture::new();
    let mut saved = running_thread(0);
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    saved.turns[0].status = legacy::AgentTurnStatus::Stopped;
    saved.turns[0].ended_at_epoch_ms = Some(3);
    saved.turns[0].last_status_sequence = 2;
    fixture.store.save(ROOT, &owner(), &saved, 1).unwrap();

    assert_eq!(halt_row_count(&fixture), 0);
    assert!(stored_halts(&fixture, &saved.thread_id).is_empty());
    let snapshot = fixture.store.load(ROOT, &owner()).unwrap();
    assert!(snapshot.halt_requests.is_empty());
}

#[test]
fn later_save_without_the_request_keeps_the_stored_record() {
    let fixture = Fixture::new();
    let mut saved = running_thread(0);
    save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);
    saved.turns[0].status = legacy::AgentTurnStatus::Stopped;
    saved.turns[0].ended_at_epoch_ms = Some(3);
    saved.turns[0].last_status_sequence = 2;

    fixture.store.save(ROOT, &owner(), &saved, 1).unwrap();

    assert_eq!(
        stored_halts(&fixture, &saved.thread_id),
        vec![interrupt_request(0)]
    );
}

#[test]
fn invalid_halt_requests_are_refused_before_anything_is_saved() {
    let far_future = legacy::MAX_AGENT_SAFE_INTEGER + 1;
    let refused: Vec<Vec<TurnHaltRequest>> = vec![
        vec![interrupt_request(1)],
        vec![interrupt_request(0), interrupt_request(0)],
        vec![interrupt_request(0), interrupt_request(1)],
        vec![escalated(
            hard_stop_request(0),
            TurnHaltEscalationSource::ThreadMenu,
        )],
        vec![TurnHaltRequest {
            requested_at_epoch_ms: far_future,
            ..interrupt_request(0)
        }],
        vec![TurnHaltRequest {
            escalation: Some(TurnHaltEscalation {
                source: TurnHaltEscalationSource::InterruptRefused,
                requested_at_epoch_ms: 999,
            }),
            ..interrupt_request(0)
        }],
        vec![TurnHaltRequest {
            escalation: Some(TurnHaltEscalation {
                source: TurnHaltEscalationSource::InterruptRefused,
                requested_at_epoch_ms: far_future,
            }),
            ..interrupt_request(0)
        }],
    ];
    for halts in refused {
        let fixture = Fixture::new();
        let saved = running_thread(0);

        let outcome = fixture
            .store
            .save_with_halt_requests(ROOT, &owner(), &saved, 0, &halts);

        assert!(outcome.is_err(), "{halts:?}");
        assert!(fixture
            .store
            .load(ROOT, &owner())
            .unwrap()
            .threads
            .is_empty());
        assert_eq!(halt_row_count(&fixture), 0);
    }
}

#[test]
fn duplicate_halt_requests_for_one_turn_are_refused() {
    let fixture = Fixture::new();
    let mut saved = running_thread(0);
    saved.turns.insert(0, turn(1));

    let outcome = fixture.store.save_with_halt_requests(
        ROOT,
        &owner(),
        &saved,
        0,
        &[interrupt_request(0), interrupt_request(0)],
    );

    assert!(outcome.is_err());
    assert!(fixture
        .store
        .load(ROOT, &owner())
        .unwrap()
        .threads
        .is_empty());
    assert_eq!(halt_row_count(&fixture), 0);
}

#[test]
fn halt_request_never_lands_on_another_threads_turn() {
    let fixture = Fixture::new();
    let first = running_thread(0);
    save_halted(&fixture, &first, 0, &[interrupt_request(0)]);
    let mut second = running_thread(1);
    second.thread_id = OTHER_THREAD.into();
    second.updated_at_epoch_ms = 3;

    let foreign =
        fixture
            .store
            .save_with_halt_requests(ROOT, &owner(), &second, 0, &[hard_stop_request(0)]);
    assert!(foreign.is_err());
    fixture.store.save(ROOT, &owner(), &second, 0).unwrap();

    assert!(stored_halts(&fixture, OTHER_THREAD).is_empty());
    assert_eq!(
        stored_halts(&fixture, &first.thread_id),
        vec![interrupt_request(0)]
    );
    let snapshot = fixture.store.load(ROOT, &owner()).unwrap();
    assert_eq!(snapshot.halt_requests.len(), 1);
    assert!(snapshot.halt_requests.contains_key(&first.thread_id));
}

#[test]
fn unknown_or_garbled_halt_rows_degrade_to_no_record_and_the_thread_still_loads() {
    let garbled = [
        "UPDATE turn_halt_requests SET source='triggerFromANewerBuild'",
        "UPDATE turn_halt_requests SET mode='pause'",
        "UPDATE turn_halt_requests SET source=7",
        "UPDATE turn_halt_requests SET requested_at='yesterday'",
        "UPDATE turn_halt_requests SET requested_at=-1",
        "UPDATE turn_halt_requests SET requested_at=9007199254740992",
        "UPDATE turn_halt_requests SET source=x'ff'",
    ];
    for statement in garbled {
        let fixture = Fixture::new();
        let saved = running_thread(0);
        save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);
        raw_history(&fixture).execute_batch(statement).unwrap();

        let snapshot = fixture.store.load(ROOT, &owner()).unwrap();

        assert_eq!(snapshot.threads[0].turns, saved.turns, "{statement}");
        assert!(snapshot.halt_requests.is_empty(), "{statement}");
        assert!(
            stored_halts(&fixture, &saved.thread_id).is_empty(),
            "{statement}"
        );
    }
}

#[test]
fn garbled_escalation_keeps_the_original_request() {
    let garbled = [
        "UPDATE turn_halt_requests SET escalated_source='triggerFromANewerBuild'",
        "UPDATE turn_halt_requests SET escalated_at=1",
        "UPDATE turn_halt_requests SET escalated_at='soon'",
        "UPDATE turn_halt_requests SET escalated_at=NULL",
    ];
    for statement in garbled {
        let fixture = Fixture::new();
        let saved = running_thread(0);
        let request = escalated(interrupt_request(0), TurnHaltEscalationSource::SessionDock);
        save_halted(&fixture, &saved, 0, &[request]);
        raw_history(&fixture).execute_batch(statement).unwrap();

        assert_eq!(
            stored_halts(&fixture, &saved.thread_id),
            vec![interrupt_request(0)],
            "{statement}"
        );
    }
}

#[test]
fn deleting_a_thread_removes_its_halt_records() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);
    assert_eq!(halt_row_count(&fixture), 1);

    fixture
        .store
        .delete(ROOT, &owner(), &saved.thread_id)
        .unwrap();

    assert_eq!(halt_row_count(&fixture), 0);
}

#[test]
fn replayed_save_is_acknowledged_only_with_the_same_halt_requests() {
    let fixture = Fixture::new();
    let saved = running_thread(0);
    save_halted(&fixture, &saved, 0, &[interrupt_request(0)]);

    let replayed =
        fixture
            .store
            .save_with_halt_requests(ROOT, &owner(), &saved, 0, &[interrupt_request(0)]);
    let changed = fixture.store.save(ROOT, &owner(), &saved, 0);

    assert_eq!(replayed.unwrap().revision, 1);
    assert!(changed.is_err());
}

const IMPORTED_SESSION: &str = "11111111-1111-4111-8111-111111111111";

fn imported_running_thread() -> AgentThread {
    let mut imported: AgentThread = serde_json::from_value(json!({"threadId":"agt-thread-0001","owner":{"rootKey":ROOT,"ownerId":owner(),"repositoryRoot":ROOT},"target":{"isolation":"in-place","worktreePath":null},"provider":{"kind":"claudeCode","sessionId":IMPORTED_SESSION},"title":"Imported","pinned":false,"archived":false,"createdAtEpochMs":1,"updatedAtEpochMs":2,"turns":[],"turnsTruncated":false,"externalOrigin":{"provider":"claudeCode","sessionId":IMPORTED_SESSION,"importedAtEpochMs":2}})).unwrap();
    imported.turns = vec![running_turn(0)];
    imported
}

#[test]
fn halt_request_of_an_imported_thread_survives_restart_on_the_import_lookup() {
    let fixture = Fixture::new();
    let saved = imported_running_thread();
    let request = escalated(
        interrupt_request(0),
        TurnHaltEscalationSource::ComposerStopButton,
    );
    save_halted(&fixture, &saved, 0, std::slice::from_ref(&request));

    let found = AgentHistoryStore::new(fixture.base.clone())
        .find_import(
            ROOT,
            &owner(),
            crate::agent_task_spawner::AgentCliInvocation::ClaudeCode,
            IMPORTED_SESSION,
            ROOT,
        )
        .unwrap()
        .expect("the imported thread");

    assert_eq!(found.thread.turns, saved.turns);
    assert_eq!(found.halt_requests, vec![request.clone()]);
    assert_eq!(
        serde_json::to_value(&found).unwrap()["haltRequests"],
        json!([request])
    );
}

const TURN_PAGE_BUDGET: usize = MAX_PAGE_BYTES - 1024;
const LATER_TURN_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const FULL_EVENT_TEXT_BYTES: usize = 16 * 1024;

fn text_event(bytes: usize) -> legacy::AgentTurnEvent {
    legacy::AgentTurnEvent::AssistantText {
        text: "a".repeat(bytes),
        parent_tool_id: None,
    }
}

fn payload_bytes(sized: &AgentTurn) -> usize {
    serde_json::to_string(sized).unwrap().len()
}

fn turn_with_payload_bytes(index: usize, bytes: usize) -> AgentTurn {
    let mut sized = turn(index);
    sized.events = vec![text_event(1), text_event(1)];
    let base = payload_bytes(&sized);
    sized.events.push(text_event(FULL_EVENT_TEXT_BYTES));
    let full_event = payload_bytes(&sized) - base;
    let full_events = (bytes - base) / full_event;
    sized
        .events
        .resize(2 + full_events, text_event(FULL_EVENT_TEXT_BYTES));
    let slack = bytes - payload_bytes(&sized);
    let first = slack.min(FULL_EVENT_TEXT_BYTES - 1);
    sized.events[0] = text_event(1 + first);
    sized.events[1] = text_event(1 + slack - first);
    assert_eq!(payload_bytes(&sized), bytes);
    sized
}

struct TwoTurnPage {
    fixture: Fixture,
    thread: AgentThread,
    halt: TurnHaltRequest,
    halt_bytes: usize,
}

impl TwoTurnPage {
    fn with_total_payload_bytes(total: usize) -> Self {
        let fixture = Fixture::new();
        let mut thread = thread();
        let halt = interrupt_request(1);
        thread.turns = vec![turn_with_payload_bytes(0, total - LATER_TURN_PAYLOAD_BYTES)];
        fixture.store.save(ROOT, &owner(), &thread, 0).unwrap();
        thread.turns = vec![turn_with_payload_bytes(1, LATER_TURN_PAYLOAD_BYTES)];
        fixture.store.save(ROOT, &owner(), &thread, 1).unwrap();
        Self {
            fixture,
            thread,
            halt_bytes: halt_requests::wire_bytes(std::slice::from_ref(&halt)),
            halt,
        }
    }

    fn record_halt(&self) {
        save_halted(
            &self.fixture,
            &self.thread,
            2,
            std::slice::from_ref(&self.halt),
        );
    }

    fn page(&self, before: Option<&str>) -> TurnPage {
        self.fixture
            .store
            .read_turns(ROOT, &owner(), &self.thread.thread_id, before)
            .unwrap()
    }
}

fn page_turn_ids(page: &TurnPage) -> Vec<String> {
    page.turns.iter().map(|turn| turn.turn_id.clone()).collect()
}

#[test]
fn page_that_fits_only_without_its_halt_record_splits_once_the_record_is_stored() {
    let scene = TwoTurnPage::with_total_payload_bytes(TURN_PAGE_BUDGET - 2);
    assert!(scene.halt_bytes > 0);
    let whole = scene.page(None);
    assert_eq!(page_turn_ids(&whole), vec![turn_id(0), turn_id(1)]);
    assert!(!whole.has_earlier);

    scene.record_halt();

    let latest = scene.page(None);
    assert_eq!(page_turn_ids(&latest), vec![turn_id(1)]);
    assert!(latest.has_earlier);
    assert_eq!(latest.before_turn_id, Some(turn_id(1)));
    assert_eq!(latest.halt_requests, vec![scene.halt.clone()]);
    let earlier = scene.page(latest.before_turn_id.as_deref());
    assert_eq!(page_turn_ids(&earlier), vec![turn_id(0)]);
    assert!(!earlier.has_earlier);
    assert!(earlier.halt_requests.is_empty());
}

#[test]
fn halt_record_bytes_count_against_the_page_budget_to_the_exact_byte() {
    let halt_bytes = halt_requests::wire_bytes(&[interrupt_request(1)]);

    let exact = TwoTurnPage::with_total_payload_bytes(TURN_PAGE_BUDGET - 2 - halt_bytes);
    exact.record_halt();
    let fitting = exact.page(None);
    assert_eq!(page_turn_ids(&fitting), vec![turn_id(0), turn_id(1)]);
    assert!(!fitting.has_earlier);
    assert_eq!(fitting.halt_requests, vec![exact.halt.clone()]);

    let over = TwoTurnPage::with_total_payload_bytes(TURN_PAGE_BUDGET - 1 - halt_bytes);
    assert_eq!(page_turn_ids(&over.page(None)).len(), 2);
    over.record_halt();
    let split = over.page(None);
    assert_eq!(page_turn_ids(&split), vec![turn_id(1)]);
    assert!(split.has_earlier);
    assert_eq!(split.halt_requests, vec![over.halt.clone()]);
}

const WIRE: &str = include_str!("../../../contracts/agent-turn-halt-request-wire.json");

fn wire_list(key: &str) -> Vec<serde_json::Value> {
    let wire: serde_json::Value = serde_json::from_str(WIRE).unwrap();
    wire[key].as_array().unwrap().clone()
}

#[test]
fn halt_request_wire_contract_matches_the_shared_fixture() {
    let sources = [
        TurnHaltSource::ComposerStopButton,
        TurnHaltSource::ComposerEscape,
        TurnHaltSource::StopConfirmationBanner,
        TurnHaltSource::SessionDock,
        TurnHaltSource::ThreadMenu,
    ];
    let escalation_sources = [
        TurnHaltEscalationSource::ComposerStopButton,
        TurnHaltEscalationSource::ComposerEscape,
        TurnHaltEscalationSource::StopConfirmationBanner,
        TurnHaltEscalationSource::SessionDock,
        TurnHaltEscalationSource::ThreadMenu,
        TurnHaltEscalationSource::InterruptRefused,
    ];
    let modes = [TurnHaltMode::SoftInterrupt, TurnHaltMode::HardStop];
    assert_eq!(json!(sources), json!(wire_list("sources")));
    assert_eq!(
        json!(escalation_sources),
        json!(wire_list("escalationSources"))
    );
    assert_eq!(json!(modes), json!(wire_list("modes")));

    for wire in wire_list("valid") {
        let request: TurnHaltRequest = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&request).unwrap(), wire);
        let fixture = Fixture::new();
        save_halted(
            &fixture,
            &running_thread(0),
            0,
            std::slice::from_ref(&request),
        );
        assert_eq!(stored_halts(&fixture, "agt-thread-0001"), vec![request]);
    }
    for wire in wire_list("invalid") {
        assert!(
            serde_json::from_value::<TurnHaltRequest>(wire.clone()).is_err(),
            "{wire}"
        );
    }
}

#[test]
fn incoherent_escalations_from_the_shared_fixture_never_reach_the_store() {
    for wire in wire_list("invalidEscalation") {
        let Ok(request) = serde_json::from_value::<TurnHaltRequest>(wire.clone()) else {
            continue;
        };
        let fixture = Fixture::new();
        let outcome = fixture.store.save_with_halt_requests(
            ROOT,
            &owner(),
            &running_thread(0),
            0,
            &[request],
        );
        assert!(outcome.is_err(), "{wire}");
    }
}
