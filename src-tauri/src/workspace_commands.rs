use crate::search::TextSearchOptions;
use crate::workspace_file_commands::{
    read_image_from_root, DescriptorFileEntry, DescriptorFileSearchResult,
    DescriptorTextSearchResult, FileCommandResult, FileRevision, MutationResult,
    WorkspaceFileRepository, WorkspaceImageFile, WorkspaceImageReadError, WorkspaceReplaceResult,
    WorkspaceTextFile,
};
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub(crate) fn workspace_read_text_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<WorkspaceTextFile, String> {
    WorkspaceFileRepository::new(&registry)
        .read_text(&workspace_id, Path::new(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn workspace_read_image_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<WorkspaceImageFile, WorkspaceImageReadError> {
    let root = registry
        .clone_root(&workspace_id)
        .map_err(WorkspaceImageReadError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_image_from_root(&root, Path::new(&relative_path))
    })
    .await
    .map_err(|error| WorkspaceImageReadError::Io {
        message: format!("Command task failed: {error}"),
    })?
}

#[tauri::command]
pub(crate) fn workspace_read_directory(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<Vec<DescriptorFileEntry>, String> {
    WorkspaceFileRepository::new(&registry)
        .read_directory(&workspace_id, Path::new(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn workspace_search_files(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    limit: usize,
) -> Result<Vec<DescriptorFileSearchResult>, String> {
    WorkspaceFileRepository::new(&registry)
        .search_files(&workspace_id, Path::new(&relative_path), &query, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn workspace_search_text(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    limit: usize,
    options: Option<TextSearchOptions>,
) -> Result<Vec<DescriptorTextSearchResult>, String> {
    WorkspaceFileRepository::new(&registry)
        .search_text(
            &workspace_id,
            Path::new(&relative_path),
            &query,
            limit,
            &options.unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn workspace_replace_in_path(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    replacement: String,
    options: Option<TextSearchOptions>,
) -> WorkspaceReplaceResult {
    let repository = WorkspaceFileRepository::new(&registry);
    let options = options.unwrap_or_default();
    let store = match super::local_history_store(&app) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("Local History snapshot failed: {error}");
            return repository.replace_in_path(
                &workspace_id,
                Path::new(&relative_path),
                &query,
                &replacement,
                &options,
            );
        }
    };
    repository.replace_in_path_with_snapshot_sink(
        &workspace_id,
        Path::new(&relative_path),
        &query,
        &replacement,
        &options,
        &store,
    )
}

#[tauri::command]
pub(crate) fn workspace_save_text_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    content: String,
    expected_revision: FileRevision,
) -> FileCommandResult {
    WorkspaceFileRepository::new(&registry).save_text(
        &workspace_id,
        Path::new(&relative_path),
        &content,
        &expected_revision,
    )
}

#[tauri::command]
pub(crate) fn workspace_create_text_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).create_file(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_create_text_file_with_content(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    content: String,
) -> FileCommandResult {
    WorkspaceFileRepository::new(&registry).create_text_with_content(
        &workspace_id,
        Path::new(&relative_path),
        &content,
    )
}

#[tauri::command]
pub(crate) fn workspace_create_directory(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry)
        .create_directory(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_delete_path(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).delete(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_rename_path(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    from_relative_path: String,
    to_relative_path: String,
    overwrite: bool,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).rename(
        &workspace_id,
        Path::new(&from_relative_path),
        Path::new(&to_relative_path),
        overwrite,
    )
}
