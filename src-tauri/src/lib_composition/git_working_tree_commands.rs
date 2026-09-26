use super::git_surface_commands::{ensure_git_surface_trusted, git_surface_root};
use super::GitTrustState;
use crate::git::file_discard::{
    discard_file, prepare_discard, GitDiscardFile, GitDiscardPreparation, GitDiscardReceipt,
};
use crate::git::head_amend::{
    amend_candidate, amend_head, GitAmendCandidate, GitAmendFile, GitAmendReceipt,
    MAX_AMEND_CHANGES,
};
use crate::run_blocking_command;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitAmendCandidateRequest {
    repository_root: String,
    worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitAmendHeadRequest {
    repository_root: String,
    worktree_path: Option<String>,
    expected_head: String,
    message: String,
    files: Vec<GitAmendFile>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitDiscardFileRequest {
    repository_root: String,
    worktree_path: Option<String>,
    file: GitDiscardFile,
    fingerprint: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitPrepareDiscardRequest {
    repository_root: String,
    worktree_path: Option<String>,
    file: GitDiscardFile,
}

#[tauri::command]
pub(crate) async fn get_git_amend_candidate(
    request: GitAmendCandidateRequest,
    trust: GitTrustState<'_>,
) -> Result<GitAmendCandidate, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        amend_candidate(&root, true).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn amend_git_head(
    request: GitAmendHeadRequest,
    trust: GitTrustState<'_>,
) -> Result<GitAmendReceipt, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    if request.files.len() > MAX_AMEND_CHANGES {
        return Err("Too many files are selected to amend at once.".to_string());
    }
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        amend_head(
            &root,
            &request.expected_head,
            &request.message,
            &request.files,
            true,
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn discard_git_file(
    request: GitDiscardFileRequest,
    trust: GitTrustState<'_>,
) -> Result<GitDiscardReceipt, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        discard_file(&root, &request.file, &request.fingerprint, true)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn prepare_git_discard(
    request: GitPrepareDiscardRequest,
    trust: GitTrustState<'_>,
) -> Result<GitDiscardPreparation, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        prepare_discard(&root, &request.file, true).map_err(|error| error.to_string())
    })
    .await
}

#[cfg(test)]
#[path = "git_working_tree_commands_tests.rs"]
mod tests;
