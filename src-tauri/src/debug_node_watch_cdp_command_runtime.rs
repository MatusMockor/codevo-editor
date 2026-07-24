use super::watch_command_worker::WatchDebugCommandRuntime;
use super::watch_control_proxy::{
    WatchDebugCommandFailure, WatchDebugControlCommand, WatchDebugControlResponse,
};
use super::watch_inspection_contract::{
    WatchEvaluateRequest, WatchEvaluateResult, WatchScopesRequest, WatchScopesResult,
    WatchSetExpressionRequest, WatchSetExpressionResult, WatchSetVariableRequest,
    WatchSetVariableResult, WatchStackTraceRequest, WatchStackTraceResult, WatchVariablesRequest,
    WatchVariablesResult, MAX_SAFE_INTEGER,
};
use crate::debug_adapter::{
    DebugAdapter, DebugEvaluateFailure, DebugSetExpressionResult, DebugSetVariableResult,
    DebugVariableInfo, DebugVariablePage,
};
use crate::debug_cdp::transport::NodeCdpAdapter;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

/// Exclusive command-thread owner for one unpublished/internal watch adapter.
/// Construction does not install it into the controller, registry or IPC.
pub(crate) struct NodeCdpCommandRuntime {
    adapter: NodeCdpAdapter,
}

impl NodeCdpCommandRuntime {
    pub(crate) fn new(adapter: NodeCdpAdapter) -> Self {
        Self { adapter }
    }
}

impl WatchDebugCommandRuntime for NodeCdpCommandRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        ensure_current(deadline, revoked)?;
        match command {
            WatchDebugControlCommand::RunIfWaitingForDebugger => self
                .adapter
                .watch_run_if_waiting_for_debugger_until(deadline, revoked)
                .map(|()| WatchDebugControlResponse::Ack)
                .map_err(|_| classify_failure(deadline, revoked)),
            WatchDebugControlCommand::Pause => self
                .adapter
                .watch_pause_until(deadline, revoked)
                .map(|()| WatchDebugControlResponse::Ack)
                .map_err(|_| classify_failure(deadline, revoked)),
            WatchDebugControlCommand::Step(kind) => self
                .adapter
                .watch_step_until(kind, deadline, revoked)
                .map(|()| WatchDebugControlResponse::Ack)
                .map_err(|_| classify_failure(deadline, revoked)),
            WatchDebugControlCommand::CurrentPauseEpoch => {
                let epoch = self
                    .adapter
                    .watch_pause_generation_epoch()
                    .map_err(|_| WatchDebugCommandFailure::TargetRejected)?;
                if epoch > MAX_SAFE_INTEGER {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
                Ok(WatchDebugControlResponse::PauseEpoch(epoch))
            }
            WatchDebugControlCommand::StackTrace(request) => {
                stack_trace_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::StackTrace)
            }
            WatchDebugControlCommand::Scopes(request) => {
                scopes_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::Scopes)
            }
            WatchDebugControlCommand::Variables(request) => {
                variables_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::Variables)
            }
            WatchDebugControlCommand::Evaluate(request) => {
                evaluate_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::Evaluate)
            }
            WatchDebugControlCommand::SetVariable(request) => {
                set_variable_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::VariableSet)
            }
            WatchDebugControlCommand::SetExpression(request) => {
                set_expression_at_epoch(&mut self.adapter, request, deadline, revoked)
                    .map(WatchDebugControlResponse::ExpressionSet)
            }
            WatchDebugControlCommand::SetBreakpointsActive(active) => {
                ensure_current(deadline, revoked)?;
                DebugAdapter::set_breakpoints_active(&mut self.adapter, active)
                    .map_err(|_| classify_failure(deadline, revoked))?;
                ensure_current(deadline, revoked)?;
                Ok(WatchDebugControlResponse::Ack)
            }
            WatchDebugControlCommand::SetExceptionPause(mode) => {
                ensure_current(deadline, revoked)?;
                DebugAdapter::set_exception_pause(&mut self.adapter, mode)
                    .map_err(|_| classify_failure(deadline, revoked))?;
                ensure_current(deadline, revoked)?;
                Ok(WatchDebugControlResponse::Ack)
            }
            WatchDebugControlCommand::SetBreakpoints(request) => {
                ensure_current(deadline, revoked)?;
                let applied = self
                    .adapter
                    .set_breakpoints(request.file_path(), request.breakpoints())
                    .map_err(|_| classify_failure(deadline, revoked))?;
                ensure_current(deadline, revoked)?;
                Ok(WatchDebugControlResponse::BreakpointsVerified {
                    file_path: request.file_path().to_string(),
                    breakpoints: applied,
                })
            }
            WatchDebugControlCommand::SetFunctionBreakpoints(request) => {
                ensure_current(deadline, revoked)?;
                let verification = self
                    .adapter
                    .set_function_breakpoints(request.breakpoints())
                    .map_err(|_| classify_failure(deadline, revoked))?;
                ensure_current(deadline, revoked)?;
                Ok(WatchDebugControlResponse::FunctionBreakpointsVerified(
                    verification,
                ))
            }
        }
    }

    fn shutdown(&mut self, deadline: Instant, _revoked: &AtomicBool) {
        self.adapter.watch_terminate_until(deadline);
    }
}

trait WatchPausedInspection {
    fn current_pause_epoch(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Option<u64>, String>;
    fn read_stack_trace(
        &mut self,
        expected_pause_epoch: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchStackTraceResult, String>;
    fn read_scopes(
        &mut self,
        expected_pause_epoch: u64,
        frame_id: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchScopesResult, String>;
    fn owns_frame(&mut self, frame_id: u64) -> Result<bool, String>;
    fn read_variables_page(
        &mut self,
        request: WatchVariablesRequest,
    ) -> Result<DebugVariablePage, String>;
    fn evaluate_with_policy(
        &mut self,
        request: &WatchEvaluateRequest,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure>;
    fn set_variable(
        &mut self,
        request: &WatchSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String>;
    fn set_expression(
        &mut self,
        request: &WatchSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String>;
}

impl WatchPausedInspection for NodeCdpAdapter {
    fn current_pause_epoch(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Option<u64>, String> {
        self.watch_current_pause_generation_until(deadline, revoked)
    }

    fn read_stack_trace(
        &mut self,
        expected_pause_epoch: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchStackTraceResult, String> {
        self.watch_stack_trace_with_until(deadline, revoked, |frames| {
            WatchStackTraceResult::snapshot(expected_pause_epoch, frames, || {
                ensure_current(deadline, revoked).is_ok()
            })
            .map_err(|()| "The stack trace violates the bounded watch contract.".to_string())
        })
    }

    fn read_scopes(
        &mut self,
        expected_pause_epoch: u64,
        frame_id: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchScopesResult, String> {
        self.watch_scopes_with_until(frame_id, deadline, revoked, |scopes| {
            WatchScopesResult::snapshot(expected_pause_epoch, frame_id, scopes, || {
                ensure_current(deadline, revoked).is_ok()
            })
            .map_err(|()| "The scopes violate the bounded watch contract.".to_string())
        })
    }

    fn owns_frame(&mut self, frame_id: u64) -> Result<bool, String> {
        Ok(DebugAdapter::stack_trace(self)?
            .iter()
            .any(|frame| frame.frame_id == frame_id))
    }

    fn read_variables_page(
        &mut self,
        request: WatchVariablesRequest,
    ) -> Result<DebugVariablePage, String> {
        self.variables_page(request.request())
    }

    fn evaluate_with_policy(
        &mut self,
        request: &WatchEvaluateRequest,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        DebugAdapter::evaluate_with_policy(
            self,
            request.frame_id(),
            request.expression(),
            request.policy(),
        )
    }

    fn set_variable(
        &mut self,
        request: &WatchSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String> {
        DebugAdapter::set_variable(self, request.request().clone())
    }

    fn set_expression(
        &mut self,
        request: &WatchSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String> {
        DebugAdapter::set_expression(self, request.request().clone())
    }
}

fn stack_trace_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchStackTraceRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchStackTraceResult, WatchDebugCommandFailure> {
    WatchStackTraceRequest::new(request.expected_pause_epoch())
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    let result = adapter.read_stack_trace(request.expected_pause_epoch(), deadline, revoked);
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    let result = result.map_err(|_| WatchDebugCommandFailure::TargetRejected)?;
    (result.validate().is_ok() && result.pause_epoch() == request.expected_pause_epoch())
        .then_some(result)
        .ok_or(WatchDebugCommandFailure::TargetRejected)
}

fn scopes_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchScopesRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchScopesResult, WatchDebugCommandFailure> {
    WatchScopesRequest::new(request.expected_pause_epoch(), request.frame_id())
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    let result = adapter.read_scopes(
        request.expected_pause_epoch(),
        request.frame_id(),
        deadline,
        revoked,
    );
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    let result = result.map_err(|_| WatchDebugCommandFailure::TargetRejected)?;
    (result.validate().is_ok()
        && result.pause_epoch() == request.expected_pause_epoch()
        && result.frame_id() == request.frame_id())
    .then_some(result)
    .ok_or(WatchDebugCommandFailure::TargetRejected)
}

fn variables_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchVariablesRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchVariablesResult, WatchDebugCommandFailure> {
    WatchVariablesRequest::new(request.request())
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    let page = adapter.read_variables_page(request);
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    WatchVariablesResult::new(
        request,
        page.map_err(|_| WatchDebugCommandFailure::TargetRejected)?,
    )
    .map_err(|()| WatchDebugCommandFailure::TargetRejected)
}

fn evaluate_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchEvaluateRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchEvaluateResult, WatchDebugCommandFailure> {
    WatchEvaluateRequest::new(
        request.expected_pause_epoch(),
        request.frame_id(),
        request.expression().to_string(),
        request.policy(),
    )
    .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    ensure_frame_authority(adapter, request.frame_id(), deadline, revoked)?;
    let outcome = adapter.evaluate_with_policy(&request);
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    WatchEvaluateResult::new(&request, outcome)
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)
}

fn set_variable_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchSetVariableRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchSetVariableResult, WatchDebugCommandFailure> {
    WatchSetVariableRequest::new(request.request().clone())
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    ensure_frame_authority(adapter, request.frame_id(), deadline, revoked)?;
    let result = adapter.set_variable(&request);
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    WatchSetVariableResult::new(
        &request,
        result.map_err(|_| WatchDebugCommandFailure::TargetRejected)?,
    )
    .map_err(|()| WatchDebugCommandFailure::TargetRejected)
}

fn set_expression_at_epoch(
    adapter: &mut impl WatchPausedInspection,
    request: WatchSetExpressionRequest,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<WatchSetExpressionResult, WatchDebugCommandFailure> {
    WatchSetExpressionRequest::new(request.request().clone())
        .map_err(|()| WatchDebugCommandFailure::TargetRejected)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    ensure_frame_authority(adapter, request.frame_id(), deadline, revoked)?;
    let result = adapter.set_expression(&request);
    ensure_current(deadline, revoked)?;
    ensure_pause_epoch(adapter, request.expected_pause_epoch(), deadline, revoked)?;
    WatchSetExpressionResult::new(
        &request,
        result.map_err(|_| WatchDebugCommandFailure::TargetRejected)?,
    )
    .map_err(|()| WatchDebugCommandFailure::TargetRejected)
}

fn ensure_frame_authority(
    adapter: &mut impl WatchPausedInspection,
    frame_id: u64,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<(), WatchDebugCommandFailure> {
    ensure_current(deadline, revoked)?;
    adapter
        .owns_frame(frame_id)
        .map_err(|_| classify_failure(deadline, revoked))?
        .then_some(())
        .ok_or(WatchDebugCommandFailure::TargetRejected)
}

fn ensure_pause_epoch(
    adapter: &impl WatchPausedInspection,
    expected_pause_epoch: u64,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<(), WatchDebugCommandFailure> {
    ensure_current(deadline, revoked)?;
    (adapter
        .current_pause_epoch(deadline, revoked)
        .map_err(|_| classify_failure(deadline, revoked))?
        == Some(expected_pause_epoch))
    .then_some(())
    .ok_or(WatchDebugCommandFailure::StalePauseEpoch)
}

fn ensure_current(deadline: Instant, revoked: &AtomicBool) -> Result<(), WatchDebugCommandFailure> {
    if revoked.load(std::sync::atomic::Ordering::Acquire) {
        Err(WatchDebugCommandFailure::Revoked)
    } else if Instant::now() >= deadline {
        Err(WatchDebugCommandFailure::ResponseTimeout)
    } else {
        Ok(())
    }
}

fn classify_failure(deadline: Instant, revoked: &AtomicBool) -> WatchDebugCommandFailure {
    if revoked.load(std::sync::atomic::Ordering::Acquire) {
        WatchDebugCommandFailure::Revoked
    } else if deadline.saturating_duration_since(Instant::now()) == Duration::ZERO {
        WatchDebugCommandFailure::ResponseTimeout
    } else {
        WatchDebugCommandFailure::TargetRejected
    }
}

#[cfg(test)]
#[path = "debug_node_watch_cdp_command_runtime_tests.rs"]
mod tests;
