use super::*;

#[test]
fn workspace_unregister_invalidation_rejects_old_permit_after_same_path_registration_aba() {
    let root = std::env::temp_dir().join(format!(
        "codevo-debug-workspace-aba-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).expect("workspace root");
    let workspaces = crate::workspace_registry::WorkspaceRegistry::new();
    let first = workspaces.register(&root).expect("first registration");
    let root_key = first.canonical_root_path.to_string_lossy().into_owned();
    let debug = Arc::new(DebugSessionRegistry::new());
    debug.activate_root(&root_key);
    let old_permit = debug.begin_start(&root_key).expect("old permit");
    let old_sink = Arc::new(CollectingSink::default());
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let old_state = FakeAdapterState::default();
    let worker_state = old_state.clone();
    let worker_debug = Arc::clone(&debug);
    let worker_sink = Arc::clone(&old_sink);
    let old_start = thread::spawn(move || {
        worker_debug.start_session_with_permit(old_permit, worker_sink, move |_emitter| {
            entered_tx.send(()).expect("old factory entered");
            release_rx.recv().expect("release old factory");
            Ok(Box::new(FakeAdapter::new(worker_state)))
        })
    });
    entered_rx.recv().expect("old startup paused");
    let mut deactivation = None;

    workspaces
        .unregister_after(&first.workspace_id, |descriptor| {
            deactivation = Some(
                debug.begin_root_deactivation(&descriptor.canonical_root_path.to_string_lossy()),
            );
            Ok(())
        })
        .expect("unregister");
    DebugSessionRegistry::complete_root_deactivation(
        deactivation.expect("debug deactivation owner"),
    );
    let second = workspaces.register(&root).expect("same path registration");
    debug.activate_root(&second.canonical_root_path.to_string_lossy());
    let new_permit = debug.begin_start(&root_key).expect("new permit");
    let new_sink = Arc::new(CollectingSink::default());
    let new_state = FakeAdapterState::default();
    let new_worker_state = new_state.clone();
    let new_debug = Arc::clone(&debug);
    let new_start = thread::spawn(move || {
        new_debug.start_session_with_permit(new_permit, new_sink, move |_emitter| {
            Ok(Box::new(FakeAdapter::new(new_worker_state)))
        })
    });

    release_tx.send(()).expect("release stale startup");
    assert!(old_start
        .join()
        .expect("old startup")
        .expect_err("old permit rejected")
        .contains("lifecycle changed"));
    let new_session = new_start
        .join()
        .expect("new startup")
        .expect("new generation session");
    assert!(old_state.is_terminated());
    assert!(old_sink.events.lock().expect("old sink events").is_empty());
    assert!(debug.owns_session(&root_key, new_session));
    assert!(!new_state.is_terminated());
    assert!(debug.stop_by_id(new_session));
    workspaces
        .unregister(&second.workspace_id)
        .expect("cleanup");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn evaluation_permit_rejects_queued_and_late_results_for_every_lifecycle_invalidation() {
    for lifecycle in ["stop", "replacement", "deactivate", "disconnect"] {
        let root_key = format!("/workspace/evaluate-{lifecycle}");
        let registry = Arc::new(DebugSessionRegistry::new());
        let sink = Arc::new(CollectingSink::default());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let adapter_calls = Arc::clone(&calls);
        let permit = registry.begin_start(&root_key).expect("startup permit");
        let mode = if lifecycle == "disconnect" {
            DebugSessionMode::ExternalNodeAttach
        } else {
            DebugSessionMode::OwnedLaunch
        };
        let session_id = registry
            .start_session_with_permit_breakpoints_and_mode(
                permit,
                sink,
                DebugBreakpointAdapterKind::Node,
                std::collections::HashMap::new(),
                mode,
                move |_emitter| {
                    Ok(Box::new(BlockingEvaluationAdapter {
                        calls: adapter_calls,
                        entered: entered_tx,
                        release: release_rx,
                    }))
                },
            )
            .expect("start blocking evaluation session");

        let evaluation_registry = Arc::clone(&registry);
        let evaluation_root = root_key.clone();
        let evaluation = thread::spawn(move || {
            evaluation_registry.evaluate_for_session(session_id, &evaluation_root, |adapter| {
                adapter.evaluate(1, "mutate()")
            })
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("evaluation entered adapter");

        let lifecycle_registry = Arc::clone(&registry);
        let lifecycle_root = root_key.clone();
        let invalidation = thread::spawn(move || match lifecycle {
            "stop" => lifecycle_registry.stop(&lifecycle_root),
            "replacement" => lifecycle_registry.begin_start(&lifecycle_root).is_ok(),
            "deactivate" => lifecycle_registry.deactivate_root(&lifecycle_root),
            "disconnect" => lifecycle_registry
                .disconnect_external_node_attach(&lifecycle_root, session_id)
                .is_ok(),
            _ => unreachable!(),
        });
        wait_until(Duration::from_secs(1), || {
            registry.session_id_for_root(&root_key).is_none()
        });

        assert_eq!(
            registry.evaluate_for_session(session_id, &root_key, |adapter| {
                adapter.evaluate(1, "must-not-start()")
            }),
            Err("The debug session no longer belongs to this workspace.".to_string())
        );
        release_tx.send(()).expect("release evaluation");
        assert_eq!(
            evaluation.join().expect("evaluation worker"),
            Err("The debug session no longer belongs to this workspace.".to_string())
        );
        assert!(invalidation.join().expect("lifecycle worker"));
        assert_eq!(calls.load(Ordering::SeqCst), 1, "lifecycle {lifecycle}");
    }
}
#[test]
fn variable_inspection_permit_rejects_queued_and_late_results_on_stop() {
    let root_key = "/workspace/variables-stop".to_string();
    let registry = Arc::new(DebugSessionRegistry::new());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let adapter_calls = Arc::clone(&calls);
    let session_id = registry
        .start_session(
            &root_key,
            Arc::new(CollectingSink::default()),
            move |_emitter| {
                Ok(Box::new(BlockingEvaluationAdapter {
                    calls: adapter_calls,
                    entered: entered_tx,
                    release: release_rx,
                }))
            },
        )
        .expect("start blocking variable session");
    let request = DebugVariablePageRequest {
        pause_generation: 1,
        frame_id: 1,
        variables_reference: 1,
        start: 0,
        count: 100,
    };
    let worker_registry = Arc::clone(&registry);
    let worker_root = root_key.clone();
    let worker = thread::spawn(move || {
        worker_registry.inspect_for_session(session_id, &worker_root, |adapter| {
            adapter.variables_page(request)
        })
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("variables entered adapter");
    let stop_registry = Arc::clone(&registry);
    let stop_root = root_key.clone();
    let stop = thread::spawn(move || stop_registry.stop(&stop_root));
    wait_until(Duration::from_secs(1), || {
        registry.session_id_for_root(&root_key).is_none()
    });
    assert_eq!(
        registry.inspect_for_session(session_id, &root_key, |adapter| {
            adapter.variables_page(request)
        }),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    release_tx.send(()).expect("release variables");
    assert_eq!(
        worker.join().expect("variable worker"),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    assert!(stop.join().expect("stop worker"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn id_only_control_is_serialized_with_exact_session_teardown() {
    let root_key = "/workspace/id-only-stop".to_string();
    let registry = Arc::new(DebugSessionRegistry::new());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let adapter_calls = Arc::clone(&calls);
    let session_id = registry
        .start_session(
            &root_key,
            Arc::new(CollectingSink::default()),
            move |_emitter| {
                Ok(Box::new(BlockingEvaluationAdapter {
                    calls: adapter_calls,
                    entered: entered_tx,
                    release: release_rx,
                }))
            },
        )
        .expect("start blocking id-only session");
    let worker_registry = Arc::clone(&registry);
    let worker = thread::spawn(move || {
        worker_registry.with_session_by_id(session_id, |adapter| adapter.evaluate(1, "blocked()"))
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("id-only operation entered adapter");
    let stop_registry = Arc::clone(&registry);
    let stop = thread::spawn(move || stop_registry.stop_by_id(session_id));
    wait_until(Duration::from_secs(1), || {
        !registry.owns_session(&root_key, session_id)
    });

    assert_eq!(
        registry.with_session_by_id(session_id, |adapter| adapter.pause()),
        Err(format!("No debug session with id {session_id}."))
    );
    release_tx.send(()).expect("release id-only operation");
    assert_eq!(
        worker.join().expect("id-only worker"),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    assert!(stop.join().expect("stop worker"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn disconnect_during_blocked_breakpoint_io_rejects_the_late_commit() {
    let fixture_root = std::env::temp_dir().join(format!(
        "codevo-debug-registry-concurrency-{}",
        std::process::id()
    ));
    let source_dir = fixture_root.join("src");
    fs::create_dir_all(&source_dir).expect("create fixture");
    let source_file = source_dir.join("app.ts");
    fs::write(&source_file, "debugger;\n").expect("write fixture");
    let root_key = fixture_root.to_string_lossy().into_owned();
    let file_path = source_file.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let adapter_state = FakeAdapterState::default();
    let factory_state = adapter_state.clone();
    let permit = registry.begin_start(&root_key).expect("startup permit");
    let session_id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink.clone(),
            DebugBreakpointAdapterKind::Node,
            std::collections::HashMap::new(),
            DebugSessionMode::ExternalNodeAttach,
            move |_emitter| {
                Ok(Box::new(BlockingBreakpointAdapter {
                    entered: entered_tx,
                    release: release_rx,
                    state: factory_state,
                }))
            },
        )
        .expect("start blocking session");
    let removed_inventory = registry
        .breakpoint_inventory(&root_key)
        .expect("registered session inventory");
    let worker_registry = Arc::clone(&registry);
    let worker_root = root_key.clone();
    let worker_file = file_path.clone();
    let set_worker = thread::spawn(move || {
        worker_registry.set_breakpoints_for_session(
            session_id,
            &worker_root,
            &worker_file,
            &[breakpoint(&worker_file, "late", 7)],
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("breakpoint I/O entered");

    let disconnect_registry = Arc::clone(&registry);
    let disconnect_root = root_key.clone();
    let disconnect_worker = thread::spawn(move || {
        disconnect_registry.disconnect_external_node_attach(&disconnect_root, session_id)
    });
    wait_until(Duration::from_secs(1), || {
        registry.session_id_for_root(&root_key).is_none()
    });

    let (other_id, _) = start_fake_session(&registry, "/workspace/two", sink.clone());
    let (replacement_id, _) = start_fake_session(&registry, &root_key, sink);
    assert_eq!(
        registry.session_id_for_root("/workspace/two"),
        Some(other_id)
    );
    assert_eq!(
        registry.session_id_for_root(&root_key),
        Some(replacement_id)
    );

    release_tx.send(()).expect("release breakpoint I/O");
    assert_eq!(
        set_worker.join().expect("set worker"),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    disconnect_worker
        .join()
        .expect("disconnect worker")
        .expect("disconnect attach");
    assert!(adapter_state.is_terminated());
    assert!(removed_inventory
        .lock()
        .expect("breakpoint inventory")
        .is_empty());
    fs::remove_dir_all(fixture_root).expect("remove fixture");
}

#[test]
fn overlapping_breakpoint_sets_are_serialized_and_commit_in_request_order() {
    let fixture_root = std::env::temp_dir().join(format!(
        "codevo-debug-registry-serialized-{}",
        std::process::id()
    ));
    let source_dir = fixture_root.join("src");
    fs::create_dir_all(&source_dir).expect("create fixture");
    let source_file = source_dir.join("app.ts");
    fs::write(&source_file, "debugger;\n").expect("write fixture");
    let root_key = fixture_root.to_string_lossy().into_owned();
    let file_path = source_file.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let session_id = registry
        .start_session(&root_key, sink, move |_emitter| {
            Ok(Box::new(BlockingBreakpointAdapter {
                entered: entered_tx,
                release: release_rx,
                state: FakeAdapterState::default(),
            }))
        })
        .expect("start blocking session");
    let inventory = registry
        .breakpoint_inventory(&root_key)
        .expect("registered session inventory");

    let first_registry = Arc::clone(&registry);
    let first_root = root_key.clone();
    let first_file = file_path.clone();
    let first = thread::spawn(move || {
        first_registry.set_breakpoints_for_session(
            session_id,
            &first_root,
            &first_file,
            &[breakpoint(&first_file, "first", 3)],
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("first operation entered adapter");

    let second_registry = Arc::clone(&registry);
    let second_root = root_key.clone();
    let second_file = file_path.clone();
    let second = thread::spawn(move || {
        second_registry.set_breakpoints_for_session(
            session_id,
            &second_root,
            &second_file,
            &[breakpoint(&second_file, "second", 9)],
        )
    });
    release_tx.send(()).expect("release first operation");
    assert!(first.join().expect("first worker").is_ok());
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("second operation entered adapter");
    release_tx.send(()).expect("release second operation");
    assert!(second.join().expect("second worker").is_ok());

    let stored = inventory.lock().expect("breakpoint inventory");
    let committed: Vec<_> = stored.values().flatten().collect();
    assert_eq!(committed.len(), 1);
    assert_eq!(committed[0].id, "second");
    assert_eq!(committed[0].line_number, 9);
    drop(stored);
    fs::remove_dir_all(fixture_root).expect("remove fixture");
}

#[test]
fn start_session_emits_started_and_returns_incrementing_ids() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());

    let (first_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
    let (second_id, _) = start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

    assert_eq!(first_id, 1);
    assert_eq!(second_id, 2);
    let events = sink.events();
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0],
        DebugEvent {
            root_path: "/workspace/one".to_string(),
            session_id: 1,
            seq: 1,
            payload: DebugEventPayload::Started { session_id: 1 },
        }
    );
    assert_eq!(events[1].root_path, "/workspace/two");
    assert_eq!(
        events[1].payload,
        DebugEventPayload::Started { session_id: 2 }
    );
    assert_eq!(events[1].seq, 1);
}

#[test]
fn start_for_same_root_terminates_previous_session() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());

    let (first_id, first_state) =
        start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
    let (second_id, second_state) =
        start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

    assert_ne!(first_id, second_id);
    assert!(first_state.is_terminated());
    assert!(!second_state.is_terminated());
    assert_eq!(
        registry.session_id_for_root("/workspace/one"),
        Some(second_id)
    );
    let terminated = terminated_events(&sink);
    assert_eq!(terminated.len(), 1);
    assert_eq!(terminated[0].session_id, first_id);
    assert_eq!(terminated[0].seq, 2);
    assert_eq!(
        terminated[0].payload,
        DebugEventPayload::Terminated { exit_code: None }
    );
}
