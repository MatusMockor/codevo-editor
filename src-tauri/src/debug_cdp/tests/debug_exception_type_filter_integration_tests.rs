use super::*;
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc::Receiver;

const FILTER_TIMEOUT: Duration = Duration::from_millis(80);

fn exception_pause(class_name: Option<&str>, object_id: Option<&str>) -> Value {
    let mut data = serde_json::Map::new();
    if let Some(class_name) = class_name {
        data.insert("className".to_string(), json!(class_name));
    }
    if let Some(object_id) = object_id {
        data.insert("objectId".to_string(), json!(object_id));
    }
    json!({
        "reason": "exception",
        "data": data,
        "callFrames": [{
            "callFrameId": "exception-frame",
            "functionName": "throwFailure",
            "url": "file:///workspace/debug/app.js",
            "location": {
                "scriptId": "7",
                "lineNumber": 3,
                "columnNumber": 1
            },
            "scopeChain": []
        }]
    })
}

fn step_pause() -> Value {
    json!({
        "reason": "step",
        "data": {
            "className": "IgnoredError",
            "objectId": "ignored-object"
        },
        "callFrames": [{
            "callFrameId": "step-frame",
            "functionName": "advance",
            "url": "file:///workspace/debug/app.js",
            "location": {
                "scriptId": "8",
                "lineNumber": 5,
                "columnNumber": 2
            },
            "scopeChain": []
        }]
    })
}

fn start_filtered_session(
    server: &MockCdpServer,
    sink: Arc<CollectingSink>,
    request_timeout: Duration,
    startup_entry: Option<PathBuf>,
    disconnected: Option<mpsc::Sender<()>>,
) -> (DebugSessionRegistry, u64) {
    let registry = DebugSessionRegistry::new();
    let url = server.url.clone();
    let session_id = registry
        .start_session(WORKSPACE_KEY, sink, move |emitter| {
            NodeCdpAdapter::connect_with_source_maps_and_exception_filter(
                &url,
                emitter,
                &[],
                &["TypeError".to_string()],
                NodeCdpConnectOptions {
                    exception_pause_mode: DebugExceptionPauseMode::All,
                    request_timeout,
                    ownership: DebuggeeOwnership::External,
                    source_maps: None,
                    startup: CdpStartupPolicy::SpawnedWaiting {
                        startup_entry: startup_entry.as_deref(),
                    },
                    disconnected,
                    startup_is_current: Arc::new(|| true),
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("start filtered mock session");
    (registry, session_id)
}

fn stopped_count(sink: &CollectingSink) -> usize {
    sink.payloads()
        .into_iter()
        .filter(|payload| matches!(payload, DebugEventPayload::Stopped { .. }))
        .count()
}

fn resumed_count(sink: &CollectingSink) -> usize {
    sink.payloads()
        .into_iter()
        .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
        .count()
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

fn wait_for_disconnect(disconnected: &Receiver<()>) {
    disconnected
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("transport disconnect");
}

#[test]
fn non_matching_exception_suppresses_stopped_and_resumed_events() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event("Debugger.paused", exception_pause(Some("RangeError"), None)),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.resumed", json!({}))],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, None, None);

    wait_for_method_count(&server, "Debugger.resume", 1);
    thread::sleep(Duration::from_millis(100));

    assert_eq!(stopped_count(&sink), 0);
    assert_eq!(resumed_count(&sink), 0);
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn hidden_resume_error_surfaces_the_buffered_exception_pause() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event("Debugger.paused", exception_pause(Some("RangeError"), None)),
        ],
        "Debugger.resume" => vec![error_reply(id, "resume rejected")],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, None, None);

    let (reason, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Exception);
    assert_eq!(frames[0].name, "throwFailure");
    assert_eq!(stopped_count(&sink), 1);
    assert_eq!(resumed_count(&sink), 0);
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn classifier_timeout_issues_one_call_and_ignores_the_late_response() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                exception_pause(None, Some("exception-object")),
            ),
        ],
        "Runtime.callFunctionOn" => {
            thread::sleep(Duration::from_millis(240));
            vec![result(
                id,
                json!({"result": {"type": "string", "value": "RangeError"}}),
            )]
        }
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, None, None);

    wait_for_stopped(&sink, 0);
    thread::sleep(Duration::from_millis(300));

    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| method == "Runtime.callFunctionOn")
            .count(),
        1
    );
    assert_eq!(stopped_count(&sink), 1);
    assert_eq!(resumed_count(&sink), 0);
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn early_non_match_resumes_hidden_and_allows_session_registration() {
    let root = temp_root("exception-filter-early");
    let entry = root.join("entry.js");
    write_file(&entry, "throw new RangeError('early');");
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => {
            vec![result(id, json!({"breakpointId": "startup-entry"}))]
        }
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                exception_pause(None, Some("early-exception")),
            ),
        ],
        "Runtime.callFunctionOn" => vec![result(
            id,
            json!({"result": {"type": "string", "value": "RangeError"}}),
        )],
        "Debugger.resume" => vec![ok(id), event("Debugger.resumed", json!({}))],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());

    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, Some(entry), None);
    wait_for_method_count(&server, "Runtime.callFunctionOn", 1);
    wait_for_method_count(&server, "Debugger.resume", 1);
    wait_for_method_count(&server, "Debugger.removeBreakpoint", 1);
    thread::sleep(Duration::from_millis(100));

    assert_eq!(
        registry.session_id_for_root(WORKSPACE_KEY),
        Some(session_id)
    );
    assert_eq!(stopped_count(&sink), 0);
    assert_eq!(resumed_count(&sink), 0);
    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| method == "Runtime.callFunctionOn")
            .count(),
        1
    );
    assert!(registry.stop_by_id(session_id));
    fs::remove_dir_all(root).expect("remove early exception fixture");
}

#[test]
fn step_pause_bypasses_exception_classification_and_hidden_resume() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![ok(id), event("Debugger.paused", step_pause())],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, None, None);

    let (reason, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Step);
    assert_eq!(frames[0].name, "advance");
    assert!(!server
        .methods()
        .contains(&"Runtime.callFunctionOn".to_string()));
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn hidden_resume_timeout_disconnects_and_removes_the_session() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event("Debugger.paused", exception_pause(Some("RangeError"), None)),
        ],
        "Debugger.resume" => Vec::new(),
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let registry = Arc::new(DebugSessionRegistry::new());
    let lifecycle_registry = Arc::clone(&registry);
    let (session_id_tx, session_id_rx) = mpsc::channel();
    let (finished_tx, finished_rx) = mpsc::channel();
    let terminated = Arc::new(AtomicBool::new(false));
    let disconnect_terminated = Arc::clone(&terminated);
    let finish = shared_debug_session_finish(Box::new(move |exit_code| {
        let session_id = session_id_rx
            .recv_timeout(EVENT_WAIT_TIMEOUT)
            .expect("registered timeout session");
        let removed = lifecycle_registry.finish_session(session_id, exit_code);
        let _ = finished_tx.send(removed);
    }));
    let transport_finish = spawn_debug_transport_finish(disconnected_rx, finish, move || {
        disconnect_terminated.store(true, Ordering::SeqCst);
    });
    let url = server.url.clone();
    let session_id = registry
        .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
            NodeCdpAdapter::connect_with_source_maps_and_exception_filter(
                &url,
                emitter,
                &[],
                &["TypeError".to_string()],
                NodeCdpConnectOptions {
                    exception_pause_mode: DebugExceptionPauseMode::All,
                    request_timeout: FILTER_TIMEOUT,
                    ownership: DebuggeeOwnership::External,
                    source_maps: None,
                    startup: CdpStartupPolicy::SpawnedWaiting {
                        startup_entry: None,
                    },
                    disconnected: Some(disconnected_tx),
                    startup_is_current: Arc::new(|| true),
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("start timeout session");
    session_id_tx
        .send(session_id)
        .expect("publish registered timeout session");

    assert_eq!(
        finished_rx.recv_timeout(EVENT_WAIT_TIMEOUT),
        Ok(true),
        "lifecycle waiter must remove the failed-closed session"
    );
    transport_finish.join().expect("join transport finish");

    assert!(terminated.load(Ordering::SeqCst));
    assert_eq!(registry.session_id_for_root(WORKSPACE_KEY), None);
    assert_eq!(stopped_count(&sink), 0);
    assert_eq!(resumed_count(&sink), 0);
    assert!(sink
        .payloads()
        .into_iter()
        .any(|payload| matches!(payload, DebugEventPayload::Terminated { .. })));
}

#[test]
fn process_exit_winner_prevents_disconnect_termination() {
    let (finished_tx, finished_rx) = mpsc::channel();
    let finish = shared_debug_session_finish(Box::new(move |exit_code| {
        let _ = finished_tx.send(exit_code);
    }));
    let terminations = Arc::new(AtomicUsize::new(0));
    let disconnect_terminations = Arc::clone(&terminations);
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let transport_finish =
        spawn_debug_transport_finish(disconnected_rx, Arc::clone(&finish), move || {
            disconnect_terminations.fetch_add(1, Ordering::SeqCst);
        });

    complete_debug_session_once(&finish, Some(7));
    disconnected_tx.send(()).expect("transport disconnect");
    transport_finish.join().expect("join transport finish");

    assert_eq!(terminations.load(Ordering::SeqCst), 0);
    assert_eq!(finished_rx.recv_timeout(EVENT_WAIT_TIMEOUT), Ok(Some(7)));
    assert_eq!(
        finished_rx.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    );
}

#[test]
fn transport_disconnect_winner_terminates_before_single_completion() {
    let (finished_tx, finished_rx) = mpsc::channel();
    let finish = shared_debug_session_finish(Box::new(move |exit_code| {
        let _ = finished_tx.send(exit_code);
    }));
    let terminations = Arc::new(AtomicUsize::new(0));
    let disconnect_terminations = Arc::clone(&terminations);
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let transport_finish =
        spawn_debug_transport_finish(disconnected_rx, Arc::clone(&finish), move || {
            disconnect_terminations.fetch_add(1, Ordering::SeqCst);
        });

    disconnected_tx.send(()).expect("transport disconnect");
    transport_finish.join().expect("join transport finish");
    complete_debug_session_once(&finish, Some(7));

    assert_eq!(terminations.load(Ordering::SeqCst), 1);
    assert_eq!(finished_rx.recv_timeout(EVENT_WAIT_TIMEOUT), Ok(None));
    assert_eq!(
        finished_rx.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    );
}
