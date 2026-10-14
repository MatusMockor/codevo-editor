use super::agent_task_start_authority::{retained_root_matches_path, AgentTaskProjectAuthority};
use super::canonicalize_workspace_root;
use crate::agent_runtime_requests::scopes::HistoryScope;
use serde::Deserialize;

pub(crate) const AGENT_HISTORY_SCOPE_MISMATCH_ERROR: &str =
    "Agent history scope does not match the workspace the task starts in.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartAgentTaskHistoryScope {
    pub(super) root_key: String,
    pub(super) owner_id: String,
}

fn mismatch<T>() -> Result<T, String> {
    Err(AGENT_HISTORY_SCOPE_MISMATCH_ERROR.to_string())
}

pub(super) fn bound_history_scope(
    requested: &StartAgentTaskHistoryScope,
    authority: &AgentTaskProjectAuthority,
) -> Result<HistoryScope, String> {
    use super::super::agent_attachment_commands::agent_thread_store::{
        agent_root_owner_id, MAX_AGENT_ROOT_KEY_BYTES,
    };
    let root_key = requested.root_key.as_str();
    if root_key.is_empty()
        || root_key.len() > MAX_AGENT_ROOT_KEY_BYTES
        || root_key.chars().any(char::is_control)
        || requested.owner_id != agent_root_owner_id(root_key)
    {
        return mismatch();
    }
    let Ok(canonical) = canonicalize_workspace_root(root_key) else {
        return mismatch();
    };
    if canonical != authority.project_root
        || !retained_root_matches_path(&authority.project_authority, &canonical)
    {
        return mismatch();
    }
    Ok(HistoryScope {
        root_key: requested.root_key.clone(),
        owner_id: requested.owner_id.clone(),
    })
}
