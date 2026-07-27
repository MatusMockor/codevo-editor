use super::super::watch_command_worker::WatchDebugCommandWorkerPort;
use super::super::watch_control_proxy::{
    WatchDebugCommandFailure, WatchDebugControlCommand, WatchDebugControlLease,
    WatchDebugControlPort, WatchDebugControlProxy, WatchDebugControlResponse,
};
use super::super::watch_desired_policy::DesiredDebuggerReplayPlan;
use super::super::watch_entry_authority::{
    NativeNodeWatchEntryAuthority, NativeNodeWatchEntryGeneration,
};
use super::super::watch_event_gate::{
    WatchDebugEventGate, WatchEventDisposition, WatchEventGenerationLease, WatchTransportEnd,
};
use super::super::watch_generation::{InspectorEndpointFingerprint, TargetGeneration};
use super::super::watch_supervisor::WatchTargetDisconnectPublisher;
use crate::debug_adapter::{DebugAdapter, DebugEventPayload};
use crate::debug_cdp::event_sink::{
    CdpEventDisposition, CdpEventDropReason, CdpEventEmitter, CdpEventSinkPort,
};
use crate::debug_cdp::transport::NodeCdpAdapter;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};

struct WatchCdpEventSink {
    gate: Arc<WatchDebugEventGate>,
    lease: WatchEventGenerationLease,
    pause_epoch: Arc<AtomicU64>,
}

impl CdpEventSinkPort for WatchCdpEventSink {
    fn emit(&self, payload: DebugEventPayload) -> CdpEventDisposition {
        let epoch_update = match &payload {
            DebugEventPayload::Stopped {
                pause_generation, ..
            } => Some(*pause_generation),
            DebugEventPayload::Resumed => {
                Some(self.pause_epoch.load(Ordering::Acquire).saturating_add(1))
            }
            _ => None,
        };
        let disposition = self.gate.emit_with_accept(&self.lease, payload, || {
            if let Some(epoch) = epoch_update {
                self.pause_epoch.fetch_max(epoch, Ordering::AcqRel);
            }
        });
        map_watch_event_disposition(disposition)
    }
}

pub(super) fn map_watch_event_disposition(
    disposition: WatchEventDisposition,
) -> CdpEventDisposition {
    match disposition {
        WatchEventDisposition::Delivered => CdpEventDisposition::Delivered,
        WatchEventDisposition::Buffered => CdpEventDisposition::Buffered,
        WatchEventDisposition::DroppedOverflow => {
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded)
        }
        WatchEventDisposition::DroppedLifecycle => {
            CdpEventDisposition::Dropped(CdpEventDropReason::LifecycleOwnedElsewhere)
        }
        WatchEventDisposition::DroppedStale => {
            CdpEventDisposition::Dropped(CdpEventDropReason::StaleAuthority)
        }
    }
}

pub(crate) fn watch_cdp_event_emitter(
    gate: Arc<WatchDebugEventGate>,
    lease: WatchEventGenerationLease,
    pause_epoch: Arc<AtomicU64>,
) -> CdpEventEmitter {
    CdpEventEmitter::new(Arc::new(WatchCdpEventSink {
        gate,
        lease,
        pause_epoch,
    }))
}

pub(super) fn prepare_entry_generation_or_end(
    gate: &WatchDebugEventGate,
    lease: &WatchEventGenerationLease,
    authority: &Arc<NativeNodeWatchEntryAuthority>,
    generation: TargetGeneration,
) -> Result<NativeNodeWatchEntryGeneration, ()> {
    authority.prepare_generation(generation).map_err(|_| {
        let _ = gate.end_before_transport_close(lease, WatchTransportEnd::Terminated, || ());
    })
}

pub(super) fn terminate_startup_adapter_after_event_lease(
    gate: &WatchDebugEventGate,
    lease: &WatchEventGenerationLease,
    adapter: NodeCdpAdapter,
) {
    let mut adapter = Some(adapter);
    close_after_event_lease_ends(gate, lease, || {
        if let Some(mut adapter) = adapter.take() {
            adapter.terminate();
        }
    });
    if let Some(mut adapter) = adapter.take() {
        adapter.terminate();
    }
}

pub(super) fn close_after_event_lease_ends(
    gate: &WatchDebugEventGate,
    lease: &WatchEventGenerationLease,
    close: impl FnOnce(),
) {
    let mut close = Some(close);
    let ended = gate.end_before_transport_close(lease, WatchTransportEnd::Terminated, || {
        if let Some(close) = close.take() {
            close();
        }
    });
    if ended.is_none() {
        if let Some(close) = close.take() {
            close();
        }
    }
}

pub(crate) struct NodeCdpWatchTarget {
    pub(super) ownership: Option<NodeCdpWatchTargetOwnership>,
    pub(super) control_proxy: WatchDebugControlProxy,
    pub(super) gate: Arc<WatchDebugEventGate>,
    pub(super) generation: TargetGeneration,
    pub(super) lease: WatchEventGenerationLease,
    pub(super) replay_plan: Option<DesiredDebuggerReplayPlan>,
    pub(super) intentional_close: Arc<AtomicBool>,
    pub(super) disconnects: WatchTargetDisconnectPublisher,
    pub(super) endpoint: InspectorEndpointFingerprint,
    pub(super) emergency_disconnect_sent: Arc<AtomicBool>,
    pub(super) pause_epoch: Arc<AtomicU64>,
    pub(super) entry_generation: NativeNodeWatchEntryGeneration,
}

impl NodeCdpWatchTarget {
    pub(super) fn terminate_inner(&mut self) {
        if let Some(NodeCdpWatchTargetOwnership::Active { control_lease, .. }) =
            self.ownership.as_ref()
        {
            let _ = self.control_proxy.revoke(control_lease);
        }
        self.intentional_close.store(true, Ordering::Release);
        self.emergency_disconnect_sent
            .store(true, Ordering::Release);

        let mut ownership = self.ownership.take();
        let ended = self
            .gate
            .end_before_transport_close(&self.lease, WatchTransportEnd::Terminated, || {
                terminate_target_ownership(ownership.take());
            })
            .is_some();
        if !ended {
            terminate_target_ownership(ownership.take());
        }
    }
}

impl Drop for NodeCdpWatchTarget {
    fn drop(&mut self) {
        self.terminate_inner();
    }
}

pub(super) enum NodeCdpWatchTargetOwnership {
    Startup(NodeCdpAdapter),
    Active {
        worker: WatchDebugCommandWorkerPort,
        control_lease: WatchDebugControlLease,
    },
}

pub(super) struct NodeCdpWatchControlPort {
    pub(super) worker: WatchDebugCommandWorkerPort,
    pub(super) gate: Arc<WatchDebugEventGate>,
    pub(super) lease: WatchEventGenerationLease,
    pub(super) intentional_close: Arc<AtomicBool>,
    pub(super) disconnects: WatchTargetDisconnectPublisher,
    pub(super) generation: TargetGeneration,
    pub(super) endpoint: InspectorEndpointFingerprint,
    pub(super) emergency_disconnect_sent: Arc<AtomicBool>,
}

impl WatchDebugControlPort for NodeCdpWatchControlPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.worker.execute_bounded(command)
    }

    fn revoke(&self) {
        self.intentional_close.store(true, Ordering::Release);
        let worker = self.worker.clone();
        if self
            .gate
            .end_before_transport_close(&self.lease, WatchTransportEnd::Terminated, || {
                worker.revoke();
            })
            .is_none()
        {
            self.worker.revoke();
        }
        if self
            .emergency_disconnect_sent
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.disconnects
                .publish(self.generation, self.endpoint.clone());
        }
    }
}

fn terminate_target_ownership(ownership: Option<NodeCdpWatchTargetOwnership>) {
    match ownership {
        Some(NodeCdpWatchTargetOwnership::Startup(mut adapter)) => adapter.terminate(),
        Some(NodeCdpWatchTargetOwnership::Active { worker, .. }) => worker.revoke(),
        None => {}
    }
}

pub(super) trait DisconnectPublication {
    fn publish_disconnect(
        &self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
    );
}

impl DisconnectPublication for WatchTargetDisconnectPublisher {
    fn publish_disconnect(
        &self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
    ) {
        self.publish(generation, endpoint);
    }
}

pub(super) fn relay_remote_disconnect(
    disconnected: mpsc::Receiver<()>,
    intentional_close: Arc<AtomicBool>,
    disconnect_sent: Arc<AtomicBool>,
    publisher: &impl DisconnectPublication,
    generation: TargetGeneration,
    endpoint: InspectorEndpointFingerprint,
) {
    if disconnected.recv().is_ok()
        && !intentional_close.load(Ordering::Acquire)
        && disconnect_sent
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    {
        publisher.publish_disconnect(generation, endpoint);
    }
}
