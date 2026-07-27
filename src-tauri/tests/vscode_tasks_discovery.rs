#[path = "../src/vscode_process_tasks.rs"]
mod vscode_process_tasks;
#[path = "../src/vscode_tasks_discovery.rs"]
mod vscode_tasks_discovery;

use std::{cell::RefCell, collections::BTreeSet};

use vscode_process_tasks::{
    vscode_tasks_config_revision, ValidatedProcessTask, ValidatedTaskExecution,
    MAX_VSCODE_TASKS_CONFIG_BYTES,
};
use vscode_tasks_discovery::{
    ProcessTaskPlanRejectionCode, ProcessTaskPlanResolution, RetainedWorkspaceFileRead,
    RetainedWorkspaceFileReader, RetainedWorkspaceTaskFile, RetainedWorkspaceTaskFilesRead,
    VscodeProcessTaskPlanResolver, VscodeTaskDiagnosticSeverity, VscodeTaskDisplayGroup,
    VscodeTasksDiscoveryRequest, VscodeTasksDiscoveryService,
};

struct Reader {
    result: RefCell<Option<RetainedWorkspaceFileRead>>,
    calls: RefCell<Vec<(String, String, usize)>>,
}

impl Reader {
    fn returning(result: RetainedWorkspaceFileRead) -> Self {
        Self {
            result: RefCell::new(Some(result)),
            calls: RefCell::new(Vec::new()),
        }
    }
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
        workspace_id: &str,
        relative_path: &str,
        maximum_bytes: usize,
    ) -> RetainedWorkspaceFileRead {
        self.calls.borrow_mut().push((
            workspace_id.to_string(),
            relative_path.to_string(),
            maximum_bytes,
        ));
        self.result.borrow_mut().take().expect("one read")
    }
}

struct Resolver {
    reject_label: Option<&'static str>,
    seen: RefCell<Vec<(String, String, String, String)>>,
}

impl Resolver {
    fn accepting() -> Self {
        Self {
            reject_label: None,
            seen: RefCell::new(Vec::new()),
        }
    }
}

impl VscodeProcessTaskPlanResolver for Resolver {
    fn resolve(
        &self,
        workspace_id: &str,
        _package_root_relative_path: &str,
        config_revision: &str,
        task: &ValidatedProcessTask,
    ) -> ProcessTaskPlanResolution {
        self.seen.borrow_mut().push((
            workspace_id.to_string(),
            config_revision.to_string(),
            task.label.clone(),
            match &task.execution {
                ValidatedTaskExecution::Process { command, .. } => command.clone(),
                ValidatedTaskExecution::Npm { script } => script.clone(),
            },
        ));
        if self.reject_label == Some(task.label.as_str()) {
            ProcessTaskPlanResolution::Rejected(ProcessTaskPlanRejectionCode::PolicyRejected)
        } else {
            ProcessTaskPlanResolution::Executable
        }
    }
}

#[test]
fn missing_untrusted_and_unregistered_semantics_are_explicit() {
    for (read, expected_message, expected_truncated) in [
        (
            RetainedWorkspaceFileRead::Missing,
            ".vscode/tasks.json disappeared after task discovery enumerated it.",
            true,
        ),
        (
            RetainedWorkspaceFileRead::Untrusted,
            "Trust the workspace before discovering process tasks.",
            false,
        ),
        (
            RetainedWorkspaceFileRead::Unregistered,
            "The workspace is not registered.",
            false,
        ),
    ] {
        let reader = Reader::returning(read);
        let resolver = Resolver::accepting();
        let response = discover(&reader, &resolver);
        assert_eq!(
            response.config_revision,
            format!("sha256:{}", "0".repeat(64))
        );
        assert!(response.tasks.is_empty());
        assert_eq!(response.diagnostics[0].message, expected_message);
        assert_eq!(response.truncated, expected_truncated);
        assert!(resolver.seen.borrow().is_empty());
    }

    let too_large_reader = Reader::returning(RetainedWorkspaceFileRead::TooLarge);
    let resolver = Resolver::accepting();
    let response = discover(&too_large_reader, &resolver);
    assert_eq!(
        response.diagnostics[0].severity,
        VscodeTaskDiagnosticSeverity::Error
    );
    assert!(response.truncated);

    let unavailable_reader = Reader::returning(RetainedWorkspaceFileRead::Unavailable(
        "reader failed".to_string(),
    ));
    let response = discover(&unavailable_reader, &resolver);
    assert_eq!(response.diagnostics[0].message, "reader failed");
}

#[test]
fn reads_only_the_registered_tasks_path_with_the_exact_cap() {
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(valid_config("one")));
    let resolver = Resolver::accepting();
    let response = discover(&reader, &resolver);
    assert_eq!(response.tasks.len(), 1);
    assert_eq!(
        reader.calls.borrow().as_slice(),
        &[(
            "workspace-a".to_string(),
            ".vscode/tasks.json".to_string(),
            MAX_VSCODE_TASKS_CONFIG_BYTES
        )]
    );

    let oversized = vec![b' '; MAX_VSCODE_TASKS_CONFIG_BYTES + 1];
    let oversized_revision = vscode_tasks_config_revision(&oversized);
    let oversized_reader = Reader::returning(RetainedWorkspaceFileRead::Content(oversized));
    let response = discover(&oversized_reader, &resolver);
    assert!(response.truncated);
    assert!(response.tasks.is_empty());
    assert_eq!(response.config_revision, oversized_revision);
    assert_eq!(
        response.diagnostics[0].severity,
        VscodeTaskDiagnosticSeverity::Error
    );
}

#[test]
fn config_revision_tracks_the_authoritative_exact_bytes_passed_to_the_resolver() {
    let first = valid_config("one");
    let second = [first.as_slice(), b" "].concat();
    let first_reader = Reader::returning(RetainedWorkspaceFileRead::Content(first.clone()));
    let second_reader = Reader::returning(RetainedWorkspaceFileRead::Content(second.clone()));
    let first_resolver = Resolver::accepting();
    let second_resolver = Resolver::accepting();

    let first_response = discover(&first_reader, &first_resolver);
    let second_response = discover(&second_reader, &second_resolver);

    assert_eq!(
        first_response.config_revision,
        vscode_tasks_config_revision(&first)
    );
    assert_eq!(
        second_response.config_revision,
        vscode_tasks_config_revision(&second)
    );
    assert_ne!(
        first_response.config_revision,
        second_response.config_revision
    );
    assert_eq!(
        first_resolver.seen.borrow()[0].1,
        first_response.config_revision
    );
}

#[test]
fn display_wire_never_contains_process_command_args_cwd_or_environment() {
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[{
        "label":"private",
        "type":"process",
        "command":"SECRET_COMMAND",
        "args":["SECRET_ARG"],
        "options":{"cwd":"SECRET_CWD","env":{"TOKEN":"SECRET_ENV"}},
        "group":"test"
      }]
    }"#
    .to_vec();
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(bytes));
    let resolver = Resolver::accepting();
    let response = discover(&reader, &resolver);
    let wire = serde_json::to_string(&response).expect("wire JSON");

    assert_eq!(response.tasks[0].label, "private");
    assert_eq!(
        response.tasks[0].config_revision,
        resolver.seen.borrow()[0].1
    );
    assert_eq!(response.tasks[0].group, VscodeTaskDisplayGroup::Test);
    assert!(response.tasks[0].executable);
    for secret in ["SECRET_COMMAND", "SECRET_ARG", "SECRET_CWD", "SECRET_ENV"] {
        assert!(!wire.contains(secret), "{secret}");
    }
    assert_eq!(response.tasks[0].source, ".vscode/tasks.json");
}

#[test]
fn display_wire_exposes_only_bounded_dependency_labels() {
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"prepare","type":"process","command":"SECRET_DEPENDENCY_COMMAND"},
        {
          "label":"build",
          "type":"process",
          "command":"SECRET_ROOT_COMMAND",
          "dependsOn":"prepare",
          "dependsOrder":"sequence"
        }
      ]
    }"#
    .to_vec();
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(bytes));
    let resolver = Resolver::accepting();
    let response = discover(&reader, &resolver);
    let wire = serde_json::to_string(&response).expect("wire JSON");

    assert_eq!(response.tasks[0].depends_on, Vec::<String>::new());
    assert_eq!(response.tasks[1].depends_on, ["prepare"]);
    assert!(wire.contains(r#""dependsOn":["prepare"]"#));
    assert!(!wire.contains("SECRET_DEPENDENCY_COMMAND"));
    assert!(!wire.contains("SECRET_ROOT_COMMAND"));
}

#[test]
fn duplicate_and_unsupported_tasks_remain_non_executable_diagnostics() {
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"same","type":"process","command":"one"},
        {"label":"same","type":"process","command":"two"},
        {"label":"shell","type":"shell","command":"three"}
      ]
    }"#
    .to_vec();
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(bytes));
    let resolver = Resolver::accepting();
    let response = discover(&reader, &resolver);

    assert_eq!(response.tasks.len(), 2);
    assert!(response.tasks.iter().all(|task| !task.executable));
    assert_eq!(response.diagnostics.len(), 3);
    assert_eq!(
        response
            .tasks
            .iter()
            .map(|task| task.label.as_str())
            .collect::<Vec<_>>(),
        ["same", "shell"]
    );
    assert!(resolver.seen.borrow().is_empty());
}

#[test]
fn duplicate_diagnostic_rows_keep_unique_wire_labels_and_safe_siblings() {
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"same","type":"process","command":"one"},
        {"label":"safe","type":"process","command":"node"},
        {"label":"same","type":"shell","command":"two"}
      ]
    }"#
    .to_vec();
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(bytes));
    let resolver = Resolver::accepting();
    let response = discover(&reader, &resolver);

    assert_eq!(response.diagnostics.len(), 2);
    assert_eq!(
        response
            .tasks
            .iter()
            .map(|task| (task.label.as_str(), task.executable))
            .collect::<Vec<_>>(),
        [("same", false), ("safe", true)]
    );
    assert_eq!(
        response
            .tasks
            .iter()
            .map(|task| task.label.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        response.tasks.len()
    );
    assert_eq!(
        resolver
            .seen
            .borrow()
            .iter()
            .map(|(_, _, label, _)| label.as_str())
            .collect::<Vec<_>>(),
        ["safe"]
    );
}

#[test]
fn resolver_rejection_is_bounded_and_never_marks_the_task_executable() {
    let _all_rejection_codes = [
        ProcessTaskPlanRejectionCode::InvalidArguments,
        ProcessTaskPlanRejectionCode::InvalidCommand,
        ProcessTaskPlanRejectionCode::InvalidEnvironment,
        ProcessTaskPlanRejectionCode::InvalidWorkingDirectory,
        ProcessTaskPlanRejectionCode::PolicyRejected,
        ProcessTaskPlanRejectionCode::UnsupportedVariable,
    ];
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(valid_config("reject")));
    let resolver = Resolver {
        reject_label: Some("reject"),
        seen: RefCell::new(Vec::new()),
    };
    let response = discover(&reader, &resolver);

    assert_eq!(response.tasks.len(), 1);
    assert!(!response.tasks[0].executable);
    assert_eq!(
        response.diagnostics[0].severity,
        VscodeTaskDiagnosticSeverity::Warning
    );
    assert_eq!(
        response.tasks[0].detail.as_deref(),
        Some("Task is not executable under the current process-task policy.")
    );
}

#[test]
fn resolver_rejection_propagates_through_dependency_displays() {
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"dependency","type":"process","command":"node"},
        {"label":"target","type":"process","command":"node","dependsOn":"dependency"}
      ]
    }"#
    .to_vec();
    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(bytes));
    let resolver = Resolver {
        reject_label: Some("dependency"),
        seen: RefCell::new(Vec::new()),
    };
    let response = discover(&reader, &resolver);

    assert_eq!(response.tasks.len(), 2);
    assert!(response.tasks.iter().all(|task| !task.executable));
    assert_eq!(
        response.tasks[1].detail.as_deref(),
        Some("A task dependency is not executable under the current policy.")
    );
    assert_eq!(response.diagnostics.len(), 2);
    assert_eq!(resolver.seen.borrow().len(), 2);
}

#[test]
fn request_and_response_use_an_exact_camel_case_serde_contract() {
    let request: VscodeTasksDiscoveryRequest =
        serde_json::from_str(r#"{"workspaceId":"workspace-a"}"#).expect("request");
    assert_eq!(request.workspace_id, "workspace-a");
    assert!(serde_json::from_str::<VscodeTasksDiscoveryRequest>(
        r#"{"workspaceId":"workspace-a","rootPath":"/attacker"}"#
    )
    .is_err());

    let reader = Reader::returning(RetainedWorkspaceFileRead::Content(valid_config("one")));
    let resolver = Resolver::accepting();
    let wire = serde_json::to_value(discover(&reader, &resolver)).expect("response");
    let root = wire.as_object().expect("response object");
    assert_eq!(
        root.keys().map(String::as_str).collect::<Vec<_>>(),
        ["configRevision", "diagnostics", "tasks", "truncated"]
    );
    assert_eq!(
        root["tasks"][0]
            .as_object()
            .expect("task")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        [
            "configRevision",
            "dependsOn",
            "detail",
            "executable",
            "group",
            "label",
            "package",
            "problemMatcher",
            "source"
        ]
    );
    assert_eq!(
        root["diagnostics"],
        serde_json::json!([]),
        "diagnostics remain an exact array"
    );

    let missing_reader = Reader::returning(RetainedWorkspaceFileRead::Missing);
    let missing = serde_json::to_value(discover(&missing_reader, &resolver)).expect("missing wire");
    assert_eq!(
        missing["diagnostics"][0]
            .as_object()
            .expect("diagnostic")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["message", "severity"]
    );
}

struct MultiReader {
    files: Vec<(RetainedWorkspaceTaskFile, Vec<u8>)>,
}

impl RetainedWorkspaceFileReader for MultiReader {
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
        let Some((_, bytes)) = self
            .files
            .iter()
            .find(|(file, _)| file.source == relative_path)
        else {
            return RetainedWorkspaceFileRead::Missing;
        };
        RetainedWorkspaceFileRead::Content(bytes.clone())
    }
}

#[derive(Default)]
struct MultiResolver {
    seen: RefCell<Vec<(String, String)>>,
}

impl VscodeProcessTaskPlanResolver for MultiResolver {
    fn resolve(
        &self,
        _workspace_id: &str,
        package_root_relative_path: &str,
        config_revision: &str,
        _task: &ValidatedProcessTask,
    ) -> ProcessTaskPlanResolution {
        self.seen.borrow_mut().push((
            package_root_relative_path.to_string(),
            config_revision.to_string(),
        ));
        ProcessTaskPlanResolution::Executable
    }
}

#[test]
fn multi_file_displays_retain_the_owning_revision_used_for_execution_resolution() {
    let first = valid_config("Build");
    let second = [
        br#"{"version":"2.0.0","tasks":[{"label":"Build","type":"process","command":"other"}]}"#
            .as_slice(),
        b" ",
    ]
    .concat();
    let reader = MultiReader {
        files: vec![
            (
                RetainedWorkspaceTaskFile {
                    package_root_relative_path: ".".to_string(),
                    source: ".vscode/tasks.json".to_string(),
                },
                first.clone(),
            ),
            (
                RetainedWorkspaceTaskFile {
                    package_root_relative_path: "packages/api".to_string(),
                    source: "packages/api/.vscode/tasks.json".to_string(),
                },
                second.clone(),
            ),
        ],
    };
    let resolver = MultiResolver::default();
    let response = VscodeTasksDiscoveryService::new(&reader, &resolver).discover(
        VscodeTasksDiscoveryRequest {
            workspace_id: "workspace-a".to_string(),
        },
    );

    assert_eq!(response.tasks.len(), 2);
    assert_eq!(
        response.tasks[0].config_revision,
        vscode_tasks_config_revision(&first)
    );
    assert_eq!(
        response.tasks[1].config_revision,
        vscode_tasks_config_revision(&second)
    );
    assert_ne!(response.config_revision, response.tasks[0].config_revision);
    assert_ne!(response.config_revision, response.tasks[1].config_revision);
    assert_eq!(
        *resolver.seen.borrow(),
        vec![
            (".".to_string(), response.tasks[0].config_revision.clone()),
            (
                "packages/api".to_string(),
                response.tasks[1].config_revision.clone()
            )
        ]
    );
}

fn discover(
    reader: &Reader,
    resolver: &Resolver,
) -> vscode_tasks_discovery::VscodeTasksDiscoveryResponse {
    VscodeTasksDiscoveryService::new(reader, resolver).discover(VscodeTasksDiscoveryRequest {
        workspace_id: "workspace-a".to_string(),
    })
}

fn valid_config(label: &str) -> Vec<u8> {
    format!(
        r#"{{"version":"2.0.0","tasks":[{{"label":"{label}","type":"process","command":"node"}}]}}"#
    )
    .into_bytes()
}
