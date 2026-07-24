use crate::debug_adapter::{
    DebugLaunchTarget, JsTestDebugNameMatch, JsTestDebugRunner, JsTestDebugSelection,
    NodeConfiguredScriptRuntime,
};
use crate::debug_source_map::{
    emitted_type_script_path, emitted_type_script_path_without_source_map,
};
use crate::debug_support::validate_workspace_file;
use crate::package_tool_context::PackageToolContext;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[path = "debug_node_source_map_launch.rs"]
mod source_map_launch;
#[path = "debug_node_watch_launch_policy.rs"]
mod watch_launch_policy;

pub(crate) use source_map_launch::source_map_registry;
pub(crate) use watch_launch_policy::NativeNodeWatchLaunchPolicy;

#[allow(dead_code)]
pub(crate) fn build_strict_native_node_watch_launch_plan(
    root: &Path,
    policy: NativeNodeWatchLaunchPolicy,
) -> Result<NodeLaunchPlan, String> {
    watch_launch_policy::launch_plan::build_native_node_watch_launch_plan(root, policy)
}

#[cfg(test)]
pub(crate) fn build_native_node_watch_launch_plan_for_test(
    root: &Path,
    script_path: String,
    runtime_major: u8,
) -> Result<NodeLaunchPlan, String> {
    let policy =
        watch_launch_policy::NativeNodeWatchLaunchPolicy::for_test(script_path, runtime_major)
            .map_err(str::to_string)?;
    build_strict_native_node_watch_launch_plan(root, policy)
}

pub(crate) const INSPECT_FLAG: &str = "--inspect-brk=127.0.0.1:0";
const VITEST_ENTRY: &[&str] = &["node_modules", "vitest", "vitest.mjs"];
const JEST_ENTRY: &[&str] = &["node_modules", "jest", "bin", "jest.js"];
const ALLOWED_NPM_NODE_WRAPPERS: &[&str] = &["ts-node", "ts-node-esm", "tsx"];
const MAX_CONFIGURED_ARGUMENTS: usize = 128;
const MAX_CONFIGURED_ARGUMENT_BYTES: usize = 16 * 1024;
const MAX_ENVIRONMENT_ENTRIES: usize = 128;
const MAX_ENVIRONMENT_NAME_BYTES: usize = 256;
const MAX_ENVIRONMENT_VALUE_BYTES: usize = 16 * 1024;
const MAX_DEBUG_PATH_BYTES: usize = 4 * 1024;
const MAX_JS_TEST_FULL_NAME_BYTES: usize = 4 * 1024;
const MAX_NPM_MANIFEST_BYTES: usize = 256 * 1024;
const NPM_MANIFEST_READ_ERROR: &str = "Unable to read NPM package.json safely.";
const NPM_PACKAGE_AUTHORITY_ERROR: &str = "NPM debug package authority is invalid.";
const NPM_SCRIPT_LIFECYCLE_ERROR: &str = "NPM debug script lifecycle is not supported safely.";

#[derive(Debug)]
pub(crate) struct NodeLaunchPlan {
    pub(crate) program: NodeLaunchProgram,
    pub(crate) arguments: Vec<String>,
    pub(crate) working_directory: PathBuf,
    pub(crate) environment: HashMap<String, String>,
    pub(crate) isolated_environment: bool,
    pub(crate) inspect_via_environment: bool,
    pub(crate) startup_entry: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub(crate) enum NodeLaunchProgram {
    Node,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    ExactNode {
        canonical_path: PathBuf,
        executable: Arc<std::fs::File>,
    },
    TrustedLiveNode {
        canonical_path: PathBuf,
        fingerprint: NodeExecutableFingerprint,
    },
    WorkspaceTool(PathBuf),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NodeExecutableFingerprint {
    pub(crate) device: u64,
    pub(crate) inode: u64,
    pub(crate) length: u64,
    pub(crate) modified_seconds: i64,
    pub(crate) modified_nanoseconds: i64,
    pub(crate) sha256: [u8; 32],
}

impl PartialEq for NodeLaunchProgram {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Node, Self::Node) => true,
            (
                Self::ExactNode {
                    canonical_path: left,
                    executable: left_executable,
                },
                Self::ExactNode {
                    canonical_path: right,
                    executable: right_executable,
                },
            ) => left == right && Arc::ptr_eq(left_executable, right_executable),
            (
                Self::TrustedLiveNode {
                    canonical_path: left_path,
                    fingerprint: left_fingerprint,
                },
                Self::TrustedLiveNode {
                    canonical_path: right_path,
                    fingerprint: right_fingerprint,
                },
            ) => left_path == right_path && left_fingerprint == right_fingerprint,
            (Self::WorkspaceTool(left), Self::WorkspaceTool(right)) => left == right,
            _ => false,
        }
    }
}

impl Eq for NodeLaunchProgram {}

#[cfg(test)]
pub(crate) fn build_launch_arguments(
    root: &Path,
    launch_target: &DebugLaunchTarget,
) -> Result<Vec<String>, String> {
    Ok(build_launch_plan(root, launch_target)?.arguments)
}

pub(crate) fn build_launch_plan(
    root: &Path,
    launch_target: &DebugLaunchTarget,
) -> Result<NodeLaunchPlan, String> {
    build_launch_plan_with_source_maps(root, launch_target, true)
}

pub(crate) fn build_launch_plan_with_source_maps(
    root: &Path,
    launch_target: &DebugLaunchTarget,
    source_maps_enabled: bool,
) -> Result<NodeLaunchPlan, String> {
    match launch_target {
        DebugLaunchTarget::NodeAttach { .. } => {
            Err("Node inspector attach targets do not spawn a process.".to_string())
        }
        DebugLaunchTarget::NodeScript { script_path, .. } => script_plan(
            root,
            script_path,
            &[],
            None,
            HashMap::new(),
            false,
            None,
            source_maps_enabled,
        ),
        DebugLaunchTarget::JsTestFile {
            runner,
            file_path,
            package_root_path,
            ..
        } => test_plan(
            root,
            runner,
            file_path,
            package_root_path,
            &[],
            None,
            HashMap::new(),
            false,
        ),
        DebugLaunchTarget::NodeConfiguredScript {
            script_path,
            args,
            cwd,
            env,
            ..
        } => script_plan(
            root,
            script_path,
            args,
            cwd.as_deref(),
            env.clone(),
            true,
            None,
            source_maps_enabled,
        ),
        DebugLaunchTarget::NodeConfiguredRuntimeScript {
            script_path,
            args,
            cwd,
            env,
            runtime,
            ..
        } => script_plan(
            root,
            script_path,
            args,
            cwd.as_deref(),
            env.clone(),
            true,
            Some(*runtime),
            source_maps_enabled,
        ),
        DebugLaunchTarget::JsConfiguredTest {
            runner,
            file_path,
            package_root_path,
            args,
            cwd,
            env,
            ..
        } => test_plan(
            root,
            runner,
            file_path,
            package_root_path,
            args,
            cwd.as_deref(),
            env.clone(),
            true,
        ),
        DebugLaunchTarget::JsTestSelection {
            runner,
            file_path,
            package_root_path,
            selection,
            ..
        } => selection_test_plan(root, runner, file_path, package_root_path, selection),
        DebugLaunchTarget::NodeNpmScript {
            script,
            package_root_path,
            args,
            cwd,
            env,
            ..
        } => npm_script_plan(
            root,
            package_root_path,
            script,
            args,
            cwd.as_deref(),
            env.clone(),
        ),
        _ => Err("Unsupported launch target for the Node.js debugger.".to_string()),
    }
}

/// Builds the same validated Node target as the debugger, but with every backend-owned
/// inspector option removed. Configured inspector arguments are rejected rather than silently
/// changing their meaning.
pub(crate) fn build_run_plan(
    root: &Path,
    launch_target: &DebugLaunchTarget,
) -> Result<NodeLaunchPlan, String> {
    reject_run_only_unsupported_target(launch_target)?;
    reject_configured_inspector_arguments(launch_target)?;
    let mut plan = build_launch_plan(root, launch_target)?;
    plan.arguments.retain(|argument| {
        argument != INSPECT_FLAG
            && argument != "--inspectBrk=127.0.0.1:0"
            && !argument.starts_with("--inspect-brk=")
            && !argument.starts_with("--inspectBrk=")
    });
    plan.inspect_via_environment = false;
    debug_assert!(!plan
        .arguments
        .iter()
        .any(|argument| argument.to_ascii_lowercase().starts_with("--inspect")));
    Ok(plan)
}

fn reject_run_only_unsupported_target(target: &DebugLaunchTarget) -> Result<(), String> {
    match target {
        DebugLaunchTarget::NodeScript { .. }
        | DebugLaunchTarget::JsTestFile { .. }
        | DebugLaunchTarget::NodeConfiguredScript { .. }
        | DebugLaunchTarget::NodeConfiguredRuntimeScript { .. }
        | DebugLaunchTarget::JsConfiguredTest { .. }
        | DebugLaunchTarget::NodeNpmScript { .. } => Ok(()),
        _ => Err("Run Without Debugging supports Node scripts, JavaScript tests, and safe NPM Node scripts only.".to_string()),
    }
}

fn reject_configured_inspector_arguments(target: &DebugLaunchTarget) -> Result<(), String> {
    let arguments = match target {
        DebugLaunchTarget::NodeConfiguredScript { args, .. }
        | DebugLaunchTarget::NodeConfiguredRuntimeScript { args, .. }
        | DebugLaunchTarget::JsConfiguredTest { args, .. }
        | DebugLaunchTarget::NodeNpmScript { args, .. } => args.as_slice(),
        _ => &[],
    };
    if arguments
        .iter()
        .any(|argument| argument.to_ascii_lowercase().starts_with("--inspect"))
    {
        return Err("Run Without Debugging cannot enable the Node inspector.".to_string());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn script_plan(
    root: &Path,
    script_path: &str,
    args: &[String],
    cwd: Option<&str>,
    environment: HashMap<String, String>,
    isolated_environment: bool,
    runtime: Option<NodeConfiguredScriptRuntime>,
    source_maps_enabled: bool,
) -> Result<NodeLaunchPlan, String> {
    if isolated_environment {
        validate_configured_arguments(args)?;
        validate_environment(&environment)?;
        validate_configured_path_payload(script_path, "script path")?;
        if let Some(cwd) = cwd {
            validate_configured_path_payload(cwd, "working directory")?;
        }
    }
    let script = validate_workspace_file(root, script_path)?;
    let source = Path::new(&script);
    validate_node_script_path(source)?;
    if let Some(runtime) = runtime {
        let context = PackageToolContext::resolve(&root.to_string_lossy(), &script)?;
        let runtime_name = match runtime {
            NodeConfiguredScriptRuntime::Tsx => "tsx",
            NodeConfiguredScriptRuntime::TsNode => "ts-node",
        };
        let mut arguments = vec![script.clone()];
        arguments.extend(args.iter().cloned());
        return workspace_wrapper_plan(
            &context,
            runtime_name,
            script,
            arguments,
            validate_working_directory(root, cwd)?,
            environment,
        );
    }
    let is_type_script = is_type_script_path(source);
    let launched = if is_type_script {
        let emitted = if source_maps_enabled {
            emitted_type_script_path(root, source)?
        } else {
            emitted_type_script_path_without_source_map(root, source)?
        };
        emitted.to_string_lossy().to_string()
    } else {
        script
    };
    let mut arguments = vec![INSPECT_FLAG.to_string()];
    if is_type_script && source_maps_enabled {
        arguments.push("--enable-source-maps".to_string());
    }
    arguments.push(launched);
    arguments.extend(args.iter().cloned());
    Ok(NodeLaunchPlan {
        program: NodeLaunchProgram::Node,
        arguments,
        working_directory: validate_working_directory(root, cwd)?,
        environment,
        isolated_environment,
        inspect_via_environment: false,
        startup_entry: None,
    })
}

#[allow(clippy::too_many_arguments)]
fn test_plan(
    root: &Path,
    runner: &str,
    file_path: &str,
    package_root_path: &str,
    args: &[String],
    cwd: Option<&str>,
    environment: HashMap<String, String>,
    isolated_environment: bool,
) -> Result<NodeLaunchPlan, String> {
    if isolated_environment {
        validate_configured_arguments(args)?;
        validate_environment(&environment)?;
        validate_configured_path_payload(file_path, "test file path")?;
        validate_configured_path_payload(package_root_path, "package root path")?;
        if let Some(cwd) = cwd {
            validate_configured_path_payload(cwd, "working directory")?;
        }
    }
    let file = validate_workspace_file(root, file_path)?;
    let context = PackageToolContext::resolve(&root.to_string_lossy(), &file)?;
    let package_root = context.validated_ancestor_directory(package_root_path)?;
    let entry = test_runner_entry(&context, &package_root, runner)?;
    let mut arguments = if runner == "vitest" {
        vec![
            INSPECT_FLAG.to_string(),
            entry,
            "run".to_string(),
            "--no-file-parallelism".to_string(),
            file,
        ]
    } else {
        vec![
            INSPECT_FLAG.to_string(),
            entry,
            "--runInBand".to_string(),
            file,
        ]
    };
    arguments.extend(args.iter().cloned());
    Ok(NodeLaunchPlan {
        program: NodeLaunchProgram::Node,
        arguments,
        working_directory: match cwd {
            Some(value) => validate_working_directory(root, Some(value))?,
            None => package_root,
        },
        environment,
        isolated_environment,
        inspect_via_environment: false,
        startup_entry: None,
    })
}

fn selection_test_plan(
    root: &Path,
    runner: &JsTestDebugRunner,
    file_path: &str,
    package_root_path: &str,
    selection: &JsTestDebugSelection,
) -> Result<NodeLaunchPlan, String> {
    let name = match selection {
        JsTestDebugSelection::File => None,
        JsTestDebugSelection::Suite { full_name } => {
            Some((full_name.as_str(), JsTestDebugNameMatch::Prefix))
        }
        JsTestDebugSelection::Test {
            full_name,
            name_match,
        } => Some((full_name.as_str(), *name_match)),
    };
    validate_js_test_selection_text(file_path, "file path", MAX_DEBUG_PATH_BYTES)?;
    validate_js_test_selection_text(package_root_path, "package root path", MAX_DEBUG_PATH_BYTES)?;
    if let Some((full_name, _)) = name {
        validate_js_test_selection_text(full_name, "full name", MAX_JS_TEST_FULL_NAME_BYTES)?;
    }
    let file = validate_workspace_file(root, file_path)?;
    let context = PackageToolContext::resolve(&root.to_string_lossy(), &file)?;
    let package_root = context.validated_ancestor_directory(package_root_path)?;
    let runner_name = match runner {
        JsTestDebugRunner::Jest => "jest",
        JsTestDebugRunner::Vitest => "vitest",
    };
    let entry = test_runner_entry(&context, &package_root, runner_name)?;
    let name_pattern = name.map(validated_test_name_pattern).transpose()?;
    let mut arguments = match runner {
        JsTestDebugRunner::Jest => vec![
            INSPECT_FLAG.to_string(),
            entry,
            "--runInBand".to_string(),
            "--runTestsByPath".to_string(),
            file,
        ],
        JsTestDebugRunner::Vitest => vec![
            entry,
            "run".to_string(),
            "--inspectBrk=127.0.0.1:0".to_string(),
            "--pool=forks".to_string(),
            "--maxWorkers=1".to_string(),
            "--no-file-parallelism".to_string(),
            file,
        ],
    };
    if let Some(pattern) = name_pattern {
        arguments.push("-t".to_string());
        arguments.push(pattern);
    }
    Ok(NodeLaunchPlan {
        program: NodeLaunchProgram::Node,
        arguments,
        working_directory: package_root,
        environment: HashMap::new(),
        isolated_environment: false,
        inspect_via_environment: false,
        startup_entry: None,
    })
}

fn validated_test_name_pattern(
    (full_name, name_match): (&str, JsTestDebugNameMatch),
) -> Result<String, String> {
    debug_assert!(full_name.len() <= MAX_JS_TEST_FULL_NAME_BYTES);
    let mut escaped = String::with_capacity(full_name.len());
    for character in full_name.chars() {
        if matches!(
            character,
            '.' | '^' | '$' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    Ok(match name_match {
        JsTestDebugNameMatch::Exact => format!(r"^{escaped}$"),
        JsTestDebugNameMatch::Prefix => format!(r"^{escaped}(?: |$)"),
    })
}

fn npm_script_plan(
    root: &Path,
    package_root_path: &str,
    script_name: &str,
    configured_args: &[String],
    cwd: Option<&str>,
    environment: HashMap<String, String>,
) -> Result<NodeLaunchPlan, String> {
    if !safe_npm_script_name(script_name) {
        return Err("NPM debug script name is invalid.".to_string());
    }
    validate_configured_path_payload(package_root_path, "package root path")?;
    if let Some(cwd) = cwd {
        validate_configured_path_payload(cwd, "working directory")?;
    }
    validate_configured_arguments(configured_args)?;
    validate_environment(&environment)?;
    let requested_package_root = validate_working_directory(root, Some(package_root_path))
        .map_err(|_| NPM_PACKAGE_AUTHORITY_ERROR.to_string())?;
    let package_json_path = requested_package_root.join("package.json");
    let package_json_file = validate_workspace_file(root, &package_json_path.to_string_lossy())?;
    let canonical_package_root = Path::new(&package_json_file)
        .parent()
        .ok_or_else(|| "NPM package.json has no parent directory.".to_string())?
        .to_path_buf();
    if canonical_package_root != requested_package_root {
        return Err(NPM_PACKAGE_AUTHORITY_ERROR.to_string());
    }
    let package_root = requested_package_root;
    let manifest_source = read_npm_manifest_bounded(&package_json_path)?;
    let manifest: Value = serde_json::from_str(&manifest_source)
        .map_err(|_| "Unable to parse NPM package.json safely.".to_string())?;
    let scripts = manifest
        .get("scripts")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("NPM script `{script_name}` was not found in package.json."))?;
    if scripts.contains_key(&format!("pre{script_name}"))
        || scripts.contains_key(&format!("post{script_name}"))
    {
        return Err(NPM_SCRIPT_LIFECYCLE_ERROR.to_string());
    }
    let command = scripts
        .get(script_name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("NPM script `{script_name}` was not found in package.json."))?;
    if command.len() > 16 * 1024 {
        return Err("NPM debug script command is too large.".to_string());
    }
    let tokens = safe_npm_command_tokens(command)?;
    let tool = tokens.first().cloned().unwrap_or_default();
    if tool == "node" {
        if tokens.len() < 2 || tokens[1].starts_with('-') {
            return Err(unsupported_npm_script());
        }
        let script =
            validate_workspace_file(root, &package_root.join(&tokens[1]).to_string_lossy())?;
        if !is_java_script_path(Path::new(&script)) {
            return Err(
                "NPM direct-node debugging requires a JavaScript (.js, .mjs, .cjs) entry file."
                    .to_string(),
            );
        }
        validate_node_script_path(Path::new(&script))?;
        let mut arguments = vec![INSPECT_FLAG.to_string(), script];
        arguments.extend(tokens.into_iter().skip(2));
        arguments.extend(configured_args.iter().cloned());
        return Ok(NodeLaunchPlan {
            program: NodeLaunchProgram::Node,
            arguments,
            working_directory: match cwd {
                Some(value) => validate_working_directory(root, Some(value))?,
                None => package_root,
            },
            environment,
            isolated_environment: true,
            inspect_via_environment: false,
            startup_entry: None,
        });
    }
    if !ALLOWED_NPM_NODE_WRAPPERS.contains(&tool.as_str())
        || tokens.len() < 2
        || tokens[1].starts_with('-')
    {
        return Err(unsupported_npm_script());
    }
    let wrapper_target =
        validate_workspace_file(root, &package_root.join(&tokens[1]).to_string_lossy())?;
    validate_node_script_path(Path::new(&wrapper_target))?;
    let context = PackageToolContext::resolve(&root.to_string_lossy(), &package_json_file)?;
    let mut arguments = vec![wrapper_target.clone()];
    arguments.extend(tokens.into_iter().skip(2));
    arguments.extend(configured_args.iter().cloned());
    workspace_wrapper_plan(
        &context,
        &tool,
        wrapper_target,
        arguments,
        match cwd {
            Some(value) => validate_working_directory(root, Some(value))?,
            None => package_root,
        },
        environment,
    )
}

fn workspace_wrapper_plan(
    context: &PackageToolContext,
    tool: &str,
    target: String,
    arguments: Vec<String>,
    working_directory: PathBuf,
    environment: HashMap<String, String>,
) -> Result<NodeLaunchPlan, String> {
    let expected = context
        .nearest_package_root()
        .join("node_modules/.bin")
        .join(tool);
    let wrapper = context.nearest_executable(tool)?.ok_or_else(|| {
        format!(
            "The allowlisted Node wrapper `{tool}` was not found at the expected workspace path `{}`.",
            expected.display()
        )
    })?;
    Ok(NodeLaunchPlan {
        program: NodeLaunchProgram::WorkspaceTool(wrapper),
        arguments,
        working_directory,
        environment,
        isolated_environment: true,
        inspect_via_environment: true,
        startup_entry: Some(PathBuf::from(target)),
    })
}

fn read_npm_manifest_bounded(path: &Path) -> Result<String, String> {
    read_npm_manifest_bounded_with_hook(path, || {})
}

fn read_npm_manifest_bounded_with_hook(
    path: &Path,
    after_metadata: impl FnOnce(),
) -> Result<String, String> {
    let path_before =
        fs::symlink_metadata(path).map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    if !path_before.is_file() || path_before.file_type().is_symlink() {
        return Err(NPM_MANIFEST_READ_ERROR.to_string());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    let before = file
        .metadata()
        .map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    if !before.is_file() || before.len() > MAX_NPM_MANIFEST_BYTES as u64 {
        return Err(NPM_MANIFEST_READ_ERROR.to_string());
    }
    after_metadata();

    let mut bytes = Vec::with_capacity(MAX_NPM_MANIFEST_BYTES.min(64 * 1024));
    file.by_ref()
        .take((MAX_NPM_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    let after = file
        .metadata()
        .map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    let current = fs::symlink_metadata(path).map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())?;
    if bytes.len() > MAX_NPM_MANIFEST_BYTES
        || after.len() > MAX_NPM_MANIFEST_BYTES as u64
        || !same_manifest_snapshot(&before, &after)
        || !same_manifest_identity(&before, &path_before)
        || current.file_type().is_symlink()
        || !same_manifest_identity(&after, &current)
    {
        return Err(NPM_MANIFEST_READ_ERROR.to_string());
    }
    String::from_utf8(bytes).map_err(|_| NPM_MANIFEST_READ_ERROR.to_string())
}

#[cfg(unix)]
fn same_manifest_identity(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_manifest_identity(left: &Metadata, right: &Metadata) -> bool {
    left.len() == right.len() && left.modified().ok() == right.modified().ok()
}

#[cfg(unix)]
fn same_manifest_snapshot(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    same_manifest_identity(left, right)
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_manifest_snapshot(left: &Metadata, right: &Metadata) -> bool {
    same_manifest_identity(left, right)
}

fn safe_npm_command_tokens(command: &str) -> Result<Vec<String>, String> {
    if command.contains(|character: char| {
        matches!(
            character,
            '\0' | '\r' | '\n' | '&' | '|' | ';' | '>' | '<' | '`' | '$' | '\'' | '"'
        )
    }) {
        return Err(unsupported_npm_script());
    }
    let tokens: Vec<String> = command.split_whitespace().map(str::to_string).collect();
    if tokens.len() > MAX_CONFIGURED_ARGUMENTS || tokens.iter().any(|token| token.len() > 4_096) {
        return Err("NPM debug script command exceeds the safe argument bounds.".to_string());
    }
    Ok(tokens)
}

fn validate_configured_arguments(arguments: &[String]) -> Result<(), String> {
    if arguments.len() > MAX_CONFIGURED_ARGUMENTS
        || arguments.iter().any(|argument| {
            argument.len() > MAX_CONFIGURED_ARGUMENT_BYTES || argument.contains('\0')
        })
    {
        return Err("Configured debug arguments exceed the safe bounds.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_environment(environment: &HashMap<String, String>) -> Result<(), String> {
    if environment.len() > MAX_ENVIRONMENT_ENTRIES
        || environment.iter().any(|(key, value)| {
            let normalized_key = key.to_ascii_uppercase();
            !valid_environment_key(key)
                || key.len() > MAX_ENVIRONMENT_NAME_BYTES
                || value.len() > MAX_ENVIRONMENT_VALUE_BYTES
                || value.contains('\0')
                || matches!(
                    normalized_key.as_str(),
                    "PATH"
                        | "NODE_OPTIONS"
                        | "SHELL"
                        | "COMSPEC"
                        | "PATHEXT"
                        | "LD_PRELOAD"
                        | "LD_LIBRARY_PATH"
                        | "DYLD_INSERT_LIBRARIES"
                        | "DYLD_LIBRARY_PATH"
                )
                || normalized_key.starts_with("NPM_CONFIG_")
        })
    {
        return Err("Configured debug environment exceeds the safe bounds.".to_string());
    }
    Ok(())
}

fn valid_environment_key(key: &str) -> bool {
    let mut bytes = key.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
}

fn validate_configured_path_payload(path: &str, label: &str) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > MAX_DEBUG_PATH_BYTES || path.contains('\0') {
        return Err(format!(
            "Configured debug {label} exceeds the safe path bounds."
        ));
    }
    Ok(())
}

fn validate_js_test_selection_text(
    value: &str,
    label: &str,
    maximum_bytes: usize,
) -> Result<(), String> {
    if value.is_empty() || value.len() > maximum_bytes || value.chars().any(char::is_control) {
        return Err(format!(
            "JavaScript test debug {label} is invalid or exceeds the safe bounds."
        ));
    }
    Ok(())
}

fn unsupported_npm_script() -> String {
    "NPM debugging supports only direct `node <workspace-file>` scripts or allowlisted Node wrappers (`tsx`, `ts-node`) without shell syntax."
        .to_string()
}

fn safe_npm_script_name(script_name: &str) -> bool {
    !script_name.is_empty()
        && script_name.len() <= 128
        && !script_name.starts_with('-')
        && script_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
}

fn validate_working_directory(root: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let directory = cwd
        .map(Path::new)
        .unwrap_or(root)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve debug working directory: {error}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    if !directory.is_dir() || directory.strip_prefix(canonical_root).is_err() {
        return Err("Debug working directory must stay inside the workspace.".to_string());
    }
    Ok(directory)
}

fn validate_node_script_path(path: &Path) -> Result<(), String> {
    if is_type_script_declaration(path) {
        return Err("TypeScript declaration files cannot be launched.".to_string());
    }
    if !is_java_script_path(path) && !is_type_script_path(path) {
        return Err(
            "Node debugging supports JavaScript and TypeScript source files only.".to_string(),
        );
    }
    Ok(())
}

fn is_type_script_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "mts" | "cts")
    )
}

fn is_type_script_declaration(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
}

fn is_java_script_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("js" | "mjs" | "cjs")
    )
}

fn test_runner_entry(
    context: &PackageToolContext,
    package_root: &Path,
    runner: &str,
) -> Result<String, String> {
    let segments = match runner {
        "vitest" => VITEST_ENTRY,
        "jest" => JEST_ENTRY,
        other => return Err(format!("Unsupported JavaScript test runner `{other}`.")),
    };
    let relative = segments.iter().collect::<PathBuf>();
    let Some(entry) = context.nearest_file_from(package_root, &relative)? else {
        return Err(format!(
            "The {runner} runtime is not installed in node_modules for this package context."
        ));
    };
    Ok(entry.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn fixture(name: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "debug-node-launch-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create fixture");
        root.canonicalize().expect("canonicalize fixture")
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, content).expect("write fixture");
    }

    fn write_executable(path: &Path, content: &str) {
        write(path, content);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).expect("wrapper metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("wrapper permissions");
        }
    }

    #[path = "debug_node_launch_runtime_tests.rs"]
    mod runtime_tests;
    #[path = "debug_node_launch_source_map_tests.rs"]
    mod source_map_tests;

    #[test]
    fn configured_script_applies_args_cwd_and_environment() {
        let root = fixture("script");
        let script = root.join("src/index.js");
        write(&script, "console.log('hi');");
        let plan = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeConfiguredScript {
                script_path: script.to_string_lossy().to_string(),
                args: vec!["--port".to_string(), "4100".to_string()],
                cwd: Some(root.join("src").to_string_lossy().to_string()),
                env: HashMap::from([("PORT".to_string(), "4100".to_string())]),
                just_my_code: None,
            },
        )
        .expect("plan");
        assert_eq!(plan.arguments[2..], ["--port", "4100"]);
        assert_eq!(plan.working_directory, root.join("src"));
        assert_eq!(
            plan.environment.get("PORT").map(String::as_str),
            Some("4100")
        );
        assert!(plan.isolated_environment);
    }

    #[test]
    fn run_plan_reuses_validation_without_any_inspector_transport() {
        let root = fixture("run-without-debugging");
        let script = root.join("app.js");
        write(&script, "console.log('ok');");
        let plan = build_run_plan(
            &root,
            &DebugLaunchTarget::NodeConfiguredScript {
                script_path: script.to_string_lossy().to_string(),
                args: vec!["--port".to_string(), "4100".to_string()],
                cwd: None,
                env: HashMap::from([("PORT".to_string(), "4100".to_string())]),
                just_my_code: None,
            },
        )
        .unwrap();

        assert_eq!(
            plan.arguments,
            [
                script.to_string_lossy().to_string(),
                "--port".to_string(),
                "4100".to_string()
            ]
        );
        assert!(!plan.inspect_via_environment);
        assert!(!plan
            .arguments
            .iter()
            .any(|argument| argument.to_ascii_lowercase().starts_with("--inspect")));
        assert!(!plan.environment.contains_key("NODE_OPTIONS"));
    }

    #[test]
    fn run_plan_rejects_configured_inspection_and_non_spawn_targets() {
        let root = fixture("run-rejects-inspector");
        let script = root.join("app.js");
        write(&script, "console.log('ok');");
        let error = build_run_plan(
            &root,
            &DebugLaunchTarget::NodeConfiguredScript {
                script_path: script.to_string_lossy().to_string(),
                args: vec!["--inspect=127.0.0.1:0".to_string()],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .unwrap_err();
        assert!(error.contains("cannot enable"));
        assert!(build_run_plan(&root, &DebugLaunchTarget::NodeAttach { port: 9229 }).is_err());
    }

    fn test_runner_fixture(name: &str) -> (PathBuf, String, String, String) {
        let root = fixture(name);
        write(&root.join("package.json"), r#"{"private":true}"#);
        let test_file = root.join("src/math.test.ts");
        write(&test_file, "test('math adds', () => {});");
        let jest_entry = root.join(JEST_ENTRY.iter().collect::<PathBuf>());
        let vitest_entry = root.join(VITEST_ENTRY.iter().collect::<PathBuf>());
        write(&jest_entry, "");
        write(&vitest_entry, "");
        (
            root.clone(),
            test_file.to_string_lossy().to_string(),
            jest_entry.to_string_lossy().to_string(),
            vitest_entry.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn scoped_jest_uses_node_inspection_and_anchored_exact_selection() {
        let (root, file, jest_entry, _) = test_runner_fixture("scoped-jest");
        let plan = build_launch_plan(
            &root,
            &DebugLaunchTarget::JsTestSelection {
                runner: JsTestDebugRunner::Jest,
                file_path: file.clone(),
                package_root_path: root.to_string_lossy().to_string(),
                selection: JsTestDebugSelection::Test {
                    full_name: "math adds (fast)".to_string(),
                    name_match: JsTestDebugNameMatch::Exact,
                },
            },
        )
        .expect("Jest selection plan");

        assert_eq!(
            plan.arguments,
            [
                INSPECT_FLAG,
                &jest_entry,
                "--runInBand",
                "--runTestsByPath",
                &file,
                "-t",
                r"^math adds \(fast\)$",
            ]
        );
        assert!(plan.environment.is_empty());
        assert!(!plan.isolated_environment);
        assert_eq!(plan.working_directory, root);
    }

    #[test]
    fn scoped_jest_suite_uses_a_token_boundary_prefix() {
        let (root, _, _, _) = test_runner_fixture("scoped-jest-suite");
        let arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestSelection {
                runner: JsTestDebugRunner::Jest,
                file_path: root.join("src/math.test.ts").to_string_lossy().to_string(),
                package_root_path: root.to_string_lossy().to_string(),
                selection: JsTestDebugSelection::Suite {
                    full_name: "math (fast)".to_string(),
                },
            },
        )
        .expect("Jest suite plan");
        assert_eq!(arguments[arguments.len() - 2], "-t");
        assert_eq!(
            arguments.last().map(String::as_str),
            Some(r"^math \(fast\)(?: |$)")
        );
    }

    #[test]
    fn scoped_vitest_uses_runner_inspection_and_serial_fork_pool() {
        let (root, file, _, vitest_entry) = test_runner_fixture("scoped-vitest");
        let plan = build_launch_plan(
            &root,
            &DebugLaunchTarget::JsTestSelection {
                runner: JsTestDebugRunner::Vitest,
                file_path: file.clone(),
                package_root_path: root.to_string_lossy().to_string(),
                selection: JsTestDebugSelection::File,
            },
        )
        .expect("Vitest selection plan");

        assert_eq!(
            plan.arguments,
            [
                vitest_entry,
                "run".to_string(),
                "--inspectBrk=127.0.0.1:0".to_string(),
                "--pool=forks".to_string(),
                "--maxWorkers=1".to_string(),
                "--no-file-parallelism".to_string(),
                file,
            ]
        );
        assert!(!plan
            .arguments
            .iter()
            .any(|argument| argument == INSPECT_FLAG));
    }

    #[test]
    fn scoped_selection_rejects_unsafe_paths_and_unbounded_names() {
        let (root, _, _, _) = test_runner_fixture("scoped-invalid");
        let target = |file_path: String, package_root_path: String, selection| {
            DebugLaunchTarget::JsTestSelection {
                runner: JsTestDebugRunner::Vitest,
                file_path,
                package_root_path,
                selection,
            }
        };
        for full_name in [
            String::new(),
            "suite\ntest".to_string(),
            "suite\u{85}test".to_string(),
            "x".repeat(MAX_JS_TEST_FULL_NAME_BYTES + 1),
        ] {
            assert!(build_launch_plan(
                &root,
                &target(
                    root.join("src/math.test.ts").to_string_lossy().to_string(),
                    root.to_string_lossy().to_string(),
                    JsTestDebugSelection::Test {
                        full_name,
                        name_match: JsTestDebugNameMatch::Prefix,
                    },
                )
            )
            .expect_err("invalid name")
            .contains("full name"));
        }
        assert!(build_launch_plan(
            &root,
            &target(
                "../outside.test.ts".to_string(),
                root.to_string_lossy().to_string(),
                JsTestDebugSelection::File,
            )
        )
        .is_err());
        for invalid_path in [
            "src/\u{85}math.test.ts".to_string(),
            "x".repeat(MAX_DEBUG_PATH_BYTES + 1),
        ] {
            assert!(build_launch_plan(
                &root,
                &target(
                    invalid_path.clone(),
                    root.to_string_lossy().to_string(),
                    JsTestDebugSelection::File,
                )
            )
            .expect_err("invalid selection file path")
            .contains("file path"));
            assert!(build_launch_plan(
                &root,
                &target(
                    root.join("src/math.test.ts").to_string_lossy().to_string(),
                    invalid_path,
                    JsTestDebugSelection::File,
                )
            )
            .expect_err("invalid selection package path")
            .contains("package root path"));
        }
        assert!(validate_js_test_selection_text(
            &"x".repeat(MAX_DEBUG_PATH_BYTES),
            "boundary",
            MAX_DEBUG_PATH_BYTES,
        )
        .is_ok());
        let raw_target: DebugLaunchTarget = serde_json::from_value(serde_json::json!({
            "kind": "js-test-selection",
            "runner": "jest",
            "filePath": root.join("src/math.test.ts").to_string_lossy(),
            "packageRootPath": root.to_string_lossy(),
            "selection": {"kind": "test", "fullName": "math\u{85}case", "nameMatch": "exact"}
        }))
        .expect("raw selection wire payload");
        assert!(build_launch_plan(&root, &raw_target)
            .expect_err("raw Unicode Cc payload")
            .contains("full name"));
    }

    #[test]
    fn configured_script_and_test_share_argument_and_environment_bounds() {
        let root = fixture("configured-bounds");
        let targets = |args: Vec<String>, env: HashMap<String, String>| {
            [
                DebugLaunchTarget::NodeConfiguredScript {
                    script_path: root.join("src/index.js").to_string_lossy().to_string(),
                    args: args.clone(),
                    cwd: None,
                    env: env.clone(),
                    just_my_code: None,
                },
                DebugLaunchTarget::JsConfiguredTest {
                    runner: "jest".to_string(),
                    file_path: root.join("src/a.test.js").to_string_lossy().to_string(),
                    package_root_path: root.to_string_lossy().to_string(),
                    args,
                    cwd: None,
                    env,
                },
            ]
        };
        let invalid_inputs = [
            (
                vec!["x".to_string(); MAX_CONFIGURED_ARGUMENTS + 1],
                HashMap::new(),
                "arguments",
            ),
            (
                vec!["x".repeat(MAX_CONFIGURED_ARGUMENT_BYTES + 1)],
                HashMap::new(),
                "arguments",
            ),
            (
                vec!["bad\0argument".to_string()],
                HashMap::new(),
                "arguments",
            ),
            (
                vec![],
                HashMap::from([("NODE_OPTIONS".to_string(), "--require=hook.js".to_string())]),
                "environment",
            ),
            (
                vec![],
                HashMap::from([("NPM_CONFIG_PREFIX".to_string(), "unsafe".to_string())]),
                "environment",
            ),
            (
                vec![],
                HashMap::from([(
                    "VALUE".to_string(),
                    "x".repeat(MAX_ENVIRONMENT_VALUE_BYTES + 1),
                )]),
                "environment",
            ),
        ];
        for (args, env, expected) in invalid_inputs {
            for target in targets(args.clone(), env.clone()) {
                assert!(build_launch_plan(&root, &target)
                    .expect_err("configured payload must be rejected")
                    .contains(expected));
            }
        }
        for protected_key in [
            "PATH",
            "path",
            "NODE_OPTIONS",
            "SHELL",
            "COMSPEC",
            "PATHEXT",
            "NPM_CONFIG_USERCONFIG",
            "LD_PRELOAD",
            "ld_library_path",
            "DYLD_INSERT_LIBRARIES",
            "dyld_library_path",
        ] {
            for target in targets(
                vec![],
                HashMap::from([(protected_key.to_string(), "unsafe".to_string())]),
            ) {
                assert!(build_launch_plan(&root, &target)
                    .expect_err("protected environment key must be rejected")
                    .contains("environment"));
            }
        }
        for invalid_key in [
            "1STARTS_WITH_DIGIT".to_string(),
            "BAD-CHAR".to_string(),
            format!("A{}", "B".repeat(MAX_ENVIRONMENT_NAME_BYTES)),
        ] {
            for target in targets(
                vec![],
                HashMap::from([(invalid_key.clone(), "value".to_string())]),
            ) {
                assert!(build_launch_plan(&root, &target)
                    .expect_err("invalid environment key must be rejected")
                    .contains("environment"));
            }
        }
        let too_many_environment_entries = (0..=MAX_ENVIRONMENT_ENTRIES)
            .map(|index| (format!("SAFE_{index}"), "value".to_string()))
            .collect();
        for target in targets(vec![], too_many_environment_entries) {
            assert!(build_launch_plan(&root, &target)
                .expect_err("environment entry overflow must be rejected")
                .contains("environment"));
        }
    }

    #[test]
    fn configured_payload_accepts_canonical_typescript_boundaries_without_total_caps() {
        let arguments = vec!["x".repeat(MAX_CONFIGURED_ARGUMENT_BYTES); MAX_CONFIGURED_ARGUMENTS];
        assert!(validate_configured_arguments(&arguments).is_ok());
        assert!(validate_configured_arguments(&["line\n$shell;syntax".to_string()]).is_ok());

        let environment: HashMap<_, _> = (0..MAX_ENVIRONMENT_ENTRIES)
            .map(|index| {
                (
                    format!("SAFE_{index}"),
                    "x".repeat(MAX_ENVIRONMENT_VALUE_BYTES),
                )
            })
            .collect();
        assert!(validate_environment(&environment).is_ok());
        assert!(validate_environment(&HashMap::from([(
            format!("A{}", "B".repeat(MAX_ENVIRONMENT_NAME_BYTES - 1)),
            "value".to_string(),
        )]))
        .is_ok());
        assert!(validate_configured_path_payload(
            &"x".repeat(MAX_DEBUG_PATH_BYTES),
            "working directory",
        )
        .is_ok());
    }

    #[test]
    fn configured_targets_reject_unbounded_paths_before_filesystem_resolution() {
        let root = fixture("configured-path-bounds");
        let oversized = "x".repeat(MAX_DEBUG_PATH_BYTES + 1);
        for target in [
            DebugLaunchTarget::NodeConfiguredScript {
                script_path: oversized.clone(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
            DebugLaunchTarget::JsConfiguredTest {
                runner: "jest".to_string(),
                file_path: root.join("a.test.js").to_string_lossy().to_string(),
                package_root_path: oversized.clone(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
            },
            DebugLaunchTarget::NodeConfiguredScript {
                script_path: root.join("index.js").to_string_lossy().to_string(),
                args: vec![],
                cwd: Some(oversized),
                env: HashMap::new(),
                just_my_code: None,
            },
        ] {
            assert!(build_launch_plan(&root, &target)
                .expect_err("configured path must be bounded")
                .contains("path bounds"));
        }
    }

    #[test]
    fn npm_direct_node_script_attaches_to_the_script_process() {
        let root = fixture("npm-direct");
        write(
            &root.join("package.json"),
            r#"{"scripts":{"dev":"node src/server.js --watch"}}"#,
        );
        write(&root.join("src/server.js"), "console.log('server');");
        let plan = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeNpmScript {
                script: "dev".to_string(),
                package_root_path: root.to_string_lossy().to_string(),
                args: vec!["--port".to_string(), "4100".to_string()],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .expect("direct node plan");
        assert_eq!(plan.program, NodeLaunchProgram::Node);
        assert_eq!(plan.arguments[0], INSPECT_FLAG);
        assert_eq!(
            plan.arguments[1],
            root.join("src/server.js").to_string_lossy()
        );
        assert_eq!(plan.arguments[2..], ["--watch", "--port", "4100"]);
    }

    #[test]
    fn npm_rejects_shell_and_non_allowlisted_wrapper_commands() {
        let root = fixture("npm-unsupported");
        write(
            &root.join("package.json"),
            r#"{"scripts":{"shell":"node src/server.js && echo done","wrapper":"npm.cmd run inner"}}"#,
        );
        write(&root.join("src/server.js"), "console.log('server');");
        for script in ["shell", "wrapper"] {
            let error = build_launch_plan(
                &root,
                &DebugLaunchTarget::NodeNpmScript {
                    script: script.to_string(),
                    package_root_path: root.to_string_lossy().to_string(),
                    args: vec![],
                    cwd: None,
                    env: HashMap::new(),
                    just_my_code: None,
                },
            )
            .expect_err("unsupported command");
            assert!(error.contains("allowlisted Node wrappers"));
        }
    }

    #[test]
    fn npm_rejects_unsafe_names_and_authoritative_argument_environment_overflow() {
        let root = fixture("npm-bounds");
        write(
            &root.join("package.json"),
            r#"{"scripts":{"dev":"node src/server.js"}}"#,
        );
        write(&root.join("src/server.js"), "console.log('server');");
        let target = |script: String, args: Vec<String>, env: HashMap<String, String>| {
            DebugLaunchTarget::NodeNpmScript {
                script,
                package_root_path: root.to_string_lossy().to_string(),
                args,
                cwd: None,
                env,
                just_my_code: None,
            }
        };

        assert!(
            build_launch_plan(&root, &target("--help".to_string(), vec![], HashMap::new()))
                .expect_err("unsafe script name")
                .contains("name is invalid")
        );
        assert!(build_launch_plan(
            &root,
            &target(
                "dev".to_string(),
                vec!["x".to_string(); MAX_CONFIGURED_ARGUMENTS + 1],
                HashMap::new(),
            )
        )
        .expect_err("argument overflow")
        .contains("arguments exceed"));
        assert!(build_launch_plan(
            &root,
            &target(
                "dev".to_string(),
                vec![],
                HashMap::from([("BAD=KEY".to_string(), "value".to_string())]),
            )
        )
        .expect_err("invalid environment")
        .contains("environment exceeds"));
    }

    #[test]
    fn npm_manifest_read_is_bounded_and_returns_only_a_generic_failure() {
        let root = fixture("npm-manifest-bound");
        fs::write(
            root.join("package.json"),
            vec![b'x'; MAX_NPM_MANIFEST_BYTES + 1],
        )
        .expect("oversized manifest");

        let error = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeNpmScript {
                script: "dev".to_string(),
                package_root_path: root.to_string_lossy().to_string(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .expect_err("oversized manifest must fail closed");

        assert_eq!(error, NPM_MANIFEST_READ_ERROR);
        assert!(!error.contains(&root.to_string_lossy().to_string()));
    }

    #[test]
    fn npm_manifest_growth_during_read_fails_closed() {
        use std::io::Write as _;

        let root = fixture("npm-manifest-growth");
        let manifest = root.join("package.json");
        write(&manifest, r#"{"scripts":{"dev":"node server.js"}}"#);

        let error = read_npm_manifest_bounded_with_hook(&manifest, || {
            let mut file = OpenOptions::new()
                .append(true)
                .open(&manifest)
                .expect("open growing manifest");
            file.write_all(&vec![b'x'; MAX_NPM_MANIFEST_BYTES])
                .expect("grow manifest");
        })
        .expect_err("growth must invalidate the snapshot");

        assert_eq!(error, NPM_MANIFEST_READ_ERROR);
    }

    #[test]
    fn npm_manifest_path_replacement_during_read_fails_closed() {
        let root = fixture("npm-manifest-replacement");
        let manifest = root.join("package.json");
        let displaced = root.join("package.original.json");
        write(&manifest, r#"{"scripts":{"dev":"node server.js"}}"#);

        let error = read_npm_manifest_bounded_with_hook(&manifest, || {
            fs::rename(&manifest, &displaced).expect("displace opened manifest");
            write(&manifest, r#"{"scripts":{"dev":"node replacement.js"}}"#);
        })
        .expect_err("path replacement must invalidate the snapshot");

        assert_eq!(error, NPM_MANIFEST_READ_ERROR);
    }

    #[cfg(unix)]
    #[test]
    fn npm_manifest_symlink_cannot_retarget_another_workspace_package() {
        use std::os::unix::fs::symlink;

        let root = fixture("npm-manifest-symlink");
        let package_a = root.join("packages/a");
        let package_b = root.join("packages/b");
        write(
            &package_b.join("package.json"),
            r#"{"scripts":{"private-script":"node private.js"}}"#,
        );
        write(&package_b.join("private.js"), "console.log('private');");
        fs::create_dir_all(&package_a).expect("package a");
        symlink("../b/package.json", package_a.join("package.json"))
            .expect("cross-package manifest symlink");

        let error = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeNpmScript {
                script: "private-script".to_string(),
                package_root_path: package_a.to_string_lossy().to_string(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .expect_err("symlinked package authority must fail closed");

        assert_eq!(error, NPM_PACKAGE_AUTHORITY_ERROR);
        assert!(!error.contains("private-script"));
        assert!(!error.contains(&package_b.to_string_lossy().to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn npm_manifest_symlink_cannot_retarget_a_file_in_the_same_package() {
        use std::os::unix::fs::symlink;

        let root = fixture("npm-manifest-local-symlink");
        write(
            &root.join("manifest.real.json"),
            r#"{"scripts":{"private-script":"node private.js"}}"#,
        );
        write(&root.join("private.js"), "console.log('private');");
        symlink("manifest.real.json", root.join("package.json"))
            .expect("same-package manifest symlink");

        let error = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeNpmScript {
                script: "private-script".to_string(),
                package_root_path: root.to_string_lossy().to_string(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .expect_err("symlinked package.json must fail closed");

        assert_eq!(error, NPM_MANIFEST_READ_ERROR);
        assert!(!error.contains("private-script"));
        assert!(!error.contains("manifest.real.json"));
    }

    #[test]
    fn npm_pre_and_post_hooks_are_rejected_instead_of_silently_changing_lifecycle() {
        for hook in ["predev", "postdev"] {
            let root = fixture(&format!("npm-{hook}"));
            write(
                &root.join("package.json"),
                &format!(r#"{{"scripts":{{"{hook}":"node private.js","dev":"node server.js"}}}}"#),
            );
            write(&root.join("server.js"), "console.log('server');");
            write(&root.join("private.js"), "console.log('private');");

            let error = build_launch_plan(
                &root,
                &DebugLaunchTarget::NodeNpmScript {
                    script: "dev".to_string(),
                    package_root_path: root.to_string_lossy().to_string(),
                    args: vec![],
                    cwd: None,
                    env: HashMap::new(),
                    just_my_code: None,
                },
            )
            .expect_err("npm lifecycle hooks must fail closed");

            assert_eq!(error, NPM_SCRIPT_LIFECYCLE_ERROR);
            assert!(!error.contains(hook));
            assert!(!error.contains("private.js"));
        }
    }

    #[test]
    fn npm_rejects_direct_typescript_until_emitted_source_resolution_is_supported() {
        let root = fixture("npm-typescript");
        write(
            &root.join("package.json"),
            r#"{"scripts":{"dev":"node src/server.ts"}}"#,
        );
        write(&root.join("src/server.ts"), "console.log('server');");
        let error = build_launch_plan(
            &root,
            &DebugLaunchTarget::NodeNpmScript {
                script: "dev".to_string(),
                package_root_path: root.to_string_lossy().to_string(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                just_my_code: None,
            },
        )
        .expect_err("TypeScript direct npm entry is not supported");
        assert!(error.contains("JavaScript (.js, .mjs, .cjs)"));
    }
}
