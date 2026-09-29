use super::*;

const AGENT: &str = "a4b355dcf6056a875";
const LAUNCH_TOOL: &str = "toolu_012nR5ST1SeGiHfvahNc1s2X";
const RESUME_TOOL: &str = "toolu_019eyG6GAy4aZoYrH76mTu6u";
const DESCRIPTION_FOR_TESTS: &str = "Live Codex model catalog like Claude";
const RESULT: &[u8] =
    b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"ok\",\"num_turns\":1}\n";
const CLEAR_RESET: &[u8] = b"{\"type\":\"conversation_reset\",\"new_conversation_id\":\"f702f92e\",\"session_id\":\"resumed\"}\n";

fn frame(value: serde_json::Value) -> Vec<u8> {
    let mut line = serde_json::to_vec(&value).expect("frame json");
    line.push(b'\n');
    line
}

fn agent_started(tool: &str) -> Vec<u8> {
    frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"tool_use_id":tool,
        "description":"Live Codex model catalog like Claude","task_type":"local_agent",
        "subagent_type":"general-purpose"
    }))
}

fn agent_progress(tool: Option<&str>, description: &str) -> Vec<u8> {
    let mut value = serde_json::json!({
        "type":"system","subtype":"task_progress","task_id":AGENT,"description":description,
        "last_tool_name":"Bash","usage":{"duration_ms":1729706,"total_tokens":330412,"tool_uses":146}
    });
    if let Some(tool) = tool {
        value["tool_use_id"] = serde_json::Value::from(tool);
    }
    frame(value)
}

fn agent_updated(status: &str) -> Vec<u8> {
    frame(serde_json::json!({
        "type":"system","subtype":"task_updated","task_id":AGENT,"patch":{"status":status}
    }))
}

fn agent_notified(tool: &str) -> Vec<u8> {
    frame(serde_json::json!({
        "type":"system","subtype":"task_notification","task_id":AGENT,"tool_use_id":tool,
        "status":"completed","usage":{"duration_ms":2021217,"total_tokens":356341,"tool_uses":161}
    }))
}

fn finished_first_run() -> ResultLineDetector {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    for line in [
        agent_started(LAUNCH_TOOL),
        agent_progress(Some(LAUNCH_TOOL), "Running Show changed files and sizes"),
        agent_updated("completed"),
        agent_notified(LAUNCH_TOOL),
    ] {
        detector.feed(&line).expect("first run");
    }
    assert_eq!(detector.live_background_task_count(), 0);
    detector.rearm(None);
    detector
}

fn track(detector: &mut ResultLineDetector, line: &[u8]) {
    let message: serde_json::Value = serde_json::from_slice(line).expect("tracked json");
    detector.track_message(&message).expect("tracked");
}

#[test]
fn progress_of_a_resumed_agent_under_its_new_tool_id_revives_it_as_inherited_background_work() {
    let mut detector = finished_first_run();
    track(
        &mut detector,
        &agent_progress(Some(RESUME_TOOL), "Live Codex model catalog like Claude"),
    );
    assert_eq!(detector.live_background_task_count(), 1);
    assert_eq!(
        detector.background_tasks(),
        vec![LiveBackgroundTask {
            task_id: AGENT.to_string(),
            kind: BackgroundTaskKind::Agent,
            description: Some("Live Codex model catalog like Claude".to_string()),
        }]
    );
    assert!(
        detector.feed(RESULT).expect("result"),
        "revived work is inherited and never blocks a turn"
    );
    detector.rearm(None);
    track(&mut detector, &agent_updated("completed"));
    track(&mut detector, &agent_notified(RESUME_TOOL));
    assert_eq!(detector.live_background_task_count(), 0);
    assert!(detector.background_tasks().is_empty());
}

#[test]
fn a_genuine_restart_after_the_resume_still_revives_and_blocks_the_armed_turn() {
    let mut detector = finished_first_run();
    detector.feed(&agent_started(RESUME_TOOL)).expect("resume");
    assert_eq!(detector.live_background_task_count(), 1);
    assert!(!detector.feed(RESULT).expect("result"));
    assert!(detector.feed(&agent_notified(RESUME_TOOL)).expect("drain"));
}

#[test]
fn stragglers_and_duplicate_terminals_of_the_finished_run_never_revive_it() {
    let mut detector = finished_first_run();
    let running_update = frame(serde_json::json!({
        "type":"system","subtype":"task_updated","task_id":AGENT,"patch":{"status":"running"}
    }));
    for line in [
        agent_progress(Some(LAUNCH_TOOL), "Running Show changed files and sizes"),
        agent_progress(None, "Running Show changed files and sizes"),
        agent_updated("completed"),
        agent_notified(LAUNCH_TOOL),
        agent_notified(RESUME_TOOL),
        running_update,
    ] {
        track(&mut detector, &line);
        assert_eq!(detector.live_background_task_count(), 0);
    }
    assert!(detector.background_tasks().is_empty());
}

#[test]
fn a_task_retired_by_a_conversation_reset_is_never_revived_by_progress() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    detector.feed(&agent_started(LAUNCH_TOOL)).expect("start");
    detector.feed(CLEAR_RESET).expect("reset");
    assert_eq!(detector.live_background_task_count(), 0);
    track(
        &mut detector,
        &agent_progress(Some(RESUME_TOOL), "Live Codex model catalog like Claude"),
    );
    assert_eq!(detector.live_background_task_count(), 0);
}

#[test]
fn the_background_revision_follows_membership_and_ignores_progress() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    let initial = detector.background_revision();
    let foreground = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":"bfg","task_type":"local_bash",
        "is_backgrounded":false,"description":"npm test"
    }));
    detector.feed(&foreground).expect("foreground");
    assert_eq!(detector.background_revision(), initial);
    detector.feed(&agent_started(LAUNCH_TOOL)).expect("start");
    let started = detector.background_revision();
    assert_ne!(started, initial);
    detector
        .feed(&agent_progress(Some(LAUNCH_TOOL), "Running Read files"))
        .expect("progress");
    assert_eq!(detector.background_revision(), started);
    detector
        .feed(&agent_started(LAUNCH_TOOL))
        .expect("duplicate start");
    assert_eq!(detector.background_revision(), started);
    detector.feed(&agent_notified(LAUNCH_TOOL)).expect("done");
    let finished = detector.background_revision();
    assert_ne!(finished, started);
    detector
        .feed(&agent_updated("completed"))
        .expect("duplicate");
    assert_eq!(detector.background_revision(), finished);
    track(
        &mut detector,
        &agent_progress(Some(RESUME_TOOL), "Live Codex model catalog like Claude"),
    );
    assert_ne!(detector.background_revision(), finished);
}

#[test]
fn the_background_snapshot_lists_only_background_tasks_in_start_order() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    let shell = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":"bdxqm7bz6","task_type":"local_bash",
        "is_backgrounded":true,"description":"Add predicate test\u{7}and run suites"
    }));
    let monitor = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":"mon-1","task_type":"monitor_mcp",
        "description":"x".repeat(2 * MAX_BACKGROUND_TASK_DESCRIPTION_BYTES)
    }));
    let unknown = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":"other-1","task_type":"workflow"
    }));
    for line in [agent_started(LAUNCH_TOOL), shell, monitor, unknown] {
        detector.feed(&line).expect("start");
    }
    let tasks = detector.background_tasks();
    let kinds: Vec<_> = tasks
        .iter()
        .map(|task| (task.task_id.as_str(), task.kind))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (AGENT, BackgroundTaskKind::Agent),
            ("bdxqm7bz6", BackgroundTaskKind::Shell),
            ("mon-1", BackgroundTaskKind::Monitor),
            ("other-1", BackgroundTaskKind::Other),
        ]
    );
    assert_eq!(tasks[1].description, None, "control characters are dropped");
    assert_eq!(
        tasks[2].description.as_deref().map(str::len),
        Some(MAX_BACKGROUND_TASK_DESCRIPTION_BYTES)
    );
    assert_eq!(tasks[3].description, None);
}

fn revived_after(first: &[Vec<u8>]) -> usize {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    for line in first {
        detector.feed(line).expect("first run");
    }
    detector.rearm(None);
    track(
        &mut detector,
        &agent_progress(Some(RESUME_TOOL), "Live Codex model catalog like Claude"),
    );
    detector.live_background_task_count()
}

#[test]
fn only_a_finished_agent_run_with_a_known_tool_call_can_be_revived_by_progress() {
    let ambient = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"tool_use_id":LAUNCH_TOOL,
        "description":"fork","task_type":"local_agent","is_backgrounded":true,"ambient":true
    }));
    let planned = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"tool_use_id":LAUNCH_TOOL,
        "task_type":"plan"
    }));
    let untooled = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"task_type":"local_agent",
        "description":DESCRIPTION_FOR_TESTS
    }));
    let shell = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":AGENT,"tool_use_id":LAUNCH_TOOL,
        "task_type":"local_bash","is_backgrounded":true
    }));
    assert_eq!(revived_after(&[ambient]), 0, "ambient");
    assert_eq!(revived_after(&[planned]), 0, "plan");
    assert_eq!(
        revived_after(&[untooled, agent_updated("completed")]),
        0,
        "no known run"
    );
    assert_eq!(
        revived_after(&[agent_updated("completed")]),
        0,
        "never started"
    );
    assert_eq!(
        revived_after(&[shell, agent_notified(LAUNCH_TOOL)]),
        0,
        "not an agent"
    );
    assert_eq!(
        revived_after(&[agent_started(LAUNCH_TOOL), agent_notified(LAUNCH_TOOL)]),
        1,
        "a finished agent run"
    );
}

#[test]
fn a_monitor_ws_task_is_reported_as_a_monitor() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    let watcher = frame(serde_json::json!({
        "type":"system","subtype":"task_started","task_id":"ws-watch","task_type":"monitor_ws",
        "description":"live updates"
    }));
    detector.feed(&watcher).expect("start");
    assert_eq!(
        detector.background_tasks()[0].kind,
        BackgroundTaskKind::Monitor
    );
}
