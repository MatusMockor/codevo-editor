use super::*;

fn task_updated(id: &str, status: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system",
        "subtype":"task_updated",
        "task_id":id,
        "patch":{"status":status},
        "session_id":"sess-abcdefgh"
    }))
}

fn task_progress(id: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system",
        "subtype":"task_progress",
        "task_id":id,
        "description":"still running",
        "session_id":"sess-abcdefgh"
    }))
}

fn routed(output: &[u8]) -> Vec<String> {
    lines_of(output)
        .iter()
        .map(|frame| {
            let label = ["subtype", "state", "type"]
                .iter()
                .find_map(|key| frame[key].as_str())
                .unwrap_or_default();
            match frame["task_id"].as_str() {
                Some(task) => format!("{label}:{task}"),
                None => label.to_string(),
            }
        })
        .collect()
}

fn turn_left_waiting_for(router: &mut ClaudeSessionRouter, task: &str) {
    let (_, id) = owned_turn(router);
    let native = task_started(task, true);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let waiting = feed_all(router, &[&native, &own, &completed]);
    assert_eq!(waiting.settles, 0);
    assert!(router.settle_finished_foreground().is_some());
    assert!(router.live_background_task(task));
}

#[test]
fn a_turn_receives_every_update_of_the_task_it_started() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let native = task_started("own", true);
    let progress = task_progress("own");
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let updated = task_updated("own", "completed");
    let notified = task_finished("own", "completed");

    let waiting = task_started("still-running", true);
    let before = feed_all(
        &mut router,
        &[&native, &waiting, &progress, &own, &completed],
    );
    let after = feed_all(&mut router, &[&updated, &notified]);

    assert_eq!(
        routed(&before.turn),
        [
            "task_started:own",
            "task_started:still-running",
            "task_progress:own",
            "success",
            "completed"
        ]
    );
    assert_eq!(after.turn, [updated, notified].concat());
    assert_eq!(after.settles, 0);
}

#[test]
fn the_updates_of_a_shell_left_by_an_earlier_turn_never_reach_the_next_turn() {
    let mut router = ClaudeSessionRouter::new();
    turn_left_waiting_for(&mut router, "left");
    let (_, id) = owned_turn(&mut router);
    let native = task_started("own", true);
    let left_progress = task_progress("left");
    let left_updated = task_updated("left", "completed");
    let left_notified = task_finished("left", "completed");
    let own_updated = task_updated("own", "completed");
    let own_notified = task_finished("own", "completed");
    let own = result(Some(&id), 0.5, "TWO");
    let completed = lifecycle(&id, "completed");

    let second = feed_all(
        &mut router,
        &[
            &native,
            &left_progress,
            &left_updated,
            &left_notified,
            &own,
            &completed,
            &own_updated,
            &own_notified,
        ],
    );

    assert_eq!(
        routed(&second.turn),
        [
            "task_started:own",
            "success",
            "completed",
            "task_updated:own"
        ]
    );
    assert_eq!(second.settles, 1);
    assert_eq!(second.failure, None);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn the_updates_of_a_task_that_survived_an_interrupt_never_reach_the_next_turn() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "t1");
    let (_, id) = owned_turn(&mut router);
    let stopped = task_updated("t1", "killed");
    let notified = task_finished("t1", "stopped");
    let own = result(Some(&id), 0.5, "TWO");
    let completed = lifecycle(&id, "completed");

    let second = feed_all(&mut router, &[&stopped, &notified, &own, &completed]);

    assert_eq!(routed(&second.turn), ["success"]);
    assert_eq!(second.settles, 1);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_task_that_started_before_our_command_did_is_never_our_output() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let (_, id) = attach(&mut router);
    let queued = lifecycle(&id, "queued");
    let early = task_started("early", true);
    let started = lifecycle(&id, "started");
    let progress = task_progress("early");
    let updated = task_updated("early", "completed");
    let notified = task_finished("early", "completed");

    let before = feed_all(&mut router, &[&queued, &early]);
    assert_eq!(before.turn, queued);
    assert_eq!(before.background_changes, 1);
    assert!(router.live_background_task("early"));
    let turn = feed_all(
        &mut router,
        &[&started, INIT, &progress, &updated, &notified],
    );

    assert_eq!(turn.turn, [started, INIT.to_vec()].concat());
    assert_eq!(turn.failure, None);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_task_restarted_by_the_next_turn_belongs_to_that_turn() {
    let mut router = ClaudeSessionRouter::new();
    turn_left_waiting_for(&mut router, "left");
    let (_, id) = owned_turn(&mut router);
    let restarted = task_started("left", true);
    let updated = task_updated("left", "completed");

    let second = feed_all(&mut router, &[&restarted, &updated]);

    assert_eq!(second.turn, [restarted, updated].concat());
    assert_eq!(second.settles, 0);
    assert!(!router
        .feed(&result(Some(&id), 0.5, "TWO"))
        .turn_output
        .is_empty());
}

#[test]
fn a_frame_inside_a_subagent_is_never_mistaken_for_a_foreign_task_update() {
    let mut router = ClaudeSessionRouter::new();
    turn_left_waiting_for(&mut router, "left");
    owned_turn(&mut router);
    let nested = line(serde_json::json!({
        "type":"system",
        "subtype":"task_progress",
        "task_id":"left",
        "parent_tool_use_id":"toolu-agent",
        "session_id":"sess-abcdefgh"
    }));

    assert_eq!(router.feed(&nested).turn_output, nested);
}
