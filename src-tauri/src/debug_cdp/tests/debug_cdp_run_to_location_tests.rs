use super::*;

fn run_to_location_responder(resolved: bool, removal_failures: usize) -> MockResponder {
    let mut removal_attempts = 0;
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
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({
                "breakpointId": "temporary-run-to-location",
                "locations": if resolved {
                    json!([{"scriptId": "script-7", "lineNumber": 14, "columnNumber": 2}])
                } else {
                    json!([])
                }
            }),
        )],
        "Debugger.removeBreakpoint" => {
            removal_attempts += 1;
            if removal_attempts <= removal_failures {
                vec![error_reply(id, "temporary cleanup failed")]
            } else {
                vec![ok(id)]
            }
        }
        _ => vec![ok(id)],
    })
}

fn paused_generation(registry: &DebugSessionRegistry) -> u64 {
    wait_for(
        || {
            registry
                .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
                .ok()
                .flatten()
        },
        EVENT_WAIT_TIMEOUT,
        "run-to-location pause",
    )
}

fn start_session_with_real_owner_predicate(
    server_url: &str,
) -> (Arc<DebugSessionRegistry>, Arc<CollectingSink>, u64) {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let permit = registry.begin_start(WORKSPACE_KEY).expect("start permit");
    let observed_permit = permit.clone();
    let observed_registry = Arc::clone(&registry);
    let url = server_url.to_string();
    let session_id = registry
        .start_session_with_permit(permit, sink.clone(), move |emitter| {
            let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> =
                Arc::new(move || observed_registry.startup_is_current(&observed_permit));
            NodeCdpAdapter::connect_with_source_maps(
                &url,
                emitter,
                &[],
                NodeCdpConnectOptions {
                    exception_pause_mode: DebugExceptionPauseMode::None,
                    request_timeout: MOCK_REQUEST_TIMEOUT,
                    ownership: DebuggeeOwnership::External,
                    source_maps: None,
                    startup: CdpStartupPolicy::SpawnedWaiting {
                        startup_entry: None,
                    },
                    disconnected: None,
                    startup_is_current,
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("owned CDP session");
    (registry, sink, session_id)
}

#[test]
fn resolves_removes_probe_then_continues_once() {
    let file = breakpoint_fixture_file("run-to-location");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(run_to_location_responder(true, 0));
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let pause_generation = paused_generation(&registry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.run_to_location(pause_generation, &file_path, 12, 5)
        })
        .expect("session")
        .expect("resolved location");

    let methods = server.methods();
    let set = methods
        .iter()
        .rposition(|method| method == "Debugger.setBreakpointByUrl")
        .unwrap();
    let remove = methods
        .iter()
        .rposition(|method| method == "Debugger.removeBreakpoint")
        .unwrap();
    let continue_to = methods
        .iter()
        .rposition(|method| method == "Debugger.continueToLocation")
        .unwrap();
    assert!(set < remove && remove < continue_to);
    assert_eq!(
        methods
            .iter()
            .filter(|method| *method == "Debugger.continueToLocation")
            .count(),
        1
    );
    assert_eq!(
        server
            .params_for("Debugger.setBreakpointByUrl")
            .last()
            .unwrap(),
        &json!({
            "url": file_url_from_path(&file_path),
            "lineNumber": 11,
            "columnNumber": 4
        })
    );
    assert_eq!(
        server.params_for("Debugger.removeBreakpoint"),
        vec![json!({"breakpointId": "temporary-run-to-location"})]
    );
    assert_eq!(
        server.params_for("Debugger.continueToLocation"),
        vec![json!({
            "location": {"scriptId": "script-7", "lineNumber": 14, "columnNumber": 2},
            "targetCallFrames": "any"
        })]
    );
}

#[test]
fn registry_control_with_real_owner_predicate_does_not_reenter_state_mutex() {
    let file = breakpoint_fixture_file("run-to-location-control-owner");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(run_to_location_responder(true, 0));
    let (registry, _sink, session_id) = start_session_with_real_owner_predicate(&server.url);
    let pause_generation = paused_generation(&registry);
    let worker_registry = Arc::clone(&registry);
    let (done_tx, done_rx) = mpsc::channel();

    let worker = thread::spawn(move || {
        let result = worker_registry
            .control_for_session(session_id, WORKSPACE_KEY, |adapter| {
                adapter.run_to_location(pause_generation, &file_path, 1, 1)
            })
            .and_then(|result| result);
        done_tx.send(result).expect("control result");
    });

    done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("control must not deadlock")
        .expect("run to location");
    worker.join().expect("control worker");
}

#[test]
fn registry_control_serializes_stop_and_replacement_around_cdp_mutation() {
    for lifecycle in ["stop", "replacement"] {
        let file = breakpoint_fixture_file(&format!("run-to-location-{lifecycle}-race"));
        let file_path = file.to_string_lossy().to_string();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let mut resumed_entry = false;
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "other", "callFrames": []}),
                ),
            ],
            "Debugger.resume" if !resumed_entry => {
                resumed_entry = true;
                vec![
                    ok(id),
                    event("Debugger.resumed", json!({})),
                    event("Debugger.paused", breakpoint_paused_params()),
                ]
            }
            "Debugger.setBreakpointByUrl" => {
                entered_tx.send(()).expect("entered CDP mutation");
                release_rx.recv().expect("release CDP mutation");
                vec![result(
                    id,
                    json!({
                        "breakpointId": "temporary-race",
                        "locations": [{"scriptId": "script-7", "lineNumber": 0, "columnNumber": 0}]
                    }),
                )]
            }
            _ => vec![ok(id)],
        }));
        let (registry, _sink, session_id) = start_session_with_real_owner_predicate(&server.url);
        let pause_generation = paused_generation(&registry);
        let control_registry = Arc::clone(&registry);
        let (control_tx, control_rx) = mpsc::channel();
        let control = thread::spawn(move || {
            let result = control_registry
                .control_for_session(session_id, WORKSPACE_KEY, |adapter| {
                    adapter.run_to_location(pause_generation, &file_path, 1, 1)
                })
                .and_then(|result| result);
            control_tx.send(result).expect("control result");
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("control entered CDP");

        let lifecycle_registry = Arc::clone(&registry);
        let (lifecycle_tx, lifecycle_rx) = mpsc::channel();
        let lifecycle_worker = thread::spawn(move || {
            let completed = if lifecycle == "stop" {
                lifecycle_registry.stop(WORKSPACE_KEY)
            } else {
                lifecycle_registry.begin_start(WORKSPACE_KEY).is_ok()
            };
            lifecycle_tx.send(completed).expect("lifecycle result");
        });
        assert!(lifecycle_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        release_tx.send(()).expect("release control");
        let control_result = control_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("control completed");
        assert!(
            control_result.is_err(),
            "{lifecycle} must stale the control"
        );
        assert!(lifecycle_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("lifecycle completed"));
        control.join().expect("control worker");
        lifecycle_worker.join().expect("lifecycle worker");
    }
}

#[test]
fn unresolved_location_removes_probe_without_resuming() {
    let file = breakpoint_fixture_file("run-to-location-unresolved");
    let server = MockCdpServer::start(run_to_location_responder(false, 0));
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let pause_generation = paused_generation(&registry);

    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.run_to_location(pause_generation, &file.to_string_lossy(), 1, 1)
        })
        .expect("session")
        .expect_err("unresolved location");

    assert!(error.contains("not loaded") || error.contains("resolved"));
    assert_eq!(
        server.params_for("Debugger.removeBreakpoint"),
        vec![json!({"breakpointId": "temporary-run-to-location"})]
    );
    assert!(server.params_for("Debugger.continueToLocation").is_empty());
}

#[test]
fn cleanup_retries_once_before_continuing() {
    let file = breakpoint_fixture_file("run-to-location-cleanup-retry");
    let server = MockCdpServer::start(run_to_location_responder(true, 1));
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let pause_generation = paused_generation(&registry);

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.run_to_location(pause_generation, &file.to_string_lossy(), 1, 1)
        })
        .expect("session")
        .expect("cleanup retry");

    assert_eq!(server.params_for("Debugger.removeBreakpoint").len(), 2);
    assert_eq!(server.params_for("Debugger.continueToLocation").len(), 1);
}

#[test]
fn persistent_cleanup_failure_terminates_adapter_without_continuing() {
    let file = breakpoint_fixture_file("run-to-location-cleanup-fail");
    let server = MockCdpServer::start(run_to_location_responder(true, 2));
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let pause_generation = paused_generation(&registry);

    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.run_to_location(pause_generation, &file.to_string_lossy(), 1, 1)
        })
        .expect("session")
        .expect_err("persistent cleanup failure");

    assert!(error.contains("terminated"));
    assert_eq!(server.params_for("Debugger.removeBreakpoint").len(), 2);
    assert!(server.params_for("Debugger.continueToLocation").is_empty());
    let disconnected = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("registered session");
    assert!(disconnected.is_err());
}

#[test]
fn pause_sends_debugger_pause_and_stack_trace_requires_a_pause() {
    let server = MockCdpServer::start(simple_responder());
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

    let paused = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session");
    let stack = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.stack_trace())
        .expect("session");

    assert_eq!(paused, Ok(()));
    assert!(server.methods().contains(&"Debugger.pause".to_string()));
    assert_eq!(stack, Err("The debugger is not paused.".to_string()));
}

#[test]
fn unanswered_requests_time_out_instead_of_hanging() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| {
        if method == "Debugger.pause" {
            return Vec::new();
        }
        vec![ok(id)]
    }));
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), SHORT_REQUEST_TIMEOUT);

    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect_err("request must time out");

    assert!(error.contains("timed out"));
}
