use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::workspace_registry::{
    WorkspaceId, WorkspaceRegistrationOperationLease, WorkspaceRegistry,
};
use serde::Deserialize;
use std::{io, path::Path, sync::Mutex};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenedProjectTrustTarget {
    workspace_id: WorkspaceId,
    admission_token: u64,
    selected_root_path: String,
    canonical_root_path: String,
}

pub(crate) fn grant(
    registry: &WorkspaceRegistry,
    service: &Mutex<WorkspaceTrustService>,
    target: OpenedProjectTrustTarget,
    activate: impl FnOnce(&WorkspaceTrustState),
) -> io::Result<WorkspaceTrustState> {
    validate_target(&target)?;
    let lease = registry
        .reserve_latest_registration_operation(&target.workspace_id, target.admission_token)?;
    if lease.descriptor().selected_root_path != Path::new(&target.selected_root_path)
        || lease.descriptor().canonical_root_path != Path::new(&target.canonical_root_path)
    {
        return Err(invalid_identity());
    }
    grant_lease(&lease, service, activate)
}

fn grant_lease(
    lease: &WorkspaceRegistrationOperationLease,
    service: &Mutex<WorkspaceTrustService>,
    activate: impl FnOnce(&WorkspaceTrustState),
) -> io::Result<WorkspaceTrustState> {
    lease.with_current_commit(|| {
        let root = &lease.descriptor().canonical_root_path;
        ensure_live_root(lease, root)?;
        let mut service = service
            .lock()
            .map_err(|_| io::Error::other("trust lock failed"))?;
        ensure_live_root(lease, root)?;
        let state = service.grant_opened_canonical_root(&root.to_string_lossy())?;
        activate(&state);
        Ok(state)
    })?
}

fn validate_target(target: &OpenedProjectTrustTarget) -> io::Result<()> {
    if target.admission_token == 0 || target.admission_token > (1_u64 << 53) - 1 {
        return Err(invalid_identity());
    }
    for value in [
        target.workspace_id.as_str(),
        &target.selected_root_path,
        &target.canonical_root_path,
    ] {
        if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
            return Err(invalid_identity());
        }
    }
    if !Path::new(&target.selected_root_path).is_absolute()
        || !Path::new(&target.canonical_root_path).is_absolute()
    {
        return Err(invalid_identity());
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_live_root(lease: &WorkspaceRegistrationOperationLease, root: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let retained = lease.try_clone_root()?.metadata()?;
    let current = std::fs::symlink_metadata(root)?;
    if !current.is_dir() || retained.dev() != current.dev() || retained.ino() != current.ino() {
        return Err(invalid_identity());
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_live_root(_lease: &WorkspaceRegistrationOperationLease, _root: &Path) -> io::Result<()> {
    Err(invalid_identity())
}

fn invalid_identity() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "opened project identity is invalid or replaced",
    )
}

#[cfg(all(test, unix))]
#[path = "workspace_opened_project_trust_tests.rs"]
mod tests;
