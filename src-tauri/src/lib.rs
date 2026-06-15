mod lsp;
mod project;
mod search;
mod smart_mode;
mod tools;
mod trust;
mod workspace;

use lsp::{LanguageServerPlan, LanguageServerPlanner, PhpactorLanguageServerPlanner};
use project::{ComposerWorkspaceDetector, WorkspaceDescriptor, WorkspaceDetector};
use search::{RipgrepTextSearcher, TextSearchResult, TextSearcher};
use smart_mode::{IntelligenceMode, SmartModeService, SmartModeState};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};
use tools::{LocalPhpToolDetector, PhpToolAvailability, PhpToolDetector};
use trust::{WorkspaceTrustService, WorkspaceTrustState};
use workspace::{
    FileEntry, FileSearchResult, LocalWorkspaceFileRepository, WorkspaceFileRepository,
};

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .create_directory(&PathBuf::from(path))
        .map_err(|error| error.to_string())
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
    let detector = ComposerWorkspaceDetector;
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
fn plan_php_language_server(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(&root_path);
    let trusted = {
        let service = service.lock().map_err(|error| error.to_string())?;
        service.get(&root_path).trusted
    };
    let workspace_detector = ComposerWorkspaceDetector;
    let tool_detector = LocalPhpToolDetector;
    let planner = PhpactorLanguageServerPlanner::new();
    let descriptor = workspace_detector
        .detect(&root)
        .map_err(|error| error.to_string())?;
    let tools = tool_detector
        .detect(Some(&root))
        .map_err(|error| error.to_string())?;

    Ok(planner.plan(&root, trusted, &descriptor, &tools))
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
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .write_text_file(&PathBuf::from(path), &content)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SmartModeService::new()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let trust_path = app.path().app_config_dir()?.join("workspace-trust.json");
            let trust_service = WorkspaceTrustService::load(trust_path)?;
            app.manage(Mutex::new(trust_service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_directory,
            create_text_file,
            delete_path,
            detect_php_tools,
            detect_workspace,
            get_smart_mode_state,
            get_workspace_trust,
            plan_php_language_server,
            read_directory,
            read_text_file,
            rename_path,
            search_files,
            search_text,
            set_smart_mode,
            set_workspace_trust,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error running tauri application: {error}"));
}
