use serde::Serialize;
use std::{
    ffi::OsStr,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
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
pub const MAX_LISTED_WORKTREE_ENTRIES: usize = 256;

const WORKTREE_RECORD_PREFIX: &str = "worktree ";
const WORKTREE_HEAD_PREFIX: &str = "HEAD ";
const WORKTREE_BRANCH_PREFIX: &str = "branch ";
const WORKTREE_LOCKED_ATTRIBUTE: &str = "locked";
const WORKTREE_PRUNABLE_ATTRIBUTE: &str = "prunable";
const LOCAL_BRANCH_REF_PREFIX: &str = "refs/heads/";
const HOOKS_DISABLED_CONFIG: &str = "core.hooksPath=/dev/null";

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
        let existing = self.list_worktrees(&root)?;

        if existing.len() >= MAX_WORKTREES_PER_REPOSITORY {
            return Err(format!(
                "Repository already holds the maximum of {MAX_WORKTREES_PER_REPOSITORY} worktrees."
            ));
        }

        let base = root.join(WORKTREE_BASE_DIR_NAME);
        fs::create_dir_all(&base)
            .map_err(|error| format!("Failed to create the worktree directory: {error}"))?;

        let target = agent_worktree_path(&root, &task_id);
        ensure_path_bounds(&target)?;

        if target.symlink_metadata().is_ok() {
            return Err("A worktree for this agent task already exists.".to_string());
        }

        let branch = agent_branch_name(&task_id);
        ensure_branch_bounds(&branch)?;

        run_worktree_command(
            &root,
            &[
                OsStr::new("worktree"),
                OsStr::new("add"),
                OsStr::new("-b"),
                OsStr::new(branch.as_str()),
                target.as_os_str(),
            ],
        )?;

        let worktree_path = ensure_worktree_path_in_base(&root, &target)?;

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

fn worktree_git_command(repository_root: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-c")
        .arg(HOOKS_DISABLED_CONFIG)
        .arg("-C")
        .arg(repository_root);
    command
}

fn run_worktree_command(repository_root: &Path, arguments: &[&OsStr]) -> Result<String, String> {
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
        thread::spawn(move || read_bounded_stream(stderr, MAX_WORKTREE_COMMAND_STDERR_BYTES));

    let stdout_result = read_bounded_stream(stdout, MAX_WORKTREE_LIST_OUTPUT_BYTES);

    if stdout_result.is_err() {
        let _ = child.kill();
    }

    let stderr_result = stderr_reader.join();
    let wait_result = child.wait();

    let stdout_bytes = stdout_result?;
    let status = wait_result
        .map_err(|error| format!("Failed to await the git worktree command: {error}"))?;

    if status.success() {
        return Ok(String::from_utf8_lossy(&stdout_bytes).to_string());
    }

    let failure = match stderr_result {
        Ok(Ok(bytes)) => String::from_utf8_lossy(&bytes).trim().to_string(),
        _ => String::new(),
    };

    if failure.is_empty() {
        return Err("The git worktree command failed.".to_string());
    }

    Err(failure)
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
