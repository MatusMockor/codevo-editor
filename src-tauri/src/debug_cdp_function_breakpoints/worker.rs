use super::installation::{
    evaluate_and_install_function_breakpoint, parse_call_frame_function_location,
    FunctionBreakpointCdp, FunctionLocation,
};
use super::state::FunctionBreakpointSessionState;
use crate::debug_adapter::{
    DebugEventPayload, DebugFunctionBreakpointVerification, DebugOutputStream, DebugStopReason,
};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const FUNCTION_BREAKPOINT_RERESOLUTION_QUIET_PERIOD: Duration = Duration::from_millis(10);

pub(crate) fn run_reresolution_worker(
    triggers: Receiver<()>,
    mut cdp: impl FunctionBreakpointCdp,
    state: Arc<FunctionBreakpointSessionState>,
    shared: Arc<Mutex<crate::debug_cdp::transport::CdpShared>>,
    emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync>,
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    fail_closed: Arc<dyn Fn() + Send + Sync>,
) {
    while triggers.recv().is_ok() {
        loop {
            match triggers.recv_timeout(FUNCTION_BREAKPOINT_RERESOLUTION_QUIET_PERIOD) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if !is_current() {
            fail_closed();
            return;
        }
        let Ok(publication_guard) = state.publication.lock() else {
            fail_closed();
            return;
        };
        let Ok(mut registrations_guard) = state.registrations.lock() else {
            fail_closed();
            return;
        };
        if !registrations_guard.reserve_reresolution_sweep() {
            drop(registrations_guard);
            drop(publication_guard);
            resume_after_hidden_continue_pause(
                &mut cdp,
                &state,
                &[],
                HiddenPauseSettleContext {
                    shared: &shared,
                    emit: emit.as_ref(),
                    is_current: is_current.as_ref(),
                    sweep_revision: state.revision.load(Ordering::Acquire),
                    sweep_generation: state.desired_generation.load(Ordering::Acquire),
                    fail_closed: fail_closed.as_ref(),
                },
            );
            continue;
        }
        let sweep_revision = state.revision.load(Ordering::Acquire);
        let sweep_generation = state.desired_generation.load(Ordering::Acquire);
        let pending: Vec<_> = registrations_guard
            .unverified_by_logical_id
            .iter()
            .map(|(id, name)| (id.clone(), name.clone()))
            .collect();
        drop(registrations_guard);
        drop(publication_guard);
        let mut resolved = Vec::new();
        let mut resolved_function_locations = Vec::new();
        let capture_function_location = match state.has_hidden_continue_pause() {
            Ok(capture) => capture,
            Err(()) => {
                fail_closed();
                return;
            }
        };
        for (id, function_name) in pending {
            if !is_current() {
                fail_closed();
                return;
            }
            if state.revision.load(Ordering::Acquire) != sweep_revision {
                break;
            }
            let Ok(registrations_guard) = state.registrations.lock() else {
                fail_closed();
                return;
            };
            let candidate_is_unresolved = !registrations_guard.by_logical_id.contains_key(&id)
                && registrations_guard
                    .unverified_by_logical_id
                    .get(&id)
                    .map(String::as_str)
                    == Some(function_name.as_str());
            drop(registrations_guard);
            if !candidate_is_unresolved {
                continue;
            }
            let result = evaluate_and_install_function_breakpoint(
                &mut cdp,
                &function_name,
                capture_function_location,
                &|| is_current() && state.revision.load(Ordering::Acquire) == sweep_revision,
            );
            match result {
                Ok(Some(installed)) => {
                    let cdp_id = installed.breakpoint_id;
                    let Ok(publication_guard) = state.publication.lock() else {
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        fail_closed();
                        return;
                    };
                    let candidate_is_current =
                        is_current() && state.revision.load(Ordering::Acquire) == sweep_revision;
                    let Ok(mut registrations_guard) = state.registrations.lock() else {
                        drop(publication_guard);
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        fail_closed();
                        return;
                    };
                    let candidate_is_current = candidate_is_current
                        && !registrations_guard.by_logical_id.contains_key(&id)
                        && registrations_guard
                            .unverified_by_logical_id
                            .get(&id)
                            .map(String::as_str)
                            == Some(function_name.as_str());
                    if candidate_is_current {
                        registrations_guard
                            .by_logical_id
                            .insert(id.clone(), cdp_id.clone());
                        registrations_guard.unverified_by_logical_id.remove(&id);
                    }
                    drop(registrations_guard);
                    drop(publication_guard);
                    if !candidate_is_current {
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        if !is_current() {
                            fail_closed();
                            return;
                        }
                        break;
                    }
                    if let Some(location) = installed.function_location {
                        resolved_function_locations.push(location);
                    }
                    resolved.push(DebugFunctionBreakpointVerification { id, verified: true });
                }
                Ok(None) => {}
                Err(_) => {
                    fail_closed();
                    return;
                }
            }
        }
        if !resolved.is_empty() && is_current() {
            let Ok(_publication) = state.publication.lock() else {
                fail_closed();
                return;
            };
            if state.revision.load(Ordering::Acquire) == sweep_revision && is_current() {
                emit(DebugEventPayload::FunctionBreakpointsVerified {
                    generation: sweep_generation,
                    breakpoints: resolved,
                });
            }
        }
        resume_after_hidden_continue_pause(
            &mut cdp,
            &state,
            &resolved_function_locations,
            HiddenPauseSettleContext {
                shared: &shared,
                emit: emit.as_ref(),
                is_current: is_current.as_ref(),
                sweep_revision,
                sweep_generation,
                fail_closed: fail_closed.as_ref(),
            },
        );
    }
}

pub(super) struct HiddenPauseSettleContext<'a> {
    pub(super) shared: &'a Mutex<crate::debug_cdp::transport::CdpShared>,
    pub(super) emit: &'a (dyn Fn(DebugEventPayload) + Send + Sync),
    pub(super) is_current: &'a (dyn Fn() -> bool + Send + Sync),
    pub(super) sweep_revision: u64,
    pub(super) sweep_generation: u64,
    pub(super) fail_closed: &'a (dyn Fn() + Send + Sync),
}

pub(super) fn resume_after_hidden_continue_pause(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    resolved_function_locations: &[FunctionLocation],
    context: HiddenPauseSettleContext<'_>,
) {
    let hidden_pause = match state.take_hidden_continue_pause() {
        Ok(Some(hidden_pause)) => hidden_pause,
        Ok(None) => return,
        Err(()) => {
            (context.fail_closed)();
            return;
        }
    };
    let Ok(_publication) = state.publication.lock() else {
        (context.fail_closed)();
        return;
    };
    if !(context.is_current)() {
        (context.fail_closed)();
        return;
    }
    let receipt_is_current = hidden_pause.authority.revision == context.sweep_revision
        && hidden_pause.authority.desired_generation == context.sweep_generation
        && state.revision.load(Ordering::Acquire) == context.sweep_revision
        && state.desired_generation.load(Ordering::Acquire) == context.sweep_generation;
    let current_function_location = hidden_pause
        .params
        .get("callFrames")
        .and_then(serde_json::Value::as_array)
        .and_then(|frames| frames.first())
        .and_then(|frame| frame.get("functionLocation"))
        .and_then(parse_call_frame_function_location);
    let resolved_current_function = current_function_location
        .as_ref()
        .is_some_and(|current| resolved_function_locations.contains(current));
    if receipt_is_current && resolved_current_function {
        let pause = match context.shared.lock() {
            Ok(mut shared) => crate::debug_cdp::transport::install_visible_pause(
                &hidden_pause.params,
                &mut shared,
            ),
            Err(_) => {
                (context.fail_closed)();
                return;
            }
        };
        match pause {
            Ok((frames, pause_generation, _)) => {
                (context.emit)(DebugEventPayload::Stopped {
                    reason: DebugStopReason::Breakpoint,
                    frames,
                    pause_generation,
                });
            }
            Err(_) => (context.fail_closed)(),
        }
        return;
    }
    if resolved_function_locations.is_empty() {
        let next_step = match state.rearm_ordinary_startup_step(&hidden_pause) {
            Ok(super::state::OrdinaryStartupRearm::ContinueToNextLocation) => true,
            Ok(super::state::OrdinaryStartupRearm::NotApplicable) => false,
            Ok(super::state::OrdinaryStartupRearm::Exhausted) => {
                (context.fail_closed)();
                return;
            }
            Err(()) => {
                (context.fail_closed)();
                return;
            }
        };
        if next_step {
            let next_location = next_exact_break_location(cdp, &hidden_pause);
            let Ok(Some(next_location)) = next_location else {
                let _ = state.cancel_hidden_continue_step();
                (context.fail_closed)();
                return;
            };
            let next_line = next_location
                .get("lineNumber")
                .and_then(serde_json::Value::as_u64);
            let next_column = next_location
                .get("columnNumber")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            if next_line.is_none()
                || state
                    .bind_pending_ordinary_startup_location(
                        next_line.unwrap_or_default(),
                        next_column,
                    )
                    .is_err()
            {
                let _ = state.cancel_hidden_continue_step();
                (context.fail_closed)();
                return;
            }
            let Ok(mut shared) = context.shared.lock() else {
                (context.fail_closed)();
                return;
            };
            shared.suppress_next_resumed = true;
            drop(shared);
            if cdp
                .request(
                    "Debugger.continueToLocation",
                    json!({"location":next_location,"targetCallFrames":"any"}),
                )
                .is_ok()
            {
                return;
            }
            let _ = state.cancel_hidden_continue_step();
            (context.fail_closed)();
            return;
        }
    }
    let Ok(mut shared) = context.shared.lock() else {
        (context.fail_closed)();
        return;
    };
    shared.suppress_next_resumed = true;
    drop(shared);
    if cdp.request("Debugger.resume", json!({})).is_ok() {
        return;
    }
    if !receipt_is_current || hidden_pause.authority.exact_script_id.is_some() {
        (context.fail_closed)();
        return;
    }
    let pause = match context.shared.lock() {
        Ok(mut shared) => {
            shared.suppress_next_resumed = false;
            crate::debug_cdp::transport::install_visible_pause(&hidden_pause.params, &mut shared)
        }
        Err(_) => {
            (context.fail_closed)();
            return;
        }
    };
    let Ok((frames, pause_generation, reason)) = pause else {
        (context.fail_closed)();
        return;
    };
    (context.emit)(DebugEventPayload::Output {
        stream: DebugOutputStream::Stderr,
        text: "[debugger] Unable to resume after resolving a pending function breakpoint.\n"
            .to_string(),
        truncated: false,
    });
    (context.emit)(DebugEventPayload::Stopped {
        reason,
        frames,
        pause_generation,
    });
}

fn next_exact_break_location(
    cdp: &mut impl FunctionBreakpointCdp,
    hidden_pause: &super::state::HiddenContinuePause,
) -> Result<Option<serde_json::Value>, String> {
    const MAX_CANDIDATE_LOCATIONS: usize = 4_096;
    let script_id = hidden_pause
        .authority
        .exact_script_id
        .as_deref()
        .ok_or_else(|| "Missing exact function-breakpoint entry script.".to_string())?;
    let exact_frames: Vec<_> = hidden_pause
        .params
        .get("callFrames")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|frame| {
            super::state::exact_function_location_matches(frame, &hidden_pause.authority)
        })
        .collect();
    if exact_frames.len() != 1 {
        return Err("The exact function-breakpoint entry frame is ambiguous.".to_string());
    }
    let current = if hidden_pause.authority.expected_location.is_some() {
        let expected_frames: Vec<_> = hidden_pause
            .params
            .get("callFrames")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter(|frame| super::state::expected_location_matches(frame, &hidden_pause.authority))
            .collect();
        (expected_frames.len() == 1)
            .then(|| expected_frames[0].get("location"))
            .flatten()
    } else {
        exact_frames[0].get("location").filter(|location| {
            location.get("scriptId").and_then(serde_json::Value::as_str) == Some(script_id)
        })
    }
    .ok_or_else(|| "The exact function-breakpoint entry frame disappeared.".to_string())?;
    let current_line = current
        .get("lineNumber")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "The exact function-breakpoint entry line is invalid.".to_string())?;
    let current_column = current
        .get("columnNumber")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let response = cdp.request(
        "Debugger.getPossibleBreakpoints",
        json!({
            "start":{
                "scriptId":script_id,
                "lineNumber":current_line,
                "columnNumber":current_column.saturating_add(1)
            },
            "end":{
                "scriptId":script_id,
                "lineNumber":current_line.saturating_add(1),
                "columnNumber":0
            },
            "restrictToFunction":false
        }),
    )?;
    let locations = response
        .get("locations")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            "Node debugger returned invalid possible breakpoint locations.".to_string()
        })?;
    if locations.len() > MAX_CANDIDATE_LOCATIONS {
        return Err("Node debugger returned too many possible breakpoint locations.".to_string());
    }
    Ok(locations.iter().find_map(|location| {
        let same_script =
            location.get("scriptId").and_then(serde_json::Value::as_str) == Some(script_id);
        let line = location
            .get("lineNumber")
            .and_then(serde_json::Value::as_u64)?;
        let column = location
            .get("columnNumber")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        (same_script && (line, column) > (current_line, current_column)).then(|| location.clone())
    }))
}

fn remove_or_track_unpublished_install(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    cdp_id: String,
) {
    if cdp
        .request("Debugger.removeBreakpoint", json!({"breakpointId":cdp_id}))
        .is_ok()
    {
        return;
    }
    let mut registrations = match state.registrations.lock() {
        Ok(registrations) => registrations,
        Err(poisoned) => poisoned.into_inner(),
    };
    if registrations.unpublished_cdp_ids.contains(&cdp_id) {
        return;
    }
    registrations.unpublished_cdp_ids.push(cdp_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_cdp_function_breakpoints::HiddenPauseCapture;
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::sync::atomic::Ordering;

    struct FakeCdp {
        calls: Vec<(String, Value)>,
        replies: VecDeque<Result<Value, String>>,
    }

    impl FunctionBreakpointCdp for FakeCdp {
        fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params));
            self.replies.pop_front().unwrap_or(Ok(json!({})))
        }
    }

    #[test]
    fn possible_breakpoint_query_is_bounded_to_the_current_source_line() {
        let state = FunctionBreakpointSessionState::default();
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "globalThis.render".to_string());
        state.desired_generation.store(1, Ordering::Release);
        state
            .bind_exact_startup_entry_url("file:///workspace/server.js".to_string())
            .unwrap();
        state
            .observe_script_parsed(&json!({
                "url":"file:///workspace/server.js",
                "scriptId":"entry-script"
            }))
            .unwrap();
        assert_eq!(
            state.begin_hidden_startup_step(&json!({
                "callFrames":[{
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0}
                }]
            })),
            Ok(super::super::state::HiddenStartupStep::StepInto)
        );
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":7,"columnNumber":13}
                }]
            })),
            HiddenPauseCapture::Captured
        );
        let hidden = state.take_hidden_continue_pause().unwrap().unwrap();
        assert_eq!(
            state.rearm_ordinary_startup_step(&hidden),
            Ok(super::super::state::OrdinaryStartupRearm::ContinueToNextLocation)
        );
        state.bind_pending_ordinary_startup_location(7, 45).unwrap();
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[
                    {
                        "functionLocation":{"scriptId":"entry-script","lineNumber":4,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":7,"columnNumber":31}
                    },
                    {
                        "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":7,"columnNumber":45}
                    }
                ]
            })),
            HiddenPauseCapture::Captured
        );
        let hidden = state.take_hidden_continue_pause().unwrap().unwrap();
        let mut cdp = FakeCdp {
            calls: Vec::new(),
            replies: VecDeque::from([Ok(json!({"locations":[]}))]),
        };

        assert_eq!(next_exact_break_location(&mut cdp, &hidden), Ok(None));
        assert_eq!(
            cdp.calls,
            vec![(
                "Debugger.getPossibleBreakpoints".to_string(),
                json!({
                    "start":{
                        "scriptId":"entry-script",
                        "lineNumber":7,
                        "columnNumber":46
                    },
                    "end":{
                        "scriptId":"entry-script",
                        "lineNumber":8,
                        "columnNumber":0
                    },
                    "restrictToFunction":false
                })
            )]
        );
    }
}
