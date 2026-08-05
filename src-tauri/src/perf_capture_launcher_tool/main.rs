#![cfg(target_os = "macos")]

#[cfg(not(panic = "unwind"))]
compile_error!("The production capture launcher requires panic=unwind for RAII cleanup.");

use objc2::rc::Retained;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::{NSDate, NSRunLoop, NSURL};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::os::unix::process::CommandExt;
use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

const TERMINATE_GRACE: Duration = Duration::from_secs(8);
const FORCE_TERMINATE_GRACE: Duration = Duration::from_secs(4);
const MAX_ARGUMENT_BYTES: usize = 8 * 1024;
const MAX_BUNDLE_ENTRIES: usize = 65_536;
const MAX_BUNDLE_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BUNDLE_DEPTH: usize = 64;
const MAX_BUNDLE_RELATIVE_PATH_BYTES: usize = 4 * 1024;
const MAX_SHUTDOWN_PROOF_BYTES: u64 = 4 * 1024;
const PROCESS_OWNER_ENV: &str = "CODEVO_PERF_CAPTURE_PROCESS_OWNER";
const SHUTDOWN_PATH_ENV: &str = env!("CODEVO_PERF_CAPTURE_SHUTDOWN_PATH");
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

struct DirectChildOwnershipGuard {
    child: Option<process::Child>,
    authority: DirectCleanupAuthority,
}

enum DirectCleanupAuthority {
    Unbound,
    Expected(ExpectedRootProcessIdentity),
    Ledger(OwnedProcessLedger),
    TerminalProven,
}

impl DirectChildOwnershipGuard {
    fn new(child: process::Child) -> Self {
        Self {
            child: Some(child),
            authority: DirectCleanupAuthority::Unbound,
        }
    }

    fn child_mut(&mut self) -> Result<&mut process::Child, String> {
        self.child
            .as_mut()
            .ok_or_else(|| "The direct production capture child guard was disarmed.".to_owned())
    }

    fn capture_and_bind(&mut self) -> Result<ExpectedRootProcessIdentity, String> {
        let expected = ExpectedRootProcessIdentity::capture_direct(self.child_mut()?)?;
        self.authority = DirectCleanupAuthority::Expected(expected);
        let ledger = OwnedProcessLedger::new_unobserved(expected)?;
        self.authority = DirectCleanupAuthority::Ledger(ledger);
        let DirectCleanupAuthority::Ledger(ledger) = &mut self.authority else {
            unreachable!("the direct cleanup authority was just bound");
        };
        ledger.observe()?;
        Ok(expected)
    }

    fn bound_parts(&mut self) -> Result<(&mut process::Child, &mut OwnedProcessLedger), String> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| "The direct production capture child guard was disarmed.".to_owned())?;
        let DirectCleanupAuthority::Ledger(ledger) = &mut self.authority else {
            return Err("The direct production capture process ledger was not bound.".to_owned());
        };
        Ok((child, ledger))
    }

    fn mark_terminal_proven(mut self) {
        self.authority = DirectCleanupAuthority::TerminalProven;
        self.child.take();
    }
}

impl Drop for DirectChildOwnershipGuard {
    fn drop(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match &mut self.authority {
            DirectCleanupAuthority::Unbound => {
                let _ = terminate_unbound_child(child);
            }
            DirectCleanupAuthority::Expected(expected) => {
                let _ = terminate_bound_child(child, *expected);
            }
            DirectCleanupAuthority::Ledger(ledger) => {
                if !ledger.is_cleanup_finalized() {
                    let _ = ledger.terminate_and_prove_with_reaper(child);
                }
            }
            DirectCleanupAuthority::TerminalProven => {}
        }
    }
}

struct LedgerCheckpointSchedule {
    next_sample: Instant,
}

impl LedgerCheckpointSchedule {
    fn new() -> Self {
        Self {
            next_sample: Instant::now(),
        }
    }

    fn poll(&mut self, ledger: &mut OwnedProcessLedger) -> Result<(), String> {
        if Instant::now() >= self.next_sample {
            ledger.observe()?;
            self.next_sample = Instant::now() + Duration::from_millis(250);
        }
        Ok(())
    }

    fn force(&mut self, ledger: &mut OwnedProcessLedger) -> Result<(), String> {
        ledger.observe()?;
        self.next_sample = Instant::now() + Duration::from_millis(250);
        Ok(())
    }
}

#[derive(Debug)]
struct LaunchRequest {
    bundle_path: PathBuf,
    executable_path: PathBuf,
    expected_bundle_id: String,
    expected_sha256: String,
    expected_bundle_manifest_sha256: String,
    expected_dev: u64,
    expected_ino: u64,
    run_token: String,
    process_owner_tag: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ApplicationIdentity {
    pid: i32,
    pgid: i32,
    bundle_path: String,
    executable_path: String,
    bundle_id: String,
    launch_time_millis: i64,
}

mod process_ledger;
use process_ledger::{ExpectedRootProcessIdentity, OwnedProcessLedger};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyMessage<'a> {
    schema_version: u8,
    state: &'static str,
    run_token: &'a str,
    artifact_sha256: &'a str,
    bundle_manifest_sha256: &'a str,
    pid: i32,
    pgid: i32,
    bundle_path: &'a str,
    executable_path: &'a str,
    bundle_id: &'a str,
    launch_time_millis: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalMessage<'a> {
    schema_version: u8,
    state: &'static str,
    run_token: &'a str,
    bundle_manifest_sha256: &'a str,
    pid: Option<i32>,
    graceful: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShutdownProof {
    schema_version: u8,
    state: String,
    run_token: String,
    pid: u32,
    pgid: i32,
    capture_outcome: ShutdownCaptureOutcome,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum ShutdownCaptureOutcome {
    None,
    Error,
    Other,
}

fn main() {
    if let Err(error) = run() {
        let _ = writeln!(io::stderr(), "{error}");
        process::exit(70);
    }
}

fn run() -> Result<(), String> {
    install_signal_handlers()?;
    install_parent_eof_monitor();
    let request = parse_request(env::args_os().skip(1))?;
    if env::var(PROCESS_OWNER_ENV).as_deref() != Ok(request.process_owner_tag.as_str()) {
        return Err("The production capture process owner marker was rejected.".to_owned());
    }
    verify_artifact(&request)?;
    if STOP_REQUESTED.load(Ordering::Acquire) {
        return Err("The direct production capture launch was cancelled before spawn.".to_owned());
    }

    let mut command = Command::new(&request.executable_path);
    command
        .current_dir(&request.bundle_path)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    for (name, value) in launch_environment()? {
        command.env(name, value);
    }
    let mut ownership =
        DirectChildOwnershipGuard::new(command.spawn().map_err(|_| {
            "The exact production capture executable could not be spawned.".to_owned()
        })?);
    let pid = i32::try_from(ownership.child_mut()?.id())
        .map_err(|_| "The direct production capture PID exceeded its bound.".to_owned())?;
    let expected_process = ownership.capture_and_bind()?;

    let outcome = run_bound_direct_launch(&request, pid, expected_process, &mut ownership);
    if outcome.is_ok() {
        ownership.mark_terminal_proven();
    }
    outcome
}

fn run_bound_direct_launch(
    request: &LaunchRequest,
    pid: i32,
    expected_process: ExpectedRootProcessIdentity,
    ownership: &mut DirectChildOwnershipGuard,
) -> Result<(), String> {
    let (child, ledger) = ownership.bound_parts()?;
    let mut checkpoint_schedule = LedgerCheckpointSchedule::new();

    if STOP_REQUESTED.load(Ordering::Acquire) {
        return fail_direct_launch(
            request,
            child,
            ledger,
            "The direct production capture launch was cancelled after spawn.",
        );
    }
    let application_result =
        wait_for_direct_application(pid, expected_process, ledger, &mut checkpoint_schedule);
    let application = application_result
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    checkpoint_schedule
        .force(ledger)
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    let identity =
        inspect_direct_application(&application, pid, expected_process.start_time_millis())
            .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    verify_identity_fields(request, &identity, expected_process.start_time_millis())
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    checkpoint_schedule
        .force(ledger)
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    if STOP_REQUESTED.load(Ordering::Acquire) {
        return fail_direct_launch(
            request,
            child,
            ledger,
            "The direct production capture launch was cancelled before verification.",
        );
    }
    let verification_result = verify_artifact_with_checkpoint(request, &mut || {
        if STOP_REQUESTED.load(Ordering::Acquire) {
            return Err("The direct production capture launch was cancelled.".to_owned());
        }
        checkpoint_schedule.poll(ledger)
    });
    verification_result.or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    checkpoint_schedule
        .force(ledger)
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    let identity =
        inspect_direct_application(&application, pid, expected_process.start_time_millis())
            .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    verify_identity_fields(request, &identity, expected_process.start_time_millis())
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    checkpoint_schedule
        .force(ledger)
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    let owns_expected_process_group = expected_process
        .owns_expected_process_group()
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    if !owns_expected_process_group {
        return fail_direct_launch(
            request,
            child,
            ledger,
            "The direct production capture identity changed before ready.",
        );
    }
    publish_ready(request, &identity)
        .or_else(|message| fail_direct_launch(request, child, ledger, &message))?;
    supervise(request, &application, pid, ledger, child)
}

fn wait_for_direct_application(
    pid: i32,
    expected: ExpectedRootProcessIdentity,
    ledger: &mut OwnedProcessLedger,
    checkpoint_schedule: &mut LedgerCheckpointSchedule,
) -> Result<Retained<NSRunningApplication>, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        checkpoint_schedule.poll(ledger)?;
        if STOP_REQUESTED.load(Ordering::Acquire) {
            return Err(
                "The direct production capture launch was cancelled before registration."
                    .to_owned(),
            );
        }
        if !expected.owns_expected_process_group()? {
            return Err(
                "The direct production capture child left its expected process group.".to_owned(),
            );
        }
        if let Some(application) =
            NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        {
            checkpoint_schedule.force(ledger)?;
            let inspected =
                inspect_direct_application(&application, pid, expected.start_time_millis());
            checkpoint_schedule.force(ledger)?;
            if inspected.is_ok() {
                return Ok(application);
            }
        }
        if Instant::now() >= deadline {
            return Err(
                "The direct production capture child did not register with AppKit in time."
                    .to_owned(),
            );
        }
        run_main_loop_slice();
    }
}

fn terminate_unbound_child(child: &mut process::Child) -> Result<(), String> {
    let pid = i32::try_from(child.id())
        .map_err(|_| "The unbound direct production capture PID exceeded its bound.".to_owned())?;
    // The unreaped direct child retains its PID, so the atomically assigned PGID cannot be
    // reused while this exact group is signalled and all fast descendants are removed.
    let _ = unsafe { libc::kill(-pid, libc::SIGTERM) };
    thread::sleep(Duration::from_millis(250));
    let _ = unsafe { libc::kill(-pid, libc::SIGKILL) };
    if child.kill().is_err() {
        return match child.try_wait() {
            Ok(Some(_)) => Ok(()),
            _ => Err("The unbound direct production capture child could not be killed.".to_owned()),
        };
    }
    child
        .wait()
        .map(|_| ())
        .map_err(|_| "The unbound direct production capture child could not be reaped.".to_owned())
}

fn terminate_bound_child(
    child: &mut process::Child,
    expected: ExpectedRootProcessIdentity,
) -> Result<(), String> {
    match OwnedProcessLedger::new(expected) {
        Ok(mut ledger) => ledger.terminate_and_prove_with_reaper(child),
        Err(_) => terminate_unbound_child(child),
    }
}

fn parse_request(
    arguments: impl Iterator<Item = std::ffi::OsString>,
) -> Result<LaunchRequest, String> {
    let arguments = arguments.collect::<Vec<_>>();
    if arguments.len() != 9 {
        return Err("The production capture launcher requires exactly nine arguments.".to_owned());
    }
    if arguments
        .iter()
        .any(|value| value.as_encoded_bytes().len() > MAX_ARGUMENT_BYTES)
    {
        return Err("A production capture launcher argument exceeded its bound.".to_owned());
    }
    let bundle_path = canonical_path(&arguments[0], true)?;
    let executable_path = canonical_path(&arguments[1], false)?;
    if !executable_path.starts_with(&bundle_path) {
        return Err("The production capture executable escaped its application bundle.".to_owned());
    }
    let expected_bundle_id = argument_text(&arguments[2])?;
    let expected_sha256 = argument_text(&arguments[3])?.to_ascii_lowercase();
    let expected_bundle_manifest_sha256 = argument_text(&arguments[4])?.to_ascii_lowercase();
    let expected_dev = parse_u64(&arguments[5])?;
    let expected_ino = parse_u64(&arguments[6])?;
    let run_token = argument_text(&arguments[7])?;
    let process_owner_tag = argument_text(&arguments[8])?.to_ascii_lowercase();
    if !(32..=256).contains(&run_token.len())
        || !run_token.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("The production capture run token was rejected.".to_owned());
    }
    if expected_bundle_id.len() > 255
        || !expected_bundle_id.starts_with("dev.mockor.editor.perf.")
        || !expected_bundle_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
    {
        return Err("The production capture bundle identifier was rejected.".to_owned());
    }
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The production capture artifact digest was rejected.".to_owned());
    }
    if expected_bundle_manifest_sha256.len() != 64
        || !expected_bundle_manifest_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The production capture bundle manifest digest was rejected.".to_owned());
    }
    if process_owner_tag.len() != 64
        || !process_owner_tag
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The production capture process owner tag was rejected.".to_owned());
    }
    Ok(LaunchRequest {
        bundle_path,
        executable_path,
        expected_bundle_id,
        expected_sha256,
        expected_bundle_manifest_sha256,
        expected_dev,
        expected_ino,
        run_token,
        process_owner_tag,
    })
}

fn canonical_path(value: &std::ffi::OsStr, directory: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("Production capture launch paths must be absolute.".to_owned());
    }
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "A production capture launch path is unavailable.".to_owned())?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err("A production capture launch path has the wrong type.".to_owned());
    }
    fs::canonicalize(path)
        .map_err(|_| "A production capture launch path could not be canonicalized.".to_owned())
}

fn argument_text(value: &std::ffi::OsStr) -> Result<String, String> {
    value
        .to_str()
        .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(|| "A production capture launcher argument was rejected.".to_owned())
}

fn parse_u64(value: &std::ffi::OsStr) -> Result<u64, String> {
    argument_text(value)?
        .parse()
        .map_err(|_| "A production capture artifact identity was rejected.".to_owned())
}

#[cfg(unix)]
fn verify_artifact(request: &LaunchRequest) -> Result<(), String> {
    verify_artifact_with_checkpoint(request, &mut || Ok(()))
}

#[cfg(unix)]
fn verify_artifact_with_checkpoint(
    request: &LaunchRequest,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    checkpoint()?;
    let metadata = fs::symlink_metadata(&request.executable_path)
        .map_err(|_| "The production capture executable is unavailable.".to_owned())?;
    checkpoint()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_BUNDLE_FILE_BYTES
        || metadata.dev() != request.expected_dev
        || metadata.ino() != request.expected_ino
    {
        return Err("The production capture executable identity changed before launch.".to_owned());
    }
    let digest = sha256_file_with_checkpoint(
        &request.executable_path,
        request.expected_dev,
        request.expected_ino,
        metadata.len(),
        checkpoint,
    )?;
    if digest != request.expected_sha256 {
        return Err("The production capture executable digest changed before launch.".to_owned());
    }
    if application_bundle_manifest_digest_with_checkpoint(&request.bundle_path, checkpoint)?
        != request.expected_bundle_manifest_sha256
    {
        return Err("The production capture application bundle identity changed.".to_owned());
    }
    checkpoint()?;
    Ok(())
}

#[cfg(unix)]
#[derive(Clone, Copy)]
enum BundleEntryKind {
    Directory,
    File,
}

#[cfg(unix)]
struct BundleEntry {
    absolute_path: PathBuf,
    relative_path: String,
    kind: BundleEntryKind,
    dev: u64,
    ino: u64,
    uid: u32,
    gid: u32,
    mode: u32,
    ctime_seconds: i64,
    ctime_nanoseconds: i64,
    size: u64,
}

#[cfg(unix)]
fn application_bundle_manifest_digest_with_checkpoint(
    bundle_path: &Path,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<String, String> {
    let mut entries = Vec::new();
    let mut pending_children = 0_usize;
    collect_bundle_entry(
        bundle_path,
        ".",
        0,
        &mut entries,
        &mut pending_children,
        checkpoint,
    )?;
    let mut sort_failure = None;
    entries.sort_by(|left, right| {
        if sort_failure.is_none() {
            sort_failure = checkpoint().err();
        }
        left.relative_path
            .as_bytes()
            .cmp(right.relative_path.as_bytes())
    });
    if let Some(error) = sort_failure {
        return Err(error);
    }
    let mut total_bytes = 0_u64;
    let mut aggregate = Sha256::new();
    aggregate.update(b"codevo-application-bundle-v1\0");
    for entry in &entries {
        checkpoint()?;
        let content_digest = match entry.kind {
            BundleEntryKind::Directory => {
                verify_bundle_entry_metadata(
                    entry,
                    &fs::symlink_metadata(&entry.absolute_path).map_err(|_| {
                        "A production capture bundle entry became unavailable.".to_owned()
                    })?,
                )?;
                String::new()
            }
            BundleEntryKind::File => {
                total_bytes = total_bytes
                    .checked_add(entry.size)
                    .filter(|total| *total <= MAX_BUNDLE_TOTAL_BYTES)
                    .ok_or_else(|| {
                        "The production capture application bundle exceeded its total-byte bound."
                            .to_owned()
                    })?;
                sha256_exact_bundle_file(entry, checkpoint)?
            }
        };
        update_bundle_manifest_record(&mut aggregate, entry, &content_digest)?;
    }
    checkpoint()?;
    Ok(format!("{:x}", aggregate.finalize()))
}

fn update_bundle_manifest_record(
    aggregate: &mut Sha256,
    entry: &BundleEntry,
    content_digest: &str,
) -> Result<(), String> {
    aggregate.update(match entry.kind {
        BundleEntryKind::Directory => b"directory" as &[u8],
        BundleEntryKind::File => b"file" as &[u8],
    });
    aggregate.update(b"\0");
    aggregate.update(entry.relative_path.as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.dev.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.ino.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.uid.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.gid.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.mode.to_string().as_bytes());
    aggregate.update(b"\0");
    let ctime_ns = i128::from(entry.ctime_seconds)
        .checked_mul(1_000_000_000)
        .and_then(|value| value.checked_add(i128::from(entry.ctime_nanoseconds)))
        .ok_or_else(|| "A production capture bundle timestamp exceeded its bound.".to_owned())?;
    aggregate.update(ctime_ns.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(entry.size.to_string().as_bytes());
    aggregate.update(b"\0");
    aggregate.update(content_digest.as_bytes());
    aggregate.update(b"\0");
    Ok(())
}

#[cfg(unix)]
fn collect_bundle_entry(
    absolute_path: &Path,
    relative_path: &str,
    depth: usize,
    entries: &mut Vec<BundleEntry>,
    pending_children: &mut usize,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    checkpoint()?;
    if depth > MAX_BUNDLE_DEPTH {
        return Err(
            "The production capture application bundle exceeded its depth bound.".to_owned(),
        );
    }
    if relative_path.len() > MAX_BUNDLE_RELATIVE_PATH_BYTES {
        return Err(
            "The production capture application bundle contained an oversized path.".to_owned(),
        );
    }
    if entries.len().saturating_add(*pending_children) >= MAX_BUNDLE_ENTRIES {
        return Err(
            "The production capture application bundle exceeded its entry-count bound.".to_owned(),
        );
    }
    let metadata = fs::symlink_metadata(absolute_path)
        .map_err(|_| "A production capture bundle entry is unavailable.".to_owned())?;
    checkpoint()?;
    if metadata.file_type().is_symlink() {
        return Err(
            "The production capture application bundle contained a symbolic link.".to_owned(),
        );
    }
    let kind = if metadata.is_dir() {
        BundleEntryKind::Directory
    } else if metadata.is_file() {
        BundleEntryKind::File
    } else {
        return Err(
            "The production capture application bundle contained an unsupported filesystem entry."
                .to_owned(),
        );
    };
    let size = if matches!(kind, BundleEntryKind::File) {
        metadata.len()
    } else {
        0
    };
    if size > MAX_BUNDLE_FILE_BYTES {
        return Err(
            "The production capture application bundle contained an oversized file.".to_owned(),
        );
    }
    let entry_index = entries.len();
    entries.push(BundleEntry {
        absolute_path: absolute_path.to_owned(),
        relative_path: relative_path.to_owned(),
        kind,
        dev: metadata.dev(),
        ino: metadata.ino(),
        uid: metadata.uid(),
        gid: metadata.gid(),
        mode: metadata.mode() & 0o7777,
        ctime_seconds: metadata.ctime(),
        ctime_nanoseconds: metadata.ctime_nsec(),
        size,
    });
    if matches!(kind, BundleEntryKind::File) {
        return Ok(());
    }
    let remaining =
        MAX_BUNDLE_ENTRIES.saturating_sub(entries.len().saturating_add(*pending_children));
    let directory = fs::read_dir(absolute_path)
        .map_err(|_| "A production capture bundle directory could not be read.".to_owned())?;
    let mut children = Vec::new();
    for child in directory {
        checkpoint()?;
        if children.len() >= remaining {
            return Err(
                "The production capture application bundle exceeded its entry-count bound."
                    .to_owned(),
            );
        }
        children.push(
            child.map_err(|_| {
                "A production capture bundle directory could not be read.".to_owned()
            })?,
        );
    }
    *pending_children = pending_children
        .checked_add(children.len())
        .ok_or_else(|| {
            "The production capture application bundle exceeded its entry-count bound.".to_owned()
        })?;
    let mut sort_failure = None;
    children.sort_by(|left, right| {
        if sort_failure.is_none() {
            sort_failure = checkpoint().err();
        }
        left.file_name()
            .as_encoded_bytes()
            .cmp(right.file_name().as_encoded_bytes())
    });
    if let Some(error) = sort_failure {
        return Err(error);
    }
    for child in children {
        checkpoint()?;
        *pending_children = pending_children.saturating_sub(1);
        let name = child.file_name().into_string().map_err(|_| {
            "A production capture bundle entry name was not valid UTF-8.".to_owned()
        })?;
        if name.is_empty() || name == "." || name == ".." || name.contains('/') {
            return Err(
                "The production capture application bundle contained an invalid entry name."
                    .to_owned(),
            );
        }
        let child_relative = if relative_path == "." {
            name
        } else {
            format!("{relative_path}/{name}")
        };
        collect_bundle_entry(
            &child.path(),
            &child_relative,
            depth + 1,
            entries,
            pending_children,
            checkpoint,
        )?;
    }
    verify_bundle_entry_metadata(
        &entries[entry_index],
        &fs::symlink_metadata(absolute_path)
            .map_err(|_| "A production capture bundle directory became unavailable.".to_owned())?,
    )?;
    checkpoint()?;
    Ok(())
}

#[cfg(unix)]
fn sha256_exact_bundle_file(
    entry: &BundleEntry,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<String, String> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&entry.absolute_path)
        .map_err(|_| "A production capture bundle file could not be opened.".to_owned())?;
    verify_bundle_entry_metadata(
        entry,
        &file
            .metadata()
            .map_err(|_| "A production capture bundle file could not be inspected.".to_owned())?,
    )?;
    checkpoint()?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes_read = 0_u64;
    loop {
        checkpoint()?;
        let read = file
            .read(&mut buffer)
            .map_err(|_| "A production capture bundle file could not be read.".to_owned())?;
        if read == 0 {
            break;
        }
        bytes_read = bytes_read
            .checked_add(read as u64)
            .filter(|total| *total <= MAX_BUNDLE_FILE_BYTES)
            .ok_or_else(|| {
                "A production capture bundle file exceeded its read bound.".to_owned()
            })?;
        digest.update(&buffer[..read]);
    }
    verify_bundle_entry_metadata(
        entry,
        &file
            .metadata()
            .map_err(|_| "A production capture bundle file could not be inspected.".to_owned())?,
    )?;
    checkpoint()?;
    if bytes_read != entry.size {
        return Err("A production capture bundle file changed while reading.".to_owned());
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(unix)]
fn verify_bundle_entry_metadata(
    entry: &BundleEntry,
    metadata: &fs::Metadata,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let type_matches = match entry.kind {
        BundleEntryKind::Directory => metadata.is_dir(),
        BundleEntryKind::File => metadata.is_file(),
    };
    let size = if matches!(entry.kind, BundleEntryKind::File) {
        metadata.len()
    } else {
        0
    };
    if !type_matches
        || metadata.file_type().is_symlink()
        || metadata.dev() != entry.dev
        || metadata.ino() != entry.ino
        || metadata.uid() != entry.uid
        || metadata.gid() != entry.gid
        || (metadata.mode() & 0o7777) != entry.mode
        || metadata.ctime() != entry.ctime_seconds
        || metadata.ctime_nsec() != entry.ctime_nanoseconds
        || size != entry.size
    {
        return Err("A production capture bundle entry identity changed while reading.".to_owned());
    }
    Ok(())
}

fn sha256_file_with_checkpoint(
    path: &Path,
    dev: u64,
    ino: u64,
    expected_size: u64,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<String, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "The production capture executable could not be read.".to_owned())?;
    let before = file
        .metadata()
        .map_err(|_| "The production capture executable could not be inspected.".to_owned())?;
    checkpoint()?;
    if !before.is_file()
        || before.dev() != dev
        || before.ino() != ino
        || before.len() != expected_size
        || before.len() > MAX_BUNDLE_FILE_BYTES
    {
        return Err("The production capture executable identity changed while opening.".to_owned());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_u64;
    loop {
        checkpoint()?;
        let read = file
            .read(&mut buffer)
            .map_err(|_| "The production capture executable could not be read.".to_owned())?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .filter(|total| *total <= MAX_BUNDLE_FILE_BYTES)
            .ok_or_else(|| "The production capture executable exceeded its bound.".to_owned())?;
        hasher.update(&buffer[..read]);
    }
    let after = file
        .metadata()
        .map_err(|_| "The production capture executable could not be inspected.".to_owned())?;
    checkpoint()?;
    if total != expected_size
        || after.dev() != dev
        || after.ino() != ino
        || after.len() != expected_size
    {
        return Err("The production capture executable changed while reading.".to_owned());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn launch_environment() -> Result<Vec<(String, String)>, String> {
    const NAMES: &[&str] = &[
        "DEVELOPER_DIR",
        "HOME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TMPDIR",
        "USER",
        PROCESS_OWNER_ENV,
    ];
    let entries = NAMES
        .iter()
        .filter_map(|name| {
            env::var(name)
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| ((*name).to_owned(), value))
        })
        .collect::<Vec<_>>();
    let total_bytes = entries.iter().try_fold(0_usize, |total, (name, value)| {
        if value.len() > 4 * 1024 || value.chars().any(char::is_control) {
            return Err("A production capture launch environment value was rejected.".to_owned());
        }
        total
            .checked_add(name.len() + value.len())
            .filter(|total| *total <= 32 * 1024)
            .ok_or_else(|| {
                "The production capture launch environment exceeded its bound.".to_owned()
            })
    })?;
    if total_bytes == 0
        || !entries.iter().any(|(name, _)| name == "HOME")
        || !entries.iter().any(|(name, _)| name == "TMPDIR")
    {
        return Err("The production capture launch environment is incomplete.".to_owned());
    }
    Ok(entries)
}

fn inspect_direct_application(
    application: &NSRunningApplication,
    expected_pid: i32,
    start_time_millis: i64,
) -> Result<ApplicationIdentity, String> {
    let pid = application.processIdentifier();
    if pid != expected_pid || pid <= 0 || application.isTerminated() {
        return Err("AppKit returned a foreign or terminated direct application.".to_owned());
    }
    let bundle_path = url_path(application.bundleURL(), "bundle")?;
    let executable_path = url_path(application.executableURL(), "executable")?;
    let bundle_id = application
        .bundleIdentifier()
        .map(|value| value.to_string())
        .ok_or_else(|| "The direct application has no bundle identifier.".to_owned())?;
    let pgid = unsafe { libc::getpgid(pid) };
    if pgid != pid {
        return Err("The direct application left its exact process group.".to_owned());
    }
    Ok(ApplicationIdentity {
        pid,
        pgid,
        bundle_path,
        executable_path,
        bundle_id,
        launch_time_millis: start_time_millis,
    })
}

fn url_path(url: Option<Retained<NSURL>>, label: &str) -> Result<String, String> {
    let path = url
        .and_then(|url| url.path())
        .map(|path| path.to_string())
        .ok_or_else(|| format!("The launched application {label} URL is unavailable."))?;
    fs::canonicalize(&path)
        .ok()
        .and_then(|canonical| canonical.to_str().map(str::to_owned))
        .ok_or_else(|| format!("The launched application {label} URL is invalid."))
}

fn verify_identity_fields(
    request: &LaunchRequest,
    identity: &ApplicationIdentity,
    expected_start_time_millis: i64,
) -> Result<(), String> {
    if identity.bundle_path != path_text(&request.bundle_path)?
        || identity.executable_path != path_text(&request.executable_path)?
        || identity.bundle_id != request.expected_bundle_id
        || identity.pid <= 0
        || identity.pgid != identity.pid
        || identity.launch_time_millis != expected_start_time_millis
    {
        return Err("AppKit returned a foreign direct application identity.".to_owned());
    }
    Ok(())
}

fn publish_ready(request: &LaunchRequest, identity: &ApplicationIdentity) -> Result<(), String> {
    let message = ReadyMessage {
        schema_version: 1,
        state: "ready",
        run_token: &request.run_token,
        artifact_sha256: &request.expected_sha256,
        bundle_manifest_sha256: &request.expected_bundle_manifest_sha256,
        pid: identity.pid,
        pgid: identity.pgid,
        bundle_path: &identity.bundle_path,
        executable_path: &identity.executable_path,
        bundle_id: &identity.bundle_id,
        launch_time_millis: identity.launch_time_millis,
    };
    publish_message(&message)
}

fn supervise(
    request: &LaunchRequest,
    application: &NSRunningApplication,
    pid: i32,
    ledger: &mut OwnedProcessLedger,
    child: &mut process::Child,
) -> Result<(), String> {
    let outcome = supervise_owned(request, application, pid, ledger, child);
    let Err(primary) = outcome else {
        return Ok(());
    };

    let mut cleanup_failures = Vec::new();
    if let Err(error) = terminate_exact_application(application, ledger, child) {
        cleanup_failures.push(error);
    }
    if let Err(error) = ledger.observe() {
        cleanup_failures.push(format!(
            "The final process-ledger observation failed: {error}"
        ));
    }
    if let Err(error) = ledger.terminate_and_prove_with_reaper(child) {
        cleanup_failures.push(format!("Descendant cleanup failed: {error}"));
    }
    if cleanup_failures.is_empty() {
        Err(primary)
    } else {
        Err(format!(
            "{primary} Cleanup also failed: {}",
            cleanup_failures.join(" ")
        ))
    }
}

fn supervise_owned(
    request: &LaunchRequest,
    application: &NSRunningApplication,
    pid: i32,
    ledger: &mut OwnedProcessLedger,
    child: &mut process::Child,
) -> Result<(), String> {
    let mut checkpoint_schedule = LedgerCheckpointSchedule::new();
    let mut root_exited = ledger.root_child_exited_without_reaping(child)?;
    while !application.isTerminated() && !root_exited && !STOP_REQUESTED.load(Ordering::Acquire) {
        checkpoint_schedule.poll(ledger)?;
        run_main_loop_slice();
        root_exited = ledger.root_child_exited_without_reaping(child)?;
    }
    ledger.observe()?;
    root_exited = root_exited || ledger.root_child_exited_without_reaping(child)?;
    if application.isTerminated() || root_exited {
        return finish_graceful_capture(request, pid, ledger, child);
    }
    if !application.terminate() {
        if ledger.root_child_exited_without_reaping(child)? {
            return finish_graceful_capture(request, pid, ledger, child);
        }
        return force_terminate(request, application, pid, ledger, child);
    }
    if wait_until_terminated(application, TERMINATE_GRACE, ledger, child)? {
        ledger.observe()?;
        return finish_graceful_capture(request, pid, ledger, child);
    }
    force_terminate(request, application, pid, ledger, child)
}

fn finish_graceful_capture(
    request: &LaunchRequest,
    pid: i32,
    ledger: &mut OwnedProcessLedger,
    child: &mut process::Child,
) -> Result<(), String> {
    prove_graceful_capture_shutdown(request, pid, ledger, child)?;
    publish_message(&TerminalMessage {
        schema_version: 1,
        state: "terminated",
        run_token: &request.run_token,
        bundle_manifest_sha256: &request.expected_bundle_manifest_sha256,
        pid: Some(pid),
        graceful: true,
    })
}

fn terminate_exact_application(
    application: &NSRunningApplication,
    ledger: &mut OwnedProcessLedger,
    child: &process::Child,
) -> Result<(), String> {
    if application.isTerminated() {
        return Ok(());
    }
    let _ = application.terminate();
    if wait_until_terminated(application, TERMINATE_GRACE, ledger, child)? {
        return Ok(());
    }
    let _ = application.forceTerminate();
    if wait_until_terminated(application, FORCE_TERMINATE_GRACE, ledger, child)? {
        Ok(())
    } else {
        Err("The exact production capture application survived force termination.".to_owned())
    }
}

fn force_terminate(
    request: &LaunchRequest,
    application: &NSRunningApplication,
    pid: i32,
    ledger: &mut OwnedProcessLedger,
    child: &mut process::Child,
) -> Result<(), String> {
    let _ = application.forceTerminate();
    if !wait_until_terminated(application, FORCE_TERMINATE_GRACE, ledger, child)? {
        return Err(
            "The exact production capture application survived force termination.".to_owned(),
        );
    }
    if ledger.root_child_exited_without_reaping(child)? {
        return finish_graceful_capture(request, pid, ledger, child);
    }
    ledger.observe()?;
    ledger.terminate_and_prove_with_reaper(child)?;
    verify_artifact(request)?;
    publish_message(&TerminalMessage {
        schema_version: 1,
        state: "terminated",
        run_token: &request.run_token,
        bundle_manifest_sha256: &request.expected_bundle_manifest_sha256,
        pid: Some(pid),
        graceful: false,
    })?;
    Ok(())
}

fn fail_direct_launch<T>(
    request: &LaunchRequest,
    child: &mut process::Child,
    ledger: &mut OwnedProcessLedger,
    message: &str,
) -> Result<T, String> {
    let mut failures = Vec::new();
    if let Err(error) = ledger.terminate_and_prove_with_reaper(child) {
        failures.push(format!("Exact process-group cleanup failed: {error}"));
    }
    if let Err(error) = verify_artifact(request) {
        failures.push(format!("Artifact revalidation failed: {error}"));
    }
    if failures.is_empty() {
        Err(message.to_owned())
    } else {
        Err(format!(
            "{message} Cleanup also failed: {}",
            failures.join(" ")
        ))
    }
}

fn require_successful_capture_process_group(
    separate_group: Result<(), String>,
    capture_outcome: ShutdownCaptureOutcome,
) -> Result<(), String> {
    if capture_outcome == ShutdownCaptureOutcome::Error {
        Ok(())
    } else {
        separate_group
    }
}

fn prove_graceful_capture_shutdown(
    request: &LaunchRequest,
    pid: i32,
    ledger: &mut OwnedProcessLedger,
    child: &mut process::Child,
) -> Result<(), String> {
    let separate_group = ledger.require_capture_separate_group_observed();
    ledger.terminate_and_prove_with_reaper(child)?;
    let capture_outcome = verify_shutdown_proof(request, pid)?;
    require_successful_capture_process_group(separate_group, capture_outcome)?;
    verify_artifact(request)
}

fn verify_shutdown_proof(
    request: &LaunchRequest,
    pid: i32,
) -> Result<ShutdownCaptureOutcome, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let path = Path::new(SHUTDOWN_PATH_ENV);
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "The application exited without runtime cleanup proof.".to_owned())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_SHUTDOWN_PROOF_BYTES
    {
        return Err("The application runtime cleanup proof was rejected.".to_owned());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "The application runtime cleanup proof could not be opened.".to_owned())?;
    let opened = file
        .metadata()
        .map_err(|_| "The application runtime cleanup proof could not be inspected.".to_owned())?;
    if opened.dev() != metadata.dev()
        || opened.ino() != metadata.ino()
        || opened.len() != metadata.len()
    {
        return Err("The application runtime cleanup proof changed before opening.".to_owned());
    }
    let mut raw = Vec::with_capacity(opened.len() as usize);
    (&mut file)
        .take(MAX_SHUTDOWN_PROOF_BYTES + 1)
        .read_to_end(&mut raw)
        .map_err(|_| "The application runtime cleanup proof could not be read.".to_owned())?;
    if raw.len() as u64 > MAX_SHUTDOWN_PROOF_BYTES {
        return Err("The application runtime cleanup proof exceeded its bound.".to_owned());
    }
    let after = file
        .metadata()
        .map_err(|_| "The application runtime cleanup proof could not be inspected.".to_owned())?;
    if after.dev() != opened.dev() || after.ino() != opened.ino() || after.len() != opened.len() {
        return Err("The application runtime cleanup proof changed while reading.".to_owned());
    }
    let proof: ShutdownProof = serde_json::from_slice(&raw)
        .map_err(|_| "The application runtime cleanup proof was malformed.".to_owned())?;
    if proof.schema_version != 1
        || proof.state != "runtime-shutdown-requested"
        || proof.run_token != request.run_token
        || i32::try_from(proof.pid).ok() != Some(pid)
        || proof.pgid != pid
    {
        return Err("The application runtime cleanup proof changed ownership.".to_owned());
    }
    Ok(proof.capture_outcome)
}

fn wait_until_terminated(
    application: &NSRunningApplication,
    timeout: Duration,
    ledger: &mut OwnedProcessLedger,
    child: &process::Child,
) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    let mut checkpoint_schedule = LedgerCheckpointSchedule::new();
    while !application.isTerminated()
        && !ledger.root_child_exited_without_reaping(child)?
        && Instant::now() < deadline
    {
        checkpoint_schedule.poll(ledger)?;
        run_main_loop_slice();
    }
    checkpoint_schedule.force(ledger)?;
    Ok(application.isTerminated() || ledger.root_child_exited_without_reaping(child)?)
}

fn run_main_loop_slice() {
    let date = NSDate::dateWithTimeIntervalSinceNow(0.025);
    NSRunLoop::currentRunLoop().runUntilDate(&date);
}

fn publish_message(message: &impl Serialize) -> Result<(), String> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, message)
        .map_err(|_| "The launcher could not serialize its ownership state.".to_owned())?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|_| "The launcher could not publish its ownership state.".to_owned())
}

fn install_signal_handlers() -> Result<(), String> {
    unsafe extern "C" fn request_stop(_: libc::c_int) {
        STOP_REQUESTED.store(true, Ordering::Release);
    }
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
        if unsafe { libc::signal(signal, request_stop as *const () as libc::sighandler_t) }
            == libc::SIG_ERR
        {
            return Err("The launcher could not install its cleanup signal handlers.".to_owned());
        }
    }
    Ok(())
}

fn install_parent_eof_monitor() {
    thread::spawn(|| {
        let mut byte = [0_u8; 1];
        loop {
            match io::stdin().read(&mut byte) {
                Ok(0) | Err(_) => {
                    STOP_REQUESTED.store(true, Ordering::Release);
                    break;
                }
                Ok(_) => {
                    STOP_REQUESTED.store(true, Ordering::Release);
                }
            }
        }
    });
}

fn path_text(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "A production capture path is not valid UTF-8.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn ownership_guard_reaps_the_exact_group_when_bound_code_panics() {
        let mut pid = 0_i32;
        let unwind = catch_unwind(AssertUnwindSafe(|| {
            let mut command = Command::new("/bin/sleep");
            command
                .arg("60")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0);
            let child = command.spawn().expect("spawn guarded child");
            pid = i32::try_from(child.id()).expect("bounded child PID");
            let mut guard = DirectChildOwnershipGuard::new(child);
            guard.capture_and_bind().expect("bind guarded child");
            panic!("injected post-bind panic");
        }));

        assert!(
            unwind.is_err(),
            "the injected panic must unwind through the guard"
        );
        assert!(pid > 0);
        assert_eq!(unsafe { libc::kill(-pid, 0) }, -1);
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
        let mut status = 0;
        assert_eq!(
            unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }

    #[test]
    fn rust_bundle_manifest_record_contract_matches_the_shared_node_golden() {
        let mut digest = Sha256::new();
        digest.update(b"codevo-application-bundle-v1\0");
        for (relative_path, kind, ino, mode, ctime_nanoseconds, size, content) in [
            (".", BundleEntryKind::Directory, 2, 493, 0, 0, "".to_owned()),
            (
                "Contents/Info.plist",
                BundleEntryKind::File,
                3,
                420,
                1,
                5,
                "a".repeat(64),
            ),
            (
                "Contents/Resources/index.js",
                BundleEntryKind::File,
                4,
                420,
                2,
                7,
                "b".repeat(64),
            ),
        ] {
            let entry = BundleEntry {
                absolute_path: PathBuf::from(relative_path),
                relative_path: relative_path.to_owned(),
                kind,
                dev: 1,
                ino,
                uid: 501,
                gid: 20,
                mode,
                ctime_seconds: 1_700_000_000,
                ctime_nanoseconds,
                size,
            };
            update_bundle_manifest_record(&mut digest, &entry, &content)
                .expect("canonical manifest record");
        }
        assert_eq!(
            format!("{:x}", digest.finalize()),
            "a13d17934d6e4877c1ad52a3830be2b607016153ae11da15fa9933125cd3518e"
        );
    }

    #[test]
    fn request_rejects_foreign_bundle_identifier_and_short_token() {
        let arguments = [
            "/missing.app",
            "/missing.app/Contents/MacOS/app",
            "com.example.foreign",
            &"a".repeat(64),
            &"c".repeat(64),
            "1",
            "2",
            "short",
            &"b".repeat(64),
        ];
        assert!(parse_request(arguments.into_iter().map(Into::into)).is_err());
    }

    #[test]
    fn only_an_authenticated_error_outcome_may_finish_without_an_lsp_group() {
        let missing_group = || {
            Err(
                "The production capture never observed its required separate process group."
                    .to_owned(),
            )
        };

        assert!(require_successful_capture_process_group(
            missing_group(),
            ShutdownCaptureOutcome::Error
        )
        .is_ok());
        assert!(require_successful_capture_process_group(
            missing_group(),
            ShutdownCaptureOutcome::Other
        )
        .is_err());
        assert!(require_successful_capture_process_group(
            missing_group(),
            ShutdownCaptureOutcome::None
        )
        .is_err());
        assert!(
            require_successful_capture_process_group(Ok(()), ShutdownCaptureOutcome::Other).is_ok()
        );
    }

    #[test]
    fn shutdown_proof_outcome_is_closed_duplicate_safe_and_order_independent() {
        let reordered = format!(
            r#"{{"captureOutcome":"error","pgid":42,"pid":42,"runToken":"{TEST_TOKEN}","state":"runtime-shutdown-requested","schemaVersion":1}}"#
        );
        let proof: ShutdownProof =
            serde_json::from_str(&reordered).expect("reordered closed proof");
        assert_eq!(proof.capture_outcome, ShutdownCaptureOutcome::Error);

        for tampered in [
            format!(
                r#"{{"schemaVersion":1,"state":"runtime-shutdown-requested","runToken":"{TEST_TOKEN}","pid":42,"pgid":42}}"#
            ),
            format!(
                r#"{{"schemaVersion":1,"state":"runtime-shutdown-requested","runToken":"{TEST_TOKEN}","pid":42,"pgid":42,"captureOutcome":"error","extra":true}}"#
            ),
            format!(
                r#"{{"schemaVersion":1,"state":"runtime-shutdown-requested","runToken":"{TEST_TOKEN}","pid":42,"pgid":42,"captureOutcome":"other","captureOutcome":"error"}}"#
            ),
            format!(
                r#"{{"schemaVersion":1,"state":"runtime-shutdown-requested","runToken":"{TEST_TOKEN}","pid":42,"pgid":42,"captureOutcome":"success"}}"#
            ),
        ] {
            assert!(
                serde_json::from_str::<ShutdownProof>(&tampered).is_err(),
                "tampered proof must fail closed: {tampered}"
            );
        }
    }
}
