//! CDP WebSocket transport, protocol state, and the Node adapter runtime.
//!
//! Launch and attach orchestration stays in debug_cdp; this module owns the
//! bounded loopback transport and CDP session behavior behind a narrow factory contract.

use super::event_sink::CdpEventEmitter;
#[cfg(target_os = "macos")]
use super::node_attach_orchestrator::{
    KernelBoundNodeAttachConnection, KernelHeldNodeAttachRequest,
    SnapshotRevalidatedKernelBoundNodeAttachConnection,
};
use super::variables::{
    load_variables_page, scope_mutation, set_expression_provenance::SetExpressionReference,
    ObjectReference, ObjectReferenceAccess, ObjectReferenceKey, MAX_CDP_OBJECT_ID_BYTES,
    MAX_CDP_OBJECT_REFERENCES_PER_PAUSE,
};
use super::*;
use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluateFailure, DebugEvaluatePolicy, DebugJustMyCodePolicy,
    DebugSetExpressionRequest, DebugSetExpressionResult, DebugSetVariableRequest,
    DebugSetVariableResult, DebugVariablePage, DebugVariablePageRequest,
};
use crate::debug_cdp_breakpoints::{handle_breakpoint_resolved, handle_script_parsed};
use crate::debug_exception_type_filter::{
    handle_paused, handle_response as handle_exception_classification_response, handle_resumed,
    handle_timeout as handle_exception_classification_timeout, DebugExceptionTypeFilter,
    ExceptionFilterState,
};

pub(crate) type TransportBreakpointPauseDecision = super::BreakpointPauseDecision;
use std::net::SocketAddr;
const NODE_INTERNALS_BLACKBOX_PATTERN: &str = r"^(?:node:|internal/)";
// CDP matches these expressions against the generated script URL. This deliberately
// covers direct paths and file URLs only; source-map-derived original ranges are not inferred.
const NODE_DEPENDENCIES_BLACKBOX_PATTERN: &str = r"(?:^|[/\\])node_modules[/\\]";

mod clipboard {
    include!("debug_cdp_clipboard.rs");
}

mod this_receiver {
    include!("debug_cdp_this_receiver.rs");
}

#[derive(Default)]
pub(crate) struct PauseInventory {
    pub(crate) pause_generation: u64,
    pub(crate) call_frame_ids: HashMap<u64, String>,
    pub(super) call_frame_this_object_ids: HashMap<u64, String>,
    pub(crate) frames: Vec<DebugStackFrame>,
    pub(super) object_ids: HashMap<u64, ObjectReference>,
    pub(super) object_reference_ids: HashMap<ObjectReferenceKey, u64>,
    pub(super) variable_page_loads: usize,
    pub(super) variable_mutations: usize,
    pub(super) set_expression_references: HashMap<u64, SetExpressionReference>,
    pub(super) set_expression_proof_requests: usize,
    pub(super) set_expression_proof_descriptors: usize,
    pub(super) completion_requests: usize,
    pub(super) completion_descriptors: usize,
    pub(super) scopes: HashMap<u64, Vec<DebugScopeInfo>>,
}

pub(super) struct BreakpointResolutionTarget {
    pub(super) breakpoint_id: String,
    pub(super) column_number: Option<u32>,
    pub(super) file_path: String,
    pub(super) generated_url: String,
    pub(super) source_path: String,
}

pub(crate) struct PendingInternalResume {
    pub(crate) deadline: Instant,
    pub(crate) inventory: PauseInventory,
    pub(crate) reason: DebugStopReason,
    pub(crate) request_id: u64,
}

pub(crate) enum PendingInternalAction {
    Resume(PendingInternalResume),
    Logpoint(PendingLogpoint),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PendingLogpointPhase {
    Evaluate,
    Resume,
}

pub(crate) struct PendingLogpoint {
    pub(crate) call_frame_id: String,
    pub(crate) current_output: String,
    pub(crate) deadline: Instant,
    pub(crate) inventory: PauseInventory,
    pub(crate) message_index: usize,
    pub(crate) phase: PendingLogpointPhase,
    pub(crate) reason: DebugStopReason,
    pub(crate) request_id: u64,
    pub(crate) segment_index: usize,
    pub(crate) templates: Vec<DebugLogTemplate>,
}

pub(crate) struct PendingExplicitPause {
    deadline: Instant,
    recovery: Option<InternalFallback>,
    request_id: u64,
    pub(crate) resume_confirmed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct GeneratedPosition {
    pub(crate) line: u32,
    pub(crate) column: u32,
}

pub(crate) struct CdpShared {
    pub(crate) breakpoint_hits: CdpBreakpointHitRegistry,
    pub(super) breakpoints_by_file: HashMap<String, Vec<DebugBreakpoint>>,
    cdp_ids_by_file: HashMap<String, Vec<String>>,
    pub(crate) first_pause_seen: bool,
    pub(crate) explicit_pause_requested: bool,
    pub(crate) internal_action: Option<PendingInternalAction>,
    next_id: u64,
    pause_generation_epoch: u64,
    pub(super) pause: Option<PauseInventory>,
    pub(crate) pending_explicit_pause: Option<PendingExplicitPause>,
    pub(super) pending_restart_frame: Option<super::restart_frame::PendingRestartFrame>,
    pub(super) pending_resolutions: HashMap<String, GeneratedPosition>,
    pub(super) resolution_index: HashMap<String, BreakpointResolutionTarget>,
    pub(crate) suppress_next_resumed: bool,
    pub(crate) source_maps: Option<SourceMapRegistry>,
    pub(crate) startup_validation: Option<StartupEntryValidation>,
}

pub(super) const MAX_PENDING_BREAKPOINT_RESOLUTIONS: usize = 2_000;

#[cfg(test)]
pub(crate) fn empty_shared_state_for_test() -> Arc<Mutex<CdpShared>> {
    Arc::new(Mutex::new(CdpShared::new(None)))
}

mod shared_state {
    use super::*;
    include!("debug_cdp_shared_state.rs");
}
#[cfg(test)]
pub(crate) use shared_state::exhausted_pause_generation_shared_state_for_test;
pub(crate) use shared_state::PauseGenerationFloor;

const MAX_QUEUED_CDP_MESSAGES: usize = 256;

pub(super) type PendingCdpRequests =
    Arc<Mutex<HashMap<u64, mpsc::SyncSender<Result<Value, String>>>>>;

#[derive(Clone)]
struct DisconnectNotifier {
    notified: Arc<AtomicBool>,
    sender: Option<mpsc::Sender<()>>,
}

impl DisconnectNotifier {
    fn new(sender: Option<mpsc::Sender<()>>) -> Self {
        Self {
            notified: Arc::new(AtomicBool::new(false)),
            sender,
        }
    }

    fn notify(&self) {
        if self.notified.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(sender) = &self.sender {
            let _ = sender.send(());
        }
    }
}

pub(super) struct BoundedCdpStream {
    inner: TcpStream,
    handshake_remaining: Option<usize>,
}

impl Read for BoundedCdpStream {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let maximum = self
            .handshake_remaining
            .unwrap_or(buffer.len())
            .min(buffer.len());
        if maximum == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "oversized inspector handshake",
            ));
        }
        let size = self.inner.read(&mut buffer[..maximum])?;
        if let Some(remaining) = self.handshake_remaining.as_mut() {
            *remaining = remaining.saturating_sub(size);
        }
        Ok(size)
    }
}

impl Write for BoundedCdpStream {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.inner.write(buffer)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

pub(crate) struct CdpClient {
    io_completed: mpsc::Receiver<()>,
    io_thread: Option<JoinHandle<()>>,
    next_request_id: Arc<AtomicU64>,
    outgoing: mpsc::SyncSender<String>,
    pending: PendingCdpRequests,
    pub(super) request_timeout: Duration,
    shutdown_requested: Arc<AtomicBool>,
    disconnect_notifier: DisconnectNotifier,
    function_breakpoint_worker: Option<JoinHandle<()>>,
}

mod request_handle {
    use super::*;
    include!("debug_cdp_request_handle.rs");
}
use request_handle::{CdpClientStartOptions, CdpRequestFailure, CdpRequestHandle};

impl CdpClient {
    fn start(
        socket: WebSocket<BoundedCdpStream>,
        shared: Arc<Mutex<CdpShared>>,
        exception_filter: Arc<Mutex<ExceptionFilterState>>,
        emitter: CdpEventEmitter,
        options: CdpClientStartOptions,
    ) -> Self {
        let CdpClientStartOptions {
            disconnected,
            function_breakpoints,
            mutation_is_allowed,
            request_timeout,
        } = options;
        let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
        let (outgoing_tx, outgoing_rx) = mpsc::sync_channel(MAX_QUEUED_CDP_MESSAGES);
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let disconnect_notifier = DisconnectNotifier::new(disconnected);
        let next_request_id = Arc::new(AtomicU64::new(1));
        let (completed_tx, completed_rx) = mpsc::sync_channel(1);
        let request_handle = CdpRequestHandle {
            disconnect_notifier: disconnect_notifier.clone(),
            next_request_id: Arc::clone(&next_request_id),
            outgoing: outgoing_tx.clone(),
            pending: Arc::clone(&pending),
            request_timeout,
            shutdown_requested: Arc::clone(&shutdown_requested),
        };
        let (function_breakpoint_trigger, function_breakpoint_triggers) = mpsc::sync_channel(1);
        let io_disconnect_notifier = disconnect_notifier.clone();
        let function_breakpoint_shared = Arc::clone(&shared);
        let context = SocketLoopContext {
            disconnect_notifier: disconnect_notifier.clone(),
            emitter,
            exception_filter,
            next_request_id: Arc::clone(&next_request_id),
            outgoing: outgoing_rx,
            pending: Arc::clone(&pending),
            request_timeout,
            shared,
            shutdown: Arc::clone(&shutdown_requested),
            mutation_is_allowed,
            function_breakpoint_trigger,
            function_breakpoints: Arc::clone(&function_breakpoints),
        };
        let function_breakpoint_emitter = context.emitter.clone();
        let emit_function_breakpoint_verification = Arc::new(move |payload| {
            function_breakpoint_emitter.emit(payload);
        });
        let function_breakpoint_authority = Arc::clone(&context.mutation_is_allowed);
        let function_breakpoint_fail_closed = {
            let pending = Arc::clone(&pending);
            let shutdown = Arc::clone(&shutdown_requested);
            let disconnect_notifier = disconnect_notifier.clone();
            Arc::new(move || {
                fail_closed_transport(&pending, &shutdown, &disconnect_notifier);
            })
        };
        let io_thread = thread::spawn(move || {
            run_socket_loop(socket, context);
            io_disconnect_notifier.notify();
            let _ = completed_tx.send(());
        });
        let function_breakpoint_worker = thread::spawn(move || {
            crate::debug_cdp_function_breakpoints::run_reresolution_worker(
                function_breakpoint_triggers,
                request_handle,
                function_breakpoints,
                function_breakpoint_shared,
                emit_function_breakpoint_verification,
                function_breakpoint_authority,
                function_breakpoint_fail_closed,
            );
        });
        Self {
            io_completed: completed_rx,
            io_thread: Some(io_thread),
            next_request_id,
            outgoing: outgoing_tx,
            pending,
            request_timeout,
            shutdown_requested,
            disconnect_notifier,
            function_breakpoint_worker: Some(function_breakpoint_worker),
        }
    }

    pub(crate) fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, self.request_timeout)
    }

    pub(super) fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        CdpRequestHandle {
            disconnect_notifier: self.disconnect_notifier.clone(),
            next_request_id: Arc::clone(&self.next_request_id),
            outgoing: self.outgoing.clone(),
            pending: Arc::clone(&self.pending),
            request_timeout: self.request_timeout,
            shutdown_requested: Arc::clone(&self.shutdown_requested),
        }
        .request_with_timeout(method, params, timeout)
    }

    fn request_classified(&self, method: &str, params: Value) -> Result<Value, CdpRequestFailure> {
        CdpRequestHandle {
            disconnect_notifier: self.disconnect_notifier.clone(),
            next_request_id: Arc::clone(&self.next_request_id),
            outgoing: self.outgoing.clone(),
            pending: Arc::clone(&self.pending),
            request_timeout: self.request_timeout,
            shutdown_requested: Arc::clone(&self.shutdown_requested),
        }
        .request_with_timeout_classified(method, params, self.request_timeout)
    }

    pub(super) fn shutdown(&mut self) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        if let Some(handle) = self.io_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.function_breakpoint_worker.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for CdpClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

include!("debug_cdp_watch_command_api.rs");

include!("debug_cdp_transport_event_loop.rs");

pub(crate) struct NodeCdpAdapter {
    client: CdpClient,
    exception_filter: Arc<Mutex<ExceptionFilterState>>,
    function_breakpoints:
        Arc<crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState>,
    ownership: DebuggeeOwnership,
    shared: Arc<Mutex<CdpShared>>,
    mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
}

pub(crate) enum DebuggeeOwnership {
    Spawned(DebugProcessHandle),
    External,
}

pub(crate) enum CdpStartupPolicy<'a> {
    SpawnedWaiting { startup_entry: Option<&'a Path> },
    Attached,
}

pub(crate) struct NodeCdpConnectOptions<'a> {
    pub(super) exception_pause_mode: DebugExceptionPauseMode,
    pub(super) request_timeout: Duration,
    pub(super) ownership: DebuggeeOwnership,
    pub(super) source_maps: Option<SourceMapRegistry>,
    pub(super) startup: CdpStartupPolicy<'a>,
    pub(super) disconnected: Option<mpsc::Sender<()>>,
    pub(super) startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    pub(super) internal_step_filter: Option<DebugJustMyCodePolicy>,
}

pub(in crate::debug_cdp) struct NodeCdpHeldExternalConnectOptions {
    pub(in crate::debug_cdp) request_timeout: Duration,
    pub(in crate::debug_cdp) source_maps: Option<SourceMapRegistry>,
    pub(in crate::debug_cdp) disconnected: Option<mpsc::Sender<()>>,
    pub(in crate::debug_cdp) startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
}

/// Immutable kernel-observed endpoints for the exact TCP connection retained
/// by a held external attach. The tuple never leaves the held state and is
/// captured from the same stream that produced the opaque kernel proof.
#[derive(Clone, Copy)]
struct HeldLoopbackConnection {
    client_local: SocketAddrV4,
    client_peer: SocketAddrV4,
}

/// Holds one kernel-bound external CDP WebSocket. `Runtime.evaluate(process.pid)`
/// remains only a secondary, debuggee-controlled correlation check after the
/// kernel proof and cannot construct this state by itself.
#[cfg(target_os = "macos")]
pub(in crate::debug_cdp) struct HeldExternalNodeCdpAttach {
    adapter: Option<NodeCdpAdapter>,
    connection: HeldLoopbackConnection,
    emitter: DebugEventEmitter,
    _kernel_proof: SnapshotRevalidatedKernelBoundNodeAttachConnection,
}

include!("debug_cdp_connect.rs");

impl NodeCdpAdapter {
    pub(crate) fn bind_exact_watch_entry_url(&mut self, url: String) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        self.function_breakpoints.bind_exact_watch_entry_url(url)
    }

    fn bind_exact_startup_entry_url(&mut self, url: String) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        self.function_breakpoints.bind_exact_startup_entry_url(url)
    }

    pub(crate) fn watch_pause_generation_epoch(&self) -> Result<u64, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|error| error.to_string())?
            .pause_generation_epoch)
    }

    pub(crate) fn watch_enable_runtime(&self) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        self.client.request("Runtime.enable", json!({}))?;
        Ok(())
    }

    pub(crate) fn watch_enable_debugger(&self) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        self.client.request("Debugger.enable", json!({}))?;
        Ok(())
    }

    pub(crate) fn watch_apply_internal_step_filter(
        &self,
        policy: Option<DebugJustMyCodePolicy>,
    ) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        let patterns: &[&str] = match policy {
            None => &[],
            Some(DebugJustMyCodePolicy::Dependencies) => &[NODE_DEPENDENCIES_BLACKBOX_PATTERN],
            Some(DebugJustMyCodePolicy::NodeInternals) => &[NODE_INTERNALS_BLACKBOX_PATTERN],
            Some(DebugJustMyCodePolicy::NodeInternalsAndDependencies) => &[
                NODE_INTERNALS_BLACKBOX_PATTERN,
                NODE_DEPENDENCIES_BLACKBOX_PATTERN,
            ],
        };
        self.client.request(
            "Debugger.setBlackboxPatterns",
            json!({ "patterns": patterns }),
        )?;
        Ok(())
    }

    pub(crate) fn watch_run_if_waiting_for_debugger(&self) -> Result<(), String> {
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        self.client
            .request("Runtime.runIfWaitingForDebugger", json!({}))?;
        Ok(())
    }

    fn set_function_breakpoints_with_receipt(
        &mut self,
        breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        generation: u64,
    ) -> Result<crate::debug_cdp_function_breakpoints::FunctionBreakpointVerificationReceipt, String>
    {
        self.set_function_breakpoints_with_publication(
            breakpoints,
            generation,
            |revision, generation, verification| {
                Ok(
                    crate::debug_cdp_function_breakpoints::FunctionBreakpointVerificationReceipt::new(
                        revision,
                        generation,
                        verification,
                    ),
                )
            },
        )
    }

    fn set_function_breakpoints_with_publication<T>(
        &mut self,
        breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        generation: u64,
        publish: impl FnOnce(
            u64,
            u64,
            Vec<crate::debug_adapter::DebugFunctionBreakpointVerification>,
        ) -> Result<T, String>,
    ) -> Result<T, String> {
        let authority = Arc::clone(&self.mutation_is_allowed);
        let function_breakpoints = Arc::clone(&self.function_breakpoints);
        let publication = match function_breakpoints.publication.lock() {
            Ok(publication) => publication,
            Err(error) => {
                let error = error.to_string();
                self.terminate();
                return Err(error);
            }
        };
        function_breakpoints.admit_new_generation(generation)?;
        let result = (|| {
            let previous_revision = function_breakpoints
                .revision
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |revision| {
                    revision.checked_add(1)
                })
                .map_err(|_| "Debug function breakpoint revision is exhausted.".to_string())?;
            let revision = previous_revision + 1;
            let mut registrations = function_breakpoints
                .registrations
                .lock()
                .map_err(|error| error.to_string())?;
            let verification = crate::debug_cdp_function_breakpoints::replace_function_breakpoints(
                &mut self.client,
                &mut registrations,
                breakpoints,
                || authority(),
            )?;
            drop(registrations);
            ensure_startup_current(authority.as_ref())?;
            if function_breakpoints.revision.load(Ordering::Acquire) != revision
                || function_breakpoints
                    .desired_generation
                    .load(Ordering::Acquire)
                    != generation
                || !authority()
            {
                return Err("Debug function breakpoint verification receipt is stale.".to_string());
            }
            publish(revision, generation, verification)
        })();
        drop(publication);
        if result.is_err() {
            self.terminate();
        }
        result
    }

    pub(crate) fn watch_set_function_breakpoints_with_publication(
        &mut self,
        breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        generation: u64,
        publish: impl FnOnce(
            u64,
            Vec<crate::debug_adapter::DebugFunctionBreakpointVerification>,
        ) -> Result<(), String>,
    ) -> Result<(), String> {
        self.set_function_breakpoints_with_publication(
            breakpoints,
            generation,
            |_revision, generation, verification| publish(generation, verification),
        )
    }
}

impl DebugAdapter for NodeCdpAdapter {
    fn set_breakpoints_active(&mut self, active: bool) -> Result<(), String> {
        crate::debug_cdp_breakpoints::set_breakpoints_active(
            &self.client,
            self.mutation_is_allowed.as_ref(),
            active,
        )
    }

    fn set_exception_pause(&mut self, mode: DebugExceptionPauseMode) -> Result<(), String> {
        self.set_exception_pause_filter(mode, &[])
    }

    fn set_exception_pause_filter(
        &mut self,
        mode: DebugExceptionPauseMode,
        exception_type_filter: &[String],
    ) -> Result<(), String> {
        let filter = DebugExceptionTypeFilter::parse(exception_type_filter.to_vec())?;
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        let update = match self
            .exception_filter
            .lock()
            .map_err(|error| error.to_string())
            .and_then(|mut state| state.prepare_policy_update())
        {
            Ok(update) => update,
            Err(error) => {
                self.terminate();
                return Err(error);
            }
        };
        let cdp_state = match mode {
            DebugExceptionPauseMode::None => "none",
            DebugExceptionPauseMode::Uncaught => "uncaught",
            DebugExceptionPauseMode::All => "all",
        };
        if let Err(error) = self.client.request_classified(
            "Debugger.setPauseOnExceptions",
            json!({ "state": cdp_state }),
        ) {
            let rejected = matches!(&error, CdpRequestFailure::Rejected(_));
            let message = error.into_message();
            let authority = ensure_startup_current(self.mutation_is_allowed.as_ref());
            if rejected && authority.is_ok() {
                let rollback = self
                    .exception_filter
                    .lock()
                    .map_err(|error| error.to_string())
                    .and_then(|mut state| state.abort_policy_update(update));
                if rollback.is_err() {
                    self.terminate();
                }
                return rollback.and(Err(message));
            }
            self.terminate();
            return authority.and(Err(message));
        }
        let result = (|| {
            ensure_startup_current(self.mutation_is_allowed.as_ref())?;
            let mut state = self
                .exception_filter
                .lock()
                .map_err(|error| error.to_string())?;
            ensure_startup_current(self.mutation_is_allowed.as_ref())?;
            let filter = if mode == DebugExceptionPauseMode::None {
                DebugExceptionTypeFilter::default()
            } else {
                filter
            };
            state.commit_policy_update(update, filter)
        })();
        if result.is_err() {
            self.terminate();
        }
        result
    }

    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        generation: u64,
    ) -> Result<Vec<crate::debug_adapter::DebugFunctionBreakpointVerification>, String> {
        self.set_function_breakpoints_with_receipt(breakpoints, generation)
            .map(crate::debug_cdp_function_breakpoints::FunctionBreakpointVerificationReceipt::into_breakpoints)
    }

    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        let previous_ids = {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            let ids = shared.cdp_ids_by_file.remove(file_path).unwrap_or_default();
            for id in &ids {
                shared.resolution_index.remove(id);
                shared.pending_resolutions.remove(id);
                shared.breakpoint_hits.remove(id);
            }
            ids
        };
        for breakpoint_id in previous_ids {
            ensure_startup_current(self.mutation_is_allowed.as_ref())?;
            let remove = || {
                self.client.request(
                    "Debugger.removeBreakpoint",
                    json!({"breakpointId": breakpoint_id}),
                )
            };
            if remove().or_else(|_| remove()).is_err() {
                self.terminate();
                return Err(
                    "Unable to remove a replaced breakpoint; the debug session was terminated."
                        .to_string(),
                );
            }
        }
        let canonical_file = fs::canonicalize(file_path).ok();
        let mut registered_ids = Vec::new();
        let mut applied = Vec::with_capacity(breakpoints.len());
        for breakpoint in breakpoints {
            let mut updated = breakpoint.clone();
            updated.verified = false;
            let Some(canonical_file) = canonical_file.as_ref() else {
                applied.push(updated);
                continue;
            };
            if !breakpoint.enabled {
                applied.push(updated);
                continue;
            }
            ensure_startup_current(self.mutation_is_allowed.as_ref())?;
            let mapped =
                self.shared.lock().ok().and_then(|shared| {
                    shared.source_maps.as_ref().and_then(|source_maps| {
                        match breakpoint.column_number {
                            Some(column_number) => source_maps.map_original_position(
                                canonical_file,
                                breakpoint.line_number,
                                column_number,
                            ),
                            None => source_maps
                                .map_original_line(canonical_file, breakpoint.line_number),
                        }
                    })
                });
            let url = mapped
                .as_ref()
                .map(|location| location.url.clone())
                .unwrap_or_else(|| file_url_from_path(&canonical_file.to_string_lossy()));
            let line_number = mapped
                .as_ref()
                .map(|location| location.line_number)
                .unwrap_or(breakpoint.line_number);
            let column_number = mapped
                .as_ref()
                .map(|location| location.column)
                .or(breakpoint.column_number);
            let mut params = json!({
                "url": url,
                "lineNumber": line_number.saturating_sub(1),
            });
            if let Some(column_number) = column_number {
                params["columnNumber"] = json!(column_number.saturating_sub(1));
            }
            if let Some(condition) = &breakpoint.condition {
                params["condition"] = json!(condition);
            }
            if let Ok(result) = self.client.request("Debugger.setBreakpointByUrl", params) {
                if let Some(breakpoint_id) = result.get("breakpointId").and_then(Value::as_str) {
                    registered_ids.push(breakpoint_id.to_string());
                    self.shared
                        .lock()
                        .map_err(|error| error.to_string())?
                        .breakpoint_hits
                        .register(breakpoint_id.to_string(), breakpoint);
                    let resolved_position = result
                        .pointer("/locations/0/lineNumber")
                        .and_then(Value::as_u64)
                        .map(|line| GeneratedPosition {
                            line: line as u32,
                            column: result
                                .pointer("/locations/0/columnNumber")
                                .and_then(Value::as_u64)
                                .unwrap_or(0) as u32,
                        });
                    let target = BreakpointResolutionTarget {
                        breakpoint_id: breakpoint.id.clone(),
                        column_number: breakpoint.column_number,
                        file_path: file_path.to_string(),
                        generated_url: url.clone(),
                        source_path: canonical_file.to_string_lossy().to_string(),
                    };
                    match resolved_position {
                        Some(position) => {
                            updated.verified = true;
                            let shared = self.shared.lock().map_err(|error| error.to_string())?;
                            let (line_number, column_number) =
                                original_breakpoint_position(&shared, &target, position);
                            updated.line_number = line_number;
                            if target.column_number.is_some() {
                                updated.column_number = Some(column_number);
                            }
                        }
                        None => {
                            let mut shared =
                                self.shared.lock().map_err(|error| error.to_string())?;
                            match shared.pending_resolutions.remove(breakpoint_id) {
                                Some(position) => {
                                    updated.verified = true;
                                    let (line_number, column_number) =
                                        original_breakpoint_position(&shared, &target, position);
                                    updated.line_number = line_number;
                                    if target.column_number.is_some() {
                                        updated.column_number = Some(column_number);
                                    }
                                }
                                None => {
                                    shared
                                        .resolution_index
                                        .insert(breakpoint_id.to_string(), target);
                                }
                            }
                        }
                    }
                }
            }
            applied.push(updated);
        }
        {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            shared
                .cdp_ids_by_file
                .insert(file_path.to_string(), registered_ids);
            shared
                .breakpoints_by_file
                .insert(file_path.to_string(), applied.clone());
        }
        Ok(applied)
    }

    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        let hidden_function_breakpoint_step = if kind == StepKind::Continue {
            let paused = {
                self.shared
                    .lock()
                    .map(|shared| shared.pause.is_some())
                    .map_err(|error| error.to_string())
            };
            let paused = match paused {
                Ok(paused) => paused,
                Err(message) => {
                    self.terminate();
                    return Err(message);
                }
            };
            if paused {
                match self.function_breakpoints.begin_hidden_continue_step() {
                    Ok(hidden) => hidden,
                    Err(()) => {
                        self.terminate();
                        return Err(
                            "Unable to retain pending function breakpoint state.".to_string()
                        );
                    }
                }
            } else {
                false
            }
        } else {
            if self
                .function_breakpoints
                .cancel_hidden_continue_step()
                .is_err()
            {
                self.terminate();
                return Err("Unable to clear pending function breakpoint state.".to_string());
            }
            false
        };
        let method = match kind {
            StepKind::Continue if hidden_function_breakpoint_step => "Debugger.stepInto",
            StepKind::Continue => "Debugger.resume",
            StepKind::StepOver => "Debugger.stepOver",
            StepKind::StepInto => "Debugger.stepInto",
            StepKind::StepOut => "Debugger.stepOut",
        };
        match self.client.request(method, json!({})) {
            Ok(_) => Ok(()),
            Err(error) => {
                if hidden_function_breakpoint_step
                    && self
                        .function_breakpoints
                        .cancel_hidden_continue_step()
                        .is_err()
                {
                    self.terminate();
                }
                Err(error)
            }
        }
    }

    fn pause(&mut self) -> Result<(), String> {
        let exception_filter_pending = self
            .exception_filter
            .lock()
            .map_err(|error| error.to_string())?
            .pending
            .is_some();
        let deferred_or_duplicate = {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            mark_explicit_pause_requested(&mut shared) || exception_filter_pending
        };
        if deferred_or_duplicate {
            return Ok(());
        }
        match self.client.request("Debugger.pause", json!({})) {
            Ok(_) => Ok(()),
            Err(error) => {
                if let Ok(mut shared) = self.shared.lock() {
                    shared.explicit_pause_requested = false;
                }
                Err(error)
            }
        }
    }

    fn restart_frame(&mut self, pause_generation: u64, frame_id: u64) -> Result<(), String> {
        super::restart_frame::restart_frame(
            &self.client,
            &self.shared,
            self.mutation_is_allowed.as_ref(),
            pause_generation,
            frame_id,
        )
    }

    fn run_to_location(
        &mut self,
        pause_generation: u64,
        file_path: &str,
        line_number: u32,
        column_number: u32,
    ) -> Result<(), String> {
        match super::run_to_location::run_to_location(
            &self.client,
            &self.shared,
            self.mutation_is_allowed.as_ref(),
            pause_generation,
            file_path,
            line_number,
            column_number,
        ) {
            Ok(()) => Ok(()),
            Err(super::run_to_location::RunToLocationFailure::Message(message)) => Err(message),
            Err(super::run_to_location::RunToLocationFailure::Cleanup) => {
                self.terminate();
                Err("Unable to remove the temporary run-to-location breakpoint; the debug session was terminated."
                    .to_string())
            }
        }
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        let shared = self.shared.lock().map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        Ok(pause.frames.clone())
    }

    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        let shared = self.shared.lock().map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        pause
            .scopes
            .get(&frame_id)
            .cloned()
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))
    }

    fn current_pause_generation(&self) -> Option<u64> {
        self.shared
            .lock()
            .ok()?
            .pause
            .as_ref()
            .map(|pause| pause.pause_generation)
    }

    fn variables_page(
        &mut self,
        request: DebugVariablePageRequest,
    ) -> Result<DebugVariablePage, String> {
        load_variables_page(&self.client, &self.shared, request)
    }

    fn set_variable(
        &mut self,
        request: DebugSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String> {
        super::variables::set_variable::set_variable(
            &self.client,
            &self.shared,
            self.mutation_is_allowed.as_ref(),
            request,
        )
    }

    fn set_expression(
        &mut self,
        request: DebugSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String> {
        super::variables::set_expression::set_expression(
            &self.client,
            &self.shared,
            self.mutation_is_allowed.as_ref(),
            request,
        )
    }

    fn completions(
        &mut self,
        request: DebugCompletionRequest,
    ) -> Result<DebugCompletionResult, String> {
        super::completions::complete(&self.client, &self.shared, request)
    }

    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        self.evaluate_with_policy(
            frame_id,
            expression,
            DebugEvaluatePolicy {
                context: DebugEvaluateContext::Repl,
                allow_side_effects: true,
            },
        )
        .map_err(|failure| failure.message)
    }

    fn evaluate_with_policy(
        &mut self,
        frame_id: u64,
        expression: &str,
        policy: DebugEvaluatePolicy,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        clipboard::evaluate_with_policy(&self.client, &self.shared, frame_id, expression, policy)
    }

    fn disconnect(&mut self) {
        super::disconnect::continue_and_close(&mut self.client, &self.shared);
        self.ownership = DebuggeeOwnership::External;
    }

    fn terminate(&mut self) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.pending_restart_frame = None;
            shared.invalidate_pause();
        }
        self.client.shutdown();
        if let DebuggeeOwnership::Spawned(process) =
            std::mem::replace(&mut self.ownership, DebuggeeOwnership::External)
        {
            process.terminate();
        }
    }
}

#[cfg(test)]
mod bounded_channel_tests {
    use super::*;

    fn test_adapter(
        shared: Arc<Mutex<CdpShared>>,
        function_breakpoints: Arc<
            crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState,
        >,
        outgoing: mpsc::SyncSender<String>,
        pending: PendingCdpRequests,
    ) -> NodeCdpAdapter {
        let (_completed_tx, completed_rx) = mpsc::sync_channel(1);
        NodeCdpAdapter {
            client: CdpClient {
                io_completed: completed_rx,
                io_thread: None,
                next_request_id: Arc::new(AtomicU64::new(1)),
                outgoing,
                pending,
                request_timeout: Duration::from_secs(1),
                shutdown_requested: Arc::new(AtomicBool::new(false)),
                disconnect_notifier: DisconnectNotifier::new(None),
                function_breakpoint_worker: None,
            },
            exception_filter: Arc::new(Mutex::new(ExceptionFilterState::default())),
            function_breakpoints,
            ownership: DebuggeeOwnership::External,
            shared,
            mutation_is_allowed: Arc::new(|| true),
        }
    }

    #[test]
    fn poisoned_pause_state_fails_closed_without_self_deadlocking() {
        let shared = empty_shared_state_for_test();
        let poison_target = Arc::clone(&shared);
        let _ = thread::spawn(move || {
            let _guard = poison_target.lock().unwrap();
            panic!("poison adapter pause state");
        })
        .join();
        let function_breakpoints = Arc::new(
            crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState::default(),
        );
        let (outgoing, _outgoing_rx) = mpsc::sync_channel(1);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let mut adapter = test_adapter(shared, function_breakpoints, outgoing, pending);
        let (result_tx, result_rx) = mpsc::sync_channel(1);

        let worker = thread::spawn(move || {
            let _ = result_tx.send(adapter.step(StepKind::Continue));
        });

        let result = result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("poisoned state handling must not deadlock");
        assert!(result.is_err());
        worker.join().unwrap();
    }

    #[test]
    fn duplicate_hidden_continue_sends_only_the_first_internal_step() {
        let shared = empty_shared_state_for_test();
        shared.lock().unwrap().pause = Some(PauseInventory::default());
        let function_breakpoints = Arc::new(
            crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState::default(),
        );
        function_breakpoints.arm_unresolved_for_hidden_continue_test();
        let (outgoing, outgoing_rx) = mpsc::sync_channel::<String>(4);
        let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
        let responder_pending = Arc::clone(&pending);
        let (methods_tx, methods_rx) = mpsc::sync_channel(1);
        let responder = thread::spawn(move || {
            let mut methods = Vec::new();
            if let Ok(message) = outgoing_rx.recv_timeout(Duration::from_secs(1)) {
                let request: Value = serde_json::from_str(&message).unwrap();
                methods.push(request["method"].as_str().unwrap().to_string());
                let id = request["id"].as_u64().unwrap();
                let response = responder_pending.lock().unwrap().remove(&id).unwrap();
                response.send(Ok(json!({}))).unwrap();
            }
            if let Ok(message) = outgoing_rx.recv_timeout(Duration::from_millis(200)) {
                let request: Value = serde_json::from_str(&message).unwrap();
                methods.push(request["method"].as_str().unwrap().to_string());
            }
            methods_tx.send(methods).unwrap();
        });
        let mut adapter = test_adapter(shared, function_breakpoints, outgoing, pending);

        assert_eq!(adapter.step(StepKind::Continue), Ok(()));
        assert!(adapter.step(StepKind::Continue).is_err());
        drop(adapter);

        assert_eq!(
            methods_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            vec!["Debugger.stepInto".to_string()]
        );
        responder.join().unwrap();
    }

    #[test]
    fn outgoing_queue_overflow_closes_transport_and_notifies_disconnect() {
        let (outgoing_tx, outgoing_rx) = mpsc::sync_channel(MAX_QUEUED_CDP_MESSAGES);
        for index in 0..MAX_QUEUED_CDP_MESSAGES {
            assert!(outgoing_tx.try_send(index.to_string()).is_ok());
        }
        let (completed_tx, completed_rx) = mpsc::sync_channel(1);
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let mut client = CdpClient {
            io_completed: completed_rx,
            io_thread: None,
            next_request_id: Arc::new(AtomicU64::new(1)),
            outgoing: outgoing_tx,
            pending: Arc::clone(&pending),
            request_timeout: Duration::from_secs(1),
            shutdown_requested: Arc::clone(&shutdown_requested),
            disconnect_notifier: DisconnectNotifier::new(Some(disconnected_tx)),
            function_breakpoint_worker: None,
        };

        assert_eq!(
            client.request("Runtime.enable", json!({})),
            Err(
                "Debugger transport queue overflowed while sending `Runtime.enable`; connection closed."
                    .to_string()
            )
        );
        assert!(shutdown_requested.load(Ordering::SeqCst));
        assert_eq!(disconnected_rx.recv_timeout(Duration::from_secs(1)), Ok(()));
        assert_eq!(outgoing_rx.try_iter().count(), MAX_QUEUED_CDP_MESSAGES);
        assert!(pending.lock().is_ok_and(|pending| pending.is_empty()));
        assert_eq!(completed_tx.try_send(()), Ok(()));
        client.shutdown();
    }

    #[test]
    fn response_queue_overflow_closes_transport_and_notifies_disconnect() {
        let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        assert_eq!(response_tx.try_send(Ok(Value::Null)), Ok(()));
        assert!(pending
            .lock()
            .is_ok_and(|mut pending| pending.insert(7, response_tx).is_none()));
        let shutdown_requested = AtomicBool::new(false);
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        let disconnect_notifier = DisconnectNotifier::new(Some(disconnected_tx));

        dispatch_response(
            7,
            &json!({"id": 7, "result": {}}),
            &pending,
            &shutdown_requested,
            &disconnect_notifier,
        );

        assert!(shutdown_requested.load(Ordering::SeqCst));
        assert_eq!(disconnected_rx.recv_timeout(Duration::from_secs(1)), Ok(()));
        assert_eq!(response_rx.try_recv(), Ok(Ok(Value::Null)));
        assert!(pending.lock().is_ok_and(|pending| pending.is_empty()));
    }
}
