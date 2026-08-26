use super::{
    canonicalize_workspace_root, ensure_agent_task_trust, ensure_workspace_id_bounds,
    StartAgentTaskRequest, AGENT_PROJECT_ROOT_MISMATCH_ERROR, AGENT_REPOSITORY_CONTAINMENT_ERROR,
    AGENT_TRUST_START_BUSY_ERROR, INVALID_AGENT_TASK_PATH_ERROR, IN_PLACE_AGENT_CWD_ERROR,
    MAX_AGENT_TASK_PATH_BYTES, UNKNOWN_AGENT_WORKSPACE_ERROR, UNTRUSTED_AGENT_REPOSITORY_ERROR,
    UNTRUSTED_AGENT_WORKTREE_ERROR,
};
use crate::agent_task_supervisor::AgentTaskIsolation;
use crate::git_worktree::ensure_worktree_path_in_base;
use crate::trust::{WorkspaceTrustLaunchLease, WorkspaceTrustService, WorkspaceTrustSnapshot};
use crate::workspace_registry::{
    opened_root_path, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub(super) struct AgentTaskProjectAuthority {
    pub(super) descriptor: ManagedWorkspaceDescriptor,
    pub(super) project_root: PathBuf,
    pub(super) repository_root: PathBuf,
    pub(super) cwd: PathBuf,
    pub(super) project_authority: Arc<std::fs::File>,
    pub(super) repository_authority: Arc<std::fs::File>,
    pub(super) cwd_authority: Arc<std::fs::File>,
    pub(super) project_trust: WorkspaceTrustSnapshot,
    pub(super) cwd_trust: WorkspaceTrustSnapshot,
}

fn has_ambiguous_components(path: &Path) -> bool {
    !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
}

fn ensure_agent_task_path_bounds(path_text: &str) -> Result<(), String> {
    if path_text.is_empty()
        || path_text.len() > MAX_AGENT_TASK_PATH_BYTES
        || path_text.chars().any(char::is_control)
    {
        return Err(INVALID_AGENT_TASK_PATH_ERROR.to_string());
    }
    let path = Path::new(path_text);
    if has_ambiguous_components(path) {
        return Err(INVALID_AGENT_TASK_PATH_ERROR.to_string());
    }
    let normalized = path.components().collect::<PathBuf>();
    if normalized.as_os_str() != path.as_os_str() {
        return Err(INVALID_AGENT_TASK_PATH_ERROR.to_string());
    }

    Ok(())
}

fn ensure_agent_task_request_bounds(request: &StartAgentTaskRequest) -> Result<(), String> {
    ensure_workspace_id_bounds(&request.workspace_id)?;
    ensure_agent_task_path_bounds(&request.project_root)?;
    ensure_agent_task_path_bounds(&request.repository_root)?;
    ensure_agent_task_path_bounds(&request.cwd)?;
    Ok(())
}

#[cfg(unix)]
pub(super) fn retained_root_matches_path(retained_root: &std::fs::File, root_path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    match (retained_root.metadata(), root_path.metadata()) {
        (Ok(retained_metadata), Ok(path_metadata)) => {
            retained_metadata.dev() == path_metadata.dev()
                && retained_metadata.ino() == path_metadata.ino()
        }
        _ => false,
    }
}

#[cfg(unix)]
fn open_descriptor_bound_directory(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    project_root: &Path,
    target: &Path,
) -> Result<Arc<std::fs::File>, String> {
    let relative_path = target
        .strip_prefix(project_root)
        .map_err(|_| AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string())?;
    if relative_path.as_os_str().is_empty() {
        return registry
            .clone_root(workspace_id)
            .map(Arc::new)
            .map_err(|_| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string());
    }
    registry
        .open_directory_descendant(workspace_id, relative_path)
        .map(Arc::new)
        .map_err(|_| AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string())
}

#[cfg(not(unix))]
fn open_descriptor_bound_directory(
    _registry: &WorkspaceRegistry,
    _workspace_id: &WorkspaceId,
    _project_root: &Path,
    _target: &Path,
) -> Result<Arc<std::fs::File>, String> {
    Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
}

#[cfg(not(unix))]
pub(super) fn retained_root_matches_path(
    _retained_root: &std::fs::File,
    _root_path: &Path,
) -> bool {
    false
}

pub(super) fn capture_agent_task_project_authority(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: &StartAgentTaskRequest,
) -> Result<AgentTaskProjectAuthority, String> {
    ensure_agent_task_request_bounds(request)?;
    let trust = trust.lock().map_err(|error| error.to_string())?;
    let project_trust = trust.snapshot(&request.project_root);
    let cwd_trust = trust.snapshot(&request.cwd);
    drop(trust);
    capture_agent_task_project_authority_with_snapshots(registry, request, project_trust, cwd_trust)
}

fn capture_agent_task_project_authority_with_snapshots(
    registry: &WorkspaceRegistry,
    request: &StartAgentTaskRequest,
    project_trust: WorkspaceTrustSnapshot,
    cwd_trust: WorkspaceTrustSnapshot,
) -> Result<AgentTaskProjectAuthority, String> {
    ensure_agent_task_request_bounds(request)?;
    let descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())?;
    let requested_project_root = Path::new(&request.project_root);
    if has_ambiguous_components(requested_project_root)
        || (requested_project_root != descriptor.selected_root_path
            && requested_project_root != descriptor.canonical_root_path)
    {
        return Err(AGENT_PROJECT_ROOT_MISMATCH_ERROR.to_string());
    }
    let retained_root = registry
        .clone_root(&request.workspace_id)
        .map_err(|_| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())?;
    let retained_identity =
        opened_root_path(&retained_root).map_err(|_| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())?;
    let project_root = canonicalize_workspace_root(&request.project_root)?;
    if retained_identity != descriptor.canonical_root_path
        || project_root != descriptor.canonical_root_path
        || !retained_root_matches_path(&retained_root, &project_root)
    {
        return Err(AGENT_PROJECT_ROOT_MISMATCH_ERROR.to_string());
    }

    let requested_repository_root = Path::new(&request.repository_root);
    if has_ambiguous_components(requested_repository_root) {
        return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
    }
    let repository_root = canonicalize_workspace_root(&request.repository_root)?;
    if !repository_root.starts_with(&project_root) {
        return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
    }
    if repository_root != project_root && requested_repository_root != repository_root {
        return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
    }
    let repository_authority = open_descriptor_bound_directory(
        registry,
        &request.workspace_id,
        &project_root,
        &repository_root,
    )?;
    if !retained_root_matches_path(&repository_authority, &repository_root) {
        return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
    }

    let cwd = match request.isolation {
        AgentTaskIsolation::InPlace => {
            let cwd = canonicalize_workspace_root(&request.cwd)?;
            if cwd != repository_root {
                return Err(IN_PLACE_AGENT_CWD_ERROR.to_string());
            }
            cwd
        }
        AgentTaskIsolation::Worktree => {
            ensure_worktree_path_in_base(&repository_root, Path::new(&request.cwd))?
        }
    };
    let cwd_authority =
        open_descriptor_bound_directory(registry, &request.workspace_id, &project_root, &cwd)?;
    if !retained_root_matches_path(&cwd_authority, &cwd) {
        return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
    }

    ensure_agent_task_trust(project_trust.trusted, cwd_trust.trusted, request.isolation)?;

    Ok(AgentTaskProjectAuthority {
        descriptor,
        project_root,
        repository_root,
        cwd,
        project_authority: Arc::new(retained_root),
        repository_authority,
        cwd_authority,
        project_trust,
        cwd_trust,
    })
}

#[cfg(test)]
pub(super) fn revalidate_agent_task_project_authority(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: &StartAgentTaskRequest,
    expected: &AgentTaskProjectAuthority,
) -> Result<(), String> {
    revalidate_agent_task_filesystem_authority(registry, request, expected)?;
    let leases = reserve_agent_task_trust(trust, expected, request.isolation)?;
    drop(leases);
    Ok(())
}

pub(super) fn revalidate_agent_task_filesystem_authority(
    registry: &WorkspaceRegistry,
    request: &StartAgentTaskRequest,
    expected: &AgentTaskProjectAuthority,
) -> Result<(), String> {
    let current = capture_agent_task_project_authority_with_snapshots(
        registry,
        request,
        expected.project_trust.clone(),
        expected.cwd_trust.clone(),
    )?;
    let unchanged = current.descriptor == expected.descriptor
        && current.project_root == expected.project_root
        && current.repository_root == expected.repository_root
        && current.cwd == expected.cwd
        && current.project_trust == expected.project_trust
        && current.cwd_trust == expected.cwd_trust
        && retained_root_matches_path(&expected.project_authority, &current.project_root)
        && retained_root_matches_path(&expected.repository_authority, &current.repository_root)
        && retained_root_matches_path(&expected.cwd_authority, &current.cwd);
    if !unchanged {
        return Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string());
    }

    Ok(())
}

pub(super) fn reserve_agent_task_trust(
    trust: &Mutex<WorkspaceTrustService>,
    expected: &AgentTaskProjectAuthority,
    isolation: AgentTaskIsolation,
) -> Result<Vec<WorkspaceTrustLaunchLease>, String> {
    let trust = trust.lock().map_err(|error| error.to_string())?;
    let project_lease = trust
        .reserve_launch(&expected.project_trust)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                return UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string();
            }
            AGENT_TRUST_START_BUSY_ERROR.to_string()
        })?;
    let mut leases = vec![project_lease];
    if isolation == AgentTaskIsolation::Worktree {
        let cwd_lease = trust.reserve_launch(&expected.cwd_trust).map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                return UNTRUSTED_AGENT_WORKTREE_ERROR.to_string();
            }
            AGENT_TRUST_START_BUSY_ERROR.to_string()
        })?;
        leases.push(cwd_lease);
    }
    drop(trust);
    Ok(leases)
}
