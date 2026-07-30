#[cfg(test)]
use super::event_sinks::{NoopRefreshSink, NoopWorkspaceEditSink};
use super::session_cleanup::SESSION_CLEANUP_SETTLEMENT_TIMEOUT;
use super::{
    append_runtime_log, cleanup_session, is_active_status, maybe_restart_after_crash,
    prepare_cancel_pending_request, publish_crash_for_active_session, record_recent_request,
    request_dispatch, reserve_session_ownership, reset_request_telemetry, reset_runtime_log,
    retain_cleanup_task, retain_provisional_process, retain_session_readers, send_initialized,
    send_request_with_timeout, server_configuration, set_status, snapshot_recent_requests,
    snapshot_stderr_tail, spawn_reader, spawn_stderr_reader, terminate_session,
    write_with_session_stdin, CancellationTransport, DiagnosticsSink,
    ExactSessionNotificationOutcome, ExactSessionNotificationTransport, HandshakeOutcome,
    LanguageServerCapabilities, LanguageServerEventSinks, LanguageServerRequestError,
    LanguageServerRuntimeStatus, LanguageServerSupervisor, LifecycleGate, LifecycleOperation,
    PendingRequestRegistry, ProjectResyncRequestOutcome, RecentLspRequest, RefreshSink,
    RestartContext, RestartController, RunningSession, ServerProcessSpawner, SessionCleanupOutcome,
    SessionCleanupTask, SessionMessageWriter, SessionRequestParts, StartKind, StatusSink,
    StderrTailBuffer, WorkspaceEditSink, HANDSHAKE_TIMEOUT, REQUEST_TIMEOUT,
};
use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

enum CleanupSettlement {
    None,
    Complete {
        status_sink: Arc<dyn StatusSink>,
    },
    Failed {
        message: String,
        session: RunningSession,
        status_sink: Arc<dyn StatusSink>,
    },
    Pending {
        status_sink: Arc<dyn StatusSink>,
    },
    Panicked {
        status_sink: Arc<dyn StatusSink>,
    },
}

impl LanguageServerSupervisor {
    pub fn new() -> Self {
        Self::new_with_label("PHPactor")
    }

    pub fn new_with_label(server_label: &'static str) -> Self {
        Self::new_with_session_id_source(server_label, Arc::new(AtomicU64::new(1)))
    }

    pub(super) fn new_with_session_id_source(
        server_label: &'static str,
        next_session_id: Arc<AtomicU64>,
    ) -> Self {
        let status = Arc::new(Mutex::new(LanguageServerRuntimeStatus::Stopped));
        Self {
            cleanup_task: Mutex::new(None),
            cleanup_terminal_failure: Mutex::new(None),
            lifecycle_gate: LifecycleGate::new(),
            log: Arc::new(Mutex::new(String::new())),
            recent_requests: Arc::new(Mutex::new(Default::default())),
            stderr_tail: Arc::new(Mutex::new(StderrTailBuffer::default())),
            next_request_id: AtomicU64::new(2),
            next_session_id,
            server_label,
            session: Mutex::new(None),
            status: Arc::clone(&status),
            status_publications: Arc::new(super::StatusPublicationQueue::new(status)),
        }
    }

    /// Snapshot of the most recent LSP requests (newest first) for this runtime's
    /// diagnostic cockpit view. Bounded ring buffer scoped to this supervisor, so
    /// telemetry never leaks across workspace tabs.
    pub fn recent_requests(&self) -> Vec<RecentLspRequest> {
        snapshot_recent_requests(&self.recent_requests)
    }

    /// Snapshot of the trailing stderr lines for this runtime (oldest-to-newest).
    pub fn stderr_tail(&self) -> Vec<String> {
        snapshot_stderr_tail(&self.stderr_tail)
    }

    pub fn status(&self) -> LanguageServerRuntimeStatus {
        match self.status.lock() {
            Ok(status) => status.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn publish_crash_if_current_session(
        &self,
        sink: &Arc<dyn StatusSink>,
        session_id: u64,
        message: &str,
    ) {
        let crashed = LanguageServerRuntimeStatus::Crashed {
            message: message.to_string(),
        };
        let should_publish = {
            let mut status = self
                .status
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if matches!(
                &*status,
                LanguageServerRuntimeStatus::Starting {
                    session_id: current
                } | LanguageServerRuntimeStatus::Running {
                    session_id: current,
                    ..
                } if *current == session_id
            ) {
                *status = crashed.clone();
                true
            } else {
                false
            }
        };
        if should_publish {
            if let Err(error) = self.status_publications.publish(Arc::clone(sink), crashed) {
                append_runtime_log(
                    &self.log,
                    &format!("Language server status publication failed: {error}\n"),
                );
            }
        }
    }

    fn cleanup_task_exists(&self) -> bool {
        self.cleanup_task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }

    fn cleanup_terminal_failure(&self) -> Option<String> {
        self.cleanup_terminal_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn retain_cleanup_terminal_failure(&self, message: &str) {
        *self
            .cleanup_terminal_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.to_string());
    }

    fn start_cleanup_task(
        &self,
        session: RunningSession,
    ) -> Result<(), (Box<RunningSession>, String)> {
        let status_sink = Arc::clone(&session.status_sink);
        let ownership = Arc::new(Mutex::new(Some(session)));
        let worker_ownership = Arc::clone(&ownership);
        let handle = match std::thread::Builder::new()
            .name("lsp-session-cleanup".to_string())
            .spawn(move || {
                let session = worker_ownership
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                    .expect("cleanup worker owns an exact session");
                cleanup_session(session)
            }) {
            Ok(handle) => handle,
            Err(error) => {
                let session = ownership
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                    .expect("failed spawn retains session ownership");
                return Err((
                    Box::new(session),
                    format!("Failed to start language server cleanup worker: {error}"),
                ));
            }
        };
        let task = SessionCleanupTask {
            handle,
            status_sink,
        };
        let mut current = self
            .cleanup_task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert!(current.is_none());
        *current = Some(task);
        Ok(())
    }

    fn await_cleanup_settlement(&self, timeout: Duration) -> CleanupSettlement {
        let deadline = Instant::now() + timeout;
        loop {
            let task = self
                .cleanup_task
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            let Some(task) = task else {
                return CleanupSettlement::None;
            };
            if task.handle.is_finished() {
                let status_sink = task.status_sink;
                return match task.handle.join() {
                    Ok(SessionCleanupOutcome::Complete { readers }) => {
                        retain_session_readers(readers);
                        CleanupSettlement::Complete { status_sink }
                    }
                    Ok(SessionCleanupOutcome::Failed { message, session }) => {
                        CleanupSettlement::Failed {
                            message,
                            session,
                            status_sink,
                        }
                    }
                    Err(_) => CleanupSettlement::Panicked { status_sink },
                };
            }

            let status_sink = Arc::clone(&task.status_sink);
            *self
                .cleanup_task
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(task);
            if Instant::now() >= deadline {
                return CleanupSettlement::Pending { status_sink };
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn restore_failed_cleanup_session(&self, session: RunningSession) {
        let mut current = self
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert!(current.is_none());
        *current = Some(session);
    }

    fn retain_session_cleanup(&self, session: RunningSession) {
        if !self.cleanup_task_exists() {
            if let Err((session, message)) = self.start_cleanup_task(session) {
                self.restore_failed_cleanup_session(*session);
                set_status(
                    &self.status,
                    LanguageServerRuntimeStatus::Crashed { message },
                );
                return;
            }
        }
        match self.await_cleanup_settlement(SESSION_CLEANUP_SETTLEMENT_TIMEOUT) {
            CleanupSettlement::None | CleanupSettlement::Complete { .. } => {}
            CleanupSettlement::Failed {
                message, session, ..
            } => {
                self.restore_failed_cleanup_session(session);
                set_status(
                    &self.status,
                    LanguageServerRuntimeStatus::Crashed { message },
                );
            }
            CleanupSettlement::Pending { .. } => set_status(
                &self.status,
                LanguageServerRuntimeStatus::Crashed {
                    message: "Language server cleanup is still pending.".to_string(),
                },
            ),
            CleanupSettlement::Panicked { .. } => set_status(&self.status, {
                let message = "Language server cleanup worker panicked.".to_string();
                self.retain_cleanup_terminal_failure(&message);
                LanguageServerRuntimeStatus::Crashed { message }
            }),
        }
    }

    /// OS process id of the currently installed session, when one is running.
    /// `None` once the server has stopped/crashed (its session was torn down) or
    /// when the underlying spawner exposes no real process (tests).
    pub fn pid(&self) -> Option<u32> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .and_then(|session| session.pid)
    }

    pub fn log(&self) -> String {
        self.log.lock().map(|log| log.clone()).unwrap_or_default()
    }

    #[cfg(test)]
    pub fn start(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_workspace_edit_sink(
            command,
            initialize_request,
            spawner,
            LanguageServerEventSinks::new(
                status_sink,
                diagnostics_sink,
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
        )
    }

    #[cfg(test)]
    pub(super) fn start_with_workspace_edit_sink(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        event_sinks: LanguageServerEventSinks,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_event_sinks(command, initialize_request, spawner, event_sinks)
    }

    #[cfg(test)]
    pub(super) fn start_with_event_sinks(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        event_sinks: LanguageServerEventSinks,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let LanguageServerEventSinks {
            status,
            diagnostics,
            workspace_edit,
            refresh,
        } = event_sinks;
        self.start_core(
            command,
            initialize_request,
            spawner,
            status,
            diagnostics,
            workspace_edit,
            refresh,
            None,
            StartKind::Fresh,
        )
    }

    /// Start a session that automatically re-spawns the language server when it
    /// crashes unexpectedly (not on a requested shutdown). Restarts are governed
    /// by `restart_controller`: an exponential backoff with a bounded number of
    /// attempts inside a sliding window. A healthy session regains budget only
    /// after the previous attempts age out of that window.
    ///
    /// The spawner is owned (`Arc<… + Send + Sync>`) so the background restart
    /// can re-spawn the server for the *same* workspace without touching any
    /// other workspace's supervisor.
    ///
    /// Production opt-in: call this from the registry/`lib.rs` start path with a
    /// `ChildServerProcessSpawner` wrapped in `Arc` and `RestartController::default()`
    /// to enable crash auto-restart. Wired into both the PHP (phpactor) and
    /// JavaScript/TypeScript start paths via the registry wrapper of the same name.
    pub fn start_with_auto_restart(
        self: &Arc<Self>,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        event_sinks: LanguageServerEventSinks,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_auto_restart_kind(
            command,
            initialize_request,
            spawner,
            event_sinks,
            restart_controller,
            StartKind::Fresh,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn start_core(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_context: Option<Arc<RestartContext>>,
        start_kind: StartKind,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let session_id = self
            .next_session_id
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                current.checked_add(1)
            })
            .map_err(|_| "Language server session id capacity was exhausted.".to_string())?;
        self.terminate_stale_session();
        reset_runtime_log(&self.log, self.server_label, session_id, command);
        reset_request_telemetry(&self.recent_requests, &self.stderr_tail);
        self.begin_start(&status_sink, session_id, start_kind)?;
        let spawning = self.lifecycle_gate.acquire(LifecycleOperation::Spawning);
        self.require_start_transition(session_id)?;
        if self.cleanup_task_exists() || self.cleanup_terminal_failure().is_some() {
            let message = "Language server cleanup is still pending.".to_string();
            self.publish_crash_if_current_session(&status_sink, session_id, &message);
            return Err(message);
        }

        let ownership_permit = match reserve_session_ownership() {
            Ok(permit) => permit,
            Err(message) => {
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                return Err(message);
            }
        };
        let spawned = match spawner.spawn(command) {
            Ok(spawned) => spawned,
            Err(error) => {
                let message = format!("Failed to start {}: {error}", self.server_label);
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                return Err(message);
            }
        };

        let stdin = Arc::clone(&spawned.stdin);
        let pending_requests = Arc::new(PendingRequestRegistry::new());
        let stop_requested = Arc::new(AtomicBool::new(false));
        let server_configuration = Arc::new(Mutex::new(
            server_configuration::from_initialize_request(initialize_request),
        ));
        let pid = spawned.killer.pid();
        let killer = Arc::new(super::ProcessKillerSlot::new(spawned.killer));
        let mut ownership_permit = Some(ownership_permit);
        let writer_failure_killer = Arc::clone(&killer);
        let writer_failure_log = Arc::clone(&self.log);
        let writer_failure_label = self.server_label;
        stdin.set_failure_handler(Arc::new(move |error| {
            append_runtime_log(
                &writer_failure_log,
                &format!(
                    "{writer_failure_label} session {session_id} stdin transport failed: {error}\n"
                ),
            );
            if let Err(retain_error) =
                super::retain_process_termination(Arc::clone(&writer_failure_killer))
            {
                append_runtime_log(
                    &writer_failure_log,
                    &format!(
                        "{writer_failure_label} session {session_id} durable stdin cleanup failed: {retain_error}\n"
                    ),
                );
            }
        }));
        let failure_status = Arc::clone(&self.status);
        let failure_publications = Arc::clone(&self.status_publications);
        let failure_sink = Arc::clone(&status_sink);
        let failure_stop_requested = Arc::clone(&stop_requested);
        let failure_restart_context = restart_context.clone();
        let cancellation_failure_reporter = Arc::new(move |message: String| {
            let published = publish_crash_for_active_session(
                &failure_status,
                failure_publications.as_ref(),
                &failure_sink,
                &failure_stop_requested,
                session_id,
                &message,
            );
            if published {
                maybe_restart_after_crash(&failure_restart_context, &failure_stop_requested);
            }
        });
        let cancellation_transport = match CancellationTransport::start(
            session_id,
            Arc::clone(&stdin),
            Arc::clone(&killer),
            Arc::clone(&self.log),
            self.server_label,
            cancellation_failure_reporter,
        ) {
            Ok(transport) => transport,
            Err(error) => {
                retain_provisional_process(
                    Arc::clone(&killer),
                    ownership_permit
                        .take()
                        .expect("spawned process owns cleanup admission"),
                    Vec::new(),
                );
                let message = format!("Failed to start cancellation transport: {error}");
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                return Err(message);
            }
        };
        let exact_notification_transport = match ExactSessionNotificationTransport::start(
            session_id,
            Arc::clone(&stdin),
            &cancellation_transport,
        ) {
            Ok(transport) => transport,
            Err(error) => {
                let handles = cancellation_transport.revoke_for_cleanup();
                retain_provisional_process(
                    Arc::clone(&killer),
                    ownership_permit
                        .take()
                        .expect("spawned process owns cleanup admission"),
                    handles,
                );
                let message = format!("Failed to start exact notification transport: {error}");
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                return Err(message);
            }
        };
        let stderr_reader = if let Some(stderr) = spawned.stderr {
            match spawn_stderr_reader(stderr, Arc::clone(&self.log), Arc::clone(&self.stderr_tail))
            {
                Ok(reader) => Some(reader),
                Err(error) => {
                    let mut handles = cancellation_transport.revoke_for_cleanup();
                    handles.extend(exact_notification_transport.revoke_for_cleanup());
                    retain_provisional_process(
                        Arc::clone(&killer),
                        ownership_permit
                            .take()
                            .expect("spawned process owns cleanup admission"),
                        handles,
                    );
                    let message = format!("Failed to start stderr reader: {error}");
                    self.publish_crash_if_current_session(&status_sink, session_id, &message);
                    return Err(message);
                }
            }
        } else {
            None
        };
        let mut session = Some(RunningSession {
            ownership_permit,
            cancellation_transport,
            exact_notification_transport,
            pid,
            stderr_reader,
            stdin: Arc::clone(&stdin),
            killer: Arc::clone(&killer),
            pending_requests: Arc::clone(&pending_requests),
            reader: None,
            server_configuration: Arc::clone(&server_configuration),
            session_id,
            status_sink: Arc::clone(&status_sink),
            stop_requested: Arc::clone(&stop_requested),
        });

        let installed = self.install_session(&mut session);
        drop(spawning);
        if !installed {
            if let Some(session) = session {
                terminate_session(session);
            }

            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        let init_bytes = match serde_json::to_vec(initialize_request) {
            Ok(bytes) => bytes,
            Err(error) => {
                let message = format!("Failed to serialize initialize request: {error}");
                self.terminate_matching_session(&stop_requested);
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                return Err(message);
            }
        };

        if let Err(error) = write_with_session_stdin(&stdin, &init_bytes) {
            let message = format!("Failed to send initialize: {error}");
            self.terminate_matching_session(&stop_requested);
            self.publish_crash_if_current_session(&status_sink, session_id, &message);
            return Err(message);
        }

        let (handshake_tx, handshake_rx) = mpsc::channel();
        let workspace_root = command.working_directory.clone();
        let mut reader = Some(spawn_reader(
            spawned.stdout,
            Arc::clone(&stdin),
            Arc::clone(&self.status),
            Arc::clone(&self.status_publications),
            Arc::clone(&self.log),
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            pending_requests,
            Arc::clone(&status_sink),
            Arc::clone(&stop_requested),
            handshake_tx,
            initialize_request.id,
            session_id,
            self.server_label,
            server_configuration,
            workspace_root,
            restart_context.clone(),
            killer,
        ));

        if !self.attach_reader(&stop_requested, &mut reader) {
            if let Some(reader) = reader {
                let _ = reader.join();
            }

            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        match handshake_rx.recv_timeout(HANDSHAKE_TIMEOUT) {
            Ok(HandshakeOutcome::Ready(capabilities)) => {
                if stop_requested.load(Ordering::SeqCst) {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                if let Err(message) = send_initialized(&stdin) {
                    stop_requested.store(true, Ordering::SeqCst);
                    self.terminate_matching_session(&stop_requested);
                    self.publish_crash_if_current_session(&status_sink, session_id, &message);
                    return Err(message);
                }

                self.publish_running_if_starting(
                    &status_sink,
                    &stop_requested,
                    session_id,
                    capabilities,
                )
            }
            Ok(HandshakeOutcome::Failed(message)) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                Err(message)
            }
            Ok(HandshakeOutcome::Disconnected) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                let message = format!("{} exited during the handshake.", self.server_label);
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                Err(message)
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped || matches!(self.status(), LanguageServerRuntimeStatus::Stopped) {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                let message = format!(
                    "{} did not respond to initialize in time.",
                    self.server_label
                );
                self.publish_crash_if_current_session(&status_sink, session_id, &message);
                Err(message)
            }
        }
    }

    pub fn stop(&self) -> LanguageServerRuntimeStatus {
        let stopping = self.lifecycle_gate.acquire(LifecycleOperation::Stopping);
        if let Some(message) = self.cleanup_terminal_failure() {
            let status = LanguageServerRuntimeStatus::Crashed { message };
            set_status(&self.status, status.clone());
            drop(stopping);
            return status;
        }
        if !self.cleanup_task_exists() {
            if let Some(session) = self.take_session() {
                if let Err((session, message)) = self.start_cleanup_task(session) {
                    let status_sink = Arc::clone(&session.status_sink);
                    self.restore_failed_cleanup_session(*session);
                    let status = LanguageServerRuntimeStatus::Crashed { message };
                    set_status(&self.status, status.clone());
                    drop(stopping);
                    if let Err(error) = self
                        .status_publications
                        .publish(status_sink, status.clone())
                    {
                        append_runtime_log(
                            &self.log,
                            &format!("Language server status publication failed: {error}\n"),
                        );
                    }
                    return status;
                }
            }
        }

        let settlement = self.await_cleanup_settlement(SESSION_CLEANUP_SETTLEMENT_TIMEOUT);
        let (status, status_sink) = match settlement {
            CleanupSettlement::None => (LanguageServerRuntimeStatus::Stopped, None),
            CleanupSettlement::Complete { status_sink } => {
                (LanguageServerRuntimeStatus::Stopped, Some(status_sink))
            }
            CleanupSettlement::Failed {
                message,
                session,
                status_sink,
            } => {
                self.restore_failed_cleanup_session(session);
                (
                    LanguageServerRuntimeStatus::Crashed { message },
                    Some(status_sink),
                )
            }
            CleanupSettlement::Pending { status_sink } => (
                LanguageServerRuntimeStatus::Crashed {
                    message: "Language server cleanup is still pending.".to_string(),
                },
                Some(status_sink),
            ),
            CleanupSettlement::Panicked { status_sink } => (
                {
                    let message = "Language server cleanup worker panicked.".to_string();
                    self.retain_cleanup_terminal_failure(&message);
                    LanguageServerRuntimeStatus::Crashed { message }
                },
                Some(status_sink),
            ),
        };
        set_status(&self.status, status.clone());
        drop(stopping);
        if let Some(status_sink) = status_sink {
            if let Err(error) = self
                .status_publications
                .publish(status_sink, status.clone())
            {
                append_runtime_log(
                    &self.log,
                    &format!("Language server status publication failed: {error}\n"),
                );
            }
        }
        status
    }

    pub fn send_notification(&self, notification: &JsonRpcNotification) -> Result<(), String> {
        if !matches!(self.status(), LanguageServerRuntimeStatus::Running { .. }) {
            return Ok(());
        }

        let Some(stdin) = self.session_stdin() else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(notification)
            .map_err(|error| format!("Failed to serialize LSP notification: {error}"))?;

        write_with_session_stdin(&stdin, &bytes)
            .map_err(|error| format!("Failed to send LSP notification: {error}"))
    }

    pub(super) fn send_notification_for_session_outcome(
        &self,
        expected_session_id: u64,
        notification: &JsonRpcNotification,
    ) -> Result<ExactSessionNotificationOutcome, String> {
        let bytes = serde_json::to_vec(notification)
            .map_err(|error| format!("Failed to serialize LSP notification: {error}"))?;
        let Some(transport) = self.exact_notification_transport_for(expected_session_id) else {
            return Ok(ExactSessionNotificationOutcome::Stale);
        };

        transport
            .send(bytes)
            .map(|()| ExactSessionNotificationOutcome::Admitted)
            .map_err(|error| format!("Failed to send LSP notification: {error}"))
    }

    #[cfg(test)]
    pub(super) fn send_notification_for_session(
        &self,
        expected_session_id: u64,
        notification: &JsonRpcNotification,
    ) -> Result<(), String> {
        self.send_notification_for_session_outcome(expected_session_id, notification)
            .map(|_| ())
    }

    pub fn update_server_configuration(&self, server_configuration: Value) -> Result<(), String> {
        let Some(session_configuration) = self.session_server_configuration() else {
            return Ok(());
        };

        let mut current = session_configuration
            .lock()
            .map_err(|error| error.to_string())?;
        *current = server_configuration;
        Ok(())
    }

    pub fn send_request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Option<Value>, LanguageServerRequestError> {
        send_request_with_timeout(self, method, params, None, None, REQUEST_TIMEOUT)
    }

    pub(super) fn send_request_with_id(
        &self,
        session_id: u64,
        request_id: u64,
        method: &str,
        params: Value,
    ) -> Result<Option<Value>, LanguageServerRequestError> {
        send_request_with_timeout(
            self,
            method,
            params,
            Some(session_id),
            Some(request_id),
            REQUEST_TIMEOUT,
        )
    }

    #[cfg(test)]
    pub(super) fn send_request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Option<Value>, LanguageServerRequestError> {
        send_request_with_timeout(self, method, params, None, None, timeout)
    }

    pub(super) fn prepare_cancel_request(
        &self,
        session_id: u64,
        request_id: u64,
    ) -> Result<Option<request_dispatch::PendingCancelWrite>, LanguageServerRequestError> {
        prepare_cancel_pending_request(self, session_id, request_id)
    }

    pub(super) fn request_project_resync(
        &self,
        expected_session_id: u64,
    ) -> Result<ProjectResyncRequestOutcome, String> {
        let status = self.status();
        let killer = {
            let session = self.session.lock().map_err(|error| error.to_string())?;
            let Some(session) = session.as_ref() else {
                return Ok(ProjectResyncRequestOutcome::Unavailable);
            };
            if session.session_id != expected_session_id {
                return Ok(match status {
                    LanguageServerRuntimeStatus::Running { session_id, .. }
                        if session_id == session.session_id && session_id > expected_session_id =>
                    {
                        ProjectResyncRequestOutcome::SupersededByFreshSession
                    }
                    _ => ProjectResyncRequestOutcome::Unavailable,
                });
            }
            if session.stop_requested.load(Ordering::SeqCst)
                || !matches!(
                    status,
                    LanguageServerRuntimeStatus::Running { session_id, .. }
                        if session_id == expected_session_id
                )
            {
                return Ok(ProjectResyncRequestOutcome::Unavailable);
            }
            append_runtime_log(
                &self.log,
                &format!(
                    "{} session {expected_session_id} project resync requested after watcher overflow\n",
                    self.server_label
                ),
            );
            Arc::clone(&session.killer)
        };
        super::terminate_or_retain_process(&killer);
        Ok(ProjectResyncRequestOutcome::Admitted)
    }

    /// Record one completed request into the bounded recent-requests ring buffer.
    pub(super) fn allocate_wire_request_id(&self) -> Result<u64, LanguageServerRequestError> {
        self.next_request_id
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                current.checked_add(1)
            })
            .map_err(|_| {
                LanguageServerRequestError::from(
                    "Language server wire request id capacity was exhausted.",
                )
            })
    }

    pub(super) fn record_request_outcome_for_session(
        &self,
        session_id: u64,
        method: &str,
        started_at: Instant,
        success: bool,
    ) {
        self.record_request_outcome_for_session_after_check(
            session_id,
            method,
            started_at,
            success,
            || {},
        );
    }

    pub(super) fn record_request_outcome_for_session_after_check(
        &self,
        session_id: u64,
        method: &str,
        started_at: Instant,
        success: bool,
        after_check: impl FnOnce(),
    ) {
        let Ok(session) = self.session.lock() else {
            return;
        };
        let Some(current) = session.as_ref() else {
            return;
        };
        if current.session_id != session_id || current.stop_requested.load(Ordering::SeqCst) {
            return;
        }
        after_check();
        record_recent_request(
            &self.recent_requests,
            RecentLspRequest {
                method: method.to_string(),
                latency_ms: started_at.elapsed().as_millis() as u64,
                success,
            },
        );
    }

    pub(super) fn begin_start(
        &self,
        sink: &Arc<dyn StatusSink>,
        session_id: u64,
        start_kind: StartKind,
    ) -> Result<(), String> {
        let (previous, status_admission) = {
            let mut status = self.status.lock().map_err(|error| error.to_string())?;
            let reserved_fresh_is_current = matches!(
                (&*status, start_kind),
                (
                    LanguageServerRuntimeStatus::Starting { session_id: 0 },
                    StartKind::ReservedFresh
                )
            );

            if matches!(start_kind, StartKind::ReservedFresh) && !reserved_fresh_is_current {
                return Err("Language server start reservation is no longer current.".to_string());
            }

            if is_active_status(&status) && !reserved_fresh_is_current {
                return Err("Language server already running.".to_string());
            }

            // An auto-restart may only resume a session that is *still* crashed.
            if matches!(start_kind, StartKind::Restart)
                && !matches!(*status, LanguageServerRuntimeStatus::Crashed { .. })
            {
                return Err("Auto-restart aborted: session is no longer crashed.".to_string());
            }

            let status_admission = self.status_publications.admit_sink(sink)?;
            let previous = status.clone();
            *status = LanguageServerRuntimeStatus::Starting { session_id };
            (previous, status_admission)
        };

        if let Err(error) = sink.begin_exact_session_transition(session_id) {
            self.restore_failed_start_transition(session_id, previous.clone())?;
            return Err(format!(
                "Failed to advance {} document-session admission: {error}",
                self.server_label
            ));
        }
        self.require_start_transition(session_id)?;
        if let Err(error) = self.status_publications.publish(
            Arc::clone(sink),
            LanguageServerRuntimeStatus::Starting { session_id },
        ) {
            self.restore_failed_start_transition(session_id, previous)?;
            return Err(error);
        }
        status_admission.commit();
        if let Err(error) = self.require_start_transition(session_id) {
            let corrective = self.status();
            if !matches!(
                corrective,
                LanguageServerRuntimeStatus::Starting {
                    session_id: current
                } if current == session_id
            ) {
                if let Err(publication_error) = self
                    .status_publications
                    .publish(Arc::clone(sink), corrective)
                {
                    return Err(format!(
                        "{error}; corrective publication failed: {publication_error}"
                    ));
                }
            }
            return Err(error);
        }
        Ok(())
    }

    fn require_start_transition(&self, session_id: u64) -> Result<(), String> {
        let status = self.status.lock().map_err(|error| error.to_string())?;
        if matches!(
            *status,
            LanguageServerRuntimeStatus::Starting {
                session_id: current
            } if current == session_id
        ) {
            Ok(())
        } else {
            Err("Language server start transition was superseded.".to_string())
        }
    }

    fn restore_failed_start_transition(
        &self,
        session_id: u64,
        previous: LanguageServerRuntimeStatus,
    ) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;
        if matches!(
            *status,
            LanguageServerRuntimeStatus::Starting {
                session_id: current
            } if current == session_id
        ) {
            *status = previous;
        }
        Ok(())
    }

    fn install_session(&self, session: &mut Option<RunningSession>) -> bool {
        let mut current = self
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if !matches!(self.status(), LanguageServerRuntimeStatus::Starting { .. }) {
            return false;
        }

        if current.is_some() {
            return false;
        }

        *current = session.take();
        true
    }

    fn attach_reader(
        &self,
        stop_requested: &Arc<AtomicBool>,
        reader: &mut Option<JoinHandle<()>>,
    ) -> bool {
        let mut current = self
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(session) = current.as_mut() else {
            return false;
        };

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return false;
        }

        session.reader = reader.take();
        true
    }

    pub(super) fn publish_running_if_starting(
        &self,
        sink: &Arc<dyn StatusSink>,
        stop_requested: &Arc<AtomicBool>,
        session_id: u64,
        capabilities: LanguageServerCapabilities,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let running = LanguageServerRuntimeStatus::Running {
            session_id,
            capabilities: capabilities.clone(),
        };
        {
            let mut status = self.status.lock().map_err(|error| error.to_string())?;

            if stop_requested.load(Ordering::SeqCst) {
                *status = LanguageServerRuntimeStatus::Stopped;
                return Ok(LanguageServerRuntimeStatus::Stopped);
            }

            if let LanguageServerRuntimeStatus::Crashed { message } = &*status {
                let message = message.clone();
                drop(status);
                self.terminate_matching_session(stop_requested);
                return Err(message);
            }

            if *status != (LanguageServerRuntimeStatus::Starting { session_id }) {
                return Ok(status.clone());
            }

            *status = running.clone();
        }
        if let Err(error) = self
            .status_publications
            .publish(Arc::clone(sink), running.clone())
        {
            let message = format!("Language server running status publication failed: {error}");
            set_status(
                &self.status,
                LanguageServerRuntimeStatus::Crashed {
                    message: message.clone(),
                },
            );
            self.terminate_matching_session(stop_requested);
            return Err(message);
        }
        let current = self.status();
        if current == running {
            Ok(running)
        } else {
            self.status_publications
                .publish(Arc::clone(sink), current.clone())?;
            Ok(current)
        }
    }

    fn terminate_stale_session(&self) {
        if is_active_status(&self.status()) {
            return;
        }

        let cleanup = self.lifecycle_gate.acquire(LifecycleOperation::Stopping);
        if is_active_status(&self.status()) {
            return;
        }
        match self.await_cleanup_settlement(Duration::ZERO) {
            CleanupSettlement::None | CleanupSettlement::Complete { .. } => {}
            CleanupSettlement::Failed {
                message, session, ..
            } => {
                self.restore_failed_cleanup_session(session);
                set_status(
                    &self.status,
                    LanguageServerRuntimeStatus::Crashed { message },
                );
            }
            CleanupSettlement::Pending { .. } => return,
            CleanupSettlement::Panicked { .. } => {
                let message = "Language server cleanup worker panicked.".to_string();
                self.retain_cleanup_terminal_failure(&message);
                set_status(
                    &self.status,
                    LanguageServerRuntimeStatus::Crashed { message },
                );
                return;
            }
        }
        if let Some(session) = self.take_session() {
            self.retain_session_cleanup(session);
        }
        drop(cleanup);
    }

    fn terminate_matching_session(&self, stop_requested: &Arc<AtomicBool>) {
        let cleanup = self.lifecycle_gate.acquire(LifecycleOperation::Stopping);
        let Some(session) = self.take_matching_session(stop_requested) else {
            return;
        };

        self.retain_session_cleanup(session);
        drop(cleanup);
    }

    fn take_matching_session(&self, stop_requested: &Arc<AtomicBool>) -> Option<RunningSession> {
        let mut current = match self.session.lock() {
            Ok(current) => current,
            Err(poisoned) => poisoned.into_inner(),
        };
        let session = current.as_ref()?;

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return None;
        }

        current.take()
    }

    fn take_session(&self) -> Option<RunningSession> {
        match self.session.lock() {
            Ok(mut current) => current.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        }
    }

    fn session_stdin(&self) -> Option<Arc<SessionMessageWriter>> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .map(|session| Arc::clone(&session.stdin))
    }

    fn exact_notification_transport_for(
        &self,
        expected_session_id: u64,
    ) -> Option<Arc<ExactSessionNotificationTransport>> {
        if !matches!(
            self.status(),
            LanguageServerRuntimeStatus::Running { session_id, .. }
                if session_id == expected_session_id
        ) {
            return None;
        }
        let session = self.session.lock().ok()?;
        let session = session.as_ref()?;
        if session.session_id != expected_session_id
            || session.stop_requested.load(Ordering::SeqCst)
        {
            return None;
        }
        Some(Arc::clone(&session.exact_notification_transport))
    }

    pub(super) fn session_request_parts(&self) -> Option<SessionRequestParts> {
        self.session.lock().ok()?.as_ref().map(|session| {
            (
                session.session_id,
                Arc::clone(&session.stdin),
                Arc::clone(&session.pending_requests),
                Arc::clone(&session.cancellation_transport),
            )
        })
    }

    fn session_server_configuration(&self) -> Option<Arc<Mutex<Value>>> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .map(|session| Arc::clone(&session.server_configuration))
    }

    #[cfg(test)]
    pub(super) fn force_status(&self, next: LanguageServerRuntimeStatus) {
        set_status(&self.status, next);
    }

    #[cfg(test)]
    pub(super) fn pending_request_count(&self) -> usize {
        let Ok(session) = self.session.lock() else {
            return 0;
        };
        let Some(session) = session.as_ref() else {
            return 0;
        };
        session.pending_requests.len()
    }
}

impl Default for LanguageServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for LanguageServerSupervisor {
    fn drop(&mut self) {
        let cleanup_task = match self.cleanup_task.get_mut() {
            Ok(current) => current.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        if let Some(task) = cleanup_task {
            retain_cleanup_task(task);
        }

        let session = match self.session.get_mut() {
            Ok(current) => current.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };

        if let Some(session) = session {
            terminate_session(session);
        }
    }
}
