#![cfg(any(target_os = "macos", target_os = "linux"))]

use crate::{
    process_task_resolver::{resolve_process_task_plan, ProcessTaskPlanError},
    process_task_runtime::{
        package_process_task_definition, production_process_task_environment_policy,
        WorkspaceRegistryProcessTaskResolver,
    },
    trust::WorkspaceTrustService,
    vscode_process_tasks::{ValidatedProcessTask, ValidatedTaskExecution},
    vscode_tasks_discovery::{
        ProcessTaskPlanRejectionCode, ProcessTaskPlanResolution, RetainedWorkspaceFileRead,
        RetainedWorkspaceFileReader, RetainedWorkspaceTaskFile, RetainedWorkspaceTaskFilesRead,
        VscodeProcessTaskPlanResolver, VscodeTasksDiscoveryRequest, VscodeTasksDiscoveryResponse,
        VscodeTasksDiscoveryService,
    },
    workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry},
};
use ignore::{DirEntry, WalkBuilder};
use std::{
    collections::BTreeSet,
    fs::File,
    io::{self, Read},
    path::{Component, Path},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const TASKS_PATH: &str = ".vscode/tasks.json";
const HARD_MAX_VISITED: usize = 100_000;
const EXCLUDED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    "coverage",
];

enum WorkspaceDiscoveryAuthority {
    Trusted {
        descriptor: ManagedWorkspaceDescriptor,
        root: File,
    },
    Unregistered,
    Untrusted,
    Unavailable(String),
}

struct RegistryRetainedWorkspaceFileReader<'a> {
    authority: &'a WorkspaceDiscoveryAuthority,
    workspace_id: &'a WorkspaceId,
    crawl_hook: Option<&'a dyn Fn()>,
}

impl RetainedWorkspaceFileReader for RegistryRetainedWorkspaceFileReader<'_> {
    fn list_registered_workspace_task_files(
        &self,
        workspace_id: &str,
        maximum_manifests: usize,
    ) -> RetainedWorkspaceTaskFilesRead {
        if workspace_id != self.workspace_id.as_str() {
            return RetainedWorkspaceTaskFilesRead::Unregistered;
        }
        let WorkspaceDiscoveryAuthority::Trusted { descriptor, root } = self.authority else {
            return match self.authority {
                WorkspaceDiscoveryAuthority::Unregistered => {
                    RetainedWorkspaceTaskFilesRead::Unregistered
                }
                WorkspaceDiscoveryAuthority::Untrusted => RetainedWorkspaceTaskFilesRead::Untrusted,
                WorkspaceDiscoveryAuthority::Unavailable(message) => {
                    RetainedWorkspaceTaskFilesRead::Unavailable(message.clone())
                }
                WorkspaceDiscoveryAuthority::Trusted { .. } => {
                    RetainedWorkspaceTaskFilesRead::Unavailable(
                        "Task discovery authority changed unexpectedly.".to_string(),
                    )
                }
            };
        };
        if descriptor.workspace_id != *self.workspace_id {
            return RetainedWorkspaceTaskFilesRead::Unregistered;
        }
        if let Some(crawl_hook) = self.crawl_hook {
            crawl_hook();
        }
        match enumerate_task_files(root, descriptor, maximum_manifests) {
            Ok((files, truncated)) => RetainedWorkspaceTaskFilesRead::Files { files, truncated },
            Err(message) => RetainedWorkspaceTaskFilesRead::Unavailable(message),
        }
    }

    fn read_registered_workspace_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
        maximum_bytes: usize,
    ) -> RetainedWorkspaceFileRead {
        if workspace_id != self.workspace_id.as_str() {
            return RetainedWorkspaceFileRead::Unregistered;
        }
        match self.authority {
            WorkspaceDiscoveryAuthority::Unregistered => RetainedWorkspaceFileRead::Unregistered,
            WorkspaceDiscoveryAuthority::Untrusted => RetainedWorkspaceFileRead::Untrusted,
            WorkspaceDiscoveryAuthority::Unavailable(message) => {
                RetainedWorkspaceFileRead::Unavailable(message.clone())
            }
            WorkspaceDiscoveryAuthority::Trusted { descriptor, root } => {
                if !valid_task_source(relative_path)
                    || descriptor.workspace_id != *self.workspace_id
                {
                    return RetainedWorkspaceFileRead::Unavailable(
                        "The retained task file request is invalid.".to_string(),
                    );
                }
                read_bounded_retained_file(root, relative_path, maximum_bytes)
            }
        }
    }
}

struct RegistryVscodeProcessTaskPlanResolver<'a> {
    authority: &'a WorkspaceDiscoveryAuthority,
    registry: &'a WorkspaceRegistry,
    workspace_id: &'a WorkspaceId,
}

impl VscodeProcessTaskPlanResolver for RegistryVscodeProcessTaskPlanResolver<'_> {
    fn resolve(
        &self,
        workspace_id: &str,
        package_root_relative_path: &str,
        _config_revision: &str,
        task: &ValidatedProcessTask,
    ) -> ProcessTaskPlanResolution {
        let WorkspaceDiscoveryAuthority::Trusted { descriptor, .. } = self.authority else {
            return ProcessTaskPlanResolution::Rejected(
                ProcessTaskPlanRejectionCode::PolicyRejected,
            );
        };
        if workspace_id != self.workspace_id.as_str()
            || descriptor.workspace_id != *self.workspace_id
        {
            return ProcessTaskPlanResolution::Rejected(
                ProcessTaskPlanRejectionCode::PolicyRejected,
            );
        }
        if matches!(task.execution, ValidatedTaskExecution::Npm { .. }) {
            return ProcessTaskPlanResolution::Executable;
        }
        let definition = match package_process_task_definition(task, package_root_relative_path) {
            Ok(definition) => definition,
            Err(_) => {
                return ProcessTaskPlanResolution::Rejected(
                    ProcessTaskPlanRejectionCode::PolicyRejected,
                );
            }
        };
        let policy = production_process_task_environment_policy(task);
        let resolver = WorkspaceRegistryProcessTaskResolver::new(self.registry, descriptor.clone());
        match resolve_process_task_plan(&definition, &policy, &resolver) {
            Ok(_) => ProcessTaskPlanResolution::Executable,
            Err(error) => ProcessTaskPlanResolution::Rejected(plan_rejection(error)),
        }
    }
}

#[tauri::command]
pub(crate) async fn workspace_discover_vscode_process_tasks(
    request: VscodeTasksDiscoveryRequest,
    app: AppHandle,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    crate::run_blocking_command(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        discover_registered_vscode_process_tasks(&registry, &trust, request)
    })
    .await
}

pub(crate) fn discover_registered_vscode_process_tasks(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: VscodeTasksDiscoveryRequest,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    discover_registered_vscode_process_tasks_with_optional_crawl_hook(
        registry, trust, request, None,
    )
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn discover_registered_vscode_process_tasks_with_crawl_hook(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: VscodeTasksDiscoveryRequest,
    crawl_hook: &dyn Fn(),
) -> Result<VscodeTasksDiscoveryResponse, String> {
    discover_registered_vscode_process_tasks_with_optional_crawl_hook(
        registry,
        trust,
        request,
        Some(crawl_hook),
    )
}

fn discover_registered_vscode_process_tasks_with_optional_crawl_hook(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: VscodeTasksDiscoveryRequest,
    crawl_hook: Option<&dyn Fn()>,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    let workspace_id = parse_workspace_id(&request.workspace_id)?;
    let authority = {
        let operation = registry
            .lock_operations()
            .map_err(|error| error.to_string())?;
        let trust = trust.lock().map_err(|error| error.to_string())?;
        let authority = match registry.descriptor(&workspace_id) {
            Err(_) => WorkspaceDiscoveryAuthority::Unregistered,
            Ok(descriptor) => match descriptor.selected_root_path.to_str() {
                None => WorkspaceDiscoveryAuthority::Unavailable(
                    "Workspace root path is not valid UTF-8.".to_string(),
                ),
                Some(root) if !trust.get(root).trusted => WorkspaceDiscoveryAuthority::Untrusted,
                Some(_) => match registry.clone_root(&workspace_id) {
                    Ok(root) => WorkspaceDiscoveryAuthority::Trusted { descriptor, root },
                    Err(_) => WorkspaceDiscoveryAuthority::Unavailable(
                        "Unable to retain the task discovery workspace.".to_string(),
                    ),
                },
            },
        };
        drop(trust);
        drop(operation);
        authority
    };
    let reader = RegistryRetainedWorkspaceFileReader {
        authority: &authority,
        workspace_id: &workspace_id,
        crawl_hook,
    };
    let resolver = RegistryVscodeProcessTaskPlanResolver {
        authority: &authority,
        registry,
        workspace_id: &workspace_id,
    };
    let response = VscodeTasksDiscoveryService::new(&reader, &resolver).discover(request);
    let WorkspaceDiscoveryAuthority::Trusted { descriptor, root } = &authority else {
        return Ok(response);
    };
    let retained_root_path = crate::workspace_registry::opened_root_path(root)
        .map_err(|_| "Unable to revalidate the task discovery workspace.".to_string())?;
    let operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let current = registry
        .descriptor(&workspace_id)
        .map_err(|_| "The task discovery workspace is no longer registered.".to_string())?;
    if current.workspace_id != descriptor.workspace_id
        || current.canonical_root_path != descriptor.canonical_root_path
        || retained_root_path != descriptor.canonical_root_path
    {
        return Err("Registered workspace root identity changed.".to_string());
    }
    drop(operation);
    Ok(response)
}

fn parse_workspace_id(value: &str) -> Result<WorkspaceId, String> {
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .map_err(|_| "workspaceId is invalid.".to_string())
}

fn valid_task_source(relative_path: &str) -> bool {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return false;
    }
    relative_path == TASKS_PATH || relative_path.ends_with("/.vscode/tasks.json")
}

fn enumerate_task_files(
    root: &File,
    descriptor: &ManagedWorkspaceDescriptor,
    maximum_manifests: usize,
) -> Result<(Vec<RetainedWorkspaceTaskFile>, bool), String> {
    let opened = crate::workspace_registry::opened_root_path(root)
        .map_err(|_| "Unable to inspect the task discovery workspace.".to_string())?;
    if opened != descriptor.canonical_root_path {
        return Err("Registered workspace root identity changed.".to_string());
    }
    let mut builder = WalkBuilder::new(&opened);
    builder
        .follow_links(false)
        .hidden(false)
        .require_git(false)
        .standard_filters(true)
        .sort_by_file_path(|left, right| left.cmp(right))
        .filter_entry(|entry| !excluded_task_directory(entry));
    let mut manifests = 0_usize;
    let mut truncated = false;
    let mut package_roots = BTreeSet::new();
    package_roots.insert(Path::new("").to_path_buf());
    for (visited, entry) in builder.build().enumerate() {
        if visited == HARD_MAX_VISITED {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            truncated = true;
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file())
            || entry.file_name() != "package.json"
        {
            continue;
        }
        if manifests == maximum_manifests {
            truncated = true;
            break;
        }
        manifests += 1;
        let relative = entry
            .path()
            .strip_prefix(&opened)
            .map_err(|_| "Package discovery escaped the retained workspace.".to_string())?;
        package_roots.insert(
            relative
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_path_buf(),
        );
    }
    let mut files = Vec::new();
    for package_root in package_roots {
        let Some(file) = retained_task_file(root, &package_root)? else {
            continue;
        };
        files.push(file);
    }
    Ok((files, truncated))
}

fn retained_task_file(
    root: &File,
    package_root: &Path,
) -> Result<Option<RetainedWorkspaceTaskFile>, String> {
    let source = package_root.join(TASKS_PATH);
    match crate::workspace_registry::open_file_relative_to(root, &source) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {}
    }
    let package_root_relative_path = if package_root.as_os_str().is_empty() {
        ".".to_string()
    } else {
        normalized_relative_path(package_root)?
    };
    Ok(Some(RetainedWorkspaceTaskFile {
        package_root_relative_path,
        source: normalized_relative_path(&source)?,
    }))
}

fn normalized_relative_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or_else(|| "A task discovery path is not valid UTF-8.".to_string())
}

fn excluded_task_directory(entry: &DirEntry) -> bool {
    entry.file_type().is_some_and(|kind| kind.is_dir())
        && entry
            .file_name()
            .to_str()
            .is_some_and(|name| EXCLUDED_DIRECTORY_NAMES.contains(&name))
}

fn read_bounded_retained_file(
    root: &File,
    relative_path: &str,
    maximum_bytes: usize,
) -> RetainedWorkspaceFileRead {
    let file =
        match crate::workspace_registry::open_file_relative_to(root, Path::new(relative_path)) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return RetainedWorkspaceFileRead::Missing;
            }
            Err(_) => {
                return RetainedWorkspaceFileRead::Unavailable(format!(
                    "Unable to open {relative_path} from the retained workspace."
                ));
            }
        };
    let maximum = match u64::try_from(maximum_bytes) {
        Ok(maximum) => maximum,
        Err(_) => return RetainedWorkspaceFileRead::TooLarge,
    };
    let mut bytes = Vec::new();
    if let Err(error) = file.take(maximum + 1).read_to_end(&mut bytes) {
        return RetainedWorkspaceFileRead::Unavailable(format!(
            "Unable to read {relative_path}: {error}"
        ));
    }
    if bytes.len() > maximum_bytes {
        RetainedWorkspaceFileRead::TooLarge
    } else {
        RetainedWorkspaceFileRead::Content(bytes)
    }
}

fn plan_rejection(error: ProcessTaskPlanError) -> ProcessTaskPlanRejectionCode {
    match error {
        ProcessTaskPlanError::BoundsExceeded(label) if label.contains("argument") => {
            ProcessTaskPlanRejectionCode::InvalidArguments
        }
        ProcessTaskPlanError::BoundsExceeded(label) if label.contains("environment") => {
            ProcessTaskPlanRejectionCode::InvalidEnvironment
        }
        ProcessTaskPlanError::BlockedEnvironment(_)
        | ProcessTaskPlanError::DisallowedEnvironment(_)
        | ProcessTaskPlanError::InvalidEnvironment(_) => {
            ProcessTaskPlanRejectionCode::InvalidEnvironment
        }
        ProcessTaskPlanError::UnsupportedSubstitution(_) => {
            ProcessTaskPlanRejectionCode::UnsupportedVariable
        }
        ProcessTaskPlanError::InvalidPath(label) | ProcessTaskPlanError::WorkspaceEscape(label)
            if label.contains("working") =>
        {
            ProcessTaskPlanRejectionCode::InvalidWorkingDirectory
        }
        ProcessTaskPlanError::ShellInterpreter(_) | ProcessTaskPlanError::UnsupportedCommand(_) => {
            ProcessTaskPlanRejectionCode::InvalidCommand
        }
        ProcessTaskPlanError::InvalidPath(_)
        | ProcessTaskPlanError::WorkspaceEscape(_)
        | ProcessTaskPlanError::BoundsExceeded(_) => ProcessTaskPlanRejectionCode::PolicyRejected,
    }
}
