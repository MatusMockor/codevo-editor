use super::LanguageServerRequestError;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

pub(super) const MAX_PENDING_REQUESTS_PER_SESSION: usize = 64;

pub(super) type PendingRequestResult = Result<Value, LanguageServerRequestError>;
type PendingRequestSender = mpsc::Sender<PendingRequestResult>;
pub(super) type PendingRequests = Arc<PendingRequestRegistry>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum PendingRequestAdmissionError {
    CapacityExceeded { capacity: usize },
    DuplicateId,
    InvalidRequestId,
    RequestIdNotMonotonic { previous: u64, received: u64 },
    RegistryUnavailable,
    SessionClosed { message: String },
}

impl std::fmt::Display for PendingRequestAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CapacityExceeded { capacity } => write!(
                formatter,
                "Language server pending request capacity ({capacity}) was reached."
            ),
            Self::DuplicateId => {
                formatter.write_str("Language server request id is already pending.")
            }
            Self::InvalidRequestId => {
                formatter.write_str("Language server request id must be greater than zero.")
            }
            Self::RequestIdNotMonotonic { previous, received } => write!(
                formatter,
                "Language server request id {received} is not newer than {previous}."
            ),
            Self::RegistryUnavailable => {
                formatter.write_str("Language server pending request registry is unavailable.")
            }
            Self::SessionClosed { message } => formatter.write_str(message),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PendingRequestCancellationReceipt {
    Cancelled { wire_request_id: u64 },
    NotPending,
    RegistryUnavailable,
    SessionClosed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PendingResponseReceipt {
    Routed,
    Unmatched,
    RegistryUnavailable,
    SessionClosed,
}

struct PendingRequestEntry {
    client_request_id: Option<u64>,
    sender: PendingRequestSender,
}

enum PendingRequestRegistryState {
    Open {
        entries: HashMap<u64, PendingRequestEntry>,
        highest_client_request_id: Option<u64>,
        wire_id_by_client_id: HashMap<u64, u64>,
    },
    Closed {
        message: String,
    },
}

pub(super) struct PendingRequestRegistry {
    state: Mutex<PendingRequestRegistryState>,
}

impl PendingRequestRegistry {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(PendingRequestRegistryState::Open {
                entries: HashMap::new(),
                highest_client_request_id: None,
                wire_id_by_client_id: HashMap::new(),
            }),
        }
    }

    pub(super) fn admit(
        &self,
        wire_request_id: u64,
        client_request_id: Option<u64>,
        sender: PendingRequestSender,
    ) -> Result<(), PendingRequestAdmissionError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| PendingRequestAdmissionError::RegistryUnavailable)?;
        let PendingRequestRegistryState::Open {
            entries,
            highest_client_request_id,
            wire_id_by_client_id,
        } = &mut *state
        else {
            let PendingRequestRegistryState::Closed { message } = &*state else {
                unreachable!("pending request registry state is exhaustive");
            };
            return Err(PendingRequestAdmissionError::SessionClosed {
                message: message.clone(),
            });
        };
        if entries.contains_key(&wire_request_id) {
            return Err(PendingRequestAdmissionError::DuplicateId);
        }
        if entries.len() >= MAX_PENDING_REQUESTS_PER_SESSION {
            return Err(PendingRequestAdmissionError::CapacityExceeded {
                capacity: MAX_PENDING_REQUESTS_PER_SESSION,
            });
        }
        if let Some(client_request_id) = client_request_id {
            if client_request_id == 0 {
                return Err(PendingRequestAdmissionError::InvalidRequestId);
            }
            if let Some(previous) = *highest_client_request_id {
                if client_request_id <= previous {
                    return Err(PendingRequestAdmissionError::RequestIdNotMonotonic {
                        previous,
                        received: client_request_id,
                    });
                }
            }
            if wire_id_by_client_id.contains_key(&client_request_id) {
                return Err(PendingRequestAdmissionError::DuplicateId);
            }
            *highest_client_request_id = Some(client_request_id);
            wire_id_by_client_id.insert(client_request_id, wire_request_id);
        }

        entries.insert(
            wire_request_id,
            PendingRequestEntry {
                client_request_id,
                sender,
            },
        );
        Ok(())
    }

    pub(super) fn cancel(&self, client_request_id: u64) -> PendingRequestCancellationReceipt {
        let Ok(mut state) = self.state.lock() else {
            return PendingRequestCancellationReceipt::RegistryUnavailable;
        };
        let PendingRequestRegistryState::Open {
            entries,
            wire_id_by_client_id,
            ..
        } = &mut *state
        else {
            return PendingRequestCancellationReceipt::SessionClosed;
        };
        let Some(wire_request_id) = wire_id_by_client_id.remove(&client_request_id) else {
            return PendingRequestCancellationReceipt::NotPending;
        };
        let Some(entry) = entries.remove(&wire_request_id) else {
            return PendingRequestCancellationReceipt::NotPending;
        };
        drop(entry);

        PendingRequestCancellationReceipt::Cancelled { wire_request_id }
    }

    pub(super) fn remove(&self, wire_request_id: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let PendingRequestRegistryState::Open {
            entries,
            wire_id_by_client_id,
            ..
        } = &mut *state
        else {
            return;
        };
        if let Some(entry) = entries.remove(&wire_request_id) {
            if let Some(client_request_id) = entry.client_request_id {
                wire_id_by_client_id.remove(&client_request_id);
            }
        }
    }

    pub(super) fn close_and_reject(&self, message: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let senders = match std::mem::replace(
            &mut *state,
            PendingRequestRegistryState::Closed {
                message: message.to_string(),
            },
        ) {
            PendingRequestRegistryState::Open { entries, .. } => entries
                .into_values()
                .map(|entry| entry.sender)
                .collect::<Vec<_>>(),
            PendingRequestRegistryState::Closed { .. } => return,
        };
        drop(state);

        for sender in senders {
            let _ = sender.send(Err(LanguageServerRequestError::from(message)));
        }
    }

    pub(super) fn route_response(&self, value: &Value) -> PendingResponseReceipt {
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            return PendingResponseReceipt::Unmatched;
        };
        let Ok(mut state) = self.state.lock() else {
            return PendingResponseReceipt::RegistryUnavailable;
        };
        let PendingRequestRegistryState::Open {
            entries,
            wire_id_by_client_id,
            ..
        } = &mut *state
        else {
            return PendingResponseReceipt::SessionClosed;
        };
        let Some(entry) = entries.remove(&id) else {
            return PendingResponseReceipt::Unmatched;
        };
        if let Some(client_request_id) = entry.client_request_id {
            wire_id_by_client_id.remove(&client_request_id);
        }

        let _ = entry.sender.send(parse_response_result(value));
        PendingResponseReceipt::Routed
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.state
            .lock()
            .map(|state| match &*state {
                PendingRequestRegistryState::Open { entries, .. } => entries.len(),
                PendingRequestRegistryState::Closed { .. } => 0,
            })
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(super) fn lock_is_available(&self) -> bool {
        self.state.try_lock().is_ok()
    }
}

pub(super) fn reject_pending_requests(pending_requests: &PendingRequests, message: &str) {
    pending_requests.close_and_reject(message);
}

pub(super) fn route_pending_response(
    pending_requests: &PendingRequests,
    value: &Value,
) -> PendingResponseReceipt {
    pending_requests.route_response(value)
}

pub(super) fn parse_response_result(value: &Value) -> PendingRequestResult {
    if let Some(result) = value.get("result") {
        return Ok(result.clone());
    }

    let Some(error) = value.get("error") else {
        return Err(LanguageServerRequestError::from(
            "Language server returned a malformed response.",
        ));
    };
    let Some(message) = error.get("message").and_then(Value::as_str) else {
        return Err(LanguageServerRequestError::from(
            "Language server returned a malformed response.",
        ));
    };
    let Some(code) = error.get("code").and_then(Value::as_i64) else {
        return Err(LanguageServerRequestError::from(message));
    };

    Err(LanguageServerRequestError::Response {
        code,
        message: message.to_string(),
    })
}
