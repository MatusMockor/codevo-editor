use crate::debug_node_launch::{
    NativeNodeWatchLaunchPolicy, NodeExecutableFingerprint, NodeLaunchPlan, NodeLaunchProgram,
};
use crate::managed_javascript_typescript::node_executable_path;
use crate::terminal_task_process::TerminalTaskOwnership;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_OUTPUT_LIMIT: usize = 512 * 1024;
const MAX_NODE_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct NativeNodeWatchReadiness {
    program: NodeLaunchProgram,
    major: u8,
}

impl NativeNodeWatchReadiness {
    pub(crate) fn executable(&self) -> &Path {
        match &self.program {
            NodeLaunchProgram::ExactNode { canonical_path, .. }
            | NodeLaunchProgram::TrustedLiveNode { canonical_path, .. } => canonical_path,
            _ => unreachable!("readiness only owns verified Node programs"),
        }
    }

    pub(crate) fn bind(self, mut plan: NodeLaunchPlan) -> Result<NodeLaunchPlan, String> {
        if !matches!(plan.program, NodeLaunchProgram::Node) {
            return Err("Native Node watch launch plan has an invalid runtime owner.".to_string());
        }
        plan.program = self.program;
        Ok(plan)
    }

    pub(crate) fn into_program(self) -> NodeLaunchProgram {
        self.program
    }

    #[cfg(test)]
    pub(crate) fn major(&self) -> u8 {
        self.major
    }
}

/// Resolves and proves the exact executable that will later be spawned.
///
/// Claimed recipe metadata never establishes capability. The executable is
/// canonicalized once, its real version must equal the recipe major, and its
/// own bounded `--help` output must advertise every backend-owned watch flag.
pub(crate) fn probe_native_node_watch_readiness(
    policy: &NativeNodeWatchLaunchPolicy,
) -> Result<NativeNodeWatchReadiness, String> {
    let configured = node_executable_path().ok_or_else(|| {
        "Native Node watch is unavailable because no Node.js executable is configured.".to_string()
    })?;
    let (readiness, major) = probe_native_node_watch_executable(
        Path::new(&configured),
        policy.requests_preserve_output(),
    )?;
    if major != policy.runtime_major() {
        return Err(format!(
            "Native Node watch runtime mismatch: recipe requires Node.js {}, but the retained executable is Node.js {major}.",
            policy.runtime_major()
        ));
    }
    Ok(readiness)
}

pub(crate) fn discover_native_node_watch_readiness(
    script_path: String,
    preserve_output: bool,
) -> Result<(NativeNodeWatchLaunchPolicy, NativeNodeWatchReadiness), String> {
    let configured = node_executable_path().ok_or_else(|| {
        "Native Node watch is unavailable because no Node.js executable is configured.".to_string()
    })?;
    let (readiness, major) =
        probe_native_node_watch_executable(Path::new(&configured), preserve_output)?;
    let policy =
        NativeNodeWatchLaunchPolicy::from_detected_runtime(script_path, major, preserve_output)
            .map_err(str::to_string)?;
    Ok((policy, readiness))
}

fn probe_native_node_watch_executable(
    executable: &Path,
    preserve_output: bool,
) -> Result<(NativeNodeWatchReadiness, u8), String> {
    let canonical_path = executable.canonicalize().map_err(|_| {
        "Native Node watch is unavailable because the Node.js executable cannot be retained."
            .to_string()
    })?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let executable = Arc::new(options.open(&canonical_path).map_err(|_| {
        "Native Node watch is unavailable because the Node.js executable identity changed."
            .to_string()
    })?);
    if !executable
        .metadata()
        .map_err(|_| {
            "Native Node watch is unavailable because the Node.js executable cannot be inspected."
                .to_string()
        })?
        .is_file()
    {
        return Err(
            "Native Node watch is unavailable because the Node.js executable is not a file."
                .to_string(),
        );
    }

    let fingerprint = fingerprint_retained_executable(&executable)?;
    #[cfg(target_os = "linux")]
    let version = run_bounded_probe(Arc::clone(&executable), "--version")?;
    #[cfg(target_os = "linux")]
    let help = run_bounded_probe(Arc::clone(&executable), "--help")?;
    #[cfg(not(target_os = "linux"))]
    let version = run_bounded_path_probe(&canonical_path, &fingerprint, "--version")?;
    #[cfg(not(target_os = "linux"))]
    let help = run_bounded_path_probe(&canonical_path, &fingerprint, "--help")?;
    let major = validate_probe_output(preserve_output, &version, &help)?;
    verify_node_executable_fingerprint(&canonical_path, &fingerprint)?;
    #[cfg(target_os = "linux")]
    let program = NodeLaunchProgram::ExactNode {
        canonical_path,
        executable,
    };
    #[cfg(not(target_os = "linux"))]
    let program = NodeLaunchProgram::TrustedLiveNode {
        canonical_path,
        fingerprint,
    };
    Ok((NativeNodeWatchReadiness { program, major }, major))
}

#[cfg(not(target_os = "linux"))]
fn run_bounded_path_probe(
    canonical_path: &Path,
    fingerprint: &NodeExecutableFingerprint,
    argument: &str,
) -> Result<Vec<u8>, String> {
    verify_node_executable_fingerprint(canonical_path, fingerprint)?;
    let output = run_bounded_command(Command::new(canonical_path), argument)?;
    verify_node_executable_fingerprint(canonical_path, fingerprint)?;
    Ok(output)
}

pub(super) fn verify_node_executable_fingerprint(
    canonical_path: &Path,
    expected: &NodeExecutableFingerprint,
) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(canonical_path)
        .map_err(|_| "Native Node watch runtime identity changed before spawn.".to_string())?;
    let observed = fingerprint_retained_executable(&file)?;
    if &observed != expected {
        return Err("Native Node watch runtime identity changed before spawn.".to_string());
    }
    Ok(())
}

fn fingerprint_retained_executable(file: &File) -> Result<NodeExecutableFingerprint, String> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    let before = file.metadata().map_err(|_| {
        "Native Node watch runtime identity could not be fingerprinted.".to_string()
    })?;
    if !before.is_file() || before.len() > MAX_NODE_EXECUTABLE_BYTES {
        return Err(
            "Native Node watch runtime executable exceeds the fingerprint limit.".to_string(),
        );
    }
    let mut reader = file.try_clone().map_err(|_| {
        "Native Node watch runtime identity could not be fingerprinted.".to_string()
    })?;
    reader.seek(SeekFrom::Start(0)).map_err(|_| {
        "Native Node watch runtime identity could not be fingerprinted.".to_string()
    })?;
    let mut limited = reader.take(MAX_NODE_EXECUTABLE_BYTES + 1);
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = limited.read(&mut buffer).map_err(|_| {
            "Native Node watch runtime identity could not be fingerprinted.".to_string()
        })?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| "Native Node watch runtime fingerprint overflowed.".to_string())?;
        hasher.update(&buffer[..read]);
    }
    if copied != before.len() || copied > MAX_NODE_EXECUTABLE_BYTES {
        return Err("Native Node watch runtime changed while it was fingerprinted.".to_string());
    }
    let after = file.metadata().map_err(|_| {
        "Native Node watch runtime identity could not be fingerprinted.".to_string()
    })?;
    #[cfg(unix)]
    let fingerprint = NodeExecutableFingerprint {
        device: before.dev(),
        inode: before.ino(),
        length: before.len(),
        modified_seconds: before.mtime(),
        modified_nanoseconds: before.mtime_nsec(),
        sha256: hasher.finalize().into(),
    };
    #[cfg(not(unix))]
    let fingerprint = NodeExecutableFingerprint {
        device: 0,
        inode: 0,
        length: before.len(),
        modified_seconds: 0,
        modified_nanoseconds: 0,
        sha256: hasher.finalize().into(),
    };
    if after.len() != before.len() {
        return Err("Native Node watch runtime changed while it was fingerprinted.".to_string());
    }
    #[cfg(unix)]
    if after.dev() != before.dev()
        || after.ino() != before.ino()
        || after.mtime() != before.mtime()
        || after.mtime_nsec() != before.mtime_nsec()
    {
        return Err("Native Node watch runtime changed while it was fingerprinted.".to_string());
    }
    Ok(fingerprint)
}

fn validate_probe_output(preserve_output: bool, version: &[u8], help: &[u8]) -> Result<u8, String> {
    let major = parse_exact_node_major(version).ok_or_else(|| {
        "Native Node watch is unavailable because the Node.js version is invalid.".to_string()
    })?;
    require_flag(help, "--watch")?;
    if preserve_output {
        require_flag(help, "--watch-preserve-output")?;
    }
    Ok(major)
}

fn require_flag(help: &[u8], flag: &str) -> Result<(), String> {
    let advertised = String::from_utf8_lossy(help).lines().any(|line| {
        line.trim_start()
            .strip_prefix(flag)
            .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with(char::is_whitespace))
    });
    if advertised {
        Ok(())
    } else {
        Err(format!(
            "Native Node watch is unavailable because the retained Node.js executable does not advertise {flag}."
        ))
    }
}

fn parse_exact_node_major(output: &[u8]) -> Option<u8> {
    let version = std::str::from_utf8(output).ok()?.trim();
    let mut parts = version.strip_prefix('v')?.split('.');
    let major = parts.next()?.parse().ok()?;
    parts.next()?.parse::<u32>().ok()?;
    parts.next()?.parse::<u32>().ok()?;
    (parts.next().is_none()).then_some(major)
}

fn run_bounded_probe(executable: Arc<File>, argument: &str) -> Result<Vec<u8>, String> {
    let command = descriptor_executable_command(Arc::clone(&executable))?;
    run_bounded_command(command, argument)
}

fn run_bounded_command(mut command: Command, argument: &str) -> Result<Vec<u8>, String> {
    command
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| {
            format!(
                "Native Node watch is unavailable because the retained Node.js executable could not be probed: {error}"
            )
        })?;
    let process_group_id = i32::try_from(child.id()).map_err(|_| {
        let _ = child.kill();
        let _ = child.wait();
        "Native Node watch capability probe process identity is invalid.".to_string()
    })?;
    let ownership = TerminalTaskOwnership::new(0, 0, process_group_id);
    let Some(mut stdout) = child.stdout.take() else {
        let _ = ownership.wait_after_terminate(&mut child);
        return Err("Native Node watch capability probe has no output pipe.".to_string());
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bounded = (&mut stdout).take((PROBE_OUTPUT_LIMIT + 1) as u64);
        let mut output = Vec::new();
        let result = bounded.read_to_end(&mut output).map(|_| output);
        let _ = sender.send(result);
    });
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let success = loop {
        match ownership.try_wait(&mut child) {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = ownership.wait_after_terminate(&mut child);
                return Err("Native Node watch capability probe timed out.".to_string());
            }
            Err(_) => {
                let _ = ownership.wait_after_terminate(&mut child);
                return Err("Native Node watch capability probe could not be observed.".to_string());
            }
        }
    };
    let output = receiver
        .recv_timeout(Duration::from_secs(1))
        .map_err(|_| "Native Node watch capability probe output timed out.".to_string())?
        .map_err(|_| "Native Node watch capability probe output is invalid.".to_string())?;
    if !success {
        return Err("Native Node watch capability probe was rejected by Node.js.".to_string());
    }
    if output.len() > PROBE_OUTPUT_LIMIT {
        return Err("Native Node watch capability probe output exceeded its limit.".to_string());
    }
    Ok(output)
}

fn descriptor_executable_command(executable: Arc<File>) -> Result<Command, String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;

        let descriptor = executable.as_raw_fd();
        let program = PathBuf::from(format!("/proc/self/fd/{descriptor}"));
        let mut command = Command::new(program);
        unsafe {
            command.pre_exec(move || {
                let flags = libc::fcntl(descriptor, libc::F_GETFD);
                if flags < 0
                    || libc::fcntl(descriptor, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                // Keep the descriptor owner alive through fork and pre-exec.
                let _ = &executable;
                Ok(())
            });
        }
        Ok(command)
    }
    #[cfg(not(target_os = "linux"))]
    {
        drop(executable);
        Err(
            "Native Node watch is unavailable because this platform cannot atomically execute the retained Node.js executable."
                .to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    #[cfg(unix)]
    fn fake_node(version: &str, help: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "codevo-watch-runtime-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("runtime fixture");
        let executable = directory.join("node");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\ncase \"$1\" in\n  --version) printf '%s\\n' '{version}' ;;\n  --help) printf '%s\\n' '{help}' ;;\n  *) exit 2 ;;\nesac\n"
            ),
        )
        .expect("fake node");
        let mut permissions = fs::metadata(&executable).expect("metadata").permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&executable, permissions).expect("permissions");
        executable
    }

    #[test]
    fn exact_version_parser_rejects_claim_like_or_trailing_data() {
        assert_eq!(parse_exact_node_major(b"v22.17.1\n"), Some(22));
        for invalid in [
            b"22.17.1".as_slice(),
            b"v22".as_slice(),
            b"v22.1.0 claimed".as_slice(),
            b"v22.1.0.1".as_slice(),
        ] {
            assert_eq!(parse_exact_node_major(invalid), None);
        }
    }

    #[test]
    fn flag_matching_requires_an_exact_advertised_option() {
        assert!(require_flag(b"  --watch                 run in watch mode\n", "--watch").is_ok());
        assert!(require_flag(b"--watch\n", "--watch").is_ok());
        assert!(require_flag(b"--watch-path=...\n", "--watch").is_err());
        assert!(require_flag(b"text mentioning --watch later\n", "--watch").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn readiness_rejects_real_runtime_mismatch_and_missing_watch_capability() {
        let policy = NativeNodeWatchLaunchPolicy::for_test("/workspace/server.js".into(), 22)
            .expect("policy");
        let mismatch = fake_node("v24.1.0", "--watch run in watch mode");
        let mismatch_error =
            probe_native_node_watch_executable(&mismatch, false).expect("runtime probe");
        let mismatch_error = (mismatch_error.1 != policy.runtime_major())
            .then(|| {
                format!(
                    "Native Node watch runtime mismatch: recipe requires Node.js {}, but the retained executable is Node.js {}.",
                    policy.runtime_major(),
                    mismatch_error.1
                )
            })
            .expect("runtime mismatch");
        assert!(
            mismatch_error.contains("runtime mismatch"),
            "{mismatch_error}"
        );

        assert!(
            validate_probe_output(false, b"v22.1.0\n", b"--inspect enable inspector\n")
                .expect_err("missing watch")
                .contains("does not advertise --watch")
        );
        let _ = fs::remove_dir_all(mismatch.parent().expect("parent"));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn macos_readiness_probes_real_managed_node_through_trusted_live_boundary() {
        let runtime = PathBuf::from(node_executable_path().expect("real Node runtime"));
        let version = run_bounded_command(Command::new(&runtime), "--version").expect("version");
        let major = parse_exact_node_major(&version).expect("real Node version");
        let (readiness, detected_major) =
            probe_native_node_watch_executable(&runtime, false).expect("macOS readiness");
        assert_eq!(detected_major, major);
        assert_eq!(readiness.major(), major);
        assert!(matches!(
            readiness.program,
            NodeLaunchProgram::TrustedLiveNode { .. }
        ));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn trusted_live_runtime_rejects_path_replacement_after_readiness() {
        let runtime = fake_node("v22.1.0", "--watch run in watch mode");
        let (readiness, _) =
            probe_native_node_watch_executable(&runtime, false).expect("trusted live readiness");
        let NodeLaunchProgram::TrustedLiveNode {
            canonical_path,
            fingerprint,
        } = readiness.into_program()
        else {
            panic!("macOS readiness must use trusted live runtime");
        };
        let admitted = canonical_path.with_extension("admitted");
        fs::rename(&canonical_path, admitted).expect("move admitted runtime");
        fs::write(&canonical_path, "#!/bin/sh\nprintf 'v22.1.0\\n'\n")
            .expect("replacement runtime");
        let mut permissions = fs::metadata(&canonical_path)
            .expect("replacement metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&canonical_path, permissions).expect("replacement permissions");
        assert!(
            verify_node_executable_fingerprint(&canonical_path, &fingerprint)
                .expect_err("path replacement")
                .contains("identity changed")
        );
        let _ = fs::remove_dir_all(runtime.parent().expect("parent"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn readiness_binds_the_exact_canonical_executable() {
        let runtime = fake_node(
            "v22.1.0",
            "--watch run in watch mode\\n--watch-preserve-output preserve output",
        );
        let (readiness, _) =
            probe_native_node_watch_executable(&runtime, false).expect("readiness");
        assert_eq!(readiness.major(), 22);
        assert_eq!(readiness.executable(), runtime.canonicalize().unwrap());
        let _ = fs::remove_dir_all(runtime.parent().expect("parent"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_executable_cannot_be_redirected_by_a_path_swap_after_probe() {
        let runtime = fake_node("v22.1.0", "--watch run in watch mode");
        let (readiness, _) =
            probe_native_node_watch_executable(&runtime, false).expect("readiness");
        let NodeLaunchProgram::ExactNode {
            canonical_path,
            executable: retained,
        } = readiness.into_program()
        else {
            panic!("Linux readiness must retain executable descriptor");
        };
        let admitted = canonical_path.with_extension("admitted");
        fs::rename(&canonical_path, &admitted).expect("move admitted executable");
        fs::write(&canonical_path, "#!/bin/sh\nprintf 'v99.0.0\\n'\n")
            .expect("replacement executable");
        let mut permissions = fs::metadata(&canonical_path)
            .expect("replacement metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&canonical_path, permissions).expect("replacement permissions");

        assert_eq!(
            run_bounded_probe(retained, "--version").expect("retained probe"),
            b"v22.1.0\n"
        );
        let _ = fs::remove_dir_all(runtime.parent().expect("parent"));
    }

    #[cfg(unix)]
    #[test]
    fn probe_reaps_descendant_that_keeps_stdout_pipe_open() {
        let runtime = fake_node("v22.1.0", "--watch run in watch mode");
        fs::write(&runtime, "#!/bin/sh\n(sleep 30) &\nprintf 'v22.1.0\\n'\n")
            .expect("pipe holder executable");
        let mut permissions = fs::metadata(&runtime).expect("metadata").permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&runtime, permissions).expect("permissions");
        let started = Instant::now();
        assert_eq!(
            run_bounded_command(Command::new(&runtime), "--version").expect("bounded probe"),
            b"v22.1.0\n"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "descendant pipe holder must be killed before the reader is joined"
        );
        let _ = fs::remove_dir_all(runtime.parent().expect("parent"));
    }
}
