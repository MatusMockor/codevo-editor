use super::*;

fn success(request_id: &str) -> Value {
    serde_json::json!({
        "type":"control_response",
        "response":{"subtype":"success","request_id":request_id}
    })
}

fn error(request_id: &str, message: Value) -> Value {
    serde_json::json!({
        "type":"control_response",
        "response":{"subtype":"error","request_id":request_id,"error":message}
    })
}

#[test]
fn the_stop_frame_is_the_documented_stop_task_control_request() {
    let frame = stop_task_frame("req-stop-1", "b8kzpiexm");
    assert_eq!(frame.last(), Some(&b'\n'));
    assert_eq!(frame.iter().filter(|byte| **byte == b'\n').count(), 1);
    let parsed: Value = serde_json::from_slice(&frame).expect("frame json");
    assert_eq!(
        parsed,
        serde_json::json!({
            "type":"control_request",
            "request_id":"req-stop-1",
            "request":{"subtype":"stop_task","task_id":"b8kzpiexm"}
        })
    );
}

#[test]
fn a_success_reply_is_taken_exactly_once() {
    let mut stops = PendingTaskStops::default();
    assert!(stops.begin("req-1".to_string()));
    assert_eq!(stops.take("req-1"), None);
    assert!(stops.resolve(&success("req-1")));
    assert!(stops.resolve(&success("req-1")));
    assert_eq!(stops.take("req-1"), Some(TaskStopReply::Accepted));
    assert_eq!(stops.take("req-1"), None);
    assert!(stops.resolve(&success("req-1")));
    assert_eq!(stops.take("req-1"), None);
}

#[test]
fn an_error_reply_is_a_bounded_truthful_refusal() {
    let mut stops = PendingTaskStops::default();
    assert!(stops.begin("req-1".to_string()));
    assert!(stops.begin("req-2".to_string()));
    assert!(stops.begin("req-3".to_string()));
    assert!(stops.resolve(&error(
        "req-1",
        serde_json::json!("No task found with ID: b8kzpiexm")
    )));
    let long = format!("bad\u{0007}{}", "é".repeat(400));
    assert!(stops.resolve(&error("req-2", serde_json::json!(long))));
    assert!(stops.resolve(&error("req-3", serde_json::json!(7))));

    assert_eq!(
        stops.take("req-1"),
        Some(TaskStopReply::Refused(
            "No task found with ID: b8kzpiexm".to_string()
        ))
    );
    let bounded = match stops.take("req-2") {
        Some(TaskStopReply::Refused(reason)) => reason,
        _ => String::new(),
    };
    assert!(bounded.len() > 200);
    assert!(bounded.len() <= MAX_TASK_STOP_REASON_BYTES);
    assert!(bounded.starts_with("bad"));
    assert!(!bounded.chars().any(char::is_control));
    assert_eq!(
        stops.take("req-3"),
        Some(TaskStopReply::Refused(UNEXPLAINED_REFUSAL.to_string()))
    );
}

#[test]
fn foreign_and_malformed_replies_are_not_claimed() {
    let mut stops = PendingTaskStops::default();
    assert!(stops.begin("req-1".to_string()));
    assert!(!stops.resolve(&success("req-other")));
    assert!(!stops.resolve(&serde_json::json!({"type":"control_response"})));
    assert!(!stops.resolve(&serde_json::json!({
        "type":"control_request","request_id":"req-1","request":{"subtype":"interrupt"}
    })));
    assert!(!stops.resolve(&serde_json::json!({
        "type":"control_response","response":{"subtype":"later","request_id":"req-1"}
    })));
    assert_eq!(stops.take("req-1"), None);
}

#[test]
fn a_withdrawn_request_swallows_its_late_reply() {
    let mut stops = PendingTaskStops::default();
    assert!(stops.begin("req-1".to_string()));
    stops.withdraw("req-1");
    assert!(stops.resolve(&success("req-1")));
    assert_eq!(stops.take("req-1"), None);
    for index in 0..MAX_RETIRED_TASK_STOPS {
        let id = format!("req-late-{index}");
        assert!(stops.begin(id.clone()));
        stops.withdraw(&id);
    }
    assert!(!stops.resolve(&success("req-1")));
}

#[test]
fn pending_stops_are_bounded_and_ids_unique() {
    let mut stops = PendingTaskStops::default();
    for index in 0..MAX_PENDING_TASK_STOPS {
        assert!(stops.begin(format!("req-{index}")));
    }
    assert!(!stops.begin("req-overflow".to_string()));
    stops.withdraw("req-0");
    assert!(!stops.begin("req-1".to_string()));
    assert!(stops.begin("req-overflow".to_string()));
}

#[test]
fn stoppable_task_ids_are_bounded_text() {
    assert!(valid_stoppable_task_id("b8kzpiexm"));
    assert!(valid_stoppable_task_id("a4b355dcf6056a875"));
    assert!(!valid_stoppable_task_id(""));
    assert!(!valid_stoppable_task_id("bad\nid"));
    assert!(!valid_stoppable_task_id(
        &"x".repeat(MAX_STOPPABLE_TASK_ID_BYTES + 1)
    ));
    assert!(valid_stoppable_task_id(
        &"x".repeat(MAX_STOPPABLE_TASK_ID_BYTES)
    ));
}

#[test]
fn the_outcome_wire_shape_is_closed() {
    for (outcome, wire) in [
        (
            ClaudeBackgroundTaskStopOutcome::Stopping,
            r#"{"kind":"stopping"}"#,
        ),
        (
            ClaudeBackgroundTaskStopOutcome::Refused {
                reason: "No task found with ID: b8kzpiexm".to_string(),
            },
            r#"{"kind":"refused","reason":"No task found with ID: b8kzpiexm"}"#,
        ),
        (
            ClaudeBackgroundTaskStopOutcome::Unconfirmed,
            r#"{"kind":"unconfirmed"}"#,
        ),
        (
            ClaudeBackgroundTaskStopOutcome::NotLive,
            r#"{"kind":"notLive"}"#,
        ),
        (
            ClaudeBackgroundTaskStopOutcome::NoSession,
            r#"{"kind":"noSession"}"#,
        ),
        (
            ClaudeBackgroundTaskStopOutcome::Unavailable,
            r#"{"kind":"unavailable"}"#,
        ),
    ] {
        assert_eq!(serde_json::to_string(&outcome).expect("json"), wire);
    }
}
