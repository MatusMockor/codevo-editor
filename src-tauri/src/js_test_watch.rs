use crate::{
    js_test_execution_root::{
        ensure_js_test_execution_context_identity, resolve_js_test_execution_context,
        retain_js_test_process_authority, RetainedJsTestProcessAuthority, RetainedJsTestRunnerKind,
    },
    js_test_run::{JsTestNameMatch, JsTestRunScope},
    terminal_task_process::TerminalTaskOwnership,
    trust::WorkspaceTrustService,
    workspace_registry::{opened_root_path, WorkspaceId, WorkspaceRegistry},
};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{Arc, Mutex, MutexGuard, Weak},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(test)]
use std::process::Command;

const WATCH_ID_BYTES_LIMIT: usize = 128;
const WORKSPACE_ID_BYTES_LIMIT: usize = 1024;
const OUTPUT_CHUNK_BYTES_LIMIT: usize = 64 * 1024;
const OUTPUT_BYTES_LIMIT: usize = 1024 * 1024;
const OUTPUT_EVENT_LIMIT: usize = 1024;
const PENDING_EVENT_LIMIT: usize = OUTPUT_EVENT_LIMIT + 2;
const LIVE_WATCH_GLOBAL_LIMIT: usize = 16;
const LIVE_WATCH_WORKSPACE_LIMIT: usize = 2;
const CANCELLATION_GLOBAL_LIMIT: usize = 1024;
const CANCELLATION_WORKSPACE_LIMIT: usize = 128;
const TERMINAL_TOMBSTONE_LIMIT: usize = 256;
const FAILURE_MESSAGE_BYTES_LIMIT: usize = 4096;
const WATCH_TIMEOUT: Duration = Duration::from_secs(8 * 60 * 60);
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const STATUS_EVENT_NAME: &str = "js-test-watch://status";
const OUTPUT_EVENT_NAME: &str = "js-test-watch://output";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JsTestWatchOwner {
    watch_id: String,
    workspace_id: WorkspaceId,
    epoch: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum JsTestWatchNameMatch {
    Prefix,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum JsTestWatchScope {
    All,
    File {
        relative_file_path: String,
    },
    Suite {
        relative_file_path: String,
        full_name: String,
    },
    Test {
        relative_file_path: String,
        full_name: String,
        #[serde(default)]
        name_match: Option<JsTestWatchNameMatch>,
    },
}

impl<'de> Deserialize<'de> for JsTestWatchScope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| D::Error::custom("JavaScript test watch scope must be an object."))?;
        let kind = object
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| D::Error::custom("JavaScript test watch scope kind is missing."))?;
        let allowed = match kind {
            "all" => &["kind"][..],
            "file" => &["kind", "relativeFilePath"][..],
            "suite" => &["kind", "relativeFilePath", "fullName"][..],
            "test" => &["kind", "relativeFilePath", "fullName", "nameMatch"][..],
            _ => {
                return Err(D::Error::custom(
                    "JavaScript test watch scope kind is invalid.",
                ))
            }
        };
        if object.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err(D::Error::custom(
                "JavaScript test watch scope contains an unknown field.",
            ));
        }
        let required = |field: &str| {
            object
                .get(field)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    D::Error::custom(format!(
                        "JavaScript test watch scope {field} is missing or invalid."
                    ))
                })
        };
        match kind {
            "all" => Ok(Self::All),
            "file" => Ok(Self::File {
                relative_file_path: required("relativeFilePath")?,
            }),
            "suite" => Ok(Self::Suite {
                relative_file_path: required("relativeFilePath")?,
                full_name: required("fullName")?,
            }),
            "test" => Ok(Self::Test {
                relative_file_path: required("relativeFilePath")?,
                full_name: required("fullName")?,
                name_match: object
                    .get("nameMatch")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(D::Error::custom)?,
            }),
            _ => Err(D::Error::custom(
                "JavaScript test watch scope kind is invalid.",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum JsTestWatchCommand {
    VitestWatch {
        #[serde(rename = "packageRootRelativePath")]
        package_root_relative_path: String,
        scope: JsTestWatchScope,
    },
    JestWatch {
        #[serde(rename = "packageRootRelativePath")]
        package_root_relative_path: String,
        scope: JsTestWatchScope,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartJsTestWatchRequest {
    watch_id: String,
    workspace_id: WorkspaceId,
    epoch: u64,
    command: JsTestWatchCommand,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AcknowledgeJsTestWatchStartRequest {
    watch_id: String,
    workspace_id: WorkspaceId,
    epoch: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopJsTestWatchRequest {
    watch_id: String,
    workspace_id: WorkspaceId,
    epoch: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum StructuredResultsAvailability {
    UnavailableInWatchMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartJsTestWatchResponse {
    owner: JsTestWatchOwner,
    structured_results: StructuredResultsAvailability,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
enum JsTestWatchStatus {
    Running,
    Exited {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    Failed {
        message: String,
    },
    Stopped,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsTestWatchStatusEvent {
    owner: JsTestWatchOwner,
    #[serde(flatten)]
    status: JsTestWatchStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum JsTestWatchOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsTestWatchOutputEvent {
    owner: JsTestWatchOwner,
    sequence: u32,
    stream: JsTestWatchOutputStream,
    data: String,
    truncated: bool,
}

trait JsTestWatchEventSink: Send + Sync {
    fn emit_status(&self, event: JsTestWatchStatusEvent);
    fn emit_output(&self, event: JsTestWatchOutputEvent);
}

struct AppJsTestWatchEventSink(AppHandle);

impl JsTestWatchEventSink for AppJsTestWatchEventSink {
    fn emit_status(&self, event: JsTestWatchStatusEvent) {
        let _ = self.0.emit(STATUS_EVENT_NAME, event);
    }

    fn emit_output(&self, event: JsTestWatchOutputEvent) {
        let _ = self.0.emit(OUTPUT_EVENT_NAME, event);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventGate {
    Pending,
    Flushing,
    Open,
}

enum PendingEvent {
    Status(JsTestWatchStatusEvent),
    Output(JsTestWatchOutputEvent),
}

enum WatchPhase {
    Starting { stop_requested: bool },
    Active { ownership: TerminalTaskOwnership },
    Terminal,
}

struct WatchEntry {
    owner: JsTestWatchOwner,
    phase: WatchPhase,
    event_gate: EventGate,
    events_open: bool,
    next_sequence: u32,
    pending_events: VecDeque<PendingEvent>,
    output_bytes: usize,
    output_events: usize,
    output_truncated: bool,
}

#[derive(Clone)]
struct CancellationTombstone {
    owner: JsTestWatchOwner,
}

#[derive(Default)]
struct RegistryState {
    cancellations: HashMap<String, CancellationTombstone>,
    cancellation_order: VecDeque<String>,
    entries: HashMap<String, WatchEntry>,
    terminal_order: VecDeque<String>,
}

pub(crate) struct JsTestWatchRegistry {
    state: Mutex<RegistryState>,
}

impl JsTestWatchRegistry {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(RegistryState::default()),
        }
    }

    fn reserve(&self, owner: JsTestWatchOwner) -> Result<(), String> {
        validate_owner(&owner)?;
        let mut state = self.state();
        if state.entries.contains_key(&owner.watch_id) {
            return Err("A JavaScript test watch with this watchId already exists.".to_string());
        }
        if let Some(cancellation) = state.cancellations.get(&owner.watch_id) {
            if cancellation.owner == owner {
                remove_cancellation(&mut state, &owner.watch_id);
                return Err("JavaScript test watch start was already cancelled.".to_string());
            }
            remove_cancellation(&mut state, &owner.watch_id);
        }
        if state.entries.values().any(|entry| {
            entry.owner.workspace_id == owner.workspace_id
                && entry.owner.epoch == owner.epoch
                && !matches!(entry.phase, WatchPhase::Terminal)
        }) {
            return Err(
                "A JavaScript test watch lease already exists for this owner generation."
                    .to_string(),
            );
        }
        let live_global = state
            .entries
            .values()
            .filter(|entry| !matches!(entry.phase, WatchPhase::Terminal))
            .count();
        if live_global >= LIVE_WATCH_GLOBAL_LIMIT {
            return Err("Global JavaScript test watch limit reached.".to_string());
        }
        let live_workspace = state
            .entries
            .values()
            .filter(|entry| {
                entry.owner.workspace_id == owner.workspace_id
                    && !matches!(entry.phase, WatchPhase::Terminal)
            })
            .count();
        if live_workspace >= LIVE_WATCH_WORKSPACE_LIMIT {
            return Err("Workspace JavaScript test watch limit reached.".to_string());
        }
        state.entries.insert(
            owner.watch_id.clone(),
            WatchEntry {
                owner,
                phase: WatchPhase::Starting {
                    stop_requested: false,
                },
                event_gate: EventGate::Pending,
                events_open: true,
                next_sequence: 0,
                pending_events: VecDeque::new(),
                output_bytes: 0,
                output_events: 0,
                output_truncated: false,
            },
        );
        Ok(())
    }

    fn activate(
        &self,
        owner: &JsTestWatchOwner,
        ownership: TerminalTaskOwnership,
    ) -> Result<bool, String> {
        let mut state = self.state();
        let entry = exact_entry_mut(&mut state, owner)?;
        let WatchPhase::Starting { stop_requested } = entry.phase else {
            return Err("JavaScript test watch is not awaiting activation.".to_string());
        };
        entry.phase = WatchPhase::Active { ownership };
        Ok(stop_requested)
    }

    fn abort_start(&self, owner: &JsTestWatchOwner) {
        let mut state = self.state();
        if state
            .entries
            .get(&owner.watch_id)
            .is_some_and(|entry| entry.owner == *owner)
        {
            state.entries.remove(&owner.watch_id);
            state
                .terminal_order
                .retain(|candidate| candidate != &owner.watch_id);
        }
    }

    fn acknowledge_start(
        &self,
        owner: &JsTestWatchOwner,
        sink: &dyn JsTestWatchEventSink,
    ) -> Result<(), String> {
        validate_owner(owner)?;
        {
            let mut state = self.state();
            let entry = exact_entry_mut(&mut state, owner)?;
            match entry.event_gate {
                EventGate::Open => return Ok(()),
                EventGate::Pending => entry.event_gate = EventGate::Flushing,
                EventGate::Flushing => {
                    return Err(
                        "JavaScript test watch acknowledgement is already flushing.".to_string()
                    )
                }
            }
        }
        self.drain_events(&owner.watch_id, sink);
        Ok(())
    }

    fn publish_running(&self, owner: &JsTestWatchOwner, sink: &dyn JsTestWatchEventSink) {
        self.publish_event(
            owner,
            PendingEvent::Status(JsTestWatchStatusEvent {
                owner: owner.clone(),
                status: JsTestWatchStatus::Running,
            }),
            sink,
        );
    }

    fn record_output(
        &self,
        owner: &JsTestWatchOwner,
        stream: JsTestWatchOutputStream,
        data: &str,
        sink: &dyn JsTestWatchEventSink,
    ) {
        let mut start = 0;
        while start < data.len() {
            let mut end = (start + OUTPUT_CHUNK_BYTES_LIMIT).min(data.len());
            while end > start && !data.is_char_boundary(end) {
                end -= 1;
            }
            self.record_output_chunk(owner, stream, data[start..end].to_string(), sink);
            start = end;
        }
    }

    fn record_output_chunk(
        &self,
        owner: &JsTestWatchOwner,
        stream: JsTestWatchOutputStream,
        data: String,
        sink: &dyn JsTestWatchEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Ok(entry) = exact_entry_mut(&mut state, owner) else {
                return;
            };
            if !entry.events_open || entry.output_truncated {
                return;
            }
            let exceeds_limit = entry.output_events >= OUTPUT_EVENT_LIMIT
                || entry.output_bytes.saturating_add(data.len()) > OUTPUT_BYTES_LIMIT;
            let sequence = entry.next_sequence;
            let Some(next_sequence) = sequence.checked_add(1) else {
                entry.events_open = false;
                return;
            };
            entry.next_sequence = next_sequence;
            let event = if exceeds_limit {
                entry.output_truncated = true;
                JsTestWatchOutputEvent {
                    owner: owner.clone(),
                    sequence,
                    stream,
                    data: String::new(),
                    truncated: true,
                }
            } else {
                entry.output_events += 1;
                entry.output_bytes = entry.output_bytes.saturating_add(data.len());
                JsTestWatchOutputEvent {
                    owner: owner.clone(),
                    sequence,
                    stream,
                    data,
                    truncated: false,
                }
            };
            queue_event(entry, PendingEvent::Output(event))
        };
        if should_drain {
            self.drain_events(&owner.watch_id, sink);
        }
    }

    fn request_stop(&self, owner: &JsTestWatchOwner) -> Result<bool, String> {
        validate_owner(owner)?;
        let mut state = self.state();
        if let Some(entry) = state.entries.get_mut(&owner.watch_id) {
            if entry.owner != *owner {
                return Err(
                    "JavaScript test watch belongs to a different owner generation.".to_string(),
                );
            }
            entry.events_open = false;
            return Ok(match &mut entry.phase {
                WatchPhase::Starting { stop_requested } => {
                    *stop_requested = true;
                    true
                }
                WatchPhase::Active { ownership } => {
                    ownership.request_stop() || ownership.was_stop_requested()
                }
                WatchPhase::Terminal => false,
            });
        }
        if let Some(cancellation) = state.cancellations.get(&owner.watch_id) {
            if cancellation.owner != *owner {
                return Err(
                    "JavaScript test watch belongs to a different owner generation.".to_string(),
                );
            }
            return Ok(true);
        }
        record_cancellation(&mut state, owner.clone());
        Ok(true)
    }

    fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        self.request_stop_matching(|entry| &entry.owner.workspace_id == workspace_id);
    }

    fn request_stop_all(&self) {
        self.request_stop_matching(|_| true);
    }

    fn request_stop_matching(&self, matches_entry: impl Fn(&WatchEntry) -> bool) {
        let ownership = {
            let mut state = self.state();
            state
                .entries
                .values_mut()
                .filter(|entry| matches_entry(entry))
                .filter_map(|entry| {
                    entry.events_open = false;
                    match &mut entry.phase {
                        WatchPhase::Starting { stop_requested } => {
                            *stop_requested = true;
                            None
                        }
                        WatchPhase::Active { ownership } => Some(ownership.clone()),
                        WatchPhase::Terminal => None,
                    }
                })
                .collect::<Vec<_>>()
        };
        for owner in ownership {
            owner.request_stop();
        }
    }

    fn complete(
        &self,
        owner: &JsTestWatchOwner,
        completion: JsTestWatchStatus,
        sink: &dyn JsTestWatchEventSink,
    ) {
        let event = {
            let mut state = self.state();
            let Ok(entry) = exact_entry_mut(&mut state, owner) else {
                return;
            };
            if matches!(entry.phase, WatchPhase::Terminal) {
                return;
            }
            let stopped = match &entry.phase {
                WatchPhase::Starting { stop_requested } => *stop_requested,
                WatchPhase::Active { ownership } => ownership.was_stop_requested(),
                WatchPhase::Terminal => false,
            };
            entry.phase = WatchPhase::Terminal;
            let status = if stopped {
                JsTestWatchStatus::Stopped
            } else {
                bounded_watch_status(completion)
            };
            let event = JsTestWatchStatusEvent {
                owner: owner.clone(),
                status,
            };
            state.terminal_order.push_back(owner.watch_id.clone());
            while state.terminal_order.len() > TERMINAL_TOMBSTONE_LIMIT {
                if let Some(expired) = state.terminal_order.pop_front() {
                    state.entries.remove(&expired);
                }
            }
            event
        };
        self.publish_terminal(owner, event, sink);
    }

    fn publish_terminal(
        &self,
        owner: &JsTestWatchOwner,
        event: JsTestWatchStatusEvent,
        sink: &dyn JsTestWatchEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Ok(entry) = exact_entry_mut(&mut state, owner) else {
                return;
            };
            if entry.pending_events.len() >= PENDING_EVENT_LIMIT {
                entry.pending_events.pop_front();
            }
            let should_drain = queue_event(entry, PendingEvent::Status(event));
            entry.events_open = false;
            should_drain
        };
        if should_drain {
            self.drain_events(&owner.watch_id, sink);
        }
    }

    fn publish_event(
        &self,
        owner: &JsTestWatchOwner,
        event: PendingEvent,
        sink: &dyn JsTestWatchEventSink,
    ) {
        let should_drain = {
            let mut state = self.state();
            let Ok(entry) = exact_entry_mut(&mut state, owner) else {
                return;
            };
            if !entry.events_open || entry.pending_events.len() >= PENDING_EVENT_LIMIT {
                return;
            }
            queue_event(entry, event)
        };
        if should_drain {
            self.drain_events(&owner.watch_id, sink);
        }
    }

    fn drain_events(&self, watch_id: &str, sink: &dyn JsTestWatchEventSink) {
        loop {
            let event = {
                let mut state = self.state();
                let Some(entry) = state.entries.get_mut(watch_id) else {
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
            match event {
                PendingEvent::Status(event) => sink.emit_status(event),
                PendingEvent::Output(event) => sink.emit_output(event),
            }
        }
    }

    fn state(&self) -> MutexGuard<'_, RegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl Drop for JsTestWatchRegistry {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for entry in state.entries.values_mut() {
            if let WatchPhase::Active { ownership } = &entry.phase {
                ownership.request_stop();
            }
        }
    }
}

fn bounded_watch_status(status: JsTestWatchStatus) -> JsTestWatchStatus {
    let JsTestWatchStatus::Failed { message } = status else {
        return status;
    };
    if message.len() <= FAILURE_MESSAGE_BYTES_LIMIT {
        return JsTestWatchStatus::Failed { message };
    }
    JsTestWatchStatus::Failed {
        message: "JavaScript test watch failed with an oversized diagnostic.".to_string(),
    }
}

fn record_cancellation(state: &mut RegistryState, owner: JsTestWatchOwner) {
    state.cancellations.insert(
        owner.watch_id.clone(),
        CancellationTombstone {
            owner: owner.clone(),
        },
    );
    state.cancellation_order.push_back(owner.watch_id.clone());
    while cancellation_count_for_workspace(state, &owner.workspace_id)
        > CANCELLATION_WORKSPACE_LIMIT
    {
        let Some(position) = state.cancellation_order.iter().position(|watch_id| {
            state
                .cancellations
                .get(watch_id)
                .is_some_and(|entry| entry.owner.workspace_id == owner.workspace_id)
        }) else {
            break;
        };
        if let Some(expired) = state.cancellation_order.remove(position) {
            state.cancellations.remove(&expired);
        }
    }
    while state.cancellations.len() > CANCELLATION_GLOBAL_LIMIT {
        let Some(expired) = state.cancellation_order.pop_front() else {
            break;
        };
        state.cancellations.remove(&expired);
    }
}

fn remove_cancellation(state: &mut RegistryState, watch_id: &str) {
    state.cancellations.remove(watch_id);
    state
        .cancellation_order
        .retain(|candidate| candidate != watch_id);
}

fn cancellation_count_for_workspace(state: &RegistryState, workspace_id: &WorkspaceId) -> usize {
    state
        .cancellations
        .values()
        .filter(|entry| &entry.owner.workspace_id == workspace_id)
        .count()
}

fn exact_entry_mut<'a>(
    state: &'a mut RegistryState,
    owner: &JsTestWatchOwner,
) -> Result<&'a mut WatchEntry, String> {
    let entry = state
        .entries
        .get_mut(&owner.watch_id)
        .ok_or_else(|| "JavaScript test watch is not registered.".to_string())?;
    if entry.owner != *owner {
        return Err("JavaScript test watch belongs to a different owner generation.".to_string());
    }
    Ok(entry)
}

fn queue_event(entry: &mut WatchEntry, event: PendingEvent) -> bool {
    entry.pending_events.push_back(event);
    if entry.event_gate == EventGate::Open {
        entry.event_gate = EventGate::Flushing;
        true
    } else {
        false
    }
}

fn validate_owner(owner: &JsTestWatchOwner) -> Result<(), String> {
    if owner.watch_id.trim().is_empty()
        || owner.watch_id.len() > WATCH_ID_BYTES_LIMIT
        || owner.watch_id.chars().any(char::is_control)
    {
        return Err("JavaScript test watch watchId is invalid.".to_string());
    }
    let workspace_id = owner.workspace_id.as_str();
    if workspace_id.trim().is_empty()
        || workspace_id.len() > WORKSPACE_ID_BYTES_LIMIT
        || workspace_id.chars().any(char::is_control)
    {
        return Err("JavaScript test watch workspaceId is invalid.".to_string());
    }
    if owner.epoch == 0 || owner.epoch > MAX_SAFE_INTEGER {
        return Err("JavaScript test watch epoch is invalid.".to_string());
    }
    Ok(())
}

struct WatchPlan {
    args: Vec<String>,
    authority: RetainedJsTestProcessAuthority,
}

fn prepare_watch_plan(root: &File, command: &JsTestWatchCommand) -> Result<WatchPlan, String> {
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (root, command);
        return Err(
            "Secure JavaScript test watch is available only on macOS and Linux.".to_string(),
        );
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let root_path = opened_root_path(root).map_err(|error| {
            format!("Registered JavaScript test workspace is unavailable: {error}")
        })?;
        ensure_root_identity(root, &root_path)?;
        let (runner_name, runner_kind, package_relative_path, scope) = match command {
            JsTestWatchCommand::VitestWatch {
                package_root_relative_path,
                scope,
            } => (
                "vitest",
                RetainedJsTestRunnerKind::Vitest,
                package_root_relative_path,
                scope,
            ),
            JsTestWatchCommand::JestWatch {
                package_root_relative_path,
                scope,
            } => (
                "jest",
                RetainedJsTestRunnerKind::Jest,
                package_root_relative_path,
                scope,
            ),
        };
        if !matches!(scope, JsTestWatchScope::All) {
            return Err(
                "Native continuous test watch currently supports only the full package. Selected file, suite, and test runs remain available as one-shot runs."
                    .to_string(),
            );
        }
        let context = resolve_js_test_execution_context(
            &root_path,
            package_relative_path,
            test_run_scope(scope),
        )?;
        ensure_js_test_execution_context_identity(&context)?;
        let binary = nearest_runner_binary(&root_path, &context.execution_root, runner_name)?;
        let authority = retain_js_test_process_authority(&context, &binary, runner_kind)?;
        let args = watch_args(&context.scope, runner_kind)?;
        ensure_root_identity(root, &root_path)?;
        ensure_js_test_execution_context_identity(&context)?;
        authority.ensure_spawn_identity()?;
        Ok(WatchPlan { args, authority })
    }
}

fn nearest_runner_binary(
    workspace_root: &Path,
    package_root: &Path,
    runner_name: &str,
) -> Result<PathBuf, String> {
    let canonical_workspace = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Failed to resolve JavaScript test watch workspace: {error}"))?;
    let mut candidate = package_root.to_path_buf();
    loop {
        let binary = candidate.join("node_modules/.bin").join(runner_name);
        if binary.is_file() {
            let resolved = fs::canonicalize(&binary).map_err(|error| {
                format!("Failed to resolve JavaScript test watch runner: {error}")
            })?;
            if !resolved.starts_with(&canonical_workspace) || !resolved.is_file() {
                return Err(
                    "JavaScript test watch runner must stay inside its workspace.".to_string(),
                );
            }
            return Ok(binary);
        }
        if candidate == workspace_root {
            break;
        }
        let Some(parent) = candidate.parent() else {
            break;
        };
        if !parent.starts_with(workspace_root) {
            break;
        }
        candidate = parent.to_path_buf();
    }
    Err(format!(
        "JavaScript test watch runner {runner_name} is unavailable."
    ))
}

fn test_run_scope(scope: &JsTestWatchScope) -> JsTestRunScope {
    match scope {
        JsTestWatchScope::All => JsTestRunScope::All,
        JsTestWatchScope::File { relative_file_path } => JsTestRunScope::File {
            relative_file_path: relative_file_path.clone(),
        },
        JsTestWatchScope::Suite {
            relative_file_path,
            full_name,
        } => JsTestRunScope::Suite {
            relative_file_path: relative_file_path.clone(),
            full_name: full_name.clone(),
        },
        JsTestWatchScope::Test {
            relative_file_path,
            full_name,
            name_match,
        } => JsTestRunScope::Test {
            relative_file_path: relative_file_path.clone(),
            full_name: full_name.clone(),
            name_match: name_match.map(|_| JsTestNameMatch::Prefix),
        },
    }
}

fn watch_args(
    scope: &JsTestRunScope,
    runner_kind: RetainedJsTestRunnerKind,
) -> Result<Vec<String>, String> {
    match scope {
        JsTestRunScope::All => Ok(vec![match runner_kind {
            RetainedJsTestRunnerKind::Vitest => "--watch",
            RetainedJsTestRunnerKind::Jest => "--watchAll",
        }
        .to_string()]),
        _ => Err(
            "Native continuous test watch currently supports only the full package.".to_string(),
        ),
    }
}

#[cfg(unix)]
fn ensure_root_identity(root: &File, path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let registered = root
        .metadata()
        .map_err(|error| format!("Failed to inspect registered workspace: {error}"))?;
    let current = path
        .metadata()
        .map_err(|error| format!("Registered workspace path is unavailable: {error}"))?;
    if registered.dev() != current.dev() || registered.ino() != current.ino() {
        return Err("Registered JavaScript test workspace identity changed.".to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_root_identity(_root: &File, path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Registered JavaScript test workspace identity changed.".to_string());
    }
    Ok(())
}

struct SpawnedWatch {
    child: Child,
    ownership: TerminalTaskOwnership,
    reaped: bool,
    stdout: Option<thread::JoinHandle<()>>,
    stderr: Option<thread::JoinHandle<()>>,
}

impl Drop for SpawnedWatch {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        self.ownership.request_stop();
        if self.ownership.wait_after_terminate(&mut self.child).is_ok() {
            self.reaped = true;
        }
    }
}

fn spawn_watch(
    plan: WatchPlan,
    owner: JsTestWatchOwner,
    registry: Arc<JsTestWatchRegistry>,
    sink: Arc<dyn JsTestWatchEventSink>,
) -> Result<SpawnedWatch, String> {
    plan.authority.ensure_spawn_identity()?;
    let mut command = plan.authority.into_command(plan.args);
    command
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start JavaScript test watch: {error}"))?;
    let process_group_id = match i32::try_from(child.id()) {
        Ok(process_group_id) => process_group_id,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("JavaScript test watch process id is invalid.".to_string());
        }
    };
    let ownership = TerminalTaskOwnership::new(owner.epoch, 0, process_group_id);
    let Some(stdout) = child.stdout.take() else {
        ownership.terminate();
        let _ = ownership.wait_after_terminate(&mut child);
        return Err("JavaScript test watch has no stdout pipe.".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        ownership.terminate();
        let _ = ownership.wait_after_terminate(&mut child);
        return Err("JavaScript test watch has no stderr pipe.".to_string());
    };
    let stdout_registry = Arc::downgrade(&registry);
    let stdout_owner = owner.clone();
    let stdout_sink = Arc::clone(&sink);
    let stdout = thread::spawn(move || {
        read_output(
            stdout,
            stdout_owner,
            JsTestWatchOutputStream::Stdout,
            stdout_registry,
            stdout_sink,
        );
    });
    let stderr_registry = Arc::downgrade(&registry);
    let stderr_owner = owner;
    let stderr_sink = sink;
    let stderr = thread::spawn(move || {
        read_output(
            stderr,
            stderr_owner,
            JsTestWatchOutputStream::Stderr,
            stderr_registry,
            stderr_sink,
        );
    });
    Ok(SpawnedWatch {
        child,
        ownership,
        reaped: false,
        stdout: Some(stdout),
        stderr: Some(stderr),
    })
}

fn read_output(
    output: impl Read,
    owner: JsTestWatchOwner,
    stream: JsTestWatchOutputStream,
    registry: Weak<JsTestWatchRegistry>,
    sink: Arc<dyn JsTestWatchEventSink>,
) {
    let mut reader = BufReader::new(output);
    let mut bytes = [0u8; OUTPUT_CHUNK_BYTES_LIMIT];
    let mut pending = Vec::with_capacity(OUTPUT_CHUNK_BYTES_LIMIT + 4);
    loop {
        let read = match reader.read(&mut bytes) {
            Ok(0) => {
                if !pending.is_empty() {
                    let Some(registry) = registry.upgrade() else {
                        return;
                    };
                    let data = String::from_utf8_lossy(&pending);
                    registry.record_output(&owner, stream, &data, sink.as_ref());
                }
                return;
            }
            Err(_) => return,
            Ok(read) => read,
        };
        pending.extend_from_slice(&bytes[..read]);
        let Some(registry) = registry.upgrade() else {
            return;
        };
        flush_complete_utf8(&mut pending, &owner, stream, &registry, sink.as_ref());
    }
}

fn flush_complete_utf8(
    pending: &mut Vec<u8>,
    owner: &JsTestWatchOwner,
    stream: JsTestWatchOutputStream,
    registry: &JsTestWatchRegistry,
    sink: &dyn JsTestWatchEventSink,
) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(data) => {
                registry.record_output(owner, stream, data, sink);
                pending.clear();
                return;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                let error_len = error.error_len();
                if valid_up_to > 0 {
                    let data = String::from_utf8(pending[..valid_up_to].to_vec())
                        .unwrap_or_else(|_| String::new());
                    registry.record_output(owner, stream, &data, sink);
                    pending.drain(..valid_up_to);
                }
                let Some(error_len) = error_len else {
                    return;
                };
                registry.record_output(owner, stream, "\u{fffd}", sink);
                pending.drain(..error_len);
            }
        }
    }
}

fn finish_watch(spawned: SpawnedWatch) -> JsTestWatchStatus {
    finish_watch_with_timeout(spawned, WATCH_TIMEOUT)
}

fn finish_watch_with_timeout(mut spawned: SpawnedWatch, timeout: Duration) -> JsTestWatchStatus {
    let deadline = Instant::now() + timeout;
    let status = loop {
        #[cfg(not(unix))]
        if spawned.ownership.was_stop_requested() {
            let _ = spawned.child.kill();
        }
        match spawned.ownership.try_wait(&mut spawned.child) {
            Ok(Some(status)) => {
                spawned.reaped = true;
                break Ok(status);
            }
            Ok(None) => {}
            Err(error) => {
                if spawned
                    .ownership
                    .wait_after_terminate(&mut spawned.child)
                    .is_ok()
                {
                    spawned.reaped = true;
                }
                break Err(format!("Failed to inspect JavaScript test watch: {error}"));
            }
        }
        if Instant::now() >= deadline {
            if spawned
                .ownership
                .wait_after_terminate(&mut spawned.child)
                .is_ok()
            {
                spawned.reaped = true;
            }
            break Err(format!(
                "JavaScript test watch timed out after {} seconds.",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    };
    if let Some(stdout) = spawned.stdout.take() {
        let _ = stdout.join();
    }
    if let Some(stderr) = spawned.stderr.take() {
        let _ = stderr.join();
    }
    if spawned.ownership.was_stop_requested() {
        return JsTestWatchStatus::Stopped;
    }
    match status {
        Ok(status) => JsTestWatchStatus::Exited {
            exit_code: status.code(),
        },
        Err(message) => JsTestWatchStatus::Failed { message },
    }
}

fn owner_from_start(request: &StartJsTestWatchRequest) -> JsTestWatchOwner {
    JsTestWatchOwner {
        watch_id: request.watch_id.clone(),
        workspace_id: request.workspace_id.clone(),
        epoch: request.epoch,
    }
}

fn owner_from_ack(request: &AcknowledgeJsTestWatchStartRequest) -> JsTestWatchOwner {
    JsTestWatchOwner {
        watch_id: request.watch_id.clone(),
        workspace_id: request.workspace_id.clone(),
        epoch: request.epoch,
    }
}

fn owner_from_stop(request: &StopJsTestWatchRequest) -> JsTestWatchOwner {
    JsTestWatchOwner {
        watch_id: request.watch_id.clone(),
        workspace_id: request.workspace_id.clone(),
        epoch: request.epoch,
    }
}

#[tauri::command]
pub(crate) fn workspace_start_js_test_watch(
    app: AppHandle,
    request: StartJsTestWatchRequest,
) -> Result<StartJsTestWatchResponse, String> {
    let owner = owner_from_start(&request);
    let registry = app.state::<Arc<JsTestWatchRegistry>>();
    registry.reserve(owner.clone())?;
    let sink: Arc<dyn JsTestWatchEventSink> = Arc::new(AppJsTestWatchEventSink(app.clone()));
    let spawned = (|| {
        let workspace_registry = app.state::<WorkspaceRegistry>();
        let operation = workspace_registry
            .lock_operations()
            .map_err(|error| error.to_string())?;
        let descriptor = workspace_registry
            .descriptor(&owner.workspace_id)
            .map_err(|_| "JavaScript test watch workspace is not open.".to_string())?;
        let root = workspace_registry
            .clone_root(&owner.workspace_id)
            .map_err(|_| "JavaScript test watch workspace is not open.".to_string())?;
        let root_path = opened_root_path(&root).map_err(|error| {
            format!("Registered JavaScript test workspace is unavailable: {error}")
        })?;
        if root_path != descriptor.canonical_root_path {
            return Err("Registered JavaScript test workspace identity changed.".to_string());
        }
        let trust_root = descriptor.selected_root_path.to_str().ok_or_else(|| {
            "JavaScript test watch workspace path is not valid UTF-8.".to_string()
        })?;
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(trust_root).trusted {
            return Err("Trust this workspace to start JavaScript test watch.".to_string());
        }
        let plan = prepare_watch_plan(&root, &request.command)?;
        ensure_root_identity(&root, &root_path)?;
        let spawned = spawn_watch(
            plan,
            owner.clone(),
            Arc::clone(&registry),
            Arc::clone(&sink),
        )?;
        drop(trust_guard);
        drop(operation);
        Ok(spawned)
    })();
    let spawned = match spawned {
        Ok(spawned) => spawned,
        Err(message) => {
            registry.abort_start(&owner);
            return Err(message);
        }
    };
    let stop_requested = match registry.activate(&owner, spawned.ownership.clone()) {
        Ok(stop_requested) => stop_requested,
        Err(message) => {
            spawned.ownership.request_stop();
            registry.abort_start(&owner);
            tauri::async_runtime::spawn_blocking(move || {
                let _ = finish_watch(spawned);
            });
            return Err(message);
        }
    };
    if stop_requested {
        spawned.ownership.request_stop();
    }
    registry.publish_running(&owner, sink.as_ref());
    let worker_registry = Arc::downgrade(&registry);
    let worker_owner = owner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let completion = finish_watch(spawned);
        if let Some(registry) = worker_registry.upgrade() {
            registry.complete(&worker_owner, completion, sink.as_ref());
        }
    });
    Ok(StartJsTestWatchResponse {
        owner,
        structured_results: StructuredResultsAvailability::UnavailableInWatchMode,
    })
}

#[tauri::command]
pub(crate) fn workspace_acknowledge_js_test_watch_start(
    app: AppHandle,
    request: AcknowledgeJsTestWatchStartRequest,
) -> Result<(), String> {
    let owner = owner_from_ack(&request);
    app.state::<Arc<JsTestWatchRegistry>>()
        .acknowledge_start(&owner, &AppJsTestWatchEventSink(app.clone()))
}

#[tauri::command]
pub(crate) fn workspace_stop_js_test_watch(
    app: AppHandle,
    request: StopJsTestWatchRequest,
) -> Result<(), String> {
    let owner = owner_from_stop(&request);
    app.state::<Arc<JsTestWatchRegistry>>()
        .request_stop(&owner)?;
    Ok(())
}

pub(crate) fn request_stop_workspace_in_app(app: &AppHandle, workspace_id: &WorkspaceId) {
    if let Some(registry) = app.try_state::<Arc<JsTestWatchRegistry>>() {
        registry.request_stop_workspace(workspace_id);
    }
}

pub(crate) fn request_stop_all_in_app(app: &AppHandle) {
    if let Some(registry) = app.try_state::<Arc<JsTestWatchRegistry>>() {
        registry.request_stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
    };

    #[derive(Default)]
    struct CollectSink {
        statuses: Mutex<Vec<JsTestWatchStatusEvent>>,
        output: Mutex<Vec<JsTestWatchOutputEvent>>,
    }

    impl JsTestWatchEventSink for CollectSink {
        fn emit_status(&self, event: JsTestWatchStatusEvent) {
            self.statuses.lock().unwrap().push(event);
        }

        fn emit_output(&self, event: JsTestWatchOutputEvent) {
            self.output.lock().unwrap().push(event);
        }
    }

    fn workspace(value: &str) -> WorkspaceId {
        serde_json::from_value(serde_json::json!(value)).unwrap()
    }

    fn owner(watch_id: &str, workspace_id: &str, epoch: u64) -> JsTestWatchOwner {
        JsTestWatchOwner {
            watch_id: watch_id.to_string(),
            workspace_id: workspace(workspace_id),
            epoch,
        }
    }

    #[test]
    fn strict_ipc_contracts_reject_unknown_fields() {
        assert!(
            serde_json::from_value::<StartJsTestWatchRequest>(serde_json::json!({
                "watchId": "watch-1",
                "workspaceId": "workspace-1",
                "epoch": 1,
                "command": {
                    "kind": "vitest-watch",
                    "packageRootRelativePath": "",
                    "scope": { "kind": "all" }
                },
                "unknown": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StartJsTestWatchRequest>(serde_json::json!({
                "watchId": "watch-1",
                "workspaceId": "workspace-1",
                "epoch": 1,
                "command": {
                    "kind": "vitest-watch",
                    "packageRootRelativePath": "",
                    "scope": { "kind": "all", "unknown": true }
                }
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<AcknowledgeJsTestWatchStartRequest>(serde_json::json!({
                "watchId": "watch-1",
                "workspaceId": "workspace-1",
                "epoch": 1,
                "unknown": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StopJsTestWatchRequest>(serde_json::json!({
                "watchId": "watch-1",
                "workspaceId": "workspace-1",
                "epoch": 1,
                "unknown": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<JsTestWatchOutputEvent>(serde_json::json!({
                "owner": { "watchId": "watch-1", "workspaceId": "workspace-1", "epoch": 1 },
                "sequence": 0,
                "stream": "stdout",
                "data": "x",
                "truncated": false,
                "unknown": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<JsTestWatchStatusEvent>(serde_json::json!({
                "owner": { "watchId": "watch-1", "workspaceId": "workspace-1", "epoch": 1 },
                "status": "running",
                "unknown": true
            }))
            .is_err()
        );
    }

    #[test]
    fn response_and_events_have_exact_wire_shapes() {
        let owner = owner("watch-1", "workspace-1", 7);
        assert_eq!(
            serde_json::to_value(StartJsTestWatchResponse {
                owner: owner.clone(),
                structured_results: StructuredResultsAvailability::UnavailableInWatchMode,
            })
            .unwrap(),
            serde_json::json!({
                "owner": { "watchId": "watch-1", "workspaceId": "workspace-1", "epoch": 7 },
                "structuredResults": "unavailable-in-watch-mode"
            })
        );
        assert_eq!(
            serde_json::to_value(JsTestWatchStatusEvent {
                owner: owner.clone(),
                status: JsTestWatchStatus::Exited { exit_code: Some(3) },
            })
            .unwrap(),
            serde_json::json!({
                "owner": { "watchId": "watch-1", "workspaceId": "workspace-1", "epoch": 7 },
                "status": "exited",
                "exitCode": 3
            })
        );
        assert_eq!(
            serde_json::to_value(JsTestWatchOutputEvent {
                owner,
                sequence: 2,
                stream: JsTestWatchOutputStream::Stderr,
                data: "failure".to_string(),
                truncated: false,
            })
            .unwrap(),
            serde_json::json!({
                "owner": { "watchId": "watch-1", "workspaceId": "workspace-1", "epoch": 7 },
                "sequence": 2,
                "stream": "stderr",
                "data": "failure",
                "truncated": false
            })
        );
    }

    #[test]
    fn late_and_foreign_owner_events_fail_closed() {
        let registry = JsTestWatchRegistry::new();
        let current = owner("watch-1", "workspace-a", 2);
        let stale = owner("watch-1", "workspace-a", 1);
        let foreign = owner("watch-1", "workspace-b", 2);
        let sink = CollectSink::default();
        registry.reserve(current.clone()).unwrap();
        registry.record_output(&stale, JsTestWatchOutputStream::Stdout, "stale", &sink);
        registry.record_output(&foreign, JsTestWatchOutputStream::Stdout, "foreign", &sink);
        assert!(registry.acknowledge_start(&stale, &sink).is_err());
        assert!(registry.request_stop(&foreign).is_err());
        let uncertain = owner("uncertain", "workspace-a", 3);
        assert!(registry.request_stop(&uncertain).unwrap());
        assert!(registry.reserve(uncertain).is_err());
        registry.acknowledge_start(&current, &sink).unwrap();
        assert!(sink.output.lock().unwrap().is_empty());
    }

    #[test]
    fn workspace_a_b_a_uses_a_new_generation_and_tabs_do_not_leak() {
        let registry = JsTestWatchRegistry::new();
        let first_a = owner("watch-a-1", "workspace-a", 1);
        let b = owner("watch-b", "workspace-b", 1);
        let second_a = owner("watch-a-2", "workspace-a", 2);
        registry.reserve(first_a.clone()).unwrap();
        registry.reserve(b.clone()).unwrap();
        registry.request_stop_workspace(&first_a.workspace_id);
        registry.reserve(second_a.clone()).unwrap();
        let state = registry.state();
        assert!(matches!(
            state.entries.get("watch-a-1").map(|entry| &entry.phase),
            Some(WatchPhase::Starting {
                stop_requested: true
            })
        ));
        assert!(matches!(
            state.entries.get("watch-b").map(|entry| &entry.phase),
            Some(WatchPhase::Starting {
                stop_requested: false
            })
        ));
        assert!(matches!(
            state.entries.get("watch-a-2").map(|entry| &entry.phase),
            Some(WatchPhase::Starting {
                stop_requested: false
            })
        ));
    }

    #[test]
    fn admission_and_output_are_bounded() {
        let registry = JsTestWatchRegistry::new();
        let sink = CollectSink::default();
        for index in 0..LIVE_WATCH_WORKSPACE_LIMIT {
            registry
                .reserve(owner(
                    &format!("watch-{index}"),
                    "workspace-a",
                    index as u64 + 1,
                ))
                .unwrap();
        }
        assert!(registry
            .reserve(owner("same-generation", "workspace-a", 1))
            .is_err());
        assert!(registry
            .reserve(owner("watch-over", "workspace-a", 9))
            .is_err());
        let output_owner = owner("output", "workspace-b", 1);
        registry.reserve(output_owner.clone()).unwrap();
        for _ in 0..(OUTPUT_EVENT_LIMIT + 2) {
            registry.record_output(&output_owner, JsTestWatchOutputStream::Stdout, "x", &sink);
        }
        registry.acknowledge_start(&output_owner, &sink).unwrap();
        let output = sink.output.lock().unwrap();
        assert_eq!(output.len(), OUTPUT_EVENT_LIMIT + 1);
        assert_eq!(output.iter().filter(|event| event.truncated).count(), 1);
        assert!(output.last().unwrap().data.is_empty());
    }

    #[test]
    fn incremental_utf8_preserves_split_scalars() {
        let registry = JsTestWatchRegistry::new();
        let sink = CollectSink::default();
        let owner = owner("utf8", "workspace-a", 1);
        registry.reserve(owner.clone()).unwrap();
        registry.acknowledge_start(&owner, &sink).unwrap();
        let bytes = "💩".as_bytes();
        let mut pending = bytes[..2].to_vec();
        flush_complete_utf8(
            &mut pending,
            &owner,
            JsTestWatchOutputStream::Stdout,
            &registry,
            &sink,
        );
        assert!(sink.output.lock().unwrap().is_empty());
        pending.extend_from_slice(&bytes[2..]);
        flush_complete_utf8(
            &mut pending,
            &owner,
            JsTestWatchOutputStream::Stdout,
            &registry,
            &sink,
        );
        assert_eq!(sink.output.lock().unwrap()[0].data, "💩");
    }

    #[test]
    fn finds_a_hoisted_runner_inside_the_workspace() {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "js-test-watch-hoisted-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        let package = root.join("packages/example");
        let binary = root.join("node_modules/.bin/vitest");
        fs::create_dir_all(&package).unwrap();
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, "").unwrap();

        assert_eq!(
            nearest_runner_binary(&root, &package, "vitest").unwrap(),
            binary
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
#[path = "js_test_watch_authority_tests.rs"]
mod authority_tests;

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
#[path = "js_test_watch_lifecycle_tests.rs"]
mod lifecycle_tests;
