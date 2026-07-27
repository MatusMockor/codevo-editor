use super::*;
use crate::php_test_run::PhpTestRunResponse;

#[test]
fn shared_cross_language_contract_fixture_matches_rust_limits_and_wire() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../src/domain/jsTestBatch.contract.fixtures.json"
    ))
    .expect("parse shared JavaScript test batch contract");
    assert_eq!(
        fixture,
        serde_json::json!({
            "version": 1,
            "commands": {
                "run": "run_js_test_batch_json",
                "stop": "stop_js_test_batch"
            },
            "limits": {
                "maxPackages": MAX_JS_TEST_BATCH_PACKAGES,
                "maxPackageRootBytes": MAX_BATCH_PACKAGE_ROOT_BYTES,
                "maxOwnerIdBytes": MAX_BATCH_OWNER_ID_BYTES,
                "maxSuites": MAX_SUITES,
                "maxCases": MAX_CASES,
                "maxReportBytes": MAX_REPORT_BYTES,
                "maxOutputStreamBytes": CAPTURED_STREAM_BYTES_LIMIT
            },
            "wire": {
                "requestKeys": ["packages", "runId", "workspaceId"],
                "stopRequestKeys": ["runId", "workspaceId"],
                "stopResponseKeys": ["runId", "stopped"],
                "packagePlanKeys": ["packageRootRelativePath"],
                "ownerKeys": ["runId", "workspaceId"],
                "packageResultKeys": ["authority", "output", "response"],
                "authorityKeys": ["packageRootRelativePath", "runner"],
                "outputKeys": ["stderr", "stdout"],
                "outputStreamKeys": ["text", "truncated"],
                "runners": ["jest", "vitest"],
                "statuses": ["cancelled", "error", "ok", "unavailable"],
                "outcomeKeys": {
                    "ok": ["owner", "packages", "status", "totals"],
                    "cancelled": ["authorities", "output", "owner", "status"],
                    "error": ["authorities", "message", "output", "owner", "status"],
                    "unavailable": ["authorities", "message", "owner", "status"]
                }
            }
        })
    );
    assert_eq!(
        serde_json::to_value(JsTestBatchRunner::Jest).expect("serialize Jest runner"),
        serde_json::json!("jest")
    );
    assert_eq!(
        serde_json::to_value(JsTestBatchRunner::Vitest).expect("serialize Vitest runner"),
        serde_json::json!("vitest")
    );
    let package = JsTestBatchPackageResult {
        authority: JsTestBatchPackageAuthority {
            package_root_relative_path: "packages/a".to_string(),
            runner: JsTestBatchRunner::Jest,
        },
        response: PhpTestRunResponse::Ok {
            suites: Vec::new(),
            totals: PhpTestTotals::default(),
        },
        output: JsTestBatchOutput::default(),
    };
    let package_json = serde_json::to_value(&package).expect("serialize package result");
    assert_eq!(
        json_object_keys(&package_json),
        fixture["wire"]["packageResultKeys"]
    );
    assert_eq!(
        json_object_keys(&package_json["authority"]),
        fixture["wire"]["authorityKeys"]
    );
    assert_eq!(
        json_object_keys(&package_json["output"]),
        fixture["wire"]["outputKeys"]
    );
    assert_eq!(
        json_object_keys(&package_json["output"]["stdout"]),
        fixture["wire"]["outputStreamKeys"]
    );

    let mut request = serde_json::json!({
        "runId": "run",
        "workspaceId": "workspace",
        "packages": [{"packageRootRelativePath": "packages/a"}]
    });
    assert!(serde_json::from_value::<JsTestBatchRequest>(request.clone()).is_ok());
    request
        .as_object_mut()
        .expect("request object")
        .insert("unknown".to_string(), serde_json::json!(true));
    assert!(serde_json::from_value::<JsTestBatchRequest>(request).is_err());
}

fn json_object_keys(value: &serde_json::Value) -> serde_json::Value {
    serde_json::json!(value
        .as_object()
        .expect("JSON object")
        .keys()
        .collect::<Vec<_>>())
}
