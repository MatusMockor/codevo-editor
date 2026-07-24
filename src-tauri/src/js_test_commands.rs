use crate::js_test_run::{self, JsTestRunScope};
use crate::php_test_run::PhpTestRunResponse;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) async fn run_js_tests_json(
    root_path: String,
    filter: Option<String>,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<PhpTestRunResponse, String> {
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    if !workspace_is_trusted(&root_path, &trust)? {
        return Ok(untrusted_response());
    }
    let root = registry
        .clone_root_for_path(Path::new(&root_path))
        .map_err(|_| {
            "JavaScript test workspace is not open or its identity changed.".to_string()
        })?;
    js_test_run::run_js_tests_registered(root, app_data_base, filter).await
}

#[cfg(test)]
pub(crate) async fn run_js_tests_json_with_trust(
    root_path: String,
    app_data_base: PathBuf,
    filter: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<PhpTestRunResponse, String> {
    if !workspace_is_trusted(&root_path, trust)? {
        return Ok(untrusted_response());
    }
    js_test_run::run_js_tests(root_path, app_data_base, filter).await
}

#[tauri::command]
pub(crate) async fn run_js_tests_scoped_json(
    root_path: String,
    scope: JsTestRunScope,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<PhpTestRunResponse, String> {
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    if !workspace_is_trusted(&root_path, &trust)? {
        return Ok(untrusted_response());
    }
    let root = registry
        .clone_root_for_path(Path::new(&root_path))
        .map_err(|_| {
            "JavaScript test workspace is not open or its identity changed.".to_string()
        })?;
    js_test_run::run_js_tests_scoped_registered(root, app_data_base, scope).await
}

fn workspace_is_trusted(
    root_path: &str,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<bool, String> {
    trust
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.get(root_path).trusted)
}

fn untrusted_response() -> PhpTestRunResponse {
    PhpTestRunResponse::Unavailable {
        message: "Trust this workspace to run JavaScript tests.".to_string(),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::run_js_tests_json_with_trust;
    use crate::php_test_run::PhpTestRunResponse;
    use crate::trust::WorkspaceTrustService;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    #[test]
    fn untrusted_workspace_blocks_dispatch() {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "js-test-command-untrusted-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create workspace");
        let marker = root.join("js-tests-ran");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        let binary = root.join("node_modules/.bin/vitest");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary path");
        fs::write(
            &binary,
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .expect("write runner");
        let mut permissions = fs::metadata(&binary)
            .expect("runner metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("make runner executable");
        let trust = Mutex::new(
            WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
        );

        let response = tauri::async_runtime::block_on(run_js_tests_json_with_trust(
            root.to_string_lossy().into_owned(),
            root.join("app-data"),
            None,
            &trust,
        ))
        .expect("test response");

        assert_eq!(
            response,
            PhpTestRunResponse::Unavailable {
                message: "Trust this workspace to run JavaScript tests.".to_string(),
            }
        );
        assert!(!marker.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
