use crate::agent_task_spawner::agent_provider::agent_cli_version::{
    now_epoch_ms, AgentCliVersionProbeRequest, AgentCliVersionRegistry,
};
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderExecutableResolver, ResolvedProviderExecutable,
};
use crate::agent_task_spawner::{
    agent_cli_binary_unavailable_error,
    agent_provider::process::{executable_identity_path_with_effective_path, ExecutableIdentity},
    AgentCliInvocation, AGENT_TASK_INHERITED_ENV, MAX_AGENT_CLI_PATH_BYTES,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    env, fmt, fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub const MAX_EFFECTIVE_PATH_ENTRIES: usize = 64;
pub const MAX_EFFECTIVE_PATH_BYTES: usize = 64 * 1024;
pub const MAX_BASE_PATH_ENTRIES: usize = 48;
pub const MAX_DISCOVERY_DIRECTORY_VISITS: usize = 256;
pub const MAX_DISCOVERY_DIRECTORY_ENTRIES: usize = 256;
pub const MAX_DISCOVERY_GLOB_DEPTH: usize = 3;
pub const MAX_EXECUTABLE_SYMLINK_DEPTH: usize = 16;
pub const LOGIN_SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_LOGIN_SHELL_OUTPUT_BYTES: usize = 64 * 1024;

const LOGIN_SHELL_COMMAND: &str = "printf %s \"$PATH\"";
const LOGIN_SHELL_POLL_INTERVAL: Duration = Duration::from_millis(10);
const LOGIN_SHELL_READER_GRACE: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentCliDiscoveryError {
    EffectivePathUnavailable,
    EffectivePathTooLarge,
    CacheUnavailable,
    GenerationExhausted,
}

impl fmt::Display for AgentCliDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::EffectivePathUnavailable => "The effective executable PATH is unavailable.",
            Self::EffectivePathTooLarge => {
                "The effective executable PATH exceeds the supported length."
            }
            Self::CacheUnavailable => "The executable discovery cache is unavailable.",
            Self::GenerationExhausted => "The executable discovery generation is exhausted.",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for AgentCliDiscoveryError {}

#[derive(Clone, Debug)]
pub struct DiscoveredAgentCli {
    path: PathBuf,
    version: Option<String>,
    identity: ExecutableIdentity,
}

impl DiscoveredAgentCli {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    pub fn identity(&self) -> &ExecutableIdentity {
        &self.identity
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedAgentCli {
    environment: Arc<EffectiveExecutableEnvironment>,
    executable: DiscoveredAgentCli,
}

impl ResolvedAgentCli {
    pub fn environment(&self) -> &EffectiveExecutableEnvironment {
        &self.environment
    }

    pub fn executable(&self) -> &DiscoveredAgentCli {
        &self.executable
    }
}

#[derive(Clone, Debug)]
pub enum AgentCliResolution {
    Manual(ResolvedAgentCli),
    Detected(ResolvedAgentCli),
    NotFound {
        environment: Arc<EffectiveExecutableEnvironment>,
    },
}

impl AgentCliResolution {
    pub fn environment(&self) -> &EffectiveExecutableEnvironment {
        match self {
            Self::Manual(resolved) | Self::Detected(resolved) => resolved.environment(),
            Self::NotFound { environment } => environment,
        }
    }

    pub fn executable(&self) -> Option<&DiscoveredAgentCli> {
        match self {
            Self::Manual(resolved) | Self::Detected(resolved) => Some(resolved.executable()),
            Self::NotFound { .. } => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct EffectiveExecutableEnvironment {
    path: String,
    path_fingerprint: String,
    authority_generation: u64,
    claude_code: Option<DiscoveredAgentCli>,
    codex: Option<DiscoveredAgentCli>,
    claude_configured_model: Option<String>,
    codex_configured_model: Option<String>,
}

impl EffectiveExecutableEnvironment {
    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn path_fingerprint(&self) -> &str {
        &self.path_fingerprint
    }

    pub fn authority_generation(&self) -> u64 {
        self.authority_generation
    }

    pub fn provider(&self, provider: AgentCliInvocation) -> Option<&DiscoveredAgentCli> {
        match provider {
            AgentCliInvocation::ClaudeCode => self.claude_code.as_ref(),
            AgentCliInvocation::CodexExec => self.codex.as_ref(),
        }
    }

    pub fn presentation(&self) -> AgentCliDiscoveryResult {
        AgentCliDiscoveryResult {
            claude_code: discovery_state(
                self.claude_code.as_ref(),
                self.claude_configured_model.as_deref(),
            ),
            codex: discovery_state(self.codex.as_ref(), self.codex_configured_model.as_deref()),
        }
    }
}

impl crate::effective_executable_environment::EffectiveExecutableEnvironmentSource
    for EffectiveExecutableEnvironment
{
    fn effective_path(&self) -> &str {
        self.path()
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliDiscoveryResult {
    pub claude_code: AgentCliDiscoveryState,
    pub codex: AgentCliDiscoveryState,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentCliDiscoveryState {
    Detected {
        path: String,
        version: Option<String>,
        #[serde(rename = "configuredModel")]
        configured_model: Option<String>,
    },
    NotFound,
}

fn discovery_state(
    discovered: Option<&DiscoveredAgentCli>,
    configured_model: Option<&str>,
) -> AgentCliDiscoveryState {
    let Some(discovered) = discovered else {
        return AgentCliDiscoveryState::NotFound;
    };
    AgentCliDiscoveryState::Detected {
        path: discovered.path.to_string_lossy().into_owned(),
        version: discovered.version.clone(),
        configured_model: configured_model.map(ToOwned::to_owned),
    }
}

pub trait AgentCliDiscoveryContext: Send + Sync {
    fn home_directory(&self) -> Option<PathBuf>;
    fn login_shell(&self) -> Option<PathBuf>;
    fn current_path(&self) -> Option<String>;
}

pub trait AgentCliVersionSource: Send + Sync {
    fn version(
        &self,
        provider: AgentCliInvocation,
        path: &Path,
        effective_path: &str,
    ) -> Option<String>;
}

#[derive(Default)]
pub struct SystemAgentCliDiscoveryContext;

impl AgentCliDiscoveryContext for SystemAgentCliDiscoveryContext {
    fn home_directory(&self) -> Option<PathBuf> {
        env::var_os("HOME").map(PathBuf::from)
    }

    fn login_shell(&self) -> Option<PathBuf> {
        env::var_os("SHELL").map(PathBuf::from)
    }

    fn current_path(&self) -> Option<String> {
        env::var("PATH").ok()
    }
}

struct RegistryAgentCliVersionSource {
    registry: Arc<AgentCliVersionRegistry>,
}

impl AgentCliVersionSource for RegistryAgentCliVersionSource {
    fn version(
        &self,
        provider: AgentCliInvocation,
        path: &Path,
        effective_path: &str,
    ) -> Option<String> {
        let request = AgentCliVersionProbeRequest {
            agent_cli_path: path.to_string_lossy().into_owned(),
            agent_cli_kind: provider,
        };
        self.registry
            .refresh_with_effective_path(&request, now_epoch_ms(), effective_path)
            .ok()
            .and_then(|result| result.version)
    }
}

pub struct AgentCliDiscovery {
    context: Arc<dyn AgentCliDiscoveryContext>,
    versions: Arc<dyn AgentCliVersionSource>,
    shell_timeout: Duration,
    cache: Mutex<DiscoveryCache>,
    cache_settled: Condvar,
}

struct DiscoveryCache {
    generation: u64,
    building_generation: Option<u64>,
    snapshot: Option<Arc<EffectiveExecutableEnvironment>>,
}

enum DiscoveryBuildAdmission<'a> {
    Cached(Arc<EffectiveExecutableEnvironment>),
    Build(DiscoveryBuildGuard<'a>),
}

struct DiscoveryBuildGuard<'a> {
    discovery: &'a AgentCliDiscovery,
    generation: u64,
    settled: bool,
}

impl DiscoveryBuildGuard<'_> {
    fn settle(
        mut self,
        result: Result<Arc<EffectiveExecutableEnvironment>, AgentCliDiscoveryError>,
    ) -> Result<
        Option<Result<Arc<EffectiveExecutableEnvironment>, AgentCliDiscoveryError>>,
        AgentCliDiscoveryError,
    > {
        let mut cache = self
            .discovery
            .cache
            .lock()
            .map_err(|_| AgentCliDiscoveryError::CacheUnavailable)?;
        if let Some(snapshot) = &cache.snapshot {
            let snapshot = snapshot.clone();
            self.finish(&mut cache);
            return Ok(Some(Ok(snapshot)));
        }
        if cache.generation != self.generation {
            self.finish(&mut cache);
            return Ok(None);
        }
        if let Ok(snapshot) = &result {
            cache.snapshot = Some(snapshot.clone());
        }
        self.finish(&mut cache);
        Ok(Some(result))
    }

    fn finish(&mut self, cache: &mut DiscoveryCache) {
        if cache.building_generation == Some(self.generation) {
            cache.building_generation = None;
        }
        self.settled = true;
        self.discovery.cache_settled.notify_all();
    }
}

impl Drop for DiscoveryBuildGuard<'_> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        let Ok(mut cache) = self.discovery.cache.lock() else {
            self.discovery.cache_settled.notify_all();
            return;
        };
        if cache.building_generation == Some(self.generation) {
            cache.building_generation = None;
        }
        self.discovery.cache_settled.notify_all();
    }
}

impl AgentCliDiscovery {
    pub fn new(version_registry: Arc<AgentCliVersionRegistry>) -> Self {
        Self::with_collaborators(
            Arc::new(SystemAgentCliDiscoveryContext),
            Arc::new(RegistryAgentCliVersionSource {
                registry: version_registry,
            }),
            LOGIN_SHELL_PATH_TIMEOUT,
        )
    }

    pub fn with_collaborators(
        context: Arc<dyn AgentCliDiscoveryContext>,
        versions: Arc<dyn AgentCliVersionSource>,
        shell_timeout: Duration,
    ) -> Self {
        Self {
            context,
            versions,
            shell_timeout,
            cache: Mutex::new(DiscoveryCache {
                generation: 0,
                building_generation: None,
                snapshot: None,
            }),
            cache_settled: Condvar::new(),
        }
    }

    pub fn effective_environment(
        &self,
    ) -> Result<Arc<EffectiveExecutableEnvironment>, AgentCliDiscoveryError> {
        loop {
            let build_guard = match self.begin_build()? {
                DiscoveryBuildAdmission::Cached(snapshot) => return Ok(snapshot),
                DiscoveryBuildAdmission::Build(build_guard) => build_guard,
            };
            let result = self.build_environment(build_guard.generation);
            if let Some(settled) = build_guard.settle(result)? {
                return settled;
            }
        }
    }

    fn build_environment(
        &self,
        authority_generation: u64,
    ) -> Result<Arc<EffectiveExecutableEnvironment>, AgentCliDiscoveryError> {
        let effective_path = self.build_effective_path()?;
        let fingerprint = path_fingerprint(&effective_path);
        let home = self
            .context
            .home_directory()
            .filter(|path| path.is_absolute());
        let snapshot = Arc::new(EffectiveExecutableEnvironment {
            claude_code: self.discover_provider(
                AgentCliInvocation::ClaudeCode,
                "claude",
                &effective_path,
            ),
            codex: self.discover_provider(AgentCliInvocation::CodexExec, "codex", &effective_path),
            claude_configured_model: home.as_deref().and_then(read_claude_configured_model),
            codex_configured_model: home.as_deref().and_then(read_codex_configured_model),
            path: effective_path,
            path_fingerprint: fingerprint,
            authority_generation,
        });
        Ok(snapshot)
    }

    pub fn refresh(&self) -> Result<Arc<EffectiveExecutableEnvironment>, AgentCliDiscoveryError> {
        self.invalidate()?;
        self.effective_environment()
    }

    pub fn resolve_provider(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
    ) -> Result<AgentCliResolution, AgentCliDiscoveryError> {
        let environment = self.effective_environment()?;
        let Some(manual_override) = manual_override else {
            let Some(executable) = environment.provider(provider).cloned() else {
                return Ok(AgentCliResolution::NotFound { environment });
            };
            return Ok(AgentCliResolution::Detected(ResolvedAgentCli {
                environment,
                executable,
            }));
        };
        let Some(path) = bounded_manual_path(manual_override) else {
            return Ok(AgentCliResolution::NotFound { environment });
        };
        let Ok(identity) = executable_identity_path_with_effective_path(&path, environment.path())
        else {
            return Ok(AgentCliResolution::NotFound { environment });
        };
        let executable = DiscoveredAgentCli {
            version: self.versions.version(provider, &path, environment.path()),
            path,
            identity,
        };
        Ok(AgentCliResolution::Manual(ResolvedAgentCli {
            environment,
            executable,
        }))
    }

    pub fn invalidate(&self) -> Result<(), AgentCliDiscoveryError> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| AgentCliDiscoveryError::CacheUnavailable)?;
        cache.generation = cache
            .generation
            .checked_add(1)
            .ok_or(AgentCliDiscoveryError::GenerationExhausted)?;
        cache.snapshot = None;
        self.cache_settled.notify_all();
        Ok(())
    }

    fn begin_build(&self) -> Result<DiscoveryBuildAdmission<'_>, AgentCliDiscoveryError> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| AgentCliDiscoveryError::CacheUnavailable)?;
        loop {
            if let Some(snapshot) = &cache.snapshot {
                return Ok(DiscoveryBuildAdmission::Cached(snapshot.clone()));
            }
            if cache.building_generation.is_none() {
                let generation = cache.generation;
                cache.building_generation = Some(generation);
                return Ok(DiscoveryBuildAdmission::Build(DiscoveryBuildGuard {
                    discovery: self,
                    generation,
                    settled: false,
                }));
            }
            cache = self
                .cache_settled
                .wait(cache)
                .map_err(|_| AgentCliDiscoveryError::CacheUnavailable)?;
        }
    }

    fn build_effective_path(&self) -> Result<String, AgentCliDiscoveryError> {
        let base = self
            .login_shell_path()
            .or_else(|| self.context.current_path())
            .ok_or(AgentCliDiscoveryError::EffectivePathUnavailable)?;
        let mut candidates = bounded_base_directories(&base);
        if let Some(home) = self
            .context
            .home_directory()
            .filter(|path| path.is_absolute())
        {
            candidates.extend(well_known_directories(&home));
        }
        bounded_path(candidates)
    }

    fn login_shell_path(&self) -> Option<String> {
        let shell = self.context.login_shell()?;
        if !is_known_login_shell(&shell) {
            return None;
        }
        let shell = bounded_executable_path(&shell)?;
        run_login_shell_path(&shell, self.shell_timeout).ok()
    }

    fn discover_provider(
        &self,
        provider: AgentCliInvocation,
        executable_name: &str,
        effective_path: &str,
    ) -> Option<DiscoveredAgentCli> {
        for directory in split_path(effective_path) {
            let candidate = directory.join(executable_name);
            let Some(canonical_path) = bounded_executable_path(&candidate) else {
                continue;
            };
            let Ok(identity) =
                executable_identity_path_with_effective_path(&canonical_path, effective_path)
            else {
                continue;
            };
            let version = self
                .versions
                .version(provider, &canonical_path, effective_path);
            return Some(DiscoveredAgentCli {
                path: canonical_path,
                version,
                identity,
            });
        }
        None
    }
}

const MAX_AGENT_MODEL_CONFIG_BYTES: u64 = 256 * 1024;
const MAX_AGENT_MODEL_ID_BYTES: usize = 128;

fn read_claude_configured_model(home: &Path) -> Option<String> {
    let contents = read_bounded_config(&home.join(".claude/settings.json"))?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    bounded_model_id(value.get("model")?.as_str()?)
}

fn read_codex_configured_model(home: &Path) -> Option<String> {
    let contents = read_bounded_config(&home.join(".codex/config.toml"))?;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') || !line.starts_with("model") {
            continue;
        }
        let (key, value) = line.split_once('=')?;
        if key.trim() != "model" {
            continue;
        }
        return bounded_model_id(value.trim().trim_matches('"').trim_matches('\''));
    }
    None
}

fn read_bounded_config(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_AGENT_MODEL_CONFIG_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn bounded_model_id(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_AGENT_MODEL_ID_BYTES || !value.is_ascii() {
        return None;
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-._[]".contains(&byte))
    {
        return None;
    }
    Some(value.to_string())
}

impl AgentProviderExecutableResolver for AgentCliDiscovery {
    fn resolve_provider(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        if refresh {
            self.refresh().map_err(|error| error.to_string())?;
        }
        let resolution = AgentCliDiscovery::resolve_provider(self, provider, manual_override)
            .map_err(|error| error.to_string())?;
        let environment = resolution.environment();
        let executable = resolution
            .executable()
            .ok_or_else(|| agent_cli_binary_unavailable_error(provider))?;
        Ok(ResolvedProviderExecutable {
            cli_path: executable.path().to_string_lossy().into_owned(),
            cli_identity: executable.identity().clone(),
            effective_path: environment.path().to_string(),
            path_fingerprint: environment.path_fingerprint().to_string(),
            discovery_generation: environment.authority_generation(),
        })
    }
}

fn bounded_manual_path(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return None;
    }
    bounded_executable_path(Path::new(path))
}

fn split_path(path: &str) -> Vec<PathBuf> {
    env::split_paths(path)
        .filter(|entry| entry.is_absolute())
        .filter(|entry| entry.as_os_str().len() <= MAX_AGENT_CLI_PATH_BYTES)
        .collect()
}

fn bounded_base_directories(path: &str) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut directories = Vec::new();
    for directory in split_path(path) {
        if !seen.insert(directory.clone()) {
            continue;
        }
        directories.push(directory);
        if directories.len() == MAX_BASE_PATH_ENTRIES {
            break;
        }
    }
    directories
}

fn bounded_path(candidates: Vec<PathBuf>) -> Result<String, AgentCliDiscoveryError> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for candidate in candidates {
        if entries.len() == MAX_EFFECTIVE_PATH_ENTRIES {
            break;
        }
        let Some(key) = candidate.to_str() else {
            continue;
        };
        if key.is_empty() || !seen.insert(key.to_string()) {
            continue;
        }
        entries.push(candidate);
    }
    if entries.is_empty() {
        return Err(AgentCliDiscoveryError::EffectivePathUnavailable);
    }
    let joined = env::join_paths(entries)
        .map_err(|_| AgentCliDiscoveryError::EffectivePathUnavailable)?
        .to_string_lossy()
        .into_owned();
    if joined.len() > MAX_EFFECTIVE_PATH_BYTES {
        return Err(AgentCliDiscoveryError::EffectivePathTooLarge);
    }
    Ok(joined)
}

fn path_fingerprint(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn well_known_directories(home: &Path) -> Vec<PathBuf> {
    let mut directories = vec![
        home.join(".local/bin"),
        home.join(".claude/local"),
        home.join(".codex/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".volta/bin"),
        home.join("Library/pnpm"),
        home.join(".bun/bin"),
    ];
    directories.extend(interleaved_manager_directories(
        nvm_bin_directories(home),
        fnm_bin_directories(home),
    ));
    directories
}

fn interleaved_manager_directories(nvm: Vec<PathBuf>, fnm: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut nvm = nvm.into_iter();
    let mut fnm = fnm.into_iter();
    let mut directories = Vec::new();
    loop {
        let next_nvm = nvm.next();
        let next_fnm = fnm.next();
        if next_nvm.is_none() && next_fnm.is_none() {
            return directories;
        }
        if let Some(directory) = next_nvm {
            directories.push(directory);
        }
        if let Some(directory) = next_fnm {
            directories.push(directory);
        }
    }
}

fn nvm_bin_directories(home: &Path) -> Vec<PathBuf> {
    let versions = home.join(".nvm/versions/node");
    let BoundedChildren::Complete(children) = bounded_children(&versions) else {
        return Vec::new();
    };
    children
        .into_iter()
        .map(|directory| directory.join("bin"))
        .filter(|directory| directory.is_dir())
        .collect()
}

fn fnm_bin_directories(home: &Path) -> Vec<PathBuf> {
    let root = home.join(".fnm");
    let mut matches = Vec::new();
    let mut pending = VecDeque::from([(root, 0usize)]);
    let mut visits = 0usize;
    while let Some((directory, depth)) = pending.pop_front() {
        if visits == MAX_DISCOVERY_DIRECTORY_VISITS {
            return Vec::new();
        }
        visits += 1;
        let BoundedChildren::Complete(children) = bounded_children(&directory) else {
            return Vec::new();
        };
        for child in children {
            let child_depth = depth + 1;
            if child_depth <= MAX_DISCOVERY_GLOB_DEPTH
                && child.file_name().is_some_and(|name| name == "bin")
            {
                matches.push(child);
                continue;
            }
            if child_depth >= MAX_DISCOVERY_GLOB_DEPTH {
                continue;
            }
            pending.push_back((child, child_depth));
        }
    }
    matches
}

enum BoundedChildren {
    Complete(Vec<PathBuf>),
    Overflow,
}

fn bounded_children(directory: &Path) -> BoundedChildren {
    let Ok(entries) = fs::read_dir(directory) else {
        return BoundedChildren::Complete(Vec::new());
    };
    let mut children = Vec::new();
    let mut count = 0usize;
    for entry in entries {
        count += 1;
        if count > MAX_DISCOVERY_DIRECTORY_ENTRIES {
            return BoundedChildren::Overflow;
        }
        let Ok(entry) = entry else {
            return BoundedChildren::Overflow;
        };
        let path = entry.path();
        if path.is_dir() {
            children.push(path);
        }
    }
    children.sort();
    BoundedChildren::Complete(children)
}

fn is_known_login_shell(shell: &Path) -> bool {
    if !shell.is_absolute() || shell.as_os_str().len() > MAX_AGENT_CLI_PATH_BYTES {
        return false;
    }
    matches!(
        shell.file_name().and_then(|name| name.to_str()),
        Some("zsh" | "bash" | "fish" | "sh")
    )
}

fn run_login_shell_path(shell: &Path, timeout: Duration) -> Result<String, ()> {
    let cwd = shell.parent().unwrap_or_else(|| Path::new("/"));
    let mut command = Command::new(shell);
    command
        .args(["-l", "-c", LOGIN_SHELL_COMMAND])
        .current_dir(cwd)
        .env_clear()
        .envs(allowed_shell_environment())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| ())?;
    let process_group_id = i32::try_from(child.id()).ok();
    let output_budget = Arc::new(AtomicUsize::new(0));
    let stdout = child
        .stdout
        .take()
        .map(|reader| spawn_shell_reader(reader, output_budget.clone()));
    let stderr = child
        .stderr
        .take()
        .map(|reader| spawn_shell_reader(reader, output_budget));
    let started = Instant::now();
    let status = settle_shell(&mut child, process_group_id, started, timeout);
    let deadline = started + timeout + LOGIN_SHELL_READER_GRACE;
    let stdout = join_shell_reader(stdout, deadline).ok_or(())?;
    let stderr = join_shell_reader(stderr, deadline).ok_or(())?;
    let Some(status) = status else {
        return Err(());
    };
    if !status.success() || stdout.len() + stderr.len() > MAX_LOGIN_SHELL_OUTPUT_BYTES {
        return Err(());
    }
    let output = String::from_utf8(stdout).map_err(|_| ())?;
    if output.is_empty() || output.contains('\0') || output.len() > MAX_EFFECTIVE_PATH_BYTES {
        return Err(());
    }
    Ok(output)
}

fn allowed_shell_environment() -> Vec<(String, String)> {
    AGENT_TASK_INHERITED_ENV
        .iter()
        .filter_map(|key| env::var(key).ok().map(|value| ((*key).to_string(), value)))
        .collect()
}

fn settle_shell(
    child: &mut Child,
    process_group_id: Option<i32>,
    started: Instant,
    timeout: Duration,
) -> Option<std::process::ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                kill_shell_group(process_group_id);
                return Some(status);
            }
            Err(_) => {
                kill_shell_process(process_group_id, child);
                return None;
            }
            Ok(None) => {}
        }
        if started.elapsed() >= timeout {
            kill_shell_process(process_group_id, child);
            return None;
        }
        thread::sleep(LOGIN_SHELL_POLL_INTERVAL);
    }
}

fn kill_shell_process(process_group_id: Option<i32>, child: &mut Child) {
    kill_shell_group(process_group_id);
    let _ = child.kill();
    let _ = child.wait();
}

fn kill_shell_group(process_group_id: Option<i32>) {
    #[cfg(unix)]
    {
        if let Some(process_group_id) = process_group_id {
            unsafe {
                libc::kill(-process_group_id, libc::SIGKILL);
            }
        }
    }
}

fn spawn_shell_reader<R: Read + Send + 'static>(
    mut reader: R,
    output_budget: Arc<AtomicUsize>,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(read) = reader.read(&mut buffer) {
            if read == 0 {
                break;
            }
            let claimed = output_budget.fetch_add(read, Ordering::AcqRel);
            let accepted = (MAX_LOGIN_SHELL_OUTPUT_BYTES + 1)
                .saturating_sub(claimed)
                .min(read);
            output.extend_from_slice(&buffer[..accepted]);
            if claimed + read > MAX_LOGIN_SHELL_OUTPUT_BYTES {
                break;
            }
        }
        output
    })
}

fn join_shell_reader(
    reader: Option<thread::JoinHandle<Vec<u8>>>,
    deadline: Instant,
) -> Option<Vec<u8>> {
    let Some(reader) = reader else {
        return Some(Vec::new());
    };
    while !reader.is_finished() {
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(LOGIN_SHELL_POLL_INTERVAL);
    }
    reader.join().ok()
}

fn bounded_executable_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.as_os_str().len() > MAX_AGENT_CLI_PATH_BYTES {
        return None;
    }
    let canonical = resolve_symlinks(path)?;
    let metadata = fs::metadata(&canonical).ok()?;
    if !metadata.is_file() || !is_executable(&metadata) {
        return None;
    }
    Some(canonical)
}

fn resolve_symlinks(path: &Path) -> Option<PathBuf> {
    let mut candidate = normalize_absolute(path)?;
    let mut followed = 0usize;
    loop {
        let components = candidate.components().collect::<Vec<_>>();
        let mut built = PathBuf::new();
        let mut replaced = false;
        for (index, component) in components.iter().enumerate() {
            built.push(component.as_os_str());
            let metadata = fs::symlink_metadata(&built).ok()?;
            if !metadata.file_type().is_symlink() {
                continue;
            }
            if followed == MAX_EXECUTABLE_SYMLINK_DEPTH {
                return None;
            }
            followed += 1;
            let target = fs::read_link(&built).ok()?;
            let mut replacement = match target.is_absolute() {
                true => target,
                false => built.parent()?.join(target),
            };
            for remaining in components.iter().skip(index + 1) {
                replacement.push(remaining.as_os_str());
            }
            candidate = normalize_absolute(&replacement)?;
            replaced = true;
            break;
        }
        if replaced {
            continue;
        }
        return fs::canonicalize(candidate).ok();
    }
}

fn normalize_absolute(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new("/")),
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.parent().is_none() || normalized == Path::new("/") {
                    return None;
                }
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    Some(normalized)
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

#[cfg(test)]
#[path = "agent_cli_discovery/tests.rs"]
mod tests;
