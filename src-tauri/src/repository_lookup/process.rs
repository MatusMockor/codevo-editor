use std::env;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use super::pipes::{read_streams, StreamLimits, StreamsResult};
use super::process_guard::{await_exit_without_reaping, ChildGuard, ProcessKillSwitch, Watchdog};

const INHERITED_ENVIRONMENT: [&str; 13] = [
    "USER",
    "XDG_CONFIG_HOME",
    "GH_CONFIG_DIR",
    "GLAB_CONFIG_DIR",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
    "ALL_PROXY",
    "all_proxy",
    "SSL_CERT_FILE",
];

#[cfg(target_os = "linux")]
const PLATFORM_ENVIRONMENT: [&str; 2] = ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"];

#[cfg(not(target_os = "linux"))]
const PLATFORM_ENVIRONMENT: [&str; 0] = [];

const FORCED_ENVIRONMENT: [(&str, &str); 5] = [
    ("NO_COLOR", "1"),
    ("GH_PROMPT_DISABLED", "1"),
    ("GH_NO_UPDATE_NOTIFIER", "1"),
    ("GLAB_CHECK_UPDATE", "false"),
    ("LC_ALL", "C"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProcessLimits {
    pub(crate) timeout: Duration,
    pub(crate) stdout_bytes: usize,
    pub(crate) stderr_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProcessError {
    TimedOut,
    OutputTooLarge,
    Io,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessOutput {
    pub(crate) success: bool,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

pub(crate) fn plan_command(
    executable: &Path,
    argv: &[String],
    home: &Path,
    search_path: &str,
) -> Command {
    let mut command = Command::new(executable);
    command
        .args(argv)
        .current_dir(home)
        .env_clear()
        .env("HOME", home)
        .env("PATH", search_path);
    for key in INHERITED_ENVIRONMENT
        .iter()
        .chain(PLATFORM_ENVIRONMENT.iter())
    {
        let Some(value) = env::var_os(key) else {
            continue;
        };
        command.env(key, value);
    }
    for (key, value) in FORCED_ENVIRONMENT {
        command.env(key, value);
    }
    command
}

pub(crate) fn run_bounded(
    command: Command,
    limits: ProcessLimits,
    kill: &ProcessKillSwitch,
) -> Result<ProcessOutput, ProcessError> {
    let mut guard = ChildGuard::spawn(command).map_err(|_| ProcessError::Io)?;
    let deadline = Instant::now() + limits.timeout;
    let registration = kill.register(guard.process_id());
    if !registration.accepted() {
        guard.kill();
    }
    let Some((stdout, stderr)) = guard.take_streams() else {
        return Err(ProcessError::Io);
    };
    let Ok(watchdog) = Watchdog::start(guard.process_id(), limits.timeout) else {
        guard.kill();
        drop(registration);
        let _ = guard.wait();
        return Err(ProcessError::Io);
    };

    let streams = read_streams(
        stdout,
        stderr,
        StreamLimits {
            stdout_bytes: limits.stdout_bytes,
            stderr_bytes: limits.stderr_bytes,
        },
        deadline,
    );
    if !matches!(streams, StreamsResult::Complete { .. }) {
        guard.kill();
    }

    let exited = await_exit_without_reaping(guard.process_id());
    let expired = watchdog.finish();
    drop(registration);
    if !exited {
        guard.kill();
    }
    let status = guard.wait();

    if expired || matches!(streams, StreamsResult::TimedOut) {
        return Err(ProcessError::TimedOut);
    }
    let (stdout, stderr) = match streams {
        StreamsResult::Complete { stdout, stderr } => (stdout, stderr),
        StreamsResult::TooLarge => return Err(ProcessError::OutputTooLarge),
        StreamsResult::TimedOut => return Err(ProcessError::TimedOut),
        StreamsResult::Failed => return Err(ProcessError::Io),
    };
    let status = status.map_err(|_| ProcessError::Io)?;
    Ok(ProcessOutput {
        success: status.success(),
        exit_code: status.code(),
        stdout,
        stderr,
    })
}
