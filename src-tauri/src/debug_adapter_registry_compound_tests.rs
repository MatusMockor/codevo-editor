use super::*;

#[test]
fn grouped_start_preserves_siblings_and_exact_ownership() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let group = registry
        .begin_start_group("/workspace/compound")
        .expect("startup group");
    let first_permit = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second_permit = registry
        .begin_start_in_group(&group)
        .expect("second member permit");

    let (first_id, first_state) = start_group_member(&registry, first_permit, Arc::clone(&sink));
    let (second_id, second_state) = start_group_member(&registry, second_permit, Arc::clone(&sink));

    assert!(registry.owns_session("/workspace/compound", first_id));
    assert!(registry.owns_session("/workspace/compound", second_id));
    assert!(!registry.owns_session("/workspace/other", first_id));
    assert_eq!(
        registry.session_id_for_root("/workspace/compound"),
        Some(second_id)
    );
    assert!(!first_state.is_terminated());
    assert!(!second_state.is_terminated());
}
#[test]
fn grouped_stop_all_finish_invalidates_owner_and_terminates_every_sibling() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound-stop-all";
    let group = registry.begin_start_group(root).expect("startup group");
    let first = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) = start_group_member(&registry, first, Arc::clone(&sink));
    let (second_id, second_state) = start_group_member(&registry, second, Arc::clone(&sink));

    assert!(registry.finish_group_session(&group, first_id, Some(17)));

    assert!(!registry.startup_group_is_current(&group));
    assert!(!registry.owns_session(root, first_id));
    assert!(!registry.owns_session(root, second_id));
    assert!(!first_state.is_terminated());
    assert!(second_state.is_terminated());
    let terminated = terminated_events(&sink);
    assert_eq!(terminated.len(), 2);
    assert_eq!(
        terminated
            .iter()
            .find(|event| event.session_id == first_id)
            .map(|event| event.payload.clone()),
        Some(DebugEventPayload::Terminated {
            exit_code: Some(17)
        })
    );
}

#[test]
fn stopping_one_group_member_stops_all_siblings() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound-explicit-stop-all";
    let group = registry.begin_start_group(root).expect("startup group");
    let first = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) = start_group_member(&registry, first, Arc::clone(&sink));
    let (second_id, second_state) = start_group_member(&registry, second, Arc::clone(&sink));

    assert!(registry.stop_by_id(first_id));

    assert!(!registry.owns_session(root, first_id));
    assert!(!registry.owns_session(root, second_id));
    assert!(!registry.startup_group_is_current(&group));
    assert!(first_state.is_terminated());
    assert!(second_state.is_terminated());
}

#[test]
fn stale_group_rollback_never_terminates_a_newer_owner() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound-stale-rollback";
    let stale_group = registry.begin_start_group(root).expect("stale group");
    let stale_permit = registry
        .begin_start_in_group(&stale_group)
        .expect("stale member");
    let (_, stale_state) = start_group_member(&registry, stale_permit, Arc::clone(&sink));

    let fresh_group = registry.begin_start_group(root).expect("fresh group");
    let fresh_permit = registry
        .begin_start_in_group(&fresh_group)
        .expect("fresh member");
    let (fresh_id, fresh_state) = start_group_member(&registry, fresh_permit, Arc::clone(&sink));

    assert!(stale_state.is_terminated());
    assert!(!registry.abort_start_group(&stale_group));
    assert!(registry.owns_session_in_group(&fresh_group, fresh_id));
    assert!(!fresh_state.is_terminated());
}

#[test]
fn finish_and_stop_by_id_remove_only_the_exact_group_member() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let group = registry
        .begin_start_group("/workspace/compound")
        .expect("startup group");
    let first_permit = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second_permit = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) = start_group_member(&registry, first_permit, Arc::clone(&sink));
    let (second_id, second_state) = start_group_member(&registry, second_permit, Arc::clone(&sink));

    assert!(registry.finish_session(first_id, Some(0)));
    assert!(!registry.owns_session("/workspace/compound", first_id));
    assert!(registry.owns_session("/workspace/compound", second_id));
    assert!(!first_state.is_terminated());
    assert!(!second_state.is_terminated());

    assert!(registry.stop_by_id(second_id));
    assert!(second_state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/compound"), None);
}

#[test]
fn removing_latest_group_member_falls_back_to_previous_root_session() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound-fallback";
    let group = registry.begin_start_group(root).expect("startup group");
    let first_permit = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second_permit = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) = start_group_member(&registry, first_permit, Arc::clone(&sink));
    let (second_id, _) = start_group_member(&registry, second_permit, Arc::clone(&sink));

    assert!(registry.finish_session(second_id, Some(0)));

    assert_eq!(registry.session_id_for_root(root), Some(first_id));
    assert!(registry.owns_session(root, first_id));
    assert_eq!(
        registry.with_session(root, |adapter| adapter.pause()),
        Ok(Ok(()))
    );
    assert_eq!(first_state.calls(), vec!["pause".to_string()]);
}

#[test]
fn concurrent_group_finish_and_stop_all_keeps_indexes_consistent() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound-race";
    let group = registry.begin_start_group(root).expect("startup group");
    let first_permit = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second_permit = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) = start_group_member(&registry, first_permit, Arc::clone(&sink));
    let (second_id, second_state) = start_group_member(&registry, second_permit, Arc::clone(&sink));
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let finish_registry = Arc::clone(&registry);
    let finish_barrier = Arc::clone(&barrier);
    let finish = thread::spawn(move || {
        finish_barrier.wait();
        finish_registry.finish_session(first_id, Some(0))
    });
    let stop_registry = Arc::clone(&registry);
    let stop_barrier = Arc::clone(&barrier);
    let stop = thread::spawn(move || {
        stop_barrier.wait();
        stop_registry.stop_by_id(second_id)
    });

    barrier.wait();
    let finished_exactly = finish.join().expect("finish worker");
    assert!(stop.join().expect("stop worker"));

    assert_eq!(registry.session_id_for_root(root), None);
    assert!(!registry.owns_session(root, first_id));
    assert!(!registry.owns_session(root, second_id));
    assert_eq!(first_state.is_terminated(), !finished_exactly);
    assert!(second_state.is_terminated());
    assert_eq!(terminated_events(&sink).len(), 2);
}

#[test]
fn root_stop_and_deactivation_terminate_every_group_member() {
    for deactivate in [false, true] {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let root = if deactivate {
            "/workspace/deactivate-compound"
        } else {
            "/workspace/stop-compound"
        };
        let group = registry.begin_start_group(root).expect("startup group");
        let first = registry
            .begin_start_in_group(&group)
            .expect("first member permit");
        let second = registry
            .begin_start_in_group(&group)
            .expect("second member permit");
        let (_, first_state) = start_group_member(&registry, first, Arc::clone(&sink));
        let (_, second_state) = start_group_member(&registry, second, Arc::clone(&sink));

        let stopped = if deactivate {
            registry.deactivate_root(root)
        } else {
            registry.stop(root)
        };

        assert!(stopped);
        assert!(first_state.is_terminated());
        assert!(second_state.is_terminated());
        assert_eq!(registry.session_id_for_root(root), None);
        assert_eq!(terminated_events(&sink).len(), 2);
    }
}

#[test]
fn ordinary_start_supersedes_every_group_member() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/compound";
    let group = registry.begin_start_group(root).expect("startup group");
    let first = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (_, first_state) = start_group_member(&registry, first, Arc::clone(&sink));
    let (_, second_state) = start_group_member(&registry, second, Arc::clone(&sink));

    let (replacement_id, replacement_state) =
        start_fake_session(&registry, root, Arc::clone(&sink));

    assert!(first_state.is_terminated());
    assert!(second_state.is_terminated());
    assert!(!replacement_state.is_terminated());
    assert_eq!(registry.session_id_for_root(root), Some(replacement_id));
}

#[test]
fn newer_admission_and_deactivation_invalidate_group_member_permits() {
    for invalidate_with_deactivation in [false, true] {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let root = if invalidate_with_deactivation {
            "/workspace/group-deactivated"
        } else {
            "/workspace/group-replaced"
        };
        let group = registry.begin_start_group(root).expect("startup group");
        let permit = registry
            .begin_start_in_group(&group)
            .expect("member permit");
        let observer = permit.clone();

        if invalidate_with_deactivation {
            assert!(!registry.deactivate_root(root));
        } else {
            let replacement = registry.begin_start(root).expect("replacement permit");
            assert!(registry.startup_is_current(&replacement));
        }

        assert!(!registry.startup_is_current(&observer));
        let state = FakeAdapterState::default();
        let adapter_state = state.clone();
        assert_eq!(
            registry.start_session_with_permit(permit, sink.clone(), move |_emitter| {
                Ok(Box::new(FakeAdapter::new(adapter_state)))
            }),
            Err("The workspace debugger lifecycle changed during startup.".to_string())
        );
        assert!(!state.is_terminated());
        assert_eq!(registry.session_id_for_root(root), None);
    }
}

#[test]
fn newer_group_invalidates_old_group_but_preserves_its_own_members() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let root = "/workspace/group-generation";
    let old_group = registry.begin_start_group(root).expect("old group");
    let old_permit = registry
        .begin_start_in_group(&old_group)
        .expect("old member permit");
    let new_group = registry.begin_start_group(root).expect("new group");
    let first_new = registry
        .begin_start_in_group(&new_group)
        .expect("first new member");
    let second_new = registry
        .begin_start_in_group(&new_group)
        .expect("second new member");

    let old_state = FakeAdapterState::default();
    let old_adapter_state = old_state.clone();
    assert_eq!(
        registry.start_session_with_permit(old_permit, sink.clone(), move |_emitter| {
            Ok(Box::new(FakeAdapter::new(old_adapter_state)))
        }),
        Err("The workspace debugger lifecycle changed during startup.".to_string())
    );
    let (first_id, _) = start_group_member(&registry, first_new, Arc::clone(&sink));
    let (second_id, _) = start_group_member(&registry, second_new, Arc::clone(&sink));
    assert!(registry.owns_session(root, first_id));
    assert!(registry.owns_session(root, second_id));
    assert!(!old_state.is_terminated());
}

#[test]
fn start_session_propagates_factory_error_without_registering() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());

    let result = registry.start_session("/workspace/one", sink.clone(), |_emitter| {
        Err("Node inspector unavailable.".to_string())
    });

    assert_eq!(result, Err("Node inspector unavailable.".to_string()));
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    assert!(sink.events().is_empty());
}

#[test]
fn late_start_is_rejected_and_terminated_after_root_deactivation() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let adapter_state = FakeAdapterState::default();
    registry.activate_root("/workspace/one");
    let permit = registry
        .begin_start("/workspace/one")
        .expect("startup permit");
    let observed_permit = permit.clone();
    assert!(registry.startup_is_current(&observed_permit));
    let (factory_started_tx, factory_started_rx) = mpsc::channel();
    let (continue_tx, continue_rx) = mpsc::channel();
    let worker_registry = Arc::clone(&registry);
    let worker_sink = Arc::clone(&sink);
    let worker_state = adapter_state.clone();
    let worker = thread::spawn(move || {
        worker_registry.start_session_with_permit(permit, worker_sink, move |_emitter| {
            factory_started_tx.send(()).expect("factory started");
            continue_rx.recv().expect("continue startup");
            Ok(Box::new(FakeAdapter::new(worker_state)))
        })
    });

    factory_started_rx.recv().expect("factory start signal");
    registry.deactivate_root("/workspace/one");
    assert!(!registry.startup_is_current(&observed_permit));
    continue_tx.send(()).expect("release factory");
    let result = worker.join().expect("startup worker");

    assert_eq!(
        result,
        Err("The workspace debugger lifecycle changed during startup.".to_string())
    );
    assert!(adapter_state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    assert!(sink.events().is_empty());
}
