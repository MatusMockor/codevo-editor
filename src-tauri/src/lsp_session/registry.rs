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
use std::sync::{Arc, Condvar, Mutex};

pub(super) const MAX_LANGUAGE_SERVER_WORKSPACES: usize = 64;
const LANGUAGE_SERVER_WORKSPACE_CAPACITY_MESSAGE: &str =
    "Language server workspace capacity (64) was reached.";

fn runtime_status_session_id(status: &LanguageServerRuntimeStatus) -> Option<u64> {
    match status {
        LanguageServerRuntimeStatus::Starting { session_id }
        | LanguageServerRuntimeStatus::Running { session_id, .. } => Some(*session_id),
        LanguageServerRuntimeStatus::Stopped | LanguageServerRuntimeStatus::Crashed { .. } => None,
    }
}

fn aggregate_stop_status(
    aggregate: LanguageServerRuntimeStatus,
    next: LanguageServerRuntimeStatus,
) -> LanguageServerRuntimeStatus {
    match (&aggregate, &next) {
        (LanguageServerRuntimeStatus::Crashed { .. }, _) => aggregate,
        (_, LanguageServerRuntimeStatus::Crashed { .. }) => next,
        (LanguageServerRuntimeStatus::Stopped, _) => next,
        _ => aggregate,
    }
}

struct RestartToken<'a> {
    tokens: &'a Mutex<HashMap<String, u64>>,
    runtime_id: String,
    generation: u64,
    armed: bool,
}

impl RestartToken<'_> {
    fn is_current(&self) -> bool {
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&self.runtime_id)
            .is_some_and(|generation| *generation == self.generation)
    }

    fn finish(&mut self) -> bool {
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let removed = if tokens
            .get(&self.runtime_id)
            .is_some_and(|generation| *generation == self.generation)
        {
            tokens.remove(&self.runtime_id);
            true
        } else {
            false
        };
        self.armed = false;
        removed
    }

    fn reserve_start_cleanup<'a>(
        &self,
        registry: &'a LanguageServerRegistry,
        root_path: &str,
    ) -> Result<super::start_cleanup::LanguageServerStartCleanupLease<'a>, String> {
        let tokens = self.tokens.lock().map_err(|error| error.to_string())?;
        if tokens
            .get(&self.runtime_id)
            .is_none_or(|generation| *generation != self.generation)
        {
            return Err("Language server restart was superseded by workspace stop.".to_string());
        }
        let (lease, replaced) = registry.reserve_start_cleanup_parts(root_path)?;
        drop(tokens);
        if let Some(replaced) = replaced {
            replaced.stop();
        }
        if !self.is_current() {
            drop(lease);
            return Err("Language server restart was superseded by workspace stop.".to_string());
        }
        Ok(lease)
    }
}

impl Drop for RestartToken<'_> {
    fn drop(&mut self) {
        if self.armed {
            let mut tokens = self
                .tokens
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if tokens
                .get(&self.runtime_id)
                .is_some_and(|generation| *generation == self.generation)
            {
                tokens.remove(&self.runtime_id);
            }
        }
    }
}

pub struct LanguageServerRegistry {
    pub(super) next_session_id: Arc<AtomicU64>,
    pub(super) server_label: &'static str,
    pub(super) supervisors: Arc<Mutex<HashMap<String, Arc<LanguageServerSupervisor>>>>,
}

pub(super) struct PhpLaunchContext {
    pub(super) command: LanguageServerCommand,
    pub(super) initialize_request: JsonRpcRequest,
    pub(super) root_path: String,
    pub(super) session_id: u64,
}

impl Clone for PhpLaunchContext {
    fn clone(&self) -> Self {
        Self {
            command: clone_command(&self.command),
            initialize_request: clone_initialize_request(&self.initialize_request),
            root_path: self.root_path.clone(),
            session_id: self.session_id,
        }
    }
}

pub struct PhpLanguageServerRegistry {
    pub(super) registry: LanguageServerRegistry,
    pub(super) launch_contexts: Mutex<HashMap<String, PhpLaunchContext>>,
    restart_tokens: Mutex<HashMap<String, u64>>,
    next_restart_token: AtomicU64,
}

impl PhpLanguageServerRegistry {
    pub fn new() -> Self {
        Self {
            registry: LanguageServerRegistry::new_with_label("PHPactor"),
            launch_contexts: Mutex::new(HashMap::new()),
            restart_tokens: Mutex::new(HashMap::new()),
            next_restart_token: AtomicU64::new(1),
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
        if let Err(error) =
            self.store_launch_context_if_active(root_path, command, initialize_request, &status)
        {
            self.registry.stop_if_status(root_path, &status);
            return Err(error);
        }
        Ok(status)
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
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
        if let Err(error) =
            self.store_launch_context_if_active(root_path, command, initialize_request, &status)
        {
            self.registry.stop_if_status(root_path, &status);
            return Err(error);
        }
        Ok(status)
    }

    pub fn stop(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        self.cancel_restart(root_path);
        let status = self.registry.stop(root_path);
        let context = self.remove_launch_context(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_preserving_launch_context(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        self.cancel_restart(root_path);
        let context = self.launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        self.restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        let status = self.registry.stop_all();
        let contexts = self.drain_launch_contexts();

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
    ) -> Result<(), String> {
        if !is_active_status(status) {
            return Ok(());
        }

        let runtime_id = workspace_runtime_id(root_path);
        let session_id = runtime_status_session_id(status).ok_or_else(|| {
            "Language server launch context requires an active session.".to_string()
        })?;
        self.registry.store_launch_context_if_current(
            &runtime_id,
            status,
            &self.launch_contexts,
            PhpLaunchContext {
                command: clone_command(command),
                initialize_request: clone_initialize_request(initialize_request),
                root_path: root_path.to_string(),
                session_id,
            },
        )
    }

    fn remove_launch_context(&self, root_path: &str) -> Option<PhpLaunchContext> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut contexts = self
            .launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        for runtime_id in runtime_ids {
            if let Some(context) = contexts.remove(&runtime_id) {
                return Some(context);
            }
        }

        None
    }

    fn launch_context(&self, root_path: &str) -> Option<PhpLaunchContext> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in runtime_ids {
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
    /// Workspace close invalidates the exact monotonic restart token. The token
    /// is revalidated while reserving the replacement supervisor and again
    /// after startup; a late or ABA restart therefore fails closed and reaps
    /// only the session it started.
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

        let mut restart_token = self.begin_restart(root_path)?;
        let status = self.registry.stop(root_path);
        let removed_context = self.remove_launch_context(root_path);
        self.cleanup_stopped_root(root_path, removed_context);
        let lease = restart_token.reserve_start_cleanup(&self.registry, root_path)?;
        let result = lease
            .start_with_auto_restart(
                &context.command,
                &context.initialize_request,
                spawner,
                LanguageServerEventSinks::new(
                    Arc::clone(&status_sink),
                    diagnostics_sink,
                    workspace_edit_sink,
                    refresh_sink,
                ),
                restart_controller,
            )
            .and_then(|started_status| {
                if let Err(error) = self.store_launch_context_if_active(
                    root_path,
                    &context.command,
                    &context.initialize_request,
                    &started_status,
                ) {
                    self.registry.stop_if_status(root_path, &started_status);
                    return Err(error);
                }
                Ok(started_status)
            });
        let restart_is_current = restart_token.finish();
        if !restart_is_current {
            if let Ok(started_status) = &result {
                self.registry.stop_if_status(root_path, started_status);
                self.remove_launch_context_if_status(root_path, started_status);
            }
            return Err("Language server restart was superseded by workspace stop.".to_string());
        }
        let _ = status;
        result
    }

    fn drain_launch_contexts(&self) -> Vec<(String, PhpLaunchContext)> {
        self.launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
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

    fn begin_restart(&self, root_path: &str) -> Result<RestartToken<'_>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let mut tokens = self
            .restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if tokens.contains_key(&runtime_id) {
            return Err("Language server restart is already in progress.".to_string());
        }
        if tokens.len() >= MAX_LANGUAGE_SERVER_WORKSPACES {
            return Err(LANGUAGE_SERVER_WORKSPACE_CAPACITY_MESSAGE.to_string());
        }
        let generation = self
            .next_restart_token
            .fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |current| current.checked_add(1),
            )
            .map_err(|_| "Language server restart token capacity was exhausted.".to_string())?;
        tokens.insert(runtime_id.clone(), generation);
        Ok(RestartToken {
            tokens: &self.restart_tokens,
            runtime_id,
            generation,
            armed: true,
        })
    }

    fn cancel_restart(&self, root_path: &str) {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut tokens = self
            .restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for runtime_id in runtime_ids {
            tokens.remove(&runtime_id);
        }
    }

    fn remove_launch_context_if_status(
        &self,
        root_path: &str,
        expected_status: &LanguageServerRuntimeStatus,
    ) {
        let Some(expected_session_id) = runtime_status_session_id(expected_status) else {
            return;
        };
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut contexts = self
            .launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for runtime_id in runtime_ids {
            let matches = contexts
                .get(&runtime_id)
                .is_some_and(|context| context.session_id == expected_session_id);
            if matches {
                contexts.remove(&runtime_id);
                return;
            }
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
    pub(super) session_id: u64,
}

impl Clone for JavaScriptTypeScriptLaunchContext {
    fn clone(&self) -> Self {
        Self {
            command: clone_command(&self.command),
            initialize_request: clone_initialize_request(&self.initialize_request),
            root_path: self.root_path.clone(),
            session_id: self.session_id,
        }
    }
}

pub struct JavaScriptTypeScriptLanguageServerRegistry {
    pub(super) registry: LanguageServerRegistry,
    pub(super) launch_contexts: Mutex<HashMap<String, JavaScriptTypeScriptLaunchContext>>,
    pub(super) cleanup_gate: Mutex<bool>,
    pub(super) cleanup_ready: Condvar,
    pub(super) start_replacements: Mutex<HashSet<String>>,
    restart_tokens: Mutex<HashMap<String, u64>>,
    next_restart_token: AtomicU64,
}

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub fn new() -> Self {
        Self {
            registry: LanguageServerRegistry::new_with_label("TypeScript language server"),
            launch_contexts: Mutex::new(HashMap::new()),
            cleanup_gate: Mutex::new(false),
            cleanup_ready: Condvar::new(),
            start_replacements: Mutex::new(HashSet::new()),
            restart_tokens: Mutex::new(HashMap::new()),
            next_restart_token: AtomicU64::new(1),
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
        if let Err(error) =
            self.store_launch_context_if_active(root_path, command, initialize_request, &status)
        {
            self.registry.stop_if_status(root_path, &status);
            return Err(error);
        }
        Ok(status)
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
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
        self.cancel_restart(root_path);
        let status = self.registry.stop(root_path);
        let context = self.remove_launch_context(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_preserving_launch_context(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        self.cancel_restart(root_path);
        let context = self.launch_context(root_path);
        let status = self.registry.stop(root_path);
        self.cleanup_stopped_root(root_path, context);
        status
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        self.restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        let status = self.registry.stop_all();
        let contexts = self.drain_launch_contexts();

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
    ) -> Result<(), String> {
        if !is_active_status(status) {
            return Ok(());
        }

        let runtime_id = workspace_runtime_id(root_path);
        let session_id = runtime_status_session_id(status).ok_or_else(|| {
            "Language server launch context requires an active session.".to_string()
        })?;
        self.registry.store_launch_context_if_current(
            &runtime_id,
            status,
            &self.launch_contexts,
            JavaScriptTypeScriptLaunchContext {
                command: clone_command(command),
                initialize_request: clone_initialize_request(initialize_request),
                root_path: root_path.to_string(),
                session_id,
            },
        )
    }

    fn remove_launch_context(&self, root_path: &str) -> Option<JavaScriptTypeScriptLaunchContext> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut contexts = self
            .launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        for runtime_id in runtime_ids {
            if let Some(context) = contexts.remove(&runtime_id) {
                return Some(context);
            }
        }

        None
    }

    fn launch_context(&self, root_path: &str) -> Option<JavaScriptTypeScriptLaunchContext> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let contexts = self.launch_contexts.lock().ok()?;

        for runtime_id in runtime_ids {
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
    /// Workspace close invalidates the exact monotonic restart token. The token
    /// is revalidated while reserving the replacement supervisor and again
    /// after startup; a late or ABA restart therefore fails closed and reaps
    /// only the session it started.
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

        let mut restart_token = self.begin_restart(root_path)?;
        let stopped_status = self.registry.stop(root_path);
        let removed_context = self.remove_launch_context(root_path);
        self.cleanup_stopped_root(root_path, removed_context);
        status_sink.begin_document_session_replacement()?;
        let lease = restart_token.reserve_start_cleanup(&self.registry, root_path)?;
        let result = lease
            .start_with_auto_restart(
                &context.command,
                &context.initialize_request,
                spawner,
                LanguageServerEventSinks::new(
                    Arc::clone(&status_sink),
                    diagnostics_sink,
                    workspace_edit_sink,
                    refresh_sink,
                ),
                restart_controller,
            )
            .and_then(|started_status| {
                if let Err(error) = self.store_launch_context_if_active(
                    root_path,
                    &context.command,
                    &context.initialize_request,
                    &started_status,
                ) {
                    self.registry.stop_if_status(root_path, &started_status);
                    return Err(error);
                }
                Ok(started_status)
            });
        let restart_is_current = restart_token.finish();
        if !restart_is_current {
            if let Ok(started_status) = &result {
                self.registry.stop_if_status(root_path, started_status);
                self.remove_launch_context_if_status(root_path, started_status);
            }
            return Err("Language server restart was superseded by workspace stop.".to_string());
        }
        let _ = stopped_status;
        result
    }

    fn drain_launch_contexts(&self) -> Vec<(String, JavaScriptTypeScriptLaunchContext)> {
        self.launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
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
            let Some(_cleanup_reservation) = self.try_reserve_cleanup() else {
                return;
            };
            managed_javascript_typescript::cleanup_orphaned_javascript_typescript_processes(
                &context.command,
                &context.initialize_request,
                &context.root_path,
                &self.registry.running_roots(),
            );
        }
    }

    fn begin_restart(&self, root_path: &str) -> Result<RestartToken<'_>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let mut tokens = self
            .restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if tokens.contains_key(&runtime_id) {
            return Err("Language server restart is already in progress.".to_string());
        }
        if tokens.len() >= MAX_LANGUAGE_SERVER_WORKSPACES {
            return Err(LANGUAGE_SERVER_WORKSPACE_CAPACITY_MESSAGE.to_string());
        }
        let generation = self
            .next_restart_token
            .fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |current| current.checked_add(1),
            )
            .map_err(|_| "Language server restart token capacity was exhausted.".to_string())?;
        tokens.insert(runtime_id.clone(), generation);
        Ok(RestartToken {
            tokens: &self.restart_tokens,
            runtime_id,
            generation,
            armed: true,
        })
    }

    fn cancel_restart(&self, root_path: &str) {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut tokens = self
            .restart_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for runtime_id in runtime_ids {
            tokens.remove(&runtime_id);
        }
    }

    fn remove_launch_context_if_status(
        &self,
        root_path: &str,
        expected_status: &LanguageServerRuntimeStatus,
    ) {
        let Some(expected_session_id) = runtime_status_session_id(expected_status) else {
            return;
        };
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut contexts = self
            .launch_contexts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for runtime_id in runtime_ids {
            let matches = contexts
                .get(&runtime_id)
                .is_some_and(|context| context.session_id == expected_session_id);
            if matches {
                contexts.remove(&runtime_id);
                return;
            }
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
            supervisors: Arc::new(Mutex::new(HashMap::new())),
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
        let supervisor = self.supervisor_for(root_path)?;
        let result =
            supervisor.start_with_event_sinks(command, initialize_request, spawner, event_sinks);
        if result.is_err() {
            self.remove_exact_inactive_supervisor(root_path, &supervisor);
        }
        result
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
        let supervisor = self.supervisor_for(root_path)?;
        let result = supervisor.start_with_auto_restart(
            command,
            initialize_request,
            spawner,
            event_sinks,
            restart_controller,
        );
        if result.is_err() {
            self.remove_exact_inactive_supervisor(root_path, &supervisor);
        }
        result
    }

    pub fn stop(&self, root_path: &str) -> LanguageServerRuntimeStatus {
        let supervisor = self.remove_supervisor(root_path);
        supervisor
            .map(|supervisor| supervisor.stop())
            .unwrap_or(LanguageServerRuntimeStatus::Stopped)
    }

    pub fn stop_all(&self) -> LanguageServerRuntimeStatus {
        let supervisors = self.drain_supervisors();
        let mut status = LanguageServerRuntimeStatus::Stopped;
        for supervisor in supervisors {
            status = aggregate_stop_status(status, supervisor.stop());
        }
        status
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
        let supervisors = self
            .supervisors
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

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

    pub(super) fn supervisor_for(
        &self,
        root_path: &str,
    ) -> Result<Arc<LanguageServerSupervisor>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let mut supervisors = self.supervisors.lock().map_err(|error| error.to_string())?;

        if let Some(supervisor) = supervisors.get(&runtime_id) {
            return Ok(Arc::clone(supervisor));
        }
        if supervisors.len() >= MAX_LANGUAGE_SERVER_WORKSPACES {
            return Err(LANGUAGE_SERVER_WORKSPACE_CAPACITY_MESSAGE.to_string());
        }
        let supervisor = Arc::new(LanguageServerSupervisor::new_with_session_id_source(
            self.server_label,
            Arc::clone(&self.next_session_id),
        ));
        supervisors.insert(runtime_id, Arc::clone(&supervisor));
        Ok(supervisor)
    }

    pub(super) fn existing_supervisor(
        &self,
        root_path: &str,
    ) -> Option<Arc<LanguageServerSupervisor>> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let supervisors = self.supervisors.lock().ok()?;

        for runtime_id in runtime_ids {
            if let Some(supervisor) = supervisors.get(&runtime_id) {
                return Some(Arc::clone(supervisor));
            }
        }

        None
    }

    fn remove_supervisor(&self, root_path: &str) -> Option<Arc<LanguageServerSupervisor>> {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let mut supervisors = self
            .supervisors
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        for runtime_id in runtime_ids {
            if let Some(supervisor) = supervisors.remove(&runtime_id) {
                return Some(supervisor);
            }
        }

        None
    }

    fn remove_exact_inactive_supervisor(
        &self,
        root_path: &str,
        expected: &Arc<LanguageServerSupervisor>,
    ) {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let removed = {
            let mut supervisors = self
                .supervisors
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let runtime_id = runtime_ids.into_iter().find(|runtime_id| {
                supervisors
                    .get(runtime_id)
                    .is_some_and(|current| Arc::ptr_eq(current, expected))
            });
            runtime_id.and_then(|runtime_id| {
                if is_active_status(&expected.status()) {
                    None
                } else {
                    supervisors.remove(&runtime_id)
                }
            })
        };
        if let Some(supervisor) = removed {
            supervisor.stop();
        }
    }

    pub(super) fn stop_if_status(
        &self,
        root_path: &str,
        expected_status: &LanguageServerRuntimeStatus,
    ) {
        let runtime_ids = workspace_runtime_id_candidates(root_path);
        let removed = {
            let mut supervisors = self
                .supervisors
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime_ids.into_iter().find_map(|runtime_id| {
                let matches = supervisors
                    .get(&runtime_id)
                    .is_some_and(|supervisor| supervisor.status() == *expected_status);
                matches.then(|| supervisors.remove(&runtime_id)).flatten()
            })
        };
        if let Some(supervisor) = removed {
            supervisor.stop();
        }
    }

    fn drain_supervisors(&self) -> Vec<Arc<LanguageServerSupervisor>> {
        let mut supervisors = self
            .supervisors
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect::<Vec<_>>();
        supervisors.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
        supervisors
            .into_iter()
            .map(|(_, supervisor)| supervisor)
            .collect()
    }

    fn store_launch_context_if_current<T>(
        &self,
        runtime_id: &str,
        expected_status: &LanguageServerRuntimeStatus,
        contexts: &Mutex<HashMap<String, T>>,
        context: T,
    ) -> Result<(), String> {
        let supervisors = self.supervisors.lock().map_err(|error| error.to_string())?;
        let Some(supervisor) = supervisors.get(runtime_id) else {
            return Err(
                "Language server start was superseded before launch context registration."
                    .to_string(),
            );
        };
        if supervisor.status() != *expected_status || !is_active_status(expected_status) {
            return Err(
                "Language server start was superseded before launch context registration."
                    .to_string(),
            );
        }

        let mut contexts = contexts.lock().map_err(|error| error.to_string())?;
        if !contexts.contains_key(runtime_id) && contexts.len() >= MAX_LANGUAGE_SERVER_WORKSPACES {
            return Err(
                "Language server launch context capacity (64) was reached; stop or dispose a retained workspace before starting another."
                    .to_string(),
            );
        }
        contexts.insert(runtime_id.to_string(), context);
        Ok(())
    }
}

impl Drop for LanguageServerRegistry {
    fn drop(&mut self) {
        let supervisors = self.drain_supervisors();

        for supervisor in supervisors {
            supervisor.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp_diagnostics::LanguageServerDiagnosticEvent;
    use std::io;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct NoopStatusSink;

    impl StatusSink for NoopStatusSink {
        fn emit_status(&self, _status: LanguageServerRuntimeStatus) {}
    }

    struct NoopDiagnosticsSink;

    impl DiagnosticsSink for NoopDiagnosticsSink {
        fn emit_diagnostics(&self, _event: LanguageServerDiagnosticEvent) {}
    }

    struct CountingFailingSpawner(Arc<AtomicUsize>);

    impl ServerProcessSpawner for CountingFailingSpawner {
        fn spawn(
            &self,
            _command: &LanguageServerCommand,
        ) -> io::Result<super::super::SpawnedServer> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(io::Error::new(io::ErrorKind::NotFound, "expected failure"))
        }
    }

    fn assert_replacement_token_reaches_exactly_one_spawn(
        mut token: RestartToken<'_>,
        registry: &LanguageServerRegistry,
    ) {
        let lease = token
            .reserve_start_cleanup(registry, "/workspace/a")
            .expect("replacement reservation");
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let command = LanguageServerCommand {
            executable: "missing-language-server".to_string(),
            args: Vec::new(),
            working_directory: "/workspace/a".to_string(),
            env: Vec::new(),
        };
        let initialize_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: serde_json::json!({}),
        };
        let result = lease.start_with_auto_restart(
            &command,
            &initialize_request,
            Arc::new(CountingFailingSpawner(Arc::clone(&spawn_count))),
            LanguageServerEventSinks::new(
                Arc::new(NoopStatusSink),
                Arc::new(NoopDiagnosticsSink),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            Arc::new(RestartController::default()),
        );
        assert!(result.is_err());
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        assert!(token.finish());
    }

    #[test]
    fn stop_all_status_reports_a_cleanup_failure_after_successes() {
        let failure = LanguageServerRuntimeStatus::Crashed {
            message: "Language server cleanup is still pending.".to_string(),
        };

        let status = [
            LanguageServerRuntimeStatus::Stopped,
            LanguageServerRuntimeStatus::Stopped,
            failure.clone(),
        ]
        .into_iter()
        .fold(LanguageServerRuntimeStatus::Stopped, aggregate_stop_status);

        assert_eq!(status, failure);
    }

    #[test]
    fn stop_all_status_preserves_the_first_exact_cleanup_failure() {
        let first_failure = LanguageServerRuntimeStatus::Crashed {
            message: "first exact cleanup failure".to_string(),
        };

        let status = [
            first_failure.clone(),
            LanguageServerRuntimeStatus::Stopped,
            LanguageServerRuntimeStatus::Crashed {
                message: "later cleanup failure".to_string(),
            },
        ]
        .into_iter()
        .fold(LanguageServerRuntimeStatus::Stopped, aggregate_stop_status);

        assert_eq!(status, first_failure);
    }

    #[test]
    fn php_restart_token_rejects_close_gap_and_cannot_remove_aba_replacement() {
        let registry = PhpLanguageServerRegistry::new();
        let first = registry.begin_restart("/workspace/a").expect("first token");
        registry.cancel_restart("/workspace/a");
        let second = registry
            .begin_restart("/workspace/a")
            .expect("replacement token");

        assert!(first
            .reserve_start_cleanup(&registry.registry, "/workspace/a")
            .is_err());
        drop(first);
        assert!(second.is_current());
        assert_replacement_token_reaches_exactly_one_spawn(second, &registry.registry);
    }

    #[test]
    fn typescript_restart_token_rejects_close_gap_and_cannot_remove_aba_replacement() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let first = registry.begin_restart("/workspace/a").expect("first token");
        registry.cancel_restart("/workspace/a");
        let second = registry
            .begin_restart("/workspace/a")
            .expect("replacement token");

        assert!(first
            .reserve_start_cleanup(&registry.registry, "/workspace/a")
            .is_err());
        drop(first);
        assert!(second.is_current());
        assert_replacement_token_reaches_exactly_one_spawn(second, &registry.registry);
    }

    #[test]
    fn php_close_after_restart_reservation_removes_the_exact_reserved_supervisor() {
        let registry = PhpLanguageServerRegistry::new();
        let mut token = registry
            .begin_restart("/workspace/a")
            .expect("restart token");
        let lease = token
            .reserve_start_cleanup(&registry.registry, "/workspace/a")
            .expect("reserve exact supervisor");

        registry.cancel_restart("/workspace/a");
        assert_eq!(
            registry.registry.stop("/workspace/a"),
            LanguageServerRuntimeStatus::Stopped
        );
        drop(lease);
        assert!(!token.finish());
        assert!(registry
            .registry
            .supervisors
            .lock()
            .expect("supervisors")
            .is_empty());
    }

    #[test]
    fn typescript_close_after_restart_reservation_removes_the_exact_reserved_supervisor() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let mut token = registry
            .begin_restart("/workspace/a")
            .expect("restart token");
        let lease = token
            .reserve_start_cleanup(&registry.registry, "/workspace/a")
            .expect("reserve exact supervisor");

        registry.cancel_restart("/workspace/a");
        assert_eq!(
            registry.registry.stop("/workspace/a"),
            LanguageServerRuntimeStatus::Stopped
        );
        drop(lease);
        assert!(!token.finish());
        assert!(registry
            .registry
            .supervisors
            .lock()
            .expect("supervisors")
            .is_empty());
    }
}
