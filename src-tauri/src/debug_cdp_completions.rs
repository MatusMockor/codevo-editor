//! Discovers pause-owned Debug Console completions through descriptor inspection without evaluating source text or invoking runtime accessors.

use super::transport::{CdpClient, CdpShared};
use super::variables::{
    ObjectReferenceAccess, MAX_CDP_OBJECT_ID_BYTES, MAX_CDP_PROPERTY_DESCRIPTORS,
};
use crate::debug_adapter::variable_name::{
    is_ecmascript_identifier_name, is_valid_debug_variable_name,
};
use crate::debug_adapter::{
    DebugCompletionItem, DebugCompletionItemKind, DebugCompletionQuery, DebugCompletionRequest,
    DebugCompletionResult, DebugCompletionRoot,
};
use serde_json::{json, Value};
#[cfg(test)]
use std::cell::Cell;
use std::collections::HashSet;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_COMPLETION_ITEMS: usize = 200;
const MAX_COMPLETION_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_COMPLETION_QUERY_BYTES: usize = 4 * 1024;
pub(super) const MAX_COMPLETION_REQUESTS_PER_PAUSE: usize =
    64 * (1 + MAX_COMPLETION_PROTOTYPE_DEPTH);
pub(super) const MAX_COMPLETION_DESCRIPTORS_PER_PAUSE: usize = 40_000;
const MAX_COMPLETION_DEPTH: usize = 8;
pub(super) const MAX_COMPLETION_PROTOTYPE_DEPTH: usize = 4;
const MAX_COMPLETION_DESCRIPTOR_PAYLOAD_BYTES: usize = 1024 * 1024;
const COMPLETION_DEADLINE: Duration = Duration::from_millis(300);

#[cfg(test)]
thread_local! {
    static TEST_COMPLETION_DEADLINE: Cell<Option<Duration>> = const { Cell::new(None) };
}

struct PropertyBatch {
    properties: Vec<Value>,
    prototype_object_id: Option<String>,
    descriptor_incomplete: bool,
    prototype_incomplete: bool,
}

struct PayloadByteCounter {
    written: usize,
}

impl Write for PayloadByteCounter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let next = self
            .written
            .checked_add(buffer.len())
            .ok_or_else(|| io::Error::other("payload byte count overflowed"))?;
        if next > MAX_COMPLETION_DESCRIPTOR_PAYLOAD_BYTES {
            return Err(io::Error::other("descriptor payload byte limit exceeded"));
        }
        self.written = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn complete(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugCompletionRequest,
) -> Result<DebugCompletionResult, String> {
    let deadline = Instant::now() + completion_deadline();
    ensure_owner(shared, request.pause_generation, request.frame_id)?;
    let (labels, kind, mut incomplete) = match &request.query {
        DebugCompletionQuery::Lexical { prefix } => {
            let (labels, incomplete) = lexical_labels(
                client,
                shared,
                request.pause_generation,
                request.frame_id,
                prefix,
                deadline,
            )?;
            (labels, DebugCompletionItemKind::Variable, incomplete)
        }
        DebugCompletionQuery::Member { root, path, prefix } => {
            if path.len() > MAX_COMPLETION_DEPTH {
                return Err("Debug completion member paths may contain at most 8 segments.".into());
            }
            let (labels, incomplete) = member_labels(
                client,
                shared,
                request.pause_generation,
                request.frame_id,
                root,
                path,
                prefix,
                deadline,
            )?;
            (labels, DebugCompletionItemKind::Property, incomplete)
        }
    };
    ensure_owner(shared, request.pause_generation, request.frame_id)?;
    incomplete |= Instant::now() >= deadline;

    let mut labels = labels;
    labels.sort_unstable();
    incomplete |= Instant::now() >= deadline;
    labels.dedup();
    if labels.len() > MAX_COMPLETION_ITEMS {
        labels.truncate(MAX_COMPLETION_ITEMS);
        incomplete = true;
    }
    let mut items = labels
        .into_iter()
        .map(|label| DebugCompletionItem { label, kind })
        .collect::<Vec<_>>();
    for _ in 0..=MAX_COMPLETION_ITEMS {
        if serialized_size(&items, incomplete)? <= MAX_COMPLETION_RESPONSE_BYTES {
            return Ok(DebugCompletionResult {
                items,
                is_incomplete: incomplete,
            });
        }
        items.pop();
        incomplete = true;
    }
    Err("Unable to bound the debug completion response.".into())
}

fn lexical_labels(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    prefix: &str,
    deadline: Instant,
) -> Result<(Vec<String>, bool), String> {
    let scopes = exact_scope_object_ids(shared, pause_generation, frame_id)?;
    let mut seen = HashSet::new();
    let mut labels = Vec::new();
    let mut incomplete = false;
    for object_id in scopes {
        if Instant::now() >= deadline {
            incomplete = true;
            break;
        }
        let batch = completion_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &object_id,
            deadline,
        )?;
        incomplete |= batch.descriptor_incomplete;
        for descriptor in batch.properties {
            if Instant::now() >= deadline {
                incomplete = true;
                break;
            }
            let Some(name) = descriptor.get("name").and_then(Value::as_str) else {
                incomplete = true;
                continue;
            };
            if !seen.insert(name.to_string()) {
                continue;
            }
            if descriptor.get("value").is_some()
                && is_valid_debug_variable_name(name)
                && is_ecmascript_identifier_name(name)
                && name.starts_with(prefix)
            {
                labels.push(name.to_string());
            }
        }
        if batch.descriptor_incomplete {
            break;
        }
    }
    Ok((labels, incomplete))
}

#[allow(clippy::too_many_arguments)]
fn member_labels(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &DebugCompletionRoot,
    path: &[String],
    prefix: &str,
    deadline: Instant,
) -> Result<(Vec<String>, bool), String> {
    let (mut object_id, mut incomplete) = match root {
        DebugCompletionRoot::This => (
            exact_this_object_id(shared, pause_generation, frame_id)?,
            false,
        ),
        DebugCompletionRoot::Binding(name) => {
            let (object_id, incomplete) =
                resolve_binding_object(client, shared, pause_generation, frame_id, name, deadline)?;
            let Some(object_id) = object_id else {
                return Ok((Vec::new(), true));
            };
            (object_id, incomplete)
        }
    };
    for segment in path {
        if Instant::now() >= deadline {
            return Ok((Vec::new(), true));
        }
        if segment.len() > MAX_COMPLETION_QUERY_BYTES || segment.chars().any(char::is_control) {
            return Err("Debug completion member path contains an invalid property name.".into());
        }
        let batch = completion_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &object_id,
            deadline,
        )?;
        incomplete |= batch.descriptor_incomplete;
        if batch.descriptor_incomplete {
            return Ok((Vec::new(), true));
        }
        object_id = unique_ordinary_data_object_id(&batch.properties, segment)
            .ok_or_else(|| {
                "Debug completion traversal is not an ordinary own data path.".to_string()
            })?
            .to_string();
    }
    let (labels, prototype_incomplete) = member_property_labels(
        client,
        shared,
        pause_generation,
        frame_id,
        object_id,
        prefix,
        deadline,
    )?;
    Ok((labels, incomplete | prototype_incomplete))
}

#[allow(clippy::too_many_arguments)]
fn member_property_labels(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    mut object_id: String,
    prefix: &str,
    deadline: Instant,
) -> Result<(Vec<String>, bool), String> {
    let mut labels = Vec::new();
    let mut seen_names = HashSet::new();
    let mut seen_objects = HashSet::new();
    let mut incomplete = false;
    seen_objects.insert(object_id.clone());
    for depth in 0..=MAX_COMPLETION_PROTOTYPE_DEPTH {
        if Instant::now() >= deadline {
            incomplete = true;
            break;
        }
        let batch = completion_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &object_id,
            deadline,
        )?;
        incomplete |= batch.descriptor_incomplete | batch.prototype_incomplete;
        let mut level_names = HashSet::new();
        for descriptor in batch.properties {
            if Instant::now() >= deadline {
                incomplete = true;
                break;
            }
            let Some(name) = descriptor.get("name").and_then(Value::as_str) else {
                incomplete = true;
                continue;
            };
            if !level_names.insert(name.to_string()) {
                incomplete = true;
                continue;
            }
            if !seen_names.insert(name.to_string()) {
                continue;
            }
            if descriptor.get("value").is_none()
                || !is_valid_debug_variable_name(name)
                || !is_ecmascript_identifier_name(name)
                || !name.starts_with(prefix)
            {
                continue;
            }
            labels.push(name.to_string());
        }
        if batch.descriptor_incomplete || batch.prototype_incomplete {
            break;
        }
        let Some(prototype_object_id) = batch.prototype_object_id else {
            break;
        };
        if depth == MAX_COMPLETION_PROTOTYPE_DEPTH {
            incomplete = true;
            break;
        }
        if !seen_objects.insert(prototype_object_id.clone()) {
            incomplete = true;
            break;
        }
        object_id = prototype_object_id;
    }
    Ok((labels, incomplete))
}

#[allow(clippy::too_many_arguments)]
fn resolve_binding_object(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    name: &str,
    deadline: Instant,
) -> Result<(Option<String>, bool), String> {
    let mut incomplete = false;
    for scope_id in exact_scope_object_ids(shared, pause_generation, frame_id)? {
        if Instant::now() >= deadline {
            return Ok((None, true));
        }
        let batch = completion_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &scope_id,
            deadline,
        )?;
        incomplete |= batch.descriptor_incomplete;
        if batch.descriptor_incomplete {
            return Ok((None, true));
        }
        let matches = batch
            .properties
            .iter()
            .filter(|descriptor| descriptor.get("name").and_then(Value::as_str) == Some(name))
            .collect::<Vec<_>>();
        if matches.is_empty() {
            continue;
        }
        if matches.len() != 1 {
            return Err("Debug completion binding ownership is ambiguous.".into());
        }
        let object_id = ordinary_data_object_id(matches[0]).ok_or_else(|| {
            "Debug completion binding is not an ordinary data object.".to_string()
        })?;
        return Ok((Some(object_id.to_string()), incomplete));
    }
    Err("Debug completion binding was not found in the paused scope chain.".into())
}

fn unique_ordinary_data_object_id<'a>(properties: &'a [Value], name: &str) -> Option<&'a str> {
    let mut matches = properties
        .iter()
        .filter(|descriptor| descriptor.get("name").and_then(Value::as_str) == Some(name));
    let first = matches.next()?;
    matches.next().is_none().then_some(())?;
    ordinary_data_object_id(first)
}

fn ordinary_data_object_id(descriptor: &Value) -> Option<&str> {
    let remote = descriptor.get("value")?;
    if descriptor.get("get").is_some()
        || descriptor.get("set").is_some()
        || remote.get("subtype").and_then(Value::as_str) == Some("proxy")
    {
        return None;
    }
    match remote.get("type").and_then(Value::as_str) {
        Some("object" | "function") => {}
        _ => return None,
    }
    let object_id = remote.get("objectId").and_then(Value::as_str)?;
    (!object_id.is_empty() && object_id.len() <= MAX_CDP_OBJECT_ID_BYTES).then_some(object_id)
}

fn completion_properties(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    object_id: &str,
    deadline: Instant,
) -> Result<PropertyBatch, String> {
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return Err("Debug completion object identity is invalid.".into());
    }
    if !reserve_request(shared, pause_generation, frame_id)? {
        return Ok(PropertyBatch {
            properties: Vec::new(),
            prototype_object_id: None,
            descriptor_incomplete: true,
            prototype_incomplete: false,
        });
    }
    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return Ok(PropertyBatch {
            properties: Vec::new(),
            prototype_object_id: None,
            descriptor_incomplete: true,
            prototype_incomplete: false,
        });
    };
    let response = client.request_with_timeout(
        "Runtime.getProperties",
        json!({
            "objectId": object_id,
            "ownProperties": true,
            "accessorPropertiesOnly": false,
            "generatePreview": false,
        }),
        remaining,
    )?;
    ensure_owner(shared, pause_generation, frame_id)?;
    let mut descriptor_incomplete = Instant::now() >= deadline;
    if !descriptor_payload_within_bound(&response) {
        return Ok(PropertyBatch {
            properties: Vec::new(),
            prototype_object_id: None,
            descriptor_incomplete: true,
            prototype_incomplete: false,
        });
    }
    descriptor_incomplete |= Instant::now() >= deadline;
    let properties = response
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "The debugger returned malformed completion descriptors.".to_string())?;
    let descriptor_count = ["result", "privateProperties", "internalProperties"]
        .into_iter()
        .filter_map(|key| response.get(key).and_then(Value::as_array))
        .try_fold(0usize, |count, values| count.checked_add(values.len()))
        .ok_or_else(|| "Debug completion descriptor count overflowed.".to_string())?;
    descriptor_incomplete |= Instant::now() >= deadline;
    if !charge_descriptors(shared, pause_generation, frame_id, descriptor_count)? {
        return Ok(PropertyBatch {
            properties: Vec::new(),
            prototype_object_id: None,
            descriptor_incomplete: true,
            prototype_incomplete: false,
        });
    }
    descriptor_incomplete |= descriptor_count > MAX_CDP_PROPERTY_DESCRIPTORS;
    let (prototype_object_id, prototype_incomplete) = prototype_object_id(&response);
    let mut bounded = Vec::with_capacity(properties.len().min(MAX_CDP_PROPERTY_DESCRIPTORS));
    for property in properties.iter().take(MAX_CDP_PROPERTY_DESCRIPTORS) {
        descriptor_incomplete |= Instant::now() >= deadline;
        descriptor_incomplete |= !is_well_formed_completion_descriptor(property);
        bounded.push(property.clone());
    }
    Ok(PropertyBatch {
        properties: bounded,
        prototype_object_id,
        descriptor_incomplete,
        prototype_incomplete,
    })
}

fn descriptor_payload_within_bound(response: &Value) -> bool {
    let mut counter = PayloadByteCounter { written: 0 };
    serde_json::to_writer(&mut counter, response).is_ok()
}

fn prototype_object_id(response: &Value) -> (Option<String>, bool) {
    let Some(internal_properties) = response.get("internalProperties") else {
        return (None, false);
    };
    let Some(internal_properties) = internal_properties.as_array() else {
        return (None, true);
    };
    let mut prototypes = internal_properties.iter().filter(|descriptor| {
        descriptor.get("name").and_then(Value::as_str) == Some("[[Prototype]]")
    });
    let Some(prototype) = prototypes.next() else {
        return (None, false);
    };
    if prototypes.next().is_some() {
        return (None, true);
    }
    let Some(remote) = prototype.get("value") else {
        return (None, true);
    };
    if remote.get("subtype").and_then(Value::as_str) == Some("proxy") {
        return (None, true);
    }
    match remote.get("type").and_then(Value::as_str) {
        Some("object" | "function") => {}
        _ => return (None, true),
    }
    let Some(object_id) = remote.get("objectId").and_then(Value::as_str) else {
        return (None, true);
    };
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return (None, true);
    }
    (Some(object_id.to_string()), false)
}

fn is_well_formed_completion_descriptor(descriptor: &Value) -> bool {
    let Some(name) = descriptor.get("name").and_then(Value::as_str) else {
        return false;
    };
    if name.len() > MAX_COMPLETION_QUERY_BYTES || name.chars().any(char::is_control) {
        return false;
    }
    let data = descriptor.get("value").is_some();
    let accessor = descriptor.get("get").is_some() || descriptor.get("set").is_some();
    data != accessor
}

fn exact_scope_object_ids(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<Vec<String>, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    let pause = exact_pause(&state, pause_generation, frame_id)?;
    pause
        .scopes
        .get(&frame_id)
        .ok_or_else(|| "Unknown debug completion frame.".to_string())?
        .iter()
        .map(|scope| {
            let owned = pause
                .object_ids
                .get(&scope.variables_reference)
                .ok_or_else(|| "Debug completion scope identity is stale.".to_string())?;
            if owned.pause_generation != pause_generation
                || owned.frame_id != frame_id
                || owned.access != ObjectReferenceAccess::ScopeRoot
            {
                return Err("Debug completion scope owner changed.".to_string());
            }
            Ok(owned.object_id.clone())
        })
        .collect()
}

fn exact_this_object_id(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<String, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    exact_pause(&state, pause_generation, frame_id)?
        .call_frame_this_object_ids
        .get(&frame_id)
        .cloned()
        .ok_or_else(|| "The paused frame has no ordinary `this` object.".to_string())
}

fn exact_pause(
    state: &CdpShared,
    pause_generation: u64,
    frame_id: u64,
) -> Result<&super::transport::PauseInventory, String> {
    let pause = state
        .pause
        .as_ref()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug completion pause owner changed.".into());
    }
    Ok(pause)
}

fn ensure_owner(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<(), String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    exact_pause(&state, pause_generation, frame_id).map(|_| ())
}

fn reserve_request(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<bool, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug completion pause owner changed.".into());
    }
    if pause.completion_requests >= MAX_COMPLETION_REQUESTS_PER_PAUSE {
        return Ok(false);
    }
    pause.completion_requests += 1;
    Ok(true)
}

fn charge_descriptors(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    count: usize,
) -> Result<bool, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug completion pause owner changed.".into());
    }
    let Some(next) = pause.completion_descriptors.checked_add(count) else {
        pause.completion_descriptors = MAX_COMPLETION_DESCRIPTORS_PER_PAUSE;
        return Ok(false);
    };
    if next > MAX_COMPLETION_DESCRIPTORS_PER_PAUSE {
        pause.completion_descriptors = MAX_COMPLETION_DESCRIPTORS_PER_PAUSE;
        return Ok(false);
    }
    pause.completion_descriptors = next;
    Ok(true)
}

fn completion_deadline() -> Duration {
    #[cfg(test)]
    if let Some(deadline) = TEST_COMPLETION_DEADLINE.with(Cell::get) {
        return deadline;
    }
    COMPLETION_DEADLINE
}

#[cfg(test)]
pub(super) fn with_test_completion_deadline<T>(
    deadline: Duration,
    operation: impl FnOnce() -> T,
) -> T {
    TEST_COMPLETION_DEADLINE.with(|slot| {
        let previous = slot.replace(Some(deadline));
        let result = operation();
        slot.set(previous);
        result
    })
}

fn serialized_size(items: &[DebugCompletionItem], is_incomplete: bool) -> Result<usize, String> {
    let encoded = serde_json::to_vec(&DebugCompletionResult {
        items: items.to_vec(),
        is_incomplete,
    })
    .map_err(|_| "Unable to encode the debug completion response.".to_string())?;
    Ok(encoded.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_object_policy_is_closed() {
        assert!(ordinary_data_object_id(&json!({
            "name":"repository",
            "value":{"type":"object","objectId":"object-1"}
        }))
        .is_some());
        for descriptor in [
            json!({"name":"x","get":{"type":"function","objectId":"getter"}}),
            json!({"name":"x","value":{"type":"object","subtype":"proxy","objectId":"proxy"}}),
            json!({"name":"x","value":{"type":"number","value":1}}),
        ] {
            assert!(ordinary_data_object_id(&descriptor).is_none());
        }
    }

    #[test]
    fn prototype_policy_blocks_proxies_and_malformed_identity() {
        for response in [
            json!({"internalProperties":[{
                "name":"[[Prototype]]",
                "value":{"type":"object","subtype":"proxy","objectId":"proxy"}
            }]}),
            json!({"internalProperties":[{
                "name":"[[Prototype]]",
                "value":{"type":"object","objectId":""}
            }]}),
        ] {
            assert_eq!(prototype_object_id(&response), (None, true));
        }
    }

    #[test]
    fn descriptor_payload_overflow_is_bounded_as_incomplete() {
        assert!(descriptor_payload_within_bound(&json!({
            "result":[{"name":"x","value":{"type":"string","value":"x"}}]
        })));
        assert!(!descriptor_payload_within_bound(&json!({
            "result":[{
                "name":"x",
                "value":{
                    "type":"string",
                    "value":"x".repeat(MAX_COMPLETION_DESCRIPTOR_PAYLOAD_BYTES)
                }
            }]
        })));
    }

    #[test]
    fn prototype_fan_out_scales_the_per_pause_request_budget() {
        let mut state = CdpShared::new(None);
        let mut pause = super::super::transport::PauseInventory {
            pause_generation: 1,
            ..super::super::transport::PauseInventory::default()
        };
        pause.call_frame_ids.insert(7, "frame-7".to_string());
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));

        for _ in 0..MAX_COMPLETION_REQUESTS_PER_PAUSE {
            assert!(reserve_request(&shared, 1, 7).expect("scaled request reservation"));
        }

        assert!(!reserve_request(&shared, 1, 7).expect("quota signal"));
    }

    #[test]
    fn descriptor_quota_exhaustion_is_a_truncation_signal() {
        let mut state = CdpShared::new(None);
        let mut pause = super::super::transport::PauseInventory {
            pause_generation: 1,
            completion_descriptors: MAX_COMPLETION_DESCRIPTORS_PER_PAUSE - 1,
            ..super::super::transport::PauseInventory::default()
        };
        pause.call_frame_ids.insert(7, "frame-7".to_string());
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));

        assert!(!charge_descriptors(&shared, 1, 7, 2).expect("quota signal"));
    }

    #[test]
    fn response_cap_accounts_for_utf8_and_shape() {
        let item = DebugCompletionItem {
            label: "é".repeat(512),
            kind: DebugCompletionItemKind::Property,
        };
        let items = vec![item; MAX_COMPLETION_ITEMS];
        assert!(serialized_size(&items, true).expect("size") > MAX_COMPLETION_RESPONSE_BYTES);
    }
}
