use super::super::{
    start_admission::TERMINAL_START_SUPERSEDED_ERROR, TerminalLaunchRoots, TerminalStartTicket,
};
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Default)]
struct StubbornChild {
    kills: Arc<AtomicUsize>,
    released: Arc<(Mutex<bool>, Condvar)>,
}

impl StubbornChild {
    fn release(&self) {
        let (lock, released) = &*self.released;
        *lock.lock().expect("released") = true;
        released.notify_all();
    }
}

struct StubbornKiller(Arc<AtomicUsize>);

impl TerminalKiller for StubbornKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl TerminalChild for StubbornChild {
    fn clone_killer(&self) -> Box<dyn TerminalKiller> {
        Box::new(StubbornKiller(Arc::clone(&self.kills)))
    }

    fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
        let released = *self.released.0.lock().expect("released");
        Ok(released.then_some(TerminalExitStatus { exit_code: None }))
    }

    fn wait(&mut self) -> io::Result<TerminalExitStatus> {
        let (lock, released) = &*self.released;
        let guard = lock.lock().expect("released");
        let _released = released
            .wait_while(guard, |released| !*released)
            .expect("released");
        Ok(TerminalExitStatus { exit_code: None })
    }
}

struct StubbornChildRelease(StubbornChild);

impl Drop for StubbornChildRelease {
    fn drop(&mut self) {
        self.0.release();
    }
}

fn start_stubborn_session(
    supervisor: &TerminalSupervisor,
    sink: Arc<RecordingTerminalSink>,
) -> StubbornChildRelease {
    let child = StubbornChild::default();
    let spawner = FakeTerminalSpawner::with_child(
        Box::new(BlockingReader),
        Box::new(SharedWriter::default()),
        Box::new(child.clone()),
    );
    supervisor
        .start(
            PathBuf::from("/workspace"),
            TerminalSize::default(),
            default_test_profile(),
            None,
            &spawner,
            sink,
        )
        .expect("start terminal");
    StubbornChildRelease(child)
}

fn detached_reaper(
    supervisor: &TerminalSupervisor,
    session_id: u64,
) -> (
    super::super::reaper::TerminalSessionReaper,
    super::super::reaper::TerminalStopCompletion,
) {
    match supervisor.detach_reaper(session_id) {
        super::super::reaper::Detached::Reaper(reaper, completion) => (*reaper, completion),
        super::super::reaper::Detached::InFlight(_) => panic!("session was not running"),
    }
}

fn finishes_within<T: Send>(
    timeout: Duration,
    run: impl FnOnce() -> T + Send,
    release: impl FnOnce(),
) -> (bool, T) {
    thread::scope(|scope| {
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = scope.spawn(move || {
            let result = run();
            let _ = done_tx.send(());
            result
        });
        let early = done_rx.recv_timeout(timeout).is_ok();
        release();
        (early, worker.join().expect("worker"))
    })
}

fn eventually(mut predicate: impl FnMut() -> bool) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if predicate() {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    predicate()
}

fn stopped(sink: &RecordingTerminalSink) -> bool {
    sink.statuses()
        .contains(&TerminalRuntimeStatus::Stopped { session_id: 1 })
}

#[test]
fn begin_stop_returns_before_a_stubborn_terminal_is_reaped() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = start_stubborn_session(&supervisor, Arc::clone(&sink));

    let started = Instant::now();
    let completion = supervisor.begin_stop(1);
    let elapsed = started.elapsed();

    assert!(elapsed < Duration::from_millis(50), "stop took {elapsed:?}");
    assert!(supervisor.acknowledge_start(1).is_err());
    assert!(!stopped(&sink));
    assert!(completion.wait());
    assert!(stopped(&sink));
    assert_eq!(child.0.kills.load(Ordering::SeqCst), 1);
    assert!(!supervisor.reapers.is_tracking(1));
}

#[test]
fn a_reaper_dropped_by_a_panic_still_terminates_and_reports_the_session() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let (reaper, completion) = detached_reaper(&supervisor, 1);

    assert!(supervisor.acknowledge_start(1).is_err());
    let panicked = thread::spawn(move || {
        let _reaper = reaper;
        panic!("injected panic while owning the terminal reaper");
    })
    .join();

    assert!(panicked.is_err());
    assert!(completion.wait());
    assert!(stopped(&sink));
    assert_eq!(child.0.kills.load(Ordering::SeqCst), 1);
    assert!(!supervisor.reapers.is_tracking(1));
}

#[test]
fn stop_all_waits_for_an_in_flight_reaper_within_its_bound() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let _completion = supervisor.begin_stop(1);

    let started = Instant::now();
    supervisor.stop_all();

    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(stopped(&sink));
    assert_eq!(child.0.kills.load(Ordering::SeqCst), 1);
    assert!(!supervisor.reapers.is_tracking(1));
}

#[test]
fn stop_root_reaps_matching_sessions_in_parallel() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let first = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let second = start_stubborn_session(&supervisor, Arc::clone(&sink));

    let started = Instant::now();
    supervisor
        .stop_root(Path::new("/workspace"))
        .expect("stop workspace terminals");
    let elapsed = started.elapsed();

    assert!(elapsed < Duration::from_millis(1_400), "stop took {elapsed:?}");
    assert!(eventually(|| {
        let statuses = sink.statuses();
        [1, 2].iter().all(|session_id| {
            statuses.contains(&TerminalRuntimeStatus::Stopped {
                session_id: *session_id,
            })
        })
    }));
    assert_eq!(first.0.kills.load(Ordering::SeqCst), 1);
    assert_eq!(second.0.kills.load(Ordering::SeqCst), 1);
}

#[cfg(target_os = "linux")]
#[test]
fn stop_hangs_up_an_interactive_bash_and_its_job_control_background_job() {
    if !Path::new("/bin/bash").is_file() {
        return;
    }
    let test_dir = terminal_process_test_dir("bash-hangup");
    std::fs::create_dir_all(&test_dir).expect("create terminal process test directory");
    let pid_file = test_dir.join("pids");
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let profile = TerminalProfile {
        command: Some("/bin/bash".to_string()),
        id: "integration-bash".to_string(),
        label: "Integration Bash".to_string(),
    };

    supervisor
        .start(
            test_dir.clone(),
            TerminalSize::default(),
            profile,
            None,
            &PortablePtySpawner,
            sink.clone(),
        )
        .expect("start real terminal");
    supervisor
        .write_input(
            1,
            &format!(
                "sleep 30 & child=$!; printf '%s %s\\n' \"$$\" \"$child\" > '{}'\r",
                pid_file.display()
            ),
        )
        .expect("start background terminal process");
    assert!(eventually(|| pid_file.is_file()));
    let process_ids = read_process_ids(&pid_file);

    let started = Instant::now();
    supervisor.stop(1).expect("stop real terminal");
    let elapsed = started.elapsed();
    let reaped = eventually(|| {
        process_ids
            .iter()
            .all(|process_id| !process_exists(*process_id))
    });
    let _ = std::fs::remove_dir_all(&test_dir);

    assert!(reaped, "bash or its background job survived the stop");
    assert!(elapsed < Duration::from_millis(450), "stop took {elapsed:?}");
    assert!(stopped(&sink));
}

#[test]
fn stop_all_sees_a_detached_session_before_its_reaper_runs() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let (reaper, _completion) = detached_reaper(&supervisor, 1);

    assert!(supervisor.reapers.is_tracking(1));
    let (early, ()) = finishes_within(
        Duration::from_millis(150),
        || supervisor.stop_all(),
        || drop(reaper),
    );

    assert!(!early, "stop_all returned while a detached session was unreaped");
    assert!(stopped(&sink));
    assert_eq!(child.0.kills.load(Ordering::SeqCst), 1);
    assert!(!supervisor.reapers.is_tracking(1));
}

#[test]
fn a_repeated_stop_awaits_the_in_flight_reaper() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let (reaper, _completion) = detached_reaper(&supervisor, 1);

    let (early, (result, stopped_on_return)) = finishes_within(
        Duration::from_millis(150),
        || {
            let result = supervisor.stop(1);
            (result, stopped(&sink))
        },
        || drop(reaper),
    );

    assert!(!early, "a repeated stop resolved before the reap finished");
    assert_eq!(result, Ok(TerminalRuntimeStatus::Stopped { session_id: 1 }));
    assert!(stopped_on_return);
    assert_eq!(child.0.kills.load(Ordering::SeqCst), 1);
}

#[test]
fn stop_root_awaits_an_in_flight_reaper_of_that_root_only() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let _child = start_stubborn_session(&supervisor, Arc::clone(&sink));
    let (reaper, _completion) = detached_reaper(&supervisor, 1);

    let (other_early, other) = finishes_within(
        Duration::from_secs(2),
        || supervisor.stop_root(Path::new("/other-workspace")),
        || {},
    );
    let (early, (result, stopped_on_return)) = finishes_within(
        Duration::from_millis(150),
        || {
            let result = supervisor.stop_root(Path::new("/workspace"));
            (result, stopped(&sink))
        },
        || drop(reaper),
    );

    assert!(other_early);
    assert_eq!(other, Ok(()));
    assert!(!early, "stop_root resolved before its in-flight reap finished");
    assert_eq!(result, Ok(()));
    assert!(stopped_on_return);
}

#[derive(Default)]
struct CountingSpawner {
    calls: AtomicUsize,
}

impl TerminalPtySpawner for CountingSpawner {
    fn spawn(&self, _request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err("unexpected spawn".to_string())
    }
}

struct BlockingSpawner {
    entered: std::sync::mpsc::SyncSender<()>,
    inner: FakeTerminalSpawner,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl TerminalPtySpawner for BlockingSpawner {
    fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
        let _ = self.entered.send(());
        let _ = self
            .release
            .lock()
            .expect("release")
            .recv_timeout(Duration::from_secs(5));
        self.inner.spawn(request)
    }
}

fn start_with_ticket(
    supervisor: &TerminalSupervisor,
    root: &str,
    ticket: TerminalStartTicket,
    spawner: &dyn TerminalPtySpawner,
    sink: Arc<RecordingTerminalSink>,
) -> Result<TerminalRuntimeStatus, String> {
    supervisor.start_with_options(
        TerminalLaunchRoots::workspace_root(PathBuf::from(root)),
        None,
        super::super::TerminalStartOptions {
            effective_path: EffectiveExecutablePath::new("/usr/bin:/bin").expect("path"),
            fault: None,
            profile: default_test_profile(),
            shell_integration_base_dir: None,
            size: TerminalSize::default(),
            ticket,
        },
        spawner,
        sink,
    )
}

#[test]
fn a_start_ticket_from_before_a_root_stop_never_spawns() {
    let supervisor = TerminalSupervisor::new();
    let ticket = supervisor.start_ticket();
    supervisor
        .stop_root(Path::new("/workspace"))
        .expect("stop root");
    let spawner = CountingSpawner::default();

    let result = start_with_ticket(
        &supervisor,
        "/workspace",
        ticket,
        &spawner,
        Arc::new(RecordingTerminalSink::default()),
    );

    assert_eq!(result, Err(TERMINAL_START_SUPERSEDED_ERROR.to_string()));
    assert_eq!(spawner.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn stop_root_waits_until_a_start_blocked_in_spawn_is_rolled_back_and_reaped() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    let child = RecordingTerminalChild::blocking();
    let killed = child.killed();
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let spawner = BlockingSpawner {
        entered: entered_tx,
        inner: FakeTerminalSpawner::with_child(
            Box::new(BlockingReader),
            Box::new(SharedWriter::default()),
            Box::new(child),
        ),
        release: Mutex::new(release_rx),
    };

    thread::scope(|scope| {
        let start = scope.spawn(|| {
            start_with_ticket(
                &supervisor,
                "/workspace",
                supervisor.start_ticket(),
                &spawner,
                Arc::clone(&sink),
            )
        });
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("start entered spawn");
        let (stopped_tx, stopped_rx) = std::sync::mpsc::channel();
        let supervisor = &supervisor;
        let killed = &killed;
        let stop = scope.spawn(move || {
            let result = supervisor.stop_root(Path::new("/workspace"));
            let killed_on_return = *killed.lock().expect("killed");
            let _ = stopped_tx.send(());
            (result, killed_on_return)
        });

        assert!(
            stopped_rx.recv_timeout(Duration::from_millis(150)).is_err(),
            "stop_root returned while a start was still inside spawn"
        );
        release_tx.send(()).expect("release spawn");
        let (result, killed_on_return) = stop.join().expect("stop thread");

        assert_eq!(result, Ok(()));
        assert_eq!(killed_on_return, 1);
        assert_eq!(
            start.join().expect("start thread"),
            Err(TERMINAL_START_SUPERSEDED_ERROR.to_string())
        );
    });
    assert!(supervisor.acknowledge_start(1).is_err());
    assert!(sink.statuses().is_empty());
}

#[test]
fn shutdown_closes_start_admission_but_a_foreign_root_stop_does_not() {
    let supervisor = TerminalSupervisor::new();
    let ticket = supervisor.start_ticket();
    supervisor
        .stop_root(Path::new("/other-workspace"))
        .expect("stop other root");

    let admitted = start_with_ticket(
        &supervisor,
        "/workspace",
        ticket,
        &FakeTerminalSpawner::new(Box::new(BlockingReader), Box::new(SharedWriter::default())),
        Arc::new(RecordingTerminalSink::default()),
    );
    assert!(admitted.is_ok());

    supervisor.shutdown();
    let spawner = CountingSpawner::default();
    let refused = start_with_ticket(
        &supervisor,
        "/workspace",
        supervisor.start_ticket(),
        &spawner,
        Arc::new(RecordingTerminalSink::default()),
    );

    assert_eq!(refused, Err(TERMINAL_START_SUPERSEDED_ERROR.to_string()));
    assert_eq!(spawner.calls.load(Ordering::SeqCst), 0);
}
