use crate::workspace_registry::WorkspaceId;
use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, OnceLock},
};

const GLOBAL_DIRECTORY_READ_LIMIT: usize = 16;
pub(crate) const WORKSPACE_DIRECTORY_BUSY_CODE: &str = "WORKSPACE_DIRECTORY_BUSY";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DirectoryReadKey {
    workspace_id: String,
    relative_path: String,
}

#[derive(Default)]
struct AdmissionState {
    in_flight: usize,
    by_path: HashMap<DirectoryReadKey, usize>,
}

#[derive(Default)]
pub(crate) struct DirectoryReadAdmissionRegistry {
    state: Mutex<AdmissionState>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DirectoryReadAdmissionError {
    GlobalBusy,
    PathBusy,
    Poisoned,
}

impl fmt::Display for DirectoryReadAdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let reason = match self {
            Self::GlobalBusy => "too many directory reads are already running",
            Self::PathBusy => "this directory is already being read",
            Self::Poisoned => "directory read admission is unavailable",
        };
        write!(formatter, "{WORKSPACE_DIRECTORY_BUSY_CODE}: {reason}")
    }
}

impl DirectoryReadAdmissionRegistry {
    pub(crate) fn reserve(
        self: &Arc<Self>,
        workspace_id: &WorkspaceId,
        relative_path: &str,
    ) -> Result<DirectoryReadPermit, DirectoryReadAdmissionError> {
        let key = DirectoryReadKey {
            workspace_id: workspace_id.as_str().to_owned(),
            relative_path: relative_path.to_owned(),
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| DirectoryReadAdmissionError::Poisoned)?;
        if state.by_path.contains_key(&key) {
            return Err(DirectoryReadAdmissionError::PathBusy);
        }
        if state.in_flight >= GLOBAL_DIRECTORY_READ_LIMIT {
            return Err(DirectoryReadAdmissionError::GlobalBusy);
        }
        state.in_flight += 1;
        state.by_path.insert(key.clone(), 1);
        drop(state);
        Ok(DirectoryReadPermit {
            registry: Arc::clone(self),
            key: Some(key),
        })
    }
}

pub(crate) struct DirectoryReadPermit {
    registry: Arc<DirectoryReadAdmissionRegistry>,
    key: Option<DirectoryReadKey>,
}

impl Drop for DirectoryReadPermit {
    fn drop(&mut self) {
        let Some(key) = self.key.take() else {
            return;
        };
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.by_path.remove(&key);
        state.in_flight = state.in_flight.saturating_sub(1);
    }
}

pub(crate) fn reserve_directory_read(
    workspace_id: &WorkspaceId,
    relative_path: &str,
) -> Result<DirectoryReadPermit, DirectoryReadAdmissionError> {
    static ADMISSION: OnceLock<Arc<DirectoryReadAdmissionRegistry>> = OnceLock::new();
    ADMISSION
        .get_or_init(|| Arc::new(DirectoryReadAdmissionRegistry::default()))
        .reserve(workspace_id, relative_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        sync::mpsc,
        thread,
    };

    fn workspace_id(value: &str) -> WorkspaceId {
        serde_json::from_str(&format!("\"{value}\"")).unwrap()
    }

    #[test]
    fn exact_path_is_single_flight_and_releases_on_drop() {
        let registry = Arc::new(DirectoryReadAdmissionRegistry::default());
        let id = workspace_id("workspace");
        let first = registry.reserve(&id, "src").unwrap();

        assert_eq!(
            registry.reserve(&id, "src").err().unwrap(),
            DirectoryReadAdmissionError::PathBusy
        );
        assert!(registry.reserve(&id, "test").is_ok());
        drop(first);
        assert!(registry.reserve(&id, "src").is_ok());
    }

    #[test]
    fn global_capacity_rejects_without_queueing_and_releases() {
        let registry = Arc::new(DirectoryReadAdmissionRegistry::default());
        let id = workspace_id("workspace");
        let mut permits = (0..GLOBAL_DIRECTORY_READ_LIMIT)
            .map(|index| registry.reserve(&id, &format!("path-{index}")).unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            registry.reserve(&id, "overflow").err().unwrap(),
            DirectoryReadAdmissionError::GlobalBusy
        );
        permits.pop();
        assert!(registry.reserve(&id, "overflow").is_ok());
    }

    #[test]
    fn capacity_is_held_until_physical_work_completes() {
        let registry = Arc::new(DirectoryReadAdmissionRegistry::default());
        let id = workspace_id("workspace");
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker_registry = Arc::clone(&registry);
        let worker_id = id.clone();
        let worker = thread::spawn(move || {
            let _permit = worker_registry.reserve(&worker_id, "src").unwrap();
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        });
        started_rx.recv().unwrap();

        assert_eq!(
            registry.reserve(&id, "src").err().unwrap(),
            DirectoryReadAdmissionError::PathBusy
        );
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        assert!(registry.reserve(&id, "src").is_ok());
    }

    #[test]
    fn error_and_panic_paths_release_capacity() {
        let registry = Arc::new(DirectoryReadAdmissionRegistry::default());
        let id = workspace_id("workspace");
        let failed: Result<(), ()> = {
            let _permit = registry.reserve(&id, "src").unwrap();
            Err(())
        };
        assert!(failed.is_err());
        assert!(registry.reserve(&id, "src").is_ok());

        let panicking_registry = Arc::clone(&registry);
        let panicking_id = id.clone();
        let panic = catch_unwind(AssertUnwindSafe(move || {
            let _permit = panicking_registry.reserve(&panicking_id, "panic").unwrap();
            panic!("exercise permit unwind");
        }));
        assert!(panic.is_err());
        assert!(registry.reserve(&id, "panic").is_ok());
    }
}
