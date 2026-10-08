#[path = "workspace_opened_project_trust.rs"]
pub(crate) mod opened_project;

use crate::agent_trust_revocation::TrustRevocation;
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
    let revocation = agent_trust_revocation::revoke_path_trust_and_stop_agents(
        &app,
        &service,
        &workspace_registry,
        &root_path,
    )
    .map_err(|error| error.to_string())?;
    Ok(stop_revoked_workspace_runtimes(&app, &runtime, revocation))
}

#[tauri::command]
pub(crate) fn revoke_opened_project_trust(
    target: opened_project::OpenedProjectTrustRevocationTarget,
    service: State<'_, Mutex<WorkspaceTrustService>>,
    runtime: WorkspaceTrustRuntimeState<'_>,
    app: AppHandle,
) -> Result<WorkspaceTrustState, String> {
    let revocation =
        revoke_opened_project(&app, &service, &app.state::<WorkspaceRegistry>(), &target)
            .map_err(|error| error.to_string())?;
    Ok(stop_revoked_workspace_runtimes(&app, &runtime, revocation))
}

pub(crate) fn revoke_opened_project<R: tauri::Runtime>(
    app: &AppHandle<R>,
    trust: &Mutex<WorkspaceTrustService>,
    registry: &WorkspaceRegistry,
    target: &opened_project::OpenedProjectTrustRevocationTarget,
) -> std::io::Result<TrustRevocation> {
    let lease = opened_project::revocation_lease(registry, target)?;
    revoke_leased_project(app, trust, &lease)
}

pub(crate) fn revoke_leased_project<R: tauri::Runtime>(
    app: &AppHandle<R>,
    trust: &Mutex<WorkspaceTrustService>,
    lease: &crate::workspace_registry::WorkspaceRegistrationOperationLease,
) -> std::io::Result<TrustRevocation> {
    let revoked = opened_project::revoke_lease(lease, |root| {
        trust
            .lock()
            .map_err(|_| std::io::Error::other("trust lock failed"))?
            .revoke_opened_canonical_root(root)
    })?;
    Ok(
        agent_trust_revocation::stop_agents_of_revoked_opened_project(
            app,
            revoked.descriptor,
            &revoked.revoked_roots,
        ),
    )
}

fn stop_revoked_workspace_runtimes(
    app: &AppHandle,
    runtime: &WorkspaceTrustRuntimeState<'_>,
    revocation: TrustRevocation,
) -> WorkspaceTrustState {
    if let Some(descriptor) = &revocation.registered {
        node_package_tasks::request_stop_workspace_in_app(app, &descriptor.workspace_id);
        js_test_tasks::request_stop_workspace_in_app(app, &descriptor.workspace_id);
        js_test_watch::request_stop_workspace_in_app(app, &descriptor.workspace_id);
        runtime
            .js_test_batches
            .request_stop_workspace(&descriptor.workspace_id);
        if let Some(service) = app.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(&descriptor.workspace_id);
        }
    }
    if let Some(runtime_root) = &revocation.runtime_root {
        revoke_workspace_runtime_trust(
            runtime_root,
            &runtime.eslint_processes,
            &runtime.terminal_sessions,
        );
    }
    revocation.state
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
