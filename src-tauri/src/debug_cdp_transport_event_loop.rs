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

fn cancel_smart_step_on_socket_end(context: &SocketLoopContext) {
    if let Ok(mut shared) = context.shared.lock() {
        shared.cancel_smart_step();
    }
}

pub(crate) fn fail_closed_exception_timeout(context: &SocketLoopContext) {
    if let Ok(mut shared) = context.shared.lock() {
        shared.cancel_smart_step();
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

pub(crate) fn fail_closed_socket_loop(context: &SocketLoopContext) {
    cancel_smart_step_on_socket_end(context);
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
    function_breakpoint_trigger: mpsc::SyncSender<()>,
    pub(crate) function_breakpoints:
        Arc<crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState>,
}

fn run_socket_loop(mut socket: WebSocket<BoundedCdpStream>, context: SocketLoopContext) {
    loop {
        if context.shutdown.load(Ordering::SeqCst) || context.emitter.health().is_failed_closed() {
            let _ = socket.close(None);
            break;
        }
        let timeout_request = handle_exception_classification_timeout(&context)
            .or_else(|| handle_internal_action_timeout(&context));
        expire_smart_step_request(&context);
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
            let Some(dispatch_lease) = commit_smart_step_dispatch(&context) else {
                continue;
            };
            let send_failed = socket.send(Message::text(reply)).is_err();
            finish_smart_step_dispatch(&context, dispatch_lease);
            if send_failed {
                break;
            }
        }
    }
    cancel_smart_step_on_socket_end(&context);
    reject_pending_cdp_requests(&context.pending);
}

#[cfg(test)]
use smart_step_runtime::validate_smart_step_dispatch;
use smart_step_runtime::{
    commit_smart_step_dispatch, expire_smart_step_request, finish_smart_step_dispatch,
    handle_smart_step_response,
};

fn handle_incoming_message(text: &str, context: &SocketLoopContext) -> Option<String> {
    let message: Value = serde_json::from_str(text).ok()?;
    let router = context.disconnect_notifier.session_router();
    let scope = match session_routing::parse_cdp_target_scope(&message) {
        Ok(scope) => scope,
        Err(_) => {
            router.record_dropped_message();
            return None;
        }
    };
    if let Some(id) = message.get("id") {
        let Some(id) = id.as_u64() else {
            router.record_dropped_message();
            return None;
        };
        if let CdpTargetScope::Session(session_id) = &scope {
            if router.dispatch_response(session_id, id, &message)
                == CdpSessionResponseDispatch::ReceiverOverflow
            {
                fail_closed_transport(
                    &context.pending,
                    &context.shutdown,
                    &context.disconnect_notifier,
                );
            }
            return None;
        }
        if handle_smart_step_response(id, &message, context) {
            return None;
        }
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
    if let CdpTargetScope::Session(session_id) = scope {
        if message.get("method").and_then(Value::as_str).is_some() {
            router.dispatch_event(&session_id, &message);
            return None;
        }
        router.record_dropped_message();
        return None;
    }
    match message.get("method").and_then(Value::as_str) {
        Some("Debugger.paused") => {
            let params = message.get("params").unwrap_or(&Value::Null);
            let function_breakpoint_capture = context
                .function_breakpoints
                .capture_hidden_continue_pause(params);
            match function_breakpoint_capture {
                crate::debug_cdp_function_breakpoints::HiddenPauseCapture::Captured => {
                    match context.function_breakpoint_trigger.try_send(()) {
                        Ok(()) | Err(mpsc::TrySendError::Full(())) => return None,
                        Err(mpsc::TrySendError::Disconnected(())) => {
                            let _ = context.function_breakpoints.cancel_hidden_continue_step();
                            fail_closed_transport(
                                &context.pending,
                                &context.shutdown,
                                &context.disconnect_notifier,
                            );
                            return None;
                        }
                    }
                }
                crate::debug_cdp_function_breakpoints::HiddenPauseCapture::PassThrough => {}
                crate::debug_cdp_function_breakpoints::HiddenPauseCapture::Revoke => {
                    let _ = context.function_breakpoints.cancel_hidden_continue_step();
                    fail_closed_transport(
                        &context.pending,
                        &context.shutdown,
                        &context.disconnect_notifier,
                    );
                    return None;
                }
            }
            handle_paused(params, context)
        }
        Some("Debugger.resumed") => handle_resumed(context),
        Some("Debugger.breakpointResolved") => {
            handle_breakpoint_resolved(message.get("params").unwrap_or(&Value::Null), context);
            None
        }
        Some("Debugger.scriptParsed") => {
            let params = message.get("params").unwrap_or(&Value::Null);
            if context
                .function_breakpoints
                .observe_script_parsed(params)
                .is_err()
            {
                fail_closed_transport(
                    &context.pending,
                    &context.shutdown,
                    &context.disconnect_notifier,
                );
                return None;
            }
            handle_script_parsed(params, context);
            let _ = context.function_breakpoint_trigger.try_send(());
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

struct InternalFallbackEvent {
    diagnostic: Option<String>,
    frames: Vec<DebugStackFrame>,
    frames_truncated: bool,
    pause_generation: u64,
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
                fallback_event = Some(InternalFallbackEvent {
                    diagnostic: fallback.diagnostic,
                    frames: fallback.frames,
                    frames_truncated: fallback.inventory.frames_truncated,
                    pause_generation: fallback.inventory.pause_generation,
                    reason: fallback.reason,
                });
                shared.pause = Some(fallback.inventory);
            }
        }
    }
    if !context.shutdown.load(Ordering::SeqCst) {
        for text in outputs {
            context.emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text,
                truncated: false,
            });
        }
        if let Some(diagnostic) = standalone_diagnostic {
            context.emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: format!("[debugger] {diagnostic}\n"),
                truncated: false,
            });
        }
        if let Some(fallback) = fallback_event {
            let InternalFallbackEvent {
                diagnostic,
                frames,
                frames_truncated,
                pause_generation,
                reason,
            } = fallback;
            if let Some(diagnostic) = diagnostic {
                context.emitter.emit(DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: format!("[logpoint] {diagnostic}\n"),
                    truncated: false,
                });
            }
            context.emitter.emit(DebugEventPayload::Stopped {
                reason,
                frames,
                pause_generation,
                frames_truncated,
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

fn fail_pending_explicit_pause(shared: &mut CdpShared) -> Option<InternalFallbackEvent> {
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
    let frames_truncated = fallback.inventory.frames_truncated;
    shared.pause = Some(fallback.inventory);
    Some(InternalFallbackEvent {
        diagnostic: None,
        frames,
        frames_truncated,
        pause_generation,
        reason,
    })
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
                    let frames_truncated = fallback.inventory.frames_truncated;
                    shared.pause = Some(fallback.inventory);
                    fallback_event = Some(InternalFallbackEvent {
                        diagnostic: fallback.diagnostic,
                        frames: fallback.frames,
                        frames_truncated,
                        pause_generation,
                        reason: fallback.reason,
                    });
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
                truncated: false,
            });
        }
        if let Some(fallback) = fallback_event {
            let InternalFallbackEvent {
                diagnostic,
                frames,
                frames_truncated,
                pause_generation,
                reason,
            } = fallback;
            if let Some(diagnostic) = diagnostic {
                context.emitter.emit(DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: format!("[logpoint] {diagnostic}\n"),
                    truncated: false,
                });
            }
            context.emitter.emit(DebugEventPayload::Stopped {
                reason,
                frames,
                pause_generation,
                frames_truncated,
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
    let prepared = prepare_breakpoint_resolution(state, cdp_breakpoint_id, generated)?;
    let resolved = prepared.resolve();
    complete_breakpoint_resolution(state, resolved)
}

pub(crate) struct PreparedBreakpointResolution {
    candidate: Option<crate::debug_source_map::MappedSourceCandidate>,
    cdp_breakpoint_id: Option<String>,
    generated: GeneratedPosition,
    target: BreakpointResolutionTarget,
}

pub(crate) struct ResolvedBreakpointPosition {
    cdp_breakpoint_id: Option<String>,
    fallback_column: u32,
    fallback_line: u32,
    map_receipt: Option<crate::debug_source_map::SourceMapReceipt>,
    pub(crate) line: u32,
    pub(crate) column: u32,
    target: BreakpointResolutionTarget,
}

pub(crate) fn prepare_breakpoint_resolution(
    state: &mut CdpShared,
    cdp_breakpoint_id: &str,
    generated: GeneratedPosition,
) -> Option<PreparedBreakpointResolution> {
    let Some(target) = state.resolution_index.get(cdp_breakpoint_id).cloned() else {
        if state.pending_resolutions.len() < MAX_PENDING_BREAKPOINT_RESOLUTIONS {
            state
                .pending_resolutions
                .insert(cdp_breakpoint_id.to_string(), generated);
        }
        return None;
    };
    let candidate = original_breakpoint_candidate(state, &target, &generated);
    Some(PreparedBreakpointResolution {
        candidate,
        cdp_breakpoint_id: Some(cdp_breakpoint_id.to_string()),
        generated,
        target,
    })
}

pub(crate) fn complete_breakpoint_resolution(
    state: &mut CdpShared,
    resolved: ResolvedBreakpointPosition,
) -> Option<(String, Vec<DebugBreakpoint>)> {
    if resolved.map_receipt.as_ref().is_some_and(|receipt| {
        !state
            .source_maps
            .as_ref()
            .is_some_and(|source_maps| source_maps.is_current_receipt(receipt))
    }) {
        return None;
    }
    if let Some(cdp_breakpoint_id) = &resolved.cdp_breakpoint_id {
        if !state
            .resolution_index
            .get(cdp_breakpoint_id)
            .is_some_and(|target| target == &resolved.target)
        {
            return None;
        }
        state.resolution_index.remove(cdp_breakpoint_id);
    }
    let breakpoints = state
        .breakpoints_by_file
        .get_mut(&resolved.target.file_path)?;
    let entry = breakpoints
        .iter_mut()
        .find(|breakpoint| breakpoint.id == resolved.target.breakpoint_id)?;
    entry.verified = true;
    entry.line_number = resolved.line;
    if resolved.target.column_number.is_some() {
        entry.column_number = Some(resolved.column);
    }
    Some((resolved.target.file_path, breakpoints.clone()))
}

pub(super) fn original_breakpoint_line(
    state: &CdpShared,
    target: &BreakpointResolutionTarget,
    generated: &GeneratedPosition,
) -> u32 {
    prepare_original_breakpoint_resolution(state, target, generated)
        .resolve()
        .line
}

pub(crate) fn prepare_original_breakpoint_resolution(
    state: &CdpShared,
    target: &BreakpointResolutionTarget,
    generated: &GeneratedPosition,
) -> PreparedBreakpointResolution {
    PreparedBreakpointResolution {
        candidate: original_breakpoint_candidate(state, target, generated),
        cdp_breakpoint_id: None,
        generated: generated.clone(),
        target: target.clone(),
    }
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
) -> Result<(Vec<DebugStackFrame>, u64, DebugStopReason, bool), String> {
    super::restart_frame::install_visible_pause(params, shared)
}

fn original_breakpoint_candidate(
    state: &CdpShared,
    target: &BreakpointResolutionTarget,
    generated: &GeneratedPosition,
) -> Option<crate::debug_source_map::MappedSourceCandidate> {
    state
        .source_maps
        .as_ref()
        .and_then(|source_maps| match &generated.script_identity {
            GeneratedScriptIdentity::Exact(script_id) => source_maps
                .map_generated_candidate_for_script(
                    script_id,
                    &target.generated_url,
                    generated.line,
                    generated.column,
                ),
            GeneratedScriptIdentity::Absent => source_maps.map_generated_candidate(
                &target.generated_url,
                generated.line,
                generated.column,
            ),
            GeneratedScriptIdentity::Invalid => None,
        })
}

impl PreparedBreakpointResolution {
    pub(crate) fn resolve(self) -> ResolvedBreakpointPosition {
        let validated = self
            .candidate
            .and_then(|candidate| candidate.validate_with_receipt())
            .filter(|validated| validated.location.file_path == self.target.source_path);
        let fallback_line = self.generated.line.saturating_add(1);
        let fallback_column = self.generated.column.saturating_add(1);
        ResolvedBreakpointPosition {
            cdp_breakpoint_id: self.cdp_breakpoint_id,
            map_receipt: validated
                .as_ref()
                .map(|validated| validated.receipt.clone()),
            line: validated
                .as_ref()
                .map(|validated| validated.location.line_number)
                .unwrap_or(fallback_line),
            column: validated
                .as_ref()
                .map(|validated| validated.location.column)
                .unwrap_or(fallback_column),
            fallback_line,
            fallback_column,
            target: self.target,
        }
    }
}

impl ResolvedBreakpointPosition {
    pub(crate) fn revalidate_map(mut self, state: &CdpShared) -> Self {
        if self.map_receipt.as_ref().is_some_and(|receipt| {
            !state
                .source_maps
                .as_ref()
                .is_some_and(|source_maps| source_maps.is_current_receipt(receipt))
        }) {
            self.line = self.fallback_line;
            self.column = self.fallback_column;
            self.map_receipt = None;
        }
        self
    }
}

pub(crate) const MAX_CDP_STACK_FRAMES: usize = 256;
pub(crate) const MAX_CDP_STACK_FRAME_NAME_BYTES: usize = 1_024;
pub(crate) const MAX_CDP_STACK_FRAME_PATH_BYTES: usize = 4_096;
// The normal event queue admits at most 216 KiB after its reserved delivery budget.
// Keep the serialized frame projection comfortably below that boundary so the lifecycle
// event itself can never be silently replaced by the overflow diagnostic.
pub(crate) const MAX_CDP_STACK_FRAME_EVENT_BYTES: usize = 128 * 1_024;

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
    let mut aggregate_frame_bytes = 2usize;
    for call_frame in call_frames.iter().take(MAX_CDP_STACK_FRAMES + 1) {
        if inventory.frames.len() == MAX_CDP_STACK_FRAMES {
            inventory.frames_truncated = true;
            break;
        }
        let raw_call_frame_id = call_frame.get("callFrameId").and_then(Value::as_str);
        let Some(call_frame_id) =
            raw_call_frame_id.filter(|id| !id.is_empty() && id.len() <= MAX_CDP_OBJECT_ID_BYTES)
        else {
            inventory.frames_truncated = true;
            continue;
        };
        let raw_generated_url = call_frame.get("url").and_then(Value::as_str);
        let bounded_raw_generated_url = raw_generated_url.filter(|url| {
            !url.is_empty()
                && url.len() <= MAX_CDP_STACK_FRAME_PATH_BYTES
                && !url.chars().any(char::is_control)
                && !url.trim().is_empty()
        });
        if raw_generated_url.is_some_and(|url| !url.is_empty())
            && bounded_raw_generated_url.is_none()
        {
            inventory.frames_truncated = true;
        }
        let generated_line = call_frame
            .pointer("/location/lineNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let generated_column = call_frame
            .pointer("/location/columnNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let script_id = call_frame
            .pointer("/location/scriptId")
            .and_then(Value::as_str);
        let recovered_generated_url = bounded_raw_generated_url
            .is_none()
            .then(|| {
                script_id.and_then(|script_id| {
                    state
                        .source_maps
                        .as_ref()
                        .and_then(|source_maps| source_maps.generated_url_for_script(script_id))
                        .filter(|url| {
                            !url.is_empty()
                                && url.len() <= MAX_CDP_STACK_FRAME_PATH_BYTES
                                && !url.chars().any(char::is_control)
                                && !url.trim().is_empty()
                        })
                        .map(str::to_string)
                })
            })
            .flatten();
        let generated_url = bounded_raw_generated_url.or(recovered_generated_url.as_deref());
        let mapped = call_frame
            .get("__codevoOriginalLocation")
            .and_then(decode_prepared_source_location)
            .or_else(|| {
                (!params
                    .get("__codevoSourceMapsPrepared")
                    .and_then(Value::as_bool)
                    .unwrap_or(false))
                .then(|| {
                    generated_url.and_then(|url| {
                        state.source_maps.as_ref().and_then(|source_maps| {
                            if let Some(script_id) = script_id {
                                source_maps.map_generated_for_script(
                                    script_id,
                                    url,
                                    generated_line,
                                    generated_column,
                                )
                            } else {
                                source_maps.map_generated(url, generated_line, generated_column)
                            }
                        })
                    })
                })
                .flatten()
            });
        let frame_id = state.allocate_id();
        let raw_name = call_frame
            .get("functionName")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("(anonymous)");
        let (name, name_truncated) =
            bounded_stack_frame_name(raw_name, MAX_CDP_STACK_FRAME_NAME_BYTES);
        if name_truncated {
            inventory.frames_truncated = true;
        }
        let file_path = mapped
            .as_ref()
            .map(|location| location.file_path.clone())
            .or_else(|| generated_url.and_then(path_from_file_url));
        let file_path = file_path.and_then(|path| {
            if path.len() <= MAX_CDP_STACK_FRAME_PATH_BYTES
                && !path.chars().any(char::is_control)
                && !path.trim().is_empty()
            {
                Some(path)
            } else {
                inventory.frames_truncated = true;
                None
            }
        });
        let line_number = mapped
            .as_ref()
            .map(|location| location.line_number)
            .unwrap_or(generated_line.saturating_add(1));
        let column = mapped
            .as_ref()
            .map(|location| location.column)
            .unwrap_or(generated_column.saturating_add(1));
        let frame = DebugStackFrame {
            frame_id,
            name,
            file_path,
            line_number,
            column,
        };
        let frame_bytes = serde_json::to_vec(&frame)
            .map_err(|error| format!("Unable to encode a debug stack frame: {error}"))?
            .len()
            + usize::from(!inventory.frames.is_empty());
        if aggregate_frame_bytes.saturating_add(frame_bytes) > MAX_CDP_STACK_FRAME_EVENT_BYTES {
            inventory.frames_truncated = true;
            break;
        }
        aggregate_frame_bytes += frame_bytes;
        inventory.frames.push(frame);
        inventory
            .call_frame_ids
            .insert(frame_id, call_frame_id.to_string());
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
            let owned = ObjectReference {
                frame_id,
                object_id: object_id.to_string(),
                pause_generation: inventory.pause_generation,
                evaluate_name: None,
                access: ObjectReferenceAccess::ScopeRoot,
                mutation: scope_mutation(Some(call_frame_id), scope_number, scope_type),
                lineage: None,
            };
            if try_reserve_object_reference_bytes(&mut inventory, &owned).is_err() {
                break;
            }
            inventory.object_ids.insert(reference, owned);
            scopes.push(DebugScopeInfo {
                name: super::scope::display_name(scope_type),
                variables_reference: reference,
                expensive: scope_type == "global",
            });
        }
        inventory.scopes.insert(frame_id, scopes);
    }
    inventory.frames_truncated |= inventory.frames.len() < call_frames.len();
    Ok(inventory)
}

pub(crate) fn prepare_pause_source_mappings(params: &Value, context: &SocketLoopContext) -> Value {
    const SOURCE_MAP_PAUSE_WAIT: Duration = Duration::from_millis(500);

    let mut prepared = bounded_pause_params(params);
    let collect = |source_maps: &crate::debug_source_map::SourceMapRegistry| {
        let mut pending = Vec::new();
        let mut pending_keys = std::collections::HashSet::new();
        let candidates = prepared
            .get("callFrames")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|frame| {
                let line = u32::try_from(frame.pointer("/location/lineNumber")?.as_u64()?).ok()?;
                let column = u32::try_from(
                    frame
                        .pointer("/location/columnNumber")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                )
                .ok()?;
                let script_id = frame.pointer("/location/scriptId").and_then(Value::as_str);
                let url = frame
                    .get("url")
                    .and_then(Value::as_str)
                    .filter(|url| !url.is_empty())
                    .or_else(|| {
                        script_id
                            .and_then(|script_id| source_maps.generated_url_for_script(script_id))
                    })?;
                let candidate = match script_id {
                    Some(script_id) => {
                        source_maps.map_generated_candidate_for_script(script_id, url, line, column)
                    }
                    None => source_maps.map_generated_candidate(url, line, column),
                };
                if candidate.is_none() {
                    if let Some(settlement) = script_id
                        .and_then(|script_id| source_maps.pending_settlement(script_id, url))
                    {
                        if pending_keys.insert(settlement.identity_key()) {
                            pending.push(settlement);
                        }
                    }
                }
                candidate
            })
            .collect::<Vec<_>>();
        (candidates, pending)
    };
    let (mut candidates, pending) = {
        let Ok(shared) = context.shared.lock() else {
            return prepared;
        };
        let Some(source_maps) = shared.source_maps.as_ref() else {
            if let Some(object) = prepared.as_object_mut() {
                object.insert("__codevoSourceMapsPrepared".to_string(), Value::Bool(true));
            }
            return prepared;
        };
        collect(source_maps)
    };
    if !pending.is_empty() {
        let deadline = Instant::now() + SOURCE_MAP_PAUSE_WAIT;
        for settlement in pending {
            if !settlement.wait_until(deadline) {
                break;
            }
        }
        if let Ok(shared) = context.shared.lock() {
            if let Some(source_maps) = shared.source_maps.as_ref() {
                candidates = collect(source_maps).0;
            }
        }
    }
    let validated = candidates
        .into_iter()
        .map(|candidate| candidate.and_then(|candidate| candidate.validate_with_receipt()))
        .collect::<Vec<_>>();
    let current = {
        let Ok(shared) = context.shared.lock() else {
            return prepared;
        };
        validated
            .iter()
            .map(|validated| {
                validated.as_ref().is_some_and(|validated| {
                    shared.source_maps.as_ref().is_some_and(|source_maps| {
                        source_maps.is_current_receipt(&validated.receipt)
                    })
                })
            })
            .collect::<Vec<_>>()
    };
    if let Some(frames) = prepared.get_mut("callFrames").and_then(Value::as_array_mut) {
        for ((frame, validated), is_current) in frames.iter_mut().zip(validated).zip(current) {
            if !is_current {
                continue;
            }
            let Some(validated) = validated else {
                continue;
            };
            let location = validated.location;
            if let Some(frame) = frame.as_object_mut() {
                frame.insert(
                    "__codevoOriginalLocation".to_string(),
                    json!({
                        "filePath": location.file_path,
                        "lineNumber": location.line_number,
                        "column": location.column,
                    }),
                );
            }
        }
    }
    if let Some(object) = prepared.as_object_mut() {
        object.insert("__codevoSourceMapsPrepared".to_string(), Value::Bool(true));
    }
    prepared
}

fn bounded_pause_params(params: &Value) -> Value {
    let Some(object) = params.as_object() else {
        return params.clone();
    };
    let mut bounded = serde_json::Map::with_capacity(object.len());
    for (key, value) in object {
        if key == "callFrames" {
            let frames = value
                .as_array()
                .map(|frames| {
                    frames
                        .iter()
                        .take(MAX_CDP_STACK_FRAMES.saturating_add(1))
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .map(Value::Array)
                .unwrap_or_else(|| value.clone());
            bounded.insert(key.clone(), frames);
        } else {
            bounded.insert(key.clone(), value.clone());
        }
    }
    Value::Object(bounded)
}

fn decode_prepared_source_location(
    value: &Value,
) -> Option<crate::debug_source_map::MappedSourceLocation> {
    Some(crate::debug_source_map::MappedSourceLocation {
        file_path: value.get("filePath")?.as_str()?.to_string(),
        line_number: u32::try_from(value.get("lineNumber")?.as_u64()?).ok()?,
        column: u32::try_from(value.get("column")?.as_u64()?).ok()?,
    })
}

fn bounded_stack_frame_name(value: &str, maximum_bytes: usize) -> (String, bool) {
    const SUFFIX: &str = "…";
    let mut bounded = String::with_capacity(value.len().min(maximum_bytes));
    let mut changed = false;
    for character in value.chars() {
        let character = if character.is_control() {
            changed = true;
            ' '
        } else {
            character
        };
        if bounded.len().saturating_add(character.len_utf8()) > maximum_bytes {
            let maximum_prefix = maximum_bytes.saturating_sub(SUFFIX.len());
            while bounded.len() > maximum_prefix {
                bounded.pop();
            }
            if maximum_bytes >= SUFFIX.len() {
                bounded.push_str(SUFFIX);
            }
            changed = true;
            break;
        }
        bounded.push(character);
    }
    if bounded.trim().is_empty() {
        return ("(anonymous)".to_string(), true);
    }
    (bounded, changed)
}

#[cfg(test)]
mod bounded_pause_projection_tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn call_frame(index: usize, name: &str, url: &str) -> Value {
        json!({
            "callFrameId": format!("frame-{index}"),
            "functionName": name,
            "url": url,
            "location": {"lineNumber": index, "columnNumber": 0},
            "scopeChain": []
        })
    }

    #[test]
    fn fifty_thousand_frame_pause_retains_only_the_bounded_inspectable_prefix() {
        let params = json!({
            "callFrames": (0..50_000)
                .map(|index| call_frame(index, "work", "file:///workspace/app.js"))
                .collect::<Vec<_>>()
        });
        let mut shared = CdpShared::new(None);

        let inventory = build_pause_inventory(&params, &mut shared).expect("bounded pause");

        assert!(inventory.frames_truncated);
        assert_eq!(inventory.frames.len(), MAX_CDP_STACK_FRAMES);
        assert_eq!(inventory.call_frame_ids.len(), MAX_CDP_STACK_FRAMES);
        assert_eq!(inventory.scopes.len(), MAX_CDP_STACK_FRAMES);
        assert!(!inventory
            .call_frame_ids
            .values()
            .any(|call_frame_id| call_frame_id == "frame-256"));
        assert!(
            serde_json::to_vec(&inventory.frames)
                .expect("stack projection JSON")
                .len()
                <= MAX_CDP_STACK_FRAME_EVENT_BYTES
        );
    }

    #[test]
    fn source_map_preprocessing_clones_only_the_bounded_visible_prefix() {
        let params = json!({
            "reason": "other",
            "callFrames": (0..50_000)
                .map(|index| call_frame(
                    index,
                    "work",
                    "file:///workspace/app.js"
                ))
                .collect::<Vec<_>>()
        });

        let bounded = bounded_pause_params(&params);
        let frames = bounded
            .get("callFrames")
            .and_then(Value::as_array)
            .expect("bounded frames");

        assert_eq!(frames.len(), MAX_CDP_STACK_FRAMES + 1);
        assert_eq!(bounded.get("reason"), Some(&Value::String("other".into())));
    }

    #[test]
    fn former_delivery_boundary_inputs_have_the_same_bounded_deliverable_shape() {
        for frame_count in [2_962, 2_963] {
            let params = json!({
                "callFrames": (0..frame_count)
                    .map(|index| call_frame(index, "f", "file:///w/a.js"))
                    .collect::<Vec<_>>()
            });
            let mut shared = CdpShared::new(None);

            let inventory = build_pause_inventory(&params, &mut shared).expect("bounded pause");
            let payload = DebugEventPayload::Stopped {
                reason: DebugStopReason::Breakpoint,
                frames: inventory.frames,
                pause_generation: inventory.pause_generation,
                frames_truncated: inventory.frames_truncated,
            };

            assert!(matches!(
                &payload,
                DebugEventPayload::Stopped {
                    frames,
                    frames_truncated: true,
                    ..
                } if frames.len() == MAX_CDP_STACK_FRAMES
            ));
            assert!(payload_bytes_for_test(&payload) < 221_184);
        }
    }

    #[test]
    fn oversized_frame_text_is_bounded_and_truthfully_marked() {
        let params = json!({
            "callFrames": [
                call_frame(
                    0,
                    &"ž".repeat(MAX_CDP_STACK_FRAME_NAME_BYTES),
                    &format!("file:///{}", "x".repeat(MAX_CDP_STACK_FRAME_PATH_BYTES))
                )
            ]
        });
        let mut shared = CdpShared::new(None);

        let inventory = build_pause_inventory(&params, &mut shared).expect("bounded pause");

        assert!(inventory.frames_truncated);
        assert_eq!(inventory.frames.len(), 1);
        assert!(inventory.frames[0].name.len() <= MAX_CDP_STACK_FRAME_NAME_BYTES);
        assert!(inventory.frames[0].name.ends_with('…'));
        assert_eq!(inventory.frames[0].file_path, None);
    }

    #[test]
    fn control_bearing_frame_text_is_sanitized_before_crossing_the_wire() {
        let params = json!({
            "callFrames": [
                call_frame(0, "bad\nname", "file:///workspace/good.js"),
                call_frame(1, "path", "file:///workspace/bad\npath.js")
            ]
        });
        let mut shared = CdpShared::new(None);

        let inventory = build_pause_inventory(&params, &mut shared).expect("bounded pause");

        assert!(inventory.frames_truncated);
        assert_eq!(inventory.frames.len(), 2);
        assert_eq!(inventory.frames[0].name, "bad name");
        assert!(!inventory.frames[0].name.chars().any(char::is_control));
        assert_eq!(inventory.frames[1].file_path, None);
    }

    #[test]
    fn qa_large_pause_with_empty_cdp_urls_does_not_claim_stack_truncation() {
        let params = json!({
            "callFrames": (0..10)
                .map(|index| call_frame(
                    index,
                    if index == 0 { "run" } else { "" },
                    ""
                ))
                .collect::<Vec<_>>()
        });
        let mut shared = CdpShared::new(None);

        let inventory = build_pause_inventory(&params, &mut shared).expect("qa-large Node pause");

        assert_eq!(inventory.frames.len(), 10);
        assert!(!inventory.frames_truncated);
        assert!(inventory.frames.iter().all(|frame| {
            !frame.name.is_empty()
                && !frame.name.chars().any(char::is_control)
                && frame.line_number > 0
                && frame.column > 0
                && frame.file_path.is_none()
        }));
        assert_eq!(inventory.call_frame_ids.len(), 10);
        assert_eq!(inventory.scopes.len(), 10);
    }

    #[test]
    fn aggregate_frame_budget_keeps_the_stopped_event_deliverable() {
        let params = json!({
            "callFrames": (0..MAX_CDP_STACK_FRAMES)
                .map(|index| call_frame(
                    index,
                    &"n".repeat(MAX_CDP_STACK_FRAME_NAME_BYTES),
                    &format!("file:///workspace/{}.js", "p".repeat(3_000))
                ))
                .collect::<Vec<_>>()
        });
        let mut shared = CdpShared::new(None);

        let inventory = build_pause_inventory(&params, &mut shared).expect("bounded pause");
        let payload = DebugEventPayload::Stopped {
            reason: DebugStopReason::Breakpoint,
            frames: inventory.frames,
            pause_generation: inventory.pause_generation,
            frames_truncated: inventory.frames_truncated,
        };
        let encoded = serde_json::to_vec(&payload).expect("stopped payload JSON");

        assert!(payload_bytes_for_test(&payload) < 221_184);
        assert!(encoded.len() < 221_184);
        assert!(matches!(
            payload,
            DebugEventPayload::Stopped {
                frames_truncated: true,
                ..
            }
        ));
    }

    #[test]
    fn pause_projection_uses_exact_script_identity_for_same_url_source_maps() {
        let fixture = source_map_fixture();
        let mut shared = CdpShared::new(Some(fixture.registry));
        let params = json!({
            "callFrames": [{
                "callFrameId": "frame-a",
                "functionName": "oldScript",
                "url": fixture.generated_url,
                "location": {"scriptId": "A", "lineNumber": 0, "columnNumber": 0},
                "scopeChain": []
            }]
        });

        let inventory = build_pause_inventory(&params, &mut shared).expect("exact pause mapping");

        assert_eq!(inventory.frames.len(), 1);
        assert_eq!(
            inventory.frames[0].file_path.as_deref(),
            Some(fixture.source_a.to_string_lossy().as_ref())
        );
        assert_eq!(inventory.frames[0].line_number, 1);
        let _ = fs::remove_dir_all(fixture.root);
    }

    #[test]
    fn present_unknown_script_identity_never_falls_back_to_same_url_mapping() {
        let fixture = source_map_fixture();
        let mut shared = CdpShared::new(Some(fixture.registry));
        let params = json!({
            "callFrames": [{
                "callFrameId": "frame-unknown",
                "functionName": "unknownScript",
                "url": fixture.generated_url,
                "location": {"scriptId": "unknown", "lineNumber": 0, "columnNumber": 0},
                "scopeChain": []
            }]
        });

        let inventory = build_pause_inventory(&params, &mut shared).expect("unmapped exact pause");

        assert_eq!(inventory.frames.len(), 1);
        assert_eq!(
            inventory.frames[0].file_path.as_deref(),
            Some(fixture.generated.to_string_lossy().as_ref())
        );
        assert_ne!(
            inventory.frames[0].file_path.as_deref(),
            Some(fixture.source_b.to_string_lossy().as_ref())
        );
        let _ = fs::remove_dir_all(fixture.root);
    }

    #[test]
    fn smart_step_dispatch_revalidates_the_exact_map_receipt_at_commit_time() {
        let fixture = source_map_fixture();
        let generated_url = fixture.generated_url.clone();
        let receipt =
            match fixture
                .registry
                .classify_generated_for_script("A", &generated_url, 1, 0)
            {
                crate::debug_source_map::GeneratedSourceMapClassification::LoadedButUnmapped(
                    receipt,
                ) => receipt,
                _ => panic!("expected an exact loaded-but-unmapped receipt"),
            };
        let mut shared = CdpShared::new(Some(fixture.registry));
        shared.smart_step_dispatch_lease = shared
            .source_maps
            .as_ref()
            .and_then(|maps| maps.pin_dispatch(&receipt));
        shared.smart_step_fallback = Some(json!({"reason": "step"}));
        shared
            .source_maps
            .as_mut()
            .expect("source maps")
            .evict_exact_script("A", &generated_url);

        assert!(validate_smart_step_dispatch(&mut shared).is_err());
        assert!(shared.smart_step_dispatch_lease.is_none());
        assert!(shared.smart_step_fallback.is_none());
        let _ = fs::remove_dir_all(fixture.root);
    }

    #[test]
    fn committed_smart_step_pin_defers_exact_map_removal_through_dispatch() {
        let fixture = source_map_fixture();
        let generated_url = fixture.generated_url.clone();
        let receipt =
            match fixture
                .registry
                .classify_generated_for_script("A", &generated_url, 1, 0)
            {
                crate::debug_source_map::GeneratedSourceMapClassification::LoadedButUnmapped(
                    receipt,
                ) => receipt,
                _ => panic!("expected an exact loaded-but-unmapped receipt"),
            };
        let mut shared = CdpShared::new(Some(fixture.registry));
        shared.smart_step_dispatch_lease = shared
            .source_maps
            .as_ref()
            .and_then(|maps| maps.pin_dispatch(&receipt));
        let lease = validate_smart_step_dispatch(&mut shared)
            .expect("commit-time validation")
            .expect("dispatch lease");

        let maps = shared.source_maps.as_mut().expect("source maps");
        maps.evict_exact_script("A", &generated_url);
        assert!(matches!(
            maps.classify_generated_for_script("A", &generated_url, 1, 0),
            crate::debug_source_map::GeneratedSourceMapClassification::Unknown
        ));
        assert!(maps.map_generated(&generated_url, 1, 0).is_none());
        maps.release_dispatch(lease);
        assert!(matches!(
            maps.classify_generated_for_script("A", &generated_url, 1, 0),
            crate::debug_source_map::GeneratedSourceMapClassification::Unknown
        ));
        let _ = fs::remove_dir_all(fixture.root);
    }

    fn payload_bytes_for_test(payload: &DebugEventPayload) -> usize {
        serde_json::to_vec(payload).expect("payload JSON").len()
    }

    struct SourceMapFixture {
        generated: std::path::PathBuf,
        generated_url: String,
        registry: SourceMapRegistry,
        root: std::path::PathBuf,
        source_a: std::path::PathBuf,
        source_b: std::path::PathBuf,
    }

    fn source_map_fixture() -> SourceMapFixture {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "codevo-bounded-pause-source-map-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("fixture root");
        let root = fs::canonicalize(root).expect("canonical fixture root");
        let dist = root.join("dist");
        let src = root.join("src");
        fs::create_dir_all(&dist).expect("dist");
        fs::create_dir_all(&src).expect("src");
        let generated = dist.join("app.js");
        let source_a = src.join("a.ts");
        let source_b = src.join("b.ts");
        fs::write(&generated, "compiled();\n").expect("generated");
        fs::write(&source_a, "sourceA();\n").expect("source A");
        fs::write(&source_b, "sourceB();\n").expect("source B");
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        for (script_id, source) in [("A", "a.ts"), ("B", "b.ts")] {
            let map = dist.join(format!("{script_id}.map"));
            fs::write(
                &map,
                format!(
                    r#"{{"version":3,"file":"app.js","sources":["../src/{source}"],"names":[],"mappings":"AAAA"}}"#
                ),
            )
            .expect("source map");
            let prepared = loader
                .prepare_script(
                    script_id,
                    &generated_url,
                    &file_url_from_path(&map.to_string_lossy()),
                )
                .expect("prepare source map");
            registry.commit_script(prepared).expect("commit source map");
        }
        SourceMapFixture {
            generated,
            generated_url,
            registry,
            root,
            source_a,
            source_b,
        }
    }
}
