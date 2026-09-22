//! Bounded immutable turn-change reads on the exact admitted server connection.
use super::{
    commands::blocking,
    project_management::call_lease,
    service::RemoteRunnerState,
    types::{id, uuid, TaskRequest},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_FILES: usize = 500;
const MAX_TEXT: usize = 128 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const INVALID: &str = "Invalid runner turn changes";
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn file_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path
            .chars()
            .any(|c| c <= '\u{1f}' || c == '\u{7f}' || c == '\\' || c == ':')
        && path.split('/').count() <= 64
        && !path.split('/').any(|part| {
            part.is_empty() || matches!(part, "." | "..") || part.eq_ignore_ascii_case(".git")
        })
}
fn task_path(server: &str, task: &str, suffix: &str) -> Result<String, String> {
    id(server)?;
    uuid(task)?;
    Ok(format!("/v1/tasks/{task}/{suffix}"))
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChangedFile {
    relative_path: String,
    #[serde(deserialize_with = "nullable")]
    old_relative_path: Option<String>,
    status: ChangeStatus,
    #[serde(deserialize_with = "nullable")]
    added_lines: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    deleted_lines: Option<u64>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum SummaryState {
    Ready,
    Unavailable,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnChanges {
    turn_id: String,
    state: SummaryState,
    files: Vec<ChangedFile>,
    truncated: bool,
    #[serde(deserialize_with = "nullable")]
    reason: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TextContent {
    text: String,
    truncated: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum UnavailableReason {
    Binary,
    Large,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnFileDiff {
    relative_path: String,
    original: TextContent,
    modified: TextContent,
    #[serde(deserialize_with = "nullable")]
    unavailable_reason: Option<UnavailableReason>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnFileDiffRequest {
    server_id: String,
    task_id: String,
    relative_path: String,
}

fn parse_summary(value: Value, task: &str) -> Result<TurnChanges, String> {
    let result: TurnChanges = serde_json::from_value(value).map_err(|_| INVALID)?;
    uuid(&result.turn_id)?;
    if result.turn_id != task
        || result.files.len() > MAX_FILES
        || result
            .reason
            .as_ref()
            .is_some_and(|reason| reason.len() > 1024)
    {
        return Err(INVALID.into());
    }
    if matches!(result.state, SummaryState::Unavailable) && !result.files.is_empty() {
        return Err(INVALID.into());
    }
    let mut seen = std::collections::HashSet::new();
    for file in &result.files {
        if (file.added_lines.is_none() != file.deleted_lines.is_none())
            || !file_path(&file.relative_path)
            || !seen.insert(&file.relative_path)
            || file
                .old_relative_path
                .as_deref()
                .is_some_and(|p| !file_path(p))
            || [file.added_lines, file.deleted_lines]
                .into_iter()
                .flatten()
                .any(|v| v > MAX_SAFE_INTEGER)
        {
            return Err(INVALID.into());
        }
    }
    Ok(result)
}
fn parse_diff(value: Value, path: &str) -> Result<TurnFileDiff, String> {
    let result: TurnFileDiff = serde_json::from_value(value).map_err(|_| INVALID)?;
    if result.relative_path != path
        || !file_path(&result.relative_path)
        || result.original.text.len() > MAX_TEXT
        || result.modified.text.len() > MAX_TEXT
    {
        return Err(INVALID.into());
    }
    Ok(result)
}
#[tauri::command]
pub async fn remote_runner_get_turn_changes(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<TurnChanges, String> {
    let path = task_path(&request.server_id, &request.task_id, "turn-changes")?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || parse_summary(call_lease(lease, "GET", &path, None)?, &request.task_id)).await
}
#[tauri::command]
pub async fn remote_runner_get_turn_file_diff(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TurnFileDiffRequest,
) -> Result<TurnFileDiff, String> {
    let path = task_path(&request.server_id, &request.task_id, "turn-file-diff")?;
    if !file_path(&request.relative_path) {
        return Err("Invalid turn file path".into());
    }
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        parse_diff(
            call_lease(
                lease,
                "POST",
                &path,
                Some(json!({"relativePath":request.relative_path})),
            )?,
            &request.relative_path,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const TASK: &str = "00000000-0000-4000-8000-000000000001";
    fn summary() -> Value {
        json!({"turnId":TASK,"state":"ready","files":[{"relativePath":"src/a.ts","oldRelativePath":null,"status":"modified","addedLines":1,"deletedLines":0}],"truncated":false,"reason":null})
    }
    fn diff() -> Value {
        json!({"relativePath":"src/a.ts","original":{"text":"before","truncated":false},"modified":{"text":"after","truncated":false},"unavailableReason":null})
    }
    #[test]
    fn summary_requires_exact_owner_closed_fields_and_bounded_counts() {
        assert!(parse_summary(summary(), TASK).is_ok());
        assert!(parse_summary(summary(), "00000000-0000-4000-8000-000000000002").is_err());
        for key in summary().as_object().unwrap().keys() {
            let mut value = summary();
            value.as_object_mut().unwrap().remove(key);
            assert!(parse_summary(value, TASK).is_err(), "{key}");
        }
        for (key, value) in [
            ("status", json!("unknown")),
            ("addedLines", json!(-1)),
            ("deletedLines", json!(MAX_SAFE_INTEGER + 1)),
            ("extra", json!(true)),
        ] {
            let mut data = summary();
            data["files"][0][key] = value;
            assert!(parse_summary(data, TASK).is_err());
        }
        let mut data = summary();
        let file = data["files"][0].clone();
        data["files"] = json!([file.clone(), file]);
        assert!(parse_summary(data, TASK).is_err());
    }
    #[test]
    fn summary_unavailable_cannot_present_partial_changes_as_ready() {
        let mut value = summary();
        value["state"] = json!("unavailable");
        assert!(parse_summary(value.clone(), TASK).is_err());
        value["reason"] = json!("No checkpoint available");
        value["files"] = json!([]);
        assert!(parse_summary(value, TASK).is_ok());
    }
    #[test]
    fn summary_file_count_depth_and_paired_counts_are_bounded() {
        let mut value = summary();
        value["files"][0]["addedLines"] = Value::Null;
        assert!(parse_summary(value, TASK).is_err());
        let mut value = summary();
        let files: Vec<Value> = (0..=MAX_FILES)
            .map(|index| {
                let mut file = value["files"][0].clone();
                file["relativePath"] = json!(format!("src/{index}.ts"));
                file
            })
            .collect();
        value["files"] = json!(files);
        assert!(parse_summary(value, TASK).is_err());
        assert!(file_path(&vec!["a"; 64].join("/")));
        assert!(!file_path(&vec!["a"; 65].join("/")));
    }
    #[test]
    fn paths_fail_closed_before_network_request() {
        for path in [
            "",
            "/etc/passwd",
            "../a",
            "a/../b",
            "a//b",
            "C:/file",
            "a\\b",
            "a/.git/config",
            "a\n",
            "a\0",
        ] {
            assert!(!file_path(path), "{path:?}");
        }
        assert!(file_path("src/á file.ts"));
        assert!(!file_path(&"é".repeat(2049)));
        assert!(task_path("server", "../task", "turn-changes").is_err());
        assert!(serde_json::from_value::<TurnFileDiffRequest>(
            json!({"serverId":"server","taskId":TASK,"relativePath":"a","command":"bad"})
        )
        .is_err());
    }
    #[test]
    fn diff_rejects_foreign_path_extra_fields_and_oversized_utf8() {
        assert!(parse_diff(diff(), "src/a.ts").is_ok());
        assert!(parse_diff(diff(), "src/b.ts").is_err());
        let mut value = diff();
        value["original"]["text"] = json!("é".repeat(MAX_TEXT / 2 + 1));
        assert!(parse_diff(value, "src/a.ts").is_err());
        let mut value = diff();
        value["modified"]["extra"] = json!(true);
        assert!(parse_diff(value, "src/a.ts").is_err());
        let mut value = diff();
        value["unavailableReason"] = json!("other");
        assert!(parse_diff(value, "src/a.ts").is_err());
    }
}
