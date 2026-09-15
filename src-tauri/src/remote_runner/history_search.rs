use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const INVALID_RESPONSE: &str = "Invalid runner history search response";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySearchRequest {
    pub server_id: String,
    pub query: String,
    #[serde(default, deserialize_with = "present_option")]
    pub after: Option<u64>,
    #[serde(default, deserialize_with = "present_option")]
    pub project_id: Option<String>,
}

fn present_option<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySearchPage {
    items: Vec<HistorySearchMatch>,
    next_cursor: Value,
    scope: SearchScope,
    incomplete: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistorySearchMatch {
    task_id: String,
    conversation_id: String,
    project_id: Value,
    task_sequence: u64,
    role: SearchRole,
    event_sequence: Value,
    snippet: String,
}

#[derive(Deserialize, Serialize)]
enum SearchScope {
    #[serde(rename = "retained_runner_history")]
    RetainedRunnerHistory,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum SearchRole {
    User,
    Assistant,
}

fn bounded_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 128
        && !value.chars().any(|ch| ch <= '\u{1f}')
}

fn search_path(request: &HistorySearchRequest) -> Result<String, String> {
    id(&request.server_id)?;
    if request.query.trim().encode_utf16().count() < 2
        || request.query.encode_utf16().count() > 256
        || request.query.len() > 1024
        || request.query.chars().any(|ch| ch <= '\u{1f}')
        || request.after.is_some_and(|value| value > MAX_SAFE_INTEGER)
        || request
            .project_id
            .as_ref()
            .is_some_and(|value| !bounded_identifier(value))
    {
        return Err("Invalid runner history search request".into());
    }
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("q", request.query.trim());
    query.append_pair("after", &request.after.unwrap_or(0).to_string());
    if let Some(project_id) = &request.project_id {
        query.append_pair("projectId", project_id);
    }
    Ok(format!("/v1/history/search?{}", query.finish()))
}

fn positive_sequence(value: u64) -> bool {
    value > 0 && value <= MAX_SAFE_INTEGER
}

fn nullable_sequence(value: &Value) -> bool {
    value.is_null() || value.as_u64().is_some_and(positive_sequence)
}

fn validate_page(
    value: Value,
    request: &HistorySearchRequest,
) -> Result<HistorySearchPage, String> {
    let page: HistorySearchPage = serde_json::from_value(value).map_err(|_| INVALID_RESPONSE)?;
    if page.items.len() > 20 || !nullable_sequence(&page.next_cursor) {
        return Err(INVALID_RESPONSE.into());
    }
    let after = request.after.unwrap_or(0);
    if page
        .next_cursor
        .as_u64()
        .is_some_and(|cursor| cursor <= after)
    {
        return Err(INVALID_RESPONSE.into());
    }
    let mut previous = after;
    let mut matches = std::collections::HashSet::new();
    for item in &page.items {
        let project = item.project_id.as_str();
        if uuid(&item.task_id).is_err()
            || uuid(&item.conversation_id).is_err()
            || !(item.project_id.is_null() || project.is_some_and(bounded_identifier))
            || request
                .project_id
                .as_deref()
                .is_some_and(|expected| project != Some(expected))
            || !positive_sequence(item.task_sequence)
            || item.task_sequence <= after
            || item.task_sequence < previous
            || page
                .next_cursor
                .as_u64()
                .is_some_and(|cursor| item.task_sequence > cursor)
            || !nullable_sequence(&item.event_sequence)
            || !matches!(
                (&item.role, &item.event_sequence),
                (SearchRole::User, Value::Null) | (SearchRole::Assistant, Value::Number(_))
            )
            || item.snippet.chars().count() > 382
            || item.snippet.contains('\0')
            || !matches.insert((&item.task_id, matches!(item.role, SearchRole::Assistant)))
        {
            return Err(INVALID_RESPONSE.into());
        }
        previous = item.task_sequence;
    }
    Ok(page)
}

#[tauri::command]
pub async fn remote_runner_search_history(
    state: tauri::State<'_, RemoteRunnerState>,
    request: HistorySearchRequest,
) -> Result<HistorySearchPage, String> {
    let path = search_path(&request)?;
    let state = state.inner().clone();
    blocking(move || {
        let value = state.call(&request.server_id, "GET", &path, None, vec![])?;
        validate_page(value, &request)
    })
    .await
}

#[cfg(test)]
#[path = "history_search_tests.rs"]
mod tests;
