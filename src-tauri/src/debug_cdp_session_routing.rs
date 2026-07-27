use serde_json::{json, Value};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
#[cfg(test)]
use std::sync::mpsc::TryRecvError;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub(crate) const MAX_CDP_SESSION_ID_BYTES: usize = 128;
pub(crate) const MAX_CONCURRENT_CDP_SESSIONS: usize = 32;
pub(crate) const MAX_PENDING_CDP_REQUESTS_PER_SESSION: usize = 128;
pub(crate) const MAX_TOTAL_PENDING_CDP_REQUESTS: usize = 2_048;
const MAX_CDP_REQUEST_ID: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct CdpSessionId(Box<str>);

impl CdpSessionId {
    pub(crate) fn parse(value: &str) -> Result<Self, CdpSessionRoutingError> {
        if value.is_empty() || value.len() > MAX_CDP_SESSION_ID_BYTES || !value.is_ascii() {
            return Err(CdpSessionRoutingError::InvalidSessionId);
        }
        Ok(Self(value.into()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) enum CdpTargetScope {
    Parent,
    Session(CdpSessionId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpSessionRegistration {
    Registered { generation: u64 },
    Replaced { generation: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CdpSessionRoutingError {
    InvalidSessionId,
    SessionLimitReached,
    SessionNotRegistered,
    SessionPendingLimitReached,
    TotalPendingLimitReached,
    RequestIdExhausted,
    RouterUnavailable,
    TransportClosed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CdpSessionRequestError {
    Detached,
    Protocol(String),
    Replaced,
    Routing(CdpSessionRoutingError),
    TimedOut,
    TransportClosed,
    TransportQueueOverflow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpSessionEventDispatch {
    Delivered,
    Dropped,
    SinkPanicked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpSessionResponseDispatch {
    Delivered,
    Disconnected,
    Dropped,
    ReceiverOverflow,
}

pub(crate) type CdpSessionEventSink = Arc<dyn Fn(u64, Value) + Send + Sync>;

struct RegisteredSession {
    generation: u64,
    pending: HashMap<u64, mpsc::SyncSender<Result<Value, CdpSessionRequestError>>>,
    sink: CdpSessionEventSink,
}

struct CdpSessionRouterState {
    closed: bool,
    dropped_messages: u64,
    next_registration_generation: u64,
    next_request_id: u64,
    sessions: HashMap<CdpSessionId, RegisteredSession>,
    total_pending: usize,
}

#[derive(Clone)]
pub(crate) struct CdpSessionRouter {
    state: Arc<Mutex<CdpSessionRouterState>>,
}

impl CdpSessionRouter {
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(CdpSessionRouterState {
                closed: false,
                dropped_messages: 0,
                next_registration_generation: 1,
                next_request_id: 1,
                sessions: HashMap::new(),
                total_pending: 0,
            })),
        }
    }

    pub(crate) fn register(
        &self,
        session_id: CdpSessionId,
        sink: CdpSessionEventSink,
    ) -> Result<CdpSessionRegistration, CdpSessionRoutingError> {
        let (registration, replaced) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CdpSessionRoutingError::RouterUnavailable)?;
            if state.closed {
                return Err(CdpSessionRoutingError::TransportClosed);
            }
            if !state.sessions.contains_key(&session_id)
                && state.sessions.len() >= MAX_CONCURRENT_CDP_SESSIONS
            {
                return Err(CdpSessionRoutingError::SessionLimitReached);
            }
            let generation = state.next_registration_generation;
            state.next_registration_generation = generation
                .checked_add(1)
                .ok_or(CdpSessionRoutingError::RouterUnavailable)?;
            let outcome = match state.sessions.get_mut(&session_id) {
                Some(session) => {
                    let replaced = session.pending.drain().map(|(_, sender)| sender).collect();
                    session.generation = generation;
                    session.sink = sink;
                    (CdpSessionRegistration::Replaced { generation }, replaced)
                }
                None => {
                    state.sessions.insert(
                        session_id,
                        RegisteredSession {
                            generation,
                            pending: HashMap::new(),
                            sink,
                        },
                    );
                    (
                        CdpSessionRegistration::Registered { generation },
                        Vec::new(),
                    )
                }
            };
            state.total_pending = state.total_pending.saturating_sub(outcome.1.len());
            outcome
        };
        settle_requests(replaced, CdpSessionRequestError::Replaced);
        Ok(registration)
    }

    pub(crate) fn detach(&self, session_id: &CdpSessionId) -> bool {
        let pending = {
            let Ok(mut state) = self.state.lock() else {
                return false;
            };
            let Some(mut session) = state.sessions.remove(session_id) else {
                return false;
            };
            let pending: Vec<_> = session.pending.drain().map(|(_, sender)| sender).collect();
            state.total_pending = state.total_pending.saturating_sub(pending.len());
            pending
        };
        settle_requests(pending, CdpSessionRequestError::Detached);
        true
    }

    pub(crate) fn begin_request(
        &self,
        session_id: &CdpSessionId,
    ) -> Result<CdpPendingSessionRequest, CdpSessionRoutingError> {
        let (sender, receiver) = mpsc::sync_channel(1);
        let id = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CdpSessionRoutingError::RouterUnavailable)?;
            if state.closed {
                return Err(CdpSessionRoutingError::TransportClosed);
            }
            if state.total_pending >= MAX_TOTAL_PENDING_CDP_REQUESTS {
                return Err(CdpSessionRoutingError::TotalPendingLimitReached);
            }
            let pending_count = state
                .sessions
                .get(session_id)
                .map(|session| session.pending.len())
                .ok_or(CdpSessionRoutingError::SessionNotRegistered)?;
            if pending_count >= MAX_PENDING_CDP_REQUESTS_PER_SESSION {
                return Err(CdpSessionRoutingError::SessionPendingLimitReached);
            }
            let id = state.next_request_id;
            if id > MAX_CDP_REQUEST_ID {
                return Err(CdpSessionRoutingError::RequestIdExhausted);
            }
            state.next_request_id = id
                .checked_add(1)
                .ok_or(CdpSessionRoutingError::RequestIdExhausted)?;
            let Some(session) = state.sessions.get_mut(session_id) else {
                return Err(CdpSessionRoutingError::SessionNotRegistered);
            };
            session.pending.insert(id, sender);
            state.total_pending += 1;
            id
        };
        Ok(CdpPendingSessionRequest {
            id,
            receiver: Some(receiver),
            router: self.clone(),
            session_id: session_id.clone(),
        })
    }

    pub(crate) fn dispatch_response(
        &self,
        session_id: &CdpSessionId,
        id: u64,
        message: &Value,
    ) -> CdpSessionResponseDispatch {
        let sender = {
            let Ok(mut state) = self.state.lock() else {
                return CdpSessionResponseDispatch::Dropped;
            };
            let Some(session) = state.sessions.get_mut(session_id) else {
                increment_dropped_messages(&mut state);
                return CdpSessionResponseDispatch::Dropped;
            };
            let Some(sender) = session.pending.remove(&id) else {
                increment_dropped_messages(&mut state);
                return CdpSessionResponseDispatch::Dropped;
            };
            state.total_pending = state.total_pending.saturating_sub(1);
            sender
        };
        let outcome = match message.get("error") {
            Some(error) => Err(CdpSessionRequestError::Protocol(
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| error.to_string()),
            )),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        match sender.try_send(outcome) {
            Ok(()) => CdpSessionResponseDispatch::Delivered,
            Err(mpsc::TrySendError::Disconnected(_)) => CdpSessionResponseDispatch::Disconnected,
            Err(mpsc::TrySendError::Full(_)) => CdpSessionResponseDispatch::ReceiverOverflow,
        }
    }

    pub(crate) fn dispatch_event(
        &self,
        session_id: &CdpSessionId,
        message: &Value,
    ) -> CdpSessionEventDispatch {
        let (generation, sink) = {
            let Ok(mut state) = self.state.lock() else {
                return CdpSessionEventDispatch::Dropped;
            };
            let Some(session) = state.sessions.get(session_id) else {
                increment_dropped_messages(&mut state);
                return CdpSessionEventDispatch::Dropped;
            };
            (session.generation, Arc::clone(&session.sink))
        };
        if catch_unwind(AssertUnwindSafe(|| sink(generation, message.clone()))).is_err() {
            self.record_dropped_message();
            return CdpSessionEventDispatch::SinkPanicked;
        }
        CdpSessionEventDispatch::Delivered
    }

    pub(crate) fn close_transport(&self) {
        let pending = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.closed {
                return;
            }
            state.closed = true;
            state.total_pending = 0;
            state
                .sessions
                .drain()
                .flat_map(|(_, mut session)| {
                    session
                        .pending
                        .drain()
                        .map(|(_, sender)| sender)
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>()
        };
        settle_requests(pending, CdpSessionRequestError::TransportClosed);
    }

    pub(crate) fn record_dropped_message(&self) {
        if let Ok(mut state) = self.state.lock() {
            increment_dropped_messages(&mut state);
        }
    }

    #[cfg(test)]
    pub(crate) fn dropped_message_count(&self) -> u64 {
        self.state
            .lock()
            .map(|state| state.dropped_messages)
            .unwrap_or(u64::MAX)
    }

    fn cancel_request(&self, session_id: &CdpSessionId, id: u64) {
        if let Ok(mut state) = self.state.lock() {
            let removed = state
                .sessions
                .get_mut(session_id)
                .is_some_and(|session| session.pending.remove(&id).is_some());
            if removed {
                state.total_pending = state.total_pending.saturating_sub(1);
            }
        }
    }
}

pub(crate) struct CdpPendingSessionRequest {
    id: u64,
    receiver: Option<mpsc::Receiver<Result<Value, CdpSessionRequestError>>>,
    router: CdpSessionRouter,
    session_id: CdpSessionId,
}

impl CdpPendingSessionRequest {
    pub(crate) fn id(&self) -> u64 {
        self.id
    }

    pub(crate) fn recv_timeout(self, timeout: Duration) -> Result<Value, CdpSessionRequestError> {
        let Some(receiver) = self.receiver.as_ref() else {
            return Err(CdpSessionRequestError::TransportClosed);
        };
        match receiver.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => Err(CdpSessionRequestError::TimedOut),
            Err(RecvTimeoutError::Disconnected) => Err(CdpSessionRequestError::TransportClosed),
        }
    }

    #[cfg(test)]
    pub(crate) fn try_recv(&self) -> Result<Result<Value, CdpSessionRequestError>, TryRecvError> {
        let Some(receiver) = self.receiver.as_ref() else {
            return Err(TryRecvError::Disconnected);
        };
        receiver.try_recv()
    }

    #[cfg(test)]
    pub(crate) fn disconnect_receiver(&mut self) {
        self.receiver = None;
    }
}

impl Drop for CdpPendingSessionRequest {
    fn drop(&mut self) {
        self.router.cancel_request(&self.session_id, self.id);
    }
}

pub(crate) fn parse_cdp_target_scope(
    message: &Value,
) -> Result<CdpTargetScope, CdpSessionRoutingError> {
    let Some(value) = message.get("sessionId") else {
        return Ok(CdpTargetScope::Parent);
    };
    let Some(value) = value.as_str() else {
        return Err(CdpSessionRoutingError::InvalidSessionId);
    };
    CdpSessionId::parse(value).map(CdpTargetScope::Session)
}

pub(crate) fn serialize_cdp_request(
    scope: &CdpTargetScope,
    id: u64,
    method: &str,
    params: Value,
) -> String {
    match scope {
        CdpTargetScope::Parent => json!({"id": id, "method": method, "params": params}).to_string(),
        CdpTargetScope::Session(session_id) => json!({
            "id": id,
            "method": method,
            "params": params,
            "sessionId": session_id.as_str(),
        })
        .to_string(),
    }
}

fn increment_dropped_messages(state: &mut CdpSessionRouterState) {
    state.dropped_messages = state.dropped_messages.saturating_add(1);
}

fn settle_requests(
    requests: Vec<mpsc::SyncSender<Result<Value, CdpSessionRequestError>>>,
    error: CdpSessionRequestError,
) {
    for sender in requests {
        let _ = sender.try_send(Err(error.clone()));
    }
}
