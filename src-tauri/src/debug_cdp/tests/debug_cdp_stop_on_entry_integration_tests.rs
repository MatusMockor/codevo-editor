use super::*;
fn entry_pause(hit_breakpoints: &[&str]) -> Value {
    json!({
        "reason": "Break on start",
        "hitBreakpoints": hit_breakpoints,
        "data": {
            "className": "TypeError",
            "objectId": "entry-exception-object"
        },
        "callFrames": []
    })
}

fn ordinary_breakpoint_pause(hit_breakpoints: &[&str]) -> Value {
    json!({
        "reason": "other",
        "hitBreakpoints": hit_breakpoints,
        "callFrames": []
    })
}

fn start_stop_on_entry_session(
    server: &MockCdpServer,
    sink: Arc<CollectingSink>,
    initial_breakpoints: Vec<DebugBreakpoint>,
    stop_on_entry: bool,
) -> (DebugSessionRegistry, u64) {
    let registry = DebugSessionRegistry::new();
    let url = server.url.clone();
    let session_id = registry
        .start_session(WORKSPACE_KEY, sink, move |emitter| {
            NodeCdpAdapter::connect_with_source_maps_exception_filter_and_stop_on_entry(
                &url,
                emitter,
                &initial_breakpoints,
                &["TypeError".to_string()],
                NodeCdpConnectOptions {
                    exception_pause_mode: DebugExceptionPauseMode::All,
                    request_timeout: MOCK_REQUEST_TIMEOUT,
                    ownership: DebuggeeOwnership::External,
                    source_maps: None,
                    startup: CdpStartupPolicy::SpawnedWaiting {
                        startup_entry: None,
                    },
                    disconnected: None,
                    startup_is_current: Arc::new(|| true),
                    internal_step_filter: None,
                },
                stop_on_entry,
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("start stop-on-entry mock session");
    (registry, session_id)
}

fn wait_for_method_count(server: &MockCdpServer, method: &str, count: usize) {
    wait_for(
        || {
            (server
                .methods()
                .into_iter()
                .filter(|candidate| candidate == method)
                .count()
                >= count)
                .then_some(())
        },
        EVENT_WAIT_TIMEOUT,
        method,
    );
}

#[test]
fn stop_on_entry_surfaces_entry_without_auto_resume_and_registers_session() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", entry_pause(&[]))]
        }
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_stop_on_entry_session(&server, sink.clone(), Vec::new(), true);

    let (reason, _) = wait_for_stopped(&sink, 0);
    thread::sleep(SHORT_REQUEST_TIMEOUT);

    assert_eq!(reason, DebugStopReason::Entry);
    assert_eq!(
        registry.session_id_for_root(WORKSPACE_KEY),
        Some(session_id)
    );
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn step_and_resume_from_entry_pause_use_normal_transport_path() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", entry_pause(&[]))]
        }
        "Debugger.stepOver" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event(
                "Debugger.paused",
                json!({"reason": "step", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", ordinary_breakpoint_pause(&[])),
        ],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_stop_on_entry_session(&server, sink.clone(), Vec::new(), true);
    assert_eq!(wait_for_stopped(&sink, 0).0, DebugStopReason::Entry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
        .expect("registered session")
        .expect("step over");
    assert_eq!(wait_for_stopped(&sink, 1).0, DebugStopReason::Step);
    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::Continue))
        .expect("registered session")
        .expect("continue");
    assert_eq!(wait_for_stopped(&sink, 2).0, DebugStopReason::Breakpoint);
    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| matches!(method.as_str(), "Debugger.stepOver" | "Debugger.resume"))
            .collect::<Vec<_>>(),
        vec![
            "Debugger.stepOver".to_string(),
            "Debugger.resume".to_string()
        ]
    );
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn entry_pause_bypasses_breakpoint_hits_and_exception_classifier() {
    let file = breakpoint_fixture_file("stop-on-entry-hit-count");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId": "entry-overlap", "locations": []}),
        )],
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event("Debugger.paused", entry_pause(&["entry-overlap"])),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event(
                "Debugger.paused",
                ordinary_breakpoint_pause(&["entry-overlap"]),
            ),
        ],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let mut initial_breakpoint = breakpoint(&file_path, "bp-entry-overlap", 1, None, true);
    initial_breakpoint.hit_condition = Some(DebugHitCondition::Equals { count: 1 });
    let (registry, session_id) =
        start_stop_on_entry_session(&server, sink.clone(), vec![initial_breakpoint], true);
    assert_eq!(wait_for_stopped(&sink, 0).0, DebugStopReason::Entry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::Continue))
        .expect("registered session")
        .expect("continue");

    assert_eq!(wait_for_stopped(&sink, 1).0, DebugStopReason::Breakpoint);
    assert_eq!(
        server
            .methods()
            .iter()
            .filter(|method| method.as_str() == "Debugger.resume")
            .count(),
        1
    );
    assert!(!server
        .methods()
        .contains(&"Runtime.callFunctionOn".to_string()));
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn stop_on_entry_false_auto_resumes_first_entry_pause() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", entry_pause(&[]))]
        }
        "Debugger.resume" => vec![ok(id), event("Debugger.resumed", json!({}))],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_stop_on_entry_session(&server, sink.clone(), Vec::new(), false);

    wait_for_method_count(&server, "Debugger.resume", 1);
    thread::sleep(SHORT_REQUEST_TIMEOUT);

    assert_eq!(
        registry.session_id_for_root(WORKSPACE_KEY),
        Some(session_id)
    );
    assert!(!sink
        .payloads()
        .iter()
        .any(|payload| matches!(payload, DebugEventPayload::Stopped { .. })));
    assert!(registry.stop_by_id(session_id));
}
