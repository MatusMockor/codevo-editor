use super::{end_sessions_for_workspace, stop_agent_tasks_on_dispose, WorkspaceLifecycleState};
use crate::blocking_command::run_blocking_command;
use crate::runtime_task_lifecycle::RuntimeTaskLifecycleExt as _;
use crate::workspace_file_watcher::{
    WorkspaceFileChangeWatchRegistry, WorkspaceWatchDisposalGuard,
};
use crate::workspace_registry::unregister::{WorkspaceOwnerRelease, WorkspaceOwnerScope};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, WorkspaceRuntimeDisposal,
};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_WORKSPACE_CLOSE_ID_BYTES: usize = 1_024;
const MAX_WORKSPACE_CLOSE_PATH_BYTES: usize = 32_768;
const MAX_WORKSPACE_CLOSE_ERROR_BYTES: usize = 1_024;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum WorkspaceOwnerCloseOutcome {
    Released(Vec<String>),
    Releasing,
    RetainedByOtherOwners,
    UnknownWorkspace,
    StaleOwner,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum WorkspaceOwnerCloseResult {
    Released,
    Releasing,
    RetainedByOtherOwners,
    UnknownWorkspace,
    StaleOwner,
}

impl From<&WorkspaceOwnerCloseOutcome> for WorkspaceOwnerCloseResult {
    fn from(outcome: &WorkspaceOwnerCloseOutcome) -> Self {
        match outcome {
            WorkspaceOwnerCloseOutcome::Released(_) => Self::Released,
            WorkspaceOwnerCloseOutcome::Releasing => Self::Releasing,
            WorkspaceOwnerCloseOutcome::RetainedByOtherOwners => Self::RetainedByOtherOwners,
            WorkspaceOwnerCloseOutcome::UnknownWorkspace => Self::UnknownWorkspace,
            WorkspaceOwnerCloseOutcome::StaleOwner => Self::StaleOwner,
        }
    }
}

pub(super) struct WorkspaceOwnerClose<'a> {
    pub(super) workspace_id: &'a WorkspaceId,
    pub(super) scope: WorkspaceOwnerScope,
    pub(super) expected_canonical_root: Option<&'a Path>,
}

pub(super) fn release_workspace_owner_with_runtime_cleanup<F>(
    workspace_registry: &WorkspaceRegistry,
    close: WorkspaceOwnerClose<'_>,
    runtime: WorkspaceRuntimeDisposal<'_>,
    before_runtime_cleanup: impl FnOnce(&ManagedWorkspaceDescriptor),
    after_runtime_cleanup: F,
) -> io::Result<WorkspaceOwnerCloseOutcome>
where
    F: FnOnce(&ManagedWorkspaceDescriptor, &mut Vec<String>),
{
    let release = workspace_registry.release_owner(
        close.workspace_id,
        close.scope,
        close.expected_canonical_root,
    )?;
    let mut reservation = match release {
        WorkspaceOwnerRelease::UnknownWorkspace => {
            return Ok(WorkspaceOwnerCloseOutcome::UnknownWorkspace)
        }
        WorkspaceOwnerRelease::StaleOwner => return Ok(WorkspaceOwnerCloseOutcome::StaleOwner),
        WorkspaceOwnerRelease::Releasing => return Ok(WorkspaceOwnerCloseOutcome::Releasing),
        WorkspaceOwnerRelease::RetainedByOtherOwners => {
            return Ok(WorkspaceOwnerCloseOutcome::RetainedByOtherOwners)
        }
        WorkspaceOwnerRelease::LastOwner(reservation) => reservation,
    };
    let mut errors = Vec::new();
    reservation.begin_cleanup();
    let descriptor = reservation.descriptor();
    before_runtime_cleanup(descriptor);
    if let Err(error) = dispose_workspace_runtime_root(&descriptor.canonical_root_path, runtime) {
        errors.push(format!("Workspace runtime cleanup failed: {error}"));
    }
    after_runtime_cleanup(descriptor, &mut errors);
    reservation.finalize()?;
    Ok(WorkspaceOwnerCloseOutcome::Released(errors))
}

pub(super) enum ExactWorkspaceTeardownOutcome {
    Closed,
    UnknownWorkspace,
    Releasing,
    RetainedByOtherOwners,
    Incomplete(Vec<String>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RegisteredWorkspaceTeardownStep {
    AgentTasks,
    FileSearch,
    JavascriptTasks,
    DocumentAdmission,
    Runtime,
    SmartMode,
    LocalHistory,
}

const REGISTERED_WORKSPACE_TEARDOWN_STEPS: [RegisteredWorkspaceTeardownStep; 7] = [
    RegisteredWorkspaceTeardownStep::AgentTasks,
    RegisteredWorkspaceTeardownStep::FileSearch,
    RegisteredWorkspaceTeardownStep::JavascriptTasks,
    RegisteredWorkspaceTeardownStep::DocumentAdmission,
    RegisteredWorkspaceTeardownStep::Runtime,
    RegisteredWorkspaceTeardownStep::SmartMode,
    RegisteredWorkspaceTeardownStep::LocalHistory,
];

pub(super) fn execute_registered_workspace_teardown(
    mut execute: impl FnMut(RegisteredWorkspaceTeardownStep) -> Option<String>,
) -> Vec<String> {
    let mut errors = Vec::new();
    for step in REGISTERED_WORKSPACE_TEARDOWN_STEPS {
        if step == RegisteredWorkspaceTeardownStep::LocalHistory && !errors.is_empty() {
            return errors;
        }
        if let Some(error) = execute(step) {
            errors.push(bounded_workspace_close_error(&error));
        }
    }
    errors
}

pub(super) fn teardown_exact_workspace<F>(
    workspace_registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    admission_token: u64,
    canonical_root_path: &Path,
    cleanup: F,
) -> io::Result<ExactWorkspaceTeardownOutcome>
where
    F: FnOnce(&ManagedWorkspaceDescriptor) -> Vec<String>,
{
    let release = workspace_registry.release_owner(
        workspace_id,
        WorkspaceOwnerScope::EditorOwnership { admission_token },
        Some(canonical_root_path),
    )?;
    let mut reservation = match release {
        WorkspaceOwnerRelease::UnknownWorkspace => {
            return Ok(ExactWorkspaceTeardownOutcome::UnknownWorkspace)
        }
        WorkspaceOwnerRelease::StaleOwner => {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "workspace close identity is stale",
            ))
        }
        WorkspaceOwnerRelease::RetainedByOtherOwners => {
            return Ok(ExactWorkspaceTeardownOutcome::RetainedByOtherOwners)
        }
        WorkspaceOwnerRelease::Releasing => return Ok(ExactWorkspaceTeardownOutcome::Releasing),
        WorkspaceOwnerRelease::LastOwner(reservation) => reservation,
    };
    reservation.begin_cleanup();
    let errors = cleanup(reservation.descriptor());
    if !errors.is_empty() {
        reservation.cancel()?;
        return Ok(ExactWorkspaceTeardownOutcome::Incomplete(errors));
    }

    reservation.finalize()?;
    Ok(ExactWorkspaceTeardownOutcome::Closed)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DisposeRegisteredWorkspaceRequest {
    workspace_id: WorkspaceId,
    admission_token: u64,
    selected_root_path: String,
    canonical_root_path: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum DisposeRegisteredWorkspaceResult {
    Closed,
    UnknownWorkspace,
    Releasing,
    RetainedByOtherOwners,
    Incomplete { errors: Vec<String> },
}

#[tauri::command]
pub(crate) async fn dispose_registered_workspace(
    request: DisposeRegisteredWorkspaceRequest,
    app: AppHandle,
) -> Result<DisposeRegisteredWorkspaceResult, String> {
    validate_dispose_registered_workspace_request(&request)?;
    let ticket = app
        .state::<WorkspaceFileChangeWatchRegistry>()
        .begin_disposal(&request.canonical_root_path)?;
    run_blocking_command(move || {
        let guard = app
            .state::<WorkspaceFileChangeWatchRegistry>()
            .inner()
            .adopt_disposal(ticket);
        dispose_registered_workspace_blocking(
            request,
            &app,
            WorkspaceLifecycleState::from_app(&app),
            &guard,
        )
    })
    .await
}

fn dispose_registered_workspace_blocking(
    request: DisposeRegisteredWorkspaceRequest,
    app: &AppHandle,
    state: WorkspaceLifecycleState<'_>,
    watch_disposal: &WorkspaceWatchDisposalGuard<'_>,
) -> Result<DisposeRegisteredWorkspaceResult, String> {
    let canonical_root_path = PathBuf::from(&request.canonical_root_path);
    let outcome = teardown_exact_workspace(
        &state.workspace_registry,
        &request.workspace_id,
        request.admission_token,
        &canonical_root_path,
        |descriptor| {
            watch_disposal.stop_watches_before_arrival();
            let root = &descriptor.canonical_root_path;
            let root_key = root.to_string_lossy().into_owned();
            execute_registered_workspace_teardown(|step| match step {
                RegisteredWorkspaceTeardownStep::AgentTasks => {
                    end_sessions_for_workspace(app, descriptor.workspace_id.as_str());
                    stop_agent_tasks_on_dispose(app, None, root);
                    None
                }
                RegisteredWorkspaceTeardownStep::FileSearch => {
                    state
                        .file_search_lifecycle
                        .cancel_workspace(&descriptor.workspace_id);
                    None
                }
                RegisteredWorkspaceTeardownStep::JavascriptTasks => {
                    app.request_stop_workspace_tasks(
                        &descriptor.workspace_id,
                        &state.js_test_batches,
                    );
                    None
                }
                RegisteredWorkspaceTeardownStep::DocumentAdmission => state
                    .document_change_admission
                    .purge_root(&root_key)
                    .err()
                    .map(|error| format!("Document change admission cleanup failed: {error}")),
                RegisteredWorkspaceTeardownStep::Runtime => dispose_workspace_runtime_root(
                    root,
                    WorkspaceRuntimeDisposal {
                        index_lifecycle: &*state.index_lifecycle,
                        javascript_typescript_language_servers: &*state
                            .javascript_typescript_language_servers,
                        javascript_typescript_watch_registry: &*state
                            .javascript_typescript_watch_registry,
                        workspace_file_change_watch_registry: watch_disposal,
                        php_language_servers: &*state.php_language_servers,
                        eslint_processes: &**state.eslint_processes,
                        terminal_sessions: &*state.terminal_sessions,
                    },
                )
                .err()
                .map(|error| format!("Workspace runtime cleanup failed: {error}")),
                RegisteredWorkspaceTeardownStep::SmartMode => {
                    match state.smart_mode_service.lock() {
                        Ok(mut smart_mode) => {
                            smart_mode.remove_workspace(&root_key);
                            None
                        }
                        Err(error) => Some(format!("Smart mode cleanup failed: {error}")),
                    }
                }
                RegisteredWorkspaceTeardownStep::LocalHistory => {
                    state
                        .local_history_authorizer
                        .revoke(&descriptor.workspace_id);
                    None
                }
            })
        },
    )
    .map_err(|error| error.to_string())?;

    match outcome {
        ExactWorkspaceTeardownOutcome::Closed => Ok(DisposeRegisteredWorkspaceResult::Closed),
        ExactWorkspaceTeardownOutcome::UnknownWorkspace => {
            Ok(DisposeRegisteredWorkspaceResult::UnknownWorkspace)
        }
        ExactWorkspaceTeardownOutcome::Releasing => Ok(DisposeRegisteredWorkspaceResult::Releasing),
        ExactWorkspaceTeardownOutcome::RetainedByOtherOwners => {
            Ok(DisposeRegisteredWorkspaceResult::RetainedByOtherOwners)
        }
        ExactWorkspaceTeardownOutcome::Incomplete(errors) => {
            Ok(DisposeRegisteredWorkspaceResult::Incomplete { errors })
        }
    }
}

fn validate_dispose_registered_workspace_request(
    request: &DisposeRegisteredWorkspaceRequest,
) -> Result<(), String> {
    if request.workspace_id.as_str().is_empty()
        || request.workspace_id.as_str().len() > MAX_WORKSPACE_CLOSE_ID_BYTES
        || request.workspace_id.as_str().as_bytes().contains(&0)
    {
        return Err("Workspace close id is invalid or exceeds its bounded size.".to_string());
    }
    if request.admission_token == 0 || request.admission_token > MAX_JAVASCRIPT_SAFE_INTEGER {
        return Err("Workspace close admission token is invalid.".to_string());
    }
    validate_workspace_close_path(&request.selected_root_path, "selected")?;
    validate_workspace_close_path(&request.canonical_root_path, "canonical")
}

fn validate_workspace_close_path(path: &str, label: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > MAX_WORKSPACE_CLOSE_PATH_BYTES
        || path.as_bytes().contains(&0)
        || !Path::new(path).is_absolute()
    {
        return Err(format!(
            "Workspace close {label} root is invalid or exceeds its bounded size."
        ));
    }
    Ok(())
}

fn bounded_workspace_close_error(error: &str) -> String {
    if error.len() <= MAX_WORKSPACE_CLOSE_ERROR_BYTES {
        return error.to_string();
    }
    let mut boundary = MAX_WORKSPACE_CLOSE_ERROR_BYTES;
    while !error.is_char_boundary(boundary) {
        boundary -= 1;
    }
    error[..boundary].to_string()
}

#[cfg(test)]
#[path = "unregister_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "unregister_legacy_tests.rs"]
mod legacy_tests;

#[cfg(test)]
#[path = "owner_release_tests.rs"]
mod owner_release_tests;
