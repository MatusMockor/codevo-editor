use crate::{
    debug_adapter::DebugLaunchTarget,
    debug_node_launch::{build_run_plan, NodeLaunchPlan, NodeLaunchProgram},
    managed_javascript_typescript::node_executable_path,
    node_package_tasks::task_validation::{validate_run_id, validate_workspace_id},
    terminal::{TerminalEventSink, TerminalOutputEvent},
    terminal_session::TerminalSupervisor,
    terminal_task_admission::{TerminalTaskAdmission, TerminalTaskAdmissionRegistry},
    terminal_task_process::TerminalTaskOwnership,
    trust::WorkspaceTrustService,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const NODE_RUN_TASK_STATUS_EVENT: &str = "node-run-task-status";
const TERMINAL_TOMBSTONE_LIMIT: usize = 1024;
const CANCELLATION_TOMBSTONE_GLOBAL_LIMIT: usize = 1024;
const CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT: usize = 128;
const DUPLICATE_ERROR: &str = "A Node run task with this runId already exists.";
const WRONG_WORKSPACE_ERROR: &str = "Node run task belongs to a different workspace.";
const PRESTART_CANCELLED_ERROR: &str = "Node run task start was already cancelled.";
const NPM_RUN_START_ERROR: &str = "NPM run configuration could not be started safely.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartNodeRunTaskRequest {
    run_id: String,
    workspace_id: WorkspaceId,
    terminal_session_id: u64,
    target: DebugLaunchTarget,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NodeRunTaskOwnerRequest {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartNodeRunTaskResponse {
    run_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeRunTaskStatusEvent {
    run_id: String,
    workspace_id: WorkspaceId,
    terminal_session_id: u64,
    #[serde(flatten)]
    state: NodeRunTaskState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum NodeRunTaskState {
    Running,
    Exited { exit_code: Option<i32> },
    Failed { message: String },
    Stopped,
}

struct RunMetadata {
    run_id: String,
    workspace_id: WorkspaceId,
    terminal_session_id: u64,
}

impl RunMetadata {
    fn event(&self, state: NodeRunTaskState) -> NodeRunTaskStatusEvent {
        NodeRunTaskStatusEvent {
            run_id: self.run_id.clone(),
            workspace_id: self.workspace_id.clone(),
            terminal_session_id: self.terminal_session_id,
            state,
        }
    }
}

enum RunPhase {
    Starting { stop_requested: bool },
    Active { ownership: TerminalTaskOwnership },
    Terminal,
}

struct RunEntry {
    admission: Option<TerminalTaskAdmission>,
    metadata: RunMetadata,
    phase: RunPhase,
    acknowledged: bool,
    flushing: bool,
    queued_events: Vec<NodeRunTaskStatusEvent>,
}

#[derive(Default)]
struct RunRegistryState {
    cancellations: HashMap<String, WorkspaceId>,
    cancellation_order: VecDeque<String>,
    entries: HashMap<String, RunEntry>,
    terminal_order: Vec<String>,
}

pub(crate) struct NodeRunTaskRegistry {
    admission: Arc<TerminalTaskAdmissionRegistry>,
    state: Mutex<RunRegistryState>,
}

impl NodeRunTaskRegistry {
    pub(crate) fn new(admission: Arc<TerminalTaskAdmissionRegistry>) -> Self {
        Self {
            admission,
            state: Mutex::new(RunRegistryState::default()),
        }
    }

    fn reserve(&self, metadata: RunMetadata) -> Result<(), String> {
        validate_run_id(&metadata.run_id)?;
        validate_workspace_id(&metadata.workspace_id)?;
        let mut state = self.state();
        if state.entries.contains_key(&metadata.run_id) {
            return Err(DUPLICATE_ERROR.to_string());
        }
        if state
            .cancellations
            .get(&metadata.run_id)
            .is_some_and(|workspace| workspace == &metadata.workspace_id)
        {
            return Err(PRESTART_CANCELLED_ERROR.to_string());
        }
        remove_cancellation(&mut state, &metadata.run_id);
        let admission = self
            .admission
            .reserve(&metadata.workspace_id, metadata.terminal_session_id)?;
        state.entries.insert(
            metadata.run_id.clone(),
            RunEntry {
                admission: Some(admission),
                metadata,
                phase: RunPhase::Starting {
                    stop_requested: false,
                },
                acknowledged: false,
                flushing: false,
                queued_events: Vec::new(),
            },
        );
        Ok(())
    }

    fn activate(
        &self,
        run_id: &str,
        ownership: TerminalTaskOwnership,
    ) -> Result<(bool, Option<NodeRunTaskStatusEvent>), String> {
        let mut state = self.state();
        let entry = state
            .entries
            .get_mut(run_id)
            .ok_or_else(|| "Node run task reservation disappeared.".to_string())?;
        let RunPhase::Starting { stop_requested } = entry.phase else {
            return Err("Node run task is not awaiting activation.".to_string());
        };
        entry.phase = RunPhase::Active { ownership };
        let running = entry.metadata.event(NodeRunTaskState::Running);
        let emit = if entry.acknowledged && !entry.flushing {
            Some(running)
        } else {
            entry.queued_events.push(running);
            None
        };
        Ok((stop_requested, emit))
    }

    fn abort_start(&self, run_id: &str) {
        self.state().entries.remove(run_id);
    }

    fn acknowledge(
        &self,
        request: &NodeRunTaskOwnerRequest,
        app: &AppHandle,
    ) -> Result<(), String> {
        validate_run_id(&request.run_id)?;
        validate_workspace_id(&request.workspace_id)?;
        let Some(mut events) = begin_acknowledgement(&mut self.state(), request)? else {
            return Ok(());
        };
        loop {
            for event in events {
                let _ = app.emit(NODE_RUN_TASK_STATUS_EVENT, event);
            }
            events = drain_acknowledgement(&mut self.state(), &request.run_id);
            if events.is_empty() {
                break;
            }
        }
        Ok(())
    }

    fn request_stop(&self, request: &NodeRunTaskOwnerRequest) -> Result<(), String> {
        validate_run_id(&request.run_id)?;
        validate_workspace_id(&request.workspace_id)?;
        let mut state = self.state();
        let Some(entry) = state.entries.get_mut(&request.run_id) else {
            if let Some(workspace_id) = state.cancellations.get(&request.run_id) {
                if workspace_id != &request.workspace_id {
                    return Err(WRONG_WORKSPACE_ERROR.to_string());
                }
                return Ok(());
            }
            record_cancellation(&mut state, request);
            return Ok(());
        };
        if entry.metadata.workspace_id != request.workspace_id {
            return Err(WRONG_WORKSPACE_ERROR.to_string());
        }
        request_entry_stop(entry);
        Ok(())
    }

    fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        let mut state = self.state();
        for entry in state.entries.values_mut() {
            if &entry.metadata.workspace_id != workspace_id {
                continue;
            }
            request_entry_stop(entry);
        }
    }

    fn request_stop_all(&self) {
        let mut state = self.state();
        for entry in state.entries.values_mut() {
            request_entry_stop(entry);
        }
    }

    fn complete(&self, run_id: &str, state_value: NodeRunTaskState, app: &AppHandle) {
        let event = {
            let mut state = self.state();
            let event = {
                let Some(entry) = state.entries.get_mut(run_id) else {
                    return;
                };
                if matches!(entry.phase, RunPhase::Terminal) {
                    return;
                }
                let stopped = match &entry.phase {
                    RunPhase::Starting { stop_requested } => *stop_requested,
                    RunPhase::Active { ownership } => ownership.was_stop_requested(),
                    RunPhase::Terminal => false,
                };
                entry.phase = RunPhase::Terminal;
                entry.admission.take();
                let event = entry.metadata.event(if stopped {
                    NodeRunTaskState::Stopped
                } else {
                    state_value
                });
                let should_emit = entry.acknowledged && !entry.flushing;
                if should_emit {
                    Some(event)
                } else {
                    entry.queued_events.push(event);
                    None
                }
            };
            // Bound completed entries even when a caller never acknowledges the start. Without
            // this, sequential start-and-exit requests could release admission while retaining
            // an unlimited number of queued terminal events in the registry.
            record_terminal_entry(&mut state, run_id);
            event
        };
        if let Some(event) = event {
            let _ = app.emit(NODE_RUN_TASK_STATUS_EVENT, event);
        }
    }

    fn state(&self) -> MutexGuard<'_, RunRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn request_entry_stop(entry: &mut RunEntry) {
    match &mut entry.phase {
        RunPhase::Starting { stop_requested } => *stop_requested = true,
        RunPhase::Active { ownership } => {
            ownership.request_stop();
        }
        RunPhase::Terminal => {}
    }
}

fn begin_acknowledgement(
    state: &mut RunRegistryState,
    request: &NodeRunTaskOwnerRequest,
) -> Result<Option<Vec<NodeRunTaskStatusEvent>>, String> {
    let entry = state
        .entries
        .get_mut(&request.run_id)
        .ok_or_else(|| "Node run task is not registered.".to_string())?;
    if entry.metadata.workspace_id != request.workspace_id {
        return Err(WRONG_WORKSPACE_ERROR.to_string());
    }
    if entry.acknowledged {
        return Ok(None);
    }
    entry.acknowledged = true;
    entry.flushing = true;
    Ok(Some(std::mem::take(&mut entry.queued_events)))
}

fn drain_acknowledgement(
    state: &mut RunRegistryState,
    run_id: &str,
) -> Vec<NodeRunTaskStatusEvent> {
    let (events, terminal) = match state.entries.get_mut(run_id) {
        Some(entry) => {
            let events = std::mem::take(&mut entry.queued_events);
            if !events.is_empty() {
                return events;
            }
            entry.flushing = false;
            (events, matches!(entry.phase, RunPhase::Terminal))
        }
        None => return Vec::new(),
    };
    if terminal {
        record_terminal_entry(state, run_id);
    }
    events
}

fn record_terminal_entry(state: &mut RunRegistryState, run_id: &str) {
    if !state
        .terminal_order
        .iter()
        .any(|candidate| candidate == run_id)
    {
        state.terminal_order.push(run_id.to_string());
    }
    while state.terminal_order.len() > TERMINAL_TOMBSTONE_LIMIT {
        let expired = state.terminal_order.remove(0);
        state.entries.remove(&expired);
    }
}

fn record_cancellation(state: &mut RunRegistryState, request: &NodeRunTaskOwnerRequest) {
    state
        .cancellations
        .insert(request.run_id.clone(), request.workspace_id.clone());
    state.cancellation_order.push_back(request.run_id.clone());

    while cancellation_count_for_workspace(state, &request.workspace_id)
        > CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
    {
        let Some(position) = state.cancellation_order.iter().position(|run_id| {
            state
                .cancellations
                .get(run_id)
                .is_some_and(|workspace_id| workspace_id == &request.workspace_id)
        }) else {
            break;
        };
        if let Some(expired) = state.cancellation_order.remove(position) {
            state.cancellations.remove(&expired);
        }
    }
    while state.cancellations.len() > CANCELLATION_TOMBSTONE_GLOBAL_LIMIT {
        if let Some(expired) = state.cancellation_order.pop_front() {
            state.cancellations.remove(&expired);
        }
    }
}

fn remove_cancellation(state: &mut RunRegistryState, run_id: &str) {
    state.cancellations.remove(run_id);
    state
        .cancellation_order
        .retain(|candidate| candidate != run_id);
}

fn cancellation_count_for_workspace(state: &RunRegistryState, workspace_id: &WorkspaceId) -> usize {
    state
        .cancellations
        .values()
        .filter(|candidate| *candidate == workspace_id)
        .count()
}

struct SpawnedNodeRun {
    child: Child,
    ownership: TerminalTaskOwnership,
    stdout: Option<thread::JoinHandle<Result<(), String>>>,
    stderr: Option<thread::JoinHandle<Result<(), String>>>,
}

#[tauri::command]
pub(crate) fn workspace_start_node_run_task(
    app: AppHandle,
    request: StartNodeRunTaskRequest,
) -> Result<StartNodeRunTaskResponse, String> {
    let metadata = RunMetadata {
        run_id: request.run_id.clone(),
        workspace_id: request.workspace_id.clone(),
        terminal_session_id: request.terminal_session_id,
    };
    let tasks = app.state::<NodeRunTaskRegistry>();
    tasks.reserve(metadata)?;
    let spawned = spawn_node_run(&app, &request);
    let spawned = match spawned {
        Ok(spawned) => spawned,
        Err(message) => {
            tasks.abort_start(&request.run_id);
            return Err(message);
        }
    };
    let (stop_requested, running_event) =
        match tasks.activate(&request.run_id, spawned.ownership.clone()) {
            Ok(value) => value,
            Err(message) => {
                spawned.ownership.request_stop();
                let _ = finish_node_run(&app.state::<TerminalSupervisor>(), spawned);
                tasks.abort_start(&request.run_id);
                return Err(message);
            }
        };
    if stop_requested {
        spawned.ownership.request_stop();
    }
    if let Some(event) = running_event {
        let _ = app.emit(NODE_RUN_TASK_STATUS_EVENT, event);
    }
    let run_id = request.run_id.clone();
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let completion = finish_node_run(&worker_app.state::<TerminalSupervisor>(), spawned);
        worker_app
            .state::<NodeRunTaskRegistry>()
            .complete(&run_id, completion, &worker_app);
    });
    Ok(StartNodeRunTaskResponse {
        run_id: request.run_id,
    })
}

#[tauri::command]
pub(crate) fn workspace_acknowledge_node_run_task_start(
    app: AppHandle,
    request: NodeRunTaskOwnerRequest,
) -> Result<(), String> {
    app.state::<NodeRunTaskRegistry>()
        .acknowledge(&request, &app)
}

#[tauri::command]
pub(crate) fn workspace_stop_node_run_task(
    app: AppHandle,
    request: NodeRunTaskOwnerRequest,
) -> Result<(), String> {
    app.state::<NodeRunTaskRegistry>().request_stop(&request)
}

pub(crate) fn request_stop_workspace_in_app(app: &AppHandle, workspace_id: &WorkspaceId) {
    if let Some(tasks) = app.try_state::<NodeRunTaskRegistry>() {
        tasks.request_stop_workspace(workspace_id);
    }
}

pub(crate) fn request_stop_all_in_app(app: &AppHandle) {
    if let Some(tasks) = app.try_state::<NodeRunTaskRegistry>() {
        tasks.request_stop_all();
    }
}

fn spawn_node_run(
    app: &AppHandle,
    request: &StartNodeRunTaskRequest,
) -> Result<SpawnedNodeRun, String> {
    let registry = app.state::<WorkspaceRegistry>();
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let terminals = app.state::<TerminalSupervisor>();
    let _operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| "Node run workspace is not registered.".to_string())?;
    let root = descriptor.canonical_root_path.clone();
    let trust_root = descriptor
        .selected_root_path
        .to_str()
        .ok_or_else(|| "Workspace root path is not valid UTF-8.".to_string())?;
    let trust_guard = trust.lock().map_err(|error| error.to_string())?;
    if !trust_guard.get(trust_root).trusted {
        return Err("Trust this workspace before running Node.js.".to_string());
    }
    let sink = terminals.task_sink(request.terminal_session_id, &root)?;
    let plan = build_run_plan(&root, &request.target)
        .map_err(|error| public_node_run_start_error(&request.target, error))?;
    let mut child = spawn_run_process(&plan)
        .map_err(|error| public_node_run_start_error(&request.target, error))?;
    let process_group_id = i32::try_from(child.id()).map_err(|_| {
        let _ = child.kill();
        let _ = child.wait();
        "Node run process identifier is out of range.".to_string()
    })?;
    let ownership = match terminals.register_task_process_group(
        request.terminal_session_id,
        &root,
        process_group_id,
    ) {
        Ok(ownership) => ownership,
        Err(error) => {
            #[cfg(unix)]
            unsafe {
                libc::kill(-process_group_id, libc::SIGKILL);
            }
            let _ = child.wait();
            return Err(error);
        }
    };
    drop(trust_guard);
    drop(_operation);
    let stdout = child.stdout.take().map(|reader| {
        spawn_output_reader(
            reader,
            Arc::clone(&sink),
            request.terminal_session_id,
            "stdout",
        )
    });
    let stderr = child
        .stderr
        .take()
        .map(|reader| spawn_output_reader(reader, sink, request.terminal_session_id, "stderr"));
    Ok(SpawnedNodeRun {
        child,
        ownership,
        stdout,
        stderr,
    })
}

fn public_node_run_start_error(target: &DebugLaunchTarget, error: String) -> String {
    if matches!(target, DebugLaunchTarget::NodeNpmScript { .. }) {
        NPM_RUN_START_ERROR.to_string()
    } else {
        error
    }
}

fn spawn_run_process(plan: &NodeLaunchPlan) -> Result<Child, String> {
    let program = match &plan.program {
        NodeLaunchProgram::Node => PathBuf::from(node_executable_path().ok_or_else(|| {
            "Node.js runtime was not found. Install Node.js or set CODEVO_EDITOR_NODE_PATH."
                .to_string()
        })?),
        NodeLaunchProgram::ExactNode { canonical_path, .. } => canonical_path.clone(),
        NodeLaunchProgram::TrustedLiveNode { canonical_path, .. } => canonical_path.clone(),
        NodeLaunchProgram::WorkspaceTool(path) => path.clone(),
    };
    let mut command = Command::new(program);
    command
        .args(&plan.arguments)
        .current_dir(&plan.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if plan.isolated_environment {
        command.env_clear();
        for key in ["HOME", "PATH", "TMPDIR", "SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command.envs(&plan.environment);
    }
    command.env("LC_ALL", "C").env_remove("NODE_OPTIONS");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("Unable to launch Node.js without debugging: {error}"))
}

fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    sink: Arc<dyn TerminalEventSink>,
    session_id: u64,
    stream: &'static str,
) -> thread::JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read Node run {stream}: {error}"))?;
            if count == 0 {
                return Ok(());
            }
            sink.emit_output(TerminalOutputEvent {
                data: String::from_utf8_lossy(&buffer[..count]).to_string(),
                session_id,
            });
        }
    })
}

fn finish_node_run(terminals: &TerminalSupervisor, mut run: SpawnedNodeRun) -> NodeRunTaskState {
    let status = loop {
        match run.ownership.try_wait(&mut run.child) {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => break Err(error),
        }
    };
    let status = match status {
        Ok(status) => Ok(status),
        Err(error) => run
            .ownership
            .wait_after_terminate(&mut run.child)
            .map_err(|cleanup| {
                format!("Failed to wait for Node run: {error}; cleanup failed: {cleanup}")
            }),
    };
    terminals.unregister_task(&run.ownership);
    let readers = [run.stdout.take(), run.stderr.take()]
        .into_iter()
        .flatten()
        .map(|reader| {
            reader
                .join()
                .map_err(|_| "Node run output reader panicked.".to_string())
                .and_then(|result| result)
        })
        .collect::<Result<Vec<_>, _>>();
    if run.ownership.was_stop_requested() {
        NodeRunTaskState::Stopped
    } else {
        match status.and_then(|status| readers.map(|_| status)) {
            Ok(status) => NodeRunTaskState::Exited {
                exit_code: status.code(),
            },
            Err(message) => NodeRunTaskState::Failed { message },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(value: &str) -> WorkspaceId {
        serde_json::from_value(serde_json::Value::String(value.to_string())).unwrap()
    }

    fn metadata(run_id: &str, workspace_id: &WorkspaceId, session_id: u64) -> RunMetadata {
        RunMetadata {
            run_id: run_id.to_string(),
            workspace_id: workspace_id.clone(),
            terminal_session_id: session_id,
        }
    }

    #[test]
    fn status_wire_never_serializes_the_launch_target_or_environment() {
        let workspace_id = workspace("workspace-a");
        let event = NodeRunTaskStatusEvent {
            run_id: "run-a".to_string(),
            workspace_id,
            terminal_session_id: 4,
            state: NodeRunTaskState::Exited { exit_code: Some(0) },
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["status"], "exited");
        assert_eq!(value["terminalSessionId"], 4);
        assert!(value.get("target").is_none());
        assert!(value.get("env").is_none());
    }

    #[test]
    fn npm_run_start_errors_never_expose_configured_private_fields() {
        let target = DebugLaunchTarget::NodeNpmScript {
            script: "private:script".to_string(),
            package_root_path: "/workspace/private/package".to_string(),
            args: vec!["--token=private".to_string()],
            cwd: Some("/workspace/private/cwd".to_string()),
            env: HashMap::from([("PRIVATE_TOKEN".to_string(), "private-value".to_string())]),
            just_my_code: None,
        };
        let raw = "private:script /workspace/private/package --token=private PRIVATE_TOKEN";
        let message = public_node_run_start_error(&target, raw.to_string());

        assert_eq!(message, NPM_RUN_START_ERROR);
        let wire = serde_json::to_string(&NodeRunTaskStatusEvent {
            run_id: "run-private".to_string(),
            workspace_id: workspace("workspace-private"),
            terminal_session_id: 1,
            state: NodeRunTaskState::Failed {
                message: message.clone(),
            },
        })
        .unwrap();
        for private in [
            "private:script",
            "/workspace/private/package",
            "--token=private",
            "PRIVATE_TOKEN",
            "private-value",
        ] {
            assert!(!message.contains(private));
            assert!(!wire.contains(private));
        }
        assert_eq!(
            public_node_run_start_error(
                &DebugLaunchTarget::NodeScript {
                    script_path: "/workspace/index.js".to_string(),
                },
                "specific non-NPM error".to_string(),
            ),
            "specific non-NPM error"
        );
    }

    #[test]
    fn terminal_before_ack_is_flushed_and_participates_in_bounded_eviction() {
        let workspace_id = workspace("workspace-a");
        let mut state = RunRegistryState::default();
        for index in 0..=TERMINAL_TOMBSTONE_LIMIT {
            let run_id = format!("run-{index}");
            let metadata = RunMetadata {
                run_id: run_id.clone(),
                workspace_id: workspace_id.clone(),
                terminal_session_id: index as u64 + 1,
            };
            let terminal_event = metadata.event(NodeRunTaskState::Exited { exit_code: Some(0) });
            state.entries.insert(
                run_id.clone(),
                RunEntry {
                    admission: None,
                    metadata,
                    phase: RunPhase::Terminal,
                    acknowledged: false,
                    flushing: false,
                    queued_events: vec![terminal_event],
                },
            );
            let events = begin_acknowledgement(
                &mut state,
                &NodeRunTaskOwnerRequest {
                    run_id,
                    workspace_id: workspace_id.clone(),
                },
            )
            .unwrap()
            .unwrap();
            assert_eq!(events.len(), 1);
            assert!(drain_acknowledgement(&mut state, &format!("run-{index}")).is_empty());
        }
        assert_eq!(state.terminal_order.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert_eq!(state.entries.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert!(!state.entries.contains_key("run-0"));
        assert!(state
            .entries
            .contains_key(&format!("run-{TERMINAL_TOMBSTONE_LIMIT}")));
    }

    #[test]
    fn terminal_entries_stay_bounded_without_any_acknowledgement() {
        let workspace_id = workspace("workspace-a");
        let mut state = RunRegistryState::default();
        for index in 0..=TERMINAL_TOMBSTONE_LIMIT {
            let run_id = format!("unacknowledged-{index}");
            let metadata = metadata(&run_id, &workspace_id, index as u64 + 1);
            let terminal_event = metadata.event(NodeRunTaskState::Exited { exit_code: Some(0) });
            state.entries.insert(
                run_id.clone(),
                RunEntry {
                    admission: None,
                    metadata,
                    phase: RunPhase::Terminal,
                    acknowledged: false,
                    flushing: false,
                    queued_events: vec![terminal_event],
                },
            );
            record_terminal_entry(&mut state, &run_id);
        }

        assert_eq!(state.terminal_order.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert_eq!(state.entries.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert!(!state.entries.contains_key("unacknowledged-0"));
        assert!(state
            .entries
            .contains_key(&format!("unacknowledged-{TERMINAL_TOMBSTONE_LIMIT}")));
    }

    #[test]
    fn prestart_stop_is_owner_scoped_and_closes_the_start_race() {
        let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
        let registry = NodeRunTaskRegistry::new(admission);
        let owner = workspace("workspace-a");
        let foreign = workspace("workspace-b");
        registry
            .request_stop(&NodeRunTaskOwnerRequest {
                run_id: "run-a".to_string(),
                workspace_id: owner.clone(),
            })
            .unwrap();
        assert_eq!(
            registry.reserve(metadata("run-a", &owner, 1)).unwrap_err(),
            PRESTART_CANCELLED_ERROR
        );
        assert_eq!(
            registry
                .request_stop(&NodeRunTaskOwnerRequest {
                    run_id: "run-a".to_string(),
                    workspace_id: foreign.clone(),
                })
                .unwrap_err(),
            WRONG_WORKSPACE_ERROR
        );
        assert_eq!(
            registry.reserve(metadata("run-a", &owner, 1)).unwrap_err(),
            PRESTART_CANCELLED_ERROR
        );

        registry
            .request_stop(&NodeRunTaskOwnerRequest {
                run_id: "run-b".to_string(),
                workspace_id: foreign.clone(),
            })
            .unwrap();
        assert!(registry.reserve(metadata("run-b", &owner, 2)).is_ok());
        assert_eq!(
            registry
                .request_stop(&NodeRunTaskOwnerRequest {
                    run_id: "run-b".to_string(),
                    workspace_id: workspace("workspace-c"),
                })
                .unwrap_err(),
            WRONG_WORKSPACE_ERROR
        );
    }

    #[test]
    fn cancellation_tombstones_are_owner_partitioned_and_bounded() {
        let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
        let registry = NodeRunTaskRegistry::new(admission);
        let owner = workspace("workspace-a");
        let foreign = workspace("workspace-b");
        registry
            .request_stop(&NodeRunTaskOwnerRequest {
                run_id: "foreign-survivor".to_string(),
                workspace_id: foreign.clone(),
            })
            .unwrap();
        for index in 0..=CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT {
            registry
                .request_stop(&NodeRunTaskOwnerRequest {
                    run_id: format!("owner-{index}"),
                    workspace_id: owner.clone(),
                })
                .unwrap();
        }

        let state = registry.state();
        assert_eq!(
            cancellation_count_for_workspace(&state, &owner),
            CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
        );
        assert_eq!(cancellation_count_for_workspace(&state, &foreign), 1);
        assert!(!state.cancellations.contains_key("owner-0"));
        assert!(state.cancellations.contains_key("foreign-survivor"));
    }

    #[test]
    fn completion_queued_during_ack_flush_cannot_overtake_running() {
        let workspace_id = workspace("workspace-a");
        let metadata = metadata("run-a", &workspace_id, 1);
        let running = metadata.event(NodeRunTaskState::Running);
        let terminal = metadata.event(NodeRunTaskState::Exited { exit_code: Some(0) });
        let mut state = RunRegistryState::default();
        state.entries.insert(
            "run-a".to_string(),
            RunEntry {
                admission: None,
                metadata,
                phase: RunPhase::Starting {
                    stop_requested: false,
                },
                acknowledged: false,
                flushing: false,
                queued_events: vec![running],
            },
        );
        let first = begin_acknowledgement(
            &mut state,
            &NodeRunTaskOwnerRequest {
                run_id: "run-a".to_string(),
                workspace_id,
            },
        )
        .unwrap()
        .unwrap();
        assert!(matches!(first[0].state, NodeRunTaskState::Running));
        let entry = state.entries.get_mut("run-a").unwrap();
        entry.phase = RunPhase::Terminal;
        entry.queued_events.push(terminal);
        let second = drain_acknowledgement(&mut state, "run-a");
        assert!(matches!(second[0].state, NodeRunTaskState::Exited { .. }));
        assert!(drain_acknowledgement(&mut state, "run-a").is_empty());
        assert_eq!(state.terminal_order, ["run-a"]);
    }
}
