mod workspace;

use std::path::PathBuf;
use workspace::{FileEntry, LocalWorkspaceFileRepository, WorkspaceFileRepository};

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
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let repository = LocalWorkspaceFileRepository;
    repository
        .write_text_file(&PathBuf::from(path), &content)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_directory,
            create_text_file,
            delete_path,
            read_directory,
            read_text_file,
            rename_path,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error running tauri application: {error}"));
}
