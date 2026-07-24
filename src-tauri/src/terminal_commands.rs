use crate::{
    canonicalize_workspace_root,
    debug_session_registry::retain_workspace_root,
    node_package_tasks::NodePackageTaskRegistry,
    terminal::{AppHandleTerminalEventSink, TerminalProfile, TerminalRuntimeStatus, TerminalSize},
    terminal_session::{
        LocalTerminalProfileProvider, PortablePtySpawner, TerminalProfileProvider,
        TerminalStartOptions, TerminalSupervisor,
    },
    trust::WorkspaceTrustService,
    workspace_registry::WorkspaceRegistry,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

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

#[tauri::command]
pub(crate) fn start_terminal_session(
    root_path: String,
    profile_id: Option<String>,
    terminal_shell_integration_enabled: bool,
    size: TerminalSize,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    supervisor: State<'_, TerminalSupervisor>,
) -> Result<TerminalRuntimeStatus, String> {
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let root = canonicalize_workspace_root(&root_path)?;
    let root_label = root.to_string_lossy().to_string();
    while_workspace_trusted(&trust, &root_label, || {
        let retained_workspace = retain_terminal_launch_workspace(&registry, &root)?;
        let shell_integration_base_dir = terminal_shell_integration_enabled
            .then(|| app.path().app_local_data_dir())
            .transpose()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let profile_provider = LocalTerminalProfileProvider;
        let cwd_directory = retained_workspace.try_clone_directory()?;
        let workspace_authority = retained_workspace.authority.clone();
        let result = supervisor.start_descriptor_bound(
            root,
            cwd_directory,
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
