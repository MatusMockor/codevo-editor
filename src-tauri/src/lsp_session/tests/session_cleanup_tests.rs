use super::*;

#[test]
fn terminate_process_recovers_a_poisoned_killer_mutex() {
    let terminate_count = Arc::new(AtomicUsize::new(0));
    let killer: SharedProcessKiller = Arc::new(ProcessKillerSlot::new(Box::new(FakeKiller {
        held: Arc::new(Mutex::new(None)),
        terminate_script: Vec::new(),
        terminate_count: Arc::clone(&terminate_count),
    })));
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = killer.state.lock().expect("killer");
        panic!("poison process killer mutex");
    }));
    assert!(poisoned.is_err());
    terminate_process(&killer).expect("terminate poisoned process killer");
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
}

#[test]
fn poisoned_supervisor_drop_terminates_session_and_rejects_waiters() {
    let spawner = FakeSpawner::new(ready_script(), true);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let held_writer = Arc::clone(&spawner.held_writer);
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start");
    let pending_requests = {
        let session = supervisor.session.lock().expect("session");
        Arc::clone(&session.as_ref().expect("running session").pending_requests)
    };
    let (request_tx, request_rx) = mpsc::channel();
    pending_requests
        .admit(91, None, request_tx)
        .expect("admit pending request");
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = supervisor.session.lock().expect("session");
        panic!("poison supervisor session mutex");
    }));
    assert!(poisoned.is_err());
    drop(supervisor);
    let rejection = request_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("drop should settle pending request")
        .expect_err("drop should reject pending request");
    assert!(rejection.to_string().contains("stopped"));
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
    assert!(held_writer.lock().expect("held writer").is_none());
}

#[test]
fn poisoned_supervisor_status_remains_truthful_across_stop() {
    let supervisor = LanguageServerSupervisor::new();
    let crashed = LanguageServerRuntimeStatus::Crashed {
        message: "transport failed".to_string(),
    };
    supervisor.force_status(crashed.clone());
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = supervisor.status.lock().expect("status");
        panic!("poison supervisor status mutex");
    }));
    assert!(poisoned.is_err());
    assert_eq!(supervisor.status(), crashed);
    assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
}

#[test]
fn poisoned_supervisor_session_can_stop_and_restart_without_leaking_processes() {
    let first_spawner = FakeSpawner::new(ready_script(), true);
    let first_terminate_count = Arc::clone(&first_spawner.terminate_count);
    let second_spawner = FakeSpawner::new(ready_script(), true);
    let second_terminate_count = Arc::clone(&second_spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &first_spawner,
            Arc::clone(&sink) as Arc<dyn StatusSink>,
            noop_diagnostics_sink(),
        )
        .expect("start first session");
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = supervisor.session.lock().expect("session");
        panic!("poison supervisor session mutex");
    }));
    assert!(poisoned.is_err());
    assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    assert_eq!(first_terminate_count.load(Ordering::SeqCst), 1);
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &second_spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("restart after poison");
    supervisor.stop();
    assert_eq!(second_terminate_count.load(Ordering::SeqCst), 1);
}

struct FailOnceKiller {
    failed: bool,
    inner: Box<dyn ProcessKiller>,
}

impl ProcessKiller for FailOnceKiller {
    fn terminate(&mut self) -> io::Result<()> {
        if !self.failed {
            self.failed = true;
            return Err(io::Error::other("injected terminate failure"));
        }
        self.inner.terminate()
    }
}

struct FailOnceSpawner {
    delegate: FakeSpawner,
}

impl ServerProcessSpawner for FailOnceSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        let spawned = self.delegate.spawn(command)?;
        Ok(SpawnedServer {
            killer: Box::new(FailOnceKiller {
                failed: false,
                inner: spawned.killer,
            }),
            ..spawned
        })
    }
}

#[test]
fn failing_process_termination_reports_crashed_and_retry_reaps_session() {
    let delegate = FakeSpawner::new(ready_script(), true);
    let terminate_count = Arc::clone(&delegate.terminate_count);
    let held_writer = Arc::clone(&delegate.held_writer);
    let spawner = FailOnceSpawner { delegate };
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start");
    assert!(matches!(
        supervisor.stop(),
        LanguageServerRuntimeStatus::Crashed { .. }
    ));
    assert!(held_writer.lock().expect("held writer").is_some());
    assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
}

struct BlockingKiller {
    entered: Arc<Barrier>,
    inner: Box<dyn ProcessKiller>,
    release: Arc<Barrier>,
}

impl ProcessKiller for BlockingKiller {
    fn terminate(&mut self) -> io::Result<()> {
        self.entered.wait();
        self.release.wait();
        self.inner.terminate()
    }
}

struct BlockingSpawner {
    delegate: FakeSpawner,
    entered: Arc<Barrier>,
    release: Arc<Barrier>,
}

impl ServerProcessSpawner for BlockingSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        let spawned = self.delegate.spawn(command)?;
        Ok(SpawnedServer {
            killer: Box::new(BlockingKiller {
                entered: Arc::clone(&self.entered),
                inner: spawned.killer,
                release: Arc::clone(&self.release),
            }),
            ..spawned
        })
    }
}

#[test]
fn blocking_process_termination_is_retained_and_later_settles() {
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let delegate = FakeSpawner::new(ready_script(), true);
    let terminate_count = Arc::clone(&delegate.terminate_count);
    let held_writer = Arc::clone(&delegate.held_writer);
    let spawner = BlockingSpawner {
        delegate,
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    };
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start");
    let started_at = Instant::now();
    assert!(matches!(
        supervisor.stop(),
        LanguageServerRuntimeStatus::Crashed { .. }
    ));
    assert!(started_at.elapsed() < Duration::from_secs(1));
    assert!(held_writer.lock().expect("held writer").is_some());
    entered.wait();
    release.wait();
    assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
}

#[test]
fn start_harvests_a_cleanup_task_that_finished_after_pending_stop() {
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let first_delegate = FakeSpawner::new(ready_script(), true);
    let first_terminate_count = Arc::clone(&first_delegate.terminate_count);
    let first_spawner = BlockingSpawner {
        delegate: first_delegate,
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    };
    let second_spawner = FakeSpawner::new(ready_script(), true);
    let second_terminate_count = Arc::clone(&second_spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &first_spawner,
            Arc::clone(&sink) as Arc<dyn StatusSink>,
            noop_diagnostics_sink(),
        )
        .expect("start");
    assert!(matches!(
        supervisor.stop(),
        LanguageServerRuntimeStatus::Crashed { .. }
    ));
    entered.wait();
    release.wait();

    let deadline = Instant::now() + Duration::from_secs(1);
    while !supervisor
        .cleanup_task
        .lock()
        .expect("cleanup task")
        .as_ref()
        .is_some_and(|task| task.handle.is_finished())
        && Instant::now() < deadline
    {
        std::thread::yield_now();
    }

    supervisor
        .start(
            &command(),
            &initialize_request(),
            &second_spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("finished cleanup must not block replacement start");
    assert_eq!(first_terminate_count.load(Ordering::SeqCst), 1);
    assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
    assert_eq!(second_terminate_count.load(Ordering::SeqCst), 1);
}

#[test]
fn drop_hands_blocking_termination_to_a_durable_reaper() {
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let delegate = FakeSpawner::new(ready_script(), true);
    let terminate_count = Arc::clone(&delegate.terminate_count);
    let held_writer = Arc::clone(&delegate.held_writer);
    let spawner = BlockingSpawner {
        delegate,
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    };
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start");

    let started_at = Instant::now();
    drop(supervisor);
    assert!(started_at.elapsed() < Duration::from_secs(1));
    assert!(held_writer.lock().expect("held writer").is_some());

    entered.wait();
    release.wait();
    let deadline = Instant::now() + Duration::from_secs(1);
    while terminate_count.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        std::thread::yield_now();
    }
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
    assert!(held_writer.lock().expect("held writer").is_none());
}

#[test]
fn four_blocked_cleanup_items_do_not_prevent_a_fifth_from_reaping() {
    let mut gates = Vec::new();
    for _ in 0..4 {
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let spawner = BlockingSpawner {
            delegate: FakeSpawner::new(ready_script(), true),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        };
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();
        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start blocked cleanup owner");
        drop(supervisor);
        gates.push((entered, release));
    }

    let fifth = FakeSpawner::new(ready_script(), true);
    let fifth_terminate_count = Arc::clone(&fifth.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    let supervisor = LanguageServerSupervisor::new();
    supervisor
        .start(
            &command(),
            &initialize_request(),
            &fifth,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start fifth owner");
    drop(supervisor);
    assert_eq!(fifth_terminate_count.load(Ordering::SeqCst), 1);

    for (entered, release) in gates {
        entered.wait();
        release.wait();
    }
    assert!(super::super::session_cleanup::wait_for_shared_reaper_idle(
        Duration::from_secs(2)
    ));
}

#[test]
fn reserved_fresh_start_does_not_spawn_after_concurrent_stop() {
    struct UnexpectedSpawner;
    impl ServerProcessSpawner for UnexpectedSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            panic!("superseded reservation must fail before spawning");
        }
    }
    let supervisor = LanguageServerSupervisor::new();
    let (sink, _rx) = ChannelSink::new();
    supervisor.force_status(LanguageServerRuntimeStatus::Stopped);
    let error = supervisor
        .start_core(
            &command(),
            &initialize_request(),
            &UnexpectedSpawner,
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            None,
            StartKind::ReservedFresh,
        )
        .expect_err("concurrent stop must supersede reserved start");
    assert!(error.contains("reservation is no longer current"));
}

#[test]
fn stop_linearizes_with_in_flight_spawn_and_reaps_the_installed_session() {
    struct GatedSpawner {
        delegate: FakeSpawner,
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }
    impl ServerProcessSpawner for GatedSpawner {
        fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            self.entered.wait();
            self.release.wait();
            self.delegate.spawn(command)
        }
    }
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let delegate = FakeSpawner::new(ready_script(), true);
    let terminate_count = Arc::clone(&delegate.terminate_count);
    let held_writer = Arc::clone(&delegate.held_writer);
    let spawner = Arc::new(GatedSpawner {
        delegate,
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    });
    let supervisor = Arc::new(LanguageServerSupervisor::new());
    supervisor.force_status(LanguageServerRuntimeStatus::Starting { session_id: 0 });
    let (sink, _rx) = ChannelSink::new();
    let start_supervisor = Arc::clone(&supervisor);
    let start_spawner = Arc::clone(&spawner);
    let start = std::thread::spawn(move || {
        start_supervisor.start_core(
            &command(),
            &initialize_request(),
            start_spawner.as_ref(),
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            None,
            StartKind::ReservedFresh,
        )
    });
    entered.wait();
    let (stop_tx, stop_rx) = mpsc::channel();
    let stop_supervisor = Arc::clone(&supervisor);
    let stop = std::thread::spawn(move || {
        stop_tx.send(stop_supervisor.stop()).expect("report stop");
    });
    assert!(supervisor
        .lifecycle_gate
        .wait_for_pending_stop(Duration::from_secs(2)));
    assert!(stop_rx.try_recv().is_err());
    release.wait();
    assert_eq!(
        stop_rx.recv_timeout(Duration::from_secs(2)).expect("stop"),
        LanguageServerRuntimeStatus::Stopped
    );
    stop.join().expect("stop thread");
    assert_eq!(
        start.join().expect("start thread").expect("start status"),
        LanguageServerRuntimeStatus::Stopped
    );
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
    assert!(held_writer.lock().expect("held writer").is_none());
}
