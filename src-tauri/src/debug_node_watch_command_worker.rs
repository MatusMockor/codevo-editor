use super::watch_control_proxy::{
    WatchDebugCommandFailure, WatchDebugControlCommand, WatchDebugControlPort,
    WatchDebugControlResponse,
};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_COMMAND_QUEUE: usize = 32;
const MAX_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WatchDebugCommandWorkerPolicy {
    queue_capacity: usize,
    response_timeout: Duration,
}

impl WatchDebugCommandWorkerPolicy {
    pub(crate) fn new(
        queue_capacity: usize,
        response_timeout: Duration,
    ) -> Result<Self, &'static str> {
        if queue_capacity == 0 || queue_capacity > MAX_COMMAND_QUEUE {
            return Err("invalid watch debug command queue capacity");
        }
        if response_timeout.is_zero() || response_timeout > MAX_COMMAND_TIMEOUT {
            return Err("invalid watch debug command timeout");
        }
        Ok(Self {
            queue_capacity,
            response_timeout,
        })
    }
}

/// Owns the target runtime on exactly one worker thread. Implementations must
/// honor the supplied deadline and cancellation flag; this keeps callers and
/// teardown bounded without exposing the target behind a shared mutex.
pub(crate) trait WatchDebugCommandRuntime: Send + 'static {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure>;

    fn shutdown(&mut self, _deadline: Instant, _revoked: &AtomicBool) {}
}

pub(crate) trait WatchDebugCommandAuthority: Send + Sync + 'static {
    fn is_current(&self) -> bool;
}

impl<F> WatchDebugCommandAuthority for F
where
    F: Fn() -> bool + Send + Sync + 'static,
{
    fn is_current(&self) -> bool {
        self()
    }
}

struct CommandRequest {
    command: WatchDebugControlCommand,
    deadline: Instant,
    response: SyncSender<Result<WatchDebugControlResponse, WatchDebugCommandFailure>>,
}

struct WorkerOwner {
    completed: Mutex<Receiver<()>>,
    response_timeout: Duration,
    revoked: Arc<AtomicBool>,
    sender: SyncSender<CommandRequest>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl WorkerOwner {
    /// Revocation is hard-bounded for the caller. A cooperative runtime exits
    /// before the policy deadline and is joined. Rust cannot safely terminate
    /// a stuck thread, so a non-cooperative runtime is detached after the same
    /// bound; supervisor-owned process-group teardown remains authoritative.
    fn stop(&self) {
        self.revoked.store(true, Ordering::Release);
        let worker = lock_recover(&self.worker).take();
        let Some(worker) = worker else {
            return;
        };
        if worker.thread().id() == thread::current().id() {
            return;
        }
        if lock_recover(&self.completed)
            .recv_timeout(self.response_timeout)
            .is_ok()
        {
            let _ = worker.join();
        }
    }
}

impl Drop for WorkerOwner {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone)]
pub(crate) struct WatchDebugCommandWorkerPort {
    owner: Arc<WorkerOwner>,
}

impl fmt::Debug for WatchDebugCommandWorkerPort {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WatchDebugCommandWorkerPort")
            .field("revoked", &self.owner.revoked.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

impl WatchDebugCommandWorkerPort {
    pub(crate) fn spawn(
        runtime: impl WatchDebugCommandRuntime,
        authority: impl WatchDebugCommandAuthority,
        policy: WatchDebugCommandWorkerPolicy,
    ) -> Self {
        let (sender, receiver) = mpsc::sync_channel(policy.queue_capacity);
        let revoked = Arc::new(AtomicBool::new(false));
        let worker_revoked = Arc::clone(&revoked);
        let (completed_tx, completed_rx) = mpsc::sync_channel(1);
        let shutdown_timeout = policy.response_timeout;
        let worker = thread::spawn(move || {
            run_worker(
                runtime,
                authority,
                receiver,
                worker_revoked,
                shutdown_timeout,
            );
            let _ = completed_tx.send(());
        });
        Self {
            owner: Arc::new(WorkerOwner {
                completed: Mutex::new(completed_rx),
                response_timeout: policy.response_timeout,
                revoked,
                sender,
                worker: Mutex::new(Some(worker)),
            }),
        }
    }

    pub(crate) fn execute_bounded(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        if self.owner.revoked.load(Ordering::Acquire) {
            return Err(WatchDebugCommandFailure::Revoked);
        }
        let deadline = Instant::now()
            .checked_add(self.owner.response_timeout)
            .ok_or(WatchDebugCommandFailure::ResponseTimeout)?;
        let (response, result) = mpsc::sync_channel(1);
        match self.owner.sender.try_send(CommandRequest {
            command,
            deadline,
            response,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(WatchDebugCommandFailure::QueueFull),
            Err(TrySendError::Disconnected(_)) => {
                return Err(WatchDebugCommandFailure::WorkerStopped)
            }
        }
        match result.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(WatchDebugCommandFailure::ResponseTimeout),
            Err(RecvTimeoutError::Disconnected) => Err(WatchDebugCommandFailure::WorkerStopped),
        }
    }

    pub(crate) fn revoke(&self) {
        self.owner.stop();
    }
}

impl WatchDebugControlPort for WatchDebugCommandWorkerPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.execute_bounded(command)
    }

    fn revoke(&self) {
        WatchDebugCommandWorkerPort::revoke(self);
    }
}

fn run_worker(
    mut runtime: impl WatchDebugCommandRuntime,
    authority: impl WatchDebugCommandAuthority,
    receiver: Receiver<CommandRequest>,
    revoked: Arc<AtomicBool>,
    shutdown_timeout: Duration,
) {
    while !revoked.load(Ordering::Acquire) {
        let request = match receiver.recv_timeout(WORKER_POLL_INTERVAL) {
            Ok(request) => request,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        let outcome = if revoked.load(Ordering::Acquire) {
            Err(WatchDebugCommandFailure::Revoked)
        } else if Instant::now() >= request.deadline {
            Err(WatchDebugCommandFailure::ResponseTimeout)
        } else if !authority.is_current() {
            Err(WatchDebugCommandFailure::StaleAuthority)
        } else {
            let executed =
                runtime.execute(request.command.clone(), request.deadline, revoked.as_ref());
            if revoked.load(Ordering::Acquire) {
                Err(WatchDebugCommandFailure::Revoked)
            } else if Instant::now() >= request.deadline {
                Err(WatchDebugCommandFailure::ResponseTimeout)
            } else {
                executed.and_then(|response| {
                    response
                        .matches(&request.command)
                        .then_some(response)
                        .ok_or(WatchDebugCommandFailure::ResponseMismatch)
                })
            }
        };
        let _ = request.response.send(outcome);
    }
    while let Ok(request) = receiver.try_recv() {
        let _ = request
            .response
            .send(Err(WatchDebugCommandFailure::Revoked));
    }
    let shutdown_deadline = Instant::now()
        .checked_add(shutdown_timeout)
        .unwrap_or_else(Instant::now);
    runtime.shutdown(shutdown_deadline, revoked.as_ref());
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "debug_node_watch_command_worker_tests.rs"]
mod tests;
