use crate::file_watcher::{
    CommandWatchmanAvailability, NativeNotifyWorkspaceFileWatcher, PreferredWorkspaceFileWatcher,
    WatchmanWorkspaceFileWatcher, WorkspaceFileWatcher, WorkspaceWatchError, WorkspaceWatchEvent,
    WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
    WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
};
use serde::Serialize;
use std::ffi::OsString;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
};
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_FILE_CHANGED_EVENT: &str = "workspace://file-changed";

/// Payload forwarded to the frontend for every workspace file-system change so
/// that external mutations (delete / rename / create / modify done outside the
/// editor) are reflected in the UI tree, tabs and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChangedPayload {
    pub watch_generation: u64,
    pub root_path: String,
    pub kind: WorkspaceWatchEventKind,
    pub path: String,
    pub previous_path: Option<String>,
    pub relative_path: String,
    pub previous_relative_path: Option<String>,
    pub file_kind: Option<WorkspaceWatchFileKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileWatchStartReceipt {
    pub root_path: String,
    pub watch_generation: u64,
}

/// Abstraction over the Tauri event channel so the payload mapping and the
/// per-workspace isolation can be exercised without a live `AppHandle`.
pub trait WorkspaceFileChangeEmitter: Send + Sync {
    /// On failure, returns the number of payloads already emitted so a bounded
    /// retry can resume without duplicating earlier frontend events.
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize>;
}

pub struct AppHandleWorkspaceFileChangeEmitter {
    app: AppHandle,
}

impl AppHandleWorkspaceFileChangeEmitter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WorkspaceFileChangeEmitter for AppHandleWorkspaceFileChangeEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        for (index, payload) in payloads.iter().enumerate() {
            if self
                .app
                .emit(WORKSPACE_FILE_CHANGED_EVENT, payload)
                .is_err()
            {
                return Err(index);
            }
        }
        Ok(())
    }
}

/// Generic, language-agnostic workspace watcher registry. One native watcher
/// session per open workspace root, forwarding every relevant file-system
/// change to the frontend as a `workspace://file-changed` Tauri event.
///
/// This runs independently of (and in addition to) the JavaScript/TypeScript
/// watcher, which only feeds `didChangeWatchedFiles` into the JS/TS language
/// server and never reaches the frontend.
pub struct WorkspaceFileChangeWatchRegistry {
    next_generation: AtomicU64,
    sessions: Mutex<HashMap<String, WorkspaceFileChangeWatchSession>>,
    recovery_by_root: Mutex<HashMap<String, Arc<WorkspaceWatchRecovery>>>,
    transitions: Mutex<HashMap<String, WorkspaceWatchTransition>>,
    stop_completed: Condvar,
    stopping_all: AtomicBool,
}

struct WorkspaceFileChangeWatchSession {
    authority: Arc<WorkspaceWatchSinkAuthority>,
    session: Box<dyn WorkspaceWatchSession>,
}

impl WorkspaceFileChangeWatchSession {
    fn revoke(&self) {
        self.authority.revoke();
    }

    fn stop_backend(&mut self) {
        self.session.stop();
    }
}

fn stop_watch_backend(watch_session: &mut WorkspaceFileChangeWatchSession) {
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        watch_session.stop_backend();
    }))
    .is_err()
    {
        watch_session
            .authority
            .recovery
            .pending
            .store(true, Ordering::Release);
    }
}

enum WorkspaceWatchTransitionKind {
    Starting {
        cancelled: Arc<AtomicBool>,
        authority: Arc<Mutex<Option<Arc<WorkspaceWatchSinkAuthority>>>>,
    },
    Stopping,
}

struct PendingWorkspaceWatchSession {
    authority: Arc<WorkspaceWatchSinkAuthority>,
    session: Option<Box<dyn WorkspaceWatchSession>>,
}

impl PendingWorkspaceWatchSession {
    fn commit(mut self) -> Box<dyn WorkspaceWatchSession> {
        self.session
            .take()
            .expect("pending workspace watch session")
    }
}

impl Drop for PendingWorkspaceWatchSession {
    fn drop(&mut self) {
        if let Some(mut session) = self.session.take() {
            self.authority.revoke();
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| session.stop()));
        }
    }
}

struct WorkspaceWatchTransition {
    token: Arc<()>,
    kind: WorkspaceWatchTransitionKind,
}

struct WorkspaceWatchTransitionReservation<'a> {
    root_key: String,
    token: Arc<()>,
    transitions: &'a Mutex<HashMap<String, WorkspaceWatchTransition>>,
    stop_completed: &'a Condvar,
}

impl Drop for WorkspaceWatchTransitionReservation<'_> {
    fn drop(&mut self) {
        let mut transitions = self
            .transitions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if transitions
            .get(&self.root_key)
            .is_some_and(|transition| Arc::ptr_eq(&transition.token, &self.token))
        {
            transitions.remove(&self.root_key);
        }
        self.stop_completed.notify_all();
    }
}

const MAX_WORKSPACE_WATCH_BATCH_EVENTS: usize = 4_096;
const MAX_WORKSPACE_WATCH_RECOVERY_ROOTS: usize = 128;
const MAX_SAFE_JAVASCRIPT_WATCH_GENERATION: u64 = 9_007_199_254_740_991;
const WORKSPACE_WATCH_TRANSITION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

struct WorkspaceWatchRecovery {
    pending: AtomicBool,
    publishers: AtomicUsize,
}

impl WorkspaceWatchRecovery {
    fn new() -> Self {
        Self {
            pending: AtomicBool::new(false),
            publishers: AtomicUsize::new(0),
        }
    }

    fn is_settled(&self) -> bool {
        self.publishers.load(Ordering::Acquire) == 0 && !self.pending.load(Ordering::Acquire)
    }
}

struct WorkspaceWatchSinkAuthority {
    active: AtomicBool,
    generation: u64,
    recovery: Arc<WorkspaceWatchRecovery>,
    #[cfg(test)]
    before_emit: Mutex<Option<Arc<WorkspaceWatchBeforeEmitGate>>>,
}

impl WorkspaceWatchSinkAuthority {
    #[cfg(test)]
    fn new(generation: u64) -> Self {
        Self::with_recovery(generation, Arc::new(WorkspaceWatchRecovery::new()))
    }

    fn with_recovery(generation: u64, recovery: Arc<WorkspaceWatchRecovery>) -> Self {
        Self {
            active: AtomicBool::new(true),
            generation,
            recovery,
            #[cfg(test)]
            before_emit: Mutex::new(None),
        }
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    fn revoke(&self) {
        self.active.store(false, Ordering::SeqCst);
        if self.recovery.publishers.load(Ordering::SeqCst) > 0 {
            self.recovery.pending.store(true, Ordering::Release);
        }
    }

    fn acquire_publish(&self) -> Option<WorkspaceWatchPublishGuard<'_>> {
        if !self.is_active() {
            return None;
        }

        self.recovery.publishers.fetch_add(1, Ordering::SeqCst);
        if !self.is_active() {
            self.recovery.publishers.fetch_sub(1, Ordering::SeqCst);
            return None;
        }

        Some(WorkspaceWatchPublishGuard {
            recovery: &self.recovery,
        })
    }

    #[cfg(test)]
    fn install_before_emit_gate(&self, gate: Arc<WorkspaceWatchBeforeEmitGate>) {
        *self.before_emit.lock().expect("before emit gate") = Some(gate);
    }

    #[cfg(test)]
    fn wait_before_emit_if_configured(&self) {
        let gate = self.before_emit.lock().expect("before emit gate").clone();
        if let Some(gate) = gate {
            gate.wait();
        }
    }
}

struct WorkspaceWatchPublishGuard<'a> {
    recovery: &'a WorkspaceWatchRecovery,
}

impl Drop for WorkspaceWatchPublishGuard<'_> {
    fn drop(&mut self) {
        self.recovery.publishers.fetch_sub(1, Ordering::SeqCst);
    }
}

struct WorkspaceWatchRecoveryClaim<'a> {
    recovery: &'a WorkspaceWatchRecovery,
    claimed: bool,
    committed: bool,
}

impl<'a> WorkspaceWatchRecoveryClaim<'a> {
    fn acquire(recovery: &'a WorkspaceWatchRecovery) -> Self {
        Self {
            recovery,
            claimed: recovery.pending.swap(false, Ordering::AcqRel),
            committed: false,
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for WorkspaceWatchRecoveryClaim<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.recovery.pending.store(true, Ordering::Release);
        }
    }
}

#[cfg(test)]
struct WorkspaceWatchBeforeEmitGate {
    entered: AtomicBool,
    released: AtomicBool,
}

#[cfg(test)]
impl WorkspaceWatchBeforeEmitGate {
    fn new() -> Self {
        Self {
            entered: AtomicBool::new(false),
            released: AtomicBool::new(false),
        }
    }

    fn wait(&self) {
        self.entered.store(true, Ordering::Release);
        while !self.released.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
    }

    fn wait_until_entered(&self) {
        for _ in 0..100 {
            if self.entered.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        panic!("publish did not reach the before-emit gate");
    }

    fn release(&self) {
        self.released.store(true, Ordering::Release);
    }
}

impl WorkspaceFileChangeWatchRegistry {
    pub fn new() -> Self {
        Self {
            next_generation: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
            recovery_by_root: Mutex::new(HashMap::new()),
            transitions: Mutex::new(HashMap::new()),
            stop_completed: Condvar::new(),
            stopping_all: AtomicBool::new(false),
        }
    }

    pub fn start(
        &self,
        root_path: &str,
        app: AppHandle,
    ) -> Result<WorkspaceFileWatchStartReceipt, String> {
        let watcher = PreferredWorkspaceFileWatcher::new(
            WatchmanWorkspaceFileWatcher,
            NativeNotifyWorkspaceFileWatcher,
            CommandWatchmanAvailability,
        );

        self.start_with_watcher(root_path, &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(AppHandleWorkspaceFileChangeEmitter::new(app)),
                root_path: root_key.to_string(),
            })
        })
    }

    fn start_with_watcher(
        &self,
        root_path: &str,
        watcher: &dyn WorkspaceFileWatcher,
        sink_factory: impl FnOnce(
            &str,
            Arc<WorkspaceWatchSinkAuthority>,
        ) -> Arc<dyn WorkspaceWatchEventSink>,
    ) -> Result<WorkspaceFileWatchStartReceipt, String> {
        let root = PathBuf::from(root_path)
            .canonicalize()
            .map_err(|error| format!("Failed to watch workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let transition_deadline = std::time::Instant::now() + WORKSPACE_WATCH_TRANSITION_TIMEOUT;
        let (start_reservation, start_cancelled, start_authority) = loop {
            let sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if self.stopping_all.load(Ordering::SeqCst) {
                return Err("Workspace watchers are stopping.".to_string());
            }
            if let Some(session) = sessions.get(&root_key) {
                return Ok(WorkspaceFileWatchStartReceipt {
                    root_path: root_key,
                    watch_generation: session.authority.generation,
                });
            }
            let mut transitions = self
                .transitions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if !transitions.contains_key(&root_key) {
                if self.stopping_all.load(Ordering::SeqCst) {
                    return Err("Workspace watchers are stopping.".to_string());
                }
                let mut recovery_by_root = self
                    .recovery_by_root
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                recovery_by_root.retain(|key, recovery| {
                    sessions.contains_key(key)
                        || transitions.contains_key(key)
                        || !recovery.is_settled()
                });
                if sessions.len() + transitions.len() >= MAX_WORKSPACE_WATCH_RECOVERY_ROOTS {
                    return Err(format!(
                        "Workspace watch recovery capacity ({MAX_WORKSPACE_WATCH_RECOVERY_ROOTS}) was reached."
                    ));
                }
                if !recovery_by_root.contains_key(&root_key)
                    && recovery_by_root.len() >= MAX_WORKSPACE_WATCH_RECOVERY_ROOTS
                {
                    return Err(format!(
                        "Workspace watch recovery capacity ({MAX_WORKSPACE_WATCH_RECOVERY_ROOTS}) was reached."
                    ));
                }
                let token = Arc::new(());
                let cancelled = Arc::new(AtomicBool::new(false));
                let authority = Arc::new(Mutex::new(None));
                transitions.insert(
                    root_key.clone(),
                    WorkspaceWatchTransition {
                        token: Arc::clone(&token),
                        kind: WorkspaceWatchTransitionKind::Starting {
                            cancelled: Arc::clone(&cancelled),
                            authority: Arc::clone(&authority),
                        },
                    },
                );
                let reservation = WorkspaceWatchTransitionReservation {
                    root_key: root_key.clone(),
                    token,
                    transitions: &self.transitions,
                    stop_completed: &self.stop_completed,
                };
                drop(transitions);
                drop(sessions);
                break (reservation, cancelled, authority);
            }
            drop(sessions);
            let now = std::time::Instant::now();
            if now >= transition_deadline {
                return Err("Workspace watch transition timed out.".to_string());
            }
            let (transitions, timeout) = self
                .stop_completed
                .wait_timeout(transitions, transition_deadline - now)
                .unwrap_or_else(|error| error.into_inner());
            if timeout.timed_out() && transitions.contains_key(&root_key) {
                return Err("Workspace watch transition timed out.".to_string());
            }
            drop(transitions);
        };

        let generation = self
            .next_generation
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |generation| {
                (generation < MAX_SAFE_JAVASCRIPT_WATCH_GENERATION).then_some(generation + 1)
            })
            .map_err(|_| "Workspace watch generation space is exhausted.".to_string())?;
        let recovery = {
            let sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let transitions = self
                .transitions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let mut recovery_by_root = self
                .recovery_by_root
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            recovery_by_root.retain(|key, recovery| {
                sessions.contains_key(key)
                    || transitions.contains_key(key)
                    || !recovery.is_settled()
            });
            if !recovery_by_root.contains_key(&root_key)
                && recovery_by_root.len() >= MAX_WORKSPACE_WATCH_RECOVERY_ROOTS
            {
                return Err(format!(
                    "Workspace watch recovery capacity ({MAX_WORKSPACE_WATCH_RECOVERY_ROOTS}) was reached."
                ));
            }
            recovery_by_root
                .entry(root_key.clone())
                .or_insert_with(|| Arc::new(WorkspaceWatchRecovery::new()))
                .clone()
        };
        let authority = Arc::new(WorkspaceWatchSinkAuthority::with_recovery(
            generation, recovery,
        ));
        *start_authority
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(Arc::clone(&authority));
        if start_cancelled.load(Ordering::Acquire) || self.stopping_all.load(Ordering::SeqCst) {
            authority.revoke();
            self.remove_settled_recovery(&root_key, &authority.recovery);
            return Err("Workspace watch start was cancelled.".to_string());
        }
        let sink = sink_factory(&root_key, Arc::clone(&authority));
        let session = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            watcher.watch(WorkspaceWatchRequest::new(root), Arc::clone(&sink))
        })) {
            Ok(Ok(session)) => session,
            Ok(Err(error)) => {
                authority.recovery.pending.store(true, Ordering::Release);
                authority.revoke();
                self.remove_settled_recovery(&root_key, &authority.recovery);
                return Err(format!("Failed to start workspace watcher: {error}"));
            }
            Err(_) => {
                authority.recovery.pending.store(true, Ordering::Release);
                authority.revoke();
                self.remove_settled_recovery(&root_key, &authority.recovery);
                return Err("Failed to start workspace watcher: backend panicked.".to_string());
            }
        };
        let pending_session = PendingWorkspaceWatchSession {
            authority: Arc::clone(&authority),
            session: Some(session),
        };
        if start_cancelled.load(Ordering::Acquire) {
            authority.recovery.pending.store(true, Ordering::Release);
            drop(pending_session);
            self.remove_settled_recovery(&root_key, &authority.recovery);
            return Err("Workspace watch start was cancelled.".to_string());
        }
        if authority.recovery.pending.load(Ordering::Acquire) {
            sink.publish(WorkspaceWatchEventBatch {
                events: vec![WorkspaceWatchEvent {
                    backend: crate::file_watcher::WorkspaceWatchBackend::Native,
                    file_kind: Some(WorkspaceWatchFileKind::Directory),
                    kind: WorkspaceWatchEventKind::RescanRequired,
                    path: root_key.clone(),
                    previous_path: None,
                    previous_relative_path: None,
                    relative_path: String::new(),
                    root_path: root_key.clone(),
                }],
            });
        }
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let transitions = self
            .transitions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let may_commit = !self.stopping_all.load(Ordering::SeqCst)
            && !start_cancelled.load(Ordering::Acquire)
            && transitions
                .get(&root_key)
                .is_some_and(|transition| Arc::ptr_eq(&transition.token, &start_reservation.token));
        if may_commit {
            let session = pending_session.commit();
            sessions.insert(
                root_key.clone(),
                WorkspaceFileChangeWatchSession { authority, session },
            );
            drop(transitions);
            drop(sessions);
            drop(start_reservation);
            return Ok(WorkspaceFileWatchStartReceipt {
                root_path: root_key,
                watch_generation: generation,
            });
        }
        drop(transitions);
        drop(sessions);
        authority.revoke();
        authority.recovery.pending.store(true, Ordering::Release);
        drop(pending_session);
        self.remove_settled_recovery(&root_key, &authority.recovery);
        Err("Workspace watch start was cancelled.".to_string())
    }

    pub fn stop(&self, root_path: &str) {
        let candidates = workspace_watch_id_candidates(&PathBuf::from(root_path));
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(root_key) = candidates
            .iter()
            .cloned()
            .into_iter()
            .find(|candidate| sessions.contains_key(candidate))
        else {
            let mut transitions = self
                .transitions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let pending_start = candidates.into_iter().find(|candidate| {
                transitions.get(candidate).is_some_and(|transition| {
                    if let WorkspaceWatchTransitionKind::Starting {
                        cancelled,
                        authority,
                    } = &transition.kind
                    {
                        cancelled.store(true, Ordering::Release);
                        if let Some(authority) = authority
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .as_ref()
                        {
                            authority.revoke();
                        }
                        true
                    } else {
                        false
                    }
                })
            });
            drop(sessions);
            if let Some(root_key) = pending_start {
                let deadline = std::time::Instant::now() + WORKSPACE_WATCH_TRANSITION_TIMEOUT;
                while transitions.contains_key(&root_key) {
                    let now = std::time::Instant::now();
                    if now >= deadline {
                        break;
                    }
                    let (next, timeout) = self
                        .stop_completed
                        .wait_timeout(transitions, deadline - now)
                        .unwrap_or_else(|error| error.into_inner());
                    transitions = next;
                    if timeout.timed_out() {
                        break;
                    }
                }
            }
            return;
        };
        let Some(mut watch_session) = sessions.remove(&root_key) else {
            return;
        };
        watch_session.revoke();
        let stop_reservation = self.reserve_stopping(root_key.clone());
        drop(sessions);

        stop_watch_backend(&mut watch_session);
        self.remove_settled_recovery(&root_key, &watch_session.authority.recovery);
        drop(stop_reservation);
    }

    pub fn stop_generation(&self, root_path: &str, watch_generation: u64) -> bool {
        let Some(watch_session) = (|| {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let matching_key = workspace_watch_id_candidates(&PathBuf::from(root_path))
                .into_iter()
                .find(|candidate| {
                    sessions
                        .get(candidate)
                        .is_some_and(|session| session.authority.generation == watch_generation)
                })?;
            let session = sessions.remove(&matching_key)?;
            session.revoke();
            let reservation = self.reserve_stopping(matching_key.clone());
            Some((matching_key, session, reservation))
        })() else {
            return false;
        };

        let (matching_key, mut watch_session, stop_reservation) = watch_session;
        stop_watch_backend(&mut watch_session);
        self.remove_settled_recovery(&matching_key, &watch_session.authority.recovery);
        drop(stop_reservation);
        true
    }

    pub fn stop_all(&self) {
        if self
            .stopping_all
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            let deadline = std::time::Instant::now() + WORKSPACE_WATCH_TRANSITION_TIMEOUT;
            let mut transitions = self
                .transitions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            while self.stopping_all.load(Ordering::SeqCst) {
                let now = std::time::Instant::now();
                if now >= deadline {
                    break;
                }
                let (next, timeout) = self
                    .stop_completed
                    .wait_timeout(transitions, deadline - now)
                    .unwrap_or_else(|error| error.into_inner());
                transitions = next;
                if timeout.timed_out() {
                    break;
                }
            }
            return;
        }
        struct StopAllGuard<'a> {
            stopping_all: &'a AtomicBool,
            stop_completed: &'a Condvar,
        }
        impl Drop for StopAllGuard<'_> {
            fn drop(&mut self) {
                self.stopping_all.store(false, Ordering::SeqCst);
                self.stop_completed.notify_all();
            }
        }
        let _stop_all_guard = StopAllGuard {
            stopping_all: &self.stopping_all,
            stop_completed: &self.stop_completed,
        };
        {
            let transitions = self
                .transitions
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            for transition in transitions.values() {
                if let WorkspaceWatchTransitionKind::Starting {
                    cancelled,
                    authority,
                } = &transition.kind
                {
                    cancelled.store(true, Ordering::Release);
                    if let Some(authority) = authority
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .as_ref()
                    {
                        authority.revoke();
                    }
                }
            }
        }
        let sessions = self
            .sessions
            .lock()
            .map(|mut sessions| {
                let sessions = sessions
                    .drain()
                    .map(|(root_key, session)| {
                        session.revoke();
                        (root_key, session)
                    })
                    .collect::<Vec<_>>();
                sessions
            })
            .unwrap_or_else(|error| {
                let mut sessions = error.into_inner();
                sessions
                    .drain()
                    .map(|(root_key, session)| {
                        session.revoke();
                        (root_key, session)
                    })
                    .collect()
            });

        let mut reserved_sessions = sessions
            .into_iter()
            .map(|(root_key, watch_session)| {
                let stop_reservation = self.reserve_stopping(root_key.clone());
                (root_key, watch_session, stop_reservation)
            })
            .collect::<Vec<_>>();
        for (root_key, watch_session, _stop_reservation) in &mut reserved_sessions {
            stop_watch_backend(watch_session);
            self.remove_settled_recovery(root_key, &watch_session.authority.recovery);
        }
        drop(reserved_sessions);

        let deadline = std::time::Instant::now() + WORKSPACE_WATCH_TRANSITION_TIMEOUT;
        let mut transitions = self
            .transitions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while transitions.values().any(|transition| {
            matches!(
                transition.kind,
                WorkspaceWatchTransitionKind::Starting { .. }
            )
        }) {
            let now = std::time::Instant::now();
            if now >= deadline {
                break;
            }
            let (next, timeout) = self
                .stop_completed
                .wait_timeout(transitions, deadline - now)
                .unwrap_or_else(|error| error.into_inner());
            transitions = next;
            if timeout.timed_out() {
                break;
            }
        }
    }

    fn reserve_stopping(&self, root_key: String) -> WorkspaceWatchTransitionReservation<'_> {
        let token = Arc::new(());
        self.transitions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                root_key.clone(),
                WorkspaceWatchTransition {
                    token: Arc::clone(&token),
                    kind: WorkspaceWatchTransitionKind::Stopping,
                },
            );
        WorkspaceWatchTransitionReservation {
            root_key,
            token,
            transitions: &self.transitions,
            stop_completed: &self.stop_completed,
        }
    }

    fn remove_settled_recovery(&self, root_key: &str, expected: &Arc<WorkspaceWatchRecovery>) {
        let Ok(mut recovery_by_root) = self.recovery_by_root.lock() else {
            return;
        };
        if recovery_by_root
            .get(root_key)
            .is_some_and(|current| Arc::ptr_eq(current, expected) && current.is_settled())
        {
            recovery_by_root.remove(root_key);
        }
    }
}

impl Default for WorkspaceFileChangeWatchRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WorkspaceFileChangeWatchRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

struct WorkspaceFileChangeSink {
    authority: Arc<WorkspaceWatchSinkAuthority>,
    emitter: Arc<dyn WorkspaceFileChangeEmitter>,
    root_path: String,
}

impl WorkspaceWatchEventSink for WorkspaceFileChangeSink {
    fn error(&self, _error: WorkspaceWatchError) {
        self.publish(WorkspaceWatchEventBatch {
            events: vec![WorkspaceWatchEvent {
                backend: crate::file_watcher::WorkspaceWatchBackend::Native,
                file_kind: Some(WorkspaceWatchFileKind::Directory),
                kind: WorkspaceWatchEventKind::RescanRequired,
                path: self.root_path.clone(),
                previous_path: None,
                previous_relative_path: None,
                relative_path: String::new(),
                root_path: self.root_path.clone(),
            }],
        });
    }

    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        let Some(_publish_guard) = self.authority.acquire_publish() else {
            return;
        };
        let mut recovery_claim = WorkspaceWatchRecoveryClaim::acquire(&self.authority.recovery);
        let oversized = batch.events.len() > MAX_WORKSPACE_WATCH_BATCH_EVENTS;
        let force_rescan = oversized || recovery_claim.claimed;
        let events = if oversized {
            &[][..]
        } else {
            batch.events.as_slice()
        };
        let payloads = workspace_file_changed_payloads(
            &self.root_path,
            self.authority.generation,
            events,
            force_rescan,
        );

        if payloads.is_empty() {
            recovery_claim.commit();
            return;
        }

        #[cfg(test)]
        self.authority.wait_before_emit_if_configured();
        if !self.authority.is_active() {
            return;
        }

        if let Err(published) = self.emitter.emit_file_changes(&payloads) {
            if !self.authority.is_active() {
                return;
            }
            if self
                .emitter
                .emit_file_changes(&payloads[published..])
                .is_err()
            {
                if !self.authority.is_active() {
                    return;
                }
                let recovery = WorkspaceFileChangedPayload {
                    watch_generation: self.authority.generation,
                    root_path: self.root_path.clone(),
                    kind: WorkspaceWatchEventKind::RescanRequired,
                    path: self.root_path.clone(),
                    previous_path: None,
                    relative_path: String::new(),
                    previous_relative_path: None,
                    file_kind: None,
                };
                if self.emitter.emit_file_changes(&[recovery]).is_err() {
                    self.authority
                        .recovery
                        .pending
                        .store(true, Ordering::Release);
                }
            }
        }
        recovery_claim.commit();
    }
}

/// Maps raw watch events to exact-generation frontend payloads. Concrete events
/// outside the watched root and malformed/foreign rescan claims fail closed.
/// A valid rescan is preserved alongside concrete events so consumers can
/// invalidate caches without losing the actionable portion of a mixed batch.
fn workspace_file_changed_payloads(
    root_path: &str,
    watch_generation: u64,
    events: &[WorkspaceWatchEvent],
    force_rescan: bool,
) -> Vec<WorkspaceFileChangedPayload> {
    let mut payloads = events
        .iter()
        .filter(|event| !matches!(event.kind, WorkspaceWatchEventKind::RescanRequired))
        .flat_map(|event| {
            workspace_file_changed_payloads_for_event(root_path, watch_generation, event)
        })
        .collect::<Vec<_>>();
    if force_rescan
        || events.iter().any(|event| {
            matches!(event.kind, WorkspaceWatchEventKind::RescanRequired)
                && rescan_event_matches_root(root_path, event)
        })
    {
        payloads.push(WorkspaceFileChangedPayload {
            watch_generation,
            root_path: root_path.to_string(),
            kind: WorkspaceWatchEventKind::RescanRequired,
            path: root_path.to_string(),
            previous_path: None,
            relative_path: String::new(),
            previous_relative_path: None,
            file_kind: None,
        });
    }
    payloads
}

fn workspace_file_changed_payloads_for_event(
    root_path: &str,
    watch_generation: u64,
    event: &WorkspaceWatchEvent,
) -> Vec<WorkspaceFileChangedPayload> {
    if !matches!(event.kind, WorkspaceWatchEventKind::Renamed) {
        return workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            event.kind,
            &event.path,
            None,
            event.file_kind,
        )
        .into_iter()
        .collect();
    }

    let previous_path = event.previous_path.as_deref();
    let previous_inside = previous_path.is_some_and(|path| is_path_inside_root(root_path, path));
    let current_inside = is_path_inside_root(root_path, &event.path);
    match (previous_inside, current_inside) {
        (true, true) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Renamed,
            &event.path,
            previous_path,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (true, false) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Deleted,
            previous_path.expect("previous path was checked"),
            None,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (false, true) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Created,
            &event.path,
            None,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (false, false) => Vec::new(),
    }
}

fn workspace_file_changed_payload_for_path(
    root_path: &str,
    watch_generation: u64,
    kind: WorkspaceWatchEventKind,
    path: &str,
    previous_path: Option<&str>,
    file_kind: Option<WorkspaceWatchFileKind>,
) -> Option<WorkspaceFileChangedPayload> {
    let relative_path = relative_path_inside_root(root_path, path)?;
    let previous_relative_path = match previous_path {
        Some(path) => Some(relative_path_inside_root(root_path, path)?),
        None => None,
    };
    Some(WorkspaceFileChangedPayload {
        watch_generation,
        root_path: root_path.to_string(),
        kind,
        path: path.to_string(),
        previous_path: previous_path.map(str::to_string),
        relative_path,
        previous_relative_path,
        file_kind,
    })
}

fn relative_path_inside_root(root_path: &str, path: &str) -> Option<String> {
    let root = normalize_path(Path::new(root_path));
    let path = normalize_path(Path::new(path));
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn rescan_event_matches_root(root_path: &str, event: &WorkspaceWatchEvent) -> bool {
    normalize_path(Path::new(&event.root_path)) == normalize_path(Path::new(root_path))
        && normalize_path(Path::new(&event.path)) == normalize_path(Path::new(root_path))
        && event.relative_path.is_empty()
        && event.previous_path.is_none()
        && event.previous_relative_path.is_none()
        && event.file_kind == Some(WorkspaceWatchFileKind::Directory)
}

fn is_path_inside_root(root_path: &str, path: &str) -> bool {
    let root = normalize_path(Path::new(root_path));
    let path = normalize_path(Path::new(path));

    if root.as_os_str().is_empty() {
        return false;
    }

    path.starts_with(root)
}

fn workspace_watch_id(root_path: &Path) -> String {
    workspace_watch_id_candidates(root_path)
        .into_iter()
        .next()
        .unwrap_or_default()
}

fn workspace_watch_id_candidates(root_path: &Path) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(canonical) = root_path.canonicalize() {
        push_unique_path_key(&mut candidates, &canonical);
    }

    if let Some(resolved) = resolve_existing_or_parent_path(root_path) {
        push_unique_path_key(&mut candidates, &resolved);
    }

    push_unique_path_key(&mut candidates, &normalize_path(root_path));
    candidates
}

fn resolve_existing_or_parent_path(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components: Vec<OsString> = Vec::new();

    while !cursor.exists() {
        missing_components.push(cursor.file_name()?.to_os_string());

        if !cursor.pop() {
            return None;
        }
    }

    let mut resolved = cursor.canonicalize().ok()?;

    while let Some(component) = missing_components.pop() {
        resolved.push(component);
    }

    Some(normalize_path(&resolved))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn push_unique_path_key(candidates: &mut Vec<String>, path: &Path) {
    let key = path_key(path);

    if !candidates.contains(&key) {
        candidates.push(key);
    }
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests;
