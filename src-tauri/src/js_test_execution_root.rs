use crate::js_test_run::JsTestRunScope;
#[cfg(unix)]
#[path = "js_test_path_snapshot.rs"]
mod path_snapshot;
#[cfg(unix)]
use path_snapshot::{RetainedPathSnapshot, RetainedUnixIdentity};
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "js_test_node_loader.rs"]
mod node_loader;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use node_loader::{retained_node_loader_registration, RetainedNodeModuleKind};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
    process::Command,
};

pub(crate) const MAX_JS_TEST_PACKAGE_ROOT_BYTES: usize = 4_096;

pub(crate) struct JsTestExecutionContext {
    pub(crate) execution_root: PathBuf,
    pub(crate) package_root_path: PathBuf,
    pub(crate) scope: JsTestRunScope,
    workspace_root_path: PathBuf,
    #[cfg(unix)]
    workspace_root_descriptor: fs::File,
    #[cfg(unix)]
    execution_root_descriptor: fs::File,
    #[cfg(unix)]
    workspace_path_snapshot: RetainedPathSnapshot,
    #[cfg(unix)]
    execution_path_snapshot: RetainedPathSnapshot,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) struct RetainedJsTestProcessAuthority {
    binary_descriptor: fs::File,
    binary_file_name: String,
    binary_path: PathBuf,
    binary_requested_path: PathBuf,
    runner_parent_descriptor: fs::File,
    runner_parent_path: PathBuf,
    runner_parent_authority_path: String,
    execution_root_descriptor: fs::File,
    execution_root_path: PathBuf,
    execution_root_authority_path: String,
    workspace_root_descriptor: fs::File,
    workspace_root_path: PathBuf,
    binary_path_snapshot: RetainedPathSnapshot,
    binary_requested_path_snapshot: RetainedPathSnapshot,
    package_manifest_authority: Option<RetainedNodePackageAuthority>,
    node_interpreter: Option<(fs::File, String)>,
    launcher: RetainedJsTestLauncher,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct RetainedNodePackageAuthority {
    descriptor: fs::File,
    path: PathBuf,
    snapshot: RetainedPathSnapshot,
    c_path: std::ffi::CString,
    identity: RetainedUnixIdentity,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[derive(Clone, Copy)]
enum RetainedJsTestLauncher {
    Shell,
    Node {
        module_kind: RetainedNodeModuleKind,
        root_option: &'static str,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum RetainedJsTestRunnerKind {
    Vitest,
    Jest,
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) struct RetainedJsTestProcessAuthority;

pub(crate) fn resolve_js_test_execution_context(
    workspace_root: &Path,
    package_root_relative_path: &str,
    scope: JsTestRunScope,
) -> Result<JsTestExecutionContext, String> {
    let package_root = validated_relative_package_root(package_root_relative_path)?;
    let execution_root = workspace_root.join(&package_root);
    let canonical_execution_root = fs::canonicalize(&execution_root)
        .map_err(|error| format!("Failed to resolve JavaScript test package root: {error}"))?;
    let canonical_workspace_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Failed to resolve JavaScript test workspace: {error}"))?;
    if !canonical_execution_root.starts_with(&canonical_workspace_root)
        || !canonical_execution_root.is_dir()
    {
        return Err(
            "JavaScript test package root must be a workspace-confined directory.".to_string(),
        );
    }
    reject_symlinked_execution_path(&canonical_workspace_root, &package_root)?;
    #[cfg(unix)]
    let workspace_root_descriptor = retained_execution_root(&canonical_workspace_root)
        .map_err(|error| error.replace("package root", "workspace root"))?;
    #[cfg(unix)]
    let execution_root_descriptor = retained_execution_root(&canonical_execution_root)?;
    #[cfg(unix)]
    let workspace_path_snapshot =
        RetainedPathSnapshot::capture(&canonical_workspace_root, &canonical_workspace_root, false)?;
    #[cfg(unix)]
    let execution_path_snapshot =
        RetainedPathSnapshot::capture(&canonical_workspace_root, &canonical_execution_root, false)?;
    let scope = scope_relative_to_package(scope, &package_root)?;
    Ok(JsTestExecutionContext {
        execution_root: canonical_execution_root.clone(),
        package_root_path: canonical_execution_root,
        scope,
        workspace_root_path: canonical_workspace_root,
        #[cfg(unix)]
        workspace_root_descriptor,
        #[cfg(unix)]
        execution_root_descriptor,
        #[cfg(unix)]
        workspace_path_snapshot,
        #[cfg(unix)]
        execution_path_snapshot,
    })
}

#[cfg(unix)]
fn retained_execution_root(path: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    let descriptor = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| format!("Failed to retain JavaScript test package root: {error}"))?;
    Ok(descriptor)
}

#[cfg(unix)]
pub(crate) fn ensure_js_test_execution_context_identity(
    context: &JsTestExecutionContext,
) -> Result<(), String> {
    context.workspace_path_snapshot.ensure_identity()?;
    context.execution_path_snapshot.ensure_identity()?;
    ensure_same_directory(
        &context.workspace_root_descriptor,
        &context.workspace_root_path,
        "JavaScript test workspace root",
    )?;
    ensure_same_directory(
        &context.execution_root_descriptor,
        &context.execution_root,
        "JavaScript test package root",
    )?;
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn retain_js_test_process_authority(
    context: &JsTestExecutionContext,
    binary_path: &Path,
    runner_kind: RetainedJsTestRunnerKind,
) -> Result<RetainedJsTestProcessAuthority, String> {
    use std::os::unix::fs::{FileExt, OpenOptionsExt};

    ensure_js_test_execution_context_identity(context)?;
    let binary_requested_path = fs::canonicalize(
        binary_path
            .parent()
            .ok_or_else(|| "JavaScript test runner must have a parent directory.".to_string())?,
    )
    .map_err(|error| format!("Failed to resolve JavaScript test runner parent: {error}"))?
    .join(
        binary_path
            .file_name()
            .ok_or_else(|| "JavaScript test runner must name a file.".to_string())?,
    );
    let binary_path = fs::canonicalize(binary_path)
        .map_err(|error| format!("Failed to resolve JavaScript test runner: {error}"))?;
    if !binary_path.starts_with(&context.workspace_root_path) || !binary_path.is_file() {
        return Err(
            "JavaScript test runner must remain a workspace-confined regular file.".to_string(),
        );
    }
    let binary_requested_path_snapshot =
        RetainedPathSnapshot::capture(&context.workspace_root_path, &binary_requested_path, true)?;
    let binary_path_snapshot =
        RetainedPathSnapshot::capture(&context.workspace_root_path, &binary_path, false)?;
    let binary_descriptor = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&binary_path)
        .map_err(|error| format!("Failed to retain JavaScript test runner: {error}"))?;
    ensure_same_file(&binary_descriptor, &binary_path, "JavaScript test runner")?;
    ensure_requested_file_identity(
        &binary_descriptor,
        &binary_requested_path,
        &context.workspace_root_path,
        "JavaScript test runner",
    )?;
    ensure_opened_descriptor_confined(
        &binary_descriptor,
        &context.workspace_root_path,
        "JavaScript test runner",
    )?;
    let mut header = [0_u8; 128];
    let header_length = binary_descriptor
        .read_at(&mut header, 0)
        .map_err(|error| format!("Failed to inspect retained JavaScript test runner: {error}"))?;
    let header = &header[..header_length];
    let (launcher, package_manifest_authority) = retained_launcher(
        header,
        &binary_path,
        &context.workspace_root_path,
        runner_kind,
    )?;
    let binary_file_name = binary_path
        .file_name()
        .ok_or_else(|| "JavaScript test runner must name a file.".to_string())?
        .to_str()
        .ok_or_else(|| "JavaScript test runner name must be valid UTF-8.".to_string())?
        .to_string();
    let runner_parent = binary_path
        .parent()
        .ok_or_else(|| "JavaScript test runner must have a parent directory.".to_string())?;
    let runner_parent_path = runner_parent.to_path_buf();
    let runner_parent_descriptor = retained_execution_root(runner_parent)
        .map_err(|error| error.replace("package root", "runner parent"))?;
    ensure_same_file(&binary_descriptor, &binary_path, "JavaScript test runner")?;
    ensure_same_directory(
        &runner_parent_descriptor,
        runner_parent,
        "JavaScript test runner parent",
    )?;
    ensure_opened_descriptor_confined(
        &runner_parent_descriptor,
        &context.workspace_root_path,
        "JavaScript test runner parent",
    )?;
    clear_close_on_exec(&binary_descriptor, "JavaScript test runner")?;
    clear_close_on_exec(&runner_parent_descriptor, "JavaScript test runner parent")?;
    let execution_root_descriptor = context
        .execution_root_descriptor
        .try_clone()
        .map_err(|error| format!("Failed to retain JavaScript test package root: {error}"))?;
    clear_close_on_exec(&execution_root_descriptor, "JavaScript test package root")?;
    let workspace_root_descriptor = context
        .workspace_root_descriptor
        .try_clone()
        .map_err(|error| format!("Failed to retain JavaScript test workspace root: {error}"))?;
    let runner_parent_authority_path =
        retained_directory_authority_path(&runner_parent_descriptor)?;
    let execution_root_authority_path =
        retained_directory_authority_path(&execution_root_descriptor)?;
    let node_interpreter = if matches!(launcher, RetainedJsTestLauncher::Node { .. }) {
        Some(retain_node_interpreter(&context.workspace_root_path)?)
    } else {
        None
    };
    Ok(RetainedJsTestProcessAuthority {
        binary_descriptor,
        binary_file_name,
        binary_path,
        binary_requested_path,
        runner_parent_descriptor,
        runner_parent_path,
        runner_parent_authority_path,
        execution_root_descriptor,
        execution_root_path: context.execution_root.clone(),
        execution_root_authority_path,
        workspace_root_descriptor,
        workspace_root_path: context.workspace_root_path.clone(),
        binary_path_snapshot,
        binary_requested_path_snapshot,
        package_manifest_authority,
        node_interpreter,
        launcher,
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn retain_node_interpreter(workspace_root: &Path) -> Result<(fs::File, String), String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let path = std::env::var_os("PATH")
        .ok_or_else(|| "Secure Node test launch requires PATH to resolve Node.".to_string())?;
    for directory in std::env::split_paths(&path).take(64) {
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join("node");
        let Ok(metadata) = fs::metadata(&candidate) else {
            continue;
        };
        if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
            continue;
        }
        let canonical = fs::canonicalize(&candidate)
            .map_err(|error| format!("Failed to resolve Node interpreter: {error}"))?;
        if canonical.starts_with(workspace_root) {
            return Err("Node interpreter authority cannot come from the workspace.".to_string());
        }
        let descriptor = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&canonical)
            .map_err(|error| format!("Failed to retain Node interpreter: {error}"))?;
        ensure_same_file(&descriptor, &canonical, "Node interpreter")?;
        clear_close_on_exec(&descriptor, "Node interpreter")?;
        let authority_path = retained_file_authority_path(&descriptor)?;
        return Ok((descriptor, authority_path));
    }
    Err("Secure Node test launch could not resolve an approved Node interpreter.".to_string())
}

#[cfg(target_os = "macos")]
fn retained_directory_authority_path(directory: &fs::File) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = directory
        .metadata()
        .map_err(|error| format!("Failed to inspect retained directory authority: {error}"))?;
    Ok(format!("/.vol/{}/{}", metadata.dev(), metadata.ino()))
}

#[cfg(target_os = "macos")]
fn retained_file_authority_path(file: &fs::File) -> Result<String, String> {
    retained_directory_authority_path(file)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn retained_directory_authority_path(directory: &fs::File) -> Result<String, String> {
    use std::os::fd::AsRawFd;

    Ok(format!("/proc/self/fd/{}", directory.as_raw_fd()))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn retained_file_authority_path(file: &fs::File) -> Result<String, String> {
    retained_directory_authority_path(file)
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "linux", target_os = "android"))
))]
fn retained_directory_authority_path(_directory: &fs::File) -> Result<String, String> {
    Err("Secure retained directory paths are unavailable on this platform.".to_string())
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "linux", target_os = "android"))
))]
fn retained_file_authority_path(_file: &fs::File) -> Result<String, String> {
    Err("Secure retained file paths are unavailable on this platform.".to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn retained_launcher(
    header: &[u8],
    binary_path: &Path,
    workspace_root: &Path,
    runner_kind: RetainedJsTestRunnerKind,
) -> Result<(RetainedJsTestLauncher, Option<RetainedNodePackageAuthority>), String> {
    if header.starts_with(b"#!/bin/sh\n") || header.starts_with(b"#!/bin/sh\r\n") {
        return Ok((RetainedJsTestLauncher::Shell, None));
    }
    if !header.starts_with(b"#!/usr/bin/env node\n")
        && !header.starts_with(b"#!/usr/bin/env node\r\n")
        && !header.starts_with(b"#!/usr/bin/node\n")
        && !header.starts_with(b"#!/usr/bin/node\r\n")
    {
        return Err(
            "Secure JavaScript test runner launch requires a retained /bin/sh or Node launcher."
                .to_string(),
        );
    }
    let (module_kind, package_manifest_authority) = match binary_path
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("mjs") => (RetainedNodeModuleKind::EsModule, None),
        Some("cjs") => (RetainedNodeModuleKind::CommonJs, None),
        Some("js") => nearest_node_package_module_kind(binary_path, workspace_root)?,
        _ => {
            return Err(
                "Secure retained Node test launch requires a .js, .cjs, or .mjs entry.".to_string(),
            )
        }
    };
    let root_option = match runner_kind {
        RetainedJsTestRunnerKind::Vitest => "--root",
        RetainedJsTestRunnerKind::Jest => "--rootDir",
    };
    Ok((
        RetainedJsTestLauncher::Node {
            module_kind,
            root_option,
        },
        package_manifest_authority,
    ))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn nearest_node_package_module_kind(
    binary_path: &Path,
    workspace_root: &Path,
) -> Result<(RetainedNodeModuleKind, Option<RetainedNodePackageAuthority>), String> {
    use std::io::Read;
    use std::os::unix::ffi::OsStrExt;

    let mut directory = binary_path.parent();
    for _ in 0..64 {
        let Some(current) = directory else {
            break;
        };
        if !current.starts_with(workspace_root) {
            break;
        }
        let manifest = current.join("package.json");
        if manifest.is_file() {
            let snapshot = RetainedPathSnapshot::capture(workspace_root, &manifest, false)?;
            let mut descriptor = retained_regular_file(&manifest, "Node package manifest")?;
            let length = descriptor
                .metadata()
                .map_err(|error| format!("Failed to inspect Node package type: {error}"))?
                .len();
            if length > 1024 * 1024 {
                return Err("Node package manifest exceeds its safety limit.".to_string());
            }
            let mut bytes = Vec::with_capacity(length as usize);
            descriptor
                .read_to_end(&mut bytes)
                .map_err(|error| format!("Failed to inspect Node package type: {error}"))?;
            snapshot.ensure_identity()?;
            ensure_same_file(&descriptor, &manifest, "Node package manifest")?;
            let identity = RetainedUnixIdentity::from_metadata(
                &descriptor
                    .metadata()
                    .map_err(|error| format!("Failed to inspect Node package type: {error}"))?,
            );
            let c_path = std::ffi::CString::new(manifest.as_os_str().as_bytes())
                .map_err(|_| "Node package manifest path contains a NUL byte.".to_string())?;
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Failed to parse Node package type: {error}"))?;
            let module_kind =
                if value.get("type").and_then(serde_json::Value::as_str) == Some("module") {
                    RetainedNodeModuleKind::EsModule
                } else {
                    RetainedNodeModuleKind::CommonJs
                };
            return Ok((
                module_kind,
                Some(RetainedNodePackageAuthority {
                    descriptor,
                    path: manifest,
                    snapshot,
                    c_path,
                    identity,
                }),
            ));
        }
        directory = current.parent();
    }
    Ok((RetainedNodeModuleKind::CommonJs, None))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn clear_close_on_exec(file: &fs::File, label: &str) -> Result<(), String> {
    use std::os::fd::AsRawFd;

    let descriptor_flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    if descriptor_flags < 0
        || unsafe {
            libc::fcntl(
                file.as_raw_fd(),
                libc::F_SETFD,
                descriptor_flags & !libc::FD_CLOEXEC,
            )
        } < 0
    {
        return Err(format!(
            "Failed to retain {label} for execution: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl RetainedJsTestProcessAuthority {
    pub(crate) fn ensure_spawn_identity(&self) -> Result<(), String> {
        self.binary_requested_path_snapshot.ensure_identity()?;
        self.binary_path_snapshot.ensure_identity()?;
        ensure_same_directory(
            &self.workspace_root_descriptor,
            &self.workspace_root_path,
            "JavaScript test workspace root",
        )?;
        ensure_same_directory(
            &self.execution_root_descriptor,
            &self.execution_root_path,
            "JavaScript test package root",
        )?;
        ensure_same_directory(
            &self.runner_parent_descriptor,
            &self.runner_parent_path,
            "JavaScript test runner parent",
        )?;
        ensure_same_file(
            &self.binary_descriptor,
            &self.binary_path,
            "JavaScript test runner",
        )?;
        ensure_requested_file_identity(
            &self.binary_descriptor,
            &self.binary_requested_path,
            &self.workspace_root_path,
            "JavaScript test runner",
        )?;
        ensure_opened_descriptor_confined(
            &self.binary_descriptor,
            &self.workspace_root_path,
            "JavaScript test runner",
        )?;
        if let Some(authority) = &self.package_manifest_authority {
            authority.ensure_identity()?;
        }
        Ok(())
    }

    pub(crate) fn into_command(self, args: Vec<String>) -> Command {
        use std::os::unix::ffi::OsStrExt;
        use std::os::{fd::AsRawFd, unix::process::CommandExt};

        let package_root = self.execution_root_descriptor;
        let launcher = self.binary_descriptor;
        let runner_parent = self.runner_parent_descriptor;
        let launcher_kind = self.launcher;
        let node_interpreter = self.node_interpreter;
        let package_manifest_authority = self.package_manifest_authority;
        let runner_parent_identity = RetainedUnixIdentity::from_metadata(
            &runner_parent
                .metadata()
                .expect("retained JavaScript test runner parent metadata must remain available"),
        );
        let runner_parent_c_path =
            std::ffi::CString::new(self.runner_parent_path.as_os_str().as_bytes())
                .expect("retained JavaScript test runner parent path cannot contain NUL");
        let binary_identity = RetainedUnixIdentity::from_metadata(
            &launcher
                .metadata()
                .expect("retained JavaScript test runner metadata must remain available"),
        );
        let binary_c_path = std::ffi::CString::new(self.binary_path.as_os_str().as_bytes())
            .expect("retained JavaScript test runner path cannot contain NUL");
        let retained_shell_launcher_path = format!(
            "{}/{}",
            self.runner_parent_authority_path, self.binary_file_name
        );
        let retained_node_entry_path = self.binary_path.to_string_lossy().into_owned();
        let mut command = match launcher_kind {
            RetainedJsTestLauncher::Shell => {
                let mut command = Command::new("/bin/sh");
                command
                    .arg("-c")
                    .arg(format!(". /dev/fd/{}", launcher.as_raw_fd()))
                    .arg(&retained_shell_launcher_path)
                    .args(args);
                command
            }
            RetainedJsTestLauncher::Node {
                module_kind,
                root_option,
            } => {
                let interpreter_path = node_interpreter
                    .as_ref()
                    .expect("retained Node launcher must retain its interpreter")
                    .1
                    .as_str();
                let mut command = Command::new(interpreter_path);
                let loader_registration = retained_node_loader_registration(
                    &retained_node_entry_path,
                    launcher.as_raw_fd(),
                    module_kind,
                );
                command
                    .args(["--import", &loader_registration])
                    .arg(&retained_node_entry_path);
                command
                    .arg(root_option)
                    .arg(&self.execution_root_authority_path)
                    .args(args);
                command
            }
        };
        let use_runner_parent_as_cwd = matches!(launcher_kind, RetainedJsTestLauncher::Node { .. });
        unsafe {
            command.pre_exec(move || {
                ensure_path_identity_before_exec(&runner_parent_c_path, runner_parent_identity)?;
                ensure_path_identity_before_exec(&binary_c_path, binary_identity)?;
                let cwd = if use_runner_parent_as_cwd {
                    runner_parent.as_raw_fd()
                } else {
                    package_root.as_raw_fd()
                };
                if libc::fchdir(cwd) != 0 {
                    return Err(io::Error::last_os_error());
                }
                let _ = launcher.as_raw_fd();
                let _ = package_root.as_raw_fd();
                let _ = runner_parent.as_raw_fd();
                if let Some((interpreter, _)) = &node_interpreter {
                    let _ = interpreter.as_raw_fd();
                }
                if let Some(authority) = &package_manifest_authority {
                    authority.ensure_identity_before_exec()?;
                    let _ = authority.descriptor.as_raw_fd();
                }
                Ok(())
            });
        }
        command
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn retain_js_test_process_authority(
    _context: &JsTestExecutionContext,
    _binary_path: &Path,
    _runner_kind: RetainedJsTestRunnerKind,
) -> Result<RetainedJsTestProcessAuthority, String> {
    Err("Secure JavaScript test runner launch is unavailable on this platform.".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
impl RetainedJsTestProcessAuthority {
    pub(crate) fn ensure_spawn_identity(&self) -> Result<(), String> {
        Err("Secure JavaScript test runner launch is unavailable on this platform.".to_string())
    }

    pub(crate) fn into_command(self, _args: Vec<String>) -> Command {
        unreachable!("unsupported retained JavaScript test process authority")
    }
}

#[cfg(unix)]
fn ensure_same_file(file: &fs::File, path: &Path, label: &str) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let retained = file
        .metadata()
        .map_err(|error| format!("{label} identity changed: {error}"))?;
    let current =
        fs::symlink_metadata(path).map_err(|error| format!("{label} identity changed: {error}"))?;
    if current.file_type().is_symlink()
        || retained.dev() != current.dev()
        || retained.ino() != current.ino()
    {
        return Err(format!("{label} identity changed."));
    }
    Ok(())
}

#[cfg(unix)]
fn retained_regular_file(path: &Path, label: &str) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| format!("Failed to retain {label}: {error}"))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl RetainedNodePackageAuthority {
    fn ensure_identity(&self) -> Result<(), String> {
        self.snapshot.ensure_identity()?;
        ensure_same_file(
            &self.descriptor,
            &self.path,
            "JavaScript test Node package manifest",
        )
    }

    fn ensure_identity_before_exec(&self) -> io::Result<()> {
        let current =
            unsafe { libc::open(self.c_path.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW) };
        if current < 0 {
            return Err(io::Error::last_os_error());
        }
        let matches = raw_file_identity_matches(current, self.identity);
        unsafe {
            libc::close(current);
        }
        if matches {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(libc::ESTALE))
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn raw_file_identity_matches(descriptor: libc::c_int, expected: RetainedUnixIdentity) -> bool {
    use std::mem::MaybeUninit;

    let mut metadata = MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(descriptor, metadata.as_mut_ptr()) } != 0 {
        return false;
    }
    let metadata = unsafe { metadata.assume_init() };
    metadata.st_dev as u64 == expected.device
        && metadata.st_ino == expected.inode
        && metadata.st_mode as u32 == expected.mode
        && raw_change_time_matches(&metadata, expected)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn ensure_path_identity_before_exec(
    path: &std::ffi::CStr,
    expected: RetainedUnixIdentity,
) -> io::Result<()> {
    let current = unsafe { libc::open(path.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW) };
    if current < 0 {
        return Err(io::Error::last_os_error());
    }
    let matches = raw_file_identity_matches(current, expected);
    unsafe {
        libc::close(current);
    }
    if matches {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(libc::ESTALE))
    }
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
fn raw_change_time_matches(metadata: &libc::stat, expected: RetainedUnixIdentity) -> bool {
    metadata.st_ctime == expected.changed_seconds
        && metadata.st_ctime_nsec == expected.changed_nanoseconds
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "linux", target_os = "android"))
))]
fn raw_change_time_matches(_metadata: &libc::stat, _expected: RetainedUnixIdentity) -> bool {
    false
}

#[cfg(unix)]
fn ensure_same_directory(file: &fs::File, path: &Path, label: &str) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let retained = file
        .metadata()
        .map_err(|error| format!("{label} identity changed: {error}"))?;
    let current =
        fs::symlink_metadata(path).map_err(|error| format!("{label} identity changed: {error}"))?;
    if current.file_type().is_symlink()
        || !current.is_dir()
        || retained.dev() != current.dev()
        || retained.ino() != current.ino()
    {
        return Err(format!("{label} identity changed."));
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_requested_file_identity(
    file: &fs::File,
    requested_path: &Path,
    workspace_root: &Path,
    label: &str,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let resolved = fs::canonicalize(requested_path)
        .map_err(|error| format!("{label} identity changed: {error}"))?;
    if !resolved.starts_with(workspace_root) {
        return Err(format!("{label} escaped its workspace."));
    }
    let retained = file
        .metadata()
        .map_err(|error| format!("{label} identity changed: {error}"))?;
    let current = fs::metadata(requested_path)
        .map_err(|error| format!("{label} identity changed: {error}"))?;
    if !current.is_file() || retained.dev() != current.dev() || retained.ino() != current.ino() {
        return Err(format!("{label} identity changed."));
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_opened_descriptor_confined(
    file: &fs::File,
    workspace_root: &Path,
    label: &str,
) -> Result<(), String> {
    let opened = opened_descriptor_path(file)
        .map_err(|error| format!("Failed to inspect retained {label}: {error}"))?;
    if !opened.starts_with(workspace_root) {
        return Err(format!("{label} escaped its workspace."));
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn opened_descriptor_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::os::fd::AsRawFd;

    fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

#[cfg(target_os = "macos")]
fn opened_descriptor_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::{ffi::CStr, os::fd::AsRawFd};

    let mut buffer = [0_i8; libc::PATH_MAX as usize];
    let result = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    let path = unsafe { CStr::from_ptr(buffer.as_ptr()) }
        .to_str()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "path is not UTF-8"))?;
    Ok(PathBuf::from(path))
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "linux", target_os = "android"))
))]
fn opened_descriptor_path(_file: &fs::File) -> io::Result<PathBuf> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "descriptor paths are unavailable",
    ))
}

#[cfg(not(unix))]
pub(crate) fn ensure_js_test_execution_context_identity(
    _context: &JsTestExecutionContext,
) -> Result<(), String> {
    Ok(())
}

fn validated_relative_package_root(value: &str) -> Result<PathBuf, String> {
    if value.len() > MAX_JS_TEST_PACKAGE_ROOT_BYTES {
        return Err("JavaScript test package root exceeds its safety limit.".to_string());
    }
    if value.is_empty() {
        return Ok(PathBuf::new());
    }
    if value.trim() != value
        || value.contains('\\')
        || value.chars().any(char::is_control)
        || value
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(
            "JavaScript test package root must stay inside the registered workspace.".to_string(),
        );
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(
            "JavaScript test package root must stay inside the registered workspace.".to_string(),
        );
    }
    Ok(path.to_path_buf())
}

fn reject_symlinked_execution_path(root: &Path, relative: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err(
                "JavaScript test package root must stay inside the registered workspace."
                    .to_string(),
            );
        };
        current.push(segment);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Failed to inspect JavaScript test package root: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("JavaScript test package root cannot contain symlinks.".to_string());
        }
    }
    Ok(())
}

fn scope_relative_to_package(
    scope: JsTestRunScope,
    package_root: &Path,
) -> Result<JsTestRunScope, String> {
    match scope {
        JsTestRunScope::All => Ok(JsTestRunScope::All),
        JsTestRunScope::File { relative_file_path } => Ok(JsTestRunScope::File {
            relative_file_path: relative_test_path(&relative_file_path, package_root)?,
        }),
        JsTestRunScope::Suite {
            relative_file_path,
            full_name,
        } => Ok(JsTestRunScope::Suite {
            relative_file_path: relative_test_path(&relative_file_path, package_root)?,
            full_name,
        }),
        JsTestRunScope::Test {
            relative_file_path,
            full_name,
            name_match,
        } => Ok(JsTestRunScope::Test {
            relative_file_path: relative_test_path(&relative_file_path, package_root)?,
            full_name,
            name_match,
        }),
    }
}

fn relative_test_path(value: &str, package_root: &Path) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("JavaScript test file path must stay inside the workspace.".to_string());
    }
    let relative = path.strip_prefix(package_root).map_err(|_| {
        "JavaScript test scope must belong to the selected package root.".to_string()
    })?;
    if relative.as_os_str().is_empty() {
        return Err("JavaScript test scope must name a file inside its package root.".to_string());
    }
    relative
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "JavaScript test file path is not valid UTF-8.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{ensure_js_test_execution_context_identity, resolve_js_test_execution_context};
    use crate::js_test_run::JsTestRunScope;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-js-test-execution-root-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("packages/web/src")).expect("create fixture");
        root
    }

    #[test]
    fn confines_and_rebases_scope_to_nested_package() {
        let root = fixture();
        let context = resolve_js_test_execution_context(
            &root,
            "packages/web",
            JsTestRunScope::File {
                relative_file_path: "packages/web/src/app.test.ts".to_string(),
            },
        )
        .expect("execution context");
        assert!(context.execution_root.is_dir());
        assert_eq!(
            context.scope,
            JsTestRunScope::File {
                relative_file_path: "src/app.test.ts".to_string()
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_foreign_scope_and_parent_authority() {
        let root = fixture();
        assert!(resolve_js_test_execution_context(
            &root,
            "packages/web",
            JsTestRunScope::File {
                relative_file_path: "packages/other/app.test.ts".to_string(),
            },
        )
        .is_err());
        assert!(
            resolve_js_test_execution_context(&root, "../outside", JsTestRunScope::All,).is_err()
        );
        for malformed in [
            " packages/web",
            "packages//web",
            "packages\\web",
            "packages/./web",
        ] {
            assert!(
                resolve_js_test_execution_context(&root, malformed, JsTestRunScope::All).is_err()
            );
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_package_root_even_when_target_stays_in_workspace() {
        use std::os::unix::fs::symlink;
        let root = fixture();
        symlink(root.join("packages/web"), root.join("packages/link")).expect("symlink package");
        assert!(
            resolve_js_test_execution_context(&root, "packages/link", JsTestRunScope::All,)
                .is_err()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn retained_package_descriptor_rejects_path_replacement_before_use() {
        use std::os::unix::fs::symlink;

        let root = fixture();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(root.join("packages/web/marker"), "inside").expect("inside marker");
        fs::write(outside.join("marker"), "outside").expect("outside marker");
        let context = resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
            .expect("retained context");

        fs::rename(root.join("packages/web"), root.join("packages/original"))
            .expect("replace package");
        symlink(&outside, root.join("packages/web")).expect("foreign replacement");

        assert!(ensure_js_test_execution_context_identity(&context).is_err());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_process_authority_rejects_check_to_spawn_cwd_and_binary_swap() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = fixture();
        let package = root.join("packages/web");
        let runner = package.join("runner.sh");
        fs::write(
            &runner,
            "#!/bin/sh\nexec \"$(dirname \"$0\")/payload.sh\"\n",
        )
        .expect("inside runner");
        fs::write(package.join("payload.sh"), "#!/bin/sh\nexit 0\n").expect("inside payload");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o755))
            .expect("inside permissions");
        fs::set_permissions(
            package.join("payload.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .expect("inside payload permissions");
        let context = resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
            .expect("retained context");
        let authority =
            retain_js_test_process_authority(&context, &runner, RetainedJsTestRunnerKind::Vitest)
                .expect("process authority");

        let outside = root.with_extension("spawn-outside");
        fs::create_dir_all(&outside).expect("outside");
        let marker = outside.join("foreign-ran");
        fs::write(
            outside.join("runner.sh"),
            "#!/bin/sh\nexec \"$(dirname \"$0\")/payload.sh\"\n",
        )
        .expect("foreign runner");
        fs::write(
            outside.join("payload.sh"),
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .expect("foreign payload");
        fs::set_permissions(outside.join("runner.sh"), fs::Permissions::from_mode(0o755))
            .expect("foreign permissions");
        fs::set_permissions(
            outside.join("payload.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .expect("foreign payload permissions");
        fs::rename(&package, root.join("packages/original")).expect("rename package");
        symlink(&outside, &package).expect("foreign package replacement");

        let mut command = authority.into_command(Vec::new());
        assert!(command.status().is_err());
        assert!(!marker.exists());

        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_node_mjs_symlink_entry_uses_fd_backed_script_parent_and_package_root() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = fixture();
        let package = root.join("packages/web");
        let runner_package = package.join("node_modules/vitest");
        fs::create_dir_all(runner_package.join("dist")).expect("runner package");
        fs::create_dir_all(package.join("node_modules/.bin")).expect("binary directory");
        fs::write(
            runner_package.join("vitest.mjs"),
            "#!/usr/bin/env node\nimport './dist/cli.js'\n",
        )
        .expect("node launcher");
        fs::write(runner_package.join("package.json"), r#"{"type":"module"}"#)
            .expect("runner manifest");
        fs::write(
            runner_package.join("dist/cli.js"),
            "const index=process.argv.indexOf('--root');\
             process.chdir(process.argv[index+1]);\
             console.log(process.cwd());",
        )
        .expect("node payload");
        fs::set_permissions(
            runner_package.join("vitest.mjs"),
            fs::Permissions::from_mode(0o755),
        )
        .expect("node launcher permissions");
        symlink(
            "../vitest/vitest.mjs",
            package.join("node_modules/.bin/vitest"),
        )
        .expect("npm-style binary symlink");
        let canonical_runner =
            fs::canonicalize(package.join("node_modules/.bin/vitest")).expect("canonical runner");
        let context = resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
            .expect("retained context");
        let authority = retain_js_test_process_authority(
            &context,
            &canonical_runner,
            RetainedJsTestRunnerKind::Vitest,
        )
        .expect("retained node authority");

        let outside = root.with_extension("node-spawn-outside");
        let marker = outside.join("foreign-ran");
        fs::create_dir_all(outside.join("node_modules/vitest/dist")).expect("foreign runner");
        fs::write(
            outside.join("node_modules/vitest/vitest.mjs"),
            format!(
                "#!/usr/bin/env node\nimport 'node:fs';fs.writeFileSync({:?},'ran')\n",
                marker.to_string_lossy()
            ),
        )
        .expect("foreign launcher");
        fs::write(
            outside.join("node_modules/vitest/package.json"),
            r#"{"type":"module"}"#,
        )
        .expect("foreign manifest");
        fs::rename(&package, root.join("packages/original")).expect("swap package");
        symlink(&outside, &package).expect("foreign package replacement");

        assert!(authority.into_command(Vec::new()).output().is_err());
        assert!(!marker.exists());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_node_launch_preserves_commonjs_and_esm_entry_semantics() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};
        use std::os::unix::fs::PermissionsExt;

        for (label, manifest, entry_name, dependency_name, dependency, source, expected) in [
            (
                "commonjs",
                r#"{"type":"commonjs"}"#,
                "runner.js",
                "dependency.cjs",
                "module.exports='commonjs-relative';",
                "#!/usr/bin/env node\nconst marker=require('./dependency.cjs');\
                 console.log(JSON.stringify({marker,argv:process.argv[1],filename:__filename}));",
                "commonjs-relative",
            ),
            (
                "module-js",
                r#"{"type":"module"}"#,
                "runner.js",
                "dependency.mjs",
                "export default 'module-js-relative';",
                "#!/usr/bin/env node\nimport marker from './dependency.mjs';\
                 console.log(JSON.stringify({marker,argv:process.argv[1],url:import.meta.url}));",
                "module-js-relative",
            ),
            (
                "module-mjs",
                r#"{"type":"commonjs"}"#,
                "runner.mjs",
                "dependency.mjs",
                "export default 'module-mjs-relative';",
                "#!/usr/bin/env node\nimport marker from './dependency.mjs';\
                 console.log(JSON.stringify({marker,argv:process.argv[1],url:import.meta.url}));",
                "module-mjs-relative",
            ),
        ] {
            let root = fixture();
            let package = root.join("packages/web");
            let runner_package = package.join(format!("node_modules/{label}"));
            fs::create_dir_all(&runner_package).expect("runner package");
            fs::write(runner_package.join("package.json"), manifest).expect("manifest");
            fs::write(runner_package.join(dependency_name), dependency).expect("dependency");
            let runner = runner_package.join(entry_name);
            fs::write(&runner, source).expect("runner");
            fs::set_permissions(&runner, fs::Permissions::from_mode(0o755))
                .expect("runner permissions");
            let context =
                resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
                    .expect("context");
            let authority = retain_js_test_process_authority(
                &context,
                &runner,
                RetainedJsTestRunnerKind::Vitest,
            )
            .expect("authority");

            let output = authority
                .into_command(Vec::new())
                .output()
                .expect("execute retained Node entry");
            assert!(output.status.success(), "{:?}", output.stderr);
            let value: serde_json::Value =
                serde_json::from_slice(&output.stdout).expect("JSON output");
            assert_eq!(value["marker"], expected);
            let argv = value["argv"].as_str().expect("argv");
            assert!(argv.ends_with(entry_name), "{argv}");
            assert_ne!(argv, "-");
            if let Some(url) = value.get("url").and_then(serde_json::Value::as_str) {
                assert!(url.ends_with(entry_name), "{url}");
                assert!(!url.starts_with("file:///eval"), "{url}");
            }
            if let Some(filename) = value.get("filename").and_then(serde_json::Value::as_str) {
                assert!(filename.ends_with(entry_name), "{filename}");
            }
            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_node_entry_rejects_leaf_replacement_after_final_check() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};
        use std::os::unix::fs::PermissionsExt;

        let root = fixture();
        let package = root.join("packages/web");
        let runner_package = package.join("node_modules/vitest");
        fs::create_dir_all(&runner_package).expect("runner package");
        fs::write(runner_package.join("package.json"), r#"{"type":"module"}"#).expect("manifest");
        fs::write(
            runner_package.join("dependency.mjs"),
            "export default 'original-dependency';",
        )
        .expect("dependency");
        let runner = runner_package.join("runner.mjs");
        fs::write(
            &runner,
            "#!/usr/bin/env node\nimport marker from './dependency.mjs';\
             console.log(JSON.stringify({marker,argv:process.argv[1],url:import.meta.url}));",
        )
        .expect("runner");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o755))
            .expect("runner permissions");
        let context = resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
            .expect("context");
        let authority =
            retain_js_test_process_authority(&context, &runner, RetainedJsTestRunnerKind::Vitest)
                .expect("authority");
        authority.ensure_spawn_identity().expect("final check");
        let mut command = authority.into_command(Vec::new());

        fs::rename(&runner, runner_package.join("original.mjs")).expect("retain original");
        fs::write(&runner, "#!/usr/bin/env node\nthrow new Error('foreign');")
            .expect("replacement");
        assert!(command.output().is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_node_package_manifest_rejects_mutation_and_a_b_a_before_exec() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};

        for label in ["mutation", "aba"] {
            let root = fixture();
            let package = root.join("packages/web");
            let runner_package = package.join(format!("node_modules/{label}"));
            fs::create_dir_all(&runner_package).expect("runner package");
            let manifest = runner_package.join("package.json");
            fs::write(&manifest, r#"{"type":"module"}"#).expect("manifest");
            let runner = runner_package.join("runner.js");
            fs::write(&runner, "#!/usr/bin/env node\nconsole.log('original');").expect("runner");
            let context =
                resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
                    .expect("context");
            let authority = retain_js_test_process_authority(
                &context,
                &runner,
                RetainedJsTestRunnerKind::Vitest,
            )
            .expect("authority");
            authority.ensure_spawn_identity().expect("final check");
            let mut command = authority.into_command(Vec::new());

            if label == "mutation" {
                fs::write(&manifest, r#"{"type":"commonjs"}"#).expect("mutate manifest");
            } else {
                let original = runner_package.join("package-original.json");
                fs::rename(&manifest, &original).expect("move A");
                fs::write(&manifest, r#"{"type":"commonjs"}"#).expect("write B");
                fs::remove_file(&manifest).expect("remove B");
                fs::rename(&original, &manifest).expect("restore A");
            }
            assert!(command.output().is_err(), "{label}");
            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_authority_executes_repository_vitest_mjs_when_installed() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};

        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root")
            .to_path_buf();
        let binary_link = workspace.join("node_modules/.bin/vitest");
        if !binary_link.exists() {
            return;
        }
        let binary = fs::canonicalize(binary_link).expect("canonical repository Vitest");
        let context = resolve_js_test_execution_context(&workspace, "", JsTestRunScope::All)
            .expect("repository execution context");
        let authority =
            retain_js_test_process_authority(&context, &binary, RetainedJsTestRunnerKind::Vitest)
                .expect("repository Vitest authority");

        let output = authority
            .into_command(vec!["--version".to_string()])
            .output()
            .expect("execute retained repository Vitest");

        assert!(output.status.success(), "{:?}", output.stderr);
        assert!(String::from_utf8(output.stdout)
            .expect("utf8 version")
            .starts_with("vitest/"));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn retained_process_authority_executes_in_descriptor_owned_package_root() {
        use super::{retain_js_test_process_authority, RetainedJsTestRunnerKind};
        use std::os::unix::fs::PermissionsExt;

        let root = fixture();
        let package = root.join("packages/web");
        let runner = package.join("pwd.sh");
        fs::write(&runner, "#!/bin/sh\npwd\n").expect("runner");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).expect("permissions");
        let context = resolve_js_test_execution_context(&root, "packages/web", JsTestRunScope::All)
            .expect("context");
        let authority =
            retain_js_test_process_authority(&context, &runner, RetainedJsTestRunnerKind::Vitest)
                .expect("process authority");

        let mut command = authority.into_command(Vec::new());
        let output = command.output().expect("execute retained authority");

        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).expect("utf8 cwd").trim(),
            fs::canonicalize(&package)
                .expect("canonical package")
                .to_string_lossy()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
