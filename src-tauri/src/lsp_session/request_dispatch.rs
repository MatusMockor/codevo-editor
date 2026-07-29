use super::session_writer::SessionMessageWriter;
use super::{
    write_with_session_stdin, JavaScriptTypeScriptLanguageServerRegistry, JsonRpcNotification,
    JsonRpcRequest, LanguageServerRequestError, LanguageServerSupervisor,
    PendingRequestCancellationReceipt, PendingRequests,
};
use serde_json::{json, Value};
use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MAX_QUEUED_CANCELLATIONS_PER_SESSION: usize = 64;
const CANCELLATION_WRITE_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_QUEUED_NOTIFICATIONS_PER_SESSION: usize = 64;
const NOTIFICATION_WRITE_TIMEOUT: Duration = Duration::from_millis(250);

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub fn send_request_async_with_id_preserving_response_error(
        &self,
        root_path: &str,
        session_id: u64,
        request_id: u64,
        method: &str,
        params: Value,
    ) -> impl std::future::Future<Output = Result<Option<Value>, LanguageServerRequestError>> + 'static
    {
        send_identified_request_preserving_response_error(
            self.existing_supervisor(root_path),
            session_id,
            request_id,
            method,
            params,
        )
    }
}

pub(super) fn send_identified_request_preserving_response_error(
    supervisor: Option<Arc<LanguageServerSupervisor>>,
    session_id: u64,
    request_id: u64,
    method: &str,
    params: Value,
) -> impl std::future::Future<Output = Result<Option<Value>, LanguageServerRequestError>> + 'static
{
    let method = method.to_string();
    async move {
        let Some(supervisor) = supervisor else {
            return Ok(None);
        };
        tauri::async_runtime::spawn_blocking(move || {
            supervisor.send_request_with_id(session_id, request_id, &method, params)
        })
        .await
        .map_err(|error| {
            LanguageServerRequestError::from(format!(
                "Language server request task failed: {error}"
            ))
        })?
    }
}

pub(super) fn send_request_with_timeout(
    supervisor: &LanguageServerSupervisor,
    method: &str,
    params: Value,
    expected_session_id: Option<u64>,
    client_request_id: Option<u64>,
    timeout: Duration,
) -> Result<Option<Value>, LanguageServerRequestError> {
    if !matches!(
        supervisor.status(),
        super::LanguageServerRuntimeStatus::Running { .. }
    ) {
        return Ok(None);
    }

    let Some((session_id, stdin, pending_requests, _)) = supervisor.session_request_parts() else {
        return Ok(None);
    };
    if expected_session_id.is_some_and(|expected| expected != session_id) {
        return Err(LanguageServerRequestError::from(
            "Language server request session is no longer active.",
        ));
    }
    let wire_request_id = supervisor.allocate_wire_request_id()?;
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: wire_request_id,
        method: method.to_string(),
        params,
    };
    let bytes = serde_json::to_vec(&request).map_err(|error| {
        LanguageServerRequestError::from(format!("Failed to serialize LSP request: {error}"))
    })?;
    let (tx, rx) = mpsc::channel();

    pending_requests
        .admit(wire_request_id, client_request_id, tx)
        .map_err(|error| LanguageServerRequestError::from(error.to_string()))?;

    let started_at = Instant::now();

    if let Err(error) = write_with_session_stdin(&stdin, &bytes) {
        remove_pending_request(&pending_requests, wire_request_id);
        supervisor.record_request_outcome_for_session(session_id, method, started_at, false);
        return Err(LanguageServerRequestError::from(format!(
            "Failed to send LSP request `{method}`: {error}"
        )));
    }

    match rx.recv_timeout(timeout) {
        Ok(Ok(result)) => {
            supervisor.record_request_outcome_for_session(session_id, method, started_at, true);
            Ok(Some(result))
        }
        Ok(Err(message)) => {
            supervisor.record_request_outcome_for_session(session_id, method, started_at, false);
            Err(message)
        }
        Err(RecvTimeoutError::Timeout) => {
            remove_pending_request(&pending_requests, wire_request_id);
            supervisor.record_request_outcome_for_session(session_id, method, started_at, false);
            Err(LanguageServerRequestError::from(format!(
                "Language server request `{method}` timed out."
            )))
        }
        Err(RecvTimeoutError::Disconnected) => {
            supervisor.record_request_outcome_for_session(session_id, method, started_at, false);
            Err(LanguageServerRequestError::from(format!(
                "Language server request `{method}` was cancelled."
            )))
        }
    }
}

pub(super) struct PendingCancelWrite {
    pub(super) session_id: u64,
    pub(super) transport: Arc<CancellationTransport>,
    pub(super) wire_request_id: u64,
}

pub(super) struct CancellationTransport {
    authority: Arc<CancellationTransportAuthority>,
    outstanding: Arc<AtomicUsize>,
    sender: Mutex<Option<SyncSender<u64>>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

struct NotificationWrite {
    bytes: Vec<u8>,
    result: SyncSender<io::Result<()>>,
}

pub(super) struct ExactSessionNotificationTransport {
    authority: Arc<CancellationTransportAuthority>,
    outstanding: Arc<AtomicUsize>,
    sender: Mutex<Option<SyncSender<NotificationWrite>>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

struct CancellationTransportAuthority {
    active: AtomicBool,
    failure_task_spawner: Arc<dyn CancellationFailureTaskSpawner>,
    #[cfg(test)]
    failure_after_check_hook: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    killer: super::SharedProcessKiller,
    log: super::RuntimeLog,
    publication: Mutex<()>,
    revoked: AtomicBool,
    server_label: &'static str,
    session_id: u64,
}

impl CancellationTransportAuthority {
    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        self.active.store(false, Ordering::Release);
        let _publication = self
            .publication
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }

    fn mark_unhealthy(&self, error: &io::Error) {
        let _publication = self
            .publication
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.revoked.load(Ordering::Acquire) || !self.active.swap(false, Ordering::AcqRel) {
            return;
        }
        self.finish_claimed_failure(error);
    }

    fn finish_claimed_failure(&self, error: &io::Error) {
        if self.revoked.load(Ordering::Acquire) {
            return;
        }
        #[cfg(test)]
        if let Some(hook) = self
            .failure_after_check_hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned()
        {
            hook();
        }
        super::append_runtime_log(
            &self.log,
            &format!(
                "{} session {} cancellation transport failed: {error}\n",
                self.server_label, self.session_id
            ),
        );
        super::terminate_process(&self.killer);
    }

    fn schedule_unhealthy(self: &Arc<Self>, error: io::Error) {
        if !self.active.swap(false, Ordering::AcqRel) {
            return;
        }
        let authority = Arc::clone(self);
        let error_kind = error.kind();
        let error_message = error.to_string();
        let task_name = format!("lsp-cancel-failure-{}", self.session_id);
        let spawn_result = self.failure_task_spawner.spawn(
            task_name,
            Box::new(move || {
                let _publication = authority
                    .publication
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                authority.finish_claimed_failure(&io::Error::new(error_kind, error_message));
            }),
        );
        if let Err(spawn_error) = spawn_result {
            // OS thread creation failure is rare, but cancellation saturation
            // must still fail closed. The caller already owns the exact
            // generation authority, so synchronously kill only that transport.
            let _publication = self
                .publication
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            self.finish_claimed_failure(&io::Error::new(
                error.kind(),
                format!("{error}; failed to dispatch cancellation failure task: {spawn_error}"),
            ));
        }
    }
}

pub(super) trait CancellationFailureTaskSpawner: Send + Sync {
    fn spawn(&self, name: String, task: Box<dyn FnOnce() + Send + 'static>) -> io::Result<()>;
}

struct ThreadCancellationFailureTaskSpawner;

impl CancellationFailureTaskSpawner for ThreadCancellationFailureTaskSpawner {
    fn spawn(&self, name: String, task: Box<dyn FnOnce() + Send + 'static>) -> io::Result<()> {
        thread::Builder::new().name(name).spawn(task).map(|_| ())
    }
}

impl CancellationTransport {
    pub(super) fn start(
        session_id: u64,
        stdin: Arc<SessionMessageWriter>,
        killer: super::SharedProcessKiller,
        log: super::RuntimeLog,
        server_label: &'static str,
    ) -> io::Result<Arc<Self>> {
        Self::start_with_failure_task_spawner(
            session_id,
            stdin,
            killer,
            log,
            server_label,
            Arc::new(ThreadCancellationFailureTaskSpawner),
        )
    }

    pub(super) fn start_with_failure_task_spawner(
        session_id: u64,
        stdin: Arc<SessionMessageWriter>,
        killer: super::SharedProcessKiller,
        log: super::RuntimeLog,
        server_label: &'static str,
        failure_task_spawner: Arc<dyn CancellationFailureTaskSpawner>,
    ) -> io::Result<Arc<Self>> {
        let (sender, receiver) = mpsc::sync_channel(MAX_QUEUED_CANCELLATIONS_PER_SESSION);
        let authority = Arc::new(CancellationTransportAuthority {
            active: AtomicBool::new(true),
            failure_task_spawner,
            #[cfg(test)]
            failure_after_check_hook: Mutex::new(None),
            killer,
            log,
            publication: Mutex::new(()),
            revoked: AtomicBool::new(false),
            server_label,
            session_id,
        });
        let outstanding = Arc::new(AtomicUsize::new(0));
        let transport = Arc::new(Self {
            authority: Arc::clone(&authority),
            outstanding: Arc::clone(&outstanding),
            sender: Mutex::new(Some(sender)),
            worker: Mutex::new(None),
        });

        let worker = thread::Builder::new()
            .name(format!("lsp-cancel-writer-{session_id}"))
            .spawn(move || {
                while let Ok(wire_request_id) = receiver.recv() {
                    if !authority.active.load(Ordering::Acquire) {
                        return;
                    }
                    let result = write_cancel_notification(&stdin, wire_request_id);
                    outstanding.fetch_sub(1, Ordering::AcqRel);
                    match result {
                        Ok(()) => {}
                        Err(error) => {
                            authority.mark_unhealthy(&error);
                            return;
                        }
                    }
                }
            })
            .map_err(|error| io::Error::other(format!("failed to start cancel writer: {error}")))?;
        *transport
            .worker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(worker);

        Ok(transport)
    }

    pub(super) fn enqueue(&self, wire_request_id: u64) -> Result<(), io::Error> {
        if !self.authority.active.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "cancellation transport is closed",
            ));
        }
        if self
            .outstanding
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |outstanding| {
                (outstanding < MAX_QUEUED_CANCELLATIONS_PER_SESSION).then_some(outstanding + 1)
            })
            .is_err()
        {
            let error = io::Error::new(
                io::ErrorKind::WouldBlock,
                "cancellation queue capacity was reached",
            );
            self.authority
                .schedule_unhealthy(io::Error::new(error.kind(), error.to_string()));
            return Err(error);
        }
        let sender = self
            .sender
            .lock()
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "cancellation sender lock is unavailable",
                )
            })?
            .clone()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "cancellation transport is closed",
                )
            })?;
        match sender.try_send(wire_request_id) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.outstanding.fetch_sub(1, Ordering::AcqRel);
                let error = io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "cancellation queue capacity was reached",
                );
                self.authority
                    .schedule_unhealthy(io::Error::new(error.kind(), error.to_string()));
                Err(error)
            }
            Err(TrySendError::Disconnected(_)) => {
                self.outstanding.fetch_sub(1, Ordering::AcqRel);
                let error = io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "cancellation writer is unavailable",
                );
                self.authority
                    .schedule_unhealthy(io::Error::new(error.kind(), error.to_string()));
                Err(error)
            }
        }
    }

    pub(super) fn revoke(&self) {
        self.authority.revoke();
        self.sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(worker) = self
            .worker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = worker.join();
        }
    }

    #[cfg(test)]
    pub(super) fn set_failure_after_check_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        *self
            .authority
            .failure_after_check_hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(hook);
    }
}

impl ExactSessionNotificationTransport {
    pub(super) fn start(
        session_id: u64,
        stdin: Arc<SessionMessageWriter>,
        cancellation_transport: &Arc<CancellationTransport>,
    ) -> io::Result<Arc<Self>> {
        let (sender, receiver) = mpsc::sync_channel(MAX_QUEUED_NOTIFICATIONS_PER_SESSION);
        let authority = Arc::clone(&cancellation_transport.authority);
        let outstanding = Arc::new(AtomicUsize::new(0));
        let transport = Arc::new(Self {
            authority: Arc::clone(&authority),
            outstanding: Arc::clone(&outstanding),
            sender: Mutex::new(Some(sender)),
            worker: Mutex::new(None),
        });
        let worker = thread::Builder::new()
            .name(format!("lsp-notification-writer-{session_id}"))
            .spawn(move || {
                while let Ok(write) = receiver.recv() {
                    if !authority.active.load(Ordering::Acquire) {
                        let _ = write.result.send(Err(io::Error::new(
                            io::ErrorKind::BrokenPipe,
                            "notification transport is closed",
                        )));
                        return;
                    }
                    let result = stdin.write_message(&write.bytes, NOTIFICATION_WRITE_TIMEOUT);
                    outstanding.fetch_sub(1, Ordering::AcqRel);
                    match result {
                        Ok(()) => {
                            let _ = write.result.send(Ok(()));
                        }
                        Err(error) => {
                            authority.mark_unhealthy(&error);
                            let _ = write
                                .result
                                .send(Err(io::Error::new(error.kind(), error.to_string())));
                            return;
                        }
                    }
                }
            })
            .map_err(|error| {
                io::Error::other(format!("failed to start notification writer: {error}"))
            })?;
        *transport
            .worker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(worker);
        Ok(transport)
    }

    pub(super) fn send(&self, bytes: Vec<u8>) -> io::Result<()> {
        if !self.authority.active.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "notification transport is closed",
            ));
        }
        if self
            .outstanding
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |outstanding| {
                (outstanding < MAX_QUEUED_NOTIFICATIONS_PER_SESSION).then_some(outstanding + 1)
            })
            .is_err()
        {
            let error = io::Error::new(
                io::ErrorKind::WouldBlock,
                "notification queue capacity was reached",
            );
            self.authority
                .schedule_unhealthy(io::Error::new(error.kind(), error.to_string()));
            return Err(error);
        }
        let sender = match self.sender.lock() {
            Ok(sender) => sender.clone().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "notification transport is closed",
                )
            }),
            Err(_) => Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "notification sender lock is unavailable",
            )),
        };
        let sender = match sender {
            Ok(sender) => sender,
            Err(error) => {
                self.outstanding.fetch_sub(1, Ordering::AcqRel);
                return Err(error);
            }
        };
        let (result_tx, result_rx) = mpsc::sync_channel(1);
        match sender.try_send(NotificationWrite {
            bytes,
            result: result_tx,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.outstanding.fetch_sub(1, Ordering::AcqRel);
                let error = io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "notification queue capacity was reached",
                );
                self.authority
                    .schedule_unhealthy(io::Error::new(error.kind(), error.to_string()));
                return Err(error);
            }
            Err(TrySendError::Disconnected(_)) => {
                self.outstanding.fetch_sub(1, Ordering::AcqRel);
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "notification writer is unavailable",
                ));
            }
        }
        result_rx
            .recv_timeout(NOTIFICATION_WRITE_TIMEOUT + Duration::from_millis(50))
            .map_err(|error| match error {
                RecvTimeoutError::Timeout => io::Error::new(
                    io::ErrorKind::TimedOut,
                    "notification delivery receipt timed out",
                ),
                RecvTimeoutError::Disconnected => io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "notification delivery receipt disconnected",
                ),
            })?
    }

    pub(super) fn revoke(&self) {
        self.sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(worker) = self
            .worker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = worker.join();
        }
    }
}

pub(super) fn prepare_cancel_pending_request(
    supervisor: &LanguageServerSupervisor,
    expected_session_id: u64,
    client_request_id: u64,
) -> Result<Option<PendingCancelWrite>, LanguageServerRequestError> {
    let Some((session_id, _, pending_requests, cancellation_transport)) =
        supervisor.session_request_parts()
    else {
        return Ok(None);
    };
    if session_id != expected_session_id {
        return Err(LanguageServerRequestError::from(
            "Language server cancellation session is no longer active.",
        ));
    }
    let wire_request_id = match pending_requests.cancel(client_request_id) {
        PendingRequestCancellationReceipt::Cancelled { wire_request_id } => wire_request_id,
        PendingRequestCancellationReceipt::NotPending => return Ok(None),
        PendingRequestCancellationReceipt::RegistryUnavailable => {
            return Err(LanguageServerRequestError::from(
                "Language server pending request registry is unavailable.",
            ));
        }
        PendingRequestCancellationReceipt::SessionClosed => {
            return Err(LanguageServerRequestError::from(
                "Language server cancellation session is closed.",
            ));
        }
    };

    Ok(Some(PendingCancelWrite {
        session_id,
        transport: cancellation_transport,
        wire_request_id,
    }))
}

fn write_cancel_notification(
    stdin: &Arc<SessionMessageWriter>,
    wire_request_id: u64,
) -> io::Result<()> {
    let notification = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "$/cancelRequest".to_string(),
        params: json!({ "id": wire_request_id }),
    };
    let bytes = serde_json::to_vec(&notification)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    stdin.write_message(&bytes, CANCELLATION_WRITE_TIMEOUT)
}

fn remove_pending_request(pending_requests: &PendingRequests, id: u64) {
    pending_requests.remove(id);
}
