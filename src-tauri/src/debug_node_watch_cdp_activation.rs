use super::watch_command_worker::WatchDebugCommandWorkerPort;
use super::watch_control_proxy::{
    WatchDebugControlCommand, WatchDebugControlLease, WatchDebugControlPort,
    WatchDebugControlProxy, WatchDebugControlResponse,
};
use super::watch_event_gate::{WatchDebugEventGate, WatchEventGenerationLease, WatchTransportEnd};
use super::watch_generation::TargetGeneration;
use super::watch_supervisor::WatchSupervisorCancellation;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub(super) struct WatchTargetActivationRollback<'a> {
    control_proxy: &'a WatchDebugControlProxy,
    gate: &'a WatchDebugEventGate,
    event_lease: &'a WatchEventGenerationLease,
    intentional_close: &'a AtomicBool,
    worker: Option<WatchDebugCommandWorkerPort>,
    control_lease: Option<WatchDebugControlLease>,
}

impl<'a> WatchTargetActivationRollback<'a> {
    pub(super) fn new(
        control_proxy: &'a WatchDebugControlProxy,
        gate: &'a WatchDebugEventGate,
        event_lease: &'a WatchEventGenerationLease,
        intentional_close: &'a AtomicBool,
        worker: WatchDebugCommandWorkerPort,
    ) -> Self {
        Self {
            control_proxy,
            gate,
            event_lease,
            intentional_close,
            worker: Some(worker),
            control_lease: None,
        }
    }

    pub(super) fn worker(&self) -> &WatchDebugCommandWorkerPort {
        self.worker.as_ref().expect("activation worker")
    }

    pub(super) fn record_control(&mut self, lease: WatchDebugControlLease) {
        debug_assert!(self.control_lease.is_none());
        self.control_lease = Some(lease);
    }

    pub(super) fn commit(mut self) -> (WatchDebugCommandWorkerPort, WatchDebugControlLease) {
        let worker = self.worker.take().expect("activation worker");
        let control_lease = self.control_lease.take().expect("activated control");
        (worker, control_lease)
    }
}

impl Drop for WatchTargetActivationRollback<'_> {
    fn drop(&mut self) {
        let Some(worker) = self.worker.take() else {
            debug_assert!(self.control_lease.is_none());
            return;
        };
        if let Some(control_lease) = self.control_lease.take() {
            let _ = self.control_proxy.revoke(&control_lease);
        }
        self.intentional_close.store(true, Ordering::Release);
        let mut worker = Some(worker);
        let ended = self
            .gate
            .end_before_transport_close(self.event_lease, WatchTransportEnd::Terminated, || {
                if let Some(worker) = worker.take() {
                    worker.revoke();
                }
            })
            .is_some();
        if !ended {
            if let Some(worker) = worker.take() {
                worker.revoke();
            }
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "keeps exact generation confirmation adjacent to the activation boundary"
)]
pub(super) fn publish_and_activate_control(
    control_proxy: &WatchDebugControlProxy,
    generation: TargetGeneration,
    port: Arc<dyn WatchDebugControlPort>,
    gate: &WatchDebugEventGate,
    cancellation: &WatchSupervisorCancellation,
    begin_event_publication: impl FnOnce()
        -> Option<super::watch_event_gate::WatchEventPublicationLease>,
    confirm_entry_generation: impl FnOnce() -> Result<(), ()>,
    rollback: &mut WatchTargetActivationRollback<'_>,
) -> Result<(), ()> {
    let pending = control_proxy
        .prepare_install(generation, Arc::clone(&port))
        .map_err(|_| ())?;
    let Some(event_publication) = begin_event_publication() else {
        let _ = control_proxy.abort_pending(&pending);
        return Err(());
    };
    let mut event_flush = None;
    let activation = control_proxy.activate_exact_with(&pending, || {
        confirm_entry_generation()?;
        match port
            .execute(WatchDebugControlCommand::RunIfWaitingForDebugger)
            .map_err(|_| ())?
        {
            WatchDebugControlResponse::Ack => {}
            WatchDebugControlResponse::PauseEpoch(_)
            | WatchDebugControlResponse::StackTrace(_)
            | WatchDebugControlResponse::Scopes(_)
            | WatchDebugControlResponse::Variables(_)
            | WatchDebugControlResponse::Evaluate(_)
            | WatchDebugControlResponse::VariableSet(_)
            | WatchDebugControlResponse::ExpressionSet(_)
            | WatchDebugControlResponse::BreakpointsVerified { .. }
            | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => return Err(()),
        };
        ensure_watch_current(cancellation)?;
        event_flush = gate.seal_publish(&event_publication);
        event_flush.as_ref().map(|_| ()).ok_or(())
    });
    match activation {
        Ok(control_lease) => {
            rollback.record_control(control_lease);
            let Some(event_flush) = event_flush else {
                let _ = gate.abort_publish(&event_publication);
                return Err(());
            };
            if gate.flush_publish(&event_flush) {
                Ok(())
            } else {
                let _ = gate.abort_flush(&event_flush);
                Err(())
            }
        }
        Err(_) => {
            let _ = control_proxy.abort_pending(&pending);
            if let Some(event_flush) = event_flush {
                let _ = gate.abort_flush(&event_flush);
            } else {
                let _ = gate.abort_publish(&event_publication);
            }
            Err(())
        }
    }
}

pub(super) fn ensure_watch_current(cancellation: &WatchSupervisorCancellation) -> Result<(), ()> {
    (!cancellation.is_revoked()).then_some(()).ok_or(())
}
