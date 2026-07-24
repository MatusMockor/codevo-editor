use std::{
    collections::HashMap,
    io,
    process::{Child, ExitStatus},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

#[derive(Debug)]
enum TaskProcessGroupState {
    Active { process_group_id: i32 },
    Reaped,
    Terminated,
}

impl TaskProcessGroupState {
    fn terminate(&mut self) {
        let Self::Active { process_group_id } = self else {
            return;
        };
        #[cfg(unix)]
        unsafe {
            libc::kill(-*process_group_id, libc::SIGKILL);
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TerminalTaskOwnership {
    session_id: u64,
    state: Arc<Mutex<TaskProcessGroupState>>,
    stop_requested: Arc<AtomicBool>,
    task_id: u64,
}

impl TerminalTaskOwnership {
    pub(crate) fn new(session_id: u64, task_id: u64, process_group_id: i32) -> Self {
        Self {
            session_id,
            state: Arc::new(Mutex::new(TaskProcessGroupState::Active {
                process_group_id,
            })),
            stop_requested: Arc::new(AtomicBool::new(false)),
            task_id,
        }
    }

    pub(crate) fn session_id(&self) -> u64 {
        self.session_id
    }

    pub(crate) fn task_id(&self) -> u64 {
        self.task_id
    }

    /// Takes a read-only snapshot of the task's currently owned process group.
    /// Reaped and terminated generations are deliberately not exposed.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn active_process_group_id(&self) -> Option<i32> {
        match *self.state() {
            TaskProcessGroupState::Active { process_group_id } => Some(process_group_id),
            TaskProcessGroupState::Reaped | TaskProcessGroupState::Terminated => None,
        }
    }

    /// Polls and reaps the leader while serializing the PGID lifecycle with terminal stop.
    /// Descendants are killed before `Reaped` is published so inherited output pipes cannot keep
    /// the typed command alive and a reused PGID can never be targeted by a later stop.
    pub(crate) fn try_wait(&self, child: &mut Child) -> io::Result<Option<ExitStatus>> {
        let mut state = self.state();
        #[cfg(unix)]
        {
            if !observe_exit_without_reaping(child)? {
                return Ok(None);
            }
            // The leader remains waitable while the whole ownership generation is terminated.
            // Only then may `Child::wait` reap its PID, closing the reuse window before a stale
            // process-group signal could target a later generation.
            state.terminate();
            let status = wait_child(child)?;
            *state = TaskProcessGroupState::Reaped;
            Ok(Some(status))
        }
        #[cfg(not(unix))]
        {
            let status = child.try_wait()?;
            if status.is_some() {
                state.terminate();
                *state = TaskProcessGroupState::Reaped;
            }
            Ok(status)
        }
    }

    pub(crate) fn terminate(&self) {
        self.state().terminate();
    }

    pub(crate) fn request_stop(&self) -> bool {
        let mut state = self.state();
        if !matches!(*state, TaskProcessGroupState::Active { .. }) {
            return false;
        }
        self.stop_requested.store(true, Ordering::SeqCst);
        state.terminate();
        true
    }

    pub(crate) fn was_stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    /// Cleanup path for a failed normal wait. It kills the group and retries interrupted waits;
    /// every exit publishes a non-active state before registry ownership is removed.
    pub(crate) fn wait_after_terminate(&self, child: &mut Child) -> io::Result<ExitStatus> {
        let mut state = self.state();
        state.terminate();
        let status = loop {
            match child.wait() {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Ok(status) => break status,
                Err(error) => {
                    *state = TaskProcessGroupState::Terminated;
                    return Err(error);
                }
            }
        };
        *state = TaskProcessGroupState::Reaped;
        Ok(status)
    }

    fn state(&self) -> MutexGuard<'_, TaskProcessGroupState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(unix)]
fn observe_exit_without_reaping(child: &Child) -> io::Result<bool> {
    loop {
        let mut information = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                child.id(),
                information.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            let information = unsafe { information.assume_init() };
            return Ok(unsafe { information.si_pid() } != 0);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

#[cfg(unix)]
fn wait_child(child: &mut Child) -> io::Result<ExitStatus> {
    loop {
        match child.wait() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => return result,
        }
    }
}

pub(crate) fn terminate_task_process_groups(process_groups: &HashMap<u64, TerminalTaskOwnership>) {
    for ownership in process_groups.values() {
        ownership.request_stop();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        io::Read,
        os::unix::process::CommandExt,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    fn process_group_command(script: &str) -> Child {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(io::Error::last_os_error())
                }
            });
        }
        command.spawn().expect("spawn process group")
    }

    #[test]
    fn natural_leader_exit_terminates_descendants_before_reap() {
        let mut child = process_group_command("sleep 30 & exit 0");
        let process_group_id = i32::try_from(child.id()).expect("pid");
        let ownership = TerminalTaskOwnership::new(7, 11, process_group_id);
        let mut output = child.stdout.take().expect("stdout");
        assert_eq!(ownership.active_process_group_id(), Some(process_group_id));
        let started = Instant::now();
        let status = loop {
            if let Some(status) = ownership.try_wait(&mut child).expect("observe and reap") {
                break status;
            }
            assert!(started.elapsed() < Duration::from_secs(2));
            thread::sleep(Duration::from_millis(1));
        };

        assert!(status.success());
        let mut trailing = Vec::new();
        output
            .read_to_end(&mut trailing)
            .expect("descendant pipe EOF");
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(ownership.active_process_group_id(), None);
        assert!(!ownership.request_stop());
    }

    #[test]
    fn running_leader_remains_active_until_an_exit_is_observed() {
        let mut child = process_group_command("sleep 30");
        let process_group_id = i32::try_from(child.id()).expect("pid");
        let ownership = TerminalTaskOwnership::new(8, 12, process_group_id);

        assert!(ownership
            .try_wait(&mut child)
            .expect("observe running")
            .is_none());
        assert!(ownership.request_stop());
        ownership
            .wait_after_terminate(&mut child)
            .expect("reap stopped leader");
        assert!(ownership.was_stop_requested());
    }
}
