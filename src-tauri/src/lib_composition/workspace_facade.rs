use super::agent_task_commands::claude_session_composition::end_sessions_for_workspace;
use super::agent_task_commands::stop_agent_tasks_on_dispose;
use crate::runtime_task_lifecycle::RuntimeTaskLifecycleExt as _;
use crate::terminal_session::TerminalSupervisor;
use crate::workspace::protected_paths::ProtectedPathPolicy;
use crate::workspace_commands;
use crate::workspace_file_watcher::WorkspaceWatchDisposalGuard;
use crate::workspace_registry::registration::{
    WorkspaceRegistration, WorkspaceRegistrationReceipt,
};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, WorkspaceRuntimeDisposal,
    WorkspaceWatchDisposer,
};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[path = "workspace_facade/unregister.rs"]
mod unregister;
pub(crate) use unregister::dispose_registered_workspace;
pub(crate) use unregister::WorkspaceOwnerCloseResult;
use unregister::{
    release_workspace_owner_with_runtime_cleanup, WorkspaceOwnerClose, WorkspaceOwnerCloseOutcome,
};

#[path = "workspace_facade/lifecycle_commands.rs"]
mod lifecycle_commands;
pub(crate) use lifecycle_commands::{
    adopt_workspace_admission, close_workspace_owner, dispose_workspace_root,
    rollback_workspace_registration, unregister_workspace,
};

#[path = "workspace_facade/file_watch_commands.rs"]
mod file_watch_commands;
pub(crate) use file_watch_commands::{start_workspace_file_watch, stop_workspace_file_watch};

#[cfg(target_os = "macos")]
pub(crate) const CLOSE_ACTIVE_TAB_EVENT: &str = "mockor-close-active-tab";
#[cfg(target_os = "macos")]
pub(crate) const CLOSE_ACTIVE_TAB_MENU_ID: &str = "close-active-tab";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_IN_EVENT: &str = "mockor-window-zoom-in";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_IN_MENU_ID: &str = "window-zoom-in";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_OUT_EVENT: &str = "mockor-window-zoom-out";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_OUT_MENU_ID: &str = "window-zoom-out";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_RESET_EVENT: &str = "mockor-window-zoom-reset";
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ZOOM_RESET_MENU_ID: &str = "window-zoom-reset";
#[cfg(target_os = "macos")]
pub(crate) const OPEN_APPEARANCE_SETTINGS_EVENT: &str = "mockor-open-appearance-settings";
#[cfg(target_os = "macos")]
pub(crate) const OPEN_APPEARANCE_SETTINGS_MENU_ID: &str = "open-appearance-settings";
#[cfg(target_os = "macos")]
pub(crate) const QUIT_APPLICATION_MENU_ID: &str = "quit-application";
#[cfg(target_os = "macos")]
pub(crate) const NATIVE_CLOSE_REQUEST_EVENT: &str = "mockor-native-close-requested";

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum NativeWorkspaceOpenResult {
    Opened {
        descriptor: ManagedWorkspaceDescriptor,
        registration: WorkspaceRegistrationReceipt,
    },
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeWorkspaceRegistration {
    descriptor: ManagedWorkspaceDescriptor,
    registration: WorkspaceRegistrationReceipt,
}

#[tauri::command]
pub(crate) async fn open_workspace_from_picker(
    app: AppHandle,
) -> Result<NativeWorkspaceOpenResult, String> {
    let blocking_app = app.clone();
    let registration = tauri::async_runtime::spawn_blocking(move || {
        let Some(selected_root) = blocking_app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let selected_root = selected_root
            .into_path()
            .map_err(|error| format!("Selected folder is not a local filesystem path: {error}"))?;
        let registry = blocking_app.state::<WorkspaceRegistry>();
        register_picker_path_in_registry(&registry, selected_root).map(Some)
    })
    .await
    .map_err(|error| format!("Workspace picker worker failed: {error}"))??;
    let Some(WorkspaceRegistration {
        descriptor,
        receipt: registration,
    }) = registration
    else {
        return Ok(NativeWorkspaceOpenResult::Cancelled);
    };
    Ok(NativeWorkspaceOpenResult::Opened {
        descriptor,
        registration,
    })
}

pub(crate) fn register_picker_path_in_registry(
    registry: &WorkspaceRegistry,
    selected_root: PathBuf,
) -> Result<WorkspaceRegistration, String> {
    selected_root
        .to_str()
        .ok_or_else(|| "Selected workspace path is not valid UTF-8.".to_string())?;
    registry
        .register_with_receipt(selected_root)
        .map_err(|error| error.to_string())
}

pub(crate) fn register_workspace_path_in_registry(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<WorkspaceRegistration, String> {
    if Path::new(root_path).is_relative() {
        return Err("Workspace root path must be absolute".to_string());
    }

    registry
        .register_with_receipt(root_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn register_workspace_path(
    app: AppHandle,
    root_path: String,
) -> Result<NativeWorkspaceRegistration, String> {
    if Path::new(&root_path).is_relative() {
        return Err("Workspace root path must be absolute".to_string());
    }
    let blocking_app = app.clone();
    let registration = tauri::async_runtime::spawn_blocking(move || {
        let registry = blocking_app.state::<WorkspaceRegistry>();
        register_workspace_path_in_registry(&registry, &root_path)
    })
    .await
    .map_err(|error| format!("Workspace registration worker failed: {error}"))??;
    Ok(NativeWorkspaceRegistration {
        descriptor: registration.descriptor,
        registration: registration.receipt,
    })
}

fn close_workspace_owner_blocking(
    app: &AppHandle,
    state: WorkspaceLifecycleState<'_>,
    close: WorkspaceOwnerClose<'_>,
    watch_disposer: &dyn WorkspaceWatchDisposer,
) -> Result<WorkspaceOwnerCloseResult, String> {
    let workspace_id = close.workspace_id.clone();
    let closed = release_workspace_owner_with_runtime_cleanup(
        &state.workspace_registry,
        close,
        WorkspaceRuntimeDisposal {
            workspace_file_change_watch_registry: watch_disposer,
            terminal_sessions: &*state.terminal_sessions,
        },
        |descriptor| {
            watch_disposer.stop_workspace_watch(&descriptor.canonical_root_path.to_string_lossy());
            state.file_search_lifecycle.cancel_workspace(&workspace_id);
            app.request_stop_workspace_tasks(&workspace_id);
            end_sessions_for_workspace(app, workspace_id.as_str());
        },
        |_, _| {},
    );
    let outcome = closed.map_err(|error| format!("Workspace unregister failed: {error}"))?;
    if let WorkspaceOwnerCloseOutcome::Released(cleanup_errors) = &outcome {
        if !cleanup_errors.is_empty() {
            eprintln!(
                "Workspace unregister completed with cleanup warnings: {}",
                cleanup_errors.join("\n")
            );
        }
    }
    Ok(WorkspaceOwnerCloseResult::from(&outcome))
}

pub(crate) struct WorkspaceLifecycleState<'a> {
    terminal_sessions: State<'a, TerminalSupervisor>,
    workspace_registry: State<'a, WorkspaceRegistry>,
    file_search_lifecycle: State<'a, workspace_commands::WorkspaceFileSearchLifecycle>,
}

impl<'a> WorkspaceLifecycleState<'a> {
    pub(crate) fn from_app(app: &'a AppHandle) -> Self {
        Self {
            terminal_sessions: app.state(),
            workspace_registry: app.state(),
            file_search_lifecycle: app.state(),
        }
    }
}

pub(crate) fn state_from_command<'r, 'de: 'r, T, R>(
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
    for WorkspaceLifecycleState<'r>
{
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        Ok(Self {
            terminal_sessions: state_from_command(&command)?,
            workspace_registry: state_from_command(&command)?,
            file_search_lifecycle: state_from_command(&command)?,
        })
    }
}

pub(crate) fn dispose_workspace_root_blocking(
    root_path: String,
    app: &AppHandle,
    state: WorkspaceLifecycleState<'_>,
    watch_disposal: &WorkspaceWatchDisposalGuard<'_>,
) -> Result<(), String> {
    watch_disposal.stop_watches_before_arrival();
    let root = registered_runtime_root(&state.workspace_registry, &root_path);
    let descriptor = state
        .workspace_registry
        .descriptor_for_registered_path(&root)
        .ok();
    stop_agent_tasks_on_dispose(
        app,
        descriptor
            .as_ref()
            .map(|descriptor| descriptor.workspace_id.as_str()),
        &root,
    );
    if let Some(descriptor) = descriptor {
        state
            .file_search_lifecycle
            .cancel_workspace(&descriptor.workspace_id);
        app.request_stop_workspace_tasks(&descriptor.workspace_id);
    }
    dispose_workspace_runtime_root(
        &root,
        WorkspaceRuntimeDisposal {
            workspace_file_change_watch_registry: watch_disposal,
            terminal_sessions: &*state.terminal_sessions,
        },
    )
}

#[tauri::command]
pub(crate) fn reveal_item_in_dir(
    root_path: String,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let target = reveal_path_in_workspace(&root_path, &path)?;

    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|error| format!("Failed to reveal item: {error}"))
}

pub(crate) fn registered_runtime_root(registry: &WorkspaceRegistry, root_path: &str) -> PathBuf {
    registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map(|descriptor| descriptor.canonical_root_path)
        .unwrap_or_else(|_| workspace_root_for_disposal(root_path))
}

pub(crate) fn canonicalize_workspace_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    ProtectedPathPolicy::current()
        .check_workspace_root(&root)
        .map_err(|refusal| refusal.to_string())?;
    Ok(root)
}

pub(crate) fn workspace_root_for_disposal(root_path: &str) -> PathBuf {
    let root = PathBuf::from(root_path);

    root.canonicalize()
        .unwrap_or_else(|_| normalize_path(&root))
}

pub(crate) fn reveal_path_in_workspace(root_path: &str, path: &str) -> Result<PathBuf, String> {
    let root = canonicalize_workspace_root(root_path)?;
    let requested_path = PathBuf::from(path);

    if !requested_path.is_absolute() {
        return Err("Reveal path must be absolute.".to_string());
    }

    let target = requested_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve reveal path: {error}"))?;

    if target.starts_with(&root) {
        return Ok(target);
    }

    Err("Path is outside the workspace root.".to_string())
}

pub(crate) fn normalize_path(path: &Path) -> PathBuf {
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
