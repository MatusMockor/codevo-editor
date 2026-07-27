use super::{smart_step, CdpShared, SocketLoopContext};
use crate::debug_source_map::SourceMapDispatchLease;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Instant;

pub(super) fn commit_smart_step_dispatch(
    context: &SocketLoopContext,
) -> Option<Option<SourceMapDispatchLease>> {
    let outcome = {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        match validate_smart_step_dispatch(&mut shared) {
            Ok(lease) => return Some(lease),
            Err(fallback) => fallback,
        }
    };
    if let Some(params) = outcome {
        crate::debug_exception_type_filter::handle_visible_pause(&params, context);
    }
    None
}

pub(super) fn validate_smart_step_dispatch(
    shared: &mut CdpShared,
) -> Result<Option<SourceMapDispatchLease>, Option<Value>> {
    let Some(lease) = shared.smart_step_dispatch_lease.take() else {
        return Ok(None);
    };
    if shared
        .source_maps
        .as_ref()
        .is_some_and(|maps| maps.dispatch_lease_is_current(&lease))
    {
        return Ok(Some(lease));
    }
    if let Some(source_maps) = shared.source_maps.as_mut() {
        source_maps.release_dispatch(lease);
    }
    shared.smart_step_policy.cancel();
    Err(shared.smart_step_fallback.take())
}

pub(super) fn finish_smart_step_dispatch(
    context: &SocketLoopContext,
    lease: Option<SourceMapDispatchLease>,
) {
    let Some(lease) = lease else {
        return;
    };
    if let Ok(mut shared) = context.shared.lock() {
        if let Some(source_maps) = shared.source_maps.as_mut() {
            source_maps.release_dispatch(lease);
        }
    }
}

fn smart_step_method(direction: smart_step::SmartStepDirection) -> &'static str {
    match direction {
        smart_step::SmartStepDirection::Over => "Debugger.stepOver",
        smart_step::SmartStepDirection::Into => "Debugger.stepInto",
        smart_step::SmartStepDirection::Out => "Debugger.stepOut",
    }
}

pub(crate) fn begin_smart_step_pause(
    params: &Value,
    context: &SocketLoopContext,
) -> Option<String> {
    let reason_is_step = params.get("reason").and_then(Value::as_str) == Some("step");
    let no_breakpoints = params
        .get("hitBreakpoints")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty);
    let top = params
        .get("callFrames")
        .and_then(Value::as_array)
        .and_then(|frames| frames.first());
    let exact_location = top.and_then(|frame| {
        Some((
            frame.pointer("/location/scriptId")?.as_str()?,
            frame.get("url")?.as_str()?,
            u32::try_from(frame.pointer("/location/lineNumber")?.as_u64()?).ok()?,
            u32::try_from(
                frame
                    .pointer("/location/columnNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            )
            .ok()?,
        ))
    });
    let mut shared = context.shared.lock().ok()?;
    let pause_epoch = shared.pause_generation_epoch;
    let may_hide = smart_step::pause_may_be_hidden(smart_step::SmartStepPauseFacts {
        explicit_pause_requested: shared.explicit_pause_requested,
        first_pause_seen: shared.first_pause_seen,
        has_hit_breakpoints: !no_breakpoints,
        has_internal_action: shared.internal_action.is_some(),
        has_restart_frame: shared.pending_restart_frame.is_some(),
        has_startup_validation: shared.startup_validation.is_some(),
        reason_is_step,
    });
    if !may_hide
        || !shared
            .smart_step_policy
            .can_consider_pause(pause_epoch, Instant::now())
    {
        shared.cancel_smart_step();
        return None;
    }
    let Some((script_id, url, line, column)) = exact_location else {
        shared.cancel_smart_step();
        return None;
    };
    let classification = shared
        .source_maps
        .as_ref()
        .map(|maps| maps.classify_generated_for_script(script_id, url, line, column));
    let receipt = match classification {
        Some(crate::debug_source_map::GeneratedSourceMapClassification::LoadedButUnmapped(
            receipt,
        )) => receipt,
        _ => {
            shared.cancel_smart_step();
            return None;
        }
    };
    if !shared
        .source_maps
        .as_ref()
        .is_some_and(|maps| maps.is_current_receipt(&receipt))
    {
        shared.cancel_smart_step();
        return None;
    }
    let request_id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
    let Some(request) =
        shared
            .smart_step_policy
            .begin_hidden_step(pause_epoch, request_id, Instant::now())
    else {
        shared.cancel_smart_step();
        return None;
    };
    let Some(dispatch_lease) = shared
        .source_maps
        .as_ref()
        .and_then(|maps| maps.pin_dispatch(&receipt))
    else {
        shared.cancel_smart_step();
        return None;
    };
    shared.smart_step_dispatch_lease = Some(dispatch_lease);
    shared.smart_step_fallback = Some(params.clone());
    Some(
        json!({
            "id": request.request_id,
            "method": smart_step_method(request.direction),
            "params": {}
        })
        .to_string(),
    )
}

pub(super) fn handle_smart_step_response(
    id: u64,
    message: &Value,
    context: &SocketLoopContext,
) -> bool {
    let user_receipt = context
        .shared
        .lock()
        .ok()
        .and_then(|shared| shared.smart_step_policy.user_request_receipt(id));
    if let Some(receipt) = user_receipt {
        if let Ok(mut shared) = context.shared.lock() {
            if message.get("error").is_some() {
                shared.smart_step_policy.reject_user_request(receipt);
            } else {
                let _ = shared
                    .smart_step_policy
                    .confirm_user_request(receipt, Instant::now());
            }
        }
        // The ordinary pending-request dispatcher must still settle the user
        // command waiter after the policy consumes its exact response receipt.
        return false;
    }
    let fallback = {
        let Ok(mut shared) = context.shared.lock() else {
            return false;
        };
        if !shared.smart_step_policy.is_internal_request(id) {
            return false;
        }
        if message.get("error").is_none()
            && shared
                .smart_step_policy
                .confirm_internal_request(id, Instant::now())
        {
            return true;
        }
        match shared.smart_step_policy.reject_internal_request(id) {
            Some(smart_step::StepPolicyExpiry::SurfaceHiddenPause) => {
                shared.smart_step_fallback.take()
            }
            Some(
                smart_step::StepPolicyExpiry::CancelSilently
                | smart_step::StepPolicyExpiry::NotExpired,
            )
            | None => {
                shared.smart_step_fallback = None;
                None
            }
        }
    };
    if let Some(params) = fallback {
        crate::debug_exception_type_filter::handle_visible_pause(&params, context);
    }
    true
}

pub(super) fn expire_smart_step_request(context: &SocketLoopContext) {
    let fallback = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        let surface_fallback = match shared.smart_step_policy.expiry(Instant::now()) {
            smart_step::StepPolicyExpiry::NotExpired => return,
            smart_step::StepPolicyExpiry::CancelSilently => false,
            smart_step::StepPolicyExpiry::SurfaceHiddenPause => true,
        };
        shared.smart_step_policy.cancel();
        if surface_fallback {
            shared.smart_step_fallback.take()
        } else {
            shared.smart_step_fallback = None;
            None
        }
    };
    if let Some(params) = fallback {
        crate::debug_exception_type_filter::handle_visible_pause(&params, context);
    }
}
