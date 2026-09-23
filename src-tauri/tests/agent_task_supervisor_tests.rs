#![cfg(unix)]
#![allow(dead_code)]

#[path = "../src/claude_model_manifest.rs"]
mod claude_model_manifest;
#[path = "../src/claude_model_manifest_domain.rs"]
mod claude_model_manifest_domain;

#[path = "../src/agent_questions.rs"]
mod agent_questions;

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
    AgentTaskAdmissionRegistry, AGENT_TASK_GLOBAL_LIMIT, AGENT_TASK_GLOBAL_LIMIT_ERROR,
    AGENT_TASK_REPOSITORY_LIMIT,
};
use agent_task_spawner::agent_launch::{
    AgentLaunchOptions, ClaudeContextChoice, ClaudeEffortChoice, ClaudeModelChoice,
    ClaudePermissionMode, CodexExecutionMode, CodexModelChoice,
};
use agent_task_spawner::agent_task_input::{
    AgentTaskInput, AgentTaskSteerRejection, MAX_AGENT_STEERS_PER_TURN,
};
use agent_task_spawner::{
    claude_user_frame, plan_agent_invocation, AgentChild, AgentCliInvocation, AgentProcessSpawner,
    AgentPromptTransport, AgentTaskSpawnPlan, StdAgentProcessSpawner, AGENT_TASK_INHERITED_ENV,
    MAX_AGENT_PROMPT_BYTES,
};
use agent_task_supervisor::{
    AgentProcessGroupSignalSender, AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent,
    AgentTaskOutputStream, AgentTaskRegistry, AgentTaskStartRequest, AgentTaskStartResult,
    AgentTaskStatusEvent, AgentTaskStatusPayload, KILL_PROCESS_GROUP_SIGNAL,
    MAX_QUEUED_AGENT_TASK_EVENTS, TERMINATE_PROCESS_GROUP_SIGNAL,
};
use std::{
    collections::{HashMap, VecDeque},
    fs, io,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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
    requires_ack: AtomicBool,
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
    fn requires_output_acknowledgement(&self) -> bool {
        self.requires_ack.load(Ordering::SeqCst)
    }
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
    error_after_segments: bool,
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
            return match receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(segment) => Ok(self.deliver(segment, buffer)),
                Err(mpsc::RecvTimeoutError::Timeout) => Err(io::ErrorKind::WouldBlock.into()),
                Err(mpsc::RecvTimeoutError::Disconnected) => Ok(0),
            };
        }
        if self.error_after_segments {
            self.error_after_segments = false;
            return Err(io::Error::other("output read failure injected"));
        }
        self.process.wait_exited_blocking();
        Ok(0)
    }
}

#[derive(Default)]
struct RecordingInput {
    frames: Mutex<Vec<Vec<u8>>>,
    closed: Mutex<bool>,
    journal: Arc<Mutex<Vec<String>>>,
    failure: Option<io::ErrorKind>,
    write_release: Option<Arc<(Mutex<bool>, Condvar)>>,
    writing: AtomicU64,
}

impl RecordingInput {
    fn build(
        journal: &Arc<Mutex<Vec<String>>>,
        failure: Option<io::ErrorKind>,
        write_release: Option<Arc<(Mutex<bool>, Condvar)>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            journal: Arc::clone(journal),
            failure,
            write_release,
            ..Self::default()
        })
    }

    fn frames(&self) -> Vec<Vec<u8>> {
        self.frames.lock().expect("frames lock").clone()
    }

    fn is_closed(&self) -> bool {
        *self.closed.lock().expect("closed lock")
    }

    fn writes_in_flight(&self) -> u64 {
        self.writing.load(Ordering::SeqCst)
    }
}

struct RecordingInputHandle {
    input: Arc<RecordingInput>,
}

impl AgentTaskInput for RecordingInputHandle {
    fn write_frame(&mut self, frame: &[u8], _deadline: Instant) -> io::Result<()> {
        if let Some(kind) = self.input.failure {
            return Err(io::Error::from(kind));
        }
        if let Some(release) = &self.input.write_release {
            self.input.writing.fetch_add(1, Ordering::SeqCst);
            let released = release.0.lock().expect("release lock");
            let (_released, timeout) = release
                .1
                .wait_timeout_while(released, EVENT_DEADLINE, |released| !*released)
                .expect("release wait");
            self.input.writing.fetch_sub(1, Ordering::SeqCst);
            assert!(
                !timeout.timed_out(),
                "test did not release the blocked writer"
            );
        }
        self.input
            .frames
            .lock()
            .expect("frames lock")
            .push(frame.to_vec());
        self.input
            .journal
            .lock()
            .expect("journal lock")
            .push("frame".to_string());
        Ok(())
    }

    fn close(&mut self) {
        *self.input.closed.lock().expect("closed lock") = true;
        self.input
            .journal
            .lock()
            .expect("journal lock")
            .push("close".to_string());
    }
}

struct FakeChild {
    questions: Option<Arc<agent_questions::AgentQuestionSession>>,
    process: Arc<FakeProcess>,
    process_group_id: i32,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
    fail_stdout_reader: bool,
    panic_stdout_reader: bool,
    panic_try_wait: bool,
    fail_try_wait: bool,
    input: Option<Arc<RecordingInput>>,
}

impl AgentChild for FakeChild {
    fn take_questions(&mut self) -> Option<Arc<agent_questions::AgentQuestionSession>> {
        self.questions.clone()
    }
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        if self.panic_stdout_reader {
            panic!("stdout reader panic injected");
        }
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

    fn observe_exit(&mut self) -> Result<bool, String> {
        if self.panic_try_wait {
            self.panic_try_wait = false;
            panic!("try wait panic injected");
        }
        if self.fail_try_wait {
            self.fail_try_wait = false;
            return Err("try wait failure injected".to_string());
        }
        Ok(self.process.exit_code().is_some())
    }

    fn reap(&mut self) -> Result<i32, String> {
        self.process
            .exit_code()
            .ok_or_else(|| "fake child was reaped before exit".to_string())
    }

    fn process_group_id(&self) -> i32 {
        self.process_group_id
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.process.set_exited(137);
        Ok(())
    }

    fn take_input(&mut self) -> Option<Box<dyn AgentTaskInput>> {
        let input = self.input.take()?;
        Some(Box::new(RecordingInputHandle { input }))
    }
}

struct FakeChildSpec {
    process: Arc<FakeProcess>,
    process_group_id: i32,
    stdout_segments: Vec<Vec<u8>>,
    stdout_receiver: Option<mpsc::Receiver<Vec<u8>>>,
    stderr_receiver: Option<mpsc::Receiver<Vec<u8>>>,
    stdout_error_after_segments: bool,
    fail_stdout_reader: bool,
    panic_stdout_reader: bool,
    panic_try_wait: bool,
    fail_try_wait: bool,
    input: Option<Arc<RecordingInput>>,
}

impl FakeChildSpec {
    fn new(process: &Arc<FakeProcess>, process_group_id: i32) -> Self {
        Self {
            process: Arc::clone(process),
            process_group_id,
            stdout_segments: Vec::new(),
            stdout_receiver: None,
            stderr_receiver: None,
            stdout_error_after_segments: false,
            fail_stdout_reader: false,
            panic_stdout_reader: false,
            panic_try_wait: false,
            fail_try_wait: false,
            input: None,
        }
    }

    fn with_input(mut self, input: &Arc<RecordingInput>) -> Self {
        self.input = Some(Arc::clone(input));
        self
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

    fn with_stdout_read_error_after_segments(mut self) -> Self {
        self.stdout_error_after_segments = true;
        self
    }

    fn with_stdout_reader_fault(mut self) -> Self {
        self.fail_stdout_reader = true;
        self
    }

    fn with_stdout_reader_panic(mut self) -> Self {
        self.panic_stdout_reader = true;
        self
    }

    fn with_try_wait_panic(mut self) -> Self {
        self.panic_try_wait = true;
        self
    }

    fn with_try_wait_failure(mut self) -> Self {
        self.fail_try_wait = true;
        self
    }

    fn build(self) -> FakeChild {
        let stdout = FakeReader {
            segments: self.stdout_segments.into_iter().collect(),
            receiver: self.stdout_receiver,
            process: Arc::clone(&self.process),
            error_after_segments: self.stdout_error_after_segments,
        };
        let stderr = FakeReader {
            segments: VecDeque::new(),
            receiver: self.stderr_receiver,
            process: Arc::clone(&self.process),
            error_after_segments: false,
        };
        FakeChild {
            questions: None,
            process: self.process,
            process_group_id: self.process_group_id,
            stdout: Some(Box::new(stdout)),
            stderr: Some(Box::new(stderr)),
            fail_stdout_reader: self.fail_stdout_reader,
            panic_stdout_reader: self.panic_stdout_reader,
            panic_try_wait: self.panic_try_wait,
            fail_try_wait: self.fail_try_wait,
            input: self.input,
        }
    }
}

enum FakeSpawnOutcome {
    Fail(String),
    Child(FakeChild),
    Panic,
    Blocked(mpsc::Receiver<()>, FakeChild),
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

    fn pending_outcomes(&self) -> usize {
        self.outcomes.lock().expect("outcomes lock").len()
    }
}

impl AgentProcessSpawner for FakeSpawner {
    fn spawn(&self, _plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let outcome = self.outcomes.lock().expect("outcomes lock").pop_front();
        match outcome {
            Some(FakeSpawnOutcome::Fail(message)) => Err(message),
            Some(FakeSpawnOutcome::Child(child)) => Ok(Box::new(child)),
            Some(FakeSpawnOutcome::Panic) => panic!("spawn panic injected"),
            Some(FakeSpawnOutcome::Blocked(release, child)) => {
                release.recv().expect("release blocked spawn");
                Ok(Box::new(child))
            }
            None => Err("no scripted spawn outcome".to_string()),
        }
    }
}

#[derive(Default)]
struct RecordingSignalSender {
    signals: Mutex<Vec<(i32, i32)>>,
    processes: Mutex<HashMap<i32, Arc<FakeProcess>>>,
    journal: Arc<Mutex<Vec<String>>>,
}

impl RecordingSignalSender {
    fn track(&self, process_group_id: i32, process: &Arc<FakeProcess>) {
        self.processes
            .lock()
            .expect("processes lock")
            .insert(process_group_id, Arc::clone(process));
    }

    fn journal(&self) -> Arc<Mutex<Vec<String>>> {
        Arc::clone(&self.journal)
    }

    fn journal_entries(&self) -> Vec<String> {
        self.journal.lock().expect("journal lock").clone()
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
        self.journal
            .lock()
            .expect("journal lock")
            .push("signal".to_string());
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

struct PanickingSignalSender;

impl AgentProcessGroupSignalSender for PanickingSignalSender {
    fn send(&self, _process_group_id: i32, _signal: i32) -> Result<(), String> {
        panic!("signal panic injected");
    }
}

struct FailingSignalSender;

impl AgentProcessGroupSignalSender for FailingSignalSender {
    fn send(&self, _process_group_id: i32, _signal: i32) -> Result<(), String> {
        Err("signal failure injected".to_string())
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
        thread_id: "thread-a".into(),
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
        starts_at_line_boundary: true,
    };
    assert_wire(
        &output,
        r#"{"taskId":"agt-1","sequence":7,"stream":"stdout","chunk":"hello","truncated":false,"startsAtLineBoundary":true}"#,
    );
    let marker = AgentTaskOutputEvent {
        task_id: "agt-1".to_string(),
        sequence: 8,
        stream: AgentTaskOutputStream::Stderr,
        chunk: String::new(),
        truncated: true,
        starts_at_line_boundary: false,
    };
    assert_wire(
        &marker,
        r#"{"taskId":"agt-1","sequence":8,"stream":"stderr","chunk":"","truncated":true,"startsAtLineBoundary":false}"#,
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
    context: ClaudeContextChoice::TwoHundredK,
    fast_mode: false,
    thinking_mode: false,
    chrome: true,
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
    assert_eq!(
        claude.program(),
        cli.canonicalize().expect("canonical CLI path")
    );
    assert_eq!(
        claude.args(),
        [
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--append-system-prompt".to_string(),
            "Codevo can preview workspace files in this conversation. When the user requests a visual design or diagram, you may create self-contained HTML inside the current workspace and return a workspace-relative Markdown link. Inline all CSS and JavaScript; previews have no network access or external assets. If available tools create an image, save it inside the workspace and return a workspace-relative Markdown image. This does not provide an image-generation tool. Follow user and repository instructions; do not create files for ordinary answers or publish externally unless requested.".to_string(),
            "--chrome".to_string(),
            "--thinking-display".to_string(),
            "summarized".to_string(),
        ]
    );
    assert_eq!(
        claude.prompt(),
        &AgentPromptTransport::Stdin(claude_user_frame("do the task", &[]).into()),
        "the claude prompt travels on stdin, never in argv or ps output"
    );
    assert_eq!(claude.cwd(), directory.as_path());
    for (key, value) in claude.env() {
        assert!(
            AGENT_TASK_INHERITED_ENV.contains(&key.as_str())
                || (key == "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS" && value == "0"),
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
            "--skip-git-repo-check".to_string(),
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
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--append-system-prompt".to_string(),
            "Codevo can preview workspace files in this conversation. When the user requests a visual design or diagram, you may create self-contained HTML inside the current workspace and return a workspace-relative Markdown link. Inline all CSS and JavaScript; previews have no network access or external assets. If available tools create an image, save it inside the workspace and return a workspace-relative Markdown image. This does not provide an image-generation tool. Follow user and repository instructions; do not create files for ordinary answers or publish externally unless requested.".to_string(),
            "--chrome".to_string(),
            "--thinking-display".to_string(),
            "summarized".to_string(),
            "--resume".to_string(),
            "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string(),
        ]
    );
    assert_eq!(
        resumed_claude.prompt(),
        &AgentPromptTransport::Stdin(claude_user_frame("do the task", &[]).into())
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
            "--skip-git-repo-check".to_string(),
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
    assert_eq!(AGENT_TASK_GLOBAL_LIMIT, 64);
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
fn admission_allows_one_repository_to_use_all_global_slots() {
    assert_eq!(AGENT_TASK_REPOSITORY_LIMIT, 64);
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
        Some(AGENT_TASK_GLOBAL_LIMIT_ERROR)
    );
    held.pop();
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
fn admission_allows_concurrent_threads_in_shared_local_and_worktree_directories() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("shared-checkouts");
    let mut held = Vec::new();
    for cwd in [&root, &root.join(".worktrees/shared")] {
        for isolation in [AgentTaskIsolation::InPlace, AgentTaskIsolation::Worktree] {
            for owner in ["ws-a", "ws-a", "ws-b"] {
                held.push(
                    registry
                        .reserve(&workspace(owner), &root, cwd, isolation)
                        .expect("threads may share a working directory across workspace owners"),
                );
            }
        }
    }
    assert_eq!(held.len(), 12);
}

#[test]
fn shared_checkout_admissions_remain_bounded_and_release_exactly_one_slot() {
    let registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let root = unique_path("shared-limit");
    let mut held = Vec::new();
    for _ in 0..AGENT_TASK_GLOBAL_LIMIT {
        held.push(
            registry
                .reserve(
                    &workspace("ws-a"),
                    &root,
                    &root,
                    AgentTaskIsolation::InPlace,
                )
                .expect("shared checkout below global limit"),
        );
    }
    assert_eq!(
        registry
            .reserve(
                &workspace("ws-a"),
                &root,
                &root,
                AgentTaskIsolation::InPlace
            )
            .err()
            .as_deref(),
        Some(AGENT_TASK_GLOBAL_LIMIT_ERROR)
    );
    held.pop();
    let replacement = registry
        .reserve(
            &workspace("ws-a"),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("dropping one shared admission frees one slot");
    assert_eq!(
        registry
            .reserve(
                &workspace("ws-a"),
                &root,
                &root,
                AgentTaskIsolation::InPlace
            )
            .err()
            .as_deref(),
        Some(AGENT_TASK_GLOBAL_LIMIT_ERROR)
    );
    drop(replacement);
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
fn output_reader_failure_publishes_one_ordered_incomplete_marker() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("reader-failure");
    let cwd = root.join(".worktrees/agt-reader-failure");
    let process = FakeProcess::new(Some(0), None);
    fixture.signals.track(9108, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9108)
            .with_stdout_read_error_after_segments()
            .build(),
    ));

    dispatch(&fixture, "agt-reader-failure", &root, &cwd).expect("start task");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
    fixture
        .registry
        .acknowledge("agt-reader-failure")
        .expect("acknowledge");

    let outputs = outputs_for(&fixture.sink, "agt-reader-failure");
    assert_eq!(outputs.len(), 1);
    assert_eq!(outputs[0].sequence, 1);
    assert_eq!(outputs[0].chunk, "");
    assert!(outputs[0].truncated);
}

#[test]
fn output_bytes_then_reader_failure_publish_data_before_one_incomplete_marker() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("bytes-reader-failure");
    let cwd = root.join(".worktrees/agt-bytes-reader-failure");
    let process = FakeProcess::new(Some(0), None);
    fixture.signals.track(9109, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9109)
            .with_stdout_segments(vec![b"hello".to_vec()])
            .with_stdout_read_error_after_segments()
            .build(),
    ));

    dispatch(&fixture, "agt-bytes-reader-failure", &root, &cwd).expect("start task");
    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "task workers did not settle"
    );
    fixture
        .registry
        .acknowledge("agt-bytes-reader-failure")
        .expect("acknowledge");

    let outputs = outputs_for(&fixture.sink, "agt-bytes-reader-failure");
    assert_eq!(outputs.len(), 2);
    assert_eq!(outputs[0].sequence, 1);
    assert_eq!(outputs[0].chunk, "hello");
    assert!(!outputs[0].truncated);
    assert_eq!(outputs[1].sequence, 2);
    assert_eq!(outputs[1].chunk, "");
    assert!(outputs[1].truncated);
}

#[test]
fn stalled_grandchild_output_descriptor_marks_stream_incomplete_before_terminal() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("stalled-grandchild-output");
    let cwd = root.join(".worktrees/agt-stalled-grandchild-output");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9110, &process);
    let (_escaped_descriptor_owner, stdout_receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9110)
            .with_stdout_receiver(stdout_receiver)
            .build(),
    ));

    dispatch(&fixture, "agt-stalled-grandchild-output", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-stalled-grandchild-output")
        .expect("acknowledge");
    process.set_exited(0);

    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-stalled-grandchild-output")),
        "task did not reach terminal after the pump drain timeout"
    );
    let outputs = outputs_for(&fixture.sink, "agt-stalled-grandchild-output");
    assert_eq!(outputs.len(), 1);
    assert_eq!(outputs[0].sequence, 1);
    assert_eq!(outputs[0].chunk, "");
    assert!(outputs[0].truncated);

    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .registry
            .live_worker_thread_count()
            == 0),
        "stalled output pump did not settle after forced descendant cleanup"
    );
    assert!(fixture
        .signals
        .signals_for(9110)
        .contains(&KILL_PROCESS_GROUP_SIGNAL));
    let signals = Arc::clone(&fixture.signals);
    drop(fixture);
    assert_eq!(
        signals
            .signals_for(9110)
            .into_iter()
            .filter(|signal| *signal == KILL_PROCESS_GROUP_SIGNAL)
            .count(),
        1,
        "released process-group authority must not signal a recycled id during registry drop"
    );
}

#[test]
fn failed_group_kill_cannot_strand_a_cancellable_escaped_output_reader() {
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission_registry),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::new(FailingSignalSender),
        Duration::from_secs(60),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let root = unique_path("failed-kill-escaped-output");
    let process = FakeProcess::new(None, None);
    let (_escaped_descriptor_owner, stdout_receiver) = mpsc::channel::<Vec<u8>>();
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9111)
            .with_stdout_receiver(stdout_receiver)
            .build(),
    ));
    let admission = admission_registry
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
        ..start_request("agt-failed-kill-output", &root)
    };

    registry
        .start(request, fake_plan(&root), admission)
        .expect("start task");
    registry
        .acknowledge("agt-failed-kill-output")
        .expect("acknowledge");
    process.set_exited(0);

    assert!(wait_until(EVENT_DEADLINE, || sink
        .has_terminal_status("agt-failed-kill-output")));
    assert!(wait_until(EVENT_DEADLINE, || registry
        .live_worker_thread_count()
        == 0));
    let outputs = outputs_for(&sink, "agt-failed-kill-output");
    assert_eq!(outputs.len(), 1);
    assert!(outputs[0].truncated);
    assert_eq!(outputs[0].chunk, "");
    assert!(matches!(
        statuses_for(&sink, "agt-failed-kill-output")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Failed { message })
            if message.contains("process-group cleanup failed")
    ));
}

#[test]
fn long_running_output_continues_beyond_the_former_lifetime_limit() {
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
    let total = 4097;
    for _ in 0..total {
        sender.send(vec![b'x']).expect("send chunk");
    }
    assert!(
        wait_until(Duration::from_secs(20), || {
            outputs_for(&fixture.sink, "agt-cap").len() as u64 == total
        }),
        "long-running output stream did not settle"
    );
    let outputs = outputs_for(&fixture.sink, "agt-cap");
    assert!(outputs
        .iter()
        .all(|event| !event.truncated && event.chunk == "x"));
    assert_eq!(outputs.last().unwrap().sequence, total);
    sender
        .send(b"final response".to_vec())
        .expect("send final response");
    assert!(wait_until(EVENT_DEADLINE, || {
        outputs_for(&fixture.sink, "agt-cap")
            .last()
            .is_some_and(|event| {
                event.sequence == total + 1 && event.chunk == "final response" && !event.truncated
            })
    }));
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
fn incomplete_stream_does_not_suppress_later_output_from_the_other_stream() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("incomplete-then-output");
    let cwd = root.join(".worktrees/agt-incomplete-output");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9199, &process);
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9199)
            .with_stdout_read_error_after_segments()
            .with_stderr_receiver(receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-incomplete-output", &root, &cwd).expect("start task");
    fixture
        .registry
        .acknowledge("agt-incomplete-output")
        .expect("acknowledge");
    assert!(wait_until(EVENT_DEADLINE, || {
        outputs_for(&fixture.sink, "agt-incomplete-output")
            .iter()
            .any(|event| event.truncated)
    }));
    sender
        .send(b"final diagnostic".to_vec())
        .expect("send final output");
    assert!(wait_until(EVENT_DEADLINE, || {
        outputs_for(&fixture.sink, "agt-incomplete-output")
            .last()
            .is_some_and(|event| {
                event.sequence == 2 && event.chunk == "final diagnostic" && !event.truncated
            })
    }));
    drop(sender);
    process.set_exited(0);
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-incomplete-output")));
}

#[test]
fn asynchronous_output_is_bounded_and_terminal_waits_for_consumption() {
    let fixture = fixture(Duration::from_secs(60));
    fixture.sink.requires_ack.store(true, Ordering::SeqCst);
    let root = unique_path("ack-flow");
    let cwd = root.join(".worktrees/agt-ack-flow");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9198, &process);
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9198)
            .with_stdout_receiver(receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-ack-flow", &root, &cwd).expect("start task");
    fixture.registry.acknowledge("agt-ack-flow").unwrap();
    for _ in 0..4097 {
        sender.send(vec![b'x']).unwrap();
    }
    sender.send(b"final response".to_vec()).unwrap();
    drop(sender);
    process.set_exited(0);
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .registry
        .live_worker_thread_count()
        == 1));
    let initial = outputs_for(&fixture.sink, "agt-ack-flow");
    assert_eq!(
        initial.len(),
        agent_task_supervisor::MAX_UNACKNOWLEDGED_AGENT_OUTPUT_EVENTS
    );
    assert!(!fixture.sink.has_terminal_status("agt-ack-flow"));
    assert!(fixture
        .registry
        .acknowledge_output_for_workspace("agt-ack-flow", "foreign", 64)
        .is_err());
    assert!(fixture
        .registry
        .acknowledge_output_for_workspace("agt-ack-flow", "ws-agent-tests", 4098)
        .is_err());
    let mut consumed = 0;
    for _ in 0..8 {
        let outputs = outputs_for(&fixture.sink, "agt-ack-flow");
        let last = outputs.last().unwrap().sequence;
        if last == consumed {
            break;
        }
        fixture
            .registry
            .acknowledge_output_for_workspace("agt-ack-flow", "ws-agent-tests", last)
            .unwrap();
        consumed = last;
    }
    let outputs = outputs_for(&fixture.sink, "agt-ack-flow");
    assert_eq!(outputs.last().unwrap().chunk, "final response");
    assert_eq!(outputs.last().unwrap().sequence, 4098);
    assert!(outputs
        .windows(2)
        .any(|pair| pair[1].sequence > pair[0].sequence + 1));
    assert!(fixture.sink.has_terminal_status("agt-ack-flow"));
    assert!(
        outputs.len()
            <= agent_task_supervisor::MAX_UNACKNOWLEDGED_AGENT_OUTPUT_EVENTS
                + MAX_QUEUED_AGENT_TASK_EVENTS
    );
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .registry
        .live_worker_thread_count()
        == 0));
}

#[test]
fn output_boundary_metadata_tracks_each_stream_independently() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("line-boundary");
    let cwd = root.join(".worktrees/agt-line-boundary");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9197, &process);
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    let (stderr_sender, stderr_receiver) = mpsc::channel::<Vec<u8>>();
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9197)
            .with_stdout_receiver(receiver)
            .with_stderr_receiver(stderr_receiver)
            .build(),
    ));
    dispatch(&fixture, "agt-line-boundary", &root, &cwd).unwrap();
    fixture.registry.acknowledge("agt-line-boundary").unwrap();
    for chunk in [b"first".as_slice(), b" remainder\n", b"next\n"] {
        sender.send(chunk.to_vec()).unwrap();
    }
    stderr_sender.send(b"diagnostic\n".to_vec()).unwrap();
    assert!(wait_until(EVENT_DEADLINE, || outputs_for(
        &fixture.sink,
        "agt-line-boundary"
    )
    .len()
        == 4));
    let outputs = outputs_for(&fixture.sink, "agt-line-boundary");
    let stdout: Vec<bool> = outputs
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
        .map(|event| event.starts_at_line_boundary)
        .collect();
    assert_eq!(stdout, vec![true, false, true]);
    assert!(
        outputs
            .iter()
            .find(|event| event.stream == AgentTaskOutputStream::Stderr)
            .unwrap()
            .starts_at_line_boundary
    );
    drop(sender);
    drop(stderr_sender);
    process.set_exited(0);
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-line-boundary")));
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
fn shared_local_checkout_tasks_keep_output_and_stop_ownership_independent() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("shared-local-runtime");
    for (task_id, process_group, output) in [
        ("agt-shared-a", 9791, "task a output"),
        ("agt-shared-b", 9792, "task b output"),
    ] {
        let process = FakeProcess::new(None, Some(143));
        fixture.signals.track(process_group, &process);
        fixture.spawner.script(FakeSpawnOutcome::Child(
            FakeChildSpec::new(&process, process_group)
                .with_stdout_segments(vec![output.as_bytes().to_vec()])
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
            .expect("shared local checkout admission");
        let request = AgentTaskStartRequest {
            thread_id: task_id.to_string(),
            isolation: AgentTaskIsolation::InPlace,
            worktree_path: None,
            ..start_request(task_id, &root)
        };
        fixture
            .registry
            .start(request, fake_plan(&root), admission)
            .unwrap();
        fixture.registry.acknowledge(task_id).unwrap();
    }
    assert!(wait_until(EVENT_DEADLINE, || {
        !outputs_for(&fixture.sink, "agt-shared-a").is_empty()
            && !outputs_for(&fixture.sink, "agt-shared-b").is_empty()
    }));
    assert_eq!(
        outputs_for(&fixture.sink, "agt-shared-a")[0].chunk,
        "task a output"
    );
    assert_eq!(
        outputs_for(&fixture.sink, "agt-shared-b")[0].chunk,
        "task b output"
    );
    fixture.registry.stop("agt-shared-a").unwrap();
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-shared-a")));
    assert!(!fixture.sink.has_terminal_status("agt-shared-b"));
    assert!(fixture.signals.signals_for(9792).is_empty());
    // Removal/shutdown by root must still reap every remaining process using that checkout.
    assert!(fixture.registry.stop_for_root_and_reap(&root));
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-shared-b")));
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .registry
        .live_worker_thread_count()
        == 0));
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
fn closed_start_admission_rejects_before_invoking_the_spawner() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("start-closed");
    fixture
        .spawner
        .script(FakeSpawnOutcome::Fail("must remain queued".to_string()));
    fixture.registry.close_start_admission();
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
        ..start_request("agt-closed", &root)
    };

    let error = fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect_err("closed admission");

    assert_eq!(error, agent_task_supervisor::AGENT_TASK_STARTS_CLOSED_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 1);
    assert!(fixture.registry.acknowledge("agt-closed").is_err());
}

#[test]
fn panicking_spawner_releases_the_pending_entry_and_admission() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("spawn-panic");
    fixture.spawner.script(FakeSpawnOutcome::Panic);
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
        ..start_request("agt-spawn-panic", &root)
    };

    let error = fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect_err("panic becomes bounded error");

    assert_eq!(error, "Agent task startup failed unexpectedly.");
    assert!(fixture.registry.acknowledge("agt-spawn-panic").is_err());
    assert!(fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn failed_signal_sender_uses_direct_child_kill_and_releases_admission() {
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission_registry),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        sink as Arc<dyn AgentTaskEventSink>,
        Arc::new(FailingSignalSender),
        Duration::from_secs(60),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let root = unique_path("signal-failure");
    let process = FakeProcess::new(None, None);
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9133)
            .with_stdout_reader_fault()
            .build(),
    ));
    let admission = admission_registry
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
        ..start_request("agt-signal-failure", &root)
    };

    let error = registry
        .start(request, fake_plan(&root), admission)
        .expect_err("reader fault rejects start");

    assert_eq!(error, "stdout reader fault injected");
    assert_eq!(process.exit_code(), Some(137));
    assert!(registry.acknowledge("agt-signal-failure").is_err());
    assert!(admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn waiter_start_failure_retains_child_for_kill_reap_and_cleanup() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("waiter-start-failure");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9134, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9134).build(),
    ));
    fixture.registry.fail_next_waiter_start_for_tests();
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
        ..start_request("agt-waiter-start-failure", &root)
    };

    let error = fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect_err("waiter start failure");

    assert_eq!(error, "Unable to start agent task worker: injected");
    assert_eq!(process.exit_code(), Some(137));
    assert!(fixture
        .registry
        .acknowledge("agt-waiter-start-failure")
        .is_err());
    assert!(fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn panicking_waiter_child_is_killed_reaped_and_completed_as_failed() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("waiter-panic");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9135, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9135)
            .with_try_wait_panic()
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
        ..start_request("agt-waiter-panic", &root)
    };

    fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect("start before waiter panic");
    fixture
        .registry
        .acknowledge("agt-waiter-panic")
        .expect("acknowledge waiter panic");

    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-waiter-panic")));
    assert_eq!(process.exit_code(), Some(137));
    assert!(fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn waiter_error_with_failed_signals_uses_direct_kill_and_releases_admission() {
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission_registry),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::new(FailingSignalSender),
        Duration::from_secs(60),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let root = unique_path("waiter-error-signal-failure");
    let process = FakeProcess::new(None, None);
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9137)
            .with_try_wait_failure()
            .build(),
    ));
    let admission = admission_registry
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
        ..start_request("agt-waiter-error", &root)
    };

    registry
        .start(request, fake_plan(&root), admission)
        .expect("start waiter error task");
    registry
        .acknowledge("agt-waiter-error")
        .expect("acknowledge waiter error task");

    assert!(wait_until(EVENT_DEADLINE, || sink
        .has_terminal_status("agt-waiter-error")));
    assert_eq!(process.exit_code(), Some(137));
    assert_eq!(statuses_for(&sink, "agt-waiter-error").len(), 2);
    assert!(admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn panicking_watchdog_signals_fall_back_to_waiter_owned_child_kill() {
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission_registry),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::new(PanickingSignalSender),
        Duration::from_millis(20),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let root = unique_path("watchdog-signal-panic");
    let process = FakeProcess::new(None, None);
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9136).build(),
    ));
    let admission = admission_registry
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
        ..start_request("agt-watchdog-signal-panic", &root)
    };

    registry
        .start(request, fake_plan(&root), admission)
        .expect("start watchdog task");
    registry
        .acknowledge("agt-watchdog-signal-panic")
        .expect("acknowledge watchdog task");

    assert!(wait_until(EVENT_DEADLINE, || sink
        .has_terminal_status("agt-watchdog-signal-panic")));
    assert!(wait_until(EVENT_DEADLINE, || process.exit_code() == Some(137)));
    assert!(admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn panicking_child_reader_is_killed_reaped_and_releases_admission() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("child-panic");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9131, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9131)
            .with_stdout_reader_panic()
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
        ..start_request("agt-child-panic", &root)
    };

    let error = fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect_err("panic becomes bounded error");

    assert_eq!(error, "Agent task startup failed unexpectedly.");
    assert_eq!(process.exit_code(), Some(137));
    assert_eq!(
        fixture.signals.signals_for(9131),
        vec![KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(fixture.registry.acknowledge("agt-child-panic").is_err());
    assert!(fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn panicking_signal_sender_cannot_strand_the_pending_entry_or_admission() {
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission_registry),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        sink as Arc<dyn AgentTaskEventSink>,
        Arc::new(PanickingSignalSender),
        Duration::from_secs(60),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let root = unique_path("signal-panic");
    let process = FakeProcess::new(None, None);
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9132)
            .with_stdout_reader_panic()
            .build(),
    ));
    let admission = admission_registry
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
        ..start_request("agt-signal-panic", &root)
    };

    let error = registry
        .start(request, fake_plan(&root), admission)
        .expect_err("panics become bounded error");

    assert_eq!(error, "Agent task startup failed unexpectedly.");
    assert_eq!(process.exit_code(), Some(137));
    assert!(registry.acknowledge("agt-signal-panic").is_err());
    assert!(admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn shutdown_marks_a_blocked_start_for_synchronous_abort_before_publish() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("blocked-shutdown");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9141, &process);
    let (release_sender, release_receiver) = mpsc::channel();
    fixture.spawner.script(FakeSpawnOutcome::Blocked(
        release_receiver,
        FakeChildSpec::new(&process, 9141).build(),
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
        ..start_request("agt-blocked-shutdown", &root)
    };
    let registry = Arc::new(fixture.registry);
    let start_registry = Arc::clone(&registry);
    let start_root = root.clone();
    let start =
        thread::spawn(move || start_registry.start(request, fake_plan(&start_root), admission));
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .spawner
        .pending_outcomes()
        == 0));

    registry.close_start_admission();
    registry.shutdown_all();
    release_sender.send(()).expect("release blocked spawn");
    let error = start
        .join()
        .expect("join blocked start")
        .expect_err("shutdown rejects blocked start");

    assert_eq!(error, agent_task_supervisor::AGENT_TASK_STARTS_CLOSED_ERROR);
    assert_eq!(process.exit_code(), Some(137));
    assert_eq!(
        fixture.signals.signals_for(9141),
        vec![KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(registry.acknowledge("agt-blocked-shutdown").is_err());
    assert!(fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace
        )
        .is_ok());
}

#[test]
fn reader_fault_kills_group_and_releases_admission() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("reader-fault");
    let process = FakeProcess::new(None, None);
    fixture.signals.track(9111, &process);
    let input = RecordingInput::build(&fixture.signals.journal(), None, None);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9111)
            .with_input(&input)
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
    assert!(input.is_closed());
    assert_eq!(
        fixture
            .signals
            .journal_entries()
            .first()
            .map(String::as_str),
        Some("close"),
        "startup failure must close stdin before signalling the child"
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
fn workspace_bound_controls_reject_foreign_task_and_root_authority() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("workspace-bound-control");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9151, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9151).build(),
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
        ..start_request("agt-workspace-bound", &root)
    };
    fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect("start workspace-bound task");

    assert!(fixture
        .registry
        .acknowledge_for_workspace("agt-workspace-bound", "ws-foreign")
        .is_err());
    assert!(fixture
        .registry
        .stop_for_workspace("agt-workspace-bound", "ws-foreign")
        .is_err());
    fixture
        .registry
        .stop_for_workspace_root("ws-foreign", &root);
    assert_eq!(process.exit_code(), None);

    fixture
        .registry
        .acknowledge_for_workspace("agt-workspace-bound", "ws-agent-tests")
        .expect("owner acknowledges");
    fixture
        .registry
        .stop_for_workspace("agt-workspace-bound", "ws-agent-tests")
        .expect("owner stops");
    assert!(wait_until(EVENT_DEADLINE, || process.exit_code().is_some()));
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

#[cfg(unix)]
#[test]
fn normal_leader_exit_cleans_same_group_descendant_after_prompt_eof() {
    let shell = probe_binary(&["/bin/sh"]).expect("POSIX shell");
    let cwd = unique_path("normal-exit-descendant");
    fs::create_dir_all(&cwd).expect("real cwd");
    let pid_file = cwd.join("descendant.pid");
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission_registry),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let admission = admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("real admission");
    let plan = AgentTaskSpawnPlan::for_tests(
        shell,
        vec![
            "-c".to_string(),
            "sleep 30 </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; exit 0".to_string(),
        ],
        cwd.clone(),
        Vec::new(),
    );
    registry
        .start(
            start_request("agt-normal-exit-descendant", &cwd),
            plan,
            admission,
        )
        .expect("real start");
    registry
        .acknowledge("agt-normal-exit-descendant")
        .expect("real acknowledge");
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-normal-exit-descendant")));
    assert!(matches!(
        statuses_for(&sink, "agt-normal-exit-descendant")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    let descendant: i32 = fs::read_to_string(&pid_file)
        .expect("descendant pid")
        .trim()
        .parse()
        .expect("numeric descendant pid");
    let gone = wait_until(Duration::from_secs(5), || {
        let result = unsafe { libc::kill(descendant, 0) };
        result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
    });
    if !gone {
        unsafe {
            libc::kill(descendant, libc::SIGKILL);
        }
    }
    assert!(gone, "same-group descendant survived normal leader exit");
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
#[path = "../src/effective_executable_environment.rs"]
mod effective_executable_environment;

const STEER_WORKSPACE: &str = "ws-agent-tests";

struct SteerHarness {
    fixture: Fixture,
    process: Arc<FakeProcess>,
    input: Option<Arc<RecordingInput>>,
    stdout: Option<mpsc::Sender<Vec<u8>>>,
    root: PathBuf,
    task_id: String,
}

impl SteerHarness {
    fn steer(&self, frame: &[u8]) -> Result<(), AgentTaskSteerRejection> {
        steer_frame(&self.fixture.registry, &self.task_id, frame)
    }

    fn recorded_input(&self) -> &Arc<RecordingInput> {
        self.input.as_ref().expect("the harness retains its input")
    }

    fn emit_stdout(&self, bytes: &[u8]) {
        self.stdout
            .as_ref()
            .expect("the harness retains its stdout sender")
            .send(bytes.to_vec())
            .expect("send stdout");
    }

    fn journal(&self) -> Vec<String> {
        self.fixture.signals.journal_entries()
    }

    fn wait_for_signal(&self) {
        assert!(
            wait_until(EVENT_DEADLINE, || self
                .journal()
                .contains(&"signal".to_string())),
            "the process group was never signalled"
        );
    }
}

fn steer_frame(
    registry: &AgentTaskRegistry,
    task_id: &str,
    frame: &[u8],
) -> Result<(), AgentTaskSteerRejection> {
    registry.steer_for_workspace(
        task_id,
        STEER_WORKSPACE,
        Arc::from(frame.to_vec().into_boxed_slice()),
    )
}

struct SteerSetup {
    label: String,
    process_group_id: i32,
    failure: Option<io::ErrorKind>,
    with_input: bool,
    acknowledge: bool,
    max_runtime: Duration,
    write_release: Option<Arc<(Mutex<bool>, Condvar)>>,
}

impl SteerSetup {
    fn new(label: &str, process_group_id: i32) -> Self {
        Self {
            label: label.to_string(),
            process_group_id,
            failure: None,
            with_input: true,
            acknowledge: true,
            max_runtime: Duration::from_secs(60),
            write_release: None,
        }
    }

    fn without_input(mut self) -> Self {
        self.with_input = false;
        self
    }

    fn unacknowledged(mut self) -> Self {
        self.acknowledge = false;
        self
    }

    fn failing_writes(mut self, kind: io::ErrorKind) -> Self {
        self.failure = Some(kind);
        self
    }

    fn blocked_writes(mut self) -> Self {
        self.write_release = Some(Arc::new((Mutex::new(false), Condvar::new())));
        self
    }

    fn max_runtime(mut self, max_runtime: Duration) -> Self {
        self.max_runtime = max_runtime;
        self
    }

    fn start(self) -> SteerHarness {
        let fixture = fixture(self.max_runtime);
        let root = unique_path(&self.label);
        let cwd = root.join(".worktrees").join(&self.label);
        let process = FakeProcess::new(None, Some(0));
        fixture.signals.track(self.process_group_id, &process);
        let journal = fixture.signals.journal();
        let input = self
            .with_input
            .then(|| RecordingInput::build(&journal, self.failure, self.write_release));
        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        let mut spec =
            FakeChildSpec::new(&process, self.process_group_id).with_stdout_receiver(receiver);
        if let Some(input) = input.as_ref() {
            spec = spec.with_input(input);
        }
        fixture
            .spawner
            .script(FakeSpawnOutcome::Child(spec.build()));
        dispatch(&fixture, &self.label, &root, &cwd).expect("start task");
        if self.acknowledge {
            fixture
                .registry
                .acknowledge_for_workspace(&self.label, STEER_WORKSPACE)
                .expect("acknowledge");
        }
        SteerHarness {
            fixture,
            process,
            input,
            stdout: Some(sender),
            root,
            task_id: self.label,
        }
    }
}

#[test]
fn steer_writes_the_frame_to_the_running_child() {
    let harness = SteerSetup::new("agt-steer-writes", 9301).start();

    harness.steer(b"first\n").expect("first steer");
    harness.steer(b"second\n").expect("second steer");

    assert_eq!(
        harness.recorded_input().frames(),
        vec![b"first\n".to_vec(), b"second\n".to_vec()],
        "frames reach the child in the order the steers were accepted"
    );
    assert!(!harness.recorded_input().is_closed());
}

#[test]
fn steer_before_acknowledge_is_not_running() {
    let harness = SteerSetup::new("agt-steer-pending", 9302)
        .unacknowledged()
        .start();

    assert_eq!(
        harness.steer(b"early\n"),
        Err(AgentTaskSteerRejection::NotRunning)
    );
    assert!(harness.recorded_input().frames().is_empty());
}

#[test]
fn steer_on_an_unknown_task_is_not_registered() {
    let harness = SteerSetup::new("agt-steer-unknown", 9303).start();

    assert_eq!(
        steer_frame(&harness.fixture.registry, "agt-nobody", b"frame\n"),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
}

#[test]
fn steer_with_foreign_workspace_is_not_registered() {
    let harness = SteerSetup::new("agt-steer-foreign", 9304).start();

    assert_eq!(
        harness.fixture.registry.steer_for_workspace(
            &harness.task_id,
            "ws-someone-else",
            Arc::from(b"frame\n".to_vec().into_boxed_slice()),
        ),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
    assert!(harness.recorded_input().frames().is_empty());
}

#[test]
fn steer_on_child_without_input_is_input_unavailable() {
    let harness = SteerSetup::new("agt-steer-codex", 9305)
        .without_input()
        .start();

    assert_eq!(
        harness.steer(b"frame\n"),
        Err(AgentTaskSteerRejection::InputUnavailable)
    );
}

#[test]
fn steer_after_result_line_is_input_closed() {
    let harness = SteerSetup::new("agt-steer-result", 9306).start();

    harness.steer(b"before\n").expect("steer before the result");
    harness.emit_stdout(b"{\"type\":\"assistant\"}\n{\"type\":\"result\",");
    assert!(wait_until(EVENT_DEADLINE, || outputs_for(
        &harness.fixture.sink,
        &harness.task_id
    )
    .iter()
    .any(|event| event.chunk.contains("{\"type\":\"result\","))));
    assert!(
        !harness.recorded_input().is_closed(),
        "an incomplete result frame must not close the input"
    );
    harness.emit_stdout(b"\"is_error\":false}\n");
    assert!(
        wait_until(EVENT_DEADLINE, || harness.recorded_input().is_closed()),
        "the result line did not close the input"
    );

    assert_eq!(
        harness.steer(b"after\n"),
        Err(AgentTaskSteerRejection::InputClosed)
    );
    assert_eq!(
        harness.recorded_input().frames(),
        vec![b"before\n".to_vec()]
    );
}

#[test]
fn a_result_line_split_across_chunks_still_closes_the_input() {
    let harness = SteerSetup::new("agt-steer-split", 9307).start();

    harness.emit_stdout(b"{\"type\":\"resu");
    harness.emit_stdout(b"lt\",\"is_error\":false,\"num_turns\":1}\n");

    assert!(
        wait_until(EVENT_DEADLINE, || harness.recorded_input().is_closed()),
        "a split result line did not close the input"
    );
}

#[test]
fn stop_closes_the_input_before_the_signal_and_later_steers_are_stopping() {
    let harness = SteerSetup::new("agt-steer-stop", 9308).start();

    harness
        .fixture
        .registry
        .stop_for_workspace(&harness.task_id, STEER_WORKSPACE)
        .expect("stop the task");

    harness.wait_for_signal();
    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "the input closes before the process group is signalled: {journal:?}"
    );
    assert!(harness.recorded_input().is_closed());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn stop_for_root_closes_the_input_before_the_signal() {
    let harness = SteerSetup::new("agt-steer-root", 9316).start();

    harness.fixture.registry.stop_for_root(&harness.root);

    harness.wait_for_signal();
    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "a root stop closes the input before signalling: {journal:?}"
    );
    assert!(harness.recorded_input().is_closed());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn stop_for_workspace_root_closes_the_input_before_the_signal() {
    let harness = SteerSetup::new("agt-steer-ws-root", 9318).start();

    harness
        .fixture
        .registry
        .stop_for_workspace_root(STEER_WORKSPACE, &harness.root);

    harness.wait_for_signal();
    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "a workspace root stop closes the input before signalling: {journal:?}"
    );
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn stop_for_root_and_reap_closes_the_input_before_the_signal() {
    let mut harness = SteerSetup::new("agt-steer-root-reap", 9319).start();
    harness.stdout.take();

    assert!(harness
        .fixture
        .registry
        .stop_for_root_and_reap(&harness.root));

    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "a root stop and reap closes the input before signalling: {journal:?}"
    );
    assert!(journal.iter().any(|entry| entry == "signal"));
    assert!(harness.recorded_input().is_closed());
    assert!(harness.process.exit_code().is_some());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn shutdown_all_closes_the_input_before_the_signal() {
    let mut harness = SteerSetup::new("agt-steer-shutdown", 9320).start();
    harness.stdout.take();

    harness.fixture.registry.shutdown_all();

    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "shutdown closes the input before signalling: {journal:?}"
    );
    assert!(journal.iter().any(|entry| entry == "signal"));
    assert!(harness.recorded_input().is_closed());
    assert!(harness.process.exit_code().is_some());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn the_watchdog_closes_the_input_before_the_signal() {
    let harness = SteerSetup::new("agt-steer-watchdog", 9317)
        .max_runtime(Duration::from_millis(50))
        .start();

    harness.wait_for_signal();
    let journal = harness.journal();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "the watchdog closes the input before signalling: {journal:?}"
    );
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn stop_never_waits_for_an_in_flight_steer_write() {
    let harness = SteerSetup::new("agt-steer-blocking", 9315)
        .blocked_writes()
        .start();
    let registry = &harness.fixture.registry;
    let task_id = harness.task_id.clone();
    let input = Arc::clone(harness.recorded_input());

    thread::scope(|scope| {
        scope.spawn(|| {
            steer_frame(registry, &task_id, b"slow\n").expect("the slow steer still lands");
        });
        assert!(
            wait_until(EVENT_DEADLINE, || input.writes_in_flight() > 0),
            "the slow write never started"
        );

        let started = Instant::now();
        registry
            .stop_for_workspace(&task_id, STEER_WORKSPACE)
            .expect("stop the task");
        let elapsed = started.elapsed();
        let release = input
            .write_release
            .as_ref()
            .expect("blocked writer release");
        *release.0.lock().expect("release lock") = true;
        release.1.notify_all();

        assert!(
            elapsed < Duration::from_millis(200),
            "stop waited for the in-flight stdin write: {elapsed:?}"
        );
        assert_eq!(
            steer_frame(registry, &task_id, b"racing\n"),
            Err(AgentTaskSteerRejection::Stopping),
            "a steer racing the stop is rejected as soon as the state flips"
        );
    });

    harness.wait_for_signal();
    assert!(
        wait_until(EVENT_DEADLINE, || harness.recorded_input().is_closed()),
        "the in-flight writer never released the handle after the stop"
    );
    assert_eq!(harness.recorded_input().frames().len(), 1);
}

#[test]
fn write_failure_detaches_and_stops_the_task() {
    let harness = SteerSetup::new("agt-steer-failure", 9309)
        .failing_writes(io::ErrorKind::BrokenPipe)
        .start();

    assert_eq!(
        harness.steer(b"frame\n"),
        Err(AgentTaskSteerRejection::WriteFailed)
    );
    assert_eq!(
        harness.steer(b"frame\n"),
        Err(AgentTaskSteerRejection::Stopping),
        "the detached task is already stopping"
    );
    assert!(
        wait_until(EVENT_DEADLINE, || harness
            .fixture
            .sink
            .has_terminal_status(&harness.task_id)),
        "the failed write did not settle the task"
    );
    let statuses = statuses_for(&harness.fixture.sink, &harness.task_id);
    assert!(
        matches!(
            statuses.last().map(|event| &event.status),
            Some(AgentTaskStatusPayload::Stopped)
        ),
        "the task settles as stopped: {:?}",
        statuses.last().map(|event| &event.status)
    );
}

#[test]
fn a_timed_out_write_is_reported_as_write_timed_out() {
    let harness = SteerSetup::new("agt-steer-timeout", 9310)
        .failing_writes(io::ErrorKind::TimedOut)
        .start();

    assert_eq!(
        harness.steer(b"frame\n"),
        Err(AgentTaskSteerRejection::WriteTimedOut)
    );
}

#[test]
fn steering_stops_at_the_per_turn_limit() {
    let harness = SteerSetup::new("agt-steer-limit", 9311).start();

    for index in 0..MAX_AGENT_STEERS_PER_TURN {
        harness
            .steer(format!("frame-{index}\n").as_bytes())
            .expect("frame within the limit");
    }

    assert_eq!(
        harness.steer(b"over\n"),
        Err(AgentTaskSteerRejection::LimitExceeded)
    );
    assert_eq!(
        harness.recorded_input().frames().len(),
        MAX_AGENT_STEERS_PER_TURN as usize
    );
}

#[test]
fn close_input_for_workspace_is_idempotent() {
    let harness = SteerSetup::new("agt-steer-close", 9312).start();

    harness
        .fixture
        .registry
        .close_input_for_workspace(&harness.task_id, STEER_WORKSPACE)
        .expect("first close");
    harness
        .fixture
        .registry
        .close_input_for_workspace(&harness.task_id, STEER_WORKSPACE)
        .expect("second close");

    assert!(harness.recorded_input().is_closed());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::InputClosed)
    );
    assert_eq!(
        harness
            .fixture
            .registry
            .close_input_for_workspace(&harness.task_id, "ws-someone-else"),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
    assert_eq!(
        harness
            .fixture
            .registry
            .close_input_for_workspace("agt-nobody", STEER_WORKSPACE),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
}

#[test]
fn metadata_for_workspace_reads_the_owner_checked_entry() {
    let harness = SteerSetup::new("agt-steer-metadata", 9313).start();

    let metadata = harness
        .fixture
        .registry
        .metadata_for_workspace(&harness.task_id, STEER_WORKSPACE)
        .expect("metadata for the owning workspace");

    assert_eq!(metadata.task_id, harness.task_id);
    assert_eq!(metadata.workspace_id, STEER_WORKSPACE);
    assert!(metadata
        .cwd
        .ends_with(Path::new(".worktrees").join(&harness.task_id)));
    assert_eq!(metadata.isolation, AgentTaskIsolation::Worktree);
    assert!(harness
        .fixture
        .registry
        .metadata_for_workspace(&harness.task_id, "ws-someone-else")
        .is_none());
    assert!(harness
        .fixture
        .registry
        .metadata_for_workspace("agt-nobody", STEER_WORKSPACE)
        .is_none());
}

#[test]
fn a_terminal_task_drops_its_input_and_refuses_steering() {
    let mut harness = SteerSetup::new("agt-steer-terminal", 9314).start();

    harness.stdout.take();
    harness.process.set_exited(0);
    assert!(
        wait_until(EVENT_DEADLINE, || harness
            .fixture
            .sink
            .has_terminal_status(&harness.task_id)),
        "the task did not settle"
    );

    assert!(harness.recorded_input().is_closed());
    assert_eq!(
        harness.steer(b"late\n"),
        Err(AgentTaskSteerRejection::NotRunning)
    );
}

#[test]
fn waiter_failure_closes_the_input_before_signalling() {
    let fixture = fixture(Duration::from_secs(60));
    let root = unique_path("waiter-close-input");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9321, &process);
    let input = RecordingInput::build(&fixture.signals.journal(), None, None);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9321)
            .with_input(&input)
            .with_try_wait_failure()
            .build(),
    ));
    dispatch(&fixture, "agt-waiter-close", &root, &root.join("worktree"))
        .expect("start waiter failure task");
    fixture
        .registry
        .acknowledge("agt-waiter-close")
        .expect("acknowledge");
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-waiter-close")));
    assert!(input.is_closed());
    let journal = fixture.signals.journal_entries();
    assert_eq!(
        journal.first().map(String::as_str),
        Some("close"),
        "waiter failure must close stdin before signalling: {journal:?}"
    );
    assert!(journal.iter().any(|entry| entry == "signal"));
    assert!(input.frames().is_empty());
}

#[path = "support/agent_task_question_lifecycle_tests.rs"]
mod question_lifecycle;

#[test]
fn real_process_background_monitor_keeps_stdin_until_delayed_answer() {
    let cwd = unique_path("background-monitor-eof");
    fs::create_dir_all(&cwd).expect("fixture directory");
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission_registry),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let admission = admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    // EOF cancels the worker, just as closing Claude's stream input can cancel
    // an active monitor. A late answer cannot be synthesized by the test host.
    let source = r#"
IFS= read -r initial || exit 2
printf '%s\n' '{"type":"system","subtype":"task_started","task_id":"watch","task_type":"local_bash"}'
printf '%s\n' '{"type":"result","subtype":"success","is_error":false}'
(
  /bin/sleep 0.3
  printf '%s\n' '{"type":"system","subtype":"task_notification","task_id":"watch","status":"completed"}'
  /bin/sleep 0.1
  printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Pipeline finished"}]}}'
  printf '%s\n' '{"type":"result","subtype":"success","is_error":false}'
) &
worker=$!
while IFS= read -r input; do :; done
kill "$worker" 2>/dev/null || :
wait "$worker" 2>/dev/null || :
exit 0
"#;
    let plan = AgentTaskSpawnPlan::for_tests(
        probe_binary(&["/bin/sh"]).expect("POSIX shell"),
        vec!["-c".to_string(), source.to_string()],
        cwd.clone(),
        Vec::new(),
    )
    .with_stdin_frame_for_tests(claude_user_frame("watch pipeline", &[]));
    registry
        .start(
            AgentTaskStartRequest {
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
                ..start_request("agt-background-monitor", &cwd)
            },
            plan,
            admission,
        )
        .expect("start");
    registry
        .acknowledge("agt-background-monitor")
        .expect("acknowledge");
    assert!(
        wait_until(Duration::from_secs(10), || sink
            .has_terminal_status("agt-background-monitor")),
        "background process never settled"
    );
    let stdout: String = outputs_for(&sink, "agt-background-monitor")
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
        .map(|event| event.chunk.as_str())
        .collect();
    assert!(
        stdout.contains("Pipeline finished"),
        "early stdin EOF lost delayed answer: {stdout}"
    );
    assert_eq!(stdout.matches("\"type\":\"result\"").count(), 2);
    assert!(matches!(
        statuses_for(&sink, "agt-background-monitor")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    drop(registry);
    fs::remove_dir_all(cwd).expect("fixture cleanup");
}

#[path = "support/agent_task_steer_eof_tests.rs"]
mod steer_eof;

#[path = "support/agent_task_capture_lifecycle.rs"]
mod capture_lifecycle;

#[path = "support/agent_task_pending_stop_tests.rs"]
mod pending_stop;
