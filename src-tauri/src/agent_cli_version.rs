use crate::agent_task_spawner::{
    agent_cli_binary_unavailable_error, inherited_environment, AgentCliInvocation,
    MAX_AGENT_CLI_PATH_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const MAX_AGENT_CLI_VERSION_OUTPUT_BYTES: usize = 4 * 1024;
pub const MAX_AGENT_CLI_VERSION_BYTES: usize = 64;
pub const MAX_AGENT_CLI_VERSION_CACHE_ENTRIES: usize = 16;
pub const AGENT_CLI_VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

const AGENT_CLI_VERSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const AGENT_CLI_VERSION_READER_GRACE: Duration = Duration::from_millis(250);
const MAX_VERSION_NUMERIC_GROUP_DIGITS: usize = 6;
const MAX_VERSION_NUMERIC_GROUPS: usize = 4;
const MIN_VERSION_NUMERIC_GROUPS: usize = 2;
const MAX_VERSION_PRERELEASE_BYTES: usize = 32;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCliVersionProbeRequest {
    pub agent_cli_path: String,
    pub agent_cli_kind: AgentCliInvocation,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliBinaryFingerprint {
    pub size_bytes: u64,
    pub modified_epoch_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliVersionProbeResult {
    pub version: Option<String>,
    pub probed_at_epoch_ms: u64,
    pub binary_fingerprint: AgentCliBinaryFingerprint,
}

pub fn parse_agent_cli_version(output: &str) -> Option<String> {
    scanned_prefix(output)
        .split_whitespace()
        .find_map(version_candidate)
}

fn scanned_prefix(output: &str) -> &str {
    if output.len() <= MAX_AGENT_CLI_VERSION_OUTPUT_BYTES {
        return output;
    }
    let mut end = MAX_AGENT_CLI_VERSION_OUTPUT_BYTES;
    while end > 0 && !output.is_char_boundary(end) {
        end -= 1;
    }
    &output[..end]
}

fn version_candidate(token: &str) -> Option<String> {
    let trimmed = token
        .trim_start_matches(['(', '[', '{', '"', '\'', '='])
        .trim_end_matches([',', ')', ']', '}', ';', ':', '"', '\'']);
    let candidate = trimmed.strip_prefix('v').unwrap_or(trimmed);
    if !matches_version_grammar(candidate) {
        return None;
    }
    Some(candidate.to_string())
}

fn matches_version_grammar(candidate: &str) -> bool {
    if candidate.is_empty() || candidate.len() > MAX_AGENT_CLI_VERSION_BYTES {
        return false;
    }
    let (numeric, prerelease) = match candidate.split_once('-') {
        Some((numeric, prerelease)) => (numeric, Some(prerelease)),
        None => (candidate, None),
    };
    if !matches_numeric_groups(numeric) {
        return false;
    }
    let Some(prerelease) = prerelease else {
        return true;
    };
    if prerelease.is_empty() || prerelease.len() > MAX_VERSION_PRERELEASE_BYTES {
        return false;
    }
    prerelease
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
}

fn matches_numeric_groups(numeric: &str) -> bool {
    let mut groups = 0usize;
    for group in numeric.split('.') {
        groups += 1;
        if groups > MAX_VERSION_NUMERIC_GROUPS {
            return false;
        }
        if group.is_empty() || group.len() > MAX_VERSION_NUMERIC_GROUP_DIGITS {
            return false;
        }
        if !group.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    groups >= MIN_VERSION_NUMERIC_GROUPS
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AgentCliBinaryIdentity {
    device: u64,
    inode: u64,
}

#[cfg(not(unix))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AgentCliBinaryIdentity;

#[derive(Clone, Debug, PartialEq, Eq)]
struct AgentCliVersionCacheKey {
    canonical_path: PathBuf,
    identity: AgentCliBinaryIdentity,
    fingerprint: AgentCliBinaryFingerprint,
}

struct AgentCliVersionCacheEntry {
    key: AgentCliVersionCacheKey,
    result: AgentCliVersionProbeResult,
}

pub struct AgentCliVersionRegistry {
    entries: Mutex<VecDeque<AgentCliVersionCacheEntry>>,
    timeout: Duration,
}

impl Default for AgentCliVersionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentCliVersionRegistry {
    pub fn new() -> Self {
        Self::with_timeout(AGENT_CLI_VERSION_PROBE_TIMEOUT)
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
            timeout,
        }
    }

    pub fn probe(
        &self,
        request: &AgentCliVersionProbeRequest,
        now_epoch_ms: u64,
    ) -> Result<AgentCliVersionProbeResult, String> {
        let unavailable = || agent_cli_binary_unavailable_error(request.agent_cli_kind);
        let (program, metadata) =
            validated_binary(&request.agent_cli_path).ok_or_else(unavailable)?;
        let fingerprint = binary_fingerprint(&metadata).ok_or_else(unavailable)?;
        let key = AgentCliVersionCacheKey {
            canonical_path: program.clone(),
            identity: binary_identity(&metadata),
            fingerprint,
        };

        if let Some(cached) = self.cached(&key) {
            return Ok(cached);
        }

        let outcome = self.read_version(&program);
        let result = AgentCliVersionProbeResult {
            version: outcome.version(),
            probed_at_epoch_ms: now_epoch_ms,
            binary_fingerprint: fingerprint,
        };
        if let VersionProbeOutcome::Settled(_) = outcome {
            self.remember(key, result.clone());
        }

        Ok(result)
    }

    fn cached(&self, key: &AgentCliVersionCacheKey) -> Option<AgentCliVersionProbeResult> {
        let entries = self.entries.lock().ok()?;
        entries
            .iter()
            .find(|entry| &entry.key == key)
            .map(|entry| entry.result.clone())
    }

    fn remember(&self, key: AgentCliVersionCacheKey, result: AgentCliVersionProbeResult) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|entry| entry.key != key);
        entries.push_back(AgentCliVersionCacheEntry { key, result });
        while entries.len() > MAX_AGENT_CLI_VERSION_CACHE_ENTRIES {
            entries.pop_front();
        }
    }

    fn read_version(&self, program: &Path) -> VersionProbeOutcome {
        let Ok(mut child) = spawn_version_command(program) else {
            return VersionProbeOutcome::Unsettled;
        };
        let started = Instant::now();
        let process_group_id = i32::try_from(child.id()).ok();
        let stdout_reader = child.stdout.take().map(spawn_bounded_reader);
        let stderr_reader = child.stderr.take().map(spawn_bounded_reader);
        let settled = self.settle(&mut child, process_group_id, started);
        drop(child);
        let reader_deadline = started + self.timeout + AGENT_CLI_VERSION_READER_GRACE;
        let stdout = joined_stream(stdout_reader, reader_deadline);
        let stderr = joined_stream(stderr_reader, reader_deadline);
        let (Some(status), Some(stdout), Some(stderr)) = (settled, stdout, stderr) else {
            return VersionProbeOutcome::Unsettled;
        };
        if !status.success() {
            return VersionProbeOutcome::Settled(None);
        }
        VersionProbeOutcome::Settled(
            parse_agent_cli_version(&String::from_utf8_lossy(&stdout))
                .or_else(|| parse_agent_cli_version(&String::from_utf8_lossy(&stderr))),
        )
    }

    #[cfg(unix)]
    fn settle(
        &self,
        child: &mut Child,
        process_group_id: Option<i32>,
        started: Instant,
    ) -> Option<std::process::ExitStatus> {
        use crate::agent_task_spawner::{observe_exit_without_reaping, reap_child};

        loop {
            match observe_exit_without_reaping(child) {
                Err(_) => break,
                Ok(true) => {
                    kill_process_group(process_group_id);
                    return reap_child(child).ok();
                }
                Ok(false) => {}
            }
            if started.elapsed() >= self.timeout {
                break;
            }
            thread::sleep(AGENT_CLI_VERSION_POLL_INTERVAL);
        }
        kill_process_group(process_group_id);
        let _ = reap_child(child);
        None
    }

    #[cfg(not(unix))]
    fn settle(
        &self,
        child: &mut Child,
        _process_group_id: Option<i32>,
        started: Instant,
    ) -> Option<std::process::ExitStatus> {
        loop {
            match child.try_wait() {
                Err(_) => break,
                Ok(Some(status)) => return Some(status),
                Ok(None) => {}
            }
            if started.elapsed() >= self.timeout {
                break;
            }
            thread::sleep(AGENT_CLI_VERSION_POLL_INTERVAL);
        }
        let _ = child.kill();
        let _ = child.wait();
        None
    }
}

enum VersionProbeOutcome {
    Settled(Option<String>),
    Unsettled,
}

impl VersionProbeOutcome {
    fn version(&self) -> Option<String> {
        match self {
            Self::Settled(version) => version.clone(),
            Self::Unsettled => None,
        }
    }
}

fn spawn_version_command(program: &Path) -> std::io::Result<Child> {
    let cwd = program
        .parent()
        .map_or_else(|| PathBuf::from("/"), Path::to_path_buf);
    let mut command = Command::new(program);
    command
        .arg("--version")
        .current_dir(cwd)
        .env_clear()
        .envs(inherited_environment())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn()
}

#[cfg(unix)]
fn kill_process_group(process_group_id: Option<i32>) {
    let Some(process_group_id) = process_group_id else {
        return;
    };
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

fn validated_binary(cli_path: &str) -> Option<(PathBuf, fs::Metadata)> {
    if cli_path.is_empty() || cli_path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return None;
    }
    let program = Path::new(cli_path);
    if !program.is_absolute() {
        return None;
    }
    let metadata = fs::metadata(program).ok()?;
    if !metadata.is_file() || !is_executable(&metadata) {
        return None;
    }
    Some((fs::canonicalize(program).ok()?, metadata))
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

fn binary_fingerprint(metadata: &fs::Metadata) -> Option<AgentCliBinaryFingerprint> {
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some(AgentCliBinaryFingerprint {
        size_bytes: metadata.len(),
        modified_epoch_ms: u64::try_from(modified).ok()?,
    })
}

#[cfg(unix)]
fn binary_identity(metadata: &fs::Metadata) -> AgentCliBinaryIdentity {
    use std::os::unix::fs::MetadataExt;
    AgentCliBinaryIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(unix))]
fn binary_identity(_metadata: &fs::Metadata) -> AgentCliBinaryIdentity {
    AgentCliBinaryIdentity
}

fn spawn_bounded_reader<R: Read + Send + 'static>(reader: R) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut bounded = reader.take(MAX_AGENT_CLI_VERSION_OUTPUT_BYTES as u64);
        let _ = bounded.read_to_end(&mut buffer);
        buffer
    })
}

fn joined_stream(
    reader: Option<thread::JoinHandle<Vec<u8>>>,
    deadline: Instant,
) -> Option<Vec<u8>> {
    let Some(handle) = reader else {
        return Some(Vec::new());
    };
    while !handle.is_finished() {
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(AGENT_CLI_VERSION_POLL_INTERVAL);
    }
    handle.join().ok()
}

pub fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NONCE: AtomicU64 = AtomicU64::new(0);

    struct TempScripts {
        base: PathBuf,
    }

    impl TempScripts {
        fn create(label: &str) -> Self {
            let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
            let base = std::env::temp_dir().join(format!(
                "codevo-agent-cli-version-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&base).expect("create temp script directory");
            Self { base }
        }

        fn script(&self, name: &str, body: &str) -> PathBuf {
            let path = self.base.join(name);
            self.write_script(&path, body);
            path
        }

        fn write_script(&self, path: &Path, body: &str) {
            let mut handle = fs::File::create(path).expect("create script");
            handle
                .write_all(format!("#!/bin/sh\n{body}\n").as_bytes())
                .expect("write script");
            handle.sync_all().expect("flush script");
            drop(handle);
            set_executable(path);
        }

        fn plain_file(&self, name: &str) -> PathBuf {
            let path = self.base.join(name);
            fs::write(&path, "data").expect("write plain file");
            path
        }

        fn missing(&self, name: &str) -> PathBuf {
            self.base.join(name)
        }
    }

    impl Drop for TempScripts {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    #[cfg(unix)]
    fn set_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("mark executable");
    }

    #[cfg(not(unix))]
    fn set_executable(_path: &Path) {}

    fn request(path: &Path) -> AgentCliVersionProbeRequest {
        AgentCliVersionProbeRequest {
            agent_cli_path: path.to_string_lossy().into_owned(),
            agent_cli_kind: AgentCliInvocation::ClaudeCode,
        }
    }

    #[test]
    fn parses_the_first_version_token_of_representative_cli_banners() {
        assert_eq!(
            parse_agent_cli_version("2.1.245 (Claude Code)"),
            Some("2.1.245".to_string())
        );
        assert_eq!(
            parse_agent_cli_version("codex-cli 0.104.0"),
            Some("0.104.0".to_string())
        );
        assert_eq!(
            parse_agent_cli_version("codex-cli v1.2.3\n"),
            Some("1.2.3".to_string())
        );
        assert_eq!(
            parse_agent_cli_version("tool (version 4.5.6-beta.1)"),
            Some("4.5.6-beta.1".to_string())
        );
        assert_eq!(
            parse_agent_cli_version("release 1.2.3.4 shipped"),
            Some("1.2.3.4".to_string())
        );
    }

    #[test]
    fn rejects_tokens_outside_the_closed_version_grammar() {
        assert_eq!(parse_agent_cli_version(""), None);
        assert_eq!(parse_agent_cli_version("no version here"), None);
        assert_eq!(parse_agent_cli_version("1"), None);
        assert_eq!(parse_agent_cli_version("1."), None);
        assert_eq!(parse_agent_cli_version("1.2.3.4.5"), None);
        assert_eq!(parse_agent_cli_version("1234567.1"), None);
        assert_eq!(parse_agent_cli_version("1.2-"), None);
        assert_eq!(parse_agent_cli_version("1.2-rc_1"), None);
        assert_eq!(parse_agent_cli_version("a.b.c"), None);
        assert_eq!(
            parse_agent_cli_version(&format!("1.2-{}", "a".repeat(33))),
            None
        );
    }

    #[test]
    fn only_scans_the_bounded_output_prefix() {
        let padded = format!("{} 9.9.9", "x".repeat(MAX_AGENT_CLI_VERSION_OUTPUT_BYTES));

        assert_eq!(parse_agent_cli_version(&padded), None);
    }

    #[test]
    fn probes_a_parsable_version_from_the_binary() {
        let scripts = TempScripts::create("parsable");
        let script = scripts.script("claude", "echo '2.1.245 (Claude Code)'");
        let registry = AgentCliVersionRegistry::new();

        let probed = registry.probe(&request(&script), 100).expect("probe");

        assert_eq!(probed.version, Some("2.1.245".to_string()));
        assert_eq!(probed.probed_at_epoch_ms, 100);
        assert!(probed.binary_fingerprint.size_bytes > 0);
    }

    #[test]
    fn unparsable_output_and_failing_exits_resolve_to_no_version() {
        let scripts = TempScripts::create("garbage");
        let garbage = scripts.script("garbage", "echo 'no version at all'");
        let failing = scripts.script("failing", "echo '1.2.3'; exit 3");
        let registry = AgentCliVersionRegistry::new();

        assert_eq!(
            registry
                .probe(&request(&garbage), 1)
                .expect("probe")
                .version,
            None
        );
        assert_eq!(
            registry
                .probe(&request(&failing), 1)
                .expect("probe")
                .version,
            None
        );
    }

    #[test]
    fn reads_a_version_that_the_binary_prints_on_stderr() {
        let scripts = TempScripts::create("stderr");
        let script = scripts.script("stderr-cli", "echo 'codex-cli 0.104.0' 1>&2");
        let registry = AgentCliVersionRegistry::new();

        assert_eq!(
            registry.probe(&request(&script), 1).expect("probe").version,
            Some("0.104.0".to_string())
        );
    }

    #[test]
    fn missing_non_executable_and_relative_paths_fail_closed() {
        let scripts = TempScripts::create("closed");
        let missing = scripts.missing("absent");
        let plain = scripts.plain_file("plain");
        let registry = AgentCliVersionRegistry::new();
        let closed = agent_cli_binary_unavailable_error(AgentCliInvocation::ClaudeCode);

        assert_eq!(
            registry.probe(&request(&missing), 1).expect_err("missing"),
            closed
        );
        assert_eq!(
            registry
                .probe(&request(&plain), 1)
                .expect_err("non-executable"),
            closed
        );
        assert_eq!(
            registry
                .probe(
                    &AgentCliVersionProbeRequest {
                        agent_cli_path: "relative/claude".to_string(),
                        agent_cli_kind: AgentCliInvocation::ClaudeCode,
                    },
                    1
                )
                .expect_err("relative"),
            closed
        );
        assert_eq!(
            registry
                .probe(
                    &AgentCliVersionProbeRequest {
                        agent_cli_path: String::new(),
                        agent_cli_kind: AgentCliInvocation::ClaudeCode,
                    },
                    1
                )
                .expect_err("empty"),
            closed
        );
    }

    #[test]
    fn the_closed_failure_names_the_configured_provider() {
        let scripts = TempScripts::create("provider");
        let missing = scripts.missing("absent");
        let registry = AgentCliVersionRegistry::new();

        let codex = registry
            .probe(
                &AgentCliVersionProbeRequest {
                    agent_cli_path: missing.to_string_lossy().into_owned(),
                    agent_cli_kind: AgentCliInvocation::CodexExec,
                },
                1,
            )
            .expect_err("missing codex binary");

        assert_eq!(
            codex,
            agent_cli_binary_unavailable_error(AgentCliInvocation::CodexExec)
        );
        assert!(codex.contains("Codex"), "got: {codex}");
    }

    #[test]
    fn an_unchanged_binary_is_served_from_the_cache() {
        let scripts = TempScripts::create("cache-hit");
        let script = scripts.script("claude", "echo '2.1.245'");
        let registry = AgentCliVersionRegistry::new();

        let first = registry.probe(&request(&script), 100).expect("first probe");
        let second = registry
            .probe(&request(&script), 999_999)
            .expect("second probe");

        assert_eq!(first, second);
        assert_eq!(second.probed_at_epoch_ms, 100);
    }

    #[test]
    fn a_changed_binary_is_probed_again() {
        let scripts = TempScripts::create("cache-miss");
        let script = scripts.script("claude", "echo '2.1.245'");
        let registry = AgentCliVersionRegistry::new();

        let first = registry.probe(&request(&script), 100).expect("first probe");
        scripts.write_script(&script, "echo 'codex-cli 0.104.0 rebuilt binary payload'");
        let second = registry
            .probe(&request(&script), 200)
            .expect("second probe");

        assert_eq!(first.version, Some("2.1.245".to_string()));
        assert_eq!(second.version, Some("0.104.0".to_string()));
        assert_eq!(second.probed_at_epoch_ms, 200);
        assert_ne!(
            first.binary_fingerprint.size_bytes,
            second.binary_fingerprint.size_bytes
        );
    }

    #[test]
    fn the_cache_evicts_the_oldest_insertion_beyond_the_limit() {
        let scripts = TempScripts::create("evict");
        let registry = AgentCliVersionRegistry::new();
        let mut scripted = Vec::new();
        for index in 0..=MAX_AGENT_CLI_VERSION_CACHE_ENTRIES {
            let script = scripts.script(&format!("cli-{index}"), &format!("echo '1.0.{index}'"));
            registry.probe(&request(&script), 10).expect("probe");
            scripted.push(script);
        }

        let entries = registry.entries.lock().expect("cache lock");

        assert_eq!(entries.len(), MAX_AGENT_CLI_VERSION_CACHE_ENTRIES);
        assert!(
            !entries
                .iter()
                .any(|entry| entry.key.canonical_path.ends_with("cli-0")),
            "the oldest insertion must be evicted"
        );
    }

    #[test]
    fn a_hanging_process_group_is_killed_at_the_configured_timeout() {
        let scripts = TempScripts::create("timeout");
        let script = scripts.script("slow", "sleep 5 &\nwait");
        let registry = AgentCliVersionRegistry::with_timeout(Duration::from_millis(200));

        let started = Instant::now();
        let probed = registry.probe(&request(&script), 1).expect("probe");
        let elapsed = started.elapsed();

        assert_eq!(probed.version, None);
        assert!(elapsed < Duration::from_secs(2), "elapsed: {elapsed:?}");
    }

    #[test]
    fn an_orphaned_grandchild_never_keeps_the_probe_pipes_open() {
        let scripts = TempScripts::create("grandchild");
        let script = scripts.script("forking", "sleep 5 &\nsleep 5 &\nexec sleep 5");
        let registry = AgentCliVersionRegistry::with_timeout(Duration::from_millis(200));

        let started = Instant::now();
        let outcome = registry.read_version(&fs::canonicalize(&script).expect("canonical script"));
        let elapsed = started.elapsed();

        assert!(matches!(outcome, VersionProbeOutcome::Unsettled));
        assert!(elapsed < Duration::from_secs(2), "elapsed: {elapsed:?}");
    }

    #[cfg(unix)]
    fn detach_from_session_available() -> bool {
        Command::new("perl")
            .args(["-e", "use POSIX; exit(defined(&POSIX::setsid) ? 0 : 1)"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(unix)]
    #[test]
    fn a_grandchild_that_leaves_the_process_group_cannot_block_the_probe() {
        if !detach_from_session_available() {
            return;
        }
        let scripts = TempScripts::create("detached");
        let script = scripts.script(
            "detaching",
            "perl -e 'use POSIX; POSIX::setsid(); sleep 3' &\necho '1.2.3'\nexit 0",
        );
        let timeout = Duration::from_millis(200);
        let registry = AgentCliVersionRegistry::with_timeout(timeout);

        let started = Instant::now();
        let probed = registry.probe(&request(&script), 5).expect("probe");
        let elapsed = started.elapsed();
        let cached = registry.entries.lock().expect("cache lock").len();

        assert_eq!(probed.version, None);
        assert_eq!(cached, 0, "an abandoned reader must not be cached");
        assert!(
            elapsed < timeout + Duration::from_secs(1),
            "elapsed: {elapsed:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_replaced_inode_with_the_same_size_and_mtime_is_probed_again() {
        let scripts = TempScripts::create("inode");
        let script = scripts.script("claude", "echo '1.0.0'");
        let modified = fs::metadata(&script)
            .expect("metadata")
            .modified()
            .expect("mtime");
        let registry = AgentCliVersionRegistry::new();

        let first = registry.probe(&request(&script), 100).expect("first probe");
        let replacement = scripts.script("claude.next", "echo '2.0.0'");
        fs::rename(&replacement, &script).expect("replace binary");
        fs::File::options()
            .write(true)
            .open(&script)
            .expect("open replacement")
            .set_modified(modified)
            .expect("restore mtime");
        let second = registry
            .probe(&request(&script), 200)
            .expect("second probe");

        assert_eq!(first.binary_fingerprint, second.binary_fingerprint);
        assert_eq!(first.version, Some("1.0.0".to_string()));
        assert_eq!(second.version, Some("2.0.0".to_string()));
        assert_eq!(second.probed_at_epoch_ms, 200);
    }

    #[test]
    fn a_timed_out_probe_is_never_cached() {
        let scripts = TempScripts::create("timeout-cache");
        let hanging = scripts.script("hanging", "sleep 5 &\nwait");
        let registry = AgentCliVersionRegistry::with_timeout(Duration::from_millis(200));

        let first = registry.probe(&request(&hanging), 10).expect("probe");
        let cached = registry.entries.lock().expect("cache lock").len();
        let second = registry.probe(&request(&hanging), 20).expect("probe");

        assert_eq!(cached, 0, "a timeout must never be cached");
        assert_eq!(first.version, None);
        assert_eq!(first.probed_at_epoch_ms, 10);
        assert_eq!(
            second.probed_at_epoch_ms, 20,
            "a timed-out binary must be probed again"
        );
    }

    #[test]
    fn an_unparsable_exit_is_cached_once() {
        let scripts = TempScripts::create("exit-cache");
        let garbage = scripts.script("garbage", "echo 'no version at all'");
        let registry = AgentCliVersionRegistry::new();

        let first = registry.probe(&request(&garbage), 30).expect("probe");
        let cached = registry.entries.lock().expect("cache lock").len();
        let second = registry.probe(&request(&garbage), 40).expect("probe");

        assert_eq!(cached, 1, "an unparsable exit must be cached");
        assert_eq!(first.version, None);
        assert_eq!(first.probed_at_epoch_ms, 30);
        assert_eq!(
            second.probed_at_epoch_ms, 30,
            "an unparsable exit must be served from the cache"
        );
    }
}
