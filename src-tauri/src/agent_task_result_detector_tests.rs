use super::*;

fn start(id: &str) -> String {
    format!("{{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"{id}\",\"task_type\":\"local_bash\"}}\n")
}
const RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\"}\n";
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
