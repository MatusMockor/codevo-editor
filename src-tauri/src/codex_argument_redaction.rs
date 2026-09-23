use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

pub(super) const SECRET_SEGMENT_MARKERS: &[&str] = &[
    "auth",
    "authorization",
    "bearer",
    "cookie",
    "credential",
    "credentials",
    "dsn",
    "jwt",
    "passphrase",
    "passwd",
    "password",
    "pwd",
    "secret",
    "token",
];
pub(super) const SECRET_SUFFIX_MARKERS: &[&str] = &[
    "accesskey",
    "accesstoken",
    "apikey",
    "authtoken",
    "clientsecret",
    "connectionstring",
    "privatekey",
    "refreshtoken",
    "secretkey",
    "sessionid",
];
pub(super) const MAX_REDACTION_DEPTH: usize = 8;
pub(super) const MAX_REDACTION_NODES: usize = 256;
pub(super) const MAX_REDACTION_STRING_BYTES: usize = 1_024;

const REDACTED: &str = "[redacted]";
const OMITTED: &str = "\u{2026}";
const NAME_KEYS: &[&str] = &["name", "key", "header"];
const VALUE_KEY: &str = "value";

static URL_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([a-z][a-z0-9+.\-]*://[^\s:/@]*):[^\s@/]*@").expect("static regex")
});
static AUTH_SCHEME_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{8,}").expect("static regex")
});

#[derive(Debug, Clone, PartialEq)]
pub(super) struct RedactedArguments {
    pub value: Value,
    pub exhausted: bool,
}

pub(super) fn redact_arguments(value: &Value) -> RedactedArguments {
    let mut budget = MAX_REDACTION_NODES;
    let value = redact_value(value, 0, &mut budget);
    RedactedArguments {
        value,
        exhausted: budget == 0,
    }
}

fn redact_value(value: &Value, depth: usize, budget: &mut usize) -> Value {
    if *budget == 0 || depth >= MAX_REDACTION_DEPTH {
        return Value::String(OMITTED.to_string());
    }
    *budget -= 1;
    match value {
        Value::Object(entries) => Value::Object(redact_object(entries, depth, budget)),
        Value::Array(entries) => Value::Array(redact_array(entries, depth, budget)),
        Value::String(text) => Value::String(mask_secrets(text)),
        scalar => scalar.clone(),
    }
}

fn redact_array(entries: &[Value], depth: usize, budget: &mut usize) -> Vec<Value> {
    let mut redacted = Vec::new();
    for entry in entries {
        if *budget == 0 {
            redacted.push(Value::String(OMITTED.to_string()));
            break;
        }
        redacted.push(redact_value(entry, depth + 1, budget));
    }
    redacted
}

fn redact_object(
    entries: &Map<String, Value>,
    depth: usize,
    budget: &mut usize,
) -> Map<String, Value> {
    let secret_pair = names_a_secret(entries);
    let mut redacted = Map::new();
    for (key, entry) in entries {
        if *budget == 0 {
            redacted.insert(OMITTED.to_string(), Value::String(OMITTED.to_string()));
            break;
        }
        if is_secret_key(key) || (secret_pair && key_segments(key).concat() == VALUE_KEY) {
            redacted.insert(key.clone(), Value::String(REDACTED.to_string()));
            continue;
        }
        redacted.insert(key.clone(), redact_value(entry, depth + 1, budget));
    }
    redacted
}

fn names_a_secret(entries: &Map<String, Value>) -> bool {
    entries.iter().any(|(key, entry)| {
        NAME_KEYS.contains(&key_segments(key).concat().as_str())
            && entry.as_str().is_some_and(is_secret_key)
    })
}

pub(super) fn key_segments(key: &str) -> Vec<String> {
    let characters = key.chars().collect::<Vec<_>>();
    let mut segments = Vec::new();
    let mut current = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if !character.is_alphanumeric() {
            flush_segment(&mut segments, &mut current);
            continue;
        }
        if starts_segment(&characters, index) && !current.is_empty() {
            flush_segment(&mut segments, &mut current);
        }
        current.extend(character.to_lowercase());
    }
    flush_segment(&mut segments, &mut current);
    segments
}

fn starts_segment(characters: &[char], index: usize) -> bool {
    let character = characters[index];
    if !character.is_ascii_uppercase() || index == 0 {
        return false;
    }
    let previous = characters[index - 1];
    if previous.is_ascii_lowercase() || previous.is_ascii_digit() {
        return true;
    }
    previous.is_ascii_uppercase()
        && characters
            .get(index + 1)
            .is_some_and(char::is_ascii_lowercase)
}

fn flush_segment(segments: &mut Vec<String>, current: &mut String) {
    if current.is_empty() {
        return;
    }
    segments.push(std::mem::take(current));
}

pub(super) fn is_secret_key(key: &str) -> bool {
    let segments = key_segments(key);
    let Some(last) = segments.last() else {
        return false;
    };
    if SECRET_SEGMENT_MARKERS.contains(&last.as_str()) {
        return true;
    }
    let joined = segments.concat();
    SECRET_SUFFIX_MARKERS
        .iter()
        .any(|marker| joined.ends_with(marker))
}

fn mask_secrets(text: &str) -> String {
    let bounded = bounded_string(text);
    let without_urls = URL_CREDENTIALS.replace_all(bounded.as_str(), "${1}:[redacted]@");
    AUTH_SCHEME_TOKEN
        .replace_all(without_urls.as_ref(), "${1} [redacted]")
        .into_owned()
}

fn bounded_string(text: &str) -> String {
    if text.len() <= MAX_REDACTION_STRING_BYTES {
        return text.to_string();
    }
    let mut end = MAX_REDACTION_STRING_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{OMITTED}", &text[..end])
}
