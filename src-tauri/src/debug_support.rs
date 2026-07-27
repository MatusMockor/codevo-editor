use crate::debug_adapter::DebugBreakpoint;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

const PROCESS_KILL_ESCALATION_DELAY: Duration = Duration::from_millis(500);
const PROCESS_SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(10);

pub(crate) fn file_url_from_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for character in path.chars() {
        match character {
            ' ' => encoded.push_str("%20"),
            '%' => encoded.push_str("%25"),
            '#' => encoded.push_str("%23"),
            '?' => encoded.push_str("%3F"),
            _ => encoded.push(character),
        }
    }
    format!("file://{encoded}")
}

pub(crate) fn path_from_file_url(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    Some(percent_decode(path))
}

pub(crate) fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

pub(crate) fn validate_workspace_file(root: &Path, path: &str) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the workspace root: {error}"))?;
    let candidate = PathBuf::from(path);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let metadata =
        fs::metadata(&candidate).map_err(|_| format!("Debug target `{path}` was not found."))?;
    if !metadata.is_file() {
        return Err(format!("Debug target `{path}` is not a file."));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Unable to resolve debug target `{path}`: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "Debug target `{path}` is outside the workspace root."
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

pub(crate) fn group_breakpoints_by_file(
    breakpoints: &[DebugBreakpoint],
) -> Vec<(String, Vec<DebugBreakpoint>)> {
    let mut grouped: Vec<(String, Vec<DebugBreakpoint>)> = Vec::new();
    for breakpoint in breakpoints {
        if let Some((_, entries)) = grouped
            .iter_mut()
            .find(|(file_path, _)| file_path == &breakpoint.file_path)
        {
            entries.push(breakpoint.clone());
            continue;
        }
        grouped.push((breakpoint.file_path.clone(), vec![breakpoint.clone()]));
    }
    grouped
}

pub(crate) struct DebugProcessHandle {
    ownership: DebugProcessOwnership,
}

enum DebugProcessOwnership {
    LegacyProcessGroup(Option<i32>),
    Supervised(Arc<SupervisedDebugProcess>),
}

struct SupervisedDebugProcess {
    process_group_id: Option<i32>,
    external_handles: std::sync::atomic::AtomicUsize,
    state: Mutex<SupervisedDebugProcessState>,
    settled: Condvar,
}

enum SupervisedDebugProcessState {
    Dormant { stop_requested: bool },
    Running { stop_tx: mpsc::SyncSender<()> },
    Settled,
}

impl DebugProcessHandle {
    pub(crate) fn from_process_id(process_id: u32) -> Self {
        Self {
            ownership: DebugProcessOwnership::LegacyProcessGroup(i32::try_from(process_id).ok()),
        }
    }

    pub(crate) fn supervised(process_id: u32) -> Self {
        Self {
            ownership: DebugProcessOwnership::Supervised(Arc::new(SupervisedDebugProcess {
                process_group_id: i32::try_from(process_id).ok(),
                external_handles: std::sync::atomic::AtomicUsize::new(1),
                state: Mutex::new(SupervisedDebugProcessState::Dormant {
                    stop_requested: false,
                }),
                settled: Condvar::new(),
            })),
        }
    }

    pub(crate) fn terminate(&self) {
        match &self.ownership {
            DebugProcessOwnership::LegacyProcessGroup(process_group_id) => {
                let Some(process_group_id) = *process_group_id else {
                    return;
                };
                signal_process_group(process_group_id, libc::SIGTERM);
                if thread::Builder::new()
                    .name("debug-process-kill-escalation".to_string())
                    .spawn(move || {
                        thread::sleep(PROCESS_KILL_ESCALATION_DELAY);
                        signal_process_group(process_group_id, libc::SIGKILL);
                    })
                    .is_err()
                {
                    signal_process_group(process_group_id, libc::SIGKILL);
                }
            }
            DebugProcessOwnership::Supervised(process) => {
                process.request_stop(true);
            }
        }
    }

    pub(crate) fn supervise(
        &self,
        child: Child,
        finish: Box<dyn FnOnce(Option<i32>) + Send>,
    ) -> Result<(), String> {
        let DebugProcessOwnership::Supervised(process) = &self.ownership else {
            return Err("The debug process does not own a supervisor.".to_string());
        };
        process.start(child, finish)
    }
}

impl Clone for DebugProcessHandle {
    fn clone(&self) -> Self {
        let ownership = match &self.ownership {
            DebugProcessOwnership::LegacyProcessGroup(process_group_id) => {
                DebugProcessOwnership::LegacyProcessGroup(*process_group_id)
            }
            DebugProcessOwnership::Supervised(process) => {
                process
                    .external_handles
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                DebugProcessOwnership::Supervised(Arc::clone(process))
            }
        };
        Self { ownership }
    }
}

impl Drop for DebugProcessHandle {
    fn drop(&mut self) {
        let DebugProcessOwnership::Supervised(process) = &self.ownership else {
            return;
        };
        if process
            .external_handles
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst)
            == 1
        {
            process.request_stop(false);
        }
    }
}

impl SupervisedDebugProcess {
    fn start(
        self: &Arc<Self>,
        child: Child,
        finish: Box<dyn FnOnce(Option<i32>) + Send>,
    ) -> Result<(), String> {
        let (stop_tx, stop_rx) = mpsc::sync_channel(1);
        let (start_tx, start_rx) = mpsc::sync_channel(0);
        let child_slot = Arc::new(Mutex::new(Some(child)));
        let thread_child = Arc::clone(&child_slot);
        let process = Arc::clone(self);
        let supervisor = thread::Builder::new()
            .name("node-debug-process-supervisor".to_string())
            .spawn(move || {
                if start_rx.recv().is_err() {
                    return;
                }
                let mut child = lock_recover(&thread_child)
                    .take()
                    .expect("supervised Node child ownership");
                let exit_code = supervise_child(&mut child, stop_rx);
                process.mark_settled();
                finish(exit_code);
            });
        let supervisor = match supervisor {
            Ok(supervisor) => supervisor,
            Err(error) => {
                let mut child = lock_recover(&child_slot)
                    .take()
                    .expect("failed supervisor retained Node child");
                terminate_owned_child(
                    &mut child,
                    self.process_group_id,
                    ProcessTerminationCause::Stop,
                );
                self.mark_settled();
                return Err(format!(
                    "Unable to start the Node.js debug process supervisor: {error}"
                ));
            }
        };

        let stop_requested = {
            let mut state = lock_recover(&self.state);
            match &*state {
                SupervisedDebugProcessState::Dormant { stop_requested } => {
                    let requested = *stop_requested;
                    *state = SupervisedDebugProcessState::Running {
                        stop_tx: stop_tx.clone(),
                    };
                    requested
                }
                SupervisedDebugProcessState::Running { .. }
                | SupervisedDebugProcessState::Settled => {
                    drop(start_tx);
                    let _ = supervisor.join();
                    if let Some(mut child) = lock_recover(&child_slot).take() {
                        let process_group_id = i32::try_from(child.id()).ok();
                        terminate_owned_child(
                            &mut child,
                            process_group_id,
                            ProcessTerminationCause::Stop,
                        );
                    }
                    return Err(
                        "The Node.js debug process supervisor was already started.".to_string()
                    );
                }
            }
        };
        if start_tx.send(()).is_err() {
            let _ = supervisor.join();
            if let Some(mut child) = lock_recover(&child_slot).take() {
                let process_group_id = i32::try_from(child.id()).ok();
                terminate_owned_child(&mut child, process_group_id, ProcessTerminationCause::Stop);
            }
            self.mark_settled();
            return Err("The Node.js debug process supervisor did not start.".to_string());
        }
        drop(supervisor);
        if stop_requested {
            let _ = stop_tx.try_send(());
        }
        Ok(())
    }

    fn request_stop(&self, wait_for_settlement: bool) {
        let stop_tx = {
            let mut state = lock_recover(&self.state);
            match &mut *state {
                SupervisedDebugProcessState::Dormant { stop_requested } => {
                    *stop_requested = true;
                    return;
                }
                SupervisedDebugProcessState::Running { stop_tx } => Some(stop_tx.clone()),
                SupervisedDebugProcessState::Settled => None,
            }
        };
        if let Some(stop_tx) = stop_tx {
            let _ = stop_tx.try_send(());
        }
        if !wait_for_settlement {
            return;
        }
        let mut state = lock_recover(&self.state);
        while !matches!(*state, SupervisedDebugProcessState::Settled) {
            state = self
                .settled
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }
    }

    fn mark_settled(&self) {
        *lock_recover(&self.state) = SupervisedDebugProcessState::Settled;
        self.settled.notify_all();
    }
}

fn supervise_child(child: &mut Child, stop_rx: mpsc::Receiver<()>) -> Option<i32> {
    loop {
        #[cfg(unix)]
        match observe_exit_without_reaping(child) {
            Ok(true) => {
                return terminate_owned_child(
                    child,
                    i32::try_from(child.id()).ok(),
                    ProcessTerminationCause::NaturalExit,
                );
            }
            Ok(false) => {}
            Err(_) => {
                return terminate_owned_child(
                    child,
                    i32::try_from(child.id()).ok(),
                    ProcessTerminationCause::Stop,
                );
            }
        }
        #[cfg(not(unix))]
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
        match stop_rx.recv_timeout(PROCESS_SUPERVISOR_POLL_INTERVAL) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                return terminate_owned_child(
                    child,
                    i32::try_from(child.id()).ok(),
                    ProcessTerminationCause::Stop,
                );
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

#[derive(Clone, Copy)]
enum ProcessTerminationCause {
    NaturalExit,
    Stop,
}

fn terminate_owned_child(
    child: &mut Child,
    process_group_id: Option<i32>,
    cause: ProcessTerminationCause,
) -> Option<i32> {
    #[cfg(unix)]
    let leader_exited = observe_exit_without_reaping(child).unwrap_or(false);
    #[cfg(not(unix))]
    match child.try_wait() {
        Ok(Some(status)) => return status.code(),
        Ok(None) => {}
        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
        Err(_) => return None,
    }

    #[cfg(unix)]
    if let Some(process_group_id) = process_group_id {
        let process_id = i32::try_from(child.id()).ok();
        if process_id == Some(process_group_id)
            && (leader_exited || process_group_matches_live_leader(process_group_id))
        {
            if matches!(cause, ProcessTerminationCause::Stop) && !leader_exited {
                signal_process_group(process_group_id, libc::SIGTERM);
                let deadline = Instant::now() + PROCESS_KILL_ESCALATION_DELAY;
                while Instant::now() < deadline {
                    thread::sleep(PROCESS_SUPERVISOR_POLL_INTERVAL);
                }
            }
            // The leader is deliberately still unreaped here. Its numeric PID,
            // and therefore the process-group identity it created, cannot be
            // recycled between the TERM grace period and this final signal.
            signal_process_group(process_group_id, libc::SIGKILL);
        } else {
            let _ = child.kill();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = process_group_id;
        let _ = child.kill();
    }

    wait_for_child(child)
}

#[cfg(unix)]
fn observe_exit_without_reaping(child: &Child) -> std::io::Result<bool> {
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
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn wait_for_child(child: &mut Child) -> Option<i32> {
    loop {
        match child.wait() {
            Ok(status) => return status.code(),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    }
}

#[cfg(unix)]
fn process_group_matches_live_leader(process_group_id: i32) -> bool {
    unsafe { libc::getpgid(process_group_id) == process_group_id }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(all(test, unix))]
mod process_tests {
    use super::{DebugProcessHandle, PROCESS_KILL_ESCALATION_DELAY};
    use std::fs;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{mpsc, Arc, Barrier};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn terminate_kills_the_debuggee_process_group() {
        let child_pid_path = temporary_child_pid_path();
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $! > \"$1\"; wait")
            .arg("debug-process-group")
            .arg(&child_pid_path)
            .process_group(0);
        let mut child = command.spawn().expect("spawn process group");
        let child_process_id = wait_for_child_pid(&child_pid_path);

        DebugProcessHandle::from_process_id(child.id()).terminate();
        let deadline = Instant::now() + PROCESS_KILL_ESCALATION_DELAY + Duration::from_secs(2);

        while Instant::now() < deadline {
            if !process_is_running(child_process_id) {
                let _ = child.wait();
                let _ = fs::remove_file(child_pid_path);
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }

        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(child_pid_path);
        panic!("debuggee child process survived process-group termination");
    }

    #[test]
    fn supervised_terminate_waits_for_group_escalation_and_root_reap() {
        let child_pid_path = temporary_child_pid_path();
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("trap '' TERM; sh -c 'trap \"\" TERM; while :; do sleep 1; done' & echo $! > \"$1\"; wait")
            .arg("supervised-debug-process-group")
            .arg(&child_pid_path)
            .process_group(0);
        let child = command.spawn().expect("spawn supervised process group");
        let root_process_id = child.id();
        let child_process_id = wait_for_child_pid(&child_pid_path);
        let handle = DebugProcessHandle::supervised(root_process_id);
        let (finished_tx, finished_rx) = mpsc::channel();
        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("start process supervisor");

        let started = Instant::now();
        handle.terminate();

        assert!(
            started.elapsed() >= PROCESS_KILL_ESCALATION_DELAY,
            "TERM-ignoring group settled before the KILL grace period"
        );
        assert!(
            finished_rx.recv_timeout(Duration::from_secs(2)).is_ok(),
            "supervisor completion did not settle"
        );
        assert!(!process_is_running(root_process_id));
        assert!(!process_is_running(child_process_id));
        let _ = fs::remove_file(child_pid_path);
    }

    #[test]
    fn concurrent_supervised_stops_join_one_settlement() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 1; done")
            .process_group(0);
        let child = command.spawn().expect("spawn repeated-stop process");
        let process_id = child.id();
        let handle = DebugProcessHandle::supervised(process_id);
        let (finished_tx, finished_rx) = mpsc::channel();
        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("start repeated-stop supervisor");
        let first = handle.clone();
        let second = handle.clone();
        let barrier = Arc::new(Barrier::new(3));
        let first_barrier = Arc::clone(&barrier);
        let first_stop = thread::spawn(move || {
            first_barrier.wait();
            first.terminate();
        });
        let second_barrier = Arc::clone(&barrier);
        let second_stop = thread::spawn(move || {
            second_barrier.wait();
            second.terminate();
        });

        barrier.wait();
        first_stop.join().expect("first Stop");
        second_stop.join().expect("second Stop");

        assert!(finished_rx.recv_timeout(Duration::from_secs(2)).is_ok());
        assert_eq!(
            finished_rx.try_recv(),
            Err(mpsc::TryRecvError::Disconnected),
            "process completion ran more than once"
        );
        assert!(!process_is_running(process_id));
    }

    #[test]
    fn natural_exit_settles_before_a_late_stop_without_signalling_again() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("exit 7").process_group(0);
        let child = command.spawn().expect("spawn natural-exit process");
        let process_id = child.id();
        let handle = DebugProcessHandle::supervised(process_id);
        let (finished_tx, finished_rx) = mpsc::channel();
        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("start natural-exit supervisor");

        assert_eq!(
            finished_rx.recv_timeout(Duration::from_secs(2)),
            Ok(Some(7))
        );
        let started = Instant::now();
        handle.terminate();
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "late Stop waited or escalated after natural exit"
        );
        assert!(!process_is_running(process_id));
    }

    #[test]
    fn natural_root_exit_cleans_up_a_persistent_owned_grandchild() {
        let child_pid_path = temporary_child_pid_path();
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sh -c 'trap \"\" TERM; while :; do sleep 1; done' & echo $! > \"$1\"; exit 7")
            .arg("natural-exit-process-group")
            .arg(&child_pid_path)
            .process_group(0);
        let child = command.spawn().expect("spawn natural-exit process group");
        let root_process_id = child.id();
        let grandchild_process_id = wait_for_child_pid(&child_pid_path);
        let handle = DebugProcessHandle::supervised(root_process_id);
        let (finished_tx, finished_rx) = mpsc::channel();
        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("start natural-exit process supervisor");

        assert_eq!(
            finished_rx.recv_timeout(Duration::from_secs(2)),
            Ok(Some(7))
        );
        assert!(!process_is_running(root_process_id));
        assert!(
            !process_is_running(grandchild_process_id),
            "owned grandchild survived its natural root exit"
        );
        let _ = fs::remove_file(child_pid_path);
    }

    #[test]
    fn dormant_stop_is_applied_when_child_ownership_is_transferred() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 1; done")
            .process_group(0);
        let child = command.spawn().expect("spawn dormant-stop process");
        let process_id = child.id();
        let handle = DebugProcessHandle::supervised(process_id);
        handle.terminate();
        let (finished_tx, finished_rx) = mpsc::channel();

        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("transfer child after dormant Stop");

        assert!(finished_rx.recv_timeout(Duration::from_secs(2)).is_ok());
        assert!(!process_is_running(process_id));
    }

    #[test]
    fn dropping_the_last_supervised_handle_requests_cleanup() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 1; done")
            .process_group(0);
        let child = command.spawn().expect("spawn drop-cleanup process");
        let process_id = child.id();
        let handle = DebugProcessHandle::supervised(process_id);
        let (finished_tx, finished_rx) = mpsc::channel();
        handle
            .supervise(
                child,
                Box::new(move |exit_code| {
                    let _ = finished_tx.send(exit_code);
                }),
            )
            .expect("start drop-cleanup supervisor");

        drop(handle);

        assert!(finished_rx.recv_timeout(Duration::from_secs(3)).is_ok());
        assert!(!process_is_running(process_id));
    }

    fn temporary_child_pid_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("codevo-debug-child-{suffix}.pid"))
    }

    fn wait_for_child_pid(path: &PathBuf) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Ok(content) = fs::read_to_string(path) {
                return content.trim().parse().expect("child process id");
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("debuggee did not report its child process id");
    }

    fn process_is_running(process_id: u32) -> bool {
        let output = Command::new("/bin/ps")
            .args(["-o", "state=", "-p", &process_id.to_string()])
            .output()
            .expect("inspect child process");
        let state = String::from_utf8_lossy(&output.stdout);
        let state = state.trim();
        !state.is_empty() && !state.starts_with('Z')
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) {
    unsafe {
        libc::kill(-process_group_id, signal);
    }
}

#[cfg(not(unix))]
fn signal_process_group(_process_group_id: i32, _signal: i32) {}
