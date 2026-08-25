use crate::{
    canonicalize_workspace_root,
    debug_session_registry::{retain_workspace_root, RetainedDebugWorkspaceRoot},
    git_worktree::{
        agent_worktree_path, ensure_worktree_path_in_base, safe_agent_task_id,
        WORKTREE_BASE_DIR_NAME,
    },
    node_package_tasks::NodePackageTaskRegistry,
    terminal::{AppHandleTerminalEventSink, TerminalProfile, TerminalRuntimeStatus, TerminalSize},
    terminal_session::{
        LocalTerminalProfileProvider, PortablePtySpawner, TerminalLaunchRoots,
        TerminalProfileProvider, TerminalStartOptions, TerminalSupervisor,
    },
    trust::WorkspaceTrustService,
    workspace_registry::WorkspaceRegistry,
};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TerminalLaunchTarget {
    #[default]
    WorkspaceRoot,
    #[serde(rename_all = "camelCase")]
    AgentWorktree { thread_id: String },
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub const AGENT_WORKTREE_TERMINAL_UNSUPPORTED_ERROR: &str =
    "Starting a terminal in an agent worktree is not supported on this platform.";

pub const AGENT_WORKTREE_TERMINAL_MISSING_ERROR: &str = "The agent worktree no longer exists.";

pub const AGENT_WORKTREE_TERMINAL_SYMLINK_ERROR: &str =
    "The agent worktree must not be a symbolic link.";

struct TerminalLaunchDirectory {
    cwd: PathBuf,
    directory: File,
}

fn resolve_terminal_launch_root(
    workspace_root: &Path,
    target: &TerminalLaunchTarget,
) -> Result<PathBuf, String> {
    match target {
        TerminalLaunchTarget::WorkspaceRoot => Ok(workspace_root.to_path_buf()),
        TerminalLaunchTarget::AgentWorktree { thread_id } => {
            resolve_agent_worktree_launch_root(workspace_root, thread_id)
        }
    }
}

fn resolve_agent_worktree_launch_root(
    workspace_root: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    let thread_id = safe_agent_task_id(thread_id)?;
    let candidate = agent_worktree_path(workspace_root, &thread_id);
    let entry = std::fs::symlink_metadata(&candidate)
        .map_err(|_| AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())?;
    if entry.file_type().is_symlink() {
        return Err(AGENT_WORKTREE_TERMINAL_SYMLINK_ERROR.to_string());
    }
    if !entry.is_dir() {
        return Err(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string());
    }
    ensure_worktree_path_in_base(workspace_root, &candidate)
}

fn open_terminal_launch_directory(
    registry: &WorkspaceRegistry,
    retained_workspace: &RetainedDebugWorkspaceRoot,
    workspace_root: &Path,
    target: &TerminalLaunchTarget,
) -> Result<TerminalLaunchDirectory, String> {
    let cwd = resolve_terminal_launch_root(workspace_root, target)?;
    if let TerminalLaunchTarget::AgentWorktree { thread_id } = target {
        let directory = open_agent_worktree_directory(registry, workspace_root, thread_id)?;
        if opened_launch_directory_path(&directory)? != cwd {
            return Err(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string());
        }
        return Ok(TerminalLaunchDirectory { cwd, directory });
    }
    Ok(TerminalLaunchDirectory {
        cwd,
        directory: retained_workspace.try_clone_directory()?,
    })
}

fn opened_launch_directory_path(directory: &File) -> Result<PathBuf, String> {
    crate::workspace_registry::opened_root_path(directory)
        .map_err(|_| "Terminal workspace identity changed before launch.".to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_agent_worktree_directory(
    registry: &WorkspaceRegistry,
    workspace_root: &Path,
    thread_id: &str,
) -> Result<File, String> {
    let thread_id = safe_agent_task_id(thread_id)?;
    let descriptor = registry
        .descriptor_for_registered_path(workspace_root)
        .map_err(|_| "Terminal workspace identity changed before launch.".to_string())?;
    registry
        .open_directory_descendant(
            &descriptor.workspace_id,
            &Path::new(WORKTREE_BASE_DIR_NAME).join(&thread_id),
        )
        .map_err(|_| AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_agent_worktree_directory(
    _registry: &WorkspaceRegistry,
    _workspace_root: &Path,
    _thread_id: &str,
) -> Result<File, String> {
    Err(AGENT_WORKTREE_TERMINAL_UNSUPPORTED_ERROR.to_string())
}

fn retain_terminal_launch_workspace(
    registry: &WorkspaceRegistry,
    root: &Path,
) -> Result<crate::debug_session_registry::RetainedDebugWorkspaceRoot, String> {
    let retained_workspace = retain_workspace_root(registry, &root.to_string_lossy())?;
    if retained_workspace.live_path()? != root {
        return Err("Terminal workspace identity changed before launch.".to_string());
    }
    Ok(retained_workspace)
}

fn while_workspace_trusted<T>(
    trust: &Mutex<WorkspaceTrustService>,
    root_label: &str,
    launch: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let trust_guard = trust.lock().map_err(|error| error.to_string())?;
    if !trust_guard.get(root_label).trusted {
        return Err("Workspace must be trusted to start a terminal.".to_string());
    }
    let result = launch();
    drop(trust_guard);
    result
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) fn start_terminal_session(
    root_path: String,
    profile_id: Option<String>,
    terminal_shell_integration_enabled: bool,
    size: TerminalSize,
    target: Option<TerminalLaunchTarget>,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<TerminalRuntimeStatus, String> {
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let root = canonicalize_workspace_root(&root_path)?;
    let launch_target = target.unwrap_or_default();
    let root_label = root.to_string_lossy().to_string();
    while_workspace_trusted(&trust, &root_label, || {
        let retained_workspace = retain_terminal_launch_workspace(&registry, &root)?;
        let launch_directory =
            open_terminal_launch_directory(&registry, &retained_workspace, &root, &launch_target)?;
        let shell_integration_base_dir = terminal_shell_integration_enabled
            .then(|| app.path().app_local_data_dir())
            .transpose()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let profile_provider = LocalTerminalProfileProvider;
        let workspace_authority = retained_workspace.authority.clone();
        let result = supervisor.start_descriptor_bound(
            TerminalLaunchRoots {
                workspace_root: root.clone(),
                cwd: launch_directory.cwd,
            },
            launch_directory.directory,
            workspace_authority,
            TerminalStartOptions {
                #[cfg(test)]
                fault: None,
                profile: profile_provider.resolve_profile(profile_id.as_deref())?,
                shell_integration_base_dir,
                size,
            },
            &PortablePtySpawner,
            Arc::new(AppHandleTerminalEventSink::new(app.clone())),
        );
        drop(retained_workspace);
        result
    })
}

#[cfg(test)]
mod launch_target_tests {
    use super::*;

    #[test]
    fn the_launch_target_defaults_to_the_workspace_root() {
        assert_eq!(
            TerminalLaunchTarget::default(),
            TerminalLaunchTarget::WorkspaceRoot
        );
        assert_eq!(
            resolve_terminal_launch_root(Path::new("/workspace"), &TerminalLaunchTarget::default()),
            Ok(std::path::PathBuf::from("/workspace"))
        );
    }

    #[test]
    fn the_launch_target_uses_the_documented_wire_names() {
        let encoded = serde_json::to_string(&TerminalLaunchTarget::AgentWorktree {
            thread_id: "agt-thread-0001".to_string(),
        })
        .expect("target encodes");
        assert_eq!(
            encoded,
            r#"{"kind":"agentWorktree","threadId":"agt-thread-0001"}"#
        );
        assert_eq!(
            serde_json::from_str::<TerminalLaunchTarget>(r#"{"kind":"workspaceRoot"}"#)
                .expect("workspace root decodes"),
            TerminalLaunchTarget::WorkspaceRoot
        );
    }

    #[test]
    fn the_launch_target_rejects_unknown_kinds_and_fields() {
        assert!(serde_json::from_str::<TerminalLaunchTarget>(r#"{"kind":"anywhere"}"#).is_err());
        assert!(serde_json::from_str::<TerminalLaunchTarget>(
            r#"{"kind":"agentWorktree","threadId":"agt-thread-0001","cwd":"/etc"}"#
        )
        .is_err());
        assert!(
            serde_json::from_str::<TerminalLaunchTarget>(r#"{"kind":"agentWorktree"}"#).is_err()
        );
    }

    #[test]
    fn an_agent_worktree_target_refuses_an_unsafe_thread_id_without_touching_the_filesystem() {
        for thread_id in [
            "..",
            "../escape",
            ".worktrees",
            "-p",
            "--effort",
            "Agt-0001",
            "agt/0001",
            "ag",
            "",
        ] {
            let resolved = resolve_terminal_launch_root(
                Path::new("/workspace"),
                &TerminalLaunchTarget::AgentWorktree {
                    thread_id: thread_id.to_string(),
                },
            );
            assert!(
                resolved.is_err(),
                "thread id {thread_id:?} must not resolve to a launch root"
            );
            assert_ne!(
                resolved.unwrap_err(),
                AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string(),
                "thread id {thread_id:?} must be rejected before the filesystem lookup"
            );
        }
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::mpsc,
        thread,
        time::Duration,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct WorktreeFixture {
        fixture: std::path::PathBuf,
        registry: WorkspaceRegistry,
        root: std::path::PathBuf,
    }

    impl WorktreeFixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let fixture = std::env::temp_dir().join(format!(
                "codevo-terminal-worktree-{label}-{}-{nonce}",
                std::process::id()
            ));
            let root = fixture.join("workspace");
            fs::create_dir_all(&root).expect("create workspace");
            let registry = WorkspaceRegistry::new();
            let descriptor = registry.register(&root).expect("register workspace");
            Self {
                fixture,
                root: descriptor.canonical_root_path.clone(),
                registry,
            }
        }

        fn worktree(&self, thread_id: &str) -> std::path::PathBuf {
            let path = self.root.join(WORKTREE_BASE_DIR_NAME).join(thread_id);
            fs::create_dir_all(&path).expect("create worktree");
            fs::canonicalize(&path).expect("canonical worktree")
        }

        fn open(&self, target: &TerminalLaunchTarget) -> Result<TerminalLaunchDirectory, String> {
            let retained = retain_terminal_launch_workspace(&self.registry, &self.root)?;
            open_terminal_launch_directory(&self.registry, &retained, &self.root, target)
        }
    }

    impl Drop for WorktreeFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.fixture);
        }
    }

    fn agent_worktree(thread_id: &str) -> TerminalLaunchTarget {
        TerminalLaunchTarget::AgentWorktree {
            thread_id: thread_id.to_string(),
        }
    }

    #[test]
    fn an_agent_worktree_target_launches_in_the_thread_checkout() {
        let fixture = WorktreeFixture::new("resolve");
        let worktree = fixture.worktree("agt-0001");

        assert_eq!(
            resolve_terminal_launch_root(&fixture.root, &agent_worktree("agt-0001")),
            Ok(worktree.clone())
        );

        let launch = fixture
            .open(&agent_worktree("agt-0001"))
            .expect("open agent worktree launch directory");
        assert_eq!(launch.cwd, worktree);
        assert_eq!(
            opened_launch_directory_path(&launch.directory).expect("live worktree path"),
            worktree
        );
    }

    #[test]
    fn the_workspace_root_target_keeps_launching_in_the_registered_root() {
        let fixture = WorktreeFixture::new("root");

        let launch = fixture
            .open(&TerminalLaunchTarget::WorkspaceRoot)
            .expect("open workspace root launch directory");
        assert_eq!(launch.cwd, fixture.root);
        assert_eq!(
            opened_launch_directory_path(&launch.directory).expect("live root path"),
            fixture.root
        );
    }

    #[test]
    fn a_missing_agent_worktree_is_a_definite_error() {
        let fixture = WorktreeFixture::new("missing");

        assert_eq!(
            resolve_terminal_launch_root(&fixture.root, &agent_worktree("agt-gone")),
            Err(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
        );
        assert_eq!(
            fixture.open(&agent_worktree("agt-gone")).err(),
            Some(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
        );
    }

    #[test]
    fn a_worktree_entry_that_is_a_symlink_out_of_the_repository_is_refused() {
        let fixture = WorktreeFixture::new("symlink");
        fixture.worktree("agt-real");
        let outside = fixture.fixture.join("outside");
        fs::create_dir_all(&outside).expect("create outside directory");
        std::os::unix::fs::symlink(
            &outside,
            fixture.root.join(WORKTREE_BASE_DIR_NAME).join("agt-escape"),
        )
        .expect("link worktree out of the repository");

        assert_eq!(
            resolve_terminal_launch_root(&fixture.root, &agent_worktree("agt-escape")),
            Err(AGENT_WORKTREE_TERMINAL_SYMLINK_ERROR.to_string())
        );
        assert_eq!(
            fixture.open(&agent_worktree("agt-escape")).err(),
            Some(AGENT_WORKTREE_TERMINAL_SYMLINK_ERROR.to_string())
        );
    }

    #[test]
    fn a_worktree_base_that_is_a_symlink_never_opens_a_launch_directory() {
        let fixture = WorktreeFixture::new("symlinkbase");
        let outside = fixture.fixture.join("outside-base");
        fs::create_dir_all(outside.join("agt-0001")).expect("create outside worktree");
        std::os::unix::fs::symlink(&outside, fixture.root.join(WORKTREE_BASE_DIR_NAME))
            .expect("link worktree base out of the repository");

        assert_eq!(
            fixture.open(&agent_worktree("agt-0001")).err(),
            Some(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
        );
    }

    #[test]
    fn a_worktree_path_that_is_not_a_directory_is_refused() {
        let fixture = WorktreeFixture::new("file");
        let base = fixture.root.join(WORKTREE_BASE_DIR_NAME);
        fs::create_dir_all(&base).expect("create worktree base");
        fs::write(base.join("agt-file"), b"not a checkout").expect("write worktree file");

        assert_eq!(
            resolve_terminal_launch_root(&fixture.root, &agent_worktree("agt-file")),
            Err(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
        );
        assert_eq!(
            fixture.open(&agent_worktree("agt-file")).err(),
            Some(AGENT_WORKTREE_TERMINAL_MISSING_ERROR.to_string())
        );
    }

    #[test]
    fn terminal_launch_boundary_rejects_replaced_registered_root() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "codevo-terminal-launch-authority-{}-{nonce}",
            std::process::id()
        ));
        let root = fixture.join("workspace");
        fs::create_dir_all(&root).expect("create workspace");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register workspace");
        let root = descriptor.canonical_root_path.clone();

        let retained = retain_terminal_launch_workspace(&registry, &root)
            .expect("unchanged registered root should retain");
        assert_eq!(
            retained.authority,
            crate::debug_session_registry::retained_workspace_authority(
                &registry,
                root.to_str().expect("UTF-8 fixture")
            )
            .expect("registered authority")
        );
        drop(retained);

        let moved = fixture.join("moved-workspace");
        fs::rename(&root, &moved).expect("rename original workspace");
        fs::create_dir(&root).expect("replace workspace path");
        assert!(retain_terminal_launch_workspace(&registry, &root).is_err());

        drop(registry);
        fs::remove_dir_all(&fixture).expect("remove fixture");
        assert_eq!(descriptor.canonical_root_path, root);
    }

    #[test]
    fn terminal_launch_holds_trust_guard_through_publication_boundary() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "codevo-terminal-trust-linearization-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&fixture).expect("create fixture");
        let root_label = fixture.to_string_lossy().into_owned();
        let mut service =
            WorkspaceTrustService::load(fixture.join("trust.json")).expect("load trust");
        service.set(&root_label, true).expect("trust workspace");
        let trust = Arc::new(Mutex::new(service));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let launch_trust = Arc::clone(&trust);
        let launch_root = root_label.clone();
        let launch = thread::spawn(move || {
            while_workspace_trusted(&launch_trust, &launch_root, || {
                entered_tx.send(()).expect("signal launch");
                release_rx.recv().expect("release launch");
                Ok(())
            })
        });
        entered_rx.recv().expect("launch entered");

        let (attempted_tx, attempted_rx) = mpsc::channel();
        let (revoked_tx, revoked_rx) = mpsc::channel();
        let revoke_trust = Arc::clone(&trust);
        let revoke_root = root_label.clone();
        let revoke = thread::spawn(move || {
            attempted_tx.send(()).expect("signal revoke attempt");
            let mut guard = revoke_trust.lock().expect("lock trust for revoke");
            guard.set(&revoke_root, false).expect("revoke trust");
            revoked_tx.send(()).expect("signal revoke");
        });
        attempted_rx.recv().expect("revoke attempted");
        assert!(
            revoked_rx.recv_timeout(Duration::from_millis(50)).is_err(),
            "revoke must not pass the launch trust boundary"
        );

        release_tx.send(()).expect("release launch");
        launch.join().expect("join launch").expect("launch result");
        revoked_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("revoke should proceed after launch");
        revoke.join().expect("join revoke");
        fs::remove_dir_all(&fixture).expect("remove fixture");
    }
}

#[tauri::command]
pub(crate) fn list_terminal_profiles() -> Result<Vec<TerminalProfile>, String> {
    Ok(LocalTerminalProfileProvider.profiles())
}

#[tauri::command]
pub(crate) fn acknowledge_terminal_session_start(
    session_id: u64,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    supervisor.acknowledge_start(session_id)
}

#[tauri::command]
pub(crate) fn write_terminal_input(
    session_id: u64,
    data: String,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    supervisor.write_input(session_id, &data)
}

#[tauri::command]
pub(crate) fn resize_terminal_session(
    session_id: u64,
    size: TerminalSize,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    supervisor.resize(session_id, size)
}

#[tauri::command]
pub(crate) fn stop_terminal_session(
    session_id: u64,
    app: AppHandle,
    tasks: State<'_, NodePackageTaskRegistry>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<TerminalRuntimeStatus, String> {
    tasks.request_stop_session(
        session_id,
        &crate::node_package_tasks::AppNodePackageTaskEventSink(app),
    );
    supervisor.stop(session_id)
}

#[tauri::command]
pub(crate) fn stop_terminal_sessions_for_root(
    root_path: String,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    tasks: State<'_, NodePackageTaskRegistry>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    let root = canonicalize_workspace_root(&root_path)?;
    if let Ok(descriptor) = registry.descriptor_for_registered_path(&root) {
        tasks.request_stop_workspace_with_sink(
            &descriptor.workspace_id,
            &crate::node_package_tasks::AppNodePackageTaskEventSink(app.clone()),
        );
    }
    supervisor.stop_root(&root)
}

#[tauri::command]
pub(crate) fn stop_all_terminal_sessions(
    app: AppHandle,
    tasks: State<'_, NodePackageTaskRegistry>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<(), String> {
    tasks.request_stop_all(&crate::node_package_tasks::AppNodePackageTaskEventSink(app));
    supervisor.stop_all();
    Ok(())
}
