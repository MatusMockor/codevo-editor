use super::{
    commands::blocking,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use serde::Deserialize;
use serde_json::{json, Value};

pub struct SurfaceRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    task_id: Option<String>,
    operation: SurfaceOperation,
}
impl<'de> Deserialize<'de> for SurfaceRequest {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = Value::deserialize(deserializer)?;
        let map = value
            .as_object_mut()
            .ok_or_else(|| serde::de::Error::custom("Expected surface request"))?;
        let server_id = serde_json::from_value(map.remove("serverId").unwrap_or(Value::Null))
            .map_err(serde::de::Error::custom)?;
        let runner_id = serde_json::from_value(map.remove("runnerId").unwrap_or(Value::Null))
            .map_err(serde::de::Error::custom)?;
        let project_id = serde_json::from_value(map.remove("projectId").unwrap_or(Value::Null))
            .map_err(serde::de::Error::custom)?;
        let task_id = serde_json::from_value(map.remove("taskId").unwrap_or(Value::Null))
            .map_err(serde::de::Error::custom)?;
        let operation = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        Ok(Self {
            server_id,
            runner_id,
            project_id,
            task_id,
            operation,
        })
    }
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
enum SurfaceOperation {
    Capabilities {},
    ListDirectory {
        path: String,
        offset: u64,
    },
    ReadFile {
        path: String,
    },
    WriteFile {
        path: String,
        text: String,
        #[serde(rename = "expectedVersion")]
        expected_version: String,
    },
    History {
        offset: u64,
    },
    CommitFiles {
        commit: String,
    },
    CommitDiff {
        commit: String,
        path: String,
    },
    OpenTerminal {
        cols: u16,
        rows: u16,
    },
    PollTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        after: u64,
    },
    WriteTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        data: String,
    },
    ResizeTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    CloseTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
}
fn relative(path: &str, root: bool) -> Result<(), String> {
    if (root && path.is_empty())
        || (!path.is_empty()
            && path.len() <= 4096
            && !path.bytes().any(|b| b < 32 || matches!(b, b'\\' | b':'))
            && path.split('/').all(|p| {
                !p.is_empty() && !matches!(p, "." | "..") && !p.eq_ignore_ascii_case(".git")
            }))
    {
        Ok(())
    } else {
        Err("Invalid relative surface path".into())
    }
}
fn hash(value: &str) -> Result<(), String> {
    if matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("Invalid surface revision".into())
    }
}
fn dimensions(cols: u16, rows: u16) -> Result<(), String> {
    if (2..=500).contains(&cols) && (1..=300).contains(&rows) {
        Ok(())
    } else {
        Err("Invalid terminal dimensions".into())
    }
}
impl SurfaceRequest {
    fn plan(&self) -> Result<(&'static str, String, Option<Value>), String> {
        id(&self.server_id)?;
        uuid(&self.runner_id)?;
        if self.project_id.is_empty()
            || self.project_id.len() > 64
            || !self
                .project_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err("Invalid surface project".into());
        }
        if let Some(task) = &self.task_id {
            uuid(task)?;
        }
        let task_query = self
            .task_id
            .as_ref()
            .map(|task| format!("?taskId={task}"))
            .unwrap_or_default();
        let task_after = task_query.replace('?', "&");
        let base = format!("/v1/projects/{}", self.project_id);
        let mut body = json!({});
        if let Some(task) = &self.task_id {
            body["taskId"] = task.clone().into();
        }
        let route = match &self.operation {
            SurfaceOperation::Capabilities {} => {
                return Ok(("GET", format!("{base}/surface/capabilities"), None))
            }
            SurfaceOperation::ListDirectory { path, offset } => {
                relative(path, true)?;
                body["path"] = path.clone().into();
                body["offset"] = (*offset).into();
                "tree"
            }
            SurfaceOperation::ReadFile { path } => {
                relative(path, false)?;
                body["path"] = path.clone().into();
                "read"
            }
            SurfaceOperation::WriteFile {
                path,
                text,
                expected_version,
            } => {
                relative(path, false)?;
                hash(expected_version)?;
                if text.len() > 65536 || text.contains('\0') {
                    return Err("Surface file exceeds limit".into());
                }
                body["path"] = path.clone().into();
                body["text"] = text.clone().into();
                body["expectedVersion"] = expected_version.clone().into();
                "write"
            }
            SurfaceOperation::History { offset } => {
                body["offset"] = (*offset).into();
                "history"
            }
            SurfaceOperation::CommitFiles { commit } => {
                hash(commit)?;
                body["commit"] = commit.clone().into();
                "commit-files"
            }
            SurfaceOperation::CommitDiff { commit, path } => {
                hash(commit)?;
                relative(path, false)?;
                body["commit"] = commit.clone().into();
                body["path"] = path.clone().into();
                "commit-diff"
            }
            SurfaceOperation::OpenTerminal { cols, rows } => {
                dimensions(*cols, *rows)?;
                body["cols"] = (*cols).into();
                body["rows"] = (*rows).into();
                return Ok(("POST", format!("{base}/terminals"), Some(body)));
            }
            SurfaceOperation::PollTerminal { terminal_id, after } => {
                uuid(terminal_id)?;
                return Ok((
                    "GET",
                    format!("{base}/terminals/{terminal_id}?after={after}{task_after}"),
                    None,
                ));
            }
            SurfaceOperation::WriteTerminal { terminal_id, data } => {
                uuid(terminal_id)?;
                if data.len() > 65536 {
                    return Err("Terminal input exceeds limit".into());
                }
                return Ok((
                    "POST",
                    format!("{base}/terminals/{terminal_id}/input{task_query}"),
                    Some(json!({"data":data})),
                ));
            }
            SurfaceOperation::ResizeTerminal {
                terminal_id,
                cols,
                rows,
            } => {
                uuid(terminal_id)?;
                dimensions(*cols, *rows)?;
                return Ok((
                    "POST",
                    format!("{base}/terminals/{terminal_id}/resize{task_query}"),
                    Some(json!({"cols":cols,"rows":rows})),
                ));
            }
            SurfaceOperation::CloseTerminal { terminal_id } => {
                uuid(terminal_id)?;
                return Ok((
                    "DELETE",
                    format!("{base}/terminals/{terminal_id}{task_query}"),
                    None,
                ));
            }
        };
        Ok(("POST", format!("{base}/surface/{route}"), Some(body)))
    }
}
#[tauri::command]
pub async fn remote_runner_surface(
    state: tauri::State<'_, RemoteRunnerState>,
    request: SurfaceRequest,
) -> Result<Value, String> {
    let (method, path, body) = request.plan()?;
    // Capture the exact generation before scheduling work, never reacquire by server ID.
    let lease = state.connection_lease(&request.server_id)?;
    if lease.runner_id() != request.runner_id {
        return Err("Runner identity changed".into());
    }
    blocking(move || {
        let session = lease.session()?;
        if !lease.is_current() {
            return Err("Runner connection was superseded".into());
        }
        let result = session.request(lease.server(), method, &path, body, vec![])?;
        if !lease.is_current() {
            return Err("Runner connection was superseded".into());
        }
        Ok(result)
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    fn wire() -> Value {
        json!({"serverId":"linux","runnerId":"7389088c-29b8-4cec-9a15-e825e1fb2f66","projectId":"editor","operation":"readFile","path":"src/index.ts"})
    }
    #[test]
    fn closed_wire_and_relative_paths() {
        let mut capabilities = wire();
        capabilities["operation"] = json!("capabilities");
        assert!(serde_json::from_value::<SurfaceRequest>(capabilities).is_err());
        let good = wire();
        let parsed: SurfaceRequest = serde_json::from_value(good.clone()).unwrap();
        assert_eq!(parsed.plan().unwrap().1, "/v1/projects/editor/surface/read");
        for field in ["command", "host", "cwd", "offset"] {
            let mut bad = good.clone();
            bad[field] = json!("foreign");
            assert!(
                serde_json::from_value::<SurfaceRequest>(bad).is_err(),
                "{field}"
            );
        }
        for path in ["/etc/passwd", "../other", ".git/config", "a\\b", "C:/x"] {
            let mut bad = good.clone();
            bad["path"] = json!(path);
            assert!(serde_json::from_value::<SurfaceRequest>(bad)
                .unwrap()
                .plan()
                .is_err());
        }
    }

    #[test]
    fn terminal_task_authority_is_present_on_every_operation() {
        for operation in [
            "pollTerminal",
            "writeTerminal",
            "resizeTerminal",
            "closeTerminal",
        ] {
            let mut value = wire();
            value.as_object_mut().unwrap().remove("path");
            value["operation"] = json!(operation);
            value["terminalId"] = json!("7389088c-29b8-4cec-9a15-e825e1fb2f66");
            value["taskId"] = json!("7389088c-29b8-4cec-9a15-e825e1fb2f66");
            match operation {
                "pollTerminal" => value["after"] = json!(0),
                "writeTerminal" => value["data"] = json!("ls\r"),
                "resizeTerminal" => {
                    value["cols"] = json!(80);
                    value["rows"] = json!(24);
                }
                _ => {}
            }
            let request: SurfaceRequest = serde_json::from_value(value).unwrap();
            assert!(request
                .plan()
                .unwrap()
                .1
                .contains("taskId=7389088c-29b8-4cec-9a15-e825e1fb2f66"));
        }
    }
    #[test]
    fn draft_terminal_urls_have_no_empty_query_and_nul_input_is_valid() {
        for (op, suffix) in [
            ("pollTerminal", "?after=0"),
            ("writeTerminal", "/input"),
            ("resizeTerminal", "/resize"),
            ("closeTerminal", ""),
        ] {
            let mut value = wire();
            value.as_object_mut().unwrap().remove("path");
            value["operation"] = json!(op);
            value["terminalId"] = json!("7389088c-29b8-4cec-9a15-e825e1fb2f66");
            match op {
                "pollTerminal" => value["after"] = json!(0),
                "writeTerminal" => value["data"] = json!("\0"),
                "resizeTerminal" => {
                    value["cols"] = json!(80);
                    value["rows"] = json!(24);
                }
                _ => {}
            }
            let request: SurfaceRequest = serde_json::from_value(value.clone()).unwrap();
            let expected = format!(
                "/v1/projects/editor/terminals/7389088c-29b8-4cec-9a15-e825e1fb2f66{suffix}"
            );
            assert_eq!(request.plan().unwrap().1, expected);
            value["taskId"] = json!("7389088c-29b8-4cec-9a15-e825e1fb2f66");
            let request: SurfaceRequest = serde_json::from_value(value).unwrap();
            assert_eq!(
                request.plan().unwrap().1,
                format!(
                    "{expected}{}taskId=7389088c-29b8-4cec-9a15-e825e1fb2f66",
                    if op == "pollTerminal" { "&" } else { "?" }
                )
            );
        }
    }
}
