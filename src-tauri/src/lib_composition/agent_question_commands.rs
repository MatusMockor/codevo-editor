use super::*;
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionOwner {
    task_id: String,
    workspace_id: WorkspaceId,
    repository_root: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionAnswerRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    repository_root: String,
    request_id: String,
    response: AgentQuestionResponse,
}
fn validate_owner(
    workspaces: &WorkspaceRegistry,
    owner: &QuestionOwner,
) -> Result<std::path::PathBuf, String> {
    safe_agent_task_id(&owner.task_id)?;
    ensure_workspace_id_bounds(&owner.workspace_id)?;
    if owner.repository_root.len() > MAX_AGENT_TASK_PATH_BYTES
        || owner.repository_root.contains('\0')
    {
        return Err("Invalid question workspace.".into());
    }
    let descriptor = workspaces
        .descriptor(&owner.workspace_id)
        .map_err(|error| error.to_string())?;
    if descriptor.canonical_root_path != std::path::Path::new(&owner.repository_root) {
        return Err("Question workspace changed.".into());
    }
    revalidate_agent_steer_workspace(workspaces, &descriptor)
        .map_err(|_| "Question workspace changed.".to_string())?;
    Ok(descriptor.canonical_root_path)
}
fn list_owned_questions(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    owner: &QuestionOwner,
) -> Result<Vec<AgentQuestionRequest>, String> {
    let root = validate_owner(workspaces, owner)?;
    tasks.list_questions(&owner.task_id, owner.workspace_id.as_str(), &root)
}
fn list_owned_approvals(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    owner: &QuestionOwner,
) -> Result<Vec<crate::agent_questions::approvals::AgentApprovalRequest>, String> {
    let root = validate_owner(workspaces, owner)?;
    tasks.list_approvals(&owner.task_id, owner.workspace_id.as_str(), &root)
}
#[tauri::command]
pub(crate) async fn list_agent_questions(
    app: AppHandle,
    request: QuestionOwner,
) -> Result<Vec<AgentQuestionRequest>, String> {
    run_blocking_command(move || {
        list_owned_questions(
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
        let owner = QuestionOwner {
            task_id: request.task_id,
            workspace_id: request.workspace_id,
            repository_root: request.repository_root,
        };
        let root = validate_owner(&app.state::<WorkspaceRegistry>(), &owner)?;
        app.state::<AgentTaskRegistry>().answer_question(
            &owner.task_id,
            owner.workspace_id.as_str(),
            &root,
            &request.request_id,
            request.response,
        )
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApprovalAnswerRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    repository_root: String,
    request_id: String,
    decision: crate::agent_questions::approvals::AgentApprovalDecision,
}
#[tauri::command]
pub(crate) async fn list_agent_approvals(
    app: AppHandle,
    request: QuestionOwner,
) -> Result<Vec<crate::agent_questions::approvals::AgentApprovalRequest>, String> {
    run_blocking_command(move || {
        list_owned_approvals(
            &app.state::<WorkspaceRegistry>(),
            &app.state::<AgentTaskRegistry>(),
            &request,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn answer_agent_approval(
    app: AppHandle,
    request: ApprovalAnswerRequest,
) -> Result<crate::agent_questions::approvals::AgentApprovalRequest, String> {
    run_blocking_command(move || {
        if request.request_id.len() > 128 {
            return Err("Invalid approval.".into());
        }
        let owner = QuestionOwner {
            task_id: request.task_id,
            workspace_id: request.workspace_id,
            repository_root: request.repository_root,
        };
        let root = validate_owner(&app.state::<WorkspaceRegistry>(), &owner)?;
        app.state::<AgentTaskRegistry>().answer_approval(
            &owner.task_id,
            owner.workspace_id.as_str(),
            &root,
            &request.request_id,
            request.decision,
        )
    })
    .await
}
#[cfg(all(test, unix))]
#[path = "agent_question_commands_tests.rs"]
mod tests;
