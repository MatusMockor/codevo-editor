//! Strict wire types for the subset of T3 metadata Codevo can execute.
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Envelope {
    pub version: u32,
    pub updated_at: String,
    pub providers: Providers,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Providers {
    pub claude_agent: Provider,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Provider {
    pub defaults: Defaults,
    pub profiles: BTreeMap<String, Profile>,
    pub models: Vec<Model>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Defaults {
    pub chat: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Profile {
    pub capabilities: Capabilities,
    pub adapter: Adapter,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Capabilities {
    pub option_descriptors: Vec<Descriptor>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Descriptor {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, deserialize_with = "present")]
    pub options: Option<Vec<SelectOption>>,
    #[serde(default, deserialize_with = "present")]
    pub prompt_injected_values: Option<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SelectOption {
    pub id: String,
    pub label: String,
    #[serde(default, deserialize_with = "present")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub is_default: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Adapter {
    pub claude_code: ClaudeAdapter,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ClaudeAdapter {
    #[serde(default, deserialize_with = "present")]
    pub effort_map: Option<BTreeMap<String, Option<String>>>,
    #[serde(default, deserialize_with = "present")]
    pub model_suffixes: Option<BTreeMap<String, BTreeMap<String, String>>>,
    #[serde(default, deserialize_with = "present")]
    pub context_window_tokens: Option<BTreeMap<String, u32>>,
    #[serde(default, deserialize_with = "present")]
    pub fixed_context_window_tokens: Option<u32>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Model {
    pub slug: String,
    pub name: String,
    #[serde(default, deserialize_with = "present")]
    pub aliases: Option<Vec<String>>,
    pub status: String,
    #[serde(default, deserialize_with = "present")]
    pub badge: Option<String>,
    pub profile: String,
    #[serde(default, deserialize_with = "present")]
    pub adapter: Option<ModelAdapter>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ModelAdapter {
    pub claude_code: VersionRange,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct VersionRange {
    #[serde(default, deserialize_with = "present")]
    pub min_version: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub max_version_exclusive: Option<String>,
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
