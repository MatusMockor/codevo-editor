use crate::{
    agent_task_admission::{AgentTaskAdmission, AgentTaskAdmissionRegistry},
    agent_task_spawner::{AgentChild, AgentProcessSpawner, AgentTaskSpawnPlan},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

pub const AGENT_TASK_OUTPUT_EVENT_LIMIT: u64 = 4096;
pub const MAX_AGENT_OUTPUT_CHUNK_BYTES: usize = 8 * 1024;
pub const AGENT_TASK_MAX_RUNTIME: Duration = Duration::from_secs(3600);
pub const MAX_AGENT_TASK_FAILURE_BYTES: usize = 4 * 1024;
pub const MAX_QUEUED_AGENT_TASK_EVENTS: usize = 256;

pub const AGENT_TASK_STATUS_EVENT_CHANNEL: &str = "agent-task://status";
pub const AGENT_TASK_OUTPUT_EVENT_CHANNEL: &str = "agent-task://output";

pub(crate) const DUPLICATE_AGENT_TASK_ERROR: &str =
    "An agent task with this taskId already exists.";
pub(crate) const AGENT_TASK_NOT_REGISTERED_ERROR: &str = "Agent task is not registered.";
pub(crate) const AGENT_TASK_TIMEOUT_MESSAGE: &str = "agent task exceeded maximum runtime";

const MAX_AGENT_TASK_ID_BYTES: usize = 64;
const MAX_TERMINAL_AGENT_TASK_ENTRIES: usize = 128;
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_millis(500);
const FORCE_STOP_TIMEOUT: Duration = Duration::from_millis(500);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const PUMP_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(unix)]
pub(crate) const TERMINATE_PROCESS_GROUP_SIGNAL: i32 = libc::SIGTERM;
#[cfg(unix)]
pub(crate) const KILL_PROCESS_GROUP_SIGNAL: i32 = libc::SIGKILL;
#[cfg(not(unix))]
pub(crate) const TERMINATE_PROCESS_GROUP_SIGNAL: i32 = 15;
#[cfg(not(unix))]
pub(crate) const KILL_PROCESS_GROUP_SIGNAL: i32 = 9;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentTaskIsolation {
    Worktree,
    #[serde(rename = "in-place")]
    InPlace,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum AgentTaskStatusPayload {
    Pending,
    Running,
    Exited {
        #[serde(rename = "exitCode")]
        exit_code: i32,
    },
    Failed {
        message: String,
    },
    Stopped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskStatusEvent {
    pub task_id: String,
    pub workspace_id: String,
    pub repository_root: String,
    pub isolation: AgentTaskIsolation,
    pub worktree_path: Option<String>,
    pub sequence: u64,
    #[serde(flatten)]
    pub status: AgentTaskStatusPayload,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentTaskOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskOutputEvent {
    pub task_id: String,
    pub sequence: u64,
    pub stream: AgentTaskOutputStream,
    pub chunk: String,
    pub truncated: bool,
}

pub trait AgentTaskEventSink: Send + Sync {
    fn status(&self, event: AgentTaskStatusEvent);
    fn output(&self, event: AgentTaskOutputEvent);
}

pub trait AgentProcessGroupSignalSender: Send + Sync {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String>;
}

struct SystemAgentProcessGroupSignalSender;

impl AgentProcessGroupSignalSender for SystemAgentProcessGroupSignalSender {
    #[cfg(unix)]
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        let result = unsafe { libc::kill(-process_group_id, signal) };
        if result == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        Err(format!("Unable to signal agent process group: {error}"))
    }

    #[cfg(not(unix))]
    fn send(&self, _process_group_id: i32, _signal: i32) -> Result<(), String> {
        Err("Process-group signals are unavailable on this platform.".to_string())
    }
}

#[derive(Clone, Debug)]
pub struct AgentTaskStartRequest {
    pub task_id: String,
    pub workspace_id: String,
    pub repository_root: PathBuf,
    pub isolation: AgentTaskIsolation,
    pub worktree_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskStartResult {
    pub task_id: String,
}

enum AgentProcessGroupState {
    Active { process_group_id: i32 },
    Reaped,
}

struct AgentProcessGroup {
    state: Mutex<AgentProcessGroupState>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
}

impl AgentProcessGroup {
    fn new(process_group_id: i32, signals: Arc<dyn AgentProcessGroupSignalSender>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(AgentProcessGroupState::Active { process_group_id }),
            signals,
        })
    }

    fn signal(&self, signal: i32) {
        let state = self.state();
        let AgentProcessGroupState::Active { process_group_id } = *state else {
            return;
        };
        if process_group_id <= 0 {
            return;
        }
        let _ = self.signals.send(process_group_id, signal);
    }

    fn try_wait(&self, child: &mut dyn AgentChild) -> Result<Option<i32>, String> {
        let mut state = self.state();
        let exit = child.try_wait()?;
        if exit.is_some() {
            *state = AgentProcessGroupState::Reaped;
        }
        Ok(exit)
    }

    fn is_reaped(&self) -> bool {
        matches!(*self.state(), AgentProcessGroupState::Reaped)
    }

    fn state(&self) -> MutexGuard<'_, AgentProcessGroupState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Default)]
struct WatchdogGate {
    finished: Mutex<bool>,
    signal: Condvar,
}

impl WatchdogGate {
    fn finish(&self) {
        let mut finished = self
            .finished
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *finished = true;
        self.signal.notify_all();
    }

    fn wait_finished(&self, timeout: Duration) -> bool {
        let finished = self
            .finished
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (finished, _) = self
            .signal
            .wait_timeout_while(finished, timeout, |done| !*done)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *finished
    }
}

struct WorkerThreadGuard {
    counter: Arc<AtomicUsize>,
}

impl WorkerThreadGuard {
    fn new(counter: &Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self {
            counter: Arc::clone(counter),
        }
    }
}

impl Drop for WorkerThreadGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Clone, Copy)]
struct AgentTaskRuntimeTuning {
    max_runtime: Duration,
    graceful_timeout: Duration,
    force_timeout: Duration,
}

impl Default for AgentTaskRuntimeTuning {
    fn default() -> Self {
        Self {
            max_runtime: AGENT_TASK_MAX_RUNTIME,
            graceful_timeout: GRACEFUL_STOP_TIMEOUT,
            force_timeout: FORCE_STOP_TIMEOUT,
        }
    }
}

struct AgentTaskMetadata {
    task_id: String,
    workspace_id: String,
    repository_root: PathBuf,
    cwd: PathBuf,
    isolation: AgentTaskIsolation,
    worktree_path: Option<PathBuf>,
}

impl AgentTaskMetadata {
    fn status_event(&self, sequence: u64, status: AgentTaskStatusPayload) -> AgentTaskStatusEvent {
        AgentTaskStatusEvent {
            task_id: self.task_id.clone(),
            workspace_id: self.workspace_id.clone(),
            repository_root: self.repository_root.to_string_lossy().into_owned(),
            isolation: self.isolation,
            worktree_path: self
                .worktree_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            sequence,
            status,
        }
    }

    fn matches_root(&self, root: &Path) -> bool {
        self.repository_root == root || self.cwd.starts_with(root)
    }
}

enum AgentTaskPhase {
    Pending,
    Running,
    Terminal,
}

enum QueuedAgentTaskEvent {
    Status(AgentTaskStatusEvent),
    Output(AgentTaskOutputEvent),
}

struct AgentTaskEntry {
    admission: Option<AgentTaskAdmission>,
    metadata: AgentTaskMetadata,
    phase: AgentTaskPhase,
    acknowledged: bool,
    flushing: bool,
    queued: VecDeque<QueuedAgentTaskEvent>,
    status_sequence: u64,
    output_sequence: u64,
    output_events_published: u64,
    output_truncation_published: bool,
    stop_requested: bool,
    group: Option<Arc<AgentProcessGroup>>,
    watchdog: Arc<WatchdogGate>,
}

impl AgentTaskEntry {
    fn new(
        metadata: AgentTaskMetadata,
        admission: AgentTaskAdmission,
        watchdog: Arc<WatchdogGate>,
    ) -> Self {
        Self {
            admission: Some(admission),
            metadata,
            phase: AgentTaskPhase::Pending,
            acknowledged: false,
            flushing: false,
            queued: VecDeque::new(),
            status_sequence: 0,
            output_sequence: 0,
            output_events_published: 0,
            output_truncation_published: false,
            stop_requested: false,
            group: None,
            watchdog,
        }
    }
}

#[derive(Default)]
struct AgentTaskRegistryState {
    entries: HashMap<String, AgentTaskEntry>,
    terminal_order: VecDeque<String>,
}

struct AgentTaskShared {
    sink: Arc<dyn AgentTaskEventSink>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    tuning: AgentTaskRuntimeTuning,
    live_worker_threads: Arc<AtomicUsize>,
    output_emission_order: Mutex<()>,
    state: Mutex<AgentTaskRegistryState>,
}

impl AgentTaskShared {
    fn state(&self) -> MutexGuard<'_, AgentTaskRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct AgentTaskRegistry {
    admission: Arc<AgentTaskAdmissionRegistry>,
    spawner: Arc<dyn AgentProcessSpawner>,
    shared: Arc<AgentTaskShared>,
}

impl AgentTaskRegistry {
    pub fn new(
        admission: Arc<AgentTaskAdmissionRegistry>,
        spawner: Arc<dyn AgentProcessSpawner>,
        sink: Arc<dyn AgentTaskEventSink>,
    ) -> Self {
        Self::assemble(
            admission,
            spawner,
            sink,
            Arc::new(SystemAgentProcessGroupSignalSender),
            AgentTaskRuntimeTuning::default(),
        )
    }

    #[cfg(test)]
    pub fn with_dependencies(
        admission: Arc<AgentTaskAdmissionRegistry>,
        spawner: Arc<dyn AgentProcessSpawner>,
        sink: Arc<dyn AgentTaskEventSink>,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        max_runtime: Duration,
        graceful_timeout: Duration,
        force_timeout: Duration,
    ) -> Self {
        Self::assemble(
            admission,
            spawner,
            sink,
            signals,
            AgentTaskRuntimeTuning {
                max_runtime,
                graceful_timeout,
                force_timeout,
            },
        )
    }

    fn assemble(
        admission: Arc<AgentTaskAdmissionRegistry>,
        spawner: Arc<dyn AgentProcessSpawner>,
        sink: Arc<dyn AgentTaskEventSink>,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        tuning: AgentTaskRuntimeTuning,
    ) -> Self {
        Self {
            admission,
            spawner,
            shared: Arc::new(AgentTaskShared {
                sink,
                signals,
                tuning,
                live_worker_threads: Arc::new(AtomicUsize::new(0)),
                output_emission_order: Mutex::new(()),
                state: Mutex::new(AgentTaskRegistryState::default()),
            }),
        }
    }

    pub fn admission(&self) -> Arc<AgentTaskAdmissionRegistry> {
        Arc::clone(&self.admission)
    }

    #[cfg(test)]
    pub fn live_worker_thread_count(&self) -> usize {
        self.shared.live_worker_threads.load(Ordering::SeqCst)
    }

    pub fn start(
        &self,
        request: AgentTaskStartRequest,
        plan: AgentTaskSpawnPlan,
        admission: AgentTaskAdmission,
    ) -> Result<AgentTaskStartResult, String> {
        validate_start_request(&request)?;
        let task_id = request.task_id.clone();
        let metadata = AgentTaskMetadata {
            task_id: task_id.clone(),
            workspace_id: request.workspace_id,
            repository_root: request.repository_root,
            cwd: plan.cwd().to_path_buf(),
            isolation: request.isolation,
            worktree_path: request.worktree_path,
        };
        let watchdog = Arc::new(WatchdogGate::default());
        {
            let mut state = self.shared.state();
            if state.entries.contains_key(&task_id) {
                return Err(DUPLICATE_AGENT_TASK_ERROR.to_string());
            }
            state.entries.insert(
                task_id.clone(),
                AgentTaskEntry::new(metadata, admission, Arc::clone(&watchdog)),
            );
        }
        let mut child = match self.spawner.spawn(&plan) {
            Ok(child) => child,
            Err(error) => {
                self.remove_entry(&task_id);
                return Err(clip_failure_message(&error));
            }
        };
        let group =
            AgentProcessGroup::new(child.process_group_id(), Arc::clone(&self.shared.signals));
        let readers = child
            .stdout_reader()
            .and_then(|stdout| child.stderr_reader().map(|stderr| (stdout, stderr)));
        let (stdout, stderr) = match readers {
            Ok(readers) => readers,
            Err(error) => {
                self.abort_unpublished(&task_id, &group, child.as_mut(), &watchdog);
                return Err(clip_failure_message(&error));
            }
        };
        let stop_already_requested = {
            let mut state = self.shared.state();
            let Some(entry) = state.entries.get_mut(&task_id) else {
                drop(state);
                self.abort_unpublished(&task_id, &group, child.as_mut(), &watchdog);
                return Err(AGENT_TASK_NOT_REGISTERED_ERROR.to_string());
            };
            entry.group = Some(Arc::clone(&group));
            entry.stop_requested
        };
        let stdout_pump = self.spawn_output_pump(&task_id, AgentTaskOutputStream::Stdout, stdout);
        let stderr_pump = self.spawn_output_pump(&task_id, AgentTaskOutputStream::Stderr, stderr);
        let pumps = match (stdout_pump, stderr_pump) {
            (Ok(stdout_pump), Ok(stderr_pump)) => vec![stdout_pump, stderr_pump],
            (stdout_pump, stderr_pump) => {
                let error = collect_spawn_error(stdout_pump.err(), stderr_pump.err());
                self.abort_unpublished(&task_id, &group, child.as_mut(), &watchdog);
                return Err(error);
            }
        };
        if let Err(error) = self.spawn_watchdog(&task_id, &group, &watchdog) {
            self.abort_unpublished(&task_id, &group, child.as_mut(), &watchdog);
            return Err(error);
        }
        if let Err(error) = self.spawn_waiter(&task_id, child, &group, pumps) {
            watchdog.finish();
            group.signal(KILL_PROCESS_GROUP_SIGNAL);
            self.remove_entry(&task_id);
            return Err(error);
        }
        if stop_already_requested {
            self.escalate_stop(Arc::clone(&group));
        }
        Ok(AgentTaskStartResult { task_id })
    }

    pub fn acknowledge(&self, task_id: &str) -> Result<(), String> {
        let Some(mut events) = begin_acknowledgement(&self.shared, task_id)? else {
            return Ok(());
        };
        loop {
            for event in events {
                emit_queued_event(self.shared.sink.as_ref(), event);
            }
            events = drain_acknowledgement(&self.shared, task_id);
            if events.is_empty() {
                return Ok(());
            }
        }
    }

    pub fn stop(&self, task_id: &str) -> Result<(), String> {
        let group = {
            let mut state = self.shared.state();
            let Some(entry) = state.entries.get_mut(task_id) else {
                return Ok(());
            };
            if matches!(entry.phase, AgentTaskPhase::Terminal) {
                return Ok(());
            }
            entry.stop_requested = true;
            entry.group.clone()
        };
        let Some(group) = group else {
            return Ok(());
        };
        self.escalate_stop(group);
        Ok(())
    }

    pub fn stop_for_root(&self, root: &Path) {
        for group in self.request_stop_groups_for_root(root) {
            self.escalate_stop(group);
        }
    }

    pub fn stop_for_root_and_reap(&self, root: &Path) -> bool {
        let groups = self.request_stop_groups_for_root(root);
        if groups.is_empty() {
            return true;
        }
        for group in &groups {
            group.signal(TERMINATE_PROCESS_GROUP_SIGNAL);
        }
        if wait_for_groups_reaped(&groups, self.shared.tuning.graceful_timeout) {
            return true;
        }
        for group in &groups {
            group.signal(KILL_PROCESS_GROUP_SIGNAL);
        }
        wait_for_groups_reaped(&groups, self.shared.tuning.force_timeout)
    }

    fn request_stop_groups_for_root(&self, root: &Path) -> Vec<Arc<AgentProcessGroup>> {
        let mut state = self.shared.state();
        state
            .entries
            .values_mut()
            .filter(|entry| {
                !matches!(entry.phase, AgentTaskPhase::Terminal)
                    && entry.metadata.matches_root(root)
            })
            .filter_map(|entry| {
                entry.stop_requested = true;
                entry.group.clone()
            })
            .collect()
    }

    pub fn shutdown_all(&self) {
        let groups: Vec<Arc<AgentProcessGroup>> = {
            let mut state = self.shared.state();
            state
                .entries
                .values_mut()
                .filter(|entry| !matches!(entry.phase, AgentTaskPhase::Terminal))
                .filter_map(|entry| {
                    entry.stop_requested = true;
                    entry.group.clone()
                })
                .collect()
        };
        for group in &groups {
            group.signal(TERMINATE_PROCESS_GROUP_SIGNAL);
        }
        if wait_for_groups_reaped(&groups, self.shared.tuning.graceful_timeout) {
            return;
        }
        for group in &groups {
            group.signal(KILL_PROCESS_GROUP_SIGNAL);
        }
        wait_for_groups_reaped(&groups, self.shared.tuning.force_timeout);
    }

    fn escalate_stop(&self, group: Arc<AgentProcessGroup>) {
        let tuning = self.shared.tuning;
        let thread_group = Arc::clone(&group);
        let spawned = self.spawn_worker("agent-task-stop", move || {
            escalate_group_stop(&thread_group, tuning.graceful_timeout, tuning.force_timeout);
        });
        if spawned.is_err() {
            escalate_group_stop(&group, tuning.graceful_timeout, tuning.force_timeout);
        }
    }

    fn spawn_output_pump(
        &self,
        task_id: &str,
        stream: AgentTaskOutputStream,
        reader: Box<dyn Read + Send>,
    ) -> Result<JoinHandle<()>, String> {
        let shared = Arc::clone(&self.shared);
        let task_id = task_id.to_string();
        self.spawn_worker("agent-task-output", move || {
            run_output_pump(&shared, &task_id, stream, reader);
        })
    }

    fn spawn_watchdog(
        &self,
        task_id: &str,
        group: &Arc<AgentProcessGroup>,
        watchdog: &Arc<WatchdogGate>,
    ) -> Result<(), String> {
        let shared = Arc::clone(&self.shared);
        let task_id = task_id.to_string();
        let group = Arc::clone(group);
        let watchdog = Arc::clone(watchdog);
        self.spawn_worker("agent-task-watchdog", move || {
            run_watchdog(&shared, &task_id, &group, &watchdog);
        })
        .map(|_| ())
    }

    fn spawn_waiter(
        &self,
        task_id: &str,
        child: Box<dyn AgentChild>,
        group: &Arc<AgentProcessGroup>,
        pumps: Vec<JoinHandle<()>>,
    ) -> Result<(), String> {
        let shared = Arc::clone(&self.shared);
        let task_id = task_id.to_string();
        let group = Arc::clone(group);
        self.spawn_worker("agent-task-waiter", move || {
            run_waiter(&shared, &task_id, child, &group, &pumps);
        })
        .map(|_| ())
    }

    fn spawn_worker<F>(&self, name: &str, work: F) -> Result<JoinHandle<()>, String>
    where
        F: FnOnce() + Send + 'static,
    {
        let guard = WorkerThreadGuard::new(&self.shared.live_worker_threads);
        thread::Builder::new()
            .name(name.to_string())
            .spawn(move || {
                let _guard = guard;
                work();
            })
            .map_err(|error| format!("Unable to start agent task worker: {error}"))
    }

    fn abort_unpublished(
        &self,
        task_id: &str,
        group: &Arc<AgentProcessGroup>,
        child: &mut dyn AgentChild,
        watchdog: &Arc<WatchdogGate>,
    ) {
        watchdog.finish();
        group.signal(KILL_PROCESS_GROUP_SIGNAL);
        let deadline = Instant::now() + self.shared.tuning.force_timeout;
        loop {
            match group.try_wait(child) {
                Ok(Some(_)) => break,
                Err(_) => break,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(WAIT_POLL_INTERVAL);
                }
            }
        }
        self.remove_entry(task_id);
    }

    fn remove_entry(&self, task_id: &str) {
        let mut state = self.shared.state();
        state.entries.remove(task_id);
        state
            .terminal_order
            .retain(|candidate| candidate != task_id);
    }
}

impl Drop for AgentTaskRegistry {
    fn drop(&mut self) {
        let groups: Vec<Arc<AgentProcessGroup>> = {
            let mut state = self.shared.state();
            state
                .entries
                .values_mut()
                .filter_map(|entry| {
                    entry.stop_requested = true;
                    entry.group.clone()
                })
                .collect()
        };
        for group in groups {
            group.signal(KILL_PROCESS_GROUP_SIGNAL);
        }
    }
}

fn validate_start_request(request: &AgentTaskStartRequest) -> Result<(), String> {
    if request.task_id.is_empty() || request.task_id.len() > MAX_AGENT_TASK_ID_BYTES {
        return Err("Agent task id is invalid.".to_string());
    }
    if request.workspace_id.is_empty() {
        return Err("Agent task workspace id is invalid.".to_string());
    }
    if !request.repository_root.is_absolute() {
        return Err("Agent task repository root must be absolute.".to_string());
    }
    Ok(())
}

fn collect_spawn_error(first: Option<String>, second: Option<String>) -> String {
    if let Some(error) = first {
        return error;
    }
    if let Some(error) = second {
        return error;
    }
    "Unable to start agent task worker.".to_string()
}

fn run_output_pump(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    stream: AgentTaskOutputStream,
    mut reader: Box<dyn Read + Send>,
) {
    let mut buffer = vec![0_u8; MAX_AGENT_OUTPUT_CHUNK_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(count) => publish_output(shared, task_id, stream, &buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

fn publish_output(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    stream: AgentTaskOutputStream,
    bytes: &[u8],
) {
    let text = sanitize_output_text(bytes);
    for chunk in split_output_chunks(&text) {
        publish_output_chunk(shared, task_id, stream, chunk);
    }
}

fn sanitize_output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace('\0', "\u{fffd}")
}

fn split_output_chunks(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut remaining = text;
    while remaining.len() > MAX_AGENT_OUTPUT_CHUNK_BYTES {
        let mut boundary = MAX_AGENT_OUTPUT_CHUNK_BYTES;
        while !remaining.is_char_boundary(boundary) {
            boundary -= 1;
        }
        chunks.push(remaining[..boundary].to_string());
        remaining = &remaining[boundary..];
    }
    if !remaining.is_empty() {
        chunks.push(remaining.to_string());
    }
    chunks
}

fn publish_output_chunk(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    stream: AgentTaskOutputStream,
    chunk: String,
) {
    let _emission_order = shared
        .output_emission_order
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let emit = {
        let mut state = shared.state();
        let Some(entry) = state.entries.get_mut(task_id) else {
            return;
        };
        if matches!(entry.phase, AgentTaskPhase::Terminal) {
            return;
        }
        if entry.output_truncation_published {
            return;
        }
        entry.output_sequence += 1;
        let event = if entry.output_events_published >= AGENT_TASK_OUTPUT_EVENT_LIMIT {
            entry.output_truncation_published = true;
            AgentTaskOutputEvent {
                task_id: task_id.to_string(),
                sequence: entry.output_sequence,
                stream,
                chunk: String::new(),
                truncated: true,
            }
        } else {
            entry.output_events_published += 1;
            AgentTaskOutputEvent {
                task_id: task_id.to_string(),
                sequence: entry.output_sequence,
                stream,
                chunk,
                truncated: false,
            }
        };
        if entry.acknowledged && !entry.flushing {
            Some(event)
        } else {
            push_queued(entry, QueuedAgentTaskEvent::Output(event));
            None
        }
    };
    if let Some(event) = emit {
        shared.sink.output(event);
    }
}

fn push_queued(entry: &mut AgentTaskEntry, event: QueuedAgentTaskEvent) {
    if entry.queued.len() >= MAX_QUEUED_AGENT_TASK_EVENTS {
        let position = entry
            .queued
            .iter()
            .position(|queued| matches!(queued, QueuedAgentTaskEvent::Output(_)));
        if let Some(position) = position {
            entry.queued.remove(position);
        }
    }
    entry.queued.push_back(event);
}

fn run_waiter(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    mut child: Box<dyn AgentChild>,
    group: &Arc<AgentProcessGroup>,
    pumps: &[JoinHandle<()>],
) {
    let outcome = loop {
        match group.try_wait(child.as_mut()) {
            Ok(Some(exit_code)) => break Ok(exit_code),
            Ok(None) => thread::sleep(WAIT_POLL_INTERVAL),
            Err(error) => break Err(error),
        }
    };
    match outcome {
        Ok(exit_code) => {
            for pump in pumps {
                wait_for_thread(pump, PUMP_DRAIN_TIMEOUT);
            }
            complete(
                shared,
                task_id,
                AgentTaskStatusPayload::Exited { exit_code },
            );
        }
        Err(error) => {
            group.signal(KILL_PROCESS_GROUP_SIGNAL);
            reap_bounded(group, child.as_mut(), shared.tuning.force_timeout);
            complete(
                shared,
                task_id,
                AgentTaskStatusPayload::Failed {
                    message: format!("Agent task wait failed: {error}"),
                },
            );
        }
    }
}

fn reap_bounded(group: &Arc<AgentProcessGroup>, child: &mut dyn AgentChild, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        match group.try_wait(child) {
            Ok(Some(_)) => return,
            Err(_) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return;
                }
                thread::sleep(WAIT_POLL_INTERVAL);
            }
        }
    }
}

fn run_watchdog(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    group: &Arc<AgentProcessGroup>,
    watchdog: &Arc<WatchdogGate>,
) {
    if watchdog.wait_finished(shared.tuning.max_runtime) {
        return;
    }
    complete(
        shared,
        task_id,
        AgentTaskStatusPayload::Failed {
            message: AGENT_TASK_TIMEOUT_MESSAGE.to_string(),
        },
    );
    escalate_group_stop(
        group,
        shared.tuning.graceful_timeout,
        shared.tuning.force_timeout,
    );
}

fn escalate_group_stop(group: &Arc<AgentProcessGroup>, graceful: Duration, force: Duration) {
    group.signal(TERMINATE_PROCESS_GROUP_SIGNAL);
    if wait_for_group_reaped(group, graceful) {
        return;
    }
    group.signal(KILL_PROCESS_GROUP_SIGNAL);
    wait_for_group_reaped(group, force);
}

fn wait_for_group_reaped(group: &Arc<AgentProcessGroup>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if group.is_reaped() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}

fn wait_for_groups_reaped(groups: &[Arc<AgentProcessGroup>], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if groups.iter().all(|group| group.is_reaped()) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}

fn wait_for_thread(thread: &JoinHandle<()>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if thread.is_finished() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}

fn complete(shared: &Arc<AgentTaskShared>, task_id: &str, payload: AgentTaskStatusPayload) {
    let emit = {
        let mut state = shared.state();
        let emit = {
            let Some(entry) = state.entries.get_mut(task_id) else {
                return;
            };
            if matches!(entry.phase, AgentTaskPhase::Terminal) {
                return;
            }
            let pending = matches!(entry.phase, AgentTaskPhase::Pending);
            entry.phase = AgentTaskPhase::Terminal;
            entry.admission.take();
            entry.watchdog.finish();
            let status = resolve_terminal_status(entry.stop_requested, payload);
            if entry.acknowledged && !entry.flushing {
                entry.status_sequence += 1;
                Some(entry.metadata.status_event(entry.status_sequence, status))
            } else {
                if pending {
                    entry.status_sequence += 1;
                    let running = entry
                        .metadata
                        .status_event(entry.status_sequence, AgentTaskStatusPayload::Running);
                    push_queued(entry, QueuedAgentTaskEvent::Status(running));
                }
                entry.status_sequence += 1;
                let event = entry.metadata.status_event(entry.status_sequence, status);
                push_queued(entry, QueuedAgentTaskEvent::Status(event));
                None
            }
        };
        record_terminal_entry(&mut state, task_id);
        emit
    };
    if let Some(event) = emit {
        shared.sink.status(event);
    }
}

fn resolve_terminal_status(
    stop_requested: bool,
    payload: AgentTaskStatusPayload,
) -> AgentTaskStatusPayload {
    if let AgentTaskStatusPayload::Failed { message } = payload {
        return AgentTaskStatusPayload::Failed {
            message: clip_failure_message(&message),
        };
    }
    if stop_requested {
        return AgentTaskStatusPayload::Stopped;
    }
    payload
}

fn record_terminal_entry(state: &mut AgentTaskRegistryState, task_id: &str) {
    if !state
        .terminal_order
        .iter()
        .any(|candidate| candidate == task_id)
    {
        state.terminal_order.push_back(task_id.to_string());
    }
    while state.terminal_order.len() > MAX_TERMINAL_AGENT_TASK_ENTRIES {
        let Some(expired) = state.terminal_order.pop_front() else {
            return;
        };
        state.entries.remove(&expired);
    }
}

fn begin_acknowledgement(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
) -> Result<Option<Vec<QueuedAgentTaskEvent>>, String> {
    let mut state = shared.state();
    let entry = state
        .entries
        .get_mut(task_id)
        .ok_or_else(|| AGENT_TASK_NOT_REGISTERED_ERROR.to_string())?;
    if entry.acknowledged {
        return Ok(None);
    }
    entry.acknowledged = true;
    entry.flushing = true;
    if matches!(entry.phase, AgentTaskPhase::Pending) {
        entry.phase = AgentTaskPhase::Running;
        entry.status_sequence += 1;
        let running = entry
            .metadata
            .status_event(entry.status_sequence, AgentTaskStatusPayload::Running);
        entry
            .queued
            .push_back(QueuedAgentTaskEvent::Status(running));
    }
    Ok(Some(entry.queued.drain(..).collect()))
}

fn drain_acknowledgement(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
) -> Vec<QueuedAgentTaskEvent> {
    let mut state = shared.state();
    let terminal = {
        let Some(entry) = state.entries.get_mut(task_id) else {
            return Vec::new();
        };
        let events: Vec<QueuedAgentTaskEvent> = entry.queued.drain(..).collect();
        if !events.is_empty() {
            return events;
        }
        entry.flushing = false;
        matches!(entry.phase, AgentTaskPhase::Terminal)
    };
    if terminal {
        state.entries.remove(task_id);
        state
            .terminal_order
            .retain(|candidate| candidate != task_id);
    }
    Vec::new()
}

fn emit_queued_event(sink: &dyn AgentTaskEventSink, event: QueuedAgentTaskEvent) {
    match event {
        QueuedAgentTaskEvent::Status(event) => sink.status(event),
        QueuedAgentTaskEvent::Output(event) => sink.output(event),
    }
}

fn clip_failure_message(message: &str) -> String {
    if message.len() <= MAX_AGENT_TASK_FAILURE_BYTES {
        return message.to_string();
    }
    let mut end = MAX_AGENT_TASK_FAILURE_BYTES;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message[..end].to_string()
}
