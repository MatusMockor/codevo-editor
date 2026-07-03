pub mod composer;
pub mod file_watcher;
pub mod git;
pub mod ignore_matcher;
pub mod index;
pub mod index_reindex;
pub mod index_scan;
pub mod index_update;
pub mod job_scheduler;
pub mod js_ts_file_watcher;
pub mod js_ts_symbols;
pub mod local_history;
mod lsp;
mod lsp_diagnostics;
mod lsp_document;
mod lsp_features;
mod lsp_session;
mod lsp_transport;
mod managed_javascript_typescript;
mod managed_phpactor;
pub mod php_file_outline;
pub mod php_parser;
pub mod php_symbols;
pub mod php_tree;
mod project;
mod runtime_observability;
mod search;
mod smart_mode;
mod terminal;
mod terminal_session;
mod tools;
mod trust;
mod workspace;
pub mod workspace_file_watcher;
mod workspace_runtime;

use git::{
    load_commit_details, load_commit_diff, load_commit_files, load_commit_log, load_git_branches,
    safe_stash_index, CommandGitRepositoryGateway, CommitDiffPayload, CommitFileChange,
    CommitGraphNode, GitBlameLine, GitBranch, GitBranches, GitChangedFile, GitCommit,
    GitCommitDetails, GitCommitFilters, GitDiffHunk, GitFileDiff, GitFileHistoryEntry,
    GitRepoStatus, GitRepositoryGateway, GitStashEntry, GitStatus,
};
use index::{
    workspace_index_path, ProjectSymbolSearchResult, SqliteWorkspaceIndex, WorkspaceFileRecord,
    WorkspaceIndexMaintenanceStore, WorkspaceIndexStore, WorkspaceIndexSummary,
    WorkspacePhpFileOutlineStore, WorkspacePhpTreeStore, WorkspaceSymbolSearchStore,
};
use index_reindex::{
    LocalWorkspaceReindexStarter, WorkspaceReindexRequest, WorkspaceReindexStarter,
};
use index_scan::{
    IndexProgressEvent, InitialMetadataScanStart, MetadataScanCompletionEvent,
    MetadataScanEventSink, WorkspaceReindexMode, INDEX_PROGRESS_EVENT,
    METADATA_SCAN_COMPLETED_EVENT,
};
use job_scheduler::WorkspaceIndexLifecycle;
use js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use local_history::{LocalHistoryStore, LocalHistoryVersion};
use lsp::{
    JavaScriptTypeScriptLanguageServerPlanner, JsonRpcNotification, JsonRpcRequest,
    LanguageServerCommand, LanguageServerPlan, LanguageServerPlanStatus, LanguageServerPlanner,
    PhpLanguageServerSettings, PhpactorLanguageServerPlanner,
    TypeScriptImportModuleSpecifierEnding, TypeScriptImportModuleSpecifierPreference,
    TypeScriptLanguageServerPlanner, TypeScriptLanguageServerSettings, TypeScriptQuotePreference,
};
use lsp_document::{
    LspTextDocumentSyncNotificationFactory, TextDocumentContent, TextDocumentPath,
    TextDocumentSyncNotificationFactory,
};
use lsp_features::{
    parse_call_hierarchy_items_result, parse_code_action_result, parse_completion_item_result,
    parse_completion_result, parse_definition_result, parse_document_highlights_result,
    parse_document_links_result, parse_document_symbols_result, parse_folding_ranges_result,
    parse_formatting_result, parse_hover_result, parse_incoming_calls_result,
    parse_inlay_hint_result, parse_inlay_hints_result, parse_linked_editing_ranges_result,
    parse_optional_workspace_edit_result, parse_outgoing_calls_result, parse_prepare_rename_result,
    parse_selection_ranges_result, parse_semantic_tokens_result, parse_signature_help_result,
    parse_type_hierarchy_items_result, parse_workspace_edit_result, parse_workspace_symbols_result,
    LanguageServerCallHierarchyItem, LanguageServerCodeAction, LanguageServerCodeActionCommand,
    LanguageServerCodeActionContext, LanguageServerCodeLens, LanguageServerCompletionContext,
    LanguageServerCompletionItem, LanguageServerCompletionList, LanguageServerDocumentHighlight,
    LanguageServerDocumentLink, LanguageServerDocumentSymbol, LanguageServerFoldingRange,
    LanguageServerFormattingOptions, LanguageServerHover, LanguageServerIncomingCall,
    LanguageServerInlayHint, LanguageServerInlayHintLabel, LanguageServerLinkedEditingRanges,
    LanguageServerLocation, LanguageServerOutgoingCall, LanguageServerPosition,
    LanguageServerPrepareRenameResult, LanguageServerRange, LanguageServerSelectionRange,
    LanguageServerSemanticTokens, LanguageServerSignatureHelp, LanguageServerSignatureHelpContext,
    LanguageServerTextEdit, LanguageServerTypeHierarchyItem, LanguageServerWorkspaceEdit,
    LanguageServerWorkspaceFileOperation, LanguageServerWorkspaceFileOperationOptions,
    LanguageServerWorkspaceSymbol, LspTextDocumentFeatureRequestFactory, TextDocumentCompletion,
    TextDocumentFeatureRequestFactory, TextDocumentFormatting, TextDocumentInlayHintRange,
    TextDocumentOnTypeFormatting, TextDocumentPosition, TextDocumentRange,
    TextDocumentRangeFormatting, TextDocumentRename, TextDocumentSelectionRange,
    TextDocumentSignatureHelp, WorkspaceFileChange, WorkspaceFileCreate, WorkspaceFileDelete,
    WorkspaceFileRename,
};
use lsp_session::{
    language_server_status_payload, AppHandleEventSink, ChildServerProcessSpawner, DiagnosticsSink,
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRuntimeStatus,
    PhpLanguageServerRegistry, RefreshSink, RestartController, StatusSink, WorkspaceEditSink,
};
use php_file_outline::{
    build_php_file_outline, PhpFileOutline, PhpFileOutlineNodeKind, PhpFileOutlineParameter,
    PhpFileOutlineSymbolRecord, PhpSymbolVisibility as OutlineSymbolVisibility,
};
use php_parser::{PhpSyntaxDiagnostic, PhpSyntaxParser, TreeSitterPhpParser};
use php_symbols::{
    PhpParameter, PhpSymbolExtractor, PhpSymbolKind, PhpSymbolVisibility,
    TreeSitterPhpSymbolExtractor,
};
use php_tree::PhpTree;
use project::{ComposerWorkspaceDetector, WorkspaceDescriptor, WorkspaceDetector};
use search::{
    ReplaceInPathResult, RipgrepTextReplacer, RipgrepTextSearcher, TextReplacer, TextSearchOptions,
    TextSearchResult, TextSearcher,
};
use serde::Serialize;
use serde_json::{json, Value};
use smart_mode::{IntelligenceMode, SmartModeService, SmartModeState};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use terminal::{AppHandleTerminalEventSink, TerminalProfile, TerminalRuntimeStatus, TerminalSize};
use terminal_session::{
    LocalTerminalProfileProvider, PortablePtySpawner, TerminalProfileProvider, TerminalSupervisor,
};
use tools::{
    JavaScriptTypeScriptToolDetector, JavaScriptTypeScriptToolPreference,
    LocalJavaScriptTypeScriptToolDetector, LocalPhpToolDetector, PhpToolAvailability,
    PhpToolDetector,
};
use trust::{WorkspaceTrustService, WorkspaceTrustState};
use workspace::{
    apply_text_edits_to_files, FileEntry, FileSearchResult, LocalWorkspaceFileRepository,
    WorkspaceFileRepository, WorkspaceTextEdit, WorkspaceTextPosition, WorkspaceTextRange,
};
use workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, WorkspaceRuntimeDisposal,
};

#[cfg(target_os = "macos")]
const CLOSE_ACTIVE_TAB_EVENT: &str = "mockor-close-active-tab";
#[cfg(target_os = "macos")]
const CLOSE_ACTIVE_TAB_MENU_ID: &str = "close-active-tab";
#[cfg(target_os = "macos")]
const FONT_ZOOM_IN_EVENT: &str = "mockor-editor-font-zoom-in";
#[cfg(target_os = "macos")]
const FONT_ZOOM_IN_MENU_ID: &str = "font-zoom-in";
#[cfg(target_os = "macos")]
const FONT_ZOOM_OUT_EVENT: &str = "mockor-editor-font-zoom-out";
#[cfg(target_os = "macos")]
const FONT_ZOOM_OUT_MENU_ID: &str = "font-zoom-out";
#[cfg(target_os = "macos")]
const FONT_ZOOM_RESET_EVENT: &str = "mockor-editor-font-zoom-reset";
#[cfg(target_os = "macos")]
const FONT_ZOOM_RESET_MENU_ID: &str = "font-zoom-reset";
#[cfg(target_os = "macos")]
const OPEN_APPEARANCE_SETTINGS_EVENT: &str = "mockor-open-appearance-settings";
#[cfg(target_os = "macos")]
const OPEN_APPEARANCE_SETTINGS_MENU_ID: &str = "open-appearance-settings";
#[cfg(target_os = "macos")]
const QUIT_APPLICATION_MENU_ID: &str = "quit-application";
#[cfg(target_os = "macos")]
const TOGGLE_FONT_LIGATURES_EVENT: &str = "mockor-toggle-font-ligatures";
#[cfg(target_os = "macos")]
const TOGGLE_FONT_LIGATURES_MENU_ID: &str = "toggle-font-ligatures";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIndexClearResult {
    database_path: String,
    root_path: String,
    status: &'static str,
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .create_directory(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedPhpactorInstallCompletionEvent {
    root: String,
    error: Option<String>,
}

struct AppHandleManagedPhpactorInstallEventSink {
    app: AppHandle,
}

impl managed_phpactor::ManagedPhpactorInstallEventSink
    for AppHandleManagedPhpactorInstallEventSink
{
    fn emit_completion(&self, root: String, error: Option<String>) {
        let _ = self.app.emit(
            managed_phpactor::MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT,
            ManagedPhpactorInstallCompletionEvent { root, error },
        );
    }
}

#[tauri::command]
fn install_managed_phpactor(app: AppHandle, root: String) {
    managed_phpactor::spawn_managed_phpactor_install(
        root,
        AppHandleManagedPhpactorInstallEventSink { app },
    );
}

#[tauri::command]
fn quit_application(app: AppHandle) {
    shutdown_runtime_processes(&app);
    app.exit(0);
}

/// Process-wide cache of monospace font families. System fonts do not change
/// for the lifetime of the session, so the expensive `fontdb` system scan is
/// performed at most once and reused by every later `Settings` dialog open.
static MONOSPACE_FONT_FAMILIES_CACHE: OnceLock<Vec<String>> = OnceLock::new();

/// Lists the monospace font families exposed to the `Settings` font picker.
///
/// The `fontdb` system scan walks every installed font (100ms-1s+ on macOS), so
/// it must never run on the WebView main thread. The work is handed to Tokio's
/// blocking pool (same off-main-thread discipline as the index/git commands) and
/// the result is cached after the first enumeration.
#[tauri::command]
async fn list_monospace_font_families() -> Vec<String> {
    run_blocking_command(|| {
        Ok(cached_monospace_font_families(
            &MONOSPACE_FONT_FAMILIES_CACHE,
            enumerate_monospace_font_families,
        )
        .clone())
    })
    .await
    .unwrap_or_default()
}

/// Returns the cached monospace font families, running `scan` exactly once and
/// reusing its result on every later call for the given `cache` cell. Both the
/// cache cell and `scan` are injected so the cache-once behaviour is verifiable
/// without performing a real system font scan or touching global state.
fn cached_monospace_font_families<F>(cache: &OnceLock<Vec<String>>, scan: F) -> &Vec<String>
where
    F: FnOnce() -> Vec<String>,
{
    cache.get_or_init(scan)
}

/// Performs the raw `fontdb` system scan, collecting de-duplicated, sorted
/// monospace font family names. This is the expensive, blocking work.
fn enumerate_monospace_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();

    for face in database.faces().filter(|face| face.monospaced) {
        for (family, _) in &face.families {
            let trimmed = family.trim();

            if !trimmed.is_empty() {
                families.insert(trimmed.to_string());
            }
        }
    }

    families.into_iter().collect()
}

fn shutdown_runtime_processes(app: &AppHandle) {
    if let Some(index_lifecycle) = app.try_state::<WorkspaceIndexLifecycle>() {
        index_lifecycle.cancel_all();
    }

    if let Some(watch_registry) = app.try_state::<JavaScriptTypeScriptWorkspaceWatchRegistry>() {
        watch_registry.stop_all();
    }

    if let Some(watch_registry) = app.try_state::<WorkspaceFileChangeWatchRegistry>() {
        watch_registry.stop_all();
    }

    if let Some(registry) = app.try_state::<PhpLanguageServerRegistry>() {
        let _ = registry.stop_all();
    }

    if let Some(registry) = app.try_state::<JavaScriptTypeScriptLanguageServerRegistry>() {
        let _ = registry.stop_all();
    }

    if let Some(supervisor) = app.try_state::<TerminalSupervisor>() {
        supervisor.stop_all();
    }
}

#[tauri::command]
fn create_text_file(path: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .create_text_file(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .delete_path(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn detect_workspace(path: String) -> Result<WorkspaceDescriptor, String> {
    let detector = ComposerWorkspaceDetector::default();
    detector
        .detect(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn dispose_workspace_root(
    root_path: String,
    index_lifecycle: State<'_, WorkspaceIndexLifecycle>,
    javascript_typescript_language_servers: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    javascript_typescript_watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
    workspace_file_change_watch_registry: State<'_, WorkspaceFileChangeWatchRegistry>,
    php_language_servers: State<'_, PhpLanguageServerRegistry>,
    terminal_sessions: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    let root = workspace_root_for_disposal(&root_path);

    dispose_workspace_runtime_root(
        &root,
        WorkspaceRuntimeDisposal {
            index_lifecycle: &*index_lifecycle,
            javascript_typescript_language_servers: &*javascript_typescript_language_servers,
            javascript_typescript_watch_registry: &*javascript_typescript_watch_registry,
            workspace_file_change_watch_registry: &*workspace_file_change_watch_registry,
            php_language_servers: &*php_language_servers,
            terminal_sessions: &*terminal_sessions,
        },
    )
}

#[tauri::command]
fn detect_php_tools(workspace_root: Option<String>) -> Result<PhpToolAvailability, String> {
    let detector = LocalPhpToolDetector;
    let workspace_root = workspace_root.map(PathBuf::from);
    detector
        .detect(workspace_root.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_smart_mode_state(
    service: State<'_, Mutex<SmartModeService>>,
) -> Result<SmartModeState, String> {
    let service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.state())
}

#[tauri::command]
fn get_workspace_trust(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<WorkspaceTrustState, String> {
    let service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.get(&root_path))
}

#[tauri::command]
async fn parse_php_syntax(source: String) -> Result<Vec<PhpSyntaxDiagnostic>, String> {
    // tree-sitter parsing is CPU-bound; run it on the blocking pool so the Tauri
    // WebView main thread stays responsive while a project is opening.
    run_blocking_command(move || parse_php_syntax_blocking(&source)).await
}

fn parse_php_syntax_blocking(source: &str) -> Result<Vec<PhpSyntaxDiagnostic>, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(source).map_err(|error| error.to_string())?;
    Ok(tree.diagnostics())
}

#[tauri::command]
async fn parse_php_file_outline(path: String, source: String) -> Result<PhpFileOutline, String> {
    // tree-sitter parse + symbol extraction is the heaviest per-open command;
    // keep it off the main thread.
    run_blocking_command(move || parse_php_file_outline_blocking(&path, &source)).await
}

fn parse_php_file_outline_blocking(path: &str, source: &str) -> Result<PhpFileOutline, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(source).map_err(|error| error.to_string())?;
    let extractor = TreeSitterPhpSymbolExtractor;
    let symbols = extractor.extract(&tree, source);
    let relative_path = path_file_label(path);
    let records: Vec<PhpFileOutlineSymbolRecord> = symbols
        .into_iter()
        .map(|symbol| PhpFileOutlineSymbolRecord {
            column: symbol.range.start_column as i64,
            container_kind: None,
            container_name: symbol.container_name,
            fully_qualified_name: symbol.fully_qualified_name,
            is_static: symbol.is_static,
            kind: php_file_outline_node_kind_from_symbol(symbol.kind),
            line_number: symbol.range.start_line as i64,
            name: symbol.name,
            parameters: symbol
                .parameters
                .into_iter()
                .map(outline_parameter_from_symbol)
                .collect(),
            path: path.to_string(),
            relative_path: relative_path.clone(),
            return_type: symbol.return_type,
            visibility: symbol.visibility.map(outline_visibility_from_symbol),
        })
        .collect();

    Ok(build_php_file_outline(&records))
}

#[tauri::command]
fn initialize_workspace_index(
    root_path: String,
    app: AppHandle,
) -> Result<WorkspaceIndexSummary, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    let index = open_workspace_index(&app, &root)?;
    index.summary().map_err(|error| error.to_string())
}

#[tauri::command]
fn start_workspace_file_watch(
    root_path: String,
    app: AppHandle,
    workspace_file_change_watch_registry: State<'_, WorkspaceFileChangeWatchRegistry>,
) -> Result<(), String> {
    let root = canonicalize_workspace_root(&root_path)?;
    workspace_file_change_watch_registry.start(&root.to_string_lossy(), app)
}

#[tauri::command]
fn upsert_workspace_index_file(
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
fn remove_workspace_index_file(
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
fn clear_workspace_index(
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

fn clear_workspace_index_database(
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
fn start_initial_metadata_scan(
    root_path: String,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    start_workspace_reindex(root_path, WorkspaceReindexMode::Soft, None, app)
}

#[tauri::command]
fn start_workspace_reindex(
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

struct AppHandleMetadataScanEventSink {
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

/// Runs a blocking command body on Tokio's dedicated blocking pool so the Tauri
/// WebView main thread is never stalled by file-system, tree-sitter, or SQLite
/// work — the same off-main-thread discipline used by the LSP feature commands
/// (`LanguageServerRegistry::send_request_async`).
///
/// The closure must own everything it touches (`'static`); callers capture and
/// clone their arguments before handing the work off, so nothing borrows across
/// the `await` and per-workspace isolation is decided by the captured values.
async fn run_blocking_command<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Command task failed: {error}"))?
}

fn open_workspace_index(app: &AppHandle, root_path: &Path) -> Result<SqliteWorkspaceIndex, String> {
    let database_path = workspace_index_database_path(app, root_path)?;
    SqliteWorkspaceIndex::open(&database_path).map_err(|error| error.to_string())
}

fn workspace_index_database_path(app: &AppHandle, root_path: &Path) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(workspace_index_path(&config_dir, root_path))
}

fn local_history_store(app: &AppHandle) -> Result<LocalHistoryStore, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(LocalHistoryStore::new(config_dir))
}

fn canonicalize_workspace_root(root_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))
}

fn workspace_root_for_disposal(root_path: &str) -> PathBuf {
    let root = PathBuf::from(root_path);

    root.canonicalize()
        .unwrap_or_else(|_| normalize_path(&root))
}

fn ensure_path_in_workspace(root_path: &Path, path: &str) -> Result<(), String> {
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

fn ensure_lsp_path_in_workspace(root_path: &str, path: &str) -> Result<(), String> {
    let root = canonicalize_workspace_root(root_path)?;

    ensure_path_in_workspace(&root, path)
}

fn ensure_lsp_text_document_content_in_workspace(
    root_path: &str,
    document: &TextDocumentContent,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &document.path)
}

fn ensure_lsp_text_document_path_in_workspace(
    root_path: &str,
    document: &TextDocumentPath,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &document.path)
}

fn ensure_lsp_position_in_workspace(
    root_path: &str,
    position: &TextDocumentPosition,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(root_path, &position.path)
}

fn ensure_lsp_uri_in_workspace(root_path: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Ok(());
    }

    let Some(path) = path_from_file_uri(uri) else {
        return Err("File URI is outside the workspace root.".to_string());
    };

    ensure_lsp_path_in_workspace(root_path, &path)
}

fn ensure_lsp_workspace_edit_paths_in_workspace(
    root_path: &str,
    edit: &LanguageServerWorkspaceEdit,
) -> Result<(), String> {
    for uri in edit.changes.keys() {
        ensure_lsp_workspace_edit_uri_in_workspace(root_path, uri)?;
    }

    for uri in edit.document_versions.keys() {
        ensure_lsp_workspace_edit_uri_in_workspace(root_path, uri)?;
    }

    for operation in &edit.file_operations {
        for uri in workspace_file_operation_uris(operation) {
            ensure_lsp_workspace_edit_uri_in_workspace(root_path, uri)?;
        }
    }

    Ok(())
}

fn ensure_lsp_workspace_edit_uri_in_workspace(root_path: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Err("Workspace edit URI must be a file URI.".to_string());
    }

    ensure_lsp_uri_in_workspace(root_path, uri)
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

fn filter_lsp_locations_to_workspace(
    root_path: &str,
    locations: Vec<LanguageServerLocation>,
) -> Result<Vec<LanguageServerLocation>, String> {
    Ok(locations
        .into_iter()
        .filter(|location| is_lsp_file_uri_in_workspace(root_path, &location.uri))
        .collect())
}

fn parse_javascript_typescript_navigation_locations_result(
    result: &Value,
) -> Result<Vec<LanguageServerLocation>, String> {
    // Definition-like JS/TS requests may legitimately point at dependency or type-library files.
    parse_definition_result(result)
}

fn filter_lsp_workspace_symbols_to_workspace(
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

fn filter_lsp_completion_list_to_workspace(
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

fn filter_lsp_completion_item_to_workspace(
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

fn filter_lsp_code_actions_to_workspace(
    root_path: &str,
    actions: Vec<LanguageServerCodeAction>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    actions
        .into_iter()
        .map(|action| filter_lsp_code_action_to_workspace(root_path, action))
        .collect::<Result<Vec<_>, _>>()
        .map(|actions| actions.into_iter().flatten().collect())
}

fn filter_lsp_code_action_to_workspace(
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

fn has_action_payload(action: &LanguageServerCodeAction) -> bool {
    action.edit.is_some()
        || action.command.is_some()
        || action.data.is_some()
        || action.disabled.is_some()
}

fn filter_lsp_code_lenses_to_workspace(
    root_path: &str,
    lenses: Vec<LanguageServerCodeLens>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    Ok(lenses
        .into_iter()
        .filter_map(|lens| filter_lsp_code_lens_to_workspace(root_path, lens))
        .collect())
}

fn filter_lsp_code_lens_to_workspace(
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

fn filter_lsp_document_links_to_workspace(
    root_path: &str,
    links: Vec<LanguageServerDocumentLink>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    Ok(links
        .into_iter()
        .filter_map(|link| filter_lsp_document_link_to_workspace(root_path, link))
        .collect())
}

fn filter_lsp_document_link_to_workspace(
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

fn filter_lsp_inlay_hints_to_workspace(
    root_path: &str,
    hints: Vec<LanguageServerInlayHint>,
) -> Vec<LanguageServerInlayHint> {
    hints
        .into_iter()
        .map(|hint| filter_lsp_inlay_hint_to_workspace(root_path, hint))
        .collect()
}

fn filter_lsp_inlay_hint_to_workspace(
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

fn filter_lsp_inlay_hint_label_to_workspace(
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

fn filter_lsp_call_hierarchy_items_to_workspace(
    root_path: &str,
    items: Vec<LanguageServerCallHierarchyItem>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    Ok(items
        .into_iter()
        .filter(|item| is_lsp_file_uri_in_workspace(root_path, &item.uri))
        .collect())
}

fn filter_lsp_incoming_calls_to_workspace(
    root_path: &str,
    calls: Vec<LanguageServerIncomingCall>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    Ok(calls
        .into_iter()
        .filter(|call| is_lsp_file_uri_in_workspace(root_path, &call.from.uri))
        .collect())
}

fn filter_lsp_outgoing_calls_to_workspace(
    root_path: &str,
    calls: Vec<LanguageServerOutgoingCall>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    Ok(calls
        .into_iter()
        .filter(|call| is_lsp_file_uri_in_workspace(root_path, &call.to.uri))
        .collect())
}

fn filter_lsp_type_hierarchy_items_to_workspace(
    root_path: &str,
    items: Vec<LanguageServerTypeHierarchyItem>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    Ok(items
        .into_iter()
        .filter(|item| is_lsp_file_uri_in_workspace(root_path, &item.uri))
        .collect())
}

fn filter_optional_lsp_workspace_edit_to_workspace(
    root_path: &str,
    edit: Option<LanguageServerWorkspaceEdit>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let Some(edit) = edit else {
        return Ok(None);
    };

    filter_lsp_workspace_edit_to_workspace(root_path, edit)
}

fn filter_lsp_workspace_edit_to_workspace(
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

fn is_lsp_file_uri_in_workspace(root_path: &str, uri: &str) -> bool {
    uri.starts_with("file://") && ensure_lsp_uri_in_workspace(root_path, uri).is_ok()
}

fn ensure_lsp_completion_item_payload_in_workspace(
    root_path: &str,
    item: &LanguageServerCompletionItem,
) -> Result<(), String> {
    if let Some(command) = &item.command {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

fn ensure_lsp_code_action_payload_in_workspace(
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

fn ensure_lsp_code_action_context_payloads_in_workspace(
    root_path: &str,
    context: &LanguageServerCodeActionContext,
) -> Result<(), String> {
    for diagnostic in &context.diagnostics {
        ensure_lsp_json_payload_paths_in_workspace(root_path, diagnostic.data.as_ref())?;
    }

    Ok(())
}

fn ensure_lsp_code_lens_payload_in_workspace(
    root_path: &str,
    lens: &LanguageServerCodeLens,
) -> Result<(), String> {
    if let Some(command) = &lens.command {
        ensure_lsp_command_payload_paths_in_workspace(root_path, command)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, lens.data.as_ref())
}

fn ensure_lsp_document_link_payload_in_workspace(
    root_path: &str,
    link: &LanguageServerDocumentLink,
) -> Result<(), String> {
    if let Some(target) = &link.target {
        ensure_lsp_payload_string_in_workspace(root_path, target, true)?;
    }

    ensure_lsp_json_payload_paths_in_workspace(root_path, link.data.as_ref())
}

fn ensure_lsp_inlay_hint_payload_in_workspace(
    root_path: &str,
    hint: &LanguageServerInlayHint,
) -> Result<(), String> {
    ensure_lsp_json_payload_paths_in_workspace(root_path, hint.data.as_ref())?;
    ensure_lsp_inlay_hint_label_payloads_in_workspace(root_path, &hint.label)
}

fn ensure_lsp_inlay_hint_label_payloads_in_workspace(
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

fn ensure_lsp_call_hierarchy_item_in_workspace(
    root_path: &str,
    item: &LanguageServerCallHierarchyItem,
) -> Result<(), String> {
    ensure_lsp_uri_in_workspace(root_path, &item.uri)?;
    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

fn ensure_lsp_type_hierarchy_item_in_workspace(
    root_path: &str,
    item: &LanguageServerTypeHierarchyItem,
) -> Result<(), String> {
    ensure_lsp_uri_in_workspace(root_path, &item.uri)?;
    ensure_lsp_json_payload_paths_in_workspace(root_path, item.data.as_ref())
}

fn ensure_lsp_command_payload_paths_in_workspace(
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

fn ensure_lsp_json_payload_paths_in_workspace(
    root_path: &str,
    payload: Option<&Value>,
) -> Result<(), String> {
    if let Some(payload) = payload {
        ensure_lsp_json_value_paths_in_workspace(root_path, payload, false)?;
    }

    Ok(())
}

fn ensure_lsp_json_value_paths_in_workspace(
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

fn ensure_lsp_payload_string_in_workspace(
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

fn php_file_outline_node_kind_from_symbol(kind: PhpSymbolKind) -> PhpFileOutlineNodeKind {
    match kind {
        PhpSymbolKind::Class => PhpFileOutlineNodeKind::Class,
        PhpSymbolKind::Constant => PhpFileOutlineNodeKind::Constant,
        PhpSymbolKind::Enum => PhpFileOutlineNodeKind::Enum,
        PhpSymbolKind::Function => PhpFileOutlineNodeKind::Function,
        PhpSymbolKind::Interface => PhpFileOutlineNodeKind::Interface,
        PhpSymbolKind::Method => PhpFileOutlineNodeKind::Method,
        PhpSymbolKind::Property => PhpFileOutlineNodeKind::Property,
        PhpSymbolKind::Trait => PhpFileOutlineNodeKind::Trait,
    }
}

fn outline_visibility_from_symbol(visibility: PhpSymbolVisibility) -> OutlineSymbolVisibility {
    match visibility {
        PhpSymbolVisibility::Public => OutlineSymbolVisibility::Public,
        PhpSymbolVisibility::Protected => OutlineSymbolVisibility::Protected,
        PhpSymbolVisibility::Private => OutlineSymbolVisibility::Private,
    }
}

fn outline_parameter_from_symbol(parameter: PhpParameter) -> PhpFileOutlineParameter {
    PhpFileOutlineParameter {
        name: parameter.name,
        type_name: parameter.type_name,
    }
}

fn path_file_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| path.to_string())
}

#[cfg(target_os = "macos")]
fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let close_tab = MenuItemBuilder::with_id(CLOSE_ACTIVE_TAB_MENU_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT_APPLICATION_MENU_ID, "Quit Mockor Editor")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&close_tab)
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let increase_font = MenuItemBuilder::with_id(FONT_ZOOM_IN_MENU_ID, "Increase Editor Font Size")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let decrease_font =
        MenuItemBuilder::with_id(FONT_ZOOM_OUT_MENU_ID, "Decrease Editor Font Size")
            .accelerator("CmdOrCtrl+-")
            .build(app)?;
    let reset_font = MenuItemBuilder::with_id(FONT_ZOOM_RESET_MENU_ID, "Reset Editor Font Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let toggle_ligatures = MenuItemBuilder::with_id(
        TOGGLE_FONT_LIGATURES_MENU_ID,
        "Toggle Editor Font Ligatures",
    )
    .build(app)?;
    let appearance_settings =
        MenuItemBuilder::with_id(OPEN_APPEARANCE_SETTINGS_MENU_ID, "Open Appearance Settings")
            .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&increase_font)
        .item(&decrease_font)
        .item(&reset_font)
        .separator()
        .item(&toggle_ligatures)
        .separator()
        .item(&appearance_settings)
        .build()?;

    Menu::with_items(app, &[&file, &edit, &view])
}

fn resolve_workspace_path(root_path: &Path, path: &str) -> Result<PathBuf, String> {
    ensure_path_in_workspace(root_path, path)?;
    Ok(normalize_path(&absolute_workspace_candidate(
        root_path, path,
    )))
}

fn absolute_workspace_candidate(root_path: &Path, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);

    if candidate.is_absolute() {
        return candidate;
    }

    root_path.join(candidate)
}

fn resolve_existing_or_parent_path(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components: Vec<OsString> = Vec::new();

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

fn build_php_language_server_plan(
    root_path: &str,
    trust: &Mutex<WorkspaceTrustService>,
    php_backend: Option<&str>,
    phpactor_path: Option<&str>,
    intelephense_path: Option<&str>,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(root_path);
    let trusted = {
        let service = trust.lock().map_err(|error| error.to_string())?;
        service.get(root_path).trusted
    };
    let descriptor = ComposerWorkspaceDetector::default()
        .detect(&root)
        .map_err(|error| error.to_string())?;
    let tools = LocalPhpToolDetector
        .detect(Some(&root))
        .map_err(|error| error.to_string())?;
    let settings =
        PhpLanguageServerSettings::from_options(php_backend, phpactor_path, intelephense_path);

    Ok(PhpactorLanguageServerPlanner::new().plan(&root, trusted, &descriptor, &tools, &settings))
}

fn build_javascript_typescript_language_server_plan(
    root_path: &str,
    type_script_version_preference: Option<&str>,
    auto_imports_enabled: Option<bool>,
    automatic_type_acquisition_enabled: Option<bool>,
    code_lens_enabled: Option<bool>,
    complete_function_calls: Option<bool>,
    import_module_specifier_ending: Option<&str>,
    import_module_specifier_preference: Option<&str>,
    inlay_hints_enabled: Option<bool>,
    prefer_type_only_auto_imports: Option<bool>,
    quote_preference: Option<&str>,
    validation_enabled: Option<bool>,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(root_path);
    let preference =
        javascript_typescript_tool_preference_from_setting(type_script_version_preference);
    let settings = TypeScriptLanguageServerSettings {
        auto_imports: auto_imports_enabled.unwrap_or(true),
        automatic_type_acquisition: automatic_type_acquisition_enabled.unwrap_or(false),
        code_lens: code_lens_enabled.unwrap_or(false),
        complete_function_calls: complete_function_calls.unwrap_or(false),
        import_module_specifier_ending: TypeScriptImportModuleSpecifierEnding::from_setting(
            import_module_specifier_ending,
        ),
        import_module_specifier_preference: TypeScriptImportModuleSpecifierPreference::from_setting(
            import_module_specifier_preference,
        ),
        inlay_hints: inlay_hints_enabled.unwrap_or(true),
        prefer_type_only_auto_imports: prefer_type_only_auto_imports.unwrap_or(false),
        quote_preference: TypeScriptQuotePreference::from_setting(quote_preference),
        validation: validation_enabled.unwrap_or(true),
    };
    let tools = LocalJavaScriptTypeScriptToolDetector
        .detect(Some(&root), preference)
        .map_err(|error| error.to_string())?;

    Ok(TypeScriptLanguageServerPlanner::new().plan(&root, &tools, settings))
}

fn javascript_typescript_tool_preference_from_setting(
    value: Option<&str>,
) -> JavaScriptTypeScriptToolPreference {
    match value {
        Some("workspace") => JavaScriptTypeScriptToolPreference::Workspace,
        _ => JavaScriptTypeScriptToolPreference::Bundled,
    }
}

#[tauri::command]
fn plan_php_language_server(
    root_path: String,
    php_backend: Option<String>,
    phpactor_path: Option<String>,
    intelephense_path: Option<String>,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    build_php_language_server_plan(
        &root_path,
        &service,
        php_backend.as_deref(),
        phpactor_path.as_deref(),
        intelephense_path.as_deref(),
    )
}

#[tauri::command]
fn plan_javascript_typescript_language_server(
    root_path: String,
    type_script_version_preference: Option<String>,
    auto_imports_enabled: Option<bool>,
    automatic_type_acquisition_enabled: Option<bool>,
    code_lens_enabled: Option<bool>,
    complete_function_calls: Option<bool>,
    import_module_specifier_ending: Option<String>,
    import_module_specifier_preference: Option<String>,
    inlay_hints_enabled: Option<bool>,
    prefer_type_only_auto_imports: Option<bool>,
    quote_preference: Option<String>,
    validation_enabled: Option<bool>,
) -> Result<LanguageServerPlan, String> {
    build_javascript_typescript_language_server_plan(
        &root_path,
        type_script_version_preference.as_deref(),
        auto_imports_enabled,
        automatic_type_acquisition_enabled,
        code_lens_enabled,
        complete_function_calls,
        import_module_specifier_ending.as_deref(),
        import_module_specifier_preference.as_deref(),
        inlay_hints_enabled,
        prefer_type_only_auto_imports,
        quote_preference.as_deref(),
        validation_enabled,
    )
}

#[tauri::command]
async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    // Directory listing hits the disk; keep it off the main thread so opening a
    // project (loadDirectory) cannot stall the WebView during index I/O.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .read_directory(&PathBuf::from(path))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    // File reads (restored tabs at open) hit the disk; keep them off the main
    // thread to avoid WebView stalls while the indexer contends for disk I/O.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .read_text_file(&PathBuf::from(path))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .rename_path(&PathBuf::from(from), &PathBuf::from(to))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn search_files(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    // File-name search walks the workspace tree; keep it off the main thread.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .search_files(&PathBuf::from(root), &query, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn search_text(
    root: String,
    query: String,
    limit: usize,
    options: Option<TextSearchOptions>,
) -> Result<Vec<TextSearchResult>, String> {
    // Full-text search spawns ripgrep and reads its output; keep it off the main
    // thread so the WebView is not blocked while it runs. `options` is optional so
    // legacy 3-arg callers (no filters) keep the original literal, case-insensitive
    // behaviour.
    let options = options.unwrap_or_default();
    run_blocking_command(move || {
        let searcher = RipgrepTextSearcher;
        searcher
            .search(&PathBuf::from(root), &query, limit, &options)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn replace_in_path(
    root: String,
    query: String,
    replacement: String,
    options: Option<TextSearchOptions>,
    scope_path: Option<String>,
) -> Result<ReplaceInPathResult, String> {
    // Replace-in-Path spawns ripgrep to find the matching files (respecting every
    // Find-in-Path filter) and then rewrites each file's content off the main
    // thread, so the WebView never stalls while many files are edited. The
    // requested `root` is canonicalized and captured up front: every file it
    // touches is verified to live inside that resolved root, so a replace can
    // never escape - or leak into - another workspace tab. `scope_path`, when
    // present, pins a single-file replace to exactly that file regardless of the
    // user file mask.
    let options = options.unwrap_or_default();
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let scope = scope_path.map(PathBuf::from);
        let replacer = RipgrepTextReplacer;
        replacer
            .replace(&root, &query, &replacement, &options, scope.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn search_project_symbols(
    app: AppHandle,
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<ProjectSymbolSearchResult>, String> {
    // Opening the per-workspace SQLite index and scanning it (LIKE + ORDER BY)
    // is blocking and contends with the background indexer; resolve the root and
    // run the whole round-trip off the main thread. The captured `root` keeps
    // this request bound to its own workspace database (no cross-root leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let index = open_workspace_index(&app, &root)?;
        index
            .search_project_symbols(&query, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_php_tree(app: AppHandle, root: String) -> Result<PhpTree, String> {
    // Loading the full workspace symbol tree is a large SQLite read; resolve the
    // requested root and run it off the main thread against that root's database
    // only.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let index = open_workspace_index(&app, &root)?;
        index.load_php_tree().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_php_file_outline(
    app: AppHandle,
    root: String,
    path: String,
) -> Result<PhpFileOutline, String> {
    // Path resolution + the per-file SQLite read both block; resolve the root
    // and run them off the main thread, scoped to the requested workspace.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let path = resolve_workspace_path(&root, &path)?;
        let index = open_workspace_index(&app, &root)?;
        index
            .load_php_file_outline(&path.to_string_lossy())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_status(root_path: String) -> Result<GitStatus, String> {
    // `git status` shells out to a subprocess and, on large Laravel repos, can
    // take hundreds of milliseconds; it fires on every save and tab switch.
    // Resolve the requested root and run it off the main thread so the WebView
    // never stalls. The captured `root_path` keeps the request bound to its own
    // repository (no cross-root leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .status(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_repo_status(root_path: String) -> Result<GitRepoStatus, String> {
    run_blocking_command(move || {
        let root = match canonicalize_workspace_root(&root_path) {
            Ok(root) => root,
            Err(_) => {
                return Ok(GitRepoStatus {
                    git_available: git::git_available(),
                    is_repository: false,
                });
            }
        };
        let is_repository = CommandGitRepositoryGateway
            .status(&root)
            .map(|status| status.is_repository)
            .unwrap_or(false);

        Ok(GitRepoStatus {
            git_available: git::git_available(),
            is_repository,
        })
    })
    .await
}

#[tauri::command]
async fn detect_git_repositories(
    root_path: String,
    max_depth: Option<usize>,
) -> Result<Vec<String>, String> {
    // Discovery walks the whole workspace tree (bounded by `max_depth`)
    // looking for nested `.git` markers, which on a large multi-repo
    // workspace means a lot of `read_dir`/`symlink_metadata` syscalls; run it
    // off the main thread like every other filesystem-heavy command.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let depth = max_depth.unwrap_or(git::DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH);

        git::detect_git_repositories(&root, depth).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_branches(root_path: String) -> Result<GitBranches, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_git_branches(&root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_commit_log(
    root_path: String,
    filters: GitCommitFilters,
) -> Result<Vec<GitCommit>, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_log(&root, filters).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_commit_graph_page(
    root_path: String,
    cursor: Option<String>,
) -> Result<Vec<CommitGraphNode>, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let commits = load_commit_log(
            &root,
            GitCommitFilters {
                author: None,
                branch: None,
                cursor,
                limit: Some(200),
                path: None,
                query: None,
            },
        )
        .map_err(|error| error.to_string())?;

        Ok(commits
            .into_iter()
            .map(|commit| CommitGraphNode {
                children: Vec::new(),
                commit: commit.clone(),
                depth: 0,
                hash: commit.hash,
                is_merge: commit.parents.len() > 1,
            })
            .collect())
    })
    .await
}
#[tauri::command]
async fn get_git_commit_details(
    root_path: String,
    commit_hash: String,
) -> Result<GitCommitDetails, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_details(&root, &commit_hash).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_commit_files(
    root_path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        load_commit_files(&root, &commit_hash).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_commit_diff(
    root_path: String,
    commit_hash: String,
    path: String,
    old_path: Option<String>,
    files: Option<Vec<CommitFileChange>>,
) -> Result<CommitDiffPayload, String> {
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let files = match files {
            Some(files) => files,
            None => load_commit_files(&root, &commit_hash).map_err(|error| error.to_string())?,
        };
        load_commit_diff(&root, &commit_hash, &path, old_path.as_deref(), &files)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_diff(root_path: String, change: GitChangedFile) -> Result<GitFileDiff, String> {
    // Diffing shells out to `git` and reads file contents; it fires alongside
    // status on save/switch, so keep it off the main thread, scoped to the
    // requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .diff(&root, &change)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_blame(
    root_path: String,
    relative_path: String,
) -> Result<Vec<GitBlameLine>, String> {
    // `git blame` shells out to a subprocess that can take a while on large
    // files; keep it off the main thread so the WebView never stalls. The
    // captured `root_path` + `relative_path` bind the request to its own
    // repository and file (no cross-root or cross-file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .blame(&root, &relative_path)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_file_history(
    root_path: String,
    relative_path: String,
) -> Result<Vec<GitFileHistoryEntry>, String> {
    // `git log --follow` shells out to a subprocess that can take a while on a
    // file with deep history; keep it off the main thread so the WebView never
    // stalls. The captured `root_path` + `relative_path` bind the request to its
    // own repository and file (no cross-root or cross-file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .file_history(&root, &relative_path)
            .map_err(|error| error.to_string())
    })
    .await
}

// Rejects a local-history relative path that is absolute or escapes the
// workspace via `..`, so a snapshot/version request can never address content
// outside the requested workspace root (per-workspace isolation).
fn ensure_local_history_relative_path(relative_path: &str) -> Result<(), String> {
    // Normalize Windows separators so `..` traversal expressed with backslashes
    // (which Path::components on Unix would treat as a single filename) is still
    // detected. The store hashes the same normalized form, so this keeps the
    // guard and the storage key in agreement.
    let normalized = relative_path.replace('\\', "/");
    let path = Path::new(&normalized);

    if path.is_absolute() {
        return Err("Local history path must be workspace-relative.".to_string());
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Local history path must stay inside the workspace.".to_string());
    }

    Ok(())
}

#[tauri::command]
async fn record_local_history_snapshot(
    app: AppHandle,
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<Option<LocalHistoryVersion>, String> {
    // Writing a snapshot touches disk (index + content file); keep it off the
    // main thread. The captured `root_path` + `relative_path` bind the snapshot
    // to its own workspace bucket and file (no cross-root or cross-file leak).
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let store = local_history_store(&app)?;
        store.record_snapshot(&root_path, &relative_path, &content)
    })
    .await
}

#[tauri::command]
async fn get_local_history_versions(
    app: AppHandle,
    root_path: String,
    relative_path: String,
) -> Result<Vec<LocalHistoryVersion>, String> {
    // Reading the version index is cheap but still touches disk; keep it off the
    // main thread and scope it to the requested workspace + file.
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let store = local_history_store(&app)?;
        store.list_versions(&root_path, &relative_path)
    })
    .await
}

#[tauri::command]
async fn get_local_history_version_content(
    app: AppHandle,
    root_path: String,
    relative_path: String,
    version_id: String,
) -> Result<String, String> {
    // Reads one snapshot's stored content off the main thread, scoped to the
    // requested workspace + file + version.
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let store = local_history_store(&app)?;
        store.read_version(&root_path, &relative_path, &version_id)
    })
    .await
}

#[tauri::command]
async fn get_git_file_commit_diff(
    root_path: String,
    relative_path: String,
    sha: String,
) -> Result<GitFileDiff, String> {
    // Reading both blob revisions for a historical commit shells out to `git
    // show` twice; keep the round-trip off the main thread. The captured
    // `root_path`, `relative_path`, and `sha` bind the request to its own
    // repository, file, and revision (no cross-root or cross-file leakage). The
    // gateway validates `relative_path` and `sha` before they reach git.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .file_commit_diff(&root, &relative_path, &sha)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn stage_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
) -> Result<GitStatus, String> {
    // Staging shells out to `git add` then re-reads status; keep the round-trip
    // off the main thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .stage(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn unstage_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
) -> Result<GitStatus, String> {
    // Unstaging shells out to `git` and re-reads status; keep it off the main
    // thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .unstage(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_file_hunks(
    root_path: String,
    relative_path: String,
    staged: bool,
) -> Result<Vec<GitDiffHunk>, String> {
    // Reads a single file's `git diff` off the main thread, bound to the
    // requested repository root and file (no cross-root/file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .file_hunks(&root, &relative_path, staged)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn stage_git_hunk(
    root_path: String,
    relative_path: String,
    hunk_index: u32,
) -> Result<GitStatus, String> {
    // Staging one hunk runs `git diff` + `git apply --cached` and re-reads
    // status; keep the round-trip off the main thread, bound to the requested
    // repository root. A rejected patch fails atomically (index untouched).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .stage_hunk(&root, &relative_path, hunk_index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn unstage_git_hunk(
    root_path: String,
    relative_path: String,
    hunk_index: u32,
) -> Result<GitStatus, String> {
    // Unstaging one hunk runs `git diff --cached` + `git apply --cached
    // --reverse` and re-reads status; keep it off the main thread, bound to the
    // requested repository root. A rejected patch fails atomically.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .unstage_hunk(&root, &relative_path, hunk_index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn revert_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
) -> Result<GitStatus, String> {
    // Reverting shells out to `git checkout`/`restore` and re-reads status; keep
    // it off the main thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .revert(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn commit_git_changes(
    root_path: String,
    message: String,
    changes: Vec<GitChangedFile>,
) -> Result<GitStatus, String> {
    // Committing runs several `git` subprocesses (write-tree, commit-tree, ...);
    // keep the whole sequence off the main thread, bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .commit(&root, &message, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn push_git_changes(root_path: String) -> Result<GitStatus, String> {
    // `git push` performs network I/O and can block for seconds; it MUST run off
    // the main thread so the WebView stays responsive. Bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .push(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn save_git_stash(root_path: String, message: String) -> Result<(), String> {
    // `git stash push` shells out and rewrites the working tree; keep it off the
    // main thread, bound to the requested repository root (no cross-root leak).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .stash_save(&root, &message)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_stash_list(root_path: String) -> Result<Vec<GitStashEntry>, String> {
    // Listing stashes shells out to `git stash list`; keep it off the main
    // thread, scoped to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .stash_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn stash_apply_git(root_path: String, index: String) -> Result<(), String> {
    // Applying a stash rewrites the working tree; keep it off the main thread,
    // bound to the requested repository root. The index is validated numerically
    // before it reaches the `stash@{N}` selector (no option/revision injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway
            .stash_apply(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn stash_pop_git(root_path: String, index: String) -> Result<(), String> {
    // Popping a stash applies then drops it; keep it off the main thread, bound
    // to the requested repository root. The index is validated numerically.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway
            .stash_pop(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_stash_diff(root_path: String, index: String) -> Result<String, String> {
    // `git stash show -p` shells out to produce a diff; keep it off the main
    // thread, bound to the requested repository root. The index is validated
    // numerically before it reaches the `stash@{N}` selector.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway
            .stash_show(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn stash_drop_git(root_path: String, index: String) -> Result<(), String> {
    // Dropping a stash is destructive; keep it off the main thread, bound to the
    // requested repository root. The index is validated numerically before it
    // reaches the `stash@{N}` selector (no option/revision injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway
            .stash_drop(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_git_branches(root_path: String) -> Result<Vec<GitBranch>, String> {
    // Listing branches shells out to `git for-each-ref`; keep it off the main
    // thread, scoped to the requested repository root (no cross-root leak).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .branch_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_git_current_branch(root_path: String) -> Result<Option<String>, String> {
    // Resolving the current branch shells out to git; keep it off the main
    // thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .current_branch(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn create_git_branch(root_path: String, name: String) -> Result<(), String> {
    // `git branch <name>` creates a branch WITHOUT switching (the working tree is
    // never touched). Keep it off the main thread, bound to the requested root.
    // The name is validated against git's own ref grammar before it reaches the
    // subprocess (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .create_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn switch_git_branch(root_path: String, name: String) -> Result<(), String> {
    // `git switch <name>` (no `-f`/`--discard`) rewrites the working tree but
    // refuses when local changes would be overwritten, so no work is ever lost.
    // Keep it off the main thread, bound to the requested repository root. The
    // name is validated against git's ref grammar (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway
            .switch_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
fn set_smart_mode(
    mode: IntelligenceMode,
    service: State<'_, Mutex<SmartModeService>>,
    app: AppHandle,
) -> Result<SmartModeState, String> {
    let disables_indexing = matches!(mode, IntelligenceMode::Basic);

    if disables_indexing {
        if let Some(index_lifecycle) = app.try_state::<WorkspaceIndexLifecycle>() {
            index_lifecycle.cancel_all();
        }
    }

    let mut service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.set_mode(mode))
}

#[tauri::command]
fn set_workspace_trust(
    root_path: String,
    trusted: bool,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<WorkspaceTrustState, String> {
    let mut service = service.lock().map_err(|error| error.to_string())?;
    service
        .set(&root_path, trusted)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_php_language_server_status(
    root_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.status(&root_path),
    ))
}

#[tauri::command]
fn get_javascript_typescript_language_server_status(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.status(&root_path),
    ))
}

struct RegistryRuntimeStateSource {
    kind: runtime_observability::LanguageRuntimeKind,
    label: &'static str,
    status: LanguageServerRuntimeStatus,
    pid: Option<u32>,
    recent_requests: Vec<lsp_session::RecentLspRequest>,
    stderr_tail: Vec<String>,
}

impl runtime_observability::RuntimeStateSource for RegistryRuntimeStateSource {
    fn kind(&self) -> runtime_observability::LanguageRuntimeKind {
        self.kind
    }

    fn label(&self) -> String {
        self.label.to_string()
    }

    fn status(&self) -> LanguageServerRuntimeStatus {
        self.status.clone()
    }

    fn pid(&self) -> Option<u32> {
        self.pid
    }

    fn recent_requests(&self) -> Vec<lsp_session::RecentLspRequest> {
        self.recent_requests.clone()
    }

    fn stderr_tail(&self) -> Vec<String> {
        self.stderr_tail.clone()
    }
}

/// Per-workspace runtime observability for the managed language servers. The
/// requested root is read once and every runtime is sampled against that same
/// root, so the report never mixes state from another open project tab.
#[tauri::command]
fn get_runtime_observability(
    root_path: String,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Value, String> {
    let php_source = RegistryRuntimeStateSource {
        kind: runtime_observability::LanguageRuntimeKind::Phpactor,
        label: "PHPactor",
        status: php_registry.status(&root_path),
        pid: php_registry.pid(&root_path),
        recent_requests: php_registry.recent_requests(&root_path),
        stderr_tail: php_registry.stderr_tail(&root_path),
    };
    let typescript_source = RegistryRuntimeStateSource {
        kind: runtime_observability::LanguageRuntimeKind::Tsserver,
        label: "TypeScript language server",
        status: javascript_typescript_registry.status(&root_path),
        pid: javascript_typescript_registry.pid(&root_path),
        recent_requests: javascript_typescript_registry.recent_requests(&root_path),
        stderr_tail: javascript_typescript_registry.stderr_tail(&root_path),
    };

    let report = runtime_observability::build_runtime_observability_report(
        &root_path,
        &[
            &php_source as &dyn runtime_observability::RuntimeStateSource,
            &typescript_source,
        ],
        &runtime_observability::PsProcessStatsProbe,
    );

    serde_json::to_value(report)
        .map_err(|error| format!("Failed to serialize runtime observability: {error}"))
}

/// Stop a single managed runtime for the active workspace root. Isolation: only
/// the registry keyed to `root_path` and `kind` is touched.
#[tauri::command]
fn stop_language_runtime(
    root_path: String,
    kind: String,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
) -> Result<Value, String> {
    let runtime_kind = runtime_observability::LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;

    let status = match runtime_kind {
        runtime_observability::LanguageRuntimeKind::Phpactor => {
            php_registry.stop_preserving_launch_context(&root_path)
        }
        runtime_observability::LanguageRuntimeKind::Tsserver => {
            watch_registry.stop(&root_path);
            javascript_typescript_registry.stop_preserving_launch_context(&root_path)
        }
    };

    Ok(language_server_status_payload(&root_path, status))
}

/// Restart a single managed runtime for the active workspace root, reusing the
/// launch command last used for that root. The blocking re-spawn (handshake can
/// take seconds) runs off the Tauri main thread via `spawn_blocking`; the owned
/// `AppHandle` re-resolves the managed registry inside the worker so nothing
/// borrows command state across the await. Isolation: only the registry keyed to
/// `root_path` and `kind` is touched.
#[tauri::command]
async fn restart_language_runtime(
    root_path: String,
    kind: String,
    app: AppHandle,
) -> Result<Value, String> {
    let runtime_kind = runtime_observability::LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;

    match runtime_kind {
        runtime_observability::LanguageRuntimeKind::Phpactor => {
            restart_php_runtime_off_thread(app, root_path).await
        }
        runtime_observability::LanguageRuntimeKind::Tsserver => {
            restart_typescript_runtime_off_thread(app, root_path).await
        }
    }
}

async fn restart_php_runtime_off_thread(
    app: AppHandle,
    root_path: String,
) -> Result<Value, String> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let event_sink = Arc::new(AppHandleEventSink::for_workspace(
            app.clone(),
            root_path.clone(),
        ));
        let status_sink: Arc<dyn StatusSink> = event_sink.clone();
        let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
        let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
        let refresh_sink: Arc<dyn RefreshSink> = event_sink;
        let registry = app.state::<PhpLanguageServerRegistry>();

        registry
            .restart_with_auto_restart(
                &root_path,
                Arc::new(ChildServerProcessSpawner),
                status_sink,
                diagnostics_sink,
                workspace_edit_sink,
                refresh_sink,
                Arc::new(RestartController::default()),
            )
            .map(|status| language_server_status_payload(&root_path, status))
    })
    .await
    .map_err(|error| format!("Restart task failed: {error}"))??;

    Ok(status)
}

async fn restart_typescript_runtime_off_thread(
    app: AppHandle,
    root_path: String,
) -> Result<Value, String> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let event_sink = Arc::new(AppHandleEventSink::javascript_typescript_for_workspace(
            app.clone(),
            root_path.clone(),
        ));
        let status_sink: Arc<dyn StatusSink> = event_sink.clone();
        let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
        let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
        let refresh_sink: Arc<dyn RefreshSink> = event_sink;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();

        let status = registry.restart_with_auto_restart(
            &root_path,
            Arc::new(ChildServerProcessSpawner),
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            Arc::new(RestartController::default()),
        )?;

        if matches!(status, LanguageServerRuntimeStatus::Running { .. }) {
            let watch_registry = app.state::<JavaScriptTypeScriptWorkspaceWatchRegistry>();
            let _ = watch_registry.start(&root_path, app.clone());
        }

        Ok::<Value, String>(language_server_status_payload(&root_path, status))
    })
    .await
    .map_err(|error| format!("Restart task failed: {error}"))??;

    Ok(status)
}

#[tauri::command]
fn open_language_runtime_log(
    root_path: String,
    kind: String,
    app: AppHandle,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<String, String> {
    let runtime_kind = runtime_observability::LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;
    let (runtime_label, log_file_prefix, mut log) = match runtime_kind {
        runtime_observability::LanguageRuntimeKind::Phpactor => (
            "PHP language server",
            "php-language-server",
            php_registry.log(&root_path),
        ),
        runtime_observability::LanguageRuntimeKind::Tsserver => (
            "JavaScript/TypeScript language server",
            "javascript-typescript-language-server",
            javascript_typescript_registry.log(&root_path),
        ),
    };

    if log.trim().is_empty() {
        log = format!(
            "No {runtime_label} log has been captured for this workspace yet.\n"
        );
    }

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Failed to resolve app log directory: {error}"))?;
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create app log directory: {error}"))?;
    let log_path = log_dir.join(format!(
        "{}-{}.log",
        log_file_prefix,
        sanitized_log_file_stem(&root_path)
    ));

    fs::write(&log_path, log)
        .map_err(|error| format!("Failed to write {runtime_label} log: {error}"))?;
    app.opener()
        .open_path(log_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| format!("Failed to open {runtime_label} log: {error}"))?;

    Ok(log_path.to_string_lossy().to_string())
}

fn sanitized_log_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if stem.is_empty() {
        return "workspace".to_string();
    }

    stem
}

#[tauri::command]
fn start_php_language_server(
    root_path: String,
    php_backend: Option<String>,
    phpactor_path: Option<String>,
    intelephense_path: Option<String>,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    let plan = build_php_language_server_plan(
        &root_path,
        &trust,
        php_backend.as_deref(),
        phpactor_path.as_deref(),
        intelephense_path.as_deref(),
    )?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }

    let command: LanguageServerCommand = plan
        .command
        .ok_or_else(|| "Language server plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or_else(|| "Language server plan is missing an initialize request.".to_string())?;
    #[cfg(unix)]
    if !matches!(
        registry.status(&root_path),
        LanguageServerRuntimeStatus::Starting { .. } | LanguageServerRuntimeStatus::Running { .. }
    ) {
        managed_phpactor::cleanup_orphaned_managed_phpactor_processes(
            &command,
            &root_path,
            &registry.running_roots(),
        );
    }

    let event_sink = Arc::new(AppHandleEventSink::for_workspace(app, root_path.clone()));
    let status_sink: Arc<dyn StatusSink> = event_sink.clone();
    let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
    let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
    let refresh_sink: Arc<dyn RefreshSink> = event_sink;

    let status = registry.start_with_auto_restart(
        &root_path,
        &command,
        &initialize_request,
        Arc::new(ChildServerProcessSpawner),
        status_sink,
        diagnostics_sink,
        workspace_edit_sink,
        refresh_sink,
        Arc::new(RestartController::default()),
    )?;

    Ok(language_server_status_payload(&root_path, status))
}

#[tauri::command]
fn start_javascript_typescript_language_server(
    root_path: String,
    type_script_version_preference: Option<String>,
    auto_imports_enabled: Option<bool>,
    automatic_type_acquisition_enabled: Option<bool>,
    code_lens_enabled: Option<bool>,
    complete_function_calls: Option<bool>,
    import_module_specifier_ending: Option<String>,
    import_module_specifier_preference: Option<String>,
    inlay_hints_enabled: Option<bool>,
    prefer_type_only_auto_imports: Option<bool>,
    quote_preference: Option<String>,
    validation_enabled: Option<bool>,
    app: AppHandle,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
) -> Result<Value, String> {
    let plan = build_javascript_typescript_language_server_plan(
        &root_path,
        type_script_version_preference.as_deref(),
        auto_imports_enabled,
        automatic_type_acquisition_enabled,
        code_lens_enabled,
        complete_function_calls,
        import_module_specifier_ending.as_deref(),
        import_module_specifier_preference.as_deref(),
        inlay_hints_enabled,
        prefer_type_only_auto_imports,
        quote_preference.as_deref(),
        validation_enabled,
    )?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }

    let command: LanguageServerCommand = plan
        .command
        .ok_or_else(|| "Language server plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or_else(|| "Language server plan is missing an initialize request.".to_string())?;
    #[cfg(unix)]
    if !matches!(
        registry.status(&root_path),
        LanguageServerRuntimeStatus::Starting { .. } | LanguageServerRuntimeStatus::Running { .. }
    ) {
        managed_javascript_typescript::cleanup_orphaned_javascript_typescript_processes(
            &command,
            &initialize_request,
            &root_path,
            &registry.running_roots(),
        );
    }

    let watch_app = app.clone();
    let event_sink = Arc::new(AppHandleEventSink::javascript_typescript_for_workspace(
        app,
        root_path.clone(),
    ));
    let status_sink: Arc<dyn StatusSink> = event_sink.clone();
    let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
    let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
    let refresh_sink: Arc<dyn RefreshSink> = event_sink;

    let status = registry.start_with_auto_restart(
        &root_path,
        &command,
        &initialize_request,
        Arc::new(ChildServerProcessSpawner),
        status_sink,
        diagnostics_sink,
        workspace_edit_sink,
        refresh_sink,
        Arc::new(RestartController::default()),
    )?;

    if matches!(status, LanguageServerRuntimeStatus::Running { .. }) {
        let _ = watch_registry.start(&root_path, watch_app);
    }

    Ok(language_server_status_payload(&root_path, status))
}

#[tauri::command]
fn stop_php_language_server(
    root_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.stop(&root_path),
    ))
}

#[tauri::command]
fn stop_javascript_typescript_language_server(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
) -> Result<Value, String> {
    watch_registry.stop(&root_path);
    Ok(language_server_status_payload(
        &root_path,
        registry.stop(&root_path),
    ))
}

#[tauri::command]
fn stop_all_php_language_servers(
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.stop_all())
}

#[tauri::command]
fn stop_all_javascript_typescript_language_servers(
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    watch_registry.stop_all();
    Ok(registry.stop_all())
}

#[tauri::command]
fn start_terminal_session(
    root_path: String,
    profile_id: Option<String>,
    size: TerminalSize,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<TerminalRuntimeStatus, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    let root_label = root.to_string_lossy().to_string();
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_label)
        .trusted;

    if !trusted {
        return Err("Workspace must be trusted to start a terminal.".to_string());
    }

    let sink = Arc::new(AppHandleTerminalEventSink::new(app));
    let profile_provider = LocalTerminalProfileProvider;
    let profile = profile_provider.resolve_profile(profile_id.as_deref())?;
    supervisor.start(root, size, profile, &PortablePtySpawner, sink)
}

#[tauri::command]
fn list_terminal_profiles() -> Result<Vec<TerminalProfile>, String> {
    let profile_provider = LocalTerminalProfileProvider;
    Ok(profile_provider.profiles())
}

#[tauri::command]
fn write_terminal_input(
    session_id: u64,
    data: String,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    supervisor.write_input(session_id, &data)
}

#[tauri::command]
fn resize_terminal_session(
    session_id: u64,
    size: TerminalSize,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    supervisor.resize(session_id, size)
}

#[tauri::command]
fn stop_terminal_session(
    session_id: u64,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<TerminalRuntimeStatus, String> {
    supervisor.stop(session_id)
}

#[tauri::command]
fn stop_terminal_sessions_for_root(
    root_path: String,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    let root = canonicalize_workspace_root(&root_path)?;
    supervisor.stop_root(&root)
}

#[tauri::command]
fn stop_all_terminal_sessions(supervisor: State<'_, TerminalSupervisor>) -> Result<(), String> {
    supervisor.stop_all();
    Ok(())
}

#[tauri::command]
fn text_document_did_open(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_open(&document))
}

#[tauri::command]
fn text_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_change(&document))
}

#[tauri::command]
fn text_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_save(&document))
}

#[tauri::command]
fn text_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_path_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_close(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_open(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_open(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_change(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_save(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_path_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_close(&document))
}

#[tauri::command]
async fn text_document_hover(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_hover(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
async fn text_document_completion(
    root_path: String,
    position: TextDocumentPosition,
    context: Option<LanguageServerCompletionContext>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&TextDocumentCompletion { position, context });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    filter_lsp_completion_list_to_workspace(&root_path, parse_completion_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_completion(
    root_path: String,
    position: TextDocumentPosition,
    context: Option<LanguageServerCompletionContext>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&TextDocumentCompletion { position, context });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    filter_lsp_completion_list_to_workspace(&root_path, parse_completion_result(&result)?)
}

#[tauri::command]
async fn text_document_completion_resolve(
    root_path: String,
    item: LanguageServerCompletionItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCompletionItem, String> {
    ensure_lsp_completion_item_payload_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_completion_item(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(item);
    };

    parse_completion_item_result(&result)
        .map(|item| filter_lsp_completion_item_to_workspace(&root_path, item))
        .map_err(|error| format!("Language server returned a malformed completion item: {error}"))
}

#[tauri::command]
async fn javascript_typescript_text_document_completion_resolve(
    root_path: String,
    item: LanguageServerCompletionItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCompletionItem, String> {
    ensure_lsp_completion_item_payload_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_completion_item(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(item);
    };

    parse_completion_item_result(&result)
        .map(|item| filter_lsp_completion_item_to_workspace(&root_path, item))
        .map_err(|error| format!("Language server returned a malformed completion item: {error}"))
}

#[tauri::command]
async fn text_document_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.definition(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn text_document_declaration(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.declaration(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.definition(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_declaration(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.declaration(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_source_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.typescript_source_definition(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
async fn text_document_implementation(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position);
    let result = match registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    {
        Some(result) => result,
        None => return Ok(Vec::new()),
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_implementation(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position);
    let result = match registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    {
        Some(result) => result,
        None => return Ok(Vec::new()),
    };

    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
async fn text_document_type_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_definition(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_type_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_definition(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
async fn text_document_references(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_references(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn text_document_prepare_rename(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_rename(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_prepare_rename_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_prepare_rename(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_rename(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_prepare_rename_result(&result)
}

#[tauri::command]
async fn text_document_rename(
    root_path: String,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_text_document_rename(
    root_path: String,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
async fn text_document_code_actions(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;
    ensure_lsp_code_action_context_payloads_in_workspace(&root_path, &context)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_code_actions_to_workspace(&root_path, parse_code_action_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_code_actions(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;
    ensure_lsp_code_action_context_payloads_in_workspace(&root_path, &context)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_code_actions_to_workspace(&root_path, parse_code_action_result(&result)?)
}

/// Whether the running server advertises `codeActionProvider.resolveProvider`.
///
/// Some servers (notably phpactor) advertise `codeActionProvider` but ship lazy
/// code actions without a `codeAction/resolve` handler. Sending the resolve
/// request anyway returns a JSON-RPC "Handler codeAction/resolve not found"
/// error that surfaces to the user as a confusing notice. When this returns
/// `false` the resolve request must be skipped and the action returned
/// unchanged.
fn lsp_status_supports_code_action_resolve(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Running { capabilities, .. }
            if capabilities.code_action_resolve
    )
}

#[tauri::command]
async fn text_document_code_action_resolve(
    root_path: String,
    action: LanguageServerCodeAction,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, String> {
    ensure_lsp_code_action_payload_in_workspace(&root_path, &action)?;

    if !lsp_status_supports_code_action_resolve(&registry.status(&root_path)) {
        return Ok(action);
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_action(&action);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(action);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeAction>(result)
        .map_err(|error| format!("Language server returned a malformed code action: {error}"))?;

    Ok(filter_lsp_code_action_to_workspace(&root_path, resolved)?.unwrap_or(action))
}

#[tauri::command]
async fn javascript_typescript_text_document_code_action_resolve(
    root_path: String,
    action: LanguageServerCodeAction,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, String> {
    ensure_lsp_code_action_payload_in_workspace(&root_path, &action)?;

    if !lsp_status_supports_code_action_resolve(&registry.status(&root_path)) {
        return Ok(action);
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_action(&action);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(action);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeAction>(result)
        .map_err(|error| format!("Language server returned a malformed code action: {error}"))?;

    Ok(filter_lsp_code_action_to_workspace(&root_path, resolved)?.unwrap_or(action))
}

#[tauri::command]
async fn text_document_code_lenses(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_lenses(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    let lenses = serde_json::from_value::<Vec<LanguageServerCodeLens>>(result)
        .map_err(|error| format!("Language server returned malformed code lenses: {error}"))?;

    filter_lsp_code_lenses_to_workspace(&root_path, lenses)
}

#[tauri::command]
async fn javascript_typescript_text_document_code_lenses(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_lenses(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    let lenses = serde_json::from_value::<Vec<LanguageServerCodeLens>>(result)
        .map_err(|error| format!("Language server returned malformed code lenses: {error}"))?;

    filter_lsp_code_lenses_to_workspace(&root_path, lenses)
}

#[tauri::command]
async fn text_document_code_lens_resolve(
    root_path: String,
    lens: LanguageServerCodeLens,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCodeLens, String> {
    ensure_lsp_code_lens_payload_in_workspace(&root_path, &lens)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_lens(&lens);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(lens);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeLens>(result)
        .map_err(|error| format!("Language server returned a malformed code lens: {error}"))?;

    Ok(filter_lsp_code_lens_to_workspace(&root_path, resolved).unwrap_or(lens))
}

#[tauri::command]
async fn javascript_typescript_text_document_code_lens_resolve(
    root_path: String,
    lens: LanguageServerCodeLens,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCodeLens, String> {
    ensure_lsp_code_lens_payload_in_workspace(&root_path, &lens)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_lens(&lens);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(lens);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeLens>(result)
        .map_err(|error| format!("Language server returned a malformed code lens: {error}"))?;

    Ok(filter_lsp_code_lens_to_workspace(&root_path, resolved).unwrap_or(lens))
}

#[tauri::command]
async fn text_document_prepare_call_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_call_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_call_hierarchy_items_to_workspace(
        &root_path,
        parse_call_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_text_document_prepare_call_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_call_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_call_hierarchy_items_to_workspace(
        &root_path,
        parse_call_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn text_document_incoming_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.incoming_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_incoming_calls_to_workspace(&root_path, parse_incoming_calls_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_incoming_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.incoming_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_incoming_calls_to_workspace(&root_path, parse_incoming_calls_result(&result)?)
}

#[tauri::command]
async fn text_document_outgoing_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.outgoing_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_outgoing_calls_to_workspace(&root_path, parse_outgoing_calls_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_outgoing_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.outgoing_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_outgoing_calls_to_workspace(&root_path, parse_outgoing_calls_result(&result)?)
}

#[tauri::command]
async fn text_document_prepare_type_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_type_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_text_document_prepare_type_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_type_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn text_document_type_hierarchy_supertypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_supertypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_text_document_type_hierarchy_supertypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_supertypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn text_document_type_hierarchy_subtypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_subtypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_text_document_type_hierarchy_subtypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_subtypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
async fn language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
async fn language_server_execute_command_locations(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
async fn javascript_typescript_language_server_execute_command_locations(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_workspace_will_create_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_create_files(&[WorkspaceFileCreate { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn javascript_typescript_workspace_did_create_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_create_files(&[WorkspaceFileCreate { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
async fn javascript_typescript_workspace_will_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_rename_files(&[WorkspaceFileRename { old_path, new_path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn javascript_typescript_workspace_did_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_rename_files(&[WorkspaceFileRename { old_path, new_path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
async fn javascript_typescript_workspace_will_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_delete_files(&[WorkspaceFileDelete { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn javascript_typescript_workspace_did_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_delete_files(&[WorkspaceFileDelete { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
async fn text_document_will_create_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_create_files(&[WorkspaceFileCreate { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn workspace_did_create_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_create_files(&[WorkspaceFileCreate { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
async fn text_document_will_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_rename_files(&[WorkspaceFileRename { old_path, new_path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn workspace_did_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_rename_files(&[WorkspaceFileRename { old_path, new_path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
async fn text_document_will_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_delete_files(&[WorkspaceFileDelete { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
fn workspace_did_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_delete_files(&[WorkspaceFileDelete { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
fn javascript_typescript_workspace_did_change_watched_files(
    root_path: String,
    changes: Vec<WorkspaceFileChange>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    for change in &changes {
        ensure_lsp_path_in_workspace(&root_path, &change.path)?;
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_watched_files(&changes);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
fn javascript_typescript_workspace_did_change_configuration(
    root_path: String,
    settings: Value,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_configuration(
        javascript_typescript_did_change_configuration_settings(&settings),
    );

    registry.update_server_configuration(&root_path, settings)?;
    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

fn javascript_typescript_did_change_configuration_settings(settings: &Value) -> Value {
    let mut language_settings = settings.clone();

    if let Some(object) = language_settings.as_object_mut() {
        object.remove("formattingOptions");
        object.remove("implicitProjectConfiguration");
    }

    let mut notification_settings = json!({
        "javascript": language_settings.clone(),
        "typescript": language_settings,
    });

    if let Some(object) = notification_settings.as_object_mut() {
        if let Some(value) = settings.get("formattingOptions") {
            object.insert("formattingOptions".to_string(), value.clone());
        }

        if let Some(value) = settings.get("implicitProjectConfiguration") {
            object.insert("implicitProjectConfiguration".to_string(), value.clone());
        }
    }

    notification_settings
}

#[tauri::command]
async fn text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn text_document_on_type_formatting(
    root_path: String,
    path: String,
    position: LanguageServerPosition,
    ch: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.on_type_formatting(&TextDocumentOnTypeFormatting {
        path,
        position,
        ch,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_on_type_formatting(
    root_path: String,
    path: String,
    position: LanguageServerPosition,
    ch: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.on_type_formatting(&TextDocumentOnTypeFormatting {
        path,
        position,
        ch,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn text_document_range_formatting(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_formatting(&TextDocumentRangeFormatting {
        path,
        range,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_range_formatting(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_formatting(&TextDocumentRangeFormatting {
        path,
        range,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
async fn text_document_inlay_hints(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerInlayHint>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.inlay_hints(&TextDocumentInlayHintRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    Ok(filter_lsp_inlay_hints_to_workspace(
        &root_path,
        parse_inlay_hints_result(&result)?,
    ))
}

#[tauri::command]
async fn text_document_inlay_hint_resolve(
    root_path: String,
    hint: LanguageServerInlayHint,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerInlayHint, String> {
    ensure_lsp_inlay_hint_payload_in_workspace(&root_path, &hint)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_inlay_hint(&hint);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(hint);
    };

    Ok(filter_lsp_inlay_hint_to_workspace(
        &root_path,
        parse_inlay_hint_result(&result)?,
    ))
}

#[tauri::command]
async fn javascript_typescript_text_document_inlay_hints(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerInlayHint>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.inlay_hints(&TextDocumentInlayHintRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    Ok(filter_lsp_inlay_hints_to_workspace(
        &root_path,
        parse_inlay_hints_result(&result)?,
    ))
}

#[tauri::command]
async fn javascript_typescript_text_document_inlay_hint_resolve(
    root_path: String,
    hint: LanguageServerInlayHint,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerInlayHint, String> {
    ensure_lsp_inlay_hint_payload_in_workspace(&root_path, &hint)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_inlay_hint(&hint);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(hint);
    };

    Ok(filter_lsp_inlay_hint_to_workspace(
        &root_path,
        parse_inlay_hint_result(&result)?,
    ))
}

#[tauri::command]
async fn text_document_document_symbols(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_symbols(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_symbols_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_document_symbols(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_symbols(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_symbols_result(&result)
}

#[tauri::command]
async fn text_document_document_highlights(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_highlights(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_highlights_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_document_highlights(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_highlights(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_highlights_result(&result)
}

#[tauri::command]
async fn text_document_document_links(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_links(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_document_links_to_workspace(&root_path, parse_document_links_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_text_document_document_links(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_links(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_document_links_to_workspace(&root_path, parse_document_links_result(&result)?)
}

#[tauri::command]
async fn text_document_document_link_resolve(
    root_path: String,
    link: LanguageServerDocumentLink,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerDocumentLink, String> {
    ensure_lsp_document_link_payload_in_workspace(&root_path, &link)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_document_link(&link);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(link);
    };

    let resolved = serde_json::from_value::<LanguageServerDocumentLink>(result)
        .map_err(|error| format!("Language server returned a malformed document link: {error}"))?;

    Ok(filter_lsp_document_link_to_workspace(&root_path, resolved).unwrap_or(link))
}

#[tauri::command]
async fn javascript_typescript_text_document_document_link_resolve(
    root_path: String,
    link: LanguageServerDocumentLink,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerDocumentLink, String> {
    ensure_lsp_document_link_payload_in_workspace(&root_path, &link)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_document_link(&link);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(link);
    };

    let resolved = serde_json::from_value::<LanguageServerDocumentLink>(result)
        .map_err(|error| format!("Language server returned a malformed document link: {error}"))?;

    Ok(filter_lsp_document_link_to_workspace(&root_path, resolved).unwrap_or(link))
}

#[tauri::command]
async fn text_document_folding_ranges(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerFoldingRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.folding_ranges(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_folding_ranges_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_folding_ranges(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerFoldingRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.folding_ranges(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_folding_ranges_result(&result)
}

#[tauri::command]
async fn workspace_symbols(
    root_path: String,
    query: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.workspace_symbols(&query);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_workspace_symbols_to_workspace(&root_path, parse_workspace_symbols_result(&result)?)
}

#[tauri::command]
async fn javascript_typescript_workspace_symbols(
    root_path: String,
    query: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.workspace_symbols(&query);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_workspace_symbols_to_workspace(&root_path, parse_workspace_symbols_result(&result)?)
}

#[tauri::command]
async fn text_document_selection_ranges(
    root_path: String,
    path: String,
    positions: Vec<LanguageServerPosition>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerSelectionRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.selection_ranges(&TextDocumentSelectionRange { path, positions });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_selection_ranges_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_selection_ranges(
    root_path: String,
    path: String,
    positions: Vec<LanguageServerPosition>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerSelectionRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.selection_ranges(&TextDocumentSelectionRange { path, positions });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_selection_ranges_result(&result)
}

#[tauri::command]
async fn text_document_linked_editing_ranges(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.linked_editing_ranges(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_linked_editing_ranges_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_linked_editing_ranges(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.linked_editing_ranges(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_linked_editing_ranges_result(&result)
}

#[tauri::command]
async fn text_document_semantic_tokens(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
async fn text_document_range_semantic_tokens(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_semantic_tokens(&TextDocumentRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_semantic_tokens(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_range_semantic_tokens(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_semantic_tokens(&TextDocumentRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
async fn text_document_signature_help(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSignatureHelp>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp {
        position,
        context: None,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_signature_help_result(&result)
}

#[tauri::command]
async fn javascript_typescript_text_document_signature_help(
    root_path: String,
    position: TextDocumentPosition,
    context: Option<LanguageServerSignatureHelpContext>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSignatureHelp>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp { position, context });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_signature_help_result(&result)
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    // Every save writes to disk; keep the write off the main thread so the
    // WebView never stalls while persisting a document.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .write_text_file(&PathBuf::from(path), &content)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn apply_workspace_edit(
    root_path: String,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: Vec<String>,
) -> Result<usize, String> {
    // A cross-file rename/refactor writes an unbounded number of files in a
    // loop; run the whole apply off the main thread, scoped to the requested
    // workspace root (path guard rejects anything outside it).
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        ensure_lsp_workspace_edit_paths_in_workspace(&root_path, &edit)?;
        let file_operation_count =
            apply_workspace_file_operations(&repository, &edit.file_operations)?;
        let edits = workspace_text_edits_from_language_server(edit)?;

        let text_edit_count = apply_text_edits_to_files(&repository, &edits, &skipped_paths)
            .map_err(|error| error.to_string())?;

        Ok(file_operation_count + text_edit_count)
    })
    .await
}

fn apply_workspace_file_operations(
    repository: &dyn WorkspaceFileRepository,
    operations: &[LanguageServerWorkspaceFileOperation],
) -> Result<usize, String> {
    let mut changed_paths = 0;

    for operation in operations {
        changed_paths += apply_workspace_file_operation(repository, operation)?;
    }

    Ok(changed_paths)
}

fn apply_workspace_file_operation(
    repository: &dyn WorkspaceFileRepository,
    operation: &LanguageServerWorkspaceFileOperation,
) -> Result<usize, String> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, options } => {
            apply_create_file_operation(repository, uri, options.as_ref())
        }
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri,
            new_uri,
            options,
        } => apply_rename_file_operation(repository, old_uri, new_uri, options.as_ref()),
        LanguageServerWorkspaceFileOperation::Delete { uri, options } => {
            apply_delete_file_operation(repository, uri, options.as_ref())
        }
    }
}

fn apply_create_file_operation(
    repository: &dyn WorkspaceFileRepository,
    uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(path) = path_from_file_uri(uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_exists) {
            return Ok(0);
        }

        if workspace_file_option(options, |options| options.overwrite) {
            repository
                .write_text_file(&path, "")
                .map_err(|error| error.to_string())?;
            return Ok(1);
        }

        return Err("Cannot create file because target already exists.".to_string());
    }

    repository
        .create_text_file(&path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn apply_rename_file_operation(
    repository: &dyn WorkspaceFileRepository,
    old_uri: &str,
    new_uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(old_path) = path_from_file_uri(old_uri).map(PathBuf::from) else {
        return Ok(0);
    };
    let Some(new_path) = path_from_file_uri(new_uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if old_path == new_path {
        return Ok(0);
    }

    if !old_path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_not_exists) {
            return Ok(0);
        }

        return Err("Cannot rename file because source does not exist.".to_string());
    }

    if new_path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_exists) {
            return Ok(0);
        }

        if workspace_file_option(options, |options| options.overwrite) {
            repository
                .delete_path(&new_path)
                .map_err(|error| error.to_string())?;
        } else {
            return Err("Cannot rename file because target already exists.".to_string());
        }
    }

    repository
        .rename_path(&old_path, &new_path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn apply_delete_file_operation(
    repository: &dyn WorkspaceFileRepository,
    uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(path) = path_from_file_uri(uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if !path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_not_exists) {
            return Ok(0);
        }

        return Err("Cannot delete file because path does not exist.".to_string());
    }

    if path.is_dir() && !workspace_file_option(options, |options| options.recursive) {
        return Err("Cannot delete directory without the recursive option.".to_string());
    }

    repository
        .delete_path(&path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn workspace_file_option(
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
    pick: impl FnOnce(&LanguageServerWorkspaceFileOperationOptions) -> Option<bool>,
) -> bool {
    options.and_then(pick).unwrap_or(false)
}

fn workspace_text_edits_from_language_server(
    edit: LanguageServerWorkspaceEdit,
) -> Result<Vec<WorkspaceTextEdit>, String> {
    let mut edits = Vec::new();

    for (uri, uri_edits) in edit.changes {
        let Some(path) = path_from_file_uri(&uri) else {
            continue;
        };

        for text_edit in uri_edits {
            edits.push(WorkspaceTextEdit {
                path: path.clone(),
                range: WorkspaceTextRange {
                    start: WorkspaceTextPosition {
                        line: text_edit.range.start.line,
                        character: text_edit.range.start.character,
                    },
                    end: WorkspaceTextPosition {
                        line: text_edit.range.end.line,
                        character: text_edit.range.end.character,
                    },
                },
                new_text: text_edit.new_text,
            });
        }
    }

    Ok(edits)
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

#[cfg(test)]
mod tests {
    use super::{
        apply_workspace_edit, cached_monospace_font_families, create_git_branch,
        ensure_local_history_relative_path, ensure_lsp_call_hierarchy_item_in_workspace,
        ensure_lsp_code_action_context_payloads_in_workspace,
        ensure_lsp_code_action_payload_in_workspace, ensure_lsp_code_lens_payload_in_workspace,
        ensure_lsp_completion_item_payload_in_workspace,
        ensure_lsp_document_link_payload_in_workspace, ensure_lsp_inlay_hint_payload_in_workspace,
        ensure_lsp_path_in_workspace, ensure_lsp_position_in_workspace,
        ensure_lsp_text_document_content_in_workspace, ensure_lsp_text_document_path_in_workspace,
        ensure_lsp_type_hierarchy_item_in_workspace, ensure_lsp_workspace_edit_paths_in_workspace,
        ensure_path_in_workspace, enumerate_monospace_font_families,
        filter_lsp_call_hierarchy_items_to_workspace, filter_lsp_code_actions_to_workspace,
        filter_lsp_code_lenses_to_workspace, filter_lsp_completion_list_to_workspace,
        filter_lsp_document_links_to_workspace, filter_lsp_incoming_calls_to_workspace,
        filter_lsp_inlay_hints_to_workspace, filter_lsp_locations_to_workspace,
        filter_lsp_outgoing_calls_to_workspace, filter_lsp_type_hierarchy_items_to_workspace,
        filter_lsp_workspace_edit_to_workspace, filter_lsp_workspace_symbols_to_workspace,
        get_git_blame, get_git_current_branch, get_git_file_commit_diff, get_git_file_history,
        get_git_file_hunks, get_git_stash_diff, get_git_stash_list, get_git_status,
        javascript_typescript_did_change_configuration_settings, list_git_branches,
        lsp_status_supports_code_action_resolve, normalize_path, parse_definition_result,
        parse_javascript_typescript_navigation_locations_result, parse_php_file_outline,
        parse_php_syntax, path_from_file_uri, read_directory, read_text_file, save_git_stash,
        search_files, stage_git_files, stage_git_hunk, stash_apply_git, stash_drop_git,
        stash_pop_git, switch_git_branch, unstage_git_hunk, workspace_root_for_disposal,
        workspace_text_edits_from_language_server, write_text_file,
    };
    use crate::lsp::file_uri;
    use crate::lsp_document::{TextDocumentContent, TextDocumentPath};
    use crate::lsp_features::{
        LanguageServerCallHierarchyItem, LanguageServerCodeAction, LanguageServerCodeActionCommand,
        LanguageServerCodeActionContext, LanguageServerCodeLens, LanguageServerCompletionItem,
        LanguageServerCompletionList, LanguageServerDocumentLink, LanguageServerIncomingCall,
        LanguageServerInlayHint, LanguageServerInlayHintLabel, LanguageServerLocation,
        LanguageServerOutgoingCall, LanguageServerPosition, LanguageServerRange,
        LanguageServerTextEdit, LanguageServerTypeHierarchyItem, LanguageServerWorkspaceEdit,
        LanguageServerWorkspaceFileOperation, LanguageServerWorkspaceFileOperationOptions,
        LanguageServerWorkspaceSymbol, TextDocumentPosition,
    };
    use crate::lsp_session::{LanguageServerCapabilities, LanguageServerRuntimeStatus};
    use crate::php_file_outline::PhpFileOutlineNodeKind;
    use crate::workspace::FileEntryKind;
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::OnceLock;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn index_path_guard_accepts_workspace_paths() {
        let root = temp_workspace("accepts");
        let source_directory = root.join("src");
        fs::create_dir_all(&source_directory).expect("source directory");
        fs::write(source_directory.join("User.php"), "<?php").expect("source file");

        assert!(ensure_path_in_workspace(&root, &path_string(&root.join("src/User.php"))).is_ok());
        assert!(ensure_path_in_workspace(&root, "src/Missing.php").is_ok());
        assert!(ensure_path_in_workspace(
            &root,
            &path_string(&root.join(".").join("src/User.php"))
        )
        .is_ok());
    }

    #[test]
    fn javascript_typescript_configuration_notifications_use_language_namespaces() {
        let settings = json!({
            "format": {
                "insertSpaceAfterCommaDelimiter": true,
            },
            "formattingOptions": {
                "insertSpaces": false,
                "tabSize": 8,
            },
            "implicitProjectConfiguration": {
                "checkJs": false,
                "strict": true,
                "target": 11,
            },
            "implementationsCodeLens": {
                "enabled": true,
            },
            "inlayHints": {
                "functionLikeReturnTypes": { "enabled": false },
                "parameterNames": {
                    "enabled": "none",
                    "suppressWhenArgumentMatchesName": false,
                },
            },
            "referencesCodeLens": {
                "enabled": true,
                "showOnAllFunctions": false,
            },
            "preferences": {
                "importModuleSpecifierEnding": "minimal",
            },
            "suggest": {
                "autoImports": false,
                "includeCompletionsForModuleExports": false,
            },
            "validate": {
                "enable": false,
            },
        });

        let notification = javascript_typescript_did_change_configuration_settings(&settings);

        for language in ["javascript", "typescript"] {
            assert_eq!(notification[language]["suggest"]["autoImports"], false);
            assert_eq!(
                notification[language]["inlayHints"]["parameterNames"]["enabled"],
                "none"
            );
            assert_eq!(
                notification[language]["implementationsCodeLens"]["enabled"],
                true
            );
            assert_eq!(
                notification[language]["referencesCodeLens"]["enabled"],
                true
            );
            assert_eq!(
                notification[language]["format"]["insertSpaceAfterCommaDelimiter"],
                true
            );
            assert_eq!(
                notification[language]["preferences"]["importModuleSpecifierEnding"],
                "minimal"
            );
            assert_eq!(notification[language]["validate"]["enable"], false);
            assert!(notification[language].get("formattingOptions").is_none());
            assert!(notification[language]
                .get("implicitProjectConfiguration")
                .is_none());
        }
        assert_eq!(notification["implicitProjectConfiguration"]["strict"], true);
        assert_eq!(notification["formattingOptions"]["insertSpaces"], false);
        assert_eq!(notification["formattingOptions"]["tabSize"], 8);
    }

    #[test]
    fn index_path_guard_rejects_paths_outside_workspace() {
        let root = temp_workspace("rejects-root");
        let sibling = root
            .parent()
            .expect("workspace parent")
            .join(format!("{}-sibling", unique_suffix()));
        fs::create_dir_all(&sibling).expect("sibling directory");
        fs::write(sibling.join("User.php"), "<?php").expect("sibling file");

        assert!(ensure_path_in_workspace(&root, &path_string(&sibling.join("User.php"))).is_err());
        assert!(ensure_path_in_workspace(&root, "../outside/User.php").is_err());
    }

    #[test]
    fn lsp_path_guard_rejects_document_paths_outside_workspace_root() {
        let root = temp_workspace("lsp-rejects-root");
        let sibling = root
            .parent()
            .expect("workspace parent")
            .join(format!("{}-sibling", unique_suffix()));
        fs::create_dir_all(&sibling).expect("sibling directory");
        fs::write(sibling.join("App.ts"), "export {};").expect("sibling file");

        assert!(ensure_lsp_path_in_workspace(&path_string(&root), "src/App.ts").is_ok());
        assert!(ensure_lsp_path_in_workspace(
            &path_string(&root),
            &path_string(&sibling.join("App.ts"))
        )
        .is_err());
    }

    #[test]
    fn lsp_workspace_edit_guard_rejects_paths_outside_workspace_root() {
        let root = temp_workspace("workspace-edit-guard-root");
        let outside = temp_workspace("workspace-edit-guard-outside");
        let mut inside_changes = BTreeMap::new();
        inside_changes.insert(file_uri(&root.join("src/App.ts")), Vec::new());
        let mut outside_changes = BTreeMap::new();
        outside_changes.insert(file_uri(&outside.join("Secret.ts")), Vec::new());
        let mut non_file_changes = BTreeMap::new();
        non_file_changes.insert("untitled:Scratch.ts".to_string(), Vec::new());
        let inside_operations = vec![
            LanguageServerWorkspaceFileOperation::Create {
                uri: file_uri(&root.join("src/Created.ts")),
                options: None,
            },
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri: file_uri(&root.join("src/Old.ts")),
                new_uri: file_uri(&root.join("src/New.ts")),
                options: None,
            },
            LanguageServerWorkspaceFileOperation::Delete {
                uri: file_uri(&root.join("src/Deleted.ts")),
                options: None,
            },
        ];
        let outside_operations = vec![LanguageServerWorkspaceFileOperation::Rename {
            old_uri: file_uri(&root.join("src/Old.ts")),
            new_uri: file_uri(&outside.join("Secret.ts")),
            options: None,
        }];
        let non_file_operations = vec![LanguageServerWorkspaceFileOperation::Create {
            uri: "https://example.test/Created.ts".to_string(),
            options: None,
        }];

        assert!(ensure_lsp_workspace_edit_paths_in_workspace(
            &path_string(&root),
            &LanguageServerWorkspaceEdit {
                changes: inside_changes,
                document_versions: BTreeMap::new(),
                file_operations: inside_operations,
            }
        )
        .is_ok());
        assert!(ensure_lsp_workspace_edit_paths_in_workspace(
            &path_string(&root),
            &LanguageServerWorkspaceEdit {
                changes: outside_changes,
                document_versions: BTreeMap::new(),
                file_operations: Vec::new(),
            }
        )
        .is_err());
        assert!(ensure_lsp_workspace_edit_paths_in_workspace(
            &path_string(&root),
            &LanguageServerWorkspaceEdit {
                changes: BTreeMap::new(),
                document_versions: BTreeMap::new(),
                file_operations: outside_operations,
            }
        )
        .is_err());
        assert!(ensure_lsp_workspace_edit_paths_in_workspace(
            &path_string(&root),
            &LanguageServerWorkspaceEdit {
                changes: non_file_changes,
                document_versions: BTreeMap::new(),
                file_operations: Vec::new(),
            }
        )
        .is_err());
        assert!(ensure_lsp_workspace_edit_paths_in_workspace(
            &path_string(&root),
            &LanguageServerWorkspaceEdit {
                changes: BTreeMap::new(),
                document_versions: BTreeMap::new(),
                file_operations: non_file_operations,
            }
        )
        .is_err());
    }

    #[test]
    fn lsp_response_workspace_edit_filter_drops_outside_file_uris() {
        let root = temp_workspace("response-workspace-edit-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("response-workspace-edit-outside");
        let inside_uri = file_uri(&root.join("src/App.ts"));
        let sibling_uri = file_uri(&sibling.join("src/App.ts"));
        let outside_uri = file_uri(&outside.join("src/App.ts"));
        let inside_created_uri = file_uri(&root.join("src/Created.ts"));
        let sibling_created_uri = file_uri(&sibling.join("src/Created.ts"));
        let inside_old_uri = file_uri(&root.join("src/Old.ts"));
        let inside_new_uri = file_uri(&root.join("src/New.ts"));

        let mut changes = BTreeMap::new();
        changes.insert(inside_uri.clone(), vec![text_edit("inside")]);
        changes.insert(sibling_uri.clone(), vec![text_edit("sibling")]);
        changes.insert(outside_uri.clone(), vec![text_edit("outside")]);
        let mut document_versions = BTreeMap::new();
        document_versions.insert(inside_uri.clone(), Some(7));
        document_versions.insert(sibling_uri.clone(), Some(8));
        document_versions.insert(outside_uri.clone(), Some(9));

        let filtered = filter_lsp_workspace_edit_to_workspace(
            &path_string(&root),
            LanguageServerWorkspaceEdit {
                changes,
                document_versions,
                file_operations: vec![
                    LanguageServerWorkspaceFileOperation::Create {
                        uri: inside_created_uri.clone(),
                        options: None,
                    },
                    LanguageServerWorkspaceFileOperation::Create {
                        uri: sibling_created_uri,
                        options: None,
                    },
                    LanguageServerWorkspaceFileOperation::Rename {
                        old_uri: inside_old_uri.clone(),
                        new_uri: inside_new_uri.clone(),
                        options: None,
                    },
                    LanguageServerWorkspaceFileOperation::Rename {
                        old_uri: inside_old_uri.clone(),
                        new_uri: sibling_uri,
                        options: None,
                    },
                ],
            },
        )
        .expect("filtered workspace edit")
        .expect("workspace edit with inside changes");

        assert_eq!(filtered.changes.len(), 1);
        assert_eq!(filtered.changes[&inside_uri][0].new_text, "inside");
        assert_eq!(filtered.document_versions.len(), 1);
        assert_eq!(filtered.document_versions[&inside_uri], Some(7));
        assert_eq!(
            filtered.file_operations,
            vec![
                LanguageServerWorkspaceFileOperation::Create {
                    uri: inside_created_uri,
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Rename {
                    old_uri: inside_old_uri,
                    new_uri: inside_new_uri,
                    options: None,
                },
            ]
        );
    }

    #[test]
    fn lsp_response_location_filter_drops_outside_file_uris() {
        let root = temp_workspace("response-location-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("response-location-outside");
        let inside_uri = file_uri(&root.join("src/App.ts"));

        let filtered = filter_lsp_locations_to_workspace(
            &path_string(&root),
            vec![
                location(&inside_uri),
                location(&file_uri(&sibling.join("src/App.ts"))),
                location(&file_uri(&outside.join("src/App.ts"))),
            ],
        )
        .expect("filtered locations");

        assert_eq!(filtered, vec![location(&inside_uri)]);
    }

    #[test]
    fn javascript_typescript_navigation_locations_preserve_external_file_uris() {
        let root = temp_workspace("js-ts-navigation-root");
        let external = temp_workspace("js-ts-navigation-external");
        let inside_uri = file_uri(&root.join("src/App.ts"));
        let external_definition_uri = file_uri(&external.join("node_modules/pkg/index.d.ts"));
        let external_type_uri = file_uri(&external.join("typescript/lib/lib.dom.d.ts"));

        let locations = parse_javascript_typescript_navigation_locations_result(&json!([
            {
                "uri": inside_uri,
                "range": lsp_range(),
            },
            {
                "uri": external_definition_uri,
                "range": lsp_range(),
            },
            {
                "targetUri": external_type_uri,
                "targetRange": lsp_range(),
            }
        ]))
        .expect("navigation locations");

        assert_eq!(
            locations,
            vec![
                location(&inside_uri),
                location(&external_definition_uri),
                location(&external_type_uri),
            ]
        );
    }

    #[test]
    fn javascript_typescript_reference_locations_drop_external_file_uris() {
        let root = temp_workspace("js-ts-references-root");
        let external = temp_workspace("js-ts-references-external");
        let inside_uri = file_uri(&root.join("src/App.ts"));
        let external_uri = file_uri(&external.join("node_modules/pkg/index.d.ts"));
        let reference_locations = parse_definition_result(&json!([
            {
                "uri": inside_uri,
                "range": lsp_range(),
            },
            {
                "uri": external_uri,
                "range": lsp_range(),
            }
        ]))
        .expect("reference locations");

        let filtered = filter_lsp_locations_to_workspace(&path_string(&root), reference_locations)
            .expect("filtered reference locations");

        assert_eq!(filtered, vec![location(&inside_uri)]);
    }

    #[test]
    fn lsp_response_workspace_symbol_filter_drops_outside_file_uris() {
        let root = temp_workspace("response-workspace-symbol-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("response-workspace-symbol-outside");
        let inside_uri = file_uri(&root.join("src/App.ts"));

        let filtered = filter_lsp_workspace_symbols_to_workspace(
            &path_string(&root),
            vec![
                workspace_symbol("App", &inside_uri),
                workspace_symbol("SiblingApp", &file_uri(&sibling.join("src/App.ts"))),
                workspace_symbol("OutsideApp", &file_uri(&outside.join("src/App.ts"))),
            ],
        )
        .expect("filtered workspace symbols");

        assert_eq!(filtered, vec![workspace_symbol("App", &inside_uri)]);
    }

    #[test]
    fn lsp_response_call_hierarchy_filter_drops_outside_file_uris() {
        let root = temp_workspace("response-call-hierarchy-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("response-call-hierarchy-outside");
        let inside_uri = file_uri(&root.join("src/App.ts"));
        let sibling_uri = file_uri(&sibling.join("src/App.ts"));
        let outside_uri = file_uri(&outside.join("src/App.ts"));

        let items = filter_lsp_call_hierarchy_items_to_workspace(
            &path_string(&root),
            vec![
                call_hierarchy_item(&inside_uri),
                call_hierarchy_item(&sibling_uri),
                call_hierarchy_item(&outside_uri),
            ],
        )
        .expect("filtered call hierarchy items");
        let incoming = filter_lsp_incoming_calls_to_workspace(
            &path_string(&root),
            vec![
                incoming_call(&inside_uri),
                incoming_call(&sibling_uri),
                incoming_call(&outside_uri),
            ],
        )
        .expect("filtered incoming calls");
        let outgoing = filter_lsp_outgoing_calls_to_workspace(
            &path_string(&root),
            vec![
                outgoing_call(&inside_uri),
                outgoing_call(&sibling_uri),
                outgoing_call(&outside_uri),
            ],
        )
        .expect("filtered outgoing calls");

        assert_eq!(items, vec![call_hierarchy_item(&inside_uri)]);
        assert_eq!(incoming, vec![incoming_call(&inside_uri)]);
        assert_eq!(outgoing, vec![outgoing_call(&inside_uri)]);
    }

    #[test]
    fn lsp_response_type_hierarchy_filter_drops_outside_file_uris() {
        let root = temp_workspace("response-type-hierarchy-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("response-type-hierarchy-outside");
        let inside_uri = file_uri(&root.join("src/App.ts"));

        let filtered = filter_lsp_type_hierarchy_items_to_workspace(
            &path_string(&root),
            vec![
                type_hierarchy_item(&inside_uri),
                type_hierarchy_item(&file_uri(&sibling.join("src/App.ts"))),
                type_hierarchy_item(&file_uri(&outside.join("src/App.ts"))),
            ],
        )
        .expect("filtered type hierarchy items");

        assert_eq!(filtered, vec![type_hierarchy_item(&inside_uri)]);
    }

    #[test]
    fn lsp_path_guard_rejects_php_document_sync_and_feature_paths_outside_workspace_root() {
        let root = temp_workspace("php-lsp-guard-root");
        let outside = temp_workspace("php-lsp-guard-outside");
        let source_directory = root.join("src");
        fs::create_dir_all(&source_directory).expect("source directory");
        fs::write(source_directory.join("User.php"), "<?php").expect("source file");
        fs::write(outside.join("Secret.php"), "<?php").expect("outside file");
        let root_path = path_string(&root);
        let inside_path = path_string(&source_directory.join("User.php"));
        let outside_path = path_string(&outside.join("Secret.php"));

        assert!(ensure_lsp_text_document_content_in_workspace(
            &root_path,
            &php_document_content(&inside_path)
        )
        .is_ok());
        assert!(ensure_lsp_text_document_content_in_workspace(
            &root_path,
            &php_document_content(&outside_path)
        )
        .is_err());
        assert!(ensure_lsp_text_document_path_in_workspace(
            &root_path,
            &TextDocumentPath {
                path: outside_path.clone()
            }
        )
        .is_err());
        assert!(ensure_lsp_position_in_workspace(
            &root_path,
            &TextDocumentPosition {
                path: outside_path,
                line: 0,
                character: 0,
            }
        )
        .is_err());
    }

    #[test]
    fn lsp_completion_resolve_guard_rejects_outside_payload_paths() {
        let root = temp_workspace("completion-resolve-root");
        let outside = temp_workspace("completion-resolve-outside");
        let inside_item = completion_item(json!({ "file": path_string(&root.join("src/App.ts")) }));
        let outside_path_item =
            completion_item(json!({ "file": path_string(&outside.join("Secret.ts")) }));
        let outside_uri_item = completion_item(json!({
            "uri": file_uri(&outside.join("Secret.ts")),
        }));

        assert!(
            ensure_lsp_completion_item_payload_in_workspace(&path_string(&root), &inside_item)
                .is_ok()
        );
        assert!(ensure_lsp_completion_item_payload_in_workspace(
            &path_string(&root),
            &outside_path_item
        )
        .is_err());
        assert!(ensure_lsp_completion_item_payload_in_workspace(
            &path_string(&root),
            &outside_uri_item
        )
        .is_err());
    }

    #[test]
    fn code_action_resolve_is_gated_on_server_resolve_capability() {
        let running_with_resolve = LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities {
                code_action: true,
                code_action_resolve: true,
                ..LanguageServerCapabilities::default()
            },
        };
        assert!(lsp_status_supports_code_action_resolve(
            &running_with_resolve
        ));

        let running_without_resolve = LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities {
                code_action: true,
                code_action_resolve: false,
                ..LanguageServerCapabilities::default()
            },
        };
        assert!(!lsp_status_supports_code_action_resolve(
            &running_without_resolve
        ));

        assert!(!lsp_status_supports_code_action_resolve(
            &LanguageServerRuntimeStatus::Starting { session_id: 1 }
        ));
        assert!(!lsp_status_supports_code_action_resolve(
            &LanguageServerRuntimeStatus::Stopped
        ));
    }

    #[test]
    fn lsp_code_action_resolve_guard_rejects_outside_edit_and_command_paths() {
        let root = temp_workspace("code-action-resolve-root");
        let outside = temp_workspace("code-action-resolve-outside");
        let inside_action = code_action(json!({
            "edit": {
                "changes": {
                    file_uri(&root.join("src/App.ts")): []
                }
            }
        }));
        let outside_edit_action = code_action(json!({
            "edit": {
                "changes": {
                    file_uri(&outside.join("Secret.ts")): []
                }
            }
        }));
        let outside_command_action = code_action(json!({
            "command": {
                "title": "Organize imports",
                "command": "_typescript.organizeImports",
                "arguments": [file_uri(&outside.join("Secret.ts"))]
            }
        }));

        assert!(
            ensure_lsp_code_action_payload_in_workspace(&path_string(&root), &inside_action)
                .is_ok()
        );
        assert!(ensure_lsp_code_action_payload_in_workspace(
            &path_string(&root),
            &outside_edit_action
        )
        .is_err());
        assert!(ensure_lsp_code_action_payload_in_workspace(
            &path_string(&root),
            &outside_command_action
        )
        .is_err());
    }

    #[test]
    fn lsp_code_action_context_guard_rejects_outside_diagnostic_data() {
        let root = temp_workspace("code-action-context-root");
        let outside = temp_workspace("code-action-context-outside");
        let inside_context = code_action_context(json!({
            "file": path_string(&root.join("src/App.ts")),
        }));
        let outside_path_context = code_action_context(json!({
            "file": path_string(&outside.join("Secret.ts")),
        }));
        let outside_uri_context = code_action_context(json!({
            "uri": file_uri(&outside.join("Secret.ts")),
        }));

        assert!(ensure_lsp_code_action_context_payloads_in_workspace(
            &path_string(&root),
            &inside_context
        )
        .is_ok());
        assert!(ensure_lsp_code_action_context_payloads_in_workspace(
            &path_string(&root),
            &outside_path_context
        )
        .is_err());
        assert!(ensure_lsp_code_action_context_payloads_in_workspace(
            &path_string(&root),
            &outside_uri_context
        )
        .is_err());
    }

    #[test]
    fn lsp_code_lens_and_document_link_resolve_guards_reject_outside_paths() {
        let root = temp_workspace("resolve-payload-root");
        let outside = temp_workspace("resolve-payload-outside");
        let inside_lens = code_lens(json!({
            "data": { "file": path_string(&root.join("src/App.ts")) }
        }));
        let outside_lens = code_lens(json!({
            "command": {
                "title": "3 references",
                "command": "editor.action.showReferences",
                "arguments": [file_uri(&outside.join("Secret.ts"))]
            }
        }));
        let outside_target_link = document_link(json!({
            "target": file_uri(&outside.join("Secret.ts"))
        }));
        let outside_data_link = document_link(json!({
            "data": { "file": path_string(&outside.join("Secret.ts")) }
        }));

        assert!(
            ensure_lsp_code_lens_payload_in_workspace(&path_string(&root), &inside_lens).is_ok()
        );
        assert!(
            ensure_lsp_code_lens_payload_in_workspace(&path_string(&root), &outside_lens).is_err()
        );
        assert!(ensure_lsp_document_link_payload_in_workspace(
            &path_string(&root),
            &outside_target_link
        )
        .is_err());
        assert!(ensure_lsp_document_link_payload_in_workspace(
            &path_string(&root),
            &outside_data_link
        )
        .is_err());
    }

    #[test]
    fn lsp_inlay_hint_resolve_guard_rejects_outside_payload_paths() {
        let root = temp_workspace("inlay-hint-resolve-root");
        let outside = temp_workspace("inlay-hint-resolve-outside");
        let inside_hint = inlay_hint(json!({
            "data": { "file": path_string(&root.join("src/App.ts")) },
            "label": [
                {
                    "label": "App",
                    "command": {
                        "title": "Apply import",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "file": path_string(&root.join("src/App.ts")) }],
                    },
                    "location": location(&file_uri(&root.join("src/App.ts"))),
                },
            ],
        }));
        let outside_data_hint = inlay_hint(json!({
            "data": { "file": path_string(&outside.join("Secret.ts")) },
        }));
        let outside_location_hint = inlay_hint(json!({
            "label": [
                {
                    "label": "Secret",
                    "location": location(&file_uri(&outside.join("Secret.ts"))),
                },
            ],
        }));
        let outside_command_hint = inlay_hint(json!({
            "label": [
                {
                    "label": "Secret",
                    "command": {
                        "title": "Apply import",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "file": path_string(&outside.join("Secret.ts")) }],
                    },
                },
            ],
        }));

        assert!(
            ensure_lsp_inlay_hint_payload_in_workspace(&path_string(&root), &inside_hint).is_ok()
        );
        assert!(ensure_lsp_inlay_hint_payload_in_workspace(
            &path_string(&root),
            &outside_data_hint,
        )
        .is_err());
        assert!(ensure_lsp_inlay_hint_payload_in_workspace(
            &path_string(&root),
            &outside_location_hint,
        )
        .is_err());
        assert!(ensure_lsp_inlay_hint_payload_in_workspace(
            &path_string(&root),
            &outside_command_hint,
        )
        .is_err());
    }

    #[test]
    fn lsp_response_completion_filter_strips_outside_resolve_payloads() {
        let root = temp_workspace("completion-response-filter-root");
        let outside = temp_workspace("completion-response-filter-outside");
        let root_path = path_string(&root);
        let safe_item = completion_item(json!({
            "file": path_string(&root.join("src/App.ts")),
        }));
        let mut unsafe_item = completion_item(json!({
            "file": path_string(&outside.join("Secret.ts")),
        }));
        unsafe_item.command = Some(command_with_argument(file_uri(&outside.join("Secret.ts"))));

        let filtered = filter_lsp_completion_list_to_workspace(
            &root_path,
            LanguageServerCompletionList {
                is_incomplete: true,
                items: vec![safe_item.clone(), unsafe_item],
            },
        )
        .expect("filtered completion list");

        assert!(filtered.is_incomplete);
        assert_eq!(filtered.items.len(), 2);
        assert_eq!(filtered.items[0].data, safe_item.data);
        assert!(filtered.items[1].data.is_none());
        assert!(filtered.items[1].command.is_none());
    }

    #[test]
    fn lsp_response_code_action_filter_keeps_inside_edits_and_drops_unsafe_payloads() {
        let root = temp_workspace("code-action-response-filter-root");
        let sibling = sibling_prefix_workspace(&root, "sibling");
        let outside = temp_workspace("code-action-response-filter-outside");
        let root_path = path_string(&root);
        let inside_uri = file_uri(&root.join("src/App.ts"));
        let sibling_uri = file_uri(&sibling.join("src/App.ts"));
        let outside_uri = file_uri(&outside.join("Secret.ts"));
        let action = code_action(json!({
            "edit": {
                "changes": {
                    inside_uri.clone(): [json_text_edit("inside")],
                    sibling_uri: [json_text_edit("sibling")],
                    outside_uri: [json_text_edit("outside")],
                }
            },
            "command": {
                "title": "Unsafe command",
                "command": "_typescript.applyFix",
                "arguments": [file_uri(&outside.join("Secret.ts"))],
            },
            "data": {
                "file": path_string(&outside.join("Secret.ts")),
            },
        }));
        let inert_action = code_action(json!({
            "command": {
                "title": "Only unsafe command",
                "command": "_typescript.applyFix",
                "arguments": [file_uri(&outside.join("OnlyUnsafe.ts"))],
            },
        }));

        let filtered = filter_lsp_code_actions_to_workspace(&root_path, vec![action, inert_action])
            .expect("filtered code actions");

        assert_eq!(filtered.len(), 1);
        assert!(filtered[0].command.is_none());
        assert!(filtered[0].data.is_none());
        assert_eq!(
            filtered[0]
                .edit
                .as_ref()
                .expect("inside edit")
                .changes
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec![inside_uri]
        );
    }

    #[test]
    fn lsp_response_code_lens_filter_drops_unsafe_commands_and_data() {
        let root = temp_workspace("code-lens-response-filter-root");
        let outside = temp_workspace("code-lens-response-filter-outside");
        let root_path = path_string(&root);
        let safe_lens = code_lens(json!({
            "command": {
                "title": "Show references",
                "command": "editor.action.showReferences",
                "arguments": [file_uri(&root.join("src/App.ts"))],
            },
        }));
        let unsafe_lens = code_lens(json!({
            "command": {
                "title": "Show references",
                "command": "editor.action.showReferences",
                "arguments": [file_uri(&outside.join("Secret.ts"))],
            },
            "data": {
                "file": path_string(&outside.join("Secret.ts")),
            },
        }));

        let filtered =
            filter_lsp_code_lenses_to_workspace(&root_path, vec![safe_lens.clone(), unsafe_lens])
                .expect("filtered code lenses");

        assert_eq!(filtered, vec![safe_lens]);
    }

    #[test]
    fn lsp_response_document_link_filter_keeps_safe_targets_and_drops_unsafe_paths() {
        let root = temp_workspace("document-link-response-filter-root");
        let outside = temp_workspace("document-link-response-filter-outside");
        let root_path = path_string(&root);
        let safe_file_link = document_link(json!({
            "target": file_uri(&root.join("README.md")),
        }));
        let safe_web_link = document_link(json!({
            "target": "https://example.test/docs",
        }));
        let unsafe_target_link = document_link(json!({
            "target": file_uri(&outside.join("Secret.md")),
        }));
        let unsafe_data_link = document_link(json!({
            "data": {
                "file": path_string(&outside.join("Secret.md")),
            },
        }));

        let filtered = filter_lsp_document_links_to_workspace(
            &root_path,
            vec![
                safe_file_link.clone(),
                safe_web_link.clone(),
                unsafe_target_link,
                unsafe_data_link,
            ],
        )
        .expect("filtered document links");

        assert_eq!(filtered, vec![safe_file_link, safe_web_link]);
    }

    #[test]
    fn lsp_response_inlay_hint_filter_strips_outside_payloads() {
        let root = temp_workspace("inlay-hint-response-filter-root");
        let outside = temp_workspace("inlay-hint-response-filter-outside");
        let root_path = path_string(&root);
        let safe_hint = inlay_hint(json!({
            "data": { "file": path_string(&root.join("src/App.ts")) },
            "label": [
                {
                    "label": "App",
                    "command": {
                        "title": "Apply import",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "file": path_string(&root.join("src/App.ts")) }],
                    },
                    "location": location(&file_uri(&root.join("src/App.ts"))),
                    "tooltip": "Inside workspace",
                },
            ],
        }));
        let unsafe_hint = inlay_hint(json!({
            "data": { "file": path_string(&outside.join("Secret.ts")) },
            "label": [
                {
                    "label": "Secret",
                    "command": {
                        "title": "Apply import",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "file": path_string(&outside.join("Secret.ts")) }],
                    },
                    "location": location(&file_uri(&outside.join("Secret.ts"))),
                    "tooltip": "Outside workspace",
                },
            ],
        }));

        let filtered =
            filter_lsp_inlay_hints_to_workspace(&root_path, vec![safe_hint.clone(), unsafe_hint]);

        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0], safe_hint);
        assert!(filtered[1].data.is_none());
        let LanguageServerInlayHintLabel::Parts(parts) = &filtered[1].label else {
            panic!("expected label parts");
        };
        assert_eq!(parts[0].label, "Secret");
        assert_eq!(parts[0].tooltip.as_deref(), Some("Outside workspace"));
        assert!(parts[0].command.is_none());
        assert!(parts[0].location.is_none());
    }

    #[test]
    fn lsp_hierarchy_follow_up_guards_reject_outside_item_uris() {
        let root = temp_workspace("hierarchy-root");
        let outside = temp_workspace("hierarchy-outside");
        let inside_call = call_hierarchy_item(&file_uri(&root.join("src/App.ts")));
        let outside_call = call_hierarchy_item(&file_uri(&outside.join("Secret.ts")));
        let outside_type = type_hierarchy_item(&file_uri(&outside.join("Secret.ts")));

        assert!(
            ensure_lsp_call_hierarchy_item_in_workspace(&path_string(&root), &inside_call).is_ok()
        );
        assert!(
            ensure_lsp_call_hierarchy_item_in_workspace(&path_string(&root), &outside_call)
                .is_err()
        );
        assert!(
            ensure_lsp_type_hierarchy_item_in_workspace(&path_string(&root), &outside_type)
                .is_err()
        );
    }

    #[test]
    fn file_uri_paths_are_decoded_for_workspace_edits() {
        assert_eq!(
            path_from_file_uri("file:///tmp/My%20Project/%C4%8Dlovek.ts"),
            Some("/tmp/My Project/človek.ts".to_string()),
        );
        assert_eq!(
            path_from_file_uri("file://localhost/tmp/User.ts"),
            Some("/tmp/User.ts".to_string()),
        );
        assert_eq!(path_from_file_uri("file://server/tmp/User.ts"), None);
        assert_eq!(path_from_file_uri("https://example.com/User.ts"), None);
    }

    #[test]
    fn language_server_workspace_edits_are_converted_to_file_edits() {
        let mut changes = BTreeMap::new();
        changes.insert(
            "file:///tmp/User.ts".to_string(),
            vec![LanguageServerTextEdit {
                range: LanguageServerRange {
                    start: LanguageServerPosition {
                        line: 1,
                        character: 2,
                    },
                    end: LanguageServerPosition {
                        line: 1,
                        character: 5,
                    },
                },
                new_text: "Account".to_string(),
            }],
        );

        let edits = workspace_text_edits_from_language_server(LanguageServerWorkspaceEdit {
            changes,
            document_versions: BTreeMap::new(),
            file_operations: Vec::new(),
        })
        .expect("workspace edits");

        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].path, "/tmp/User.ts");
        assert_eq!(edits[0].new_text, "Account");
        assert_eq!(edits[0].range.start.line, 1);
        assert_eq!(edits[0].range.end.character, 5);
    }

    #[test]
    fn apply_workspace_edit_applies_file_operations_before_text_edits() {
        let root = temp_workspace("workspace-edit-file-operations");
        let source_directory = root.join("src");
        fs::create_dir_all(&source_directory).expect("source directory");
        let created_path = source_directory.join("Created.ts");
        let old_path = source_directory.join("Old.ts");
        let renamed_path = source_directory.join("Renamed.ts");
        let deleted_path = source_directory.join("Deleted.ts");
        fs::write(&old_path, "export const oldName = true;\n").expect("old file");
        fs::write(&deleted_path, "delete me\n").expect("deleted file");

        let mut changes = BTreeMap::new();
        changes.insert(
            file_uri(&created_path),
            vec![LanguageServerTextEdit {
                range: LanguageServerRange {
                    start: LanguageServerPosition {
                        line: 0,
                        character: 0,
                    },
                    end: LanguageServerPosition {
                        line: 0,
                        character: 0,
                    },
                },
                new_text: "export const created = true;\n".to_string(),
            }],
        );
        let changed_paths = tauri::async_runtime::block_on(apply_workspace_edit(
            path_string(&root),
            LanguageServerWorkspaceEdit {
                changes,
                document_versions: BTreeMap::new(),
                file_operations: vec![
                    LanguageServerWorkspaceFileOperation::Create {
                        uri: file_uri(&created_path),
                        options: None,
                    },
                    LanguageServerWorkspaceFileOperation::Rename {
                        old_uri: file_uri(&old_path),
                        new_uri: file_uri(&renamed_path),
                        options: None,
                    },
                    LanguageServerWorkspaceFileOperation::Delete {
                        uri: file_uri(&deleted_path),
                        options: Some(LanguageServerWorkspaceFileOperationOptions {
                            ignore_if_not_exists: Some(false),
                            ..Default::default()
                        }),
                    },
                ],
            },
            Vec::new(),
        ))
        .expect("apply workspace edit");

        assert_eq!(changed_paths, 4);
        assert_eq!(
            fs::read_to_string(&created_path).expect("created file"),
            "export const created = true;\n"
        );
        assert!(!old_path.exists());
        assert!(renamed_path.exists());
        assert!(!deleted_path.exists());
    }

    // The git, write-file, and apply-edit commands moved off the Tauri main
    // thread (async fn + spawn_blocking) so save/tab-switch/push never stall the
    // WebView. These tests drive the real async commands through the Tauri async
    // runtime and assert behaviour is unchanged off-thread, that concurrent
    // requests succeed, and that commands stay isolated per workspace root.

    fn init_test_git_repo(root: &Path) {
        run_test_git(root, &["init"]);
        run_test_git(root, &["config", "user.email", "test@example.com"]);
        run_test_git(root, &["config", "user.name", "Test User"]);
    }

    fn run_test_git(root: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn write_text_file_persists_contents_off_thread() {
        let root = temp_workspace("write-off-thread");
        let file = root.join("notes.txt");

        tauri::async_runtime::block_on(write_text_file(
            path_string(&file),
            "off-thread save".to_string(),
        ))
        .expect("write result");

        assert_eq!(
            fs::read_to_string(&file).expect("written file"),
            "off-thread save"
        );
    }

    #[test]
    fn write_text_file_handles_concurrent_saves_off_thread() {
        let root = temp_workspace("write-concurrent");
        let first = root.join("first.txt");
        let second = root.join("second.txt");

        let first_task =
            tauri::async_runtime::spawn(write_text_file(path_string(&first), "first".to_string()));
        let second_task = tauri::async_runtime::spawn(write_text_file(
            path_string(&second),
            "second".to_string(),
        ));

        tauri::async_runtime::block_on(first_task)
            .expect("first join")
            .expect("first write");
        tauri::async_runtime::block_on(second_task)
            .expect("second join")
            .expect("second write");

        assert_eq!(fs::read_to_string(&first).expect("first"), "first");
        assert_eq!(fs::read_to_string(&second).expect("second"), "second");
    }

    #[test]
    fn get_git_status_reports_staged_changes_off_thread() {
        let root = temp_workspace("git-status-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
        run_test_git(&root, &["add", "tracked.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

        let status = tauri::async_runtime::block_on(get_git_status(path_string(&root)))
            .expect("git status result");

        assert!(
            status
                .changes
                .iter()
                .any(|change| change.relative_path == "tracked.txt"),
            "expected the modified file in git status, got {:?}",
            status.changes
        );
    }

    #[test]
    fn stage_git_files_off_thread_stages_only_requested_repository() {
        let root = temp_workspace("git-stage-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
        run_test_git(&root, &["add", "tracked.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

        let change = crate::git::GitChangedFile {
            is_staged: false,
            is_unversioned: false,
            old_path: None,
            old_relative_path: None,
            path: path_string(&root.join("tracked.txt")),
            relative_path: "tracked.txt".to_string(),
            status: crate::git::GitChangeStatus::Modified,
        };

        let status =
            tauri::async_runtime::block_on(stage_git_files(path_string(&root), vec![change]))
                .expect("stage result");

        assert!(
            status
                .changes
                .iter()
                .any(|entry| entry.relative_path == "tracked.txt" && entry.is_staged),
            "expected the file to be staged, got {:?}",
            status.changes
        );
    }

    #[test]
    fn stage_git_hunk_off_thread_stages_only_requested_repository() {
        let root = temp_workspace("git-stage-hunk-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("f.txt"), "a\nb\nc\nd\ne\n").expect("write");
        run_test_git(&root, &["add", "f.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("f.txt"), "A\nb\nc\nd\nE\n").expect("modify");

        let hunks = tauri::async_runtime::block_on(get_git_file_hunks(
            path_string(&root),
            "f.txt".to_string(),
            false,
        ))
        .expect("hunks");
        assert_eq!(hunks.len(), 2, "expected two hunks, got {hunks:?}");

        tauri::async_runtime::block_on(stage_git_hunk(path_string(&root), "f.txt".to_string(), 0))
            .expect("stage hunk");

        // Partial staging: exactly the first hunk moved to the index while the
        // last hunk remains in the worktree diff. `git status --porcelain`
        // collapses both sides into one `MM` entry, so verify the split
        // directly through the staged/worktree hunk views.
        let staged = tauri::async_runtime::block_on(get_git_file_hunks(
            path_string(&root),
            "f.txt".to_string(),
            true,
        ))
        .expect("staged hunks");
        let worktree = tauri::async_runtime::block_on(get_git_file_hunks(
            path_string(&root),
            "f.txt".to_string(),
            false,
        ))
        .expect("worktree hunks");

        assert_eq!(staged.len(), 1, "expected one staged hunk, got {staged:?}");
        assert!(staged[0].lines.contains(&"+A".to_string()));
        assert_eq!(
            worktree.len(),
            1,
            "expected one remaining worktree hunk, got {worktree:?}"
        );
        assert!(worktree[0].lines.contains(&"+E".to_string()));
    }

    #[test]
    fn unstage_git_hunk_off_thread_unstages_only_selected_hunk() {
        let root = temp_workspace("git-unstage-hunk-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("f.txt"), "a\nb\nc\nd\ne\n").expect("write");
        run_test_git(&root, &["add", "f.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("f.txt"), "A\nb\nc\nd\nE\n").expect("modify");
        run_test_git(&root, &["add", "f.txt"]);

        tauri::async_runtime::block_on(unstage_git_hunk(
            path_string(&root),
            "f.txt".to_string(),
            0,
        ))
        .expect("unstage hunk");

        // Only the first staged hunk dropped back to the worktree; the other
        // stays in the index. Verify via the staged/worktree hunk views since
        // porcelain collapses the file into a single entry.
        let staged = tauri::async_runtime::block_on(get_git_file_hunks(
            path_string(&root),
            "f.txt".to_string(),
            true,
        ))
        .expect("staged hunks");
        let worktree = tauri::async_runtime::block_on(get_git_file_hunks(
            path_string(&root),
            "f.txt".to_string(),
            false,
        ))
        .expect("worktree hunks");

        assert_eq!(
            staged.len(),
            1,
            "expected one staged hunk left, got {staged:?}"
        );
        assert!(staged[0].lines.contains(&"+E".to_string()));
        assert_eq!(
            worktree.len(),
            1,
            "expected the unstaged hunk back in the worktree, got {worktree:?}"
        );
        assert!(worktree[0].lines.contains(&"+A".to_string()));
    }

    #[test]
    fn git_status_stays_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("git-iso-a");
        let root_b = temp_workspace("git-iso-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        fs::write(root_a.join("only-in-a.txt"), "a\n").expect("file in a");
        fs::write(root_b.join("only-in-b.txt"), "b\n").expect("file in b");

        let status_a =
            tauri::async_runtime::block_on(get_git_status(path_string(&root_a))).expect("status a");
        let status_b =
            tauri::async_runtime::block_on(get_git_status(path_string(&root_b))).expect("status b");

        assert!(
            status_a
                .changes
                .iter()
                .any(|change| change.relative_path == "only-in-a.txt"),
            "root A should see its own file"
        );
        assert!(
            status_a
                .changes
                .iter()
                .all(|change| change.relative_path != "only-in-b.txt"),
            "root A must not see root B's file (no cross-root leakage)"
        );
        assert!(
            status_b
                .changes
                .iter()
                .any(|change| change.relative_path == "only-in-b.txt"),
            "root B should see its own file"
        );
        assert!(
            status_b
                .changes
                .iter()
                .all(|change| change.relative_path != "only-in-a.txt"),
            "root B must not see root A's file (no cross-root leakage)"
        );
    }

    #[test]
    fn get_git_status_handles_concurrent_repositories_off_thread() {
        let root_a = temp_workspace("git-concurrent-a");
        let root_b = temp_workspace("git-concurrent-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        fs::write(root_a.join("a.txt"), "a\n").expect("file a");
        fs::write(root_b.join("b.txt"), "b\n").expect("file b");

        let task_a = tauri::async_runtime::spawn(get_git_status(path_string(&root_a)));
        let task_b = tauri::async_runtime::spawn(get_git_status(path_string(&root_b)));

        let status_a = tauri::async_runtime::block_on(task_a)
            .expect("join a")
            .expect("status a");
        let status_b = tauri::async_runtime::block_on(task_b)
            .expect("join b")
            .expect("status b");

        assert!(status_a
            .changes
            .iter()
            .any(|change| change.relative_path == "a.txt"));
        assert!(status_b
            .changes
            .iter()
            .any(|change| change.relative_path == "b.txt"));
    }

    #[test]
    fn get_git_blame_reports_per_line_authors_off_thread() {
        let root = temp_workspace("git-blame-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("file.txt"), "alpha\nbeta\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);

        let lines = tauri::async_runtime::block_on(get_git_blame(
            path_string(&root),
            "file.txt".to_string(),
        ))
        .expect("blame result");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Test User");
        assert!(!lines[0].sha.is_empty());
        assert_eq!(lines[1].line_number, 2);
    }

    #[test]
    fn git_blame_stays_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("git-blame-iso-a");
        let root_b = temp_workspace("git-blame-iso-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        run_test_git(&root_a, &["config", "user.name", "Author A"]);
        run_test_git(&root_b, &["config", "user.name", "Author B"]);
        fs::write(root_a.join("shared.txt"), "from a\n").expect("file in a");
        fs::write(root_b.join("shared.txt"), "from b\n").expect("file in b");
        run_test_git(&root_a, &["add", "shared.txt"]);
        run_test_git(&root_a, &["commit", "-m", "a commit"]);
        run_test_git(&root_b, &["add", "shared.txt"]);
        run_test_git(&root_b, &["commit", "-m", "b commit"]);

        let blame_a = tauri::async_runtime::block_on(get_git_blame(
            path_string(&root_a),
            "shared.txt".to_string(),
        ))
        .expect("blame a");
        let blame_b = tauri::async_runtime::block_on(get_git_blame(
            path_string(&root_b),
            "shared.txt".to_string(),
        ))
        .expect("blame b");

        assert_eq!(blame_a[0].author, "Author A");
        assert_eq!(blame_b[0].author, "Author B");
        assert_ne!(blame_a[0].sha, blame_b[0].sha, "no cross-root leakage");
    }

    #[test]
    fn get_git_file_history_lists_commits_off_thread() {
        let root = temp_workspace("git-file-history-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "first commit"]);
        fs::write(root.join("file.txt"), "one\ntwo\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "second commit"]);

        let entries = tauri::async_runtime::block_on(get_git_file_history(
            path_string(&root),
            "file.txt".to_string(),
        ))
        .expect("file history result");

        assert_eq!(entries.len(), 2);
        // Newest commit first (git log default ordering).
        assert_eq!(entries[0].subject, "second commit");
        assert_eq!(entries[1].subject, "first commit");
        assert_eq!(entries[0].author, "Test User");
        assert!(!entries[0].sha.is_empty());
    }

    #[test]
    fn get_git_file_history_stays_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("git-file-history-iso-a");
        let root_b = temp_workspace("git-file-history-iso-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        fs::write(root_a.join("shared.txt"), "from a\n").expect("file in a");
        fs::write(root_b.join("shared.txt"), "from b\n").expect("file in b");
        run_test_git(&root_a, &["add", "shared.txt"]);
        run_test_git(&root_a, &["commit", "-m", "a commit"]);
        run_test_git(&root_b, &["add", "shared.txt"]);
        run_test_git(&root_b, &["commit", "-m", "b commit"]);

        let history_a = tauri::async_runtime::block_on(get_git_file_history(
            path_string(&root_a),
            "shared.txt".to_string(),
        ))
        .expect("history a");
        let history_b = tauri::async_runtime::block_on(get_git_file_history(
            path_string(&root_b),
            "shared.txt".to_string(),
        ))
        .expect("history b");

        assert_eq!(history_a[0].subject, "a commit");
        assert_eq!(history_b[0].subject, "b commit");
        assert_ne!(history_a[0].sha, history_b[0].sha, "no cross-root leakage");
    }

    #[test]
    fn get_git_file_history_rejects_paths_outside_workspace_off_thread() {
        let root = temp_workspace("git-file-history-escape");
        init_test_git_repo(&root);

        assert!(tauri::async_runtime::block_on(get_git_file_history(
            path_string(&root),
            "../secret.txt".to_string(),
        ))
        .is_err());
    }

    #[test]
    fn git_stash_save_list_pop_round_trip_off_thread() {
        let root = temp_workspace("git-stash-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("file.txt"), "two\n").expect("write file");

        tauri::async_runtime::block_on(save_git_stash(path_string(&root), "wip".to_string()))
            .expect("stash save");

        let entries = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root)))
            .expect("stash list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 0);

        let diff =
            tauri::async_runtime::block_on(get_git_stash_diff(path_string(&root), "0".to_string()))
                .expect("stash diff");
        assert!(diff.contains("file.txt"));

        tauri::async_runtime::block_on(stash_pop_git(path_string(&root), "0".to_string()))
            .expect("stash pop");

        assert_eq!(
            fs::read_to_string(root.join("file.txt")).expect("read"),
            "two\n"
        );
        let remaining = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root)))
            .expect("stash list");
        assert!(remaining.is_empty());
    }

    #[test]
    fn git_stash_apply_keeps_entry_and_drop_removes_it_off_thread() {
        let root = temp_workspace("git-stash-apply-drop-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("file.txt"), "two\n").expect("write file");

        tauri::async_runtime::block_on(save_git_stash(path_string(&root), "wip".to_string()))
            .expect("stash save");
        tauri::async_runtime::block_on(stash_apply_git(path_string(&root), "0".to_string()))
            .expect("stash apply");

        // apply keeps the entry around.
        let entries = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root)))
            .expect("stash list");
        assert_eq!(entries.len(), 1);

        tauri::async_runtime::block_on(stash_drop_git(path_string(&root), "0".to_string()))
            .expect("stash drop");

        let remaining = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root)))
            .expect("stash list");
        assert!(remaining.is_empty());
    }

    #[test]
    fn git_stash_stays_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("git-stash-iso-a");
        let root_b = temp_workspace("git-stash-iso-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        fs::write(root_a.join("shared.txt"), "base a\n").expect("file a");
        fs::write(root_b.join("shared.txt"), "base b\n").expect("file b");
        run_test_git(&root_a, &["add", "shared.txt"]);
        run_test_git(&root_a, &["commit", "-m", "a"]);
        run_test_git(&root_b, &["add", "shared.txt"]);
        run_test_git(&root_b, &["commit", "-m", "b"]);
        fs::write(root_a.join("shared.txt"), "wip a\n").expect("file a");

        // Only root A has a stash; root B's list must stay empty (no leakage).
        tauri::async_runtime::block_on(save_git_stash(path_string(&root_a), "wip a".to_string()))
            .expect("stash save a");

        let list_a = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root_a)))
            .expect("list a");
        let list_b = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root_b)))
            .expect("list b");

        assert_eq!(list_a.len(), 1);
        assert!(list_b.is_empty(), "no cross-root stash leakage");
    }

    #[test]
    fn git_stash_diff_rejects_non_numeric_index_off_thread() {
        let root = temp_workspace("git-stash-bad-index");
        init_test_git_repo(&root);

        assert!(tauri::async_runtime::block_on(get_git_stash_diff(
            path_string(&root),
            "0} --output=/etc/passwd".to_string(),
        ))
        .is_err());
    }

    #[test]
    fn git_branch_create_list_switch_round_trip_off_thread() {
        let root = temp_workspace("git-branch-off-thread");
        init_test_git_repo(&root);
        run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);

        tauri::async_runtime::block_on(create_git_branch(
            path_string(&root),
            "feature/login".to_string(),
        ))
        .expect("create branch");

        let branches =
            tauri::async_runtime::block_on(list_git_branches(path_string(&root))).expect("list");
        let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();
        assert!(names.contains(&"feature/login"));
        assert!(names.contains(&"main"));
        // create must NOT switch: HEAD is still on main.
        let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root)))
            .expect("current");
        assert_eq!(current.as_deref(), Some("main"));

        tauri::async_runtime::block_on(switch_git_branch(
            path_string(&root),
            "feature/login".to_string(),
        ))
        .expect("switch branch");

        let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root)))
            .expect("current");
        assert_eq!(current.as_deref(), Some("feature/login"));
    }

    #[test]
    fn git_branch_switch_refuses_to_discard_uncommitted_changes_off_thread() {
        let root = temp_workspace("git-branch-switch-safety");
        init_test_git_repo(&root);
        run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);
        run_test_git(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("file.txt"), "feature\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "feature"]);
        run_test_git(&root, &["checkout", "main"]);
        // Dirty local change that conflicts with the feature branch content.
        fs::write(root.join("file.txt"), "dirty\n").expect("write file");

        let result = tauri::async_runtime::block_on(switch_git_branch(
            path_string(&root),
            "feature".to_string(),
        ));

        // The switch must FAIL rather than discard the uncommitted change.
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).expect("read"),
            "dirty\n"
        );
        let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root)))
            .expect("current");
        assert_eq!(current.as_deref(), Some("main"));
    }

    #[test]
    fn git_branch_create_rejects_injection_off_thread() {
        let root = temp_workspace("git-branch-bad-name");
        init_test_git_repo(&root);
        run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "initial"]);

        assert!(tauri::async_runtime::block_on(create_git_branch(
            path_string(&root),
            "--force".to_string(),
        ))
        .is_err());
        assert!(tauri::async_runtime::block_on(switch_git_branch(
            path_string(&root),
            "foo; rm -rf /".to_string(),
        ))
        .is_err());
    }

    #[test]
    fn git_branches_stay_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("git-branch-iso-a");
        let root_b = temp_workspace("git-branch-iso-b");
        init_test_git_repo(&root_a);
        init_test_git_repo(&root_b);
        run_test_git(&root_a, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_test_git(&root_b, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        fs::write(root_a.join("a.txt"), "a\n").expect("file a");
        fs::write(root_b.join("b.txt"), "b\n").expect("file b");
        run_test_git(&root_a, &["add", "a.txt"]);
        run_test_git(&root_a, &["commit", "-m", "a"]);
        run_test_git(&root_b, &["add", "b.txt"]);
        run_test_git(&root_b, &["commit", "-m", "b"]);

        // A branch created in root A must never appear in root B's list.
        tauri::async_runtime::block_on(create_git_branch(
            path_string(&root_a),
            "only-in-a".to_string(),
        ))
        .expect("create in a");

        let list_a = tauri::async_runtime::block_on(list_git_branches(path_string(&root_a)))
            .expect("list a");
        let list_b = tauri::async_runtime::block_on(list_git_branches(path_string(&root_b)))
            .expect("list b");

        assert!(list_a.iter().any(|branch| branch.name == "only-in-a"));
        assert!(
            !list_b.iter().any(|branch| branch.name == "only-in-a"),
            "no cross-root branch leakage"
        );
    }

    #[test]
    fn local_history_relative_path_guard_rejects_escape_and_absolute_paths() {
        assert!(ensure_local_history_relative_path("src/User.php").is_ok());
        assert!(ensure_local_history_relative_path("../secret.txt").is_err());
        assert!(ensure_local_history_relative_path("nested/../../secret.txt").is_err());
        assert!(ensure_local_history_relative_path("/etc/passwd").is_err());
        // Backslash-expressed traversal must also be rejected (Windows paths).
        assert!(ensure_local_history_relative_path("..\\secret.txt").is_err());
        assert!(ensure_local_history_relative_path("nested\\..\\..\\secret.txt").is_err());
    }

    #[test]
    fn get_git_file_commit_diff_reports_commit_blobs_off_thread() {
        let root = temp_workspace("git-file-commit-diff-off-thread");
        init_test_git_repo(&root);
        fs::write(root.join("file.txt"), "one\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "first"]);
        fs::write(root.join("file.txt"), "one\ntwo\n").expect("write file");
        run_test_git(&root, &["add", "file.txt"]);
        run_test_git(&root, &["commit", "-m", "second"]);

        let sha = String::from_utf8_lossy(
            &std::process::Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&root)
                .output()
                .expect("rev-parse")
                .stdout,
        )
        .trim()
        .to_string();

        let diff = tauri::async_runtime::block_on(get_git_file_commit_diff(
            path_string(&root),
            "file.txt".to_string(),
            sha,
        ))
        .expect("file commit diff result");

        assert_eq!(diff.original_content, "one\n");
        assert_eq!(diff.modified_content, "one\ntwo\n");
        assert_eq!(diff.change.relative_path, "file.txt");
    }

    #[test]
    fn get_git_file_commit_diff_rejects_invalid_sha_off_thread() {
        let root = temp_workspace("git-file-commit-diff-bad-sha");
        init_test_git_repo(&root);

        assert!(tauri::async_runtime::block_on(get_git_file_commit_diff(
            path_string(&root),
            "file.txt".to_string(),
            "HEAD".to_string(),
        ))
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn index_path_guard_accepts_paths_through_symlinked_root() {
        use std::os::unix::fs::symlink;

        let root = temp_workspace("symlink-root");
        let source_directory = root.join("src");
        let linked_root = root
            .parent()
            .expect("workspace parent")
            .join(format!("{}-link", unique_suffix()));
        fs::create_dir_all(&source_directory).expect("source directory");
        fs::write(source_directory.join("User.php"), "<?php").expect("source file");
        symlink(&root, &linked_root).expect("workspace symlink");

        assert!(
            ensure_path_in_workspace(&root, &path_string(&linked_root.join("src/User.php")))
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn index_path_guard_rejects_symlink_escape_paths() {
        use std::os::unix::fs::symlink;

        let root = temp_workspace("symlink-escape-root");
        let outside = temp_workspace("symlink-escape-outside");
        let linked_outside = root.join("linked-outside");
        fs::write(outside.join("Secret.php"), "<?php").expect("outside file");
        symlink(&outside, &linked_outside).expect("outside symlink");

        assert!(
            ensure_path_in_workspace(&root, &path_string(&linked_outside.join("Secret.php")))
                .is_err()
        );
        assert!(ensure_path_in_workspace(&root, "linked-outside/Missing.php").is_err());
    }

    #[test]
    fn normalize_path_removes_parent_and_current_components() {
        assert_eq!(
            normalize_path(Path::new("/workspace/project/../project/./src")),
            Path::new("/workspace/project/src")
        );
    }

    #[test]
    fn disposal_workspace_root_falls_back_to_normalized_missing_paths() {
        let root = temp_workspace("disposal-fallback-root");
        let missing = root.join("missing").join("..").join("missing-again");

        assert_eq!(
            workspace_root_for_disposal(&path_string(&missing)),
            root.join("missing-again")
        );
    }

    #[test]
    fn disposal_workspace_root_uses_canonical_existing_paths() {
        let root = temp_workspace("disposal-canonical-root");
        let nested = root.join("src");
        fs::create_dir_all(&nested).expect("nested directory");

        assert_eq!(
            workspace_root_for_disposal(&path_string(&root.join(".").join("src"))),
            nested.canonicalize().expect("canonical nested")
        );
    }

    #[test]
    fn monospace_font_cache_scans_once_and_reuses_result() {
        let cache: OnceLock<Vec<String>> = OnceLock::new();
        let scans = AtomicUsize::new(0);
        let scan = || {
            scans.fetch_add(1, Ordering::SeqCst);
            vec!["Fira Code".to_string(), "Menlo".to_string()]
        };

        let first = cached_monospace_font_families(&cache, scan).clone();
        let second = cached_monospace_font_families(&cache, scan).clone();
        let third = cached_monospace_font_families(&cache, scan).clone();

        assert_eq!(first, vec!["Fira Code".to_string(), "Menlo".to_string()]);
        assert_eq!(first, second);
        assert_eq!(second, third);
        assert_eq!(
            scans.load(Ordering::SeqCst),
            1,
            "system font scan must run at most once per session cache",
        );
    }

    #[test]
    fn monospace_font_enumeration_returns_sorted_unique_families() {
        let families = enumerate_monospace_font_families();

        let mut sorted = families.clone();
        sorted.sort();
        assert_eq!(families, sorted, "families must be sorted");

        let mut deduped = families.clone();
        deduped.dedup();
        assert_eq!(families, deduped, "families must be unique");

        assert!(
            families.iter().all(|family| !family.trim().is_empty()),
            "families must not contain blank names",
        );
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-lib-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
    }

    fn sibling_prefix_workspace(root: &Path, suffix: &str) -> PathBuf {
        let name = root.file_name().expect("workspace name").to_string_lossy();
        let sibling = root.with_file_name(format!("{name}-{suffix}"));
        fs::create_dir_all(&sibling).expect("sibling prefix workspace");
        sibling.canonicalize().expect("canonical sibling workspace")
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    fn php_document_content(path: &str) -> TextDocumentContent {
        TextDocumentContent {
            path: path.to_string(),
            language_id: "php".to_string(),
            version: 1,
            text: "<?php".to_string(),
        }
    }

    fn completion_item(data: Value) -> LanguageServerCompletionItem {
        serde_json::from_value(json!({
            "label": "App",
            "data": data,
        }))
        .expect("completion item")
    }

    fn code_action(payload: Value) -> LanguageServerCodeAction {
        let mut value = json!({
            "title": "Resolve action",
        });
        merge_object(&mut value, payload);

        serde_json::from_value(value).expect("code action")
    }

    fn code_action_context(data: Value) -> LanguageServerCodeActionContext {
        serde_json::from_value(json!({
            "diagnostics": [
                {
                    "range": lsp_range(),
                    "message": "Cannot find name",
                    "data": data,
                }
            ]
        }))
        .expect("code action context")
    }

    fn code_lens(payload: Value) -> LanguageServerCodeLens {
        let mut value = json!({
            "range": lsp_range(),
        });
        merge_object(&mut value, payload);

        serde_json::from_value(value).expect("code lens")
    }

    fn document_link(payload: Value) -> LanguageServerDocumentLink {
        let mut value = json!({
            "range": lsp_range(),
        });
        merge_object(&mut value, payload);

        serde_json::from_value(value).expect("document link")
    }

    fn inlay_hint(payload: Value) -> LanguageServerInlayHint {
        let mut value = json!({
            "label": "hint",
            "paddingLeft": false,
            "paddingRight": false,
            "position": {
                "line": 0,
                "character": 4,
            },
        });
        merge_object(&mut value, payload);

        serde_json::from_value(value).expect("inlay hint")
    }

    fn location(uri: &str) -> LanguageServerLocation {
        LanguageServerLocation {
            uri: uri.to_string(),
            range: lsp_range(),
        }
    }

    fn workspace_symbol(name: &str, uri: &str) -> LanguageServerWorkspaceSymbol {
        LanguageServerWorkspaceSymbol {
            container_name: None,
            kind: 12,
            location: Some(location(uri)),
            name: name.to_string(),
        }
    }

    fn incoming_call(uri: &str) -> LanguageServerIncomingCall {
        LanguageServerIncomingCall {
            from: call_hierarchy_item(uri),
            from_ranges: vec![lsp_range()],
        }
    }

    fn outgoing_call(uri: &str) -> LanguageServerOutgoingCall {
        LanguageServerOutgoingCall {
            to: call_hierarchy_item(uri),
            from_ranges: vec![lsp_range()],
        }
    }

    fn call_hierarchy_item(uri: &str) -> LanguageServerCallHierarchyItem {
        serde_json::from_value(json!({
            "name": "render",
            "kind": 12,
            "uri": uri,
            "range": lsp_range(),
            "selectionRange": lsp_range(),
        }))
        .expect("call hierarchy item")
    }

    fn type_hierarchy_item(uri: &str) -> LanguageServerTypeHierarchyItem {
        serde_json::from_value(json!({
            "name": "View",
            "kind": 5,
            "uri": uri,
            "range": lsp_range(),
            "selectionRange": lsp_range(),
        }))
        .expect("type hierarchy item")
    }

    fn lsp_range() -> LanguageServerRange {
        LanguageServerRange {
            start: LanguageServerPosition {
                line: 0,
                character: 0,
            },
            end: LanguageServerPosition {
                line: 0,
                character: 3,
            },
        }
    }

    fn text_edit(new_text: &str) -> LanguageServerTextEdit {
        LanguageServerTextEdit {
            range: lsp_range(),
            new_text: new_text.to_string(),
        }
    }

    fn json_text_edit(new_text: &str) -> Value {
        json!({
            "range": lsp_range(),
            "newText": new_text,
        })
    }

    fn command_with_argument(argument: String) -> LanguageServerCodeActionCommand {
        serde_json::from_value(json!({
            "title": "Apply edit",
            "command": "_typescript.applyEdit",
            "arguments": [argument],
        }))
        .expect("code action command")
    }

    fn merge_object(value: &mut Value, payload: Value) {
        let value = value.as_object_mut().expect("object value");
        let payload = payload.as_object().expect("object payload");

        for (key, field) in payload {
            value.insert(key.clone(), field.clone());
        }
    }

    // The index/file/parse commands moved off the Tauri main thread (async fn +
    // spawn_blocking). These tests drive the real async commands through the Tauri
    // async runtime and assert behaviour is unchanged off-thread, that concurrent
    // requests succeed, and that file commands stay isolated per workspace root.

    #[test]
    fn parse_php_file_outline_extracts_symbols_off_thread() {
        let outline = tauri::async_runtime::block_on(parse_php_file_outline(
            "/workspace/src/User.php".to_string(),
            "<?php\n\nnamespace App;\n\nclass User\n{\n    public function name() {}\n}\n"
                .to_string(),
        ))
        .expect("outline result");

        let class = outline
            .nodes
            .iter()
            .find(|node| node.label == "User")
            .expect("class node");
        assert_eq!(class.kind, PhpFileOutlineNodeKind::Class);
        assert!(
            class.children.iter().any(|child| child.label == "name"),
            "expected method node under the class"
        );
    }

    #[test]
    fn parse_php_file_outline_surfaces_signature_metadata_off_thread() {
        let outline = tauri::async_runtime::block_on(parse_php_file_outline(
            "/workspace/src/User.php".to_string(),
            concat!(
                "<?php\n\nnamespace App;\n\nclass User\n{\n",
                "    protected static function find(string $id, $fallback): ?User\n",
                "    {\n        return null;\n    }\n}\n",
            )
            .to_string(),
        ))
        .expect("outline result");

        let method = outline
            .nodes
            .iter()
            .find(|node| node.label == "User")
            .and_then(|class| class.children.iter().find(|child| child.label == "find"))
            .expect("method node");

        let value = serde_json::to_value(method).expect("serialize node");
        assert_eq!(value["visibility"], "protected");
        assert_eq!(value["isStatic"], true);
        assert_eq!(value["returnType"], "?User");
        assert_eq!(value["parameters"][0]["name"], "$id");
        assert_eq!(value["parameters"][0]["type"], "string");
        assert_eq!(value["parameters"][1]["name"], "$fallback");
        assert!(
            value["parameters"][1].get("type").is_none(),
            "untyped parameter should omit the type key, got {:?}",
            value["parameters"][1]
        );
    }

    #[test]
    fn parse_php_syntax_reports_no_diagnostics_for_valid_source_off_thread() {
        let diagnostics =
            tauri::async_runtime::block_on(parse_php_syntax("<?php\n\necho 'ok';\n".to_string()))
                .expect("syntax result");

        assert!(
            diagnostics.is_empty(),
            "valid PHP should produce no syntax diagnostics, got {diagnostics:?}"
        );
    }

    #[test]
    fn parse_php_syntax_reports_diagnostics_for_unclosed_function_off_thread() {
        let diagnostics = tauri::async_runtime::block_on(parse_php_syntax(
            "<?php\n\nfunction codevoQaBroken(\n".to_string(),
        ))
        .expect("syntax result");

        assert!(
            !diagnostics.is_empty(),
            "incomplete PHP function should produce syntax diagnostics"
        );
    }

    #[test]
    fn parse_php_file_outline_handles_concurrent_requests_off_thread() {
        let first_future = parse_php_file_outline(
            "/workspace/src/First.php".to_string(),
            "<?php\nclass First {}\n".to_string(),
        );
        let second_future = parse_php_file_outline(
            "/workspace/src/Second.php".to_string(),
            "<?php\nclass Second {}\n".to_string(),
        );

        // Spawn both on the runtime so they are genuinely in flight together on
        // the blocking pool, then join them.
        let first_task = tauri::async_runtime::spawn(first_future);
        let second_task = tauri::async_runtime::spawn(second_future);

        let first = tauri::async_runtime::block_on(first_task)
            .expect("first join")
            .expect("first outline");
        let second = tauri::async_runtime::block_on(second_task)
            .expect("second join")
            .expect("second outline");

        assert!(first.nodes.iter().any(|node| node.label == "First"));
        assert!(second.nodes.iter().any(|node| node.label == "Second"));
    }

    #[test]
    fn read_text_file_returns_contents_off_thread() {
        let root = temp_workspace("read-text");
        let file = root.join("greeting.txt");
        fs::write(&file, "hello off thread").expect("write file");

        let contents = tauri::async_runtime::block_on(read_text_file(path_string(&file)))
            .expect("read result");

        assert_eq!(contents, "hello off thread");
    }

    #[test]
    fn read_directory_stays_isolated_per_workspace_root_off_thread() {
        let root_a = temp_workspace("dir-iso-a");
        let root_b = temp_workspace("dir-iso-b");
        fs::write(root_a.join("only-in-a.php"), "<?php").expect("file in a");
        fs::write(root_b.join("only-in-b.php"), "<?php").expect("file in b");

        let entries_a = tauri::async_runtime::block_on(read_directory(path_string(&root_a)))
            .expect("read directory a");
        let entries_b = tauri::async_runtime::block_on(read_directory(path_string(&root_b)))
            .expect("read directory b");

        let names_a: Vec<&str> = entries_a.iter().map(|entry| entry.name.as_str()).collect();
        let names_b: Vec<&str> = entries_b.iter().map(|entry| entry.name.as_str()).collect();

        assert!(names_a.contains(&"only-in-a.php"));
        assert!(!names_a.contains(&"only-in-b.php"));
        assert!(names_b.contains(&"only-in-b.php"));
        assert!(!names_b.contains(&"only-in-a.php"));
        assert!(entries_a
            .iter()
            .all(|entry| matches!(entry.kind, FileEntryKind::File)));
    }

    #[test]
    fn search_files_finds_workspace_files_off_thread() {
        let root = temp_workspace("search-files");
        fs::write(root.join("Controller.php"), "<?php").expect("controller");
        fs::write(root.join("README.md"), "docs").expect("readme");

        let results = tauri::async_runtime::block_on(search_files(
            path_string(&root),
            "Controller".to_string(),
            10,
        ))
        .expect("search result");

        assert!(
            results
                .iter()
                .any(|result| result.path.ends_with("Controller.php")),
            "expected Controller.php in results, got {results:?}"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().enable_macos_default_menu(false);
    #[cfg(target_os = "macos")]
    let builder =
        builder
            .menu(application_menu)
            .on_menu_event(|app, event| match event.id().as_ref() {
                CLOSE_ACTIVE_TAB_MENU_ID => {
                    let _ = app.emit(CLOSE_ACTIVE_TAB_EVENT, ());
                }
                FONT_ZOOM_IN_MENU_ID => {
                    let _ = app.emit(FONT_ZOOM_IN_EVENT, ());
                }
                FONT_ZOOM_OUT_MENU_ID => {
                    let _ = app.emit(FONT_ZOOM_OUT_EVENT, ());
                }
                FONT_ZOOM_RESET_MENU_ID => {
                    let _ = app.emit(FONT_ZOOM_RESET_EVENT, ());
                }
                OPEN_APPEARANCE_SETTINGS_MENU_ID => {
                    let _ = app.emit(OPEN_APPEARANCE_SETTINGS_EVENT, ());
                }
                QUIT_APPLICATION_MENU_ID => {
                    shutdown_runtime_processes(app);
                    app.exit(0);
                }
                TOGGLE_FONT_LIGATURES_MENU_ID => {
                    let _ = app.emit(TOGGLE_FONT_LIGATURES_EVENT, ());
                }
                _ => {}
            });

    builder
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                shutdown_runtime_processes(window.app_handle());
            }
        })
        .manage(Mutex::new(SmartModeService::new()))
        .manage(PhpLanguageServerRegistry::new())
        .manage(JavaScriptTypeScriptLanguageServerRegistry::new())
        .manage(JavaScriptTypeScriptWorkspaceWatchRegistry::new())
        .manage(WorkspaceFileChangeWatchRegistry::new())
        .manage(WorkspaceIndexLifecycle::new())
        .manage(TerminalSupervisor::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let trust_path = app.path().app_config_dir()?.join("workspace-trust.json");
            let trust_service = WorkspaceTrustService::load(trust_path)?;
            app.manage(Mutex::new(trust_service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            clear_workspace_index,
            create_directory,
            create_text_file,
            delete_path,
            apply_workspace_edit,
            commit_git_changes,
            install_managed_phpactor,
            detect_git_repositories,
            detect_php_tools,
            detect_workspace,
            dispose_workspace_root,
            get_php_file_outline,
            get_git_blame,
            get_git_commit_graph_page,
            get_git_commit_log,
            get_git_commit_diff,
            get_git_commit_details,
            get_git_commit_files,
            get_git_branches,
            get_git_repo_status,
            get_git_diff,
            get_git_file_commit_diff,
            get_git_file_history,
            get_git_file_hunks,
            get_git_status,
            record_local_history_snapshot,
            get_local_history_versions,
            get_local_history_version_content,
            get_javascript_typescript_language_server_status,
            get_php_language_server_status,
            get_runtime_observability,
            restart_language_runtime,
            stop_language_runtime,
            get_php_tree,
            get_smart_mode_state,
            get_workspace_trust,
            initialize_workspace_index,
            list_monospace_font_families,
            start_workspace_file_watch,
            list_terminal_profiles,
            open_language_runtime_log,
            parse_php_file_outline,
            parse_php_syntax,
            plan_javascript_typescript_language_server,
            plan_php_language_server,
            push_git_changes,
            save_git_stash,
            get_git_stash_list,
            get_git_stash_diff,
            stash_apply_git,
            stash_pop_git,
            stash_drop_git,
            list_git_branches,
            get_git_current_branch,
            create_git_branch,
            switch_git_branch,
            quit_application,
            read_directory,
            read_text_file,
            remove_workspace_index_file,
            rename_path,
            resize_terminal_session,
            revert_git_files,
            search_files,
            search_project_symbols,
            search_text,
            replace_in_path,
            set_smart_mode,
            set_workspace_trust,
            stage_git_files,
            stage_git_hunk,
            unstage_git_hunk,
            start_initial_metadata_scan,
            start_javascript_typescript_language_server,
            start_workspace_reindex,
            start_php_language_server,
            start_terminal_session,
            stop_all_javascript_typescript_language_servers,
            stop_all_php_language_servers,
            stop_all_terminal_sessions,
            stop_javascript_typescript_language_server,
            stop_php_language_server,
            stop_terminal_session,
            stop_terminal_sessions_for_root,
            unstage_git_files,
            javascript_typescript_document_did_change,
            javascript_typescript_document_did_close,
            javascript_typescript_document_did_open,
            javascript_typescript_document_did_save,
            javascript_typescript_language_server_execute_command,
            javascript_typescript_language_server_execute_command_locations,
            javascript_typescript_workspace_did_change_configuration,
            javascript_typescript_workspace_did_change_watched_files,
            javascript_typescript_workspace_did_create_files,
            javascript_typescript_workspace_did_delete_files,
            javascript_typescript_workspace_did_rename_files,
            javascript_typescript_workspace_will_create_files,
            javascript_typescript_workspace_will_delete_files,
            javascript_typescript_workspace_will_rename_files,
            javascript_typescript_text_document_code_action_resolve,
            javascript_typescript_text_document_code_actions,
            javascript_typescript_text_document_code_lens_resolve,
            javascript_typescript_text_document_code_lenses,
            javascript_typescript_text_document_completion,
            javascript_typescript_text_document_completion_resolve,
            javascript_typescript_text_document_declaration,
            javascript_typescript_text_document_definition,
            javascript_typescript_text_document_document_highlights,
            javascript_typescript_text_document_document_link_resolve,
            javascript_typescript_text_document_document_links,
            javascript_typescript_text_document_document_symbols,
            javascript_typescript_text_document_folding_ranges,
            javascript_typescript_text_document_formatting,
            javascript_typescript_text_document_hover,
            javascript_typescript_text_document_incoming_calls,
            javascript_typescript_text_document_implementation,
            javascript_typescript_text_document_inlay_hint_resolve,
            javascript_typescript_text_document_inlay_hints,
            javascript_typescript_text_document_linked_editing_ranges,
            javascript_typescript_text_document_on_type_formatting,
            javascript_typescript_text_document_outgoing_calls,
            javascript_typescript_text_document_prepare_call_hierarchy,
            javascript_typescript_text_document_prepare_rename,
            javascript_typescript_text_document_prepare_type_hierarchy,
            javascript_typescript_text_document_range_formatting,
            javascript_typescript_text_document_range_semantic_tokens,
            javascript_typescript_text_document_references,
            javascript_typescript_text_document_rename,
            javascript_typescript_text_document_selection_ranges,
            javascript_typescript_text_document_semantic_tokens,
            javascript_typescript_text_document_signature_help,
            javascript_typescript_text_document_source_definition,
            javascript_typescript_text_document_type_hierarchy_subtypes,
            javascript_typescript_text_document_type_hierarchy_supertypes,
            javascript_typescript_text_document_type_definition,
            javascript_typescript_workspace_symbols,
            language_server_execute_command,
            language_server_execute_command_locations,
            text_document_code_action_resolve,
            text_document_code_actions,
            text_document_code_lens_resolve,
            text_document_code_lenses,
            text_document_completion,
            text_document_completion_resolve,
            text_document_declaration,
            text_document_definition,
            text_document_document_highlights,
            text_document_document_link_resolve,
            text_document_document_links,
            text_document_document_symbols,
            text_document_folding_ranges,
            text_document_did_change,
            text_document_did_close,
            text_document_did_open,
            text_document_did_save,
            text_document_formatting,
            text_document_hover,
            text_document_incoming_calls,
            text_document_implementation,
            text_document_inlay_hint_resolve,
            text_document_inlay_hints,
            text_document_linked_editing_ranges,
            text_document_on_type_formatting,
            text_document_outgoing_calls,
            text_document_prepare_call_hierarchy,
            text_document_prepare_rename,
            text_document_prepare_type_hierarchy,
            text_document_range_formatting,
            text_document_range_semantic_tokens,
            text_document_references,
            text_document_rename,
            text_document_selection_ranges,
            text_document_semantic_tokens,
            text_document_signature_help,
            text_document_type_hierarchy_subtypes,
            text_document_type_hierarchy_supertypes,
            text_document_type_definition,
            text_document_will_create_files,
            text_document_will_delete_files,
            text_document_will_rename_files,
            workspace_did_create_files,
            workspace_did_delete_files,
            workspace_did_rename_files,
            upsert_workspace_index_file,
            workspace_symbols,
            write_terminal_input,
            write_text_file
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error building tauri application: {error}"))
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                shutdown_runtime_processes(app);
            }
        });
}
