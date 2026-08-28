#[cfg(test)]
use super::JsTestTimeoutTrigger;
use super::{
    detect_runner_in_workspace, ensure_registered_root_identity, parse_jest_json,
    read_report_bounded, registered_root_path, scoped_runner_args, selection_for_scope,
    with_stderr_tail, JsTestProcessTimeout, JsTestRunScope, JsTestRunSelection, JsTestRunner,
    ERROR_TAIL_BYTES, MAX_REPORT_BYTES, RESULT_LABEL, RESULT_SUBDIRECTORY, RUNNER_TIMEOUT,
};
mod bounded_captured_stream {
    include!("bounded_captured_stream.rs");
}

use self::bounded_captured_stream::{
    read_bounded_captured_stream, BoundedCapturedStream, CAPTURED_STREAM_BYTES_LIMIT,
};
use crate::{
    js_test_execution_root::{
        ensure_js_test_execution_context_identity, resolve_js_test_execution_context,
        retain_js_test_process_authority, RetainedJsTestProcessAuthority, RetainedJsTestRunnerKind,
    },
    php_test_run::PhpTestRunResponse,
    terminal_task_process::TerminalTaskOwnership,
    test_run_support::{prepare_result_path_with_extension, ResultFileGuard},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestTaskOutputStream {
    text: String,
    truncated: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestTaskOutput {
    stdout: JsTestTaskOutputStream,
    stderr: JsTestTaskOutputStream,
}

pub(crate) enum JsTestTaskRunOutcome {
    Response {
        response: PhpTestRunResponse,
        output: JsTestTaskOutput,
    },
    Cancelled {
        output: JsTestTaskOutput,
    },
}

pub(super) enum JsTestRunnerCompletion {
    Completed(JsTestProcessOutput),
    Cancelled(JsTestProcessOutput),
    Failed {
        message: String,
        output: JsTestProcessOutput,
    },
}

pub(super) struct JsTestProcessOutput {
    output: JsTestTaskOutput,
    stderr_diagnostic_tail: Vec<u8>,
    stdout_read_error: Option<String>,
    stderr_read_error: Option<String>,
}

impl JsTestProcessOutput {
    pub(super) fn diagnostic_only(stderr_diagnostic_tail: Vec<u8>) -> Self {
        Self {
            output: JsTestTaskOutput::default(),
            stderr_diagnostic_tail,
            stdout_read_error: None,
            stderr_read_error: None,
        }
    }
}

impl JsTestTaskRunOutcome {
    fn response(response: PhpTestRunResponse) -> Self {
        Self::Response {
            response,
            output: JsTestTaskOutput::default(),
        }
    }
}

#[cfg(unix)]
pub(crate) fn run_registered<F>(
    root: std::fs::File,
    app_data_base: PathBuf,
    package_root_relative_path: String,
    scope: JsTestRunScope,
    activate: F,
) -> JsTestTaskRunOutcome
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    let root_path = match registered_root_path(&root) {
        Ok(path) => path,
        Err(message) => {
            return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message })
        }
    };
    if let Err(message) = ensure_registered_root_identity(&root, &root_path) {
        return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message });
    }
    let execution =
        match resolve_js_test_execution_context(&root_path, &package_root_relative_path, scope) {
            Ok(execution) => execution,
            Err(message) => {
                return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message })
            }
        };
    if let Err(message) = ensure_js_test_execution_context_identity(&execution) {
        return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message });
    }
    let outcome = run_at_roots(
        &root_path,
        &execution.execution_root,
        &execution.package_root_path,
        &app_data_base,
        |runner, execution_root, result_path| {
            ensure_registered_root_identity(&root, &root_path)?;
            ensure_js_test_execution_context_identity(&execution)?;
            let selection = selection_for_scope(execution_root, &execution.scope)?;
            let (binary, runner_kind) = match runner {
                JsTestRunner::Vitest(binary) => (binary, RetainedJsTestRunnerKind::Vitest),
                JsTestRunner::Jest(binary) => (binary, RetainedJsTestRunnerKind::Jest),
            };
            let authority = retain_js_test_process_authority(&execution, binary, runner_kind)?;
            execute_scoped_retained(
                runner,
                execution_root,
                result_path,
                &selection,
                activate,
                authority,
            )
        },
    );
    if let Err(message) = ensure_registered_root_identity(&root, &root_path) {
        return match outcome {
            JsTestTaskRunOutcome::Cancelled { .. } => outcome,
            JsTestTaskRunOutcome::Response { output, .. } => JsTestTaskRunOutcome::Response {
                response: PhpTestRunResponse::Error { message },
                output,
            },
        };
    }
    outcome
}

#[cfg(test)]
pub(super) fn run_at_root<F>(root: &Path, app_data_base: &Path, execute: F) -> JsTestTaskRunOutcome
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<JsTestRunnerCompletion, String>,
{
    run_at_roots(root, root, root, app_data_base, execute)
}

pub(super) fn run_at_roots<F>(
    projection_root: &Path,
    execution_root: &Path,
    package_root_path: &Path,
    app_data_base: &Path,
    execute: F,
) -> JsTestTaskRunOutcome
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<JsTestRunnerCompletion, String>,
{
    let runner =
        match detect_runner_in_workspace(execution_root, package_root_path, projection_root) {
            Ok(Some(runner)) => runner,
            Ok(None) => {
                return JsTestTaskRunOutcome::response(PhpTestRunResponse::Unavailable {
                    message: "No JavaScript test runner is available in this workspace."
                        .to_string(),
                });
            }
            Err(message) => {
                return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message })
            }
        };
    let result_path = match prepare_result_path_with_extension(
        app_data_base,
        RESULT_SUBDIRECTORY,
        RESULT_LABEL,
        "json",
    ) {
        Ok(path) => path,
        Err(message) => {
            return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message })
        }
    };
    let guard = ResultFileGuard(result_path.clone());
    let process_output = match execute(&runner, execution_root, &result_path) {
        Ok(JsTestRunnerCompletion::Completed(output)) => output,
        Ok(JsTestRunnerCompletion::Cancelled(output)) => {
            return JsTestTaskRunOutcome::Cancelled {
                output: output.output,
            }
        }
        Ok(JsTestRunnerCompletion::Failed { message, output }) => {
            return JsTestTaskRunOutcome::Response {
                response: PhpTestRunResponse::Error { message },
                output: output.output,
            }
        }
        Err(message) => {
            return JsTestTaskRunOutcome::response(PhpTestRunResponse::Error { message })
        }
    };
    match fs::metadata(&result_path) {
        Ok(metadata) if metadata.len() <= MAX_REPORT_BYTES => {}
        Ok(metadata) => {
            return JsTestTaskRunOutcome::Response {
                response: PhpTestRunResponse::Error {
                    message: format!(
                        "JavaScript test report exceeded the {} byte safety limit ({} bytes).",
                        MAX_REPORT_BYTES,
                        metadata.len()
                    ),
                },
                output: process_output.output,
            }
        }
        Err(error) => {
            return JsTestTaskRunOutcome::Response {
                response: PhpTestRunResponse::Error {
                    message: with_stderr_tail(
                        format!(
                        "JavaScript test runner did not produce a readable JSON report: {error}"
                    ),
                        &process_output.stderr_diagnostic_tail,
                    ),
                },
                output: process_output.output,
            }
        }
    }
    let json = match read_report_bounded(&result_path) {
        Ok(json) => json,
        Err(message) => {
            return JsTestTaskRunOutcome::Response {
                response: PhpTestRunResponse::Error {
                    message: with_stderr_tail(message, &process_output.stderr_diagnostic_tail),
                },
                output: process_output.output,
            }
        }
    };
    let response = match parse_jest_json(&json, projection_root) {
        Ok(response) => response,
        Err(error) => PhpTestRunResponse::Error {
            message: with_stderr_tail(
                format!("Failed to process JavaScript test report: {error}"),
                &process_output.stderr_diagnostic_tail,
            ),
        },
    };
    drop(guard);
    JsTestTaskRunOutcome::Response {
        response,
        output: process_output.output,
    }
}

fn execute_scoped_retained<F>(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    selection: &JsTestRunSelection,
    activate: F,
    authority: RetainedJsTestProcessAuthority,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_scoped_retained_optional(
        runner,
        root,
        result_path,
        selection,
        activate,
        Some(authority),
    )
}

fn execute_scoped_retained_optional<F>(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    selection: &JsTestRunSelection,
    activate: F,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_with_args_retained(
        runner,
        root,
        scoped_runner_args(runner, result_path, selection),
        activate,
        authority,
    )
}

#[cfg(test)]
fn execute_with_args<F>(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    activate: F,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_with_args_retained(runner, root, args, activate, None)
}

fn execute_with_args_retained<F>(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    activate: F,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_with_args_timeout_retained(runner, root, args, RUNNER_TIMEOUT, activate, authority)
}

#[cfg(test)]
fn execute_with_args_timeout_trigger<F>(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    reported_duration: Duration,
    trigger: JsTestTimeoutTrigger,
    activate: F,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_with_args_timeout_policy(
        runner,
        root,
        args,
        JsTestProcessTimeout::triggered(reported_duration, trigger),
        activate,
        None,
    )
}

fn execute_with_args_timeout_retained<F>(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    timeout: Duration,
    activate: F,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    execute_with_args_timeout_policy(
        runner,
        root,
        args,
        JsTestProcessTimeout::elapsed(timeout),
        activate,
        authority,
    )
}

fn execute_with_args_timeout_policy<F>(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    timeout: JsTestProcessTimeout,
    activate: F,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<JsTestRunnerCompletion, String>
where
    F: FnOnce(TerminalTaskOwnership) -> Result<(), String>,
{
    let binary = match runner {
        JsTestRunner::Vitest(binary) => binary,
        JsTestRunner::Jest(binary) => binary,
    };
    let mut command = if let Some(authority) = authority {
        authority.into_command(args)
    } else {
        let mut command = Command::new(binary);
        command.args(args).current_dir(root);
        command
    };
    command
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run JavaScript tests: {error}"))?;
    let process_group_id = match i32::try_from(child.id()) {
        Ok(process_group_id) => process_group_id,
        Err(_) => {
            #[cfg(unix)]
            crate::debug_support::DebugProcessHandle::from_process_id(child.id()).terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
            return Err("JavaScript test runner process id is invalid.".to_string());
        }
    };
    let ownership = TerminalTaskOwnership::new(0, 0, process_group_id);
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            ownership.terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = ownership.wait_after_terminate(&mut child);
            return Err("JavaScript test runner has no stdout pipe.".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            ownership.terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = ownership.wait_after_terminate(&mut child);
            return Err("JavaScript test runner has no stderr pipe.".to_string());
        }
    };
    let stdout_reader =
        thread::spawn(move || read_bounded_captured_stream(stdout, CAPTURED_STREAM_BYTES_LIMIT));
    let stderr_reader =
        thread::spawn(move || read_bounded_captured_stream(stderr, CAPTURED_STREAM_BYTES_LIMIT));
    if let Err(message) = activate(ownership.clone()) {
        ownership.terminate();
        #[cfg(not(unix))]
        let _ = child.kill();
        let _ = ownership.wait_after_terminate(&mut child);
        let _ = stdout_reader.join();
        let _ = stderr_reader.join();
        return Err(message);
    }
    let started_at = Instant::now();
    loop {
        #[cfg(not(unix))]
        if ownership.was_stop_requested() {
            let _ = child.kill();
        }
        match ownership.try_wait(&mut child) {
            Ok(Some(_)) => {
                let output = join_captured_output(stdout_reader, stderr_reader)?;
                return Ok(if ownership.was_stop_requested() {
                    JsTestRunnerCompletion::Cancelled(output)
                } else if let Some(message) = output_read_error(&output) {
                    JsTestRunnerCompletion::Failed { message, output }
                } else {
                    JsTestRunnerCompletion::Completed(output)
                });
            }
            Ok(None) => {}
            Err(error) => {
                let stopped = ownership.was_stop_requested();
                let _ = ownership.wait_after_terminate(&mut child);
                let output = join_captured_output(stdout_reader, stderr_reader)?;
                return if stopped {
                    Ok(JsTestRunnerCompletion::Cancelled(output))
                } else {
                    Ok(JsTestRunnerCompletion::Failed {
                        message: format!("Failed to inspect JavaScript test runner: {error}"),
                        output,
                    })
                };
            }
        }
        if timeout.has_expired(started_at) {
            let stopped = ownership.was_stop_requested();
            ownership.terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = ownership.wait_after_terminate(&mut child);
            let output = join_captured_output(stdout_reader, stderr_reader)?;
            return if stopped {
                Ok(JsTestRunnerCompletion::Cancelled(output))
            } else {
                Ok(JsTestRunnerCompletion::Failed {
                    message: format!(
                        "JavaScript test runner timed out after {} seconds.",
                        timeout.duration().as_secs()
                    ),
                    output,
                })
            };
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn join_captured_output(
    stdout_reader: thread::JoinHandle<BoundedCapturedStream>,
    stderr_reader: thread::JoinHandle<BoundedCapturedStream>,
) -> Result<JsTestProcessOutput, String> {
    let stdout = stdout_reader
        .join()
        .map_err(|_| "JavaScript test stdout reader failed.".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "JavaScript test stderr reader failed.".to_string())?;
    let stderr_tail_start = stderr.raw_tail.len().saturating_sub(ERROR_TAIL_BYTES);
    let stderr_diagnostic_tail = stderr.raw_tail[stderr_tail_start..].to_vec();
    Ok(JsTestProcessOutput {
        output: JsTestTaskOutput {
            stdout: JsTestTaskOutputStream {
                text: stdout.text,
                truncated: stdout.truncated,
            },
            stderr: JsTestTaskOutputStream {
                text: stderr.text,
                truncated: stderr.truncated,
            },
        },
        stderr_diagnostic_tail,
        stdout_read_error: stdout.read_error,
        stderr_read_error: stderr.read_error,
    })
}

fn output_read_error(output: &JsTestProcessOutput) -> Option<String> {
    output
        .stdout_read_error
        .as_ref()
        .map(|message| format!("Failed to read JavaScript test runner stdout: {message}"))
        .or_else(|| {
            output
                .stderr_read_error
                .as_ref()
                .map(|message| format!("Failed to read JavaScript test runner stderr: {message}"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::js_test_run::batch::test_support;
    use std::{
        fs,
        sync::mpsc,
        time::{Duration, Instant},
    };

    fn temp_directory(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "editor-js-test-task-runner-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp directory");
        root
    }

    #[cfg(unix)]
    fn install_script(root: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = root.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        let mut permissions = fs::metadata(&path).expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("script permissions");
        path
    }

    fn empty_process_output() -> JsTestProcessOutput {
        JsTestProcessOutput::diagnostic_only(Vec::new())
    }

    #[test]
    fn task_output_serializes_as_two_separate_bounded_tail_streams() {
        let output = JsTestTaskOutput {
            stdout: JsTestTaskOutputStream {
                text: "out".to_string(),
                truncated: false,
            },
            stderr: JsTestTaskOutputStream {
                text: "err".to_string(),
                truncated: true,
            },
        };
        assert_eq!(
            serde_json::to_value(output).unwrap(),
            serde_json::json!({
                "stdout": { "text": "out", "truncated": false },
                "stderr": { "text": "err", "truncated": true }
            })
        );
    }

    #[test]
    fn cancelled_task_deletes_its_private_result_file() {
        let root = temp_directory("cancelled-cleanup");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        let binary = root.join("node_modules/.bin/vitest");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary parent");
        fs::write(&binary, "").expect("write binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&binary)
                .expect("binary metadata")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&binary, permissions).expect("binary permissions");
        }
        let app_data = root.join("app-data");
        let outcome = run_at_root(&root, &app_data, |_, _, result_path| {
            fs::write(result_path, b"partial").expect("write partial result");
            Ok(JsTestRunnerCompletion::Cancelled(empty_process_output()))
        });
        assert!(matches!(outcome, JsTestTaskRunOutcome::Cancelled { .. }));
        assert_eq!(
            fs::read_dir(app_data.join("js-test-results"))
                .expect("read results")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn nested_package_detection_executes_there_but_projects_workspace_relative_results() {
        let root = temp_directory("nested-package-root");
        let package = root.join("packages/web");
        fs::create_dir_all(root.join("node_modules/.bin")).expect("create hoisted binary");
        fs::create_dir_all(&package).expect("create nested package");
        fs::write(package.join("vitest.config.ts"), "export default {}").expect("write config");
        let binary = root.join("node_modules/.bin/vitest");
        fs::write(&binary, "").expect("write runner");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))
                .expect("runner permissions");
        }
        let test_file = package.join("src/app.test.ts");
        fs::create_dir_all(test_file.parent().expect("test parent")).expect("create test parent");
        fs::write(&test_file, "test('works', () => {})").expect("write test");

        let outcome = run_at_roots(
            &root,
            &package,
            &package,
            &root.join("app-data"),
            |runner, execution_root, result_path| {
                assert_eq!(execution_root, package);
                assert_eq!(
                    runner,
                    &JsTestRunner::Vitest(fs::canonicalize(&binary).expect("canonical runner"))
                );
                fs::write(
                    result_path,
                    serde_json::json!({
                        "testResults": [{
                            "name": test_file,
                            "status": "passed",
                            "assertionResults": [{
                                "title": "works",
                                "fullName": "works",
                                "status": "passed",
                                "failureMessages": []
                            }]
                        }]
                    })
                    .to_string(),
                )
                .expect("write report");
                Ok(JsTestRunnerCompletion::Completed(empty_process_output()))
            },
        );

        let JsTestTaskRunOutcome::Response {
            response: PhpTestRunResponse::Ok { suites, .. },
            ..
        } = outcome
        else {
            panic!("expected successful nested package run");
        };
        assert_eq!(
            suites[0].name.as_deref(),
            Some("packages/web/src/app.test.ts")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn cancellable_runner_kills_and_reaps_the_process_group() {
        let root = temp_directory("process-group");
        let grandchild_path = root.join("grandchild.pid");
        let binary = install_script(
            &root,
            "runner.sh",
            &format!(
                "sleep 30 &\nchild=$!\nprintf '%s' \"$child\" > '{}.tmp'\nmv '{}.tmp' '{}'\nwait \"$child\"",
                grandchild_path.display(),
                grandchild_path.display(),
                grandchild_path.display()
            ),
        );
        let runner = JsTestRunner::Vitest(binary);
        let (owner_tx, owner_rx) = mpsc::sync_channel(1);
        let worker_root = root.clone();
        let worker = thread::spawn(move || {
            execute_with_args(&runner, &worker_root, Vec::new(), move |ownership| {
                owner_tx.send(ownership).expect("publish ownership");
                Ok(())
            })
        });
        let ownership = owner_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive ownership");
        let grandchild = test_support::wait_for_parseable_pid(&grandchild_path, "grandchild pid");
        let started = Instant::now();
        assert!(ownership.request_stop());
        assert!(matches!(
            worker.join().expect("join runner").expect("runner result"),
            JsTestRunnerCompletion::Cancelled(_)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(unsafe { libc::kill(grandchild, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        assert!(!ownership.request_stop());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn accepted_stop_wins_over_natural_exit_but_late_stop_does_not() {
        let cancelled_root = temp_directory("cancel-natural-race");
        let cancelled_runner = JsTestRunner::Vitest(install_script(
            &cancelled_root,
            "runner.sh",
            "sleep 0.1\nexit 0",
        ));
        let (cancel_tx, cancel_rx) = mpsc::sync_channel(1);
        let worker_root = cancelled_root.clone();
        let cancelled_worker = thread::spawn(move || {
            execute_with_args(
                &cancelled_runner,
                &worker_root,
                Vec::new(),
                move |ownership| {
                    cancel_tx.send(ownership).expect("publish ownership");
                    Ok(())
                },
            )
        });
        let cancelled_owner = cancel_rx.recv().expect("receive ownership");
        assert!(cancelled_owner.request_stop());
        assert!(matches!(
            cancelled_worker
                .join()
                .expect("join runner")
                .expect("runner result"),
            JsTestRunnerCompletion::Cancelled(_)
        ));

        let completed_root = temp_directory("late-stop-natural-race");
        let completed_runner =
            JsTestRunner::Vitest(install_script(&completed_root, "runner.sh", "exit 0"));
        let (complete_tx, complete_rx) = mpsc::sync_channel(1);
        let worker_root = completed_root.clone();
        let completed_worker = thread::spawn(move || {
            execute_with_args(
                &completed_runner,
                &worker_root,
                Vec::new(),
                move |ownership| {
                    complete_tx.send(ownership).expect("publish ownership");
                    Ok(())
                },
            )
        });
        let completed_owner = complete_rx.recv().expect("receive ownership");
        assert!(matches!(
            completed_worker
                .join()
                .expect("join runner")
                .expect("runner result"),
            JsTestRunnerCompletion::Completed(_)
        ));
        assert!(!completed_owner.request_stop());
        fs::remove_dir_all(cancelled_root).expect("cleanup cancelled");
        fs::remove_dir_all(completed_root).expect("cleanup completed");
    }

    #[cfg(unix)]
    #[test]
    fn captures_and_drains_both_stream_tails_without_deadlock() {
        let root = temp_directory("both-streams");
        let binary = install_script(
            &root,
            "runner.sh",
            "head -c 131072 /dev/zero | tr '\\0' o\n\
             head -c 131072 /dev/zero | tr '\\0' e >&2",
        );
        let runner = JsTestRunner::Vitest(binary);

        let completion =
            execute_with_args(&runner, &root, Vec::new(), |_| Ok(())).expect("runner completion");
        let JsTestRunnerCompletion::Completed(output) = completion else {
            panic!("expected completed output");
        };
        assert_eq!(output.output.stdout.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(output.output.stdout.text.bytes().all(|byte| byte == b'o'));
        assert!(output.output.stdout.truncated);
        assert_eq!(output.output.stderr.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(output.output.stderr.text.bytes().all(|byte| byte == b'e'));
        assert!(output.output.stderr.truncated);
        assert_eq!(output.stderr_diagnostic_tail.len(), ERROR_TAIL_BYTES);
        assert!(output
            .stderr_diagnostic_tail
            .iter()
            .all(|byte| *byte == b'e'));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn active_cancel_returns_partial_output_after_reaping_readers() {
        let root = temp_directory("partial-cancel-output");
        let ready = root.join("ready");
        let binary = install_script(
            &root,
            "runner.sh",
            &format!(
                "printf 'stdout-before-stop'\nprintf 'stderr-before-stop' >&2\ntouch '{}'\nsleep 30",
                ready.display()
            ),
        );
        let runner = JsTestRunner::Vitest(binary);
        let (owner_tx, owner_rx) = mpsc::sync_channel(1);
        let worker_root = root.clone();
        let worker_ready = ready.clone();
        let worker = thread::spawn(move || {
            execute_with_args(&runner, &worker_root, Vec::new(), move |ownership| {
                let started = Instant::now();
                while !worker_ready.is_file() {
                    assert!(started.elapsed() < Duration::from_secs(2));
                    thread::sleep(Duration::from_millis(5));
                }
                owner_tx.send(ownership).expect("publish ownership");
                Ok(())
            })
        });
        let ownership = owner_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive ownership");
        assert!(ownership.request_stop());
        let completion = worker.join().expect("join runner").expect("runner result");
        let JsTestRunnerCompletion::Cancelled(output) = completion else {
            panic!("expected cancelled output");
        };
        assert_eq!(output.output.stdout.text, "stdout-before-stop");
        assert_eq!(output.output.stderr.text, "stderr-before-stop");
        assert!(!output.output.stdout.truncated);
        assert!(!output.output.stderr.truncated);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn timeout_returns_captured_output_after_process_group_cleanup() {
        let root = temp_directory("timeout-output");
        let ready = root.join("ready");
        let binary = install_script(
            &root,
            "runner.sh",
            &format!(
                "printf 'stdout-before-timeout'\nprintf 'stderr-before-timeout' >&2\ntouch '{}'\nsleep 30",
                ready.display()
            ),
        );
        let runner = JsTestRunner::Vitest(binary);
        let trigger = JsTestTimeoutTrigger::new();
        let activation_trigger = trigger.clone();
        let activation_ready = ready.clone();
        let completion = execute_with_args_timeout_trigger(
            &runner,
            &root,
            Vec::new(),
            Duration::from_secs(300),
            trigger,
            |_| activation_trigger.expire_after_fixture_ready(&activation_ready),
        )
        .expect("runner completion");
        let JsTestRunnerCompletion::Failed { message, output } = completion else {
            panic!("expected timeout failure");
        };
        assert!(message.contains("timed out"));
        assert_eq!(output.output.stdout.text, "stdout-before-timeout");
        assert_eq!(output.output.stderr.text, "stderr-before-timeout");
        fs::remove_dir_all(root).expect("cleanup");
    }
}
