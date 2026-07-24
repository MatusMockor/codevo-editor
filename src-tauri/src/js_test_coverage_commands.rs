use crate::js_test_run::coverage::{self, JsTestCoverageResponse};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) async fn run_js_test_coverage_json(
    root_path: String,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<JsTestCoverageResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(JsTestCoverageResponse::Unavailable {
            message: "Trust this workspace to run JavaScript test coverage.".to_string(),
        });
    }
    let root = registry
        .clone_root_for_path(Path::new(&root_path))
        .map_err(|_| "JavaScript coverage workspace is not open or its identity changed.")?;
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    coverage::run_registered(root, app_data_base).await
}
