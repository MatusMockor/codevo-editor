use super::*;

#[test]
fn deactivated_root_rejects_starts_until_reactivated() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    registry.activate_root("/workspace/one");
    registry.deactivate_root("/workspace/one");

    let rejected = registry.start_session("/workspace/one", sink.clone(), |_emitter| {
        Ok(Box::new(FakeAdapter::new(FakeAdapterState::default())))
    });
    assert_eq!(
        rejected,
        Err("The workspace debugger lifecycle is closed.".to_string())
    );

    registry.activate_root("/workspace/one");
    let started = registry.start_session("/workspace/one", sink, |_emitter| {
        Ok(Box::new(FakeAdapter::new(FakeAdapterState::default())))
    });
    assert!(started.is_ok());
}
#[test]
fn with_session_by_id_routes_to_matching_adapter() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (first_id, first_state) =
        start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
    let (_second_id, second_state) =
        start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

    let result = registry.with_session_by_id(first_id, |adapter| adapter.step(StepKind::StepOver));

    assert_eq!(result, Ok(Ok(())));
    assert_eq!(first_state.calls(), vec!["step:StepOver".to_string()]);
    assert!(second_state.calls().is_empty());
}

#[test]
fn with_session_by_root_returns_scripted_adapter_response() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let state = FakeAdapterState::default();
    let verified = vec![DebugBreakpoint {
        id: "bp-7".to_string(),
        file_path: "/workspace/one/src/app.ts".to_string(),
        line_number: 12,
        column_number: None,
        condition: None,
        hit_condition: None,
        log_message: None,
        enabled: true,
        verified: true,
    }];
    let adapter_state = state.clone();
    let scripted = verified.clone();
    registry
        .start_session("/workspace/one", sink, move |_emitter| {
            Ok(Box::new(FakeAdapter::with_breakpoint_response(
                adapter_state,
                Ok(scripted),
            )))
        })
        .expect("start session");

    let result = registry.with_session("/workspace/one", |adapter| {
        adapter.set_breakpoints("/workspace/one/src/app.ts", &[])
    });

    assert_eq!(result, Ok(Ok(verified)));
    assert_eq!(
        state.calls(),
        vec!["set_breakpoints:/workspace/one/src/app.ts:0".to_string()]
    );
}

#[test]
fn with_session_for_unknown_root_and_id_returns_error() {
    let registry = DebugSessionRegistry::new();

    let by_root = registry.with_session("/workspace/none", |adapter| adapter.pause());
    let by_id = registry.with_session_by_id(99, |adapter| adapter.pause());

    assert_eq!(
        by_root,
        Err("No debug session for workspace /workspace/none.".to_string())
    );
    assert_eq!(by_id, Err("No debug session with id 99.".to_string()));
}

#[test]
fn stop_terminates_adapter_and_emits_terminated_with_monotonic_seq() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (session_id, state) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

    let stopped = registry.stop("/workspace/one");

    assert!(stopped);
    assert!(state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    let events = sink.events();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].payload, DebugEventPayload::Started { session_id });
    assert_eq!(
        events[1].payload,
        DebugEventPayload::Terminated { exit_code: None }
    );
    assert_eq!(events[1].session_id, session_id);
    assert_eq!(events[0].seq, 1);
    assert_eq!(events[1].seq, 2);
}

#[test]
fn stop_by_id_removes_only_matching_session() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (first_id, first_state) =
        start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
    let (second_id, second_state) =
        start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

    let stopped = registry.stop_by_id(first_id);

    assert!(stopped);
    assert!(first_state.is_terminated());
    assert!(!second_state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    assert_eq!(
        registry.session_id_for_root("/workspace/two"),
        Some(second_id)
    );
}

#[test]
fn stop_for_unknown_targets_returns_false() {
    let registry = DebugSessionRegistry::new();

    assert!(!registry.stop("/workspace/none"));
    assert!(!registry.stop_by_id(42));
    assert!(!registry.finish_session(42, Some(0)));
}

#[test]
fn finish_session_emits_terminated_with_exit_code_and_unregisters() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (session_id, state) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

    let finished = registry.finish_session(session_id, Some(3));

    assert!(finished);
    assert!(!state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    let terminated = terminated_events(&sink);
    assert_eq!(terminated.len(), 1);
    assert_eq!(terminated[0].session_id, session_id);
    assert_eq!(terminated[0].seq, 2);
    assert_eq!(
        terminated[0].payload,
        DebugEventPayload::Terminated { exit_code: Some(3) }
    );
}

#[test]
fn finish_then_stop_emits_single_terminated() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (session_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

    assert!(registry.finish_session(session_id, Some(0)));
    assert!(!registry.stop("/workspace/one"));
    assert!(!registry.stop_by_id(session_id));
    registry.stop_all();

    assert_eq!(terminated_events(&sink).len(), 1);
}

#[test]
fn stop_then_finish_emits_single_terminated() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (session_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

    assert!(registry.stop("/workspace/one"));
    assert!(!registry.finish_session(session_id, Some(0)));

    assert_eq!(terminated_events(&sink).len(), 1);
}

#[test]
fn stop_all_terminates_every_session() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (_, first_state) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
    let (_, second_state) = start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

    registry.stop_all();

    assert!(first_state.is_terminated());
    assert!(second_state.is_terminated());
    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    assert_eq!(registry.session_id_for_root("/workspace/two"), None);
}

#[test]
fn stop_all_terminates_every_member_of_a_group() {
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

    registry.stop_all();

    assert!(first_state.is_terminated());
    assert!(second_state.is_terminated());
    assert_eq!(registry.session_id_for_root(root), None);
    assert_eq!(terminated_events(&sink).len(), 2);
}

#[test]
fn dropping_registry_terminates_sessions() {
    let sink = Arc::new(CollectingSink::default());
    let state = FakeAdapterState::default();
    {
        let registry = DebugSessionRegistry::new();
        let adapter_state = state.clone();
        registry
            .start_session("/workspace/one", sink.clone(), move |_emitter| {
                Ok(Box::new(FakeAdapter::new(adapter_state)))
            })
            .expect("start session");
    }

    assert!(state.is_terminated());
    assert_eq!(
        sink.events().last().map(|event| event.payload.clone()),
        Some(DebugEventPayload::Terminated { exit_code: None })
    );
}

#[test]
fn emitter_seq_stays_monotonic_across_threads() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    let captured_emitter: Arc<Mutex<Option<DebugEventEmitter>>> = Arc::new(Mutex::new(None));
    let state = FakeAdapterState::default();
    let adapter_state = state.clone();
    let emitter_slot = Arc::clone(&captured_emitter);
    registry
        .start_session("/workspace/one", sink.clone(), move |emitter| {
            *emitter_slot.lock().expect("emitter slot") = Some(emitter);
            Ok(Box::new(FakeAdapter::new(adapter_state)))
        })
        .expect("start session");
    let emitter = captured_emitter
        .lock()
        .expect("emitter slot")
        .clone()
        .expect("captured emitter");

    let handles: Vec<_> = (0..2)
        .map(|thread_index| {
            let emitter = emitter.clone();
            thread::spawn(move || {
                for message_index in 0..50 {
                    emitter.emit(DebugEventPayload::Output {
                        stream: DebugOutputStream::Stdout,
                        text: format!("{thread_index}:{message_index}"),
                        truncated: false,
                    });
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("emitter thread");
    }

    let events = sink.events();
    assert_eq!(events.len(), 101);
    let mut seqs: Vec<u64> = events.iter().map(|event| event.seq).collect();
    seqs.sort_unstable();
    assert_eq!(seqs, (1..=101).collect::<Vec<u64>>());
}

#[test]
fn concurrent_starts_on_distinct_roots_register_both_sessions() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());

    let handles: Vec<_> = ["/workspace/one", "/workspace/two"]
        .into_iter()
        .map(|root_key| {
            let registry = Arc::clone(&registry);
            let sink = Arc::clone(&sink);
            thread::spawn(move || {
                let state = FakeAdapterState::default();
                registry
                    .start_session(root_key, sink, move |_emitter| {
                        Ok(Box::new(FakeAdapter::new(state)))
                    })
                    .expect("start session")
            })
        })
        .collect();
    let session_ids: Vec<u64> = handles
        .into_iter()
        .map(|handle| handle.join().expect("start thread"))
        .collect();

    assert_ne!(session_ids[0], session_ids[1]);
    assert!(registry.session_id_for_root("/workspace/one").is_some());
    assert!(registry.session_id_for_root("/workspace/two").is_some());
    assert_eq!(sink.events().len(), 2);
}

#[test]
fn newer_same_root_start_serializes_factories_and_invalidates_the_older_permit() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(CollectingSink::default());
    registry.activate_root("/workspace/one");
    let first_permit = registry
        .begin_start("/workspace/one")
        .expect("first permit");
    let first_observer = first_permit.clone();
    let first_state = FakeAdapterState::default();
    let active_factories = Arc::new(AtomicUsize::new(0));
    let maximum_factories = Arc::new(AtomicUsize::new(0));
    let (first_entered_tx, first_entered_rx) = mpsc::channel();
    let (release_first_tx, release_first_rx) = mpsc::channel();
    let first_registry = Arc::clone(&registry);
    let first_sink = Arc::clone(&sink);
    let first_factory_state = first_state.clone();
    let first_active = Arc::clone(&active_factories);
    let first_maximum = Arc::clone(&maximum_factories);
    let first = thread::spawn(move || {
        first_registry.start_session_with_permit(first_permit, first_sink, move |_emitter| {
            let active = first_active.fetch_add(1, Ordering::SeqCst) + 1;
            first_maximum.fetch_max(active, Ordering::SeqCst);
            first_entered_tx.send(()).expect("first entered");
            release_first_rx.recv().expect("release first");
            first_active.fetch_sub(1, Ordering::SeqCst);
            Ok(Box::new(FakeAdapter::new(first_factory_state)))
        })
    });

    first_entered_rx.recv().expect("first factory entered");
    let second_permit = registry
        .begin_start("/workspace/one")
        .expect("second permit");
    let second_observer = second_permit.clone();
    assert!(!registry.startup_is_current(&first_observer));
    assert!(registry.startup_is_current(&second_observer));
    let second_state = FakeAdapterState::default();
    let second_registry = Arc::clone(&registry);
    let second_sink = Arc::clone(&sink);
    let second_factory_state = second_state.clone();
    let second_active = Arc::clone(&active_factories);
    let second_maximum = Arc::clone(&maximum_factories);
    let (second_entered_tx, second_entered_rx) = mpsc::channel();
    let second = thread::spawn(move || {
        second_registry.start_session_with_permit(second_permit, second_sink, move |_emitter| {
            let active = second_active.fetch_add(1, Ordering::SeqCst) + 1;
            second_maximum.fetch_max(active, Ordering::SeqCst);
            second_entered_tx.send(()).expect("second entered");
            second_active.fetch_sub(1, Ordering::SeqCst);
            Ok(Box::new(FakeAdapter::new(second_factory_state)))
        })
    });

    assert!(second_entered_rx
        .recv_timeout(Duration::from_millis(50))
        .is_err());
    release_first_tx.send(()).expect("release first");
    assert_eq!(
        first.join().expect("first worker"),
        Err("The workspace debugger lifecycle changed during startup.".to_string())
    );
    second_entered_rx.recv().expect("second factory entered");
    let second_id = second
        .join()
        .expect("second worker")
        .expect("second registered");

    assert_eq!(maximum_factories.load(Ordering::SeqCst), 1);
    assert!(first_state.is_terminated());
    assert!(!second_state.is_terminated());
    assert_eq!(
        registry.session_id_for_root("/workspace/one"),
        Some(second_id)
    );
    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].session_id, second_id);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { session_id } if session_id == second_id
    ));
}

#[test]
fn global_startup_cap_rejects_the_seventeenth_in_flight_permit() {
    let registry = DebugSessionRegistry::new();
    let permits: Vec<_> = (0..16)
        .map(|index| {
            registry
                .begin_start(&format!("/workspace/{index}"))
                .expect("startup slot")
        })
        .collect();

    assert_eq!(
        registry.begin_start("/workspace/overflow").unwrap_err(),
        "Too many debugger sessions are starting; the global limit is 16."
    );
    drop(permits);
    assert!(registry.begin_start("/workspace/recovered").is_ok());
}

#[test]
fn deactivation_invalidates_all_concurrent_start_permits_from_the_previous_epoch() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    registry.activate_root("/workspace/one");
    let first_permit = registry
        .begin_start("/workspace/one")
        .expect("first startup permit");
    let second_permit = registry
        .begin_start("/workspace/one")
        .expect("second startup permit");

    registry.deactivate_root("/workspace/one");

    for permit in [first_permit, second_permit] {
        let adapter_state = FakeAdapterState::default();
        let factory_state = adapter_state.clone();
        let result = registry.start_session_with_permit(
            permit,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |_emitter| Ok(Box::new(FakeAdapter::new(factory_state))),
        );
        assert_eq!(
            result,
            Err("The workspace debugger lifecycle changed during startup.".to_string())
        );
        assert!(!adapter_state.is_terminated());
    }

    assert_eq!(registry.session_id_for_root("/workspace/one"), None);
    assert!(sink.events().is_empty());
}
