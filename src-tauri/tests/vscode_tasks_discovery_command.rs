#![cfg(any(target_os = "macos", target_os = "linux"))]
#![allow(dead_code)]

use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::{Arc, Mutex},
};

pub(crate) async fn run_blocking_command<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    work()
}

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
        pub(crate) fn terminate(&self) {}

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

mod node_package_scripts {
    use super::*;
    use crate::node_package_problem_matcher::NodePackageTaskOutputStream;

    #[derive(Clone, Debug)]
    pub(crate) struct RunNodePackageScriptRequest {
        pub workspace_id: workspace_registry::WorkspaceId,
        pub session_id: u64,
        pub manifest_relative_path: String,
        pub script_name: String,
    }

    pub(crate) trait NodePackageTaskOutputObserver: Send + Sync + 'static {
        fn prepare(
            &self,
            workspace_root: &fs::File,
            workspace_path: &Path,
            package_directory: &fs::File,
            package_path: &Path,
        ) -> Result<(), String>;
        fn observe(&self, stream: NodePackageTaskOutputStream, bytes: &[u8]);
        fn finish(&self, stream: NodePackageTaskOutputStream);
        fn finish_task(&self, preserve_problems: bool);
    }

    pub(crate) struct SpawnedNodePackageTask;

    pub(crate) fn preflight_vscode_node_package_task(
        _registry: &workspace_registry::WorkspaceRegistry,
        _request: &RunNodePackageScriptRequest,
        _expected_workspace_root: &Path,
    ) -> Result<(), String> {
        Err("not used by discovery".to_string())
    }

    pub(crate) fn spawn_vscode_node_package_task(
        _registry: &workspace_registry::WorkspaceRegistry,
        _trust: &Mutex<trust::WorkspaceTrustService>,
        _terminals: &terminal_session::TerminalSupervisor,
        _request: &RunNodePackageScriptRequest,
        _output_observer: Arc<dyn NodePackageTaskOutputObserver>,
        _expected_workspace_root: &Path,
    ) -> Result<SpawnedNodePackageTask, String> {
        Err("not used by discovery".to_string())
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
use std::{sync::mpsc, thread, time::Duration};
use trust::WorkspaceTrustService;
use vscode_tasks_discovery::VscodeTasksDiscoveryRequest;
use vscode_tasks_discovery_command::{
    discover_registered_vscode_process_tasks,
    discover_registered_vscode_process_tasks_with_crawl_hook,
};
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
    assert_eq!(response["tasks"][0]["executable"], true, "{response}");
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

#[test]
fn symlinked_package_config_is_reported_instead_of_silently_filtered() {
    let fixture = Fixture::new("symlink-package-config", true);
    fs::create_dir_all(fixture.root.join("packages/api/.vscode")).unwrap();
    fs::write(
        fixture.root.join("packages/api/package.json"),
        r#"{"name":"api"}"#,
    )
    .unwrap();
    let outside_config = fixture.outside.join("api-tasks.json");
    fs::write(
        &outside_config,
        r#"{"version":"2.0.0","tasks":[{"label":"bad","type":"process","command":"node"}]}"#,
    )
    .unwrap();
    symlink(
        outside_config,
        fixture.root.join("packages/api/.vscode/tasks.json"),
    )
    .unwrap();

    let response = fixture.discover();

    assert!(response["tasks"].as_array().unwrap().is_empty());
    let diagnostic = response["diagnostics"][0]["message"].as_str().unwrap();
    assert!(diagnostic.contains("packages/api/.vscode/tasks.json"));
    assert!(diagnostic.contains("retained workspace"));
    assert!(!diagnostic.contains("No .vscode/tasks.json"));
}

#[test]
fn unreadable_package_config_does_not_suppress_other_package_tasks() {
    let fixture = Fixture::new("mixed-unreadable-package-config", true);
    fs::create_dir_all(fixture.root.join("packages/api/.vscode")).unwrap();
    fs::create_dir_all(fixture.root.join("packages/web/.vscode")).unwrap();
    fs::write(
        fixture.root.join("packages/api/package.json"),
        r#"{"name":"api"}"#,
    )
    .unwrap();
    fs::write(
        fixture.root.join("packages/web/package.json"),
        r#"{"name":"web"}"#,
    )
    .unwrap();
    fs::write(
        fixture.root.join("packages/web/.vscode/tasks.json"),
        r#"{"version":"2.0.0","tasks":[{"label":"build","type":"process","command":"node"}]}"#,
    )
    .unwrap();
    let outside_config = fixture.outside.join("api-tasks.json");
    fs::write(
        &outside_config,
        r#"{"version":"2.0.0","tasks":[{"label":"bad","type":"process","command":"node"}]}"#,
    )
    .unwrap();
    symlink(
        outside_config,
        fixture.root.join("packages/api/.vscode/tasks.json"),
    )
    .unwrap();

    let response = fixture.discover();

    assert_eq!(response["tasks"].as_array().unwrap().len(), 1, "{response}");
    assert_eq!(response["tasks"][0]["package"], "packages/web");
    assert_eq!(response["tasks"][0]["label"], "build");
    assert!(response["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|diagnostic| diagnostic["message"]
            .as_str()
            .is_some_and(|message| message.contains("packages/api/.vscode/tasks.json"))));
}

#[test]
fn registry_operation_lock_is_free_while_discovery_crawls() {
    let fixture = Fixture::new("crawl-lock-scope", true);
    fs::write(
        fixture.root.join(".vscode/tasks.json"),
        r#"{"version":"2.0.0","tasks":[]}"#,
    )
    .unwrap();
    let (crawl_entered_sender, crawl_entered_receiver) = mpsc::sync_channel(0);
    let (crawl_release_sender, crawl_release_receiver) = mpsc::sync_channel(0);
    let registry = &fixture.registry;
    thread::scope(|scope| {
        let trust = &fixture.trust;
        let workspace_id = fixture.workspace_id.clone();
        let discovery = scope.spawn(move || {
            let hook = || {
                crawl_entered_sender.send(()).unwrap();
                crawl_release_receiver.recv().unwrap();
            };
            discover_registered_vscode_process_tasks_with_crawl_hook(
                registry,
                trust,
                VscodeTasksDiscoveryRequest { workspace_id },
                &hook,
            )
        });
        crawl_entered_receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let operation = registry.lock_operations().unwrap();
        drop(operation);
        crawl_release_sender.send(()).unwrap();
        discovery.join().unwrap().unwrap();
    });
}
