#![cfg(any(target_os = "macos", target_os = "linux"))]

use crate::{
    managed_javascript_typescript::node_executable_path,
    process_task_plan::{
        ProcessTaskDefinition, ProcessTaskEnvironmentPolicy, ProcessTaskExecutionPlan,
    },
    process_task_resolver::{
        resolve_process_task_plan, ProcessTaskPlanError, RetainedProcessTaskRootResolver,
    },
    terminal::TerminalEventSink,
    terminal_session::TerminalSupervisor,
    terminal_task_process::TerminalTaskOwnership,
    trust::WorkspaceTrustService,
    vscode_process_tasks::{
        ValidatedProcessTask, VscodeTasksParser, MAX_VSCODE_TASKS_CONFIG_BYTES,
    },
    workspace_registry::{
        opened_regular_file_path, opened_root_path, ManagedWorkspaceDescriptor, WorkspaceId,
        WorkspaceRegistry,
    },
};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStderr, ChildStdout, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

const TASKS_CONFIG_PATH: &str = ".vscode/tasks.json";

#[derive(Clone, Debug)]
pub(crate) struct ProcessTaskOwner {
    pub workspace_id: WorkspaceId,
    pub workspace_root: PathBuf,
    pub terminal_session_id: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct SpawnProcessTaskRequest {
    pub owner: ProcessTaskOwner,
    pub config_revision: String,
    pub label: String,
}

pub(crate) struct SpawnedProcessTask {
    pub child: Child,
    pub ownership: TerminalTaskOwnership,
    pub sink: Arc<dyn TerminalEventSink>,
    pub stdout: Option<ChildStdout>,
    pub stderr: Option<ChildStderr>,
}

pub(crate) struct ProcessTaskRuntime<'a> {
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    terminals: &'a TerminalSupervisor,
}

impl<'a> ProcessTaskRuntime<'a> {
    pub(crate) fn new(
        registry: &'a WorkspaceRegistry,
        trust: &'a Mutex<WorkspaceTrustService>,
        terminals: &'a TerminalSupervisor,
    ) -> Self {
        Self {
            registry,
            trust,
            terminals,
        }
    }

    /// Resolves the dependency graph from an authoritative, freshly reopened configuration.
    /// Returned labels are execution hints only; every individual step is fully revalidated by
    /// `prepare_and_spawn`.
    pub(crate) fn resolve_chain_labels(
        &self,
        request: &SpawnProcessTaskRequest,
    ) -> Result<Vec<String>, String> {
        let _operation = self
            .registry
            .lock_operations()
            .map_err(|error| error.to_string())?;
        let descriptor = self
            .registry
            .descriptor(&request.owner.workspace_id)
            .map_err(|_| "Process task workspace is not registered.".to_string())?;
        validate_owner_root(&request.owner, &descriptor)?;
        let config = read_current_tasks_config(
            self.registry,
            &request.owner.workspace_id,
            &request.config_revision,
        )?;
        let _trust = validate_workspace_trust(self.trust, &descriptor)?;
        let chain = config
            .resolve_sequential_chain(&request.label)
            .map_err(|_| "The selected process task no longer exists.".to_string())?;
        let resolver = WorkspaceRegistryProcessTaskResolver::new(self.registry, descriptor);
        for task in &chain {
            let definition = ProcessTaskDefinition::from(*task);
            let environment_policy = production_process_task_environment_policy(task);
            resolve_process_task_plan(&definition, &environment_policy, &resolver)
                .map_err(format_plan_error)?;
        }
        Ok(chain.iter().map(|task| task.label.clone()).collect())
    }

    /// Revalidates every authority-bearing input while the workspace operation lock is held.
    /// Discovery results are hints only: the config is reopened and parsed again immediately
    /// before the process is created.
    pub(crate) fn prepare_and_spawn(
        &self,
        request: &SpawnProcessTaskRequest,
    ) -> Result<SpawnedProcessTask, String> {
        let _operation = self
            .registry
            .lock_operations()
            .map_err(|error| error.to_string())?;
        let descriptor = self
            .registry
            .descriptor(&request.owner.workspace_id)
            .map_err(|_| "Process task workspace is not registered.".to_string())?;
        validate_owner_root(&request.owner, &descriptor)?;

        let config = read_current_tasks_config(
            self.registry,
            &request.owner.workspace_id,
            &request.config_revision,
        )?;
        let mut matching = config
            .tasks
            .iter()
            .filter(|task| task.label == request.label);
        let task = matching
            .next()
            .ok_or_else(|| "The selected process task no longer exists.".to_string())?;
        if matching.next().is_some() {
            return Err("The selected process task label is ambiguous.".to_string());
        }

        let resolver = WorkspaceRegistryProcessTaskResolver::new(self.registry, descriptor.clone());
        let definition = ProcessTaskDefinition::from(task);
        let environment_policy = production_process_task_environment_policy(task);
        let plan = resolve_process_task_plan(&definition, &environment_policy, &resolver)
            .map_err(format_plan_error)?;

        let trust = validate_workspace_trust(self.trust, &descriptor)?;

        let sink = self.terminals.task_sink(
            request.owner.terminal_session_id,
            &descriptor.canonical_root_path,
        )?;
        let mut child = spawn_process_task(&plan)?;
        let process_group_id = match i32::try_from(child.id()) {
            Ok(process_group_id) => process_group_id,
            Err(_) => {
                terminate_unowned_process(&mut child, None);
                return Err("Process task identifier is out of range.".to_string());
            }
        };
        let ownership = match self.terminals.register_task_process_group(
            request.owner.terminal_session_id,
            &descriptor.canonical_root_path,
            process_group_id,
        ) {
            Ok(ownership) => ownership,
            Err(error) => {
                terminate_unowned_process(&mut child, Some(process_group_id));
                return Err(error);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        drop(trust);
        drop(_operation);
        Ok(SpawnedProcessTask {
            child,
            ownership,
            sink,
            stdout,
            stderr,
        })
    }
}

fn read_current_tasks_config(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    expected_revision: &str,
) -> Result<crate::vscode_process_tasks::ValidatedVscodeTasksConfig, String> {
    let bytes = read_retained_tasks_config(registry, workspace_id)?;
    let config = VscodeTasksParser::parse(&bytes)
        .map_err(|error| format!("Unable to parse .vscode/tasks.json: {error:?}"))?;
    if config.revision != expected_revision {
        return Err(
            "The task configuration changed after discovery. Refresh tasks and try again."
                .to_string(),
        );
    }
    Ok(config)
}

fn validate_workspace_trust<'a>(
    trust: &'a Mutex<WorkspaceTrustService>,
    descriptor: &ManagedWorkspaceDescriptor,
) -> Result<std::sync::MutexGuard<'a, WorkspaceTrustService>, String> {
    let trust_root = descriptor
        .selected_root_path
        .to_str()
        .ok_or_else(|| "Workspace root path is not valid UTF-8.".to_string())?;
    let guard = trust.lock().map_err(|error| error.to_string())?;
    if !guard.get(trust_root).trusted {
        return Err("Trust this workspace before running process tasks.".to_string());
    }
    Ok(guard)
}

pub(crate) fn production_process_task_environment_policy(
    task: &ValidatedProcessTask,
) -> ProcessTaskEnvironmentPolicy {
    let allowed_explicit_keys = task.options.env.keys().cloned().collect::<BTreeSet<_>>();
    let inherited_baseline = ["HOME", "PATH", "TMPDIR", "SystemRoot"]
        .into_iter()
        .filter_map(|key| {
            env::var_os(key)
                .and_then(|value| value.into_string().ok())
                .map(|value| (key.to_string(), value))
        })
        .collect::<BTreeMap<_, _>>();
    ProcessTaskEnvironmentPolicy {
        allowed_explicit_keys,
        inherited_baseline,
    }
}

impl From<&ValidatedProcessTask> for ProcessTaskDefinition {
    fn from(task: &ValidatedProcessTask) -> Self {
        Self {
            command: task.command.clone(),
            args: task.args.clone(),
            cwd: task.options.cwd.clone(),
            env: task.options.env.clone(),
        }
    }
}

pub(crate) struct WorkspaceRegistryProcessTaskResolver<'a> {
    registry: &'a WorkspaceRegistry,
    descriptor: ManagedWorkspaceDescriptor,
}

impl<'a> WorkspaceRegistryProcessTaskResolver<'a> {
    pub(crate) fn new(
        registry: &'a WorkspaceRegistry,
        descriptor: ManagedWorkspaceDescriptor,
    ) -> Self {
        Self {
            registry,
            descriptor,
        }
    }

    fn retained_relative_path(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        let relative = candidate
            .strip_prefix(&self.descriptor.canonical_root_path)
            .map_err(|_| ProcessTaskPlanError::WorkspaceEscape("path"))?;
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(ProcessTaskPlanError::InvalidPath("path"));
        }
        Ok(relative.to_path_buf())
    }

    fn open_retained(&self, candidate: &Path) -> Result<fs::File, ProcessTaskPlanError> {
        let relative = self.retained_relative_path(candidate)?;
        if relative.as_os_str().is_empty() {
            return self
                .registry
                .clone_root(&self.descriptor.workspace_id)
                .map_err(|_| ProcessTaskPlanError::InvalidPath("workspace root"));
        }
        self.registry
            .open_descendant(&self.descriptor.workspace_id, &relative)
            .map_err(|_| ProcessTaskPlanError::InvalidPath("workspace descendant"))
    }

    fn canonical_retained_path(
        &self,
        candidate: &Path,
        expected_directory: bool,
    ) -> Result<PathBuf, ProcessTaskPlanError> {
        let retained = self.open_retained(candidate)?;
        let canonical = if expected_directory {
            opened_root_path(&retained)
        } else {
            opened_regular_file_path(&retained)
        }
        .map_err(|_| ProcessTaskPlanError::InvalidPath("workspace descendant"))?;
        if !self.is_within_retained_root(&canonical) {
            return Err(ProcessTaskPlanError::WorkspaceEscape(
                "workspace descendant",
            ));
        }
        Ok(canonical)
    }

    fn canonical_symlink_target(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        // First reject a lexical escape, then canonicalize only to identify an internal target.
        // The target is reopened relative to the retained root without following any symlink, so
        // a concurrent link swap cannot redirect the returned executable outside the workspace.
        self.retained_relative_path(candidate)?;
        let target = fs::canonicalize(candidate)
            .map_err(|_| ProcessTaskPlanError::InvalidPath("executable"))?;
        if !self.is_within_retained_root(&target) {
            return Err(ProcessTaskPlanError::WorkspaceEscape("executable"));
        }
        let relative = self.retained_relative_path(&target)?;
        let retained = self
            .registry
            .open_descendant(&self.descriptor.workspace_id, &relative)
            .map_err(|_| ProcessTaskPlanError::InvalidPath("executable"))?;
        let reopened = opened_regular_file_path(&retained)
            .map_err(|_| ProcessTaskPlanError::InvalidPath("executable"))?;
        if reopened != target {
            return Err(ProcessTaskPlanError::InvalidPath("executable"));
        }
        Ok(reopened)
    }
}

impl RetainedProcessTaskRootResolver for WorkspaceRegistryProcessTaskResolver<'_> {
    fn canonical_root(&self) -> Result<PathBuf, ProcessTaskPlanError> {
        let root = self.descriptor.canonical_root_path.clone();
        self.canonical_retained_path(&root, true)
    }

    fn canonical_directory(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        self.canonical_retained_path(candidate, true)
    }

    fn canonical_executable(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        let executable = match self.canonical_retained_path(candidate, false) {
            Ok(executable) => executable,
            Err(_) => self.canonical_symlink_target(candidate)?,
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&executable)
                .map_err(|_| ProcessTaskPlanError::InvalidPath("executable"))?
                .permissions()
                .mode();
            if mode & 0o111 == 0 {
                return Err(ProcessTaskPlanError::InvalidPath("executable"));
            }
        }
        Ok(executable)
    }

    fn backend_node_executable(&self) -> Result<PathBuf, ProcessTaskPlanError> {
        let executable = node_executable_path()
            .ok_or_else(|| ProcessTaskPlanError::UnsupportedCommand("node".to_string()))?;
        let canonical = fs::canonicalize(executable)
            .map_err(|_| ProcessTaskPlanError::InvalidPath("backend Node"))?;
        if !canonical.is_file() {
            return Err(ProcessTaskPlanError::InvalidPath("backend Node"));
        }
        Ok(canonical)
    }

    fn is_within_retained_root(&self, canonical_path: &Path) -> bool {
        canonical_path == self.descriptor.canonical_root_path
            || canonical_path.starts_with(&self.descriptor.canonical_root_path)
    }
}

pub(crate) fn spawn_process_task(plan: &ProcessTaskExecutionPlan) -> Result<Child, String> {
    let mut command = Command::new(plan.program());
    command
        .args(plan.args())
        .current_dir(plan.cwd())
        .env_clear()
        .envs(plan.env())
        .env("LC_ALL", "C")
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("Unable to launch process task: {error}"))
}

/// Reaps the leader only after the ownership object has terminated descendants. Output pipes
/// intentionally remain caller-owned, so reader threads can be joined after this returns.
pub(crate) fn finish_process_task(
    terminals: &TerminalSupervisor,
    run: &mut SpawnedProcessTask,
) -> Result<ExitStatus, String> {
    let status = loop {
        match run.ownership.try_wait(&mut run.child) {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => break Err(error),
        }
    };
    let result = match status {
        Ok(status) => Ok(status),
        Err(error) => run
            .ownership
            .wait_after_terminate(&mut run.child)
            .map_err(|cleanup| {
                format!("Failed to wait for process task: {error}; cleanup failed: {cleanup}")
            }),
    };
    terminals.unregister_task(&run.ownership);
    result
}

fn validate_owner_root(
    owner: &ProcessTaskOwner,
    descriptor: &ManagedWorkspaceDescriptor,
) -> Result<(), String> {
    if owner.workspace_root != descriptor.canonical_root_path {
        return Err(
            "The process task owner does not match the registered workspace root.".to_string(),
        );
    }
    Ok(())
}

fn read_retained_tasks_config(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
) -> Result<Vec<u8>, String> {
    let file = registry
        .open_descendant(workspace_id, Path::new(TASKS_CONFIG_PATH))
        .map_err(|_| {
            "Unable to reopen .vscode/tasks.json from the retained workspace.".to_string()
        })?;
    let maximum = u64::try_from(MAX_VSCODE_TASKS_CONFIG_BYTES)
        .map_err(|_| "Process task configuration limit is invalid.".to_string())?;
    let mut bytes = Vec::new();
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Unable to read .vscode/tasks.json: {error}"))?;
    if bytes.len() > MAX_VSCODE_TASKS_CONFIG_BYTES {
        return Err("The process task configuration exceeds the supported size.".to_string());
    }
    Ok(bytes)
}

fn format_plan_error(error: ProcessTaskPlanError) -> String {
    format!("Process task is not safe to execute: {error}")
}

fn terminate_unowned_process(child: &mut Child, process_group_id: Option<i32>) {
    #[cfg(unix)]
    if let Some(process_group_id) = process_group_id {
        unsafe {
            libc::kill(-process_group_id, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    loop {
        match child.wait() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            _ => break,
        }
    }
}
