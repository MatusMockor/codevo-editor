use crate::{
    debug_support::DebugProcessHandle,
    trust::WorkspaceTrustService,
    workspace_registry::{opened_root_path, WorkspaceId, WorkspaceRegistry},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::File,
    io::{self, Read},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

const MANIFEST_BYTES_LIMIT: usize = 256 * 1024;
const OUTPUT_BYTES_LIMIT: usize = 32 * 1024;
const RESPONSE_MESSAGE_BYTES_LIMIT: usize = 64 * 1024;
const PACKAGE_NAME_BYTES_LIMIT: usize = 214;
const PACKAGE_OPERATION_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WorkspacePackageOperation {
    Install,
    Update,
    Remove,
    Outdated,
}

#[derive(Clone, Debug)]
struct WorkspacePackageOperationRequest {
    workspace_id: WorkspaceId,
    operation: WorkspacePackageOperation,
    package_name: Option<String>,
    development: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePackageOperationPreview {
    manager: String,
    arguments: Vec<String>,
    description: String,
    mutates_manifest: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum WorkspacePackageOperationRunResponse {
    Ok {
        message: String,
        #[serde(rename = "manifestChanged")]
        manifest_changed: bool,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub(crate) fn preview_workspace_package_operation(
    registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    workspace_id: WorkspaceId,
    operation: WorkspacePackageOperation,
    package_name: Option<String>,
    development: Option<bool>,
) -> Result<WorkspacePackageOperationPreview, String> {
    let request = WorkspacePackageOperationRequest {
        workspace_id,
        operation,
        package_name,
        development,
    };
    authorize_and_plan(&registry, &trust, &request).map(|authorized| authorized.preview)
}

#[tauri::command]
pub(crate) async fn run_workspace_package_operation(
    app: AppHandle,
    workspace_id: WorkspaceId,
    operation: WorkspacePackageOperation,
    package_name: Option<String>,
    development: Option<bool>,
) -> Result<WorkspacePackageOperationRunResponse, String> {
    let request = WorkspacePackageOperationRequest {
        workspace_id,
        operation,
        package_name,
        development,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        // Package managers update the manifest and lockfile as a pair. Keep the registry's
        // operation lease for the complete re-derive + process lifetime so two IPC calls cannot
        // concurrently corrupt that pair or race workspace revocation.
        let _operation = registry
            .lock_operations()
            .map_err(|error| error.to_string())?;
        let authorized = authorize_and_plan_under_lock(&registry, &trust, &request)?;
        Ok(execute_authorized_operation(
            authorized,
            PACKAGE_OPERATION_TIMEOUT,
        ))
    })
    .await
    .map_err(|error| format!("Package operation worker failed: {error}"))?
}

#[derive(Debug)]
struct AuthorizedPackageOperation {
    operation: WorkspacePackageOperation,
    preview: WorkspacePackageOperationPreview,
    root: File,
    root_identity: std::path::PathBuf,
}

fn authorize_and_plan(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: &WorkspacePackageOperationRequest,
) -> Result<AuthorizedPackageOperation, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    authorize_and_plan_under_lock(registry, trust, request)
}

fn authorize_and_plan_under_lock(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: &WorkspacePackageOperationRequest,
) -> Result<AuthorizedPackageOperation, String> {
    let descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| "Package operation workspace is not registered.".to_string())?;
    let root = registry
        .clone_root(&request.workspace_id)
        .map_err(|_| "Package operation workspace is not registered.".to_string())?;
    let captured_root = opened_root_path(&root)
        .map_err(|error| format!("Failed to capture workspace root identity: {error}"))?;
    if captured_root != descriptor.canonical_root_path {
        return Err("Registered workspace root identity changed.".to_string());
    }
    let trust_root = descriptor
        .selected_root_path
        .to_str()
        .ok_or_else(|| "Workspace root path is not valid UTF-8.".to_string())?;
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(trust_root)
        .trusted
    {
        return Err("Trust this workspace before running package operations.".to_string());
    }

    let manager = detect_package_manager(registry, &request.workspace_id)?;
    let preview = build_preview(&manager, request)?;
    Ok(AuthorizedPackageOperation {
        operation: request.operation,
        preview,
        root,
        root_identity: captured_root,
    })
}

fn detect_package_manager(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
) -> Result<String, String> {
    match registry.open_descendant(workspace_id, "package.json".as_ref()) {
        Ok(file) => {
            let package_json = read_bounded_utf8(file, MANIFEST_BYTES_LIMIT)?;
            let manifest: Value = serde_json::from_str(&package_json)
                .map_err(|error| format!("package.json is not valid JSON: {error}"))?;
            if let Some(declared) = manifest.get("packageManager").and_then(Value::as_str) {
                let manager = declared.split('@').next().unwrap_or_default().trim();
                if is_allowed_manager(manager) {
                    return Ok(manager.to_string());
                }
                return Err(format!(
                    "Unsupported package manager declared in package.json: {manager}"
                ));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to inspect package.json safely: {error}")),
    }

    for (lockfile, manager) in [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ] {
        match registry.open_descendant(workspace_id, lockfile.as_ref()) {
            Ok(_) => return Ok(manager.to_string()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("Failed to inspect {lockfile} safely: {error}"));
            }
        }
    }
    Ok("npm".to_string())
}

fn is_allowed_manager(manager: &str) -> bool {
    matches!(manager, "npm" | "pnpm" | "yarn" | "bun")
}

fn build_preview(
    manager: &str,
    request: &WorkspacePackageOperationRequest,
) -> Result<WorkspacePackageOperationPreview, String> {
    if !is_allowed_manager(manager) {
        return Err("Unsupported package manager.".to_string());
    }
    if request.development.is_some() && request.operation != WorkspacePackageOperation::Install {
        return Err("The development flag is only valid for install operations.".to_string());
    }
    let package_name = match request.operation {
        WorkspacePackageOperation::Outdated => {
            if request.package_name.is_some() {
                return Err("Outdated does not accept a package name.".to_string());
            }
            None
        }
        _ => Some(validate_package_name(
            request
                .package_name
                .as_deref()
                .ok_or_else(|| "A package name is required for this operation.".to_string())?,
        )?),
    };
    let package_name = package_name.map(str::to_string);
    let mut arguments = Vec::new();
    match (manager, request.operation) {
        ("npm", WorkspacePackageOperation::Install) => {
            arguments.push("install".into());
            if request.development.unwrap_or(false) {
                arguments.push("--save-dev".into());
            }
        }
        ("pnpm" | "yarn" | "bun", WorkspacePackageOperation::Install) => {
            arguments.push("add".into());
            if request.development.unwrap_or(false) {
                arguments.push(
                    if manager == "pnpm" {
                        "--save-dev"
                    } else {
                        "--dev"
                    }
                    .into(),
                );
            }
        }
        ("yarn", WorkspacePackageOperation::Update) => arguments.push("up".into()),
        (_, WorkspacePackageOperation::Update) => arguments.push("update".into()),
        (_, WorkspacePackageOperation::Remove) => arguments.push("remove".into()),
        ("yarn", WorkspacePackageOperation::Outdated) => {
            return Err(
                "Outdated package checks are unavailable for Yarn because modern Yarn has no core outdated command."
                    .to_string(),
            );
        }
        (_, WorkspacePackageOperation::Outdated) => arguments.push("outdated".into()),
        _ => return Err("Unsupported package operation.".to_string()),
    }
    if let Some(package_name) = &package_name {
        arguments.push(package_name.clone());
    }
    let operation = match request.operation {
        WorkspacePackageOperation::Install => "Install",
        WorkspacePackageOperation::Update => "Update",
        WorkspacePackageOperation::Remove => "Remove",
        WorkspacePackageOperation::Outdated => "Check outdated packages",
    };
    let description = package_name
        .map(|name| format!("{operation} {name} with {manager}"))
        .unwrap_or_else(|| format!("{operation} with {manager}"));
    Ok(WorkspacePackageOperationPreview {
        manager: manager.to_string(),
        arguments,
        description,
        mutates_manifest: request.operation != WorkspacePackageOperation::Outdated,
    })
}

fn validate_package_name(package_name: &str) -> Result<&str, String> {
    if package_name.is_empty()
        || package_name.len() > PACKAGE_NAME_BYTES_LIMIT
        || !package_name.is_ascii()
        || package_name.starts_with('.')
        || package_name.starts_with('-')
        || package_name.contains(char::is_whitespace)
    {
        return Err("Package name is invalid.".to_string());
    }
    let segments = if let Some(scoped) = package_name.strip_prefix('@') {
        let mut segments = scoped.split('/');
        let scope = segments.next().unwrap_or_default();
        let name = segments.next().unwrap_or_default();
        if scope.is_empty() || name.is_empty() || segments.next().is_some() {
            return Err("Package name is invalid.".to_string());
        }
        vec![scope, name]
    } else {
        if package_name.contains('/') {
            return Err("Package name is invalid.".to_string());
        }
        vec![package_name]
    };
    if segments.iter().any(|segment| {
        segment.starts_with(['.', '-'])
            || !segment.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-._~".contains(&byte)
            })
    }) {
        return Err("Package name is invalid.".to_string());
    }
    Ok(package_name)
}

fn execute_authorized_operation(
    authorized: AuthorizedPackageOperation,
    timeout: Duration,
) -> WorkspacePackageOperationRunResponse {
    if !opened_root_path(&authorized.root).is_ok_and(|current| current == authorized.root_identity)
    {
        return WorkspacePackageOperationRunResponse::Error {
            message: "Registered workspace root identity is no longer available.".to_string(),
        };
    }
    execute_process(
        &authorized.preview.manager,
        &authorized.preview.arguments,
        authorized.root,
        authorized.preview.mutates_manifest,
        authorized.operation,
        timeout,
    )
}

fn execute_process(
    binary: &str,
    arguments: &[String],
    root: File,
    manifest_changed: bool,
    operation: WorkspacePackageOperation,
    timeout: Duration,
) -> WorkspacePackageOperationRunResponse {
    let mut command = Command::new(binary);
    command
        .args(arguments)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        let root_fd = root.as_raw_fd();
        command.pre_exec(move || {
            if libc::fchdir(root_fd) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setpgid(0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    #[cfg(not(unix))]
    command.current_dir(opened_root_path(&root).unwrap_or_default());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return WorkspacePackageOperationRunResponse::Unavailable {
                message: format!("Package manager {binary} is not available."),
            };
        }
        Err(error) => {
            return WorkspacePackageOperationRunResponse::Error {
                message: format!("Failed to start package manager {binary}: {error}"),
            };
        }
    };
    let stdout = child
        .stdout
        .take()
        .map(|pipe| thread::spawn(move || bounded_output(pipe)));
    let stderr = child
        .stderr
        .take()
        .map(|pipe| thread::spawn(move || bounded_output(pipe)));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                DebugProcessHandle::from_process_id(child.id()).terminate();
                let _ = child.wait();
                break Err(format!(
                    "Package operation timed out after {} seconds.",
                    timeout.as_secs_f64()
                ));
            }
            Err(error) => {
                DebugProcessHandle::from_process_id(child.id()).terminate();
                let _ = child.wait();
                break Err(format!("Failed to inspect package manager: {error}"));
            }
        }
    };
    let stdout = join_output(stdout);
    let stderr = join_output(stderr);
    match status {
        Ok(status)
            if status.success()
                || (operation == WorkspacePackageOperation::Outdated
                    && status.code() == Some(1)) =>
        {
            WorkspacePackageOperationRunResponse::Ok {
                message: output_message(&stdout, &stderr, "Package operation completed."),
                manifest_changed,
            }
        }
        Ok(status) => WorkspacePackageOperationRunResponse::Error {
            message: output_message(
                &stdout,
                &stderr,
                &format!("Package manager exited with status {status}."),
            ),
        },
        Err(message) => WorkspacePackageOperationRunResponse::Error {
            message: output_message(&stdout, &stderr, &message),
        },
    }
}

trait PackageOutput: Read + Send + 'static {}
impl PackageOutput for ChildStdout {}
impl PackageOutput for ChildStderr {}

fn bounded_output(mut pipe: impl PackageOutput) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut chunk = [0_u8; 4096];
    while let Ok(read) = pipe.read(&mut chunk) {
        if read == 0 {
            break;
        }
        tail.extend_from_slice(&chunk[..read]);
        if tail.len() > OUTPUT_BYTES_LIMIT {
            tail.drain(..tail.len() - OUTPUT_BYTES_LIMIT);
        }
    }
    tail
}

fn join_output(handle: Option<thread::JoinHandle<Vec<u8>>>) -> String {
    handle
        .and_then(|handle| handle.join().ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
        .unwrap_or_default()
}

fn output_message(stdout: &str, stderr: &str, fallback: &str) -> String {
    let message = match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (true, true) => fallback.to_string(),
    };
    if message.len() <= RESPONSE_MESSAGE_BYTES_LIMIT {
        return message;
    }
    let mut start = message.len() - RESPONSE_MESSAGE_BYTES_LIMIT;
    while !message.is_char_boundary(start) {
        start += 1;
    }
    message[start..].to_string()
}

fn read_bounded_utf8(mut file: File, limit: usize) -> Result<String, String> {
    let mut bytes = Vec::new();
    file.by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    if bytes.len() > limit {
        return Err("package.json exceeds the 256 KiB limit.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "package.json is not valid UTF-8.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn workspace(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-package-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("workspace");
        root
    }

    fn request(
        operation: WorkspacePackageOperation,
        package_name: Option<&str>,
    ) -> WorkspacePackageOperationRequest {
        WorkspacePackageOperationRequest {
            workspace_id: serde_json::from_str(r#""test""#).expect("workspace id"),
            operation,
            package_name: package_name.map(str::to_string),
            development: None,
        }
    }

    fn trust(root: &Path) -> Mutex<WorkspaceTrustService> {
        let service = WorkspaceTrustService::load(root.join("trust.json")).expect("trust service");
        Mutex::new(service)
    }

    #[test]
    fn manager_arguments_are_deterministic() {
        let mut install = request(WorkspacePackageOperation::Install, Some("@scope/pkg"));
        install.development = Some(true);
        assert_eq!(
            build_preview("npm", &install).expect("npm").arguments,
            ["install", "--save-dev", "@scope/pkg"]
        );
        assert_eq!(
            build_preview("pnpm", &install).expect("pnpm").arguments,
            ["add", "--save-dev", "@scope/pkg"]
        );
        assert_eq!(
            build_preview("yarn", &install)
                .expect("yarn install")
                .arguments,
            ["add", "--dev", "@scope/pkg"]
        );
        assert_eq!(
            build_preview(
                "yarn",
                &request(WorkspacePackageOperation::Update, Some("react"))
            )
            .expect("yarn")
            .arguments,
            ["up", "react"]
        );
        assert_eq!(
            build_preview(
                "bun",
                &request(WorkspacePackageOperation::Remove, Some("react"))
            )
            .expect("bun")
            .arguments,
            ["remove", "react"]
        );
        assert_eq!(
            build_preview("npm", &request(WorkspacePackageOperation::Outdated, None))
                .expect("outdated")
                .arguments,
            ["outdated"]
        );
        assert!(
            build_preview("yarn", &request(WorkspacePackageOperation::Outdated, None))
                .expect_err("modern yarn has no outdated command")
                .contains("unavailable for Yarn")
        );
    }

    #[test]
    fn package_names_reject_argument_and_shell_injection() {
        for invalid in [
            "--ignore-scripts",
            "react;touch-pwned",
            "react $(id)",
            "react@latest",
            "@scope/pkg/extra",
            "UPPERCASE",
            "../react",
        ] {
            assert!(
                validate_package_name(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        assert_eq!(
            validate_package_name("@scope/pkg-name"),
            Ok("@scope/pkg-name")
        );
    }

    #[test]
    fn operation_specific_optional_fields_fail_closed() {
        assert!(build_preview(
            "npm",
            &request(WorkspacePackageOperation::Outdated, Some("react"))
        )
        .expect_err("outdated package")
        .contains("does not accept"));
        let mut update = request(WorkspacePackageOperation::Update, Some("react"));
        update.development = Some(false);
        assert!(build_preview("npm", &update)
            .expect_err("development update")
            .contains("only valid for install"));
    }

    #[test]
    fn responses_serialize_to_the_exact_camel_case_wire_contract() {
        assert_eq!(
            serde_json::to_value(WorkspacePackageOperationRunResponse::Ok {
                message: "done".into(),
                manifest_changed: true,
            })
            .expect("response"),
            serde_json::json!({
                "status": "ok",
                "message": "done",
                "manifestChanged": true
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspacePackageOperationPreview {
                manager: "npm".into(),
                arguments: vec!["outdated".into()],
                description: "Check outdated packages with npm".into(),
                mutates_manifest: false,
            })
            .expect("preview"),
            serde_json::json!({
                "manager": "npm",
                "arguments": ["outdated"],
                "description": "Check outdated packages with npm",
                "mutatesManifest": false
            })
        );
    }

    #[test]
    fn unregistered_and_untrusted_workspaces_are_rejected() {
        let root = workspace("trust");
        fs::write(root.join("package.json"), r#"{"packageManager":"npm@10"}"#).expect("manifest");
        let registry = WorkspaceRegistry::new();
        let unregistered = request(WorkspacePackageOperation::Outdated, None);
        assert!(authorize_and_plan(&registry, &trust(&root), &unregistered)
            .expect_err("unregistered")
            .contains("not registered"));

        let descriptor = registry.register(&root).expect("register");
        let registered = WorkspacePackageOperationRequest {
            workspace_id: descriptor.workspace_id,
            ..unregistered
        };
        assert!(authorize_and_plan(&registry, &trust(&root), &registered)
            .expect_err("untrusted")
            .contains("Trust this workspace"));

        let trusted = trust(&root);
        trusted
            .lock()
            .expect("trust lock")
            .set(root.to_str().expect("root"), true)
            .expect("set trust");
        assert_eq!(
            authorize_and_plan(&registry, &trusted, &registered)
                .expect("trusted")
                .preview
                .manager,
            "npm"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn package_manager_comes_from_manifest_then_lockfiles() {
        let root = workspace("manager");
        fs::write(
            root.join("package.json"),
            r#"{"packageManager":"yarn@4.9.0"}"#,
        )
        .expect("manifest");
        fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: 9").expect("lockfile");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register");
        assert_eq!(
            detect_package_manager(&registry, &descriptor.workspace_id),
            Ok("yarn".into())
        );
        fs::write(root.join("package.json"), "{}").expect("manifest");
        assert_eq!(
            detect_package_manager(&registry, &descriptor.workspace_id),
            Ok("pnpm".into())
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn selected_root_trust_authorizes_an_alias_while_execution_keeps_canonical_identity() {
        let root = workspace("alias-target");
        fs::write(root.join("package.json"), r#"{"packageManager":"npm@10"}"#).expect("manifest");
        let alias = root.with_extension("alias");
        symlink(&root, &alias).expect("alias");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&alias).expect("register alias");
        let trusted = trust(&root);
        trusted
            .lock()
            .expect("trust lock")
            .set(alias.to_str().expect("alias"), true)
            .expect("set alias trust");
        let authorized = authorize_and_plan(
            &registry,
            &trusted,
            &WorkspacePackageOperationRequest {
                workspace_id: descriptor.workspace_id,
                operation: WorkspacePackageOperation::Outdated,
                package_name: None,
                development: None,
            },
        )
        .expect("authorized alias");
        assert_eq!(authorized.root_identity, root.canonicalize().expect("root"));
        fs::remove_file(alias).expect("remove alias");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn process_capture_is_bounded_and_timeout_terminates_process_group() {
        let root_path = workspace("process");
        let script = root_path.join("fixture.sh");
        fs::write(
            &script,
            "#!/bin/sh\ncase \"$1\" in noisy) yes x | head -c 100000;; exit-one) exit 1;; *) sleep 30;; esac\n",
        )
        .expect("script");
        let mut permissions = fs::metadata(&script).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script, permissions).expect("permissions");

        let noisy = execute_process(
            script.to_str().expect("script"),
            &["noisy".into()],
            File::open(&root_path).expect("root"),
            false,
            WorkspacePackageOperation::Install,
            Duration::from_secs(2),
        );
        let WorkspacePackageOperationRunResponse::Ok { message, .. } = noisy else {
            panic!("noisy command failed: {noisy:?}");
        };
        assert!(message.len() <= OUTPUT_BYTES_LIMIT);

        assert!(matches!(
            execute_process(
                "/codevo/nonexistent/package-manager",
                &[],
                File::open(&root_path).expect("root"),
                false,
                WorkspacePackageOperation::Install,
                Duration::from_secs(1),
            ),
            WorkspacePackageOperationRunResponse::Unavailable { .. }
        ));

        assert!(matches!(
            execute_process(
                script.to_str().expect("script"),
                &["exit-one".into()],
                File::open(&root_path).expect("root"),
                false,
                WorkspacePackageOperation::Outdated,
                Duration::from_secs(1),
            ),
            WorkspacePackageOperationRunResponse::Ok {
                manifest_changed: false,
                ..
            }
        ));

        let timed_out = execute_process(
            script.to_str().expect("script"),
            &["slow".into()],
            File::open(&root_path).expect("root"),
            false,
            WorkspacePackageOperation::Install,
            Duration::from_millis(50),
        );
        assert!(matches!(
            timed_out,
            WorkspacePackageOperationRunResponse::Error { message }
                if message.contains("timed out")
        ));
        fs::remove_dir_all(root_path).expect("cleanup");
    }
}
