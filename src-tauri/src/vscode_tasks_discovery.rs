use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

use crate::vscode_process_tasks::{
    vscode_tasks_config_revision, ProcessTaskGroup, ProcessTaskProblemMatcher,
    ValidatedProcessTask, ValidatedVscodeTasksConfig, VscodeTasksConfigError, VscodeTasksParser,
    MAX_VSCODE_TASKS_CONFIG_BYTES,
};

const MAX_WORKSPACE_ID_BYTES: usize = 1_024;
const MAX_WIRE_MESSAGE_BYTES: usize = 1_024;
pub(crate) const MAX_DISCOVERED_TASKS: usize = 4_096;
pub(crate) const MAX_DISCOVERY_DIAGNOSTICS: usize = 1_024;
pub(crate) const HARD_MAX_MANIFESTS: usize = 2_000;
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
    pub package: String,
    pub label: String,
    pub depends_on: Vec<String>,
    pub config_revision: String,
    pub detail: Option<String>,
    pub group: VscodeTaskDisplayGroup,
    pub problem_matcher: Option<VscodeTaskProblemMatcherKind>,
    pub source: String,
    pub executable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VscodeTaskProblemMatcherKind {
    TypeScript,
    Eslint,
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
    fn list_registered_workspace_task_files(
        &self,
        workspace_id: &str,
        maximum_manifests: usize,
    ) -> RetainedWorkspaceTaskFilesRead;

    fn read_registered_workspace_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
        maximum_bytes: usize,
    ) -> RetainedWorkspaceFileRead;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetainedWorkspaceTaskFile {
    pub package_root_relative_path: String,
    pub source: String,
}

#[cfg_attr(test, allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetainedWorkspaceTaskFilesRead {
    Files {
        files: Vec<RetainedWorkspaceTaskFile>,
        truncated: bool,
    },
    Unregistered,
    Untrusted,
    Unavailable(String),
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
        package_root_relative_path: &str,
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
        let (files, mut truncated) = match self
            .reader
            .list_registered_workspace_task_files(&request.workspace_id, HARD_MAX_MANIFESTS)
        {
            RetainedWorkspaceTaskFilesRead::Files { files, truncated } => (files, truncated),
            RetainedWorkspaceTaskFilesRead::Unregistered => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    "The workspace is not registered.",
                    false,
                    None,
                );
            }
            RetainedWorkspaceTaskFilesRead::Untrusted => {
                return empty_response(
                    VscodeTaskDiagnosticSeverity::Error,
                    "Trust the workspace before discovering process tasks.",
                    false,
                    None,
                );
            }
            RetainedWorkspaceTaskFilesRead::Unavailable(message) => {
                return empty_response(VscodeTaskDiagnosticSeverity::Error, &message, false, None);
            }
        };
        let mut tasks = Vec::new();
        let mut diagnostics = Vec::new();
        let mut revisions = Vec::new();
        if truncated {
            push_diagnostic(
                &mut diagnostics,
                VscodeTaskDiscoveryDiagnostic {
                    severity: VscodeTaskDiagnosticSeverity::Warning,
                    message: format!(
                        "VS Code task discovery reached the package manifest limit of {HARD_MAX_MANIFESTS}."
                    ),
                },
                &mut truncated,
            );
        }

        for file in files {
            let bytes = match self.reader.read_registered_workspace_file(
                &request.workspace_id,
                &file.source,
                MAX_VSCODE_TASKS_CONFIG_BYTES,
            ) {
                RetainedWorkspaceFileRead::Content(bytes) => bytes,
                RetainedWorkspaceFileRead::Missing => {
                    truncated = true;
                    push_diagnostic(
                        &mut diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Warning,
                            message: bounded_wire_message(&format!(
                                "{} disappeared after task discovery enumerated it.",
                                file.source
                            )),
                        },
                        &mut truncated,
                    );
                    continue;
                }
                RetainedWorkspaceFileRead::TooLarge => {
                    truncated = true;
                    push_diagnostic(
                        &mut diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Error,
                            message: bounded_wire_message(&format!(
                                "{} exceeds the 256 KiB discovery limit.",
                                file.source
                            )),
                        },
                        &mut truncated,
                    );
                    continue;
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
                    push_diagnostic(
                        &mut diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Error,
                            message: bounded_wire_message(&message),
                        },
                        &mut truncated,
                    );
                    continue;
                }
            };
            let revision = vscode_tasks_config_revision(&bytes);
            revisions.push((file.source.clone(), revision.clone()));
            if bytes.len() > MAX_VSCODE_TASKS_CONFIG_BYTES {
                truncated = true;
                push_diagnostic(
                    &mut diagnostics,
                    VscodeTaskDiscoveryDiagnostic {
                        severity: VscodeTaskDiagnosticSeverity::Error,
                        message: bounded_wire_message(&format!(
                            "{} exceeds the 256 KiB discovery limit.",
                            file.source
                        )),
                    },
                    &mut truncated,
                );
                continue;
            }
            let config = match VscodeTasksParser::parse(&bytes) {
                Ok(config) => config,
                Err(error) => {
                    push_diagnostic(
                        &mut diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Error,
                            message: bounded_wire_message(&format!(
                                "{}: {}",
                                file.source,
                                config_error_message(error)
                            )),
                        },
                        &mut truncated,
                    );
                    continue;
                }
            };
            self.append_config(
                &request.workspace_id,
                &file,
                config,
                &mut tasks,
                &mut diagnostics,
                &mut truncated,
            );
        }
        if revisions.is_empty() && diagnostics.is_empty() {
            return empty_response(
                VscodeTaskDiagnosticSeverity::Warning,
                "No .vscode/tasks.json file was found.",
                truncated,
                None,
            );
        }
        VscodeTasksDiscoveryResponse {
            config_revision: aggregate_config_revision(&revisions),
            tasks,
            diagnostics,
            truncated,
        }
    }

    fn append_config(
        &self,
        workspace_id: &str,
        file: &RetainedWorkspaceTaskFile,
        config: ValidatedVscodeTasksConfig,
        tasks: &mut Vec<VscodeTaskDisplay>,
        diagnostics: &mut Vec<VscodeTaskDiscoveryDiagnostic>,
        truncated: &mut bool,
    ) {
        let mut diagnostic_task_labels = BTreeSet::new();
        for diagnostic in &config.diagnostics {
            push_diagnostic(
                diagnostics,
                VscodeTaskDiscoveryDiagnostic {
                    severity: VscodeTaskDiagnosticSeverity::Warning,
                    message: bounded_wire_message(&format!(
                        "{}: {}",
                        file.source, diagnostic.message
                    )),
                },
                truncated,
            );
            let Some(label) = diagnostic.label.clone() else {
                continue;
            };
            if !diagnostic_task_labels.insert(label.clone()) {
                continue;
            }
            push_task(
                tasks,
                VscodeTaskDisplay {
                    package: file.package_root_relative_path.clone(),
                    label,
                    depends_on: Vec::new(),
                    config_revision: config.revision.clone(),
                    detail: Some(bounded_wire_message(&diagnostic.message)),
                    group: VscodeTaskDisplayGroup::None,
                    problem_matcher: None,
                    source: file.source.clone(),
                    executable: false,
                },
                truncated,
            );
        }

        let resolved = config
            .tasks
            .iter()
            .cloned()
            .map(|task| {
                let group = display_group(task.group.as_ref());
                let resolved_matcher = resolve_problem_matcher(&task.problem_matcher);
                let problem_matcher = resolved_matcher.as_ref().ok().copied().flatten();
                let unsupported_matcher = resolved_matcher.err().map(|()| {
                    "Task has an unsupported problemMatcher; output will not create Problems."
                });
                let resolution = self.resolver.resolve(
                    workspace_id,
                    &file.package_root_relative_path,
                    &config.revision,
                    &task,
                );
                (
                    task,
                    group,
                    problem_matcher,
                    unsupported_matcher,
                    resolution,
                )
            })
            .collect::<Vec<_>>();
        let mut rejected_labels = resolved
            .iter()
            .filter(|(_, _, _, _, resolution)| {
                matches!(resolution, ProcessTaskPlanResolution::Rejected(_))
            })
            .map(|(task, _, _, _, _)| task.label.clone())
            .collect::<BTreeSet<_>>();
        propagate_rejected_dependencies(&config, &mut rejected_labels);

        for (task, group, problem_matcher, unsupported_matcher, resolution) in resolved {
            if let Some(message) = unsupported_matcher {
                push_diagnostic(
                    diagnostics,
                    VscodeTaskDiscoveryDiagnostic {
                        severity: VscodeTaskDiagnosticSeverity::Warning,
                        message: message.to_string(),
                    },
                    truncated,
                );
            }
            let execution_detail = if task.dependency_order
                == crate::vscode_process_tasks::TaskDependencyOrder::Parallel
            {
                Some(
                        "Parallel dependencies are accepted and executed sequentially in a safe topological order."
                            .to_string(),
                    )
            } else {
                unsupported_matcher.map(str::to_string)
            };
            match resolution {
                ProcessTaskPlanResolution::Executable if rejected_labels.contains(&task.label) => {
                    let message =
                        "A task dependency is not executable under the current policy.".to_string();
                    push_diagnostic(
                        diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Warning,
                            message: message.clone(),
                        },
                        truncated,
                    );
                    push_task(
                        tasks,
                        VscodeTaskDisplay {
                            package: file.package_root_relative_path.clone(),
                            label: task.label,
                            depends_on: task.depends_on,
                            config_revision: config.revision.clone(),
                            detail: Some(message),
                            group,
                            problem_matcher,
                            source: file.source.clone(),
                            executable: false,
                        },
                        truncated,
                    );
                }
                ProcessTaskPlanResolution::Executable => push_task(
                    tasks,
                    VscodeTaskDisplay {
                        package: file.package_root_relative_path.clone(),
                        label: task.label,
                        depends_on: task.depends_on,
                        config_revision: config.revision.clone(),
                        detail: execution_detail,
                        group,
                        problem_matcher,
                        source: file.source.clone(),
                        executable: true,
                    },
                    truncated,
                ),
                ProcessTaskPlanResolution::Rejected(rejection) => {
                    let (_, message) = plan_rejection_wire(rejection);
                    let message = message.to_string();
                    push_diagnostic(
                        diagnostics,
                        VscodeTaskDiscoveryDiagnostic {
                            severity: VscodeTaskDiagnosticSeverity::Warning,
                            message: message.clone(),
                        },
                        truncated,
                    );
                    push_task(
                        tasks,
                        VscodeTaskDisplay {
                            package: file.package_root_relative_path.clone(),
                            label: task.label,
                            depends_on: task.depends_on,
                            config_revision: config.revision.clone(),
                            detail: Some(message),
                            group,
                            problem_matcher,
                            source: file.source.clone(),
                            executable: false,
                        },
                        truncated,
                    );
                }
            }
        }
    }
}

fn push_task(tasks: &mut Vec<VscodeTaskDisplay>, task: VscodeTaskDisplay, truncated: &mut bool) {
    if tasks.len() >= MAX_DISCOVERED_TASKS {
        *truncated = true;
        return;
    }
    tasks.push(task);
}

fn push_diagnostic(
    diagnostics: &mut Vec<VscodeTaskDiscoveryDiagnostic>,
    diagnostic: VscodeTaskDiscoveryDiagnostic,
    truncated: &mut bool,
) {
    if diagnostics.len() >= MAX_DISCOVERY_DIAGNOSTICS {
        *truncated = true;
        return;
    }
    diagnostics.push(diagnostic);
}

fn aggregate_config_revision(revisions: &[(String, String)]) -> String {
    if revisions.is_empty() {
        return EMPTY_CONFIG_REVISION.to_string();
    }
    if revisions.len() == 1 {
        return revisions[0].1.clone();
    }
    let mut digest = Sha256::new();
    for (source, revision) in revisions {
        digest.update(source.len().to_be_bytes());
        digest.update(source.as_bytes());
        digest.update(revision.as_bytes());
    }
    format!("sha256:{:x}", digest.finalize())
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

fn resolve_problem_matcher(
    problem_matcher: &ProcessTaskProblemMatcher,
) -> Result<Option<VscodeTaskProblemMatcherKind>, ()> {
    match problem_matcher {
        ProcessTaskProblemMatcher::None => Ok(None),
        ProcessTaskProblemMatcher::Named(matcher) if matcher == "$tsc" => {
            Ok(Some(VscodeTaskProblemMatcherKind::TypeScript))
        }
        ProcessTaskProblemMatcher::Named(matcher) if matcher == "$eslint-stylish" => {
            Ok(Some(VscodeTaskProblemMatcherKind::Eslint))
        }
        ProcessTaskProblemMatcher::Named(_) | ProcessTaskProblemMatcher::Unsupported => Err(()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Reader {
        bytes: RefCell<Option<Vec<u8>>>,
    }

    impl RetainedWorkspaceFileReader for Reader {
        fn list_registered_workspace_task_files(
            &self,
            _workspace_id: &str,
            _maximum_manifests: usize,
        ) -> RetainedWorkspaceTaskFilesRead {
            RetainedWorkspaceTaskFilesRead::Files {
                files: vec![RetainedWorkspaceTaskFile {
                    package_root_relative_path: ".".to_string(),
                    source: ".vscode/tasks.json".to_string(),
                }],
                truncated: false,
            }
        }

        fn read_registered_workspace_file(
            &self,
            _workspace_id: &str,
            _relative_path: &str,
            _maximum_bytes: usize,
        ) -> RetainedWorkspaceFileRead {
            RetainedWorkspaceFileRead::Content(self.bytes.borrow_mut().take().expect("one read"))
        }
    }

    struct Resolver;

    impl VscodeProcessTaskPlanResolver for Resolver {
        fn resolve(
            &self,
            _workspace_id: &str,
            _package_root_relative_path: &str,
            _config_revision: &str,
            _task: &ValidatedProcessTask,
        ) -> ProcessTaskPlanResolution {
            ProcessTaskPlanResolution::Executable
        }
    }

    #[test]
    fn supported_problem_matchers_resolve_and_unsupported_forms_fail_closed_per_task() {
        let reader = Reader {
            bytes: RefCell::new(Some(
                br#"{
                  "version":"2.0.0",
                  "tasks":[
                    {"label":"tsc","type":"process","command":"tsc","problemMatcher":"$tsc"},
                    {"label":"eslint","type":"process","command":"eslint","problemMatcher":["$eslint-stylish"]},
                    {"label":"unknown","type":"process","command":"tool","problemMatcher":"$unknown"},
                    {"label":"many","type":"process","command":"tool","problemMatcher":["$tsc","$eslint-stylish"]},
                    {"label":"object","type":"process","command":"tool","problemMatcher":{"owner":"custom"}},
                    {"label":"empty","type":"process","command":"tool","problemMatcher":[]},
                    {"label":"mixed","type":"process","command":"tool","problemMatcher":[42]}
                  ]
                }"#
                .to_vec(),
            )),
        };

        let response = VscodeTasksDiscoveryService::new(&reader, &Resolver).discover(
            VscodeTasksDiscoveryRequest {
                workspace_id: "workspace-a".to_string(),
            },
        );

        assert_eq!(
            response.tasks[0].problem_matcher,
            Some(VscodeTaskProblemMatcherKind::TypeScript)
        );
        assert_eq!(
            response.tasks[1].problem_matcher,
            Some(VscodeTaskProblemMatcherKind::Eslint)
        );
        for task in [
            &response.tasks[2],
            &response.tasks[3],
            &response.tasks[4],
            &response.tasks[6],
        ] {
            assert_eq!(task.problem_matcher, None);
            assert!(task.executable);
            assert_eq!(
                task.detail.as_deref(),
                Some("Task has an unsupported problemMatcher; output will not create Problems.")
            );
        }
        assert_eq!(response.tasks[5].problem_matcher, None);
        assert!(response.tasks[5].executable);
        assert_eq!(response.tasks[5].detail, None);
        assert_eq!(response.diagnostics.len(), 4);
    }

    struct PackageReader {
        files: Vec<(RetainedWorkspaceTaskFile, Vec<u8>)>,
    }

    impl RetainedWorkspaceFileReader for PackageReader {
        fn list_registered_workspace_task_files(
            &self,
            _workspace_id: &str,
            _maximum_manifests: usize,
        ) -> RetainedWorkspaceTaskFilesRead {
            RetainedWorkspaceTaskFilesRead::Files {
                files: self.files.iter().map(|(file, _)| file.clone()).collect(),
                truncated: false,
            }
        }

        fn read_registered_workspace_file(
            &self,
            _workspace_id: &str,
            relative_path: &str,
            _maximum_bytes: usize,
        ) -> RetainedWorkspaceFileRead {
            self.files
                .iter()
                .find(|(file, _)| file.source == relative_path)
                .map(|(_, bytes)| RetainedWorkspaceFileRead::Content(bytes.clone()))
                .unwrap_or(RetainedWorkspaceFileRead::Missing)
        }
    }

    #[derive(Default)]
    struct PackageResolver {
        resolutions: RefCell<Vec<(String, String)>>,
    }

    impl VscodeProcessTaskPlanResolver for PackageResolver {
        fn resolve(
            &self,
            _workspace_id: &str,
            package_root_relative_path: &str,
            config_revision: &str,
            _task: &ValidatedProcessTask,
        ) -> ProcessTaskPlanResolution {
            self.resolutions.borrow_mut().push((
                package_root_relative_path.to_string(),
                config_revision.to_string(),
            ));
            ProcessTaskPlanResolution::Executable
        }
    }

    #[test]
    fn duplicate_labels_in_different_packages_keep_distinct_identity_and_cwd_owner() {
        let first_task =
            br#"{"version":"2.0.0","tasks":[{"label":"build","type":"process","command":"tool"}]}"#;
        let second_task =
            br#"{"version":"2.0.0","tasks":[{"label":"build","type":"process","command":"other"}]}"#;
        let reader = PackageReader {
            files: vec![
                (
                    RetainedWorkspaceTaskFile {
                        package_root_relative_path: "packages/a".to_string(),
                        source: "packages/a/.vscode/tasks.json".to_string(),
                    },
                    first_task.to_vec(),
                ),
                (
                    RetainedWorkspaceTaskFile {
                        package_root_relative_path: "packages/b".to_string(),
                        source: "packages/b/.vscode/tasks.json".to_string(),
                    },
                    second_task.to_vec(),
                ),
            ],
        };

        let resolver = PackageResolver::default();
        let response = VscodeTasksDiscoveryService::new(&reader, &resolver).discover(
            VscodeTasksDiscoveryRequest {
                workspace_id: "workspace-a".to_string(),
            },
        );

        assert_eq!(response.tasks.len(), 2);
        assert_eq!(response.tasks[0].label, "build");
        assert_eq!(response.tasks[1].label, "build");
        assert_eq!(response.tasks[0].source, "packages/a/.vscode/tasks.json");
        assert_eq!(response.tasks[1].source, "packages/b/.vscode/tasks.json");
        assert_eq!(
            response.tasks[0].config_revision,
            vscode_tasks_config_revision(first_task)
        );
        assert_eq!(
            response.tasks[1].config_revision,
            vscode_tasks_config_revision(second_task)
        );
        assert_ne!(response.config_revision, response.tasks[0].config_revision);
        assert_ne!(response.config_revision, response.tasks[1].config_revision);
        assert_eq!(
            *resolver.resolutions.borrow(),
            vec![
                (
                    "packages/a".to_string(),
                    response.tasks[0].config_revision.clone()
                ),
                (
                    "packages/b".to_string(),
                    response.tasks[1].config_revision.clone()
                )
            ]
        );
    }

    #[test]
    fn aggregate_task_and_diagnostic_limits_are_truthful() {
        let task_files = (0..33)
            .map(|file_index| {
                let tasks = (0..128)
                    .map(|task_index| {
                        format!(
                            r#"{{"label":"task-{file_index}-{task_index}","type":"process","command":"tool"}}"#
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                (
                    RetainedWorkspaceTaskFile {
                        package_root_relative_path: format!("packages/{file_index}"),
                        source: format!("packages/{file_index}/.vscode/tasks.json"),
                    },
                    format!(r#"{{"version":"2.0.0","tasks":[{tasks}]}}"#).into_bytes(),
                )
            })
            .collect();
        let reader = PackageReader { files: task_files };
        let response = VscodeTasksDiscoveryService::new(&reader, &PackageResolver::default())
            .discover(VscodeTasksDiscoveryRequest {
                workspace_id: "workspace-a".to_string(),
            });

        assert_eq!(response.tasks.len(), MAX_DISCOVERED_TASKS);
        assert!(response.truncated);

        let diagnostic_files = (0..9)
            .map(|file_index| {
                let tasks = (0..128)
                    .map(|task_index| {
                        format!(
                            r#"{{"label":"task-{file_index}-{task_index}","type":"shell","command":"tool"}}"#
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                (
                    RetainedWorkspaceTaskFile {
                        package_root_relative_path: format!("packages/{file_index}"),
                        source: format!("packages/{file_index}/.vscode/tasks.json"),
                    },
                    format!(r#"{{"version":"2.0.0","tasks":[{tasks}]}}"#).into_bytes(),
                )
            })
            .collect();
        let reader = PackageReader {
            files: diagnostic_files,
        };
        let response = VscodeTasksDiscoveryService::new(&reader, &PackageResolver::default())
            .discover(VscodeTasksDiscoveryRequest {
                workspace_id: "workspace-a".to_string(),
            });

        assert_eq!(response.diagnostics.len(), MAX_DISCOVERY_DIAGNOSTICS);
        assert!(response.truncated);
    }
}
