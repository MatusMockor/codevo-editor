use super::watch_breakpoint_sync::{WatchBreakpointSyncFailure, WatchBreakpointSynchronizer};
use super::watch_control_proxy::{WatchDebugControlFailure, WatchDebugControlProxy};
use super::watch_inspection_contract::{WatchScopesResult, WatchStackTraceResult};
use crate::debug_adapter::{
    DebugBreakpoint, DebugEvaluateFailure, DebugEvaluatePolicy, DebugExceptionPauseMode,
    DebugFunctionBreakpoint, DebugFunctionBreakpointVerification, DebugSetExpressionRequest,
    DebugSetExpressionResult, DebugSetVariableRequest, DebugSetVariableResult, DebugVariableInfo,
    DebugVariablePage, DebugVariablePageRequest, StepKind,
};
use std::sync::Arc;

/// Stable, internal control surface for the logical Node.js watch session.
///
/// Startup-only commands intentionally stay below this boundary. The
/// reconnect owner uses them before publishing a target through the proxy, so
/// callers of this adapter can only control an already-active generation.
#[derive(Clone, Debug)]
pub(crate) struct WatchNodeDebugAdapter {
    control: WatchDebugControlProxy,
    breakpoints: Option<Arc<WatchBreakpointSynchronizer>>,
}

impl WatchNodeDebugAdapter {
    pub(crate) fn new(control: WatchDebugControlProxy) -> Self {
        Self {
            control,
            breakpoints: None,
        }
    }

    pub(crate) fn with_breakpoint_sync(
        control: WatchDebugControlProxy,
        breakpoints: Arc<WatchBreakpointSynchronizer>,
    ) -> Self {
        Self {
            control,
            breakpoints: Some(breakpoints),
        }
    }

    pub(crate) fn set_breakpoints(
        &self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, WatchNodeDebugAdapterFailure> {
        self.breakpoints
            .as_ref()
            .ok_or(WatchNodeDebugAdapterFailure::BreakpointSyncUnavailable)?
            .set_breakpoints(file_path, breakpoints)
            .map_err(Into::into)
    }

    pub(crate) fn set_breakpoints_active(
        &self,
        active: bool,
    ) -> Result<(), WatchNodeDebugAdapterFailure> {
        self.breakpoints
            .as_ref()
            .ok_or(WatchNodeDebugAdapterFailure::BreakpointSyncUnavailable)?
            .set_breakpoints_active(active)
            .map_err(Into::into)
    }

    pub(crate) fn set_function_breakpoints(
        &self,
        breakpoints: &[DebugFunctionBreakpoint],
    ) -> Result<Vec<DebugFunctionBreakpointVerification>, WatchNodeDebugAdapterFailure> {
        self.breakpoints
            .as_ref()
            .ok_or(WatchNodeDebugAdapterFailure::BreakpointSyncUnavailable)?
            .set_function_breakpoints(breakpoints)
            .map_err(Into::into)
    }

    pub(crate) fn set_exception_pause(
        &self,
        mode: DebugExceptionPauseMode,
    ) -> Result<(), WatchNodeDebugAdapterFailure> {
        self.breakpoints
            .as_ref()
            .ok_or(WatchNodeDebugAdapterFailure::BreakpointSyncUnavailable)?
            .set_exception_pause(mode)
            .map_err(Into::into)
    }

    pub(crate) fn pause(&self) -> Result<(), WatchNodeDebugAdapterFailure> {
        self.control.pause().map_err(Into::into)
    }

    pub(crate) fn step(&self, kind: StepKind) -> Result<(), WatchNodeDebugAdapterFailure> {
        self.control.step(kind).map_err(Into::into)
    }

    pub(crate) fn current_pause_epoch(&self) -> Result<u64, WatchNodeDebugAdapterFailure> {
        self.control.current_pause_epoch().map_err(Into::into)
    }

    pub(crate) fn stack_trace(
        &self,
        expected_pause_epoch: u64,
    ) -> Result<WatchStackTraceResult, WatchNodeDebugAdapterFailure> {
        self.control
            .stack_trace(expected_pause_epoch)
            .map_err(Into::into)
    }

    pub(crate) fn scopes(
        &self,
        expected_pause_epoch: u64,
        frame_id: u64,
    ) -> Result<WatchScopesResult, WatchNodeDebugAdapterFailure> {
        self.control
            .scopes(expected_pause_epoch, frame_id)
            .map_err(Into::into)
    }

    pub(crate) fn variables_page(
        &self,
        request: DebugVariablePageRequest,
    ) -> Result<DebugVariablePage, WatchNodeDebugAdapterFailure> {
        self.control
            .variables_page(request)
            .map(|result| result.into_page())
            .map_err(Into::into)
    }

    pub(crate) fn evaluate(
        &self,
        expected_pause_epoch: u64,
        frame_id: u64,
        expression: String,
        policy: DebugEvaluatePolicy,
    ) -> Result<Result<DebugVariableInfo, DebugEvaluateFailure>, WatchNodeDebugAdapterFailure> {
        self.control
            .evaluate(expected_pause_epoch, frame_id, expression, policy)
            .map(|result| result.into_outcome())
            .map_err(Into::into)
    }

    pub(crate) fn set_variable(
        &self,
        request: DebugSetVariableRequest,
    ) -> Result<DebugSetVariableResult, WatchNodeDebugAdapterFailure> {
        self.control.set_variable(request).map_err(Into::into)
    }

    pub(crate) fn set_expression(
        &self,
        request: DebugSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, WatchNodeDebugAdapterFailure> {
        self.control.set_expression(request).map_err(Into::into)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchNodeDebugAdapterFailure {
    BreakpointSyncUnavailable,
    InvalidBreakpointPolicy,
    NoActiveTarget,
    Revoked,
    QueueFull,
    ResponseTimeout,
    StaleAuthority,
    TargetRejected,
    WorkerStopped,
    ResponseMismatch,
    StalePauseEpoch,
}

impl From<WatchBreakpointSyncFailure> for WatchNodeDebugAdapterFailure {
    fn from(failure: WatchBreakpointSyncFailure) -> Self {
        match failure {
            WatchBreakpointSyncFailure::InvalidPolicy => Self::InvalidBreakpointPolicy,
            WatchBreakpointSyncFailure::NoActiveTarget => Self::NoActiveTarget,
            WatchBreakpointSyncFailure::Revoked => Self::Revoked,
            WatchBreakpointSyncFailure::QueueFull => Self::QueueFull,
            WatchBreakpointSyncFailure::ResponseTimeout => Self::ResponseTimeout,
            WatchBreakpointSyncFailure::StaleAuthority => Self::StaleAuthority,
            WatchBreakpointSyncFailure::TargetRejected => Self::TargetRejected,
            WatchBreakpointSyncFailure::WorkerStopped => Self::WorkerStopped,
            WatchBreakpointSyncFailure::ResponseMismatch => Self::ResponseMismatch,
            WatchBreakpointSyncFailure::StalePauseEpoch => Self::StalePauseEpoch,
        }
    }
}

impl From<WatchDebugControlFailure> for WatchNodeDebugAdapterFailure {
    fn from(failure: WatchDebugControlFailure) -> Self {
        match failure {
            WatchDebugControlFailure::NoActiveTarget => Self::NoActiveTarget,
            WatchDebugControlFailure::Revoked => Self::Revoked,
            WatchDebugControlFailure::QueueFull => Self::QueueFull,
            WatchDebugControlFailure::ResponseTimeout => Self::ResponseTimeout,
            WatchDebugControlFailure::StaleAuthority => Self::StaleAuthority,
            WatchDebugControlFailure::TargetRejected => Self::TargetRejected,
            WatchDebugControlFailure::WorkerStopped => Self::WorkerStopped,
            WatchDebugControlFailure::ResponseMismatch => Self::ResponseMismatch,
            WatchDebugControlFailure::StalePauseEpoch => Self::StalePauseEpoch,
        }
    }
}

#[cfg(test)]
#[path = "debug_node_watch_adapter_tests.rs"]
mod tests;
