use crate::php_test_run::{
    PhpTestCase, PhpTestRunResponse, PhpTestStatus, PhpTestSuite, PhpTestTotals,
};
use crate::test_run_support::{
    is_executable_file, prepare_result_path_with_extension, ResultFileGuard,
};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_CASES: usize = 5_000;
const ERROR_TAIL_BYTES: usize = 4_000;
const RESULT_SUBDIRECTORY: &str = "js-test-results";
const RESULT_LABEL: &str = "JavaScript test result";
const VITEST_CONFIG_FILES: [&str; 6] = [
    "vitest.config.ts",
    "vitest.config.js",
    "vitest.config.mts",
    "vitest.config.mjs",
    "vitest.config.cts",
    "vitest.config.cjs",
];
const VITE_CONFIG_FILES: [&str; 6] = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
    "vite.config.cts",
    "vite.config.cjs",
];
const JEST_CONFIG_FILES: [&str; 5] = [
    "jest.config.js",
    "jest.config.ts",
    "jest.config.cjs",
    "jest.config.mjs",
    "jest.config.json",
];

#[derive(Clone, Debug, Eq, PartialEq)]
enum JsTestRunner {
    Vitest(PathBuf),
    Jest(PathBuf),
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

fn run_js_tests_blocking(
    root_path: &str,
    app_data_base: &Path,
    filter: Option<&str>,
) -> PhpTestRunResponse {
    run_js_tests_blocking_with(root_path, app_data_base, filter, execute_runner)
}

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

    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return PhpTestRunResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let runner = match detect_runner(&root) {
        Ok(Some(runner)) => runner,
        Ok(None) => {
            return PhpTestRunResponse::Unavailable {
                message: "No JavaScript test runner is available in this workspace.".to_string(),
            };
        }
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let result_path = match prepare_result_path_with_extension(
        app_data_base,
        RESULT_SUBDIRECTORY,
        RESULT_LABEL,
        "json",
    ) {
        Ok(path) => path,
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let guard = ResultFileGuard(result_path.clone());
    let stderr = match execute(&runner, &root, &result_path, filter) {
        Ok(stderr) => stderr,
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let json = match fs::read(&result_path) {
        Ok(json) => json,
        Err(error) => {
            return PhpTestRunResponse::Error {
                message: with_stderr_tail(
                    format!(
                        "JavaScript test runner did not produce a readable JSON report: {error}"
                    ),
                    &stderr,
                ),
            };
        }
    };
    let response = match parse_jest_json(&json, &root) {
        Ok(response) => response,
        Err(error) => PhpTestRunResponse::Error {
            message: with_stderr_tail(
                format!("Failed to parse test report JSON: {error}"),
                &stderr,
            ),
        },
    };
    drop(guard);
    response
}

fn execute_runner(
    runner: &JsTestRunner,
    root: &Path,
    result_path: &Path,
    filter: Option<&str>,
) -> Result<Vec<u8>, String> {
    let binary = match runner {
        JsTestRunner::Vitest(binary) => binary,
        JsTestRunner::Jest(binary) => binary,
    };
    Command::new(binary)
        .args(runner_args(runner, result_path, filter))
        .env("LC_ALL", "C")
        .current_dir(root)
        .output()
        .map(|output| output.stderr)
        .map_err(|error| format!("Failed to run JavaScript tests: {error}"))
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

fn detect_runner(root: &Path) -> Result<Option<JsTestRunner>, String> {
    let package = read_package_json(root);
    if uses_vitest(root, package.as_ref()) {
        return resolve_binary(root, "vitest").map(|binary| binary.map(JsTestRunner::Vitest));
    }
    if uses_jest(root, package.as_ref()) {
        return resolve_binary(root, "jest").map(|binary| binary.map(JsTestRunner::Jest));
    }
    Ok(None)
}

fn read_package_json(root: &Path) -> Option<Value> {
    let contents = fs::read(root.join("package.json")).ok()?;
    serde_json::from_slice(&contents).ok()
}

fn uses_vitest(root: &Path, package: Option<&Value>) -> bool {
    if has_config_file(root, &VITEST_CONFIG_FILES) {
        return true;
    }
    has_config_file(root, &VITE_CONFIG_FILES) && has_dependency(package, "vitest")
}

fn uses_jest(root: &Path, package: Option<&Value>) -> bool {
    if has_config_file(root, &JEST_CONFIG_FILES) {
        return true;
    }
    if package.is_some_and(|package| package.get("jest").is_some()) {
        return true;
    }
    has_dependency(package, "jest")
}

fn has_config_file(root: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| root.join(name).is_file())
}

fn has_dependency(package: Option<&Value>, name: &str) -> bool {
    let Some(package) = package else {
        return false;
    };
    ["dependencies", "devDependencies"].iter().any(|section| {
        package
            .get(section)
            .and_then(|dependencies| dependencies.get(name))
            .is_some()
    })
}

fn resolve_binary(root: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let candidate = root.join("node_modules").join(".bin").join(name);
    if !is_executable_file(&candidate) {
        return Ok(None);
    }
    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve {name} binary: {error}"))
}

fn parse_jest_json(json: &[u8], root: &Path) -> Result<PhpTestRunResponse, String> {
    let report: JestReport = serde_json::from_slice(json).map_err(|error| error.to_string())?;
    let mut suites = Vec::new();
    let mut totals = PhpTestTotals::default();
    let mut retained_cases = 0usize;
    for file in report.test_results {
        suites.push(build_suite(file, root, &mut totals, &mut retained_cases));
    }
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
        detect_runner, escape_test_filter, is_valid_filter, parse_jest_json,
        run_js_tests_blocking_with, runner_args, JsTestRunner, MAX_CASES,
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
    fn js_test_ignores_vite_config_without_vitest_dependency() {
        let root = temp_directory("vite-without-vitest");
        fs::write(root.join("vite.config.ts"), "export default {}").expect("write config");
        fs::write(root.join("package.json"), r#"{"dependencies":{}}"#).expect("write package.json");
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
    fn js_test_caps_cases_and_keeps_truthful_totals() {
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
        let (suites, totals) = parse_ok(&json, Path::new("/root"));
        assert_eq!(suites[0].cases.len(), MAX_CASES);
        assert_eq!(suites[0].tests, Some((MAX_CASES + 7) as u64));
        assert_eq!(totals.tests, (MAX_CASES + 7) as u64);
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
            PhpTestRunResponse::Error { ref message } if message.contains("runner stderr")
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
