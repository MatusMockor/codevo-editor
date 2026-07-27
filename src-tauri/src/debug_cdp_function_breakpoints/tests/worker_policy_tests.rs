use super::*;

#[test]
fn worker_keeps_the_session_alive_when_a_read_only_reresolution_request_fails() {
    let state = unresolved_worker_state();
    let state_for_assertion = Arc::clone(&state);
    let failed_closed = Arc::new(AtomicBool::new(false));
    let failed_closed_for_worker = Arc::clone(&failed_closed);
    let (entered_tx, entered_rx) = mpsc::sync_channel(4);
    let cdp = WorkerFakeCdp {
        calls: Arc::new(Mutex::new(Vec::new())),
        replies: VecDeque::from([Err(FunctionBreakpointRequestFailure::Uncertain(
            "evaluation timeout".to_string(),
        ))]),
        request_entered: entered_tx,
        continue_request: None,
        blocked_method: None,
    };
    let (trigger, worker) = spawn_worker_with_fail_closed(
        cdp,
        state,
        Arc::new(|_| {}),
        Arc::new(|| true),
        Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
    );

    trigger.send(()).expect("resolution trigger");
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("evaluation entered"),
        "Runtime.evaluate"
    );
    drop(trigger);
    join_worker_with_timeout(worker);

    assert!(!failed_closed.load(Ordering::Acquire));
    let registrations = state_for_assertion
        .registrations
        .lock()
        .expect("registrations lock");
    assert!(registrations.by_logical_id.is_empty());
    assert_eq!(
        registrations
            .unverified_by_logical_id
            .get("fn-1")
            .map(String::as_str),
        Some("render")
    );
}

#[test]
fn worker_fails_closed_when_a_mutating_install_ack_is_uncertain() {
    let state = unresolved_worker_state();
    let failed_closed = Arc::new(AtomicBool::new(false));
    let failed_closed_for_worker = Arc::clone(&failed_closed);
    let (entered_tx, entered_rx) = mpsc::sync_channel(4);
    let cdp = WorkerFakeCdp {
        calls: Arc::new(Mutex::new(Vec::new())),
        replies: VecDeque::from([
            Ok(json!({"result":{"type":"function","objectId":"function:9"}})),
            Err(FunctionBreakpointRequestFailure::Uncertain(
                "install acknowledgement timeout".to_string(),
            )),
        ]),
        request_entered: entered_tx,
        continue_request: None,
        blocked_method: None,
    };
    let (trigger, worker) = spawn_worker_with_fail_closed(
        cdp,
        state,
        Arc::new(|_| {}),
        Arc::new(|| true),
        Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
    );

    trigger.send(()).expect("resolution trigger");
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("evaluation entered"),
        "Runtime.evaluate"
    );
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("install entered"),
        "Debugger.setBreakpointOnFunctionCall"
    );
    drop(trigger);
    join_worker_with_timeout(worker);

    assert!(failed_closed.load(Ordering::Acquire));
}
