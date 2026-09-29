use super::*;

#[test]
fn a_cancelled_command_after_its_result_or_an_interrupt_is_not_a_cancellation() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let native = task_started("t1", true);
    let own = result(Some(&id), 0.25, "S");
    let cancelled = lifecycle(&id, "cancelled");
    let collected = feed_all(&mut router, &[&native, &own, &cancelled]);
    assert_eq!(collected.settles, 0);
    let drained = router.feed(&task_finished("t1", "completed"));
    assert!(drained.settled);
    assert!(!drained.cancelled);

    let (ledger, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    assert!(!router.feed(&acknowledgement("req-1")).settled);
    let interrupted = router.feed(&lifecycle(&id, "cancelled"));
    assert!(interrupted.settled);
    assert!(interrupted.interrupted);
    assert!(!interrupted.cancelled);
}

fn permission_request(request_id: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"control_request",
        "request_id":request_id,
        "request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"cat out.txt"}}
    }))
}

#[test]
fn thousands_of_foreground_tasks_across_many_turns_keep_the_session_alive() {
    let mut router = ClaudeSessionRouter::new();
    for turn in 0..120_u32 {
        let (_, id) = owned_turn(&mut router);
        for call in 0..50 {
            let task = format!("bash-{turn}-{call}");
            let started = task_started(&task, false);
            let finished = task_finished(&task, "completed");
            let collected = feed_all(&mut router, &[&started, &finished]);
            assert_eq!(collected.failure, None, "turn {turn} call {call}");
        }
        let own = result(Some(&id), 0.01 * f64::from(turn + 1), "ok");
        assert!(router.feed(&own).settled, "turn {turn} settles");
    }
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_task_started_inside_an_unprompted_turn_never_blocks_the_attached_turn() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let first = task_started("t1", true);
    let second = task_started("t2", true);
    let own = result(Some(&id), 0.25, "STARTED");
    let completed = lifecycle(&id, "completed");
    let first_done = task_finished("t1", "completed");
    let before = feed_all(
        &mut router,
        &[&first, &second, &own, &completed, &first_done],
    );
    assert_eq!(before.settles, 0, "t2 is still live");
    let third = task_started("t3", true);
    let unprompted = feed_all(&mut router, &[INIT, &third, &result(None, 0.5, "bg-t1")]);
    assert_eq!(unprompted.settles, 0);
    assert_eq!(unprompted.background.len(), 1);
    let drained = router.feed(&task_finished("t2", "completed"));
    assert!(drained.settled, "t3 belongs to the unprompted turn");
    assert_eq!(router.live_background_tasks(), 1);
}

fn inside_an_unprompted_turn(router: &mut ClaudeSessionRouter) {
    let (_, id) = owned_turn(router);
    let native = task_started("bg-1", true);
    let own = result(Some(&id), 0.25, "started");
    let completed = lifecycle(&id, "completed");
    let settled = feed_all(router, &[&native, &own, &completed, TASK_NOTIFIED]);
    assert_eq!(settled.settles, 1);
    let opened = router.feed(INIT);
    assert!(!opened.unowned_activity);
}

#[test]
fn a_permission_request_inside_an_unprompted_turn_is_denied_not_fatal() {
    let mut router = ClaudeSessionRouter::new();
    inside_an_unprompted_turn(&mut router);
    let step = router.feed(&permission_request("perm-1"));
    assert!(!step.unowned_activity);
    assert_eq!(step.permission_denials, vec!["perm-1".to_string()]);
    let closed = feed_all(&mut router, &[&assistant("bg"), &result(None, 0.5, "bg")]);
    assert!(!closed.unowned);
    assert_eq!(closed.background.len(), 1);
    assert!(closed.background[0].complete);
    let text = String::from_utf8_lossy(&closed.background[0].output).into_owned();
    assert!(text.contains("perm-1"), "{text}");
}

#[test]
fn other_unowned_control_requests_still_end_the_session() {
    let mut router = ClaudeSessionRouter::new();
    inside_an_unprompted_turn(&mut router);
    let step = router.feed(&permission_request("bad id with spaces"));
    assert!(step.unowned_activity);
    assert!(step.permission_denials.is_empty());

    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    let stream = turn_stream(first.initial_command_id(), 0.25, "ONE");
    assert!(router.feed(&stream).settled);
    attach(&mut router);
    let step = router.feed(&permission_request("perm-2"));
    assert!(step.unowned_activity);
    assert!(step.permission_denials.is_empty());

    let mut router = ClaudeSessionRouter::new();
    let step = router.feed(&permission_request("perm-3"));
    assert!(step.unowned_activity);
    assert!(step.permission_denials.is_empty());
}

#[test]
fn non_json_lines_never_enter_a_background_turn() {
    let mut router = ClaudeSessionRouter::new();
    let opened = feed_all(&mut router, &[INIT, b"not json at all\n", &assistant("bg")]);
    assert!(opened.background.is_empty());
    let closed = router.feed(&result(None, 0.5, "bg"));
    assert_eq!(closed.background_turns.len(), 1);
    let turn = &closed.background_turns[0];
    assert!(turn.truncated);
    assert!(turn.complete);
    assert_eq!(lines_of(&turn.output).len(), 3);
}

fn awaiting_native_drain(router: &mut ClaudeSessionRouter) -> Arc<ClaudeInputLifecycle> {
    let (ledger, id) = owned_turn(router);
    let native = task_started("bg-1", true);
    let own = result(Some(&id), 0.25, "started");
    let completed = lifecycle(&id, "completed");
    let collected = feed_all(router, &[&native, &own, &completed]);
    assert_eq!(collected.settles, 0);
    ledger
}

#[test]
fn a_turn_awaiting_only_native_tasks_settles_naturally_and_leaves_them_inherited() {
    let mut router = ClaudeSessionRouter::new();
    let ledger = awaiting_native_drain(&mut router);
    assert!(router.settle_finished_foreground().is_some());
    assert!(!router.is_attached_to(&ledger));
    assert!(ledger.is_closed());
    assert_eq!(router.live_background_tasks(), 1);
    let drained = feed_all(
        &mut router,
        &[
            TASK_NOTIFIED,
            INIT,
            &assistant("bg"),
            &result(None, 0.5, "bg"),
        ],
    );
    assert_eq!(drained.settles, 0);
    assert!(!drained.unowned);
    assert_eq!(drained.background.len(), 1);
    assert!(drained.background[0].complete);
    assert_eq!(router.live_background_tasks(), 0);
}

#[test]
fn a_running_foreground_is_never_settled_without_an_interrupt() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, _) = owned_turn(&mut router);
    let native = task_started("bg-1", true);
    feed_all(&mut router, &[&native, &assistant("working")]);
    assert!(router.settle_finished_foreground().is_none());
    assert!(router.is_attached_to(&ledger));
    assert!(!ledger.is_closed());
}

#[test]
fn a_pending_steer_keeps_the_foreground_running() {
    let mut router = ClaudeSessionRouter::new();
    let ledger = awaiting_native_drain(&mut router);
    ledger.reserve(b"{}").expect("steer reserved");
    assert!(router.settle_finished_foreground().is_none());
    assert!(router.is_attached_to(&ledger));
    assert!(!ledger.is_closed());
}

#[test]
fn a_running_steer_keeps_the_foreground_running() {
    let mut router = ClaudeSessionRouter::new();
    let ledger = awaiting_native_drain(&mut router);
    let (steer, _) = ledger.reserve(b"{}").expect("steer reserved");
    feed_all(
        &mut router,
        &[&lifecycle(&steer, "queued"), &lifecycle(&steer, "started")],
    );
    assert!(router.settle_finished_foreground().is_none());
    assert!(router.is_attached_to(&ledger));
}

#[test]
fn an_interrupting_turn_is_never_settled_naturally() {
    let mut router = ClaudeSessionRouter::new();
    let ledger = awaiting_native_drain(&mut router);
    router.interrupt_sent("req-1".to_string());
    assert!(router.settle_finished_foreground().is_none());
    assert!(router.is_attached_to(&ledger));
}

fn settling_step(router: &mut ClaudeSessionRouter, lines: &[&[u8]]) -> RouterStep {
    let mut settling = None;
    for bytes in lines {
        let step = router.feed(bytes);
        if step.settled {
            settling = Some(step);
        }
    }
    settling.expect("the turn settled")
}

#[test]
fn an_error_result_of_our_turn_settles_as_a_failed_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let failed = interrupted_result(&id);
    let completed = lifecycle(&id, "completed");
    let step = settling_step(&mut router, &[&failed, &completed]);
    assert!(step.result_failed);
    assert!(!step.interrupted);
    assert!(!step.cancelled);
}

#[test]
fn a_successful_result_of_our_turn_is_not_a_failed_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let own = result(Some(&id), 0.25, "S");
    let completed = lifecycle(&id, "completed");
    let step = settling_step(&mut router, &[&own, &completed]);
    assert!(!step.result_failed);
}

#[test]
fn an_interrupted_result_is_never_a_failed_result() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.abandon_all();
    let failed = interrupted_result(&id);
    let cancelled = lifecycle(&id, "cancelled");
    let step = settling_step(
        &mut router,
        &[&acknowledgement("req-1"), &failed, &cancelled],
    );
    assert!(step.interrupted);
    assert!(!step.result_failed);
}

#[test]
fn a_failed_result_awaiting_only_native_tasks_settles_as_a_failed_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let native = task_started("bg-1", true);
    let failed = interrupted_result(&id);
    let completed = lifecycle(&id, "completed");
    let collected = feed_all(&mut router, &[&native, &failed, &completed]);
    assert_eq!(collected.settles, 0);
    let step = router
        .settle_finished_foreground()
        .expect("settled naturally");
    assert!(step.settled);
    assert!(step.result_failed);
}

#[test]
fn a_later_successful_steer_result_clears_an_earlier_failure() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    let (steer, _) = ledger.reserve(b"{}").expect("steer reserved");
    let failed = interrupted_result(&id);
    let completed = lifecycle(&id, "completed");
    let steer_started = lifecycle(&steer, "started");
    let steer_result = result(Some(&steer), 0.5, "S");
    let steer_completed = lifecycle(&steer, "completed");
    let step = settling_step(
        &mut router,
        &[
            &failed,
            &completed,
            &lifecycle(&steer, "queued"),
            &steer_started,
            INIT,
            &steer_result,
            &steer_completed,
        ],
    );
    assert!(!step.result_failed);
}

#[test]
fn a_withdrawn_interrupt_restores_natural_settlement_and_ignores_its_ack() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    router.withdraw_interrupt("req-1");
    assert!(
        !router
            .feed(&acknowledgement("req-1"))
            .interrupt_acknowledged
    );
    let native = task_started("bg-1", true);
    let failed = interrupted_result(&id);
    let completed = lifecycle(&id, "completed");
    let collected = feed_all(&mut router, &[&native, &failed, &completed]);
    assert_eq!(collected.settles, 0, "the drain is awaited again");
    let drained = router.feed(&task_finished("bg-1", "completed"));
    assert!(drained.settled);
    assert!(!drained.interrupted);
    assert!(drained.result_failed);
}

#[test]
fn withdrawing_a_different_interrupt_keeps_the_pending_one() {
    let mut router = ClaudeSessionRouter::new();
    let (ledger, id) = owned_turn(&mut router);
    router.interrupt_sent("req-1".to_string());
    ledger.begin_interrupt();
    router.withdraw_interrupt("req-2");
    assert!(
        router
            .feed(&acknowledgement("req-1"))
            .interrupt_acknowledged
    );
    let failed = interrupted_result(&id);
    let cancelled = lifecycle(&id, "cancelled");
    let step = settling_step(&mut router, &[&failed, &cancelled]);
    assert!(step.interrupted);
}

#[test]
fn a_closing_result_that_does_not_fit_keeps_its_cost_for_the_next_accepted_result() {
    let mut router = ClaudeSessionRouter::new();
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    let oversized = result(None, 0.5, &"z".repeat(MAX_BACKGROUND_TURN_BYTES));
    let collected = feed_all(&mut router, &[INIT, &oversized]);
    assert_eq!(collected.background.len(), 1);
    let background = &collected.background[0];
    assert!(background.truncated);
    assert!(background.complete);
    assert!(lines_of(&background.output)
        .iter()
        .all(|routed| routed["type"] != "result"));
    let (second, _) = attach(&mut router);
    let two = router.feed(&turn_stream(second.initial_command_id(), 1.0, "TWO"));
    let two = lines_of(&two.turn_output).pop().unwrap();
    assert_eq!(two["total_cost_usd"], 0.75, "the dropped delta is carried");
    assert_eq!(two["codevo_process_total_cost_usd"], 1.0);
}

#[test]
fn an_unattributed_result_that_does_not_fit_keeps_its_cost_for_our_result() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let oversized = null_uuid_result(0.5, &"z".repeat(MAX_BACKGROUND_TURN_BYTES));
    let collected = feed_all(&mut router, &[&oversized]);
    assert_eq!(collected.background.len(), 1);
    assert!(collected.background[0].truncated);
    assert!(collected.background[0].output.is_empty());
    let own = router.feed(&result(Some(&id), 1.0, "S"));
    assert!(own.settled);
    let own = lines_of(&own.turn_output).pop().unwrap();
    assert_eq!(own["total_cost_usd"], 1.0);
}

fn control_request(request_id: &str, subtype: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"control_request",
        "request_id":request_id,
        "request":{"subtype":subtype}
    }))
}

#[test]
fn an_unsupported_control_request_inside_an_unprompted_turn_is_answered_not_fatal() {
    let mut router = ClaudeSessionRouter::new();
    inside_an_unprompted_turn(&mut router);
    let step = router.feed(&control_request("hook-1", "hook_callback"));
    assert!(!step.unowned_activity);
    assert_eq!(step.unsupported_requests, vec!["hook-1".to_string()]);
    assert!(step.permission_denials.is_empty());
    let closed = feed_all(&mut router, &[&assistant("bg"), &result(None, 0.5, "bg")]);
    assert!(!closed.unowned);
    assert_eq!(closed.background.len(), 1);
    assert!(closed.background[0].complete);
    let text = String::from_utf8_lossy(&closed.background[0].output).into_owned();
    assert!(text.contains("hook-1"), "{text}");
}

#[test]
fn an_unsupported_control_request_while_idle_or_before_our_start_is_answered() {
    let mut router = ClaudeSessionRouter::new();
    let step = router.feed(&control_request("hook-idle", "hook_callback"));
    assert!(!step.unowned_activity);
    assert_eq!(step.unsupported_requests, vec!["hook-idle".to_string()]);
    assert!(step.turn_output.is_empty());
    assert!(step.background_turns.is_empty());
    let unnamed = router.feed(&control_request("bad id", "hook_callback"));
    assert!(unnamed.unowned_activity);
    assert!(unnamed.unsupported_requests.is_empty());

    let mut router = ClaudeSessionRouter::new();
    let (_, id) = attach(&mut router);
    assert!(!router
        .feed(&lifecycle(&id, "queued"))
        .turn_output
        .is_empty());
    let step = router.feed(&control_request("mcp-1", "mcp_message"));
    assert!(!step.unowned_activity);
    assert_eq!(step.unsupported_requests, vec!["mcp-1".to_string()]);
    assert!(step.turn_output.is_empty());
}

#[test]
fn an_owned_turn_keeps_its_control_requests() {
    let mut router = ClaudeSessionRouter::new();
    owned_turn(&mut router);
    let request = control_request("hook-own", "hook_callback");
    let step = router.feed(&request);
    assert!(step.unsupported_requests.is_empty());
    assert!(!step.unowned_activity);
    assert_eq!(step.turn_output, request);
}

fn answer_up_to_the_cap(router: &mut ClaudeSessionRouter, label: &str) {
    for index in 0..MAX_UNOWNED_CONTROL_ANSWERS {
        let step = router.feed(&control_request(
            &format!("{label}-{index}"),
            "hook_callback",
        ));
        assert_eq!(step.unsupported_requests.len(), 1, "{label} {index}");
        assert!(!step.unowned_activity, "{label} {index}");
    }
    let over = router.feed(&control_request(&format!("{label}-over"), "hook_callback"));
    assert!(over.unowned_activity, "{label}");
    assert!(over.unsupported_requests.is_empty(), "{label}");
}

#[test]
fn unsupported_control_requests_are_capped_per_idle_period_and_per_unprompted_turn() {
    let mut router = ClaudeSessionRouter::new();
    answer_up_to_the_cap(&mut router, "idle");

    let mut router = ClaudeSessionRouter::new();
    inside_an_unprompted_turn(&mut router);
    answer_up_to_the_cap(&mut router, "unprompted");

    let mut router = ClaudeSessionRouter::new();
    for index in 0..MAX_UNOWNED_CONTROL_ANSWERS {
        router.feed(&control_request(&format!("early-{index}"), "hook_callback"));
    }
    let (first, _) = attach(&mut router);
    assert!(
        router
            .feed(&turn_stream(first.initial_command_id(), 0.25, "ONE"))
            .settled
    );
    answer_up_to_the_cap(&mut router, "next-idle");
}
