use crate::terminal_session::TerminalKiller;
use std::{
    io,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const HANGUP_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(300);
const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(200);
const FORCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(unix)]
const HANGUP_SIGNAL: i32 = libc::SIGHUP;
#[cfg(not(unix))]
const HANGUP_SIGNAL: i32 = 1;

pub(crate) struct ProcessTreeTerminator {
    fallback_killer: Box<dyn TerminalKiller>,
    force_timeout: Duration,
    graceful_timeout: Duration,
    hangup_timeout: Duration,
    process_group_id: Option<i32>,
    signal_sender: Box<dyn ProcessGroupSignalSender>,
}

pub(crate) trait ProcessGroupSignalSender: Send {
    fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()>;
    fn group_exists(&self, process_group_id: i32) -> bool;
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

    #[cfg(unix)]
    fn group_exists(&self, process_group_id: i32) -> bool {
        if unsafe { libc::kill(-process_group_id, 0) } == 0 {
            return true;
        }
        io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
    }

    #[cfg(not(unix))]
    fn group_exists(&self, _process_group_id: i32) -> bool {
        false
    }
}

impl ProcessTreeTerminator {
    pub(crate) fn new(process_id: Option<u32>, fallback_killer: Box<dyn TerminalKiller>) -> Self {
        Self {
            fallback_killer,
            force_timeout: FORCE_SHUTDOWN_TIMEOUT,
            graceful_timeout: GRACEFUL_SHUTDOWN_TIMEOUT,
            hangup_timeout: HANGUP_SHUTDOWN_TIMEOUT,
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
        hangup_timeout: Duration,
        graceful_timeout: Duration,
        force_timeout: Duration,
    ) -> Self {
        Self {
            fallback_killer,
            force_timeout,
            graceful_timeout,
            hangup_timeout,
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
        if self.signal_process_group(HANGUP_SIGNAL).is_ok()
            && self.wait_for_group_exit(waiter, self.hangup_timeout)
        {
            return;
        }
        if self.signal_process_group(libc::SIGTERM).is_err() {
            let _ = self.fallback_killer.kill();
        }
        if self.wait_for_group_exit(waiter, self.graceful_timeout) {
            return;
        }
        if self.signal_process_group(libc::SIGKILL).is_err() {
            let _ = self.fallback_killer.kill();
        }
        wait_for_thread(waiter, self.force_timeout);
    }

    fn wait_for_group_exit(&self, waiter: Option<&JoinHandle<()>>, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.group_exited(waiter) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn group_exited(&self, waiter: Option<&JoinHandle<()>>) -> bool {
        let shell_exited = waiter.is_none_or(JoinHandle::is_finished);
        shell_exited
            && self
                .process_group_id
                .is_none_or(|process_group_id| !self.signal_sender.group_exists(process_group_id))
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

    #[cfg(test)]
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
    use std::sync::{Arc, Condvar, Mutex};

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

        fn group_exists(&self, _process_group_id: i32) -> bool {
            !*self.exited.lock().expect("exited")
        }
    }

    #[derive(Default)]
    struct ScriptedGroupState {
        group_exited: bool,
        shell_exited: bool,
        signals: Vec<i32>,
    }

    struct ScriptedProcessGroup {
        group_exits_on: i32,
        shell_exits_on: i32,
        state: Arc<(Mutex<ScriptedGroupState>, Condvar)>,
    }

    impl ScriptedProcessGroup {
        fn new(shell_exits_on: i32, group_exits_on: i32) -> Self {
            Self {
                group_exits_on,
                shell_exits_on,
                state: Arc::new((Mutex::new(ScriptedGroupState::default()), Condvar::new())),
            }
        }

        fn sender(&self) -> Box<dyn ProcessGroupSignalSender> {
            Box::new(Self {
                group_exits_on: self.group_exits_on,
                shell_exits_on: self.shell_exits_on,
                state: Arc::clone(&self.state),
            })
        }

        fn waiter(&self) -> JoinHandle<()> {
            let state = Arc::clone(&self.state);
            thread::spawn(move || {
                let (lock, changed) = &*state;
                let guard = lock.lock().expect("group state");
                let _exited = changed
                    .wait_timeout_while(guard, Duration::from_secs(5), |state| {
                        !state.shell_exited
                    })
                    .expect("shell exit");
            })
        }

        fn signals(&self) -> Vec<i32> {
            self.state.0.lock().expect("group state").signals.clone()
        }
    }

    impl ProcessGroupSignalSender for ScriptedProcessGroup {
        fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()> {
            assert_eq!(process_group_id, 42);
            let (lock, changed) = &*self.state;
            let mut state = lock.lock().expect("group state");
            state.signals.push(signal);
            if signal == self.shell_exits_on || signal == libc::SIGKILL {
                state.shell_exited = true;
            }
            if signal == self.group_exits_on || signal == libc::SIGKILL {
                state.group_exited = true;
            }
            changed.notify_all();
            Ok(())
        }

        fn group_exists(&self, _process_group_id: i32) -> bool {
            !self.state.0.lock().expect("group state").group_exited
        }
    }

    fn scripted_terminator(
        group: &ScriptedProcessGroup,
        hangup_timeout: Duration,
    ) -> ProcessTreeTerminator {
        ProcessTreeTerminator::with_dependencies(
            42,
            Box::new(RecordingKiller(Arc::new(Mutex::new(0)))),
            group.sender(),
            hangup_timeout,
            Duration::from_millis(40),
            Duration::from_millis(200),
        )
    }

    #[test]
    fn a_shell_that_exits_on_hangup_never_receives_term_or_kill() {
        let group = ScriptedProcessGroup::new(libc::SIGHUP, libc::SIGHUP);
        let waiter = group.waiter();
        let started = Instant::now();

        scripted_terminator(&group, Duration::from_secs(2)).terminate(Some(&waiter));

        assert_eq!(group.signals(), vec![libc::SIGHUP]);
        assert!(started.elapsed() < Duration::from_secs(2));
        waiter.join().expect("waiter");
    }

    #[test]
    fn a_group_that_ignores_hangup_and_term_escalates_to_kill_within_the_bounds() {
        let group = ScriptedProcessGroup::new(libc::SIGKILL, libc::SIGKILL);
        let waiter = group.waiter();
        let started = Instant::now();

        scripted_terminator(&group, Duration::from_millis(40)).terminate(Some(&waiter));

        assert_eq!(
            group.signals(),
            vec![libc::SIGHUP, libc::SIGTERM, libc::SIGKILL]
        );
        assert!(started.elapsed() >= Duration::from_millis(80));
        assert!(started.elapsed() < Duration::from_secs(1));
        waiter.join().expect("waiter");
    }

    #[test]
    fn a_hangup_survivor_in_the_group_is_still_terminated_after_the_shell_exits() {
        let group = ScriptedProcessGroup::new(libc::SIGHUP, libc::SIGTERM);
        let waiter = group.waiter();

        scripted_terminator(&group, Duration::from_millis(40)).terminate(Some(&waiter));

        assert_eq!(group.signals(), vec![libc::SIGHUP, libc::SIGTERM]);
        waiter.join().expect("waiter");
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
