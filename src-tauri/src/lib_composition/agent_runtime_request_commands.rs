use super::*;
use crate::agent_runtime_requests::feed::ThreadRequestsSink;
use crate::agent_runtime_requests::model::ThreadRequests;
use crate::agent_runtime_requests::projection::{
    RequestProjection, ThreadRequestsPage, INVALID_THREAD_REQUESTS_QUERY_ERROR, MAX_CURSOR_BYTES,
    MAX_PULL_TURNS,
};
use crate::agent_runtime_requests::scopes::HistoryScope;

pub(crate) const AGENT_THREAD_REQUESTS_EVENT_CHANNEL: &str = "agent-thread://requests";
pub(crate) const AGENT_THREAD_REQUESTS_INVALIDATED_EVENT_CHANNEL: &str =
    "agent-thread://requests-invalidated";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadRequestsInvalidation {
    pub(crate) epoch: String,
}
pub(crate) const UNOWNED_THREAD_REQUESTS_ROOT_ERROR: &str =
    "Agent thread requests belong to a project this window has not opened.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ThreadRequestsQuery {
    root_key: String,
    owner_id: String,
    thread_id: String,
    turn_ids: Vec<String>,
    #[serde(deserialize_with = "present_cursor")]
    cursor: Option<String>,
}

fn present_cursor<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

pub(crate) struct AppHandleThreadRequestsSink(pub(crate) AppHandle);

impl ThreadRequestsSink for AppHandleThreadRequestsSink {
    fn publish(&self, message: ThreadRequests) {
        let _ = self.0.emit(AGENT_THREAD_REQUESTS_EVENT_CHANNEL, &message);
    }

    fn invalidate(&self, epoch: &str) {
        let invalidation = ThreadRequestsInvalidation {
            epoch: epoch.to_string(),
        };
        let _ = self.0.emit(
            AGENT_THREAD_REQUESTS_INVALIDATED_EVENT_CHANNEL,
            &invalidation,
        );
    }
}

fn unowned<T>() -> Result<T, String> {
    Err(UNOWNED_THREAD_REQUESTS_ROOT_ERROR.to_string())
}

fn is_registered(
    workspaces: &WorkspaceRegistry,
    leases: &AgentRootLeaseRegistry,
    root: &Path,
) -> bool {
    if workspaces.descriptor_for_registered_path(root).is_ok() {
        return true;
    }
    leases.registered(root).is_some_and(|lease| {
        workspaces
            .descriptor(&lease.registration.workspace_id)
            .is_ok()
    })
}

fn owned_scope(
    workspaces: &WorkspaceRegistry,
    leases: &AgentRootLeaseRegistry,
    query: &ThreadRequestsQuery,
) -> Result<HistoryScope, String> {
    use super::super::agent_attachment_commands::agent_thread_store::{
        agent_root_owner_id, MAX_AGENT_ROOT_KEY_BYTES,
    };
    let root_key = query.root_key.as_str();
    if root_key.is_empty()
        || root_key.len() > MAX_AGENT_ROOT_KEY_BYTES
        || root_key.chars().any(char::is_control)
        || query.owner_id != agent_root_owner_id(root_key)
    {
        return unowned();
    }
    let Ok(canonical) = canonicalize_workspace_root(root_key) else {
        return unowned();
    };
    if !is_registered(workspaces, leases, &canonical) {
        return unowned();
    }
    Ok(HistoryScope {
        root_key: query.root_key.clone(),
        owner_id: query.owner_id.clone(),
    })
}

pub(super) fn owned_thread_requests(
    workspaces: &WorkspaceRegistry,
    leases: &AgentRootLeaseRegistry,
    projection: &RequestProjection,
    query: &ThreadRequestsQuery,
) -> Result<ThreadRequestsPage, String> {
    let oversized = query.turn_ids.len() > MAX_PULL_TURNS
        || query
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > MAX_CURSOR_BYTES);
    if oversized {
        return Err(INVALID_THREAD_REQUESTS_QUERY_ERROR.to_string());
    }
    let scope = owned_scope(workspaces, leases, query)?;
    projection
        .page(
            &scope,
            &query.thread_id,
            &query.turn_ids,
            query.cursor.as_deref(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn get_agent_thread_requests(
    app: AppHandle,
    request: ThreadRequestsQuery,
) -> Result<ThreadRequestsPage, String> {
    run_blocking_command(move || {
        owned_thread_requests(
            &app.state::<WorkspaceRegistry>(),
            app.state::<Arc<AgentRootLeaseRegistry>>().inner(),
            app.state::<Arc<RequestProjection>>().inner(),
            &request,
        )
    })
    .await
}

#[cfg(all(test, unix))]
#[path = "tests/agent_runtime_request_commands_tests.rs"]
mod tests;
