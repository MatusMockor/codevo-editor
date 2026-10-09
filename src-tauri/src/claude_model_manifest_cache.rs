//! Bounded, atomic last-good cache with restart-stable freshness.
use crate::claude_model_manifest_domain::{
    parse_manifest, ClaudeModelManifest, MAX_MANIFEST_BYTES,
};
use crate::codex_curated_model_status::{CuratedCodexStatuses, MAX_CURATED_JSON_BYTES};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const MAX_CACHE_BYTES: usize = MAX_MANIFEST_BYTES + MAX_CURATED_JSON_BYTES + 256;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CachedManifest {
    fetched_at_epoch_ms: u64,
    pub manifest: ClaudeModelManifest,
    pub codex_legacy_models: CuratedCodexStatuses,
}
impl CachedManifest {
    pub fn remaining_ttl(&self, now: u64, ttl: Duration) -> Option<Duration> {
        let age = now.checked_sub(self.fetched_at_epoch_ms)?;
        ttl.checked_sub(Duration::from_millis(age))
            .filter(|remaining| !remaining.is_zero())
    }
}
pub(super) fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
pub(super) fn read(path: &Path) -> Result<CachedManifest, String> {
    let file = std::fs::File::open(path).map_err(|_| "Claude catalog cache unavailable.")?;
    let mut bytes = Vec::new();
    file.take(MAX_CACHE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Claude catalog cache unreadable.")?;
    if bytes.len() > MAX_CACHE_BYTES {
        return Err("Claude catalog cache exceeds size limit.".into());
    }
    let cached: CachedManifest =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Claude catalog cache.")?;
    parse_manifest(
        &serde_json::to_vec(&cached.manifest).map_err(|_| "Invalid Claude catalog cache.")?,
    )?;
    Ok(cached)
}
struct OwnedTemporary(std::path::PathBuf);
impl Drop for OwnedTemporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
pub(super) fn write(
    path: &Path,
    catalog: &ClaudeModelManifest,
    codex_legacy_models: &CuratedCodexStatuses,
) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(&CachedManifest {
        fetched_at_epoch_ms: epoch_ms(),
        manifest: catalog.clone(),
        codex_legacy_models: codex_legacy_models.clone(),
    })?;
    if bytes.len() > MAX_CACHE_BYTES {
        return Err(std::io::Error::other("Claude catalog cache exceeds limit."));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let owned = OwnedTemporary(temporary);
    file.write_all(&bytes)?;
    file.sync_all()?;
    std::fs::rename(&owned.0, path)
}
pub(super) fn remove_retired(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_dir())
        && std::fs::remove_file(path).is_ok()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_a_retired_cache_file_once_and_never_a_directory() {
        let dir = std::env::temp_dir().join(format!(
            "codevo-manifest-retired-{}-{}",
            std::process::id(),
            epoch_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let retired = dir.join("claude-model-manifest-t3-v1.json");
        std::fs::write(&retired, b"{}").unwrap();
        assert!(remove_retired(&retired));
        assert!(!retired.exists());
        assert!(!remove_retired(&retired));
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(!remove_retired(&nested));
        assert!(nested.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn cache_roundtrip_corruption_and_size_bound() {
        let dir = std::env::temp_dir().join(format!(
            "codevo-manifest-cache-{}-{}",
            std::process::id(),
            epoch_ms()
        ));
        let path = dir.join("manifest.json");
        let bundle =
            parse_manifest(include_bytes!("../../src/domain/claudeModelManifest.json")).unwrap();
        let statuses =
            CuratedCodexStatuses::try_from(vec!["gpt-5.5".to_string(), "gpt-6-sol".to_string()])
                .unwrap();
        write(&path, &bundle, &statuses).unwrap();
        let cached = read(&path).unwrap();
        assert_eq!(cached.manifest.updated_at, bundle.updated_at);
        assert_eq!(cached.codex_legacy_models, statuses);
        let mut stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            stored["codexLegacyModels"],
            serde_json::json!(["gpt-5.5", "gpt-6-sol"])
        );
        stored["codexLegacyModels"] = serde_json::json!(["GPT 6 --sol"]);
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read(&path).is_err());
        stored.as_object_mut().unwrap().remove("codexLegacyModels");
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read(&path).is_err());
        std::fs::write(&path, b"{broken").unwrap();
        assert!(read(&path).is_err());
        std::fs::write(&path, vec![b' '; MAX_CACHE_BYTES + 1]).unwrap();
        assert!(read(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn freshness_handles_recent_expired_and_future_timestamps() {
        let cache = CachedManifest {
            fetched_at_epoch_ms: 1000,
            manifest: parse_manifest(include_bytes!("../../src/domain/claudeModelManifest.json"))
                .unwrap(),
            codex_legacy_models: CuratedCodexStatuses::default(),
        };
        assert_eq!(
            cache.remaining_ttl(1500, Duration::from_secs(1)),
            Some(Duration::from_millis(500))
        );
        assert_eq!(cache.remaining_ttl(2000, Duration::from_secs(1)), None);
        assert_eq!(cache.remaining_ttl(999, Duration::from_secs(1)), None);
    }
}
