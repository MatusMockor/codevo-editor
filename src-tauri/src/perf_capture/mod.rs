#![cfg(feature = "perf-capture")]

use std::path::{Component, Path, PathBuf};

const RUN_TOKEN_ENV: &str = env!("CODEVO_PERF_CAPTURE_RUN_TOKEN");
const RESULT_PATH_ENV: &str = env!("CODEVO_PERF_CAPTURE_RESULT_PATH");

#[cfg(target_os = "macos")]
pub(crate) fn claim_process_group() -> Result<(), String> {
    let pid = unsafe { libc::getpid() };
    let current_group = unsafe { libc::getpgid(0) };
    if pid <= 0 || current_group <= 0 {
        return Err(error(
            "Performance capture process ownership could not be established.",
        ));
    }
    if current_group == pid {
        return Ok(());
    }
    if unsafe { libc::setpgid(0, 0) } != 0 || unsafe { libc::getpgid(0) } != pid {
        return Err(error(
            "Performance capture process ownership could not be established.",
        ));
    }
    Ok(())
}

#[derive(Clone)]
struct CaptureConfig {
    result_path: PathBuf,
    run_token: String,
}

fn compile_time_config() -> Result<CaptureConfig, String> {
    if !valid_config_token(RUN_TOKEN_ENV) {
        return Err(error("Performance capture is not configured."));
    }
    let result_path = PathBuf::from(RESULT_PATH_ENV);
    if !valid_result_path(&result_path) {
        return Err(error("Performance capture is not configured."));
    }

    Ok(CaptureConfig {
        result_path,
        run_token: RUN_TOKEN_ENV.to_owned(),
    })
}

fn valid_config_token(token: &str) -> bool {
    (32..=256).contains(&token.len()) && token.bytes().all(|byte| byte.is_ascii_graphic())
}

fn valid_result_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }

    matches!(path.file_name(), Some(name) if !name.is_empty())
        && path
            .components()
            .all(|component| !matches!(component, Component::ParentDir | Component::CurDir))
}

fn tokens_equal(candidate: &[u8], expected: &[u8]) -> bool {
    if candidate.len() != expected.len() {
        return false;
    }

    candidate
        .iter()
        .zip(expected)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn error(message: &'static str) -> String {
    message.to_owned()
}

mod fixture_trust;
mod result_submission;
mod shutdown_proof;
mod window_activation;

pub(crate) use window_activation::PerfCaptureWindowSnapshot;

pub(crate) fn publish_shutdown_proof() -> Result<(), String> {
    shutdown_proof::publish()
}

#[tauri::command]
pub(crate) async fn perf_capture_activate_window<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: Option<String>,
) -> Result<PerfCaptureWindowSnapshot, String> {
    window_activation::activate_window(window, run_token, lease_id).await
}

#[tauri::command]
pub(crate) async fn perf_capture_snapshot_window_lease<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    window_activation::snapshot_window_lease(window, run_token, lease_id).await
}

#[tauri::command]
pub(crate) async fn perf_capture_reset_window_lease_baseline<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    window_activation::reset_window_lease_baseline(window, run_token, lease_id).await
}

#[tauri::command]
pub(crate) async fn perf_capture_release_window_lease<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    window_activation::release_window_lease(window, run_token, lease_id).await
}

#[tauri::command]
pub(crate) async fn perf_capture_submit<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: String,
    run_token: String,
) -> Result<(), String> {
    result_submission::submit(payload, run_token).await?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub(crate) async fn perf_capture_prepare_fixture_trust<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    run_token: String,
) -> Result<(), String> {
    fixture_trust::trust_fixture_workspaces(app, run_token).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tauri::{ipc::InvokeBody, test, webview::InvokeRequest, WebviewWindowBuilder};

    #[test]
    fn tauri_wire_accepts_payload_and_camel_case_run_token() {
        result_submission::reset_submission_for_test();
        let app = test::mock_builder()
            .invoke_handler(tauri::generate_handler![perf_capture_submit])
            .build(test::mock_context(test::noop_assets()))
            .expect("build mock app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build mock webview");
        let response = test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "perf_capture_submit".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().expect("parse invoke URL"),
                body: InvokeBody::Json(serde_json::json!({
                    "payload": "{}",
                    "runToken": "wrong-token"
                })),
                headers: Default::default(),
                invoke_key: test::INVOKE_KEY.to_owned(),
            },
        );

        assert_eq!(
            response.expect_err("wrong token must reject"),
            Value::String("Performance capture token was rejected.".to_owned())
        );
        assert_eq!(result_submission::submission_state_for_test(), 0);
    }

    #[test]
    fn tauri_activation_wire_injects_window_and_accepts_camel_case_run_token() {
        let app = test::mock_builder()
            .invoke_handler(tauri::generate_handler![perf_capture_activate_window])
            .build(test::mock_context(test::noop_assets()))
            .expect("build mock app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build mock webview");
        let response = test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "perf_capture_activate_window".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().expect("parse invoke URL"),
                body: InvokeBody::Json(serde_json::json!({
                    "runToken": "wrong-token"
                })),
                headers: Default::default(),
                invoke_key: test::INVOKE_KEY.to_owned(),
            },
        );

        assert_eq!(
            response.expect_err("wrong token must reject before native access"),
            Value::String("Performance capture window activation was rejected.".to_owned())
        );
    }

    #[test]
    fn tauri_fixture_trust_wire_accepts_only_the_camel_case_run_token() {
        let app = test::mock_builder()
            .invoke_handler(tauri::generate_handler![perf_capture_prepare_fixture_trust])
            .build(test::mock_context(test::noop_assets()))
            .expect("build mock app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build mock webview");
        let response = test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "perf_capture_prepare_fixture_trust".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().expect("parse invoke URL"),
                body: InvokeBody::Json(serde_json::json!({
                    "runToken": "wrong-token"
                })),
                headers: Default::default(),
                invoke_key: test::INVOKE_KEY.to_owned(),
            },
        );

        assert_eq!(
            response.expect_err("wrong token must reject before trust access"),
            Value::String("Performance capture fixture trust was rejected.".to_owned())
        );
    }
}
