use super::installation::{
    evaluate_and_install_function_breakpoint, parse_call_frame_function_location,
    FunctionBreakpointCdp, FunctionBreakpointResolutionFailure, FunctionLocation,
};
use super::state::{FunctionBreakpointSessionState, HiddenContinuePhase};
use crate::debug_adapter::{
    DebugEventPayload, DebugFunctionBreakpointVerification, DebugOutputStream, DebugStopReason,
};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(test)]
mod race_tests;

const FUNCTION_BREAKPOINT_RERESOLUTION_QUIET_PERIOD: Duration = Duration::from_millis(10);

struct SweepInstall {
    breakpoint_id: String,
    function_location: Option<FunctionLocation>,
    function_name: String,
    logical_id: String,
}

pub(crate) fn run_reresolution_worker(
    triggers: Receiver<()>,
    mut cdp: impl FunctionBreakpointCdp,
    state: Arc<FunctionBreakpointSessionState>,
    shared: Arc<Mutex<crate::debug_cdp::transport::CdpShared>>,
    emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync>,
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    fail_closed: Arc<dyn Fn() + Send + Sync>,
) {
    'worker: while triggers.recv().is_ok() {
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
        let hidden_continue = match state.hidden_continue_snapshot() {
            Ok(snapshot) => snapshot,
            Err(()) => {
                fail_closed();
                return;
            }
        };
        match hidden_continue.phase {
            HiddenContinuePhase::AwaitingPause {
                desired_generation,
                revision,
            }
            | HiddenContinuePhase::Captured {
                desired_generation,
                revision,
            } if desired_generation != state.desired_generation.load(Ordering::Acquire)
                || revision != state.revision.load(Ordering::Acquire) =>
            {
                fail_closed();
                return;
            }
            HiddenContinuePhase::AwaitingPause { .. } => continue 'worker,
            HiddenContinuePhase::Captured { .. } | HiddenContinuePhase::None => {}
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
            let settlement = resume_after_hidden_continue_pause(
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
            match settlement {
                HiddenPauseSettlement::FailedClosed => return,
                HiddenPauseSettlement::Continued
                | HiddenPauseSettlement::NoCapturedPause
                | HiddenPauseSettlement::Superseded
                | HiddenPauseSettlement::VisibleStop => continue,
            }
        }
        let sweep_revision = state.revision.load(Ordering::Acquire);
        let sweep_generation = state.desired_generation.load(Ordering::Acquire);
        let mut pending: Vec<_> = registrations_guard
            .unverified_by_logical_id
            .iter()
            .map(|(id, name)| (id.clone(), name.clone()))
            .collect();
        pending.sort_unstable_by(|left, right| left.0.cmp(&right.0));
        drop(registrations_guard);
        drop(publication_guard);
        let mut installed_in_sweep = Vec::new();
        let mut request_failed = false;
        let capture_function_location =
            matches!(hidden_continue.phase, HiddenContinuePhase::Captured { .. });
        for (id, function_name) in pending {
            if !is_current() {
                let _ = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
                fail_closed();
                return;
            }
            if state.revision.load(Ordering::Acquire) != sweep_revision {
                break;
            }
            let Ok(registrations_guard) = state.registrations.lock() else {
                let _ = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
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
                    installed_in_sweep.push(SweepInstall {
                        breakpoint_id: installed.breakpoint_id,
                        function_location: installed.function_location,
                        function_name,
                        logical_id: id,
                    });
                    let current_hidden_continue = state.hidden_continue_snapshot();
                    let epoch_is_current = current_hidden_continue
                        .as_ref()
                        .is_ok_and(|snapshot| snapshot.epoch == hidden_continue.epoch);
                    if epoch_is_current {
                        continue;
                    }
                    let removed =
                        remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
                    if current_hidden_continue.is_err() || !removed {
                        fail_closed();
                        return;
                    }
                    if !is_current()
                        || state.revision.load(Ordering::Acquire) != sweep_revision
                        || state.desired_generation.load(Ordering::Acquire) != sweep_generation
                    {
                        fail_closed();
                        return;
                    }
                    continue 'worker;
                }
                Ok(None) => {}
                Err(FunctionBreakpointResolutionFailure::Recoverable(_)) => {
                    if !is_current()
                        || state.revision.load(Ordering::Acquire) != sweep_revision
                        || state.desired_generation.load(Ordering::Acquire) != sweep_generation
                    {
                        let _ = remove_unpublished_sweep(
                            &mut cdp,
                            &state,
                            installed_in_sweep.as_slice(),
                        );
                        fail_closed();
                        return;
                    }
                    request_failed = true;
                    break;
                }
                Err(FunctionBreakpointResolutionFailure::InstallUncertain(_)) => {
                    let _ =
                        remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
                    fail_closed();
                    return;
                }
            }
        }
        if request_failed {
            if !remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice()) {
                fail_closed();
                return;
            }
            surface_hidden_pause_after_reresolution_failure(
                &state,
                HiddenPauseSettleContext {
                    shared: &shared,
                    emit: emit.as_ref(),
                    is_current: is_current.as_ref(),
                    sweep_revision,
                    sweep_generation,
                    fail_closed: fail_closed.as_ref(),
                },
            );
            continue 'worker;
        }
        let current_hidden_continue = state.hidden_continue_snapshot();
        let epoch_is_current = current_hidden_continue
            .as_ref()
            .is_ok_and(|snapshot| snapshot.epoch == hidden_continue.epoch);
        if !epoch_is_current {
            let removed = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
            if current_hidden_continue.is_err() || !removed {
                fail_closed();
                return;
            }
            if !is_current()
                || state.revision.load(Ordering::Acquire) != sweep_revision
                || state.desired_generation.load(Ordering::Acquire) != sweep_generation
            {
                fail_closed();
                return;
            }
            continue 'worker;
        }
        let Ok(publication_guard) = state.publication.lock() else {
            let _ = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
            fail_closed();
            return;
        };
        let authority_is_current = is_current()
            && state.revision.load(Ordering::Acquire) == sweep_revision
            && state.desired_generation.load(Ordering::Acquire) == sweep_generation;
        let Ok(mut registrations_guard) = state.registrations.lock() else {
            drop(publication_guard);
            let _ = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
            fail_closed();
            return;
        };
        let commit_hidden_continue = state.hidden_continue_snapshot();
        let hidden_epoch_is_current = commit_hidden_continue
            .as_ref()
            .is_ok_and(|snapshot| snapshot.epoch == hidden_continue.epoch);
        let candidates_are_current = authority_is_current
            && hidden_epoch_is_current
            && installed_in_sweep.iter().all(|installed| {
                !registrations_guard
                    .by_logical_id
                    .contains_key(&installed.logical_id)
                    && registrations_guard
                        .unverified_by_logical_id
                        .get(&installed.logical_id)
                        .map(String::as_str)
                        == Some(installed.function_name.as_str())
            });
        if candidates_are_current {
            for installed in &installed_in_sweep {
                registrations_guard.by_logical_id.insert(
                    installed.logical_id.clone(),
                    installed.breakpoint_id.clone(),
                );
                registrations_guard
                    .unverified_by_logical_id
                    .remove(&installed.logical_id);
            }
        }
        drop(registrations_guard);
        drop(publication_guard);
        if !candidates_are_current {
            let removed = remove_unpublished_sweep(&mut cdp, &state, installed_in_sweep.as_slice());
            if commit_hidden_continue.is_err()
                || !removed
                || !is_current()
                || state.revision.load(Ordering::Acquire) != sweep_revision
                || state.desired_generation.load(Ordering::Acquire) != sweep_generation
            {
                fail_closed();
                return;
            }
            continue 'worker;
        }
        let mut resolved = Vec::with_capacity(installed_in_sweep.len());
        let mut resolved_function_locations = Vec::with_capacity(installed_in_sweep.len());
        for installed in installed_in_sweep {
            if let Some(location) = installed.function_location {
                resolved_function_locations.push(location);
            }
            resolved.push(DebugFunctionBreakpointVerification {
                id: installed.logical_id,
                verified: true,
            });
        }
        loop {
            let settlement = resume_after_hidden_continue_pause(
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
            match settlement {
                HiddenPauseSettlement::FailedClosed => return,
                HiddenPauseSettlement::Superseded => continue 'worker,
                HiddenPauseSettlement::Continued
                | HiddenPauseSettlement::NoCapturedPause
                | HiddenPauseSettlement::VisibleStop => {}
            }
            if resolved.is_empty() {
                continue 'worker;
            }
            let Ok(publication) = state.publication.lock() else {
                fail_closed();
                return;
            };
            if !is_current() {
                fail_closed();
                return;
            }
            if state.revision.load(Ordering::Acquire) != sweep_revision
                || state.desired_generation.load(Ordering::Acquire) != sweep_generation
            {
                continue 'worker;
            }
            let captured_pause_is_pending = match state.has_hidden_continue_pause() {
                Ok(pending) => pending,
                Err(()) => {
                    fail_closed();
                    return;
                }
            };
            if captured_pause_is_pending {
                drop(publication);
                continue;
            }
            emit(DebugEventPayload::FunctionBreakpointsVerified {
                generation: sweep_generation,
                breakpoints: resolved,
            });
            break;
        }
    }
}

fn surface_hidden_pause_after_reresolution_failure(
    state: &FunctionBreakpointSessionState,
    context: HiddenPauseSettleContext<'_>,
) {
    let Ok(_publication) = state.publication.lock() else {
        (context.fail_closed)();
        return;
    };
    let hidden_pause = match state.take_hidden_continue_pause() {
        Ok(Some(hidden_pause)) => hidden_pause,
        Ok(None) => return,
        Err(()) => {
            (context.fail_closed)();
            return;
        }
    };
    if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
        (context.fail_closed)();
        return;
    }
    let pause = match context.shared.lock() {
        Ok(mut shared) => {
            if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
                (context.fail_closed)();
                return;
            }
            shared.suppress_next_resumed = false;
            crate::debug_cdp::transport::install_visible_pause(&hidden_pause.params, &mut shared)
        }
        Err(_) => {
            (context.fail_closed)();
            return;
        }
    };
    let Ok((frames, pause_generation, reason, frames_truncated)) = pause else {
        (context.fail_closed)();
        return;
    };
    if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
        (context.fail_closed)();
        return;
    }
    (context.emit)(DebugEventPayload::Output {
        stream: DebugOutputStream::Stderr,
        text:
            "[debugger] Unable to resolve a pending function breakpoint; it remains unverified.\n"
                .to_string(),
        truncated: false,
    });
    if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
        (context.fail_closed)();
        return;
    }
    (context.emit)(DebugEventPayload::Stopped {
        reason,
        frames,
        pause_generation,
        frames_truncated,
    });
}

pub(super) struct HiddenPauseSettleContext<'a> {
    pub(super) shared: &'a Mutex<crate::debug_cdp::transport::CdpShared>,
    pub(super) emit: &'a (dyn Fn(DebugEventPayload) + Send + Sync),
    pub(super) is_current: &'a (dyn Fn() -> bool + Send + Sync),
    pub(super) sweep_revision: u64,
    pub(super) sweep_generation: u64,
    pub(super) fail_closed: &'a (dyn Fn() + Send + Sync),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum HiddenPauseSettlement {
    Continued,
    FailedClosed,
    NoCapturedPause,
    Superseded,
    VisibleStop,
}

enum HiddenPauseAdvance {
    ExactFunctionLocation,
    None,
    WatchScriptLocation,
}

pub(super) fn resume_after_hidden_continue_pause(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    resolved_function_locations: &[FunctionLocation],
    context: HiddenPauseSettleContext<'_>,
) -> HiddenPauseSettlement {
    let Ok(publication) = state.publication.lock() else {
        return fail_hidden_pause_settlement(&context);
    };
    let hidden_pause = match state.take_hidden_continue_pause() {
        Ok(Some(hidden_pause)) => hidden_pause,
        Ok(None) => return HiddenPauseSettlement::NoCapturedPause,
        Err(()) => {
            return fail_hidden_pause_settlement(&context);
        }
    };
    drop(publication);
    if !(context.is_current)() {
        return fail_hidden_pause_settlement(&context);
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
                return fail_hidden_pause_settlement(&context);
            }
        };
        match pause {
            Ok((frames, pause_generation, _, frames_truncated)) => {
                if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
                    return fail_hidden_pause_settlement(&context);
                }
                (context.emit)(DebugEventPayload::Stopped {
                    reason: DebugStopReason::Breakpoint,
                    frames,
                    pause_generation,
                    frames_truncated,
                });
            }
            Err(_) => return fail_hidden_pause_settlement(&context),
        }
        return HiddenPauseSettlement::VisibleStop;
    }
    if resolved_function_locations.is_empty() {
        let advance = match state.rearm_ordinary_startup_step(&hidden_pause) {
            Ok(super::state::OrdinaryStartupRearm::ContinueToNextLocation) => {
                HiddenPauseAdvance::ExactFunctionLocation
            }
            Ok(super::state::OrdinaryStartupRearm::NotApplicable) => HiddenPauseAdvance::None,
            Ok(super::state::OrdinaryStartupRearm::WatchContinueToNextLocation) => {
                HiddenPauseAdvance::WatchScriptLocation
            }
            Ok(super::state::OrdinaryStartupRearm::Exhausted) => {
                return fail_hidden_pause_settlement(&context);
            }
            Err(()) => {
                return fail_hidden_pause_settlement(&context);
            }
        };
        if !matches!(advance, HiddenPauseAdvance::None) {
            let next_location = match advance {
                HiddenPauseAdvance::ExactFunctionLocation => {
                    next_exact_break_location(cdp, &hidden_pause)
                }
                HiddenPauseAdvance::WatchScriptLocation => {
                    next_watch_break_location(cdp, &hidden_pause)
                }
                HiddenPauseAdvance::None => Ok(None),
            };
            let Ok(Some(next_location)) = next_location else {
                let _ = state.cancel_hidden_continue_step();
                return fail_hidden_pause_settlement(&context);
            };
            if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
                let _ = state.cancel_hidden_continue_step();
                return fail_hidden_pause_settlement(&context);
            }
            let next_line = next_location
                .get("lineNumber")
                .and_then(serde_json::Value::as_u64);
            let next_column = next_location
                .get("columnNumber")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            let rearm_receipt = next_line.and_then(|next_line| {
                state
                    .bind_pending_ordinary_startup_location(next_line, next_column)
                    .ok()
            });
            let Some(rearm_receipt) = rearm_receipt else {
                let _ = state.cancel_hidden_continue_step();
                return fail_hidden_pause_settlement(&context);
            };
            let Ok(mut shared) = context.shared.lock() else {
                return fail_hidden_pause_settlement(&context);
            };
            shared.suppress_next_resumed = true;
            drop(shared);
            let continued = cdp
                .request(
                    "Debugger.continueToLocation",
                    json!({"location":next_location,"targetCallFrames":"any"}),
                )
                .is_ok();
            if continued {
                return classify_completed_continue(
                    state,
                    &hidden_pause,
                    Some(&rearm_receipt),
                    &context,
                );
            }
            let _ = state.cancel_hidden_continue_step();
            return fail_hidden_pause_settlement(&context);
        }
    }
    let Ok(mut shared) = context.shared.lock() else {
        return fail_hidden_pause_settlement(&context);
    };
    shared.suppress_next_resumed = true;
    drop(shared);
    if cdp.request("Debugger.resume", json!({})).is_ok() {
        return classify_completed_continue(state, &hidden_pause, None, &context);
    }
    if !receipt_is_current || hidden_pause.authority.exact_script_id.is_some() {
        return fail_hidden_pause_settlement(&context);
    }
    let pause = match context.shared.lock() {
        Ok(mut shared) => {
            shared.suppress_next_resumed = false;
            crate::debug_cdp::transport::install_visible_pause(&hidden_pause.params, &mut shared)
        }
        Err(_) => {
            return fail_hidden_pause_settlement(&context);
        }
    };
    let Ok((frames, pause_generation, reason, frames_truncated)) = pause else {
        return fail_hidden_pause_settlement(&context);
    };
    if !hidden_pause_authority_is_current(state, &hidden_pause, &context) {
        return fail_hidden_pause_settlement(&context);
    }
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
        frames_truncated,
    });
    HiddenPauseSettlement::VisibleStop
}

fn sweep_authority_is_current(
    state: &FunctionBreakpointSessionState,
    is_current: &(dyn Fn() -> bool + Send + Sync),
    sweep_revision: u64,
    sweep_generation: u64,
) -> bool {
    is_current()
        && state.revision.load(Ordering::Acquire) == sweep_revision
        && state.desired_generation.load(Ordering::Acquire) == sweep_generation
}

fn hidden_pause_authority_is_current(
    state: &FunctionBreakpointSessionState,
    hidden_pause: &super::state::HiddenContinuePause,
    context: &HiddenPauseSettleContext<'_>,
) -> bool {
    hidden_pause.authority.revision == context.sweep_revision
        && hidden_pause.authority.desired_generation == context.sweep_generation
        && sweep_authority_is_current(
            state,
            context.is_current,
            context.sweep_revision,
            context.sweep_generation,
        )
}

fn classify_completed_continue(
    state: &FunctionBreakpointSessionState,
    hidden_pause: &super::state::HiddenContinuePause,
    rearm_receipt: Option<&super::state::HiddenContinueRearmReceipt>,
    context: &HiddenPauseSettleContext<'_>,
) -> HiddenPauseSettlement {
    if !(context.is_current)() {
        return fail_hidden_pause_settlement(context);
    }
    if !hidden_pause_authority_is_current(state, hidden_pause, context) {
        if rearm_receipt.is_some_and(|receipt| state.cancel_rearmed_hidden_step(receipt).is_err()) {
            return fail_hidden_pause_settlement(context);
        }
        return HiddenPauseSettlement::Superseded;
    }
    HiddenPauseSettlement::Continued
}

fn fail_hidden_pause_settlement(context: &HiddenPauseSettleContext<'_>) -> HiddenPauseSettlement {
    (context.fail_closed)();
    HiddenPauseSettlement::FailedClosed
}

fn next_exact_break_location(
    cdp: &mut impl FunctionBreakpointCdp,
    hidden_pause: &super::state::HiddenContinuePause,
) -> Result<Option<serde_json::Value>, String> {
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
    next_break_location(cdp, script_id, current)
}

fn next_watch_break_location(
    cdp: &mut impl FunctionBreakpointCdp,
    hidden_pause: &super::state::HiddenContinuePause,
) -> Result<Option<serde_json::Value>, String> {
    let script_id = hidden_pause
        .authority
        .exact_script_id
        .as_deref()
        .ok_or_else(|| "Missing exact watch entry script.".to_string())?;
    let current = hidden_pause
        .params
        .pointer("/callFrames/0/location")
        .filter(|location| {
            location.get("scriptId").and_then(serde_json::Value::as_str) == Some(script_id)
        })
        .ok_or_else(|| "The exact watch entry frame disappeared.".to_string())?;
    next_break_location(cdp, script_id, current)
}

fn next_break_location(
    cdp: &mut impl FunctionBreakpointCdp,
    script_id: &str,
    current: &serde_json::Value,
) -> Result<Option<serde_json::Value>, String> {
    const MAX_CANDIDATE_LOCATIONS: usize = 4_096;
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

fn remove_unpublished_sweep(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    installed: &[SweepInstall],
) -> bool {
    let mut removed = true;
    for candidate in installed {
        removed &=
            remove_or_track_unpublished_install(cdp, state, candidate.breakpoint_id.as_str());
    }
    removed
}

fn remove_or_track_unpublished_install(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    cdp_id: &str,
) -> bool {
    if cdp
        .request("Debugger.removeBreakpoint", json!({"breakpointId":cdp_id}))
        .is_ok()
    {
        return true;
    }
    let mut registrations = match state.registrations.lock() {
        Ok(registrations) => registrations,
        Err(poisoned) => poisoned.into_inner(),
    };
    if registrations
        .unpublished_cdp_ids
        .iter()
        .any(|tracked| tracked == cdp_id)
    {
        return false;
    }
    registrations.unpublished_cdp_ids.push(cdp_id.to_string());
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_cdp_function_breakpoints::HiddenPauseCapture;
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::thread;

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

    struct CoordinatedFakeCdp {
        blocked_method: Option<&'static str>,
        calls: Arc<Mutex<Vec<(String, Value)>>>,
        entered: mpsc::SyncSender<String>,
        release: Option<mpsc::Receiver<()>>,
        replies: VecDeque<Result<Value, String>>,
    }

    impl FunctionBreakpointCdp for CoordinatedFakeCdp {
        fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls
                .lock()
                .unwrap()
                .push((method.to_string(), params));
            self.entered.send(method.to_string()).unwrap();
            if self.blocked_method == Some(method) {
                self.release.as_ref().unwrap().recv().unwrap();
            }
            self.replies.pop_front().unwrap_or(Ok(json!({})))
        }
    }

    struct SettlementRaceFakeCdp {
        entered: mpsc::SyncSender<String>,
        release_install: mpsc::Receiver<()>,
        replies: VecDeque<Result<Value, String>>,
        trace: Arc<Mutex<Vec<String>>>,
    }

    impl FunctionBreakpointCdp for SettlementRaceFakeCdp {
        fn request(&mut self, method: &str, _params: Value) -> Result<Value, String> {
            self.trace.lock().unwrap().push(format!("request:{method}"));
            self.entered.send(method.to_string()).unwrap();
            if method == "Debugger.setBreakpointOnFunctionCall" {
                self.release_install.recv().unwrap();
            }
            self.replies.pop_front().unwrap_or(Ok(json!({})))
        }
    }

    fn captured_watch_startup_state() -> FunctionBreakpointSessionState {
        let state = FunctionBreakpointSessionState::default();
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        state
            .bind_exact_watch_entry_url("file:///workspace/server.js".to_string())
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
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":0
                    }
                }]
            })),
            Ok(super::super::state::HiddenStartupStep::StepOver)
        );
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":0
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        state
    }

    fn captured_failure_state() -> FunctionBreakpointSessionState {
        let state = FunctionBreakpointSessionState::default();
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"frame-1",
                    "functionName":"render",
                    "url":"file:///workspace/server.js",
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":10
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        state
    }

    #[test]
    fn watch_startup_pause_advances_exactly_before_verification_publication() {
        let state = Arc::new(captured_watch_startup_state());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::sync_channel(8);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let cdp = CoordinatedFakeCdp {
            blocked_method: Some("Debugger.continueToLocation"),
            calls: Arc::clone(&calls),
            entered: entered_tx,
            release: Some(release_rx),
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"undefined"}})),
                Ok(json!({"locations":[{
                    "scriptId":"entry-script",
                    "lineNumber":0,
                    "columnNumber":10
                }]})),
                Ok(json!({})),
                Ok(json!({"result":{"type":"function","objectId":"function:1"}})),
                Ok(json!({
                    "internalProperties":[{
                        "name":"[[FunctionLocation]]",
                        "value":{"value":{
                            "scriptId":"entry-script",
                            "lineNumber":0,
                            "columnNumber":20
                        }}
                    }]
                })),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
            ]),
        };
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_worker = Arc::clone(&emitted);
        let (event_tx, event_rx) = mpsc::sync_channel(2);
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let (trigger_tx, trigger_rx) = mpsc::channel();
        let state_for_worker = Arc::clone(&state);
        let worker = thread::spawn(move || {
            run_reresolution_worker(
                trigger_rx,
                cdp,
                state_for_worker,
                crate::debug_cdp::transport::empty_shared_state_for_test(),
                Arc::new(move |payload| {
                    emitted_for_worker.lock().unwrap().push(payload);
                    event_tx.send(()).unwrap();
                }),
                Arc::new(|| true),
                Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
            );
        });

        trigger_tx.send(()).unwrap();
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Runtime.evaluate"
        );
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.getPossibleBreakpoints"
        );
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.continueToLocation"
        );
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"frame-1",
                    "functionName":"render",
                    "url":"file:///workspace/server.js",
                    "functionLocation":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":20
                    },
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":10
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        trigger_tx.send(()).unwrap();
        release_tx.send(()).unwrap();
        event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        drop(trigger_tx);
        worker.join().unwrap();

        let events = emitted.lock().unwrap();
        assert!(matches!(
            events.as_slice(),
            [
                DebugEventPayload::Stopped { .. },
                DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. }
            ] if breakpoints == &[DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true
            }]
        ));
        assert!(!failed_closed.load(Ordering::Acquire));
        assert!(!state.has_hidden_continue_pause().unwrap());
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .map(|(method, _)| method.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Runtime.evaluate",
                "Debugger.getPossibleBreakpoints",
                "Debugger.continueToLocation",
                "Runtime.evaluate",
                "Runtime.getProperties",
                "Debugger.setBreakpointOnFunctionCall"
            ]
        );
    }

    #[test]
    fn watch_continue_location_rejects_a_foreign_top_frame() {
        let state = captured_watch_startup_state();
        let hidden_pause = state.take_hidden_continue_pause().unwrap().unwrap();
        assert_eq!(
            state.rearm_ordinary_startup_step(&hidden_pause),
            Ok(super::super::state::OrdinaryStartupRearm::WatchContinueToNextLocation)
        );
        state.bind_pending_ordinary_startup_location(0, 10).unwrap();

        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[
                    {
                        "location":{
                            "scriptId":"foreign-script",
                            "lineNumber":0,
                            "columnNumber":10
                        }
                    },
                    {
                        "location":{
                            "scriptId":"entry-script",
                            "lineNumber":0,
                            "columnNumber":10
                        }
                    }
                ]
            })),
            HiddenPauseCapture::PassThrough
        );
        assert!(!state.has_hidden_continue_pause().unwrap());
    }

    #[test]
    fn superseded_continue_location_ack_clears_only_its_rearmed_authority() {
        let state = Arc::new(captured_watch_startup_state());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::sync_channel(2);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let state_for_worker = Arc::clone(&state);
        let worker = thread::spawn(move || {
            let mut cdp = CoordinatedFakeCdp {
                blocked_method: Some("Debugger.continueToLocation"),
                calls,
                entered: entered_tx,
                release: Some(release_rx),
                replies: VecDeque::from([
                    Ok(json!({"locations":[{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":10
                    }]})),
                    Ok(json!({})),
                ]),
            };
            resume_after_hidden_continue_pause(
                &mut cdp,
                &state_for_worker,
                &[],
                HiddenPauseSettleContext {
                    shared: crate::debug_cdp::transport::empty_shared_state_for_test().as_ref(),
                    emit: &|_| {},
                    is_current: &|| true,
                    sweep_revision: 1,
                    sweep_generation: 1,
                    fail_closed: &move || failed_closed_for_worker.store(true, Ordering::Release),
                },
            )
        });

        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.getPossibleBreakpoints"
        );
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.continueToLocation"
        );
        let publication = state.publication.lock().unwrap();
        state.desired_generation.store(2, Ordering::Release);
        state.revision.store(2, Ordering::Release);
        drop(publication);
        release_tx.send(()).unwrap();

        assert_eq!(worker.join().unwrap(), HiddenPauseSettlement::Superseded);
        assert!(!failed_closed.load(Ordering::Acquire));
        assert!(!state.has_hidden_continue_pause().unwrap());
        assert!(state.begin_hidden_continue_step().unwrap());
        state.cancel_hidden_continue_step().unwrap();
    }

    #[test]
    fn captured_pause_is_settled_before_verification_publication() {
        let state = Arc::new(FunctionBreakpointSessionState::default());
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":10
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        let trace = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::sync_channel(4);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let cdp = SettlementRaceFakeCdp {
            entered: entered_tx,
            release_install: release_rx,
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:1"}})),
                Ok(json!({
                    "internalProperties":[{
                        "name":"[[FunctionLocation]]",
                        "value":{"value":{
                            "scriptId":"entry-script",
                            "lineNumber":0,
                            "columnNumber":20
                        }}
                    }]
                })),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
                Ok(json!({})),
            ]),
            trace: Arc::clone(&trace),
        };
        let trace_for_worker = Arc::clone(&trace);
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let (event_tx, event_rx) = mpsc::sync_channel(1);
        let (trigger_tx, trigger_rx) = mpsc::channel();
        let state_for_worker = Arc::clone(&state);
        let worker = thread::spawn(move || {
            run_reresolution_worker(
                trigger_rx,
                cdp,
                state_for_worker,
                crate::debug_cdp::transport::empty_shared_state_for_test(),
                Arc::new(move |payload| {
                    if matches!(
                        payload,
                        DebugEventPayload::FunctionBreakpointsVerified { .. }
                    ) {
                        trace_for_worker
                            .lock()
                            .unwrap()
                            .push("event:verified".to_string());
                        event_tx.send(()).unwrap();
                    }
                }),
                Arc::new(|| true),
                Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
            );
        });

        trigger_tx.send(()).unwrap();
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Runtime.evaluate"
        );
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Runtime.getProperties"
        );
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.setBreakpointOnFunctionCall"
        );
        release_tx.send(()).unwrap();
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Debugger.resume"
        );
        event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        drop(trigger_tx);
        worker.join().unwrap();

        assert_eq!(
            trace.lock().unwrap().as_slice(),
            [
                "request:Runtime.evaluate",
                "request:Runtime.getProperties",
                "request:Debugger.setBreakpointOnFunctionCall",
                "request:Debugger.resume",
                "event:verified"
            ]
        );
        assert!(!failed_closed.load(Ordering::Acquire));
        assert!(!state.has_hidden_continue_pause().unwrap());
    }

    #[test]
    fn capture_collision_with_publication_surfaces_the_pause_without_blocking() {
        let state = FunctionBreakpointSessionState::default();
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        assert!(state.begin_hidden_continue_step().unwrap());
        let publication = state.publication.lock().unwrap();
        let pause = json!({
            "reason":"step",
            "hitBreakpoints":[],
            "callFrames":[]
        });

        assert_eq!(
            state.capture_hidden_continue_pause(&pause),
            HiddenPauseCapture::PassThrough
        );
        drop(publication);
        assert_eq!(
            state.capture_hidden_continue_pause(&pause),
            HiddenPauseCapture::PassThrough
        );
        assert!(!state.has_hidden_continue_pause().unwrap());
    }

    #[test]
    fn recoverable_failure_drops_stale_generation_without_visible_pause() {
        let state = captured_failure_state();
        state.desired_generation.store(2, Ordering::Release);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_callback = Arc::clone(&emitted);
        let failed_closed = AtomicBool::new(false);

        surface_hidden_pause_after_reresolution_failure(
            &state,
            HiddenPauseSettleContext {
                shared: crate::debug_cdp::transport::empty_shared_state_for_test().as_ref(),
                emit: &move |payload| emitted_for_callback.lock().unwrap().push(payload),
                is_current: &|| true,
                sweep_revision: 1,
                sweep_generation: 1,
                fail_closed: &|| failed_closed.store(true, Ordering::Release),
            },
        );

        assert!(failed_closed.load(Ordering::Acquire));
        assert!(emitted.lock().unwrap().is_empty());
    }

    #[test]
    fn recoverable_failure_revalidates_owner_after_waiting_for_shared_state() {
        let state = Arc::new(captured_failure_state());
        let shared = crate::debug_cdp::transport::empty_shared_state_for_test();
        let shared_guard = shared.lock().unwrap();
        let allowed = Arc::new(AtomicBool::new(true));
        let allowed_for_worker = Arc::clone(&allowed);
        let (authority_checked_tx, authority_checked_rx) = mpsc::sync_channel(1);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_worker = Arc::clone(&emitted);
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let state_for_worker = Arc::clone(&state);
        let shared_for_worker = Arc::clone(&shared);
        let worker = thread::spawn(move || {
            surface_hidden_pause_after_reresolution_failure(
                &state_for_worker,
                HiddenPauseSettleContext {
                    shared: shared_for_worker.as_ref(),
                    emit: &move |payload| emitted_for_worker.lock().unwrap().push(payload),
                    is_current: &move || {
                        let current = allowed_for_worker.load(Ordering::Acquire);
                        let _ = authority_checked_tx.try_send(());
                        current
                    },
                    sweep_revision: 1,
                    sweep_generation: 1,
                    fail_closed: &move || failed_closed_for_worker.store(true, Ordering::Release),
                },
            );
        });
        authority_checked_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        allowed.store(false, Ordering::Release);
        drop(shared_guard);
        worker.join().unwrap();

        assert!(failed_closed.load(Ordering::Acquire));
        assert!(emitted.lock().unwrap().is_empty());
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
