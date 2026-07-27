use super::*;

#[test]
fn oversized_transport_frame_reaps_session_and_fails_closed() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
    let held = Arc::clone(&spawner.held_writer);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, rx) = ChannelSink::new();

    registry
        .start_with_auto_restart(
            "/tmp/oversized-frame-workspace",
            &command(),
            &initialize_request(),
            Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            LanguageServerEventSinks::new(
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            test_restart_controller(),
        )
        .expect("start with auto restart");
    wait_for(&rx, &running_status());

    held.lock()
        .expect("held writer lock")
        .as_mut()
        .expect("held writer")
        .write_all(b"Content-Length: 33554433\r\n\r\n")
        .expect("write oversized frame header");

    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Crashed {
            message: "Test server transport failed: LSP message exceeds frame byte limit."
                .to_string(),
        },
    );
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        1,
        "the transport failure must terminate the exact session"
    );
    assert!(
        rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "a deterministic protocol-limit violation must not auto-restart"
    );
}

#[test]
fn oversized_initialize_frame_is_reaped_without_restart_context() {
    let spawner = FakeSpawner::new(b"Content-Length: 33554433\r\n\r\n".to_vec(), true);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new_with_label("Test server");

    let error = supervisor
        .start(
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect_err("oversized initialize frame must fail");

    assert_eq!(
        error,
        "Test server transport failed: LSP message exceeds frame byte limit."
    );
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        1,
        "handshake transport failure must reap the exact process once"
    );
    assert!(matches!(
        supervisor.status(),
        LanguageServerRuntimeStatus::Crashed { message } if message == error
    ));
}

#[test]
fn unexpected_crash_stops_restarting_after_exhausting_attempts() {
    let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
    let held = Arc::clone(&spawner.held_writer);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, rx) = ChannelSink::new();
    let supervisor = Arc::new(LanguageServerSupervisor::new());

    supervisor
        .start_with_auto_restart(
            &command(),
            &initialize_request(),
            Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            LanguageServerEventSinks::new(
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            Arc::new(RestartController::new(RestartPolicy::new(
                1,
                Duration::from_secs(60),
                Duration::from_millis(0),
            ))),
        )
        .expect("start");
    wait_for(&rx, &running_status());

    *held.lock().expect("held writer lock") = None;
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Running {
            session_id: 2,
            capabilities: LanguageServerCapabilities::default(),
        },
    );

    *held.lock().expect("held writer lock") = None;
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Crashed {
            message: "PHPactor exited unexpectedly.".to_string(),
        },
    );
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        2,
        "every EOF must reap its exact session before restart or give-up"
    );
    assert!(
        rx.recv_timeout(Duration::from_millis(150)).is_err(),
        "the exhausted budget must not emit a third Starting/Running session"
    );
    assert!(matches!(
        supervisor.status(),
        LanguageServerRuntimeStatus::Crashed { .. }
    ));
}

#[test]
fn repeated_handshake_then_eof_exhausts_budget_without_session_four() {
    let spawner = Arc::new(
        FakeSpawner::new(ready_script(), true).with_auto_close_after(Duration::from_millis(50)),
    );
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, rx) = ChannelSink::new();
    let supervisor = Arc::new(LanguageServerSupervisor::new());

    supervisor
        .start_with_auto_restart(
            &command(),
            &initialize_request(),
            Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            LanguageServerEventSinks::new(
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            Arc::new(RestartController::new(RestartPolicy::new(
                2,
                Duration::from_secs(60),
                Duration::from_millis(0),
            ))),
        )
        .expect("initial handshake");
    wait_for(&rx, &running_status());
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Running {
            session_id: 2,
            capabilities: LanguageServerCapabilities::default(),
        },
    );
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Running {
            session_id: 3,
            capabilities: LanguageServerCapabilities::default(),
        },
    );
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Crashed {
            message: "PHPactor exited unexpectedly.".to_string(),
        },
    );

    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        3,
        "every EOF session must be reaped exactly once"
    );
    assert!(
        rx.recv_timeout(Duration::from_millis(150)).is_err(),
        "successful handshakes shorter than the healthy window must not reset the budget"
    );
    assert!(matches!(
        supervisor.status(),
        LanguageServerRuntimeStatus::Crashed { .. }
    ));
}
