#[path = "node_package_task_output_observer.rs"]
mod output_observer;
#[path = "node_package_tagged_utf8.rs"]
mod tagged_utf8;
#[path = "node_package_task_events.rs"]
mod task_events;
#[path = "node_package_task_validation.rs"]
pub(crate) mod task_validation;

pub(crate) use self::task_events::AppNodePackageTaskEventSink;
#[cfg(test)]
use self::task_events::{NodePackageTaskProblemWire, NoopNodePackageTaskEventSink};
#[cfg(test)]
use self::task_validation::{RUN_ID_BYTES_LIMIT, WORKSPACE_ID_BYTES_LIMIT};
use self::{
    output_observer::AppNodePackageTaskOutputObserver,
    task_events::{
        output_stream_name, problem_wire, NodePackageTaskEventSink, NodePackageTaskEventState,
        NodePackageTaskOutputEvent, NodePackageTaskOwner, NodePackageTaskProblemsEvent,
        NodePackageTaskProblemsState, NodePackageTaskStatusEvent,
    },
    task_validation::{
        validate_manifest_relative_path, validate_run_id, validate_script_name,
        validate_workspace_id,
    },
};
#[cfg(test)]
use crate::terminal_task_admission::{
    GLOBAL_LIMIT_ERROR, LIVE_TASK_GLOBAL_LIMIT, LIVE_TASK_WORKSPACE_LIMIT, SESSION_LIMIT_ERROR,
    WORKSPACE_LIMIT_ERROR,
};
use crate::{
    node_package_problem_matcher::{
        NodePackageProblem, NodePackageProblemSnapshot, NodePackageTaskOutputStream,
    },
    node_package_scripts::{
        finish_node_package_task, spawn_node_package_task, NodePackageTaskCompletion,
        NodePackageTaskOutputObserver, RunNodePackageScriptRequest,
    },
    terminal_session::TerminalSupervisor,
    terminal_task_admission::{TerminalTaskAdmission, TerminalTaskAdmissionRegistry},
    terminal_task_process::TerminalTaskOwnership,
    trust::WorkspaceTrustService,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

const TERMINAL_TOMBSTONE_LIMIT: usize = 1024;
const CANCELLATION_TOMBSTONE_GLOBAL_LIMIT: usize = 1024;
const CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT: usize = 128;
const TAGGED_OUTPUT_EVENT_LIMIT: usize = 1024;
const TAGGED_OUTPUT_BYTES_LIMIT: usize = 1024 * 1024;
const TAGGED_OUTPUT_CHUNK_BYTES_LIMIT: usize = 8 * 1024;

const DUPLICATE_RUN_ID_ERROR: &str = "A Node package task with this runId already exists.";
const PRESTART_CANCELLED_ERROR: &str = "Node package task start was already cancelled.";
const WRONG_WORKSPACE_ERROR: &str = "Node package task belongs to a different workspace.";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartNodePackageTaskRequest {
    run_id: String,
    workspace_id: WorkspaceId,
    session_id: u64,
    manifest_relative_path: String,
    script_name: String,
    #[serde(default)]
    problem_matcher: Option<NodePackageTaskProblemMatcherKind>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum NodePackageTaskProblemMatcherKind {
    Typescript,
    Eslint,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopNodePackageTaskRequest {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AcknowledgeNodePackageTaskStartRequest {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartNodePackageTaskResponse {
    run_id: String,
}

#[derive(Clone, Debug)]
struct TaskMetadata {
    run_id: String,
    workspace_id: WorkspaceId,
    session_id: u64,
    manifest_relative_path: String,
    script_name: String,
}

impl TaskMetadata {
    fn event(&self, state: NodePackageTaskEventState) -> NodePackageTaskStatusEvent {
        NodePackageTaskStatusEvent {
            run_id: self.run_id.clone(),
            workspace_id: self.workspace_id.clone(),
            session_id: self.session_id,
            manifest_relative_path: self.manifest_relative_path.clone(),
            script_name: self.script_name.clone(),
            state,
        }
    }

    fn owner(&self) -> NodePackageTaskOwner {
        NodePackageTaskOwner {
            run_id: self.run_id.clone(),
            workspace_id: self.workspace_id.clone(),
            session_id: self.session_id,
            manifest_relative_path: self.manifest_relative_path.clone(),
            script_name: self.script_name.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventGate {
    Pending,
    Flushing,
    Open,
}

enum PendingTaskEvent {
    Status(NodePackageTaskStatusEvent),
    Output(NodePackageTaskOutputEvent),
    Problems(NodePackageTaskProblemsEvent),
}

enum TaskPhase {
    Starting { stop_requested: bool },
    Active { ownership: TerminalTaskOwnership },
    Terminal,
}

struct TaskEntry {
    admission: Option<TerminalTaskAdmission>,
    metadata: TaskMetadata,
    phase: TaskPhase,
    event_gate: EventGate,
    events_open: bool,
    next_sequence: u32,
    pending_events: VecDeque<PendingTaskEvent>,
    tagged_output_bytes: usize,
    tagged_output_events: usize,
    output_truncated: bool,
    problems_terminal: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CancellationTombstone {
    workspace_id: WorkspaceId,
}

#[derive(Default)]
struct TaskRegistryState {
    cancellations: HashMap<String, CancellationTombstone>,
    cancellation_order: VecDeque<String>,
    entries: HashMap<String, TaskEntry>,
    terminal_order: VecDeque<String>,
}

pub(crate) struct NodePackageTaskRegistry {
    admission: Arc<TerminalTaskAdmissionRegistry>,
    state: Mutex<TaskRegistryState>,
}

impl NodePackageTaskRegistry {
    #[cfg(test)]
    pub(crate) fn new() -> Self {
        Self::with_admission(Arc::new(TerminalTaskAdmissionRegistry::new()))
    }

    pub(crate) fn with_admission(admission: Arc<TerminalTaskAdmissionRegistry>) -> Self {
        Self {
            admission,
            state: Mutex::new(TaskRegistryState::default()),
        }
    }

    fn reserve(&self, metadata: TaskMetadata) -> Result<(), String> {
        validate_run_id(&metadata.run_id)?;
        validate_workspace_id(&metadata.workspace_id)?;
        validate_manifest_relative_path(&metadata.manifest_relative_path)?;
        validate_script_name(&metadata.script_name)?;
        let mut state = self.state();
        if state.entries.contains_key(&metadata.run_id) {
            return Err(DUPLICATE_RUN_ID_ERROR.to_string());
        }
        if let Some(cancellation) = state.cancellations.get(&metadata.run_id) {
            if cancellation.workspace_id == metadata.workspace_id {
                return Err(PRESTART_CANCELLED_ERROR.to_string());
            }
            // An unknown-run stop cannot authoritatively claim a runId for another workspace.
            // Once the real owner arrives, discard the foreign intent before admission.
            remove_cancellation(&mut state, &metadata.run_id);
        }

        let admission = self
            .admission
            .reserve(&metadata.workspace_id, metadata.session_id)?;
        let reset = PendingTaskEvent::Problems(NodePackageTaskProblemsEvent {
            owner: metadata.owner(),
            sequence: 1,
            state: NodePackageTaskProblemsState::Reset,
        });
        let mut pending_events = VecDeque::new();
        pending_events.push_back(reset);
        state.entries.insert(
            metadata.run_id.clone(),
            TaskEntry {
                admission: Some(admission),
                metadata,
                phase: TaskPhase::Starting {
                    stop_requested: false,
                },
                event_gate: EventGate::Pending,
                events_open: true,
                next_sequence: 2,
                pending_events,
                tagged_output_bytes: 0,
                tagged_output_events: 0,
                output_truncated: false,
                problems_terminal: false,
            },
        );
        Ok(())
    }

    fn activate(&self, run_id: &str, ownership: TerminalTaskOwnership) -> Result<bool, String> {
        let mut state = self.state();
        let entry = state
            .entries
            .get_mut(run_id)
            .ok_or_else(|| "Node package task reservation disappeared.".to_string())?;
        let TaskPhase::Starting { stop_requested } = entry.phase else {
            return Err("Node package task is not awaiting activation.".to_string());
        };
        entry.phase = TaskPhase::Active { ownership };
        Ok(stop_requested)
    }

    fn abort_start(&self, run_id: &str) {
        let mut state = self.state();
        state.entries.remove(run_id);
        state.terminal_order.retain(|candidate| candidate != run_id);
    }

    fn acknowledge_start(
        &self,
        run_id: &str,
        workspace_id: &WorkspaceId,
        sink: &dyn NodePackageTaskEventSink,
    ) -> Result<(), String> {
        validate_run_id(run_id)?;
        validate_workspace_id(workspace_id)?;
        {
            let mut state = self.state();
            let entry = state
                .entries
                .get_mut(run_id)
                .ok_or_else(|| "Node package task is not registered.".to_string())?;
            if &entry.metadata.workspace_id != workspace_id {
                return Err(WRONG_WORKSPACE_ERROR.to_string());
            }
            match entry.event_gate {
                EventGate::Open => return Ok(()),
                EventGate::Pending => entry.event_gate = EventGate::Flushing,
                EventGate::Flushing => {
                    return Err(
                        "Node package task start acknowledgement is already flushing.".to_string(),
                    )
                }
            }
        }
        self.drain_events(run_id, sink);
        Ok(())
    }

    #[cfg(test)]
    fn record_output(
        &self,
        run_id: &str,
        stream: NodePackageTaskOutputStream,
        bytes: &[u8],
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let data = String::from_utf8_lossy(bytes);
        self.record_output_text(run_id, stream, &data, sink);
    }

    fn record_output_text(
        &self,
        run_id: &str,
        stream: NodePackageTaskOutputStream,
        data: &str,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let mut start = 0;
        while start < data.len() {
            let mut end = (start + TAGGED_OUTPUT_CHUNK_BYTES_LIMIT).min(data.len());
            while end > start && !data.is_char_boundary(end) {
                end -= 1;
            }
            self.record_output_data(run_id, stream, data[start..end].to_string(), sink);
            start = end;
        }
    }

    fn record_output_data(
        &self,
        run_id: &str,
        stream: NodePackageTaskOutputStream,
        data: String,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Some(entry) = state.entries.get_mut(run_id) else {
                return;
            };
            if !entry.events_open {
                return;
            }
            if entry.output_truncated {
                return;
            }
            let exceeds_cap = entry.tagged_output_events >= TAGGED_OUTPUT_EVENT_LIMIT
                || entry.tagged_output_bytes.saturating_add(data.len()) > TAGGED_OUTPUT_BYTES_LIMIT;
            let Some(sequence) = take_sequence(entry) else {
                entry.events_open = false;
                return;
            };
            if exceeds_cap {
                entry.output_truncated = true;
                let event = PendingTaskEvent::Output(NodePackageTaskOutputEvent {
                    owner: entry.metadata.owner(),
                    sequence,
                    stream: output_stream_name(stream),
                    data: String::new(),
                    truncated: true,
                });
                queue_event(entry, event)
            } else {
                entry.tagged_output_bytes = entry.tagged_output_bytes.saturating_add(data.len());
                entry.tagged_output_events += 1;
                let event = PendingTaskEvent::Output(NodePackageTaskOutputEvent {
                    owner: entry.metadata.owner(),
                    sequence,
                    stream: output_stream_name(stream),
                    data,
                    truncated: false,
                });
                queue_event(entry, event)
            }
        };
        if should_drain {
            self.drain_events(run_id, sink);
        }
    }

    fn append_problems(
        &self,
        run_id: &str,
        problems: Vec<NodePackageProblem>,
        snapshot: &NodePackageProblemSnapshot,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        if problems.is_empty() {
            return;
        }
        self.publish_problems(
            run_id,
            NodePackageTaskProblemsState::Append {
                problems: problems.into_iter().map(problem_wire).collect(),
                total: bounded_total(snapshot.total),
                truncated: snapshot.truncated,
            },
            false,
            sink,
        );
    }

    fn finish_problems(
        &self,
        run_id: &str,
        snapshot: Option<NodePackageProblemSnapshot>,
        preserve: bool,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let state = if preserve {
            let snapshot = snapshot.unwrap_or_else(empty_problem_snapshot);
            NodePackageTaskProblemsState::Complete {
                problems: snapshot.problems.into_iter().map(problem_wire).collect(),
                total: bounded_total(snapshot.total),
                truncated: snapshot.truncated,
            }
        } else {
            NodePackageTaskProblemsState::Clear
        };
        self.publish_problems(run_id, state, true, sink);
    }

    fn publish_problems(
        &self,
        run_id: &str,
        problem_state: NodePackageTaskProblemsState,
        terminal: bool,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Some(entry) = state.entries.get_mut(run_id) else {
                return;
            };
            if !entry.events_open || entry.problems_terminal {
                return;
            }
            let Some(sequence) = take_sequence(entry) else {
                entry.events_open = false;
                return;
            };
            if terminal {
                entry.problems_terminal = true;
                entry.events_open = false;
            }
            let event = PendingTaskEvent::Problems(NodePackageTaskProblemsEvent {
                owner: entry.metadata.owner(),
                sequence,
                state: problem_state,
            });
            queue_event(entry, event)
        };
        if should_drain {
            self.drain_events(run_id, sink);
        }
    }

    fn request_stop_with_sink(
        &self,
        request: &StopNodePackageTaskRequest,
        sink: &dyn NodePackageTaskEventSink,
    ) -> Result<(), String> {
        validate_run_id(&request.run_id)?;
        validate_workspace_id(&request.workspace_id)?;
        let mut state = self.state();
        if let Some(entry) = state.entries.get_mut(&request.run_id) {
            if entry.metadata.workspace_id != request.workspace_id {
                return Err(WRONG_WORKSPACE_ERROR.to_string());
            }
            let should_clear = match &mut entry.phase {
                TaskPhase::Starting { stop_requested } => {
                    *stop_requested = true;
                    true
                }
                TaskPhase::Active { ownership } => {
                    ownership.request_stop() || ownership.was_stop_requested()
                }
                TaskPhase::Terminal => false,
            };
            drop(state);
            if should_clear {
                self.finish_problems(&request.run_id, None, false, sink);
            }
            return Ok(());
        }

        if let Some(cancellation) = state.cancellations.get(&request.run_id) {
            if cancellation.workspace_id != request.workspace_id {
                return Err(WRONG_WORKSPACE_ERROR.to_string());
            }
            return Ok(());
        }
        record_cancellation(&mut state, request);
        Ok(())
    }

    #[cfg(test)]
    fn request_stop(&self, request: &StopNodePackageTaskRequest) -> Result<(), String> {
        self.request_stop_with_sink(request, &NoopNodePackageTaskEventSink)
    }

    pub(crate) fn request_stop_session(
        &self,
        session_id: u64,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        self.request_stop_matching(|entry| entry.metadata.session_id == session_id, sink);
    }

    pub(crate) fn request_stop_workspace_with_sink(
        &self,
        workspace_id: &WorkspaceId,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        self.request_stop_matching(|entry| &entry.metadata.workspace_id == workspace_id, sink);
    }

    #[cfg(test)]
    fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        self.request_stop_workspace_with_sink(workspace_id, &NoopNodePackageTaskEventSink);
    }

    pub(crate) fn request_stop_all(&self, sink: &dyn NodePackageTaskEventSink) {
        self.request_stop_matching(|_| true, sink);
    }

    fn request_stop_matching(
        &self,
        matches_entry: impl Fn(&TaskEntry) -> bool,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let run_ids = {
            let mut state = self.state();
            let mut run_ids = Vec::new();
            for entry in state
                .entries
                .values_mut()
                .filter(|entry| matches_entry(entry))
            {
                match &mut entry.phase {
                    TaskPhase::Starting { stop_requested } => {
                        *stop_requested = true;
                        run_ids.push(entry.metadata.run_id.clone());
                    }
                    TaskPhase::Active { ownership } => {
                        if ownership.request_stop() || ownership.was_stop_requested() {
                            run_ids.push(entry.metadata.run_id.clone());
                        }
                    }
                    TaskPhase::Terminal => {}
                }
            }
            run_ids
        };
        for run_id in run_ids {
            self.finish_problems(&run_id, None, false, sink);
        }
    }

    fn complete(
        &self,
        run_id: &str,
        completion: NodePackageTaskCompletion,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let event = {
            let mut state = self.state();
            let Some(entry) = state.entries.get_mut(run_id) else {
                return;
            };
            if matches!(entry.phase, TaskPhase::Terminal) {
                return;
            }
            let stop_requested = match &entry.phase {
                TaskPhase::Starting { stop_requested } => *stop_requested,
                TaskPhase::Active { ownership } => ownership.was_stop_requested(),
                TaskPhase::Terminal => false,
            };
            entry.phase = TaskPhase::Terminal;
            entry.admission.take();
            let event_state = match if stop_requested {
                NodePackageTaskCompletion::Stopped
            } else {
                completion
            } {
                NodePackageTaskCompletion::Exited { exit_code } => {
                    NodePackageTaskEventState::Exited { exit_code }
                }
                NodePackageTaskCompletion::Failed { message } => {
                    NodePackageTaskEventState::Failed { message }
                }
                NodePackageTaskCompletion::Stopped => NodePackageTaskEventState::Stopped,
            };
            let event = entry.metadata.event(event_state);
            state.terminal_order.push_back(run_id.to_string());
            while state.terminal_order.len() > TERMINAL_TOMBSTONE_LIMIT {
                if let Some(expired) = state.terminal_order.pop_front() {
                    state.entries.remove(&expired);
                }
            }
            event
        };
        let preserve = matches!(&event.state, NodePackageTaskEventState::Exited { .. });
        self.finish_problems(run_id, None, preserve, sink);
        self.publish_status_event(run_id, event, sink);
    }

    fn publish_running(&self, run_id: &str, sink: &dyn NodePackageTaskEventSink) {
        let should_drain = {
            let mut state = self.state();
            let Some(entry) = state.entries.get_mut(run_id) else {
                return;
            };
            let status =
                PendingTaskEvent::Status(entry.metadata.event(NodePackageTaskEventState::Running));
            if entry.event_gate == EventGate::Pending {
                entry.pending_events.push_front(status);
                false
            } else {
                queue_event(entry, status)
            }
        };
        if should_drain {
            self.drain_events(run_id, sink);
        }
    }

    fn publish_status_event(
        &self,
        run_id: &str,
        status: NodePackageTaskStatusEvent,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        self.publish_prebuilt_event(run_id, PendingTaskEvent::Status(status), sink);
    }

    fn publish_prebuilt_event(
        &self,
        run_id: &str,
        event: PendingTaskEvent,
        sink: &dyn NodePackageTaskEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Some(entry) = state.entries.get_mut(run_id) else {
                return;
            };
            queue_event(entry, event)
        };
        if should_drain {
            self.drain_events(run_id, sink);
        }
    }

    fn drain_events(&self, run_id: &str, sink: &dyn NodePackageTaskEventSink) {
        loop {
            let event = {
                let mut state = self.state();
                let Some(entry) = state.entries.get_mut(run_id) else {
                    return;
                };
                match entry.pending_events.pop_front() {
                    Some(event) => event,
                    None => {
                        entry.event_gate = EventGate::Open;
                        return;
                    }
                }
            };
            emit_task_event(sink, event);
        }
    }

    fn state(&self) -> MutexGuard<'_, TaskRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn take_sequence(entry: &mut TaskEntry) -> Option<u32> {
    if entry.next_sequence == u32::MAX {
        return None;
    }
    let sequence = entry.next_sequence;
    entry.next_sequence += 1;
    Some(sequence)
}

fn queue_event(entry: &mut TaskEntry, event: PendingTaskEvent) -> bool {
    entry.pending_events.push_back(event);
    if entry.event_gate == EventGate::Open {
        entry.event_gate = EventGate::Flushing;
        true
    } else {
        false
    }
}

fn emit_task_event(sink: &dyn NodePackageTaskEventSink, event: PendingTaskEvent) {
    match event {
        PendingTaskEvent::Status(event) => sink.emit_status(event),
        PendingTaskEvent::Output(event) => sink.emit_output(event),
        PendingTaskEvent::Problems(event) => sink.emit_problems(event),
    }
}

fn bounded_total(total: u64) -> u32 {
    u32::try_from(total).unwrap_or(u32::MAX)
}

fn empty_problem_snapshot() -> NodePackageProblemSnapshot {
    NodePackageProblemSnapshot {
        problems: Vec::new(),
        scanned_lines: 0,
        total: 0,
        truncated: false,
    }
}

fn record_cancellation(state: &mut TaskRegistryState, request: &StopNodePackageTaskRequest) {
    state.cancellations.insert(
        request.run_id.clone(),
        CancellationTombstone {
            workspace_id: request.workspace_id.clone(),
        },
    );
    state.cancellation_order.push_back(request.run_id.clone());

    while cancellation_count_for_workspace(state, &request.workspace_id)
        > CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
    {
        let Some(position) = state.cancellation_order.iter().position(|run_id| {
            state
                .cancellations
                .get(run_id)
                .is_some_and(|entry| entry.workspace_id == request.workspace_id)
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

fn remove_cancellation(state: &mut TaskRegistryState, run_id: &str) {
    state.cancellations.remove(run_id);
    state
        .cancellation_order
        .retain(|candidate| candidate != run_id);
}

fn cancellation_count_for_workspace(
    state: &TaskRegistryState,
    workspace_id: &WorkspaceId,
) -> usize {
    state
        .cancellations
        .values()
        .filter(|entry| &entry.workspace_id == workspace_id)
        .count()
}

#[tauri::command]
pub(crate) fn workspace_start_node_package_task(
    app: AppHandle,
    request: StartNodePackageTaskRequest,
) -> Result<StartNodePackageTaskResponse, String> {
    let metadata = TaskMetadata {
        run_id: request.run_id.clone(),
        workspace_id: request.workspace_id.clone(),
        session_id: request.session_id,
        manifest_relative_path: request.manifest_relative_path.clone(),
        script_name: request.script_name.clone(),
    };
    let tasks = app.state::<NodePackageTaskRegistry>();
    tasks.reserve(metadata)?;
    let output_observer: Arc<dyn NodePackageTaskOutputObserver> =
        Arc::new(AppNodePackageTaskOutputObserver::new(
            app.clone(),
            request.run_id.clone(),
            request.problem_matcher,
        ));
    let spawned = {
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let terminals = app.state::<TerminalSupervisor>();
        spawn_node_package_task(
            &registry,
            &trust,
            &terminals,
            &RunNodePackageScriptRequest {
                workspace_id: request.workspace_id,
                session_id: request.session_id,
                manifest_relative_path: request.manifest_relative_path,
                script_name: request.script_name,
            },
            output_observer,
        )
    };
    let spawned = match spawned {
        Ok(spawned) => spawned,
        Err(message) => {
            tasks.abort_start(&request.run_id);
            return Err(message);
        }
    };
    let stop_requested = match tasks.activate(&request.run_id, spawned.ownership.clone()) {
        Ok(stop_requested) => stop_requested,
        Err(message) => {
            spawned.ownership.request_stop();
            tasks.abort_start(&request.run_id);
            let cleanup_app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let terminals = cleanup_app.state::<TerminalSupervisor>();
                let _ = finish_node_package_task(&terminals, spawned);
            });
            return Err(message);
        }
    };
    if stop_requested {
        spawned.ownership.request_stop();
    }
    tasks.publish_running(&request.run_id, &AppNodePackageTaskEventSink(app.clone()));
    let run_id = request.run_id.clone();
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let terminals = worker_app.state::<TerminalSupervisor>();
        let completion = finish_node_package_task(&terminals, spawned);
        worker_app.state::<NodePackageTaskRegistry>().complete(
            &run_id,
            completion,
            &AppNodePackageTaskEventSink(worker_app.clone()),
        );
    });
    Ok(StartNodePackageTaskResponse {
        run_id: request.run_id,
    })
}

#[tauri::command]
pub(crate) fn workspace_acknowledge_node_package_task_start(
    app: AppHandle,
    request: AcknowledgeNodePackageTaskStartRequest,
) -> Result<(), String> {
    validate_run_id(&request.run_id)?;
    app.state::<NodePackageTaskRegistry>().acknowledge_start(
        &request.run_id,
        &request.workspace_id,
        &AppNodePackageTaskEventSink(app.clone()),
    )
}

#[tauri::command]
pub(crate) fn workspace_stop_node_package_task(
    app: AppHandle,
    request: StopNodePackageTaskRequest,
) -> Result<(), String> {
    app.state::<NodePackageTaskRegistry>()
        .request_stop_with_sink(&request, &AppNodePackageTaskEventSink(app.clone()))
}

pub(crate) fn request_stop_workspace_in_app(app: &AppHandle, workspace_id: &WorkspaceId) {
    if let Some(tasks) = app.try_state::<NodePackageTaskRegistry>() {
        tasks.request_stop_workspace_with_sink(
            workspace_id,
            &AppNodePackageTaskEventSink(app.clone()),
        );
    }
}

pub(crate) fn request_stop_all_in_app(app: &AppHandle) {
    if let Some(tasks) = app.try_state::<NodePackageTaskRegistry>() {
        tasks.request_stop_all(&AppNodePackageTaskEventSink(app.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Barrier, Mutex},
        thread,
    };

    #[derive(Default)]
    struct CollectSink(
        Mutex<Vec<NodePackageTaskStatusEvent>>,
        Mutex<Vec<NodePackageTaskOutputEvent>>,
        Mutex<Vec<NodePackageTaskProblemsEvent>>,
    );

    impl NodePackageTaskEventSink for CollectSink {
        fn emit_status(&self, event: NodePackageTaskStatusEvent) {
            self.0.lock().unwrap().push(event);
        }

        fn emit_output(&self, event: NodePackageTaskOutputEvent) {
            self.1.lock().unwrap().push(event);
        }

        fn emit_problems(&self, event: NodePackageTaskProblemsEvent) {
            self.2.lock().unwrap().push(event);
        }
    }

    struct BlockingOrderSink {
        first_entered: Barrier,
        outputs: Mutex<Vec<(u32, String)>>,
        release_first: Barrier,
    }

    impl BlockingOrderSink {
        fn new() -> Self {
            Self {
                first_entered: Barrier::new(2),
                outputs: Mutex::new(Vec::new()),
                release_first: Barrier::new(2),
            }
        }
    }

    impl NodePackageTaskEventSink for BlockingOrderSink {
        fn emit_status(&self, _event: NodePackageTaskStatusEvent) {}

        fn emit_output(&self, event: NodePackageTaskOutputEvent) {
            if event.data == "first" {
                self.first_entered.wait();
                self.release_first.wait();
            }
            self.outputs
                .lock()
                .unwrap()
                .push((event.sequence, event.data));
        }

        fn emit_problems(&self, _event: NodePackageTaskProblemsEvent) {}
    }

    fn metadata(run_id: &str, workspace_id: &str) -> TaskMetadata {
        metadata_for_session(run_id, workspace_id, 7)
    }

    fn metadata_for_session(run_id: &str, workspace_id: &str, session_id: u64) -> TaskMetadata {
        TaskMetadata {
            run_id: run_id.into(),
            workspace_id: serde_json::from_value(serde_json::json!(workspace_id)).unwrap(),
            session_id,
            manifest_relative_path: "package.json".into(),
            script_name: "test".into(),
        }
    }

    #[test]
    fn strict_requests_reject_unknown_missing_and_oversized_run_ids() {
        assert!(
            serde_json::from_value::<StartNodePackageTaskRequest>(serde_json::json!({
                "runId":"r", "workspaceId":"ws-a", "sessionId":1,
                "manifestRelativePath":"package.json", "scriptName":"test", "extra":true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StopNodePackageTaskRequest>(serde_json::json!({
                "runId":"r"
            }))
            .is_err()
        );
        assert!(validate_run_id(&"r".repeat(RUN_ID_BYTES_LIMIT + 1)).is_err());
        assert!(validate_run_id("bad\nrun").is_err());
    }

    #[test]
    fn duplicate_wrong_owner_repeated_stop_and_terminal_exact_once_are_closed() {
        let registry = NodePackageTaskRegistry::new();
        registry.reserve(metadata("run-1", "ws-a")).unwrap();
        assert!(registry.reserve(metadata("run-1", "ws-a")).is_err());
        assert!(registry
            .request_stop(&StopNodePackageTaskRequest {
                run_id: "run-1".into(),
                workspace_id: serde_json::from_value(serde_json::json!("ws-b")).unwrap(),
            })
            .is_err());
        let owner_a: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry
            .request_stop(&StopNodePackageTaskRequest {
                run_id: "run-1".into(),
                workspace_id: owner_a.clone(),
            })
            .unwrap();
        registry
            .request_stop(&StopNodePackageTaskRequest {
                run_id: "run-1".into(),
                workspace_id: owner_a,
            })
            .unwrap();
        let sink = CollectSink::default();
        registry.complete("run-1", NodePackageTaskCompletion::Stopped, &sink);
        registry.complete(
            "run-1",
            NodePackageTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        );
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry
            .acknowledge_start("run-1", &workspace_id, &sink)
            .unwrap();
        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].state,
            NodePackageTaskEventState::Stopped
        ));
    }

    #[test]
    fn event_wire_carries_owner_and_discriminated_terminal_fields() {
        let event = metadata("run-2", "ws-a")
            .event(NodePackageTaskEventState::Exited { exit_code: Some(3) });
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "runId":"run-2", "workspaceId":"ws-a", "sessionId":7,
                "manifestRelativePath":"package.json", "scriptName":"test",
                "status":"exited", "exitCode":3
            })
        );
    }

    #[test]
    fn strict_problem_matcher_wire_accepts_optional_known_kinds_only() {
        for matcher in [
            serde_json::json!(null),
            serde_json::json!("typescript"),
            serde_json::json!("eslint"),
        ] {
            let request =
                serde_json::from_value::<StartNodePackageTaskRequest>(serde_json::json!({
                    "runId":"r", "workspaceId":"ws-a", "sessionId":1,
                    "manifestRelativePath":"package.json", "scriptName":"test",
                    "problemMatcher": matcher
                }))
                .expect("known optional matcher");
            assert_eq!(request.run_id, "r");
        }
        assert!(
            serde_json::from_value::<StartNodePackageTaskRequest>(serde_json::json!({
                "runId":"r", "workspaceId":"ws-a", "sessionId":1,
                "manifestRelativePath":"package.json", "scriptName":"test",
                "problemMatcher":"stylelint"
            }))
            .is_err()
        );
    }

    #[test]
    fn immediate_output_waits_for_start_ack_and_flushes_in_sequence() {
        let registry = NodePackageTaskRegistry::new();
        let sink = CollectSink::default();
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry.reserve(metadata("ack-run", "ws-a")).unwrap();
        registry.publish_running("ack-run", &sink);
        registry.record_output(
            "ack-run",
            NodePackageTaskOutputStream::Stdout,
            b"immediate\n",
            &sink,
        );

        assert!(sink.0.lock().unwrap().is_empty());
        assert!(sink.1.lock().unwrap().is_empty());
        assert!(sink.2.lock().unwrap().is_empty());

        registry
            .acknowledge_start("ack-run", &workspace_id, &sink)
            .unwrap();
        assert!(matches!(
            sink.0.lock().unwrap()[0].state,
            NodePackageTaskEventState::Running
        ));
        let output = sink.1.lock().unwrap();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].sequence, 2);
        assert_eq!(output[0].data, "immediate\n");
        assert!(!output[0].truncated);
        let problems = sink.2.lock().unwrap();
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].sequence, 1);
        assert!(matches!(
            problems[0].state,
            NodePackageTaskProblemsState::Reset
        ));
    }

    #[test]
    fn open_gate_has_one_lock_free_drainer_and_preserves_concurrent_sequence_order() {
        let registry = Arc::new(NodePackageTaskRegistry::new());
        let sink = Arc::new(BlockingOrderSink::new());
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry.reserve(metadata("ordered", "ws-a")).unwrap();
        registry.publish_running("ordered", sink.as_ref());
        registry
            .acknowledge_start("ordered", &workspace_id, sink.as_ref())
            .unwrap();

        let first_registry = Arc::clone(&registry);
        let first_sink = Arc::clone(&sink);
        let first = thread::spawn(move || {
            first_registry.record_output_text(
                "ordered",
                NodePackageTaskOutputStream::Stdout,
                "first",
                first_sink.as_ref(),
            );
        });
        sink.first_entered.wait();

        let second_registry = Arc::clone(&registry);
        let second_sink = Arc::clone(&sink);
        thread::spawn(move || {
            second_registry.record_output_text(
                "ordered",
                NodePackageTaskOutputStream::Stderr,
                "second",
                second_sink.as_ref(),
            );
        })
        .join()
        .unwrap();

        // The second producer acquired the registry while the sink was blocked, proving no sink
        // call holds that lock. It queued behind the active drainer instead of emitting N+1.
        assert!(sink.outputs.lock().unwrap().is_empty());
        sink.release_first.wait();
        first.join().unwrap();
        assert_eq!(
            *sink.outputs.lock().unwrap(),
            vec![(2, "first".to_string()), (3, "second".to_string())]
        );
    }

    #[test]
    fn failed_start_cleanup_is_silent_and_releases_the_reservation() {
        let registry = NodePackageTaskRegistry::new();
        let sink = CollectSink::default();
        registry.reserve(metadata("failed-start", "ws-a")).unwrap();
        registry.abort_start("failed-start");

        assert!(registry.state().entries.is_empty());
        assert!(sink.0.lock().unwrap().is_empty());
        assert!(sink.1.lock().unwrap().is_empty());
        assert!(sink.2.lock().unwrap().is_empty());
        registry.reserve(metadata("failed-start", "ws-a")).unwrap();
    }

    #[test]
    fn backend_rejects_oversized_or_control_owner_fields_before_storage() {
        let registry = NodePackageTaskRegistry::new();
        let oversized_workspace: WorkspaceId =
            serde_json::from_value(serde_json::json!("w".repeat(WORKSPACE_ID_BYTES_LIMIT + 1)))
                .unwrap();
        let mut invalid = metadata("invalid-owner", "ws-a");
        invalid.workspace_id = oversized_workspace.clone();
        assert!(registry.reserve(invalid).is_err());

        let mut traversal = metadata("invalid-path", "ws-a");
        traversal.manifest_relative_path = "../package.json".into();
        assert!(registry.reserve(traversal).is_err());
        let mut unsafe_script = metadata("invalid-script", "ws-a");
        unsafe_script.script_name = "bad\nscript".into();
        assert!(registry.reserve(unsafe_script).is_err());

        assert!(registry
            .request_stop(&StopNodePackageTaskRequest {
                run_id: "unknown".into(),
                workspace_id: oversized_workspace.clone(),
            })
            .is_err());
        assert!(registry
            .acknowledge_start("missing", &oversized_workspace, &CollectSink::default())
            .is_err());
        assert!(registry.state().entries.is_empty());
        assert!(registry.state().cancellations.is_empty());
    }

    #[test]
    fn tagged_output_cap_emits_one_marker_and_ignores_later_chunks() {
        let registry = NodePackageTaskRegistry::new();
        let sink = CollectSink::default();
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry.reserve(metadata("cap-run", "ws-a")).unwrap();
        registry.publish_running("cap-run", &sink);
        for _ in 0..(TAGGED_OUTPUT_EVENT_LIMIT + 20) {
            registry.record_output("cap-run", NodePackageTaskOutputStream::Stderr, b"x", &sink);
        }
        registry
            .acknowledge_start("cap-run", &workspace_id, &sink)
            .unwrap();

        let output = sink.1.lock().unwrap();
        assert_eq!(output.len(), TAGGED_OUTPUT_EVENT_LIMIT + 1);
        assert_eq!(output.iter().filter(|event| event.truncated).count(), 1);
        let marker = output.last().unwrap();
        assert!(marker.truncated);
        assert!(marker.data.is_empty());
        assert_eq!(marker.sequence, (TAGGED_OUTPUT_EVENT_LIMIT + 2) as u32);
    }

    #[test]
    fn stop_clears_problems_and_closes_late_output_but_natural_exit_completes() {
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();

        let stopped = NodePackageTaskRegistry::new();
        let stopped_sink = CollectSink::default();
        stopped.reserve(metadata("stopped", "ws-a")).unwrap();
        stopped.publish_running("stopped", &stopped_sink);
        stopped
            .request_stop_with_sink(
                &StopNodePackageTaskRequest {
                    run_id: "stopped".into(),
                    workspace_id: workspace_id.clone(),
                },
                &stopped_sink,
            )
            .unwrap();
        stopped.record_output(
            "stopped",
            NodePackageTaskOutputStream::Stdout,
            b"late",
            &stopped_sink,
        );
        stopped
            .acknowledge_start("stopped", &workspace_id, &stopped_sink)
            .unwrap();
        assert!(stopped_sink.1.lock().unwrap().is_empty());
        let stopped_problems = stopped_sink.2.lock().unwrap();
        assert!(matches!(
            &stopped_problems.last().unwrap().state,
            NodePackageTaskProblemsState::Clear
        ));

        let completed = NodePackageTaskRegistry::new();
        let completed_sink = CollectSink::default();
        completed.reserve(metadata("completed", "ws-a")).unwrap();
        completed.publish_running("completed", &completed_sink);
        completed.finish_problems(
            "completed",
            Some(empty_problem_snapshot()),
            true,
            &completed_sink,
        );
        completed.complete(
            "completed",
            NodePackageTaskCompletion::Exited { exit_code: Some(0) },
            &completed_sink,
        );
        completed
            .acknowledge_start("completed", &workspace_id, &completed_sink)
            .unwrap();
        let completed_problems = completed_sink.2.lock().unwrap();
        assert!(matches!(
            &completed_problems.last().unwrap().state,
            NodePackageTaskProblemsState::Complete { .. }
        ));
        assert!(!completed_problems
            .iter()
            .any(|event| matches!(&event.state, NodePackageTaskProblemsState::Clear)));
    }

    #[cfg(unix)]
    #[test]
    fn stop_after_process_reap_does_not_clear_natural_completion() {
        use std::{process::Command, thread, time::Duration};

        let registry = NodePackageTaskRegistry::new();
        let sink = CollectSink::default();
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry.reserve(metadata("reaped", "ws-a")).unwrap();
        let mut child = Command::new("/usr/bin/true").spawn().unwrap();
        let ownership = TerminalTaskOwnership::new(7, 1, i32::try_from(child.id()).unwrap());
        loop {
            if ownership.try_wait(&mut child).unwrap().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        registry.activate("reaped", ownership).unwrap();
        registry.publish_running("reaped", &sink);
        registry
            .request_stop_with_sink(
                &StopNodePackageTaskRequest {
                    run_id: "reaped".into(),
                    workspace_id: workspace_id.clone(),
                },
                &sink,
            )
            .unwrap();
        registry.finish_problems("reaped", Some(empty_problem_snapshot()), true, &sink);
        registry.complete(
            "reaped",
            NodePackageTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        );
        registry
            .acknowledge_start("reaped", &workspace_id, &sink)
            .unwrap();
        let problems = sink.2.lock().unwrap();
        assert!(matches!(
            &problems.last().unwrap().state,
            NodePackageTaskProblemsState::Complete { .. }
        ));
        assert!(!problems
            .iter()
            .any(|event| matches!(&event.state, NodePackageTaskProblemsState::Clear)));
    }

    #[test]
    fn stop_before_reserve_is_authoritative_idempotent_and_owner_isolated() {
        let registry = NodePackageTaskRegistry::new();
        let workspace_a: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        let workspace_b: WorkspaceId = serde_json::from_value(serde_json::json!("ws-b")).unwrap();
        let stop_a = StopNodePackageTaskRequest {
            run_id: "cancelled-a".into(),
            workspace_id: workspace_a.clone(),
        };

        registry.request_stop(&stop_a).unwrap();
        registry.request_stop(&stop_a).unwrap();
        assert_eq!(registry.state().cancellations.len(), 1);
        assert_eq!(
            registry
                .reserve(metadata("cancelled-a", "ws-a"))
                .unwrap_err(),
            PRESTART_CANCELLED_ERROR
        );
        assert!(registry.state().entries.is_empty());

        assert_eq!(
            registry
                .request_stop(&StopNodePackageTaskRequest {
                    run_id: "cancelled-a".into(),
                    workspace_id: workspace_b,
                })
                .unwrap_err(),
            WRONG_WORKSPACE_ERROR
        );
        assert_eq!(
            registry
                .reserve(metadata("cancelled-a", "ws-a"))
                .unwrap_err(),
            PRESTART_CANCELLED_ERROR
        );
    }

    #[test]
    fn foreign_unknown_stop_cannot_poison_the_authoritative_start_owner() {
        let registry = NodePackageTaskRegistry::new();
        registry
            .request_stop(&StopNodePackageTaskRequest {
                run_id: "shared-run".into(),
                workspace_id: serde_json::from_value(serde_json::json!("ws-b")).unwrap(),
            })
            .unwrap();

        registry.reserve(metadata("shared-run", "ws-a")).unwrap();
        assert!(registry.state().cancellations.is_empty());
        assert_eq!(
            registry
                .request_stop(&StopNodePackageTaskRequest {
                    run_id: "shared-run".into(),
                    workspace_id: serde_json::from_value(serde_json::json!("ws-b")).unwrap(),
                })
                .unwrap_err(),
            WRONG_WORKSPACE_ERROR
        );
    }

    #[test]
    fn admission_caps_are_atomic_and_completion_releases_capacity() {
        let registry = NodePackageTaskRegistry::new();
        registry
            .reserve(metadata_for_session("session-1", "ws-a", 1))
            .unwrap();
        assert_eq!(
            registry
                .reserve(metadata_for_session("session-2", "ws-b", 1))
                .unwrap_err(),
            SESSION_LIMIT_ERROR
        );

        for session_id in 2..=4 {
            registry
                .reserve(metadata_for_session(
                    &format!("workspace-{session_id}"),
                    "ws-a",
                    session_id,
                ))
                .unwrap();
        }
        assert_eq!(
            registry
                .reserve(metadata_for_session("workspace-over", "ws-a", 5))
                .unwrap_err(),
            WORKSPACE_LIMIT_ERROR
        );

        let sink = CollectSink::default();
        registry.complete(
            "session-1",
            NodePackageTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        );
        registry
            .reserve(metadata_for_session("workspace-reuse", "ws-a", 5))
            .unwrap();
    }

    #[test]
    fn global_admission_cap_rejects_before_creating_an_entry() {
        let registry = NodePackageTaskRegistry::new();
        for index in 0..LIVE_TASK_GLOBAL_LIMIT {
            registry
                .reserve(metadata_for_session(
                    &format!("run-{index}"),
                    &format!("ws-{}", index / LIVE_TASK_WORKSPACE_LIMIT),
                    index as u64,
                ))
                .unwrap();
        }
        let before = registry.state().entries.len();
        assert_eq!(
            registry
                .reserve(metadata_for_session("over-global", "ws-extra", 10_000))
                .unwrap_err(),
            GLOBAL_LIMIT_ERROR
        );
        assert_eq!(registry.state().entries.len(), before);
    }

    #[test]
    fn node_run_and_package_tasks_share_the_same_session_admission() {
        let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
        let registry = NodePackageTaskRegistry::with_admission(Arc::clone(&admission));
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        let node_run = admission.reserve(&workspace_id, 77).unwrap();
        assert_eq!(
            registry
                .reserve(metadata_for_session("package", "ws-a", 77))
                .unwrap_err(),
            SESSION_LIMIT_ERROR
        );
        drop(node_run);
        assert!(registry
            .reserve(metadata_for_session("package", "ws-a", 77))
            .is_ok());
    }

    #[test]
    fn concurrent_same_session_reservations_have_exactly_one_winner() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let registry = Arc::new(NodePackageTaskRegistry::new());
        let barrier = Arc::new(Barrier::new(16));
        let workers = (0..16)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    registry.reserve(metadata_for_session(&format!("race-{index}"), "ws-a", 77))
                })
            })
            .collect::<Vec<_>>();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| {
                    result.as_ref().err().map(String::as_str) == Some(SESSION_LIMIT_ERROR)
                })
                .count(),
            15
        );
        assert_eq!(registry.state().entries.len(), 1);
    }

    #[test]
    fn cancellation_tombstones_are_bounded_and_evict_oldest_per_workspace() {
        let registry = NodePackageTaskRegistry::new();
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        for index in 0..=CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT {
            registry
                .request_stop(&StopNodePackageTaskRequest {
                    run_id: format!("cancel-{index}"),
                    workspace_id: workspace_id.clone(),
                })
                .unwrap();
        }

        let state = registry.state();
        assert_eq!(
            cancellation_count_for_workspace(&state, &workspace_id),
            CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
        );
        assert_eq!(
            state.cancellation_order.len(),
            CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
        );
        assert!(!state.cancellations.contains_key("cancel-0"));
        assert!(state.cancellations.contains_key(&format!(
            "cancel-{}",
            CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
        )));
    }

    #[test]
    fn terminal_tombstones_and_total_registry_storage_stay_bounded() {
        let registry = NodePackageTaskRegistry::new();
        let sink = CollectSink::default();
        for index in 0..=TERMINAL_TOMBSTONE_LIMIT {
            let run_id = format!("terminal-{index}");
            registry
                .reserve(metadata_for_session(&run_id, "ws-a", index as u64))
                .unwrap();
            registry.complete(
                &run_id,
                NodePackageTaskCompletion::Exited { exit_code: Some(0) },
                &sink,
            );
        }

        let state = registry.state();
        assert_eq!(state.terminal_order.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert_eq!(state.entries.len(), TERMINAL_TOMBSTONE_LIMIT);
        assert!(!state.entries.contains_key("terminal-0"));
    }

    #[test]
    fn workspace_cleanup_marks_starting_task_stopped_and_releases_its_cap() {
        let registry = NodePackageTaskRegistry::new();
        let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
        registry
            .reserve(metadata_for_session("cleanup", "ws-a", 9))
            .unwrap();
        registry.request_stop_workspace(&workspace_id);

        let sink = CollectSink::default();
        registry.complete(
            "cleanup",
            NodePackageTaskCompletion::Failed {
                message: "workspace disappeared during spawn".into(),
            },
            &sink,
        );
        registry
            .acknowledge_start("cleanup", &workspace_id, &sink)
            .unwrap();
        assert!(matches!(
            sink.0.lock().unwrap()[0].state,
            NodePackageTaskEventState::Stopped
        ));
        registry
            .reserve(metadata_for_session("after-cleanup", "ws-a", 9))
            .unwrap();
    }

    #[test]
    fn cancellation_tombstones_have_a_deterministic_global_bound() {
        let registry = NodePackageTaskRegistry::new();
        for index in 0..=CANCELLATION_TOMBSTONE_GLOBAL_LIMIT {
            registry
                .request_stop(&StopNodePackageTaskRequest {
                    run_id: format!("global-cancel-{index}"),
                    workspace_id: serde_json::from_value(serde_json::json!(format!(
                        "ws-{}",
                        index / CANCELLATION_TOMBSTONE_WORKSPACE_LIMIT
                    )))
                    .unwrap(),
                })
                .unwrap();
        }

        let state = registry.state();
        assert_eq!(
            state.cancellations.len(),
            CANCELLATION_TOMBSTONE_GLOBAL_LIMIT
        );
        assert_eq!(
            state.cancellation_order.len(),
            CANCELLATION_TOMBSTONE_GLOBAL_LIMIT
        );
        assert!(!state.cancellations.contains_key("global-cancel-0"));
        assert!(state.cancellations.contains_key(&format!(
            "global-cancel-{}",
            CANCELLATION_TOMBSTONE_GLOBAL_LIMIT
        )));
    }
}

#[cfg(test)]
#[path = "node_package_task_wire_tests.rs"]
mod wire_tests;
