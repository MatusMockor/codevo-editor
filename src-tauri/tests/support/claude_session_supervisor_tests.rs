use super::claude_session_registry_tests::{
    session_registry, session_request, RecordingSessionEvents,
};
use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionEndReason, ClaudeSessionInspection, ClaudeSessionRestartPolicy,
    ClaudeSessionTuning,
};
use agent_task_spawner::claude_session_registry::ClaudeSessionRegistry;
use agent_task_spawner::claude_session_turn::ClaudeSessionTurnPlan;
use agent_task_supervisor::agent_task_interrupt::AgentTaskInterruptOutcome;

const WORKSPACE: &str = "ws-agent-tests";
const THREAD: &str = "thread-a";
const RESUME: Option<&str> = Some("sess-fixture-0001");
const TERMINAL_DEADLINE: Duration = Duration::from_secs(15);
const PROCESS_DEADLINE: Duration = Duration::from_secs(5);

struct SessionHarness {
    tasks: AgentTaskRegistry,
    sessions: Arc<ClaudeSessionRegistry>,
    events: Arc<RecordingSessionEvents>,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    task_signals: Option<Arc<RecordingSignalSender>>,
    cli: FakeCli,
}

impl SessionHarness {
    fn new(label: &str, tuning: ClaudeSessionTuning) -> Self {
        let admission = Arc::new(AgentTaskAdmissionRegistry::new());
        let sink = Arc::new(RecordingSink::default());
        let tasks = AgentTaskRegistry::new(
            Arc::clone(&admission),
            Arc::new(StdAgentProcessSpawner),
            Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        );
        Self::assemble(label, tuning, tasks, admission, sink, None)
    }

    fn recording(label: &str) -> Self {
        let admission = Arc::new(AgentTaskAdmissionRegistry::new());
        let sink = Arc::new(RecordingSink::default());
        let signals = Arc::new(RecordingSignalSender::default());
        let tasks = AgentTaskRegistry::with_dependencies(
            Arc::clone(&admission),
            Arc::new(StdAgentProcessSpawner),
            Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
            Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
            Duration::from_secs(120),
            Duration::from_millis(500),
            Duration::from_millis(500),
        );
        Self::assemble(
            label,
            ClaudeSessionTuning::default(),
            tasks,
            admission,
            sink,
            Some(signals),
        )
    }

    fn assemble(
        label: &str,
        tuning: ClaudeSessionTuning,
        tasks: AgentTaskRegistry,
        admission: Arc<AgentTaskAdmissionRegistry>,
        sink: Arc<RecordingSink>,
        task_signals: Option<Arc<RecordingSignalSender>>,
    ) -> Self {
        let (sessions, events) = session_registry(tuning);
        Self {
            tasks,
            sessions,
            events,
            admission,
            sink,
            task_signals,
            cli: FakeCli::new(label),
        }
    }

    fn session_plan(
        &self,
        thread_id: &str,
        prompt: &str,
        resume: Option<&str>,
    ) -> AgentTaskSpawnPlan {
        let request = session_request(
            &self.cli,
            WORKSPACE,
            thread_id,
            resume,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        );
        self.cli
            .plan("sess-fixture-0001", prompt)
            .with_claude_session(ClaudeSessionTurnPlan::new(
                Arc::clone(&self.sessions),
                request,
                Arc::new(|| Ok(())),
            ))
    }

    fn start_turn(
        &self,
        task_id: &str,
        thread_id: &str,
        prompt: &str,
        resume: Option<&str>,
    ) -> Result<(), String> {
        self.start_plan(
            task_id,
            thread_id,
            self.session_plan(thread_id, prompt, resume),
        )
    }

    fn start_legacy_turn(&self, task_id: &str, prompt: &str) -> Result<(), String> {
        self.start_plan(task_id, THREAD, self.cli.plan("sess-fixture-0001", prompt))
    }

    fn start_plan(
        &self,
        task_id: &str,
        thread_id: &str,
        plan: AgentTaskSpawnPlan,
    ) -> Result<(), String> {
        let admission = self
            .admission
            .reserve(
                &workspace(WORKSPACE),
                &self.cli.dir,
                &self.cli.dir,
                AgentTaskIsolation::InPlace,
            )
            .expect("admission");
        self.tasks.start(
            AgentTaskStartRequest {
                task_id: task_id.to_string(),
                thread_id: thread_id.to_string(),
                workspace_id: WORKSPACE.to_string(),
                repository_root: self.cli.dir.clone(),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
            },
            plan,
            admission,
        )?;
        self.tasks.acknowledge(task_id)
    }

    fn terminal(&self, task_id: &str) -> AgentTaskStatusPayload {
        assert!(
            wait_until(TERMINAL_DEADLINE, || self.sink.has_terminal_status(task_id)),
            "{task_id} never reached a terminal status"
        );
        statuses_for(&self.sink, task_id)
            .last()
            .map(|event| event.status.clone())
            .expect("terminal status")
    }

    fn is_terminal(&self, task_id: &str) -> bool {
        self.sink.has_terminal_status(task_id)
    }

    fn stdout(&self, task_id: &str) -> String {
        outputs_for(&self.sink, task_id)
            .iter()
            .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
            .map(|event| event.chunk.as_str())
            .collect()
    }

    fn await_stdout(&self, task_id: &str, needle: &str) {
        assert!(
            wait_until(PROCESS_DEADLINE, || self.stdout(task_id).contains(needle)),
            "{task_id} never printed {needle}: {}",
            self.stdout(task_id)
        );
    }

    fn settle_with_background(&self, task_id: &str) -> i32 {
        self.start_turn(task_id, THREAD, "spawn-background", None)
            .expect("background turn");
        assert!(matches!(
            self.terminal(task_id),
            AgentTaskStatusPayload::Exited { exit_code: 0 }
        ));
        self.cli.background_pid().expect("background pid")
    }

    fn native_background_tasks_live(&self) -> bool {
        let inspection =
            self.sessions
                .inspect(WORKSPACE, THREAD, &AgentLaunchOptions::default(), RESUME, 1);
        matches!(
            inspection,
            ClaudeSessionInspection::Reuse {
                background_tasks: true
            } | ClaudeSessionInspection::Restart {
                background_tasks: true
            }
        )
    }

    fn assert_no_task_group_signals(&self) {
        let signals = self
            .task_signals
            .as_ref()
            .expect("recording harness")
            .signals();
        assert!(
            signals.is_empty(),
            "the supervisor signalled an OS process group for a shared-session turn: {signals:?}"
        );
    }
}

impl Drop for SessionHarness {
    fn drop(&mut self) {
        self.sessions.shutdown_all();
        self.tasks.shutdown_all();
    }
}

fn result_texts(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|message| message.get("type").and_then(serde_json::Value::as_str) == Some("result"))
        .filter_map(|message| {
            message
                .get("result")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn last_line(stdout: &str) -> &str {
    stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
}

fn processes_mentioning(marker: &str) -> Vec<String> {
    let listing = std::process::Command::new("/bin/ps")
        .args(["-ww", "-Ao", "pid=,command="])
        .output()
        .expect("process listing");
    String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter(|line| line.contains(marker))
        .map(str::to_string)
        .collect()
}

fn cli_pid(harness: &SessionHarness) -> i32 {
    assert!(wait_until(PROCESS_DEADLINE, || !harness
        .cli
        .cli_pids()
        .is_empty()));
    harness.cli.cli_pids()[0]
}

#[test]
fn interrupt_outcomes_serialize_to_the_pinned_wire_shape() {
    assert_wire(
        &AgentTaskInterruptOutcome::Interrupting,
        r#"{"kind":"interrupting"}"#,
    );
    assert_wire(
        &AgentTaskInterruptOutcome::Unsupported,
        r#"{"kind":"unsupported"}"#,
    );
    assert_wire(
        &AgentTaskInterruptOutcome::Unavailable,
        r#"{"kind":"unavailable"}"#,
    );
    assert_wire(
        &AgentTaskInterruptOutcome::Stopping,
        r#"{"kind":"stopping"}"#,
    );
}

#[test]
fn background_process_survives_turn_end_and_next_turn_reuses_the_process() {
    let harness = SessionHarness::recording("supervised-survival");
    let background = harness.settle_with_background("agt-sess-1");
    thread::sleep(Duration::from_millis(500));
    assert!(
        alive(background),
        "the turn end killed the agent's background process"
    );
    harness
        .start_turn("agt-sess-2", THREAD, "hello", RESUME)
        .expect("turn 2");
    assert!(matches!(
        harness.terminal("agt-sess-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert!(harness.stdout("agt-sess-2").contains("echo:hello"));
    assert_eq!(
        harness.cli.cli_pids().len(),
        1,
        "turn 2 must run in the same CLI process"
    );
    assert!(alive(background));
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn a_native_background_turn_stays_running_until_the_drain_and_the_reply_is_a_background_turn() {
    let harness = SessionHarness::recording("supervised-native-background");
    harness
        .start_turn("agt-native-1", THREAD, "native-background", None)
        .expect("native background turn");
    assert!(matches!(
        harness.terminal("agt-native-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    let stdout = harness.stdout("agt-native-1");
    assert!(stdout.contains("echo:native-background"), "{stdout}");
    assert_eq!(
        result_texts(&stdout),
        vec!["started".to_string()],
        "{stdout}"
    );
    assert!(
        last_line(&stdout).contains("\"task_updated\""),
        "the turn must stay attached until the background task drains: {stdout}"
    );
    assert!(!stdout.contains("background-finished"), "{stdout}");
    assert!(
        wait_until(PROCESS_DEADLINE, || harness
            .events
            .background_turns_for(THREAD)
            .len()
            == 1),
        "expected one background turn, saw {:?}",
        harness.events.background_turns_for(THREAD)
    );
    let background = harness.events.background_turns_for(THREAD);
    assert!(background[0].output.contains("background-finished"));
    assert!(background[0].complete);
    assert!(!background[0].truncated);
    let pid = cli_pid(&harness);
    harness
        .start_turn("agt-native-2", THREAD, "hello", RESUME)
        .expect("turn 2");
    assert!(matches!(
        harness.terminal("agt-native-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert!(harness.stdout("agt-native-2").contains("echo:hello"));
    assert!(!harness
        .stdout("agt-native-2")
        .contains("background-finished"));
    assert_eq!(harness.cli.cli_pids(), vec![pid]);
    assert_eq!(harness.events.background_turns_for(THREAD).len(), 1);
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn first_stop_interrupts_the_foreground_and_keeps_background_work() {
    let harness = SessionHarness::recording("supervised-interrupt");
    let background = harness.settle_with_background("agt-int-1");
    harness
        .start_turn("agt-int-2", THREAD, "slow", RESUME)
        .expect("slow turn");
    harness.await_stdout("agt-int-2", "echo:slow");
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-int-2", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert!(matches!(
        harness.terminal("agt-int-2"),
        AgentTaskStatusPayload::Stopped
    ));
    assert!(harness
        .stdout("agt-int-2")
        .contains("error_during_execution"));
    assert_eq!(harness.cli.interrupts_received(), 1);
    assert!(alive(background));
    let pid = cli_pid(&harness);
    assert!(alive(pid));
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness
        .start_turn("agt-int-3", THREAD, "hello", RESUME)
        .expect("turn after the interrupt");
    assert!(matches!(
        harness.terminal("agt-int-3"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.cli_pids(), vec![pid]);
    harness.assert_no_task_group_signals();
}

#[test]
fn first_stop_keeps_native_background_tasks_live_in_the_session() {
    let harness = SessionHarness::recording("supervised-interrupt-native");
    harness
        .start_turn("agt-linger-1", THREAD, "native-linger", None)
        .expect("lingering turn");
    harness.await_stdout("agt-linger-1", "still-working");
    assert!(harness.native_background_tasks_live());
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-linger-1", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert!(matches!(
        harness.terminal("agt-linger-1"),
        AgentTaskStatusPayload::Stopped
    ));
    assert!(
        harness.native_background_tasks_live(),
        "an interrupt must leave native background tasks running"
    );
    assert!(alive(cli_pid(&harness)));
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn stopping_a_turn_that_only_awaits_native_background_tasks_reports_it_as_exited() {
    let harness = SessionHarness::recording("supervised-foreground-finished");
    harness
        .start_turn("agt-held-1", THREAD, "native-held", None)
        .expect("held turn");
    harness.await_stdout("agt-held-1", "\"state\": \"completed\"");
    assert!(harness.native_background_tasks_live());
    assert!(!harness.is_terminal("agt-held-1"));
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-held-1", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert!(matches!(
        harness.terminal("agt-held-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.interrupts_received(), 0);
    assert!(
        harness.native_background_tasks_live(),
        "the native task is inherited by the session"
    );
    let pid = cli_pid(&harness);
    assert!(alive(pid));
    harness.cli.release_native_drain();
    assert!(
        wait_until(PROCESS_DEADLINE, || harness
            .events
            .background_turns_for(THREAD)
            .len()
            == 1),
        "expected one background turn, saw {:?}",
        harness.events.background_turns_for(THREAD)
    );
    assert!(harness.events.background_turns_for(THREAD)[0]
        .output
        .contains("background-finished"));
    assert_eq!(harness.cli.cli_pids(), vec![pid]);
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn second_stop_ends_the_session_and_its_background_work() {
    let harness = SessionHarness::recording("supervised-second-stop");
    let background = harness.settle_with_background("agt-stop-1");
    harness
        .start_turn("agt-stop-2", THREAD, "slow-ignore", RESUME)
        .expect("slow turn");
    harness.await_stdout("agt-stop-2", "echo:slow-ignore");
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-stop-2", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-stop-2", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting,
        "a repeated interrupt is idempotent"
    );
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .cli
        .interrupts_received()
        == 1));
    assert_eq!(
        harness.tasks.steer_for_workspace(
            "agt-stop-2",
            WORKSPACE,
            Arc::from(claude_user_frame("while interrupting", &[]).as_slice()),
        ),
        Err(AgentTaskSteerRejection::Stopping)
    );
    assert!(!harness.is_terminal("agt-stop-2"));
    let pid = cli_pid(&harness);
    harness
        .tasks
        .stop_for_workspace("agt-stop-2", WORKSPACE)
        .expect("hard stop");
    assert!(matches!(
        harness.terminal("agt-stop-2"),
        AgentTaskStatusPayload::Stopped
    ));
    assert!(gone_within(background, PROCESS_DEADLINE));
    assert!(gone_within(pid, PROCESS_DEADLINE));
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .events
        .reasons_for(THREAD)
        == vec![ClaudeSessionEndReason::Stopped]));
    harness.assert_no_task_group_signals();
}

#[test]
fn a_hard_stop_ends_the_session_and_reports_live_native_background_tasks() {
    let harness = SessionHarness::recording("supervised-hard-stop");
    harness
        .start_turn("agt-hard-1", THREAD, "native-linger", None)
        .expect("lingering turn");
    harness.await_stdout("agt-hard-1", "still-working");
    let pid = cli_pid(&harness);
    harness
        .tasks
        .stop_for_workspace("agt-hard-1", WORKSPACE)
        .expect("hard stop");
    assert!(matches!(
        harness.terminal("agt-hard-1"),
        AgentTaskStatusPayload::Stopped
    ));
    assert!(gone_within(pid, PROCESS_DEADLINE));
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .events
        .last_for(THREAD)
        .is_some()));
    let ended = harness.events.last_for(THREAD).expect("ended event");
    assert_eq!(ended.reason, ClaudeSessionEndReason::Stopped);
    assert!(ended.background_tasks_live);
    assert_eq!(harness.cli.interrupts_received(), 0);
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .sessions
        .live_sessions()
        == 0));
    harness.assert_no_task_group_signals();
}

#[test]
fn interrupt_is_unsupported_for_a_per_turn_process_and_foreign_owners() {
    let harness = SessionHarness::new("supervised-unsupported", ClaudeSessionTuning::default());
    harness
        .start_turn("agt-own-1", THREAD, "slow", None)
        .expect("session turn");
    harness.await_stdout("agt-own-1", "echo:slow");
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-own-1", "ws-other", THREAD),
        AgentTaskInterruptOutcome::Unavailable
    );
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-own-1", WORKSPACE, "thread-b"),
        AgentTaskInterruptOutcome::Unavailable
    );
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-missing", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Unavailable
    );
    assert_eq!(harness.cli.interrupts_received(), 0);
    harness
        .tasks
        .stop_for_workspace("agt-own-1", WORKSPACE)
        .expect("stop");
    assert!(matches!(
        harness.terminal("agt-own-1"),
        AgentTaskStatusPayload::Stopped
    ));
    harness
        .start_legacy_turn("agt-legacy-1", "slow")
        .expect("per-turn process");
    harness.await_stdout("agt-legacy-1", "echo:slow");
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-legacy-1", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Unsupported
    );
    assert_eq!(
        harness.tasks.steer_for_workspace(
            "agt-legacy-1",
            WORKSPACE,
            Arc::from(claude_user_frame("still steerable", &[]).as_slice()),
        ),
        Ok(()),
        "an unsupported interrupt must not leave the turn marked as interrupting"
    );
    harness
        .tasks
        .stop_for_workspace("agt-legacy-1", WORKSPACE)
        .expect("stop legacy");
    assert!(matches!(
        harness.terminal("agt-legacy-1"),
        AgentTaskStatusPayload::Stopped
    ));
    assert_eq!(harness.cli.interrupts_received(), 0);
}

#[test]
fn an_interrupt_after_settlement_is_unavailable() {
    let harness = SessionHarness::recording("supervised-late-interrupt");
    harness
        .start_turn("agt-late-int-1", THREAD, "hello", None)
        .expect("turn");
    assert!(matches!(
        harness.terminal("agt-late-int-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-late-int-1", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Unavailable
    );
    assert_eq!(harness.cli.interrupts_received(), 0);
    assert!(alive(cli_pid(&harness)));
    assert!(harness.events.reasons_for(THREAD).is_empty());
}

#[test]
fn a_crash_mid_turn_fails_only_that_turn_and_the_next_turn_respawns() {
    let harness = SessionHarness::new("supervised-crash", ClaudeSessionTuning::default());
    harness
        .start_turn("agt-crash-1", THREAD, "hello", None)
        .expect("turn 1");
    assert!(matches!(
        harness.terminal("agt-crash-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    harness
        .start_turn("agt-crash-2", THREAD, "crash", RESUME)
        .expect("turn 2");
    assert!(matches!(
        harness.terminal("agt-crash-2"),
        AgentTaskStatusPayload::Exited { exit_code: 9 }
    ));
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .events
        .reasons_for(THREAD)
        == vec![ClaudeSessionEndReason::Crashed]));
    harness
        .start_turn("agt-crash-3", THREAD, "hello", RESUME)
        .expect("turn 3");
    assert!(matches!(
        harness.terminal("agt-crash-3"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.cli_pids().len(), 2);
}

#[test]
fn an_unpublished_start_failure_kills_a_fresh_session() {
    let harness = SessionHarness::new("supervised-start-failure", ClaudeSessionTuning::default());
    harness.tasks.fail_next_waiter_start_for_tests();
    let error = harness
        .start_turn("agt-fail-1", THREAD, "slow", None)
        .expect_err("injected waiter failure");
    assert!(error.contains("injected"), "{error}");
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .events
        .reasons_for(THREAD)
        == vec![ClaudeSessionEndReason::Stopped]));
    assert!(wait_until(PROCESS_DEADLINE, || harness
        .sessions
        .live_sessions()
        == 0));
    let marker = harness.cli.dir.to_string_lossy().into_owned();
    assert!(
        wait_until(PROCESS_DEADLINE, || processes_mentioning(&marker)
            .is_empty()),
        "the fresh session outlived its unpublished turn: {:?}",
        processes_mentioning(&marker)
    );
    for pid in harness.cli.cli_pids() {
        assert!(gone_within(pid, PROCESS_DEADLINE));
    }
}

#[test]
fn a_steer_after_settlement_is_refused_and_the_session_survives() {
    let harness = SessionHarness::recording("supervised-late-steer");
    harness
        .start_turn("agt-late-1", THREAD, "hello", None)
        .expect("turn");
    assert!(matches!(
        harness.terminal("agt-late-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    let refused = harness.tasks.steer_for_workspace(
        "agt-late-1",
        WORKSPACE,
        Arc::from(claude_user_frame("late", &[]).as_slice()),
    );
    assert!(
        matches!(
            refused,
            Err(AgentTaskSteerRejection::InputClosed
                | AgentTaskSteerRejection::NotRunning
                | AgentTaskSteerRejection::NotRegistered)
        ),
        "a settled turn must refuse input as closed, never as temporarily unsteerable: {refused:?}"
    );
    assert!(alive(cli_pid(&harness)));
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn a_turn_without_a_free_slot_falls_back_to_a_per_turn_process() {
    let harness = SessionHarness::new(
        "supervised-ephemeral",
        ClaudeSessionTuning {
            max_live_sessions: 1,
            ..ClaudeSessionTuning::default()
        },
    );
    harness
        .start_turn("agt-eph-1", THREAD, "slow", None)
        .expect("busy turn");
    harness.await_stdout("agt-eph-1", "echo:slow");
    harness
        .start_turn("agt-eph-2", "thread-b", "hello", None)
        .expect("ephemeral turn");
    assert!(matches!(
        harness.terminal("agt-eph-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    let pids = harness.cli.cli_pids();
    assert_eq!(pids.len(), 2);
    assert!(
        gone_within(pids[1], PROCESS_DEADLINE),
        "an ephemeral turn must not leave its process behind"
    );
    assert!(alive(pids[0]));
    assert_eq!(harness.sessions.live_sessions(), 1);
}

#[test]
fn an_interrupt_that_loses_to_natural_completion_reports_the_turn_as_exited() {
    let harness = SessionHarness::recording("supervised-interrupt-loses");
    harness
        .start_turn("agt-lose-1", THREAD, "slow-finish", None)
        .expect("slow turn");
    harness.await_stdout("agt-lose-1", "\"task_started\"");
    assert_eq!(
        harness
            .tasks
            .interrupt_for_thread("agt-lose-1", WORKSPACE, THREAD),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert!(matches!(
        harness.terminal("agt-lose-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert!(harness
        .stdout("agt-lose-1")
        .contains("finished-before-interrupt"));
    assert_eq!(harness.cli.interrupts_received(), 1);
    assert!(alive(cli_pid(&harness)));
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn an_interrupt_behind_a_stalled_steer_is_unavailable_quickly_and_keeps_the_turn() {
    let harness = SessionHarness::new(
        "supervised-stalled-interrupt",
        ClaudeSessionTuning::default(),
    );
    harness
        .start_turn("agt-stall-1", THREAD, "stall-stdin", None)
        .expect("stalled turn");
    harness.await_stdout("agt-stall-1", "echo:stall-stdin");
    let pad = claude_user_frame(&"x".repeat(256 * 1024), &[]);
    thread::scope(|scope| {
        let steer = scope.spawn(|| {
            harness
                .tasks
                .steer_for_workspace("agt-stall-1", WORKSPACE, Arc::from(pad.as_slice()))
        });
        thread::sleep(Duration::from_millis(300));
        let asked = Instant::now();
        assert_eq!(
            harness
                .tasks
                .interrupt_for_thread("agt-stall-1", WORKSPACE, THREAD),
            AgentTaskInterruptOutcome::Unavailable
        );
        assert!(
            asked.elapsed() < Duration::from_secs(5),
            "{:?}",
            asked.elapsed()
        );
        assert!(!harness.is_terminal("agt-stall-1"));
        fs::write(harness.cli.dir.join("release-result"), b"").expect("release result");
        fs::write(harness.cli.dir.join("release-stdin"), b"").expect("release stdin");
        assert_eq!(steer.join().expect("steer thread"), Ok(()));
    });
    assert!(matches!(
        harness.terminal("agt-stall-1"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.interrupts_received(), 0);
    assert!(harness.events.reasons_for(THREAD).is_empty());
}

#[test]
fn a_claude_cancelled_command_fails_only_its_turn_and_keeps_the_session() {
    let harness = SessionHarness::recording("supervised-cancelled-command");
    harness
        .start_turn("agt-cancel-0", THREAD, "hello", None)
        .expect("first turn");
    assert!(matches!(
        harness.terminal("agt-cancel-0"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    harness
        .start_turn("agt-cancel-1", THREAD, "cancel-queued", RESUME)
        .expect("cancelled turn");
    let status = harness.terminal("agt-cancel-1");
    assert!(
        matches!(&status, AgentTaskStatusPayload::Failed { message } if message == "Claude cancelled this message."),
        "{status:?}"
    );
    let pid = cli_pid(&harness);
    thread::sleep(Duration::from_millis(500));
    assert!(
        harness.events.reasons_for(THREAD).is_empty(),
        "a cancelled command ended the whole shared session: {:?}",
        harness.events.reasons_for(THREAD)
    );
    assert!(alive(pid));
    harness
        .start_turn("agt-cancel-2", THREAD, "hello", RESUME)
        .expect("turn after the cancellation");
    assert!(matches!(
        harness.terminal("agt-cancel-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.cli_pids(), vec![pid]);
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}

#[test]
fn an_error_result_reports_a_failing_exit_and_keeps_the_session() {
    let harness = SessionHarness::recording("supervised-error-result");
    harness
        .start_turn("agt-error-1", THREAD, "error-result", None)
        .expect("error turn");
    assert!(matches!(
        harness.terminal("agt-error-1"),
        AgentTaskStatusPayload::Exited { exit_code: 1 }
    ));
    let pid = cli_pid(&harness);
    harness
        .start_turn("agt-error-2", THREAD, "hello", RESUME)
        .expect("turn after the error");
    assert!(matches!(
        harness.terminal("agt-error-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.cli_pids(), vec![pid]);
    assert!(harness.events.reasons_for(THREAD).is_empty());
    harness.assert_no_task_group_signals();
}
