use super::*;
use crate::agent_questions::approvals::{AgentApprovalDecision, AgentApprovalRequest};
use crate::agent_questions::interactions::AgentInteractionSnapshot;
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse};
const MAX_AGENT_INTERACTION_REQUEST_ID_BYTES: usize = 128;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InteractionOwner {
    task_id: String,
    workspace_id: WorkspaceId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionAnswerRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    request_id: String,
    response: AgentQuestionResponse,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApprovalAnswerRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    request_id: String,
    decision: AgentApprovalDecision,
}
fn registered_workspace_root(
    workspaces: &WorkspaceRegistry,
    task_id: &str,
    workspace_id: &WorkspaceId,
) -> Result<PathBuf, String> {
    safe_agent_task_id(task_id)?;
    ensure_workspace_id_bounds(workspace_id)?;
    let descriptor = workspaces
        .descriptor(workspace_id)
        .map_err(|error| error.to_string())?;
    revalidate_agent_steer_workspace(workspaces, &descriptor)
        .map_err(|_| "Question workspace changed.".to_string())?;
    Ok(descriptor.canonical_root_path)
}
fn ensure_request_id_bounds(request_id: &str) -> Result<(), String> {
    if request_id.len() > MAX_AGENT_INTERACTION_REQUEST_ID_BYTES {
        return Err("Invalid agent interaction request.".into());
    }
    Ok(())
}
fn owned_interactions(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    owner: &InteractionOwner,
) -> Result<AgentInteractionSnapshot, String> {
    let root = registered_workspace_root(workspaces, &owner.task_id, &owner.workspace_id)?;
    tasks.interactions(&owner.task_id, owner.workspace_id.as_str(), &root)
}
fn answer_owned_question(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    request: QuestionAnswerRequest,
) -> Result<AgentQuestionRequest, String> {
    ensure_request_id_bounds(&request.request_id)?;
    let root = registered_workspace_root(workspaces, &request.task_id, &request.workspace_id)?;
    tasks.answer_question(
        &request.task_id,
        request.workspace_id.as_str(),
        &root,
        &request.request_id,
        request.response,
    )
}
fn answer_owned_approval(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    request: ApprovalAnswerRequest,
) -> Result<AgentApprovalRequest, String> {
    ensure_request_id_bounds(&request.request_id)?;
    let root = registered_workspace_root(workspaces, &request.task_id, &request.workspace_id)?;
    tasks.answer_approval(
        &request.task_id,
        request.workspace_id.as_str(),
        &root,
        &request.request_id,
        request.decision,
    )
}
#[tauri::command]
pub(crate) async fn get_agent_interactions(
    app: AppHandle,
    request: InteractionOwner,
) -> Result<AgentInteractionSnapshot, String> {
    run_blocking_command(move || {
        owned_interactions(
            &app.state::<WorkspaceRegistry>(),
            &app.state::<AgentTaskRegistry>(),
            &request,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn answer_agent_question(
    app: AppHandle,
    request: QuestionAnswerRequest,
) -> Result<AgentQuestionRequest, String> {
    run_blocking_command(move || {
        answer_owned_question(
            &app.state::<WorkspaceRegistry>(),
            &app.state::<AgentTaskRegistry>(),
            request,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn answer_agent_approval(
    app: AppHandle,
    request: ApprovalAnswerRequest,
) -> Result<AgentApprovalRequest, String> {
    run_blocking_command(move || {
        answer_owned_approval(
            &app.state::<WorkspaceRegistry>(),
            &app.state::<AgentTaskRegistry>(),
            request,
        )
    })
    .await
}
#[cfg(all(test, unix))]
#[path = "agent_question_commands_tests.rs"]
mod tests;
