use super::super::watch_desired_policy::{DesiredDebuggerReplayPlan, DesiredDebuggerReplayStep};
use super::super::watch_event_gate::{
    WatchDebugEventGate, WatchEventGenerationLease, WatchStartupFunctionBreakpointAuthority,
};
use super::super::watch_generation::TargetGeneration;
use super::super::watch_replay::{
    reconcile_replay_setup, reconcile_replay_setup_preserving_function_breakpoints,
    reconcile_replay_setup_with_function_publication, WatchCdpProtocol,
};

pub(super) type StartupReceiptAuthority = (u64, u64, Vec<String>);

pub(super) fn reconcile_replayed_plan(
    adapter: &mut impl WatchCdpProtocol,
    gate: &WatchDebugEventGate,
    lease: &WatchEventGenerationLease,
    target_generation: TargetGeneration,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
) -> Result<Option<StartupReceiptAuthority>, ()> {
    let (replayed_function_generation, replayed_ids) =
        function_breakpoint_authority(replayed).ok_or(())?;
    let (current_function_generation, current_ids) =
        function_breakpoint_authority(current).ok_or(())?;
    if replayed_function_generation == current_function_generation && replayed_ids == current_ids {
        if replayed != current {
            reconcile_replay_setup_preserving_function_breakpoints(
                adapter, replayed, current, is_current,
            )?;
        }
        return Ok((target_generation.get() == 1).then_some((
            replayed.revision(),
            replayed_function_generation,
            replayed_ids,
        )));
    }
    if target_generation.get() != 1 {
        if replayed != current {
            reconcile_replay_setup(adapter, replayed, current, is_current)?;
        }
        return Ok(None);
    }

    let mut replaced = false;
    reconcile_replay_setup_with_function_publication(
        adapter,
        replayed,
        current,
        is_current,
        &mut |generation, verification| {
            if replaced || generation != current_function_generation {
                return Err("Native watch startup receipt replacement is stale.".to_string());
            }
            replaced = gate.replace_startup_function_breakpoint_receipt(
                lease,
                target_generation.get(),
                WatchStartupFunctionBreakpointAuthority {
                    desired_revision: replayed.revision(),
                    function_generation: replayed_function_generation,
                    ordered_ids: &replayed_ids,
                },
                WatchStartupFunctionBreakpointAuthority {
                    desired_revision: current.revision(),
                    function_generation: current_function_generation,
                    ordered_ids: &current_ids,
                },
                verification,
            );
            replaced
                .then_some(())
                .ok_or_else(|| "Native watch startup receipt replacement failed.".to_string())
        },
    )?;
    if !replaced {
        return Err(());
    }
    Ok(Some((
        current.revision(),
        current_function_generation,
        current_ids,
    )))
}

pub(super) fn function_breakpoint_authority(
    plan: &DesiredDebuggerReplayPlan,
) -> Option<(u64, Vec<String>)> {
    let mut authority = None;
    for step in plan.steps() {
        if let DesiredDebuggerReplayStep::SetFunctionBreakpoints {
            breakpoints,
            generation,
        } = step
        {
            if authority.is_some() {
                return None;
            }
            authority = Some((
                *generation,
                breakpoints
                    .iter()
                    .map(|breakpoint| breakpoint.id.clone())
                    .collect(),
            ));
        }
    }
    authority
}

#[cfg(test)]
#[path = "debug_node_watch_cdp_reconcile_tests.rs"]
mod tests;
