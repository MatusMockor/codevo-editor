use super::{
    workspace_file_changed_payloads, WorkspaceFileChangeEmitter, WorkspaceFileChangeSink,
    WorkspaceFileChangeWatchRegistry, WorkspaceFileChangedPayload, WorkspaceFileWatchStartReceipt,
    WorkspaceWatchBeforeEmitGate, WorkspaceWatchSinkAuthority, WorkspaceWatchTransitionKind,
};
use crate::file_watcher::{
    WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchError, WorkspaceWatchEvent,
    WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
    WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const WORKSPACE_ROOT: &str = "/workspace";

#[test]
fn maps_delete_and_modify_events_to_frontend_payloads() {
    let payloads = workspace_file_changed_payloads(
        WORKSPACE_ROOT,
        7,
        &[
            event(WorkspaceWatchEventKind::Deleted, "/workspace/src/User.php"),
            event(WorkspaceWatchEventKind::Modified, "/workspace/src/App.tsx"),
            event(WorkspaceWatchEventKind::Created, "/workspace/src/New.php"),
        ],
        false,
    );

    assert_eq!(payloads.len(), 3);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Deleted);
    assert_eq!(payloads[0].path, "/workspace/src/User.php");
    assert_eq!(payloads[0].relative_path, "src/User.php");
    assert_eq!(payloads[0].root_path, WORKSPACE_ROOT);
    assert_eq!(payloads[0].watch_generation, 7);
    assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Modified);
    assert_eq!(payloads[2].kind, WorkspaceWatchEventKind::Created);
}

#[test]
fn maps_rename_events_with_previous_path() {
    let mut rename = event(
        WorkspaceWatchEventKind::Renamed,
        "/workspace/src/Account.php",
    );
    rename.previous_path = Some("/workspace/src/User.php".to_string());
    rename.previous_relative_path = Some("src/User.php".to_string());

    let payloads = workspace_file_changed_payloads(WORKSPACE_ROOT, 1, &[rename], false);

    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Renamed);
    assert_eq!(payloads[0].path, "/workspace/src/Account.php");
    assert_eq!(
        payloads[0].previous_path,
        Some("/workspace/src/User.php".to_string())
    );
    assert_eq!(
        payloads[0].previous_relative_path,
        Some("src/User.php".to_string())
    );
}

#[test]
fn maps_cross_root_renames_to_only_the_authorized_side() {
    let mut outside_to_inside = event(WorkspaceWatchEventKind::Renamed, "/workspace/src/new.ts");
    outside_to_inside.previous_path = Some("/other/src/old.ts".to_string());
    let mut inside_to_outside = event(WorkspaceWatchEventKind::Renamed, "/other/src/moved.ts");
    inside_to_outside.previous_path = Some("/workspace/src/original.ts".to_string());

    let payloads = workspace_file_changed_payloads(
        WORKSPACE_ROOT,
        2,
        &[outside_to_inside, inside_to_outside],
        false,
    );

    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Created);
    assert_eq!(payloads[0].path, "/workspace/src/new.ts");
    assert_eq!(payloads[0].previous_path, None);
    assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Deleted);
    assert_eq!(payloads[1].path, "/workspace/src/original.ts");
    assert_eq!(payloads[1].relative_path, "src/original.ts");
}

#[test]
fn coalesces_rescan_events_and_drops_events_outside_root() {
    let payloads = workspace_file_changed_payloads(
        WORKSPACE_ROOT,
        1,
        &[
            event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT),
            event(WorkspaceWatchEventKind::Deleted, "/other/src/User.php"),
            event(
                WorkspaceWatchEventKind::Deleted,
                "/workspace/../other/User.php",
            ),
        ],
        false,
    );

    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(payloads[0].root_path, WORKSPACE_ROOT);
    assert_eq!(payloads[0].path, WORKSPACE_ROOT);
    assert_eq!(payloads[0].relative_path, "");
    assert_eq!(payloads[0].file_kind, None);

    assert!(workspace_file_changed_payloads(
        WORKSPACE_ROOT,
        1,
        &[event(
            WorkspaceWatchEventKind::RescanRequired,
            "/other/src/User.php"
        )],
        false
    )
    .is_empty());
}

#[test]
fn mixed_rescan_batch_preserves_concrete_events() {
    let payloads = workspace_file_changed_payloads(
        WORKSPACE_ROOT,
        3,
        &[
            event(WorkspaceWatchEventKind::Created, "/workspace/src/new.ts"),
            event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT),
            event(WorkspaceWatchEventKind::Deleted, "/workspace/src/old.ts"),
        ],
        false,
    );

    assert_eq!(payloads.len(), 3);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Created);
    assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Deleted);
    assert_eq!(payloads[2].kind, WorkspaceWatchEventKind::RescanRequired);
    assert!(payloads.iter().all(|payload| payload.watch_generation == 3));
}

#[test]
fn foreign_rescan_is_not_promoted_to_the_sink_root() {
    let foreign = root_rescan_event("/other");
    assert!(workspace_file_changed_payloads(WORKSPACE_ROOT, 1, &[foreign], false).is_empty());
}

#[test]
fn sink_emits_only_events_for_its_own_root() {
    let recorder = RecordingEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
        emitter: Arc::new(recorder.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };

    sink.publish(WorkspaceWatchEventBatch {
        events: vec![
            event(WorkspaceWatchEventKind::Deleted, "/workspace/src/User.php"),
            event(WorkspaceWatchEventKind::Deleted, "/elsewhere/src/Other.php"),
        ],
    });

    let emitted = recorder.payloads();
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].path, "/workspace/src/User.php");
}

#[test]
fn sink_preserves_a_trailing_rescan_after_the_upstream_coalescing_window() {
    let recorder = RecordingEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
        emitter: Arc::new(recorder.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };
    let rescan = event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT);

    sink.publish(WorkspaceWatchEventBatch {
        events: vec![rescan.clone()],
    });
    sink.publish(WorkspaceWatchEventBatch {
        events: vec![rescan],
    });

    let emitted = recorder.payloads();
    assert_eq!(emitted.len(), 2);
    assert_eq!(emitted[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(emitted[1].kind, WorkspaceWatchEventKind::RescanRequired);
}

#[test]
fn revoking_a_watch_does_not_wait_for_a_blocking_emitter() {
    let emitter = BlockingEmitter::default();
    let authority = Arc::new(WorkspaceWatchSinkAuthority::new(1));
    let sink = Arc::new(WorkspaceFileChangeSink {
        authority: Arc::clone(&authority),
        emitter: Arc::new(emitter.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    });
    let publisher = Arc::clone(&sink);
    let publish_thread = std::thread::spawn(move || {
        publisher.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/src/index.ts",
            )],
        });
    });
    emitter.wait_until_entered();

    let started = Instant::now();
    authority.revoke();

    assert!(started.elapsed() < Duration::from_millis(100));
    publish_thread.join().expect("publish thread");
}

#[test]
fn revoked_watch_does_not_begin_an_emit_after_payload_preparation() {
    let recorder = RecordingEmitter::default();
    let authority = Arc::new(WorkspaceWatchSinkAuthority::new(1));
    let before_emit = Arc::new(WorkspaceWatchBeforeEmitGate::new());
    authority.install_before_emit_gate(Arc::clone(&before_emit));
    let sink = Arc::new(WorkspaceFileChangeSink {
        authority: Arc::clone(&authority),
        emitter: Arc::new(recorder.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    });
    let publisher = std::thread::spawn(move || {
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/src/index.ts",
            )],
        });
    });
    before_emit.wait_until_entered();

    authority.revoke();
    before_emit.release();
    publisher.join().expect("publisher");

    assert!(recorder.payloads().is_empty());
    assert!(authority.recovery.pending.load(Ordering::Acquire));
}

#[test]
fn sink_retries_a_failed_frontend_emit_once() {
    let emitter = FlakyEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
        emitter: Arc::new(emitter.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };

    sink.publish(WorkspaceWatchEventBatch {
        events: vec![event(
            WorkspaceWatchEventKind::RescanRequired,
            WORKSPACE_ROOT,
        )],
    });

    assert_eq!(emitter.attempts(), 2);
    assert_eq!(emitter.payloads().len(), 1);
}

#[test]
fn emitter_panic_rearms_recovery_for_an_ordinary_batch() {
    let authority = Arc::new(WorkspaceWatchSinkAuthority::new(1));
    let sink = WorkspaceFileChangeSink {
        authority: Arc::clone(&authority),
        emitter: Arc::new(PanickingEmitter),
        root_path: WORKSPACE_ROOT.to_string(),
    };

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/src/index.ts",
            )],
        });
    }));

    assert!(result.is_err());
    assert!(authority.recovery.pending.load(Ordering::Acquire));
}

#[test]
fn sink_resumes_after_a_partial_emit_without_duplicate_payloads() {
    let emitter = PartialEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
        emitter: Arc::new(emitter.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };

    sink.publish(WorkspaceWatchEventBatch {
        events: vec![
            event(WorkspaceWatchEventKind::Created, "/workspace/a.ts"),
            event(WorkspaceWatchEventKind::Created, "/workspace/b.ts"),
        ],
    });

    let payloads = emitter.payloads();
    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[0].path, "/workspace/a.ts");
    assert_eq!(payloads[1].path, "/workspace/b.ts");
}

#[test]
fn repeated_emit_failure_escalates_to_one_rescan_payload() {
    let emitter = AlwaysFailEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(8)),
        emitter: Arc::new(emitter.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };

    sink.publish(WorkspaceWatchEventBatch {
        events: vec![event(
            WorkspaceWatchEventKind::Modified,
            "/workspace/src/index.ts",
        )],
    });

    let attempts = emitter.attempted_kinds();
    assert_eq!(
        attempts,
        vec![
            WorkspaceWatchEventKind::Modified,
            WorkspaceWatchEventKind::Modified,
            WorkspaceWatchEventKind::RescanRequired,
        ]
    );
}

#[test]
fn failed_recovery_is_retained_and_replayed_on_the_next_event() {
    let emitter = RecoveringEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(11)),
        emitter: Arc::new(emitter.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };
    let batch = || WorkspaceWatchEventBatch {
        events: vec![event(
            WorkspaceWatchEventKind::Modified,
            "/workspace/src/index.ts",
        )],
    };

    sink.publish(batch());
    sink.publish(batch());

    let delivered = emitter.delivered();
    assert_eq!(delivered.len(), 2);
    assert_eq!(delivered[0].kind, WorkspaceWatchEventKind::Modified);
    assert_eq!(delivered[1].kind, WorkspaceWatchEventKind::RescanRequired);
}

#[test]
fn oversized_batch_fails_closed_to_one_rescan_without_partial_events() {
    let recorder = RecordingEmitter::default();
    let sink = WorkspaceFileChangeSink {
        authority: Arc::new(WorkspaceWatchSinkAuthority::new(9)),
        emitter: Arc::new(recorder.clone()),
        root_path: WORKSPACE_ROOT.to_string(),
    };
    let events = (0..=super::MAX_WORKSPACE_WATCH_BATCH_EVENTS)
        .map(|index| {
            event(
                WorkspaceWatchEventKind::Modified,
                &format!("/workspace/src/{index}.ts"),
            )
        })
        .collect();

    sink.publish(WorkspaceWatchEventBatch { events });

    let emitted = recorder.payloads();
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(emitted[0].root_path, WORKSPACE_ROOT);
    assert_eq!(emitted[0].path, WORKSPACE_ROOT);
    assert_eq!(emitted[0].watch_generation, 9);
}

#[test]
fn watch_registry_rejects_a_stale_sink_after_an_a_b_a_replacement() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let watcher = RecordingWatcher::default();
    let recorder = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-a-b-a");

    for _ in 0..2 {
        registry
            .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(recorder.clone()),
                    root_path: root_key.to_string(),
                })
            })
            .expect("start workspace watch");
        if watcher.started_roots().len() == 1 {
            registry.stop(&path_string(&root));
        }
    }

    let stale = watcher.sink(0);
    let current = watcher.sink(1);
    let batch = WorkspaceWatchEventBatch {
        events: vec![root_rescan_event(&path_string(&root))],
    };
    stale.publish(batch.clone());
    current.publish(batch);

    let emitted = recorder.payloads();
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].root_path, path_string(&root));
    assert_eq!(emitted[0].watch_generation, 2);
}

#[test]
fn restarted_watch_replays_retained_recovery_before_returning() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let watcher = RecordingWatcher::default();
    let failing = AlwaysFailEmitter::default();
    let recovered = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-retained-recovery");
    registry
        .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(failing.clone()),
                root_path: root_key.to_string(),
            })
        })
        .expect("start failing watch");
    watcher.sink(0).publish(WorkspaceWatchEventBatch {
        events: vec![event(
            WorkspaceWatchEventKind::Modified,
            &path_string(&root.join("src/index.ts")),
        )],
    });
    registry.stop(&path_string(&root));

    registry
        .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(recovered.clone()),
                root_path: root_key.to_string(),
            })
        })
        .expect("restart recovered watch");

    let payloads = recovered.payloads();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(payloads[0].watch_generation, 2);
}

#[test]
fn failed_start_retains_recovery_after_a_synchronous_callback() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let failed_watcher = PublishingFailWatcher;
    let recovered_watcher = RecordingWatcher::default();
    let failed = RecordingEmitter::default();
    let recovered = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-failed-start-recovery");

    assert!(registry
        .start_with_watcher(
            &path_string(&root),
            &failed_watcher,
            |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(failed.clone()),
                    root_path: root_key.to_string(),
                })
            },
        )
        .is_err());
    registry
        .start_with_watcher(
            &path_string(&root),
            &recovered_watcher,
            |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(recovered.clone()),
                    root_path: root_key.to_string(),
                })
            },
        )
        .expect("recovered start");

    let payloads = recovered.payloads();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(payloads[0].watch_generation, 2);
}

#[test]
fn panicking_start_retains_recovery_after_a_synchronous_callback() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let recovered_watcher = RecordingWatcher::default();
    let recovered = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-panicking-start-recovery");

    assert!(registry
        .start_with_watcher(&path_string(&root), &PublishingPanicWatcher, |_, _| {
            Arc::new(NoopWatchSink)
        })
        .is_err());
    registry
        .start_with_watcher(
            &path_string(&root),
            &recovered_watcher,
            |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(recovered.clone()),
                    root_path: root_key.to_string(),
                })
            },
        )
        .expect("recovered start");

    assert_eq!(
        recovered.payloads()[0].kind,
        WorkspaceWatchEventKind::RescanRequired
    );
}

#[test]
fn restarted_watch_replays_recovery_before_an_old_failed_publish_settles() {
    let registry = Arc::new(WorkspaceFileChangeWatchRegistry::new());
    let watcher = RecordingWatcher::default();
    let failing = BlockingFailingEmitter::default();
    let recovered = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-in-flight-recovery");
    registry
        .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(failing.clone()),
                root_path: root_key.to_string(),
            })
        })
        .expect("start failing watch");

    let sink = watcher.sink(0);
    let event_path = path_string(&root.join("src/index.ts"));
    let publisher = std::thread::spawn(move || {
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(WorkspaceWatchEventKind::Modified, &event_path)],
        });
    });
    failing.wait_until_entered();
    registry.stop(&path_string(&root));

    registry
        .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(recovered.clone()),
                root_path: root_key.to_string(),
            })
        })
        .expect("restart recovered watch");

    let payloads = recovered.payloads();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
    assert_eq!(payloads[0].watch_generation, 2);

    failing.release();
    publisher.join().expect("failed publisher");
    assert_eq!(failing.attempts(), 1);
}

#[test]
fn watch_registry_stop_stops_requested_root_only() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let watcher = RecordingWatcher::default();
    let root_a = temp_workspace("generic-watch-stop-a");
    let root_b = temp_workspace("generic-watch-stop-b");

    start_with_watcher(&registry, &root_a, &watcher);
    start_with_watcher(&registry, &root_b, &watcher);

    registry.stop(&path_string(&root_a));
    registry.stop(&path_string(&root_a));

    assert_eq!(watcher.started_roots().len(), 2);
    assert_eq!(watcher.stopped_roots(), vec![root_a.clone()]);

    registry.stop_all();

    let stopped = watcher.stopped_roots();
    assert_eq!(stopped.len(), 2);
    assert!(stopped.contains(&root_a));
    assert!(stopped.contains(&root_b));
}

#[test]
fn watch_registry_start_is_idempotent_for_same_canonical_root() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let watcher = RecordingWatcher::default();
    let root = temp_workspace("generic-watch-start-idempotent");

    let first = start_with_watcher(&registry, &root, &watcher);
    let second = start_with_watcher(&registry, &root, &watcher);

    assert_eq!(watcher.started_roots(), vec![root]);
    assert!(watcher.stopped_roots().is_empty());
    assert_eq!(first, second);
}

#[test]
fn watch_registry_stop_generation_rejects_stale_owner() {
    let registry = WorkspaceFileChangeWatchRegistry::new();
    let watcher = RecordingWatcher::default();
    let root = temp_workspace("generic-watch-stop-generation");
    let receipt = start_with_watcher(&registry, &root, &watcher);

    assert!(!registry.stop_generation(&path_string(&root), receipt.watch_generation + 1));
    assert!(watcher.stopped_roots().is_empty());
    assert!(registry.stop_generation(&path_string(&root), receipt.watch_generation));
    assert_eq!(watcher.stopped_roots(), vec![root]);
}

#[test]
fn restart_waits_for_the_revoked_backend_session_to_finish_stopping() {
    let registry = Arc::new(WorkspaceFileChangeWatchRegistry::new());
    let watcher = RecordingWatcher::default();
    let stop_gate = watcher.block_stops();
    let root = temp_workspace("generic-watch-blocked-stop-restart");
    let first = start_with_watcher(&registry, &root, &watcher);

    let stop_registry = Arc::clone(&registry);
    let stop_root = root.clone();
    let stop_thread = std::thread::spawn(move || {
        stop_registry.stop(&path_string(&stop_root));
    });
    stop_gate.wait_until_entered();

    let restart_registry = Arc::clone(&registry);
    let restart_watcher = watcher.clone();
    let restart_root = root.clone();
    let (result_tx, result_rx) = std::sync::mpsc::channel();
    let restart_thread = std::thread::spawn(move || {
        let result = start_with_watcher(&restart_registry, &restart_root, &restart_watcher);
        result_tx.send(result).expect("restart result");
    });

    assert!(result_rx.recv_timeout(Duration::from_millis(50)).is_err());
    assert_eq!(watcher.started_roots(), vec![root.clone()]);

    stop_gate.release();
    stop_thread.join().expect("stop thread");
    let second = result_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("restart completed");
    restart_thread.join().expect("restart thread");

    assert_eq!(first.watch_generation, 1);
    assert_eq!(second.watch_generation, 2);
    assert_eq!(watcher.started_roots(), vec![root.clone(), root]);
}

#[test]
fn stop_cancels_a_blocked_start_before_it_can_install_a_session() {
    let registry = Arc::new(WorkspaceFileChangeWatchRegistry::new());
    let watcher = BlockingStartWatcher::default();
    let recorder = RecordingEmitter::default();
    let root = temp_workspace("generic-watch-cancel-blocked-start");
    let start_registry = Arc::clone(&registry);
    let start_watcher = watcher.clone();
    let start_recorder = recorder.clone();
    let start_root = root.clone();
    let start_thread = std::thread::spawn(move || {
        start_registry.start_with_watcher(
            &path_string(&start_root),
            &start_watcher,
            |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(start_recorder),
                    root_path: root_key.to_string(),
                })
            },
        )
    });
    watcher.wait_until_entered();

    let stop_registry = Arc::clone(&registry);
    let stop_root = root.clone();
    let stop_thread = std::thread::spawn(move || stop_registry.stop(&path_string(&stop_root)));
    for _ in 0..100 {
        let cancelled = registry
            .transitions
            .lock()
            .expect("transitions")
            .values()
            .any(|transition| {
                matches!(
                    &transition.kind,
                    WorkspaceWatchTransitionKind::Starting { cancelled, .. }
                        if cancelled.load(Ordering::Acquire)
                )
            });
        if cancelled {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    watcher.sink().publish(WorkspaceWatchEventBatch {
        events: vec![root_rescan_event(&path_string(&root))],
    });
    assert!(recorder.payloads().is_empty());
    watcher.release();

    assert_eq!(
        start_thread.join().expect("start thread"),
        Err("Workspace watch start was cancelled.".to_string())
    );
    stop_thread.join().expect("stop thread");
    assert_eq!(watcher.stopped_roots(), vec![root.clone()]);

    let second = registry
        .start_with_watcher(&path_string(&root), &watcher, |_, _| {
            Arc::new(NoopWatchSink)
        })
        .expect("second start");
    assert_eq!(second.watch_generation, 2);
}

#[test]
fn watch_registry_drop_stops_all_sessions() {
    let watcher = RecordingWatcher::default();
    let root_a = temp_workspace("generic-watch-drop-a");
    let root_b = temp_workspace("generic-watch-drop-b");

    {
        let registry = WorkspaceFileChangeWatchRegistry::new();
        start_with_watcher(&registry, &root_a, &watcher);
        start_with_watcher(&registry, &root_b, &watcher);

        assert!(watcher.stopped_roots().is_empty());
    }

    let stopped = watcher.stopped_roots();
    assert_eq!(stopped.len(), 2);
    assert!(stopped.contains(&root_a));
    assert!(stopped.contains(&root_b));
}

fn event(kind: WorkspaceWatchEventKind, path: &str) -> WorkspaceWatchEvent {
    let rescan = matches!(kind, WorkspaceWatchEventKind::RescanRequired);
    WorkspaceWatchEvent {
        backend: WorkspaceWatchBackend::Native,
        file_kind: Some(if rescan {
            WorkspaceWatchFileKind::Directory
        } else {
            WorkspaceWatchFileKind::File
        }),
        kind,
        path: path.to_string(),
        previous_path: None,
        previous_relative_path: None,
        relative_path: if rescan {
            String::new()
        } else {
            path.trim_start_matches("/workspace/").to_string()
        },
        root_path: WORKSPACE_ROOT.to_string(),
    }
}

fn root_rescan_event(root_path: &str) -> WorkspaceWatchEvent {
    let mut event = event(WorkspaceWatchEventKind::RescanRequired, root_path);
    event.root_path = root_path.to_string();
    event
}

fn start_with_watcher(
    registry: &WorkspaceFileChangeWatchRegistry,
    root: &Path,
    watcher: &RecordingWatcher,
) -> WorkspaceFileWatchStartReceipt {
    registry
        .start_with_watcher(&path_string(root), watcher, |_, _| {
            Arc::new(NoopWatchSink) as Arc<dyn WorkspaceWatchEventSink>
        })
        .expect("start workspace watch")
}

#[derive(Clone, Default)]
struct RecordingEmitter {
    payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
}

impl RecordingEmitter {
    fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
        self.payloads.lock().expect("payloads").clone()
    }
}

impl WorkspaceFileChangeEmitter for RecordingEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        self.payloads
            .lock()
            .expect("payloads")
            .extend_from_slice(payloads);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FlakyEmitter {
    attempts: Arc<Mutex<usize>>,
    payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
}

impl FlakyEmitter {
    fn attempts(&self) -> usize {
        *self.attempts.lock().expect("attempts")
    }

    fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
        self.payloads.lock().expect("payloads").clone()
    }
}

impl WorkspaceFileChangeEmitter for FlakyEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        let mut attempts = self.attempts.lock().expect("attempts");
        *attempts += 1;
        if *attempts == 1 {
            return Err(0);
        }
        self.payloads
            .lock()
            .expect("payloads")
            .extend_from_slice(payloads);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct PartialEmitter {
    attempts: Arc<Mutex<usize>>,
    payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
}

impl PartialEmitter {
    fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
        self.payloads.lock().expect("payloads").clone()
    }
}

impl WorkspaceFileChangeEmitter for PartialEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        let mut attempts = self.attempts.lock().expect("attempts");
        *attempts += 1;
        if *attempts == 1 {
            self.payloads
                .lock()
                .expect("payloads")
                .push(payloads[0].clone());
            return Err(1);
        }
        self.payloads
            .lock()
            .expect("payloads")
            .extend_from_slice(payloads);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct BlockingEmitter {
    entered: Arc<AtomicBool>,
}

impl BlockingEmitter {
    fn wait_until_entered(&self) {
        for _ in 0..100 {
            if self.entered.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("blocking emitter was not entered");
    }
}

impl WorkspaceFileChangeEmitter for BlockingEmitter {
    fn emit_file_changes(&self, _payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        self.entered.store(true, Ordering::Release);
        std::thread::sleep(Duration::from_millis(250));
        Ok(())
    }
}

#[derive(Clone, Default)]
struct BlockingFailingEmitter {
    entered: Arc<AtomicBool>,
    released: Arc<AtomicBool>,
    attempts: Arc<AtomicUsize>,
}

impl BlockingFailingEmitter {
    fn wait_until_entered(&self) {
        for _ in 0..100 {
            if self.entered.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("blocking failing emitter was not entered");
    }

    fn release(&self) {
        self.released.store(true, Ordering::Release);
    }

    fn attempts(&self) -> usize {
        self.attempts.load(Ordering::Acquire)
    }
}

impl WorkspaceFileChangeEmitter for BlockingFailingEmitter {
    fn emit_file_changes(&self, _payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        self.attempts.fetch_add(1, Ordering::AcqRel);
        self.entered.store(true, Ordering::Release);
        while !self.released.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        Err(0)
    }
}

#[derive(Clone, Default)]
struct AlwaysFailEmitter {
    attempted_kinds: Arc<Mutex<Vec<WorkspaceWatchEventKind>>>,
}

struct PanickingEmitter;

impl WorkspaceFileChangeEmitter for PanickingEmitter {
    fn emit_file_changes(&self, _payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        panic!("emit panic");
    }
}

impl AlwaysFailEmitter {
    fn attempted_kinds(&self) -> Vec<WorkspaceWatchEventKind> {
        self.attempted_kinds
            .lock()
            .expect("attempted kinds")
            .clone()
    }
}

impl WorkspaceFileChangeEmitter for AlwaysFailEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        self.attempted_kinds
            .lock()
            .expect("attempted kinds")
            .push(payloads[0].kind);
        Err(0)
    }
}

#[derive(Clone, Default)]
struct RecoveringEmitter {
    attempts: Arc<Mutex<usize>>,
    delivered: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
}

impl RecoveringEmitter {
    fn delivered(&self) -> Vec<WorkspaceFileChangedPayload> {
        self.delivered.lock().expect("delivered").clone()
    }
}

impl WorkspaceFileChangeEmitter for RecoveringEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        let mut attempts = self.attempts.lock().expect("attempts");
        *attempts += 1;
        if *attempts <= 3 {
            return Err(0);
        }
        self.delivered
            .lock()
            .expect("delivered")
            .extend_from_slice(payloads);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct RecordingWatcher {
    sinks: Arc<Mutex<Vec<Arc<dyn WorkspaceWatchEventSink>>>>,
    started: Arc<Mutex<Vec<PathBuf>>>,
    stopped: Arc<Mutex<Vec<PathBuf>>>,
    stop_gate: Arc<Mutex<Option<Arc<BlockingStopGate>>>>,
}

impl RecordingWatcher {
    fn started_roots(&self) -> Vec<PathBuf> {
        self.started.lock().expect("started roots").clone()
    }

    fn stopped_roots(&self) -> Vec<PathBuf> {
        self.stopped.lock().expect("stopped roots").clone()
    }

    fn sink(&self, index: usize) -> Arc<dyn WorkspaceWatchEventSink> {
        Arc::clone(&self.sinks.lock().expect("watch sinks")[index])
    }

    fn block_stops(&self) -> Arc<BlockingStopGate> {
        let gate = Arc::new(BlockingStopGate::default());
        *self.stop_gate.lock().expect("stop gate") = Some(Arc::clone(&gate));
        gate
    }
}

impl WorkspaceFileWatcher for RecordingWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        self.started
            .lock()
            .expect("started roots")
            .push(request.root_path.clone());
        self.sinks.lock().expect("watch sinks").push(sink);

        Ok(Box::new(RecordingWatchSession {
            root_path: request.root_path,
            stopped: Arc::clone(&self.stopped),
            stop_gate: self.stop_gate.lock().expect("stop gate").clone(),
        }))
    }
}

struct RecordingWatchSession {
    root_path: PathBuf,
    stopped: Arc<Mutex<Vec<PathBuf>>>,
    stop_gate: Option<Arc<BlockingStopGate>>,
}

impl WorkspaceWatchSession for RecordingWatchSession {
    fn stop(&mut self) {
        if let Some(gate) = &self.stop_gate {
            gate.block();
        }
        self.stopped
            .lock()
            .expect("stopped roots")
            .push(self.root_path.clone());
    }
}

#[derive(Clone, Default)]
struct BlockingStartWatcher {
    entered: Arc<AtomicBool>,
    released: Arc<AtomicBool>,
    stopped: Arc<Mutex<Vec<PathBuf>>>,
    sink: Arc<Mutex<Option<Arc<dyn WorkspaceWatchEventSink>>>>,
}

impl BlockingStartWatcher {
    fn wait_until_entered(&self) {
        for _ in 0..100 {
            if self.entered.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("watch start did not reach the gate");
    }

    fn release(&self) {
        self.released.store(true, Ordering::Release);
    }

    fn stopped_roots(&self) -> Vec<PathBuf> {
        self.stopped.lock().expect("stopped roots").clone()
    }

    fn sink(&self) -> Arc<dyn WorkspaceWatchEventSink> {
        Arc::clone(
            self.sink
                .lock()
                .expect("watch sink")
                .as_ref()
                .expect("watch sink"),
        )
    }
}

impl WorkspaceFileWatcher for BlockingStartWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        *self.sink.lock().expect("watch sink") = Some(sink);
        self.entered.store(true, Ordering::Release);
        while !self.released.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        Ok(Box::new(RecordingWatchSession {
            root_path: request.root_path,
            stopped: Arc::clone(&self.stopped),
            stop_gate: None,
        }))
    }
}

struct PublishingFailWatcher;

impl WorkspaceFileWatcher for PublishingFailWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&request.root_path))],
        });
        Err(io::Error::other("watch failed after callback"))
    }
}

struct PublishingPanicWatcher;

impl WorkspaceFileWatcher for PublishingPanicWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&request.root_path))],
        });
        panic!("watch backend panic");
    }
}

#[derive(Default)]
struct BlockingStopGate {
    entered: AtomicBool,
    released: AtomicBool,
}

impl BlockingStopGate {
    fn block(&self) {
        self.entered.store(true, Ordering::Release);
        while !self.released.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
    }

    fn wait_until_entered(&self) {
        for _ in 0..100 {
            if self.entered.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("backend stop did not reach the gate");
    }

    fn release(&self) {
        self.released.store(true, Ordering::Release);
    }
}

struct NoopWatchSink;

impl WorkspaceWatchEventSink for NoopWatchSink {
    fn error(&self, _error: WorkspaceWatchError) {}

    fn publish(&self, _batch: WorkspaceWatchEventBatch) {}
}

fn temp_workspace(label: &str) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("editor-generic-watch-{label}-{}", unique_suffix()));
    fs::create_dir_all(&root).expect("temp workspace");
    root.canonicalize().expect("canonical temp workspace")
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
