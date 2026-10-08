use super::*;

const OPEN: ClaudeBackgroundReply = ClaudeBackgroundReply::InProgress;
const CLOSED: ClaudeBackgroundReply = ClaudeBackgroundReply::None;
const EXPECTED: ClaudeBackgroundReply = ClaudeBackgroundReply::Expected;

fn shell() -> LiveBackgroundTask {
    LiveBackgroundTask {
        task_id: "bg-1".to_string(),
        kind: BackgroundTaskKind::Shell,
        description: None,
    }
}

fn level(
    tasks: Vec<LiveBackgroundTask>,
    reply: ClaudeBackgroundReply,
) -> Option<ClaudeBackgroundTasks> {
    Some(ClaudeBackgroundTasks {
        total: tasks.len(),
        agents: 0,
        tasks,
        reply,
    })
}

fn drained_native_turn(router: &mut ClaudeSessionRouter) {
    let (_, id) = owned_turn(router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(
        router,
        &[
            TASKS_LISTED,
            TASK_STARTED,
            &own,
            &completed,
            TASKS_EMPTIED,
            TASK_UPDATED,
        ],
    );
    assert_eq!(turn.settles, 1);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_wake_up_reply_opens_the_level_once_and_closes_it_with_its_result() {
    let mut router = ClaudeSessionRouter::new();
    drained_native_turn(&mut router);
    assert_eq!(router.feed(TASK_NOTIFIED).background_tasks, None);
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let writing = router.feed(&assistant("background-finished"));
    assert!(writing.background_turns.is_empty());
    assert_eq!(writing.background_tasks, None);
    let closed = router.feed(&result(None, 0.5, "background-finished"));
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_reply_delivered_in_one_chunk_never_publishes_an_open_level() {
    let mut router = ClaudeSessionRouter::new();
    drained_native_turn(&mut router);
    let chunk = [INIT.to_vec(), assistant("bg"), result(None, 0.5, "bg")].concat();
    let step = router.feed(&chunk);
    assert_eq!(step.background_turns.len(), 1);
    assert!(step.background_turns[0].complete);
    assert_eq!(step.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn our_started_command_closes_the_level_in_the_same_step_as_the_incomplete_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let (_, id) = attach(&mut router);
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let unprompted_reply = assistant("background-finished");
    let queued = lifecycle(&id, "queued");
    let raced = feed_all(&mut router, &[&unprompted_reply, &queued]);
    assert!(raced.background.is_empty());
    assert_eq!(raced.background_changes, 0);
    let step = router.feed(&lifecycle(&id, "started"));
    assert_eq!(step.background_turns.len(), 1);
    assert!(!step.background_turns[0].complete);
    assert_eq!(step.background_tasks, level(vec![], CLOSED));
}

#[test]
fn finish_closes_an_open_reply_level_with_the_dangling_turn() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let partial = router.feed(b"{\"type\":\"assistant\",\"message\":");
    assert_eq!(partial.background_tasks, None);
    let step = router.finish();
    assert_eq!(step.background_turns.len(), 1);
    assert!(!step.background_turns[0].complete);
    assert!(step.background_turns[0].truncated);
    assert_eq!(step.background_turns[0].output, INIT);
    assert_eq!(step.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.finish(), RouterStep::default());
}

#[test]
fn an_oversized_reply_keeps_the_level_open_until_its_result() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let filler = assistant(&"y".repeat(40 * 1024));
    for _ in 0..8 {
        let step = router.feed(&filler);
        assert!(step.background_turns.is_empty());
        assert_eq!(step.background_tasks, None);
    }
    let closed = router.feed(&result(None, 0.5, "done"));
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].truncated);
    assert!(closed.background_turns[0].complete);
    assert!(
        closed.background_turns[0].output.len()
            > MAX_BACKGROUND_TURN_BYTES - BACKGROUND_RESULT_RESERVE_BYTES - filler.len()
    );
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
}

#[test]
fn the_level_carries_tasks_and_reply_together() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(&mut router, &[TASKS_LISTED, TASK_STARTED, &own, &completed]);
    assert_eq!(turn.settles, 0);
    assert_eq!(turn.background_changes, 1);
    assert_eq!(
        router.feed(INIT).background_tasks,
        level(vec![shell()], OPEN)
    );
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(closed.background_tasks, level(vec![shell()], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.feed(TASKS_EMPTIED).background_tasks, None);
    let drained = router.feed(TASK_UPDATED);
    assert!(drained.settled);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));
}

#[test]
fn an_interrupt_of_the_attached_turn_leaves_an_open_reply_truthful() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let native = task_started("bg-1", true);
    let own = result(Some(&id), 0.25, "S");
    let before = feed_all(&mut router, &[&native, &own]);
    assert_eq!(before.settles, 0);
    assert_eq!(
        router.feed(INIT).background_tasks,
        level(vec![shell()], OPEN)
    );
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let ack = router.feed(&acknowledgement("req-1"));
    assert!(ack.interrupt_acknowledged);
    assert_eq!(ack.background_tasks, None);
    let cancelled = router.feed(&lifecycle(&id, "cancelled"));
    assert!(!cancelled.settled, "the open reply still holds the stream");
    assert!(cancelled.background_turns.is_empty());
    assert_eq!(cancelled.background_tasks, None);
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert!(closed.settled);
    assert!(closed.interrupted);
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(closed.background_tasks, level(vec![shell()], CLOSED));
}

#[test]
fn a_refused_level_is_offered_again_with_the_reply() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    router.forget_reported_background();
    assert_eq!(
        router.feed(KEEP_ALIVE).background_tasks,
        level(vec![], OPEN)
    );
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_refused_closing_level_is_offered_again() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    router.forget_reported_background();
    assert_eq!(
        router.feed(KEEP_ALIVE).background_tasks,
        level(vec![], CLOSED)
    );
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_refused_open_level_followed_by_the_close_still_reports_the_close() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    router.forget_reported_background();
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_refused_task_drain_level_is_offered_again() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(
        &mut router,
        &[TASKS_LISTED, TASK_STARTED, &own, &completed, TASKS_EMPTIED],
    );
    assert_eq!(turn.background_changes, 1);
    let drained = router.feed(TASK_UPDATED);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));
    router.forget_reported_background();
    assert_eq!(
        router.feed(KEEP_ALIVE).background_tasks,
        level(vec![], EXPECTED)
    );
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_reply_result_and_the_next_reply_init_in_one_chunk_keep_the_level_open() {
    let mut router = ClaudeSessionRouter::new();
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let chunk = [result(None, 0.5, "A"), INIT.to_vec()].concat();
    let step = router.feed(&chunk);
    assert_eq!(step.background_turns.len(), 1);
    assert!(step.background_turns[0].complete);
    assert_eq!(step.background_tasks, None);
    let closed = router.feed(&result(None, 0.75, "B"));
    assert_eq!(closed.background_turns.len(), 1);
    assert!(closed.background_turns[0].complete);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
}

fn waiting_for_a_shell(router: &mut ClaudeSessionRouter) {
    let (_, id) = owned_turn(router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(router, &[TASKS_LISTED, TASK_STARTED, &own, &completed]);
    assert_eq!(turn.settles, 0);
    assert_eq!(router.background_tasks(), shell_level(CLOSED));
}

fn shell_level(reply: ClaudeBackgroundReply) -> ClaudeBackgroundTasks {
    level(vec![shell()], reply).expect("shell level")
}

fn task_ended(status: &str) -> Vec<u8> {
    task_finished("bg-1", status)
}

#[test]
fn a_task_that_finishes_on_its_own_expects_the_wake_up_reply_until_it_opens() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    assert_eq!(router.feed(TASKS_EMPTIED).background_tasks, None);
    let drained = router.feed(TASK_UPDATED);
    assert!(drained.settled);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));
    assert_eq!(router.feed(TASK_NOTIFIED).background_tasks, None);
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let closed = router.feed(&result(None, 0.5, "background-finished"));
    assert_eq!(closed.background_turns.len(), 1);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_failed_task_expects_the_wake_up_reply_like_a_completed_one() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    let failed = router.feed(&task_ended("failed"));
    assert!(failed.settled);
    assert_eq!(failed.background_tasks, level(vec![], EXPECTED));
}

#[test]
fn a_task_the_user_stopped_or_that_was_killed_expects_no_reply() {
    for status in ["stopped", "killed", "cancelled", "interrupted"] {
        let mut router = ClaudeSessionRouter::new();
        waiting_for_a_shell(&mut router);
        let ended = router.feed(&task_ended(status));
        assert!(ended.settled, "{status}");
        assert_eq!(ended.background_tasks, level(vec![], CLOSED), "{status}");
        assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None, "{status}");
    }
}

#[test]
fn a_listed_task_that_vanishes_without_a_terminal_status_expects_no_reply() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    assert_eq!(router.feed(TASKS_EMPTIED).background_tasks, None);
    let vanished = router.feed(KEEP_ALIVE);
    assert!(vanished.settled);
    assert_eq!(vanished.background_tasks, level(vec![], CLOSED));
}

#[test]
fn a_finished_agent_expects_the_wake_up_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let started = line(serde_json::json!({
        "type": "system",
        "subtype": "task_started",
        "task_id": "agent-1",
        "task_type": "local_agent",
        "session_id": "sess-abcdefgh"
    }));
    let turn = feed_all(&mut router, &[&started, &own, &completed]);
    assert_eq!(turn.settles, 0);
    let finished = router.feed(&task_finished("agent-1", "completed"));
    assert!(finished.settled);
    assert_eq!(finished.background_tasks, level(vec![], EXPECTED));
}

fn tool_result(parent: Option<&str>) -> Vec<u8> {
    line(serde_json::json!({
        "type": "user",
        "parent_tool_use_id": parent,
        "session_id": "sess-abcdefgh",
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu-front", "content": "done"}
        ]}
    }))
}

fn running_command_whose_shell_finished(router: &mut ClaudeSessionRouter) -> String {
    let (_, id) = owned_turn(router);
    let listed = feed_all(router, &[TASKS_LISTED, TASK_STARTED]);
    assert_eq!(listed.background_changes, 1);
    let working = assistant("running the foreground command");
    let finished = feed_all(
        router,
        &[&working, TASK_UPDATED, TASK_NOTIFIED, TASKS_EMPTIED],
    );
    assert_eq!(finished.settles, 0);
    assert_eq!(finished.background_changes, 1);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
    id
}

#[test]
fn a_task_that_finishes_before_a_later_round_of_our_command_is_answered_by_that_command() {
    let mut router = ClaudeSessionRouter::new();
    let id = running_command_whose_shell_finished(&mut router);

    let foreground = task_started("front-1", false);
    let foreground_done = task_finished("front-1", "completed");
    let round = tool_result(None);
    let noted = assistant("NOTED");
    let own = result(Some(&id), 0.25, "NOTED");
    let completed = lifecycle(&id, "completed");
    let settling = feed_all(
        &mut router,
        &[
            &foreground,
            &foreground_done,
            &round,
            &noted,
            &own,
            &completed,
        ],
    );
    assert_eq!(settling.settles, 1);
    assert_eq!(settling.background_changes, 0);
    assert!(settling.background.is_empty());
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_task_that_finishes_during_the_final_answer_of_our_command_expects_a_reply_at_its_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let foreground = task_started("front-1", false);
    let foreground_done = task_finished("front-1", "completed");
    let round = tool_result(None);
    let before = feed_all(
        &mut router,
        &[
            TASKS_LISTED,
            TASK_STARTED,
            &foreground,
            &foreground_done,
            &round,
        ],
    );
    assert_eq!(before.settles, 0);
    let finished = feed_all(&mut router, &[TASK_UPDATED, TASK_NOTIFIED, TASKS_EMPTIED]);
    assert_eq!(finished.settles, 0);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());

    let answered = router.feed(&assistant("a long final answer"));
    assert_eq!(answered.background_tasks, None);
    let own = router.feed(&result(Some(&id), 0.25, "DONE"));
    assert_eq!(own.background_tasks, level(vec![], EXPECTED));
    let completed = router.feed(&lifecycle(&id, "completed"));
    assert!(own.settled || completed.settled);
    assert_eq!(completed.background_tasks, None);

    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let closed = router.feed(&result(None, 0.5, "NOTED"));
    assert_eq!(closed.background_turns.len(), 1);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_round_inside_a_subagent_does_not_answer_a_task_that_finished_meanwhile() {
    let mut router = ClaudeSessionRouter::new();
    let id = running_command_whose_shell_finished(&mut router);

    let sidechain = tool_result(Some("toolu-agent"));
    let own = result(Some(&id), 0.25, "DONE");
    let completed = lifecycle(&id, "completed");
    let settling = feed_all(&mut router, &[&sidechain, &own, &completed]);

    assert_eq!(settling.settles, 1);
    assert_eq!(settling.background_changes, 1);
    assert_eq!(
        router.background_tasks(),
        level(vec![], EXPECTED).expect("expected")
    );
}

#[test]
fn a_stopped_task_during_our_command_expects_nothing_at_its_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let stopped = task_ended("stopped");
    let own = result(Some(&id), 0.25, "DONE");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(
        &mut router,
        &[TASKS_LISTED, TASK_STARTED, &stopped, &own, &completed],
    );

    assert_eq!(turn.settles, 1);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
}

#[test]
fn a_task_that_finishes_while_a_reply_is_written_is_answered_only_by_a_later_round_of_it() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    assert_eq!(router.feed(INIT).background_tasks, Some(shell_level(OPEN)));
    let finished = feed_all(&mut router, &[TASKS_EMPTIED, TASK_UPDATED, TASK_NOTIFIED]);
    assert_eq!(finished.settles, 0);
    let round = tool_result(None);
    assert_eq!(router.feed(&round).background_tasks, None);

    let replied = router.feed(&result(None, 0.5, "noted"));
    assert_eq!(replied.background_turns.len(), 1);
    assert!(replied.settled);
    assert_eq!(replied.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
}

#[test]
fn a_task_that_finishes_during_the_final_answer_of_a_reply_expects_another_reply() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    assert_eq!(router.feed(INIT).background_tasks, Some(shell_level(OPEN)));
    let finished = feed_all(&mut router, &[TASKS_EMPTIED, TASK_UPDATED, TASK_NOTIFIED]);
    assert_eq!(finished.settles, 0);
    assert_eq!(
        router.background_tasks(),
        level(vec![], OPEN).expect("open")
    );

    let replied = router.feed(&result(None, 0.5, "first"));
    assert_eq!(replied.background_turns.len(), 1);
    assert!(replied.settled);
    assert_eq!(replied.background_tasks, level(vec![], EXPECTED));
    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let answered = router.feed(&result(None, 0.75, "second"));
    assert_eq!(answered.background_tasks, level(vec![], CLOSED));
}

#[test]
fn a_task_that_finishes_after_our_command_ended_is_expected_at_once() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let waiting = feed_all(&mut router, &[TASK_STARTED, &own, &completed]);
    assert_eq!(waiting.settles, 0);
    assert_eq!(router.background_tasks(), shell_level(CLOSED));

    let drained = router.feed(TASK_UPDATED);
    assert!(drained.settled);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));
}

#[test]
fn a_late_bookend_after_the_reply_opened_never_expects_another_reply() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    let drained = feed_all(
        &mut router,
        &[TASKS_EMPTIED, TASK_UPDATED, INIT, TASK_NOTIFIED],
    );
    assert_eq!(drained.settles, 1);
    assert_eq!(
        router.background_tasks(),
        level(vec![], OPEN).expect("open")
    );
    let closed = router.feed(&result(None, 0.5, "background-finished"));
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(TASK_NOTIFIED).background_tasks, None);
}

#[test]
fn an_expected_reply_that_never_opens_lapses_at_the_cap_and_stays_lapsed() {
    let mut router = ClaudeSessionRouter::new();
    waiting_for_a_shell(&mut router);
    let drained = router.feed(TASK_UPDATED);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));

    router.wake_up_reply_cap = Duration::ZERO;
    assert_eq!(
        router.feed(KEEP_ALIVE).background_tasks,
        level(vec![], CLOSED)
    );
    router.wake_up_reply_cap = WAKE_UP_REPLY_CAP;
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
}

#[test]
fn an_expected_reply_keeps_the_session_live_and_an_idle_level_does_not() {
    assert_eq!(WAKE_UP_REPLY_CAP, Duration::from_secs(30));
    assert!(level(vec![], EXPECTED)
        .expect("expected")
        .keeps_session_live());
    assert!(level(vec![], OPEN).expect("open").keeps_session_live());
    assert!(shell_level(CLOSED).keeps_session_live());
    assert!(!ClaudeBackgroundTasks::default().keeps_session_live());
}

fn expecting_a_reply(router: &mut ClaudeSessionRouter) {
    waiting_for_a_shell(router);
    let drained = router.feed(TASK_UPDATED);
    assert!(drained.settled);
    assert_eq!(drained.background_tasks, level(vec![], EXPECTED));
}

#[test]
fn a_command_accepted_while_a_reply_is_expected_takes_the_notification_over_for_good() {
    let mut router = ClaudeSessionRouter::new();
    expecting_a_reply(&mut router);
    let (_, id) = attach(&mut router);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());

    let queued = router.feed(&lifecycle(&id, "queued"));
    assert_eq!(queued.background_tasks, level(vec![], CLOSED));
    let started = lifecycle(&id, "started");
    let working = assistant("working");
    let own = result(Some(&id), 0.5, "DONE");
    let completed = lifecycle(&id, "completed");
    let turn = feed_all(&mut router, &[&started, INIT, &working, &own, &completed]);
    assert_eq!(turn.settles, 1);
    assert_eq!(turn.background_changes, 0);
    assert!(turn.background.is_empty());
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
}

#[test]
fn a_command_read_in_one_chunk_while_a_reply_is_expected_publishes_the_idle_level_once() {
    let mut router = ClaudeSessionRouter::new();
    expecting_a_reply(&mut router);
    let (_, id) = attach(&mut router);

    let step = router.feed(&turn_stream(&id, 0.5, "DONE"));

    assert!(step.settled);
    assert_eq!(step.background_tasks, level(vec![], CLOSED));
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
}

#[test]
fn a_steer_accepted_while_a_reply_is_expected_takes_the_notification_over() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let first = task_started("bg-0", true);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let waiting = feed_all(&mut router, &[&first, TASK_STARTED, &own, &completed]);
    assert_eq!(waiting.settles, 0);
    let first_done = router.feed(&task_finished("bg-0", "completed"));
    assert_eq!(first_done.background_tasks, Some(shell_level(EXPECTED)));

    let (steer, _) = ledger.reserve(b"{}").expect("steer reserved");
    let queued = router.feed(&lifecycle(&steer, "queued"));
    assert_eq!(queued.background_tasks, Some(shell_level(CLOSED)));
    let started = lifecycle(&steer, "started");
    let steered = result(Some(&steer), 0.5, "STEERED");
    let steer_done = lifecycle(&steer, "completed");
    let answered = feed_all(&mut router, &[&started, INIT, &steered, &steer_done]);
    assert_eq!(answered.settles, 0);
    assert_eq!(answered.background_changes, 0);
    assert_eq!(router.background_tasks(), shell_level(CLOSED));
}

#[test]
fn a_reply_that_opens_before_the_accepted_command_starts_is_still_shown_as_a_reply() {
    let mut router = ClaudeSessionRouter::new();
    expecting_a_reply(&mut router);
    let (_, id) = attach(&mut router);
    let queued = router.feed(&lifecycle(&id, "queued"));
    assert_eq!(queued.background_tasks, level(vec![], CLOSED));

    assert_eq!(router.feed(INIT).background_tasks, level(vec![], OPEN));
    let closed = router.feed(&result(None, 0.5, "background-finished"));
    assert_eq!(closed.background_turns.len(), 1);
    assert_eq!(closed.background_tasks, level(vec![], CLOSED));
}

#[test]
fn reading_the_level_applies_the_cap_without_another_frame() {
    let mut router = ClaudeSessionRouter::with_wake_up_reply_cap(WAKE_UP_REPLY_CAP);
    expecting_a_reply(&mut router);
    assert_eq!(router.background_tasks().reply, EXPECTED);

    router.wake_up_reply_cap = Duration::ZERO;

    assert_eq!(router.background_tasks(), ClaudeBackgroundTasks::default());
    assert!(!router.background_tasks().keeps_session_live());
}
