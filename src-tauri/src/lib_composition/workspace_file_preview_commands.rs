use super::workspace_file_preview::{
    read_file_preview_from_root, resolve_preview_root, WorkspaceFilePreview,
};
use crate::run_blocking_command;
use crate::workspace_registry::{validate_relative_path, WorkspaceRegistry};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};
use tauri::State;

const MAX_WORKSPACE_ROOT_BYTES: usize = 4096;
const MAX_RELATIVE_PATH_BYTES: usize = 4096;
const MAX_CONCURRENT_PREVIEW_READS: usize = 8;

static ACTIVE_PREVIEW_READS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceFilePreviewRequest {
    workspace_root: String,
    relative_path: String,
}

struct ValidatedPreviewRequest {
    workspace_root: PathBuf,
    relative_path: String,
}

struct PreviewReadPermit;

impl PreviewReadPermit {
    fn acquire() -> Result<Self, String> {
        let permit = Self;
        if ACTIVE_PREVIEW_READS.fetch_add(1, Ordering::AcqRel) < MAX_CONCURRENT_PREVIEW_READS {
            return Ok(permit);
        }
        drop(permit);
        Err("too many file preview reads are in progress".to_owned())
    }
}

impl Drop for PreviewReadPermit {
    fn drop(&mut self) {
        ACTIVE_PREVIEW_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[tauri::command]
pub(crate) async fn workspace_read_file_preview(
    registry: State<'_, WorkspaceRegistry>,
    request: WorkspaceFilePreviewRequest,
) -> Result<WorkspaceFilePreview, String> {
    let request = validate_request(request)?;
    let permit = PreviewReadPermit::acquire()?;
    let registered = registry.clone_root_for_path(&request.workspace_root);
    run_blocking_command(move || {
        let _permit = permit;
        let root = resolve_preview_root(registered, &request.workspace_root)
            .map_err(|error| error.to_string())?;
        read_file_preview_from_root(&root, &request.relative_path)
            .map_err(|error| error.to_string())
    })
    .await
}

fn validate_request(
    request: WorkspaceFilePreviewRequest,
) -> Result<ValidatedPreviewRequest, String> {
    let WorkspaceFilePreviewRequest {
        workspace_root,
        relative_path,
    } = request;
    if workspace_root.len() > MAX_WORKSPACE_ROOT_BYTES
        || workspace_root.contains('\0')
        || !Path::new(&workspace_root).is_absolute()
    {
        return Err("workspaceRoot must be a bounded absolute path".to_owned());
    }
    if relative_path.len() > MAX_RELATIVE_PATH_BYTES {
        return Err("relativePath is too long".to_owned());
    }
    validate_relative_path(Path::new(&relative_path)).map_err(|error| error.to_string())?;
    Ok(ValidatedPreviewRequest {
        workspace_root: PathBuf::from(workspace_root),
        relative_path,
    })
}

#[cfg(test)]
#[path = "workspace_file_preview_commands_tests.rs"]
mod tests;
