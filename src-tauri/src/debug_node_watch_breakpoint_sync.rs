use super::watch_control_proxy::{
    WatchDebugControlCommand, WatchDebugControlFailure, WatchDebugControlProxy,
    WatchDebugControlResponse, WatchSetBreakpointsRequest, WatchSetFunctionBreakpointsRequest,
};
use super::watch_desired_policy::{
    DesiredBreakpointReplacementCommitError, DesiredDebuggerPolicy, DesiredPolicyUpdateCommitError,
};
use crate::debug_adapter::{
    DebugBreakpoint, DebugExceptionPauseMode, DebugFunctionBreakpoint,
    DebugFunctionBreakpointVerification,
};
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

/// Serializes one complete live breakpoint mutation across desired-state
/// preparation, the exact active target ACK, and atomic generation/desired
/// commit.
#[derive(Debug)]
pub(crate) struct WatchBreakpointSynchronizer {
    root: PathBuf,
    breakpoint_kind: DebugBreakpointAdapterKind,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    control: WatchDebugControlProxy,
    mutation: Arc<Mutex<()>>,
}

impl WatchBreakpointSynchronizer {
    pub(crate) fn new(
        root: PathBuf,
        breakpoint_kind: DebugBreakpointAdapterKind,
        desired: Arc<Mutex<DesiredDebuggerPolicy>>,
        control: WatchDebugControlProxy,
        mutation: Arc<Mutex<()>>,
    ) -> Self {
        Self {
            root,
            breakpoint_kind,
            desired,
            control,
            mutation,
        }
    }

    pub(crate) fn set_breakpoints(
        &self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, WatchBreakpointSyncFailure> {
        let _mutation = lock_recover(&self.mutation);
        let prepared = lock_recover(&self.desired)
            .prepare_breakpoint_replacement(
                &self.root,
                self.breakpoint_kind,
                file_path,
                breakpoints,
            )
            .map_err(|_| WatchBreakpointSyncFailure::InvalidPolicy)?;
        let request = WatchSetBreakpointsRequest::new(
            prepared.file_path().to_string(),
            prepared.file_breakpoints().to_vec(),
        );
        self.control
            .execute_and_commit(
                WatchDebugControlCommand::SetBreakpoints(request),
                |response| {
                    let WatchDebugControlResponse::BreakpointsVerified { breakpoints, .. } =
                        response
                    else {
                        return Err(WatchDebugControlFailure::ResponseMismatch);
                    };
                    lock_recover(&self.desired)
                        .commit_breakpoint_replacement(prepared)
                        .map_err(|DesiredBreakpointReplacementCommitError::Stale| {
                            WatchDebugControlFailure::StaleAuthority
                        })?;
                    Ok(breakpoints)
                },
            )
            .map_err(Into::into)
    }

    pub(crate) fn set_breakpoints_active(
        &self,
        active: bool,
    ) -> Result<(), WatchBreakpointSyncFailure> {
        self.update_policy(
            |desired| desired.prepare_breakpoints_active(active),
            WatchDebugControlCommand::SetBreakpointsActive(active),
        )
    }

    pub(crate) fn set_function_breakpoints(
        &self,
        breakpoints: &[DebugFunctionBreakpoint],
    ) -> Result<Vec<DebugFunctionBreakpointVerification>, WatchBreakpointSyncFailure> {
        let _mutation = lock_recover(&self.mutation);
        let prepared = lock_recover(&self.desired)
            .prepare_function_breakpoint_replacement(breakpoints)
            .map_err(|_| WatchBreakpointSyncFailure::InvalidPolicy)?;
        let request = WatchSetFunctionBreakpointsRequest::new(breakpoints.to_vec());
        self.control
            .execute_and_commit(
                WatchDebugControlCommand::SetFunctionBreakpoints(request),
                |response| {
                    let WatchDebugControlResponse::FunctionBreakpointsVerified(verification) =
                        response
                    else {
                        return Err(WatchDebugControlFailure::ResponseMismatch);
                    };
                    lock_recover(&self.desired)
                        .commit_policy_update(prepared)
                        .map_err(|DesiredPolicyUpdateCommitError::Stale| {
                            WatchDebugControlFailure::StaleAuthority
                        })?;
                    Ok(verification)
                },
            )
            .map_err(Into::into)
    }

    pub(crate) fn set_exception_pause(
        &self,
        mode: DebugExceptionPauseMode,
    ) -> Result<(), WatchBreakpointSyncFailure> {
        self.update_policy(
            |desired| desired.prepare_exception_pause(mode),
            WatchDebugControlCommand::SetExceptionPause(mode),
        )
    }

    fn update_policy(
        &self,
        prepare: impl FnOnce(
            &DesiredDebuggerPolicy,
        )
            -> Result<super::watch_desired_policy::PreparedDesiredPolicyUpdate, String>,
        command: WatchDebugControlCommand,
    ) -> Result<(), WatchBreakpointSyncFailure> {
        let _mutation = lock_recover(&self.mutation);
        let prepared = prepare(&lock_recover(&self.desired))
            .map_err(|_| WatchBreakpointSyncFailure::InvalidPolicy)?;
        self.control
            .execute_and_commit(command, |response| {
                if response != WatchDebugControlResponse::Ack {
                    return Err(WatchDebugControlFailure::ResponseMismatch);
                }
                lock_recover(&self.desired)
                    .commit_policy_update(prepared)
                    .map_err(|DesiredPolicyUpdateCommitError::Stale| {
                        WatchDebugControlFailure::StaleAuthority
                    })?;
                Ok(())
            })
            .map_err(Into::into)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchBreakpointSyncFailure {
    InvalidPolicy,
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

impl From<WatchDebugControlFailure> for WatchBreakpointSyncFailure {
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

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "debug_node_watch_breakpoint_sync_tests.rs"]
mod tests;
