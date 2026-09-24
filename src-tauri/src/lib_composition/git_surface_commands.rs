use super::git_integration_commands::git_integration;
use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::run_blocking_command;
use git_branch_diff::{branch_changes, branch_file_sides, BranchChanges, BranchFileSides};
use git_surface_status::{git_surface_status, GitSurfaceStatus};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[path = "../git_branch_diff.rs"]
pub(crate) mod git_branch_diff;
#[path = "../git_surface_status.rs"]
pub(crate) mod git_surface_status;

pub(crate) const UNTRUSTED_GIT_SURFACE_ERROR: &str =
    "Git in the right panel requires a trusted repository.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitSurfaceTargetRequest {
    repository_root: String,
    worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitBranchChangesRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base_ref: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitBranchFileDiffRequest {
    repository_root: String,
    worktree_path: Option<String>,
    merge_base: String,
    head_commit: String,
    relative_path: String,
    old_relative_path: Option<String>,
}

pub(crate) fn ensure_git_surface_trusted(
    trust: &GitTrustState<'_>,
    repository_root: &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    if !trusted_for(trust, repository_root)? {
        return Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string());
    }
    let Some(worktree_path) = worktree_path else {
        return Ok(());
    };
    if !trusted_for(trust, worktree_path)? {
        return Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string());
    }
    Ok(())
}

pub(crate) fn git_surface_root(
    repository_root: &str,
    worktree_path: Option<&str>,
) -> Result<PathBuf, String> {
    let root = canonicalize_workspace_root(repository_root)?;
    let targets = git_integration::resolve_ship_targets(&root, worktree_path.map(Path::new))?;
    Ok(targets.worktree)
}

#[tauri::command]
pub(crate) async fn get_git_surface_status(
    request: GitSurfaceTargetRequest,
    trust: GitTrustState<'_>,
) -> Result<GitSurfaceStatus, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        git_surface_status(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_branch_changes(
    request: GitBranchChangesRequest,
    trust: GitTrustState<'_>,
) -> Result<BranchChanges, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        branch_changes(&root, &request.base_ref)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_branch_file_diff(
    request: GitBranchFileDiffRequest,
    trust: GitTrustState<'_>,
) -> Result<BranchFileSides, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        branch_file_sides(
            &root,
            &request.merge_base,
            &request.head_commit,
            &request.relative_path,
            request.old_relative_path.as_deref(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_request_fields() {
        let target = serde_json::from_value::<GitSurfaceTargetRequest>(serde_json::json!({
            "repositoryRoot": "/tmp/x",
            "worktreePath": null,
            "shell": "rm -rf /"
        }));
        let changes = serde_json::from_value::<GitBranchChangesRequest>(serde_json::json!({
            "repositoryRoot": "/tmp/x",
            "worktreePath": null,
            "baseRef": "main",
            "extra": true
        }));
        let sides = serde_json::from_value::<GitBranchFileDiffRequest>(serde_json::json!({
            "repositoryRoot": "/tmp/x",
            "worktreePath": null,
            "mergeBase": "a".repeat(40),
            "headCommit": "b".repeat(40),
            "relativePath": "a.txt",
            "oldRelativePath": null,
            "argv": ["--output=/tmp/x"]
        }));
        assert!(target.is_err());
        assert!(changes.is_err());
        assert!(sides.is_err());
    }

    #[test]
    fn refuses_untrusted_repositories_before_running_git() {
        let root = "/nonexistent-git-surface-root".to_string();
        let status = tauri::async_runtime::block_on(get_git_surface_status(
            GitSurfaceTargetRequest {
                repository_root: root.clone(),
                worktree_path: None,
            },
            false,
        ));
        let changes = tauri::async_runtime::block_on(get_git_branch_changes(
            GitBranchChangesRequest {
                repository_root: root.clone(),
                worktree_path: None,
                base_ref: "main".to_string(),
            },
            false,
        ));
        let sides = tauri::async_runtime::block_on(get_git_branch_file_diff(
            GitBranchFileDiffRequest {
                repository_root: root,
                worktree_path: None,
                merge_base: "a".repeat(40),
                head_commit: "b".repeat(40),
                relative_path: "a.txt".to_string(),
                old_relative_path: None,
            },
            false,
        ));
        assert_eq!(status, Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string()));
        assert_eq!(changes, Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string()));
        assert_eq!(sides, Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string()));
    }

    #[test]
    fn trusted_requests_read_status_and_refuse_worktrees_outside_the_base() {
        let root =
            std::env::temp_dir().join(format!("git-surface-commands-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create repository");
        let git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_SYSTEM", "/dev/null")
                .arg("-C")
                .arg(&root)
                .args(arguments)
                .output()
                .expect("run git");
            assert!(output.status.success(), "git {arguments:?} failed");
        };
        git(&["init", "--initial-branch=main"]);
        git(&[
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@e.x",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ]);
        let repository_root = root.to_string_lossy().to_string();

        let status = tauri::async_runtime::block_on(get_git_surface_status(
            GitSurfaceTargetRequest {
                repository_root: repository_root.clone(),
                worktree_path: None,
            },
            true,
        ));
        let foreign = tauri::async_runtime::block_on(get_git_surface_status(
            GitSurfaceTargetRequest {
                repository_root,
                worktree_path: Some(std::env::temp_dir().to_string_lossy().to_string()),
            },
            true,
        ));
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            status.map(|status| status.branch),
            Ok(Some("main".to_string()))
        );
        assert!(foreign.is_err());
    }
}
