use super::{
    LanguageServerCodeActionCommand, LanguageServerCompletionEditRange,
    LanguageServerCompletionItem, LanguageServerCompletionItemDefaults,
    LanguageServerCompletionItemLabelDetails, LanguageServerCompletionList,
    LanguageServerCompletionTextEdit, LanguageServerPosition, LanguageServerRange,
    LanguageServerTextEdit,
};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

pub(super) const MAX_COMPLETION_ITEMS: usize = 2_000;
pub(super) const MAX_COMPLETION_RESPONSE_UTF8_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMPLETION_ITEM_UTF8_BYTES: usize = 64 * 1024;
const MAX_COMPLETION_LABEL_UTF8_BYTES: usize = 1_024;
const MAX_COMPLETION_FIELD_UTF8_BYTES: usize = 16 * 1024;
const MAX_COMPLETION_DOCUMENTATION_UTF8_BYTES: usize = 16 * 1024;
const MAX_COMPLETION_ADDITIONAL_TEXT_EDITS: usize = 64;
const MAX_COMPLETION_ADDITIONAL_TEXT_EDIT_UTF8_BYTES: usize = 32 * 1024;
const MAX_COMPLETION_COMMIT_CHARACTERS: usize = 64;
const MAX_COMPLETION_TAGS: usize = 16;
const MAX_COMPLETION_COMMAND_ARGUMENTS: usize = 64;
const MAX_COMPLETION_JSON_DEPTH: usize = 16;
const MAX_COMPLETION_JSON_NODES: usize = 1_024;
const MAX_COMPLETION_JSON_CONTAINER_ITEMS: usize = 256;
const MAX_COMPLETION_JSON_UTF8_BYTES: usize = 16 * 1024;
const COMPLETION_RESPONSE_ENVELOPE_UTF8_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct CompletionProjectionWork {
    pub(super) visited_items: usize,
    pub(super) projected_items: usize,
    pub(super) serialized_item_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompletionItemRejection {
    Malformed,
    Oversized,
}

pub(super) fn project_completion_result(
    value: &Value,
) -> Result<LanguageServerCompletionList, String> {
    project_completion_result_with_work(value).map(|(result, _)| result)
}

pub(super) fn project_completion_result_with_work(
    value: &Value,
) -> Result<(LanguageServerCompletionList, CompletionProjectionWork), String> {
    if value.is_null() {
        return Ok((
            LanguageServerCompletionList {
                is_incomplete: false,
                items: Vec::new(),
            },
            CompletionProjectionWork::default(),
        ));
    }

    let (items, upstream_incomplete, defaults) = if let Some(items) = value.as_array() {
        (items, false, None)
    } else {
        let items = value
            .get("items")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                "Language server returned a malformed completion response.".to_string()
            })?;
        let upstream_incomplete = value
            .get("isIncomplete")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let defaults = match value.get("itemDefaults") {
            Some(Value::Null) | None => None,
            Some(defaults) => Some(parse_completion_item_defaults(defaults).map_err(|_| {
                "Language server returned malformed or oversized completion item defaults."
                    .to_string()
            })?),
        };
        (items, upstream_incomplete, defaults)
    };

    let mut work = CompletionProjectionWork::default();
    let mut projected = Vec::with_capacity(items.len().min(MAX_COMPLETION_ITEMS));
    let mut response_bytes = COMPLETION_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut omitted = items.len() > MAX_COMPLETION_ITEMS;

    for value in items.iter().take(MAX_COMPLETION_ITEMS) {
        work.visited_items += 1;
        let item = match parse_completion_item(value, defaults.as_ref()) {
            Ok(item) => item,
            Err(_) => {
                omitted = true;
                continue;
            }
        };
        let item_bytes = serialized_len(&item)
            .map_err(|error| format!("Failed to measure projected completion response: {error}"))?;
        let response_item_bytes = item_bytes.saturating_add(1);
        if item_bytes > MAX_COMPLETION_ITEM_UTF8_BYTES
            || response_bytes.saturating_add(response_item_bytes)
                > MAX_COMPLETION_RESPONSE_UTF8_BYTES
        {
            omitted = true;
            break;
        }
        response_bytes += response_item_bytes;
        work.projected_items += 1;
        work.serialized_item_bytes += item_bytes;
        projected.push(item);
    }

    Ok((
        LanguageServerCompletionList {
            is_incomplete: upstream_incomplete || omitted,
            items: projected,
        },
        work,
    ))
}

pub(super) fn project_completion_item_result(
    value: &Value,
) -> Result<LanguageServerCompletionItem, String> {
    let item = parse_completion_item(value, None)
        .map_err(|_| "Language server returned a malformed or oversized completion item.")?;
    let bytes = serialized_len(&item)
        .map_err(|error| format!("Failed to measure projected completion item: {error}"))?;
    if bytes > MAX_COMPLETION_ITEM_UTF8_BYTES {
        return Err("Language server returned an oversized completion item.".to_string());
    }
    Ok(item)
}

fn parse_completion_item(
    value: &Value,
    defaults: Option<&LanguageServerCompletionItemDefaults>,
) -> Result<LanguageServerCompletionItem, CompletionItemRejection> {
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    let label = required_string(object.get("label"), MAX_COMPLETION_LABEL_UTF8_BYTES)?;
    let additional_text_edits = parse_additional_text_edits(object.get("additionalTextEdits"))?;
    let commit_characters = match object.get("commitCharacters") {
        Some(value) => parse_string_array(
            value,
            MAX_COMPLETION_COMMIT_CHARACTERS,
            MAX_COMPLETION_LABEL_UTF8_BYTES,
        )?,
        None => defaults
            .and_then(|defaults| defaults.commit_characters.clone())
            .unwrap_or_default(),
    };
    let tags = parse_tags(object.get("tags"))?;
    let insert_text = optional_string(object.get("insertText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?;
    let text_edit_text =
        optional_string(object.get("textEditText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?;
    let text_edit = match object.get("textEdit") {
        Some(Value::Null) | None if object.contains_key("textEdit") => None,
        Some(value) => Some(parse_completion_text_edit(value)?),
        None => defaults
            .and_then(|defaults| defaults.edit_range.as_ref())
            .map(|edit_range| {
                completion_text_edit_from_default_edit_range(
                    edit_range,
                    text_edit_text
                        .clone()
                        .or_else(|| insert_text.clone())
                        .unwrap_or_else(|| label.clone()),
                )
            })
            .transpose()?,
    };
    let data = match object.get("data") {
        Some(data) => Some(bounded_json_clone(data)?),
        None => defaults.and_then(|defaults| defaults.data.clone()),
    };
    let documentation = parse_documentation(object.get("documentation"))?;
    let documentation_kind = match object.get("documentation") {
        Some(Value::Object(documentation)) => {
            optional_string(documentation.get("kind"), MAX_COMPLETION_LABEL_UTF8_BYTES)?
        }
        _ => None,
    };

    Ok(LanguageServerCompletionItem {
        additional_text_edits,
        commit_characters,
        command: parse_completion_command(value)?,
        data,
        deprecated: optional_bool(object.get("deprecated"))?.unwrap_or(false),
        label,
        detail: optional_string(object.get("detail"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        documentation,
        documentation_kind,
        filter_text: optional_string(object.get("filterText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        insert_text,
        insert_text_format: optional_u32(object.get("insertTextFormat"))?
            .or_else(|| defaults.and_then(|defaults| defaults.insert_text_format)),
        insert_text_mode: optional_u32(object.get("insertTextMode"))?
            .or_else(|| defaults.and_then(|defaults| defaults.insert_text_mode)),
        kind: optional_u32(object.get("kind"))?,
        label_details: parse_label_details(object.get("labelDetails"))?,
        preselect: optional_bool(object.get("preselect"))?.unwrap_or(false),
        sort_text: optional_string(object.get("sortText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        tags,
        text_edit,
        text_edit_text,
    })
}

fn parse_completion_item_defaults(
    value: &Value,
) -> Result<LanguageServerCompletionItemDefaults, CompletionItemRejection> {
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    Ok(LanguageServerCompletionItemDefaults {
        commit_characters: object
            .get("commitCharacters")
            .map(|value| {
                parse_string_array(
                    value,
                    MAX_COMPLETION_COMMIT_CHARACTERS,
                    MAX_COMPLETION_LABEL_UTF8_BYTES,
                )
            })
            .transpose()?,
        data: object.get("data").map(bounded_json_clone).transpose()?,
        edit_range: object
            .get("editRange")
            .map(parse_completion_edit_range)
            .transpose()?,
        insert_text_format: optional_u32(object.get("insertTextFormat"))?,
        insert_text_mode: optional_u32(object.get("insertTextMode"))?,
    })
}

fn parse_completion_edit_range(
    value: &Value,
) -> Result<LanguageServerCompletionEditRange, CompletionItemRejection> {
    if let Ok(range) = parse_range(value) {
        return Ok(LanguageServerCompletionEditRange {
            range: Some(range),
            insert: None,
            replace: None,
        });
    }
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    Ok(LanguageServerCompletionEditRange {
        range: None,
        insert: Some(parse_range(
            object
                .get("insert")
                .ok_or(CompletionItemRejection::Malformed)?,
        )?),
        replace: Some(parse_range(
            object
                .get("replace")
                .ok_or(CompletionItemRejection::Malformed)?,
        )?),
    })
}

fn completion_text_edit_from_default_edit_range(
    edit_range: &LanguageServerCompletionEditRange,
    new_text: String,
) -> Result<LanguageServerCompletionTextEdit, CompletionItemRejection> {
    if new_text.len() > MAX_COMPLETION_FIELD_UTF8_BYTES {
        return Err(CompletionItemRejection::Oversized);
    }
    Ok(LanguageServerCompletionTextEdit {
        range: edit_range.range.clone(),
        insert: edit_range.insert.clone(),
        replace: edit_range.replace.clone(),
        new_text,
    })
}

fn parse_completion_text_edit(
    value: &Value,
) -> Result<LanguageServerCompletionTextEdit, CompletionItemRejection> {
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    let new_text = required_string(object.get("newText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?;
    let range = object.get("range").map(parse_range).transpose()?;
    let insert = object.get("insert").map(parse_range).transpose()?;
    let replace = object.get("replace").map(parse_range).transpose()?;
    match (range, insert, replace) {
        (Some(range), None, None) => Ok(LanguageServerCompletionTextEdit {
            range: Some(range),
            insert: None,
            replace: None,
            new_text,
        }),
        (None, Some(insert), Some(replace)) => Ok(LanguageServerCompletionTextEdit {
            range: None,
            insert: Some(insert),
            replace: Some(replace),
            new_text,
        }),
        _ => Err(CompletionItemRejection::Malformed),
    }
}

fn parse_additional_text_edits(
    value: Option<&Value>,
) -> Result<Vec<LanguageServerTextEdit>, CompletionItemRejection> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let items = value.as_array().ok_or(CompletionItemRejection::Malformed)?;
    if items.len() > MAX_COMPLETION_ADDITIONAL_TEXT_EDITS {
        return Err(CompletionItemRejection::Oversized);
    }
    let mut aggregate_new_text_bytes = 0usize;
    for value in items {
        let object = value
            .as_object()
            .ok_or(CompletionItemRejection::Malformed)?;
        parse_range(
            object
                .get("range")
                .ok_or(CompletionItemRejection::Malformed)?,
        )?;
        let new_text = object
            .get("newText")
            .and_then(Value::as_str)
            .ok_or(CompletionItemRejection::Malformed)?;
        if new_text.len() > MAX_COMPLETION_FIELD_UTF8_BYTES {
            return Err(CompletionItemRejection::Oversized);
        }
        aggregate_new_text_bytes = aggregate_new_text_bytes.saturating_add(new_text.len());
        if aggregate_new_text_bytes > MAX_COMPLETION_ADDITIONAL_TEXT_EDIT_UTF8_BYTES {
            return Err(CompletionItemRejection::Oversized);
        }
    }
    items
        .iter()
        .map(|value| {
            let object = value
                .as_object()
                .ok_or(CompletionItemRejection::Malformed)?;
            Ok(LanguageServerTextEdit {
                range: parse_range(
                    object
                        .get("range")
                        .ok_or(CompletionItemRejection::Malformed)?,
                )?,
                new_text: required_string(object.get("newText"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
            })
        })
        .collect()
}

fn parse_completion_command(
    item: &Value,
) -> Result<Option<LanguageServerCodeActionCommand>, CompletionItemRejection> {
    let Some(command_value) = item.get("command") else {
        return Ok(None);
    };
    if command_value.is_null() {
        return Ok(None);
    }
    let (container, direct_command) = if command_value.is_object() {
        (command_value, None)
    } else if let Some(command) = command_value.as_str() {
        (item, Some(command))
    } else {
        return Err(CompletionItemRejection::Malformed);
    };
    let command = match direct_command {
        Some(command) => bounded_string(command, MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        None => required_string(container.get("command"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
    };
    let title = match container.get("title") {
        Some(value) => required_string(Some(value), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        None => command.clone(),
    };
    let arguments = match container.get("arguments") {
        Some(Value::Null) | None => None,
        Some(arguments) => {
            let items = arguments
                .as_array()
                .ok_or(CompletionItemRejection::Malformed)?;
            if items.len() > MAX_COMPLETION_COMMAND_ARGUMENTS {
                return Err(CompletionItemRejection::Oversized);
            }
            match bounded_json_clone(arguments)? {
                Value::Array(projected) => Some(projected),
                _ => return Err(CompletionItemRejection::Malformed),
            }
        }
    };
    Ok(Some(LanguageServerCodeActionCommand {
        title,
        command,
        arguments,
    }))
}

fn parse_label_details(
    value: Option<&Value>,
) -> Result<Option<LanguageServerCompletionItemLabelDetails>, CompletionItemRejection> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    Ok(Some(LanguageServerCompletionItemLabelDetails {
        detail: optional_string(object.get("detail"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
        description: optional_string(object.get("description"), MAX_COMPLETION_FIELD_UTF8_BYTES)?,
    }))
}

fn parse_documentation(value: Option<&Value>) -> Result<Option<String>, CompletionItemRejection> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let mut output = String::new();
    let mut parts = 0usize;
    append_documentation(value, 0, &mut parts, &mut output)?;
    if parts == 0 {
        return Err(CompletionItemRejection::Malformed);
    }
    Ok(Some(output))
}

fn append_documentation(
    value: &Value,
    depth: usize,
    parts: &mut usize,
    output: &mut String,
) -> Result<(), CompletionItemRejection> {
    if depth > 4 || *parts >= 64 {
        return Err(CompletionItemRejection::Oversized);
    }
    if let Some(text) = value.as_str() {
        let separator = if output.is_empty() { 0 } else { 2 };
        if output
            .len()
            .saturating_add(separator)
            .saturating_add(text.len())
            > MAX_COMPLETION_DOCUMENTATION_UTF8_BYTES
        {
            return Err(CompletionItemRejection::Oversized);
        }
        if separator > 0 {
            output.push_str("\n\n");
        }
        output.push_str(text);
        *parts += 1;
        return Ok(());
    }
    if let Some(items) = value.as_array() {
        if items.len() > 64 {
            return Err(CompletionItemRejection::Oversized);
        }
        for item in items {
            append_documentation(item, depth + 1, parts, output)?;
        }
        return Ok(());
    }
    let nested = value
        .get("value")
        .ok_or(CompletionItemRejection::Malformed)?;
    append_documentation(nested, depth + 1, parts, output)
}

fn parse_string_array(
    value: &Value,
    maximum_items: usize,
    maximum_string_bytes: usize,
) -> Result<Vec<String>, CompletionItemRejection> {
    let items = value.as_array().ok_or(CompletionItemRejection::Malformed)?;
    if items.len() > maximum_items {
        return Err(CompletionItemRejection::Oversized);
    }
    items
        .iter()
        .map(|value| required_string(Some(value), maximum_string_bytes))
        .collect()
}

fn parse_tags(value: Option<&Value>) -> Result<Vec<u32>, CompletionItemRejection> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let items = value.as_array().ok_or(CompletionItemRejection::Malformed)?;
    if items.len() > MAX_COMPLETION_TAGS {
        return Err(CompletionItemRejection::Oversized);
    }
    items
        .iter()
        .map(|value| {
            value
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .ok_or(CompletionItemRejection::Malformed)
        })
        .collect()
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, CompletionItemRejection> {
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    Ok(LanguageServerRange {
        start: parse_position(
            object
                .get("start")
                .ok_or(CompletionItemRejection::Malformed)?,
        )?,
        end: parse_position(
            object
                .get("end")
                .ok_or(CompletionItemRejection::Malformed)?,
        )?,
    })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, CompletionItemRejection> {
    let object = value
        .as_object()
        .ok_or(CompletionItemRejection::Malformed)?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line"))?,
        character: required_u32(object.get("character"))?,
    })
}

fn required_u32(value: Option<&Value>) -> Result<u32, CompletionItemRejection> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(CompletionItemRejection::Malformed)
}

fn optional_u32(value: Option<&Value>) -> Result<Option<u32>, CompletionItemRejection> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => required_u32(Some(value)).map(Some),
    }
}

fn optional_bool(value: Option<&Value>) -> Result<Option<bool>, CompletionItemRejection> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_bool()
            .map(Some)
            .ok_or(CompletionItemRejection::Malformed),
    }
}

fn required_string(
    value: Option<&Value>,
    maximum_bytes: usize,
) -> Result<String, CompletionItemRejection> {
    let value = value
        .and_then(Value::as_str)
        .ok_or(CompletionItemRejection::Malformed)?;
    bounded_string(value, maximum_bytes)
}

fn optional_string(
    value: Option<&Value>,
    maximum_bytes: usize,
) -> Result<Option<String>, CompletionItemRejection> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => required_string(Some(value), maximum_bytes).map(Some),
    }
}

fn bounded_string(value: &str, maximum_bytes: usize) -> Result<String, CompletionItemRejection> {
    if value.len() > maximum_bytes {
        return Err(CompletionItemRejection::Oversized);
    }
    Ok(value.to_string())
}

fn bounded_json_clone(value: &Value) -> Result<Value, CompletionItemRejection> {
    let mut budget = JsonBudget {
        nodes: 0,
        string_bytes: 0,
    };
    validate_json(value, 0, &mut budget)?;
    if serialized_len(value).map_err(|_| CompletionItemRejection::Malformed)?
        > MAX_COMPLETION_JSON_UTF8_BYTES
    {
        return Err(CompletionItemRejection::Oversized);
    }
    Ok(value.clone())
}

struct JsonBudget {
    nodes: usize,
    string_bytes: usize,
}

fn validate_json(
    value: &Value,
    depth: usize,
    budget: &mut JsonBudget,
) -> Result<(), CompletionItemRejection> {
    if depth > MAX_COMPLETION_JSON_DEPTH {
        return Err(CompletionItemRejection::Oversized);
    }
    budget.nodes = budget.nodes.saturating_add(1);
    if budget.nodes > MAX_COMPLETION_JSON_NODES {
        return Err(CompletionItemRejection::Oversized);
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
        Value::String(value) => add_json_string_bytes(value.len(), budget),
        Value::Array(items) => {
            if items.len() > MAX_COMPLETION_JSON_CONTAINER_ITEMS {
                return Err(CompletionItemRejection::Oversized);
            }
            for item in items {
                validate_json(item, depth + 1, budget)?;
            }
            Ok(())
        }
        Value::Object(object) => {
            if object.len() > MAX_COMPLETION_JSON_CONTAINER_ITEMS {
                return Err(CompletionItemRejection::Oversized);
            }
            for (key, value) in object {
                add_json_string_bytes(key.len(), budget)?;
                validate_json(value, depth + 1, budget)?;
            }
            Ok(())
        }
    }
}

fn add_json_string_bytes(
    bytes: usize,
    budget: &mut JsonBudget,
) -> Result<(), CompletionItemRejection> {
    if bytes > MAX_COMPLETION_FIELD_UTF8_BYTES {
        return Err(CompletionItemRejection::Oversized);
    }
    budget.string_bytes = budget.string_bytes.saturating_add(bytes);
    if budget.string_bytes > MAX_COMPLETION_JSON_UTF8_BYTES {
        return Err(CompletionItemRejection::Oversized);
    }
    Ok(())
}

fn serialized_len(value: &impl Serialize) -> io::Result<usize> {
    let mut counter = ByteCounter::default();
    serde_json::to_writer(&mut counter, value).map_err(io::Error::other)?;
    Ok(counter.bytes)
}

#[derive(Default)]
struct ByteCounter {
    bytes: usize,
}

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes = self.bytes.saturating_add(bytes.len());
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
    fn adversarial_hundred_thousand_items_projects_only_the_bounded_prefix() {
        let item = json!({ "label": "candidate" });
        let response = Value::Array(vec![item; 100_000]);

        let (projected, work) =
            project_completion_result_with_work(&response).expect("bounded completion projection");

        assert_eq!(projected.items.len(), MAX_COMPLETION_ITEMS);
        assert!(projected.is_incomplete);
        assert_eq!(work.visited_items, MAX_COMPLETION_ITEMS);
        assert_eq!(work.projected_items, MAX_COMPLETION_ITEMS);
        assert!(work.serialized_item_bytes <= MAX_COMPLETION_RESPONSE_UTF8_BYTES);
    }

    #[test]
    fn a_single_item_over_the_bound_is_enough_to_stay_truthfully_incomplete() {
        let within_bound = Value::Array(
            (0..MAX_COMPLETION_ITEMS)
                .map(|index| json!({ "label": format!("item-{index:04}") }))
                .collect(),
        );
        let one_over_bound = Value::Array(
            (0..=MAX_COMPLETION_ITEMS)
                .map(|index| json!({ "label": format!("item-{index:04}") }))
                .collect(),
        );

        let (within, within_work) =
            project_completion_result_with_work(&within_bound).expect("bounded projection");
        let (over, over_work) =
            project_completion_result_with_work(&one_over_bound).expect("bounded projection");

        assert_eq!(within.items.len(), MAX_COMPLETION_ITEMS);
        assert!(!within.is_incomplete);
        assert_eq!(within_work.visited_items, MAX_COMPLETION_ITEMS);
        assert_eq!(over.items.len(), MAX_COMPLETION_ITEMS);
        assert!(over.is_incomplete);
        assert_eq!(over_work.visited_items, MAX_COMPLETION_ITEMS);
    }

    #[test]
    fn oversized_utf8_and_nested_entries_are_omitted_truthfully() {
        let oversized = "😀".repeat(MAX_COMPLETION_FIELD_UTF8_BYTES / 4 + 1);
        let response = json!({
            "isIncomplete": false,
            "items": [
                { "label": "first" },
                { "label": "too-large", "documentation": oversized },
                {
                    "label": "too-nested",
                    "data": nested_value(MAX_COMPLETION_JSON_DEPTH + 1)
                },
                { "label": "last" }
            ]
        });

        let (projected, work) =
            project_completion_result_with_work(&response).expect("bounded completion projection");

        assert_eq!(
            projected
                .items
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "last"]
        );
        assert!(projected.is_incomplete);
        assert_eq!(work.visited_items, 4);
        assert_eq!(work.projected_items, 2);
    }

    #[test]
    fn small_and_large_work_counters_scale_with_the_published_bound() {
        let small = Value::Array(
            (0..8)
                .map(|index| json!({ "label": format!("small-{index}") }))
                .collect(),
        );
        let large = Value::Array(
            (0..(MAX_COMPLETION_ITEMS * 4))
                .map(|index| json!({ "label": format!("large-{index}") }))
                .collect(),
        );

        let (_, small_work) =
            project_completion_result_with_work(&small).expect("small completion projection");
        let (large_result, large_work) =
            project_completion_result_with_work(&large).expect("large completion projection");

        assert_eq!(small_work.visited_items, 8);
        assert_eq!(small_work.projected_items, 8);
        assert_eq!(large_work.visited_items, MAX_COMPLETION_ITEMS);
        assert!(large_work.projected_items <= MAX_COMPLETION_ITEMS);
        assert!(large_result.is_incomplete);
    }

    #[test]
    fn aggregate_budget_keeps_a_deterministic_prefix() {
        let text = "x".repeat(MAX_COMPLETION_FIELD_UTF8_BYTES);
        let response = Value::Array(
            (0..MAX_COMPLETION_ITEMS)
                .map(|index| {
                    json!({
                        "label": format!("item-{index:04}"),
                        "documentation": text
                    })
                })
                .collect(),
        );

        let (projected, work) =
            project_completion_result_with_work(&response).expect("aggregate projection");

        assert!(projected.is_incomplete);
        assert!(!projected.items.is_empty());
        assert!(projected.items.len() < MAX_COMPLETION_ITEMS);
        assert_eq!(work.projected_items, projected.items.len());
        for (index, item) in projected.items.iter().enumerate() {
            assert_eq!(item.label, format!("item-{index:04}"));
        }
        assert!(
            work.serialized_item_bytes + COMPLETION_RESPONSE_ENVELOPE_UTF8_BYTES
                <= MAX_COMPLETION_RESPONSE_UTF8_BYTES
        );
    }

    #[test]
    fn additional_text_edits_reject_aggregate_bytes_before_projection() {
        let range = json!({
            "start": { "line": 0, "character": 0 },
            "end": { "line": 0, "character": 0 }
        });
        let edit = json!({
            "range": range,
            "newText": "x".repeat(MAX_COMPLETION_FIELD_UTF8_BYTES)
        });
        let response = json!({
            "items": [
                { "label": "first" },
                {
                    "label": "oversized-edits",
                    "additionalTextEdits": [edit.clone(), edit.clone(), edit]
                },
                { "label": "last" }
            ]
        });

        let (projected, work) =
            project_completion_result_with_work(&response).expect("bounded completion projection");

        assert_eq!(
            projected
                .items
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "last"]
        );
        assert!(projected.is_incomplete);
        assert_eq!(work.visited_items, 3);
        assert_eq!(work.projected_items, 2);
    }

    #[test]
    fn completion_text_edit_requires_exactly_one_valid_variant() {
        let range = json!({
            "start": { "line": 0, "character": 0 },
            "end": { "line": 0, "character": 1 }
        });
        let invalid_edits = [
            json!({ "newText": "x", "insert": range }),
            json!({ "newText": "x", "replace": range }),
            json!({
                "newText": "x",
                "range": range,
                "insert": range,
                "replace": range
            }),
        ];
        let response = Value::Array(
            std::iter::once(json!({ "label": "first" }))
                .chain(invalid_edits.iter().enumerate().map(|(index, text_edit)| {
                    json!({ "label": format!("invalid-{index}"), "textEdit": text_edit })
                }))
                .chain(std::iter::once(json!({ "label": "last" })))
                .collect(),
        );

        let projected =
            project_completion_result(&response).expect("bounded completion projection");

        assert_eq!(
            projected
                .items
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "last"]
        );
        assert!(projected.is_incomplete);
        for (index, text_edit) in invalid_edits.into_iter().enumerate() {
            let item = json!({ "label": format!("invalid-{index}"), "textEdit": text_edit });
            assert!(project_completion_item_result(&item).is_err());
        }
    }

    fn nested_value(depth: usize) -> Value {
        let mut value = Value::Null;
        for _ in 0..depth {
            value = json!({ "next": value });
        }
        value
    }
}
