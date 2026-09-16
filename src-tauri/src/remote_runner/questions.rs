//! Exact-connection question transport; provider protocol identifiers remain on the runner.
use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use crate::agent_questions::{
    validate_request, validate_response, AgentQuestionRequest, AgentQuestionResponse,
    AgentQuestionStatus,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteQuestionsRequest {
    server_id: String,
    runner_id: String,
    task_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteQuestionAnswerRequest {
    server_id: String,
    runner_id: String,
    task_id: String,
    request_id: String,
    response: AgentQuestionResponse,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionList {
    items: Vec<AgentQuestionRequest>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnswerResult {
    request: AgentQuestionRequest,
}

fn path(task: &str) -> Result<String, String> {
    uuid(task)?;
    Ok(format!("/v1/tasks/{task}/questions"))
}
fn validate_item(item: &AgentQuestionRequest, task: &str) -> Result<(), String> {
    validate_request(item)?;
    if item.task_id != task {
        return Err("Question belongs to another task".into());
    }
    match (&item.status, &item.answers) {
        (AgentQuestionStatus::Answered, Some(answers)) => validate_response(
            item,
            &AgentQuestionResponse {
                answers: answers.clone(),
            },
        )?,
        (AgentQuestionStatus::Answered, None) | (_, Some(_)) => {
            return Err("Invalid question answer state".into())
        }
        _ => {}
    }
    Ok(())
}
fn parse_list(value: Value, task: &str) -> Result<Vec<AgentQuestionRequest>, String> {
    if serde_json::to_vec(&value)
        .map_err(|_| "Invalid questions")?
        .len()
        > 3 * 1024 * 1024
    {
        return Err("Questions exceed size limit".into());
    }
    if let Some(items) = value.get("items").and_then(Value::as_array) {
        for item in items {
            if item.get("status").and_then(Value::as_str) != Some("answered")
                && item.get("answers").is_some()
            {
                return Err("Unexpected question answers".into());
            }
        }
    }
    let list: QuestionList =
        serde_json::from_value(value).map_err(|_| "Invalid runner questions")?;
    if list.items.len() > 32 {
        return Err("Too many runner questions".into());
    }
    let mut seen = std::collections::HashSet::new();
    for item in &list.items {
        validate_item(item, task)?;
        if !seen.insert(&item.id) {
            return Err("Duplicate runner question".into());
        }
    }
    Ok(list.items)
}
fn with_connection<T>(
    state: &RemoteRunnerState,
    server: &str,
    runner: &str,
    operation: impl FnOnce(
        &dyn Fn(&str, &str, Option<Value>) -> Result<Value, String>,
    ) -> Result<T, String>,
) -> Result<T, String> {
    id(server)?;
    if runner.is_empty() || runner.len() > 128 || runner.chars().any(char::is_control) {
        return Err("Invalid question runner identity".into());
    }
    let lease = state.connection_lease(server)?;
    if lease.server().runner_id.as_deref() != Some(runner) {
        return Err("Question runner identity changed".into());
    }
    let session = lease.session()?;
    let call = |method: &str, path: &str, body: Option<Value>| {
        if !lease.is_current() {
            return Err("Question connection changed".into());
        }
        let result = session.request(lease.server(), method, path, body, vec![])?;
        if !lease.is_current() {
            return Err("Question connection changed".into());
        }
        Ok(result)
    };
    operation(&call)
}
#[tauri::command]
pub async fn list_remote_agent_questions(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RemoteQuestionsRequest,
) -> Result<Vec<AgentQuestionRequest>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let path = path(&request.task_id)?;
        with_connection(&state, &request.server_id, &request.runner_id, |call| {
            parse_list(call("GET", &path, None)?, &request.task_id)
        })
    })
    .await
}
#[tauri::command]
pub async fn answer_remote_agent_question(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RemoteQuestionAnswerRequest,
) -> Result<AgentQuestionRequest, String> {
    let state = state.inner().clone();
    blocking(move || {
        uuid(&request.request_id)?;
        if serde_json::to_vec(&request.response)
            .map_err(|_| "Invalid question response")?
            .len()
            > 256 * 1024
        {
            return Err("Question response exceeds size limit".into());
        }
        let path = path(&request.task_id)?;
        with_connection(&state, &request.server_id, &request.runner_id, |call| {
            let items = parse_list(call("GET", &path, None)?, &request.task_id)?;
            let question = items
                .iter()
                .find(|item| item.id == request.request_id)
                .ok_or("Question is no longer available")?;
            validate_response(question, &request.response)?;
            let body =
                serde_json::to_value(&request.response).map_err(|_| "Invalid question response")?;
            let value = call(
                "POST",
                &format!("{path}/{}/answer", request.request_id),
                Some(body),
            )?;
            let result: AnswerResult =
                serde_json::from_value(value).map_err(|_| "Invalid runner answer response")?;
            validate_item(&result.request, &request.task_id)?;
            if result.request.id != request.request_id
                || result.request.provider != question.provider
                || result.request.questions != question.questions
            {
                return Err("Runner answered a different question".into());
            }
            if result.request.status != AgentQuestionStatus::Answered
                || result.request.answers.as_ref() != Some(&request.response.answers)
            {
                return Err("Runner did not confirm this answer".into());
            }
            Ok(result.request)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const ID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
    fn question() -> Value {
        json!({"id":ID,"taskId":ID,"provider":"codex","status":"pending","questions":[{"id":"q1","header":"Choice","prompt":"Pick","options":[{"id":"a","label":"A","description":""}],"multiple":false,"allowCustom":true}]})
    }
    #[test]
    fn question_paths_are_scoped_and_requests_are_closed() {
        assert_eq!(path(ID).unwrap(), format!("/v1/tasks/{ID}/questions"));
        for bad in ["", "../task", "x?y", "task/path"] {
            assert!(path(bad).is_err());
        }
        assert!(serde_json::from_value::<RemoteQuestionsRequest>(
            json!({"serverId":"linux","runnerId":"r","taskId":ID})
        )
        .is_ok());
        assert!(serde_json::from_value::<RemoteQuestionsRequest>(
            json!({"serverId":"linux","runnerId":"r","taskId":ID,"host":"foreign"})
        )
        .is_err());
    }
    #[test]
    fn list_rejects_foreign_duplicates_unbounded_and_bad_answers() {
        assert!(parse_list(json!({"items":[question()]}), ID).is_ok());
        assert!(parse_list(json!({"items":[question()]}), "foreign").is_err());
        assert!(parse_list(json!({"items":[question(),question()]}), ID).is_err());
        assert!(parse_list(json!({"items":vec![question();65]}), ID).is_err());
        assert!(parse_list(json!({"items":[],"token":"x"}), ID).is_err());
        let mut q = question();
        q["answers"] = json!([]);
        assert!(parse_list(json!({"items":[q]}), ID).is_err());
        let mut q = question();
        q["status"] = json!("answered");
        assert!(parse_list(json!({"items":[q]}), ID).is_err());
    }
}
