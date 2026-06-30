use crate::lsp::{file_uri, JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
use crate::lsp_diagnostics::{parse_publish_diagnostics, LanguageServerDiagnosticEvent};
use crate::lsp_features::{
    parse_workspace_edit_result, LanguageServerWorkspaceEdit, LanguageServerWorkspaceFileOperation,
};
use crate::lsp_transport::{read_message, write_message};
#[cfg(unix)]
use crate::managed_javascript_typescript;
#[cfg(unix)]
use crate::managed_phpactor;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const PHP_STATUS_EVENT: &str = "language-server://status";
pub const PHP_DIAGNOSTICS_EVENT: &str = "language-server://diagnostics";
pub const PHP_REFRESH_EVENT: &str = "language-server://refresh";
pub const PHP_WORKSPACE_EDIT_EVENT: &str = "language-server://workspace-edit";
pub const JAVASCRIPT_TYPESCRIPT_STATUS_EVENT: &str =
    "javascript-typescript-language-server://status";
pub const JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT: &str =
    "javascript-typescript-language-server://diagnostics";
pub const JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT: &str =
    "javascript-typescript-language-server://refresh";
pub const JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT: &str =
    "javascript-typescript-language-server://workspace-edit";
type PendingRequestResult = Result<Value, String>;
type PendingRequestSender = mpsc::Sender<PendingRequestResult>;
type PendingRequests = Arc<Mutex<HashMap<u64, PendingRequestSender>>>;
type RuntimeLog = Arc<Mutex<String>>;
const RUNTIME_LOG_MAX_BYTES: usize = 128 * 1024;

struct ServerWindowMessage {
    chunk: String,
    requires_response: bool,
}

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
    pub call_hierarchy: bool,
    pub code_action: bool,
    pub code_action_resolve: bool,
    pub code_lens: bool,
    pub declaration: bool,
    pub hover: bool,
    pub completion: bool,
    pub definition: bool,
    pub document_highlight: bool,
    pub document_link: bool,
    pub document_symbol: bool,
    pub did_create_files: bool,
    pub did_delete_files: bool,
    pub did_rename_files: bool,
    pub folding_range: bool,
    pub formatting: bool,
    pub implementation: bool,
    pub inlay_hint: bool,
    pub linked_editing_range: bool,
    pub on_type_formatting: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_type_formatting_trigger_characters: Option<Vec<String>>,
    pub prepare_rename: bool,
    pub range_formatting: bool,
    pub references: bool,
    pub rename: bool,
    pub selection_range: bool,
    pub semantic_tokens: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_tokens_legend: Option<SemanticTokensLegend>,
    pub signature_help: bool,
    pub source_definition: bool,
    pub type_definition: bool,
    pub type_hierarchy: bool,
    pub will_create_files: bool,
    pub will_delete_files: bool,
    pub will_rename_files: bool,
    pub workspace_symbol: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticTokensLegend {
    pub token_types: Vec<String>,
    pub token_modifiers: Vec<String>,
}

pub trait StatusSink: Send + Sync {
    fn emit_status(&self, status: LanguageServerRuntimeStatus);
}

pub trait DiagnosticsSink: Send + Sync {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent);
}

pub trait RefreshSink: Send + Sync {
    fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool;
}

pub struct AppHandleEventSink {
    app: tauri::AppHandle,
    diagnostics_event: &'static str,
    refresh_event: &'static str,
    root_path: String,
    status_event: &'static str,
    workspace_edit_event: &'static str,
}

impl AppHandleEventSink {
    pub fn for_workspace(app: tauri::AppHandle, root_path: String) -> Self {
        Self::new_with_events_and_root(
            app,
            PHP_STATUS_EVENT,
            PHP_DIAGNOSTICS_EVENT,
            PHP_REFRESH_EVENT,
            PHP_WORKSPACE_EDIT_EVENT,
            root_path,
        )
    }

    pub fn javascript_typescript_for_workspace(app: tauri::AppHandle, root_path: String) -> Self {
        Self::new_with_events_and_root(
            app,
            JAVASCRIPT_TYPESCRIPT_STATUS_EVENT,
            JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
            JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
            JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
            root_path,
        )
    }

    fn new_with_events_and_root(
        app: tauri::AppHandle,
        status_event: &'static str,
        diagnostics_event: &'static str,
        refresh_event: &'static str,
        workspace_edit_event: &'static str,
        root_path: String,
    ) -> Self {
        Self {
            app,
            diagnostics_event,
            refresh_event,
            root_path,
            status_event,
            workspace_edit_event,
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

impl RefreshSink for AppHandleEventSink {
    fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool {
        use tauri::Emitter;

        self.app
            .emit(
                self.refresh_event,
                refresh_event_payload(&self.root_path, event),
            )
            .is_ok()
    }
}

impl WorkspaceEditSink for AppHandleEventSink {
    fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool {
        use tauri::Emitter;

        self.app
            .emit(
                self.workspace_edit_event,
                workspace_edit_event_payload(&self.root_path, event),
            )
            .is_ok()
    }
}

pub(crate) fn language_server_status_payload(
    root_path: &str,
    status: LanguageServerRuntimeStatus,
) -> Value {
    let mut value = serde_json::to_value(status).unwrap_or(Value::Null);

    if let Value::Object(object) = &mut value {
        object.insert("rootPath".to_string(), Value::String(root_path.to_string()));
    }

    value
}

fn status_event_payload(root_path: &str, status: LanguageServerRuntimeStatus) -> Value {
    language_server_status_payload(root_path, status)
}

fn diagnostics_event_payload(root_path: &str, event: LanguageServerDiagnosticEvent) -> Value {
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);

    if let Value::Object(object) = &mut value {
        object.insert("rootPath".to_string(), Value::String(root_path.to_string()));
    }

    value
}

fn refresh_event_payload(root_path: &str, event: LanguageServerRefreshEvent) -> Value {
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);

    if let Value::Object(object) = &mut value {
        object.insert("rootPath".to_string(), Value::String(root_path.to_string()));
    }

    value
}

fn workspace_edit_event_payload(root_path: &str, event: LanguageServerWorkspaceEditEvent) -> Value {
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);

    if let Value::Object(object) = &mut value {
        object.insert("rootPath".to_string(), Value::String(root_path.to_string()));
    }

    value
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerRefreshFeature {
    CodeLens,
    InlayHint,
    SemanticTokens,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerRefreshEvent {
    pub session_id: u64,
    pub feature: LanguageServerRefreshFeature,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerWorkspaceEditEvent {
    pub session_id: u64,
    pub label: Option<String>,
    pub edit: LanguageServerWorkspaceEdit,
}

pub trait WorkspaceEditSink: Send + Sync {
    fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool;
}

#[cfg(test)]
struct NoopWorkspaceEditSink;

#[cfg(test)]
impl WorkspaceEditSink for NoopWorkspaceEditSink {
    fn emit_workspace_edit(&self, _event: LanguageServerWorkspaceEditEvent) -> bool {
        false
    }
}

#[cfg(test)]
struct NoopRefreshSink;

#[cfg(test)]
impl RefreshSink for NoopRefreshSink {
    fn emit_refresh(&self, _event: LanguageServerRefreshEvent) -> bool {
        false
    }
}

pub trait ServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer>;
}

pub struct SpawnedServer {
    pub stderr: Option<Box<dyn Read + Send>>,
    pub stdin: Box<dyn Write + Send>,
    pub stdout: Box<dyn Read + Send>,
    pub killer: Box<dyn ProcessKiller>,
}

pub trait ProcessKiller: Send {
    fn terminate(&mut self) -> io::Result<()>;

    /// Operating-system process id of the spawned language server, when known.
    /// Used by the runtime observability panel to sample per-process RAM/CPU and
    /// to surface the live PID. Test/fake killers without a real OS process
    /// return `None`.
    fn pid(&self) -> Option<u32> {
        None
    }
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
            .stderr(Stdio::piped());

        // Apply per-command environment (e.g. `PHPRC=<managed.ini>` for managed
        // PHPactor). Env vars are inherited by child processes the server spawns,
        // so this isolates the whole PHPactor process tree from a noisy user
        // `php.ini` — unlike the `-c <ini>` CLI argument, which children do not
        // inherit.
        for (key, value) in &command.env {
            command_builder.env(key, value);
        }

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
        let stderr = child
            .stderr
            .take()
            .map(|stderr| Box::new(stderr) as Box<dyn Read + Send>);

        Ok(SpawnedServer {
            stderr,
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
    fn pid(&self) -> Option<u32> {
        Some(self.child.id())
    }

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
    primary_workspace_runtime_id(&PathBuf::from(root_path))
}

fn workspace_runtime_id_candidates(root_path: &str) -> Vec<String> {
    let path = PathBuf::from(root_path);
    let mut candidates = Vec::new();

    push_unique_key(&mut candidates, primary_workspace_runtime_id(&path));

    if let Some(resolved) = resolve_existing_or_parent_path(&path) {
        push_unique_path_key(&mut candidates, &resolved);
    }

    push_unique_path_key(&mut candidates, &normalize_path(&path));
    candidates
}

fn primary_workspace_runtime_id(path: &Path) -> String {
    if let Ok(canonical) = path.canonicalize() {
        return path_key(&canonical);
    }

    path_key(path)
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
    push_unique_key(candidates, path_key(path));
}

fn push_unique_key(candidates: &mut Vec<String>, key: String) {
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

enum HandshakeOutcome {
    Ready(LanguageServerCapabilities),
    Failed(String),
    Disconnected,
}

struct RunningSession {
    pid: Option<u32>,
    stderr_reader: Option<JoinHandle<()>>,
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ProcessKiller>,
    pending_requests: PendingRequests,
    reader: Option<JoinHandle<()>>,
    server_configuration: Arc<Mutex<Value>>,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
}

pub struct LanguageServerSupervisor {
    log: RuntimeLog,
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

struct PhpLaunchContext {
    command: LanguageServerCommand,
    initialize_request: JsonRpcRequest,
    root_path: String,
}

impl Clone for PhpLaunchContext {
    fn clone(&self) -> Self {
        Self {
            command: clone_command(&self.command),
            initialize_request: clone_initialize_request(&self.initialize_request),
            root_path: self.root_path.clone(),
        }
    }
}

pub struct PhpLanguageServerRegistry {
    registry: LanguageServerRegistry,
    launch_contexts: Mutex<HashMap<String, PhpLaunchContext>>,
}

impl PhpLanguageServerRegistry {
    pub fn new() -> Self {
        Self {
            registry: LanguageServerRegistry::new_with_label("PHPactor"),
            launch_contexts: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub fn start(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let status = self.registry.start(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
        )?;
        self.store_launch_context_if_active(root_path, command, initialize_request, &status);
        Ok(status)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_with_auto_restart(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let status = self.registry.start_with_auto_restart(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            restart_controller,
        )?;
        self.store_launch_context_if_active(root_path, command, initialize_request, &status);
        Ok(status)
    }

    pub fn stop(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let context = self.remove_launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_preserving_launch_context(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let context = self.launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        let contexts = self.drain_launch_contexts();
        let status = self.registry.stop_all();

        for (root_path, context) in contexts {
            self.cleanup_stopped_root(&root_path, Some(context));
        }

        status
    }

    fn store_launch_context_if_active(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        status: &LanguageServerRuntimeStatus,
    ) {
        if !is_active_status(status) {
            return;
        }

        let runtime_id = workspace_runtime_id(root_path);
        if let Ok(mut contexts) = self.launch_contexts.lock() {
            contexts.insert(
                runtime_id,
                PhpLaunchContext {
                    command: clone_command(command),
                    initialize_request: clone_initialize_request(initialize_request),
                    root_path: root_path.to_string(),
                },
            );
        }
    }

    fn remove_launch_context(&self, root_path: &str) -> Option<PhpLaunchContext> {
        let mut contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(context) = contexts.remove(&runtime_id) {
                return Some(context);
            }
        }

        None
    }

    fn launch_context(&self, root_path: &str) -> Option<PhpLaunchContext> {
        let contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(context) = contexts.get(&runtime_id) {
                return Some(context.clone());
            }
        }

        None
    }

    /// Stop the workspace's PHPactor and start it again from the same launch
    /// command that was last used for this root. Isolation: the launch context
    /// is keyed by the requested root, so a restart only ever re-spawns this
    /// workspace's server - never a sibling tab's. Returns an error when no
    /// server has been started for the root yet (nothing to restart).
    ///
    /// Race with workspace close: stop and start are two separately-locked
    /// registry operations, identical to a manual `stop` + `start` pair. If a
    /// tab close (`dispose_workspace_root` -> `stop`) interleaves, the worst case
    /// is a freshly re-spawned server for a root that is closing; that close (or
    /// the next one) runs `stop` again over the same per-root key and reaps it,
    /// so no server outlives its workspace. We accept this bounded window rather
    /// than holding a registry-wide lock across a multi-second handshake.
    #[allow(clippy::too_many_arguments)]
    pub fn restart_with_auto_restart(
        &self,
        root_path: &str,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let Some(context) = self.launch_context(root_path) else {
            return Err(
                "PHP language server has not been started for this workspace yet.".to_string(),
            );
        };

        self.stop(root_path);

        self.start_with_auto_restart(
            root_path,
            &context.command,
            &context.initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            restart_controller,
        )
    }

    fn drain_launch_contexts(&self) -> Vec<(String, PhpLaunchContext)> {
        self.launch_contexts
            .lock()
            .map(|mut contexts| contexts.drain().collect())
            .unwrap_or_default()
    }

    fn cleanup_stopped_root(&self, _root_path: &str, context: Option<PhpLaunchContext>) {
        #[cfg(not(unix))]
        let _ = context;

        #[cfg(unix)]
        if let Some(context) = context {
            managed_phpactor::cleanup_orphaned_managed_phpactor_processes(
                &context.command,
                &context.root_path,
                &self.registry.running_roots(),
            );
        }
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
        &self.registry
    }
}

struct JavaScriptTypeScriptLaunchContext {
    command: LanguageServerCommand,
    initialize_request: JsonRpcRequest,
    root_path: String,
}

impl Clone for JavaScriptTypeScriptLaunchContext {
    fn clone(&self) -> Self {
        Self {
            command: clone_command(&self.command),
            initialize_request: clone_initialize_request(&self.initialize_request),
            root_path: self.root_path.clone(),
        }
    }
}

pub struct JavaScriptTypeScriptLanguageServerRegistry {
    registry: LanguageServerRegistry,
    launch_contexts: Mutex<HashMap<String, JavaScriptTypeScriptLaunchContext>>,
}

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub fn new() -> Self {
        Self {
            registry: LanguageServerRegistry::new_with_label("TypeScript language server"),
            launch_contexts: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub fn start(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let status = self.registry.start(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
        )?;
        self.store_launch_context_if_active(root_path, command, initialize_request, &status);
        Ok(status)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_with_auto_restart(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let status = self.registry.start_with_auto_restart(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            restart_controller,
        )?;
        self.store_launch_context_if_active(root_path, command, initialize_request, &status);
        Ok(status)
    }

    pub fn stop(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let context = self.remove_launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_preserving_launch_context(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let context = self.launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        let contexts = self.drain_launch_contexts();
        let status = self.registry.stop_all();

        for (root_path, context) in contexts {
            self.cleanup_stopped_root(&root_path, Some(context));
        }

        status
    }

    fn store_launch_context_if_active(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        status: &LanguageServerRuntimeStatus,
    ) {
        if !is_active_status(status) {
            return;
        }

        let runtime_id = workspace_runtime_id(root_path);
        if let Ok(mut contexts) = self.launch_contexts.lock() {
            contexts.insert(
                runtime_id,
                JavaScriptTypeScriptLaunchContext {
                    command: clone_command(command),
                    initialize_request: clone_initialize_request(initialize_request),
                    root_path: root_path.to_string(),
                },
            );
        }
    }

    fn remove_launch_context(&self, root_path: &str) -> Option<JavaScriptTypeScriptLaunchContext> {
        let mut contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(context) = contexts.remove(&runtime_id) {
                return Some(context);
            }
        }

        None
    }

    fn launch_context(&self, root_path: &str) -> Option<JavaScriptTypeScriptLaunchContext> {
        let contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(context) = contexts.get(&runtime_id) {
                return Some(context.clone());
            }
        }

        None
    }

    /// Stop the workspace's TypeScript language server and start it again from
    /// the same command/initialize request last used for this root. Isolation:
    /// the launch context is keyed by the requested root, so a restart only ever
    /// re-spawns this workspace's server - never a sibling tab's. Returns an
    /// error when no server has been started for the root yet.
    ///
    /// Race with workspace close: like the PHP variant, stop and start are
    /// separately-locked operations. A tab close interleaving the restart can at
    /// worst re-spawn a server for a closing root; that close (or the next) runs
    /// `stop` again over the same per-root key and reaps it, so no server
    /// outlives its workspace.
    #[allow(clippy::too_many_arguments)]
    pub fn restart_with_auto_restart(
        &self,
        root_path: &str,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let Some(context) = self.launch_context(root_path) else {
            return Err(
                "TypeScript language server has not been started for this workspace yet."
                    .to_string(),
            );
        };

        self.stop(root_path);

        self.start_with_auto_restart(
            root_path,
            &context.command,
            &context.initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            restart_controller,
        )
    }

    fn drain_launch_contexts(&self) -> Vec<(String, JavaScriptTypeScriptLaunchContext)> {
        self.launch_contexts
            .lock()
            .map(|mut contexts| contexts.drain().collect())
            .unwrap_or_default()
    }

    fn cleanup_stopped_root(
        &self,
        _root_path: &str,
        context: Option<JavaScriptTypeScriptLaunchContext>,
    ) {
        #[cfg(not(unix))]
        let _ = context;

        #[cfg(unix)]
        if let Some(context) = context {
            managed_javascript_typescript::cleanup_orphaned_javascript_typescript_processes(
                &context.command,
                &context.initialize_request,
                &context.root_path,
                &self.registry.running_roots(),
            );
        }
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
        &self.registry
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

    pub fn log(&self, root_path: &str) -> String {
        self.existing_supervisor(root_path)
            .map(|supervisor| supervisor.log())
            .unwrap_or_default()
    }

    pub fn pid(&self, root_path: &str) -> Option<u32> {
        self.existing_supervisor(root_path)
            .and_then(|supervisor| supervisor.pid())
    }

    #[cfg(test)]
    pub fn start(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_workspace_edit_sink(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            Arc::new(NoopWorkspaceEditSink),
        )
    }

    #[cfg(test)]
    pub fn start_with_workspace_edit_sink(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_event_sinks(
            root_path,
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            Arc::new(NoopRefreshSink),
        )
    }

    #[cfg(test)]
    pub fn start_with_event_sinks(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.supervisor_for(root_path)?.start_with_event_sinks(
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
        )
    }

    /// Start (or re-create) the per-workspace supervisor with crash auto-restart
    /// enabled. The `restart_controller` is owned per workspace, so a crash in
    /// one workspace's server can only re-spawn that same workspace — restart
    /// budgets never leak across open project tabs.
    #[allow(clippy::too_many_arguments)]
    pub fn start_with_auto_restart(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.supervisor_for(root_path)?.start_with_auto_restart(
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            restart_controller,
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

    pub fn update_server_configuration(
        &self,
        root_path: &str,
        server_configuration: Value,
    ) -> Result<(), String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(());
        };

        supervisor.update_server_configuration(server_configuration)
    }

    /// Synchronous, main-thread-blocking request helper retained for tests that
    /// drive the round-trip on a dedicated thread. Production commands use
    /// [`send_request_async`](Self::send_request_async), which runs the blocking
    /// round-trip off the Tauri main thread.
    #[cfg(test)]
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

    /// Off-main-thread variant of [`send_request`](Self::send_request). The supervisor for the
    /// requested workspace is resolved synchronously here (a fast mutex + `Arc`
    /// clone) so per-workspace isolation is decided before any await and the
    /// returned future borrows nothing from `self`. The blocking JSON-RPC
    /// round-trip (`recv_timeout`) then runs on Tokio's dedicated blocking pool,
    /// keeping the Tauri WebView main thread responsive while the language
    /// server replies and avoiding starvation of the async executor.
    ///
    /// Returning a `'static` future (rather than an `async fn` borrowing
    /// `&self`) lets Tauri commands call this through a `State<'_, _>` reference
    /// without tying the awaited work to the command's borrow.
    pub fn send_request_async(
        &self,
        root_path: &str,
        method: &str,
        params: Value,
    ) -> impl std::future::Future<Output = Result<Option<Value>, String>> + 'static {
        let supervisor = self.existing_supervisor(root_path);
        let method = method.to_string();

        async move {
            let Some(supervisor) = supervisor else {
                return Ok(None);
            };

            tauri::async_runtime::spawn_blocking(move || supervisor.send_request(&method, params))
                .await
                .map_err(|error| format!("Language server request task failed: {error}"))?
        }
    }

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
        let supervisors = self.supervisors.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(supervisor) = supervisors.get(&runtime_id) {
                return Some(Arc::clone(supervisor));
            }
        }

        None
    }

    fn remove_supervisor(&self, root_path: &str) -> Option<Arc<LanguageServerSupervisor>> {
        let mut supervisors = self.supervisors.lock().ok()?;

        for runtime_id in workspace_runtime_id_candidates(root_path) {
            if let Some(supervisor) = supervisors.remove(&runtime_id) {
                return Some(supervisor);
            }
        }

        None
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
            log: Arc::new(Mutex::new(String::new())),
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
            status_sink,
            diagnostics_sink,
            Arc::new(NoopWorkspaceEditSink),
        )
    }

    #[cfg(test)]
    fn start_with_workspace_edit_sink(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_event_sinks(
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            Arc::new(NoopRefreshSink),
        )
    }

    #[cfg(test)]
    fn start_with_event_sinks(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_core(
            command,
            initialize_request,
            spawner,
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            None,
            StartKind::Fresh,
        )
    }

    /// Start a session that automatically re-spawns the language server when it
    /// crashes unexpectedly (not on a requested shutdown). Restarts are governed
    /// by `restart_controller`: an exponential backoff with a bounded number of
    /// attempts inside a sliding window, reset once a session runs stably.
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
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let restart_context = RestartContext {
            supervisor: Arc::downgrade(self),
            command: clone_command(command),
            initialize_request: clone_initialize_request(initialize_request),
            spawner: Arc::clone(&spawner),
            status_sink: Arc::clone(&status_sink),
            diagnostics_sink: Arc::clone(&diagnostics_sink),
            workspace_edit_sink: Arc::clone(&workspace_edit_sink),
            refresh_sink: Arc::clone(&refresh_sink),
            controller: restart_controller,
        };

        self.start_core(
            command,
            initialize_request,
            spawner.as_ref(),
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            Some(Arc::new(restart_context)),
            StartKind::Fresh,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn start_core(
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
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        self.terminate_stale_session();
        reset_runtime_log(&self.log, self.server_label, session_id, command);
        self.begin_start(status_sink.as_ref(), session_id, start_kind)?;

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
        let stderr_reader = spawned
            .stderr
            .map(|stderr| spawn_stderr_reader(stderr, Arc::clone(&self.log)));
        let server_configuration = Arc::new(Mutex::new(
            server_configuration_from_initialize_request(initialize_request),
        ));
        let pid = spawned.killer.pid();
        let mut session = Some(RunningSession {
            pid,
            stderr_reader,
            stdin: Arc::clone(&stdin),
            killer: spawned.killer,
            pending_requests: Arc::clone(&pending_requests),
            reader: None,
            server_configuration: Arc::clone(&server_configuration),
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
        let workspace_root = command.working_directory.clone();
        let mut reader = Some(spawn_reader(
            spawned.stdout,
            Arc::clone(&stdin),
            Arc::clone(&self.status),
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

                let running = self.publish_running_if_starting(
                    status_sink.as_ref(),
                    &stop_requested,
                    session_id,
                    capabilities,
                );

                if let Ok(LanguageServerRuntimeStatus::Running { .. }) = &running {
                    if let Some(context) = &restart_context {
                        context.controller.note_stable_run();
                    }
                }

                running
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

    fn begin_start(
        &self,
        sink: &dyn StatusSink,
        session_id: u64,
        start_kind: StartKind,
    ) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;

        if is_active_status(&status) {
            return Err("Language server already running.".to_string());
        }

        // An auto-restart may only resume a session that is *still* crashed. If a
        // concurrent stop (workspace close / session switch) already moved the
        // status to Stopped, abort so we never resurrect a closed workspace. The
        // status check and the transition to Starting happen under the same lock,
        // closing the crash->stop race window.
        if matches!(start_kind, StartKind::Restart)
            && !matches!(*status, LanguageServerRuntimeStatus::Crashed { .. })
        {
            return Err("Auto-restart aborted: session is no longer crashed.".to_string());
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

    fn session_server_configuration(&self) -> Option<Arc<Mutex<Value>>> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .map(|session| Arc::clone(&session.server_configuration))
    }

    #[cfg(test)]
    fn force_status(&self, next: LanguageServerRuntimeStatus) {
        set_status(&self.status, next);
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

    if let Some(stderr_reader) = session.stderr_reader.take() {
        let _ = stderr_reader.join();
    }
}

fn reset_runtime_log(
    log: &RuntimeLog,
    server_label: &str,
    session_id: u64,
    command: &LanguageServerCommand,
) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let command_line = std::iter::once(command.executable.clone())
        .chain(command.args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    let env_lines = command
        .env
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");
    let env_block = if env_lines.is_empty() {
        "env: (none)".to_string()
    } else {
        format!("env:\n{env_lines}")
    };
    let header = format!(
        "{server_label} session {session_id} started at {timestamp}\nworking directory: {}\ncommand: {command_line}\n{env_block}\n\n",
        command.working_directory,
    );

    if let Ok(mut current) = log.lock() {
        *current = header;
    }
}

fn spawn_stderr_reader(stderr: Box<dyn Read + Send>, log: RuntimeLog) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0_u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(count) => {
                    append_runtime_log(&log, &String::from_utf8_lossy(&buffer[..count]));
                }
            }
        }
    })
}

fn append_runtime_log(log: &RuntimeLog, chunk: &str) {
    let Ok(mut current) = log.lock() else {
        return;
    };

    current.push_str(chunk);

    if current.len() <= RUNTIME_LOG_MAX_BYTES {
        return;
    }

    let mut trim_to = current.len() - RUNTIME_LOG_MAX_BYTES;

    while trim_to < current.len() && !current.is_char_boundary(trim_to) {
        trim_to += 1;
    }

    current.drain(..trim_to);
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

/// Default number of restart attempts allowed inside [`RESTART_WINDOW`] before a
/// crashed session is left in the `Crashed` state (so it can never loop forever).
const RESTART_MAX_ATTEMPTS: usize = 3;
/// Sliding window over which restart attempts are counted. A session that stays
/// up long enough for older failures to fall outside this window regains its
/// full restart budget.
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// Base delay used for the exponential backoff (1s, 2s, 4s, …).
const RESTART_BASE_DELAY: Duration = Duration::from_secs(1);
/// Upper bound on a single backoff delay so attempts stay responsive.
const RESTART_MAX_DELAY: Duration = Duration::from_secs(30);

/// Pure restart-decision logic for a single workspace session.
///
/// The policy tracks recent restart attempts inside a sliding time window and
/// decides whether another restart is allowed. It is intentionally clock-driven
/// through explicit `now` arguments so the decision/backoff logic is testable
/// without sleeping or wall-clock dependence.
#[derive(Debug)]
pub struct RestartPolicy {
    max_attempts: usize,
    window: Duration,
    base_delay: Duration,
    attempts: Vec<Instant>,
}

impl RestartPolicy {
    pub fn new(max_attempts: usize, window: Duration, base_delay: Duration) -> Self {
        Self {
            max_attempts,
            window,
            base_delay,
            attempts: Vec::new(),
        }
    }

    fn prune(&mut self, now: Instant) {
        let window = self.window;
        self.attempts
            .retain(|attempt| now.saturating_duration_since(*attempt) < window);
    }

    fn next_attempt_index(&mut self, now: Instant) -> usize {
        self.prune(now);
        self.attempts.len()
    }

    fn should_restart(&mut self, now: Instant) -> bool {
        self.next_attempt_index(now) < self.max_attempts
    }

    fn record_attempt(&mut self, now: Instant) {
        self.prune(now);
        self.attempts.push(now);
    }

    fn backoff_delay(&self, attempt_index: usize) -> Duration {
        // A large index must clamp to the cap, never wrap to a tiny delay, so
        // compute the multiplier in u64 (no u32 truncation) and saturate.
        let Some(shift) = u32::try_from(attempt_index)
            .ok()
            .filter(|shift| *shift < u64::BITS)
        else {
            return RESTART_MAX_DELAY;
        };
        let factor = 1_u64 << shift;
        let base_millis = self.base_delay.as_millis() as u64;
        let delay = base_millis
            .checked_mul(factor)
            .map(Duration::from_millis)
            .unwrap_or(RESTART_MAX_DELAY);

        delay.min(RESTART_MAX_DELAY)
    }

    fn reset(&mut self) {
        self.attempts.clear();
    }
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self::new(RESTART_MAX_ATTEMPTS, RESTART_WINDOW, RESTART_BASE_DELAY)
    }
}

/// Outcome of evaluating a crash against the restart budget.
#[derive(Debug, PartialEq, Eq)]
enum RestartOutcome {
    /// Re-spawn the session after waiting `delay`.
    Restart { delay: Duration },
    /// Leave the session crashed (shutdown requested, or budget exhausted).
    GiveUp,
}

/// Convenience helper documenting the shutdown rule: a requested shutdown must
/// never restart, regardless of remaining budget. Exercised by the unit tests.
#[allow(dead_code)]
struct RestartDecision;

impl RestartDecision {
    /// A requested shutdown (quit, workspace close, session switch) must never
    /// trigger a restart, independent of the remaining restart budget.
    #[allow(dead_code)]
    fn for_shutdown(_policy: &RestartPolicy) -> bool {
        false
    }
}

/// Thread-safe wrapper around [`RestartPolicy`] shared with the reader thread
/// that detects crashes. The decision is taken under a lock so concurrent crash
/// callbacks for the same workspace cannot race the attempt budget.
pub struct RestartController {
    policy: Mutex<RestartPolicy>,
}

impl RestartController {
    pub fn new(policy: RestartPolicy) -> Self {
        Self {
            policy: Mutex::new(policy),
        }
    }

    /// Decide what to do after a crash. `stop_requested` distinguishes a
    /// legitimate shutdown (no restart) from an unexpected crash (maybe restart).
    fn evaluate_crash(&self, stop_requested: bool) -> RestartOutcome {
        if stop_requested {
            return RestartOutcome::GiveUp;
        }

        let Ok(mut policy) = self.policy.lock() else {
            return RestartOutcome::GiveUp;
        };

        let now = Instant::now();

        if !policy.should_restart(now) {
            return RestartOutcome::GiveUp;
        }

        // `should_restart` already pruned expired attempts; the surviving count is
        // the index of the attempt we are about to make and drives the backoff.
        let attempt_index = policy.attempts.len();
        let delay = policy.backoff_delay(attempt_index);
        policy.record_attempt(now);
        RestartOutcome::Restart { delay }
    }

    /// Reset the attempt budget after a session has run successfully so a later
    /// crash starts its backoff sequence from scratch.
    fn note_stable_run(&self) {
        if let Ok(mut policy) = self.policy.lock() {
            policy.reset();
        }
    }
}

impl Default for RestartController {
    fn default() -> Self {
        Self::new(RestartPolicy::default())
    }
}

/// Distinguishes a fresh start (user request) from an auto-restart after a
/// crash. A restart is only allowed to resume a session that is still crashed,
/// which keeps the crash->stop transition race-free.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartKind {
    Fresh,
    Restart,
}

/// Everything needed to re-spawn a crashed session for the *same* workspace.
///
/// Captured per session and handed to the reader thread. On an unexpected crash
/// the reader consults [`RestartController`] and, if a restart is allowed,
/// re-enters the owning supervisor to start a fresh session. The supervisor is
/// held weakly so a dropped/closed workspace cannot be resurrected.
#[allow(dead_code)]
struct RestartContext {
    supervisor: std::sync::Weak<LanguageServerSupervisor>,
    command: LanguageServerCommand,
    initialize_request: JsonRpcRequest,
    spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
    status_sink: Arc<dyn StatusSink>,
    diagnostics_sink: Arc<dyn DiagnosticsSink>,
    workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    refresh_sink: Arc<dyn RefreshSink>,
    controller: Arc<RestartController>,
}

/// Step size for the cancellable backoff. The backoff total can be as long as
/// [`RESTART_MAX_DELAY`] (30s); waking this often keeps a closing workspace's
/// restart thread responsive without busy-spinning.
const RESTART_BACKOFF_STEP: Duration = Duration::from_millis(100);

/// Sleep out `delay` in short steps, re-checking after each step whether the
/// owning workspace is still open. The only strong reference to a supervisor
/// lives in the registry map, so a failed [`Weak::upgrade`] is the canonical
/// "workspace closed" signal (registry `stop`/`stop_all` dropped it). When that
/// happens we bail immediately instead of lingering for the full backoff,
/// dropping the captured restart context (and its sinks) promptly.
///
/// Returns the live supervisor only if the workspace stayed open for the whole
/// backoff; `None` means the restart must be abandoned.
fn cancellable_backoff(
    supervisor: &std::sync::Weak<LanguageServerSupervisor>,
    delay: Duration,
    step: Duration,
) -> Option<Arc<LanguageServerSupervisor>> {
    let deadline = Instant::now() + delay;

    loop {
        // Re-check liveness before every sleep (and once before the first one) so
        // a workspace that closes during backoff cancels within a single step.
        let alive = supervisor.upgrade()?;

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Some(alive);
        }

        // Drop the strong reference while sleeping so the backoff itself never
        // keeps a closing workspace's supervisor alive.
        drop(alive);
        std::thread::sleep(remaining.min(step));
    }
}

impl RestartContext {
    /// Re-spawn the session after `delay`. Returns silently if the workspace was
    /// closed in the meantime (the supervisor was dropped or a stop/start raced
    /// in), preserving per-workspace isolation. The backoff is cancellable: if
    /// the workspace closes (registry `stop`/`stop_all`, app quit) while we are
    /// waiting, the thread bails promptly without re-spawning.
    fn restart_after(self: Arc<Self>, delay: Duration) {
        std::thread::spawn(move || {
            // The workspace may close while we back off (supervisor dropped from
            // the registry). Sleep in cancellable steps and skip the work entirely
            // the moment that happens.
            let Some(supervisor) =
                cancellable_backoff(&self.supervisor, delay, RESTART_BACKOFF_STEP)
            else {
                return;
            };

            // `StartKind::Restart` makes `begin_start` re-verify, under the status
            // lock, that the session is *still* crashed before transitioning to
            // Starting. A concurrent stop (Stopped) or manual start
            // (Starting/Running) aborts the restart atomically, so a closed
            // workspace can never be resurrected.
            let _ = supervisor.start_core(
                &self.command,
                &self.initialize_request,
                self.spawner.as_ref(),
                Arc::clone(&self.status_sink),
                Arc::clone(&self.diagnostics_sink),
                Arc::clone(&self.workspace_edit_sink),
                Arc::clone(&self.refresh_sink),
                Some(Arc::clone(&self)),
                StartKind::Restart,
            );
        });
    }
}

#[allow(dead_code)]
fn clone_command(command: &LanguageServerCommand) -> LanguageServerCommand {
    LanguageServerCommand {
        executable: command.executable.clone(),
        args: command.args.clone(),
        working_directory: command.working_directory.clone(),
        env: command.env.clone(),
    }
}

#[allow(dead_code)]
fn clone_initialize_request(request: &JsonRpcRequest) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: request.jsonrpc.clone(),
        id: request.id,
        method: request.method.clone(),
        params: request.params.clone(),
    }
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

#[allow(clippy::too_many_arguments)]
fn spawn_reader(
    stdout: Box<dyn Read + Send>,
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    runtime_log: RuntimeLog,
    diagnostics_sink: Arc<dyn DiagnosticsSink>,
    workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    refresh_sink: Arc<dyn RefreshSink>,
    pending_requests: PendingRequests,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
    handshake_tx: mpsc::Sender<HandshakeOutcome>,
    init_id: u64,
    session_id: u64,
    server_label: &'static str,
    server_configuration: Arc<Mutex<Value>>,
    workspace_root: String,
    restart_context: Option<Arc<RestartContext>>,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut handshake_done = false;

        loop {
            match read_message(&mut reader) {
                Ok(Some(bytes)) => {
                    if handshake_done && stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        continue;
                    };

                    if let Some(message) = server_window_message(&value, server_label) {
                        append_runtime_log(&runtime_log, &message.chunk);

                        if !message.requires_response {
                            continue;
                        }
                    }

                    if handshake_done {
                        if stop_requested.load(Ordering::SeqCst) {
                            return;
                        }

                        if route_pending_response(&pending_requests, &value) {
                            continue;
                        }

                        if respond_to_server_request(
                            &stdin,
                            &value,
                            workspace_edit_sink.as_ref(),
                            refresh_sink.as_ref(),
                            session_id,
                            &server_configuration,
                            &workspace_root,
                        )
                        .is_ok()
                        {
                            continue;
                        }

                        if let Some(event) = parse_publish_diagnostics(&value, session_id) {
                            let Some(event) =
                                filter_diagnostic_event_to_workspace(&workspace_root, event)
                            else {
                                continue;
                            };

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

                    maybe_restart_after_crash(&restart_context, &stop_requested);
                    return;
                }
            }
        }
    })
}

/// Consult the restart controller after an unexpected crash and, if a restart
/// is allowed, schedule a backed-off re-spawn for the same workspace. A
/// requested shutdown (`stop_requested`) or an exhausted budget leaves the
/// session in the already-published `Crashed` state — no infinite loop.
fn maybe_restart_after_crash(
    restart_context: &Option<Arc<RestartContext>>,
    stop_requested: &Arc<AtomicBool>,
) {
    let Some(context) = restart_context else {
        return;
    };

    let stop = stop_requested.load(Ordering::SeqCst);

    match context.controller.evaluate_crash(stop) {
        RestartOutcome::GiveUp => {}
        RestartOutcome::Restart { delay } => {
            Arc::clone(context).restart_after(delay);
        }
    }
}

fn server_window_message(value: &Value, server_label: &str) -> Option<ServerWindowMessage> {
    let method = value.get("method").and_then(Value::as_str)?;
    let (method_label, requires_response) = match method {
        "window/logMessage" => ("logMessage", false),
        "window/showMessage" => ("showMessage", false),
        "window/showMessageRequest" => ("showMessageRequest", true),
        _ => return None,
    };
    let params = value.get("params")?;
    let message = params.get("message").and_then(Value::as_str)?;

    if message.trim().is_empty() {
        return None;
    }

    let severity = language_server_message_type_label(params.get("type").and_then(Value::as_u64));
    Some(ServerWindowMessage {
        chunk: format!("[{server_label} {method_label} {severity}] {message}\n"),
        requires_response,
    })
}

fn language_server_message_type_label(message_type: Option<u64>) -> &'static str {
    match message_type {
        Some(1) => "error",
        Some(2) => "warning",
        Some(3) => "info",
        Some(4) => "log",
        _ => "message",
    }
}

fn respond_to_server_request(
    stdin: &Arc<Mutex<Box<dyn Write + Send>>>,
    value: &Value,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    server_configuration: &Arc<Mutex<Value>>,
    workspace_root: &str,
) -> Result<(), ()> {
    let Some(id) = value.get("id").cloned() else {
        return Err(());
    };
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Err(());
    };

    let configuration = server_configuration
        .lock()
        .map(|configuration| configuration.clone())
        .unwrap_or_else(|_| json!({}));
    let result = server_request_result(
        method,
        value.get("params"),
        workspace_edit_sink,
        refresh_sink,
        session_id,
        &configuration,
        workspace_root,
    );
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

fn server_request_result(
    method: &str,
    params: Option<&Value>,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    server_configuration: &Value,
    workspace_root: &str,
) -> Value {
    match method {
        "workspace/configuration" => workspace_configuration_result(params, server_configuration),
        "workspace/workspaceFolders" => workspace_folders_result(workspace_root),
        "workspace/applyEdit" => {
            workspace_apply_edit_result(params, workspace_edit_sink, session_id, workspace_root)
        }
        "workspace/codeLens/refresh" => {
            let _ = refresh_sink.emit_refresh(LanguageServerRefreshEvent {
                session_id,
                feature: LanguageServerRefreshFeature::CodeLens,
            });
            Value::Null
        }
        "workspace/inlayHint/refresh" => {
            let _ = refresh_sink.emit_refresh(LanguageServerRefreshEvent {
                session_id,
                feature: LanguageServerRefreshFeature::InlayHint,
            });
            Value::Null
        }
        "workspace/semanticTokens/refresh" => {
            let _ = refresh_sink.emit_refresh(LanguageServerRefreshEvent {
                session_id,
                feature: LanguageServerRefreshFeature::SemanticTokens,
            });
            Value::Null
        }
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/showMessageRequest" => Value::Null,
        _ => Value::Null,
    }
}

fn workspace_folders_result(workspace_root: &str) -> Value {
    let root_path = PathBuf::from(workspace_root);
    let name = root_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(workspace_root);

    json!([
        {
            "uri": file_uri(&root_path),
            "name": name,
        }
    ])
}

fn server_configuration_from_initialize_request(initialize_request: &JsonRpcRequest) -> Value {
    let preferences = initialize_request
        .params
        .pointer("/initializationOptions/preferences")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let formatting_options = initialize_request
        .params
        .pointer("/initializationOptions/formattingOptions")
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "insertSpaces": true,
                "tabSize": 2,
            })
        });
    let auto_imports_enabled = preferences
        .get("includeCompletionsForModuleExports")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let inlay_hints_enabled = preferences
        .get("includeInlayFunctionLikeReturnTypeHints")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let parameter_name_hints = preferences
        .get("includeInlayParameterNameHints")
        .and_then(Value::as_str)
        .unwrap_or("literals");
    let code_lens_enabled = preferences
        .get("mockorCodeLensEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let validation_enabled = preferences
        .get("mockorValidationEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let complete_function_calls = preferences
        .get("completeFunctionCalls")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    json!({
        "format": {
            "enable": true,
            "insertSpaceAfterCommaDelimiter": true,
            "insertSpaceAfterConstructor": false,
            "insertSpaceAfterFunctionKeywordForAnonymousFunctions": true,
            "insertSpaceAfterKeywordsInControlFlowStatements": true,
            "insertSpaceAfterOpeningAndBeforeClosingEmptyBraces": true,
            "insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces": false,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces": true,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets": false,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis": false,
            "insertSpaceAfterSemicolonInForStatements": true,
            "insertSpaceBeforeAndAfterBinaryOperators": true,
            "insertSpaceBeforeFunctionParenthesis": false,
            "placeOpenBraceOnNewLineForControlBlocks": false,
            "placeOpenBraceOnNewLineForFunctions": false,
            "semicolons": "ignore",
        },
        "formattingOptions": formatting_options,
        "implicitProjectConfiguration": {
            "checkJs": false,
            "experimentalDecorators": false,
            "module": 99,
            "strict": true,
            "strictFunctionTypes": true,
            "strictNullChecks": true,
            "target": 11,
        },
        "preferences": preferences,
        "updateImportsOnFileMove": {
            "enabled": if auto_imports_enabled { "always" } else { "never" },
        },
        "validate": {
            "enable": validation_enabled,
        },
        "implementationsCodeLens": { "enabled": code_lens_enabled },
        "referencesCodeLens": {
            "enabled": code_lens_enabled,
            "showOnAllFunctions": false,
        },
        "suggest": {
            "autoImports": auto_imports_enabled,
            "completeFunctionCalls": complete_function_calls,
            "includeAutomaticOptionalChainCompletions": true,
            "includeCompletionsForImportStatements": auto_imports_enabled,
            "includeCompletionsForModuleExports": auto_imports_enabled,
        },
        "inlayHints": {
            "enumMemberValues": { "enabled": inlay_hints_enabled },
            "functionLikeReturnTypes": { "enabled": inlay_hints_enabled },
            "parameterNames": {
                "enabled": parameter_name_hints,
                "suppressWhenArgumentMatchesName": false,
            },
            "parameterTypes": { "enabled": inlay_hints_enabled },
            "propertyDeclarationTypes": { "enabled": inlay_hints_enabled },
            "variableTypes": {
                "enabled": inlay_hints_enabled,
                "suppressWhenTypeMatchesName": false,
            },
        },
    })
}

fn workspace_configuration_result(params: Option<&Value>, server_configuration: &Value) -> Value {
    let Some(items) = params
        .and_then(|params| params.get("items"))
        .and_then(Value::as_array)
    else {
        return Value::Array(Vec::new());
    };

    Value::Array(
        items
            .iter()
            .map(|item| configuration_value_for_item(item, server_configuration))
            .collect(),
    )
}

fn configuration_value_for_item(item: &Value, server_configuration: &Value) -> Value {
    let section = item.get("section").and_then(Value::as_str).unwrap_or("");
    let Some(section) = javascript_typescript_configuration_section(section) else {
        return json!({});
    };

    if section.is_empty() {
        return server_configuration.clone();
    }

    server_configuration
        .get(section)
        .cloned()
        .unwrap_or_else(|| json!({}))
}

fn javascript_typescript_configuration_section(section: &str) -> Option<&str> {
    if section == "formattingOptions" {
        return Some("formattingOptions");
    }

    if section == "typescript" || section == "javascript" {
        return Some("");
    }

    section
        .strip_prefix("typescript.")
        .or_else(|| section.strip_prefix("javascript."))
}

fn workspace_apply_edit_result(
    params: Option<&Value>,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    session_id: u64,
    workspace_root: &str,
) -> Value {
    let Some(params) = params else {
        return workspace_apply_edit_failure("Missing workspace edit parameters.");
    };
    let label = params
        .get("label")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let Some(edit_value) = params.get("edit") else {
        return workspace_apply_edit_failure("Missing workspace edit payload.");
    };

    let edit = match parse_workspace_edit_result(edit_value) {
        Ok(Some(edit)) => edit,
        Ok(None) => return workspace_apply_edit_failure("Workspace edit payload was empty."),
        Err(error) => return workspace_apply_edit_failure(&error),
    };
    if let Err(error) = ensure_workspace_edit_paths_in_workspace(workspace_root, &edit) {
        return workspace_apply_edit_failure(&error);
    }

    let applied = workspace_edit_sink.emit_workspace_edit(LanguageServerWorkspaceEditEvent {
        session_id,
        label,
        edit,
    });

    if applied {
        return json!({ "applied": true });
    }

    workspace_apply_edit_failure("Workspace edit could not be delivered to the editor.")
}

fn workspace_apply_edit_failure(reason: &str) -> Value {
    json!({
        "applied": false,
        "failureReason": reason,
    })
}

fn ensure_workspace_edit_paths_in_workspace(
    workspace_root: &str,
    edit: &LanguageServerWorkspaceEdit,
) -> Result<(), String> {
    for uri in edit.changes.keys() {
        ensure_workspace_edit_uri_in_workspace(workspace_root, uri)?;
    }

    for operation in &edit.file_operations {
        for uri in workspace_file_operation_uris(operation) {
            ensure_workspace_edit_uri_in_workspace(workspace_root, uri)?;
        }
    }

    Ok(())
}

fn filter_diagnostic_event_to_workspace(
    workspace_root: &str,
    mut event: LanguageServerDiagnosticEvent,
) -> Option<LanguageServerDiagnosticEvent> {
    if !is_file_uri_in_workspace(workspace_root, &event.uri) {
        return None;
    }

    for diagnostic in &mut event.diagnostics {
        diagnostic.related_information.retain(|related| {
            !related.uri.starts_with("file://")
                || is_file_uri_in_workspace(workspace_root, &related.uri)
        });

        if diagnostic
            .code_description_href
            .as_ref()
            .is_some_and(|href| {
                href.starts_with("file://") && !is_file_uri_in_workspace(workspace_root, href)
            })
        {
            diagnostic.code_description_href = None;
        }

        if diagnostic.data.as_ref().is_some_and(|data| {
            ensure_diagnostic_json_payload_paths_in_workspace(workspace_root, data, false).is_err()
        }) {
            diagnostic.data = None;
        }
    }

    Some(event)
}

fn workspace_file_operation_uris(operation: &LanguageServerWorkspaceFileOperation) -> Vec<&str> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, .. }
        | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => vec![uri.as_str()],
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri, new_uri, ..
        } => vec![old_uri.as_str(), new_uri.as_str()],
    }
}

fn ensure_workspace_edit_uri_in_workspace(workspace_root: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Err("Workspace edit URI must be a file URI.".to_string());
    }

    if is_file_uri_in_workspace(workspace_root, uri) {
        return Ok(());
    }

    Err("Workspace edit path is outside the workspace root.".to_string())
}

fn ensure_diagnostic_json_payload_paths_in_workspace(
    workspace_root: &str,
    value: &Value,
    path_context: bool,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                ensure_diagnostic_json_payload_paths_in_workspace(
                    workspace_root,
                    item,
                    path_context,
                )?;
            }
        }
        Value::Object(fields) => {
            for (key, field_value) in fields {
                ensure_diagnostic_payload_string_in_workspace(workspace_root, key, false)?;
                ensure_diagnostic_json_payload_paths_in_workspace(
                    workspace_root,
                    field_value,
                    path_context || is_lsp_path_payload_key(key),
                )?;
            }
        }
        Value::String(value) => {
            ensure_diagnostic_payload_string_in_workspace(workspace_root, value, path_context)?;
        }
        _ => {}
    }

    Ok(())
}

fn ensure_diagnostic_payload_string_in_workspace(
    workspace_root: &str,
    value: &str,
    path_context: bool,
) -> Result<(), String> {
    if value.starts_with("file://") {
        if is_file_uri_in_workspace(workspace_root, value) {
            return Ok(());
        }

        return Err("Diagnostic payload path is outside the workspace root.".to_string());
    }

    if !path_context || has_non_file_uri_scheme(value) {
        return Ok(());
    }

    let root = workspace_guard_path(workspace_root)?;
    let Some(path) = resolve_existing_or_parent_path(Path::new(value)) else {
        return Err("Diagnostic payload path could not be resolved.".to_string());
    };

    if path.starts_with(root) {
        return Ok(());
    }

    Err("Diagnostic payload path is outside the workspace root.".to_string())
}

fn is_lsp_path_payload_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(char::to_lowercase)
        .collect::<String>();

    normalized == "file"
        || normalized == "target"
        || normalized.ends_with("uri")
        || normalized.ends_with("path")
        || normalized.ends_with("filename")
}

fn has_non_file_uri_scheme(value: &str) -> bool {
    let bytes = value.as_bytes();

    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }

    let Some(first) = bytes.first() else {
        return false;
    };

    if !first.is_ascii_alphabetic() {
        return false;
    }

    for byte in bytes.iter().skip(1) {
        if *byte == b':' {
            return !value.starts_with("file:");
        }

        if !(byte.is_ascii_alphanumeric() || matches!(*byte, b'+' | b'-' | b'.')) {
            return false;
        }
    }

    false
}

fn is_file_uri_in_workspace(workspace_root: &str, uri: &str) -> bool {
    if !uri.starts_with("file://") {
        return false;
    }

    let Some(path) = path_from_file_uri(uri) else {
        return false;
    };
    let Ok(root) = workspace_guard_path(workspace_root) else {
        return false;
    };
    let Some(path) = resolve_existing_or_parent_path(Path::new(&path)) else {
        return false;
    };

    path.starts_with(&root)
}

fn workspace_guard_path(workspace_root: &str) -> Result<PathBuf, String> {
    resolve_existing_or_parent_path(Path::new(workspace_root))
        .ok_or_else(|| "Workspace root could not be resolved.".to_string())
}

fn path_from_file_uri(uri: &str) -> Option<String> {
    let path = uri.strip_prefix("file://")?;
    let path = path.strip_prefix("localhost").unwrap_or(path);
    let path = percent_decode(path)?;

    if path.is_empty() || !path.starts_with('/') {
        return None;
    }

    Some(path)
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }

        let high = *bytes.get(index + 1)?;
        let low = *bytes.get(index + 2)?;
        decoded.push(hex_value(high)? * 16 + hex_value(low)?);
        index += 3;
    }

    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
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
        call_hierarchy: is_capability_enabled(capabilities.get("callHierarchyProvider")),
        code_action: is_capability_enabled(capabilities.get("codeActionProvider")),
        code_action_resolve: capabilities
            .get("codeActionProvider")
            .and_then(|provider| provider.get("resolveProvider"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        code_lens: is_capability_enabled(capabilities.get("codeLensProvider")),
        declaration: is_capability_enabled(capabilities.get("declarationProvider")),
        hover: is_capability_enabled(capabilities.get("hoverProvider")),
        completion: is_capability_enabled(capabilities.get("completionProvider")),
        definition: is_capability_enabled(capabilities.get("definitionProvider")),
        document_highlight: is_capability_enabled(capabilities.get("documentHighlightProvider")),
        document_link: is_capability_enabled(capabilities.get("documentLinkProvider")),
        document_symbol: is_capability_enabled(capabilities.get("documentSymbolProvider")),
        did_create_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("didCreate"))
            .is_some(),
        did_delete_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("didDelete"))
            .is_some(),
        did_rename_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("didRename"))
            .is_some(),
        folding_range: is_capability_enabled(capabilities.get("foldingRangeProvider")),
        formatting: is_capability_enabled(capabilities.get("documentFormattingProvider")),
        implementation: is_capability_enabled(capabilities.get("implementationProvider")),
        inlay_hint: is_capability_enabled(capabilities.get("inlayHintProvider")),
        linked_editing_range: is_capability_enabled(capabilities.get("linkedEditingRangeProvider")),
        on_type_formatting: is_capability_enabled(
            capabilities.get("documentOnTypeFormattingProvider"),
        ),
        on_type_formatting_trigger_characters: parse_on_type_formatting_trigger_characters(
            capabilities.get("documentOnTypeFormattingProvider"),
        ),
        prepare_rename: capabilities
            .get("renameProvider")
            .and_then(|provider| provider.get("prepareProvider"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        range_formatting: is_capability_enabled(
            capabilities.get("documentRangeFormattingProvider"),
        ),
        references: is_capability_enabled(capabilities.get("referencesProvider")),
        rename: is_capability_enabled(capabilities.get("renameProvider")),
        selection_range: is_capability_enabled(capabilities.get("selectionRangeProvider")),
        semantic_tokens: is_capability_enabled(capabilities.get("semanticTokensProvider")),
        semantic_tokens_legend: parse_semantic_tokens_legend(
            capabilities.get("semanticTokensProvider"),
        ),
        signature_help: is_capability_enabled(capabilities.get("signatureHelpProvider")),
        source_definition: execute_command_provider_contains(
            capabilities,
            "_typescript.goToSourceDefinition",
        ),
        type_definition: is_capability_enabled(capabilities.get("typeDefinitionProvider")),
        type_hierarchy: is_capability_enabled(capabilities.get("typeHierarchyProvider")),
        will_create_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("willCreate"))
            .is_some(),
        will_delete_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("willDelete"))
            .is_some(),
        will_rename_files: capabilities
            .get("workspace")
            .and_then(|workspace| workspace.get("fileOperations"))
            .and_then(|file_operations| file_operations.get("willRename"))
            .is_some(),
        workspace_symbol: is_capability_enabled(capabilities.get("workspaceSymbolProvider")),
    })
}

fn parse_semantic_tokens_legend(provider: Option<&Value>) -> Option<SemanticTokensLegend> {
    let legend = provider?.get("legend")?;
    let token_types = parse_string_array(legend.get("tokenTypes")?)?;
    let token_modifiers = parse_string_array(legend.get("tokenModifiers")?)?;

    if token_types.is_empty() {
        return None;
    }

    Some(SemanticTokensLegend {
        token_types,
        token_modifiers,
    })
}

fn parse_on_type_formatting_trigger_characters(provider: Option<&Value>) -> Option<Vec<String>> {
    let provider = provider?.as_object()?;
    let mut trigger_characters = Vec::new();

    if let Some(first_trigger_character) = provider
        .get("firstTriggerCharacter")
        .and_then(Value::as_str)
    {
        trigger_characters.push(first_trigger_character.to_string());
    }

    if let Some(more_trigger_characters) = provider
        .get("moreTriggerCharacter")
        .and_then(Value::as_array)
    {
        trigger_characters.extend(
            more_trigger_characters
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string),
        );
    }

    (!trigger_characters.is_empty()).then_some(trigger_characters)
}

fn execute_command_provider_contains(capabilities: &Value, command: &str) -> bool {
    capabilities
        .get("executeCommandProvider")
        .and_then(|provider| provider.get("commands"))
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands
                .iter()
                .any(|candidate| candidate.as_str() == Some(command))
        })
}

fn parse_string_array(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_string))
        .collect()
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
    #[cfg(unix)]
    use super::ChildKiller;
    use super::{
        cancellable_backoff, parse_capabilities, workspace_runtime_id, ChildServerProcessSpawner,
        DiagnosticsSink, JavaScriptTypeScriptLanguageServerRegistry, LanguageServerCapabilities,
        LanguageServerRefreshEvent, LanguageServerRefreshFeature, LanguageServerRegistry,
        LanguageServerRuntimeStatus, LanguageServerSupervisor, LanguageServerWorkspaceEditEvent,
        NoopRefreshSink, NoopWorkspaceEditSink, PhpLanguageServerRegistry, ProcessKiller,
        RefreshSink, RestartController, RestartDecision, RestartOutcome, RestartPolicy,
        SemanticTokensLegend, ServerProcessSpawner, SpawnedServer, StartKind, StatusSink,
        WorkspaceEditSink,
    };
    use crate::lsp::{file_uri, JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
    use crate::lsp_diagnostics::LanguageServerDiagnosticEvent;
    use crate::lsp_features::LanguageServerWorkspaceEdit;
    use crate::lsp_transport::{read_message, write_message};
    use serde_json::{json, Value};
    use std::fs;
    use std::io::{self, PipeWriter, Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime};

    #[cfg(unix)]
    #[test]
    fn child_server_process_spawner_applies_phpactor_isolation_env() {
        let command = LanguageServerCommand {
            executable: "env".to_string(),
            args: Vec::new(),
            working_directory: "/tmp".to_string(),
            env: vec![
                ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
                (
                    "PHP_INI_SCAN_DIR".to_string(),
                    "/managed/empty-php-conf.d".to_string(),
                ),
            ],
        };

        let spawner = ChildServerProcessSpawner;
        let mut spawned = spawner.spawn(&command).expect("spawn env");
        drop(spawned.stdin);

        let mut stdout = String::new();
        spawned
            .stdout
            .read_to_string(&mut stdout)
            .expect("read env stdout");
        spawned.killer.terminate().expect("terminate env");

        assert!(stdout.contains("PHPRC=/managed/codevo-php.ini\n"));
        assert!(stdout.contains("PHP_INI_SCAN_DIR=/managed/empty-php-conf.d\n"));
    }

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
    fn captures_language_server_stderr_in_runtime_log() {
        let spawner =
            FakeSpawner::new(ready_script(), true).with_stderr(b"tsserver warning\n".to_vec());
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for_log(&supervisor, "tsserver warning");

        let log = supervisor.log();

        assert!(log.contains("TypeScript language server session 1 started"));
        assert!(log.contains("tsserver warning"));
    }

    #[test]
    fn captures_language_server_launch_env_in_runtime_log() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("PHPactor language server");
        let mut command = command();
        command.executable = "/usr/bin/php".to_string();
        command.args = vec![
            "-n".to_string(),
            "-c".to_string(),
            "/managed/codevo-php.ini".to_string(),
            "/managed/vendor/bin/phpactor".to_string(),
            "language-server".to_string(),
        ];
        command.env = vec![
            ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
            (
                "PHP_INI_SCAN_DIR".to_string(),
                "/managed/empty-php-conf.d".to_string(),
            ),
        ];

        supervisor
            .start(
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let log = supervisor.log();

        assert!(log.contains(
            "command: /usr/bin/php -n -c /managed/codevo-php.ini /managed/vendor/bin/phpactor language-server"
        ));
        assert!(log.contains("PHPRC=/managed/codevo-php.ini"));
        assert!(log.contains("PHP_INI_SCAN_DIR=/managed/empty-php-conf.d"));
    }

    #[test]
    fn captures_language_server_window_messages_in_runtime_log() {
        let mut script = framed(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": {
                "type": 2,
                "message": "Using TypeScript 5.4.5 from workspace",
            },
        }));
        script.extend(ready_script());
        let spawner = FakeSpawner::new(script, true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "method": "window/showMessage",
                "params": {
                    "type": 1,
                    "message": "tsconfig.json contains an unsupported option",
                },
            }),
        );

        wait_for_log(
            &supervisor,
            "[TypeScript language server logMessage warning] Using TypeScript 5.4.5 from workspace",
        );
        wait_for_log(
            &supervisor,
            "[TypeScript language server showMessage error] tsconfig.json contains an unsupported option",
        );
    }

    #[test]
    fn captures_language_server_show_message_requests_in_runtime_log_and_responds() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 42,
                "method": "window/showMessageRequest",
                "params": {
                    "type": 3,
                    "message": "Install missing @types/node declarations?",
                    "actions": [{ "title": "Install" }],
                },
            }),
        );

        wait_for_log(
            &supervisor,
            "[TypeScript language server showMessageRequest info] Install missing @types/node declarations?",
        );
        let response = wait_for_captured_response(&capture, 42);

        assert_eq!(response["result"], Value::Null);
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
    fn javascript_typescript_registry_records_launch_context_until_stop() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let command = command();
        let initialize_request = initialize_request();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request,
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let runtime_id = workspace_runtime_id("/tmp/workspace-a");
        let context = registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .get(&runtime_id)
            .cloned()
            .expect("stored launch context");

        assert_eq!(context.root_path, "/tmp/workspace-a");
        assert_eq!(context.command.executable, command.executable);
        assert_eq!(context.command.args, command.args);
        assert_eq!(context.command.working_directory, command.working_directory);
        assert_eq!(context.command.env, command.env);
        assert_eq!(
            context.initialize_request.jsonrpc,
            initialize_request.jsonrpc
        );
        assert_eq!(context.initialize_request.id, initialize_request.id);
        assert_eq!(context.initialize_request.method, initialize_request.method);
        assert_eq!(context.initialize_request.params, initialize_request.params);

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn javascript_typescript_runtime_panel_stop_keeps_runtime_restartable() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        assert_eq!(
            registry.stop_preserving_launch_context("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(registry.pid("/tmp/workspace-a"), None);
        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            1,
            "runtime-panel Stop must keep the last launch command for Restart"
        );

        let restart_spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let status = registry
            .restart_with_auto_restart(
                "/tmp/workspace-a",
                restart_spawner,
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("restart after runtime-panel stop");

        assert!(matches!(
            status,
            LanguageServerRuntimeStatus::Running { .. }
        ));
        registry.stop_all();
    }

    #[test]
    fn javascript_typescript_registry_stop_all_drains_launch_contexts() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
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
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            2
        );
        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn php_registry_records_launch_context_until_stop() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let mut command = command();
        command.executable = "/usr/bin/php".to_string();
        command.args = vec![
            "-n".to_string(),
            "-c".to_string(),
            "/managed/codevo-php.ini".to_string(),
            "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
                .to_string(),
            "language-server".to_string(),
        ];
        command.env = vec![
            ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
            (
                "PHP_INI_SCAN_DIR".to_string(),
                "/managed/empty-php-conf.d".to_string(),
            ),
        ];

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let runtime_id = workspace_runtime_id("/tmp/workspace-a");
        let context = registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .get(&runtime_id)
            .cloned()
            .expect("stored launch context");

        assert_eq!(context.root_path, "/tmp/workspace-a");
        assert_eq!(context.command.executable, command.executable);
        assert_eq!(context.command.args, command.args);
        assert_eq!(context.command.working_directory, command.working_directory);
        assert_eq!(context.command.env, command.env);

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn php_runtime_panel_stop_keeps_runtime_restartable() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let command = phpactor_managed_command();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        assert_eq!(
            registry.stop_preserving_launch_context("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(registry.pid("/tmp/workspace-a"), None);
        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            1,
            "runtime-panel Stop must keep the last launch command for Restart"
        );

        let restart_spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let status = registry
            .restart_with_auto_restart(
                "/tmp/workspace-a",
                restart_spawner,
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("restart after runtime-panel stop");

        assert!(matches!(
            status,
            LanguageServerRuntimeStatus::Running { .. }
        ));
        registry.stop_all();
    }

    #[test]
    fn php_registry_stop_all_drains_launch_contexts() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();
        let command = phpactor_managed_command();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command,
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            2
        );
        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn registry_drop_stops_all_workspace_sessions() {
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        {
            let registry = LanguageServerRegistry::new_with_label("Test server");

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
            assert!(held_a.lock().expect("workspace a writer").is_some());
            assert!(held_b.lock().expect("workspace b writer").is_some());
        }

        assert!(held_a.lock().expect("workspace a writer").is_none());
        assert!(held_b.lock().expect("workspace b writer").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn registry_stop_resolves_missing_symlink_alias_root() {
        use std::os::unix::fs::symlink;

        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let parent = temp_workspace("lsp-stop-alias-parent");
        let root = parent.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");
        let root = root.canonicalize().expect("canonical workspace root");
        let alias_parent = temp_path("lsp-stop-alias-link");
        symlink(&parent, &alias_parent).expect("workspace parent symlink");
        let alias_root = alias_parent.join("workspace");

        registry
            .start(
                &path_string(&root),
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");
        fs::remove_dir_all(&root).expect("remove workspace root");

        assert!(matches!(
            registry.status(&path_string(&alias_root)),
            LanguageServerRuntimeStatus::Running { .. }
        ));
        assert_eq!(
            registry.stop(&path_string(&alias_root)),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry.running_roots().is_empty());
    }

    #[test]
    fn registry_routes_notifications_to_the_requested_workspace_only() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
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

        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                    }),
                },
            )
            .expect("send workspace b notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/didSave"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "textDocument/didSave"
                && message["params"]["textDocument"]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
    }

    #[test]
    fn registry_start_with_auto_restart_recovers_crashed_workspace() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();

        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-workspace",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start with auto restart");
        wait_for(&rx, &running_status());

        // Simulate an unexpected crash for this workspace's server.
        *held.lock().expect("held writer lock") = None;

        // The registry start path must re-spawn the *same* workspace's server and
        // return it to running. A plain start path (no auto-restart) would leave
        // the session permanently Crashed.
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
    }

    #[test]
    fn registry_auto_restart_is_isolated_per_workspace() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = Arc::new(FakeSpawner::new(ready_script(), true));
        let spawner_b = Arc::new(FakeSpawner::new(ready_script(), true));
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, rx_a) = ChannelSink::new();
        let (sink_b, rx_b) = ChannelSink::new();

        // Each workspace gets its OWN restart controller -> per-workspace
        // isolation, no shared restart budget across open project tabs.
        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-a",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner_a) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink_a,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start workspace a");
        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-b",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner_b) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink_b,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start workspace b");
        wait_for(&rx_a, &running_status());
        wait_for(&rx_b, &running_status());

        // Crash only workspace A's server. Its supervisor must auto-restart it.
        *held_a.lock().expect("held writer a lock") = None;
        wait_for(
            &rx_a,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        // Workspace B is completely unaffected by A's crash/restart: it stays on
        // its original session and never receives a spurious status event.
        assert!(held_b.lock().expect("held writer b lock").is_some());
        assert_eq!(
            registry.status("/tmp/auto-restart-b"),
            LanguageServerRuntimeStatus::Running {
                session_id: 1,
                capabilities: LanguageServerCapabilities::default(),
            }
        );
    }

    #[test]
    fn registry_routes_watched_file_changes_to_the_requested_workspace_only() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "workspace/didChangeWatchedFiles".to_string(),
                    params: json!({
                        "changes": [
                            {
                                "uri": "file:///tmp/workspace-b/src/App.ts",
                                "type": 2,
                            },
                        ],
                    }),
                },
            )
            .expect("send workspace b file-change notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "workspace/didChangeWatchedFiles"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "workspace/didChangeWatchedFiles"
                && message["params"]["changes"][0]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
    }

    #[test]
    fn registry_routes_requests_to_the_requested_workspace_only() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_b = Arc::clone(&spawner_b.held_writer);
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

        let request_registry = Arc::clone(&registry);
        let request = std::thread::spawn(move || {
            request_registry
                .send_request(
                    "/tmp/workspace-b",
                    "textDocument/hover",
                    json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                        "position": { "line": 1, "character": 4 },
                    }),
                )
                .expect("send workspace b request")
                .expect("workspace b request result")
        });
        let request_id = wait_for_captured_request_id(&capture_b, "textDocument/hover");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/hover"));

        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": { "contents": "workspace b hover" },
            }),
        );

        let result = request.join().expect("request thread");

        assert_eq!(result["contents"], "workspace b hover");
    }

    #[test]
    fn send_request_async_routes_to_requested_workspace_off_thread() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_b = Arc::clone(&spawner_b.held_writer);
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

        let request_registry = Arc::clone(&registry);
        let request_future = request_registry.send_request_async(
            "/tmp/workspace-b",
            "textDocument/hover",
            json!({
                "textDocument": {
                    "uri": "file:///tmp/workspace-b/src/App.ts",
                },
                "position": { "line": 1, "character": 4 },
            }),
        );
        let request = tauri::async_runtime::spawn(async move {
            request_future
                .await
                .expect("send workspace b request")
                .expect("workspace b request result")
        });
        let request_id = wait_for_captured_request_id(&capture_b, "textDocument/hover");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/hover"));

        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": { "contents": "workspace b hover" },
            }),
        );

        let result = tauri::async_runtime::block_on(request).expect("request join");

        assert_eq!(result["contents"], "workspace b hover");
    }

    #[test]
    fn send_request_async_handles_concurrent_in_flight_requests() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace",
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let first_future = registry.send_request_async(
            "/tmp/workspace",
            "textDocument/hover",
            json!({ "marker": "first" }),
        );
        let first = tauri::async_runtime::spawn(async move {
            first_future
                .await
                .expect("first send")
                .expect("first result")
        });
        let second_future = registry.send_request_async(
            "/tmp/workspace",
            "textDocument/definition",
            json!({ "marker": "second" }),
        );
        let second = tauri::async_runtime::spawn(async move {
            second_future
                .await
                .expect("second send")
                .expect("second result")
        });

        let first_id = wait_for_captured_request_id(&capture, "textDocument/hover");
        let second_id = wait_for_captured_request_id(&capture, "textDocument/definition");
        assert_ne!(first_id, second_id);

        // Respond out of order to prove each in-flight request resolves on its
        // own pending channel.
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": second_id,
                "result": { "answer": "second" },
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": first_id,
                "result": { "answer": "first" },
            }),
        );

        let first_result = tauri::async_runtime::block_on(first).expect("first join");
        let second_result = tauri::async_runtime::block_on(second).expect("second join");

        assert_eq!(first_result["answer"], "first");
        assert_eq!(second_result["answer"], "second");
    }

    #[test]
    fn registry_keeps_server_configuration_and_workspace_folders_isolated() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        registry
            .update_server_configuration(
                "/tmp/workspace-b",
                json!({
                    "suggest": {
                        "autoImports": false,
                        "completeFunctionCalls": true,
                    },
                    "validate": {
                        "enable": false,
                    },
                }),
            )
            .expect("update workspace b configuration");

        write_held_message(
            &held_a,
            json!({
                "jsonrpc": "2.0",
                "id": 51,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "typescript.validate" }
                    ]
                }
            }),
        );
        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": 52,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "typescript.validate" }
                    ]
                }
            }),
        );

        let response_a = wait_for_captured_response(&capture_a, 51);
        let response_b = wait_for_captured_response(&capture_b, 52);

        assert_eq!(response_a["result"][0]["autoImports"], true);
        assert_eq!(response_a["result"][0]["completeFunctionCalls"], false);
        assert_eq!(response_a["result"][1]["enable"], true);
        assert_eq!(response_b["result"][0]["autoImports"], false);
        assert_eq!(response_b["result"][0]["completeFunctionCalls"], true);
        assert_eq!(response_b["result"][1]["enable"], false);

        write_held_message(
            &held_a,
            json!({
                "jsonrpc": "2.0",
                "id": 61,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );
        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": 62,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );

        let folders_a = wait_for_captured_response(&capture_a, 61);
        let folders_b = wait_for_captured_response(&capture_b, 62);

        assert_eq!(folders_a["result"][0]["uri"], "file:///tmp/workspace-a");
        assert_eq!(folders_a["result"][0]["name"], "workspace-a");
        assert_eq!(folders_b["result"][0]["uri"], "file:///tmp/workspace-b");
        assert_eq!(folders_b["result"][0]["name"], "workspace-b");
    }

    #[test]
    fn registry_stop_releases_requested_workspace_without_stopping_other_workspace() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert!(held_a.lock().expect("workspace a writer").is_some());
        assert!(held_b.lock().expect("workspace b writer").is_some());

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );

        assert!(held_a.lock().expect("workspace a writer").is_none());
        assert!(held_b.lock().expect("workspace b writer").is_some());
        assert!(matches!(
            registry.status("/tmp/workspace-b"),
            LanguageServerRuntimeStatus::Running { .. }
        ));

        registry
            .send_notification(
                "/tmp/workspace-a",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-a/src/App.ts",
                        },
                    }),
                },
            )
            .expect("stopped workspace notification is ignored");
        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                    }),
                },
            )
            .expect("send workspace b notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/didSave"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "textDocument/didSave"
                && message["params"]["textDocument"]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
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
                    call_hierarchy: false,
                    code_action: false,
                    code_action_resolve: false,
                    code_lens: false,
                    declaration: true,
                    hover: true,
                    completion: true,
                    definition: true,
                    document_highlight: false,
                    document_link: false,
                    document_symbol: false,
                    did_create_files: false,
                    did_delete_files: false,
                    did_rename_files: false,
                    folding_range: false,
                    formatting: false,
                    implementation: true,
                    inlay_hint: false,
                    linked_editing_range: false,
                    on_type_formatting: false,
                    on_type_formatting_trigger_characters: None,
                    prepare_rename: false,
                    range_formatting: false,
                    references: false,
                    rename: false,
                    selection_range: false,
                    semantic_tokens: false,
                    semantic_tokens_legend: None,
                    signature_help: false,
                    source_definition: false,
                    type_definition: false,
                    type_hierarchy: false,
                    will_create_files: false,
                    will_delete_files: false,
                    will_rename_files: false,
                    workspace_symbol: false,
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
                call_hierarchy: true,
                code_action: true,
                code_action_resolve: false,
                code_lens: true,
                declaration: true,
                hover: true,
                completion: false,
                definition: true,
                document_highlight: true,
                document_link: true,
                document_symbol: true,
                did_create_files: true,
                did_delete_files: true,
                did_rename_files: true,
                folding_range: true,
                formatting: true,
                implementation: false,
                inlay_hint: true,
                linked_editing_range: true,
                on_type_formatting: true,
                on_type_formatting_trigger_characters: Some(vec![
                    "}".to_string(),
                    ";".to_string(),
                    "\n".to_string(),
                ]),
                prepare_rename: true,
                range_formatting: true,
                references: true,
                rename: true,
                selection_range: true,
                semantic_tokens: true,
                semantic_tokens_legend: Some(SemanticTokensLegend {
                    token_types: vec!["decorator".to_string(), "enumMember".to_string()],
                    token_modifiers: vec!["static".to_string(), "async".to_string()],
                }),
                signature_help: true,
                source_definition: true,
                type_definition: true,
                type_hierarchy: true,
                will_create_files: true,
                will_delete_files: true,
                will_rename_files: true,
                workspace_symbol: true,
            },
        };

        assert_eq!(
            serde_json::to_value(status).expect("serialize status"),
            json!({
                "kind": "running",
                "sessionId": 1,
                "capabilities": {
                    "callHierarchy": true,
                    "declaration": true,
                    "hover": true,
                    "completion": false,
                    "definition": true,
                    "documentHighlight": true,
                    "documentLink": true,
                    "documentSymbol": true,
                    "didCreateFiles": true,
                    "didDeleteFiles": true,
                    "didRenameFiles": true,
                    "foldingRange": true,
                    "formatting": true,
                    "implementation": false,
                    "inlayHint": true,
                    "linkedEditingRange": true,
                    "onTypeFormatting": true,
                    "onTypeFormattingTriggerCharacters": ["}", ";", "\n"],
                    "prepareRename": true,
                    "rangeFormatting": true,
                    "references": true,
                    "rename": true,
                    "selectionRange": true,
                    "semanticTokens": true,
                    "semanticTokensLegend": {
                        "tokenTypes": ["decorator", "enumMember"],
                        "tokenModifiers": ["static", "async"],
                    },
                    "signatureHelp": true,
                    "sourceDefinition": true,
                    "typeDefinition": true,
                    "typeHierarchy": true,
                    "willCreateFiles": true,
                    "willDeleteFiles": true,
                    "willRenameFiles": true,
                    "workspaceSymbol": true,
                    "codeAction": true,
                    "codeActionResolve": false,
                    "codeLens": true,
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
    fn event_payloads_include_workspace_root() {
        assert_eq!(
            super::language_server_status_payload(
                "/tmp/workspace-a",
                LanguageServerRuntimeStatus::Starting { session_id: 8 },
            ),
            json!({
                "kind": "starting",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 8,
            }),
        );
        assert_eq!(
            super::status_event_payload("/tmp/workspace-a", LanguageServerRuntimeStatus::Stopped),
            json!({
                "kind": "stopped",
                "rootPath": "/tmp/workspace-a",
            }),
        );
        assert_eq!(
            super::diagnostics_event_payload(
                "/tmp/workspace-a",
                LanguageServerDiagnosticEvent {
                    diagnostics: Vec::new(),
                    session_id: 7,
                    uri: file_uri(Path::new("/tmp/workspace-a/src/App.php")),
                    version: Some(3),
                },
            ),
            json!({
                "diagnostics": [],
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
                "uri": file_uri(Path::new("/tmp/workspace-a/src/App.php")),
                "version": 3,
            }),
        );
        assert_eq!(
            super::refresh_event_payload(
                "/tmp/workspace-a",
                LanguageServerRefreshEvent {
                    feature: LanguageServerRefreshFeature::CodeLens,
                    session_id: 7,
                },
            ),
            json!({
                "feature": "codeLens",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
            }),
        );
        assert_eq!(
            super::workspace_edit_event_payload(
                "/tmp/workspace-a",
                LanguageServerWorkspaceEditEvent {
                    edit: LanguageServerWorkspaceEdit {
                        changes: Default::default(),
                        document_versions: Default::default(),
                        file_operations: Vec::new(),
                    },
                    label: Some("Apply edit".to_string()),
                    session_id: 7,
                },
            ),
            json!({
                "edit": {
                    "changes": {},
                },
                "label": "Apply edit",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
            }),
        );
    }

    #[test]
    fn capability_values_are_normalized() {
        let capabilities = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "hoverProvider": false,
                    "completionProvider": null,
                    "declarationProvider": true,
                    "definitionProvider": {},
                    "documentHighlightProvider": true,
                    "documentLinkProvider": { "resolveProvider": true },
                    "documentSymbolProvider": true,
                    "foldingRangeProvider": true,
                    "callHierarchyProvider": true,
                    "implementationProvider": true,
                    "inlayHintProvider": true,
                    "linkedEditingRangeProvider": true,
                    "documentOnTypeFormattingProvider": {
                        "firstTriggerCharacter": "}",
                        "moreTriggerCharacter": [";", "\n"]
                    },
                    "referencesProvider": true,
                    "renameProvider": { "prepareProvider": true },
                    "selectionRangeProvider": true,
                    "semanticTokensProvider": {
                        "full": true,
                        "legend": {
                            "tokenModifiers": ["readonly"],
                            "tokenTypes": ["class"]
                        }
                    },
                    "signatureHelpProvider": { "triggerCharacters": ["(", ","] },
                    "executeCommandProvider": {
                        "commands": [
                            "_typescript.organizeImports",
                            "_typescript.goToSourceDefinition"
                        ]
                    },
                    "typeDefinitionProvider": true,
                    "typeHierarchyProvider": true,
                    "codeLensProvider": {},
                    "workspaceSymbolProvider": true,
                    "codeActionProvider": {
                        "codeActionKinds": ["quickfix"],
                        "resolveProvider": true
                    },
                    "documentFormattingProvider": true,
                    "documentRangeFormattingProvider": true,
                    "workspace": {
                        "fileOperations": {
                            "didCreate": { "filters": [] },
                            "didDelete": { "filters": [] },
                            "didRename": { "filters": [] },
                            "willCreate": { "filters": [] },
                            "willDelete": { "filters": [] },
                            "willRename": { "filters": [] }
                        }
                    },
                }
            }
        }))
        .expect("capabilities");

        assert_eq!(
            capabilities,
            LanguageServerCapabilities {
                call_hierarchy: true,
                code_action: true,
                code_action_resolve: true,
                code_lens: true,
                declaration: true,
                hover: false,
                completion: false,
                definition: true,
                document_highlight: true,
                document_link: true,
                document_symbol: true,
                did_create_files: true,
                did_delete_files: true,
                did_rename_files: true,
                folding_range: true,
                formatting: true,
                implementation: true,
                inlay_hint: true,
                linked_editing_range: true,
                on_type_formatting: true,
                on_type_formatting_trigger_characters: Some(vec![
                    "}".to_string(),
                    ";".to_string(),
                    "\n".to_string(),
                ]),
                prepare_rename: true,
                range_formatting: true,
                references: true,
                rename: true,
                selection_range: true,
                semantic_tokens: true,
                semantic_tokens_legend: Some(SemanticTokensLegend {
                    token_types: vec!["class".to_string()],
                    token_modifiers: vec!["readonly".to_string()],
                }),
                signature_help: true,
                source_definition: true,
                type_definition: true,
                type_hierarchy: true,
                will_create_files: true,
                will_delete_files: true,
                will_rename_files: true,
                workspace_symbol: true,
            }
        );
    }

    #[test]
    fn code_action_resolve_capability_reflects_resolve_provider_flag() {
        let resolve_true = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "codeActionProvider": { "resolveProvider": true }
                }
            }
        }))
        .expect("capabilities");
        assert!(resolve_true.code_action);
        assert!(resolve_true.code_action_resolve);

        let resolve_false = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "codeActionProvider": { "resolveProvider": false }
                }
            }
        }))
        .expect("capabilities");
        assert!(resolve_false.code_action);
        assert!(!resolve_false.code_action_resolve);

        let resolve_absent = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "codeActionProvider": { "codeActionKinds": ["quickfix"] }
                }
            }
        }))
        .expect("capabilities");
        assert!(resolve_absent.code_action);
        assert!(!resolve_absent.code_action_resolve);

        let code_action_bool = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "codeActionProvider": true
                }
            }
        }))
        .expect("capabilities");
        assert!(code_action_bool.code_action);
        assert!(!code_action_bool.code_action_resolve);
    }

    #[test]
    fn on_type_formatting_trigger_characters_are_preserved_when_well_formed() {
        let capabilities = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "documentOnTypeFormattingProvider": {
                        "firstTriggerCharacter": "}",
                        "moreTriggerCharacter": [false, ";", 12, "\n", ","]
                    }
                }
            }
        }))
        .expect("capabilities");

        assert!(capabilities.on_type_formatting);
        assert_eq!(
            capabilities.on_type_formatting_trigger_characters,
            Some(vec![
                "}".to_string(),
                ";".to_string(),
                "\n".to_string(),
                ",".to_string(),
            ])
        );
        assert_eq!(
            serde_json::to_value(capabilities).expect("serialize capabilities")
                ["onTypeFormattingTriggerCharacters"],
            json!(["}", ";", "\n", ","])
        );
    }

    #[test]
    fn on_type_formatting_trigger_characters_are_omitted_when_malformed() {
        for provider in [
            json!(true),
            json!({}),
            json!({
                "firstTriggerCharacter": false,
                "moreTriggerCharacter": [false, null, 12]
            }),
            json!({
                "firstTriggerCharacter": false,
                "moreTriggerCharacter": false
            }),
        ] {
            let capabilities = parse_capabilities(&json!({
                "result": {
                    "capabilities": {
                        "documentOnTypeFormattingProvider": provider
                    }
                }
            }))
            .expect("capabilities");

            assert!(capabilities.on_type_formatting);
            assert_eq!(capabilities.on_type_formatting_trigger_characters, None);
            assert!(serde_json::to_value(capabilities)
                .expect("serialize capabilities")
                .get("onTypeFormattingTriggerCharacters")
                .is_none());
        }
    }

    #[test]
    fn semantic_token_legend_is_preserved_from_initialize_capabilities() {
        let capabilities = parse_capabilities(&json!({
            "result": {
                "capabilities": {
                    "semanticTokensProvider": {
                        "full": true,
                        "legend": {
                            "tokenTypes": ["component", "hook"],
                            "tokenModifiers": ["exported", "reactive"]
                        }
                    }
                }
            }
        }))
        .expect("capabilities");

        assert!(capabilities.semantic_tokens);
        assert_eq!(
            capabilities.semantic_tokens_legend,
            Some(SemanticTokensLegend {
                token_types: vec!["component".to_string(), "hook".to_string()],
                token_modifiers: vec!["exported".to_string(), "reactive".to_string()],
            })
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
        let root = test_workspace_root("diagnostics-inside-root");
        let source_path = root.join("src/User.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
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
                    "uri": file_uri(&source_path),
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
        assert_eq!(event.uri, file_uri(&source_path));
        assert_eq!(event.diagnostics[0].message, "Possible issue");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn publish_diagnostics_filters_related_information_and_data_outside_session_root() {
        let root = test_workspace_root("diagnostics-related-root");
        let outside = test_workspace_root("diagnostics-related-outside");
        let source_path = root.join("src/User.ts");
        let inside_related_path = root.join("src/Related.ts");
        let outside_related_path = outside.join("src/Secret.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        fs::create_dir_all(inside_related_path.parent().expect("inside related parent"))
            .expect("inside related parent");
        fs::create_dir_all(
            outside_related_path
                .parent()
                .expect("outside related parent"),
        )
        .expect("outside related parent");
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
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
                    "uri": file_uri(&source_path),
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 1, "character": 2 },
                                "end": { "line": 1, "character": 3 }
                            },
                            "severity": 2,
                            "source": "tsserver",
                            "message": "Issue with unsafe metadata",
                            "codeDescription": {
                                "href": file_uri(&outside.join("docs/unsafe.html"))
                            },
                            "data": {
                                "uri": file_uri(&outside.join("src/FixTarget.ts"))
                            },
                            "relatedInformation": [
                                {
                                    "location": {
                                        "uri": file_uri(&inside_related_path),
                                        "range": {
                                            "start": { "line": 2, "character": 4 },
                                            "end": { "line": 2, "character": 8 }
                                        }
                                    },
                                    "message": "Inside related info"
                                },
                                {
                                    "location": {
                                        "uri": file_uri(&outside_related_path),
                                        "range": {
                                            "start": { "line": 3, "character": 5 },
                                            "end": { "line": 3, "character": 9 }
                                        }
                                    },
                                    "message": "Outside related info"
                                }
                            ]
                        },
                        {
                            "range": {
                                "start": { "line": 5, "character": 2 },
                                "end": { "line": 5, "character": 3 }
                            },
                            "severity": 3,
                            "source": "tsserver",
                            "message": "Issue with safe metadata",
                            "codeDescription": {
                                "href": "https://typescript.example/docs/safe"
                            },
                            "data": {
                                "file": path_string(&root.join("src/SafeFix.ts"))
                            }
                        }
                    ]
                }
            })))
            .expect("write diagnostics");
        drop(held);

        let event = diagnostics_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("diagnostic event");

        assert_eq!(event.uri, file_uri(&source_path));
        assert_eq!(event.diagnostics.len(), 2);
        assert_eq!(event.diagnostics[0].code_description_href, None);
        assert_eq!(event.diagnostics[0].data, None);
        assert_eq!(event.diagnostics[0].related_information.len(), 1);
        assert_eq!(
            event.diagnostics[0].related_information[0].uri,
            file_uri(&inside_related_path)
        );
        assert_eq!(
            event.diagnostics[1].code_description_href.as_deref(),
            Some("https://typescript.example/docs/safe")
        );
        assert_eq!(
            event.diagnostics[1]
                .data
                .as_ref()
                .and_then(|data| data.get("file")),
            Some(&json!(path_string(&root.join("src/SafeFix.ts"))))
        );
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn publish_diagnostics_ignores_file_uris_outside_session_root() {
        let root = test_workspace_root("diagnostics-root");
        let outside = test_workspace_root("diagnostics-outside");
        let sibling = root
            .parent()
            .expect("workspace parent")
            .join(format!("{}-sibling", unique_suffix()));
        fs::create_dir_all(&sibling).expect("sibling root");
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        for uri in [
            file_uri(&outside.join("src/Secret.ts")),
            file_uri(&sibling.join("src/Neighbor.ts")),
        ] {
            writer
                .write_all(&framed(json!({
                    "jsonrpc": "2.0",
                    "method": "textDocument/publishDiagnostics",
                    "params": {
                        "uri": uri,
                        "diagnostics": [
                            {
                                "range": {
                                    "start": { "line": 1, "character": 2 },
                                    "end": { "line": 1, "character": 3 }
                                },
                                "severity": 2,
                                "source": "tsserver",
                                "message": "Outside issue"
                            }
                        ]
                    }
                })))
                .expect("write diagnostics");
        }
        drop(held);

        assert!(diagnostics_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
        fs::remove_dir_all(sibling).expect("cleanup sibling");
    }

    #[test]
    fn stop_ignores_buffered_diagnostics_from_stale_session() {
        let root = test_workspace_root("stop-buffered-diagnostics-root");
        let source_path = root.join("src/User.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": file_uri(&source_path),
                "diagnostics": [
                    {
                        "range": {
                            "start": { "line": 1, "character": 2 },
                            "end": { "line": 1, "character": 3 }
                        },
                        "severity": 2,
                        "source": "tsserver",
                        "message": "Stale issue"
                    }
                ]
            }
        })));
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(diagnostics_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        fs::remove_dir_all(root).expect("cleanup root");
    }

    #[test]
    fn stop_ignores_buffered_window_messages_from_stale_session() {
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": {
                "type": 3,
                "message": "stale message after stop"
            }
        })));
        let (sink, status_rx) = ChannelSink::new();
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
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(!supervisor.log().contains("stale message after stop"));
    }

    #[test]
    fn workspace_apply_edit_requests_emit_workspace_edit_and_acknowledge_success() {
        let root = test_workspace_root("apply-edit-success");
        let changed_uri = file_uri(&root.join("User.ts"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
                workspace_edit_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 42,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Organize imports",
                    "edit": {
                        "changes": {
                            changed_uri.clone(): [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 4 }
                                    },
                                    "newText": "type"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let event = workspace_edit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("workspace edit event");

        assert_eq!(event.session_id, 1);
        assert_eq!(event.label.as_deref(), Some("Organize imports"));
        assert_eq!(
            event.edit.changes.get(&changed_uri).expect("changed file")[0].new_text,
            "type"
        );

        let response = wait_for_captured_response(&capture, 42);
        assert_eq!(response["result"]["applied"], true);
    }

    #[test]
    fn workspace_refresh_requests_emit_refresh_events_and_acknowledge() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (refresh_sink, refresh_rx) = ChannelRefreshSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_event_sinks(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                refresh_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 46,
                "method": "workspace/codeLens/refresh",
                "params": null
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 47,
                "method": "workspace/inlayHint/refresh",
                "params": null
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 48,
                "method": "workspace/semanticTokens/refresh",
                "params": null
            }),
        );

        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("code lens refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::CodeLens,
            }
        );
        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("inlay hint refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::InlayHint,
            }
        );
        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("semantic tokens refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::SemanticTokens,
            }
        );
        assert_eq!(
            wait_for_captured_response(&capture, 46)["result"],
            Value::Null
        );
        assert_eq!(
            wait_for_captured_response(&capture, 47)["result"],
            Value::Null
        );
        assert_eq!(
            wait_for_captured_response(&capture, 48)["result"],
            Value::Null
        );
    }

    #[test]
    fn workspace_apply_edit_requests_reject_paths_outside_workspace() {
        let root = test_workspace_root("apply-edit-root");
        let outside_root = test_workspace_root("apply-edit-outside");
        let outside_uri = file_uri(&outside_root.join("Secret.ts"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
                workspace_edit_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 43,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Move secret",
                    "edit": {
                        "changes": {
                            outside_uri: [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 0 }
                                    },
                                    "newText": "secret"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 43);
        assert_eq!(response["result"]["applied"], false);
        assert!(response["result"]["failureReason"]
            .as_str()
            .expect("failure reason")
            .contains("outside the workspace root"));
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(200))
            .is_err());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 44,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Virtual edit",
                    "edit": {
                        "changes": {
                            "untitled:Scratch.ts": [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 0 }
                                    },
                                    "newText": "virtual"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 44);
        assert_eq!(response["result"]["applied"], false);
        assert!(response["result"]["failureReason"]
            .as_str()
            .expect("failure reason")
            .contains("file URI"));
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(200))
            .is_err());
    }

    #[test]
    fn stop_ignores_buffered_workspace_apply_edit_from_stale_session() {
        let root = test_workspace_root("stop-buffered-apply-edit-root");
        let changed_uri = file_uri(&root.join("User.ts"));
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "id": 91,
            "method": "workspace/applyEdit",
            "params": {
                "label": "Stale organize imports",
                "edit": {
                    "changes": {
                        changed_uri.clone(): [
                            {
                                "range": {
                                    "start": { "line": 0, "character": 0 },
                                    "end": { "line": 0, "character": 4 }
                                },
                                "newText": "type"
                            }
                        ]
                    }
                }
            }
        })));
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
                workspace_edit_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        assert!(!captured_messages(&capture)
            .iter()
            .any(|message| message.get("id").and_then(Value::as_u64) == Some(91)));
        fs::remove_dir_all(root).expect("cleanup root");
    }

    #[test]
    fn workspace_configuration_requests_return_typescript_settings() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();
        let initialize_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({
                "initializationOptions": {
                    "formattingOptions": {
                        "insertSpaces": false,
                        "tabSize": 8
                    },
                    "preferences": {
                        "includeCompletionsForModuleExports": false,
                        "includeInlayFunctionLikeReturnTypeHints": false,
                        "includeInlayParameterNameHints": "none",
                        "importModuleSpecifierEnding": "minimal",
                        "importModuleSpecifierPreference": "project-relative",
                        "mockorCodeLensEnabled": true,
                        "mockorValidationEnabled": false,
                        "preferTypeOnlyAutoImports": true,
                        "quotePreference": "single"
                    }
                }
            }),
        };

        supervisor
            .start(
                &command(),
                &initialize_request,
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 43,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.preferences" },
                        { "section": "javascript.suggest" },
                        { "section": "typescript.inlayHints" },
                        { "section": "typescript.referencesCodeLens" },
                        { "section": "typescript.implementationsCodeLens" },
                        { "section": "typescript.validate" },
                        { "section": "typescript.format" },
                        { "section": "javascript.format" },
                        { "section": "typescript.updateImportsOnFileMove" },
                        { "section": "formattingOptions" },
                        { "section": "typescript.implicitProjectConfiguration" },
                        { "section": "editor" }
                    ]
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 43);

        assert_eq!(
            response["result"][0]["includeCompletionsForModuleExports"],
            false
        );
        assert_eq!(
            response["result"][0]["importModuleSpecifierEnding"],
            "minimal"
        );
        assert_eq!(
            response["result"][0]["importModuleSpecifierPreference"],
            "project-relative"
        );
        assert_eq!(response["result"][0]["preferTypeOnlyAutoImports"], true);
        assert_eq!(response["result"][0]["quotePreference"], "single");
        assert_eq!(response["result"][1]["autoImports"], false);
        assert_eq!(response["result"][1]["completeFunctionCalls"], false);
        assert_eq!(response["result"][2]["parameterNames"]["enabled"], "none");
        assert_eq!(response["result"][3]["enabled"], true);
        assert_eq!(response["result"][3]["showOnAllFunctions"], false);
        assert_eq!(response["result"][4]["enabled"], true);
        assert_eq!(response["result"][5]["enable"], false);
        assert_eq!(response["result"][6]["enable"], true);
        assert_eq!(
            response["result"][6]["insertSpaceAfterCommaDelimiter"],
            true
        );
        assert_eq!(response["result"][7]["semicolons"], "ignore");
        assert_eq!(response["result"][8]["enabled"], "never");
        assert_eq!(response["result"][9]["tabSize"], 8);
        assert_eq!(response["result"][9]["insertSpaces"], false);
        assert_eq!(response["result"][10]["strict"], true);
        assert_eq!(response["result"][10]["module"], 99);
        assert_eq!(response["result"][10]["target"], 11);
        assert_eq!(response["result"][11], json!({}));
    }

    #[test]
    fn workspace_configuration_requests_use_updated_session_settings() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
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
        wait_for(&status_rx, &running_status());

        supervisor
            .update_server_configuration(json!({
                "suggest": {
                    "autoImports": false,
                    "completeFunctionCalls": true,
                },
                "preferences": {
                    "includeCompletionsForModuleExports": false,
                    "importModuleSpecifierEnding": "js",
                    "importModuleSpecifierPreference": "relative",
                    "mockorCodeLensEnabled": true,
                    "preferTypeOnlyAutoImports": true,
                    "quotePreference": "double",
                },
                "formattingOptions": {
                    "insertSpaces": false,
                    "tabSize": 8,
                },
                "referencesCodeLens": {
                    "enabled": true,
                    "showOnAllFunctions": false,
                },
                "updateImportsOnFileMove": {
                    "enabled": "never",
                },
                "validate": {
                    "enable": false,
                },
            }))
            .expect("update configuration");

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 45,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "javascript.preferences" },
                        { "section": "typescript.referencesCodeLens" },
                        { "section": "javascript.validate" },
                        { "section": "javascript.updateImportsOnFileMove" },
                        { "section": "formattingOptions" }
                    ]
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 45);

        assert_eq!(response["result"][0]["autoImports"], false);
        assert_eq!(response["result"][0]["completeFunctionCalls"], true);
        assert_eq!(
            response["result"][1]["includeCompletionsForModuleExports"],
            false
        );
        assert_eq!(response["result"][1]["importModuleSpecifierEnding"], "js");
        assert_eq!(
            response["result"][1]["importModuleSpecifierPreference"],
            "relative"
        );
        assert_eq!(response["result"][1]["mockorCodeLensEnabled"], true);
        assert_eq!(response["result"][1]["preferTypeOnlyAutoImports"], true);
        assert_eq!(response["result"][1]["quotePreference"], "double");
        assert_eq!(response["result"][2]["enabled"], true);
        assert_eq!(response["result"][3]["enable"], false);
        assert_eq!(response["result"][4]["enabled"], "never");
        assert_eq!(response["result"][5]["insertSpaces"], false);
        assert_eq!(response["result"][5]["tabSize"], 8);
    }

    #[test]
    fn workspace_folder_requests_return_the_session_root() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();
        let command = LanguageServerCommand {
            executable: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/tmp/workspace-a".to_string(),
            env: Vec::new(),
        };

        supervisor
            .start(
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 44,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );

        let response = wait_for_captured_response(&capture, 44);

        assert_eq!(response["result"][0]["uri"], "file:///tmp/workspace-a");
        assert_eq!(response["result"][0]["name"], "workspace-a");
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
    fn unexpected_crash_auto_restarts_session_and_returns_to_running() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        // Simulate an unexpected crash: drop the server's stdout writer.
        *held.lock().expect("held writer lock") = None;

        // The supervisor should re-spawn for the same workspace and come back up.
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
    }

    #[test]
    fn cancellable_backoff_returns_supervisor_when_workspace_stays_open() {
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let weak = Arc::downgrade(&supervisor);

        // A short backoff over a workspace that stays open must run to completion
        // and hand back the live supervisor so the restart can proceed.
        let upgraded =
            cancellable_backoff(&weak, Duration::from_millis(20), Duration::from_millis(5));

        assert!(
            upgraded.is_some(),
            "an open workspace must yield its supervisor after the backoff"
        );
    }

    #[test]
    fn cancellable_backoff_bails_immediately_when_workspace_closes() {
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let weak = Arc::downgrade(&supervisor);

        // Simulate a workspace close (registry stop_all / stop) dropping the only
        // strong reference shortly after the backoff begins.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            drop(supervisor);
        });

        let started = Instant::now();
        // Backoff total is multiple seconds; if cancellation works the call must
        // return promptly after the supervisor is dropped, never near the full delay.
        let upgraded =
            cancellable_backoff(&weak, Duration::from_secs(30), Duration::from_millis(5));
        let elapsed = started.elapsed();

        assert!(
            upgraded.is_none(),
            "a closed workspace must not yield a supervisor to restart"
        );
        assert!(
            elapsed < Duration::from_secs(1),
            "backoff must cancel promptly when the workspace closes, took {elapsed:?}"
        );
    }

    #[test]
    fn unexpected_crash_stops_restarting_after_exhausting_attempts() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                // Budget of exactly one restart.
                Arc::new(RestartController::new(RestartPolicy::new(
                    1,
                    Duration::from_secs(60),
                    Duration::from_millis(0),
                ))),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        // First crash -> one restart is allowed and succeeds.
        *held.lock().expect("held writer lock") = None;
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        // Second crash -> budget exhausted -> stays crashed (no infinite loop).
        *held.lock().expect("held writer lock") = None;
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Crashed {
                message: "PHPactor exited unexpectedly.".to_string(),
            },
        );
    }

    #[test]
    fn legitimate_stop_does_not_trigger_restart() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        let status = supervisor.stop();

        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        wait_for(&rx, &LanguageServerRuntimeStatus::Stopped);
        // Give any erroneous restart a chance to surface, then confirm stopped.
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn restart_start_kind_aborts_when_session_already_stopped() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();

        // Simulate a workspace that was stopped after it crashed.
        supervisor.force_status(LanguageServerRuntimeStatus::Stopped);

        let result = supervisor.begin_start(sink.as_ref(), 7, StartKind::Restart);

        assert!(result.is_err());
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn restart_start_kind_proceeds_when_session_still_crashed() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();

        supervisor.force_status(LanguageServerRuntimeStatus::Crashed {
            message: "boom".to_string(),
        });

        supervisor
            .begin_start(sink.as_ref(), 7, StartKind::Restart)
            .expect("restart should resume a crashed session");

        assert_eq!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Starting { session_id: 7 }
        );
    }

    #[test]
    fn fresh_start_kind_proceeds_from_stopped() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();

        supervisor.force_status(LanguageServerRuntimeStatus::Stopped);

        supervisor
            .begin_start(sink.as_ref(), 9, StartKind::Fresh)
            .expect("fresh start should proceed from stopped");

        assert_eq!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Starting { session_id: 9 }
        );
    }

    fn test_restart_controller() -> Arc<RestartController> {
        Arc::new(RestartController::new(RestartPolicy::new(
            3,
            Duration::from_secs(60),
            Duration::from_millis(0),
        )))
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

    #[test]
    fn restart_policy_allows_restart_for_unexpected_crash_within_limit() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        assert!(policy.should_restart(now));
    }

    #[test]
    fn restart_policy_never_restarts_after_requested_shutdown() {
        let policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));

        assert!(!RestartDecision::for_shutdown(&policy));
    }

    #[test]
    fn restart_policy_stops_after_max_attempts_within_window() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        for _ in 0..3 {
            assert!(policy.should_restart(now));
            policy.record_attempt(now);
        }

        assert!(!policy.should_restart(now));
    }

    #[test]
    fn restart_policy_uses_exponential_backoff_per_attempt() {
        let policy = RestartPolicy::new(4, Duration::from_secs(60), Duration::from_secs(1));

        assert_eq!(policy.backoff_delay(0), Duration::from_secs(1));
        assert_eq!(policy.backoff_delay(1), Duration::from_secs(2));
        assert_eq!(policy.backoff_delay(2), Duration::from_secs(4));
    }

    #[test]
    fn restart_policy_caps_backoff_at_thirty_seconds() {
        let policy = RestartPolicy::new(20, Duration::from_secs(600), Duration::from_secs(1));

        assert_eq!(policy.backoff_delay(10), Duration::from_secs(30));
    }

    #[test]
    fn restart_policy_clamps_large_attempt_index_to_cap_not_zero() {
        let policy = RestartPolicy::new(100, Duration::from_secs(600), Duration::from_secs(1));

        // Indices that would truncate a u32 shift must still clamp to the cap.
        assert_eq!(policy.backoff_delay(40), Duration::from_secs(30));
        assert_eq!(policy.backoff_delay(64), Duration::from_secs(30));
        assert_eq!(policy.backoff_delay(1000), Duration::from_secs(30));
    }

    #[test]
    fn restart_policy_forgets_attempts_outside_the_window() {
        let mut policy = RestartPolicy::new(2, Duration::from_secs(60), Duration::from_secs(1));
        let start = Instant::now();

        policy.record_attempt(start);
        policy.record_attempt(start);
        assert!(!policy.should_restart(start));

        let later = start + Duration::from_secs(61);
        assert!(policy.should_restart(later));
    }

    #[test]
    fn restart_policy_reset_clears_attempt_history() {
        let mut policy = RestartPolicy::new(2, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        policy.record_attempt(now);
        policy.record_attempt(now);
        assert!(!policy.should_restart(now));

        policy.reset();

        assert!(policy.should_restart(now));
    }

    #[test]
    fn restart_policy_next_attempt_index_grows_within_window_and_resets() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        assert_eq!(policy.next_attempt_index(now), 0);
        policy.record_attempt(now);
        assert_eq!(policy.next_attempt_index(now), 1);
        policy.record_attempt(now);
        assert_eq!(policy.next_attempt_index(now), 2);

        policy.reset();
        assert_eq!(policy.next_attempt_index(now), 0);
    }

    #[test]
    fn restart_controller_decides_restart_only_for_unexpected_crash() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
    }

    #[test]
    fn restart_controller_does_not_restart_when_shutdown_requested() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(true),
            RestartOutcome::GiveUp
        ));
    }

    #[test]
    fn restart_controller_gives_up_after_exhausting_attempts() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::GiveUp
        ));
    }

    #[test]
    fn restart_controller_reset_after_stable_run_restores_attempts() {
        let controller = RestartController::new(RestartPolicy::new(
            1,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::GiveUp
        ));

        controller.note_stable_run();

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
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
            env: Vec::new(),
        }
    }

    fn phpactor_managed_command() -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "/usr/bin/php".to_string(),
            args: vec![
                "-n".to_string(),
                "-c".to_string(),
                "/managed/codevo-php.ini".to_string(),
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
                    .to_string(),
                "language-server".to_string(),
            ],
            working_directory: ".".to_string(),
            env: vec![
                ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
                (
                    "PHP_INI_SCAN_DIR".to_string(),
                    "/managed/empty-php-conf.d".to_string(),
                ),
            ],
        }
    }

    fn command_for_root(root_path: &str) -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: root_path.to_string(),
            env: Vec::new(),
        }
    }

    fn test_workspace_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{unique}"));
        fs::create_dir_all(&root).expect("workspace root");
        root
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
                    "declarationProvider": true,
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

    fn wait_for_log(supervisor: &LanguageServerSupervisor, needle: &str) {
        let deadline = Instant::now() + Duration::from_secs(2);

        while Instant::now() < deadline {
            if supervisor.log().contains(needle) {
                return;
            }

            std::thread::sleep(Duration::from_millis(10));
        }

        panic!("expected runtime log to contain {needle:?}");
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

    fn wait_for_captured_response(capture: &Arc<Mutex<Vec<u8>>>, id: u64) -> Value {
        let deadline = Instant::now() + Duration::from_secs(2);

        loop {
            for value in captured_messages(capture) {
                if value.get("id").and_then(Value::as_u64) == Some(id)
                    && value.get("result").is_some()
                {
                    return value;
                }
            }

            if Instant::now() >= deadline {
                panic!("expected captured response {id}");
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
        stderr_script: Vec<u8>,
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        stdin: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
        script: Vec<u8>,
        terminate_script: Vec<u8>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        keep_open: bool,
    }

    impl FakeSpawner {
        fn new(script: Vec<u8>, keep_open: bool) -> Self {
            Self {
                stderr_script: Vec::new(),
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(None)),
                script,
                terminate_script: Vec::new(),
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stdin(script: Vec<u8>, keep_open: bool, stdin: Box<dyn Write + Send>) -> Self {
            Self {
                stderr_script: Vec::new(),
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(Some(stdin))),
                script,
                terminate_script: Vec::new(),
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stderr(mut self, stderr_script: Vec<u8>) -> Self {
            self.stderr_script = stderr_script;
            self
        }

        fn with_terminate_script(mut self, terminate_script: Vec<u8>) -> Self {
            self.terminate_script = terminate_script;
            self
        }
    }

    impl ServerProcessSpawner for FakeSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            let (reader, mut writer) = std::io::pipe()?;
            writer.write_all(&self.script)?;
            let stderr = if self.stderr_script.is_empty() {
                None
            } else {
                let (stderr_reader, mut stderr_writer) = std::io::pipe()?;
                stderr_writer.write_all(&self.stderr_script)?;
                drop(stderr_writer);
                Some(Box::new(stderr_reader) as Box<dyn std::io::Read + Send>)
            };

            if self.keep_open {
                *self.held_writer.lock().expect("held writer lock") = Some(writer);
            }

            Ok(SpawnedServer {
                stderr,
                stdin: self
                    .stdin
                    .lock()
                    .expect("stdin lock")
                    .take()
                    .unwrap_or_else(|| Box::new(SharedWriter(Arc::clone(&self.stdin_capture)))),
                stdout: Box::new(reader),
                killer: Box::new(FakeKiller {
                    held: Arc::clone(&self.held_writer),
                    terminate_script: self.terminate_script.clone(),
                }),
            })
        }
    }

    struct FakeKiller {
        held: Arc<Mutex<Option<PipeWriter>>>,
        terminate_script: Vec<u8>,
    }

    impl ProcessKiller for FakeKiller {
        fn terminate(&mut self) -> io::Result<()> {
            let mut writer = self.held.lock().expect("held writer lock").take();

            if let Some(writer) = writer.as_mut() {
                writer.write_all(&self.terminate_script)?;
            }

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

    struct ChannelWorkspaceEditSink {
        tx: Mutex<Sender<LanguageServerWorkspaceEditEvent>>,
    }

    impl ChannelWorkspaceEditSink {
        fn new() -> (
            Arc<dyn WorkspaceEditSink>,
            Receiver<LanguageServerWorkspaceEditEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl WorkspaceEditSink for ChannelWorkspaceEditSink {
        fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool {
            self.tx
                .lock()
                .expect("workspace edit sink lock")
                .send(event)
                .is_ok()
        }
    }

    struct ChannelRefreshSink {
        tx: Mutex<Sender<LanguageServerRefreshEvent>>,
    }

    impl ChannelRefreshSink {
        fn new() -> (Arc<dyn RefreshSink>, Receiver<LanguageServerRefreshEvent>) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl RefreshSink for ChannelRefreshSink {
        fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool {
            self.tx
                .lock()
                .expect("refresh sink lock")
                .send(event)
                .is_ok()
        }
    }

    struct NoopDiagnosticsSink;

    impl DiagnosticsSink for NoopDiagnosticsSink {
        fn emit_diagnostics(&self, _event: LanguageServerDiagnosticEvent) {
            // no-op for status-only tests
        }
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = temp_path(label);
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical temp workspace")
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("editor-lsp-{label}-{}", unique_suffix()))
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    fn _unique_label(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        format!("{prefix}-{nanos}")
    }

    // --- Runtime lifecycle: real OS process termination (no orphans / no hang) ---
    //
    // These tests exercise the *real* process-kill path (`ChildKiller` ->
    // process-group SIGTERM/SIGKILL) instead of the in-memory `FakeKiller`, so
    // they prove an OS process actually dies on every lifecycle transition
    // (disable IDE mode / close tab / quit app), that disposing one workspace
    // never touches another (per-root isolation), and that termination is
    // idempotent and never blocks the reader join.

    /// Probes process liveness without disturbing it: `kill(pid, 0)` returns 0
    /// when the process exists, `EPERM` when it exists but is owned by another
    /// user, and `ESRCH` once it is gone (and reaped).
    #[cfg(unix)]
    fn process_is_alive(pid: i32) -> bool {
        if unsafe { libc::kill(pid, 0) } == 0 {
            return true;
        }

        io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    #[cfg(unix)]
    fn wait_until_process_dead(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;

        loop {
            if !process_is_alive(pid) {
                return true;
            }

            if Instant::now() >= deadline {
                return false;
            }

            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(unix)]
    fn read_pids_from_file(path: &Path, count: usize, timeout: Duration) -> Vec<i32> {
        let deadline = Instant::now() + timeout;

        loop {
            if let Ok(contents) = fs::read_to_string(path) {
                let pids: Vec<i32> = contents
                    .split_whitespace()
                    .filter_map(|token| token.parse().ok())
                    .collect();

                if pids.len() >= count {
                    return pids;
                }
            }

            if Instant::now() >= deadline {
                panic!("expected {count} pids in {path:?}");
            }

            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Spawns a *real* long-lived child (`sleep`) wrapped in the production
    /// [`ChildKiller`], while serving a scripted LSP handshake over an in-memory
    /// pipe so the supervisor reaches the `Running` state. This lets registry
    /// lifecycle tests assert that the OS process is genuinely reaped on stop,
    /// not merely removed from the registry map.
    #[cfg(unix)]
    struct RealProcessSpawner {
        script: Vec<u8>,
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        recorded_pid: Arc<Mutex<Option<i32>>>,
    }

    #[cfg(unix)]
    impl RealProcessSpawner {
        fn new() -> Self {
            Self {
                script: ready_script(),
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                held_writer: Arc::new(Mutex::new(None)),
                recorded_pid: Arc::new(Mutex::new(None)),
            }
        }

        fn pid(&self) -> i32 {
            self.recorded_pid
                .lock()
                .expect("recorded pid")
                .expect("spawned process pid")
        }
    }

    #[cfg(unix)]
    impl ServerProcessSpawner for RealProcessSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            use std::os::unix::process::CommandExt;
            use std::process::{Command, Stdio};

            let (reader, mut writer) = std::io::pipe()?;
            writer.write_all(&self.script)?;
            *self.held_writer.lock().expect("held writer lock") = Some(writer);

            let mut command = Command::new("sleep");
            command
                .arg("600")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0);
            let child = command.spawn()?;
            let process_group_id = child.id() as i32;
            *self.recorded_pid.lock().expect("recorded pid") = Some(process_group_id);

            Ok(SpawnedServer {
                stderr: None,
                stdin: Box::new(SharedWriter(Arc::clone(&self.stdin_capture))),
                stdout: Box::new(reader),
                killer: Box::new(RealProcessKiller {
                    inner: ChildKiller {
                        child,
                        process_group_id,
                    },
                    held: Arc::clone(&self.held_writer),
                }),
            })
        }
    }

    #[cfg(unix)]
    struct RealProcessKiller {
        inner: ChildKiller,
        held: Arc<Mutex<Option<PipeWriter>>>,
    }

    #[cfg(unix)]
    impl ProcessKiller for RealProcessKiller {
        fn pid(&self) -> Option<u32> {
            self.inner.pid()
        }

        fn terminate(&mut self) -> io::Result<()> {
            let result = self.inner.terminate();
            // In production the dying process closes its own stdout, which gives
            // the session reader the EOF it needs to unblock and join. Our
            // scripted stdout is a separate pipe, so drop its writer to emulate
            // that close and keep `terminate_session`'s reader join from hanging.
            let _ = self.held.lock().expect("held writer lock").take();
            result
        }
    }

    /// Quitting the app / closing a tab must reap the *whole* server process
    /// tree. A language server that forks a child which inherits its stdout
    /// would, under a bare `child.kill()`, leave that grandchild alive holding
    /// the stdout pipe open - and the session reader's `join()` would block
    /// forever (a hung, orphaned process). Killing the process group closes the
    /// pipe and unblocks the reader. This guards that the process-group kill
    /// stays in place.
    #[cfg(unix)]
    #[test]
    fn child_killer_reaps_process_group_so_inherited_stdout_closes_without_hanging() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let pid_file = temp_path("pgid-reap");
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(format!(
                "sleep 600 & printf '%s %s' \"$$\" \"$!\" > '{}'; wait",
                pid_file.display()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);

        let mut child = command.spawn().expect("spawn process-group child");
        let process_group_id = child.id() as i32;
        let stdout = child.stdout.take().expect("child stdout");
        let mut killer = ChildKiller {
            child,
            process_group_id,
        };

        // Drain the inherited stdout exactly like the session reader does; it can
        // only finish once every process in the group has released the pipe.
        let reader = std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            let mut sink = Vec::new();
            let _ = reader.read_to_end(&mut sink);
        });

        let pids = read_pids_from_file(&pid_file, 2, Duration::from_secs(5));
        let (shell_pid, grandchild_pid) = (pids[0], pids[1]);
        assert!(process_is_alive(shell_pid));
        assert!(process_is_alive(grandchild_pid));

        killer.terminate().expect("terminate process group");

        // Fail fast rather than hang the suite if a grandchild kept stdout open.
        let deadline = Instant::now() + Duration::from_secs(5);
        while !reader.is_finished() {
            assert!(
                Instant::now() < deadline,
                "stdout reader did not unblock after process-group kill"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        reader.join().expect("reader thread");

        assert!(
            wait_until_process_dead(shell_pid, Duration::from_secs(5)),
            "shell child must be reaped"
        );
        assert!(
            wait_until_process_dead(grandchild_pid, Duration::from_secs(5)),
            "inherited grandchild must be reaped (no orphan)"
        );

        // Terminate is idempotent and must not block once the process is gone.
        let started = Instant::now();
        killer.terminate().expect("idempotent terminate");
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "second terminate must return promptly"
        );

        let _ = fs::remove_file(&pid_file);
    }

    /// Closing one project tab (`dispose_workspace_root` -> `registry.stop`) must
    /// kill that workspace's real LSP process while a sibling workspace keeps
    /// running, and quitting the app (`stop_all`) must then reap the rest.
    #[cfg(unix)]
    #[test]
    fn registry_stop_kills_real_workspace_process_and_leaves_siblings_running() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner_a = RealProcessSpawner::new();
        let spawner_b = RealProcessSpawner::new();
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();
        // Non-managed command path so PHP orphan cleanup (`pkill`) is skipped and
        // the test never signals unrelated processes on the host.
        let command = command();

        registry
            .start(
                "/tmp/lifecycle-a",
                &command,
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/lifecycle-b",
                &command,
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        let pid_a = spawner_a.pid();
        let pid_b = spawner_b.pid();
        assert!(process_is_alive(pid_a));
        assert!(process_is_alive(pid_b));

        assert_eq!(
            registry.stop("/tmp/lifecycle-a"),
            LanguageServerRuntimeStatus::Stopped
        );

        assert!(
            wait_until_process_dead(pid_a, Duration::from_secs(5)),
            "disposed workspace process must be dead"
        );
        assert!(
            process_is_alive(pid_b),
            "sibling workspace process must stay alive (per-root isolation)"
        );
        assert!(matches!(
            registry.status("/tmp/lifecycle-b"),
            LanguageServerRuntimeStatus::Running { .. }
        ));

        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(
            wait_until_process_dead(pid_b, Duration::from_secs(5)),
            "remaining workspace process must be dead after stop_all"
        );

        // Quitting again over an already-empty registry is idempotent and fast.
        let started = Instant::now();
        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /// Disabling IDE mode (fullSmart -> basic) routes through
    /// `stop_php_language_server` -> `PhpLanguageServerRegistry::stop`, which must
    /// terminate the phpactor process, report `Stopped`, and clear its launch
    /// context. A second stop is idempotent and non-blocking.
    #[cfg(unix)]
    #[test]
    fn disabling_ide_mode_terminates_php_language_server_process() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = RealProcessSpawner::new();
        let (sink, _rx) = ChannelSink::new();
        let command = command();

        registry
            .start(
                "/tmp/ide-toggle",
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start phpactor");

        let pid = spawner.pid();
        assert!(process_is_alive(pid));

        assert_eq!(
            registry.stop("/tmp/ide-toggle"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(
            wait_until_process_dead(pid, Duration::from_secs(5)),
            "phpactor process must be dead after disabling IDE mode"
        );
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());

        let started = Instant::now();
        assert_eq!(
            registry.stop("/tmp/ide-toggle"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "stopping an already-stopped workspace must be fast"
        );
    }

    /// A running supervisor must surface the OS PID of its spawned process so the
    /// runtime observability panel can show it and sample RAM/CPU. Once stopped,
    /// the PID is gone (no stale session).
    #[cfg(unix)]
    #[test]
    fn supervisor_exposes_running_process_pid_and_clears_it_on_stop() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = Arc::new(RealProcessSpawner::new());
        let (sink, _rx) = ChannelSink::new();
        let command = command();

        registry
            .start_with_auto_restart(
                "/tmp/observability-pid",
                &command,
                &initialize_request(),
                spawner.clone(),
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start phpactor");

        let spawned_pid = spawner.pid();
        assert_eq!(
            registry.pid("/tmp/observability-pid"),
            Some(spawned_pid as u32),
            "registry must report the spawned PID for a running runtime"
        );

        assert_eq!(
            registry.stop("/tmp/observability-pid"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(
            registry.pid("/tmp/observability-pid"),
            None,
            "stopped runtime must report no PID"
        );
        let _ = wait_until_process_dead(spawned_pid, Duration::from_secs(5));
    }

    /// Restarting a runtime must reap the old process, spawn a fresh one for the
    /// SAME workspace (reusing its stored launch command), and leave a sibling
    /// workspace untouched (per-root isolation).
    #[cfg(unix)]
    #[test]
    fn restart_respawns_same_workspace_and_leaves_siblings_running() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner_a = Arc::new(RealProcessSpawner::new());
        let spawner_b = Arc::new(RealProcessSpawner::new());
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();
        let command = command();

        registry
            .start_with_auto_restart(
                "/tmp/restart-a",
                &command,
                &initialize_request(),
                spawner_a.clone(),
                sink_a,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start workspace a");
        registry
            .start_with_auto_restart(
                "/tmp/restart-b",
                &command,
                &initialize_request(),
                spawner_b.clone(),
                sink_b,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start workspace b");

        let pid_a_before = spawner_a.pid();
        let pid_b = spawner_b.pid();
        assert!(process_is_alive(pid_a_before));
        assert!(process_is_alive(pid_b));

        let restart_spawner = Arc::new(RealProcessSpawner::new());
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let status = registry
            .restart_with_auto_restart(
                "/tmp/restart-a",
                restart_spawner.clone(),
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("restart workspace a");

        assert!(matches!(
            status,
            LanguageServerRuntimeStatus::Running { .. }
        ));
        let pid_a_after = restart_spawner.pid();
        assert_ne!(
            pid_a_before, pid_a_after,
            "restart must spawn a fresh process"
        );
        assert!(
            wait_until_process_dead(pid_a_before, Duration::from_secs(5)),
            "old process must be reaped on restart"
        );
        assert!(process_is_alive(pid_a_after), "new process must be running");
        assert_eq!(
            registry.pid("/tmp/restart-a"),
            Some(pid_a_after as u32),
            "registry must report the restarted PID"
        );
        assert!(
            process_is_alive(pid_b),
            "sibling workspace must stay running (per-root isolation)"
        );

        registry.stop_all();
        let _ = wait_until_process_dead(pid_a_after, Duration::from_secs(5));
        let _ = wait_until_process_dead(pid_b, Duration::from_secs(5));
    }

    /// Restarting a workspace that never started returns an error rather than
    /// spawning anything.
    #[test]
    fn restart_without_prior_start_reports_error() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (sink, _rx) = ChannelSink::new();

        let result = registry.restart_with_auto_restart(
            "/tmp/never-started",
            spawner,
            sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        );

        assert!(result.is_err(), "restart with no prior start must error");
    }

    /// Models the restart-vs-close race resolving "close first": once a tab close
    /// has stopped the workspace (clearing its launch context), a restart must NOT
    /// resurrect the server - it errors instead, so a closed workspace can never
    /// be brought back to life.
    #[cfg(unix)]
    #[test]
    fn restart_after_workspace_close_does_not_resurrect_server() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = Arc::new(RealProcessSpawner::new());
        let (sink, _rx) = ChannelSink::new();
        let command = command();

        registry
            .start_with_auto_restart(
                "/tmp/restart-after-close",
                &command,
                &initialize_request(),
                spawner.clone(),
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("start workspace");

        let pid = spawner.pid();

        // The tab close wins the race: stop removes the supervisor + launch context.
        registry.stop("/tmp/restart-after-close");
        assert!(wait_until_process_dead(pid, Duration::from_secs(5)));

        let restart_spawner = Arc::new(RealProcessSpawner::new());
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let result = registry.restart_with_auto_restart(
            "/tmp/restart-after-close",
            restart_spawner,
            restart_sink,
            noop_diagnostics_sink(),
            Arc::new(NoopWorkspaceEditSink),
            Arc::new(NoopRefreshSink),
            test_restart_controller(),
        );

        assert!(
            result.is_err(),
            "restart after close must not resurrect a closed workspace"
        );
        assert_eq!(registry.pid("/tmp/restart-after-close"), None);
    }

    /// Closing a JS/TS workspace tab must reap the real tsserver process too, so
    /// no Node process leaks between open project tabs.
    #[cfg(unix)]
    #[test]
    fn stopping_javascript_typescript_workspace_terminates_real_process() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner = RealProcessSpawner::new();
        let (sink, _rx) = ChannelSink::new();

        registry
            .start(
                "/tmp/ts-tab",
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start tsserver");

        let pid = spawner.pid();
        assert!(process_is_alive(pid));

        assert_eq!(
            registry.stop("/tmp/ts-tab"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(
            wait_until_process_dead(pid, Duration::from_secs(5)),
            "tsserver process must be dead after closing the tab"
        );
    }
}
