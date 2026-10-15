use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub(crate) fn get_workspace_descriptor(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
) -> Result<ManagedWorkspaceDescriptor, String> {
    registry
        .descriptor(&workspace_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_workspace_trust(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<WorkspaceTrustState, String> {
    let service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.get(&root_path))
}
