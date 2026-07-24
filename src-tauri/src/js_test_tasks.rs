use crate::{terminal_task_process::TerminalTaskOwnership, workspace_registry::WorkspaceId};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

#[path = "js_test_task_commands.rs"]
pub(crate) mod commands;

const RUN_ID_BYTES_LIMIT: usize = 64;
const WORKSPACE_ID_BYTES_LIMIT: usize = 64;
const LIVE_TASK_GLOBAL_LIMIT: usize = 32;
const LIVE_TASK_WORKSPACE_LIMIT: usize = 4;
const CANCELLATION_GLOBAL_LIMIT: usize = 1_024;
const CANCELLATION_WORKSPACE_LIMIT: usize = 128;

const DUPLICATE_RUN_ID_ERROR: &str = "A JavaScript test task with this runId already exists.";
const WRONG_WORKSPACE_ERROR: &str = "JavaScript test task belongs to a different workspace.";

enum TaskPhase {
    Starting { stop_requested: bool },
    Active { ownership: TerminalTaskOwnership },
}

#[derive(Debug, Eq, PartialEq)]
enum TaskReservation {
    Reserved,
    Cancelled,
}

struct TaskEntry {
    workspace_id: WorkspaceId,
    phase: TaskPhase,
}

#[derive(Clone)]
struct CancellationTombstone {
    workspace_id: WorkspaceId,
}

#[derive(Default)]
struct TaskRegistryState {
    entries: HashMap<String, TaskEntry>,
    cancellations: HashMap<String, CancellationTombstone>,
    cancellation_order: VecDeque<String>,
}

#[derive(Default)]
pub(crate) struct JsTestTaskRegistry {
    state: Mutex<TaskRegistryState>,
}

impl JsTestTaskRegistry {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn reserve(&self, run_id: &str, workspace_id: &WorkspaceId) -> Result<TaskReservation, String> {
        validate_owner(run_id, workspace_id)?;
        let mut state = self.state();
        if state.entries.contains_key(run_id) {
            return Err(DUPLICATE_RUN_ID_ERROR.to_string());
        }
        if let Some(cancellation) = state.cancellations.get(run_id) {
            if &cancellation.workspace_id == workspace_id {
                return Ok(TaskReservation::Cancelled);
            }
            remove_cancellation(&mut state, run_id);
        }
        if state.entries.len() >= LIVE_TASK_GLOBAL_LIMIT {
            return Err("Global JavaScript test task limit reached.".to_string());
        }
        let workspace_count = state
            .entries
            .values()
            .filter(|entry| &entry.workspace_id == workspace_id)
            .count();
        if workspace_count >= LIVE_TASK_WORKSPACE_LIMIT {
            return Err("Workspace JavaScript test task limit reached.".to_string());
        }
        state.entries.insert(
            run_id.to_string(),
            TaskEntry {
                workspace_id: workspace_id.clone(),
                phase: TaskPhase::Starting {
                    stop_requested: false,
                },
            },
        );
        Ok(TaskReservation::Reserved)
    }

    fn activate(
        &self,
        run_id: &str,
        workspace_id: &WorkspaceId,
        ownership: TerminalTaskOwnership,
    ) -> Result<(), String> {
        let mut state = self.state();
        let entry = state
            .entries
            .get_mut(run_id)
            .ok_or_else(|| "JavaScript test task reservation disappeared.".to_string())?;
        if &entry.workspace_id != workspace_id {
            return Err(WRONG_WORKSPACE_ERROR.to_string());
        }
        let TaskPhase::Starting { stop_requested } = entry.phase else {
            return Err("JavaScript test task is already active.".to_string());
        };
        entry.phase = TaskPhase::Active {
            ownership: ownership.clone(),
        };
        if stop_requested {
            ownership.request_stop();
        }
        Ok(())
    }

    fn abort(&self, run_id: &str, workspace_id: &WorkspaceId) {
        let mut state = self.state();
        if state
            .entries
            .get(run_id)
            .is_some_and(|entry| &entry.workspace_id == workspace_id)
        {
            state.entries.remove(run_id);
        }
    }

    fn request_stop(&self, run_id: &str, workspace_id: &WorkspaceId) -> Result<bool, String> {
        validate_owner(run_id, workspace_id)?;
        let mut state = self.state();
        if let Some(entry) = state.entries.get_mut(run_id) {
            if &entry.workspace_id != workspace_id {
                return Err(WRONG_WORKSPACE_ERROR.to_string());
            }
            return Ok(match &mut entry.phase {
                TaskPhase::Starting { stop_requested } => {
                    *stop_requested = true;
                    true
                }
                TaskPhase::Active { ownership } => {
                    ownership.request_stop() || ownership.was_stop_requested()
                }
            });
        }
        if let Some(cancellation) = state.cancellations.get(run_id) {
            if &cancellation.workspace_id != workspace_id {
                return Err(WRONG_WORKSPACE_ERROR.to_string());
            }
            return Ok(true);
        }
        record_cancellation(&mut state, run_id, workspace_id);
        Ok(true)
    }

    fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        let ownership = {
            let mut state = self.state();
            state
                .entries
                .values_mut()
                .filter(|entry| &entry.workspace_id == workspace_id)
                .filter_map(|entry| match &mut entry.phase {
                    TaskPhase::Starting { stop_requested } => {
                        *stop_requested = true;
                        None
                    }
                    TaskPhase::Active { ownership } => Some(ownership.clone()),
                })
                .collect::<Vec<_>>()
        };
        ownership.iter().for_each(|owner| {
            owner.request_stop();
        });
    }

    fn request_stop_all(&self) {
        let ownership = {
            let mut state = self.state();
            state
                .entries
                .values_mut()
                .filter_map(|entry| match &mut entry.phase {
                    TaskPhase::Starting { stop_requested } => {
                        *stop_requested = true;
                        None
                    }
                    TaskPhase::Active { ownership } => Some(ownership.clone()),
                })
                .collect::<Vec<_>>()
        };
        ownership.iter().for_each(|owner| {
            owner.request_stop();
        });
    }

    fn state(&self) -> MutexGuard<'_, TaskRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub(crate) fn request_stop_workspace_in_app(app: &AppHandle, workspace_id: &WorkspaceId) {
    if let Some(tasks) = app.try_state::<JsTestTaskRegistry>() {
        tasks.request_stop_workspace(workspace_id);
    }
}

pub(crate) fn request_stop_all_in_app(app: &AppHandle) {
    if let Some(tasks) = app.try_state::<JsTestTaskRegistry>() {
        tasks.request_stop_all();
    }
}

fn validate_owner(run_id: &str, workspace_id: &WorkspaceId) -> Result<(), String> {
    if run_id.trim().is_empty()
        || run_id.len() > RUN_ID_BYTES_LIMIT
        || run_id.chars().any(char::is_control)
    {
        return Err("JavaScript test task runId is invalid.".to_string());
    }
    let workspace = workspace_id.as_str();
    if workspace.trim().is_empty()
        || workspace.len() > WORKSPACE_ID_BYTES_LIMIT
        || workspace.chars().any(char::is_control)
    {
        return Err("JavaScript test task workspaceId is invalid.".to_string());
    }
    Ok(())
}

fn record_cancellation(state: &mut TaskRegistryState, run_id: &str, workspace_id: &WorkspaceId) {
    state.cancellations.insert(
        run_id.to_string(),
        CancellationTombstone {
            workspace_id: workspace_id.clone(),
        },
    );
    state.cancellation_order.push_back(run_id.to_string());
    while cancellation_count_for_workspace(state, workspace_id) > CANCELLATION_WORKSPACE_LIMIT {
        let Some(position) = state.cancellation_order.iter().position(|candidate| {
            state
                .cancellations
                .get(candidate)
                .is_some_and(|entry| &entry.workspace_id == workspace_id)
        }) else {
            break;
        };
        if let Some(expired) = state.cancellation_order.remove(position) {
            state.cancellations.remove(&expired);
        }
    }
    while state.cancellations.len() > CANCELLATION_GLOBAL_LIMIT {
        if let Some(expired) = state.cancellation_order.pop_front() {
            state.cancellations.remove(&expired);
        }
    }
}

fn remove_cancellation(state: &mut TaskRegistryState, run_id: &str) {
    state.cancellations.remove(run_id);
    state
        .cancellation_order
        .retain(|candidate| candidate != run_id);
}

fn cancellation_count_for_workspace(
    state: &TaskRegistryState,
    workspace_id: &WorkspaceId,
) -> usize {
    state
        .cancellations
        .values()
        .filter(|entry| &entry.workspace_id == workspace_id)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_registry::WorkspaceRegistry;
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::sync::atomic::{AtomicU64, Ordering};

    #[cfg(unix)]
    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn workspace(value: &str) -> WorkspaceId {
        serde_json::from_value(serde_json::Value::String(value.to_string())).unwrap()
    }

    #[test]
    fn stop_before_start_is_idempotent_and_owner_bound() {
        let tasks = JsTestTaskRegistry::new();
        let a = workspace("ws-a");
        let b = workspace("ws-b");
        assert_eq!(tasks.request_stop("run-1", &a), Ok(true));
        assert_eq!(tasks.request_stop("run-1", &a), Ok(true));
        assert_eq!(
            tasks.request_stop("run-1", &b),
            Err(WRONG_WORKSPACE_ERROR.to_string())
        );
        assert_eq!(tasks.reserve("run-1", &a), Ok(TaskReservation::Cancelled));
    }

    #[test]
    fn foreign_unknown_stop_cannot_poison_authoritative_start() {
        let tasks = JsTestTaskRegistry::new();
        let a = workspace("ws-a");
        let b = workspace("ws-b");
        assert_eq!(tasks.request_stop("run-1", &b), Ok(true));
        assert_eq!(tasks.reserve("run-1", &a), Ok(TaskReservation::Reserved));
        assert!(tasks.state().cancellations.is_empty());
    }

    #[test]
    fn duplicate_live_run_id_is_rejected_across_workspaces() {
        let tasks = JsTestTaskRegistry::new();
        let a = workspace("ws-a");
        let b = workspace("ws-b");
        assert_eq!(tasks.reserve("run-1", &a), Ok(TaskReservation::Reserved));
        assert_eq!(
            tasks.reserve("run-1", &b),
            Err(DUPLICATE_RUN_ID_ERROR.to_string())
        );
    }

    #[test]
    fn wrong_workspace_cannot_stop_a_live_owner_and_repeated_stop_is_idempotent() {
        let tasks = JsTestTaskRegistry::new();
        let a = workspace("ws-a");
        let b = workspace("ws-b");
        assert_eq!(tasks.reserve("run-1", &a), Ok(TaskReservation::Reserved));
        assert_eq!(
            tasks.request_stop("run-1", &b),
            Err(WRONG_WORKSPACE_ERROR.to_string())
        );
        assert_eq!(tasks.request_stop("run-1", &a), Ok(true));
        assert_eq!(tasks.request_stop("run-1", &a), Ok(true));
    }

    #[test]
    fn cancellation_tombstones_are_bounded_per_workspace_and_globally() {
        let tasks = JsTestTaskRegistry::new();
        let a = workspace("ws-a");
        for index in 0..=CANCELLATION_WORKSPACE_LIMIT {
            tasks
                .request_stop(&format!("a-{index}"), &a)
                .expect("record cancellation");
        }
        assert_eq!(
            cancellation_count_for_workspace(&tasks.state(), &a),
            CANCELLATION_WORKSPACE_LIMIT
        );

        for index in 0..=CANCELLATION_GLOBAL_LIMIT {
            let owner = workspace(&format!("ws-{index}"));
            tasks
                .request_stop(&format!("global-{index}"), &owner)
                .expect("record cancellation");
        }
        let state = tasks.state();
        assert_eq!(state.cancellations.len(), CANCELLATION_GLOBAL_LIMIT);
        assert_eq!(state.cancellation_order.len(), CANCELLATION_GLOBAL_LIMIT);
    }

    #[test]
    fn owner_ids_use_exact_untrimmed_sixty_four_byte_bounds() {
        let valid_run = "r".repeat(RUN_ID_BYTES_LIMIT);
        let valid_workspace = workspace(&"w".repeat(WORKSPACE_ID_BYTES_LIMIT));
        assert_eq!(validate_owner(&valid_run, &valid_workspace), Ok(()));
        assert_eq!(
            validate_owner(&"r".repeat(RUN_ID_BYTES_LIMIT + 1), &valid_workspace),
            Err("JavaScript test task runId is invalid.".to_string())
        );
        assert_eq!(
            validate_owner(
                &valid_run,
                &workspace(&"w".repeat(WORKSPACE_ID_BYTES_LIMIT + 1))
            ),
            Err("JavaScript test task workspaceId is invalid.".to_string())
        );
        assert_eq!(
            validate_owner("   ", &valid_workspace),
            Err("JavaScript test task runId is invalid.".to_string())
        );
        assert_eq!(
            validate_owner(&valid_run, &workspace("   ")),
            Err("JavaScript test task workspaceId is invalid.".to_string())
        );
        assert_eq!(validate_owner(" exact ", &workspace(" workspace ")), Ok(()));
        assert_eq!(
            validate_owner(&"é".repeat(33), &valid_workspace),
            Err("JavaScript test task runId is invalid.".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn unregister_and_same_path_reregistration_keep_task_owners_isolated() {
        let root = std::env::temp_dir().join(format!(
            "mockor-js-task-reregister-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create workspace");
        let workspaces = WorkspaceRegistry::new();
        let first = workspaces.register(&root).expect("register first");
        let tasks = JsTestTaskRegistry::new();
        tasks
            .reserve("old-run", &first.workspace_id)
            .expect("reserve old");
        workspaces
            .unregister(&first.workspace_id)
            .expect("unregister first");
        tasks.request_stop_workspace(&first.workspace_id);

        let second = workspaces.register(&root).expect("register second");
        assert_ne!(first.workspace_id, second.workspace_id);
        tasks
            .reserve("new-run", &second.workspace_id)
            .expect("reserve replacement");
        tasks.request_stop_workspace(&first.workspace_id);

        let state = tasks.state();
        assert!(matches!(
            state.entries.get("old-run").map(|entry| &entry.phase),
            Some(TaskPhase::Starting {
                stop_requested: true
            })
        ));
        assert!(matches!(
            state.entries.get("new-run").map(|entry| &entry.phase),
            Some(TaskPhase::Starting {
                stop_requested: false
            })
        ));
        drop(state);
        workspaces
            .unregister(&second.workspace_id)
            .expect("unregister second");
        fs::remove_dir_all(root).expect("cleanup");
    }
}
