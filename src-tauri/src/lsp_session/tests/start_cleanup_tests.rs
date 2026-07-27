use super::*;

struct PanickingSpawner;

impl ServerProcessSpawner for PanickingSpawner {
    fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        panic!("abort reserved spawn");
    }
}

struct SignalingSpawner {
    spawned: Sender<()>,
}

impl ServerProcessSpawner for SignalingSpawner {
    fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        self.spawned.send(()).expect("signal spawned process");
        FakeSpawner::new(ready_script(), true).spawn(_command)
    }
}

fn typescript_cleanup_command(root_path: &str) -> LanguageServerCommand {
    LanguageServerCommand {
        executable:
            "/Applications/Codevo Editor.app/Contents/Resources/node_modules/.bin/typescript-language-server"
                .to_string(),
        args: vec!["--stdio".to_string()],
        working_directory: root_path.to_string(),
        env: Vec::new(),
    }
}

#[test]
#[cfg(unix)]
fn cleanup_snapshot_excludes_concurrent_spawn_until_reserved_start_spawns() {
    let registry = Arc::new(JavaScriptTypeScriptLanguageServerRegistry::new());
    let fixture = std::env::temp_dir().join(format!(
        "codevo-start-cleanup-gate-{}",
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    let root_a_path = fixture.join("a");
    let root_b_path = fixture.join("b");
    fs::create_dir_all(&root_a_path).expect("create root a");
    fs::create_dir_all(&root_b_path).expect("create root b");
    let root_a = root_a_path
        .canonicalize()
        .expect("canonical root a")
        .to_string_lossy()
        .to_string();
    let root_b = root_b_path
        .canonicalize()
        .expect("canonical root b")
        .to_string_lossy()
        .to_string();
    let lease_a = registry
        .reserve_start_cleanup(&root_a)
        .expect("reserve cleanup start a");
    let cleanup_snapshot = lease_a.running_roots().expect("cleanup snapshot a");
    let (spawned_b_tx, spawned_b_rx) = mpsc::channel();
    let registry_b = Arc::clone(&registry);
    let root_b_thread = root_b.clone();
    let start_b = std::thread::spawn(move || {
        let command_b = typescript_cleanup_command(&root_b_thread);
        let lease_b = registry_b
            .reserve_start_cleanup(&root_b_thread)
            .expect("reserve cleanup start b");
        let running_roots_b = lease_b.running_roots().expect("cleanup snapshot b");
        assert!(
            !crate::managed_javascript_typescript::should_cleanup_orphaned_javascript_typescript_processes(
                &command_b,
                &root_b_thread,
                &running_roots_b,
            )
        );
        let (sink, _rx) = ChannelSink::new();
        lease_b
            .start_with_auto_restart(
                &command_b,
                &initialize_request(),
                Arc::new(SignalingSpawner {
                    spawned: spawned_b_tx,
                }),
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start reserved workspace b")
    });

    assert!(
        crate::managed_javascript_typescript::should_cleanup_orphaned_javascript_typescript_processes(
            &typescript_cleanup_command(&root_a),
            &root_a,
            &cleanup_snapshot,
        )
    );
    assert!(matches!(
        spawned_b_rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    let (sink, _rx) = ChannelSink::new();
    let status_a = lease_a
        .start_with_auto_restart(
            &typescript_cleanup_command(&root_a),
            &initialize_request(),
            Arc::new(FakeSpawner::new(ready_script(), true)),
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("start reserved workspace a");
    spawned_b_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("spawn b after cleanup gate release");

    assert!(matches!(
        status_a,
        LanguageServerRuntimeStatus::Running { .. }
    ));
    assert!(matches!(
        start_b.join().expect("join start b"),
        LanguageServerRuntimeStatus::Running { .. }
    ));
    assert_eq!(registry.running_roots(), vec![root_a, root_b]);
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn javascript_typescript_command_reserves_before_cleanup_and_starts_after_cleanup() {
    let source = include_str!("../../lib.rs");
    let command_start = source
        .find("async fn start_javascript_typescript_language_server")
        .expect("JavaScript TypeScript start command");
    let command_source = &source[command_start..];
    let blocking = command_source
        .find("let status = run_blocking_command(move || {")
        .expect("blocking start command");
    let reserve = command_source
        .find("registry.reserve_start_cleanup(&blocking_root_path)?")
        .expect("start cleanup reservation");
    let snapshot = command_source
        .find("start_cleanup_lease.running_roots()?")
        .expect("running roots snapshot");
    let cleanup = command_source
        .find("managed_javascript_typescript::cleanup_orphaned_javascript_typescript_processes(")
        .expect("orphan cleanup");
    let start = command_source
        .find("start_cleanup_lease.start_with_auto_restart(")
        .expect("reserved start");

    assert!(blocking < reserve);
    assert!(reserve < snapshot);
    assert!(snapshot < cleanup);
    assert!(cleanup < start);
}

#[test]
fn stopped_root_cleanup_uses_the_start_cleanup_gate() {
    let registry = Arc::new(JavaScriptTypeScriptLanguageServerRegistry::new());
    let root_path = "/workspace/stop-cleanup-gate";
    let (sink, _rx) = ChannelSink::new();
    registry
        .start(
            root_path,
            &command(),
            &initialize_request(),
            &FakeSpawner::new(ready_script(), true),
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let cleanup_gate = registry.cleanup_gate.lock().expect("hold cleanup gate");
    let registry_for_stop = Arc::clone(&registry);
    let (stopped_tx, stopped_rx) = mpsc::channel();
    let stop = std::thread::spawn(move || {
        let status = registry_for_stop.stop(root_path);
        stopped_tx.send(status).expect("signal stopped workspace");
    });

    assert!(matches!(
        stopped_rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    drop(cleanup_gate);
    assert!(matches!(
        stopped_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("stop after cleanup gate release"),
        LanguageServerRuntimeStatus::Stopped
    ));
    stop.join().expect("join stop");
}

#[test]
fn dropped_start_cleanup_reservation_releases_root() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();

    {
        let _lease = registry
            .reserve_start_cleanup("/tmp/dropped-typescript-start")
            .expect("reserve cleanup start");
        assert_eq!(
            registry.running_roots(),
            vec!["/tmp/dropped-typescript-start".to_string()]
        );
    }

    assert!(registry.running_roots().is_empty());
    assert!(matches!(
        registry.status("/tmp/dropped-typescript-start"),
        LanguageServerRuntimeStatus::Stopped
    ));
}

#[test]
fn failed_reserved_start_releases_root() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let lease = registry
        .reserve_start_cleanup("/tmp/failed-typescript-start")
        .expect("reserve cleanup start");
    let spawner = Arc::new(FailingSpawner);
    let (sink, _rx) = ChannelSink::new();

    let result = lease.start_with_auto_restart(
        &command(),
        &initialize_request(),
        spawner,
        sink,
        noop_diagnostics_sink(),
        Arc::new(NoopWorkspaceEditSink),
        Arc::new(NoopRefreshSink),
        test_restart_controller(),
    );

    assert!(result.is_err());
    assert!(registry.running_roots().is_empty());
    assert!(matches!(
        registry.status("/tmp/failed-typescript-start"),
        LanguageServerRuntimeStatus::Stopped
    ));
}

#[test]
fn unwound_start_cleanup_reservation_releases_root() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let lease = registry
            .reserve_start_cleanup("/tmp/panicked-typescript-start")
            .expect("reserve cleanup start");
        let (sink, _rx) = ChannelSink::new();
        let _ = lease.start_with_auto_restart(
            &command(),
            &initialize_request(),
            Arc::new(PanickingSpawner),
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        );
    }));

    assert!(result.is_err());
    assert!(registry.running_roots().is_empty());
    assert!(matches!(
        registry.status("/tmp/panicked-typescript-start"),
        LanguageServerRuntimeStatus::Stopped
    ));
}
