use crate::{managed_javascript_typescript, managed_phpactor};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedPhpactorInstallCompletionEvent {
    root: String,
    error: Option<String>,
}

struct AppHandleManagedPhpactorInstallEventSink {
    app: AppHandle,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedTypeScriptInstallCompletionEvent {
    root: String,
    error: Option<String>,
}

struct AppHandleManagedTypeScriptInstallEventSink {
    app: AppHandle,
}

impl managed_javascript_typescript::ManagedTypeScriptInstallEventSink
    for AppHandleManagedTypeScriptInstallEventSink
{
    fn emit_completion(&self, root: String, error: Option<String>) {
        let _ = self.app.emit(
            managed_javascript_typescript::MANAGED_TYPESCRIPT_LANGUAGE_SERVER_INSTALL_COMPLETED_EVENT,
            ManagedTypeScriptInstallCompletionEvent { root, error },
        );
    }
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
pub(crate) fn install_managed_phpactor(app: AppHandle, root: String) {
    managed_phpactor::spawn_managed_phpactor_install(
        root,
        AppHandleManagedPhpactorInstallEventSink { app },
    );
}

#[tauri::command]
pub(crate) fn install_managed_typescript_language_server(app: AppHandle, root: String) {
    managed_javascript_typescript::spawn_managed_typescript_language_server_install(
        root,
        AppHandleManagedTypeScriptInstallEventSink { app },
    );
}
