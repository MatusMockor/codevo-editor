use super::*;

#[test]
fn single_cdp_frame_above_message_hard_cap_disconnects_fail_closed() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| {
        if method != "Oversized.test" {
            return vec![ok(id)];
        }
        let oversized = "x".repeat(MAX_CDP_MESSAGE_BYTES);
        vec![json!({
            "id": id,
            "result": { "payload": oversized },
        })
        .to_string()]
    }));
    let sink = Arc::new(CollectingSink::default());
    let emitter = DebugEventEmitter::pending_for_test(WORKSPACE_KEY, 1, sink);
    let activation = emitter.clone();
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let mut adapter = NodeCdpAdapter::connect_with_startup_function_breakpoints(
        &server.url,
        emitter,
        &[],
        &[],
        &[],
        NodeCdpConnectOptions {
            exception_pause_mode: DebugExceptionPauseMode::None,
            request_timeout: MOCK_REQUEST_TIMEOUT,
            ownership: DebuggeeOwnership::External,
            source_maps: None,
            startup: CdpStartupPolicy::Attached,
            disconnected: Some(disconnected_tx),
            startup_is_current: Arc::new(|| true),
            internal_step_filter: None,
        },
        false,
    )
    .expect("connect bounded CDP client");
    activation.activate_for_test();

    let error = adapter
        .request_for_test("Oversized.test", json!({}))
        .expect_err("a single frame above the 8 MiB message cap must be rejected");
    assert!(
        error.contains("closed"),
        "oversized response must close the uncertain transport: {error}"
    );
    assert_eq!(
        disconnected_rx.recv_timeout(Duration::from_secs(1)),
        Ok(()),
        "oversized response must notify the exact disconnect owner"
    );
    adapter.terminate();
}
