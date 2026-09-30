use super::*;
use crate::agent_task_spawner::claude_session_task_stop::TaskStopReply;

fn stop_reply(request_id: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"control_response",
        "response":{"subtype":"success","request_id":request_id}
    }))
}

fn stop_refusal(request_id: &str, task: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"control_response",
        "response":{
            "subtype":"error",
            "request_id":request_id,
            "error":format!("No task found with ID: {task}")
        }
    }))
}

#[test]
fn only_live_native_background_tasks_of_this_session_are_stoppable() {
    let mut router = ClaudeSessionRouter::new();
    assert!(!router.live_background_task("b8kzpiexm"));
    interrupted_with_live_task(&mut router, "b8kzpiexm");
    let (_, id) = owned_turn(&mut router);
    let foreground = task_started("fg-1", false);
    feed_all(&mut router, &[&foreground]);

    assert!(router.live_background_task("b8kzpiexm"));
    assert!(!router.live_background_task("fg-1"));
    assert!(!router.live_background_task("unknown"));

    let finished = task_finished("fg-1", "completed");
    let own = result(Some(&id), 0.1, "ok");
    assert_eq!(feed_all(&mut router, &[&finished, &own]).settles, 1);
    let stopped = router.feed(&task_finished("b8kzpiexm", "stopped"));
    assert!(!router.live_background_task("b8kzpiexm"));
    assert_eq!(router.live_background_tasks(), 0);
    assert_eq!(
        stopped
            .background_tasks
            .map(|level| (level.total, level.tasks.len())),
        Some((0, 0))
    );
}

#[test]
fn an_idle_stop_reply_is_claimed_once_and_the_task_leaves_only_on_its_notification() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "b8kzpiexm");
    assert!(router.begin_task_stop("req-stop-1".to_string()));

    let replied = router.feed(&stop_reply("req-stop-1"));
    assert!(replied.turn_output.is_empty());
    assert!(!replied.unowned_activity);
    assert!(router.live_background_task("b8kzpiexm"));
    assert_eq!(
        router.take_task_stop_reply("req-stop-1"),
        Some(TaskStopReply::Accepted)
    );
    assert_eq!(router.take_task_stop_reply("req-stop-1"), None);

    let duplicate = router.feed(&stop_reply("req-stop-1"));
    assert!(duplicate.turn_output.is_empty());
    assert_eq!(router.take_task_stop_reply("req-stop-1"), None);

    let stopped = router.feed(&task_finished("b8kzpiexm", "stopped"));
    assert!(!router.live_background_task("b8kzpiexm"));
    assert_eq!(stopped.background_tasks.map(|level| level.total), Some(0));
}

#[test]
fn a_stop_reply_during_an_attached_turn_never_reaches_the_turn_or_settles_it() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "b8kzpiexm");
    let (_, id) = owned_turn(&mut router);
    assert!(router.begin_task_stop("req-stop-1".to_string()));
    assert!(router.begin_task_stop("req-stop-2".to_string()));

    let accepted = router.feed(&stop_reply("req-stop-1"));
    let refused = router.feed(&stop_refusal("req-stop-2", "b8kzpiexm"));
    let foreign = router.feed(&acknowledgement("req-foreign"));

    assert!(accepted.turn_output.is_empty());
    assert!(!accepted.settled);
    assert!(refused.turn_output.is_empty());
    assert!(!refused.settled);
    assert_eq!(foreign.turn_output, acknowledgement("req-foreign"));
    assert_eq!(
        router.take_task_stop_reply("req-stop-2"),
        Some(TaskStopReply::Refused(
            "No task found with ID: b8kzpiexm".to_string()
        ))
    );
    assert_eq!(
        router.take_task_stop_reply("req-stop-1"),
        Some(TaskStopReply::Accepted)
    );
    assert!(router.feed(&result(Some(&id), 0.1, "ok")).settled);
}

#[test]
fn a_withdrawn_stop_swallows_its_late_reply_and_leaves_the_interrupt_ack_alone() {
    let mut router = ClaudeSessionRouter::new();
    interrupted_with_live_task(&mut router, "b8kzpiexm");
    let (ledger, id) = owned_turn(&mut router);
    assert!(router.begin_task_stop("req-stop-1".to_string()));
    router.withdraw_task_stop("req-stop-1");
    let late = router.feed(&stop_reply("req-stop-1"));
    assert!(late.turn_output.is_empty());
    assert_eq!(router.take_task_stop_reply("req-stop-1"), None);

    router.interrupt_sent("req-int".to_string());
    ledger.abandon_all();
    assert!(router.begin_task_stop("req-stop-2".to_string()));
    let stop = router.feed(&stop_reply("req-stop-2"));
    assert!(!stop.interrupt_acknowledged);
    assert!(!stop.settled);
    let ack = acknowledgement("req-int");
    let interrupted = interrupted_result(&id);
    let settled = feed_all(&mut router, &[&ack, &interrupted]);
    assert_eq!(settled.acknowledgements, 1);
    assert_eq!(settled.settles, 1);
    assert_eq!(router.live_background_tasks(), 1);
}

#[test]
fn pending_router_stops_are_bounded() {
    let mut router = ClaudeSessionRouter::new();
    for index in 0..crate::agent_task_spawner::claude_session_task_stop::MAX_PENDING_TASK_STOPS {
        assert!(router.begin_task_stop(format!("req-{index}")));
    }
    assert!(!router.begin_task_stop("req-overflow".to_string()));
}
