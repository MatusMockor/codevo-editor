use crate::{
    git_worktree::{
        agent_worktree_path, ensure_worktree_path_in_base, safe_agent_task_id,
        WORKTREE_BASE_DIR_NAME,
    },
    node_package_problem_matcher::NodePackageTaskOutputStream,
    terminal::{TerminalEventSink, TerminalOutputEvent},
    terminal_session::TerminalSupervisor,
    trust::WorkspaceTrustService,
    workspace_registry::{opened_root_path, WorkspaceId, WorkspaceRegistry},
};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::State;

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::os::{
    fd::{AsRawFd, FromRawFd},
    unix::{ffi::OsStrExt, process::CommandExt},
};

const MANIFEST_BYTES_LIMIT: usize = 256 * 1024;
const PACKAGE_NAME_BYTES_LIMIT: usize = 214;
const SCRIPT_NAME_BYTES_LIMIT: usize = 214;
const WORKSPACE_ID_BYTES_LIMIT: usize = 1024;
const MANIFEST_PATH_BYTES_LIMIT: usize = 4096;
const HARD_MAX_MANIFESTS: usize = 2_000;
const HARD_MAX_SCRIPTS: usize = 20_000;
const HARD_MAX_VISITED: usize = 100_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NodePackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl NodePackageManager {
    fn executable(self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NodePackageScriptDiscoveryLimits {
    pub max_manifests: usize,
    pub max_scripts: usize,
    pub max_visited: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiscoverNodePackageScriptsRequest {
    workspace_id: WorkspaceId,
    max_manifests: usize,
    max_scripts: usize,
    max_visited: usize,
}

impl NodePackageScriptDiscoveryLimits {
    fn validate(self) -> Result<Self, String> {
        if self.max_manifests == 0 || self.max_scripts == 0 || self.max_visited == 0 {
            return Err("Node package script discovery limits must be positive.".to_string());
        }
        if self.max_manifests > HARD_MAX_MANIFESTS
            || self.max_scripts > HARD_MAX_SCRIPTS
            || self.max_visited > HARD_MAX_VISITED
        {
            return Err(
                "Node package script discovery limits exceed the backend safety cap.".to_string(),
            );
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageScript {
    manifest_relative_path: String,
    package_root_relative_path: String,
    package_name: Option<String>,
    package_manager: NodePackageManager,
    script_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageScriptDiscoveryResult {
    scripts: Vec<NodePackageScript>,
    total: usize,
    truncated: bool,
    visited: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RunNodePackageScriptRequest {
    pub workspace_id: WorkspaceId,
    pub session_id: u64,
    pub manifest_relative_path: String,
    pub repository_root: String,
    pub script_name: String,
    pub target: NodePackageTaskLaunchTarget,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum NodePackageTaskLaunchTarget {
    WorkspaceRoot {},
    #[serde(rename_all = "camelCase")]
    AgentWorktree {
        thread_id: String,
    },
}

impl Default for NodePackageTaskLaunchTarget {
    fn default() -> Self {
        Self::WorkspaceRoot {}
    }
}

struct NodePackageLaunchDirectory {
    directory: File,
    path: PathBuf,
    problem_root: File,
    problem_root_path: PathBuf,
    problem_package_relative: PathBuf,
}

#[derive(Debug)]
struct ParsedManifest {
    manager: Option<NodePackageManager>,
    package_name: Option<String>,
    scripts: Vec<String>,
}

#[cfg_attr(test, allow(dead_code))]
#[derive(Clone, Copy)]
enum ScriptExecutionPolicy {
    PackagePanel,
    VscodeTask,
}

#[tauri::command]
pub(crate) fn workspace_discover_node_package_scripts(
    registry: State<'_, WorkspaceRegistry>,
    request: DiscoverNodePackageScriptsRequest,
) -> Result<NodePackageScriptDiscoveryResult, String> {
    discover_node_package_scripts_with_registry(
        &registry,
        &request.workspace_id,
        NodePackageScriptDiscoveryLimits {
            max_manifests: request.max_manifests,
            max_scripts: request.max_scripts,
            max_visited: request.max_visited,
        },
    )
}

fn discover_node_package_scripts_with_registry(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    limits: NodePackageScriptDiscoveryLimits,
) -> Result<NodePackageScriptDiscoveryResult, String> {
    validate_workspace_id(workspace_id)?;
    let limits = limits.validate()?;
    let descriptor = registry
        .descriptor(workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    let root = registry
        .clone_root(workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    let opened_root = opened_root_path(&root)
        .map_err(|error| format!("Failed to inspect the registered workspace root: {error}"))?;
    if opened_root != descriptor.canonical_root_path {
        return Err("Registered workspace root identity changed.".to_string());
    }

    let mut builder = WalkBuilder::new(&opened_root);
    builder
        .follow_links(false)
        .hidden(false)
        .require_git(false)
        .standard_filters(true)
        .sort_by_file_path(|left, right| left.cmp(right))
        .filter_entry(|entry| !is_excluded_directory(entry.path(), entry.file_type()));

    let mut manifests = 0_usize;
    let mut visited = 0_usize;
    let mut total = 0_usize;
    let mut truncated = false;
    let mut scripts = BTreeSet::new();

    for entry in builder.build() {
        if visited == limits.max_visited {
            truncated = true;
            break;
        }
        visited += 1;
        let Ok(entry) = entry else {
            truncated = true;
            continue;
        };
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_file() || entry.file_name() != "package.json" {
            continue;
        }
        if manifests == limits.max_manifests {
            truncated = true;
            break;
        }
        manifests += 1;
        let Ok(relative) = entry.path().strip_prefix(&opened_root) else {
            truncated = true;
            continue;
        };
        let Ok(file) = registry.open_descendant(workspace_id, relative) else {
            // A symlink or filesystem race is deliberately treated as an unreadable manifest.
            continue;
        };
        let Ok(parsed) = parse_manifest(file) else {
            continue;
        };
        let package_root = relative.parent().unwrap_or_else(|| Path::new(""));
        let Some(manager) = parsed
            .manager
            .or_else(|| detect_manager_from_lockfiles(registry, workspace_id, package_root))
        else {
            continue;
        };
        let manifest_relative_path = relative_path_string(relative)?;
        let package_root_relative_path = if package_root.as_os_str().is_empty() {
            String::new()
        } else {
            relative_path_string(package_root)?
        };
        for script_name in parsed.scripts {
            total = total.saturating_add(1);
            if scripts.len() == limits.max_scripts {
                truncated = true;
                continue;
            }
            scripts.insert(NodePackageScript {
                manifest_relative_path: manifest_relative_path.clone(),
                package_root_relative_path: package_root_relative_path.clone(),
                package_name: parsed.package_name.clone(),
                package_manager: manager,
                script_name,
            });
        }
    }

    Ok(NodePackageScriptDiscoveryResult {
        scripts: scripts.into_iter().collect(),
        total,
        truncated,
        visited,
    })
}

pub(crate) struct SpawnedNodePackageTask {
    pub(crate) child: std::process::Child,
    pub(crate) ownership: crate::terminal_task_process::TerminalTaskOwnership,
    pub(crate) stderr_reader: Option<thread::JoinHandle<Result<(), String>>>,
    pub(crate) stdout_reader: Option<thread::JoinHandle<Result<(), String>>>,
    pub(crate) output_observer: Arc<dyn NodePackageTaskOutputObserver>,
    settled: bool,
}

impl Drop for SpawnedNodePackageTask {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        self.ownership.terminate();
        let _ = self.ownership.wait_after_terminate(&mut self.child);
        let _ = join_output_reader(self.stdout_reader.take());
        let _ = join_output_reader(self.stderr_reader.take());
        self.output_observer.finish_task(false);
        self.settled = true;
    }
}

pub(crate) trait NodePackageTaskOutputObserver: Send + Sync + 'static {
    fn prepare(
        &self,
        workspace_root: &File,
        workspace_path: &Path,
        package_directory: &File,
        package_path: &Path,
    ) -> Result<(), String>;

    fn observe(&self, stream: NodePackageTaskOutputStream, bytes: &[u8]);

    fn finish(&self, stream: NodePackageTaskOutputStream);

    fn finish_task(&self, preserve_problems: bool);
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum NodePackageTaskCompletion {
    Exited { exit_code: Option<i32> },
    Failed { message: String },
    Stopped,
}

pub(crate) fn spawn_node_package_task(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    terminals: &TerminalSupervisor,
    request: &RunNodePackageScriptRequest,
    output_observer: Arc<dyn NodePackageTaskOutputObserver>,
) -> Result<SpawnedNodePackageTask, String> {
    spawn_node_package_task_with_policy(
        registry,
        trust,
        terminals,
        request,
        output_observer,
        ScriptExecutionPolicy::PackagePanel,
        None,
    )
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn spawn_vscode_node_package_task(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    terminals: &TerminalSupervisor,
    request: &RunNodePackageScriptRequest,
    output_observer: Arc<dyn NodePackageTaskOutputObserver>,
    expected_workspace_root: &Path,
) -> Result<SpawnedNodePackageTask, String> {
    spawn_node_package_task_with_policy(
        registry,
        trust,
        terminals,
        request,
        output_observer,
        ScriptExecutionPolicy::VscodeTask,
        Some(expected_workspace_root),
    )
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn preflight_vscode_node_package_task(
    registry: &WorkspaceRegistry,
    request: &RunNodePackageScriptRequest,
    expected_workspace_root: &Path,
) -> Result<(), String> {
    validate_workspace_id(&request.workspace_id)?;
    validate_script_name(&request.script_name)?;
    let manifest_path = validate_manifest_relative_path(&request.manifest_relative_path)?;
    let operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    if descriptor.canonical_root_path != expected_workspace_root {
        return Err("The package task workspace identity changed before start.".to_string());
    }
    let root = registry
        .clone_root(&request.workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    drop(operation);
    let package_root = manifest_path.parent().unwrap_or_else(|| Path::new(""));
    let package_directory = open_package_directory(&root, package_root)
        .map_err(|error| format!("Failed to open the package directory safely: {error}"))?;
    let manifest_file = open_manifest_in_directory(&package_directory)
        .map_err(|error| format!("Failed to open package.json safely: {error}"))?;
    let parsed = parse_manifest(manifest_file)?;
    if !parsed
        .scripts
        .iter()
        .any(|script| script == &request.script_name)
    {
        return Err("The requested package script no longer exists in package.json.".to_string());
    }
    reject_vscode_lifecycle_hooks(&parsed, &request.script_name)
}

fn spawn_node_package_task_with_policy(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    terminals: &TerminalSupervisor,
    request: &RunNodePackageScriptRequest,
    output_observer: Arc<dyn NodePackageTaskOutputObserver>,
    policy: ScriptExecutionPolicy,
    expected_workspace_root: Option<&Path>,
) -> Result<SpawnedNodePackageTask, String> {
    validate_workspace_id(&request.workspace_id)?;
    validate_script_name(&request.script_name)?;
    let manifest_path = validate_manifest_relative_path(&request.manifest_relative_path)?;

    let operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    if expected_workspace_root.is_some_and(|expected| descriptor.canonical_root_path != expected) {
        return Err("The package task workspace identity changed before start.".to_string());
    }
    let root = registry
        .clone_root(&request.workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    drop(operation);
    let root_identity = opened_root_path(&root)
        .map_err(|error| format!("Failed to inspect the registered workspace root: {error}"))?;
    if root_identity != descriptor.canonical_root_path {
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
        return Err("Trust this workspace before running a package script.".to_string());
    }
    let sink = terminals.task_sink(request.session_id, &root_identity)?;
    let package_root = manifest_path.parent().unwrap_or_else(|| Path::new(""));
    let repository_relative = resolve_repository_relative_path(
        &root,
        &root_identity,
        Path::new(&request.repository_root),
    )?;
    if package_root.strip_prefix(&repository_relative).is_err() {
        return Err("Package manifest is outside the requested repository.".to_string());
    }
    let launch = resolve_package_launch_directory(
        &root,
        &root_identity,
        package_root,
        &repository_relative,
        &request.target,
    )?;
    let retained_package_path = opened_root_path(&launch.directory)
        .map_err(|error| format!("Failed to inspect the package directory identity: {error}"))?;
    if retained_package_path != launch.path {
        return Err("Package directory identity changed before task start.".to_string());
    }
    output_observer.prepare(
        &launch.problem_root,
        &launch.problem_root_path,
        &launch.directory,
        &retained_package_path,
    )?;
    let manifest_file = open_manifest_in_directory(&launch.directory)
        .map_err(|error| format!("Failed to open package.json safely: {error}"))?;
    let parsed = parse_manifest(manifest_file)?;
    if !parsed
        .scripts
        .iter()
        .any(|name| name == &request.script_name)
    {
        return Err("The requested package script no longer exists in package.json.".to_string());
    }
    if matches!(policy, ScriptExecutionPolicy::VscodeTask) {
        reject_vscode_lifecycle_hooks(&parsed, &request.script_name)?;
    }
    let manager = parsed
        .manager
        .or_else(|| {
            detect_manager_from_retained_root(
                &launch.problem_root,
                &launch.problem_package_relative,
            )
        })
        .ok_or_else(|| "Could not determine a supported package manager.".to_string())?;

    let mut command = Command::new(manager.executable());
    command
        .arg("run")
        .arg(&request.script_name)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_descriptor_bound_cwd(&mut command, &launch.directory)?;
    let operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let current_descriptor = registry
        .descriptor(&request.workspace_id)
        .map_err(|_| "Node package script workspace is not registered.".to_string())?;
    if current_descriptor != descriptor {
        return Err("The package task workspace identity changed before start.".to_string());
    }
    let current_root_identity = opened_root_path(&root)
        .map_err(|error| format!("Failed to inspect the registered workspace root: {error}"))?;
    if current_root_identity != current_descriptor.canonical_root_path {
        return Err("Registered workspace root identity changed.".to_string());
    }
    let current_problem_root = opened_root_path(&launch.problem_root)
        .map_err(|error| format!("Failed to inspect the package task root: {error}"))?;
    if current_problem_root != launch.problem_root_path {
        return Err("Package task root identity changed before start.".to_string());
    }
    let current_package_path = opened_root_path(&launch.directory)
        .map_err(|error| format!("Failed to inspect the package directory identity: {error}"))?;
    if current_package_path != launch.path {
        return Err("Package directory identity changed before task start.".to_string());
    }
    let trust_guard = trust.lock().map_err(|error| error.to_string())?;
    if !trust_guard.get(trust_root).trusted {
        return Err("Trust this workspace before running a package script.".to_string());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start package script: {error}"))?;
    drop(trust_guard);
    drop(operation);
    let process_group_id = i32::try_from(child.id()).map_err(|_| {
        let _ = child.kill();
        let _ = child.wait();
        "Package script process identifier is out of range.".to_string()
    })?;
    let task_ownership = match terminals.register_task_process_group(
        request.session_id,
        &root_identity,
        process_group_id,
    ) {
        Ok(ownership) => ownership,
        Err(error) => {
            terminate_process_group(process_group_id);
            let cleanup = wait_after_unowned_termination(&mut child);
            return match cleanup {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(format!("{error}; cleanup failed: {cleanup_error}")),
            };
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = stdout.map(|stream| {
        spawn_output_reader(
            stream,
            Arc::clone(&sink),
            Arc::clone(&output_observer),
            request.session_id,
            NodePackageTaskOutputStream::Stdout,
        )
    });
    let stderr_reader = stderr.map(|stream| {
        spawn_output_reader(
            stream,
            Arc::clone(&sink),
            Arc::clone(&output_observer),
            request.session_id,
            NodePackageTaskOutputStream::Stderr,
        )
    });
    Ok(SpawnedNodePackageTask {
        child,
        ownership: task_ownership,
        stderr_reader,
        stdout_reader,
        output_observer,
        settled: false,
    })
}

fn resolve_package_launch_directory(
    workspace: &File,
    workspace_path: &Path,
    package_root: &Path,
    repository_relative: &Path,
    target: &NodePackageTaskLaunchTarget,
) -> Result<NodePackageLaunchDirectory, String> {
    match target {
        NodePackageTaskLaunchTarget::WorkspaceRoot {} => {
            let directory = open_package_directory(workspace, package_root)
                .map_err(|error| format!("Failed to open the package directory safely: {error}"))?;
            Ok(NodePackageLaunchDirectory {
                directory,
                path: workspace_path.join(package_root),
                problem_root: workspace
                    .try_clone()
                    .map_err(|error| format!("Failed to retain workspace identity: {error}"))?,
                problem_root_path: workspace_path.to_path_buf(),
                problem_package_relative: package_root.to_path_buf(),
            })
        }
        NodePackageTaskLaunchTarget::AgentWorktree { thread_id } => {
            resolve_agent_worktree_package_directory(
                workspace,
                workspace_path,
                package_root,
                repository_relative,
                thread_id,
            )
        }
    }
}

fn resolve_agent_worktree_package_directory(
    workspace: &File,
    workspace_path: &Path,
    package_root: &Path,
    repository_relative: &Path,
    thread_id: &str,
) -> Result<NodePackageLaunchDirectory, String> {
    let thread_id = safe_agent_task_id(thread_id)?;
    let worktree_relative = repository_relative
        .join(WORKTREE_BASE_DIR_NAME)
        .join(&thread_id);
    let worktree_directory = open_package_directory(workspace, &worktree_relative)
        .map_err(|_| "The agent worktree no longer exists.".to_string())?;
    let repository_path = workspace_path.join(repository_relative);
    let worktree_path = opened_root_path(&worktree_directory)
        .map_err(|error| format!("Failed to inspect the agent worktree identity: {error}"))?;
    let expected_worktree_path = agent_worktree_path(&repository_path, &thread_id);
    let confined_worktree_path =
        ensure_worktree_path_in_base(&repository_path, &expected_worktree_path)?;
    if worktree_path != confined_worktree_path {
        return Err("Agent worktree identity changed before package task start.".to_string());
    }
    let package_suffix = package_root
        .strip_prefix(repository_relative)
        .map_err(|_| "Package directory is outside the agent worktree repository.".to_string())?;
    let directory =
        open_package_directory(&worktree_directory, package_suffix).map_err(|error| {
            format!("Failed to open the package directory in the agent worktree safely: {error}")
        })?;
    Ok(NodePackageLaunchDirectory {
        path: confined_worktree_path.join(package_suffix),
        directory,
        problem_root: worktree_directory,
        problem_root_path: confined_worktree_path,
        problem_package_relative: package_suffix.to_path_buf(),
    })
}

fn resolve_repository_relative_path(
    workspace: &File,
    workspace_path: &Path,
    repository_root: &Path,
) -> Result<PathBuf, String> {
    if !repository_root.is_absolute() || repository_root.as_os_str().len() > 4 * 1024 {
        return Err("Repository root must be a bounded absolute path.".to_string());
    }
    let relative = repository_root
        .strip_prefix(workspace_path)
        .map_err(|_| "Repository root is outside the registered workspace.".to_string())?;
    if !relative.as_os_str().is_empty() {
        crate::workspace_registry::validate_relative_path(relative)
            .map_err(|_| "Repository root is outside the registered workspace.".to_string())?;
    }
    let directory = open_package_directory(workspace, relative)
        .map_err(|_| "Repository root is outside the registered workspace.".to_string())?;
    let opened = opened_root_path(&directory)
        .map_err(|_| "Repository root identity changed before package task start.".to_string())?;
    if opened != repository_root {
        return Err("Repository root identity changed before package task start.".to_string());
    }
    Ok(relative.to_path_buf())
}

fn reject_vscode_lifecycle_hooks(
    manifest: &ParsedManifest,
    selected_script: &str,
) -> Result<(), String> {
    let pre = format!("pre{selected_script}");
    let post = format!("post{selected_script}");
    if manifest.scripts.iter().any(|script| script == &pre) {
        return Err(format!(
            "The selected npm script defines lifecycle hook \"{pre}\", which VS Code tasks do not execute."
        ));
    }
    if manifest.scripts.iter().any(|script| script == &post) {
        return Err(format!(
            "The selected npm script defines lifecycle hook \"{post}\", which VS Code tasks do not execute."
        ));
    }
    Ok(())
}

pub(crate) fn finish_node_package_task(
    terminals: &TerminalSupervisor,
    mut task: SpawnedNodePackageTask,
) -> NodePackageTaskCompletion {
    let status = wait_for_owned_task(&mut task.child, &task.ownership);
    let stopped = task.ownership.was_stop_requested();
    // Remove ownership immediately after the atomic Reaped/Terminated transition. Reader joins
    // can take arbitrarily longer and must never retain a reusable operating-system PGID.
    terminals.unregister_task(&task.ownership);
    let stdout_result = join_output_reader(task.stdout_reader.take());
    let stderr_result = join_output_reader(task.stderr_reader.take());
    let completion = if stopped {
        NodePackageTaskCompletion::Stopped
    } else {
        match status
            .and_then(|status| {
                stdout_result?;
                stderr_result?;
                Ok(status)
            })
            .map(|status| status.code())
        {
            Ok(exit_code) => NodePackageTaskCompletion::Exited { exit_code },
            Err(message) => NodePackageTaskCompletion::Failed { message },
        }
    };
    task.output_observer.finish_task(matches!(
        completion,
        NodePackageTaskCompletion::Exited { .. }
    ));
    task.settled = true;
    completion
}

fn parse_manifest(file: File) -> Result<ParsedManifest, String> {
    let content = read_bounded_utf8(file, MANIFEST_BYTES_LIMIT)?;
    let manifest: Value = serde_json::from_str(&content)
        .map_err(|error| format!("package.json is not valid JSON: {error}"))?;
    let package_name = manifest
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && name.len() <= PACKAGE_NAME_BYTES_LIMIT)
        .map(str::to_string);
    let manager = match manifest.get("packageManager") {
        Some(Value::String(declared)) => Some(parse_declared_manager(declared)?),
        Some(_) => return Err("packageManager must be a string.".to_string()),
        None => None,
    };
    let mut scripts = manifest
        .get("scripts")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(name, body)| body.is_string() && validate_script_name(name).is_ok())
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    scripts.sort();
    scripts.dedup();
    Ok(ParsedManifest {
        manager,
        package_name,
        scripts,
    })
}

fn parse_declared_manager(declared: &str) -> Result<NodePackageManager, String> {
    match declared.split('@').next().unwrap_or_default().trim() {
        "npm" => Ok(NodePackageManager::Npm),
        "pnpm" => Ok(NodePackageManager::Pnpm),
        "yarn" => Ok(NodePackageManager::Yarn),
        "bun" => Ok(NodePackageManager::Bun),
        _ => Err("package.json declares an unsupported package manager.".to_string()),
    }
}

fn detect_manager_from_lockfiles(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    package_root: &Path,
) -> Option<NodePackageManager> {
    let mut directory = Some(package_root);
    while let Some(current) = directory {
        for (lockfile, manager) in [
            ("pnpm-lock.yaml", NodePackageManager::Pnpm),
            ("yarn.lock", NodePackageManager::Yarn),
            ("package-lock.json", NodePackageManager::Npm),
            ("bun.lock", NodePackageManager::Bun),
            ("bun.lockb", NodePackageManager::Bun),
        ] {
            let candidate = if current.as_os_str().is_empty() {
                PathBuf::from(lockfile)
            } else {
                current.join(lockfile)
            };
            if registry.open_descendant(workspace_id, &candidate).is_ok() {
                return Some(manager);
            }
        }
        directory = current.parent();
    }
    Some(NodePackageManager::Npm)
}

fn detect_manager_from_retained_root(
    root: &File,
    package_root: &Path,
) -> Option<NodePackageManager> {
    let mut directory = Some(package_root);
    while let Some(current) = directory {
        let opened = open_package_directory(root, current).ok()?;
        for (lockfile, manager) in [
            ("pnpm-lock.yaml", NodePackageManager::Pnpm),
            ("yarn.lock", NodePackageManager::Yarn),
            ("package-lock.json", NodePackageManager::Npm),
            ("bun.lock", NodePackageManager::Bun),
            ("bun.lockb", NodePackageManager::Bun),
        ] {
            if open_regular_file_in_directory(&opened, lockfile).is_ok() {
                return Some(manager);
            }
        }
        directory = current.parent();
    }
    Some(NodePackageManager::Npm)
}

fn validate_manifest_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > MANIFEST_PATH_BYTES_LIMIT || value.contains('\0') {
        return Err("The package manifest path exceeds the backend safety limit.".to_string());
    }
    let path = Path::new(value);
    if path.file_name().and_then(|name| name.to_str()) != Some("package.json")
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(
            "The package manifest path must be a safe relative package.json path.".to_string(),
        );
    }
    Ok(path.to_path_buf())
}

fn validate_workspace_id(workspace_id: &WorkspaceId) -> Result<(), String> {
    let value = workspace_id.as_str();
    if value.trim().is_empty() || value.len() > WORKSPACE_ID_BYTES_LIMIT || value.contains('\0') {
        return Err("The workspace identifier is not valid.".to_string());
    }
    Ok(())
}

fn validate_script_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > SCRIPT_NAME_BYTES_LIMIT
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("The package script name is not safe to execute.".to_string());
    }
    Ok(())
}

fn is_excluded_directory(path: &Path, file_type: Option<std::fs::FileType>) -> bool {
    if !file_type.is_some_and(|kind| kind.is_dir()) {
        return false;
    }
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(
            ".git"
                | ".hg"
                | ".svn"
                | "node_modules"
                | "vendor"
                | "dist"
                | "build"
                | "target"
                | ".next"
                | ".turbo"
        )
    )
}

fn relative_path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or_else(|| "A package path is not valid UTF-8.".to_string())
}

fn read_bounded_utf8(file: File, limit: usize) -> Result<String, String> {
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect package.json: {error}"))?;
    if metadata.len() > limit as u64 {
        return Err("package.json exceeds the 256 KiB safety limit.".to_string());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    if bytes.len() > limit {
        return Err("package.json exceeds the 256 KiB safety limit.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "package.json is not valid UTF-8.".to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_package_directory(root: &File, relative: &Path) -> io::Result<File> {
    if relative.as_os_str().is_empty() {
        return root.try_clone();
    }
    crate::workspace_registry::validate_relative_path(relative)?;
    let path = std::ffi::CString::new(relative.as_os_str().as_bytes())?;
    #[cfg(target_os = "macos")]
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            path.as_ptr(),
            libc::O_RDONLY
                | libc::O_DIRECTORY
                | libc::O_CLOEXEC
                | crate::workspace_registry::MACOS_OPEN_BENEATH_NOFOLLOW_FLAGS,
        )
    };
    #[cfg(target_os = "linux")]
    let fd = unsafe {
        let mut how: libc::open_how = std::mem::zeroed();
        how.flags = (libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC) as u64;
        how.resolve = libc::RESOLVE_BENEATH | libc::RESOLVE_NO_SYMLINKS;
        libc::syscall(
            libc::SYS_openat2,
            root.as_raw_fd(),
            path.as_ptr(),
            &how,
            std::mem::size_of::<libc::open_how>(),
        ) as libc::c_int
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_manifest_in_directory(directory: &File) -> io::Result<File> {
    open_regular_file_in_directory(directory, "package.json")
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_regular_file_in_directory(directory: &File, name: &str) -> io::Result<File> {
    let name = std::ffi::CString::new(name)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "package.json is not a regular file",
        ));
    }
    Ok(file)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_package_directory(_root: &File, _relative: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Managed package directories are unsupported on this platform.",
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_manifest_in_directory(_directory: &File) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Descriptor-bound package manifests are unsupported on this platform.",
    ))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn configure_descriptor_bound_cwd(command: &mut Command, directory: &File) -> Result<(), String> {
    let directory = directory
        .try_clone()
        .map_err(|error| format!("Failed to retain package directory identity: {error}"))?;
    unsafe {
        command.pre_exec(move || {
            if libc::setpgid(0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::fchdir(directory.as_raw_fd()) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok(())
}

fn terminate_process_group(process_group_id: i32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

fn wait_for_owned_task(
    child: &mut std::process::Child,
    ownership: &crate::terminal_task_process::TerminalTaskOwnership,
) -> Result<std::process::ExitStatus, String> {
    loop {
        match ownership.try_wait(child) {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(std::time::Duration::from_millis(10)),
            Err(wait_error) => {
                // A wait failure cannot release ownership: kill the whole process group and retry
                // the reap while holding the generation state. This closes output pipes before
                // the caller joins both readers and reports the original failure.
                ownership.terminate();
                let cleanup = ownership.wait_after_terminate(child);
                return match cleanup {
                    Ok(_) => Err(format!("Failed to wait for package script: {wait_error}")),
                    Err(cleanup_error) => Err(format!(
                        "Failed to wait for package script: {wait_error}; cleanup failed: {cleanup_error}"
                    )),
                };
            }
        }
    }
}

fn wait_after_unowned_termination(child: &mut std::process::Child) -> Result<(), String> {
    loop {
        match child.wait() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("failed to reap terminated package task: {error}")),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn configure_descriptor_bound_cwd(_command: &mut Command, _directory: &File) -> Result<(), String> {
    Err("Descriptor-bound package execution is unsupported on this platform.".to_string())
}

fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    sink: Arc<dyn TerminalEventSink>,
    observer: Arc<dyn NodePackageTaskOutputObserver>,
    session_id: u64,
    stream: NodePackageTaskOutputStream,
) -> thread::JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let result = (|| {
            let mut buffer = [0_u8; 8192];
            loop {
                let count = reader.read(&mut buffer).map_err(|error| {
                    format!(
                        "Failed to read package script {}: {error}",
                        stream_name(stream)
                    )
                })?;
                if count == 0 {
                    return Ok(());
                }
                sink.emit_output(TerminalOutputEvent {
                    data: String::from_utf8_lossy(&buffer[..count]).to_string(),
                    session_id,
                });
                observer.observe(stream, &buffer[..count]);
            }
        })();
        observer.finish(stream);
        result
    })
}

fn stream_name(stream: NodePackageTaskOutputStream) -> &'static str {
    match stream {
        NodePackageTaskOutputStream::Stdout => "stdout",
        NodePackageTaskOutputStream::Stderr => "stderr",
    }
}

fn join_output_reader(
    reader: Option<thread::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    let Some(reader) = reader else {
        return Ok(());
    };
    reader
        .join()
        .map_err(|_| "Package script output reader panicked.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        terminal::{TerminalProfile, TerminalRuntimeStatus, TerminalSize},
        terminal_session::{
            SpawnedTerminal, TerminalChild, TerminalExitStatus, TerminalKiller, TerminalPtySpawner,
            TerminalResizer,
        },
    };
    use std::{fs, io::Cursor};

    fn temp_workspace(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "editor-node-scripts-{label}-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&path).expect("create temp workspace");
        path
    }

    fn rand_suffix() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos() as u64
    }

    fn write_manifest(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("manifest parent")).expect("create parent");
        fs::write(path, content).expect("write manifest");
    }

    #[test]
    fn vscode_entry_rejects_selected_script_lifecycle_hooks() {
        let manifest = ParsedManifest {
            manager: Some(NodePackageManager::Npm),
            package_name: None,
            scripts: vec![
                "build".to_string(),
                "prebuild".to_string(),
                "postbuild".to_string(),
            ],
        };

        let error = reject_vscode_lifecycle_hooks(&manifest, "build")
            .expect_err("lifecycle hooks must be rejected");

        assert!(error.contains("prebuild"));
    }

    #[cfg(unix)]
    #[test]
    fn vscode_entry_spawns_and_reaps_a_closed_npm_script_in_test_builds() {
        let root = temp_workspace("vscode-npm-spawn");
        write_manifest(
            &root,
            "package.json",
            r#"{"packageManager":"npm@10","scripts":{"build":"node -e \"process.exit(0)\""}}"#,
        );
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register workspace");
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                descriptor.canonical_root_path.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("start terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("expected running terminal");
        };
        let storage = root.join("trust.json");
        let mut trust = WorkspaceTrustService::load(storage).expect("load trust");
        trust
            .set(
                descriptor
                    .selected_root_path
                    .to_str()
                    .expect("utf8 selected root"),
                true,
            )
            .expect("trust workspace");
        let task = spawn_vscode_node_package_task(
            &registry,
            &Mutex::new(trust),
            &supervisor,
            &RunNodePackageScriptRequest {
                workspace_id: descriptor.workspace_id.clone(),
                session_id,
                manifest_relative_path: "package.json".to_string(),
                repository_root: descriptor
                    .canonical_root_path
                    .to_string_lossy()
                    .into_owned(),
                script_name: "build".to_string(),
                target: NodePackageTaskLaunchTarget::WorkspaceRoot {},
            },
            Arc::new(NoopOutputObserver),
            &descriptor.canonical_root_path,
        )
        .expect("spawn vscode npm task");
        assert!(matches!(
            finish_node_package_task(&supervisor, task),
            NodePackageTaskCompletion::Exited { exit_code: Some(0) }
        ));
        supervisor.stop(session_id).expect("stop terminal");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn package_panel_spawns_in_the_nested_agent_worktree() {
        let root = temp_workspace("agent-worktree-spawn");
        write_manifest(
            &root,
            "repositories/api/packages/web/package.json",
            r#"{"packageManager":"npm@10","scripts":{"build":"node -e \"process.exit(9)\""}}"#,
        );
        write_manifest(
            &root,
            "repositories/api/.worktrees/agt-123-abc/packages/web/package.json",
            r#"{"packageManager":"npm@10","scripts":{"build":"node -e \"require('fs').writeFileSync('cwd.txt', process.cwd())\""}}"#,
        );
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register workspace");
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                descriptor.canonical_root_path.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("start terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("expected running terminal");
        };
        let storage = root.join("trust.json");
        let mut trust = WorkspaceTrustService::load(storage).expect("load trust");
        trust
            .set(
                descriptor
                    .selected_root_path
                    .to_str()
                    .expect("utf8 selected root"),
                true,
            )
            .expect("trust workspace");
        let repository_root = descriptor.canonical_root_path.join("repositories/api");
        let task = spawn_node_package_task(
            &registry,
            &Mutex::new(trust),
            &supervisor,
            &RunNodePackageScriptRequest {
                workspace_id: descriptor.workspace_id,
                session_id,
                manifest_relative_path: "repositories/api/packages/web/package.json".to_string(),
                repository_root: repository_root.to_string_lossy().into_owned(),
                script_name: "build".to_string(),
                target: NodePackageTaskLaunchTarget::AgentWorktree {
                    thread_id: "agt-123-abc".to_string(),
                },
            },
            Arc::new(NoopOutputObserver),
        )
        .expect("spawn worktree package task");
        assert!(matches!(
            finish_node_package_task(&supervisor, task),
            NodePackageTaskCompletion::Exited { exit_code: Some(0) }
        ));
        let package = repository_root.join(".worktrees/agt-123-abc/packages/web");
        assert_eq!(
            fs::read_to_string(package.join("cwd.txt")).expect("read task cwd"),
            package.to_string_lossy()
        );
        supervisor.stop(session_id).expect("stop terminal");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn package_directory_open_rejects_a_symlink_component() {
        use std::os::unix::fs::symlink;

        let root = temp_workspace("package-directory-symlink");
        fs::create_dir_all(root.join("real/package")).expect("create real package");
        symlink("real", root.join("linked")).expect("create package path symlink");
        let root_file = File::open(&root).expect("open workspace root");

        assert!(open_package_directory(&root_file, Path::new("linked/package")).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn nested_repository_worktree_launch_retains_exact_package_and_problem_roots() {
        let root = fs::canonicalize(temp_workspace("nested-worktree-launch"))
            .expect("canonical workspace");
        let repository = root.join("repositories/api");
        let worktree = repository.join(".worktrees/agt-123-abc");
        write_manifest(
            &root,
            "repositories/api/packages/web/package.json",
            r#"{"scripts":{"main":"node main.js"}}"#,
        );
        write_manifest(
            &root,
            "repositories/api/.worktrees/agt-123-abc/packages/web/package.json",
            r#"{"scripts":{"worktree":"node worktree.js"}}"#,
        );
        fs::create_dir_all(worktree.join("packages/web/src")).expect("create worktree source");
        fs::write(worktree.join("packages/web/src/index.ts"), "export {};\n")
            .expect("write worktree source");
        let workspace = File::open(&root).expect("open workspace");

        let launch = resolve_package_launch_directory(
            &workspace,
            &root,
            Path::new("repositories/api/packages/web"),
            Path::new("repositories/api"),
            &NodePackageTaskLaunchTarget::AgentWorktree {
                thread_id: "agt-123-abc".to_string(),
            },
        )
        .expect("resolve nested worktree package");

        assert_eq!(launch.path, worktree.join("packages/web"));
        assert_eq!(launch.problem_root_path, worktree);
        let manifest = parse_manifest(
            open_manifest_in_directory(&launch.directory).expect("open retained manifest"),
        )
        .expect("parse retained manifest");
        assert_eq!(manifest.scripts, vec!["worktree"]);
        let mut matcher = crate::node_package_problem_matcher::NodePackageProblemMatcher::new(
            crate::node_package_problem_matcher::NodePackageProblemMatcherKind::TypeScript,
            &launch.problem_root,
            &launch.problem_root_path,
            &launch.directory,
            &launch.path,
        )
        .expect("create worktree matcher");
        let problems = matcher.push_bytes(
            NodePackageTaskOutputStream::Stdout,
            b"src/index.ts(1,2): error TS1: broken\n",
        );
        assert_eq!(problems.len(), 1);
        assert_eq!(
            problems[0].file_path,
            launch.path.join("src/index.ts").to_string_lossy()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn worktree_launch_rejects_foreign_repository_and_symlinked_target() {
        use std::os::unix::fs::symlink;

        let root = fs::canonicalize(temp_workspace("worktree-repository-authority"))
            .expect("canonical workspace");
        write_manifest(
            &root,
            "repositories/api/packages/web/package.json",
            r#"{"scripts":{"test":"node test.js"}}"#,
        );
        fs::create_dir_all(root.join("repositories/api/.worktrees")).expect("create worktree base");
        fs::create_dir_all(root.join("foreign/agt-123-abc/packages/web"))
            .expect("create foreign target");
        symlink(
            root.join("foreign/agt-123-abc"),
            root.join("repositories/api/.worktrees/agt-123-abc"),
        )
        .expect("link foreign worktree");
        let workspace = File::open(&root).expect("open workspace");
        let target = NodePackageTaskLaunchTarget::AgentWorktree {
            thread_id: "agt-123-abc".to_string(),
        };

        assert!(resolve_package_launch_directory(
            &workspace,
            &root,
            Path::new("repositories/api/packages/web"),
            Path::new("repositories/other"),
            &target,
        )
        .is_err());
        assert!(resolve_package_launch_directory(
            &workspace,
            &root,
            Path::new("repositories/api/packages/web"),
            Path::new("repositories/api"),
            &target,
        )
        .is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn discovers_root_and_nested_scripts_in_stable_order_without_bodies() {
        let root = temp_workspace("nested");
        write_manifest(
            &root,
            "package.json",
            r#"{"name":"root","packageManager":"pnpm@9","scripts":{"test":"secret body","build":"vite"}}"#,
        );
        write_manifest(
            &root,
            "packages/api/package.json",
            r#"{"name":"api","scripts":{"dev":"node server.js"}}"#,
        );
        fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: 9").expect("lockfile");
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).expect("register").workspace_id;
        let result = discover_node_package_scripts_with_registry(
            &registry,
            &id,
            NodePackageScriptDiscoveryLimits {
                max_manifests: 10,
                max_scripts: 10,
                max_visited: 100,
            },
        )
        .expect("discover");

        assert_eq!(result.total, 3, "{result:?}");
        assert!(!result.truncated);
        assert_eq!(result.scripts[0].script_name, "build");
        assert_eq!(result.scripts[2].script_name, "dev");
        let serialized = serde_json::to_string(&result).expect("serialize");
        assert!(!serialized.contains("secret body"));
        assert!(serialized.contains("packages/api/package.json"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn honors_gitignore_excludes_symlinks_and_reports_limits() {
        let root = temp_workspace("bounded");
        write_manifest(
            &root,
            "package.json",
            r#"{"scripts":{"a":"one","b":"two"}}"#,
        );
        write_manifest(
            &root,
            "ignored/package.json",
            r#"{"scripts":{"bad":"bad"}}"#,
        );
        write_manifest(
            &root,
            "node_modules/x/package.json",
            r#"{"scripts":{"bad":"bad"}}"#,
        );
        fs::write(root.join(".gitignore"), "ignored/\n").expect("gitignore");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("package.json"), root.join("linked-package.json"))
            .expect("symlink");
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).expect("register").workspace_id;
        let result = discover_node_package_scripts_with_registry(
            &registry,
            &id,
            NodePackageScriptDiscoveryLimits {
                max_manifests: 10,
                max_scripts: 1,
                max_visited: 100,
            },
        )
        .expect("discover");
        assert_eq!(result.total, 2);
        assert_eq!(result.scripts.len(), 1);
        assert!(result.truncated);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn malformed_oversized_and_unsupported_manifests_are_skipped() {
        let root = temp_workspace("malformed");
        write_manifest(&root, "bad/package.json", "{");
        write_manifest(
            &root,
            "huge/package.json",
            &format!(
                r#"{{"scripts":{{"x":"{}"}}}}"#,
                "x".repeat(MANIFEST_BYTES_LIMIT)
            ),
        );
        write_manifest(
            &root,
            "unsupported/package.json",
            r#"{"packageManager":"other@1","scripts":{"x":"ok"}}"#,
        );
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).expect("register").workspace_id;
        let result = discover_node_package_scripts_with_registry(
            &registry,
            &id,
            NodePackageScriptDiscoveryLimits {
                max_manifests: 10,
                max_scripts: 10,
                max_visited: 100,
            },
        )
        .expect("discover");
        assert!(result.scripts.is_empty());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn strict_inputs_reject_unknown_fields_and_unsafe_names() {
        assert!(
            serde_json::from_value::<NodePackageScriptDiscoveryLimits>(serde_json::json!({
                "maxManifests": 1, "maxScripts": 1, "maxVisited": 1, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DiscoverNodePackageScriptsRequest>(serde_json::json!({
                "workspaceId": "ws-test", "maxManifests": 1, "maxScripts": 1,
                "maxVisited": 1, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DiscoverNodePackageScriptsRequest>(serde_json::json!({
                "workspaceId": "ws-test", "maxManifests": 1, "maxScripts": 1
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<RunNodePackageScriptRequest>(serde_json::json!({
                "workspaceId": "ws-test", "sessionId": 1,
                "manifestRelativePath": "package.json", "scriptName": "test", "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<RunNodePackageScriptRequest>(serde_json::json!({
                "workspaceId": "ws-test", "sessionId": 1,
                "manifestRelativePath": "package.json"
            }))
            .is_err()
        );
        assert!(validate_manifest_relative_path("../package.json").is_err());
        assert!(validate_manifest_relative_path("package.json/other").is_err());
        assert!(validate_manifest_relative_path(&format!(
            "{}/package.json",
            "a".repeat(MANIFEST_PATH_BYTES_LIMIT)
        ))
        .is_err());
        assert!(validate_manifest_relative_path("bad\0/package.json").is_err());
        let blank_id: WorkspaceId = serde_json::from_str(r#""   ""#).expect("blank id");
        assert!(validate_workspace_id(&blank_id).is_err());
        let oversized_id: WorkspaceId =
            serde_json::from_value(serde_json::json!("w".repeat(WORKSPACE_ID_BYTES_LIMIT + 1)))
                .expect("oversized id");
        assert!(validate_workspace_id(&oversized_id).is_err());
        assert!(validate_script_name("-option").is_err());
        assert!(validate_script_name("line\nbreak").is_err());
        assert!(validate_script_name("build prod ✓").is_ok());
        assert!(validate_script_name("žluťoučký").is_ok());
    }

    struct NoopSink;
    impl TerminalEventSink for NoopSink {
        fn emit_output(&self, _event: TerminalOutputEvent) {}
        fn emit_status(&self, _status: TerminalRuntimeStatus) {}
    }

    struct NoopOutputObserver;
    impl NodePackageTaskOutputObserver for NoopOutputObserver {
        fn prepare(
            &self,
            _workspace_root: &File,
            _workspace_path: &Path,
            _package_directory: &File,
            _package_path: &Path,
        ) -> Result<(), String> {
            Ok(())
        }

        fn observe(&self, _stream: NodePackageTaskOutputStream, _bytes: &[u8]) {}

        fn finish(&self, _stream: NodePackageTaskOutputStream) {}

        fn finish_task(&self, _preserve_problems: bool) {}
    }

    struct FakeSpawner;
    impl TerminalPtySpawner for FakeSpawner {
        fn spawn(
            &self,
            _request: &crate::terminal_session::TerminalLaunchRequest,
        ) -> Result<SpawnedTerminal, String> {
            Ok(SpawnedTerminal {
                child: Box::new(FakeChild),
                reader: Box::new(Cursor::new(Vec::<u8>::new())),
                resizer: Box::new(FakeResizer),
                writer: Box::new(Cursor::new(Vec::<u8>::new())),
            })
        }
    }
    struct FakeChild;
    impl TerminalChild for FakeChild {
        fn clone_killer(&self) -> Box<dyn TerminalKiller> {
            Box::new(FakeKiller)
        }
        fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
            Ok(Some(TerminalExitStatus { exit_code: Some(0) }))
        }
        fn wait(&mut self) -> io::Result<TerminalExitStatus> {
            Ok(TerminalExitStatus { exit_code: Some(0) })
        }
    }
    struct FakeKiller;
    impl TerminalKiller for FakeKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    struct FakeResizer;
    impl TerminalResizer for FakeResizer {
        fn resize(&self, _size: TerminalSize) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn terminal_task_sink_enforces_session_workspace_ownership() {
        let root = temp_workspace("session");
        let other = temp_workspace("other-session");
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                root.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("running")
        };
        assert!(supervisor.task_sink(session_id, &root).is_ok());
        assert!(supervisor.task_sink(session_id, &other).is_err());
        let _ = supervisor.stop(session_id);
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(other).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn stopping_terminal_immediately_terminates_registered_task_process_group() {
        let root = temp_workspace("task-stop");
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                root.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("running")
        };
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("spawn task");
        let process_group_id = i32::try_from(child.id()).expect("pid");
        let ownership = supervisor
            .register_task_process_group(session_id, &root, process_group_id)
            .expect("register task");

        supervisor.stop(session_id).expect("stop terminal");
        assert!(ownership.was_stop_requested());
        let status = child.wait().expect("reap task exactly once");
        assert!(!status.success());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn reaped_leader_kills_background_group_before_output_join() {
        let root = temp_workspace("background-group");
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                root.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("running")
        };
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 &"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("spawn leader");
        let process_group_id = i32::try_from(child.id()).expect("pid");
        let ownership = supervisor
            .register_task_process_group(session_id, &root, process_group_id)
            .expect("register group");
        let stdout = child.stdout.take().expect("stdout");
        let reader = spawn_output_reader(
            stdout,
            Arc::new(NoopSink),
            Arc::new(NoopOutputObserver),
            session_id,
            NodePackageTaskOutputStream::Stdout,
        );

        let started = std::time::Instant::now();
        wait_for_owned_task(&mut child, &ownership).expect("reap leader");
        assert!(!ownership.was_stop_requested());
        supervisor.unregister_task(&ownership);
        join_output_reader(Some(reader)).expect("background pipe closes");
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        let _ = supervisor.stop(session_id);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn retargeted_workspace_alias_stops_original_descriptor_task() {
        use std::os::unix::fs::symlink;

        let root_a = temp_workspace("alias-a");
        let root_b = temp_workspace("alias-b");
        let alias = root_a.with_extension("alias");
        symlink(&root_a, &alias).expect("create alias");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root_a).expect("register direct root");
        let alias_descriptor = registry.register(&alias).expect("reuse through alias");
        assert_eq!(alias_descriptor.workspace_id, descriptor.workspace_id);
        let supervisor = TerminalSupervisor::new();
        let status = supervisor
            .start(
                descriptor.canonical_root_path.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("terminal");
        let TerminalRuntimeStatus::Running { session_id, .. } = status else {
            panic!("running")
        };
        let canonical_b = fs::canonicalize(&root_b).expect("canonical b");
        let status_b = supervisor
            .start(
                canonical_b.clone(),
                TerminalSize::default(),
                TerminalProfile {
                    command: None,
                    id: "default".into(),
                    label: "Default".into(),
                },
                None,
                &FakeSpawner,
                Arc::new(NoopSink),
            )
            .expect("terminal b");
        let TerminalRuntimeStatus::Running {
            session_id: session_id_b,
            ..
        } = status_b
        else {
            panic!("running b")
        };
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("spawn task");
        let process_group_id = i32::try_from(child.id()).expect("pid");
        let _ownership = supervisor
            .register_task_process_group(
                session_id,
                &descriptor.canonical_root_path,
                process_group_id,
            )
            .expect("register task");
        let mut command_b = Command::new("/bin/sh");
        command_b.args(["-c", "sleep 30"]);
        unsafe {
            command_b.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child_b = command_b.spawn().expect("spawn task b");
        let process_group_id_b = i32::try_from(child_b.id()).expect("pid b");
        let _ownership_b = supervisor
            .register_task_process_group(session_id_b, &canonical_b, process_group_id_b)
            .expect("register task b");

        fs::remove_file(&alias).expect("remove old alias");
        symlink(&root_b, &alias).expect("retarget alias");
        let retained =
            crate::registered_runtime_root(&registry, alias.to_str().expect("utf8 alias"));
        assert_eq!(retained, descriptor.canonical_root_path);
        supervisor.stop_root(&retained).expect("stop retained root");
        assert!(!child.wait().expect("reap task").success());
        assert!(child_b.try_wait().expect("poll b").is_none());
        supervisor.stop_root(&canonical_b).expect("stop b");
        assert!(!child_b.wait().expect("reap b").success());

        fs::remove_file(alias).expect("remove alias");
        fs::remove_dir_all(root_a).expect("cleanup a");
        fs::remove_dir_all(root_b).expect("cleanup b");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn descriptor_bound_cwd_survives_directory_replacement() {
        let root = temp_workspace("cwd-race");
        let package = root.join("packages/api");
        fs::create_dir_all(&package).expect("package directory");
        let root_file = File::open(&root).expect("open root");
        let package_file = open_package_directory(&root_file, Path::new("packages/api"))
            .expect("open package directory");
        fs::write(package.join("package.json"), r#"{"scripts":{"safe":"ok"}}"#)
            .expect("original manifest");
        let original = root.join("packages/api-original");
        fs::rename(&package, &original).expect("rename package directory");
        fs::create_dir_all(&package).expect("replacement package directory");
        fs::write(
            package.join("package.json"),
            r#"{"scripts":{"replaced":"bad"}}"#,
        )
        .expect("replacement manifest");

        let parsed =
            parse_manifest(open_manifest_in_directory(&package_file).expect("descriptor manifest"))
                .expect("parse descriptor manifest");
        assert_eq!(parsed.scripts, vec!["safe"]);

        let mut command = Command::new("/bin/pwd");
        configure_descriptor_bound_cwd(&mut command, &package_file).expect("configure cwd");
        let output = command.output().expect("run pwd");
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).expect("utf8 pwd").trim(),
            fs::canonicalize(&original)
                .expect("canonical original")
                .to_string_lossy()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
