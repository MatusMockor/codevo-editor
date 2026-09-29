use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::agent_task_input::AgentTaskInputSlot;
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionEndReason, ClaudeSessionKey, ClaudeSessionTuning, SessionAvailability,
    CLAUDE_SESSION_BUSY_ERROR,
};
use agent_task_spawner::claude_session_router::ClaudeBackgroundTurn;
use agent_task_spawner::claude_session_turn::ClaudeSessionTurnChild;
use agent_task_spawner::claude_thread_session::{
    ClaudeSessionIdentity, ClaudeSessionOwner, ClaudeThreadSession, IdleTermination, TurnOutcome,
};
use agent_task_spawner::spawn_bound_process;
use agent_task_supervisor::system_process_group_signals;
use std::process::Stdio;
use std::sync::Weak;

const TURN_TIMEOUT: Duration = Duration::from_secs(10);
const REAP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct RecordingOwner {
    ended: Mutex<Vec<(ClaudeSessionEndReason, bool)>>,
    background: Mutex<Vec<(u64, ClaudeBackgroundTurn)>>,
}

impl ClaudeSessionOwner for RecordingOwner {
    fn session_ended(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        reason: ClaudeSessionEndReason,
        background_tasks_live: bool,
    ) {
        self.ended
            .lock()
            .expect("ended lock")
            .push((reason, background_tasks_live));
    }

    fn background_turn(
        &self,
        _key: &ClaudeSessionKey,
        generation: u64,
        turn: ClaudeBackgroundTurn,
    ) {
        self.background
            .lock()
            .expect("background lock")
            .push((generation, turn));
    }
}

impl RecordingOwner {
    fn reasons(&self) -> Vec<ClaudeSessionEndReason> {
        self.ended
            .lock()
            .expect("ended lock")
            .iter()
            .map(|(reason, _)| *reason)
            .collect()
    }

    fn ended(&self) -> Vec<(ClaudeSessionEndReason, bool)> {
        self.ended.lock().expect("ended lock").clone()
    }

    fn background_turns(&self) -> Vec<(u64, ClaudeBackgroundTurn)> {
        self.background.lock().expect("background lock").clone()
    }
}

struct CountingSignals {
    inner: Arc<dyn AgentProcessGroupSignalSender>,
    calls: AtomicU64,
}

impl CountingSignals {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: system_process_group_signals(),
            calls: AtomicU64::new(0),
        })
    }

    fn calls(&self) -> u64 {
        self.calls.load(Ordering::SeqCst)
    }
}

impl AgentProcessGroupSignalSender for CountingSignals {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner.send(process_group_id, signal)
    }

    fn send_after_observed_exit(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner
            .send_after_observed_exit(process_group_id, signal)
    }

    fn group_has_members_besides_leader(&self, process_group_id: i32) -> Option<bool> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner
            .group_has_members_besides_leader(process_group_id)
    }
}

fn start_session(
    cli: &FakeCli,
    owner: &Arc<RecordingOwner>,
    tuning: ClaudeSessionTuning,
) -> Arc<ClaudeThreadSession> {
    start_session_with(cli, owner, tuning, system_process_group_signals())
}

fn start_session_with(
    cli: &FakeCli,
    owner: &Arc<RecordingOwner>,
    tuning: ClaudeSessionTuning,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
) -> Arc<ClaudeThreadSession> {
    let plan = cli.plan("sess-fixture-0001", "unused");
    let spawned = spawn_bound_process(&plan, Stdio::piped()).expect("spawn fake cli");
    let weak: Weak<RecordingOwner> = Arc::downgrade(owner);
    let weak: Weak<dyn ClaudeSessionOwner> = weak;
    ClaudeThreadSession::start(
        ClaudeSessionIdentity {
            key: ClaudeSessionKey {
                workspace_id: "ws-agent-tests".to_string(),
                thread_id: "thread-a".to_string(),
            },
            generation: 1,
            fingerprint: cli.fingerprint(1, AgentLaunchOptions::default()),
            repository_root: cli.dir.clone(),
        },
        spawned,
        signals,
        tuning,
        weak,
    )
    .expect("session start")
}

pub(crate) fn drain(reader: &mut dyn Read, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut collected = Vec::new();
    let mut buffer = [0_u8; 4096];
    while Instant::now() < deadline {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => collected.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("turn reader failed: {error}"),
        }
    }
    String::from_utf8_lossy(&collected).into_owned()
}

pub(crate) fn read_until(reader: &mut dyn Read, needle: &str, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut collected = Vec::new();
    let mut buffer = [0_u8; 4096];
    while Instant::now() < deadline {
        if String::from_utf8_lossy(&collected).contains(needle) {
            break;
        }
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => collected.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("turn reader failed: {error}"),
        }
    }
    String::from_utf8_lossy(&collected).into_owned()
}

fn run_turn(session: &Arc<ClaudeThreadSession>, prompt: &str) -> (String, ClaudeSessionTurnChild) {
    let mut turn = session
        .attach_turn(&claude_user_frame(prompt, &[]))
        .expect("attach turn");
    let mut stdout = turn.stdout_reader().expect("turn stdout");
    let output = drain(stdout.as_mut(), TURN_TIMEOUT);
    (output, turn)
}

pub(crate) fn linger_native_background_task(session: &Arc<ClaudeThreadSession>) {
    let mut turn = session
        .attach_turn(&claude_user_frame("native-linger", &[]))
        .expect("attach native-linger");
    let mut stdout = turn.stdout_reader().expect("turn stdout");
    let mut input = turn.take_input().expect("turn input");
    let started = read_until(stdout.as_mut(), "still-working", TURN_TIMEOUT);
    assert!(started.contains("still-working"), "{started}");
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let rest = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(rest.contains("error_during_execution"), "{rest}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Interrupted));
    assert_eq!(session.background_tasks(), 1);
    assert_eq!(session.facts().availability, SessionAvailability::Idle);
}

#[test]
fn a_session_runs_two_turns_in_one_process_and_keeps_background_alive() {
    let cli = FakeCli::new("session-two-turns");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut first) = run_turn(&session, "spawn-background");
    assert!(output.contains("echo:spawn-background"), "{output}");
    assert!(first.observe_exit().expect("observe"));
    assert_eq!(first.reap(), Ok(0));
    assert_eq!(first.outcome(), Some(TurnOutcome::Settled));
    let background = cli.background_pid().expect("background pid");
    thread::sleep(Duration::from_millis(300));
    assert!(alive(background), "background process died at turn end");
    assert_eq!(
        session.background_tasks(),
        0,
        "a process group member is not a native background task"
    );
    let (output, mut second) = run_turn(&session, "hello");
    assert!(output.contains("echo:hello"), "{output}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(
        cli.cli_pids().len(),
        1,
        "the second turn must reuse the process"
    );
    assert!(alive(background));
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert!(gone_within(background, REAP_TIMEOUT));
    assert_eq!(
        owner.ended(),
        vec![(ClaudeSessionEndReason::Stopped, false)]
    );
}

#[test]
fn turn_output_carries_per_turn_cost_and_the_process_total() {
    let cli = FakeCli::new("session-cost");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (first, _) = run_turn(&session, "hello");
    let (second, _) = run_turn(&session, "again");
    let cost = |output: &str| -> (f64, f64) {
        let value = output
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|value| value["type"] == "result")
            .expect("result line");
        (
            value["total_cost_usd"].as_f64().expect("per-turn cost"),
            value["codevo_process_total_cost_usd"]
                .as_f64()
                .expect("process cost"),
        )
    };
    let (first_turn, first_total) = cost(&first);
    let (second_turn, second_total) = cost(&second);
    assert!((first_turn - 0.01).abs() < 1e-9, "{first}");
    assert!((second_turn - 0.01).abs() < 1e-9, "{second}");
    assert!((first_total - 0.01).abs() < 1e-9);
    assert!((second_total - 0.02).abs() < 1e-9);
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_settled_turn_refuses_later_frames_without_ending_the_session() {
    let cli = FakeCli::new("session-late-steer");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "hello");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    let mut input = turn.take_input().expect("turn input");
    let refused = input.write_frame(b"{}\n", Instant::now() + Duration::from_secs(1));
    assert_eq!(
        refused.map_err(|error| error.kind()),
        Err(io::ErrorKind::NotConnected)
    );
    let interrupt = input.interrupt(Instant::now() + Duration::from_secs(1));
    assert_eq!(
        interrupt.map_err(|error| error.kind()),
        Err(io::ErrorKind::WouldBlock)
    );
    input.close();
    let closed = input.write_frame(b"{}\n", Instant::now() + Duration::from_secs(1));
    assert_eq!(
        closed.map_err(|error| error.kind()),
        Err(io::ErrorKind::NotConnected)
    );
    let interrupt = input.interrupt(Instant::now() + Duration::from_secs(1));
    assert_eq!(
        interrupt.map_err(|error| error.kind()),
        Err(io::ErrorKind::WouldBlock)
    );
    thread::sleep(Duration::from_millis(100));
    assert!(owner.reasons().is_empty());
    assert!(alive(cli.cli_pids()[0]));
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn attaching_while_a_turn_runs_is_busy() {
    let cli = FakeCli::new("session-busy");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let _running = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("first attach");
    assert_eq!(
        session
            .attach_turn(&claude_user_frame("again", &[]))
            .err()
            .as_deref(),
        Some(CLAUDE_SESSION_BUSY_ERROR)
    );
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn interrupt_settles_the_turn_and_keeps_the_process() {
    let cli = FakeCli::new("session-interrupt");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "\"task_started\"", TURN_TIMEOUT);
    assert!(started.contains("\"task_started\""), "{started}");
    assert_eq!(
        session.background_tasks(),
        0,
        "a foreground Bash task is never background work"
    );
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let rest = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(rest.contains("error_during_execution"), "{rest}");
    assert_eq!(turn.reap(), Ok(0));
    assert_eq!(turn.outcome(), Some(TurnOutcome::Interrupted));
    assert_eq!(turn.settled_by_interrupt(), Some(true));
    let (output, mut next) = run_turn(&session, "after");
    assert!(output.contains("echo:after"), "{output}");
    assert_eq!(next.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn an_ignored_interrupt_is_bounded_and_ends_the_session() {
    let cli = FakeCli::new("session-interrupt-ignored");
    let owner = Arc::new(RecordingOwner::default());
    let tuning = ClaudeSessionTuning {
        interrupt_deadline: Duration::from_millis(300),
        ..ClaudeSessionTuning::default()
    };
    let session = start_session(&cli, &owner, tuning);
    let mut turn = session
        .attach_turn(&claude_user_frame("slow-ignore", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "\"task_started\"", TURN_TIMEOUT);
    assert!(started.contains("\"task_started\""), "{started}");
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let _ = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(matches!(
        turn.outcome(),
        Some(TurnOutcome::ProcessExited(_))
    ));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(
        owner.reasons(),
        vec![ClaudeSessionEndReason::InterruptTimedOut]
    );
}

#[test]
fn a_crash_mid_turn_reports_the_exit_code() {
    let cli = FakeCli::new("session-crash");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "crash");
    assert_eq!(turn.reap(), Ok(9));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Crashed]);
}

#[test]
fn idle_crash_is_reported_without_a_turn() {
    let cli = FakeCli::new("session-idle-crash");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "hello");
    assert_eq!(turn.reap(), Ok(0));
    let cli_pid = cli.cli_pids()[0];
    unsafe {
        libc::kill(cli_pid, libc::SIGKILL);
    }
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Crashed]);
    assert!(session
        .attach_turn(&claude_user_frame("again", &[]))
        .is_err());
}

#[test]
fn a_late_idle_permission_request_ends_the_session() {
    let cli = FakeCli::new("session-late-permission");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut turn) = run_turn(&session, "late-permission");
    assert_eq!(turn.reap(), Ok(0));
    assert!(!output.contains("perm-late-0001"), "{output}");
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(
        owner.reasons(),
        vec![ClaudeSessionEndReason::UnownedActivity]
    );
    assert!(owner.background_turns().is_empty());
}

#[test]
fn a_late_idle_unsupported_control_request_is_answered_and_the_session_survives() {
    let cli = FakeCli::new("session-late-unsupported");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut turn) = run_turn(&session, "late-unsupported");
    assert!(output.contains("echo:late-unsupported"), "{output}");
    assert_eq!(turn.reap(), Ok(0));
    assert!(wait_until(TURN_TIMEOUT, || cli
        .control_responses()
        .contains("hook-late-0000")));
    let responses = cli.control_responses();
    assert!(responses.contains("\"subtype\":\"error\""), "{responses}");
    assert!(
        responses.contains("This editor does not support this control request."),
        "{responses}"
    );
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    assert!(!session.is_ending());
    let (next, mut second) = run_turn(&session, "hello");
    assert!(next.contains("echo:hello"), "{next}");
    assert!(!next.contains("hook-late-0000"), "{next}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.background_turns().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_flood_of_idle_unsupported_control_requests_ends_the_session() {
    let cli = FakeCli::new("session-late-unsupported-flood");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "late-unsupported-flood");
    assert_eq!(turn.reap(), Ok(0));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(
        owner.reasons(),
        vec![ClaudeSessionEndReason::UnownedActivity]
    );
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[test]
fn a_native_background_task_settles_at_the_drain_and_its_wake_up_is_a_background_turn() {
    let cli = FakeCli::new("session-native-background");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("native-background", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let early = read_until(stdout.as_mut(), "\"is_backgrounded\": true", TURN_TIMEOUT);
    assert!(early.contains("\"is_backgrounded\": true"), "{early}");
    assert_eq!(session.background_tasks(), 1);
    let output = early + &drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(output.contains("\"task_updated\""), "{output}");
    assert!(!output.contains("background-finished"), "{output}");
    assert_eq!(turn.reap(), Ok(0));
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert!(wait_until(REAP_TIMEOUT, || !owner
        .background_turns()
        .is_empty()));
    thread::sleep(Duration::from_millis(100));
    let background = owner.background_turns();
    assert_eq!(background.len(), 1, "{background:?}");
    let (generation, recorded) = &background[0];
    assert_eq!(*generation, 1);
    assert!(recorded.complete);
    assert!(!recorded.truncated);
    let text = String::from_utf8_lossy(&recorded.output).into_owned();
    assert!(text.contains("background-finished"), "{text}");
    assert!(text.contains("\"codevo_process_total_cost_usd\""), "{text}");
    assert!(!text.contains("command_lifecycle"), "{text}");
    assert_eq!(session.background_tasks(), 0);
    let (next, mut second) = run_turn(&session, "hello");
    assert!(next.contains("echo:hello"), "{next}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_detached_bash_child_is_neither_counted_nor_stopped() {
    let cli = FakeCli::new("session-detached");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut turn) = run_turn(&session, "spawn-detached");
    assert!(output.contains("echo:spawn-detached"), "{output}");
    assert_eq!(turn.reap(), Ok(0));
    let detached = cli.detached_pid().expect("detached pid");
    assert!(alive(detached));
    assert_eq!(session.background_tasks(), 0);
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
    assert!(
        alive(detached),
        "a detached Bash child is outside our group"
    );
    assert_eq!(
        owner.ended(),
        vec![(ClaudeSessionEndReason::Stopped, false)]
    );
}

#[test]
fn a_hard_stop_while_attached_ends_the_turn_and_reports_once() {
    let cli = FakeCli::new("session-stop-while-attached");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let _ = read_until(stdout.as_mut(), "\"task_started\"", TURN_TIMEOUT);
    turn.force_kill().expect("force kill");
    let _ = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(matches!(
        turn.outcome(),
        Some(TurnOutcome::ProcessExited(_))
    ));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Stopped]);
    let cli_pid = cli.cli_pids()[0];
    drop(turn);
    drop(session);
    assert!(gone_within(cli_pid, REAP_TIMEOUT));
    assert_eq!(owner.reasons().len(), 1);
}

#[test]
fn stdout_closing_while_the_cli_lives_ends_the_session() {
    let cli = FakeCli::new("session-stdout-closed");
    let owner = Arc::new(RecordingOwner::default());
    let tuning = ClaudeSessionTuning {
        reader_drain: Duration::from_millis(200),
        ..ClaudeSessionTuning::default()
    };
    let session = start_session(&cli, &owner, tuning);
    let (output, turn) = run_turn(&session, "close-stdout");
    assert!(output.contains("echo:close-stdout"), "{output}");
    assert!(matches!(
        turn.outcome(),
        Some(TurnOutcome::ProcessExited(_))
    ));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::ProtocolError]);
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[test]
fn no_group_signal_or_probe_is_sent_after_the_leader_is_reaped() {
    let cli = FakeCli::new("session-no-signal-after-reap");
    let owner = Arc::new(RecordingOwner::default());
    let signals = CountingSignals::new();
    let session = start_session_with(
        &cli,
        &owner,
        ClaudeSessionTuning::default(),
        Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
    );
    let (_, _turn) = run_turn(&session, "hello");
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(REAP_TIMEOUT));
    let reaped_calls = signals.calls();
    assert!(reaped_calls > 0);
    session.terminate(ClaudeSessionEndReason::Released);
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert_eq!(session.background_tasks(), 0);
    drop(_turn);
    drop(session);
    assert_eq!(signals.calls(), reaped_calls);
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Stopped]);
}

#[test]
fn an_interrupt_leaves_native_background_tasks_live_and_the_end_reports_them() {
    let cli = FakeCli::new("session-native-linger");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    linger_native_background_task(&session);
    thread::sleep(Duration::from_millis(100));
    assert_eq!(session.background_tasks(), 1);
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(session.background_tasks(), 0);
    assert_eq!(owner.ended(), vec![(ClaudeSessionEndReason::Stopped, true)]);
}

#[test]
fn stopping_a_turn_that_only_awaits_native_background_tasks_settles_it_without_an_interrupt() {
    let cli = FakeCli::new("session-foreground-finished");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("native-held", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let early = read_until(stdout.as_mut(), "\"state\": \"completed\"", TURN_TIMEOUT);
    assert!(early.contains("\"state\": \"completed\""), "{early}");
    assert_eq!(
        turn.outcome(),
        None,
        "the turn still awaits its native task"
    );
    assert_eq!(session.background_tasks(), 1);
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("stop accepted");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(turn.settled_by_interrupt(), Some(false));
    assert_eq!(turn.reap(), Ok(0));
    let rest = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(!rest.contains("background-finished"), "{rest}");
    thread::sleep(Duration::from_millis(200));
    assert_eq!(
        cli.interrupts_received(),
        0,
        "no interrupt frame was written"
    );
    assert_eq!(
        session.background_tasks(),
        1,
        "the native task is inherited"
    );
    assert_eq!(session.facts().availability, SessionAvailability::Idle);
    assert!(owner.reasons().is_empty());
    cli.release_native_drain();
    assert!(wait_until(REAP_TIMEOUT, || owner.background_turns().len() == 1));
    let background = owner.background_turns();
    let text = String::from_utf8_lossy(&background[0].1.output).into_owned();
    assert!(text.contains("background-finished"), "{text}");
    assert!(background[0].1.complete);
    assert_eq!(session.background_tasks(), 0);
    let (next, mut second) = run_turn(&session, "hello");
    assert!(next.contains("echo:hello"), "{next}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn an_interrupt_racing_natural_settlement_is_refused_and_the_turn_settles() {
    let cli = FakeCli::new("session-interrupt-race");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("big-result", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    assert!(wait_until(TURN_TIMEOUT, || cli.big_result_written()));
    thread::sleep(Duration::from_millis(300));
    assert_eq!(
        turn.outcome(),
        None,
        "delivery is still blocked on the full channel"
    );
    let refused = input.interrupt(Instant::now() + Duration::from_secs(1));
    assert_eq!(
        refused.map_err(|error| error.kind()),
        Err(io::ErrorKind::WouldBlock)
    );
    let output = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(output.contains("\"result\""));
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    thread::sleep(Duration::from_millis(200));
    assert_eq!(cli.interrupts_received(), 0, "no stray interrupt frame");
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn stdout_outliving_the_cli_never_reports_after_the_session_is_dead() {
    let cli = FakeCli::new("session-orphan-stdout");
    let owner = Arc::new(RecordingOwner::default());
    let tuning = ClaudeSessionTuning {
        reader_drain: Duration::from_millis(200),
        ..ClaudeSessionTuning::default()
    };
    let session = start_session(&cli, &owner, tuning);
    let (output, mut turn) = run_turn(&session, "orphan-stdout");
    assert!(output.contains("echo:orphan-stdout"), "{output}");
    assert_eq!(turn.reap(), Ok(0));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    let orphan = cli.detached_pid().expect("orphan pid");
    assert!(alive(orphan), "the orphan keeps stdout open past the death");
    thread::sleep(Duration::from_millis(300));
    assert_eq!(owner.ended(), vec![(ClaudeSessionEndReason::Exited, false)]);
    assert!(
        owner.background_turns().is_empty(),
        "{:?}",
        owner.background_turns()
    );
    let facts = session.facts();
    assert_eq!(facts.availability, SessionAvailability::Ending);
}

#[test]
fn a_protocol_failure_ends_the_session_before_the_turn_reports_failed() {
    let cli = FakeCli::new("session-protocol-failure");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let turn = session
        .attach_turn(&claude_user_frame("oversized-frame", &[]))
        .expect("attach");
    assert!(wait_until(TURN_TIMEOUT, || turn.outcome().is_some()));
    assert!(matches!(turn.outcome(), Some(TurnOutcome::Failed(_))));
    assert_eq!(session.facts().availability, SessionAvailability::Ending);
    assert!(session
        .attach_turn(&claude_user_frame("again", &[]))
        .is_err());
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::ProtocolError]);
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[derive(Default)]
struct PanickingOwner {
    ended: AtomicU64,
}

impl ClaudeSessionOwner for PanickingOwner {
    fn session_ended(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        _reason: ClaudeSessionEndReason,
        _background_tasks_live: bool,
    ) {
        self.ended.fetch_add(1, Ordering::SeqCst);
        panic!("owner panicked while recording the end");
    }

    fn background_turn(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        _turn: ClaudeBackgroundTurn,
    ) {
    }
}

#[test]
fn a_panicking_owner_still_gets_exactly_one_end_report_and_waiters_wake() {
    let cli = FakeCli::new("session-panicking-owner");
    let owner = Arc::new(PanickingOwner::default());
    let plan = cli.plan("sess-fixture-0001", "unused");
    let spawned = spawn_bound_process(&plan, Stdio::piped()).expect("spawn fake cli");
    let weak: Weak<PanickingOwner> = Arc::downgrade(&owner);
    let weak: Weak<dyn ClaudeSessionOwner> = weak;
    let session = ClaudeThreadSession::start(
        ClaudeSessionIdentity {
            key: ClaudeSessionKey {
                workspace_id: "ws-agent-tests".to_string(),
                thread_id: "thread-panicking".to_string(),
            },
            generation: 1,
            fingerprint: cli.fingerprint(1, AgentLaunchOptions::default()),
            repository_root: cli.dir.clone(),
        },
        spawned,
        system_process_group_signals(),
        ClaudeSessionTuning::default(),
        weak,
    )
    .expect("session start");
    assert!(wait_until(REAP_TIMEOUT, || !cli.cli_pids().is_empty()));
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(REAP_TIMEOUT));
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    thread::sleep(Duration::from_millis(100));
    assert_eq!(owner.ended.load(Ordering::SeqCst), 1);
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[test]
fn terminate_if_idle_ends_only_an_idle_session() {
    let cli = FakeCli::new("session-terminate-if-idle");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let _ = read_until(stdout.as_mut(), "\"task_started\"", TURN_TIMEOUT);
    assert!(!session.terminate_if_idle(ClaudeSessionEndReason::IdleTimeout));
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let _ = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert_eq!(turn.outcome(), Some(TurnOutcome::Interrupted));
    assert!(owner.reasons().is_empty(), "an attached session survives");
    assert!(session.terminate_if_idle(ClaudeSessionEndReason::IdleTimeout));
    assert!(!session.terminate_if_idle(ClaudeSessionEndReason::ProviderUpdated));
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert!(!session.terminate_if_idle(ClaudeSessionEndReason::ProviderUpdated));
    assert_eq!(
        owner.ended(),
        vec![(ClaudeSessionEndReason::IdleTimeout, false)]
    );
}

#[test]
fn an_interrupt_that_loses_to_natural_completion_settles_as_settled() {
    let cli = FakeCli::new("session-interrupt-loses");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow-finish", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "\"task_started\"", TURN_TIMEOUT);
    assert!(started.contains("\"task_started\""), "{started}");
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let rest = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(rest.contains("finished-before-interrupt"), "{rest}");
    assert!(!rest.contains("error_during_execution"), "{rest}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(turn.settled_by_interrupt(), Some(false));
    assert_eq!(turn.reap(), Ok(0));
    let (output, mut next) = run_turn(&session, "after");
    assert!(output.contains("echo:after"), "{output}");
    assert_eq!(next.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn an_interrupt_queued_behind_stdin_never_reaches_the_next_turn() {
    let cli = FakeCli::new("session-interrupt-order");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("stall-stdin", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "echo:stall-stdin", TURN_TIMEOUT);
    assert!(started.contains("echo:stall-stdin"), "{started}");
    let mut pad = serde_json::to_vec(&serde_json::json!({
        "type": "keep_alive",
        "pad": "x".repeat(1024 * 1024)
    }))
    .expect("pad frame");
    pad.push(b'\n');
    let steering = Arc::clone(&session);
    let steer = thread::spawn(move || {
        steering.write_turn_frame(1, &pad, Instant::now() + Duration::from_secs(10))
    });
    thread::sleep(Duration::from_millis(200));
    let interrupt = thread::spawn(move || {
        input
            .interrupt(Instant::now() + Duration::from_secs(10))
            .map_err(|error| error.kind())
    });
    thread::sleep(Duration::from_millis(200));
    fs::write(cli.dir.join("release-result"), b"").expect("release result");
    let settled = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(settled.contains("\"result\""), "{settled}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    let mut next = session
        .attach_turn(&claude_user_frame("after", &[]))
        .expect("attach next");
    let mut next_stdout = next.stdout_reader().expect("next stdout");
    thread::sleep(Duration::from_millis(100));
    fs::write(cli.dir.join("release-stdin"), b"").expect("release stdin");
    assert!(steer.join().expect("steer thread").is_ok());
    assert_eq!(
        interrupt.join().expect("interrupt thread"),
        Err(io::ErrorKind::WouldBlock)
    );
    let output = drain(next_stdout.as_mut(), TURN_TIMEOUT);
    assert!(output.contains("echo:after"), "{output}");
    assert_eq!(next.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(cli.interrupts_received(), 0, "no stray interrupt frame");
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_permission_request_inside_a_background_turn_is_denied_and_the_session_survives() {
    let cli = FakeCli::new("session-background-permission");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut turn) = run_turn(&session, "native-background-permission");
    assert!(!output.contains("perm-bg-0001"), "{output}");
    assert_eq!(turn.reap(), Ok(0));
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert!(wait_until(TURN_TIMEOUT, || !owner
        .background_turns()
        .is_empty()));
    let responses = cli.control_responses();
    assert!(responses.contains("perm-bg-0001"), "{responses}");
    assert!(responses.contains("\"behavior\":\"deny\""), "{responses}");
    assert!(
        responses.contains("Codevo cannot ask for permission during a background turn."),
        "{responses}"
    );
    let background = owner.background_turns();
    assert_eq!(background.len(), 1, "{background:?}");
    let (_, recorded) = &background[0];
    assert!(recorded.complete);
    let text = String::from_utf8_lossy(&recorded.output).into_owned();
    assert!(text.contains("perm-bg-0001"), "{text}");
    assert!(text.contains("background-finished"), "{text}");
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    let (next, mut second) = run_turn(&session, "hello");
    assert!(next.contains("echo:hello"), "{next}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_restart_consent_check_is_atomic_with_idle_termination() {
    let cli = FakeCli::new("session-atomic-consent");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    linger_native_background_task(&session);
    assert_eq!(
        session.terminate_if_idle_without_background_tasks(ClaudeSessionEndReason::Restarted),
        IdleTermination::BackgroundTasks
    );
    assert!(!session.is_ending());
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));

    let cli = FakeCli::new("session-atomic-consent-idle");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "hello");
    assert_eq!(turn.reap(), Ok(0));
    assert_eq!(
        session.terminate_if_idle_without_background_tasks(ClaudeSessionEndReason::Restarted),
        IdleTermination::Requested
    );
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Restarted]);
}

fn stdin_closed_turn(
    cli: &FakeCli,
    session: &Arc<ClaudeThreadSession>,
) -> (ClaudeSessionTurnChild, Box<dyn AgentTaskInput>) {
    let mut turn = session
        .attach_turn(&claude_user_frame("close-stdin", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "echo:close-stdin", TURN_TIMEOUT);
    assert!(started.contains("echo:close-stdin"), "{started}");
    assert!(wait_until(TURN_TIMEOUT, || cli.stdin_closed()));
    (turn, input)
}

fn assert_input_failure_ended_the_session(
    cli: &FakeCli,
    owner: &RecordingOwner,
    session: &Arc<ClaudeThreadSession>,
    turn: &ClaudeSessionTurnChild,
) {
    assert!(wait_until(TURN_TIMEOUT, || turn.outcome().is_some()));
    assert_eq!(
        turn.outcome(),
        Some(TurnOutcome::Failed("Claude session input failed."))
    );
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::InputFailed]);
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[test]
fn a_broken_stdin_during_a_steer_fails_the_turn_and_ends_the_session() {
    let cli = FakeCli::new("session-broken-steer");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (turn, mut input) = stdin_closed_turn(&cli, &session);
    let written = input.write_frame(
        &claude_user_frame("after", &[]),
        Instant::now() + Duration::from_secs(2),
    );
    assert!(written.is_err());
    assert_input_failure_ended_the_session(&cli, &owner, &session, &turn);
}

#[test]
fn a_broken_stdin_during_an_interrupt_fails_the_turn_and_ends_the_session() {
    let cli = FakeCli::new("session-broken-interrupt");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (turn, mut input) = stdin_closed_turn(&cli, &session);
    let interrupted = input.interrupt(Instant::now() + Duration::from_secs(2));
    assert!(
        interrupted
            .as_ref()
            .is_err_and(|error| error.kind() != io::ErrorKind::WouldBlock),
        "{interrupted:?}"
    );
    assert_input_failure_ended_the_session(&cli, &owner, &session, &turn);
}

#[test]
fn an_interrupt_behind_a_stalled_writer_is_unavailable_within_its_deadline() {
    let cli = FakeCli::new("session-interrupt-stalled");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("stall-stdin", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "echo:stall-stdin", TURN_TIMEOUT);
    assert!(started.contains("echo:stall-stdin"), "{started}");
    let mut pad = serde_json::to_vec(&serde_json::json!({
        "type": "keep_alive",
        "pad": "x".repeat(1024 * 1024)
    }))
    .expect("pad frame");
    pad.push(b'\n');
    let steering = Arc::clone(&session);
    let steer = thread::spawn(move || {
        steering.write_turn_frame(1, &pad, Instant::now() + Duration::from_secs(20))
    });
    thread::sleep(Duration::from_millis(200));
    let asked = Instant::now();
    let interrupted = input
        .interrupt(Instant::now() + Duration::from_millis(300))
        .map_err(|error| error.kind());
    assert_eq!(interrupted, Err(io::ErrorKind::WouldBlock));
    assert!(
        asked.elapsed() < Duration::from_secs(2),
        "{:?}",
        asked.elapsed()
    );
    fs::write(cli.dir.join("release-result"), b"").expect("release result");
    let settled = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(settled.contains("\"result\""), "{settled}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    fs::write(cli.dir.join("release-stdin"), b"").expect("release stdin");
    assert!(steer.join().expect("steer thread").is_ok());
    assert_eq!(cli.interrupts_received(), 0);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

fn stdin_pad() -> Vec<u8> {
    let mut pad = serde_json::to_vec(&serde_json::json!({
        "type": "keep_alive",
        "pad": "x".repeat(1024 * 1024)
    }))
    .expect("pad frame");
    pad.push(b'\n');
    pad
}

#[test]
fn an_interrupt_that_cannot_reach_stdin_is_withdrawn_and_the_turn_settles_normally() {
    let cli = FakeCli::new("session-interrupt-withdrawn");
    let owner = Arc::new(RecordingOwner::default());
    let tuning = ClaudeSessionTuning {
        interrupt_deadline: Duration::from_millis(400),
        ..ClaudeSessionTuning::default()
    };
    let session = start_session(&cli, &owner, tuning);
    let mut turn = session
        .attach_turn(&claude_user_frame("stall-stdin", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let started = read_until(stdout.as_mut(), "echo:stall-stdin", TURN_TIMEOUT);
    assert!(started.contains("echo:stall-stdin"), "{started}");
    let pad = stdin_pad();
    let responding = Arc::clone(&session);
    let control = thread::spawn(move || {
        responding.write_control_frame(1, &pad, Instant::now() + Duration::from_secs(20))
    });
    thread::sleep(Duration::from_millis(200));
    let interrupted = input
        .interrupt(Instant::now() + Duration::from_millis(200))
        .map_err(|error| error.kind());
    assert_eq!(interrupted, Err(io::ErrorKind::WouldBlock));
    thread::sleep(Duration::from_millis(800));
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    assert!(!session.is_ending());
    fs::write(cli.dir.join("release-result"), b"").expect("release result");
    let settled = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(settled.contains("\"result\""), "{settled}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    fs::write(cli.dir.join("release-stdin"), b"").expect("release stdin");
    assert!(control.join().expect("control thread").is_ok());
    let (next, mut after) = run_turn(&session, "after");
    assert!(next.contains("echo:after"), "{next}");
    assert_eq!(after.reap(), Ok(0));
    assert_eq!(cli.interrupts_received(), 0);
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_steer_reserved_after_an_interrupt_is_stopping_and_the_interrupt_settles() {
    let cli = FakeCli::new("session-steer-after-interrupt");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow-held", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let slot = AgentTaskInputSlot::new(turn.take_input().expect("input"), None);
    let started = read_until(stdout.as_mut(), "echo:slow-held", TURN_TIMEOUT);
    assert!(started.contains("echo:slow-held"), "{started}");
    assert!(slot
        .interrupt(Instant::now() + Duration::from_secs(2))
        .is_ok());
    let steered = slot.write(
        &claude_user_frame("after-interrupt", &[]),
        Instant::now() + Duration::from_secs(2),
        MAX_AGENT_STEERS_PER_TURN,
    );
    assert_eq!(steered, Err(AgentTaskSteerRejection::Stopping));
    fs::write(cli.dir.join("release-interrupt"), b"").expect("release interrupt");
    let rest = drain(stdout.as_mut(), TURN_TIMEOUT);
    assert!(rest.contains("error_during_execution"), "{rest}");
    assert!(!rest.contains("echo:after-interrupt"), "{rest}");
    assert_eq!(turn.outcome(), Some(TurnOutcome::Interrupted));
    assert_eq!(cli.interrupts_received(), 1);
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn a_malformed_control_frame_ends_the_session_as_a_protocol_error() {
    let cli = FakeCli::new("session-malformed-control");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("malformed-control", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let seen = read_until(stdout.as_mut(), "bad-0001", TURN_TIMEOUT);
    assert!(seen.contains("bad-0001"), "{seen}");
    assert!(turn.observe_exit().is_err());
    turn.force_kill().expect("force kill");
    assert!(session.wait_reaped(REAP_TIMEOUT));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::ProtocolError]);
    assert!(gone_within(cli.cli_pids()[0], REAP_TIMEOUT));
}

#[test]
fn a_cancelled_command_fails_its_turn_and_keeps_the_session() {
    let cli = FakeCli::new("session-cancelled-command");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut first) = run_turn(&session, "hello");
    assert_eq!(first.reap(), Ok(0));
    let (_, mut cancelled) = run_turn(&session, "cancel-queued");
    assert_eq!(
        cancelled.outcome(),
        Some(TurnOutcome::Failed("Claude cancelled this message."))
    );
    assert_eq!(
        cancelled.reap(),
        Err("Claude cancelled this message.".to_string())
    );
    cancelled.force_kill().expect("late force kill");
    first.force_kill().expect("late force kill");
    thread::sleep(Duration::from_millis(200));
    assert!(owner.reasons().is_empty(), "{:?}", owner.reasons());
    assert_eq!(session.facts().availability, SessionAvailability::Idle);
    let (next, mut after) = run_turn(&session, "after");
    assert!(next.contains("echo:after"), "{next}");
    assert_eq!(after.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}

#[test]
fn an_error_result_settles_the_turn_as_a_failing_exit_and_keeps_the_session() {
    let cli = FakeCli::new("session-error-result");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut failed) = run_turn(&session, "error-result");
    assert!(output.contains("error_max_turns"), "{output}");
    assert_eq!(failed.reap(), Ok(1));
    assert_eq!(failed.settled_by_interrupt(), Some(false));
    failed.force_kill().expect("late force kill");
    let (next, mut after) = run_turn(&session, "after");
    assert!(next.contains("echo:after"), "{next}");
    assert_eq!(after.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(REAP_TIMEOUT));
}
