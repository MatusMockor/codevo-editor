use crate::agent_task_spawner::{
    claude_session_policy::ClaudeSessionEndReason, claude_session_registry::ClaudeSessionRegistry,
    codex_app_server_host::CodexAppServerHostRegistry,
};
use crate::agent_task_supervisor::AgentTaskRegistry;
use crate::trust::{WorkspaceTrustService, WorkspaceTrustState};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime};

pub(crate) struct TrustRevocation {
    pub(crate) state: WorkspaceTrustState,
    pub(crate) runtime_root: PathBuf,
    pub(crate) registered: Option<ManagedWorkspaceDescriptor>,
}

pub(crate) fn revoke_trust_and_stop_agents<R: Runtime>(
    app: &AppHandle<R>,
    trust: &Mutex<WorkspaceTrustService>,
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> io::Result<TrustRevocation> {
    let opened = workspace_opened_as(registry, Path::new(root_path));
    let state = revoke_trust_record(trust, opened.as_ref(), root_path)?;
    let revoked_root = Path::new(&state.root_path);
    let registered = opened.or_else(|| workspace_rooted_at(registry, revoked_root));
    stop_agents_of_revoked_trust(
        app,
        revoked_root,
        registered
            .as_ref()
            .map(|descriptor| &descriptor.workspace_id),
    );
    let runtime_root = match &registered {
        Some(descriptor) => descriptor.canonical_root_path.clone(),
        None => Path::new(root_path)
            .canonicalize()
            .unwrap_or_else(|_| revoked_root.to_path_buf()),
    };
    Ok(TrustRevocation {
        state,
        runtime_root,
        registered,
    })
}

fn workspace_opened_as(
    registry: &WorkspaceRegistry,
    spelling: &Path,
) -> Option<ManagedWorkspaceDescriptor> {
    registry
        .descriptor_for_registered_path(spelling)
        .ok()
        .filter(|descriptor| {
            descriptor.selected_root_path.as_os_str() == spelling.as_os_str()
                || descriptor.canonical_root_path.as_os_str() == spelling.as_os_str()
        })
}

fn workspace_rooted_at(
    registry: &WorkspaceRegistry,
    root: &Path,
) -> Option<ManagedWorkspaceDescriptor> {
    registry
        .descriptor_for_registered_path(root)
        .ok()
        .filter(|descriptor| descriptor.canonical_root_path.as_os_str() == root.as_os_str())
}

fn revoke_trust_record(
    trust: &Mutex<WorkspaceTrustService>,
    opened: Option<&ManagedWorkspaceDescriptor>,
    root_path: &str,
) -> io::Result<WorkspaceTrustState> {
    let mut trust = trust
        .lock()
        .map_err(|_| io::Error::other("workspace trust is unavailable"))?;
    match opened {
        Some(descriptor) => trust.revoke_resolved_root(&descriptor.canonical_root_path),
        None => trust.set(root_path, false),
    }
}

fn stop_agents_of_revoked_trust<R: Runtime>(
    app: &AppHandle<R>,
    trust_root: &Path,
    registered: Option<&WorkspaceId>,
) {
    let sessions = app.try_state::<Arc<ClaudeSessionRegistry>>();
    let end_sessions = || {
        if let (Some(sessions), Some(workspace_id)) = (&sessions, registered) {
            sessions.end_for_workspace(workspace_id.as_str(), ClaudeSessionEndReason::TrustRevoked);
        }
    };
    match app.try_state::<AgentTaskRegistry>() {
        Some(agent_tasks) => {
            agent_tasks.stop_for_revoked_trust(trust_root, end_sessions);
        }
        None => end_sessions(),
    }
    if let Some(hosts) = app.try_state::<Arc<CodexAppServerHostRegistry>>() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            hosts.retire_for_revoked_trust(trust_root);
        }));
    }
}

#[cfg(all(test, unix))]
#[path = "agent_trust_revocation_tests.rs"]
mod tests;
