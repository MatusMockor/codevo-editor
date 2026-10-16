use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_DIFF_SNAPSHOT_BYTES: u64 = 2_000_000;

mod amend_index;
pub(crate) mod bounded_process;
mod branch_checkout;
mod discard_guard;
mod discard_restore;
pub(crate) mod file_discard;
pub(crate) mod head_amend;
mod history;
mod history_log;
mod history_refs;
mod pinned_root;
mod repository_discovery;
mod scratch_index;
#[cfg(test)]
pub(crate) mod working_tree_test_repo;

pub use history::{load_commit_details, load_commit_diff, load_commit_files};
pub use history_log::load_commit_log;
pub use history_refs::load_git_branches;

pub use repository_discovery::{detect_git_repositories, DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH};

const UNTRUSTED_GIT_CONFIG: [&str; 7] = [
    "core.fsmonitor=false",
    "core.hooksPath=/dev/null",
    "diff.external=",
    "filter.lfs.smudge=",
    "filter.lfs.clean=",
    "filter.lfs.process=",
    "filter.lfs.required=false",
];

fn git_command(trusted: bool) -> Command {
    let mut command = Command::new("git");
    command.env("LC_ALL", "C").env("LANG", "C");

    // Read-only and mutating Git operations remain available in untrusted
    // workspaces. Instead of blocking them, override repository-owned config
    // entries that can execute programs. Trusted workspaces intentionally get
    // the exact command argv they had before this hardening so hooks and LFS
    // integrations continue to work.
    if !trusted {
        for config in UNTRUSTED_GIT_CONFIG {
            command.arg("-c").arg(config);
        }
    }

    command
}

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
    pub preview_unavailable_reason: Option<GitDiffPreviewUnavailableReason>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffPreviewUnavailableReason {
    Binary,
    Large,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub git_available: bool,
    pub is_repository: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub current: Option<String>,
    pub local: Vec<String>,
    pub remotes: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCommitFilters {
    pub all_branches: Option<bool>,
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
    fn commit(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus>;
    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff>;
    fn fetch(&self, root: &Path) -> io::Result<GitStatus>;
    fn push(&self, root: &Path) -> io::Result<GitStatus>;
    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn status(&self, root: &Path) -> io::Result<GitStatus>;
    fn branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>>;
    fn remote_branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>>;
    fn checkout_remote_branch(&self, root: &Path, name: &str) -> io::Result<Vec<GitBranch>>;
    fn current_branch(&self, root: &Path) -> io::Result<Option<String>>;
    fn create_branch(&self, root: &Path, name: &str) -> io::Result<()>;
    fn delete_branch(&self, root: &Path, name: &str, force: bool) -> io::Result<()>;
    fn switch_branch(&self, root: &Path, name: &str) -> io::Result<()>;
}

pub struct CommandGitRepositoryGateway {
    trusted: bool,
}

impl CommandGitRepositoryGateway {
    pub fn new(trusted: bool) -> Self {
        Self { trusted }
    }

}

impl GitRepositoryGateway for CommandGitRepositoryGateway {
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

        commit_selected_staged_changes(&root, message, changes, self.trusted)?;
        self.status(&root)
    }

    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff> {
        let workspace_root = root.canonicalize()?;
        let target = resolve_diff_target(&workspace_root, change, self.trusted)?;
        let snapshot = diff_snapshot(&target.repository_root, &target.change, self.trusted)?;

        Ok(GitFileDiff {
            change: change.clone(),
            language: language_for_path(&target.change.relative_path),
            modified_content: snapshot.modified_content,
            original_content: snapshot.original_content,
            preview_unavailable_reason: snapshot.preview_unavailable_reason,
        })
    }

    fn fetch(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git_remote(&root, ["fetch", "--prune"], self.trusted)?;
        self.status(&root)
    }

    fn push(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git_remote(&root, ["push"], self.trusted)?;
        self.status(&root)
    }

    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;
        }

        let unmerged = unmerged_relative_paths(&root, self.trusted)?;
        let mut conflicts_with_markers = Vec::new();
        for change in changes {
            if change.status != GitChangeStatus::Conflicted
                && !unmerged.contains(change.relative_path.as_str())
            {
                continue;
            }

            let content = match fs::read(root.join(&change.relative_path)) {
                Ok(content) => content,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if contains_conflict_marker_block(&String::from_utf8_lossy(&content)) {
                conflicts_with_markers.push(change.relative_path.as_str());
            }
        }

        if !conflicts_with_markers.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "Cannot mark resolved while conflict markers remain in: {}.",
                    conflicts_with_markers.join(", ")
                ),
            ));
        }

        for change in changes {
            run_git(
                &root,
                ["add", "--", change.relative_path.as_str()],
                self.trusted,
            )?;
        }

        self.status(&root)
    }

    fn status(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        if !is_git_repository(&root, self.trusted)? {
            return Ok(empty_git_status(&root));
        }

        let output = git_command(self.trusted)
            .arg("-C")
            .arg(&root)
            .arg("status")
            .arg("--porcelain=v1")
            .arg("-z")
            .arg("--untracked-files=all")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        let branch = current_branch(&root, self.trusted).ok().flatten();
        let upstream = branch
            .as_ref()
            .and_then(|_| upstream_tracking(&root, self.trusted));

        Ok(GitStatus {
            branch,
            changes: parse_porcelain_status(&root, &output.stdout)?,
            is_repository: true,
            root_path: root.to_string_lossy().to_string(),
            upstream,
        })
    }

    fn branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>> {
        let root = root.canonicalize()?;

        // `for-each-ref` over `refs/heads/` lists only LOCAL branches (no remote
        // tracking refs leak in). `%(HEAD)` is `*` for the checked-out branch and
        // a space otherwise; fields are joined with the ASCII Unit Separator so a
        // branch name can never be confused with the current-flag column.
        let output = git_command(self.trusted)
            .arg("-C")
            .arg(&root)
            .arg("for-each-ref")
            .arg(format!("--format={BRANCH_LIST_FORMAT}"))
            .arg("refs/heads/")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(parse_branch_list(&String::from_utf8_lossy(&output.stdout)))
    }

    fn remote_branch_list(&self, root: &Path) -> io::Result<Vec<GitBranch>> {
        let root = root.canonicalize()?;
        let output = git_command(self.trusted)
            .arg("-C")
            .arg(&root)
            .arg("for-each-ref")
            .arg("--format=%(refname:strip=2)\t%(symref)")
            .arg("refs/remotes/")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        Ok(parse_remote_branch_list(&String::from_utf8_lossy(
            &output.stdout,
        )))
    }

    fn checkout_remote_branch(&self, root: &Path, name: &str) -> io::Result<Vec<GitBranch>> {
        let root = branch_checkout::checkout(
            root,
            name,
            branch_checkout::CheckoutBranchKind::Remote,
            self.trusted,
        )?;
        root.branches(self.trusted)
    }

    fn current_branch(&self, root: &Path) -> io::Result<Option<String>> {
        let root = root.canonicalize()?;

        current_branch(&root, self.trusted)
    }

    fn create_branch(&self, root: &Path, name: &str) -> io::Result<()> {
        let root = root.canonicalize()?;
        let name = safe_branch_name(name)?;

        // `git branch <name>` creates the branch WITHOUT switching to it, so the
        // working tree is never touched. `--` terminates option parsing so a name
        // can never be read as a flag (defence in depth atop `safe_branch_name`).
        run_git(&root, ["branch", "--", name.as_str()], self.trusted)
    }

    fn delete_branch(&self, root: &Path, name: &str, force: bool) -> io::Result<()> {
        let root = root.canonicalize()?;
        let name = safe_branch_name(name)?;

        if force {
            return run_git(&root, ["branch", "-D", "--", name.as_str()], self.trusted);
        }

        run_git(&root, ["branch", "-d", "--", name.as_str()], self.trusted)
    }

    fn switch_branch(&self, root: &Path, name: &str) -> io::Result<()> {
        branch_checkout::checkout(
            root,
            name,
            branch_checkout::CheckoutBranchKind::Local,
            self.trusted,
        )
        .map(|_| ())
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

fn is_git_repository(root: &Path, trusted: bool) -> io::Result<bool> {
    let output = git_command(trusted)
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
    git_command(true)
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn current_branch(root: &Path, trusted: bool) -> io::Result<Option<String>> {
    let output = git_command(trusted)
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

fn upstream_tracking(root: &Path, trusted: bool) -> Option<GitUpstreamTracking> {
    let branch = git_output_vec(root, vec!["rev-parse", "--abbrev-ref", "@{u}"], trusted)
        .ok()?
        .trim()
        .to_string();

    if branch.is_empty() {
        return None;
    }

    let counts = git_output_vec(
        root,
        vec!["rev-list", "--left-right", "--count", "@{u}...HEAD"],
        trusted,
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
        let has_rename = status_code.contains('R');
        let old_relative_path = if has_rename {
            let old = parts
                .get(index)
                .map(|part| String::from_utf8_lossy(part).to_string());

            if old.is_some() {
                index += 1;
            }

            old
        } else {
            None
        };

        changes.extend(git_changes_for_status(
            root,
            status_code,
            &relative_path,
            old_relative_path.as_deref(),
        )?);
    }

    Ok(changes)
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

fn parse_remote_branch_list(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(name, symref)| (name.trim(), symref.trim()))
        .filter(|(name, _)| !name.is_empty())
        .filter(|(name, symref)| !name.ends_with("/HEAD") || symref.is_empty())
        .map(|name| GitBranch {
            is_current: false,
            name: name.0.to_string(),
        })
        .collect()
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

    let valid = git_command(true)
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

fn git_changes_for_status(
    root: &Path,
    status_code: &str,
    relative_path: &str,
    old_relative_path: Option<&str>,
) -> io::Result<Vec<GitChangedFile>> {
    if status_code == "??" {
        return Ok(vec![git_changed_file(
            root,
            relative_path,
            None,
            GitChangeStatus::Untracked,
            false,
        )?]);
    }

    if status_code.contains('U') || matches!(status_code, "AA" | "DD") {
        return Ok(vec![git_changed_file(
            root,
            relative_path,
            old_relative_path,
            GitChangeStatus::Conflicted,
            false,
        )?]);
    }

    let mut status = status_code.chars();
    let index_status = status.next().unwrap_or(' ');
    let worktree_status = status.next().unwrap_or(' ');
    let mut changes = Vec::with_capacity(2);

    if index_status != ' ' && index_status != '?' {
        changes.push(git_changed_file(
            root,
            relative_path,
            (index_status == 'R').then_some(old_relative_path).flatten(),
            git_change_status_for_column(index_status),
            true,
        )?);
    }

    if worktree_status != ' ' && worktree_status != '?' {
        changes.push(git_changed_file(
            root,
            relative_path,
            (worktree_status == 'R')
                .then_some(old_relative_path)
                .flatten(),
            git_change_status_for_column(worktree_status),
            false,
        )?);
    }

    Ok(changes)
}

fn git_change_status_for_column(status: char) -> GitChangeStatus {
    match status {
        'A' => GitChangeStatus::Added,
        'D' => GitChangeStatus::Deleted,
        'R' => GitChangeStatus::Renamed,
        _ => GitChangeStatus::Modified,
    }
}

fn git_changed_file(
    root: &Path,
    relative_path: &str,
    old_relative_path: Option<&str>,
    status: GitChangeStatus,
    is_staged: bool,
) -> io::Result<GitChangedFile> {
    let path = workspace_file_path(root, relative_path)?;
    let old_path = old_relative_path
        .map(|path| workspace_file_path(root, path))
        .transpose()?;

    Ok(GitChangedFile {
        is_staged,
        is_unversioned: status == GitChangeStatus::Untracked,
        old_path,
        old_relative_path: old_relative_path.map(ToOwned::to_owned),
        path,
        relative_path: relative_path.to_string(),
        status,
    })
}

fn unmerged_relative_paths(root: &Path, trusted: bool) -> io::Result<HashSet<String>> {
    let output = git_output_vec(
        root,
        vec!["diff", "--name-only", "--diff-filter=U", "-z"],
        trusted,
    )?;

    Ok(output
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect())
}

fn contains_conflict_marker_block(content: &str) -> bool {
    let mut has_opening = false;
    let mut has_separator = false;

    for raw_line in content.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if is_conflict_marker_line(line, "<<<<<<<") {
            has_opening = true;
            has_separator = false;
            continue;
        }

        if !has_opening {
            continue;
        }

        if !has_separator && is_conflict_marker_line(line, "=======") {
            has_separator = true;
            continue;
        }

        if has_separator && is_conflict_marker_line(line, ">>>>>>>") {
            return true;
        }
    }

    false
}

fn is_conflict_marker_line(line: &str, marker: &str) -> bool {
    let Some(suffix) = line.strip_prefix(marker) else {
        return false;
    };

    suffix.is_empty() || suffix.starts_with(' ')
}

fn run_git<const N: usize>(root: &Path, args: [&str; N], trusted: bool) -> io::Result<()> {
    run_git_vec(root, args.to_vec(), trusted)
}

fn run_git_remote<const N: usize>(root: &Path, args: [&str; N], trusted: bool) -> io::Result<()> {
    let output = git_command(trusted)
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(root)
        .args(args.to_vec())
        .output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::other(
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn run_git_vec(root: &Path, args: Vec<&str>, trusted: bool) -> io::Result<()> {
    let output = git_command(trusted)
        .arg("-C")
        .arg(root)
        .args(args)
        .output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::other(
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn git_output_vec<S: AsRef<str>>(root: &Path, args: Vec<S>, trusted: bool) -> io::Result<String> {
    git_output_vec_with_env(root, args, None, trusted)
}

fn git_output_vec_with_env<S: AsRef<str>>(
    root: &Path,
    args: Vec<S>,
    index_file: Option<&Path>,
    trusted: bool,
) -> io::Result<String> {
    let command_args: Vec<String> = args
        .into_iter()
        .map(|value| value.as_ref().to_owned())
        .collect();

    let mut command = git_command(trusted);
    command.arg("-C").arg(root).args(&command_args);

    if let Some(index_file) = index_file {
        command.env("GIT_INDEX_FILE", index_file);
    }

    let output = command.output()?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    Err(io::Error::other(
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn run_git_vec_with_env(
    root: &Path,
    args: Vec<&str>,
    index_file: Option<&Path>,
    trusted: bool,
) -> io::Result<()> {
    git_output_vec_with_env(root, args, index_file, trusted).map(|_| ())
}

fn commit_selected_staged_changes(
    root: &Path,
    message: &str,
    changes: &[GitChangedFile],
    trusted: bool,
) -> io::Result<()> {
    let has_head = git_output_vec(root, vec!["rev-parse", "--verify", "HEAD"], trusted).is_ok();
    let tree = write_selected_staged_tree(root, changes, has_head.then_some("HEAD"), trusted)?;
    let tree = tree.trim();
    let commit = if has_head {
        git_output_vec(
            root,
            vec!["commit-tree", tree, "-p", "HEAD", "-m", message],
            trusted,
        )?
    } else {
        git_output_vec(root, vec!["commit-tree", tree, "-m", message], trusted)?
    };
    let commit = commit.trim();
    run_git_vec(root, vec!["update-ref", "HEAD", commit], trusted)?;

    Ok(())
}

fn write_selected_staged_tree(
    root: &Path,
    changes: &[GitChangedFile],
    base: Option<&str>,
    trusted: bool,
) -> io::Result<String> {
    let temp_index = TempGitIndex::new(root);
    if let Some(base) = base {
        run_git_vec_with_env(
            root,
            vec!["read-tree", base],
            Some(temp_index.path()),
            trusted,
        )?;
    }

    for change in changes {
        apply_staged_change_to_temp_index(root, temp_index.path(), change, trusted)?;
    }

    git_output_vec_with_env(root, vec!["write-tree"], Some(temp_index.path()), trusted)
}

fn apply_staged_change_to_temp_index(
    root: &Path,
    temp_index: &Path,
    change: &GitChangedFile,
    trusted: bool,
) -> io::Result<()> {
    if has_unmerged_index_entries(root, &change.relative_path, trusted)? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Conflicted files cannot be committed from the commit panel.",
        ));
    }

    if let Some(old_relative_path) = cached_rename_old_path(root, &change.relative_path, trusted)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                old_relative_path.as_str(),
            ],
            Some(temp_index),
            trusted,
        )?;
    }

    if is_cached_deletion(root, &change.relative_path, trusted)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                change.relative_path.as_str(),
            ],
            Some(temp_index),
            trusted,
        )?;
        return Ok(());
    }

    let entry = git_output_vec(
        root,
        vec![
            "--literal-pathspecs",
            "ls-files",
            "-s",
            "--",
            change.relative_path.as_str(),
        ],
        trusted,
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
        trusted,
    )
}

fn cached_name_status_records(root: &Path, trusted: bool) -> io::Result<Vec<Vec<String>>> {
    let output = git_output_vec(
        root,
        vec!["diff", "--cached", "--name-status", "-M"],
        trusted,
    )?;
    Ok(output
        .lines()
        .map(|line| line.split('\t').map(str::to_string).collect())
        .collect())
}

fn cached_rename_old_path(
    root: &Path,
    relative_path: &str,
    trusted: bool,
) -> io::Result<Option<String>> {
    for fields in cached_name_status_records(root, trusted)? {
        if fields.first().is_some_and(|status| status.starts_with('R'))
            && fields.get(2).is_some_and(|path| path == relative_path)
        {
            return Ok(fields.get(1).cloned());
        }
    }

    Ok(None)
}

fn is_cached_deletion(root: &Path, relative_path: &str, trusted: bool) -> io::Result<bool> {
    Ok(cached_name_status_records(root, trusted)?
        .iter()
        .any(|fields| {
            fields.first().is_some_and(|status| status == "D")
                && fields.get(1).is_some_and(|path| path == relative_path)
        }))
}

fn has_unmerged_index_entries(root: &Path, relative_path: &str, trusted: bool) -> io::Result<bool> {
    let output = git_output_vec(
        root,
        vec!["--literal-pathspecs", "ls-files", "-u", "--", relative_path],
        trusted,
    )?;

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

struct GitDiffTarget {
    change: GitChangedFile,
    repository_root: PathBuf,
}

fn resolve_diff_target(
    workspace_root: &Path,
    change: &GitChangedFile,
    trusted: bool,
) -> io::Result<GitDiffTarget> {
    let absolute_path = Path::new(&change.path);
    if !absolute_path.is_absolute() || !absolute_path.starts_with(workspace_root) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git diff path is outside the workspace.",
        ));
    }

    let probe_directory = nearest_existing_directory(absolute_path, workspace_root)?;
    let repository_root = git_output_vec(
        &probe_directory,
        vec!["rev-parse", "--show-toplevel"],
        trusted,
    )?;
    let repository_root = PathBuf::from(repository_root.trim()).canonicalize()?;

    if !repository_root.starts_with(workspace_root) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git repository is outside the workspace.",
        ));
    }

    let relative_path = absolute_path
        .strip_prefix(&repository_root)
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Git diff path is outside its repository.",
            )
        })?
        .to_string_lossy()
        .replace('\\', "/");
    safe_relative_path(&relative_path)?;

    let old_relative_path = change
        .old_path
        .as_deref()
        .and_then(|path| Path::new(path).strip_prefix(&repository_root).ok())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .or_else(|| change.old_relative_path.clone());
    if let Some(path) = old_relative_path.as_deref() {
        safe_relative_path(path)?;
    }

    Ok(GitDiffTarget {
        change: GitChangedFile {
            old_path: old_relative_path
                .as_deref()
                .map(|path| workspace_file_path(&repository_root, path))
                .transpose()?,
            old_relative_path,
            path: workspace_file_path(&repository_root, &relative_path)?,
            relative_path,
            ..change.clone()
        },
        repository_root,
    })
}

fn nearest_existing_directory(path: &Path, workspace_root: &Path) -> io::Result<PathBuf> {
    let mut candidate = path.parent().unwrap_or(workspace_root).to_path_buf();

    while !candidate.exists() {
        if candidate == workspace_root || !candidate.pop() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Git diff path has no existing workspace parent.",
            ));
        }
    }

    if !candidate.starts_with(workspace_root) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git diff path is outside the workspace.",
        ));
    }

    Ok(candidate)
}

enum DiffContentSource {
    GitObject(String),
    Missing,
    Worktree(PathBuf),
}

struct DiffSnapshot {
    modified_content: String,
    original_content: String,
    preview_unavailable_reason: Option<GitDiffPreviewUnavailableReason>,
}

enum BoundedContent {
    Bytes(Vec<u8>),
    TooLarge,
}

fn diff_snapshot(
    repository_root: &Path,
    change: &GitChangedFile,
    trusted: bool,
) -> io::Result<DiffSnapshot> {
    if change.is_staged {
        let original_path = change
            .old_relative_path
            .as_deref()
            .unwrap_or(change.relative_path.as_str());
        safe_relative_path(original_path)?;
        safe_relative_path(&change.relative_path)?;

        return load_diff_snapshot(
            repository_root,
            DiffContentSource::GitObject(format!("HEAD:{original_path}")),
            DiffContentSource::GitObject(format!(":./{}", change.relative_path)),
            trusted,
        );
    }

    let index_relative_path = change
        .old_relative_path
        .as_deref()
        .unwrap_or(change.relative_path.as_str());
    safe_relative_path(index_relative_path)?;
    let worktree_source = match change.status {
        GitChangeStatus::Deleted => DiffContentSource::Missing,
        _ => DiffContentSource::Worktree(
            repository_root.join(safe_relative_path(&change.relative_path)?),
        ),
    };

    load_diff_snapshot(
        repository_root,
        DiffContentSource::GitObject(format!(":./{index_relative_path}")),
        worktree_source,
        trusted,
    )
}

fn load_diff_snapshot(
    root: &Path,
    original_source: DiffContentSource,
    modified_source: DiffContentSource,
    trusted: bool,
) -> io::Result<DiffSnapshot> {
    let original_size = diff_content_size(root, &original_source, trusted)?;
    let modified_size = diff_content_size(root, &modified_source, trusted)?;
    let combined_size = original_size
        .unwrap_or_default()
        .saturating_add(modified_size.unwrap_or_default());

    if combined_size > MAX_DIFF_SNAPSHOT_BYTES {
        return Ok(unavailable_diff_snapshot(GitDiffPreviewUnavailableReason::Large));
    }

    let original = read_diff_content(
        root,
        &original_source,
        MAX_DIFF_SNAPSHOT_BYTES as usize,
        trusted,
    )?;
    let original = match original {
        BoundedContent::Bytes(content) => content,
        BoundedContent::TooLarge => {
            return Ok(unavailable_diff_snapshot(GitDiffPreviewUnavailableReason::Large));
        }
    };
    let remaining = MAX_DIFF_SNAPSHOT_BYTES as usize - original.len();
    let modified = read_diff_content(root, &modified_source, remaining, trusted)?;
    let modified = match modified {
        BoundedContent::Bytes(content) => content,
        BoundedContent::TooLarge => {
            return Ok(unavailable_diff_snapshot(GitDiffPreviewUnavailableReason::Large));
        }
    };

    if original.contains(&0) || modified.contains(&0) {
        return Ok(unavailable_diff_snapshot(GitDiffPreviewUnavailableReason::Binary));
    }

    Ok(DiffSnapshot {
        modified_content: String::from_utf8_lossy(&modified).to_string(),
        original_content: String::from_utf8_lossy(&original).to_string(),
        preview_unavailable_reason: None,
    })
}

fn diff_content_size(
    root: &Path,
    source: &DiffContentSource,
    trusted: bool,
) -> io::Result<Option<u64>> {
    let object = match source {
        DiffContentSource::Missing => return Ok(None),
        DiffContentSource::Worktree(path) => {
            return fs::metadata(path).map(|metadata| Some(metadata.len()));
        }
        DiffContentSource::GitObject(object) => object,
    };
    let output = git_command(trusted)
        .arg("-C")
        .arg(root)
        .args(["cat-file", "-s", object])
        .output()?;

    if !output.status.success() {
        return Ok(None);
    }

    let size = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Git blob size is invalid."))?;
    Ok(Some(size))
}

fn read_diff_content(
    root: &Path,
    source: &DiffContentSource,
    max_bytes: usize,
    trusted: bool,
) -> io::Result<BoundedContent> {
    let object = match source {
        DiffContentSource::Missing => return Ok(BoundedContent::Bytes(Vec::new())),
        DiffContentSource::Worktree(path) => {
            let mut content = Vec::with_capacity(max_bytes.min(64 * 1024));
            fs::File::open(path)?
                .take(max_bytes.saturating_add(1) as u64)
                .read_to_end(&mut content)?;
            if content.len() > max_bytes {
                return Ok(BoundedContent::TooLarge);
            }

            return Ok(BoundedContent::Bytes(content));
        }
        DiffContentSource::GitObject(object) => object,
    };
    read_git_object_content(root, object, max_bytes, trusted)
}

fn read_git_object_content(
    root: &Path,
    object: &str,
    max_bytes: usize,
    trusted: bool,
) -> io::Result<BoundedContent> {
    let mut child = git_command(trusted)
        .arg("-C")
        .arg(root)
        .arg("show")
        .arg(object)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_and_reap(&mut child)?;
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Git blob process did not expose stdout.",
            ));
        }
    };
    let mut content = Vec::with_capacity(max_bytes.min(64 * 1024));
    let read_result = stdout
        .by_ref()
        .take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut content);
    drop(stdout);

    if let Err(error) = read_result {
        terminate_and_reap(&mut child)?;
        return Err(error);
    }

    if content.len() > max_bytes {
        terminate_and_reap(&mut child)?;
        return Ok(BoundedContent::TooLarge);
    }

    let status = child.wait()?;
    if !status.success() {
        return Ok(BoundedContent::Bytes(Vec::new()));
    }

    Ok(BoundedContent::Bytes(content))
}

fn terminate_and_reap(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }

    let kill_result = child.kill();
    let wait_result = child.wait();
    if let Err(error) = kill_result {
        if error.kind() != io::ErrorKind::InvalidInput {
            return Err(error);
        }
    }

    wait_result.map(|_| ())
}

fn unavailable_diff_snapshot(reason: GitDiffPreviewUnavailableReason) -> DiffSnapshot {
    DiffSnapshot {
        modified_content: String::new(),
        original_content: String::new(),
        preview_unavailable_reason: Some(reason),
    }
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
mod tests;
