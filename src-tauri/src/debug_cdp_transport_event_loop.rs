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

pub(crate) fn fail_closed_socket_loop(context: &SocketLoopContext) {
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
        if let Some((diagnostic, reason, frames, pause_generation)) = fallback_event {
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
                truncated: false,
            });
        }
        if let Some((diagnostic, reason, frames, pause_generation)) = fallback_event {
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
