use super::{
    clone_command, clone_initialize_request, is_active_status, workspace_runtime_id,
    workspace_runtime_id_candidates, DiagnosticsSink, ExactSessionNotificationOutcome,
    LanguageServerEventSinks, LanguageServerRequestError, LanguageServerRuntimeStatus,
    LanguageServerSupervisor, ProjectResyncRequestOutcome, RecentLspRequest, RefreshSink,
    RestartController, ServerProcessSpawner, StatusSink, WorkspaceEditSink,
};
#[cfg(test)]
use super::{NoopRefreshSink, NoopWorkspaceEditSink};
use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
#[cfg(unix)]
use crate::{managed_javascript_typescript, managed_phpactor};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

pub struct LanguageServerRegistry {
    pub(super) next_session_id: Arc<AtomicU64>,
    pub(super) server_label: &'static str,
    pub(super) supervisors: Mutex<HashMap<String, Arc<LanguageServerSupervisor>>>,
}

pub(super) struct PhpLaunchContext {
    pub(super) command: LanguageServerCommand,
    pub(super) initialize_request: JsonRpcRequest,
    pub(super) root_path: String,
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
    pub(super) registry: LanguageServerRegistry,
    pub(super) launch_contexts: Mutex<HashMap<String, PhpLaunchContext>>,
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
            LanguageServerEventSinks::new(
                status_sink,
                diagnostics_sink,
                workspace_edit_sink,
                refresh_sink,
            ),
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

pub(super) struct JavaScriptTypeScriptLaunchContext {
    pub(super) command: LanguageServerCommand,
    pub(super) initialize_request: JsonRpcRequest,
    pub(super) root_path: String,
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
    pub(super) registry: LanguageServerRegistry,
    pub(super) launch_contexts: Mutex<HashMap<String, JavaScriptTypeScriptLaunchContext>>,
    pub(super) cleanup_gate: Mutex<()>,
    pub(super) start_replacements: Mutex<HashSet<String>>,
}

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub fn new() -> Self {
        Self {
            registry: LanguageServerRegistry::new_with_label("TypeScript language server"),
            launch_contexts: Mutex::new(HashMap::new()),
            cleanup_gate: Mutex::new(()),
            start_replacements: Mutex::new(HashSet::new()),
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
        self.reserve_start_cleanup(root_path, status_sink.as_ref())?
            .start_with_auto_restart(
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

    pub(super) fn store_launch_context_if_active(
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
            let _cleanup_gate = self
                .cleanup_gate
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
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
            next_session_id: Arc::new(AtomicU64::new(1)),
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

    /// Recent LSP requests (newest first) for the runtime keyed to `root_path`.
    /// Empty when no supervisor exists for the root, so telemetry stays scoped to
    /// the requested workspace.
    pub fn recent_requests(&self, root_path: &str) -> Vec<RecentLspRequest> {
        self.existing_supervisor(root_path)
            .map(|supervisor| supervisor.recent_requests())
            .unwrap_or_default()
    }

    /// Trailing stderr lines for the runtime keyed to `root_path`.
    pub fn stderr_tail(&self, root_path: &str) -> Vec<String> {
        self.existing_supervisor(root_path)
            .map(|supervisor| supervisor.stderr_tail())
            .unwrap_or_default()
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
            LanguageServerEventSinks::new(
                status_sink,
                diagnostics_sink,
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
        )
    }

    #[cfg(test)]
    pub fn start_with_workspace_edit_sink(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        event_sinks: LanguageServerEventSinks,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.start_with_event_sinks(root_path, command, initialize_request, spawner, event_sinks)
    }

    #[cfg(test)]
    pub fn start_with_event_sinks(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        event_sinks: LanguageServerEventSinks,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.supervisor_for(root_path)?.start_with_event_sinks(
            command,
            initialize_request,
            spawner,
            event_sinks,
        )
    }

    /// Start (or re-create) the per-workspace supervisor with crash auto-restart
    /// enabled. The `restart_controller` is owned per workspace, so a crash in
    /// one workspace's server can only re-spawn that same workspace — restart
    /// budgets never leak across open project tabs.
    pub fn start_with_auto_restart(
        &self,
        root_path: &str,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        event_sinks: LanguageServerEventSinks,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.supervisor_for(root_path)?.start_with_auto_restart(
            command,
            initialize_request,
            spawner,
            event_sinks,
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

    pub fn send_notification_for_session(
        &self,
        root_path: &str,
        expected_session_id: u64,
        notification: &JsonRpcNotification,
    ) -> Result<(), String> {
        self.send_notification_for_session_outcome(root_path, expected_session_id, notification)
            .map(|_| ())
    }

    pub fn send_notification_for_session_outcome(
        &self,
        root_path: &str,
        expected_session_id: u64,
        notification: &JsonRpcNotification,
    ) -> Result<ExactSessionNotificationOutcome, String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(ExactSessionNotificationOutcome::Stale);
        };

        supervisor.send_notification_for_session_outcome(expected_session_id, notification)
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

        supervisor
            .send_request(method, params)
            .map_err(|error| error.to_string())
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
        let request = self.send_request_async_preserving_response_error(root_path, method, params);

        async move { request.await.map_err(|error| error.to_string()) }
    }

    pub fn send_request_async_with_id(
        &self,
        root_path: &str,
        session_id: u64,
        request_id: u64,
        method: &str,
        params: Value,
    ) -> impl std::future::Future<Output = Result<Option<Value>, String>> + 'static {
        let supervisor = self.existing_supervisor(root_path);
        let method = method.to_string();

        async move {
            let Some(supervisor) = supervisor else {
                return Ok(None);
            };
            tauri::async_runtime::spawn_blocking(move || {
                supervisor.send_request_with_id(session_id, request_id, &method, params)
            })
            .await
            .map_err(|error| format!("Language server request task failed: {error}"))?
            .map_err(|error| error.to_string())
        }
    }

    pub fn cancel_request(
        &self,
        root_path: &str,
        session_id: u64,
        request_id: u64,
    ) -> Result<(), String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(());
        };
        let Some(cancel) = supervisor
            .prepare_cancel_request(session_id, request_id)
            .map_err(|error| error.to_string())?
        else {
            return Ok(());
        };
        cancel
            .transport
            .enqueue(cancel.wire_request_id)
            .map_err(|error| {
                format!(
                    "Language server session {} cancellation transport failed: {error}",
                    cancel.session_id
                )
            })
    }

    /// Forces an authoritative JavaScript/TypeScript project-graph rebuild for
    /// the exact running session that observed a watcher overflow. A missing or
    /// replaced session is stale success: it must never restart the replacement.
    pub fn request_project_resync(
        &self,
        root_path: &str,
        expected_session_id: u64,
    ) -> Result<ProjectResyncRequestOutcome, String> {
        let Some(supervisor) = self.existing_supervisor(root_path) else {
            return Ok(ProjectResyncRequestOutcome::Unavailable);
        };
        supervisor.request_project_resync(expected_session_id)
    }

    pub fn send_request_async_preserving_response_error(
        &self,
        root_path: &str,
        method: &str,
        params: Value,
    ) -> impl std::future::Future<Output = Result<Option<Value>, LanguageServerRequestError>> + 'static
    {
        let supervisor = self.existing_supervisor(root_path);
        let method = method.to_string();

        async move {
            let Some(supervisor) = supervisor else {
                return Ok(None);
            };

            tauri::async_runtime::spawn_blocking(move || supervisor.send_request(&method, params))
                .await
                .map_err(|error| {
                    LanguageServerRequestError::from(format!(
                        "Language server request task failed: {error}"
                    ))
                })?
        }
    }

    pub fn running_roots(&self) -> Vec<String> {
        let Ok(supervisors) = self.supervisors.lock() else {
            return Vec::new();
        };

        let mut roots = supervisors
            .iter()
            .filter(|&(_root_path, supervisor)| {
                matches!(
                    supervisor.status(),
                    LanguageServerRuntimeStatus::Starting { .. }
                        | LanguageServerRuntimeStatus::Running { .. }
                )
            })
            .map(|(root_path, _supervisor)| root_path.clone())
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
                Arc::new(LanguageServerSupervisor::new_with_session_id_source(
                    self.server_label,
                    Arc::clone(&self.next_session_id),
                ))
            })
            .clone())
    }

    pub(super) fn existing_supervisor(
        &self,
        root_path: &str,
    ) -> Option<Arc<LanguageServerSupervisor>> {
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
