use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CASES: usize = 5_000;
const ERROR_TAIL_BYTES: usize = 4_000;
static RESULT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpTestCase {
    pub name: Option<String>,
    pub classname: Option<String>,
    pub file: Option<String>,
    pub line: Option<u64>,
    pub time: Option<f64>,
    pub status: PhpTestStatus,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhpTestStatus {
    Passed,
    Failed,
    Error,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpTestSuite {
    pub name: Option<String>,
    pub tests: Option<u64>,
    pub failures: Option<u64>,
    pub errors: Option<u64>,
    pub skipped: Option<u64>,
    pub time: Option<f64>,
    pub cases: Vec<PhpTestCase>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpTestTotals {
    pub tests: u64,
    pub failures: u64,
    pub errors: u64,
    pub skipped: u64,
    pub time: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PhpTestRunResponse {
    Ok {
        suites: Vec<PhpTestSuite>,
        totals: PhpTestTotals,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TestRunner {
    Artisan,
    PhpUnit(PathBuf),
}

struct ResultFileGuard(PathBuf);

impl Drop for ResultFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

struct SuiteBuilder {
    suite: PhpTestSuite,
    direct_case_count: usize,
    has_child_suite: bool,
}

struct CaseBuilder {
    case: PhpTestCase,
    detail: Option<PhpTestStatus>,
    detail_message: Option<String>,
    detail_text: String,
    collecting_detail: bool,
}

pub async fn run_php_tests(
    root_path: String,
    app_data_base: PathBuf,
    filter: Option<String>,
) -> Result<PhpTestRunResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_php_tests_blocking(
            &root_path,
            &app_data_base,
            filter.as_deref(),
        ))
    })
    .await
}

fn run_php_tests_blocking(
    root_path: &str,
    app_data_base: &Path,
    filter: Option<&str>,
) -> PhpTestRunResponse {
    run_php_tests_blocking_with(root_path, app_data_base, filter, execute_runner)
}

fn run_php_tests_blocking_with<F>(
    root_path: &str,
    app_data_base: &Path,
    filter: Option<&str>,
    execute: F,
) -> PhpTestRunResponse
where
    F: FnOnce(&TestRunner, &Path, &Path, Option<&str>) -> Result<Vec<u8>, String>,
{
    if filter.is_some_and(|value| !is_valid_filter(value)) {
        return PhpTestRunResponse::Error {
            message: "Invalid PHP test filter.".to_string(),
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
                message: "No PHP test runner is available in this workspace.".to_string(),
            };
        }
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let result_path = match prepare_result_path(app_data_base) {
        Ok(path) => path,
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let guard = ResultFileGuard(result_path.clone());
    let stderr = match execute(&runner, &root, &result_path, filter) {
        Ok(stderr) => stderr,
        Err(message) => return PhpTestRunResponse::Error { message },
    };
    let xml = match fs::read(&result_path) {
        Ok(xml) => xml,
        Err(error) => {
            return PhpTestRunResponse::Error {
                message: with_stderr_tail(
                    format!("PHP test runner did not produce readable JUnit XML: {error}"),
                    &stderr,
                ),
            };
        }
    };
    let response = match parse_junit(&xml) {
        Ok(response) => response,
        Err(error) => PhpTestRunResponse::Error {
            message: with_stderr_tail(format!("Failed to parse JUnit XML: {error}"), &stderr),
        },
    };
    drop(guard);
    response
}

fn execute_runner(
    runner: &TestRunner,
    root: &Path,
    result_path: &Path,
    filter: Option<&str>,
) -> Result<Vec<u8>, String> {
    let args = runner_args(runner, result_path, filter);
    let output = match runner {
        TestRunner::Artisan => Command::new("php")
            .args(args)
            .env("LC_ALL", "C")
            .current_dir(root)
            .output(),
        TestRunner::PhpUnit(binary) => Command::new(binary)
            .args(args)
            .env("LC_ALL", "C")
            .current_dir(root)
            .output(),
    };
    output
        .map(|output| output.stderr)
        .map_err(|error| format!("Failed to run PHP tests: {error}"))
}

fn runner_args(runner: &TestRunner, result_path: &Path, filter: Option<&str>) -> Vec<String> {
    let result = result_path.to_string_lossy().into_owned();
    let mut args = match runner {
        TestRunner::Artisan => vec![
            "artisan".to_string(),
            "test".to_string(),
            "--log-junit".to_string(),
            result,
            "--no-interaction".to_string(),
        ],
        TestRunner::PhpUnit(_) => vec![
            "--log-junit".to_string(),
            result,
            "--no-interaction".to_string(),
        ],
    };
    if let Some(filter) = filter {
        args.push("--filter".to_string());
        args.push(format!("{}$", escape_test_filter(filter)));
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

fn detect_runner(root: &Path) -> Result<Option<TestRunner>, String> {
    if root.join("artisan").is_file() {
        return Ok(Some(TestRunner::Artisan));
    }
    let candidate = root.join("vendor").join("bin").join("phpunit");
    if !is_executable_file(&candidate) {
        return Ok(None);
    }
    candidate
        .canonicalize()
        .map(TestRunner::PhpUnit)
        .map(Some)
        .map_err(|error| format!("Failed to resolve PHPUnit binary: {error}"))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn prepare_result_path(app_data_base: &Path) -> Result<PathBuf, String> {
    let directory = app_data_base.join("php-test-results");
    ensure_private_directory(&directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to create JUnit result filename: {error}"))?
        .as_nanos();
    let sequence = RESULT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(directory.join(format!("{}-{timestamp}-{sequence}.xml", std::process::id())))
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create PHP test result directory: {error}"))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect PHP test result directory: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("PHP test result path is not a private directory.".to_string());
    }
    set_private_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Failed to secure PHP test result directory: {error}"))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn parse_junit(xml: &[u8]) -> Result<PhpTestRunResponse, String> {
    if xml.iter().all(u8::is_ascii_whitespace) {
        return Err("JUnit XML is empty.".to_string());
    }
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut suites = Vec::new();
    let mut stack: Vec<SuiteBuilder> = Vec::new();
    let mut current_case: Option<CaseBuilder> = None;
    let mut totals = PhpTestTotals::default();
    let mut retained_cases = 0;
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(start)) if start.name().as_ref() == b"testsuite" => {
                if let Some(parent) = stack.last_mut() {
                    parent.has_child_suite = true;
                }
                stack.push(suite_from_start(&reader, &start)?);
            }
            Ok(Event::Empty(start)) if start.name().as_ref() == b"testsuite" => {
                let suite = suite_from_start(&reader, &start)?.suite;
                suites.push(suite);
            }
            Ok(Event::Start(start)) if start.name().as_ref() == b"testcase" => {
                current_case = Some(case_from_start(&reader, &start)?);
            }
            Ok(Event::Empty(start)) if start.name().as_ref() == b"testcase" => {
                let case = case_from_start(&reader, &start)?.case;
                finish_case(case, &mut stack, &mut totals, &mut retained_cases)?;
            }
            Ok(Event::Start(start)) if is_detail(start.name().as_ref()) => {
                begin_detail(&reader, &start, &mut current_case)?;
                if let Some(case) = current_case.as_mut() {
                    case.collecting_detail = true;
                }
            }
            Ok(Event::Empty(start)) if is_detail(start.name().as_ref()) => {
                begin_detail(&reader, &start, &mut current_case)?;
            }
            Ok(Event::Text(text)) => {
                if let Some(case) = current_case.as_mut().filter(|case| case.collecting_detail) {
                    let decoded = text.decode().map_err(|error| error.to_string())?;
                    case.detail_text.push_str(&decoded);
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some(case) = current_case.as_mut().filter(|case| case.collecting_detail) {
                    let name = reference.decode().map_err(|error| error.to_string())?;
                    let encoded = format!("&{name};");
                    let decoded =
                        quick_xml::escape::unescape(&encoded).map_err(|error| error.to_string())?;
                    case.detail_text.push_str(&decoded);
                }
            }
            Ok(Event::CData(text)) => {
                if let Some(case) = current_case.as_mut().filter(|case| case.collecting_detail) {
                    case.detail_text
                        .push_str(&text.decode().map_err(|error| error.to_string())?);
                }
            }
            Ok(Event::End(end)) if is_detail(end.name().as_ref()) => {
                if let Some(case) = current_case.as_mut() {
                    case.collecting_detail = false;
                }
            }
            Ok(Event::End(end)) if end.name().as_ref() == b"testcase" => {
                let builder = current_case
                    .take()
                    .ok_or_else(|| "JUnit testcase ended without a start.".to_string())?;
                finish_case(
                    finish_case_builder(builder),
                    &mut stack,
                    &mut totals,
                    &mut retained_cases,
                )?;
            }
            Ok(Event::End(end)) if end.name().as_ref() == b"testsuite" => {
                let builder = stack
                    .pop()
                    .ok_or_else(|| "JUnit testsuite ended without a start.".to_string())?;
                if builder.direct_case_count > 0 || !builder.has_child_suite {
                    suites.push(builder.suite);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }
    if current_case.is_some() || !stack.is_empty() {
        return Err("JUnit XML ended before all elements were closed.".to_string());
    }
    if suites.is_empty() {
        return Err("JUnit XML contains no test suites.".to_string());
    }
    Ok(PhpTestRunResponse::Ok { suites, totals })
}

fn suite_from_start(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
) -> Result<SuiteBuilder, String> {
    Ok(SuiteBuilder {
        suite: PhpTestSuite {
            name: attribute(reader, start, b"name")?,
            tests: number_attribute(reader, start, b"tests")?,
            failures: number_attribute(reader, start, b"failures")?,
            errors: number_attribute(reader, start, b"errors")?,
            skipped: number_attribute(reader, start, b"skipped")?,
            time: float_attribute(reader, start, b"time")?,
            cases: Vec::new(),
        },
        direct_case_count: 0,
        has_child_suite: false,
    })
}

fn case_from_start(reader: &Reader<&[u8]>, start: &BytesStart<'_>) -> Result<CaseBuilder, String> {
    Ok(CaseBuilder {
        case: PhpTestCase {
            name: attribute(reader, start, b"name")?,
            classname: attribute(reader, start, b"classname")?,
            file: attribute(reader, start, b"file")?,
            line: number_attribute(reader, start, b"line")?,
            time: float_attribute(reader, start, b"time")?,
            status: PhpTestStatus::Passed,
            message: None,
        },
        detail: None,
        detail_message: None,
        detail_text: String::new(),
        collecting_detail: false,
    })
}

fn begin_detail(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    current_case: &mut Option<CaseBuilder>,
) -> Result<(), String> {
    let case = current_case
        .as_mut()
        .ok_or_else(|| "JUnit result detail is outside a testcase.".to_string())?;
    case.detail = Some(match start.name().as_ref() {
        b"failure" => PhpTestStatus::Failed,
        b"error" => PhpTestStatus::Error,
        _ => PhpTestStatus::Skipped,
    });
    case.detail_message = attribute(reader, start, b"message")?;
    Ok(())
}

fn finish_case_builder(mut builder: CaseBuilder) -> PhpTestCase {
    if let Some(status) = builder.detail {
        builder.case.status = status;
    }
    let text = builder.detail_text.trim();
    builder.case.message = match (builder.detail_message, text.is_empty()) {
        (Some(message), false) => Some(format!("{message}\n{text}")),
        (Some(message), true) => Some(message),
        (None, false) => Some(text.to_string()),
        (None, true) => None,
    };
    builder.case
}

fn finish_case(
    case: PhpTestCase,
    stack: &mut [SuiteBuilder],
    totals: &mut PhpTestTotals,
    retained_cases: &mut usize,
) -> Result<(), String> {
    let suite = stack
        .last_mut()
        .ok_or_else(|| "JUnit testcase is outside a testsuite.".to_string())?;
    totals.tests += 1;
    match case.status {
        PhpTestStatus::Failed => totals.failures += 1,
        PhpTestStatus::Error => totals.errors += 1,
        PhpTestStatus::Skipped => totals.skipped += 1,
        PhpTestStatus::Passed => {}
    }
    if let Some(time) = case.time {
        totals.time = Some(totals.time.unwrap_or(0.0) + time);
    }
    suite.direct_case_count += 1;
    if *retained_cases < MAX_CASES {
        suite.suite.cases.push(case);
        *retained_cases += 1;
    }
    Ok(())
}

fn is_detail(name: &[u8]) -> bool {
    matches!(name, b"failure" | b"error" | b"skipped")
}

fn attribute(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    name: &[u8],
) -> Result<Option<String>, String> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if attribute.key.as_ref() != name {
            continue;
        }
        return attribute
            .decode_and_unescape_value(reader.decoder())
            .map(|value| Some(value.into_owned()))
            .map_err(|error| error.to_string());
    }
    Ok(None)
}

fn number_attribute(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    name: &[u8],
) -> Result<Option<u64>, String> {
    attribute(reader, start, name)?
        .map(|value| {
            value
                .parse()
                .map_err(|error| format!("Invalid numeric JUnit attribute: {error}"))
        })
        .transpose()
}

fn float_attribute(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    name: &[u8],
) -> Result<Option<f64>, String> {
    attribute(reader, start, name)?
        .map(|value| {
            value
                .parse()
                .map_err(|error| format!("Invalid JUnit time attribute: {error}"))
        })
        .transpose()
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
        detect_runner, escape_test_filter, is_valid_filter, parse_junit,
        run_php_tests_blocking_with, runner_args, PhpTestRunResponse, PhpTestStatus, TestRunner,
        MAX_CASES,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn temp_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "mockor-php-test-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("create temp directory");
        path
    }

    fn parse_ok(xml: &str) -> (Vec<super::PhpTestSuite>, super::PhpTestTotals) {
        match parse_junit(xml.as_bytes()).expect("parse junit") {
            PhpTestRunResponse::Ok { suites, totals } => (suites, totals),
            response => panic!("unexpected response: {response:?}"),
        }
    }

    #[test]
    fn php_test_builds_artisan_args_with_and_without_filter() {
        let result = Path::new("/results/junit.xml");
        assert_eq!(
            runner_args(&TestRunner::Artisan, result, None),
            [
                "artisan",
                "test",
                "--log-junit",
                "/results/junit.xml",
                "--no-interaction"
            ]
        );
        assert_eq!(
            runner_args(
                &TestRunner::Artisan,
                result,
                Some("it handles / paths (fast)."),
            ),
            [
                "artisan",
                "test",
                "--log-junit",
                "/results/junit.xml",
                "--no-interaction",
                "--filter",
                "it handles / paths \\(fast\\)\\.$",
            ]
        );
    }

    #[test]
    fn php_test_builds_phpunit_args_with_and_without_filter() {
        let result = Path::new("/results/junit.xml");
        let runner = TestRunner::PhpUnit(PathBuf::from("vendor/bin/phpunit"));
        assert_eq!(
            runner_args(&runner, result, None),
            ["--log-junit", "/results/junit.xml", "--no-interaction"]
        );
        assert_eq!(
            runner_args(&runner, result, Some("it handles / paths (fast).")),
            [
                "--log-junit",
                "/results/junit.xml",
                "--no-interaction",
                "--filter",
                "it handles / paths \\(fast\\)\\.$",
            ]
        );
    }

    #[test]
    fn php_test_escapes_filter_regex_metacharacters() {
        for (filter, expected) in [
            ("has.dot", "has\\.dot"),
            ("has(parens)", "has\\(parens\\)"),
            (r#"has"double'quotes"#, r#"has"double'quotes"#),
            ("has/slash\\backslash", "has/slash\\\\backslash"),
            ("anchors^$", "anchors\\^\\$"),
            ("quantifiers*+?", "quantifiers\\*\\+\\?"),
            ("classes[]{}", "classes\\[\\]\\{\\}"),
            ("alternation|", "alternation\\|"),
            ("unicode žluťoučký", "unicode žluťoučký"),
            ("dataset #1", "dataset #1"),
            ("has spaces", "has spaces"),
        ] {
            assert_eq!(escape_test_filter(filter), expected);
        }
    }

    #[test]
    fn php_test_validates_description_filters() {
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
    fn php_test_rejects_control_character_filters_before_running() {
        let response = run_php_tests_blocking_with(
            "/missing/workspace",
            Path::new("/missing/app-data"),
            Some("testItWorks\n"),
            |_, _, _, _| panic!("runner must not execute"),
        );

        assert_eq!(
            response,
            PhpTestRunResponse::Error {
                message: "Invalid PHP test filter.".to_string(),
            }
        );
    }

    #[test]
    fn php_test_parses_passing_suite() {
        let (suites, totals) = parse_ok(
            r#"<testsuite name="Unit" tests="1" failures="0" errors="0" skipped="0" time="0.25"><testcase name="works" classname="ExampleTest" time="0.25"/></testsuite>"#,
        );
        assert_eq!(suites[0].name.as_deref(), Some("Unit"));
        assert_eq!(suites[0].cases[0].status, PhpTestStatus::Passed);
        assert_eq!(totals.tests, 1);
        assert_eq!(totals.time, Some(0.25));
    }

    #[test]
    fn php_test_parses_failure_message_file_and_line() {
        let (suites, totals) = parse_ok(
            r#"<testsuite><testcase name="fails" classname="ExampleTest" file="tests/ExampleTest.php" line="42"><failure message="Expected &lt;true&gt;"><![CDATA[stack <trace>]]></failure></testcase></testsuite>"#,
        );
        let case = &suites[0].cases[0];
        assert_eq!(case.file.as_deref(), Some("tests/ExampleTest.php"));
        assert_eq!(case.line, Some(42));
        assert_eq!(case.status, PhpTestStatus::Failed);
        assert_eq!(
            case.message.as_deref(),
            Some("Expected <true>\nstack <trace>")
        );
        assert_eq!(totals.failures, 1);
    }

    #[test]
    fn php_test_parses_errors_and_skips_with_missing_attributes() {
        let (suites, totals) = parse_ok(
            r#"<testsuite><testcase><error>boom &amp; bust</error></testcase><testcase><skipped message="not today"/></testcase></testsuite>"#,
        );
        assert_eq!(suites[0].name, None);
        assert_eq!(suites[0].cases[0].status, PhpTestStatus::Error);
        assert_eq!(suites[0].cases[0].message.as_deref(), Some("boom & bust"));
        assert_eq!(suites[0].cases[1].status, PhpTestStatus::Skipped);
        assert_eq!(totals.errors, 1);
        assert_eq!(totals.skipped, 1);
    }

    #[test]
    fn php_test_flattens_nested_suites_without_wrapper_totals() {
        let (suites, totals) = parse_ok(
            r#"<testsuites><testsuite name="root" tests="2"><testsuite name="A"><testcase name="a"/></testsuite><testsuite name="B"><testcase name="b"/></testsuite></testsuite></testsuites>"#,
        );
        assert_eq!(suites.len(), 2);
        assert!(suites
            .iter()
            .any(|suite| suite.name.as_deref() == Some("A")));
        assert!(suites
            .iter()
            .any(|suite| suite.name.as_deref() == Some("B")));
        assert_eq!(totals.tests, 2);
    }

    #[test]
    fn php_test_rejects_malformed_xml() {
        assert!(parse_junit(b"<testsuite><testcase></testsuite>").is_err());
    }

    #[test]
    fn php_test_rejects_empty_xml() {
        assert!(parse_junit(b" \n\t").is_err());
    }

    #[test]
    fn php_test_caps_cases_and_keeps_truthful_totals() {
        let mut xml = String::from("<testsuite>");
        for index in 0..MAX_CASES + 7 {
            xml.push_str(&format!(r#"<testcase name="case-{index}"/>"#));
        }
        xml.push_str("</testsuite>");
        let (suites, totals) = parse_ok(&xml);
        assert_eq!(suites[0].cases.len(), MAX_CASES);
        assert_eq!(totals.tests, (MAX_CASES + 7) as u64);
    }

    #[test]
    fn php_test_detects_artisan_before_phpunit() {
        let root = temp_directory("artisan-runner");
        fs::write(root.join("artisan"), "<?php").expect("write artisan");
        assert_eq!(
            detect_runner(&root).expect("detect"),
            Some(TestRunner::Artisan)
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn php_test_detects_executable_phpunit() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_directory("phpunit-runner");
        let binary = root.join("vendor/bin/phpunit");
        fs::create_dir_all(binary.parent().expect("parent")).expect("create vendor bin");
        fs::write(&binary, "#!/bin/sh\n").expect("write phpunit");
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).expect("make executable");
        assert!(matches!(
            detect_runner(&root).expect("detect"),
            Some(TestRunner::PhpUnit(_))
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn php_test_reports_missing_runner_as_unavailable() {
        let root = temp_directory("missing-runner");
        let app_data = root.join("app-data");
        let response = run_php_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, _, _| panic!("runner must not execute"),
        );
        assert_eq!(
            response,
            PhpTestRunResponse::Unavailable {
                message: "No PHP test runner is available in this workspace.".to_string()
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn run_with_xml(root: &Path, app_data: &Path, xml: &[u8]) -> PhpTestRunResponse {
        run_php_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            app_data,
            None,
            |_, _, result_path, _| {
                fs::write(result_path, xml).expect("write result");
                Ok(Vec::new())
            },
        )
    }

    #[test]
    fn php_test_deletes_result_file_after_success() {
        let root = temp_directory("cleanup-success");
        fs::write(root.join("artisan"), "<?php").expect("write artisan");
        let app_data = root.join("app-data");
        let response = run_with_xml(&root, &app_data, b"<testsuite/>");
        assert!(matches!(response, PhpTestRunResponse::Ok { .. }));
        assert_eq!(
            fs::read_dir(app_data.join("php-test-results"))
                .expect("read results")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn php_test_deletes_result_file_after_parse_failure_and_includes_stderr() {
        let root = temp_directory("cleanup-failure");
        fs::write(root.join("artisan"), "<?php").expect("write artisan");
        let app_data = root.join("app-data");
        let response = run_php_tests_blocking_with(
            root.to_str().expect("utf-8 root"),
            &app_data,
            None,
            |_, _, result_path, _| {
                fs::write(result_path, "<testsuite>").expect("write result");
                Ok(b"runner stderr".to_vec())
            },
        );
        assert!(matches!(
            response,
            PhpTestRunResponse::Error { ref message } if message.contains("runner stderr")
        ));
        assert_eq!(
            fs::read_dir(app_data.join("php-test-results"))
                .expect("read results")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
