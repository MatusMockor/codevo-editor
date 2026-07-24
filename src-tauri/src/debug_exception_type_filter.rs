use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::Instant;

use crate::debug_adapter::{DebugEventPayload, DebugOutputStream};
use crate::debug_cdp::transport::{
    advance_logpoint, build_pause_inventory, emit_debug_event, fail_closed_exception_timeout,
    fallback_from_internal_action, install_visible_pause, invalidate_pause,
    schedule_explicit_pause, stop_reason, InternalResponse, PendingInternalAction,
    PendingInternalResume, PendingLogpoint, PendingLogpointPhase, SocketLoopContext,
    TransportBreakpointPauseDecision as BreakpointPauseDecision,
};

pub(crate) const MAX_EXCEPTION_TYPE_FILTER_COUNT: usize = 8;
const MAX_EXCEPTION_TYPE_NAME_BYTES: usize = 256;
const MAX_EXCEPTION_TYPE_DEPTH: usize = 8;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct DebugExceptionTypeFilter(Vec<String>);

impl DebugExceptionTypeFilter {
    pub(crate) fn parse(names: Vec<String>) -> Result<Self, String> {
        if names.len() > MAX_EXCEPTION_TYPE_FILTER_COUNT {
            return Err("Exception type filter has too many entries.".to_string());
        }
        let mut seen = HashSet::new();
        for name in &names {
            validate_name(name)?;
            if !seen.insert(name) {
                return Err("Exception type filter entries must be unique.".to_string());
            }
        }
        Ok(Self(names))
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn matches_class_names<'a>(&self, names: impl IntoIterator<Item = &'a str>) -> bool {
        names.into_iter().any(|name| {
            self.0
                .iter()
                .filter_map(|entry| entry.rsplit('.').next())
                .any(|candidate| candidate == name)
        })
    }
}

pub(crate) fn valid_class_name(name: &str) -> bool {
    validate_name(name).is_ok() && !name.contains('.')
}

pub(crate) fn classification_request(request_id: u64, object_id: &str) -> String {
    let function_declaration = [
        "function(){let v=this;for(let i=0;i<",
        &MAX_EXCEPTION_TYPE_DEPTH.to_string(),
        "&&v!==null;i++){const c=Object.getOwnPropertyDescriptor(v,'constructor');if(c&&c.value&&typeof c.value.name==='string'&&c.value.name)return c.value.name;v=Object.getPrototypeOf(v)}return null}",
    ]
    .concat();
    json!({
        "id": request_id,
        "method": "Runtime.callFunctionOn",
        "params": {
            "objectId": object_id,
            "functionDeclaration": function_declaration,
            "silent": true,
            "returnByValue": true,
            "awaitPromise": false,
            "throwOnSideEffect": true
        }
    })
    .to_string()
}

pub(crate) fn resolved_class_name(message: &Value) -> Option<&str> {
    if message.get("error").is_some() || message.pointer("/result/exceptionDetails").is_some() {
        return None;
    }
    let name = message.pointer("/result/result/value")?.as_str()?;
    if !valid_class_name(name) {
        return None;
    }
    Some(name)
}

#[derive(Debug, Eq, PartialEq)]
enum PauseFilterDecision<'a> {
    Visible,
    Resume,
    Classify(&'a str),
}

fn direct_pause_decision<'a>(
    filter: &DebugExceptionTypeFilter,
    params: &'a Value,
) -> PauseFilterDecision<'a> {
    let reason = params.get("reason").and_then(Value::as_str);
    if !matches!(reason, Some("exception" | "promiseRejection")) || filter.is_empty() {
        return PauseFilterDecision::Visible;
    }
    if params
        .get("hitBreakpoints")
        .and_then(Value::as_array)
        .is_some_and(|hits| !hits.is_empty())
    {
        return PauseFilterDecision::Visible;
    }
    if let Some(class_name) = params.pointer("/data/className") {
        let Some(class_name) = class_name.as_str() else {
            return PauseFilterDecision::Visible;
        };
        if !valid_class_name(class_name) {
            return PauseFilterDecision::Visible;
        }
        if filter.matches_class_names([class_name]) {
            return PauseFilterDecision::Visible;
        }
        return PauseFilterDecision::Resume;
    }
    let Some(object_id) = params.pointer("/data/objectId").and_then(Value::as_str) else {
        return PauseFilterDecision::Visible;
    };
    if object_id.is_empty() || object_id.len() > 1_024 {
        return PauseFilterDecision::Visible;
    }
    PauseFilterDecision::Classify(object_id)
}

fn fallback_pause_decision(
    filter: &DebugExceptionTypeFilter,
    message: &Value,
) -> PauseFilterDecision<'static> {
    let Some(class_name) = resolved_class_name(message) else {
        return PauseFilterDecision::Visible;
    };
    if filter.matches_class_names([class_name]) {
        return PauseFilterDecision::Visible;
    }
    PauseFilterDecision::Resume
}

fn is_exception_pause(params: &Value) -> bool {
    matches!(
        params.get("reason").and_then(Value::as_str),
        Some("exception" | "promiseRejection")
    )
}

fn only_ignored_startup_breakpoint(params: &Value, ignored: Option<&str>) -> bool {
    let Some(ignored) = ignored else {
        return false;
    };
    let Some(hits) = params.get("hitBreakpoints").and_then(Value::as_array) else {
        return false;
    };
    !hits.is_empty()
        && hits
            .iter()
            .all(|hit| hit.as_str().is_some_and(|hit| hit == ignored))
}

pub(crate) struct PendingExceptionClassification {
    pub(crate) deadline: Instant,
    filter_revision: u64,
    phase: PendingExceptionPhase,
    params: Value,
    request_id: u64,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum PendingExceptionPhase {
    Classify,
    Resume,
}

#[derive(Debug, Eq, PartialEq)]
enum ExceptionTimeoutDecision {
    Visible,
    FailClosed,
}

fn timeout_decision(phase: PendingExceptionPhase) -> ExceptionTimeoutDecision {
    match phase {
        PendingExceptionPhase::Classify => ExceptionTimeoutDecision::Visible,
        PendingExceptionPhase::Resume => ExceptionTimeoutDecision::FailClosed,
    }
}

#[derive(Default)]
pub(crate) struct ExceptionFilterState {
    pub(crate) active: DebugExceptionTypeFilter,
    pub(crate) pending: Option<PendingExceptionClassification>,
    pub(crate) revision: u64,
    pub(crate) startup_breakpoint_to_ignore: Option<String>,
}

impl ExceptionFilterState {
    pub(crate) fn begin_policy_update(&mut self) {
        self.active = DebugExceptionTypeFilter::default();
        self.revision = self.revision.wrapping_add(1);
    }

    pub(crate) fn finish_policy_update(&mut self, filter: DebugExceptionTypeFilter) {
        self.active = filter;
        self.revision = self.revision.wrapping_add(1);
    }
}

pub(crate) fn handle_paused(params: &Value, context: &SocketLoopContext) -> Option<String> {
    if !(context.mutation_is_allowed)() {
        return None;
    }
    if !is_exception_pause(params) {
        return handle_visible_pause(params, context);
    }
    let Ok(mut state) = context.exception_filter.lock() else {
        return handle_filtered_exception_pause(params, context);
    };
    let object_id = match direct_pause_decision(&state.active, params) {
        PauseFilterDecision::Visible => {
            drop(state);
            return handle_filtered_exception_pause(params, context);
        }
        PauseFilterDecision::Resume => {
            drop(state);
            return resume_hidden_exception(params, context);
        }
        PauseFilterDecision::Classify(object_id) => object_id,
    };
    let request_id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
    state.pending = Some(PendingExceptionClassification {
        deadline: Instant::now() + context.request_timeout,
        filter_revision: state.revision,
        phase: PendingExceptionPhase::Classify,
        params: params.clone(),
        request_id,
    });
    drop(state);
    complete_startup_for_early_exception(context);
    Some(classification_request(request_id, object_id))
}

pub(crate) fn handle_response(
    id: u64,
    message: &Value,
    context: &SocketLoopContext,
) -> Option<InternalResponse> {
    let phase = context
        .exception_filter
        .lock()
        .ok()?
        .pending
        .as_ref()
        .filter(|pending| pending.request_id == id)
        .map(|pending| pending.phase)?;
    if !(context.mutation_is_allowed)() {
        return Some(InternalResponse::Handled(None));
    }
    if phase == PendingExceptionPhase::Resume {
        if message.get("error").is_none() {
            let mut state = context.exception_filter.lock().ok()?;
            if state.pending.as_ref().is_none_or(|pending| {
                pending.request_id != id || pending.phase != PendingExceptionPhase::Resume
            }) {
                return None;
            }
            state.pending.take()?;
            return Some(InternalResponse::Handled(None));
        }
        let pending = context.exception_filter.lock().ok()?.pending.take()?;
        if let Ok(mut shared) = context.shared.lock() {
            shared.suppress_next_resumed = false;
        }
        return Some(InternalResponse::Handled(handle_filtered_exception_pause(
            &pending.params,
            context,
        )));
    }
    let pending = {
        let Ok(mut state) = context.exception_filter.lock() else {
            return None;
        };
        if state
            .pending
            .as_ref()
            .is_none_or(|pending| pending.request_id != id)
        {
            return None;
        }
        state.pending.take()?
    };
    let decision = {
        let Ok(state) = context.exception_filter.lock() else {
            return Some(InternalResponse::Handled(handle_filtered_exception_pause(
                &pending.params,
                context,
            )));
        };
        if state.revision != pending.filter_revision {
            PauseFilterDecision::Visible
        } else {
            fallback_pause_decision(&state.active, message)
        }
    };
    let reply = match decision {
        PauseFilterDecision::Resume => resume_hidden_exception(&pending.params, context),
        PauseFilterDecision::Visible | PauseFilterDecision::Classify(_) => {
            handle_filtered_exception_pause(&pending.params, context)
        }
    };
    Some(InternalResponse::Handled(reply))
}

pub(crate) fn handle_timeout(context: &SocketLoopContext) -> Option<String> {
    if !(context.mutation_is_allowed)() {
        return None;
    }
    let pending = {
        let Ok(mut state) = context.exception_filter.lock() else {
            return None;
        };
        if state
            .pending
            .as_ref()
            .is_none_or(|pending| pending.deadline > Instant::now())
        {
            return None;
        }
        state.pending.take()
    };
    let pending = pending?;
    match timeout_decision(pending.phase) {
        ExceptionTimeoutDecision::Visible => {
            handle_filtered_exception_pause(&pending.params, context);
            None
        }
        ExceptionTimeoutDecision::FailClosed => {
            fail_closed_exception_timeout(context);
            None
        }
    }
}

pub(crate) fn handle_resumed(context: &SocketLoopContext) -> Option<String> {
    if !(context.mutation_is_allowed)() {
        return None;
    }
    let pending_exception = context
        .exception_filter
        .lock()
        .ok()
        .and_then(|mut state| state.pending.take())
        .is_some();
    let (should_emit, request) = {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        invalidate_pause(&mut shared);
        let internal_resume =
            pending_exception || shared.internal_action.is_some() || shared.suppress_next_resumed;
        let recovery = shared
            .internal_action
            .take()
            .map(fallback_from_internal_action);
        let should_emit = !pending_exception && !shared.suppress_next_resumed;
        shared.suppress_next_resumed = false;
        let request = if let Some(pending) = shared.pending_explicit_pause.as_mut() {
            pending.resume_confirmed = true;
            None
        } else if internal_resume && shared.explicit_pause_requested {
            schedule_explicit_pause(&mut shared, context, recovery, true)
        } else {
            None
        };
        (should_emit, request)
    };
    if should_emit {
        emit_debug_event(context, DebugEventPayload::Resumed);
    }
    request
}

fn resume_hidden_exception(params: &Value, context: &SocketLoopContext) -> Option<String> {
    if !(context.mutation_is_allowed)() {
        return None;
    }
    let request_id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
    {
        let Ok(mut state) = context.exception_filter.lock() else {
            return None;
        };
        state.pending = Some(PendingExceptionClassification {
            deadline: Instant::now() + context.request_timeout,
            filter_revision: state.revision,
            phase: PendingExceptionPhase::Resume,
            params: params.clone(),
            request_id,
        });
    }
    let Ok(mut shared) = context.shared.lock() else {
        return None;
    };
    shared.suppress_next_resumed = true;
    drop(shared);
    complete_startup_for_early_exception(context);
    Some(json!({"id": request_id, "method": "Debugger.resume", "params": {}}).to_string())
}

fn handle_filtered_exception_pause(params: &Value, context: &SocketLoopContext) -> Option<String> {
    let (frames, pause_generation, reason) = {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        if std::mem::take(&mut shared.explicit_pause_requested) {
            shared.pending_explicit_pause = None;
            shared.suppress_next_resumed = false;
        }
        let Ok(pause) = install_visible_pause(params, &mut shared) else {
            return None;
        };
        pause
    };
    emit_debug_event(
        context,
        DebugEventPayload::Stopped {
            reason,
            frames,
            pause_generation,
        },
    );
    complete_startup_for_early_exception(context);
    None
}

fn complete_startup_for_early_exception(context: &SocketLoopContext) {
    let validation = context
        .shared
        .lock()
        .ok()
        .and_then(|mut shared| shared.startup_validation.take());
    if let Some(validation) = validation {
        context
            .exception_filter
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .startup_breakpoint_to_ignore = Some(validation.breakpoint_id().to_string());
        validation.complete_early_exception();
    }
}

fn handle_visible_pause(params: &Value, context: &SocketLoopContext) -> Option<String> {
    let reason_text = params
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let hit_user_breakpoint = params
        .get("hitBreakpoints")
        .and_then(Value::as_array)
        .is_some_and(|hits| !hits.is_empty());
    let ignored_startup_breakpoint = context
        .exception_filter
        .lock()
        .ok()
        .and_then(|shared| shared.startup_breakpoint_to_ignore.clone());
    if only_ignored_startup_breakpoint(params, ignored_startup_breakpoint.as_deref()) {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        shared.suppress_next_resumed = true;
        let id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
        return Some(json!({"id": id, "method": "Debugger.resume", "params": {}}).to_string());
    }
    let initial_entry_match = context
        .shared
        .lock()
        .ok()
        .and_then(|shared| {
            shared
                .startup_validation
                .as_ref()
                .map(|validation| validation.matches_pause(params))
        })
        .unwrap_or(false);
    {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        if !shared.first_pause_seen {
            shared.first_pause_seen = true;
            if initial_entry_match {
                if let Some(validation) = shared.startup_validation.take() {
                    validation.complete(true);
                }
                shared.suppress_next_resumed = true;
                let id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
                return Some(
                    json!({"id": id, "method": "Debugger.resume", "params": {}}).to_string(),
                );
            }
            let is_entry_pause =
                !hit_user_breakpoint && matches!(reason_text, "other" | "Break on start");
            if is_entry_pause {
                shared.suppress_next_resumed = true;
                let id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
                return Some(
                    json!({"id": id, "method": "Debugger.resume", "params": {}}).to_string(),
                );
            }
        }
    }
    let startup_validation = context
        .shared
        .lock()
        .ok()
        .and_then(|mut shared| shared.startup_validation.take());
    if let Some(validation) = startup_validation {
        let accepted = validation.matches_pause(params);
        validation.complete(accepted);
        if let Ok(mut shared) = context.shared.lock() {
            shared.suppress_next_resumed = true;
        }
        let id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
        return Some(json!({"id": id, "method": "Debugger.resume", "params": {}}).to_string());
    }
    let explicit_pause_requested = context
        .shared
        .lock()
        .map(|mut shared| {
            let requested = std::mem::take(&mut shared.explicit_pause_requested);
            if requested {
                shared.pending_explicit_pause = None;
                shared.suppress_next_resumed = false;
            }
            requested
        })
        .unwrap_or(false);
    if hit_user_breakpoint {
        let decision = {
            let Ok(mut shared) = context.shared.lock() else {
                return None;
            };
            let hit_ids = params
                .get("hitBreakpoints")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str);
            shared.breakpoint_hits.record_pause(hit_ids)
        };
        let can_run_internal = !explicit_pause_requested
            && !matches!(reason_text, "step" | "exception" | "promiseRejection");
        if can_run_internal && decision == BreakpointPauseDecision::AutoResume {
            let reason = stop_reason(reason_text);
            let Ok(mut shared) = context.shared.lock() else {
                return None;
            };
            let Ok(inventory) = build_pause_inventory(params, &mut shared) else {
                return None;
            };
            shared.suppress_next_resumed = true;
            let request_id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
            shared.internal_action = Some(PendingInternalAction::Resume(PendingInternalResume {
                deadline: Instant::now() + context.request_timeout,
                inventory,
                reason,
                request_id,
            }));
            return Some(
                json!({"id": request_id, "method": "Debugger.resume", "params": {}}).to_string(),
            );
        }
        if can_run_internal {
            if let BreakpointPauseDecision::Log(templates) = decision {
                let reason = stop_reason(reason_text);
                let prepared = {
                    let Ok(mut shared) = context.shared.lock() else {
                        return None;
                    };
                    let Ok(inventory) = build_pause_inventory(params, &mut shared) else {
                        return None;
                    };
                    let call_frame_id = inventory
                        .frames
                        .first()
                        .and_then(|frame| inventory.call_frame_ids.get(&frame.frame_id))
                        .cloned();
                    call_frame_id.map(|call_frame_id| {
                        let mut pending = PendingLogpoint {
                            call_frame_id,
                            current_output: String::new(),
                            deadline: Instant::now() + context.request_timeout,
                            inventory,
                            message_index: 0,
                            phase: PendingLogpointPhase::Evaluate,
                            reason,
                            request_id: 0,
                            segment_index: 0,
                            templates,
                        };
                        let advance = advance_logpoint(
                            &mut pending,
                            &context.next_request_id,
                            context.request_timeout,
                        );
                        shared.suppress_next_resumed = true;
                        shared.internal_action = Some(PendingInternalAction::Logpoint(pending));
                        advance
                    })
                };
                if let Some(advance) = prepared {
                    for text in advance.outputs {
                        emit_debug_event(
                            context,
                            DebugEventPayload::Output {
                                stream: DebugOutputStream::Stdout,
                                text,
                            },
                        );
                    }
                    return Some(advance.request);
                }
                emit_debug_event(
                    context,
                    DebugEventPayload::Output {
                        stream: DebugOutputStream::Stderr,
                        text: "[logpoint] No call frame is available for evaluation.\n".into(),
                    },
                );
            }
        }
    }
    let (frames, pause_generation, reason) = {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        let Ok(pause) = install_visible_pause(params, &mut shared) else {
            return None;
        };
        pause
    };
    emit_debug_event(
        context,
        DebugEventPayload::Stopped {
            reason,
            frames,
            pause_generation,
        },
    );
    None
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_EXCEPTION_TYPE_NAME_BYTES {
        return Err("Exception type filter entry is invalid.".to_string());
    }
    let segments = name.split('.').collect::<Vec<_>>();
    if segments.len() > MAX_EXCEPTION_TYPE_DEPTH {
        return Err("Exception type filter entry is invalid.".to_string());
    }
    if segments.iter().any(|segment| !valid_identifier(segment)) {
        return Err("Exception type filter entry is invalid.".to_string());
    }
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() && !matches!(first, '_' | '$') {
        return false;
    }
    characters.all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_is_bounded_and_uses_constructor_grammar() {
        assert!(DebugExceptionTypeFilter::parse(vec![
            "Error".to_string(),
            "node.errors.AbortError".to_string(),
        ])
        .is_ok());
        assert!(DebugExceptionTypeFilter::parse(vec!["1Error".to_string()]).is_err());
        assert!(DebugExceptionTypeFilter::parse(vec!["Error".to_string(); 9]).is_err());
        assert!(DebugExceptionTypeFilter::parse(vec!["Error".to_string(); 2]).is_err());
        assert!(DebugExceptionTypeFilter::parse(vec!["a.b.c.d.e.f.g.h.i".to_string()]).is_err());
    }

    #[test]
    fn dotted_filter_matches_final_constructor_segment_case_sensitively() {
        let filter =
            DebugExceptionTypeFilter::parse(vec!["app.TypeError".to_string()]).expect("filter");
        assert!(filter.matches_class_names(["TypeError", "Error"]));
        assert!(!filter.matches_class_names(["typeerror", "Error"]));
    }

    #[test]
    fn response_parser_fails_open_for_uncertain_results() {
        assert_eq!(
            resolved_class_name(&json!({
                "result": {"result": {"value": "TypeError"}}
            })),
            Some("TypeError")
        );
        assert!(resolved_class_name(&json!({
            "result": {
                "result": {"value": "TypeError"},
                "exceptionDetails": {}
            }
        }))
        .is_none());
        assert!(resolved_class_name(&json!({
            "result": {"result": {"value": 7}}
        }))
        .is_none());
    }

    #[test]
    fn classification_request_is_single_bounded_side_effect_free_call() {
        let request: Value =
            serde_json::from_str(&classification_request(7, "exception-object")).expect("request");
        assert_eq!(request.get("id"), Some(&json!(7)));
        assert_eq!(
            request.get("method"),
            Some(&json!("Runtime.callFunctionOn"))
        );
        assert_eq!(
            request.pointer("/params/objectId"),
            Some(&json!("exception-object"))
        );
        assert_eq!(
            request.pointer("/params/throwOnSideEffect"),
            Some(&json!(true))
        );
        assert_eq!(request.pointer("/params/returnByValue"), Some(&json!(true)));
        assert_eq!(request.pointer("/params/awaitPromise"), Some(&json!(false)));
        assert_eq!(request.pointer("/params/silent"), Some(&json!(true)));
        let declaration = request
            .pointer("/params/functionDeclaration")
            .and_then(Value::as_str)
            .expect("function");
        assert_eq!(
            declaration,
            "function(){let v=this;for(let i=0;i<8&&v!==null;i++){const c=Object.getOwnPropertyDescriptor(v,'constructor');if(c&&c.value&&typeof c.value.name==='string'&&c.value.name)return c.value.name;v=Object.getPrototypeOf(v)}return null}"
        );
        assert_eq!(declaration.matches("Object.getPrototypeOf").count(), 1);
    }

    #[test]
    fn direct_pause_decision_gates_without_runtime_evaluation_when_class_is_present() {
        let filter =
            DebugExceptionTypeFilter::parse(vec!["app.TypeError".to_string()]).expect("filter");
        assert_eq!(
            direct_pause_decision(
                &filter,
                &json!({"reason": "exception", "data": {"className": "TypeError"}})
            ),
            PauseFilterDecision::Visible
        );
        assert_eq!(
            direct_pause_decision(
                &filter,
                &json!({"reason": "promiseRejection", "data": {"className": "RangeError"}})
            ),
            PauseFilterDecision::Resume
        );
    }

    #[test]
    fn exception_at_user_breakpoint_is_visible_without_matching_or_classification() {
        let filter =
            DebugExceptionTypeFilter::parse(vec!["TypeError".to_string()]).expect("filter");
        assert_eq!(
            direct_pause_decision(
                &filter,
                &json!({
                    "reason": "exception",
                    "hitBreakpoints": ["user-breakpoint"],
                    "data": {"className": "RangeError"}
                })
            ),
            PauseFilterDecision::Visible
        );
        assert_eq!(
            direct_pause_decision(
                &filter,
                &json!({
                    "reason": "exception",
                    "hitBreakpoints": ["user-breakpoint"],
                    "data": {"objectId": "exception-object"}
                })
            ),
            PauseFilterDecision::Visible
        );
    }

    #[test]
    fn missing_class_uses_one_object_classification_or_stays_visible_when_uncertain() {
        let filter =
            DebugExceptionTypeFilter::parse(vec!["TypeError".to_string()]).expect("filter");
        let classified = json!({"reason": "exception", "data": {"objectId": "exception-object"}});
        assert_eq!(
            direct_pause_decision(&filter, &classified),
            PauseFilterDecision::Classify("exception-object")
        );
        assert_eq!(
            direct_pause_decision(&filter, &json!({"reason": "exception", "data": {}})),
            PauseFilterDecision::Visible
        );
        assert_eq!(
            direct_pause_decision(
                &filter,
                &json!({
                    "reason": "exception",
                    "data": {"className": 7, "objectId": "exception-object"}
                })
            ),
            PauseFilterDecision::Visible
        );
    }

    #[test]
    fn fallback_pause_decision_matches_resumes_and_fails_open() {
        let filter =
            DebugExceptionTypeFilter::parse(vec!["app.TypeError".to_string()]).expect("filter");
        assert_eq!(
            fallback_pause_decision(
                &filter,
                &json!({"result": {"result": {"value": "TypeError"}}})
            ),
            PauseFilterDecision::Visible
        );
        assert_eq!(
            fallback_pause_decision(
                &filter,
                &json!({"result": {"result": {"value": "RangeError"}}})
            ),
            PauseFilterDecision::Resume
        );
        assert_eq!(
            fallback_pause_decision(
                &filter,
                &json!({"result": {"exceptionDetails": {}, "result": {"value": "RangeError"}}})
            ),
            PauseFilterDecision::Visible
        );
        assert_eq!(
            fallback_pause_decision(&filter, &json!({"result": {"result": {"value": 7}}})),
            PauseFilterDecision::Visible
        );
    }

    #[test]
    fn policy_update_preserves_pending_work_and_invalid_input_changes_nothing() {
        let mut state = ExceptionFilterState {
            active: DebugExceptionTypeFilter::parse(vec!["Error".to_string()]).expect("filter"),
            pending: Some(PendingExceptionClassification {
                deadline: Instant::now(),
                filter_revision: 0,
                phase: PendingExceptionPhase::Classify,
                params: json!({"reason": "exception"}),
                request_id: 3,
            }),
            revision: 0,
            startup_breakpoint_to_ignore: None,
        };
        assert!(DebugExceptionTypeFilter::parse(vec!["not-valid!".to_string()]).is_err());
        assert_eq!(state.revision, 0);
        assert!(state.pending.is_some());
        state.begin_policy_update();
        assert_eq!(state.revision, 1);
        assert!(state.active.is_empty());
        assert_eq!(
            state.pending.as_ref().map(|pending| pending.request_id),
            Some(3)
        );
        state.finish_policy_update(
            DebugExceptionTypeFilter::parse(vec!["TypeError".to_string()]).expect("filter"),
        );
        assert_eq!(state.revision, 2);
        assert!(state.pending.is_some());
        assert!(state.active.matches_class_names(["TypeError"]));
    }

    #[test]
    fn classification_timeout_surfaces_pause_but_resume_timeout_fails_closed() {
        assert_eq!(
            timeout_decision(PendingExceptionPhase::Classify),
            ExceptionTimeoutDecision::Visible
        );
        assert_eq!(
            timeout_decision(PendingExceptionPhase::Resume),
            ExceptionTimeoutDecision::FailClosed
        );
    }

    #[test]
    fn early_exception_is_classified_as_exception_instead_of_startup_probe_traffic() {
        assert!(is_exception_pause(
            &json!({"reason": "exception", "data": {"className": "TypeError"}})
        ));
        assert!(is_exception_pause(
            &json!({"reason": "promiseRejection", "data": {"className": "TypeError"}})
        ));
        assert!(!is_exception_pause(&json!({"reason": "Break on start"})));
    }

    #[test]
    fn delayed_startup_probe_cleanup_is_hidden_without_swallowing_user_breakpoints() {
        let startup_only = json!({"hitBreakpoints": ["startup-probe"]});
        assert!(only_ignored_startup_breakpoint(
            &startup_only,
            Some("startup-probe")
        ));
        assert!(!only_ignored_startup_breakpoint(
            &json!({"hitBreakpoints": ["startup-probe", "user-breakpoint"]}),
            Some("startup-probe")
        ));
        assert!(!only_ignored_startup_breakpoint(
            &startup_only,
            Some("other-probe")
        ));
    }
}
