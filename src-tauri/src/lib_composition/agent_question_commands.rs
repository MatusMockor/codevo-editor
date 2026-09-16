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
fn validate_owner(app: &AppHandle, owner: &QuestionOwner) -> Result<std::path::PathBuf, String> {
    safe_agent_task_id(&owner.task_id)?;
    ensure_workspace_id_bounds(&owner.workspace_id)?;
    if owner.repository_root.len() > MAX_AGENT_TASK_PATH_BYTES
        || owner.repository_root.contains('\0')
    {
        return Err("Invalid question workspace.".into());
    }
    let descriptor = app
        .state::<WorkspaceRegistry>()
        .descriptor(&owner.workspace_id)
        .map_err(|error| error.to_string())?;
    if descriptor.canonical_root_path != std::path::Path::new(&owner.repository_root) {
        return Err("Question workspace changed.".into());
    }
    revalidate_agent_steer_workspace(&app.state::<WorkspaceRegistry>(), &descriptor)
        .map_err(|_| "Question workspace changed.".to_string())?;
    Ok(descriptor.canonical_root_path)
}
#[tauri::command]
pub(crate) async fn list_agent_questions(
    app: AppHandle,
    request: QuestionOwner,
) -> Result<Vec<AgentQuestionRequest>, String> {
    run_blocking_command(move || {
        let root = validate_owner(&app, &request)?;
        app.state::<AgentTaskRegistry>().list_questions(
            &request.task_id,
            request.workspace_id.as_str(),
            &root,
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
        let root = validate_owner(&app, &owner)?;
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
