use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use crate::claude_model_manifest_domain::is_release_date;

pub const MAX_MODEL_LIST_BYTES: usize = 256 * 1024;
pub const MAX_UPSTREAM_MODELS: usize = 128;
pub const MAX_CATALOG_MODELS: usize = 64;
pub const MAX_MODEL_ID_BYTES: usize = 64;
const MAX_LABEL_BYTES: usize = 128;
const MAX_DESCRIPTION_BYTES: usize = 1024;
const MODEL_LIST_RESPONSE_ID: u64 = 1;
const CATALOG_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

impl CodexEffort {
    fn from_upstream(value: &str) -> Option<Self> {
        Some(match value {
            "none" => Self::None,
            "minimal" => Self::Minimal,
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            "xhigh" => Self::Xhigh,
            "max" => Self::Max,
            "ultra" => Self::Ultra,
            _ => return Option::None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexCatalogSource {
    Live,
    Bundled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexModelStatus {
    Current,
    Legacy,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexModelCatalog {
    pub version: u32,
    pub source: CodexCatalogSource,
    pub revision: u64,
    pub models: Vec<CodexCatalogModel>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexCatalogModel {
    pub id: String,
    pub label: String,
    pub description: String,
    pub status: CodexModelStatus,
    pub is_default: bool,
    pub efforts: Vec<CodexEffort>,
    #[serde(deserialize_with = "nullable")]
    pub default_effort: Option<CodexEffort>,
    #[serde(deserialize_with = "nullable")]
    pub upgrade_to: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub release_date: Option<String>,
}

impl CodexCatalogModel {
    pub fn supports(&self, effort: CodexEffort) -> bool {
        self.efforts.contains(&effort)
    }
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub fn is_valid_model_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_MODEL_ID_BYTES
        && value.split(['.', '-']).all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_model(model: &CodexCatalogModel) -> bool {
    is_valid_model_id(&model.id)
        && bounded_text(&model.label, MAX_LABEL_BYTES)
        && bounded_text(&model.description, MAX_DESCRIPTION_BYTES)
        && model.efforts.iter().collect::<HashSet<_>>().len() == model.efforts.len()
        && model
            .default_effort
            .is_none_or(|effort| model.efforts.contains(&effort))
        && model.upgrade_to.as_deref().is_none_or(is_valid_model_id)
        && model.release_date.as_deref().is_none_or(is_release_date)
}

pub fn validate_catalog(catalog: &CodexModelCatalog) -> Result<(), String> {
    let revision_matches = match catalog.source {
        CodexCatalogSource::Bundled => catalog.revision == 0,
        CodexCatalogSource::Live => catalog.revision >= 1,
    };
    if catalog.version != CATALOG_VERSION
        || !revision_matches
        || catalog.models.is_empty()
        || catalog.models.len() > MAX_CATALOG_MODELS
    {
        return Err("Unsupported Codex model catalog envelope.".into());
    }
    let mut ids = HashSet::new();
    if catalog
        .models
        .iter()
        .any(|model| !valid_model(model) || !ids.insert(model.id.as_str()))
    {
        return Err("Invalid Codex model definition.".into());
    }
    if catalog
        .models
        .iter()
        .filter(|model| model.is_default)
        .count()
        != 1
    {
        return Err("Codex model catalog must have one default model.".into());
    }
    Ok(())
}

pub fn parse_catalog(bytes: &[u8]) -> Result<CodexModelCatalog, String> {
    if bytes.len() > MAX_MODEL_LIST_BYTES {
        return Err("Codex model catalog exceeds size limit.".into());
    }
    let catalog: CodexModelCatalog =
        serde_json::from_slice(bytes).map_err(|_| "Invalid Codex model catalog format.")?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexModelListing {
    pub models: Vec<CodexCatalogModel>,
    pub hidden_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveCodexCatalog {
    pub catalog: CodexModelCatalog,
    pub hidden_ids: BTreeSet<String>,
}

impl LiveCodexCatalog {
    pub fn from_listing(listing: CodexModelListing, revision: u64) -> Result<Self, String> {
        let catalog = CodexModelCatalog {
            version: CATALOG_VERSION,
            source: CodexCatalogSource::Live,
            revision,
            models: listing.models,
        };
        validate_catalog(&catalog)?;
        Ok(Self {
            catalog,
            hidden_ids: listing.hidden_ids,
        })
    }

    pub fn lists_same_models(&self, listing: &CodexModelListing) -> bool {
        self.catalog.models == listing.models && self.hidden_ids == listing.hidden_ids
    }
}

#[derive(Clone, Debug)]
pub struct CodexCatalogSnapshot {
    bundled: Arc<CodexModelCatalog>,
    live: Option<Arc<LiveCodexCatalog>>,
}

impl CodexCatalogSnapshot {
    pub fn new(bundled: Arc<CodexModelCatalog>, live: Option<Arc<LiveCodexCatalog>>) -> Self {
        Self { bundled, live }
    }

    pub fn published(&self) -> &CodexModelCatalog {
        self.live
            .as_deref()
            .map_or(self.bundled.as_ref(), |live| &live.catalog)
    }

    pub fn resolve(&self, choice: &str) -> Option<&CodexCatalogModel> {
        let models = &self.published().models;
        if choice == "default" {
            return models.iter().find(|model| model.is_default);
        }
        models.iter().find(|model| model.id == choice)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamModelList {
    data: Vec<UpstreamModel>,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamModel {
    id: String,
    model: String,
    display_name: String,
    description: String,
    #[serde(default)]
    hidden: bool,
    is_default: bool,
    supported_reasoning_efforts: Vec<UpstreamEffort>,
    #[serde(deserialize_with = "nullable")]
    default_reasoning_effort: Option<String>,
    #[serde(default)]
    upgrade_info: Option<UpstreamUpgradeInfo>,
    #[serde(default)]
    upgrade: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamEffort {
    reasoning_effort: String,
}

#[derive(Deserialize)]
struct UpstreamUpgradeInfo {
    model: String,
}

pub fn parse_model_list(stdout: &[u8]) -> Result<CodexModelListing, String> {
    if stdout.len() > MAX_MODEL_LIST_BYTES {
        return Err("Codex model list exceeds size limit.".into());
    }
    let response = model_list_response(stdout)?;
    if response.get("error").is_some() {
        return Err("Codex model list request failed.".into());
    }
    let result = response
        .get("result")
        .ok_or("Codex model list response has no result.")?;
    let list = UpstreamModelList::deserialize(result)
        .map_err(|_| "Codex model list has an invalid format.")?;
    if list.next_cursor.is_some() {
        return Err("Codex model list is incomplete.".into());
    }
    if list.data.len() > MAX_UPSTREAM_MODELS {
        return Err("Codex model list exceeds the model limit.".into());
    }
    adapt_models(list.data)
}

fn model_list_response(stdout: &[u8]) -> Result<serde_json::Value, String> {
    let mut responses = stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<serde_json::Value>(line).ok())
        .filter(|value| {
            value.get("id").and_then(serde_json::Value::as_u64) == Some(MODEL_LIST_RESPONSE_ID)
        });
    let response = responses
        .next()
        .ok_or("Codex model list response is missing.")?;
    if responses.next().is_some() {
        return Err("Codex model list response is ambiguous.".into());
    }
    Ok(response)
}

fn adapt_models(entries: Vec<UpstreamModel>) -> Result<CodexModelListing, String> {
    let mut ids = HashSet::new();
    let mut hidden_ids = BTreeSet::new();
    let mut models = Vec::new();
    for entry in entries {
        if !ids.insert(entry.id.clone()) {
            return Err("Codex model list has duplicate models.".into());
        }
        if entry.hidden {
            if is_valid_model_id(&entry.id) {
                hidden_ids.insert(entry.id);
            }
            continue;
        }
        models.push(adapt_visible_model(entry)?);
    }
    if models.is_empty() || models.len() > MAX_CATALOG_MODELS {
        return Err("Codex model list has no usable models.".into());
    }
    if models.iter().filter(|model| model.is_default).count() != 1 {
        return Err("Codex model list must have one default model.".into());
    }
    Ok(CodexModelListing { models, hidden_ids })
}

fn adapt_visible_model(entry: UpstreamModel) -> Result<CodexCatalogModel, String> {
    if entry.id != entry.model {
        return Err("Codex model list has an aliased model.".into());
    }
    let mut efforts = Vec::new();
    for effort in entry
        .supported_reasoning_efforts
        .iter()
        .filter_map(|effort| CodexEffort::from_upstream(&effort.reasoning_effort))
    {
        if !efforts.contains(&effort) {
            efforts.push(effort);
        }
    }
    let default_effort = entry
        .default_reasoning_effort
        .as_deref()
        .and_then(CodexEffort::from_upstream)
        .filter(|effort| efforts.contains(effort));
    let upgrade_to = entry
        .upgrade_info
        .map(|info| info.model)
        .or(entry.upgrade)
        .filter(|target| *target != entry.id);
    let model = CodexCatalogModel {
        status: match upgrade_to {
            Some(_) => CodexModelStatus::Legacy,
            None => CodexModelStatus::Current,
        },
        id: entry.id,
        label: entry.display_name,
        description: entry.description,
        is_default: entry.is_default,
        efforts,
        default_effort,
        upgrade_to,
        release_date: None,
    };
    if !valid_model(&model) {
        return Err("Codex model list has an invalid model.".into());
    }
    Ok(model)
}

#[cfg(test)]
#[path = "codex_model_catalog_domain_tests.rs"]
mod tests;
