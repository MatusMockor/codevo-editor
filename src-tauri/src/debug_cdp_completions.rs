//! Side-effect-free Debug Console completion discovery.
//!
//! This deliberately never evaluates source text. It walks pause-owned scope
//! objects and ordinary own data descriptors only.

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
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_COMPLETION_ITEMS: usize = 200;
const MAX_COMPLETION_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_COMPLETION_QUERY_BYTES: usize = 4 * 1024;
const MAX_COMPLETION_REQUESTS_PER_PAUSE: usize = 64;
const MAX_COMPLETION_DESCRIPTORS_PER_PAUSE: usize = 40_000;
const MAX_COMPLETION_DEPTH: usize = 8;
const COMPLETION_DEADLINE: Duration = Duration::from_millis(300);

struct PropertyBatch {
    properties: Vec<Value>,
    incomplete: bool,
}

pub(super) fn complete(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugCompletionRequest,
) -> Result<DebugCompletionResult, String> {
    let deadline = Instant::now() + COMPLETION_DEADLINE;
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
    ensure_deadline(deadline)?;

    let mut labels = labels;
    labels.sort_unstable();
    ensure_deadline(deadline)?;
    labels.dedup();
    if labels.len() > MAX_COMPLETION_ITEMS {
        labels.truncate(MAX_COMPLETION_ITEMS);
        incomplete = true;
    }
    let mut items = labels
        .into_iter()
        .map(|label| DebugCompletionItem { label, kind })
        .collect::<Vec<_>>();
    while serialized_size(&items, incomplete, deadline)? > MAX_COMPLETION_RESPONSE_BYTES {
        ensure_deadline(deadline)?;
        if items.pop().is_none() {
            return Err("Unable to bound the debug completion response.".into());
        }
        incomplete = true;
    }
    Ok(DebugCompletionResult {
        items,
        is_incomplete: incomplete,
    })
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
        incomplete |= batch.incomplete;
        for descriptor in batch.properties {
            if Instant::now() >= deadline {
                incomplete = true;
                break;
            }
            let Some(name) = descriptor.get("name").and_then(Value::as_str) else {
                incomplete = true;
                continue;
            };
            // A nearer accessor or malformed descriptor still shadows an outer binding.
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
        // Missing descriptors in a nearer scope may shadow every outer name.
        // Keep the known nearer results but never guess by falling through.
        if batch.incomplete {
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
        ensure_deadline(deadline)?;
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
        incomplete |= batch.incomplete;
        if batch.incomplete {
            return Ok((Vec::new(), true));
        }
        object_id = unique_ordinary_data_object_id(&batch.properties, segment)
            .ok_or_else(|| {
                "Debug completion traversal is not an ordinary own data path.".to_string()
            })?
            .to_string();
    }
    let batch = completion_properties(
        client,
        shared,
        pause_generation,
        frame_id,
        &object_id,
        deadline,
    )?;
    incomplete |= batch.incomplete;
    let mut labels = Vec::new();
    let mut seen = HashSet::new();
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
            incomplete = true;
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
        incomplete |= batch.incomplete;
        // A truncated nearer scope may contain the binding (or a duplicate).
        // Returning an outer/root candidate would violate lexical ownership.
        if batch.incomplete {
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
    reserve_request(shared, pause_generation, frame_id)?;
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| "Debug completion deadline expired.".to_string())?;
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
    ensure_deadline(deadline)?;
    let properties = response
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "The debugger returned malformed completion descriptors.".to_string())?;
    let descriptor_count = ["result", "privateProperties", "internalProperties"]
        .into_iter()
        .filter_map(|key| response.get(key).and_then(Value::as_array))
        .try_fold(0usize, |count, values| count.checked_add(values.len()))
        .ok_or_else(|| "Debug completion descriptor count overflowed.".to_string())?;
    ensure_deadline(deadline)?;
    charge_descriptors(shared, pause_generation, frame_id, descriptor_count)?;
    let mut incomplete = descriptor_count > MAX_CDP_PROPERTY_DESCRIPTORS;
    let mut bounded = Vec::with_capacity(properties.len().min(MAX_CDP_PROPERTY_DESCRIPTORS));
    for property in properties.iter().take(MAX_CDP_PROPERTY_DESCRIPTORS) {
        ensure_deadline(deadline)?;
        incomplete |= !is_well_formed_completion_descriptor(property);
        bounded.push(property.clone());
    }
    Ok(PropertyBatch {
        properties: bounded,
        incomplete,
    })
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
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug completion pause owner changed.".into());
    }
    if pause.completion_requests >= MAX_COMPLETION_REQUESTS_PER_PAUSE {
        return Err("Debug completion request quota was exhausted for this pause.".into());
    }
    pause.completion_requests += 1;
    Ok(())
}

fn charge_descriptors(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    count: usize,
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug completion pause owner changed.".into());
    }
    let next = pause
        .completion_descriptors
        .checked_add(count)
        .ok_or_else(|| "Debug completion descriptor quota overflowed.".to_string())?;
    if next > MAX_COMPLETION_DESCRIPTORS_PER_PAUSE {
        pause.completion_descriptors = MAX_COMPLETION_DESCRIPTORS_PER_PAUSE;
        return Err("Debug completion descriptor quota was exhausted for this pause.".into());
    }
    pause.completion_descriptors = next;
    Ok(())
}

fn ensure_deadline(deadline: Instant) -> Result<(), String> {
    (Instant::now() < deadline)
        .then_some(())
        .ok_or_else(|| "Debug completion deadline expired.".to_string())
}

fn serialized_size(
    items: &[DebugCompletionItem],
    is_incomplete: bool,
    deadline: Instant,
) -> Result<usize, String> {
    ensure_deadline(deadline)?;
    let encoded = serde_json::to_vec(&DebugCompletionResult {
        items: items.to_vec(),
        is_incomplete,
    })
    .map_err(|_| "Unable to encode the debug completion response.".to_string())?;
    ensure_deadline(deadline)?;
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
    fn response_cap_accounts_for_utf8_and_shape() {
        let item = DebugCompletionItem {
            label: "é".repeat(512),
            kind: DebugCompletionItemKind::Property,
        };
        let items = vec![item; MAX_COMPLETION_ITEMS];
        assert!(
            serialized_size(&items, true, Instant::now() + Duration::from_secs(1)).expect("size")
                > MAX_COMPLETION_RESPONSE_BYTES
        );
    }

    #[test]
    fn response_work_rejects_an_expired_end_to_end_deadline() {
        assert!(serialized_size(&[], false, Instant::now() - Duration::from_millis(1)).is_err());
    }
}
