//! Pure adapter from the public T3 catalog to Codevo's closed executable catalog.
#[path = "claude_model_manifest_t3_wire.rs"]
mod wire;
use crate::claude_model_manifest_domain::{
    parse_manifest, ClaudeModelManifest, MAX_MANIFEST_BYTES,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use wire::{Envelope, Profile};
const ERROR: &str = "Unsupported T3 Claude model manifest.";
const EFFORTS: &[&str] = &[
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultracode",
    "ultrathink",
];

// Apply limits before typed conversion, including optional display metadata.
fn bounded(value: &Value, depth: usize) -> bool {
    if depth > 12 {
        return false;
    }
    match value {
        Value::String(s) => s.len() <= 1024 && !s.chars().any(char::is_control),
        Value::Array(items) => items.len() <= 128 && items.iter().all(|v| bounded(v, depth + 1)),
        Value::Object(items) => {
            items.len() <= 128
                && items
                    .iter()
                    .all(|(k, v)| k.len() <= 128 && bounded(v, depth + 1))
        }
        _ => true,
    }
}
fn text(s: &str, limit: usize) -> bool {
    !s.is_empty() && s.trim() == s && s.len() <= limit && !s.chars().any(char::is_control)
}
fn profile_options(profile: &Profile) -> Result<Value, String> {
    let mut efforts = Vec::new();
    let mut default_effort = "default".to_owned();
    let mut contexts = Vec::new();
    let mut default_context = None;
    let mut fast_mode = false;
    let mut thinking_mode = false;
    let mut seen = HashSet::new();
    let mut prompt_injected = Vec::new();
    for descriptor in &profile.capabilities.option_descriptors {
        if !seen.insert(&descriptor.id) || !text(&descriptor.label, 128) {
            return Err(ERROR.into());
        }
        match descriptor.id.as_str() {
            "effort" | "contextWindow" => {
                if descriptor.kind != "select" {
                    return Err(ERROR.into());
                }
                let options = descriptor.options.as_ref().ok_or(ERROR)?;
                let allowed = if descriptor.id == "effort" {
                    EFFORTS
                } else {
                    &["200k", "1m"]
                };
                if options.is_empty() || options.len() > allowed.len() {
                    return Err(ERROR.into());
                }
                let mut ids = HashSet::new();
                let mut defaults = Vec::new();
                for option in options {
                    if !allowed.contains(&option.id.as_str())
                        || !ids.insert(&option.id)
                        || !text(&option.label, 128)
                        || option.description.as_ref().is_some_and(|s| !text(s, 1024))
                    {
                        return Err(ERROR.into());
                    }
                    if option.is_default == Some(true) {
                        defaults.push(option.id.clone());
                    }
                }
                if defaults.len() != 1 {
                    return Err(ERROR.into());
                }
                let values: Vec<_> = options.iter().map(|o| o.id.clone()).collect();
                if descriptor.id == "effort" {
                    efforts = values;
                    default_effort = defaults.remove(0);
                    prompt_injected = descriptor
                        .prompt_injected_values
                        .clone()
                        .unwrap_or_default();
                } else {
                    if descriptor.prompt_injected_values.is_some() {
                        return Err(ERROR.into());
                    }
                    contexts = values;
                    default_context = defaults.pop();
                }
            }
            "fastMode" | "thinking" => {
                if descriptor.kind != "boolean"
                    || descriptor.options.is_some()
                    || descriptor.prompt_injected_values.is_some()
                {
                    return Err(ERROR.into());
                }
                fast_mode |= descriptor.id == "fastMode";
                thinking_mode |= descriptor.id == "thinking";
            }
            _ => return Err(ERROR.into()),
        }
    }
    if thinking_mode && !efforts.is_empty() {
        return Err(ERROR.into());
    }
    let adapter = &profile.adapter.claude_code;
    let effort_map = adapter.effort_map.clone().unwrap_or_default();
    for (source, target) in &effort_map {
        if !efforts.contains(source)
            || match source.as_str() {
                "ultracode" => target.as_deref() != Some("xhigh"),
                "ultrathink" => target.is_some(),
                _ => !target
                    .as_deref()
                    .is_some_and(|s| ["low", "medium", "high", "xhigh", "max"].contains(&s)),
            }
        {
            return Err(ERROR.into());
        }
    }
    for special in ["ultracode", "ultrathink"] {
        if efforts.iter().any(|e| e == special) && !effort_map.contains_key(special) {
            return Err(ERROR.into());
        }
    }
    let expected_prompt: Vec<String> = if efforts.iter().any(|e| e == "ultrathink") {
        vec!["ultrathink".into()]
    } else {
        vec![]
    };
    if prompt_injected != expected_prompt {
        return Err(ERROR.into());
    }
    if contexts.is_empty() {
        if adapter.model_suffixes.is_some()
            || adapter.context_window_tokens.is_some()
            || adapter
                .fixed_context_window_tokens
                .is_some_and(|n| ![200_000, 1_000_000].contains(&n))
        {
            return Err(ERROR.into());
        }
    } else {
        if adapter.fixed_context_window_tokens.is_some() {
            return Err(ERROR.into());
        }
        let expected_tokens: serde_json::Map<String, Value> = contexts
            .iter()
            .map(|c| {
                (
                    c.clone(),
                    json!(if c == "1m" { 1_000_000 } else { 200_000 }),
                )
            })
            .collect();
        if serde_json::to_value(&adapter.context_window_tokens).map_err(|_| ERROR)?
            != Value::Object(expected_tokens)
        {
            return Err(ERROR.into());
        }
        let expected_suffixes = if contexts.iter().any(|c| c == "1m") {
            json!({"contextWindow": {"1m": "[1m]"}})
        } else {
            json!({})
        };
        if serde_json::to_value(&adapter.model_suffixes).map_err(|_| ERROR)? != expected_suffixes {
            return Err(ERROR.into());
        }
    }
    Ok(
        json!({"efforts": efforts, "defaultEffort": default_effort, "contextWindows": contexts,
        "defaultContext": default_context, "fastMode": fast_mode, "thinkingMode": thinking_mode, "effortMap": effort_map}),
    )
}

pub fn parse_t3_manifest(bytes: &[u8]) -> Result<ClaudeModelManifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(ERROR.into());
    }
    let raw: Value = serde_json::from_slice(bytes).map_err(|_| ERROR)?;
    if !bounded(&raw["providers"]["claudeAgent"], 0) {
        return Err(ERROR.into());
    }
    let envelope: Envelope = serde_json::from_value(raw).map_err(|_| ERROR)?;
    let provider = envelope.providers.claude_agent;
    if envelope.version != 1
        || provider.models.is_empty()
        || provider.models.len() > 128
        || provider.profiles.is_empty()
        || provider.profiles.len() > 128
    {
        return Err(ERROR.into());
    }
    let mut profiles = std::collections::BTreeMap::new();
    for (name, profile) in &provider.profiles {
        if !text(name, 96) {
            return Err(ERROR.into());
        }
        profiles.insert(name, profile_options(profile)?);
    }
    let mut models = Vec::new();
    for model in provider.models {
        if model.badge.as_deref().is_some_and(|badge| badge != "new") {
            return Err(ERROR.into());
        }
        let mut converted = profiles.get(&model.profile).ok_or(ERROR)?.clone();
        let object = converted.as_object_mut().ok_or(ERROR)?;
        let mut aliases = vec![model.slug.clone()];
        aliases.extend(model.aliases.unwrap_or_default());
        object.insert("choice".into(), json!(model.slug));
        object.insert("label".into(), json!(model.name));
        object.insert(
            "description".into(),
            json!(format!("{} model.", model.name)),
        );
        object.insert("runtimeIds".into(), json!(aliases));
        object.insert("status".into(), json!(model.status));
        object.insert(
            "isDefault".into(),
            json!(model.slug == provider.defaults.chat),
        );
        if let Some(adapter) = model.adapter {
            if let Some(min) = adapter.claude_code.min_version {
                object.insert("minVersion".into(), json!(min));
            }
            if let Some(max) = adapter.claude_code.max_version_exclusive {
                object.insert("maxVersionExclusive".into(), json!(max));
            }
        }
        models.push(converted);
    }
    let result = json!({"version": 1, "updatedAt": envelope.updated_at, "claudeCode": models});
    parse_manifest(&serde_json::to_vec(&result).map_err(|_| ERROR)?)
}
#[cfg(test)]
#[path = "claude_model_manifest_t3_tests.rs"]
mod tests;
