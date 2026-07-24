// Bounded, getter-avoiding JavaScript serialization for clipboard evaluation.

use super::super::variables::{
    ensure_evaluation_owner, register_watch_set_expression_reference, safe_evaluation_name,
    variable_from_remote_object, ObjectReferenceMutation, MAX_CDP_OBJECT_ID_BYTES,
};
use super::{CdpClient, CdpShared};
use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluateErrorKind, DebugEvaluateFailure, DebugEvaluatePolicy,
    DebugVariableInfo,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(super) const MAX_CLIPBOARD_VALUE_BYTES: usize = 64 * 1024;
const MAX_CLIPBOARD_EVALUATION_TIMEOUT_MS: u64 = 5_000;
const CLIPBOARD_TIMEOUT_RESPONSE_MARGIN_MS: u64 = 500;

fn clipboard_timeout_ms(request_timeout: Duration) -> u64 {
    let total = u64::try_from(request_timeout.as_millis())
        .unwrap_or(u64::MAX)
        .clamp(1, MAX_CLIPBOARD_EVALUATION_TIMEOUT_MS);
    total.saturating_sub(CLIPBOARD_TIMEOUT_RESPONSE_MARGIN_MS.min(total / 2))
}

const CLIPBOARD_OBJECT_GROUP: &str = "codevo.clipboard";
const MAX_CLIPBOARD_DEPTH: usize = 8;
const MAX_CLIPBOARD_NODES: usize = 2_048;
const MAX_CLIPBOARD_KEYS: usize = 256;
const TRUNCATED: &str = "[Truncated]";

#[derive(Clone, Copy)]
enum PropertyKind<'a> {
    Data(&'a Value),
    Accessor,
}

struct PreviewSerializer<'a> {
    client: &'a CdpClient,
    deadline: Instant,
    output: String,
    active: HashSet<String>,
    nodes: usize,
    stopped: bool,
}

impl<'a> PreviewSerializer<'a> {
    fn new(client: &'a CdpClient, deadline: Instant) -> Self {
        Self {
            client,
            deadline,
            output: String::new(),
            active: HashSet::new(),
            nodes: 0,
            stopped: false,
        }
    }

    fn finish(mut self, remote: &Value) -> Result<String, DebugEvaluateFailure> {
        self.remote(remote, 0)?;
        Ok(self.output)
    }

    fn put(&mut self, piece: &str) {
        if self.stopped {
            return;
        }
        let remaining = MAX_CLIPBOARD_VALUE_BYTES.saturating_sub(self.output.len());
        if piece.len() <= remaining {
            self.output.push_str(piece);
            return;
        }
        let reserve = remaining.saturating_sub(TRUNCATED.len());
        let boundary = floor_char_boundary(piece, reserve);
        self.output.push_str(&piece[..boundary]);
        if remaining >= TRUNCATED.len() {
            self.output.push_str(TRUNCATED);
        }
        self.stopped = true;
    }

    fn remote(&mut self, remote: &Value, depth: usize) -> Result<(), DebugEvaluateFailure> {
        self.nodes += 1;
        if self.nodes > MAX_CLIPBOARD_NODES {
            self.put("[NodeLimit]");
            return Ok(());
        }
        let kind = remote
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(unsupported_preview)?;
        validate_remote_shape(remote, kind)?;
        match kind {
            "undefined" => self.put("undefined"),
            "boolean" | "number" => self.put(&primitive_text(remote)?),
            "string" => self.put(&quote(
                remote
                    .get("value")
                    .and_then(Value::as_str)
                    .ok_or_else(unsupported_preview)?,
            )?),
            "bigint" => self.put(&primitive_text(remote)?),
            "symbol" => self.put(&bounded_description(remote, "Symbol()")?),
            "function" => self.put(&function_description(remote)?),
            "object" if remote.get("subtype").and_then(Value::as_str) == Some("null") => {
                self.put("null")
            }
            "object" => self.object(remote, depth)?,
            _ => return Err(unsupported_preview()),
        }
        Ok(())
    }

    fn object(&mut self, remote: &Value, depth: usize) -> Result<(), DebugEvaluateFailure> {
        if depth >= MAX_CLIPBOARD_DEPTH {
            self.put("[MaxDepth]");
            return Ok(());
        }
        let subtype = remote.get("subtype").and_then(Value::as_str);
        if !supported_object_subtype(remote) {
            return Err(unsupported_preview());
        }
        let preview = remote
            .get("preview")
            .and_then(Value::as_object)
            .ok_or_else(unsupported_preview)?;
        if preview.get("type").and_then(Value::as_str) != Some("object")
            || preview.get("subtype") != remote.get("subtype")
            || preview.get("overflow").and_then(Value::as_bool) != Some(false)
            || preview
                .get("properties")
                .and_then(Value::as_array)
                .is_none_or(|p| p.len() > MAX_CLIPBOARD_KEYS)
        {
            return Err(unsupported_preview());
        }
        let object_id = remote
            .get("objectId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 4096)
            .ok_or_else(unsupported_preview)?;
        if subtype == Some("date") {
            if preview
                .get("properties")
                .and_then(Value::as_array)
                .is_none_or(|properties| !properties.is_empty())
            {
                return Err(unsupported_preview());
            }
            let description =
                deterministic_date_description(remote, preview).ok_or_else(unsupported_preview)?;
            self.put("Date(");
            self.put(&quote(description)?);
            self.put(")");
            return Ok(());
        }
        if !self.active.insert(object_id.to_string()) {
            self.put("[Circular]");
            return Ok(());
        }
        let result = self.object_properties(remote, object_id, depth);
        self.active.remove(object_id);
        result
    }

    fn object_properties(
        &mut self,
        remote: &Value,
        object_id: &str,
        depth: usize,
    ) -> Result<(), DebugEvaluateFailure> {
        let response = self
            .client
            .request_with_timeout(
                "Runtime.getProperties",
                serde_json::json!({
                    "objectId": object_id, "ownProperties": true, "generatePreview": true,
                }),
                remaining(self.deadline)?,
            )
            .map_err(DebugEvaluateFailure::exception)?;
        let properties = response
            .get("result")
            .and_then(Value::as_array)
            .ok_or_else(unsupported_preview)?;
        if properties.len() > MAX_CLIPBOARD_KEYS {
            return Err(unsupported_preview());
        }
        let typed = remote.get("subtype").and_then(Value::as_str) == Some("typedarray");
        let array = remote.get("subtype").and_then(Value::as_str) == Some("array");
        if typed {
            self.put(&bounded_class_name(remote, "TypedArray")?);
            self.put("([")
        } else {
            self.put(if array { "[" } else { "{" })
        }
        let mut by_name = HashMap::with_capacity(properties.len());
        for property in properties {
            let name = property
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| name.len() <= MAX_CLIPBOARD_VALUE_BYTES)
                .ok_or_else(unsupported_preview)?;
            let kind = property_kind(property)?;
            if by_name.insert(name, kind).is_some() {
                return Err(unsupported_preview());
            }
        }
        let mut entries = Vec::new();
        let mut truncated = false;
        if typed {
            let length = typed_array_length(remote)?;
            if by_name.keys().any(|name| array_index(name).is_none()) {
                return Err(unsupported_preview());
            }
            entries = by_name
                .keys()
                .filter(|name| array_index(name).is_some())
                .map(|name| (*name).to_string())
                .collect();
            entries.sort_by_key(|name| array_index(name).unwrap_or(u32::MAX));
            if entries
                .iter()
                .enumerate()
                .any(|(index, name)| array_index(name) != u32::try_from(index).ok())
                || entries.len() != length
            {
                return Err(unsupported_preview());
            }
        } else if array {
            let length = by_name
                .get("length")
                .and_then(|kind| match kind {
                    PropertyKind::Data(value) => exact_array_length(value),
                    PropertyKind::Accessor => None,
                })
                .ok_or_else(unsupported_preview)?;
            for name in by_name.keys().filter(|name| *name != &"length") {
                if let Some(index) = array_index(name) {
                    if u64::from(index) >= length {
                        return Err(unsupported_preview());
                    }
                } else if is_noncanonical_numeric_index(name) {
                    return Err(unsupported_preview());
                }
            }
            let bounded = usize::try_from(length.min(MAX_CLIPBOARD_KEYS as u64))
                .unwrap_or(MAX_CLIPBOARD_KEYS);
            entries.extend((0..bounded).map(|index| index.to_string()));
            truncated = length > bounded as u64;
            if !typed {
                let mut extras = by_name
                    .keys()
                    .filter(|name| *name != &"length" && array_index(name).is_none())
                    .map(|name| (*name).to_string())
                    .collect::<Vec<_>>();
                extras.sort();
                entries.extend(extras);
            }
        } else {
            entries = by_name.keys().map(|name| (*name).to_string()).collect();
            entries.sort();
        }
        if entries.len() > MAX_CLIPBOARD_KEYS {
            return Err(unsupported_preview());
        }
        for (index, name) in entries.iter().enumerate() {
            if index > 0 {
                self.put(", ");
            }
            if !(array || typed) || array_index(name).is_none() {
                self.put(&key_text(name)?);
                self.put(": ");
            }
            match by_name.get(name.as_str()) {
                Some(PropertyKind::Data(value)) => self.remote(value, depth + 1)?,
                Some(PropertyKind::Accessor) => self.put("[Getter]"),
                None => self.put(if array || typed {
                    "[Empty]"
                } else {
                    return Err(unsupported_preview());
                }),
            }
        }
        if truncated {
            if !entries.is_empty() {
                self.put(", ");
            }
            self.put(TRUNCATED);
        }
        self.put(if typed {
            "])"
        } else if array {
            "]"
        } else {
            "}"
        });
        Ok(())
    }
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}
fn unsupported_preview() -> DebugEvaluateFailure {
    DebugEvaluateFailure::unsupported("Clipboard value has no safe bounded debugger preview.")
}
fn quote(value: &str) -> Result<String, DebugEvaluateFailure> {
    if value.len() > MAX_CLIPBOARD_VALUE_BYTES {
        return Err(unsupported_preview());
    }
    serde_json::to_string(value).map_err(|_| unsupported_preview())
}
fn primitive_text(remote: &Value) -> Result<String, DebugEvaluateFailure> {
    remote
        .get("unserializableValue")
        .or_else(|| remote.get("value"))
        .map(render_remote_scalar)
        .ok_or_else(unsupported_preview)
}

fn validate_remote_shape(remote: &Value, kind: &str) -> Result<(), DebugEvaluateFailure> {
    let value = remote.get("value");
    let unserializable = remote.get("unserializableValue");
    let valid = match kind {
        "undefined" => value.is_none() && unserializable.is_none(),
        "boolean" => value.is_some_and(Value::is_boolean) && unserializable.is_none(),
        "number" => {
            (value.is_some_and(Value::is_number) && unserializable.is_none())
                || (value.is_none()
                    && unserializable.and_then(Value::as_str).is_some_and(|value| {
                        matches!(value, "NaN" | "Infinity" | "-Infinity" | "-0")
                    }))
        }
        "string" => value.is_some_and(Value::is_string) && unserializable.is_none(),
        "bigint" => {
            value.is_none()
                && unserializable
                    .and_then(Value::as_str)
                    .is_some_and(is_exact_bigint)
        }
        "symbol" | "function" => {
            value.is_none()
                && unserializable.is_none()
                && remote
                    .get("description")
                    .and_then(Value::as_str)
                    .is_some_and(|description| description.len() <= 4096)
        }
        "object" if remote.get("subtype").and_then(Value::as_str) == Some("null") => {
            value == Some(&Value::Null) && unserializable.is_none()
        }
        "object" => value.is_none() && unserializable.is_none(),
        _ => false,
    };
    valid.then_some(()).ok_or_else(unsupported_preview)
}

fn is_exact_bigint(value: &str) -> bool {
    let digits = value.strip_suffix('n').unwrap_or("");
    let digits = digits.strip_prefix('-').unwrap_or(digits);
    !digits.is_empty()
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && (digits == "0" || !digits.starts_with('0'))
}

fn property_kind(property: &Value) -> Result<PropertyKind<'_>, DebugEvaluateFailure> {
    let object = property.as_object().ok_or_else(unsupported_preview)?;
    match (object.get("value"), object.get("get"), object.get("set")) {
        (Some(value), None, None) if value.is_object() => {
            let kind = value
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(unsupported_preview)?;
            validate_remote_shape(value, kind)?;
            Ok(PropertyKind::Data(value))
        }
        (None, Some(get), Some(set))
            if valid_accessor_endpoint(get) && valid_accessor_endpoint(set) =>
        {
            Ok(PropertyKind::Accessor)
        }
        _ => Err(unsupported_preview()),
    }
}

fn valid_accessor_endpoint(remote: &Value) -> bool {
    let Some(kind) = remote.get("type").and_then(Value::as_str) else {
        return false;
    };
    matches!(kind, "undefined" | "function") && validate_remote_shape(remote, kind).is_ok()
}

fn exact_array_length(remote: &Value) -> Option<u64> {
    (remote.get("type").and_then(Value::as_str) == Some("number")
        && remote.get("unserializableValue").is_none())
    .then(|| remote.get("value").and_then(Value::as_u64))
    .flatten()
    .filter(|length| *length < u32::MAX as u64)
}

fn typed_array_length(remote: &Value) -> Result<usize, DebugEvaluateFailure> {
    let properties = remote
        .pointer("/preview/properties")
        .and_then(Value::as_array)
        .ok_or_else(unsupported_preview)?;
    let mut lengths = properties
        .iter()
        .filter(|property| property.get("name").and_then(Value::as_str) == Some("length"));
    let property = lengths.next().ok_or_else(unsupported_preview)?;
    if lengths.next().is_some() || property.get("type").and_then(Value::as_str) != Some("number") {
        return Err(unsupported_preview());
    }
    property
        .get("value")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && (value == &"0" || !value.starts_with('0')))
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|length| *length <= MAX_CLIPBOARD_KEYS)
        .ok_or_else(unsupported_preview)
}

fn supported_typed_array(remote: &Value) -> bool {
    matches!(
        remote.get("className").and_then(Value::as_str),
        Some(
            "Int8Array"
                | "Uint8Array"
                | "Uint8ClampedArray"
                | "Int16Array"
                | "Uint16Array"
                | "Int32Array"
                | "Uint32Array"
                | "Float16Array"
                | "Float32Array"
                | "Float64Array"
                | "BigInt64Array"
                | "BigUint64Array"
        )
    )
}

fn supported_object_subtype(remote: &Value) -> bool {
    match remote.get("subtype") {
        None => true,
        Some(Value::String(subtype)) if subtype == "array" || subtype == "date" => true,
        Some(Value::String(subtype)) if subtype == "typedarray" => supported_typed_array(remote),
        _ => false,
    }
}

fn is_exact_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) && !byte.is_ascii_digit()
        })
    {
        return false;
    }
    let number = |start: usize, end: usize| value[start..end].parse::<u32>().ok();
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day > 0 && day <= max_day && hour < 24 && minute < 60 && second < 60
}

fn deterministic_date_description<'a>(
    remote: &'a Value,
    preview: &serde_json::Map<String, Value>,
) -> Option<&'a str> {
    remote
        .get("description")
        .and_then(Value::as_str)
        .filter(|value| is_exact_iso_date(value))
        .filter(|value| preview.get("description").and_then(Value::as_str) == Some(*value))
}
fn render_remote_scalar(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}
fn bounded_description(remote: &Value, fallback: &str) -> Result<String, DebugEvaluateFailure> {
    let value = remote
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or(fallback);
    (value.len() <= 4096)
        .then(|| value.to_string())
        .ok_or_else(unsupported_preview)
}
fn bounded_class_name(remote: &Value, fallback: &str) -> Result<String, DebugEvaluateFailure> {
    let value = remote
        .get("className")
        .and_then(Value::as_str)
        .unwrap_or(fallback);
    (value.len() <= 256)
        .then(|| value.to_string())
        .ok_or_else(unsupported_preview)
}
fn function_description(remote: &Value) -> Result<String, DebugEvaluateFailure> {
    let description = bounded_description(remote, "")?;
    let name = description
        .strip_prefix("function ")
        .and_then(|rest| rest.split(['(', ' ']).next())
        .unwrap_or("");
    Ok(if name.is_empty() {
        "[Function]".to_string()
    } else {
        format!("[Function {name}]")
    })
}
fn array_index(value: &str) -> Option<u32> {
    let index = value.parse::<u32>().ok()?;
    (index != u32::MAX && index.to_string() == value).then_some(index)
}
fn is_noncanonical_numeric_index(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && array_index(value).is_none()
}
fn key_text(value: &str) -> Result<String, DebugEvaluateFailure> {
    if !value.is_empty()
        && value.bytes().enumerate().all(|(i, b)| {
            if i == 0 {
                b.is_ascii_alphabetic() || b == b'_' || b == b'$'
            } else {
                b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
            }
        })
    {
        Ok(value.to_string())
    } else {
        quote(value)
    }
}
fn remaining(deadline: Instant) -> Result<Duration, DebugEvaluateFailure> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    (!remaining.is_zero())
        .then_some(remaining)
        .ok_or_else(|| DebugEvaluateFailure::exception("Clipboard evaluation timed out."))
}
fn cleanup_timeout(deadline: Instant) -> Duration {
    deadline
        .saturating_duration_since(Instant::now())
        .max(Duration::from_millis(1))
}

pub(super) fn variable_from_result(
    expression: &str,
    remote: &Value,
) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
    let Some(object) = remote.as_object() else {
        return Err(DebugEvaluateFailure::unsupported(
            "Clipboard evaluation returned an invalid remote object.",
        ));
    };
    if object.len() != 2 || remote.get("type").and_then(Value::as_str) != Some("string") {
        return Err(DebugEvaluateFailure::unsupported(
            "Clipboard evaluation did not return an exact string result.",
        ));
    }
    let value = remote.get("value").and_then(Value::as_str).ok_or_else(|| {
        DebugEvaluateFailure::unsupported(
            "Clipboard evaluation did not return a serialized string.",
        )
    })?;
    if value.len() > MAX_CLIPBOARD_VALUE_BYTES {
        return Err(DebugEvaluateFailure::unsupported(
            "Clipboard evaluation exceeded the 64 KiB output limit.",
        ));
    }
    Ok(DebugVariableInfo {
        name: expression.to_string(),
        value: value.to_string(),
        value_type: Some("string".to_string()),
        evaluate_name: None,
        variables_reference: 0,
        can_set_value: None,
        set_expression_reference: None,
    })
}

pub(super) fn evaluate_with_policy(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    frame_id: u64,
    expression: &str,
    policy: DebugEvaluatePolicy,
) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
    let (call_frame_id, pause_generation) = {
        let state = shared
            .lock()
            .map_err(|error| DebugEvaluateFailure::exception(error.to_string()))?;
        let pause = state
            .pause
            .as_ref()
            .ok_or_else(|| DebugEvaluateFailure::exception("The debugger is not paused."))?;
        let call_frame_id = pause
            .call_frame_ids
            .get(&frame_id)
            .cloned()
            .ok_or_else(|| {
                DebugEvaluateFailure::exception(format!("Unknown debug frame {frame_id}."))
            })?;
        (call_frame_id, pause.pause_generation)
    };
    let clipboard = policy.context == DebugEvaluateContext::Clipboard;
    let clipboard_deadline = clipboard.then(|| Instant::now() + client.request_timeout);
    let watch = policy.context == DebugEvaluateContext::Watch;
    let evaluated_expression = expression.to_string();
    let parameters = if watch {
        serde_json::json!({
            "callFrameId": call_frame_id, "expression": evaluated_expression,
            "silent": true, "throwOnSideEffect": true, "awaitPromise": false,
        })
    } else if clipboard {
        let timeout = clipboard_timeout_ms(client.request_timeout);
        serde_json::json!({
            "callFrameId": call_frame_id, "expression": evaluated_expression,
            "silent": true, "returnByValue": false, "generatePreview": true,
            "awaitPromise": false, "timeout": timeout, "objectGroup": CLIPBOARD_OBJECT_GROUP,
        })
    } else {
        serde_json::json!({
            "callFrameId": call_frame_id, "expression": evaluated_expression,
            "throwOnSideEffect": !policy.allow_side_effects,
        })
    };
    let response_result = if let Some(deadline) = clipboard_deadline {
        client.request_with_timeout(
            "Debugger.evaluateOnCallFrame",
            parameters,
            remaining(deadline)?,
        )
    } else {
        client.request("Debugger.evaluateOnCallFrame", parameters)
    };
    let response = match response_result {
        Ok(response) => response,
        Err(error) => {
            if let Some(deadline) = clipboard_deadline {
                let _ = release_clipboard_group(client, deadline);
            }
            return Err(DebugEvaluateFailure::exception(error));
        }
    };
    if let Err(failure) = ensure_evaluation_owner(shared, pause_generation, frame_id) {
        if let Some(deadline) = clipboard_deadline {
            let _ = release_clipboard_group(client, deadline);
        }
        return Err(failure);
    }
    if let Some(details) = response.get("exceptionDetails") {
        let message = details
            .pointer("/exception/description")
            .and_then(Value::as_str)
            .or_else(|| details.get("text").and_then(Value::as_str))
            .unwrap_or("Evaluation failed.");
        let normalized = message.to_ascii_lowercase();
        let kind = if !policy.allow_side_effects
            && (normalized.contains("side-effect") || normalized.contains("side effect"))
        {
            DebugEvaluateErrorKind::SideEffect
        } else {
            DebugEvaluateErrorKind::Exception
        };
        let failure = DebugEvaluateFailure {
            kind,
            message: message.to_string(),
        };
        if let Some(deadline) = clipboard_deadline {
            let _ = release_clipboard_group(client, deadline);
        }
        return Err(failure);
    }
    let remote = response.get("result").unwrap_or(&Value::Null);
    if clipboard {
        let deadline = clipboard_deadline.expect("clipboard deadline");
        let serialized = PreviewSerializer::new(client, deadline).finish(remote);
        let released = release_clipboard_group(client, deadline);
        ensure_evaluation_owner(shared, pause_generation, frame_id)?;
        released.map_err(DebugEvaluateFailure::exception)?;
        let value = serialized?;
        variable_from_result(
            expression,
            &serde_json::json!({"type": "string", "value": value}),
        )
    } else {
        let mutation = watch_root_mutation(policy.context, remote);
        let mut variable = variable_from_remote_object(
            expression,
            remote,
            shared,
            Some((pause_generation, frame_id)),
            safe_evaluation_name(expression),
            mutation,
        );
        if watch {
            variable.set_expression_reference = register_watch_set_expression_reference(
                client,
                shared,
                pause_generation,
                frame_id,
                expression,
            );
        }
        Ok(variable)
    }
}

fn watch_root_mutation(context: DebugEvaluateContext, remote: &Value) -> ObjectReferenceMutation {
    if context != DebugEvaluateContext::Watch
        || remote.get("type").and_then(Value::as_str) != Some("object")
    {
        return ObjectReferenceMutation::ReadOnly;
    }
    let Some(object_id) = remote.get("objectId").and_then(Value::as_str) else {
        return ObjectReferenceMutation::ReadOnly;
    };
    let unsupported = remote
        .get("subtype")
        .and_then(Value::as_str)
        .is_some_and(|subtype| subtype == "proxy" || subtype.starts_with("internal#"));
    if unsupported || object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        ObjectReferenceMutation::ReadOnly
    } else {
        ObjectReferenceMutation::ObjectProperty {
            object_id: object_id.to_string(),
        }
    }
}

fn release_clipboard_group(client: &CdpClient, deadline: Instant) -> Result<(), String> {
    client
        .request_with_timeout(
            "Runtime.releaseObjectGroup",
            serde_json::json!({"objectGroup": CLIPBOARD_OBJECT_GROUP}),
            cleanup_timeout(deadline),
        )
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn inspect_in_node(expression: &str, timezone: Option<&str>) -> Value {
        let script = format!(
            r#"const inspector = require('node:inspector');
const session = new inspector.Session(); session.connect();
session.on('Debugger.paused', ({{params}}) => session.post('Debugger.evaluateOnCallFrame', {{
  callFrameId: params.callFrames[0].callFrameId, expression: {}, generatePreview: true,
  returnByValue: false, timeout: 1000, objectGroup: 'codevo.clipboard'
}}, (error, result) => {{ process.stdout.write(JSON.stringify({{error: error && error.message, result: result && result.result}})); session.post('Debugger.resume', () => session.disconnect()); }}));
session.post('Debugger.enable', () => {{ debugger; }});"#,
            serde_json::to_string(expression).expect("expression JSON")
        );
        let mut command = Command::new("node");
        command.args(["-e", &script]);
        if let Some(timezone) = timezone {
            command.env("TZ", timezone);
        }
        let output = command.output().expect("Node.js inspector probe");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).expect("inspector JSON");
        assert!(result["error"].is_null());
        result["result"].clone()
    }

    #[test]
    fn result_is_a_bounded_string_only() {
        let result = variable_from_result(
            "value",
            &serde_json::json!({"type":"string", "value":"{answer: 42}"}),
        )
        .expect("clipboard string");
        assert_eq!(result.value, "{answer: 42}");
        assert_eq!(result.variables_reference, 0);
        assert!(result.evaluate_name.is_none());

        assert!(variable_from_result("value", &serde_json::json!({"value": {}})).is_err());
        assert!(variable_from_result("value", &serde_json::json!({"value":"x"})).is_err());
        assert!(
            variable_from_result("value", &serde_json::json!({"type":"number", "value":"x"}),)
                .is_err()
        );
        assert!(variable_from_result(
            "value",
            &serde_json::json!({"type":"string", "value":"x", "description":"x"}),
        )
        .is_err());
        assert!(variable_from_result(
            "value",
            &serde_json::json!({"type":"string", "value":"x".repeat(MAX_CLIPBOARD_VALUE_BYTES + 1)}),
        )
        .is_err());
    }

    #[test]
    fn real_node_direct_preview_works_with_code_generation_disabled_and_tampered_constructor() {
        let script = r#"const inspector = require('node:inspector');
const session = new inspector.Session(); session.connect(); let hits = 0;
Function.prototype.constructor = function () { hits++; throw new Error('must not run'); };
session.on('Debugger.paused', ({params}) => session.post('Debugger.evaluateOnCallFrame', {
  callFrameId: params.callFrames[0].callFrameId, expression: '({answer: 42})',
  generatePreview: true, returnByValue: false, timeout: 1000, objectGroup: 'codevo.clipboard'
}, (error, result) => {
  process.stdout.write(JSON.stringify({error: error && error.message, hits, result}));
  session.post('Debugger.resume', () => session.disconnect());
})); session.post('Debugger.enable', () => { debugger; });"#;
        let output = Command::new("node")
            .args(["--disallow-code-generation-from-strings", "-e", script])
            .output()
            .expect("Node.js is required for the CSP preview test");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).expect("preview JSON");
        assert!(value["error"].is_null());
        assert_eq!(value["hits"], serde_json::json!(0));
        assert_eq!(
            value.pointer("/result/result/preview/overflow"),
            Some(&Value::Bool(false))
        );
    }

    #[test]
    fn real_node_proxy_preview_does_not_invoke_own_key_or_prototype_traps() {
        let script = r#"const inspector = require('node:inspector');
const session = new inspector.Session(); session.connect(); let ownKeys = 0, prototypes = 0;
const value = new Proxy({a: 1}, {ownKeys(t) { ownKeys++; return Reflect.ownKeys(t); }, getPrototypeOf(t) { prototypes++; return Reflect.getPrototypeOf(t); }});
session.on('Debugger.paused', ({params}) => session.post('Debugger.evaluateOnCallFrame', {
  callFrameId: params.callFrames[0].callFrameId, expression: 'value', generatePreview: true,
  returnByValue: false, timeout: 1000, objectGroup: 'codevo.clipboard'
}, (error, result) => { process.stdout.write(JSON.stringify({error: error && error.message, ownKeys, prototypes, result})); session.post('Debugger.resume', () => session.disconnect()); }));
session.post('Debugger.enable', () => { debugger; });"#;
        let output = Command::new("node")
            .args(["-e", script])
            .output()
            .expect("Node proxy test");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).expect("proxy preview JSON");
        assert_eq!(value["ownKeys"], serde_json::json!(0));
        assert_eq!(value["prototypes"], serde_json::json!(0));
        assert_eq!(
            value
                .pointer("/result/result/subtype")
                .and_then(Value::as_str),
            Some("proxy")
        );
    }

    #[test]
    fn real_node_map_and_set_previews_are_explicitly_unsupported() {
        for expression in ["new Map([['answer', 42]])", "new Set([1, 2])"] {
            let remote = inspect_in_node(expression, None);
            assert_eq!(
                remote.pointer("/preview/overflow"),
                Some(&Value::Bool(false))
            );
            assert!(matches!(
                remote.get("subtype").and_then(Value::as_str),
                Some("map" | "set")
            ));
            assert!(!supported_object_subtype(&remote));
        }
    }

    #[test]
    fn real_node_date_fails_closed_independently_of_timezone() {
        let expression = "new Date(Date.UTC(2026, 6, 22))";
        let utc = inspect_in_node(expression, Some("UTC"));
        let bratislava = inspect_in_node(expression, Some("Europe/Bratislava"));
        assert_ne!(utc.get("description"), bratislava.get("description"));
        for remote in [&utc, &bratislava] {
            let preview = remote
                .get("preview")
                .and_then(Value::as_object)
                .expect("date preview");
            assert!(deterministic_date_description(remote, preview).is_none());
        }
        assert!(is_exact_iso_date("2026-07-22T00:00:00.000Z"));
        assert!(!is_exact_iso_date("2026-02-29T00:00:00.000Z"));
    }

    #[test]
    fn strict_shape_helpers_reject_malformed_lengths_and_accessors() {
        assert_eq!(
            exact_array_length(&serde_json::json!({"type":"number", "value":3})),
            Some(3)
        );
        for remote in [
            serde_json::json!({"type":"number", "value":-1}),
            serde_json::json!({"type":"number", "value":1.5}),
            serde_json::json!({"type":"string", "value":"3"}),
            serde_json::json!({"type":"number", "value":u32::MAX}),
        ] {
            assert_eq!(exact_array_length(&remote), None);
        }
        assert!(property_kind(&serde_json::json!({
            "name":"x", "get":{"type":"function", "description":"get x() {}"},
            "set":{"type":"undefined"}
        }))
        .is_ok());
        assert!(property_kind(&serde_json::json!({
            "name":"x", "value":{"type":"number", "value":1},
            "get":{"type":"undefined"}, "set":{"type":"undefined"}
        }))
        .is_err());
    }

    #[test]
    fn only_ordinary_watch_objects_receive_mutable_root_provenance() {
        let ordinary = serde_json::json!({"type":"object", "objectId":"watch-object"});
        assert_eq!(
            watch_root_mutation(DebugEvaluateContext::Watch, &ordinary),
            ObjectReferenceMutation::ObjectProperty {
                object_id: "watch-object".to_string()
            }
        );
        for context in [DebugEvaluateContext::Repl, DebugEvaluateContext::Clipboard] {
            assert_eq!(
                watch_root_mutation(context, &ordinary),
                ObjectReferenceMutation::ReadOnly
            );
        }
        for unsupported in [
            serde_json::json!({"type":"object", "subtype":"proxy", "objectId":"proxy"}),
            serde_json::json!({"type":"object", "subtype":"internal#entry", "objectId":"internal"}),
            serde_json::json!({"type":"object"}),
            serde_json::json!({"type":"number", "objectId":"invalid"}),
        ] {
            assert_eq!(
                watch_root_mutation(DebugEvaluateContext::Watch, &unsupported),
                ObjectReferenceMutation::ReadOnly
            );
        }
    }

    #[test]
    fn real_node_engine_timeout_terminates_runaway_call_frame_evaluation() {
        let timeout = clipboard_timeout_ms(Duration::from_millis(125));
        assert_eq!(timeout, 63);
        let script = format!(
            r#"const inspector = require("node:inspector");
const session = new inspector.Session();
session.connect();
session.on("Debugger.paused", (message) => {{
  session.post("Debugger.evaluateOnCallFrame", {{
    callFrameId: message.params.callFrames[0].callFrameId,
    expression: "while (true) {{}}",
    timeout: {timeout}
  }}, (error) => {{
    process.stdout.write(error && /terminated|timed out/i.test(error.message) ? "terminated" : "failed");
    session.post("Debugger.resume", () => session.disconnect());
  }});
}});
session.post("Debugger.enable", () => {{ debugger; }});"#
        );
        let output = Command::new("node")
            .args(["-e", &script])
            .output()
            .expect("Node.js is required for the inspector timeout test");
        assert!(
            output.status.success(),
            "Node inspector timeout failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8(output.stdout).unwrap(), "terminated");
    }
}
