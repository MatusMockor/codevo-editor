use super::unregister::{WorkspaceOwnerClose, WorkspaceOwnerCloseResult};
use super::{
    close_workspace_owner_blocking, dispose_workspace_root_blocking, WorkspaceLifecycleState,
};
use crate::blocking_command::run_blocking_command;
use crate::workspace_file_watcher::{
    WorkspaceFileChangeWatchRegistry, WorkspaceWatchDisposalTicket,
};
use crate::workspace_registry::unregister::{WorkspaceAdmissionAdoption, WorkspaceOwnerScope};
use crate::workspace_registry::RegistrationOwner;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const MAX_CANONICAL_ROOT_PATH_BYTES: usize = 32_768;

#[tauri::command]
pub(crate) async fn unregister_workspace(
    app: AppHandle,
    workspace_id: WorkspaceId,
    admission_token: u64,
    canonical_root_path: String,
) -> Result<WorkspaceOwnerCloseResult, String> {
    validate_canonical_root_path(&canonical_root_path)?;
    close_workspace_owner(
        app,
        workspace_id,
        WorkspaceOwnerScope::EditorOwnership { admission_token },
        Some(PathBuf::from(canonical_root_path)),
    )
    .await
}

#[tauri::command]
pub(crate) async fn rollback_workspace_registration(
    app: AppHandle,
    workspace_id: WorkspaceId,
    admission_token: u64,
) -> Result<WorkspaceOwnerCloseResult, String> {
    close_workspace_owner(
        app,
        workspace_id,
        WorkspaceOwnerScope::Admission {
            owner: RegistrationOwner::Editor,
            admission_token,
        },
        None,
    )
    .await
}

#[tauri::command]
pub(crate) async fn adopt_workspace_admission(
    app: AppHandle,
    workspace_id: WorkspaceId,
    new_token: u64,
    replaced_token: u64,
) -> Result<WorkspaceAdmissionAdoptionResult, String> {
    validate_admission_token(new_token)?;
    validate_admission_token(replaced_token)?;
    run_blocking_command(move || {
        app.state::<WorkspaceRegistry>()
            .adopt_admission(&workspace_id, new_token, replaced_token)
            .map(WorkspaceAdmissionAdoptionResult::from)
            .map_err(|error| error.to_string())
    })
    .await
}

pub(crate) async fn close_workspace_owner(
    app: AppHandle,
    workspace_id: WorkspaceId,
    scope: WorkspaceOwnerScope,
    expected_canonical_root: Option<PathBuf>,
) -> Result<WorkspaceOwnerCloseResult, String> {
    let (WorkspaceOwnerScope::Admission {
        admission_token, ..
    }
    | WorkspaceOwnerScope::EditorOwnership { admission_token }) = scope;
    validate_admission_token(admission_token)?;
    let ticket = owner_disposal_ticket(&app, &workspace_id)?;
    run_blocking_command(move || {
        let state = WorkspaceLifecycleState::from_app(&app);
        let registry = app.state::<WorkspaceFileChangeWatchRegistry>().inner();
        let close = WorkspaceOwnerClose {
            workspace_id: &workspace_id,
            scope,
            expected_canonical_root: expected_canonical_root.as_deref(),
        };
        let Some(ticket) = ticket else {
            return close_workspace_owner_blocking(&app, state, close, registry);
        };
        let guard = registry.adopt_disposal(ticket);
        close_workspace_owner_blocking(&app, state, close, &guard)
    })
    .await
}

#[tauri::command]
pub(crate) async fn dispose_workspace_root(
    root_path: String,
    app: AppHandle,
) -> Result<(), String> {
    let ticket = app
        .state::<WorkspaceFileChangeWatchRegistry>()
        .begin_disposal(&root_path)?;
    run_blocking_command(move || {
        let guard = app
            .state::<WorkspaceFileChangeWatchRegistry>()
            .inner()
            .adopt_disposal(ticket);
        dispose_workspace_root_blocking(
            root_path,
            &app,
            WorkspaceLifecycleState::from_app(&app),
            &guard,
        )
    })
    .await
}

fn owner_disposal_ticket(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
) -> Result<Option<WorkspaceWatchDisposalTicket>, String> {
    let Ok(descriptor) = app.state::<WorkspaceRegistry>().descriptor(workspace_id) else {
        return Ok(None);
    };
    app.state::<WorkspaceFileChangeWatchRegistry>()
        .begin_disposal(&descriptor.canonical_root_path.to_string_lossy())
        .map(Some)
}

fn validate_admission_token(admission_token: u64) -> Result<(), String> {
    if admission_token == 0 || admission_token > MAX_JAVASCRIPT_SAFE_INTEGER {
        return Err("Workspace admission token is out of range.".to_string());
    }
    Ok(())
}

fn validate_canonical_root_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > MAX_CANONICAL_ROOT_PATH_BYTES
        || path.contains('\0')
        || Path::new(path).is_relative()
    {
        return Err("Workspace canonical root is invalid.".to_string());
    }
    Ok(())
}

#[derive(Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum WorkspaceAdmissionAdoptionResult {
    Adopted,
    StaleAdmission,
    UnknownWorkspace,
    Releasing,
}

impl From<WorkspaceAdmissionAdoption> for WorkspaceAdmissionAdoptionResult {
    fn from(adoption: WorkspaceAdmissionAdoption) -> Self {
        match adoption {
            WorkspaceAdmissionAdoption::Adopted => Self::Adopted,
            WorkspaceAdmissionAdoption::StaleAdmission => Self::StaleAdmission,
            WorkspaceAdmissionAdoption::UnknownWorkspace => Self::UnknownWorkspace,
            WorkspaceAdmissionAdoption::Releasing => Self::Releasing,
        }
    }
}
