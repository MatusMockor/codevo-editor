use crate::terminal_session::TerminalKiller;
use std::{
    io,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);
const FORCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);

pub(crate) struct ProcessTreeTerminator {
    fallback_killer: Box<dyn TerminalKiller>,
    force_timeout: Duration,
    graceful_timeout: Duration,
    process_group_id: Option<i32>,
    signal_sender: Box<dyn ProcessGroupSignalSender>,
}

pub(crate) trait ProcessGroupSignalSender: Send {
    fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()>;
}

struct SystemProcessGroupSignalSender;

impl ProcessGroupSignalSender for SystemProcessGroupSignalSender {
    #[cfg(unix)]
    fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()> {
        let result = unsafe { libc::kill(-process_group_id, signal) };
        if result == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        Err(error)
    }

    #[cfg(not(unix))]
    fn send(&self, _process_group_id: i32, _signal: i32) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Process-group signals are unavailable on this platform.",
        ))
    }
}

impl ProcessTreeTerminator {
    pub(crate) fn new(process_id: Option<u32>, fallback_killer: Box<dyn TerminalKiller>) -> Self {
        Self {
            fallback_killer,
            force_timeout: FORCE_SHUTDOWN_TIMEOUT,
            graceful_timeout: GRACEFUL_SHUTDOWN_TIMEOUT,
            process_group_id: process_id
                .and_then(|value| i32::try_from(value).ok())
                .filter(|value| *value > 0),
            signal_sender: Box::new(SystemProcessGroupSignalSender),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_dependencies(
        process_group_id: i32,
        fallback_killer: Box<dyn TerminalKiller>,
        signal_sender: Box<dyn ProcessGroupSignalSender>,
        graceful_timeout: Duration,
        force_timeout: Duration,
    ) -> Self {
        Self {
            fallback_killer,
            force_timeout,
            graceful_timeout,
            process_group_id: Some(process_group_id),
            signal_sender,
        }
    }

    pub(crate) fn terminate(&mut self, waiter: Option<&JoinHandle<()>>) {
        if self.process_group_id.is_none() {
            let _ = self.fallback_killer.kill();
            wait_for_thread(waiter, self.force_timeout);
            return;
        }
        if self.signal_process_group(libc::SIGTERM).is_err() {
            let _ = self.fallback_killer.kill();
        }
        if wait_for_thread(waiter, self.graceful_timeout) {
            return;
        }
        if self.signal_process_group(libc::SIGKILL).is_err() {
            let _ = self.fallback_killer.kill();
        }
        wait_for_thread(waiter, self.force_timeout);
    }

    pub(crate) fn terminate_unpublished(
        &mut self,
        child: &mut dyn crate::terminal_session::TerminalChild,
    ) {
        if self.process_group_id.is_none() || self.signal_process_group(libc::SIGTERM).is_err() {
            let _ = self.fallback_killer.kill();
        }
        if wait_for_child(child, self.graceful_timeout) {
            return;
        }
        if self.process_group_id.is_none() || self.signal_process_group(libc::SIGKILL).is_err() {
            let _ = self.fallback_killer.kill();
        }
        wait_for_child(child, self.force_timeout);
    }

    /// Returns the process group claimed by the terminal child without probing
    /// the operating system. Callers must perform any live-process validation
    /// after releasing the terminal session registry lock.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn process_group_id(&self) -> Option<i32> {
        self.process_group_id
    }

    fn signal_process_group(&self, signal: i32) -> io::Result<()> {
        let process_group_id = self.process_group_id.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Terminal process group is unavailable.",
            )
        })?;
        self.signal_sender.send(process_group_id, signal)
    }
}

fn wait_for_thread(thread: Option<&JoinHandle<()>>, timeout: Duration) -> bool {
    let Some(thread) = thread else {
        return true;
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if thread.is_finished() {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    thread.is_finished()
}

fn wait_for_child(
    child: &mut dyn crate::terminal_session::TerminalChild,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal_session::{TerminalChild, TerminalExitStatus};
    use std::sync::{Arc, Mutex};

    struct RecordingKiller(Arc<Mutex<usize>>);

    impl TerminalKiller for RecordingKiller {
        fn kill(&mut self) -> io::Result<()> {
            *self.0.lock().expect("kills") += 1;
            Ok(())
        }
    }

    struct PollingChild {
        exited: Arc<Mutex<bool>>,
    }

    impl TerminalChild for PollingChild {
        fn clone_killer(&self) -> Box<dyn TerminalKiller> {
            Box::new(RecordingKiller(Arc::new(Mutex::new(0))))
        }

        fn process_id(&self) -> Option<u32> {
            Some(42)
        }

        fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
            Ok((*self.exited.lock().expect("exited"))
                .then_some(TerminalExitStatus { exit_code: None }))
        }

        fn wait(&mut self) -> io::Result<TerminalExitStatus> {
            unreachable!("unpublished cleanup must never perform an unbounded wait")
        }
    }

    struct ExitOnKillSignalSender {
        exited: Arc<Mutex<bool>>,
        signals: Arc<Mutex<Vec<i32>>>,
    }

    impl ProcessGroupSignalSender for ExitOnKillSignalSender {
        fn send(&self, _process_group_id: i32, signal: i32) -> io::Result<()> {
            self.signals.lock().expect("signals").push(signal);
            if signal == libc::SIGKILL {
                *self.exited.lock().expect("exited") = true;
            }
            Ok(())
        }
    }

    #[test]
    fn process_group_getter_is_a_read_only_snapshot() {
        let kills = Arc::new(Mutex::new(0));
        let terminator =
            ProcessTreeTerminator::new(Some(42), Box::new(RecordingKiller(Arc::clone(&kills))));

        assert_eq!(terminator.process_group_id(), Some(42));
        assert_eq!(*kills.lock().expect("kills"), 0);
    }

    #[test]
    fn unpublished_child_cleanup_escalates_and_reaps_without_blocking_wait() {
        let exited = Arc::new(Mutex::new(false));
        let signals = Arc::new(Mutex::new(Vec::new()));
        let kills = Arc::new(Mutex::new(0));
        let mut child = PollingChild {
            exited: Arc::clone(&exited),
        };
        let mut terminator = ProcessTreeTerminator::with_dependencies(
            42,
            Box::new(RecordingKiller(Arc::clone(&kills))),
            Box::new(ExitOnKillSignalSender {
                exited,
                signals: Arc::clone(&signals),
            }),
            Duration::from_millis(1),
            Duration::from_millis(10),
        );

        terminator.terminate_unpublished(&mut child);

        assert_eq!(
            signals.lock().expect("signals").as_slice(),
            &[libc::SIGTERM, libc::SIGKILL]
        );
        assert_eq!(*kills.lock().expect("kills"), 0);
        assert!(child.try_wait().expect("poll child").is_some());
    }

    #[test]
    fn zero_pid_never_becomes_a_process_group_target() {
        let kills = Arc::new(Mutex::new(0));
        let terminator =
            ProcessTreeTerminator::new(Some(0), Box::new(RecordingKiller(Arc::clone(&kills))));

        assert_eq!(terminator.process_group_id(), None);
    }
}
