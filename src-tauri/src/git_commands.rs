//! Trust-gated Git read and history commands exposed over Tauri IPC.
//!
//! Keeping these adapters together makes their security boundary explicit: every
//! repository operation canonicalizes the requested workspace root, and every Git
//! subprocess except repository discovery is created with the workspace's current
//! trust decision.

use crate::git::{
    self, load_commit_details, load_commit_diff, load_commit_files, load_commit_log,
    load_git_branches, CommandGitRepositoryGateway, CommitDiffPayload, CommitFileChange,
    CommitGraphNode, GitBlameLine, GitBranches, GitChangedFile, GitCommit, GitCommitDetails,
    GitCommitFilters, GitFileDiff, GitFileHistoryEntry, GitRepoStatus, GitRepositoryGateway,
    GitStatus,
};
use crate::{canonicalize_workspace_root, run_blocking_command, trusted_for, GitTrustState};

#[tauri::command]
pub(crate) async fn get_git_status(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    // `git status` shells out to a subprocess and, on large Laravel repos, can
    // take hundreds of milliseconds; it fires on every save and tab switch.
    // Resolve the requested root and run it off the main thread so the WebView
    // never stalls. The captured `root_path` keeps this request bound to its own
    // repository (no cross-root leakage).
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .status(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_repo_status(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitRepoStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = match canonicalize_workspace_root(&root_path) {
            Ok(root) => root,
            Err(_) => {
                return Ok(GitRepoStatus {
                    git_available: git::git_available(),
                    is_repository: false,
                });
            }
        };
        let is_repository = CommandGitRepositoryGateway::new(trusted)
            .status(&root)
            .map(|status| status.is_repository)
            .unwrap_or(false);

        Ok(GitRepoStatus {
            git_available: git::git_available(),
            is_repository,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn detect_git_repositories(
    root_path: String,
    max_depth: Option<usize>,
) -> Result<Vec<String>, String> {
    // Discovery walks the whole workspace tree (bounded by `max_depth`)
    // looking for nested `.git` markers, which on a large multi-repo
    // workspace means a lot of `read_dir`/`symlink_metadata` syscalls; run it
    // off the main thread like every other filesystem-heavy command.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let depth = max_depth.unwrap_or(git::DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH);

        git::detect_git_repositories(&root, depth).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_branches(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitBranches, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_git_branches(&root, trusted).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_commit_log(
    root_path: String,
    filters: GitCommitFilters,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitCommit>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_log(&root, filters, trusted).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_commit_graph_page(
    root_path: String,
    cursor: Option<String>,
    trust: GitTrustState<'_>,
) -> Result<Vec<CommitGraphNode>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let commits = load_commit_log(
            &root,
            GitCommitFilters {
                author: None,
                branch: None,
                cursor,
                limit: Some(200),
                path: None,
                query: None,
            },
            trusted,
        )
        .map_err(|error| error.to_string())?;

        Ok(commits
            .into_iter()
            .map(|commit| CommitGraphNode {
                children: Vec::new(),
                commit: commit.clone(),
                depth: 0,
                hash: commit.hash,
                is_merge: commit.parents.len() > 1,
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_commit_details(
    root_path: String,
    commit_hash: String,
    trust: GitTrustState<'_>,
) -> Result<GitCommitDetails, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_details(&root, &commit_hash, trusted).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn revert_git_commit(
    root_path: String,
    commit_hash: String,
    trust: GitTrustState<'_>,
) -> Result<GitCommit, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .revert_commit(&root, &commit_hash)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn cherry_pick_git_commit(
    root_path: String,
    commit_hash: String,
    trust: GitTrustState<'_>,
) -> Result<GitCommit, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .cherry_pick_commit(&root, &commit_hash)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_commit_files(
    root_path: String,
    commit_hash: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<CommitFileChange>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_files(&root, &commit_hash, trusted).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_commit_diff(
    root_path: String,
    commit_hash: String,
    path: String,
    old_path: Option<String>,
    files: Option<Vec<CommitFileChange>>,
    trust: GitTrustState<'_>,
) -> Result<CommitDiffPayload, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let files = match files {
            Some(files) => files,
            None => load_commit_files(&root, &commit_hash, trusted)
                .map_err(|error| error.to_string())?,
        };
        load_commit_diff(
            &root,
            &commit_hash,
            &path,
            old_path.as_deref(),
            &files,
            trusted,
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_diff(
    root_path: String,
    change: GitChangedFile,
    trust: GitTrustState<'_>,
) -> Result<GitFileDiff, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Diffing shells out to `git` and reads file contents; it fires alongside
    // status on save/switch, so keep it off the main thread, scoped to the
    // requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .diff(&root, &change)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_blame(
    root_path: String,
    relative_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBlameLine>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git blame` shells out to a subprocess that can take a while on large
    // files; keep it off the main thread so the WebView never stalls. The
    // captured `root_path` + `relative_path` bind the request to its own
    // repository and file (no cross-root or cross-file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .blame(&root, &relative_path)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_file_history(
    root_path: String,
    relative_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitFileHistoryEntry>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git log --follow` shells out to a subprocess that can take a while on a
    // file with deep history; keep it off the main thread so the WebView never
    // stalls. The captured `root_path` + `relative_path` bind the request to its
    // own repository and file (no cross-root or cross-file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .file_history(&root, &relative_path)
            .map_err(|error| error.to_string())
    })
    .await
}
