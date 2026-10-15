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
mod tests {
    include!("git/history_graph_tests.rs");
    include!("git/branch_checkout_tests.rs");
    use super::{
        detect_git_repositories, git_command, load_commit_details, load_commit_diff,
        load_commit_files, load_commit_log, parse_branch_list, parse_porcelain_status,
        read_git_object_content, safe_branch_name, safe_commit_sha, safe_relative_path,
        BoundedContent, CommandGitRepositoryGateway, GitChangeStatus,
        GitChangedFile, GitCommitFilters, GitDiffPreviewUnavailableReason, GitRepositoryGateway,
        DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH, MAX_DIFF_SNAPSHOT_BYTES,
    };
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    /// Guarantees a distinct temp-repo path for every `TestGitRepo`, even when
    /// the platform clock is too coarse to disambiguate concurrent tests.
    static TEST_REPO_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn untrusted_git_command_injects_exec_neutralizing_config() {
        let command = git_command(false);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "diff.external=",
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.clean=",
                "-c",
                "filter.lfs.process=",
                "-c",
                "filter.lfs.required=false",
            ]
        );
    }

    #[test]
    fn trusted_git_command_keeps_argv_byte_identical() {
        assert!(git_command(true).get_args().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn untrusted_status_disables_core_fsmonitor_hook() {
        let repo = TestGitRepo::new();
        let sentinel = repo.path().join("fsmonitor-ran");
        let fsmonitor = repo.path().join("fsmonitor.sh");
        write_executable_script(
            &fsmonitor,
            &format!("#!/bin/sh\ntouch '{}'\nprintf '\\n'\n", sentinel.display()),
        );
        repo.run([
            "config",
            "core.fsmonitor",
            fsmonitor.to_str().expect("fsmonitor path"),
        ]);

        CommandGitRepositoryGateway::new(false)
            .status(repo.path())
            .expect("untrusted status");

        assert!(!sentinel.exists(), "untrusted status ran core.fsmonitor");
    }

    #[cfg(unix)]
    #[test]
    fn trusted_status_preserves_core_fsmonitor_hook() {
        let repo = TestGitRepo::new();
        let sentinel = repo.path().join("fsmonitor-ran");
        let fsmonitor = repo.path().join("fsmonitor.sh");
        write_executable_script(
            &fsmonitor,
            &format!("#!/bin/sh\ntouch '{}'\nprintf '\\n'\n", sentinel.display()),
        );
        repo.run([
            "config",
            "core.fsmonitor",
            fsmonitor.to_str().expect("fsmonitor path"),
        ]);

        CommandGitRepositoryGateway::new(true)
            .status(repo.path())
            .expect("trusted status");

        assert!(
            sentinel.exists(),
            "trusted status did not run core.fsmonitor"
        );
    }

    #[cfg(unix)]
    #[test]
    fn untrusted_commit_disables_pre_commit_hook_with_dev_null_hooks_path() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "hooks@example.com"]);
        repo.run(["config", "user.name", "Hook Tester"]);
        repo.write("tracked.txt", "content\n");
        repo.run(["add", "tracked.txt"]);
        let sentinel = repo.path().join("pre-commit-ran");
        write_executable_script(
            &repo.path().join(".git/hooks/pre-commit"),
            &format!("#!/bin/sh\ntouch '{}'\n", sentinel.display()),
        );

        let output = git_command(false)
            .arg("-C")
            .arg(repo.path())
            .args(["commit", "-m", "hook test"])
            .output()
            .expect("untrusted commit");

        assert!(
            output.status.success(),
            "untrusted commit failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!sentinel.exists(), "untrusted commit ran pre-commit hook");
    }

    #[cfg(unix)]
    #[test]
    fn untrusted_stage_disables_lfs_clean_smudge_and_process_filters() {
        let repo = TestGitRepo::new();
        let sentinel = repo.path().join("lfs-filter-ran");
        let filter = repo.path().join("lfs-filter.sh");
        write_executable_script(
            &filter,
            &format!("#!/bin/sh\ntouch '{}'\ncat\n", sentinel.display()),
        );
        repo.write(".gitattributes", "*.bin filter=lfs\n");
        repo.write("asset.bin", "content\n");
        for key in [
            "filter.lfs.clean",
            "filter.lfs.smudge",
            "filter.lfs.process",
        ] {
            repo.run(["config", key, filter.to_str().expect("filter path")]);
        }

        CommandGitRepositoryGateway::new(false)
            .stage(
                repo.path(),
                &[git_changed_file(
                    "asset.bin",
                    false,
                    GitChangeStatus::Untracked,
                )],
            )
            .expect("untrusted stage");

        assert!(!sentinel.exists(), "untrusted stage ran an LFS filter");
    }

    #[cfg(unix)]
    fn write_executable_script(path: &Path, content: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, content).expect("write executable script");
        let mut permissions = fs::metadata(path).expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("make script executable");
    }

    #[test]
    fn commit_log_returns_empty_for_unborn_head() {
        let repo = TestGitRepo::new();

        let commits =
            load_commit_log(repo.path(), empty_commit_filters(), true).expect("commit log");

        assert!(commits.is_empty());
    }

    #[test]
    fn fetch_updates_only_the_requested_workspace() {
        let fixture = RemoteGitFixture::new();
        fixture.commit_and_push("remote.txt", "remote\n", "remote update");
        let gateway = CommandGitRepositoryGateway::new(true);
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
        let status = CommandGitRepositoryGateway::new(true)
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

        let status = CommandGitRepositoryGateway::new(true)
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

        let status = CommandGitRepositoryGateway::new(true)
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

        let status = CommandGitRepositoryGateway::new(true)
            .status(&fixture.workspace_a)
            .expect("status");

        assert_eq!(status.upstream, None);

        RemoteGitFixture::run_git(&fixture.workspace_a, ["checkout", "--detach"]);
        let detached = CommandGitRepositoryGateway::new(true)
            .status(&fixture.workspace_a)
            .expect("detached status");

        assert_eq!(detached.branch, None);
        assert_eq!(detached.upstream, None);
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

        let commits =
            load_commit_log(repo.path(), empty_commit_filters(), true).expect("commit log");

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
            true,
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

        let details = load_commit_details(repo.path(), &sha, true).expect("details");

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

        let details = load_commit_details(repo.path(), &first_sha, true).expect("details");
        let files = load_commit_files(repo.path(), &first_sha, true).expect("files");
        let diff = load_commit_diff(repo.path(), &first_sha, "file.txt", None, &files, true)
            .expect("diff");

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
    fn detect_git_repositories_skips_codevo_managed_worktrees() {
        let repo = TestGitRepo::new();
        fs::create_dir_all(repo.path().join(".worktrees/agt-test"))
            .expect("managed worktree directory");
        fs::write(
            repo.path().join(".worktrees/agt-test/.git"),
            "gitdir: ../../.git/worktrees/agt-test\n",
        )
        .expect("managed worktree .git file");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(repositories, vec!["".to_string()]);
    }

    #[test]
    fn detect_git_repositories_preserves_dot_worktrees_in_plain_workspaces() {
        let repo = TestGitRepo::new();
        fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
        fs::create_dir_all(repo.path().join(".worktrees/product/.git"))
            .expect("nested product repository");

        let repositories =
            detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
                .expect("detect repositories");

        assert_eq!(repositories, vec![".worktrees/product".to_string()]);
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
    fn splits_partially_staged_status_into_index_and_worktree_changes() {
        let output = b"MM partial.php\0AM added.php\0MD deleted-later.php\0";
        let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

        assert_eq!(changes.len(), 6);
        assert_eq!(changes[0].relative_path, "partial.php");
        assert!(changes[0].is_staged);
        assert_eq!(changes[0].status, GitChangeStatus::Modified);
        assert_eq!(changes[1].relative_path, "partial.php");
        assert!(!changes[1].is_staged);
        assert_eq!(changes[1].status, GitChangeStatus::Modified);
        assert_eq!(changes[2].status, GitChangeStatus::Added);
        assert!(changes[2].is_staged);
        assert_eq!(changes[3].status, GitChangeStatus::Modified);
        assert!(!changes[3].is_staged);
        assert_eq!(changes[4].status, GitChangeStatus::Modified);
        assert!(changes[4].is_staged);
        assert_eq!(changes[5].status, GitChangeStatus::Deleted);
        assert!(!changes[5].is_staged);
    }

    #[test]
    fn rejects_paths_outside_workspace() {
        assert!(safe_relative_path("../secret.php").is_err());
        assert!(safe_relative_path("/secret.php").is_err());
        assert!(safe_relative_path("src/User.php").is_ok());
    }

    #[test]
    fn safe_commit_sha_rejects_non_hex_and_options() {
        assert!(safe_commit_sha("HEAD").is_err());
        assert!(safe_commit_sha("--output=/etc/passwd").is_err());
        assert!(safe_commit_sha("1a2").is_err());
        assert!(safe_commit_sha("deadBEEF").is_ok());
    }

    #[test]
    fn diff_isolates_index_and_worktree_for_partially_staged_file() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("file.txt", "one\ntwo\nthree\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "ONE\ntwo\nthree\n");
        repo.run(["add", "file.txt"]);
        repo.write("file.txt", "ONE\ntwo\nTHREE\n");

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        let staged = status
            .changes
            .iter()
            .find(|change| change.relative_path == "file.txt" && change.is_staged)
            .expect("staged change");
        let worktree = status
            .changes
            .iter()
            .find(|change| change.relative_path == "file.txt" && !change.is_staged)
            .expect("worktree change");

        let staged_diff = gateway.diff(repo.path(), staged).expect("staged diff");
        let worktree_diff = gateway.diff(repo.path(), worktree).expect("worktree diff");

        assert_eq!(staged_diff.original_content, "one\ntwo\nthree\n");
        assert_eq!(staged_diff.modified_content, "ONE\ntwo\nthree\n");
        assert_eq!(worktree_diff.original_content, "ONE\ntwo\nthree\n");
        assert_eq!(worktree_diff.modified_content, "ONE\ntwo\nTHREE\n");
    }

    #[test]
    fn diff_reads_colon_prefixed_index_path_without_git_stage_ambiguity() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("0:foo", "zero base\n");
        repo.write("foo", "plain base\n");
        repo.run(["add", "0:foo", "foo"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("0:foo", "zero index\n");
        repo.run(["add", "0:foo"]);
        repo.write("0:foo", "zero worktree\n");

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        let staged = status
            .changes
            .iter()
            .find(|change| change.relative_path == "0:foo" && change.is_staged)
            .expect("staged colon-path change");
        let worktree = status
            .changes
            .iter()
            .find(|change| change.relative_path == "0:foo" && !change.is_staged)
            .expect("worktree colon-path change");

        let staged_diff = gateway.diff(repo.path(), staged).expect("staged diff");
        let worktree_diff = gateway.diff(repo.path(), worktree).expect("worktree diff");

        assert_eq!(staged_diff.original_content, "zero base\n");
        assert_eq!(staged_diff.modified_content, "zero index\n");
        assert_eq!(worktree_diff.original_content, "zero index\n");
        assert_eq!(worktree_diff.modified_content, "zero worktree\n");
    }

    #[test]
    fn diff_rejects_large_staged_worktree_and_untracked_snapshots_before_loading() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("worktree-large.txt", "small\n");
        repo.run(["add", "worktree-large.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let large = vec![b'x'; MAX_DIFF_SNAPSHOT_BYTES as usize + 1];
        fs::write(repo.path().join("staged-large.txt"), &large).expect("large staged file");
        repo.run(["add", "staged-large.txt"]);
        fs::write(repo.path().join("worktree-large.txt"), &large).expect("large worktree file");
        fs::write(repo.path().join("untracked-large.txt"), &large).expect("large untracked file");

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        for (path, staged) in [
            ("staged-large.txt", true),
            ("worktree-large.txt", false),
            ("untracked-large.txt", false),
        ] {
            let change = status
                .changes
                .iter()
                .find(|change| change.relative_path == path && change.is_staged == staged)
                .unwrap_or_else(|| panic!("missing {path} change"));
            let diff = gateway
                .diff(repo.path(), change)
                .expect("large diff marker");

            assert_eq!(
                diff.preview_unavailable_reason,
                Some(GitDiffPreviewUnavailableReason::Large)
            );
            assert!(diff.original_content.is_empty());
            assert!(diff.modified_content.is_empty());
        }
    }

    #[test]
    fn git_object_reader_enforces_its_bound_independently_of_the_size_probe() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        let large = vec![b'x'; MAX_DIFF_SNAPSHOT_BYTES as usize + 1];
        fs::write(repo.path().join("large.txt"), &large).expect("large index file");
        repo.write("small.txt", "small content\n");
        repo.run(["add", "large.txt", "small.txt"]);

        let large_content = read_git_object_content(
            repo.path(),
            ":./large.txt",
            MAX_DIFF_SNAPSHOT_BYTES as usize,
            true,
        )
        .expect("bounded large blob read");
        let small_content = read_git_object_content(
            repo.path(),
            ":./small.txt",
            MAX_DIFF_SNAPSHOT_BYTES as usize,
            true,
        )
        .expect("bounded small blob read");
        let missing_content = read_git_object_content(
            repo.path(),
            ":./missing.txt",
            MAX_DIFF_SNAPSHOT_BYTES as usize,
            true,
        )
        .expect("missing blob read");

        assert!(matches!(large_content, BoundedContent::TooLarge));
        assert!(matches!(
            small_content,
            BoundedContent::Bytes(content) if content == b"small content\n"
        ));
        assert!(matches!(
            missing_content,
            BoundedContent::Bytes(content) if content.is_empty()
        ));
    }

    #[test]
    fn diff_rejects_binary_staged_and_worktree_snapshots_before_serialization() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("worktree.bin", "text\n");
        repo.run(["add", "worktree.bin"]);
        repo.run(["commit", "-m", "initial"]);
        fs::write(repo.path().join("staged.bin"), b"staged\0binary").expect("staged binary");
        repo.run(["add", "staged.bin"]);
        fs::write(repo.path().join("worktree.bin"), b"worktree\0binary").expect("worktree binary");

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        for (path, staged) in [("staged.bin", true), ("worktree.bin", false)] {
            let change = status
                .changes
                .iter()
                .find(|change| change.relative_path == path && change.is_staged == staged)
                .unwrap_or_else(|| panic!("missing {path} change"));
            let diff = gateway
                .diff(repo.path(), change)
                .expect("binary diff marker");

            assert_eq!(
                diff.preview_unavailable_reason,
                Some(GitDiffPreviewUnavailableReason::Binary)
            );
            assert!(diff.original_content.is_empty());
            assert!(diff.modified_content.is_empty());
        }
    }

    #[test]
    fn diff_handles_untracked_and_deleted_files_on_their_selected_side() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("deleted.txt", "tracked\n");
        repo.run(["add", "deleted.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("new.txt", "untracked\n");
        fs::create_dir_all(repo.path().join("new-directory")).expect("untracked directory");
        fs::write(repo.path().join("new-directory/file.txt"), "nested\n")
            .expect("nested untracked file");
        fs::remove_file(repo.path().join("deleted.txt")).expect("delete tracked file");

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        let untracked = status
            .changes
            .iter()
            .find(|change| change.relative_path == "new.txt")
            .expect("untracked change");
        let deleted = status
            .changes
            .iter()
            .find(|change| change.relative_path == "deleted.txt")
            .expect("deleted change");
        let nested_untracked = status
            .changes
            .iter()
            .find(|change| change.relative_path == "new-directory/file.txt")
            .expect("nested untracked file change");

        let untracked_diff = gateway
            .diff(repo.path(), untracked)
            .expect("untracked diff");
        let deleted_diff = gateway.diff(repo.path(), deleted).expect("deleted diff");
        let nested_diff = gateway
            .diff(repo.path(), nested_untracked)
            .expect("nested untracked diff");

        assert_eq!(untracked_diff.original_content, "");
        assert_eq!(untracked_diff.modified_content, "untracked\n");
        assert_eq!(deleted_diff.original_content, "tracked\n");
        assert_eq!(deleted_diff.modified_content, "");
        assert_eq!(nested_diff.original_content, "");
        assert_eq!(nested_diff.modified_content, "nested\n");
    }

    #[test]
    fn diff_handles_staged_delete_and_rename_against_head() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("deleted.txt", "delete me\n");
        repo.write("old.txt", "rename me\n");
        repo.run(["add", "deleted.txt", "old.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["rm", "deleted.txt"]);
        repo.run(["mv", "old.txt", "new.txt"]);

        let gateway = CommandGitRepositoryGateway::new(true);
        let status = gateway.status(repo.path()).expect("status");
        let deleted = status
            .changes
            .iter()
            .find(|change| change.relative_path == "deleted.txt")
            .expect("staged deletion");
        let renamed = status
            .changes
            .iter()
            .find(|change| change.relative_path == "new.txt")
            .expect("staged rename");

        let deleted_diff = gateway.diff(repo.path(), deleted).expect("deleted diff");
        let renamed_diff = gateway.diff(repo.path(), renamed).expect("renamed diff");

        assert!(deleted.is_staged);
        assert_eq!(deleted_diff.original_content, "delete me\n");
        assert_eq!(deleted_diff.modified_content, "");
        assert!(renamed.is_staged);
        assert_eq!(renamed.old_relative_path.as_deref(), Some("old.txt"));
        assert_eq!(renamed_diff.original_content, "rename me\n");
        assert_eq!(renamed_diff.modified_content, "rename me\n");
    }

    #[test]
    fn diff_routes_nested_repository_change_through_its_owner() {
        let workspace = TestGitRepo::new();
        let nested = workspace.path().join("packages/nested");
        fs::create_dir_all(&nested).expect("nested repository directory");
        let run_nested = |args: &[&str]| {
            let output = git_command(true)
                .arg("-C")
                .arg(&nested)
                .args(args)
                .output()
                .expect("run nested git");
            assert!(
                output.status.success(),
                "nested git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run_nested(&["init"]);
        run_nested(&["config", "user.email", "nested@example.com"]);
        run_nested(&["config", "user.name", "Nested Author"]);
        fs::write(nested.join("nested.txt"), "base\n").expect("nested base");
        run_nested(&["add", "nested.txt"]);
        run_nested(&["commit", "-m", "initial"]);
        fs::write(nested.join("nested.txt"), "changed\n").expect("nested change");

        let gateway = CommandGitRepositoryGateway::new(true);
        let nested_status = gateway.status(&nested).expect("nested status");
        let change = nested_status.changes.first().expect("nested change");
        let diff = gateway
            .diff(workspace.path(), change)
            .expect("nested diff from workspace root");

        assert_eq!(diff.change.relative_path, "nested.txt");
        assert_eq!(diff.original_content, "base\n");
        assert_eq!(diff.modified_content, "changed\n");
        assert_eq!(diff.preview_unavailable_reason, None);
    }

    #[test]
    fn diff_reads_unstaged_rename_base_from_the_old_index_path() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "diff@example.com"]);
        repo.run(["config", "user.name", "Diff Author"]);
        repo.write("old.txt", "before\n");
        repo.run(["add", "old.txt"]);
        repo.run(["commit", "-m", "initial"]);
        fs::rename(repo.path().join("old.txt"), repo.path().join("new.txt"))
            .expect("rename worktree file");
        fs::write(repo.path().join("new.txt"), "after\n").expect("modify renamed file");
        let canonical_root = repo.path().canonicalize().expect("canonical repository");

        let change = GitChangedFile {
            is_staged: false,
            is_unversioned: false,
            old_path: Some(canonical_root.join("old.txt").to_string_lossy().to_string()),
            old_relative_path: Some("old.txt".to_string()),
            path: canonical_root.join("new.txt").to_string_lossy().to_string(),
            relative_path: "new.txt".to_string(),
            status: GitChangeStatus::Renamed,
        };
        let diff = CommandGitRepositoryGateway::new(true)
            .diff(repo.path(), &change)
            .expect("unstaged rename diff");

        assert_eq!(diff.original_content, "before\n");
        assert_eq!(diff.modified_content, "after\n");
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

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);
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
    fn stage_refuses_conflicted_file_with_markers_without_resolving_index() {
        let repo = conflicted_repo();
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");

        let error = gateway
            .stage(repo.path(), &[change])
            .expect_err("conflict markers must block staging");

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("conflict.txt"));
        assert!(!repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
        assert!(repo
            .git_output(["diff", "--cached", "--name-only", "--", "clean.txt"])
            .is_empty());
    }

    #[test]
    fn stage_refuses_crlf_conflicted_file_with_markers_without_resolving_index() {
        let repo = branch_repo();
        repo.run(["config", "core.autocrlf", "false"]);
        repo.write("conflict.txt", "base\r\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "base"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("conflict.txt", "feature\r\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "feature"]);
        repo.run(["checkout", "main"]);
        repo.write("conflict.txt", "main\r\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "main"]);
        repo.merge_expecting_conflict("feature");
        assert!(repo.read("conflict.txt").contains("<<<<<<< HEAD\r\n"));
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");

        let error = gateway
            .stage(repo.path(), &[change])
            .expect_err("CRLF conflict markers must block staging");

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("conflict.txt"));
        assert!(!repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
    }

    #[test]
    fn stage_refuses_diff3_conflict_then_stages_after_resolution() {
        let repo = branch_repo();
        repo.run(["config", "merge.conflictStyle", "diff3"]);
        repo.write("conflict.txt", "base\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "base"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("conflict.txt", "feature\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "feature"]);
        repo.run(["checkout", "main"]);
        repo.write("conflict.txt", "main\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "main"]);
        repo.merge_expecting_conflict("feature");
        assert!(repo.read("conflict.txt").contains("|||||||"));
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");

        let error = gateway
            .stage(repo.path(), std::slice::from_ref(&change))
            .expect_err("diff3 conflict markers must block staging");

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("conflict.txt"));
        assert!(!repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());

        repo.write("conflict.txt", "resolved\n");
        gateway
            .stage(repo.path(), &[change])
            .expect("mark diff3 conflict resolved");

        assert!(repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
    }

    #[test]
    fn stage_resolves_delete_modify_conflict_as_deletion() {
        let repo = branch_repo();
        repo.write("conflict.txt", "base\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "base"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("conflict.txt", "feature\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "modify"]);
        repo.run(["checkout", "main"]);
        repo.run(["rm", "conflict.txt"]);
        repo.run(["commit", "-m", "delete"]);
        repo.merge_expecting_conflict("feature");
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");
        fs::remove_file(repo.path().join("conflict.txt")).expect("choose deletion");

        gateway
            .stage(repo.path(), &[change])
            .expect("stage conflict deletion");

        assert!(repo
            .git_output(["ls-files", "--", "conflict.txt"])
            .is_empty());
        assert!(repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
    }

    #[test]
    fn stage_refuses_unmerged_file_even_when_payload_status_is_stale() {
        let repo = conflicted_repo();
        let gateway = CommandGitRepositoryGateway::new(true);
        let mut change = conflicted_change(&gateway, &repo, "conflict.txt");
        change.status = GitChangeStatus::Modified;

        let error = gateway
            .stage(repo.path(), &[change])
            .expect_err("unmerged index entries must block staging with markers");

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("conflict.txt"));
        assert!(!repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
    }

    #[test]
    fn stage_marks_resolved_conflicted_file_without_markers() {
        let repo = conflicted_repo();
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");
        repo.write("conflict.txt", "resolved\n");

        let status = gateway
            .stage(repo.path(), &[change])
            .expect("mark conflict resolved");

        assert!(repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
        assert!(status.changes.iter().any(|change| {
            change.relative_path == "conflict.txt"
                && change.status == GitChangeStatus::Modified
                && change.is_staged
        }));
    }

    #[test]
    fn stage_allows_conflicted_file_with_only_a_stray_marker_line() {
        let repo = conflicted_repo();
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = conflicted_change(&gateway, &repo, "conflict.txt");
        repo.write("conflict.txt", "resolved\n<<<<<<< stray text\n");

        gateway
            .stage(repo.path(), &[change])
            .expect("a lone marker is not a conflict block");

        assert!(repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
    }

    #[test]
    fn stage_refuses_mixed_batch_without_partially_mutating_index() {
        let repo = conflicted_repo();
        let gateway = CommandGitRepositoryGateway::new(true);
        repo.write("clean.txt", "changed\n");
        let status = gateway.status(repo.path()).expect("status");
        let changes = [
            status
                .changes
                .iter()
                .find(|change| change.relative_path == "clean.txt")
                .expect("clean change")
                .clone(),
            status
                .changes
                .iter()
                .find(|change| change.relative_path == "conflict.txt")
                .expect("conflicted change")
                .clone(),
        ];

        let error = gateway
            .stage(repo.path(), &changes)
            .expect_err("mixed batch must be atomic");

        assert!(error.to_string().contains("conflict.txt"));
        assert!(!repo
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
        assert!(repo
            .git_output(["diff", "--cached", "--name-only", "--", "clean.txt"])
            .is_empty());
    }

    #[test]
    fn stage_does_not_check_markers_in_non_conflicted_file() {
        let repo = branch_repo();
        repo.write(
            "markers.txt",
            "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n",
        );
        let gateway = CommandGitRepositoryGateway::new(true);
        let change = gateway
            .status(repo.path())
            .expect("status")
            .changes
            .into_iter()
            .find(|change| change.relative_path == "markers.txt")
            .expect("marker-like file");

        let status = gateway
            .stage(repo.path(), &[change])
            .expect("stage non-conflicted marker text");

        assert!(status
            .changes
            .iter()
            .any(|change| { change.relative_path == "markers.txt" && change.is_staged }));
    }

    #[test]
    fn stage_conflict_validation_is_isolated_to_requested_root() {
        let repo_a = conflicted_repo();
        let repo_b = branch_repo();
        repo_b.write(
            "markers.txt",
            "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n",
        );
        let gateway = CommandGitRepositoryGateway::new(true);
        let change_b = gateway
            .status(repo_b.path())
            .expect("repo B status")
            .changes
            .into_iter()
            .find(|change| change.relative_path == "markers.txt")
            .expect("repo B change");

        gateway
            .stage(repo_b.path(), &[change_b])
            .expect("stage in repo B");

        assert!(!repo_a
            .git_output(["ls-files", "-u", "--", "conflict.txt"])
            .is_empty());
        assert_eq!(
            repo_b.git_output(["diff", "--cached", "--name-only"]),
            "markers.txt\n"
        );
    }

    // --- patch generation (corruption-prone; assert on git's own output) ---

    // --- stage_hunk / unstage_hunk round trips through real git ---

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
    fn remote_branch_list_reports_fetched_branches_without_head_pointer() {
        let fixture = RemoteGitFixture::new();
        RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
        fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
        RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
        RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "topic/HEAD"]);
        RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "topic/HEAD"]);
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

        let branches = CommandGitRepositoryGateway::new(true)
            .remote_branch_list(&fixture.workspace_a)
            .expect("remote branch list");
        let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();

        assert!(names.contains(&"origin/feature-x"));
        assert!(names.contains(&"origin/main"));
        assert!(names.contains(&"origin/topic/HEAD"), "{names:?}");
        assert!(!names.contains(&"origin/HEAD"));
    }

    #[test]
    fn checkout_remote_branch_creates_tracking_branch_and_isolates_workspace() {
        let fixture = RemoteGitFixture::new();
        RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
        fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
        RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

        let branches = CommandGitRepositoryGateway::new(true)
            .checkout_remote_branch(&fixture.workspace_a, "origin/feature-x")
            .expect("checkout remote branch");

        assert!(branches
            .iter()
            .any(|branch| branch.name == "feature-x" && branch.is_current));
        assert_eq!(
            fixture.git_output(&fixture.workspace_a, ["rev-parse", "--abbrev-ref", "@{u}"]),
            "origin/feature-x"
        );
        assert_eq!(
            fixture.git_output(&fixture.workspace_b, ["rev-parse", "--abbrev-ref", "HEAD"]),
            "main"
        );
        assert!(!fixture.workspace_b.join("feature.txt").exists());
    }

    #[test]
    fn checkout_remote_branch_accepts_genuine_branch_ending_in_head() {
        let fixture = RemoteGitFixture::new();
        RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "topic/HEAD"]);
        fixture.commit_in(&fixture.seed, "topic.txt", "topic\n", "topic");
        RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "topic/HEAD"]);
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

        let branches = CommandGitRepositoryGateway::new(true)
            .checkout_remote_branch(&fixture.workspace_a, "origin/topic/HEAD")
            .expect("checkout genuine remote branch ending in HEAD");

        assert!(branches
            .iter()
            .any(|branch| branch.name == "topic/HEAD" && branch.is_current));
        assert_eq!(
            fixture.git_output(
                &fixture.workspace_a,
                ["config", "--get", "branch.topic/HEAD.remote"],
            ),
            "origin"
        );
        assert_eq!(
            fixture.git_output(
                &fixture.workspace_a,
                ["config", "--get", "branch.topic/HEAD.merge"],
            ),
            "refs/heads/topic/HEAD"
        );
    }

    #[test]
    fn checkout_remote_branch_surfaces_git_name_collision() {
        let fixture = RemoteGitFixture::new();
        RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
        fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
        RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
        RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);
        RemoteGitFixture::run_git(&fixture.workspace_a, ["branch", "feature-x"]);

        let error = CommandGitRepositoryGateway::new(true)
            .checkout_remote_branch(&fixture.workspace_a, "origin/feature-x")
            .expect_err("name collision");

        assert!(error
            .to_string()
            .contains("a branch named 'feature-x' already exists"));
    }

    #[test]
    fn branch_list_reports_local_branches_with_current_flag() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["branch", "feature"]);

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);

        assert!(gateway.create_branch(repo.path(), "--force").is_err());
        assert!(gateway.create_branch(repo.path(), "bad name").is_err());
    }

    #[test]
    fn unmerged_branch_delete_has_stable_english_error() {
        let repo = branch_repo();
        repo.write("file.txt", "base\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "base"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("file.txt", "feature\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "unmerged feature"]);
        repo.run(["checkout", "main"]);

        let gateway = CommandGitRepositoryGateway::new(true);
        let error = gateway
            .delete_branch(repo.path(), "feature", false)
            .expect_err("unmerged branch delete must fail");

        assert!(
            error.to_string().contains("not fully merged"),
            "unexpected git error: {error}"
        );
    }

    #[test]
    fn switch_branch_moves_head_when_the_working_tree_is_clean() {
        let repo = branch_repo();
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["branch", "feature"]);

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);
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

        let gateway = CommandGitRepositoryGateway::new(true);

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

    fn conflicted_repo() -> TestGitRepo {
        let repo = branch_repo();
        repo.write("conflict.txt", "base\n");
        repo.write("clean.txt", "base\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "base"]);
        repo.run(["checkout", "-b", "feature"]);
        repo.write("conflict.txt", "feature\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "feature"]);
        repo.run(["checkout", "main"]);
        repo.write("conflict.txt", "main\n");
        repo.run(["add", "conflict.txt"]);
        repo.run(["commit", "-m", "main"]);

        let output = git_command(true)
            .arg("-C")
            .arg(repo.path())
            .args(["merge", "feature"])
            .output()
            .expect("run conflicting merge");
        assert!(!output.status.success(), "merge must conflict");
        repo
    }

    fn conflicted_change(
        gateway: &CommandGitRepositoryGateway,
        repo: &TestGitRepo,
        relative_path: &str,
    ) -> GitChangedFile {
        let change = gateway
            .status(repo.path())
            .expect("conflict status")
            .changes
            .into_iter()
            .find(|change| change.relative_path == relative_path)
            .expect("conflicted change");
        assert_eq!(change.status, GitChangeStatus::Conflicted);
        change
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
            all_branches: None,
            author: None,
            branch: None,
            cursor: None,
            limit: None,
            path: None,
            query: None,
        }
    }

    #[test]
    fn history_diff_rejects_missing_binary_and_oversized_blobs() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "history@example.com"]);
        repo.run(["config", "user.name", "History"]);
        fs::write(repo.path().join("binary"), [0, 1, 2]).unwrap();
        fs::write(repo.path().join("invalid"), [255, 254]).unwrap();
        fs::write(repo.path().join("large"), vec![b'x'; 2_000_001]).unwrap();
        repo.write("ordinary", "hello");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "files"]);
        let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let files = load_commit_files(repo.path(), &sha, true).unwrap();
        for path in ["binary", "invalid", "large"] {
            assert!(load_commit_diff(repo.path(), &sha, path, None, &files, true).is_err());
        }
        let mut missing = files.clone();
        missing[0].path = "missing".to_string();
        assert!(load_commit_diff(repo.path(), &sha, "missing", None, &missing, true).is_err());
        repo.run(["rm", "ordinary"]);
        repo.run(["commit", "-m", "delete"]);
        let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let files = load_commit_files(repo.path(), &sha, true).unwrap();
        let diff = load_commit_diff(repo.path(), &sha, "ordinary", None, &files, true).unwrap();
        assert_eq!(diff.original_content, "hello");
        assert_eq!(diff.modified_content, "");
    }

    #[test]
    fn history_lists_merge_first_parent_and_literal_paths() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "history@example.com"]);
        repo.run(["config", "user.name", "History"]);
        repo.write("root", "root");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "root"]);
        let branch = repo
            .git_output(["branch", "--show-current"])
            .trim()
            .to_string();
        repo.run(["checkout", "-b", "topic"]);
        repo.write("tab\tand\nnewline", "content");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "topic"]);
        repo.run(["checkout", &branch]);
        repo.run(["merge", "--no-ff", "topic", "-m", "merge"]);
        let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
        let files = load_commit_files(repo.path(), &sha, true).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "tab\tand\nnewline");
        let diff = load_commit_diff(repo.path(), &sha, &files[0].path, None, &files, true).unwrap();
        assert_eq!(diff.original_content, "");
        assert_eq!(diff.modified_content, "content");
        assert!(
            load_commit_log(&repo.path().join("missing"), empty_commit_filters(), true).is_err()
        );
        repo.run(["checkout", "--orphan", "unborn"]);
        assert!(load_commit_log(repo.path(), empty_commit_filters(), true)
            .unwrap()
            .is_empty());
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
            let output = git_command(true)
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
            let output = git_command(true)
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
            let output = git_command(true).args(args).output().expect("run git");
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

        fn merge_expecting_conflict(&self, branch: &str) {
            let output = git_command(true)
                .arg("-C")
                .arg(&self.path)
                .args(["merge", branch])
                .output()
                .expect("run conflicting merge");
            assert!(!output.status.success(), "merge must conflict");
        }

        fn git_output<const N: usize>(&self, args: [&str; N]) -> String {
            let output = git_command(true)
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
