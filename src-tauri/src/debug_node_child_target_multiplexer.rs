#![allow(dead_code)] // Sealed child-target CDP foundation; no IPC/UI/config exposure.

use crate::debug_node_child_target_registry::{
    neutralize_panic_payload, ChildFrameAuthority, ChildInspectorEndpoint, ChildPauseAuthority,
    ChildTargetAuthority, ChildVariableAuthority, NodeChildTargetRegistry,
    OwnedNodeProcessGroupReaper,
};
use std::{
    collections::BTreeMap,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Condvar, Mutex, MutexGuard},
    thread::ThreadId,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_MULTIPLEXED_TARGETS: usize = 32;
const MAX_PENDING_TARGET_REQUESTS: usize = 4_096;
const MAX_CHILD_TARGET_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ChildTargetMultiplexReadiness {
    Blocked { reason: &'static str },
}

/// The adapter is intentionally not connected to discovery or IPC. A future private composition
/// must supply a kernel-authorized per-target CDP connector built from the existing CDP connect
/// and transport strategies; this foundation never guesses or opens inspector WebSockets itself.
pub(crate) fn child_target_multiplex_readiness() -> ChildTargetMultiplexReadiness {
    ChildTargetMultiplexReadiness::Blocked {
        reason:
            "Child-target multiplexing needs a private kernel-authorized CDP connection strategy.",
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ChildTargetTransportRequest {
    Pause,
    Resume,
    Frame {
        backend_frame_id: Box<str>,
    },
    Variables {
        backend_frame_id: Box<str>,
        backend_variable_reference: u64,
    },
}

/// Per-target transport seam. The production strategy is expected to adapt the existing bounded
/// CDP client/transport. Tests use deterministic fakes and never open a real WebSocket.
pub(crate) trait ChildTargetTransport: Send {
    /// Enqueues one bounded CDP request without waiting for its response.
    fn send(&mut self, request_id: u64, request: ChildTargetTransportRequest)
        -> Result<(), String>;

    /// Concrete CDP strategies must make cleanup bounded. The multiplexer never invokes this while
    /// holding its lifecycle mutex and reaps the owned process group first during logical stop.
    fn disconnect(&mut self) -> Result<(), String>;
}

pub(crate) trait ChildTargetConnectionStrategy: Send {
    type Transport: ChildTargetTransport;

    fn connect(
        &mut self,
        target: &ChildTargetAuthority,
        endpoint: &ChildInspectorEndpoint,
        response_source: ChildTargetResponseSource,
    ) -> Result<Self::Transport, String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildTargetResponseSource {
    connection_generation: u64,
    target: ChildTargetAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PendingResponseAuthority {
    Target(ChildTargetAuthority),
    Frame(ChildFrameAuthority),
    Variable(ChildVariableAuthority),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildTargetPendingRequest {
    request_id: u64,
    response_authority: PendingResponseAuthority,
    response_source: ChildTargetResponseSource,
}

impl ChildTargetPendingRequest {
    pub(crate) fn request_id(&self) -> u64 {
        self.request_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BoundedChildTargetResponse {
    pub(crate) payload: Box<str>,
}

struct Connection<Transport> {
    authority: ChildTargetAuthority,
    endpoint: ChildInspectorEndpoint,
    response_source: ChildTargetResponseSource,
    transport: Option<Transport>,
}

struct ConnectionIntent {
    authority: ChildTargetAuthority,
    endpoint: ChildInspectorEndpoint,
    response_source: ChildTargetResponseSource,
}

struct MultiplexerState<Strategy: ChildTargetConnectionStrategy> {
    connections: Vec<Connection<Strategy::Transport>>,
    next_connection_generation: u64,
    next_request_id: u64,
    pending: BTreeMap<u64, ChildTargetPendingRequest>,
    stopping: bool,
    stop_owner: Option<ThreadId>,
    stop_result: Option<Result<(), String>>,
}

/// One multiplexer owns the connection set for exactly one logical launch registry.
///
/// Registry authorities fence session/target/pause/frame/variable identity. A separate connection
/// generation fences disconnect/reconnect ABA, while exact pending request and source tokens reject
/// duplicate, wrong-target and late responses. Lifecycle state is serialized, but transport I/O is
/// deliberately performed outside that lock so cleanup/reap cannot deadlock behind a callback.
pub(crate) struct NodeChildTargetMultiplexer<Reaper, Strategy>
where
    Reaper: OwnedNodeProcessGroupReaper,
    Strategy: ChildTargetConnectionStrategy,
{
    registry: NodeChildTargetRegistry<Reaper>,
    state: Mutex<MultiplexerState<Strategy>>,
    stop_finished: Condvar,
    strategy: Mutex<Option<Strategy>>,
}

impl<Reaper, Strategy> NodeChildTargetMultiplexer<Reaper, Strategy>
where
    Reaper: OwnedNodeProcessGroupReaper,
    Strategy: ChildTargetConnectionStrategy,
{
    pub(crate) fn new(registry: NodeChildTargetRegistry<Reaper>, strategy: Strategy) -> Self {
        Self {
            registry,
            state: Mutex::new(MultiplexerState {
                connections: Vec::new(),
                next_connection_generation: 1,
                next_request_id: 1,
                pending: BTreeMap::new(),
                stopping: false,
                stop_owner: None,
                stop_result: None,
            }),
            stop_finished: Condvar::new(),
            strategy: Mutex::new(Some(strategy)),
        }
    }

    pub(crate) fn reconcile(
        &self,
        discovery_epoch: u64,
        observations: Vec<
            crate::debug_node_child_target_registry::VerifiedChildInspectorObservation,
        >,
    ) -> Result<Vec<ChildTargetAuthority>, String> {
        let (authorities, intents, mut stale_transports) = {
            let mut state = self.lock()?;
            ensure_running(&state)?;
            let authorities = self.registry.reconcile(discovery_epoch, observations)?;
            if authorities.len() > MAX_MULTIPLEXED_TARGETS {
                return Err("Child-target connection inventory is full.".to_string());
            }

            let mut retained = Vec::with_capacity(authorities.len());
            let mut stale_transports = Vec::new();
            for mut connection in state.connections.drain(..) {
                if authorities
                    .iter()
                    .any(|authority| authority == &connection.authority)
                {
                    retained.push(connection);
                } else if let Some(transport) = connection.transport.take() {
                    stale_transports.push(transport);
                }
            }
            state.connections = retained;
            state.pending.retain(|_, request| {
                authorities
                    .iter()
                    .any(|authority| authority == &request.response_source.target)
            });

            let mut intents = Vec::new();
            for authority in &authorities {
                if state
                    .connections
                    .iter()
                    .any(|connection| &connection.authority == authority)
                {
                    continue;
                }
                let route = self
                    .registry
                    .resolve_target(authority)
                    .ok_or_else(|| "Child target changed while connecting.".to_string())?;
                let response_source = ChildTargetResponseSource {
                    connection_generation: take_counter(&mut state.next_connection_generation)?,
                    target: authority.clone(),
                };
                state.connections.push(Connection {
                    authority: authority.clone(),
                    endpoint: route.endpoint.clone(),
                    response_source: response_source.clone(),
                    transport: None,
                });
                intents.push(ConnectionIntent {
                    authority: authority.clone(),
                    endpoint: route.endpoint,
                    response_source,
                });
            }
            (authorities, intents, stale_transports)
        };

        let mut first_error = disconnect_all(&mut stale_transports);
        for intent in intents {
            let connected = self.connect_transport(&intent);
            match connected {
                Ok(transport) => {
                    if let Some(mut orphan) = self.install_transport(&intent, transport)? {
                        if let Err(error) = disconnect_transport(&mut orphan) {
                            first_error.get_or_insert(error);
                        }
                    }
                }
                Err(error) => {
                    self.invalidate_failed_connection(&intent);
                    first_error.get_or_insert(error);
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => {
                let state = self.lock()?;
                ensure_running(&state)?;
                let complete = authorities.iter().all(|authority| {
                    self.registry
                        .resolve_target(authority)
                        .is_some_and(|route| {
                            connection_index(&state, authority, &route.endpoint)
                                .is_some_and(|index| state.connections[index].transport.is_some())
                        })
                });
                if complete {
                    Ok(authorities)
                } else {
                    Err("Child-target inventory changed while connecting.".to_string())
                }
            }
        }
    }

    pub(crate) fn begin_pause(
        &self,
        target: &ChildTargetAuthority,
    ) -> Result<ChildPauseAuthority, String> {
        let state = self.lock()?;
        ensure_running(&state)?;
        let route = self
            .registry
            .resolve_target(target)
            .ok_or_else(|| "Stale child target authority.".to_string())?;
        ensure_connection(&state, target, &route.endpoint)?;
        self.registry.begin_pause(target)
    }

    pub(crate) fn admit_frame(
        &self,
        pause: &ChildPauseAuthority,
        backend_frame_id: impl Into<Box<str>>,
    ) -> Result<ChildFrameAuthority, String> {
        let state = self.lock()?;
        ensure_running(&state)?;
        let route = self
            .registry
            .resolve_pause(pause)
            .ok_or_else(|| "Stale child pause authority.".to_string())?;
        ensure_endpoint_connection(&state, &route.endpoint)?;
        self.registry.admit_frame(pause, backend_frame_id)
    }

    pub(crate) fn admit_variable(
        &self,
        frame: &ChildFrameAuthority,
        backend_reference: u64,
    ) -> Result<ChildVariableAuthority, String> {
        let state = self.lock()?;
        ensure_running(&state)?;
        let route = self
            .registry
            .resolve_frame(frame)
            .ok_or_else(|| "Stale child frame authority.".to_string())?;
        ensure_endpoint_connection(&state, &route.endpoint)?;
        self.registry.admit_variable(frame, backend_reference)
    }

    pub(crate) fn request_pause(
        &self,
        target: &ChildTargetAuthority,
    ) -> Result<ChildTargetPendingRequest, String> {
        let route = self
            .registry
            .resolve_target(target)
            .ok_or_else(|| "Stale child target authority.".to_string())?;
        self.dispatch(
            target.clone(),
            route.endpoint,
            PendingResponseAuthority::Target(target.clone()),
            ChildTargetTransportRequest::Pause,
        )
    }

    pub(crate) fn request_frame(
        &self,
        frame: &ChildFrameAuthority,
    ) -> Result<ChildTargetPendingRequest, String> {
        self.request_frame_with_route_hook(frame, || {})
    }

    fn request_frame_with_route_hook(
        &self,
        frame: &ChildFrameAuthority,
        after_route: impl FnOnce(),
    ) -> Result<ChildTargetPendingRequest, String> {
        let route = self
            .registry
            .resolve_frame(frame)
            .ok_or_else(|| "Stale child frame authority.".to_string())?;
        after_route();
        self.dispatch(
            route.target,
            route.endpoint,
            PendingResponseAuthority::Frame(frame.clone()),
            ChildTargetTransportRequest::Frame {
                backend_frame_id: route.backend_frame_id,
            },
        )
    }

    pub(crate) fn request_variables(
        &self,
        variable: &ChildVariableAuthority,
    ) -> Result<ChildTargetPendingRequest, String> {
        self.request_variables_with_route_hook(variable, || {})
    }

    fn request_variables_with_route_hook(
        &self,
        variable: &ChildVariableAuthority,
        after_route: impl FnOnce(),
    ) -> Result<ChildTargetPendingRequest, String> {
        let route = self
            .registry
            .resolve_variable(variable)
            .ok_or_else(|| "Stale child variable authority.".to_string())?;
        after_route();
        self.dispatch(
            route.target,
            route.endpoint,
            PendingResponseAuthority::Variable(variable.clone()),
            ChildTargetTransportRequest::Variables {
                backend_frame_id: route.backend_frame_id,
                backend_variable_reference: route.backend_variable_reference,
            },
        )
    }

    /// Borrows transport-owned response text, verifies its byte bound and exact source/request
    /// authority under one lock, and allocates retained output only after those checks pass.
    pub(crate) fn accept_response(
        &self,
        source: &ChildTargetResponseSource,
        request_id: u64,
        payload: &str,
    ) -> Result<Option<BoundedChildTargetResponse>, String> {
        let mut state = self.lock()?;
        let Some(record) = state.pending.get(&request_id) else {
            return Ok(None);
        };
        if &record.response_source != source {
            return Ok(None);
        }
        let record = state
            .pending
            .remove(&request_id)
            .expect("validated pending child-target request");
        if state.stopping
            || state.stop_result.is_some()
            || payload.len() > MAX_CHILD_TARGET_RESPONSE_BYTES
            || !response_authority_is_current(&self.registry, &state, source, &record)
        {
            return if payload.len() > MAX_CHILD_TARGET_RESPONSE_BYTES {
                Err("Child-target response exceeds the safety limit.".to_string())
            } else {
                Ok(None)
            };
        }
        Ok(Some(BoundedChildTargetResponse {
            payload: payload.into(),
        }))
    }

    /// Resume invalidates the complete pause lineage before dispatch. A lost resume response can
    /// never resurrect frames or variables that may already have resumed in the debuggee.
    pub(crate) fn resume(&self, pause: &ChildPauseAuthority) -> Result<(), String> {
        self.resume_with_route_hook(pause, || {})
    }

    fn resume_with_route_hook(
        &self,
        pause: &ChildPauseAuthority,
        after_route: impl FnOnce(),
    ) -> Result<(), String> {
        let route = self
            .registry
            .resolve_pause(pause)
            .ok_or_else(|| "Stale child pause authority.".to_string())?;
        after_route();
        let (source, request_id, mut transport) = {
            let mut state = self.lock()?;
            ensure_running(&state)?;
            let index = connection_index(&state, &route.target, &route.endpoint)
                .ok_or_else(|| "Child target transport is disconnected.".to_string())?;
            let source = state.connections[index].response_source.clone();
            if state.connections[index].transport.is_none() {
                return Err("Child target transport is busy.".to_string());
            }
            let request_id = take_counter(&mut state.next_request_id)?;
            self.registry.resume(pause)?;
            state
                .pending
                .retain(|_, request| request.response_source.target != source.target);
            let transport = state.connections[index]
                .transport
                .take()
                .expect("validated child target transport");
            (source, request_id, transport)
        };
        let result = send_transport(
            &mut transport,
            request_id,
            ChildTargetTransportRequest::Resume,
        );
        self.finish_transport_operation(&source, transport, result)
    }

    pub(crate) fn disconnect_target(&self, target: &ChildTargetAuthority) -> Result<(), String> {
        let transport = {
            let mut state = self.lock()?;
            ensure_running(&state)?;
            let index = state
                .connections
                .iter()
                .position(|connection| &connection.authority == target)
                .ok_or_else(|| "Child target transport is already disconnected.".to_string())?;
            self.registry.invalidate_target(target)?;
            let connection = state.connections.remove(index);
            state
                .pending
                .retain(|_, request| &request.response_source.target != target);
            connection.transport
        };
        match transport {
            Some(mut transport) => disconnect_transport(&mut transport),
            None => Ok(()),
        }
    }

    /// Exact-once stop invalidates all authorities and reaps the owned process group before any
    /// potentially blocking transport cleanup. No transport callback can hold the lifecycle lock.
    pub(crate) fn stop_and_reap(&self) -> Result<(), String> {
        let current_thread = std::thread::current().id();
        let mut transports = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            loop {
                if let Some(result) = &state.stop_result {
                    return result.clone();
                }
                if !state.stopping {
                    break;
                }
                if state.stop_owner == Some(current_thread) {
                    return Err("Child-target multiplexer stop is already in progress.".to_string());
                }
                state = self
                    .stop_finished
                    .wait(state)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            }
            state.stopping = true;
            state.stop_owner = Some(current_thread);
            state.pending.clear();
            state
                .connections
                .drain(..)
                .filter_map(|connection| connection.transport)
                .collect::<Vec<_>>()
        };
        let mut first_error = catch_unwind(AssertUnwindSafe(|| self.registry.stop_and_reap()))
            .unwrap_or_else(|payload| {
                Err(neutralize_panic_payload(
                    payload,
                    "Child-target registry panicked during multiplexer stop.",
                )
                .to_string())
            })
            .err();
        if let Some(error) = disconnect_all(&mut transports) {
            first_error.get_or_insert(error);
        }
        let result = first_error.map_or(Ok(()), Err);
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.stopping = false;
        state.stop_owner = None;
        state.stop_result = Some(result.clone());
        self.stop_finished.notify_all();
        result
    }

    fn dispatch(
        &self,
        target: ChildTargetAuthority,
        endpoint: ChildInspectorEndpoint,
        response_authority: PendingResponseAuthority,
        request: ChildTargetTransportRequest,
    ) -> Result<ChildTargetPendingRequest, String> {
        let (pending, mut transport) = {
            let mut state = self.lock()?;
            ensure_running(&state)?;
            if state.pending.len() >= MAX_PENDING_TARGET_REQUESTS {
                return Err("Child-target pending request inventory is full.".to_string());
            }
            let index = connection_index(&state, &target, &endpoint)
                .ok_or_else(|| "Child target transport is disconnected.".to_string())?;
            let transport = state.connections[index]
                .transport
                .take()
                .ok_or_else(|| "Child target transport is busy.".to_string())?;
            let request_id = take_counter(&mut state.next_request_id)?;
            let pending = ChildTargetPendingRequest {
                request_id,
                response_authority,
                response_source: state.connections[index].response_source.clone(),
            };
            state.pending.insert(request_id, pending.clone());
            (pending, transport)
        };
        let result = send_transport(&mut transport, pending.request_id, request);
        self.finish_transport_operation(&pending.response_source, transport, result)?;
        Ok(pending)
    }

    fn install_transport(
        &self,
        intent: &ConnectionIntent,
        mut transport: Strategy::Transport,
    ) -> Result<Option<Strategy::Transport>, String> {
        let mut state = match self.lock() {
            Ok(state) => state,
            Err(error) => {
                let _ = disconnect_transport(&mut transport);
                return Err(error);
            }
        };
        if ensure_running(&state).is_err() {
            return Ok(Some(transport));
        }
        let Some(connection) = state.connections.iter_mut().find(|connection| {
            connection.response_source == intent.response_source
                && connection.authority == intent.authority
                && connection.endpoint == intent.endpoint
        }) else {
            return Ok(Some(transport));
        };
        if connection.transport.is_some() {
            return Ok(Some(transport));
        }
        connection.transport = Some(transport);
        Ok(None)
    }

    fn connect_transport(&self, intent: &ConnectionIntent) -> Result<Strategy::Transport, String> {
        let mut strategy = {
            let mut slot = self
                .strategy
                .lock()
                .map_err(|_| "Child-target connection strategy is unavailable.".to_string())?;
            slot.take()
                .ok_or_else(|| "Child-target connection strategy is busy.".to_string())?
        };
        let result = catch_unwind(AssertUnwindSafe(|| {
            strategy.connect(
                &intent.authority,
                &intent.endpoint,
                intent.response_source.clone(),
            )
        }))
        .unwrap_or_else(|payload| {
            Err(
                neutralize_panic_payload(payload, "Child-target connection strategy panicked.")
                    .to_string(),
            )
        });
        let mut slot = self
            .strategy
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if slot.is_none() {
            *slot = Some(strategy);
        }
        result
    }

    fn invalidate_failed_connection(&self, intent: &ConnectionIntent) {
        if let Ok(mut state) = self.lock() {
            state
                .connections
                .retain(|connection| connection.response_source != intent.response_source);
            state
                .pending
                .retain(|_, request| request.response_source != intent.response_source);
        }
        let _ = self.registry.invalidate_target(&intent.authority);
    }

    fn finish_transport_operation(
        &self,
        source: &ChildTargetResponseSource,
        mut transport: Strategy::Transport,
        operation: Result<(), String>,
    ) -> Result<(), String> {
        if let Err(error) = operation {
            if let Ok(mut state) = self.lock() {
                state
                    .connections
                    .retain(|connection| connection.response_source != *source);
                state
                    .pending
                    .retain(|_, request| request.response_source != *source);
            }
            let _ = self.registry.invalidate_target(&source.target);
            let _ = disconnect_transport(&mut transport);
            return Err(error);
        }

        let mut state = match self.lock() {
            Ok(state) => state,
            Err(error) => {
                let _ = disconnect_transport(&mut transport);
                return Err(error);
            }
        };
        if ensure_running(&state).is_ok() {
            if let Some(connection) = state
                .connections
                .iter_mut()
                .find(|connection| connection.response_source == *source)
            {
                if connection.transport.is_none() {
                    connection.transport = Some(transport);
                    return Ok(());
                }
            }
        }
        drop(state);
        let _ = disconnect_transport(&mut transport);
        Err("Child target transport changed during request dispatch.".to_string())
    }

    fn lock(&self) -> Result<MutexGuard<'_, MultiplexerState<Strategy>>, String> {
        self.state
            .lock()
            .map_err(|_| "Child-target multiplexer is unavailable.".to_string())
    }
}

#[cfg(test)]
impl<Reaper, Strategy> NodeChildTargetMultiplexer<Reaper, Strategy>
where
    Reaper: OwnedNodeProcessGroupReaper,
    Strategy: ChildTargetConnectionStrategy,
{
    pub(crate) fn request_frame_after_route_for_test(
        &self,
        frame: &ChildFrameAuthority,
        after_route: impl FnOnce(),
    ) -> Result<ChildTargetPendingRequest, String> {
        self.request_frame_with_route_hook(frame, after_route)
    }

    pub(crate) fn request_variables_after_route_for_test(
        &self,
        variable: &ChildVariableAuthority,
        after_route: impl FnOnce(),
    ) -> Result<ChildTargetPendingRequest, String> {
        self.request_variables_with_route_hook(variable, after_route)
    }

    pub(crate) fn resume_after_route_for_test(
        &self,
        pause: &ChildPauseAuthority,
        after_route: impl FnOnce(),
    ) -> Result<(), String> {
        self.resume_with_route_hook(pause, after_route)
    }
}

impl<Reaper, Strategy> Drop for NodeChildTargetMultiplexer<Reaper, Strategy>
where
    Reaper: OwnedNodeProcessGroupReaper,
    Strategy: ChildTargetConnectionStrategy,
{
    fn drop(&mut self) {
        let _ = self.stop_and_reap();
    }
}

fn response_authority_is_current<Reaper, Strategy>(
    registry: &NodeChildTargetRegistry<Reaper>,
    state: &MultiplexerState<Strategy>,
    source: &ChildTargetResponseSource,
    pending: &ChildTargetPendingRequest,
) -> bool
where
    Reaper: OwnedNodeProcessGroupReaper,
    Strategy: ChildTargetConnectionStrategy,
{
    let Some(connection) = state.connections.iter().find(|connection| {
        connection.response_source == *source
            && connection.authority == source.target
            && pending.response_source == *source
    }) else {
        return false;
    };
    let endpoint = match &pending.response_authority {
        PendingResponseAuthority::Target(target) => {
            registry.resolve_target(target).map(|route| route.endpoint)
        }
        PendingResponseAuthority::Frame(frame) => {
            registry.resolve_frame(frame).map(|route| route.endpoint)
        }
        PendingResponseAuthority::Variable(variable) => registry
            .resolve_variable(variable)
            .map(|route| route.endpoint),
    };
    endpoint.is_some_and(|endpoint| endpoint == connection.endpoint)
}

fn ensure_running<Strategy: ChildTargetConnectionStrategy>(
    state: &MultiplexerState<Strategy>,
) -> Result<(), String> {
    if state.stopping || state.stop_result.is_some() {
        Err("Child-target multiplexer is stopped.".to_string())
    } else {
        Ok(())
    }
}

fn ensure_connection<Strategy: ChildTargetConnectionStrategy>(
    state: &MultiplexerState<Strategy>,
    target: &ChildTargetAuthority,
    endpoint: &ChildInspectorEndpoint,
) -> Result<(), String> {
    if connection_index(state, target, endpoint)
        .is_some_and(|index| state.connections[index].transport.is_some())
    {
        Ok(())
    } else {
        Err("Child target transport is disconnected.".to_string())
    }
}

fn ensure_endpoint_connection<Strategy: ChildTargetConnectionStrategy>(
    state: &MultiplexerState<Strategy>,
    endpoint: &ChildInspectorEndpoint,
) -> Result<(), String> {
    if connection_index_for_endpoint(state, endpoint)
        .is_some_and(|index| state.connections[index].transport.is_some())
    {
        Ok(())
    } else {
        Err("Child target transport is disconnected.".to_string())
    }
}

fn connection_index<Strategy: ChildTargetConnectionStrategy>(
    state: &MultiplexerState<Strategy>,
    target: &ChildTargetAuthority,
    endpoint: &ChildInspectorEndpoint,
) -> Option<usize> {
    state
        .connections
        .iter()
        .position(|connection| &connection.authority == target && &connection.endpoint == endpoint)
}

fn connection_index_for_endpoint<Strategy: ChildTargetConnectionStrategy>(
    state: &MultiplexerState<Strategy>,
    endpoint: &ChildInspectorEndpoint,
) -> Option<usize> {
    state
        .connections
        .iter()
        .position(|connection| &connection.endpoint == endpoint)
}

fn disconnect_all<Transport: ChildTargetTransport>(
    transports: &mut Vec<Transport>,
) -> Option<String> {
    let mut first_error = None;
    for transport in transports {
        if let Err(error) = disconnect_transport(transport) {
            first_error.get_or_insert(error);
        }
    }
    first_error
}

fn disconnect_transport<Transport: ChildTargetTransport>(
    transport: &mut Transport,
) -> Result<(), String> {
    catch_unwind(AssertUnwindSafe(|| transport.disconnect())).unwrap_or_else(|payload| {
        Err(neutralize_panic_payload(
            payload,
            "Child target transport panicked during disconnect.",
        )
        .to_string())
    })
}

fn send_transport<Transport: ChildTargetTransport>(
    transport: &mut Transport,
    request_id: u64,
    request: ChildTargetTransportRequest,
) -> Result<(), String> {
    catch_unwind(AssertUnwindSafe(|| transport.send(request_id, request))).unwrap_or_else(
        |payload| {
            Err(
                neutralize_panic_payload(payload, "Child target transport panicked during send.")
                    .to_string(),
            )
        },
    )
}

fn take_counter(counter: &mut u64) -> Result<u64, String> {
    let current = *counter;
    if current == 0 || current > MAX_SAFE_INTEGER {
        return Err("Child-target multiplexer authority counter is exhausted.".to_string());
    }
    *counter = current
        .checked_add(1)
        .ok_or_else(|| "Child-target multiplexer authority counter is exhausted.".to_string())?;
    Ok(current)
}
