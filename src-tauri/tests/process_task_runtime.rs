#![cfg(unix)]
#![allow(dead_code)]

use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

mod managed_javascript_typescript {
    pub(crate) fn node_executable_path() -> Option<String> {
        None
    }
}

#[path = "../src/effective_executable_environment.rs"]
mod effective_executable_environment;

#[path = "../src/node_package_problem_matcher.rs"]
mod node_package_problem_matcher;
mod node_package_scripts {
    use super::*;
    use crate::node_package_problem_matcher::NodePackageTaskOutputStream;

    #[derive(Clone, Debug)]
    pub(crate) enum NodePackageTaskLaunchTarget {
        WorkspaceRoot {},
    }

    #[derive(Clone, Debug)]
    pub(crate) struct RunNodePackageScriptRequest {
        pub workspace_id: workspace_registry::WorkspaceId,
        pub session_id: u64,
        pub manifest_relative_path: String,
        pub repository_root: String,
        pub script_name: String,
        pub target: NodePackageTaskLaunchTarget,
    }

    pub(crate) trait NodePackageTaskOutputObserver: Send + Sync + 'static {
        fn prepare(
            &self,
            workspace_root: &File,
            workspace_path: &Path,
            package_directory: &File,
            package_path: &Path,
        ) -> Result<(), String>;
        fn observe(&self, stream: NodePackageTaskOutputStream, bytes: &[u8]);
        fn finish(&self, stream: NodePackageTaskOutputStream);
        fn finish_task(&self, preserve_problems: bool);
    }

    pub(crate) struct SpawnedNodePackageTask;

    pub(crate) fn preflight_vscode_node_package_task(
        _registry: &workspace_registry::WorkspaceRegistry,
        request: &RunNodePackageScriptRequest,
        _expected_workspace_root: &Path,
    ) -> Result<(), String> {
        if request.script_name == "preflight-failure" {
            return Err("npm preflight port exercised".to_string());
        }
        Ok(())
    }

    pub(crate) fn spawn_vscode_node_package_task_with_effective_path(
        _registry: &workspace_registry::WorkspaceRegistry,
        _trust: &Mutex<trust::WorkspaceTrustService>,
        _terminals: &terminal_session::TerminalSupervisor,
        request: &RunNodePackageScriptRequest,
        _output_observer: Arc<dyn NodePackageTaskOutputObserver>,
        _expected_workspace_root: &Path,
        _effective_path: effective_executable_environment::EffectiveExecutablePath<'_>,
    ) -> Result<SpawnedNodePackageTask, String> {
        Err(format!(
            "npm spawn port exercised for {}:{}:{}:{}",
            request.workspace_id.0,
            request.session_id,
            request.manifest_relative_path,
            request.script_name
        ))
    }
}
#[path = "../src/process_task_plan.rs"]
mod process_task_plan;
#[path = "../src/process_task_resolver.rs"]
mod process_task_resolver;
#[path = "../src/vscode_process_tasks.rs"]
mod vscode_process_tasks;
#[path = "../src/vscode_tasks_discovery.rs"]
mod vscode_tasks_discovery;

mod terminal {
    pub(crate) trait TerminalEventSink: Send + Sync {}
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

mod workspace_registry {
    use super::*;

    #[derive(Clone, Debug)]
    pub struct WorkspaceId(pub String);

    #[derive(Clone, Debug)]
    pub struct ManagedWorkspaceDescriptor {
        pub workspace_id: WorkspaceId,
        pub selected_root_path: PathBuf,
        pub canonical_root_path: PathBuf,
    }

    pub struct WorkspaceRegistry {
        descriptor: ManagedWorkspaceDescriptor,
        operations: Mutex<()>,
        remove_root_on_clone: Option<usize>,
        root_clone_count: AtomicUsize,
    }

    impl WorkspaceRegistry {
        pub fn new(root: PathBuf) -> Self {
            Self {
                descriptor: ManagedWorkspaceDescriptor {
                    workspace_id: WorkspaceId("workspace".to_string()),
                    selected_root_path: root.clone(),
                    canonical_root_path: root,
                },
                operations: Mutex::new(()),
                remove_root_on_clone: None,
                root_clone_count: AtomicUsize::new(0),
            }
        }

        pub fn removing_root_on_clone(root: PathBuf, clone_number: usize) -> Self {
            Self {
                remove_root_on_clone: Some(clone_number),
                ..Self::new(root)
            }
        }

        pub(crate) fn lock_operations(&self) -> io::Result<MutexGuard<'_, ()>> {
            self.operations
                .lock()
                .map_err(|error| io::Error::other(error.to_string()))
        }

        pub fn descriptor(
            &self,
            workspace_id: &WorkspaceId,
        ) -> io::Result<ManagedWorkspaceDescriptor> {
            if workspace_id.0 != self.descriptor.workspace_id.0 {
                return Err(io::Error::new(io::ErrorKind::NotFound, "unknown"));
            }
            Ok(self.descriptor.clone())
        }

        pub fn open_descendant(
            &self,
            workspace_id: &WorkspaceId,
            relative_path: &Path,
        ) -> io::Result<File> {
            self.descriptor(workspace_id)?;
            if relative_path
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
            {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "unsafe path"));
            }
            File::open(self.descriptor.canonical_root_path.join(relative_path))
        }

        pub(crate) fn clone_root(&self, workspace_id: &WorkspaceId) -> io::Result<File> {
            self.descriptor(workspace_id)?;
            let root = File::open(&self.descriptor.canonical_root_path)?;
            let clone_number = self.root_clone_count.fetch_add(1, Ordering::Relaxed) + 1;
            if self.remove_root_on_clone == Some(clone_number) {
                fs::remove_dir_all(&self.descriptor.canonical_root_path)?;
            }
            Ok(root)
        }
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn opened_root_path(file: &File) -> io::Result<PathBuf> {
        let path = fs::read_link(format!(
            "/proc/self/fd/{}",
            std::os::fd::AsRawFd::as_raw_fd(file)
        ))?;
        if !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "not a directory",
            ));
        }
        Ok(path)
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn opened_root_path(file: &File) -> io::Result<PathBuf> {
        opened_path(file)
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn opened_regular_file_path(file: &File) -> io::Result<PathBuf> {
        let path = fs::read_link(format!(
            "/proc/self/fd/{}",
            std::os::fd::AsRawFd::as_raw_fd(file)
        ))?;
        if !path.is_file() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"));
        }
        Ok(path)
    }

    pub(crate) fn open_file_relative_to(root: &File, relative_path: &Path) -> io::Result<File> {
        File::open(opened_root_path(root)?.join(relative_path))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn opened_regular_file_path(file: &File) -> io::Result<PathBuf> {
        opened_path(file)
    }

    #[cfg(target_os = "macos")]
    fn opened_path(file: &File) -> io::Result<PathBuf> {
        use std::os::fd::AsRawFd;
        use std::os::unix::ffi::OsStringExt;

        let mut path = vec![0_u8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, path.as_mut_ptr()) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let end = path
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "unterminated path"))?;
        Ok(PathBuf::from(std::ffi::OsString::from_vec(
            path[..end].to_vec(),
        )))
    }
}

mod trust {
    pub struct WorkspaceTrustState {
        pub trusted: bool,
    }

    pub struct WorkspaceTrustService {
        pub trusted: bool,
    }

    impl WorkspaceTrustService {
        pub fn get(&self, _root_path: &str) -> WorkspaceTrustState {
            WorkspaceTrustState {
                trusted: self.trusted,
            }
        }
    }
}

mod terminal_session {
    use super::*;
    use crate::{terminal::TerminalEventSink, terminal_task_process::TerminalTaskOwnership};

    struct Sink;
    impl TerminalEventSink for Sink {}

    pub struct TerminalSupervisor {
        pub expected_session: u64,
        pub expected_root: PathBuf,
    }

    impl TerminalSupervisor {
        pub(crate) fn task_sink(
            &self,
            session_id: u64,
            expected_workspace_root: &Path,
        ) -> Result<Arc<dyn TerminalEventSink>, String> {
            if session_id != self.expected_session || expected_workspace_root != self.expected_root
            {
                return Err("wrong terminal owner".to_string());
            }
            Ok(Arc::new(Sink))
        }

        pub(crate) fn register_task_process_group(
            &self,
            session_id: u64,
            expected_workspace_root: &Path,
            _process_group_id: i32,
        ) -> Result<TerminalTaskOwnership, String> {
            self.task_sink(session_id, expected_workspace_root)?;
            Ok(TerminalTaskOwnership)
        }

        pub(crate) fn unregister_task(&self, _ownership: &TerminalTaskOwnership) {}
    }
}

#[path = "../src/process_task_runtime.rs"]
mod process_task_runtime;

use process_task_plan::{ProcessTaskExecutionPlan, ProcessTaskProgramKind};
use process_task_resolver::{resolve_process_task_plan, ProcessTaskPlanError};
use process_task_runtime::{
    finish_process_task, production_process_task_environment_policy, spawn_process_task,
    ProcessTaskOwner, ProcessTaskRuntime, SpawnProcessTaskRequest, SpawnedRuntimeTask,
    WorkspaceRegistryProcessTaskResolver,
};
use std::collections::BTreeMap;
use std::io::Read;
use terminal_session::TerminalSupervisor;
use trust::WorkspaceTrustService;
use workspace_registry::WorkspaceRegistry;

struct MultiFileDiscoveryReader {
    files: BTreeMap<String, Vec<u8>>,
}

impl vscode_tasks_discovery::RetainedWorkspaceFileReader for MultiFileDiscoveryReader {
    fn list_registered_workspace_task_files(
        &self,
        _workspace_id: &str,
        _maximum_manifests: usize,
    ) -> vscode_tasks_discovery::RetainedWorkspaceTaskFilesRead {
        vscode_tasks_discovery::RetainedWorkspaceTaskFilesRead::Files {
            files: self
                .files
                .keys()
                .map(|source| {
                    let package = source.strip_suffix("/.vscode/tasks.json").unwrap_or(".");
                    vscode_tasks_discovery::RetainedWorkspaceTaskFile {
                        package_root_relative_path: package.to_string(),
                        source: source.clone(),
                    }
                })
                .collect(),
            truncated: false,
        }
    }

    fn read_registered_workspace_file(
        &self,
        _workspace_id: &str,
        relative_path: &str,
        _maximum_bytes: usize,
    ) -> vscode_tasks_discovery::RetainedWorkspaceFileRead {
        self.files
            .get(relative_path)
            .cloned()
            .map(vscode_tasks_discovery::RetainedWorkspaceFileRead::Content)
            .unwrap_or(vscode_tasks_discovery::RetainedWorkspaceFileRead::Missing)
    }
}

struct AcceptingDiscoveryResolver;

impl vscode_tasks_discovery::VscodeProcessTaskPlanResolver for AcceptingDiscoveryResolver {
    fn resolve(
        &self,
        _workspace_id: &str,
        _package_root_relative_path: &str,
        _config_revision: &str,
        _task: &vscode_process_tasks::ValidatedProcessTask,
    ) -> vscode_tasks_discovery::ProcessTaskPlanResolution {
        vscode_tasks_discovery::ProcessTaskPlanResolution::Executable
    }
}

fn fixture_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "codevo-process-task-runtime-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join(".vscode")).unwrap();
    root.canonicalize().unwrap()
}

fn tasks_bytes(command: &str) -> Vec<u8> {
    format!(
        r#"{{"version":"2.0.0","tasks":[{{"label":"test","type":"process","command":"{command}"}}]}}"#
    )
    .into_bytes()
}

#[test]
fn authoritative_task_revision_attaches_only_a_supported_problem_matcher() {
    let root = fixture_root("problem-matcher");
    let executable = root.join("task");
    fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    let bytes = br#"{"version":"2.0.0","tasks":[{"label":"test","type":"process","command":"./task","problemMatcher":"$tsc"}]}"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();

    let registry = WorkspaceRegistry::new(root.clone());
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trust = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: registry
                .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
                .unwrap()
                .workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "test".to_string(),
        package_root_relative_path: ".".to_string(),
    };
    let SpawnedRuntimeTask::Process(mut spawned) =
        ProcessTaskRuntime::new(&registry, &trust, &terminals)
            .prepare_and_spawn(&request)
            .expect("spawn supported matcher task")
    else {
        panic!("expected process task");
    };
    assert!(spawned.problem_matcher.is_some());
    assert!(finish_process_task(&terminals, &mut spawned)
        .expect("finish matcher task")
        .success());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn package_owned_revision_starts_from_the_package_configuration() {
    let root = fixture_root("package-owned-revision");
    let package = root.join("packages/api");
    fs::create_dir_all(package.join(".vscode")).unwrap();
    let executable = package.join("task");
    fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    let root_bytes = tasks_bytes("/usr/bin/true");
    let package_bytes = br#"{"version":"2.0.0","tasks":[{"label":"test","type":"process","command":"${workspaceFolder}/packages/api/task","options":{"cwd":"${workspaceFolder}"}}]}"#;
    fs::write(root.join(".vscode/tasks.json"), root_bytes).unwrap();
    fs::write(package.join(".vscode/tasks.json"), package_bytes).unwrap();
    let discovery = vscode_tasks_discovery::VscodeTasksDiscoveryService::new(
        &MultiFileDiscoveryReader {
            files: BTreeMap::from([
                (
                    ".vscode/tasks.json".to_string(),
                    tasks_bytes("/usr/bin/true"),
                ),
                (
                    "packages/api/.vscode/tasks.json".to_string(),
                    package_bytes.to_vec(),
                ),
            ]),
        },
        &AcceptingDiscoveryResolver,
    )
    .discover(vscode_tasks_discovery::VscodeTasksDiscoveryRequest {
        workspace_id: "workspace".to_string(),
    });
    let selected = discovery
        .tasks
        .iter()
        .find(|task| task.package == "packages/api" && task.label == "test")
        .expect("discover package-owned task");
    let registry = WorkspaceRegistry::new(root.clone());
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trust = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: registry
                .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
                .unwrap()
                .workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: selected.config_revision.clone(),
        label: selected.label.clone(),
        package_root_relative_path: selected.package.clone(),
    };

    let SpawnedRuntimeTask::Process(mut spawned) =
        ProcessTaskRuntime::new(&registry, &trust, &terminals)
            .prepare_and_spawn(&request)
            .expect("start package-owned task")
    else {
        panic!("expected process task");
    };
    assert!(finish_process_task(&terminals, &mut spawned)
        .expect("finish package-owned task")
        .success());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn npm_execution_branch_uses_the_package_spawn_port_in_tests() {
    let root = fixture_root("npm-runtime-port");
    let package = root.join("packages/api");
    fs::create_dir_all(package.join(".vscode")).unwrap();
    let bytes = br#"{"version":"2.0.0","tasks":[{"label":"test","type":"npm","script":"build"}]}"#;
    fs::write(package.join(".vscode/tasks.json"), bytes).unwrap();
    let registry = WorkspaceRegistry::new(root.clone());
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trust = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: registry
                .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
                .unwrap()
                .workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "test".to_string(),
        package_root_relative_path: "packages/api".to_string(),
    };

    let error =
        match ProcessTaskRuntime::new(&registry, &trust, &terminals).prepare_and_spawn(&request) {
            Ok(_) => panic!("mock npm port must identify the branch"),
            Err(error) => error,
        };
    assert!(
        error.contains("npm spawn port exercised for workspace:7:packages/api/package.json:build")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn supported_matcher_fails_closed_when_retained_root_disappears_before_construction() {
    let root = fixture_root("problem-matcher-retained-root");
    let executable = root.join("task");
    let marker = root.join("spawned");
    fs::write(
        &executable,
        format!("#!/bin/sh\n/usr/bin/touch '{}'\n", marker.display()),
    )
    .unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    let bytes = br#"{"version":"2.0.0","tasks":[{"label":"test","type":"process","command":"./task","problemMatcher":"$tsc"}]}"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();

    let registry = WorkspaceRegistry::removing_root_on_clone(root.clone(), 3);
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trust = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: registry
                .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
                .unwrap()
                .workspace_id,
            workspace_root: root,
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "test".to_string(),
        package_root_relative_path: ".".to_string(),
    };

    let error =
        match ProcessTaskRuntime::new(&registry, &trust, &terminals).prepare_and_spawn(&request) {
            Ok(_) => panic!("supported matcher must fail closed"),
            Err(error) => error,
        };
    assert!(error.contains("InvalidPath(\"workspace root\")"));
    assert!(!marker.exists());
}

#[test]
fn all_owner_checks_fail_before_the_process_is_spawned() {
    let root = fixture_root("authority");
    let marker = root.join("spawned");
    let executable = root.join("task");
    fs::write(
        &executable,
        format!("#!/bin/sh\n/usr/bin/touch '{}'\n", marker.display()),
    )
    .unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    let bytes = tasks_bytes("./task");
    fs::write(root.join(".vscode/tasks.json"), &bytes).unwrap();

    let registry = WorkspaceRegistry::new(root.clone());
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let revision = vscode_process_tasks::vscode_tasks_config_revision(&bytes);
    let base = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: registry
                .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
                .unwrap()
                .workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: revision,
        label: "test".to_string(),
        package_root_relative_path: ".".to_string(),
    };

    let untrusted = Mutex::new(WorkspaceTrustService { trusted: false });
    assert!(ProcessTaskRuntime::new(&registry, &untrusted, &terminals)
        .prepare_and_spawn(&base)
        .is_err());

    let trusted = Mutex::new(WorkspaceTrustService { trusted: true });
    let mut wrong_root = base.clone();
    wrong_root.owner.workspace_root = root.join("other");
    assert!(ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .prepare_and_spawn(&wrong_root)
        .is_err());
    let mut wrong_revision = base.clone();
    wrong_revision.config_revision = "sha256:stale".to_string();
    assert!(ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .prepare_and_spawn(&wrong_revision)
        .is_err());
    let mut wrong_label = base.clone();
    wrong_label.label = "missing".to_string();
    assert!(ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .prepare_and_spawn(&wrong_label)
        .is_err());
    let mut wrong_session = base;
    wrong_session.owner.terminal_session_id = 8;
    assert!(ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .prepare_and_spawn(&wrong_session)
        .is_err());

    assert!(!marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn backend_reparses_and_rejects_a_non_executable_dependency_graph() {
    let root = fixture_root("dependency-graph");
    let marker = root.join("spawned");
    let executable = root.join("task");
    fs::write(
        &executable,
        format!("#!/bin/sh\n/usr/bin/touch '{}'\n", marker.display()),
    )
    .unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[{
        "label":"test",
        "type":"process",
        "command":"./task",
        "dependsOn":"missing",
        "dependsOrder":"sequence"
      }]
    }"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();

    let registry = WorkspaceRegistry::new(root.clone());
    let descriptor = registry
        .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
        .unwrap();
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: descriptor.workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "test".to_string(),
        package_root_relative_path: ".".to_string(),
    };
    let trusted = Mutex::new(WorkspaceTrustService { trusted: true });

    let error = match ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .prepare_and_spawn(&request)
    {
        Ok(_) => panic!("invalid dependency graph must not spawn"),
        Err(error) => error,
    };
    assert!(error.contains("no longer exists"));
    assert!(!marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resolves_postorder_chain_and_revalidates_revision_before_each_step() {
    use std::os::unix::fs::PermissionsExt;

    let root = fixture_root("sequential-chain");
    for executable in ["dependency", "target"] {
        let path = root.join(executable);
        fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"dependency","type":"process","command":"./dependency"},
        {"label":"target","type":"process","command":"./target","dependsOn":"dependency","dependsOrder":"sequence"}
      ]
    }"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();
    let registry = WorkspaceRegistry::new(root.clone());
    let descriptor = registry
        .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
        .unwrap();
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trusted = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: descriptor.workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "target".to_string(),
        package_root_relative_path: ".".to_string(),
    };
    let runtime = ProcessTaskRuntime::new(&registry, &trusted, &terminals);

    assert_eq!(
        runtime.resolve_chain_labels(&request).unwrap(),
        ["dependency", "target"]
    );

    let changed = bytes
        .iter()
        .copied()
        .chain(std::iter::once(b' '))
        .collect::<Vec<_>>();
    fs::write(root.join(".vscode/tasks.json"), changed).unwrap();
    assert!(runtime.prepare_and_spawn(&request).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn chain_preflight_rejects_a_later_unsafe_step_before_any_process_can_spawn() {
    use std::os::unix::fs::PermissionsExt;

    let root = fixture_root("chain-preflight");
    let marker = root.join("dependency-spawned");
    let dependency = root.join("dependency");
    fs::write(
        &dependency,
        format!("#!/bin/sh\n/usr/bin/touch '{}'\n", marker.display()),
    )
    .unwrap();
    fs::set_permissions(&dependency, fs::Permissions::from_mode(0o700)).unwrap();
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"dependency","type":"process","command":"./dependency"},
        {"label":"target","type":"process","command":"unsupported-command","dependsOn":"dependency","dependsOrder":"sequence"}
      ]
    }"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();
    let registry = WorkspaceRegistry::new(root.clone());
    let descriptor = registry
        .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
        .unwrap();
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trusted = Mutex::new(WorkspaceTrustService { trusted: true });
    let request = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: descriptor.workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "target".to_string(),
        package_root_relative_path: ".".to_string(),
    };

    assert!(ProcessTaskRuntime::new(&registry, &trusted, &terminals)
        .resolve_chain_labels(&request)
        .is_err());
    assert!(!marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_revision_between_steps_prevents_the_next_child_from_spawning() {
    use std::os::unix::fs::PermissionsExt;

    let root = fixture_root("chain-revision-race");
    let target_marker = root.join("target-spawned");
    for (name, body) in [
        ("dependency", "#!/bin/sh\nexit 0\n".to_string()),
        (
            "target",
            format!("#!/bin/sh\n/usr/bin/touch '{}'\n", target_marker.display()),
        ),
    ] {
        let executable = root.join(name);
        fs::write(&executable, body).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let bytes = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"dependency","type":"process","command":"./dependency"},
        {"label":"target","type":"process","command":"./target","dependsOn":"dependency","dependsOrder":"sequence"}
      ]
    }"#;
    fs::write(root.join(".vscode/tasks.json"), bytes).unwrap();
    let registry = WorkspaceRegistry::new(root.clone());
    let descriptor = registry
        .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
        .unwrap();
    let terminals = TerminalSupervisor {
        expected_session: 7,
        expected_root: root.clone(),
    };
    let trusted = Mutex::new(WorkspaceTrustService { trusted: true });
    let base = SpawnProcessTaskRequest {
        owner: ProcessTaskOwner {
            workspace_id: descriptor.workspace_id,
            workspace_root: root.clone(),
            terminal_session_id: 7,
        },
        config_revision: vscode_process_tasks::vscode_tasks_config_revision(bytes),
        label: "target".to_string(),
        package_root_relative_path: ".".to_string(),
    };
    let runtime = ProcessTaskRuntime::new(&registry, &trusted, &terminals);
    assert_eq!(
        runtime.resolve_chain_labels(&base).unwrap(),
        ["dependency", "target"]
    );
    let mut dependency = base.clone();
    dependency.label = "dependency".to_string();
    let SpawnedRuntimeTask::Process(mut spawned) = runtime.prepare_and_spawn(&dependency).unwrap()
    else {
        panic!("expected process task");
    };
    assert!(finish_process_task(&terminals, &mut spawned)
        .unwrap()
        .success());

    fs::write(
        root.join(".vscode/tasks.json"),
        bytes
            .iter()
            .copied()
            .chain(std::iter::once(b' '))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(runtime.prepare_and_spawn(&base).is_err());
    assert!(!target_marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn passes_arguments_literally_without_a_shell() {
    let root = fixture_root("literal-argv");
    let marker = root.join("must-not-exist");
    let literal = format!("hello; /usr/bin/touch {}", marker.display());
    let plan = ProcessTaskExecutionPlan::new(
        PathBuf::from("/usr/bin/printf"),
        ProcessTaskProgramKind::WorkspaceExecutable,
        vec!["%s".to_string(), literal.clone()],
        root.clone(),
        BTreeMap::new(),
    );
    let mut child = spawn_process_task(&plan).unwrap();
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    assert!(child.wait().unwrap().success());
    assert_eq!(output, literal);
    assert!(!marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn production_environment_never_forwards_node_options() {
    let bytes = br#"{"version":"2.0.0","tasks":[{"label":"test","type":"process","command":"node","options":{"env":{"PORT":"4100"}}}]}"#;
    let config = vscode_process_tasks::VscodeTasksParser::parse(bytes).unwrap();
    let policy = production_process_task_environment_policy(&config.tasks[0]);
    assert!(policy.allowed_explicit_keys.contains("PORT"));
    assert!(!policy.inherited_baseline.contains_key("NODE_OPTIONS"));
    assert!(policy
        .inherited_baseline
        .keys()
        .all(|key| matches!(key.as_str(), "HOME" | "PATH" | "TMPDIR" | "SystemRoot")));

    let root = fixture_root("node-options");
    let mut environment = BTreeMap::new();
    environment.insert(
        "NODE_OPTIONS".to_string(),
        "--require=untrusted".to_string(),
    );
    let plan = ProcessTaskExecutionPlan::new(
        PathBuf::from("/usr/bin/env"),
        ProcessTaskProgramKind::WorkspaceExecutable,
        Vec::new(),
        root.clone(),
        environment,
    );
    let mut child = spawn_process_task(&plan).unwrap();
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    assert!(child.wait().unwrap().success());
    assert!(!output.lines().any(|line| line.starts_with("NODE_OPTIONS=")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn accepts_internal_executable_symlink_and_rejects_external_target() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};

    let root = fixture_root("symlinks");
    fs::create_dir_all(root.join("node_modules/.bin")).unwrap();
    fs::create_dir_all(root.join("tools")).unwrap();
    let internal = root.join("tools/runner");
    fs::write(&internal, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&internal, fs::Permissions::from_mode(0o700)).unwrap();
    symlink("../../tools/runner", root.join("node_modules/.bin/runner")).unwrap();

    let outside = root.with_extension("outside-runner");
    fs::write(&outside, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&outside, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(&outside, root.join("node_modules/.bin/outside")).unwrap();

    let registry = WorkspaceRegistry::new(root.clone());
    let descriptor = registry
        .descriptor(&workspace_registry::WorkspaceId("workspace".into()))
        .unwrap();
    let resolver = WorkspaceRegistryProcessTaskResolver::new(&registry, descriptor);
    let internal_task = process_task_plan::ProcessTaskDefinition {
        command: "runner".to_string(),
        args: Vec::new(),
        cwd: None,
        env: BTreeMap::new(),
    };
    let empty_policy = process_task_plan::ProcessTaskEnvironmentPolicy {
        allowed_explicit_keys: Default::default(),
        inherited_baseline: Default::default(),
    };
    let plan = resolve_process_task_plan(&internal_task, &empty_policy, &resolver).unwrap();
    assert_eq!(plan.program(), internal);

    let external_task = process_task_plan::ProcessTaskDefinition {
        command: "outside".to_string(),
        ..internal_task
    };
    assert!(matches!(
        resolve_process_task_plan(&external_task, &empty_policy, &resolver),
        Err(ProcessTaskPlanError::WorkspaceEscape(_))
    ));
    fs::remove_file(outside).unwrap();
    fs::remove_dir_all(root).unwrap();
}
