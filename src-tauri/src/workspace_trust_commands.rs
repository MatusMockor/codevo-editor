#[path = "workspace_opened_project_trust.rs"]
mod opened_project;

use crate::eslint::EslintProcessRegistry;
use crate::terminal_session::TerminalSupervisor;
use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::vscode_process_task_commands::VscodeProcessTaskCommandService;
use crate::workspace_registry::WorkspaceRegistry;
use crate::{
    agent_trust_revocation, js_test_run, js_test_tasks, js_test_watch, node_package_tasks,
    registered_runtime_root,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub(crate) struct WorkspaceTrustRuntimeState<'a> {
    eslint_processes: State<'a, Arc<EslintProcessRegistry>>,
    terminal_sessions: State<'a, TerminalSupervisor>,
    js_test_batches: State<'a, Arc<js_test_run::batch::JsTestBatchRegistry>>,
}

fn state_from_command<'r, 'de: 'r, T, R>(
    command: &tauri::ipc::CommandItem<'de, R>,
) -> Result<State<'r, T>, tauri::ipc::InvokeError>
where
    T: Send + Sync + 'static,
    R: tauri::Runtime,
{
    <State<'r, T> as tauri::ipc::CommandArg<'de, R>>::from_command(tauri::ipc::CommandItem {
        plugin: command.plugin,
        name: command.name,
        key: command.key,
        message: command.message,
        acl: command.acl,
    })
}

impl<'r, 'de: 'r, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R>
    for WorkspaceTrustRuntimeState<'r>
{
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        Ok(Self {
            eslint_processes: state_from_command(&command)?,
            terminal_sessions: state_from_command(&command)?,
            js_test_batches: state_from_command(&command)?,
        })
    }
}

#[tauri::command]
pub(crate) fn set_workspace_trust(
    root_path: String,
    trusted: bool,
    service: State<'_, Mutex<WorkspaceTrustService>>,
    runtime: WorkspaceTrustRuntimeState<'_>,
    app: AppHandle,
) -> Result<WorkspaceTrustState, String> {
    let workspace_registry = app.state::<WorkspaceRegistry>();
    if trusted {
        let runtime_root = registered_runtime_root(&workspace_registry, &root_path);
        let state = service
            .lock()
            .map_err(|error| error.to_string())?
            .set(&root_path, true)
            .map_err(|error| error.to_string())?;
        runtime.eslint_processes.activate_root(&runtime_root);
        return Ok(state);
    }
    let revocation = agent_trust_revocation::revoke_trust_and_stop_agents(
        &app,
        &service,
        &workspace_registry,
        &root_path,
    )
    .map_err(|error| error.to_string())?;
    if let Some(descriptor) = &revocation.registered {
        node_package_tasks::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        js_test_tasks::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        js_test_watch::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        runtime
            .js_test_batches
            .request_stop_workspace(&descriptor.workspace_id);
        if let Some(service) = app.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(&descriptor.workspace_id);
        }
    }
    revoke_workspace_runtime_trust(
        &revocation.runtime_root,
        &runtime.eslint_processes,
        &runtime.terminal_sessions,
    );
    Ok(revocation.state)
}

fn revoke_workspace_runtime_trust(
    root: &Path,
    eslint_processes: &EslintProcessRegistry,
    terminal_sessions: &TerminalSupervisor,
) {
    eslint_processes.stop_root(root);
    let _ = terminal_sessions.stop_root(root);
}

#[tauri::command]
pub(crate) async fn grant_opened_project_trust(
    target: opened_project::OpenedProjectTrustTarget,
    app: AppHandle,
) -> Result<WorkspaceTrustState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let service = app.state::<Mutex<WorkspaceTrustService>>();
        opened_project::grant(&registry, &service, target, |state| {
            app.state::<Arc<EslintProcessRegistry>>()
                .activate_root(Path::new(&state.root_path));
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
