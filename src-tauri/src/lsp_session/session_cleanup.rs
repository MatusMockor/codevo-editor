use super::{
    reject_pending_requests, LanguageServerRuntimeStatus, ProcessKiller, RunningSession,
    StatusPublicationQueue, StatusSink,
};
use std::collections::VecDeque;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

const BACKGROUND_REAPER_SETTLEMENT_TIMEOUT: Duration = Duration::from_millis(250);
const BACKGROUND_REAPER_RETRY_DELAY: Duration = Duration::from_millis(10);
pub(super) const SESSION_CLEANUP_SETTLEMENT_TIMEOUT: Duration = Duration::from_millis(350);
const MAX_RETAINED_SESSION_OWNERS: usize = 64;
const MAX_REAPER_QUEUE_ITEMS: usize = MAX_RETAINED_SESSION_OWNERS * 4;
const SHARED_REAPER_WORKERS: usize = 4;

struct SessionOwnershipAdmission {
    capacity: usize,
    retained: AtomicUsize,
}

impl SessionOwnershipAdmission {
    fn reserve(&'static self) -> Result<SessionOwnershipPermit, String> {
        self.retained
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                (current < self.capacity).then_some(current + 1)
            })
            .map(|_| SessionOwnershipPermit { admission: self })
            .map_err(|_| {
                format!(
                    "Language server process ownership capacity ({}) was reached.",
                    self.capacity
                )
            })
    }
}

static SESSION_OWNERSHIP_ADMISSION: SessionOwnershipAdmission = SessionOwnershipAdmission {
    capacity: MAX_RETAINED_SESSION_OWNERS,
    retained: AtomicUsize::new(0),
};

pub(super) struct SessionOwnershipPermit {
    admission: &'static SessionOwnershipAdmission,
}

pub(super) fn reserve_session_ownership() -> Result<SessionOwnershipPermit, String> {
    ensure_shared_reaper_pool()?;
    SESSION_OWNERSHIP_ADMISSION.reserve()
}

impl Drop for SessionOwnershipPermit {
    fn drop(&mut self) {
        self.admission.retained.fetch_sub(1, Ordering::SeqCst);
    }
}

pub(super) enum ProcessKillerState {
    Ready(Box<dyn ProcessKiller>),
    Terminating,
    Terminated,
}

pub(super) struct ProcessKillerSlot {
    pub(super) state: Mutex<ProcessKillerState>,
    cleanup_queued: AtomicBool,
    settled: Condvar,
}

impl ProcessKillerSlot {
    pub(super) fn new(killer: Box<dyn ProcessKiller>) -> Self {
        Self {
            state: Mutex::new(ProcessKillerState::Ready(killer)),
            cleanup_queued: AtomicBool::new(false),
            settled: Condvar::new(),
        }
    }
}

pub(super) type SharedProcessKiller = Arc<ProcessKillerSlot>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LifecycleOperation {
    Idle,
    Spawning,
    Stopping,
}

pub(super) struct LifecycleGate {
    operation: Mutex<LifecycleOperation>,
    settled: Condvar,
}

impl LifecycleGate {
    pub(super) fn new() -> Self {
        Self {
            operation: Mutex::new(LifecycleOperation::Idle),
            settled: Condvar::new(),
        }
    }

    pub(super) fn acquire(&self, operation: LifecycleOperation) -> LifecyclePermit<'_> {
        let mut current = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *current != LifecycleOperation::Idle {
            current = self
                .settled
                .wait(current)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        *current = operation;
        drop(current);
        LifecyclePermit { gate: self }
    }
}

pub(super) struct LifecyclePermit<'a> {
    gate: &'a LifecycleGate,
}

impl Drop for LifecyclePermit<'_> {
    fn drop(&mut self) {
        let mut operation = self
            .gate
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *operation = LifecycleOperation::Idle;
        drop(operation);
        self.gate.settled.notify_all();
    }
}

pub(super) struct SessionReaderHandles {
    _ownership_permit: SessionOwnershipPermit,
    cancellation_workers: Vec<JoinHandle<()>>,
    notification_writer: Option<JoinHandle<()>>,
    reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<()>>,
}

pub(super) enum SessionCleanupOutcome {
    Complete {
        readers: SessionReaderHandles,
    },
    Failed {
        message: String,
        session: RunningSession,
    },
}

pub(super) struct SessionCleanupTask {
    pub(super) handle: JoinHandle<SessionCleanupOutcome>,
    pub(super) status_sink: Arc<dyn StatusSink>,
}

enum ReaperWork {
    CleanupTask(SessionCleanupTask),
    Killer(SharedProcessKiller),
    KillerTask {
        handle: JoinHandle<io::Result<()>>,
        killer: SharedProcessKiller,
    },
    ProvisionalProcess {
        handles: Vec<JoinHandle<()>>,
        killer: SharedProcessKiller,
        ownership_permit: SessionOwnershipPermit,
    },
    ProvisionalTask {
        handle: JoinHandle<io::Result<()>>,
        handles: Vec<JoinHandle<()>>,
        killer: SharedProcessKiller,
        ownership_permit: SessionOwnershipPermit,
    },
    ReaderTask(JoinHandle<()>),
    Readers(SessionReaderHandles),
    Session {
        session: RunningSession,
        settled: Option<std::sync::mpsc::SyncSender<()>>,
    },
    SessionTask {
        handle: JoinHandle<io::Result<()>>,
        session: RunningSession,
        settled: Option<std::sync::mpsc::SyncSender<()>>,
    },
}

#[derive(Default)]
struct SharedReaperState {
    in_flight: usize,
    queued: VecDeque<ReaperWork>,
    worker_count: usize,
    workers: Vec<JoinHandle<()>>,
}

struct SharedReaper {
    state: Mutex<SharedReaperState>,
    ready: Condvar,
}

fn shared_reaper() -> &'static SharedReaper {
    static REAPER: OnceLock<SharedReaper> = OnceLock::new();
    REAPER.get_or_init(|| SharedReaper {
        state: Mutex::new(SharedReaperState::default()),
        ready: Condvar::new(),
    })
}

fn enqueue_reaper_work(work: ReaperWork) {
    let reaper = shared_reaper();
    let mut state = reaper
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    debug_assert!(state.worker_count > 0);
    assert!(
        state.queued.len() < MAX_REAPER_QUEUE_ITEMS,
        "language server cleanup queue exceeded its hard admission bound"
    );
    state.queued.push_back(work);
    drop(state);
    reaper.ready.notify_one();
}

fn ensure_shared_reaper_pool() -> Result<(), String> {
    let reaper = shared_reaper();
    let mut state = reaper
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while state.worker_count < SHARED_REAPER_WORKERS {
        let worker_index = state.worker_count + 1;
        match std::thread::Builder::new()
            .name(format!("lsp-shared-session-reaper-{worker_index}"))
            .spawn(shared_reaper_loop)
        {
            Ok(handle) => {
                state.worker_count += 1;
                state.workers.push(handle);
            }
            Err(error) => {
                return Err(format!(
                    "Failed to establish all {SHARED_REAPER_WORKERS} language server cleanup workers: {error}"
                ));
            }
        }
    }
    Ok(())
}

fn shared_reaper_loop() {
    let reaper = shared_reaper();
    loop {
        let work = {
            let mut state = reaper
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            while state.queued.is_empty() {
                state = reaper
                    .ready
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            state.in_flight += 1;
            state.queued.pop_front().expect("queued reaper work")
        };

        match work {
            ReaperWork::Killer(killer) => {
                let task_killer = Arc::clone(&killer);
                match std::thread::Builder::new()
                    .name("lsp-process-cleanup-item".to_string())
                    .spawn(move || loop {
                        let termination = terminate_process(&task_killer);
                        if termination.is_ok() {
                            break termination;
                        }
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                    }) {
                    Ok(handle) => {
                        enqueue_reaper_work(ReaperWork::KillerTask { handle, killer });
                    }
                    Err(_) => {
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                        enqueue_reaper_work(ReaperWork::Killer(killer));
                    }
                }
            }
            ReaperWork::KillerTask { handle, killer } => {
                if handle.is_finished() {
                    match handle.join() {
                        Ok(Ok(())) => {
                            killer.cleanup_queued.store(false, Ordering::Release);
                        }
                        Ok(Err(_)) | Err(_) => enqueue_reaper_work(ReaperWork::Killer(killer)),
                    }
                } else {
                    enqueue_reaper_work(ReaperWork::KillerTask { handle, killer });
                    std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                }
            }
            ReaperWork::Session { session, settled } => {
                mark_session_stopping(&session);
                let killer = Arc::clone(&session.killer);
                match std::thread::Builder::new()
                    .name("lsp-session-cleanup-item".to_string())
                    .spawn(move || loop {
                        let termination = terminate_process(&killer);
                        if termination.is_ok() {
                            break termination;
                        }
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                    }) {
                    Ok(handle) => enqueue_reaper_work(ReaperWork::SessionTask {
                        handle,
                        session,
                        settled,
                    }),
                    Err(_) => {
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                        enqueue_reaper_work(ReaperWork::Session { session, settled });
                    }
                }
            }
            ReaperWork::SessionTask {
                handle,
                mut session,
                settled,
            } => {
                if handle.is_finished() {
                    match handle.join() {
                        Ok(Ok(())) => {
                            let readers = finalize_terminated_session(&mut session);
                            enqueue_reaper_work(ReaperWork::Readers(readers));
                            if let Some(settled) = settled {
                                let _ = settled.send(());
                            }
                        }
                        Ok(Err(_)) | Err(_) => {
                            enqueue_reaper_work(ReaperWork::Session { session, settled });
                        }
                    }
                } else {
                    enqueue_reaper_work(ReaperWork::SessionTask {
                        handle,
                        session,
                        settled,
                    });
                    std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                }
            }
            ReaperWork::CleanupTask(task) => {
                if task.handle.is_finished() {
                    match task.handle.join() {
                        Ok(SessionCleanupOutcome::Complete { readers }) => {
                            enqueue_reaper_work(ReaperWork::Readers(readers));
                        }
                        Ok(SessionCleanupOutcome::Failed { session, .. }) => {
                            enqueue_reaper_work(ReaperWork::Session {
                                session,
                                settled: None,
                            });
                        }
                        Err(_) => {}
                    }
                } else {
                    enqueue_reaper_work(ReaperWork::CleanupTask(task));
                    std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                }
            }
            ReaperWork::ProvisionalProcess {
                handles,
                killer,
                ownership_permit,
            } => {
                let task_killer = Arc::clone(&killer);
                match std::thread::Builder::new()
                    .name("lsp-provisional-cleanup-item".to_string())
                    .spawn(move || loop {
                        let termination = terminate_process(&task_killer);
                        if termination.is_ok() {
                            break termination;
                        }
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                    }) {
                    Ok(handle) => enqueue_reaper_work(ReaperWork::ProvisionalTask {
                        handle,
                        handles,
                        killer,
                        ownership_permit,
                    }),
                    Err(_) => {
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                        enqueue_reaper_work(ReaperWork::ProvisionalProcess {
                            handles,
                            killer,
                            ownership_permit,
                        });
                    }
                }
            }
            ReaperWork::ProvisionalTask {
                handle,
                handles,
                killer,
                ownership_permit,
            } => {
                if handle.is_finished() {
                    match handle.join() {
                        Ok(Ok(())) => retain_provisional_handles(handles, ownership_permit),
                        Ok(Err(_)) | Err(_) => {
                            enqueue_reaper_work(ReaperWork::ProvisionalProcess {
                                handles,
                                killer,
                                ownership_permit,
                            });
                        }
                    }
                } else {
                    enqueue_reaper_work(ReaperWork::ProvisionalTask {
                        handle,
                        handles,
                        killer,
                        ownership_permit,
                    });
                    std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                }
            }
            ReaperWork::Readers(readers) => {
                let retained = Arc::new(Mutex::new(Some(readers)));
                let worker_retained = Arc::clone(&retained);
                match std::thread::Builder::new()
                    .name("lsp-reader-join-item".to_string())
                    .spawn(move || {
                        let readers = worker_retained
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .take()
                            .expect("reader join ownership");
                        join_retained_readers(readers);
                    }) {
                    Ok(handle) => enqueue_reaper_work(ReaperWork::ReaderTask(handle)),
                    Err(_) => {
                        let readers = retained
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .take()
                            .expect("failed reader dispatch retains ownership");
                        std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                        enqueue_reaper_work(ReaperWork::Readers(readers));
                    }
                }
            }
            ReaperWork::ReaderTask(handle) => {
                if handle.is_finished() {
                    let _ = handle.join();
                } else {
                    enqueue_reaper_work(ReaperWork::ReaderTask(handle));
                    std::thread::sleep(BACKGROUND_REAPER_RETRY_DELAY);
                }
            }
        }
        let mut state = reaper
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.in_flight -= 1;
        drop(state);
        reaper.ready.notify_all();
    }
}

fn retain_provisional_handles(
    handles: Vec<JoinHandle<()>>,
    ownership_permit: SessionOwnershipPermit,
) {
    enqueue_reaper_work(ReaperWork::Readers(SessionReaderHandles {
        _ownership_permit: ownership_permit,
        cancellation_workers: handles,
        notification_writer: None,
        reader: None,
        stderr_reader: None,
    }));
}

fn join_retained_readers(mut readers: SessionReaderHandles) {
    for cancellation_worker in readers.cancellation_workers.drain(..) {
        let _ = cancellation_worker.join();
    }
    if let Some(notification_writer) = readers.notification_writer.take() {
        let _ = notification_writer.join();
    }
    if let Some(reader) = readers.reader.take() {
        let _ = reader.join();
    }
    if let Some(stderr_reader) = readers.stderr_reader.take() {
        let _ = stderr_reader.join();
    }
}

pub(super) fn retain_cleanup_task(task: SessionCleanupTask) {
    enqueue_reaper_work(ReaperWork::CleanupTask(task));
}

pub(super) fn retain_provisional_process(
    killer: SharedProcessKiller,
    ownership_permit: SessionOwnershipPermit,
    handles: Vec<JoinHandle<()>>,
) {
    enqueue_reaper_work(ReaperWork::ProvisionalProcess {
        handles,
        killer,
        ownership_permit,
    });
}

pub(super) fn retain_process_termination(killer: SharedProcessKiller) -> Result<(), String> {
    ensure_shared_reaper_pool()?;
    if killer
        .cleanup_queued
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }
    enqueue_reaper_work(ReaperWork::Killer(killer));
    Ok(())
}

pub(super) fn terminate_or_retain_process(killer: &SharedProcessKiller) {
    if terminate_process(killer).is_err() {
        let _retained_cleanup = retain_process_termination(Arc::clone(killer));
    }
}

#[cfg(test)]
pub(super) fn wait_for_shared_reaper_idle(timeout: Duration) -> bool {
    let reaper = shared_reaper();
    let deadline = std::time::Instant::now() + timeout;
    let mut state = reaper
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while !state.queued.is_empty() || state.in_flight != 0 {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return false;
        }
        let (next, wait) = reaper
            .ready
            .wait_timeout(state, remaining)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state = next;
        if wait.timed_out() && (!state.queued.is_empty() || state.in_flight != 0) {
            return false;
        }
    }
    true
}

fn prepare_session_termination(
    session: &mut RunningSession,
) -> Result<SessionReaderHandles, String> {
    mark_session_stopping(session);
    if let Err(error) = terminate_process(&session.killer) {
        return Err(format!(
            "Language server process termination failed: {error}"
        ));
    }
    Ok(finalize_terminated_session(session))
}

fn mark_session_stopping(session: &RunningSession) {
    session.stop_requested.store(true, Ordering::SeqCst);
    reject_pending_requests(
        &session.pending_requests,
        "Language server request was stopped.",
    );
}

fn finalize_terminated_session(session: &mut RunningSession) -> SessionReaderHandles {
    let cancellation_workers = session.cancellation_transport.revoke_for_cleanup();
    let notification_writer = session.exact_notification_transport.revoke_for_cleanup();
    SessionReaderHandles {
        _ownership_permit: session
            .ownership_permit
            .take()
            .expect("running session owns cleanup admission"),
        cancellation_workers,
        notification_writer,
        reader: session.reader.take(),
        stderr_reader: session.stderr_reader.take(),
    }
}

pub(super) fn retain_session_readers(readers: SessionReaderHandles) {
    enqueue_reaper_work(ReaperWork::Readers(readers));
}

pub(super) fn terminate_session(session: RunningSession) {
    let (settled_tx, settled_rx) = sync_channel(1);
    enqueue_reaper_work(ReaperWork::Session {
        session,
        settled: Some(settled_tx),
    });

    match settled_rx.recv_timeout(BACKGROUND_REAPER_SETTLEMENT_TIMEOUT) {
        Ok(()) | Err(RecvTimeoutError::Disconnected) | Err(RecvTimeoutError::Timeout) => {}
    }
}

pub(super) fn cleanup_session(session: RunningSession) -> SessionCleanupOutcome {
    let mut session = session;
    let termination = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        prepare_session_termination(&mut session)
    }))
    .unwrap_or_else(|_| Err("Language server cleanup panicked.".to_string()));
    match termination {
        Ok(readers) => SessionCleanupOutcome::Complete { readers },
        Err(message) => SessionCleanupOutcome::Failed { message, session },
    }
}

pub(super) fn terminate_process(killer: &SharedProcessKiller) -> io::Result<()> {
    let mut state = killer
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while matches!(*state, ProcessKillerState::Terminating) {
        state = killer
            .settled
            .wait(state)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
    if matches!(*state, ProcessKillerState::Terminated) {
        return Ok(());
    }
    let ProcessKillerState::Ready(process_killer) =
        std::mem::replace(&mut *state, ProcessKillerState::Terminating)
    else {
        unreachable!("settled process killer is ready or terminated");
    };

    let mut process_killer = process_killer;
    let termination =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| process_killer.terminate()))
            .unwrap_or_else(|_| Err(io::Error::other("process termination panicked")));
    if termination.is_ok() {
        *state = ProcessKillerState::Terminated;
    } else {
        *state = ProcessKillerState::Ready(process_killer);
    }
    drop(state);
    killer.settled.notify_all();
    termination
}

pub(super) fn publish_crash_for_active_session(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    publications: &StatusPublicationQueue,
    sink: &Arc<dyn StatusSink>,
    stop_requested: &Arc<AtomicBool>,
    session_id: u64,
    message: &str,
) -> bool {
    let crashed = LanguageServerRuntimeStatus::Crashed {
        message: message.to_string(),
    };
    let should_publish = {
        let mut current = status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if stop_requested.load(Ordering::SeqCst)
            || !matches!(
                &*current,
                LanguageServerRuntimeStatus::Starting {
                    session_id: active
                } | LanguageServerRuntimeStatus::Running {
                    session_id: active,
                    ..
                } if *active == session_id
            )
        {
            false
        } else {
            *current = crashed.clone();
            true
        }
    };
    if should_publish && publications.publish(Arc::clone(sink), crashed).is_err() {
        return false;
    }
    should_publish
}

#[cfg(test)]
mod admission_tests {
    use super::*;

    struct CountingKiller(Arc<AtomicUsize>);

    impl ProcessKiller for CountingKiller {
        fn terminate(&mut self) -> io::Result<()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn permanent_cleanup_storm_is_fail_closed_at_the_owner_capacity() {
        static ADMISSION: SessionOwnershipAdmission = SessionOwnershipAdmission {
            capacity: 3,
            retained: AtomicUsize::new(0),
        };
        let first = ADMISSION.reserve().expect("first owner");
        let _second = ADMISSION.reserve().expect("second owner");
        let _third = ADMISSION.reserve().expect("third owner");
        assert!(ADMISSION.reserve().is_err());

        drop(first);
        let _replacement = ADMISSION.reserve().expect("released owner readmits");
    }

    #[test]
    fn production_admission_bootstraps_the_fixed_reaper_pool_before_spawn() {
        let permit = reserve_session_ownership().expect("cleanup ownership admission");
        let state = shared_reaper()
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(state.worker_count, SHARED_REAPER_WORKERS);
        drop(state);
        drop(permit);
    }

    #[test]
    fn repeated_exact_killer_retention_is_deduplicated_and_bounded() {
        let terminate_count = Arc::new(AtomicUsize::new(0));
        let killer = Arc::new(ProcessKillerSlot::new(Box::new(CountingKiller(
            Arc::clone(&terminate_count),
        ))));
        for _ in 0..1_000 {
            retain_process_termination(Arc::clone(&killer)).expect("retain exact killer");
        }
        assert!(wait_for_shared_reaper_idle(Duration::from_secs(1)));
        assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
        let state = shared_reaper()
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(state.queued.len() <= MAX_REAPER_QUEUE_ITEMS);
    }
}
