use super::claude_thread_session_tests::linger_native_background_task;
use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::{AgentLaunchOptions, ClaudeEffortChoice};
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionBackgroundTask, ClaudeSessionBackgroundTaskType,
    ClaudeSessionBackgroundTasksEvent, ClaudeSessionBackgroundTurnEvent, ClaudeSessionEndReason,
    ClaudeSessionEndedEvent, ClaudeSessionInspection, ClaudeSessionKey, ClaudeSessionRestartPolicy,
    ClaudeSessionTuning, CLAUDE_SESSION_BUSY_ERROR, CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR,
};
use agent_task_spawner::claude_session_registry::{
    ClaudeSessionEventSink, ClaudeSessionLease, ClaudeSessionRegistry, ClaudeSessionRequest,
    CLAUDE_SESSION_ADMISSION_CLOSED_ERROR,
};
use agent_task_spawner::claude_session_router::{
    BackgroundTaskKind, ClaudeBackgroundTasks, ClaudeBackgroundTurn, LiveBackgroundTask,
};
use agent_task_spawner::claude_thread_session::ClaudeThreadSession;
use agent_task_spawner::spawn_bound_process;
use agent_task_supervisor::system_process_group_signals;
use std::process::{Child, Stdio};
use std::sync::atomic::AtomicUsize;

#[derive(Default)]
pub(crate) struct RecordingSessionEvents {
    events: Mutex<Vec<ClaudeSessionEndedEvent>>,
    background: Mutex<Vec<ClaudeSessionBackgroundTurnEvent>>,
    tasks: Mutex<Vec<ClaudeSessionBackgroundTasksEvent>>,
}

impl ClaudeSessionEventSink for RecordingSessionEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        self.events.lock().expect("events lock").push(event);
    }

    fn background_turn(&self, event: ClaudeSessionBackgroundTurnEvent) {
        self.background.lock().expect("background lock").push(event);
    }

    fn background_tasks(&self, event: ClaudeSessionBackgroundTasksEvent) {
        self.tasks.lock().expect("tasks lock").push(event);
    }
}

impl RecordingSessionEvents {
    pub(crate) fn reasons_for(&self, thread_id: &str) -> Vec<ClaudeSessionEndReason> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .filter(|event| event.thread_id == thread_id)
            .map(|event| event.reason)
            .collect()
    }

    pub(crate) fn last_for(&self, thread_id: &str) -> Option<ClaudeSessionEndedEvent> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .rev()
            .find(|event| event.thread_id == thread_id)
            .cloned()
    }

    pub(crate) fn background_task_levels(&self) -> Vec<ClaudeSessionBackgroundTasksEvent> {
        self.tasks.lock().expect("tasks lock").clone()
    }

    pub(crate) fn background_turns(&self) -> Vec<ClaudeSessionBackgroundTurnEvent> {
        self.background.lock().expect("background lock").clone()
    }

    pub(crate) fn background_turns_for(
        &self,
        thread_id: &str,
    ) -> Vec<ClaudeSessionBackgroundTurnEvent> {
        self.background_turns()
            .into_iter()
            .filter(|event| event.thread_id == thread_id)
            .collect()
    }
}

pub(crate) fn session_registry(
    tuning: ClaudeSessionTuning,
) -> (Arc<ClaudeSessionRegistry>, Arc<RecordingSessionEvents>) {
    let events = Arc::new(RecordingSessionEvents::default());
    let registry = Arc::new(ClaudeSessionRegistry::with_tuning(
        system_process_group_signals(),
        Arc::clone(&events) as Arc<dyn ClaudeSessionEventSink>,
        tuning,
    ));
    (registry, events)
}

pub(crate) fn session_request(
    cli: &FakeCli,
    workspace: &str,
    thread: &str,
    resume: Option<&str>,
    launch: AgentLaunchOptions,
    restart: ClaudeSessionRestartPolicy,
) -> ClaudeSessionRequest {
    ClaudeSessionRequest {
        key: session_key(workspace, thread),
        repository_root: cli.dir.clone(),
        fingerprint: cli.fingerprint(1, launch),
        resume_session_id: resume.map(str::to_string),
        restart,
    }
}

fn session_key(workspace: &str, thread: &str) -> ClaudeSessionKey {
    ClaudeSessionKey {
        workspace_id: workspace.to_string(),
        thread_id: thread.to_string(),
    }
}

struct Acquired {
    session: Option<Arc<ClaudeThreadSession>>,
    spawned: bool,
}

fn acquire_with(
    registry: &ClaudeSessionRegistry,
    request: &ClaudeSessionRequest,
    spawn: impl FnOnce() -> Result<(Child, i32), String>,
) -> Result<Acquired, String> {
    let spawns = AtomicUsize::new(0);
    let lease = registry.acquire(request, || {
        spawns.fetch_add(1, Ordering::SeqCst);
        spawn()
    })?;
    let spawned = spawns.load(Ordering::SeqCst) == 1;
    Ok(match lease {
        ClaudeSessionLease::Session(session) => Acquired {
            session: Some(session),
            spawned,
        },
        ClaudeSessionLease::Ephemeral => Acquired {
            session: None,
            spawned,
        },
    })
}

fn acquire(
    registry: &ClaudeSessionRegistry,
    cli: &FakeCli,
    request: &ClaudeSessionRequest,
) -> Result<Acquired, String> {
    acquire_with(registry, request, || {
        spawn_bound_process(&cli.plan("sess-fixture-0001", "unused"), Stdio::piped())
    })
}

fn settle(session: &Arc<ClaudeThreadSession>, prompt: &str) {
    let mut turn = session
        .attach_turn(&claude_user_frame(prompt, &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut buffer = [0_u8; 4096];
    while Instant::now() < deadline {
        match stdout.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => thread::sleep(Duration::from_millis(5)),
        }
    }
    assert!(turn.observe_exit().expect("observe"));
}

fn claude_launch(effort: ClaudeEffortChoice) -> AgentLaunchOptions {
    match AgentLaunchOptions::default() {
        AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            context,
            fast_mode,
            thinking_mode,
            chrome,
            ..
        } => AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            effort,
            context,
            fast_mode,
            thinking_mode,
            chrome,
        },
        other => other,
    }
}

const RESUME: Option<&str> = Some("sess-fixture-0001");

fn started_cli_pids(cli: &FakeCli, expected: usize) -> Vec<i32> {
    assert!(
        wait_until(Duration::from_secs(5), || cli.cli_pids().len() >= expected),
        "expected {expected} fake CLI processes, saw {:?}",
        cli.cli_pids()
    );
    let pids = cli.cli_pids();
    assert_eq!(pids.len(), expected, "{pids:?}");
    pids
}

#[test]
fn a_matching_follow_up_reuses_the_live_session() {
    let cli = FakeCli::new("registry-reuse");
    let (registry, _) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let first = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            launch,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("first");
    let session = first.session.expect("session");
    assert!(first.spawned);
    settle(&session, "hello");
    let second = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            RESUME,
            launch,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("second");
    assert!(!second.spawned);
    assert!(Arc::ptr_eq(&session, &second.session.expect("reused")));
    assert!(registry.shutdown_all());
}

#[test]
fn workspace_a_b_a_never_reuses_a_foreign_owner_session() {
    let cli = FakeCli::new("registry-aba");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let a = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("a");
    let first_generation = a.session.as_ref().expect("a session").generation();
    settle(a.session.as_ref().expect("a session"), "hello");
    let b = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-b", "t1", RESUME, launch, policy),
    )
    .expect("b");
    assert!(
        b.spawned,
        "a new owner must never inherit the old owner's process"
    );
    settle(b.session.as_ref().expect("b session"), "hello");
    let back = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    )
    .expect("a again");
    assert!(
        back.spawned,
        "returning to A must not resurrect A's first process"
    );
    let back_generation = back.session.as_ref().expect("a again").generation();
    assert!(back_generation > first_generation);
    assert!(!Arc::ptr_eq(
        a.session.as_ref().expect("a session"),
        back.session.as_ref().expect("a again")
    ));
    let pids = started_cli_pids(&cli, 3);
    assert!(gone_within(pids[0], Duration::from_secs(5)));
    assert!(gone_within(pids[1], Duration::from_secs(5)));
    assert!(alive(pids[2]));
    assert_eq!(
        events.reasons_for("t1"),
        vec![
            ClaudeSessionEndReason::Released,
            ClaudeSessionEndReason::Released
        ]
    );
    assert_eq!(registry.live_sessions(), 1);
    assert!(registry.shutdown_all());
}

#[test]
fn concurrent_sessions_are_capped_with_deterministic_eviction() {
    let cli = FakeCli::new("registry-cap");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        max_live_sessions: 2,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    for thread in ["t1", "t2"] {
        let acquired = acquire(
            &registry,
            &cli,
            &session_request(&cli, "ws-a", thread, None, launch, policy),
        )
        .expect("acquire");
        settle(acquired.session.as_ref().expect("session"), "hello");
        thread::sleep(Duration::from_millis(20));
    }
    let third = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t3", None, launch, policy),
    )
    .expect("third");
    assert!(third.session.is_some());
    assert_eq!(
        events.reasons_for("t1"),
        vec![ClaudeSessionEndReason::Evicted]
    );
    assert!(events.reasons_for("t2").is_empty());
    assert_eq!(registry.live_sessions(), 2);
    assert!(registry.shutdown_all());
}

#[test]
fn when_every_session_is_busy_the_next_turn_runs_ephemeral() {
    let cli = FakeCli::new("registry-ephemeral");
    let (registry, _) = session_registry(ClaudeSessionTuning {
        max_live_sessions: 1,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let busy = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("busy");
    let _running = busy
        .session
        .as_ref()
        .expect("session")
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let next = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t2", None, launch, policy),
    )
    .expect("next");
    assert!(next.session.is_none());
    assert!(!next.spawned);
    let same = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    );
    assert_eq!(same.err().as_deref(), Some(CLAUDE_SESSION_BUSY_ERROR));
    assert!(registry.shutdown_all());
}

#[test]
fn launch_change_refuses_without_confirmation_and_restarts_with_it() {
    let cli = FakeCli::new("registry-restart");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let high = claude_launch(ClaudeEffortChoice::High);
    let low = claude_launch(ClaudeEffortChoice::Low);
    let first = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            high,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("first");
    linger_native_background_task(first.session.as_ref().expect("session"));
    let first_pid = started_cli_pids(&cli, 1)[0];
    let refused = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            RESUME,
            low,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    );
    assert_eq!(
        refused.err().as_deref(),
        Some(CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR)
    );
    assert!(
        alive(first_pid),
        "a refused restart must not touch the session running background tasks"
    );
    assert_eq!(
        first.session.as_ref().expect("session").background_tasks(),
        1
    );
    assert!(events.reasons_for("t1").is_empty());
    let restarted = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            RESUME,
            low,
            ClaudeSessionRestartPolicy::StopBackground,
        ),
    )
    .expect("confirmed restart");
    assert!(restarted.spawned);
    assert!(gone_within(first_pid, Duration::from_secs(5)));
    let ended = events.last_for("t1").expect("ended event");
    assert_eq!(ended.reason, ClaudeSessionEndReason::Restarted);
    assert!(ended.background_tasks_live);
    assert!(registry.shutdown_all());
}

#[test]
fn a_process_group_member_alone_never_requires_restart_confirmation() {
    let cli = FakeCli::new("registry-restart-group-member");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let first = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            claude_launch(ClaudeEffortChoice::High),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("first");
    settle(first.session.as_ref().expect("session"), "spawn-background");
    let background = cli.background_pid().expect("background pid");
    assert_eq!(
        first.session.as_ref().expect("session").background_tasks(),
        0
    );
    let restarted = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            RESUME,
            claude_launch(ClaudeEffortChoice::Low),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("restart without confirmation");
    assert!(restarted.spawned);
    assert!(gone_within(background, Duration::from_secs(5)));
    let ended = events.last_for("t1").expect("ended event");
    assert_eq!(ended.reason, ClaudeSessionEndReason::Restarted);
    assert!(!ended.background_tasks_live);
    assert!(registry.shutdown_all());
}

#[test]
fn a_fresh_conversation_request_restarts_the_session() {
    let cli = FakeCli::new("registry-fresh");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    settle(first.session.as_ref().expect("session"), "hello");
    let fresh = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("fresh");
    assert!(fresh.spawned);
    assert_eq!(
        events.reasons_for("t1"),
        vec![ClaudeSessionEndReason::Restarted]
    );
    assert!(registry.shutdown_all());
}

#[test]
fn idle_crash_is_reported_and_the_next_turn_respawns() {
    let cli = FakeCli::new("registry-idle-crash");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    settle(first.session.as_ref().expect("session"), "hello");
    unsafe {
        libc::kill(cli.cli_pids()[0], libc::SIGKILL);
    }
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::Crashed]));
    assert_eq!(registry.live_sessions(), 0);
    let next = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    )
    .expect("respawn");
    assert!(next.spawned);
    assert_eq!(started_cli_pids(&cli, 2).len(), 2);
    assert!(registry.shutdown_all());
}

#[test]
fn a_failed_spawn_releases_the_reservation() {
    let cli = FakeCli::new("registry-spawn-failure");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let request = session_request(
        &cli,
        "ws-a",
        "t1",
        None,
        AgentLaunchOptions::default(),
        ClaudeSessionRestartPolicy::RefuseIfBackground,
    );
    let failed = acquire_with(&registry, &request, || Err("spawn refused".to_string()));
    assert_eq!(failed.err().as_deref(), Some("spawn refused"));
    assert_eq!(registry.live_sessions(), 0);
    let retried = acquire(&registry, &cli, &request).expect("retry after spawn failure");
    assert!(retried.spawned);
    assert!(retried.session.is_some());
    assert!(events.reasons_for("t1").is_empty());
    assert!(registry.shutdown_all());
}

#[test]
fn a_failed_start_releases_the_reservation_and_kills_the_child() {
    let cli = FakeCli::new("registry-start-failure");
    let (registry, _events) = session_registry(ClaudeSessionTuning::default());
    let request = session_request(
        &cli,
        "ws-a",
        "t1",
        None,
        AgentLaunchOptions::default(),
        ClaudeSessionRestartPolicy::RefuseIfBackground,
    );
    let spawned_pid = AtomicUsize::new(0);
    let failed = acquire_with(&registry, &request, || {
        let spawned = spawn_bound_process(&cli.plan("sess-fixture-0001", "unused"), Stdio::null())?;
        spawned_pid.store(spawned.0.id() as usize, Ordering::SeqCst);
        Ok(spawned)
    });
    assert!(failed.is_err());
    let pid = i32::try_from(spawned_pid.load(Ordering::SeqCst)).expect("pid");
    assert!(pid > 0);
    assert!(gone_within(pid, Duration::from_secs(5)));
    assert_eq!(registry.live_sessions(), 0);
    let retried = acquire(&registry, &cli, &request).expect("retry after start failure");
    assert!(retried.spawned);
    assert!(retried.session.is_some());
    assert!(registry.shutdown_all());
}

#[test]
fn a_panicking_spawn_releases_the_reservation() {
    let cli = FakeCli::new("registry-spawn-panic");
    let (registry, _events) = session_registry(ClaudeSessionTuning::default());
    let request = session_request(
        &cli,
        "ws-a",
        "t1",
        None,
        AgentLaunchOptions::default(),
        ClaudeSessionRestartPolicy::RefuseIfBackground,
    );
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = acquire_with(&registry, &request, || panic!("spawn panicked"));
    }));
    assert!(panicked.is_err());
    let retried = acquire(&registry, &cli, &request).expect("retry after spawn panic");
    assert!(retried.spawned);
    assert!(registry.shutdown_all());
}

fn live_background_session(
    label: &str,
    tuning: ClaudeSessionTuning,
) -> (
    FakeCli,
    Arc<ClaudeSessionRegistry>,
    Arc<RecordingSessionEvents>,
    i32,
) {
    let cli = FakeCli::new(label);
    let (registry, events) = session_registry(tuning);
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    settle(
        acquired.session.as_ref().expect("session"),
        "spawn-background",
    );
    let background = cli.background_pid().expect("background pid");
    (cli, registry, events, background)
}

#[test]
fn ending_a_thread_kills_its_group() {
    let (_cli, registry, events, background) =
        live_background_session("reap-thread", ClaudeSessionTuning::default());
    assert!(registry.end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::ThreadEnded]));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 0));
    assert!(!registry.end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
}

#[test]
fn ending_a_thread_ignores_a_foreign_workspace() {
    let (_cli, registry, events, background) =
        live_background_session("reap-thread-foreign", ClaudeSessionTuning::default());
    assert!(!registry.end_for_thread("ws-b", "t1", ClaudeSessionEndReason::ThreadEnded));
    thread::sleep(Duration::from_millis(100));
    assert!(alive(background));
    assert!(events.reasons_for("t1").is_empty());
    assert!(registry.shutdown_all());
    assert!(gone_within(background, Duration::from_secs(5)));
}

#[test]
fn releasing_a_root_ends_only_that_owners_sessions() {
    let (cli, registry, events, background) =
        live_background_session("reap-root", ClaudeSessionTuning::default());
    let other = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-b",
            "t2",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("other owner");
    settle(other.session.as_ref().expect("session"), "hello");
    registry.end_for_root(Some("ws-a"), &cli.dir, ClaudeSessionEndReason::Released);
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::Released]));
    assert!(events.reasons_for("t2").is_empty());
    assert!(registry.end_for_root_and_reap(&cli.dir, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 0));
}

#[test]
fn releasing_a_workspace_ends_its_sessions_even_outside_the_released_root() {
    let cli = FakeCli::new("reap-released-workspace");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let released = "ws-0123456789abcdef0123456789abcdef";
    let other = "ws-fedcba9876543210fedcba9876543210";
    let released_thread = "agt-1-0a1c";
    let other_thread = "agt-2-0a1c";
    for (workspace, thread) in [(released, released_thread), (other, other_thread)] {
        let acquired = acquire(
            &registry,
            &cli,
            &session_request(
                &cli,
                workspace,
                thread,
                None,
                AgentLaunchOptions::default(),
                ClaudeSessionRestartPolicy::RefuseIfBackground,
            ),
        )
        .expect("acquire");
        settle(acquired.session.as_ref().expect("session"), "hello");
    }
    let released_root = cli.dir.join("released-project");
    registry.end_for_root(
        Some(released),
        &released_root,
        ClaudeSessionEndReason::Released,
    );
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for(released_thread).is_empty());

    registry.end_for_workspace(released, ClaudeSessionEndReason::Released);
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for(released_thread)
        == vec![ClaudeSessionEndReason::Released]));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 1));
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for(other_thread).is_empty());
    assert!(registry.shutdown_all());
}

#[test]
fn shutdown_closes_admission_and_reaps_everything() {
    let (cli, registry, _events, background) =
        live_background_session("reap-shutdown", ClaudeSessionTuning::default());
    assert!(registry.shutdown_all());
    assert!(gone_within(background, Duration::from_secs(5)));
    let refused = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t9",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    );
    assert_eq!(
        refused.err().as_deref(),
        Some(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR)
    );
    assert_eq!(cli.cli_pids().len(), 1);
}

#[test]
fn closed_admission_refuses_even_a_reusable_session() {
    let cli = FakeCli::new("registry-closed-reuse");
    let (registry, _events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    settle(first.session.as_ref().expect("session"), "hello");
    registry.close_admission();
    let refused = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    );
    assert_eq!(
        refused.err().as_deref(),
        Some(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR)
    );
    assert!(registry.shutdown_all());
}

#[test]
fn dropping_the_registry_kills_every_session() {
    let (cli, registry, _events, background) =
        live_background_session("reap-drop", ClaudeSessionTuning::default());
    let other = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-b",
            "t2",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("other");
    drop(other);
    let cli_pids = started_cli_pids(&cli, 2);
    drop(registry);
    for pid in cli_pids {
        assert!(gone_within(pid, Duration::from_secs(5)));
    }
    assert!(gone_within(background, Duration::from_secs(5)));
}

#[test]
fn idle_ttl_and_provider_update_retire_idle_sessions() {
    let tuning = ClaudeSessionTuning {
        idle_ttl: Duration::from_millis(50),
        ..ClaudeSessionTuning::default()
    };
    let (_cli, registry, events, background) = live_background_session("reap-idle", tuning);
    thread::sleep(Duration::from_millis(100));
    registry.retire_idle(Instant::now());
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::IdleTimeout]));
    assert!(!events.last_for("t1").expect("ended").background_tasks_live);

    let (_cli, registry, events, _) =
        live_background_session("reap-update", ClaudeSessionTuning::default());
    registry.retire_idle_for_update();
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::ProviderUpdated]));
}

#[test]
fn idle_retirement_keeps_a_session_with_native_background_tasks_until_the_long_ttl() {
    let cli = FakeCli::new("reap-idle-long");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        idle_ttl: Duration::from_secs(1),
        detached_work_ttl: Duration::from_secs(10),
        ..ClaudeSessionTuning::default()
    });
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    linger_native_background_task(acquired.session.as_ref().expect("session"));
    let cli_pid = started_cli_pids(&cli, 1)[0];
    registry.retire_idle(Instant::now() + Duration::from_secs(2));
    thread::sleep(Duration::from_millis(100));
    assert!(alive(cli_pid));
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(registry.live_sessions(), 1);
    registry.retire_idle(Instant::now() + Duration::from_secs(11));
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::IdleTimeout]));
    assert!(events.last_for("t1").expect("ended").background_tasks_live);
    assert!(gone_within(cli_pid, Duration::from_secs(5)));
    assert!(registry.shutdown_all());
}

#[test]
fn provider_update_retirement_spares_an_attached_session() {
    let cli = FakeCli::new("registry-update-attached");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    let _running = acquired
        .session
        .as_ref()
        .expect("session")
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    registry.retire_idle_for_update();
    registry.retire_idle(Instant::now() + Duration::from_secs(24 * 60 * 60));
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(registry.live_sessions(), 1);
    assert!(registry.shutdown_all());
}

#[test]
fn eviction_spares_a_session_with_live_native_background_tasks() {
    let cli = FakeCli::new("registry-evict-native");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        max_live_sessions: 2,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let older = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("older");
    linger_native_background_task(older.session.as_ref().expect("older"));
    thread::sleep(Duration::from_millis(20));
    let newer = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t2", None, launch, policy),
    )
    .expect("newer");
    settle(newer.session.as_ref().expect("newer"), "hello");
    let third = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t3", None, launch, policy),
    )
    .expect("third");
    assert!(third.session.is_some());
    assert_eq!(
        events.reasons_for("t2"),
        vec![ClaudeSessionEndReason::Evicted]
    );
    assert!(events.reasons_for("t1").is_empty());
    assert!(registry.shutdown_all());
}

#[test]
fn inspect_reports_live_native_background_tasks() {
    let cli = FakeCli::new("registry-inspect-native");
    let (registry, _) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            launch,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    linger_native_background_task(acquired.session.as_ref().expect("session"));
    assert_eq!(
        registry.inspect("ws-a", "t1", &launch, RESUME, 1),
        ClaudeSessionInspection::Reuse {
            background_tasks: true
        }
    );
    assert_eq!(
        registry.inspect(
            "ws-a",
            "t1",
            &claude_launch(ClaudeEffortChoice::Low),
            RESUME,
            1
        ),
        ClaudeSessionInspection::Restart {
            background_tasks: true
        }
    );
    assert!(registry.shutdown_all());
}

#[test]
fn inspect_reports_none_reuse_and_restart() {
    let cli = FakeCli::new("registry-inspect");
    let (registry, _) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    assert_eq!(
        registry.inspect("ws-a", "t1", &launch, None, 1),
        ClaudeSessionInspection::None
    );
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            "ws-a",
            "t1",
            None,
            launch,
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    settle(
        acquired.session.as_ref().expect("session"),
        "spawn-background",
    );
    assert_eq!(
        registry.inspect("ws-a", "t1", &launch, RESUME, 1),
        ClaudeSessionInspection::Reuse {
            background_tasks: false
        }
    );
    assert_eq!(
        registry.inspect(
            "ws-a",
            "t1",
            &claude_launch(ClaudeEffortChoice::Low),
            RESUME,
            1
        ),
        ClaudeSessionInspection::Restart {
            background_tasks: false
        }
    );
    assert_eq!(
        registry.inspect("ws-b", "t1", &launch, RESUME, 1),
        ClaudeSessionInspection::None
    );
    assert!(registry.shutdown_all());
}

#[test]
fn a_native_background_turn_emits_exactly_one_event_for_its_key() {
    let cli = FakeCli::new("registry-native-background");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let bystander = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-b", "t2", None, launch, policy),
    )
    .expect("bystander");
    settle(bystander.session.as_ref().expect("bystander"), "hello");
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("acquire");
    let session = acquired.session.expect("session");
    settle(&session, "native-background");
    assert!(wait_until(Duration::from_secs(5), || !events
        .background_turns()
        .is_empty()));
    thread::sleep(Duration::from_millis(200));
    let background = events.background_turns();
    assert_eq!(background.len(), 1, "{background:?}");
    let event = &background[0];
    assert_eq!(event.workspace_id, "ws-a");
    assert_eq!(event.thread_id, "t1");
    assert!(event.complete);
    assert!(!event.truncated);
    assert!(
        event.output.contains("background-finished"),
        "{}",
        event.output
    );
    assert!(events.background_turns_for("t2").is_empty());
    assert!(events.reasons_for("t1").is_empty());
    let reused = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    )
    .expect("reuse after background turn");
    assert!(!reused.spawned);
    assert!(registry.shutdown_all());
}

#[test]
fn a_resumed_agent_reports_background_task_levels_only_for_its_key() {
    let cli = FakeCli::new("registry-agent-resume");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let bystander = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-b", "t2", None, launch, policy),
    )
    .expect("bystander");
    settle(bystander.session.as_ref().expect("bystander"), "hello");
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("acquire");
    let session = acquired.session.expect("session");
    settle(&session, "agent-resume");
    let live = |events: &RecordingSessionEvents| {
        events
            .background_task_levels()
            .last()
            .map(|event| event.total)
    };
    assert!(wait_until(Duration::from_secs(5), || events
        .background_turns()
        .len()
        == 1));
    assert!(wait_until(Duration::from_secs(5), || live(&events) == Some(1)));
    let level = events.background_task_levels().last().cloned();
    assert_eq!(
        level,
        Some(ClaudeSessionBackgroundTasksEvent {
            workspace_id: "ws-a".to_string(),
            thread_id: "t1".to_string(),
            total: 1,
            agents: 1,
            tasks: vec![ClaudeSessionBackgroundTask {
                task_id: "a4b355dcf6056a875".to_string(),
                task_type: ClaudeSessionBackgroundTaskType::Agent,
                description: Some("Live Codex model catalog like Claude".to_string()),
            }],
        })
    );
    cli.release_agent();
    assert!(wait_until(Duration::from_secs(5), || live(&events) == Some(0)));
    assert!(events
        .background_task_levels()
        .iter()
        .all(|event| event.workspace_id == "ws-a" && event.thread_id == "t1"));
    assert!(registry.shutdown_all());
}

#[test]
fn background_task_levels_from_a_stale_or_foreign_generation_are_dropped() {
    let cli = FakeCli::new("registry-stale-levels");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    let stale = first.session.as_ref().expect("first").generation();
    settle(first.session.as_ref().expect("first"), "hello");
    let restarted = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("restart");
    let current = restarted.session.as_ref().expect("restarted").generation();
    let level = || ClaudeBackgroundTasks {
        tasks: vec![LiveBackgroundTask {
            task_id: "a4b355dcf6056a875".to_string(),
            kind: BackgroundTaskKind::Agent,
            description: None,
        }],
        total: 1,
        agents: 1,
    };
    let key = session_key("ws-a", "t1");
    registry.deliver_background_tasks_for_tests(&key, stale, level());
    registry.deliver_background_tasks_for_tests(&session_key("ws-b", "t1"), current, level());
    registry.deliver_background_tasks_for_tests(&key, current + 1, level());
    assert!(events.background_task_levels().is_empty());
    registry.deliver_background_tasks_for_tests(&key, current, level());
    assert_eq!(events.background_task_levels().len(), 1);
    assert!(registry.shutdown_all());
    registry.deliver_background_tasks_for_tests(&key, current, level());
    assert_eq!(events.background_task_levels().len(), 1);
}

#[test]
fn a_background_turn_from_a_stale_generation_is_dropped() {
    let cli = FakeCli::new("registry-stale-background");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    let stale = first.session.as_ref().expect("first").generation();
    settle(first.session.as_ref().expect("first"), "hello");
    let restarted = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("restart");
    assert!(restarted.spawned);
    let current = restarted.session.as_ref().expect("restarted").generation();
    assert!(current > stale);
    let turn = || ClaudeBackgroundTurn {
        output: b"{\"type\":\"result\"}\n".to_vec(),
        truncated: false,
        complete: true,
    };
    let key = session_key("ws-a", "t1");
    registry.deliver_background_turn_for_tests(&key, stale, turn());
    registry.deliver_background_turn_for_tests(&session_key("ws-b", "t1"), current, turn());
    registry.deliver_background_turn_for_tests(&key, current + 1, turn());
    assert!(events.background_turns().is_empty());
    registry.deliver_background_turn_for_tests(&key, current, turn());
    assert_eq!(
        events.background_turns(),
        vec![ClaudeSessionBackgroundTurnEvent {
            workspace_id: "ws-a".to_string(),
            thread_id: "t1".to_string(),
            output: "{\"type\":\"result\"}\n".to_string(),
            truncated: false,
            complete: true,
        }]
    );
    assert!(registry.shutdown_all());
    registry.deliver_background_turn_for_tests(&key, current, turn());
    assert_eq!(events.background_turns().len(), 1);
}

struct PanickingEvents;

impl ClaudeSessionEventSink for PanickingEvents {
    fn ended(&self, _event: ClaudeSessionEndedEvent) {
        panic!("ended sink panicked");
    }

    fn background_turn(&self, _event: ClaudeSessionBackgroundTurnEvent) {
        panic!("background sink panicked");
    }

    fn background_tasks(&self, _event: ClaudeSessionBackgroundTasksEvent) {
        panic!("background level sink panicked");
    }
}

#[test]
fn a_panicking_event_sink_never_strands_the_registry() {
    let cli = FakeCli::new("registry-panicking-sink");
    let registry =
        ClaudeSessionRegistry::new(system_process_group_signals(), Arc::new(PanickingEvents));
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    let session = first.session.expect("session");
    settle(&session, "hello");
    registry.deliver_background_turn_for_tests(
        &session_key("ws-a", "t1"),
        session.generation(),
        ClaudeBackgroundTurn {
            output: Vec::new(),
            truncated: false,
            complete: true,
        },
    );
    assert!(registry.end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 0));
    let next = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    )
    .expect("respawn after sink panic");
    assert!(next.spawned);
    assert!(registry.shutdown_all());
}

#[derive(Default)]
struct ReapCheckingEvents {
    pids: Mutex<HashMap<(String, String), i32>>,
    checks: Mutex<Vec<(String, ClaudeSessionEndReason, bool)>>,
}

impl ReapCheckingEvents {
    fn track(&self, workspace: &str, thread: &str, pid: i32) {
        self.pids
            .lock()
            .expect("pids lock")
            .insert((workspace.to_string(), thread.to_string()), pid);
    }

    fn checks(&self) -> Vec<(String, ClaudeSessionEndReason, bool)> {
        self.checks.lock().expect("checks lock").clone()
    }
}

impl ClaudeSessionEventSink for ReapCheckingEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        let pid = self
            .pids
            .lock()
            .expect("pids lock")
            .get(&(event.workspace_id.clone(), event.thread_id.clone()))
            .copied();
        let reaped = pid.is_some_and(|pid| !alive(pid));
        self.checks.lock().expect("checks lock").push((
            format!("{}/{}", event.workspace_id, event.thread_id),
            event.reason,
            reaped,
        ));
    }

    fn background_turn(&self, _event: ClaudeSessionBackgroundTurnEvent) {}

    fn background_tasks(&self, _event: ClaudeSessionBackgroundTasksEvent) {}
}

fn acquire_tracked(
    registry: &ClaudeSessionRegistry,
    cli: &FakeCli,
    events: &ReapCheckingEvents,
    request: &ClaudeSessionRequest,
    spawned_so_far: usize,
) -> Arc<ClaudeThreadSession> {
    let acquired = acquire(registry, cli, request).expect("acquire");
    assert!(acquired.spawned);
    let pid = *started_cli_pids(cli, spawned_so_far + 1)
        .last()
        .expect("new pid");
    events.track(&request.key.workspace_id, &request.key.thread_id, pid);
    let session = acquired.session.expect("session");
    settle(&session, "hello");
    session
}

#[test]
fn every_path_that_removes_a_session_reaps_its_process_first() {
    let cli = FakeCli::new("registry-reap-before-removal");
    let events = Arc::new(ReapCheckingEvents::default());
    let registry = Arc::new(ClaudeSessionRegistry::with_tuning(
        system_process_group_signals(),
        Arc::clone(&events) as Arc<dyn ClaudeSessionEventSink>,
        ClaudeSessionTuning {
            max_live_sessions: 2,
            ..ClaudeSessionTuning::default()
        },
    ));
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let request = |workspace: &str, thread: &str, resume: Option<&str>| {
        session_request(&cli, workspace, thread, resume, launch, policy)
    };
    let displaced = acquire_tracked(&registry, &cli, &events, &request("ws-a", "t1", None), 0);
    let restarted = acquire_tracked(&registry, &cli, &events, &request("ws-b", "t1", RESUME), 1);
    assert!(displaced.wait_reaped(Duration::ZERO));
    let evicted = acquire_tracked(&registry, &cli, &events, &request("ws-b", "t1", None), 2);
    assert!(restarted.wait_reaped(Duration::ZERO));
    thread::sleep(Duration::from_millis(20));
    let ended = acquire_tracked(&registry, &cli, &events, &request("ws-a", "t2", None), 3);
    thread::sleep(Duration::from_millis(20));
    let shut_down = acquire_tracked(&registry, &cli, &events, &request("ws-a", "t3", None), 4);
    assert!(evicted.wait_reaped(Duration::ZERO));
    assert!(registry.end_for_thread("ws-a", "t2", ClaudeSessionEndReason::ThreadEnded));
    assert!(ended.wait_reaped(Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 1));
    assert!(registry.shutdown_all());
    assert!(shut_down.wait_reaped(Duration::ZERO));
    assert_eq!(registry.live_sessions(), 0);
    assert_eq!(
        events.checks(),
        vec![
            (
                "ws-a/t1".to_string(),
                ClaudeSessionEndReason::Released,
                true
            ),
            (
                "ws-b/t1".to_string(),
                ClaudeSessionEndReason::Restarted,
                true
            ),
            ("ws-b/t1".to_string(), ClaudeSessionEndReason::Evicted, true),
            (
                "ws-a/t2".to_string(),
                ClaudeSessionEndReason::ThreadEnded,
                true
            ),
            (
                "ws-a/t3".to_string(),
                ClaudeSessionEndReason::Shutdown,
                true
            ),
        ]
    );

    let dropped_cli = FakeCli::new("registry-reap-before-drop");
    let (dropped_registry, dropped_events) = session_registry(ClaudeSessionTuning::default());
    let acquired = acquire(
        &dropped_registry,
        &dropped_cli,
        &session_request(&dropped_cli, "ws-a", "t9", None, launch, policy),
    )
    .expect("acquire before drop");
    let session = acquired.session.expect("session");
    settle(&session, "hello");
    let pid = started_cli_pids(&dropped_cli, 1)[0];
    let released = Arc::downgrade(&session);
    drop(session);
    drop(dropped_registry);
    assert!(wait_until(Duration::from_secs(5), || released
        .strong_count()
        == 0));
    assert!(
        !alive(pid),
        "the last owner released the session only after reaping"
    );
    assert!(dropped_events.reasons_for("t9").is_empty());
}

#[test]
fn retirement_between_reuse_and_attach_never_ends_the_leased_session() {
    let cli = FakeCli::new("registry-reuse-pinned");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        idle_ttl: Duration::from_millis(1),
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("first");
    let session = first.session.expect("session");
    settle(&session, "hello");
    let reused = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, launch, policy),
    )
    .expect("reuse");
    assert!(!reused.spawned);
    let reused = reused.session.expect("reused session");
    assert!(Arc::ptr_eq(&session, &reused));
    registry.retire_idle_for_update();
    registry.retire_idle(Instant::now() + Duration::from_secs(24 * 60 * 60));
    settle(&reused, "again");
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(cli.cli_pids().len(), 1);
    registry.retire_idle_for_update();
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for("t1")
        == vec![ClaudeSessionEndReason::ProviderUpdated]));
    assert!(registry.shutdown_all());
}

#[test]
fn a_fresh_session_is_neither_retired_nor_evicted_before_its_first_turn_attaches() {
    let cli = FakeCli::new("registry-fresh-pinned");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        idle_ttl: Duration::from_millis(1),
        max_live_sessions: 1,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let fresh = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, launch, policy),
    )
    .expect("fresh");
    assert!(fresh.spawned);
    let session = fresh.session.expect("session");
    registry.retire_idle_for_update();
    registry.retire_idle(Instant::now() + Duration::from_secs(24 * 60 * 60));
    let other = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t2", None, launch, policy),
    )
    .expect("other");
    assert!(other.session.is_none());
    settle(&session, "hello");
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(registry.shutdown_all());
}

#[test]
fn a_restart_request_never_ends_a_session_whose_lease_is_about_to_attach() {
    let cli = FakeCli::new("registry-restart-pinned");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let high = claude_launch(ClaudeEffortChoice::High);
    let low = claude_launch(ClaudeEffortChoice::Low);
    let first = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", None, high, policy),
    )
    .expect("first");
    let session = first.session.expect("session");
    settle(&session, "hello");
    let reused = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, high, policy),
    )
    .expect("reuse");
    let reused = reused.session.expect("reused session");
    let restart = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, low, policy),
    );
    assert_eq!(restart.err().as_deref(), Some(CLAUDE_SESSION_BUSY_ERROR));
    settle(&reused, "again");
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(cli.cli_pids().len(), 1);
    let restarted = acquire(
        &registry,
        &cli,
        &session_request(&cli, "ws-a", "t1", RESUME, low, policy),
    )
    .expect("restart once idle");
    assert!(restarted.spawned);
    assert_eq!(
        events.reasons_for("t1"),
        vec![ClaudeSessionEndReason::Restarted]
    );
    assert!(registry.shutdown_all());
}

#[test]
fn a_session_refused_at_insert_reports_no_ended_event() {
    let cli = FakeCli::new("registry-refused-insert");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let request = session_request(
        &cli,
        "ws-a",
        "t1",
        None,
        AgentLaunchOptions::default(),
        ClaudeSessionRestartPolicy::RefuseIfBackground,
    );
    let spawned_pid = AtomicUsize::new(0);
    let plan = cli.plan("sess-fixture-0001", "unused");
    let closing = Arc::clone(&registry);
    let refused = registry.acquire(&request, || {
        closing.close_admission();
        let spawned = spawn_bound_process(&plan, Stdio::piped())?;
        spawned_pid.store(spawned.0.id() as usize, Ordering::SeqCst);
        Ok(spawned)
    });
    assert_eq!(
        refused.err().as_deref(),
        Some(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR)
    );
    let pid = i32::try_from(spawned_pid.load(Ordering::SeqCst)).expect("pid");
    assert!(pid > 0);
    assert!(gone_within(pid, Duration::from_secs(5)));
    thread::sleep(Duration::from_millis(300));
    assert!(events.reasons_for("t1").is_empty());
    assert_eq!(registry.live_sessions(), 0);
    assert!(registry.shutdown_all());
}

#[test]
fn deleting_a_thread_ends_its_session_by_thread_id_under_the_canonical_root() {
    let cli = FakeCli::new("reap-deleted-thread");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let workspace = "ws-0123456789abcdef0123456789abcdef";
    let thread = "agt-1-0a1c";
    let acquired = acquire(
        &registry,
        &cli,
        &session_request(
            &cli,
            workspace,
            thread,
            None,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        ),
    )
    .expect("acquire");
    settle(acquired.session.as_ref().expect("session"), "hello");
    let foreign_root = cli.dir.join("elsewhere");
    assert!(!registry.end_for_thread_under_root(
        thread,
        &foreign_root,
        ClaudeSessionEndReason::ThreadEnded
    ));
    assert!(!registry.end_for_thread_under_root(
        "agt-9-0a1c",
        &cli.dir,
        ClaudeSessionEndReason::ThreadEnded
    ));
    thread::sleep(Duration::from_millis(100));
    assert!(events.reasons_for(thread).is_empty());
    let project_root = cli.dir.parent().expect("project root");
    assert!(registry.end_for_thread_under_root(
        thread,
        project_root,
        ClaudeSessionEndReason::ThreadEnded
    ));
    assert!(wait_until(Duration::from_secs(5), || events
        .reasons_for(thread)
        == vec![ClaudeSessionEndReason::ThreadEnded]));
    assert!(wait_until(Duration::from_secs(5), || registry
        .live_sessions()
        == 0));
}
