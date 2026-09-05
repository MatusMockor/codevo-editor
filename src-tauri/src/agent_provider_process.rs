use crate::agent_task_spawner::agent_provider::{
    brew_cask, npm_package, MAX_AGENT_PROVIDER_OUTPUT_BYTES,
};
#[cfg(test)]
use crate::agent_task_spawner::MAX_AGENT_CLI_PATH_BYTES;
use crate::agent_task_spawner::{inherited_environment, AgentCliInvocation};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
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
const MAX_PROVIDER_ENV_VALUE_BYTES: usize = 64 * 1024;

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

    pub fn is_current_for_spawn(&self) -> bool {
        if !self.retained_shallow_is_current() || !self.path_is_current_shallow_with(|| false) {
            return false;
        }
        match &self.launch {
            ExecutableLaunch::Native => true,
            ExecutableLaunch::Script { interpreter } => interpreter.is_current_for_spawn(),
        }
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
        self.spawn_cancellable(|| false, || true)
    }

    fn spawn_cancellable(
        &mut self,
        cancelled: impl Fn() -> bool,
        before_spawn: impl FnOnce() -> bool,
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
        if !before_spawn() {
            return Err(BoundExecutableSpawnFailure::IdentityChanged);
        }
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
    AccountUsage(AgentCliInvocation),
    SelfUpdate(AgentCliInvocation),
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
    stdin_payload: Option<Box<[u8]>>,
    stdout_completion_marker: Option<Box<[u8]>>,
    requires_update_authorization: bool,
}

#[derive(Clone, Debug)]
pub struct AgentProviderSignInRecipe {
    identity: ExecutableIdentity,
    program: PathBuf,
    args: Box<[String]>,
    env: Box<[(String, String)]>,
}

impl AgentProviderSignInRecipe {
    pub fn from_resolved(
        identity: ExecutableIdentity,
        provider: AgentCliInvocation,
        effective_path: &str,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(effective_path)?;
        let semantic_args = match provider {
            AgentCliInvocation::ClaudeCode => vec!["auth", "login"],
            AgentCliInvocation::CodexExec => vec!["login"],
        };
        let semantic_args = semantic_args
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let (program, args) = match &identity.launch {
            ExecutableLaunch::Native => (identity.canonical_path.clone(), semantic_args),
            ExecutableLaunch::Script { interpreter } => {
                let mut args = Vec::with_capacity(semantic_args.len() + 1);
                args.push(identity.canonical_path.to_string_lossy().into_owned());
                args.extend(semantic_args);
                (interpreter.canonical_path.clone(), args)
            }
        };
        Ok(Self {
            identity,
            program,
            args: args.into_boxed_slice(),
            env: sign_in_environment(effective_path).into_boxed_slice(),
        })
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn env(&self) -> &[(String, String)] {
        &self.env
    }

    pub fn identity_is_current(&self) -> bool {
        self.identity.is_current_for_spawn()
    }
}

impl AgentProviderProcessPlan {
    pub fn provider_owned_with_effective_path(
        identity: ExecutableIdentity,
        intent: AgentProviderProcessIntent,
        effective_path: &str,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(effective_path)?;
        let provider = match intent {
            AgentProviderProcessIntent::InstalledVersion(provider)
            | AgentProviderProcessIntent::AuthenticationStatus(provider)
            | AgentProviderProcessIntent::AuthenticationStatusText(provider)
            | AgentProviderProcessIntent::AccountUsage(provider)
            | AgentProviderProcessIntent::SelfUpdate(provider) => provider,
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
            AgentProviderProcessIntent::AccountUsage(AgentCliInvocation::ClaudeCode) => vec![
                "-p",
                "/usage",
                "--output-format",
                "json",
                "--permission-mode",
                "dontAsk",
                "--no-session-persistence",
            ],
            AgentProviderProcessIntent::AccountUsage(AgentCliInvocation::CodexExec) => {
                vec!["app-server", "--stdio"]
            }
            AgentProviderProcessIntent::SelfUpdate(_) => vec!["update"],
            _ => return Err("Provider executable cannot run this operation.".to_string()),
        };
        let requires_update_authorization =
            matches!(intent, AgentProviderProcessIntent::SelfUpdate(_));
        let (timeout, output_limit) = match requires_update_authorization {
            true => (AGENT_PROVIDER_UPDATE_TIMEOUT, UPDATE_OUTPUT_BYTES),
            false => (
                AGENT_PROVIDER_PROBE_TIMEOUT,
                MAX_AGENT_PROVIDER_OUTPUT_BYTES,
            ),
        };
        let mut plan = Self::new(
            identity,
            args,
            effective_path,
            timeout,
            output_limit,
            requires_update_authorization,
        );
        if provider == AgentCliInvocation::CodexExec
            && matches!(intent, AgentProviderProcessIntent::AccountUsage(_))
        {
            plan.stdin_payload = Some(
                concat!(
                    "{\"method\":\"initialize\",\"id\":0,\"params\":{\"clientInfo\":{\"name\":\"codevo_editor\",\"title\":\"Codevo Editor\",\"version\":\"0.2.0\"}}}\n",
                    "{\"method\":\"initialized\",\"params\":{}}\n",
                    "{\"method\":\"account/rateLimits/read\",\"id\":1}\n"
                )
                .as_bytes()
                .into(),
            );
            plan.stdout_completion_marker = Some(b"\"id\":1,\"result\"".as_slice().into());
        }
        Ok(plan)
    }

    pub fn package_manager_with_effective_path(
        identity: ExecutableIdentity,
        intent: AgentProviderProcessIntent,
        effective_path: &str,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(effective_path)?;
        let requires_update_authorization = matches!(
            &intent,
            AgentProviderProcessIntent::NpmUpdate { .. }
                | AgentProviderProcessIntent::BrewUpdate(_)
        );
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
        Ok(Self::new_strings(
            identity,
            args,
            effective_path,
            timeout,
            output_limit,
            requires_update_authorization,
        ))
    }

    fn new(
        identity: ExecutableIdentity,
        args: Vec<&str>,
        effective_path: &str,
        timeout: Duration,
        output_limit: usize,
        requires_update_authorization: bool,
    ) -> Self {
        Self::new_strings(
            identity,
            args.into_iter().map(str::to_string).collect(),
            effective_path,
            timeout,
            output_limit,
            requires_update_authorization,
        )
    }

    fn new_strings(
        identity: ExecutableIdentity,
        args: Vec<String>,
        effective_path: &str,
        timeout: Duration,
        output_limit: usize,
        requires_update_authorization: bool,
    ) -> Self {
        let cwd = identity
            .canonical_path
            .parent()
            .map_or_else(|| PathBuf::from("/"), Path::to_path_buf);
        Self {
            identity,
            args: args.into_boxed_slice(),
            cwd,
            env: provider_environment(effective_path).into_boxed_slice(),
            timeout,
            output_limit,
            stdin_payload: None,
            stdout_completion_marker: None,
            requires_update_authorization,
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

fn provider_environment(effective_path: &str) -> Vec<(String, String)> {
    let mut result: Vec<(String, String)> = inherited_environment()
        .into_iter()
        .filter_map(|(key, value)| {
            if key == "SHELL" || key == "PATH" {
                return None;
            }
            bounded_environment_entry(key, value)
        })
        .collect();
    result.push(("PATH".to_string(), effective_path.to_string()));
    for key in [
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ] {
        if let Some(value) = bounded_host_environment_value(key) {
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

fn sign_in_environment(effective_path: &str) -> Vec<(String, String)> {
    let mut result = inherited_environment()
        .into_iter()
        .filter(|(key, value)| key != "PATH" && value.len() <= MAX_PROVIDER_ENV_VALUE_BYTES)
        .collect::<Vec<_>>();
    result.push(("PATH".to_string(), effective_path.to_string()));
    for key in [
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ] {
        if let Some(value) = bounded_host_environment_value(key) {
            result.push((key.to_string(), value));
        }
    }
    result
}

fn bounded_host_environment_value(key: &str) -> Option<String> {
    let value = env::var(key).ok()?;
    bounded_environment_entry(key.to_string(), value).map(|(_, value)| value)
}

fn bounded_environment_entry(key: String, value: String) -> Option<(String, String)> {
    (value.len() <= MAX_PROVIDER_ENV_VALUE_BYTES).then_some((key, value))
}

pub fn resolve_package_manager_on_path(
    name: &str,
    effective_path: &str,
) -> Option<ExecutableIdentity> {
    if !matches!(name, "npm" | "brew") {
        return None;
    }
    let effective_path = validate_effective_path(effective_path).ok()?;
    env::split_paths(effective_path)
        .take(64)
        .map(|directory| directory.join(name))
        .find_map(|candidate| {
            executable_identity_path_with_effective_path(&candidate, effective_path).ok()
        })
}

#[cfg(test)]
pub fn executable_identity(path: &str) -> Result<ExecutableIdentity, String> {
    if path.is_empty() || path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return Err("Provider executable path is invalid.".to_string());
    }
    let effective_path = current_effective_path()?;
    executable_identity_path_with_effective_path(Path::new(path), &effective_path)
}

pub fn executable_identity_path_with_effective_path(
    path: &Path,
    effective_path: &str,
) -> Result<ExecutableIdentity, String> {
    let effective_path = validate_effective_path(effective_path)?;
    executable_identity_path_with_depth(path, 0, effective_path)
}

fn executable_identity_path_with_depth(
    path: &Path,
    interpreter_depth: usize,
    effective_path: &str,
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
    let launch = executable_launch(&descriptor, interpreter_depth, effective_path)?;
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
    effective_path: &str,
) -> Result<ExecutableLaunch, String> {
    let shebang = read_shebang(descriptor)?;
    let Some(shebang) = shebang else {
        return Ok(ExecutableLaunch::Native);
    };
    if interpreter_depth != 0 {
        return Err("Provider script interpreter is unsupported.".to_string());
    }
    let interpreter_path = resolve_shebang_interpreter(&shebang, effective_path)?;
    let interpreter = executable_identity_path_with_depth(&interpreter_path, 1, effective_path)?;
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

fn resolve_shebang_interpreter(shebang: &str, effective_path: &str) -> Result<PathBuf, String> {
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
    resolve_path_executable(name, effective_path)
        .ok_or_else(|| "Provider script interpreter is unavailable.".to_string())
}

fn resolve_path_executable(name: &str, effective_path: &str) -> Option<PathBuf> {
    env::split_paths(effective_path)
        .take(64)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
fn current_effective_path() -> Result<String, String> {
    env::var("PATH").map_err(|_| "Provider executable PATH is unavailable.".to_string())
}

fn validate_effective_path(effective_path: &str) -> Result<&str, String> {
    if effective_path.is_empty()
        || effective_path.len() > MAX_PROVIDER_ENV_VALUE_BYTES
        || effective_path.contains('\0')
    {
        return Err("Provider executable PATH is invalid.".to_string());
    }
    let mut entries = 0usize;
    for entry in env::split_paths(effective_path) {
        if !entry.is_absolute() || entry.as_os_str().is_empty() {
            return Err("Provider executable PATH is invalid.".to_string());
        }
        entries += 1;
        if entries > 64 {
            return Err("Provider executable PATH is invalid.".to_string());
        }
    }
    if entries == 0 {
        return Err("Provider executable PATH is invalid.".to_string());
    }
    Ok(effective_path)
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
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let limit = size.saturating_add(1);
    let mut offset = 0_u64;
    while offset < limit {
        if cancelled() {
            return Err("Provider executable validation was cancelled.".to_string());
        }
        let remaining = usize::try_from((limit - offset).min(buffer.len() as u64))
            .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
        let count = read_executable_at(descriptor, &mut buffer[..remaining], offset)
            .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        offset = offset.saturating_add(count as u64);
    }
    Ok(hasher.finalize().into())
}

#[cfg(unix)]
fn read_executable_at(descriptor: &fs::File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::unix::fs::FileExt;
    descriptor.read_at(buffer, offset)
}

#[cfg(windows)]
fn read_executable_at(descriptor: &fs::File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::windows::fs::FileExt;
    descriptor.seek_read(buffer, offset)
}

#[cfg(not(any(unix, windows)))]
fn read_executable_at(descriptor: &fs::File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    let mut reader = descriptor.try_clone()?;
    reader.seek(SeekFrom::Start(offset))?;
    reader.read(buffer)
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentProviderProcessOutputStream {
    Stdout,
    Stderr,
}

pub trait AgentProviderProcessOutputSink: Send + Sync {
    fn emit(&self, stream: AgentProviderProcessOutputStream, data: &[u8]) -> Result<(), ()>;

    fn finish(&self, _stream: AgentProviderProcessOutputStream) -> Result<(), ()> {
        Ok(())
    }
}

struct NoopAgentProviderProcessOutputSink;

impl AgentProviderProcessOutputSink for NoopAgentProviderProcessOutputSink {
    fn emit(&self, _stream: AgentProviderProcessOutputStream, _data: &[u8]) -> Result<(), ()> {
        Ok(())
    }
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
    if plan.requires_update_authorization {
        return Err(AgentProviderProcessFailure::Uncertain(
            "Provider update plan requires spawn authorization.".to_string(),
        ));
    }
    execute_agent_provider_plan_cancellable_inner(
        plan,
        cancelled,
        || true,
        Arc::new(NoopAgentProviderProcessOutputSink),
    )
}

#[cfg(test)]
pub fn execute_agent_provider_update_plan_cancellable(
    plan: &AgentProviderProcessPlan,
    cancelled: impl Fn() -> bool,
    before_spawn: impl FnOnce() -> bool,
) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
    if !plan.requires_update_authorization {
        return Err(AgentProviderProcessFailure::Uncertain(
            "Provider probe plan cannot use update spawn authorization.".to_string(),
        ));
    }
    execute_agent_provider_update_plan_cancellable_with_output_sink(
        plan,
        cancelled,
        before_spawn,
        Arc::new(NoopAgentProviderProcessOutputSink),
    )
}

pub fn execute_agent_provider_update_plan_cancellable_with_output_sink(
    plan: &AgentProviderProcessPlan,
    cancelled: impl Fn() -> bool,
    before_spawn: impl FnOnce() -> bool,
    output_sink: Arc<dyn AgentProviderProcessOutputSink>,
) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
    if !plan.requires_update_authorization {
        return Err(AgentProviderProcessFailure::Uncertain(
            "Provider probe plan cannot use update spawn authorization.".to_string(),
        ));
    }
    execute_agent_provider_plan_cancellable_inner(plan, cancelled, before_spawn, output_sink)
}

fn execute_agent_provider_plan_cancellable_inner(
    plan: &AgentProviderProcessPlan,
    cancelled: impl Fn() -> bool,
    before_spawn: impl FnOnce() -> bool,
    output_sink: Arc<dyn AgentProviderProcessOutputSink>,
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
        .stdin(if plan.stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child =
        match bound.spawn_cancellable(|| cancelled() || Instant::now() >= deadline, before_spawn) {
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
    let mut child = child;
    let mut retained_stdin = None;
    if let Some(payload) = plan.stdin_payload.as_deref() {
        let Some(mut stdin) = child.stdin.take() else {
            let mut owned = OwnedProviderChild::new(child, None, deadline, plan.output_limit, None);
            owned.terminate();
            return Err(AgentProviderProcessFailure::Uncertain(
                "Provider input pipe was unavailable.".to_string(),
            ));
        };
        if let Err(error) = stdin.write_all(payload) {
            drop(stdin);
            let mut owned = OwnedProviderChild::new(child, None, deadline, plan.output_limit, None);
            owned.terminate();
            return Err(AgentProviderProcessFailure::Uncertain(error.to_string()));
        }
        retained_stdin = Some(stdin);
    }
    OwnedProviderChild::new(
        child,
        retained_stdin,
        deadline,
        plan.output_limit,
        plan.stdout_completion_marker.clone(),
    )
    .settle(cancelled, output_sink)
}

struct OwnedProviderChild {
    child: Child,
    stdin: Option<ChildStdin>,
    process_group_id: Option<i32>,
    deadline: Instant,
    output_limit: usize,
    stdout_completion_marker: Option<Box<[u8]>>,
    settled: bool,
}

impl OwnedProviderChild {
    fn new(
        child: Child,
        stdin: Option<ChildStdin>,
        deadline: Instant,
        output_limit: usize,
        stdout_completion_marker: Option<Box<[u8]>>,
    ) -> Self {
        Self {
            process_group_id: i32::try_from(child.id()).ok(),
            child,
            stdin,
            deadline,
            output_limit,
            stdout_completion_marker,
            settled: false,
        }
    }

    fn settle(
        mut self,
        cancelled: impl Fn() -> bool,
        output_sink: Arc<dyn AgentProviderProcessOutputSink>,
    ) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
        let bytes_read = Arc::new(AtomicUsize::new(0));
        let retained_bytes = Arc::new(AtomicUsize::new(0));
        let output_exceeded = Arc::new(AtomicBool::new(false));
        let completion_observed = Arc::new(AtomicBool::new(false));
        let stdout = self.child.stdout.take().map(|reader| {
            spawn_reader(
                reader,
                self.output_limit,
                ProviderReaderContext {
                    bytes_read: Arc::clone(&bytes_read),
                    retained_bytes: Arc::clone(&retained_bytes),
                    output_exceeded: Arc::clone(&output_exceeded),
                    stream: AgentProviderProcessOutputStream::Stdout,
                    output_sink: Arc::clone(&output_sink),
                    completion_marker: self.stdout_completion_marker.clone(),
                    completion_observed: Arc::clone(&completion_observed),
                },
            )
        });
        let stderr = self.child.stderr.take().map(|reader| {
            spawn_reader(
                reader,
                self.output_limit,
                ProviderReaderContext {
                    bytes_read: Arc::clone(&bytes_read),
                    retained_bytes: Arc::clone(&retained_bytes),
                    output_exceeded: Arc::clone(&output_exceeded),
                    stream: AgentProviderProcessOutputStream::Stderr,
                    output_sink: Arc::clone(&output_sink),
                    completion_marker: None,
                    completion_observed: Arc::clone(&completion_observed),
                },
            )
        });
        let mut exceeded = false;
        let mut cancelled_by_owner = false;
        let mut completed_by_marker = false;
        let status = loop {
            if cancelled() {
                cancelled_by_owner = true;
                break None;
            }
            if output_exceeded.load(Ordering::Acquire) {
                exceeded = true;
                break None;
            }
            if completion_observed.load(Ordering::Acquire) {
                completed_by_marker = true;
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
        if completed_by_marker {
            return Ok(AgentProviderProcessOutput { stdout, stderr });
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
        self.stdin.take();
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

struct ProviderReaderContext {
    bytes_read: Arc<AtomicUsize>,
    retained_bytes: Arc<AtomicUsize>,
    output_exceeded: Arc<AtomicBool>,
    stream: AgentProviderProcessOutputStream,
    output_sink: Arc<dyn AgentProviderProcessOutputSink>,
    completion_marker: Option<Box<[u8]>>,
    completion_observed: Arc<AtomicBool>,
}

fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    context: ProviderReaderContext,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let ProviderReaderContext {
            bytes_read,
            retained_bytes,
            output_exceeded,
            stream,
            output_sink,
            completion_marker,
            completion_observed,
        } = context;
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let count = match reader.read(&mut buffer) {
                Ok(count) => count,
                Err(_) => {
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        output_sink.finish(stream)
                    }));
                    return output;
                }
            };
            if count == 0 {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    output_sink.finish(stream)
                }));
                return output;
            }
            let previous = bytes_read.fetch_add(count, Ordering::AcqRel);
            if previous.saturating_add(count) > limit {
                output_exceeded.store(true, Ordering::Release);
            }
            let published = count.min(limit.saturating_sub(previous));
            if published > 0 {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    output_sink.emit(stream, &buffer[..published])
                }));
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
                        if completion_marker.as_deref().is_some_and(|marker| {
                            output.windows(marker.len()).any(|window| window == marker)
                        }) {
                            completion_observed.store(true, Ordering::Release);
                        }
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
#[path = "agent_provider_process_tests.rs"]
mod tests;
