use super::*;

const OUR_AGENT: &str = "a4b355dcf6056a875";
const OUR_TOOL: &str = "toolu_our_agent_call";
const THEIR_AGENT: &str = "b7c466edf7167b986";
const THEIR_TOOL: &str = "toolu_their_agent_call";
const RESUME_TOOL: &str = "toolu_their_send_message";

fn agent_started(task: &str, tool: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":task,"tool_use_id":tool,
        "description":"review","task_type":"local_agent","subagent_type":"general-purpose",
        "session_id":"sess-abcdefgh"
    }))
}

fn agent_progress(task: &str, tool: &str, description: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_progress","task_id":task,"tool_use_id":tool,
        "description":description,"last_tool_name":"Bash",
        "usage":{"duration_ms":1200,"total_tokens":3400,"tool_uses":5},
        "session_id":"sess-abcdefgh"
    }))
}

fn agent_updated(task: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_updated","task_id":task,
        "patch":{"status":"completed"},"session_id":"sess-abcdefgh"
    }))
}

fn agent_notified(task: &str, tool: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_notification","task_id":task,"tool_use_id":tool,
        "status":"completed","usage":{"duration_ms":2400,"total_tokens":6800,"tool_uses":9},
        "session_id":"sess-abcdefgh"
    }))
}

fn tool_call(tool: &str, name: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant","parent_tool_use_id":null,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"tool_use","id":tool,"name":name,"input":{}}]}
    }))
}

fn subagent_text(parent: &str, text: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant","parent_tool_use_id":parent,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"text","text":text}]}
    }))
}

fn subagent_tool_result(parent: &str, tool: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user","parent_tool_use_id":parent,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"tool_result","tool_use_id":tool,"content":"ok"}]}
    }))
}

fn subagent_delta(parent: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"stream_event","parent_tool_use_id":parent,"session_id":"sess-abcdefgh",
        "event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"d"}}
    }))
}

fn awaiting_our_agent(router: &mut ClaudeSessionRouter) -> String {
    let (_, id) = owned_turn(router);
    let call = tool_call(OUR_TOOL, "Agent");
    let started = agent_started(OUR_AGENT, OUR_TOOL);
    let own = result(Some(&id), 0.25, "delegated");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(router, &[&call, &started, &own, &completed]);
    assert_eq!(turn.settles, 0, "the running agent keeps the turn attached");
    id
}

fn bytes_of(lines: &[&[u8]]) -> Vec<u8> {
    lines.concat()
}

#[test]
fn frames_of_the_attached_turns_agent_reach_that_turn_while_a_reply_is_open() {
    let mut router = ClaudeSessionRouter::new();
    awaiting_our_agent(&mut router);
    let before = subagent_text(OUR_TOOL, "mapping the router");
    assert_eq!(router.feed(&before).turn_output, before);

    let opened = router.feed(INIT);
    assert!(opened.turn_output.is_empty());
    assert_eq!(
        router.background_tasks().reply,
        ClaudeBackgroundReply::InProgress
    );

    let reply_start = assistant("another task finished");
    let ours_text = subagent_text(OUR_TOOL, "found the diversion");
    let ours_progress = agent_progress(OUR_AGENT, OUR_TOOL, "Running the router tests");
    let ours_result = subagent_tool_result(OUR_TOOL, "toolu_inner_bash");
    let ours_delta = subagent_delta(OUR_TOOL);
    let their_call = tool_call(THEIR_TOOL, "Agent");
    let their_started = agent_started(THEIR_AGENT, THEIR_TOOL);
    let their_text = subagent_text(THEIR_TOOL, "reviewing the parser");
    let their_progress = agent_progress(THEIR_AGENT, THEIR_TOOL, "Reading the parser");
    let reply_end = assistant("started a second review");
    let interleaved = feed_all(
        &mut router,
        &[
            &reply_start,
            &ours_text,
            &their_call,
            &ours_progress,
            &their_started,
            &ours_result,
            &their_text,
            &ours_delta,
            &their_progress,
            &reply_end,
        ],
    );

    assert_eq!(interleaved.settles, 0);
    assert!(interleaved.background.is_empty());
    assert_eq!(
        interleaved.turn,
        bytes_of(&[&ours_text, &ours_progress, &ours_result, &ours_delta]),
        "each frame of our agent reaches our turn once, in order"
    );

    let closed = router.feed(&result(None, 0.5, "started a second review"));

    assert!(!closed.settled, "our agent is still running");
    assert!(closed.turn_output.is_empty());
    assert_eq!(closed.background_turns.len(), 1);
    let background = &closed.background_turns[0];
    assert!(background.complete);
    assert!(!background.truncated);
    let buffered = lines_of_bytes(&background.output);
    assert_eq!(
        bytes_of(&buffered[..buffered.len() - 1]),
        bytes_of(&[
            INIT,
            &reply_start,
            &their_call,
            &their_started,
            &their_text,
            &their_progress,
            &reply_end,
        ]),
        "each frame of the reply reaches the reply once, in order"
    );
    assert_eq!(
        lines_of(&background.output).last().unwrap()["result"],
        "started a second review"
    );
    assert_eq!(router.background_tasks().reply, ClaudeBackgroundReply::None);

    let after = subagent_text(OUR_TOOL, "wrapping up");
    assert_eq!(router.feed(&after).turn_output, after);
    let updated = agent_updated(OUR_AGENT);
    let notified = agent_notified(OUR_AGENT, OUR_TOOL);
    let drained = feed_all(&mut router, &[&updated, &notified]);
    assert_eq!(drained.settles, 1, "the reply's own agent never holds ours");
    assert_eq!(router.live_background_tasks(), 1);
}

#[test]
fn the_terminal_frames_of_our_agent_reach_our_turn_and_settle_it_when_the_reply_closes() {
    let mut router = ClaudeSessionRouter::new();
    awaiting_our_agent(&mut router);
    assert!(router.feed(INIT).turn_output.is_empty());
    let updated = agent_updated(OUR_AGENT);
    let notified = agent_notified(OUR_AGENT, OUR_TOOL);

    let finished = feed_all(&mut router, &[&updated, &notified]);

    assert_eq!(finished.turn, bytes_of(&[&updated, &notified]));
    assert_eq!(finished.settles, 0, "the open reply still holds the stream");
    assert_eq!(router.live_background_tasks(), 0);
    let closed = router.feed(&result(None, 0.5, "done"));
    assert!(closed.settled);
    assert!(closed.turn_output.is_empty());
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(lines_of(&closed.background_turns[0].output).len(), 2);
}

#[test]
fn a_run_restarted_by_the_reply_belongs_to_the_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let started = agent_started(OUR_AGENT, OUR_TOOL);
    let waiting = task_started("bg-shell", true);
    let own = result(Some(&id), 0.25, "delegated");
    let completed = lifecycle(&id, "completed");
    let finished = agent_notified(OUR_AGENT, OUR_TOOL);
    let turn = feed_all(
        &mut router,
        &[&started, &waiting, &own, &completed, &finished],
    );
    assert_eq!(turn.settles, 0, "the shell task is still live");
    assert!(router.feed(INIT).turn_output.is_empty());

    let resume = tool_call(RESUME_TOOL, "SendMessage");
    let restarted = agent_started(OUR_AGENT, RESUME_TOOL);
    let resumed_text = subagent_text(RESUME_TOOL, "fixing the follow-up");
    let resumed_progress = agent_progress(OUR_AGENT, RESUME_TOOL, "Running tests");
    let resumed_update = agent_updated(OUR_AGENT);
    let straggler = subagent_text(OUR_TOOL, "late output of the first run");
    let shell_done = task_finished("bg-shell", "completed");
    let replying = feed_all(
        &mut router,
        &[
            &resume,
            &restarted,
            &resumed_text,
            &resumed_progress,
            &resumed_update,
            &straggler,
            &shell_done,
        ],
    );

    assert_eq!(replying.turn, shell_done, "only our shell task is ours");
    let closed = router.feed(&result(None, 0.5, "resumed"));
    assert!(closed.settled);
    let buffered = lines_of_bytes(&closed.background_turns[0].output);
    assert_eq!(
        bytes_of(&buffered[..buffered.len() - 1]),
        bytes_of(&[
            INIT,
            &resume,
            &restarted,
            &resumed_text,
            &resumed_progress,
            &resumed_update,
            &straggler,
        ])
    );
}

#[test]
fn a_turn_that_has_not_started_owns_no_run_inside_a_racing_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let (_, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let started = agent_started(THEIR_AGENT, THEIR_TOOL);
    let progress = agent_progress(THEIR_AGENT, THEIR_TOOL, "Reading");
    let text = subagent_text(THEIR_TOOL, "reviewing");

    let raced = feed_all(&mut router, &[&queued, INIT, &started, &progress, &text]);

    assert_eq!(raced.turn, queued);
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert_eq!(lines_of(&closed.background_turns[0].output).len(), 5);
    let own = feed_all(
        &mut router,
        &[&turn_stream(&id, 1.0, "TWO")[queued.len()..]],
    );
    assert_eq!(own.settles, 1);
    assert!(own.background.is_empty());
}

#[test]
fn a_long_turn_keeps_its_live_agent_when_the_run_ledger_is_full() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    assert!(!router.feed(&agent_started(OUR_AGENT, OUR_TOOL)).settled);
    for call in 0..MAX_OWNED_RUNS + 44 {
        let task = format!("bash-{call}");
        let started = task_started(&task, false);
        let finished = task_finished(&task, "completed");
        assert_eq!(feed_all(&mut router, &[&started, &finished]).failure, None);
    }
    let own = result(Some(&id), 0.25, "delegated");
    assert!(!router.feed(&own).settled);
    let owned = &router.attached.as_ref().unwrap().runs.runs;
    assert_eq!(owned.len(), MAX_OWNED_RUNS);
    assert_eq!(owned[0].task, OUR_AGENT);
    assert!(router.feed(INIT).turn_output.is_empty());

    let progress = agent_progress(OUR_AGENT, OUR_TOOL, "Still running");
    let evicted = task_finished("bash-0", "completed");
    let step = feed_all(&mut router, &[&progress, &evicted]);

    assert_eq!(step.turn, progress);
    let closed = router.feed(&result(None, 0.5, "bg"));
    let subtypes: Vec<serde_json::Value> = lines_of(&closed.background_turns[0].output)
        .iter()
        .map(|routed| routed["subtype"].clone())
        .collect();
    assert_eq!(subtypes, ["init", "task_notification", "success"]);
}

#[test]
fn run_ids_outside_their_bounds_are_never_claimed() {
    let mut runs = OwnedRuns::default();
    let oversized = "t".repeat(MAX_RUN_ID_BYTES + 1);
    runs.claim(
        &serde_json::json!({"type":"system","subtype":"task_started","task_id":oversized}),
        |_| true,
    );
    runs.claim(
        &serde_json::json!({"type":"system","subtype":"task_started","task_id":""}),
        |_| true,
    );
    assert!(runs.runs.is_empty());
    runs.claim(
        &serde_json::json!({"type":"system","subtype":"task_started","task_id":"t1","tool_use_id":oversized}),
        |_| true,
    );
    assert_eq!(runs.runs.len(), 1);
    assert_eq!(runs.runs[0].tool, None);
    assert!(runs.owns(
        &serde_json::json!({"type":"system","subtype":"task_progress","task_id":"t1","tool_use_id":"toolu_any"})
    ));
    assert!(!runs.owns(
        &serde_json::json!({"type":"assistant","parent_tool_use_id":"toolu_any","message":{"content":[]}})
    ));
    assert!(!runs.owns(&serde_json::json!({"type":"assistant","task_id":"t1"})));
    assert!(!runs.owns(&serde_json::json!({"type":"system","subtype":"status","task_id":"t1"})));
}
