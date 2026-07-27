use super::watch_desired_policy::{DesiredDebuggerReplayPlan, DesiredDebuggerReplayStep};
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugExceptionPauseMode, DebugFunctionBreakpoint,
    DebugFunctionBreakpointVerification, DebugJustMyCodePolicy,
};
use crate::debug_cdp::transport::NodeCdpAdapter;
use crate::debug_exception_type_filter::DebugExceptionTypeFilter;
use std::collections::HashSet;

pub(super) trait WatchCdpProtocol {
    fn enable_runtime(&mut self) -> Result<(), ()>;
    fn enable_debugger(&mut self) -> Result<(), ()>;
    fn apply_internal_step_filter(
        &mut self,
        policy: Option<DebugJustMyCodePolicy>,
    ) -> Result<(), ()>;
    fn set_exception_pause(&mut self, mode: DebugExceptionPauseMode) -> Result<(), ()>;
    fn set_exception_pause_filter(
        &mut self,
        mode: DebugExceptionPauseMode,
        exception_type_filter: &DebugExceptionTypeFilter,
    ) -> Result<(), ()> {
        if !exception_type_filter.is_empty() {
            return Err(());
        }
        self.set_exception_pause(mode)
    }
    fn set_breakpoints_active(&mut self, active: bool) -> Result<(), ()>;
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<(), ()>;
    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[DebugFunctionBreakpoint],
        generation: u64,
        publish: &mut dyn FnMut(
            u64,
            Vec<DebugFunctionBreakpointVerification>,
        ) -> Result<(), String>,
    ) -> Result<(), ()>;
}

impl WatchCdpProtocol for NodeCdpAdapter {
    fn enable_runtime(&mut self) -> Result<(), ()> {
        self.watch_enable_runtime().map_err(|_| ())
    }

    fn enable_debugger(&mut self) -> Result<(), ()> {
        self.watch_enable_debugger().map_err(|_| ())
    }

    fn apply_internal_step_filter(
        &mut self,
        policy: Option<DebugJustMyCodePolicy>,
    ) -> Result<(), ()> {
        self.watch_apply_internal_step_filter(policy)
            .map_err(|_| ())
    }

    fn set_exception_pause_filter(
        &mut self,
        mode: DebugExceptionPauseMode,
        exception_type_filter: &DebugExceptionTypeFilter,
    ) -> Result<(), ()> {
        DebugAdapter::set_exception_pause_filter(self, mode, exception_type_filter.as_slice())
            .map_err(|_| ())
    }

    fn set_exception_pause(&mut self, mode: DebugExceptionPauseMode) -> Result<(), ()> {
        DebugAdapter::set_exception_pause(self, mode).map_err(|_| ())
    }

    fn set_breakpoints_active(&mut self, active: bool) -> Result<(), ()> {
        DebugAdapter::set_breakpoints_active(self, active).map_err(|_| ())
    }

    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<(), ()> {
        DebugAdapter::set_breakpoints(self, file_path, breakpoints)
            .map(|_| ())
            .map_err(|_| ())
    }

    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[DebugFunctionBreakpoint],
        generation: u64,
        publish: &mut dyn FnMut(
            u64,
            Vec<DebugFunctionBreakpointVerification>,
        ) -> Result<(), String>,
    ) -> Result<(), ()> {
        self.watch_set_function_breakpoints_with_publication(breakpoints, generation, publish)
            .map_err(|_| ())
    }
}

#[cfg(test)]
pub(super) fn apply_replay_setup(
    adapter: &mut impl WatchCdpProtocol,
    steps: &[DesiredDebuggerReplayStep],
    is_current: impl Fn() -> bool,
) -> Result<(), ()> {
    apply_replay_setup_with_function_publication(adapter, steps, is_current, &mut |_, _| Ok(()))
}

pub(super) fn apply_replay_setup_with_function_publication(
    adapter: &mut impl WatchCdpProtocol,
    steps: &[DesiredDebuggerReplayStep],
    is_current: impl Fn() -> bool,
    publish: &mut dyn FnMut(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
) -> Result<(), ()> {
    apply_replay_setup_with_function_policy(
        adapter,
        steps,
        is_current,
        FunctionBreakpointReplayPolicy::Apply,
        publish,
    )
}

#[derive(Clone, Copy)]
enum FunctionBreakpointReplayPolicy {
    Apply,
    PreserveInstalledAuthority,
}

fn apply_replay_setup_with_function_policy(
    adapter: &mut impl WatchCdpProtocol,
    steps: &[DesiredDebuggerReplayStep],
    is_current: impl Fn() -> bool,
    function_policy: FunctionBreakpointReplayPolicy,
    publish: &mut dyn FnMut(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
) -> Result<(), ()> {
    for step in steps {
        if !is_current() {
            return Err(());
        }
        if !matches!(
            (function_policy, step),
            (
                FunctionBreakpointReplayPolicy::PreserveInstalledAuthority,
                DesiredDebuggerReplayStep::SetFunctionBreakpoints { .. }
            )
        ) {
            apply_replay_step(adapter, step, publish)?;
        }
        if !is_current() {
            return Err(());
        }
    }
    Ok(())
}

fn apply_replay_step(
    adapter: &mut impl WatchCdpProtocol,
    step: &DesiredDebuggerReplayStep,
    publish: &mut dyn FnMut(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
) -> Result<(), ()> {
    match step {
        DesiredDebuggerReplayStep::EnableRuntime => adapter.enable_runtime(),
        DesiredDebuggerReplayStep::EnableDebugger => adapter.enable_debugger(),
        DesiredDebuggerReplayStep::ApplyInternalStepFilter(policy) => {
            adapter.apply_internal_step_filter(*policy)
        }
        DesiredDebuggerReplayStep::SetExceptionPause {
            mode,
            exception_type_filter,
        } => adapter.set_exception_pause_filter(*mode, exception_type_filter),
        DesiredDebuggerReplayStep::SetBreakpointsActive(active) => {
            adapter.set_breakpoints_active(*active)
        }
        DesiredDebuggerReplayStep::SetBreakpoints {
            file_path,
            breakpoints,
        } => adapter.set_breakpoints(file_path, breakpoints),
        DesiredDebuggerReplayStep::SetFunctionBreakpoints {
            breakpoints,
            generation,
        } => adapter.set_function_breakpoints(breakpoints, *generation, publish),
        DesiredDebuggerReplayStep::RunIfWaitingForDebugger => Err(()),
    }
}

pub(super) fn reconcile_replay_setup(
    adapter: &mut impl WatchCdpProtocol,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
) -> Result<(), ()> {
    reconcile_replay_setup_with_function_publication(
        adapter,
        replayed,
        current,
        is_current,
        &mut |_, _| Ok(()),
    )
}

pub(super) fn reconcile_replay_setup_preserving_function_breakpoints(
    adapter: &mut impl WatchCdpProtocol,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
) -> Result<(), ()> {
    reconcile_replay_setup_with_policy(
        adapter,
        replayed,
        current,
        is_current,
        FunctionBreakpointReplayPolicy::PreserveInstalledAuthority,
        &mut |_, _| Ok(()),
    )
}

pub(super) fn reconcile_replay_setup_with_function_publication(
    adapter: &mut impl WatchCdpProtocol,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
    publish: &mut dyn FnMut(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
) -> Result<(), ()> {
    reconcile_replay_setup_with_policy(
        adapter,
        replayed,
        current,
        is_current,
        FunctionBreakpointReplayPolicy::Apply,
        publish,
    )
}

fn reconcile_replay_setup_with_policy(
    adapter: &mut impl WatchCdpProtocol,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
    function_policy: FunctionBreakpointReplayPolicy,
    publish: &mut dyn FnMut(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
) -> Result<(), ()> {
    let current_files: HashSet<&str> = current
        .steps()
        .iter()
        .filter_map(|step| match step {
            DesiredDebuggerReplayStep::SetBreakpoints { file_path, .. } => Some(file_path.as_str()),
            _ => None,
        })
        .collect();
    for file_path in replayed.steps().iter().filter_map(|step| match step {
        DesiredDebuggerReplayStep::SetBreakpoints { file_path, .. }
            if !current_files.contains(file_path.as_str()) =>
        {
            Some(file_path.as_str())
        }
        _ => None,
    }) {
        if !is_current() {
            return Err(());
        }
        adapter.set_breakpoints(file_path, &[])?;
    }
    let Some((run, setup)) = current.steps().split_last() else {
        return Err(());
    };
    if !matches!(run, DesiredDebuggerReplayStep::RunIfWaitingForDebugger) {
        return Err(());
    }
    apply_replay_setup_with_function_policy(adapter, setup, is_current, function_policy, publish)
}
