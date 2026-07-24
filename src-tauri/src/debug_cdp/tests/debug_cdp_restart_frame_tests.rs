use super::*;

fn restart_paused_params() -> Value {
    json!({
        "reason": "step",
        "callFrames": [{
            "callFrameId": "cf-restarted",
            "functionName": "load",
            "url": "file:///workspace/demo/my%20module.js",
            "location": {"lineNumber": 3, "columnNumber": 1},
            "scopeChain": []
        }]
    })
}

fn restart_frame_responder(paused_before_ack: bool) -> MockResponder {
    Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "other", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.restartFrame" if paused_before_ack => vec![
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", restart_paused_params()),
            ok(id),
        ],
        "Debugger.restartFrame" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", restart_paused_params()),
        ],
        _ => vec![ok(id)],
    })
}

fn current_pause_generation(registry: &DebugSessionRegistry) -> u64 {
    wait_for(
        || {
            registry
                .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
                .ok()
                .flatten()
        },
        EVENT_WAIT_TIMEOUT,
        "restart-frame pause",
    )
}

#[test]
fn restarts_exact_frontend_frame_and_replaces_the_pause_inventory_after_ack() {
    let server = MockCdpServer::start(restart_frame_responder(false));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (initial_reason, frames) = wait_for_stopped(&sink, 0);
    assert_eq!(initial_reason, DebugStopReason::Breakpoint);
    let old_frame_ids: Vec<u64> = frames.iter().map(|frame| frame.frame_id).collect();
    let selected = frames[1].frame_id;
    let pause_generation = current_pause_generation(&registry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, selected)
        })
        .expect("session")
        .expect("restart frame ACK");

    assert_eq!(
        server.params_for("Debugger.restartFrame"),
        vec![json!({"callFrameId": "cf-1", "mode": "StepInto"})]
    );
    let (restart_reason, restarted_frames) = wait_for_stopped(&sink, 1);
    assert_eq!(restart_reason, DebugStopReason::Restart);
    assert_eq!(restarted_frames.len(), 1);
    assert_eq!(restarted_frames[0].name, "load");
    assert!(!old_frame_ids.contains(&restarted_frames[0].frame_id));
    assert!(current_pause_generation(&registry) > pause_generation);
}

#[test]
fn accepts_a_new_paused_snapshot_that_races_the_restart_ack() {
    let server = MockCdpServer::start(restart_frame_responder(true));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect("restart frame ACK after raced pause");

    let (restart_reason, restarted_frames) = wait_for_stopped(&sink, 1);
    assert_eq!(restart_reason, DebugStopReason::Restart);
    assert_eq!(restarted_frames[0].name, "load");
    assert!(current_pause_generation(&registry) > pause_generation);
}

#[test]
fn rejects_stale_and_unknown_frontend_frames_without_sending_cdp() {
    let server = MockCdpServer::start(restart_frame_responder(false));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);

    let stale = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation + 1, frames[0].frame_id)
        })
        .expect("session");
    assert_eq!(
        stale,
        Err("The debugger pause generation is stale.".to_string())
    );
    let missing = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, u64::MAX)
        })
        .expect("session");
    assert_eq!(missing, Err(format!("Unknown debug frame {}.", u64::MAX)));
    assert!(server.params_for("Debugger.restartFrame").is_empty());
}

#[test]
fn protocol_error_clears_unconsumed_pending_restart_and_allows_retry() {
    let mut attempts = 0;
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "other", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.restartFrame" => {
            attempts += 1;
            if attempts == 1 {
                vec![error_reply(id, "restart unsupported")]
            } else {
                vec![ok(id)]
            }
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);

    let first = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session");
    assert_eq!(first, Err("restart unsupported".to_string()));
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect("retry after protocol error");
    assert_eq!(server.params_for("Debugger.restartFrame").len(), 2);
}

#[test]
fn disconnect_clears_the_pending_marker_and_never_reports_success() {
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "other", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.restartFrame" => vec![CLOSE_MARKER.to_string()],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);

    let first = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect_err("disconnect must fail restart");
    assert!(first.contains("connection closed"));
    let second = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect_err("closed connection must still fail");
    assert!(!second.contains("already pending"));
}

#[test]
fn restart_frame_does_not_report_success_before_the_cdp_ack() {
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "other", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.restartFrame" => {
            thread::sleep(Duration::from_millis(75));
            vec![ok(id)]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);
    let started = Instant::now();

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect("delayed restart ACK");

    assert!(started.elapsed() >= Duration::from_millis(60));
}

#[test]
fn expired_restart_marker_cannot_mislabel_a_later_unrelated_pause() {
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "other", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.restartFrame" => vec![ok(id)],
        "Debugger.stepOver" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event(
                "Debugger.paused",
                json!({"reason": "step", "callFrames": []}),
            ),
        ],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), SHORT_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = current_pause_generation(&registry);
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.restart_frame(pause_generation, frames[0].frame_id)
        })
        .expect("session")
        .expect("restart ACK without lifecycle");

    thread::sleep(SHORT_REQUEST_TIMEOUT.saturating_mul(4));
    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
        .expect("session")
        .expect("later step");

    let (reason, _) = wait_for_stopped(&sink, 1);
    assert_eq!(reason, DebugStopReason::Step);
}
