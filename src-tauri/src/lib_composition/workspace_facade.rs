use super::language_runtime_facade::registered_runtime_root;
use crate::blocking_command::run_blocking_command;
use crate::debug_adapter::DebugSessionRegistry;
use crate::debug_cdp;
use crate::eslint;
use crate::file_uri_path::path_from_file_uri;
use crate::index::{
    workspace_index_path, SqliteWorkspaceIndex, WorkspaceFileRecord,
    WorkspaceIndexMaintenanceStore, WorkspaceIndexStore, WorkspaceIndexSummary,
};
use crate::index_reindex::{
    LocalWorkspaceReindexStarter, WorkspaceReindexRequest, WorkspaceReindexStarter,
};
use crate::index_scan::{
    IndexProgressEvent, InitialMetadataScanStart, MetadataScanCompletionEvent,
    MetadataScanEventSink, WorkspaceReindexMode, INDEX_PROGRESS_EVENT,
    METADATA_SCAN_COMPLETED_EVENT,
};
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_test_run::batch::JsTestBatchRegistry;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::local_history::LocalHistoryStore;
use crate::lsp_document::{TextDocumentContent, TextDocumentPath};
use crate::lsp_features::{
    parse_definition_result, LanguageServerCallHierarchyItem, LanguageServerCodeAction,
    LanguageServerCodeActionCommand, LanguageServerCodeActionContext, LanguageServerCodeLens,
    LanguageServerCompletionItem, LanguageServerCompletionList, LanguageServerDocumentLink,
    LanguageServerIncomingCall, LanguageServerInlayHint, LanguageServerInlayHintLabel,
    LanguageServerLocation, LanguageServerOutgoingCall, LanguageServerTypeHierarchyItem,
    LanguageServerWorkspaceEdit, LanguageServerWorkspaceSymbol, TextDocumentPosition,
};
use crate::lsp_incremental_document::{
    canonical_document_identity as canonical_lsp_document_identity, DocumentChangeAdmissionRegistry,
};
use crate::lsp_session::{JavaScriptTypeScriptLanguageServerRegistry, PhpLanguageServerRegistry};
use crate::lsp_workspace_edit_guard::{
    ensure_lsp_workspace_edit_paths_in_workspace, workspace_file_operation_uris,
};
use crate::php_file_outline::{
    build_php_file_outline, php_symbol_outline_record, PhpFileOutline, PhpFileOutlineSymbolRecord,
};
use crate::php_parser::{PhpSyntaxDiagnostic, PhpSyntaxParser, TreeSitterPhpParser};
use crate::php_symbols::{PhpSymbolExtractor, TreeSitterPhpSymbolExtractor};
use crate::runtime_task_lifecycle::RuntimeTaskLifecycleExt as _;
use crate::smart_mode::SmartModeService;
use crate::terminal_session::TerminalSupervisor;
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use crate::workspace_registry::registration::{
    WorkspaceRegistration, WorkspaceRegistrationReceipt,
};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, WorkspaceRuntimeDisposal,
};
use crate::{workspace_commands, workspace_file_watcher};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[path = "workspace_facade/unregister.rs"]
mod unregister;
use unregister::{unregister_workspace_with_runtime_cleanup, NoopDebugSessionDisposer};

#[cfg(target_os = "macos")]
pub(crate) const CLOSE_ACTIVE_TAB_EVENT: &str = "mockor-close-active-tab";
#[cfg(target_os = "macos")]
pub(crate) const CLOSE_ACTIVE_TAB_MENU_ID: &str = "close-active-tab";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_IN_EVENT: &str = "mockor-editor-font-zoom-in";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_IN_MENU_ID: &str = "font-zoom-in";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_OUT_EVENT: &str = "mockor-editor-font-zoom-out";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_OUT_MENU_ID: &str = "font-zoom-out";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_RESET_EVENT: &str = "mockor-editor-font-zoom-reset";
#[cfg(target_os = "macos")]
pub(crate) const FONT_ZOOM_RESET_MENU_ID: &str = "font-zoom-reset";
#[cfg(target_os = "macos")]
pub(crate) const OPEN_APPEARANCE_SETTINGS_EVENT: &str = "mockor-open-appearance-settings";
#[cfg(target_os = "macos")]
pub(crate) const OPEN_APPEARANCE_SETTINGS_MENU_ID: &str = "open-appearance-settings";
#[cfg(target_os = "macos")]
pub(crate) const QUIT_APPLICATION_MENU_ID: &str = "quit-application";
#[cfg(target_os = "macos")]
pub(crate) const NATIVE_CLOSE_REQUEST_EVENT: &str = "mockor-native-close-requested";
#[cfg(target_os = "macos")]
pub(crate) const TOGGLE_FONT_LIGATURES_EVENT: &str = "mockor-toggle-font-ligatures";
#[cfg(target_os = "macos")]
pub(crate) const TOGGLE_FONT_LIGATURES_MENU_ID: &str = "toggle-font-ligatures";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceIndexClearResult {
    database_path: String,
    root_path: String,
    status: &'static str,
}

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

/// Temporary authorization bridge for legacy Local History commands that still
/// receive a raw root path. Entries originate only from descriptors admitted by
/// `WorkspaceRegistry`; the registry remains the authority for liveness.
#[derive(Default)]
pub(crate) struct LegacyLocalHistoryWorkspaceAuthorizer {
    descriptors: Mutex<HashMap<WorkspaceId, ManagedWorkspaceDescriptor>>,
}

impl LegacyLocalHistoryWorkspaceAuthorizer {
    fn descriptors(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<WorkspaceId, ManagedWorkspaceDescriptor>> {
        self.descriptors
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    pub(crate) fn admit(&self, descriptor: &ManagedWorkspaceDescriptor) {
        self.descriptors()
            .insert(descriptor.workspace_id.clone(), descriptor.clone());
    }

    pub(crate) fn revoke(&self, workspace_id: &WorkspaceId) {
        self.descriptors().remove(workspace_id);
    }

    pub(crate) fn clear(&self) {
        self.descriptors().clear();
    }

    pub(crate) fn authorize(
        &self,
        registry: &WorkspaceRegistry,
        root_path: &str,
    ) -> Result<String, String> {
        let requested_root = canonicalize_workspace_root(root_path)?;
        let workspace_id = self
            .descriptors()
            .iter()
            .find_map(|(workspace_id, descriptor)| {
                (descriptor.canonical_root_path == requested_root).then_some(workspace_id.clone())
            })
            .ok_or_else(|| "Local history workspace is not open.".to_string())?;
        let live_descriptor = registry
            .descriptor(&workspace_id)
            .map_err(|_| "Local history workspace is not open.".to_string())?;

        if live_descriptor.canonical_root_path != requested_root {
            return Err("Local history workspace identity changed.".to_string());
        }

        // Keep the legacy on-disk layout compatible for canonical-root buckets,
        // but never fall back to a caller alias. Historical alias buckets have
        // no owner metadata, so adopting them automatically could expose a
        // previous workspace after the alias is retargeted. They remain
        // quarantined until a future explicit, ownership-proven migration.
        requested_root
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| "Local history workspace path is not valid UTF-8.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn open_workspace_from_picker(
    app: AppHandle,
    local_history_authorizer: State<'_, LegacyLocalHistoryWorkspaceAuthorizer>,
    eslint_processes: State<'_, Arc<eslint::EslintProcessRegistry>>,
    debug_sessions: State<'_, Arc<DebugSessionRegistry>>,
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
    eslint_processes.activate_root(&descriptor.canonical_root_path);
    debug_sessions.activate_root(&descriptor.canonical_root_path.to_string_lossy());
    local_history_authorizer.admit(&descriptor);
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
    local_history_authorizer: State<'_, LegacyLocalHistoryWorkspaceAuthorizer>,
    eslint_processes: State<'_, Arc<eslint::EslintProcessRegistry>>,
    debug_sessions: State<'_, Arc<DebugSessionRegistry>>,
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
    let descriptor = &registration.descriptor;
    eslint_processes.activate_root(&descriptor.canonical_root_path);
    debug_sessions.activate_root(&descriptor.canonical_root_path.to_string_lossy());
    local_history_authorizer.admit(descriptor);
    Ok(NativeWorkspaceRegistration {
        descriptor: registration.descriptor,
        registration: registration.receipt,
    })
}

#[tauri::command]
pub(crate) fn rollback_workspace_registration(
    registry: State<'_, WorkspaceRegistry>,
    local_history_authorizer: State<'_, LegacyLocalHistoryWorkspaceAuthorizer>,
    eslint_processes: State<'_, Arc<eslint::EslintProcessRegistry>>,
    debug_sessions: State<'_, Arc<DebugSessionRegistry>>,
    workspace_id: WorkspaceId,
    admission_token: u64,
) -> Result<bool, String> {
    let rollback = registry
        .rollback_registration(&workspace_id, admission_token)
        .map_err(|error| error.to_string())?;
    let Some(mut rollback) = rollback else {
        return Ok(false);
    };
    if rollback.removed_identity {
        rollback.begin_cleanup();
        eslint_processes.stop_root(&rollback.descriptor.canonical_root_path);
        debug_sessions.deactivate_root(&rollback.descriptor.canonical_root_path.to_string_lossy());
    }
    let removed_identity = rollback.removed_identity;
    rollback.finalize().map_err(|error| error.to_string())?;
    if removed_identity {
        local_history_authorizer.revoke(&workspace_id);
    }
    Ok(true)
}

#[tauri::command]
pub(crate) fn unregister_workspace(
    app: AppHandle,
    state: WorkspaceLifecycleState<'_>,
    workspace_id: WorkspaceId,
) -> Result<(), String> {
    let mut errors = Vec::new();
    state.file_search_lifecycle.cancel_workspace(&workspace_id);
    if state.node_attach_candidates.invalidate_listings().is_err() {
        errors.push("Node attach candidate invalidation failed.".to_string());
    }
    let mut debug_deactivation = None;
    let unregister = unregister_workspace_with_runtime_cleanup(
        &state.workspace_registry,
        &workspace_id,
        WorkspaceRuntimeDisposal {
            index_lifecycle: &*state.index_lifecycle,
            javascript_typescript_language_servers: &*state.javascript_typescript_language_servers,
            javascript_typescript_watch_registry: &*state.javascript_typescript_watch_registry,
            workspace_file_change_watch_registry: &*state.workspace_file_change_watch_registry,
            php_language_servers: &*state.php_language_servers,
            debug_sessions: &NoopDebugSessionDisposer,
            eslint_processes: &**state.eslint_processes,
            terminal_sessions: &*state.terminal_sessions,
        },
        |descriptor| {
            debug_deactivation = Some(
                state
                    .debug_sessions
                    .begin_root_deactivation(&descriptor.canonical_root_path.to_string_lossy()),
            );
            app.request_stop_workspace_tasks(&workspace_id, &state.js_test_batches);
        },
        |descriptor, cleanup_errors| {
            if let Err(error) = state
                .document_change_admission
                .purge_root(&descriptor.canonical_root_path.to_string_lossy())
            {
                cleanup_errors.push(format!("Document change admission cleanup failed: {error}"));
            }
            match state.smart_mode_service.lock() {
                Ok(mut smart_mode) => {
                    smart_mode.remove_workspace(&descriptor.canonical_root_path.to_string_lossy())
                }
                Err(error) => {
                    cleanup_errors.push(format!("Smart mode cleanup failed: {error}"));
                }
            }
        },
    );
    if let Some(deactivation) = debug_deactivation {
        DebugSessionRegistry::complete_root_deactivation(deactivation);
    }
    let unregister_error = match unregister {
        Ok(mut cleanup_errors) => {
            errors.append(&mut cleanup_errors);
            state.local_history_authorizer.revoke(&workspace_id);
            None
        }
        Err(error) => Some(format!("Workspace unregister failed: {error}")),
    };
    if !errors.is_empty() {
        eprintln!(
            "Workspace unregister completed with cleanup warnings: {}",
            errors.join("\n")
        );
    }
    unregister_error.map_or(Ok(()), Err)
}

pub(crate) struct WorkspaceLifecycleState<'a> {
    index_lifecycle: State<'a, WorkspaceIndexLifecycle>,
    javascript_typescript_language_servers: State<'a, JavaScriptTypeScriptLanguageServerRegistry>,
    javascript_typescript_watch_registry: State<'a, JavaScriptTypeScriptWorkspaceWatchRegistry>,
    document_change_admission: State<'a, DocumentChangeAdmissionRegistry>,
    workspace_file_change_watch_registry: State<'a, WorkspaceFileChangeWatchRegistry>,
    php_language_servers: State<'a, PhpLanguageServerRegistry>,
    debug_sessions: State<'a, Arc<DebugSessionRegistry>>,
    node_attach_candidates: State<'a, Arc<debug_cdp::NodeAttachCandidatePublicationRegistry>>,
    smart_mode_service: State<'a, Mutex<SmartModeService>>,
    terminal_sessions: State<'a, TerminalSupervisor>,
    eslint_processes: State<'a, Arc<eslint::EslintProcessRegistry>>,
    workspace_registry: State<'a, WorkspaceRegistry>,
    file_search_lifecycle: State<'a, workspace_commands::WorkspaceFileSearchLifecycle>,
    js_test_batches: State<'a, Arc<JsTestBatchRegistry>>,
    local_history_authorizer: State<'a, LegacyLocalHistoryWorkspaceAuthorizer>,
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
            index_lifecycle: state_from_command(&command)?,
            javascript_typescript_language_servers: state_from_command(&command)?,
            javascript_typescript_watch_registry: state_from_command(&command)?,
            document_change_admission: state_from_command(&command)?,
            workspace_file_change_watch_registry: state_from_command(&command)?,
            php_language_servers: state_from_command(&command)?,
            debug_sessions: state_from_command(&command)?,
            node_attach_candidates: state_from_command(&command)?,
            smart_mode_service: state_from_command(&command)?,
            terminal_sessions: state_from_command(&command)?,
            eslint_processes: state_from_command(&command)?,
            workspace_registry: state_from_command(&command)?,
            file_search_lifecycle: state_from_command(&command)?,
            js_test_batches: state_from_command(&command)?,
            local_history_authorizer: state_from_command(&command)?,
        })
    }
}

#[tauri::command]
pub(crate) fn dispose_workspace_root(
    root_path: String,
    app: AppHandle,
    state: WorkspaceLifecycleState<'_>,
) -> Result<(), String> {
    state
        .node_attach_candidates
        .invalidate_listings()
        .map_err(|_| "Node attach candidate invalidation failed.".to_string())?;
    let root = registered_runtime_root(&state.workspace_registry, &root_path);
    if let Ok(descriptor) = state
        .workspace_registry
        .descriptor_for_registered_path(&root)
    {
        state
            .file_search_lifecycle
            .cancel_workspace(&descriptor.workspace_id);
        app.request_stop_workspace_tasks(&descriptor.workspace_id, &state.js_test_batches);
    }
    let root_key = root.to_string_lossy().into_owned();
    state.document_change_admission.purge_root(&root_key)?;
    state.debug_sessions.deactivate_root(&root_key);
    let disposal_result = dispose_workspace_runtime_root(
        &root,
        WorkspaceRuntimeDisposal {
            index_lifecycle: &*state.index_lifecycle,
            javascript_typescript_language_servers: &*state.javascript_typescript_language_servers,
            javascript_typescript_watch_registry: &*state.javascript_typescript_watch_registry,
            workspace_file_change_watch_registry: &*state.workspace_file_change_watch_registry,
            php_language_servers: &*state.php_language_servers,
            debug_sessions: &**state.debug_sessions,
            eslint_processes: &**state.eslint_processes,
            terminal_sessions: &*state.terminal_sessions,
        },
    );
    state
        .smart_mode_service
        .lock()
        .map_err(|error| error.to_string())?
        .remove_workspace(&root_key);
    disposal_result
}

#[tauri::command]
pub(crate) async fn parse_php_syntax(source: String) -> Result<Vec<PhpSyntaxDiagnostic>, String> {
    // Parse off the WebView main thread.
    run_blocking_command(move || parse_php_syntax_blocking(&source)).await
}

pub(crate) fn parse_php_syntax_blocking(source: &str) -> Result<Vec<PhpSyntaxDiagnostic>, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(source).map_err(|error| error.to_string())?;
    Ok(tree.diagnostics())
}

#[tauri::command]
pub(crate) async fn parse_php_file_outline(
    path: String,
    source: String,
) -> Result<PhpFileOutline, String> {
    // tree-sitter parse + symbol extraction is the heaviest per-open command;
    // keep it off the main thread.
    run_blocking_command(move || parse_php_file_outline_blocking(&path, &source)).await
}

pub(crate) fn parse_php_file_outline_blocking(
    path: &str,
    source: &str,
) -> Result<PhpFileOutline, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(source).map_err(|error| error.to_string())?;
    let extractor = TreeSitterPhpSymbolExtractor;
    let symbols = extractor.extract(&tree, source);
    let relative_path = path_file_label(path);
    let records: Vec<PhpFileOutlineSymbolRecord> = symbols
        .into_iter()
        .map(|symbol| php_symbol_outline_record(symbol, path, &relative_path))
        .collect();

    Ok(build_php_file_outline(&records))
}

#[tauri::command]
pub(crate) fn initialize_workspace_index(
    root_path: String,
    app: AppHandle,
) -> Result<WorkspaceIndexSummary, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    let index = open_workspace_index(&app, &root)?;
    index.summary().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn start_workspace_file_watch(
    root_path: String,
    app: AppHandle,
    workspace_file_change_watch_registry: State<'_, WorkspaceFileChangeWatchRegistry>,
) -> Result<workspace_file_watcher::WorkspaceFileWatchStartReceipt, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    workspace_file_change_watch_registry.start(&root.to_string_lossy(), app)
}

#[tauri::command]
pub(crate) fn stop_workspace_file_watch(
    root_path: String,
    watch_generation: u64,
    workspace_file_change_watch_registry: State<'_, WorkspaceFileChangeWatchRegistry>,
) -> Result<bool, String> {
    if root_path.len() > 32_768 || root_path.contains('\0') || Path::new(&root_path).is_relative() {
        return Err("Workspace watcher stop root is invalid.".to_string());
    }
    Ok(workspace_file_change_watch_registry.stop_generation(&root_path, watch_generation))
}

#[tauri::command]
pub(crate) fn upsert_workspace_index_file(
    root_path: String,
    record: WorkspaceFileRecord,
    app: AppHandle,
) -> Result<WorkspaceIndexSummary, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    ensure_path_in_workspace(&root, &record.path)?;
    let index = open_workspace_index(&app, &root)?;
    index
        .upsert_file(&record)
        .map_err(|error| error.to_string())?;
    index.summary().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn remove_workspace_index_file(
    root_path: String,
    path: String,
    app: AppHandle,
) -> Result<WorkspaceIndexSummary, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    ensure_path_in_workspace(&root, &path)?;
    let index = open_workspace_index(&app, &root)?;
    index
        .remove_file(&path)
        .map_err(|error| error.to_string())?;
    index.summary().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn clear_workspace_index(
    root_path: String,
    app: AppHandle,
) -> Result<WorkspaceIndexClearResult, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    let root_string = root.to_string_lossy().to_string();

    if let Some(index_lifecycle) = app.try_state::<WorkspaceIndexLifecycle>() {
        return index_lifecycle.cancel_workspace_and_block_writes(&root_string, || {
            clear_workspace_index_database(&app, &root)
        });
    }

    clear_workspace_index_database(&app, &root)
}

pub(crate) fn clear_workspace_index_database(
    app: &AppHandle,
    root: &Path,
) -> Result<WorkspaceIndexClearResult, String> {
    let database_path = workspace_index_database_path(app, root)?;
    let index = SqliteWorkspaceIndex::open(&database_path).map_err(|error| error.to_string())?;
    index
        .clear_workspace_files()
        .map_err(|error| error.to_string())?;

    Ok(WorkspaceIndexClearResult {
        database_path: database_path.to_string_lossy().to_string(),
        root_path: root.to_string_lossy().to_string(),
        status: "cleared",
    })
}

#[tauri::command]
pub(crate) fn start_initial_metadata_scan(
    root_path: String,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    start_workspace_reindex(root_path, WorkspaceReindexMode::Soft, None, app)
}

#[tauri::command]
pub(crate) fn start_workspace_reindex(
    root_path: String,
    mode: WorkspaceReindexMode,
    language: Option<String>,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    let database_path = workspace_index_database_path(&app, &root)?;
    let root_string = root.to_string_lossy().to_string();
    let lifecycle_token = app
        .try_state::<WorkspaceIndexLifecycle>()
        .map(|lifecycle| lifecycle.begin_workspace_run(&root_string));
    let starter = LocalWorkspaceReindexStarter;
    let event_sink = Arc::new(AppHandleMetadataScanEventSink::new(app));

    starter
        .start(
            WorkspaceReindexRequest {
                database_path,
                language,
                lifecycle_token,
                mode,
                root_path: root,
            },
            event_sink,
        )
        .map_err(|error| error.to_string())
}

pub(crate) struct AppHandleMetadataScanEventSink {
    app: AppHandle,
}

impl AppHandleMetadataScanEventSink {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl MetadataScanEventSink for AppHandleMetadataScanEventSink {
    fn emit_completion(&self, event: MetadataScanCompletionEvent) {
        let _ = self.app.emit(METADATA_SCAN_COMPLETED_EVENT, event);
    }

    fn emit_progress(&self, event: IndexProgressEvent) {
        let _ = self.app.emit(INDEX_PROGRESS_EVENT, event);
    }
}

pub(crate) fn open_workspace_index(
    app: &AppHandle,
    root_path: &Path,
) -> Result<SqliteWorkspaceIndex, String> {
    let database_path = workspace_index_database_path(app, root_path)?;
    SqliteWorkspaceIndex::open(&database_path).map_err(|error| error.to_string())
}

pub(crate) fn workspace_index_database_path(
    app: &AppHandle,
    root_path: &Path,
) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(workspace_index_path(&config_dir, root_path))
}

pub(crate) fn local_history_store(app: &AppHandle) -> Result<LocalHistoryStore, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(LocalHistoryStore::new(config_dir))
}

pub(crate) fn canonicalize_workspace_root(root_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))
}

pub(crate) fn workspace_root_for_disposal(root_path: &str) -> PathBuf {
    let root = PathBuf::from(root_path);

    root.canonicalize()
        .unwrap_or_else(|_| normalize_path(&root))
}

pub(crate) fn ensure_path_in_workspace(root_path: &Path, path: &str) -> Result<(), String> {
    let canonical_root = root_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let absolute = absolute_workspace_candidate(root_path, path);
    let resolved_path = resolve_existing_or_parent_path(&absolute)?;

    if resolved_path.starts_with(&canonical_root) {
        return Ok(());
    }

    Err("Path is outside the workspace root.".to_string())
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

pub(crate) fn ensure_lsp_path_in_workspace(root_path: &str, path: &str) -> Result<(), String> {
    canonical_lsp_document_identity(root_path, path).map(|_| ())
}

pub(crate) fn ensure_lsp_text_document_content_in_workspace(
    root_path: &str,
    document: &TextDocumentContent,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &document.path)
}

pub(crate) fn ensure_lsp_text_document_path_in_workspace(
    root_path: &str,
    document: &TextDocumentPath,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &document.path)
}

pub(crate) fn ensure_lsp_position_in_workspace(
    root_path: &str,
    position: &TextDocumentPosition,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &position.path)
}

pub(crate) fn ensure_lsp_uri_in_workspace(root_path: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Ok(());
    }

    let Some(path) = path_from_file_uri(uri) else {
        return Err("File URI is outside the workspace root.".to_string());
    };

    ensure_lsp_path_in_workspace(root_path, &path)
}

pub(crate) fn filter_lsp_locations_to_workspace(
    root_path: &str,
    locations: Vec<LanguageServerLocation>,
) -> Result<Vec<LanguageServerLocation>, String> {
    Ok(locations
        .into_iter()
        .filter(|location| is_lsp_file_uri_in_workspace(root_path, &location.uri))
        .collect())
}

pub(crate) fn filter_bounded_lsp_locations_to_workspace(
    root_path: &str,
    mut result: crate::lsp_features::BoundedLanguageServerLocations,
) -> Result<crate::lsp_features::BoundedLanguageServerLocations, String> {
    let retained_before_filter = result.locations.len();
    result
        .locations
        .retain(|location| is_lsp_file_uri_in_workspace(root_path, &location.uri));
    result.is_incomplete |= result.locations.len() != retained_before_filter;
    Ok(result)
}

pub(crate) fn parse_javascript_typescript_navigation_locations_result(
    result: &Value,
) -> Result<Vec<LanguageServerLocation>, String> {
    // Definition-like JS/TS requests may legitimately point at dependency or type-library files.
    parse_definition_result(result)
}

pub(crate) fn filter_lsp_workspace_symbols_to_workspace(
    root_path: &str,
    symbols: Vec<LanguageServerWorkspaceSymbol>,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    Ok(symbols
        .into_iter()
        .filter(|symbol| {
            symbol
                .location
                .as_ref()
                .is_some_and(|location| is_lsp_file_uri_in_workspace(root_path, &location.uri))
        })
        .collect())
}

pub(crate) fn filter_lsp_completion_list_to_workspace(
    root_path: &str,
    completion: LanguageServerCompletionList,
) -> Result<LanguageServerCompletionList, String> {
    Ok(LanguageServerCompletionList {
        is_incomplete: completion.is_incomplete,
        items: completion
            .items
            .into_iter()
            .map(|item| filter_lsp_completion_item_to_workspace(root_path, item))
            .collect(),
    })
}

pub(crate) fn filter_lsp_completion_item_to_workspace(
    root_path: &str,
    mut item: LanguageServerCompletionItem,
) -> LanguageServerCompletionItem {
    if item.command.as_ref().is_some_and(|command| {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command).is_err()
    }) {
        item.command = None;
    }

    if item.data.as_ref().is_some_and(|data| {
        ensure_lsp_json_payload_paths_in_workspace(root_path, Some(data)).is_err()
    }) {
        item.data = None;
    }

    item
}

pub(crate) fn filter_lsp_code_actions_to_workspace(
    root_path: &str,
    actions: Vec<LanguageServerCodeAction>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    actions
        .into_iter()
        .map(|action| filter_lsp_code_action_to_workspace(root_path, action))
        .collect::<Result<Vec<_>, _>>()
        .map(|actions| actions.into_iter().flatten().collect())
}

pub(crate) fn filter_lsp_code_action_to_workspace(
    root_path: &str,
    mut action: LanguageServerCodeAction,
) -> Result<Option<LanguageServerCodeAction>, String> {
    if let Some(edit) = action.edit.take() {
        action.edit = filter_lsp_workspace_edit_to_workspace(root_path, edit)?;
    }

    if action.command.as_ref().is_some_and(|command| {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command).is_err()
    }) {
        action.command = None;
    }

    if action.data.as_ref().is_some_and(|data| {
        ensure_lsp_json_payload_paths_in_workspace(root_path, Some(data)).is_err()
    }) {
        action.data = None;
    }

    Ok(has_action_payload(&action).then_some(action))
}

pub(crate) fn has_action_payload(action: &LanguageServerCodeAction) -> bool {
    action.edit.is_some()
        || action.command.is_some()
        || action.data.is_some()
        || action.disabled.is_some()
}

pub(crate) fn filter_lsp_code_lenses_to_workspace(
    root_path: &str,
    lenses: Vec<LanguageServerCodeLens>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    Ok(lenses
        .into_iter()
        .filter_map(|lens| filter_lsp_code_lens_to_workspace(root_path, lens))
        .collect())
}

pub(crate) fn filter_lsp_code_lens_to_workspace(
    root_path: &str,
    mut lens: LanguageServerCodeLens,
) -> Option<LanguageServerCodeLens> {
    if lens.command.as_ref().is_some_and(|command| {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command).is_err()
    }) {
        lens.command = None;
    }

    if lens.data.as_ref().is_some_and(|data| {
        ensure_lsp_json_payload_paths_in_workspace(root_path, Some(data)).is_err()
    }) {
        lens.data = None;
    }

    (lens.command.is_some() || lens.data.is_some()).then_some(lens)
}

pub(crate) fn filter_lsp_document_links_to_workspace(
    root_path: &str,
    links: Vec<LanguageServerDocumentLink>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    Ok(links
        .into_iter()
        .filter_map(|link| filter_lsp_document_link_to_workspace(root_path, link))
        .collect())
}

pub(crate) fn filter_lsp_document_link_to_workspace(
    root_path: &str,
    mut link: LanguageServerDocumentLink,
) -> Option<LanguageServerDocumentLink> {
    if link.target.as_ref().is_some_and(|target| {
        ensure_lsp_payload_string_in_workspace(root_path, target, true).is_err()
    }) {
        link.target = None;
    }

    if link.data.as_ref().is_some_and(|data| {
        ensure_lsp_json_payload_paths_in_workspace(root_path, Some(data)).is_err()
    }) {
        link.data = None;
    }

    (link.target.is_some() || link.data.is_some()).then_some(link)
}

pub(crate) fn filter_lsp_inlay_hints_to_workspace(
    root_path: &str,
    hints: Vec<LanguageServerInlayHint>,
) -> Vec<LanguageServerInlayHint> {
    hints
        .into_iter()
        .map(|hint| filter_lsp_inlay_hint_to_workspace(root_path, hint))
        .collect()
}

pub(crate) fn filter_lsp_inlay_hint_to_workspace(
    root_path: &str,
    mut hint: LanguageServerInlayHint,
) -> LanguageServerInlayHint {
    if hint.data.as_ref().is_some_and(|data| {
        ensure_lsp_json_payload_paths_in_workspace(root_path, Some(data)).is_err()
    }) {
        hint.data = None;
    }

    filter_lsp_inlay_hint_label_to_workspace(root_path, &mut hint.label);

    hint
}

pub(crate) fn filter_lsp_inlay_hint_label_to_workspace(
    root_path: &str,
    label: &mut LanguageServerInlayHintLabel,
) {
    let LanguageServerInlayHintLabel::Parts(parts) = label else {
        return;
    };

    for part in parts {
        if part.command.as_ref().is_some_and(|command| {
            ensure_lsp_command_payload_paths_in_workspace(root_path, command).is_err()
        }) {
            part.command = None;
        }

        if part
            .location
            .as_ref()
            .is_some_and(|location| !is_lsp_file_uri_in_workspace(root_path, &location.uri))
        {
            part.location = None;
        }
    }
}

pub(crate) fn filter_lsp_call_hierarchy_items_to_workspace(
    root_path: &str,
    items: Vec<LanguageServerCallHierarchyItem>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    Ok(items
        .into_iter()
        .filter(|item| is_lsp_file_uri_in_workspace(root_path, &item.uri))
        .collect())
}

pub(crate) fn filter_lsp_incoming_calls_to_workspace(
    root_path: &str,
    calls: Vec<LanguageServerIncomingCall>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    Ok(calls
        .into_iter()
        .filter(|call| is_lsp_file_uri_in_workspace(root_path, &call.from.uri))
        .collect())
}

pub(crate) fn filter_lsp_outgoing_calls_to_workspace(
    root_path: &str,
    calls: Vec<LanguageServerOutgoingCall>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    Ok(calls
        .into_iter()
        .filter(|call| is_lsp_file_uri_in_workspace(root_path, &call.to.uri))
        .collect())
}

pub(crate) fn filter_lsp_type_hierarchy_items_to_workspace(
    root_path: &str,
    items: Vec<LanguageServerTypeHierarchyItem>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    Ok(items
        .into_iter()
        .filter(|item| is_lsp_file_uri_in_workspace(root_path, &item.uri))
        .collect())
}

pub(crate) fn filter_optional_lsp_workspace_edit_to_workspace(
    root_path: &str,
    edit: Option<LanguageServerWorkspaceEdit>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let Some(edit) = edit else {
        return Ok(None);
    };

    filter_lsp_workspace_edit_to_workspace(root_path, edit)
}

pub(crate) fn filter_lsp_workspace_edit_to_workspace(
    root_path: &str,
    edit: LanguageServerWorkspaceEdit,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let changes = edit
        .changes
        .into_iter()
        .filter(|(uri, _)| is_lsp_file_uri_in_workspace(root_path, uri))
        .collect::<BTreeMap<_, _>>();
    let document_versions = edit
        .document_versions
        .into_iter()
        .filter(|(uri, _)| is_lsp_file_uri_in_workspace(root_path, uri))
        .collect::<BTreeMap<_, _>>();
    let file_operations = edit
        .file_operations
        .into_iter()
        .filter(|operation| {
            workspace_file_operation_uris(operation)
                .into_iter()
                .all(|uri| is_lsp_file_uri_in_workspace(root_path, uri))
        })
        .collect::<Vec<_>>();

    if changes.is_empty() && file_operations.is_empty() {
        return Ok(None);
    }

    Ok(Some(LanguageServerWorkspaceEdit {
        changes,
        document_versions,
        file_operations,
    }))
}

pub(crate) fn is_lsp_file_uri_in_workspace(root_path: &str, uri: &str) -> bool {
    uri.starts_with("file://") && ensure_lsp_uri_in_workspace(root_path, uri).is_ok()
}

pub(crate) fn ensure_lsp_completion_item_payload_in_workspace(
    root_path: &str,
    item: &LanguageServerCompletionItem,
) -> Result<(), String> {
    if let Some(command) = &item.command {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

pub(crate) fn ensure_lsp_code_action_payload_in_workspace(
    root_path: &str,
    action: &LanguageServerCodeAction,
) -> Result<(), String> {
    if let Some(edit) = &action.edit {
        ensure_lsp_workspace_edit_paths_in_workspace(root_path, edit)?;
    }

    if let Some(command) = &action.command {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, action.data.as_ref())
}

pub(crate) fn ensure_lsp_code_action_context_payloads_in_workspace(
    root_path: &str,
    context: &LanguageServerCodeActionContext,
) -> Result<(), String> {
    for diagnostic in &context.diagnostics {
        ensure_lsp_json_payload_paths_in_workspace(root_path, diagnostic.data.as_ref())?;
    }

    Ok(())
}

pub(crate) fn ensure_lsp_code_lens_payload_in_workspace(
    root_path: &str,
    lens: &LanguageServerCodeLens,
) -> Result<(), String> {
    if let Some(command) = &lens.command {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, lens.data.as_ref())
}

pub(crate) fn ensure_lsp_document_link_payload_in_workspace(
    root_path: &str,
    link: &LanguageServerDocumentLink,
) -> Result<(), String> {
    if let Some(target) = &link.target {
        ensure_lsp_payload_string_in_workspace(root_path, target, true)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, link.data.as_ref())
}

pub(crate) fn ensure_lsp_inlay_hint_payload_in_workspace(
    root_path: &str,
    hint: &LanguageServerInlayHint,
) -> Result<(), String> {
    ensure_lsp_json_payload_paths_in_workspace(root_path, hint.data.as_ref())?;
    ensure_lsp_inlay_hint_label_payloads_in_workspace(root_path, &hint.label)
}

pub(crate) fn ensure_lsp_inlay_hint_label_payloads_in_workspace(
    root_path: &str,
    label: &LanguageServerInlayHintLabel,
) -> Result<(), String> {
    let LanguageServerInlayHintLabel::Parts(parts) = label else {
        return Ok(());
    };

    for part in parts {
        if let Some(command) = &part.command {
            ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
        }

        if let Some(location) = &part.location {
            ensure_lsp_uri_in_workspace(root_path, &location.uri)?;
        }
    }

    Ok(())
}

pub(crate) fn ensure_lsp_call_hierarchy_item_in_workspace(
    root_path: &str,
    item: &LanguageServerCallHierarchyItem,
) -> Result<(), String> {
    ensure_lsp_uri_in_workspace(root_path, &item.uri)?;
    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

pub(crate) fn ensure_lsp_type_hierarchy_item_in_workspace(
    root_path: &str,
    item: &LanguageServerTypeHierarchyItem,
) -> Result<(), String> {
    ensure_lsp_uri_in_workspace(root_path, &item.uri)?;
    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

pub(crate) fn ensure_lsp_command_payload_paths_in_workspace(
    root_path: &str,
    command: &LanguageServerCodeActionCommand,
) -> Result<(), String> {
    if let Some(arguments) = &command.arguments {
        for argument in arguments {
            ensure_lsp_json_value_paths_in_workspace(root_path, argument, true)?;
        }
    }

    Ok(())
}

pub(crate) fn ensure_lsp_json_payload_paths_in_workspace(
    root_path: &str,
    payload: Option<&Value>,
) -> Result<(), String> {
    if let Some(payload) = payload {
        ensure_lsp_json_value_paths_in_workspace(root_path, payload, false)?;
    }

    Ok(())
}

pub(crate) fn ensure_lsp_json_value_paths_in_workspace(
    root_path: &str,
    value: &Value,
    path_context: bool,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                ensure_lsp_json_value_paths_in_workspace(root_path, item, path_context)?;
            }
        }
        Value::Object(fields) => {
            for (key, field_value) in fields {
                ensure_lsp_payload_string_in_workspace(root_path, key, false)?;
                ensure_lsp_json_value_paths_in_workspace(
                    root_path,
                    field_value,
                    path_context || is_lsp_path_payload_key(key),
                )?;
            }
        }
        Value::String(value) => {
            ensure_lsp_payload_string_in_workspace(root_path, value, path_context)?;
        }
        _ => {}
    }

    Ok(())
}

pub(crate) fn ensure_lsp_payload_string_in_workspace(
    root_path: &str,
    value: &str,
    path_context: bool,
) -> Result<(), String> {
    if value.starts_with("file://") {
        return ensure_lsp_uri_in_workspace(root_path, value);
    }

    if !path_context || has_non_file_uri_scheme(value) {
        return Ok(());
    }

    ensure_lsp_path_in_workspace(root_path, value)
}

pub(crate) fn is_lsp_path_payload_key(key: &str) -> bool {
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

pub(crate) fn has_non_file_uri_scheme(value: &str) -> bool {
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

pub(crate) fn path_file_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| path.to_string())
}

pub(crate) fn resolve_workspace_path(root_path: &Path, path: &str) -> Result<PathBuf, String> {
    ensure_path_in_workspace(root_path, path)?;
    Ok(normalize_path(&absolute_workspace_candidate(
        root_path, path,
    )))
}

pub(crate) fn absolute_workspace_candidate(root_path: &Path, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);

    if candidate.is_absolute() {
        return candidate;
    }

    root_path.join(candidate)
}

pub(crate) fn resolve_existing_or_parent_path(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components = Vec::new();

    while !cursor.exists() {
        match cursor.file_name() {
            Some(component) => missing_components.push(component.to_os_string()),
            None => return Err("Failed to resolve index path.".to_string()),
        }

        if cursor.pop() {
            continue;
        }

        return Err("Failed to resolve index path.".to_string());
    }

    let mut resolved = cursor
        .canonicalize()
        .map_err(|error| format!("Failed to resolve index path: {error}"))?;

    while let Some(component) = missing_components.pop() {
        resolved.push(component);
    }

    Ok(normalize_path(&resolved))
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

#[cfg(test)]
mod unregister_workspace_tests {
    use super::unregister_workspace_with_runtime_cleanup;
    use crate::workspace_registry::WorkspaceRegistry;
    use crate::workspace_runtime::{
        DebugSessionDisposer, LanguageServerDisposer, TerminalSessionDisposer,
        WorkspaceIndexLifecycleDisposer, WorkspaceProcessDisposer, WorkspaceRuntimeDisposal,
        WorkspaceWatchDisposer,
    };
    use std::{
        collections::BTreeSet,
        fs,
        path::Path,
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct RecordingDisposer {
        calls: Arc<Mutex<Vec<String>>>,
        label: &'static str,
        roots: Mutex<BTreeSet<String>>,
        terminal_error: Option<&'static str>,
    }

    impl RecordingDisposer {
        fn new(
            label: &'static str,
            roots: impl IntoIterator<Item = String>,
            calls: &Arc<Mutex<Vec<String>>>,
        ) -> Self {
            Self {
                calls: Arc::clone(calls),
                label,
                roots: Mutex::new(roots.into_iter().collect()),
                terminal_error: None,
            }
        }

        fn failing_terminal(
            label: &'static str,
            roots: impl IntoIterator<Item = String>,
            calls: &Arc<Mutex<Vec<String>>>,
            error: &'static str,
        ) -> Self {
            Self {
                terminal_error: Some(error),
                ..Self::new(label, roots, calls)
            }
        }

        fn stop(&self, root_path: &str) {
            self.calls
                .lock()
                .expect("calls")
                .push(format!("{}:{root_path}", self.label));
            self.roots.lock().expect("roots").remove(root_path);
        }

        fn contains(&self, root_path: &str) -> bool {
            self.roots.lock().expect("roots").contains(root_path)
        }
    }

    impl WorkspaceWatchDisposer for RecordingDisposer {
        fn stop_workspace_watch(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl LanguageServerDisposer for RecordingDisposer {
        fn stop_language_server(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl WorkspaceIndexLifecycleDisposer for RecordingDisposer {
        fn cancel_workspace_index_lifecycle(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl DebugSessionDisposer for RecordingDisposer {
        fn stop_debug_session(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl WorkspaceProcessDisposer for RecordingDisposer {
        fn stop_workspace_processes(&self, root_path: &Path) {
            self.stop(&root_path.to_string_lossy());
        }
    }

    impl TerminalSessionDisposer for RecordingDisposer {
        fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String> {
            self.stop(&root_path.to_string_lossy());
            match self.terminal_error {
                Some(error) => Err(error.to_string()),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn unregister_stops_exact_language_services_before_descriptor_removal_and_reports_errors() {
        let registry = WorkspaceRegistry::new();
        let root_a = temporary_workspace("unregister-a");
        let root_b = temporary_workspace("unregister-b");
        let descriptor_a = registry.register(&root_a).expect("register A");
        let descriptor_b = registry.register(&root_b).expect("register B");
        let root_a_key = descriptor_a
            .canonical_root_path
            .to_string_lossy()
            .into_owned();
        let root_b_key = descriptor_b
            .canonical_root_path
            .to_string_lossy()
            .into_owned();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let index =
            RecordingDisposer::new("index", [root_a_key.clone(), root_b_key.clone()], &calls);
        let watcher =
            RecordingDisposer::new("watch", [root_a_key.clone(), root_b_key.clone()], &calls);
        let file_watcher = RecordingDisposer::new(
            "file-watch",
            [root_a_key.clone(), root_b_key.clone()],
            &calls,
        );
        let javascript_typescript =
            RecordingDisposer::new("js-lsp", [root_a_key.clone(), root_b_key.clone()], &calls);
        let php =
            RecordingDisposer::new("php-lsp", [root_a_key.clone(), root_b_key.clone()], &calls);
        let debug =
            RecordingDisposer::new("debug", [root_a_key.clone(), root_b_key.clone()], &calls);
        let eslint =
            RecordingDisposer::new("eslint", [root_a_key.clone(), root_b_key.clone()], &calls);
        let terminal = RecordingDisposer::failing_terminal(
            "terminal",
            [root_a_key.clone(), root_b_key.clone()],
            &calls,
            "terminal stop failed",
        );

        let errors = unregister_workspace_with_runtime_cleanup(
            &registry,
            &descriptor_a.workspace_id,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &javascript_typescript,
                javascript_typescript_watch_registry: &watcher,
                workspace_file_change_watch_registry: &file_watcher,
                php_language_servers: &php,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminal,
            },
            |descriptor| {
                calls.lock().expect("calls").push(format!(
                    "before:{}",
                    descriptor.canonical_root_path.to_string_lossy()
                ));
            },
            |descriptor, errors| {
                calls.lock().expect("calls").push(format!(
                    "after:{}",
                    descriptor.canonical_root_path.to_string_lossy()
                ));
                errors.push("document cleanup failed".to_string());
            },
        )
        .expect("unregister after best-effort cleanup");

        assert_eq!(
            errors,
            vec![
                "Workspace runtime cleanup failed: terminal stop failed",
                "document cleanup failed",
            ]
        );
        assert!(registry.descriptor(&descriptor_a.workspace_id).is_err());
        assert!(registry.descriptor(&descriptor_b.workspace_id).is_ok());
        assert!(!index.contains(&root_a_key));
        assert!(index.contains(&root_b_key));
        assert!(!watcher.contains(&root_a_key));
        assert!(watcher.contains(&root_b_key));
        assert!(!file_watcher.contains(&root_a_key));
        assert!(file_watcher.contains(&root_b_key));
        assert!(!javascript_typescript.contains(&root_a_key));
        assert!(javascript_typescript.contains(&root_b_key));
        assert!(!php.contains(&root_a_key));
        assert!(php.contains(&root_b_key));
        assert!(!debug.contains(&root_a_key));
        assert!(debug.contains(&root_b_key));
        assert!(!eslint.contains(&root_a_key));
        assert!(eslint.contains(&root_b_key));
        assert!(!terminal.contains(&root_a_key));
        assert!(terminal.contains(&root_b_key));
        let retry_errors = unregister_workspace_with_runtime_cleanup(
            &registry,
            &descriptor_a.workspace_id,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &javascript_typescript,
                javascript_typescript_watch_registry: &watcher,
                workspace_file_change_watch_registry: &file_watcher,
                php_language_servers: &php,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminal,
            },
            |_| panic!("an idempotent unregister retry must not repeat cleanup"),
            |_, _| panic!("an idempotent unregister retry must not repeat cleanup"),
        )
        .expect("already-unregistered workspace retry");
        assert!(retry_errors.is_empty());
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                format!("before:{root_a_key}"),
                format!("index:{root_a_key}"),
                format!("watch:{root_a_key}"),
                format!("file-watch:{root_a_key}"),
                format!("js-lsp:{root_a_key}"),
                format!("php-lsp:{root_a_key}"),
                format!("debug:{root_a_key}"),
                format!("eslint:{root_a_key}"),
                format!("terminal:{root_a_key}"),
                format!("after:{root_a_key}"),
            ]
        );

        fs::remove_dir_all(root_a).expect("cleanup A");
        fs::remove_dir_all(root_b).expect("cleanup B");
    }

    fn temporary_workspace(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }
}
