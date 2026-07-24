use crate::workspace_registry::WorkspaceId;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
};

pub(crate) const LIVE_TASK_GLOBAL_LIMIT: usize = 32;
pub(crate) const LIVE_TASK_WORKSPACE_LIMIT: usize = 4;
const LIVE_TASK_SESSION_LIMIT: usize = 1;

pub(crate) const GLOBAL_LIMIT_ERROR: &str = "Too many terminal tasks are starting or running.";
pub(crate) const WORKSPACE_LIMIT_ERROR: &str =
    "Too many terminal tasks are starting or running in this workspace.";
pub(crate) const SESSION_LIMIT_ERROR: &str =
    "A typed task is already starting or running in this terminal session.";

#[derive(Default)]
struct AdmissionState {
    next_id: u64,
    entries: HashMap<u64, AdmissionOwner>,
}

#[derive(Clone)]
struct AdmissionOwner {
    workspace_id: WorkspaceId,
    session_id: u64,
}

#[derive(Default)]
pub(crate) struct TerminalTaskAdmissionRegistry {
    state: Mutex<AdmissionState>,
}

impl TerminalTaskAdmissionRegistry {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn reserve(
        self: &Arc<Self>,
        workspace_id: &WorkspaceId,
        session_id: u64,
    ) -> Result<TerminalTaskAdmission, String> {
        let mut state = self.state();
        if state.entries.len() >= LIVE_TASK_GLOBAL_LIMIT {
            return Err(GLOBAL_LIMIT_ERROR.to_string());
        }
        if state
            .entries
            .values()
            .filter(|entry| &entry.workspace_id == workspace_id)
            .count()
            >= LIVE_TASK_WORKSPACE_LIMIT
        {
            return Err(WORKSPACE_LIMIT_ERROR.to_string());
        }
        if state
            .entries
            .values()
            .filter(|entry| entry.session_id == session_id)
            .count()
            >= LIVE_TASK_SESSION_LIMIT
        {
            return Err(SESSION_LIMIT_ERROR.to_string());
        }
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let id = state.next_id;
        state.entries.insert(
            id,
            AdmissionOwner {
                workspace_id: workspace_id.clone(),
                session_id,
            },
        );
        Ok(TerminalTaskAdmission {
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

pub(crate) struct TerminalTaskAdmission {
    id: u64,
    registry: Arc<TerminalTaskAdmissionRegistry>,
}

impl Drop for TerminalTaskAdmission {
    fn drop(&mut self) {
        self.registry.state().entries.remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_is_shared_by_task_kinds_and_released_on_drop() {
        let registry = Arc::new(TerminalTaskAdmissionRegistry::new());
        let workspace: WorkspaceId = serde_json::from_str("\"workspace-a\"").unwrap();
        let package = registry.reserve(&workspace, 7).unwrap();
        assert_eq!(
            registry.reserve(&workspace, 7).err().unwrap(),
            SESSION_LIMIT_ERROR
        );
        drop(package);
        assert!(registry.reserve(&workspace, 7).is_ok());
    }
}
