use crate::php_test_run::{
    PhpTestCase, PhpTestRunResponse, PhpTestStatus, PhpTestSuite, PhpTestTotals,
};
use crate::test_run_support::bounded_output_tail;
use serde::Deserialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[path = "js_test_batch.rs"]
pub(crate) mod batch;
#[path = "js_test_coverage.rs"]
pub(crate) mod coverage;
#[path = "js_test_projection.rs"]
mod projection;
#[path = "js_test_runner.rs"]
mod runner;
#[path = "js_test_task_runner.rs"]
pub(crate) mod task_runner;

use crate::js_test_execution_root::{
    retain_js_test_process_authority, RetainedJsTestProcessAuthority, RetainedJsTestRunnerKind,
};
use projection::validate_projected_test_text;
#[cfg(test)]
use runner::{detect_runner, MAX_PACKAGE_JSON_BYTES};
use runner::{detect_runner_in_workspace, JsTestRunner};
use task_runner::{run_at_roots as run_js_test_task_at_roots, JsTestRunnerCompletion};
pub(crate) use task_runner::{run_registered as run_js_test_task_registered, JsTestTaskRunOutcome};

const MAX_CASES: usize = 5_000;
const MAX_SUITES: usize = 5_000;
const ERROR_TAIL_BYTES: usize = 4_000;
const MAX_REPORT_BYTES: u64 = 16 * 1024 * 1024;
const RUNNER_TIMEOUT: Duration = Duration::from_secs(300);
const RESULT_SUBDIRECTORY: &str = "js-test-results";
const RESULT_LABEL: &str = "JavaScript test result";
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JsTestNameMatch {
    Prefix,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum JsTestRunScope {
    All,
    File {
        #[serde(rename = "relativeFilePath")]
        relative_file_path: String,
    },
    Suite {
        #[serde(rename = "relativeFilePath")]
        relative_file_path: String,
        #[serde(rename = "fullName")]
        full_name: String,
    },
    Test {
        #[serde(rename = "relativeFilePath")]
        relative_file_path: String,
        #[serde(rename = "fullName")]
        full_name: String,
        #[serde(rename = "nameMatch", default)]
        name_match: Option<JsTestNameMatch>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct JsTestRunSelection {
    relative_file_path: Option<PathBuf>,
    name_pattern: Option<String>,
}

#[derive(Deserialize)]
struct JestReport {
    #[serde(rename = "testResults", default)]
    test_results: Vec<JestFileResult>,
}

#[derive(Deserialize)]
struct JestFileResult {
    name: Option<String>,
    status: Option<String>,
    message: Option<String>,
    #[serde(rename = "assertionResults", default)]
    assertion_results: Vec<JestAssertionResult>,
}

#[derive(Deserialize)]
struct JestAssertionResult {
    title: Option<String>,
    #[serde(rename = "fullName")]
    full_name: Option<String>,
    status: Option<String>,
    duration: Option<f64>,
    #[serde(rename = "failureMessages", default)]
    failure_messages: Vec<String>,
    location: Option<JestLocation>,
}

#[derive(Deserialize)]
struct JestLocation {
    line: Option<u64>,
}

#[cfg(test)]
pub async fn run_js_tests(
    root_path: String,
    app_data_base: PathBuf,
    filter: Option<String>,
) -> Result<PhpTestRunResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_js_tests_blocking(
            &root_path,
            &app_data_base,
            filter.as_deref(),
        ))
    })
    .await
}

#[cfg(unix)]
pub async fn run_js_tests_registered(
    root: std::fs::File,
    app_data_base: PathBuf,
    filter: Option<String>,
) -> Result<PhpTestRunResponse, String> {
    crate::run_blocking_command(move || {
        let root_path = registered_root_path(&root)?;
        ensure_registered_root_identity(&root, &root_path)?;
        Ok(run_js_tests_at_root(
            &root_path,
            &app_data_base,
            |runner, root_path, result_path| {
                ensure_registered_root_identity(&root, root_path)?;
                let result = execute_runner(runner, root_path, result_path, filter.as_deref());
                ensure_registered_root_identity(&root, root_path)?;
                result
            },
        ))
    })
    .await
}

#[cfg(unix)]
pub async fn run_js_tests_scoped_registered(
    root: std::fs::File,
    app_data_base: PathBuf,
    package_root_relative_path: String,
    scope: JsTestRunScope,
) -> Result<PhpTestRunResponse, String> {
    crate::run_blocking_command(move || {
        let root_path = registered_root_path(&root)?;
        ensure_registered_root_identity(&root, &root_path)?;
        let execution = crate::js_test_execution_root::resolve_js_test_execution_context(
            &root_path,
            &package_root_relative_path,
            scope,
        )?;
        crate::js_test_execution_root::ensure_js_test_execution_context_identity(&execution)?;
        Ok(run_js_tests_at_roots(
            &root_path,
            &execution.execution_root,
            &execution.package_root_path,
            &app_data_base,
            |runner, execution_root, result_path| {
                ensure_registered_root_identity(&root, &root_path)?;
                crate::js_test_execution_root::ensure_js_test_execution_context_identity(
                    &execution,
                )?;
                let selection = selection_for_scope(execution_root, &execution.scope)?;
                let (binary, runner_kind) = match runner {
                    JsTestRunner::Vitest(binary) => (binary, RetainedJsTestRunnerKind::Vitest),
                    JsTestRunner::Jest(binary) => (binary, RetainedJsTestRunnerKind::Jest),
                };
                let authority = retain_js_test_process_authority(&execution, binary, runner_kind)?;
                let result = execute_scoped_runner_retained(
                    runner,
                    execution_root,
                    result_path,
                    &selection,
                    authority,
                );
                ensure_registered_root_identity(&root, &root_path)?;
                result
            },
        ))
    })
    .await
}

#[cfg(unix)]
fn registered_root_path(root: &std::fs::File) -> Result<PathBuf, String> {
    crate::workspace_registry::opened_root_path(root)
        .map_err(|error| format!("Registered JavaScript test workspace is unavailable: {error}"))
}

#[cfg(unix)]
fn ensure_registered_root_identity(root: &std::fs::File, path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let registered = root
        .metadata()
        .map_err(|error| format!("Failed to inspect registered workspace: {error}"))?;
    let current = fs::metadata(path)
        .map_err(|error| format!("Registered workspace path is unavailable: {error}"))?;
    if registered.dev() != current.dev() || registered.ino() != current.ino() {
        return Err("Registered JavaScript test workspace identity changed.".to_string());
    }
    Ok(())
}

#[cfg(test)]
fn run_js_tests_blocking(
    root_path: &str,
    app_data_base: &Path,
    filter: Option<&str>,
) -> PhpTestRunResponse {
    run_js_tests_blocking_with(root_path, app_data_base, filter, execute_runner)
}

#[cfg(test)]
fn run_js_tests_blocking_with<F>(
    root_path: &str,
    app_data_base: &Path,
    filter: Option<&str>,
    execute: F,
) -> PhpTestRunResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path, Option<&str>) -> Result<Vec<u8>, String>,
{
    if filter.is_some_and(|value| !is_valid_filter(value)) {
        return PhpTestRunResponse::Error {
            message: "Invalid JavaScript test filter.".to_string(),
        };
    }

    run_js_tests_prepared(root_path, app_data_base, |runner, root, result_path| {
        execute(runner, root, result_path, filter)
    })
}

#[cfg(test)]
fn run_js_tests_scoped_blocking_with<F>(
    root_path: &str,
    app_data_base: &Path,
    scope: &JsTestRunScope,
    execute: F,
) -> PhpTestRunResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path, &JsTestRunSelection) -> Result<Vec<u8>, String>,
{
    run_js_tests_prepared(root_path, app_data_base, |runner, root, result_path| {
        let selection = selection_for_scope(root, scope)?;
        execute(runner, root, result_path, &selection)
    })
}

#[cfg(test)]
fn run_js_tests_prepared<F>(root_path: &str, app_data_base: &Path, execute: F) -> PhpTestRunResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<Vec<u8>, String>,
{
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return PhpTestRunResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    run_js_tests_at_root(&root, app_data_base, execute)
}

fn run_js_tests_at_root<F>(root: &Path, app_data_base: &Path, execute: F) -> PhpTestRunResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<Vec<u8>, String>,
{
    run_js_tests_at_roots(root, root, root, app_data_base, execute)
}

fn run_js_tests_at_roots<F>(
    projection_root: &Path,
    execution_root: &Path,
    package_root_path: &Path,
    app_data_base: &Path,
    execute: F,
) -> PhpTestRunResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<Vec<u8>, String>,
{
    match run_js_test_task_at_roots(
        projection_root,
        execution_root,
        package_root_path,
        app_data_base,
        |runner, root, result_path| {
            execute(runner, root, result_path).map(|stderr| {
                JsTestRunnerCompletion::Completed(
                    task_runner::JsTestProcessOutput::diagnostic_only(stderr),
                )
            })
        },
    ) {
        JsTestTaskRunOutcome::Response { response, .. } => response,
        JsTestTaskRunOutcome::Cancelled { .. } => PhpTestRunResponse::Error {
            message: "JavaScript test run was cancelled unexpectedly.".to_string(),
        },
    }
}

fn read_report_bounded(result_path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(result_path).map_err(|error| {
        format!("JavaScript test runner did not produce a readable JSON report: {error}")
    })?;
    let mut json = Vec::new();
    file.take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut json)
        .map_err(|error| format!("Failed to read JavaScript test report: {error}"))?;
    if json.len() as u64 > MAX_REPORT_BYTES {
        return Err(
            "JavaScript test report grew past the safety limit while being read.".to_string(),
        );
    }
    Ok(json)
}

fn selection_for_scope(root: &Path, scope: &JsTestRunScope) -> Result<JsTestRunSelection, String> {
    let (relative_file_path, full_name, suite) = match scope {
        JsTestRunScope::All => {
            return Ok(JsTestRunSelection {
                relative_file_path: None,
                name_pattern: None,
            })
        }
        JsTestRunScope::File { relative_file_path } => (relative_file_path, None, false),
        JsTestRunScope::Suite {
            relative_file_path,
            full_name,
        } => (relative_file_path, Some(full_name), true),
        JsTestRunScope::Test {
            relative_file_path,
            full_name,
            name_match,
        } => (
            relative_file_path,
            Some(full_name),
            matches!(name_match, Some(JsTestNameMatch::Prefix)),
        ),
    };
    let relative_file_path = validated_test_file(root, relative_file_path)?;
    let name_pattern = full_name
        .map(|name| {
            if !is_valid_filter(name) {
                return Err("Invalid JavaScript test full name.".to_string());
            }
            let escaped = escape_test_filter(name);
            Ok(if suite {
                format!(r"^{escaped}(?: |$)")
            } else {
                format!(r"^{escaped}$")
            })
        })
        .transpose()?;
    Ok(JsTestRunSelection {
        relative_file_path: Some(relative_file_path),
        name_pattern,
    })
}

fn validated_test_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("JavaScript test file path must stay inside the workspace.".to_string());
    }
    let canonical = root
        .join(relative_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve JavaScript test file: {error}"))?;
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve JavaScript test package root: {error}"))?;
    if !canonical.starts_with(canonical_root) || !canonical.is_file() {
        return Err("JavaScript test file path must stay inside the workspace.".to_string());
    }
    Ok(relative_path.to_path_buf())
}

fn execute_runner(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    filter: Option<&str>,
) -> Result<Vec<u8>, String> {
    execute_runner_with_args(runner, root, runner_args(runner, result_path, filter), None)
}

fn execute_scoped_runner_retained(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    selection: &JsTestRunSelection,
    authority: RetainedJsTestProcessAuthority,
) -> Result<Vec<u8>, String> {
    execute_scoped_runner_with_authority(runner, root, result_path, selection, Some(authority))
}

fn execute_scoped_runner_with_authority(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    selection: &JsTestRunSelection,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<Vec<u8>, String> {
    execute_runner_with_args(
        runner,
        root,
        scoped_runner_args(runner, result_path, selection),
        authority,
    )
}

fn execute_runner_with_args(
    runner: &JsTestRunner,
    root: &Path,
    args: Vec<String>,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<Vec<u8>, String> {
    let binary = match runner {
        JsTestRunner::Vitest(binary) => binary,
        JsTestRunner::Jest(binary) => binary,
    };
    execute_runner_with_timeout_retained(binary, root, args, RUNNER_TIMEOUT, authority)
}

#[cfg(test)]
fn execute_runner_with_timeout(
    binary: &Path,
    root: &Path,
    args: Vec<String>,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    execute_runner_with_timeout_retained(binary, root, args, timeout, None)
}

pub(super) fn execute_runner_with_timeout_retained(
    binary: &Path,
    root: &Path,
    args: Vec<String>,
    timeout: Duration,
    authority: Option<RetainedJsTestProcessAuthority>,
) -> Result<Vec<u8>, String> {
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
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run JavaScript tests: {error}"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "JavaScript test runner has no stderr pipe.".to_string())?;
    let stderr_reader = thread::spawn(move || bounded_output_tail(stderr, ERROR_TAIL_BYTES));
    let deadline = Instant::now() + timeout;
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("Failed to inspect JavaScript test runner: {error}"))?
            .is_some()
        {
            return stderr_reader
                .join()
                .map_err(|_| "JavaScript test stderr reader failed.".to_string());
        }
        if Instant::now() >= deadline {
            #[cfg(unix)]
            crate::debug_support::DebugProcessHandle::from_process_id(child.id()).terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(format!(
                "JavaScript test runner timed out after {} seconds.",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn runner_args(runner: &JsTestRunner, result_path: &Path, filter: Option<&str>) -> Vec<String> {
    let result = result_path.to_string_lossy().into_owned();
    let mut args = match runner {
        JsTestRunner::Vitest(_) => vec![
            "run".to_string(),
            "--reporter=json".to_string(),
            format!("--outputFile={result}"),
        ],
        JsTestRunner::Jest(_) => vec![
            "--json".to_string(),
            format!("--outputFile={result}"),
            "--testLocationInResults".to_string(),
        ],
    };
    if let Some(filter) = filter {
        args.push("-t".to_string());
        args.push(escape_test_filter(filter));
    }
    args
}

fn scoped_runner_args(
    runner: &JsTestRunner,
    result_path: &Path,
    selection: &JsTestRunSelection,
) -> Vec<String> {
    let mut args = runner_args(runner, result_path, None);
    if let Some(relative_file_path) = &selection.relative_file_path {
        if matches!(runner, JsTestRunner::Jest(_)) {
            args.push("--runTestsByPath".to_string());
        }
        args.push(relative_file_path.to_string_lossy().into_owned());
    }
    if let Some(name_pattern) = &selection.name_pattern {
        args.push("-t".to_string());
        args.push(name_pattern.clone());
    }
    args
}

fn escape_test_filter(filter: &str) -> String {
    let mut escaped = String::with_capacity(filter.len());
    for character in filter.chars() {
        if matches!(
            character,
            '.' | '^' | '$' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn is_valid_filter(filter: &str) -> bool {
    if filter.is_empty() {
        return false;
    }
    !filter
        .bytes()
        .any(|byte| matches!(byte, 0x00..=0x1f | 0x7f))
}

fn parse_jest_json(json: &[u8], root: &Path) -> Result<PhpTestRunResponse, String> {
    parse_jest_json_with_limits(json, root, MAX_SUITES, MAX_CASES)
}

fn parse_jest_json_with_limits(
    json: &[u8],
    root: &Path,
    max_suites: usize,
    max_cases: usize,
) -> Result<PhpTestRunResponse, String> {
    let report: JestReport = serde_json::from_slice(json).map_err(|error| error.to_string())?;
    if report.test_results.len() > max_suites {
        return Err(format!(
            "JavaScript test report contains {} suites; the remaining batch safety limit is {max_suites}.",
            report.test_results.len()
        ));
    }
    let reported_cases = report
        .test_results
        .iter()
        .map(|file| {
            file.assertion_results
                .len()
                .max(usize::from(file.status.as_deref() == Some("failed")))
        })
        .sum::<usize>();
    if reported_cases > max_cases {
        return Err(format!(
            "JavaScript test report contains {reported_cases} cases; the remaining batch safety limit is {max_cases}."
        ));
    }
    let mut suites = Vec::new();
    let mut totals = PhpTestTotals::default();
    let mut retained_cases = 0usize;
    for file in report.test_results {
        suites.push(build_suite(file, root, &mut totals, &mut retained_cases));
    }
    validate_projected_test_text(&suites)?;
    Ok(PhpTestRunResponse::Ok { suites, totals })
}

fn build_suite(
    file: JestFileResult,
    root: &Path,
    totals: &mut PhpTestTotals,
    retained_cases: &mut usize,
) -> PhpTestSuite {
    let relative = relative_label(file.name.as_deref(), root);
    let mut suite = PhpTestSuite {
        name: relative.clone(),
        tests: Some(0),
        failures: Some(0),
        errors: Some(0),
        skipped: Some(0),
        time: None,
        cases: Vec::new(),
    };
    if file.assertion_results.is_empty() && file.status.as_deref() == Some("failed") {
        let case = PhpTestCase {
            name: relative.clone(),
            classname: relative,
            file: file.name,
            line: None,
            time: None,
            status: PhpTestStatus::Error,
            message: file
                .message
                .map(|message| message.trim().to_string())
                .filter(|message| !message.is_empty()),
        };
        record_case(case, &mut suite, totals, retained_cases);
        return suite;
    }
    for assertion in file.assertion_results {
        let case = case_from_assertion(assertion, relative.as_deref(), file.name.as_deref());
        record_case(case, &mut suite, totals, retained_cases);
    }
    suite
}

fn case_from_assertion(
    assertion: JestAssertionResult,
    classname: Option<&str>,
    file: Option<&str>,
) -> PhpTestCase {
    let message = assertion.failure_messages.join("\n");
    let message = message.trim();
    PhpTestCase {
        name: assertion.full_name.or(assertion.title),
        classname: classname.map(str::to_string),
        file: file.map(str::to_string),
        line: assertion.location.and_then(|location| location.line),
        time: assertion.duration.map(|duration| duration / 1_000.0),
        status: case_status(assertion.status.as_deref()),
        message: (!message.is_empty()).then(|| message.to_string()),
    }
}

fn case_status(status: Option<&str>) -> PhpTestStatus {
    match status {
        Some("passed") => PhpTestStatus::Passed,
        Some("failed") => PhpTestStatus::Failed,
        _ => PhpTestStatus::Skipped,
    }
}

fn record_case(
    case: PhpTestCase,
    suite: &mut PhpTestSuite,
    totals: &mut PhpTestTotals,
    retained_cases: &mut usize,
) {
    totals.tests += 1;
    suite.tests = Some(suite.tests.unwrap_or(0) + 1);
    match case.status {
        PhpTestStatus::Failed => {
            totals.failures += 1;
            suite.failures = Some(suite.failures.unwrap_or(0) + 1);
        }
        PhpTestStatus::Error => {
            totals.errors += 1;
            suite.errors = Some(suite.errors.unwrap_or(0) + 1);
        }
        PhpTestStatus::Skipped => {
            totals.skipped += 1;
            suite.skipped = Some(suite.skipped.unwrap_or(0) + 1);
        }
        PhpTestStatus::Passed => {}
    }
    if let Some(time) = case.time {
        totals.time = Some(totals.time.unwrap_or(0.0) + time);
        suite.time = Some(suite.time.unwrap_or(0.0) + time);
    }
    if *retained_cases >= MAX_CASES {
        return;
    }
    suite.cases.push(case);
    *retained_cases += 1;
}

fn relative_label(path: Option<&str>, root: &Path) -> Option<String> {
    let path = path?;
    let relative = Path::new(path)
        .strip_prefix(root)
        .unwrap_or(Path::new(path));
    Some(relative.to_string_lossy().into_owned())
}

fn with_stderr_tail(message: String, stderr: &[u8]) -> String {
    let start = stderr.len().saturating_sub(ERROR_TAIL_BYTES);
    let tail = String::from_utf8_lossy(&stderr[start..]).trim().to_string();
    if tail.is_empty() {
        return message;
    }
    format!("{message}\n{tail}")
}

#[cfg(test)]
mod tests {
    use super::{
        detect_runner, ensure_registered_root_identity, escape_test_filter,
        execute_runner_with_timeout, is_valid_filter, parse_jest_json, run_js_tests_blocking_with,
        run_js_tests_scoped_blocking_with, runner_args, scoped_runner_args, selection_for_scope,
        JsTestNameMatch, JsTestRunScope, JsTestRunSelection, JsTestRunner, ERROR_TAIL_BYTES,
        MAX_CASES, MAX_PACKAGE_JSON_BYTES, MAX_REPORT_BYTES, MAX_SUITES,
    };
    use crate::php_test_run::{PhpTestRunResponse, PhpTestStatus, PhpTestSuite, PhpTestTotals};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn temp_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "mockor-js-test-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("create temp directory");
        path
    }

    fn install_fake_binary(root: &Path, name: &str) -> PathBuf {
        let binary = root.join("node_modules").join(".bin").join(name);
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create bin directory");
        fs::write(&binary, "#!/bin/sh\n").expect("write binary");
        make_executable(&binary);
        binary
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("make executable");
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &Path) {}

    fn parse_ok(json: &str, root: &Path) -> (Vec<PhpTestSuite>, PhpTestTotals) {
        match parse_jest_json(json.as_bytes(), root).expect("parse report") {
            PhpTestRunResponse::Ok { suites, totals } => (suites, totals),
            response => panic!("unexpected response: {response:?}"),
        }
    }

    #[test]
    fn js_test_builds_vitest_args_with_and_without_filter() {
        let result = Path::new("/results/report.json");
        let runner = JsTestRunner::Vitest(PathBuf::from("node_modules/.bin/vitest"));
        assert_eq!(
            runner_args(&runner, result, None),
            [
                "run",
                "--reporter=json",
                "--outputFile=/results/report.json"
            ]
        );
        assert_eq!(
            runner_args(&runner, result, Some("renders (fast).")),
            [
                "run",
                "--reporter=json",
                "--outputFile=/results/report.json",
                "-t",
                "renders \\(fast\\)\\.",
            ]
        );
    }

    #[test]
    fn js_test_builds_jest_args_with_and_without_filter() {
        let result = Path::new("/results/report.json");
        let runner = JsTestRunner::Jest(PathBuf::from("node_modules/.bin/jest"));
        assert_eq!(
            runner_args(&runner, result, None),
            [
                "--json",
                "--outputFile=/results/report.json",
                "--testLocationInResults"
            ]
        );
        assert_eq!(
            runner_args(&runner, result, Some("renders (fast).")),
            [
                "--json",
                "--outputFile=/results/report.json",
                "--testLocationInResults",
                "-t",
                "renders \\(fast\\)\\.",
            ]
        );
    }

    #[test]
    fn js_test_scoped_args_include_the_exact_file() {
        let result = Path::new("/results/report.json");
        let selection = JsTestRunSelection {
            relative_file_path: Some(PathBuf::from("src/math.test.ts")),
            name_pattern: None,
        };
        assert_eq!(
            scoped_runner_args(
                &JsTestRunner::Vitest(PathBuf::from("node_modules/.bin/vitest")),
                result,
                &selection,
            ),
            [
                "run",
                "--reporter=json",
                "--outputFile=/results/report.json",
                "src/math.test.ts",
            ]
        );
        assert_eq!(
            scoped_runner_args(
                &JsTestRunner::Jest(PathBuf::from("node_modules/.bin/jest")),
                result,
                &selection,
            ),
            [
                "--json",
                "--outputFile=/results/report.json",
                "--testLocationInResults",
                "--runTestsByPath",
                "src/math.test.ts",
            ]
        );
    }

    #[test]
    fn js_test_scopes_use_anchored_and_escaped_name_patterns() {
        let root = temp_directory("scoped-patterns");
        fs::write(root.join("math.test.ts"), "test('adds (fast)', () => {})")
            .expect("write test file");
        let canonical_root = root.canonicalize().expect("canonical root");

        let suite = selection_for_scope(
            &canonical_root,
            &JsTestRunScope::Suite {
                relative_file_path: "math.test.ts".to_string(),
                full_name: "math (fast)".to_string(),
            },
        )
        .expect("suite selection");
        assert_eq!(
            suite.name_pattern.as_deref(),
            Some(r"^math \(fast\)(?: |$)")
        );

        let test = selection_for_scope(
            &canonical_root,
            &JsTestRunScope::Test {
                relative_file_path: "math.test.ts".to_string(),
                full_name: "math adds (fast)".to_string(),
                name_match: None,
            },
        )
        .expect("test selection");
        assert_eq!(test.name_pattern.as_deref(), Some(r"^math adds \(fast\)$"));

        let parameterized = selection_for_scope(
            &canonical_root,
            &JsTestRunScope::Test {
                relative_file_path: "math.test.ts".to_string(),
                full_name: "math case".to_string(),
                name_match: Some(JsTestNameMatch::Prefix),
            },
        )
        .expect("parameterized selection");
        assert_eq!(
            parameterized.name_pattern.as_deref(),
            Some(r"^math case(?: |$)")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_scope_rejects_traversal_and_missing_files() {
        let root = temp_directory("scoped-invalid-path");
        let canonical_root = root.canonicalize().expect("canonical root");
        for relative_file_path in [
            "",
            "../outside.test.ts",
            "/outside.test.ts",
            "missing.test.ts",
        ] {
            assert!(selection_for_scope(
                &canonical_root,
                &JsTestRunScope::File {
                    relative_file_path: relative_file_path.to_string(),
                },
            )
            .is_err());
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_scope_deserialization_is_strict() {
        let scope: JsTestRunScope = serde_json::from_str(
            r#"{"kind":"test","relativeFilePath":"math.test.ts","fullName":"math adds"}"#,
        )
        .expect("deserialize test scope");
        assert!(matches!(scope, JsTestRunScope::Test { .. }));
        let prefix: JsTestRunScope = serde_json::from_str(
            r#"{"kind":"test","relativeFilePath":"math.test.ts","fullName":"math case","nameMatch":"prefix"}"#,
        )
        .expect("deserialize prefix match");
        assert!(matches!(
            prefix,
            JsTestRunScope::Test {
                name_match: Some(JsTestNameMatch::Prefix),
                ..
            }
        ));
        assert!(serde_json::from_str::<JsTestRunScope>(
            r#"{"kind":"file","relativeFilePath":"math.test.ts","extra":true}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<JsTestRunScope>(
            r#"{"kind":"test","relativeFilePath":"math.test.ts"}"#,
        )
        .is_err());
    }

    #[test]
    fn js_test_scope_rejects_control_characters_in_full_names() {
        let root = temp_directory("scoped-invalid-name");
        fs::write(root.join("math.test.ts"), "test('math', () => {})").expect("write test file");
        let result = selection_for_scope(
            &root.canonicalize().expect("canonical root"),
            &JsTestRunScope::Test {
                relative_file_path: "math.test.ts".to_string(),
                full_name: "math\nadds".to_string(),
                name_match: None,
            },
        );
        assert!(matches!(result, Err(message) if message.contains("full name")));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn js_test_scope_rejects_a_symlink_that_escapes_the_workspace() {
        use std::os::unix::fs::symlink;

        let root = temp_directory("scoped-symlink-root");
        let outside = temp_directory("scoped-symlink-outside");
        fs::write(outside.join("outside.test.ts"), "test('outside', () => {})")
            .expect("write outside test");
        symlink(outside.join("outside.test.ts"), root.join("linked.test.ts"))
            .expect("link outside test");

        let result = selection_for_scope(
            &root.canonicalize().expect("canonical root"),
            &JsTestRunScope::File {
                relative_file_path: "linked.test.ts".to_string(),
            },
        );
        assert!(matches!(result, Err(message) if message.contains("inside the workspace")));
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn js_test_scoped_run_passes_the_validated_selection_to_the_runner() {
        let root = temp_directory("scoped-run");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        fs::write(root.join("math.test.ts"), "test('adds', () => {})").expect("write test");
        install_fake_binary(&root, "vitest");
        let app_data = root.join("app-data");
        let response = run_js_tests_scoped_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            &JsTestRunScope::Test {
                relative_file_path: "math.test.ts".to_string(),
                full_name: "math adds".to_string(),
                name_match: None,
            },
            |_, _, result_path, selection| {
                assert_eq!(
                    selection.relative_file_path.as_deref(),
                    Some(Path::new("math.test.ts"))
                );
                assert_eq!(selection.name_pattern.as_deref(), Some("^math adds$"));
                fs::write(result_path, br#"{"testResults": []}"#).expect("write result");
                Ok(Vec::new())
            },
        );
        assert!(matches!(response, PhpTestRunResponse::Ok { .. }));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_escapes_filter_regex_metacharacters() {
        for (filter, expected) in [
            ("has.dot", "has\\.dot"),
            ("has(parens)", "has\\(parens\\)"),
            ("has/slash\\backslash", "has/slash\\\\backslash"),
            ("anchors^$", "anchors\\^\\$"),
            ("quantifiers*+?", "quantifiers\\*\\+\\?"),
            ("classes[]{}", "classes\\[\\]\\{\\}"),
            ("alternation|", "alternation\\|"),
            ("unicode žluťoučký", "unicode žluťoučký"),
            ("has spaces", "has spaces"),
        ] {
            assert_eq!(escape_test_filter(filter), expected);
        }
    }

    #[test]
    fn js_test_validates_description_filters() {
        for (filter, expected) in [
            ("", false),
            ("it does something", true),
            ("dataset #1 (fast)!", true),
            ("line\nfeed", false),
            ("tab\tcharacter", false),
            ("delete\u{7f}character", false),
            ("null\0character", false),
        ] {
            assert_eq!(is_valid_filter(filter), expected, "{filter:?}");
        }
    }

    #[test]
    fn js_test_rejects_control_character_filters_before_running() {
        let response = run_js_tests_blocking_with(
            "/missing/workspace",
            Path::new("/missing/app-data"),
            Some("renders\n"),
            |_, _, _, _| panic!("runner must not execute"),
        );

        assert_eq!(
            response,
            PhpTestRunResponse::Error {
                message: "Invalid JavaScript test filter.".to_string(),
            }
        );
    }

    #[test]
    fn js_test_detects_vitest_config_with_binary() {
        let root = temp_directory("vitest-config");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        install_fake_binary(&root, "vitest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Vitest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_detects_vitest_via_vite_config_and_dependency() {
        let root = temp_directory("vitest-vite-dependency");
        fs::write(root.join("vite.config.ts"), "export default {}").expect("write config");
        fs::write(
            root.join("package.json"),
            r#"{"devDependencies":{"vitest":"^3.0.0"}}"#,
        )
        .expect("write package.json");
        install_fake_binary(&root, "vitest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Vitest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_detects_vitest_dependency_without_config() {
        for section in ["dependencies", "devDependencies"] {
            let root = temp_directory(&format!("vitest-{section}-only"));
            fs::write(
                root.join("package.json"),
                format!(r#"{{"{section}":{{"vitest":"^3.0.0"}}}}"#),
            )
            .expect("write package.json");
            install_fake_binary(&root, "vitest");

            assert!(matches!(
                detect_runner(&root).expect("detect"),
                Some(JsTestRunner::Vitest(_))
            ));

            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[test]
    fn js_test_ignores_vite_config_without_vitest_dependency() {
        let root = temp_directory("vite-without-vitest");
        fs::write(root.join("vite.config.ts"), "export default {}").expect("write config");
        fs::write(root.join("package.json"), r#"{"dependencies":{}}"#).expect("write package.json");
        install_fake_binary(&root, "vitest");
        assert_eq!(detect_runner(&root).expect("detect"), None);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_rejects_oversized_package_json_before_parsing() {
        let root = temp_directory("oversized-package-json");
        let package = fs::File::create(root.join("package.json")).expect("create package.json");
        package
            .set_len(MAX_PACKAGE_JSON_BYTES + 1)
            .expect("size package.json");

        let error = detect_runner(&root).expect_err("oversized manifest must be actionable");

        assert!(error.contains("package.json"));
        assert!(error.contains("byte safety limit"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_ignores_malformed_package_json_for_manifest_detection() {
        let root = temp_directory("malformed-package-json");
        fs::write(
            root.join("package.json"),
            r#"{"devDependencies":{"vitest":"#,
        )
        .expect("write package.json");
        install_fake_binary(&root, "vitest");

        assert_eq!(detect_runner(&root).expect("detect"), None);

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_detects_jest_config() {
        let root = temp_directory("jest-config");
        fs::write(root.join("jest.config.js"), "module.exports = {}").expect("write config");
        install_fake_binary(&root, "jest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Jest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_detects_jest_package_json_key() {
        let root = temp_directory("jest-package-key");
        fs::write(
            root.join("package.json"),
            r#"{"jest":{"preset":"ts-jest"}}"#,
        )
        .expect("write package.json");
        install_fake_binary(&root, "jest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Jest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_detects_jest_dev_dependency() {
        let root = temp_directory("jest-dev-dependency");
        fs::write(
            root.join("package.json"),
            r#"{"devDependencies":{"jest":"^29.0.0"}}"#,
        )
        .expect("write package.json");
        install_fake_binary(&root, "jest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Jest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_prefers_vitest_over_jest() {
        let root = temp_directory("vitest-priority");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        fs::write(root.join("jest.config.js"), "module.exports = {}").expect("write config");
        install_fake_binary(&root, "vitest");
        install_fake_binary(&root, "jest");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Vitest(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_prefers_explicit_jest_config_over_vitest_dependency() {
        let root = temp_directory("jest-config-with-vitest-dependency");
        fs::write(
            root.join("package.json"),
            r#"{"devDependencies":{"vitest":"^3.0.0"}}"#,
        )
        .expect("write package.json");
        fs::write(root.join("jest.config.js"), "module.exports = {};").expect("write jest config");
        install_fake_binary(&root, "jest");

        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(JsTestRunner::Jest(_))
        ));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_reports_missing_binary_as_unavailable() {
        let root = temp_directory("vitest-missing-binary");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        let app_data = root.join("app-data");
        let response = run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, _, _| panic!("runner must not execute"),
        );
        assert_eq!(
            response,
            PhpTestRunResponse::Unavailable {
                message: "No JavaScript test runner is available in this workspace.".to_string()
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_reports_missing_runner_as_unavailable() {
        let root = temp_directory("missing-runner");
        let app_data = root.join("app-data");
        let response = run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, _, _| panic!("runner must not execute"),
        );
        assert_eq!(
            response,
            PhpTestRunResponse::Unavailable {
                message: "No JavaScript test runner is available in this workspace.".to_string()
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_parses_passing_report_with_relative_suite_names() {
        let root = Path::new("/workspace/project");
        let (suites, totals) = parse_ok(
            r#"{
                "numTotalTests": 1,
                "numPassedTests": 1,
                "numFailedTests": 0,
                "numPendingTests": 0,
                "testResults": [{
                    "name": "/workspace/project/src/example.test.ts",
                    "status": "passed",
                    "assertionResults": [{
                        "title": "works",
                        "fullName": "example works",
                        "status": "passed",
                        "duration": 250,
                        "failureMessages": []
                    }]
                }]
            }"#,
            root,
        );
        assert_eq!(suites[0].name.as_deref(), Some("src/example.test.ts"));
        let case = &suites[0].cases[0];
        assert_eq!(case.name.as_deref(), Some("example works"));
        assert_eq!(case.classname.as_deref(), Some("src/example.test.ts"));
        assert_eq!(
            case.file.as_deref(),
            Some("/workspace/project/src/example.test.ts")
        );
        assert_eq!(case.status, PhpTestStatus::Passed);
        assert_eq!(case.time, Some(0.25));
        assert_eq!(totals.tests, 1);
        assert_eq!(totals.failures, 0);
        assert_eq!(totals.time, Some(0.25));
    }

    #[test]
    fn js_test_parses_failure_messages_and_location() {
        let root = Path::new("/workspace/project");
        let (suites, totals) = parse_ok(
            r#"{
                "testResults": [{
                    "name": "/workspace/project/src/example.test.ts",
                    "status": "failed",
                    "assertionResults": [{
                        "title": "fails",
                        "fullName": "example fails",
                        "status": "failed",
                        "duration": 10,
                        "failureMessages": ["expected true", "stack trace"],
                        "location": {"line": 42, "column": 3}
                    }]
                }]
            }"#,
            root,
        );
        let case = &suites[0].cases[0];
        assert_eq!(case.status, PhpTestStatus::Failed);
        assert_eq!(case.line, Some(42));
        assert_eq!(case.message.as_deref(), Some("expected true\nstack trace"));
        assert_eq!(totals.failures, 1);
        assert_eq!(suites[0].failures, Some(1));
    }

    #[test]
    fn js_test_maps_pending_todo_and_disabled_statuses_to_skipped() {
        let root = Path::new("/workspace/project");
        let (suites, totals) = parse_ok(
            r#"{
                "testResults": [{
                    "name": "/workspace/project/src/example.test.ts",
                    "status": "passed",
                    "assertionResults": [
                        {"fullName": "a", "status": "pending", "failureMessages": []},
                        {"fullName": "b", "status": "skipped", "failureMessages": []},
                        {"fullName": "c", "status": "todo", "failureMessages": []},
                        {"fullName": "d", "status": "disabled", "failureMessages": []}
                    ]
                }]
            }"#,
            root,
        );
        assert!(suites[0]
            .cases
            .iter()
            .all(|case| case.status == PhpTestStatus::Skipped));
        assert_eq!(totals.skipped, 4);
        assert_eq!(totals.tests, 4);
    }

    #[test]
    fn js_test_reports_file_level_failure_as_error_case() {
        let root = Path::new("/workspace/project");
        let (suites, totals) = parse_ok(
            r#"{
                "testResults": [{
                    "name": "/workspace/project/src/broken.test.ts",
                    "status": "failed",
                    "message": "SyntaxError: unexpected token",
                    "assertionResults": []
                }]
            }"#,
            root,
        );
        let case = &suites[0].cases[0];
        assert_eq!(case.status, PhpTestStatus::Error);
        assert_eq!(case.name.as_deref(), Some("src/broken.test.ts"));
        assert_eq!(
            case.message.as_deref(),
            Some("SyntaxError: unexpected token")
        );
        assert_eq!(totals.errors, 1);
        assert_eq!(totals.tests, 1);
    }

    #[test]
    fn js_test_rejects_malformed_json() {
        assert!(parse_jest_json(b"{\"testResults\": [", Path::new("/root")).is_err());
        assert!(parse_jest_json(b" \n\t", Path::new("/root")).is_err());
    }

    #[test]
    fn js_test_rejects_reports_above_the_case_safety_limit() {
        let mut json = String::from(
            r#"{"testResults": [{"name": "/root/big.test.ts", "status": "passed", "assertionResults": ["#,
        );
        for index in 0..MAX_CASES + 7 {
            if index > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                r#"{{"fullName": "case-{index}", "status": "passed", "failureMessages": []}}"#
            ));
        }
        json.push_str("]}]}");
        let error = parse_jest_json(json.as_bytes(), Path::new("/root"))
            .expect_err("oversized case list must not be partially returned");
        assert!(error.contains("5007 cases"));
        assert!(error.contains("safety limit is 5000"));
    }

    #[test]
    fn js_test_rejects_empty_suites_above_the_suite_safety_limit() {
        let empty_suite = r#"{"status":"passed","assertionResults":[]}"#;
        let mut json = String::from(r#"{"testResults":["#);
        for index in 0..MAX_SUITES + 1 {
            if index > 0 {
                json.push(',');
            }
            json.push_str(empty_suite);
        }
        json.push_str("]}");

        let error = parse_jest_json(json.as_bytes(), Path::new("/root"))
            .expect_err("empty suites must not bypass resource limits");

        assert!(error.contains("5001 suites"));
        assert!(error.contains("safety limit is 5000"));
    }

    #[cfg(unix)]
    #[test]
    fn js_test_runner_capture_is_bounded_without_competing_with_the_timeout_contract() {
        let root = temp_directory("runner-bounds");
        let noisy = root.join("noisy.sh");
        fs::write(&noisy, "#!/bin/sh\nprintf '%010000d' 0 >&2\n").expect("write noisy runner");
        make_executable(&noisy);
        let stderr =
            execute_runner_with_timeout(&noisy, &root, vec![], std::time::Duration::from_secs(30))
                .expect("bounded runner");
        assert_eq!(stderr.len(), ERROR_TAIL_BYTES);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn js_test_runner_timeout_kills_the_process() {
        let root = temp_directory("runner-timeout");
        let slow = root.join("slow.sh");
        fs::write(&slow, "#!/bin/sh\nsleep 5\n").expect("write slow runner");
        make_executable(&slow);
        let started = std::time::Instant::now();
        let error =
            execute_runner_with_timeout(&slow, &root, vec![], std::time::Duration::from_millis(50))
                .expect_err("runner must time out");
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn js_test_rejects_a_replaced_registered_workspace_path() {
        let parent = temp_directory("registered-identity");
        let root = parent.join("workspace");
        let displaced = parent.join("displaced");
        fs::create_dir_all(&root).expect("create workspace");
        let root_fd = fs::File::open(&root).expect("open workspace root");
        fs::rename(&root, &displaced).expect("displace workspace");
        fs::create_dir_all(&root).expect("replace workspace path");

        let error = ensure_registered_root_identity(&root_fd, &root)
            .expect_err("replacement must not retain authority");

        assert!(error.contains("identity changed"));
        fs::remove_dir_all(parent).expect("cleanup");
    }

    #[test]
    fn js_test_rejects_a_report_above_the_byte_safety_limit() {
        let root = temp_directory("report-byte-cap");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        install_fake_binary(&root, "vitest");
        let app_data = root.join("app-data");
        let response = run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, result_path, _| {
                let file = fs::File::create(result_path).expect("create result");
                file.set_len(MAX_REPORT_BYTES + 1).expect("size result");
                Ok(Vec::new())
            },
        );
        assert!(matches!(
            response,
            PhpTestRunResponse::Error { message } if message.contains("byte safety limit")
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn run_with_report(root: &Path, app_data: &Path, report: &[u8]) -> PhpTestRunResponse {
        run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            app_data,
            None,
            |_, _, result_path, _| {
                fs::write(result_path, report).expect("write result");
                Ok(Vec::new())
            },
        )
    }

    #[test]
    fn js_test_deletes_result_file_after_success() {
        let root = temp_directory("cleanup-success");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        install_fake_binary(&root, "vitest");
        let app_data = root.join("app-data");
        let response = run_with_report(&root, &app_data, br#"{"testResults": []}"#);
        assert!(matches!(response, PhpTestRunResponse::Ok { .. }));
        assert_eq!(
            fs::read_dir(app_data.join("js-test-results"))
                .expect("read results")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_deletes_result_file_after_parse_failure_and_includes_stderr() {
        let root = temp_directory("cleanup-failure");
        fs::write(root.join("jest.config.js"), "module.exports = {}").expect("write config");
        install_fake_binary(&root, "jest");
        let app_data = root.join("app-data");
        let response = run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, result_path, _| {
                fs::write(result_path, "{not json").expect("write result");
                Ok(b"runner stderr".to_vec())
            },
        );
        assert!(matches!(
            response,
            PhpTestRunResponse::Error { ref message }
                if message.contains("Failed to process JavaScript test report")
                    && message.contains("runner stderr")
        ));
        assert_eq!(
            fs::read_dir(app_data.join("js-test-results"))
                .expect("read results")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn js_test_reports_missing_result_file_with_stderr_tail() {
        let root = temp_directory("missing-result");
        fs::write(root.join("vitest.config.ts"), "export default {}").expect("write config");
        install_fake_binary(&root, "vitest");
        let app_data = root.join("app-data");
        let response = run_js_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, _, _| Ok(b"vitest exploded".to_vec()),
        );
        assert!(matches!(
            response,
            PhpTestRunResponse::Error { ref message }
                if message.contains("did not produce a readable JSON report")
                    && message.contains("vitest exploded")
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
