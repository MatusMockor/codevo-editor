use crate::agent_task_spawner::agent_provider::{
    brew_cask, npm_package, MAX_AGENT_PROVIDER_OUTPUT_BYTES,
};
use crate::agent_task_spawner::{
    inherited_environment, AgentCliInvocation, MAX_AGENT_CLI_PATH_BYTES,
};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

pub const AGENT_PROVIDER_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
pub const AGENT_PROVIDER_UPDATE_TIMEOUT: Duration = Duration::from_secs(600);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const READER_GRACE: Duration = Duration::from_millis(250);
const UPDATE_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_PROVIDER_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ExecutableIdentity {
    pub canonical_path: PathBuf,
    pub size_bytes: u64,
    pub modified_epoch_ms: u64,
    #[cfg(unix)]
    pub device: u64,
    #[cfg(unix)]
    pub inode: u64,
    digest: [u8; 32],
    descriptor: Arc<fs::File>,
    launch: ExecutableLaunch,
}

#[derive(Clone, Debug)]
enum ExecutableLaunch {
    Native,
    Script {
        interpreter: Box<ExecutableIdentity>,
    },
}

impl PartialEq for ExecutableIdentity {
    fn eq(&self, other: &Self) -> bool {
        self.canonical_path == other.canonical_path
            && self.size_bytes == other.size_bytes
            && self.modified_epoch_ms == other.modified_epoch_ms
            && self.digest == other.digest
            && same_platform_identity(self, other)
            && launch_identity_matches(&self.launch, &other.launch)
    }
}

impl Eq for ExecutableIdentity {}

impl ExecutableIdentity {
    pub fn retained_is_current(&self) -> bool {
        if !self.retained_shallow_is_current() {
            return false;
        }
        match &self.launch {
            ExecutableLaunch::Native => true,
            ExecutableLaunch::Script { interpreter } => interpreter.retained_is_current(),
        }
    }

    fn retained_shallow_is_current(&self) -> bool {
        self.retained_shallow_is_current_with(|| false)
    }

    fn retained_shallow_is_current_with(&self, cancelled: impl Fn() -> bool) -> bool {
        let Ok(metadata) = self.descriptor.metadata() else {
            return false;
        };
        if metadata.len() != self.size_bytes {
            return false;
        }
        if executable_digest_cancellable(&self.descriptor, metadata.len(), cancelled)
            .ok()
            .as_ref()
            != Some(&self.digest)
        {
            return false;
        }
        if !platform_metadata_matches(self, &metadata) {
            return false;
        }
        true
    }

    fn path_is_current_shallow_with(&self, cancelled: impl Fn() -> bool) -> bool {
        let Ok(canonical_path) = fs::canonicalize(&self.canonical_path) else {
            return false;
        };
        if canonical_path != self.canonical_path {
            return false;
        }
        let Ok(descriptor) = open_executable(&canonical_path) else {
            return false;
        };
        let Ok(metadata) = descriptor.metadata() else {
            return false;
        };
        if !metadata.is_file()
            || !is_executable(&metadata)
            || metadata.len() != self.size_bytes
            || !platform_metadata_matches(self, &metadata)
        {
            return false;
        }
        let modified_epoch_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .and_then(|value| u64::try_from(value.as_millis()).ok());
        if modified_epoch_ms != Some(self.modified_epoch_ms) {
            return false;
        }
        executable_digest_cancellable(&descriptor, metadata.len(), cancelled)
            .ok()
            .as_ref()
            == Some(&self.digest)
    }

    pub fn bound_command(&self) -> Result<BoundExecutableCommand, String> {
        if !self.retained_is_current() {
            return Err("Provider executable identity changed before launch.".to_string());
        }
        bound_command(self)
    }
}

fn launch_identity_matches(left: &ExecutableLaunch, right: &ExecutableLaunch) -> bool {
    match (left, right) {
        (ExecutableLaunch::Native, ExecutableLaunch::Native) => true,
        (
            ExecutableLaunch::Script { interpreter: left },
            ExecutableLaunch::Script { interpreter: right },
        ) => left == right,
        _ => false,
    }
}

pub struct BoundExecutableCommand {
    command: Command,
    dependencies: Vec<ExecutableIdentity>,
    artifact: ExecutableIdentity,
    #[cfg(test)]
    before_artifact_validation: Option<Box<dyn FnOnce() + Send>>,
}

#[derive(Debug)]
pub enum BoundExecutableSpawnFailure {
    IdentityChanged,
    Spawn(io::Error),
}

impl BoundExecutableCommand {
    pub fn command_mut(&mut self) -> &mut Command {
        &mut self.command
    }

    pub fn spawn(&mut self) -> Result<Child, BoundExecutableSpawnFailure> {
        self.spawn_cancellable(|| false)
    }

    fn spawn_cancellable(
        &mut self,
        cancelled: impl Fn() -> bool,
    ) -> Result<Child, BoundExecutableSpawnFailure> {
        if cancelled() {
            return Err(BoundExecutableSpawnFailure::IdentityChanged);
        }
        for dependency in &self.dependencies {
            if !dependency.retained_shallow_is_current_with(&cancelled)
                || !dependency.path_is_current_shallow_with(&cancelled)
            {
                return Err(BoundExecutableSpawnFailure::IdentityChanged);
            }
        }
        #[cfg(test)]
        if let Some(barrier) = self.before_artifact_validation.take() {
            barrier();
        }
        if !self.artifact.retained_shallow_is_current_with(&cancelled)
            || !self.artifact.path_is_current_shallow_with(&cancelled)
        {
            return Err(BoundExecutableSpawnFailure::IdentityChanged);
        }
        if cancelled() {
            return Err(BoundExecutableSpawnFailure::IdentityChanged);
        }
        self.command
            .spawn()
            .map_err(BoundExecutableSpawnFailure::Spawn)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentProviderProcessIntent {
    InstalledVersion(AgentCliInvocation),
    AuthenticationStatus(AgentCliInvocation),
    AuthenticationStatusText(AgentCliInvocation),
    NpmGlobalRoot,
    NpmInventory,
    NpmAvailableVersion(AgentCliInvocation),
    NpmUpdate {
        provider: AgentCliInvocation,
        version: String,
    },
    BrewCaskroom(AgentCliInvocation),
    BrewOutdated(AgentCliInvocation),
    BrewUpdate(AgentCliInvocation),
}

#[derive(Clone, Debug)]
pub struct AgentProviderProcessPlan {
    identity: ExecutableIdentity,
    args: Box<[String]>,
    cwd: PathBuf,
    env: Box<[(String, String)]>,
    timeout: Duration,
    output_limit: usize,
}

impl AgentProviderProcessPlan {
    pub fn provider(cli_path: &str, intent: AgentProviderProcessIntent) -> Result<Self, String> {
        let identity = executable_identity(cli_path)?;
        Self::provider_owned(identity, intent)
    }

    pub fn provider_owned(
        identity: ExecutableIdentity,
        intent: AgentProviderProcessIntent,
    ) -> Result<Self, String> {
        let provider = match intent {
            AgentProviderProcessIntent::InstalledVersion(provider)
            | AgentProviderProcessIntent::AuthenticationStatus(provider)
            | AgentProviderProcessIntent::AuthenticationStatusText(provider) => provider,
            _ => return Err("Provider executable cannot run this operation.".to_string()),
        };
        let args = match intent {
            AgentProviderProcessIntent::InstalledVersion(_) => vec!["--version"],
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode) => {
                vec!["auth", "status", "--json"]
            }
            AgentProviderProcessIntent::AuthenticationStatusText(
                AgentCliInvocation::ClaudeCode,
            ) => vec!["auth", "status"],
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec)
            | AgentProviderProcessIntent::AuthenticationStatusText(AgentCliInvocation::CodexExec) =>
            {
                vec!["login", "status"]
            }
            _ => return Err("Provider executable cannot run this operation.".to_string()),
        };
        let _ = provider;
        Ok(Self::new(
            identity,
            args,
            AGENT_PROVIDER_PROBE_TIMEOUT,
            MAX_AGENT_PROVIDER_OUTPUT_BYTES,
        ))
    }

    pub fn package_manager(
        identity: ExecutableIdentity,
        intent: AgentProviderProcessIntent,
    ) -> Result<Self, String> {
        let (args, timeout, output_limit) = match intent {
            AgentProviderProcessIntent::NpmGlobalRoot => (
                vec!["root".to_string(), "--global".to_string()],
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
            AgentProviderProcessIntent::NpmInventory => (
                [
                    "ls",
                    "-g",
                    "--json",
                    "@anthropic-ai/claude-code",
                    "@openai/codex",
                    "--depth",
                    "0",
                ]
                .into_iter()
                .map(str::to_string)
                .collect(),
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
            AgentProviderProcessIntent::NpmAvailableVersion(provider) => (
                ["view", npm_package(provider), "version", "--json"]
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
            AgentProviderProcessIntent::NpmUpdate { provider, version } => {
                validate_exact_version(&version)?;
                (
                    vec![
                        "install".to_string(),
                        "--global".to_string(),
                        format!("{}@{version}", npm_package(provider)),
                    ],
                    AGENT_PROVIDER_UPDATE_TIMEOUT,
                    UPDATE_OUTPUT_BYTES,
                )
            }
            AgentProviderProcessIntent::BrewCaskroom(provider) => (
                vec!["--caskroom".to_string(), brew_cask(provider).to_string()],
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
            AgentProviderProcessIntent::BrewOutdated(provider) => (
                vec![
                    "outdated".to_string(),
                    "--json=v2".to_string(),
                    "--cask".to_string(),
                    brew_cask(provider).to_string(),
                ],
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
            AgentProviderProcessIntent::BrewUpdate(provider) => (
                vec![
                    "upgrade".to_string(),
                    "--cask".to_string(),
                    brew_cask(provider).to_string(),
                ],
                AGENT_PROVIDER_UPDATE_TIMEOUT,
                UPDATE_OUTPUT_BYTES,
            ),
            _ => return Err("Package manager cannot run this operation.".to_string()),
        };
        Ok(Self::new_strings(identity, args, timeout, output_limit))
    }

    fn new(
        identity: ExecutableIdentity,
        args: Vec<&str>,
        timeout: Duration,
        output_limit: usize,
    ) -> Self {
        Self::new_strings(
            identity,
            args.into_iter().map(str::to_string).collect(),
            timeout,
            output_limit,
        )
    }

    fn new_strings(
        identity: ExecutableIdentity,
        args: Vec<String>,
        timeout: Duration,
        output_limit: usize,
    ) -> Self {
        let cwd = identity
            .canonical_path
            .parent()
            .map_or_else(|| PathBuf::from("/"), Path::to_path_buf);
        Self {
            identity,
            args: args.into_boxed_slice(),
            cwd,
            env: provider_environment().into_boxed_slice(),
            timeout,
            output_limit,
        }
    }

    pub fn identity(&self) -> &ExecutableIdentity {
        &self.identity
    }

    #[cfg(test)]
    fn args(&self) -> &[String] {
        &self.args
    }
}

fn validate_exact_version(version: &str) -> Result<(), String> {
    if crate::agent_task_spawner::agent_provider::agent_cli_version::parse_agent_cli_version(
        version,
    )
    .as_deref()
        != Some(version)
    {
        return Err("Provider update version is invalid.".to_string());
    }
    Ok(())
}

fn provider_environment() -> Vec<(String, String)> {
    let mut result: Vec<(String, String)> = inherited_environment()
        .into_iter()
        .filter(|(key, _)| key != "SHELL")
        .collect();
    for key in [
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ] {
        if let Ok(value) = env::var(key) {
            result.push((key.to_string(), value));
        }
    }
    result.push(("CI".to_string(), "1".to_string()));
    result.push(("NO_COLOR".to_string(), "1".to_string()));
    result.push(("npm_config_audit".to_string(), "false".to_string()));
    result.push(("npm_config_fund".to_string(), "false".to_string()));
    result.push((
        "npm_config_update_notifier".to_string(),
        "false".to_string(),
    ));
    result
}

pub fn resolve_package_manager(name: &str) -> Option<ExecutableIdentity> {
    if !matches!(name, "npm" | "brew") {
        return None;
    }
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .take(64)
        .map(|directory| directory.join(name))
        .find_map(|candidate| executable_identity_path(&candidate).ok())
}

pub fn executable_identity(path: &str) -> Result<ExecutableIdentity, String> {
    if path.is_empty() || path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return Err("Provider executable path is invalid.".to_string());
    }
    executable_identity_path(Path::new(path))
}

pub fn executable_identity_path(path: &Path) -> Result<ExecutableIdentity, String> {
    executable_identity_path_with_depth(path, 0)
}

fn executable_identity_path_with_depth(
    path: &Path,
    interpreter_depth: usize,
) -> Result<ExecutableIdentity, String> {
    if !path.is_absolute() {
        return Err("Provider executable path must be absolute.".to_string());
    }
    let canonical_path = fs::canonicalize(path)
        .map_err(|_| "Provider executable is missing or unavailable.".to_string())?;
    let descriptor = open_executable(&canonical_path)?;
    let metadata = descriptor
        .metadata()
        .map_err(|_| "Provider executable is missing or unavailable.".to_string())?;
    if !metadata.is_file() || !is_executable(&metadata) {
        return Err("Provider executable is missing or unavailable.".to_string());
    }
    if metadata.len() > MAX_PROVIDER_EXECUTABLE_BYTES {
        return Err("Provider executable is too large.".to_string());
    }
    let digest = executable_digest(&descriptor, metadata.len())?;
    let launch = executable_launch(&descriptor, interpreter_depth)?;
    let modified_epoch_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| u64::try_from(value.as_millis()).ok())
        .ok_or_else(|| "Provider executable identity is unavailable.".to_string())?;
    Ok(ExecutableIdentity {
        canonical_path,
        size_bytes: metadata.len(),
        modified_epoch_ms,
        #[cfg(unix)]
        device: std::os::unix::fs::MetadataExt::dev(&metadata),
        #[cfg(unix)]
        inode: std::os::unix::fs::MetadataExt::ino(&metadata),
        digest,
        descriptor: Arc::new(descriptor),
        launch,
    })
}

fn executable_launch(
    descriptor: &fs::File,
    interpreter_depth: usize,
) -> Result<ExecutableLaunch, String> {
    let shebang = read_shebang(descriptor)?;
    let Some(shebang) = shebang else {
        return Ok(ExecutableLaunch::Native);
    };
    if interpreter_depth != 0 {
        return Err("Provider script interpreter is unsupported.".to_string());
    }
    let interpreter_path = resolve_shebang_interpreter(&shebang)?;
    let interpreter = executable_identity_path_with_depth(&interpreter_path, 1)?;
    Ok(ExecutableLaunch::Script {
        interpreter: Box::new(interpreter),
    })
}

fn read_shebang(descriptor: &fs::File) -> Result<Option<String>, String> {
    let mut reader = descriptor
        .try_clone()
        .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
    let mut prefix = [0_u8; 512];
    let count = reader
        .read(&mut prefix)
        .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
    if !prefix[..count].starts_with(b"#!") {
        return Ok(None);
    }
    let end = prefix[..count]
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| "Provider script shebang is invalid.".to_string())?;
    let line = std::str::from_utf8(&prefix[2..end])
        .map_err(|_| "Provider script shebang is invalid.".to_string())?
        .trim_end_matches('\r')
        .trim();
    if line.is_empty() || line.len() > 256 {
        return Err("Provider script shebang is invalid.".to_string());
    }
    Ok(Some(line.to_string()))
}

fn resolve_shebang_interpreter(shebang: &str) -> Result<PathBuf, String> {
    let fields = shebang.split_ascii_whitespace().collect::<Vec<_>>();
    if fields.len() == 1 {
        let path = Path::new(fields[0]);
        if path.is_absolute() {
            return Ok(path.to_path_buf());
        }
        return Err("Provider script interpreter is unsupported.".to_string());
    }
    if fields.len() != 2 || fields[0] != "/usr/bin/env" {
        return Err("Provider script interpreter is unsupported.".to_string());
    }
    let name = fields[1];
    if name.is_empty()
        || name.len() > 64
        || name.contains('/')
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("Provider script interpreter is unsupported.".to_string());
    }
    resolve_path_executable(name)
        .ok_or_else(|| "Provider script interpreter is unavailable.".to_string())
}

fn resolve_path_executable(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .take(64)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

fn bound_command(identity: &ExecutableIdentity) -> Result<BoundExecutableCommand, String> {
    match &identity.launch {
        ExecutableLaunch::Native => Ok(BoundExecutableCommand {
            command: Command::new(&identity.canonical_path),
            dependencies: Vec::new(),
            artifact: identity.clone(),
            #[cfg(test)]
            before_artifact_validation: None,
        }),
        ExecutableLaunch::Script { interpreter } => {
            let mut command = Command::new(&interpreter.canonical_path);
            command.arg(&identity.canonical_path);
            Ok(BoundExecutableCommand {
                command,
                dependencies: vec![(**interpreter).clone()],
                artifact: identity.clone(),
                #[cfg(test)]
                before_artifact_validation: None,
            })
        }
    }
}

fn executable_digest(descriptor: &fs::File, size: u64) -> Result<[u8; 32], String> {
    executable_digest_cancellable(descriptor, size, || false)
}

fn executable_digest_cancellable(
    descriptor: &fs::File,
    size: u64,
    cancelled: impl Fn() -> bool,
) -> Result<[u8; 32], String> {
    let mut reader = descriptor
        .try_clone()
        .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
    let mut hasher = Sha256::new();
    let mut bounded = reader.take(size.saturating_add(1));
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancelled() {
            return Err("Provider executable validation was cancelled.".to_string());
        }
        let count = bounded
            .read(&mut buffer)
            .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().into())
}

#[cfg(unix)]
fn open_executable(path: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "Provider executable is missing or unavailable.".to_string())
}

#[cfg(not(unix))]
fn open_executable(path: &Path) -> Result<fs::File, String> {
    fs::File::open(path).map_err(|_| "Provider executable is missing or unavailable.".to_string())
}

#[cfg(unix)]
fn same_platform_identity(left: &ExecutableIdentity, right: &ExecutableIdentity) -> bool {
    left.device == right.device && left.inode == right.inode
}

#[cfg(not(unix))]
fn same_platform_identity(_left: &ExecutableIdentity, _right: &ExecutableIdentity) -> bool {
    true
}

#[cfg(unix)]
fn platform_metadata_matches(identity: &ExecutableIdentity, metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    identity.device == metadata.dev() && identity.inode == metadata.ino()
}

#[cfg(not(unix))]
fn platform_metadata_matches(_identity: &ExecutableIdentity, _metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

#[derive(Debug)]
pub enum AgentProviderProcessFailure {
    Spawn(String),
    TimedOut { stdout: Vec<u8>, stderr: Vec<u8> },
    OutputLimitExceeded { stdout: Vec<u8>, stderr: Vec<u8> },
    Exited { stdout: Vec<u8>, stderr: Vec<u8> },
    Uncertain(String),
}

#[derive(Debug)]
pub struct AgentProviderProcessOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[cfg(test)]
pub fn execute_agent_provider_plan(
    plan: &AgentProviderProcessPlan,
) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
    execute_agent_provider_plan_cancellable(plan, || false)
}

pub fn execute_agent_provider_plan_cancellable(
    plan: &AgentProviderProcessPlan,
    cancelled: impl Fn() -> bool,
) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
    let deadline = Instant::now() + plan.timeout;
    if cancelled() {
        return Err(AgentProviderProcessFailure::Uncertain(
            "Provider operation was cancelled.".to_string(),
        ));
    }
    let mut bound =
        bound_command(&plan.identity).map_err(AgentProviderProcessFailure::Uncertain)?;
    let command = bound.command_mut();
    command
        .args(plan.args.iter())
        .current_dir(&plan.cwd)
        .env_clear()
        .envs(plan.env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = match bound.spawn_cancellable(|| cancelled() || Instant::now() >= deadline) {
        Ok(child) => child,
        Err(BoundExecutableSpawnFailure::IdentityChanged) => {
            if cancelled() {
                return Err(AgentProviderProcessFailure::Uncertain(
                    "Provider operation was cancelled.".to_string(),
                ));
            }
            if Instant::now() >= deadline {
                return Err(AgentProviderProcessFailure::TimedOut {
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                });
            }
            return Err(AgentProviderProcessFailure::Uncertain(
                "Provider executable identity changed before launch.".to_string(),
            ));
        }
        Err(BoundExecutableSpawnFailure::Spawn(error)) => {
            return Err(AgentProviderProcessFailure::Spawn(error.to_string()));
        }
    };
    OwnedProviderChild::new(child, deadline, plan.output_limit).settle(cancelled)
}

struct OwnedProviderChild {
    child: Child,
    process_group_id: Option<i32>,
    deadline: Instant,
    output_limit: usize,
    settled: bool,
}

impl OwnedProviderChild {
    fn new(child: Child, deadline: Instant, output_limit: usize) -> Self {
        Self {
            process_group_id: i32::try_from(child.id()).ok(),
            child,
            deadline,
            output_limit,
            settled: false,
        }
    }

    fn settle(
        mut self,
        cancelled: impl Fn() -> bool,
    ) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
        let bytes_read = Arc::new(AtomicUsize::new(0));
        let retained_bytes = Arc::new(AtomicUsize::new(0));
        let output_exceeded = Arc::new(AtomicBool::new(false));
        let stdout = self.child.stdout.take().map(|reader| {
            spawn_reader(
                reader,
                self.output_limit,
                Arc::clone(&bytes_read),
                Arc::clone(&retained_bytes),
                Arc::clone(&output_exceeded),
            )
        });
        let stderr = self.child.stderr.take().map(|reader| {
            spawn_reader(
                reader,
                self.output_limit,
                Arc::clone(&bytes_read),
                Arc::clone(&retained_bytes),
                Arc::clone(&output_exceeded),
            )
        });
        let mut exceeded = false;
        let mut cancelled_by_owner = false;
        let status = loop {
            if cancelled() {
                cancelled_by_owner = true;
                break None;
            }
            if output_exceeded.load(Ordering::Acquire) {
                exceeded = true;
                break None;
            }
            match self.child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < self.deadline => thread::sleep(PROCESS_POLL_INTERVAL),
                Ok(None) => break None,
                Err(error) => {
                    self.terminate();
                    return Err(AgentProviderProcessFailure::Uncertain(error.to_string()));
                }
            }
        };
        if status.is_none() {
            self.terminate();
        }
        if status.is_some() {
            kill_group(self.process_group_id);
        }
        let deadline = Instant::now() + READER_GRACE;
        let stdout = join_reader(stdout, deadline);
        let stderr = join_reader(stderr, deadline);
        exceeded = exceeded || output_exceeded.load(Ordering::Acquire);
        self.settled = true;
        let (Some(stdout), Some(stderr)) = (stdout, stderr) else {
            return Err(AgentProviderProcessFailure::Uncertain(
                "Provider output readers did not settle.".to_string(),
            ));
        };
        if cancelled_by_owner {
            return Err(AgentProviderProcessFailure::Uncertain(
                "Provider operation was cancelled.".to_string(),
            ));
        }
        if exceeded {
            return Err(AgentProviderProcessFailure::OutputLimitExceeded { stdout, stderr });
        }
        let Some(status) = status else {
            return Err(AgentProviderProcessFailure::TimedOut { stdout, stderr });
        };
        if !status.success() {
            return Err(AgentProviderProcessFailure::Exited { stdout, stderr });
        }
        Ok(AgentProviderProcessOutput { stdout, stderr })
    }

    fn terminate(&mut self) {
        kill_group(self.process_group_id);
        let _ = self.child.kill();
        let _ = wait_child(&mut self.child);
        self.settled = true;
    }
}

impl Drop for OwnedProviderChild {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        self.terminate();
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    bytes_read: Arc<AtomicUsize>,
    retained_bytes: Arc<AtomicUsize>,
    output_exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let Ok(count) = reader.read(&mut buffer) else {
                return output;
            };
            if count == 0 {
                return output;
            }
            let previous = bytes_read.fetch_add(count, Ordering::AcqRel);
            if previous.saturating_add(count) > limit {
                output_exceeded.store(true, Ordering::Release);
            }
            let mut retained = retained_bytes.load(Ordering::Acquire);
            loop {
                if retained >= limit {
                    break;
                }
                let accepted = count.min(limit - retained);
                match retained_bytes.compare_exchange_weak(
                    retained,
                    retained + accepted,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                ) {
                    Ok(_) => {
                        output.extend_from_slice(&buffer[..accepted]);
                        break;
                    }
                    Err(current) => retained = current,
                }
            }
        }
    })
}

fn join_reader(reader: Option<thread::JoinHandle<Vec<u8>>>, deadline: Instant) -> Option<Vec<u8>> {
    let Some(reader) = reader else {
        return Some(Vec::new());
    };
    while !reader.is_finished() {
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
    reader.join().ok()
}

fn wait_child(child: &mut Child) -> io::Result<ExitStatus> {
    loop {
        match child.wait() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            result => return result,
        }
    }
}

#[cfg(unix)]
fn kill_group(process_group_id: Option<i32>) {
    let Some(process_group_id) = process_group_id.filter(|value| *value > 0) else {
        return;
    };
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_group(_process_group_id: Option<i32>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NONCE: AtomicU64 = AtomicU64::new(0);

    fn executable(body: &str) -> PathBuf {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let path = env::temp_dir().join(format!(
            "codevo-provider-process-{}-{nonce}",
            std::process::id()
        ));
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
        }
        path
    }

    #[test]
    fn semantic_plans_have_fixed_arguments() {
        let cli = executable("exit 0");
        let plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode),
        )
        .expect("plan");
        assert_eq!(plan.args(), ["auth", "status", "--json"]);
        let manager = executable_identity(cli.to_str().expect("path")).expect("manager identity");
        let npm = AgentProviderProcessPlan::package_manager(
            manager.clone(),
            AgentProviderProcessIntent::NpmAvailableVersion(AgentCliInvocation::CodexExec),
        )
        .expect("npm plan");
        assert_eq!(npm.args(), ["view", "@openai/codex", "version", "--json"]);
        let caskroom = AgentProviderProcessPlan::package_manager(
            manager.clone(),
            AgentProviderProcessIntent::BrewCaskroom(AgentCliInvocation::ClaudeCode),
        )
        .expect("caskroom plan");
        assert_eq!(caskroom.args(), ["--caskroom", "claude-code"]);
        let outdated = AgentProviderProcessPlan::package_manager(
            manager.clone(),
            AgentProviderProcessIntent::BrewOutdated(AgentCliInvocation::CodexExec),
        )
        .expect("outdated plan");
        assert_eq!(
            outdated.args(),
            ["outdated", "--json=v2", "--cask", "codex"]
        );
        let update = AgentProviderProcessPlan::package_manager(
            manager,
            AgentProviderProcessIntent::BrewUpdate(AgentCliInvocation::ClaudeCode),
        )
        .expect("update plan");
        assert_eq!(update.args(), ["upgrade", "--cask", "claude-code"]);
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn output_is_bounded_and_nonzero_is_explicit() {
        let cli = executable("head -c 32000 /dev/zero; exit 3");
        let plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
        )
        .expect("plan");
        let AgentProviderProcessFailure::Exited { stdout, .. } =
            execute_agent_provider_plan(&plan).expect_err("nonzero")
        else {
            panic!("wrong failure");
        };
        assert!(stdout.len() <= MAX_AGENT_PROVIDER_OUTPUT_BYTES);
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn combined_update_output_limit_is_a_hard_failure() {
        let cli = executable("head -c 700000 /dev/zero & head -c 700000 /dev/zero >&2 & wait");
        let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
        let plan = AgentProviderProcessPlan::package_manager(
            identity,
            AgentProviderProcessIntent::NpmUpdate {
                provider: AgentCliInvocation::CodexExec,
                version: "0.150.1".to_string(),
            },
        )
        .expect("plan");
        let AgentProviderProcessFailure::OutputLimitExceeded { stdout, stderr } =
            execute_agent_provider_plan(&plan).expect_err("output cap")
        else {
            panic!("wrong failure");
        };
        assert!(stdout.len() + stderr.len() <= UPDATE_OUTPUT_BYTES);
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn timeout_kills_the_owned_process_group() {
        let cli = executable("sleep 30 & wait");
        let mut plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
        )
        .expect("plan");
        plan.timeout = Duration::from_millis(100);
        assert!(matches!(
            execute_agent_provider_plan(&plan),
            Err(AgentProviderProcessFailure::TimedOut { .. })
        ));
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn validation_uses_the_process_deadline_before_spawn() {
        let marker = env::temp_dir().join(format!(
            "codevo-provider-deadline-marker-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
        let mut plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
        )
        .expect("plan");
        plan.timeout = Duration::ZERO;
        assert!(matches!(
            execute_agent_provider_plan(&plan),
            Err(AgentProviderProcessFailure::TimedOut { .. })
        ));
        assert!(!marker.exists());
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn cancellation_during_digest_validation_prevents_spawn() {
        let marker = env::temp_dir().join(format!(
            "codevo-provider-cancel-marker-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let body = format!(
            "touch '{}'; exit 0\n{}",
            marker.display(),
            "\n".repeat(128 * 1024)
        );
        let cli = executable(&body);
        let plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
        )
        .expect("plan");
        let polls = AtomicUsize::new(0);
        let result = execute_agent_provider_plan_cancellable(&plan, || {
            polls.fetch_add(1, Ordering::AcqRel) >= 3
        });
        assert!(matches!(
            result,
            Err(AgentProviderProcessFailure::Uncertain(message))
                if message == "Provider operation was cancelled."
        ));
        assert!(polls.load(Ordering::Acquire) >= 4);
        assert!(!marker.exists());
        fs::remove_file(cli).expect("cleanup");
    }

    #[test]
    fn owner_cancellation_reaps_the_process_group() {
        let cli = executable("sleep 30 & wait");
        let plan = AgentProviderProcessPlan::provider(
            cli.to_str().expect("path"),
            AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
        )
        .expect("plan");
        let cancelled = Arc::new(AtomicBool::new(false));
        let setter = Arc::clone(&cancelled);
        let thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            setter.store(true, Ordering::Release);
        });
        assert!(matches!(
            execute_agent_provider_plan_cancellable(&plan, || cancelled.load(Ordering::Acquire)),
            Err(AgentProviderProcessFailure::Uncertain(_))
        ));
        thread.join().expect("canceller");
        fs::remove_file(cli).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn final_spawn_revalidation_rejects_a_captured_script_path_swap() {
        use std::os::unix::fs::PermissionsExt;

        let cli = executable("printf captured");
        let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
        let mut bound = identity.bound_command().expect("bound command");
        let replacement = cli.with_extension("replacement");
        let swapped_cli = cli.clone();
        let retained = replacement.clone();
        bound.before_artifact_validation = Some(Box::new(move || {
            fs::rename(&swapped_cli, &retained).expect("retain original");
            fs::write(&swapped_cli, "#!/bin/sh\nprintf replaced\n").expect("replacement");
            fs::set_permissions(&swapped_cli, fs::Permissions::from_mode(0o755))
                .expect("permissions");
        }));
        assert!(matches!(
            bound.spawn(),
            Err(BoundExecutableSpawnFailure::IdentityChanged)
        ));
        fs::remove_file(cli).expect("replacement cleanup");
        fs::remove_file(replacement).expect("original cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn env_shebang_uses_the_captured_interpreter_under_a_hostile_path() {
        use std::os::unix::fs::PermissionsExt;

        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let fixture = env::temp_dir().join(format!(
            "codevo-provider-hostile-path-{}-{nonce}",
            std::process::id()
        ));
        let hostile = fixture.join("hostile");
        fs::create_dir_all(&hostile).expect("hostile path");
        let cli = fixture.join("provider");
        fs::write(&cli, "#!/usr/bin/env sh\nprintf captured\n").expect("provider");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("provider mode");
        let hostile_shell = hostile.join("sh");
        fs::write(&hostile_shell, "#!/bin/sh\nprintf hostile\n").expect("hostile shell");
        fs::set_permissions(&hostile_shell, fs::Permissions::from_mode(0o755))
            .expect("hostile mode");
        let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
        let mut bound = identity.bound_command().expect("bound command");
        let output = bound
            .command_mut()
            .env_clear()
            .env("PATH", &hostile)
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn captured interpreter")
            .wait_with_output()
            .expect("captured output");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"captured");
        fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_shebang_arguments_fail_closed() {
        let cli = executable("exit 0");
        fs::write(&cli, "#!/usr/bin/env -S sh\nexit 0\n").expect("unsupported script");
        assert_eq!(
            executable_identity(cli.to_str().expect("path")).expect_err("unsupported"),
            "Provider script interpreter is unsupported."
        );
        fs::remove_file(cli).expect("cleanup");
    }
}
