use super::*;

const STOP_BACKGROUND_SHELL: &str =
    include_str!("../tests/fixtures/claude_session/stop-background-shell.jsonl");
const STOP_MONITOR: &str = include_str!("../tests/fixtures/claude_session/stop-monitor.jsonl");
const MONITOR_EVENTS_AND_END: &str =
    include_str!("../tests/fixtures/claude_session/monitor-events-and-end.jsonl");
const SECOND_TURN_OUTPUT: &str =
    include_str!("../tests/fixtures/claude_session/monitor-inherited-second-turn-output.jsonl");
const UNCLAIMED_AGENT_TASK: &str =
    include_str!("../tests/fixtures/claude_session/synthetic-unclaimed-agent-task.jsonl");
const UNCLAIMED_TASK: &str = "captured-task-0002";
const CAPTURED_COMMAND: &str = "captured-command-0001";
const SECOND_COMMAND: &str = "captured-command-0002";
const SECOND_ANSWER: &str = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"SECOND"}]},"parent_tool_use_id":null,"session_id":"captured-session-0001"}"#;
const SECOND_RESULT: &str = r#"{"type":"result","subtype":"success","is_error":false,"result":"SECOND","num_turns":1,"user_message_uuid":"captured-command-0002","user_message_uuids":["captured-command-0002"],"session_id":"captured-session-0001"}"#;
const CAPTURED_TASK: &str = "captured-task-0001";

#[derive(Debug, Default)]
struct Replay {
    levels: Vec<(usize, ClaudeBackgroundReply)>,
    kinds: Vec<BackgroundTaskKind>,
    settled_after: Vec<usize>,
    replies: Vec<ClaudeBackgroundTurn>,
    unowned: bool,
    failure: Option<&'static str>,
}

fn replay(capture: &str) -> (ClaudeSessionRouter, Replay) {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = attach(&mut router);
    let mut replayed = Replay::default();
    for (index, frame) in capture.replace(CAPTURED_COMMAND, &id).lines().enumerate() {
        let step = router.feed(format!("{frame}\n").as_bytes());
        if step.settled {
            replayed.settled_after.push(index);
        }
        if let Some(level) = step.background_tasks {
            replayed
                .kinds
                .extend(level.tasks.iter().map(|task| task.kind));
            replayed.levels.push((level.total, level.reply));
        }
        replayed.replies.extend(step.background_turns);
        replayed.unowned |= step.unowned_activity;
        replayed.failure = replayed.failure.or(step.failure);
    }
    (router, replayed)
}

fn frame_index(capture: &str, needle: &str) -> usize {
    capture
        .lines()
        .position(|frame| frame.contains(needle))
        .expect("captured frame")
}

const OWN_RESULT: &str = r#""result":"STARTED""#;
const KILLED: &str = r#""patch":{"status":"killed"}"#;

#[test]
fn a_captured_stop_of_an_idle_background_task_is_killed_and_expects_no_reply() {
    let settles_at = [(STOP_BACKGROUND_SHELL, KILLED), (STOP_MONITOR, OWN_RESULT)];
    for (capture, settling_frame) in settles_at {
        assert!(capture.contains(KILLED));
        assert!(capture.contains(r#""subtype":"task_notification""#));
        assert!(capture.contains(r#""status":"stopped""#));
        assert!(!capture.contains(r#""origin""#));

        let (router, replayed) = replay(capture);

        assert_eq!(
            replayed.levels,
            [
                (1, ClaudeBackgroundReply::None),
                (0, ClaudeBackgroundReply::None)
            ]
        );
        assert_eq!(
            replayed.settled_after,
            [frame_index(capture, settling_frame)]
        );
        assert!(replayed.replies.is_empty());
        assert!(!replayed.unowned);
        assert_eq!(replayed.failure, None);
        assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
        assert!(!router.live_background_task(CAPTURED_TASK));
    }
}

#[test]
fn a_captured_monitor_is_reported_as_a_monitor_although_the_cli_calls_it_local_bash() {
    for capture in [MONITOR_EVENTS_AND_END, STOP_MONITOR] {
        assert!(capture.contains(r#""name":"Monitor""#));
        assert!(capture.contains(r#""task_type":"local_bash""#));
        assert!(!capture.contains(r#""task_type":"monitor"#));

        let (_, replayed) = replay(capture);

        assert!(!replayed.kinds.is_empty());
        assert!(replayed
            .kinds
            .iter()
            .all(|kind| *kind == BackgroundTaskKind::Monitor));
    }
    let (_, shell) = replay(STOP_BACKGROUND_SHELL);
    assert_eq!(shell.kinds, [BackgroundTaskKind::Shell]);
}

#[test]
fn a_captured_monitor_lets_its_turn_end_and_every_event_opens_a_reply_while_it_stays_listed() {
    let (_, replayed) = replay(MONITOR_EVENTS_AND_END);

    assert_eq!(
        replayed.settled_after,
        [frame_index(MONITOR_EVENTS_AND_END, OWN_RESULT)]
    );
    assert_eq!(
        replayed.levels,
        [
            (1, ClaudeBackgroundReply::None),
            (1, ClaudeBackgroundReply::InProgress),
            (1, ClaudeBackgroundReply::None),
            (0, ClaudeBackgroundReply::Expected),
            (0, ClaudeBackgroundReply::InProgress),
            (0, ClaudeBackgroundReply::None),
        ]
    );
    assert_eq!(replayed.replies.len(), 2);
    assert!(replayed.replies.iter().all(|reply| reply.complete));
    assert!(replayed
        .replies
        .iter()
        .all(|reply| String::from_utf8_lossy(&reply.output).contains("NOTED")));
    assert!(!replayed.unowned);
    assert_eq!(replayed.failure, None);
}

#[test]
fn a_captured_monitor_that_ends_on_its_own_expects_the_reply_that_follows_it() {
    let ended = frame_index(MONITOR_EVENTS_AND_END, "stream ended");
    let opened = MONITOR_EVENTS_AND_END
        .lines()
        .enumerate()
        .skip(ended)
        .find(|(_, frame)| frame.contains(r#""subtype":"init""#))
        .map(|(index, _)| index);
    assert_eq!(opened, Some(ended + 2));

    let mut router = ClaudeSessionRouter::new();
    let (_, id) = attach(&mut router);
    let capture = MONITOR_EVENTS_AND_END.replace(CAPTURED_COMMAND, &id);
    for frame in capture.lines().take(ended + 2) {
        router.feed(format!("{frame}\n").as_bytes());
    }
    assert_eq!(
        router.background_tasks().reply,
        ClaudeBackgroundReply::Expected
    );
}

fn second_command(state: &str) -> String {
    format!(r#"{{"type":"command_lifecycle","command_uuid":"{SECOND_COMMAND}","state":"{state}"}}"#)
}

fn second_turn(during: &[&str]) -> Vec<String> {
    let mut unclaimed = UNCLAIMED_AGENT_TASK.lines().map(str::to_string);
    let started_early = unclaimed.next().expect("unclaimed task start");
    [
        second_command("queued"),
        started_early,
        second_command("started"),
    ]
    .into_iter()
    .chain(during.iter().map(|frame| frame.to_string()))
    .chain(unclaimed)
    .chain([
        SECOND_ANSWER.to_string(),
        SECOND_RESULT.to_string(),
        second_command("completed"),
    ])
    .collect()
}

fn fed_as(router: &mut ClaudeSessionRouter, frames: &[String], captured: &str) -> Collected {
    let (_, id) = attach(router);
    let mut collected = Collected::default();
    for frame in frames {
        collected.absorb(router.feed(format!("{}\n", frame.replace(captured, &id)).as_bytes()));
    }
    collected.turn = String::from_utf8_lossy(&collected.turn)
        .replace(&id, captured)
        .into_bytes();
    collected
}

#[test]
fn a_captured_monitor_left_by_one_turn_never_reaches_the_output_of_the_next() {
    let frames: Vec<String> = MONITOR_EVENTS_AND_END.lines().map(str::to_string).collect();
    let first_ends = frame_index(MONITOR_EVENTS_AND_END, OWN_RESULT) + 2;
    let during: Vec<&str> = frames[first_ends..].iter().map(String::as_str).collect();
    assert_eq!(
        during
            .iter()
            .filter(|frame| frame.contains(CAPTURED_TASK))
            .count(),
        2
    );
    assert_eq!(UNCLAIMED_AGENT_TASK.matches(UNCLAIMED_TASK).count(), 4);
    let mut router = ClaudeSessionRouter::new();

    let first = fed_as(&mut router, &frames[..first_ends], CAPTURED_COMMAND);
    assert_eq!(first.settles, 1);
    assert_eq!(
        String::from_utf8_lossy(&first.turn),
        frames[..first_ends - 1].join("\n") + "\n"
    );
    assert!(router.live_background_task(CAPTURED_TASK));

    let second = fed_as(&mut router, &second_turn(&during), SECOND_COMMAND);
    let output = String::from_utf8_lossy(&second.turn);

    assert_eq!(second.settles, 1);
    assert_eq!(second.failure, None);
    assert!(!second.unowned);
    assert!(!output.contains(CAPTURED_TASK));
    assert!(!output.contains(UNCLAIMED_TASK));
    assert_eq!(output, SECOND_TURN_OUTPUT);
    assert!(!router.live_background_task(CAPTURED_TASK));
    assert_eq!(router.live_background_tasks(), 0);
}
