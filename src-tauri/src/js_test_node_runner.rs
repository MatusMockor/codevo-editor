//! Private, composable foundation for Node's built-in `node:test` runner.
//!
//! The module deliberately has no Tauri command or global state. A future
//! application boundary must prove workspace trust and identity before calling
//! it. Discovery and plan construction are production-ready. Launch remains
//! fail-closed because stock Node accepts path names and recursively resolves an
//! import graph; this module cannot atomically bind that graph to retained
//! workspace descriptors across a path swap.

#[cfg(unix)]
use crate::terminal_task_process::TerminalTaskOwnership;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(crate) const MAX_PACKAGE_JSON_BYTES: u64 = 256 * 1024;
pub(crate) const MAX_SCRIPT_COUNT: usize = 128;
pub(crate) const MAX_SCRIPT_NAME_BYTES: usize = 128;
pub(crate) const MIN_SUPPORTED_NODE_MAJOR: u32 = 20;
pub(crate) const MAX_STREAM_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_RUN_DURATION: Duration = Duration::from_secs(120);
const MAX_VERSION_OUTPUT_BYTES: usize = 128;
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct NodeTestManifest {
    workspace_root: PathBuf,
    package_fingerprint: [u8; 32],
    script_names: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct NodeRuntimeCapability {
    executable: PathBuf,
    identity: FileIdentity,
    version: NodeVersion,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct NodeVersion {
    major: u32,
    minor: u32,
    patch: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum NodeTestScope {
    All,
    File {
        relative_file_path: String,
    },
    Test {
        relative_file_path: String,
        full_name: String,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct NodeTestRunPlan {
    executable: PathBuf,
    runtime_identity: FileIdentity,
    workspace_root: PathBuf,
    manifest: NodeTestManifest,
    args: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct FileIdentity {
    len: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct BoundedNodeTestStream {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum NodeTestRunStatus {
    Passed,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum NodeTestLaunchReadiness {
    Blocked { reason: &'static str },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct NodeTestRunOutput {
    pub(crate) status: NodeTestRunStatus,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: BoundedNodeTestStream,
    pub(crate) stderr: BoundedNodeTestStream,
}

impl NodeTestManifest {
    pub(crate) fn script_names(&self) -> &[String] {
        &self.script_names
    }
}

impl NodeTestRunPlan {
    pub(crate) fn args(&self) -> &[String] {
        &self.args
    }
}

pub(crate) fn node_test_launch_readiness() -> NodeTestLaunchReadiness {
    NodeTestLaunchReadiness::Blocked {
        reason: "Built-in Node test launch needs a retained descriptor-relative workspace/import-graph strategy.",
    }
}

/// Reads a package manifest through a bounded, no-follow file descriptor.
pub(crate) fn discover_node_test_manifest(
    workspace_root: &Path,
) -> Result<Option<NodeTestManifest>, String> {
    let root = canonical_directory(workspace_root, "JavaScript test workspace")?;
    let package_path = root.join("package.json");
    let mut file = match open_regular_nofollow(&package_path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to open package.json safely: {error}")),
    };
    let before = file
        .metadata()
        .map_err(|error| format!("Failed to inspect package.json: {error}"))?;
    if !before.is_file() {
        return Err("package.json must be a regular file.".to_string());
    }
    if before.len() > MAX_PACKAGE_JSON_BYTES {
        return Err(format!(
            "package.json exceeds the {MAX_PACKAGE_JSON_BYTES} byte safety limit."
        ));
    }

    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.by_ref()
        .take(MAX_PACKAGE_JSON_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    if bytes.len() as u64 > MAX_PACKAGE_JSON_BYTES {
        return Err(format!(
            "package.json grew past the {MAX_PACKAGE_JSON_BYTES} byte safety limit while being read."
        ));
    }
    let after = file
        .metadata()
        .map_err(|error| format!("Failed to revalidate package.json: {error}"))?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("package.json changed while it was being inspected.".to_string());
    }

    let package: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to parse package.json: {error}"))?;
    let Some(scripts) = package.get("scripts").and_then(Value::as_object) else {
        return Ok(None);
    };
    if scripts.len() > MAX_SCRIPT_COUNT {
        return Err(format!(
            "package.json scripts exceeds the {MAX_SCRIPT_COUNT} entry safety limit."
        ));
    }

    let mut script_names = scripts
        .iter()
        .filter(|(name, command)| {
            valid_script_name(name) && command.as_str().is_some_and(is_explicit_node_test_command)
        })
        .map(|(name, _command)| name.clone())
        .collect::<Vec<_>>();
    script_names.sort();
    let package_fingerprint = Sha256::digest(&bytes).into();
    Ok((!script_names.is_empty()).then_some(NodeTestManifest {
        workspace_root: root,
        package_fingerprint,
        script_names,
    }))
}

/// Proves an absolute canonical regular executable and an exact supported version.
#[cfg(unix)]
pub(crate) fn probe_node_runtime(executable: &Path) -> Result<NodeRuntimeCapability, String> {
    if !executable.is_absolute() {
        return Err("Node test runtime path must be absolute.".to_string());
    }
    let executable = executable
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Node test runtime: {error}"))?;
    let metadata = fs::metadata(&executable)
        .map_err(|error| format!("Failed to inspect Node test runtime: {error}"))?;
    if !metadata.is_file() {
        return Err("Node test runtime must be a regular file.".to_string());
    }

    let identity = file_identity(&metadata);
    let (status, stdout, stderr) = run_bounded_version_probe(&executable)?;
    if stdout.truncated || stderr.truncated {
        return Err("Node test runtime version response exceeds the safety limit.".to_string());
    }
    if !status.success() || !stderr.text.is_empty() {
        return Err("Node test runtime version probe failed.".to_string());
    }
    let version = parse_node_version(&stdout.text)
        .ok_or_else(|| "Node test runtime returned an unsupported version.".to_string())?;
    Ok(NodeRuntimeCapability {
        executable,
        identity,
        version,
    })
}

#[cfg(not(unix))]
pub(crate) fn probe_node_runtime(_executable: &Path) -> Result<NodeRuntimeCapability, String> {
    Err("Built-in Node test runtime probing requires Unix process-group ownership.".to_string())
}

pub(crate) fn build_node_test_run_plan(
    workspace_root: &Path,
    manifest: &NodeTestManifest,
    capability: &NodeRuntimeCapability,
    scope: &NodeTestScope,
) -> Result<NodeTestRunPlan, String> {
    if capability.version.major < MIN_SUPPORTED_NODE_MAJOR {
        return Err(format!(
            "Node {MIN_SUPPORTED_NODE_MAJOR} or newer is required for the built-in test runner."
        ));
    }
    let executable = capability
        .executable
        .canonicalize()
        .map_err(|error| format!("Node test runtime is unavailable: {error}"))?;
    if executable != capability.executable {
        return Err("Node test runtime identity changed after probing.".to_string());
    }
    let runtime_metadata = fs::metadata(&executable)
        .map_err(|error| format!("Failed to revalidate Node test runtime: {error}"))?;
    if !runtime_metadata.is_file() {
        return Err("Node test runtime must remain a regular file.".to_string());
    }
    if file_identity(&runtime_metadata) != capability.identity {
        return Err("Node test runtime identity changed after probing.".to_string());
    }

    let root = canonical_directory(workspace_root, "JavaScript test workspace")?;
    if root != manifest.workspace_root {
        return Err("Node test manifest belongs to a different workspace.".to_string());
    }
    let mut args = vec![
        "--test".to_string(),
        "--test-reporter=tap".to_string(),
        "--test-reporter-destination=stdout".to_string(),
    ];
    match scope {
        NodeTestScope::All => {}
        NodeTestScope::File { relative_file_path } => {
            args.push(prove_test_file(&root, relative_file_path)?);
        }
        NodeTestScope::Test {
            relative_file_path,
            full_name,
        } => {
            if full_name.is_empty()
                || full_name.len() > 4_096
                || full_name.chars().any(is_unsafe_text_character)
            {
                return Err("Node test name is invalid.".to_string());
            }
            args.push(format!(
                "--test-name-pattern=^{}$",
                escape_regex_literal(full_name)
            ));
            args.push(prove_test_file(&root, relative_file_path)?);
        }
    }
    Ok(NodeTestRunPlan {
        executable,
        runtime_identity: capability.identity.clone(),
        workspace_root: root,
        manifest: manifest.clone(),
        args,
    })
}

/// Non-production execution proof. The public readiness boundary above remains
/// blocked until a retained descriptor-relative launch strategy exists.
#[cfg(all(test, unix))]
pub(crate) fn run_node_test_plan(
    plan: &NodeTestRunPlan,
    timeout: Duration,
    cancellation: Arc<AtomicBool>,
) -> Result<NodeTestRunOutput, String> {
    if timeout.is_zero() || timeout > MAX_RUN_DURATION {
        return Err("Node test run timeout is outside the supported range.".to_string());
    }
    let root = canonical_directory(&plan.workspace_root, "JavaScript test workspace")?;
    if root != plan.workspace_root {
        return Err("JavaScript test workspace identity changed before launch.".to_string());
    }
    let executable = plan
        .executable
        .canonicalize()
        .map_err(|error| format!("Node test runtime is unavailable before launch: {error}"))?;
    if executable != plan.executable {
        return Err("Node test runtime identity changed before launch.".to_string());
    }
    let runtime_metadata = fs::metadata(&executable).map_err(|error| {
        format!("Failed to revalidate Node test runtime before launch: {error}")
    })?;
    if !runtime_metadata.is_file() || file_identity(&runtime_metadata) != plan.runtime_identity {
        return Err("Node test runtime identity changed before launch.".to_string());
    }
    let manifest = discover_node_test_manifest(&root)?
        .ok_or_else(|| "Node test manifest opt-in disappeared before launch.".to_string())?;
    if manifest != plan.manifest {
        return Err("Node test manifest changed before launch.".to_string());
    }

    let mut command = Command::new(&executable);
    command
        .args(&plan.args)
        .current_dir(&root)
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start Node test runner: {error}"))?;
    let mut process = OwnedProcess::new(child);
    let stdout = process
        .child_mut()
        .stdout
        .take()
        .ok_or_else(|| "Node test runner stdout pipe is unavailable.".to_string())?;
    let stderr = process
        .child_mut()
        .stderr
        .take()
        .ok_or_else(|| "Node test runner stderr pipe is unavailable.".to_string())?;
    let stdout_thread = thread::spawn(move || read_stream_bounded(stdout));
    let stderr_thread = thread::spawn(move || read_stream_bounded(stderr));

    let started = Instant::now();
    let completion = loop {
        if cancellation.load(Ordering::Acquire) {
            break process
                .kill_reap()
                .map(|status| (NodeTestRunStatus::Cancelled, status))
                .map_err(|error| format!("Failed to reap cancelled Node test runner: {error}"));
        }
        if started.elapsed() >= timeout {
            break process
                .kill_reap()
                .map(|status| (NodeTestRunStatus::TimedOut, status))
                .map_err(|error| format!("Failed to reap timed-out Node test runner: {error}"));
        }
        match poll_owned_process_with(&mut process, OwnedProcess::try_wait) {
            Ok(Some(exit_status)) => {
                let status = if exit_status.success() {
                    NodeTestRunStatus::Passed
                } else {
                    NodeTestRunStatus::Failed
                };
                break Ok((status, exit_status));
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                break Err(format!("Failed to poll Node test runner: {error}"));
            }
        }
    };
    if completion.is_err() {
        let _ = process.kill_reap();
    }

    let stdout_result = join_stream(stdout_thread, "stdout");
    let stderr_result = join_stream(stderr_thread, "stderr");
    let (status, exit_status) = completion?;
    let stdout = stdout_result?;
    let stderr = stderr_result?;
    Ok(NodeTestRunOutput {
        status,
        exit_code: exit_status.code(),
        stdout,
        stderr,
    })
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("{label} is unavailable: {error}"))?;
    if !fs::metadata(&canonical)
        .map_err(|error| format!("Failed to inspect {label}: {error}"))?
        .is_dir()
    {
        return Err(format!("{label} must be a directory."));
    }
    Ok(canonical)
}

fn valid_script_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_SCRIPT_NAME_BYTES
        && !name.chars().any(is_unsafe_text_character)
}

fn is_explicit_node_test_command(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty()
        || trimmed.chars().any(is_unsafe_text_character)
        || trimmed
            .chars()
            .any(|character| ";&|`$><()".contains(character))
    {
        return false;
    }
    let mut tokens = trimmed.split_ascii_whitespace();
    matches!(tokens.next(), Some("node" | "node.exe")) && tokens.next() == Some("--test")
}

fn parse_node_version(value: &str) -> Option<NodeVersion> {
    let value = value.strip_suffix('\n').unwrap_or(value);
    let value = value.strip_suffix('\r').unwrap_or(value);
    let value = value.strip_prefix('v')?;
    let mut parts = value.split('.');
    let version = NodeVersion {
        major: parts.next()?.parse().ok()?,
        minor: parts.next()?.parse().ok()?,
        patch: parts.next()?.parse().ok()?,
    };
    if parts.next().is_some() || version.major < MIN_SUPPORTED_NODE_MAJOR {
        return None;
    }
    Some(version)
}

fn prove_test_file(root: &Path, relative_path: &str) -> Result<String, String> {
    let normalized = normalized_relative_path(relative_path)?;
    let candidate = root.join(&normalized);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Node test file is unavailable: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("Node test file escapes the workspace.".to_string());
    }
    if !fs::metadata(&canonical)
        .map_err(|error| format!("Failed to inspect Node test file: {error}"))?
        .is_file()
    {
        return Err("Node test target must be a regular file.".to_string());
    }
    let extension = canonical.extension().and_then(|value| value.to_str());
    if !matches!(extension, Some("js" | "mjs" | "cjs")) {
        return Err(
            "Built-in Node test execution currently requires a .js, .mjs, or .cjs file."
                .to_string(),
        );
    }
    Ok(normalized)
}

fn normalized_relative_path(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 16 * 1024
        || value.chars().any(is_unsafe_text_character)
        || Path::new(value).is_absolute()
    {
        return Err("Node test file path is invalid.".to_string());
    }
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.components().any(|component| {
        !matches!(component, Component::Normal(_))
            || component
                .as_os_str()
                .to_str()
                .is_none_or(|segment| segment.is_empty())
    }) {
        return Err("Node test file path must stay inside the workspace.".to_string());
    }
    Ok(normalized)
}

fn escape_regex_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if "\\^$.*+?()[]{}|/".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn is_unsafe_text_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{2028}'
                | '\u{2029}'
                | '\u{202a}'..='\u{202e}'
                | '\u{2066}'..='\u{2069}'
        )
}

fn read_stream_bounded(mut stream: impl Read) -> io::Result<BoundedNodeTestStream> {
    read_stream_with_limit(&mut stream, MAX_STREAM_BYTES)
}

fn read_stream_with_limit(
    mut stream: impl Read,
    limit: usize,
) -> io::Result<BoundedNodeTestStream> {
    let mut retained = Vec::with_capacity(limit.min(8 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        let keep = remaining.min(read);
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < read;
    }
    Ok(BoundedNodeTestStream {
        text: String::from_utf8_lossy(&retained).into_owned(),
        truncated,
    })
}

#[cfg(unix)]
fn run_bounded_version_probe(
    executable: &Path,
) -> Result<
    (
        std::process::ExitStatus,
        BoundedNodeTestStream,
        BoundedNodeTestStream,
    ),
    String,
> {
    let mut command = Command::new(executable);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Failed to probe Node test runtime: {error}"))?;
    let mut process = OwnedProcess::new(child);
    let stdout = process
        .child_mut()
        .stdout
        .take()
        .ok_or_else(|| "Node runtime probe stdout pipe is unavailable.".to_string())?;
    let stderr = process
        .child_mut()
        .stderr
        .take()
        .ok_or_else(|| "Node runtime probe stderr pipe is unavailable.".to_string())?;
    let stdout_thread =
        thread::spawn(move || read_stream_with_limit(stdout, MAX_VERSION_OUTPUT_BYTES));
    let stderr_thread =
        thread::spawn(move || read_stream_with_limit(stderr, MAX_VERSION_OUTPUT_BYTES));
    let started = Instant::now();
    let completion = loop {
        if started.elapsed() >= VERSION_PROBE_TIMEOUT {
            let _ = process.kill_reap();
            break Err("Node test runtime version probe timed out.".to_string());
        }
        match poll_owned_process_with(&mut process, OwnedProcess::try_wait) {
            Ok(Some(status)) => {
                break Ok(status);
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                let _ = process.kill_reap();
                break Err(format!(
                    "Failed to poll Node runtime version probe: {error}"
                ));
            }
        }
    };
    let stdout_result = join_stream(stdout_thread, "version stdout");
    let stderr_result = join_stream(stderr_thread, "version stderr");
    Ok((completion?, stdout_result?, stderr_result?))
}

fn file_identity(metadata: &fs::Metadata) -> FileIdentity {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    FileIdentity {
        len: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
    }
}

fn join_stream(
    handle: thread::JoinHandle<io::Result<BoundedNodeTestStream>>,
    name: &str,
) -> Result<BoundedNodeTestStream, String> {
    handle
        .join()
        .map_err(|_| format!("Node test runner {name} collector panicked."))?
        .map_err(|error| format!("Failed to collect Node test runner {name}: {error}"))
}

#[cfg(unix)]
struct OwnedProcess {
    child: Option<Child>,
    ownership: TerminalTaskOwnership,
}

#[cfg(unix)]
impl OwnedProcess {
    fn new(child: Child) -> Self {
        let process_group = child.id() as i32;
        Self {
            ownership: TerminalTaskOwnership::new(1, 1, process_group),
            child: Some(child),
        }
    }

    fn child_mut(&mut self) -> &mut Child {
        self.child
            .as_mut()
            .expect("owned process must remain armed")
    }

    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        let ownership = &self.ownership;
        let child = self
            .child
            .as_mut()
            .expect("owned process must remain armed");
        let status = ownership.try_wait(child)?;
        if status.is_some() {
            self.child.take();
        }
        Ok(status)
    }

    fn kill_reap(&mut self) -> io::Result<ExitStatus> {
        let Some(mut child) = self.child.take() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "owned process is already reaped",
            ));
        };
        self.ownership.terminate();
        match self.ownership.wait_after_terminate(&mut child) {
            Ok(status) => Ok(status),
            Err(error) => {
                self.child = Some(child);
                Err(error)
            }
        }
    }
}

#[cfg(unix)]
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        let _ = self.kill_reap();
    }
}

#[cfg(unix)]
fn poll_owned_process_with<F>(
    process: &mut OwnedProcess,
    mut poll: F,
) -> io::Result<Option<ExitStatus>>
where
    F: FnMut(&mut OwnedProcess) -> io::Result<Option<ExitStatus>>,
{
    poll(process)
}

#[cfg(unix)]
fn open_regular_nofollow(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_regular_nofollow(path: &Path) -> io::Result<File> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symbolic links are not supported",
        ));
    }
    OpenOptions::new().read(true).open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detector_grammar_matches_the_renderer_contract() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../src/domain/nodeBuiltInTestRunner.fixtures.json"
        ))
        .expect("parse shared fixtures");
        for fixture in fixtures["commands"].as_array().expect("command fixtures") {
            let command = fixture["command"].as_str().expect("command");
            let expected = fixture["supported"].as_bool().expect("supported");
            assert_eq!(
                is_explicit_node_test_command(command),
                expected,
                "{command}"
            );
        }
    }

    #[test]
    fn version_parser_is_exact_and_fail_closed() {
        assert_eq!(
            parse_node_version("v20.13.1\n"),
            Some(NodeVersion {
                major: 20,
                minor: 13,
                patch: 1
            })
        );
        for unsupported in ["v18.20.0\n", "node v22.0.0", "v22.0.0-rc.1", "v22.0\n"] {
            assert_eq!(parse_node_version(unsupported), None, "{unsupported}");
        }
    }

    #[test]
    fn named_test_pattern_is_literal_and_anchored() {
        assert_eq!(
            escape_regex_literal("suite [one] / works?"),
            r"suite \[one\] \/ works\?"
        );
    }

    #[test]
    fn stream_collector_drains_but_retains_only_its_exact_limit() {
        let output = read_stream_with_limit("abcdefgh".as_bytes(), 4).expect("collect");
        assert_eq!(
            output,
            BoundedNodeTestStream {
                text: "abcd".to_string(),
                truncated: true
            }
        );
        let boundary = read_stream_with_limit("abcd".as_bytes(), 4).expect("collect boundary");
        assert_eq!(
            boundary,
            BoundedNodeTestStream {
                text: "abcd".to_string(),
                truncated: false
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn owned_process_guard_reaps_after_an_injected_poll_error() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 60"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("spawn child");
        let pid = child.id() as i32;
        let mut process = OwnedProcess::new(child);
        let error = poll_owned_process_with(&mut process, |_process| {
            Err(io::Error::other("injected poll failure"))
        })
        .expect_err("injected failure");
        assert_eq!(error.kind(), io::ErrorKind::Other);
        drop(process);

        let alive = unsafe { libc::kill(pid, 0) };
        assert_eq!(alive, -1, "guard must reap the exact child");
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    }
}
