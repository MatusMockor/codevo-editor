use super::agent_root_lease::{
    AgentRootLeaseRegistry, AgentRootLeaseReleaseDisposition, AgentRootWorkspaceRegistration,
    RegisteredAgentRootLease, RegisteredAgentRootLeaseAcquisition,
};
use crate::workspace_registry::WorkspaceRegistry;
use std::path::Path;

pub(super) fn acquire_registered_workspace_lease(
    canonical_root: &Path,
    workspace_registry: &WorkspaceRegistry,
    leases: &AgentRootLeaseRegistry,
) -> Result<RegisteredAgentRootLease, String> {
    if let Some(existing) = leases.registered(canonical_root) {
        return Ok(existing);
    }
    let registration = workspace_registry
        .register_with_receipt(canonical_root)
        .map_err(|error| error.to_string())?;
    let workspace_registration = AgentRootWorkspaceRegistration {
        workspace_id: registration.receipt.workspace_id,
        admission_token: registration.receipt.admission_token,
    };
    match leases.acquire_registered(canonical_root, workspace_registration.clone()) {
        Ok(RegisteredAgentRootLeaseAcquisition::Acquired(lease)) => Ok(lease),
        Ok(RegisteredAgentRootLeaseAcquisition::Existing(lease)) => {
            rollback_workspace_registration(workspace_registry, workspace_registration)?;
            Ok(lease)
        }
        Err(error) => {
            rollback_workspace_registration(workspace_registry, workspace_registration)?;
            Err(error)
        }
    }
}

pub(super) fn release_registered_workspace_lease(
    canonical_root: &Path,
    token: u64,
    leases: &AgentRootLeaseRegistry,
    workspace_registry: Option<&WorkspaceRegistry>,
) -> Result<AgentRootLeaseReleaseDisposition, String> {
    let (disposition, registration) = leases.release_registered(canonical_root, token);
    if disposition == AgentRootLeaseReleaseDisposition::Released {
        if let (Some(registry), Some(registration)) = (workspace_registry, registration) {
            rollback_workspace_registration(registry, registration)?;
        }
    }
    Ok(disposition)
}

fn rollback_workspace_registration(
    registry: &WorkspaceRegistry,
    registration: AgentRootWorkspaceRegistration,
) -> Result<(), String> {
    let Some(mut rollback) = registry
        .rollback_registration(&registration.workspace_id, registration.admission_token)
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    if rollback.removed_identity {
        rollback.begin_cleanup();
    }
    rollback.finalize().map_err(|error| error.to_string())
}
