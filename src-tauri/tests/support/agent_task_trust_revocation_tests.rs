use super::fake_claude_cli::{alive, gone_within};
use super::*;
use agent_task_supervisor::agent_task_trust_revocation::AGENT_TASK_TRUST_REVOKED_MESSAGE;

const REVOKED: &str = "ws-revoked";
const OTHER: &str = "ws-other";

fn in_place_request(task_id: &str, workspace_id: &str, root: &Path) -> AgentTaskStartRequest {
    AgentTaskStartRequest {
        workspace_id: workspace_id.to_string(),
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        ..start_request(task_id, root)
    }
}

fn start_fake_turn(
    fixture: &Fixture,
    task_id: &str,
    workspace_id: &str,
    root: &Path,
    process_group_id: i32,
    term_exit_code: Option<i32>,
) {
    let process = FakeProcess::new(None, term_exit_code);
    fixture.signals.track(process_group_id, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, process_group_id).build(),
    ));
    let admission = fixture
        .admission
        .reserve(
            &workspace(workspace_id),
            root,
            root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    fixture
        .registry
        .start(
            in_place_request(task_id, workspace_id, root),
            fake_plan(root),
            admission,
        )
        .expect("start turn");
}

fn revoke_trust(registry: &AgentTaskRegistry) {
    registry.stop_for_revoked_workspace_trust(REVOKED, || {});
}

fn terminal_status(sink: &RecordingSink, task_id: &str) -> Option<AgentTaskStatusPayload> {
    assert!(
        wait_until(EVENT_DEADLINE, || sink.has_terminal_status(task_id)),
        "{task_id} did not reach a terminal status"
    );
    statuses_for(sink, task_id)
        .last()
        .map(|event| event.status.clone())
}

fn stopped_for_revoked_trust(status: Option<AgentTaskStatusPayload>) -> bool {
    matches!(
        status,
        Some(AgentTaskStatusPayload::Failed { message })
            if message == AGENT_TASK_TRUST_REVOKED_MESSAGE
    )
}

#[test]
fn the_revoked_trust_status_serializes_to_the_pinned_wire_shape() {
    assert_wire(
        &AgentTaskStatusPayload::Failed {
            message: AGENT_TASK_TRUST_REVOKED_MESSAGE.to_string(),
        },
        r#"{"status":"failed","message":"This turn was stopped because trust in its project was revoked. Trust the project again to continue."}"#,
    );
}

#[test]
fn revoked_trust_stops_every_turn_of_the_exact_workspace_and_reports_why() {
    let fixture = fixture(Duration::from_secs(60));
    let project = unique_path("revoked-project");
    let worktree = unique_path("revoked-worktree");
    start_fake_turn(&fixture, "agt-project", REVOKED, &project, 9301, Some(143));
    start_fake_turn(
        &fixture,
        "agt-worktree",
        REVOKED,
        &worktree,
        9302,
        Some(143),
    );
    start_fake_turn(&fixture, "agt-foreign", OTHER, &project, 9303, Some(143));
    for task_id in ["agt-project", "agt-worktree", "agt-foreign"] {
        fixture.registry.acknowledge(task_id).expect("acknowledge");
    }

    revoke_trust(&fixture.registry);

    for (task_id, process_group_id) in [("agt-project", 9301), ("agt-worktree", 9302)] {
        assert!(stopped_for_revoked_trust(terminal_status(
            &fixture.sink,
            task_id
        )));
        assert_eq!(
            fixture
                .signals
                .signals_for(process_group_id)
                .first()
                .copied(),
            Some(TERMINATE_PROCESS_GROUP_SIGNAL)
        );
    }
    assert!(!fixture.sink.has_terminal_status("agt-foreign"));
    assert!(fixture.signals.signals_for(9303).is_empty());
    fixture.registry.stop("agt-foreign").expect("cleanup stop");
    assert!(matches!(
        terminal_status(&fixture.sink, "agt-foreign"),
        Some(AgentTaskStatusPayload::Stopped)
    ));
}

#[test]
fn a_turn_revoked_before_its_acknowledgement_reports_why_once_acknowledged() {
    let fixture = fixture(Duration::from_secs(60));
    let project = unique_path("revoked-unacknowledged");
    start_fake_turn(&fixture, "agt-accepted", REVOKED, &project, 9304, Some(143));

    revoke_trust(&fixture.registry);

    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "revoked turn workers did not settle"
    );
    assert!(fixture.sink.statuses().is_empty());
    fixture
        .registry
        .acknowledge_for_workspace("agt-accepted", REVOKED)
        .expect("acknowledge");
    assert!(stopped_for_revoked_trust(terminal_status(
        &fixture.sink,
        "agt-accepted"
    )));
}

#[test]
fn a_turn_that_ignores_the_graceful_stop_is_killed_and_still_reports_why() {
    let fixture = fixture(Duration::from_secs(60));
    let project = unique_path("revoked-stubborn");
    start_fake_turn(&fixture, "agt-stubborn", REVOKED, &project, 9305, None);
    fixture
        .registry
        .acknowledge("agt-stubborn")
        .expect("acknowledge");

    revoke_trust(&fixture.registry);

    assert!(stopped_for_revoked_trust(terminal_status(
        &fixture.sink,
        "agt-stubborn"
    )));
    assert_eq!(
        fixture.signals.signals_for(9305),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
}

#[test]
fn a_turn_the_user_already_stopped_stays_stopped_when_trust_is_revoked() {
    let fixture = fixture(Duration::from_secs(60));
    let project = unique_path("revoked-after-stop");
    start_fake_turn(&fixture, "agt-stopping", REVOKED, &project, 9306, None);
    fixture
        .registry
        .acknowledge("agt-stopping")
        .expect("acknowledge");
    fixture.registry.stop("agt-stopping").expect("user stop");

    revoke_trust(&fixture.registry);

    assert!(matches!(
        terminal_status(&fixture.sink, "agt-stopping"),
        Some(AgentTaskStatusPayload::Stopped)
    ));
}

const REAL_TURN: &str = "sleep 30 & echo \"background=$!\"; sleep 30";
const TERM_IGNORING_REAL_TURN: &str = "trap '' TERM; sleep 30 & echo \"background=$!\"; sleep 30";

fn start_real_turn(
    registry: &AgentTaskRegistry,
    admission: &Arc<AgentTaskAdmissionRegistry>,
    sink: &RecordingSink,
    task_id: &str,
    workspace_id: &str,
    script: &str,
) -> i32 {
    let cwd = unique_path(task_id);
    fs::create_dir_all(&cwd).expect("real cwd");
    let reserved = admission
        .reserve(
            &workspace(workspace_id),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("real admission");
    let plan = AgentTaskSpawnPlan::for_tests(
        PathBuf::from("/bin/sh"),
        vec!["-c".to_string(), script.to_string()],
        cwd.clone(),
        Vec::new(),
    );
    registry
        .start(
            in_place_request(task_id, workspace_id, &cwd),
            plan,
            reserved,
        )
        .expect("real start");
    registry.acknowledge(task_id).expect("real acknowledge");
    reported_background_pid(sink, task_id)
}

fn reported_background_pid(sink: &RecordingSink, task_id: &str) -> i32 {
    let mut background = None;
    assert!(
        wait_until(Duration::from_secs(10), || {
            background = outputs_for(sink, task_id)
                .iter()
                .map(|event| event.chunk.as_str())
                .collect::<String>()
                .lines()
                .find_map(|line| line.strip_prefix("background=")?.parse::<i32>().ok());
            background.is_some()
        }),
        "{task_id} did not report its background process"
    );
    background.expect("background pid")
}

#[test]
fn revoked_trust_reaps_the_whole_process_group_of_the_exact_workspace() {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let revoked_background =
        start_real_turn(&registry, &admission, &sink, "agt-real", REVOKED, REAL_TURN);
    let other_background =
        start_real_turn(&registry, &admission, &sink, "agt-kept", OTHER, REAL_TURN);

    revoke_trust(&registry);

    assert!(stopped_for_revoked_trust(terminal_status(
        &sink, "agt-real"
    )));
    assert!(gone_within(revoked_background, Duration::from_secs(10)));
    assert!(alive(other_background));
    assert!(!sink.has_terminal_status("agt-kept"));
    registry.stop("agt-kept").expect("cleanup stop");
    assert!(matches!(
        terminal_status(&sink, "agt-kept"),
        Some(AgentTaskStatusPayload::Stopped)
    ));
    assert!(gone_within(other_background, Duration::from_secs(10)));
}

#[test]
fn revoked_trust_kills_a_real_process_group_that_ignores_the_graceful_stop() {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let background = start_real_turn(
        &registry,
        &admission,
        &sink,
        "agt-deaf",
        REVOKED,
        TERM_IGNORING_REAL_TURN,
    );

    revoke_trust(&registry);

    assert!(stopped_for_revoked_trust(terminal_status(
        &sink, "agt-deaf"
    )));
    assert!(gone_within(background, Duration::from_secs(10)));
}

#[test]
fn revocation_without_worker_threads_kills_at_once_instead_of_waiting_on_the_caller() {
    let fixture = fixture(Duration::from_secs(60));
    let project = unique_path("revoked-without-workers");
    let turns = [
        ("agt-first", 9307),
        ("agt-second", 9308),
        ("agt-third", 9309),
    ];
    for (task_id, process_group_id) in turns {
        start_fake_turn(&fixture, task_id, REVOKED, &project, process_group_id, None);
        fixture.registry.acknowledge(task_id).expect("acknowledge");
    }

    fixture
        .registry
        .stop_for_revoked_workspace_trust_without_workers_for_tests(REVOKED);

    for (task_id, process_group_id) in turns {
        assert_eq!(
            fixture.signals.signals_for(process_group_id),
            vec![KILL_PROCESS_GROUP_SIGNAL]
        );
        assert!(stopped_for_revoked_trust(terminal_status(
            &fixture.sink,
            task_id
        )));
    }
}

#[derive(Clone, Copy, PartialEq)]
enum OwnTeardown {
    FailureKill,
    ExitProbe,
}

struct GatedTeardownSignals {
    gate: OwnTeardown,
    system: Option<Arc<dyn AgentProcessGroupSignalSender>>,
    entered: Mutex<mpsc::Sender<()>>,
    release: Mutex<mpsc::Receiver<()>>,
    held: AtomicBool,
    released_in_time: AtomicBool,
    sent: Mutex<Vec<i32>>,
}

impl GatedTeardownSignals {
    fn hold(&self, reached: OwnTeardown) {
        if reached != self.gate || self.held.swap(true, Ordering::SeqCst) {
            return;
        }
        self.entered
            .lock()
            .expect("entered lock")
            .send(())
            .expect("announce the held teardown");
        let released = self
            .release
            .lock()
            .expect("release lock")
            .recv_timeout(EVENT_DEADLINE)
            .is_ok();
        self.released_in_time.store(released, Ordering::SeqCst);
    }

    fn sent(&self) -> Vec<i32> {
        self.sent.lock().expect("sent lock").clone()
    }
}

impl AgentProcessGroupSignalSender for GatedTeardownSignals {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.sent.lock().expect("sent lock").push(signal);
        let sent = match &self.system {
            Some(system) => system.send(process_group_id, signal),
            None => Ok(()),
        };
        if signal == KILL_PROCESS_GROUP_SIGNAL {
            self.hold(OwnTeardown::FailureKill);
        }
        sent
    }

    fn send_after_observed_exit(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.sent.lock().expect("sent lock").push(signal);
        match &self.system {
            Some(system) => system.send_after_observed_exit(process_group_id, signal),
            None => Ok(()),
        }
    }

    fn group_has_members_besides_leader(&self, process_group_id: i32) -> Option<bool> {
        self.hold(OwnTeardown::ExitProbe);
        match &self.system {
            Some(system) => system.group_has_members_besides_leader(process_group_id),
            None => Some(false),
        }
    }
}

struct GatedTeardown {
    registry: AgentTaskRegistry,
    sink: Arc<RecordingSink>,
    signals: Arc<GatedTeardownSignals>,
    entered: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
}

impl GatedTeardown {
    fn await_held_teardown(&self) {
        self.entered
            .recv_timeout(EVENT_DEADLINE)
            .expect("the turn never reached its own teardown");
    }

    fn release_teardown(&self) {
        self.release.send(()).expect("release the held teardown");
    }

    fn own_result(&self) -> Option<AgentTaskStatusPayload> {
        let status = terminal_status(&self.sink, "agt-own");
        assert!(
            self.signals.released_in_time.load(Ordering::SeqCst),
            "the turn's own teardown timed out before trust was revoked"
        );
        status
    }
}

fn start_turn_that_settles_on_its_own(
    gate: OwnTeardown,
    system: Option<Arc<dyn AgentProcessGroupSignalSender>>,
    spawner: Arc<dyn AgentProcessSpawner>,
    plan: impl FnOnce(&Path) -> AgentTaskSpawnPlan,
) -> GatedTeardown {
    let (entered_tx, entered) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let signals = Arc::new(GatedTeardownSignals {
        gate,
        system,
        entered: Mutex::new(entered_tx),
        release: Mutex::new(release_rx),
        held: AtomicBool::new(false),
        released_in_time: AtomicBool::new(false),
        sent: Mutex::new(Vec::new()),
    });
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission),
        spawner,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
        Duration::from_secs(60),
        Duration::from_millis(100),
        Duration::from_millis(200),
    )
    .with_clean_exit_grace_for_tests(Duration::from_secs(1));
    let root = unique_path("revoked-own-teardown");
    fs::create_dir_all(&root).expect("turn root");
    let reserved = admission
        .reserve(
            &workspace(REVOKED),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    registry
        .start(
            in_place_request("agt-own", REVOKED, &root),
            plan(&root),
            reserved,
        )
        .expect("start turn");
    registry.acknowledge("agt-own").expect("acknowledge");
    GatedTeardown {
        registry,
        sink,
        signals,
        entered,
        release,
    }
}

fn start_fake_turn_that_settles_on_its_own(gate: OwnTeardown, child: FakeChild) -> GatedTeardown {
    let spawner = Arc::new(FakeSpawner::default());
    spawner.script(FakeSpawnOutcome::Child(child));
    start_turn_that_settles_on_its_own(gate, None, spawner, fake_plan)
}

#[test]
fn a_turn_already_failing_on_its_own_keeps_its_failure_when_trust_is_revoked() {
    let child = FakeChildSpec::new(&FakeProcess::new(None, None), 9310)
        .with_try_wait_failure()
        .build();
    let turn = start_fake_turn_that_settles_on_its_own(OwnTeardown::FailureKill, child);
    turn.await_held_teardown();

    turn.registry
        .stop_for_revoked_workspace_trust(REVOKED, || turn.release_teardown());

    assert!(matches!(
        turn.own_result(),
        Some(AgentTaskStatusPayload::Failed { message })
            if message == "Agent task wait failed: try wait failure injected"
    ));
    assert!(!turn
        .signals
        .sent()
        .contains(&TERMINATE_PROCESS_GROUP_SIGNAL));
}

#[test]
fn a_turn_that_already_exited_on_its_own_keeps_its_result_while_its_group_is_killed() {
    let child = FakeChildSpec::new(&FakeProcess::new(Some(7), None), 9311).build();
    let turn = start_fake_turn_that_settles_on_its_own(OwnTeardown::ExitProbe, child);
    turn.await_held_teardown();
    assert!(turn.signals.sent().is_empty());

    revoke_trust(&turn.registry);

    assert_eq!(turn.signals.sent(), vec![KILL_PROCESS_GROUP_SIGNAL]);
    turn.release_teardown();
    assert!(matches!(
        turn.own_result(),
        Some(AgentTaskStatusPayload::Exited { exit_code: 7 })
    ));
    assert!(!turn
        .signals
        .sent()
        .contains(&TERMINATE_PROCESS_GROUP_SIGNAL));
}

#[test]
fn revoked_trust_promptly_kills_a_background_child_that_outlived_its_turn_and_keeps_the_turns_result(
) {
    let turn = start_turn_that_settles_on_its_own(
        OwnTeardown::ExitProbe,
        Some(agent_task_supervisor::system_process_group_signals()),
        Arc::new(StdAgentProcessSpawner),
        |root| {
            AgentTaskSpawnPlan::for_tests(
                PathBuf::from("/bin/sh"),
                vec![
                    "-c".to_string(),
                    "sleep 30 >/dev/null 2>&1 & echo \"background=$!\"; exit 7".to_string(),
                ],
                root.to_path_buf(),
                Vec::new(),
            )
        },
    );
    let background = reported_background_pid(&turn.sink, "agt-own");
    turn.await_held_teardown();
    assert!(alive(background));

    revoke_trust(&turn.registry);

    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(!turn.sink.has_terminal_status("agt-own"));
    turn.release_teardown();
    assert!(matches!(
        turn.own_result(),
        Some(AgentTaskStatusPayload::Exited { exit_code: 7 })
    ));
}
