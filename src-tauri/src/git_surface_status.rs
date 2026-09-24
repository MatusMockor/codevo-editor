use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;
use std::time::{Duration, Instant};

use super::git_integration::{
    current_branch, run_integration_command, run_integration_command_prefix, CommandError,
    INTEGRATION_LOCAL_TIMEOUT, MAX_INTEGRATION_STDOUT_BYTES,
};

pub(crate) const MAX_SURFACE_UNPUSHED_COMMITS: usize = 20;
pub(crate) const MAX_SURFACE_LINE_STATS: usize = 2_000;
pub(crate) const MAX_SURFACE_BRANCHES: usize = 200;
pub(crate) const MAX_SURFACE_WORKTREE_BRANCHES: usize = 64;
pub(crate) const MAX_SURFACE_SUBJECT_BYTES: usize = 200;
pub(crate) const MAX_SURFACE_REF_BYTES: usize = 256;
pub(crate) const MAX_SURFACE_PATH_BYTES: usize = 4_096;
const DEFAULT_BASE_CANDIDATES: [&str; 4] = ["main", "master", "trunk", "develop"];
const FIELD_SEPARATOR: char = '\u{1f}';
pub(crate) const SURFACE_STATUS_BUDGET: Duration = Duration::from_secs(30);
pub(crate) const MAX_JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
pub(crate) const EMPTY_TREE_OBJECT_ID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
use git_surface_untracked_stats::{untracked_line_stats, UNTRACKED_STAT_LIMITS};

const BUDGET_EXHAUSTED: CommandError = CommandError::TimedOut(Duration::ZERO);

pub(crate) struct SurfaceDeadline {
    expires_at: Instant,
}

impl SurfaceDeadline {
    pub(crate) fn after(budget: Duration) -> Self {
        Self {
            expires_at: Instant::now() + budget,
        }
    }

    fn remaining(&self) -> Option<Duration> {
        self.expires_at
            .checked_duration_since(Instant::now())
            .filter(|remaining| !remaining.is_zero())
    }
}

enum HeadState {
    Commit(String),
    Unborn,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurfaceUpstream {
    pub(crate) name: String,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnpushedCommit {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
    pub(crate) authored_at_epoch_seconds: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineStat {
    pub(crate) relative_path: String,
    pub(crate) added: Option<u32>,
    pub(crate) deleted: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSurfaceStatus {
    pub(crate) branch: Option<String>,
    pub(crate) default_base: Option<String>,
    pub(crate) has_remote: bool,
    pub(crate) upstream: Option<SurfaceUpstream>,
    pub(crate) unpushed: Vec<UnpushedCommit>,
    pub(crate) unpushed_truncated: bool,
    pub(crate) line_stats: Vec<LineStat>,
    pub(crate) line_stats_truncated: bool,
    pub(crate) local_branches: Vec<String>,
    pub(crate) remote_branches: Vec<String>,
    pub(crate) worktree_branches: Vec<String>,
    pub(crate) branches_truncated: bool,
}

pub(crate) fn git_surface_status(root: &Path) -> Result<GitSurfaceStatus, String> {
    let deadline = SurfaceDeadline::after(SURFACE_STATUS_BUDGET);
    git_surface_status_within(root, &deadline)
}

pub(crate) fn git_surface_status_within(
    root: &Path,
    deadline: &SurfaceDeadline,
) -> Result<GitSurfaceStatus, String> {
    let branch = current_branch(root)?;
    let head = head_state(root, deadline);
    let has_remote = has_remote(root, deadline);
    let (local_branches, local_truncated) =
        refs_within(root, "refs/heads", deadline).unwrap_or((Vec::new(), true));
    let (remote_branches, remote_truncated) =
        refs_within(root, "refs/remotes", deadline).unwrap_or((Vec::new(), true));
    let default_base = default_base_within(root, &local_branches, deadline);
    let upstream = upstream_within(root, deadline);
    let (unpushed, unpushed_truncated) = unpushed_commits(root, &head, has_remote, deadline);
    let (line_stats, line_stats_truncated) =
        line_stats(root, &head, deadline, MAX_INTEGRATION_STDOUT_BYTES);
    Ok(GitSurfaceStatus {
        branch,
        default_base,
        has_remote: has_remote.unwrap_or(false),
        upstream,
        unpushed,
        unpushed_truncated,
        line_stats,
        line_stats_truncated,
        local_branches,
        remote_branches,
        worktree_branches: worktree_branches(root, deadline),
        branches_truncated: local_truncated || remote_truncated,
    })
}

pub(crate) fn default_base(root: &Path, local_branches: &[String]) -> Option<String> {
    let deadline = SurfaceDeadline::after(INTEGRATION_LOCAL_TIMEOUT);
    default_base_within(root, local_branches, &deadline)
}

fn default_base_within(
    root: &Path,
    local_branches: &[String],
    deadline: &SurfaceDeadline,
) -> Option<String> {
    let remote_head = git_within(
        root,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
        deadline,
    )
    .ok();
    let remote_head = remote_head
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(remote_head) = remote_head {
        let local = remote_head.strip_prefix("origin/").unwrap_or(remote_head);
        if local_branches.iter().any(|branch| branch == local) {
            return Some(local.to_string());
        }
        return Some(remote_head.to_string());
    }
    DEFAULT_BASE_CANDIDATES
        .iter()
        .find(|candidate| local_branches.iter().any(|branch| branch == *candidate))
        .map(|candidate| candidate.to_string())
}

pub(crate) fn refs(root: &Path, namespace: &str) -> Result<(Vec<String>, bool), String> {
    let deadline = SurfaceDeadline::after(INTEGRATION_LOCAL_TIMEOUT);
    refs_within(root, namespace, &deadline).map_err(String::from)
}

fn refs_within(
    root: &Path,
    namespace: &str,
    deadline: &SurfaceDeadline,
) -> Result<(Vec<String>, bool), CommandError> {
    let count = format!("--count={}", MAX_SURFACE_BRANCHES + 1);
    let output = git_within(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            count.as_str(),
            namespace,
        ],
        deadline,
    )?;
    Ok(parse_refs(&output, namespace == "refs/remotes"))
}

pub(crate) fn parse_refs(output: &str, remote: bool) -> (Vec<String>, bool) {
    let truncated = output.lines().count() > MAX_SURFACE_BRANCHES;
    let names = output
        .lines()
        .take(MAX_SURFACE_BRANCHES)
        .map(str::trim)
        .filter(|name| is_displayable(name, MAX_SURFACE_REF_BYTES))
        .filter(|name| !remote || (name.contains('/') && !name.ends_with("/HEAD")))
        .map(str::to_string)
        .collect();
    (names, truncated)
}

pub(crate) fn parse_numstat_z(output: &str, limit: usize) -> (Vec<LineStat>, bool) {
    let mut records = output.split('\0');
    let mut stats = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let mut columns = record.splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) =
            (columns.next(), columns.next(), columns.next())
        else {
            continue;
        };
        let relative_path = match path.is_empty() {
            true => {
                records.next();
                records.next().unwrap_or_default()
            }
            false => path,
        };
        if !is_displayable(relative_path, MAX_SURFACE_PATH_BYTES) {
            continue;
        }
        if stats.len() >= limit {
            return (stats, true);
        }
        stats.push(LineStat {
            relative_path: relative_path.to_string(),
            added: added.parse().ok(),
            deleted: deleted.parse().ok(),
        });
    }
    (stats, false)
}

pub(crate) fn parse_commit_line(line: &str) -> Option<UnpushedCommit> {
    let mut fields = line.splitn(4, FIELD_SEPARATOR);
    let sha = fields.next()?;
    let short_sha = fields.next()?;
    let authored_at_epoch_seconds = fields.next()?.parse::<i64>().ok()?;
    let subject = fields.next().unwrap_or_default();
    if !is_object_id(sha) {
        return None;
    }
    Some(UnpushedCommit {
        sha: sha.to_string(),
        short_sha: short_sha.chars().take(12).collect(),
        subject: clip_utf8(subject.trim(), MAX_SURFACE_SUBJECT_BYTES),
        authored_at_epoch_seconds: authored_at_epoch_seconds
            .clamp(-MAX_JS_SAFE_INTEGER, MAX_JS_SAFE_INTEGER),
    })
}

pub(crate) fn clip_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(crate) fn git(root: &Path, arguments: &[&str]) -> Result<String, String> {
    let arguments: Vec<&OsStr> = arguments.iter().map(OsStr::new).collect();
    run_integration_command(root, &arguments, INTEGRATION_LOCAL_TIMEOUT).map_err(String::from)
}

fn git_within(
    root: &Path,
    arguments: &[&str],
    deadline: &SurfaceDeadline,
) -> Result<String, CommandError> {
    let timeout = deadline.remaining().ok_or(BUDGET_EXHAUSTED)?;
    let arguments: Vec<&OsStr> = arguments.iter().map(OsStr::new).collect();
    run_integration_command(root, &arguments, timeout)
}

fn head_state(root: &Path, deadline: &SurfaceDeadline) -> HeadState {
    let verified = git_within(
        root,
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        deadline,
    );
    match verified {
        Ok(output) => match is_object_id(output.trim()) {
            true => HeadState::Commit(output.trim().to_string()),
            false => HeadState::Unknown,
        },
        Err(CommandError::Failed(_)) => {
            match git_within(root, &["symbolic-ref", "--quiet", "HEAD"], deadline) {
                Ok(_) => HeadState::Unborn,
                Err(_) => HeadState::Unknown,
            }
        }
        Err(_) => HeadState::Unknown,
    }
}

fn has_remote(root: &Path, deadline: &SurfaceDeadline) -> Option<bool> {
    git_within(root, &["remote"], deadline)
        .ok()
        .map(|output| !output.trim().is_empty())
}

pub(crate) fn upstream(root: &Path) -> Option<SurfaceUpstream> {
    let deadline = SurfaceDeadline::after(INTEGRATION_LOCAL_TIMEOUT);
    upstream_within(root, &deadline)
}

fn upstream_within(root: &Path, deadline: &SurfaceDeadline) -> Option<SurfaceUpstream> {
    let name = git_within(
        root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        deadline,
    )
    .ok()?;
    let counts = git_within(
        root,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
        deadline,
    )
    .ok()?;
    let mut parts = counts.split_whitespace();
    let behind = parts.next()?.parse().ok()?;
    let ahead = parts.next()?.parse().ok()?;
    Some(SurfaceUpstream {
        name: clip_utf8(name.trim(), MAX_SURFACE_SUBJECT_BYTES),
        ahead,
        behind,
    })
}

fn unpushed_commits(
    root: &Path,
    head: &HeadState,
    has_remote: Option<bool>,
    deadline: &SurfaceDeadline,
) -> (Vec<UnpushedCommit>, bool) {
    let head = match (head, has_remote) {
        (_, Some(false)) | (HeadState::Unborn, _) => return (Vec::new(), false),
        (HeadState::Unknown, _) | (_, None) => return (Vec::new(), true),
        (HeadState::Commit(head), Some(true)) => head,
    };
    let limit = format!("--max-count={}", MAX_SURFACE_UNPUSHED_COMMITS + 1);
    let Ok(output) = git_within(
        root,
        &[
            "log",
            "--format=%H%x1f%h%x1f%at%x1f%s",
            limit.as_str(),
            head.as_str(),
            "--not",
            "--remotes",
        ],
        deadline,
    ) else {
        return (Vec::new(), true);
    };
    let mut commits: Vec<UnpushedCommit> = output.lines().filter_map(parse_commit_line).collect();
    let truncated = commits.len() > MAX_SURFACE_UNPUSHED_COMMITS;
    commits.truncate(MAX_SURFACE_UNPUSHED_COMMITS);
    (commits, truncated)
}

fn line_stats(
    root: &Path,
    head: &HeadState,
    deadline: &SurfaceDeadline,
    max_bytes: usize,
) -> (Vec<LineStat>, bool) {
    let base = match head {
        HeadState::Commit(head) => head.as_str(),
        HeadState::Unborn => EMPTY_TREE_OBJECT_ID,
        HeadState::Unknown => return (Vec::new(), true),
    };
    let Some(timeout) = deadline.remaining() else {
        return (Vec::new(), true);
    };
    let arguments = ["diff", "--numstat", "-z", "-M", base, "--"].map(OsStr::new);
    let Ok((output, capped)) = run_integration_command_prefix(root, &arguments, timeout, max_bytes)
    else {
        return (Vec::new(), true);
    };
    let (mut stats, truncated) =
        parse_numstat_z(complete_z_records(&output, capped), MAX_SURFACE_LINE_STATS);
    let slots = MAX_SURFACE_LINE_STATS.saturating_sub(stats.len());
    let (untracked, untracked_partial) =
        untracked_line_stats(root, deadline, slots, UNTRACKED_STAT_LIMITS);
    stats.extend(untracked);
    (stats, truncated || capped || untracked_partial)
}

pub(crate) fn complete_z_records(output: &str, capped: bool) -> &str {
    if !capped {
        return output;
    }
    output
        .rfind('\0')
        .map(|end| &output[..=end])
        .unwrap_or_default()
}

fn worktree_branches(root: &Path, deadline: &SurfaceDeadline) -> Vec<String> {
    let Ok(output) = git_within(root, &["worktree", "list", "--porcelain"], deadline) else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| line.strip_prefix("branch refs/heads/"))
        .filter(|name| is_displayable(name, MAX_SURFACE_REF_BYTES))
        .map(str::to_string)
        .take(MAX_SURFACE_WORKTREE_BRANCHES)
        .collect()
}

fn is_displayable(value: &str, max_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

fn is_object_id(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64)
        && value.chars().all(|character| character.is_ascii_hexdigit())
}

#[path = "git_surface_untracked_stats.rs"]
mod git_surface_untracked_stats;

#[cfg(test)]
#[path = "git_surface_status_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "git_surface_wire_contract_tests.rs"]
mod wire_contract_tests;
