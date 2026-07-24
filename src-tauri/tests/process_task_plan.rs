#[path = "../src/process_task_plan.rs"]
mod process_task_plan;
#[path = "../src/process_task_resolver.rs"]
mod process_task_resolver;

use process_task_plan::{
    ProcessTaskDefinition, ProcessTaskEnvironmentPolicy, ProcessTaskProgramKind,
};
use process_task_resolver::{
    resolve_process_task_plan, ProcessTaskPlanError, RetainedProcessTaskRootResolver,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Default)]
struct FakeResolver {
    directory_override: Option<PathBuf>,
    executable_override: Option<PathBuf>,
    root: Option<PathBuf>,
}

impl RetainedProcessTaskRootResolver for FakeResolver {
    fn canonical_root(&self) -> Result<PathBuf, ProcessTaskPlanError> {
        Ok(self
            .root
            .clone()
            .unwrap_or_else(|| PathBuf::from("/workspace")))
    }

    fn canonical_directory(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        Ok(self
            .directory_override
            .clone()
            .unwrap_or_else(|| candidate.to_path_buf()))
    }

    fn canonical_executable(&self, candidate: &Path) -> Result<PathBuf, ProcessTaskPlanError> {
        Ok(self
            .executable_override
            .clone()
            .unwrap_or_else(|| candidate.to_path_buf()))
    }

    fn backend_node_executable(&self) -> Result<PathBuf, ProcessTaskPlanError> {
        Ok(PathBuf::from("/managed/node"))
    }

    fn is_within_retained_root(&self, canonical_path: &Path) -> bool {
        canonical_path.starts_with(
            self.root
                .as_deref()
                .unwrap_or_else(|| Path::new("/workspace")),
        )
    }
}

#[test]
fn resolves_backend_node_with_literal_argv_and_exact_workspace_substitution() {
    let definition = task(
        "node",
        &[
            "$(\"not a shell\")",
            "; rm -rf nope",
            "'single quotes'",
            "\"double quotes\"",
            "${workspaceFolder}",
        ],
    );
    let plan = resolve_process_task_plan(&definition, &policy(&["PORT"]), &FakeResolver::default())
        .expect("plan");

    assert_eq!(plan.program(), Path::new("/managed/node"));
    assert_eq!(plan.program_kind(), &ProcessTaskProgramKind::BackendNode);
    assert_eq!(
        plan.args(),
        [
            "$(\"not a shell\")",
            "; rm -rf nope",
            "'single quotes'",
            "\"double quotes\"",
            "/workspace",
        ]
    );
    assert_eq!(plan.cwd(), Path::new("/workspace"));
}

#[test]
fn resolves_bare_workspace_tool_and_explicit_workspace_executable() {
    let tool =
        resolve_process_task_plan(&task("vitest", &[]), &policy(&[]), &FakeResolver::default())
            .expect("tool");
    assert_eq!(
        tool.program(),
        Path::new("/workspace/node_modules/.bin/vitest")
    );
    assert_eq!(tool.program_kind(), &ProcessTaskProgramKind::WorkspaceTool);

    let mut explicit = task("./scripts/run-tests", &[]);
    explicit.cwd = Some("packages/app".to_string());
    let executable = resolve_process_task_plan(&explicit, &policy(&[]), &FakeResolver::default())
        .expect("executable");
    assert_eq!(
        executable.program_kind(),
        &ProcessTaskProgramKind::WorkspaceExecutable
    );
    assert_eq!(executable.cwd(), Path::new("/workspace/packages/app"));

    let mut substituted = task(
        "${workspaceFolder}/bin/run-tests",
        &["--config=${workspaceFolder}/config/test.json"],
    );
    substituted.cwd = Some("${workspaceFolder}/packages/app".to_string());
    let plan = resolve_process_task_plan(&substituted, &policy(&[]), &FakeResolver::default())
        .expect("substituted executable");
    assert_eq!(plan.program(), Path::new("/workspace/bin/run-tests"));
    assert_eq!(plan.cwd(), Path::new("/workspace/packages/app"));
    assert_eq!(
        plan.args(),
        ["--config=/workspace/config/test.json".to_string()]
    );
}

#[test]
fn rejects_traversal_absolute_path_unknown_path_command_and_shells() {
    for command in [
        "../outside/tool",
        "/usr/bin/python",
        "/workspace/bin/raw-absolute",
        "C:\\Windows\\System32\\cmd.exe",
        "bash",
        "./tools/pwsh",
    ] {
        assert!(
            resolve_process_task_plan(&task(command, &[]), &policy(&[]), &FakeResolver::default())
                .is_err(),
            "{command}"
        );
    }

    let missing = FakeResolver {
        executable_override: Some(PathBuf::from("/outside/python")),
        ..FakeResolver::default()
    };
    assert!(matches!(
        resolve_process_task_plan(&task("python", &[]), &policy(&[]), &missing),
        Err(ProcessTaskPlanError::WorkspaceEscape("workspace tool"))
    ));
}

#[test]
fn rejects_canonical_directory_and_executable_symlink_escapes() {
    let escaped_directory = FakeResolver {
        directory_override: Some(PathBuf::from("/outside")),
        ..FakeResolver::default()
    };
    let mut definition = task("node", &[]);
    definition.cwd = Some("linked".to_string());
    assert!(matches!(
        resolve_process_task_plan(&definition, &policy(&[]), &escaped_directory),
        Err(ProcessTaskPlanError::WorkspaceEscape("working directory"))
    ));

    definition.cwd = Some("../outside".to_string());
    assert!(matches!(
        resolve_process_task_plan(&definition, &policy(&[]), &FakeResolver::default()),
        Err(ProcessTaskPlanError::InvalidPath("working directory"))
    ));

    let escaped_tool = FakeResolver {
        executable_override: Some(PathBuf::from("/outside/vitest")),
        ..FakeResolver::default()
    };
    assert!(matches!(
        resolve_process_task_plan(&task("vitest", &[]), &policy(&[]), &escaped_tool),
        Err(ProcessTaskPlanError::WorkspaceEscape("workspace tool"))
    ));

    assert!(matches!(
        resolve_process_task_plan(
            &task("${workspaceFolder}/bin/tool", &[]),
            &policy(&[]),
            &escaped_tool
        ),
        Err(ProcessTaskPlanError::WorkspaceEscape("command"))
    ));
}

#[test]
fn expands_workspace_folder_in_strings_and_rejects_every_other_substitution() {
    let expanded = resolve_process_task_plan(
        &task(
            "node",
            &[
                "prefix=${workspaceFolder}",
                "${workspaceFolder}:${workspaceFolder}",
            ],
        ),
        &policy(&[]),
        &FakeResolver::default(),
    )
    .expect("expanded arguments");
    assert_eq!(
        expanded.args(),
        ["prefix=/workspace", "/workspace:/workspace"]
    );

    for value in ["${HOME}", "${workspaceFolderX}", "${workspaceFolder"] {
        assert!(matches!(
            resolve_process_task_plan(
                &task("node", &[value]),
                &policy(&[]),
                &FakeResolver::default()
            ),
            Err(ProcessTaskPlanError::UnsupportedSubstitution(_))
        ));
    }

    let mut cwd = task("node", &[]);
    cwd.cwd = Some("${workspaceFolder}/src".to_string());
    let cwd_plan =
        resolve_process_task_plan(&cwd, &policy(&[]), &FakeResolver::default()).expect("cwd");
    assert_eq!(cwd_plan.cwd(), Path::new("/workspace/src"));

    let mut environment = task("node", &[]);
    environment
        .env
        .insert("VALUE".to_string(), "${HOME}".to_string());
    assert!(matches!(
        resolve_process_task_plan(&environment, &policy(&["VALUE"]), &FakeResolver::default()),
        Err(ProcessTaskPlanError::UnsupportedSubstitution(_))
    ));

    let long_root = FakeResolver {
        root: Some(PathBuf::from(format!("/{}", "w".repeat(17 * 1_024)))),
        ..FakeResolver::default()
    };
    assert!(matches!(
        resolve_process_task_plan(
            &task("node", &["${workspaceFolder}"]),
            &policy(&[]),
            &long_root
        ),
        Err(ProcessTaskPlanError::BoundsExceeded("argument"))
    ));
}

#[test]
fn applies_trusted_baseline_and_explicit_environment_allowlist() {
    let mut definition = task("node", &[]);
    definition
        .env
        .insert("PORT".to_string(), "4100".to_string());
    definition
        .env
        .insert("WORKSPACE".to_string(), "${workspaceFolder}".to_string());
    let mut environment_policy = policy(&["PORT", "WORKSPACE"]);
    environment_policy
        .inherited_baseline
        .insert("PATH".to_string(), "/managed/bin".to_string());
    environment_policy
        .inherited_baseline
        .insert("TMPDIR".to_string(), "/tmp".to_string());
    let plan =
        resolve_process_task_plan(&definition, &environment_policy, &FakeResolver::default())
            .expect("environment");

    assert_eq!(
        plan.env().get("PATH").map(String::as_str),
        Some("/managed/bin")
    );
    assert_eq!(plan.env().get("TMPDIR").map(String::as_str), Some("/tmp"));
    assert_eq!(plan.env().get("PORT").map(String::as_str), Some("4100"));
    assert_eq!(
        plan.env().get("WORKSPACE").map(String::as_str),
        Some("/workspace")
    );
}

#[test]
fn rejects_blocked_disallowed_duplicate_and_malformed_environment() {
    for key in [
        "PATH",
        "path",
        "NODE_OPTIONS",
        "SHELL",
        "COMSPEC",
        "PATHEXT",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "NPM_CONFIG_PREFIX",
    ] {
        let mut definition = task("node", &[]);
        definition.env.insert(key.to_string(), "unsafe".to_string());
        assert!(matches!(
            resolve_process_task_plan(&definition, &policy(&[key]), &FakeResolver::default()),
            Err(ProcessTaskPlanError::BlockedEnvironment(_))
        ));
    }

    let mut disallowed = task("node", &[]);
    disallowed
        .env
        .insert("SECRET".to_string(), "value".to_string());
    assert!(matches!(
        resolve_process_task_plan(&disallowed, &policy(&[]), &FakeResolver::default()),
        Err(ProcessTaskPlanError::DisallowedEnvironment(_))
    ));

    let mut duplicate = task("node", &[]);
    duplicate
        .env
        .insert("tmpdir".to_string(), "other".to_string());
    let mut duplicate_policy = policy(&["tmpdir"]);
    duplicate_policy
        .inherited_baseline
        .insert("TMPDIR".to_string(), "/tmp".to_string());
    assert!(matches!(
        resolve_process_task_plan(&duplicate, &duplicate_policy, &FakeResolver::default()),
        Err(ProcessTaskPlanError::InvalidEnvironment(_))
    ));
}

#[test]
fn enforces_argument_environment_and_text_limits() {
    let maximum_args = vec!["x".to_string(); 128];
    let mut accepted = task("node", &[]);
    accepted.args = maximum_args;
    assert!(resolve_process_task_plan(&accepted, &policy(&[]), &FakeResolver::default()).is_ok());

    let too_many = vec!["x".to_string(); 129];
    let mut definition = task("node", &[]);
    definition.args = too_many;
    assert!(matches!(
        resolve_process_task_plan(&definition, &policy(&[]), &FakeResolver::default()),
        Err(ProcessTaskPlanError::BoundsExceeded("arguments"))
    ));

    let oversized = "x".repeat(16 * 1_024 + 1);
    assert!(matches!(
        resolve_process_task_plan(
            &task("node", &[&oversized]),
            &policy(&[]),
            &FakeResolver::default()
        ),
        Err(ProcessTaskPlanError::BoundsExceeded("argument"))
    ));

    let mut maximum_environment = task("node", &[]);
    for index in 0..128 {
        maximum_environment
            .env
            .insert(format!("KEY_{index}"), "x".to_string());
    }
    let maximum_keys: Vec<String> = maximum_environment.env.keys().cloned().collect();
    let maximum_allowed = maximum_keys.iter().map(String::as_str).collect::<Vec<_>>();
    assert!(resolve_process_task_plan(
        &maximum_environment,
        &policy(&maximum_allowed),
        &FakeResolver::default()
    )
    .is_ok());

    let mut environment = task("node", &[]);
    for index in 0..129 {
        environment
            .env
            .insert(format!("KEY_{index}"), "x".to_string());
    }
    let keys: Vec<String> = environment.env.keys().cloned().collect();
    let allowed = keys.iter().map(String::as_str).collect::<Vec<_>>();
    assert!(matches!(
        resolve_process_task_plan(&environment, &policy(&allowed), &FakeResolver::default()),
        Err(ProcessTaskPlanError::BoundsExceeded("environment"))
    ));

    let nul = task("node", &["bad\0argument"]);
    assert!(matches!(
        resolve_process_task_plan(&nul, &policy(&[]), &FakeResolver::default()),
        Err(ProcessTaskPlanError::BoundsExceeded("argument"))
    ));
}

fn task(command: &str, args: &[&str]) -> ProcessTaskDefinition {
    ProcessTaskDefinition {
        args: args.iter().map(|value| (*value).to_string()).collect(),
        command: command.to_string(),
        cwd: None,
        env: BTreeMap::new(),
    }
}

fn policy(keys: &[&str]) -> ProcessTaskEnvironmentPolicy {
    ProcessTaskEnvironmentPolicy {
        allowed_explicit_keys: keys.iter().map(|key| (*key).to_string()).collect(),
        inherited_baseline: BTreeMap::new(),
    }
}
