use super::*;

#[test]
fn diagnostics_follow_exact_session_and_root_across_a_b_a_replacement() {
    let root_a = test_workspace_root("diagnostics-authority-a");
    let root_b = test_workspace_root("diagnostics-authority-b");
    let source_a = root_a.join("src/A.ts");
    let source_b = root_b.join("src/B.ts");
    fs::create_dir_all(source_a.parent().expect("source A parent")).expect("source A parent");
    fs::create_dir_all(source_b.parent().expect("source B parent")).expect("source B parent");
    let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
    let supervisor = LanguageServerSupervisor::new();

    for (session_id, root, source, version) in [
        (1, &root_a, &source_a, 1),
        (2, &root_b, &source_b, 2),
        (3, &root_a, &source_a, 3),
    ] {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        supervisor
            .start(
                &command_for_root(path_string(root).as_str()),
                &initialize_request(),
                &spawner,
                sink.clone(),
                Arc::clone(&diagnostics_sink),
            )
            .expect("start replacement");
        wait_for(
            &status_rx,
            &LanguageServerRuntimeStatus::Running {
                session_id,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": file_uri(source),
                    "version": version,
                    "diagnostics": [{
                        "range": {
                            "start": { "line": 0, "character": 0 },
                            "end": { "line": 0, "character": 1 }
                        },
                        "message": format!("session {session_id}")
                    }]
                }
            }),
        );
        let event = diagnostics_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("replacement diagnostic");
        assert_eq!(event.session_id, session_id);
        assert_eq!(event.uri, file_uri(source));
        assert_eq!(event.version, Some(version));
        assert_eq!(
            event.diagnostics[0].message,
            format!("session {session_id}")
        );
        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    }

    assert!(diagnostics_rx.try_recv().is_err());
    fs::remove_dir_all(root_a).expect("cleanup root A");
    fs::remove_dir_all(root_b).expect("cleanup root B");
}
