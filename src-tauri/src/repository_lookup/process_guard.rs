use std::io;
use std::process::{Child, ChildStderr, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

#[derive(Debug)]
pub(crate) struct ProcessKillSwitch {
    terminate: fn(u32),
    state: Mutex<KillState>,
}

#[derive(Debug, Default)]
struct KillState {
    process_id: Option<u32>,
    killed: bool,
}

impl Default for ProcessKillSwitch {
    fn default() -> Self {
        Self {
            terminate: terminate_process_group,
            state: Mutex::new(KillState::default()),
        }
    }
}

impl ProcessKillSwitch {
    #[cfg(test)]
    pub(crate) fn with_terminator(terminate: fn(u32)) -> Self {
        Self {
            terminate,
            state: Mutex::new(KillState::default()),
        }
    }

    pub(crate) fn kill(&self) {
        let mut state = self.lock();
        state.killed = true;
        let Some(process_id) = state.process_id else {
            return;
        };
        (self.terminate)(process_id);
    }

    pub(crate) fn register(&self, process_id: u32) -> KillRegistration<'_> {
        let mut state = self.lock();
        let accepted = !state.killed;
        if accepted {
            state.process_id = Some(process_id);
        }
        drop(state);
        KillRegistration {
            kill: self,
            accepted,
        }
    }

    fn release(&self) {
        self.lock().process_id = None;
    }

    fn lock(&self) -> MutexGuard<'_, KillState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) struct KillRegistration<'a> {
    kill: &'a ProcessKillSwitch,
    accepted: bool,
}

impl KillRegistration<'_> {
    pub(crate) fn accepted(&self) -> bool {
        self.accepted
    }
}

impl Drop for KillRegistration<'_> {
    fn drop(&mut self) {
        self.kill.release();
    }
}

pub(crate) struct ChildGuard {
    child: Child,
    process_id: u32,
    reaped: bool,
}

impl ChildGuard {
    pub(crate) fn take_streams(&mut self) -> Option<(ChildStdout, ChildStderr)> {
        let stdout = self.child.stdout.take()?;
        let stderr = self.child.stderr.take()?;
        Some((stdout, stderr))
    }

    pub(crate) fn spawn(mut command: Command) -> io::Result<Self> {
        configure_process_group(&mut command);
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let process_id = child.id();
        Ok(Self {
            child,
            process_id,
            reaped: false,
        })
    }

    pub(crate) fn process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn kill(&mut self) {
        terminate_process_group(self.process_id);
        let _ = self.child.kill();
    }

    pub(crate) fn wait(&mut self) -> io::Result<ExitStatus> {
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

pub(crate) struct Watchdog {
    cancel: mpsc::Sender<()>,
    fired: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Watchdog {
    pub(crate) fn start(process_id: u32, timeout: Duration) -> io::Result<Self> {
        let (cancel, cancelled) = mpsc::channel::<()>();
        let fired = Arc::new(AtomicBool::new(false));
        let fired_flag = Arc::clone(&fired);
        let handle = thread::Builder::new()
            .name("repository-lookup-watchdog".to_string())
            .spawn(move || {
                match cancelled.recv_timeout(timeout) {
                    Ok(()) => return,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                fired_flag.store(true, Ordering::SeqCst);
                terminate_process_group(process_id);
            })?;
        Ok(Self {
            cancel,
            fired,
            handle: Some(handle),
        })
    }

    pub(crate) fn finish(mut self) -> bool {
        let _ = self.cancel.send(());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.fired.load(Ordering::SeqCst)
    }
}

#[cfg(unix)]
pub(crate) fn await_exit_without_reaping(process_id: u32) -> bool {
    let id = libc::id_t::from(process_id);
    if id == 0 {
        return false;
    }
    loop {
        // SAFETY: `info` is a freshly zeroed `siginfo_t` owned by this frame and
        // `WNOWAIT` leaves the child reapable, so the pid cannot be recycled.
        let result = unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            libc::waitid(libc::P_PID, id, &mut info, libc::WEXITED | libc::WNOWAIT)
        };
        if result == 0 {
            return true;
        }
        if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
            continue;
        }
        return false;
    }
}

#[cfg(not(unix))]
pub(crate) fn await_exit_without_reaping(_process_id: u32) -> bool {
    false
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
