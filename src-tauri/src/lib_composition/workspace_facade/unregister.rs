use super::{stop_agent_tasks_on_dispose, WorkspaceLifecycleState};
use crate::runtime_task_lifecycle::RuntimeTaskLifecycleExt as _;
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, DebugSessionDisposer,
    WorkspaceRuntimeDisposal,
};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MAX_WORKSPACE_CLOSE_ID_BYTES: usize = 1_024;
const MAX_WORKSPACE_CLOSE_PATH_BYTES: usize = 32_768;
const MAX_WORKSPACE_CLOSE_ERROR_BYTES: usize = 1_024;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;

pub(super) fn unregister_workspace_with_runtime_cleanup<F>(
    workspace_registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    runtime: WorkspaceRuntimeDisposal<'_>,
    before_runtime_cleanup: impl FnOnce(&ManagedWorkspaceDescriptor),
    after_runtime_cleanup: F,
) -> io::Result<Vec<String>>
where
    F: FnOnce(&ManagedWorkspaceDescriptor, &mut Vec<String>),
{
    let mut errors = Vec::new();
    let mut reservation = match workspace_registry.reserve_unregister(workspace_id) {
        Ok(reservation) => reservation,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(errors),
        Err(error) => return Err(error),
    };
    reservation.begin_cleanup();
    let descriptor = reservation.descriptor();
    before_runtime_cleanup(descriptor);
    if let Err(error) = dispose_workspace_runtime_root(&descriptor.canonical_root_path, runtime) {
        errors.push(format!("Workspace runtime cleanup failed: {error}"));
    }
    after_runtime_cleanup(descriptor, &mut errors);
    reservation.finalize()?;
    Ok(errors)
}

pub(super) struct NoopDebugSessionDisposer;

impl DebugSessionDisposer for NoopDebugSessionDisposer {
    fn stop_debug_session(&self, _root_path: &str) {}
}

struct DebugRootDeactivator<'a>(&'a super::DebugSessionRegistry);

impl DebugSessionDisposer for DebugRootDeactivator<'_> {
    fn stop_debug_session(&self, root_path: &str) {
        self.0.deactivate_root(root_path);
    }
}

pub(super) enum ExactWorkspaceTeardownOutcome {
    Closed,
    Incomplete(Vec<String>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RegisteredWorkspaceTeardownStep {
    NodeAttachCandidates,
    AgentTasks,
    FileSearch,
    JavascriptTasks,
    DocumentAdmission,
    Runtime,
    SmartMode,
    LocalHistory,
}

const REGISTERED_WORKSPACE_TEARDOWN_STEPS: [RegisteredWorkspaceTeardownStep; 8] = [
    RegisteredWorkspaceTeardownStep::NodeAttachCandidates,
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
    selected_root_path: &Path,
    canonical_root_path: &Path,
    cleanup: F,
) -> io::Result<ExactWorkspaceTeardownOutcome>
where
    F: FnOnce(&ManagedWorkspaceDescriptor) -> Vec<String>,
{
    let mut reservation = workspace_registry.reserve_unregister_exact(
        workspace_id,
        admission_token,
        selected_root_path,
        canonical_root_path,
    )?;
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
    Incomplete { errors: Vec<String> },
}

#[tauri::command]
pub(crate) fn dispose_registered_workspace(
    request: DisposeRegisteredWorkspaceRequest,
    app: AppHandle,
    state: WorkspaceLifecycleState<'_>,
) -> Result<DisposeRegisteredWorkspaceResult, String> {
    validate_dispose_registered_workspace_request(&request)?;
    let selected_root_path = PathBuf::from(&request.selected_root_path);
    let canonical_root_path = PathBuf::from(&request.canonical_root_path);
    let outcome = teardown_exact_workspace(
        &state.workspace_registry,
        &request.workspace_id,
        request.admission_token,
        &selected_root_path,
        &canonical_root_path,
        |descriptor| {
            let root = &descriptor.canonical_root_path;
            let root_key = root.to_string_lossy().into_owned();
            let debug_sessions = DebugRootDeactivator(&state.debug_sessions);
            execute_registered_workspace_teardown(|step| match step {
                RegisteredWorkspaceTeardownStep::NodeAttachCandidates => state
                    .node_attach_candidates
                    .invalidate_listings()
                    .err()
                    .map(|_| "Node attach candidate invalidation failed.".to_string()),
                RegisteredWorkspaceTeardownStep::AgentTasks => {
                    stop_agent_tasks_on_dispose(&app, root);
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
                        workspace_file_change_watch_registry: &*state
                            .workspace_file_change_watch_registry,
                        php_language_servers: &*state.php_language_servers,
                        debug_sessions: &debug_sessions,
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
