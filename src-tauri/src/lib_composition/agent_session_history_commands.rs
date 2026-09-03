use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::run_blocking_command;
use agent_session_history::{
    list_external_agent_sessions as list_sessions,
    preview_external_agent_session as preview_session, ExternalAgentSessionListing,
    ExternalAgentSessionPreview, ListExternalAgentSessionsRequest,
    PreviewExternalAgentSessionRequest,
};

#[path = "../agent_session_history.rs"]
pub(crate) mod agent_session_history;

pub(crate) const UNTRUSTED_EXTERNAL_SESSION_REPOSITORY_ERROR: &str =
    "External agent session history requires a trusted repository.";
pub(crate) const EXTERNAL_SESSION_REPOSITORY_CONTAINMENT_ERROR: &str =
    "External agent session history requires a repository inside the open project.";

fn ensure_external_session_repository_trusted(trusted: bool) -> Result<(), String> {
    if trusted {
        return Ok(());
    }

    Err(UNTRUSTED_EXTERNAL_SESSION_REPOSITORY_ERROR.to_string())
}

fn ensure_external_session_repository_contained(
    project_root: &str,
    repository_root: &str,
) -> Result<(), String> {
    let project = canonicalize_workspace_root(project_root)?;
    let repository = canonicalize_workspace_root(repository_root)?;
    if repository.starts_with(project) {
        return Ok(());
    }
    Err(EXTERNAL_SESSION_REPOSITORY_CONTAINMENT_ERROR.to_string())
}

#[tauri::command]
pub(crate) async fn list_external_agent_sessions(
    request: ListExternalAgentSessionsRequest,
    trust: GitTrustState<'_>,
) -> Result<ExternalAgentSessionListing, String> {
    ensure_external_session_repository_trusted(trusted_for(&trust, &request.project_root)?)?;
    ensure_external_session_repository_contained(&request.project_root, &request.repository_root)?;
    run_blocking_command(move || list_sessions(&request)).await
}

#[tauri::command]
pub(crate) async fn preview_external_agent_session(
    request: PreviewExternalAgentSessionRequest,
    trust: GitTrustState<'_>,
) -> Result<ExternalAgentSessionPreview, String> {
    ensure_external_session_repository_trusted(trusted_for(&trust, &request.project_root)?)?;
    ensure_external_session_repository_contained(&request.project_root, &request.repository_root)?;
    run_blocking_command(move || preview_session(&request)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_task_spawner::AgentCliInvocation;

    const SESSION_ID: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn untrusted_repository_is_refused_before_any_history_read() {
        let listing = tauri::async_runtime::block_on(list_external_agent_sessions(
            ListExternalAgentSessionsRequest {
                project_root: "/nonexistent-history-root".to_string(),
                repository_root: "/nonexistent-history-root".to_string(),
            },
            false,
        ))
        .expect_err("untrusted repository must be refused");
        let preview = tauri::async_runtime::block_on(preview_external_agent_session(
            PreviewExternalAgentSessionRequest {
                provider: AgentCliInvocation::ClaudeCode,
                session_id: SESSION_ID.to_string(),
                project_root: "/nonexistent-history-root".to_string(),
                repository_root: "/nonexistent-history-root".to_string(),
            },
            false,
        ))
        .expect_err("untrusted repository must be refused");

        assert_eq!(listing, UNTRUSTED_EXTERNAL_SESSION_REPOSITORY_ERROR);
        assert_eq!(preview, UNTRUSTED_EXTERNAL_SESSION_REPOSITORY_ERROR);
    }

    #[test]
    fn trusted_repository_still_validates_the_requested_root() {
        let error = tauri::async_runtime::block_on(list_external_agent_sessions(
            ListExternalAgentSessionsRequest {
                project_root: "/".to_string(),
                repository_root: "not-absolute".to_string(),
            },
            true,
        ))
        .expect_err("invalid root must be refused after the trust gate");

        assert_ne!(error, UNTRUSTED_EXTERNAL_SESSION_REPOSITORY_ERROR);
    }
}
