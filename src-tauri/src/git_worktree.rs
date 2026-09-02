use serde::Serialize;
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Read,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

#[path = "git_worktree_exclude.rs"]
mod git_worktree_exclude;

use git_worktree_exclude::ensure_agent_worktree_excluded;
#[cfg(test)]
use git_worktree_exclude::{
    contains_exclude_pattern, MAX_GIT_INFO_EXCLUDE_BYTES, WORKTREE_EXCLUDE_PATTERN,
};

pub const WORKTREE_BASE_DIR_NAME: &str = ".worktrees";
pub const AGENT_BRANCH_PREFIX: &str = "agent/";
pub const MAX_WORKTREES_PER_REPOSITORY: usize = 16;
pub const MAX_WORKTREE_LIST_OUTPUT_BYTES: usize = 256 * 1024;
pub const MAX_AGENT_TASK_ID_BYTES: usize = 64;

pub const MIN_AGENT_TASK_ID_BYTES: usize = 3;
pub const MAX_WORKTREE_PATH_BYTES: usize = 4 * 1024;
pub const MAX_WORKTREE_BRANCH_BYTES: usize = 512;
pub const MAX_WORKTREE_HEAD_BYTES: usize = 64;
pub const MAX_WORKTREE_COMMAND_STDERR_BYTES: usize = 8 * 1024;
pub const MAX_WORKTREE_FAILURE_REASON_BYTES: usize = 512;
pub const MAX_LISTED_WORKTREE_ENTRIES: usize = 256;

const WORKTREE_RECORD_PREFIX: &str = "worktree ";
const WORKTREE_HEAD_PREFIX: &str = "HEAD ";
const WORKTREE_BRANCH_PREFIX: &str = "branch ";
const WORKTREE_LOCKED_ATTRIBUTE: &str = "locked";
const WORKTREE_PRUNABLE_ATTRIBUTE: &str = "prunable";
const LOCAL_BRANCH_REF_PREFIX: &str = "refs/heads/";
const HOOKS_DISABLED_CONFIG: &str = "core.hooksPath=/dev/null";
const FSMONITOR_DISABLED_CONFIG: &str = "core.fsmonitor=false";
const WORKTREE_ENV_ALLOWLIST: [&str; 31] = [
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
const WORKTREE_LOCKS_DIR_NAME: &str = ".codevo-locks";
const WORKTREE_LOCK_OWNER_FILE_NAME: &str = "owner";
const WORKTREE_LOCK_CONFLICT_ERROR: &str =
    "Another Codevo process is creating this worktree, or a stale creation lock remains.";
static WORKTREE_LOCK_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeDescriptor {
    pub worktree_path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_primary: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorktreeReceipt {
    pub worktree_path: String,
    pub branch: String,
    pub trusted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatedAgentWorktree {
    pub worktree_path: PathBuf,
    pub branch: String,
}

pub trait GitWorktreeGateway: Send + Sync {
    fn list_worktrees(&self, repository_root: &Path) -> Result<Vec<GitWorktreeDescriptor>, String>;
    fn add_agent_worktree(
        &self,
        repository_root: &Path,
        task_id: &str,
    ) -> Result<CreatedAgentWorktree, String>;
    fn remove_worktree(
        &self,
        repository_root: &Path,
        worktree_path: &Path,
        force: bool,
    ) -> Result<(), String>;
    fn prune_worktrees(&self, repository_root: &Path) -> Result<Vec<String>, String>;
}

pub trait WorktreeRemovalHooks {
    fn stop_agent_tasks(&self, worktree_path: &Path) -> Result<(), String>;
    fn dispose_runtimes(&self, worktree_path: &Path) -> Result<(), String>;
    fn revoke_trust(&self, worktree_path: &Path) -> Result<(), String>;
}

pub fn remove_agent_worktree_with_disposal(
    gateway: &dyn GitWorktreeGateway,
    hooks: &dyn WorktreeRemovalHooks,
    repository_root: &Path,
    worktree_path: &Path,
    force: bool,
) -> Result<(), String> {
    hooks.stop_agent_tasks(worktree_path)?;
    hooks.dispose_runtimes(worktree_path)?;
    gateway.remove_worktree(repository_root, worktree_path, force)?;
    let _ = hooks.revoke_trust(worktree_path);
    Ok(())
}

pub fn safe_agent_task_id(candidate: &str) -> Result<String, String> {
    if candidate.len() < MIN_AGENT_TASK_ID_BYTES {
        return Err(format!(
            "Agent task id must be at least {MIN_AGENT_TASK_ID_BYTES} characters."
        ));
    }

    if candidate.len() > MAX_AGENT_TASK_ID_BYTES {
        return Err(format!(
            "Agent task id must not exceed {MAX_AGENT_TASK_ID_BYTES} characters."
        ));
    }

    if candidate.contains("--") {
        return Err("Agent task id must not contain consecutive dashes.".to_string());
    }

    let mut characters = candidate.chars();
    let Some(first) = characters.next() else {
        return Err("Agent task id is required.".to_string());
    };

    if !is_agent_task_id_start(first) {
        return Err("Agent task id must start with a lowercase letter or digit.".to_string());
    }

    if !characters.all(is_agent_task_id_body) {
        return Err(
            "Agent task id may only contain lowercase letters, digits and dashes.".to_string(),
        );
    }

    Ok(candidate.to_string())
}

fn is_agent_task_id_start(character: char) -> bool {
    character.is_ascii_lowercase() || character.is_ascii_digit()
}

fn is_agent_task_id_body(character: char) -> bool {
    is_agent_task_id_start(character) || character == '-'
}

pub fn agent_branch_name(task_id: &str) -> String {
    format!("{AGENT_BRANCH_PREFIX}{task_id}")
}

pub fn agent_worktree_path(repository_root: &Path, task_id: &str) -> PathBuf {
    repository_root.join(WORKTREE_BASE_DIR_NAME).join(task_id)
}

pub fn ensure_worktree_path_in_base(
    repository_root: &Path,
    worktree_path: &Path,
) -> Result<PathBuf, String> {
    let root = canonical_repository_root(repository_root)?;
    let base = fs::canonicalize(root.join(WORKTREE_BASE_DIR_NAME))
        .map_err(|error| format!("Worktree base directory is not accessible: {error}"))?;
    let candidate = fs::canonicalize(worktree_path)
        .map_err(|error| format!("Worktree path is not accessible: {error}"))?;

    if candidate == root {
        return Err("The repository root is not an agent worktree.".to_string());
    }

    if candidate == base {
        return Err("The worktree base directory is not an agent worktree.".to_string());
    }

    if !candidate.starts_with(&base) {
        return Err(format!(
            "Worktree path must live inside the {WORKTREE_BASE_DIR_NAME} directory of the repository."
        ));
    }

    ensure_path_bounds(&candidate)?;

    Ok(candidate)
}

pub fn prunable_worktree_path_in_base(canonical_repository_root: &Path, candidate: &Path) -> bool {
    if !candidate.is_absolute() || candidate.as_os_str().len() > MAX_WORKTREE_PATH_BYTES {
        return false;
    }

    let base = canonical_repository_root.join(WORKTREE_BASE_DIR_NAME);
    let Ok(relative) = candidate.strip_prefix(&base) else {
        return false;
    };

    let mut components = relative.components();
    let Some(first) = components.next() else {
        return false;
    };

    matches!(first, std::path::Component::Normal(_))
        && components.all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn canonical_repository_root(repository_root: &Path) -> Result<PathBuf, String> {
    if !repository_root.is_absolute() {
        return Err("Repository root must be an absolute path.".to_string());
    }

    ensure_path_bounds(repository_root)?;

    let canonical = fs::canonicalize(repository_root)
        .map_err(|error| format!("Repository root is not accessible: {error}"))?;

    ensure_path_bounds(&canonical)?;

    Ok(canonical)
}

fn ensure_path_bounds(path: &Path) -> Result<(), String> {
    if path.as_os_str().len() > MAX_WORKTREE_PATH_BYTES {
        return Err(format!(
            "Worktree path must not exceed {MAX_WORKTREE_PATH_BYTES} bytes."
        ));
    }

    Ok(())
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CommandGitWorktreeGateway;

impl CommandGitWorktreeGateway {
    pub fn new() -> Self {
        Self
    }
}

impl GitWorktreeGateway for CommandGitWorktreeGateway {
    fn list_worktrees(&self, repository_root: &Path) -> Result<Vec<GitWorktreeDescriptor>, String> {
        let root = canonical_repository_root(repository_root)?;
        let output = run_worktree_command(
            &root,
            &[
                OsStr::new("worktree"),
                OsStr::new("list"),
                OsStr::new("--porcelain"),
            ],
        )?;

        parse_worktree_list(&output)
    }

    fn add_agent_worktree(
        &self,
        repository_root: &Path,
        task_id: &str,
    ) -> Result<CreatedAgentWorktree, String> {
        let task_id = safe_agent_task_id(task_id)?;
        let root = canonical_repository_root(repository_root)?;
        self.list_worktrees(&root)?;
        repository_head(&root)?;
        ensure_agent_worktree_excluded(&root)?;
        let base = ensure_agent_worktree_base(&root)?;
        let target = agent_worktree_path(&root, &task_id);
        ensure_path_bounds(&target)?;
        let _add_guard = AgentWorktreeCreationLock::acquire(&base, &task_id)?;
        let existing = self.list_worktrees(&root)?;
        let starting_head = repository_head(&root)?;

        if existing.len() >= MAX_WORKTREES_PER_REPOSITORY {
            return Err(format!(
                "Repository already holds the maximum of {MAX_WORKTREES_PER_REPOSITORY} worktrees."
            ));
        }

        if target.symlink_metadata().is_ok() {
            return Err("A worktree for this agent task already exists.".to_string());
        }

        let branch = agent_branch_name(&task_id);
        ensure_branch_bounds(&branch)?;

        if local_branch_head(&root, &branch)?.is_some() {
            return Err("A branch for this agent task already exists.".to_string());
        }

        if let Err(error) = run_worktree_command(
            &root,
            &[
                OsStr::new("worktree"),
                OsStr::new("add"),
                OsStr::new("-b"),
                OsStr::new(branch.as_str()),
                target.as_os_str(),
                OsStr::new(starting_head.as_str()),
            ],
        ) {
            let cleaned = compensate_failed_worktree_add(&root, &target, &branch, &starting_head);
            if cleaned {
                return Err(error);
            }
            return Err(sanitize_git_failure_reason(&format!(
                "{error} Cleanup could not be completed; remove the partial worktree or branch before retrying."
            )));
        }

        let worktree_path = match ensure_worktree_path_in_base(&root, &target) {
            Ok(path) => path,
            Err(error) => {
                let cleaned =
                    compensate_failed_worktree_add(&root, &target, &branch, &starting_head);
                if cleaned {
                    return Err(sanitize_git_failure_reason(&error));
                }
                return Err(sanitize_git_failure_reason(&format!(
                    "{error} Cleanup could not be completed; remove the partial worktree or branch before retrying."
                )));
            }
        };

        Ok(CreatedAgentWorktree {
            worktree_path,
            branch,
        })
    }

    fn remove_worktree(
        &self,
        repository_root: &Path,
        worktree_path: &Path,
        force: bool,
    ) -> Result<(), String> {
        let root = canonical_repository_root(repository_root)?;
        let target = ensure_worktree_path_in_base(&root, worktree_path)?;

        let mut arguments: Vec<&OsStr> = vec![OsStr::new("worktree"), OsStr::new("remove")];

        if force {
            arguments.push(OsStr::new("--force"));
        }

        arguments.push(target.as_os_str());

        run_worktree_command(&root, &arguments).map(|_| ())
    }

    fn prune_worktrees(&self, repository_root: &Path) -> Result<Vec<String>, String> {
        let root = canonical_repository_root(repository_root)?;
        let prunable: Vec<String> = self
            .list_worktrees(&root)?
            .into_iter()
            .filter(|descriptor| descriptor.prunable && !descriptor.is_primary)
            .map(|descriptor| descriptor.worktree_path)
            .collect();

        run_worktree_command(&root, &[OsStr::new("worktree"), OsStr::new("prune")])?;

        Ok(prunable)
    }
}

fn ensure_branch_bounds(branch: &str) -> Result<(), String> {
    if branch.len() > MAX_WORKTREE_BRANCH_BYTES {
        return Err(format!(
            "Branch name must not exceed {MAX_WORKTREE_BRANCH_BYTES} bytes."
        ));
    }

    Ok(())
}

fn ensure_agent_worktree_base(repository_root: &Path) -> Result<PathBuf, String> {
    let base = repository_root.join(WORKTREE_BASE_DIR_NAME);
    match base.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("The agent worktree base must not be a symbolic link.".to_string());
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("The agent worktree base must be a directory.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&base)
                .map_err(|error| format!("Failed to create the worktree directory: {error}"))?;
        }
        Err(error) => {
            return Err(format!("Failed to inspect the worktree directory: {error}"));
        }
    }

    let metadata = base
        .symlink_metadata()
        .map_err(|error| format!("Failed to inspect the worktree directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The agent worktree base must be a non-symbolic-link directory.".to_string());
    }
    let canonical = base
        .canonicalize()
        .map_err(|error| format!("Failed to resolve the worktree directory: {error}"))?;
    if canonical != base {
        return Err("The agent worktree base resolved outside its repository path.".to_string());
    }
    Ok(base)
}

struct AgentWorktreeCreationLock {
    lock_path: PathBuf,
    owner_path: PathBuf,
    owner_token: String,
}

impl AgentWorktreeCreationLock {
    fn acquire(base: &Path, task_id: &str) -> Result<Self, String> {
        let locks = base.join(WORKTREE_LOCKS_DIR_NAME);
        ensure_lock_directory(&locks)?;
        Self::acquire_path(locks.join(format!("{task_id}.lock")))
    }

    fn acquire_path(lock_path: PathBuf) -> Result<Self, String> {
        match fs::create_dir(&lock_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(WORKTREE_LOCK_CONFLICT_ERROR.to_string());
            }
            Err(error) => return Err(format!("Failed to acquire the worktree lock: {error}")),
        }

        let owner_token = worktree_lock_owner_token();
        let owner_path = lock_path.join(WORKTREE_LOCK_OWNER_FILE_NAME);
        let write_result = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&owner_path)
            .and_then(|mut file| {
                file.write_all(owner_token.as_bytes())?;
                file.sync_all()
            });
        if let Err(error) = write_result {
            let _ = fs::remove_dir(&lock_path);
            return Err(format!("Failed to retain worktree lock ownership: {error}"));
        }

        Ok(Self {
            lock_path,
            owner_path,
            owner_token,
        })
    }
}

impl Drop for AgentWorktreeCreationLock {
    fn drop(&mut self) {
        let Ok(owner) = fs::read_to_string(&self.owner_path) else {
            return;
        };
        if owner != self.owner_token {
            return;
        }
        if fs::remove_file(&self.owner_path).is_ok() {
            let _ = fs::remove_dir(&self.lock_path);
        }
    }
}

fn ensure_lock_directory(locks: &Path) -> Result<(), String> {
    match locks.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err("The Codevo worktree lock location is not a regular directory.".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::create_dir(locks) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata = locks.symlink_metadata().map_err(|error| {
                    format!("Failed to inspect the worktree lock directory: {error}")
                })?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    Err("The Codevo worktree lock location is not a regular directory.".to_string())
                } else {
                    Ok(())
                }
            }
            Err(error) => Err(format!(
                "Failed to create the worktree lock directory: {error}"
            )),
        },
        Err(error) => Err(format!(
            "Failed to inspect the worktree lock directory: {error}"
        )),
    }
}

fn worktree_lock_owner_token() -> String {
    let nonce = WORKTREE_LOCK_NONCE.fetch_add(1, Ordering::SeqCst);
    let epoch_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("{}-{epoch_nanos}-{nonce}", std::process::id())
}

fn repository_head(repository_root: &Path) -> Result<String, String> {
    match run_worktree_command(
        repository_root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("HEAD^{commit}"),
        ],
    ) {
        Ok(head) => {
            let head = head.trim();
            if (head.len() == 40 || head.len() == 64)
                && head.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                Ok(head.to_string())
            } else {
                Err("Git reported an unusable HEAD revision.".to_string())
            }
        }
        Err(error) if is_missing_head_reason(&error) => Err(
            "The current checkout HEAD has no commit. Create or select a commit before starting an isolated agent worktree."
                .to_string(),
        ),
        Err(error) => Err(error),
    }
}

fn is_missing_head_reason(reason: &str) -> bool {
    reason == "Needed a single revision"
        || reason.contains("unknown revision or path not in the working tree")
        || reason.contains("ambiguous argument 'HEAD^{commit}'")
}

fn local_branch_head(repository_root: &Path, branch: &str) -> Result<Option<String>, String> {
    let reference = format!("{LOCAL_BRANCH_REF_PREFIX}{branch}");
    let result = collect_worktree_command(
        repository_root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new(&reference),
        ],
    )?;
    if result.success {
        return Ok(Some(result.stdout.trim().to_string()));
    }
    if result.exit_code == Some(1) && result.failure.is_none() {
        return Ok(None);
    }
    Err(result
        .failure
        .unwrap_or_else(|| "The Git branch lookup failed without diagnostics.".to_string()))
}

fn registered_worktree_matches(
    repository_root: &Path,
    target: &Path,
    head: &str,
    branch: &str,
) -> Result<bool, String> {
    let target = target.to_string_lossy();
    Ok(CommandGitWorktreeGateway::new()
        .list_worktrees(repository_root)?
        .into_iter()
        .any(|descriptor| {
            descriptor.worktree_path == target
                && descriptor.head.as_deref() == Some(head)
                && descriptor.branch.as_deref() == Some(branch)
        }))
}

fn delete_owned_branch(repository_root: &Path, branch: &str, expected_head: &str) -> bool {
    match local_branch_head(repository_root, branch) {
        Ok(Some(actual_head)) if actual_head == expected_head => run_worktree_command(
            repository_root,
            &[OsStr::new("branch"), OsStr::new("-D"), OsStr::new(branch)],
        )
        .is_ok(),
        Ok(None) => true,
        _ => false,
    }
}

fn compensate_failed_worktree_add(
    repository_root: &Path,
    target: &Path,
    branch: &str,
    starting_head: &str,
) -> bool {
    let registered =
        match registered_worktree_matches(repository_root, target, starting_head, branch) {
            Ok(registered) => registered,
            Err(_) => return false,
        };

    if registered
        && run_worktree_command(
            repository_root,
            &[
                OsStr::new("worktree"),
                OsStr::new("remove"),
                OsStr::new("--force"),
                OsStr::new("--force"),
                target.as_os_str(),
            ],
        )
        .is_err()
    {
        return false;
    }

    if target.symlink_metadata().is_ok() {
        return false;
    }

    delete_owned_branch(repository_root, branch, starting_head)
}

fn worktree_git_command(repository_root: &Path) -> Command {
    let mut command = Command::new("git");
    command.env_clear();
    for key in WORKTREE_ENV_ALLOWLIST {
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
        .arg(repository_root);
    command
}

fn run_worktree_command(repository_root: &Path, arguments: &[&OsStr]) -> Result<String, String> {
    let result = collect_worktree_command(repository_root, arguments)?;
    if result.success {
        return Ok(result.stdout);
    }
    Err(result
        .failure
        .unwrap_or_else(|| "The git worktree command failed without diagnostics.".to_string()))
}

struct CollectedWorktreeCommand {
    stdout: String,
    failure: Option<String>,
    success: bool,
    exit_code: Option<i32>,
}

fn collect_worktree_command(
    repository_root: &Path,
    arguments: &[&OsStr],
) -> Result<CollectedWorktreeCommand, String> {
    let mut child = worktree_git_command(repository_root)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start git: {error}"))?;

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to capture git worktree output.".to_string());
    };

    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to capture git worktree diagnostics.".to_string());
    };

    let stderr_reader =
        thread::spawn(move || read_bounded_diagnostics(stderr, MAX_WORKTREE_COMMAND_STDERR_BYTES));

    let stdout_result = read_bounded_stream(stdout, MAX_WORKTREE_LIST_OUTPUT_BYTES);

    if stdout_result.is_err() {
        let _ = child.kill();
    }

    let stderr_result = stderr_reader.join();
    let wait_result = child.wait();

    let stdout_bytes = stdout_result?;
    let status = wait_result
        .map_err(|error| format!("Failed to await the git worktree command: {error}"))?;

    let failure = match stderr_result {
        Ok(Ok(bytes)) if bytes.is_empty() => None,
        Ok(Ok(bytes)) => Some(sanitize_git_failure_reason(&String::from_utf8_lossy(
            &bytes,
        ))),
        Ok(Err(error)) => Some(sanitize_git_failure_reason(&error)),
        Err(_) => Some("Git diagnostics could not be collected.".to_string()),
    };

    Ok(CollectedWorktreeCommand {
        stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
        failure,
        success: status.success(),
        exit_code: status.code(),
    })
}

fn read_bounded_diagnostics<R: Read>(reader: R, limit: usize) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    let mut bounded = reader.take(limit as u64 + 1);
    bounded
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Failed to read the git worktree diagnostics: {error}"))?;
    if buffer.len() > limit {
        buffer.truncate(limit);
        buffer.extend_from_slice(b"\n[diagnostics truncated]");
    }
    Ok(buffer)
}

pub(crate) fn sanitize_git_failure_reason(raw: &str) -> String {
    const TRUNCATION_MARKER: &str = " [truncated]";
    let mut sanitized = String::new();
    let mut characters = raw.chars().peekable();
    let mut pending_space = false;
    let mut truncated = false;

    while let Some(character) = characters.next() {
        if character == '\u{1b}' && characters.peek() == Some(&'[') {
            let _ = characters.next();
            for sequence_character in characters.by_ref() {
                if ('@'..='~').contains(&sequence_character) {
                    break;
                }
            }
            continue;
        }
        if character.is_control() || is_bidi_control(character) || character.is_whitespace() {
            pending_space = !sanitized.is_empty();
            continue;
        }
        if pending_space {
            sanitized.push(' ');
            pending_space = false;
        }
        sanitized.push(character);
        if sanitized.len() > MAX_WORKTREE_FAILURE_REASON_BYTES {
            truncated = true;
            break;
        }
    }

    if characters.next().is_some() {
        truncated = true;
    }

    let maximum_content_bytes = if truncated {
        MAX_WORKTREE_FAILURE_REASON_BYTES - TRUNCATION_MARKER.len()
    } else {
        MAX_WORKTREE_FAILURE_REASON_BYTES
    };
    while sanitized.len() > maximum_content_bytes {
        sanitized.pop();
    }

    let sanitized = sanitized
        .strip_prefix("fatal: ")
        .or_else(|| sanitized.strip_prefix("error: "))
        .unwrap_or(&sanitized)
        .trim();

    if sanitized.is_empty() {
        "The git worktree command failed without diagnostics.".to_string()
    } else if truncated {
        format!("{sanitized}{TRUNCATION_MARKER}")
    } else {
        sanitized.to_string()
    }
}

fn is_bidi_control(character: char) -> bool {
    matches!(
        character,
        '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
    )
}

pub(crate) fn read_bounded_stream<R: Read>(reader: R, limit: usize) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    let mut bounded = reader.take(limit as u64 + 1);

    bounded
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Failed to read the git worktree output: {error}"))?;

    if buffer.len() > limit {
        return Err(format!(
            "Git worktree output exceeded the {limit} byte limit."
        ));
    }

    Ok(buffer)
}

#[derive(Clone, Debug)]
struct WorktreeRecord {
    worktree_path: String,
    branch: Option<String>,
    head: Option<String>,
    locked: bool,
    prunable: bool,
}

impl WorktreeRecord {
    fn new(worktree_path: &str) -> Self {
        Self {
            worktree_path: worktree_path.to_string(),
            branch: None,
            head: None,
            locked: false,
            prunable: false,
        }
    }
}

pub(crate) fn parse_worktree_list(output: &str) -> Result<Vec<GitWorktreeDescriptor>, String> {
    let mut descriptors: Vec<GitWorktreeDescriptor> = Vec::new();
    let mut current: Option<WorktreeRecord> = None;

    for line in output.lines() {
        if line.trim().is_empty() {
            finish_worktree_record(&mut descriptors, current.take())?;
            continue;
        }

        if let Some(path) = line.strip_prefix(WORKTREE_RECORD_PREFIX) {
            finish_worktree_record(&mut descriptors, current.take())?;
            current = Some(WorktreeRecord::new(path));
            continue;
        }

        let Some(record) = current.as_mut() else {
            return Err("Unexpected git worktree list output.".to_string());
        };

        apply_worktree_attribute(record, line)?;
    }

    finish_worktree_record(&mut descriptors, current.take())?;

    if descriptors.len() > MAX_LISTED_WORKTREE_ENTRIES {
        return Err(format!(
            "Repository reported more than {MAX_LISTED_WORKTREE_ENTRIES} worktrees."
        ));
    }

    Ok(descriptors)
}

fn apply_worktree_attribute(record: &mut WorktreeRecord, line: &str) -> Result<(), String> {
    if let Some(head) = line.strip_prefix(WORKTREE_HEAD_PREFIX) {
        if head.len() > MAX_WORKTREE_HEAD_BYTES {
            return Err("Git reported an unusable worktree head revision.".to_string());
        }

        record.head = Some(head.to_string());
        return Ok(());
    }

    if let Some(reference) = line.strip_prefix(WORKTREE_BRANCH_PREFIX) {
        if reference.len() > MAX_WORKTREE_BRANCH_BYTES {
            return Err("Git reported an unusable worktree branch name.".to_string());
        }

        record.branch = Some(short_branch_name(reference));
        return Ok(());
    }

    if is_worktree_attribute(line, WORKTREE_LOCKED_ATTRIBUTE) {
        record.locked = true;
        return Ok(());
    }

    if is_worktree_attribute(line, WORKTREE_PRUNABLE_ATTRIBUTE) {
        record.prunable = true;
        return Ok(());
    }

    Ok(())
}

fn is_worktree_attribute(line: &str, attribute: &str) -> bool {
    let Some(remainder) = line.strip_prefix(attribute) else {
        return false;
    };

    remainder.is_empty() || remainder.starts_with(' ')
}

fn short_branch_name(reference: &str) -> String {
    reference
        .strip_prefix(LOCAL_BRANCH_REF_PREFIX)
        .unwrap_or(reference)
        .to_string()
}

fn finish_worktree_record(
    descriptors: &mut Vec<GitWorktreeDescriptor>,
    record: Option<WorktreeRecord>,
) -> Result<(), String> {
    let Some(record) = record else {
        return Ok(());
    };

    if record.worktree_path.trim().is_empty() {
        return Err("Git reported a worktree without a path.".to_string());
    }

    if record.worktree_path.len() > MAX_WORKTREE_PATH_BYTES {
        return Err("Git reported a worktree path beyond the supported length.".to_string());
    }

    descriptors.push(GitWorktreeDescriptor {
        worktree_path: record.worktree_path,
        branch: record.branch,
        head: record.head,
        is_primary: descriptors.is_empty(),
        locked: record.locked,
        prunable: record.prunable,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::Arc;

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);
    const HOSTILE_ENV_CHILD: &str = "CODEVO_WORKTREE_HOSTILE_ENV_CHILD";
    const HOSTILE_ENV_TARGET: &str = "CODEVO_WORKTREE_HOSTILE_ENV_TARGET";
    const HOSTILE_ENV_FOREIGN: &str = "CODEVO_WORKTREE_HOSTILE_ENV_FOREIGN";

    struct TempRepository {
        root: PathBuf,
    }

    impl TempRepository {
        fn create(label: &str, nested: bool, with_commit: bool) -> Self {
            let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
            let container = std::env::temp_dir().join(format!(
                "git-worktree-unit-{label}-{}-{nonce}",
                std::process::id()
            ));
            let root = if nested {
                container.join("workspace/packages/repository")
            } else {
                container.join("repository")
            };
            fs::create_dir_all(&root).expect("create repository directory");
            run_git(&root, &["init", "--initial-branch=main"]);
            run_git(&root, &["config", "user.name", "Test"]);
            run_git(&root, &["config", "user.email", "test@example.com"]);
            if with_commit {
                fs::write(root.join("README.md"), "seed\n").expect("write seed file");
                run_git(&root, &["add", "README.md"]);
                run_git(&root, &["commit", "-m", "initial"]);
            }
            Self {
                root: root.canonicalize().expect("canonical repository root"),
            }
        }
    }

    impl Drop for TempRepository {
        fn drop(&mut self) {
            let container = self
                .root
                .ancestors()
                .find(|path| {
                    path.file_name().is_some_and(|name| {
                        name.to_string_lossy().starts_with("git-worktree-unit-")
                    })
                })
                .unwrap_or(&self.root);
            let _ = fs::remove_dir_all(container);
        }
    }

    fn run_git(root: &Path, arguments: &[&str]) {
        let output = git_output(root, arguments);
        assert!(
            output.status.success(),
            "git fixture command {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(root: &Path, arguments: &[&str]) -> std::process::Output {
        Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .output()
            .expect("run git fixture command")
    }

    fn assert_branch_absent(root: &Path, branch: &str) {
        assert_eq!(local_branch_head(root, branch).expect("query branch"), None);
    }

    #[test]
    fn nested_repository_can_create_a_worktree_while_head_is_detached() {
        let repository = TempRepository::create("nested-detached", true, true);
        run_git(&repository.root, &["checkout", "--detach"]);

        let created = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-nested-0001")
            .expect("create nested repository worktree from detached head");

        assert!(created.worktree_path.is_dir());
        assert_eq!(created.branch, "agent/agt-nested-0001");
        assert!(created.worktree_path.starts_with(&repository.root));
    }

    #[test]
    fn successful_worktree_keeps_parent_status_clean_without_tracked_gitignore() {
        let repository = TempRepository::create("clean-parent", false, true);
        assert!(!repository.root.join(".gitignore").exists());

        CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-clean-0001")
            .expect("create isolated worktree");

        let status = git_output(&repository.root, &["status", "--short"]);
        assert!(status.status.success());
        assert_eq!(String::from_utf8_lossy(&status.stdout), "");
        assert!(!repository.root.join(".gitignore").exists());
        let exclude =
            fs::read(repository.root.join(".git/info/exclude")).expect("read local exclude file");
        assert!(contains_exclude_pattern(&exclude));
    }

    #[test]
    fn hostile_git_identity_environment_cannot_redirect_worktree_provisioning() {
        if std::env::var_os(HOSTILE_ENV_CHILD).is_some() {
            let target = PathBuf::from(
                std::env::var_os(HOSTILE_ENV_TARGET).expect("child target repository"),
            );
            CommandGitWorktreeGateway::new()
                .add_agent_worktree(&target, "agt-hostile-env-0001")
                .expect("provision target repository despite hostile inherited Git identity");
            return;
        }

        let target = TempRepository::create("hostile-env-target", false, true);
        let foreign = TempRepository::create("hostile-env-foreign", false, true);
        let foreign_exclude = foreign.root.join(".git/info/exclude");
        let foreign_exclude_before =
            fs::read(&foreign_exclude).expect("read foreign exclude before child");
        let foreign_head_before =
            repository_head(&foreign.root).expect("foreign head before child");
        let test_binary = std::env::current_exe().expect("current test binary");
        let output = Command::new(test_binary)
            .arg("--exact")
            .arg(
                "git_worktree::tests::hostile_git_identity_environment_cannot_redirect_worktree_provisioning",
            )
            .arg("--nocapture")
            .env(HOSTILE_ENV_CHILD, "1")
            .env(HOSTILE_ENV_TARGET, &target.root)
            .env(HOSTILE_ENV_FOREIGN, &foreign.root)
            .env("GIT_DIR", foreign.root.join(".git"))
            .env("GIT_WORK_TREE", &foreign.root)
            .env("GIT_COMMON_DIR", foreign.root.join(".git"))
            .env("GIT_INDEX_FILE", foreign.root.join(".git/index"))
            .env("GIT_OBJECT_DIRECTORY", foreign.root.join(".git/objects"))
            .env(
                "GIT_ALTERNATE_OBJECT_DIRECTORIES",
                foreign.root.join(".git/objects"),
            )
            .env("GIT_PREFIX", "foreign-prefix/")
            .output()
            .expect("run hostile environment child");
        assert!(
            output.status.success(),
            "hostile environment child failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        assert!(target.root.join(".worktrees/agt-hostile-env-0001").is_dir());
        assert!(contains_exclude_pattern(
            &fs::read(target.root.join(".git/info/exclude")).expect("target exclude installed")
        ));
        assert_eq!(
            String::from_utf8_lossy(&git_output(&target.root, &["status", "--short"]).stdout),
            ""
        );
        assert!(!foreign.root.join(WORKTREE_BASE_DIR_NAME).exists());
        assert_eq!(
            fs::read(&foreign_exclude).expect("foreign exclude retained"),
            foreign_exclude_before
        );
        assert_eq!(
            repository_head(&foreign.root).expect("foreign head retained"),
            foreign_head_before
        );
        assert_branch_absent(&foreign.root, "agent/agt-hostile-env-0001");
        assert_eq!(
            String::from_utf8_lossy(&git_output(&foreign.root, &["status", "--short"]).stdout),
            ""
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_exclude_update_preserves_user_bytes_permissions_and_is_idempotent() {
        use std::os::unix::fs::PermissionsExt;

        let repository = TempRepository::create("exclude-preserve", false, true);
        let exclude = repository.root.join(".git/info/exclude");
        let user_content = b"# user content\n*.secret\n";
        fs::write(&exclude, user_content).expect("write user exclude content");
        fs::set_permissions(&exclude, fs::Permissions::from_mode(0o640))
            .expect("set exclude permissions");

        let gateway = CommandGitWorktreeGateway::new();
        gateway
            .add_agent_worktree(&repository.root, "agt-exclude-0001")
            .expect("create first worktree");
        gateway
            .add_agent_worktree(&repository.root, "agt-exclude-0002")
            .expect("create second worktree");

        let updated = fs::read(&exclude).expect("read updated exclude");
        assert!(updated.starts_with(user_content));
        assert_eq!(
            updated
                .split(|byte| *byte == b'\n')
                .filter(|line| *line == WORKTREE_EXCLUDE_PATTERN)
                .count(),
            1
        );
        assert_eq!(
            exclude
                .metadata()
                .expect("exclude metadata")
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }

    #[test]
    fn oversized_local_exclude_is_rejected_without_mutation_or_worktree_base() {
        let repository = TempRepository::create("exclude-oversized", false, true);
        let exclude = repository.root.join(".git/info/exclude");
        let original = vec![b'x'; MAX_GIT_INFO_EXCLUDE_BYTES];
        fs::write(&exclude, &original).expect("write maximum exclude fixture");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-exclude-large-0001")
            .expect_err("oversized update must be rejected");

        assert!(error.contains("cannot exceed"), "unexpected: {error}");
        assert_eq!(fs::read(&exclude).expect("exclude retained"), original);
        assert!(!repository.root.join(WORKTREE_BASE_DIR_NAME).exists());
        assert_eq!(
            fs::read_dir(repository.root.join(".git/info"))
                .expect("read git info")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains("codevo"))
                .count(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_local_exclude_is_rejected_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let repository = TempRepository::create("exclude-symlink", false, true);
        let outside = repository
            .root
            .parent()
            .expect("repository container")
            .join("outside-exclude");
        fs::write(&outside, "outside\n").expect("write outside exclude");
        let exclude = repository.root.join(".git/info/exclude");
        fs::remove_file(&exclude).expect("remove fixture exclude");
        symlink(&outside, &exclude).expect("symlink local exclude");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-exclude-link-0001")
            .expect_err("symlinked local exclude must be rejected");

        assert!(
            error.contains("exclude file must be"),
            "unexpected: {error}"
        );
        assert_eq!(
            fs::read_to_string(&outside).expect("outside retained"),
            "outside\n"
        );
        assert!(!repository.root.join(WORKTREE_BASE_DIR_NAME).exists());
    }

    #[test]
    fn aggregate_non_repository_preserves_the_actual_git_reason() {
        let repository = TempRepository::create("aggregate", true, true);
        let aggregate = repository.root.ancestors().nth(2).expect("aggregate root");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(aggregate, "agt-aggregate-0001")
            .expect_err("aggregate root is not a repository");

        assert!(
            error.contains("not a git repository"),
            "unexpected: {error}"
        );
        assert!(!error.contains("no initial commit"), "unexpected: {error}");
        assert!(!aggregate.join(WORKTREE_BASE_DIR_NAME).exists());
    }

    #[test]
    fn repository_without_an_initial_commit_has_an_actionable_reason_and_no_artifacts() {
        let repository = TempRepository::create("unborn", false, false);

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-unborn-0001")
            .expect_err("unborn repository must be rejected");

        assert!(
            error.contains("HEAD has no commit"),
            "unexpected error: {error}"
        );
        assert!(!repository.root.join(".worktrees/agt-unborn-0001").exists());
        assert_branch_absent(&repository.root, "agent/agt-unborn-0001");
    }

    #[test]
    fn stale_branch_lock_reports_git_reason_and_allows_retry_after_unlock() {
        let repository = TempRepository::create("stale-lock", false, true);
        let lock = repository
            .root
            .join(".git/refs/heads/agent/agt-locked-0001.lock");
        fs::create_dir_all(lock.parent().expect("lock parent")).expect("create lock parent");
        fs::write(&lock, "stale\n").expect("create stale branch lock");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-locked-0001")
            .expect_err("stale lock must reject creation");

        assert!(
            error.contains("cannot lock ref"),
            "unexpected error: {error}"
        );
        assert!(error.len() <= MAX_WORKTREE_FAILURE_REASON_BYTES);
        assert!(!repository.root.join(".worktrees/agt-locked-0001").exists());
        assert_branch_absent(&repository.root, "agent/agt-locked-0001");

        fs::remove_file(lock).expect("remove stale branch lock");
        let retried = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-locked-0001")
            .expect("retry after stale lock removal");
        assert!(retried.worktree_path.is_dir());
    }

    #[test]
    fn branch_lookup_error_is_not_treated_as_an_absent_branch() {
        let repository = TempRepository::create("lookup-error", false, true);
        let non_repository = repository.root.parent().expect("container");

        let error = local_branch_head(non_repository, "agent/agt-lookup-0001")
            .expect_err("lookup outside a repository must fail");

        assert!(
            error.contains("not a git repository"),
            "unexpected: {error}"
        );
    }

    #[test]
    fn foreign_existing_target_is_never_removed() {
        let repository = TempRepository::create("foreign-target", false, true);
        let target = repository.root.join(".worktrees/agt-foreign-0001");
        fs::create_dir_all(&target).expect("create foreign target");
        fs::write(target.join("owner.txt"), "foreign\n").expect("write foreign marker");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-foreign-0001")
            .expect_err("foreign target must block creation");

        assert!(error.contains("already exists"), "unexpected: {error}");
        assert_eq!(
            fs::read_to_string(target.join("owner.txt")).expect("foreign marker retained"),
            "foreign\n"
        );
        assert_branch_absent(&repository.root, "agent/agt-foreign-0001");
    }

    #[test]
    fn concurrent_duplicate_add_keeps_the_winning_worktree() {
        let repository = TempRepository::create("concurrent", false, true);
        let root = Arc::new(repository.root.clone());
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let root = Arc::clone(&root);
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                CommandGitWorktreeGateway::new().add_agent_worktree(&root, "agt-concurrent-0001")
            }));
        }
        barrier.wait();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().expect("join add worker"))
            .collect();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        let target = repository.root.join(".worktrees/agt-concurrent-0001");
        assert!(target.is_dir());
        assert_eq!(
            local_branch_head(&repository.root, "agent/agt-concurrent-0001")
                .expect("query winning branch"),
            Some(repository_head(&repository.root).expect("query head"))
        );
    }

    #[test]
    fn concurrent_distinct_adds_install_one_local_exclude_entry() {
        let repository = TempRepository::create("concurrent-exclude", false, true);
        let root = Arc::new(repository.root.clone());
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = ["agt-distinct-0001", "agt-distinct-0002"]
            .into_iter()
            .map(|task_id| {
                let root = Arc::clone(&root);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    CommandGitWorktreeGateway::new().add_agent_worktree(&root, task_id)
                })
            })
            .collect();
        barrier.wait();
        for worker in workers {
            worker
                .join()
                .expect("join distinct add worker")
                .expect("create distinct worktree");
        }

        let exclude =
            fs::read(repository.root.join(".git/info/exclude")).expect("read local exclude file");
        assert_eq!(
            exclude
                .split(|byte| *byte == b'\n')
                .filter(|line| *line == WORKTREE_EXCLUDE_PATTERN)
                .count(),
            1
        );
        let status = git_output(&repository.root, &["status", "--short"]);
        assert_eq!(String::from_utf8_lossy(&status.stdout), "");
    }

    #[test]
    fn filesystem_lock_blocks_another_gateway_and_releases_for_retry() {
        let repository = TempRepository::create("cross-process-lock", false, true);
        let base = ensure_agent_worktree_base(&repository.root).expect("prepare worktree base");
        let held = AgentWorktreeCreationLock::acquire(&base, "agt-process-0001")
            .expect("acquire first process lock");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-process-0001")
            .expect_err("second gateway must fail closed on filesystem lock");

        assert!(
            error.contains("Another Codevo process"),
            "unexpected: {error}"
        );
        assert!(!repository.root.join(".worktrees/agt-process-0001").exists());
        drop(held);

        let retried = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-process-0001")
            .expect("retry after lock owner exits");
        assert!(retried.worktree_path.is_dir());
    }

    #[test]
    fn lock_drop_does_not_remove_a_lock_after_owner_token_changes() {
        let repository = TempRepository::create("lock-ownership", false, true);
        let base = ensure_agent_worktree_base(&repository.root).expect("prepare worktree base");
        let held = AgentWorktreeCreationLock::acquire(&base, "agt-owner-0001")
            .expect("acquire worktree lock");
        fs::write(&held.owner_path, "foreign-owner").expect("replace owner token");
        let lock_path = held.lock_path.clone();

        drop(held);

        assert!(lock_path.is_dir());
        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-owner-0001")
            .expect_err("changed owner lock must remain fail closed");
        assert!(error.contains("stale creation lock"), "unexpected: {error}");
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_worktree_base_is_rejected_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let repository = TempRepository::create("symlink-base", false, true);
        let outside = repository
            .root
            .parent()
            .expect("repository container")
            .join("outside");
        fs::create_dir(&outside).expect("create outside directory");
        symlink(&outside, repository.root.join(WORKTREE_BASE_DIR_NAME))
            .expect("symlink worktree base");

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-symlink-0001")
            .expect_err("symlinked base must be rejected");

        assert!(
            error.contains("must not be a symbolic link"),
            "unexpected: {error}"
        );
        assert_eq!(fs::read_dir(&outside).expect("read outside").count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn branch_permission_failure_is_actionable_clean_and_retryable() {
        use std::os::unix::fs::PermissionsExt;

        let repository = TempRepository::create("branch-permission", false, true);
        let branch_directory = repository.root.join(".git/refs/heads/agent");
        fs::create_dir_all(&branch_directory).expect("create branch directory");
        let original_mode = branch_directory
            .metadata()
            .expect("branch directory metadata")
            .permissions()
            .mode();
        fs::set_permissions(&branch_directory, fs::Permissions::from_mode(0o555))
            .expect("make branch directory read only");

        let failed = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-permission-0001");

        fs::set_permissions(&branch_directory, fs::Permissions::from_mode(original_mode))
            .expect("restore branch directory permissions");
        let error = failed.expect_err("read-only branch directory must reject creation");
        assert!(
            error.to_ascii_lowercase().contains("permission denied"),
            "unexpected error: {error}"
        );
        assert!(!repository
            .root
            .join(".worktrees/agt-permission-0001")
            .exists());
        assert_branch_absent(&repository.root, "agent/agt-permission-0001");

        let retried = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-permission-0001")
            .expect("retry after restoring branch permissions");
        assert!(retried.worktree_path.is_dir());
    }

    #[test]
    fn failed_checkout_compensates_partial_branch_and_target_before_retry() {
        let repository = TempRepository::create("checkout-rollback", false, true);
        fs::write(
            repository.root.join(".gitattributes"),
            "*.blocked filter=reject\n",
        )
        .expect("write attributes");
        fs::write(repository.root.join("fixture.blocked"), "blocked\n")
            .expect("write filtered fixture");
        run_git(&repository.root, &["config", "filter.reject.clean", "cat"]);
        run_git(
            &repository.root,
            &["config", "filter.reject.smudge", "false"],
        );
        run_git(
            &repository.root,
            &["config", "filter.reject.required", "true"],
        );
        run_git(
            &repository.root,
            &["add", ".gitattributes", "fixture.blocked"],
        );
        run_git(&repository.root, &["commit", "-m", "filtered fixture"]);

        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-filter-0001")
            .expect_err("required smudge failure must reject checkout");

        assert!(error.contains("filter"), "unexpected error: {error}");
        assert!(!repository.root.join(".worktrees/agt-filter-0001").exists());
        assert_branch_absent(&repository.root, "agent/agt-filter-0001");
        let failed_status = git_output(&repository.root, &["status", "--short"]);
        assert_eq!(String::from_utf8_lossy(&failed_status.stdout), "");

        run_git(
            &repository.root,
            &["config", "filter.reject.required", "false"],
        );
        let retried = CommandGitWorktreeGateway::new()
            .add_agent_worktree(&repository.root, "agt-filter-0001")
            .expect("retry after checkout failure");
        assert!(retried.worktree_path.is_dir());
    }

    #[test]
    fn git_failure_reason_is_control_free_and_utf8_bounded() {
        let raw = format!(
            "fatal: permission\n\u{1b}[31mdenied\u{0085}\u{202e} {}",
            "é".repeat(400)
        );
        let sanitized = sanitize_git_failure_reason(&raw);

        assert!(sanitized.starts_with("permission denied "));
        assert!(sanitized.ends_with(" [truncated]"));
        assert!(!sanitized.contains('\u{202e}'));
        assert!(!sanitized.chars().any(char::is_control));
        assert!(sanitized.len() <= MAX_WORKTREE_FAILURE_REASON_BYTES);
        assert!(std::str::from_utf8(sanitized.as_bytes()).is_ok());
    }
}
