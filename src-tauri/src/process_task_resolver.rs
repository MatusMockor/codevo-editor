use crate::process_task_plan::{
    ProcessTaskDefinition, ProcessTaskEnvironmentPolicy, ProcessTaskExecutionPlan,
    ProcessTaskProgramKind, PROCESS_TASK_MAX_ARGS, PROCESS_TASK_MAX_ENV,
    WORKSPACE_FOLDER_PLACEHOLDER,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Component, Path, PathBuf};

const MAX_ARGUMENT_BYTES: usize = 16 * 1_024;
const MAX_ARGUMENT_TOTAL_BYTES: usize = 256 * 1_024;
const MAX_COMMAND_BYTES: usize = 4 * 1_024;
const MAX_CWD_BYTES: usize = 16 * 1_024;
const MAX_ENV_KEY_BYTES: usize = 128;
const MAX_ENV_TOTAL_BYTES: usize = 256 * 1_024;
const MAX_ENV_VALUE_BYTES: usize = 16 * 1_024;

pub trait RetainedProcessTaskRootResolver {
    fn canonical_root(&self) -> Result<PathBuf, ProcessTaskPlanError>;
    fn canonical_directory(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError>;
    fn canonical_executable(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError>;
    fn backend_node_executable(&self) -> Result<PathBuf, ProcessTaskPlanError>;
    fn is_within_retained_root(&self, canonical_path: &Path) -> bool;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProcessTaskPlanError {
    BoundsExceeded(&'static str),
    BlockedEnvironment(String),
    DisallowedEnvironment(String),
    InvalidEnvironment(String),
    InvalidPath(&'static str),
    ShellInterpreter(String),
    UnsupportedCommand(String),
    UnsupportedSubstitution(String),
    WorkspaceEscape(&'static str),
}

impl fmt::Display for ProcessTaskPlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ProcessTaskPlanError {}

pub fn resolve_process_task_plan(
    definition: &ProcessTaskDefinition,
    environment_policy: &ProcessTaskEnvironmentPolicy,
    resolver: &dyn RetainedProcessTaskRootResolver,
) -> Result<ProcessTaskExecutionPlan, ProcessTaskPlanError> {
    validate_text(&definition.command, MAX_COMMAND_BYTES, "command")?;
    if definition.args.len() > PROCESS_TASK_MAX_ARGS {
        return Err(ProcessTaskPlanError::BoundsExceeded("arguments"));
    }
    let root = resolver.canonical_root()?;
    if !root.is_absolute() {
        return Err(ProcessTaskPlanError::InvalidPath("workspace root"));
    }
    let root_text = root.to_string_lossy();
    let (command, command_uses_workspace) = substitute_workspace_folder(
        &definition.command,
        &root_text,
        MAX_COMMAND_BYTES,
        "command",
    )?;
    let (program, program_kind) =
        resolve_program(&command, command_uses_workspace, &root, resolver)?;
    let cwd = resolve_cwd(definition.cwd.as_deref(), &root, &root_text, resolver)?;
    let args = resolve_arguments(&definition.args, &root_text)?;
    let env = resolve_environment(&definition.env, environment_policy, &root_text)?;
    Ok(ProcessTaskExecutionPlan::new(
        program,
        program_kind,
        args,
        cwd,
        env,
    ))
}

fn resolve_program(
    command: &str,
    command_uses_workspace: bool,
    root: &Path,
    resolver: &dyn RetainedProcessTaskRootResolver,
) -> Result<(PathBuf, ProcessTaskProgramKind), ProcessTaskPlanError> {
    let command_path = Path::new(command);
    let command_name = command.rsplit(['/', '\\']).next().unwrap_or(command);
    if is_shell_interpreter(command_name) {
        return Err(ProcessTaskPlanError::ShellInterpreter(command.to_string()));
    }
    if command == "node" {
        let executable = resolver.backend_node_executable()?;
        if !executable.is_absolute() {
            return Err(ProcessTaskPlanError::InvalidPath("backend Node"));
        }
        return Ok((executable, ProcessTaskProgramKind::BackendNode));
    }
    if command_path.is_absolute() || is_windows_absolute(command) {
        if command_uses_workspace {
            let executable = resolver.canonical_executable(command_path)?;
            ensure_inside_root(&executable, resolver, "command")?;
            return Ok((executable, ProcessTaskProgramKind::WorkspaceExecutable));
        }
        return Err(ProcessTaskPlanError::UnsupportedCommand(
            command.to_string(),
        ));
    }
    if command.contains('/') || command.contains('\\') {
        let relative = safe_relative_path(command, "command")?;
        let executable = resolver.canonical_executable(&root.join(relative))?;
        ensure_inside_root(&executable, resolver, "command")?;
        return Ok((executable, ProcessTaskProgramKind::WorkspaceExecutable));
    }
    if !safe_bare_tool(command) {
        return Err(ProcessTaskPlanError::UnsupportedCommand(
            command.to_string(),
        ));
    }
    let executable =
        resolver.canonical_executable(&root.join("node_modules").join(".bin").join(command))?;
    ensure_inside_root(&executable, resolver, "workspace tool")?;
    Ok((executable, ProcessTaskProgramKind::WorkspaceTool))
}

fn resolve_cwd(
    cwd: Option<&str>,
    root: &Path,
    root_text: &str,
    resolver: &dyn RetainedProcessTaskRootResolver,
) -> Result<PathBuf, ProcessTaskPlanError> {
    let candidate = match cwd {
        None => root.to_path_buf(),
        Some(value) => {
            validate_text(value, MAX_CWD_BYTES, "working directory")?;
            if value.trim().is_empty() {
                return Err(ProcessTaskPlanError::InvalidPath("working directory"));
            }
            let (expanded, uses_workspace) =
                substitute_workspace_folder(value, root_text, MAX_CWD_BYTES, "working directory")?;
            if Path::new(&expanded).is_absolute() || is_windows_absolute(&expanded) {
                if !uses_workspace {
                    return Err(ProcessTaskPlanError::InvalidPath("working directory"));
                }
                PathBuf::from(expanded)
            } else {
                root.join(safe_relative_path(&expanded, "working directory")?)
            }
        }
    };
    let directory = resolver.canonical_directory(&candidate)?;
    ensure_inside_root(&directory, resolver, "working directory")?;
    Ok(directory)
}

fn resolve_arguments(
    arguments: &[String],
    root: &str,
) -> Result<Vec<String>, ProcessTaskPlanError> {
    let mut total = 0usize;
    arguments
        .iter()
        .map(|argument| {
            validate_text(argument, MAX_ARGUMENT_BYTES, "argument")?;
            let (expanded, _) =
                substitute_workspace_folder(argument, root, MAX_ARGUMENT_BYTES, "argument")?;
            total = total
                .checked_add(expanded.len())
                .ok_or(ProcessTaskPlanError::BoundsExceeded("arguments"))?;
            if total > MAX_ARGUMENT_TOTAL_BYTES {
                return Err(ProcessTaskPlanError::BoundsExceeded("arguments"));
            }
            Ok(expanded)
        })
        .collect()
}

fn resolve_environment(
    explicit: &BTreeMap<String, String>,
    policy: &ProcessTaskEnvironmentPolicy,
    root: &str,
) -> Result<BTreeMap<String, String>, ProcessTaskPlanError> {
    if explicit.len() > PROCESS_TASK_MAX_ENV
        || policy.inherited_baseline.len() > PROCESS_TASK_MAX_ENV
    {
        return Err(ProcessTaskPlanError::BoundsExceeded("environment"));
    }
    let allowlist: BTreeSet<String> = policy
        .allowed_explicit_keys
        .iter()
        .map(|key| key.to_ascii_uppercase())
        .collect();
    let mut result = BTreeMap::new();
    let mut normalized_keys = BTreeSet::new();
    let mut total = 0usize;
    for (key, value) in &policy.inherited_baseline {
        let normalized = validate_baseline_environment_key(key)?;
        insert_environment(
            &mut result,
            &mut normalized_keys,
            &mut total,
            key,
            value,
            root,
            normalized,
        )?;
    }
    for (key, value) in explicit {
        let normalized = validate_explicit_environment_key(key)?;
        if !allowlist.contains(&normalized) {
            return Err(ProcessTaskPlanError::DisallowedEnvironment(key.clone()));
        }
        if normalized_keys.contains(&normalized) {
            return Err(ProcessTaskPlanError::InvalidEnvironment(key.clone()));
        }
        insert_environment(
            &mut result,
            &mut normalized_keys,
            &mut total,
            key,
            value,
            root,
            normalized,
        )?;
    }
    Ok(result)
}

fn insert_environment(
    result: &mut BTreeMap<String, String>,
    normalized_keys: &mut BTreeSet<String>,
    total: &mut usize,
    key: &str,
    value: &str,
    root: &str,
    normalized: String,
) -> Result<(), ProcessTaskPlanError> {
    if !normalized_keys.insert(normalized) {
        return Err(ProcessTaskPlanError::InvalidEnvironment(key.to_string()));
    }
    validate_text(value, MAX_ENV_VALUE_BYTES, "environment value")?;
    let (value, _) =
        substitute_workspace_folder(value, root, MAX_ENV_VALUE_BYTES, "environment value")?;
    *total = total
        .checked_add(key.len() + value.len())
        .ok_or(ProcessTaskPlanError::BoundsExceeded("environment"))?;
    if *total > MAX_ENV_TOTAL_BYTES {
        return Err(ProcessTaskPlanError::BoundsExceeded("environment"));
    }
    result.insert(key.to_string(), value);
    Ok(())
}

fn validate_explicit_environment_key(key: &str) -> Result<String, ProcessTaskPlanError> {
    let normalized = validate_environment_key_shape(key)?;
    if blocked_environment_key(&normalized) {
        return Err(ProcessTaskPlanError::BlockedEnvironment(key.to_string()));
    }
    Ok(normalized)
}

fn validate_baseline_environment_key(key: &str) -> Result<String, ProcessTaskPlanError> {
    let normalized = validate_environment_key_shape(key)?;
    if !matches!(
        normalized.as_str(),
        "HOME" | "PATH" | "TMPDIR" | "SYSTEMROOT"
    ) {
        return Err(ProcessTaskPlanError::BlockedEnvironment(key.to_string()));
    }
    Ok(normalized)
}

fn validate_environment_key_shape(key: &str) -> Result<String, ProcessTaskPlanError> {
    if key.is_empty() || key.len() > MAX_ENV_KEY_BYTES {
        return Err(ProcessTaskPlanError::InvalidEnvironment(key.to_string()));
    }
    let mut bytes = key.bytes();
    if !bytes
        .next()
        .is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
        || !bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
    {
        return Err(ProcessTaskPlanError::InvalidEnvironment(key.to_string()));
    }
    Ok(key.to_ascii_uppercase())
}

fn blocked_environment_key(normalized: &str) -> bool {
    matches!(
        normalized,
        "PATH" | "NODE_OPTIONS" | "SHELL" | "COMSPEC" | "PATHEXT"
    ) || normalized.starts_with("LD_")
        || normalized.starts_with("DYLD_")
        || normalized.starts_with("NPM_CONFIG_")
}

fn substitute_workspace_folder(
    value: &str,
    root: &str,
    maximum_bytes: usize,
    label: &'static str,
) -> Result<(String, bool), ProcessTaskPlanError> {
    let mut remaining = value;
    let mut expanded = String::new();
    let mut used_workspace_folder = false;
    while let Some(index) = remaining.find("${") {
        push_bounded(&mut expanded, &remaining[..index], maximum_bytes, label)?;
        let substitution = &remaining[index..];
        if !substitution.starts_with(WORKSPACE_FOLDER_PLACEHOLDER) {
            return Err(ProcessTaskPlanError::UnsupportedSubstitution(
                value.to_string(),
            ));
        }
        push_bounded(&mut expanded, root, maximum_bytes, label)?;
        used_workspace_folder = true;
        remaining = &substitution[WORKSPACE_FOLDER_PLACEHOLDER.len()..];
    }
    push_bounded(&mut expanded, remaining, maximum_bytes, label)?;
    Ok((expanded, used_workspace_folder))
}

fn push_bounded(
    destination: &mut String,
    value: &str,
    maximum_bytes: usize,
    label: &'static str,
) -> Result<(), ProcessTaskPlanError> {
    if destination
        .len()
        .checked_add(value.len())
        .is_none_or(|length| length > maximum_bytes)
    {
        return Err(ProcessTaskPlanError::BoundsExceeded(label));
    }
    destination.push_str(value);
    Ok(())
}

fn validate_text(
    value: &str,
    maximum_bytes: usize,
    label: &'static str,
) -> Result<(), ProcessTaskPlanError> {
    if value.len() > maximum_bytes || value.contains('\0') {
        return Err(ProcessTaskPlanError::BoundsExceeded(label));
    }
    Ok(())
}

fn safe_relative_path<'a>(
    value: &'a str,
    label: &'static str,
) -> Result<&'a Path, ProcessTaskPlanError> {
    let path = Path::new(value);
    if path.is_absolute()
        || is_windows_absolute(value)
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(ProcessTaskPlanError::InvalidPath(label));
    }
    Ok(path)
}

fn is_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with("\\\\")
        || value.starts_with("//")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'))
}

fn ensure_inside_root(
    resolved: &Path,
    resolver: &dyn RetainedProcessTaskRootResolver,
    label: &'static str,
) -> Result<(), ProcessTaskPlanError> {
    if !resolved.is_absolute() || !resolver.is_within_retained_root(resolved) {
        return Err(ProcessTaskPlanError::WorkspaceEscape(label));
    }
    Ok(())
}

fn safe_bare_tool(command: &str) -> bool {
    !command.is_empty()
        && !command.starts_with('-')
        && command
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn is_shell_interpreter(command_name: &str) -> bool {
    matches!(
        command_name.to_ascii_lowercase().as_str(),
        "bash"
            | "cmd"
            | "cmd.exe"
            | "cscript"
            | "cscript.exe"
            | "dash"
            | "fish"
            | "ksh"
            | "mshta"
            | "mshta.exe"
            | "powershell"
            | "powershell.exe"
            | "pwsh"
            | "sh"
            | "wscript"
            | "wscript.exe"
            | "zsh"
    )
}
