pub mod composer;
pub mod file_watcher;
pub mod git;
pub mod ignore_matcher;
pub mod index;
pub mod index_reindex;
pub mod index_scan;
pub mod index_update;
pub mod job_scheduler;
pub mod js_ts_symbols;
mod lsp;
mod lsp_diagnostics;
mod lsp_document;
mod lsp_features;
mod lsp_session;
mod lsp_transport;
mod managed_phpactor;
pub mod php_file_outline;
pub mod php_parser;
pub mod php_symbols;
pub mod php_tree;
mod project;
mod search;
mod smart_mode;
mod terminal;
mod terminal_session;
mod tools;
mod trust;
mod workspace;

use git::{
    CommandGitRepositoryGateway, GitChangedFile, GitFileDiff, GitRepositoryGateway, GitStatus,
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
    InitialMetadataScanStart, MetadataScanCompletionEvent, MetadataScanEventSink,
    WorkspaceReindexMode, METADATA_SCAN_COMPLETED_EVENT,
};
use lsp::{
    JavaScriptTypeScriptLanguageServerPlanner, JsonRpcRequest, LanguageServerCommand,
    LanguageServerPlan, LanguageServerPlanStatus, LanguageServerPlanner,
    PhpactorLanguageServerPlanner, TypeScriptLanguageServerPlanner,
};
use lsp_document::{
    LspTextDocumentSyncNotificationFactory, TextDocumentContent, TextDocumentPath,
    TextDocumentSyncNotificationFactory,
};
use lsp_features::{
    parse_code_action_result, parse_completion_result, parse_definition_result,
    parse_formatting_result, parse_hover_result, parse_optional_workspace_edit_result,
    parse_workspace_edit_result, LanguageServerCodeAction, LanguageServerCodeActionCommand,
    LanguageServerCodeActionContext, LanguageServerCompletionList, LanguageServerFormattingOptions,
    LanguageServerHover, LanguageServerLocation, LanguageServerRange, LanguageServerTextEdit,
    LanguageServerWorkspaceEdit, LspTextDocumentFeatureRequestFactory,
    TextDocumentFeatureRequestFactory, TextDocumentFormatting, TextDocumentPosition,
    TextDocumentRange, TextDocumentRename,
};
use lsp_session::{
    AppHandleEventSink, ChildServerProcessSpawner, DiagnosticsSink,
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRuntimeStatus,
    PhpLanguageServerRegistry, StatusSink,
};
use php_file_outline::{
    build_php_file_outline, PhpFileOutline, PhpFileOutlineNodeKind, PhpFileOutlineSymbolRecord,
};
use php_parser::{PhpSyntaxDiagnostic, PhpSyntaxParser, TreeSitterPhpParser};
use php_symbols::{PhpSymbolExtractor, PhpSymbolKind, TreeSitterPhpSymbolExtractor};
use php_tree::PhpTree;
use project::{ComposerWorkspaceDetector, WorkspaceDescriptor, WorkspaceDetector};
use search::{RipgrepTextSearcher, TextSearchResult, TextSearcher};
use serde::Serialize;
use smart_mode::{IntelligenceMode, SmartModeService, SmartModeState};
use std::{
    ffi::OsString,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use terminal::{AppHandleTerminalEventSink, TerminalProfile, TerminalRuntimeStatus, TerminalSize};
use terminal_session::{
    LocalTerminalProfileProvider, PortablePtySpawner, TerminalProfileProvider, TerminalSupervisor,
};
use tools::{
    JavaScriptTypeScriptToolDetector, LocalJavaScriptTypeScriptToolDetector, LocalPhpToolDetector,
    PhpToolAvailability, PhpToolDetector,
};
use trust::{WorkspaceTrustService, WorkspaceTrustState};
use workspace::{
    FileEntry, FileSearchResult, LocalWorkspaceFileRepository, WorkspaceFileRepository,
};

const CLOSE_ACTIVE_TAB_EVENT: &str = "mockor-close-active-tab";
const CLOSE_ACTIVE_TAB_MENU_ID: &str = "close-active-tab";
const QUIT_APPLICATION_MENU_ID: &str = "quit-application";

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

#[tauri::command]
fn install_managed_phpactor() -> Result<(), String> {
    managed_phpactor::install_managed_phpactor()
}

#[tauri::command]
fn quit_application(app: AppHandle) {
    shutdown_runtime_processes(&app);
    app.exit(0);
}

fn shutdown_runtime_processes(app: &AppHandle) {
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
fn parse_php_syntax(source: String) -> Result<Vec<PhpSyntaxDiagnostic>, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(&source).map_err(|error| error.to_string())?;
    Ok(tree.diagnostics())
}

#[tauri::command]
fn parse_php_file_outline(path: String, source: String) -> Result<PhpFileOutline, String> {
    let mut parser = TreeSitterPhpParser::new().map_err(|error| error.to_string())?;
    let tree = parser.parse(&source).map_err(|error| error.to_string())?;
    let extractor = TreeSitterPhpSymbolExtractor;
    let symbols = extractor.extract(&tree, &source);
    let relative_path = path_file_label(&path);
    let records: Vec<PhpFileOutlineSymbolRecord> = symbols
        .into_iter()
        .map(|symbol| PhpFileOutlineSymbolRecord {
            column: symbol.range.start_column as i64,
            container_kind: None,
            container_name: symbol.container_name,
            fully_qualified_name: symbol.fully_qualified_name,
            kind: php_file_outline_node_kind_from_symbol(symbol.kind),
            line_number: symbol.range.start_line as i64,
            name: symbol.name,
            path: path.clone(),
            relative_path: relative_path.clone(),
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
    let database_path = workspace_index_database_path(&app, &root)?;
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
    let starter = LocalWorkspaceReindexStarter;
    let event_sink = Arc::new(AppHandleMetadataScanEventSink::new(app));

    starter
        .start(
            WorkspaceReindexRequest {
                database_path,
                language,
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

fn canonicalize_workspace_root(root_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(root_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))
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

    Err("Index path is outside the workspace root.".to_string())
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

fn path_file_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| path.to_string())
}

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

    Menu::with_items(app, &[&file, &edit])
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

    Ok(PhpactorLanguageServerPlanner::new().plan(&root, trusted, &descriptor, &tools))
}

fn build_javascript_typescript_language_server_plan(
    root_path: &str,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(root_path);
    let tools = LocalJavaScriptTypeScriptToolDetector
        .detect(Some(&root))
        .map_err(|error| error.to_string())?;

    Ok(TypeScriptLanguageServerPlanner::new().plan(&root, &tools))
}

#[tauri::command]
fn plan_php_language_server(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    build_php_language_server_plan(&root_path, &service)
}

#[tauri::command]
fn plan_javascript_typescript_language_server(
    root_path: String,
) -> Result<LanguageServerPlan, String> {
    build_javascript_typescript_language_server_plan(&root_path)
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .read_directory(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .read_text_file(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .rename_path(&PathBuf::from(from), &PathBuf::from(to))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_files(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .search_files(&PathBuf::from(root), &query, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_text(root: String, query: String, limit: usize) -> Result<Vec<TextSearchResult>, String> {
    let searcher = RipgrepTextSearcher;
    searcher
        .search(&PathBuf::from(root), &query, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_project_symbols(
    app: AppHandle,
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<ProjectSymbolSearchResult>, String> {
    let root = canonicalize_workspace_root(&root)?;
    let index = open_workspace_index(&app, &root)?;
    index
        .search_project_symbols(&query, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_php_tree(app: AppHandle, root: String) -> Result<PhpTree, String> {
    let root = canonicalize_workspace_root(&root)?;
    let index = open_workspace_index(&app, &root)?;
    index.load_php_tree().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_php_file_outline(
    app: AppHandle,
    root: String,
    path: String,
) -> Result<PhpFileOutline, String> {
    let root = canonicalize_workspace_root(&root)?;
    let path = resolve_workspace_path(&root, &path)?;
    let index = open_workspace_index(&app, &root)?;
    index
        .load_php_file_outline(&path.to_string_lossy())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_git_status(root_path: String) -> Result<GitStatus, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    CommandGitRepositoryGateway
        .status(&root)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_git_diff(root_path: String, change: GitChangedFile) -> Result<GitFileDiff, String> {
    let root = canonicalize_workspace_root(&root_path)?;
    CommandGitRepositoryGateway
        .diff(&root, &change)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_smart_mode(
    mode: IntelligenceMode,
    service: State<'_, Mutex<SmartModeService>>,
) -> Result<SmartModeState, String> {
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
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.status(&root_path))
}

#[tauri::command]
fn get_javascript_typescript_language_server_status(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.status(&root_path))
}

#[tauri::command]
fn start_php_language_server(
    root_path: String,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    let plan = build_php_language_server_plan(&root_path, &trust)?;

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
        managed_phpactor::cleanup_orphaned_managed_phpactor_processes(&command);
    }

    let event_sink = Arc::new(AppHandleEventSink::for_workspace(app, root_path.clone()));
    let status_sink: Arc<dyn StatusSink> = event_sink.clone();
    let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink;

    registry.start(
        &root_path,
        &command,
        &initialize_request,
        &ChildServerProcessSpawner,
        status_sink,
        diagnostics_sink,
    )
}

#[tauri::command]
fn start_javascript_typescript_language_server(
    root_path: String,
    app: AppHandle,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    let plan = build_javascript_typescript_language_server_plan(&root_path)?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }

    let command: LanguageServerCommand = plan
        .command
        .ok_or_else(|| "Language server plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or_else(|| "Language server plan is missing an initialize request.".to_string())?;
    let event_sink = Arc::new(AppHandleEventSink::javascript_typescript_for_workspace(
        app,
        root_path.clone(),
    ));
    let status_sink: Arc<dyn StatusSink> = event_sink.clone();
    let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink;

    registry.start(
        &root_path,
        &command,
        &initialize_request,
        &ChildServerProcessSpawner,
        status_sink,
        diagnostics_sink,
    )
}

#[tauri::command]
fn stop_php_language_server(
    root_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.stop(&root_path))
}

#[tauri::command]
fn stop_javascript_typescript_language_server(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.stop(&root_path))
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
) -> Result<LanguageServerRuntimeStatus, String> {
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
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_open(&document))
}

#[tauri::command]
fn text_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_change(&document))
}

#[tauri::command]
fn text_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_save(&document))
}

#[tauri::command]
fn text_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_close(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_open(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_open(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_change(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_save(&document))
}

#[tauri::command]
fn javascript_typescript_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification(&root_path, &factory.did_close(&document))
}

#[tauri::command]
fn text_document_hover(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_hover(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
fn text_document_completion(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    parse_completion_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_completion(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    parse_completion_result(&result)
}

#[tauri::command]
fn text_document_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.definition(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_definition(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.definition(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn text_document_implementation(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position);
    let result = match registry.send_request(&root_path, &request.method, request.params)? {
        Some(result) => result,
        None => return Ok(Vec::new()),
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_implementation(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position);
    let result = match registry.send_request(&root_path, &request.method, request.params)? {
        Some(result) => result,
        None => return Ok(Vec::new()),
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn text_document_references(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_references(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_definition_result(&result)
}

#[tauri::command]
fn text_document_rename(
    root_path: String,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_workspace_edit_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_rename(
    root_path: String,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_workspace_edit_result(&result)
}

#[tauri::command]
fn text_document_code_actions(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_code_action_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_code_actions(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_code_action_result(&result)
}

#[tauri::command]
fn text_document_code_action_resolve(
    root_path: String,
    action: LanguageServerCodeAction,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_action(&action);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(action);
    };

    serde_json::from_value::<LanguageServerCodeAction>(result)
        .map_err(|error| format!("Language server returned a malformed code action: {error}"))
}

#[tauri::command]
fn javascript_typescript_text_document_code_action_resolve(
    root_path: String,
    action: LanguageServerCodeAction,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_action(&action);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(action);
    };

    serde_json::from_value::<LanguageServerCodeAction>(result)
        .map_err(|error| format!("Language server returned a malformed code action: {error}"))
}

#[tauri::command]
fn language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_optional_workspace_edit_result(&result)
}

#[tauri::command]
fn javascript_typescript_language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(None);
    };

    parse_optional_workspace_edit_result(&result)
}

#[tauri::command]
fn text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
fn javascript_typescript_text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry.send_request(&root_path, &request.method, request.params)? else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .write_text_file(&PathBuf::from(path), &content)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{ensure_path_in_workspace, normalize_path};
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

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-lib-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .menu(application_menu)
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                shutdown_runtime_processes(window.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            CLOSE_ACTIVE_TAB_MENU_ID => {
                let _ = app.emit(CLOSE_ACTIVE_TAB_EVENT, ());
            }
            QUIT_APPLICATION_MENU_ID => {
                shutdown_runtime_processes(app);
                app.exit(0);
            }
            _ => {}
        })
        .manage(Mutex::new(SmartModeService::new()))
        .manage(PhpLanguageServerRegistry::new())
        .manage(JavaScriptTypeScriptLanguageServerRegistry::new())
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
            install_managed_phpactor,
            detect_php_tools,
            detect_workspace,
            get_php_file_outline,
            get_git_diff,
            get_git_status,
            get_javascript_typescript_language_server_status,
            get_php_language_server_status,
            get_php_tree,
            get_smart_mode_state,
            get_workspace_trust,
            initialize_workspace_index,
            list_terminal_profiles,
            parse_php_file_outline,
            parse_php_syntax,
            plan_javascript_typescript_language_server,
            plan_php_language_server,
            quit_application,
            read_directory,
            read_text_file,
            remove_workspace_index_file,
            rename_path,
            resize_terminal_session,
            search_files,
            search_project_symbols,
            search_text,
            set_smart_mode,
            set_workspace_trust,
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
            javascript_typescript_document_did_change,
            javascript_typescript_document_did_close,
            javascript_typescript_document_did_open,
            javascript_typescript_document_did_save,
            javascript_typescript_language_server_execute_command,
            javascript_typescript_text_document_code_action_resolve,
            javascript_typescript_text_document_code_actions,
            javascript_typescript_text_document_completion,
            javascript_typescript_text_document_definition,
            javascript_typescript_text_document_formatting,
            javascript_typescript_text_document_hover,
            javascript_typescript_text_document_implementation,
            javascript_typescript_text_document_references,
            javascript_typescript_text_document_rename,
            language_server_execute_command,
            text_document_code_action_resolve,
            text_document_code_actions,
            text_document_completion,
            text_document_definition,
            text_document_did_change,
            text_document_did_close,
            text_document_did_open,
            text_document_did_save,
            text_document_formatting,
            text_document_hover,
            text_document_implementation,
            text_document_references,
            text_document_rename,
            upsert_workspace_index_file,
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
