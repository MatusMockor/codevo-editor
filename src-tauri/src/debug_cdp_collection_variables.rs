//! Projects bounded collection entries alongside ordinary own property descriptors.

use super::{
    descriptor_snapshot_policy::is_canonical_array_index, CdpClient, CdpShared,
    DebugVariablePageRequest, ObjectReference, ObjectReferenceAccess,
    CDP_COLLECTION_ENTRY_WINDOW_FUNCTION, CDP_COLLECTION_ENTRY_WINDOW_SIZE,
    MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION, MAX_CDP_OBJECT_ID_BYTES,
    MAX_CDP_PROPERTY_DESCRIPTORS, MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE,
};
use crate::debug_adapter::DebugVariablePageLimitReason;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub(super) struct DescriptorSource {
    pub(super) property: Value,
    pub(super) private: bool,
    pub(super) indexed: bool,
}

pub(super) struct DescriptorAcquisition {
    pub(super) sources: Vec<DescriptorSource>,
    pub(super) limit_reason: Option<DebugVariablePageLimitReason>,
}

enum CollectionWindow {
    Descriptors(Value),
    Degraded(DebugVariablePageLimitReason),
}

pub(super) fn remote_object_access(remote: &Value) -> ObjectReferenceAccess {
    match remote.get("subtype").and_then(Value::as_str) {
        Some("map" | "set" | "weakmap" | "weakset") => ObjectReferenceAccess::Collection,
        _ => ObjectReferenceAccess::Object,
    }
}

pub(super) fn acquire_descriptor_sources_with_page_load(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
) -> Result<DescriptorAcquisition, String> {
    if !reserve_variable_page_load(shared, request)? {
        return Ok(DescriptorAcquisition {
            sources: Vec::new(),
            limit_reason: Some(DebugVariablePageLimitReason::AcquisitionCount),
        });
    }
    acquire_descriptor_sources(client, shared, request, parent)
}

fn acquire_descriptor_sources(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
) -> Result<DescriptorAcquisition, String> {
    let result = request_properties(client, &parent.object_id)?;
    if !collection_owner_is_current(shared, request, parent)? {
        return Err("The debug pause owner changed while acquiring variables.".to_string());
    }
    let parent_is_collection = parent.access == ObjectReferenceAccess::Collection;
    let Some((entries_object_id, entry_count)) = collection_entries(&result, parent_is_collection)?
    else {
        return regular_descriptor_sources(&result);
    };
    let ordinary = regular_descriptor_sources(&result)?;
    let Some(entry_count) = entry_count else {
        return Ok(degraded_acquisition(
            ordinary,
            DebugVariablePageLimitReason::Capability,
        ));
    };
    let retained_entry_count = entry_count.min(MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION);
    let mut entries = DescriptorAcquisition {
        sources: Vec::with_capacity(retained_entry_count),
        limit_reason: (retained_entry_count != entry_count)
            .then_some(DebugVariablePageLimitReason::DescriptorCount),
    };
    let mut start = 0usize;
    while start < retained_entry_count {
        let count = CDP_COLLECTION_ENTRY_WINDOW_SIZE.min(retained_entry_count - start);
        let window = match request_collection_window(
            client,
            shared,
            request,
            parent,
            entries_object_id,
            start,
            count,
        )? {
            CollectionWindow::Descriptors(window) => window,
            CollectionWindow::Degraded(reason) => {
                entries.limit_reason = entries.limit_reason.or(Some(reason));
                return Ok(merge_descriptor_sources(ordinary, entries));
            }
        };
        let Ok(mut window) = collection_descriptor_sources(&window, start, count) else {
            entries.limit_reason = entries
                .limit_reason
                .or(Some(DebugVariablePageLimitReason::Capability));
            return Ok(merge_descriptor_sources(ordinary, entries));
        };
        entries.sources.append(&mut window.sources);
        start = start.saturating_add(count);
    }
    Ok(merge_descriptor_sources(ordinary, entries))
}

fn request_collection_window(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
    entries_object_id: &str,
    start: usize,
    count: usize,
) -> Result<CollectionWindow, String> {
    if !try_reserve_variable_page_load(shared, request, Some(parent))? {
        return Ok(CollectionWindow::Degraded(
            DebugVariablePageLimitReason::AcquisitionCount,
        ));
    }
    let window = client.request(
        "Runtime.callFunctionOn",
        json!({
            "objectId": entries_object_id,
            "functionDeclaration": CDP_COLLECTION_ENTRY_WINDOW_FUNCTION,
            "arguments": [
                {"value": start},
                {"value": count}
            ],
            "awaitPromise": false,
            "silent": true,
            "returnByValue": false,
            "throwOnSideEffect": true,
            "generatePreview": false,
        }),
    )?;
    if !collection_owner_is_current(shared, request, parent)? {
        if let Some(object_id) = releasable_window_object_id(&window) {
            release_collection_window(client, object_id);
        }
        return Err(
            "The debug collection pause owner changed while acquiring entries.".to_string(),
        );
    }
    let Some(window_object_id) = collection_window_object_id(&window) else {
        if let Some(object_id) = releasable_window_object_id(&window) {
            release_collection_window(client, object_id);
        }
        return Ok(CollectionWindow::Degraded(
            DebugVariablePageLimitReason::Capability,
        ));
    };
    if !try_reserve_variable_page_load(shared, request, Some(parent))? {
        release_collection_window(client, window_object_id);
        return Ok(CollectionWindow::Degraded(
            DebugVariablePageLimitReason::AcquisitionCount,
        ));
    }
    let result = request_properties(client, window_object_id);
    release_collection_window(client, window_object_id);
    let result = result?;
    if !collection_owner_is_current(shared, request, parent)? {
        return Err(
            "The debug collection pause owner changed while acquiring entries.".to_string(),
        );
    }
    Ok(CollectionWindow::Descriptors(result))
}

fn collection_window_object_id(result: &Value) -> Option<&str> {
    if result.get("exceptionDetails").is_some() {
        return None;
    }
    let remote = result.get("result")?;
    if remote.get("type").and_then(Value::as_str) != Some("object")
        || remote.get("subtype").and_then(Value::as_str) != Some("array")
    {
        return None;
    }
    let object_id = remote.get("objectId").and_then(Value::as_str)?;
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return None;
    }
    Some(object_id)
}

fn releasable_window_object_id(result: &Value) -> Option<&str> {
    let object_id = result.pointer("/result/objectId").and_then(Value::as_str)?;
    (!object_id.is_empty() && object_id.len() <= MAX_CDP_OBJECT_ID_BYTES).then_some(object_id)
}

fn release_collection_window(client: &CdpClient, object_id: &str) {
    let _ = client.request("Runtime.releaseObject", json!({"objectId": object_id}));
}

fn collection_owner_is_current(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
) -> Result<bool, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    Ok(state.pause.as_ref().is_some_and(|pause| {
        pause.pause_generation == request.pause_generation
            && pause.call_frame_ids.contains_key(&request.frame_id)
            && pause
                .object_ids
                .get(&request.variables_reference)
                .is_some_and(|owned| owned == parent)
    }))
}

fn degraded_acquisition(
    acquisition: DescriptorAcquisition,
    reason: DebugVariablePageLimitReason,
) -> DescriptorAcquisition {
    DescriptorAcquisition {
        sources: acquisition.sources,
        limit_reason: acquisition.limit_reason.or(Some(reason)),
    }
}

fn request_properties(client: &CdpClient, object_id: &str) -> Result<Value, String> {
    client.request(
        "Runtime.getProperties",
        json!({
            "objectId": object_id,
            "ownProperties": true,
            "generatePreview": false,
        }),
    )
}

fn reserve_variable_page_load(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<bool, String> {
    try_reserve_variable_page_load(shared, request, None)
}

fn try_reserve_variable_page_load(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    exact_parent: Option<&ObjectReference>,
) -> Result<bool, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
        || exact_parent.is_some_and(|parent| {
            !pause
                .object_ids
                .get(&request.variables_reference)
                .is_some_and(|owned| owned == parent)
        })
    {
        return Err(match exact_parent {
            Some(_) => {
                "The debug collection pause owner changed while acquiring entries.".to_string()
            }
            None => "The debug pause owner changed while acquiring variables.".to_string(),
        });
    }
    if pause.variable_page_loads >= MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE {
        return Ok(false);
    }
    pause.variable_page_loads += 1;
    Ok(true)
}

fn collection_entries(
    result: &Value,
    parent_is_collection: bool,
) -> Result<Option<(&str, Option<usize>)>, String> {
    let Some(internal_properties) = result.get("internalProperties") else {
        if parent_is_collection {
            return Ok(Some(("", None)));
        }
        return Ok(None);
    };
    let internal_properties = internal_properties.as_array().ok_or_else(|| {
        "Runtime.getProperties returned invalid internal descriptors.".to_string()
    })?;
    let mut entries = internal_properties
        .iter()
        .filter(|property| property.get("name").and_then(Value::as_str) == Some("[[Entries]]"));
    let Some(entries_property) = entries.next() else {
        if parent_is_collection {
            return Ok(Some(("", None)));
        }
        return Ok(None);
    };
    if entries.next().is_some() {
        return Ok(Some(("", None)));
    }
    let Some(value) = entries_property.get("value") else {
        return Ok(Some(("", None)));
    };
    if value.get("type").and_then(Value::as_str) != Some("object")
        || value.get("subtype").and_then(Value::as_str) != Some("array")
    {
        return Ok(Some(("", None)));
    }
    let Some(object_id) = value.get("objectId").and_then(Value::as_str) else {
        return Ok(Some(("", None)));
    };
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return Ok(Some(("", None)));
    }
    let entry_count = value
        .get("description")
        .and_then(Value::as_str)
        .and_then(parse_array_description_count);
    Ok(Some((object_id, entry_count)))
}

fn parse_array_description_count(description: &str) -> Option<usize> {
    description
        .strip_prefix("Array(")?
        .strip_suffix(')')?
        .parse()
        .ok()
}

fn regular_descriptor_sources(result: &Value) -> Result<DescriptorAcquisition, String> {
    let properties = result
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "Runtime.getProperties returned no descriptor array.".to_string())?;
    let private_properties = match result.get("privateProperties") {
        None => &[][..],
        Some(value) => value.as_array().ok_or_else(|| {
            "Runtime.getProperties returned invalid private descriptors.".to_string()
        })?,
    };
    let available = properties.len().saturating_add(private_properties.len());
    let sources = properties
        .iter()
        .map(|property| (property, false))
        .chain(private_properties.iter().map(|property| (property, true)))
        .take(MAX_CDP_PROPERTY_DESCRIPTORS)
        .map(|(property, private)| DescriptorSource {
            property: property.clone(),
            private,
            indexed: property
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(is_canonical_array_index),
        })
        .collect::<Vec<_>>();
    Ok(DescriptorAcquisition {
        limit_reason: (sources.len() != available)
            .then_some(DebugVariablePageLimitReason::DescriptorCount),
        sources,
    })
}

fn collection_descriptor_sources(
    result: &Value,
    start: usize,
    count: usize,
) -> Result<DescriptorAcquisition, String> {
    let properties = result
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "Runtime.getProperties returned no collection descriptor array.".to_string()
        })?;
    if properties.len() != count.saturating_add(1) {
        return Err("Runtime.getProperties returned an invalid collection descriptor.".to_string());
    }
    let mut sources = Vec::with_capacity(count);
    for (position, property) in properties.iter().enumerate() {
        let name = property.get("name").and_then(Value::as_str).unwrap_or("");
        if name == "length" {
            let length = property
                .get("value")
                .and_then(|remote| remote.get("value"))
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    "Runtime.getProperties returned an invalid collection descriptor.".to_string()
                })?;
            if position != count || length != count as u64 {
                return Err(
                    "Runtime.getProperties returned an invalid collection descriptor.".to_string(),
                );
            }
            continue;
        }
        if position >= count || !is_canonical_array_index(name) || name != position.to_string() {
            return Err(
                "Runtime.getProperties returned an invalid collection descriptor.".to_string(),
            );
        }
        let mut property = property.clone();
        property["name"] = Value::String(start.saturating_add(position).to_string());
        sources.push(DescriptorSource {
            property,
            private: false,
            indexed: false,
        });
    }
    Ok(DescriptorAcquisition {
        sources,
        limit_reason: None,
    })
}

fn merge_descriptor_sources(
    mut ordinary: DescriptorAcquisition,
    mut entries: DescriptorAcquisition,
) -> DescriptorAcquisition {
    let remaining = MAX_CDP_PROPERTY_DESCRIPTORS.saturating_sub(ordinary.sources.len());
    if entries.sources.len() > remaining {
        entries.sources.truncate(remaining);
        entries.limit_reason = Some(DebugVariablePageLimitReason::DescriptorCount);
    }
    ordinary.sources.append(&mut entries.sources);
    if ordinary.limit_reason.is_none() {
        ordinary.limit_reason = entries.limit_reason;
    }
    ordinary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_cdp::transport::PauseInventory;

    fn paused_shared() -> Arc<Mutex<CdpShared>> {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 1,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(7, "frame-7".to_string());
        state.pause = Some(pause);
        Arc::new(Mutex::new(state))
    }

    #[test]
    fn collection_entries_reject_duplicate_gapped_and_out_of_order_indices() {
        for names in [vec!["0", "0"], vec!["0", "2"], vec!["1", "0"]] {
            let properties = names
                .into_iter()
                .map(|name| {
                    json!({
                        "name": name,
                        "value": {"type": "object", "objectId": name}
                    })
                })
                .chain([json!({
                    "name": "length",
                    "value": {"type": "number", "value": 2}
                })])
                .collect::<Vec<_>>();

            let error = collection_descriptor_sources(&json!({"result": properties}), 0, 2)
                .err()
                .expect("invalid collection indices must fail closed");

            assert!(error.contains("collection descriptor"));
        }
    }

    #[test]
    fn merged_collection_sources_preserve_ordinary_and_private_properties() {
        let ordinary = regular_descriptor_sources(&json!({
            "result": [{
                "name": "tag",
                "value": {"type": "string", "value": "important"}
            }],
            "privateProperties": [{
                "name": "#secret",
                "value": {"type": "number", "value": 7}
            }]
        }))
        .expect("ordinary descriptors");
        let entries = collection_descriptor_sources(
            &json!({
                "result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "objectId": "entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]
            }),
            0,
            1,
        )
        .expect("collection descriptors");

        let merged = merge_descriptor_sources(ordinary, entries);

        assert_eq!(merged.limit_reason, None);
        assert_eq!(
            merged
                .sources
                .iter()
                .map(|source| source.property["name"].as_str().unwrap_or(""))
                .collect::<Vec<_>>(),
            vec!["tag", "#secret", "0"]
        );
        assert!(merged.sources[1].private);
        assert!(!merged.sources[2].indexed);
    }

    #[test]
    fn variable_page_load_reservations_count_each_cdp_request() {
        let shared = paused_shared();
        let request = DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 7,
            variables_reference: 13,
            start: 0,
            count: 1,
        };

        assert!(reserve_variable_page_load(&shared, request).expect("first CDP request"));
        assert!(reserve_variable_page_load(&shared, request).expect("second CDP request"));

        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .variable_page_loads,
            2
        );
    }

    #[test]
    fn exhausted_collection_page_load_quota_reports_acquisition_count() {
        let shared = paused_shared();
        {
            let mut state = shared.lock().expect("state");
            state.pause.as_mut().expect("pause").variable_page_loads =
                MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE;
        }
        let request = DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 7,
            variables_reference: 13,
            start: 0,
            count: 1,
        };

        assert!(!try_reserve_variable_page_load(&shared, request, None)
            .expect("current owner remains valid"));
        let acquisition = degraded_acquisition(
            DescriptorAcquisition {
                sources: Vec::new(),
                limit_reason: None,
            },
            DebugVariablePageLimitReason::AcquisitionCount,
        );
        assert_eq!(
            acquisition.limit_reason,
            Some(DebugVariablePageLimitReason::AcquisitionCount)
        );
    }

    #[test]
    fn acquisition_exhaustion_preserves_a_more_precise_descriptor_count_reason() {
        let acquisition = degraded_acquisition(
            DescriptorAcquisition {
                sources: Vec::new(),
                limit_reason: Some(DebugVariablePageLimitReason::DescriptorCount),
            },
            DebugVariablePageLimitReason::AcquisitionCount,
        );

        assert_eq!(
            acquisition.limit_reason,
            Some(DebugVariablePageLimitReason::DescriptorCount)
        );
    }
}
