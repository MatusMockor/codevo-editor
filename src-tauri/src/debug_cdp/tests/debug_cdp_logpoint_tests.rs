use super::*;
use crate::debug_adapter::{DebugEvaluateContext, DebugEvaluateErrorKind, DebugEvaluatePolicy};
use crate::debug_hit_condition::DebugHitCondition;
use serde_json::json;
use std::sync::mpsc;

fn configured_logpoint(name: &str, message: &str) -> DebugBreakpoint {
    let file = breakpoint_fixture_file(name);
    let mut configured = breakpoint(&file.to_string_lossy(), name, 1, Some("enabled"), true);
    configured.log_message = Some(message.into());
    configured
}

fn logpoint_pause(id: &str) -> Value {
    let mut paused = breakpoint_paused_params();
    paused["hitBreakpoints"] = json!([id]);
    paused
}

#[test]
fn logpoint_evaluates_in_order_outputs_and_resumes_without_ui_pause_events() {
    let paused = logpoint_pause("cdp-log");
    let server = MockCdpServer::start(Box::new(move |id, method, params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.evaluateOnCallFrame" => {
            let value = if params["expression"] == "count" {
                7
            } else {
                9
            };
            vec![result(
                id,
                json!({"result":{"type":"number","value":value}}),
            )]
        }
        "Debugger.resume" => vec![ok(id), event("Debugger.resumed", json!({}))],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("ordered-log", "count={count}, next={next}");

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    wait_for(
        || {
            sink.payloads()
                .iter()
                .any(|payload| {
                    matches!(payload,
            DebugEventPayload::Output { stream: DebugOutputStream::Stdout, text }
                if text == "count=7, next=9\n")
                })
                .then_some(())
        },
        EVENT_WAIT_TIMEOUT,
        "logpoint output",
    );

    let payloads = sink.payloads();
    assert!(!payloads.iter().any(|payload| matches!(
        payload,
        DebugEventPayload::Stopped { .. } | DebugEventPayload::Resumed
    )));
    assert_eq!(
        server.params_for("Debugger.evaluateOnCallFrame"),
        vec![
            json!({"callFrameId":"cf-0","expression":"count","silent":true,"returnByValue":true,"awaitPromise":false}),
            json!({"callFrameId":"cf-0","expression":"next","silent":true,"returnByValue":true,"awaitPromise":false}),
        ]
    );
    assert_eq!(
        server.params_for("Debugger.setBreakpointByUrl")[0]["condition"],
        json!("enabled")
    );
}

#[test]
fn evaluation_failure_emits_diagnostic_and_surfaces_original_pause() {
    let paused = logpoint_pause("cdp-log");
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result":{"type":"undefined"},"exceptionDetails":{"text":"boom"}}),
        )],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("evaluation-failure", "value={explode()}");

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    let (reason, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(!frames.is_empty());
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("threw an exception"))));
}

#[test]
fn failed_resume_keeps_output_but_falls_back_to_visible_stop() {
    let paused = logpoint_pause("cdp-log");
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.resume" => vec![error_reply(id, "resume rejected")],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("resume-failure", "literal only");

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    let (reason, _) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stdout, text }
            if text == "literal only\n")));
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("Unable to resume"))));
}

#[test]
fn explicit_pause_during_evaluation_cancels_auto_resume() {
    let paused = logpoint_pause("cdp-log");
    let (evaluation_entered_tx, evaluation_entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let mut release_rx = Some(release_rx);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.evaluateOnCallFrame" => {
            evaluation_entered_tx.send(()).expect("evaluation entered");
            release_rx
                .take()
                .expect("single evaluation")
                .recv()
                .expect("release evaluation");
            vec![result(id, json!({"result":{"type":"number","value":7}}))]
        }
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("explicit-pause", "value={count}");
    let (registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    evaluation_entered_rx
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("evaluation request");

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect("pause internal logpoint");
    release_tx.send(()).expect("release response");
    let (reason, _) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(!server.methods().contains(&"Debugger.pause".to_string()));
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
}

#[test]
fn evaluation_timeout_surfaces_the_real_pause_and_releases_pause_control() {
    let paused = logpoint_pause("cdp-log");
    let mut explicit_pause = breakpoint_paused_params();
    explicit_pause["hitBreakpoints"] = json!([]);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.evaluateOnCallFrame" => Vec::new(),
        "Debugger.pause" => vec![ok(id), event("Debugger.paused", explicit_pause.clone())],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("evaluation-timeout", "value={count}");
    let (registry, sink) =
        start_session_with_mock(&server.url, vec![configured], SHORT_REQUEST_TIMEOUT);

    let (reason, frames) = wait_for_stopped(&sink, 0);
    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(!frames.is_empty());
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("Timed out while evaluating"))));

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect("pause after timeout");
    wait_for(
        || (server.params_for("Debugger.pause").len() == 1).then_some(()),
        EVENT_WAIT_TIMEOUT,
        "explicit pause request after timeout",
    );
}

fn assert_pause_during_resume_is_reissued(event_before_response: bool) {
    let paused = logpoint_pause("cdp-log");
    let mut explicit_pause = breakpoint_paused_params();
    explicit_pause["hitBreakpoints"] = json!([]);
    let (resume_entered_tx, resume_entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let mut release_rx = Some(release_rx);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.resume" => {
            resume_entered_tx.send(()).expect("resume entered");
            release_rx
                .take()
                .expect("single resume")
                .recv()
                .expect("release resume");
            if event_before_response {
                vec![event("Debugger.resumed", json!({})), ok(id)]
            } else {
                vec![ok(id), event("Debugger.resumed", json!({}))]
            }
        }
        "Debugger.pause" => vec![ok(id), event("Debugger.paused", explicit_pause.clone())],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("pause-during-resume", "literal only");
    let (registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    resume_entered_rx
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("resume request");

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect("defer explicit pause");
    release_tx.send(()).expect("release resume response");
    let (_, frames) = wait_for_stopped(&sink, 0);

    assert!(!frames.is_empty());
    assert_eq!(server.params_for("Debugger.pause").len(), 1);
    assert!(!sink
        .payloads()
        .iter()
        .any(|payload| matches!(payload, DebugEventPayload::Resumed)));
}

#[test]
fn pause_during_resume_is_reissued_when_response_arrives_first() {
    assert_pause_during_resume_is_reissued(false);
}

#[test]
fn pause_during_resume_is_reissued_when_resumed_event_arrives_first() {
    assert_pause_during_resume_is_reissued(true);
}

#[test]
fn pause_is_deferred_across_the_resume_response_event_gap() {
    let mut shared = CdpShared::new(None);
    shared.suppress_next_resumed = true;

    assert!(mark_explicit_pause_requested(&mut shared));
    shared.suppress_next_resumed = false;
    assert!(mark_explicit_pause_requested(&mut shared));
}

#[test]
fn resume_timeout_reissues_pause_and_waits_for_authoritative_frames() {
    let paused = logpoint_pause("cdp-log");
    let mut authoritative_pause = breakpoint_paused_params();
    authoritative_pause["hitBreakpoints"] = json!([]);
    authoritative_pause["callFrames"][0]["functionName"] = json!("authoritativePause");
    let (resume_entered_tx, resume_entered_rx) = mpsc::channel();
    let mut resume_count = 0usize;
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.resume" => {
            resume_count += 1;
            if resume_count == 1 {
                resume_entered_tx.send(()).expect("resume entered");
                Vec::new()
            } else {
                vec![ok(id), event("Debugger.resumed", json!({}))]
            }
        }
        "Debugger.pause" => vec![
            ok(id),
            event("Debugger.paused", authoritative_pause.clone()),
        ],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("resume-timeout", "literal only");
    let (registry, sink) =
        start_session_with_mock(&server.url, vec![configured], SHORT_REQUEST_TIMEOUT);
    resume_entered_rx
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("resume request");

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect("defer pause while resume response is missing");
    let (_, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(frames[0].name, "authoritativePause");
    assert_eq!(server.params_for("Debugger.pause").len(), 1);
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("Timed out while resuming internally"))));
    assert!(!sink
        .payloads()
        .iter()
        .any(|payload| matches!(payload, DebugEventPayload::Resumed)));

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::Continue))
        .expect("session")
        .expect("continue after authoritative recovery pause");
    wait_for(
        || {
            (sink
                .payloads()
                .iter()
                .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
                .count()
                == 1)
                .then_some(())
        },
        EVENT_WAIT_TIMEOUT,
        "visible resume after recovery pause",
    );
    assert_eq!(
        sink.payloads()
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count(),
        1
    );
}

#[test]
fn resume_timeout_restores_original_pause_when_recovery_pause_is_rejected() {
    let paused = logpoint_pause("cdp-log");
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.resume" => Vec::new(),
        "Debugger.pause" => vec![error_reply(id, "pause rejected")],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("resume-timeout-pause-error", "literal only");
    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], SHORT_REQUEST_TIMEOUT);

    let (_, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(frames[0].name, "handleRequest");
    assert_eq!(server.params_for("Debugger.pause").len(), 1);
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("Unable to pause after an internal resume"))));
    assert_eq!(
        sink.payloads()
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Stopped { .. }))
            .count(),
        1
    );
}

#[test]
fn resume_timeout_restores_original_pause_when_recovery_has_no_paused_event() {
    let paused = logpoint_pause("cdp-log");
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.resume" => Vec::new(),
        "Debugger.pause" => vec![ok(id)],
        _ => vec![ok(id)],
    }));
    let configured = configured_logpoint("resume-timeout-pause-event-timeout", "literal only");
    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], SHORT_REQUEST_TIMEOUT);

    let (_, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(frames[0].name, "handleRequest");
    assert_eq!(server.params_for("Debugger.pause").len(), 1);
    assert!(sink.payloads().iter().any(|payload| matches!(payload,
        DebugEventPayload::Output { stream: DebugOutputStream::Stderr, text }
            if text.contains("Timed out while pausing after an internal resume"))));
    assert_eq!(
        sink.payloads()
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Stopped { .. }))
            .count(),
        1
    );
}

#[test]
fn hit_condition_filters_before_logging_and_resets_no_ui_state() {
    let paused = logpoint_pause("cdp-log");
    let mut resume_count = 0usize;
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-log", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        "Debugger.evaluateOnCallFrame" => {
            vec![result(id, json!({"result":{"type":"number","value":2}}))]
        }
        "Debugger.resume" => {
            resume_count += 1;
            if resume_count == 1 {
                vec![
                    ok(id),
                    event("Debugger.resumed", json!({})),
                    event("Debugger.paused", paused.clone()),
                ]
            } else {
                vec![ok(id), event("Debugger.resumed", json!({}))]
            }
        }
        _ => vec![ok(id)],
    }));
    let mut configured = configured_logpoint("hit-filtered-log", "hit={count}");
    configured.hit_condition = Some(DebugHitCondition::Equals { count: 2 });

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    wait_for(
        || {
            sink.payloads()
                .iter()
                .any(|payload| {
                    matches!(payload,
                    DebugEventPayload::Output { stream: DebugOutputStream::Stdout, text }
                        if text == "hit=2\n")
                })
                .then_some(())
        },
        EVENT_WAIT_TIMEOUT,
        "second-hit log output",
    );

    assert_eq!(server.params_for("Debugger.evaluateOnCallFrame").len(), 1);
    assert_eq!(server.params_for("Debugger.resume").len(), 2);
    assert!(!sink.payloads().iter().any(|payload| matches!(
        payload,
        DebugEventPayload::Stopped { .. } | DebugEventPayload::Resumed
    )));
}

#[test]
fn ordinary_breakpoint_collision_stops_without_evaluating_logpoint() {
    let mut paused = breakpoint_paused_params();
    paused["hitBreakpoints"] = json!(["cdp-log", "cdp-stop"]);
    let mut registration = 0usize;
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => {
            registration += 1;
            vec![result(
                id,
                json!({"breakpointId": if registration == 1 {"cdp-log"} else {"cdp-stop"}, "locations":[]}),
            )]
        }
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused.clone())]
        }
        _ => vec![ok(id)],
    }));
    let logging = configured_logpoint("collision-log", "value={count}");
    let file_path = logging.file_path.clone();
    let stopping = breakpoint(&file_path, "ordinary", 2, None, true);

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![logging, stopping], MOCK_REQUEST_TIMEOUT);
    let (reason, _) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
    assert!(server.params_for("Debugger.resume").is_empty());
}

#[test]
fn watch_evaluate_uses_the_strict_cdp_side_effect_policy() {
    let server = MockCdpServer::start(flow_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let evaluated = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                frames[0].frame_id,
                "count + 1",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("watch evaluate");
    assert_eq!(
        server.params_for("Debugger.evaluateOnCallFrame"),
        vec![json!({
            "callFrameId": "cf-0", "expression": "count + 1", "silent": true,
            "throwOnSideEffect": true, "awaitPromise": false,
        })]
    );
    assert_eq!(evaluated.value, "42");
}

#[test]
fn watch_evaluate_classifies_cdp_side_effect_rejections() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({
                "result": {"type": "object", "subtype": "error"},
                "exceptionDetails": {
                    "text": "EvalError",
                    "exception": {"description": "EvalError: Possible side-effect in debug-evaluate"}
                }
            }),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let failure = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                frames[0].frame_id,
                "mutate()",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect_err("side effect must fail");
    assert_eq!(failure.kind, DebugEvaluateErrorKind::SideEffect);
}

#[test]
fn evaluate_rejects_a_reply_after_the_pause_owner_changes() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.evaluateOnCallFrame" => vec![
            event("Debugger.resumed", json!({})),
            result(
                id,
                json!({"result": {"type": "number", "value": 42, "description": "42"}}),
            ),
        ],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let failure = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate(frames[0].frame_id, "count + 1")
        })
        .expect("session")
        .expect_err("stale pause reply must fail");

    assert!(failure.contains("pause owner changed"));
}
