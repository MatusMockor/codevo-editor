use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

const PRETTIER_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

const PRETTIER_CONFIG_FILE_NAMES: &[&str] = &[
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.json5",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.toml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.ts",
    ".prettierrc.cts",
    ".prettierrc.mts",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
    "prettier.config.cts",
    "prettier.config.mts",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrettierErrorKind {
    Syntax,
    Timeout,
    InputTooLarge,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrettierFormatResponse {
    Ok {
        formatted: String,
    },
    Unavailable {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Error {
        kind: PrettierErrorKind,
        message: String,
    },
}

pub async fn run_prettier_format(
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<PrettierFormatResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_prettier_format_blocking(
            &root_path,
            &relative_path,
            &content,
            PRETTIER_TIMEOUT,
        ))
    })
    .await
}

fn run_prettier_format_blocking(
    root_path: &str,
    relative_path: &str,
    content: &str,
    timeout: Duration,
) -> PrettierFormatResponse {
    if content.len() > MAX_INPUT_BYTES {
        return PrettierFormatResponse::Error {
            kind: PrettierErrorKind::InputTooLarge,
            message: format!(
                "Prettier input exceeds the {MAX_INPUT_BYTES} byte limit ({} bytes).",
                content.len()
            ),
        };
    }
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Failed,
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let binary = match resolve_binary(&root) {
        Ok(Some(binary)) => binary,
        Ok(None) => return PrettierFormatResponse::Unavailable { message: None },
        Err(message) => {
            return PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Failed,
                message,
            };
        }
    };

    if !has_prettier_config(&root) {
        return PrettierFormatResponse::Unavailable {
            message: Some("No Prettier configuration found in the workspace.".to_string()),
        };
    }

    let stdin_filepath = match prettier_stdin_filepath(relative_path) {
        Ok(stdin_filepath) => stdin_filepath,
        Err(message) => {
            return PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Failed,
                message,
            };
        }
    };

    let child = Command::new(binary)
        .arg("--stdin-filepath")
        .arg(&stdin_filepath)
        .env("LC_ALL", "C")
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let child = match child {
        Ok(child) => child,
        Err(error) => {
            return PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Failed,
                message: format!("Failed to run Prettier: {error}"),
            };
        }
    };

    let (status, stdout, stderr) = match wait_with_timeout(child, content, timeout) {
        Ok(finished) => finished,
        Err(response) => return response,
    };

    classify_output(status, &stdout, &stderr)
}

fn classify_output(status: ExitStatus, stdout: &[u8], stderr: &[u8]) -> PrettierFormatResponse {
    if status.success() {
        return PrettierFormatResponse::Ok {
            formatted: String::from_utf8_lossy(stdout).into_owned(),
        };
    }

    let message = stderr_tail(stderr);

    if message.contains("SyntaxError") {
        return PrettierFormatResponse::Error {
            kind: PrettierErrorKind::Syntax,
            message,
        };
    }

    PrettierFormatResponse::Error {
        kind: PrettierErrorKind::Failed,
        message,
    }
}

fn wait_with_timeout(
    mut child: Child,
    content: &str,
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrettierFormatResponse> {
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let input = content.as_bytes().to_vec();
    let writer = std::thread::spawn(move || {
        let Some(mut stdin) = stdin else {
            return;
        };
        let _ = stdin.write_all(&input);
    });
    let stdout_reader = spawn_pipe_reader(stdout);
    let stderr_reader = spawn_pipe_reader(stderr);
    let deadline = Instant::now() + timeout;

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    join_pipe_threads(writer, stdout_reader, stderr_reader);
                    return Err(PrettierFormatResponse::Error {
                        kind: PrettierErrorKind::Timeout,
                        message: format!("Prettier timed out after {} ms.", timeout.as_millis()),
                    });
                }
                std::thread::sleep(WAIT_POLL_INTERVAL);
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                join_pipe_threads(writer, stdout_reader, stderr_reader);
                return Err(PrettierFormatResponse::Error {
                    kind: PrettierErrorKind::Failed,
                    message: format!("Failed to wait for Prettier: {error}"),
                });
            }
        }
    };

    let _ = writer.join();
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok((status, stdout, stderr))
}

fn spawn_pipe_reader<R>(pipe: Option<R>) -> std::thread::JoinHandle<Vec<u8>>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let Some(mut pipe) = pipe else {
            return Vec::new();
        };
        let mut buffer = Vec::new();
        let _ = pipe.read_to_end(&mut buffer);
        buffer
    })
}

fn join_pipe_threads(
    writer: std::thread::JoinHandle<()>,
    stdout_reader: std::thread::JoinHandle<Vec<u8>>,
    stderr_reader: std::thread::JoinHandle<Vec<u8>>,
) {
    let _ = writer.join();
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
}

fn prettier_stdin_filepath(relative_path: &str) -> Result<String, String> {
    if relative_path.trim().is_empty() || Path::new(relative_path).is_absolute() {
        return Err("Prettier target must be a workspace-relative file path.".to_string());
    }

    let only_normal_components = Path::new(relative_path)
        .components()
        .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));

    if !only_normal_components {
        return Err("Prettier target must stay inside the workspace.".to_string());
    }

    Ok(relative_path.replace('\\', "/"))
}

fn has_prettier_config(root: &Path) -> bool {
    if PRETTIER_CONFIG_FILE_NAMES
        .iter()
        .any(|name| root.join(name).is_file())
    {
        return true;
    }

    package_json_declares_prettier(&root.join("package.json"))
}

fn package_json_declares_prettier(manifest_path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(manifest_path) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(object) = manifest.as_object() else {
        return false;
    };

    object.contains_key("prettier")
}

fn resolve_binary(root: &Path) -> Result<Option<PathBuf>, String> {
    let candidate = root.join("node_modules").join(".bin").join("prettier");

    if !is_executable_file(&candidate) {
        return Ok(None);
    }

    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve Prettier binary: {error}"))
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
    let tail: String = stderr.chars().rev().take(2_000).collect();
    tail.chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::{
        has_prettier_config, prettier_stdin_filepath, run_prettier_format_blocking,
        PrettierErrorKind, PrettierFormatResponse, MAX_INPUT_BYTES, PRETTIER_TIMEOUT,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    fn temp_workspace(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("editor-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }

    #[cfg(unix)]
    fn write_prettier(root: &Path, script: &str) {
        use std::os::unix::fs::PermissionsExt;

        let binary = root.join("node_modules/.bin/prettier");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary dir");
        fs::write(&binary, script).expect("write prettier");
        let mut permissions = fs::metadata(&binary)
            .expect("prettier metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(binary, permissions).expect("make prettier executable");
    }

    fn write_config(root: &Path) {
        fs::write(root.join(".prettierrc"), "{}").expect("write config");
    }

    #[test]
    fn missing_binary_is_unavailable() {
        let root = temp_workspace("prettier-unavailable");
        write_config(&root);

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=1",
            PRETTIER_TIMEOUT,
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Unavailable { message: None }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn missing_config_is_unavailable_with_message() {
        let root = temp_workspace("prettier-no-config");
        write_prettier(&root, "#!/bin/sh\ncat\n");

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=1",
            PRETTIER_TIMEOUT,
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Unavailable {
                message: Some("No Prettier configuration found in the workspace.".to_string()),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn script_fixture_formats_stdin_with_stdin_filepath_argument() {
        let root = temp_workspace("prettier-success");
        write_config(&root);
        write_prettier(
            &root,
            "#!/bin/sh\n[ \"$#\" = \"2\" ] || exit 9\n[ \"$1\" = \"--stdin-filepath\" ] || exit 8\n[ \"$2\" = \"src/app.ts\" ] || exit 7\ncat\nprintf '\\n'\n",
        );

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=1",
            PRETTIER_TIMEOUT,
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Ok {
                formatted: "const value=1\n".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn syntax_failure_is_classified_as_syntax_error() {
        let root = temp_workspace("prettier-syntax");
        write_config(&root);
        write_prettier(
            &root,
            "#!/bin/sh\nprintf 'SyntaxError: Unexpected token (1:5)\\n' >&2\nexit 2\n",
        );

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=",
            PRETTIER_TIMEOUT,
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Syntax,
                message: "SyntaxError: Unexpected token (1:5)\n".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn other_failures_are_classified_as_failed() {
        let root = temp_workspace("prettier-failed");
        write_config(&root);
        write_prettier(
            &root,
            "#!/bin/sh\nprintf 'Cannot resolve configuration.\\n' >&2\nexit 2\n",
        );

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=1",
            PRETTIER_TIMEOUT,
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Failed,
                message: "Cannot resolve configuration.\n".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn slow_prettier_is_killed_and_reported_as_timeout() {
        let root = temp_workspace("prettier-timeout");
        write_config(&root);
        write_prettier(&root, "#!/bin/sh\nsleep 5\n");

        let started = std::time::Instant::now();
        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            "const value=1",
            Duration::from_millis(100),
        );

        assert_eq!(
            response,
            PrettierFormatResponse::Error {
                kind: PrettierErrorKind::Timeout,
                message: "Prettier timed out after 100 ms.".to_string(),
            }
        );
        assert!(started.elapsed() < Duration::from_secs(4));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn oversize_input_is_rejected_before_dispatch() {
        let root = temp_workspace("prettier-oversize");
        write_config(&root);
        let marker = root.join("prettier-ran");
        write_prettier(
            &root,
            &format!("#!/bin/sh\ntouch '{}'\ncat\n", marker.display()),
        );

        let response = run_prettier_format_blocking(
            root.to_str().expect("utf-8 root"),
            "src/app.ts",
            &"x".repeat(MAX_INPUT_BYTES + 1),
            PRETTIER_TIMEOUT,
        );

        match response {
            PrettierFormatResponse::Error { kind, message } => {
                assert_eq!(kind, PrettierErrorKind::InputTooLarge);
                assert!(message.contains("byte limit"));
            }
            other => panic!("expected input-too-large error, got {other:?}"),
        }
        assert!(!marker.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn stdin_filepath_rejects_empty_absolute_and_traversal_paths() {
        assert!(prettier_stdin_filepath("  ").is_err());
        assert!(prettier_stdin_filepath("/etc/passwd").is_err());
        assert!(prettier_stdin_filepath("../outside.ts").is_err());
        assert!(prettier_stdin_filepath("src/../../outside.ts").is_err());
        assert_eq!(
            prettier_stdin_filepath("src/app.ts"),
            Ok("src/app.ts".to_string())
        );
        assert_eq!(
            prettier_stdin_filepath("./src/app.ts"),
            Ok("./src/app.ts".to_string())
        );
    }

    #[test]
    fn config_detection_covers_rc_config_and_package_json_sources() {
        let rc_root = temp_workspace("prettier-config-rc");
        fs::write(rc_root.join(".prettierrc.json"), "{}").expect("write rc");
        assert!(has_prettier_config(&rc_root));
        fs::remove_dir_all(&rc_root).expect("cleanup rc");

        let config_root = temp_workspace("prettier-config-file");
        fs::write(config_root.join("prettier.config.mjs"), "export default {}")
            .expect("write config file");
        assert!(has_prettier_config(&config_root));
        fs::remove_dir_all(&config_root).expect("cleanup config");

        let manifest_root = temp_workspace("prettier-config-manifest");
        fs::write(
            manifest_root.join("package.json"),
            "{\"name\":\"app\",\"prettier\":{\"semi\":false}}",
        )
        .expect("write manifest");
        assert!(has_prettier_config(&manifest_root));
        fs::remove_dir_all(&manifest_root).expect("cleanup manifest");
    }

    #[test]
    fn config_detection_ignores_dependency_only_and_malformed_manifests() {
        let dependency_root = temp_workspace("prettier-config-dependency");
        fs::write(
            dependency_root.join("package.json"),
            "{\"devDependencies\":{\"prettier\":\"^3.0.0\"}}",
        )
        .expect("write manifest");
        assert!(!has_prettier_config(&dependency_root));
        fs::remove_dir_all(&dependency_root).expect("cleanup dependency");

        let malformed_root = temp_workspace("prettier-config-malformed");
        fs::write(malformed_root.join("package.json"), "not json {").expect("write manifest");
        assert!(!has_prettier_config(&malformed_root));
        fs::remove_dir_all(&malformed_root).expect("cleanup malformed");

        let empty_root = temp_workspace("prettier-config-empty");
        assert!(!has_prettier_config(&empty_root));
        fs::remove_dir_all(&empty_root).expect("cleanup empty");
    }
}
