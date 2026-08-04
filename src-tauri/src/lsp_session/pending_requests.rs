use super::LanguageServerRequestError;
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

pub(super) const MAX_PENDING_REQUESTS_PER_SESSION: usize = 64;
pub(super) const MAX_COMPLETION_RESPONSE_WIRE_ITEMS: usize = 2_001;
const MIN_BOUNDED_RESPONSE_DECODE_UTF8_BYTES: usize = 64 * 1024;
const COMPLETION_REQUEST_METHOD: &str = "textDocument/completion";
const COMPLETION_ITEMS_FIELD: &str = "items";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ResponseBodyBound {
    Full,
    CappedArrayField {
        field: &'static str,
        maximum_items: usize,
    },
}

impl ResponseBodyBound {
    pub(super) fn for_method(method: &str) -> Self {
        if method != COMPLETION_REQUEST_METHOD {
            return Self::Full;
        }
        Self::CappedArrayField {
            field: COMPLETION_ITEMS_FIELD,
            maximum_items: MAX_COMPLETION_RESPONSE_WIRE_ITEMS,
        }
    }
}

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
    response_body_bound: ResponseBodyBound,
    sender: PendingRequestSender,
}

enum PendingRequestRegistryState {
    Open {
        entries: HashMap<u64, PendingRequestEntry>,
        highest_client_request_id: Option<u64>,
        // Wire IDs are session-local and monotonic. Every unknown response at or below this
        // watermark is retired; retaining one scalar keeps arbitrarily old completion replies
        // bounded without retaining an unbounded set of cancelled request IDs.
        retired_completion_wire_id_high_watermark: Option<u64>,
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
                retired_completion_wire_id_high_watermark: None,
                wire_id_by_client_id: HashMap::new(),
            }),
        }
    }

    pub(super) fn admit(
        &self,
        wire_request_id: u64,
        client_request_id: Option<u64>,
        response_body_bound: ResponseBodyBound,
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
            ..
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
                response_body_bound,
                sender,
            },
        );
        Ok(())
    }

    fn response_body_bound(&self, wire_request_id: u64) -> Option<ResponseBodyBound> {
        let state = self.state.lock().ok()?;
        let PendingRequestRegistryState::Open {
            entries,
            retired_completion_wire_id_high_watermark,
            ..
        } = &*state
        else {
            return None;
        };
        entries
            .get(&wire_request_id)
            .map(|entry| entry.response_body_bound)
            .or_else(|| {
                retired_completion_wire_id_high_watermark
                    .is_some_and(|retired| wire_request_id <= retired)
                    .then(|| ResponseBodyBound::for_method(COMPLETION_REQUEST_METHOD))
            })
    }

    fn pending_capped_response_body_bound(&self) -> Option<ResponseBodyBound> {
        let state = self.state.lock().ok()?;
        let PendingRequestRegistryState::Open {
            entries,
            retired_completion_wire_id_high_watermark,
            ..
        } = &*state
        else {
            return None;
        };
        entries
            .values()
            .map(|entry| entry.response_body_bound)
            .find(|bound| !matches!(bound, ResponseBodyBound::Full))
            .or_else(|| {
                retired_completion_wire_id_high_watermark
                    .map(|_| ResponseBodyBound::for_method(COMPLETION_REQUEST_METHOD))
            })
    }

    pub(super) fn cancel(&self, client_request_id: u64) -> PendingRequestCancellationReceipt {
        let Ok(mut state) = self.state.lock() else {
            return PendingRequestCancellationReceipt::RegistryUnavailable;
        };
        let PendingRequestRegistryState::Open {
            entries,
            retired_completion_wire_id_high_watermark,
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
        retain_retired_capped_response(
            retired_completion_wire_id_high_watermark,
            wire_request_id,
            entry.response_body_bound,
        );
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

    pub(super) fn retire(&self, wire_request_id: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let PendingRequestRegistryState::Open {
            entries,
            retired_completion_wire_id_high_watermark,
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
            retain_retired_capped_response(
                retired_completion_wire_id_high_watermark,
                wire_request_id,
                entry.response_body_bound,
            );
        }
    }

    pub(super) fn close_and_reject(&self, message: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        if value.get("method").is_some()
            || (value.get("result").is_none() && value.get("error").is_none())
        {
            return PendingResponseReceipt::Unmatched;
        }
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            return PendingResponseReceipt::Unmatched;
        };
        let Ok(mut state) = self.state.lock() else {
            return PendingResponseReceipt::RegistryUnavailable;
        };
        let PendingRequestRegistryState::Open {
            entries,
            retired_completion_wire_id_high_watermark,
            wire_id_by_client_id,
            ..
        } = &mut *state
        else {
            return PendingResponseReceipt::SessionClosed;
        };
        let Some(entry) = entries.remove(&id) else {
            return if retired_completion_wire_id_high_watermark.is_some_and(|retired| id <= retired)
            {
                PendingResponseReceipt::Routed
            } else {
                PendingResponseReceipt::Unmatched
            };
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
    fn retired_completion_wire_id_high_watermark(&self) -> Option<u64> {
        self.state
            .lock()
            .map(|state| match &*state {
                PendingRequestRegistryState::Open {
                    retired_completion_wire_id_high_watermark,
                    ..
                } => *retired_completion_wire_id_high_watermark,
                PendingRequestRegistryState::Closed { .. } => None,
            })
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(super) fn lock_is_available(&self) -> bool {
        self.state.try_lock().is_ok()
    }
}

fn retain_retired_capped_response(
    retired_completion_wire_id_high_watermark: &mut Option<u64>,
    wire_request_id: u64,
    response_body_bound: ResponseBodyBound,
) {
    if matches!(response_body_bound, ResponseBodyBound::Full) {
        return;
    }
    *retired_completion_wire_id_high_watermark = Some(
        (*retired_completion_wire_id_high_watermark)
            .map_or(wire_request_id, |retired| retired.max(wire_request_id)),
    );
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

pub(super) fn decode_session_message(
    bytes: &[u8],
    pending_requests: &PendingRequests,
) -> Result<Value, serde_json::Error> {
    if bytes.len() < MIN_BOUNDED_RESPONSE_DECODE_UTF8_BYTES {
        return serde_json::from_slice(bytes);
    }
    match bounded_response_value(bytes, pending_requests) {
        Some(value) => Ok(value),
        None => serde_json::from_slice(bytes),
    }
}

fn bounded_response_value(bytes: &[u8], pending_requests: &PendingRequests) -> Option<Value> {
    let bound = pending_requests.pending_capped_response_body_bound()?;
    let ResponseBodyBound::CappedArrayField { .. } = bound else {
        return None;
    };
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let decoded = CappedResponseSeed {
        fallback_bound: bound,
        pending_requests,
    }
    .deserialize(&mut deserializer)
    .ok()?;
    deserializer.end().ok()?;
    let wire_request_id = decoded.id?;
    let exact_bound = pending_requests
        .response_body_bound(wire_request_id)
        .unwrap_or(ResponseBodyBound::Full);
    if decoded.applied_bound != Some(exact_bound) {
        return None;
    }
    let result = decoded.result?;

    Some(json!({
        "id": wire_request_id,
        "jsonrpc": "2.0",
        "result": result
    }))
}

struct CappedResponse {
    applied_bound: Option<ResponseBodyBound>,
    id: Option<u64>,
    result: Option<Value>,
}

struct CappedResponseSeed<'a> {
    fallback_bound: ResponseBodyBound,
    pending_requests: &'a PendingRequestRegistry,
}

impl<'de> DeserializeSeed<'de> for CappedResponseSeed<'_> {
    type Value = CappedResponse;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for CappedResponseSeed<'_> {
    type Value = CappedResponse;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a language server response message")
    }

    fn visit_map<A>(self, mut entries: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut id = None;
        let mut result = None;
        let mut applied_bound = None;
        while let Some(key) = entries.next_key::<Cow<'de, str>>()? {
            if key == "id" {
                id = entries.next_value::<Option<u64>>()?;
                continue;
            }
            if key == "result" {
                let response_body_bound = id
                    .and_then(|wire_request_id| {
                        self.pending_requests.response_body_bound(wire_request_id)
                    })
                    .unwrap_or_else(|| {
                        if id.is_some() {
                            ResponseBodyBound::Full
                        } else {
                            self.fallback_bound
                        }
                    });
                result = Some(match response_body_bound {
                    ResponseBodyBound::Full => entries.next_value::<Value>()?,
                    ResponseBodyBound::CappedArrayField {
                        field,
                        maximum_items,
                    } => entries.next_value_seed(CappedResultSeed {
                        field,
                        maximum_items,
                    })?,
                });
                applied_bound = Some(response_body_bound);
                continue;
            }
            entries.next_value::<IgnoredAny>()?;
        }

        Ok(CappedResponse {
            applied_bound,
            id,
            result,
        })
    }
}

struct CappedResultSeed {
    field: &'static str,
    maximum_items: usize,
}

impl<'de> DeserializeSeed<'de> for CappedResultSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for CappedResultSeed {
    type Value = Value;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a language server completion result")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Null)
    }

    fn visit_seq<A>(self, sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        CappedArraySeed {
            maximum_items: self.maximum_items,
        }
        .visit_seq(sequence)
        .map(Value::Array)
    }

    fn visit_map<A>(self, mut entries: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut projected = serde_json::Map::new();
        while let Some(key) = entries.next_key::<Cow<'de, str>>()? {
            if key == self.field {
                let items = entries.next_value_seed(CappedArraySeed {
                    maximum_items: self.maximum_items,
                })?;
                projected.insert(key.into_owned(), Value::Array(items));
                continue;
            }
            let value = entries.next_value::<Value>()?;
            projected.insert(key.into_owned(), value);
        }

        Ok(Value::Object(projected))
    }
}

struct CappedArraySeed {
    maximum_items: usize,
}

impl<'de> DeserializeSeed<'de> for CappedArraySeed {
    type Value = Vec<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for CappedArraySeed {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a language server response array")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut items = Vec::with_capacity(
            sequence
                .size_hint()
                .unwrap_or_default()
                .min(self.maximum_items),
        );
        while items.len() < self.maximum_items {
            let Some(item) = sequence.next_element::<Value>()? else {
                return Ok(items);
            };
            items.push(item);
        }
        while sequence.next_element::<IgnoredAny>()?.is_some() {}

        Ok(items)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const OVERSIZED_COMPLETION_ITEMS: usize = 27_759;

    fn completion_response_bytes(wire_request_id: u64, item_count: usize) -> Vec<u8> {
        let items = (0..item_count)
            .map(|index| {
                json!({
                    "label": format!("candidateSymbolName{index}"),
                    "kind": 6,
                    "sortText": format!("{index:05}"),
                    "filterText": format!("candidateSymbolName{index}"),
                    "insertTextFormat": 1,
                    "commitCharacters": [".", ",", "(", ")"],
                    "data": {
                        "cacheId": index,
                        "entryNames": [format!("candidateSymbolName{index}")],
                        "file": "/workspace/src/medium-2k.ts",
                        "line": 512,
                        "offset": 18
                    }
                })
            })
            .collect::<Vec<_>>();
        serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": wire_request_id,
            "result": { "isIncomplete": false, "items": items }
        }))
        .expect("serialize completion response")
    }

    fn completion_response_bytes_result_first(wire_request_id: u64, item_count: usize) -> Vec<u8> {
        let ordinary = completion_response_bytes(wire_request_id, item_count);
        let decoded: Value = serde_json::from_slice(&ordinary).expect("decode completion fixture");
        format!(
            "{{\"result\":{},\"id\":{wire_request_id},\"jsonrpc\":\"2.0\"}}",
            serde_json::to_string(&decoded["result"]).expect("serialize result-first fixture")
        )
        .into_bytes()
    }

    fn registry_with_completion_request(
        wire_request_id: u64,
    ) -> (PendingRequests, mpsc::Receiver<PendingRequestResult>) {
        registry_with_identified_request(
            wire_request_id,
            None,
            ResponseBodyBound::for_method("textDocument/completion"),
        )
    }

    fn registry_with_identified_request(
        wire_request_id: u64,
        client_request_id: Option<u64>,
        response_body_bound: ResponseBodyBound,
    ) -> (PendingRequests, mpsc::Receiver<PendingRequestResult>) {
        let registry: PendingRequests = Arc::new(PendingRequestRegistry::new());
        let (tx, rx) = mpsc::channel();
        registry
            .admit(wire_request_id, client_request_id, response_body_bound, tx)
            .expect("admit request");
        (registry, rx)
    }

    #[test]
    fn completion_method_is_the_only_capped_response_body_bound() {
        assert_eq!(
            ResponseBodyBound::for_method("textDocument/completion"),
            ResponseBodyBound::CappedArrayField {
                field: "items",
                maximum_items: MAX_COMPLETION_RESPONSE_WIRE_ITEMS,
            }
        );
        for method in [
            "textDocument/references",
            "textDocument/definition",
            "completionItem/resolve",
            "textDocument/documentHighlight",
        ] {
            assert_eq!(
                ResponseBodyBound::for_method(method),
                ResponseBodyBound::Full
            );
        }
    }

    #[test]
    fn oversized_completion_response_is_capped_before_the_items_are_materialized() {
        let (registry, _rx) = registry_with_completion_request(7);
        let bytes = completion_response_bytes(7, OVERSIZED_COMPLETION_ITEMS);
        assert!(bytes.len() > MIN_BOUNDED_RESPONSE_DECODE_UTF8_BYTES);

        let decoded = decode_session_message(&bytes, &registry).expect("bounded decode");

        let items = decoded["result"]["items"]
            .as_array()
            .expect("capped items array");
        assert_eq!(items.len(), MAX_COMPLETION_RESPONSE_WIRE_ITEMS);
        assert_eq!(items[0]["label"], "candidateSymbolName0");
        assert_eq!(decoded["result"]["isIncomplete"], Value::Bool(false));
        assert_eq!(decoded["id"], Value::from(7u64));
    }

    #[test]
    fn capped_completion_response_still_projects_a_truthfully_incomplete_list() {
        let (registry, _rx) = registry_with_completion_request(11);
        let bytes = completion_response_bytes(11, OVERSIZED_COMPLETION_ITEMS);

        let decoded = decode_session_message(&bytes, &registry).expect("bounded decode");
        let projected = crate::lsp_features::parse_completion_result(&decoded["result"])
            .expect("bounded completion projection");

        assert_eq!(
            projected.items.len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS - 1
        );
        assert!(projected.is_incomplete);
        assert_eq!(projected.items[0].label, "candidateSymbolName0");
    }

    #[test]
    fn completion_response_within_the_wire_cap_is_decoded_unchanged() {
        let (registry, _rx) = registry_with_completion_request(13);
        let bytes = completion_response_bytes(13, MAX_COMPLETION_RESPONSE_WIRE_ITEMS - 1);

        let decoded = decode_session_message(&bytes, &registry).expect("bounded decode");
        let projected = crate::lsp_features::parse_completion_result(&decoded["result"])
            .expect("bounded completion projection");

        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("items array")
                .len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS - 1
        );
        assert!(!projected.is_incomplete);
    }

    #[test]
    fn oversized_response_without_a_capped_bound_is_decoded_in_full() {
        let registry: PendingRequests = Arc::new(PendingRequestRegistry::new());
        let (tx, _rx) = mpsc::channel();
        registry
            .admit(
                17,
                None,
                ResponseBodyBound::for_method("textDocument/references"),
                tx,
            )
            .expect("admit references request");
        let bytes = completion_response_bytes(17, OVERSIZED_COMPLETION_ITEMS);

        let decoded = decode_session_message(&bytes, &registry).expect("full decode");

        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("items array")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
    }

    #[test]
    fn oversized_response_for_an_unknown_wire_id_is_decoded_in_full() {
        let (registry, _rx) = registry_with_completion_request(19);
        let bytes = completion_response_bytes(23, OVERSIZED_COMPLETION_ITEMS);

        let decoded = decode_session_message(&bytes, &registry).expect("full decode");

        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("items array")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
    }

    #[test]
    fn oversized_bare_array_completion_response_is_capped() {
        let (registry, _rx) = registry_with_completion_request(29);
        let items = (0..OVERSIZED_COMPLETION_ITEMS)
            .map(|index| json!({ "label": format!("candidate{index}") }))
            .collect::<Vec<_>>();
        let bytes = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": 29,
            "result": items
        }))
        .expect("serialize bare array response");

        let decoded = decode_session_message(&bytes, &registry).expect("bounded decode");

        assert_eq!(
            decoded["result"].as_array().expect("items array").len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );
    }

    #[test]
    fn lower_allocated_wire_id_can_admit_after_a_higher_completion_is_retired() {
        let registry = Arc::new(PendingRequestRegistry::new());
        let (completion_tx, completion_rx) = mpsc::channel();
        registry
            .admit(
                2,
                Some(1),
                ResponseBodyBound::for_method("textDocument/completion"),
                completion_tx,
            )
            .expect("admit completion");
        assert!(matches!(
            registry.cancel(1),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(completion_rx.recv().is_err());

        let (live_tx, live_rx) = mpsc::channel();
        registry
            .admit(1, Some(2), ResponseBodyBound::Full, live_tx)
            .expect("a previously allocated lower wire id must still admit");

        let bytes = completion_response_bytes(1, OVERSIZED_COMPLETION_ITEMS);
        let decoded = decode_session_message(&bytes, &registry).expect("decode exact live bound");
        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("full live items")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );
        assert_eq!(
            live_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("live result receipt")
                .expect("live result")["items"]
                .as_array()
                .expect("routed full items")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
    }

    #[test]
    fn malformed_oversized_response_still_fails_closed() {
        let (registry, _rx) = registry_with_completion_request(31);
        let mut bytes = completion_response_bytes(31, OVERSIZED_COMPLETION_ITEMS);
        bytes.truncate(bytes.len() - 1);

        assert!(decode_session_message(&bytes, &registry).is_err());
    }

    #[test]
    fn routed_capped_response_reaches_the_waiting_request() {
        let (registry, rx) = registry_with_completion_request(37);
        let bytes = completion_response_bytes(37, OVERSIZED_COMPLETION_ITEMS);

        let decoded = decode_session_message(&bytes, &registry).expect("bounded decode");
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );

        let result = rx
            .recv_timeout(Duration::from_secs(1))
            .expect("routed response")
            .expect("successful response");
        assert_eq!(
            result["items"].as_array().expect("items array").len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS
        );
    }

    #[test]
    fn cancelled_completion_keeps_bounded_decode_and_discards_duplicate_late_responses() {
        let (registry, cancelled_rx) = registry_with_identified_request(
            41,
            Some(401),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert_eq!(
            registry.cancel(401),
            PendingRequestCancellationReceipt::Cancelled {
                wire_request_id: 41
            }
        );
        assert!(
            cancelled_rx.recv().is_err(),
            "cancel must release the waiter"
        );

        let bytes = completion_response_bytes(41, OVERSIZED_COMPLETION_ITEMS);
        for _ in 0..2 {
            let decoded = decode_session_message(&bytes, &registry).expect("bounded late decode");
            assert_eq!(
                decoded["result"]["items"]
                    .as_array()
                    .expect("completion items")
                    .len(),
                MAX_COMPLETION_RESPONSE_WIRE_ITEMS
            );
            assert_eq!(
                route_pending_response(&registry, &decoded),
                PendingResponseReceipt::Routed
            );
        }
        assert_eq!(
            registry.retired_completion_wire_id_high_watermark(),
            Some(41)
        );
    }

    #[test]
    fn cancelled_completion_is_dropped_before_routing_the_following_live_response() {
        let (registry, cancelled_rx) = registry_with_identified_request(
            43,
            Some(403),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert!(matches!(
            registry.cancel(403),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(cancelled_rx.recv().is_err());

        let late = completion_response_bytes(43, OVERSIZED_COMPLETION_ITEMS);
        let decoded_late = decode_session_message(&late, &registry).expect("bounded late decode");
        assert_eq!(
            route_pending_response(&registry, &decoded_late),
            PendingResponseReceipt::Routed
        );

        let (live_tx, live_rx) = mpsc::channel();
        registry
            .admit(44, Some(404), ResponseBodyBound::Full, live_tx)
            .expect("admit live hover");
        let hover = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": 44,
            "result": { "contents": "live hover" }
        }))
        .expect("serialize hover");
        let decoded_hover = decode_session_message(&hover, &registry).expect("decode hover");
        assert_eq!(
            route_pending_response(&registry, &decoded_hover),
            PendingResponseReceipt::Routed
        );
        assert_eq!(
            live_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("live response receipt")
                .expect("live response"),
            json!({ "contents": "live hover" })
        );
    }

    #[test]
    fn retained_completion_tombstone_does_not_cap_an_unrelated_large_live_response() {
        let (registry, cancelled_rx) = registry_with_identified_request(
            45,
            Some(405),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert!(matches!(
            registry.cancel(405),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(cancelled_rx.recv().is_err());

        let (live_tx, live_rx) = mpsc::channel();
        registry
            .admit(46, Some(406), ResponseBodyBound::Full, live_tx)
            .expect("admit full response request");
        let bytes = completion_response_bytes(46, OVERSIZED_COMPLETION_ITEMS);
        let decoded = decode_session_message(&bytes, &registry).expect("decode full live response");
        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("full response items")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );
        assert_eq!(
            live_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("full response receipt")
                .expect("full response")["items"]
                .as_array()
                .expect("routed full items")
                .len(),
            OVERSIZED_COMPLETION_ITEMS
        );
        assert_eq!(
            registry.retired_completion_wire_id_high_watermark(),
            Some(45)
        );
    }

    #[test]
    fn result_before_id_keeps_exact_tombstone_and_live_response_semantics() {
        const LARGE_RESULT_ITEMS: usize = MAX_COMPLETION_RESPONSE_WIRE_ITEMS + 99;
        let (registry, cancelled_rx) = registry_with_identified_request(
            47,
            Some(407),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert!(matches!(
            registry.cancel(407),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(cancelled_rx.recv().is_err());

        let late = completion_response_bytes_result_first(47, LARGE_RESULT_ITEMS);
        let decoded_late =
            decode_session_message(&late, &registry).expect("decode late completion");
        assert_eq!(
            decoded_late["result"]["items"]
                .as_array()
                .expect("bounded completion items")
                .len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded_late),
            PendingResponseReceipt::Routed
        );

        let (live_tx, live_rx) = mpsc::channel();
        registry
            .admit(48, Some(408), ResponseBodyBound::Full, live_tx)
            .expect("admit full live response");
        let live = completion_response_bytes_result_first(48, LARGE_RESULT_ITEMS);
        let decoded_live = decode_session_message(&live, &registry).expect("decode full response");
        assert_eq!(
            decoded_live["result"]["items"]
                .as_array()
                .expect("full items")
                .len(),
            LARGE_RESULT_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded_live),
            PendingResponseReceipt::Routed
        );
        assert_eq!(
            live_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("live result receipt")
                .expect("live result")["items"]
                .as_array()
                .expect("routed live items")
                .len(),
            LARGE_RESULT_ITEMS
        );
    }

    #[test]
    fn more_than_capacity_retirements_keep_the_oldest_late_completion_bounded() {
        let registry = Arc::new(PendingRequestRegistry::new());
        let last_id = MAX_PENDING_REQUESTS_PER_SESSION as u64 + 1;
        for id in 1..=last_id {
            let (tx, rx) = mpsc::channel();
            registry
                .admit(
                    id,
                    Some(id),
                    ResponseBodyBound::for_method("textDocument/completion"),
                    tx,
                )
                .expect("admit completion");
            assert!(matches!(
                registry.cancel(id),
                PendingRequestCancellationReceipt::Cancelled { .. }
            ));
            assert!(rx.recv().is_err());
        }

        assert_eq!(
            registry.retired_completion_wire_id_high_watermark(),
            Some(last_id)
        );

        let oldest = completion_response_bytes(1, OVERSIZED_COMPLETION_ITEMS);
        let decoded = decode_session_message(&oldest, &registry)
            .expect("oldest retired completion remains bounded");
        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("bounded completion items")
                .len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );
    }

    #[test]
    fn cancellation_tombstones_do_not_leak_across_a_b_a_session_replacement() {
        let (session_a1, session_a1_rx) = registry_with_identified_request(
            47,
            Some(407),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert!(matches!(
            session_a1.cancel(407),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(session_a1_rx.recv().is_err());

        let session_b = Arc::new(PendingRequestRegistry::new());
        assert_eq!(
            session_a1.retired_completion_wire_id_high_watermark(),
            Some(47)
        );
        assert_eq!(session_b.retired_completion_wire_id_high_watermark(), None);

        session_a1.close_and_reject("replaced");
        assert_eq!(session_a1.retired_completion_wire_id_high_watermark(), None);
        assert_eq!(
            session_a1.cancel(407),
            PendingRequestCancellationReceipt::SessionClosed
        );

        let (session_a2, session_a2_rx) = registry_with_identified_request(
            47,
            Some(407),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert_eq!(session_a2.retired_completion_wire_id_high_watermark(), None);
        assert_eq!(session_a2_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
        assert!(matches!(
            session_a2.cancel(407),
            PendingRequestCancellationReceipt::Cancelled {
                wire_request_id: 47
            }
        ));
        assert!(session_a2_rx.recv().is_err());
        assert_eq!(
            session_a2.retired_completion_wire_id_high_watermark(),
            Some(47)
        );
    }

    #[test]
    fn cancelling_a_full_response_request_does_not_consume_tombstone_capacity() {
        let (registry, rx) = registry_with_identified_request(
            53,
            Some(503),
            ResponseBodyBound::for_method("textDocument/hover"),
        );
        assert!(matches!(
            registry.cancel(503),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(rx.recv().is_err());
        assert_eq!(registry.retired_completion_wire_id_high_watermark(), None);
    }

    #[test]
    fn server_request_with_a_retired_wire_id_is_not_misclassified_as_a_response() {
        let (registry, rx) = registry_with_identified_request(
            57,
            Some(507),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        assert!(matches!(
            registry.cancel(507),
            PendingRequestCancellationReceipt::Cancelled { .. }
        ));
        assert!(rx.recv().is_err());

        assert_eq!(
            route_pending_response(
                &registry,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 57,
                    "method": "workspace/configuration",
                    "params": { "items": [] }
                })
            ),
            PendingResponseReceipt::Unmatched
        );
        assert_eq!(
            registry.retired_completion_wire_id_high_watermark(),
            Some(57)
        );
    }

    #[test]
    fn retired_timed_out_completion_keeps_its_late_response_bound() {
        let (registry, timed_out_rx) = registry_with_identified_request(
            59,
            Some(509),
            ResponseBodyBound::for_method("textDocument/completion"),
        );
        registry.retire(59);
        assert!(
            timed_out_rx.recv().is_err(),
            "retire must release the waiter"
        );
        assert_eq!(
            registry.retired_completion_wire_id_high_watermark(),
            Some(59)
        );

        let bytes = completion_response_bytes(59, OVERSIZED_COMPLETION_ITEMS);
        let decoded = decode_session_message(&bytes, &registry).expect("bounded timed-out decode");
        assert_eq!(
            decoded["result"]["items"]
                .as_array()
                .expect("completion items")
                .len(),
            MAX_COMPLETION_RESPONSE_WIRE_ITEMS
        );
        assert_eq!(
            route_pending_response(&registry, &decoded),
            PendingResponseReceipt::Routed
        );
    }

    #[test]
    #[ignore = "measurement bench; run explicitly with --ignored --nocapture"]
    fn bounded_completion_decode_bench() {
        let (registry, _rx) = registry_with_completion_request(41);
        let bytes = completion_response_bytes(41, OVERSIZED_COMPLETION_ITEMS);
        let unbounded: PendingRequests = Arc::new(PendingRequestRegistry::new());

        let mut full = Duration::MAX;
        let mut bounded = Duration::MAX;
        for _ in 0..5 {
            let started_at = Instant::now();
            let message = decode_session_message(&bytes, &unbounded).expect("full decode");
            let result = parse_response_result(&message).expect("full response result");
            let projected =
                crate::lsp_features::parse_completion_result(&result).expect("full projection");
            full = full.min(started_at.elapsed());
            assert_eq!(
                projected.items.len(),
                MAX_COMPLETION_RESPONSE_WIRE_ITEMS - 1
            );

            let started_at = Instant::now();
            let message = decode_session_message(&bytes, &registry).expect("bounded decode");
            let result = parse_response_result(&message).expect("bounded response result");
            let projected =
                crate::lsp_features::parse_completion_result(&result).expect("bounded projection");
            bounded = bounded.min(started_at.elapsed());
            assert_eq!(
                projected.items.len(),
                MAX_COMPLETION_RESPONSE_WIRE_ITEMS - 1
            );
        }

        println!(
            "completion decode+route+project of {OVERSIZED_COMPLETION_ITEMS} items ({} bytes): full {full:?}, bounded {bounded:?}",
            bytes.len()
        );
    }

    #[test]
    fn poisoned_registry_cleanup_closes_and_rejects_every_waiter() {
        let registry = PendingRequestRegistry::new();
        let (first_tx, first_rx) = mpsc::channel();
        let (second_tx, second_rx) = mpsc::channel();
        registry
            .admit(1, None, ResponseBodyBound::Full, first_tx)
            .expect("admit first");
        registry
            .admit(2, None, ResponseBodyBound::Full, second_tx)
            .expect("admit second");

        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = registry.state.lock().expect("pending registry");
            panic!("poison pending request registry mutex");
        }));
        assert!(poisoned.is_err());

        registry.close_and_reject("Language server request was stopped.");

        for receiver in [first_rx, second_rx] {
            let rejection = receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("cleanup should settle waiter")
                .expect_err("cleanup should reject waiter");
            assert!(rejection.to_string().contains("stopped"));
        }

        let state = registry
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(matches!(
            &*state,
            PendingRequestRegistryState::Closed { .. }
        ));
    }
}
