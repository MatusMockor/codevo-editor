use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
use crate::lsp_diagnostics::{parse_publish_diagnostics, LanguageServerDiagnosticEvent};
use crate::lsp_transport::{read_message, write_message};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const PHP_STATUS_EVENT: &str = "language-server://status";
pub const PHP_DIAGNOSTICS_EVENT: &str = "language-server://diagnostics";
pub const JAVASCRIPT_TYPESCRIPT_STATUS_EVENT: &str =
    "javascript-typescript-language-server://status";
pub const JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT: &str =
    "javascript-typescript-language-server://diagnostics";
type PendingRequestResult = Result<Value, String>;
type PendingRequestSender = mpsc::Sender<PendingRequestResult>;
type PendingRequests = Arc<Mutex<HashMap<u64, PendingRequestSender>>>;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LanguageServerRuntimeStatus {
    Starting {
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Running {
        #[serde(rename = "sessionId")]
        session_id: u64,
        capabilities: LanguageServerCapabilities,
    },
    Stopped,
    Crashed {
        message: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCapabilities {
    pub hover: bool,
    pub completion: bool,
    pub definition: bool,
    pub implementation: bool,
}

pub trait StatusSink: Send + Sync {
    fn emit_status(&self, status: LanguageServerRuntimeStatus);
}

pub trait DiagnosticsSink: Send + Sync {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent);
}

pub struct AppHandleEventSink {
    app: tauri::AppHandle,
    diagnostics_event: &'static str,
    root_path: Option<String>,
    status_event: &'static str,
}

impl AppHandleEventSink {
    pub fn for_workspace(app: tauri::AppHandle, root_path: String) -> Self {
        Self::new_with_events_and_root(
            app,
            PHP_STATUS_EVENT,
            PHP_DIAGNOSTICS_EVENT,
            Some(root_path),
        )
    }

    pub fn javascript_typescript_for_workspace(app: tauri::AppHandle, root_path: String) -> Self {
        Self::new_with_events_and_root(
            app,
            JAVASCRIPT_TYPESCRIPT_STATUS_EVENT,
            JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
            Some(root_path),
        )
    }

    fn new_with_events_and_root(
        app: tauri::AppHandle,
        status_event: &'static str,
        diagnostics_event: &'static str,
        root_path: Option<String>,
    ) -> Self {
        Self {
            app,
            diagnostics_event,
            root_path,
            status_event,
        }
    }
}

impl StatusSink for AppHandleEventSink {
    fn emit_status(&self, status: LanguageServerRuntimeStatus) {
        use tauri::Emitter;

        let _ = self.app.emit(
            self.status_event,
            status_event_payload(&self.root_path, status),
        );
    }
}

impl DiagnosticsSink for AppHandleEventSink {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent) {
        use tauri::Emitter;

        let _ = self.app.emit(
            self.diagnostics_event,
            diagnostics_event_payload(&self.root_path, event),
        );
    }
}

fn status_event_payload(root_path: &Option<String>, status: LanguageServerRuntimeStatus) -> Value {
    let mut value = serde_json::to_value(status).unwrap_or(Value::Null);

    if let (Some(root_path), Value::Object(object)) = (root_path, &mut value) {
        object.insert("rootPath".to_string(), Value::String(root_path.clone()));
    }

    value
}

fn diagnostics_event_payload(
    root_path: &Option<String>,
    event: LanguageServerDiagnosticEvent,
) -> Value {
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);

    if let (Some(root_path), Value::Object(object)) = (root_path, &mut value) {
        object.insert("rootPath".to_string(), Value::String(root_path.clone()));
    }

    value
}

pub trait ServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer>;
}

pub struct SpawnedServer {
    pub stdin: Box<dyn Write + Send>,
    pub stdout: Box<dyn Read + Send>,
    pub killer: Box<dyn ProcessKiller>,
}

pub trait ProcessKiller: Send {
    fn terminate(&mut self) -> io::Result<()>;
}

pub struct ChildServerProcessSpawner;

impl ServerProcessSpawner for ChildServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        let mut command_builder = Command::new(&command.executable);
        command_builder
            .args(&command.args)
            .current_dir(&command.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(unix)]
        {
            command_builder.process_group(0);
        }

        let mut child = command_builder.spawn()?;
        #[cfg(unix)]
        let process_group_id = child.id() as i32;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "missing child stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "missing child stdout"))?;

        Ok(SpawnedServer {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            killer: Box::new(ChildKiller {
                child,
                #[cfg(unix)]
                process_group_id,
            }),
        })
    }
}

struct ChildKiller {
    child: Child,
    #[cfg(unix)]
    process_group_id: i32,
}

impl ProcessKiller for ChildKiller {
    fn terminate(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_some() {
            #[cfg(unix)]
            let _ = signal_process_group(self.process_group_id, libc::SIGKILL);
            return Ok(());
        }

        #[cfg(unix)]
        {
            let _ = signal_process_group(self.process_group_id, libc::SIGTERM);
            std::thread::sleep(Duration::from_millis(150));

            if self.child.try_wait()?.is_none() {
                let _ = signal_process_group(self.process_group_id, libc::SIGKILL);
            }
        }

        let kill_error = self.child.kill().err();
        let wait_result = self.child.wait().map(|_| ());

        #[cfg(unix)]
        let _ = signal_process_group(self.process_group_id, libc::SIGKILL);

        if let Some(error) = kill_error {
            if error.kind() != io::ErrorKind::InvalidInput {
                return Err(error);
            }
        }

        wait_result
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) -> io::Result<()> {
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

fn workspace_runtime_id(root_path: &str) -> String {
    let path = PathBuf::from(root_path);
    let normalized = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    normalized.trim_end_matches('/').to_string()
}

enum HandshakeOutcome {
    Ready(LanguageServerCapabilities),
    Failed(String),
    Disconnected,
}

struct RunningSession {
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ProcessKiller>,
    pending_requests: PendingRequests,
    reader: Option<JoinHandle<()>>,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
}

pub struct LanguageServerSupervisor {
    next_request_id: AtomicU64,
    next_session_id: AtomicU64,
    server_label: &'static str,
    session: Mutex<Option<RunningSession>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
}

pub struct LanguageServerRegistry {
    server_label: &'static str,
    supervisors: Mutex<HashMap<String, Arc<LanguageServerSupervisor>>>,
}

pub struct PhpLanguageServerRegistry(pub LanguageServerRegistry);

impl PhpLanguageServerRegistry {
    pub fn new() -> Self {
        Self(LanguageServerRegistry::new_with_label("PHPactor"))
    }
}

impl Default for PhpLanguageServerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl std::ops::Deref for PhpLanguageServerRegistry {
    type Target = LanguageServerRegistry;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub struct JavaScriptTypeScriptLanguageServerRegistry(pub LanguageServerRegistry);

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub fn new() -> Self {
        Self(LanguageServerRegistry::new_with_label(
            "TypeScript language server",
        ))
    }
}

impl Default for JavaScriptTypeScriptLanguageServerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl std::ops::Deref for JavaScriptTypeScriptLanguageServerRegistry {
    type Target = LanguageServerRegistry;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl LanguageServerRegistry {
    pub fn new_with_label(server_label: &'static str) -> Self {
        Self {
            server_label,
            supervisors: Mutex::new(HashMap::new()),
        }
    }

    pub fn status(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        self.existing_supervisor(root_path)
            .map(|supervisor| supervisor.status())
            .unwrap_or(LanguageServerRuntimeStatus::Stopped)
    }

    pub fn start(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.supervisor_for(root_path)?.start(
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
        )
    }

    pub fn stop(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let supervisor = self.remove_supervisor(root_path);
        supervisor
            .map(|supervisor| supervisor.stop())
            .unwrap_or(LanguageServerRuntimeStatus::Stopped)
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        let supervisors = self.drain_supervisors();

        for supervisor in supervisors {
            supervisor.stop();
        }

        LanguageServerRuntimeStatus::Stopped
    }

    pub fn send_notification(
        &self,
        root_path: &str,
        notification: &JsonRpcNotification,
    ) -> Result<(), String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(());
        };

        supervisor.send_notification(notification)
    }

    pub fn send_request(
        &self,
        root_path: &str,
        method: &str,
        params: Value,
    ) -> Result<Option<Value>, String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(None);
        };

        supervisor.send_request(method, params)
    }

    #[cfg(test)]
    pub fn running_roots(&self) -> Vec<String> {
        let Ok(supervisors) = self.supervisors.lock() else {
            return Vec::new();
        };

        let mut roots = supervisors
            .iter()
            .filter_map(|(root_path, supervisor)| {
                matches!(
                    supervisor.status(),
                    LanguageServerRuntimeStatus::Starting { .. }
                        | LanguageServerRuntimeStatus::Running { .. }
                )
                .then(|| root_path.clone())
            })
            .collect::<Vec<_>>();
        roots.sort();
        roots
    }

    fn supervisor_for(&self, root_path: &str) -> Result<Arc<LanguageServerSupervisor>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let mut supervisors = self.supervisors.lock().map_err(|error| error.to_string())?;

        Ok(supervisors
            .entry(runtime_id)
            .or_insert_with(|| {
                Arc::new(LanguageServerSupervisor::new_with_label(self.server_label))
            })
            .clone())
    }

    fn existing_supervisor(&self, root_path: &str) -> Option<Arc<LanguageServerSupervisor>> {
        self.supervisors
            .lock()
            .ok()?
            .get(&workspace_runtime_id(root_path))
            .cloned()
    }

    fn remove_supervisor(&self, root_path: &str) -> Option<Arc<LanguageServerSupervisor>> {
        self.supervisors
            .lock()
            .ok()?
            .remove(&workspace_runtime_id(root_path))
    }

    fn drain_supervisors(&self) -> Vec<Arc<LanguageServerSupervisor>> {
        self.supervisors
            .lock()
            .map(|mut supervisors| {
                supervisors
                    .drain()
                    .map(|(_, supervisor)| supervisor)
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Drop for LanguageServerRegistry {
    fn drop(&mut self) {
        let Ok(mut supervisors) = self.supervisors.lock() else {
            return;
        };

        for supervisor in supervisors.drain().map(|(_, supervisor)| supervisor) {
            supervisor.stop();
        }
    }
}

impl LanguageServerSupervisor {
    pub fn new() -> Self {
        Self::new_with_label("PHPactor")
    }

    pub fn new_with_label(server_label: &'static str) -> Self {
        Self {
            next_request_id: AtomicU64::new(2),
            next_session_id: AtomicU64::new(1),
            server_label,
            session: Mutex::new(None),
            status: Arc::new(Mutex::new(LanguageServerRuntimeStatus::Stopped)),
        }
    }

    pub fn status(&self) -> LanguageServerRuntimeStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(LanguageServerRuntimeStatus::Stopped)
    }

    pub fn start(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        self.terminate_stale_session();
        self.begin_start(status_sink.as_ref(), session_id)?;

        let spawned = match spawner.spawn(command) {
            Ok(spawned) => spawned,
            Err(error) => {
                let message = format!("Failed to start {}: {error}", self.server_label);
                publish_crash(&self.status, status_sink.as_ref(), &message);
                return Err(message);
            }
        };

        let stdin = Arc::new(Mutex::new(spawned.stdin));
        let pending_requests = Arc::new(Mutex::new(HashMap::new()));
        let stop_requested = Arc::new(AtomicBool::new(false));
        let mut session = Some(RunningSession {
            stdin: Arc::clone(&stdin),
            killer: spawned.killer,
            pending_requests: Arc::clone(&pending_requests),
            reader: None,
            status_sink: Arc::clone(&status_sink),
            stop_requested: Arc::clone(&stop_requested),
        });

        if !self.install_session(&mut session)? {
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
                publish_crash(&self.status, status_sink.as_ref(), &message);
                return Err(message);
            }
        };

        if let Err(error) = write_with_session_stdin(&stdin, &init_bytes) {
            let message = format!("Failed to send initialize: {error}");
            self.terminate_matching_session(&stop_requested);
            publish_crash(&self.status, status_sink.as_ref(), &message);
            return Err(message);
        }

        let (handshake_tx, handshake_rx) = mpsc::channel();
        let mut reader = Some(spawn_reader(
            spawned.stdout,
            Arc::clone(&stdin),
            Arc::clone(&self.status),
            diagnostics_sink,
            pending_requests,
            Arc::clone(&status_sink),
            Arc::clone(&stop_requested),
            handshake_tx,
            initialize_request.id,
            session_id,
            self.server_label,
        ));

        if !self.attach_reader(&stop_requested, &mut reader)? {
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
                    publish_crash(&self.status, status_sink.as_ref(), &message);
                    return Err(message);
                }

                self.publish_running_if_starting(
                    status_sink.as_ref(),
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

                publish_crash(&self.status, status_sink.as_ref(), &message);
                Err(message)
            }
            Ok(HandshakeOutcome::Disconnected) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                let message = format!("{} exited during the handshake.", self.server_label);
                publish_crash(&self.status, status_sink.as_ref(), &message);
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
                publish_crash(&self.status, status_sink.as_ref(), &message);
                Err(message)
            }
        }
    }

    pub fn stop(&self) -> LanguageServerRuntimeStatus {
        let Some(session) = self.take_session() else {
            set_status(&self.status, LanguageServerRuntimeStatus::Stopped);
            return LanguageServerRuntimeStatus::Stopped;
        };

        let status_sink = Arc::clone(&session.status_sink);
        terminate_session(session);

        publish(
            &self.status,
            status_sink.as_ref(),
            LanguageServerRuntimeStatus::Stopped,
        );
        LanguageServerRuntimeStatus::Stopped
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

    pub fn send_request(&self, method: &str, params: Value) -> Result<Option<Value>, String> {
        self.send_request_with_timeout(method, params, REQUEST_TIMEOUT)
    }

    fn send_request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Option<Value>, String> {
        if !matches!(self.status(), LanguageServerRuntimeStatus::Running { .. }) {
            return Ok(None);
        }

        let Some((stdin, pending_requests)) = self.session_request_parts() else {
            return Ok(None);
        };
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };
        let bytes = serde_json::to_vec(&request)
            .map_err(|error| format!("Failed to serialize LSP request: {error}"))?;
        let (tx, rx) = mpsc::channel();

        {
            let mut pending = pending_requests.lock().map_err(|error| error.to_string())?;
            pending.insert(id, tx);
        }

        if let Err(error) = write_with_session_stdin(&stdin, &bytes) {
            remove_pending_request(&pending_requests, id);
            return Err(format!("Failed to send LSP request `{method}`: {error}"));
        }

        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(Some(result)),
            Ok(Err(message)) => Err(message),
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_request(&pending_requests, id);
                Err(format!("Language server request `{method}` timed out."))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(format!("Language server request `{method}` was cancelled."))
            }
        }
    }

    fn begin_start(&self, sink: &dyn StatusSink, session_id: u64) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;

        if is_active_status(&status) {
            return Err("Language server already running.".to_string());
        }

        *status = LanguageServerRuntimeStatus::Starting { session_id };
        sink.emit_status(LanguageServerRuntimeStatus::Starting { session_id });
        Ok(())
    }

    fn install_session(&self, session: &mut Option<RunningSession>) -> Result<bool, String> {
        let mut current = self.session.lock().map_err(|error| error.to_string())?;

        if !matches!(self.status(), LanguageServerRuntimeStatus::Starting { .. }) {
            return Ok(false);
        }

        if current.is_some() {
            return Ok(false);
        }

        *current = session.take();
        Ok(true)
    }

    fn attach_reader(
        &self,
        stop_requested: &Arc<AtomicBool>,
        reader: &mut Option<JoinHandle<()>>,
    ) -> Result<bool, String> {
        let mut current = self.session.lock().map_err(|error| error.to_string())?;
        let Some(session) = current.as_mut() else {
            return Ok(false);
        };

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return Ok(false);
        }

        session.reader = reader.take();
        Ok(true)
    }

    fn publish_running_if_starting(
        &self,
        sink: &dyn StatusSink,
        stop_requested: &Arc<AtomicBool>,
        session_id: u64,
        capabilities: LanguageServerCapabilities,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;

        if stop_requested.load(Ordering::SeqCst) {
            *status = LanguageServerRuntimeStatus::Stopped;
            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        if let LanguageServerRuntimeStatus::Crashed { message } = &*status {
            self.terminate_matching_session(stop_requested);
            return Err(message.clone());
        }

        if *status != (LanguageServerRuntimeStatus::Starting { session_id }) {
            return Ok(status.clone());
        }

        *status = LanguageServerRuntimeStatus::Running {
            session_id,
            capabilities: capabilities.clone(),
        };
        sink.emit_status(LanguageServerRuntimeStatus::Running {
            session_id,
            capabilities: capabilities.clone(),
        });
        Ok(LanguageServerRuntimeStatus::Running {
            session_id,
            capabilities,
        })
    }

    fn terminate_stale_session(&self) {
        if is_active_status(&self.status()) {
            return;
        }

        if let Some(session) = self.take_session() {
            terminate_session(session);
        }
    }

    fn terminate_matching_session(&self, stop_requested: &Arc<AtomicBool>) {
        let Some(session) = self.take_matching_session(stop_requested) else {
            return;
        };

        terminate_session(session);
    }

    fn take_matching_session(&self, stop_requested: &Arc<AtomicBool>) -> Option<RunningSession> {
        let Ok(mut current) = self.session.lock() else {
            return None;
        };
        let Some(session) = current.as_ref() else {
            return None;
        };

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return None;
        }

        current.take()
    }

    fn take_session(&self) -> Option<RunningSession> {
        self.session.lock().ok()?.take()
    }

    fn session_stdin(&self) -> Option<Arc<Mutex<Box<dyn Write + Send>>>> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .map(|session| Arc::clone(&session.stdin))
    }

    fn session_request_parts(
        &self,
    ) -> Option<(Arc<Mutex<Box<dyn Write + Send>>>, PendingRequests)> {
        self.session.lock().ok()?.as_ref().map(|session| {
            (
                Arc::clone(&session.stdin),
                Arc::clone(&session.pending_requests),
            )
        })
    }

    #[cfg(test)]
    fn pending_request_count(&self) -> usize {
        let Ok(session) = self.session.lock() else {
            return 0;
        };
        let Some(session) = session.as_ref() else {
            return 0;
        };
        let Ok(pending) = session.pending_requests.lock() else {
            return 0;
        };

        pending.len()
    }
}

impl Default for LanguageServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for LanguageServerSupervisor {
    fn drop(&mut self) {
        let Ok(mut current) = self.session.lock() else {
            return;
        };

        if let Some(session) = current.take() {
            terminate_session(session);
        }
    }
}

fn send_initialized(stdin: &Arc<Mutex<Box<dyn Write + Send>>>) -> Result<(), String> {
    let initialized = json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} });
    let initialized_bytes = serde_json::to_vec(&initialized)
        .map_err(|error| format!("Failed to serialize initialized notification: {error}"))?;
    write_with_session_stdin(stdin, &initialized_bytes)
        .map_err(|error| format!("Failed to send initialized: {error}"))
}

fn write_with_session_stdin(
    stdin: &Arc<Mutex<Box<dyn Write + Send>>>,
    payload: &[u8],
) -> io::Result<()> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "stdin lock poisoned"))?;
    write_message(&mut *stdin, payload)
}

fn terminate_session(mut session: RunningSession) {
    session.stop_requested.store(true, Ordering::SeqCst);
    reject_pending_requests(
        &session.pending_requests,
        "Language server request was stopped.",
    );
    let _ = session.killer.terminate();

    if let Some(reader) = session.reader.take() {
        let _ = reader.join();
    }
}

fn remove_pending_request(pending_requests: &PendingRequests, id: u64) {
    let Ok(mut pending) = pending_requests.lock() else {
        return;
    };

    pending.remove(&id);
}

fn reject_pending_requests(pending_requests: &PendingRequests, message: &str) {
    let Ok(mut pending) = pending_requests.lock() else {
        return;
    };

    for sender in pending.drain().map(|(_, sender)| sender) {
        let _ = sender.send(Err(message.to_string()));
    }
}

fn route_pending_response(pending_requests: &PendingRequests, value: &Value) -> bool {
    let Some(id) = value.get("id").and_then(Value::as_u64) else {
        return false;
    };
    let Ok(mut pending) = pending_requests.lock() else {
        return true;
    };
    let Some(sender) = pending.remove(&id) else {
        return false;
    };

    let _ = sender.send(parse_response_result(value));
    true
}

fn parse_response_result(value: &Value) -> PendingRequestResult {
    if let Some(result) = value.get("result") {
        return Ok(result.clone());
    }

    if let Some(message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(message.to_string());
    }

    Err("Language server returned a malformed response.".to_string())
}

fn is_active_status(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Starting { .. } | LanguageServerRuntimeStatus::Running { .. }
    )
}

fn publish_crash(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn StatusSink,
    message: &str,
) {
    publish(
        status,
        sink,
        LanguageServerRuntimeStatus::Crashed {
            message: message.to_string(),
        },
    );
}

fn publish(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn StatusSink,
    next: LanguageServerRuntimeStatus,
) {
    set_status(status, next.clone());
    sink.emit_status(next);
}

fn set_status(status: &Arc<Mutex<LanguageServerRuntimeStatus>>, next: LanguageServerRuntimeStatus) {
    if let Ok(mut current) = status.lock() {
        *current = next;
    }
}

fn spawn_reader(
    stdout: Box<dyn Read + Send>,
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    diagnostics_sink: Arc<dyn DiagnosticsSink>,
    pending_requests: PendingRequests,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
    handshake_tx: mpsc::Sender<HandshakeOutcome>,
    init_id: u64,
    session_id: u64,
    server_label: &'static str,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut handshake_done = false;

        loop {
            match read_message(&mut reader) {
                Ok(Some(bytes)) => {
                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        continue;
                    };

                    if handshake_done {
                        if route_pending_response(&pending_requests, &value) {
                            continue;
                        }

                        if respond_to_server_request(&stdin, &value).is_ok() {
                            continue;
                        }

                        if let Some(event) = parse_publish_diagnostics(&value, session_id) {
                            diagnostics_sink.emit_diagnostics(event);
                        }

                        continue;
                    }

                    if value.get("id") != Some(&json!(init_id)) {
                        continue;
                    }

                    if value.get("result").is_some() {
                        let Ok(capabilities) = parse_capabilities(&value) else {
                            let _ = handshake_tx.send(HandshakeOutcome::Failed(
                                format!(
                                    "{server_label} initialize response did not include valid server capabilities."
                                )
                                    .to_string(),
                            ));
                            return;
                        };

                        handshake_done = true;
                        let _ = handshake_tx.send(HandshakeOutcome::Ready(capabilities));
                        continue;
                    }

                    let message = value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Language server rejected initialize.")
                        .to_string();
                    let _ = handshake_tx.send(HandshakeOutcome::Failed(message));
                    return;
                }
                Ok(None) | Err(_) => {
                    if !handshake_done {
                        let _ = handshake_tx.send(HandshakeOutcome::Disconnected);
                        return;
                    }

                    if stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    reject_pending_requests(
                        &pending_requests,
                        "Language server exited unexpectedly.",
                    );
                    publish_crash(
                        &status,
                        status_sink.as_ref(),
                        &format!("{server_label} exited unexpectedly."),
                    );
                    return;
                }
            }
        }
    })
}

fn respond_to_server_request(
    stdin: &Arc<Mutex<Box<dyn Write + Send>>>,
    value: &Value,
) -> Result<(), ()> {
    let Some(id) = value.get("id").cloned() else {
        return Err(());
    };
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Err(());
    };

    let result = server_request_result(method, value.get("params"));
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    });
    let Ok(bytes) = serde_json::to_vec(&response) else {
        return Err(());
    };

    write_with_session_stdin(stdin, &bytes).map_err(|_| ())
}

fn server_request_result(method: &str, params: Option<&Value>) -> Value {
    match method {
        "workspace/configuration" => {
            let item_count = params
                .and_then(|params| params.get("items"))
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0);
            Value::Array((0..item_count).map(|_| json!({})).collect())
        }
        "workspace/workspaceFolders" => Value::Null,
        "client/registerCapability" | "client/unregisterCapability" => Value::Null,
        _ => Value::Null,
    }
}

fn parse_capabilities(value: &Value) -> Result<LanguageServerCapabilities, String> {
    let Some(capabilities) = value
        .get("result")
        .and_then(|result| result.get("capabilities"))
    else {
        return Err("missing server capabilities".to_string());
    };

    if !capabilities.is_object() {
        return Err("server capabilities must be an object".to_string());
    }

    Ok(LanguageServerCapabilities {
        hover: is_capability_enabled(capabilities.get("hoverProvider")),
        completion: is_capability_enabled(capabilities.get("completionProvider")),
        definition: is_capability_enabled(capabilities.get("definitionProvider")),
        implementation: is_capability_enabled(capabilities.get("implementationProvider")),
    })
}

fn is_capability_enabled(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return false;
    };

    if let Some(enabled) = value.as_bool() {
        return enabled;
    }

    value.is_object()
}

#[cfg(test)]
mod tests {
    use super::{
        parse_capabilities, DiagnosticsSink, LanguageServerCapabilities, LanguageServerRegistry,
        LanguageServerRuntimeStatus, LanguageServerSupervisor, ProcessKiller, ServerProcessSpawner,
        SpawnedServer, StatusSink,
    };
    use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
    use crate::lsp_diagnostics::LanguageServerDiagnosticEvent;
    use crate::lsp_transport::{read_message, write_message};
    use serde_json::{json, Value};
    use std::io::{self, PipeWriter, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime};

    #[test]
    fn successful_handshake_reports_running_and_sends_initialized() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(status, running_status());
        wait_for(&rx, &starting_status());
        wait_for(&rx, &running_status());

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        let initialize: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        let initialized: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(initialize["method"], "initialize");
        assert_eq!(initialized["method"], "initialized");
    }

    #[test]
    fn sends_notification_after_successful_handshake() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        supervisor
            .send_notification(&JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didSave".to_string(),
                params: json!({ "textDocument": { "uri": "file:///tmp/User.php" } }),
            })
            .expect("send notification");

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        read_message(&mut reader).unwrap().unwrap();
        read_message(&mut reader).unwrap().unwrap();
        let notification: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(notification["method"], "textDocument/didSave");
    }

    #[test]
    fn registry_keeps_workspace_sessions_isolated() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert_eq!(
            registry.running_roots(),
            vec![
                "/tmp/workspace-a".to_string(),
                "/tmp/workspace-b".to_string()
            ]
        );

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(matches!(
            registry.status("/tmp/workspace-b"),
            LanguageServerRuntimeStatus::Running { .. }
        ));
        assert_eq!(
            registry.running_roots(),
            vec!["/tmp/workspace-b".to_string()]
        );

        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry.running_roots().is_empty());
    }

    #[test]
    fn initialize_result_capabilities_are_reported_on_running_status() {
        let spawner = FakeSpawner::new(ready_script_with_capabilities(), true);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(
            status,
            LanguageServerRuntimeStatus::Running {
                session_id: 1,
                capabilities: LanguageServerCapabilities {
                    hover: true,
                    completion: true,
                    definition: true,
                    implementation: true,
                },
            }
        );
        wait_for(&rx, &starting_status());
        wait_for(&rx, &status);
    }

    #[test]
    fn runtime_status_serializes_session_id_for_frontend_events() {
        let status = LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities {
                hover: true,
                completion: false,
                definition: true,
                implementation: false,
            },
        };

        assert_eq!(
            serde_json::to_value(status).expect("serialize status"),
            json!({
                "kind": "running",
                "sessionId": 1,
                "capabilities": {
                    "hover": true,
                    "completion": false,
                    "definition": true,
                    "implementation": false,
                },
            })
        );
        assert_eq!(
            serde_json::to_value(LanguageServerRuntimeStatus::Starting { session_id: 2 })
                .expect("serialize starting"),
            json!({
                "kind": "starting",
                "sessionId": 2,
            })
        );
    }

    #[test]
    fn capability_values_are_normalized() {
        let capabilities = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "hoverProvider": false,
                    "completionProvider": null,
                    "definitionProvider": {},
                    "implementationProvider": true,
                }
            }
        }))
        .expect("capabilities");

        assert_eq!(
            capabilities,
            LanguageServerCapabilities {
                hover: false,
                completion: false,
                definition: true,
                implementation: true,
            }
        );
    }

    #[test]
    fn malformed_initialize_result_reports_crashed_and_errors() {
        let spawner = FakeSpawner::new(malformed_initialize_result_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("malformed initialize result should fail");

        assert!(error.contains("valid server capabilities"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn notification_is_noop_when_server_is_stopped() {
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .send_notification(&JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didSave".to_string(),
                params: json!({}),
            })
            .expect("stopped notification should be ignored");
    }

    #[test]
    fn publish_diagnostics_messages_emit_diagnostic_events() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        writer
            .write_all(&framed(json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.php",
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 1, "character": 2 },
                                "end": { "line": 1, "character": 3 }
                            },
                            "severity": 2,
                            "source": "phpactor",
                            "message": "Possible issue"
                        }
                    ]
                }
            })))
            .expect("write diagnostics");
        drop(held);

        let event = diagnostics_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("diagnostic event");

        assert_eq!(event.session_id, 1);
        assert_eq!(event.uri, "file:///tmp/User.php");
        assert_eq!(event.diagnostics[0].message, "Possible issue");
    }

    #[test]
    fn request_response_is_correlated_after_handshake() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor
                .send_request_with_timeout(
                    "textDocument/hover",
                    json!({
                        "textDocument": { "uri": "file:///tmp/User.php" },
                        "position": { "line": 1, "character": 2 },
                    }),
                    Duration::from_secs(2),
                )
                .expect("send request")
                .expect("request result")
        });
        let request_id = wait_for_captured_request_id(&capture, "textDocument/hover");

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "contents": "Hover text",
                },
            }),
        );

        let result = request.join().expect("request thread");
        assert_eq!(result["contents"], "Hover text");
        assert_eq!(supervisor.pending_request_count(), 0);
    }

    #[test]
    fn request_timeout_removes_pending_waiter() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let error = supervisor
            .send_request_with_timeout("textDocument/hover", json!({}), Duration::from_millis(10))
            .expect_err("request should time out");

        assert!(error.contains("timed out"));
        assert_eq!(supervisor.pending_request_count(), 0);
    }

    #[test]
    fn stop_rejects_pending_request() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor.send_request_with_timeout(
                "textDocument/definition",
                json!({}),
                Duration::from_secs(2),
            )
        });
        wait_for_captured_request_id(&capture, "textDocument/definition");

        supervisor.stop();

        let error = request
            .join()
            .expect("request thread")
            .expect_err("request should be rejected");
        assert!(error.contains("stopped"));
    }

    #[test]
    fn rejects_start_when_already_running() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                Arc::clone(&sink) as Arc<dyn StatusSink>,
                noop_diagnostics_sink(),
            )
            .expect("first start");

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("second start should fail");

        assert!(error.contains("already running"));
    }

    #[test]
    fn handshake_failure_reports_crashed_and_errors() {
        let spawner = FakeSpawner::new(Vec::new(), false);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("start should fail");

        assert!(error.contains("handshake"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn crash_during_run_emits_crashed_status() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        *held.lock().expect("held writer lock") = None;

        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Crashed {
                message: "PHPactor exited unexpectedly.".to_string(),
            },
        );
    }

    #[test]
    fn stop_after_running_emits_stopped_without_crash() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        let status = supervisor.stop();

        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        wait_for(&rx, &LanguageServerRuntimeStatus::Stopped);
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn running_session_keeps_stdin_open_until_stop() {
        let dropped = Arc::new(AtomicUsize::new(0));
        let spawner = FakeSpawner::with_stdin(
            ready_script(),
            true,
            Box::new(DropCountingWriter {
                dropped: Arc::clone(&dropped),
                writes: Arc::new(Mutex::new(Vec::new())),
            }),
        );
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(dropped.load(Ordering::SeqCst), 0);

        supervisor.stop();

        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stop_during_handshake_interrupts_start_without_crash() {
        let spawner = Arc::new(FakeSpawner::new(Vec::new(), true));
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let start_supervisor = Arc::clone(&supervisor);
        let start_sink = Arc::clone(&sink);
        let start_spawner = Arc::clone(&spawner);

        let start = std::thread::spawn(move || {
            start_supervisor
                .start(
                    &command(),
                    &initialize_request(),
                    start_spawner.as_ref(),
                    start_sink,
                    noop_diagnostics_sink(),
                )
                .expect("start should stop cleanly")
        });

        wait_for(&rx, &starting_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert_eq!(
            start.join().expect("start thread"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn spawn_failure_reports_crashed_status() {
        let spawner = FailingSpawner;
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("spawn should fail");

        assert!(error.contains("Failed to start PHPactor"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn initialized_write_failure_kills_process_and_reports_crashed_status() {
        let spawner =
            FakeSpawner::with_stdin(ready_script(), true, Box::new(FailingOnInitializedWriter));
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("initialized write should fail");

        assert!(error.contains("initialized"));
        assert!(spawner.held_writer.lock().expect("held writer").is_none());
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    fn initialize_request() -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({}),
        }
    }

    fn command() -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "phpactor".to_string(),
            args: vec!["language-server".to_string()],
            working_directory: ".".to_string(),
        }
    }

    fn ready_script() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} },
        }))
    }

    fn ready_script_with_capabilities() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "capabilities": {
                    "hoverProvider": true,
                    "completionProvider": { "triggerCharacters": [">"] },
                    "definitionProvider": true,
                    "implementationProvider": true,
                }
            },
        }))
    }

    fn malformed_initialize_result_script() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {},
        }))
    }

    fn framed(value: Value) -> Vec<u8> {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &serde_json::to_vec(&value).unwrap()).unwrap();
        buffer
    }

    fn wait_for(rx: &Receiver<LanguageServerRuntimeStatus>, target: &LanguageServerRuntimeStatus) {
        let deadline = Duration::from_secs(2);

        loop {
            let status = rx
                .recv_timeout(deadline)
                .unwrap_or_else(|_| panic!("expected status {target:?}"));

            if &status == target {
                return;
            }
        }
    }

    fn wait_for_captured_request_id(capture: &Arc<Mutex<Vec<u8>>>, method: &str) -> u64 {
        let deadline = Instant::now() + Duration::from_secs(2);

        loop {
            for value in captured_messages(capture) {
                if value["method"] == method {
                    return value["id"].as_u64().expect("request id");
                }
            }

            if Instant::now() >= deadline {
                panic!("expected captured request {method}");
            }

            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn captured_messages(capture: &Arc<Mutex<Vec<u8>>>) -> Vec<Value> {
        let buffer = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(buffer);
        let mut messages = Vec::new();

        while let Ok(Some(bytes)) = read_message(&mut reader) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                messages.push(value);
            }
        }

        messages
    }

    fn write_held_message(held: &Arc<Mutex<Option<PipeWriter>>>, value: Value) {
        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        writer
            .write_all(&framed(value))
            .expect("write held message");
    }

    fn starting_status() -> LanguageServerRuntimeStatus {
        LanguageServerRuntimeStatus::Starting { session_id: 1 }
    }

    fn running_status() -> LanguageServerRuntimeStatus {
        LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities::default(),
        }
    }

    fn noop_diagnostics_sink() -> Arc<dyn DiagnosticsSink> {
        Arc::new(NoopDiagnosticsSink)
    }

    #[derive(Clone)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().expect("capture lock").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct DropCountingWriter {
        dropped: Arc<AtomicUsize>,
        writes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for DropCountingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.writes
                .lock()
                .expect("drop counting writer lock")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Drop for DropCountingWriter {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct FakeSpawner {
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        stdin: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
        script: Vec<u8>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        keep_open: bool,
    }

    impl FakeSpawner {
        fn new(script: Vec<u8>, keep_open: bool) -> Self {
            Self {
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(None)),
                script,
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stdin(script: Vec<u8>, keep_open: bool, stdin: Box<dyn Write + Send>) -> Self {
            Self {
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(Some(stdin))),
                script,
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }
    }

    impl ServerProcessSpawner for FakeSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            let (reader, mut writer) = std::io::pipe()?;
            writer.write_all(&self.script)?;

            if self.keep_open {
                *self.held_writer.lock().expect("held writer lock") = Some(writer);
            }

            Ok(SpawnedServer {
                stdin: self
                    .stdin
                    .lock()
                    .expect("stdin lock")
                    .take()
                    .unwrap_or_else(|| Box::new(SharedWriter(Arc::clone(&self.stdin_capture)))),
                stdout: Box::new(reader),
                killer: Box::new(FakeKiller {
                    held: Arc::clone(&self.held_writer),
                }),
            })
        }
    }

    struct FakeKiller {
        held: Arc<Mutex<Option<PipeWriter>>>,
    }

    impl ProcessKiller for FakeKiller {
        fn terminate(&mut self) -> io::Result<()> {
            *self.held.lock().expect("held writer lock") = None;
            Ok(())
        }
    }

    struct FailingSpawner;

    impl ServerProcessSpawner for FailingSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            Err(io::Error::new(io::ErrorKind::NotFound, "missing phpactor"))
        }
    }

    struct FailingOnInitializedWriter;

    impl Write for FailingOnInitializedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if String::from_utf8_lossy(buf).contains("initialized") {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "initialized write failed",
                ));
            }

            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct ChannelSink {
        tx: Mutex<Sender<LanguageServerRuntimeStatus>>,
    }

    impl ChannelSink {
        fn new() -> (Arc<Self>, Receiver<LanguageServerRuntimeStatus>) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }

        fn with_diagnostics() -> (
            Arc<Self>,
            Receiver<LanguageServerRuntimeStatus>,
            Arc<dyn DiagnosticsSink>,
            Receiver<LanguageServerDiagnosticEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            let (diagnostics_sink, diagnostics_rx) = ChannelDiagnosticsSink::new();
            (
                Arc::new(Self { tx: Mutex::new(tx) }),
                rx,
                diagnostics_sink,
                diagnostics_rx,
            )
        }
    }

    impl StatusSink for ChannelSink {
        fn emit_status(&self, status: LanguageServerRuntimeStatus) {
            let _ = self.tx.lock().expect("sink lock").send(status);
        }
    }

    struct ChannelDiagnosticsSink {
        tx: Mutex<Sender<LanguageServerDiagnosticEvent>>,
    }

    impl ChannelDiagnosticsSink {
        fn new() -> (
            Arc<dyn DiagnosticsSink>,
            Receiver<LanguageServerDiagnosticEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl DiagnosticsSink for ChannelDiagnosticsSink {
        fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent) {
            let _ = self.tx.lock().expect("diagnostics sink lock").send(event);
        }
    }

    struct NoopDiagnosticsSink;

    impl DiagnosticsSink for NoopDiagnosticsSink {
        fn emit_diagnostics(&self, _event: LanguageServerDiagnosticEvent) {
            // no-op for status-only tests
        }
    }

    fn _unique_label(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        format!("{prefix}-{nanos}")
    }
}
