use super::*;

#[test]
fn every_post_spawn_fault_reaps_child_without_publication() {
    use crate::terminal_session::TerminalStartFault;

    for fault in [
        TerminalStartFault::ReaderSpawn,
        TerminalStartFault::AfterReaderSpawn,
        TerminalStartFault::WaiterSpawn,
        TerminalStartFault::BeforeCommit,
        TerminalStartFault::AfterWaiterAcceptance,
    ] {
        let child = RecordingTerminalChild::blocking();
        let killed = child.killed();
        let spawner = FakeTerminalSpawner::with_parts(
            Box::new(BlockingReader),
            Box::new(SharedWriter::default()),
            Box::new(RecordingTerminalResizer::default()),
            Box::new(child),
        );
        let sink = Arc::new(RecordingTerminalSink::default());
        let supervisor = TerminalSupervisor::new();

        let result = supervisor.start_with_options(
            PathBuf::from("/workspace"),
            None,
            None,
            crate::terminal_session::TerminalStartOptions {
                fault: Some(fault),
                profile: default_test_profile(),
                shell_integration_base_dir: None,
                size: TerminalSize::default(),
            },
            &spawner,
            sink.clone(),
        );

        assert!(result.is_err(), "fault {fault:?} must fail startup");
        assert_eq!(
            *killed.lock().expect("killed"),
            1,
            "fault {fault:?} must terminate exactly once"
        );
        assert!(
            supervisor
                .owned_process_groups(Path::new("/workspace"))
                .expect("ownership")
                .is_empty(),
            "fault {fault:?} must not publish ownership"
        );
        assert!(
            sink.statuses().is_empty(),
            "fault {fault:?} must not publish lifecycle events"
        );
    }
}

#[cfg(unix)]
#[test]
fn descriptor_bound_terminal_enters_retained_directory_after_rename_and_replace() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-terminal-descriptor-cwd-{}-{nonce}",
        std::process::id()
    ));
    let root = fixture.join("workspace");
    let moved = fixture.join("moved-workspace");
    let script = root.join("print-marker");
    let result = fixture.join("observed-marker");
    fs::create_dir_all(&root).expect("create workspace");
    fs::write(root.join("marker"), "ORIGINAL_DIRECTORY\n").expect("write original marker");
    fs::write(
        &script,
        format!("#!/bin/sh\n/bin/cat marker > '{}'\n", result.display()),
    )
    .expect("write fixture command");
    let mut permissions = fs::metadata(&script)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).expect("make fixture executable");

    let retained_directory = fs::File::open(&root).expect("retain workspace directory");
    fs::rename(&root, &moved).expect("rename original workspace");
    fs::create_dir(&root).expect("replace workspace path");
    fs::write(root.join("marker"), "REPLACEMENT_DIRECTORY\n").expect("write replacement marker");
    let replacement_script = root.join("print-marker");
    fs::write(
        &replacement_script,
        format!(
            "#!/bin/sh\n/bin/echo REPLACEMENT_EXECUTABLE > '{}'\n",
            result.display()
        ),
    )
    .expect("write replacement command");
    let mut permissions = fs::metadata(&replacement_script)
        .expect("replacement script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&replacement_script, permissions)
        .expect("make replacement command executable");

    let request = TerminalLaunchRequest {
        cwd: root,
        cwd_directory: Some(Arc::new(retained_directory)),
        profile: TerminalProfile {
            command: Some("./print-marker".to_string()),
            id: "descriptor-test".to_string(),
            label: "Descriptor test".to_string(),
        },
        shell_integration_base_dir: None,
        size: TerminalSize::default(),
    };
    let mut spawned = PortablePtySpawner
        .spawn(&request)
        .expect("spawn descriptor-bound terminal");
    let status = spawned.child.wait().expect("wait for fixture command");
    assert_eq!(status.exit_code, Some(0));

    let observed = fs::read_to_string(&result).expect("read observed marker");
    assert_eq!(observed, "ORIGINAL_DIRECTORY\n");

    drop(spawned);
    fs::remove_dir_all(&fixture).expect("remove fixture");
}

#[cfg(unix)]
#[test]
fn descriptor_bound_start_publishes_retained_workspace_authority() {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct DescriptorRequiredSpawner(FakeTerminalSpawner);

    impl TerminalPtySpawner for DescriptorRequiredSpawner {
        fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
            assert!(
                request.cwd_directory.is_some(),
                "retained authority requires a descriptor-bound request"
            );
            self.0.spawn(request)
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "codevo-terminal-retained-authority-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create workspace");
    let authority = crate::debug_session_registry::DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: "workspace-id".to_string(),
        canonical_root: root.to_string_lossy().into_owned(),
    };
    let supervisor = TerminalSupervisor::new();
    supervisor
        .start_descriptor_bound(
            root.clone(),
            fs::File::open(&root).expect("retain workspace"),
            authority.clone(),
            crate::terminal_session::TerminalStartOptions {
                fault: None,
                profile: default_test_profile(),
                shell_integration_base_dir: None,
                size: TerminalSize::default(),
            },
            &DescriptorRequiredSpawner(FakeTerminalSpawner::new(
                Box::new(BlockingReader),
                Box::new(SharedWriter::default()),
            )),
            Arc::new(RecordingTerminalSink::default()),
        )
        .expect("start descriptor-bound terminal");
    supervisor
        .register_task_process_group(1, &root, 1_001)
        .expect("register task");

    let groups = supervisor
        .owned_process_groups(&root)
        .expect("ownership snapshot");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].workspace_authority, Some(authority));

    supervisor.stop(1).expect("stop terminal");
    fs::remove_dir_all(&root).expect("remove fixture");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn rename_and_replace_during_spawn_never_claims_stable_workspace_authority() {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct RenameReplaceSpawner {
        moved: PathBuf,
        root: PathBuf,
    }

    impl TerminalPtySpawner for RenameReplaceSpawner {
        fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
            fs::rename(&self.root, &self.moved).map_err(|error| error.to_string())?;
            fs::create_dir(&self.root).map_err(|error| error.to_string())?;
            FakeTerminalSpawner::new(Box::new(BlockingReader), Box::new(SharedWriter::default()))
                .spawn(request)
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-terminal-spawn-replacement-{}-{nonce}",
        std::process::id()
    ));
    let root = fixture.join("workspace");
    let moved = fixture.join("moved-workspace");
    fs::create_dir_all(&root).expect("create workspace");
    let supervisor = TerminalSupervisor::new();
    supervisor
        .start(
            root.clone(),
            TerminalSize::default(),
            default_test_profile(),
            None,
            &RenameReplaceSpawner {
                moved,
                root: root.clone(),
            },
            Arc::new(RecordingTerminalSink::default()),
        )
        .expect("legacy terminal still starts");
    supervisor
        .register_task_process_group(1, &root, 1_001)
        .expect("register task");

    let groups = supervisor
        .owned_process_groups(&root)
        .expect("ownership snapshot");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].workspace_authority, None);

    supervisor.stop(1).expect("stop terminal");
    fs::remove_dir_all(&fixture).expect("remove fixture");
}

#[test]
fn owned_process_groups_are_isolated_by_exact_workspace_root() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    for root in ["/workspace-a", "/workspace-b"] {
        supervisor
            .start(
                PathBuf::from(root),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &FakeTerminalSpawner::new(
                    Box::new(BlockingReader),
                    Box::new(SharedWriter::default()),
                ),
                sink.clone(),
            )
            .expect("start terminal");
    }
    supervisor
        .register_task_process_group(1, Path::new("/workspace-a"), 1_001)
        .expect("register workspace a task");
    supervisor
        .register_task_process_group(2, Path::new("/workspace-b"), 2_001)
        .expect("register workspace b task");

    assert_eq!(
        supervisor
            .owned_process_groups(Path::new("/workspace-a"))
            .expect("workspace a ownership"),
        vec![TerminalOwnedProcessGroup {
            process_group_id: 1_001,
            session_id: 1,
            source: TerminalOwnedProcessGroupSource::Task,
            workspace_authority: None,
        }]
    );
    assert!(supervisor
        .owned_process_groups(Path::new("/workspace-a/../workspace-a"))
        .expect("unresolved ownership")
        .is_empty());
}

#[test]
fn shell_process_group_is_included_without_platform_io() {
    let supervisor = TerminalSupervisor::new();
    let child = RecordingTerminalChild::blocking();
    supervisor
        .insert_session(
            7,
            crate::terminal_session::RunningTerminalSession {
                cwd: PathBuf::from("/workspace"),
                start_gate: Arc::new(crate::terminal_session_events::TerminalStartGate::new()),
                process_tree_terminator: ProcessTreeTerminator::new(
                    Some(3_001),
                    child.clone_killer(),
                ),
                reader: None,
                resizer: Box::new(RecordingTerminalResizer::default()),
                sink: Arc::new(RecordingTerminalSink::default()),
                stop_requested: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                task_process_groups: std::collections::HashMap::new(),
                waiter: None,
                writer: Arc::new(Mutex::new(Box::new(SharedWriter::default()))),
                workspace_authority: None,
            },
        )
        .expect("insert shell session");

    assert_eq!(
        supervisor
            .owned_process_groups(Path::new("/workspace"))
            .expect("shell ownership"),
        vec![TerminalOwnedProcessGroup {
            process_group_id: 3_001,
            session_id: 7,
            source: TerminalOwnedProcessGroupSource::Shell,
            workspace_authority: None,
        }]
    );

    drop(supervisor.take_session(7));
}

#[test]
fn stopped_session_is_absent_from_process_group_snapshot() {
    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    supervisor
        .start(
            PathBuf::from("/workspace"),
            TerminalSize::default(),
            default_test_profile(),
            None,
            &FakeTerminalSpawner::new(Box::new(BlockingReader), Box::new(SharedWriter::default())),
            sink,
        )
        .expect("start terminal");
    supervisor
        .register_task_process_group(1, Path::new("/workspace"), i32::MAX)
        .expect("register task");
    assert_eq!(
        supervisor
            .owned_process_groups(Path::new("/workspace"))
            .expect("live ownership")
            .len(),
        1
    );

    supervisor.stop(1).expect("stop terminal");

    assert!(supervisor
        .owned_process_groups(Path::new("/workspace"))
        .expect("stopped ownership")
        .is_empty());
}

#[cfg(unix)]
#[test]
fn process_group_snapshot_exposes_only_active_tasks() {
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    let supervisor = TerminalSupervisor::new();
    let sink = Arc::new(RecordingTerminalSink::default());
    supervisor
        .start(
            PathBuf::from("/workspace"),
            TerminalSize::default(),
            default_test_profile(),
            None,
            &FakeTerminalSpawner::new(Box::new(BlockingReader), Box::new(SharedWriter::default())),
            sink,
        )
        .expect("start terminal");
    let mut child = Command::new("/bin/sh")
        .args(["-c", "exit 0"])
        .process_group(0)
        .spawn()
        .expect("spawn task process group");
    let process_group_id = i32::try_from(child.id()).expect("task process group");
    let ownership = supervisor
        .register_task_process_group(1, Path::new("/workspace"), process_group_id)
        .expect("register task");
    assert_eq!(
        supervisor
            .owned_process_groups(Path::new("/workspace"))
            .expect("active ownership"),
        vec![TerminalOwnedProcessGroup {
            process_group_id,
            session_id: 1,
            source: TerminalOwnedProcessGroupSource::Task,
            workspace_authority: None,
        }]
    );

    ownership
        .wait_after_terminate(&mut child)
        .expect("reap task");

    assert!(supervisor
        .owned_process_groups(Path::new("/workspace"))
        .expect("reaped ownership")
        .is_empty());
}
