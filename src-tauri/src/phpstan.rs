use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const MAX_DIAGNOSTICS: usize = 2_000;
const PHPSTAN_MEMORY_LIMIT: &str = "--memory-limit=1G";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpStanDiagnostic {
    pub file_path: String,
    pub line: Option<u64>,
    pub message: String,
    pub identifier: Option<String>,
    pub ignorable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpStanTotals {
    pub file_errors: u64,
    pub general_errors: u64,
    pub file_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PhpStanAnalysisResponse {
    Ok {
        diagnostics: Vec<PhpStanDiagnostic>,
        totals: PhpStanTotals,
    },
    Unavailable,
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn run_phpstan_analysis(
    root_path: String,
    binary_path: Option<String>,
    config_path: Option<String>,
) -> Result<PhpStanAnalysisResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_phpstan_analysis_blocking(
            &root_path,
            binary_path.as_deref(),
            config_path.as_deref(),
        ))
    })
    .await
}

fn run_phpstan_analysis_blocking(
    root_path: &str,
    binary_path: Option<&str>,
    config_path: Option<&str>,
) -> PhpStanAnalysisResponse {
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return PhpStanAnalysisResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let binary = match resolve_binary(&root, binary_path) {
        Ok(Some(binary)) => binary,
        Ok(None) => return PhpStanAnalysisResponse::Unavailable,
        Err(message) => return PhpStanAnalysisResponse::Error { message },
    };
    let mut command = Command::new(binary);
    command
        .args(phpstan_args(config_path))
        .env("LC_ALL", "C")
        .current_dir(&root);

    // Known limitation: no subprocess-timeout crate is currently available in Cargo.toml.
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => {
            return PhpStanAnalysisResponse::Error {
                message: format!("Failed to run PHPStan: {error}"),
            };
        }
    };
    let exit_code = output.status.code();

    if matches!(exit_code, Some(0 | 1)) {
        return match parse_phpstan_output(&root, &output.stdout) {
            Ok(response) => response,
            Err(_) => PhpStanAnalysisResponse::Error {
                message: stderr_tail(&output.stderr),
            },
        };
    }

    PhpStanAnalysisResponse::Error {
        message: stderr_tail(&output.stderr),
    }
}

#[derive(Deserialize)]
struct PhpStanOutput {
    totals: PhpStanOutputTotals,
    files: BTreeMap<String, PhpStanOutputFile>,
    errors: Vec<String>,
}

#[derive(Deserialize)]
struct PhpStanOutputTotals {
    errors: u64,
    file_errors: u64,
}

#[derive(Deserialize)]
struct PhpStanOutputFile {
    #[serde(rename = "errors")]
    errors: u64,
    messages: Vec<PhpStanOutputMessage>,
}

#[derive(Deserialize)]
struct PhpStanOutputMessage {
    message: String,
    line: Option<u64>,
    #[serde(default)]
    ignorable: bool,
    #[serde(default)]
    identifier: Option<String>,
}

fn parse_phpstan_output(root: &Path, stdout: &[u8]) -> Result<PhpStanAnalysisResponse, String> {
    let output: PhpStanOutput =
        serde_json::from_slice(stdout).map_err(|error| error.to_string())?;
    let file_count = output.files.values().filter(|file| file.errors > 0).count() as u64;
    let mut diagnostics = Vec::with_capacity(
        MAX_DIAGNOSTICS.min(
            output
                .files
                .values()
                .map(|file| file.messages.len())
                .sum::<usize>()
                + output.errors.len(),
        ),
    );

    for (file_path, file) in output.files {
        let absolute_path = Path::new(&file_path);
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
            diagnostics.push(PhpStanDiagnostic {
                file_path: relative_path.clone(),
                line: message.line,
                message: message.message,
                identifier: message.identifier,
                ignorable: message.ignorable,
            });
        }
    }

    for message in output.errors {
        if diagnostics.len() == MAX_DIAGNOSTICS {
            break;
        }
        diagnostics.push(PhpStanDiagnostic {
            file_path: String::new(),
            line: None,
            message,
            identifier: None,
            ignorable: false,
        });
    }

    Ok(PhpStanAnalysisResponse::Ok {
        diagnostics,
        totals: PhpStanTotals {
            file_errors: output.totals.file_errors,
            general_errors: output.totals.errors,
            file_count,
        },
    })
}

fn phpstan_args(config_path: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "analyse".to_string(),
        "--error-format=json".to_string(),
        "--no-progress".to_string(),
        PHPSTAN_MEMORY_LIMIT.to_string(),
    ];
    if let Some(config_path) = config_path {
        args.push("-c".to_string());
        args.push(config_path.to_string());
    }
    args
}

fn resolve_binary(root: &Path, binary_path: Option<&str>) -> Result<Option<PathBuf>, String> {
    let (candidate, is_explicit) = match binary_path {
        Some(path) if path.trim().is_empty() => {
            return Err("PHPStan binary path must not be empty.".to_string());
        }
        Some(path) => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                (path, true)
            } else {
                (root.join(path), true)
            }
        }
        None => (root.join("vendor").join("bin").join("phpstan"), false),
    };

    if !is_executable_file(&candidate) {
        if is_explicit {
            return Err(format!(
                "Configured PHPStan binary is missing or not executable: {}",
                candidate.display()
            ));
        }
        return Ok(None);
    }

    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve PHPStan binary: {error}"))
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
        parse_phpstan_output, phpstan_args, run_phpstan_analysis_blocking, PhpStanAnalysisResponse,
        MAX_DIAGNOSTICS,
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
    fn parses_file_messages_into_workspace_relative_diagnostics() {
        let root = temp_workspace("phpstan-files");
        let file = root.join("app").join("Service.php");
        let fixture = json!({
            "totals": { "errors": 0, "file_errors": 1 },
            "files": {
                file.to_string_lossy().to_string(): {
                    "errors": 1,
                    "messages": [{
                        "message": "Method is missing a return type.",
                        "line": 12,
                        "ignorable": true,
                        "identifier": "missingType.return"
                    }]
                }
            },
            "errors": []
        });

        let response = parse_fixture(&root, fixture);
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file_path, "app/Service.php");
        assert_eq!(diagnostics[0].line, Some(12));
        assert_eq!(diagnostics[0].message, "Method is missing a return type.");
        assert_eq!(
            diagnostics[0].identifier.as_deref(),
            Some("missingType.return")
        );
        assert!(diagnostics[0].ignorable);
        assert_eq!(totals.file_errors, 1);
        assert_eq!(totals.general_errors, 0);
        assert_eq!(totals.file_count, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_general_errors_without_a_file_or_line() {
        let root = temp_workspace("phpstan-general");
        let response = parse_fixture(
            &root,
            json!({
                "totals": { "errors": 2, "file_errors": 0 },
                "files": {},
                "errors": ["Invalid configuration.", "Bootstrap failed."]
            }),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].file_path, "");
        assert_eq!(diagnostics[0].line, None);
        assert_eq!(diagnostics[0].message, "Invalid configuration.");
        assert_eq!(diagnostics[0].identifier, None);
        assert!(!diagnostics[0].ignorable);
        assert_eq!(totals.general_errors, 2);
        assert_eq!(totals.file_count, 0);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn defaults_optional_message_fields_when_absent() {
        let root = temp_workspace("phpstan-defaults");
        let file = root.join("Legacy.php");
        let response = parse_fixture(
            &root,
            json!({
                "totals": { "errors": 0, "file_errors": 1 },
                "files": {
                    file.to_string_lossy().to_string(): {
                        "errors": 1,
                        "messages": [{ "message": "Unknown symbol.", "line": 3 }]
                    }
                },
                "errors": []
            }),
        );
        let (diagnostics, _) = ok_parts(response);

        assert_eq!(diagnostics[0].identifier, None);
        assert!(!diagnostics[0].ignorable);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn drops_files_outside_root_and_normalizes_relative_separators() {
        let root = temp_workspace("phpstan-root");
        let inside = root.join("nested").join("File.php");
        let outside = root.parent().expect("parent").join("Outside.php");
        let response = parse_fixture(
            &root,
            json!({
                "totals": { "errors": 0, "file_errors": 2 },
                "files": {
                    inside.to_string_lossy().to_string(): {
                        "errors": 1,
                        "messages": [{ "message": "Inside", "line": 1 }]
                    },
                    outside.to_string_lossy().to_string(): {
                        "errors": 1,
                        "messages": [{ "message": "Outside", "line": 2 }]
                    }
                },
                "errors": []
            }),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file_path, "nested/File.php");
        assert_eq!(totals.file_errors, 2);
        assert_eq!(totals.file_count, 2);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn caps_diagnostics_without_changing_reported_totals() {
        let root = temp_workspace("phpstan-cap");
        let file = root.join("Many.php");
        let messages: Vec<_> = (0..(MAX_DIAGNOSTICS + 10))
            .map(|line| json!({ "message": format!("Error {line}"), "line": line + 1 }))
            .collect();
        let response = parse_fixture(
            &root,
            json!({
                "totals": { "errors": 7, "file_errors": MAX_DIAGNOSTICS + 10 },
                "files": {
                    file.to_string_lossy().to_string(): {
                        "errors": MAX_DIAGNOSTICS + 10,
                        "messages": messages
                    }
                },
                "errors": ["General overflow"]
            }),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), MAX_DIAGNOSTICS);
        assert_eq!(totals.file_errors, (MAX_DIAGNOSTICS + 10) as u64);
        assert_eq!(totals.general_errors, 7);
        assert_eq!(totals.file_count, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_unavailable_without_explicit_or_workspace_binary() {
        let root = temp_workspace("phpstan-unavailable");

        let response =
            run_phpstan_analysis_blocking(root.to_str().expect("utf-8 root"), None, None);

        assert_eq!(response, PhpStanAnalysisResponse::Unavailable);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_error_for_missing_explicit_binary() {
        let root = temp_workspace("phpstan-missing-explicit");
        let configured = root.join("tools").join("phpstan");

        let response = run_phpstan_analysis_blocking(
            root.to_str().expect("utf-8 root"),
            Some(configured.to_str().expect("utf-8 binary path")),
            None,
        );

        match response {
            PhpStanAnalysisResponse::Error { message } => {
                assert!(message.contains(configured.to_str().expect("utf-8 binary path")));
                assert!(message.contains("missing or not executable"));
            }
            other => panic!("expected error response, got {other:?}"),
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn reports_process_and_json_failures_with_stderr() {
        let root = temp_workspace("phpstan-script-errors");
        let exit_two = executable_script(
            &root,
            "exit-two",
            "#!/bin/sh\necho 'configuration exploded' >&2\nexit 2\n",
        );
        let bad_json = executable_script(
            &root,
            "bad-json",
            "#!/bin/sh\necho 'not-json'\necho 'parser context from stderr' >&2\nexit 0\n",
        );

        let exit_response = run_phpstan_analysis_blocking(
            root.to_str().expect("utf-8 root"),
            Some(exit_two.to_str().expect("utf-8 binary path")),
            None,
        );
        assert_eq!(
            exit_response,
            PhpStanAnalysisResponse::Error {
                message: "configuration exploded\n".to_string(),
            }
        );

        let json_response = run_phpstan_analysis_blocking(
            root.to_str().expect("utf-8 root"),
            Some(bad_json.to_str().expect("utf-8 binary path")),
            None,
        );
        assert_eq!(
            json_response,
            PhpStanAnalysisResponse::Error {
                message: "parser context from stderr\n".to_string(),
            }
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn builds_contract_argv_with_optional_config() {
        assert_eq!(
            phpstan_args(None),
            vec![
                "analyse",
                "--error-format=json",
                "--no-progress",
                "--memory-limit=1G"
            ]
        );
        assert_eq!(
            phpstan_args(Some("phpstan.neon")),
            vec![
                "analyse",
                "--error-format=json",
                "--no-progress",
                "--memory-limit=1G",
                "-c",
                "phpstan.neon"
            ]
        );
    }

    fn parse_fixture(root: &Path, fixture: serde_json::Value) -> PhpStanAnalysisResponse {
        parse_phpstan_output(root, fixture.to_string().as_bytes()).expect("valid PHPStan fixture")
    }

    fn ok_parts(
        response: PhpStanAnalysisResponse,
    ) -> (Vec<super::PhpStanDiagnostic>, super::PhpStanTotals) {
        match response {
            PhpStanAnalysisResponse::Ok {
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
