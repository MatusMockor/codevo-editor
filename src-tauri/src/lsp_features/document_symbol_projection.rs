use super::{LanguageServerDocumentSymbol, LanguageServerPosition, LanguageServerRange};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

pub(super) const MAX_DOCUMENT_SYMBOL_NODES: usize = 2_000;
pub(super) const MAX_DOCUMENT_SYMBOL_DEPTH: usize = 32;
pub(super) const MAX_DOCUMENT_SYMBOL_ROOTS: usize = 2_000;
const MAX_DOCUMENT_SYMBOL_CHILDREN: usize = 512;
const MAX_DOCUMENT_SYMBOL_RESPONSE_UTF8_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCUMENT_SYMBOL_ITEM_UTF8_BYTES: usize = 64 * 1024;
const MAX_DOCUMENT_SYMBOL_STRING_AGGREGATE_UTF8_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCUMENT_SYMBOL_NAME_UTF8_BYTES: usize = 1024;
const MAX_DOCUMENT_SYMBOL_DETAIL_UTF8_BYTES: usize = 4 * 1024;
const MAX_DOCUMENT_SYMBOL_CONTAINER_UTF8_BYTES: usize = 4 * 1024;
const MAX_DOCUMENT_SYMBOL_URI_UTF8_BYTES: usize = 16 * 1024;
const MAX_DOCUMENT_SYMBOL_TAGS: usize = 16;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct DocumentSymbolProjectionWork {
    pub(super) input_roots: usize,
    pub(super) visited_nodes: usize,
    pub(super) projected_nodes: usize,
    pub(super) maximum_depth: usize,
    pub(super) string_utf8_bytes: usize,
    pub(super) projected_utf8_bytes: usize,
}

pub(super) fn project_document_symbols_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    project_document_symbols_result_with_work(value).0
}

pub(super) fn project_document_symbols_result_with_work(
    value: &Value,
) -> (
    Result<Vec<LanguageServerDocumentSymbol>, String>,
    DocumentSymbolProjectionWork,
) {
    if value.is_null() {
        return (Ok(Vec::new()), DocumentSymbolProjectionWork::default());
    }
    let Some(items) = value.as_array() else {
        return (
            Err("Language server returned malformed document symbols.".to_string()),
            DocumentSymbolProjectionWork::default(),
        );
    };
    let mut work = DocumentSymbolProjectionWork {
        input_roots: items.len(),
        ..DocumentSymbolProjectionWork::default()
    };
    if items.len() > MAX_DOCUMENT_SYMBOL_ROOTS {
        return (
            Err(format!(
                "Language server returned too many document symbol roots (maximum {MAX_DOCUMENT_SYMBOL_ROOTS})."
            )),
            work,
        );
    }

    let mut projected = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        match parse_symbol(item, 0, &mut work) {
            Ok(symbol) => projected.push(symbol),
            Err(reason) => {
                return (
                    Err(format!(
                        "Language server returned malformed document symbol root {index}: {reason}."
                    )),
                    work,
                );
            }
        }
    }
    let (bytes, oversized) =
        serialized_len_capped(&projected, MAX_DOCUMENT_SYMBOL_RESPONSE_UTF8_BYTES);
    work.projected_utf8_bytes = bytes;
    if oversized {
        return (
            Err("Language server returned oversized document symbols.".to_string()),
            work,
        );
    }
    (Ok(projected), work)
}

fn parse_symbol(
    value: &Value,
    depth: usize,
    work: &mut DocumentSymbolProjectionWork,
) -> Result<LanguageServerDocumentSymbol, String> {
    if depth > MAX_DOCUMENT_SYMBOL_DEPTH {
        return Err("symbol nesting is too deep".to_string());
    }
    work.visited_nodes = work.visited_nodes.saturating_add(1);
    work.maximum_depth = work.maximum_depth.max(depth);
    if work.visited_nodes > MAX_DOCUMENT_SYMBOL_NODES {
        return Err("symbol tree has too many nodes".to_string());
    }
    let object = value
        .as_object()
        .ok_or_else(|| "expected an object".to_string())?;
    let name = bounded_required_string(
        object.get("name"),
        MAX_DOCUMENT_SYMBOL_NAME_UTF8_BYTES,
        "name",
        work,
    )?;
    let kind = required_u32(object.get("kind"), "kind")?;
    if !(1..=26).contains(&kind) {
        return Err("kind must be between 1 and 26".to_string());
    }
    let tags = parse_tags(object.get("tags"))?;

    let symbol = match (
        object.contains_key("selectionRange"),
        object.contains_key("location"),
    ) {
        (true, false) => parse_document_symbol(object, name, kind, tags, depth, work)?,
        (false, true) => parse_symbol_information(object, name, kind, tags, work)?,
        (false, false) => return Err("expected selectionRange or location".to_string()),
        (true, true) => return Err("symbol union is ambiguous".to_string()),
    };
    let scalar = LanguageServerDocumentSymbol {
        children: Vec::new(),
        container_name: symbol.container_name.clone(),
        detail: symbol.detail.clone(),
        kind: symbol.kind,
        name: symbol.name.clone(),
        range: symbol.range.clone(),
        selection_range: symbol.selection_range.clone(),
        tags: symbol.tags.clone(),
    };
    let (_, oversized) = serialized_len_capped(&scalar, MAX_DOCUMENT_SYMBOL_ITEM_UTF8_BYTES);
    if oversized {
        return Err("symbol item is too large".to_string());
    }
    work.projected_nodes += 1;
    Ok(symbol)
}

fn parse_document_symbol(
    object: &serde_json::Map<String, Value>,
    name: String,
    kind: u32,
    tags: Vec<u32>,
    depth: usize,
    work: &mut DocumentSymbolProjectionWork,
) -> Result<LanguageServerDocumentSymbol, String> {
    let range = parse_range(
        object
            .get("range")
            .ok_or_else(|| "missing range".to_string())?,
    )?;
    let selection_range = parse_range(
        object
            .get("selectionRange")
            .ok_or_else(|| "missing selectionRange".to_string())?,
    )?;
    if !range_contains(&range, &selection_range) {
        return Err("selectionRange must be contained in range".to_string());
    }
    let detail = bounded_optional_string(
        object.get("detail"),
        MAX_DOCUMENT_SYMBOL_DETAIL_UTF8_BYTES,
        "detail",
        work,
    )?;
    let children = match object.get("children") {
        None | Some(Value::Null) => Vec::new(),
        Some(children) => {
            let children = children
                .as_array()
                .ok_or_else(|| "children must be an array".to_string())?;
            if children.len() > MAX_DOCUMENT_SYMBOL_CHILDREN {
                return Err("symbol has too many children".to_string());
            }
            let mut projected = Vec::with_capacity(children.len());
            for child in children {
                projected.push(parse_symbol(child, depth + 1, work)?);
            }
            projected
        }
    };
    Ok(LanguageServerDocumentSymbol {
        children,
        container_name: None,
        detail,
        kind,
        name,
        range,
        selection_range,
        tags,
    })
}

fn parse_symbol_information(
    object: &serde_json::Map<String, Value>,
    name: String,
    kind: u32,
    tags: Vec<u32>,
    work: &mut DocumentSymbolProjectionWork,
) -> Result<LanguageServerDocumentSymbol, String> {
    let location = object
        .get("location")
        .and_then(Value::as_object)
        .ok_or_else(|| "location must be an object".to_string())?;
    bounded_required_str(
        location.get("uri"),
        MAX_DOCUMENT_SYMBOL_URI_UTF8_BYTES,
        "location uri",
    )?;
    let range = parse_range(
        location
            .get("range")
            .ok_or_else(|| "location is missing range".to_string())?,
    )?;
    let container_name = bounded_optional_string(
        object.get("containerName"),
        MAX_DOCUMENT_SYMBOL_CONTAINER_UTF8_BYTES,
        "containerName",
        work,
    )?;
    Ok(LanguageServerDocumentSymbol {
        children: Vec::new(),
        container_name,
        detail: None,
        kind,
        name,
        range: range.clone(),
        selection_range: range,
        tags,
    })
}

fn parse_tags(value: Option<&Value>) -> Result<Vec<u32>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let tags = value
        .as_array()
        .ok_or_else(|| "tags must be an array".to_string())?;
    if tags.len() > MAX_DOCUMENT_SYMBOL_TAGS {
        return Err("too many symbol tags".to_string());
    }
    tags.iter()
        .map(
            |tag| match tag.as_u64().and_then(|tag| u32::try_from(tag).ok()) {
                Some(1) => Ok(1),
                _ => Err("unsupported symbol tag".to_string()),
            },
        )
        .collect()
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "range must be an object".to_string())?;
    let start = parse_position(
        object
            .get("start")
            .ok_or_else(|| "range is missing start".to_string())?,
    )?;
    let end = parse_position(
        object
            .get("end")
            .ok_or_else(|| "range is missing end".to_string())?,
    )?;
    if position_key(&end) < position_key(&start) {
        return Err("range end must not precede range start".to_string());
    }
    Ok(LanguageServerRange { start, end })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "position must be an object".to_string())?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line"), "line")?,
        character: required_u32(object.get("character"), "character")?,
    })
}

fn required_u32(value: Option<&Value>, field: &str) -> Result<u32, String> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("{field} must be an unsigned 32-bit integer"))
}

fn range_contains(outer: &LanguageServerRange, inner: &LanguageServerRange) -> bool {
    position_key(&outer.start) <= position_key(&inner.start)
        && position_key(&inner.end) <= position_key(&outer.end)
}

fn position_key(position: &LanguageServerPosition) -> (u32, u32) {
    (position.line, position.character)
}

fn bounded_required_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &str,
    work: &mut DocumentSymbolProjectionWork,
) -> Result<String, String> {
    let value = bounded_required_str(value, maximum_bytes, field)?;
    add_string_bytes(value.len(), work)?;
    Ok(value.to_string())
}

fn bounded_optional_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &str,
    work: &mut DocumentSymbolProjectionWork,
) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_required_string(Some(value), maximum_bytes, field, work).map(Some),
    }
}

fn bounded_required_str<'a>(
    value: Option<&'a Value>,
    maximum_bytes: usize,
    field: &str,
) -> Result<&'a str, String> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} must be a string"))?;
    if value.len() > maximum_bytes {
        return Err(format!("{field} exceeds the bounded UTF-8 size"));
    }
    Ok(value)
}

fn add_string_bytes(bytes: usize, work: &mut DocumentSymbolProjectionWork) -> Result<(), String> {
    work.string_utf8_bytes = work.string_utf8_bytes.saturating_add(bytes);
    if work.string_utf8_bytes > MAX_DOCUMENT_SYMBOL_STRING_AGGREGATE_UTF8_BYTES {
        return Err("document symbol strings are too large".to_string());
    }
    Ok(())
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
    fn adversarial_hundred_thousand_roots_fail_before_node_work() {
        let response = Value::Array(vec![flat_symbol(0); 100_000]);

        let (result, work) = project_document_symbols_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_roots, 100_000);
        assert_eq!(work.visited_nodes, 0);
        assert_eq!(work.projected_nodes, 0);
    }

    #[test]
    fn exact_total_node_boundary_is_accepted_and_overflow_fails_closed() {
        let exact = Value::Array(
            (0..4)
                .map(|root| {
                    hierarchical_symbol(
                        root,
                        (0..499)
                            .map(|child| flat_symbol(root * 500 + child + 1))
                            .collect(),
                    )
                })
                .collect(),
        );
        let overflow = Value::Array(
            (0..4)
                .map(|root| {
                    hierarchical_symbol(
                        root,
                        (0..500)
                            .map(|child| flat_symbol(root * 501 + child + 1))
                            .collect(),
                    )
                })
                .collect(),
        );

        let (exact_result, exact_work) = project_document_symbols_result_with_work(&exact);
        let (overflow_result, overflow_work) = project_document_symbols_result_with_work(&overflow);

        assert_eq!(exact_work.visited_nodes, MAX_DOCUMENT_SYMBOL_NODES);
        assert_eq!(exact_work.projected_nodes, MAX_DOCUMENT_SYMBOL_NODES);
        assert_eq!(exact_result.expect("exact node maximum").len(), 4);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.visited_nodes, MAX_DOCUMENT_SYMBOL_NODES + 1);
    }

    #[test]
    fn exact_depth_boundary_is_accepted_and_n_plus_one_fails() {
        let exact = Value::Array(vec![nested_symbol(MAX_DOCUMENT_SYMBOL_DEPTH)]);
        let overflow = Value::Array(vec![nested_symbol(MAX_DOCUMENT_SYMBOL_DEPTH + 1)]);

        let (exact_result, exact_work) = project_document_symbols_result_with_work(&exact);
        let (overflow_result, overflow_work) = project_document_symbols_result_with_work(&overflow);

        assert!(exact_result.is_ok());
        assert_eq!(exact_work.maximum_depth, MAX_DOCUMENT_SYMBOL_DEPTH);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.maximum_depth, MAX_DOCUMENT_SYMBOL_DEPTH);
    }

    #[test]
    fn wide_children_fail_before_child_projection() {
        let response = Value::Array(vec![hierarchical_symbol(
            0,
            vec![flat_symbol(1); MAX_DOCUMENT_SYMBOL_CHILDREN + 1],
        )]);

        let (result, work) = project_document_symbols_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.visited_nodes, 1);
        assert_eq!(work.projected_nodes, 0);
    }

    #[test]
    fn utf8_field_boundaries_are_measured_in_bytes() {
        let exact_name = "😀".repeat(MAX_DOCUMENT_SYMBOL_NAME_UTF8_BYTES / 4);
        let oversized_name = format!("{exact_name}😀");
        let exact = json!([{
            "name": exact_name,
            "kind": 5,
            "location": {
                "uri": "file:///project/a.ts",
                "range": range(0)
            }
        }]);
        let oversized = json!([{
            "name": oversized_name,
            "kind": 5,
            "location": {
                "uri": "file:///project/a.ts",
                "range": range(0)
            }
        }]);

        assert!(project_document_symbols_result(&exact).is_ok());
        assert!(project_document_symbols_result(&oversized).is_err());
        assert!(project_document_symbols_result(&json!([{
            "name": "Bad uri",
            "kind": 5,
            "location": {
                "uri": "😀".repeat(MAX_DOCUMENT_SYMBOL_URI_UTF8_BYTES / 4 + 1),
                "range": range(0)
            }
        }]))
        .is_err());
    }

    #[test]
    fn malformed_union_ranges_kinds_and_tags_fail_the_whole_response() {
        let malformed = [
            json!({ "name": "Missing union", "kind": 5 }),
            json!({
                "name": "Ambiguous union",
                "kind": 5,
                "range": range(0),
                "selectionRange": range(0),
                "location": { "uri": "file:///a.ts", "range": range(0) }
            }),
            json!({
                "name": "Bad kind",
                "kind": 27,
                "location": { "uri": "file:///a.ts", "range": range(0) }
            }),
            json!({
                "name": "Bad tags",
                "kind": 5,
                "tags": [2],
                "location": { "uri": "file:///a.ts", "range": range(0) }
            }),
            json!({
                "name": "Bad range",
                "kind": 5,
                "range": range(1),
                "selectionRange": range(0)
            }),
            json!({
                "name": "Bad location",
                "kind": 5,
                "location": {
                    "uri": "file:///a.ts",
                    "range": {
                        "start": { "line": 2, "character": 0 },
                        "end": { "line": 1, "character": 0 }
                    }
                }
            }),
        ];

        for item in malformed {
            let response = json!([flat_symbol(0), item, flat_symbol(2)]);
            let (result, work) = project_document_symbols_result_with_work(&response);
            assert!(result.is_err());
            assert_eq!(work.visited_nodes, 2);
            assert_eq!(work.projected_nodes, 1);
        }
    }

    #[test]
    fn aggregate_wire_budget_and_unknown_nested_work_are_deterministic() {
        let response = Value::Array(
            (0..MAX_DOCUMENT_SYMBOL_NODES)
                .map(|line| {
                    json!({
                        "name": "x".repeat(MAX_DOCUMENT_SYMBOL_NAME_UTF8_BYTES),
                        "kind": 5,
                        "location": {
                            "uri": format!("file:///project/{line}.ts"),
                            "range": range(line as u32)
                        }
                    })
                })
                .collect(),
        );
        let unknown = json!([{
            "name": "Known",
            "kind": 5,
            "location": {
                "uri": "file:///project/known.ts",
                "range": {
                    "start": {
                        "line": 0,
                        "character": 0,
                        "unknown": vec![Value::Null; 100_000]
                    },
                    "end": { "line": 0, "character": 1 }
                }
            }
        }]);

        let (first_result, first_work) = project_document_symbols_result_with_work(&response);
        let (second_result, second_work) = project_document_symbols_result_with_work(&response);
        let (unknown_result, unknown_work) = project_document_symbols_result_with_work(&unknown);

        assert!(first_result.is_err());
        assert_eq!(first_work, second_work);
        assert_eq!(first_result, second_result);
        assert_eq!(
            first_work.projected_utf8_bytes,
            MAX_DOCUMENT_SYMBOL_RESPONSE_UTF8_BYTES + 1
        );
        assert!(unknown_result.is_ok());
        assert_eq!(unknown_work.visited_nodes, 1);
    }

    fn flat_symbol(line: u32) -> Value {
        json!({
            "name": format!("Symbol{line}"),
            "kind": 5,
            "containerName": "App",
            "tags": [1],
            "location": {
                "uri": format!("file:///project/{line}.ts"),
                "range": range(line)
            }
        })
    }

    fn hierarchical_symbol(line: u32, children: Vec<Value>) -> Value {
        json!({
            "name": format!("Container{line}"),
            "detail": "(value: string)",
            "kind": 5,
            "range": range(line),
            "selectionRange": range(line),
            "tags": [1],
            "children": children
        })
    }

    fn nested_symbol(depth: usize) -> Value {
        let mut value = hierarchical_symbol(depth as u32, Vec::new());
        for line in (0..depth).rev() {
            value = hierarchical_symbol(line as u32, vec![value]);
        }
        value
    }

    fn range(line: u32) -> Value {
        json!({
            "start": { "line": line, "character": 0 },
            "end": { "line": line, "character": 1 }
        })
    }
}
