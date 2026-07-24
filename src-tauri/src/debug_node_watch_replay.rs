use super::watch_desired_policy::{DesiredDebuggerReplayPlan, DesiredDebuggerReplayStep};
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugExceptionPauseMode, DebugFunctionBreakpoint,
    DebugJustMyCodePolicy,
};
use crate::debug_cdp::transport::NodeCdpAdapter;
use std::collections::HashSet;

pub(super) trait WatchCdpProtocol {
    fn enable_runtime(&mut self) -> Result<(), ()>;
    fn enable_debugger(&mut self) -> Result<(), ()>;
    fn apply_internal_step_filter(
        &mut self,
        policy: Option<DebugJustMyCodePolicy>,
    ) -> Result<(), ()>;
    fn set_exception_pause(&mut self, mode: DebugExceptionPauseMode) -> Result<(), ()>;
    fn set_breakpoints_active(&mut self, active: bool) -> Result<(), ()>;
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<(), ()>;
    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[DebugFunctionBreakpoint],
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
    ) -> Result<(), ()> {
        DebugAdapter::set_function_breakpoints(self, breakpoints)
            .map(|_| ())
            .map_err(|_| ())
    }
}

pub(super) fn apply_replay_setup(
    adapter: &mut impl WatchCdpProtocol,
    steps: &[DesiredDebuggerReplayStep],
    is_current: impl Fn() -> bool,
) -> Result<(), ()> {
    for step in steps {
        if !is_current() {
            return Err(());
        }
        apply_replay_step(adapter, step)?;
        if !is_current() {
            return Err(());
        }
    }
    Ok(())
}

fn apply_replay_step(
    adapter: &mut impl WatchCdpProtocol,
    step: &DesiredDebuggerReplayStep,
) -> Result<(), ()> {
    match step {
        DesiredDebuggerReplayStep::EnableRuntime => adapter.enable_runtime(),
        DesiredDebuggerReplayStep::EnableDebugger => adapter.enable_debugger(),
        DesiredDebuggerReplayStep::ApplyInternalStepFilter(policy) => {
            adapter.apply_internal_step_filter(*policy)
        }
        DesiredDebuggerReplayStep::SetExceptionPause(mode) => adapter.set_exception_pause(*mode),
        DesiredDebuggerReplayStep::SetBreakpointsActive(active) => {
            adapter.set_breakpoints_active(*active)
        }
        DesiredDebuggerReplayStep::SetBreakpoints {
            file_path,
            breakpoints,
        } => adapter.set_breakpoints(file_path, breakpoints),
        DesiredDebuggerReplayStep::SetFunctionBreakpoints { breakpoints } => {
            adapter.set_function_breakpoints(breakpoints)
        }
        DesiredDebuggerReplayStep::RunIfWaitingForDebugger => Err(()),
    }
}

pub(super) fn reconcile_replay_setup(
    adapter: &mut impl WatchCdpProtocol,
    replayed: &DesiredDebuggerReplayPlan,
    current: &DesiredDebuggerReplayPlan,
    is_current: impl Fn() -> bool,
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
    apply_replay_setup(adapter, setup, is_current)
}
