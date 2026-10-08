use super::*;

fn start(id: &str) -> String {
    format!("{{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"{id}\",\"task_type\":\"local_bash\"}}\n")
}
const RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"num_turns\":1}\n";
const DONE: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"watch\",\"status\":\"completed\"}\n";

#[test]
fn ordinary_result_closes_once_after_complete_json_line() {
    let mut detector = ResultLineDetector::new();
    assert!(!detector.feed(&RESULT[..RESULT.len() - 1]).unwrap());
    assert!(detector.feed(b"\n").unwrap());
    assert!(!detector.feed(RESULT).unwrap());
}

#[test]
fn background_result_keeps_input_until_terminal_and_late_reply_result() {
    let mut detector = ResultLineDetector::new();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(RESULT).unwrap());
    assert!(!detector.feed(DONE).unwrap());
    assert!(!detector
        .feed(b"{\"type\":\"assistant\",\"message\":{\"content\":[]}}\n")
        .unwrap());
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn lifecycle_survives_every_chunk_boundary() {
    let stream = [start("watch").as_bytes(), RESULT, DONE, RESULT].concat();
    for split in 0..stream.len() {
        let mut detector = ResultLineDetector::new();
        let one = detector.feed(&stream[..split]).unwrap();
        let two = detector.feed(&stream[split..]).unwrap();
        assert_eq!(usize::from(one) + usize::from(two), 1, "split {split}");
    }
}

#[test]
fn bytewise_lifecycle_and_multiple_tasks_require_all_terminals() {
    let mut detector = ResultLineDetector::new();
    for byte in start("watch").as_bytes() {
        assert!(!detector.feed(&[*byte]).unwrap());
    }
    detector.feed(start("other").as_bytes()).unwrap();
    detector.feed(DONE).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    detector.feed(b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"other\",\"patch\":{\"status\":\"killed\"}}\n").unwrap();
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn a_restarted_task_is_live_until_its_next_terminal() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(DONE).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector
        .feed(b"{\"type\":\"system\",\"subtype\":\"task_progress\",\"task_id\":\"watch\"}\n")
        .unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    detector.feed(DONE).unwrap();
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn prose_unknown_progress_nested_and_foreign_tasks_are_not_live() {
    for line in [
        b"{\"type\":\"assistant\",\"message\":\"watching pipeline in background\"}\n".as_slice(),
        b"{\"type\":\"system\",\"subtype\":\"task_progress\",\"task_id\":\"watch\"}\n",
        b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"watch\",\"parent_tool_use_id\":\"nested\"}\n",
        b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"watch\",\"session_id\":\"foreign\"}\n",
    ] {
        let mut detector = ResultLineDetector::new();
        detector.feed(b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"own\"}\n").unwrap();
        detector.feed(line).unwrap();
        assert!(detector.feed(RESULT).unwrap());
    }
}

#[test]
fn failure_result_closes_even_with_live_tasks() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(detector
        .feed(b"{\"type\":\"result\",\"is_error\":true}\n")
        .unwrap());
}

#[test]
fn invalid_json_and_result_substrings_never_close() {
    let mut detector = ResultLineDetector::new();
    for line in [
        b"{\"type\":\"result\"\n".as_slice(),
        b"{\"type\":\"result_extra\"}\n",
        b"{\"text\":\"{\\\"type\\\":\\\"result\\\"}\"}\n",
    ] {
        assert!(!detector.feed(line).unwrap());
    }
}

#[test]
fn live_limit_is_explicit_failure_and_duplicates_do_not_consume_capacity() {
    let mut detector = ResultLineDetector::new();
    for id in 0..MAX_LIVE_TASKS {
        detector
            .feed(start(&format!("task-{id}")).as_bytes())
            .unwrap();
        detector
            .feed(start(&format!("task-{id}")).as_bytes())
            .unwrap();
    }
    assert!(detector.feed(start("overflow").as_bytes()).is_err());
}

#[test]
fn oversized_lifecycle_fails_but_ordinary_large_output_is_skipped() {
    let mut detector = ResultLineDetector::new();
    let mut line = b"{\"type\":\"system\",".to_vec();
    line.resize(MAX_LINE_BYTES + 1, b' ');
    assert!(detector.feed(&line).is_err());
    let mut detector = ResultLineDetector::new();
    let mut line = b"{\"type\":\"assistant\",".to_vec();
    line.resize(MAX_LINE_BYTES + 1, b' ');
    line.extend_from_slice(b"\n");
    assert!(!detector.feed(&line).unwrap());
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn paused_task_can_resume_without_losing_input_retention() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    for status in ["paused", "idle", "running"] {
        let patch = format!("{{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"watch\",\"patch\":{{\"status\":\"{status}\"}}}}\n");
        detector.feed(patch.as_bytes()).unwrap();
        assert!(!detector.feed(RESULT).unwrap());
    }
    detector.feed(DONE).unwrap();
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn notification_without_recognized_terminal_status_cannot_stop_live_task() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    for status in ["running", "unknown", ""] {
        let notification = format!("{{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"watch\",\"status\":\"{status}\"}}\n");
        detector.feed(notification.as_bytes()).unwrap();
        assert!(!detector.feed(RESULT).unwrap());
    }
    detector.feed(DONE).unwrap();
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn observed_history_limit_allows_existing_live_task_terminal_transition() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    for id in 0..MAX_OBSERVED_TASKS - 1 {
        let done = format!("{{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"done-{id}\",\"status\":\"completed\"}}\n");
        detector.feed(done.as_bytes()).unwrap();
    }
    assert!(!detector.feed(DONE).unwrap());
    let overflow = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"overflow\",\"status\":\"completed\"}\n";
    assert!(detector.feed(overflow).is_err());
}

#[test]
fn session_policy_evicts_the_oldest_tombstones_instead_of_failing() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    detector.feed(start("watch").as_bytes()).unwrap();
    let total = MAX_OBSERVED_TASKS + 10;
    for id in 0..total {
        let done = format!("{{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"done-{id}\",\"status\":\"completed\"}}\n");
        detector.feed(done.as_bytes()).unwrap();
    }
    assert!(detector.terminal.len() + detector.live.len() <= MAX_OBSERVED_TASKS);
    assert_eq!(detector.buried.len(), detector.terminal.len());
    assert!(detector.live.contains_key("watch"));
    let evicted = total + 1 - MAX_OBSERVED_TASKS;
    assert!((0..evicted).all(|id| !detector.terminal.contains_key(&format!("done-{id}"))));
    assert!((evicted..total).all(|id| detector.terminal.contains_key(&format!("done-{id}"))));
    assert_eq!(detector.buried.front(), Some(&format!("done-{evicted}")));
}

#[test]
fn session_policy_still_bounds_live_tasks() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    for id in 0..MAX_LIVE_TASKS {
        detector
            .feed(start(&format!("live-{id}")).as_bytes())
            .unwrap();
    }
    assert!(detector.feed(start("one-too-many").as_bytes()).is_err());
}

#[test]
fn explicit_terminal_update_then_root_result_settles_per_run_session() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(RESULT).unwrap();
    detector.feed(b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"watch\",\"patch\":{\"status\":\"completed\"}}\n").unwrap();
    assert!(detector.feed(RESULT).unwrap());
}

const INIT: &[u8] = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"resumed\"}\n";
const STRAY_STOP: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"bkxy1q4sh\",\"patch\":{\"status\":\"stopped\"},\"session_id\":\"resumed\"}\n";
const STRAY_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",\"num_turns\":0,\"total_cost_usd\":22.1702505,\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"session_id\":\"resumed\"}\n";
const ASSISTANT: &[u8] = b"{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Spustam testy znova.\"}]},\"parent_tool_use_id\":null,\"session_id\":\"resumed\"}\n";
const REAL_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Hotovo.\",\"num_turns\":3,\"usage\":{\"input_tokens\":1200,\"output_tokens\":80},\"session_id\":\"resumed\"}\n";

#[test]
fn resume_stray_empty_result_does_not_close_before_real_result() {
    for prelude in [
        [INIT, STRAY_STOP, STRAY_RESULT].concat(),
        [STRAY_STOP, STRAY_RESULT, INIT].concat(),
    ] {
        let stream = [prelude.as_slice(), ASSISTANT, REAL_RESULT, REAL_RESULT].concat();
        let mut detector = ResultLineDetector::new();
        let closes = stream
            .split_inclusive(|byte| *byte == b'\n')
            .map(|line| detector.feed(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(closes, [false, false, false, false, true, false]);
    }
}

#[test]
fn resume_stray_result_survives_every_chunk_boundary() {
    let stream = [INIT, STRAY_STOP, STRAY_RESULT, ASSISTANT, REAL_RESULT].concat();
    for split in 0..stream.len() {
        let mut detector = ResultLineDetector::new();
        let one = detector.feed(&stream[..split]).unwrap();
        let two = detector.feed(&stream[split..]).unwrap();
        assert!(!one, "split {split}");
        assert!(two, "split {split}");
    }
}

#[test]
fn result_without_output_or_turns_is_ignored_until_assistant_output() {
    let mut detector = ResultLineDetector::new();
    let empty = b"{\"type\":\"result\",\"subtype\":\"success\"}\n";
    assert!(!detector.feed(empty).unwrap());
    assert!(!detector.feed(ASSISTANT).unwrap());
    assert!(detector.feed(empty).unwrap());
}

#[test]
fn init_resets_root_output_for_next_run() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(ASSISTANT).unwrap();
    assert!(!detector.feed(REAL_RESULT).unwrap());
    detector.feed(DONE).unwrap();
    detector.feed(INIT).unwrap();
    assert!(!detector.feed(STRAY_RESULT).unwrap());
    detector.feed(ASSISTANT).unwrap();
    assert!(detector.feed(STRAY_RESULT).unwrap());
}

#[test]
fn failed_result_before_output_still_closes() {
    let mut detector = ResultLineDetector::new();
    detector.feed(INIT).unwrap();
    assert!(detector
        .feed(b"{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"num_turns\":0,\"session_id\":\"resumed\"}\n")
        .unwrap());
}

fn closes_per_line(frames: &[&[u8]]) -> Vec<bool> {
    let mut detector = ResultLineDetector::new();
    frames
        .iter()
        .map(|frame| detector.feed(frame).unwrap())
        .collect()
}

const LOCAL_EMPTY_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",\"num_turns\":0,\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"session_id\":\"resumed\"}\n";

#[test]
fn compact_boundary_is_evidence_for_empty_local_command_result() {
    let boundary = b"{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"compact_metadata\":{\"trigger\":\"manual\",\"pre_tokens\":90000},\"session_id\":\"resumed\"}\n";
    assert_eq!(
        closes_per_line(&[INIT, boundary, LOCAL_EMPTY_RESULT]),
        [false, false, true]
    );
}

#[test]
fn local_command_result_text_closes_without_assistant_frame() {
    let cost = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Total cost: $0.0000\",\"num_turns\":0,\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"session_id\":\"resumed\"}\n";
    assert_eq!(closes_per_line(&[INIT, cost]), [false, true]);
}

#[test]
fn synthetic_local_command_assistant_frame_closes() {
    let synthetic = b"{\"type\":\"assistant\",\"message\":{\"model\":\"<synthetic>\",\"content\":[{\"type\":\"text\",\"text\":\"## Context Usage\"}]},\"parent_tool_use_id\":null,\"session_id\":\"resumed\"}\n";
    assert_eq!(
        closes_per_line(&[INIT, synthetic, LOCAL_EMPTY_RESULT]),
        [false, false, true]
    );
}

#[test]
fn output_tokens_are_evidence_of_work() {
    let result = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"\",\"num_turns\":0,\"usage\":{\"output_tokens\":12},\"session_id\":\"resumed\"}\n";
    assert_eq!(closes_per_line(&[INIT, result]), [false, true]);
}

#[test]
fn whitespace_result_text_is_not_evidence_of_work() {
    let result = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\" \\n\",\"num_turns\":0,\"usage\":{\"output_tokens\":0},\"session_id\":\"resumed\"}\n";
    assert_eq!(closes_per_line(&[INIT, result]), [false, false]);
}

#[test]
fn clear_rebinds_to_new_session_and_closes_on_empty_result() {
    let reset = b"{\"type\":\"conversation_reset\",\"new_conversation_id\":\"next\",\"session_id\":\"resumed\"}\n";
    let hook = b"{\"type\":\"system\",\"subtype\":\"hook_started\",\"session_id\":\"cleared\"}\n";
    let init = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"cleared\"}\n";
    let result = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",\"num_turns\":0,\"usage\":{\"output_tokens\":0},\"session_id\":\"cleared\"}\n";
    assert_eq!(
        closes_per_line(&[INIT, reset, hook, init, result]),
        [false, false, false, false, true]
    );
}

#[test]
fn foreign_session_reset_does_not_rebind() {
    let reset = b"{\"type\":\"conversation_reset\",\"session_id\":\"foreign\"}\n";
    let init = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"cleared\"}\n";
    let result = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"done\",\"session_id\":\"cleared\"}\n";
    assert_eq!(
        closes_per_line(&[INIT, reset, init, result]),
        [false, false, false, false]
    );
}

#[test]
fn reset_evidence_does_not_outlive_the_following_run() {
    let reset = b"{\"type\":\"conversation_reset\",\"session_id\":\"resumed\"}\n";
    let init = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"cleared\"}\n";
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(INIT).unwrap();
    detector.feed(reset).unwrap();
    detector.feed(init).unwrap();
    detector.feed(DONE).unwrap();
    detector.feed(init).unwrap();
    let stray = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"\",\"num_turns\":0,\"session_id\":\"cleared\"}\n";
    assert!(!detector.feed(stray).unwrap());
}

const CLEAR_RESET: &[u8] = b"{\"type\":\"conversation_reset\",\"new_conversation_id\":\"f702f92e\",\"session_id\":\"resumed\"}\n";
const CLEARED_INIT: &[u8] =
    b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"cleared\"}\n";
const CLEARED_EMPTY_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",\"num_turns\":0,\"usage\":{\"output_tokens\":0},\"session_id\":\"cleared\"}\n";

#[test]
fn admitting_a_frame_judges_its_session_without_pinning_it() {
    let frame = |session: &str| serde_json::json!({"type":"user","session_id":session});
    let nested = serde_json::json!({"type":"user","parent_tool_use_id":"toolu"});
    let mut detector = ResultLineDetector::new();
    assert!(detector.admits_root(&frame("resumed")));
    assert_eq!(detector.session_id(), None);
    detector.feed(INIT).unwrap();
    assert!(detector.admits_root(&frame("resumed")));
    assert!(!detector.admits_root(&frame("foreign")));
    assert!(!detector.admits_root(&nested));
    assert_eq!(detector.resets(), 0);
    detector.feed(CLEAR_RESET).unwrap();
    assert_eq!(detector.resets(), 1);
    assert!(!detector.admits_root(&frame("resumed")));
    assert!(detector.admits_root(&frame("cleared")));
    assert_eq!(detector.session_id(), None);
}

#[test]
fn retired_session_straggler_does_not_repin_after_clear() {
    let killed = b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"watch\",\"patch\":{\"status\":\"killed\"},\"session_id\":\"resumed\"}\n";
    let mut detector = ResultLineDetector::new();
    detector.feed(INIT).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(!detector.feed(CLEAR_RESET).unwrap());
    assert!(!detector.feed(killed).unwrap());
    assert!(!detector.feed(CLEARED_INIT).unwrap());
    assert!(detector.feed(CLEARED_EMPTY_RESULT).unwrap());
}

#[test]
fn retired_session_result_never_settles_the_cleared_session() {
    let old_result = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"late\",\"num_turns\":2,\"session_id\":\"resumed\"}\n";
    assert_eq!(
        closes_per_line(&[
            INIT,
            CLEAR_RESET,
            old_result,
            CLEARED_INIT,
            old_result,
            CLEARED_EMPTY_RESULT
        ]),
        [false, false, false, false, false, true]
    );
}

#[test]
fn retired_session_output_is_not_evidence_for_the_cleared_session() {
    let old_init = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"resumed\"}\n";
    let old_assistant =
        b"{\"type\":\"assistant\",\"message\":{\"content\":[]},\"session_id\":\"resumed\"}\n";
    let mut detector = ResultLineDetector::new();
    detector.feed(INIT).unwrap();
    detector.feed(CLEAR_RESET).unwrap();
    detector.feed(CLEARED_INIT).unwrap();
    detector.feed(old_init).unwrap();
    detector.feed(old_assistant).unwrap();
    detector.feed(CLEARED_INIT).unwrap();
    assert!(!detector.feed(CLEARED_EMPTY_RESULT).unwrap());
}

#[test]
fn pre_clear_live_task_without_terminal_does_not_block_cleared_result() {
    let progress = b"{\"type\":\"system\",\"subtype\":\"task_progress\",\"task_id\":\"watch\"}\n";
    let mut detector = ResultLineDetector::new();
    detector.feed(INIT).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(CLEAR_RESET).unwrap();
    detector.feed(CLEARED_INIT).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(progress).unwrap();
    assert!(detector.feed(CLEARED_EMPTY_RESULT).unwrap());
}

#[test]
fn cleared_session_tasks_still_retain_input() {
    let cleared_start = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"next\",\"session_id\":\"cleared\"}\n";
    let cleared_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"next\",\"status\":\"completed\",\"session_id\":\"cleared\"}\n";
    let old_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"next\",\"status\":\"completed\",\"session_id\":\"resumed\"}\n";
    assert_eq!(
        closes_per_line(&[
            INIT,
            CLEAR_RESET,
            CLEARED_INIT,
            cleared_start,
            CLEARED_EMPTY_RESULT,
            old_done,
            CLEARED_EMPTY_RESULT,
            cleared_done,
            CLEARED_EMPTY_RESULT
        ]),
        [false, false, false, false, false, false, false, false, true]
    );
}

fn parsed(line: &[u8]) -> serde_json::Value {
    serde_json::from_slice(line).expect("fixture json")
}

fn awaiting() -> ResultLineDetector {
    ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork)
}

const FAILED: &[u8] =
    b"{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true}\n";
const STOPPED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"watch\",\"status\":\"stopped\"}\n";
const PROGRESS: &[u8] =
    b"{\"type\":\"system\",\"subtype\":\"task_progress\",\"task_id\":\"watch\"}\n";
const DRAINED: &[u8] = b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"watch\",\"patch\":{\"status\":\"completed\"}}\n";
const UNPROMPTED_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"background-finished\",\"num_turns\":1,\"origin\":{\"kind\":\"task-notification\"},\"result_index\":1}\n";
const NULL_UUID_RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"background-finished\",\"num_turns\":1,\"user_message_uuid\":null,\"result_index\":1}\n";

#[test]
fn await_background_policy_keeps_a_failed_result_open_until_the_drain() {
    let mut detector = awaiting();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(FAILED).unwrap());
    assert!(detector.feed(DONE).unwrap());
    assert!(!detector.feed(RESULT).unwrap());
}

#[test]
fn await_background_policy_settles_a_failed_result_without_live_tasks() {
    assert!(awaiting().feed(FAILED).unwrap());
}

#[test]
fn legacy_policy_still_settles_a_failed_result_immediately() {
    let mut detector = ResultLineDetector::new();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(detector.feed(FAILED).unwrap());
}

#[test]
fn rearm_allows_a_second_settlement_and_keeps_tombstones_and_session() {
    let mut detector = ResultLineDetector::new();
    detector
        .feed(b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-abcdefgh\"}\n")
        .unwrap();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(DONE).unwrap());
    assert!(detector.feed(RESULT).unwrap());
    detector.rearm(None);
    assert!(!detector.feed(PROGRESS).unwrap());
    assert_eq!(
        detector.live_task_count(),
        0,
        "progress cannot revive a tombstone"
    );
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert_eq!(
        detector.live_task_count(),
        1,
        "a restarted task is live again"
    );
    assert_eq!(detector.session_id(), Some("sess-abcdefgh"));
    assert!(!detector.feed(RESULT).unwrap());
    assert!(!detector.feed(DONE).unwrap());
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn resumed_background_task_restarted_under_the_same_id_keeps_the_turn_open() {
    for policy in [
        ResultSettlePolicy::SettleOnFailure,
        ResultSettlePolicy::AwaitBackgroundWork,
    ] {
        let mut detector = ResultLineDetector::new().with_settle_policy(policy);
        assert!(!detector.feed(INIT).unwrap());
        assert!(!detector.feed(STOPPED).unwrap());
        assert!(!detector.feed(start("watch").as_bytes()).unwrap());
        assert_eq!(detector.live_task_count(), 1);
        assert!(!detector.feed(ASSISTANT).unwrap());
        assert!(!detector.feed(REAL_RESULT).unwrap());
        let drained = detector.feed(DONE).unwrap();
        assert_eq!(
            drained,
            policy == ResultSettlePolicy::AwaitBackgroundWork,
            "{policy:?}"
        );
        if !drained {
            assert!(detector.feed(REAL_RESULT).unwrap());
        }
    }
}

#[test]
fn notifications_and_updates_never_revive_a_tombstone() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(DONE).unwrap();
    let running = b"{\"type\":\"system\",\"subtype\":\"task_updated\",\"task_id\":\"watch\",\"patch\":{\"status\":\"running\"}}\n";
    let notice = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"watch\",\"status\":\"running\"}\n";
    for line in [PROGRESS, running.as_slice(), notice.as_slice()] {
        detector.feed(line).unwrap();
        assert_eq!(detector.live_task_count(), 0);
    }
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn revival_respects_the_live_task_limit() {
    let mut detector = ResultLineDetector::new();
    detector.feed(STOPPED).unwrap();
    for id in 0..MAX_LIVE_TASKS {
        detector
            .feed(start(&format!("task-{id}")).as_bytes())
            .unwrap();
    }
    assert!(detector.feed(start("watch").as_bytes()).is_err());
}

#[test]
fn consume_message_matches_feed() {
    let mut by_value = ResultLineDetector::new();
    assert!(!by_value
        .consume_message(&parsed(start("watch").as_bytes()))
        .unwrap());
    assert!(!by_value.consume_message(&parsed(RESULT)).unwrap());
    assert!(!by_value.consume_message(&parsed(DONE)).unwrap());
    assert!(by_value.consume_message(&parsed(RESULT)).unwrap());
    assert!(!by_value.consume_message(&parsed(RESULT)).unwrap());
}

#[test]
fn native_background_turn_settles_at_the_drain_and_ignores_the_unprompted_turn() {
    let queued_bg = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"watch\",\"task_type\":\"local_bash\",\"is_backgrounded\":true}\n";
    let changed = b"{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[{\"task_id\":\"watch\"}]}\n";
    let emptied = b"{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[]}\n";
    let result = b"{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"STARTED\",\"num_turns\":1,\"user_message_uuid\":\"u-1\",\"user_message_uuids\":[\"u-1\"],\"result_index\":0}\n";
    let completed =
        b"{\"type\":\"command_lifecycle\",\"command_uuid\":\"u-1\",\"state\":\"completed\"}\n";
    let mut detector = awaiting();
    for line in [
        INIT,
        changed.as_slice(),
        queued_bg.as_slice(),
        ASSISTANT,
        result.as_slice(),
        completed.as_slice(),
        emptied.as_slice(),
    ] {
        assert!(!detector.feed(line).unwrap());
    }
    assert!(detector.feed(DRAINED).unwrap());
    detector.rearm(None);
    for line in [DONE, INIT, ASSISTANT, UNPROMPTED_RESULT] {
        assert!(!detector.feed(line).unwrap());
    }
    assert_eq!(detector.live_task_count(), 0);
}

#[test]
fn unsolicited_result_never_settles_and_never_reaches_the_ledger() {
    use crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;
    let ledger = std::sync::Arc::new(ClaudeInputLifecycle::new());
    let lifecycle = |id: &str, state: &str| {
        format!(
            "{{\"type\":\"command_lifecycle\",\"command_uuid\":\"{id}\",\"state\":\"{state}\"}}\n"
        )
    };
    let mut detector = awaiting().with_lifecycle(Some(std::sync::Arc::clone(&ledger)));
    let initial = ledger.initial_command_id().to_string();
    assert!(!detector
        .feed(lifecycle(&initial, "started").as_bytes())
        .unwrap());
    assert!(!detector.feed(ASSISTANT).unwrap());
    let (steer, _) = ledger.reserve(b"{}\n").unwrap();
    assert!(!detector
        .feed(lifecycle(&steer, "started").as_bytes())
        .unwrap());
    assert!(!detector.feed(UNPROMPTED_RESULT).unwrap());
    assert!(!detector
        .feed(lifecycle(&steer, "completed").as_bytes())
        .unwrap());
    assert!(
        ledger.has_pending(),
        "the unprompted result was not counted"
    );
    assert!(detector.feed(REAL_RESULT).unwrap());
}

#[test]
fn missing_user_message_uuid_keeps_the_older_cli_behaviour() {
    let mut detector = awaiting();
    assert!(!detector.feed(ASSISTANT).unwrap());
    assert!(detector.feed(REAL_RESULT).unwrap());
}

#[test]
fn legacy_policy_after_a_drain_still_needs_another_result_and_counts_null_uuid() {
    let mut detector = ResultLineDetector::new();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(RESULT).unwrap());
    assert!(!detector.feed(DRAINED).unwrap());
    assert!(detector.feed(UNPROMPTED_RESULT).unwrap());
}

#[test]
fn rearm_forgets_a_result_seen_before_it() {
    let mut detector = awaiting();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(RESULT).unwrap());
    detector.rearm(None);
    assert!(!detector.feed(DONE).unwrap());
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn an_explicit_null_uuid_result_is_unprompted_under_await_policy() {
    let mut detector = awaiting();
    assert!(!detector.feed(ASSISTANT).unwrap());
    assert!(!detector.feed(NULL_UUID_RESULT).unwrap());
    assert!(detector.feed(REAL_RESULT).unwrap());
}

#[test]
fn tracking_updates_tasks_and_session_but_never_the_ledger_or_settlement() {
    use crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;
    let ledger = std::sync::Arc::new(ClaudeInputLifecycle::new());
    let started = format!(
        "{{\"type\":\"command_lifecycle\",\"command_uuid\":\"{}\",\"state\":\"started\"}}\n",
        ledger.initial_command_id()
    );
    let mut detector = awaiting().with_lifecycle(Some(std::sync::Arc::clone(&ledger)));
    detector
        .observe_command(&parsed(started.as_bytes()))
        .unwrap();
    detector.track_message(&parsed(INIT)).unwrap();
    detector
        .track_message(&parsed(start("watch").as_bytes()))
        .unwrap();
    assert_eq!(detector.session_id(), Some("resumed"));
    assert_eq!(detector.live_task_count(), 1);
    detector.track_message(&parsed(ASSISTANT)).unwrap();
    detector.track_message(&parsed(REAL_RESULT)).unwrap();
    detector.track_message(&parsed(DONE)).unwrap();
    assert_eq!(detector.live_task_count(), 0);
    assert!(!detector.settle_if_ready());
    assert!(
        ledger.reserve(b"{}\n").is_ok(),
        "tracking never closed the ledger"
    );
    let foreign = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"other\",\"session_id\":\"foreign\"}\n";
    detector.track_message(&parsed(foreign)).unwrap();
    assert_eq!(detector.live_task_count(), 0);
}

#[test]
fn observe_command_feeds_only_the_ledger() {
    use crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;
    let ledger = std::sync::Arc::new(ClaudeInputLifecycle::new());
    let queued = format!(
        "{{\"type\":\"command_lifecycle\",\"command_uuid\":\"{}\",\"state\":\"queued\"}}\n",
        ledger.initial_command_id()
    );
    let mut detector = awaiting().with_lifecycle(Some(std::sync::Arc::clone(&ledger)));
    assert!(ledger.reserve(b"{}\n").is_err());
    detector
        .observe_command(&parsed(queued.as_bytes()))
        .unwrap();
    assert!(ledger.reserve(b"{}\n").is_ok());
}

#[test]
fn settle_if_ready_settles_a_drained_turn_once() {
    let mut detector = awaiting();
    assert!(!detector.settle_if_ready());
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    detector.track_message(&parsed(DONE)).unwrap();
    assert!(detector.settle_if_ready());
    assert!(!detector.settle_if_ready());
}

#[test]
fn an_interrupt_suspends_drain_settlement_until_the_interrupted_result() {
    let mut detector = awaiting();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    detector.suspend_drain_settlement();
    assert!(!detector.feed(STOPPED).unwrap());
    assert!(!detector.settle_if_ready());
    assert!(detector.feed(FAILED).unwrap());
    detector.rearm(None);
    detector.feed(start("next").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    let next_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"next\",\"status\":\"completed\"}\n";
    assert!(
        detector.feed(next_done).unwrap(),
        "rearm restores drain settlement"
    );
}

#[test]
fn an_interrupt_still_settles_on_a_result_seen_before_it() {
    let mut detector = awaiting();
    assert!(!detector.feed(ASSISTANT).unwrap());
    detector.suspend_drain_settlement();
    assert!(detector.feed(REAL_RESULT).unwrap());
}

#[test]
fn only_tasks_not_started_as_foreground_count_as_background() {
    let foreground = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"fg\",\"task_type\":\"local_bash\",\"is_backgrounded\":false}\n";
    let native = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"bg\",\"task_type\":\"local_bash\",\"is_backgrounded\":true}\n";
    let native_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"bg\",\"status\":\"completed\"}\n";
    let foreground_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"fg\",\"status\":\"stopped\"}\n";
    let mut detector = awaiting();
    detector.feed(foreground).unwrap();
    assert_eq!(detector.live_task_count(), 1);
    assert_eq!(detector.live_background_task_count(), 0);
    detector.feed(native).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert_eq!(detector.live_task_count(), 3);
    assert_eq!(detector.live_background_task_count(), 2);
    detector.feed(native_done).unwrap();
    detector.feed(foreground_done).unwrap();
    assert_eq!(detector.live_task_count(), 1);
    assert_eq!(detector.live_background_task_count(), 1);
    detector.feed(DONE).unwrap();
    assert_eq!(detector.live_background_task_count(), 0);
    detector.feed(foreground).unwrap();
    assert_eq!(
        detector.live_task_count(),
        1,
        "a restarted foreground task is live"
    );
    assert_eq!(detector.live_background_task_count(), 0);
    detector.feed(native).unwrap();
    assert_eq!(
        detector.live_background_task_count(),
        1,
        "a restarted background task counts"
    );
    detector.feed(CLEAR_RESET).unwrap();
    assert_eq!(detector.live_task_count(), 0);
    assert_eq!(detector.live_background_task_count(), 0);
}

#[test]
fn rearm_makes_live_tasks_inherited_for_settlement_only() {
    let mut detector = awaiting();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    detector.rearm(None);
    assert_eq!(detector.live_task_count(), 1);
    assert!(
        detector.feed(RESULT).unwrap(),
        "an inherited task never blocks"
    );
    detector.rearm(None);
    detector.feed(start("fresh").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    assert!(
        !detector.feed(DONE).unwrap(),
        "the inherited drain is not ours"
    );
    let fresh_done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"fresh\",\"status\":\"completed\"}\n";
    assert!(detector.feed(fresh_done).unwrap());
    assert_eq!(detector.live_task_count(), 0);
}

#[test]
fn an_inherited_task_restarted_after_the_arm_blocks_again() {
    let mut detector = awaiting();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.rearm(None);
    detector.feed(STOPPED).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    assert!(!detector.feed(RESULT).unwrap());
    assert!(detector.feed(DONE).unwrap());
}

const POLL_SESSION: &str = "05cae361-94fc-4216-aec7-0e2e87c0a3a6";

fn poll_frame(body: &str) -> Vec<u8> {
    format!("{{\"type\":\"system\",{body},\"session_id\":\"{POLL_SESSION}\"}}\n").into_bytes()
}

fn poll_started() -> Vec<u8> {
    poll_frame("\"subtype\":\"task_started\",\"task_id\":\"baa0ysq6h\",\"tool_use_id\":\"toolu_01SvfpGmZKYToWiKzG5TaQUN\",\"description\":\"Poll the CRM MR pipeline until it finishes and list failed jobs\",\"task_type\":\"local_bash\",\"is_backgrounded\":true")
}

fn poll_listed() -> Vec<u8> {
    poll_frame("\"subtype\":\"background_tasks_changed\",\"tasks\":[{\"task_id\":\"baa0ysq6h\",\"task_type\":\"local_bash\",\"description\":\"Poll the CRM MR pipeline until it finishes and list failed jobs\"}]")
}

fn tasks_emptied() -> Vec<u8> {
    poll_frame("\"subtype\":\"background_tasks_changed\",\"tasks\":[]")
}

fn poll_answer() -> Vec<u8> {
    format!("{{\"type\":\"assistant\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":\"Pipeline na CRM MR este bezi, sledujem ju na pozadi.\"}}]}},\"parent_tool_use_id\":null,\"session_id\":\"{POLL_SESSION}\"}}\n").into_bytes()
}

fn poll_result() -> Vec<u8> {
    format!("{{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Pipeline na CRM MR este bezi.\",\"num_turns\":12,\"session_id\":\"{POLL_SESSION}\"}}\n").into_bytes()
}

fn poll_notified() -> Vec<u8> {
    poll_frame("\"subtype\":\"task_notification\",\"task_id\":\"baa0ysq6h\",\"tool_use_id\":\"toolu_01SvfpGmZKYToWiKzG5TaQUN\",\"status\":\"completed\",\"output_file\":\"\",\"summary\":\"Background command completed (exit code 0)\"")
}

#[test]
fn level_snapshot_ends_a_listed_task_at_the_first_frame_that_is_not_its_bookend() {
    let mut detector = awaiting();
    for line in [
        poll_listed(),
        poll_started(),
        poll_answer(),
        poll_result(),
        tasks_emptied(),
    ] {
        assert!(!detector.feed(&line).unwrap());
    }
    assert_eq!(detector.live_background_task_count(), 1);
    detector.feed(&poll_frame("\"subtype\":\"init\"")).unwrap();
    assert_eq!(detector.live_background_task_count(), 0);
}

#[test]
fn level_snapshot_waits_for_the_bookends_that_follow_it() {
    let mut detector = awaiting();
    for line in [
        poll_listed(),
        poll_started(),
        poll_answer(),
        poll_result(),
        tasks_emptied(),
    ] {
        assert!(!detector.feed(&line).unwrap());
    }
    assert!(detector.feed(&poll_notified()).unwrap());
}

#[test]
fn level_snapshot_never_retires_a_task_it_has_not_listed() {
    let mut detector = awaiting();
    for line in [
        poll_started(),
        tasks_emptied(),
        poll_answer(),
        poll_result(),
    ] {
        assert!(!detector.feed(&line).unwrap());
    }
    assert_eq!(detector.live_background_task_count(), 1);
    assert!(detector.feed(&poll_notified()).unwrap());
}

#[test]
fn level_snapshot_keeps_listed_tasks_live() {
    let mut detector = awaiting();
    for line in [
        poll_listed(),
        poll_started(),
        poll_listed(),
        poll_result(),
        poll_answer(),
    ] {
        assert!(!detector.feed(&line).unwrap());
    }
    assert_eq!(detector.live_background_task_count(), 1);
}

#[test]
fn idle_session_level_snapshot_clears_the_live_task_count() {
    let mut detector = awaiting();
    for line in [poll_listed(), poll_started(), poll_answer(), poll_result()] {
        detector.feed(&line).unwrap();
    }
    detector.rearm(None);
    detector.track_message(&parsed(&tasks_emptied())).unwrap();
    detector
        .track_message(&parsed(&poll_frame("\"subtype\":\"init\"")))
        .unwrap();
    assert_eq!(detector.live_background_task_count(), 0);
}

#[test]
fn ambient_tasks_never_hold_the_turn_or_the_session() {
    let watcher = poll_frame("\"subtype\":\"task_started\",\"task_id\":\"w1\",\"description\":\"live updates\",\"task_type\":\"monitor_ws\",\"ambient\":true");
    let fork = poll_frame("\"subtype\":\"task_started\",\"task_id\":\"a1\",\"description\":\"fork\",\"task_type\":\"local_agent\",\"is_backgrounded\":true,\"skip_transcript\":true,\"ambient\":true");
    let mut detector = awaiting();
    for line in [watcher, fork, poll_answer()] {
        assert!(!detector.feed(&line).unwrap());
    }
    assert_eq!(detector.live_task_count(), 0);
    assert!(detector.feed(&poll_result()).unwrap());
}

#[test]
fn only_a_background_task_that_finishes_on_its_own_counts_as_a_wake_up() {
    let ended = |task: &str, status: &str| {
        format!(
            "{{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"{task}\",\"status\":\"{status}\"}}\n"
        )
    };
    let foreground = |task: &str| {
        format!(
            "{{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"{task}\",\"is_backgrounded\":false}}\n"
        )
    };
    let mut detector = awaiting();
    assert_eq!(detector.wake_ups(), 0);

    detector.feed(start("done").as_bytes()).unwrap();
    assert_eq!(detector.wake_ups(), 0);
    detector
        .feed(ended("done", "completed").as_bytes())
        .unwrap();
    assert_eq!(detector.wake_ups(), 1);
    detector
        .feed(ended("done", "completed").as_bytes())
        .unwrap();
    assert_eq!(
        detector.wake_ups(),
        1,
        "a repeated bookend is not a second end"
    );

    detector.feed(start("broke").as_bytes()).unwrap();
    detector.feed(ended("broke", "failed").as_bytes()).unwrap();
    assert_eq!(detector.wake_ups(), 2);

    for status in ["stopped", "killed", "cancelled", "interrupted"] {
        detector.feed(start(status).as_bytes()).unwrap();
        detector.feed(ended(status, status).as_bytes()).unwrap();
        assert_eq!(detector.wake_ups(), 2, "{status}");
    }

    detector.feed(foreground("front").as_bytes()).unwrap();
    detector
        .feed(ended("front", "completed").as_bytes())
        .unwrap();
    assert_eq!(detector.wake_ups(), 2, "a foreground task wakes nothing");
    assert_eq!(detector.live_task_count(), 0);
}

fn tool_call(name: &str, id: &str, parent: Option<&str>) -> String {
    format!(
        "{}\n",
        serde_json::json!({
            "type": "assistant",
            "parent_tool_use_id": parent,
            "message": {"content": [{"type": "tool_use", "id": id, "name": name, "input": {}}]}
        })
    )
}

fn shell_started_by(task: &str, tool: Option<&str>) -> String {
    let mut frame = serde_json::json!({
        "type": "system",
        "subtype": "task_started",
        "task_id": task,
        "task_type": "local_bash",
        "is_backgrounded": true
    });
    if let Some(tool) = tool {
        frame["tool_use_id"] = serde_json::json!(tool);
    }
    format!("{frame}\n")
}

fn kind_of(detector: &ResultLineDetector, task: &str) -> Option<BackgroundTaskKind> {
    detector
        .background_tasks()
        .into_iter()
        .find(|live| live.task_id == task)
        .map(|live| live.kind)
}

#[test]
fn only_a_task_started_by_a_root_tool_call_named_exactly_monitor_is_a_monitor() {
    let mut detector = awaiting();
    for call in [
        tool_call("Monitor", "toolu-watch", None),
        tool_call("Bash", "toolu-bash", None),
        tool_call("monitor", "toolu-lowercase", None),
        tool_call("MonitorTool", "toolu-longer", None),
        tool_call("Monitor", "toolu-nested", Some("toolu-agent")),
    ] {
        detector.feed(call.as_bytes()).unwrap();
    }
    for (task, tool) in [
        ("watch", Some("toolu-watch")),
        ("bash", Some("toolu-bash")),
        ("lowercase", Some("toolu-lowercase")),
        ("longer", Some("toolu-longer")),
        ("nested", Some("toolu-nested")),
        ("unseen", Some("toolu-unseen")),
        ("untied", None),
    ] {
        detector
            .feed(shell_started_by(task, tool).as_bytes())
            .unwrap();
    }

    assert_eq!(
        kind_of(&detector, "watch"),
        Some(BackgroundTaskKind::Monitor)
    );
    for task in ["bash", "lowercase", "longer", "nested", "unseen", "untied"] {
        assert_eq!(
            kind_of(&detector, task),
            Some(BackgroundTaskKind::Shell),
            "{task}"
        );
    }
}

#[test]
fn a_monitor_call_counts_only_from_a_frame_whose_parent_is_absent_or_null() {
    let monitor = BackgroundTaskKind::Monitor;
    let shell = BackgroundTaskKind::Shell;
    let parents = [
        ("absent", None, monitor),
        ("null", Some(serde_json::Value::Null), monitor),
        ("nested", Some(serde_json::json!("toolu-agent")), shell),
        ("empty", Some(serde_json::json!("")), shell),
        ("numeric", Some(serde_json::json!(7)), shell),
        ("zero", Some(serde_json::json!(0)), shell),
        ("false", Some(serde_json::json!(false)), shell),
        (
            "object",
            Some(serde_json::json!({"id": "toolu-agent"})),
            shell,
        ),
        ("array", Some(serde_json::json!(["toolu-agent"])), shell),
        (
            "oversized",
            Some(serde_json::json!("t".repeat(4096))),
            shell,
        ),
    ];
    let mut detector = awaiting();
    for (name, parent, _) in &parents {
        let mut call = serde_json::json!({
            "type": "assistant",
            "message": {"content": [
                {"type": "tool_use", "id": format!("toolu-{name}"), "name": "Monitor", "input": {}}
            ]}
        });
        if let Some(parent) = parent {
            call["parent_tool_use_id"] = parent.clone();
        }
        detector.feed(format!("{call}\n").as_bytes()).unwrap();
    }
    for (name, _, kind) in &parents {
        let started = shell_started_by(name, Some(&format!("toolu-{name}")));
        detector.feed(started.as_bytes()).unwrap();
        assert_eq!(kind_of(&detector, name), Some(*kind), "{name}");
    }
}

#[test]
fn a_monitor_stays_a_monitor_through_later_frames_and_is_forgotten_when_it_ends() {
    let mut detector = awaiting();
    detector
        .feed(tool_call("Monitor", "toolu-watch", None).as_bytes())
        .unwrap();
    detector
        .feed(shell_started_by("watch", Some("toolu-watch")).as_bytes())
        .unwrap();
    for later in [
        r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"watch","task_type":"local_bash"}]}"#,
        r#"{"type":"system","subtype":"task_progress","task_id":"watch","task_type":"local_bash","tool_use_id":"toolu-watch"}"#,
        r#"{"type":"system","subtype":"task_updated","task_id":"watch","patch":{"description":"still watching"}}"#,
    ] {
        detector.feed(format!("{later}\n").as_bytes()).unwrap();
        assert_eq!(
            kind_of(&detector, "watch"),
            Some(BackgroundTaskKind::Monitor),
            "{later}"
        );
    }

    detector.feed(DONE).unwrap();
    assert_eq!(kind_of(&detector, "watch"), None);
    detector
        .feed(shell_started_by("watch", Some("toolu-watch")).as_bytes())
        .unwrap();
    assert_eq!(kind_of(&detector, "watch"), Some(BackgroundTaskKind::Shell));
}

#[test]
fn remembered_monitor_calls_are_bounded_and_the_oldest_is_forgotten_first() {
    let mut detector = awaiting();
    for index in 0..=MAX_PENDING_MONITOR_CALLS {
        let call = tool_call("Monitor", &format!("toolu-{index}"), None);
        detector.feed(call.as_bytes()).unwrap();
    }
    detector
        .feed(shell_started_by("oldest", Some("toolu-0")).as_bytes())
        .unwrap();
    detector
        .feed(shell_started_by("second", Some("toolu-1")).as_bytes())
        .unwrap();
    let newest = format!("toolu-{MAX_PENDING_MONITOR_CALLS}");
    detector
        .feed(shell_started_by("newest", Some(&newest)).as_bytes())
        .unwrap();

    assert_eq!(
        kind_of(&detector, "oldest"),
        Some(BackgroundTaskKind::Shell)
    );
    assert_eq!(
        kind_of(&detector, "second"),
        Some(BackgroundTaskKind::Monitor)
    );
    assert_eq!(
        kind_of(&detector, "newest"),
        Some(BackgroundTaskKind::Monitor)
    );
}

#[test]
fn a_live_monitor_never_holds_a_session_turn_open_but_a_shell_beside_it_does() {
    let mut watching = awaiting();
    watching
        .feed(tool_call("Monitor", "toolu-watch", None).as_bytes())
        .unwrap();
    watching
        .feed(shell_started_by("watch", Some("toolu-watch")).as_bytes())
        .unwrap();
    assert!(
        watching.feed(RESULT).unwrap(),
        "a monitor alone lets the turn end"
    );
    assert_eq!(watching.live_background_task_count(), 1);

    let mut beside = awaiting();
    beside
        .feed(tool_call("Monitor", "toolu-watch", None).as_bytes())
        .unwrap();
    beside
        .feed(shell_started_by("watch", Some("toolu-watch")).as_bytes())
        .unwrap();
    beside
        .feed(shell_started_by("build", Some("toolu-bash")).as_bytes())
        .unwrap();
    assert!(
        !beside.feed(RESULT).unwrap(),
        "the shell still holds the turn"
    );
    let built = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"build\",\"status\":\"completed\"}\n";
    assert!(beside.feed(built).unwrap());
    assert_eq!(kind_of(&beside, "watch"), Some(BackgroundTaskKind::Monitor));

    let mut websocket = awaiting();
    let started = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"ws\",\"task_type\":\"monitor_ws\"}\n";
    websocket.feed(started).unwrap();
    assert!(websocket.feed(RESULT).unwrap());
}

#[test]
fn a_per_turn_process_still_waits_for_its_monitor() {
    let mut detector = ResultLineDetector::new();
    detector
        .feed(tool_call("Monitor", "toolu-watch", None).as_bytes())
        .unwrap();
    detector
        .feed(shell_started_by("watch", Some("toolu-watch")).as_bytes())
        .unwrap();
    assert_eq!(
        kind_of(&detector, "watch"),
        Some(BackgroundTaskKind::Monitor)
    );

    assert!(!detector.feed(RESULT).unwrap());
    assert_eq!(detector.live_task_count(), 1);
}
