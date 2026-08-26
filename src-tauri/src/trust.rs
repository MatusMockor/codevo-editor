use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

const MAX_TRUST_LAUNCHES_GLOBAL: usize = 128;
const MAX_TRUST_LAUNCHES_PER_ROOT: usize = 16;

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
    generation: u64,
    root_generations: HashMap<String, u64>,
    storage_path: PathBuf,
    trusted_roots: HashSet<String>,
    launches: Arc<WorkspaceTrustLaunchRegistry>,
}

#[derive(Default)]
struct WorkspaceTrustLaunchState {
    tokens: HashMap<String, HashSet<u64>>,
    total: usize,
}

#[derive(Default)]
struct WorkspaceTrustLaunchRegistry {
    state: Mutex<WorkspaceTrustLaunchState>,
    next_token: AtomicU64,
}

pub(crate) struct WorkspaceTrustLaunchLease {
    registry: Arc<WorkspaceTrustLaunchRegistry>,
    root_path: String,
    token: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceTrustSnapshot {
    pub(crate) generation: u64,
    pub(crate) root_path: String,
    pub(crate) trusted: bool,
}

impl WorkspaceTrustService {
    pub fn load(storage_path: PathBuf) -> io::Result<Self> {
        if !storage_path.is_file() {
            return Ok(Self {
                generation: 0,
                root_generations: HashMap::new(),
                storage_path,
                trusted_roots: HashSet::new(),
                launches: Arc::new(WorkspaceTrustLaunchRegistry::default()),
            });
        }

        let content = fs::read_to_string(&storage_path)?;
        let persisted: PersistedWorkspaceTrust = serde_json::from_str(&content).unwrap_or_default();

        Ok(Self {
            generation: 0,
            root_generations: HashMap::new(),
            storage_path,
            trusted_roots: persisted.trusted_roots.into_iter().collect(),
            launches: Arc::new(WorkspaceTrustLaunchRegistry::default()),
        })
    }

    pub fn get(&self, root_path: &str) -> WorkspaceTrustState {
        let normalized_path = normalize_root_path(root_path);

        WorkspaceTrustState {
            trusted: self.trusted_roots.contains(&normalized_path),
            root_path: normalized_path,
        }
    }

    pub(crate) fn snapshot(&self, root_path: &str) -> WorkspaceTrustSnapshot {
        let state = self.get(root_path);
        WorkspaceTrustSnapshot {
            generation: self
                .root_generations
                .get(&state.root_path)
                .copied()
                .unwrap_or(0),
            root_path: state.root_path,
            trusted: state.trusted,
        }
    }

    pub(crate) fn reserve_launch(
        &self,
        expected: &WorkspaceTrustSnapshot,
    ) -> io::Result<WorkspaceTrustLaunchLease> {
        let current = WorkspaceTrustSnapshot {
            generation: self
                .root_generations
                .get(&expected.root_path)
                .copied()
                .unwrap_or(0),
            root_path: expected.root_path.clone(),
            trusted: self.trusted_roots.contains(&expected.root_path),
        };
        if current != *expected || !current.trusted {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "workspace trust authority changed",
            ));
        }
        self.launches.reserve(expected.root_path.clone())
    }

    pub fn set(&mut self, root_path: &str, trusted: bool) -> io::Result<WorkspaceTrustState> {
        let normalized_path = normalize_root_path(root_path);
        let next_generation = self.generation.checked_add(1).ok_or_else(|| {
            io::Error::other("workspace trust generation capacity has been exhausted")
        })?;

        if trusted {
            let inserted = self.trusted_roots.insert(normalized_path.clone());

            if let Err(error) = self.save() {
                if inserted {
                    self.trusted_roots.remove(&normalized_path);
                }

                return Err(error);
            }
            self.generation = next_generation;
            self.root_generations
                .insert(normalized_path.clone(), next_generation);

            return Ok(self.get(&normalized_path));
        }

        if self.launches.has_active(&normalized_path)? {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace trust launch is in progress",
            ));
        }

        let removed = self.trusted_roots.remove(&normalized_path);

        if let Err(error) = self.save() {
            if removed {
                self.trusted_roots.insert(normalized_path.clone());
            }

            return Err(error);
        }
        self.generation = next_generation;
        self.root_generations
            .insert(normalized_path.clone(), next_generation);

        Ok(self.get(&normalized_path))
    }

    #[cfg(feature = "perf-capture")]
    pub(crate) fn grant_ephemeral_canonical_roots(
        &mut self,
        roots: [&str; 2],
    ) -> io::Result<[WorkspaceTrustState; 2]> {
        if roots[0] == roots[1]
            || roots.iter().any(|root| {
                root.is_empty()
                    || root.len() > 4 * 1024
                    || root.chars().any(char::is_control)
                    || !Path::new(root).is_absolute()
                    || normalize_path_string(root) != *root
                    || Path::new(root).components().any(|component| {
                        matches!(
                            component,
                            std::path::Component::CurDir | std::path::Component::ParentDir
                        )
                    })
            })
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "ephemeral workspace trust roots must be canonical and distinct",
            ));
        }
        if roots.iter().all(|root| self.trusted_roots.contains(*root)) {
            return Ok(roots.map(|root_path| WorkspaceTrustState {
                root_path: root_path.to_owned(),
                trusted: true,
            }));
        }

        let next_generation = self.generation.checked_add(1).ok_or_else(|| {
            io::Error::other("workspace trust generation capacity has been exhausted")
        })?;
        self.trusted_roots
            .extend(roots.iter().map(|root| (*root).to_owned()));
        self.generation = next_generation;
        for root in roots {
            self.root_generations
                .insert(root.to_owned(), next_generation);
        }
        Ok(roots.map(|root_path| WorkspaceTrustState {
            root_path: root_path.to_owned(),
            trusted: true,
        }))
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

impl WorkspaceTrustLaunchRegistry {
    fn reserve(self: &Arc<Self>, root_path: String) -> io::Result<WorkspaceTrustLaunchLease> {
        let mut state = self
            .state
            .lock()
            .map_err(|error| io::Error::other(error.to_string()))?;
        if state.total >= MAX_TRUST_LAUNCHES_GLOBAL {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace trust launch capacity is exhausted",
            ));
        }
        let root_count = state.tokens.get(&root_path).map_or(0, HashSet::len);
        if root_count >= MAX_TRUST_LAUNCHES_PER_ROOT {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace trust launch capacity is exhausted",
            ));
        }
        let token = self
            .next_token
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| io::Error::other("workspace trust launch token space is exhausted"))?
            + 1;
        state
            .tokens
            .entry(root_path.clone())
            .or_default()
            .insert(token);
        state.total += 1;
        Ok(WorkspaceTrustLaunchLease {
            registry: Arc::clone(self),
            root_path,
            token,
        })
    }

    fn has_active(&self, root_path: &str) -> io::Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|error| io::Error::other(error.to_string()))?
            .tokens
            .get(root_path)
            .is_some_and(|tokens| !tokens.is_empty()))
    }

    fn release(&self, root_path: &str, token: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let removed = state
            .tokens
            .get_mut(root_path)
            .is_some_and(|tokens| tokens.remove(&token));
        if !removed {
            return;
        }
        state.total = state.total.saturating_sub(1);
        let empty = state.tokens.get(root_path).is_some_and(HashSet::is_empty);
        if empty {
            state.tokens.remove(root_path);
        }
    }
}

impl Drop for WorkspaceTrustLaunchLease {
    fn drop(&mut self) {
        self.registry.release(&self.root_path, self.token);
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
    use std::{
        fs,
        panic::{catch_unwind, AssertUnwindSafe},
        time::SystemTime,
    };

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
    fn trust_generation_rejects_revoke_regrant_aba_and_advances_on_each_commit() {
        let root = create_temp_dir("trust-generation");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");

        service.set("/project", true).expect("grant");
        let granted = service.snapshot("/project");
        service.set("/project", false).expect("revoke");
        let revoked = service.snapshot("/project");
        service.set("/project", true).expect("regrant");
        let regranted = service.snapshot("/project");

        assert!(granted.trusted);
        assert!(!revoked.trusted);
        assert!(regranted.trusted);
        assert!(granted.generation < revoked.generation);
        assert!(revoked.generation < regranted.generation);
        assert_ne!(granted, regranted);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn launch_lease_blocks_exact_root_revocation_and_not_an_unrelated_root() {
        let root = create_temp_dir("trust-launch-lease");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");
        service.set("/project/a", true).expect("trust a");
        service.set("/project/b", true).expect("trust b");
        let snapshot_a = service.snapshot("/project/a");
        let lease = service.reserve_launch(&snapshot_a).expect("reserve launch");

        let blocked = service
            .set("/project/a", false)
            .expect_err("active launch blocks revoke");
        assert_eq!(blocked.kind(), std::io::ErrorKind::WouldBlock);
        assert!(
            !service
                .set("/project/b", false)
                .expect("revoke unrelated root")
                .trusted
        );
        assert_eq!(service.snapshot("/project/a"), snapshot_a);
        drop(lease);
        assert!(
            !service
                .set("/project/a", false)
                .expect("revoke after launch")
                .trusted
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn exact_launch_tokens_survive_partial_drop_and_release_on_panic() {
        let root = create_temp_dir("trust-launch-token");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");
        service.set("/project", true).expect("trust project");
        let snapshot = service.snapshot("/project");
        let first = service.reserve_launch(&snapshot).expect("reserve first");
        let second = service.reserve_launch(&snapshot).expect("reserve second");
        drop(first);
        assert!(service.set("/project", false).is_err());
        drop(second);
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _lease = service
                .reserve_launch(&snapshot)
                .expect("reserve panic lease");
            panic!("stop");
        }));

        assert!(result.is_err());
        assert!(
            !service
                .set("/project", false)
                .expect("panic releases lease")
                .trusted
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn launch_reservations_are_bounded_per_root() {
        let root = create_temp_dir("trust-launch-cap");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");
        service.set("/project", true).expect("trust project");
        let snapshot = service.snapshot("/project");
        let leases = (0..super::MAX_TRUST_LAUNCHES_PER_ROOT)
            .map(|_| service.reserve_launch(&snapshot).expect("reserve launch"))
            .collect::<Vec<_>>();

        let error = service
            .reserve_launch(&snapshot)
            .err()
            .expect("bounded launch capacity");
        assert_eq!(error.kind(), std::io::ErrorKind::WouldBlock);
        drop(leases);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn failed_save_rolls_back_in_memory_trust_state() {
        let root = create_temp_dir("trust-rollback");
        let blocker = root.join("blocked-parent");
        fs::write(&blocker, "not a directory").expect("write blocker");
        let storage = blocker.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage).expect("load trust service");

        let initial_generation = service.snapshot("/project").generation;
        assert!(service.set("/project", true).is_err());
        assert!(!service.get("/project").trusted);
        assert_eq!(service.snapshot("/project").generation, initial_generation);

        let writable_storage = root.join("trust.json");
        service.storage_path = writable_storage;
        service.set("/project", true).expect("trust project");
        let committed_generation = service.snapshot("/project").generation;
        service.storage_path = blocker.join("trust.json");

        assert!(service.set("/project", false).is_err());
        assert!(service.get("/project").trusted);
        assert_eq!(
            service.snapshot("/project").generation,
            committed_generation
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(feature = "perf-capture")]
    #[test]
    fn ephemeral_canonical_roots_commit_once_without_persisting_and_are_idempotent() {
        let root = create_temp_dir("trust-exact-pair");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage.clone()).expect("load trust service");

        let states = service
            .grant_ephemeral_canonical_roots(["/fixture/a", "/fixture/b"])
            .expect("commit pair");
        assert!(states.iter().all(|state| state.trusted));
        let generation = service.snapshot("/fixture/a").generation;
        assert!(!storage.exists());

        service
            .grant_ephemeral_canonical_roots(["/fixture/a", "/fixture/b"])
            .expect("idempotent pair");
        assert_eq!(service.snapshot("/fixture/a").generation, generation);
        assert!(!storage.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(feature = "perf-capture")]
    #[test]
    fn ephemeral_canonical_roots_reject_duplicates_without_mutation() {
        let root = create_temp_dir("trust-pair-duplicate");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage.clone()).expect("load trust service");

        assert!(service
            .grant_ephemeral_canonical_roots(["/fixture/a", "/fixture/a/"])
            .is_err());
        assert!(!storage.exists());
        assert!(!service.get("/fixture/a").trusted);
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
