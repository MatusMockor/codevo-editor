//! Per-workspace local file history (PhpStorm-style "Local History").
//!
//! Snapshots of a file's content are captured on save so the user can review,
//! diff, and revert previous versions WITHOUT relying on git. Storage is fully
//! isolated per workspace: every snapshot lives under a directory keyed by a
//! stable hash of the (normalized) workspace root path, so two open project
//! tabs never see each other's history.
//!
//! On-disk layout (under the caller-provided base directory, typically the app
//! config dir):
//!
//! ```text
//! <base>/local-history/<workspaceHash>/<fileHash>/index.json
//! <base>/local-history/<workspaceHash>/<fileHash>/<versionId>.snapshot
//! ```
//!
//! The store is intentionally a pure value over a base directory so it can be
//! unit-tested without a Tauri `AppHandle`; the command layer supplies the app
//! config dir at runtime.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

/// Maximum number of retained snapshots per file. Oldest versions are evicted
/// once this bound is exceeded (LRU by capture time), keeping storage bounded.
pub const MAX_VERSIONS_PER_FILE: usize = 50;

const INDEX_FILE_NAME: &str = "index.json";
const SNAPSHOT_EXTENSION: &str = "snapshot";
const LOCAL_HISTORY_DIR: &str = "local-history";

/// A single retained snapshot of a file's content.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHistoryVersion {
    /// Opaque, sortable identifier of this version (also the snapshot filename
    /// stem). Newest versions have the largest id.
    pub id: String,
    /// Capture time in Unix milliseconds.
    pub timestamp_ms: u64,
    /// Byte length of the captured content.
    pub size_bytes: u64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileHistoryIndex {
    /// Snapshots ordered oldest-first.
    versions: Vec<LocalHistoryVersion>,
    /// Monotonic counter making version ids unique even within the same
    /// millisecond (rapid consecutive saves).
    next_sequence: u64,
}

/// Stores and retrieves local file history under a base directory.
///
/// Cloning is cheap (just the base path); each call resolves per-workspace and
/// per-file directories on demand.
#[derive(Clone, Debug)]
pub struct LocalHistoryStore {
    base_dir: PathBuf,
}

impl LocalHistoryStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    /// Records a snapshot of `content` for the file at `relative_path` inside
    /// `workspace_root`. Returns `Ok(None)` when the content is identical to the
    /// most recent snapshot (dedupe) and nothing was written; otherwise returns
    /// the newly stored version.
    ///
    /// Snapshots beyond [`MAX_VERSIONS_PER_FILE`] are evicted oldest-first.
    pub fn record_snapshot(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<Option<LocalHistoryVersion>, String> {
        let file_dir = self.file_dir(workspace_root, relative_path);
        let mut index = read_index(&file_dir)?;

        if latest_content_matches(&file_dir, &index, content)? {
            return Ok(None);
        }

        fs::create_dir_all(&file_dir).map_err(|error| error.to_string())?;

        let version = LocalHistoryVersion {
            id: next_version_id(&mut index),
            timestamp_ms: now_unix_millis(),
            size_bytes: content.len() as u64,
        };

        let snapshot_path = file_dir.join(format!("{}.{SNAPSHOT_EXTENSION}", version.id));
        fs::write(&snapshot_path, content).map_err(|error| error.to_string())?;

        index.versions.push(version.clone());
        evict_overflow(&file_dir, &mut index);
        write_index(&file_dir, &index)?;

        Ok(Some(version))
    }

    /// Lists retained versions for `relative_path`, newest first. Returns an
    /// empty list when the file has no history yet.
    pub fn list_versions(
        &self,
        workspace_root: &str,
        relative_path: &str,
    ) -> Result<Vec<LocalHistoryVersion>, String> {
        let file_dir = self.file_dir(workspace_root, relative_path);
        let index = read_index(&file_dir)?;

        let mut versions = index.versions;
        versions.reverse();
        Ok(versions)
    }

    /// Reads the stored content of a specific version. Errors when the version
    /// does not exist for this file.
    pub fn read_version(
        &self,
        workspace_root: &str,
        relative_path: &str,
        version_id: &str,
    ) -> Result<String, String> {
        let file_dir = self.file_dir(workspace_root, relative_path);
        let index = read_index(&file_dir)?;

        if !index
            .versions
            .iter()
            .any(|version| version.id == version_id)
        {
            return Err(format!("Unknown local history version: {version_id}"));
        }

        let snapshot_path = file_dir.join(format!("{version_id}.{SNAPSHOT_EXTENSION}"));
        fs::read_to_string(&snapshot_path).map_err(|error| error.to_string())
    }

    fn file_dir(&self, workspace_root: &str, relative_path: &str) -> PathBuf {
        self.base_dir
            .join(LOCAL_HISTORY_DIR)
            .join(format!("{:016x}", stable_hash(&normalize(workspace_root))))
            .join(format!("{:016x}", stable_hash(&normalize(relative_path))))
    }
}

fn latest_content_matches(
    file_dir: &Path,
    index: &FileHistoryIndex,
    content: &str,
) -> Result<bool, String> {
    let Some(latest) = index.versions.last() else {
        return Ok(false);
    };

    if latest.size_bytes != content.len() as u64 {
        return Ok(false);
    }

    let snapshot_path = file_dir.join(format!("{}.{SNAPSHOT_EXTENSION}", latest.id));
    let existing = fs::read_to_string(&snapshot_path).map_err(|error| error.to_string())?;
    Ok(existing == content)
}

fn next_version_id(index: &mut FileHistoryIndex) -> String {
    let sequence = index.next_sequence;
    index.next_sequence += 1;
    // Zero-padded so the id sorts lexicographically in capture order, which is
    // also the snapshot filename order on disk.
    format!("{sequence:012}")
}

fn evict_overflow(file_dir: &Path, index: &mut FileHistoryIndex) {
    while index.versions.len() > MAX_VERSIONS_PER_FILE {
        let evicted = index.versions.remove(0);
        let snapshot_path = file_dir.join(format!("{}.{SNAPSHOT_EXTENSION}", evicted.id));
        // Best-effort: a missing snapshot file must not abort the save flow.
        let _ = fs::remove_file(&snapshot_path);
    }
}

fn read_index(file_dir: &Path) -> Result<FileHistoryIndex, String> {
    let index_path = file_dir.join(INDEX_FILE_NAME);

    if !index_path.exists() {
        return Ok(FileHistoryIndex::default());
    }

    let raw = fs::read_to_string(&index_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_index(file_dir: &Path, index: &FileHistoryIndex) -> Result<(), String> {
    let index_path = file_dir.join(INDEX_FILE_NAME);
    let raw = serde_json::to_string(index).map_err(|error| error.to_string())?;
    fs::write(&index_path, raw).map_err(|error| error.to_string())
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize(value: &str) -> String {
    value.replace('\\', "/")
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_store(label: &str) -> LocalHistoryStore {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!("editor-local-history-{label}-{nanos}"));
        fs::create_dir_all(&base).expect("temp base dir");
        LocalHistoryStore::new(base)
    }

    #[test]
    fn record_snapshot_stores_a_version() {
        let store = temp_store("record");

        let version = store
            .record_snapshot("/project", "src/User.php", "v1")
            .expect("record")
            .expect("stored version");

        assert_eq!(version.size_bytes, 2);
        let versions = store
            .list_versions("/project", "src/User.php")
            .expect("list");
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].id, version.id);
    }

    #[test]
    fn record_snapshot_dedupes_identical_consecutive_content() {
        let store = temp_store("dedupe");

        store
            .record_snapshot("/project", "src/User.php", "same")
            .expect("first record")
            .expect("stored");
        let duplicate = store
            .record_snapshot("/project", "src/User.php", "same")
            .expect("second record");

        assert!(duplicate.is_none(), "identical content must not be stored");
        assert_eq!(
            store
                .list_versions("/project", "src/User.php")
                .expect("list")
                .len(),
            1
        );
    }

    #[test]
    fn record_snapshot_keeps_distinct_versions_newest_first() {
        let store = temp_store("distinct");

        store
            .record_snapshot("/project", "src/User.php", "one")
            .expect("record one");
        store
            .record_snapshot("/project", "src/User.php", "two")
            .expect("record two");
        store
            .record_snapshot("/project", "src/User.php", "three")
            .expect("record three");

        let versions = store
            .list_versions("/project", "src/User.php")
            .expect("list");
        assert_eq!(versions.len(), 3);

        let newest = &versions[0];
        let content = store
            .read_version("/project", "src/User.php", &newest.id)
            .expect("read newest");
        assert_eq!(content, "three");
    }

    #[test]
    fn read_version_returns_stored_content() {
        let store = temp_store("read");

        let version = store
            .record_snapshot("/project", "src/User.php", "payload")
            .expect("record")
            .expect("stored");

        let content = store
            .read_version("/project", "src/User.php", &version.id)
            .expect("read");
        assert_eq!(content, "payload");
    }

    #[test]
    fn read_unknown_version_errors() {
        let store = temp_store("read-unknown");
        store
            .record_snapshot("/project", "src/User.php", "payload")
            .expect("record");

        let result = store.read_version("/project", "src/User.php", "does-not-exist");
        assert!(result.is_err());
    }

    #[test]
    fn bounded_storage_evicts_oldest_versions() {
        let store = temp_store("bounded");
        let overflow = MAX_VERSIONS_PER_FILE + 10;

        for i in 0..overflow {
            store
                .record_snapshot("/project", "src/User.php", &format!("content-{i}"))
                .expect("record");
        }

        let versions = store
            .list_versions("/project", "src/User.php")
            .expect("list");
        assert_eq!(versions.len(), MAX_VERSIONS_PER_FILE);

        // Newest is the last written; the oldest 10 must have been evicted, so
        // their snapshot content is no longer retrievable but the surviving
        // window still reads correctly.
        let newest = store
            .read_version("/project", "src/User.php", &versions[0].id)
            .expect("read newest");
        assert_eq!(newest, format!("content-{}", overflow - 1));

        let oldest_surviving = store
            .read_version("/project", "src/User.php", &versions[versions.len() - 1].id)
            .expect("read oldest surviving");
        assert_eq!(
            oldest_surviving,
            format!("content-{}", overflow - MAX_VERSIONS_PER_FILE)
        );
    }

    #[test]
    fn storage_is_isolated_per_workspace() {
        let store = temp_store("isolation");

        store
            .record_snapshot("/project-a", "src/User.php", "from-a")
            .expect("record a");
        store
            .record_snapshot("/project-b", "src/User.php", "from-b")
            .expect("record b");

        let a = store
            .list_versions("/project-a", "src/User.php")
            .expect("a");
        let b = store
            .list_versions("/project-b", "src/User.php")
            .expect("b");
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);

        let a_content = store
            .read_version("/project-a", "src/User.php", &a[0].id)
            .expect("read a");
        let b_content = store
            .read_version("/project-b", "src/User.php", &b[0].id)
            .expect("read b");
        assert_eq!(a_content, "from-a");
        assert_eq!(b_content, "from-b");
    }

    #[test]
    fn list_versions_is_empty_for_unknown_file() {
        let store = temp_store("empty");

        let versions = store
            .list_versions("/project", "src/Unknown.php")
            .expect("list");
        assert!(versions.is_empty());
    }

    #[test]
    fn workspace_root_path_separators_are_normalized() {
        let store = temp_store("normalize");

        // The same logical workspace addressed with different separators must
        // resolve to the same history bucket.
        store
            .record_snapshot("C:/project/app", "src/User.php", "v1")
            .expect("record forward");
        let duplicate = store
            .record_snapshot("C:\\project\\app", "src/User.php", "v1")
            .expect("record backslash");

        assert!(duplicate.is_none(), "normalized roots share one bucket");
    }
}
