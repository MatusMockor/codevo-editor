use crate::git_worktree::read_bounded_stream;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

pub const MAX_INTEGRATION_STDERR_BYTES: usize = 8 * 1024;
const GENERIC_FAILURE_MESSAGE: &str = "The git command failed.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandError {
    TimedOut(Duration),
    Failed(String),
    Io(String),
}

impl CommandError {
    pub fn into_message(self) -> String {
        match self {
            Self::TimedOut(timeout) => {
                format!(
                    "The git command timed out after {} seconds.",
                    timeout.as_secs()
                )
            }
            Self::Failed(message) => message,
            Self::Io(message) => message,
        }
    }
}

impl From<CommandError> for String {
    fn from(error: CommandError) -> Self {
        error.into_message()
    }
}

pub(crate) fn run_bounded_command_bytes(
    mut command: Command,
    timeout: Duration,
    max_bytes: usize,
) -> Result<Vec<u8>, CommandError> {
    configure_process_group(&mut command);
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| CommandError::Io(format!("Failed to start git: {error}")))?;
    let mut guard = ChildGuard::new(child);

    let Some(stdout) = guard.child.stdout.take() else {
        return Err(CommandError::Io(
            "Failed to capture git output.".to_string(),
        ));
    };
    let Some(stderr) = guard.child.stderr.take() else {
        return Err(CommandError::Io(
            "Failed to capture git diagnostics.".to_string(),
        ));
    };

    let watchdog = Watchdog::start(guard.process_id, timeout);
    let stderr_reader =
        thread::spawn(move || read_bounded_stream(stderr, MAX_INTEGRATION_STDERR_BYTES));
    let stdout_result = read_bounded_stream(stdout, max_bytes);
    if stdout_result.is_err() {
        guard.kill();
    }

    let stderr_result = stderr_reader.join();
    let status = guard.wait();
    let timed_out = watchdog.finish();

    if timed_out {
        return Err(CommandError::TimedOut(timeout));
    }

    let stdout_bytes = stdout_result.map_err(CommandError::Io)?;
    let status =
        status.map_err(|error| CommandError::Io(format!("Failed to await git: {error}")))?;
    if status.success() {
        return Ok(stdout_bytes);
    }

    let failure = match stderr_result {
        Ok(Ok(bytes)) => String::from_utf8_lossy(&bytes).trim().to_string(),
        _ => String::new(),
    };
    if failure.is_empty() {
        return Err(CommandError::Failed(GENERIC_FAILURE_MESSAGE.to_string()));
    }

    Err(CommandError::Failed(failure))
}

struct ChildGuard {
    child: Child,
    process_id: u32,
    reaped: bool,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        let process_id = child.id();
        Self {
            child,
            process_id,
            reaped: false,
        }
    }

    fn kill(&mut self) {
        terminate_process_group(self.process_id);
        let _ = self.child.kill();
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        let status = self.child.wait();
        self.reaped = true;
        status
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        self.kill();
        let _ = self.child.wait();
    }
}

struct Watchdog {
    cancel: mpsc::Sender<()>,
    fired: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Watchdog {
    fn start(process_id: u32, timeout: Duration) -> Self {
        let (cancel, cancelled) = mpsc::channel::<()>();
        let fired = Arc::new(AtomicBool::new(false));
        let fired_flag = Arc::clone(&fired);
        let handle = thread::spawn(move || {
            if cancelled.recv_timeout(timeout).is_ok() {
                return;
            }
            fired_flag.store(true, Ordering::SeqCst);
            terminate_process_group(process_id);
        });
        Self {
            cancel,
            fired,
            handle: Some(handle),
        }
    }

    fn finish(mut self) -> bool {
        let _ = self.cancel.send(());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.fired.load(Ordering::SeqCst)
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(process_id: u32) {
    let Ok(process_group_id) = i32::try_from(process_id) else {
        return;
    };
    if process_group_id <= 0 {
        return;
    }

    // SAFETY: `process_group_id` is the id of the isolated process group that
    // `configure_process_group` created for this child; the negative form
    // addresses the group and never a foreign process.
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_process_id: u32) {}
