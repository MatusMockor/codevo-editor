use super::*;

const AGENT: &str = "a4b355dcf6056a875";
const LAUNCH_TOOL: &str = "toolu_012nR5ST1SeGiHfvahNc1s2X";
const RESUME_TOOL: &str = "toolu_019eyG6GAy4aZoYrH76mTu6u";
const DESCRIPTION: &str = "Live Codex model catalog like Claude";

fn agent_started(tool: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"tool_use_id":tool,
        "description":DESCRIPTION,"task_type":"local_agent","subagent_type":"general-purpose",
        "session_id":"sess-abcdefgh"
    }))
}

fn agent_progress(tool: &str, description: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_progress","task_id":AGENT,"tool_use_id":tool,
        "description":description,"last_tool_name":"Bash",
        "usage":{"duration_ms":1729706,"total_tokens":330412,"tool_uses":146},
        "session_id":"sess-abcdefgh"
    }))
}

fn agent_updated() -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_updated","task_id":AGENT,
        "patch":{"status":"completed"},"session_id":"sess-abcdefgh"
    }))
}

fn agent_notified(tool: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system","subtype":"task_notification","task_id":AGENT,"tool_use_id":tool,
        "status":"completed","usage":{"duration_ms":2021217,"total_tokens":356341,"tool_uses":161},
        "session_id":"sess-abcdefgh"
    }))
}

fn tool_call(tool: &str, name: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant","parent_tool_use_id":null,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"tool_use","id":tool,"name":name,"input":{}}]}
    }))
}

fn tool_result(tool: &str, text: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user","parent_tool_use_id":null,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"tool_result","tool_use_id":tool,"content":text}]}
    }))
}

fn subagent_output(tool: &str, text: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant","parent_tool_use_id":tool,"session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"text","text":text}]}
    }))
}

fn listed(router: &ClaudeSessionRouter) -> Vec<(String, BackgroundTaskKind, Option<String>)> {
    router
        .background_tasks()
        .tasks
        .into_iter()
        .map(|task| (task.task_id, task.kind, task.description))
        .collect()
}

fn launched_and_finished(router: &mut ClaudeSessionRouter) {
    let (_, id) = owned_turn(router);
    let call = tool_call(LAUNCH_TOOL, "Agent");
    let started = agent_started(LAUNCH_TOOL);
    let launched = tool_result(LAUNCH_TOOL, "Async agent launched successfully.");
    let own = result(Some(&id), 0.25, "Zadal som to agentovi.");
    let completed = lifecycle(&id, "completed");
    let launch = feed_all(router, &[&call, &started, &launched, &own, &completed]);
    assert_eq!(launch.settles, 0, "the async agent keeps the turn open");
    assert_eq!(launch.background_changes, 1);
    let working = subagent_output(LAUNCH_TOOL, "I'll start by mapping the Claude catalog.");
    let progress = agent_progress(LAUNCH_TOOL, "Running Show changed files and sizes");
    let running = feed_all(router, &[&working, &progress, &progress]);
    assert_eq!(running.background_changes, 0, "progress is not a change");
    assert_eq!(running.settles, 0);
    let updated = agent_updated();
    let notified = agent_notified(LAUNCH_TOOL);
    let drained = feed_all(router, &[&updated, &notified]);
    assert_eq!(drained.settles, 1);
    assert_eq!(drained.background_changes, 1);
    assert!(listed(router).is_empty());
}

#[test]
fn an_agent_resumed_by_an_unprompted_send_message_is_live_session_work_until_it_finishes() {
    let mut router = ClaudeSessionRouter::new();
    launched_and_finished(&mut router);
    let call = tool_call(RESUME_TOOL, "SendMessage");
    let resumed = agent_started(RESUME_TOOL);
    let resuming = tool_result(
        RESUME_TOOL,
        "{\"success\":true,\"message\":\"Resuming agent a4b355d\"}",
    );
    let progress = agent_progress(RESUME_TOOL, DESCRIPTION);
    let reply = result(None, 0.5, "Agent teraz opravuje dve chyby.");
    let unprompted = feed_all(
        &mut router,
        &[INIT, &call, &resumed, &resuming, &progress, &reply],
    );
    assert_eq!(unprompted.settles, 0);
    assert_eq!(unprompted.background.len(), 1);
    assert!(unprompted.background[0].complete);
    assert_eq!(unprompted.background_changes, 1);
    assert_eq!(router.live_background_tasks(), 1);
    assert_eq!(
        listed(&router),
        vec![(
            AGENT.to_string(),
            BackgroundTaskKind::Agent,
            Some(DESCRIPTION.to_string())
        )]
    );

    let working = subagent_output(RESUME_TOOL, "Fixing P2-1 test-first.");
    let more = agent_progress(RESUME_TOOL, "Running Run presentation and domain tests");
    let idle = feed_all(&mut router, &[&working, &more, &working, &more]);
    assert!(idle.turn.is_empty(), "idle progress never lands in a turn");
    assert!(idle.background.is_empty());
    assert!(!idle.unowned);
    assert_eq!(idle.background_changes, 0);
    assert_eq!(router.live_background_tasks(), 1);

    let updated = agent_updated();
    let notified = agent_notified(RESUME_TOOL);
    let finished = feed_all(&mut router, &[&updated, &notified]);
    assert_eq!(finished.background_changes, 1);
    assert_eq!(router.live_background_tasks(), 0);
    let wake = feed_all(
        &mut router,
        &[
            INIT,
            &assistant("Opravy su hotove."),
            &result(None, 0.75, "Opravy su hotove."),
        ],
    );
    assert_eq!(wake.background.len(), 1);
    assert_eq!(wake.settles, 0);
}

#[test]
fn idle_progress_under_a_new_tool_call_revives_a_finished_agent_without_a_restart_frame() {
    let mut router = ClaudeSessionRouter::new();
    launched_and_finished(&mut router);
    let progress = agent_progress(RESUME_TOOL, "Running Run presentation and domain tests");
    let revived = feed_all(&mut router, &[&progress, &progress]);
    assert_eq!(revived.background_changes, 1);
    assert!(revived.turn.is_empty());
    assert!(revived.background.is_empty());
    assert_eq!(
        listed(&router),
        vec![(
            AGENT.to_string(),
            BackgroundTaskKind::Agent,
            Some(DESCRIPTION.to_string())
        )]
    );

    let (_, id) = attach(&mut router);
    let next = turn_stream(&id, 1.0, "editor mi nehlasi ze by nieco bezalo");
    let turn = feed_all(&mut router, &lines_of_bytes(&next));
    assert_eq!(
        turn.settles, 1,
        "revived work is inherited by the next turn"
    );
    assert_eq!(router.live_background_tasks(), 1);

    let finished = feed_all(&mut router, &[&agent_notified(RESUME_TOOL)]);
    assert_eq!(finished.background_changes, 1);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_level_that_was_not_delivered_is_reported_again_with_the_next_frame() {
    let mut router = ClaudeSessionRouter::new();
    owned_turn(&mut router);
    let started = router.feed(&agent_started(LAUNCH_TOOL));
    assert_eq!(started.background_tasks.map(|level| level.total), Some(1));
    assert!(router.feed(KEEP_ALIVE).background_tasks.is_none());
    router.forget_reported_background();
    let again = router.feed(KEEP_ALIVE);
    assert_eq!(again.background_tasks.map(|level| level.agents), Some(1));
    assert!(router.feed(KEEP_ALIVE).background_tasks.is_none());
}

#[test]
fn stragglers_of_the_finished_run_never_revive_the_agent() {
    let mut router = ClaudeSessionRouter::new();
    launched_and_finished(&mut router);
    let late = agent_progress(LAUNCH_TOOL, "Running Show changed files and sizes");
    let duplicate = agent_notified(LAUNCH_TOOL);
    let stragglers = feed_all(&mut router, &[&late, &duplicate, &agent_updated()]);
    assert_eq!(stragglers.background_changes, 0);
    assert_eq!(router.live_background_tasks(), 0);
}
