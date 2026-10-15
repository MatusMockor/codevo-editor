use super::workspace_facade::canonicalize_workspace_root;
use crate::blocking_command::run_blocking_command;
use crate::git::{
    CommandGitRepositoryGateway, GitBranch, GitChangedFile, GitRepositoryGateway, GitStatus,
};
#[cfg(not(test))]
use crate::trust::WorkspaceTrustService;
use crate::workspace::{
    FileEntry, FileSearchResult, LocalWorkspaceFileRepository, WorkspaceFileRepository,
};
use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::Mutex;
#[cfg(not(test))]
use tauri::State;

#[tauri::command]
pub(crate) async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    // Directory listing hits the disk; keep it off the main thread so opening a
    // project (loadDirectory) cannot stall the WebView during index I/O.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .read_directory(&PathBuf::from(path))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_files(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    // File-name search walks the workspace tree; keep it off the main thread.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .search_files(&PathBuf::from(root), &query, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[cfg(not(test))]
pub(crate) type GitTrustState<'a> = State<'a, Mutex<WorkspaceTrustService>>;
#[cfg(test)]
pub(crate) type GitTrustState<'a> = bool;

#[cfg(not(test))]
pub(crate) fn trusted_for(trust: &GitTrustState<'_>, root_path: &str) -> Result<bool, String> {
    Ok(trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(root_path)
        .trusted)
}

#[cfg(test)]
pub(crate) fn trusted_for(trust: &GitTrustState<'_>, _root_path: &str) -> Result<bool, String> {
    Ok(*trust)
}

#[tauri::command]
pub(crate) async fn stage_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Staging shells out to `git add` then re-reads status; keep the round-trip
    // off the main thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .stage(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn commit_git_changes(
    root_path: String,
    message: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Committing runs several `git` subprocesses (write-tree, commit-tree, ...);
    // keep the whole sequence off the main thread, bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .commit(&root, &message, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn push_git_changes(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git push` performs network I/O and can block for seconds; it MUST run off
    // the main thread so the WebView stays responsive. Bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .push(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn fetch_git_changes(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .fetch(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_git_branches(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Listing branches shells out to `git for-each-ref`; keep it off the main
    // thread, scoped to the requested repository root (no cross-root leak).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .branch_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_git_remote_branches(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .remote_branch_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn checkout_git_remote_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .checkout_remote_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_current_branch(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Option<String>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Resolving the current branch shells out to git; keep it off the main
    // thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .current_branch(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_git_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git branch <name>` creates a branch WITHOUT switching (the working tree is
    // never touched). Keep it off the main thread, bound to the requested root.
    // The name is validated against git's own ref grammar before it reaches the
    // subprocess (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .create_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_git_branch(
    root_path: String,
    name: String,
    force: bool,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .delete_branch(&root, &name, force)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn switch_git_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git switch <name>` (no `-f`/`--discard`) rewrites the working tree but
    // refuses when local changes would be overwritten, so no work is ever lost.
    // Keep it off the main thread, bound to the requested repository root. The
    // name is validated against git's ref grammar (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .switch_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}
