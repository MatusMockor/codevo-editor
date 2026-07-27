use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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
fn rejected_live_policy_command_preserves_the_previous_active_type_filter() {
    let policy_commands = Arc::new(AtomicUsize::new(0));
    let responder_policy_commands = Arc::clone(&policy_commands);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setPauseOnExceptions"
            if responder_policy_commands.fetch_add(1, Ordering::SeqCst) == 1 =>
        {
            vec![error_reply(id, "live policy rejected")]
        }
        "Debugger.setBreakpointsActive" => vec![
            ok(id),
            event("Debugger.paused", exception_pause(Some("RangeError"), None)),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.resumed", json!({}))],
        _ => vec![ok(id)],
    }));
    let sink = Arc::new(CollectingSink::default());
    let (registry, session_id) =
        start_filtered_session(&server, sink.clone(), FILTER_TIMEOUT, None, None);

    let error = registry
        .with_session_by_id(session_id, |adapter| {
            adapter.set_exception_pause_filter(
                DebugExceptionPauseMode::All,
                &["RangeError".to_string()],
            )
        })
        .expect("known session")
        .expect_err("mock rejects replacement policy");

    assert!(error.contains("live policy rejected"));
    registry
        .with_session_by_id(session_id, |adapter| adapter.set_breakpoints_active(true))
        .expect("known session")
        .expect("session remains usable after definite rejection");
    wait_for_method_count(&server, "Debugger.resume", 1);
    thread::sleep(FILTER_TIMEOUT);
    assert_eq!(stopped_count(&sink), 0);
    assert_eq!(resumed_count(&sink), 0);
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn live_policy_command_timeout_fails_closed_on_uncertain_remote_settlement() {
    let policy_commands = Arc::new(AtomicUsize::new(0));
    let responder_policy_commands = Arc::clone(&policy_commands);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| {
        if method == "Debugger.setPauseOnExceptions"
            && responder_policy_commands.fetch_add(1, Ordering::SeqCst) == 1
        {
            thread::sleep(FILTER_TIMEOUT * 3);
        }
        vec![ok(id)]
    }));
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let (registry, session_id) =
        start_filtered_session(&server, sink, FILTER_TIMEOUT, None, Some(disconnected_tx));

    let error = registry
        .with_session_by_id(session_id, |adapter| {
            adapter.set_exception_pause_filter(
                DebugExceptionPauseMode::All,
                &["RangeError".to_string()],
            )
        })
        .expect("known session")
        .expect_err("uncertain timeout must fail closed");

    assert!(error.contains("timed out"));
    wait_for_disconnect(&disconnected_rx);
    assert!(registry.stop_by_id(session_id));
}

#[test]
fn authority_loss_after_live_policy_command_fails_closed_before_policy_commit() {
    let policy_commands = Arc::new(AtomicUsize::new(0));
    let authority = Arc::new(AtomicBool::new(true));
    let responder_policy_commands = Arc::clone(&policy_commands);
    let responder_authority = Arc::clone(&authority);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| {
        if method == "Debugger.setPauseOnExceptions"
            && responder_policy_commands.fetch_add(1, Ordering::SeqCst) == 1
        {
            responder_authority.store(false, Ordering::SeqCst);
        }
        vec![ok(id)]
    }));
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let registry = DebugSessionRegistry::new();
    let url = server.url.clone();
    let session_authority = Arc::clone(&authority);
    let session_id = registry
        .start_session(WORKSPACE_KEY, sink, move |emitter| {
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
                    startup_is_current: Arc::new(move || session_authority.load(Ordering::SeqCst)),
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("start filtered mock session");

    let error = registry
        .with_session_by_id(session_id, |adapter| {
            adapter.set_exception_pause_filter(
                DebugExceptionPauseMode::All,
                &["RangeError".to_string()],
            )
        })
        .expect("known session")
        .expect_err("authority loss must reject replacement policy");

    assert!(error.contains("lifecycle changed"));
    wait_for_disconnect(&disconnected_rx);
    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| method == "Debugger.setPauseOnExceptions")
            .count(),
        2
    );
    assert!(registry.stop_by_id(session_id));
}

fn start_late_resumed_server() -> (MockCdpServer, Receiver<()>, Receiver<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind late resumed server");
    let port = listener
        .local_addr()
        .expect("late resumed server addr")
        .port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&requests);
    let (resume_replied_tx, resume_replied_rx) = mpsc::channel();
    let (resumed_sent_tx, resumed_sent_rx) = mpsc::channel();
    let _handle = thread::spawn(move || {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        let Ok(mut socket) = tungstenite::accept(stream) else {
            return;
        };
        loop {
            let message = match socket.read() {
                Ok(message) => message,
                Err(_) => break,
            };
            let text = match message {
                Message::Text(text) => text,
                Message::Close(_) => break,
                _ => continue,
            };
            let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else {
                continue;
            };
            let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
            let method = request
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let params = request.get("params").cloned().unwrap_or(Value::Null);
            recorded
                .lock()
                .expect("late resumed requests")
                .push((method.clone(), params));
            if socket.send(Message::text(ok(id))).is_err() {
                return;
            }
            if method == "Runtime.runIfWaitingForDebugger"
                && socket
                    .send(Message::text(event(
                        "Debugger.paused",
                        exception_pause(Some("RangeError"), None),
                    )))
                    .is_err()
            {
                return;
            }
            if method != "Debugger.resume" {
                continue;
            }
            resume_replied_tx.send(()).expect("publish resume reply");
            thread::sleep(FILTER_TIMEOUT * 3);
            if socket
                .send(Message::text(event("Debugger.resumed", json!({}))))
                .is_err()
            {
                return;
            }
            resumed_sent_tx.send(()).expect("publish resumed event");
        }
    });
    (
        MockCdpServer {
            _handle,
            requests,
            url: format!("ws://127.0.0.1:{port}/late-resumed-session"),
        },
        resume_replied_rx,
        resumed_sent_rx,
    )
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
fn successful_hidden_resume_survives_a_resumed_event_after_the_request_timeout() {
    let (server, resume_replied_rx, resumed_sent_rx) = start_late_resumed_server();
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let (registry, session_id) = start_filtered_session(
        &server,
        sink.clone(),
        FILTER_TIMEOUT,
        None,
        Some(disconnected_tx),
    );

    wait_for_method_count(&server, "Debugger.resume", 1);
    resume_replied_rx
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("successful hidden resume reply");
    resumed_sent_rx
        .recv_timeout(EVENT_WAIT_TIMEOUT)
        .expect("late resumed event");
    thread::sleep(FILTER_TIMEOUT);

    assert_eq!(disconnected_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
    assert_eq!(
        registry.session_id_for_root(WORKSPACE_KEY),
        Some(session_id)
    );
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
