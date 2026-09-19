use super::agent_thread_store_commands::ensure_agent_root_owner;
use crate::run_blocking_command;
use agent_turn_log::wire::{
    AgentTurnLogLease, AgentTurnLogPage, AgentTurnLogSummary, AppendAgentTurnLogReceipt,
    AppendAgentTurnLogRequest, DeleteAgentThreadLogRequest, DeleteAgentThreadLogResult,
    OpenAgentTurnLogRequest, ReadAgentTurnLogPageRequest, SummarizeAgentTurnLogsRequest,
};
use agent_turn_log::{AgentTurnLogError, AgentTurnLogResult, AgentTurnLogStore};
use std::sync::Arc;
use tauri::State;

#[path = "../agent_turn_log/mod.rs"]
pub(crate) mod agent_turn_log;

fn authorize(root_key: &str, owner_id: &str) -> Result<(), String> {
    ensure_agent_root_owner(root_key, owner_id)
        .map_err(|_| AgentTurnLogError::OwnerMismatch.code().to_string())
}

async fn scoped<T>(
    root_key: &str,
    owner_id: &str,
    work: impl FnOnce() -> AgentTurnLogResult<T> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
{
    authorize(root_key, owner_id)?;
    run_blocking_command(move || work().map_err(AgentTurnLogError::message)).await
}

#[tauri::command]
pub(crate) async fn open_agent_turn_log(
    request: OpenAgentTurnLogRequest,
    store: State<'_, Arc<AgentTurnLogStore>>,
) -> Result<AgentTurnLogLease, String> {
    let store = Arc::clone(&store);
    let root_key = request.scope.root_key.clone();
    let owner_id = request.scope.owner_id.clone();
    scoped(&root_key, &owner_id, move || store.open(&request)).await
}

#[tauri::command]
pub(crate) async fn append_agent_turn_log(
    request: AppendAgentTurnLogRequest,
    store: State<'_, Arc<AgentTurnLogStore>>,
) -> Result<AppendAgentTurnLogReceipt, String> {
    let store = Arc::clone(&store);
    let root_key = request.scope.root_key.clone();
    let owner_id = request.scope.owner_id.clone();
    scoped(&root_key, &owner_id, move || store.append(&request)).await
}

#[tauri::command]
pub(crate) async fn read_agent_turn_log_page(
    request: ReadAgentTurnLogPageRequest,
    store: State<'_, Arc<AgentTurnLogStore>>,
) -> Result<AgentTurnLogPage, String> {
    let store = Arc::clone(&store);
    let root_key = request.scope.root_key.clone();
    let owner_id = request.scope.owner_id.clone();
    scoped(&root_key, &owner_id, move || store.read_page(&request)).await
}

#[tauri::command]
pub(crate) async fn summarize_agent_turn_logs(
    request: SummarizeAgentTurnLogsRequest,
    store: State<'_, Arc<AgentTurnLogStore>>,
) -> Result<Vec<AgentTurnLogSummary>, String> {
    let store = Arc::clone(&store);
    let root_key = request.root_key.clone();
    let owner_id = request.owner_id.clone();
    scoped(&root_key, &owner_id, move || store.summarize(&request)).await
}

#[tauri::command]
pub(crate) async fn delete_agent_thread_log(
    request: DeleteAgentThreadLogRequest,
    store: State<'_, Arc<AgentTurnLogStore>>,
) -> Result<DeleteAgentThreadLogResult, String> {
    let store = Arc::clone(&store);
    let root_key = request.root_key.clone();
    let owner_id = request.owner_id.clone();
    scoped(&root_key, &owner_id, move || {
        store.delete_thread_log(&request)
    })
    .await
}

#[cfg(test)]
#[path = "agent_turn_log_commands_tests.rs"]
mod tests;
