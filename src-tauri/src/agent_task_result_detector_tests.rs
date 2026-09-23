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
fn stale_start_progress_and_duplicate_notification_do_not_resurrect() {
    let mut detector = ResultLineDetector::new();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector.feed(DONE).unwrap();
    detector.feed(start("watch").as_bytes()).unwrap();
    detector
        .feed(b"{\"type\":\"system\",\"subtype\":\"task_progress\",\"task_id\":\"watch\"}\n")
        .unwrap();
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
