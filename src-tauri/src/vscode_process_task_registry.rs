use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};

use crate::{
    terminal_task_admission::{TerminalTaskAdmission, TerminalTaskAdmissionRegistry},
    terminal_task_process::TerminalTaskOwnership,
    vscode_process_task_events::{
        VscodeProcessTaskEvent, VscodeProcessTaskEventSink, VscodeProcessTaskOutputStream,
        VscodeProcessTaskOwner, VscodeProcessTaskStatus,
    },
    workspace_registry::WorkspaceId,
};

const PRESTART_TOMBSTONE_GLOBAL_LIMIT: usize = 1_024;
const PRESTART_TOMBSTONE_WORKSPACE_LIMIT: usize = 128;
const TERMINAL_TOMBSTONE_LIMIT: usize = 1_024;
const OUTPUT_CHUNK_BYTES_LIMIT: usize = 8 * 1_024;
const OUTPUT_EVENT_LIMIT: usize = 1_024;
const OUTPUT_BYTES_LIMIT: usize = 1_024 * 1_024;
const MAX_OWNER_TEXT_BYTES: usize = 1_024;
const MAX_FAILED_MESSAGE_BYTES: usize = 4 * 1_024;
const MAX_STEP_LABEL_BYTES: usize = 256;
const MAX_CHAIN_STEPS: u16 = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventGate {
    Pending,
    Flushing,
    Open,
}

enum TaskPhase {
    Starting {
        stop_requested: bool,
    },
    Active {
        ownership: TerminalTaskOwnership,
        stop_requested: bool,
    },
    Terminal,
}

struct TaskEntry {
    admission: Option<TerminalTaskAdmission>,
    decoders: TaggedOutputDecoders,
    event_gate: EventGate,
    events_open: bool,
    next_sequence: u32,
    output_bytes: usize,
    output_events: usize,
    output_truncated: bool,
    last_step_index: u16,
    step_total: Option<u16>,
    owner: VscodeProcessTaskOwner,
    pending_events: VecDeque<VscodeProcessTaskEvent>,
    phase: TaskPhase,
}

#[derive(Default)]
struct RegistryState {
    cancellations: HashMap<String, VscodeProcessTaskOwner>,
    cancellation_order: VecDeque<String>,
    entries: HashMap<String, TaskEntry>,
    terminal_order: VecDeque<String>,
}

pub(crate) struct VscodeProcessTaskRegistry {
    admission: Arc<TerminalTaskAdmissionRegistry>,
    initial_sequence: u32,
    state: Mutex<RegistryState>,
}

#[derive(Clone, Debug)]
pub(crate) enum VscodeProcessTaskStopAction {
    AlreadyRequested,
    PrestartRecorded,
    StopStarting,
    Terminate(TerminalTaskOwnership),
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum VscodeProcessTaskStepActivation {
    Activated,
    StopRequested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct VscodeProcessTaskStep<'a> {
    pub(crate) label: &'a str,
    pub(crate) index: u16,
    pub(crate) total: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum VscodeProcessTaskCompletion {
    Exited { exit_code: Option<i32> },
    Failed { message: String },
    Stopped,
}

impl VscodeProcessTaskRegistry {
    pub(crate) fn with_admission(admission: Arc<TerminalTaskAdmissionRegistry>) -> Self {
        Self {
            admission,
            initial_sequence: 1,
            state: Mutex::new(RegistryState::default()),
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn with_initial_sequence(
        admission: Arc<TerminalTaskAdmissionRegistry>,
        initial_sequence: u32,
    ) -> Self {
        Self {
            admission,
            initial_sequence,
            state: Mutex::new(RegistryState::default()),
        }
    }

    pub(crate) fn reserve(&self, owner: VscodeProcessTaskOwner) -> Result<(), String> {
        validate_owner(&owner)?;
        let mut state = self.state();
        if state.entries.contains_key(&owner.run_id) {
            return Err("The process task runId is already registered.".to_string());
        }
        if let Some(cancelled) = state.cancellations.get(&owner.run_id) {
            if cancelled == &owner {
                return Err("The process task was cancelled before it started.".to_string());
            }
            remove_cancellation(&mut state, &owner.run_id);
        }
        let admission = self
            .admission
            .reserve(&owner.workspace_id, owner.session_id)?;
        state.entries.insert(
            owner.run_id.clone(),
            TaskEntry {
                admission: Some(admission),
                decoders: TaggedOutputDecoders::default(),
                event_gate: EventGate::Pending,
                events_open: true,
                next_sequence: self.initial_sequence,
                output_bytes: 0,
                output_events: 0,
                output_truncated: false,
                last_step_index: 0,
                step_total: None,
                owner,
                pending_events: VecDeque::new(),
                phase: TaskPhase::Starting {
                    stop_requested: false,
                },
            },
        );
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn activate(
        &self,
        owner: &VscodeProcessTaskOwner,
        ownership: TerminalTaskOwnership,
    ) -> Result<bool, String> {
        self.activate_ownership(owner, ownership, None)
    }

    pub(crate) fn activate_step(
        &self,
        owner: &VscodeProcessTaskOwner,
        ownership: TerminalTaskOwnership,
        step: VscodeProcessTaskStep<'_>,
    ) -> Result<bool, String> {
        validate_step(step.label, step.index, step.total)?;
        if step.index != 1 {
            return Err("The first process task step index must be one.".to_string());
        }
        self.activate_ownership(owner, ownership, Some((step.label, step.index, step.total)))
    }

    fn activate_ownership(
        &self,
        owner: &VscodeProcessTaskOwner,
        ownership: TerminalTaskOwnership,
        step: Option<(&str, u16, u16)>,
    ) -> Result<bool, String> {
        let mut state = self.state();
        let mut exhausted = false;
        let result = {
            let entry = exact_entry_mut(&mut state, owner)?;
            if ownership.session_id() != owner.session_id {
                return Err("Terminal task ownership does not match the owner session.".to_string());
            }
            let stop_requested = match &entry.phase {
                TaskPhase::Starting { stop_requested } => *stop_requested,
                _ => return Err("The process task is not awaiting activation.".to_string()),
            };
            entry.phase = TaskPhase::Active {
                ownership,
                stop_requested,
            };
            if let Some(sequence) = take_sequence(entry) {
                entry
                    .pending_events
                    .push_front(VscodeProcessTaskEvent::Status {
                        owner: entry.owner.clone(),
                        sequence,
                        state: VscodeProcessTaskStatus::Running,
                    });
            } else {
                fail_closed(entry);
                exhausted = true;
            };
            if !exhausted {
                if let Some((label, index, total)) = step {
                    exhausted = queue_step(entry, label, index, total).is_err();
                }
            }
            stop_requested
        };
        if exhausted {
            retain_terminal(&mut state, &owner.run_id);
            return Err("The process task event sequence is exhausted.".to_string());
        }
        Ok(result)
    }

    /// Atomically hands an active chain run from one child process to the next. The stop flag is
    /// deliberately retained across the gap, so a stop that races between children permanently
    /// prevents the replacement from continuing.
    #[cfg(test)]
    pub(crate) fn replace_ownership(
        &self,
        owner: &VscodeProcessTaskOwner,
        previous: &TerminalTaskOwnership,
        replacement: TerminalTaskOwnership,
    ) -> Result<bool, String> {
        self.replace_ownership_inner(owner, previous, replacement, None)
            .map(|activation| matches!(activation, VscodeProcessTaskStepActivation::StopRequested))
    }

    pub(crate) fn replace_ownership_step(
        &self,
        owner: &VscodeProcessTaskOwner,
        previous: &TerminalTaskOwnership,
        replacement: TerminalTaskOwnership,
        step: VscodeProcessTaskStep<'_>,
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<VscodeProcessTaskStepActivation, String> {
        validate_step(step.label, step.index, step.total)?;
        let activation = self.replace_ownership_inner(
            owner,
            previous,
            replacement,
            Some((step.label, step.index, step.total)),
        )?;
        if activation == VscodeProcessTaskStepActivation::Activated {
            let should_drain = {
                let mut state = self.state();
                let entry = exact_entry_mut(&mut state, owner)?;
                open_gate_for_queued_event(entry)
            };
            if should_drain {
                self.drain_events(owner, sink);
            }
        }
        Ok(activation)
    }

    fn replace_ownership_inner(
        &self,
        owner: &VscodeProcessTaskOwner,
        previous: &TerminalTaskOwnership,
        replacement: TerminalTaskOwnership,
        step: Option<(&str, u16, u16)>,
    ) -> Result<VscodeProcessTaskStepActivation, String> {
        let mut state = self.state();
        let entry = exact_entry_mut(&mut state, owner)?;
        if replacement.session_id() != owner.session_id {
            return Err("Terminal task ownership does not match the owner session.".to_string());
        }
        if let Some((_, index, total)) = step {
            validate_next_step(entry, index, total)?;
        }
        let TaskPhase::Active {
            ownership,
            stop_requested,
        } = &mut entry.phase
        else {
            return Err("The process task is not active.".to_string());
        };
        if ownership.session_id() != previous.session_id()
            || ownership.task_id() != previous.task_id()
        {
            return Err("The process task ownership changed before replacement.".to_string());
        }
        if *stop_requested {
            return Ok(VscodeProcessTaskStepActivation::StopRequested);
        }
        *ownership = replacement;
        if let Some((label, index, total)) = step {
            queue_step(entry, label, index, total)?;
        }
        Ok(VscodeProcessTaskStepActivation::Activated)
    }

    pub(crate) fn may_continue(
        &self,
        owner: &VscodeProcessTaskOwner,
        current: &TerminalTaskOwnership,
    ) -> Result<bool, String> {
        let mut state = self.state();
        let entry = exact_entry_mut(&mut state, owner)?;
        let TaskPhase::Active {
            ownership,
            stop_requested,
        } = &entry.phase
        else {
            return Err("The process task is not active.".to_string());
        };
        if ownership.session_id() != current.session_id()
            || ownership.task_id() != current.task_id()
        {
            return Err("The process task ownership changed before continuation.".to_string());
        }
        Ok(!*stop_requested)
    }

    pub(crate) fn acknowledge_start(
        &self,
        owner: &VscodeProcessTaskOwner,
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<(), String> {
        {
            let mut state = self.state();
            let entry = exact_entry_mut(&mut state, owner)?;
            if matches!(entry.phase, TaskPhase::Starting { .. }) {
                return Err("The process task is not active yet.".to_string());
            }
            match entry.event_gate {
                EventGate::Open => return Ok(()),
                EventGate::Pending => entry.event_gate = EventGate::Flushing,
                EventGate::Flushing => {
                    return Err("The process task acknowledgement is already flushing.".to_string())
                }
            }
        }
        self.drain_events(owner, sink);
        Ok(())
    }

    pub(crate) fn record_output(
        &self,
        owner: &VscodeProcessTaskOwner,
        stream: VscodeProcessTaskOutputStream,
        bytes: &[u8],
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<(), String> {
        for bytes in bytes.chunks(OUTPUT_CHUNK_BYTES_LIMIT) {
            let decoded = {
                let mut state = self.state();
                let entry = exact_active_entry_mut(&mut state, owner)?;
                entry.decoders.push(stream, bytes)
            };
            self.record_output_text(owner, stream, &decoded, sink)?;
        }
        Ok(())
    }

    pub(crate) fn finish_output(
        &self,
        owner: &VscodeProcessTaskOwner,
        stream: VscodeProcessTaskOutputStream,
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<(), String> {
        let decoded = {
            let mut state = self.state();
            let entry = exact_active_entry_mut(&mut state, owner)?;
            entry.decoders.finish(stream)
        };
        self.record_output_text(owner, stream, &decoded, sink)
    }

    pub(crate) fn complete(
        &self,
        owner: &VscodeProcessTaskOwner,
        completion: VscodeProcessTaskCompletion,
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<(), String> {
        let (should_drain, exhausted) = {
            let mut state = self.state();
            let (should_drain, exhausted) = {
                let entry = exact_entry_mut(&mut state, owner)?;
                if matches!(entry.phase, TaskPhase::Terminal) {
                    return Ok(());
                }
                let stop_requested = match &entry.phase {
                    TaskPhase::Starting { stop_requested } => *stop_requested,
                    TaskPhase::Active { stop_requested, .. } => *stop_requested,
                    TaskPhase::Terminal => false,
                };
                let mut exhausted = false;
                for stream in [
                    VscodeProcessTaskOutputStream::Stdout,
                    VscodeProcessTaskOutputStream::Stderr,
                ] {
                    let tail = entry.decoders.finish(stream);
                    exhausted |= queue_output_text(entry, stream, &tail);
                }
                if exhausted {
                    (false, true)
                } else if let Some(sequence) = take_sequence(entry) {
                    let terminal_status = if stop_requested {
                        VscodeProcessTaskStatus::Stopped
                    } else {
                        completion_status(completion)
                    };
                    entry
                        .pending_events
                        .push_back(VscodeProcessTaskEvent::Status {
                            owner: entry.owner.clone(),
                            sequence,
                            state: terminal_status,
                        });
                    entry.phase = TaskPhase::Terminal;
                    entry.events_open = false;
                    entry.admission.take();
                    (open_gate_for_queued_event(entry), false)
                } else {
                    fail_closed(entry);
                    (false, true)
                }
            };
            retain_terminal(&mut state, &owner.run_id);
            (should_drain, exhausted)
        };
        if exhausted {
            return Err("The process task event sequence is exhausted.".to_string());
        }
        if should_drain {
            self.drain_events(owner, sink);
        }
        Ok(())
    }

    pub(crate) fn request_stop(
        &self,
        owner: &VscodeProcessTaskOwner,
    ) -> Result<VscodeProcessTaskStopAction, String> {
        validate_owner(owner)?;
        let mut state = self.state();
        let Some(entry) = state.entries.get_mut(&owner.run_id) else {
            record_cancellation(&mut state, owner.clone());
            return Ok(VscodeProcessTaskStopAction::PrestartRecorded);
        };
        if &entry.owner != owner {
            return Err("The process task owner does not match the registered run.".to_string());
        }
        match &mut entry.phase {
            TaskPhase::Starting { stop_requested } => {
                if *stop_requested {
                    Ok(VscodeProcessTaskStopAction::AlreadyRequested)
                } else {
                    *stop_requested = true;
                    Ok(VscodeProcessTaskStopAction::StopStarting)
                }
            }
            TaskPhase::Active {
                ownership,
                stop_requested,
            } => {
                if *stop_requested {
                    Ok(VscodeProcessTaskStopAction::AlreadyRequested)
                } else {
                    *stop_requested = true;
                    Ok(VscodeProcessTaskStopAction::Terminate(ownership.clone()))
                }
            }
            TaskPhase::Terminal => Ok(VscodeProcessTaskStopAction::Terminal),
        }
    }

    pub(crate) fn request_stop_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Vec<TerminalTaskOwnership> {
        self.request_stop_matching(|owner| &owner.workspace_id == workspace_id)
    }

    pub(crate) fn request_stop_all(&self) -> Vec<TerminalTaskOwnership> {
        self.request_stop_matching(|_| true)
    }

    fn record_output_text(
        &self,
        owner: &VscodeProcessTaskOwner,
        stream: VscodeProcessTaskOutputStream,
        text: &str,
        sink: &dyn VscodeProcessTaskEventSink,
    ) -> Result<(), String> {
        let (should_drain, exhausted) = {
            let mut state = self.state();
            let (should_drain, exhausted) = {
                let entry = exact_active_entry_mut(&mut state, owner)?;
                let exhausted = queue_output_text(entry, stream, text);
                (open_gate_for_queued_event(entry), exhausted)
            };
            if exhausted {
                retain_terminal(&mut state, &owner.run_id);
            }
            (should_drain, exhausted)
        };
        if exhausted {
            return Err("The process task event sequence is exhausted.".to_string());
        }
        if should_drain {
            self.drain_events(owner, sink);
        }
        Ok(())
    }

    fn request_stop_matching(
        &self,
        matches_owner: impl Fn(&VscodeProcessTaskOwner) -> bool,
    ) -> Vec<TerminalTaskOwnership> {
        let mut state = self.state();
        let mut ownerships = Vec::new();
        for entry in state
            .entries
            .values_mut()
            .filter(|entry| matches_owner(&entry.owner))
        {
            match &mut entry.phase {
                TaskPhase::Starting { stop_requested } => *stop_requested = true,
                TaskPhase::Active {
                    ownership,
                    stop_requested,
                } => {
                    if !*stop_requested {
                        *stop_requested = true;
                        ownerships.push(ownership.clone());
                    }
                }
                TaskPhase::Terminal => {}
            }
        }
        ownerships
    }

    fn drain_events(&self, owner: &VscodeProcessTaskOwner, sink: &dyn VscodeProcessTaskEventSink) {
        loop {
            let event = {
                let mut state = self.state();
                let Ok(entry) = exact_entry_mut(&mut state, owner) else {
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
            sink.emit(event);
        }
    }

    fn state(&self) -> MutexGuard<'_, RegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn exact_entry_mut<'a>(
    state: &'a mut RegistryState,
    owner: &VscodeProcessTaskOwner,
) -> Result<&'a mut TaskEntry, String> {
    let entry = state
        .entries
        .get_mut(&owner.run_id)
        .ok_or_else(|| "The process task is not registered.".to_string())?;
    if &entry.owner != owner {
        return Err("The process task owner does not match the registered run.".to_string());
    }
    Ok(entry)
}

fn exact_active_entry_mut<'a>(
    state: &'a mut RegistryState,
    owner: &VscodeProcessTaskOwner,
) -> Result<&'a mut TaskEntry, String> {
    let entry = exact_entry_mut(state, owner)?;
    if !matches!(entry.phase, TaskPhase::Active { .. }) || !entry.events_open {
        return Err("The process task is not accepting output.".to_string());
    }
    Ok(entry)
}

fn validate_step(label: &str, index: u16, total: u16) -> Result<(), String> {
    if label.trim().is_empty()
        || label.len() > MAX_STEP_LABEL_BYTES
        || label.chars().any(char::is_control)
    {
        return Err("The process task step label is invalid.".to_string());
    }
    if total == 0 || total > MAX_CHAIN_STEPS || index == 0 || index > total {
        return Err("The process task step position is invalid.".to_string());
    }
    Ok(())
}

fn queue_step(entry: &mut TaskEntry, label: &str, index: u16, total: u16) -> Result<(), String> {
    validate_next_step(entry, index, total)?;
    let Some(sequence) = take_sequence(entry) else {
        fail_closed(entry);
        return Err("The process task event sequence is exhausted.".to_string());
    };
    entry.last_step_index = index;
    entry.step_total = Some(total);
    entry
        .pending_events
        .push_back(VscodeProcessTaskEvent::Step {
            owner: entry.owner.clone(),
            sequence,
            label: label.to_string(),
            index,
            total,
        });
    Ok(())
}

fn validate_next_step(entry: &TaskEntry, index: u16, total: u16) -> Result<(), String> {
    if index != entry.last_step_index.saturating_add(1) {
        return Err("The process task step index is out of order.".to_string());
    }
    if entry.step_total.is_some_and(|expected| expected != total) {
        return Err("The process task step total changed.".to_string());
    }
    Ok(())
}

fn queue_output_text(
    entry: &mut TaskEntry,
    stream: VscodeProcessTaskOutputStream,
    text: &str,
) -> bool {
    let mut start = 0;
    while start < text.len() && entry.events_open && !entry.output_truncated {
        let mut end = (start + OUTPUT_CHUNK_BYTES_LIMIT).min(text.len());
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        let data = &text[start..end];
        let exceeds_cap = entry.output_events >= OUTPUT_EVENT_LIMIT
            || entry.output_bytes.saturating_add(data.len()) > OUTPUT_BYTES_LIMIT;
        let Some(sequence) = take_sequence(entry) else {
            fail_closed(entry);
            return true;
        };
        if exceeds_cap {
            entry.output_truncated = true;
            entry
                .pending_events
                .push_back(VscodeProcessTaskEvent::Output {
                    owner: entry.owner.clone(),
                    sequence,
                    stream,
                    data: String::new(),
                    truncated: true,
                });
            return false;
        }
        entry.output_bytes = entry.output_bytes.saturating_add(data.len());
        entry.output_events += 1;
        entry
            .pending_events
            .push_back(VscodeProcessTaskEvent::Output {
                owner: entry.owner.clone(),
                sequence,
                stream,
                data: data.to_string(),
                truncated: false,
            });
        start = end;
    }
    false
}

fn open_gate_for_queued_event(entry: &mut TaskEntry) -> bool {
    if entry.event_gate == EventGate::Open && !entry.pending_events.is_empty() {
        entry.event_gate = EventGate::Flushing;
        true
    } else {
        false
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

fn fail_closed(entry: &mut TaskEntry) {
    entry.phase = TaskPhase::Terminal;
    entry.events_open = false;
    entry.pending_events.clear();
    entry.admission.take();
}

fn retain_terminal(state: &mut RegistryState, run_id: &str) {
    state.terminal_order.retain(|candidate| candidate != run_id);
    state.terminal_order.push_back(run_id.to_string());
    while state.terminal_order.len() > TERMINAL_TOMBSTONE_LIMIT {
        if let Some(expired) = state.terminal_order.pop_front() {
            state.entries.remove(&expired);
        }
    }
}

fn completion_status(completion: VscodeProcessTaskCompletion) -> VscodeProcessTaskStatus {
    match completion {
        VscodeProcessTaskCompletion::Exited { exit_code } => {
            VscodeProcessTaskStatus::Exited { exit_code }
        }
        VscodeProcessTaskCompletion::Failed { message } => VscodeProcessTaskStatus::Failed {
            message: bounded_message(&message),
        },
        VscodeProcessTaskCompletion::Stopped => VscodeProcessTaskStatus::Stopped,
    }
}

fn record_cancellation(state: &mut RegistryState, owner: VscodeProcessTaskOwner) {
    remove_cancellation(state, &owner.run_id);
    state.cancellation_order.push_back(owner.run_id.clone());
    state
        .cancellations
        .insert(owner.run_id.clone(), owner.clone());
    while cancellation_count_for_workspace(state, &owner) > PRESTART_TOMBSTONE_WORKSPACE_LIMIT {
        let Some(position) = state.cancellation_order.iter().position(|run_id| {
            state
                .cancellations
                .get(run_id)
                .is_some_and(|candidate| candidate.workspace_id == owner.workspace_id)
        }) else {
            break;
        };
        if let Some(expired) = state.cancellation_order.remove(position) {
            state.cancellations.remove(&expired);
        }
    }
    while state.cancellations.len() > PRESTART_TOMBSTONE_GLOBAL_LIMIT {
        if let Some(expired) = state.cancellation_order.pop_front() {
            state.cancellations.remove(&expired);
        }
    }
}

fn remove_cancellation(state: &mut RegistryState, run_id: &str) {
    state.cancellations.remove(run_id);
    state
        .cancellation_order
        .retain(|candidate| candidate != run_id);
}

fn cancellation_count_for_workspace(
    state: &RegistryState,
    owner: &VscodeProcessTaskOwner,
) -> usize {
    state
        .cancellations
        .values()
        .filter(|candidate| candidate.workspace_id == owner.workspace_id)
        .count()
}

fn validate_owner(owner: &VscodeProcessTaskOwner) -> Result<(), String> {
    for (name, value) in [
        ("runId", owner.run_id.as_str()),
        ("workspaceId", owner.workspace_id.as_str()),
        ("label", owner.label.as_str()),
        ("configRevision", owner.config_revision.as_str()),
    ] {
        if !bounded_text(value, MAX_OWNER_TEXT_BYTES) {
            return Err(format!("{name} must be a bounded safe string."));
        }
    }
    if !owner.config_revision.starts_with("sha256:")
        || owner.config_revision.len() != "sha256:".len() + 64
        || !owner.config_revision["sha256:".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("configRevision must be an exact SHA-256 revision.".to_string());
    }
    Ok(())
}

fn bounded_text(value: &str, maximum_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum_bytes && !value.chars().any(char::is_control)
}

fn bounded_message(value: &str) -> String {
    let clean = value
        .chars()
        .map(|character| {
            if character.is_control() {
                '\u{fffd}'
            } else {
                character
            }
        })
        .collect::<String>();
    if clean.len() <= MAX_FAILED_MESSAGE_BYTES {
        return clean;
    }
    let mut end = MAX_FAILED_MESSAGE_BYTES - '…'.len_utf8();
    while !clean.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &clean[..end])
}

#[derive(Default)]
struct TaggedOutputDecoders {
    stderr: IncrementalUtf8Decoder,
    stdout: IncrementalUtf8Decoder,
}

impl TaggedOutputDecoders {
    fn decoder(&mut self, stream: VscodeProcessTaskOutputStream) -> &mut IncrementalUtf8Decoder {
        match stream {
            VscodeProcessTaskOutputStream::Stdout => &mut self.stdout,
            VscodeProcessTaskOutputStream::Stderr => &mut self.stderr,
        }
    }

    fn push(&mut self, stream: VscodeProcessTaskOutputStream, bytes: &[u8]) -> String {
        self.decoder(stream).push(bytes)
    }

    fn finish(&mut self, stream: VscodeProcessTaskOutputStream) -> String {
        self.decoder(stream).finish()
    }
}

#[derive(Default)]
struct IncrementalUtf8Decoder {
    pending: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        let mut input = std::mem::take(&mut self.pending);
        input.extend_from_slice(bytes);
        let mut output = String::new();
        let mut remaining = input.as_slice();
        while !remaining.is_empty() {
            match std::str::from_utf8(remaining) {
                Ok(valid) => {
                    output.push_str(valid);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        output.push_str(
                            std::str::from_utf8(&remaining[..valid_up_to])
                                .expect("Utf8Error valid prefix"),
                        );
                    }
                    remaining = &remaining[valid_up_to..];
                    let Some(error_len) = error.error_len() else {
                        self.pending.extend_from_slice(remaining);
                        break;
                    };
                    output.push('\u{fffd}');
                    remaining = &remaining[error_len..];
                }
            }
        }
        output
    }

    fn finish(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned()
    }
}
