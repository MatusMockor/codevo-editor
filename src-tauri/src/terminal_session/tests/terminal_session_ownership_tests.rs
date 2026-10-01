use super::*;

fn test_effective_path() -> EffectiveExecutablePath<'static> {
    EffectiveExecutablePath::new("/usr/local/bin:/usr/bin:/bin").expect("effective path")
}

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
            crate::terminal_session::TerminalLaunchRoots::workspace_root(PathBuf::from(
                "/workspace",
            )),
            None,
            crate::terminal_session::TerminalStartOptions {
                effective_path: test_effective_path(),
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
            supervisor.sessions.lock().expect("sessions").is_empty(),
            "fault {fault:?} must not publish a session"
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
        effective_path: "/usr/local/bin:/usr/bin:/bin".to_string(),
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
fn a_worktree_terminal_records_its_own_cwd_and_keeps_the_workspace_identity() {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-terminal-worktree-session-{}-{nonce}",
        std::process::id()
    ));
    let root = fixture.join("workspace");
    let worktree = root.join(".worktrees").join("agt-0001");
    fs::create_dir_all(&worktree).expect("create worktree");
    let supervisor = TerminalSupervisor::new();

    let status = supervisor
        .start_descriptor_bound(
            crate::terminal_session::TerminalLaunchRoots {
                workspace_root: root.clone(),
                cwd: worktree.clone(),
            },
            fs::File::open(&worktree).expect("retain worktree"),
            crate::terminal_session::TerminalStartOptions {
                effective_path: test_effective_path(),
                fault: None,
                profile: default_test_profile(),
                shell_integration_base_dir: None,
                size: TerminalSize::default(),
            },
            &FakeTerminalSpawner::new(Box::new(BlockingReader), Box::new(SharedWriter::default())),
            Arc::new(RecordingTerminalSink::default()),
        )
        .expect("start worktree terminal");

    assert_eq!(
        status,
        TerminalRuntimeStatus::Running {
            cols: TerminalSize::default().normalized().cols,
            cwd: worktree.to_string_lossy().to_string(),
            rows: TerminalSize::default().normalized().rows,
            session_id: 1,
        }
    );
    assert!(
        supervisor.task_sink(1, &root).is_err(),
        "typed tasks must not bind to a terminal outside the workspace root"
    );
    assert!(supervisor
        .register_task_process_group(1, &root, 1_001)
        .is_err());
    assert!(
        supervisor.acknowledge_start(1).is_ok(),
        "the worktree terminal must still be registered"
    );

    supervisor.stop_root(&root).expect("stop workspace root");
    assert!(
        supervisor.acknowledge_start(1).is_err(),
        "stopping the workspace root must reap its worktree terminals"
    );

    fs::remove_dir_all(&fixture).expect("remove fixture");
}
