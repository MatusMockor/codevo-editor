use super::{LanguageServerLocation, LanguageServerRange};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_REFERENCE_LOCATIONS: usize = 2_000;
pub const MAX_INSPECTED_REFERENCE_LOCATIONS: usize = 4_000;
pub const MAX_REFERENCE_LOCATION_URI_BYTES: usize = 16 * 1_024;
pub const MAX_REFERENCE_LOCATION_URI_TOTAL_BYTES: usize = 2 * 1_024 * 1_024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedLanguageServerLocations {
    pub locations: Vec<LanguageServerLocation>,
    pub total_count: usize,
    pub is_incomplete: bool,
}

pub fn parse_definition_result(value: &Value) -> Result<Vec<LanguageServerLocation>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    if let Some(items) = value.as_array() {
        return items.iter().map(parse_definition_item).collect();
    }

    parse_definition_item(value).map(|location| vec![location])
}

pub fn parse_bounded_reference_locations_result(
    value: &Value,
) -> Result<BoundedLanguageServerLocations, String> {
    if value.is_null() {
        return Ok(BoundedLanguageServerLocations {
            locations: Vec::new(),
            total_count: 0,
            is_incomplete: false,
        });
    }

    let (items, total_count): (&[Value], usize) = if let Some(items) = value.as_array() {
        (items, items.len())
    } else {
        (std::slice::from_ref(value), 1)
    };
    let inspected_count = items.len().min(MAX_INSPECTED_REFERENCE_LOCATIONS);
    let mut locations = Vec::with_capacity(inspected_count.min(MAX_REFERENCE_LOCATIONS));
    let mut retained_uri_bytes = 0usize;

    for item in items.iter().take(inspected_count) {
        if locations.len() >= MAX_REFERENCE_LOCATIONS {
            break;
        }

        let raw_uri_bytes = item
            .get("uri")
            .or_else(|| item.get("targetUri"))
            .and_then(Value::as_str)
            .map(str::len);
        if raw_uri_bytes.is_some_and(|uri_bytes| {
            uri_bytes > MAX_REFERENCE_LOCATION_URI_BYTES
                || retained_uri_bytes.saturating_add(uri_bytes)
                    > MAX_REFERENCE_LOCATION_URI_TOTAL_BYTES
        }) {
            continue;
        }

        let location = parse_definition_item(item)?;
        let uri_bytes = location.uri.len();
        if uri_bytes > MAX_REFERENCE_LOCATION_URI_BYTES
            || retained_uri_bytes.saturating_add(uri_bytes) > MAX_REFERENCE_LOCATION_URI_TOTAL_BYTES
        {
            continue;
        }

        retained_uri_bytes += uri_bytes;
        locations.push(location);
    }

    Ok(BoundedLanguageServerLocations {
        is_incomplete: locations.len() != total_count,
        locations,
        total_count,
    })
}

fn parse_definition_item(value: &Value) -> Result<LanguageServerLocation, String> {
    if value.get("uri").is_some() {
        return serde_json::from_value::<LanguageServerLocation>(value.clone())
            .map_err(|error| format!("Language server returned a malformed location: {error}"));
    }

    if value.get("targetUri").is_some() {
        let link = serde_json::from_value::<LanguageServerLocationLink>(value.clone()).map_err(
            |error| format!("Language server returned a malformed location link: {error}"),
        )?;

        return Ok(LanguageServerLocation {
            uri: link.target_uri,
            range: link.target_range,
        });
    }

    Err("Language server returned a malformed definition response.".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanguageServerLocationLink {
    target_uri: String,
    target_range: LanguageServerRange,
}
