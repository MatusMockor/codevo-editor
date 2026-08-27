use crate::{
    agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry,
    agent_task_supervisor::AgentTaskRegistry,
    debug_adapter::DebugSessionRegistry,
    eslint,
    job_scheduler::WorkspaceIndexLifecycle,
    js_test_run, js_test_tasks, js_test_watch,
    js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry,
    lsp_session::{JavaScriptTypeScriptLanguageServerRegistry, PhpLanguageServerRegistry},
    node_package_tasks, node_run_tasks,
    terminal_session::TerminalSupervisor,
    vscode_process_task_commands::VscodeProcessTaskCommandService,
    workspace_file_watcher::WorkspaceFileChangeWatchRegistry,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
    LegacyLocalHistoryWorkspaceAuthorizer,
};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub(crate) trait RuntimeTaskLifecycleExt {
    fn request_stop_all_tasks(&self, js_test_batches: &js_test_run::batch::JsTestBatchRegistry);
    fn request_stop_workspace_tasks(
        &self,
        workspace_id: &WorkspaceId,
        js_test_batches: &js_test_run::batch::JsTestBatchRegistry,
    );
}

impl RuntimeTaskLifecycleExt for AppHandle {
    fn request_stop_all_tasks(&self, js_test_batches: &js_test_run::batch::JsTestBatchRegistry) {
        node_package_tasks::request_stop_all_in_app(self);
        node_run_tasks::request_stop_all_in_app(self);
        js_test_tasks::request_stop_all_in_app(self);
        js_test_watch::request_stop_all_in_app(self);
        js_test_batches.stop_all();
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_all();
        }
    }

    fn request_stop_workspace_tasks(
        &self,
        workspace_id: &WorkspaceId,
        js_test_batches: &js_test_run::batch::JsTestBatchRegistry,
    ) {
        node_package_tasks::request_stop_workspace_in_app(self, workspace_id);
        node_run_tasks::request_stop_workspace_in_app(self, workspace_id);
        js_test_tasks::request_stop_workspace_in_app(self, workspace_id);
        js_test_watch::request_stop_workspace_in_app(self, workspace_id);
        js_test_batches.request_stop_workspace(workspace_id);
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(workspace_id);
        }
    }
}

pub(crate) fn shutdown_runtime_processes(
    app: &AppHandle,
    js_test_batches: &js_test_run::batch::JsTestBatchRegistry,
) -> Result<(), String> {
    if let Some(provider_runtime) = app.try_state::<Arc<AgentProviderRuntimeRegistry>>() {
        if !provider_runtime.shutdown_operations(Duration::from_secs(2)) {
            return Err("Provider operations did not stop before shutdown.".to_string());
        }
    }
    if let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() {
        agent_tasks.close_start_admission();
    }
    if let Some(registry) = app.try_state::<WorkspaceRegistry>() {
        registry
            .begin_runtime_shutdown()
            .map_err(|error| error.to_string())?;
    }
    if let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() {
        agent_tasks.shutdown_all();
    }
    app.request_stop_all_tasks(js_test_batches);
    if let Some(authorizer) = app.try_state::<LegacyLocalHistoryWorkspaceAuthorizer>() {
        authorizer.clear();
    }
    if let Some(registry) = app.try_state::<WorkspaceRegistry>() {
        registry.clear();
    }
    if let Some(index_lifecycle) = app.try_state::<WorkspaceIndexLifecycle>() {
        index_lifecycle.cancel_all();
    }
    if let Some(registry) = app.try_state::<JavaScriptTypeScriptWorkspaceWatchRegistry>() {
        registry.stop_all();
    }
    if let Some(registry) = app.try_state::<WorkspaceFileChangeWatchRegistry>() {
        registry.stop_all();
    }
    if let Some(registry) = app.try_state::<PhpLanguageServerRegistry>() {
        let _ = registry.stop_all();
    }
    if let Some(registry) = app.try_state::<JavaScriptTypeScriptLanguageServerRegistry>() {
        let _ = registry.stop_all();
    }
    if let Some(registry) = app.try_state::<Arc<DebugSessionRegistry>>() {
        registry.stop_all();
    }
    if let Some(supervisor) = app.try_state::<TerminalSupervisor>() {
        supervisor.stop_all();
    }
    if let Some(registry) = app.try_state::<Arc<eslint::EslintProcessRegistry>>() {
        registry.stop_all();
    }
    Ok(())
}
