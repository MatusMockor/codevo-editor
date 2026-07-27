use super::watch_generation::TargetGeneration;
use super::watch_inspection_contract::{
    WatchEvaluateRequest, WatchEvaluateResult, WatchScopesRequest, WatchScopesResult,
    WatchSetExpressionRequest, WatchSetExpressionResult, WatchSetVariableRequest,
    WatchSetVariableResult, WatchStackTraceRequest, WatchStackTraceResult, WatchVariablesRequest,
    WatchVariablesResult,
};
use crate::debug_adapter::{
    DebugBreakpoint, DebugEvaluatePolicy, DebugExceptionPauseMode, DebugFunctionBreakpoint,
    DebugFunctionBreakpointVerification, DebugSetExpressionRequest as AdapterSetExpressionRequest,
    DebugSetExpressionResult as AdapterSetExpressionResult,
    DebugSetVariableRequest as AdapterSetVariableRequest,
    DebugSetVariableResult as AdapterSetVariableResult, DebugVariablePageRequest, StepKind,
};
use crate::debug_exception_type_filter::DebugExceptionTypeFilter;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// Narrow control boundary for a replaceable watch target.
///
/// A CDP bridge must provide its own non-reentrant serialization, normally a
/// command worker. The proxy never holds its state lock while invoking this
/// port, so callbacks may safely install, revoke, or query a generation.
pub(crate) trait WatchDebugControlPort: Send + Sync {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure>;

    /// Revokes the transport out-of-band. Mutation failures must not enqueue a
    /// `Close` behind the command that just timed out.
    fn revoke(&self) {}
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum WatchDebugControlCommand {
    Pause,
    Step(StepKind),
    CurrentPauseEpoch,
    RunIfWaitingForDebugger,
    StackTrace(WatchStackTraceRequest),
    Scopes(WatchScopesRequest),
    Variables(WatchVariablesRequest),
    Evaluate(WatchEvaluateRequest),
    SetVariable(WatchSetVariableRequest),
    SetExpression(WatchSetExpressionRequest),
    SetBreakpointsActive(bool),
    SetExceptionPause(WatchSetExceptionPauseRequest),
    SetBreakpoints(WatchSetBreakpointsRequest),
    SetFunctionBreakpoints(WatchSetFunctionBreakpointsRequest),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WatchSetExceptionPauseRequest {
    mode: DebugExceptionPauseMode,
    exception_type_filter: DebugExceptionTypeFilter,
}

impl WatchSetExceptionPauseRequest {
    pub(crate) fn new(
        mode: DebugExceptionPauseMode,
        exception_type_filter: DebugExceptionTypeFilter,
    ) -> Self {
        Self {
            mode,
            exception_type_filter,
        }
    }

    pub(crate) fn mode(&self) -> DebugExceptionPauseMode {
        self.mode
    }

    pub(crate) fn exception_type_filter(&self) -> &[String] {
        self.exception_type_filter.as_slice()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WatchSetBreakpointsRequest {
    file_path: String,
    breakpoints: Vec<DebugBreakpoint>,
}

impl WatchSetBreakpointsRequest {
    pub(crate) fn new(file_path: String, breakpoints: Vec<DebugBreakpoint>) -> Self {
        Self {
            file_path,
            breakpoints,
        }
    }

    pub(crate) fn file_path(&self) -> &str {
        &self.file_path
    }

    pub(crate) fn breakpoints(&self) -> &[DebugBreakpoint] {
        &self.breakpoints
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WatchSetFunctionBreakpointsRequest {
    breakpoints: Vec<DebugFunctionBreakpoint>,
    generation: u64,
}

impl WatchSetFunctionBreakpointsRequest {
    pub(crate) fn new(breakpoints: Vec<DebugFunctionBreakpoint>, generation: u64) -> Self {
        Self {
            breakpoints,
            generation,
        }
    }

    pub(crate) fn breakpoints(&self) -> &[DebugFunctionBreakpoint] {
        &self.breakpoints
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum WatchDebugControlResponse {
    Ack,
    PauseEpoch(u64),
    StackTrace(WatchStackTraceResult),
    Scopes(WatchScopesResult),
    Variables(WatchVariablesResult),
    Evaluate(WatchEvaluateResult),
    VariableSet(WatchSetVariableResult),
    ExpressionSet(WatchSetExpressionResult),
    BreakpointsVerified {
        file_path: String,
        breakpoints: Vec<DebugBreakpoint>,
    },
    FunctionBreakpointsVerified(Vec<DebugFunctionBreakpointVerification>),
}

impl WatchDebugControlResponse {
    pub(super) fn matches(&self, command: &WatchDebugControlCommand) -> bool {
        match (command, self) {
            (
                WatchDebugControlCommand::Pause
                | WatchDebugControlCommand::Step(_)
                | WatchDebugControlCommand::RunIfWaitingForDebugger
                | WatchDebugControlCommand::SetBreakpointsActive(_)
                | WatchDebugControlCommand::SetExceptionPause(_),
                Self::Ack,
            )
            | (WatchDebugControlCommand::CurrentPauseEpoch, Self::PauseEpoch(_)) => true,
            (WatchDebugControlCommand::StackTrace(request), Self::StackTrace(result)) => {
                result.validate().is_ok() && request.expected_pause_epoch() == result.pause_epoch()
            }
            (WatchDebugControlCommand::Scopes(request), Self::Scopes(result)) => {
                result.validate().is_ok()
                    && request.expected_pause_epoch() == result.pause_epoch()
                    && request.frame_id() == result.frame_id()
            }
            (WatchDebugControlCommand::Variables(request), Self::Variables(result)) => {
                result.validate(*request).is_ok()
            }
            (WatchDebugControlCommand::Evaluate(request), Self::Evaluate(result)) => {
                result.validate(request).is_ok()
            }
            (WatchDebugControlCommand::SetVariable(request), Self::VariableSet(result)) => {
                result.validate(request).is_ok()
            }
            (WatchDebugControlCommand::SetExpression(request), Self::ExpressionSet(result)) => {
                result.validate(request).is_ok()
            }
            (
                WatchDebugControlCommand::SetBreakpoints(request),
                Self::BreakpointsVerified {
                    file_path,
                    breakpoints,
                },
            ) => {
                file_path == request.file_path()
                    && breakpoints.len() == request.breakpoints().len()
                    && breakpoints
                        .iter()
                        .zip(request.breakpoints())
                        .all(|(actual, expected)| {
                            actual.id == expected.id
                                && actual.file_path == request.file_path()
                                && actual.column_number == expected.column_number
                                && actual.condition == expected.condition
                                && actual.hit_condition == expected.hit_condition
                                && actual.log_message == expected.log_message
                                && actual.enabled == expected.enabled
                        })
            }
            (
                WatchDebugControlCommand::SetFunctionBreakpoints(request),
                Self::FunctionBreakpointsVerified(verification),
            ) => {
                verification.len() == request.breakpoints().len()
                    && verification
                        .iter()
                        .zip(request.breakpoints())
                        .all(|(actual, expected)| actual.id == expected.id)
            }
            _ => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchDebugCommandFailure {
    QueueFull,
    ResponseTimeout,
    Revoked,
    StaleAuthority,
    TargetRejected,
    WorkerStopped,
    ResponseMismatch,
    StalePauseEpoch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchDebugControlFailure {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchDebugControlInstallFailure {
    StaleGeneration,
    InvalidPending,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum WatchDebugControlActivationFailure<PublishFailure> {
    Install(WatchDebugControlInstallFailure),
    BeforeVisible(PublishFailure),
}

struct ControlAuthority {
    current: AtomicBool,
}

struct ProxyAuthority;

const PENDING: u8 = 0;
const ACTIVATING: u8 = 1;
const ACTIVATED: u8 = 2;
const ABORTED: u8 = 3;

struct PendingAuthority {
    lifecycle: AtomicU8,
}

#[derive(Clone)]
pub(crate) struct WatchDebugControlLease {
    authority: Arc<ControlAuthority>,
    generation: TargetGeneration,
}

#[derive(Clone)]
pub(crate) struct WatchDebugControlPendingLease {
    owner: Arc<ProxyAuthority>,
    authority: Arc<PendingAuthority>,
    base_generation: Option<TargetGeneration>,
    base_active_authority: Option<Arc<ControlAuthority>>,
    generation: TargetGeneration,
    port: Arc<dyn WatchDebugControlPort>,
}

impl fmt::Debug for WatchDebugControlPendingLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WatchDebugControlPendingLease")
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for WatchDebugControlLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WatchDebugControlLease")
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

struct ActiveControl {
    authority: Arc<ControlAuthority>,
    generation: TargetGeneration,
    port: Arc<dyn WatchDebugControlPort>,
}

struct SelectedControl {
    authority: Arc<ControlAuthority>,
    generation: TargetGeneration,
    port: Arc<dyn WatchDebugControlPort>,
}

impl SelectedControl {
    /// The Acquire loads bracket the target call. If an install or revoke
    /// Release-store wins before admission or before the response is accepted,
    /// dispatch is rejected. The target call stays outside the proxy lock, so
    /// replacement never waits on target callbacks; an in-flight response from
    /// the replaced generation is simply discarded.
    fn dispatch(
        self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugControlFailure> {
        let response = self.dispatch_unchecked(command.clone())?;
        response
            .matches(&command)
            .then_some(response)
            .ok_or(WatchDebugControlFailure::ResponseMismatch)
    }

    fn dispatch_unchecked(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugControlFailure> {
        if !self.authority.current.load(Ordering::Acquire) {
            return Err(WatchDebugControlFailure::Revoked);
        }
        let outcome = self.port.execute(command);
        if !self.authority.current.load(Ordering::Acquire) {
            return Err(WatchDebugControlFailure::Revoked);
        }
        outcome.map_err(map_command_failure)
    }
}

#[derive(Default)]
struct WatchDebugControlState {
    active: Option<ActiveControl>,
    last_generation: Option<TargetGeneration>,
}

#[derive(Clone)]
pub(crate) struct WatchDebugControlProxy {
    state: Arc<Mutex<WatchDebugControlState>>,
    authority: Arc<ProxyAuthority>,
}

impl Default for WatchDebugControlProxy {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(WatchDebugControlState::default())),
            authority: Arc::new(ProxyAuthority),
        }
    }
}

impl fmt::Debug for WatchDebugControlProxy {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = lock_recover(&self.state);
        formatter
            .debug_struct("WatchDebugControlProxy")
            .field(
                "active_generation",
                &state.active.as_ref().map(|active| active.generation),
            )
            .field("last_generation", &state.last_generation)
            .finish()
    }
}

impl WatchDebugControlProxy {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Atomically revokes the previous authority and installs a strictly newer
    /// generation. A command entering after this returns cannot select the old
    /// target.
    pub(crate) fn install(
        &self,
        generation: TargetGeneration,
        port: Arc<dyn WatchDebugControlPort>,
    ) -> Result<WatchDebugControlLease, WatchDebugControlInstallFailure> {
        let pending = self.prepare_install(generation, port)?;
        self.activate_exact(&pending)
    }

    /// Prepares an opaque candidate against the exact current authority without
    /// revoking or exposing either port. Multiple candidates may be prepared,
    /// but activation of one invalidates every candidate based on the old state.
    pub(crate) fn prepare_install(
        &self,
        generation: TargetGeneration,
        port: Arc<dyn WatchDebugControlPort>,
    ) -> Result<WatchDebugControlPendingLease, WatchDebugControlInstallFailure> {
        let state = lock_recover(&self.state);
        if state
            .last_generation
            .is_some_and(|previous| generation.get() <= previous.get())
        {
            return Err(WatchDebugControlInstallFailure::StaleGeneration);
        }
        Ok(WatchDebugControlPendingLease {
            owner: Arc::clone(&self.authority),
            authority: Arc::new(PendingAuthority {
                lifecycle: AtomicU8::new(PENDING),
            }),
            base_generation: state.last_generation,
            base_active_authority: state
                .active
                .as_ref()
                .map(|active| Arc::clone(&active.authority)),
            generation,
            port,
        })
    }

    pub(crate) fn activate_exact(
        &self,
        pending: &WatchDebugControlPendingLease,
    ) -> Result<WatchDebugControlLease, WatchDebugControlInstallFailure> {
        match self.activate_exact_with(pending, || Ok::<(), std::convert::Infallible>(())) {
            Ok(lease) => Ok(lease),
            Err(WatchDebugControlActivationFailure::Install(failure)) => Err(failure),
            Err(WatchDebugControlActivationFailure::BeforeVisible(never)) => match never {},
        }
    }

    /// Runs a controlled, non-reentrant publication barrier while command
    /// selection is excluded. Regular target dispatch still happens without
    /// this state lock. The previous target remains current if the barrier
    /// fails; only a successful barrier is followed by revoke-and-publish.
    pub(crate) fn activate_exact_with<PublishFailure>(
        &self,
        pending: &WatchDebugControlPendingLease,
        before_visible: impl FnOnce() -> Result<(), PublishFailure>,
    ) -> Result<WatchDebugControlLease, WatchDebugControlActivationFailure<PublishFailure>> {
        let mut state = lock_recover(&self.state);
        self.validate_pending(&state, pending)
            .map_err(WatchDebugControlActivationFailure::Install)?;
        pending
            .authority
            .lifecycle
            .compare_exchange(PENDING, ACTIVATING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                WatchDebugControlActivationFailure::Install(
                    WatchDebugControlInstallFailure::InvalidPending,
                )
            })?;
        if let Err(failure) = before_visible() {
            pending
                .authority
                .lifecycle
                .store(ABORTED, Ordering::Release);
            return Err(WatchDebugControlActivationFailure::BeforeVisible(failure));
        }
        pending
            .authority
            .lifecycle
            .store(ACTIVATED, Ordering::Release);
        if let Some(previous) = state.active.take() {
            previous.authority.current.store(false, Ordering::Release);
        }
        let authority = Arc::new(ControlAuthority {
            current: AtomicBool::new(true),
        });
        state.last_generation = Some(pending.generation);
        state.active = Some(ActiveControl {
            authority: Arc::clone(&authority),
            generation: pending.generation,
            port: Arc::clone(&pending.port),
        });
        Ok(WatchDebugControlLease {
            authority,
            generation: pending.generation,
        })
    }

    /// Aborts only the exact pending token. Repeated, activated, or foreign
    /// aborts are harmless and report false.
    pub(crate) fn abort_pending(&self, pending: &WatchDebugControlPendingLease) -> bool {
        Arc::ptr_eq(&self.authority, &pending.owner)
            && pending
                .authority
                .lifecycle
                .compare_exchange(PENDING, ABORTED, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
    }

    /// Revokes only the exact opaque owner. A stale or foreign lease cannot
    /// disturb the current target even with the same numeric generation.
    pub(crate) fn revoke(&self, lease: &WatchDebugControlLease) -> bool {
        let mut state = lock_recover(&self.state);
        let owns = state.active.as_ref().is_some_and(|active| {
            active.generation == lease.generation
                && Arc::ptr_eq(&active.authority, &lease.authority)
        });
        if !owns {
            return false;
        }
        let active = state.active.take().expect("exact active control");
        active.authority.current.store(false, Ordering::Release);
        true
    }

    pub(crate) fn is_current(&self, lease: &WatchDebugControlLease) -> bool {
        let state = lock_recover(&self.state);
        state.active.as_ref().is_some_and(|active| {
            active.generation == lease.generation
                && Arc::ptr_eq(&active.authority, &lease.authority)
                && active.authority.current.load(Ordering::Acquire)
        })
    }

    pub(crate) fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugControlFailure> {
        self.select_current()?.dispatch(command)
    }

    /// Accepts a response and commits its logical mutation while replacement
    /// publication is excluded by the same proxy state lock.
    pub(crate) fn execute_and_commit<R>(
        &self,
        command: WatchDebugControlCommand,
        commit: impl FnOnce(WatchDebugControlResponse) -> Result<R, WatchDebugControlFailure>,
    ) -> Result<R, WatchDebugControlFailure> {
        let selected = self.select_current()?;
        let authority = Arc::clone(&selected.authority);
        let generation = selected.generation;
        let target_port = Arc::clone(&selected.port);
        let response = match selected.dispatch_unchecked(command.clone()) {
            Ok(response) if response.matches(&command) => response,
            Ok(_) => {
                self.revoke_generation_after_mutation_failure(generation, &authority, &target_port);
                return Err(WatchDebugControlFailure::ResponseMismatch);
            }
            Err(failure) => {
                if mutation_outcome_is_uncertain(failure) {
                    self.revoke_generation_after_mutation_failure(
                        generation,
                        &authority,
                        &target_port,
                    );
                }
                return Err(failure);
            }
        };
        let mut state = lock_recover(&self.state);
        let current = state.active.as_ref().is_some_and(|active| {
            active.generation == generation
                && Arc::ptr_eq(&active.authority, &authority)
                && active.authority.current.load(Ordering::Acquire)
        });
        if !current {
            return Err(WatchDebugControlFailure::Revoked);
        }
        match commit(response) {
            Ok(value) => Ok(value),
            Err(failure) => {
                let active = state.active.take().expect("validated active control");
                active.authority.current.store(false, Ordering::Release);
                drop(state);
                target_port.revoke();
                Err(failure)
            }
        }
    }

    fn revoke_generation_after_mutation_failure(
        &self,
        generation: TargetGeneration,
        authority: &Arc<ControlAuthority>,
        target_port: &Arc<dyn WatchDebugControlPort>,
    ) {
        let mut state = lock_recover(&self.state);
        let owns = state.active.as_ref().is_some_and(|active| {
            active.generation == generation && Arc::ptr_eq(&active.authority, authority)
        });
        if !owns {
            return;
        }
        let active = state.active.take().expect("validated active control");
        active.authority.current.store(false, Ordering::Release);
        drop(state);
        target_port.revoke();
    }

    pub(crate) fn pause(&self) -> Result<(), WatchDebugControlFailure> {
        match self.execute(WatchDebugControlCommand::Pause)? {
            WatchDebugControlResponse::Ack => Ok(()),
            WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn step(&self, kind: StepKind) -> Result<(), WatchDebugControlFailure> {
        match self.execute(WatchDebugControlCommand::Step(kind))? {
            WatchDebugControlResponse::Ack => Ok(()),
            WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn current_pause_epoch(&self) -> Result<u64, WatchDebugControlFailure> {
        match self.execute(WatchDebugControlCommand::CurrentPauseEpoch)? {
            WatchDebugControlResponse::PauseEpoch(epoch) => Ok(epoch),
            WatchDebugControlResponse::Ack
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn stack_trace(
        &self,
        expected_pause_epoch: u64,
    ) -> Result<WatchStackTraceResult, WatchDebugControlFailure> {
        let request = WatchStackTraceRequest::new(expected_pause_epoch)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        match self.execute(WatchDebugControlCommand::StackTrace(request))? {
            WatchDebugControlResponse::StackTrace(result) => {
                result
                    .validate()
                    .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
                Ok(result)
            }
            WatchDebugControlResponse::Ack
            | WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn scopes(
        &self,
        expected_pause_epoch: u64,
        frame_id: u64,
    ) -> Result<WatchScopesResult, WatchDebugControlFailure> {
        let request = WatchScopesRequest::new(expected_pause_epoch, frame_id)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        match self.execute(WatchDebugControlCommand::Scopes(request))? {
            WatchDebugControlResponse::Scopes(result) => {
                result
                    .validate()
                    .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
                Ok(result)
            }
            WatchDebugControlResponse::Ack
            | WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn variables_page(
        &self,
        request: DebugVariablePageRequest,
    ) -> Result<WatchVariablesResult, WatchDebugControlFailure> {
        let request = WatchVariablesRequest::new(request)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        match self.execute(WatchDebugControlCommand::Variables(request))? {
            WatchDebugControlResponse::Variables(result) => {
                result
                    .validate(request)
                    .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
                Ok(result)
            }
            WatchDebugControlResponse::Ack
            | WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn evaluate(
        &self,
        expected_pause_epoch: u64,
        frame_id: u64,
        expression: String,
        policy: DebugEvaluatePolicy,
    ) -> Result<WatchEvaluateResult, WatchDebugControlFailure> {
        let request = WatchEvaluateRequest::new(expected_pause_epoch, frame_id, expression, policy)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        match self.execute(WatchDebugControlCommand::Evaluate(request.clone()))? {
            WatchDebugControlResponse::Evaluate(result) => {
                result
                    .validate(&request)
                    .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
                Ok(result)
            }
            WatchDebugControlResponse::Ack
            | WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => {
                Err(WatchDebugControlFailure::ResponseMismatch)
            }
        }
    }

    pub(crate) fn set_variable(
        &self,
        request: AdapterSetVariableRequest,
    ) -> Result<AdapterSetVariableResult, WatchDebugControlFailure> {
        let request = WatchSetVariableRequest::new(request)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        self.execute_and_commit(WatchDebugControlCommand::SetVariable(request), |response| {
            match response {
                WatchDebugControlResponse::VariableSet(result) => Ok(result.into_result()),
                _ => Err(WatchDebugControlFailure::ResponseMismatch),
            }
        })
    }

    pub(crate) fn set_expression(
        &self,
        request: AdapterSetExpressionRequest,
    ) -> Result<AdapterSetExpressionResult, WatchDebugControlFailure> {
        let request = WatchSetExpressionRequest::new(request)
            .map_err(|()| WatchDebugControlFailure::TargetRejected)?;
        self.execute_and_commit(
            WatchDebugControlCommand::SetExpression(request),
            |response| match response {
                WatchDebugControlResponse::ExpressionSet(result) => Ok(result.into_result()),
                _ => Err(WatchDebugControlFailure::ResponseMismatch),
            },
        )
    }

    fn select_current(&self) -> Result<SelectedControl, WatchDebugControlFailure> {
        let state = lock_recover(&self.state);
        let active = state
            .active
            .as_ref()
            .ok_or(WatchDebugControlFailure::NoActiveTarget)?;
        if !active.authority.current.load(Ordering::Acquire) {
            return Err(WatchDebugControlFailure::Revoked);
        }
        Ok(SelectedControl {
            authority: Arc::clone(&active.authority),
            generation: active.generation,
            port: Arc::clone(&active.port),
        })
    }

    fn validate_pending(
        &self,
        state: &WatchDebugControlState,
        pending: &WatchDebugControlPendingLease,
    ) -> Result<(), WatchDebugControlInstallFailure> {
        if !Arc::ptr_eq(&self.authority, &pending.owner)
            || pending.authority.lifecycle.load(Ordering::Acquire) != PENDING
        {
            return Err(WatchDebugControlInstallFailure::InvalidPending);
        }
        if state.last_generation != pending.base_generation
            || state
                .last_generation
                .is_some_and(|previous| pending.generation.get() <= previous.get())
            || !same_optional_authority(
                state.active.as_ref().map(|active| &active.authority),
                pending.base_active_authority.as_ref(),
            )
        {
            return Err(WatchDebugControlInstallFailure::StaleGeneration);
        }
        Ok(())
    }
}

fn same_optional_authority(
    left: Option<&Arc<ControlAuthority>>,
    right: Option<&Arc<ControlAuthority>>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => Arc::ptr_eq(left, right),
        (None, None) => true,
        (Some(_), None) | (None, Some(_)) => false,
    }
}

/// `execute_and_commit` is entered only after a logical mutation has been
/// prepared. Queue admission and authority failures are known to happen before
/// the worker invokes the runtime. Every other transport/runtime failure below
/// can be observed after the target accepted or applied the mutation, so the
/// exact generation must be discarded instead of remaining live with desired
/// state that was intentionally not committed.
fn mutation_outcome_is_uncertain(failure: WatchDebugControlFailure) -> bool {
    matches!(
        failure,
        WatchDebugControlFailure::ResponseTimeout
            | WatchDebugControlFailure::TargetRejected
            | WatchDebugControlFailure::WorkerStopped
            | WatchDebugControlFailure::ResponseMismatch
            | WatchDebugControlFailure::StalePauseEpoch
    )
}

fn map_command_failure(failure: WatchDebugCommandFailure) -> WatchDebugControlFailure {
    match failure {
        WatchDebugCommandFailure::QueueFull => WatchDebugControlFailure::QueueFull,
        WatchDebugCommandFailure::ResponseTimeout => WatchDebugControlFailure::ResponseTimeout,
        WatchDebugCommandFailure::Revoked => WatchDebugControlFailure::Revoked,
        WatchDebugCommandFailure::StaleAuthority => WatchDebugControlFailure::StaleAuthority,
        WatchDebugCommandFailure::TargetRejected => WatchDebugControlFailure::TargetRejected,
        WatchDebugCommandFailure::WorkerStopped => WatchDebugControlFailure::WorkerStopped,
        WatchDebugCommandFailure::ResponseMismatch => WatchDebugControlFailure::ResponseMismatch,
        WatchDebugCommandFailure::StalePauseEpoch => WatchDebugControlFailure::StalePauseEpoch,
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "debug_node_watch_control_proxy_tests.rs"]
mod tests;
