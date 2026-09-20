use super::{
    agent_history_commands::agent_history_store::{
        imports::{ImportProgress, ImportedHistoryPage},
        AgentHistoryStore,
    },
    trusted_for, GitTrustState,
};
use crate::run_blocking_command;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportSessionRequest {
    root_key: String,
    owner_id: String,
    thread_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportedHistoryRequest {
    root_key: String,
    owner_id: String,
    thread_id: String,
    before_ordinal: Option<u64>,
}

#[tauri::command]
pub(crate) async fn import_agent_session_history(
    request: ImportSessionRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
    trust: GitTrustState<'_>,
) -> Result<ImportProgress, String> {
    if !trusted_for(&trust, &request.root_key)? {
        return Err("Importing a session requires a trusted project.".to_string());
    }
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.import_session_history(&request.root_key, &request.owner_id, &request.thread_id)
    })
    .await
}
#[tauri::command]
pub(crate) async fn read_agent_imported_history(
    request: ImportedHistoryRequest,
    store: State<'_, Arc<AgentHistoryStore>>,
) -> Result<ImportedHistoryPage, String> {
    if request
        .before_ordinal
        .is_some_and(|ordinal| ordinal > 9_007_199_254_740_991)
    {
        return Err("Invalid imported history cursor.".to_string());
    }
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        store.read_imported_history(
            &request.root_key,
            &request.owner_id,
            &request.thread_id,
            request.before_ordinal,
        )
    })
    .await
}
