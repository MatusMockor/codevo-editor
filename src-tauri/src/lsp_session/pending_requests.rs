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
        let PendingRequestRegistryState::Open { entries, .. } = &*state else {
            return None;
        };
        entries
            .get(&wire_request_id)
            .map(|entry| entry.response_body_bound)
    }

    fn pending_capped_response_body_bound(&self) -> Option<ResponseBodyBound> {
        let state = self.state.lock().ok()?;
        let PendingRequestRegistryState::Open { entries, .. } = &*state else {
            return None;
        };
        entries
            .values()
            .map(|entry| entry.response_body_bound)
            .find(|bound| !matches!(bound, ResponseBodyBound::Full))
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
    let ResponseBodyBound::CappedArrayField {
        field,
        maximum_items,
    } = bound
    else {
        return None;
    };
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let decoded = CappedResponseSeed {
        field,
        maximum_items,
    }
    .deserialize(&mut deserializer)
    .ok()?;
    deserializer.end().ok()?;
    let wire_request_id = decoded.id?;
    if pending_requests.response_body_bound(wire_request_id) != Some(bound) {
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
    id: Option<u64>,
    result: Option<Value>,
}

struct CappedResponseSeed {
    field: &'static str,
    maximum_items: usize,
}

impl<'de> DeserializeSeed<'de> for CappedResponseSeed {
    type Value = CappedResponse;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for CappedResponseSeed {
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
        while let Some(key) = entries.next_key::<Cow<'de, str>>()? {
            if key == "id" {
                id = entries.next_value::<Option<u64>>()?;
                continue;
            }
            if key == "result" {
                result = Some(entries.next_value_seed(CappedResultSeed {
                    field: self.field,
                    maximum_items: self.maximum_items,
                })?);
                continue;
            }
            entries.next_value::<IgnoredAny>()?;
        }

        Ok(CappedResponse { id, result })
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

    fn registry_with_completion_request(
        wire_request_id: u64,
    ) -> (PendingRequests, mpsc::Receiver<PendingRequestResult>) {
        let registry: PendingRequests = Arc::new(PendingRequestRegistry::new());
        let (tx, rx) = mpsc::channel();
        registry
            .admit(
                wire_request_id,
                None,
                ResponseBodyBound::for_method("textDocument/completion"),
                tx,
            )
            .expect("admit completion request");
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
