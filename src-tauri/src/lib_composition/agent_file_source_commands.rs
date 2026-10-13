use crate::agent_file_source::{valid_id, FileSources, INVALID_SOURCE};
use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StageFileSourceRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReleaseFileSourceRequest {
    source_id: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedFileSource {
    source_id: String,
    name: String,
    bytes: u64,
}

#[tauri::command]
pub(crate) async fn stage_agent_attachment_file_source(
    sources: tauri::State<'_, Arc<FileSources>>,
    request: StageFileSourceRequest,
) -> Result<StagedFileSource, String> {
    let sources = Arc::clone(sources.inner());
    run_blocking_command(move || stage(&sources, &request)).await
}

#[tauri::command]
pub(crate) async fn release_agent_attachment_file_source(
    sources: tauri::State<'_, Arc<FileSources>>,
    request: ReleaseFileSourceRequest,
) -> Result<(), String> {
    release(&sources, &request)
}

fn stage(
    sources: &FileSources,
    request: &StageFileSourceRequest,
) -> Result<StagedFileSource, String> {
    let staged = sources.stage(&request.path)?;
    Ok(StagedFileSource {
        source_id: staged.source_id,
        name: staged.name,
        bytes: staged.bytes,
    })
}

fn release(sources: &FileSources, request: &ReleaseFileSourceRequest) -> Result<(), String> {
    if !valid_id(&request.source_id) {
        return Err(INVALID_SOURCE.into());
    }
    sources.release(&request.source_id);
    Ok(())
}

#[cfg(all(test, unix))]
#[path = "agent_file_source_commands_tests.rs"]
mod tests;
