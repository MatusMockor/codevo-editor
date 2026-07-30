use crate::project::{ComposerWorkspaceDetector, WorkspaceDescriptor, WorkspaceDetector};
use crate::smart_mode::{SmartModeService, SmartModeState};
use crate::tools::{LocalPhpToolDetector, PhpToolAvailability, PhpToolDetector};
use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

#[path = "project_symbol_search_lifecycle.rs"]
pub(crate) mod project_symbol_search_lifecycle;

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
pub(crate) fn detect_workspace(path: String) -> Result<WorkspaceDescriptor, String> {
    ComposerWorkspaceDetector::default()
        .detect(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn detect_php_tools(
    workspace_root: Option<String>,
) -> Result<PhpToolAvailability, String> {
    let workspace_root = workspace_root.map(PathBuf::from);
    LocalPhpToolDetector
        .detect(workspace_root.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_smart_mode_state(
    root_path: String,
    service: State<'_, Mutex<SmartModeService>>,
) -> Result<SmartModeState, String> {
    let root = super::workspace_root_for_disposal(&root_path);
    let root_key = root.to_string_lossy();
    let service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.state(&root_key))
}

#[tauri::command]
pub(crate) fn get_workspace_trust(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<WorkspaceTrustState, String> {
    let service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.get(&root_path))
}
