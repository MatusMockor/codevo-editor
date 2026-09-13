use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid, TaskRequest},
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileDiffRequest {
    pub server_id: String,
    pub task_id: String,
    pub path: String,
}

fn file_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 4096
        || path.bytes().any(|byte| byte < 32 || byte == b'\\')
        || (path.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
            && path.as_bytes().get(1) == Some(&b':'))
        || path.split('/').any(|part| {
            part.is_empty() || matches!(part, "." | "..") || part.eq_ignore_ascii_case(".git")
        })
    {
        return Err("Invalid task file path".into());
    }
    Ok(())
}

fn task_path(server_id: &str, task_id: &str, suffix: &str) -> Result<String, String> {
    id(server_id)?;
    uuid(task_id)?;
    Ok(format!("/v1/tasks/{task_id}/{suffix}"))
}

#[tauri::command]
pub async fn remote_runner_list_task_files(
    state: tauri::State<'_, RemoteRunnerState>,
    request: TaskRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        state.call(
            &request.server_id,
            "GET",
            &task_path(&request.server_id, &request.task_id, "files")?,
            None,
            vec![],
        )
    })
    .await
}

#[tauri::command]
pub async fn remote_runner_get_task_file_diff(
    state: tauri::State<'_, RemoteRunnerState>,
    request: FileDiffRequest,
) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        file_path(&request.path)?;
        state.call(
            &request.server_id,
            "POST",
            &task_path(&request.server_id, &request.task_id, "file-diff")?,
            Some(json!({"path":request.path})),
            vec![],
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_are_bounded_relative_repository_files() {
        for path in ["src/index.ts", "screenshots/new image.png", "é.rs"] {
            assert!(file_path(path).is_ok());
        }
        for path in [
            "",
            "/etc/passwd",
            "../file",
            "src/../file",
            "./file",
            "src//file",
            "src/.GiT/config",
            "C:/file",
            "src\\file",
            "src\nfile",
            "src\0file",
        ] {
            assert!(file_path(path).is_err(), "{path:?}");
        }
        assert!(file_path(&"é".repeat(2048)).is_ok());
        assert!(file_path(&"é".repeat(2049)).is_err());
    }
    #[test]
    fn wire_rejects_authority_and_endpoint_injection() {
        let value = json!({"serverId":"linux","taskId":"7389088c-29b8-4cec-9a15-e825e1fb2f66","path":"src/index.ts"});
        let request: FileDiffRequest = serde_json::from_value(value.clone()).unwrap();
        assert!(task_path(&request.server_id, &request.task_id, "file-diff").is_ok());
        for key in ["host", "command", "cwd", "headers", "original"] {
            let mut invalid = value.clone();
            invalid[key] = "foreign".into();
            assert!(serde_json::from_value::<FileDiffRequest>(invalid).is_err());
        }
        assert!(task_path("linux", "../other", "files").is_err());
    }
}
