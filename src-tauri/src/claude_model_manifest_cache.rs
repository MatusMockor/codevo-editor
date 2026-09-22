//! Bounded, atomic last-good cache with restart-stable freshness.
use crate::claude_model_manifest_domain::{
    parse_manifest, ClaudeModelManifest, MAX_MANIFEST_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const MAX_CACHE_BYTES: usize = MAX_MANIFEST_BYTES + 256;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CachedManifest {
    fetched_at_epoch_ms: u64,
    pub manifest: ClaudeModelManifest,
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
pub(super) fn write(path: &Path, catalog: &ClaudeModelManifest) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(&CachedManifest {
        fetched_at_epoch_ms: epoch_ms(),
        manifest: catalog.clone(),
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
#[cfg(test)]
mod tests {
    use super::*;
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
        write(&path, &bundle).unwrap();
        assert_eq!(read(&path).unwrap().manifest.updated_at, bundle.updated_at);
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
        };
        assert_eq!(
            cache.remaining_ttl(1500, Duration::from_secs(1)),
            Some(Duration::from_millis(500))
        );
        assert_eq!(cache.remaining_ttl(2000, Duration::from_secs(1)), None);
        assert_eq!(cache.remaining_ttl(999, Duration::from_secs(1)), None);
    }
}
