use super::*;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTaskOutputAcknowledgementRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    sequence: u64,
}

#[tauri::command]
pub(crate) fn acknowledge_agent_task_output(
    request: AgentTaskOutputAcknowledgementRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    state.registry.acknowledge_output_for_workspace(
        &task_id,
        request.workspace_id.as_str(),
        request.sequence,
    )
}
