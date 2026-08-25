#![cfg(unix)]
#![allow(dead_code)]

mod workspace_registry {
    #[derive(Clone, Debug, Eq, Hash, PartialEq)]
    pub struct WorkspaceId(pub String);
}

#[path = "../src/agent_task_spawner.rs"]
mod agent_task_spawner;

#[path = "../src/agent_task_admission.rs"]
mod agent_task_admission;

#[path = "../src/agent_task_supervisor.rs"]
mod agent_task_supervisor;

use agent_task_admission::{
    AgentTaskAdmissionRegistry, AGENT_TASK_CWD_EXCLUSIVE_ERROR, AGENT_TASK_GLOBAL_LIMIT,
    AGENT_TASK_GLOBAL_LIMIT_ERROR, AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR,
    AGENT_TASK_REPOSITORY_LIMIT, AGENT_TASK_REPOSITORY_LIMIT_ERROR,
};
use agent_task_spawner::agent_launch::{
    AgentLaunchOptions, ClaudeEffortChoice, ClaudeModelChoice, ClaudePermissionMode,
    CodexExecutionMode, CodexModelChoice,
};
use agent_task_spawner::{
    plan_agent_invocation, AgentChild, AgentCliInvocation, AgentProcessSpawner, AgentTaskSpawnPlan,
    StdAgentProcessSpawner, AGENT_TASK_INHERITED_ENV, MAX_AGENT_PROMPT_BYTES,
};
use agent_task_supervisor::{
    AgentProcessGroupSignalSender, AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent,
    AgentTaskOutputStream, AgentTaskRegistry, AgentTaskStartRequest, AgentTaskStartResult,
    AgentTaskStatusEvent, AgentTaskStatusPayload, AGENT_TASK_OUTPUT_EVENT_LIMIT,
    KILL_PROCESS_GROUP_SIGNAL, MAX_QUEUED_AGENT_TASK_EVENTS, TERMINATE_PROCESS_GROUP_SIGNAL,
};
use std::{
    collections::{HashMap, VecDeque},
    fs, io,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use workspace_registry::WorkspaceId;

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

const EVENT_DEADLINE: Duration = Duration::from_secs(5);

fn unique_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "agent-supervisor-{label}-{}-{}",
        std::process::id(),
        NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst)
    ))
}

fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

fn workspace(label: &str) -> WorkspaceId {
    WorkspaceId(label.to_string())
}

#[derive(Default)]
struct RecordingSink {
    statuses: Mutex<Vec<AgentTaskStatusEvent>>,
    outputs: Mutex<Vec<AgentTaskOutputEvent>>,
}

impl RecordingSink {
    fn statuses(&self) -> Vec<AgentTaskStatusEvent> {
        self.statuses.lock().expect("statuses lock").clone()
    }

    fn outputs(&self) -> Vec<AgentTaskOutputEvent> {
        self.outputs.lock().expect("outputs lock").clone()
    }

    fn has_terminal_status(&self, task_id: &str) -> bool {
        self.statuses()
            .iter()
            .any(|event| event.task_id == task_id && is_terminal_status(&event.status))
    }
}

impl AgentTaskEventSink for RecordingSink {
    fn status(&self, event: AgentTaskStatusEvent) {
        self.statuses.lock().expect("statuses lock").push(event);
    }

    fn output(&self, event: AgentTaskOutputEvent) {
        self.outputs.lock().expect("outputs lock").push(event);
    }
}

fn is_terminal_status(status: &AgentTaskStatusPayload) -> bool {
    matches!(
        status,
        AgentTaskStatusPayload::Exited { .. }
            | AgentTaskStatusPayload::Failed { .. }
            | AgentTaskStatusPayload::Stopped
    )
}

struct FakeProcess {
    exit: Mutex<Option<i32>>,
    exit_signal: Condvar,
    term_exit_code: Option<i32>,
}

impl FakeProcess {
    fn new(initial_exit: Option<i32>, term_exit_code: Option<i32>) -> Arc<Self> {
        Arc::new(Self {
            exit: Mutex::new(initial_exit),
            exit_signal: Condvar::new(),
            term_exit_code,
        })
    }

    fn set_exited(&self, code: i32) {
        let mut exit = self.exit.lock().expect("exit lock");
        if exit.is_none() {
            *exit = Some(code);
        }
        self.exit_signal.notify_all();
    }

    fn exit_code(&self) -> Option<i32> {
        *self.exit.lock().expect("exit lock")
    }

    fn wait_exited_blocking(&self) {
        let exit = self.exit.lock().expect("exit lock");
        let _exit = self
            .exit_signal
            .wait_while(exit, |code| code.is_none())
            .expect("exit wait");
    }
}

struct FakeReader {
    segments: VecDeque<Vec<u8>>,
    receiver: Option<mpsc::Receiver<Vec<u8>>>,
    process: Arc<FakeProcess>,
}

impl FakeReader {
    fn deliver(&mut self, segment: Vec<u8>, buffer: &mut [u8]) -> usize {
        let count = segment.len().min(buffer.len());
        buffer[..count].copy_from_slice(&segment[..count]);
        if count < segment.len() {
            self.segments.push_front(segment[count..].to_vec());
        }
        count
    }
}

impl Read for FakeReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if let Some(segment) = self.segments.pop_front() {
            return Ok(self.deliver(segment, buffer));
        }
        if let Some(receiver) = &self.receiver {
            let Ok(segment) = receiver.recv() else {
                return Ok(0);
            };
            return Ok(self.deliver(segment, buffer));
        }
        self.process.wait_exited_blocking();
        Ok(0)
    }
}

struct FakeChild {
    process: Arc<FakeProcess>,
    process_group_id: i32,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
    fail_stdout_reader: bool,
}

impl AgentChild for FakeChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        if self.fail_stdout_reader {
            return Err("stdout reader fault injected".to_string());
        }
        self.stdout
            .take()
            .ok_or_else(|| "stdout already taken".to_string())
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.stderr
            .take()
            .ok_or_else(|| "stderr already taken".to_string())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        Ok(self.process.exit_code())
    }

    fn process_group_id(&self) -> i32 {
        self.process_group_id
    }
}

struct FakeChildSpec {
    process: Arc<FakeProcess>,
    process_group_id: i32,
    stdout_segments: Vec<Vec<u8>>,
    stdout_receiver: Option<mpsc::Receiver<Vec<u8>>>,
    stderr_receiver: Option<mpsc::Receiver<Vec<u8>>>,
    fail_stdout_reader: bool,
}

impl FakeChildSpec {
    fn new(process: &Arc<FakeProcess>, process_group_id: i32) -> Self {
        Self {
            process: Arc::clone(process),
            process_group_id,
            stdout_segments: Vec::new(),
            stdout_receiver: None,
            stderr_receiver: None,
            fail_stdout_reader: false,
        }
    }

    fn with_stdout_segments(mut self, segments: Vec<Vec<u8>>) -> Self {
        self.stdout_segments = segments;
        self
    }

    fn with_stdout_receiver(mut self, receiver: mpsc::Receiver<Vec<u8>>) -> Self {
        self.stdout_receiver = Some(receiver);
        self
    }

    fn with_stderr_receiver(mut self, receiver: mpsc::Receiver<Vec<u8>>) -> Self {
        self.stderr_receiver = Some(receiver);
        self
    }

    fn with_stdout_reader_fault(mut self) -> Self {
        self.fail_stdout_reader = true;
        self
    }

    fn build(self) -> FakeChild {
        let stdout = FakeReader {
            segments: self.stdout_segments.into_iter().collect(),
            receiver: self.stdout_receiver,
            process: Arc::clone(&self.process),
        };
        let stderr = FakeReader {
            segments: VecDeque::new(),
            receiver: self.stderr_receiver,
            process: Arc::clone(&self.process),
        };
        FakeChild {
            process: self.process,
            process_group_id: self.process_group_id,
            stdout: Some(Box::new(stdout)),
            stderr: Some(Box::new(stderr)),
            fail_stdout_reader: self.fail_stdout_reader,
        }
    }
}

enum FakeSpawnOutcome {
    Fail(String),
    Child(FakeChild),
}

#[derive(Default)]
struct FakeSpawner {
    outcomes: Mutex<VecDeque<FakeSpawnOutcome>>,
}

impl FakeSpawner {
    fn script(&self, outcome: FakeSpawnOutcome) {
        self.outcomes
            .lock()
            .expect("outcomes lock")
            .push_back(outcome);
    }
}

impl AgentProcessSpawner for FakeSpawner {
    fn spawn(&self, _plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let outcome = self.outcomes.lock().expect("outcomes lock").pop_front();
        match outcome {
            Some(FakeSpawnOutcome::Fail(message)) => Err(message),
            Some(FakeSpawnOutcome::Child(child)) => Ok(Box::new(child)),
            None => Err("no scripted spawn outcome".to_string()),
        }
    }
}

#[derive(Default)]
struct RecordingSignalSender {
    signals: Mutex<Vec<(i32, i32)>>,
    processes: Mutex<HashMap<i32, Arc<FakeProcess>>>,
}

impl RecordingSignalSender {
    fn track(&self, process_group_id: i32, process: &Arc<FakeProcess>) {
        self.processes
            .lock()
            .expect("processes lock")
            .insert(process_group_id, Arc::clone(process));
    }

    fn signals(&self) -> Vec<(i32, i32)> {
        self.signals.lock().expect("signals lock").clone()
    }

    fn signals_for(&self, process_group_id: i32) -> Vec<i32> {
        self.signals()
            .into_iter()
            .filter(|(target, _)| *target == process_group_id)
            .map(|(_, signal)| signal)
            .collect()
    }
}

impl AgentProcessGroupSignalSender for RecordingSignalSender {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.signals
            .lock()
            .expect("signals lock")
            .push((process_group_id, signal));
        let process = self
            .processes
            .lock()
            .expect("processes lock")
            .get(&process_group_id)
            .cloned();
        let Some(process) = process else {
            return Ok(());
        };
        if signal == KILL_PROCESS_GROUP_SIGNAL {
            process.set_exited(137);
            return Ok(());
        }
        if signal == TERMINATE_PROCESS_GROUP_SIGNAL {
            if let Some(code) = process.term_exit_code {
                process.set_exited(code);
            }
        }
        Ok(())
    }
}

struct Fixture {
    registry: AgentTaskRegistry,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    signals: Arc<RecordingSignalSender>,
    spawner: Arc<FakeSpawner>,
}

fn fixture(max_runtime: Duration) -> Fixture {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let signals = Arc::new(RecordingSignalSender::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
        max_runtime,
        Duration::from_millis(100),
        Duration::from_millis(200),
    );
    Fixture {
        registry,
        admission,
        sink,
        signals,
        spawner,
    }
}

fn start_request(task_id: &str, repository_root: &Path) -> AgentTaskStartRequest {
    AgentTaskStartRequest {
        task_id: task_id.to_string(),
        workspace_id: "ws-agent-tests".to_string(),
        repository_root: repository_root.to_path_buf(),
        isolation: AgentTaskIsolation::Worktree,
        worktree_path: Some(repository_root.join(".worktrees").join(task_id)),
    }
}

fn fake_plan(cwd: &Path) -> AgentTaskSpawnPlan {
    AgentTaskSpawnPlan::for_tests(
        PathBuf::from("/bin/fake-agent"),
        vec!["-p".to_string(), "prompt".to_string()],
        cwd.to_path_buf(),
        Vec::new(),
    )
}

fn dispatch(
    fixture: &Fixture,
    task_id: &str,
    repository_root: &Path,
    cwd: &Path,
) -> Result<AgentTaskStartResult, String> {
    let admission = fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            repository_root,
            cwd,
            AgentTaskIsolation::Worktree,
        )
        .expect("admission for dispatch");
    fixture.registry.start(
        start_request(task_id, repository_root),
        fake_plan(cwd),
        admission,
    )
}

fn statuses_for(sink: &RecordingSink, task_id: &str) -> Vec<AgentTaskStatusEvent> {
    sink.statuses()
        .into_iter()
        .filter(|event| event.task_id == task_id)
        .collect()
}

fn outputs_for(sink: &RecordingSink, task_id: &str) -> Vec<AgentTaskOutputEvent> {
    sink.outputs()
        .into_iter()
        .filter(|event| event.task_id == task_id)
        .collect()
}

fn write_executable_script(directory: &Path, name: &str) -> PathBuf {
    fs::create_dir_all(directory).expect("script directory");
    let path = directory.join(name);
    fs::write(&path, "#!/bin/sh\nexit 0\n").expect("script body");
    let mut permissions = fs::metadata(&path).expect("script metadata").permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).expect("script permissions");
    path
}

fn probe_binary(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.is_file())
}

#[test]
fn status_events_serialize_to_the_pinned_wire_shape() {
    let running = AgentTaskStatusEvent {
        task_id: "agt-1".to_string(),
        workspace_id: "ws-1".to_string(),
        repository_root: "/repo".to_string(),
        isolation: AgentTaskIsolation::Worktree,
        worktree_path: Some("/repo/.worktrees/agt-1".to_string()),
        sequence: 1,
        status: AgentTaskStatusPayload::Running,
    };
    assert_wire(
        &running,
        r#"{"taskId":"agt-1","workspaceId":"ws-1","repositoryRoot":"/repo","isolation":"worktree","worktreePath":"/repo/.worktrees/agt-1","sequence":1,"status":"running"}"#,
    );
    let exited = AgentTaskStatusEvent {
        task_id: "agt-2".to_string(),
        workspace_id: "ws-1".to_string(),
        repository_root: "/repo".to_string(),
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        sequence: 2,
        status: AgentTaskStatusPayload::Exited { exit_code: -3 },
    };
    assert_wire(
        &exited,
        r#"{"taskId":"agt-2","workspaceId":"ws-1","repositoryRoot":"/repo","isolation":"in-place","worktreePath":null,"sequence":2,"status":"exited","exitCode":-3}"#,
    );
    let failed = AgentTaskStatusEvent {
        status: AgentTaskStatusPayload::Failed {
            message: "boom".to_string(),
        },
        ..running.clone()
    };
    assert_wire(
        &failed,
        r#"{"taskId":"agt-1","workspaceId":"ws-1","repositoryRoot":"/repo","isolation":"worktree","worktreePath":"/repo/.worktrees/agt-1","sequence":1,"status":"failed","message":"boom"}"#,
    );
    let stopped = AgentTaskStatusEvent {
        status: AgentTaskStatusPayload::Stopped,
        ..running.clone()
    };
    assert_wire(
        &stopped,
        r#"{"taskId":"agt-1","workspaceId":"ws-1","repositoryRoot":"/repo","isolation":"worktree","worktreePath":"/repo/.worktrees/agt-1","sequence":1,"status":"stopped"}"#,
    );
    let pending = AgentTaskStatusEvent {
        status: AgentTaskStatusPayload::Pending,
        ..running
    };
    assert_wire(
        &pending,
        r#"{"taskId":"agt-1","workspaceId":"ws-1","repositoryRoot":"/repo","isolation":"worktree","worktreePath":"/repo/.worktrees/agt-1","sequence":1,"status":"pending"}"#,
    );
}

#[test]
fn output_event_and_cli_enums_serialize_to_the_pinned_wire_shape() {
    let output = AgentTaskOutputEvent {
        task_id: "agt-1".to_string(),
        sequence: 7,
        stream: AgentTaskOutputStream::Stdout,
        chunk: "hello".to_string(),
        truncated: false,
    };
    assert_wire(
        &output,
        r#"{"taskId":"agt-1","sequence":7,"stream":"stdout","chunk":"hello","truncated":false}"#,
    );
    let marker = AgentTaskOutputEvent {
        task_id: "agt-1".to_string(),
        sequence: 8,
        stream: AgentTaskOutputStream::Stderr,
        chunk: String::new(),
        truncated: true,
    };
    assert_wire(
        &marker,
        r#"{"taskId":"agt-1","sequence":8,"stream":"stderr","chunk":"","truncated":true}"#,
    );
    assert_eq!(
        serde_json::to_string(&AgentCliInvocation::ClaudeCode).expect("serialize claudeCode"),
        r#""claudeCode""#
    );
    assert_eq!(
        serde_json::to_string(&AgentCliInvocation::CodexExec).expect("serialize codex"),
        r#""codex""#
    );
    let decoded: AgentCliInvocation = serde_json::from_str(r#""codex""#).expect("decode codex");
    assert!(matches!(decoded, AgentCliInvocation::CodexExec));
    let isolation: AgentTaskIsolation =
        serde_json::from_str(r#""in-place""#).expect("decode in-place");
    assert_eq!(isolation, AgentTaskIsolation::InPlace);
    assert_eq!(
        serde_json::to_string(&AgentTaskIsolation::Worktree).expect("serialize worktree"),
        r#""worktree""#
    );
}

fn assert_wire<T: serde::Serialize>(value: &T, expected: &str) {
    let actual = serde_json::to_value(value).expect("serialize event");
    let expected: serde_json::Value = serde_json::from_str(expected).expect("expected JSON");
    assert_eq!(actual, expected);
}

const CLAUDE_LAUNCH: AgentLaunchOptions = AgentLaunchOptions::ClaudeCode {
    model: ClaudeModelChoice::Default,
    mode: ClaudePermissionMode::Default,
    effort: ClaudeEffortChoice::Default,
};
const CODEX_LAUNCH: AgentLaunchOptions = AgentLaunchOptions::Codex {
    model: CodexModelChoice::Default,
    mode: CodexExecutionMode::Default,
};

#[test]
fn plan_agent_invocation_builds_closed_argv_and_allowlisted_env() {
    let directory = unique_path("plan");
    let cli = write_executable_script(&directory, "fake-cli");
    let cli_path = cli.to_string_lossy().into_owned();
    let claude = plan_agent_invocation(
        &cli_path,
        AgentCliInvocation::ClaudeCode,
        "do the task",
        &directory,
        None,
        CLAUDE_LAUNCH,
    )
    .expect("claude plan");
    assert_eq!(claude.program(), cli.as_path());
    assert_eq!(
        claude.args(),
        [
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--".to_string(),
            "do the task".to_string()
        ]
    );
    assert_eq!(claude.cwd(), directory.as_path());
    for (key, _) in claude.env() {
        assert!(
            AGENT_TASK_INHERITED_ENV.contains(&key.as_str()),
            "unexpected env key {key}"
        );
    }
    assert!(claude
        .env()
        .iter()
        .any(|(key, value)| key == "PATH" && !value.is_empty()));
    let codex = plan_agent_invocation(
        &cli_path,
        AgentCliInvocation::CodexExec,
        "ship",
        &directory,
        None,
        CODEX_LAUNCH,
    )
    .expect("codex plan");
    assert_eq!(
        codex.args(),
        [
            "exec".to_string(),
            "--json".to_string(),
            "--".to_string(),
            "ship".to_string()
        ]
    );
    let resumed_claude = plan_agent_invocation(
        &cli_path,
        AgentCliInvocation::ClaudeCode,
        "do the task",
        &directory,
        Some("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"),
        CLAUDE_LAUNCH,
    )
    .expect("resumed claude plan");
    assert_eq!(
        resumed_claude.args(),
        [
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--resume".to_string(),
            "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string(),
            "--".to_string(),
            "do the task".to_string()
        ]
    );
    let resumed_codex = plan_agent_invocation(
        &cli_path,
        AgentCliInvocation::CodexExec,
        "ship",
        &directory,
        Some("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"),
        CODEX_LAUNCH,
    )
    .expect("resumed codex plan");
    assert_eq!(
        resumed_codex.args(),
        [
            "exec".to_string(),
            "resume".to_string(),
            "--json".to_string(),
            "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string(),
            "--".to_string(),
            "ship".to_string()
        ]
    );
    for candidate in ["-injected", "--resume", "short", &"a".repeat(129)] {
        assert!(
            plan_agent_invocation(
                &cli_path,
                AgentCliInvocation::ClaudeCode,
                "do the task",
                &directory,
                Some(candidate),
                CLAUDE_LAUNCH,
            )
            .is_err(),
            "resume session id {candidate} must be refused"
        );
    }
}

#[test]
fn plan_agent_invocation_rejects_unsafe_inputs() {
    let directory = unique_path("plan-reject");
    let cli = write_executable_script(&directory, "fake-cli");
    let cli_path = cli.to_string_lossy().into_owned();
    let plain = fs::metadata(&cli).expect("cli metadata").permissions();
    let mut no_exec = plain.clone();
    use std::os::unix::fs::PermissionsExt;
    no_exec.set_mode(0o644);
    let prompt = "prompt";
    let cases: Vec<(String, &str)> = vec![
        (String::new(), "empty path"),
        ("relative/cli".to_string(), "relative path"),
        (
            directory.join("missing").to_string_lossy().into_owned(),
            "missing file",
        ),
        (directory.to_string_lossy().into_owned(), "directory"),
        ("/".repeat(5000), "oversized path"),
    ];
    for (candidate, label) in cases {
        assert!(
            plan_agent_invocation(
                &candidate,
                AgentCliInvocation::ClaudeCode,
                prompt,
                &directory,
                None,
                CLAUDE_LAUNCH,
            )
            .is_err(),
            "expected rejection for {label}"
        );
    }
    fs::set_permissions(&cli, no_exec).expect("strip exec bit");
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            prompt,
            &directory,
            None,
            CLAUDE_LAUNCH,
        )
        .is_err(),
        "expected rejection for non-executable file"
    );
    fs::set_permissions(&cli, plain).expect("restore exec bit");
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            "",
            &directory,
            None,
            CLAUDE_LAUNCH,
        )
        .is_err(),
        "expected rejection for empty prompt"
    );
    let oversized_prompt = "p".repeat(MAX_AGENT_PROMPT_BYTES + 1);
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            &oversized_prompt,
            &directory,
            None,
            CLAUDE_LAUNCH,
        )
        .is_err(),
        "expected rejection for oversized prompt"
    );
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            prompt,
            Path::new("relative/cwd"),
            None,
            CLAUDE_LAUNCH,
        )
        .is_err(),
        "expected rejection for relative cwd"
    );
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            prompt,
            &directory,
            Some("-not-a-session"),
            CLAUDE_LAUNCH,
        )
        .is_err(),
        "expected rejection for a flag-like resume session id"
    );
    assert!(
        plan_agent_invocation(
            &cli_path,
            AgentCliInvocation::ClaudeCode,
            prompt,
            &directory,
            Some("session-0001"),
            CLAUDE_LAUNCH,
        )
        .is_ok(),
        "expected a safe resume session id to be accepted"
    );
}

#[test]
fn admission_enforces_global_limit() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let mut held = Vec::new();
    for index in 0..AGENT_TASK_GLOBAL_LIMIT {
        let root = unique_path(&format!("global-{index}"));
        held.push(
            registry
                .reserve(
                    &workspace(&format!("ws-{index}")),
                    &root,
                    &root.join(".worktrees/task"),
                    AgentTaskIsolation::Worktree,
                )
                .expect("admission under global limit"),
        );
    }
    let root = unique_path("global-overflow");
    let rejected = registry.reserve(
        &workspace("ws-overflow"),
        &root,
        &root,
        AgentTaskIsolation::Worktree,
    );
    assert_eq!(
        rejected.err().as_deref(),
        Some(AGENT_TASK_GLOBAL_LIMIT_ERROR)
    );
    held.clear();
    assert!(registry
        .reserve(
            &workspace("ws-overflow"),
            &root,
            &root,
            AgentTaskIsolation::Worktree
        )
        .is_ok());
}

#[test]
fn admission_enforces_repository_limit_per_workspace_and_root() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("repo-limit");
    let mut held = Vec::new();
    for index in 0..AGENT_TASK_REPOSITORY_LIMIT {
        held.push(
            registry
                .reserve(
                    &workspace("ws-a"),
                    &root,
                    &root.join(format!(".worktrees/task-{index}")),
                    AgentTaskIsolation::Worktree,
                )
                .expect("admission under repository limit"),
        );
    }
    let rejected = registry.reserve(
        &workspace("ws-a"),
        &root,
        &root.join(".worktrees/task-overflow"),
        AgentTaskIsolation::Worktree,
    );
    assert_eq!(
        rejected.err().as_deref(),
        Some(AGENT_TASK_REPOSITORY_LIMIT_ERROR)
    );
    let other_root = unique_path("repo-limit-other");
    assert!(registry
        .reserve(
            &workspace("ws-a"),
            &other_root,
            &other_root.join(".worktrees/task"),
            AgentTaskIsolation::Worktree
        )
        .is_ok());
    assert!(registry
        .reserve(
            &workspace("ws-b"),
            &root,
            &root.join(".worktrees/task-b"),
            AgentTaskIsolation::Worktree
        )
        .is_ok());
}

#[test]
fn admission_in_place_exclusivity_covers_worktree_tasks_in_the_working_tree() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("in-place");
    let in_place = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("first in-place admission");
    let second = registry.reserve(
        &workspace("ws-a"),
        &root,
        &root,
        AgentTaskIsolation::InPlace,
    );
    assert_eq!(
        second.err().as_deref(),
        Some(AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR)
    );
    let worktree = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root.join(".worktrees/task"),
            AgentTaskIsolation::Worktree,
        )
        .expect("worktree admission next to in-place");
    drop(in_place);
    drop(worktree);
    let worktree_in_root = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::Worktree,
        )
        .expect("worktree admission with cwd at repository root");
    let blocked = registry.reserve(
        &workspace("ws-a"),
        &root,
        &root,
        AgentTaskIsolation::InPlace,
    );
    assert_eq!(
        blocked.err().as_deref(),
        Some(AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR)
    );
    drop(worktree_in_root);
    assert!(registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn admission_enforces_cwd_exclusivity_across_live_admissions() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("cwd-exclusive");
    let worktree = root.join(".worktrees/agt-thread-0001");
    let first = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &worktree,
            AgentTaskIsolation::Worktree,
        )
        .expect("first turn admission");

    let second = registry.reserve(
        &workspace("ws-a"),
        &root,
        &worktree,
        AgentTaskIsolation::Worktree,
    );
    let foreign = registry.reserve(
        &workspace("ws-b"),
        &root,
        &worktree,
        AgentTaskIsolation::Worktree,
    );

    assert_eq!(
        second.err().as_deref(),
        Some(AGENT_TASK_CWD_EXCLUSIVE_ERROR)
    );
    assert_eq!(
        foreign.err().as_deref(),
        Some(AGENT_TASK_CWD_EXCLUSIVE_ERROR)
    );

    let sibling = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root.join(".worktrees/agt-thread-0002"),
            AgentTaskIsolation::Worktree,
        )
        .expect("sibling worktree keeps its own cwd");

    drop(first);
    drop(sibling);

    registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &worktree,
            AgentTaskIsolation::Worktree,
        )
        .expect("cwd is admissible again once the turn settles");
}

#[test]
fn admission_is_released_on_drop_and_on_panic() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("release");
    let admission = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("initial admission");
    drop(admission);
    assert!(registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
    let panicking_registry = Arc::clone(&registry);
    let panicking_root = unique_path("release-panic");
    let outcome = thread::spawn(move || {
        let _admission = panicking_registry
            .reserve(
                &workspace("ws-b"),
                &panicking_root,
                &panicking_root,
                AgentTaskIsolation::InPlace,
            )
            .expect("admission before panic");
        panic!("admission owner panicked");
    })
    .join();
    assert!(outcome.is_err(), "worker was expected to panic");
    let panicked_root = unique_path("release-after-panic");
    assert!(registry
        .reserve(
            &workspace("ws-b"),
            &panicked_root,
            &panicked_root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn queued_events_drain_in_order_on_acknowledge() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("queued");
    let cwd = root.join(".worktrees/agt-queued");
    let process = FakeProcess::new(Some(0), None);
    fixture.signals.track(9101, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9101)
            .with_stdout_segments(vec![b"hello".to_vec()])
            .build(),
    ));
    let started = dispatch(&fixture, "agt-queued", &root, &cwd).expect("start task");
    assert_eq!(started.task_id, "agt-queued");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
    assert!(
        fixture.sink.statuses().is_empty(),
        "events leaked before ack"
    );
    assert!(
        fixture.sink.outputs().is_empty(),
        "output leaked before ack"
    );
    fixture
        .registry
        .acknowledge("agt-queued")
        .expect("acknowledge");
    let statuses = statuses_for(&fixture.sink, "agt-queued");
    assert_eq!(statuses.len(), 2, "expected running then exited");
    assert!(matches!(
        statuses[0].status,
        AgentTaskStatusPayload::Running
    ));
    assert!(matches!(
        statuses[1].status,
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(statuses[0].sequence, 1);
    assert_eq!(statuses[1].sequence, 2);
    assert_eq!(statuses[0].isolation, AgentTaskIsolation::Worktree);
    let outputs = outputs_for(&fixture.sink, "agt-queued");
    assert_eq!(outputs.len(), 1);
    assert_eq!(outputs[0].chunk, "hello");
    assert_eq!(outputs[0].stream, AgentTaskOutputStream::Stdout);
    assert_eq!(outputs[0].sequence, 1);
    assert!(!outputs[0].truncated);
    assert!(
        fixture.registry.acknowledge("agt-queued").is_err(),
        "terminal drained task should be removed"
    );
}

#[test]
fn events_after_acknowledge_emit_live() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("live");
    let cwd = root.join(".worktrees/agt-live");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9102, &process);
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9102)
            .with_stdout_receiver(receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-live", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-live")
        .expect("acknowledge");
    let statuses = statuses_for(&fixture.sink, "agt-live");
    assert_eq!(statuses.len(), 1);
    assert!(matches!(
        statuses[0].status,
        AgentTaskStatusPayload::Running
    ));
    sender.send(b"live-chunk".to_vec()).expect("send output");
    assert!(
        wait_until(EVENT_DEADLINE, || !outputs_for(&fixture.sink, "agt-live")
            .is_empty()),
        "live output did not arrive"
    );
    let outputs = outputs_for(&fixture.sink, "agt-live");
    assert_eq!(outputs[0].chunk, "live-chunk");
    drop(sender);
    process.set_exited(0);
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-live")),
        "task did not reach a terminal status"
    );
    let statuses = statuses_for(&fixture.sink, "agt-live");
    assert!(matches!(
        statuses.last().map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
}

#[test]
fn output_cap_publishes_one_truncation_marker_then_silence() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("cap");
    let cwd = root.join(".worktrees/agt-cap");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9103, &process);
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9103)
            .with_stdout_receiver(receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-cap", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-cap")
        .expect("acknowledge");
    let total = AGENT_TASK_OUTPUT_EVENT_LIMIT + 1;
    for _ in 0..total {
        sender.send(vec![b'x']).expect("send chunk");
    }
    assert!(
        wait_until(Duration::from_secs(20), || {
            outputs_for(&fixture.sink, "agt-cap").len() as u64 == total
        }),
        "capped output stream did not settle"
    );
    let outputs = outputs_for(&fixture.sink, "agt-cap");
    let normal = &outputs[..outputs.len() - 1];
    assert!(normal.iter().all(|event| !event.truncated));
    let marker = outputs.last().expect("truncation marker");
    assert!(marker.truncated);
    assert_eq!(marker.chunk, "");
    assert_eq!(marker.sequence, AGENT_TASK_OUTPUT_EVENT_LIMIT + 1);
    sender.send(vec![b'y']).expect("send post-marker chunk");
    thread::sleep(Duration::from_millis(100));
    assert_eq!(
        outputs_for(&fixture.sink, "agt-cap").len() as u64,
        total,
        "output arrived after the truncation marker"
    );
    drop(sender);
    process.set_exited(0);
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-cap")),
        "task did not reach a terminal status"
    );
}

#[test]
fn queued_overflow_drops_oldest_output_and_never_status() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("overflow");
    let cwd = root.join(".worktrees/agt-overflow");
    let process = FakeProcess::new(Some(0), None);
    fixture.signals.track(9104, &process);
    let segments: Vec<Vec<u8>> = (0..300).map(|_| vec![b'z']).collect();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9104)
            .with_stdout_segments(segments)
            .build(),
    ));
    dispatch(&fixture, "agt-overflow", &root, &cwd).expect("start task");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
    fixture
        .registry
        .acknowledge("agt-overflow")
        .expect("acknowledge");
    let statuses = statuses_for(&fixture.sink, "agt-overflow");
    assert_eq!(statuses.len(), 2, "status events must never be dropped");
    assert!(matches!(
        statuses[0].status,
        AgentTaskStatusPayload::Running
    ));
    assert!(matches!(
        statuses[1].status,
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    let outputs = outputs_for(&fixture.sink, "agt-overflow");
    assert_eq!(outputs.len(), MAX_QUEUED_AGENT_TASK_EVENTS - 2);
    let first = outputs.first().expect("oldest retained output");
    assert!(
        first.sequence > 1,
        "oldest queued output should have been dropped"
    );
    let last = outputs.last().expect("newest retained output");
    assert_eq!(last.sequence, 300);
}

#[test]
fn stop_running_task_publishes_stopped_and_signals_group() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("stop-running");
    let cwd = root.join(".worktrees/agt-stop");
    let process = FakeProcess::new(None, Some(143));
    fixture.signals.track(9105, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9105).build(),
    ));
    dispatch(&fixture, "agt-stop", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-stop")
        .expect("acknowledge");
    fixture.registry.stop("agt-stop").expect("stop");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-stop")),
        "stop did not reach a terminal status"
    );
    let statuses = statuses_for(&fixture.sink, "agt-stop");
    assert!(matches!(
        statuses.last().map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
    assert_eq!(
        fixture.signals.signals_for(9105).first().copied(),
        Some(TERMINATE_PROCESS_GROUP_SIGNAL)
    );
    assert!(
        fixture.registry.stop("agt-stop").is_ok(),
        "stop is idempotent"
    );
}

#[test]
fn stop_pending_task_drains_stopped_on_acknowledge() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("stop-pending");
    let cwd = root.join(".worktrees/agt-pending");
    let process = FakeProcess::new(None, Some(143));
    fixture.signals.track(9106, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9106).build(),
    ));
    dispatch(&fixture, "agt-pending", &root, &cwd).expect("start task");
    fixture.registry.stop("agt-pending").expect("stop pending");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
    assert!(
        fixture.sink.statuses().is_empty(),
        "events leaked before ack"
    );
    fixture
        .registry
        .acknowledge("agt-pending")
        .expect("acknowledge");
    let statuses = statuses_for(&fixture.sink, "agt-pending");
    assert!(matches!(
        statuses.last().map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
}

#[test]
fn watchdog_timeout_fails_task_and_escalates_to_kill() {
    let fixture = fixture(Duration::from_millis(50));
    let root = unique_path("watchdog");
    let cwd = root.join(".worktrees/agt-watchdog");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9107, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9107).build(),
    ));
    dispatch(&fixture, "agt-watchdog", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-watchdog")
        .expect("acknowledge");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-watchdog")),
        "watchdog did not fail the task"
    );
    let statuses = statuses_for(&fixture.sink, "agt-watchdog");
    let failure = statuses.last().expect("terminal status");
    let message = match &failure.status {
        AgentTaskStatusPayload::Failed { message } => message.clone(),
        other => format!("unexpected status {other:?}"),
    };
    assert_eq!(message, "agent task exceeded maximum runtime");
    assert!(
        wait_until(EVENT_DEADLINE, || {
            fixture.signals.signals_for(9107)
                == vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
        }),
        "watchdog did not escalate SIGTERM then SIGKILL"
    );
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "watchdog or waiter threads leaked"
    );
    assert_eq!(
        statuses_for(&fixture.sink, "agt-watchdog").len(),
        2,
        "no status may follow the watchdog failure"
    );
}

#[test]
fn watchdog_does_not_leak_after_task_end() {
    let fixture = fixture(Duration::from_secs(120));
    let root = unique_path("watchdog-exit");
    let cwd = root.join(".worktrees/agt-wd-exit");
    let process = FakeProcess::new(Some(0), None);
    fixture.signals.track(9108, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9108).build(),
    ));
    dispatch(&fixture, "agt-wd-exit", &root, &cwd).expect("start task");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "watchdog thread leaked after task end"
    );
}

#[test]
fn stop_for_root_only_stops_matching_tasks() {
    let fixture = fixture(Duration::from_secs(60));
    let root_a = unique_path("root-a");
    let root_b = unique_path("root-b");
    let cwd_a = root_a.join(".worktrees/agt-a");
    let cwd_b = root_b.join(".worktrees/agt-b");
    let process_a = FakeProcess::new(None, Some(143));
    let process_b = FakeProcess::new(None, Some(143));
    fixture.signals.track(9109, &process_a);
    fixture.signals.track(9110, &process_b);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_a, 9109).build(),
    ));
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_b, 9110).build(),
    ));
    dispatch(&fixture, "agt-a", &root_a, &cwd_a).expect("start task a");
    dispatch(&fixture, "agt-b", &root_b, &cwd_b).expect("start task b");
    fixture
        .registry
        .acknowledge("agt-a")
        .expect("acknowledge a");
    fixture
        .registry
        .acknowledge("agt-b")
        .expect("acknowledge b");
    fixture.registry.stop_for_root(&root_a);
    assert!(
        wait_until(EVENT_DEADLINE, || fixture.sink.has_terminal_status("agt-a")),
        "matching task was not stopped"
    );
    assert!(
        !fixture.sink.has_terminal_status("agt-b"),
        "non-matching task must keep running"
    );
    assert!(fixture.signals.signals_for(9110).is_empty());
    fixture.registry.stop("agt-b").expect("cleanup stop");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture.sink.has_terminal_status("agt-b")),
        "cleanup stop did not finish"
    );
}

#[test]
fn stop_for_root_and_reap_returns_only_after_matching_groups_are_reaped() {
    let fixture = fixture(Duration::from_secs(60));
    let root_a = unique_path("reap-a");
    let root_b = unique_path("reap-b");
    let cwd_a = root_a.join(".worktrees/agt-reap-a");
    let cwd_b = root_b.join(".worktrees/agt-reap-b");
    let process_a = FakeProcess::new(None, None);
    let process_b = FakeProcess::new(None, None);
    fixture.signals.track(9301, &process_a);
    fixture.signals.track(9302, &process_b);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_a, 9301).build(),
    ));
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_b, 9302).build(),
    ));
    dispatch(&fixture, "agt-reap-a", &root_a, &cwd_a).expect("start task a");
    dispatch(&fixture, "agt-reap-b", &root_b, &cwd_b).expect("start task b");
    fixture
        .registry
        .acknowledge("agt-reap-a")
        .expect("acknowledge a");
    fixture
        .registry
        .acknowledge("agt-reap-b")
        .expect("acknowledge b");

    assert!(
        fixture.registry.stop_for_root_and_reap(&root_a),
        "matching groups must be reaped within the stop budget"
    );

    assert_eq!(
        process_a.exit_code(),
        Some(137),
        "the process must be dead before stop_for_root_and_reap returns"
    );
    assert_eq!(
        fixture.signals.signals_for(9301),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(fixture.signals.signals_for(9302).is_empty());
    assert_eq!(process_b.exit_code(), None);
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-reap-a")),
        "reaped task did not publish a terminal status"
    );
    assert!(
        fixture.registry.stop_for_root_and_reap(&root_a),
        "a root without live tasks must report reaped immediately"
    );
    fixture.registry.stop("agt-reap-b").expect("cleanup stop");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-reap-b")),
        "cleanup stop did not finish"
    );
}

#[test]
fn interleaved_stdout_and_stderr_chunks_keep_strictly_increasing_sequences() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("interleave");
    let cwd = root.join(".worktrees/agt-interleave");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9303, &process);
    let (stdout_sender, stdout_receiver) = mpsc::channel::<Vec<u8>>();
    let (stderr_sender, stderr_receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9303)
            .with_stdout_receiver(stdout_receiver)
            .with_stderr_receiver(stderr_receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-interleave", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-interleave")
        .expect("acknowledge");

    const CHUNKS_PER_STREAM: usize = 150;
    let stdout_writer = thread::spawn(move || {
        for index in 0..CHUNKS_PER_STREAM {
            stdout_sender
                .send(format!("out-{index}").into_bytes())
                .expect("send stdout chunk");
        }
    });
    let stderr_writer = thread::spawn(move || {
        for index in 0..CHUNKS_PER_STREAM {
            stderr_sender
                .send(format!("err-{index}").into_bytes())
                .expect("send stderr chunk");
        }
    });
    stdout_writer.join().expect("stdout writer");
    stderr_writer.join().expect("stderr writer");

    assert!(
        wait_until(EVENT_DEADLINE, || outputs_for(
            &fixture.sink,
            "agt-interleave"
        )
        .len()
            >= CHUNKS_PER_STREAM * 2),
        "interleaved output did not arrive completely"
    );
    process.set_exited(0);
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-interleave")),
        "task did not reach a terminal status"
    );

    let outputs = outputs_for(&fixture.sink, "agt-interleave");
    assert_eq!(outputs.len(), CHUNKS_PER_STREAM * 2);
    for (position, event) in outputs.iter().enumerate() {
        assert_eq!(
            event.sequence,
            (position + 1) as u64,
            "output sequences must arrive strictly increasing with zero drops"
        );
    }
    let stdout_chunks: Vec<&str> = outputs
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
        .map(|event| event.chunk.as_str())
        .collect();
    let stderr_chunks: Vec<&str> = outputs
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stderr)
        .map(|event| event.chunk.as_str())
        .collect();
    assert_eq!(stdout_chunks.len(), CHUNKS_PER_STREAM);
    assert_eq!(stderr_chunks.len(), CHUNKS_PER_STREAM);
}

#[test]
fn spawn_failure_releases_admission_and_entry() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("spawn-fail");
    fixture
        .spawner
        .script(FakeSpawnOutcome::Fail("spawn exploded".to_string()));
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
        ..start_request("agt-fail", &root)
    };
    let outcome = fixture.registry.start(request, fake_plan(&root), admission);
    assert_eq!(outcome.err().as_deref(), Some("spawn exploded"));
    assert!(fixture.registry.acknowledge("agt-fail").is_err());
    assert!(
        fixture
            .admission
            .reserve(
                &workspace("ws-agent-tests"),
                &root,
                &root,
                AgentTaskIsolation::InPlace
            )
            .is_ok(),
        "admission leaked after spawn failure"
    );
}

#[test]
fn reader_fault_kills_group_and_releases_admission() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("reader-fault");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9111, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9111)
            .with_stdout_reader_fault()
            .build(),
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
        ..start_request("agt-reader", &root)
    };
    let outcome = fixture.registry.start(request, fake_plan(&root), admission);
    assert_eq!(
        outcome.err().as_deref(),
        Some("stdout reader fault injected")
    );
    assert_eq!(
        fixture.signals.signals_for(9111),
        vec![KILL_PROCESS_GROUP_SIGNAL],
        "faulted start must kill the spawned process group"
    );
    assert!(fixture.registry.acknowledge("agt-reader").is_err());
    assert!(
        fixture
            .admission
            .reserve(
                &workspace("ws-agent-tests"),
                &root,
                &root,
                AgentTaskIsolation::InPlace
            )
            .is_ok(),
        "admission leaked after reader fault"
    );
}

#[test]
fn duplicate_task_id_is_rejected() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("duplicate");
    let cwd = root.join(".worktrees/agt-dup");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9112, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9112).build(),
    ));
    dispatch(&fixture, "agt-dup", &root, &cwd).expect("first start");
    let duplicate = dispatch(
        &fixture,
        "agt-dup",
        &root,
        &root.join(".worktrees/agt-dup-2"),
    );
    assert_eq!(
        duplicate.err().as_deref(),
        Some("An agent task with this taskId already exists.")
    );
    fixture.registry.stop("agt-dup").expect("cleanup stop");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
}

#[test]
fn registry_drop_kills_all_owned_process_groups() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("drop");
    let cwd_a = root.join(".worktrees/agt-drop-a");
    let cwd_b = root.join(".worktrees/agt-drop-b");
    let process_a = FakeProcess::new(None, None);
    let process_b = FakeProcess::new(None, None);
    fixture.signals.track(9113, &process_a);
    fixture.signals.track(9114, &process_b);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_a, 9113).build(),
    ));
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process_b, 9114).build(),
    ));
    dispatch(&fixture, "agt-drop-a", &root, &cwd_a).expect("start task a");
    dispatch(&fixture, "agt-drop-b", &root, &cwd_b).expect("start task b");
    let Fixture {
        registry, signals, ..
    } = fixture;
    drop(registry);
    assert!(
        signals
            .signals_for(9113)
            .contains(&KILL_PROCESS_GROUP_SIGNAL),
        "first owned process group must be killed on drop"
    );
    assert!(
        signals
            .signals_for(9114)
            .contains(&KILL_PROCESS_GROUP_SIGNAL),
        "second owned process group must be killed on drop"
    );
    assert!(process_a.exit_code().is_some());
    assert!(process_b.exit_code().is_some());
}

#[test]
fn real_process_full_lifecycle_streams_output_and_exit_code() {
    let shell = probe_binary(&["/bin/sh"]);
    assert!(shell.is_some(), "no POSIX shell found at /bin/sh");
    let shell = shell.expect("probed shell");
    let cwd = unique_path("real-lifecycle");
    fs::create_dir_all(&cwd).expect("real cwd");
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission_registry),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let admission = admission_registry
        .reserve(
            &workspace("ws-real"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("real admission");
    let plan = AgentTaskSpawnPlan::for_tests(
        shell,
        vec![
            "-c".to_string(),
            "printf out; printf err 1>&2; exit 7".to_string(),
        ],
        cwd.clone(),
        Vec::new(),
    );
    let request = AgentTaskStartRequest {
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        ..start_request("agt-real", &cwd)
    };
    registry
        .start(request, plan, admission)
        .expect("real start");
    registry.acknowledge("agt-real").expect("real acknowledge");
    assert!(
        wait_until(Duration::from_secs(10), || sink
            .has_terminal_status("agt-real")),
        "real process did not finish"
    );
    let statuses = statuses_for(&sink, "agt-real");
    assert!(matches!(
        statuses.last().map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 7 })
    ));
    let outputs = outputs_for(&sink, "agt-real");
    let stdout: String = outputs
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
        .map(|event| event.chunk.as_str())
        .collect();
    let stderr: String = outputs
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stderr)
        .map(|event| event.chunk.as_str())
        .collect();
    assert_eq!(stdout, "out");
    assert_eq!(stderr, "err");
}

#[test]
fn real_process_group_kill_reaps_the_whole_child_tree() {
    let shell = probe_binary(&["/bin/sh"]);
    assert!(shell.is_some(), "no POSIX shell found at /bin/sh");
    let shell = shell.expect("probed shell");
    let sleep = probe_binary(&["/bin/sleep", "/usr/bin/sleep"]);
    assert!(sleep.is_some(), "no sleep binary found");
    let sleep = sleep.expect("probed sleep").to_string_lossy().into_owned();
    let cwd = unique_path("real-kill");
    fs::create_dir_all(&cwd).expect("real cwd");
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission_registry),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let admission = admission_registry
        .reserve(
            &workspace("ws-real"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("real admission");
    let script = format!("{sleep} 30 & printf ready; {sleep} 30");
    let plan = AgentTaskSpawnPlan::for_tests(
        shell,
        vec!["-c".to_string(), script],
        cwd.clone(),
        Vec::new(),
    );
    let request = AgentTaskStartRequest {
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        ..start_request("agt-tree", &cwd)
    };
    registry
        .start(request, plan, admission)
        .expect("real start");
    registry.acknowledge("agt-tree").expect("real acknowledge");
    assert!(
        wait_until(Duration::from_secs(10), || {
            outputs_for(&sink, "agt-tree")
                .iter()
                .any(|event| event.chunk.contains("ready"))
        }),
        "grandchild marker output did not arrive"
    );
    registry.stop("agt-tree").expect("real stop");
    assert!(
        wait_until(Duration::from_secs(10), || sink
            .has_terminal_status("agt-tree")),
        "killed process tree was not reaped"
    );
    let statuses = statuses_for(&sink, "agt-tree");
    assert!(matches!(
        statuses.last().map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
    assert!(
        wait_until(Duration::from_secs(10), || registry
            .live_worker_thread_count()
            == 0),
        "output pumps did not reach EOF; a process in the tree survived the group kill"
    );
}
