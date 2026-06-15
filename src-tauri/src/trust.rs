use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrustState {
    pub root_path: String,
    pub trusted: bool,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWorkspaceTrust {
    trusted_roots: Vec<String>,
}

pub struct WorkspaceTrustService {
    storage_path: PathBuf,
    trusted_roots: HashSet<String>,
}

impl WorkspaceTrustService {
    pub fn load(storage_path: PathBuf) -> io::Result<Self> {
        if !storage_path.is_file() {
            return Ok(Self {
                storage_path,
                trusted_roots: HashSet::new(),
            });
        }

        let content = fs::read_to_string(&storage_path)?;
        let persisted: PersistedWorkspaceTrust = serde_json::from_str(&content).unwrap_or_default();

        Ok(Self {
            storage_path,
            trusted_roots: persisted.trusted_roots.into_iter().collect(),
        })
    }

    pub fn get(&self, root_path: &str) -> WorkspaceTrustState {
        let normalized_path = normalize_root_path(root_path);

        WorkspaceTrustState {
            trusted: self.trusted_roots.contains(&normalized_path),
            root_path: normalized_path,
        }
    }

    pub fn set(&mut self, root_path: &str, trusted: bool) -> io::Result<WorkspaceTrustState> {
        let normalized_path = normalize_root_path(root_path);

        if trusted {
            let inserted = self.trusted_roots.insert(normalized_path.clone());

            if let Err(error) = self.save() {
                if inserted {
                    self.trusted_roots.remove(&normalized_path);
                }

                return Err(error);
            }

            return Ok(self.get(&normalized_path));
        }

        let removed = self.trusted_roots.remove(&normalized_path);

        if let Err(error) = self.save() {
            if removed {
                self.trusted_roots.insert(normalized_path.clone());
            }

            return Err(error);
        }

        Ok(self.get(&normalized_path))
    }

    fn save(&self) -> io::Result<()> {
        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut trusted_roots = self.trusted_roots.iter().cloned().collect::<Vec<_>>();
        trusted_roots.sort();

        let content = serde_json::to_string_pretty(&PersistedWorkspaceTrust { trusted_roots })
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(&self.storage_path, content)
    }
}

fn normalize_root_path(root_path: &str) -> String {
    let path = Path::new(root_path);

    if let Ok(canonical) = path.canonicalize() {
        return normalize_path_string(&canonical.to_string_lossy());
    }

    normalize_path_string(root_path)
}

fn normalize_path_string(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::WorkspaceTrustService;
    use std::{fs, time::SystemTime};

    #[test]
    fn workspaces_are_untrusted_by_default() {
        let root = create_temp_dir("trust-default");
        let storage = root.join("trust.json");
        let service = WorkspaceTrustService::load(storage).expect("load trust service");

        assert!(!service.get("/project").trusted);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn trust_can_be_granted_revoked_and_reloaded() {
        let root = create_temp_dir("trust-persist");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage.clone()).expect("load trust service");

        assert!(service.set("/project/", true).expect("set trust").trusted);
        assert!(service.get("/project").trusted);
        drop(service);

        let mut reloaded = WorkspaceTrustService::load(storage).expect("reload trust service");
        assert!(reloaded.get("/project").trusted);
        assert!(
            !reloaded
                .set("/project", false)
                .expect("revoke trust")
                .trusted
        );
        assert!(!reloaded.get("/project").trusted);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn failed_save_rolls_back_in_memory_trust_state() {
        let root = create_temp_dir("trust-rollback");
        let blocker = root.join("blocked-parent");
        fs::write(&blocker, "not a directory").expect("write blocker");
        let storage = blocker.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");

        assert!(service.set("/project", true).is_err());
        assert!(!service.get("/project").trusted);

        let writable_storage = root.join("trust.json");
        service.storage_path = writable_storage;
        service.set("/project", true).expect("trust project");
        service.storage_path = blocker.join("trust.json");

        assert!(service.set("/project", false).is_err());
        assert!(service.get("/project").trusted);
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{nanos}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }
}
