use super::*;
use crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;

const INIT: &[u8] =
    b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-abcdefgh\"}\n";
const KEEP_ALIVE: &[u8] = b"{\"type\":\"keep_alive\"}\n";
const TASK_STARTED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"bg-1\",\"task_type\":\"local_bash\",\"is_backgrounded\":true,\"session_id\":\"sess-abcdefgh\"}\n";
const TASKS_LISTED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[{\"task_id\":\"bg-1\",\"task_type\":\"local_bash\"}],\"session_id\":\"sess-abcdefgh\"}\n";
const TASKS_EMPTIED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[],\"session_id\":\"sess-abcdefgh\"}\n";
const TASK_UPDATED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"bg-1\",\"patch\":{\"status\":\"completed\"},\"session_id\":\"sess-abcdefgh\"}\n";
const TASK_NOTIFIED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"bg-1\",\"status\":\"completed\",\"session_id\":\"sess-abcdefgh\"}\n";
const FAILED: &[u8] = b"{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true,\"session_id\":\"sess-abcdefgh\"}\n";

fn line(value: serde_json::Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    bytes
}

fn lifecycle(id: &str, state: &str) -> Vec<u8> {
    line(serde_json::json!({"type":"command_lifecycle","command_uuid":id,"state":state}))
}

fn assistant(text: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"text","text":text}]}
    }))
}

fn result(uuid: Option<&str>, cost: f64, text: &str) -> Vec<u8> {
    let mut value = serde_json::json!({
        "type":"result",
        "subtype":"success",
        "is_error":false,
        "result":text,
        "num_turns":1,
        "total_cost_usd":cost,
        "session_id":"sess-abcdefgh",
        "result_index":1
    });
    let Some(id) = uuid else {
        value["origin"] = serde_json::json!({"kind":"task-notification"});
        return line(value);
    };
    value["user_message_uuid"] = serde_json::json!(id);
    value["user_message_uuids"] = serde_json::json!([id]);
    line(value)
}

fn null_uuid_result(cost: f64, text: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"result",
        "subtype":"success",
        "result":text,
        "num_turns":1,
        "total_cost_usd":cost,
        "session_id":"sess-abcdefgh",
        "user_message_uuid":null
    }))
}

fn interrupted_result(id: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"result",
        "subtype":"error_during_execution",
        "is_error":true,
        "session_id":"sess-abcdefgh",
        "user_message_uuid":id,
        "user_message_uuids":[id]
    }))
}

fn task_started(id: &str, backgrounded: bool) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system",
        "subtype":"task_started",
        "task_id":id,
        "task_type":"local_bash",
        "is_backgrounded":backgrounded,
        "session_id":"sess-abcdefgh"
    }))
}

fn task_finished(id: &str, status: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system",
        "subtype":"task_notification",
        "task_id":id,
        "status":status,
        "session_id":"sess-abcdefgh"
    }))
}

fn acknowledgement(request_id: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"control_response",
        "response":{"subtype":"success","request_id":request_id,"response":{"still_queued":[]}}
    }))
}

fn legacy_result() -> Vec<u8> {
    line(serde_json::json!({
        "type":"result",
        "subtype":"success",
        "num_turns":1,
        "session_id":"sess-abcdefgh"
    }))
}

fn attach(router: &mut ClaudeSessionRouter) -> (Arc<ClaudeInputLifecycle>, String) {
    let ledger = Arc::new(ClaudeInputLifecycle::new());
    let id = ledger.initial_command_id().to_string();
    router.attach(Arc::clone(&ledger));
    (ledger, id)
}

#[derive(Default)]
struct Collected {
    turn: Vec<u8>,
    settles: usize,
    acknowledgements: usize,
    unowned: bool,
    background: Vec<ClaudeBackgroundTurn>,
    background_changes: usize,
    failure: Option<&'static str>,
}

impl Collected {
    fn absorb(&mut self, step: RouterStep) {
        self.turn.extend_from_slice(&step.turn_output);
        self.settles += usize::from(step.settled);
        self.acknowledgements += usize::from(step.interrupt_acknowledged);
        self.unowned |= step.unowned_activity;
        self.background.extend(step.background_turns);
        self.background_changes += usize::from(step.background_tasks.is_some());
        self.failure = self.failure.or(step.failure);
    }
}

fn feed_all(router: &mut ClaudeSessionRouter, lines: &[&[u8]]) -> Collected {
    let mut collected = Collected::default();
    for bytes in lines {
        collected.absorb(router.feed(bytes));
    }
    collected
}

fn lines_of(bytes: &[u8]) -> Vec<serde_json::Value> {
    bytes
        .split_inclusive(|byte| *byte == b'\n')
        .map(|line| serde_json::from_slice(line).expect("routed json line"))
        .collect()
}

fn lines_of_bytes(bytes: &[u8]) -> Vec<&[u8]> {
    bytes.split_inclusive(|byte| *byte == b'\n').collect()
}

fn turn_stream(id: &str, cost: f64, text: &str) -> Vec<u8> {
    [
        lifecycle(id, "queued"),
        lifecycle(id, "started"),
        INIT.to_vec(),
        assistant(text),
        result(Some(id), cost, text),
        lifecycle(id, "completed"),
        KEEP_ALIVE.to_vec(),
    ]
    .concat()
}

fn run_split(ledgers: &[Arc<ClaudeInputLifecycle>; 2], split: [usize; 2]) -> [Collected; 2] {
    let mut router = ClaudeSessionRouter::new();
    let mut runs: [Collected; 2] = Default::default();
    for (index, ledger) in ledgers.iter().enumerate() {
        router.attach(Arc::clone(ledger));
        let id = ledger.initial_command_id();
        let stream = turn_stream(id, 0.25 * (index + 1) as f64, "ONE");
        let cut = split[index].min(stream.len());
        runs[index].absorb(router.feed(&stream[..cut]));
        runs[index].absorb(router.feed(&stream[cut..]));
    }
    runs
}

#[test]
fn every_chunk_split_of_a_two_turn_stream_routes_identical_turn_output_once() {
    let ledgers = [
        Arc::new(ClaudeInputLifecycle::new()),
        Arc::new(ClaudeInputLifecycle::new()),
    ];
    let reference = run_split(&ledgers, [0, 0]);
    for (index, run) in reference.iter().enumerate() {
        let id = ledgers[index].initial_command_id();
        let lines = lines_of(&run.turn);
        assert_eq!(run.settles, 1);
        assert_eq!(lines.len(), 5, "queued, started, init, assistant, result");
        assert_eq!(lines[0]["state"], "queued");
        assert_eq!(lines[4]["type"], "result");
        assert_eq!(lines[4]["user_message_uuid"], id);
        assert_eq!(lines[4]["total_cost_usd"], 0.25);
        assert!(run.background.is_empty());
    }
    let length = turn_stream(ledgers[0].initial_command_id(), 0.25, "ONE").len();
    for turn in 0..2 {
        for split in 0..=length {
            let mut cuts = [0, 0];
            cuts[turn] = split;
            let runs = run_split(&ledgers, cuts);
            for index in 0..2 {
                assert_eq!(
                    runs[index].turn, reference[index].turn,
                    "turn {turn} split {split}"
                );
                assert_eq!(runs[index].settles, 1, "turn {turn} split {split}");
            }
        }
    }
}

#[test]
fn native_background_work_settles_at_the_drain_and_the_unprompted_turn_is_background() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let started = lifecycle(&id, "started");
    let reply = assistant("STARTED");
    let own_result = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(
        &mut router,
        &[
            &queued,
            &started,
            INIT,
            TASKS_LISTED,
            TASK_STARTED,
            &reply,
            &own_result,
            &completed,
        ],
    );
    assert_eq!(turn.settles, 0);
    assert_eq!(router.live_background_tasks(), 1);
    let emptied = router.feed(TASKS_EMPTIED);
    assert!(!emptied.settled);
    assert_eq!(emptied.turn_output, TASKS_EMPTIED);
    let drained = router.feed(TASK_UPDATED);
    assert!(drained.settled);
    assert_eq!(drained.turn_output, TASK_UPDATED);
    assert_eq!(router.live_background_tasks(), 0);
    let unprompted_reply = assistant("background-finished");
    let unprompted_result = result(None, 0.5, "background-finished");
    let after = feed_all(
        &mut router,
        &[TASK_NOTIFIED, INIT, &unprompted_reply, &unprompted_result],
    );
    assert_eq!(after.settles, 0);
    assert!(after.turn.is_empty());
    assert!(!after.unowned);
    assert_eq!(after.background.len(), 1);
    let background = &after.background[0];
    assert!(background.complete);
    assert!(!background.truncated);
    let lines = lines_of(&background.output);
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0]["subtype"], "init");
    assert_eq!(lines[2]["result"], "background-finished");
    let everything = [turn.turn, emptied.turn_output, drained.turn_output].concat();
    assert!(!String::from_utf8_lossy(&everything).contains("background-finished"));
}

#[test]
fn an_unprompted_turn_racing_our_start_is_background_and_our_turn_still_settles() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    let stream = turn_stream(first.initial_command_id(), 0.25, "ONE");
    assert!(router.feed(&stream).settled);
    let (ledger, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let unprompted_reply = assistant("background-finished");
    let unprompted_result = result(None, 0.5, "background-finished");
    let raced = feed_all(
        &mut router,
        &[&queued, INIT, &unprompted_reply, &unprompted_result],
    );
    assert_eq!(raced.settles, 0);
    assert_eq!(raced.turn, queued);
    assert_eq!(raced.background.len(), 1);
    assert!(raced.background[0].complete);
    let (steer, _) = ledger
        .reserve(b"{}\n")
        .expect("the unprompted turn never closed our ledger");
    ledger.abandon(&steer);
    let rest = turn_stream(&id, 1.0, "TWO");
    let rest = &rest[queued.len()..];
    let own = feed_all(&mut router, &[rest]);
    assert_eq!(own.settles, 1);
    assert!(own.background.is_empty());
    let text = String::from_utf8_lossy(&own.turn).into_owned();
    assert!(text.contains("TWO"));
    assert!(!text.contains("background-finished"));
}

#[test]
fn our_start_ends_an_active_unprompted_turn_as_incomplete() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let (_, id) = attach(&mut router);
    let unprompted_reply = assistant("background-finished");
    let queued = lifecycle(&id, "queued");
    let started = lifecycle(&id, "started");
    let raced = feed_all(&mut router, &[INIT, &unprompted_reply, &queued]);
    assert!(raced.background.is_empty());
    assert_eq!(raced.turn, queued);
    let step = router.feed(&started);
    assert_eq!(step.turn_output, started);
    assert_eq!(step.background_turns.len(), 1);
    assert!(!step.background_turns[0].complete);
    assert_eq!(
        step.background_turns[0].output,
        [INIT, unprompted_reply.as_slice()].concat()
    );
    let reply = assistant("TWO");
    assert!(router.feed(&reply).turn_output == reply);
}

#[test]
fn a_null_uuid_result_while_owned_never_settles_the_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let started = lifecycle(&id, "started");
    let reply = assistant("ONE");
    let unprompted = null_uuid_result(0.25, "ONE");
    let collected = feed_all(&mut router, &[&queued, &started, INIT, &reply, &unprompted]);
    assert_eq!(collected.settles, 0);
    assert_eq!(collected.background.len(), 1);
    assert!(collected.background[0].complete);
    assert_eq!(lines_of(&collected.background[0].output).len(), 1);
    assert!(!String::from_utf8_lossy(&collected.turn).contains("\"result\""));
    assert!(router.feed(&result(Some(&id), 0.5, "ONE")).settled);
}

#[test]
fn idle_root_control_request_is_unowned_activity() {
    let mut router = ClaudeSessionRouter::new();
    let step = router.feed(
        b"{\"type\":\"control_request\",\"request_id\":\"r1\",\"request\":{\"subtype\":\"can_use_tool\"}}\n",
    );
    assert!(step.unowned_activity);
    assert!(step.turn_output.is_empty());
    assert!(step.background_turns.is_empty());
}

#[test]
fn idle_metadata_is_dropped_without_unowned_activity() {
    let mut router = ClaudeSessionRouter::new();
    let stale = lifecycle("stale-command", "completed");
    for benign in [TASK_NOTIFIED, KEEP_ALIVE, TASKS_EMPTIED, stale.as_slice()] {
        let step = router.feed(benign);
        assert_eq!(step, RouterStep::default());
    }
}

#[test]
fn foreign_lifecycle_frames_are_dropped_while_attached() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = attach(&mut router);
    let started = lifecycle(&id, "started");
    assert_eq!(router.feed(&started).turn_output, started);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    let steer_started = lifecycle(&steer, "started");
    assert_eq!(router.feed(&steer_started).turn_output, steer_started);
    assert!(router
        .feed(&lifecycle("foreign", "started"))
        .turn_output
        .is_empty());
}

#[test]
fn interrupt_acknowledgement_matches_only_the_pending_request() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    router.interrupt_sent("req-1".to_string());
    let foreign = b"{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"req-2\"}}\n";
    let own = b"{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"req-1\",\"response\":{\"still_queued\":[]}}}\n";
    assert!(!router.feed(foreign).interrupt_acknowledged);
    let step = router.feed(own);
    assert!(step.interrupt_acknowledged);
    assert_eq!(step.turn_output, own);
    assert!(
        !router.feed(own).interrupt_acknowledged,
        "acknowledged once"
    );
}

#[test]
fn an_interrupted_failed_result_settles_the_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, _) = attach(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = b"{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"req-1\"}}\n";
    let collected = feed_all(&mut router, &[&[ack.as_slice(), FAILED].concat()]);
    assert_eq!(collected.acknowledgements, 1);
    assert_eq!(collected.settles, 1);
}

#[test]
fn cost_is_rewritten_to_per_result_deltas_across_turns_and_background_turns() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    let one = router.feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"));
    let unprompted = feed_all(&mut router, &[INIT, &result(None, 0.5, "BG")]);
    let (second, _) = attach(&mut router);
    let two = router.feed(&turn_stream(second.initial_command_id(), 1.0, "TWO"));
    let one = lines_of(&one.turn_output).pop().unwrap();
    let background = lines_of(&unprompted.background[0].output).pop().unwrap();
    let two = lines_of(&two.turn_output).pop().unwrap();
    let deltas: Vec<f64> = [&one, &background, &two]
        .iter()
        .map(|line| line["total_cost_usd"].as_f64().unwrap())
        .collect();
    assert_eq!(deltas, vec![0.25, 0.25, 0.5]);
    assert_eq!(deltas.iter().sum::<f64>(), 1.0);
    assert_eq!(two["codevo_process_total_cost_usd"], 1.0);
    assert_eq!(background["codevo_process_total_cost_usd"], 0.5);
    let (third, _) = attach(&mut router);
    let lower = router.feed(&turn_stream(third.initial_command_id(), 0.75, "THREE"));
    let lower = lines_of(&lower.turn_output).pop().unwrap();
    assert!(lower.get("total_cost_usd").is_none());
    assert_eq!(lower["codevo_process_total_cost_usd"], 0.75);
    let (fourth, _) = attach(&mut router);
    let next = router.feed(&turn_stream(fourth.initial_command_id(), 1.0, "FOUR"));
    let next = lines_of(&next.turn_output).pop().unwrap();
    assert_eq!(next["total_cost_usd"], 0.25);
}

#[test]
fn results_without_a_usable_cost_are_forwarded_verbatim() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    let reply = assistant("ONE");
    let plain = legacy_result();
    let collected = feed_all(&mut router, &[&reply, &plain]);
    assert_eq!(collected.settles, 1);
    assert_eq!(collected.turn, [reply, plain].concat());
}

#[test]
fn an_oversized_assistant_line_streams_to_the_owned_turn() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    let mut line = b"{\"type\":\"assistant\",\"message\":\"".to_vec();
    line.resize(MAX_ROUTED_LINE_BYTES + 4096, b'x');
    line.extend_from_slice(b"\"}\n");
    let mut collected = Collected::default();
    for chunk in line.chunks(64 * 1024) {
        collected.absorb(router.feed(chunk));
    }
    assert!(collected.failure.is_none());
    assert_eq!(collected.turn, line);
    assert!(router.feed(&legacy_result()).settled);
}

#[test]
fn an_oversized_idle_line_is_dropped_whole() {
    let mut router = ClaudeSessionRouter::new();
    let mut line = b"{\"type\":\"assistant\",\"message\":\"".to_vec();
    line.resize(MAX_ROUTED_LINE_BYTES + 16, b'x');
    line.extend_from_slice(b"\"}\n");
    let step = router.feed(&[line.as_slice(), KEEP_ALIVE].concat());
    assert_eq!(step, RouterStep::default());
}

#[test]
fn an_oversized_lifecycle_line_is_a_protocol_failure() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    let mut line = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"pad\":\"".to_vec();
    line.resize(MAX_ROUTED_LINE_BYTES + 16, b'x');
    let step = router.feed(&line);
    assert!(step.failure.is_some());
    assert!(step.turn_output.is_empty());
}

#[test]
fn background_turns_keep_whole_lines_within_their_byte_cap() {
    let mut router = ClaudeSessionRouter::new();
    let filler = assistant(&"y".repeat(40 * 1024));
    let mut lines: Vec<&[u8]> = vec![INIT];
    lines.extend(std::iter::repeat_n(filler.as_slice(), 8));
    let closing = result(None, 0.5, &"z".repeat(60 * 1024));
    lines.push(&closing);
    let collected = feed_all(&mut router, &lines);
    assert_eq!(collected.background.len(), 1);
    let background = &collected.background[0];
    assert!(background.truncated);
    assert!(background.complete);
    assert!(background.output.len() <= MAX_BACKGROUND_TURN_BYTES);
    let routed = lines_of(&background.output);
    let last = routed.last().unwrap();
    assert_eq!(
        last["type"], "result",
        "the closing result keeps its reserve"
    );
    assert_eq!(last["total_cost_usd"], 0.5);
    let body = background.output.len() - lines_of_bytes(&background.output).last().unwrap().len();
    assert!(body <= MAX_BACKGROUND_TURN_BYTES - BACKGROUND_RESULT_RESERVE_BYTES);
}

#[test]
fn finish_emits_an_active_unprompted_turn_as_incomplete() {
    let mut router = ClaudeSessionRouter::new();
    let reply = assistant("background-finished");
    let started = feed_all(&mut router, &[INIT, &reply]);
    assert!(started.background.is_empty());
    let step = router.finish();
    assert_eq!(step.background_turns.len(), 1);
    assert!(!step.background_turns[0].complete);
    assert_eq!(
        step.background_turns[0].output,
        [INIT, reply.as_slice()].concat()
    );
    assert!(router.finish().background_turns.is_empty());
}

#[test]
fn finish_forwards_a_trailing_partial_line_to_the_owned_turn() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    let partial = b"{\"type\":\"assistant\",\"message\":";
    assert!(router.feed(partial).turn_output.is_empty());
    assert_eq!(router.finish().turn_output, partial);
}

#[test]
fn reattach_after_settlement_starts_a_fresh_turn_boundary() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    assert!(router.feed(&legacy_result()).settled);
    assert_eq!(router.conversation(), Some("sess-abcdefgh"));
    attach(&mut router);
    let reply = assistant("TWO");
    let step = router.feed(&reply);
    assert_eq!(step.turn_output, reply);
    assert!(!step.settled);
    assert!(router.feed(&legacy_result()).settled);
}

#[test]
fn detach_returns_the_router_to_idle() {
    let mut router = ClaudeSessionRouter::new();
    attach(&mut router);
    router.detach();
    let step = router.feed(
        b"{\"type\":\"control_request\",\"request_id\":\"r1\",\"request\":{\"subtype\":\"can_use_tool\"}}\n",
    );
    assert!(step.unowned_activity);
}

fn owned_turn(router: &mut ClaudeSessionRouter) -> (Arc<ClaudeInputLifecycle>, String) {
    let (ledger, id) = attach(router);
    let queued = lifecycle(&id, "queued");
    let started = lifecycle(&id, "started");
    feed_all(router, &[&queued, &started, INIT]);
    (ledger, id)
}

#[test]
fn a_real_unprompted_result_while_owned_never_lands_in_our_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let bg = task_started("bg-1", true);
    let reply = assistant("STARTED");
    let own = result(Some(&id), 0.25, "STARTED");
    let unprompted = result(None, 0.5, "background-finished");
    let collected = feed_all(&mut router, &[&bg, &reply, &own, &unprompted]);
    assert_eq!(collected.settles, 0);
    assert_eq!(collected.background.len(), 1);
    assert!(!String::from_utf8_lossy(&collected.turn).contains("background-finished"));
    assert!(router.feed(TASK_UPDATED).settled);
}

#[test]
fn an_unprompted_turn_while_waiting_on_another_task_is_background() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let first = task_started("t1", true);
    let second = task_started("t2", true);
    let reply = assistant("STARTED");
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let first_done = task_finished("t1", "completed");
    let unprompted_reply = assistant("bg-t1-finished");
    let unprompted = result(None, 0.5, "bg-t1-finished");
    let collected = feed_all(
        &mut router,
        &[
            &first,
            &second,
            &reply,
            &own,
            &completed,
            &first_done,
            INIT,
            &unprompted_reply,
            &unprompted,
        ],
    );
    assert_eq!(collected.settles, 0);
    assert_eq!(collected.background.len(), 1);
    assert!(collected.background[0].complete);
    assert_eq!(lines_of(&collected.background[0].output).len(), 3);
    assert!(!String::from_utf8_lossy(&collected.turn).contains("bg-t1-finished"));
    let drained = router.feed(&task_finished("t2", "completed"));
    assert!(drained.settled);
}

#[test]
fn a_drain_inside_an_unprompted_turn_settles_ours_when_it_closes() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let first = task_started("t1", true);
    let second = task_started("t2", true);
    let own = result(Some(&id), 0.25, "STARTED");
    let first_done = task_finished("t1", "completed");
    let second_done = task_finished("t2", "completed");
    let unprompted_reply = assistant("bg-t1-finished");
    let before = feed_all(
        &mut router,
        &[
            &first,
            &second,
            &own,
            &first_done,
            INIT,
            &unprompted_reply,
            &second_done,
        ],
    );
    assert_eq!(before.settles, 0);
    let closing = router.feed(&result(None, 0.5, "bg-t1-finished"));
    assert!(closing.settled);
    assert!(closing.turn_output.is_empty());
    assert_eq!(closing.background_turns.len(), 1);
    assert!(closing.background_turns[0].complete);
}

#[test]
fn a_steer_start_keeps_its_init_in_our_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    let reply = assistant("ONE");
    let own = result(Some(&id), 0.25, "ONE");
    let steer_queued = lifecycle(&steer, "queued");
    let steer_started = lifecycle(&steer, "started");
    let steer_reply = assistant("STEERED");
    let steer_result = result(Some(&steer), 0.5, "STEERED");
    let steer_completed = lifecycle(&steer, "completed");
    let collected = feed_all(
        &mut router,
        &[
            &reply,
            &steer_queued,
            &own,
            &steer_started,
            INIT,
            &steer_reply,
            &steer_result,
            &steer_completed,
        ],
    );
    assert_eq!(collected.settles, 1);
    assert!(collected.background.is_empty());
    assert!(String::from_utf8_lossy(&collected.turn).contains("STEERED"));
}

#[test]
fn a_result_naming_our_command_ends_an_unprompted_turn_and_settles_ours() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let early = feed_all(&mut router, &[INIT]);
    assert!(early.background.is_empty());
    let (_, id) = attach(&mut router);
    let folded = line(serde_json::json!({
        "type":"result",
        "subtype":"success",
        "result":"TWO",
        "num_turns":2,
        "session_id":"sess-abcdefgh",
        "user_message_uuid":null,
        "user_message_uuids":[id.clone()]
    }));
    let queued = lifecycle(&id, "queued");
    let reply = assistant("TWO");
    let collected = feed_all(&mut router, &[&assistant("bg"), &queued, &reply, &folded]);
    assert_eq!(collected.settles, 1);
    assert_eq!(collected.background.len(), 1);
    assert!(!collected.background[0].complete);
    assert!(String::from_utf8_lossy(&collected.turn).contains("TWO"));
}

#[test]
fn an_interrupt_ack_settles_a_turn_whose_queued_steer_was_abandoned() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let reply = assistant("ONE");
    router.feed(&reply);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    let steer_queued = lifecycle(&steer, "queued");
    let own = result(Some(&id), 0.25, "ONE");
    let completed = lifecycle(&id, "completed");
    let before = feed_all(&mut router, &[&steer_queued, &own, &completed]);
    assert_eq!(before.settles, 0);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = router.feed(&acknowledgement("req-1"));
    assert!(ack.interrupt_acknowledged);
    assert!(ack.settled);
    let late = router.feed(&lifecycle(&steer, "cancelled"));
    assert!(!late.settled);
    assert!(late.turn_output.is_empty());
}

#[test]
fn an_interrupt_during_a_steer_settles_on_the_interrupted_result() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    let reply = assistant("ONE");
    let own = result(Some(&id), 0.25, "ONE");
    let steer_started = lifecycle(&steer, "started");
    let bash = task_started("fg-1", false);
    let before = feed_all(&mut router, &[&reply, &own, &steer_started, INIT, &bash]);
    assert_eq!(before.settles, 0);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let stopped = task_finished("fg-1", "stopped");
    let tool = line(serde_json::json!({
        "type":"user",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}
    }));
    let middle = feed_all(&mut router, &[&acknowledgement("req-1"), &stopped, &tool]);
    assert_eq!(middle.acknowledgements, 1);
    assert_eq!(middle.settles, 0, "the stopped notice alone never settles");
    let failed = interrupted_result(&steer);
    let end = router.feed(&failed);
    assert!(end.settled);
    assert!(end.background_turns.is_empty());
    assert_eq!(
        lines_of(&end.turn_output)[0]["subtype"],
        "error_during_execution"
    );
}

#[test]
fn a_stale_steer_running_after_an_interrupt_never_touches_the_next_ledger() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    router.feed(&lifecycle(&steer, "queued"));
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let first = feed_all(
        &mut router,
        &[&acknowledgement("req-1"), &interrupted_result(&id)],
    );
    assert_eq!(first.settles, 1);
    let (next, next_id) = attach(&mut router);
    let stale_reply = assistant("steer-reply");
    let stale = feed_all(
        &mut router,
        &[
            &lifecycle(&id, "cancelled"),
            &lifecycle(&steer, "started"),
            INIT,
            &stale_reply,
            &result(Some(&steer), 0.5, "steer-reply"),
            &lifecycle(&steer, "completed"),
            &lifecycle(&next_id, "queued"),
        ],
    );
    assert_eq!(stale.settles, 0);
    assert_eq!(stale.background.len(), 1);
    assert!(!String::from_utf8_lossy(&stale.turn).contains("steer-reply"));
    let (probe, _) = next.reserve(b"{}\n").expect("next ledger stays open");
    next.abandon(&probe);
    let started = lifecycle(&next_id, "started");
    let reply = assistant("TWO");
    let own = feed_all(
        &mut router,
        &[&started, INIT, &reply, &result(Some(&next_id), 0.75, "TWO")],
    );
    assert_eq!(own.settles, 1);
}

#[test]
fn an_interrupted_result_settles_even_while_native_tasks_stay_live() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let native = task_started("t1", true);
    let foreground = task_started("fg", false);
    let reply = assistant("working");
    feed_all(&mut router, &[&native, &reply, &foreground]);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let before = feed_all(
        &mut router,
        &[&acknowledgement("req-1"), &task_finished("fg", "stopped")],
    );
    assert_eq!(before.settles, 0);
    let end = router.feed(&interrupted_result(&id));
    assert!(end.settled);
    assert_eq!(router.live_background_tasks(), 1);
    let unprompted_reply = assistant("bg-t1");
    let after = feed_all(
        &mut router,
        &[
            &lifecycle(&id, "cancelled"),
            &task_finished("t1", "completed"),
            INIT,
            &unprompted_reply,
            &result(None, 0.5, "bg-t1"),
        ],
    );
    assert_eq!(after.settles, 0);
    assert!(after.turn.is_empty());
    assert_eq!(after.background.len(), 1);
    assert!(after.background[0].complete);
}

#[test]
fn an_interrupt_after_our_result_settles_at_the_ack_while_native_tasks_stay_live() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let native = task_started("t1", true);
    let own = result(Some(&id), 0.25, "S");
    let completed = lifecycle(&id, "completed");
    let before = feed_all(&mut router, &[&native, &own, &completed]);
    assert_eq!(before.settles, 0);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = router.feed(&acknowledgement("req-1"));
    assert!(ack.interrupt_acknowledged);
    assert!(ack.settled);
    assert_eq!(router.live_background_tasks(), 1);
}

#[test]
fn a_result_naming_our_turn_clears_an_expected_init() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let first = task_started("t1", true);
    let second = task_started("t2", true);
    let reply = assistant("A");
    feed_all(&mut router, &[&first, &second, &reply]);
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    let folded = line(serde_json::json!({
        "type":"result",
        "subtype":"success",
        "result":"B",
        "num_turns":2,
        "total_cost_usd":0.25,
        "session_id":"sess-abcdefgh",
        "user_message_uuid":id,
        "user_message_uuids":[id.clone(), steer.clone()]
    }));
    let steered = assistant("B");
    let unprompted_reply = assistant("bg-t1");
    let collected = feed_all(
        &mut router,
        &[
            &lifecycle(&steer, "queued"),
            &lifecycle(&steer, "started"),
            &steered,
            &folded,
            &lifecycle(&steer, "completed"),
            &lifecycle(&id, "completed"),
            &task_finished("t1", "completed"),
            INIT,
            &unprompted_reply,
            &result(None, 0.5, "bg-t1"),
        ],
    );
    assert_eq!(collected.settles, 0);
    assert_eq!(collected.background.len(), 1);
    assert!(!String::from_utf8_lossy(&collected.turn).contains("bg-t1"));
    assert!(router.feed(&task_finished("t2", "completed")).settled);
}

#[test]
fn a_completed_lifecycle_for_our_command_settles_a_result_without_uuid_keys() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let local = line(serde_json::json!({
        "type":"result",
        "subtype":"success",
        "result":"Compacted",
        "num_turns":0,
        "session_id":"sess-abcdefgh"
    }));
    let collected = feed_all(&mut router, &[&local]);
    assert_eq!(collected.settles, 0);
    let completed = router.feed(&lifecycle(&id, "completed"));
    assert!(completed.settled);
}

#[test]
fn a_completed_lifecycle_with_live_tasks_waits_for_the_drain() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let native = task_started("t1", true);
    let collected = feed_all(&mut router, &[&native, &lifecycle(&id, "completed")]);
    assert_eq!(collected.settles, 0);
    assert!(router.feed(&task_finished("t1", "completed")).settled);
}

#[test]
fn a_cancelled_queued_command_settles_the_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let (_, id) = attach(&mut router);
    router.feed(&lifecycle(&id, "queued"));
    let cancelled = router.feed(&lifecycle(&id, "cancelled"));
    assert!(cancelled.settled);
    assert!(cancelled.cancelled);
    assert!(!cancelled.interrupted);
}

#[test]
fn an_interrupted_result_without_lifecycle_support_settles_with_live_native_tasks() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, _) = attach(&mut router);
    let native = task_started("t1", true);
    feed_all(&mut router, &[INIT, &native, &assistant("working")]);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = acknowledgement("req-1");
    let collected = feed_all(&mut router, &[&ack, FAILED]);
    assert_eq!(collected.settles, 1);
    assert_eq!(router.live_background_tasks(), 1);
}

#[test]
fn a_foreground_bash_task_is_live_but_never_a_background_task() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    feed_all(&mut router, &[&task_started("fg", false)]);
    assert_eq!(router.live_background_tasks(), 0);
    let held = router.feed(&result(Some(&id), 0.25, "S"));
    assert!(!held.settled, "a live foreground task still holds the turn");
    feed_all(&mut router, &[&task_started("bg", true)]);
    assert_eq!(router.live_background_tasks(), 1);
    assert!(!router.feed(&task_finished("fg", "completed")).settled);
    assert_eq!(router.live_background_tasks(), 1);
    assert!(router.feed(&task_finished("bg", "completed")).settled);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn attachment_is_reported_only_for_the_attached_ledger_until_settlement() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let other = Arc::new(ClaudeInputLifecycle::new());
    assert!(router.is_attached_to(&ledger));
    assert!(!router.is_attached_to(&other));
    assert!(router.feed(&result(Some(&id), 0.25, "S")).settled);
    assert!(!router.is_attached_to(&ledger));
    router.attach(Arc::clone(&other));
    assert!(router.is_attached_to(&other));
    router.detach();
    assert!(!router.is_attached_to(&other));
}

fn interrupted_with_live_task(router: &mut ClaudeSessionRouter, task: &str) {
    let (ledger, id) = owned_turn(router);
    let native = task_started(task, true);
    feed_all(router, &[&native, &assistant("working")]);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = acknowledgement("req-1");
    let settled = feed_all(router, &[&ack, &interrupted_result(&id)]);
    assert_eq!(settled.settles, 1);
    assert_eq!(router.live_background_tasks(), 1);
}

#[test]
fn an_inherited_background_task_never_blocks_the_next_turn() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "t1");
    let (_, id) = attach(&mut router);
    let own = feed_all(&mut router, &[&turn_stream(&id, 1.0, "TWO")]);
    assert_eq!(own.settles, 1);
    assert_eq!(router.live_background_tasks(), 1);
    let unprompted_reply = assistant("bg-t1");
    let later = feed_all(
        &mut router,
        &[
            &task_finished("t1", "completed"),
            INIT,
            &unprompted_reply,
            &result(None, 1.5, "bg-t1"),
        ],
    );
    assert_eq!(later.settles, 0);
    assert!(later.turn.is_empty());
    assert_eq!(later.background.len(), 1);
    assert!(later.background[0].complete);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_task_started_during_the_new_turn_still_blocks_it_until_drained() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "t1");
    let (_, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let started = lifecycle(&id, "started");
    let native = task_started("t2", true);
    let own = result(Some(&id), 1.0, "TWO");
    let before = feed_all(&mut router, &[&queued, &started, INIT, &native, &own]);
    assert_eq!(before.settles, 0);
    assert_eq!(router.live_background_tasks(), 2);
    assert!(!router.feed(&task_finished("t1", "completed")).settled);
    assert!(router.feed(&task_finished("t2", "completed")).settled);
}

#[test]
fn a_task_left_by_an_idle_unprompted_turn_is_inherited_by_the_next_attach() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let idle_task = task_started("t9", true);
    let unprompted = feed_all(
        &mut router,
        &[INIT, &idle_task, &result(None, 0.5, "started t9")],
    );
    assert_eq!(unprompted.background.len(), 1);
    assert_eq!(router.live_background_tasks(), 1);
    let (_, id) = attach(&mut router);
    assert_eq!(
        feed_all(&mut router, &[&turn_stream(&id, 1.0, "TWO")]).settles,
        1
    );
}

#[test]
fn a_natural_result_racing_an_interrupt_is_not_labelled_interrupted() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = router.feed(&acknowledgement("req-1"));
    assert!(!ack.settled);
    let step = router.feed(&result(Some(&id), 0.25, "done"));
    assert!(step.settled);
    assert!(!step.interrupted);
}

#[test]
fn settlement_through_the_interrupt_path_is_labelled_interrupted() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    router.feed(&acknowledgement("req-1"));
    let failed = router.feed(&interrupted_result(&id));
    assert!(failed.settled);
    assert!(failed.interrupted);

    let (ledger, id) = owned_turn(&mut router);
    let native = task_started("t9", true);
    let own = result(Some(&id), 0.5, "S");
    let completed = lifecycle(&id, "completed");
    assert_eq!(
        feed_all(&mut router, &[&native, &own, &completed]).settles,
        0
    );
    router.interrupt_sent("req-2".to_string());
    ledger.abandon_all();
    let ack = router.feed(&acknowledgement("req-2"));
    assert!(ack.settled);
    assert!(ack.interrupted);

    let (_, id) = owned_turn(&mut router);
    let natural = router.feed(&result(Some(&id), 0.75, "N"));
    assert!(natural.settled);
    assert!(!natural.interrupted);
}

#[path = "claude_session_router_background_tests.rs"]
mod background;

#[path = "claude_session_router_resume_tests.rs"]
mod resume;

#[path = "claude_session_router_task_stop_tests.rs"]
mod task_stop;

#[path = "claude_session_router_compaction_tests.rs"]
mod compaction;
