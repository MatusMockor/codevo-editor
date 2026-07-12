use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const MAX_DIAGNOSTICS: usize = 2_000;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
const ESLINT_CACHE_DIR: &str = "eslint-cache";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintDiagnostic {
    pub file_path: String,
    pub line: Option<u64>,
    pub column: Option<u64>,
    pub end_line: Option<u64>,
    pub end_column: Option<u64>,
    pub message: String,
    pub identifier: Option<String>,
    pub severity: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintTotals {
    pub error_count: u64,
    pub warning_count: u64,
    pub file_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum EslintAnalysisResponse {
    Ok {
        diagnostics: Vec<EslintDiagnostic>,
        totals: EslintTotals,
    },
    Unavailable,
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn run_eslint_analysis(
    root_path: String,
    binary_path: Option<String>,
) -> Result<EslintAnalysisResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_eslint_analysis_blocking(
            &root_path,
            binary_path.as_deref(),
        ))
    })
    .await
}

fn run_eslint_analysis_blocking(
    root_path: &str,
    binary_path: Option<&str>,
) -> EslintAnalysisResponse {
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return EslintAnalysisResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let binary = match resolve_binary(&root, binary_path) {
        Ok(Some(binary)) => binary,
        Ok(None) => return EslintAnalysisResponse::Unavailable,
        Err(message) => return EslintAnalysisResponse::Error { message },
    };
    let cache_base = std::env::temp_dir()
        .join("mockor-editor")
        .join(ESLINT_CACHE_DIR);
    let output = match Command::new(binary)
        .args(eslint_args(&root, &cache_base))
        .env("LC_ALL", "C")
        .current_dir(&root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return EslintAnalysisResponse::Error {
                message: format!("Failed to run ESLint: {error}"),
            };
        }
    };

    if matches!(output.status.code(), Some(0 | 1)) {
        return match parse_eslint_output(&root, &output.stdout) {
            Ok(response) => response,
            Err(_) => EslintAnalysisResponse::Error {
                message: stderr_tail(&output.stderr),
            },
        };
    }

    EslintAnalysisResponse::Error {
        message: stderr_tail(&output.stderr),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintOutputFile {
    file_path: String,
    messages: Vec<EslintOutputMessage>,
    error_count: u64,
    warning_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintOutputMessage {
    rule_id: Option<String>,
    severity: u8,
    message: String,
    line: Option<u64>,
    column: Option<u64>,
    end_line: Option<u64>,
    end_column: Option<u64>,
}

fn parse_eslint_output(root: &Path, stdout: &[u8]) -> Result<EslintAnalysisResponse, String> {
    let output: Vec<EslintOutputFile> =
        serde_json::from_slice(stdout).map_err(|error| error.to_string())?;
    let error_count = output.iter().map(|file| file.error_count).sum();
    let warning_count = output.iter().map(|file| file.warning_count).sum();
    let file_count = output
        .iter()
        .filter(|file| file.error_count + file.warning_count > 0)
        .map(|file| &file.file_path)
        .collect::<BTreeSet<_>>()
        .len() as u64;
    let mut diagnostics = Vec::with_capacity(
        MAX_DIAGNOSTICS.min(output.iter().map(|file| file.messages.len()).sum()),
    );

    for file in output {
        let absolute_path = Path::new(&file.file_path);
        if !absolute_path.is_absolute() {
            continue;
        }
        let relative_path = match absolute_path.strip_prefix(root) {
            Ok(relative_path) => relative_path,
            Err(_) => continue,
        };
        let relative_path = relative_path.to_string_lossy().replace('\\', "/");

        for message in file.messages {
            if diagnostics.len() == MAX_DIAGNOSTICS {
                break;
            }
            diagnostics.push(EslintDiagnostic {
                file_path: relative_path.clone(),
                line: message.line,
                column: message.column,
                end_line: message.end_line,
                end_column: message.end_column,
                message: message.message,
                identifier: message.rule_id,
                severity: message.severity,
            });
        }
    }

    Ok(EslintAnalysisResponse::Ok {
        diagnostics,
        totals: EslintTotals {
            error_count,
            warning_count,
            file_count,
        },
    })
}

fn eslint_args(root: &Path, cache_base: &Path) -> Vec<String> {
    let mut args = vec![
        ".".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--no-color".to_string(),
    ];
    let cache_dir = workspace_cache_dir(cache_base, root);

    if fs::create_dir_all(&cache_dir).is_ok() {
        args.push("--cache".to_string());
        args.push("--cache-location".to_string());
        args.push(cache_dir.to_string_lossy().into_owned());
    }

    args
}

fn workspace_cache_dir(cache_base: &Path, root: &Path) -> PathBuf {
    let normalized_root = root.to_string_lossy().replace('\\', "/");
    cache_base.join(format!("{:016x}", stable_hash(&normalized_root)))
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

fn resolve_binary(root: &Path, binary_path: Option<&str>) -> Result<Option<PathBuf>, String> {
    let (candidate, is_explicit) = match binary_path {
        Some(path) if path.trim().is_empty() => {
            return Err("ESLint binary path must not be empty.".to_string());
        }
        Some(path) => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                (path, true)
            } else {
                (root.join(path), true)
            }
        }
        None => (root.join("node_modules").join(".bin").join("eslint"), false),
    };

    if !is_executable_file(&candidate) {
        if is_explicit {
            return Err(format!(
                "Configured ESLint binary is missing or not executable: {}",
                candidate.display()
            ));
        }
        return Ok(None);
    }

    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve ESLint binary: {error}"))
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

fn stderr_tail(stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let mut tail: String = stderr.chars().rev().take(2_000).collect();
    tail = tail.chars().rev().collect();
    tail
}

#[cfg(test)]
mod tests {
    use super::{
        eslint_args, parse_eslint_output, run_eslint_analysis_blocking, workspace_cache_dir,
        EslintAnalysisResponse, MAX_DIAGNOSTICS,
    };
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };
    #[cfg(unix)]
    use std::{io::Write, os::unix::fs::PermissionsExt};

    #[test]
    fn parses_messages_with_ranges_severities_and_uncapped_totals() {
        let root = temp_workspace("eslint-files");
        let file = root.join("src").join("index.ts");
        let response = parse_fixture(
            &root,
            json!([{
                "filePath": file,
                "messages": [
                    { "ruleId": "no-console", "severity": 1, "message": "Unexpected console statement.", "line": 4, "column": 3 },
                    { "ruleId": "semi", "severity": 2, "message": "Missing semicolon.", "line": 4, "column": 20, "endLine": 4, "endColumn": 21 }
                ],
                "errorCount": 1,
                "warningCount": 1
            }]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].file_path, "src/index.ts");
        assert_eq!(diagnostics[0].severity, 1);
        assert_eq!(diagnostics[0].identifier.as_deref(), Some("no-console"));
        assert_eq!(diagnostics[1].end_line, Some(4));
        assert_eq!(diagnostics[1].end_column, Some(21));
        assert_eq!(totals.error_count, 1);
        assert_eq!(totals.warning_count, 1);
        assert_eq!(totals.file_count, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn drops_relative_and_outside_files_but_keeps_their_totals() {
        let root = temp_workspace("eslint-root");
        let inside = root.join("inside.js");
        let outside = root.parent().expect("parent").join("outside.js");
        let response = parse_fixture(
            &root,
            json!([
                eslint_file(&inside, 2, 0, "Inside"),
                eslint_file(&outside, 1, 0, "Outside"),
                { "filePath": "relative.js", "messages": [{ "ruleId": null, "severity": 1, "message": "Relative", "line": 1, "column": 1 }], "errorCount": 0, "warningCount": 1 }
            ]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file_path, "inside.js");
        assert_eq!(totals.error_count, 3);
        assert_eq!(totals.warning_count, 1);
        assert_eq!(totals.file_count, 3);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn caps_diagnostics_without_changing_totals() {
        let root = temp_workspace("eslint-cap");
        let file = root.join("many.js");
        let messages: Vec<_> = (0..(MAX_DIAGNOSTICS + 10))
            .map(|line| json!({ "ruleId": "rule", "severity": 2, "message": format!("Error {line}"), "line": line + 1, "column": 1 }))
            .collect();
        let response = parse_fixture(
            &root,
            json!([{ "filePath": file, "messages": messages, "errorCount": MAX_DIAGNOSTICS + 10, "warningCount": 7 }]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), MAX_DIAGNOSTICS);
        assert_eq!(totals.error_count, (MAX_DIAGNOSTICS + 10) as u64);
        assert_eq!(totals.warning_count, 7);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_unavailable_without_explicit_or_workspace_binary() {
        let root = temp_workspace("eslint-unavailable");
        let response = run_eslint_analysis_blocking(root.to_str().expect("root"), None);
        assert_eq!(response, EslintAnalysisResponse::Unavailable);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_error_for_missing_explicit_binary() {
        let root = temp_workspace("eslint-explicit");
        let configured = root.join("tools").join("eslint");
        let response = run_eslint_analysis_blocking(
            root.to_str().expect("root"),
            Some(configured.to_str().expect("binary")),
        );

        match response {
            EslintAnalysisResponse::Error { message } => {
                assert!(message.contains(configured.to_str().expect("binary")));
                assert!(message.contains("missing or not executable"));
            }
            other => panic!("expected error response, got {other:?}"),
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn accepts_exit_one_diagnostics_and_reports_exit_two_and_bad_json() {
        let root = temp_workspace("eslint-script-results");
        let linted = root.join("linted.js");
        let exit_one = executable_script(
            &root,
            "exit-one",
            &format!("#!/bin/sh\nprintf '[{{\"filePath\":\"{}\",\"messages\":[{{\"ruleId\":\"semi\",\"severity\":2,\"message\":\"Missing semicolon.\",\"line\":1,\"column\":1}}],\"errorCount\":1,\"warningCount\":0}}]'\nexit 1\n", linted.display()),
        );
        let exit_two = executable_script(
            &root,
            "exit-two",
            "#!/bin/sh\necho 'Could not find config file.' >&2\nexit 2\n",
        );
        let bad_json = executable_script(
            &root,
            "bad-json",
            "#!/bin/sh\necho 'not-json'\necho 'bad JSON context' >&2\nexit 0\n",
        );

        let ok = run_eslint_analysis_blocking(
            root.to_str().expect("root"),
            Some(exit_one.to_str().expect("binary")),
        );
        assert_eq!(ok_parts(ok).0.len(), 1);
        assert_eq!(
            run_eslint_analysis_blocking(
                root.to_str().expect("root"),
                Some(exit_two.to_str().expect("binary")),
            ),
            EslintAnalysisResponse::Error {
                message: "Could not find config file.\n".to_string(),
            }
        );
        assert_eq!(
            run_eslint_analysis_blocking(
                root.to_str().expect("root"),
                Some(bad_json.to_str().expect("binary")),
            ),
            EslintAnalysisResponse::Error {
                message: "bad JSON context\n".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn builds_contract_argv_with_per_workspace_cache() {
        let cache_base = temp_workspace("eslint-cache-base");
        let root = Path::new("/workspace/project");
        let cache_dir = cache_base.join("3d0ae75b40dc9e45");

        assert_eq!(workspace_cache_dir(&cache_base, root), cache_dir);

        assert_eq!(
            eslint_args(root, &cache_base),
            vec![
                ".".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--no-color".to_string(),
                "--cache".to_string(),
                "--cache-location".to_string(),
                cache_dir.to_string_lossy().into_owned(),
            ]
        );
        assert!(cache_dir.is_dir());
        fs::remove_dir_all(cache_base).expect("cleanup cache base");
    }

    #[test]
    fn omits_cache_argv_when_cache_directory_cannot_be_created() {
        let root = temp_workspace("eslint-cache-fallback");
        let cache_base = root.join("not-a-directory");
        fs::write(&cache_base, "occupied").expect("create blocking file");

        assert_eq!(
            eslint_args(&root, &cache_base),
            vec![".", "--format", "json", "--no-color"]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn eslint_file(
        path: &Path,
        error_count: usize,
        warning_count: usize,
        message: &str,
    ) -> serde_json::Value {
        json!({
            "filePath": path,
            "messages": [{ "ruleId": "rule", "severity": 2, "message": message, "line": 1, "column": 1 }],
            "errorCount": error_count,
            "warningCount": warning_count
        })
    }

    fn parse_fixture(root: &Path, fixture: serde_json::Value) -> EslintAnalysisResponse {
        parse_eslint_output(root, fixture.to_string().as_bytes()).expect("valid ESLint fixture")
    }

    fn ok_parts(
        response: EslintAnalysisResponse,
    ) -> (Vec<super::EslintDiagnostic>, super::EslintTotals) {
        match response {
            EslintAnalysisResponse::Ok {
                diagnostics,
                totals,
            } => (diagnostics, totals),
            other => panic!("expected ok response, got {other:?}"),
        }
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{label}-{nanos}"));
        fs::create_dir_all(&path).expect("temp workspace");
        path.canonicalize().expect("canonical workspace")
    }

    #[cfg(unix)]
    fn executable_script(root: &Path, name: &str, contents: &str) -> PathBuf {
        let path = root.join(name);
        let mut file = fs::File::create(&path).expect("create script fixture");
        file.write_all(contents.as_bytes())
            .expect("write script fixture");
        let mut permissions = file.metadata().expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("make script executable");
        path
    }
}
