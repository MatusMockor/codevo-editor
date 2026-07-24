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

mod shared_state {
    use super::*;
    include!("debug_cdp_shared_state.rs");
}
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
}

impl CdpClient {
    fn start(
        socket: WebSocket<BoundedCdpStream>,
        shared: Arc<Mutex<CdpShared>>,
        exception_filter: Arc<Mutex<ExceptionFilterState>>,
        emitter: CdpEventEmitter,
        request_timeout: Duration,
        disconnected: Option<mpsc::Sender<()>>,
        mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Self {
        let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
        let (outgoing_tx, outgoing_rx) = mpsc::sync_channel(MAX_QUEUED_CDP_MESSAGES);
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let disconnect_notifier = DisconnectNotifier::new(disconnected);
        let next_request_id = Arc::new(AtomicU64::new(1));
        let (completed_tx, completed_rx) = mpsc::sync_channel(1);
        let io_disconnect_notifier = disconnect_notifier.clone();
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
        };
        let io_thread = thread::spawn(move || {
            run_socket_loop(socket, context);
            io_disconnect_notifier.notify();
            let _ = completed_tx.send(());
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
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
            pending.insert(id, tx);
        }
        let payload = json!({"id": id, "method": method, "params": params}).to_string();
        match self.outgoing.try_send(payload) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                remove_pending_cdp_request(&self.pending, id);
                fail_closed_transport(
                    &self.pending,
                    &self.shutdown_requested,
                    &self.disconnect_notifier,
                );
                return Err(format!(
                    "Debugger transport queue overflowed while sending `{method}`; connection closed."
                ));
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                remove_pending_cdp_request(&self.pending, id);
                fail_closed_transport(
                    &self.pending,
                    &self.shutdown_requested,
                    &self.disconnect_notifier,
                );
                return Err(format!(
                    "Debugger connection is closed; unable to send `{method}`."
                ));
            }
        }
        match rx.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_cdp_request(&self.pending, id);
                Err(format!("Debugger request `{method}` timed out."))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(format!("Debugger connection closed during `{method}`."))
            }
        }
    }

    pub(super) fn shutdown(&mut self) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        if let Some(handle) = self.io_thread.take() {
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

fn remove_pending_cdp_request(pending: &PendingCdpRequests, id: u64) {
    if let Ok(mut pending) = pending.lock() {
        pending.remove(&id);
    }
}

fn reject_pending_cdp_requests(pending: &PendingCdpRequests) {
    if let Ok(mut pending) = pending.lock() {
        pending.clear();
    }
}

fn fail_closed_transport(
    pending: &PendingCdpRequests,
    shutdown: &AtomicBool,
    disconnect_notifier: &DisconnectNotifier,
) {
    shutdown.store(true, Ordering::SeqCst);
    reject_pending_cdp_requests(pending);
    disconnect_notifier.notify();
}

pub(crate) fn fail_closed_exception_timeout(context: &SocketLoopContext) {
    if let Ok(mut shared) = context.shared.lock() {
        shared.explicit_pause_requested = false;
        shared.internal_action = None;
        shared.pending_explicit_pause = None;
        shared.suppress_next_resumed = false;
        shared.invalidate_pause();
    }
    fail_closed_transport(
        &context.pending,
        &context.shutdown,
        &context.disconnect_notifier,
    );
}

pub(crate) struct SocketLoopContext {
    disconnect_notifier: DisconnectNotifier,
    pub(crate) emitter: CdpEventEmitter,
    pub(crate) exception_filter: Arc<Mutex<ExceptionFilterState>>,
    pub(crate) next_request_id: Arc<AtomicU64>,
    outgoing: mpsc::Receiver<String>,
    pending: PendingCdpRequests,
    pub(crate) request_timeout: Duration,
    pub(crate) shared: Arc<Mutex<CdpShared>>,
    shutdown: Arc<AtomicBool>,
    pub(crate) mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
}

fn run_socket_loop(mut socket: WebSocket<BoundedCdpStream>, context: SocketLoopContext) {
    loop {
        if context.shutdown.load(Ordering::SeqCst) || context.emitter.health().is_failed_closed() {
            let _ = socket.close(None);
            break;
        }
        let timeout_request = handle_exception_classification_timeout(&context)
            .or_else(|| handle_internal_action_timeout(&context));
        if context.shutdown.load(Ordering::SeqCst) || context.emitter.health().is_failed_closed() {
            let _ = socket.close(None);
            break;
        }
        if let Some(request) = timeout_request {
            if socket.send(Message::text(request)).is_err() {
                break;
            }
        }
        let mut write_failed = false;
        while let Ok(payload) = context.outgoing.try_recv() {
            if socket.send(Message::text(payload)).is_err() {
                write_failed = true;
                break;
            }
        }
        if write_failed {
            break;
        }
        let text = match socket.read() {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(WsError::Io(error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(_) => break,
        };
        let reply = handle_incoming_message(text.as_str(), &context);
        if context.emitter.health().is_failed_closed() {
            let _ = socket.close(None);
            break;
        }
        if let Some(reply) = reply {
            if context.shutdown.load(Ordering::SeqCst) {
                break;
            }
            if socket.send(Message::text(reply)).is_err() {
                break;
            }
        }
    }
    reject_pending_cdp_requests(&context.pending);
}

fn handle_incoming_message(text: &str, context: &SocketLoopContext) -> Option<String> {
    let message: Value = serde_json::from_str(text).ok()?;
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        if let Some(InternalResponse::Handled(reply)) =
            handle_exception_classification_response(id, &message, context)
        {
            return reply;
        }
        match handle_internal_action_response(id, &message, context) {
            InternalResponse::Handled(reply) => return reply,
            InternalResponse::NotHandled => {}
        }
        dispatch_response(
            id,
            &message,
            &context.pending,
            &context.shutdown,
            &context.disconnect_notifier,
        );
        return None;
    }
    match message.get("method").and_then(Value::as_str) {
        Some("Debugger.paused") => {
            handle_paused(message.get("params").unwrap_or(&Value::Null), context)
        }
        Some("Debugger.resumed") => handle_resumed(context),
        Some("Debugger.breakpointResolved") => {
            handle_breakpoint_resolved(message.get("params").unwrap_or(&Value::Null), context);
            None
        }
        Some("Debugger.scriptParsed") => {
            handle_script_parsed(message.get("params").unwrap_or(&Value::Null), context);
            None
        }
        _ => None,
    }
}

pub(crate) enum InternalResponse {
    NotHandled,
    Handled(Option<String>),
}

pub(crate) struct InternalFallback {
    diagnostic: Option<String>,
    frames: Vec<DebugStackFrame>,
    inventory: PauseInventory,
    reason: DebugStopReason,
}

fn handle_internal_action_response(
    id: u64,
    message: &Value,
    context: &SocketLoopContext,
) -> InternalResponse {
    let mut reply = None;
    let mut outputs = Vec::new();
    let mut fallback_event = None;
    let mut standalone_diagnostic = None;
    {
        let Ok(mut shared) = context.shared.lock() else {
            return InternalResponse::NotHandled;
        };
        if shared
            .pending_explicit_pause
            .as_ref()
            .is_some_and(|pending| pending.request_id == id)
        {
            if message.get("error").is_some() {
                fallback_event = fail_pending_explicit_pause(&mut shared);
                standalone_diagnostic =
                    Some("Unable to pause after an internal resume.".to_string());
            }
        } else {
            let matches = match shared.internal_action.as_ref() {
                Some(PendingInternalAction::Resume(pending)) => pending.request_id == id,
                Some(PendingInternalAction::Logpoint(pending)) => pending.request_id == id,
                None => false,
            };
            if !matches {
                return InternalResponse::NotHandled;
            }
            let action = shared.internal_action.take().expect("matched action");
            let mut fallback = None;
            match action {
                PendingInternalAction::Resume(pending) => {
                    if message.get("error").is_some() {
                        shared.explicit_pause_requested = false;
                        fallback = Some(fallback_from_resume(pending, None));
                    } else if shared.explicit_pause_requested {
                        reply = schedule_explicit_pause(
                            &mut shared,
                            context,
                            Some(fallback_from_resume(pending, None)),
                            true,
                        );
                    }
                }
                PendingInternalAction::Logpoint(mut pending) => {
                    if pending.phase == PendingLogpointPhase::Resume {
                        if message.get("error").is_some() {
                            shared.explicit_pause_requested = false;
                            fallback = Some(fallback_from_logpoint(
                                pending,
                                Some("Unable to resume after evaluating a logpoint.".into()),
                            ));
                        } else if shared.explicit_pause_requested {
                            reply = schedule_explicit_pause(
                                &mut shared,
                                context,
                                Some(fallback_from_logpoint(pending, None)),
                                true,
                            );
                        }
                    } else if shared.explicit_pause_requested {
                        shared.explicit_pause_requested = false;
                        fallback = Some(fallback_from_logpoint(
                            pending,
                            Some("Logpoint auto-resume was cancelled by an explicit pause.".into()),
                        ));
                    } else {
                        let evaluated = message
                            .get("error")
                            .map(|_| Err("Unable to evaluate a logpoint expression.".to_string()))
                            .unwrap_or_else(|| {
                                render_remote_object(message.get("result").unwrap_or(&Value::Null))
                            });
                        match evaluated {
                            Ok(value) => {
                                append_bounded_log_output(&mut pending.current_output, &value);
                                pending.segment_index += 1;
                                let advance = advance_logpoint(
                                    &mut pending,
                                    &context.next_request_id,
                                    context.request_timeout,
                                );
                                reply = Some(advance.request);
                                outputs = advance.outputs;
                                shared.internal_action =
                                    Some(PendingInternalAction::Logpoint(pending));
                            }
                            Err(error) => {
                                fallback = Some(fallback_from_logpoint(pending, Some(error)));
                            }
                        }
                    }
                }
            }
            if let Some(fallback) = fallback {
                shared.suppress_next_resumed = false;
                fallback_event = Some((
                    fallback.diagnostic,
                    fallback.reason,
                    fallback.frames,
                    fallback.inventory.pause_generation,
                ));
                shared.pause = Some(fallback.inventory);
            }
        }
    }
    if !context.shutdown.load(Ordering::SeqCst) {
        for text in outputs {
            context.emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text,
            });
        }
        if let Some(diagnostic) = standalone_diagnostic {
            context.emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: format!("[debugger] {diagnostic}\n"),
            });
        }
        if let Some((diagnostic, reason, frames, pause_generation)) = fallback_event {
            if let Some(diagnostic) = diagnostic {
                context.emitter.emit(DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: format!("[logpoint] {diagnostic}\n"),
                });
            }
            context.emitter.emit(DebugEventPayload::Stopped {
                reason,
                frames,
                pause_generation,
            });
        }
    }
    InternalResponse::Handled(reply)
}

pub(crate) fn schedule_explicit_pause(
    shared: &mut CdpShared,
    context: &SocketLoopContext,
    recovery: Option<InternalFallback>,
    resume_confirmed: bool,
) -> Option<String> {
    if shared.pending_explicit_pause.is_some() {
        return None;
    }
    let request_id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
    shared.pending_explicit_pause = Some(PendingExplicitPause {
        deadline: Instant::now() + context.request_timeout,
        recovery,
        request_id,
        resume_confirmed,
    });
    Some(json!({"id": request_id, "method": "Debugger.pause", "params": {}}).to_string())
}

fn fail_pending_explicit_pause(
    shared: &mut CdpShared,
) -> Option<(Option<String>, DebugStopReason, Vec<DebugStackFrame>, u64)> {
    let pending = shared.pending_explicit_pause.take()?;
    shared.explicit_pause_requested = false;
    if pending.resume_confirmed {
        return None;
    }
    let fallback = pending.recovery?;
    shared.suppress_next_resumed = false;
    let frames = fallback.frames;
    let reason = fallback.reason;
    let pause_generation = fallback.inventory.pause_generation;
    shared.pause = Some(fallback.inventory);
    Some((None, reason, frames, pause_generation))
}

pub(super) fn mark_explicit_pause_requested(shared: &mut CdpShared) -> bool {
    let deferred_or_duplicate = shared.explicit_pause_requested
        || shared.internal_action.is_some()
        || shared.pending_explicit_pause.is_some()
        || shared.suppress_next_resumed;
    shared.explicit_pause_requested = true;
    deferred_or_duplicate
}

fn handle_internal_action_timeout(context: &SocketLoopContext) -> Option<String> {
    let now = Instant::now();
    let mut request = None;
    let mut fallback_event = None;
    let mut standalone_diagnostic = None;
    {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        super::restart_frame::expire_pending(&mut shared, now);
        if shared
            .pending_explicit_pause
            .as_ref()
            .is_some_and(|pending| pending.deadline <= now)
        {
            fallback_event = fail_pending_explicit_pause(&mut shared);
            standalone_diagnostic =
                Some("Timed out while pausing after an internal resume.".to_string());
        } else {
            let expired = match shared.internal_action.as_ref() {
                Some(PendingInternalAction::Resume(pending)) => pending.deadline <= now,
                Some(PendingInternalAction::Logpoint(pending)) => pending.deadline <= now,
                None => false,
            };
            if !expired {
                return None;
            }
            let action = shared.internal_action.take().expect("expired action");
            match action {
                PendingInternalAction::Logpoint(pending)
                    if pending.phase == PendingLogpointPhase::Evaluate =>
                {
                    shared.explicit_pause_requested = false;
                    shared.suppress_next_resumed = false;
                    let fallback = fallback_from_logpoint(
                        pending,
                        Some("Timed out while evaluating a logpoint expression.".into()),
                    );
                    let pause_generation = fallback.inventory.pause_generation;
                    shared.pause = Some(fallback.inventory);
                    fallback_event = Some((
                        fallback.diagnostic,
                        fallback.reason,
                        fallback.frames,
                        pause_generation,
                    ));
                }
                action
                @ (PendingInternalAction::Resume(_) | PendingInternalAction::Logpoint(_)) => {
                    // A resume request may have taken effect even when its response was lost.
                    // Establish a fresh authoritative pause instead of restoring stale frames.
                    shared.explicit_pause_requested = true;
                    standalone_diagnostic = Some(
                        "Timed out while resuming internally; requesting an authoritative pause."
                            .to_string(),
                    );
                    request = schedule_explicit_pause(
                        &mut shared,
                        context,
                        Some(fallback_from_internal_action(action)),
                        false,
                    );
                }
            }
        }
    }
    if !context.shutdown.load(Ordering::SeqCst) {
        if let Some(diagnostic) = standalone_diagnostic {
            context.emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: format!("[debugger] {diagnostic}\n"),
            });
        }
        if let Some((diagnostic, reason, frames, pause_generation)) = fallback_event {
            if let Some(diagnostic) = diagnostic {
                context.emitter.emit(DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: format!("[logpoint] {diagnostic}\n"),
                });
            }
            context.emitter.emit(DebugEventPayload::Stopped {
                reason,
                frames,
                pause_generation,
            });
        }
    }
    request
}

fn fallback_from_resume(
    pending: PendingInternalResume,
    diagnostic: Option<String>,
) -> InternalFallback {
    let frames = pending.inventory.frames.clone();
    InternalFallback {
        diagnostic,
        frames,
        inventory: pending.inventory,
        reason: pending.reason,
    }
}

fn fallback_from_logpoint(
    pending: PendingLogpoint,
    diagnostic: Option<String>,
) -> InternalFallback {
    let frames = pending.inventory.frames.clone();
    InternalFallback {
        diagnostic,
        frames,
        inventory: pending.inventory,
        reason: pending.reason,
    }
}

pub(crate) fn fallback_from_internal_action(action: PendingInternalAction) -> InternalFallback {
    match action {
        PendingInternalAction::Resume(pending) => fallback_from_resume(pending, None),
        PendingInternalAction::Logpoint(pending) => fallback_from_logpoint(pending, None),
    }
}

pub(crate) struct LogpointAdvance {
    pub(crate) outputs: Vec<String>,
    pub(crate) request: String,
}

pub(crate) fn advance_logpoint(
    pending: &mut PendingLogpoint,
    next_request_id: &AtomicU64,
    request_timeout: Duration,
) -> LogpointAdvance {
    let mut completed = Vec::new();
    loop {
        let Some(template) = pending.templates.get(pending.message_index) else {
            pending.phase = PendingLogpointPhase::Resume;
            pending.request_id = next_request_id.fetch_add(1, Ordering::SeqCst);
            pending.deadline = Instant::now() + request_timeout;
            return LogpointAdvance {
                outputs: completed,
                request: json!({
                    "id": pending.request_id,
                    "method": "Debugger.resume",
                    "params": {}
                })
                .to_string(),
            };
        };
        let Some(segment) = template.segments.get(pending.segment_index) else {
            append_bounded_log_output(&mut pending.current_output, "\n");
            completed.push(std::mem::take(&mut pending.current_output));
            pending.message_index += 1;
            pending.segment_index = 0;
            continue;
        };
        match segment {
            DebugLogSegment::Literal(value) => {
                append_bounded_log_output(&mut pending.current_output, value);
                pending.segment_index += 1;
            }
            DebugLogSegment::Expression(expression) => {
                pending.phase = PendingLogpointPhase::Evaluate;
                pending.request_id = next_request_id.fetch_add(1, Ordering::SeqCst);
                pending.deadline = Instant::now() + request_timeout;
                return LogpointAdvance {
                    outputs: completed,
                    request: json!({
                        "id": pending.request_id,
                        "method": "Debugger.evaluateOnCallFrame",
                        "params": {
                            "callFrameId": pending.call_frame_id,
                            "expression": expression,
                            "silent": true,
                            "returnByValue": true,
                            "awaitPromise": false
                        }
                    })
                    .to_string(),
                };
            }
        }
    }
}

fn dispatch_response(
    id: u64,
    message: &Value,
    pending: &PendingCdpRequests,
    shutdown: &AtomicBool,
    disconnect_notifier: &DisconnectNotifier,
) {
    let sender = pending
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&id));
    let Some(sender) = sender else {
        return;
    };
    let outcome = match message.get("error") {
        Some(error) => Err(error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string())),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    if matches!(sender.try_send(outcome), Err(mpsc::TrySendError::Full(_))) {
        fail_closed_transport(pending, shutdown, disconnect_notifier);
    }
}

/// A resolution for a not-yet-registered CDP breakpoint id is buffered in
/// `pending_resolutions` so `set_breakpoints` can consume it after the
/// `setBreakpointByUrl` response lands.
pub(crate) fn apply_breakpoint_resolution(
    state: &mut CdpShared,
    cdp_breakpoint_id: &str,
    generated: GeneratedPosition,
) -> Option<(String, Vec<DebugBreakpoint>)> {
    let Some(target) = state.resolution_index.remove(cdp_breakpoint_id) else {
        if state.pending_resolutions.len() < MAX_PENDING_BREAKPOINT_RESOLUTIONS {
            state
                .pending_resolutions
                .insert(cdp_breakpoint_id.to_string(), generated);
        }
        return None;
    };
    let (resolved_line, resolved_column) = original_breakpoint_position(state, &target, generated);
    let breakpoints = state.breakpoints_by_file.get_mut(&target.file_path)?;
    let entry = breakpoints
        .iter_mut()
        .find(|breakpoint| breakpoint.id == target.breakpoint_id)?;
    entry.verified = true;
    entry.line_number = resolved_line;
    if target.column_number.is_some() {
        entry.column_number = Some(resolved_column);
    }
    Some((target.file_path, breakpoints.clone()))
}

pub(super) fn original_breakpoint_line(
    state: &CdpShared,
    target: &BreakpointResolutionTarget,
    generated: GeneratedPosition,
) -> u32 {
    original_breakpoint_position(state, target, generated).0
}

pub(crate) fn stop_reason(reason: &str) -> DebugStopReason {
    map_stop_reason(reason)
}

pub(crate) fn invalidate_pause(shared: &mut CdpShared) {
    shared.invalidate_pause();
}

pub(crate) fn emit_debug_event(context: &SocketLoopContext, payload: DebugEventPayload) {
    context.emitter.emit(payload);
}

pub(crate) fn install_visible_pause(
    params: &Value,
    shared: &mut CdpShared,
) -> Result<(Vec<DebugStackFrame>, u64, DebugStopReason), String> {
    super::restart_frame::install_visible_pause(params, shared)
}

fn original_breakpoint_position(
    state: &CdpShared,
    target: &BreakpointResolutionTarget,
    generated: GeneratedPosition,
) -> (u32, u32) {
    state
        .source_maps
        .as_ref()
        .and_then(|source_maps| {
            source_maps.map_generated(&target.generated_url, generated.line, generated.column)
        })
        .filter(|location| location.file_path == target.source_path)
        .map(|location| (location.line_number, location.column))
        .unwrap_or((
            generated.line.saturating_add(1),
            generated.column.saturating_add(1),
        ))
}

pub(crate) fn build_pause_inventory(
    params: &Value,
    state: &mut CdpShared,
) -> Result<PauseInventory, String> {
    let mut inventory = PauseInventory {
        pause_generation: state
            .advance_pause_generation()
            .ok_or_else(|| "The debug pause generation is exhausted.".to_string())?,
        ..PauseInventory::default()
    };
    let empty = Vec::new();
    let call_frames = params
        .get("callFrames")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    for call_frame in call_frames {
        let generated_url = call_frame.get("url").and_then(Value::as_str);
        let generated_line = call_frame
            .pointer("/location/lineNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let generated_column = call_frame
            .pointer("/location/columnNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let mapped = generated_url.and_then(|url| {
            state.source_maps.as_ref().and_then(|source_maps| {
                source_maps.map_generated(url, generated_line, generated_column)
            })
        });
        let frame_id = state.allocate_id();
        let name = call_frame
            .get("functionName")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("(anonymous)")
            .to_string();
        let file_path = mapped
            .as_ref()
            .map(|location| location.file_path.clone())
            .or_else(|| generated_url.and_then(path_from_file_url));
        let line_number = mapped
            .as_ref()
            .map(|location| location.line_number)
            .unwrap_or(generated_line + 1);
        let column = mapped
            .as_ref()
            .map(|location| location.column)
            .unwrap_or(generated_column + 1);
        inventory.frames.push(DebugStackFrame {
            frame_id,
            name,
            file_path,
            line_number,
            column,
        });
        let call_frame_id = call_frame.get("callFrameId").and_then(Value::as_str);
        if let Some(call_frame_id) = call_frame_id {
            inventory
                .call_frame_ids
                .insert(frame_id, call_frame_id.to_string());
        }
        if let Some(object_id) = this_receiver::ordinary_this_object_id(call_frame) {
            inventory
                .call_frame_this_object_ids
                .insert(frame_id, object_id);
        }
        let mut scopes = Vec::new();
        for (scope_number, scope) in call_frame
            .get("scopeChain")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .enumerate()
        {
            if inventory.object_ids.len() >= MAX_CDP_OBJECT_REFERENCES_PER_PAUSE {
                break;
            }
            let Some(object_id) = scope.pointer("/object/objectId").and_then(Value::as_str) else {
                continue;
            };
            if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
                continue;
            }
            let scope_type = scope.get("type").and_then(Value::as_str).unwrap_or("scope");
            let reference = state.allocate_id();
            inventory.object_ids.insert(
                reference,
                ObjectReference {
                    frame_id,
                    object_id: object_id.to_string(),
                    pause_generation: inventory.pause_generation,
                    evaluate_name: None,
                    access: ObjectReferenceAccess::ScopeRoot,
                    mutation: scope_mutation(call_frame_id, scope_number, scope_type),
                    lineage: None,
                },
            );
            scopes.push(DebugScopeInfo {
                name: super::scope::display_name(scope_type),
                variables_reference: reference,
                expensive: scope_type == "global",
            });
        }
        inventory.scopes.insert(frame_id, scopes);
    }
    Ok(inventory)
}

pub(crate) struct NodeCdpAdapter {
    client: CdpClient,
    exception_filter: Arc<Mutex<ExceptionFilterState>>,
    function_breakpoints: crate::debug_cdp_function_breakpoints::FunctionBreakpointRegistrations,
    ownership: DebuggeeOwnership,
    shared: Arc<Mutex<CdpShared>>,
    mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
}

#[derive(Clone, Copy)]
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
        {
            let mut state = self
                .exception_filter
                .lock()
                .map_err(|error| error.to_string())?;
            state.begin_policy_update();
        }
        crate::debug_cdp_breakpoints::set_exception_pause(
            &self.client,
            self.mutation_is_allowed.as_ref(),
            mode,
        )?;
        ensure_startup_current(self.mutation_is_allowed.as_ref())?;
        let mut state = self
            .exception_filter
            .lock()
            .map_err(|error| error.to_string())?;
        let filter = if mode == DebugExceptionPauseMode::None {
            DebugExceptionTypeFilter::default()
        } else {
            filter
        };
        state.finish_policy_update(filter);
        Ok(())
    }

    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
    ) -> Result<Vec<crate::debug_adapter::DebugFunctionBreakpointVerification>, String> {
        let authority = Arc::clone(&self.mutation_is_allowed);
        crate::debug_cdp_function_breakpoints::replace_function_breakpoints(
            &mut self.client,
            &mut self.function_breakpoints,
            breakpoints,
            move || authority(),
        )
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
        let method = match kind {
            StepKind::Continue => "Debugger.resume",
            StepKind::StepOver => "Debugger.stepOver",
            StepKind::StepInto => "Debugger.stepInto",
            StepKind::StepOut => "Debugger.stepOut",
        };
        self.client.request(method, json!({}))?;
        Ok(())
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
        if let DebuggeeOwnership::Spawned(process) = self.ownership {
            process.terminate();
        }
        self.ownership = DebuggeeOwnership::External;
    }
}

#[cfg(test)]
mod bounded_channel_tests {
    use super::*;

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
