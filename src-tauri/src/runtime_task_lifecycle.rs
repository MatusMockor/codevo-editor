use crate::{
    agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry,
    agent_task_spawner::claude_session_registry::ClaudeSessionRegistry,
    agent_task_supervisor::AgentTaskRegistry,
    node_package_tasks,
    terminal_session::TerminalSupervisor,
    vscode_process_task_commands::VscodeProcessTaskCommandService,
    workspace_file_watcher::WorkspaceFileChangeWatchRegistry,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const AGENT_REQUEST_JOURNAL_FLUSH_TIMEOUT: Duration = Duration::from_secs(1);

pub(crate) trait RuntimeTaskLifecycleExt {
    fn request_stop_all_tasks(&self);
    fn request_stop_workspace_tasks(&self, workspace_id: &WorkspaceId);
}

impl RuntimeTaskLifecycleExt for AppHandle {
    fn request_stop_all_tasks(&self) {
        node_package_tasks::request_stop_all_in_app(self);
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_all();
        }
    }

    fn request_stop_workspace_tasks(&self, workspace_id: &WorkspaceId) {
        node_package_tasks::request_stop_workspace_in_app(self, workspace_id);
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(workspace_id);
        }
    }
}

pub(crate) fn shutdown_runtime_processes(app: &AppHandle) -> Result<(), String> {
    if let Some(clones) = app.try_state::<crate::local_clone::LocalCloneState>() {
        clones.shutdown()?;
    }
    if let Some(streams) = app.try_state::<crate::remote_runner::InventoryStreamState>() {
        streams.shutdown();
    }
    if let Some(runner) = app.try_state::<crate::remote_runner::RemoteRunnerState>() {
        runner.shutdown();
    }
    if let Some(provider_runtime) = app.try_state::<Arc<AgentProviderRuntimeRegistry>>() {
        provider_runtime.close_operation_admission();
    }
    if let Some(logins) =
        app.try_state::<Arc<crate::agent_mcp_server_login_registry::AgentMcpLoginRegistry>>()
    {
        logins.shutdown();
    }
    if let Some(supervisor) = app.try_state::<TerminalSupervisor>() {
        supervisor.stop_all();
    }
    if let Some(provider_runtime) = app.try_state::<Arc<AgentProviderRuntimeRegistry>>() {
        if !provider_runtime.shutdown_operations(Duration::from_secs(2)) {
            return Err("Provider operations did not stop before shutdown.".to_string());
        }
    }
    if let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() {
        agent_tasks.close_start_admission();
    }
    if let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() {
        sessions.close_admission();
    }
    if let Some(registry) = app.try_state::<WorkspaceRegistry>() {
        registry
            .begin_runtime_shutdown()
            .map_err(|error| error.to_string())?;
    }
    if let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() {
        agent_tasks.shutdown_all();
    }
    if let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() {
        sessions.shutdown_all();
    }
    if let Some(hosts) = app.try_state::<Arc<crate::agent_task_spawner::codex_app_server_host::CodexAppServerHostRegistry>>() {
        hosts.drain_for_dispose();
    }
    if let Some(journal) =
        app.try_state::<Arc<crate::agent_runtime_requests::journal::RuntimeRequestJournal>>()
    {
        journal.flush(AGENT_REQUEST_JOURNAL_FLUSH_TIMEOUT);
    }
    app.request_stop_all_tasks();
    if let Some(registry) = app.try_state::<WorkspaceRegistry>() {
        registry.clear();
    }
    if let Some(registry) = app.try_state::<WorkspaceFileChangeWatchRegistry>() {
        registry.stop_all();
    }
    if let Some(supervisor) = app.try_state::<TerminalSupervisor>() {
        supervisor.stop_all();
    }
    Ok(())
}
