use crate::php_test_run::coverage::{self as php_test_coverage, PhpCloverCoverageResponse};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, State};

pub(super) async fn run_php_test_coverage_clover(
    workspace_id: WorkspaceId,
    root_path: String,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<PhpCloverCoverageResponse, String> {
    let root = retained_root(&registry, &workspace_id, Path::new(&root_path))?;
    let trusted = trust
        .lock()
        .map_err(|_| "Failed to inspect PHP coverage workspace trust.".to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(PhpCloverCoverageResponse::Unavailable {
            message: "Trust this workspace to run PHP test coverage.".to_string(),
        });
    }
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Failed to resolve app data directory for PHP coverage.".to_string())?;
    php_test_coverage::run_registered(root, app_data_base).await
}

#[cfg(unix)]
fn retained_root(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    requested_root: &Path,
) -> Result<std::fs::File, String> {
    let descriptor = registry
        .descriptor(workspace_id)
        .map_err(|_| "PHP coverage workspace is not open or its identity changed.".to_string())?;
    if requested_root != descriptor.selected_root_path
        && requested_root != descriptor.canonical_root_path
    {
        return Err(
            "PHP coverage workspace identity does not match the requested root.".to_string(),
        );
    }
    registry
        .clone_root(workspace_id)
        .map_err(|_| "PHP coverage workspace is not open or its identity changed.".to_string())
}

#[cfg(not(unix))]
fn retained_root(
    _registry: &WorkspaceRegistry,
    _workspace_id: &WorkspaceId,
    _requested_root: &Path,
) -> Result<std::fs::File, String> {
    Err("Retained PHP coverage workspaces are unsupported on this platform.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    #[test]
    fn retained_authority_requires_both_workspace_id_and_registered_root() {
        let root = fixture("authority");
        let other = fixture("other");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).unwrap();
        assert!(retained_root(&registry, &descriptor.workspace_id, &root).is_ok());
        assert!(retained_root(&registry, &descriptor.workspace_id, &other).is_err());
        registry.unregister(&descriptor.workspace_id).unwrap();
        assert!(retained_root(&registry, &descriptor.workspace_id, &root).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    fn fixture(label: &str) -> PathBuf {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "mockor-php-coverage-command-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
