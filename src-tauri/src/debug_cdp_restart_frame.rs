use super::transport::{build_pause_inventory, CdpClient, CdpShared};
use super::{ensure_startup_current, json, map_stop_reason};
use crate::debug_adapter::{DebugStackFrame, DebugStopReason};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PendingRestartFrame {
    pub(super) deadline: Instant,
    frame_id: u64,
    pause_generation: u64,
}

pub(super) fn expire_pending(shared: &mut CdpShared, now: Instant) {
    if shared
        .pending_restart_frame
        .as_ref()
        .is_some_and(|pending| pending.deadline <= now)
    {
        shared.pending_restart_frame = None;
    }
}

pub(super) fn install_visible_pause(
    params: &Value,
    shared: &mut CdpShared,
) -> Result<(Vec<DebugStackFrame>, u64, DebugStopReason), String> {
    let inventory = build_pause_inventory(params, shared)?;
    let frames = inventory.frames.clone();
    let pause_generation = inventory.pause_generation;
    let reason = if shared.pending_restart_frame.take().is_some() {
        DebugStopReason::Restart
    } else {
        map_stop_reason(
            params
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("other"),
        )
    };
    shared.pause = Some(inventory);
    Ok((frames, pause_generation, reason))
}

pub(super) fn restart_frame(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    pause_generation: u64,
    frame_id: u64,
) -> Result<(), String> {
    ensure_startup_current(mutation_is_allowed)?;
    let pending_restart = PendingRestartFrame {
        deadline: Instant::now() + client.request_timeout.saturating_mul(3),
        frame_id,
        pause_generation,
    };
    let call_frame_id = {
        let mut shared = shared.lock().map_err(|error| error.to_string())?;
        if shared.pending_restart_frame.is_some() {
            return Err("A restart-frame request is already pending.".to_string());
        }
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        if pause.pause_generation != pause_generation {
            return Err("The debugger pause generation is stale.".to_string());
        }
        let call_frame_id = pause
            .call_frame_ids
            .get(&frame_id)
            .cloned()
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?;
        shared.pending_restart_frame = Some(pending_restart);
        call_frame_id
    };
    let outcome = ensure_startup_current(mutation_is_allowed).and_then(|()| {
        client
            .request(
                "Debugger.restartFrame",
                json!({"callFrameId": call_frame_id, "mode": "StepInto"}),
            )
            .map(|_| ())
    });
    if outcome.is_err() {
        if let Ok(mut shared) = shared.lock() {
            if shared.pending_restart_frame == Some(pending_restart) {
                shared.pending_restart_frame = None;
            }
        }
    }
    outcome
}
