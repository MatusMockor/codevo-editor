use super::*;
use crate::agent_questions::approvals::{AgentApprovalDecision, AgentApprovalRequest};
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse};
use crate::agent_runtime_requests::journal::RuntimeRequestJournal;
use crate::agent_runtime_requests::model::RequestResolution;
use crate::agent_task_supervisor::questions::AnsweringTask;
use agent_answer_journal::JournaledAnswer;
#[path = "agent_answer_journal.rs"]
mod agent_answer_journal;
const MAX_AGENT_INTERACTION_REQUEST_ID_BYTES: usize = 128;
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
fn answer_owned_question(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    journal: &RuntimeRequestJournal,
    request: QuestionAnswerRequest,
) -> Result<AgentQuestionRequest, String> {
    ensure_request_id_bounds(&request.request_id)?;
    let root = registered_workspace_root(workspaces, &request.task_id, &request.workspace_id)?;
    let task = tasks.question_task(&request.task_id, request.workspace_id.as_str(), &root)?;
    deliver_question_answer(tasks, journal, &task, request)
}
fn deliver_question_answer(
    tasks: &AgentTaskRegistry,
    journal: &RuntimeRequestJournal,
    task: &AnsweringTask,
    request: QuestionAnswerRequest,
) -> Result<AgentQuestionRequest, String> {
    let journaled = JournaledAnswer::begin(
        journal,
        tasks,
        task,
        &request.request_id,
        RequestResolution::Answers {
            answers: request.response.answers.clone(),
        },
    );
    let answered = tasks.answer_captured_question(task, &request.request_id, request.response);
    journaled.finish(&answered);
    answered
}
fn answer_owned_approval(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    journal: &RuntimeRequestJournal,
    request: ApprovalAnswerRequest,
) -> Result<AgentApprovalRequest, String> {
    ensure_request_id_bounds(&request.request_id)?;
    let root = registered_workspace_root(workspaces, &request.task_id, &request.workspace_id)?;
    let task = tasks.approval_task(&request.task_id, request.workspace_id.as_str(), &root)?;
    deliver_approval_answer(tasks, journal, &task, request)
}
fn deliver_approval_answer(
    tasks: &AgentTaskRegistry,
    journal: &RuntimeRequestJournal,
    task: &AnsweringTask,
    request: ApprovalAnswerRequest,
) -> Result<AgentApprovalRequest, String> {
    let journaled = JournaledAnswer::begin(
        journal,
        tasks,
        task,
        &request.request_id,
        RequestResolution::Decision {
            decision: request.decision,
        },
    );
    let answered = tasks.answer_captured_approval(task, &request.request_id, request.decision);
    journaled.finish(&answered);
    answered
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
            &app.state::<Arc<RuntimeRequestJournal>>(),
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
            &app.state::<Arc<RuntimeRequestJournal>>(),
            request,
        )
    })
    .await
}
#[cfg(all(test, unix))]
#[path = "agent_question_commands_tests.rs"]
mod tests;
