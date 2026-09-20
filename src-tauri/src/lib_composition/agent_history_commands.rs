use crate::run_blocking_command;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
#[path = "../agent_history_store/mod.rs"]
pub(crate) mod agent_history_store;
use agent_history_store::{legacy::AgentThread, AgentHistoryStore, HistorySnapshot, TurnPage};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryOwnerRequest {
    root_key: String,
    owner_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistorySaveRequest {
    root_key: String,
    owner_id: String,
    thread: AgentThread,
    expected_revision: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryThreadRequest {
    root_key: String,
    owner_id: String,
    thread_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryPageRequest {
    root_key: String,
    owner_id: String,
    thread_id: String,
    before_turn_id: Option<String>,
}
#[tauri::command]
pub(crate) async fn load_agent_history(
    request: HistoryOwnerRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<HistorySnapshot, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || store.load(&request.root_key, &request.owner_id)).await
}
#[tauri::command]
pub(crate) async fn save_agent_history_thread(
    request: HistorySaveRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<agent_history_store::HistorySaveReceipt, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.save(
            &request.root_key,
            &request.owner_id,
            &request.thread,
            request.expected_revision,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn read_agent_history_turns(
    request: HistoryPageRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<TurnPage, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.read_turns(
            &request.root_key,
            &request.owner_id,
            &request.thread_id,
            request.before_turn_id.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn delete_agent_history_thread(
    request: HistoryThreadRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<(), String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.delete(&request.root_key, &request.owner_id, &request.thread_id)
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryThreadsRequest {
    root_key: String,
    owner_id: String,
    before_thread_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryImportRequest {
    root_key: String,
    owner_id: String,
    provider: crate::agent_task_spawner::AgentCliInvocation,
    session_id: String,
    repository_root: String,
}
#[tauri::command]
pub(crate) async fn read_agent_history_threads(
    request: HistoryThreadsRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<agent_history_store::ThreadPage, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.read_threads(
            &request.root_key,
            &request.owner_id,
            request.before_thread_id.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn find_agent_history_import(
    request: HistoryImportRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<Option<agent_history_store::FoundImport>, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.find_import(
            &request.root_key,
            &request.owner_id,
            request.provider,
            &request.session_id,
            &request.repository_root,
        )
    })
    .await
}
