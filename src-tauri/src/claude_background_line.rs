use serde_json::{Map, Value};

pub const RETAINED_STRING_EDGE_BYTES: usize = 512;
pub const MIN_CLIPPED_STRING_BYTES: usize = 2 * RETAINED_STRING_EDGE_BYTES + 64;
pub const MAX_RETAINED_ARRAY_ITEMS: usize = 256;
const VERBATIM_ASSISTANT_BLOCK_TYPES: [&str; 2] = ["text", "thinking"];

#[derive(Clone, Copy)]
enum Arrays {
    Kept,
    Bounded,
}

pub fn compact_background_frame(frame: &Value, line_bytes: usize) -> Option<Vec<u8>> {
    if line_bytes < MIN_CLIPPED_STRING_BYTES {
        return None;
    }
    let Value::Object(fields) = frame else {
        return None;
    };
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
        if assistant && verbatim_assistant_block(block) {
            continue;
        }
        changed |= clip_value(block, Arrays::Kept);
    }
    changed
}

fn verbatim_assistant_block(block: &Value) -> bool {
    block
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| VERBATIM_ASSISTANT_BLOCK_TYPES.contains(&kind))
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
