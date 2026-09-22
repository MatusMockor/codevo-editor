use crate::{agent_task_supervisor::AgentTaskIsolation, workspace_registry::WorkspaceId};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

pub const AGENT_TASK_GLOBAL_LIMIT: usize = 64;
pub const AGENT_TASK_REPOSITORY_LIMIT: usize = AGENT_TASK_GLOBAL_LIMIT;

pub const AGENT_TASK_GLOBAL_LIMIT_ERROR: &str = "Too many agent tasks are starting or running.";
pub const AGENT_TASK_REPOSITORY_LIMIT_ERROR: &str =
    "Too many agent tasks are starting or running in this repository.";

struct AdmissionOwner {
    workspace_id: WorkspaceId,
    repository_root: PathBuf,
}

#[derive(Default)]
struct AdmissionState {
    next_id: u64,
    entries: HashMap<u64, AdmissionOwner>,
}

#[derive(Default)]
pub struct AgentTaskAdmissionRegistry {
    state: Mutex<AdmissionState>,
}

impl AgentTaskAdmissionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reserve(
        self: &Arc<Self>,
        workspace_id: &WorkspaceId,
        repository_root: &Path,
        _cwd: &Path,
        _isolation: AgentTaskIsolation,
    ) -> Result<AgentTaskAdmission, String> {
        let mut state = self.state();
        if state.entries.len() >= AGENT_TASK_GLOBAL_LIMIT {
            return Err(AGENT_TASK_GLOBAL_LIMIT_ERROR.to_string());
        }
        if state
            .entries
            .values()
            .filter(|entry| {
                &entry.workspace_id == workspace_id && entry.repository_root == repository_root
            })
            .count()
            >= AGENT_TASK_REPOSITORY_LIMIT
        {
            return Err(AGENT_TASK_REPOSITORY_LIMIT_ERROR.to_string());
        }
        // Concurrent threads may intentionally share a checkout. Admission bounds
        // resource use; destructive workspace operations retain their own guards.
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let id = state.next_id;
        state.entries.insert(
            id,
            AdmissionOwner {
                workspace_id: workspace_id.clone(),
                repository_root: repository_root.to_path_buf(),
            },
        );
        Ok(AgentTaskAdmission {
            id,
            registry: Arc::clone(self),
            _runtime_lease: None,
        })
    }

    fn state(&self) -> MutexGuard<'_, AdmissionState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct AgentTaskAdmission {
    id: u64,
    registry: Arc<AgentTaskAdmissionRegistry>,
    _runtime_lease: Option<Box<dyn Send>>,
}

impl AgentTaskAdmission {
    pub fn with_runtime_lease(mut self, runtime_lease: impl Send + 'static) -> Self {
        self._runtime_lease = Some(Box::new(runtime_lease));
        self
    }
}

impl Drop for AgentTaskAdmission {
    fn drop(&mut self) {
        self.registry.state().entries.remove(&self.id);
    }
}
