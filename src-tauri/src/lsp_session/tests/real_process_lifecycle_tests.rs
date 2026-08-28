use super::{
    command, initialize_request, noop_diagnostics_sink, ready_script, running_status, temp_path,
    test_restart_controller, wait_for, ChannelSink, FakeSpawner, SharedWriter,
};
use super::{
    ChildKiller, JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRuntimeStatus,
    NoopRefreshSink, NoopWorkspaceEditSink, PhpLanguageServerRegistry, ProcessKiller,
    ServerProcessSpawner, SessionMessageWriter, SpawnedServer,
};
use crate::lsp::LanguageServerCommand;
use std::fs;
use std::io::{self, PipeWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// --- Runtime lifecycle: real OS process termination (no orphans / no hang) ---
//
// These tests exercise the *real* process-kill path (`ChildKiller` ->
// process-group SIGTERM/SIGKILL) instead of the in-memory `FakeKiller`, so
// they prove an OS process actually dies on every lifecycle transition
// (disable IDE mode / close tab / quit app), that disposing one workspace
// never touches another (per-root isolation), and that termination is
// idempotent and never blocks the reader join.

/// Probes process liveness without disturbing it: `kill(pid, 0)` returns 0
/// when the process exists, `EPERM` when it exists but is owned by another
/// user, and `ESRCH` once it is gone (and reaped).
#[cfg(unix)]
fn process_is_alive(pid: i32) -> bool {
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }

    io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
fn wait_until_process_dead(pid: i32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    loop {
        if !process_is_alive(pid) {
            return true;
        }

        if Instant::now() >= deadline {
            return false;
        }

        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(unix)]
fn read_pids_from_file(path: &Path, count: usize, timeout: Duration) -> Vec<i32> {
    let deadline = Instant::now() + timeout;

    loop {
        if let Ok(contents) = fs::read_to_string(path) {
            let pids: Vec<i32> = contents
                .split_whitespace()
                .filter_map(|token| token.parse().ok())
                .collect();

            if pids.len() >= count {
                return pids;
            }
        }

        if Instant::now() >= deadline {
            panic!("expected {count} pids in {path:?}");
        }

        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Spawns a *real* long-lived child (`sleep`) wrapped in the production
/// [`ChildKiller`], while serving a scripted LSP handshake over an in-memory
/// pipe so the supervisor reaches the `Running` state. This lets registry
/// lifecycle tests assert that the OS process is genuinely reaped on stop,
/// not merely removed from the registry map.
#[cfg(unix)]
struct RealProcessSpawner {
    script: Vec<u8>,
    stdin_capture: Arc<Mutex<Vec<u8>>>,
    held_writer: Arc<Mutex<Option<PipeWriter>>>,
    recorded_pid: Arc<Mutex<Option<i32>>>,
}

#[cfg(unix)]
impl RealProcessSpawner {
    fn new() -> Self {
        Self {
            script: ready_script(),
            stdin_capture: Arc::new(Mutex::new(Vec::new())),
            held_writer: Arc::new(Mutex::new(None)),
            recorded_pid: Arc::new(Mutex::new(None)),
        }
    }

    /// A spawner that starts a real process but never completes the LSP
    /// handshake: its script is empty and the pipe write end stays held
    /// open, so the workspace stays in `Starting` until something
    /// external intervenes (a dispose/stop). Chaos tests use this to
    /// deterministically land inside the `Starting` window instead of
    /// racing the near-instant handshake `new()` produces.
    fn pending() -> Self {
        Self {
            script: Vec::new(),
            stdin_capture: Arc::new(Mutex::new(Vec::new())),
            held_writer: Arc::new(Mutex::new(None)),
            recorded_pid: Arc::new(Mutex::new(None)),
        }
    }

    fn pid(&self) -> i32 {
        self.recorded_pid
            .lock()
            .expect("recorded pid")
            .expect("spawned process pid")
    }

    /// Non-panicking PID lookup for chaos tests where a concurrent race
    /// may mean `spawn` was never invoked for this particular instance.
    fn try_pid(&self) -> Option<i32> {
        *self.recorded_pid.lock().expect("recorded pid")
    }
}

#[cfg(unix)]
impl ServerProcessSpawner for RealProcessSpawner {
    fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let (reader, mut writer) = std::io::pipe()?;
        writer.write_all(&self.script)?;
        *self.held_writer.lock().expect("held writer lock") = Some(writer);

        let mut command = Command::new("sleep");
        command
            .arg("600")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn()?;
        let process_group_id = child.id() as i32;
        *self.recorded_pid.lock().expect("recorded pid") = Some(process_group_id);

        Ok(SpawnedServer {
            stderr: None,
            stdin: SessionMessageWriter::from_direct(Box::new(SharedWriter(Arc::clone(
                &self.stdin_capture,
            )))),
            stdout: Box::new(reader),
            killer: Box::new(RealProcessKiller {
                inner: ChildKiller {
                    child,
                    process_group_id,
                },
                held: Arc::clone(&self.held_writer),
            }),
        })
    }
}

#[cfg(unix)]
struct RealProcessKiller {
    inner: ChildKiller,
    held: Arc<Mutex<Option<PipeWriter>>>,
}

#[cfg(unix)]
impl ProcessKiller for RealProcessKiller {
    fn pid(&self) -> Option<u32> {
        self.inner.pid()
    }

    fn terminate(&mut self) -> io::Result<()> {
        let result = self.inner.terminate();
        // In production the dying process closes its own stdout, which gives
        // the session reader the EOF it needs to unblock and join. Our
        // scripted stdout is a separate pipe, so drop its writer to emulate
        // that close and keep `terminate_session`'s reader join from hanging.
        let _ = self.held.lock().expect("held writer lock").take();
        result
    }
}

/// Starts a *real* PHP-workspace language server (see
/// [`RealProcessSpawner`]) for `root` and returns the spawned OS PID.
/// Chaos tests use this to track many short-lived processes across a
/// stress loop without keeping every spawner instance alive - the OS
/// process and its production kill path live inside the registry
/// regardless of whether the spawner wrapper itself is still around.
#[cfg(unix)]
fn start_real_php_workspace(
    registry: &PhpLanguageServerRegistry,
    root: &str,
    command: &LanguageServerCommand,
) -> i32 {
    let spawner = RealProcessSpawner::new();
    let (sink, _rx) = ChannelSink::new();
    registry
        .start(
            root,
            command,
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .unwrap_or_else(|error| panic!("start {root} failed: {error}"));
    spawner.pid()
}

#[cfg(unix)]
fn stop_real_php_workspace_after_cleanup_settles(
    registry: &PhpLanguageServerRegistry,
    root: &str,
    pid: i32,
    proof: &str,
) {
    let status = registry.stop_after_exact_cleanup_settles(root, Duration::from_secs(5));
    assert_eq!(
        status,
        LanguageServerRuntimeStatus::Stopped,
        "{proof}: exact removed-supervisor cleanup did not settle"
    );
    assert!(
        wait_until_process_dead(pid, Duration::from_secs(5)),
        "{proof}: old process must be dead after cleanup settlement"
    );
    assert_eq!(
        registry.status(root),
        LanguageServerRuntimeStatus::Stopped,
        "{proof}: settled cleanup must leave no registered workspace ghost"
    );
}

/// Spawns a real shell process whose OWN stdout carries the LSP
/// handshake script - unlike [`RealProcessSpawner`], which serves the
/// script over a synthetic in-memory pipe entirely decoupled from the
/// real child's lifecycle (by design, for the process-kill/reap tests
/// above). This spawner lets a chaos test kill the real PID directly
/// (`kill -9`, simulating an OS-level crash) and observe the
/// supervisor's reader thread detect the resulting stdout EOF exactly as
/// it would for a real crashed language server.
#[cfg(unix)]
struct RealHandshakeProcessSpawner {
    script_path: PathBuf,
    recorded_pid: Arc<Mutex<Option<i32>>>,
}

#[cfg(unix)]
impl RealHandshakeProcessSpawner {
    fn new(script: &[u8]) -> Self {
        let script_path = temp_path("real-handshake-script");
        fs::write(&script_path, script).expect("write handshake script");
        Self {
            script_path,
            recorded_pid: Arc::new(Mutex::new(None)),
        }
    }

    fn pid(&self) -> i32 {
        self.recorded_pid
            .lock()
            .expect("recorded pid")
            .expect("spawned process pid")
    }
}

#[cfg(unix)]
impl Drop for RealHandshakeProcessSpawner {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.script_path);
    }
}

#[cfg(unix)]
impl ServerProcessSpawner for RealHandshakeProcessSpawner {
    fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(format!(
                "cat '{}'; exec sleep 600",
                self.script_path.display()
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);

        let mut child = command.spawn()?;
        let process_group_id = child.id() as i32;
        *self.recorded_pid.lock().expect("recorded pid") = Some(process_group_id);

        let stdin = child.stdin.take().expect("real handshake process stdin");
        let stdout = child.stdout.take().expect("real handshake process stdout");

        Ok(SpawnedServer {
            stderr: None,
            stdin: SessionMessageWriter::from_child_stdin(stdin)?,
            stdout: Box::new(stdout),
            killer: Box::new(ChildKiller {
                child,
                process_group_id,
            }),
        })
    }
}

/// Chaos-test helper: accumulates every PID spawned during a stress test
/// and asserts, at the end, that every single one has actually exited -
/// no leaked or zombified process survives the scenario. Bounded polling
/// per PID (via [`wait_until_process_dead`]) keeps the check fast and
/// deterministic instead of a fixed sleep.
#[cfg(unix)]
#[derive(Default)]
struct PidLeakGuard {
    pids: Mutex<Vec<i32>>,
}

#[cfg(unix)]
impl PidLeakGuard {
    fn new() -> Self {
        Self::default()
    }

    fn record(&self, pid: i32) {
        self.pids.lock().expect("pid leak guard lock").push(pid);
    }

    /// Panics naming every PID still alive after `timeout`, rather than
    /// stopping at the first leak, so a chaos-test failure reports the
    /// full blast radius in one run.
    fn assert_no_leaks(&self, timeout: Duration) {
        let pids = self.pids.lock().expect("pid leak guard lock").clone();
        let leaked: Vec<i32> = pids
            .into_iter()
            .filter(|&pid| !wait_until_process_dead(pid, timeout))
            .collect();

        assert!(leaked.is_empty(), "leaked processes: {leaked:?}");
    }
}

/// Quitting the app / closing a tab must reap the *whole* server process
/// tree. A language server that forks a child which inherits its stdout
/// would, under a bare `child.kill()`, leave that grandchild alive holding
/// the stdout pipe open - and the session reader's `join()` would block
/// forever (a hung, orphaned process). Killing the process group closes the
/// pipe and unblocks the reader. This guards that the process-group kill
/// stays in place.
#[cfg(unix)]
#[test]
fn child_killer_reaps_process_group_so_inherited_stdout_closes_without_hanging() {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let pid_file = temp_path("pgid-reap");
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg(format!(
            "sleep 600 & printf '%s %s' \"$$\" \"$!\" > '{}'; wait",
            pid_file.display()
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);

    let mut child = command.spawn().expect("spawn process-group child");
    let process_group_id = child.id() as i32;
    let stdout = child.stdout.take().expect("child stdout");
    let mut killer = ChildKiller {
        child,
        process_group_id,
    };

    // Drain the inherited stdout exactly like the session reader does; it can
    // only finish once every process in the group has released the pipe.
    let reader = std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut sink = Vec::new();
        let _ = reader.read_to_end(&mut sink);
    });

    let pids = read_pids_from_file(&pid_file, 2, Duration::from_secs(5));
    let (shell_pid, grandchild_pid) = (pids[0], pids[1]);
    assert!(process_is_alive(shell_pid));
    assert!(process_is_alive(grandchild_pid));

    killer.terminate().expect("terminate process group");

    // Fail fast rather than hang the suite if a grandchild kept stdout open.
    let deadline = Instant::now() + Duration::from_secs(5);
    while !reader.is_finished() {
        assert!(
            Instant::now() < deadline,
            "stdout reader did not unblock after process-group kill"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    reader.join().expect("reader thread");

    assert!(
        wait_until_process_dead(shell_pid, Duration::from_secs(5)),
        "shell child must be reaped"
    );
    assert!(
        wait_until_process_dead(grandchild_pid, Duration::from_secs(5)),
        "inherited grandchild must be reaped (no orphan)"
    );

    // Terminate is idempotent and must not block once the process is gone.
    let started = Instant::now();
    killer.terminate().expect("idempotent terminate");
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "second terminate must return promptly"
    );

    let _ = fs::remove_file(&pid_file);
}

/// Closing one project tab (`dispose_workspace_root` -> `registry.stop`) must
/// kill that workspace's real LSP process while a sibling workspace keeps
/// running, and quitting the app (`stop_all`) must then reap the rest.
#[cfg(unix)]
#[test]
fn registry_stop_kills_real_workspace_process_and_leaves_siblings_running() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner_a = RealProcessSpawner::new();
    let spawner_b = RealProcessSpawner::new();
    let (sink_a, _rx_a) = ChannelSink::new();
    let (sink_b, _rx_b) = ChannelSink::new();
    // Non-managed command path so PHP orphan cleanup (`pkill`) is skipped and
    // the test never signals unrelated processes on the host.
    let command = command();

    registry
        .start(
            "/tmp/lifecycle-a",
            &command,
            &initialize_request(),
            &spawner_a,
            sink_a,
            noop_diagnostics_sink(),
        )
        .expect("start workspace a");
    registry
        .start(
            "/tmp/lifecycle-b",
            &command,
            &initialize_request(),
            &spawner_b,
            sink_b,
            noop_diagnostics_sink(),
        )
        .expect("start workspace b");

    let pid_a = spawner_a.pid();
    let pid_b = spawner_b.pid();
    assert!(process_is_alive(pid_a));
    assert!(process_is_alive(pid_b));

    assert_eq!(
        registry.stop("/tmp/lifecycle-a"),
        LanguageServerRuntimeStatus::Stopped
    );

    assert!(
        wait_until_process_dead(pid_a, Duration::from_secs(5)),
        "disposed workspace process must be dead"
    );
    assert!(
        process_is_alive(pid_b),
        "sibling workspace process must stay alive (per-root isolation)"
    );
    assert!(matches!(
        registry.status("/tmp/lifecycle-b"),
        LanguageServerRuntimeStatus::Running { .. }
    ));

    assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
    assert!(
        wait_until_process_dead(pid_b, Duration::from_secs(5)),
        "remaining workspace process must be dead after stop_all"
    );

    // Quitting again over an already-empty registry is idempotent and fast.
    let started = Instant::now();
    assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
    assert!(started.elapsed() < Duration::from_secs(1));
}

/// Disabling IDE mode (fullSmart -> basic) routes through
/// `stop_php_language_server` -> `PhpLanguageServerRegistry::stop`, which must
/// terminate the phpactor process, report `Stopped`, and clear its launch
/// context. A second stop is idempotent and non-blocking.
#[cfg(unix)]
#[test]
fn disabling_ide_mode_terminates_php_language_server_process() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner = RealProcessSpawner::new();
    let (sink, _rx) = ChannelSink::new();
    let command = command();

    registry
        .start(
            "/tmp/ide-toggle",
            &command,
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start phpactor");

    let pid = spawner.pid();
    assert!(process_is_alive(pid));

    assert_eq!(
        registry.stop("/tmp/ide-toggle"),
        LanguageServerRuntimeStatus::Stopped
    );
    assert!(
        wait_until_process_dead(pid, Duration::from_secs(5)),
        "phpactor process must be dead after disabling IDE mode"
    );
    assert!(registry
        .launch_contexts
        .lock()
        .expect("launch contexts")
        .is_empty());

    let started = Instant::now();
    assert_eq!(
        registry.stop("/tmp/ide-toggle"),
        LanguageServerRuntimeStatus::Stopped
    );
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "stopping an already-stopped workspace must be fast"
    );
}

/// A running supervisor must surface the OS PID of its spawned process so the
/// runtime observability panel can show it and sample RAM/CPU. Once stopped,
/// the PID is gone (no stale session).
#[cfg(unix)]
#[test]
fn supervisor_exposes_running_process_pid_and_clears_it_on_stop() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner = Arc::new(RealProcessSpawner::new());
    let (sink, _rx) = ChannelSink::new();
    let command = command();

    registry
        .start_with_auto_restart(
            "/tmp/observability-pid",
            &command,
            &initialize_request(),
            spawner.clone(),
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("start phpactor");

    let spawned_pid = spawner.pid();
    assert_eq!(
        registry.pid("/tmp/observability-pid"),
        Some(spawned_pid as u32),
        "registry must report the spawned PID for a running runtime"
    );

    assert_eq!(
        registry.stop("/tmp/observability-pid"),
        LanguageServerRuntimeStatus::Stopped
    );
    assert_eq!(
        registry.pid("/tmp/observability-pid"),
        None,
        "stopped runtime must report no PID"
    );
    let _ = wait_until_process_dead(spawned_pid, Duration::from_secs(5));
}

/// Restarting a runtime must reap the old process, spawn a fresh one for the
/// SAME workspace (reusing its stored launch command), and leave a sibling
/// workspace untouched (per-root isolation).
#[cfg(unix)]
#[test]
fn restart_respawns_same_workspace_and_leaves_siblings_running() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner_a = Arc::new(RealProcessSpawner::new());
    let spawner_b = Arc::new(RealProcessSpawner::new());
    let (sink_a, _rx_a) = ChannelSink::new();
    let (sink_b, _rx_b) = ChannelSink::new();
    let command = command();

    registry
        .start_with_auto_restart(
            "/tmp/restart-a",
            &command,
            &initialize_request(),
            spawner_a.clone(),
            sink_a,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("start workspace a");
    registry
        .start_with_auto_restart(
            "/tmp/restart-b",
            &command,
            &initialize_request(),
            spawner_b.clone(),
            sink_b,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("start workspace b");

    let pid_a_before = spawner_a.pid();
    let pid_b = spawner_b.pid();
    assert!(process_is_alive(pid_a_before));
    assert!(process_is_alive(pid_b));

    let restart_spawner = Arc::new(RealProcessSpawner::new());
    let (restart_sink, _restart_rx) = ChannelSink::new();
    let status = registry
        .restart_with_auto_restart(
            "/tmp/restart-a",
            restart_spawner.clone(),
            restart_sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("restart workspace a");

    assert!(matches!(
        status,
        LanguageServerRuntimeStatus::Running { .. }
    ));
    let pid_a_after = restart_spawner.pid();
    assert_ne!(
        pid_a_before, pid_a_after,
        "restart must spawn a fresh process"
    );
    assert!(
        wait_until_process_dead(pid_a_before, Duration::from_secs(5)),
        "old process must be reaped on restart"
    );
    assert!(process_is_alive(pid_a_after), "new process must be running");
    assert_eq!(
        registry.pid("/tmp/restart-a"),
        Some(pid_a_after as u32),
        "registry must report the restarted PID"
    );
    assert!(
        process_is_alive(pid_b),
        "sibling workspace must stay running (per-root isolation)"
    );

    registry.stop_all();
    let _ = wait_until_process_dead(pid_a_after, Duration::from_secs(5));
    let _ = wait_until_process_dead(pid_b, Duration::from_secs(5));
}

/// Restarting a workspace that never started returns an error rather than
/// spawning anything.
#[test]
fn restart_without_prior_start_reports_error() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
    let (sink, _rx) = ChannelSink::new();

    let result = registry.restart_with_auto_restart(
        "/tmp/never-started",
        spawner,
        sink,
        noop_diagnostics_sink(),
        Arc::new(NoopWorkspaceEditSink),
        Arc::new(NoopRefreshSink),
        test_restart_controller(),
    );

    assert!(result.is_err(), "restart with no prior start must error");
}

/// Models the restart-vs-close race resolving "close first": once a tab close
/// has stopped the workspace (clearing its launch context), a restart must NOT
/// resurrect the server - it errors instead, so a closed workspace can never
/// be brought back to life.
#[cfg(unix)]
#[test]
fn restart_after_workspace_close_does_not_resurrect_server() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner = Arc::new(RealProcessSpawner::new());
    let (sink, _rx) = ChannelSink::new();
    let command = command();

    registry
        .start_with_auto_restart(
            "/tmp/restart-after-close",
            &command,
            &initialize_request(),
            spawner.clone(),
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("start workspace");

    let pid = spawner.pid();

    // The tab close wins the race: stop removes the supervisor + launch context.
    registry.stop("/tmp/restart-after-close");
    assert!(wait_until_process_dead(pid, Duration::from_secs(5)));

    let restart_spawner = Arc::new(RealProcessSpawner::new());
    let (restart_sink, _restart_rx) = ChannelSink::new();
    let result = registry.restart_with_auto_restart(
        "/tmp/restart-after-close",
        restart_spawner,
        restart_sink,
        noop_diagnostics_sink(),
        Arc::new(NoopWorkspaceEditSink),
        Arc::new(NoopRefreshSink),
        test_restart_controller(),
    );

    assert!(
        result.is_err(),
        "restart after close must not resurrect a closed workspace"
    );
    assert_eq!(registry.pid("/tmp/restart-after-close"), None);
}

/// Closing a JS/TS workspace tab must reap the real tsserver process too, so
/// no Node process leaks between open project tabs.
#[cfg(unix)]
#[test]
fn stopping_javascript_typescript_workspace_terminates_real_process() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let spawner = RealProcessSpawner::new();
    let (sink, _rx) = ChannelSink::new();

    registry
        .start(
            "/tmp/ts-tab",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start tsserver");

    let pid = spawner.pid();
    assert!(process_is_alive(pid));

    assert_eq!(
        registry.stop("/tmp/ts-tab"),
        LanguageServerRuntimeStatus::Stopped
    );
    assert!(
        wait_until_process_dead(pid, Duration::from_secs(5)),
        "tsserver process must be dead after closing the tab"
    );
}

// --- Runtime lifecycle: chaos / stress tests ---
//
// These guard the "Fleet-like per-project runtime" concept under
// adversarial sequences (rapid switching, external kills, races between
// dispose and start, concurrent restart/stop storms) rather than single
// clean transitions. Every test here is bounded (polling + deadline, no
// sleep-only waits) and asserts real PID liveness via `process_is_alive`
// / `wait_until_process_dead`, so they are deterministic and fast.

/// Rapidly restarting and stopping two workspace roots in a loop must
/// never leak a process, must keep the registry's running-roots view
/// accurate, and must never let an operation on one root touch the
/// other - not just once, but across many consecutive cycles.
#[cfg(unix)]
#[test]
fn multi_project_rapid_restart_stop_loop_leaks_nothing_and_preserves_isolation() {
    const ITERATIONS: usize = 15;
    let registry = PhpLanguageServerRegistry::new();
    let leaks = PidLeakGuard::new();
    let cmd = command();
    let root_a = "/tmp/chaos-multi-a";
    let root_b = "/tmp/chaos-multi-b";

    let mut pid_a = start_real_php_workspace(&registry, root_a, &cmd);
    let mut pid_b = start_real_php_workspace(&registry, root_b, &cmd);
    leaks.record(pid_a);
    leaks.record(pid_b);

    for iteration in 0..ITERATIONS {
        stop_real_php_workspace_after_cleanup_settles(
            &registry,
            root_a,
            pid_a,
            &format!("iteration {iteration}: stop A"),
        );
        assert!(
            process_is_alive(pid_b),
            "iteration {iteration}: stopping A must not touch B"
        );

        pid_a = start_real_php_workspace(&registry, root_a, &cmd);
        leaks.record(pid_a);
        assert!(process_is_alive(pid_a));

        stop_real_php_workspace_after_cleanup_settles(
            &registry,
            root_b,
            pid_b,
            &format!("iteration {iteration}: stop B"),
        );
        assert!(
            process_is_alive(pid_a),
            "iteration {iteration}: stopping B must not touch A"
        );

        pid_b = start_real_php_workspace(&registry, root_b, &cmd);
        leaks.record(pid_b);
        assert!(process_is_alive(pid_b));
    }

    assert_eq!(
        registry.running_roots(),
        vec![root_a.to_string(), root_b.to_string()],
        "registry must track exactly the two live workspaces, no ghosts"
    );

    stop_real_php_workspace_after_cleanup_settles(&registry, root_a, pid_a, "final stop A");
    assert!(process_is_alive(pid_b), "final stopping A must not touch B");
    stop_real_php_workspace_after_cleanup_settles(&registry, root_b, pid_b, "final stop B");
    leaks.assert_no_leaks(Duration::from_secs(5));
}

/// Simulating an OS-level crash (killing the real PID directly, bypassing
/// our own `ChildKiller` entirely - as an OOM killer or an external
/// `kill -9` would) must still be caught by the supervisor's reader
/// thread: the resulting stdout EOF triggers the same crash-detection
/// path as any other unexpected exit, a sibling workspace must stay
/// completely unaffected, and disposing the crashed workspace afterward
/// must leave no zombie behind.
#[cfg(unix)]
#[test]
fn external_sigkill_is_detected_as_crash_and_leaves_no_zombie_or_cross_root_damage() {
    let registry = PhpLanguageServerRegistry::new();
    let leaks = PidLeakGuard::new();
    let cmd = command();
    let victim_root = "/tmp/chaos-kill-victim";
    let sibling_root = "/tmp/chaos-kill-sibling";

    let victim = RealHandshakeProcessSpawner::new(&ready_script());
    let (victim_sink, victim_rx) = ChannelSink::new();
    registry
        .start(
            victim_root,
            &cmd,
            &initialize_request(),
            &victim,
            victim_sink,
            noop_diagnostics_sink(),
        )
        .expect("start victim workspace");
    let victim_pid = victim.pid();
    leaks.record(victim_pid);
    wait_for(&victim_rx, &running_status());

    let sibling_pid = start_real_php_workspace(&registry, sibling_root, &cmd);
    leaks.record(sibling_pid);

    // Simulate an external crash: kill the real process directly. No
    // restart controller is wired here, so this must resolve to Crashed,
    // never a resurrection.
    assert_eq!(
        unsafe { libc::kill(victim_pid, libc::SIGKILL) },
        0,
        "must be able to signal the victim process"
    );

    wait_for(
        &victim_rx,
        &LanguageServerRuntimeStatus::Crashed {
            message: "PHPactor exited unexpectedly.".to_string(),
        },
    );

    assert!(
        process_is_alive(sibling_pid),
        "sibling workspace must survive the victim's external kill (per-root isolation)"
    );
    assert!(matches!(
        registry.status(sibling_root),
        LanguageServerRuntimeStatus::Running { .. }
    ));

    // Closing the crashed workspace must fully reap it (no zombie left
    // behind from the external kill).
    assert_eq!(
        registry.stop(victim_root),
        LanguageServerRuntimeStatus::Stopped
    );

    registry.stop_all();
    leaks.assert_no_leaks(Duration::from_secs(5));
}

/// Disposing a workspace (tab close / quit) while its language server is
/// still mid-handshake (`Starting`) must stop it cleanly: the blocked
/// start call returns `Stopped` promptly - never hanging until the 10s
/// handshake timeout - the process is actually killed, and the workspace
/// must never resurrect afterward.
#[cfg(unix)]
#[test]
fn dispose_during_starting_stops_cleanly_without_resurrection_or_hang() {
    let registry = PhpLanguageServerRegistry::new();
    let spawner = RealProcessSpawner::pending();
    let leaks = PidLeakGuard::new();
    let (sink, _rx) = ChannelSink::new();
    let cmd = command();
    let root = "/tmp/chaos-dispose-during-start";

    let (started_tx, started_rx) = mpsc::channel::<Result<LanguageServerRuntimeStatus, String>>();

    std::thread::scope(|scope| {
        scope.spawn(|| {
            let result = registry.start(
                root,
                &cmd,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            );
            let _ = started_tx.send(result);
        });

        // Deterministically wait for the Starting window - `pending()`
        // never completes its handshake on its own, so this cannot race
        // past it into Running.
        let deadline = Instant::now() + Duration::from_secs(5);
        while !matches!(
            registry.status(root),
            LanguageServerRuntimeStatus::Starting { .. }
        ) {
            assert!(
                Instant::now() < deadline,
                "workspace never reached Starting"
            );
            std::thread::sleep(Duration::from_millis(5));
        }

        // `start_core` flips the workspace into `Starting` before it
        // calls `spawn()`, so the poll above can observe `Starting`
        // slightly before `recorded_pid` is set. Poll the non-panicking
        // accessor instead of the panicking `pid()` to avoid a spurious
        // failure under CI scheduling pressure.
        let pid_deadline = Instant::now() + Duration::from_secs(1);
        let pid = loop {
            if let Some(pid) = spawner.try_pid() {
                break pid;
            }
            assert!(
                Instant::now() < pid_deadline,
                "pid never recorded after Starting"
            );
            std::thread::sleep(Duration::from_millis(1));
        };
        leaks.record(pid);
        assert!(process_is_alive(pid));

        let dispose_started = Instant::now();
        assert_eq!(registry.stop(root), LanguageServerRuntimeStatus::Stopped);

        let result = started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("start call must return promptly, not hang for the handshake timeout");
        assert!(
            dispose_started.elapsed() < Duration::from_secs(2),
            "dispose during Starting must not block on the 10s handshake timeout"
        );
        assert_eq!(result, Ok(LanguageServerRuntimeStatus::Stopped));
    });

    assert_eq!(
        registry.status(root),
        LanguageServerRuntimeStatus::Stopped,
        "no resurrection after dispose-during-start"
    );
    leaks.assert_no_leaks(Duration::from_secs(5));
}

/// Hammering a single workspace with concurrent restart + stop calls (a
/// "storm") must stay idempotent, must never deadlock, and must never
/// leak a spawned process regardless of how the two operations
/// interleave. A sibling root running throughout must stay untouched.
/// The whole scenario is wrapped in a watchdog timeout so a regression
/// that deadlocks fails fast instead of hanging the suite.
#[cfg(unix)]
#[test]
fn restart_stop_storm_is_idempotent_with_no_leak_and_no_deadlock() {
    const ITERATIONS: usize = 15;
    let registry = Arc::new(PhpLanguageServerRegistry::new());
    let leaks = Arc::new(PidLeakGuard::new());
    let cmd = command();
    let root = "/tmp/chaos-restart-storm";
    let sibling_root = "/tmp/chaos-restart-storm-sibling";

    let initial_spawner = Arc::new(RealProcessSpawner::new());
    let (sink, _rx) = ChannelSink::new();
    registry
        .start_with_auto_restart(
            root,
            &cmd,
            &initialize_request(),
            Arc::clone(&initial_spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        )
        .expect("initial start");
    leaks.record(initial_spawner.pid());

    let sibling_pid = start_real_php_workspace(&registry, sibling_root, &cmd);
    leaks.record(sibling_pid);

    let restart_done = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = mpsc::channel::<()>();

    let restart_registry = Arc::clone(&registry);
    let restart_leaks = Arc::clone(&leaks);
    let restart_flag = Arc::clone(&restart_done);
    let restart_done_tx = done_tx.clone();
    // Deliberately plain `thread::spawn`, not `thread::scope`: a scope
    // joins its threads before returning, including on panic, so if a
    // real regression ever deadlocked one of these workers the scope
    // itself would hang forever, defeating the bounded watchdog below.
    // With plain threads, a deadlock still fails fast via the
    // `recv_timeout` watchdog, at the cost of leaving the worker
    // thread(s) - and their spawned `sleep 600` child process - running
    // in the background after the test reports failure. That leak is
    // self-limiting (the child process exits on its own well inside a
    // CI run) and considered an acceptable trade-off for a fail-fast
    // assertion over a suite-hanging one.
    let restart_handle = std::thread::spawn(move || {
        for _ in 0..ITERATIONS {
            let spawner = Arc::new(RealProcessSpawner::new());
            let (restart_sink, _restart_rx) = ChannelSink::new();
            let _ = restart_registry.restart_with_auto_restart(
                root,
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            );

            if let Some(pid) = spawner.try_pid() {
                restart_leaks.record(pid);
            }
        }

        restart_flag.store(true, Ordering::SeqCst);
        let _ = restart_done_tx.send(());
    });

    let stop_registry = Arc::clone(&registry);
    let stop_flag = Arc::clone(&restart_done);
    let stop_done_tx = done_tx;
    let stop_handle = std::thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            stop_registry.stop(root);
        }
        // One last stop strictly after the restart loop is done, so the
        // storm always settles into a fully stopped, reap-everything
        // state regardless of who "won" the last interleaving.
        stop_registry.stop(root);
        let _ = stop_done_tx.send(());
    });

    // Bounded watchdog: both "done" signals must arrive well inside a
    // generous window; anything else means a deadlock.
    for _ in 0..2 {
        done_rx.recv_timeout(Duration::from_secs(30)).expect(
            "restart/stop storm must finish inside the watchdog timeout (possible deadlock)",
        );
    }
    restart_handle
        .join()
        .expect("restart thread must not panic");
    stop_handle.join().expect("stop thread must not panic");

    assert!(
        process_is_alive(sibling_pid),
        "storm on one root must never touch a sibling workspace"
    );
    assert!(matches!(
        registry.status(sibling_root),
        LanguageServerRuntimeStatus::Running { .. }
    ));

    registry.stop_all();
    leaks.assert_no_leaks(Duration::from_secs(5));
}

/// Toggling IDE mode (basic <-> fullSmart) repeatedly starts and stops
/// the PHP language server for the same workspace. After a stress run of
/// rapid on/off cycles, zero processes may remain alive and the registry
/// must be left in a clean, empty state.
#[cfg(unix)]
#[test]
fn ide_mode_toggle_stress_leaves_zero_leaked_processes() {
    const CYCLES: usize = 15;
    let registry = PhpLanguageServerRegistry::new();
    let leaks = PidLeakGuard::new();
    let cmd = command();
    let root = "/tmp/chaos-ide-toggle-stress";

    for cycle in 0..CYCLES {
        let pid = start_real_php_workspace(&registry, root, &cmd);
        leaks.record(pid);
        assert!(
            process_is_alive(pid),
            "cycle {cycle}: enabling IDE mode must spawn a live phpactor"
        );
        assert!(matches!(
            registry.status(root),
            LanguageServerRuntimeStatus::Running { .. }
        ));

        assert_eq!(registry.stop(root), LanguageServerRuntimeStatus::Stopped);
        assert!(
            wait_until_process_dead(pid, Duration::from_secs(5)),
            "cycle {cycle}: disabling IDE mode must kill phpactor"
        );
    }

    assert_eq!(registry.status(root), LanguageServerRuntimeStatus::Stopped);
    assert!(registry
        .launch_contexts
        .lock()
        .expect("launch contexts")
        .is_empty());
    leaks.assert_no_leaks(Duration::from_secs(5));
}
