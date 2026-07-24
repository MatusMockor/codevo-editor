use super::{
    detect_runner, ensure_registered_root_identity, execute_runner_with_timeout,
    registered_root_path, JsTestRunner,
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
    pub files: Vec<JsTestCoverageFile>,
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
) -> Result<JsTestCoverageResponse, String> {
    crate::run_blocking_command(move || {
        let root_path = registered_root_path(&root)?;
        ensure_registered_root_identity(&root, &root_path)?;
        let response = run_at_root(
            &root_path,
            &app_data_base,
            |runner, current_root, output| {
                ensure_registered_root_identity(&root, current_root)?;
                execute_runner_with_timeout(
                    runner_binary(runner),
                    current_root,
                    coverage_args(runner, output),
                    COVERAGE_TIMEOUT,
                )?;
                Ok(())
            },
        );
        ensure_registered_root_identity(&root, &root_path)?;
        Ok(response)
    })
    .await
}

fn run_at_root<F>(root: &Path, app_data_base: &Path, execute: F) -> JsTestCoverageResponse
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
    let runner = match detect_runner(root) {
        Ok(Some(runner)) => runner,
        Ok(None) => {
            return JsTestCoverageResponse::Unavailable {
                message: "No JavaScript test runner is available in this workspace.".to_string(),
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
    let canonical_root = match fs::canonicalize(root) {
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
    if let Err(message) = execute(&runner, root, &output) {
        return JsTestCoverageResponse::Error { message };
    }
    let result = parse_lcov_file(root, &output.join("lcov.info"))
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

fn parse_lcov_file(root: &Path, path: &Path) -> Result<JsTestCoverageReport, String> {
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
    parse_lcov(root, source)
}

fn parse_lcov(root: &Path, source: &str) -> Result<JsTestCoverageReport, String> {
    let mut files = BTreeMap::<String, FileCounts>::new();
    let mut current_path: Option<String> = None;
    let mut current = FileCounts::default();
    let mut line_entries = 0usize;
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
            current_path = Some(coverage_relative_path(root, path)?);
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
        } else if let Some(value) = line.strip_prefix("DA:") {
            let fields = value.split(',').collect::<Vec<_>>();
            if !(2..=3).contains(&fields.len())
                || fields.get(2).is_some_and(|checksum| checksum.is_empty())
            {
                return Err("JavaScript coverage report has an invalid DA record.".to_string());
            }
            let line_number = count(fields[0], "DA line")?;
            let hits = count(fields[1], "DA hits")?;
            if line_number == 0 {
                return Err("JavaScript coverage report contains line number zero.".to_string());
            }
            line_entries = line_entries.saturating_add(1);
            if line_entries > MAX_COVERAGE_LINES {
                return Err(format!(
                    "JavaScript coverage report exceeded the {MAX_COVERAGE_LINES} line safety limit."
                ));
            }
            add_line_hits(&mut current.lines, line_number, hits)?;
        } else if let Some(value) = line.strip_prefix("LF:") {
            let _ = count(value, "LF")?;
        } else if let Some(value) = line.strip_prefix("LH:") {
            let _ = count(value, "LH")?;
        } else if let Some(value) = line.strip_prefix("FNF:") {
            let _ = count(value, "FNF")?;
        } else if let Some(value) = line.strip_prefix("FNH:") {
            let _ = count(value, "FNH")?;
        } else if let Some(value) = line.strip_prefix("BRF:") {
            let _ = count(value, "BRF")?;
        } else if let Some(value) = line.strip_prefix("BRH:") {
            let _ = count(value, "BRH")?;
        } else if line.starts_with("FN:") || line.starts_with("FNDA:") || line.starts_with("BRDA:")
        {
            continue;
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
                first_uncovered_line,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    validate_counts(&summary)?;
    Ok(JsTestCoverageReport {
        summary: metric(summary.lines_covered, summary.lines_total),
        files,
    })
}

fn coverage_relative_path(root: &Path, value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > MAX_PATH_BYTES
        || value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f))
    {
        return Err("JavaScript coverage source path is invalid or too long.".to_string());
    }
    let path = Path::new(value);
    let relative = if path.is_absolute() {
        path.strip_prefix(root)
            .map_err(|_| "JavaScript coverage source escaped the workspace root.".to_string())?
    } else {
        path
    };
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(
            "JavaScript coverage source path is not a safe workspace descendant.".to_string(),
        );
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve coverage workspace root: {error}"))?;
    let canonical_source = fs::canonicalize(root.join(relative))
        .map_err(|error| format!("Failed to resolve covered source path: {error}"))?;
    let confined = canonical_source
        .strip_prefix(&canonical_root)
        .map_err(|_| "JavaScript coverage source escaped the workspace root.".to_string())?;
    Ok(confined.to_string_lossy().replace('\\', "/"))
}

fn count(value: &str, field: &str) -> Result<u64, String> {
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
    if counts.lines_covered > counts.lines_total {
        return Err("JavaScript coverage covered count exceeds its total.".to_string());
    }
    Ok(())
}

#[derive(Clone, Default)]
struct Counts {
    lines_total: u64,
    lines_covered: u64,
}

impl Counts {
    fn add(&mut self, other: &Self) -> Result<(), String> {
        self.lines_total = checked_add(self.lines_total, other.lines_total)?;
        self.lines_covered = checked_add(self.lines_covered, other.lines_covered)?;
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FileCounts {
    lines: BTreeMap<u64, u64>,
}

impl FileCounts {
    fn merge(&mut self, other: &Self) -> Result<(), String> {
        for (line, hits) in &other.lines {
            add_line_hits(&mut self.lines, *line, *hits)?;
        }
        Ok(())
    }
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
