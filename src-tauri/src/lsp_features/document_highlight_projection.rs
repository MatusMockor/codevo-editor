use super::{LanguageServerDocumentHighlight, LanguageServerPosition, LanguageServerRange};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

pub(super) const MAX_DOCUMENT_HIGHLIGHT_RESULTS: usize = 2_000;
pub(super) const MAX_DOCUMENT_HIGHLIGHT_RESPONSE_UTF8_BYTES: usize = 256 * 1024;
const MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES: usize = 512;
const DOCUMENT_HIGHLIGHT_RESPONSE_ENVELOPE_UTF8_BYTES: usize = 2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct DocumentHighlightProjectionWork {
    pub(super) input_items: usize,
    pub(super) visited_items: usize,
    pub(super) projected_items: usize,
    pub(super) measured_utf8_bytes: usize,
    pub(super) projected_utf8_bytes: usize,
}

pub(super) fn project_document_highlights_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    project_document_highlights_result_with_work(value).0
}

pub(super) fn project_document_highlights_result_with_work(
    value: &Value,
) -> (
    Result<Vec<LanguageServerDocumentHighlight>, String>,
    DocumentHighlightProjectionWork,
) {
    if value.is_null() {
        return (Ok(Vec::new()), DocumentHighlightProjectionWork::default());
    }

    let Some(items) = value.as_array() else {
        return (
            Err("Language server returned malformed document highlights.".to_string()),
            DocumentHighlightProjectionWork::default(),
        );
    };
    let mut work = DocumentHighlightProjectionWork {
        input_items: items.len(),
        ..DocumentHighlightProjectionWork::default()
    };
    if items.len() > MAX_DOCUMENT_HIGHLIGHT_RESULTS {
        return (
            Err(format!(
                "Language server returned too many document highlights (maximum {MAX_DOCUMENT_HIGHLIGHT_RESULTS})."
            )),
            work,
        );
    }

    let mut raw_response_bytes = DOCUMENT_HIGHLIGHT_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut projected_response_bytes = DOCUMENT_HIGHLIGHT_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut projected = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        work.visited_items += 1;
        let separator_bytes = usize::from(index > 0);
        let remaining_raw_bytes = MAX_DOCUMENT_HIGHLIGHT_RESPONSE_UTF8_BYTES
            .saturating_sub(raw_response_bytes)
            .saturating_sub(separator_bytes);
        let raw_measurement_cap = remaining_raw_bytes.min(MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES);
        let (item_bytes, raw_oversized) = serialized_len_capped(item, raw_measurement_cap);
        work.measured_utf8_bytes = work.measured_utf8_bytes.saturating_add(item_bytes);
        if raw_oversized {
            return (
                Err(format!(
                    "Language server returned oversized document highlight {index}."
                )),
                work,
            );
        }
        raw_response_bytes += separator_bytes + item_bytes;

        let highlight = match parse_document_highlight(item) {
            Ok(highlight) => highlight,
            Err(reason) => {
                return (
                    Err(format!(
                        "Language server returned malformed document highlight {index}: {reason}."
                    )),
                    work,
                );
            }
        };

        let remaining_projected_bytes = MAX_DOCUMENT_HIGHLIGHT_RESPONSE_UTF8_BYTES
            .saturating_sub(projected_response_bytes)
            .saturating_sub(separator_bytes);
        let projection_measurement_cap =
            remaining_projected_bytes.min(MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES);
        let (projected_bytes, projection_oversized) =
            serialized_len_capped(&highlight, projection_measurement_cap);
        work.projected_utf8_bytes = work.projected_utf8_bytes.saturating_add(projected_bytes);
        if projection_oversized {
            return (
                Err(format!(
                    "Language server returned oversized document highlight projection {index}."
                )),
                work,
            );
        }
        projected_response_bytes += separator_bytes + projected_bytes;
        projected.push(highlight);
        work.projected_items += 1;
    }

    (Ok(projected), work)
}

fn parse_document_highlight(
    value: &Value,
) -> Result<LanguageServerDocumentHighlight, &'static str> {
    let object = value.as_object().ok_or("expected an object")?;
    let range = parse_range(object.get("range").ok_or("missing range")?)?;
    let kind = match object.get("kind") {
        None | Some(Value::Null) => None,
        Some(kind) => {
            let kind = required_u32(kind).ok_or("kind must be an unsigned 32-bit integer")?;
            if !(1..=3).contains(&kind) {
                return Err("kind must be 1, 2, or 3");
            }
            Some(kind)
        }
    };
    Ok(LanguageServerDocumentHighlight { kind, range })
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
        line: required_u32(object.get("line").ok_or("position is missing line")?)
            .ok_or("line must be an unsigned 32-bit integer")?,
        character: required_u32(
            object
                .get("character")
                .ok_or("position is missing character")?,
        )
        .ok_or("character must be an unsigned 32-bit integer")?,
    })
}

fn required_u32(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|value| u32::try_from(value).ok())
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
        let response = Value::Array(vec![highlight(0); 100_000]);

        let (result, work) = project_document_highlights_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_items, 100_000);
        assert_eq!(work.visited_items, 0);
        assert_eq!(work.projected_items, 0);
        assert_eq!(work.measured_utf8_bytes, 0);
    }

    #[test]
    fn exact_result_count_boundary_is_accepted_and_overflow_fails_closed() {
        let exact = Value::Array(
            (0..MAX_DOCUMENT_HIGHLIGHT_RESULTS)
                .map(|index| highlight(index as u32))
                .collect(),
        );
        let overflow = Value::Array(vec![highlight(0); MAX_DOCUMENT_HIGHLIGHT_RESULTS + 1]);

        let (exact_result, exact_work) = project_document_highlights_result_with_work(&exact);
        let (overflow_result, overflow_work) =
            project_document_highlights_result_with_work(&overflow);

        assert_eq!(
            exact_result.expect("exact maximum").len(),
            MAX_DOCUMENT_HIGHLIGHT_RESULTS
        );
        assert_eq!(exact_work.visited_items, MAX_DOCUMENT_HIGHLIGHT_RESULTS);
        assert_eq!(exact_work.projected_items, MAX_DOCUMENT_HIGHLIGHT_RESULTS);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.visited_items, 0);
    }

    #[test]
    fn oversized_utf8_extension_fails_before_typed_projection() {
        let oversized = "😀".repeat(MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES / 4 + 1);
        let response = json!([
            highlight(0),
            {
                "range": range(1),
                "kind": 2,
                "extension": oversized
            },
            highlight(2)
        ]);

        let (result, work) = project_document_highlights_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.visited_items, 2);
        assert_eq!(work.projected_items, 1);
        assert!(work.measured_utf8_bytes > MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES);
    }

    #[test]
    fn huge_unknown_nested_field_short_circuits_raw_measurement() {
        let response = json!([
            {
                "a": vec![Value::Null; 100_000],
                "range": range(0),
                "kind": 2
            }
        ]);

        let (result, work) = project_document_highlights_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.visited_items, 1);
        assert_eq!(work.projected_items, 0);
        assert_eq!(
            work.measured_utf8_bytes,
            MAX_DOCUMENT_HIGHLIGHT_ITEM_UTF8_BYTES + 1
        );
        assert_eq!(work.projected_utf8_bytes, 0);
    }

    #[test]
    fn malformed_fields_and_unsupported_kinds_fail_the_whole_response() {
        for malformed in [
            json!({ "range": range(0), "kind": 4 }),
            json!({ "range": range(0), "kind": "read" }),
            json!({ "range": range(0), "kind": 1.5 }),
            json!({ "range": range(0), "kind": u64::from(u32::MAX) + 1 }),
            json!({
                "range": {
                    "start": { "line": -1, "character": 0 },
                    "end": { "line": 0, "character": 1 }
                }
            }),
            json!({ "range": { "start": { "line": 0, "character": 0 } } }),
            json!({
                "range": {
                    "start": { "line": 2, "character": 0 },
                    "end": { "line": 1, "character": 9 }
                }
            }),
        ] {
            let response = json!([highlight(0), malformed, highlight(2)]);
            let (result, work) = project_document_highlights_result_with_work(&response);
            assert!(result.is_err());
            assert_eq!(work.visited_items, 2);
            assert_eq!(work.projected_items, 1);
        }

        let accepted = json!([
            { "range": range(0), "kind": null },
            { "range": range(1) }
        ]);
        let highlights =
            project_document_highlights_result(&accepted).expect("nullable and missing kinds");
        assert_eq!(highlights.len(), 2);
        assert_eq!(highlights[0].kind, None);
        assert_eq!(highlights[1].kind, None);
    }

    #[test]
    fn small_and_large_work_counters_are_linear_and_bounded() {
        let small = Value::Array((0..8).map(highlight).collect());
        let large = Value::Array(
            (0..MAX_DOCUMENT_HIGHLIGHT_RESULTS)
                .map(|index| highlight(index as u32))
                .collect(),
        );

        let (small_result, small_work) = project_document_highlights_result_with_work(&small);
        let (large_result, large_work) = project_document_highlights_result_with_work(&large);

        assert_eq!(small_result.expect("small").len(), 8);
        assert_eq!(small_work.visited_items, 8);
        assert_eq!(
            large_result.expect("large").len(),
            MAX_DOCUMENT_HIGHLIGHT_RESULTS
        );
        assert_eq!(large_work.visited_items, MAX_DOCUMENT_HIGHLIGHT_RESULTS);
        assert!(
            large_work.projected_utf8_bytes
                + DOCUMENT_HIGHLIGHT_RESPONSE_ENVELOPE_UTF8_BYTES
                + MAX_DOCUMENT_HIGHLIGHT_RESULTS.saturating_sub(1)
                <= MAX_DOCUMENT_HIGHLIGHT_RESPONSE_UTF8_BYTES
        );
    }

    #[test]
    fn aggregate_response_budget_fails_at_a_deterministic_prefix() {
        let response = Value::Array(
            (0..MAX_DOCUMENT_HIGHLIGHT_RESULTS)
                .map(|index| {
                    json!({
                        "range": range(index as u32),
                        "kind": 2,
                        "extension": "x".repeat(128)
                    })
                })
                .collect(),
        );

        let (first_result, first_work) = project_document_highlights_result_with_work(&response);
        let (second_result, second_work) = project_document_highlights_result_with_work(&response);

        assert!(first_result.is_err());
        assert!(first_work.visited_items < MAX_DOCUMENT_HIGHLIGHT_RESULTS);
        assert_eq!(first_work.projected_items + 1, first_work.visited_items);
        assert_eq!(first_work, second_work);
        assert_eq!(first_result, second_result);
    }

    fn highlight(line: u32) -> Value {
        json!({
            "range": range(line),
            "kind": 2
        })
    }

    fn range(line: u32) -> Value {
        json!({
            "start": { "line": line, "character": 0 },
            "end": { "line": line, "character": 1 }
        })
    }
}
