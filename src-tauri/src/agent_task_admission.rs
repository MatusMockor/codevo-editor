use crate::{agent_task_supervisor::AgentTaskIsolation, workspace_registry::WorkspaceId};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

pub const AGENT_TASK_GLOBAL_LIMIT: usize = 8;
pub const AGENT_TASK_REPOSITORY_LIMIT: usize = 4;
pub const AGENT_TASK_IN_PLACE_REPOSITORY_LIMIT: usize = 1;

pub const AGENT_TASK_GLOBAL_LIMIT_ERROR: &str = "Too many agent tasks are starting or running.";
pub const AGENT_TASK_REPOSITORY_LIMIT_ERROR: &str =
    "Too many agent tasks are starting or running in this repository.";
pub const AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR: &str =
    "An agent task is already using this repository's working tree.";
pub const AGENT_TASK_CWD_EXCLUSIVE_ERROR: &str =
    "An agent task is already running in this working directory.";

struct AdmissionOwner {
    workspace_id: WorkspaceId,
    repository_root: PathBuf,
    cwd: PathBuf,
    isolation: AgentTaskIsolation,
}

impl AdmissionOwner {
    fn holds_in_place_slot(&self, repository_root: &Path) -> bool {
        self.repository_root == repository_root && self.cwd == self.repository_root
    }

    fn occupies_working_tree(&self, repository_root: &Path) -> bool {
        self.isolation == AgentTaskIsolation::InPlace && self.cwd == repository_root
    }
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
        cwd: &Path,
        isolation: AgentTaskIsolation,
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
        if isolation == AgentTaskIsolation::InPlace {
            ensure_in_place_exclusive(&state, repository_root)?;
        }
        ensure_cwd_exclusive(&state, cwd)?;
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let id = state.next_id;
        state.entries.insert(
            id,
            AdmissionOwner {
                workspace_id: workspace_id.clone(),
                repository_root: repository_root.to_path_buf(),
                cwd: cwd.to_path_buf(),
                isolation,
            },
        );
        Ok(AgentTaskAdmission {
            id,
            registry: Arc::clone(self),
        })
    }

    fn state(&self) -> MutexGuard<'_, AdmissionState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn ensure_in_place_exclusive(state: &AdmissionState, repository_root: &Path) -> Result<(), String> {
    let holders = state
        .entries
        .values()
        .filter(|entry| entry.holds_in_place_slot(repository_root))
        .count();
    if holders >= AGENT_TASK_IN_PLACE_REPOSITORY_LIMIT {
        return Err(AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR.to_string());
    }
    if state
        .entries
        .values()
        .any(|entry| entry.occupies_working_tree(repository_root))
    {
        return Err(AGENT_TASK_IN_PLACE_EXCLUSIVE_ERROR.to_string());
    }
    Ok(())
}

fn ensure_cwd_exclusive(state: &AdmissionState, cwd: &Path) -> Result<(), String> {
    if state.entries.values().any(|entry| entry.cwd == cwd) {
        return Err(AGENT_TASK_CWD_EXCLUSIVE_ERROR.to_string());
    }

    Ok(())
}

pub struct AgentTaskAdmission {
    id: u64,
    registry: Arc<AgentTaskAdmissionRegistry>,
}

impl Drop for AgentTaskAdmission {
    fn drop(&mut self) {
        self.registry.state().entries.remove(&self.id);
    }
}
