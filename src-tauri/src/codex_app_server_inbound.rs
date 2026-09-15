//! Exceptional wire frames are projected before entering the ordinary queue budget.
//! Never project RPC responses/requests: their payload is authoritative control data.
use super::super::codex_app_server_protocol::{is_ignored_notification, JSON_RPC_VERSION};
use super::MAX_APP_SERVER_LINE_BYTES;
use serde::{Deserialize, Deserializer};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use std::borrow::Cow;

// Keep more than the presenter's 512-byte tool summary so its existing clipped flag
// remains truthful. This prefix is private to the transport, not a second UI budget.
const MAX_COMMAND_OUTPUT_PREFIX_BYTES: usize = 4 * 1024;

pub(super) fn project_large_notification(line: &[u8]) -> Result<Vec<u8>, ()> {
    // Borrow the envelope. Ignored duplicates and oversized RPC responses must not
    // allocate a Value tree proportional to their potentially huge payloads.
    let envelope: LargeEnvelope<'_> = serde_json::from_slice(line).map_err(|_| ())?;
    if envelope.id.is_some()
        || envelope.result.is_some()
        || envelope.error.is_some()
        || envelope
            .jsonrpc
            .as_deref()
            .is_some_and(|version| version != JSON_RPC_VERSION)
    {
        return Err(());
    }
    let method = envelope.method.as_ref();
    let mut params;
    if is_ignored_notification(method) {
        // These notifications are already intentionally unused by the protocol
        // adapter (for example output deltas, followed by canonical item/completed).
        params = json!({});
    } else if matches!(method, "item/started" | "item/completed") {
        let raw_params = envelope.params.ok_or(())?;
        let preview: CommandParams<'_> = serde_json::from_str(raw_params.get()).map_err(|_| ())?;
        let command: CommandPreview<'_> =
            serde_json::from_str(preview.item.get()).map_err(|_| ())?;
        // Only a string display payload may exceed the normal frame budget. Bound
        // all remaining metadata before allocating its object/array representation.
        if command.kind != "commandExecution"
            || !command.output.get().starts_with('"')
            || line.len().saturating_sub(command.output.get().len()) > MAX_APP_SERVER_LINE_BYTES
        {
            return Err(());
        }
        params = serde_json::from_str(raw_params.get()).map_err(|_| ())?;
        let item = params.get_mut("item").ok_or(())?;
        if item.get("type").and_then(Value::as_str) != Some("commandExecution") {
            return Err(());
        }
        let Value::String(output) = item.get_mut("aggregatedOutput").ok_or(())? else {
            return Err(());
        };
        let mut end = output.len().min(MAX_COMMAND_OUTPUT_PREFIX_BYTES);
        while !output.is_char_boundary(end) {
            end -= 1;
        }
        output.truncate(end);
    } else {
        return Err(());
    }
    let projected =
        serde_json::to_vec(&json!({ "method": method, "params": params })).map_err(|_| ())?;
    if projected.len() > MAX_APP_SERVER_LINE_BYTES {
        return Err(());
    }
    Ok(projected)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LargeEnvelope<'a> {
    #[serde(default)]
    jsonrpc: Option<Cow<'a, str>>,
    #[serde(default, borrow, deserialize_with = "present_raw")]
    id: Option<&'a RawValue>,
    #[serde(borrow)]
    method: Cow<'a, str>,
    #[serde(default, borrow, deserialize_with = "present_raw")]
    params: Option<&'a RawValue>,
    #[serde(default, borrow, deserialize_with = "present_raw")]
    result: Option<&'a RawValue>,
    #[serde(default, borrow, deserialize_with = "present_raw")]
    error: Option<&'a RawValue>,
    #[serde(default, rename = "emittedAtMs")]
    _emitted_at_ms: Option<serde::de::IgnoredAny>,
    #[serde(default, rename = "trace")]
    _trace: Option<serde::de::IgnoredAny>,
}

fn present_raw<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<&'de RawValue>, D::Error> {
    <&RawValue>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
struct CommandParams<'a> {
    #[serde(borrow)]
    item: &'a RawValue,
}

#[derive(Deserialize)]
struct CommandPreview<'a> {
    #[serde(rename = "type")]
    #[serde(borrow)]
    kind: Cow<'a, str>,
    #[serde(rename = "aggregatedOutput", borrow)]
    output: &'a RawValue,
}
