//! Curated Codex legacy model ids from the public T3 catalog, parsed fail-closed and bounded.
use crate::claude_model_manifest_domain::MAX_MANIFEST_BYTES;
use crate::codex_model_catalog_domain::{
    is_valid_model_id, CodexCatalogModel, CodexModelStatus, MAX_MODEL_ID_BYTES,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_CURATED_MODELS: usize = 128;
pub const MAX_CURATED_JSON_BYTES: usize = MAX_CURATED_MODELS * (MAX_MODEL_ID_BYTES + 3) + 2;
const MANIFEST_VERSION: u32 = 1;
const ERROR: &str = "Unsupported curated Codex model statuses.";

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "Vec<String>", into = "Vec<String>")]
pub struct CuratedCodexStatuses {
    legacy: BTreeSet<String>,
}

impl CuratedCodexStatuses {
    pub fn apply(&self, models: &mut [CodexCatalogModel]) {
        for model in models
            .iter_mut()
            .filter(|model| !model.is_default && self.legacy.contains(&model.id))
        {
            model.status = CodexModelStatus::Legacy;
        }
    }
}

impl TryFrom<Vec<String>> for CuratedCodexStatuses {
    type Error = String;

    fn try_from(ids: Vec<String>) -> Result<Self, String> {
        if ids.len() > MAX_CURATED_MODELS || ids.iter().any(|id| !is_valid_model_id(id)) {
            return Err(ERROR.into());
        }
        let count = ids.len();
        let legacy: BTreeSet<String> = ids.into_iter().collect();
        if legacy.len() != count {
            return Err(ERROR.into());
        }
        Ok(Self { legacy })
    }
}

impl From<CuratedCodexStatuses> for Vec<String> {
    fn from(statuses: CuratedCodexStatuses) -> Self {
        statuses.legacy.into_iter().collect()
    }
}

#[derive(Deserialize)]
struct Envelope {
    version: u32,
    providers: Providers,
}

#[derive(Deserialize)]
struct Providers {
    codex: Provider,
}

#[derive(Deserialize)]
struct Provider {
    models: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    slug: String,
    status: Status,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Current,
    Legacy,
}

fn distinct_valid_slugs(models: &[Model]) -> bool {
    let mut slugs = BTreeSet::new();
    models
        .iter()
        .all(|model| is_valid_model_id(&model.slug) && slugs.insert(model.slug.as_str()))
}

pub fn parse_t3_codex_statuses(bytes: &[u8]) -> Result<CuratedCodexStatuses, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(ERROR.into());
    }
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| ERROR)?;
    let models = envelope.providers.codex.models;
    if envelope.version != MANIFEST_VERSION
        || models.is_empty()
        || models.len() > MAX_CURATED_MODELS
        || !distinct_valid_slugs(&models)
    {
        return Err(ERROR.into());
    }
    let legacy = models
        .into_iter()
        .filter(|model| model.status == Status::Legacy)
        .map(|model| model.slug)
        .collect();
    Ok(CuratedCodexStatuses { legacy })
}

#[cfg(test)]
#[path = "codex_curated_model_status_tests.rs"]
mod tests;
