use super::agent_provider_sign_in::{
    start_agent_provider_sign_in as start_sign_in, AgentProviderSignInRequest,
    AgentProviderSignInResult,
};
use crate::{
    agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry,
    run_blocking_command, terminal::AppHandleTerminalEventSink,
    terminal_session::TerminalSupervisor,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub(crate) async fn start_agent_provider_sign_in(
    request: AgentProviderSignInRequest,
    app: AppHandle,
) -> Result<AgentProviderSignInResult, String> {
    run_blocking_command(move || {
        let registry = app.state::<Arc<AgentProviderRuntimeRegistry>>();
        let terminal = app.state::<TerminalSupervisor>();
        let sink = Arc::new(AppHandleTerminalEventSink::new(app.clone()));
        Ok(start_sign_in(request, &registry, &terminal, sink))
    })
    .await
}
