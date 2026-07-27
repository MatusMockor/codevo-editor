use super::{CachedPropertyDescriptor, MAX_CDP_OBJECT_ID_BYTES};
use serde_json::Value;

pub(super) fn is_canonical_array_index(name: &str) -> bool {
    if name.is_empty() || (name.len() > 1 && name.starts_with('0')) {
        return false;
    }
    name.parse::<u32>()
        .is_ok_and(|index| index != u32::MAX && index.to_string() == name)
}

pub(super) fn retained_descriptor_prefix_search(
    descriptors: &[CachedPropertyDescriptor],
    byte_limit: usize,
) -> (usize, usize) {
    let mut lower = 0usize;
    let mut upper = descriptors.len();
    let mut probes = 0usize;
    while lower < upper {
        probes += 1;
        let middle = lower + (upper - lower).div_ceil(2);
        if descriptors[middle - 1].prefix_bytes <= byte_limit {
            lower = middle;
        } else {
            upper = middle - 1;
        }
    }
    (lower, probes)
}

pub(super) fn validate_property_descriptor(property: &Value) -> Result<(), String> {
    let descriptor = property
        .as_object()
        .ok_or_else(|| "Runtime.getProperties returned a non-object descriptor.".to_string())?;
    if !descriptor.get("name").is_some_and(Value::is_string) {
        return Err(
            "Runtime.getProperties returned a descriptor without a string name.".to_string(),
        );
    }
    for field in ["value", "get", "set", "symbol"] {
        let Some(remote) = descriptor.get(field) else {
            continue;
        };
        let remote = remote.as_object().ok_or_else(|| {
            format!("Runtime.getProperties returned a malformed {field} remote object.")
        })?;
        if !remote
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|value_type| {
                matches!(
                    value_type,
                    "object"
                        | "function"
                        | "undefined"
                        | "string"
                        | "number"
                        | "boolean"
                        | "symbol"
                        | "bigint"
                )
            })
        {
            return Err(format!(
                "Runtime.getProperties returned a {field} remote object without a type."
            ));
        }
        if remote.get("objectId").is_some_and(|object_id| {
            !object_id.as_str().is_some_and(|object_id| {
                !object_id.is_empty() && object_id.len() <= MAX_CDP_OBJECT_ID_BYTES
            })
        }) {
            return Err(format!(
                "Runtime.getProperties returned a {field} remote object with an invalid objectId."
            ));
        }
    }
    Ok(())
}
