use super::{
    LanguageServerLocation, LanguageServerPosition, LanguageServerRange,
    LanguageServerWorkspaceSymbol,
};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

pub(super) const MAX_WORKSPACE_SYMBOL_RESULTS: usize = 2_000;
pub(super) const MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES: usize = 2 * 1024 * 1024;
const MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES: usize = 32 * 1024;
const MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES: usize = 1_024;
const MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES: usize = 2 * 1024;
const MAX_WORKSPACE_SYMBOL_URI_UTF8_BYTES: usize = 16 * 1024;
const WORKSPACE_SYMBOL_RESPONSE_ENVELOPE_UTF8_BYTES: usize = 2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct WorkspaceSymbolProjectionWork {
    pub(super) input_items: usize,
    pub(super) visited_items: usize,
    pub(super) projected_items: usize,
    pub(super) measured_utf8_bytes: usize,
    pub(super) projected_utf8_bytes: usize,
}

pub(super) fn project_workspace_symbols_result(
    value: &Value,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    project_workspace_symbols_result_with_work(value).0
}

pub(super) fn project_workspace_symbols_result_with_work(
    value: &Value,
) -> (
    Result<Vec<LanguageServerWorkspaceSymbol>, String>,
    WorkspaceSymbolProjectionWork,
) {
    if value.is_null() {
        return (Ok(Vec::new()), WorkspaceSymbolProjectionWork::default());
    }

    let Some(items) = value.as_array() else {
        return (
            Err("Language server returned malformed workspace symbols.".to_string()),
            WorkspaceSymbolProjectionWork::default(),
        );
    };
    let mut work = WorkspaceSymbolProjectionWork {
        input_items: items.len(),
        ..WorkspaceSymbolProjectionWork::default()
    };
    if items.len() > MAX_WORKSPACE_SYMBOL_RESULTS {
        return (
            Err(format!(
                "Language server returned too many workspace symbols (maximum {MAX_WORKSPACE_SYMBOL_RESULTS})."
            )),
            work,
        );
    }

    let mut response_bytes = WORKSPACE_SYMBOL_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut projected = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        work.visited_items += 1;
        let (item_bytes, raw_oversized) =
            serialized_len_capped(item, MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES);
        work.measured_utf8_bytes = work.measured_utf8_bytes.saturating_add(item_bytes);
        if raw_oversized {
            return (
                Err(format!(
                    "Language server returned oversized workspace symbol {index}."
                )),
                work,
            );
        }
        let symbol = match parse_workspace_symbol(item) {
            Ok(symbol) => symbol,
            Err(reason) => {
                return (
                    Err(format!(
                        "Language server returned malformed workspace symbol {index}: {reason}."
                    )),
                    work,
                );
            }
        };

        let separator_bytes = usize::from(index > 0);
        let remaining_response_bytes = MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES
            .saturating_sub(response_bytes)
            .saturating_sub(separator_bytes);
        let projection_measurement_cap =
            remaining_response_bytes.min(MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES);
        let (projected_bytes, projection_oversized) =
            serialized_len_capped(&symbol, projection_measurement_cap);
        work.projected_utf8_bytes = work.projected_utf8_bytes.saturating_add(projected_bytes);
        if projection_oversized {
            return (
                Err(format!(
                    "Language server returned oversized workspace symbol projection {index}."
                )),
                work,
            );
        }
        response_bytes += separator_bytes + projected_bytes;
        projected.push(symbol);
        work.projected_items += 1;
    }

    (Ok(projected), work)
}

fn parse_workspace_symbol(value: &Value) -> Result<LanguageServerWorkspaceSymbol, &'static str> {
    let object = value.as_object().ok_or("expected an object")?;
    let name = bounded_required_string(
        object.get("name"),
        MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES,
        "name",
    )?;
    let kind = required_u32(object.get("kind"), "kind")?;
    if !(1..=26).contains(&kind) {
        return Err("kind must be between 1 and 26");
    }
    let container_name = bounded_optional_string(
        object.get("containerName"),
        MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES,
        "containerName",
    )?;
    let location =
        parse_workspace_symbol_location(object.get("location").ok_or("missing location")?)?;

    Ok(LanguageServerWorkspaceSymbol {
        container_name,
        kind,
        location,
        name,
    })
}

fn parse_workspace_symbol_location(
    value: &Value,
) -> Result<Option<LanguageServerLocation>, &'static str> {
    let object = value.as_object().ok_or("location must be an object")?;
    let uri = bounded_required_string(
        object.get("uri"),
        MAX_WORKSPACE_SYMBOL_URI_UTF8_BYTES,
        "location uri",
    )?;
    let Some(range) = object.get("range") else {
        return Ok(None);
    };
    Ok(Some(LanguageServerLocation {
        uri,
        range: parse_range(range)?,
    }))
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, &'static str> {
    let object = value.as_object().ok_or("range must be an object")?;
    let start = parse_position(object.get("start").ok_or("range is missing start")?)?;
    let end = parse_position(object.get("end").ok_or("range is missing end")?)?;
    if (end.line, end.character) < (start.line, start.character) {
        return Err("range end must not precede range start");
    }
    Ok(LanguageServerRange { start, end })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, &'static str> {
    let object = value.as_object().ok_or("position must be an object")?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line"), "line")?,
        character: required_u32(object.get("character"), "character")?,
    })
}

fn required_u32(value: Option<&Value>, field: &'static str) -> Result<u32, &'static str> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(field)
}

fn bounded_required_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &'static str,
) -> Result<String, &'static str> {
    let value = value.and_then(Value::as_str).ok_or(field)?;
    if value.len() > maximum_bytes {
        return Err(field);
    }
    Ok(value.to_string())
}

fn bounded_optional_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &'static str,
) -> Result<Option<String>, &'static str> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_required_string(Some(value), maximum_bytes, field).map(Some),
    }
}

fn serialized_len_capped(value: &impl Serialize, maximum_bytes: usize) -> (usize, bool) {
    let mut counter = ByteCounter {
        bytes: 0,
        maximum_bytes,
    };
    let oversized = serde_json::to_writer(&mut counter, value).is_err();
    (counter.bytes, oversized)
}

struct ByteCounter {
    bytes: usize,
    maximum_bytes: usize,
}

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next_bytes = self.bytes.saturating_add(bytes.len());
        if next_bytes > self.maximum_bytes {
            self.bytes = self.maximum_bytes.saturating_add(1);
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "serialized value exceeds projection limit",
            ));
        }
        self.bytes = next_bytes;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn adversarial_hundred_thousand_results_fail_before_item_work() {
        let response = Value::Array(vec![symbol(0); 100_000]);

        let (result, work) = project_workspace_symbols_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_items, 100_000);
        assert_eq!(work.visited_items, 0);
        assert_eq!(work.projected_items, 0);
        assert_eq!(work.measured_utf8_bytes, 0);
    }

    #[test]
    fn exact_result_count_boundary_is_accepted_and_overflow_fails_closed() {
        let exact = Value::Array(
            (0..MAX_WORKSPACE_SYMBOL_RESULTS)
                .map(|index| symbol(index as u32))
                .collect(),
        );
        let overflow = Value::Array(vec![symbol(0); MAX_WORKSPACE_SYMBOL_RESULTS + 1]);

        let (exact_result, exact_work) = project_workspace_symbols_result_with_work(&exact);
        let (overflow_result, overflow_work) =
            project_workspace_symbols_result_with_work(&overflow);

        assert_eq!(
            exact_result.expect("exact maximum").len(),
            MAX_WORKSPACE_SYMBOL_RESULTS
        );
        assert_eq!(exact_work.visited_items, MAX_WORKSPACE_SYMBOL_RESULTS);
        assert_eq!(exact_work.projected_items, MAX_WORKSPACE_SYMBOL_RESULTS);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.visited_items, 0);
    }

    #[test]
    fn oversized_utf8_fields_fail_before_typed_projection() {
        let cases = [
            json!({
                "name": "😀".repeat(MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES / 4 + 1),
                "kind": 5,
                "location": location(1)
            }),
            json!({
                "name": "oversized-container",
                "containerName":
                    "😀".repeat(MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES / 4 + 1),
                "kind": 5,
                "location": location(1)
            }),
            json!({
                "name": "oversized-uri",
                "kind": 5,
                "location": {
                    "uri": "😀".repeat(MAX_WORKSPACE_SYMBOL_URI_UTF8_BYTES / 4 + 1),
                    "range": range(1)
                }
            }),
        ];

        for oversized in cases {
            let response = json!([symbol(0), oversized, symbol(2)]);
            let (result, work) = project_workspace_symbols_result_with_work(&response);
            assert!(result.is_err());
            assert_eq!(work.visited_items, 2);
            assert_eq!(work.projected_items, 1);
        }
    }

    #[test]
    fn aggregate_response_budget_fails_at_a_deterministic_prefix() {
        let response = Value::Array(
            (0..MAX_WORKSPACE_SYMBOL_RESULTS)
                .map(|index| {
                    json!({
                        "name": "x".repeat(MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES),
                        "containerName":
                            "y".repeat(MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES),
                        "kind": 5,
                        "location": location(index as u32)
                    })
                })
                .collect(),
        );

        let (first_result, first_work) = project_workspace_symbols_result_with_work(&response);
        let (second_result, second_work) = project_workspace_symbols_result_with_work(&response);

        assert!(first_result.is_err());
        assert!(first_work.visited_items < MAX_WORKSPACE_SYMBOL_RESULTS);
        assert_eq!(first_work.projected_items + 1, first_work.visited_items);
        assert_eq!(first_work, second_work);
        assert_eq!(first_result, second_result);
    }

    #[test]
    fn published_wire_budget_accounts_for_projected_null_fields() {
        let overflowing = Value::Array(
            (0..MAX_WORKSPACE_SYMBOL_RESULTS)
                .map(|index| {
                    json!({
                        "name": "x".repeat(900),
                        "kind": 5,
                        "location": location(index as u32)
                    })
                })
                .collect(),
        );
        let accepted = Value::Array(
            (0..MAX_WORKSPACE_SYMBOL_RESULTS)
                .map(|index| {
                    json!({
                        "name": "x".repeat(850),
                        "kind": 5,
                        "location": location(index as u32)
                    })
                })
                .collect(),
        );

        let (overflow_result, overflow_work) =
            project_workspace_symbols_result_with_work(&overflowing);
        let projected = project_workspace_symbols_result(&accepted).expect("bounded wire result");
        let wire_bytes = serde_json::to_vec(&projected)
            .expect("serialize projected symbols")
            .len();

        assert!(overflow_result.is_err());
        assert!(overflow_work.projected_items < MAX_WORKSPACE_SYMBOL_RESULTS);
        assert!(wire_bytes <= MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES);
    }

    #[test]
    fn huge_unknown_nested_field_short_circuits_raw_measurement() {
        let response = json!([
            {
                "a": vec![Value::Null; 100_000],
                "name": "Nested",
                "kind": 5,
                "location": location(0)
            }
        ]);

        let (result, work) = project_workspace_symbols_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.visited_items, 1);
        assert_eq!(work.projected_items, 0);
        assert_eq!(
            work.measured_utf8_bytes,
            MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES + 1
        );
        assert_eq!(work.projected_utf8_bytes, 0);
    }

    #[test]
    fn malformed_fields_fail_the_whole_response() {
        for malformed in [
            json!({ "kind": 5, "location": location(1) }),
            json!({ "name": "Bad", "kind": 0, "location": location(1) }),
            json!({ "name": "Bad", "kind": 27, "location": location(1) }),
            json!({ "name": "Bad", "kind": 1.5, "location": location(1) }),
            json!({
                "name": "Bad",
                "kind": u64::from(u32::MAX) + 1,
                "location": location(1)
            }),
            json!({ "name": "Bad", "kind": 5 }),
            json!({ "name": "Bad", "kind": 5, "location": null }),
            json!({
                "name": "Bad",
                "kind": 5,
                "location": {
                    "uri": 7,
                    "range": range(1)
                }
            }),
            json!({
                "name": "Bad",
                "kind": 5,
                "location": {
                    "uri": "file:///project/bad.ts",
                    "range": {
                        "start": { "line": 2, "character": 0 },
                        "end": { "line": 1, "character": 9 }
                    }
                }
            }),
        ] {
            let response = json!([symbol(0), malformed, symbol(2)]);
            let (result, work) = project_workspace_symbols_result_with_work(&response);
            assert!(result.is_err());
            assert_eq!(work.visited_items, 2);
            assert_eq!(work.projected_items, 1);
        }
    }

    #[test]
    fn unresolved_location_and_nullable_container_remain_compatible() {
        let response = json!([
            {
                "name": "Unresolved",
                "kind": 5,
                "containerName": null,
                "location": { "uri": "file:///project/unresolved.ts" }
            }
        ]);

        let projected =
            project_workspace_symbols_result(&response).expect("unresolved workspace symbol");

        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0].name, "Unresolved");
        assert_eq!(projected[0].container_name, None);
        assert_eq!(projected[0].location, None);
    }

    #[test]
    fn small_and_large_work_counters_are_linear_and_bounded() {
        let small = Value::Array((0..8).map(symbol).collect());
        let large = Value::Array(
            (0..MAX_WORKSPACE_SYMBOL_RESULTS)
                .map(|index| symbol(index as u32))
                .collect(),
        );

        let (small_result, small_work) = project_workspace_symbols_result_with_work(&small);
        let (large_result, large_work) = project_workspace_symbols_result_with_work(&large);

        assert_eq!(small_result.expect("small").len(), 8);
        assert_eq!(small_work.visited_items, 8);
        assert_eq!(
            large_result.expect("large").len(),
            MAX_WORKSPACE_SYMBOL_RESULTS
        );
        assert_eq!(large_work.visited_items, MAX_WORKSPACE_SYMBOL_RESULTS);
        assert!(
            large_work.projected_utf8_bytes
                + WORKSPACE_SYMBOL_RESPONSE_ENVELOPE_UTF8_BYTES
                + MAX_WORKSPACE_SYMBOL_RESULTS.saturating_sub(1)
                <= MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES
        );
    }

    fn symbol(line: u32) -> Value {
        json!({
            "name": format!("Symbol{line}"),
            "kind": 5,
            "containerName": "App",
            "location": location(line)
        })
    }

    fn location(line: u32) -> Value {
        json!({
            "uri": format!("file:///project/symbol-{line}.ts"),
            "range": range(line)
        })
    }

    fn range(line: u32) -> Value {
        json!({
            "start": { "line": line, "character": 0 },
            "end": { "line": line, "character": 1 }
        })
    }
}
