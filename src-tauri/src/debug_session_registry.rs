#![allow(dead_code)] // Protocol-agnostic registry API is incrementally wired by debugger commands.

use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventPayload, DebugEventSink,
    DebugFunctionBreakpointVerification, DebugOutputStream,
};
use crate::debug_breakpoint_policy::{
    commit_live_breakpoints, prepare_live_breakpoints, DebugBreakpointAdapterKind,
};
#[path = "debug_workspace_authority.rs"]
mod workspace_authority;
use std::collections::{HashMap, VecDeque};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
pub(crate) use workspace_authority::{
    retain_workspace_root, retained_workspace_authority, DebugWorkspaceAuthority,
    RetainedDebugWorkspaceRoot,
};

type BreakpointInventory = Arc<Mutex<HashMap<String, Vec<DebugBreakpoint>>>>;

const MAX_BUFFERED_EVENTS: usize = 256;
const MAX_BUFFERED_EVENT_BYTES: usize = 256 * 1024;
const RESERVED_DELIVERY_EVENTS: usize = 4;
const RESERVED_DELIVERY_BYTES: usize = 40 * 1024;
const MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES: usize = 32 * 1024;
const OVERFLOW_DIAGNOSTIC: &str =
    "Debugger events were truncated because the bounded delivery queue reached its limit.";
/// Must match TypeScript `MAX_DEBUG_OUTPUT_EVENT_BYTES`.
pub(crate) const MAX_DEBUG_OUTPUT_EVENT_BYTES: usize = 64 * 1024;
pub(crate) const OUTPUT_TRUNCATION_SUFFIX: &str =
    "\n[Debugger output truncated: one event exceeded 65536 UTF-8 bytes.]";
const INVALID_OUTPUT_DIAGNOSTIC: &str =
    "Debugger output was omitted because one event contained unsupported NUL bytes.";

#[derive(Clone)]
pub struct DebugEventEmitter {
    root_path: String,
    seq: Arc<AtomicU64>,
    session_id: u64,
    sink: Arc<dyn DebugEventSink>,
    delivery: Arc<Mutex<DebugEventDelivery>>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum DebugEventDeliveryPhase {
    Pending,
    Live,
    Discarded,
}

struct QueuedDebugEvent {
    bytes: usize,
    payload: DebugEventPayload,
}

struct DebugEventDelivery {
    phase: DebugEventDeliveryPhase,
    queued: VecDeque<QueuedDebugEvent>,
    queued_bytes: usize,
    draining: bool,
    overflowed: bool,
    diagnostic_queued: bool,
    startup_function_breakpoint_receipt: Option<QueuedDebugEvent>,
    terminal: bool,
}

impl DebugEventEmitter {
    #[cfg(test)]
    pub(crate) fn pending_for_test(
        root_path: &str,
        session_id: u64,
        sink: Arc<dyn DebugEventSink>,
    ) -> Self {
        Self {
            root_path: root_path.to_string(),
            seq: Arc::new(AtomicU64::new(0)),
            session_id,
            sink,
            delivery: Arc::new(Mutex::new(DebugEventDelivery {
                phase: DebugEventDeliveryPhase::Pending,
                queued: VecDeque::new(),
                queued_bytes: 0,
                draining: false,
                overflowed: false,
                diagnostic_queued: false,
                startup_function_breakpoint_receipt: None,
                terminal: false,
            })),
        }
    }

    #[cfg(test)]
    pub(crate) fn activate_for_test(&self) {
        let mut delivery = lock_recover(&self.delivery);
        assert!(self.commit_activation(&mut delivery));
        drop(delivery);
        self.drain_committed();
    }

    pub fn session_id(&self) -> u64 {
        self.session_id
    }

    pub fn emit(&self, payload: DebugEventPayload) {
        {
            let delivery = lock_recover(&self.delivery);
            if delivery.phase == DebugEventDeliveryPhase::Discarded || delivery.terminal {
                return;
            }
        }
        let payload = bounded_debug_event_payload(payload);
        let should_drain = {
            let mut delivery = lock_recover(&self.delivery);
            if delivery.phase == DebugEventDeliveryPhase::Discarded || delivery.terminal {
                false
            } else if matches!(&payload, DebugEventPayload::Terminated { .. }) {
                delivery.terminal = true;
                delivery.push_reserved(payload, false);
                delivery.begin_drain_if_live()
            } else {
                let bytes = payload_bytes(&payload);
                if delivery.can_push_normal(bytes) {
                    delivery.push(payload, bytes, false);
                } else {
                    delivery.overflowed = true;
                    if delivery.phase == DebugEventDeliveryPhase::Live {
                        delivery.push_diagnostic(false);
                    }
                }
                delivery.begin_drain_if_live()
            }
        };
        if should_drain {
            self.drain();
        }
    }

    pub(crate) fn retain_startup_function_breakpoint_verification(
        &self,
        generation: u64,
        breakpoints: Vec<DebugFunctionBreakpointVerification>,
    ) -> Result<(), String> {
        if generation != 1 {
            return Err(
                "Startup function breakpoint verification generation is invalid.".to_string(),
            );
        }
        let payload = DebugEventPayload::FunctionBreakpointsVerified {
            generation,
            breakpoints,
        };
        let bytes = payload_bytes(&payload);
        if bytes > MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES {
            return Err("Startup function breakpoint verification is too large.".to_string());
        }
        let mut delivery = lock_recover(&self.delivery);
        if delivery.phase != DebugEventDeliveryPhase::Pending
            || delivery.terminal
            || delivery.startup_function_breakpoint_receipt.is_some()
        {
            return Err(
                "Startup function breakpoint verification can no longer be retained.".to_string(),
            );
        }
        delivery.startup_function_breakpoint_receipt = Some(QueuedDebugEvent { bytes, payload });
        Ok(())
    }

    fn commit_activation(&self, delivery: &mut DebugEventDelivery) -> bool {
        if delivery.phase != DebugEventDeliveryPhase::Pending {
            return false;
        }
        if delivery.overflowed {
            delivery.push_diagnostic(true);
        }
        if let Some(receipt) = delivery.startup_function_breakpoint_receipt.take() {
            if !delivery.push_reserved(receipt.payload, true) {
                return false;
            }
        }
        if !delivery.push_reserved(
            DebugEventPayload::Started {
                session_id: self.session_id,
            },
            true,
        ) {
            return false;
        }
        delivery.phase = DebugEventDeliveryPhase::Live;
        delivery.draining = true;
        true
    }

    fn drain_committed(&self) {
        self.drain();
    }

    fn discard(&self) {
        let mut delivery = lock_recover(&self.delivery);
        delivery.phase = DebugEventDeliveryPhase::Discarded;
        delivery.queued.clear();
        delivery.queued_bytes = 0;
        delivery.startup_function_breakpoint_receipt = None;
        delivery.draining = false;
        delivery.terminal = true;
    }

    fn drain(&self) {
        loop {
            let queued = {
                let mut delivery = lock_recover(&self.delivery);
                if delivery.phase != DebugEventDeliveryPhase::Live {
                    delivery.draining = false;
                    return;
                }
                let Some(queued) = delivery.queued.pop_front() else {
                    delivery.draining = false;
                    return;
                };
                delivery.queued_bytes = delivery.queued_bytes.saturating_sub(queued.bytes);
                queued
            };
            let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
            let result = catch_unwind(AssertUnwindSafe(|| {
                self.sink.emit(DebugEvent {
                    root_path: self.root_path.clone(),
                    session_id: self.session_id,
                    seq,
                    payload: queued.payload,
                });
            }));
            if result.is_err() {
                self.discard();
                return;
            }
        }
    }
}

pub(crate) fn bounded_debug_event_payload(payload: DebugEventPayload) -> DebugEventPayload {
    match payload {
        DebugEventPayload::Output {
            stream,
            text,
            truncated,
        } => {
            if text.contains('\0') {
                return DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: INVALID_OUTPUT_DIAGNOSTIC.to_string(),
                    truncated: true,
                };
            }
            let truncated = truncated || text.len() > MAX_DEBUG_OUTPUT_EVENT_BYTES;
            let already_marked = truncated && text.ends_with(OUTPUT_TRUNCATION_SUFFIX);
            if (!truncated || already_marked)
                && text.len() <= MAX_DEBUG_OUTPUT_EVENT_BYTES
                && text.capacity() <= MAX_DEBUG_OUTPUT_EVENT_BYTES
            {
                return DebugEventPayload::Output {
                    stream,
                    text,
                    truncated,
                };
            }
            let mut bounded = String::with_capacity(MAX_DEBUG_OUTPUT_EVENT_BYTES);
            if truncated {
                let source = if already_marked {
                    &text[..text.len() - OUTPUT_TRUNCATION_SUFFIX.len()]
                } else {
                    &text
                };
                let maximum_prefix =
                    MAX_DEBUG_OUTPUT_EVENT_BYTES.saturating_sub(OUTPUT_TRUNCATION_SUFFIX.len());
                let mut boundary = maximum_prefix.min(source.len());
                while !source.is_char_boundary(boundary) {
                    boundary = boundary.saturating_sub(1);
                }
                bounded.push_str(&source[..boundary]);
                bounded.push_str(OUTPUT_TRUNCATION_SUFFIX);
            } else {
                bounded.push_str(&text);
            }
            DebugEventPayload::Output {
                stream,
                text: bounded,
                truncated,
            }
        }
        payload => payload,
    }
}

impl DebugEventDelivery {
    fn begin_drain_if_live(&mut self) -> bool {
        if self.phase != DebugEventDeliveryPhase::Live || self.draining || self.queued.is_empty() {
            return false;
        }
        self.draining = true;
        true
    }

    fn can_push_normal(&self, bytes: usize) -> bool {
        self.queued.len() < MAX_BUFFERED_EVENTS - RESERVED_DELIVERY_EVENTS
            && self.queued_bytes.saturating_add(bytes)
                <= MAX_BUFFERED_EVENT_BYTES - RESERVED_DELIVERY_BYTES
    }

    fn push(&mut self, payload: DebugEventPayload, bytes: usize, front: bool) {
        self.queued_bytes = self.queued_bytes.saturating_add(bytes);
        let event = QueuedDebugEvent { bytes, payload };
        if front {
            self.queued.push_front(event);
        } else {
            self.queued.push_back(event);
        }
    }

    fn push_reserved(&mut self, payload: DebugEventPayload, front: bool) -> bool {
        let bytes = payload_bytes(&payload);
        if self.queued.len() >= MAX_BUFFERED_EVENTS
            || self.queued_bytes.saturating_add(bytes) > MAX_BUFFERED_EVENT_BYTES
        {
            self.overflowed = true;
            return false;
        }
        self.push(payload, bytes, front);
        true
    }

    fn push_diagnostic(&mut self, front: bool) {
        if self.diagnostic_queued {
            return;
        }
        self.diagnostic_queued = self.push_reserved(
            DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: OVERFLOW_DIAGNOSTIC.to_string(),
                truncated: true,
            },
            front,
        );
    }
}

fn payload_bytes(payload: &DebugEventPayload) -> usize {
    serde_json::to_vec(payload).map_or(MAX_BUFFERED_EVENT_BYTES, |value| value.len())
}

struct RunningDebugSession {
    adapter: Arc<Mutex<Box<dyn DebugAdapter>>>,
    breakpoints_by_file: BreakpointInventory,
    breakpoint_operation: Arc<Mutex<()>>,
    breakpoint_kind: DebugBreakpointAdapterKind,
    mode: DebugSessionMode,
    workspace_authority: DebugWorkspaceAuthority,
    emitter: DebugEventEmitter,
    inspection_operation: Arc<Mutex<()>>,
    root_key: String,
    session_id: u64,
    generation: u64,
    group_owned: bool,
    active: Arc<AtomicBool>,
}

impl Clone for RunningDebugSession {
    fn clone(&self) -> Self {
        Self {
            adapter: Arc::clone(&self.adapter),
            breakpoints_by_file: Arc::clone(&self.breakpoints_by_file),
            breakpoint_operation: Arc::clone(&self.breakpoint_operation),
            breakpoint_kind: self.breakpoint_kind,
            mode: self.mode,
            workspace_authority: self.workspace_authority.clone(),
            emitter: self.emitter.clone(),
            inspection_operation: Arc::clone(&self.inspection_operation),
            root_key: self.root_key.clone(),
            session_id: self.session_id,
            generation: self.generation,
            group_owned: self.group_owned,
            active: Arc::clone(&self.active),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DebugSessionMode {
    OwnedLaunch,
    ExternalNodeAttach,
}

pub(crate) struct DebugRootDeactivation {
    removed: Vec<RunningDebugSession>,
}

impl Drop for DebugRootDeactivation {
    fn drop(&mut self) {
        let _ = wait_and_terminate(std::mem::take(&mut self.removed));
    }
}

impl RunningDebugSession {
    fn deactivate(&self) {
        self.active.store(false, Ordering::SeqCst);
    }

    fn terminate(self) {
        lock_recover(&self.adapter).terminate();
        self.emitter
            .emit(DebugEventPayload::Terminated { exit_code: None });
    }

    fn disconnect(self) {
        lock_recover(&self.adapter).disconnect();
        self.emitter
            .emit(DebugEventPayload::Terminated { exit_code: None });
    }
}

const MAX_IN_FLIGHT_DEBUG_STARTUPS: usize = 16;
const MAX_RETIRED_DEBUG_SESSIONS: usize = 64;

#[derive(Debug)]
pub struct DebugStartupPermit {
    generation: u64,
    root_key: String,
    workspace_authority: DebugWorkspaceAuthority,
    start_generation: u64,
    startup_operation: Arc<Mutex<()>>,
    startup_slot: Option<DebugStartupSlot>,
    ownership: DebugStartupOwnership,
}

impl Clone for DebugStartupPermit {
    fn clone(&self) -> Self {
        Self {
            generation: self.generation,
            root_key: self.root_key.clone(),
            workspace_authority: self.workspace_authority.clone(),
            start_generation: self.start_generation,
            startup_operation: Arc::clone(&self.startup_operation),
            // Observer clones (for startup cancellation checks) must not retain
            // a physical-start slot after the consuming permit finishes.
            startup_slot: None,
            ownership: self.ownership,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DebugStartupOwnership {
    ReplaceRoot,
    PreserveGroup,
}

/// Private capability used by a future compound launcher to admit several
/// sessions under one root without exposing a new IPC contract prematurely.
#[derive(Clone, Debug)]
pub(crate) struct DebugStartupGroup {
    generation: u64,
    root_key: String,
    workspace_authority: DebugWorkspaceAuthority,
    start_generation: u64,
    startup_operation: Arc<Mutex<()>>,
}

#[derive(Debug)]
struct DebugStartupSlot {
    in_flight: Arc<AtomicUsize>,
}

impl Drop for DebugStartupSlot {
    fn drop(&mut self) {
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Clone, Default)]
struct DebugRootLifecycle {
    active: bool,
    generation: u64,
    start_generation: u64,
    startup_operation: Arc<Mutex<()>>,
}

#[derive(Default)]
struct DebugRegistryState {
    lifecycles: HashMap<String, DebugRootLifecycle>,
    sessions_by_id: HashMap<u64, RunningDebugSession>,
    session_ids_by_root: HashMap<String, Vec<u64>>,
    retired_by_id: HashMap<u64, RetiredDebugSession>,
    retired_order: VecDeque<u64>,
}

#[derive(Clone)]
struct RetiredDebugSession {
    group_owned: bool,
    mode: DebugSessionMode,
    workspace_authority: DebugWorkspaceAuthority,
}

pub struct DebugSessionRegistry {
    in_flight_startups: Arc<AtomicUsize>,
    next_session_id: AtomicU64,
    state: Mutex<DebugRegistryState>,
    #[cfg(test)]
    after_start_commit: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl DebugSessionRegistry {
    pub fn new() -> Self {
        Self {
            in_flight_startups: Arc::new(AtomicUsize::new(0)),
            next_session_id: AtomicU64::new(1),
            state: Mutex::new(DebugRegistryState::default()),
            #[cfg(test)]
            after_start_commit: Mutex::new(None),
        }
    }

    pub fn activate_root(&self, root_key: &str) {
        let mut state = lock_recover(&self.state);
        let lifecycle = state.lifecycles.entry(root_key.to_string()).or_default();
        if lifecycle.active {
            return;
        }
        if let Some(generation) = lifecycle.generation.checked_add(1) {
            lifecycle.generation = generation;
            lifecycle.active = true;
        } else {
            lifecycle.active = false;
        }
    }

    pub fn begin_start(&self, root_key: &str) -> Result<DebugStartupPermit, String> {
        self.begin_start_with_authority(
            root_key,
            DebugWorkspaceAuthority::CanonicalRoot(root_key.to_string()),
        )
    }

    pub(crate) fn begin_start_with_authority(
        &self,
        root_key: &str,
        workspace_authority: DebugWorkspaceAuthority,
    ) -> Result<DebugStartupPermit, String> {
        let startup_slot = self.reserve_startup_slot()?;
        let (permit, removed) = {
            let mut state = lock_recover(&self.state);
            let lifecycle = state
                .lifecycles
                .entry(root_key.to_string())
                .or_insert_with(|| DebugRootLifecycle {
                    active: true,
                    generation: 0,
                    start_generation: 0,
                    startup_operation: Arc::new(Mutex::new(())),
                });
            if !lifecycle.active {
                return Err("The workspace debugger lifecycle is closed.".to_string());
            }
            lifecycle.start_generation =
                lifecycle.start_generation.checked_add(1).ok_or_else(|| {
                    "The workspace debugger start generation is exhausted.".to_string()
                })?;
            let permit = DebugStartupPermit {
                generation: lifecycle.generation,
                root_key: root_key.to_string(),
                workspace_authority,
                start_generation: lifecycle.start_generation,
                startup_operation: Arc::clone(&lifecycle.startup_operation),
                startup_slot: Some(startup_slot),
                ownership: DebugStartupOwnership::ReplaceRoot,
            };
            let removed = remove_sessions_for_root(&mut state, root_key);
            (permit, removed)
        };
        wait_and_terminate(removed);
        Ok(permit)
    }

    #[cfg(test)]
    pub(crate) fn begin_start_group(&self, root_key: &str) -> Result<DebugStartupGroup, String> {
        self.begin_start_group_with_authority(
            root_key,
            DebugWorkspaceAuthority::CanonicalRoot(root_key.to_string()),
        )
    }

    pub(crate) fn begin_start_group_with_authority(
        &self,
        root_key: &str,
        workspace_authority: DebugWorkspaceAuthority,
    ) -> Result<DebugStartupGroup, String> {
        let (group, removed) = {
            let mut state = lock_recover(&self.state);
            let lifecycle = state
                .lifecycles
                .entry(root_key.to_string())
                .or_insert_with(|| DebugRootLifecycle {
                    active: true,
                    generation: 0,
                    start_generation: 0,
                    startup_operation: Arc::new(Mutex::new(())),
                });
            if !lifecycle.active {
                return Err("The workspace debugger lifecycle is closed.".to_string());
            }
            lifecycle.start_generation =
                lifecycle.start_generation.checked_add(1).ok_or_else(|| {
                    "The workspace debugger start generation is exhausted.".to_string()
                })?;
            let group = DebugStartupGroup {
                generation: lifecycle.generation,
                root_key: root_key.to_string(),
                workspace_authority,
                start_generation: lifecycle.start_generation,
                startup_operation: Arc::clone(&lifecycle.startup_operation),
            };
            let removed = remove_sessions_for_root(&mut state, root_key);
            (group, removed)
        };
        wait_and_terminate(removed);
        Ok(group)
    }

    pub(crate) fn begin_start_in_group(
        &self,
        group: &DebugStartupGroup,
    ) -> Result<DebugStartupPermit, String> {
        let startup_slot = self.reserve_startup_slot()?;
        let current = lock_recover(&self.state)
            .lifecycles
            .get(&group.root_key)
            .is_some_and(|lifecycle| {
                lifecycle.active
                    && lifecycle.generation == group.generation
                    && lifecycle.start_generation == group.start_generation
            });
        if !current {
            return Err("The workspace debugger lifecycle changed during startup.".to_string());
        }
        Ok(DebugStartupPermit {
            generation: group.generation,
            root_key: group.root_key.clone(),
            workspace_authority: group.workspace_authority.clone(),
            start_generation: group.start_generation,
            startup_operation: Arc::clone(&group.startup_operation),
            startup_slot: Some(startup_slot),
            ownership: DebugStartupOwnership::PreserveGroup,
        })
    }

    pub(crate) fn startup_is_current(&self, permit: &DebugStartupPermit) -> bool {
        lock_recover(&self.state)
            .lifecycles
            .get(&permit.root_key)
            .cloned()
            .is_some_and(|lifecycle| {
                lifecycle.active
                    && lifecycle.generation == permit.generation
                    && lifecycle.start_generation == permit.start_generation
            })
    }

    pub(crate) fn startup_group_is_current(&self, group: &DebugStartupGroup) -> bool {
        lock_recover(&self.state)
            .lifecycles
            .get(&group.root_key)
            .is_some_and(|lifecycle| {
                lifecycle.active
                    && lifecycle.generation == group.generation
                    && lifecycle.start_generation == group.start_generation
            })
    }

    pub(crate) fn owns_session_in_group(&self, group: &DebugStartupGroup, session_id: u64) -> bool {
        let state = lock_recover(&self.state);
        state
            .lifecycles
            .get(&group.root_key)
            .is_some_and(|lifecycle| {
                lifecycle.active
                    && lifecycle.generation == group.generation
                    && lifecycle.start_generation == group.start_generation
            })
            && state
                .sessions_by_id
                .get(&session_id)
                .is_some_and(|session| {
                    session.group_owned
                        && session.root_key == group.root_key
                        && session.generation == group.generation
                        && session.workspace_authority == group.workspace_authority
                })
    }

    /// Invalidates only this exact batch owner and rolls back every member it
    /// admitted. A newer root owner is never touched.
    pub(crate) fn abort_start_group(&self, group: &DebugStartupGroup) -> bool {
        let removed = {
            let mut state = lock_recover(&self.state);
            let Some(lifecycle) = state.lifecycles.get_mut(&group.root_key) else {
                return false;
            };
            if !lifecycle.active
                || lifecycle.generation != group.generation
                || lifecycle.start_generation != group.start_generation
            {
                return false;
            }
            if let Some(next) = lifecycle.start_generation.checked_add(1) {
                lifecycle.start_generation = next;
            } else {
                lifecycle.active = false;
            }
            remove_sessions_for_root(&mut state, &group.root_key)
        };
        wait_and_terminate(removed)
    }

    /// Implements `stopAll`: a natural exit from one exact grouped member
    /// atomically invalidates the batch and terminates all remaining siblings.
    pub(crate) fn finish_group_session(
        &self,
        group: &DebugStartupGroup,
        session_id: u64,
        exit_code: Option<i32>,
    ) -> bool {
        let removed = {
            let mut state = lock_recover(&self.state);
            let current = state
                .lifecycles
                .get(&group.root_key)
                .is_some_and(|lifecycle| {
                    lifecycle.active
                        && lifecycle.generation == group.generation
                        && lifecycle.start_generation == group.start_generation
                });
            let exact_member = state
                .sessions_by_id
                .get(&session_id)
                .is_some_and(|session| {
                    session.group_owned
                        && session.root_key == group.root_key
                        && session.generation == group.generation
                        && session.workspace_authority == group.workspace_authority
                });
            if !current || !exact_member {
                return false;
            }
            if let Some(lifecycle) = state.lifecycles.get_mut(&group.root_key) {
                if let Some(next) = lifecycle.start_generation.checked_add(1) {
                    lifecycle.start_generation = next;
                } else {
                    lifecycle.active = false;
                }
            }
            remove_sessions_for_root(&mut state, &group.root_key)
        };
        for session in &removed {
            wait_for_session_operations(session);
        }
        for session in removed {
            if session.session_id == session_id {
                session
                    .emitter
                    .emit(DebugEventPayload::Terminated { exit_code });
            } else {
                session.terminate();
            }
        }
        true
    }

    fn reserve_startup_slot(&self) -> Result<DebugStartupSlot, String> {
        self.in_flight_startups
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                (current < MAX_IN_FLIGHT_DEBUG_STARTUPS).then_some(current + 1)
            })
            .map_err(|_| {
                format!(
                    "Too many debugger sessions are starting; the global limit is {MAX_IN_FLIGHT_DEBUG_STARTUPS}."
                )
            })?;
        Ok(DebugStartupSlot {
            in_flight: Arc::clone(&self.in_flight_startups),
        })
    }

    pub fn deactivate_root(&self, root_key: &str) -> bool {
        Self::complete_root_deactivation(self.begin_root_deactivation(root_key))
    }

    /// Invalidates the root generation and removes its sessions without
    /// invoking adapter teardown. Callers holding an external lifecycle lock
    /// must complete the returned owner only after releasing that lock.
    pub(crate) fn begin_root_deactivation(&self, root_key: &str) -> DebugRootDeactivation {
        let removed = {
            let mut state = lock_recover(&self.state);
            let lifecycle = state.lifecycles.entry(root_key.to_string()).or_default();
            if let Some(generation) = lifecycle.generation.checked_add(1) {
                lifecycle.generation = generation;
            }
            lifecycle.active = false;
            remove_sessions_for_root(&mut state, root_key)
        };
        DebugRootDeactivation { removed }
    }

    pub(crate) fn complete_root_deactivation(mut deactivation: DebugRootDeactivation) -> bool {
        wait_and_terminate(std::mem::take(&mut deactivation.removed))
    }

    #[cfg(test)]
    pub fn start_session<F>(
        &self,
        root_key: &str,
        sink: Arc<dyn DebugEventSink>,
        session_factory: F,
    ) -> Result<u64, String>
    where
        F: FnOnce(DebugEventEmitter) -> Result<Box<dyn DebugAdapter>, String>,
    {
        let permit = self.begin_start(root_key)?;
        self.start_session_with_permit(permit, sink, session_factory)
    }

    #[cfg(test)]
    pub fn start_session_with_permit<F>(
        &self,
        permit: DebugStartupPermit,
        sink: Arc<dyn DebugEventSink>,
        session_factory: F,
    ) -> Result<u64, String>
    where
        F: FnOnce(DebugEventEmitter) -> Result<Box<dyn DebugAdapter>, String>,
    {
        self.start_session_with_permit_and_breakpoints(
            permit,
            sink,
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            session_factory,
        )
    }

    #[cfg(test)]
    pub(crate) fn start_session_with_permit_and_breakpoints<F>(
        &self,
        permit: DebugStartupPermit,
        sink: Arc<dyn DebugEventSink>,
        breakpoint_kind: DebugBreakpointAdapterKind,
        breakpoints_by_file: HashMap<String, Vec<DebugBreakpoint>>,
        session_factory: F,
    ) -> Result<u64, String>
    where
        F: FnOnce(DebugEventEmitter) -> Result<Box<dyn DebugAdapter>, String>,
    {
        self.start_session_with_permit_breakpoints_and_mode(
            permit,
            sink,
            breakpoint_kind,
            breakpoints_by_file,
            DebugSessionMode::OwnedLaunch,
            session_factory,
        )
    }

    pub(crate) fn start_session_with_permit_breakpoints_and_mode<F>(
        &self,
        permit: DebugStartupPermit,
        sink: Arc<dyn DebugEventSink>,
        breakpoint_kind: DebugBreakpointAdapterKind,
        breakpoints_by_file: HashMap<String, Vec<DebugBreakpoint>>,
        mode: DebugSessionMode,
        session_factory: F,
    ) -> Result<u64, String>
    where
        F: FnOnce(DebugEventEmitter) -> Result<Box<dyn DebugAdapter>, String>,
    {
        let startup_operation = Arc::clone(&permit.startup_operation);
        let _startup_guard = startup_operation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !self.startup_is_current(&permit) {
            return Err("The workspace debugger lifecycle changed during startup.".to_string());
        }
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        let emitter = DebugEventEmitter {
            root_path: permit.root_key.clone(),
            seq: Arc::new(AtomicU64::new(0)),
            session_id,
            sink,
            delivery: Arc::new(Mutex::new(DebugEventDelivery {
                phase: DebugEventDeliveryPhase::Pending,
                queued: VecDeque::new(),
                queued_bytes: 0,
                draining: false,
                overflowed: false,
                diagnostic_queued: false,
                startup_function_breakpoint_receipt: None,
                terminal: false,
            })),
        };
        let adapter = match session_factory(emitter.clone()) {
            Ok(adapter) => Arc::new(Mutex::new(adapter)),
            Err(error) => {
                emitter.discard();
                return Err(error);
            }
        };
        if !self.startup_is_current(&permit) {
            emitter.discard();
            lock_recover(&adapter).terminate();
            return Err("The workspace debugger lifecycle changed during startup.".to_string());
        }
        let session = RunningDebugSession {
            adapter: Arc::clone(&adapter),
            breakpoints_by_file: Arc::new(Mutex::new(breakpoints_by_file)),
            breakpoint_operation: Arc::new(Mutex::new(())),
            breakpoint_kind,
            mode,
            workspace_authority: permit.workspace_authority.clone(),
            emitter: emitter.clone(),
            inspection_operation: Arc::new(Mutex::new(())),
            root_key: permit.root_key.clone(),
            session_id,
            generation: permit.generation,
            group_owned: permit.ownership == DebugStartupOwnership::PreserveGroup,
            active: Arc::new(AtomicBool::new(true)),
        };
        let (registered, replaced) = {
            let mut state = lock_recover(&self.state);
            let lifecycle = state.lifecycles.get(&permit.root_key);
            if !lifecycle.is_some_and(|lifecycle| {
                lifecycle.active
                    && lifecycle.generation == permit.generation
                    && lifecycle.start_generation == permit.start_generation
            }) || state.sessions_by_id.contains_key(&session_id)
            {
                (false, Vec::new())
            } else {
                let replaced = match permit.ownership {
                    DebugStartupOwnership::ReplaceRoot => {
                        remove_sessions_for_root(&mut state, &permit.root_key)
                    }
                    DebugStartupOwnership::PreserveGroup => Vec::new(),
                };
                let mut delivery = lock_recover(&emitter.delivery);
                if !emitter.commit_activation(&mut delivery) {
                    (false, replaced)
                } else {
                    state.retired_by_id.remove(&session_id);
                    state.sessions_by_id.insert(session_id, session.clone());
                    state
                        .session_ids_by_root
                        .entry(permit.root_key.clone())
                        .or_default()
                        .push(session_id);
                    drop(delivery);
                    (true, replaced)
                }
            }
        };
        wait_and_terminate(replaced);
        if !registered {
            emitter.discard();
            lock_recover(&adapter).terminate();
            return Err("The workspace debugger lifecycle changed during startup.".to_string());
        }
        drop(_startup_guard);
        #[cfg(test)]
        if let Some(hook) = lock_recover(&self.after_start_commit).clone() {
            hook();
        }
        emitter.drain_committed();
        Ok(session_id)
    }

    pub fn session_id_for_root(&self, root_key: &str) -> Option<u64> {
        let state = self.state.lock().ok()?;
        latest_session_for_root(&state, root_key).map(|session| session.session_id)
    }

    pub(crate) fn owns_session(&self, root_key: &str, session_id: u64) -> bool {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.sessions_by_id.get(&session_id).cloned())
            .is_some_and(|session| session.root_key == root_key)
    }

    pub fn with_session<R>(
        &self,
        root_key: &str,
        f: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let adapter = {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            Arc::clone(
                &latest_session_for_root(&state, root_key)
                    .ok_or_else(|| format!("No debug session for workspace {root_key}."))?
                    .adapter,
            )
        };
        run_with_adapter(&adapter, f)
    }

    pub fn with_session_by_id<R>(
        &self,
        session_id: u64,
        f: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        self.inspect_for_session_by_id(session_id, f)
    }

    pub(crate) fn evaluate_for_session<R>(
        &self,
        session_id: u64,
        root_key: &str,
        evaluate: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        self.inspect_for_session(session_id, root_key, evaluate)
    }

    pub(crate) fn inspect_for_session<R>(
        &self,
        session_id: u64,
        root_key: &str,
        inspect: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let session = self.session_permit(session_id, root_key)?;
        self.inspect_with_permit(session, inspect)
    }

    /// Serializes a debugger control mutation with inspection and teardown.
    /// Teardown invalidates registry ownership first, then waits for this
    /// per-session operation lease before touching the adapter.
    pub(crate) fn control_for_session<R>(
        &self,
        session_id: u64,
        root_key: &str,
        control: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let session = self.session_permit(session_id, root_key)?;
        let _operation = session
            .inspection_operation
            .lock()
            .map_err(|error| error.to_string())?;
        if !self.is_current(&session)? {
            return Err(stale_session_error());
        }
        let result = {
            let mut adapter = session.adapter.lock().map_err(|error| error.to_string())?;
            ensure_active(&session)?;
            control(adapter.as_mut())
        };
        if !self.is_current(&session)? {
            return Err(stale_session_error());
        }
        Ok(result)
    }

    pub(crate) fn mutate_for_session_authorized<R>(
        &self,
        session_id: u64,
        workspace_authority: &DebugWorkspaceAuthority,
        mutation: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let session = {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            let session = state
                .sessions_by_id
                .get(&session_id)
                .cloned()
                .ok_or_else(stale_session_error)?;
            if &session.workspace_authority != workspace_authority {
                return Err(stale_session_error());
            }
            session
        };
        self.inspect_with_permit(session, mutation)
    }

    pub(crate) fn inspect_for_session_by_id<R>(
        &self,
        session_id: u64,
        inspect: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let session = {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            state
                .sessions_by_id
                .get(&session_id)
                .cloned()
                .ok_or_else(|| format!("No debug session with id {session_id}."))?
        };
        self.inspect_with_permit(session, inspect)
    }

    fn inspect_with_permit<R>(
        &self,
        session: RunningDebugSession,
        inspect: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let _operation = session
            .inspection_operation
            .lock()
            .map_err(|error| error.to_string())?;
        if !self.is_current(&session)? {
            return Err(stale_session_error());
        }
        let result = {
            let mut adapter = session.adapter.lock().map_err(|error| error.to_string())?;
            ensure_active(&session)?;
            inspect(adapter.as_mut())
        };
        if !self.is_current(&session)? {
            return Err(stale_session_error());
        }
        Ok(result)
    }

    pub(crate) fn set_breakpoints_for_session(
        &self,
        session_id: u64,
        root_key: &str,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        let session = self.session_permit(session_id, root_key)?;
        let _operation = session
            .breakpoint_operation
            .lock()
            .map_err(|error| error.to_string())?;
        ensure_active(&session)?;
        let (canonical_file_path, normalized) = {
            let stored = session
                .breakpoints_by_file
                .lock()
                .map_err(|error| error.to_string())?;
            prepare_live_breakpoints(
                Path::new(&session.root_key),
                session.breakpoint_kind,
                &stored,
                file_path,
                breakpoints,
            )?
        };
        let applied = {
            let mut adapter = session.adapter.lock().map_err(|error| error.to_string())?;
            adapter.set_breakpoints(&canonical_file_path, &normalized)?
        };
        if !self.is_current(&session)? {
            return Err(stale_session_error());
        }
        let mut stored = session
            .breakpoints_by_file
            .lock()
            .map_err(|error| error.to_string())?;
        ensure_active(&session)?;
        commit_live_breakpoints(&mut stored, canonical_file_path, normalized);
        Ok(applied)
    }

    pub fn finish_session(&self, session_id: u64, exit_code: Option<i32>) -> bool {
        let Some(session) = self.remove_by_id(session_id) else {
            return false;
        };
        session
            .emitter
            .emit(DebugEventPayload::Terminated { exit_code });
        true
    }

    pub fn stop(&self, root_key: &str) -> bool {
        terminate_removed(self.remove_root_sessions(root_key))
    }

    pub fn stop_by_id(&self, session_id: u64) -> bool {
        let removed = {
            let mut state = lock_recover(&self.state);
            let Some(session) = state.sessions_by_id.get(&session_id) else {
                return false;
            };
            if session.group_owned {
                let root_key = session.root_key.clone();
                if let Some(lifecycle) = state.lifecycles.get_mut(&root_key) {
                    if let Some(next) = lifecycle.start_generation.checked_add(1) {
                        lifecycle.start_generation = next;
                    } else {
                        lifecycle.active = false;
                    }
                }
                remove_sessions_for_root(&mut state, &root_key)
            } else {
                remove_session_by_id(&mut state, session_id)
                    .into_iter()
                    .collect()
            }
        };
        wait_and_terminate(removed)
    }

    #[cfg(test)]
    pub(crate) fn disconnect_external_node_attach(
        &self,
        root_key: &str,
        session_id: u64,
    ) -> Result<(), String> {
        self.disconnect_external_node_attach_authorized(
            &DebugWorkspaceAuthority::CanonicalRoot(root_key.to_string()),
            session_id,
        )
    }

    pub(crate) fn disconnect_external_node_attach_authorized(
        &self,
        workspace_authority: &DebugWorkspaceAuthority,
        session_id: u64,
    ) -> Result<(), String> {
        let removed = {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let Some(current) = state.sessions_by_id.get(&session_id) else {
                if let Some(retired) = state.retired_by_id.get(&session_id) {
                    if &retired.workspace_authority != workspace_authority
                        || retired.mode != DebugSessionMode::ExternalNodeAttach
                    {
                        return Err(stale_session_error());
                    }
                    if retired.group_owned
                        || !state
                            .sessions_by_id
                            .values()
                            .any(|session| &session.workspace_authority == workspace_authority)
                    {
                        return Ok(());
                    }
                    return Err(stale_session_error());
                }
                // The inspector transport can report its close before the IPC
                // response arrives. Idempotence is safe only when this exact
                // workspace authority has no replacement session either.
                if state
                    .sessions_by_id
                    .values()
                    .any(|session| &session.workspace_authority == workspace_authority)
                {
                    return Err(stale_session_error());
                }
                return Ok(());
            };
            if &current.workspace_authority != workspace_authority {
                return Err(stale_session_error());
            }
            if current.mode != DebugSessionMode::ExternalNodeAttach {
                return Err(
                    "Disconnect is only available for attached Node.js debug sessions.".to_string(),
                );
            }
            remove_session_by_id(&mut state, session_id).ok_or_else(stale_session_error)?
        };
        let operation = Arc::clone(&removed.inspection_operation);
        let _operation = lock_recover(&operation);
        removed.disconnect();
        Ok(())
    }

    pub fn stop_all(&self) {
        let sessions = {
            let mut state = lock_recover(&self.state);
            for lifecycle in state.lifecycles.values_mut() {
                if let Some(generation) = lifecycle.generation.checked_add(1) {
                    lifecycle.generation = generation;
                }
                lifecycle.active = false;
            }
            remove_all_sessions(&mut state)
        };
        wait_and_terminate(sessions);
    }

    fn session_permit(
        &self,
        session_id: u64,
        root_key: &str,
    ) -> Result<RunningDebugSession, String> {
        let state = self.state.lock().map_err(|error| error.to_string())?;
        state
            .sessions_by_id
            .get(&session_id)
            .filter(|session| session.root_key == root_key)
            .cloned()
            .ok_or_else(stale_session_error)
    }

    fn is_current(&self, session: &RunningDebugSession) -> Result<bool, String> {
        let state = self.state.lock().map_err(|error| error.to_string())?;
        Ok(state
            .sessions_by_id
            .get(&session.session_id)
            .is_some_and(|current| {
                current.root_key == session.root_key
                    && current.generation == session.generation
                    && current.active.load(Ordering::SeqCst)
            }))
    }

    fn remove_by_id(&self, session_id: u64) -> Option<RunningDebugSession> {
        let removed = remove_session_by_id(&mut lock_recover(&self.state), session_id)?;
        wait_for_session_operations(&removed);
        Some(removed)
    }

    fn remove_root_sessions(&self, root_key: &str) -> Vec<RunningDebugSession> {
        let removed = remove_sessions_for_root(&mut lock_recover(&self.state), root_key);
        // Invalidate under the registry lock first, then wait without that global
        // lock. An in-flight evaluation can finish its adapter I/O, but its final
        // generation check rejects the late result. Queued evaluations see inactive.
        for session in &removed {
            wait_for_session_operations(session);
        }
        removed
    }

    #[cfg(test)]
    pub(crate) fn breakpoint_inventory(&self, root_key: &str) -> Option<BreakpointInventory> {
        let state = self.state.lock().ok()?;
        latest_session_for_root(&state, root_key)
            .map(|session| Arc::clone(&session.breakpoints_by_file))
    }

    #[cfg(test)]
    fn set_after_start_commit_hook(&self, hook: Option<Arc<dyn Fn() + Send + Sync>>) {
        *lock_recover(&self.after_start_commit) = hook;
    }
}

impl Default for DebugSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for DebugSessionRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn latest_session_for_root<'a>(
    state: &'a DebugRegistryState,
    root_key: &str,
) -> Option<&'a RunningDebugSession> {
    let session_id = *state.session_ids_by_root.get(root_key)?.last()?;
    state.sessions_by_id.get(&session_id)
}

fn remove_session_by_id(
    state: &mut DebugRegistryState,
    session_id: u64,
) -> Option<RunningDebugSession> {
    let removed = state.sessions_by_id.remove(&session_id);
    if let Some(session) = &removed {
        session.deactivate();
        let remove_root_index =
            if let Some(session_ids) = state.session_ids_by_root.get_mut(&session.root_key) {
                session_ids.retain(|current| *current != session_id);
                session_ids.is_empty()
            } else {
                false
            };
        if remove_root_index {
            state.session_ids_by_root.remove(&session.root_key);
        }
        record_retired_session(state, session);
    }
    removed
}

fn remove_sessions_for_root(
    state: &mut DebugRegistryState,
    root_key: &str,
) -> Vec<RunningDebugSession> {
    let session_ids = state
        .session_ids_by_root
        .remove(root_key)
        .unwrap_or_default();
    session_ids
        .into_iter()
        .filter_map(|session_id| {
            let session = state.sessions_by_id.remove(&session_id)?;
            session.deactivate();
            record_retired_session(state, &session);
            Some(session)
        })
        .collect()
}

fn remove_all_sessions(state: &mut DebugRegistryState) -> Vec<RunningDebugSession> {
    state.session_ids_by_root.clear();
    let sessions: Vec<_> = state
        .sessions_by_id
        .drain()
        .map(|(_, session)| {
            session.deactivate();
            session
        })
        .collect();
    for session in &sessions {
        record_retired_session(state, session);
    }
    sessions
}

fn record_retired_session(state: &mut DebugRegistryState, session: &RunningDebugSession) {
    if !state.retired_by_id.contains_key(&session.session_id) {
        state.retired_order.push_back(session.session_id);
    }
    state.retired_by_id.insert(
        session.session_id,
        RetiredDebugSession {
            group_owned: session.group_owned,
            mode: session.mode,
            workspace_authority: session.workspace_authority.clone(),
        },
    );
    while state.retired_order.len() > MAX_RETIRED_DEBUG_SESSIONS {
        if let Some(expired) = state.retired_order.pop_front() {
            state.retired_by_id.remove(&expired);
        }
    }
}

fn wait_for_session_operations(session: &RunningDebugSession) {
    let operation = Arc::clone(&session.inspection_operation);
    let _operation = lock_recover(&operation);
}

fn wait_and_terminate(sessions: Vec<RunningDebugSession>) -> bool {
    for session in &sessions {
        wait_for_session_operations(session);
    }
    terminate_removed(sessions)
}

fn terminate_removed(sessions: impl IntoIterator<Item = RunningDebugSession>) -> bool {
    let mut removed = false;
    for session in sessions {
        removed = true;
        session.terminate();
    }
    removed
}

fn ensure_active(session: &RunningDebugSession) -> Result<(), String> {
    session
        .active
        .load(Ordering::SeqCst)
        .then_some(())
        .ok_or_else(stale_session_error)
}

fn stale_session_error() -> String {
    "The debug session no longer belongs to this workspace.".to_string()
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn run_with_adapter<R>(
    adapter: &Arc<Mutex<Box<dyn DebugAdapter>>>,
    f: impl FnOnce(&mut dyn DebugAdapter) -> R,
) -> Result<R, String> {
    let mut adapter = adapter.lock().map_err(|error| error.to_string())?;
    Ok(f(adapter.as_mut()))
}

#[cfg(test)]
#[path = "debug_adapter_registry_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "debug_adapter_registry_startup_tests.rs"]
mod startup_tests;

#[cfg(test)]
#[path = "debug_session_registry_disconnect_tests.rs"]
mod disconnect_tests;

#[cfg(test)]
#[path = "debug_cdp_disconnect_integration_tests.rs"]
mod disconnect_integration_tests;
