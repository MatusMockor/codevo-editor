use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::vscode_process_tasks::{
    vscode_tasks_config_revision, ProcessTaskGroup, ValidatedProcessTask,
    ValidatedVscodeTasksConfig, VscodeTasksConfigError, VscodeTasksParser,
    MAX_VSCODE_TASKS_CONFIG_BYTES,
};

const TASKS_RELATIVE_PATH: &str = ".vscode/tasks.json";
const TASK_SOURCE: &str = ".vscode/tasks.json";
const MAX_WORKSPACE_ID_BYTES: usize = 1_024;
const MAX_WIRE_MESSAGE_BYTES: usize = 1_024;
const EMPTY_CONFIG_REVISION: &str =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VscodeTasksDiscoveryRequest {
    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VscodeTasksDiscoveryResponse {
    pub config_revision: String,
    pub tasks: Vec<VscodeTaskDisplay>,
    pub diagnostics: Vec<VscodeTaskDiscoveryDiagnostic>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VscodeTaskDisplay {
    pub label: String,
    pub depends_on: Vec<String>,
    pub detail: Option<String>,
    pub group: VscodeTaskDisplayGroup,
    pub source: String,
    pub executable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VscodeTaskDisplayGroup {
    Build,
    None,
    Test,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VscodeTaskDiscoveryDiagnostic {
    pub severity: VscodeTaskDiagnosticSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VscodeTaskDiagnosticSeverity {
    Error,
    Warning,
}

pub trait RetainedWorkspaceFileReader {
    fn read_registered_workspace_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
        maximum_bytes: usize,
    ) -> RetainedWorkspaceFileRead;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetainedWorkspaceFileRead {
    Content(Vec<u8>),
    Missing,
    TooLarge,
    Unregistered,
    Untrusted,
    Unavailable(String),
}

pub trait VscodeProcessTaskPlanResolver {
    fn resolve(
        &self,
        workspace_id: &str,
        config_revision: &str,
        task: &ValidatedProcessTask,
    ) -> ProcessTaskPlanResolution;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessTaskPlanResolution {
    Executable,
    Rejected(ProcessTaskPlanRejectionCode),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessTaskPlanRejectionCode {
    InvalidArguments,
    InvalidCommand,
    InvalidEnvironment,
    InvalidWorkingDirectory,
    PolicyRejected,
    UnsupportedVariable,
}

pub struct VscodeTasksDiscoveryService<'a, Reader, Resolver> {
    reader: &'a Reader,
    resolver: &'a Resolver,
}

impl<'a, Reader, Resolver> VscodeTasksDiscoveryService<'a, Reader, Resolver>
where
    Reader: RetainedWorkspaceFileReader,
    Resolver: VscodeProcessTaskPlanResolver,
{
    pub fn new(reader: &'a Reader, resolver: &'a Resolver) -> Self {
        Self { reader, resolver }
    }

    pub fn discover(&self, request: VscodeTasksDiscoveryRequest) -> VscodeTasksDiscoveryResponse {
        if !bounded_safe_text(&request.workspace_id, MAX_WORKSPACE_ID_BYTES, false) {
            return empty_response(
                VscodeTaskDiagnosticSeverity::Error,
                "workspaceId must be a bounded safe string",
                false,
                None,
            );
        }
        let bytes = match self.reader.read_registered_workspace_file(
            &request.workspace_id,
            TASKS_RELATIVE_PATH,
            MAX_VSCODE_TASKS_CONFIG_BYTES,
        ) {
            RetainedWorkspaceFileRead::Content(bytes) => bytes,
            RetainedWorkspaceFileRead::Missing => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Warning,
                    "No .vscode/tasks.json file was found.",
                    false,
                    None,
                );
            }
            RetainedWorkspaceFileRead::TooLarge => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    ".vscode/tasks.json exceeds the 256 KiB discovery limit.",
                    true,
                    None,
                );
            }
            RetainedWorkspaceFileRead::Unregistered => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    "The workspace is not registered.",
                    false,
                    None,
                );
            }
            RetainedWorkspaceFileRead::Untrusted => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    "Trust the workspace before discovering process tasks.",
                    false,
                    None,
                );
            }
            RetainedWorkspaceFileRead::Unavailable(message) => {
                return empty_response(VscodeTaskDiagnosticSeverity::Error, &message, false, None);
            }
        };
        if bytes.len() > MAX_VSCODE_TASKS_CONFIG_BYTES {
            return empty_response(
                VscodeTaskDiagnosticSeverity::Error,
                ".vscode/tasks.json exceeds the 256 KiB discovery limit.",
                true,
                Some(vscode_tasks_config_revision(&bytes)),
            );
        }

        let config = match VscodeTasksParser::parse(&bytes) {
            Ok(config) => config,
            Err(error) => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    &config_error_message(error),
                    false,
                    Some(vscode_tasks_config_revision(&bytes)),
                );
            }
        };
        let mut tasks = Vec::new();
        let mut diagnostic_task_labels = BTreeSet::new();
        let mut diagnostics = config
            .diagnostics
            .iter()
            .map(|diagnostic| {
                if let Some(label) = diagnostic.label.clone() {
                    if diagnostic_task_labels.insert(label.clone()) {
                        tasks.push(VscodeTaskDisplay {
                            label,
                            depends_on: Vec::new(),
                            detail: Some(bounded_wire_message(&diagnostic.message)),
                            group: VscodeTaskDisplayGroup::None,
                            source: TASK_SOURCE.to_string(),
                            executable: false,
                        });
                    }
                }
                VscodeTaskDiscoveryDiagnostic {
                    severity: VscodeTaskDiagnosticSeverity::Warning,
                    message: bounded_wire_message(&diagnostic.message),
                }
            })
            .collect::<Vec<_>>();

        let resolved = config
            .tasks
            .iter()
            .cloned()
            .map(|task| {
                let group = display_group(task.group.as_ref());
                let resolution =
                    self.resolver
                        .resolve(&request.workspace_id, &config.revision, &task);
                (task, group, resolution)
            })
            .collect::<Vec<_>>();
        let mut rejected_labels = resolved
            .iter()
            .filter(|(_, _, resolution)| {
                matches!(resolution, ProcessTaskPlanResolution::Rejected(_))
            })
            .map(|(task, _, _)| task.label.clone())
            .collect::<BTreeSet<_>>();
        propagate_rejected_dependencies(&config, &mut rejected_labels);

        for (task, group, resolution) in resolved {
            match resolution {
                ProcessTaskPlanResolution::Executable if rejected_labels.contains(&task.label) => {
                    let message =
                        "A task dependency is not executable under the current policy.".to_string();
                    diagnostics.push(VscodeTaskDiscoveryDiagnostic {
                        severity: VscodeTaskDiagnosticSeverity::Warning,
                        message: message.clone(),
                    });
                    tasks.push(VscodeTaskDisplay {
                        label: task.label,
                        depends_on: task.depends_on,
                        detail: Some(message),
                        group,
                        source: TASK_SOURCE.to_string(),
                        executable: false,
                    });
                }
                ProcessTaskPlanResolution::Executable => tasks.push(VscodeTaskDisplay {
                    label: task.label,
                    depends_on: task.depends_on,
                    detail: None,
                    group,
                    source: TASK_SOURCE.to_string(),
                    executable: true,
                }),
                ProcessTaskPlanResolution::Rejected(rejection) => {
                    let (_, message) = plan_rejection_wire(rejection);
                    let message = message.to_string();
                    diagnostics.push(VscodeTaskDiscoveryDiagnostic {
                        severity: VscodeTaskDiagnosticSeverity::Warning,
                        message: message.clone(),
                    });
                    tasks.push(VscodeTaskDisplay {
                        label: task.label,
                        depends_on: task.depends_on,
                        detail: Some(message),
                        group,
                        source: TASK_SOURCE.to_string(),
                        executable: false,
                    });
                }
            }
        }
        VscodeTasksDiscoveryResponse {
            config_revision: config.revision,
            tasks,
            diagnostics,
            truncated: false,
        }
    }
}

fn propagate_rejected_dependencies(
    config: &ValidatedVscodeTasksConfig,
    rejected: &mut BTreeSet<String>,
) {
    let transitively_rejected = config
        .tasks
        .iter()
        .filter(|task| !rejected.contains(&task.label))
        .filter(|task| {
            config
                .resolve_sequential_chain(&task.label)
                .is_ok_and(|chain| {
                    chain
                        .iter()
                        .any(|dependency| rejected.contains(&dependency.label))
                })
        })
        .map(|task| task.label.clone())
        .collect::<Vec<_>>();
    rejected.extend(transitively_rejected);
}

fn empty_response(
    severity: VscodeTaskDiagnosticSeverity,
    message: &str,
    truncated: bool,
    config_revision: Option<String>,
) -> VscodeTasksDiscoveryResponse {
    VscodeTasksDiscoveryResponse {
        config_revision: config_revision.unwrap_or_else(|| EMPTY_CONFIG_REVISION.to_string()),
        tasks: Vec::new(),
        diagnostics: vec![VscodeTaskDiscoveryDiagnostic {
            severity,
            message: bounded_wire_message(message),
        }],
        truncated,
    }
}

fn config_error_message(error: VscodeTasksConfigError) -> String {
    match error {
        VscodeTasksConfigError::TooLarge { .. } => {
            ".vscode/tasks.json exceeds the discovery limit.".to_string()
        }
        VscodeTasksConfigError::InvalidJsonc(message)
        | VscodeTasksConfigError::InvalidRoot(message) => message,
    }
}

fn plan_rejection_wire(code: ProcessTaskPlanRejectionCode) -> (&'static str, &'static str) {
    match code {
        ProcessTaskPlanRejectionCode::InvalidArguments => {
            ("invalidArguments", "The task arguments are not executable.")
        }
        ProcessTaskPlanRejectionCode::InvalidCommand => {
            ("invalidCommand", "The task command is not executable.")
        }
        ProcessTaskPlanRejectionCode::InvalidEnvironment => (
            "invalidEnvironment",
            "The task environment is not executable.",
        ),
        ProcessTaskPlanRejectionCode::InvalidWorkingDirectory => (
            "invalidWorkingDirectory",
            "The task working directory is not executable.",
        ),
        ProcessTaskPlanRejectionCode::PolicyRejected => (
            "policyRejected",
            "Task is not executable under the current process-task policy.",
        ),
        ProcessTaskPlanRejectionCode::UnsupportedVariable => (
            "unsupportedVariable",
            "The task contains an unsupported variable.",
        ),
    }
}

fn display_group(group: Option<&ProcessTaskGroup>) -> VscodeTaskDisplayGroup {
    match group {
        Some(ProcessTaskGroup::Name(name))
        | Some(ProcessTaskGroup::Definition { kind: name, .. })
            if name.eq_ignore_ascii_case("build") =>
        {
            VscodeTaskDisplayGroup::Build
        }
        Some(ProcessTaskGroup::Name(name))
        | Some(ProcessTaskGroup::Definition { kind: name, .. })
            if name.eq_ignore_ascii_case("test") =>
        {
            VscodeTaskDisplayGroup::Test
        }
        _ => VscodeTaskDisplayGroup::None,
    }
}

fn bounded_wire_message(value: &str) -> String {
    let clean = value
        .chars()
        .map(|character| {
            if character.is_control() {
                '\u{fffd}'
            } else {
                character
            }
        })
        .collect::<String>();
    truncate_utf8(&clean, MAX_WIRE_MESSAGE_BYTES)
}

fn truncate_utf8(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_string();
    }
    let mut end = maximum_bytes.saturating_sub('…'.len_utf8());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn bounded_safe_text(value: &str, maximum_bytes: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.len() <= maximum_bytes
        && !value.chars().any(char::is_control)
}
