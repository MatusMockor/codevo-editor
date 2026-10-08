use crate::agent_task_spawner::{
    claude_session_policy::ClaudeSessionEndReason, claude_session_registry::ClaudeSessionRegistry,
};
use crate::agent_task_supervisor::AgentTaskRegistry;
use crate::workspace_registry::WorkspaceId;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn stop_agents_of_revoked_workspace<R: Runtime>(
    app: &AppHandle<R>,
    workspace_id: &WorkspaceId,
) {
    let workspace_id = workspace_id.as_str();
    let sessions = app.try_state::<Arc<ClaudeSessionRegistry>>();
    let end_sessions = || {
        if let Some(sessions) = &sessions {
            sessions.end_for_workspace(workspace_id, ClaudeSessionEndReason::TrustRevoked);
        }
    };
    let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() else {
        return end_sessions();
    };
    agent_tasks.stop_for_revoked_workspace_trust(workspace_id, end_sessions);
}

#[cfg(all(test, unix))]
#[path = "agent_trust_revocation_tests.rs"]
mod tests;
