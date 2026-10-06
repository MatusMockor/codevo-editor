use super::*;

const OPEN: ClaudeBackgroundReply = ClaudeBackgroundReply::InProgress;
const CLOSED: ClaudeBackgroundReply = ClaudeBackgroundReply::None;

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
    assert_eq!(step.background_tasks, None);
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
    assert_eq!(drained.background_tasks, level(vec![], CLOSED));
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
    assert_eq!(drained.background_tasks, level(vec![], CLOSED));
    router.forget_reported_background();
    assert_eq!(
        router.feed(KEEP_ALIVE).background_tasks,
        level(vec![], CLOSED)
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
