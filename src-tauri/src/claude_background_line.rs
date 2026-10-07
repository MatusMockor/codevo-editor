use serde_json::{Map, Value};

pub const RETAINED_STRING_EDGE_BYTES: usize = 512;
pub const MIN_CLIPPED_STRING_BYTES: usize = 2 * RETAINED_STRING_EDGE_BYTES + 64;
pub const MAX_RETAINED_ARRAY_ITEMS: usize = 256;
pub const MAX_NAMED_FRAME_TYPE_BYTES: usize = 64;
pub const SILENT_FRAME_TYPES: [&str; 12] = [
    "stream_event",
    "tool_progress",
    "tool_use_summary",
    "keep_alive",
    "auth_status",
    "prompt_suggestion",
    "control_request",
    "control_response",
    "control_cancel_request",
    "streamlined_text",
    "streamlined_tool_use_summary",
    "command_lifecycle",
];
const VERBATIM_ASSISTANT_BLOCK_TYPES: [&str; 2] = ["text", "thinking"];
const UNDISPLAYED_ASSISTANT_BLOCK_FIELDS: [(&str, &str); 2] =
    [("thinking", "signature"), ("redacted_thinking", "data")];

#[derive(Clone, Copy)]
enum Arrays {
    Kept,
    Bounded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Display {
    Shown,
    Named,
    Silent,
}

pub fn background_line(frame: &Value, line: Vec<u8>) -> Option<Vec<u8>> {
    match display(frame) {
        Display::Shown => Some(compact_background_frame(frame, line.len()).unwrap_or(line)),
        Display::Named => Some(named_frame(frame)),
        Display::Silent => None,
    }
}

fn display(frame: &Value) -> Display {
    let Value::Object(fields) = frame else {
        return Display::Shown;
    };
    let Some(kind) = fields.get("type").and_then(Value::as_str) else {
        return Display::Named;
    };
    let shown = match kind {
        "result" => true,
        "assistant" => content_blocks(fields).is_some(),
        "user" => carries_tool_result(fields),
        "rate_limit_event" => fields.get("rate_limit_info").is_some_and(Value::is_object),
        "system" => displayed_system(fields),
        _ if SILENT_FRAME_TYPES.contains(&kind) => false,
        _ => return Display::Named,
    };
    match shown {
        true => Display::Shown,
        false => Display::Silent,
    }
}

fn content_blocks(fields: &Map<String, Value>) -> Option<&Vec<Value>> {
    fields
        .get("message")
        .and_then(Value::as_object)
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
}

fn carries_tool_result(fields: &Map<String, Value>) -> bool {
    let Some(blocks) = content_blocks(fields) else {
        return false;
    };
    fields.get("tool_use_result").is_some_and(Value::is_object)
        || blocks
            .iter()
            .any(|block| block_type(block) == Some("tool_result"))
}

fn displayed_system(fields: &Map<String, Value>) -> bool {
    let root = fields.get("parent_tool_use_id").is_none_or(Value::is_null);
    match fields.get("subtype").and_then(Value::as_str) {
        Some("init" | "api_retry") => true,
        Some("compact_boundary" | "status") => root,
        Some("task_started" | "task_progress" | "task_notification" | "task_updated") => true,
        _ => false,
    }
}

fn named_frame(frame: &Value) -> Vec<u8> {
    let kind = match frame.get("type") {
        Some(Value::String(kind)) if kind.len() <= MAX_NAMED_FRAME_TYPE_BYTES => Some(kind.clone()),
        Some(Value::String(_)) => Some(String::new()),
        _ => None,
    };
    let named: Map<String, Value> = kind
        .into_iter()
        .map(|kind| ("type".to_string(), Value::String(kind)))
        .collect();
    let mut line = serde_json::to_vec(&Value::Object(named)).unwrap_or_default();
    line.push(b'\n');
    line
}

fn block_type(block: &Value) -> Option<&str> {
    block.get("type").and_then(Value::as_str)
}

pub fn compact_background_frame(frame: &Value, line_bytes: usize) -> Option<Vec<u8>> {
    let Value::Object(fields) = frame else {
        return None;
    };
    if line_bytes < MIN_CLIPPED_STRING_BYTES && !carries_undisplayed_field(fields) {
        return None;
    }
    let mut fields = fields.clone();
    if !compact_fields(&mut fields) {
        return None;
    }
    let mut compacted = serde_json::to_vec(&Value::Object(fields)).ok()?;
    compacted.push(b'\n');
    (compacted.len() < line_bytes).then_some(compacted)
}

fn compact_fields(fields: &mut Map<String, Value>) -> bool {
    let assistant = fields.get("type").and_then(Value::as_str) == Some("assistant");
    let mut changed = fields
        .get_mut("tool_use_result")
        .is_some_and(|result| clip_value(result, Arrays::Bounded));
    let blocks = fields
        .get_mut("message")
        .and_then(|message| message.get_mut("content"))
        .and_then(Value::as_array_mut);
    for block in blocks.into_iter().flatten() {
        changed |= assistant && strip_undisplayed_field(block);
        if assistant && verbatim_assistant_block(block) {
            continue;
        }
        changed |= clip_value(block, Arrays::Kept);
    }
    changed
}

fn verbatim_assistant_block(block: &Value) -> bool {
    block_type(block).is_some_and(|kind| VERBATIM_ASSISTANT_BLOCK_TYPES.contains(&kind))
}

fn undisplayed_field(block: &Value) -> Option<&'static str> {
    let kind = block_type(block)?;
    UNDISPLAYED_ASSISTANT_BLOCK_FIELDS
        .iter()
        .find(|(owner, _)| *owner == kind)
        .map(|(_, field)| *field)
        .filter(|field| block.get(*field).is_some())
}

fn strip_undisplayed_field(block: &mut Value) -> bool {
    let Some(field) = undisplayed_field(block) else {
        return false;
    };
    block
        .as_object_mut()
        .is_some_and(|fields| fields.remove(field).is_some())
}

fn carries_undisplayed_field(fields: &Map<String, Value>) -> bool {
    fields.get("type").and_then(Value::as_str) == Some("assistant")
        && content_blocks(fields)
            .into_iter()
            .flatten()
            .any(|block| undisplayed_field(block).is_some())
}

fn clip_value(value: &mut Value, arrays: Arrays) -> bool {
    match value {
        Value::String(text) => clip_string(text),
        Value::Array(items) => clip_array(items, arrays),
        Value::Object(fields) => fields
            .values_mut()
            .fold(false, |changed, field| clip_value(field, arrays) | changed),
        _ => false,
    }
}

fn clip_array(items: &mut Vec<Value>, arrays: Arrays) -> bool {
    let dropped = matches!(arrays, Arrays::Bounded) && items.len() > MAX_RETAINED_ARRAY_ITEMS;
    if dropped {
        items.truncate(MAX_RETAINED_ARRAY_ITEMS);
    }
    items
        .iter_mut()
        .fold(dropped, |changed, item| clip_value(item, arrays) | changed)
}

fn clip_string(text: &mut String) -> bool {
    if text.len() < MIN_CLIPPED_STRING_BYTES {
        return false;
    }
    let head_end = floor_char_boundary(text, RETAINED_STRING_EDGE_BYTES);
    let tail_start = ceil_char_boundary(text, text.len() - RETAINED_STRING_EDGE_BYTES);
    let omitted = tail_start - head_end;
    *text = format!(
        "{}\n… {omitted} bytes omitted …\n{}",
        &text[..head_end],
        &text[tail_start..]
    );
    true
}

fn floor_char_boundary(text: &str, index: usize) -> usize {
    (0..=index)
        .rev()
        .find(|candidate| text.is_char_boundary(*candidate))
        .unwrap_or(0)
}

fn ceil_char_boundary(text: &str, index: usize) -> usize {
    (index..=text.len())
        .find(|candidate| text.is_char_boundary(*candidate))
        .unwrap_or(text.len())
}

#[cfg(test)]
#[path = "claude_background_line_tests.rs"]
mod tests;
