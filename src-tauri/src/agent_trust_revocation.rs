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
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Runtime};

pub(crate) struct TrustRevocation {
    pub(crate) state: WorkspaceTrustState,
    pub(crate) runtime_root: Option<PathBuf>,
    pub(crate) registered: Option<ManagedWorkspaceDescriptor>,
}

pub(crate) fn stop_agents_of_revoked_opened_project<R: Runtime>(
    app: &AppHandle<R>,
    opened: ManagedWorkspaceDescriptor,
    revoked_roots: &[String],
) -> TrustRevocation {
    for revoked_root in revoked_roots {
        stop_agents_of_revoked_trust(app, Path::new(revoked_root), Some(&opened.workspace_id));
    }
    TrustRevocation {
        state: WorkspaceTrustState {
            root_path: opened.canonical_root_path.to_string_lossy().into_owned(),
            trusted: false,
        },
        runtime_root: Some(opened.canonical_root_path.clone()),
        registered: Some(opened),
    }
}

pub(crate) fn revoke_path_trust_and_stop_agents<R: Runtime>(
    app: &AppHandle<R>,
    trust: &Mutex<WorkspaceTrustService>,
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> io::Result<TrustRevocation> {
    let state = locked(trust)?.set(root_path, false)?;
    let revoked_root = Path::new(&state.root_path);
    let runtime_root = Path::new(root_path)
        .canonicalize()
        .ok()
        .or_else(|| stored_spelling(revoked_root));
    let registered = runtime_root.as_deref().and_then(|root| {
        registry
            .descriptor_for_registered_path(root)
            .ok()
            .filter(|descriptor| descriptor.canonical_root_path.as_os_str() == root.as_os_str())
    });
    stop_agents_of_revoked_trust(
        app,
        revoked_root,
        registered
            .as_ref()
            .map(|descriptor| &descriptor.workspace_id),
    );
    Ok(TrustRevocation {
        state,
        runtime_root,
        registered,
    })
}

fn stored_spelling(revoked_root: &Path) -> Option<PathBuf> {
    let spelled_as_stored =
        revoked_root.components().collect::<PathBuf>().as_os_str() == revoked_root.as_os_str();
    spelled_as_stored.then(|| revoked_root.to_path_buf())
}

fn locked(
    trust: &Mutex<WorkspaceTrustService>,
) -> io::Result<MutexGuard<'_, WorkspaceTrustService>> {
    trust
        .lock()
        .map_err(|_| io::Error::other("workspace trust is unavailable"))
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
