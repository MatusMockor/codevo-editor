use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

#[path = "vscode_tasks_jsonc.rs"]
mod jsonc;
#[path = "vscode_task_dependencies.rs"]
mod task_dependencies;
pub use task_dependencies::ValidatedTaskGraph;

pub const MAX_VSCODE_TASKS_CONFIG_BYTES: usize = 256 * 1024;
const MAX_TASKS: usize = 128;
const MAX_ARGS: usize = 128;
const MAX_ENV: usize = 128;
const MAX_TASK_DEPENDENCIES: usize = 32;
const MAX_TASK_DEPENDENCY_EDGES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedVscodeTasksConfig {
    pub revision: String,
    pub tasks: ValidatedTaskGraph,
    pub diagnostics: Vec<VscodeTaskDiagnostic>,
}

impl ValidatedVscodeTasksConfig {
    pub fn resolve_sequential_chain(
        &self,
        target_label: &str,
    ) -> Result<Vec<&ValidatedProcessTask>, VscodeTaskGraphError> {
        self.tasks
            .sequential_plan(target_label)
            .ok_or(VscodeTaskGraphError::TaskNotFound)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VscodeTaskGraphError {
    TaskNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProcessTask {
    pub label: String,
    pub depends_on: Vec<String>,
    pub dependency_order: TaskDependencyOrder,
    pub execution: ValidatedTaskExecution,
    pub options: ProcessTaskOptions,
    pub group: Option<ProcessTaskGroup>,
    pub problem_matcher: ProcessTaskProblemMatcher,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskDependencyOrder {
    Sequence,
    Parallel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidatedTaskExecution {
    Process { command: String, args: Vec<String> },
    Npm { script: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessTaskProblemMatcher {
    None,
    Named(String),
    Unsupported,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessTaskOptions {
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessTaskGroup {
    Name(String),
    Definition { kind: String, is_default: bool },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VscodeTaskDiagnostic {
    pub task_index: usize,
    pub label: Option<String>,
    pub code: VscodeTaskDiagnosticCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VscodeTaskDiagnosticCode {
    DependencyGraph,
    DuplicateLabel,
    InvalidTask,
    UnsupportedTask,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VscodeTasksConfigError {
    TooLarge { actual: usize, maximum: usize },
    InvalidJsonc(String),
    InvalidRoot(String),
}

pub struct VscodeTasksParser;

impl VscodeTasksParser {
    pub fn parse(bytes: &[u8]) -> Result<ValidatedVscodeTasksConfig, VscodeTasksConfigError> {
        if bytes.len() > MAX_VSCODE_TASKS_CONFIG_BYTES {
            return Err(VscodeTasksConfigError::TooLarge {
                actual: bytes.len(),
                maximum: MAX_VSCODE_TASKS_CONFIG_BYTES,
            });
        }
        let value =
            jsonc::parse_strict_jsonc(bytes).map_err(VscodeTasksConfigError::InvalidJsonc)?;
        let root = value.as_object().ok_or_else(|| {
            VscodeTasksConfigError::InvalidRoot("root must be an object".to_string())
        })?;
        require_exact_keys(root, &["tasks", "version"])
            .map_err(VscodeTasksConfigError::InvalidRoot)?;
        if root.get("version").and_then(Value::as_str) != Some("2.0.0") {
            return Err(VscodeTasksConfigError::InvalidRoot(
                "version must be exactly \"2.0.0\"".to_string(),
            ));
        }
        let tasks = root.get("tasks").and_then(Value::as_array).ok_or_else(|| {
            VscodeTasksConfigError::InvalidRoot("tasks must be an array".to_string())
        })?;
        if tasks.len() > MAX_TASKS {
            return Err(VscodeTasksConfigError::InvalidRoot(format!(
                "tasks exceeds the limit of {MAX_TASKS}"
            )));
        }

        let mut label_counts = BTreeMap::<String, usize>::new();
        for value in tasks {
            if let Some(label) = task_label_hint(value) {
                *label_counts.entry(label).or_default() += 1;
            }
        }
        let duplicates = label_counts
            .into_iter()
            .filter_map(|(label, count)| (count > 1).then_some(label))
            .collect::<BTreeSet<_>>();

        let mut accepted = Vec::new();
        let mut diagnostics = Vec::new();
        for (task_index, value) in tasks.iter().enumerate() {
            match parse_task(value) {
                Ok(task) => accepted.push((task_index, task)),
                Err((code, label, message)) => diagnostics.push(VscodeTaskDiagnostic {
                    task_index,
                    label,
                    code,
                    message,
                }),
            }
        }

        let mut unique = Vec::new();
        for (task_index, task) in accepted {
            if duplicates.contains(&task.label) {
                diagnostics.push(VscodeTaskDiagnostic {
                    task_index,
                    label: Some(task.label.clone()),
                    code: VscodeTaskDiagnosticCode::DuplicateLabel,
                    message: "duplicate labels are not executable".to_string(),
                });
            } else {
                unique.push((task_index, task));
            }
        }
        let edge_count = unique
            .iter()
            .map(|(_, task)| task.depends_on.len())
            .sum::<usize>();
        if edge_count > MAX_TASK_DEPENDENCY_EDGES {
            return Err(VscodeTasksConfigError::InvalidRoot(format!(
                "task dependency graph exceeds the limit of {MAX_TASK_DEPENDENCY_EDGES} edges"
            )));
        }
        let executable = task_dependencies::retain_executable_tasks(unique, &mut diagnostics);
        diagnostics.sort_by_key(|diagnostic| diagnostic.task_index);

        Ok(ValidatedVscodeTasksConfig {
            revision: vscode_tasks_config_revision(bytes),
            tasks: executable,
            diagnostics,
        })
    }
}

pub fn vscode_tasks_config_revision(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

type TaskError = (VscodeTaskDiagnosticCode, Option<String>, String);

fn parse_task(value: &Value) -> Result<ValidatedProcessTask, TaskError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid(None, "task must be an object"))?;
    let label_hint = task_label_hint(value);
    let allowed = [
        "args",
        "command",
        "detail",
        "dependsOn",
        "dependsOrder",
        "group",
        "isBackground",
        "label",
        "linux",
        "options",
        "osx",
        "presentation",
        "problemMatcher",
        "runOptions",
        "script",
        "type",
        "windows",
    ];
    if let Some(field) = first_unknown_key(object, &allowed) {
        return Err(unsupported(
            label_hint,
            format!("unsupported task field \"{field}\""),
        ));
    }
    let label = required_text(object, "label", 256, false, label_hint.clone())?;
    let task_type = required_text(object, "type", 32, false, Some(label.clone()))?;
    reject_execution_semantics(object, &label)?;
    parse_inert_metadata(object, &label)?;
    let execution = match task_type.as_str() {
        "process" => parse_process_execution(object, &label)?,
        "npm" => parse_npm_execution(object, &label)?,
        "shell" => {
            return Err(unsupported(
                Some(label),
                "shell tasks are forbidden by the no-shell execution policy",
            ));
        }
        _ => {
            return Err(unsupported(
                Some(label),
                format!("unsupported task type \"{task_type}\""),
            ));
        }
    };
    if task_type == "npm"
        && object
            .get("options")
            .and_then(Value::as_object)
            .is_some_and(|options| options.contains_key("env"))
    {
        return Err(unsupported(
            Some(label),
            "npm task environment overrides cannot map to the closed package-script execution path",
        ));
    }
    let (depends_on, dependency_order) = parse_dependencies(object, &label)?;
    let options = parse_options(object.get("options"), &label)?;
    let group = parse_group(object.get("group"), &label)?;
    let problem_matcher = parse_problem_matcher(object.get("problemMatcher"));
    if task_type == "npm" && problem_matcher != ProcessTaskProblemMatcher::None {
        return Err(unsupported(
            Some(label),
            "npm task problemMatcher is not supported because package-script output is not connected to problem matching",
        ));
    }
    Ok(ValidatedProcessTask {
        label,
        depends_on,
        dependency_order,
        execution,
        options,
        group,
        problem_matcher,
    })
}

fn parse_process_execution(
    object: &Map<String, Value>,
    label: &str,
) -> Result<ValidatedTaskExecution, TaskError> {
    if object.contains_key("script") {
        return Err(unsupported(
            Some(label.to_string()),
            "process tasks do not support the npm script field",
        ));
    }
    let command = required_text(object, "command", 4_096, false, Some(label.to_string()))?;
    let args = optional_string_array(object.get("args"), "args", MAX_ARGS, 4_096, label)?;
    Ok(ValidatedTaskExecution::Process { command, args })
}

fn parse_npm_execution(
    object: &Map<String, Value>,
    label: &str,
) -> Result<ValidatedTaskExecution, TaskError> {
    if object.contains_key("args") || object.contains_key("command") {
        return Err(unsupported(
            Some(label.to_string()),
            "npm task extra arguments cannot map to the closed package-script execution path",
        ));
    }
    let script = required_text(object, "script", 214, false, Some(label.to_string()))?;
    if script.chars().any(char::is_whitespace) {
        return Err(unsupported(
            Some(label.to_string()),
            "npm task extra arguments must not be embedded in script",
        ));
    }
    Ok(ValidatedTaskExecution::Npm { script })
}

fn reject_execution_semantics(object: &Map<String, Value>, label: &str) -> Result<(), TaskError> {
    if object.contains_key("isBackground") {
        return Err(unsupported(
            Some(label.to_string()),
            "background task execution is not supported",
        ));
    }
    if object.contains_key("windows") || object.contains_key("linux") || object.contains_key("osx")
    {
        return Err(unsupported(
            Some(label.to_string()),
            "platform-specific task execution overrides are not supported",
        ));
    }
    let Some(run_options) = object.get("runOptions") else {
        return Ok(());
    };
    let Some(run_options) = run_options.as_object() else {
        return Err(invalid(
            Some(label.to_string()),
            "runOptions must be an object",
        ));
    };
    if run_options.contains_key("runOn") {
        return Err(unsupported(
            Some(label.to_string()),
            "runOptions.runOn automatic execution is not supported",
        ));
    }
    if let Some(field) = first_unknown_key(run_options, &["instanceLimit", "reevaluateOnRerun"]) {
        return Err(unsupported(
            Some(label.to_string()),
            format!("unsupported runOptions field \"{field}\""),
        ));
    }
    if run_options
        .get("reevaluateOnRerun")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(invalid(
            Some(label.to_string()),
            "runOptions.reevaluateOnRerun must be a boolean",
        ));
    }
    if run_options.get("instanceLimit").is_some_and(|value| {
        value
            .as_u64()
            .is_none_or(|instance_limit| instance_limit == 0 || instance_limit > 1_024)
    }) {
        return Err(invalid(
            Some(label.to_string()),
            "runOptions.instanceLimit must be an integer from 1 through 1024",
        ));
    }
    Ok(())
}

fn parse_inert_metadata(object: &Map<String, Value>, label: &str) -> Result<(), TaskError> {
    if let Some(detail) = object.get("detail") {
        detail
            .as_str()
            .filter(|detail| bounded_text(detail, 4_096, true))
            .ok_or_else(|| {
                invalid(
                    Some(label.to_string()),
                    "detail must be a bounded safe string",
                )
            })?;
    }
    let Some(presentation) = object.get("presentation") else {
        return Ok(());
    };
    if !presentation.is_object() {
        return Err(invalid(
            Some(label.to_string()),
            "presentation must be an object",
        ));
    }
    Ok(())
}

fn parse_dependencies(
    object: &Map<String, Value>,
    label: &str,
) -> Result<(Vec<String>, TaskDependencyOrder), TaskError> {
    let Some(value) = object.get("dependsOn") else {
        if object.contains_key("dependsOrder") {
            return Err(unsupported(
                Some(label.to_string()),
                "dependsOrder requires dependsOn",
            ));
        }
        return Ok((Vec::new(), TaskDependencyOrder::Sequence));
    };
    let dependency_order = match object.get("dependsOrder") {
        None => TaskDependencyOrder::Sequence,
        Some(Value::String(order)) if order == "sequence" => TaskDependencyOrder::Sequence,
        Some(Value::String(order)) if order == "parallel" => TaskDependencyOrder::Parallel,
        Some(_) => {
            return Err(unsupported(
                Some(label.to_string()),
                "dependsOrder must be exactly \"sequence\" or \"parallel\"",
            ));
        }
    };
    let dependencies = if let Some(dependency) = value.as_str() {
        if !bounded_text(dependency, 256, false) {
            return Err(invalid(
                Some(label.to_string()),
                "dependsOn must contain bounded safe labels",
            ));
        }
        vec![dependency.to_string()]
    } else {
        if !object.contains_key("dependsOrder") {
            return Err(unsupported(
                Some(label.to_string()),
                "dependency arrays require dependsOrder \"sequence\" or \"parallel\"",
            ));
        }
        optional_string_array(Some(value), "dependsOn", MAX_TASK_DEPENDENCIES, 256, label)?
    };
    if dependencies.is_empty() {
        return Err(invalid(
            Some(label.to_string()),
            "dependsOn must not be empty",
        ));
    }
    Ok((dependencies, dependency_order))
}

fn task_label_hint(value: &Value) -> Option<String> {
    value
        .as_object()?
        .get("label")
        .and_then(Value::as_str)
        .filter(|label| bounded_text(label, 256, false))
        .map(str::to_string)
}

fn parse_options(value: Option<&Value>, label: &str) -> Result<ProcessTaskOptions, TaskError> {
    let Some(value) = value else {
        return Ok(ProcessTaskOptions::default());
    };
    let object = value
        .as_object()
        .ok_or_else(|| invalid(Some(label.to_string()), "options must be an object"))?;
    if let Some(field) = first_unknown_key(object, &["cwd", "env"]) {
        return Err(unsupported(
            Some(label.to_string()),
            format!("unsupported options field \"{field}\""),
        ));
    }
    let cwd = match object.get("cwd") {
        Some(value) => Some(
            value
                .as_str()
                .filter(|text| bounded_text(text, 4_096, false))
                .ok_or_else(|| {
                    invalid(Some(label.to_string()), "cwd must be a bounded safe string")
                })?
                .to_string(),
        ),
        None => None,
    };
    let mut env = BTreeMap::new();
    if let Some(value) = object.get("env") {
        let entries = value
            .as_object()
            .ok_or_else(|| invalid(Some(label.to_string()), "env must be an object"))?;
        if entries.len() > MAX_ENV {
            return Err(invalid(
                Some(label.to_string()),
                format!("env exceeds the limit of {MAX_ENV}"),
            ));
        }
        for (key, value) in entries {
            let value = value
                .as_str()
                .ok_or_else(|| invalid(Some(label.to_string()), "env values must be strings"))?;
            if !bounded_text(key, 256, false) || !bounded_text(value, 8_192, true) {
                return Err(invalid(
                    Some(label.to_string()),
                    "env contains an unsafe or oversized entry",
                ));
            }
            env.insert(key.clone(), value.to_string());
        }
    }
    Ok(ProcessTaskOptions { cwd, env })
}

fn parse_group(value: Option<&Value>, label: &str) -> Result<Option<ProcessTaskGroup>, TaskError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(name) = value.as_str() {
        if bounded_text(name, 64, false) {
            return Ok(Some(ProcessTaskGroup::Name(name.to_string())));
        }
        return Err(invalid(
            Some(label.to_string()),
            "group is not a safe string",
        ));
    }
    let object = value
        .as_object()
        .ok_or_else(|| invalid(Some(label.to_string()), "group must be a string or object"))?;
    if let Some(field) = first_unknown_key(object, &["isDefault", "kind"]) {
        return Err(unsupported(
            Some(label.to_string()),
            format!("unsupported group field \"{field}\""),
        ));
    }
    require_exact_keys(object, &["isDefault", "kind"])
        .map_err(|message| invalid(Some(label.to_string()), message))?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| bounded_text(kind, 64, false))
        .ok_or_else(|| invalid(Some(label.to_string()), "group.kind must be a safe string"))?;
    let is_default = object
        .get("isDefault")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid(Some(label.to_string()), "group.isDefault must be boolean"))?;
    Ok(Some(ProcessTaskGroup::Definition {
        kind: kind.to_string(),
        is_default,
    }))
}

fn parse_problem_matcher(value: Option<&Value>) -> ProcessTaskProblemMatcher {
    let Some(value) = value else {
        return ProcessTaskProblemMatcher::None;
    };
    if let Some(matcher) = value.as_str() {
        if bounded_text(matcher, 256, false) {
            return ProcessTaskProblemMatcher::Named(matcher.to_string());
        }
        return ProcessTaskProblemMatcher::Unsupported;
    }
    let Some(values) = value.as_array() else {
        return ProcessTaskProblemMatcher::Unsupported;
    };
    if values.is_empty() {
        return ProcessTaskProblemMatcher::None;
    }
    let [matcher] = values.as_slice() else {
        return ProcessTaskProblemMatcher::Unsupported;
    };
    matcher
        .as_str()
        .filter(|matcher| bounded_text(matcher, 256, false))
        .map(|matcher| ProcessTaskProblemMatcher::Named(matcher.to_string()))
        .unwrap_or(ProcessTaskProblemMatcher::Unsupported)
}

fn optional_string_array(
    value: Option<&Value>,
    field: &str,
    maximum: usize,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<String>, TaskError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let values = value
        .as_array()
        .ok_or_else(|| invalid(Some(label.to_string()), format!("{field} must be an array")))?;
    if values.len() > maximum {
        return Err(invalid(
            Some(label.to_string()),
            format!("{field} exceeds the limit of {maximum}"),
        ));
    }
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|text| bounded_text(text, max_bytes, true))
                .map(str::to_string)
                .ok_or_else(|| {
                    invalid(
                        Some(label.to_string()),
                        format!("{field} entries must be bounded safe strings"),
                    )
                })
        })
        .collect()
}

fn required_text(
    object: &Map<String, Value>,
    field: &str,
    max_bytes: usize,
    allow_empty: bool,
    label: Option<String>,
) -> Result<String, TaskError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| bounded_text(text, max_bytes, allow_empty))
        .map(str::to_string)
        .ok_or_else(|| invalid(label, format!("{field} must be a bounded safe string")))
}

fn bounded_text(value: &str, max_bytes: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.len() <= max_bytes
        && !value.chars().any(char::is_control)
}

fn require_exact_keys(object: &Map<String, Value>, expected: &[&str]) -> Result<(), String> {
    if let Some(key) = first_unknown_key(object, expected) {
        return Err(format!("unsupported field \"{key}\""));
    }
    if let Some(key) = expected.iter().find(|key| !object.contains_key(**key)) {
        return Err(format!("missing required field \"{key}\""));
    }
    Ok(())
}

fn first_unknown_key<'a>(object: &'a Map<String, Value>, allowed: &[&str]) -> Option<&'a str> {
    object
        .keys()
        .find(|key| !allowed.contains(&key.as_str()))
        .map(String::as_str)
}

fn invalid(label: Option<String>, message: impl Into<String>) -> TaskError {
    (VscodeTaskDiagnosticCode::InvalidTask, label, message.into())
}

fn unsupported(label: Option<String>, message: impl Into<String>) -> TaskError {
    (
        VscodeTaskDiagnosticCode::UnsupportedTask,
        label,
        message.into(),
    )
}
