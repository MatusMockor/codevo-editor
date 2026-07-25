#![cfg(any(target_os = "macos", target_os = "linux"))]
#![allow(dead_code)]

use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::{Arc, Mutex},
};

mod managed_javascript_typescript {
    pub(crate) fn node_executable_path() -> Option<String> {
        None
    }
}

mod terminal {
    pub trait TerminalEventSink: Send + Sync {}
}

mod terminal_task_process {
    use super::*;

    pub(crate) struct TerminalTaskOwnership;

    impl TerminalTaskOwnership {
        pub(crate) fn try_wait(&self, child: &mut Child) -> io::Result<Option<ExitStatus>> {
            child.try_wait()
        }

        pub(crate) fn wait_after_terminate(&self, child: &mut Child) -> io::Result<ExitStatus> {
            let _ = child.kill();
            child.wait()
        }
    }
}

mod terminal_session {
    use super::*;
    use crate::{terminal::TerminalEventSink, terminal_task_process::TerminalTaskOwnership};

    pub struct TerminalSupervisor;

    impl TerminalSupervisor {
        pub(crate) fn task_sink(
            &self,
            _session_id: u64,
            _expected_workspace_root: &Path,
        ) -> Result<Arc<dyn TerminalEventSink>, String> {
            Err("not used by discovery".to_string())
        }

        pub(crate) fn register_task_process_group(
            &self,
            _session_id: u64,
            _expected_workspace_root: &Path,
            _process_group_id: i32,
        ) -> Result<TerminalTaskOwnership, String> {
            Err("not used by discovery".to_string())
        }

        pub(crate) fn unregister_task(&self, _ownership: &TerminalTaskOwnership) {}
    }
}

fn registered_runtime_root(
    registry: &workspace_registry::WorkspaceRegistry,
    root_path: &str,
) -> PathBuf {
    registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map(|descriptor| descriptor.canonical_root_path)
        .unwrap_or_else(|_| PathBuf::from(root_path))
}

#[path = "../src/node_package_problem_matcher.rs"]
mod node_package_problem_matcher;
#[path = "../src/process_task_plan.rs"]
mod process_task_plan;
#[path = "../src/process_task_resolver.rs"]
mod process_task_resolver;
#[path = "../src/process_task_runtime.rs"]
mod process_task_runtime;
#[path = "../src/trust.rs"]
mod trust;
#[path = "../src/vscode_process_tasks.rs"]
mod vscode_process_tasks;
#[path = "../src/vscode_tasks_discovery.rs"]
mod vscode_tasks_discovery;
#[path = "../src/vscode_tasks_discovery_command.rs"]
mod vscode_tasks_discovery_command;
#[path = "../src/workspace_registry.rs"]
mod workspace_registry;

use serde_json::Value;
use std::os::unix::fs::{symlink, PermissionsExt};
use trust::WorkspaceTrustService;
use vscode_tasks_discovery::VscodeTasksDiscoveryRequest;
use vscode_tasks_discovery_command::discover_registered_vscode_process_tasks;
use workspace_registry::WorkspaceRegistry;

struct Fixture {
    outside: PathBuf,
    registry: WorkspaceRegistry,
    root: PathBuf,
    trust: Mutex<WorkspaceTrustService>,
    workspace_id: String,
}

impl Fixture {
    fn new(name: &str, trusted: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-vscode-discovery-{name}-{}",
            std::process::id()
        ));
        let outside = root.with_extension("outside");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(root.join(".vscode")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).unwrap();
        let trust_path = outside.join("trust.json");
        let mut trust = WorkspaceTrustService::load(trust_path).unwrap();
        if trusted {
            trust
                .set(root.to_str().expect("UTF-8 fixture"), true)
                .unwrap();
        }
        Self {
            outside,
            registry,
            root,
            trust: Mutex::new(trust),
            workspace_id: descriptor.workspace_id.as_str().to_string(),
        }
    }

    fn discover(&self) -> Value {
        serde_json::to_value(
            discover_registered_vscode_process_tasks(
                &self.registry,
                &self.trust,
                VscodeTasksDiscoveryRequest {
                    workspace_id: self.workspace_id.clone(),
                },
            )
            .unwrap(),
        )
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.registry.clear();
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_dir_all(&self.outside);
    }
}

#[test]
fn trusted_registered_workspace_resolves_real_internal_and_external_symlink_plans() {
    let fixture = Fixture::new("plans", true);
    fs::create_dir_all(fixture.root.join("node_modules/.bin")).unwrap();
    fs::create_dir_all(fixture.root.join("tools")).unwrap();
    let internal = fixture.root.join("tools/runner");
    fs::write(&internal, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&internal, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(
        "../../tools/runner",
        fixture.root.join("node_modules/.bin/runner"),
    )
    .unwrap();
    let external = fixture.outside.join("external-runner");
    fs::write(&external, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&external, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(&external, fixture.root.join("node_modules/.bin/external")).unwrap();
    fs::write(
        fixture.root.join(".vscode/tasks.json"),
        r#"{
          "version": "2.0.0",
          "tasks": [
            {"label":"internal","type":"process","command":"runner","group":"build"},
            {"label":"external","type":"process","command":"external","group":"test"}
          ]
        }"#,
    )
    .unwrap();

    let response = fixture.discover();
    assert!(response["configRevision"]
        .as_str()
        .is_some_and(|revision| revision.starts_with("sha256:")));
    assert_eq!(response["tasks"][0]["label"], "internal");
    assert_eq!(response["tasks"][0]["executable"], true);
    assert_eq!(response["tasks"][0]["detail"], Value::Null);
    assert_eq!(response["tasks"][0]["group"], "build");
    assert_eq!(response["tasks"][1]["label"], "external");
    assert_eq!(response["tasks"][1]["executable"], false);
    assert_eq!(response["tasks"][1]["group"], "test");
    assert_eq!(response["diagnostics"][0]["severity"], "warning");
}

#[test]
fn untrusted_missing_and_symlinked_config_are_explicit_fail_closed_responses() {
    let untrusted = Fixture::new("untrusted", false);
    fs::write(
        untrusted.root.join(".vscode/tasks.json"),
        r#"{"version":"2.0.0","tasks":[]}"#,
    )
    .unwrap();
    let response = untrusted.discover();
    assert!(response["tasks"].as_array().unwrap().is_empty());
    assert!(response["diagnostics"][0]["message"]
        .as_str()
        .unwrap()
        .contains("Trust"));

    let missing = Fixture::new("missing", true);
    let response = missing.discover();
    assert!(response["tasks"].as_array().unwrap().is_empty());
    assert!(response["diagnostics"][0]["message"]
        .as_str()
        .unwrap()
        .contains("No .vscode/tasks.json"));

    let symlinked = Fixture::new("symlink-config", true);
    let outside_config = symlinked.outside.join("tasks.json");
    fs::write(
        &outside_config,
        r#"{"version":"2.0.0","tasks":[{"label":"bad","type":"process","command":"node"}]}"#,
    )
    .unwrap();
    symlink(outside_config, symlinked.root.join(".vscode/tasks.json")).unwrap();
    let response = symlinked.discover();
    assert!(response["tasks"].as_array().unwrap().is_empty());
    assert!(response["diagnostics"][0]["message"]
        .as_str()
        .unwrap()
        .contains("retained workspace"));
}
