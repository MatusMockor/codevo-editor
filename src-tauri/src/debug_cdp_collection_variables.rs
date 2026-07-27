//! Projects bounded collection entries alongside ordinary own property descriptors.

use super::{
    descriptor_snapshot_policy::is_canonical_array_index, owner_is_current, CdpClient, CdpShared,
    DebugVariablePageRequest, ObjectReference, ObjectReferenceAccess,
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

pub(super) fn remote_object_access(remote: &Value) -> ObjectReferenceAccess {
    match remote.get("subtype").and_then(Value::as_str) {
        Some("map" | "set" | "weakmap" | "weakset") => ObjectReferenceAccess::Collection,
        _ => ObjectReferenceAccess::Object,
    }
}

pub(super) fn acquire_descriptor_sources(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
) -> Result<DescriptorAcquisition, String> {
    let result = request_properties(client, &parent.object_id)?;
    if !owner_is_current(shared, request)? {
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
    if entry_count > MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION {
        return Ok(degraded_acquisition(
            ordinary,
            DebugVariablePageLimitReason::DescriptorCount,
        ));
    }
    if !try_reserve_variable_page_load(shared, request)? {
        return Ok(degraded_acquisition(
            ordinary,
            DebugVariablePageLimitReason::AcquisitionCount,
        ));
    }
    let entries = request_properties(client, entries_object_id)?;
    if !owner_is_current(shared, request)? {
        return Err(
            "The debug collection pause owner changed while acquiring entries.".to_string(),
        );
    }
    let entries = collection_descriptor_sources(&entries)?;
    Ok(merge_descriptor_sources(ordinary, entries))
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

pub(super) fn reserve_variable_page_load(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<(), String> {
    if !try_reserve_variable_page_load(shared, request)? {
        return Err("The debug variable acquisition limit was reached for this pause.".to_string());
    }
    Ok(())
}

fn try_reserve_variable_page_load(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<bool, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
    {
        return Err("The debug pause owner changed while acquiring variables.".to_string());
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

fn collection_descriptor_sources(result: &Value) -> Result<DescriptorAcquisition, String> {
    let properties = result
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "Runtime.getProperties returned no collection descriptor array.".to_string()
        })?;
    let mut available_entries = 0usize;
    let mut expected_entries = None;
    let mut exceeded_entry_cap = false;
    let mut sources = Vec::new();
    for (position, property) in properties
        .iter()
        .take(MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION.saturating_add(2))
        .enumerate()
    {
        let name = property.get("name").and_then(Value::as_str).unwrap_or("");
        if name == "length" {
            let length = property
                .get("value")
                .and_then(|remote| remote.get("value"))
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    "Runtime.getProperties returned an invalid collection descriptor.".to_string()
                })?;
            if position.saturating_add(1) != properties.len() || length != available_entries as u64
            {
                return Err(
                    "Runtime.getProperties returned an invalid collection descriptor.".to_string(),
                );
            }
            expected_entries = Some(length);
            break;
        }
        if !is_canonical_array_index(name) || name != available_entries.to_string() {
            return Err(
                "Runtime.getProperties returned an invalid collection descriptor.".to_string(),
            );
        }
        available_entries = available_entries.saturating_add(1);
        if sources.len() >= MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION {
            exceeded_entry_cap = true;
            break;
        }
        sources.push(DescriptorSource {
            property: property.clone(),
            private: false,
            indexed: false,
        });
    }
    let complete = expected_entries
        .and_then(|count| usize::try_from(count).ok())
        .is_some_and(|count| count == available_entries)
        && !exceeded_entry_cap;
    if !complete && !exceeded_entry_cap {
        return Err("Runtime.getProperties returned an invalid collection descriptor.".to_string());
    }
    Ok(DescriptorAcquisition {
        sources,
        limit_reason: (!complete).then_some(DebugVariablePageLimitReason::DescriptorCount),
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

            let error = collection_descriptor_sources(&json!({"result": properties}))
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
        let entries = collection_descriptor_sources(&json!({
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
        }))
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

        reserve_variable_page_load(&shared, request).expect("first CDP request");
        reserve_variable_page_load(&shared, request).expect("second CDP request");

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

        assert!(
            !try_reserve_variable_page_load(&shared, request).expect("current owner remains valid")
        );
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
}
