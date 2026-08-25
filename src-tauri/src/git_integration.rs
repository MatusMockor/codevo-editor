use crate::git_worktree::{ensure_worktree_path_in_base, read_bounded_stream, AGENT_BRANCH_PREFIX};
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

pub const MAX_INTEGRATION_STDOUT_BYTES: usize = 256 * 1024;
pub const MAX_INTEGRATION_STDERR_BYTES: usize = 8 * 1024;
pub const MAX_INTEGRATION_CONFLICT_FILES: usize = 200;
pub const MAX_INTEGRATION_CHANGE_COUNT: usize = 10_000;
pub const MAX_INTEGRATION_BRANCH_BYTES: usize = 512;
pub const MAX_REMOTE_NAME_BYTES: usize = 128;
pub const MAX_COMPARE_URL_BYTES: usize = 2048;
pub const MAX_MERGE_MESSAGE_BYTES: usize = 1024;
pub const INTEGRATION_NETWORK_TIMEOUT: Duration = Duration::from_secs(120);
pub const INTEGRATION_LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
pub const INTEGRATION_MERGE_TIMEOUT: Duration = Duration::from_secs(120);

pub const COMPARE_URL_HOSTS: [&str; 3] = ["github.com", "gitlab.com", "bitbucket.org"];
pub const MAX_LISTED_REMOTES: usize = 64;
pub const DEFAULT_REMOTE_NAME: &str = "origin";

const HOOKS_DISABLED_CONFIG: &str = "core.hooksPath=/dev/null";
const FSMONITOR_DISABLED_CONFIG: &str = "core.fsmonitor=false";
pub const ENV_ALLOWLIST: [&str; 31] = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "SSH_ASKPASS",
    "SSH_ASKPASS_REQUIRE",
    "DISPLAY",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_ASKPASS",
    "GIT_EXEC_PATH",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
];
const GENERIC_FAILURE_MESSAGE: &str = "The git command failed.";
const NOT_FAST_FORWARD_MARKER: &str = "not possible to fast-forward";
const AUTH_MARKERS: [&str; 7] = [
    "authentication failed",
    "could not read username",
    "could not read password",
    "permission denied",
    "publickey",
    "terminal prompts disabled",
    "403",
];
const REJECTED_MARKERS: [&str; 4] = [
    "[rejected]",
    "non-fast-forward",
    "fetch first",
    "failed to push some refs",
];

pub const PUSH_NO_REMOTE_CODE: &str = "noRemote:";
pub const PUSH_REJECTED_CODE: &str = "rejected:";
pub const PUSH_AUTH_REQUIRED_CODE: &str = "authRequired:";
pub const PUSH_GIT_ERROR_CODE: &str = "gitError:";

pub const IN_PLACE_INTEGRATION_ERROR: &str =
    "An in-place agent thread has no worktree branch to integrate.";
pub const UNSAFE_BRANCH_NAME_ERROR: &str = "The branch name is not a safe git branch name.";
pub const UNSAFE_REMOTE_NAME_ERROR: &str = "The remote name is not a safe git remote name.";
pub const MERGE_MESSAGE_OUT_OF_BOUNDS_ERROR: &str =
    "The merge message is empty or exceeds the supported length.";
pub const EXPECTED_OBJECT_ID_ERROR: &str =
    "An expected git object id must be 40 lowercase hexadecimal characters.";
pub const PRIMARY_CHANGED_DURING_INTEGRATION_ERROR: &str =
    "The main checkout changed during integration. The merge commit exists but was not verified against the expected heads.";
pub const CONFLICT_LISTING_FAILED_ERROR: &str =
    "The merge conflicted and was aborted, but the conflicted files could not be listed.";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipWorktreeStatus {
    pub branch: String,
    pub head: String,
    pub dirty: bool,
    pub change_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipPrimaryStatus {
    pub branch: Option<String>,
    pub head: String,
    pub dirty: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipRelation {
    pub ahead_of_primary: usize,
    pub behind_primary: usize,
    pub fast_forwardable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipUpstream {
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipRemote {
    pub name: String,
    pub upstream: Option<ShipUpstream>,
    pub compare_url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShipStatus {
    pub worktree: ShipWorktreeStatus,
    pub primary: ShipPrimaryStatus,
    pub relation: ShipRelation,
    pub remote: Option<ShipRemote>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushReceipt {
    pub remote: String,
    pub branch: String,
    pub compare_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitIntegrationMode {
    FastForward,
    Merge,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitIntegrationOutcome {
    #[serde(rename_all = "camelCase")]
    Integrated {
        merge_sha: String,
        into_branch: String,
    },
    Conflicted {
        files: Vec<String>,
        truncated: bool,
    },
    PrimaryDirty,
    PrimaryDetached,
    StaleExpectation,
    NotFastForward,
    AbortFailed {
        message: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PushFailure {
    NoRemote,
    Rejected(String),
    AuthRequired(String),
    GitError(String),
}

impl PushFailure {
    pub fn into_error_string(self) -> String {
        match self {
            Self::NoRemote => {
                format!("{PUSH_NO_REMOTE_CODE}No remote is configured for this repository.")
            }
            Self::Rejected(message) => format!("{PUSH_REJECTED_CODE}{}", clip(&message)),
            Self::AuthRequired(message) => format!("{PUSH_AUTH_REQUIRED_CODE}{}", clip(&message)),
            Self::GitError(message) => format!("{PUSH_GIT_ERROR_CODE}{}", clip(&message)),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationRequest {
    pub mode: GitIntegrationMode,
    pub expected_primary_branch: String,
    pub expected_primary_head: String,
    pub expected_branch_head: String,
    pub merge_message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipTargets {
    pub repository_root: PathBuf,
    pub worktree: PathBuf,
    pub in_place: bool,
}

pub fn resolve_ship_targets(
    repository_root: &Path,
    worktree_path: Option<&Path>,
) -> Result<ShipTargets, String> {
    let Some(worktree_path) = worktree_path else {
        return Ok(ShipTargets {
            repository_root: repository_root.to_path_buf(),
            worktree: repository_root.to_path_buf(),
            in_place: true,
        });
    };

    let worktree = ensure_worktree_path_in_base(repository_root, worktree_path)?;

    Ok(ShipTargets {
        repository_root: repository_root.to_path_buf(),
        worktree,
        in_place: false,
    })
}

pub fn safe_branch_name(candidate: &str) -> Result<String, String> {
    if candidate.is_empty() || candidate.len() > MAX_INTEGRATION_BRANCH_BYTES {
        return Err(UNSAFE_BRANCH_NAME_ERROR.to_string());
    }

    if candidate.trim() != candidate {
        return Err(UNSAFE_BRANCH_NAME_ERROR.to_string());
    }

    if candidate.starts_with('-') || candidate.contains("@{") || candidate.contains("..") {
        return Err(UNSAFE_BRANCH_NAME_ERROR.to_string());
    }

    if candidate.chars().any(char::is_control) {
        return Err(UNSAFE_BRANCH_NAME_ERROR.to_string());
    }

    Ok(candidate.to_string())
}

pub fn safe_remote_name(candidate: &str) -> Result<String, String> {
    if candidate.is_empty() || candidate.len() > MAX_REMOTE_NAME_BYTES {
        return Err(UNSAFE_REMOTE_NAME_ERROR.to_string());
    }

    let mut characters = candidate.chars();
    let Some(first) = characters.next() else {
        return Err(UNSAFE_REMOTE_NAME_ERROR.to_string());
    };

    if !first.is_ascii_alphanumeric() {
        return Err(UNSAFE_REMOTE_NAME_ERROR.to_string());
    }

    if !characters.all(|character| character.is_ascii_alphanumeric() || "._-".contains(character)) {
        return Err(UNSAFE_REMOTE_NAME_ERROR.to_string());
    }

    Ok(candidate.to_string())
}

pub fn safe_merge_message(candidate: &str) -> Result<String, String> {
    if candidate.trim().is_empty() || candidate.len() > MAX_MERGE_MESSAGE_BYTES {
        return Err(MERGE_MESSAGE_OUT_OF_BOUNDS_ERROR.to_string());
    }

    if candidate
        .chars()
        .any(|character| character.is_control() && character != '\n')
    {
        return Err(MERGE_MESSAGE_OUT_OF_BOUNDS_ERROR.to_string());
    }

    Ok(candidate.to_string())
}

pub fn safe_object_id(candidate: &str) -> Result<String, String> {
    if candidate.len() != 40 {
        return Err(EXPECTED_OBJECT_ID_ERROR.to_string());
    }

    if !candidate
        .chars()
        .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
    {
        return Err(EXPECTED_OBJECT_ID_ERROR.to_string());
    }

    Ok(candidate.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandError {
    TimedOut(Duration),
    Failed(String),
    Io(String),
}

impl CommandError {
    pub fn into_message(self) -> String {
        match self {
            Self::TimedOut(timeout) => {
                format!(
                    "The git command timed out after {} seconds.",
                    timeout.as_secs()
                )
            }
            Self::Failed(message) => message,
            Self::Io(message) => message,
        }
    }
}

impl From<CommandError> for String {
    fn from(error: CommandError) -> Self {
        error.into_message()
    }
}

pub fn ship_status(targets: &ShipTargets) -> Result<GitShipStatus, String> {
    let worktree_branch = current_branch(&targets.worktree)?
        .ok_or_else(|| "The worktree is on a detached HEAD.".to_string())?;
    ensure_agent_branch(targets, &worktree_branch)?;
    let worktree_head = head_object_id(&targets.worktree)?;
    let change_count = worktree_change_count(&targets.worktree)?;

    let primary_branch = current_branch(&targets.repository_root)?;
    let primary_head = head_object_id(&targets.repository_root)?;
    let primary_dirty = primary_is_dirty(&targets.repository_root)?;

    let (behind_primary, ahead_of_primary) =
        left_right_count(&targets.repository_root, &primary_head, &worktree_head)?;
    let base = merge_base(&targets.repository_root, &primary_head, &worktree_head)?;
    let fast_forwardable = base.as_deref() == Some(primary_head.as_str());

    let remote = remote_status(targets, &worktree_branch, primary_branch.as_deref())?;

    Ok(GitShipStatus {
        worktree: ShipWorktreeStatus {
            branch: worktree_branch,
            head: worktree_head,
            dirty: change_count > 0,
            change_count,
        },
        primary: ShipPrimaryStatus {
            branch: primary_branch,
            head: primary_head,
            dirty: primary_dirty,
        },
        relation: ShipRelation {
            ahead_of_primary,
            behind_primary,
            fast_forwardable,
        },
        remote,
    })
}

pub fn push_branch_upstream(targets: &ShipTargets) -> Result<GitPushReceipt, PushFailure> {
    let branch = current_branch(&targets.worktree)
        .map_err(PushFailure::GitError)?
        .ok_or_else(|| PushFailure::GitError("The worktree is on a detached HEAD.".to_string()))?;
    ensure_agent_branch(targets, &branch).map_err(PushFailure::GitError)?;
    let remote = discover_remote(&targets.worktree, &branch)
        .map_err(PushFailure::GitError)?
        .ok_or(PushFailure::NoRemote)?;

    run_integration_command(
        &targets.worktree,
        &[
            OsStr::new("push"),
            OsStr::new("-u"),
            OsStr::new("--"),
            OsStr::new(remote.as_str()),
            OsStr::new(branch.as_str()),
        ],
        INTEGRATION_NETWORK_TIMEOUT,
    )
    .map_err(classify_push_failure)?;

    let primary_branch = current_branch(&targets.repository_root).ok().flatten();
    let compare_url = remote_compare_url(targets, &remote, &branch, primary_branch.as_deref());

    Ok(GitPushReceipt {
        remote,
        branch,
        compare_url,
    })
}

type ConflictLister = fn(&Path) -> Result<(Vec<String>, bool), CommandError>;

pub fn integrate_branch(
    targets: &ShipTargets,
    request: &IntegrationRequest,
) -> Result<GitIntegrationOutcome, String> {
    integrate_branch_with(targets, request, conflicted_files)
}

fn integrate_branch_with(
    targets: &ShipTargets,
    request: &IntegrationRequest,
    conflict_lister: ConflictLister,
) -> Result<GitIntegrationOutcome, String> {
    if targets.in_place {
        return Err(IN_PLACE_INTEGRATION_ERROR.to_string());
    }

    let branch = current_branch(&targets.worktree)?
        .ok_or_else(|| "The worktree is on a detached HEAD.".to_string())?;
    ensure_agent_branch(targets, &branch)?;

    let Some(primary_branch) = current_branch(&targets.repository_root)? else {
        return Ok(GitIntegrationOutcome::PrimaryDetached);
    };
    if primary_branch == branch {
        return Err("The main checkout is on the agent branch itself.".to_string());
    }

    let primary_head = head_object_id(&targets.repository_root)?;
    let branch_head = head_object_id(&targets.worktree)?;
    if primary_branch != request.expected_primary_branch
        || primary_head != request.expected_primary_head
        || branch_head != request.expected_branch_head
    {
        return Ok(GitIntegrationOutcome::StaleExpectation);
    }

    if primary_is_dirty(&targets.repository_root)? {
        return Ok(GitIntegrationOutcome::PrimaryDirty);
    }

    let merge_result = run_merge(&targets.repository_root, request, &branch_head);
    let Err(error) = merge_result else {
        let merge_sha = head_object_id(&targets.repository_root)?;
        let parents = commit_parents(&targets.repository_root, &merge_sha)?;
        verify_integration_result(
            request.mode,
            &merge_sha,
            &parents,
            &primary_head,
            &branch_head,
        )?;
        return Ok(GitIntegrationOutcome::Integrated {
            merge_sha,
            into_branch: primary_branch,
        });
    };

    let merge_started = match merge_in_progress(&targets.repository_root) {
        Ok(started) => started,
        Err(probe_error) => {
            let _ = abort_merge(&targets.repository_root);
            return Ok(GitIntegrationOutcome::AbortFailed {
                message: clip(&format!(
                    "Could not determine whether the merge left the main checkout mid-merge: {}",
                    probe_error.into_message()
                )),
            });
        }
    };
    if !merge_started {
        return classify_merge_failure(request.mode, error);
    }

    let conflicted = conflict_lister(&targets.repository_root);
    if let Err(abort_error) = abort_merge(&targets.repository_root) {
        return Ok(GitIntegrationOutcome::AbortFailed {
            message: clip(&abort_error.into_message()),
        });
    }

    match merge_in_progress(&targets.repository_root) {
        Ok(false) => {}
        Ok(true) => {
            return Ok(GitIntegrationOutcome::AbortFailed {
                message: "The merge abort left the main checkout mid-merge.".to_string(),
            });
        }
        Err(probe_error) => {
            return Ok(GitIntegrationOutcome::AbortFailed {
                message: clip(&format!(
                    "Could not confirm that the merge abort cleared the main checkout: {}",
                    probe_error.into_message()
                )),
            });
        }
    }

    let restored_head = head_object_id(&targets.repository_root)?;
    if restored_head != primary_head {
        return Ok(GitIntegrationOutcome::AbortFailed {
            message: "The merge abort did not restore the previous HEAD.".to_string(),
        });
    }

    let (files, truncated) = conflicted.map_err(|listing_error| {
        clip(&format!(
            "{CONFLICT_LISTING_FAILED_ERROR} {}",
            listing_error.into_message()
        ))
    })?;

    Ok(GitIntegrationOutcome::Conflicted { files, truncated })
}

fn classify_merge_failure(
    mode: GitIntegrationMode,
    error: CommandError,
) -> Result<GitIntegrationOutcome, String> {
    let CommandError::Failed(message) = error else {
        return Err(error.into_message());
    };

    if mode == GitIntegrationMode::FastForward
        && message
            .to_ascii_lowercase()
            .contains(NOT_FAST_FORWARD_MARKER)
    {
        return Ok(GitIntegrationOutcome::NotFastForward);
    }

    Err(clip(&message))
}

fn verify_integration_result(
    mode: GitIntegrationMode,
    merge_sha: &str,
    parents: &[String],
    expected_primary_head: &str,
    expected_branch_head: &str,
) -> Result<(), String> {
    let verified = match mode {
        GitIntegrationMode::FastForward => merge_sha == expected_branch_head,
        GitIntegrationMode::Merge => {
            parents.len() == 2
                && parents[0] == expected_primary_head
                && parents[1] == expected_branch_head
        }
    };
    if verified {
        return Ok(());
    }

    Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
}

pub fn compare_url(remote_url: &str, base: &str, branch: &str) -> Option<String> {
    let (host, owner, repository) = parse_hosted_remote(remote_url)?;
    if safe_branch_name(base).is_err() || safe_branch_name(branch).is_err() {
        return None;
    }

    let base = url_encode(base);
    let branch = url_encode(branch);
    let url = match host.as_str() {
        "github.com" => {
            format!("https://github.com/{owner}/{repository}/compare/{base}...{branch}?expand=1")
        }
        "gitlab.com" => format!(
            "https://gitlab.com/{owner}/{repository}/-/merge_requests/new?merge_request[source_branch]={branch}&merge_request[target_branch]={base}"
        ),
        "bitbucket.org" => format!(
            "https://bitbucket.org/{owner}/{repository}/pull-requests/new?source={branch}&dest={base}"
        ),
        _ => return None,
    };

    if url.len() > MAX_COMPARE_URL_BYTES {
        return None;
    }

    Some(url)
}

pub fn choose_remote(upstream_remote: Option<&str>, remotes: &[String]) -> Option<String> {
    let valid: Vec<&String> = remotes
        .iter()
        .filter(|remote| safe_remote_name(remote).is_ok())
        .collect();

    if let Some(upstream) = upstream_remote {
        if valid.iter().any(|remote| remote.as_str() == upstream) {
            return Some(upstream.to_string());
        }
    }

    if valid
        .iter()
        .any(|remote| remote.as_str() == DEFAULT_REMOTE_NAME)
    {
        return Some(DEFAULT_REMOTE_NAME.to_string());
    }

    if valid.len() == 1 {
        return Some(valid[0].clone());
    }

    None
}

fn parse_hosted_remote(remote_url: &str) -> Option<(String, String, String)> {
    if remote_url.is_empty()
        || remote_url.len() > MAX_COMPARE_URL_BYTES
        || remote_url
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return None;
    }

    let (host_part, path) = if let Some(rest) = strip_url_scheme(remote_url) {
        let (authority, path) = rest.split_once('/')?;
        (authority, path)
    } else {
        let (authority, path) = remote_url.split_once(':')?;
        if authority.contains('/') {
            return None;
        }
        (authority, path)
    };

    let host = host_part
        .rsplit_once('@')
        .map_or(host_part, |(_, host)| host);
    let host = host.split_once(':').map_or(host, |(host, port)| {
        if port.chars().all(|character| character.is_ascii_digit()) {
            host
        } else {
            ""
        }
    });
    let host = host.to_ascii_lowercase();
    if !COMPARE_URL_HOSTS.contains(&host.as_str()) {
        return None;
    }

    let path = path.trim_start_matches('/').trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut segments = path.split('/');
    let owner = segments.next()?;
    let repository = segments.next()?;
    if segments.next().is_some() || !is_safe_url_segment(owner) || !is_safe_url_segment(repository)
    {
        return None;
    }

    Some((host, owner.to_string(), repository.to_string()))
}

fn strip_url_scheme(remote_url: &str) -> Option<&str> {
    [
        "https://",
        "http://",
        "ssh://",
        "git://",
        "git+ssh://",
        "ssh+git://",
    ]
    .iter()
    .find_map(|scheme| remote_url.strip_prefix(scheme))
}

fn is_safe_url_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && segment.len() <= MAX_REMOTE_NAME_BYTES
        && segment
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn url_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
            encoded.push(byte as char);
            continue;
        }
        encoded.push_str(&format!("%{byte:02X}"));
    }
    encoded
}

fn ensure_agent_branch(targets: &ShipTargets, branch: &str) -> Result<(), String> {
    if targets.in_place || branch.starts_with(AGENT_BRANCH_PREFIX) {
        return Ok(());
    }

    Err("The worktree is not on an agent branch.".to_string())
}

fn run_merge(
    repository_root: &Path,
    request: &IntegrationRequest,
    branch_head: &str,
) -> Result<String, CommandError> {
    let arguments: Vec<&OsStr> = match request.mode {
        GitIntegrationMode::FastForward => vec![
            OsStr::new("merge"),
            OsStr::new("--ff-only"),
            OsStr::new("--"),
            OsStr::new(branch_head),
        ],
        GitIntegrationMode::Merge => vec![
            OsStr::new("merge"),
            OsStr::new("--no-ff"),
            OsStr::new("--no-edit"),
            OsStr::new("-m"),
            OsStr::new(request.merge_message.as_str()),
            OsStr::new("--"),
            OsStr::new(branch_head),
        ],
    };

    run_integration_command(repository_root, &arguments, INTEGRATION_MERGE_TIMEOUT)
}

fn abort_merge(repository_root: &Path) -> Result<String, CommandError> {
    run_integration_command(
        repository_root,
        &[OsStr::new("merge"), OsStr::new("--abort")],
        INTEGRATION_MERGE_TIMEOUT,
    )
}

fn merge_in_progress(repository_root: &Path) -> Result<bool, CommandError> {
    let result = run_integration_command(
        repository_root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new("MERGE_HEAD"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    );
    match result {
        Ok(_) => Ok(true),
        Err(CommandError::Failed(message)) if message == GENERIC_FAILURE_MESSAGE => Ok(false),
        Err(error) => Err(error),
    }
}

fn commit_parents(repository_root: &Path, object_id: &str) -> Result<Vec<String>, String> {
    let object_id = safe_object_id(object_id)?;
    let output = run_integration_command(
        repository_root,
        &[
            OsStr::new("rev-list"),
            OsStr::new("--no-walk"),
            OsStr::new("--parents"),
            OsStr::new(object_id.as_str()),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    output
        .split_whitespace()
        .skip(1)
        .take(3)
        .map(safe_object_id)
        .collect()
}

fn conflicted_files(repository_root: &Path) -> Result<(Vec<String>, bool), CommandError> {
    let output = run_integration_command(
        repository_root,
        &[
            OsStr::new("diff"),
            OsStr::new("--name-only"),
            OsStr::new("--diff-filter=U"),
            OsStr::new("-z"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in output.split('\0').filter(|entry| !entry.is_empty()) {
        if files.len() >= MAX_INTEGRATION_CONFLICT_FILES {
            truncated = true;
            break;
        }
        files.push(entry.to_string());
    }

    Ok((files, truncated))
}

fn classify_push_failure(error: CommandError) -> PushFailure {
    let message = match error {
        CommandError::TimedOut(_) => return PushFailure::GitError("Push timed out.".to_string()),
        CommandError::Failed(message) => message,
        CommandError::Io(message) => return PushFailure::GitError(message),
    };

    let lowered = message.to_ascii_lowercase();
    if AUTH_MARKERS.iter().any(|marker| lowered.contains(marker)) {
        return PushFailure::AuthRequired(message);
    }

    if REJECTED_MARKERS
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return PushFailure::Rejected(message);
    }

    PushFailure::GitError(message)
}

fn remote_status(
    targets: &ShipTargets,
    branch: &str,
    primary_branch: Option<&str>,
) -> Result<Option<ShipRemote>, String> {
    let Some(name) = discover_remote(&targets.worktree, branch)? else {
        return Ok(None);
    };

    let upstream = upstream_counts(&targets.worktree)?;
    let compare_url = remote_compare_url(targets, &name, branch, primary_branch);

    Ok(Some(ShipRemote {
        name,
        upstream,
        compare_url,
    }))
}

fn remote_compare_url(
    targets: &ShipTargets,
    remote: &str,
    branch: &str,
    primary_branch: Option<&str>,
) -> Option<String> {
    let base = primary_branch?;
    let url = run_integration_command(
        &targets.worktree,
        &[
            OsStr::new("remote"),
            OsStr::new("get-url"),
            OsStr::new("--push"),
            OsStr::new("--"),
            OsStr::new(remote),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )
    .ok()?;

    compare_url(url.trim(), base, branch)
}

fn discover_remote(worktree: &Path, branch: &str) -> Result<Option<String>, String> {
    let remotes = list_remotes(worktree)?;
    let upstream = configured_upstream_remote(worktree, branch);

    Ok(choose_remote(upstream.as_deref(), &remotes))
}

fn list_remotes(worktree: &Path) -> Result<Vec<String>, String> {
    let output =
        run_integration_command(worktree, &[OsStr::new("remote")], INTEGRATION_LOCAL_TIMEOUT)?;

    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(MAX_LISTED_REMOTES)
        .map(str::to_string)
        .collect())
}

fn configured_upstream_remote(worktree: &Path, branch: &str) -> Option<String> {
    let key = format!("branch.{branch}.remote");
    let output = run_integration_command(
        worktree,
        &[
            OsStr::new("config"),
            OsStr::new("--get"),
            OsStr::new(key.as_str()),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )
    .ok()?;

    safe_remote_name(output.trim()).ok()
}

fn upstream_counts(worktree: &Path) -> Result<Option<ShipUpstream>, String> {
    let upstream = run_integration_command(
        worktree,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--abbrev-ref"),
            OsStr::new("--symbolic-full-name"),
            OsStr::new("@{u}"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    );
    if upstream.is_err() {
        return Ok(None);
    }

    let (behind, ahead) = left_right_count(worktree, "@{u}", "HEAD")?;

    Ok(Some(ShipUpstream { ahead, behind }))
}

fn current_branch(root: &Path) -> Result<Option<String>, String> {
    let output = run_integration_command(
        root,
        &[OsStr::new("branch"), OsStr::new("--show-current")],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;
    let branch = output.trim();
    if branch.is_empty() {
        return Ok(None);
    }

    safe_branch_name(branch).map(Some)
}

fn head_object_id(root: &Path) -> Result<String, String> {
    let output = run_integration_command(
        root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("HEAD"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    safe_object_id(output.trim())
}

fn worktree_change_count(worktree: &Path) -> Result<usize, String> {
    let output = run_integration_command(
        worktree,
        &[
            OsStr::new("status"),
            OsStr::new("--porcelain=v1"),
            OsStr::new("-z"),
            OsStr::new("--untracked-files=all"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    Ok(count_status_entries(&output))
}

fn count_status_entries(output: &str) -> usize {
    let mut count = 0usize;
    let mut records = output.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if count >= MAX_INTEGRATION_CHANGE_COUNT {
            break;
        }
        count += 1;
        if record.starts_with('R') || record.starts_with('C') {
            records.next();
        }
    }
    count
}

fn primary_is_dirty(repository_root: &Path) -> Result<bool, String> {
    let output = run_integration_command(
        repository_root,
        &[
            OsStr::new("status"),
            OsStr::new("--porcelain=v1"),
            OsStr::new("-z"),
            OsStr::new("--untracked-files=no"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    Ok(!output.trim_matches('\0').is_empty())
}

fn left_right_count(root: &Path, left: &str, right: &str) -> Result<(usize, usize), String> {
    let range = format!("{left}...{right}");
    let output = run_integration_command(
        root,
        &[
            OsStr::new("rev-list"),
            OsStr::new("--left-right"),
            OsStr::new("--count"),
            OsStr::new(range.as_str()),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )?;

    parse_left_right_count(&output)
}

fn parse_left_right_count(output: &str) -> Result<(usize, usize), String> {
    let mut parts = output.split_whitespace();
    let left = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| "Git reported an unusable commit count.".to_string())?;
    let right = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| "Git reported an unusable commit count.".to_string())?;

    Ok((left, right))
}

fn merge_base(root: &Path, left: &str, right: &str) -> Result<Option<String>, String> {
    let result = run_integration_command(
        root,
        &[
            OsStr::new("merge-base"),
            OsStr::new("--"),
            OsStr::new(left),
            OsStr::new(right),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    );
    match result {
        Ok(output) => safe_object_id(output.trim()).map(Some),
        Err(CommandError::Failed(_)) => Ok(None),
        Err(error) => Err(error.into_message()),
    }
}

fn integration_git_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command.env_clear();
    for key in ENV_ALLOWLIST {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .arg("-c")
        .arg(HOOKS_DISABLED_CONFIG)
        .arg("-c")
        .arg(FSMONITOR_DISABLED_CONFIG)
        .arg("-C")
        .arg(root);
    command
}

pub fn run_integration_command(
    root: &Path,
    arguments: &[&OsStr],
    timeout: Duration,
) -> Result<String, CommandError> {
    let mut command = integration_git_command(root);
    command.args(arguments);
    run_bounded_command(command, timeout)
}

fn run_bounded_command(mut command: Command, timeout: Duration) -> Result<String, CommandError> {
    configure_process_group(&mut command);
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| CommandError::Io(format!("Failed to start git: {error}")))?;
    let mut guard = ChildGuard::new(child);

    let Some(stdout) = guard.child.stdout.take() else {
        return Err(CommandError::Io(
            "Failed to capture git output.".to_string(),
        ));
    };
    let Some(stderr) = guard.child.stderr.take() else {
        return Err(CommandError::Io(
            "Failed to capture git diagnostics.".to_string(),
        ));
    };

    let watchdog = Watchdog::start(guard.process_id, timeout);
    let stderr_reader =
        thread::spawn(move || read_bounded_stream(stderr, MAX_INTEGRATION_STDERR_BYTES));
    let stdout_result = read_bounded_stream(stdout, MAX_INTEGRATION_STDOUT_BYTES);
    if stdout_result.is_err() {
        guard.kill();
    }

    let stderr_result = stderr_reader.join();
    let status = guard.wait();
    let timed_out = watchdog.finish();

    if timed_out {
        return Err(CommandError::TimedOut(timeout));
    }

    let stdout_bytes = stdout_result.map_err(CommandError::Io)?;
    let status =
        status.map_err(|error| CommandError::Io(format!("Failed to await git: {error}")))?;
    if status.success() {
        return Ok(String::from_utf8_lossy(&stdout_bytes).to_string());
    }

    let failure = match stderr_result {
        Ok(Ok(bytes)) => String::from_utf8_lossy(&bytes).trim().to_string(),
        _ => String::new(),
    };
    if failure.is_empty() {
        return Err(CommandError::Failed(GENERIC_FAILURE_MESSAGE.to_string()));
    }

    Err(CommandError::Failed(failure))
}

struct ChildGuard {
    child: Child,
    process_id: u32,
    reaped: bool,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        let process_id = child.id();
        Self {
            child,
            process_id,
            reaped: false,
        }
    }

    fn kill(&mut self) {
        terminate_process_group(self.process_id);
        let _ = self.child.kill();
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        let status = self.child.wait();
        self.reaped = true;
        status
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        self.kill();
        let _ = self.child.wait();
    }
}

struct Watchdog {
    cancel: mpsc::Sender<()>,
    fired: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Watchdog {
    fn start(process_id: u32, timeout: Duration) -> Self {
        let (cancel, cancelled) = mpsc::channel::<()>();
        let fired = Arc::new(AtomicBool::new(false));
        let fired_flag = Arc::clone(&fired);
        let handle = thread::spawn(move || {
            if cancelled.recv_timeout(timeout).is_ok() {
                return;
            }
            fired_flag.store(true, Ordering::SeqCst);
            terminate_process_group(process_id);
        });
        Self {
            cancel,
            fired,
            handle: Some(handle),
        }
    }

    fn finish(mut self) -> bool {
        let _ = self.cancel.send(());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.fired.load(Ordering::SeqCst)
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(process_id: u32) {
    let Ok(process_group_id) = i32::try_from(process_id) else {
        return;
    };
    if process_group_id <= 0 {
        return;
    }

    // SAFETY: `process_group_id` is the id of the isolated process group that
    // `configure_process_group` created for this child; the negative form
    // addresses the group and never a foreign process.
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_process_id: u32) {}

fn clip(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.len() <= MAX_MERGE_MESSAGE_BYTES {
        return trimmed.to_string();
    }

    let mut end = MAX_MERGE_MESSAGE_BYTES;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }

    trimmed[..end].to_string()
}

#[cfg(test)]
#[path = "git_integration_tests.rs"]
mod tests;
