use crate::ignore_matcher::is_default_ignored_name;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: Option<String>,
    pub changes: Vec<GitChangedFile>,
    pub is_repository: bool,
    pub root_path: String,
    pub upstream: Option<GitUpstreamTracking>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpstreamTracking {
    pub ahead: usize,
    pub behind: usize,
    pub branch: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub is_staged: bool,
    pub is_unversioned: bool,
    pub old_path: Option<String>,
    pub old_relative_path: Option<String>,
    pub path: String,
    pub relative_path: String,
    pub status: GitChangeStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitChangeStatus {
    Added,
    Conflicted,
    Deleted,
    Modified,
    Renamed,
    Untracked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub change: GitChangedFile,
    pub language: String,
    pub modified_content: String,
    pub original_content: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub git_available: bool,
    pub is_repository: bool,
}

/// A single hunk from `git diff` (or `git diff --cached`) for one file. The
/// `index` is the hunk's position within that file's diff and is the stable
/// identifier the front-end sends back to stage/unstage exactly that hunk. The
/// `header`/`lines` mirror the unified-diff text verbatim so the preview can
/// render the change without re-deriving it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffHunk {
    pub header: String,
    pub index: u32,
    pub lines: Vec<String>,
    pub is_staged: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub current: Option<String>,
    pub local: Vec<String>,
    pub remotes: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFilters {
    pub author: Option<String>,
    pub branch: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
    pub path: Option<String>,
    pub query: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub abbrev_hash: String,
    pub author_email: String,
    pub author_name: String,
    pub date: String,
    pub hash: String,
    pub labels: Vec<String>,
    pub parents: Vec<String>,
    pub subject: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetails {
    #[serde(flatten)]
    pub commit: GitCommit,
    pub body: String,
    pub containing_branches: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub author: String,
    pub line_number: u32,
    pub sha: String,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileHistoryEntry {
    pub author: String,
    pub sha: String,
    pub subject: String,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    pub is_rename: bool,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub path: String,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub branch: Option<String>,
    pub index: u32,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphNode {
    pub children: Vec<String>,
    pub commit: GitCommit,
    pub depth: usize,
    pub hash: String,
    pub is_merge: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiffPayload {
    pub commit_hash: String,
    pub is_rename: bool,
    pub language: String,
    pub modified_content: String,
    pub old_path: Option<String>,
    pub original_content: String,
    pub path: String,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub is_current: bool,
    pub name: String,
}

pub trait GitRepositoryGateway {
    fn amend(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus>;
    fn blame(&self, root: &Path, relative_path: &str) -> io::Result<Vec<GitBlameLine>>;
    fn file_commit_diff(
        &self,
        root: &Path,
        relative_path: &str,
        sha: &str,
    ) -> io::Result<GitFileDiff>;
    fn file_history(
        &self,
        root: &Path,
        relative_path: &str,
    ) -> io::Result<Vec<GitFileHistoryEntry>>;
    fn commit(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus>;
    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff>;
    fn fetch(&self, root: &Path) -> io::Result<GitStatus>;
    fn pull(&self, root: &Path) -> io::Result<GitStatus>;
    fn push(&self, root: &Path) -> io::Result<GitStatus>;
    fn revert(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn status(&self, root: &Path) -> io::Result<GitStatus>;
    fn unstage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn file_hunks(
        &self,
        root: &Path,
        relative_path: &str,
        staged: bool,
    ) -> io::Result<Vec<GitDiffHunk>>;
    fn stage_hunk(
        &self,
        root: &Path,
        relative_path: &str,
        hunk_index: u32,
    ) -> io::Result<GitStatus>;
    fn unstage_hunk(
        &self,
        root: &Path,
        relative_path: &str,
        hunk_index: u32,
    ) -> io::Result<GitStatus>;
    fn stash_save(&self, root: &Path, message: &str) -> io::Result<()>;
    fn stash_list(&self, root: &Path) -> io::Result<Vec<GitStashEntry>>;
    fn stash_apply(&self, root: &Path, index: u32) -> io::Result<()>;
    fn stash_pop(&self, root: &Path, index: u32) -> io::Result<()>;
    fn stash_show(&self, root: &Path, index: u32) -> io::Result<String>;
    fn stash_drop(&self, root: &Path, index: u32) -> io::Result<()>;
    fn branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>>;
    fn current_branch(&self, root: &Path) -> io::Result<Option<String>>;
    fn create_branch(&self, root: &Path, name: &str) -> io::Result<()>;
    fn switch_branch(&self, root: &Path, name: &str) -> io::Result<()>;
}

pub struct CommandGitRepositoryGateway;

impl CommandGitRepositoryGateway {
    /// Stages (`reverse == false`) or unstages (`reverse == true`) exactly one
    /// hunk by re-running `git diff` for the file, slicing out the hunk at
    /// `hunk_index`, and feeding that minimal patch to `git apply --cached`.
    ///
    /// The patch is assembled from `git`'s own diff output (never hand-built
    /// from line numbers), so EOL style, "no newline at EOF" markers, and
    /// context all stay byte-exact. `git apply --cached` is atomic: a stale or
    /// non-applicable patch exits non-zero and leaves the index untouched, so a
    /// failure is a safe no-op rather than index corruption.
    fn apply_single_hunk(
        &self,
        root: &Path,
        relative_path: &str,
        hunk_index: u32,
        reverse: bool,
    ) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();

        // Unstaging reads the staged diff; staging reads the worktree diff. The
        // patch must come from the same view we will apply against.
        let raw = file_diff_text(&root, &relative, reverse)?;
        let patch = single_hunk_patch(&raw, hunk_index).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "Requested hunk no longer matches the file diff.",
            )
        })?;

        let mut args = vec!["apply", "--cached", "--unidiff-zero", "--recount"];

        if reverse {
            args.push("--reverse");
        }

        run_git_with_stdin(&root, &args, patch.as_bytes())?;
        self.status(&root)
    }
}

impl GitRepositoryGateway for CommandGitRepositoryGateway {
    fn amend(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        if changes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "At least one file is required for amend.",
            ));
        }

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            if let Some(old_relative_path) = change.old_relative_path.as_deref() {
                safe_relative_path(old_relative_path)?;
            }
        }

        refuse_amend_of_pushed_head(&root)?;
        amend_selected_staged_changes(&root, message.trim(), changes)?;
        self.status(&root)
    }

    fn blame(&self, root: &Path, relative_path: &str) -> io::Result<Vec<GitBlameLine>> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("blame")
            .arg("--porcelain")
            .arg("--")
            .arg(&relative)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        parse_blame_porcelain(&output.stdout)
    }

    fn file_commit_diff(
        &self,
        root: &Path,
        relative_path: &str,
        sha: &str,
    ) -> io::Result<GitFileDiff> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();
        let sha = safe_commit_sha(sha)?;

        let original_content = commit_blob_content(&root, &format!("{sha}^"), &relative)?;
        let modified_content = commit_blob_content(&root, &sha, &relative)?;
        let status = commit_file_change_status(&original_content, &modified_content);

        Ok(GitFileDiff {
            change: GitChangedFile {
                is_staged: false,
                is_unversioned: false,
                old_path: None,
                old_relative_path: None,
                path: root.join(&relative).to_string_lossy().to_string(),
                relative_path: relative.clone(),
                status,
            },
            language: language_for_path(&relative),
            modified_content,
            original_content,
        })
    }

    fn file_history(
        &self,
        root: &Path,
        relative_path: &str,
    ) -> io::Result<Vec<GitFileHistoryEntry>> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("log")
            .arg("--follow")
            .arg(format!("--format={FILE_HISTORY_FORMAT}"))
            .arg("--")
            .arg(&relative)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(parse_file_history(&String::from_utf8_lossy(&output.stdout)))
    }

    fn commit(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;
        let message = message.trim();

        if message.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Commit message is required.",
            ));
        }

        if changes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "At least one file is required for commit.",
            ));
        }

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            if let Some(old_relative_path) = change.old_relative_path.as_deref() {
                safe_relative_path(old_relative_path)?;
            }
        }

        commit_selected_staged_changes(&root, message, changes)?;
        self.status(&root)
    }

    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff> {
        let root = root.canonicalize()?;
        let original_content = original_content(&root, change)?;
        let modified_content = modified_content(&root, change)?;

        Ok(GitFileDiff {
            change: change.clone(),
            language: language_for_path(&change.relative_path),
            modified_content,
            original_content,
        })
    }

    fn fetch(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git_remote(&root, ["fetch", "--prune"])?;
        self.status(&root)
    }

    fn pull(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git_remote(&root, ["pull", "--ff-only"])?;
        self.status(&root)
    }

    fn push(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git_remote(&root, ["push"])?;
        self.status(&root)
    }

    fn revert(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;

            if change.status == GitChangeStatus::Untracked {
                run_git(&root, ["clean", "-f", "--", change.relative_path.as_str()])?;
            } else if change.status == GitChangeStatus::Added && change.is_staged {
                run_git(
                    &root,
                    ["restore", "--staged", "--", change.relative_path.as_str()],
                )?;
                run_git(&root, ["clean", "-f", "--", change.relative_path.as_str()])?;
            } else {
                if change.is_staged {
                    run_git(
                        &root,
                        ["restore", "--staged", "--", change.relative_path.as_str()],
                    )?;
                }

                run_git(&root, ["restore", "--", change.relative_path.as_str()])?;
            }
        }

        self.status(&root)
    }

    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            run_git(&root, ["add", "--", change.relative_path.as_str()])?;
        }

        self.status(&root)
    }

    fn status(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        if !is_git_repository(&root)? {
            return Ok(empty_git_status(&root));
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("status")
            .arg("--porcelain=v1")
            .arg("-z")
            .arg("--untracked-files=normal")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        let branch = current_branch(&root).ok().flatten();
        let upstream = branch.as_ref().and_then(|_| upstream_tracking(&root));

        Ok(GitStatus {
            branch,
            changes: parse_porcelain_status(&root, &output.stdout)?,
            is_repository: true,
            root_path: root.to_string_lossy().to_string(),
            upstream,
        })
    }

    fn unstage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            run_git(
                &root,
                ["restore", "--staged", "--", change.relative_path.as_str()],
            )?;
        }

        self.status(&root)
    }

    fn file_hunks(
        &self,
        root: &Path,
        relative_path: &str,
        staged: bool,
    ) -> io::Result<Vec<GitDiffHunk>> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();

        let raw = file_diff_text(&root, &relative, staged)?;
        Ok(parse_diff_hunks(&raw, staged))
    }

    fn stage_hunk(
        &self,
        root: &Path,
        relative_path: &str,
        hunk_index: u32,
    ) -> io::Result<GitStatus> {
        self.apply_single_hunk(root, relative_path, hunk_index, false)
    }

    fn unstage_hunk(
        &self,
        root: &Path,
        relative_path: &str,
        hunk_index: u32,
    ) -> io::Result<GitStatus> {
        self.apply_single_hunk(root, relative_path, hunk_index, true)
    }

    fn stash_save(&self, root: &Path, message: &str) -> io::Result<()> {
        let root = root.canonicalize()?;
        let message = message.trim();

        if message.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Stash message is required.",
            ));
        }

        // `--include-untracked` mirrors PhpStorm's "stash changes" (untracked
        // working-tree files are part of WIP). When the working tree is clean,
        // `git stash push` exits 0 and prints "No local changes to save" rather
        // than failing; surface that as an error so the UI never reports a
        // phantom stash.
        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("stash")
            .arg("push")
            .arg("--include-untracked")
            .arg("-m")
            .arg(message)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.contains("No local changes to save") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "No local changes to stash.",
            ));
        }

        Ok(())
    }

    fn stash_list(&self, root: &Path) -> io::Result<Vec<GitStashEntry>> {
        let root = root.canonicalize()?;

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("stash")
            .arg("list")
            .arg(format!("--format={STASH_LIST_FORMAT}"))
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(parse_stash_list(&String::from_utf8_lossy(&output.stdout)))
    }

    fn stash_apply(&self, root: &Path, index: u32) -> io::Result<()> {
        let root = root.canonicalize()?;
        let reference = stash_reference(index);

        run_git(&root, ["stash", "apply", reference.as_str()])
    }

    fn stash_pop(&self, root: &Path, index: u32) -> io::Result<()> {
        let root = root.canonicalize()?;
        let reference = stash_reference(index);

        run_git(&root, ["stash", "pop", reference.as_str()])
    }

    fn stash_show(&self, root: &Path, index: u32) -> io::Result<String> {
        let root = root.canonicalize()?;
        let reference = stash_reference(index);

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("stash")
            .arg("show")
            .arg("-p")
            .arg(&reference)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    fn stash_drop(&self, root: &Path, index: u32) -> io::Result<()> {
        let root = root.canonicalize()?;
        let reference = stash_reference(index);

        run_git(&root, ["stash", "drop", reference.as_str()])
    }

    fn branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>> {
        let root = root.canonicalize()?;

        // `for-each-ref` over `refs/heads/` lists only LOCAL branches (no remote
        // tracking refs leak in). `%(HEAD)` is `*` for the checked-out branch and
        // a space otherwise; fields are joined with the ASCII Unit Separator so a
        // branch name can never be confused with the current-flag column.
        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("for-each-ref")
            .arg(format!("--format={BRANCH_LIST_FORMAT}"))
            .arg("refs/heads/")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(parse_branch_list(&String::from_utf8_lossy(&output.stdout)))
    }

    fn current_branch(&self, root: &Path) -> io::Result<Option<String>> {
        let root = root.canonicalize()?;

        current_branch(&root)
    }

    fn create_branch(&self, root: &Path, name: &str) -> io::Result<()> {
        let root = root.canonicalize()?;
        let name = safe_branch_name(name)?;

        // `git branch <name>` creates the branch WITHOUT switching to it, so the
        // working tree is never touched. `--` terminates option parsing so a name
        // can never be read as a flag (defence in depth atop `safe_branch_name`).
        run_git(&root, ["branch", "--", name.as_str()])
    }

    fn switch_branch(&self, root: &Path, name: &str) -> io::Result<()> {
        let root = root.canonicalize()?;
        let name = safe_branch_name(name)?;

        // `git switch <name>` (no `-f`/`--discard`) refuses when local changes
        // would be overwritten, surfacing git's "commit or stash" error verbatim.
        // Work is never discarded; the front end turns the failure into a notice.
        run_git(&root, ["switch", "--", name.as_str()])
    }
}

pub fn empty_git_status(root: &Path) -> GitStatus {
    GitStatus {
        branch: None,
        changes: Vec::new(),
        is_repository: false,
        root_path: root.to_string_lossy().to_string(),
        upstream: None,
    }
}

/// Default bound for [`detect_git_repositories`]'s walk. Multi-repo
/// workspaces (a PhpStorm-style "directory mapping" project) nest their
/// repositories a handful of levels deep (e.g. `workbench/some-package`), so
/// four levels comfortably covers real layouts without an unbounded walk.
pub const DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH: usize = 4;

const GIT_MARKER: &str = ".git";

/// Directory names that are never a project's own repository and are safe to
/// skip entirely during discovery, beyond the workspace-wide ignore list
/// (`node_modules`, `vendor`, build/coverage output, ...). These specifically
/// cover the temp/log/cache/storage trees Laravel and Node projects leave
/// behind (e.g. `storage/framework`, `storage/logs`).
const ADDITIONAL_DISCOVERY_SKIPPED_NAMES: &[&str] =
    &["tmp", "temp", "log", "logs", "storage", "cache"];

/// Finds every git repository nested inside `root`, returning root-relative,
/// posix-separated paths in sorted (deterministic) order. `root` itself is
/// represented by an empty string when it is a repository.
///
/// A repository is recognized by a `.git` entry, which may be a directory (a
/// normal clone) or a file (a linked worktree or a submodule, both of which
/// point at their real `.git` directory via a `gitdir:` pointer file).
///
/// The walk is bounded to `max_depth` directory levels below `root` and never
/// descends into `.git` itself, the default ignored directories that never
/// hold a project's own repository (`node_modules`, `vendor`, temp/log/cache
/// output, ...), or a symlinked directory. Skipping symlinked directories both
/// breaks cycles (a repository symlinking into one of its own ancestors) and
/// avoids reporting the same physical repository twice through a vendored
/// alias, e.g. `vendor/pkg -> ../workbench/pkg`.
pub fn detect_git_repositories(root: &Path, max_depth: usize) -> io::Result<Vec<String>> {
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Workspace root is not a directory.",
        ));
    }

    let mut discovered = Vec::new();

    if has_git_marker(root) {
        discovered.push(String::new());
    }

    walk_for_git_repositories(root, root, 0, max_depth, &mut discovered);
    discovered.sort();

    Ok(discovered)
}

fn walk_for_git_repositories(
    root: &Path,
    directory: &Path,
    depth: usize,
    max_depth: usize,
    discovered: &mut Vec<String>,
) {
    if depth >= max_depth {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        // An unreadable directory (permissions, a race with deletion, ...) is
        // skipped rather than failing the whole discovery walk.
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // `symlink_metadata` never follows the entry itself, so a symlinked
        // directory is correctly identified (and skipped) instead of being
        // treated as the directory it points at.
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }

        let name = entry.file_name();
        let name = name.to_string_lossy();

        if is_discovery_skipped_directory(&name) {
            continue;
        }

        if has_git_marker(&path) {
            if let Ok(relative) = path.strip_prefix(root) {
                discovered.push(relative.to_string_lossy().to_string());
            }
        }

        walk_for_git_repositories(root, &path, depth + 1, max_depth, discovered);
    }
}

fn has_git_marker(directory: &Path) -> bool {
    fs::symlink_metadata(directory.join(GIT_MARKER)).is_ok()
}

fn is_discovery_skipped_directory(name: &str) -> bool {
    is_default_ignored_name(name) || ADDITIONAL_DISCOVERY_SKIPPED_NAMES.contains(&name)
}

fn is_git_repository(root: &Path) -> io::Result<bool> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()?;

    if !output.status.success() {
        return Ok(false);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn load_git_branches(root: &Path) -> io::Result<GitBranches> {
    let local = git_output_vec(root, vec!["branch", "--format=%(refname:short)"])?;
    let remotes = git_output_vec(
        root,
        vec!["branch", "--remotes", "--format=%(refname:short)"],
    )?;

    let mut remote_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in remotes.lines() {
        let line = line.trim();

        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, '/');
        let remote = parts.next().unwrap_or("");
        let branch = parts.next();

        if remote.is_empty() || branch.is_none() {
            continue;
        }

        let branch = branch.unwrap_or_default();
        if branch == "HEAD" || branch.starts_with("HEAD ->") {
            continue;
        }

        let remote_branches = remote_groups.entry(remote.to_string()).or_default();
        remote_branches.push(branch.to_string());
    }

    Ok(GitBranches {
        current: current_branch(root).ok().flatten(),
        local: local
            .lines()
            .map(str::trim)
            .map(str::to_owned)
            .filter(|branch| !branch.is_empty())
            .collect(),
        remotes: remote_groups,
    })
}

pub fn load_commit_log(root: &Path, filters: GitCommitFilters) -> io::Result<Vec<GitCommit>> {
    let limit = filters.limit.unwrap_or(100);
    let mut args: Vec<String> = vec![
        "log".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        format!("--max-count={limit}"),
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%B%x1f%D%x00".to_string(),
    ];

    if let Some(skip) = filters
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
    {
        args.push(format!("--skip={skip}"));
    }

    if let Some(author) = filters.author.as_deref().filter(|value| !value.is_empty()) {
        args.push(format!("--author={author}"));
    }

    if let Some(query) = filters.query.as_deref().filter(|value| !value.is_empty()) {
        args.push("--regexp-ignore-case".to_string());
        args.push(format!("--grep={query}"));
    }

    let range_ref = filters.branch.unwrap_or_else(|| "HEAD".to_string());
    if !git_ref_has_commits(root, &range_ref) {
        return Ok(Vec::new());
    }

    args.push(range_ref);

    if let Some(path) = filters.path.as_deref().filter(|value| !value.is_empty()) {
        args.push("--".to_string());
        args.push(path.to_string());
    }

    let output = git_output_vec(root, args)?;
    Ok(parse_commit_log_output(&output))
}

fn git_ref_has_commits(root: &Path, reference: &str) -> bool {
    git_output_vec(root, vec!["rev-parse", "--verify", reference]).is_ok()
}

fn parse_commit_log_output(output: &str) -> Vec<GitCommit> {
    output
        .split('\0')
        .filter(|entry| !entry.trim().is_empty())
        .filter_map(|entry| {
            let fields: Vec<&str> = entry.split('\x1f').collect();
            if fields.len() < 9 {
                return None;
            }

            Some(parse_git_commit_from_fields(&fields))
        })
        .collect()
}

fn parse_git_commit_from_fields(fields: &[&str]) -> GitCommit {
    let labels = parse_git_labels(fields[8]);
    let parents = fields[6]
        .split_whitespace()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    GitCommit {
        abbrev_hash: fields[1].trim().to_string(),
        author_email: fields[3].trim().to_string(),
        author_name: fields[2].trim().to_string(),
        date: fields[4].trim().to_string(),
        hash: fields[0].trim().to_string(),
        labels,
        parents,
        subject: fields[5].trim().to_string(),
    }
}

fn parse_git_labels(value: &str) -> Vec<String> {
    let raw = value.trim().trim_start_matches('(').trim_end_matches(')');
    if raw.is_empty() {
        return Vec::new();
    }

    raw.split(',')
        .filter_map(|piece| {
            let label = piece.trim();
            if label.is_empty() || label == "HEAD" || label == "tag: HEAD" {
                return None;
            }

            if label.starts_with("tag: ") || label.starts_with("origin/") {
                Some(label.to_string())
            } else if label.starts_with("HEAD -> ") {
                Some(
                    label
                        .split("->")
                        .nth(1)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string(),
                )
            } else {
                Some(label.to_string())
            }
        })
        .collect()
}

pub fn load_commit_details(root: &Path, commit_hash: &str) -> io::Result<GitCommitDetails> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let command =
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%B%x1f%D%x00".to_string();
    let output = git_output_vec(root, vec!["show", "-s", &command, &commit_hash])?;
    let commit = output
        .split('\0')
        .filter(|entry| !entry.trim().is_empty())
        .next()
        .map(|entry| {
            let fields: Vec<&str> = entry.split('\x1f').collect();
            parse_git_commit_from_fields(&fields)
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Commit not found."))?;

    let body = git_output_vec(root, vec!["log", "-1", "--pretty=%B", &commit_hash])?
        .trim_end()
        .to_string();

    let containing_local = git_output_vec(
        root,
        vec![
            "branch",
            "--format=%(refname:short)",
            "--contains",
            &commit_hash,
        ],
    )?;
    let containing_remote = git_output_vec(
        root,
        vec![
            "branch",
            "--remotes",
            "--format=%(refname:short)",
            "--contains",
            &commit_hash,
        ],
    )?;

    let mut containing_branches = containing_local
        .lines()
        .filter_map(|value| {
            let branch = value.trim();
            if branch.is_empty() {
                None
            } else {
                Some(branch.to_string())
            }
        })
        .collect::<Vec<_>>();

    let remote_branches = containing_remote
        .lines()
        .filter_map(|value| {
            let branch = value.trim();
            if branch.is_empty() {
                None
            } else {
                Some(branch.to_string())
            }
        })
        .collect::<Vec<_>>();

    for branch in remote_branches {
        if !containing_branches.contains(&branch) {
            containing_branches.push(branch);
        }
    }

    Ok(GitCommitDetails {
        commit,
        body,
        containing_branches,
    })
}

pub fn load_commit_files(root: &Path, commit_hash: &str) -> io::Result<Vec<CommitFileChange>> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let output = git_output_vec(
        root,
        vec!["show", "--pretty=format:", "--name-status", &commit_hash],
    )?;

    Ok(output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut fields: Vec<&str> = line.split('\t').collect();
            if fields.is_empty() {
                return None;
            }

            let status = fields.remove(0);
            if status.is_empty() {
                return None;
            }

            if status.starts_with('R') {
                if fields.len() < 2 {
                    return None;
                }

                let old_path = fields.first().copied().map(ToOwned::to_owned);
                let new_path = fields.get(1).copied().map(ToOwned::to_owned);

                return Some(CommitFileChange {
                    is_rename: true,
                    new_path,
                    old_path,
                    path: fields.get(1).copied().unwrap_or_default().to_string(),
                    status: "R".to_string(),
                });
            }

            if fields.is_empty() {
                return None;
            }

            Some(CommitFileChange {
                is_rename: false,
                old_path: None,
                new_path: None,
                path: fields[0].to_string(),
                status: status.chars().next().unwrap_or('M').to_string(),
            })
        })
        .collect())
}

pub fn load_commit_diff(
    root: &Path,
    commit_hash: &str,
    path: &str,
    old_path: Option<&str>,
    files: &[CommitFileChange],
) -> io::Result<CommitDiffPayload> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let normalized_old_path = old_path.unwrap_or(path);

    let file = files
        .iter()
        .find(|candidate| {
            if candidate.is_rename {
                candidate.path == path
                    || candidate
                        .old_path
                        .as_deref()
                        .is_some_and(|value| value == normalized_old_path)
            } else {
                candidate.path == path
            }
        })
        .or_else(|| {
            files
                .iter()
                .find(|candidate| candidate.path == normalized_old_path)
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Commit file not found."))?;

    let old_content = git_output_vec(
        root,
        vec![
            "show",
            "--no-color",
            &format!("{}^:{}", commit_hash, normalized_old_path),
        ],
    )
    .unwrap_or_default();
    let modified_content = git_output_vec(
        root,
        vec!["show", "--no-color", &format!("{}:{}", commit_hash, path)],
    )
    .unwrap_or_default();

    Ok(CommitDiffPayload {
        commit_hash: commit_hash.to_string(),
        is_rename: file.is_rename,
        language: language_for_path(path),
        modified_content,
        old_path: old_path.map(ToOwned::to_owned),
        original_content: old_content,
        path: path.to_string(),
        status: file.status.to_string(),
    })
}

fn current_branch(root: &Path) -> io::Result<Option<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("branch")
        .arg("--show-current")
        .output()?;

    if !output.status.success() {
        return Ok(None);
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if branch.is_empty() {
        return Ok(None);
    }

    Ok(Some(branch))
}

fn upstream_tracking(root: &Path) -> Option<GitUpstreamTracking> {
    let branch = git_output_vec(root, vec!["rev-parse", "--abbrev-ref", "@{u}"])
        .ok()?
        .trim()
        .to_string();

    if branch.is_empty() {
        return None;
    }

    let counts = git_output_vec(
        root,
        vec!["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    )
    .ok()?;
    let mut counts = counts.split_whitespace();
    let behind = counts.next()?.parse().ok()?;
    let ahead = counts.next()?.parse().ok()?;

    if counts.next().is_some() {
        return None;
    }

    Some(GitUpstreamTracking {
        ahead,
        behind,
        branch,
    })
}

fn parse_porcelain_status(root: &Path, output: &[u8]) -> io::Result<Vec<GitChangedFile>> {
    let parts: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .collect();
    let mut changes = Vec::new();
    let mut index = 0usize;

    while index < parts.len() {
        let entry = String::from_utf8_lossy(parts[index]).to_string();
        index += 1;

        if entry.len() < 4 {
            continue;
        }

        let status_code = &entry[..2];
        let relative_path = entry[3..].to_string();
        let status = git_change_status(status_code);
        let is_staged = git_change_is_staged(status_code);
        let is_unversioned = status == GitChangeStatus::Untracked;
        let old_relative_path = match status {
            GitChangeStatus::Renamed => {
                let old = parts
                    .get(index)
                    .map(|part| String::from_utf8_lossy(part).to_string());

                if old.is_some() {
                    index += 1;
                }

                old
            }
            _ => None,
        };

        let path = workspace_file_path(root, &relative_path)?;
        let old_path = match old_relative_path.as_deref() {
            Some(path) => Some(workspace_file_path(root, path)?),
            None => None,
        };

        changes.push(GitChangedFile {
            is_staged,
            is_unversioned,
            old_path,
            old_relative_path,
            path,
            relative_path,
            status,
        });
    }

    Ok(changes)
}

struct BlameCommitMeta {
    author: String,
    timestamp: i64,
}

impl BlameCommitMeta {
    fn empty() -> Self {
        Self {
            author: String::new(),
            timestamp: 0,
        }
    }
}

fn parse_blame_porcelain(output: &[u8]) -> io::Result<Vec<GitBlameLine>> {
    let text = String::from_utf8_lossy(output);
    let mut commits: std::collections::HashMap<String, BlameCommitMeta> =
        std::collections::HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(String, u32)> = None;

    for line in text.lines() {
        // The single `\t`-prefixed line per group is the source line; it closes
        // the in-flight group, resolving its metadata from the per-SHA cache.
        if line.starts_with('\t') {
            if let Some((sha, final_line)) = current.take() {
                lines.push(blame_line_from(&commits, &sha, final_line));
            }
            continue;
        }

        if let Some((sha, final_line)) = parse_blame_header(line) {
            commits
                .entry(sha.clone())
                .or_insert_with(BlameCommitMeta::empty);
            current = Some((sha, final_line));
            continue;
        }

        // Metadata line (author/author-time/...) for the in-flight commit.
        if let Some((sha, _)) = current.as_ref() {
            apply_blame_commit_meta(&mut commits, sha, line);
        }
    }

    // Surface a final group whose closing content line was missing (truncated
    // porcelain) so the line we already identified is not silently dropped.
    if let Some((sha, final_line)) = current.take() {
        lines.push(blame_line_from(&commits, &sha, final_line));
    }

    Ok(lines)
}

fn blame_line_from(
    commits: &std::collections::HashMap<String, BlameCommitMeta>,
    sha: &str,
    final_line: u32,
) -> GitBlameLine {
    let meta = commits.get(sha);

    GitBlameLine {
        author: meta.map(|meta| meta.author.clone()).unwrap_or_default(),
        line_number: final_line,
        sha: short_sha(sha),
        timestamp: meta.map(|meta| meta.timestamp).unwrap_or_default(),
    }
}

fn parse_blame_header(line: &str) -> Option<(String, u32)> {
    let mut parts = line.split(' ');
    let sha = parts.next()?;

    if sha.len() != 40 || !sha.chars().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }

    let _original_line = parts.next()?;
    let final_line = parts.next()?.parse::<u32>().ok()?;

    Some((sha.to_string(), final_line))
}

fn apply_blame_commit_meta(
    commits: &mut std::collections::HashMap<String, BlameCommitMeta>,
    sha: &str,
    line: &str,
) {
    let Some(meta) = commits.get_mut(sha) else {
        return;
    };

    if let Some(author) = line.strip_prefix("author ") {
        meta.author = author.to_string();
        return;
    }

    if let Some(timestamp) = line.strip_prefix("author-time ") {
        meta.timestamp = timestamp.trim().parse::<i64>().unwrap_or_default();
    }
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

/// `git log` record layout for file history. Fields are joined with the ASCII
/// Unit Separator (`%x1f`) so commit subjects, author names, and timestamps are
/// parsed unambiguously even when a subject contains spaces or tabs. Records are
/// newline-delimited (one commit per line).
const FILE_HISTORY_FORMAT: &str = "%H%x1f%an%x1f%at%x1f%s";

fn parse_file_history(output: &str) -> Vec<GitFileHistoryEntry> {
    output
        .lines()
        .filter_map(parse_file_history_record)
        .collect()
}

fn parse_file_history_record(line: &str) -> Option<GitFileHistoryEntry> {
    let mut fields = line.split('\u{1f}');
    let sha = fields.next()?;

    if sha.len() != 40 || !sha.chars().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }

    let author = fields.next()?.to_string();
    let timestamp = fields.next()?.trim().parse::<i64>().ok()?;
    let subject = fields.next().unwrap_or_default().to_string();

    Some(GitFileHistoryEntry {
        author,
        sha: short_sha(sha),
        subject,
        timestamp,
    })
}

/// `git stash list` record layout. Fields are joined with the ASCII Unit
/// Separator (`%x1f`) so a stash message containing spaces, tabs, or colons is
/// parsed unambiguously. `%gd` is the stash selector (`stash@{N}`), `%ct` the
/// committer timestamp, `%gs` the reflog subject (the stash message). Records
/// are newline-delimited (one stash per line).
const STASH_LIST_FORMAT: &str = "%gd%x1f%ct%x1f%gs";

fn parse_stash_list(output: &str) -> Vec<GitStashEntry> {
    output.lines().filter_map(parse_stash_list_record).collect()
}

fn parse_stash_list_record(line: &str) -> Option<GitStashEntry> {
    let mut fields = line.split('\u{1f}');
    let index = parse_stash_selector_index(fields.next()?)?;
    let timestamp = fields.next()?.trim().parse::<i64>().ok()?;
    let raw_message = fields.next().unwrap_or_default();
    let (branch, message) = split_stash_branch_and_message(raw_message);

    Some(GitStashEntry {
        branch,
        index,
        message: message.to_string(),
        timestamp,
    })
}

/// Extracts the numeric index from a `stash@{N}` selector. Any other shape is
/// rejected so a malformed reflog line is skipped instead of mis-indexed.
fn parse_stash_selector_index(selector: &str) -> Option<u32> {
    let inner = selector.strip_prefix("stash@{")?.strip_suffix('}')?;

    inner.parse::<u32>().ok()
}

/// Splits the reflog subject (e.g. `WIP on main: 1a2b3c4 ...` or
/// `On feature/x: ...`) into its branch (when present) and the full message.
/// The message is preserved verbatim so colons inside it are never lost.
fn split_stash_branch_and_message(raw_message: &str) -> (Option<String>, &str) {
    let after_prefix = raw_message
        .strip_prefix("WIP on ")
        .or_else(|| raw_message.strip_prefix("On "));

    let Some(after_prefix) = after_prefix else {
        return (None, raw_message);
    };

    let Some((branch, _)) = after_prefix.split_once(':') else {
        return (None, raw_message);
    };

    (Some(branch.to_string()), raw_message)
}

/// Builds the `stash@{N}` selector from a validated numeric index. The index is
/// a `u32`, so it can never inject a git option or escape the selector braces
/// (no path/SHA-style sanitization is needed at this layer).
fn stash_reference(index: u32) -> String {
    format!("stash@{{{index}}}")
}

/// `git for-each-ref` record layout for the local branch list. `%(HEAD)` is a
/// single column: `*` for the checked-out branch, a space otherwise, immediately
/// followed by the short ref name (`for-each-ref` does NOT expand `%x1f`/`%x09`
/// the way `git log` does, so a fixed one-char prefix is the unambiguous join).
/// Records are newline-delimited (one branch per line).
const BRANCH_LIST_FORMAT: &str = "%(HEAD)%(refname:short)";

fn parse_branch_list(output: &str) -> Vec<GitBranch> {
    let mut branches: Vec<GitBranch> = output.lines().filter_map(parse_branch_record).collect();

    // Pin the current branch to the top (PhpStorm parity); the remaining branches
    // keep git's alphabetical `for-each-ref` order. A stable sort preserves that
    // relative order among the non-current entries.
    branches.sort_by_key(|branch| !branch.is_current);
    branches
}

fn parse_branch_record(line: &str) -> Option<GitBranch> {
    let mut chars = line.chars();
    let head_flag = chars.next()?;

    // The first column is always `*` (current) or a space (other). Anything else
    // is a malformed record and is skipped rather than mis-parsed.
    if head_flag != '*' && head_flag != ' ' {
        return None;
    }

    let name = chars.as_str().trim();

    if name.is_empty() {
        return None;
    }

    Some(GitBranch {
        is_current: head_flag == '*',
        name: name.to_string(),
    })
}

/// Validates a branch name supplied by the front end before it reaches a `git`
/// subprocess. Delegates to `git check-ref-format --branch`, the authoritative
/// rule set git itself applies (rejects names with spaces, `..`, control chars,
/// leading `-`, `~^:?*[\`, trailing `.lock`, etc.). This blocks both invalid
/// refs and option/shell injection without re-implementing git's grammar.
fn safe_branch_name(name: &str) -> io::Result<String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is required.",
        ));
    }

    // A leading `-` would still be read as an option by `check-ref-format` itself,
    // so reject it up front; valid branch names never start with a dash.
    if trimmed.starts_with('-') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is invalid.",
        ));
    }

    // `check-ref-format --branch` expands the `@{...}` "branch shortcut" syntax
    // (e.g. `@{-1}` = previous branch) against the current repo, so it would both
    // accept a repo-relative reference and depend on repo state. Reject any name
    // containing it: a real branch name never needs `@{`.
    if trimmed.contains("@{") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is invalid.",
        ));
    }

    let valid = Command::new("git")
        .arg("check-ref-format")
        .arg("--branch")
        .arg(trimmed)
        .output()?
        .status
        .success();

    if !valid {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is invalid.",
        ));
    }

    Ok(trimmed.to_string())
}

/// Validates a stash index string supplied by the front end. Only ASCII digits
/// are accepted (parsed into a `u32`), so a crafted argument can neither inject
/// a git option nor escape the `stash@{...}` selector into another revision.
pub fn safe_stash_index(index: &str) -> io::Result<u32> {
    let trimmed = index.trim();

    if trimmed.is_empty() || !trimmed.chars().all(|byte| byte.is_ascii_digit()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git stash index is invalid.",
        ));
    }

    trimmed
        .parse::<u32>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Git stash index is invalid."))
}

/// Validates a commit revision supplied by the front end before it reaches a
/// `git` subprocess. Accepts the abbreviated SHAs surfaced by file history
/// (hex digits only) so a crafted argument can neither inject git options nor
/// escape into another revision (e.g. `HEAD`, ranges, or flags).
fn safe_commit_sha(sha: &str) -> io::Result<String> {
    let trimmed = sha.trim();

    if trimmed.len() < 4
        || trimmed.len() > 40
        || !trimmed.chars().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git commit SHA is invalid.",
        ));
    }

    Ok(trimmed.to_string())
}

/// Reads a file's blob at a given revision. A missing path at that revision
/// (the file did not exist yet, e.g. the parent of its first commit) is not an
/// error: it yields empty content so the diff renders as a pure addition.
fn commit_blob_content(root: &Path, revision: &str, relative_path: &str) -> io::Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("show")
        .arg(format!("{revision}:{relative_path}"))
        .output()?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn commit_file_change_status(original: &str, modified: &str) -> GitChangeStatus {
    if original.is_empty() && !modified.is_empty() {
        return GitChangeStatus::Added;
    }

    if !original.is_empty() && modified.is_empty() {
        return GitChangeStatus::Deleted;
    }

    GitChangeStatus::Modified
}

fn git_change_is_staged(status: &str) -> bool {
    status
        .chars()
        .next()
        .is_some_and(|value| value != ' ' && value != '?')
}

fn git_change_status(status: &str) -> GitChangeStatus {
    if status == "??" {
        return GitChangeStatus::Untracked;
    }

    if status.contains('U') || matches!(status, "AA" | "DD") {
        return GitChangeStatus::Conflicted;
    }

    if status.contains('R') {
        return GitChangeStatus::Renamed;
    }

    if status.contains('D') {
        return GitChangeStatus::Deleted;
    }

    if status.contains('A') {
        return GitChangeStatus::Added;
    }

    GitChangeStatus::Modified
}

fn run_git<const N: usize>(root: &Path, args: [&str; N]) -> io::Result<()> {
    run_git_vec(root, args.to_vec())
}

fn run_git_remote<const N: usize>(root: &Path, args: [&str; N]) -> io::Result<()> {
    let output = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(root)
        .args(args.to_vec())
        .output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn run_git_vec(root: &Path, args: Vec<&str>) -> io::Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn git_output_vec<S: AsRef<str>>(root: &Path, args: Vec<S>) -> io::Result<String> {
    git_output_vec_with_env(root, args, None)
}

fn git_output_vec_with_env<S: AsRef<str>>(
    root: &Path,
    args: Vec<S>,
    index_file: Option<&Path>,
) -> io::Result<String> {
    let command_args: Vec<String> = args
        .into_iter()
        .map(|value| value.as_ref().to_owned())
        .collect();

    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(&command_args);

    if let Some(index_file) = index_file {
        command.env("GIT_INDEX_FILE", index_file);
    }

    let output = command.output()?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn run_git_vec_with_env(root: &Path, args: Vec<&str>, index_file: Option<&Path>) -> io::Result<()> {
    git_output_vec_with_env(root, args, index_file).map(|_| ())
}

/// Runs `git <args>` with `stdin` piped in (used for `git apply --cached`).
/// A non-zero exit becomes an error so callers can treat a rejected patch as a
/// safe no-op; `git apply` does not mutate the index when it fails.
fn run_git_with_stdin(root: &Path, args: &[&str], stdin: &[u8]) -> io::Result<()> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("Failed to open git stdin."))?
        .write_all(stdin)?;

    let output = child.wait_with_output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::other(
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// Returns the raw `git diff` text for a single file. `staged` selects the
/// index-vs-HEAD diff (used when unstaging); otherwise the worktree-vs-index
/// diff (used when staging). `-U0` keeps each logical change in its own hunk so
/// the front-end can target a single hunk; the `--` guard scopes the diff to
/// one path so the patch only ever touches that file.
fn file_diff_text(root: &Path, relative_path: &str, staged: bool) -> io::Result<String> {
    let mut args = vec!["diff", "-U0", "--no-color"];

    if staged {
        args.push("--cached");
    }

    args.push("--");
    args.push(relative_path);

    git_output_vec(root, args)
}

/// Splits a single-file `git diff` into its preamble (everything up to and
/// including the `+++` line) and the per-hunk blocks (each `@@ ... @@` and the
/// `-`/`+`/` `/`\` lines that follow it).
fn split_diff(raw: &str) -> Option<(Vec<&str>, Vec<Vec<&str>>)> {
    let lines: Vec<&str> = raw.split('\n').collect();
    let first_hunk = lines.iter().position(|line| line.starts_with("@@"))?;
    let preamble = lines[..first_hunk].to_vec();

    let mut hunks: Vec<Vec<&str>> = Vec::new();

    for line in &lines[first_hunk..] {
        if line.starts_with("@@") {
            hunks.push(vec![*line]);
            continue;
        }

        // Trailing empty element from the final newline is not part of a hunk.
        if line.is_empty() {
            continue;
        }

        if let Some(current) = hunks.last_mut() {
            current.push(*line);
        }
    }

    Some((preamble, hunks))
}

/// Parses a single-file `git diff` into structured hunks for the front-end. The
/// `header` is the `@@ ... @@` line; `lines` are the body lines (with their
/// leading `-`/`+`/` ` markers preserved) so the preview renders without
/// re-deriving the change.
fn parse_diff_hunks(raw: &str, is_staged: bool) -> Vec<GitDiffHunk> {
    let Some((_, hunks)) = split_diff(raw) else {
        return Vec::new();
    };

    hunks
        .into_iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let (header, body) = block.split_first()?;
            Some(GitDiffHunk {
                header: (*header).to_string(),
                index: index as u32,
                lines: body.iter().map(|line| (*line).to_string()).collect(),
                is_staged,
            })
        })
        .collect()
}

/// Builds a minimal, valid unified-diff patch containing only the hunk at
/// `hunk_index`, reusing `git`'s own preamble and hunk text verbatim so the
/// result stays byte-exact (EOL, "no newline at EOF", binary detection are all
/// inherited from git). Returns `None` when the index is out of range, in which
/// case the caller treats the request as a stale no-op.
fn single_hunk_patch(raw: &str, hunk_index: u32) -> Option<String> {
    let (preamble, hunks) = split_diff(raw)?;
    let hunk = hunks.get(hunk_index as usize)?;

    let mut patch = String::new();

    for line in preamble {
        patch.push_str(line);
        patch.push('\n');
    }

    for line in hunk {
        patch.push_str(line);
        patch.push('\n');
    }

    Some(patch)
}

fn commit_selected_staged_changes(
    root: &Path,
    message: &str,
    changes: &[GitChangedFile],
) -> io::Result<()> {
    let has_head = git_output_vec(root, vec!["rev-parse", "--verify", "HEAD"]).is_ok();
    let tree = write_selected_staged_tree(root, changes, has_head.then_some("HEAD"))?;
    let tree = tree.trim();
    let commit = if has_head {
        git_output_vec(root, vec!["commit-tree", tree, "-p", "HEAD", "-m", message])?
    } else {
        git_output_vec(root, vec!["commit-tree", tree, "-m", message])?
    };
    let commit = commit.trim();
    run_git_vec(root, vec!["update-ref", "HEAD", commit])?;

    Ok(())
}

fn refuse_amend_of_pushed_head(root: &Path) -> io::Result<()> {
    if git_output_vec(
        root,
        vec!["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .is_err()
    {
        return Ok(());
    }

    let ahead = git_output_vec(root, vec!["rev-list", "@{u}..HEAD"])?;
    if !ahead.trim().is_empty() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "cannot amend a pushed commit",
    ))
}

fn amend_selected_staged_changes(
    root: &Path,
    message: &str,
    changes: &[GitChangedFile],
) -> io::Result<()> {
    let tree = write_selected_staged_tree(root, changes, Some("HEAD"))?;
    let parents = git_output_vec(root, vec!["rev-list", "--parents", "-n", "1", "HEAD"])?;
    let message = if message.is_empty() {
        git_output_vec(root, vec!["log", "-1", "--format=%B", "HEAD"])?
    } else {
        message.to_string()
    };
    let mut args = vec!["commit-tree".to_string(), tree.trim().to_string()];
    for parent in parents.split_whitespace().skip(1) {
        args.push("-p".to_string());
        args.push(parent.to_string());
    }
    args.push("-m".to_string());
    args.push(message.trim_end().to_string());
    let commit = git_output_vec(root, args)?;
    run_git_vec(root, vec!["update-ref", "HEAD", commit.trim()])
}

fn write_selected_staged_tree(
    root: &Path,
    changes: &[GitChangedFile],
    base: Option<&str>,
) -> io::Result<String> {
    let temp_index = TempGitIndex::new(root);
    if let Some(base) = base {
        run_git_vec_with_env(root, vec!["read-tree", base], Some(temp_index.path()))?;
    }

    for change in changes {
        apply_staged_change_to_temp_index(root, temp_index.path(), change)?;
    }

    git_output_vec_with_env(root, vec!["write-tree"], Some(temp_index.path()))
}

fn apply_staged_change_to_temp_index(
    root: &Path,
    temp_index: &Path,
    change: &GitChangedFile,
) -> io::Result<()> {
    if has_unmerged_index_entries(root, &change.relative_path)? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Conflicted files cannot be committed from the commit panel.",
        ));
    }

    if let Some(old_relative_path) = cached_rename_old_path(root, &change.relative_path)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                old_relative_path.as_str(),
            ],
            Some(temp_index),
        )?;
    }

    if is_cached_deletion(root, &change.relative_path)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                change.relative_path.as_str(),
            ],
            Some(temp_index),
        )?;
        return Ok(());
    }

    let entry = git_output_vec(
        root,
        vec!["ls-files", "-s", "--", change.relative_path.as_str()],
    )?;
    let mut entries = entry.lines();
    let Some(first_entry) = entries.next() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("No staged content for {}.", change.relative_path),
        ));
    };

    if entries.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Conflicted file has multiple index entries: {}.",
                change.relative_path
            ),
        ));
    }

    let mut parts = first_entry.split_whitespace();
    let mode = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;
    let object_id = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;
    let stage = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;

    if stage != "0" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Conflicted file cannot be committed: {}.",
                change.relative_path
            ),
        ));
    }

    let cacheinfo = format!("{mode},{object_id},{}", change.relative_path);
    run_git_vec_with_env(
        root,
        vec!["update-index", "--add", "--cacheinfo", cacheinfo.as_str()],
        Some(temp_index),
    )
}

fn cached_name_status_records(root: &Path) -> io::Result<Vec<Vec<String>>> {
    let output = git_output_vec(root, vec!["diff", "--cached", "--name-status", "-M"])?;
    Ok(output
        .lines()
        .map(|line| line.split('\t').map(str::to_string).collect())
        .collect())
}

fn cached_rename_old_path(root: &Path, relative_path: &str) -> io::Result<Option<String>> {
    for fields in cached_name_status_records(root)? {
        if fields.first().is_some_and(|status| status.starts_with('R'))
            && fields.get(2).is_some_and(|path| path == relative_path)
        {
            return Ok(fields.get(1).cloned());
        }
    }

    Ok(None)
}

fn is_cached_deletion(root: &Path, relative_path: &str) -> io::Result<bool> {
    Ok(cached_name_status_records(root)?.iter().any(|fields| {
        fields.first().is_some_and(|status| status == "D")
            && fields.get(1).is_some_and(|path| path == relative_path)
    }))
}

fn has_unmerged_index_entries(root: &Path, relative_path: &str) -> io::Result<bool> {
    let output = git_output_vec(root, vec!["ls-files", "-u", "--", relative_path])?;

    Ok(!output.trim().is_empty())
}

struct TempGitIndex {
    path: PathBuf,
}

impl TempGitIndex {
    fn new(root: &Path) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root_name = root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("workspace");
        let path = std::env::temp_dir().join(format!(
            "mockor-index-{root_name}-{}-{nanos}",
            std::process::id()
        ));

        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempGitIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn workspace_file_path(root: &Path, relative_path: &str) -> io::Result<String> {
    Ok(root
        .join(safe_relative_path(relative_path)?)
        .to_string_lossy()
        .to_string())
}

fn original_content(root: &Path, change: &GitChangedFile) -> io::Result<String> {
    if matches!(
        change.status,
        GitChangeStatus::Added | GitChangeStatus::Untracked
    ) {
        return Ok(String::new());
    }

    let relative_path = change
        .old_relative_path
        .as_deref()
        .unwrap_or(change.relative_path.as_str());
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("show")
        .arg(format!("HEAD:{relative_path}"))
        .output()?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn modified_content(root: &Path, change: &GitChangedFile) -> io::Result<String> {
    if change.status == GitChangeStatus::Deleted {
        return Ok(String::new());
    }

    let path = root.join(safe_relative_path(&change.relative_path)?);
    std::fs::read_to_string(path)
}

fn safe_relative_path(relative_path: &str) -> io::Result<PathBuf> {
    let path = PathBuf::from(relative_path);

    if path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git path is absolute.",
        ));
    }

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git path escapes the workspace.",
        ));
    }

    Ok(path)
}

fn language_for_path(path: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "css" => "css",
        "html" => "html",
        "cjs" | "js" | "jsx" | "mjs" => "javascript",
        "json" => "json",
        "md" => "markdown",
        "php" => "php",
        "rs" => "rust",
        "cts" | "mts" | "ts" | "tsx" => "typescript",
        "xml" => "xml",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        detect_git_repositories, load_commit_details, load_commit_diff, load_commit_files,
        load_commit_log, parse_blame_porcelain, parse_branch_list, parse_diff_hunks,
        parse_file_history, parse_porcelain_status, parse_stash_list, safe_branch_name,
        safe_commit_sha, safe_relative_path, safe_stash_index, single_hunk_patch,
        CommandGitRepositoryGateway, GitChangeStatus, GitChangedFile, GitCommitFilters,
        GitRepositoryGateway, DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    /// Guarantees a distinct temp-repo path for every `TestGitRepo`, even when
    /// the platform clock is too coarse to disambiguate concurrent tests.
    static TEST_REPO_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn commit_log_returns_empty_for_unborn_head() {
        let repo = TestGitRepo::new();

        let commits = load_commit_log(repo.path(), empty_commit_filters()).expect("commit log");

        assert!(commits.is_empty());
    }

    #[test]
    fn fetch_and_pull_update_only_the_requested_workspace() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_and_push("remote.txt", "remote\n", "remote update");
        let gateway = CommandGitRepositoryGateway;
        let old_b_head = fixture.git_output(&fixture.workspace_b, ["rev-parse", "HEAD"]);

        gateway
            .fetch(&fixture.workspace_a)
            .expect("fetch workspace A");

        assert_eq!(
            fixture.git_output(&fixture.workspace_a, ["rev-parse", "origin/main"]),
            fixture.git_output(&fixture.seed, ["rev-parse", "HEAD"])
        );
        assert_eq!(
            fixture.git_output(&fixture.workspace_b, ["rev-parse", "HEAD"]),
            old_b_head
        );
        assert!(!fixture.workspace_b.join("remote.txt").exists());

        gateway
            .pull(&fixture.workspace_a)
            .expect("pull workspace A");

        assert_eq!(
            fs::read_to_string(fixture.workspace_a.join("remote.txt")).expect("workspace A file"),
            "remote\n"
        );
        assert!(!fixture.workspace_b.join("remote.txt").exists());
        assert_eq!(
            fixture.git_output(&fixture.workspace_b, ["rev-parse", "HEAD"]),
            old_b_head
        );
    }

    #[test]
    fn status_reports_behind_upstream_after_fetch() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_and_push("remote-one.txt", "one\n", "remote one");
        fixture.commit_and_push("remote-two.txt", "two\n", "remote two");
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

        let raw_counts = fixture.git_output(
            &fixture.workspace_a,
            ["rev-list", "--left-right", "--count", "@{u}...HEAD"],
        );
        let status = CommandGitRepositoryGateway
            .status(&fixture.workspace_a)
            .expect("status");

        assert_eq!(raw_counts, "2\t0");
        assert_eq!(
            status.upstream,
            Some(super::GitUpstreamTracking {
                branch: "origin/main".to_string(),
                ahead: 0,
                behind: 2,
            })
        );
    }

    #[test]
    fn status_reports_ahead_upstream_after_local_commits() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_in(&fixture.workspace_a, "local-one.txt", "one\n", "local one");
        fixture.commit_in(&fixture.workspace_a, "local-two.txt", "two\n", "local two");

        let status = CommandGitRepositoryGateway
            .status(&fixture.workspace_a)
            .expect("status");
        let upstream = status.upstream.expect("upstream");

        assert_eq!(upstream.ahead, 2);
        assert_eq!(upstream.behind, 0);
    }

    #[test]
    fn status_reports_diverged_upstream() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_in(&fixture.workspace_a, "local.txt", "local\n", "local");
        fixture.commit_and_push("remote.txt", "remote\n", "remote");
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

        let status = CommandGitRepositoryGateway
            .status(&fixture.workspace_a)
            .expect("status");
        let upstream = status.upstream.expect("upstream");

        assert_eq!(upstream.ahead, 1);
        assert_eq!(upstream.behind, 1);
    }

    #[test]
    fn status_omits_tracking_without_upstream_or_on_detached_head() {
        let fixture = RemoteGitFixture::new();
        RemoteGitFixture::run_git(&fixture.workspace_a, ["branch", "--unset-upstream"]);

        let status = CommandGitRepositoryGateway
            .status(&fixture.workspace_a)
            .expect("status");

        assert_eq!(status.upstream, None);

        RemoteGitFixture::run_git(&fixture.workspace_a, ["checkout", "--detach"]);
        let detached = CommandGitRepositoryGateway
            .status(&fixture.workspace_a)
            .expect("detached status");

        assert_eq!(detached.branch, None);
        assert_eq!(detached.upstream, None);
    }

    #[test]
    fn status_tracking_updates_after_pull() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_and_push("remote.txt", "remote\n", "remote");
        let gateway = CommandGitRepositoryGateway;

        let fetched = gateway.fetch(&fixture.workspace_a).expect("fetch");
        let pulled = gateway.pull(&fixture.workspace_a).expect("pull");

        assert_eq!(fetched.upstream.expect("fetched upstream").behind, 1);
        assert_eq!(
            pulled.upstream,
            Some(super::GitUpstreamTracking {
                branch: "origin/main".to_string(),
                ahead: 0,
                behind: 0,
            })
        );
    }

    #[test]
    fn pull_rejects_diverged_history_without_changing_the_workspace() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_in(&fixture.workspace_a, "local.txt", "local\n", "local update");
        fixture.commit_and_push("remote.txt", "remote\n", "remote update");
        let before_head = fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]);
        let gateway = CommandGitRepositoryGateway;

        let error = gateway
            .pull(&fixture.workspace_a)
            .expect_err("diverged pull must fail");

        assert!(error.to_string().to_lowercase().contains("fast-forward"));
        assert_eq!(
            fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]),
            before_head
        );
        assert_eq!(
            fs::read_to_string(fixture.workspace_a.join("local.txt")).expect("local file"),
            "local\n"
        );
        assert!(!fixture.workspace_a.join("remote.txt").exists());
    }

    #[test]
    fn commit_log_lists_commits_from_real_repository() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "history@example.com"]);
        repo.run(["config", "user.name", "History Author"]);
        repo.write("file.txt", "first\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "first commit"]);
        repo.write("file.txt", "second\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "second commit"]);

        let commits = load_commit_log(repo.path(), empty_commit_filters()).expect("commit log");

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second commit");
        assert_eq!(commits[0].author_name, "History Author");
        assert_eq!(commits[0].author_email, "history@example.com");
        assert_eq!(commits[1].subject, "first commit");
        assert_eq!(commits[0].parents.len(), 1);
        assert!(commits[0].hash.len() >= 40);
        assert!(commits
            .iter()
            .all(|commit| commit.hash.chars().all(|value| !value.is_whitespace())));
    }

    #[test]
    fn commit_log_uses_cursor_as_skip_offset() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "history@example.com"]);
        repo.run(["config", "user.name", "History Author"]);
        repo.write("file.txt", "first\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "first commit"]);
        repo.write("file.txt", "second\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "second commit"]);

        let commits = load_commit_log(
            repo.path(),
            GitCommitFilters {
                cursor: Some("1".to_string()),
                limit: Some(1),
                ..empty_commit_filters()
            },
        )
        .expect("commit log");

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "first commit");
    }

    #[test]
    fn commit_details_loads_metadata_from_real_repository() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "details@example.com"]);
        repo.run(["config", "user.name", "Details Author"]);
        repo.write("file.txt", "details\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "subject line", "-m", "body line"]);
        let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();

        let details = load_commit_details(repo.path(), &sha).expect("details");

        assert_eq!(details.commit.subject, "subject line");
        assert_eq!(details.commit.author_name, "Details Author");
        assert_eq!(details.commit.author_email, "details@example.com");
        assert_eq!(details.body, "subject line\n\nbody line");
        assert!(!details.containing_branches.is_empty());
    }

    #[test]
    fn commit_history_loads_details_files_and_diff_for_non_head_commit() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "details@example.com"]);
        repo.run(["config", "user.name", "Details Author"]);
        repo.write("file.txt", "first\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "first commit"]);
        let first_sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        repo.write("file.txt", "second\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "second commit"]);

        let details = load_commit_details(repo.path(), &first_sha).expect("details");
        let files = load_commit_files(repo.path(), &first_sha).expect("files");
        let diff =
            load_commit_diff(repo.path(), &first_sha, "file.txt", None, &files).expect("diff");

        assert_eq!(details.commit.subject, "first commit");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "file.txt");
        assert_eq!(files[0].status, "A");
        assert_eq!(diff.original_content, "");
        assert_eq!(diff.modified_content, "first\n");
        assert_eq!(diff.status, "A");
    }

    #[test]
    fn detect_git_repositories_includes_the_root_when_it_is_a_repository() {
        let repo = TestGitRepo::new();

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(repositories, vec!["".to_string()]);
    }

    #[test]
    fn detect_git_repositories_returns_no_repositories_for_a_plain_directory_tree() {
        let repo = TestGitRepo::new();
        fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
        fs::create_dir_all(repo.path().join("src")).expect("plain subdirectory");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert!(repositories.is_empty());
    }

    #[test]
    fn detect_git_repositories_finds_nested_repositories_and_worktree_git_files() {
        let repo = TestGitRepo::new();

        // A regular nested repository two levels deep.
        fs::create_dir_all(repo.path().join("a/b/.git")).expect("nested repo marker");

        // A linked worktree/submodule: `.git` is a file (a `gitdir:` pointer),
        // not a directory.
        fs::create_dir_all(repo.path().join("worktrees/feature")).expect("worktree directory");
        fs::write(
            repo.path().join("worktrees/feature/.git"),
            "gitdir: ../../.git/worktrees/feature\n",
        )
        .expect("worktree .git file");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(
            repositories,
            vec![
                "".to_string(),
                "a/b".to_string(),
                "worktrees/feature".to_string(),
            ]
        );
    }

    #[test]
    fn detect_git_repositories_skips_node_modules_and_other_ignored_directories() {
        let repo = TestGitRepo::new();

        // Vendored/dependency trees are never a project's own repository, and
        // real Node/Laravel projects nest plenty of `.git` markers under them
        // (npm packages installed from git, composer's own vendor `.git`).
        fs::create_dir_all(repo.path().join("node_modules/x/.git")).expect("node_modules repo");
        fs::create_dir_all(repo.path().join("vendor/y/.git")).expect("vendor repo");
        fs::create_dir_all(repo.path().join("storage/logs/.git")).expect("storage repo");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(repositories, vec!["".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn detect_git_repositories_does_not_follow_symlinked_directories() {
        use std::os::unix::fs::symlink;

        let repo = TestGitRepo::new();
        let linked_target = repo.path().join("linked-target");
        fs::create_dir_all(linked_target.join(".git")).expect("linked target repo marker");
        symlink(&linked_target, repo.path().join("linked")).expect("directory symlink");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        // The real directory is still discovered by its own name; only the
        // symlinked alias pointing back at it is excluded (cycle protection
        // and dedup for aliases such as `vendor/pkg -> ../workbench/pkg`).
        assert_eq!(
            repositories,
            vec!["".to_string(), "linked-target".to_string()]
        );
    }

    #[test]
    fn detect_git_repositories_respects_the_max_depth_bound() {
        let repo = TestGitRepo::new();
        fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
        fs::create_dir_all(repo.path().join("one/two/three/four/five/.git"))
            .expect("deeply nested repo marker");

        let shallow = detect_git_repositories(repo.path(), 4).expect("shallow scan");
        assert!(shallow.is_empty());

        let deep = detect_git_repositories(repo.path(), 5).expect("deep scan");
        assert_eq!(deep, vec!["one/two/three/four/five".to_string()]);
    }

    #[test]
    fn detect_git_repositories_returns_a_sorted_deterministic_order() {
        let repo = TestGitRepo::new();
        fs::create_dir_all(repo.path().join("z-repo/.git")).expect("repo z");
        fs::create_dir_all(repo.path().join("a-repo/.git")).expect("repo a");
        fs::create_dir_all(repo.path().join("m-repo/.git")).expect("repo m");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(
            repositories,
            vec![
                "".to_string(),
                "a-repo".to_string(),
                "m-repo".to_string(),
                "z-repo".to_string(),
            ]
        );
    }

    #[test]
    fn detect_git_repositories_fails_for_a_missing_root() {
        let repo = TestGitRepo::new();
        let missing = repo.path().join("does-not-exist");

        let result = detect_git_repositories(&missing, DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH);

        assert!(result.is_err());
    }

    #[test]
    fn parses_porcelain_status_changes() {
        let output =
            b" M src/User.php\0?? src/New.php\0D  old.php\0R  new.php\0old.php\0UU both.php\0";
        let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

        assert_eq!(changes[0].status, GitChangeStatus::Modified);
        assert_eq!(changes[0].relative_path, "src/User.php");
        assert_eq!(changes[1].status, GitChangeStatus::Untracked);
        assert_eq!(changes[2].status, GitChangeStatus::Deleted);
        assert_eq!(changes[3].status, GitChangeStatus::Renamed);
        assert_eq!(changes[3].old_relative_path.as_deref(), Some("old.php"));
        assert_eq!(changes[4].status, GitChangeStatus::Conflicted);
    }

    #[test]
    fn marks_index_changes_as_staged() {
        let output = b"M  staged.php\0 M unstaged.php\0A  added.php\0?? new.php\0";
        let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

        assert!(changes[0].is_staged);
        assert!(!changes[1].is_staged);
        assert!(changes[2].is_staged);
        assert!(!changes[3].is_staged);
    }

    #[test]
    fn rejects_paths_outside_workspace() {
        assert!(safe_relative_path("../secret.php").is_err());
        assert!(safe_relative_path("/secret.php").is_err());
        assert!(safe_relative_path("src/User.php").is_ok());
    }

    #[test]
    fn parses_blame_porcelain_into_per_line_records() {
        // Two commits, the second reusing the first commit's metadata via a bare
        // SHA header line (the porcelain format omits author/time on repeats).
        let output = concat!(
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 1 1 2\n",
            "author Alice Example\n",
            "author-mail <alice@example.com>\n",
            "author-time 1700000000\n",
            "author-tz +0100\n",
            "committer Alice Example\n",
            "committer-mail <alice@example.com>\n",
            "committer-time 1700000000\n",
            "committer-tz +0100\n",
            "summary first commit\n",
            "filename src/User.php\n",
            "\tfirst line\n",
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 2 2\n",
            "\tsecond line\n",
            "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d 3 3 1\n",
            "author Bob Example\n",
            "author-mail <bob@example.com>\n",
            "author-time 1700100000\n",
            "author-tz +0000\n",
            "committer Bob Example\n",
            "committer-mail <bob@example.com>\n",
            "committer-time 1700100000\n",
            "committer-tz +0000\n",
            "summary third commit\n",
            "filename src/User.php\n",
            "\tthird line\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Alice Example");
        assert_eq!(lines[0].sha, "1a2b3c4");
        assert_eq!(lines[0].timestamp, 1700000000);
        // The repeated SHA inherits the metadata captured on its first appearance.
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].author, "Alice Example");
        assert_eq!(lines[1].sha, "1a2b3c4");
        assert_eq!(lines[2].line_number, 3);
        assert_eq!(lines[2].author, "Bob Example");
        assert_eq!(lines[2].sha, "f0e1d2c");
        assert_eq!(lines[2].timestamp, 1700100000);
    }

    #[test]
    fn keeps_the_final_line_when_porcelain_output_lacks_a_trailing_content_line() {
        // Defensive: a truncated porcelain stream that ends mid-group (no `\t`
        // content line) must still surface the line we already identified.
        let output = concat!(
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 1 1 1\n",
            "author Alice Example\n",
            "author-time 1700000000\n",
            "summary only commit\n",
            "filename a.php\n",
            "\tfirst line\n",
            "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d 2 2 1\n",
            "author Bob Example\n",
            "author-time 1700100000\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].author, "Bob Example");
        assert_eq!(lines[1].sha, "f0e1d2c");
    }

    #[test]
    fn marks_uncommitted_lines_with_the_not_committed_yet_author() {
        let output = concat!(
            "0000000000000000000000000000000000000000 1 1 1\n",
            "author Not Committed Yet\n",
            "author-mail <not.committed.yet>\n",
            "author-time 1700200000\n",
            "author-tz +0000\n",
            "summary Version of staged changes\n",
            "filename new.php\n",
            "\tpending line\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].author, "Not Committed Yet");
        assert_eq!(lines[0].sha, "0000000");
    }

    #[test]
    fn blame_reports_authors_for_committed_lines() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "blame@example.com"]);
        repo.run(["config", "user.name", "Blame Author"]);
        repo.write("file.txt", "one\ntwo\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let gateway = CommandGitRepositoryGateway;
        let lines = gateway.blame(repo.path(), "file.txt").expect("blame");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Blame Author");
        assert!(!lines[0].sha.is_empty());
        assert_eq!(lines[1].line_number, 2);
    }

    #[test]
    fn blame_rejects_paths_outside_workspace() {
        let repo = TestGitRepo::new();
        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.blame(repo.path(), "../secret.txt").is_err());
    }

    #[test]
    fn parses_file_history_records_separated_by_unit_separator() {
        let output = concat!(
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\u{1f}Alice Example\u{1f}1700000000\u{1f}Add user model\n",
            "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d\u{1f}Bob Example\u{1f}1700100000\u{1f}Refactor: split helpers\n",
        );

        let entries = parse_file_history(output);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sha, "1a2b3c4");
        assert_eq!(entries[0].author, "Alice Example");
        assert_eq!(entries[0].timestamp, 1700000000);
        assert_eq!(entries[0].subject, "Add user model");
        assert_eq!(entries[1].sha, "f0e1d2c");
        // A subject containing the delimiter-like text (colon, spaces) survives.
        assert_eq!(entries[1].subject, "Refactor: split helpers");
    }

    #[test]
    fn skips_malformed_file_history_records() {
        let output = concat!(
            "not-a-sha\u{1f}Author\u{1f}1700000000\u{1f}subject\n",
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\u{1f}Alice\u{1f}1700000000\u{1f}ok\n",
            "\n",
        );

        let entries = parse_file_history(output);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].subject, "ok");
    }

    #[test]
    fn safe_commit_sha_rejects_non_hex_and_options() {
        assert!(safe_commit_sha("HEAD").is_err());
        assert!(safe_commit_sha("--output=/etc/passwd").is_err());
        assert!(safe_commit_sha("1a2").is_err());
        assert!(safe_commit_sha("deadBEEF").is_ok());
    }

    #[test]
    fn file_history_lists_commits_that_touched_the_file() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "history@example.com"]);
        repo.run(["config", "user.name", "History Author"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "first commit"]);
        repo.write("file.txt", "one\ntwo\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "second commit"]);
        repo.write("other.txt", "unrelated\n");
        repo.run(["add", "other.txt"]);
        repo.run(["commit", "-m", "unrelated commit"]);

        let gateway = CommandGitRepositoryGateway;
        let entries = gateway
            .file_history(repo.path(), "file.txt")
            .expect("history");

        assert_eq!(entries.len(), 2);
        // Newest commit first (git log default ordering).
        assert_eq!(entries[0].subject, "second commit");
        assert_eq!(entries[1].subject, "first commit");
        assert_eq!(entries[0].author, "History Author");
        assert!(!entries[0].sha.is_empty());
    }

    #[test]
    fn file_history_rejects_paths_outside_workspace() {
        let repo = TestGitRepo::new();
        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.file_history(repo.path(), "../secret.txt").is_err());
    }

    #[test]
    fn file_commit_diff_reports_blob_contents_for_a_commit() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "first"]);
        repo.write("file.txt", "one\ntwo\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "second"]);

        let second_sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let gateway = CommandGitRepositoryGateway;
        let diff = gateway
            .file_commit_diff(repo.path(), "file.txt", &second_sha)
            .expect("diff");

        assert_eq!(diff.original_content, "one\n");
        assert_eq!(diff.modified_content, "one\ntwo\n");
        assert_eq!(diff.change.relative_path, "file.txt");
        assert_eq!(diff.change.status, GitChangeStatus::Modified);
        assert_eq!(diff.language, "plaintext");
    }

    #[test]
    fn file_commit_diff_treats_first_commit_as_addition() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("file.txt", "hello\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "create"]);

        let first_sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let gateway = CommandGitRepositoryGateway;
        let diff = gateway
            .file_commit_diff(repo.path(), "file.txt", &first_sha)
            .expect("diff");

        assert_eq!(diff.original_content, "");
        assert_eq!(diff.modified_content, "hello\n");
        assert_eq!(diff.change.status, GitChangeStatus::Added);
    }

    #[test]
    fn file_commit_diff_rejects_invalid_sha() {
        let repo = TestGitRepo::new();
        let gateway = CommandGitRepositoryGateway;

        assert!(gateway
            .file_commit_diff(repo.path(), "file.txt", "HEAD")
            .is_err());
    }

    #[test]
    fn commits_only_staged_content_for_selected_paths() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);
        repo.write("file.txt", "three\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "selected",
                &[git_changed_file(
                    "file.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
        assert_eq!(repo.read("file.txt"), "three\n");
    }

    #[test]
    fn amend_replaces_head_with_selected_tree_message_and_existing_parent() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("base.txt", "base\n");
        repo.run(["add", "base.txt"]);
        repo.run(["commit", "-m", "base"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "original"]);
        let original_head = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let original_parent = repo.git_output(["rev-parse", "HEAD^"]).trim().to_string();
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);

        CommandGitRepositoryGateway
            .amend(
                repo.path(),
                "replacement",
                &[git_changed_file(
                    "file.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("amend");

        assert_ne!(repo.git_output(["rev-parse", "HEAD"]).trim(), original_head);
        assert_eq!(
            repo.git_output(["rev-parse", "HEAD^"]).trim(),
            original_parent
        );
        assert_eq!(
            repo.git_output(["log", "-1", "--format=%B"]).trim(),
            "replacement"
        );
        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
    }

    #[test]
    fn amend_with_empty_message_keeps_head_message() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "original message"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);

        CommandGitRepositoryGateway
            .amend(
                repo.path(),
                "",
                &[git_changed_file(
                    "file.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("amend");

        assert_eq!(
            repo.git_output(["log", "-1", "--format=%B"]).trim(),
            "original message"
        );
    }

    #[test]
    fn amend_root_commit_keeps_it_parentless() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "root"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);

        CommandGitRepositoryGateway
            .amend(
                repo.path(),
                "amended root",
                &[git_changed_file(
                    "file.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("amend root");

        assert_eq!(
            repo.git_output(["rev-list", "--parents", "-n", "1", "HEAD"])
                .split_whitespace()
                .count(),
            1
        );
        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
    }

    #[test]
    fn amend_refuses_head_that_is_present_on_upstream() {
        let fixture = RemoteGitFixture::new();
        fs::write(fixture.workspace_a.join("base.txt"), "changed\n").expect("change file");
        RemoteGitFixture::run_git(&fixture.workspace_a, ["add", "base.txt"]);
        let original_head = fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]);

        let error = CommandGitRepositoryGateway
            .amend(
                &fixture.workspace_a,
                "unsafe",
                &[git_changed_file(
                    "base.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect_err("pushed amend must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        assert!(error.to_string().contains("cannot amend a pushed commit"));
        assert_eq!(
            fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]),
            original_head
        );
    }

    #[test]
    fn amend_allows_head_ahead_of_upstream() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_in(&fixture.workspace_a, "local.txt", "one\n", "local");
        let original_head = fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]);
        fs::write(fixture.workspace_a.join("local.txt"), "two\n").expect("change file");
        RemoteGitFixture::run_git(&fixture.workspace_a, ["add", "local.txt"]);

        CommandGitRepositoryGateway
            .amend(
                &fixture.workspace_a,
                "amended local",
                &[git_changed_file(
                    "local.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("ahead amend");

        assert_ne!(
            fixture.git_output(&fixture.workspace_a, ["rev-parse", "HEAD"]),
            original_head
        );
        assert_eq!(
            fixture.git_output(&fixture.workspace_a, ["show", "HEAD:local.txt"]),
            "two"
        );
    }

    #[test]
    fn does_not_trust_deleted_payload_when_index_has_staged_content() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);
        repo.write("file.txt", "three\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "selected",
                &[git_changed_file("file.txt", true, GitChangeStatus::Deleted)],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
        assert_eq!(repo.read("file.txt"), "three\n");
    }

    #[test]
    fn derives_staged_rename_from_git_index() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("old.txt", "one\n");
        repo.run(["add", "old.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["mv", "old.txt", "new.txt"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "rename",
                &[git_changed_file("new.txt", true, GitChangeStatus::Modified)],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:new.txt"]), "one\n");
        assert!(repo
            .git_output(["ls-tree", "--name-only", "HEAD"])
            .lines()
            .all(|path| path != "old.txt"));
    }

    #[test]
    fn reverts_staged_added_files() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("existing.txt", "one\n");
        repo.run(["add", "existing.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("new.txt", "new\n");
        repo.run(["add", "new.txt"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .revert(
                repo.path(),
                &[git_changed_file("new.txt", true, GitChangeStatus::Added)],
            )
            .expect("revert staged addition");

        assert!(!repo.path().join("new.txt").exists());
        assert_eq!(repo.git_output(["status", "--porcelain"]), "");
    }

    fn hunk_repo() -> TestGitRepo {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "hunk@example.com"]);
        repo.run(["config", "user.name", "Hunk Author"]);
        repo
    }

    // --- patch generation (corruption-prone; assert on git's own output) ---

    #[test]
    fn splits_two_change_diff_into_separate_hunks_with_zero_context() {
        let raw = concat!(
            "diff --git a/f.txt b/f.txt\n",
            "index 9405325..084d8dd 100644\n",
            "--- a/f.txt\n",
            "+++ b/f.txt\n",
            "@@ -1 +1 @@\n",
            "-a\n",
            "+A\n",
            "@@ -5 +5 @@ d\n",
            "-e\n",
            "+E\n",
        );

        let hunks = parse_diff_hunks(raw, false);

        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].index, 0);
        assert_eq!(hunks[0].header, "@@ -1 +1 @@");
        assert_eq!(hunks[0].lines, vec!["-a", "+A"]);
        assert_eq!(hunks[1].index, 1);
        assert_eq!(hunks[1].header, "@@ -5 +5 @@ d");
        assert_eq!(hunks[1].lines, vec!["-e", "+E"]);
    }

    #[test]
    fn single_hunk_patch_keeps_preamble_and_only_the_selected_hunk() {
        let raw = concat!(
            "diff --git a/f.txt b/f.txt\n",
            "index 9405325..084d8dd 100644\n",
            "--- a/f.txt\n",
            "+++ b/f.txt\n",
            "@@ -1 +1 @@\n",
            "-a\n",
            "+A\n",
            "@@ -5 +5 @@ d\n",
            "-e\n",
            "+E\n",
        );

        let first = single_hunk_patch(raw, 0).expect("first hunk patch");
        assert_eq!(
            first,
            concat!(
                "diff --git a/f.txt b/f.txt\n",
                "index 9405325..084d8dd 100644\n",
                "--- a/f.txt\n",
                "+++ b/f.txt\n",
                "@@ -1 +1 @@\n",
                "-a\n",
                "+A\n",
            )
        );

        let second = single_hunk_patch(raw, 1).expect("second hunk patch");
        assert!(second.contains("@@ -5 +5 @@ d\n-e\n+E\n"));
        assert!(!second.contains("+A"));
    }

    #[test]
    fn single_hunk_patch_preserves_no_newline_marker() {
        let raw = concat!(
            "diff --git a/f.txt b/f.txt\n",
            "index 54d55bf..a9beb14 100644\n",
            "--- a/f.txt\n",
            "+++ b/f.txt\n",
            "@@ -3 +3 @@ two\n",
            "-three\n",
            "\\ No newline at end of file\n",
            "+THREE\n",
            "\\ No newline at end of file\n",
        );

        let patch = single_hunk_patch(raw, 0).expect("patch");

        assert!(patch.contains("\\ No newline at end of file"));
        assert!(patch.contains("-three"));
        assert!(patch.contains("+THREE"));
    }

    #[test]
    fn single_hunk_patch_rejects_out_of_range_index() {
        let raw = concat!(
            "diff --git a/f.txt b/f.txt\n",
            "--- a/f.txt\n",
            "+++ b/f.txt\n",
            "@@ -1 +1 @@\n",
            "-a\n",
            "+A\n",
        );

        assert!(single_hunk_patch(raw, 5).is_none());
    }

    // --- stage_hunk / unstage_hunk round trips through real git ---

    #[test]
    fn stage_hunk_stages_only_the_selected_change() {
        let repo = hunk_repo();
        repo.write("f.txt", "a\nb\nc\nd\ne\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "A\nb\nc\nd\nE\n");

        let gateway = CommandGitRepositoryGateway;
        let hunks = gateway
            .file_hunks(repo.path(), "f.txt", false)
            .expect("hunks");
        assert_eq!(
            hunks.len(),
            2,
            "expected one hunk per change, got {hunks:?}"
        );

        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage hunk");

        // The first line is staged; the last line is still only in the worktree.
        assert_eq!(repo.git_output(["show", ":f.txt"]), "A\nb\nc\nd\ne\n");
        assert_eq!(repo.read("f.txt"), "A\nb\nc\nd\nE\n");
    }

    #[test]
    fn unstage_hunk_unstages_only_the_selected_change() {
        let repo = hunk_repo();
        repo.write("f.txt", "a\nb\nc\nd\ne\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "A\nb\nc\nd\nE\n");
        // Stage everything, then unstage just the first hunk.
        repo.run(["add", "f.txt"]);

        let gateway = CommandGitRepositoryGateway;
        let staged = gateway
            .file_hunks(repo.path(), "f.txt", true)
            .expect("staged hunks");
        assert_eq!(staged.len(), 2, "expected two staged hunks, got {staged:?}");
        assert!(staged.iter().all(|hunk| hunk.is_staged));

        gateway
            .unstage_hunk(repo.path(), "f.txt", 0)
            .expect("unstage hunk");

        // First line reverts to HEAD in the index; last line stays staged.
        assert_eq!(repo.git_output(["show", ":f.txt"]), "a\nb\nc\nd\nE\n");
        assert_eq!(repo.read("f.txt"), "A\nb\nc\nd\nE\n");
    }

    #[test]
    fn stage_hunk_handles_pure_addition_at_end_of_file() {
        let repo = hunk_repo();
        repo.write("f.txt", "a\nb\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "a\nb\nc\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage addition");

        assert_eq!(repo.git_output(["show", ":f.txt"]), "a\nb\nc\n");
    }

    #[test]
    fn stage_hunk_handles_pure_deletion() {
        let repo = hunk_repo();
        repo.write("f.txt", "a\nb\nc\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "a\nc\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage deletion");

        assert_eq!(repo.git_output(["show", ":f.txt"]), "a\nc\n");
    }

    #[test]
    fn stage_hunk_handles_missing_newline_at_end_of_file() {
        let repo = hunk_repo();
        repo.write("f.txt", "one\ntwo\nthree");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "one\nTWO\nthree");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage no-eol hunk");

        assert_eq!(repo.git_output(["show", ":f.txt"]), "one\nTWO\nthree");
    }

    #[test]
    fn stage_hunk_handles_crlf_line_endings() {
        let repo = hunk_repo();
        // Pin EOL handling so the test does not depend on the host's global
        // `core.autocrlf`; this keeps the CRLF bytes intact in the blob.
        repo.run(["config", "core.autocrlf", "false"]);
        repo.write("f.txt", "a\r\nb\r\nc\r\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "a\r\nB\r\nc\r\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage crlf hunk");

        // Staging one CRLF hunk via git's own diff is byte-exact: the staged
        // blob carries the changed line and the surrounding CRLF endings.
        assert_eq!(repo.git_output(["show", ":f.txt"]), "a\r\nB\r\nc\r\n");
        // The whole change was staged, so nothing is left for the worktree diff.
        assert_eq!(repo.git_output(["diff", "--name-only"]), "");
    }

    #[test]
    fn stage_hunk_handles_first_line_change() {
        let repo = hunk_repo();
        repo.write("f.txt", "first\nsecond\nthird\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "FIRST\nsecond\nthird\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stage_hunk(repo.path(), "f.txt", 0)
            .expect("stage first line");

        assert_eq!(
            repo.git_output(["show", ":f.txt"]),
            "FIRST\nsecond\nthird\n"
        );
    }

    #[test]
    fn stage_hunk_out_of_range_index_is_safe_no_op() {
        let repo = hunk_repo();
        repo.write("f.txt", "a\nb\n");
        repo.run(["add", "f.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("f.txt", "A\nb\n");

        let gateway = CommandGitRepositoryGateway;
        let result = gateway.stage_hunk(repo.path(), "f.txt", 9);

        assert!(result.is_err(), "stale hunk index must error");
        // Index untouched: nothing staged.
        assert_eq!(repo.git_output(["diff", "--cached", "--name-only"]), "");
    }

    #[test]
    fn stage_hunk_rejects_paths_outside_workspace() {
        let repo = hunk_repo();
        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.stage_hunk(repo.path(), "../escape.txt", 0).is_err());
        assert!(gateway.unstage_hunk(repo.path(), "/etc/passwd", 0).is_err());
    }

    #[test]
    fn parses_stash_list_into_entries() {
        // Layout is `%gd%x1f%ct%x1f%gs`: selector, timestamp, reflog subject.
        let output = concat!(
            "stash@{0}\u{1f}1700000000\u{1f}WIP on main: 1a2b3c4 Add feature\n",
            "stash@{1}\u{1f}1700100000\u{1f}On feature/x: tweak parser\n",
        );

        let entries = parse_stash_list(output);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].index, 0);
        assert_eq!(entries[0].timestamp, 1700000000);
        // The branch is derived from the reflog subject prefix.
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[0].message, "WIP on main: 1a2b3c4 Add feature");
        assert_eq!(entries[1].index, 1);
        assert_eq!(entries[1].branch.as_deref(), Some("feature/x"));
        // A message containing colons survives unit-separator parsing.
        assert_eq!(entries[1].message, "On feature/x: tweak parser");
    }

    #[test]
    fn skips_malformed_stash_list_records() {
        let output = concat!(
            "not-a-stash-ref\u{1f}1700000000\u{1f}message\n",
            "stash@{2}\u{1f}1700000000\u{1f}good one\n",
            "\n",
        );

        let entries = parse_stash_list(output);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 2);
        assert_eq!(entries[0].message, "good one");
    }

    #[test]
    fn safe_stash_index_rejects_injection_and_accepts_numeric() {
        assert!(safe_stash_index("0").is_ok());
        assert!(safe_stash_index("12").is_ok());
        // Anything non-numeric could escape `stash@{...}` into another revision
        // or a git option; reject it.
        assert!(safe_stash_index("0} --force; rm -rf /").is_err());
        assert!(safe_stash_index("-1").is_err());
        assert!(safe_stash_index("HEAD").is_err());
        assert!(safe_stash_index("").is_err());
        assert!(safe_stash_index("1.0").is_err());
    }

    #[test]
    fn stash_save_then_list_reports_the_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .stash_save(repo.path(), "work in progress")
            .expect("stash save");

        // The working tree is clean after stashing.
        assert_eq!(repo.git_output(["status", "--porcelain"]), "");
        assert_eq!(repo.read("file.txt"), "one\n");

        let entries = gateway.stash_list(repo.path()).expect("stash list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 0);
        assert!(entries[0].message.contains("work in progress"));
    }

    #[test]
    fn stash_apply_restores_changes_and_keeps_the_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");

        let gateway = CommandGitRepositoryGateway;
        gateway.stash_save(repo.path(), "wip").expect("stash save");
        gateway.stash_apply(repo.path(), 0).expect("stash apply");

        assert_eq!(repo.read("file.txt"), "two\n");
        // apply keeps the stash entry.
        let entries = gateway.stash_list(repo.path()).expect("stash list");
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn stash_pop_restores_changes_and_drops_the_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");

        let gateway = CommandGitRepositoryGateway;
        gateway.stash_save(repo.path(), "wip").expect("stash save");
        gateway.stash_pop(repo.path(), 0).expect("stash pop");

        assert_eq!(repo.read("file.txt"), "two\n");
        // pop removes the stash entry.
        let entries = gateway.stash_list(repo.path()).expect("stash list");
        assert!(entries.is_empty());
    }

    #[test]
    fn stash_show_returns_a_diff_for_the_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "one\ntwo\n");

        let gateway = CommandGitRepositoryGateway;
        gateway.stash_save(repo.path(), "wip").expect("stash save");
        let diff = gateway.stash_show(repo.path(), 0).expect("stash show");

        assert!(diff.contains("file.txt"));
        assert!(diff.contains("+two"));
    }

    #[test]
    fn stash_drop_removes_the_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");

        let gateway = CommandGitRepositoryGateway;
        gateway.stash_save(repo.path(), "wip").expect("stash save");
        gateway.stash_drop(repo.path(), 0).expect("stash drop");

        let entries = gateway.stash_list(repo.path()).expect("stash list");
        assert!(entries.is_empty());
        // The working tree was not touched by drop (still clean from the save).
        assert_eq!(repo.read("file.txt"), "one\n");
    }

    #[test]
    fn stash_save_rejects_when_there_is_nothing_to_stash() {
        let repo = stash_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.stash_save(repo.path(), "wip").is_err());
    }

    #[test]
    fn parses_branch_list_marking_the_current_branch() {
        // Layout is `%(HEAD)%(refname:short)`: a one-char flag (`*` for current,
        // a space otherwise) immediately followed by the short name.
        let output = concat!("*main\n", " feature/login\n", " release-1.0\n");

        let branches = parse_branch_list(output);

        assert_eq!(branches.len(), 3);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
        assert_eq!(branches[1].name, "feature/login");
        assert!(!branches[1].is_current);
        assert_eq!(branches[2].name, "release-1.0");
        assert!(!branches[2].is_current);
    }

    #[test]
    fn branch_list_pins_the_current_branch_first_keeping_other_order() {
        // git lists refs alphabetically, so the current branch can appear in the
        // middle; the switcher pins it to the top, leaving the rest in order.
        let output = concat!(" alpha\n", "*middle\n", " omega\n");

        let branches = parse_branch_list(output);

        assert_eq!(branches[0].name, "middle");
        assert!(branches[0].is_current);
        assert_eq!(branches[1].name, "alpha");
        assert_eq!(branches[2].name, "omega");
    }

    #[test]
    fn skips_malformed_branch_records() {
        // Blank lines and records whose first column is neither `*` nor space are
        // skipped (defensive against unexpected `for-each-ref` output).
        let output = concat!("\n", "*main\n", "Xbad-flag\n");

        let branches = parse_branch_list(output);

        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
    }

    #[test]
    fn safe_branch_name_rejects_injection_and_accepts_valid() {
        assert!(safe_branch_name("feature/login").is_ok());
        assert!(safe_branch_name("release-1.0").is_ok());
        assert!(safe_branch_name("fix_bug").is_ok());
        // Empty / whitespace-only is rejected.
        assert!(safe_branch_name("").is_err());
        assert!(safe_branch_name("   ").is_err());
        // Option/shell injection and invalid ref shapes are rejected.
        assert!(safe_branch_name("--force").is_err());
        assert!(safe_branch_name("-D main").is_err());
        assert!(safe_branch_name("foo; rm -rf /").is_err());
        assert!(safe_branch_name("foo bar").is_err());
        assert!(safe_branch_name("foo..bar").is_err());
        assert!(safe_branch_name("foo~1").is_err());
        assert!(safe_branch_name("foo^").is_err());
        assert!(safe_branch_name("foo:bar").is_err());
        assert!(safe_branch_name("foo?").is_err());
        assert!(safe_branch_name("foo*").is_err());
        assert!(safe_branch_name("foo\\bar").is_err());
        assert!(safe_branch_name("@{-1}").is_err());
    }

    #[test]
    fn branch_list_reports_local_branches_with_current_flag() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["branch", "feature"]);

        let gateway = CommandGitRepositoryGateway;
        let branches = gateway.branch_list(repo.path()).expect("branch list");
        let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();

        assert!(names.contains(&"feature"));
        let current = branches
            .iter()
            .find(|branch| branch.is_current)
            .expect("current");
        // The initial checkout is the default branch (the only one with content).
        assert!(!current.name.is_empty());
        // Exactly one branch is flagged current.
        assert_eq!(
            branches.iter().filter(|branch| branch.is_current).count(),
            1
        );
    }

    #[test]
    fn current_branch_returns_the_checked_out_branch() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["checkout", "-b", "work"]);

        let gateway = CommandGitRepositoryGateway;
        let current = gateway.current_branch(repo.path()).expect("current branch");

        assert_eq!(current.as_deref(), Some("work"));
    }

    #[test]
    fn create_branch_adds_a_branch_without_switching() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        let before = repo.git_output(["rev-parse", "--abbrev-ref", "HEAD"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .create_branch(repo.path(), "feature/new")
            .expect("create branch");

        // The branch now exists.
        let branches = gateway.branch_list(repo.path()).expect("branch list");
        assert!(branches.iter().any(|branch| branch.name == "feature/new"));
        // HEAD did not move: create must never switch.
        let after = repo.git_output(["rev-parse", "--abbrev-ref", "HEAD"]);
        assert_eq!(before, after);
    }

    #[test]
    fn create_branch_rejects_invalid_name() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.create_branch(repo.path(), "--force").is_err());
        assert!(gateway.create_branch(repo.path(), "bad name").is_err());
    }

    #[test]
    fn switch_branch_moves_head_when_the_working_tree_is_clean() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["branch", "feature"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .switch_branch(repo.path(), "feature")
            .expect("switch branch");

        let current = gateway.current_branch(repo.path()).expect("current branch");
        assert_eq!(current.as_deref(), Some("feature"));
    }

    #[test]
    fn switch_branch_refuses_when_local_changes_would_be_overwritten() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("file.txt", "feature\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "feature change"]);
        repo.run(["checkout", "main"]);
        // A dirty local change that conflicts with the feature branch content.
        repo.write("file.txt", "dirty local\n");

        let gateway = CommandGitRepositoryGateway;
        let result = gateway.switch_branch(repo.path(), "feature");

        // Switch must FAIL (no `-f`/`--discard`); work is never lost.
        assert!(result.is_err());
        // The working tree change survives the rejected switch.
        assert_eq!(repo.read("file.txt"), "dirty local\n");
        let current = gateway.current_branch(repo.path()).expect("current branch");
        assert_eq!(current.as_deref(), Some("main"));
    }

    #[test]
    fn switch_branch_rejects_invalid_name() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.switch_branch(repo.path(), "--orphan").is_err());
        assert!(gateway
            .switch_branch(repo.path(), "no/such/branch nope")
            .is_err());
    }

    fn branch_repo() -> TestGitRepo {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "branch@example.com"]);
        repo.run(["config", "user.name", "Branch Author"]);
        // Pin the initial (still unborn) branch name to `main` so tests do not
        // depend on the host's `init.defaultBranch` (could be `master`).
        // `symbolic-ref` is idempotent whether or not `main` is already current.
        repo.run(["symbolic-ref", "HEAD", "refs/heads/main"]);
        repo
    }

    fn stash_repo() -> TestGitRepo {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "stash@example.com"]);
        repo.run(["config", "user.name", "Stash Author"]);
        repo
    }

    fn git_changed_file(
        relative_path: &str,
        is_staged: bool,
        status: GitChangeStatus,
    ) -> GitChangedFile {
        GitChangedFile {
            is_staged,
            is_unversioned: status == GitChangeStatus::Untracked,
            old_path: None,
            old_relative_path: None,
            path: format!("/workspace/{relative_path}"),
            relative_path: relative_path.to_string(),
            status,
        }
    }

    fn empty_commit_filters() -> GitCommitFilters {
        GitCommitFilters {
            author: None,
            branch: None,
            cursor: None,
            limit: None,
            path: None,
            query: None,
        }
    }

    struct TestGitRepo {
        path: PathBuf,
    }

    struct RemoteGitFixture {
        _host: TestGitRepo,
        seed: PathBuf,
        workspace_a: PathBuf,
        workspace_b: PathBuf,
    }

    impl RemoteGitFixture {
        fn new() -> Self {
            let host = TestGitRepo::new();
            let remote = host.path().join("remote.git");
            let seed = host.path().join("seed");
            let workspace_a = host.path().join("workspace-a");
            let workspace_b = host.path().join("workspace-b");
            Self::run_command(["init", "--bare", remote.to_str().expect("remote path")]);
            Self::run_command(["init", seed.to_str().expect("seed path")]);
            Self::configure(&seed);
            fs::write(seed.join("base.txt"), "base\n").expect("base file");
            Self::run_git(&seed, ["add", "base.txt"]);
            Self::run_git(&seed, ["commit", "-m", "initial"]);
            Self::run_git(&seed, ["branch", "-M", "main"]);
            Self::run_git(
                &seed,
                [
                    "remote",
                    "add",
                    "origin",
                    remote.to_str().expect("remote path"),
                ],
            );
            Self::run_git(&seed, ["push", "-u", "origin", "main"]);
            Self::run_git(&remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
            Self::run_command([
                "clone",
                remote.to_str().expect("remote path"),
                workspace_a.to_str().expect("workspace A path"),
            ]);
            Self::run_command([
                "clone",
                remote.to_str().expect("remote path"),
                workspace_b.to_str().expect("workspace B path"),
            ]);
            Self::configure(&workspace_a);
            Self::configure(&workspace_b);

            Self {
                _host: host,
                seed,
                workspace_a,
                workspace_b,
            }
        }

        fn commit_and_push(&self, path: &str, content: &str, message: &str) {
            self.commit_in(&self.seed, path, content, message);
            Self::run_git(&self.seed, ["push"]);
        }

        fn commit_in(&self, root: &Path, path: &str, content: &str, message: &str) {
            fs::write(root.join(path), content).expect("fixture file");
            Self::run_git(root, ["add", path]);
            Self::run_git(root, ["commit", "-m", message]);
        }

        fn configure(root: &Path) {
            Self::run_git(root, ["config", "user.email", "test@example.com"]);
            Self::run_git(root, ["config", "user.name", "Test User"]);
        }

        fn git_output<const N: usize>(&self, root: &Path, args: [&str; N]) -> String {
            let output = Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }

        fn run_git<const N: usize>(root: &Path, args: [&str; N]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn run_command<const N: usize>(args: [&str; N]) {
            let output = Command::new("git").args(args).output().expect("run git");
            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    impl TestGitRepo {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            // A process-global atomic counter guarantees uniqueness across
            // parallel tests; the macOS clock only resolves to microseconds,
            // so `nanos` alone collides when tests start in the same tick and
            // both `git init` the same dir (templates/info/exclude clash).
            let unique = TEST_REPO_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "mockor-editor-git-test-{}-{nanos}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp repo");
            let repo = Self { path };
            repo.run(["init"]);
            repo
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn read(&self, relative_path: &str) -> String {
            fs::read_to_string(self.path.join(relative_path)).expect("read file")
        }

        fn write(&self, relative_path: &str, content: &str) {
            fs::write(self.path.join(relative_path), content).expect("write file");
        }

        fn git_output<const N: usize>(&self, args: [&str; N]) -> String {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.path)
                .args(args)
                .output()
                .expect("run git");

            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );

            String::from_utf8_lossy(&output.stdout).to_string()
        }

        fn run<const N: usize>(&self, args: [&str; N]) {
            self.git_output(args);
        }
    }

    impl Drop for TestGitRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
