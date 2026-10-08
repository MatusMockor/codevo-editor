use super::*;

const EXPECTED: ClaudeBackgroundReply = ClaudeBackgroundReply::Expected;
const CLEARED_SESSION: &str = "sess-cleared1";

fn idle() -> ClaudeBackgroundTasks {
    ClaudeBackgroundTasks::default()
}

fn expecting() -> ClaudeBackgroundTasks {
    ClaudeBackgroundTasks {
        reply: EXPECTED,
        ..ClaudeBackgroundTasks::default()
    }
}

fn in_session(frame: &[u8], session: &str) -> Vec<u8> {
    String::from_utf8_lossy(frame)
        .replace("sess-abcdefgh", session)
        .into_bytes()
}

fn shell_finished_unanswered(router: &mut ClaudeSessionRouter, session: &str) {
    let working = in_session(&assistant("running the foreground command"), session);
    let frames = [
        in_session(TASKS_LISTED, session),
        in_session(TASK_STARTED, session),
        working,
        in_session(TASK_UPDATED, session),
        in_session(TASK_NOTIFIED, session),
        in_session(TASKS_EMPTIED, session),
    ];
    let frames: Vec<&[u8]> = frames.iter().map(Vec::as_slice).collect();
    let finished = feed_all(router, &frames);
    assert_eq!(finished.settles, 0);
    assert_eq!(finished.failure, None);
    assert_eq!(router.background_tasks(), idle());
}

fn running_command_with_an_unanswered_task_end(
    router: &mut ClaudeSessionRouter,
) -> (Arc<ClaudeInputLifecycle>, String) {
    let (ledger, id) = owned_turn(router);
    shell_finished_unanswered(router, "sess-abcdefgh");
    (ledger, id)
}

fn root_tool_result_in(session: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type": "user",
        "parent_tool_use_id": null,
        "session_id": session,
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu-front", "content": "done"}
        ]}
    }))
}

fn reset_of_the_first_session() -> Vec<u8> {
    line(serde_json::json!({
        "type": "conversation_reset",
        "new_conversation_id": "next",
        "session_id": "sess-abcdefgh"
    }))
}

fn stays_idle(router: &mut ClaudeSessionRouter) {
    assert_eq!(router.background_tasks(), idle());
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.background_tasks(), idle());
}

#[test]
fn a_command_that_ends_on_its_own_expects_the_reply_to_the_task_end_it_never_answered() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = running_command_with_an_unanswered_task_end(&mut router);

    let own = router.feed(&result(Some(&id), 0.25, "DONE"));
    let completed = router.feed(&lifecycle(&id, "completed"));

    assert!(own.settled || completed.settled);
    assert!(!own.interrupted && !own.cancelled && !own.result_failed);
    assert_eq!(router.background_tasks(), expecting());
}

#[test]
fn an_interrupted_command_drops_the_task_end_it_never_answered() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = running_command_with_an_unanswered_task_end(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();

    let acknowledged = router.feed(&acknowledgement("req-1"));
    assert!(!acknowledged.settled);
    let end = router.feed(&interrupted_result(&id));

    assert!(end.settled);
    assert!(end.interrupted);
    assert_eq!(end.background_tasks, None);
    assert_eq!(
        router.feed(&lifecycle(&id, "cancelled")).background_tasks,
        None
    );
    stays_idle(&mut router);
}

#[test]
fn a_cancelled_command_drops_the_task_end_it_never_answered() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = running_command_with_an_unanswered_task_end(&mut router);

    let end = router.feed(&lifecycle(&id, "cancelled"));

    assert!(end.settled);
    assert!(end.cancelled);
    assert_eq!(end.background_tasks, None);
    stays_idle(&mut router);
}

#[test]
fn a_command_that_fails_drops_the_task_end_it_never_answered() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = running_command_with_an_unanswered_task_end(&mut router);

    let failed = router.feed(&interrupted_result(&id));
    let completed = router.feed(&lifecycle(&id, "completed"));

    assert!(failed.settled || completed.settled);
    assert!(failed.result_failed || completed.result_failed);
    assert!(!failed.interrupted && !completed.interrupted);
    assert_eq!(failed.background_tasks, None);
    assert_eq!(completed.background_tasks, None);
    stays_idle(&mut router);
}

#[test]
fn a_failed_command_that_still_waits_for_a_task_drops_the_task_end_it_never_answered() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let waiting = task_started("bg-wait", true);
    let finished = task_finished("bg-1", "completed");
    let before = feed_all(&mut router, &[TASK_STARTED, &waiting, &finished]);
    assert_eq!(before.settles, 0);

    let failed = router.feed(&interrupted_result(&id));
    let completed = router.feed(&lifecycle(&id, "completed"));

    assert!(!failed.settled && !completed.settled);
    assert_eq!(router.live_background_tasks(), 1);
    assert_eq!(router.background_tasks().reply, ClaudeBackgroundReply::None);
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    let settled = router
        .settle_finished_foreground()
        .expect("the foreground is finished");
    assert!(settled.result_failed);
    assert_eq!(router.feed(KEEP_ALIVE).background_tasks, None);
    assert_eq!(router.background_tasks().reply, ClaudeBackgroundReply::None);
}

#[test]
fn a_natural_result_racing_a_stop_still_expects_the_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = running_command_with_an_unanswered_task_end(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    assert!(!router.feed(&acknowledgement("req-1")).settled);

    let own = router.feed(&result(Some(&id), 0.25, "DONE"));

    assert!(own.settled);
    assert!(!own.interrupted);
    assert_eq!(router.background_tasks(), expecting());
}

#[test]
fn a_stop_that_settles_after_the_command_ended_decides_the_unanswered_task_end() {
    for withdrawn in [false, true] {
        let mut router = ClaudeSessionRouter::new();
        let (ledger, id) = running_command_with_an_unanswered_task_end(&mut router);
        ledger.reserve(b"{}").expect("steer reserved");
        router.interrupt_sent("req-1".to_string());
        let own = result(Some(&id), 0.25, "DONE");
        let completed = lifecycle(&id, "completed");
        let ended = feed_all(&mut router, &[&own, &completed]);
        assert_eq!(ended.settles, 0, "{withdrawn}");
        assert_eq!(ended.background_changes, 0, "{withdrawn}");
        assert_eq!(router.background_tasks(), idle(), "{withdrawn}");

        if withdrawn {
            router.withdraw_interrupt("req-1");
            assert_eq!(
                router.feed(KEEP_ALIVE).background_tasks,
                Some(expecting()),
                "a stop that was never delivered leaves the reply expected"
            );
            continue;
        }
        ledger.abandon_all();
        let stopped = router.feed(&acknowledgement("req-1"));
        assert!(stopped.settled);
        assert!(stopped.interrupted);
        stays_idle(&mut router);
    }
}

#[test]
fn a_task_that_ends_after_a_stopped_command_ended_waits_for_the_stop_to_be_decided() {
    for withdrawn in [false, true] {
        let mut router = ClaudeSessionRouter::new();
        let (ledger, id) = owned_turn(&mut router);
        ledger.reserve(b"{}").expect("steer reserved");
        assert_eq!(feed_all(&mut router, &[TASK_STARTED]).background_changes, 1);
        router.interrupt_sent("req-1".to_string());
        let own = result(Some(&id), 0.25, "DONE");
        let completed = lifecycle(&id, "completed");
        assert_eq!(feed_all(&mut router, &[&own, &completed]).settles, 0);

        let finished = router.feed(TASK_UPDATED);
        assert!(!finished.settled, "{withdrawn}");
        assert_eq!(finished.background_tasks, Some(idle()), "{withdrawn}");
        assert_eq!(router.feed(TASK_NOTIFIED).background_tasks, None);

        if withdrawn {
            router.withdraw_interrupt("req-1");
            assert_eq!(
                router.feed(KEEP_ALIVE).background_tasks,
                Some(expecting()),
                "a stop that was never delivered leaves the reply expected"
            );
            continue;
        }
        ledger.abandon_all();
        let stopped = router.feed(&acknowledgement("req-1"));
        assert!(stopped.settled);
        assert!(stopped.interrupted);
        stays_idle(&mut router);
    }
}

#[test]
fn the_last_task_that_ends_after_a_failed_command_expects_no_reply() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let failed = interrupted_result(&id);
    let completed = lifecycle(&id, "completed");
    let waiting = feed_all(&mut router, &[TASK_STARTED, &failed, &completed]);
    assert_eq!(waiting.settles, 0);
    assert_eq!(router.live_background_tasks(), 1);

    let drained = router.feed(TASK_UPDATED);

    assert!(drained.settled);
    assert!(drained.result_failed);
    assert_eq!(drained.background_tasks, Some(idle()));
    assert_eq!(router.feed(TASK_NOTIFIED).background_tasks, None);
    stays_idle(&mut router);
}

#[test]
fn a_reply_already_expected_survives_a_later_task_end_that_is_dropped() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    ledger.reserve(b"{}").expect("steer reserved");
    let second = task_started("bg-2", true);
    let own = result(Some(&id), 0.25, "DONE");
    let completed = lifecycle(&id, "completed");
    let waiting = feed_all(&mut router, &[TASK_STARTED, &second, &own, &completed]);
    assert_eq!(waiting.settles, 0);
    assert_eq!(
        router
            .feed(TASK_UPDATED)
            .background_tasks
            .map(|level| level.reply),
        Some(EXPECTED)
    );

    router.interrupt_sent("req-1".to_string());
    let later = router.feed(&task_finished("bg-2", "completed"));
    assert_eq!(
        later.background_tasks.map(|level| level.reply),
        Some(EXPECTED)
    );
    ledger.abandon_all();
    let stopped = router.feed(&acknowledgement("req-1"));

    assert!(stopped.interrupted);
    assert_eq!(router.background_tasks(), expecting());
}

#[test]
fn the_end_of_the_session_drops_an_unanswered_task_end_and_an_expected_reply() {
    let mut unanswered = ClaudeSessionRouter::new();
    running_command_with_an_unanswered_task_end(&mut unanswered);
    assert_eq!(unanswered.finish().background_tasks, None);
    unanswered.detach();
    stays_idle(&mut unanswered);

    let mut expected = ClaudeSessionRouter::new();
    let (_, id) = running_command_with_an_unanswered_task_end(&mut expected);
    let own = result(Some(&id), 0.25, "DONE");
    let completed = lifecycle(&id, "completed");
    assert_eq!(feed_all(&mut expected, &[&own, &completed]).settles, 1);
    assert_eq!(expected.background_tasks(), expecting());
    assert_eq!(expected.finish().background_tasks, Some(idle()));
    stays_idle(&mut expected);
}

#[test]
fn a_conversation_reset_drops_the_task_end_of_the_conversation_it_replaced() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = running_command_with_an_unanswered_task_end(&mut router);

    let reset = reset_of_the_first_session();
    let fresh = in_session(INIT, CLEARED_SESSION);
    let own = in_session(&result(Some(&id), 0.25, "CLEARED"), CLEARED_SESSION);
    let completed = lifecycle(&id, "completed");
    let cleared = feed_all(&mut router, &[&reset, &fresh, &own, &completed]);

    assert_eq!(cleared.settles, 1);
    assert_eq!(cleared.failure, None);
    assert_eq!(router.conversation(), Some(CLEARED_SESSION));
    stays_idle(&mut router);
}

#[test]
fn only_a_tool_result_of_the_current_session_answers_its_finished_task() {
    let rounds = [
        ("sess-abcdefgh", expecting()),
        ("sess-foreign1", expecting()),
        (CLEARED_SESSION, idle()),
    ];
    for (round_session, level) in rounds {
        let mut router = ClaudeSessionRouter::new();
        let (_, id) = owned_turn(&mut router);
        let reset = reset_of_the_first_session();
        let fresh = in_session(INIT, CLEARED_SESSION);
        assert_eq!(feed_all(&mut router, &[&reset, &fresh]).failure, None);
        shell_finished_unanswered(&mut router, CLEARED_SESSION);

        router.feed(&root_tool_result_in(round_session));
        let own = in_session(&result(Some(&id), 0.25, "DONE"), CLEARED_SESSION);
        let completed = lifecycle(&id, "completed");
        let settling = feed_all(&mut router, &[&own, &completed]);

        assert_eq!(settling.settles, 1, "{round_session}");
        assert_eq!(router.background_tasks(), level, "{round_session}");
    }
}
