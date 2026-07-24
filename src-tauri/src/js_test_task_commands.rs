use super::{JsTestTaskRegistry, TaskReservation};
use crate::{
    js_test_run::{self, task_runner::JsTestTaskOutput, JsTestRunScope, JsTestTaskRunOutcome},
    php_test_run::PhpTestRunResponse,
    trust::WorkspaceTrustService,
    workspace_registry::{opened_root_path, WorkspaceId, WorkspaceRegistry},
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RunJsTestTaskRequest {
    run_id: String,
    workspace_id: WorkspaceId,
    scope: JsTestRunScope,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopJsTestTaskRequest {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunJsTestTaskResponse {
    owner: JsTestTaskOwner,
    response: JsTestTaskResponse,
    output: JsTestTaskOutput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsTestTaskOwner {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopJsTestTaskResponse {
    run_id: String,
    stopped: bool,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum JsTestTaskResponse {
    Test(PhpTestRunResponse),
    Cancelled(CancelledJsTestTaskResponse),
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum CancelledJsTestTaskResponse {
    Cancelled,
}

#[tauri::command]
pub(crate) async fn run_js_test_task_json(
    request: RunJsTestTaskRequest,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<RunJsTestTaskResponse, String> {
    let run_id = request.run_id;
    let workspace_id = request.workspace_id;
    let tasks = app.state::<JsTestTaskRegistry>();
    if tasks.reserve(&run_id, &workspace_id)? == TaskReservation::Cancelled {
        return Ok(cancelled_response(run_id, workspace_id));
    }

    let setup = (|| {
        let app_data_base = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let root = registry
            .clone_root(&workspace_id)
            .map_err(|_| workspace_unavailable())?;
        let root_path = opened_root_path(&root).map_err(|error| {
            format!("Registered JavaScript test workspace is unavailable: {error}")
        })?;
        let root_text = root_path
            .to_str()
            .ok_or_else(|| "JavaScript test workspace path is not valid UTF-8.".to_string())?;
        let trusted = trust
            .lock()
            .map_err(|error| error.to_string())?
            .get(root_text)
            .trusted;
        Ok::<_, String>((app_data_base, root, trusted))
    })();
    let (app_data_base, root, trusted) = match setup {
        Ok(value) => value,
        Err(message) => {
            tasks.abort(&run_id, &workspace_id);
            return Err(message);
        }
    };
    if !trusted {
        tasks.abort(&run_id, &workspace_id);
        return Ok(RunJsTestTaskResponse {
            owner: JsTestTaskOwner {
                run_id,
                workspace_id,
            },
            response: JsTestTaskResponse::Test(PhpTestRunResponse::Unavailable {
                message: "Trust this workspace to run JavaScript tests.".to_string(),
            }),
            output: JsTestTaskOutput::default(),
        });
    }

    let worker_app = app.clone();
    let worker_run_id = run_id.clone();
    let worker_workspace_id = workspace_id.clone();
    let outcome = crate::run_blocking_command(move || {
        let activation_app = worker_app.clone();
        let activation_run_id = worker_run_id.clone();
        let activation_workspace_id = worker_workspace_id.clone();
        let outcome = js_test_run::run_js_test_task_registered(
            root,
            app_data_base,
            request.scope,
            move |ownership| {
                activation_app.state::<JsTestTaskRegistry>().activate(
                    &activation_run_id,
                    &activation_workspace_id,
                    ownership,
                )
            },
        );
        worker_app
            .state::<JsTestTaskRegistry>()
            .abort(&worker_run_id, &worker_workspace_id);
        Ok(outcome)
    })
    .await;
    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(message) => {
            tasks.abort(&run_id, &workspace_id);
            return Err(message);
        }
    };
    let owner = JsTestTaskOwner {
        run_id,
        workspace_id,
    };
    Ok(match outcome {
        JsTestTaskRunOutcome::Response { response, output } => RunJsTestTaskResponse {
            owner,
            response: JsTestTaskResponse::Test(response),
            output,
        },
        JsTestTaskRunOutcome::Cancelled { output } => RunJsTestTaskResponse {
            owner,
            response: JsTestTaskResponse::Cancelled(CancelledJsTestTaskResponse::Cancelled),
            output,
        },
    })
}

#[tauri::command]
pub(crate) fn stop_js_test_task(
    request: StopJsTestTaskRequest,
    tasks: State<'_, JsTestTaskRegistry>,
) -> Result<StopJsTestTaskResponse, String> {
    let stopped = tasks.request_stop(&request.run_id, &request.workspace_id)?;
    Ok(StopJsTestTaskResponse {
        run_id: request.run_id,
        stopped,
    })
}

fn cancelled_response(run_id: String, workspace_id: WorkspaceId) -> RunJsTestTaskResponse {
    RunJsTestTaskResponse {
        owner: JsTestTaskOwner {
            run_id,
            workspace_id,
        },
        response: JsTestTaskResponse::Cancelled(CancelledJsTestTaskResponse::Cancelled),
        output: JsTestTaskOutput::default(),
    }
}

fn workspace_unavailable() -> String {
    "JavaScript test workspace is not open or its identity changed.".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::php_test_run::PhpTestTotals;

    fn workspace(value: &str) -> WorkspaceId {
        serde_json::from_value(serde_json::json!(value)).unwrap()
    }

    fn envelope(response: JsTestTaskResponse) -> RunJsTestTaskResponse {
        RunJsTestTaskResponse {
            owner: JsTestTaskOwner {
                run_id: "run-1".to_string(),
                workspace_id: workspace("workspace-1"),
            },
            response,
            output: JsTestTaskOutput::default(),
        }
    }

    #[test]
    fn responses_have_the_exact_owner_bound_wire_shape() {
        assert_eq!(
            serde_json::to_value(cancelled_response(
                "run-1".to_string(),
                workspace("workspace-1"),
            ))
            .unwrap(),
            serde_json::json!({
                "owner": { "runId": "run-1", "workspaceId": "workspace-1" },
                "response": { "status": "cancelled" },
                "output": {
                    "stdout": { "text": "", "truncated": false },
                    "stderr": { "text": "", "truncated": false }
                }
            })
        );
        assert_eq!(
            serde_json::to_value(StopJsTestTaskResponse {
                run_id: "run-1".to_string(),
                stopped: true,
            })
            .unwrap(),
            serde_json::json!({ "runId": "run-1", "stopped": true })
        );
    }

    #[test]
    fn every_terminal_status_has_the_exact_output_envelope() {
        let expected_output = serde_json::json!({
            "stdout": { "text": "", "truncated": false },
            "stderr": { "text": "", "truncated": false }
        });
        for (response, expected) in [
            (
                JsTestTaskResponse::Test(PhpTestRunResponse::Ok {
                    suites: Vec::new(),
                    totals: PhpTestTotals::default(),
                }),
                serde_json::json!({
                    "status": "ok",
                    "suites": [],
                    "totals": {
                        "tests": 0, "failures": 0, "errors": 0, "skipped": 0, "time": null
                    }
                }),
            ),
            (
                JsTestTaskResponse::Test(PhpTestRunResponse::Error {
                    message: "failed".to_string(),
                }),
                serde_json::json!({ "status": "error", "message": "failed" }),
            ),
            (
                JsTestTaskResponse::Test(PhpTestRunResponse::Unavailable {
                    message: "missing".to_string(),
                }),
                serde_json::json!({ "status": "unavailable", "message": "missing" }),
            ),
            (
                JsTestTaskResponse::Cancelled(CancelledJsTestTaskResponse::Cancelled),
                serde_json::json!({ "status": "cancelled" }),
            ),
        ] {
            assert_eq!(
                serde_json::to_value(envelope(response)).unwrap(),
                serde_json::json!({
                    "owner": { "runId": "run-1", "workspaceId": "workspace-1" },
                    "response": expected,
                    "output": expected_output
                })
            );
        }
    }
}
