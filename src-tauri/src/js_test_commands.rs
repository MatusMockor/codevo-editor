use crate::js_test_run::{
    self,
    batch::{
        execute_prepared_js_test_batch, prepare_registered_js_test_batch, JsTestBatchOutcome,
        JsTestBatchRegistry, JsTestBatchRequest,
    },
    JsTestRunScope,
};
use crate::php_test_run::PhpTestRunResponse;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use serde::{Deserialize, Serialize};
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) async fn run_js_tests_json(
    root_path: String,
    filter: Option<String>,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<PhpTestRunResponse, String> {
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    if !workspace_is_trusted(&root_path, &trust)? {
        return Ok(untrusted_response());
    }
    let root = registry
        .clone_root_for_path(Path::new(&root_path))
        .map_err(|_| {
            "JavaScript test workspace is not open or its identity changed.".to_string()
        })?;
    js_test_run::run_js_tests_registered(root, app_data_base, filter).await
}

#[cfg(test)]
pub(crate) async fn run_js_tests_json_with_trust(
    root_path: String,
    app_data_base: PathBuf,
    filter: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<PhpTestRunResponse, String> {
    if !workspace_is_trusted(&root_path, trust)? {
        return Ok(untrusted_response());
    }
    js_test_run::run_js_tests(root_path, app_data_base, filter).await
}

#[tauri::command]
pub(crate) async fn run_js_tests_scoped_json(
    root_path: String,
    package_root_relative_path: String,
    scope: JsTestRunScope,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<PhpTestRunResponse, String> {
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    if !workspace_is_trusted(&root_path, &trust)? {
        return Ok(untrusted_response());
    }
    let root = registry
        .clone_root_for_path(Path::new(&root_path))
        .map_err(|_| {
            "JavaScript test workspace is not open or its identity changed.".to_string()
        })?;
    js_test_run::run_js_tests_scoped_registered(
        root,
        app_data_base,
        package_root_relative_path,
        scope,
    )
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunJsTestBatchResponse {
    owner: JsTestBatchOwner,
    #[serde(flatten)]
    outcome: JsTestBatchOutcome,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsTestBatchOwner {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopJsTestBatchRequest {
    run_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopJsTestBatchResponse {
    run_id: String,
    stopped: bool,
}

#[tauri::command]
pub(crate) async fn run_js_test_batch_json(
    request: JsTestBatchRequest,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    batches: State<'_, Arc<JsTestBatchRegistry>>,
) -> Result<RunJsTestBatchResponse, String> {
    let run_id = request.run_id().to_string();
    let workspace_id = request.workspace_id().clone();
    let reservation = batches.reserve(&run_id, &workspace_id)?;
    let cancellation = reservation.cancellation();
    let setup = (|| {
        let app_data_base = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let root = registry.clone_root(&workspace_id).map_err(|_| {
            "JavaScript test workspace is not open or its identity changed.".to_string()
        })?;
        let root_path = crate::workspace_registry::opened_root_path(&root).map_err(|error| {
            format!("Registered JavaScript test workspace is unavailable: {error}")
        })?;
        let root_text = root_path
            .to_str()
            .ok_or_else(|| "JavaScript test workspace path is not valid UTF-8.".to_string())?;
        let trust_snapshot = trust
            .lock()
            .map_err(|error| error.to_string())?
            .snapshot(root_text);
        Ok::<_, String>((app_data_base, root, trust_snapshot))
    })();
    let (app_data_base, root, trust_snapshot) = match setup {
        Ok(value) => value,
        Err(message) => return Err(message),
    };
    if !trust_snapshot.trusted {
        return Ok(RunJsTestBatchResponse {
            owner: JsTestBatchOwner {
                run_id,
                workspace_id,
            },
            outcome: JsTestBatchOutcome::Unavailable {
                message: "Trust this workspace to run JavaScript tests.".to_string(),
                authorities: Vec::new(),
            },
        });
    }
    let package_roots = request.into_package_roots();
    let outcome = crate::run_blocking_command(move || {
        let _reservation = reservation;
        let prepared = match prepare_registered_js_test_batch(root, &app_data_base, package_roots) {
            Ok(prepared) => prepared,
            Err(message) => {
                return Ok(JsTestBatchOutcome::Error {
                    message,
                    authorities: Vec::new(),
                    output: Default::default(),
                })
            }
        };
        Ok(execute_prepared_js_test_batch(prepared, cancellation))
    })
    .await;
    let current_trust = trust
        .lock()
        .map_err(|error| error.to_string())?
        .snapshot(&trust_snapshot.root_path);
    if current_trust != trust_snapshot {
        return Err("JavaScript test batch workspace trust authority changed.".to_string());
    }
    registry.clone_root(&workspace_id).map_err(|_| {
        "JavaScript test batch workspace registration authority changed.".to_string()
    })?;
    Ok(RunJsTestBatchResponse {
        owner: JsTestBatchOwner {
            run_id,
            workspace_id,
        },
        outcome: outcome?,
    })
}

#[tauri::command]
pub(crate) fn stop_js_test_batch(
    request: StopJsTestBatchRequest,
    batches: State<'_, Arc<JsTestBatchRegistry>>,
) -> Result<StopJsTestBatchResponse, String> {
    let stopped = batches.request_stop(&request.run_id, &request.workspace_id)?;
    Ok(StopJsTestBatchResponse {
        run_id: request.run_id,
        stopped,
    })
}

fn workspace_is_trusted(
    root_path: &str,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<bool, String> {
    trust
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.get(root_path).trusted)
}

fn untrusted_response() -> PhpTestRunResponse {
    PhpTestRunResponse::Unavailable {
        message: "Trust this workspace to run JavaScript tests.".to_string(),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{
        run_js_tests_json_with_trust, JsTestBatchOwner, RunJsTestBatchResponse,
        StopJsTestBatchResponse,
    };
    use crate::js_test_run::batch::{
        JsTestBatchOutcome, JsTestBatchOutput, JsTestBatchPackageAuthority,
    };
    use crate::php_test_run::{PhpTestRunResponse, PhpTestTotals};
    use crate::trust::WorkspaceTrustService;
    use crate::workspace_registry::WorkspaceId;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    #[test]
    fn composition_root_registers_batch_state_commands_and_shutdown() {
        let composition = include_str!("lib.rs");
        let lifecycle = include_str!("runtime_task_lifecycle.rs");
        let trust = include_str!("workspace_trust_commands.rs");
        assert!(
            composition.contains("Arc::new(JsTestBatchRegistry::new())")
                && composition.contains(".manage(Arc::clone(&js_test_batch_registry))"),
            "the composition root must explicitly own and inject the batch registry"
        );
        assert!(
            composition.contains("run_js_test_batch_json,"),
            "batch run command must be registered"
        );
        assert!(
            composition.contains("stop_js_test_batch,"),
            "batch stop command must be registered"
        );
        assert!(
            lifecycle.contains("js_test_batches.stop_all();"),
            "shutdown must cancel every active batch generation"
        );
        assert!(
            lifecycle.contains("js_test_batches.request_stop_workspace(workspace_id);"),
            "workspace close/replacement must use the explicit batch cancellation port"
        );
        assert!(
            trust.contains("js_test_batches")
                && trust.contains(".request_stop_workspace(&descriptor.workspace_id);"),
            "trust revocation must use the explicit batch cancellation port"
        );
        assert!(!lifecycle.contains("try_state::<js_test_run::batch::JsTestBatchRegistry>"));
    }

    #[test]
    fn shared_batch_contract_matches_serialized_command_envelopes() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/domain/jsTestBatch.contract.fixtures.json"
        ))
        .expect("parse shared JavaScript test batch contract");
        assert_eq!(
            fixture["commands"],
            serde_json::json!({
                "run": "run_js_test_batch_json",
                "stop": "stop_js_test_batch"
            })
        );
        let workspace_id: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace")).expect("workspace ID");
        let authorities = || Vec::<JsTestBatchPackageAuthority>::new();
        let outcomes = [
            (
                "ok",
                JsTestBatchOutcome::Ok {
                    packages: Vec::new(),
                    totals: PhpTestTotals::default(),
                },
            ),
            (
                "cancelled",
                JsTestBatchOutcome::Cancelled {
                    authorities: authorities(),
                    output: JsTestBatchOutput::default(),
                },
            ),
            (
                "error",
                JsTestBatchOutcome::Error {
                    authorities: authorities(),
                    message: "failed".to_string(),
                    output: JsTestBatchOutput::default(),
                },
            ),
            (
                "unavailable",
                JsTestBatchOutcome::Unavailable {
                    authorities: authorities(),
                    message: "unavailable".to_string(),
                },
            ),
        ];
        for (status, outcome) in outcomes {
            let value = serde_json::to_value(RunJsTestBatchResponse {
                owner: JsTestBatchOwner {
                    run_id: "run".to_string(),
                    workspace_id: workspace_id.clone(),
                },
                outcome,
            })
            .expect("serialize batch response");
            assert_eq!(
                json_object_keys(&value),
                fixture["wire"]["outcomeKeys"][status],
                "{status}"
            );
            assert_eq!(
                json_object_keys(&value["owner"]),
                fixture["wire"]["ownerKeys"],
                "{status}"
            );
        }
        let stop = serde_json::to_value(StopJsTestBatchResponse {
            run_id: "run".to_string(),
            stopped: true,
        })
        .expect("serialize batch stop response");
        assert_eq!(json_object_keys(&stop), fixture["wire"]["stopResponseKeys"]);
    }

    #[test]
    fn untrusted_workspace_blocks_dispatch() {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "js-test-command-untrusted-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create workspace");
        let marker = root.join("js-tests-ran");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        let binary = root.join("node_modules/.bin/vitest");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary path");
        fs::write(
            &binary,
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .expect("write runner");
        let mut permissions = fs::metadata(&binary)
            .expect("runner metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("make runner executable");
        let trust = Mutex::new(
            WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
        );

        let response = tauri::async_runtime::block_on(run_js_tests_json_with_trust(
            root.to_string_lossy().into_owned(),
            root.join("app-data"),
            None,
            &trust,
        ))
        .expect("test response");

        assert_eq!(
            response,
            PhpTestRunResponse::Unavailable {
                message: "Trust this workspace to run JavaScript tests.".to_string(),
            }
        );
        assert!(!marker.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn json_object_keys(value: &serde_json::Value) -> serde_json::Value {
        serde_json::json!(value
            .as_object()
            .expect("JSON object")
            .keys()
            .collect::<Vec<_>>())
    }
}
