use super::*;
use std::collections::HashMap;

struct ReentrantRegistryDropSink {
    lock_available: Arc<AtomicBool>,
    supervisors: Arc<Mutex<HashMap<String, Arc<LanguageServerSupervisor>>>>,
}

impl StatusSink for ReentrantRegistryDropSink {
    fn emit_status(&self, status: LanguageServerRuntimeStatus) {
        if matches!(status, LanguageServerRuntimeStatus::Stopped) {
            self.lock_available
                .store(self.supervisors.try_lock().is_ok(), Ordering::SeqCst);
        }
    }
}

#[test]
fn registry_capacity_rejects_a_new_root_but_allows_existing_and_released_roots() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    {
        let mut supervisors = registry.supervisors.lock().expect("supervisors");
        for index in 0..64 {
            supervisors.insert(
                format!("/workspace/capacity-{index:02}"),
                Arc::new(LanguageServerSupervisor::new_with_label("Test server")),
            );
        }
    }

    assert!(Arc::ptr_eq(
        &registry
            .supervisor_for("/workspace/capacity-00")
            .expect("existing root remains admissible"),
        registry
            .supervisors
            .lock()
            .expect("supervisors")
            .get("/workspace/capacity-00")
            .expect("existing supervisor"),
    ));
    let overflow = registry.supervisor_for("/workspace/capacity-overflow");
    assert_eq!(
        overflow
            .err()
            .expect("new root must fail closed at capacity"),
        "Language server workspace capacity (64) was reached."
    );

    assert_eq!(
        registry.stop("/workspace/capacity-00"),
        LanguageServerRuntimeStatus::Stopped
    );
    registry
        .supervisor_for("/workspace/capacity-after-stop")
        .expect("Stop releases one supervisor slot");
}

#[test]
fn launch_context_capacity_rejects_without_evicting_a_retained_restart_recipe() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    {
        let mut contexts = registry.launch_contexts.lock().expect("launch contexts");
        for index in 0..64 {
            let root_path = format!("/workspace/retained-{index:02}");
            contexts.insert(
                workspace_runtime_id(&root_path),
                super::super::registry::JavaScriptTypeScriptLaunchContext {
                    command: command(),
                    initialize_request: initialize_request(),
                    root_path,
                    session_id: index as u64 + 1,
                },
            );
        }
    }
    let active_supervisor = registry
        .supervisor_for("/workspace/new-active")
        .expect("admit active supervisor");
    *active_supervisor.status.lock().expect("active status") = running_status();

    let error = registry
        .store_launch_context_if_active(
            "/workspace/new-active",
            &command(),
            &initialize_request(),
            &running_status(),
        )
        .expect_err("full launch context registry must reject");
    assert_eq!(
        error,
        "Language server launch context capacity (64) was reached; stop or dispose a retained workspace before starting another."
    );

    let contexts = registry.launch_contexts.lock().expect("launch contexts");
    assert_eq!(contexts.len(), 64);
    assert!(!contexts.contains_key(&workspace_runtime_id("/workspace/new-active")));
    assert!(contexts.contains_key(&workspace_runtime_id("/workspace/retained-00")));
    assert!(contexts.contains_key(&workspace_runtime_id("/workspace/retained-01")));
}

#[test]
fn launch_context_capacity_admits_after_stop_releases_a_retained_recipe() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    {
        let mut contexts = registry.launch_contexts.lock().expect("launch contexts");
        for index in 0..64 {
            let root_path = format!("/workspace/retained-{index:02}");
            contexts.insert(
                workspace_runtime_id(&root_path),
                super::super::registry::JavaScriptTypeScriptLaunchContext {
                    command: command(),
                    initialize_request: initialize_request(),
                    root_path,
                    session_id: index as u64 + 1,
                },
            );
        }
    }
    let protected = registry
        .supervisor_for("/workspace/retained-00")
        .expect("admit protected supervisor");
    *protected.status.lock().expect("protected status") = running_status();
    let new_active = registry
        .supervisor_for("/workspace/new-active")
        .expect("admit new supervisor");
    *new_active.status.lock().expect("new status") = running_status();

    let full_error = registry
        .store_launch_context_if_active(
            "/workspace/new-active",
            &command(),
            &initialize_request(),
            &running_status(),
        )
        .expect_err("full launch context registry");
    assert!(full_error.contains("launch context capacity"));
    assert_eq!(
        registry.stop("/workspace/retained-01"),
        LanguageServerRuntimeStatus::Stopped
    );
    registry
        .store_launch_context_if_active(
            "/workspace/new-active",
            &command(),
            &initialize_request(),
            &running_status(),
        )
        .expect("released retained recipe admits new owner");

    let contexts = registry.launch_contexts.lock().expect("launch contexts");
    assert_eq!(contexts.len(), 64);
    assert!(contexts.contains_key(&workspace_runtime_id("/workspace/retained-00")));
    assert!(contexts.contains_key(&workspace_runtime_id("/workspace/new-active")));
    assert!(!contexts.contains_key(&workspace_runtime_id("/workspace/retained-01")));
}

#[test]
fn failed_unique_starts_release_supervisor_capacity() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    for index in 0..=64 {
        let (sink, _rx) = ChannelSink::new();
        registry
            .start(
                &format!("/workspace/failing-{index:02}"),
                &command(),
                &initialize_request(),
                &FailingSpawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("failed spawn");
    }
    assert!(registry.supervisors.lock().expect("supervisors").is_empty());
}

#[test]
fn reserved_start_and_replacement_marker_capacity_fail_closed() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    {
        let mut supervisors = registry.registry.supervisors.lock().expect("supervisors");
        for index in 0..64 {
            supervisors.insert(
                format!("/workspace/capacity-{index:02}"),
                Arc::new(LanguageServerSupervisor::new_with_label("Test server")),
            );
        }
    }
    let (sink, _rx) = ChannelSink::new();
    let reservation = registry.reserve_start_cleanup("/workspace/overflow", sink.as_ref());
    assert_eq!(
        reservation
            .err()
            .expect("reserved start must reject at capacity"),
        "Language server workspace capacity (64) was reached."
    );

    registry
        .registry
        .supervisors
        .lock()
        .expect("supervisors")
        .clear();
    {
        let mut replacements = registry
            .start_replacements
            .lock()
            .expect("start replacements");
        for index in 0..64 {
            replacements.insert(format!("/workspace/replacement-{index:02}"));
        }
    }
    let marker_capacity =
        registry.reserve_start_cleanup("/workspace/replacement-overflow", sink.as_ref());
    assert_eq!(
        marker_capacity
            .err()
            .expect("replacement marker must reject at capacity"),
        "Language server start replacement capacity (64) was reached."
    );
    assert_eq!(
        registry
            .start_replacements
            .lock()
            .expect("start replacements")
            .len(),
        64
    );
}

#[test]
fn poisoned_registry_drop_stops_session_even_with_an_external_supervisor_arc() {
    let spawner = FakeSpawner::new(ready_script(), true);
    let held_writer = Arc::clone(&spawner.held_writer);
    let (sink, _rx) = ChannelSink::new();
    let registry = LanguageServerRegistry::new_with_label("Test server");
    registry
        .start(
            "/tmp/poisoned-registry",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let retained_supervisor = registry
        .existing_supervisor("/tmp/poisoned-registry")
        .expect("retain supervisor");

    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = registry.supervisors.lock().expect("supervisors");
        panic!("poison registry mutex");
    }));
    assert!(poisoned.is_err());
    drop(registry);

    assert!(held_writer.lock().expect("held writer").is_none());
    assert_eq!(
        retained_supervisor.status(),
        LanguageServerRuntimeStatus::Stopped
    );
}

#[test]
fn registry_drop_releases_global_lock_before_reentrant_stopped_callback() {
    let spawner = FakeSpawner::new(ready_script(), true);
    let held_writer = Arc::clone(&spawner.held_writer);
    let registry = LanguageServerRegistry::new_with_label("Test server");
    let lock_available = Arc::new(AtomicBool::new(false));
    let sink = Arc::new(ReentrantRegistryDropSink {
        lock_available: Arc::clone(&lock_available),
        supervisors: Arc::clone(&registry.supervisors),
    });
    registry
        .start(
            "/tmp/reentrant-registry-drop",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");

    drop(registry);

    let deadline = Instant::now() + Duration::from_secs(1);
    while !lock_available.load(Ordering::SeqCst) {
        assert!(
            Instant::now() < deadline,
            "stopped callback did not observe the released registry lock"
        );
        std::thread::yield_now();
    }
    assert!(held_writer.lock().expect("held writer").is_none());
}

#[test]
fn poisoned_registry_running_roots_preserves_live_sibling_authority() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    {
        let mut supervisors = registry.supervisors.lock().expect("supervisors");
        for (session_id, root_path) in ["/workspace/a", "/workspace/b"].into_iter().enumerate() {
            let supervisor = Arc::new(LanguageServerSupervisor::new_with_label("Test server"));
            *supervisor.status.lock().expect("status") = LanguageServerRuntimeStatus::Running {
                session_id: session_id as u64 + 1,
                capabilities: LanguageServerCapabilities::default(),
            };
            supervisors.insert(root_path.to_string(), supervisor);
        }
    }
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = registry.supervisors.lock().expect("supervisors");
        panic!("poison supervisors");
    }));
    assert!(poisoned.is_err());

    assert_eq!(
        registry.running_roots(),
        vec!["/workspace/a".to_string(), "/workspace/b".to_string()]
    );
}

#[test]
fn poisoned_typescript_cleanup_gate_allows_a_fresh_reservation() {
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = registry.cleanup_gate.lock().expect("cleanup gate");
        panic!("poison cleanup gate");
    }));
    assert!(poisoned.is_err());
    let (sink, _rx) = ChannelSink::new();

    let lease = registry
        .reserve_start_cleanup("/workspace/a", sink.as_ref())
        .expect("poison recovery admits reservation");
    drop(lease);
    assert!(registry
        .registry
        .supervisors
        .lock()
        .expect("supervisors")
        .is_empty());
}
