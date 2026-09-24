use super::canonicalize_workspace_root;
use crate::blocking_command::run_blocking_command;
use crate::workspace_file_watcher::{
    WorkspaceFileChangeWatchRegistry, WorkspaceFileWatchStartReceipt,
};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_WORKSPACE_WATCH_ROOT_BYTES: usize = 32_768;

#[tauri::command]
pub(crate) async fn start_workspace_file_watch(
    root_path: String,
    app: AppHandle,
) -> Result<WorkspaceFileWatchStartReceipt, String> {
    let arrival_generation = app
        .state::<WorkspaceFileChangeWatchRegistry>()
        .allocate_generation()?;
    dispatch_workspace_file_watch_start(root_path, move |root| {
        let registry = app.state::<WorkspaceFileChangeWatchRegistry>();
        registry.start(&root.to_string_lossy(), arrival_generation, app.clone())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stop_workspace_file_watch(
    root_path: String,
    watch_generation: u64,
    app: AppHandle,
) -> Result<bool, String> {
    validate_workspace_file_watch_stop_root(&root_path)?;
    run_blocking_command(move || {
        let registry = app.state::<WorkspaceFileChangeWatchRegistry>();
        Ok(registry.stop_generation(&root_path, watch_generation))
    })
    .await
}

pub(super) async fn dispatch_workspace_file_watch_start<T, F>(
    root_path: String,
    start: F,
) -> Result<T, String>
where
    F: FnOnce(PathBuf) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        start(root)
    })
    .await
}

pub(super) fn validate_workspace_file_watch_stop_root(root_path: &str) -> Result<(), String> {
    if root_path.len() > MAX_WORKSPACE_WATCH_ROOT_BYTES
        || root_path.contains('\0')
        || Path::new(root_path).is_relative()
    {
        return Err("Workspace watcher stop root is invalid.".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "file_watch_commands_tests.rs"]
mod tests;
