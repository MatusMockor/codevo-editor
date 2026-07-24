use super::watch_adapter::WatchNodeDebugAdapter;
use super::watch_breakpoint_sync::WatchBreakpointSynchronizer;
use super::watch_cdp_activation::{
    ensure_watch_current, publish_and_activate_control, WatchTargetActivationRollback,
};
use super::watch_cdp_command_runtime::NodeCdpCommandRuntime;
use super::watch_command_worker::{WatchDebugCommandWorkerPolicy, WatchDebugCommandWorkerPort};
use super::watch_control_proxy::{
    WatchDebugControlCommand, WatchDebugControlLease, WatchDebugControlPort,
    WatchDebugControlProxy, WatchDebugControlResponse,
};
use super::watch_controller::{
    WatchReplayOutcome, WatchTargetConnector, WatchTargetHandle, WatchTargetPublisher,
    WatchTargetReplay,
};
use super::watch_desired_policy::{
    DesiredDebuggerPolicy, DesiredDebuggerReplayCommitError, DesiredDebuggerReplayPlan,
    DesiredDebuggerReplayStep,
};
use super::watch_event_gate::{
    WatchDebugEventGate, WatchEventGenerationLease, WatchLogicalFinishGate, WatchTransportEnd,
};
use super::watch_generation::{InspectorEndpointFingerprint, TargetGeneration};
#[cfg(test)]
use super::watch_replay::WatchCdpProtocol;
use super::watch_replay::{apply_replay_setup, reconcile_replay_setup};
use super::watch_start_gate::NativeNodeWatchStartGate;
use super::watch_supervisor::{WatchSupervisorCancellation, WatchTargetDisconnectPublisher};
use crate::debug_adapter::{DebugAdapter, DebugEventEmitter};
use crate::debug_cdp::event_sink::{
    CdpEventDisposition, CdpEventDropReason, CdpEventEmitter, CdpEventSinkPort,
};
use crate::debug_cdp::transport::{NodeCdpAdapter, PauseGenerationFloor};
use crate::debug_source_map::SourceMapRegistry;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

/// Internal CDP bridge for the watch controller. The supervisor process stays
/// outside this adapter; every connected target is transport-only and external.
pub(crate) struct NodeCdpWatchConnector {
    root: PathBuf,
    request_timeout: Duration,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    disconnects: WatchTargetDisconnectPublisher,
    cancellation: WatchSupervisorCancellation,
    gate: Arc<WatchDebugEventGate>,
    control_proxy: WatchDebugControlProxy,
    source_maps_enabled: bool,
    connected_once: bool,
}

struct WatchCdpEventSink {
    gate: Arc<WatchDebugEventGate>,
    lease: WatchEventGenerationLease,
    pause_epoch: Arc<AtomicU64>,
}

impl CdpEventSinkPort for WatchCdpEventSink {
    fn emit(&self, payload: crate::debug_adapter::DebugEventPayload) -> CdpEventDisposition {
        let epoch_update = match &payload {
            crate::debug_adapter::DebugEventPayload::Stopped {
                pause_generation, ..
            } => Some(*pause_generation),
            crate::debug_adapter::DebugEventPayload::Resumed => {
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

fn map_watch_event_disposition(
    disposition: super::watch_event_gate::WatchEventDisposition,
) -> CdpEventDisposition {
    match disposition {
        super::watch_event_gate::WatchEventDisposition::Delivered => CdpEventDisposition::Delivered,
        super::watch_event_gate::WatchEventDisposition::Buffered => CdpEventDisposition::Buffered,
        super::watch_event_gate::WatchEventDisposition::DroppedOverflow => {
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded)
        }
        super::watch_event_gate::WatchEventDisposition::DroppedLifecycle => {
            CdpEventDisposition::Dropped(CdpEventDropReason::LifecycleOwnedElsewhere)
        }
        super::watch_event_gate::WatchEventDisposition::DroppedStale => {
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

pub(crate) struct NodeCdpWatchTarget {
    ownership: Option<NodeCdpWatchTargetOwnership>,
    control_proxy: WatchDebugControlProxy,
    gate: Arc<WatchDebugEventGate>,
    generation: TargetGeneration,
    lease: WatchEventGenerationLease,
    replay_plan: Option<DesiredDebuggerReplayPlan>,
    intentional_close: Arc<AtomicBool>,
    disconnects: WatchTargetDisconnectPublisher,
    endpoint: InspectorEndpointFingerprint,
    emergency_disconnect_sent: Arc<AtomicBool>,
    pause_epoch: Arc<AtomicU64>,
}

impl NodeCdpWatchTarget {
    fn terminate_inner(&mut self) {
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

enum NodeCdpWatchTargetOwnership {
    Startup(NodeCdpAdapter),
    Active {
        worker: WatchDebugCommandWorkerPort,
        control_lease: WatchDebugControlLease,
    },
}

struct NodeCdpWatchControlPort {
    worker: WatchDebugCommandWorkerPort,
    gate: Arc<WatchDebugEventGate>,
    lease: WatchEventGenerationLease,
    intentional_close: Arc<AtomicBool>,
    disconnects: WatchTargetDisconnectPublisher,
    generation: TargetGeneration,
    endpoint: InspectorEndpointFingerprint,
    emergency_disconnect_sent: Arc<AtomicBool>,
}

impl WatchDebugControlPort for NodeCdpWatchControlPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, super::watch_control_proxy::WatchDebugCommandFailure>
    {
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

pub(crate) struct NodeCdpWatchReplay {
    cancellation: WatchSupervisorCancellation,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
}

pub(crate) struct NodeCdpWatchPublisher {
    cancellation: WatchSupervisorCancellation,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    gate: Arc<WatchDebugEventGate>,
    control_proxy: WatchDebugControlProxy,
    command_policy: WatchDebugCommandWorkerPolicy,
    mutation: Arc<Mutex<()>>,
    start_gate: Arc<NativeNodeWatchStartGate>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct NodeCdpWatchAdapterPolicy {
    request_timeout: Duration,
    command_policy: WatchDebugCommandWorkerPolicy,
    source_maps_enabled: bool,
}

impl NodeCdpWatchAdapterPolicy {
    pub(crate) fn new(
        request_timeout: Duration,
        command_policy: WatchDebugCommandWorkerPolicy,
    ) -> Result<Self, &'static str> {
        if request_timeout.is_zero() {
            return Err("watch CDP request timeout must be positive");
        }
        Ok(Self {
            request_timeout,
            command_policy,
            source_maps_enabled: true,
        })
    }

    pub(crate) fn with_source_maps_enabled(mut self, enabled: bool) -> Self {
        self.source_maps_enabled = enabled;
        self
    }
}

pub(crate) fn node_cdp_watch_adapters(
    root: PathBuf,
    policy: NodeCdpWatchAdapterPolicy,
    emitter: DebugEventEmitter,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    disconnects: WatchTargetDisconnectPublisher,
    cancellation: WatchSupervisorCancellation,
) -> (
    NodeCdpWatchConnector,
    NodeCdpWatchReplay,
    NodeCdpWatchPublisher,
    WatchNodeDebugAdapter,
    WatchLogicalFinishGate,
) {
    node_cdp_watch_adapters_with_start_gate(
        root,
        policy,
        emitter,
        startup_is_current,
        desired,
        disconnects,
        cancellation,
        Arc::new(NativeNodeWatchStartGate::confirmed()),
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "keeps the paused-start confirmation authority explicit"
)]
pub(crate) fn node_cdp_watch_adapters_with_start_gate(
    root: PathBuf,
    policy: NodeCdpWatchAdapterPolicy,
    emitter: DebugEventEmitter,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    disconnects: WatchTargetDisconnectPublisher,
    cancellation: WatchSupervisorCancellation,
    start_gate: Arc<NativeNodeWatchStartGate>,
) -> (
    NodeCdpWatchConnector,
    NodeCdpWatchReplay,
    NodeCdpWatchPublisher,
    WatchNodeDebugAdapter,
    WatchLogicalFinishGate,
) {
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let logical_finish_gate = gate.logical_finish_gate();
    let control_proxy = WatchDebugControlProxy::new();
    let mutation = Arc::new(Mutex::new(()));
    let breakpoint_sync = Arc::new(WatchBreakpointSynchronizer::new(
        root.clone(),
        crate::debug_breakpoint_policy::DebugBreakpointAdapterKind::Node,
        Arc::clone(&desired),
        control_proxy.clone(),
        Arc::clone(&mutation),
    ));
    let authority_is_current = startup_is_current;
    let connect_cancellation = cancellation.clone();
    let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> =
        Arc::new(move || authority_is_current() && !connect_cancellation.is_revoked());
    (
        NodeCdpWatchConnector {
            root,
            request_timeout: policy.request_timeout,
            startup_is_current,
            disconnects,
            cancellation: cancellation.clone(),
            gate: Arc::clone(&gate),
            control_proxy: control_proxy.clone(),
            source_maps_enabled: policy.source_maps_enabled,
            connected_once: false,
        },
        NodeCdpWatchReplay {
            cancellation: cancellation.clone(),
            desired: Arc::clone(&desired),
        },
        NodeCdpWatchPublisher {
            cancellation,
            desired,
            gate,
            control_proxy: control_proxy.clone(),
            command_policy: policy.command_policy,
            mutation,
            start_gate,
        },
        WatchNodeDebugAdapter::with_breakpoint_sync(control_proxy, breakpoint_sync),
        logical_finish_gate,
    )
}

impl WatchTargetConnector for NodeCdpWatchConnector {
    type Target = NodeCdpWatchTarget;

    fn connect(
        &mut self,
        generation: TargetGeneration,
        endpoint: &InspectorEndpointFingerprint,
        pause_generation_floor: PauseGenerationFloor,
    ) -> Result<Self::Target, ()> {
        ensure_watch_current(&self.cancellation)?;
        let lease = if self.connected_once {
            self.gate.prepare_replacement()
        } else {
            self.gate.prepare_initial()
        }
        .ok_or(())?;
        let pause_epoch = Arc::new(AtomicU64::new(pause_generation_floor.epoch()));
        let emitter = watch_cdp_event_emitter(
            Arc::clone(&self.gate),
            lease.clone(),
            Arc::clone(&pause_epoch),
        );
        let source_maps = match self
            .source_maps_enabled
            .then(|| SourceMapRegistry::new(&self.root))
            .transpose()
        {
            Ok(source_maps) => source_maps,
            Err(_) => {
                let _ = self.gate.end_before_transport_close(
                    &lease,
                    WatchTransportEnd::Terminated,
                    || (),
                );
                return Err(());
            }
        };
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        let adapter = match NodeCdpAdapter::connect_watch_transport_at_pause_generation_floor(
            &endpoint.web_socket_url(),
            emitter,
            self.request_timeout,
            source_maps,
            Arc::clone(&self.startup_is_current),
            pause_generation_floor,
            Some(disconnected_tx),
        ) {
            Ok(adapter) => adapter,
            Err(_) => {
                let _ = self.gate.end_before_transport_close(
                    &lease,
                    WatchTransportEnd::Terminated,
                    || (),
                );
                return Err(());
            }
        };
        if self.cancellation.is_revoked() {
            let mut adapter = adapter;
            adapter.terminate();
            let _ =
                self.gate
                    .end_before_transport_close(&lease, WatchTransportEnd::Terminated, || ());
            return Err(());
        }
        let intentional_close = Arc::new(AtomicBool::new(false));
        let disconnect_sent = Arc::new(AtomicBool::new(false));
        let close_guard = Arc::clone(&intentional_close);
        let relay_disconnect_sent = Arc::clone(&disconnect_sent);
        let disconnects = self.disconnects.clone();
        let disconnected_endpoint = endpoint.clone();
        thread::spawn(move || {
            relay_remote_disconnect(
                disconnected_rx,
                close_guard,
                relay_disconnect_sent,
                &disconnects,
                generation,
                disconnected_endpoint,
            );
        });
        self.connected_once = true;
        Ok(NodeCdpWatchTarget {
            ownership: Some(NodeCdpWatchTargetOwnership::Startup(adapter)),
            control_proxy: self.control_proxy.clone(),
            gate: Arc::clone(&self.gate),
            generation,
            lease,
            replay_plan: None,
            intentional_close,
            disconnects: self.disconnects.clone(),
            endpoint: endpoint.clone(),
            emergency_disconnect_sent: disconnect_sent,
            pause_epoch,
        })
    }
}

impl WatchTargetHandle for NodeCdpWatchTarget {
    fn pause_generation_epoch(&self) -> Result<u64, ()> {
        match self.ownership.as_ref().ok_or(())? {
            NodeCdpWatchTargetOwnership::Startup(adapter) => {
                adapter.watch_pause_generation_epoch().map_err(|_| ())
            }
            NodeCdpWatchTargetOwnership::Active { worker, .. } => {
                let response = worker.execute_bounded(WatchDebugControlCommand::CurrentPauseEpoch);
                if response.is_err() && self.emergency_disconnect_sent.load(Ordering::Acquire) {
                    return Ok(self.pause_epoch.load(Ordering::Acquire));
                }
                match response.map_err(|_| ())? {
                    WatchDebugControlResponse::PauseEpoch(epoch) => Ok(epoch),
                    WatchDebugControlResponse::Ack
                    | WatchDebugControlResponse::StackTrace(_)
                    | WatchDebugControlResponse::Scopes(_)
                    | WatchDebugControlResponse::Variables(_)
                    | WatchDebugControlResponse::Evaluate(_)
                    | WatchDebugControlResponse::VariableSet(_)
                    | WatchDebugControlResponse::ExpressionSet(_)
                    | WatchDebugControlResponse::BreakpointsVerified { .. }
                    | WatchDebugControlResponse::FunctionBreakpointsVerified(_) => Err(()),
                }
            }
        }
    }

    fn terminate(&mut self) {
        self.terminate_inner();
    }
}

impl WatchTargetReplay<NodeCdpWatchTarget> for NodeCdpWatchReplay {
    fn replay(&mut self, target: &mut NodeCdpWatchTarget) -> Result<WatchReplayOutcome, ()> {
        let plan = lock_recover(&self.desired).replay_plan();
        let Some((run, setup)) = plan.steps().split_last() else {
            return Err(());
        };
        if !matches!(run, DesiredDebuggerReplayStep::RunIfWaitingForDebugger) {
            return Err(());
        }
        let adapter = match target.ownership.as_mut().ok_or(())? {
            NodeCdpWatchTargetOwnership::Startup(adapter) => adapter,
            NodeCdpWatchTargetOwnership::Active { .. } => return Err(()),
        };
        apply_replay_setup(adapter, setup, || !self.cancellation.is_revoked())?;

        target.replay_plan = Some(plan);
        Ok(WatchReplayOutcome::Applied)
    }
}

impl WatchTargetPublisher<NodeCdpWatchTarget> for NodeCdpWatchPublisher {
    fn publish(
        &mut self,
        generation: TargetGeneration,
        target: &mut NodeCdpWatchTarget,
    ) -> Result<(), ()> {
        if target.generation != generation {
            return Err(());
        }
        ensure_watch_current(&self.cancellation)?;
        self.start_gate
            .wait_until_confirmed(|| !self.cancellation.is_revoked())?;
        let replayed_plan = target.replay_plan.take().ok_or(())?;
        let _mutation = lock_recover(&self.mutation);
        let current_plan = lock_recover(&self.desired).replay_plan();
        if replayed_plan != current_plan {
            let adapter = match target.ownership.as_mut().ok_or(())? {
                NodeCdpWatchTargetOwnership::Startup(adapter) => adapter,
                NodeCdpWatchTargetOwnership::Active { .. } => return Err(()),
            };
            reconcile_replay_setup(adapter, &replayed_plan, &current_plan, || {
                !self.cancellation.is_revoked()
            })?;
        }
        lock_recover(&self.desired)
            .commit_replay(current_plan)
            .map_err(|DesiredDebuggerReplayCommitError::Stale| ())?;
        ensure_watch_current(&self.cancellation)?;
        let adapter = match target.ownership.take().ok_or(())? {
            NodeCdpWatchTargetOwnership::Startup(adapter) => adapter,
            ownership @ NodeCdpWatchTargetOwnership::Active { .. } => {
                target.ownership = Some(ownership);
                return Err(());
            }
        };
        let cancellation = self.cancellation.clone();
        let worker = WatchDebugCommandWorkerPort::spawn(
            NodeCdpCommandRuntime::new(adapter),
            move || !cancellation.is_revoked(),
            self.command_policy,
        );
        let mut rollback = WatchTargetActivationRollback::new(
            &self.control_proxy,
            self.gate.as_ref(),
            &target.lease,
            target.intentional_close.as_ref(),
            worker,
        );
        let port: Arc<dyn WatchDebugControlPort> = Arc::new(NodeCdpWatchControlPort {
            worker: rollback.worker().clone(),
            gate: Arc::clone(&self.gate),
            lease: target.lease.clone(),
            intentional_close: Arc::clone(&target.intentional_close),
            disconnects: target.disconnects.clone(),
            generation,
            endpoint: target.endpoint.clone(),
            emergency_disconnect_sent: Arc::clone(&target.emergency_disconnect_sent),
        });
        publish_and_activate_control(
            &self.control_proxy,
            generation,
            Arc::clone(&port),
            self.gate.as_ref(),
            &target.lease,
            &self.cancellation,
            &mut rollback,
        )?;
        let (worker, control_lease) = rollback.commit();
        target.control_proxy = self.control_proxy.clone();
        target.ownership = Some(NodeCdpWatchTargetOwnership::Active {
            worker,
            control_lease,
        });
        Ok(())
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

trait DisconnectPublication {
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

fn relay_remote_disconnect(
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

#[cfg(test)]
mod tests {
    use super::super::watch_command_worker::WatchDebugCommandRuntime;
    use super::super::watch_control_proxy::{WatchDebugCommandFailure, WatchDebugControlFailure};
    use super::*;
    use crate::debug_adapter::{
        DebugBreakpoint, DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode,
        DebugJustMyCodePolicy, DebugOutputStream, DebugScopeInfo, DebugStackFrame,
        DebugVariableInfo, StepKind,
    };
    use crate::debug_session_registry::DebugSessionRegistry;
    use std::cell::Cell;
    use std::cell::RefCell;
    use std::time::Instant;

    #[test]
    fn watch_adapter_policy_defaults_source_maps_on_and_preserves_disabled_policy() {
        let command_policy =
            WatchDebugCommandWorkerPolicy::new(1, Duration::from_secs(1)).expect("policy");
        let enabled = NodeCdpWatchAdapterPolicy::new(Duration::from_secs(1), command_policy)
            .expect("adapter policy");
        assert!(enabled.source_maps_enabled);
        assert!(!enabled.with_source_maps_enabled(false).source_maps_enabled);
    }

    #[test]
    fn watch_event_sink_maps_all_gate_dispositions_without_losing_reason() {
        use super::super::watch_event_gate::WatchEventDisposition;

        assert_eq!(
            map_watch_event_disposition(WatchEventDisposition::Delivered),
            CdpEventDisposition::Delivered
        );
        assert_eq!(
            map_watch_event_disposition(WatchEventDisposition::Buffered),
            CdpEventDisposition::Buffered
        );
        assert_eq!(
            map_watch_event_disposition(WatchEventDisposition::DroppedOverflow),
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded)
        );
        assert_eq!(
            map_watch_event_disposition(WatchEventDisposition::DroppedLifecycle),
            CdpEventDisposition::Dropped(CdpEventDropReason::LifecycleOwnedElsewhere)
        );
        assert_eq!(
            map_watch_event_disposition(WatchEventDisposition::DroppedStale),
            CdpEventDisposition::Dropped(CdpEventDropReason::StaleAuthority)
        );
    }

    struct InertWatchCommandRuntime;

    impl WatchDebugCommandRuntime for InertWatchCommandRuntime {
        fn execute(
            &mut self,
            command: WatchDebugControlCommand,
            _deadline: Instant,
            _revoked: &AtomicBool,
        ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
            Ok(match command {
                WatchDebugControlCommand::CurrentPauseEpoch => {
                    WatchDebugControlResponse::PauseEpoch(0)
                }
                WatchDebugControlCommand::Pause
                | WatchDebugControlCommand::Step(_)
                | WatchDebugControlCommand::RunIfWaitingForDebugger
                | WatchDebugControlCommand::SetBreakpointsActive(_)
                | WatchDebugControlCommand::SetExceptionPause(_) => WatchDebugControlResponse::Ack,
                WatchDebugControlCommand::StackTrace(_)
                | WatchDebugControlCommand::Scopes(_)
                | WatchDebugControlCommand::Variables(_)
                | WatchDebugControlCommand::Evaluate(_)
                | WatchDebugControlCommand::SetVariable(_)
                | WatchDebugControlCommand::SetExpression(_) => {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
                WatchDebugControlCommand::SetBreakpoints(request) => {
                    WatchDebugControlResponse::BreakpointsVerified {
                        file_path: request.file_path().to_string(),
                        breakpoints: request.breakpoints().to_vec(),
                    }
                }
                WatchDebugControlCommand::SetFunctionBreakpoints(request) => {
                    WatchDebugControlResponse::FunctionBreakpointsVerified(
                        request
                            .breakpoints()
                            .iter()
                            .map(|breakpoint| {
                                crate::debug_adapter::DebugFunctionBreakpointVerification {
                                    id: breakpoint.id.clone(),
                                    verified: breakpoint.enabled,
                                }
                            })
                            .collect(),
                    )
                }
            })
        }
    }

    fn inert_command_worker() -> WatchDebugCommandWorkerPort {
        WatchDebugCommandWorkerPort::spawn(
            InertWatchCommandRuntime,
            || true,
            WatchDebugCommandWorkerPolicy::new(1, Duration::from_millis(100))
                .expect("test command policy"),
        )
    }

    #[derive(Default)]
    struct FakeProtocol {
        calls: Vec<&'static str>,
        fail_at: Option<&'static str>,
    }

    impl FakeProtocol {
        fn call(&mut self, name: &'static str) -> Result<(), ()> {
            self.calls.push(name);
            (self.fail_at != Some(name)).then_some(()).ok_or(())
        }
    }

    impl WatchCdpProtocol for FakeProtocol {
        fn enable_runtime(&mut self) -> Result<(), ()> {
            self.call("runtime")
        }
        fn enable_debugger(&mut self) -> Result<(), ()> {
            self.call("debugger")
        }
        fn apply_internal_step_filter(
            &mut self,
            _policy: Option<DebugJustMyCodePolicy>,
        ) -> Result<(), ()> {
            self.call("blackbox")
        }
        fn set_exception_pause(&mut self, _mode: DebugExceptionPauseMode) -> Result<(), ()> {
            self.call("exceptions")
        }
        fn set_breakpoints_active(&mut self, _active: bool) -> Result<(), ()> {
            self.call("activation")
        }
        fn set_breakpoints(
            &mut self,
            _file_path: &str,
            _breakpoints: &[DebugBreakpoint],
        ) -> Result<(), ()> {
            self.call("breakpoints")
        }

        fn set_function_breakpoints(
            &mut self,
            _breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        ) -> Result<(), ()> {
            self.call("function-breakpoints")
        }
    }

    fn setup_steps() -> Vec<DesiredDebuggerReplayStep> {
        vec![
            DesiredDebuggerReplayStep::EnableRuntime,
            DesiredDebuggerReplayStep::EnableDebugger,
            DesiredDebuggerReplayStep::ApplyInternalStepFilter(Some(
                DebugJustMyCodePolicy::NodeInternals,
            )),
            DesiredDebuggerReplayStep::SetExceptionPause(DebugExceptionPauseMode::Uncaught),
            DesiredDebuggerReplayStep::SetBreakpointsActive(true),
            DesiredDebuggerReplayStep::SetBreakpoints {
                file_path: "/workspace/app.ts".into(),
                breakpoints: Vec::new(),
            },
            DesiredDebuggerReplayStep::SetFunctionBreakpoints {
                breakpoints: Vec::new(),
            },
        ]
    }

    #[test]
    fn fake_protocol_requires_every_setup_ack_in_closed_order() {
        let mut protocol = FakeProtocol::default();
        assert_eq!(
            apply_replay_setup(&mut protocol, &setup_steps(), || true),
            Ok(())
        );
        assert_eq!(
            protocol.calls,
            [
                "runtime",
                "debugger",
                "blackbox",
                "exceptions",
                "activation",
                "breakpoints",
                "function-breakpoints"
            ]
        );
    }

    #[test]
    fn fake_protocol_aborts_at_first_missing_ack() {
        let mut protocol = FakeProtocol {
            fail_at: Some("activation"),
            ..FakeProtocol::default()
        };
        assert_eq!(
            apply_replay_setup(&mut protocol, &setup_steps(), || true),
            Err(())
        );
        assert_eq!(
            protocol.calls,
            [
                "runtime",
                "debugger",
                "blackbox",
                "exceptions",
                "activation"
            ]
        );
    }

    #[test]
    fn supervisor_revocation_aborts_before_the_next_protocol_step() {
        let cancellation = WatchSupervisorCancellation::new();
        let checks = Cell::new(0_u8);
        let mut protocol = FakeProtocol::default();

        assert_eq!(
            apply_replay_setup(&mut protocol, &setup_steps(), || {
                let check = checks.get();
                checks.set(check + 1);
                if check == 0 {
                    true
                } else {
                    cancellation.revoke();
                    !cancellation.is_revoked()
                }
            }),
            Err(())
        );
        assert_eq!(protocol.calls, ["runtime"]);
        assert!(cancellation.is_revoked());
    }

    #[derive(Default)]
    struct RecordingBreakpointProtocol {
        files: Vec<(String, Vec<String>)>,
        setup_calls: Vec<&'static str>,
    }

    impl WatchCdpProtocol for RecordingBreakpointProtocol {
        fn enable_runtime(&mut self) -> Result<(), ()> {
            self.setup_calls.push("runtime");
            Ok(())
        }

        fn enable_debugger(&mut self) -> Result<(), ()> {
            self.setup_calls.push("debugger");
            Ok(())
        }

        fn apply_internal_step_filter(
            &mut self,
            _policy: Option<DebugJustMyCodePolicy>,
        ) -> Result<(), ()> {
            self.setup_calls.push("blackbox");
            Ok(())
        }

        fn set_exception_pause(&mut self, _mode: DebugExceptionPauseMode) -> Result<(), ()> {
            self.setup_calls.push("exceptions");
            Ok(())
        }

        fn set_breakpoints_active(&mut self, _active: bool) -> Result<(), ()> {
            self.setup_calls.push("activation");
            Ok(())
        }

        fn set_breakpoints(
            &mut self,
            file_path: &str,
            breakpoints: &[DebugBreakpoint],
        ) -> Result<(), ()> {
            self.files.push((
                file_path.to_string(),
                breakpoints
                    .iter()
                    .map(|breakpoint| breakpoint.id.clone())
                    .collect(),
            ));
            Ok(())
        }

        fn set_function_breakpoints(
            &mut self,
            _breakpoints: &[crate::debug_adapter::DebugFunctionBreakpoint],
        ) -> Result<(), ()> {
            self.setup_calls.push("function-breakpoints");
            Ok(())
        }
    }

    fn test_replay_plan(
        revision: u64,
        files: impl IntoIterator<Item = (&'static str, Vec<DebugBreakpoint>)>,
    ) -> DesiredDebuggerReplayPlan {
        let mut steps = vec![
            DesiredDebuggerReplayStep::EnableRuntime,
            DesiredDebuggerReplayStep::EnableDebugger,
            DesiredDebuggerReplayStep::ApplyInternalStepFilter(None),
            DesiredDebuggerReplayStep::SetExceptionPause(DebugExceptionPauseMode::None),
            DesiredDebuggerReplayStep::SetBreakpointsActive(true),
        ];
        steps.extend(files.into_iter().map(|(file_path, breakpoints)| {
            DesiredDebuggerReplayStep::SetBreakpoints {
                file_path: file_path.to_string(),
                breakpoints,
            }
        }));
        steps.push(DesiredDebuggerReplayStep::RunIfWaitingForDebugger);
        DesiredDebuggerReplayPlan::from_steps_for_test(revision, steps)
    }

    fn test_breakpoint(file_path: &str, id: &str, line_number: u32) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.to_string(),
            file_path: file_path.to_string(),
            line_number,
            column_number: None,
            condition: None,
            hit_condition: None,
            log_message: None,
            enabled: true,
            verified: false,
        }
    }

    #[test]
    fn stale_replay_is_reconciled_to_the_exact_latest_snapshot_before_visibility() {
        let old = test_replay_plan(
            1,
            [(
                "/workspace/removed.ts",
                vec![test_breakpoint("/workspace/removed.ts", "old", 1)],
            )],
        );
        let current = test_replay_plan(
            2,
            [(
                "/workspace/current.ts",
                vec![test_breakpoint("/workspace/current.ts", "current", 2)],
            )],
        );
        let mut protocol = RecordingBreakpointProtocol::default();

        assert_eq!(
            reconcile_replay_setup(&mut protocol, &old, &current, || true),
            Ok(())
        );
        assert_eq!(
            protocol.files,
            [
                ("/workspace/removed.ts".to_string(), Vec::new()),
                (
                    "/workspace/current.ts".to_string(),
                    vec!["current".to_string()]
                )
            ]
        );
        assert_eq!(
            protocol.setup_calls,
            [
                "runtime",
                "debugger",
                "blackbox",
                "exceptions",
                "activation"
            ]
        );
    }

    #[test]
    fn revoked_supervisor_is_rejected_at_the_publisher_boundary() {
        let cancellation = WatchSupervisorCancellation::new();
        assert_eq!(ensure_watch_current(&cancellation), Ok(()));
        cancellation.revoke();
        assert_eq!(ensure_watch_current(&cancellation), Err(()));
    }

    struct FakeDisconnectPublisher(RefCell<Vec<(u64, InspectorEndpointFingerprint)>>);

    impl DisconnectPublication for FakeDisconnectPublisher {
        fn publish_disconnect(
            &self,
            generation: TargetGeneration,
            endpoint: InspectorEndpointFingerprint,
        ) {
            self.0.borrow_mut().push((generation.get(), endpoint));
        }
    }

    fn endpoint() -> InspectorEndpointFingerprint {
        InspectorEndpointFingerprint::parse(
            "127.0.0.1:9229",
            "11111111-1111-1111-1111-111111111111",
        )
        .expect("endpoint")
    }

    #[test]
    fn remote_socket_close_publishes_exact_owner_once() {
        let (sender, receiver) = mpsc::channel();
        sender.send(()).expect("disconnect");
        drop(sender);
        let publisher = FakeDisconnectPublisher(RefCell::new(Vec::new()));
        relay_remote_disconnect(
            receiver,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            &publisher,
            TargetGeneration::from_value_for_test(7),
            endpoint(),
        );
        assert_eq!(publisher.0.borrow().as_slice(), &[(7, endpoint())]);
    }

    #[test]
    fn intentional_transport_close_never_publishes_reconnect() {
        let (sender, receiver) = mpsc::channel();
        sender.send(()).expect("disconnect");
        let publisher = FakeDisconnectPublisher(RefCell::new(Vec::new()));
        relay_remote_disconnect(
            receiver,
            Arc::new(AtomicBool::new(true)),
            Arc::new(AtomicBool::new(false)),
            &publisher,
            TargetGeneration::from_value_for_test(8),
            endpoint(),
        );
        assert!(publisher.0.borrow().is_empty());
    }

    #[derive(Default)]
    struct CollectingLifecycleSink {
        events: Mutex<Vec<DebugEvent>>,
        on_first_output: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    }

    impl DebugEventSink for CollectingLifecycleSink {
        fn emit(&self, event: DebugEvent) {
            let is_output = matches!(&event.payload, DebugEventPayload::Output { .. });
            lock_recover(&self.events).push(event);
            if is_output {
                let callback = { lock_recover(&self.on_first_output).take() };
                if let Some(callback) = callback {
                    callback();
                }
            }
        }
    }

    struct InertLifecycleAdapter;

    impl DebugAdapter for InertLifecycleAdapter {
        fn set_breakpoints(
            &mut self,
            _file_path: &str,
            breakpoints: &[DebugBreakpoint],
        ) -> Result<Vec<DebugBreakpoint>, String> {
            Ok(breakpoints.to_vec())
        }

        fn step(&mut self, _kind: StepKind) -> Result<(), String> {
            Ok(())
        }

        fn pause(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
            Ok(Vec::new())
        }

        fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
            Ok(Vec::new())
        }

        fn evaluate(
            &mut self,
            _frame_id: u64,
            expression: &str,
        ) -> Result<DebugVariableInfo, String> {
            Ok(DebugVariableInfo {
                name: expression.to_string(),
                value: String::new(),
                value_type: None,
                evaluate_name: None,
                variables_reference: 0,
                can_set_value: None,
                set_expression_reference: None,
            })
        }

        fn terminate(&mut self) {}
    }

    fn lifecycle_gate() -> (
        DebugSessionRegistry,
        Arc<WatchDebugEventGate>,
        WatchEventGenerationLease,
        Arc<CollectingLifecycleSink>,
    ) {
        let root = "/workspace/watch-cdp-lifecycle";
        let registry = DebugSessionRegistry::new();
        registry.activate_root(root);
        let sink = Arc::new(CollectingLifecycleSink::default());
        let captured = Arc::new(Mutex::new(None));
        let capture = Arc::clone(&captured);
        registry
            .start_session(
                root,
                Arc::clone(&sink) as Arc<dyn DebugEventSink>,
                move |emitter| {
                    *lock_recover(&capture) = Some(emitter);
                    Ok(Box::new(InertLifecycleAdapter))
                },
            )
            .expect("lifecycle debug session");
        let emitter = lock_recover(&captured).take().expect("lifecycle emitter");
        let gate = Arc::new(WatchDebugEventGate::new(emitter));
        let lease = gate.prepare_initial().expect("prepared event generation");
        (registry, gate, lease, sink)
    }

    fn output_payload(text: &str) -> DebugEventPayload {
        DebugEventPayload::Output {
            stream: DebugOutputStream::Stdout,
            text: text.to_string(),
        }
    }

    fn output_texts(sink: &CollectingLifecycleSink) -> Vec<String> {
        lock_recover(&sink.events)
            .iter()
            .filter_map(|event| match &event.payload {
                DebugEventPayload::Output { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    struct DelayedMutationRuntime {
        gate: Arc<WatchDebugEventGate>,
        lease: WatchEventGenerationLease,
        entered: mpsc::SyncSender<()>,
        late_event: mpsc::SyncSender<super::super::watch_event_gate::WatchEventDisposition>,
    }

    impl WatchDebugCommandRuntime for DelayedMutationRuntime {
        fn execute(
            &mut self,
            command: WatchDebugControlCommand,
            _deadline: Instant,
            revoked: &AtomicBool,
        ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
            let WatchDebugControlCommand::SetBreakpoints(request) = command else {
                return Err(WatchDebugCommandFailure::TargetRejected);
            };
            let _ = self.entered.send(());
            while !revoked.load(Ordering::Acquire) {
                thread::yield_now();
            }
            let disposition = self.gate.emit(&self.lease, output_payload("late-mutation"));
            let _ = self.late_event.send(disposition);
            Ok(WatchDebugControlResponse::BreakpointsVerified {
                file_path: request.file_path().to_string(),
                breakpoints: request.breakpoints().to_vec(),
            })
        }
    }

    #[test]
    fn mutation_timeout_revokes_event_gate_and_worker_out_of_band() {
        use super::super::watch_control_proxy::WatchSetBreakpointsRequest;
        use super::super::watch_event_gate::WatchEventDisposition;

        let (_registry, gate, event_lease, sink) = lifecycle_gate();
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (late_tx, late_rx) = mpsc::sync_channel(1);
        let worker = WatchDebugCommandWorkerPort::spawn(
            DelayedMutationRuntime {
                gate: Arc::clone(&gate),
                lease: event_lease.clone(),
                entered: entered_tx,
                late_event: late_tx,
            },
            || true,
            WatchDebugCommandWorkerPolicy::new(1, Duration::from_millis(30))
                .expect("timeout policy"),
        );
        let target_worker = worker.clone();
        let intentional_close = Arc::new(AtomicBool::new(false));
        let (disconnects, disconnect_feed) =
            super::super::watch_supervisor::watch_target_disconnect_feed();
        let target_disconnects = disconnects.clone();
        let target_endpoint = endpoint();
        let disconnect_sent = Arc::new(AtomicBool::new(false));
        let relay_disconnects = disconnects.clone();
        let relay_token = Arc::clone(&disconnect_sent);
        let (remote_tx, remote_rx) = mpsc::channel();
        let port: Arc<dyn WatchDebugControlPort> = Arc::new(NodeCdpWatchControlPort {
            worker,
            gate: Arc::clone(&gate),
            lease: event_lease.clone(),
            intentional_close: Arc::clone(&intentional_close),
            disconnects,
            generation: TargetGeneration::from_value_for_test(1),
            endpoint: target_endpoint.clone(),
            emergency_disconnect_sent: Arc::clone(&disconnect_sent),
        });
        let proxy = WatchDebugControlProxy::new();
        let control_lease = proxy
            .install(TargetGeneration::from_value_for_test(1), port)
            .expect("active target");
        let cached_pause_epoch = Arc::new(AtomicU64::new(7));
        let mut target = NodeCdpWatchTarget {
            ownership: Some(NodeCdpWatchTargetOwnership::Active {
                worker: target_worker,
                control_lease,
            }),
            control_proxy: proxy.clone(),
            gate: Arc::clone(&gate),
            generation: TargetGeneration::from_value_for_test(1),
            lease: event_lease.clone(),
            replay_plan: None,
            intentional_close: Arc::clone(&intentional_close),
            disconnects: target_disconnects,
            endpoint: endpoint(),
            emergency_disconnect_sent: Arc::clone(&disconnect_sent),
            pause_epoch: cached_pause_epoch,
        };
        let request = WatchSetBreakpointsRequest::new(
            "/workspace/app.ts".into(),
            vec![test_breakpoint("/workspace/app.ts", "late", 1)],
        );

        let command_proxy = proxy.clone();
        let command = thread::spawn(move || {
            command_proxy
                .execute_and_commit(WatchDebugControlCommand::SetBreakpoints(request), |_| {
                    Ok::<(), WatchDebugControlFailure>(())
                })
        });
        assert_eq!(entered_rx.recv_timeout(Duration::from_secs(1)), Ok(()));
        let relay = thread::spawn(move || {
            relay_remote_disconnect(
                remote_rx,
                Arc::new(AtomicBool::new(false)),
                relay_token,
                &relay_disconnects,
                TargetGeneration::from_value_for_test(1),
                target_endpoint,
            );
        });
        remote_tx.send(()).expect("remote disconnect race");
        relay.join().expect("remote relay");
        let result = command.join().expect("mutation command");

        assert_eq!(result, Err(WatchDebugControlFailure::ResponseTimeout));
        assert!(intentional_close.load(Ordering::Acquire));
        assert!(!gate.is_current(&event_lease));
        assert_eq!(
            late_rx.recv_timeout(Duration::from_secs(1)),
            Ok(WatchEventDisposition::DroppedStale)
        );
        assert!(output_texts(&sink).is_empty());
        assert_eq!(disconnect_feed.event_count_for_test(), 1);
        assert_eq!(
            target.pause_generation_epoch(),
            Ok(7),
            "controller must retain a trusted floor after emergency worker teardown"
        );
        assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
        target.terminate();
    }

    #[test]
    fn activation_rollback_drop_revokes_control_worker_and_event_generation() {
        let (_registry, gate, event_lease, _sink) = lifecycle_gate();
        let proxy = WatchDebugControlProxy::new();
        let intentional_close = AtomicBool::new(false);
        let worker = inert_command_worker();
        let port: Arc<dyn WatchDebugControlPort> = Arc::new(worker.clone());
        let mut rollback = WatchTargetActivationRollback::new(
            &proxy,
            gate.as_ref(),
            &event_lease,
            &intentional_close,
            worker,
        );
        let lease = proxy
            .install(TargetGeneration::from_value_for_test(1), port)
            .expect("installed rollback control");
        rollback.record_control(lease);

        drop(rollback);

        assert!(intentional_close.load(Ordering::Acquire));
        assert!(!gate.is_current(&event_lease));
        assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
    }

    #[test]
    fn active_target_termination_is_idempotent_and_drop_safe() {
        let (_registry, gate, event_lease, _sink) = lifecycle_gate();
        let proxy = WatchDebugControlProxy::new();
        let intentional_close = Arc::new(AtomicBool::new(false));
        let worker = inert_command_worker();
        let port: Arc<dyn WatchDebugControlPort> = Arc::new(worker.clone());
        let control_lease = proxy
            .install(TargetGeneration::from_value_for_test(1), port)
            .expect("installed target control");
        let mut target = NodeCdpWatchTarget {
            ownership: Some(NodeCdpWatchTargetOwnership::Active {
                worker,
                control_lease,
            }),
            control_proxy: proxy.clone(),
            gate: Arc::clone(&gate),
            generation: TargetGeneration::from_value_for_test(1),
            lease: event_lease.clone(),
            replay_plan: None,
            intentional_close: Arc::clone(&intentional_close),
            disconnects: super::super::watch_supervisor::watch_target_disconnect_feed().0,
            endpoint: endpoint(),
            emergency_disconnect_sent: Arc::new(AtomicBool::new(false)),
            pause_epoch: Arc::new(AtomicU64::new(0)),
        };

        target.terminate_inner();
        target.terminate_inner();

        assert!(intentional_close.load(Ordering::Acquire));
        assert!(!gate.is_current(&event_lease));
        assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
        drop(target);
    }

    struct FakeLifecyclePort {
        calls: Arc<Mutex<Vec<&'static str>>>,
        gate: Arc<WatchDebugEventGate>,
        event_lease: WatchEventGenerationLease,
        sink: Arc<CollectingLifecycleSink>,
        run_failure: Option<WatchDebugCommandFailure>,
        visible_during_run: Arc<Mutex<Vec<usize>>>,
    }

    impl WatchDebugControlPort for FakeLifecyclePort {
        fn execute(
            &self,
            command: WatchDebugControlCommand,
        ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
            let label = match command {
                WatchDebugControlCommand::RunIfWaitingForDebugger => "run",
                WatchDebugControlCommand::Pause => "pause",
                WatchDebugControlCommand::Step(_) => "step",
                WatchDebugControlCommand::CurrentPauseEpoch => "epoch",
                WatchDebugControlCommand::StackTrace(_)
                | WatchDebugControlCommand::Scopes(_)
                | WatchDebugControlCommand::Variables(_)
                | WatchDebugControlCommand::Evaluate(_)
                | WatchDebugControlCommand::SetVariable(_)
                | WatchDebugControlCommand::SetExpression(_)
                | WatchDebugControlCommand::SetBreakpointsActive(_)
                | WatchDebugControlCommand::SetExceptionPause(_)
                | WatchDebugControlCommand::SetFunctionBreakpoints(_) => {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
                WatchDebugControlCommand::SetBreakpoints(_) => {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
            };
            lock_recover(&self.calls).push(label);
            if matches!(command, WatchDebugControlCommand::RunIfWaitingForDebugger) {
                assert_eq!(
                    self.gate
                        .emit(&self.event_lease, output_payload("during-run")),
                    super::super::watch_event_gate::WatchEventDisposition::Buffered
                );
                lock_recover(&self.visible_during_run).push(lock_recover(&self.sink.events).len());
                if let Some(failure) = self.run_failure {
                    return Err(failure);
                }
            } else if matches!(command, WatchDebugControlCommand::Pause) {
                assert_eq!(
                    self.gate
                        .emit(&self.event_lease, output_payload("public-pause")),
                    super::super::watch_event_gate::WatchEventDisposition::Delivered
                );
            }
            Ok(match command {
                WatchDebugControlCommand::CurrentPauseEpoch => {
                    WatchDebugControlResponse::PauseEpoch(9)
                }
                WatchDebugControlCommand::Pause
                | WatchDebugControlCommand::Step(_)
                | WatchDebugControlCommand::RunIfWaitingForDebugger
                | WatchDebugControlCommand::SetBreakpointsActive(_)
                | WatchDebugControlCommand::SetExceptionPause(_) => WatchDebugControlResponse::Ack,
                WatchDebugControlCommand::StackTrace(_)
                | WatchDebugControlCommand::Scopes(_)
                | WatchDebugControlCommand::Variables(_)
                | WatchDebugControlCommand::Evaluate(_)
                | WatchDebugControlCommand::SetVariable(_)
                | WatchDebugControlCommand::SetExpression(_) => {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
                WatchDebugControlCommand::SetBreakpoints(_)
                | WatchDebugControlCommand::SetFunctionBreakpoints(_) => {
                    return Err(WatchDebugCommandFailure::TargetRejected);
                }
            })
        }
    }

    #[test]
    fn run_events_buffer_then_reentrant_sink_control_keeps_fifo_without_deadlock() {
        let (_registry, gate, event_lease, sink) = lifecycle_gate();
        let proxy = WatchDebugControlProxy::new();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let visible_during_run = Arc::new(Mutex::new(Vec::new()));
        let port: Arc<dyn WatchDebugControlPort> = Arc::new(FakeLifecyclePort {
            calls: Arc::clone(&calls),
            gate: Arc::clone(&gate),
            event_lease: event_lease.clone(),
            sink: Arc::clone(&sink),
            run_failure: None,
            visible_during_run: Arc::clone(&visible_during_run),
        });
        assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
        assert_eq!(lock_recover(&sink.events).len(), 1, "only logical Started");
        let reentrant_proxy = proxy.clone();
        *lock_recover(&sink.on_first_output) = Some(Box::new(move || {
            reentrant_proxy
                .pause()
                .expect("reentrant control sees active target");
        }));

        let intentional_close = Arc::new(AtomicBool::new(false));
        let mut rollback = WatchTargetActivationRollback::new(
            &proxy,
            gate.as_ref(),
            &event_lease,
            intentional_close.as_ref(),
            inert_command_worker(),
        );
        publish_and_activate_control(
            &proxy,
            TargetGeneration::from_value_for_test(3),
            port,
            gate.as_ref(),
            &event_lease,
            &WatchSupervisorCancellation::new(),
            &mut rollback,
        )
        .expect("activate published worker");
        let (worker, lease) = rollback.commit();
        assert!(
            !intentional_close.load(Ordering::Acquire),
            "committed activation must keep remote disconnect publication armed"
        );
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        disconnected_tx.send(()).expect("remote disconnect");
        let disconnects = FakeDisconnectPublisher(RefCell::new(Vec::new()));
        relay_remote_disconnect(
            disconnected_rx,
            Arc::clone(&intentional_close),
            Arc::new(AtomicBool::new(false)),
            &disconnects,
            TargetGeneration::from_value_for_test(3),
            endpoint(),
        );
        assert_eq!(disconnects.0.borrow().as_slice(), &[(3, endpoint())]);
        assert_eq!(
            lock_recover(&visible_during_run).as_slice(),
            &[1],
            "buffered event leaked before Run ACK"
        );
        assert_eq!(lock_recover(&calls).as_slice(), &["run", "pause"]);
        assert_eq!(output_texts(&sink), ["during-run", "public-pause"]);
        assert!(proxy.revoke(&lease));
        worker.revoke();
    }

    #[test]
    fn run_reject_timeout_and_disconnect_discard_buffer_and_expose_no_control() {
        for (offset, failure) in [
            WatchDebugCommandFailure::TargetRejected,
            WatchDebugCommandFailure::ResponseTimeout,
            WatchDebugCommandFailure::WorkerStopped,
        ]
        .into_iter()
        .enumerate()
        {
            let (_registry, gate, event_lease, sink) = lifecycle_gate();
            let proxy = WatchDebugControlProxy::new();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let visible_during_run = Arc::new(Mutex::new(Vec::new()));
            let port: Arc<dyn WatchDebugControlPort> = Arc::new(FakeLifecyclePort {
                calls: Arc::clone(&calls),
                gate: Arc::clone(&gate),
                event_lease: event_lease.clone(),
                sink: Arc::clone(&sink),
                run_failure: Some(failure),
                visible_during_run: Arc::clone(&visible_during_run),
            });
            let intentional_close = Arc::new(AtomicBool::new(false));
            let mut rollback = WatchTargetActivationRollback::new(
                &proxy,
                gate.as_ref(),
                &event_lease,
                intentional_close.as_ref(),
                inert_command_worker(),
            );

            assert!(matches!(
                publish_and_activate_control(
                    &proxy,
                    TargetGeneration::from_value_for_test(4 + offset as u64),
                    port,
                    gate.as_ref(),
                    &event_lease,
                    &WatchSupervisorCancellation::new(),
                    &mut rollback,
                ),
                Err(())
            ));
            drop(rollback);
            assert!(intentional_close.load(Ordering::Acquire));
            let (disconnected_tx, disconnected_rx) = mpsc::channel();
            disconnected_tx.send(()).expect("rollback disconnect");
            let disconnects = FakeDisconnectPublisher(RefCell::new(Vec::new()));
            relay_remote_disconnect(
                disconnected_rx,
                Arc::clone(&intentional_close),
                Arc::new(AtomicBool::new(false)),
                &disconnects,
                TargetGeneration::from_value_for_test(4 + offset as u64),
                endpoint(),
            );
            assert!(disconnects.0.borrow().is_empty());
            assert_eq!(lock_recover(&calls).as_slice(), &["run"]);
            assert_eq!(lock_recover(&visible_during_run).as_slice(), &[1]);
            assert!(output_texts(&sink).is_empty(), "{failure:?}");
            assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
        }
    }
}
