use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PintFormatResponse {
    Ok {
        #[serde(skip_serializing_if = "Option::is_none")]
        changed_files: Option<u64>,
    },
    Unavailable {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Error {
        message: String,
    },
}

pub async fn run_pint_format(
    root_path: String,
    relative_path: Option<String>,
) -> Result<PintFormatResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_pint_format_blocking(
            &root_path,
            relative_path.as_deref(),
        ))
    })
    .await
}

fn run_pint_format_blocking(root_path: &str, relative_path: Option<&str>) -> PintFormatResponse {
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return PintFormatResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let binary = match resolve_binary(&root) {
        Ok(Some(binary)) => binary,
        Ok(None) => return PintFormatResponse::Unavailable { message: None },
        Err(message) => return PintFormatResponse::Error { message },
    };
    let argument = match pint_argument(&root, relative_path) {
        Ok(argument) => argument,
        Err(message) => return PintFormatResponse::Error { message },
    };
    let output = match Command::new(binary)
        .arg(argument)
        .env("LC_ALL", "C")
        .current_dir(&root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return PintFormatResponse::Error {
                message: format!("Failed to run Pint: {error}"),
            };
        }
    };

    if output.status.success() {
        return PintFormatResponse::Ok {
            changed_files: parse_changed_files(&output.stdout),
        };
    }

    PintFormatResponse::Error {
        message: stderr_tail(&output.stderr),
    }
}

fn pint_argument(root: &Path, relative_path: Option<&str>) -> Result<String, String> {
    let Some(relative_path) = relative_path else {
        return Ok("--dirty".to_string());
    };

    if relative_path.trim().is_empty() || Path::new(relative_path).is_absolute() {
        return Err("Pint active file must be a workspace-relative PHP path.".to_string());
    }

    let target = root.join(relative_path);
    let target = target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Pint active file: {error}"))?;
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "Pint active file must be inside the workspace.".to_string())?;

    if !target.is_file() || target.extension().and_then(|value| value.to_str()) != Some("php") {
        return Err("Pint active file must be a PHP file inside the workspace.".to_string());
    }

    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn resolve_binary(root: &Path) -> Result<Option<PathBuf>, String> {
    let candidate = root.join("vendor").join("bin").join("pint");

    if !is_executable_file(&candidate) {
        return Ok(None);
    }

    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve Pint binary: {error}"))
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

fn parse_changed_files(stdout: &[u8]) -> Option<u64> {
    let output = String::from_utf8_lossy(stdout);

    if !output.contains("FIXED") {
        if output.contains("PASS") {
            return Some(0);
        }

        return None;
    }

    let tokens: Vec<&str> = output.split_whitespace().collect();

    for window in tokens.windows(2).rev() {
        if !matches!(
            window[1].trim_matches(|character: char| !character.is_alphabetic()),
            "file" | "files"
        ) {
            continue;
        }

        if let Ok(count) = window[0]
            .trim_matches(|character: char| !character.is_ascii_digit())
            .parse()
        {
            return Some(count);
        }
    }

    None
}

fn stderr_tail(stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let tail: String = stderr.chars().rev().take(2_000).collect();
    tail.chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::{pint_argument, run_pint_format_blocking, PintFormatResponse};
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
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
    fn write_pint(root: &Path, script: &str) {
        use std::os::unix::fs::PermissionsExt;

        let binary = root.join("vendor/bin/pint");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary dir");
        fs::write(&binary, script).expect("write pint");
        let mut permissions = fs::metadata(&binary).expect("pint metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(binary, permissions).expect("make pint executable");
    }

    #[test]
    fn missing_binary_is_unavailable() {
        let root = temp_workspace("pint-unavailable");
        let response = run_pint_format_blocking(root.to_str().expect("utf-8 root"), None);

        assert_eq!(response, PintFormatResponse::Unavailable { message: None });
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn script_fixture_reports_success_and_receives_dirty_argument() {
        let root = temp_workspace("pint-success");
        write_pint(
            &root,
            "#!/bin/sh\n[ \"$1\" = \"--dirty\" ] || exit 9\nprintf 'FIXED 2 files\\n'\n",
        );

        let response = run_pint_format_blocking(root.to_str().expect("utf-8 root"), None);

        assert_eq!(
            response,
            PintFormatResponse::Ok {
                changed_files: Some(2),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn script_fixture_receives_active_file_as_one_relative_argument() {
        let root = temp_workspace("pint-active-success");
        let target = root.join("app/Models/User.php");
        fs::create_dir_all(target.parent().expect("target parent")).expect("create target dir");
        fs::write(&target, "<?php").expect("write target");
        write_pint(
            &root,
            "#!/bin/sh\n[ \"$#\" = \"1\" ] || exit 8\n[ \"$1\" = \"app/Models/User.php\" ] || exit 9\nprintf 'FIXED 1 file\\n'\n",
        );

        let response = run_pint_format_blocking(
            root.to_str().expect("utf-8 root"),
            Some("app/Models/User.php"),
        );

        assert_eq!(
            response,
            PintFormatResponse::Ok {
                changed_files: Some(1),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn script_fixture_reports_no_changes_from_pass_summary() {
        let root = temp_workspace("pint-no-changes");
        write_pint(&root, "#!/bin/sh\nprintf 'PASS 4 files\\n'\n");

        let response = run_pint_format_blocking(root.to_str().expect("utf-8 root"), None);

        assert_eq!(
            response,
            PintFormatResponse::Ok {
                changed_files: Some(0),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn script_fixture_surfaces_failure_stderr() {
        let root = temp_workspace("pint-failure");
        let stderr = "x".repeat(2_100);
        write_pint(
            &root,
            &format!("#!/bin/sh\nprintf '%s' '{stderr}' >&2\nexit 3\n"),
        );

        let response = run_pint_format_blocking(root.to_str().expect("utf-8 root"), None);

        assert_eq!(
            response,
            PintFormatResponse::Error {
                message: "x".repeat(2_000),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn active_file_rejects_paths_outside_the_workspace() {
        let root = temp_workspace("pint-containment-root");
        let outside = root.parent().expect("parent").join(format!(
            "{}-outside.php",
            root.file_name().expect("root name").to_string_lossy()
        ));
        fs::write(&outside, "<?php").expect("write outside file");
        let relative = format!(
            "../{}",
            outside.file_name().expect("outside name").to_string_lossy()
        );

        let result = pint_argument(
            &root.canonicalize().expect("canonical root"),
            Some(&relative),
        );

        assert_eq!(
            result,
            Err("Pint active file must be inside the workspace.".to_string())
        );
        fs::remove_file(outside).expect("cleanup outside");
        fs::remove_dir_all(root).expect("cleanup root");
    }
}
