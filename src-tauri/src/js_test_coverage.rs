use super::{
    detect_runner_in_workspace, ensure_registered_root_identity,
    execute_runner_with_timeout_retained, registered_root_path, JsTestRunner,
};
use crate::test_run_support::{ensure_private_directory, prepare_result_path_with_extension};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

const COVERAGE_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_LCOV_BYTES: u64 = 8 * 1024 * 1024;
const MAX_COVERAGE_FILES: usize = 20_000;
const MAX_COVERAGE_LINES: usize = 500_000;
const MAX_BRANCH_RECORDS: usize = 500_000;
const MAX_FUNCTION_RECORDS: usize = 500_000;
const MAX_FUNCTION_OVERFLOW_DEFINITIONS: usize = 1_024;
const MAX_WIRE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_PATH_BYTES: usize = 16 * 1024;
const COVERAGE_SUBDIRECTORY: &str = "js-test-coverage";
static COVERAGE_RUN: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum JsTestCoverageResponse {
    Ok { report: JsTestCoverageReport },
    Unavailable { message: String },
    Error { message: String },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTestCoverageReport {
    pub summary: JsTestCoverageMetric,
    pub branches: JsTestCoverageMetric,
    pub functions: JsTestCoverageMetric,
    pub files: Vec<JsTestCoverageFile>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTestCoverageMetric {
    pub covered: u64,
    pub total: u64,
    pub percentage: Option<f64>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTestCoverageFile {
    pub path: String,
    pub lines: Vec<JsTestCoverageLine>,
    pub summary: JsTestCoverageMetric,
    pub branches: JsTestCoverageMetric,
    pub functions: JsTestCoverageMetric,
    pub first_uncovered_line: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTestCoverageLine {
    pub line_number: u64,
    pub hits: u64,
}

pub async fn run_registered(
    root: File,
    app_data_base: PathBuf,
    package_root_relative_path: String,
) -> Result<JsTestCoverageResponse, String> {
    crate::run_blocking_command(move || {
        let root_path = registered_root_path(&root)?;
        ensure_registered_root_identity(&root, &root_path)?;
        let execution = crate::js_test_execution_root::resolve_js_test_execution_context(
            &root_path,
            &package_root_relative_path,
            super::JsTestRunScope::All,
        )?;
        crate::js_test_execution_root::ensure_js_test_execution_context_identity(&execution)?;
        let response = run_at_roots(
            &root_path,
            &execution.execution_root,
            &execution.package_root_path,
            &app_data_base,
            |runner, execution_root, output| {
                ensure_registered_root_identity(&root, &root_path)?;
                crate::js_test_execution_root::ensure_js_test_execution_context_identity(
                    &execution,
                )?;
                let authority = crate::js_test_execution_root::retain_js_test_process_authority(
                    &execution,
                    runner_binary(runner),
                    match runner {
                        JsTestRunner::Vitest(_) => {
                            crate::js_test_execution_root::RetainedJsTestRunnerKind::Vitest
                        }
                        JsTestRunner::Jest(_) => {
                            crate::js_test_execution_root::RetainedJsTestRunnerKind::Jest
                        }
                    },
                )?;
                execute_runner_with_timeout_retained(
                    runner_binary(runner),
                    execution_root,
                    coverage_args(runner, output),
                    COVERAGE_TIMEOUT,
                    Some(authority),
                )?;
                Ok(())
            },
        );
        ensure_registered_root_identity(&root, &root_path)?;
        Ok(response)
    })
    .await
}

#[cfg(test)]
fn run_at_root<F>(root: &Path, app_data_base: &Path, execute: F) -> JsTestCoverageResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<(), String>,
{
    run_at_roots(root, root, root, app_data_base, execute)
}

fn run_at_roots<F>(
    projection_root: &Path,
    execution_root: &Path,
    package_root_path: &Path,
    app_data_base: &Path,
    execute: F,
) -> JsTestCoverageResponse
where
    F: FnOnce(&JsTestRunner, &Path, &Path) -> Result<(), String>,
{
    let permit = match COVERAGE_RUN.get_or_init(|| Mutex::new(())).try_lock() {
        Ok(permit) => permit,
        Err(_) => {
            return JsTestCoverageResponse::Unavailable {
                message: "JavaScript test coverage is already running.".to_string(),
            };
        }
    };
    let runner =
        match detect_runner_in_workspace(execution_root, package_root_path, projection_root) {
            Ok(Some(runner)) => runner,
            Ok(None) => {
                return JsTestCoverageResponse::Unavailable {
                    message: "No JavaScript test runner is available in this workspace."
                        .to_string(),
                };
            }
            Err(message) => return JsTestCoverageResponse::Error { message },
        };
    let output = match prepare_coverage_directory(app_data_base) {
        Ok(output) => output,
        Err(message) => return JsTestCoverageResponse::Error { message },
    };
    let cleanup = CoverageDirectoryGuard(output.clone());
    let canonical_output = match fs::canonicalize(&output) {
        Ok(path) => path,
        Err(error) => {
            return JsTestCoverageResponse::Error {
                message: format!("Failed to resolve JavaScript coverage output: {error}"),
            };
        }
    };
    let canonical_root = match fs::canonicalize(projection_root) {
        Ok(path) => path,
        Err(error) => {
            return JsTestCoverageResponse::Error {
                message: format!("Failed to resolve JavaScript coverage workspace: {error}"),
            };
        }
    };
    if canonical_output.starts_with(canonical_root) {
        return JsTestCoverageResponse::Error {
            message: "JavaScript coverage output must stay outside the workspace.".to_string(),
        };
    }
    if let Err(message) = execute(&runner, execution_root, &output) {
        return JsTestCoverageResponse::Error { message };
    }
    let result = parse_lcov_file(projection_root, execution_root, &output.join("lcov.info"))
        .map(|report| JsTestCoverageResponse::Ok { report })
        .unwrap_or_else(|message| JsTestCoverageResponse::Error { message });
    drop(cleanup);
    drop(permit);
    result
}

fn prepare_coverage_directory(app_data_base: &Path) -> Result<PathBuf, String> {
    let path = prepare_result_path_with_extension(
        app_data_base,
        COVERAGE_SUBDIRECTORY,
        "JavaScript test coverage",
        "coverage",
    )?;
    ensure_private_directory(&path, "JavaScript test coverage")?;
    Ok(path)
}

fn coverage_args(runner: &JsTestRunner, output: &Path) -> Vec<String> {
    let output = output.to_string_lossy().into_owned();
    match runner {
        JsTestRunner::Vitest(_) => vec![
            "run".to_string(),
            "--coverage.enabled=true".to_string(),
            "--coverage.reporter=lcov".to_string(),
            format!("--coverage.reportsDirectory={output}"),
        ],
        JsTestRunner::Jest(_) => vec![
            "--coverage".to_string(),
            "--coverageReporters=lcov".to_string(),
            format!("--coverageDirectory={output}"),
        ],
    }
}

fn runner_binary(runner: &JsTestRunner) -> &Path {
    match runner {
        JsTestRunner::Vitest(binary) | JsTestRunner::Jest(binary) => binary,
    }
}

fn parse_lcov_file(
    projection_root: &Path,
    source_root: &Path,
    path: &Path,
) -> Result<JsTestCoverageReport, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("JavaScript coverage report was not produced: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("JavaScript coverage report is not a regular private file.".to_string());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("JavaScript coverage report was not produced: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("Failed to inspect JavaScript coverage report: {error}"))?
        .len();
    if size > MAX_LCOV_BYTES {
        return Err(format!(
            "JavaScript coverage report exceeded the {MAX_LCOV_BYTES} byte safety limit."
        ));
    }
    let mut bytes = Vec::with_capacity((size as usize).min(64 * 1024));
    file.take(MAX_LCOV_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read JavaScript coverage report: {error}"))?;
    if bytes.len() as u64 > MAX_LCOV_BYTES {
        return Err("JavaScript coverage report grew past its safety limit.".to_string());
    }
    let source = std::str::from_utf8(&bytes)
        .map_err(|_| "JavaScript coverage report is not valid UTF-8.".to_string())?;
    parse_lcov_at_roots(projection_root, source_root, source)
}

#[cfg(test)]
fn parse_lcov(root: &Path, source: &str) -> Result<JsTestCoverageReport, String> {
    parse_lcov_at_roots(root, root, source)
}

fn parse_lcov_at_roots(
    projection_root: &Path,
    source_root: &Path,
    source: &str,
) -> Result<JsTestCoverageReport, String> {
    parse_lcov_with_record_limits_at_roots(
        projection_root,
        source_root,
        source,
        MAX_BRANCH_RECORDS,
        MAX_FUNCTION_RECORDS,
    )
}

#[cfg(test)]
fn parse_lcov_with_record_limits(
    root: &Path,
    source: &str,
    max_branch_records: usize,
    max_function_records: usize,
) -> Result<JsTestCoverageReport, String> {
    parse_lcov_with_record_limits_at_roots(
        root,
        root,
        source,
        max_branch_records,
        max_function_records,
    )
}

fn parse_lcov_with_record_limits_at_roots(
    projection_root: &Path,
    source_root: &Path,
    source: &str,
    max_branch_records: usize,
    max_function_records: usize,
) -> Result<JsTestCoverageReport, String> {
    let mut files = BTreeMap::<String, FileCounts>::new();
    let mut current_path: Option<String> = None;
    let mut current = FileCounts::default();
    let mut line_entries = 0usize;
    let mut branch_records = 0usize;
    let mut function_definitions = BTreeMap::<String, BTreeMap<String, FunctionDefinition>>::new();
    let max_pairing_definitions = max_function_records
        .saturating_add(max_function_records.min(MAX_FUNCTION_OVERFLOW_DEFINITIONS));
    let mut pairing_definitions = 0usize;
    let mut retained_functions = 0usize;
    let mut truncated = false;
    for line in source.lines() {
        if line.is_empty() || line.starts_with("TN:") {
            continue;
        }
        if let Some(path) = line.strip_prefix("SF:") {
            if current_path.is_some() {
                return Err(
                    "JavaScript coverage report contains an unterminated record.".to_string(),
                );
            }
            current_path = Some(coverage_relative_path(projection_root, source_root, path)?);
            current = FileCounts::default();
        } else if line == "end_of_record" {
            let path = current_path.take().ok_or_else(|| {
                "JavaScript coverage report contains a record without a source path.".to_string()
            })?;
            if files.len() >= MAX_COVERAGE_FILES && !files.contains_key(&path) {
                return Err(format!(
                    "JavaScript coverage report exceeded the {MAX_COVERAGE_FILES} file safety limit."
                ));
            }
            files.entry(path).or_default().merge(&current)?;
            current = FileCounts::default();
        } else if let Some(value) = line.strip_prefix("DA:") {
            source_record_path(&current_path, "DA")?;
            let fields = value.split(',').collect::<Vec<_>>();
            if !(2..=3).contains(&fields.len())
                || fields.get(2).is_some_and(|checksum| checksum.is_empty())
            {
                return Err("JavaScript coverage report has an invalid DA record.".to_string());
            }
            let line_number = positive_count(fields[0], "DA line")?;
            let hits = count(fields[1], "DA hits")?;
            line_entries = line_entries.saturating_add(1);
            if line_entries > MAX_COVERAGE_LINES {
                return Err(format!(
                    "JavaScript coverage report exceeded the {MAX_COVERAGE_LINES} line safety limit."
                ));
            }
            add_line_hits(&mut current.lines, line_number, hits)?;
        } else if let Some(value) = line.strip_prefix("BRDA:") {
            source_record_path(&current_path, "BRDA")?;
            branch_records = branch_records.saturating_add(1);
            let fields = value.split(',').collect::<Vec<_>>();
            if fields.len() != 4 {
                return Err("JavaScript coverage report has an invalid BRDA record.".to_string());
            }
            let line_number = positive_count(fields[0], "BRDA line")?;
            let block = count(fields[1], "BRDA block")?;
            let branch = count(fields[2], "BRDA branch")?;
            let hits = if fields[3] == "-" {
                0
            } else {
                count(fields[3], "BRDA hits")?
            };
            if branch_records > max_branch_records {
                truncated = true;
                continue;
            }
            add_hits(
                &mut current.branches,
                (line_number, block, branch),
                hits,
                "branch",
            )?;
        } else if let Some(value) = line.strip_prefix("FN:") {
            let source_path = source_record_path(&current_path, "FN")?;
            let (line_number, name) = value.split_once(',').ok_or_else(|| {
                "JavaScript coverage report has an invalid FN record.".to_string()
            })?;
            let line_number = positive_count(line_number, "FN line");
            if line_number.is_err() || name.is_empty() {
                return Err("JavaScript coverage report has an invalid FN record.".to_string());
            }
            let line_number = line_number?;
            let definitions = function_definitions
                .entry(source_path.to_string())
                .or_default();
            if let Some(definition) = definitions.get(name) {
                if definition.line_number != line_number {
                    return Err(
                        "JavaScript coverage report defines one function name at multiple lines."
                            .to_string(),
                    );
                }
                if definition.retained {
                    current.functions.entry(name.to_string()).or_insert(0);
                } else {
                    truncated = true;
                }
                continue;
            }
            pairing_definitions = pairing_definitions.saturating_add(1);
            if pairing_definitions > max_pairing_definitions {
                return Err(format!(
                    "JavaScript coverage report exceeded the {max_pairing_definitions} function pairing safety limit."
                ));
            }
            let retained = retained_functions < max_function_records;
            definitions.insert(
                name.to_string(),
                FunctionDefinition {
                    line_number,
                    retained,
                },
            );
            if !retained {
                truncated = true;
                continue;
            }
            retained_functions = retained_functions.saturating_add(1);
            current.functions.entry(name.to_string()).or_insert(0);
        } else if let Some(value) = line.strip_prefix("FNDA:") {
            let source_path = source_record_path(&current_path, "FNDA")?;
            let (hits, name) = value.split_once(',').ok_or_else(|| {
                "JavaScript coverage report has an invalid FNDA record.".to_string()
            })?;
            if name.is_empty() {
                return Err("JavaScript coverage report has an invalid FNDA record.".to_string());
            }
            let hits = count(hits, "FNDA hits")?;
            let definition = function_definitions
                .get(source_path)
                .and_then(|definitions| definitions.get(name))
                .ok_or_else(|| {
                    "JavaScript coverage report contains FNDA without a corresponding FN record."
                        .to_string()
                })?;
            if !definition.retained {
                truncated = true;
                continue;
            }
            add_hits(&mut current.functions, name.to_string(), hits, "function")?;
        } else if let Some(value) = line.strip_prefix("LF:") {
            source_record_path(&current_path, "LF")?;
            let _ = count(value, "LF")?;
        } else if let Some(value) = line.strip_prefix("LH:") {
            source_record_path(&current_path, "LH")?;
            let _ = count(value, "LH")?;
        } else if let Some(value) = line.strip_prefix("FNF:") {
            source_record_path(&current_path, "FNF")?;
            let _ = count(value, "FNF")?;
        } else if let Some(value) = line.strip_prefix("FNH:") {
            source_record_path(&current_path, "FNH")?;
            let _ = count(value, "FNH")?;
        } else if let Some(value) = line.strip_prefix("BRF:") {
            source_record_path(&current_path, "BRF")?;
            let _ = count(value, "BRF")?;
        } else if let Some(value) = line.strip_prefix("BRH:") {
            source_record_path(&current_path, "BRH")?;
            let _ = count(value, "BRH")?;
        } else {
            return Err("JavaScript coverage report contains an unsupported record.".to_string());
        }
    }
    if current_path.is_some() {
        return Err("JavaScript coverage report contains an unterminated record.".to_string());
    }
    let mut summary = Counts::default();
    let files = files
        .into_iter()
        .map(|(path, file)| {
            let line_total = file.lines.len() as u64;
            let line_covered = file.lines.values().filter(|hits| **hits > 0).count() as u64;
            let counts = Counts {
                lines_total: line_total,
                lines_covered: line_covered,
                branches_total: file.branches.len() as u64,
                branches_covered: file.branches.values().filter(|hits| **hits > 0).count() as u64,
                functions_total: file.functions.len() as u64,
                functions_covered: file.functions.values().filter(|hits| **hits > 0).count() as u64,
            };
            validate_counts(&counts)?;
            summary.add(&counts)?;
            let first_uncovered_line = file
                .lines
                .iter()
                .find_map(|(line, hits)| (*hits == 0).then_some(*line));
            Ok(JsTestCoverageFile {
                path,
                lines: file
                    .lines
                    .into_iter()
                    .map(|(line_number, hits)| JsTestCoverageLine { line_number, hits })
                    .collect(),
                summary: metric(counts.lines_covered, counts.lines_total),
                branches: metric(counts.branches_covered, counts.branches_total),
                functions: metric(counts.functions_covered, counts.functions_total),
                first_uncovered_line,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    validate_counts(&summary)?;
    Ok(JsTestCoverageReport {
        summary: metric(summary.lines_covered, summary.lines_total),
        branches: metric(summary.branches_covered, summary.branches_total),
        functions: metric(summary.functions_covered, summary.functions_total),
        files,
        truncated,
    })
}

fn source_record_path<'a>(current_path: &'a Option<String>, kind: &str) -> Result<&'a str, String> {
    current_path.as_deref().ok_or_else(|| {
        format!("JavaScript coverage report contains a {kind} record outside a source record.")
    })
}

fn coverage_relative_path(
    projection_root: &Path,
    source_root: &Path,
    value: &str,
) -> Result<String, String> {
    if value.is_empty()
        || value.len() > MAX_PATH_BYTES
        || value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f))
    {
        return Err("JavaScript coverage source path is invalid or too long.".to_string());
    }
    let path = Path::new(value);
    let source = if path.is_absolute() {
        path.to_path_buf()
    } else {
        source_root.join(path)
    };
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            && !path.is_absolute()
    {
        return Err(
            "JavaScript coverage source path is not a safe workspace descendant.".to_string(),
        );
    }
    let canonical_root = fs::canonicalize(projection_root)
        .map_err(|error| format!("Failed to resolve coverage workspace root: {error}"))?;
    let canonical_source = fs::canonicalize(source)
        .map_err(|error| format!("Failed to resolve covered source path: {error}"))?;
    let confined = canonical_source
        .strip_prefix(&canonical_root)
        .map_err(|_| "JavaScript coverage source escaped the workspace root.".to_string())?;
    Ok(confined.to_string_lossy().replace('\\', "/"))
}

fn count(value: &str, field: &str) -> Result<u64, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!(
            "JavaScript coverage report has an invalid {field} count."
        ));
    }
    let value = value
        .parse()
        .map_err(|_| format!("JavaScript coverage report has an invalid {field} count."))?;
    if value > MAX_WIRE_INTEGER {
        return Err(format!(
            "JavaScript coverage report {field} count exceeds the safe integer limit."
        ));
    }
    Ok(value)
}

fn positive_count(value: &str, field: &str) -> Result<u64, String> {
    if !value
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_digit() && *byte != b'0')
    {
        return Err(format!(
            "JavaScript coverage report has an invalid {field} count."
        ));
    }
    count(value, field)
}

fn metric(covered: u64, total: u64) -> JsTestCoverageMetric {
    JsTestCoverageMetric {
        covered,
        total,
        percentage: if total == 0 {
            None
        } else {
            Some(covered as f64 * 100.0 / total as f64)
        },
    }
}

fn validate_counts(counts: &Counts) -> Result<(), String> {
    if counts.lines_covered > counts.lines_total
        || counts.branches_covered > counts.branches_total
        || counts.functions_covered > counts.functions_total
    {
        return Err("JavaScript coverage covered count exceeds its total.".to_string());
    }
    Ok(())
}

#[derive(Clone, Default)]
struct Counts {
    lines_total: u64,
    lines_covered: u64,
    branches_total: u64,
    branches_covered: u64,
    functions_total: u64,
    functions_covered: u64,
}

impl Counts {
    fn add(&mut self, other: &Self) -> Result<(), String> {
        self.lines_total = checked_add(self.lines_total, other.lines_total)?;
        self.lines_covered = checked_add(self.lines_covered, other.lines_covered)?;
        self.branches_total = checked_add(self.branches_total, other.branches_total)?;
        self.branches_covered = checked_add(self.branches_covered, other.branches_covered)?;
        self.functions_total = checked_add(self.functions_total, other.functions_total)?;
        self.functions_covered = checked_add(self.functions_covered, other.functions_covered)?;
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FileCounts {
    lines: BTreeMap<u64, u64>,
    branches: BTreeMap<(u64, u64, u64), u64>,
    functions: BTreeMap<String, u64>,
}

#[derive(Clone, Copy)]
struct FunctionDefinition {
    line_number: u64,
    retained: bool,
}

impl FileCounts {
    fn merge(&mut self, other: &Self) -> Result<(), String> {
        for (line, hits) in &other.lines {
            add_line_hits(&mut self.lines, *line, *hits)?;
        }
        for (branch, hits) in &other.branches {
            add_hits(&mut self.branches, *branch, *hits, "branch")?;
        }
        for (function, hits) in &other.functions {
            add_hits(&mut self.functions, function.clone(), *hits, "function")?;
        }
        Ok(())
    }
}

fn add_hits<K: Ord>(
    entries: &mut BTreeMap<K, u64>,
    key: K,
    hits: u64,
    kind: &str,
) -> Result<(), String> {
    let sum = entries
        .get(&key)
        .copied()
        .unwrap_or(0)
        .checked_add(hits)
        .filter(|sum| *sum <= MAX_WIRE_INTEGER)
        .ok_or_else(|| format!("JavaScript coverage {kind} hits overflowed their safety range."))?;
    entries.insert(key, sum);
    Ok(())
}

fn add_line_hits(lines: &mut BTreeMap<u64, u64>, line: u64, hits: u64) -> Result<(), String> {
    let sum = lines
        .get(&line)
        .copied()
        .unwrap_or(0)
        .checked_add(hits)
        .filter(|sum| *sum <= MAX_WIRE_INTEGER)
        .ok_or_else(|| {
            "JavaScript coverage line hits overflowed their safety range.".to_string()
        })?;
    lines.insert(line, sum);
    Ok(())
}

fn checked_add(left: u64, right: u64) -> Result<u64, String> {
    left.checked_add(right)
        .ok_or_else(|| "JavaScript coverage totals overflowed their safety range.".to_string())
}

struct CoverageDirectoryGuard(PathBuf);

impl Drop for CoverageDirectoryGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        os::unix::fs::{symlink, PermissionsExt},
        sync::atomic::{AtomicU64, Ordering},
        sync::{Arc, Mutex as StdMutex},
    };

    static RUN_TEST: StdMutex<()> = StdMutex::new(());

    #[test]
    fn runner_arguments_are_fixed_and_write_only_to_private_output() {
        let output = Path::new("/private/app/coverage");
        let vitest = coverage_args(&JsTestRunner::Vitest(PathBuf::from("vitest")), output);
        assert_eq!(
            vitest,
            [
                "run",
                "--coverage.enabled=true",
                "--coverage.reporter=lcov",
                "--coverage.reportsDirectory=/private/app/coverage",
            ]
        );
        let jest = coverage_args(&JsTestRunner::Jest(PathBuf::from("jest")), output);
        assert_eq!(
            jest,
            [
                "--coverage",
                "--coverageReporters=lcov",
                "--coverageDirectory=/private/app/coverage",
            ]
        );
    }

    #[test]
    fn nested_relative_source_paths_resolve_from_execution_root_and_project_from_workspace() {
        let root = fixture("nested-relative-source");
        let package = root.join("packages/web");
        fs::create_dir_all(package.join("src")).expect("create package source");
        fs::write(package.join("src/app.ts"), "export const app = true;").expect("write source");

        let report = parse_lcov_at_roots(&root, &package, "SF:src/app.ts\nDA:1,1\nend_of_record\n")
            .expect("parse nested report");

        assert_eq!(report.files[0].path, "packages/web/src/app.ts");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_sorted_unique_lines_and_typed_summaries() {
        let root = fixture("parse");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/math.ts"), "export const sum = 1;").unwrap();
        let report = parse_lcov(
            &root,
            &format!(
                "SF:{}\nDA:2,0\nDA:1,3\nDA:2,4\nLF:2\nLH:2\nFNF:1\nFNH:1\nBRF:2\nBRH:1\nend_of_record\n",
                root.join("src/math.ts").display()
            ),
        )
        .unwrap();
        assert_eq!(report.files.len(), 1);
        let file = &report.files[0];
        assert_eq!(file.path, "src/math.ts");
        assert_eq!(
            file.lines,
            vec![
                JsTestCoverageLine {
                    line_number: 1,
                    hits: 3,
                },
                JsTestCoverageLine {
                    line_number: 2,
                    hits: 4,
                },
            ]
        );
        assert_eq!(file.first_uncovered_line, None);
        assert_eq!(file.summary, metric(2, 2));
        assert_eq!(report.summary, metric(2, 2));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn brda_records_populate_branches_covered_total_and_fnda_populate_functions() {
        let root = fixture("branch-function");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        let report = parse_lcov(
            &root,
            "SF:safe.ts\nFN:1,covered\nFN:1,uncovered\nFNDA:2,covered\nFNDA:0,uncovered\nBRDA:1,0,0,3\nBRDA:1,0,1,-\nend_of_record\n",
        )
        .unwrap();
        let value = serde_json::to_value(report).unwrap();
        assert_eq!(
            value["files"][0]["branches"],
            serde_json::json!({ "covered": 1, "total": 2, "percentage": 50.0 })
        );
        assert_eq!(
            value["files"][0]["functions"],
            serde_json::json!({ "covered": 1, "total": 2, "percentage": 50.0 })
        );
        assert_eq!(value["branches"], value["files"][0]["branches"]);
        assert_eq!(value["functions"], value["files"][0]["functions"]);
        assert_eq!(value["truncated"], false);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn branch_and_function_record_caps_set_a_deterministic_truncated_flag() {
        let root = fixture("branch-function-cap");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        let report = parse_lcov_with_record_limits(
            &root,
            "SF:safe.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,1\nFN:1,kept\nFNDA:1,kept\nFN:1,discarded\nend_of_record\n",
            1,
            1,
        )
        .unwrap();
        assert!(report.truncated);
        assert_eq!(report.branches, metric(1, 1));
        assert_eq!(report.functions, metric(1, 1));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_malformed_branch_and_function_records_within_the_caps() {
        let root = fixture("branch-function-invalid");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        for source in [
            "SF:safe.ts\nBRDA:1,0,0\nend_of_record\n",
            "SF:safe.ts\nBRDA:0,0,0,1\nend_of_record\n",
            "SF:safe.ts\nBRDA:1,0,0,bad\nend_of_record\n",
            "SF:safe.ts\nFN:0,fn\nend_of_record\n",
            "SF:safe.ts\nFN:1,\nend_of_record\n",
            "SF:safe.ts\nFNDA:bad,fn\nend_of_record\n",
            "SF:safe.ts\nBRDA:+1,+0,+0,+1\nend_of_record\n",
            "SF:safe.ts\nBRDA:01,0,0,1\nend_of_record\n",
            "SF:safe.ts\nFN:+1,fn\nend_of_record\n",
            "SF:safe.ts\nFN:01,fn\nend_of_record\n",
            "BRDA:1,0,0,1\n",
            "FN:1,fn\n",
            "FNDA:1,fn\n",
            "SF:safe.ts\nFNDA:1,orphan\nend_of_record\n",
            "SF:safe.ts\nFNDA:1,later\nFN:1,later\nend_of_record\n",
        ] {
            assert!(parse_lcov(&root, source).is_err(), "{source}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_data_and_summary_records_outside_source_records() {
        let root = fixture("record-order");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        for source in [
            "DA:1,1\n",
            "LF:1\n",
            "LH:1\n",
            "FNF:1\n",
            "FNH:1\n",
            "BRF:1\n",
            "BRH:1\n",
            "SF:safe.ts\nend_of_record\nDA:1,1\n",
            "SF:safe.ts\nend_of_record\nLF:1\n",
            "SF:safe.ts\nend_of_record\nend_of_record\n",
        ] {
            assert!(parse_lcov(&root, source).is_err(), "{source}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn truncation_does_not_hide_malformed_branch_or_function_records() {
        let root = fixture("truncated-malformed");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        for source in [
            "SF:safe.ts\nBRDA:1,0,0,1\nBRDA:bad\nend_of_record\n",
            "SF:safe.ts\nFN:1,kept\nFN:bad\nend_of_record\n",
            "SF:safe.ts\nFN:1,kept\nFNDA:bad,kept\nend_of_record\n",
        ] {
            assert!(
                parse_lcov_with_record_limits(&root, source, 1, 1).is_err(),
                "{source}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn function_cap_retains_complete_pairs_and_omits_complete_overflow_pairs() {
        let root = fixture("function-pair-cap");
        fs::write(root.join("safe.ts"), "one\ntwo\n").unwrap();
        let report = parse_lcov_with_record_limits(
            &root,
            "SF:safe.ts\nFN:1,kept\nFN:2,discarded\nFNDA:3,kept\nFNDA:9,discarded\nend_of_record\n",
            MAX_BRANCH_RECORDS,
            1,
        )
        .unwrap();
        assert!(report.truncated);
        assert_eq!(report.functions, metric(1, 1));
        assert_eq!(report.files[0].functions, metric(1, 1));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn function_pairing_state_has_a_hard_bound_beyond_the_retention_cap() {
        let root = fixture("function-pair-hard-cap");
        fs::write(root.join("safe.ts"), "one\ntwo\nthree\n").unwrap();
        let failure = parse_lcov_with_record_limits(
            &root,
            "SF:safe.ts\nFN:1,kept\nFN:2,overflow\nFN:3,rejected\nFNDA:1,kept\nend_of_record\n",
            MAX_BRANCH_RECORDS,
            1,
        )
        .unwrap_err();
        assert!(failure.contains("function pairing safety limit"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_function_names_are_counted_once_and_conflicting_lines_fail_closed() {
        let root = fixture("duplicate-function");
        fs::write(root.join("safe.ts"), "one\ntwo\n").unwrap();
        let report = parse_lcov(
            &root,
            "SF:safe.ts\nFN:1,same\nFN:1,same\nFNDA:2,same\nFNDA:3,same\nend_of_record\n",
        )
        .unwrap();
        assert_eq!(report.functions, metric(1, 1));
        assert_eq!(report.files[0].functions, metric(1, 1));

        assert!(parse_lcov(
            &root,
            "SF:safe.ts\nFN:1,same\nFN:2,same\nFNDA:1,same\nend_of_record\n"
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn function_counts_can_follow_a_definition_in_a_repeated_source_record() {
        let root = fixture("function-repeated-source");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        let report = parse_lcov(
            &root,
            "SF:safe.ts\nFN:1,split\nend_of_record\nSF:safe.ts\nFNDA:4,split\nend_of_record\n",
        )
        .unwrap();
        assert_eq!(report.functions, metric(1, 1));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_escaped_symlink_invalid_counts_and_zero_lines() {
        let root = fixture("isolation");
        let outside = fixture("outside");
        fs::write(outside.join("secret.ts"), "secret").unwrap();
        symlink(outside.join("secret.ts"), root.join("linked.ts")).unwrap();
        for source in [
            format!(
                "SF:{}\nDA:1,1\nend_of_record\n",
                outside.join("secret.ts").display()
            ),
            "SF:linked.ts\nDA:1,1\nend_of_record\n".to_string(),
            "SF:../escape.ts\nDA:1,1\nend_of_record\n".to_string(),
        ] {
            assert!(parse_lcov(&root, &source).is_err());
        }
        fs::write(root.join("safe.ts"), "safe").unwrap();
        assert!(parse_lcov(&root, "SF:safe.ts\nDA:0,1\nend_of_record\n").is_err());
        assert!(parse_lcov(&root, "SF:safe.ts\nDA:1\nend_of_record\n").is_err());
        assert!(parse_lcov(&root, "SF:safe.ts\nDA:1,1,a,extra\nend_of_record\n").is_err());
        assert!(parse_lcov(&root, "SF:safe.ts\nDA:1,1,\nend_of_record\n").is_err());
        assert!(parse_lcov(
            &root,
            "SF:safe.ts\nDA:1,18446744073709551616\nend_of_record\n"
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn duplicate_source_records_merge_disjoint_lines_without_double_counting() {
        let root = fixture("duplicate-source");
        fs::write(root.join("safe.ts"), "one\ntwo\n").unwrap();
        let report = parse_lcov(
            &root,
            "SF:safe.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\nSF:safe.ts\nDA:2,0\nDA:1,2\nLF:2\nLH:1\nend_of_record\n",
        )
        .unwrap();
        assert_eq!(report.files.len(), 1);
        assert_eq!(report.files[0].summary, metric(1, 2));
        assert_eq!(report.files[0].first_uncovered_line, Some(2));
        assert_eq!(report.files[0].lines[0].hits, 3);
        assert_eq!(report.summary, metric(1, 2));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn line_entry_cap_is_explicit() {
        let root = fixture("line-cap");
        fs::write(root.join("safe.ts"), "safe").unwrap();
        let mut source = String::from("SF:safe.ts\n");
        for line in 1..=MAX_COVERAGE_LINES + 1 {
            source.push_str(&format!("DA:{line},0\n"));
        }
        source.push_str("end_of_record\n");
        assert!(parse_lcov(&root, &source)
            .unwrap_err()
            .contains("line safety limit"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn temporary_directory_is_cleaned_after_success_and_failure() {
        let _serial = RUN_TEST.lock().unwrap();
        let root = runner_fixture("cleanup");
        fs::write(root.join("covered.ts"), "covered").unwrap();
        let app_data = root.with_extension("app-data");
        let observed = Arc::new(StdMutex::new(None::<PathBuf>));
        let captured = Arc::clone(&observed);
        let response = run_at_root(&root, &app_data, move |_runner, root, output| {
            *captured.lock().unwrap() = Some(output.to_path_buf());
            fs::write(
                output.join("lcov.info"),
                format!(
                    "SF:{}\nDA:1,1\nLF:1\nLH:1\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n",
                    root.join("covered.ts").display()
                ),
            )
            .unwrap();
            Ok(())
        });
        assert!(matches!(response, JsTestCoverageResponse::Ok { .. }));
        assert!(!observed.lock().unwrap().as_ref().unwrap().exists());

        let failed_path = Arc::new(StdMutex::new(None::<PathBuf>));
        let captured = Arc::clone(&failed_path);
        let response = run_at_root(&root, &app_data, move |_runner, _root, output| {
            *captured.lock().unwrap() = Some(output.to_path_buf());
            Err("runner failed".to_string())
        });
        assert_eq!(
            response,
            JsTestCoverageResponse::Error {
                message: "runner failed".to_string()
            }
        );
        assert!(!failed_path.lock().unwrap().as_ref().unwrap().exists());

        assert_eq!(
            run_at_root(&root, &root, |_runner, _root, _output| Ok(())),
            JsTestCoverageResponse::Error {
                message: "JavaScript coverage output must stay outside the workspace.".to_string()
            }
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn concurrent_coverage_run_is_rejected() {
        let _serial = RUN_TEST.lock().unwrap();
        let root = runner_fixture("concurrent");
        let app_data = root.with_extension("app-data");
        let _held = COVERAGE_RUN.get_or_init(|| Mutex::new(())).lock().unwrap();
        assert!(matches!(
            run_at_root(&root, &app_data, |_runner, _root, _output| Ok(())),
            JsTestCoverageResponse::Unavailable { .. }
        ));
        fs::remove_dir_all(root).unwrap();
    }

    fn runner_fixture(label: &str) -> PathBuf {
        let root = fixture(label);
        fs::write(root.join("vitest.config.ts"), "export default {}").unwrap();
        let runner = root.join("node_modules/.bin/vitest");
        fs::create_dir_all(runner.parent().unwrap()).unwrap();
        fs::write(&runner, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
        root
    }

    fn fixture(label: &str) -> PathBuf {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "mockor-js-coverage-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
