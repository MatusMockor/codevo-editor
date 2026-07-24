#![cfg(any(target_os = "macos", target_os = "linux"))]

use crate::{
    process_task_plan::ProcessTaskDefinition,
    process_task_resolver::{resolve_process_task_plan, ProcessTaskPlanError},
    process_task_runtime::{
        production_process_task_environment_policy, WorkspaceRegistryProcessTaskResolver,
    },
    trust::WorkspaceTrustService,
    vscode_process_tasks::ValidatedProcessTask,
    vscode_tasks_discovery::{
        ProcessTaskPlanRejectionCode, ProcessTaskPlanResolution, RetainedWorkspaceFileRead,
        RetainedWorkspaceFileReader, VscodeProcessTaskPlanResolver, VscodeTasksDiscoveryRequest,
        VscodeTasksDiscoveryResponse, VscodeTasksDiscoveryService,
    },
    workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry},
};
use std::{
    io::{self, Read},
    path::Path,
    sync::Mutex,
};
use tauri::State;

const TASKS_PATH: &str = ".vscode/tasks.json";

enum WorkspaceDiscoveryAuthority {
    Trusted(ManagedWorkspaceDescriptor),
    Unregistered,
    Untrusted,
    Unavailable(String),
}

struct RegistryRetainedWorkspaceFileReader<'a> {
    authority: &'a WorkspaceDiscoveryAuthority,
    registry: &'a WorkspaceRegistry,
    workspace_id: &'a WorkspaceId,
}

impl RetainedWorkspaceFileReader for RegistryRetainedWorkspaceFileReader<'_> {
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
            WorkspaceDiscoveryAuthority::Trusted(descriptor) => {
                if relative_path != TASKS_PATH || descriptor.workspace_id != *self.workspace_id {
                    return RetainedWorkspaceFileRead::Unavailable(
                        "The retained task file request is invalid.".to_string(),
                    );
                }
                read_bounded_retained_file(
                    self.registry,
                    self.workspace_id,
                    relative_path,
                    maximum_bytes,
                )
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
        _config_revision: &str,
        task: &ValidatedProcessTask,
    ) -> ProcessTaskPlanResolution {
        let WorkspaceDiscoveryAuthority::Trusted(descriptor) = self.authority else {
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
        let definition = ProcessTaskDefinition::from(task);
        let policy = production_process_task_environment_policy(task);
        let resolver = WorkspaceRegistryProcessTaskResolver::new(self.registry, descriptor.clone());
        match resolve_process_task_plan(&definition, &policy, &resolver) {
            Ok(_) => ProcessTaskPlanResolution::Executable,
            Err(error) => ProcessTaskPlanResolution::Rejected(plan_rejection(error)),
        }
    }
}

#[tauri::command]
pub(crate) fn workspace_discover_vscode_process_tasks(
    request: VscodeTasksDiscoveryRequest,
    registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    discover_registered_vscode_process_tasks(&registry, &trust, request)
}

pub(crate) fn discover_registered_vscode_process_tasks(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: VscodeTasksDiscoveryRequest,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    let workspace_id = parse_workspace_id(&request.workspace_id)?;
    let _operation = registry
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
            Some(_) => WorkspaceDiscoveryAuthority::Trusted(descriptor),
        },
    };
    let reader = RegistryRetainedWorkspaceFileReader {
        authority: &authority,
        registry,
        workspace_id: &workspace_id,
    };
    let resolver = RegistryVscodeProcessTaskPlanResolver {
        authority: &authority,
        registry,
        workspace_id: &workspace_id,
    };
    let response = VscodeTasksDiscoveryService::new(&reader, &resolver).discover(request);
    drop(trust);
    drop(_operation);
    Ok(response)
}

fn parse_workspace_id(value: &str) -> Result<WorkspaceId, String> {
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .map_err(|_| "workspaceId is invalid.".to_string())
}

fn read_bounded_retained_file(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    relative_path: &str,
    maximum_bytes: usize,
) -> RetainedWorkspaceFileRead {
    let file = match registry.open_descendant(workspace_id, Path::new(relative_path)) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return RetainedWorkspaceFileRead::Missing;
        }
        Err(_) => {
            return RetainedWorkspaceFileRead::Unavailable(
                "Unable to open .vscode/tasks.json from the retained workspace.".to_string(),
            );
        }
    };
    let maximum = match u64::try_from(maximum_bytes) {
        Ok(maximum) => maximum,
        Err(_) => return RetainedWorkspaceFileRead::TooLarge,
    };
    let mut bytes = Vec::new();
    if let Err(error) = file.take(maximum + 1).read_to_end(&mut bytes) {
        return RetainedWorkspaceFileRead::Unavailable(format!(
            "Unable to read .vscode/tasks.json: {error}"
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
