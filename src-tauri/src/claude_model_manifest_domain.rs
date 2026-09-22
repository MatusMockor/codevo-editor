//! Pure, bounded wire-contract validation for the remotely distributed Claude catalog.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const EFFORTS: &[&str] = &[
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultracode",
    "ultrathink",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeModelManifest {
    pub version: u32,
    pub updated_at: String,
    pub claude_code: Vec<ClaudeModel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeModel {
    pub choice: String,
    pub label: String,
    pub runtime_ids: Vec<String>,
    pub description: String,
    pub status: ModelStatus,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_version: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_version_exclusive: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub is_default: Option<bool>,
    pub efforts: Vec<String>,
    pub default_effort: String,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub effort_map: Option<BTreeMap<String, Option<String>>>,
    pub context_windows: Vec<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub default_context: Option<String>,
    pub fast_mode: bool,
    pub thinking_mode: bool,
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
fn deserialize_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelStatus {
    Current,
    Legacy,
}

impl ClaudeModelManifest {
    pub fn resolve_model(&self, choice: &str) -> Option<&ClaudeModel> {
        if choice == "default" {
            return self
                .claude_code
                .iter()
                .find(|model| model.is_default == Some(true));
        }
        self.claude_code.iter().find(|model| {
            model.choice == choice
                || (["fable", "opus", "sonnet"].contains(&choice)
                    && model.runtime_ids.iter().any(|id| id == choice))
        })
    }
}
fn valid_choice(value: &str) -> bool {
    value.strip_prefix("claude-").is_some_and(|suffix| {
        suffix.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
    })
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= max
        && !value.chars().any(char::is_control)
}
fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.split(['-', '.']).all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
pub fn parse_version(value: &str) -> Option<[u32; 3]> {
    if value.len() > 32 {
        return None;
    }
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut version = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        version[index] = part.parse().ok()?;
        if version[index] > 999_999 {
            return None;
        }
    }
    Some(version)
}
fn timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| [4, 7, 10, 13, 16, 19].contains(&i) || c.is_ascii_digit())
    {
        return false;
    }
    let number = |start, end| value[start..end].parse::<u32>().unwrap_or(0);
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    year >= 2020
        && day >= 1
        && day <= days
        && number(11, 13) < 24
        && number(14, 16) < 60
        && number(17, 19) < 60
}
fn unique(values: &[String]) -> bool {
    values.iter().collect::<HashSet<_>>().len() == values.len()
}
pub fn parse_manifest(bytes: &[u8]) -> Result<ClaudeModelManifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Claude catalog exceeds size limit.".into());
    }
    let catalog: ClaudeModelManifest =
        serde_json::from_slice(bytes).map_err(|_| "Invalid Claude catalog format.")?;
    if catalog.version != 1
        || !timestamp(&catalog.updated_at)
        || catalog.claude_code.is_empty()
        || catalog.claude_code.len() > 128
    {
        return Err("Unsupported Claude catalog envelope.".into());
    }
    let mut choices = HashSet::new();
    let mut aliases = HashSet::new();
    let mut defaults = 0;
    for model in &catalog.claude_code {
        if !safe_id(&model.choice)
            || !valid_choice(&model.choice)
            || !choices.insert(&model.choice)
            || !bounded_text(&model.label, 128)
            || !bounded_text(&model.description, 1024)
            || model.runtime_ids.is_empty()
            || model.runtime_ids.len() > 16
            || !unique(&model.runtime_ids)
            || !model.runtime_ids.contains(&model.choice)
            || model
                .runtime_ids
                .iter()
                .any(|id| !safe_id(id) || !aliases.insert(id))
            || model.efforts.len() > EFFORTS.len()
            || !unique(&model.efforts)
            || model
                .efforts
                .iter()
                .any(|value| !EFFORTS.contains(&value.as_str()))
            || (if model.efforts.is_empty() {
                model.default_effort != "default"
            } else {
                !model.efforts.contains(&model.default_effort)
            })
            || model.effort_map.as_ref().is_some_and(|mapping| {
                mapping.iter().any(|(source, target)| {
                    !model.efforts.contains(source)
                        || match (source.as_str(), target.as_deref()) {
                            ("ultrathink", None) | ("ultracode", Some("xhigh")) => false,
                            ("ultrathink" | "ultracode", _) | (_, None) => true,
                            (_, Some(value)) => {
                                !["low", "medium", "high", "xhigh", "max"].contains(&value)
                            }
                        }
                })
            })
            || model.context_windows.len() > 2
            || !unique(&model.context_windows)
            || model
                .context_windows
                .iter()
                .any(|value| !["200k", "1m"].contains(&value.as_str()))
            || (match &model.default_context {
                Some(value) => !model.context_windows.contains(value),
                None => !model.context_windows.is_empty(),
            })
        {
            return Err("Invalid Claude model definition.".into());
        }
        let min = model.min_version.as_deref().map(parse_version);
        let max = model.max_version_exclusive.as_deref().map(parse_version);
        if min == Some(None)
            || max == Some(None)
            || matches!((min, max), (Some(Some(a)), Some(Some(b))) if a >= b)
        {
            return Err("Invalid Claude version range.".into());
        }
        if model.is_default == Some(true) {
            defaults += 1;
        }
    }
    if defaults != 1 {
        return Err("Claude catalog must have one default model.".into());
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    const BUNDLE: &[u8] = include_bytes!("../../src/domain/claudeModelManifest.json");
    #[test]
    fn bundled_contract_is_valid() {
        assert!(parse_manifest(BUNDLE).is_ok());
    }
    #[test]
    fn rejects_unknown_fields_and_unsafe_models() {
        for (field, value) in [
            ("choice", serde_json::json!("--help")),
            ("efforts", serde_json::json!(["execute"])),
            ("minVersion", serde_json::json!("2.01.3")),
            ("surprise", serde_json::json!(true)),
        ] {
            let mut data: serde_json::Value = serde_json::from_slice(BUNDLE).unwrap();
            data["claudeCode"][0][field] = value;
            assert!(parse_manifest(&serde_json::to_vec(&data).unwrap()).is_err());
        }
    }
    #[test]
    fn validates_closed_effort_mapping() {
        let mut data: serde_json::Value = serde_json::from_slice(BUNDLE).unwrap();
        data["claudeCode"][0]["efforts"] =
            serde_json::json!(["xhigh", "max", "ultracode", "ultrathink"]);
        data["claudeCode"][0]["defaultEffort"] = serde_json::json!("xhigh");
        data["claudeCode"][0]["effortMap"] = serde_json::json!({"xhigh": "max", "max": "high", "ultracode": "xhigh", "ultrathink": null});
        assert!(parse_manifest(&serde_json::to_vec(&data).unwrap()).is_ok());
        for mapping in [
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({"default":"high"}),
            serde_json::json!({"xhigh":"--help"}),
            serde_json::json!({"xhigh":null}),
            serde_json::json!({"ultracode":"max"}),
            serde_json::json!({"ultrathink":"high"}),
            serde_json::json!({"high":"high"}),
        ] {
            data["claudeCode"][0]["effortMap"] = mapping;
            assert!(parse_manifest(&serde_json::to_vec(&data).unwrap()).is_err());
        }
    }

    #[test]
    fn rejects_bad_envelopes_and_limits() {
        assert!(parse_manifest(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
        assert!(!timestamp("2026-02-30T00:00:00Z"));
        assert!(!timestamp("2026-09-22T25:00:00Z"));
        assert!(timestamp("2024-02-29T00:00:00Z"));
    }
}
