use super::*;

struct ScriptedProbeSignals {
    sent: Mutex<Vec<(i32, Instant)>>,
    members: Mutex<VecDeque<Option<bool>>>,
    fallback: Option<bool>,
    panic_probe: bool,
    probe_calls: AtomicU64,
}

impl ScriptedProbeSignals {
    fn new(script: Vec<Option<bool>>, fallback: Option<bool>) -> Arc<Self> {
        Arc::new(Self {
            sent: Mutex::new(Vec::new()),
            members: Mutex::new(script.into()),
            fallback,
            panic_probe: false,
            probe_calls: AtomicU64::new(0),
        })
    }

    fn panicking_probe() -> Arc<Self> {
        Arc::new(Self {
            sent: Mutex::new(Vec::new()),
            members: Mutex::new(VecDeque::new()),
            fallback: Some(true),
            panic_probe: true,
            probe_calls: AtomicU64::new(0),
        })
    }

    fn sent(&self) -> Vec<(i32, Instant)> {
        self.sent.lock().expect("sent lock").clone()
    }

    fn kinds(&self) -> Vec<i32> {
        self.sent().into_iter().map(|(signal, _)| signal).collect()
    }
}

impl AgentProcessGroupSignalSender for ScriptedProbeSignals {
    fn send(&self, _process_group_id: i32, signal: i32) -> Result<(), String> {
        self.sent
            .lock()
            .expect("sent lock")
            .push((signal, Instant::now()));
        Ok(())
    }

    fn group_has_members_besides_leader(&self, _process_group_id: i32) -> Option<bool> {
        self.probe_calls.fetch_add(1, Ordering::SeqCst);
        assert!(!self.panic_probe, "membership probe panic injected");
        self.members
            .lock()
            .expect("members lock")
            .pop_front()
            .unwrap_or(self.fallback)
    }
}

struct GraceFixture {
    registry: AgentTaskRegistry,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    spawner: Arc<FakeSpawner>,
}

fn grace_fixture(signals: &Arc<ScriptedProbeSignals>, grace: Duration) -> GraceFixture {
    grace_fixture_with_runtime(signals, grace, Duration::from_secs(60))
}

fn grace_fixture_with_runtime(
    signals: &Arc<ScriptedProbeSignals>,
    grace: Duration,
    max_runtime: Duration,
) -> GraceFixture {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::clone(signals) as Arc<dyn AgentProcessGroupSignalSender>,
        max_runtime,
        Duration::from_millis(100),
        Duration::from_millis(200),
    )
    .with_clean_exit_grace_for_tests(grace);
    GraceFixture {
        registry,
        admission,
        sink,
        spawner,
    }
}

fn start_fake(fixture: &GraceFixture, task_id: &str, process: &Arc<FakeProcess>, pgid: i32) {
    let root = unique_path(task_id);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(process, pgid).build(),
    ));
    let admission = fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let request = AgentTaskStartRequest {
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        ..start_request(task_id, &root)
    };
    fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect("start");
    fixture.registry.acknowledge(task_id).expect("acknowledge");
}

fn run_clean_exit(signals: &Arc<ScriptedProbeSignals>, grace: Duration, task_id: &str) -> Instant {
    let fixture = grace_fixture(signals, grace);
    let started = Instant::now();
    start_fake(&fixture, task_id, &FakeProcess::new(Some(0), None), 9701);
    assert!(wait_until(Duration::from_secs(10), || fixture
        .sink
        .has_terminal_status(task_id)));
    assert!(matches!(
        statuses_for(&fixture.sink, task_id)
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    started
}

fn enter_grace(signals: &Arc<ScriptedProbeSignals>, task_id: &str) -> GraceFixture {
    let fixture = grace_fixture(signals, Duration::from_secs(5));
    start_fake(&fixture, task_id, &FakeProcess::new(Some(0), None), 9703);
    assert!(wait_until(Duration::from_secs(5), || signals.kinds()
        == vec![TERMINATE_PROCESS_GROUP_SIGNAL]));
    assert!(!fixture.sink.has_terminal_status(task_id));
    fixture
}

fn assert_killed_within(signals: &Arc<ScriptedProbeSignals>, since: Instant, bound: Duration) {
    assert!(
        wait_until(bound, || signals
            .kinds()
            .contains(&KILL_PROCESS_GROUP_SIGNAL)),
        "no final SIGKILL within {bound:?}: {:?}",
        signals.kinds()
    );
    let killed_at = signals
        .sent()
        .into_iter()
        .find(|(signal, _)| *signal == KILL_PROCESS_GROUP_SIGNAL)
        .map(|(_, at)| at)
        .expect("kill timestamp");
    assert!(killed_at.duration_since(since) < bound);
}

#[test]
fn clean_exit_terms_surviving_members_then_kills_once_they_leave() {
    let signals = ScriptedProbeSignals::new(vec![Some(true), Some(true), Some(false)], Some(false));
    let started = run_clean_exit(&signals, Duration::from_secs(5), "agt-grace-leave");
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn clean_exit_grace_is_bounded_and_always_ends_with_kill() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    run_clean_exit(&signals, Duration::from_millis(300), "agt-grace-bounded");
    let sent = signals.sent();
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    let gap = sent[1].1.duration_since(sent[0].1);
    assert!(
        gap >= Duration::from_millis(300) && gap < Duration::from_millis(1500),
        "grace gap {gap:?}"
    );
}

#[test]
fn clean_exit_without_other_members_skips_sigterm() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(false));
    run_clean_exit(&signals, Duration::from_secs(5), "agt-grace-alone");
    assert_eq!(signals.kinds(), vec![KILL_PROCESS_GROUP_SIGNAL]);
}

#[test]
fn unknown_membership_waits_the_whole_bounded_grace() {
    let signals = ScriptedProbeSignals::new(Vec::new(), None);
    run_clean_exit(&signals, Duration::from_millis(200), "agt-grace-unknown");
    let sent = signals.sent();
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(sent[1].1.duration_since(sent[0].1) >= Duration::from_millis(200));
}

#[test]
fn panicking_membership_probe_is_treated_as_unknown_and_still_kills() {
    let signals = ScriptedProbeSignals::panicking_probe();
    run_clean_exit(
        &signals,
        Duration::from_millis(200),
        "agt-grace-probe-panic",
    );
    assert_eq!(
        signals.probe_calls.load(Ordering::SeqCst),
        1,
        "a panicking probe must not be retried during the grace"
    );
    let sent = signals.sent();
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(sent[1].1.duration_since(sent[0].1) >= Duration::from_millis(200));
}

#[test]
fn requested_stop_never_waits_for_the_clean_exit_grace() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture = grace_fixture(&signals, Duration::from_secs(5));
    start_fake(
        &fixture,
        "agt-grace-stop",
        &FakeProcess::new(None, None),
        9702,
    );
    let stopped_at = Instant::now();
    fixture.registry.stop("agt-grace-stop").expect("stop");
    assert!(wait_until(Duration::from_secs(10), || fixture
        .sink
        .has_terminal_status("agt-grace-stop")));
    assert!(stopped_at.elapsed() < Duration::from_secs(3));
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(matches!(
        statuses_for(&fixture.sink, "agt-grace-stop")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
}

#[test]
fn stop_during_the_grace_aborts_it_and_kills_at_once() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture = enter_grace(&signals, "agt-grace-stop-during");
    let stopped_at = Instant::now();
    fixture
        .registry
        .stop("agt-grace-stop-during")
        .expect("stop");
    assert_killed_within(&signals, stopped_at, Duration::from_millis(1000));
    assert!(wait_until(Duration::from_secs(2), || fixture
        .sink
        .has_terminal_status("agt-grace-stop-during")));
    assert_eq!(signals.kinds().last(), Some(&KILL_PROCESS_GROUP_SIGNAL));
}

#[test]
fn watchdog_during_the_grace_aborts_it_and_kills_at_once() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture =
        grace_fixture_with_runtime(&signals, Duration::from_secs(5), Duration::from_millis(400));
    let started = Instant::now();
    start_fake(
        &fixture,
        "agt-grace-watchdog",
        &FakeProcess::new(Some(0), None),
        9704,
    );
    assert_killed_within(&signals, started, Duration::from_millis(1500));
    let killed_at = signals
        .sent()
        .into_iter()
        .find(|(signal, _)| *signal == KILL_PROCESS_GROUP_SIGNAL)
        .map(|(_, at)| at)
        .expect("kill timestamp");
    assert!(killed_at.duration_since(started) >= Duration::from_millis(350));
    assert!(wait_until(Duration::from_secs(2), || fixture
        .sink
        .has_terminal_status("agt-grace-watchdog")));
    assert!(matches!(
        statuses_for(&fixture.sink, "agt-grace-watchdog")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Failed { .. })
    ));
}

#[test]
#[should_panic(expected = "clean-exit grace must be tuned before the registry is shared")]
fn tuning_the_grace_after_the_registry_is_shared_is_rejected() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(false));
    let fixture = grace_fixture(&signals, Duration::ZERO);
    start_fake(
        &fixture,
        "agt-grace-shared",
        &FakeProcess::new(None, None),
        9705,
    );
    let _ = fixture
        .registry
        .with_clean_exit_grace_for_tests(Duration::from_secs(1));
}

#[test]
fn app_exit_shutdown_during_the_grace_kills_at_once() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture = enter_grace(&signals, "agt-grace-shutdown");
    let shutdown_at = Instant::now();
    fixture.registry.shutdown_all();
    assert_killed_within(&signals, shutdown_at, Duration::from_millis(1000));
    assert!(wait_until(Duration::from_secs(2), || fixture
        .sink
        .has_terminal_status("agt-grace-shutdown")));
}

#[test]
fn registry_drop_during_the_grace_kills_at_once() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture = enter_grace(&signals, "agt-grace-drop");
    let dropped_at = Instant::now();
    drop(fixture.registry);
    assert_killed_within(&signals, dropped_at, Duration::from_millis(1000));
}

fn real_registry() -> (
    AgentTaskRegistry,
    Arc<AgentTaskAdmissionRegistry>,
    Arc<RecordingSink>,
) {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    (registry, admission, sink)
}

fn start_shell(
    label: &str,
    script: &str,
) -> (PathBuf, Arc<RecordingSink>, AgentTaskRegistry, Instant) {
    let shell = probe_binary(&["/bin/sh"]).expect("POSIX shell");
    let cwd = unique_path(label);
    fs::create_dir_all(&cwd).expect("cwd");
    let (registry, admission_registry, sink) = real_registry();
    let admission = admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let plan = AgentTaskSpawnPlan::for_tests(
        shell,
        vec!["-c".to_string(), script.to_string()],
        cwd.clone(),
        Vec::new(),
    );
    let started = Instant::now();
    registry
        .start(start_request(label, &cwd), plan, admission)
        .expect("start");
    registry.acknowledge(label).expect("acknowledge");
    (cwd, sink, registry, started)
}

fn read_pid(path: &Path) -> i32 {
    fs::read_to_string(path)
        .expect("pid file")
        .trim()
        .parse()
        .expect("numeric pid")
}

fn process_gone(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

fn reap_leftover(pid: i32) -> bool {
    let gone = wait_until(Duration::from_secs(5), || process_gone(pid));
    if !gone {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    gone
}

#[test]
fn clean_exit_delivers_sigterm_to_a_same_group_descendant_before_the_kill() {
    let (cwd, sink, _registry, _) = start_shell(
        "agt-grace-term",
        "( trap 'echo graceful > term.txt; exit 0' TERM; while :; do sleep 0.05; done ) </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; exit 0",
    );
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-grace-term")));
    assert!(
        wait_until(Duration::from_secs(5), || fs::read_to_string(
            cwd.join("term.txt")
        )
        .is_ok_and(|text| text.trim() == "graceful")),
        "descendant never received SIGTERM before the final kill"
    );
    let pid = read_pid(&cwd.join("descendant.pid"));
    assert!(reap_leftover(pid), "descendant outlived the clean exit");
    let _ = fs::remove_dir_all(cwd);
}

#[test]
fn clean_exit_kills_a_descendant_that_ignores_sigterm_after_the_grace() {
    let (cwd, sink, _registry, started) = start_shell(
        "agt-grace-ignore",
        "( trap '' TERM; while :; do sleep 0.05; done ) </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; exit 0",
    );
    assert!(wait_until(Duration::from_secs(12), || sink
        .has_terminal_status("agt-grace-ignore")));
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1500) && elapsed < Duration::from_secs(8),
        "terminal after {elapsed:?}"
    );
    let pid = read_pid(&cwd.join("descendant.pid"));
    assert!(reap_leftover(pid), "descendant survived the final SIGKILL");
    let _ = fs::remove_dir_all(cwd);
}

#[test]
fn untracked_nohup_child_survives_a_clean_exit_only_for_the_grace_window() {
    let (cwd, sink, _registry, _) = start_shell(
        "agt-grace-nohup",
        "nohup /bin/sh -c 'trap \"\" TERM; while :; do sleep 0.05; done' </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; : > leader.exited; exit 0",
    );
    assert!(wait_until(Duration::from_secs(10), || cwd
        .join("leader.exited")
        .exists()));
    let leader_exited = Instant::now();
    let pid = read_pid(&cwd.join("descendant.pid"));
    thread::sleep(Duration::from_millis(1000));
    assert!(
        !process_gone(pid),
        "nohup child was killed before the grace window ended"
    );
    assert!(!sink.has_terminal_status("agt-grace-nohup"));
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-grace-nohup")));
    let terminal_after = leader_exited.elapsed();
    assert!(
        terminal_after >= Duration::from_millis(1500) && terminal_after < Duration::from_secs(8),
        "terminal {terminal_after:?} after the leader exit"
    );
    assert!(reap_leftover(pid), "nohup child outlived the bounded grace");
    let _ = fs::remove_dir_all(cwd);
}

#[test]
fn stop_still_kills_immediately_with_the_unchanged_escalation() {
    let (cwd, sink, registry, _) = start_shell(
        "agt-grace-real-stop",
        "trap '' TERM; ( trap '' TERM; while :; do sleep 0.05; done ) </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; while :; do sleep 0.05; done",
    );
    assert!(wait_until(Duration::from_secs(10), || cwd
        .join("descendant.pid")
        .exists()
        && fs::read_to_string(cwd.join("descendant.pid"))
            .is_ok_and(|text| !text.trim().is_empty())));
    let pid = read_pid(&cwd.join("descendant.pid"));
    let stopped_at = Instant::now();
    registry.stop("agt-grace-real-stop").expect("stop");
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-grace-real-stop")));
    let elapsed = stopped_at.elapsed();
    assert!(
        elapsed >= Duration::from_millis(400) && elapsed < Duration::from_millis(1800),
        "stop settled after {elapsed:?}"
    );
    assert!(matches!(
        statuses_for(&sink, "agt-grace-real-stop")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
    assert!(reap_leftover(pid), "descendant survived Stop");
    let _ = fs::remove_dir_all(cwd);
}

#[cfg(target_os = "macos")]
#[test]
fn clean_exit_without_survivors_settles_well_under_the_grace() {
    let (cwd, sink, _registry, started) = start_shell("agt-grace-fast", "exit 0");
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-grace-fast")));
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_millis(1000),
        "a lone leader exit waited {elapsed:?}"
    );
    assert!(matches!(
        statuses_for(&sink, "agt-grace-fast")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    let _ = fs::remove_dir_all(cwd);
}
