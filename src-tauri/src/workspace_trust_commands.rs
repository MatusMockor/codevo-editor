use crate::debug_adapter::DebugSessionRegistry;
use crate::debug_cdp::NodeAttachCandidatePublicationRegistry;
use crate::eslint::EslintProcessRegistry;
use crate::terminal_session::TerminalSupervisor;
use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::vscode_process_task_commands::VscodeProcessTaskCommandService;
use crate::workspace_registry::WorkspaceRegistry;
use crate::{
    js_test_run, js_test_tasks, js_test_watch, node_package_tasks, node_run_tasks,
    registered_runtime_root,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub(crate) struct WorkspaceTrustRuntimeState<'a> {
    eslint_processes: State<'a, Arc<EslintProcessRegistry>>,
    debug_sessions: State<'a, Arc<DebugSessionRegistry>>,
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
            debug_sessions: state_from_command(&command)?,
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
    let node_attach_candidates = app.state::<Arc<NodeAttachCandidatePublicationRegistry>>();
    let runtime_root = registered_runtime_root(&workspace_registry, &root_path);
    let mut service = service.lock().map_err(|error| error.to_string())?;
    let state = service
        .set(&root_path, trusted)
        .map_err(|error| error.to_string())?;
    node_attach_candidates
        .invalidate_listings()
        .map_err(|_| "Workspace trust transition failed.".to_string())?;
    if trusted {
        drop(service);
        runtime.eslint_processes.activate_root(&runtime_root);
        runtime
            .debug_sessions
            .activate_root(&runtime_root.to_string_lossy());
        return Ok(state);
    }
    runtime
        .debug_sessions
        .deactivate_root(&runtime_root.to_string_lossy());
    drop(service);
    if let Ok(descriptor) = workspace_registry.descriptor_for_registered_path(&runtime_root) {
        node_package_tasks::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        node_run_tasks::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        js_test_tasks::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        js_test_watch::request_stop_workspace_in_app(&app, &descriptor.workspace_id);
        runtime
            .js_test_batches
            .request_stop_workspace(&descriptor.workspace_id);
        if let Some(service) = app.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(&descriptor.workspace_id);
        }
    }
    revoke_workspace_non_debug_trust(
        &runtime_root,
        &runtime.eslint_processes,
        &runtime.terminal_sessions,
    );
    Ok(state)
}

#[cfg(test)]
pub(crate) fn revoke_workspace_runtime_trust(
    root: &Path,
    eslint_processes: &EslintProcessRegistry,
    debug_sessions: &DebugSessionRegistry,
    terminal_sessions: &TerminalSupervisor,
) {
    debug_sessions.deactivate_root(&root.to_string_lossy());
    revoke_workspace_non_debug_trust(root, eslint_processes, terminal_sessions);
}

fn revoke_workspace_non_debug_trust(
    root: &Path,
    eslint_processes: &EslintProcessRegistry,
    terminal_sessions: &TerminalSupervisor,
) {
    eslint_processes.stop_root(root);
    let _ = terminal_sessions.stop_root(root);
}
