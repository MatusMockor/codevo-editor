use super::session_routing::{
    serialize_cdp_request, CdpSessionEventDispatch, CdpSessionId, CdpSessionRegistration,
    CdpSessionRequestError, CdpSessionResponseDispatch, CdpSessionRouter, CdpSessionRoutingError,
    CdpTargetScope, MAX_CONCURRENT_CDP_SESSIONS, MAX_PENDING_CDP_REQUESTS_PER_SESSION,
    MAX_TOTAL_PENDING_CDP_REQUESTS,
};
use super::*;
use crate::debug_adapter::DebugEventPayload;
use crate::debug_cdp::event_sink::{CdpEventDisposition, CdpEventSinkPort};
use std::sync::atomic::{AtomicU64 as TestAtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Barrier;

fn session_id(value: &str) -> CdpSessionId {
    CdpSessionId::parse(value).expect("valid session id")
}

fn sink() -> super::session_routing::CdpSessionEventSink {
    Arc::new(|_, _| {})
}

fn registration_generation(registration: CdpSessionRegistration) -> u64 {
    match registration {
        CdpSessionRegistration::Registered { generation }
        | CdpSessionRegistration::Replaced { generation } => generation,
    }
}

struct CountingParentSink(Arc<AtomicUsize>);

impl CdpEventSinkPort for CountingParentSink {
    fn emit(&self, _payload: DebugEventPayload) -> CdpEventDisposition {
        self.0.fetch_add(1, AtomicOrdering::SeqCst);
        CdpEventDisposition::Delivered
    }
}

fn socket_loop_context(
    disconnect_notifier: DisconnectNotifier,
    pending: PendingCdpRequests,
    parent_events: Arc<AtomicUsize>,
) -> SocketLoopContext {
    let (_outgoing, outgoing) = mpsc::sync_channel(1);
    let (function_breakpoint_trigger, _function_breakpoint_triggers) = mpsc::sync_channel(1);
    SocketLoopContext {
        disconnect_notifier,
        emitter: CdpEventEmitter::new(Arc::new(CountingParentSink(parent_events))),
        exception_filter: Arc::new(Mutex::new(ExceptionFilterState::default())),
        next_request_id: Arc::new(AtomicU64::new(1)),
        outgoing,
        pending,
        request_timeout: Duration::from_secs(1),
        shared: empty_shared_state_for_test(),
        shutdown: Arc::new(AtomicBool::new(false)),
        mutation_is_allowed: Arc::new(|| true),
        function_breakpoint_trigger,
        function_breakpoints: Arc::new(
            crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState::default(),
        ),
    }
}

#[test]
fn parent_frame_serialization_is_byte_identical_to_existing_shape() {
    let expected =
        "{\"id\":7,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"2 + 2\"}}";
    assert_eq!(
        serialize_cdp_request(
            &CdpTargetScope::Parent,
            7,
            "Runtime.evaluate",
            json!({"expression": "2 + 2"}),
        ),
        expected
    );
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (outgoing, frames) = mpsc::sync_channel(1);
    let handle = CdpRequestHandle {
        disconnect_notifier: DisconnectNotifier::new(None),
        next_request_id: Arc::new(AtomicU64::new(7)),
        outgoing,
        pending: Arc::clone(&pending),
        request_timeout: Duration::from_secs(1),
        shutdown_requested: Arc::new(AtomicBool::new(false)),
    };
    let worker = thread::spawn(move || {
        handle.request_with_timeout(
            "Runtime.evaluate",
            json!({"expression": "2 + 2"}),
            Duration::from_secs(1),
        )
    });

    assert_eq!(
        frames.recv_timeout(Duration::from_millis(50)).unwrap(),
        expected
    );
    pending
        .lock()
        .unwrap()
        .remove(&7)
        .unwrap()
        .send(Ok(json!({})))
        .unwrap();
    assert_eq!(worker.join().unwrap(), Ok(json!({})));
}

#[test]
fn session_frame_serialization_adds_only_the_flat_protocol_scope() {
    assert_eq!(
        serialize_cdp_request(
            &CdpTargetScope::Session(session_id("child")),
            7,
            "Runtime.evaluate",
            json!({"expression": "2 + 2"}),
        ),
        "{\"id\":7,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"2 + 2\"},\"sessionId\":\"child\"}"
    );
}

#[test]
fn transport_wide_ids_across_two_sessions_resolve_only_the_exact_waiter() {
    let router = CdpSessionRouter::new();
    let first = session_id("first");
    let second = session_id("second");
    router.register(first.clone(), sink()).unwrap();
    router.register(second.clone(), sink()).unwrap();
    let first_request = router.begin_request(&first).unwrap();
    let second_request = router.begin_request(&second).unwrap();
    assert_ne!(first_request.id(), second_request.id());

    router.dispatch_response(
        &second,
        second_request.id(),
        &json!({"id": second_request.id(), "sessionId": "second", "result": {"owner": "second"}}),
    );
    router.dispatch_response(
        &first,
        first_request.id(),
        &json!({"id": first_request.id(), "sessionId": "first", "result": {"owner": "first"}}),
    );

    assert_eq!(
        first_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"owner": "first"}))
    );
    assert_eq!(
        second_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"owner": "second"}))
    );
}

#[test]
fn session_response_cannot_complete_parent_request() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let child_request = router.begin_request(&child).unwrap();
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (parent_tx, parent_rx) = mpsc::sync_channel(1);
    pending
        .lock()
        .unwrap()
        .insert(child_request.id(), parent_tx);

    router.dispatch_response(
        &child,
        child_request.id(),
        &json!({"id": child_request.id(), "sessionId": "child", "result": {"child": true}}),
    );

    assert_eq!(parent_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
    assert_eq!(
        child_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"child": true}))
    );
}

#[test]
fn parent_response_cannot_complete_session_request() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let child_request = router.begin_request(&child).unwrap();
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let shutdown = AtomicBool::new(false);
    let notifier = DisconnectNotifier::new(None);

    dispatch_response(
        child_request.id(),
        &json!({"id": child_request.id(), "result": {"parent": true}}),
        &pending,
        &shutdown,
        &notifier,
    );

    assert_eq!(child_request.try_recv(), Err(mpsc::TryRecvError::Empty));
    router.detach(&child);
    assert_eq!(
        child_request.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::Detached)
    );
}

#[test]
fn raw_session_response_with_colliding_parent_id_completes_only_session_waiter() {
    let notifier = DisconnectNotifier::new(None);
    let router = notifier.session_router();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let child_request = router.begin_request(&child).unwrap();
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (parent_tx, parent_rx) = mpsc::sync_channel(1);
    pending
        .lock()
        .unwrap()
        .insert(child_request.id(), parent_tx);
    let context = socket_loop_context(
        notifier,
        Arc::clone(&pending),
        Arc::new(AtomicUsize::new(0)),
    );

    assert_eq!(
        handle_incoming_message(
            &json!({
                "id": child_request.id(),
                "sessionId": "child",
                "result": {"child": true},
            })
            .to_string(),
            &context,
        ),
        None
    );

    assert_eq!(parent_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
    assert_eq!(
        child_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"child": true}))
    );
}

#[test]
fn raw_parent_response_with_colliding_session_id_completes_only_parent_waiter() {
    let notifier = DisconnectNotifier::new(None);
    let router = notifier.session_router();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let child_request = router.begin_request(&child).unwrap();
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (parent_tx, parent_rx) = mpsc::sync_channel(1);
    pending
        .lock()
        .unwrap()
        .insert(child_request.id(), parent_tx);
    let context = socket_loop_context(
        notifier,
        Arc::clone(&pending),
        Arc::new(AtomicUsize::new(0)),
    );

    assert_eq!(
        handle_incoming_message(
            &json!({"id": child_request.id(), "result": {"parent": true}}).to_string(),
            &context,
        ),
        None
    );

    assert_eq!(
        parent_rx.recv_timeout(Duration::from_millis(50)),
        Ok(Ok(json!({"parent": true})))
    );
    assert_eq!(child_request.try_recv(), Err(mpsc::TryRecvError::Empty));
    assert!(router.detach(&child));
}

#[test]
fn unknown_session_event_is_dropped_without_touching_parent() {
    let notifier = DisconnectNotifier::new(None);
    let router = notifier.session_router();
    let parent_events = Arc::new(AtomicUsize::new(0));
    let context = socket_loop_context(
        notifier,
        Arc::new(Mutex::new(HashMap::new())),
        Arc::clone(&parent_events),
    );

    assert_eq!(
        handle_incoming_message(
            &json!({
                "method": "Debugger.resumed",
                "sessionId": "unknown",
            })
            .to_string(),
            &context,
        ),
        None
    );

    assert_eq!(parent_events.load(AtomicOrdering::SeqCst), 0);
    assert_eq!(router.dropped_message_count(), 1);
    assert_eq!(
        handle_incoming_message(
            &json!({
                "method": "Debugger.resumed",
            })
            .to_string(),
            &context,
        ),
        None
    );
    assert_eq!(parent_events.load(AtomicOrdering::SeqCst), 1);
}

#[test]
fn raw_session_frames_with_non_u64_ids_are_dropped_not_dispatched_as_events() {
    let notifier = DisconnectNotifier::new(None);
    let router = notifier.session_router();
    let child = session_id("child");
    let session_events = Arc::new(AtomicUsize::new(0));
    let session_events_capture = Arc::clone(&session_events);
    router
        .register(
            child,
            Arc::new(move |_, _| {
                session_events_capture.fetch_add(1, AtomicOrdering::SeqCst);
            }),
        )
        .unwrap();
    let context = socket_loop_context(
        notifier,
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(AtomicUsize::new(0)),
    );

    for id in [json!(-1), json!(1.5)] {
        assert_eq!(
            handle_incoming_message(
                &json!({
                    "id": id,
                    "method": "Runtime.consoleAPICalled",
                    "sessionId": "child",
                })
                .to_string(),
                &context,
            ),
            None
        );
    }

    assert_eq!(session_events.load(AtomicOrdering::SeqCst), 0);
    assert_eq!(router.dropped_message_count(), 2);
}

#[test]
fn session_event_reaches_only_its_registered_sink() {
    let router = CdpSessionRouter::new();
    let first = session_id("first");
    let second = session_id("second");
    let first_events = Arc::new(Mutex::new(Vec::new()));
    let second_events = Arc::new(Mutex::new(Vec::new()));
    let first_capture = Arc::clone(&first_events);
    let second_capture = Arc::clone(&second_events);
    router
        .register(
            first.clone(),
            Arc::new(move |_, message| first_capture.lock().unwrap().push(message)),
        )
        .unwrap();
    router
        .register(
            second.clone(),
            Arc::new(move |_, message| second_capture.lock().unwrap().push(message)),
        )
        .unwrap();
    let event = json!({
        "method": "Runtime.consoleAPICalled",
        "params": {"type": "log"},
        "sessionId": "second",
    });

    assert_eq!(
        router.dispatch_event(&second, &event),
        CdpSessionEventDispatch::Delivered
    );

    assert!(first_events.lock().unwrap().is_empty());
    assert_eq!(*second_events.lock().unwrap(), vec![event]);
}

#[test]
fn detached_generation_makes_in_progress_event_fail_closed_at_sink() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    let active_generation = Arc::new(TestAtomicU64::new(0));
    let accepted_events = Arc::new(AtomicUsize::new(0));
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let release_rx = Arc::new(Mutex::new(release_rx));
    let active_generation_capture = Arc::clone(&active_generation);
    let accepted_events_capture = Arc::clone(&accepted_events);
    let release_rx_capture = Arc::clone(&release_rx);
    let registration = router
        .register(
            child.clone(),
            Arc::new(move |generation, _| {
                entered_tx.send(generation).unwrap();
                release_rx_capture
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(1))
                    .unwrap();
                if active_generation_capture.load(AtomicOrdering::Acquire) != generation {
                    return;
                }
                accepted_events_capture.fetch_add(1, AtomicOrdering::SeqCst);
            }),
        )
        .unwrap();
    let generation = registration_generation(registration);
    active_generation.store(generation, AtomicOrdering::Release);
    let dispatch_router = router.clone();
    let dispatch_child = child.clone();
    let dispatch = thread::spawn(move || {
        dispatch_router.dispatch_event(
            &dispatch_child,
            &json!({
                "method": "Runtime.consoleAPICalled",
                "sessionId": "child",
            }),
        )
    });

    assert_eq!(
        entered_rx.recv_timeout(Duration::from_millis(50)),
        Ok(generation)
    );
    assert!(router.detach(&child));
    active_generation.store(0, AtomicOrdering::Release);
    release_tx.send(()).unwrap();

    assert_eq!(dispatch.join().unwrap(), CdpSessionEventDispatch::Delivered);
    assert_eq!(accepted_events.load(AtomicOrdering::SeqCst), 0);
}

#[test]
fn detach_settles_every_in_flight_session_request_immediately() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let first = router.begin_request(&child).unwrap();
    let second = router.begin_request(&child).unwrap();

    assert!(router.detach(&child));

    assert_eq!(
        first.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::Detached)
    );
    assert_eq!(
        second.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::Detached)
    );
}

#[test]
fn transport_close_settles_parent_and_all_sessions() {
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (parent_tx, parent_rx) = mpsc::sync_channel(1);
    pending.lock().unwrap().insert(1, parent_tx);
    let shutdown = AtomicBool::new(false);
    let notifier = DisconnectNotifier::new(None);
    let router = notifier.session_router();
    let first = session_id("first");
    let second = session_id("second");
    router.register(first.clone(), sink()).unwrap();
    router.register(second.clone(), sink()).unwrap();
    let first_request = router.begin_request(&first).unwrap();
    let second_request = router.begin_request(&second).unwrap();

    fail_closed_transport(&pending, &shutdown, &notifier);

    assert_eq!(parent_rx.try_recv(), Err(mpsc::TryRecvError::Disconnected));
    assert_eq!(
        first_request.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::TransportClosed)
    );
    assert_eq!(
        second_request.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::TransportClosed)
    );
}

#[test]
fn registration_beyond_session_cap_fails_with_typed_error() {
    let router = CdpSessionRouter::new();
    for index in 0..MAX_CONCURRENT_CDP_SESSIONS {
        assert_eq!(
            router
                .register(session_id(&format!("session-{index}")), sink())
                .unwrap(),
            CdpSessionRegistration::Registered {
                generation: (index + 1) as u64
            }
        );
    }

    assert_eq!(
        router.register(session_id("over-cap"), sink()),
        Err(CdpSessionRoutingError::SessionLimitReached)
    );
}

#[test]
fn sink_panic_does_not_poison_router_or_strand_pending_requests() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router
        .register(child.clone(), Arc::new(|_, _| panic!("sink panic")))
        .unwrap();

    assert_eq!(
        router.dispatch_event(
            &child,
            &json!({"method": "Runtime.consoleAPICalled", "sessionId": "child"}),
        ),
        CdpSessionEventDispatch::SinkPanicked
    );

    let request = router.begin_request(&child).unwrap();
    router.dispatch_response(
        &child,
        request.id(),
        &json!({"id": request.id(), "sessionId": "child", "result": {"ok": true}}),
    );
    assert_eq!(
        request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"ok": true}))
    );
}

#[test]
fn disconnected_session_response_receiver_is_reported_accurately() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let mut request = router.begin_request(&child).unwrap();
    let request_id = request.id();
    request.disconnect_receiver();

    assert_eq!(
        router.dispatch_response(
            &child,
            request_id,
            &json!({
                "id": request_id,
                "sessionId": "child",
                "result": {"ignored": true},
            }),
        ),
        CdpSessionResponseDispatch::Disconnected
    );
}

#[test]
fn session_id_parser_rejects_empty_non_ascii_and_oversized_values() {
    assert!(CdpSessionId::parse("").is_err());
    assert!(CdpSessionId::parse("č").is_err());
    assert!(CdpSessionId::parse(&"a".repeat(129)).is_err());
    assert_eq!(
        CdpSessionId::parse(&"a".repeat(128))
            .unwrap()
            .as_str()
            .len(),
        128
    );
}

#[test]
fn replacing_session_settles_old_requests_and_preserves_registration_slot() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    assert_eq!(
        router.register(child.clone(), sink()).unwrap(),
        CdpSessionRegistration::Registered { generation: 1 }
    );
    let request = router.begin_request(&child).unwrap();
    let replaced_request_id = request.id();

    assert_eq!(
        router.register(child.clone(), sink()).unwrap(),
        CdpSessionRegistration::Replaced { generation: 2 }
    );

    assert_eq!(
        request.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::Replaced)
    );
    let replacement_request = router.begin_request(&child).unwrap();
    assert_ne!(replacement_request.id(), replaced_request_id);
    router.dispatch_response(
        &child,
        replaced_request_id,
        &json!({"id": replaced_request_id, "sessionId": "child", "result": {"stale": true}}),
    );
    assert_eq!(
        replacement_request.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    );
    router.dispatch_response(
        &child,
        replacement_request.id(),
        &json!({
            "id": replacement_request.id(),
            "sessionId": "child",
            "result": {"current": true},
        }),
    );
    assert_eq!(
        replacement_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"current": true}))
    );
}

#[test]
fn stale_response_after_detach_and_reregister_cannot_complete_new_request() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let stale_request = router.begin_request(&child).unwrap();
    let stale_request_id = stale_request.id();

    assert!(router.detach(&child));
    assert_eq!(
        stale_request.recv_timeout(Duration::from_millis(50)),
        Err(CdpSessionRequestError::Detached)
    );

    router.register(child.clone(), sink()).unwrap();
    let current_request = router.begin_request(&child).unwrap();
    assert_ne!(current_request.id(), stale_request_id);

    assert_eq!(
        router.dispatch_response(
            &child,
            stale_request_id,
            &json!({
                "id": stale_request_id,
                "sessionId": "child",
                "result": {"stale": true},
            }),
        ),
        super::session_routing::CdpSessionResponseDispatch::Dropped
    );
    assert_eq!(current_request.try_recv(), Err(mpsc::TryRecvError::Empty));

    router.dispatch_response(
        &child,
        current_request.id(),
        &json!({
            "id": current_request.id(),
            "sessionId": "child",
            "result": {"current": true},
        }),
    );
    assert_eq!(
        current_request.recv_timeout(Duration::from_millis(50)),
        Ok(json!({"current": true}))
    );
}

#[test]
fn per_session_pending_cap_fails_with_typed_error() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let mut requests = Vec::new();
    for _ in 0..MAX_PENDING_CDP_REQUESTS_PER_SESSION {
        requests.push(router.begin_request(&child).unwrap());
    }

    assert!(matches!(
        router.begin_request(&child),
        Err(CdpSessionRoutingError::SessionPendingLimitReached)
    ));

    router.detach(&child);
}

#[test]
fn total_pending_cap_fails_with_typed_error() {
    let router = CdpSessionRouter::new();
    let mut requests = Vec::new();
    for session_index in 0..MAX_CONCURRENT_CDP_SESSIONS {
        let child = session_id(&format!("session-{session_index}"));
        router.register(child.clone(), sink()).unwrap();
        for _ in 0..MAX_PENDING_CDP_REQUESTS_PER_SESSION {
            if requests.len() == MAX_TOTAL_PENDING_CDP_REQUESTS {
                break;
            }
            requests.push(router.begin_request(&child).unwrap());
        }
    }
    let child = session_id("session-31");

    assert!(matches!(
        router.begin_request(&child),
        Err(CdpSessionRoutingError::TotalPendingLimitReached)
    ));
}

#[test]
fn concurrent_register_dispatch_detach_and_close_settles_without_deadlock() {
    let router = CdpSessionRouter::new();
    let child = session_id("child");
    router.register(child.clone(), sink()).unwrap();
    let request = router.begin_request(&child).unwrap();
    let barrier = Arc::new(Barrier::new(5));

    let register_router = router.clone();
    let register_child = child.clone();
    let register_barrier = Arc::clone(&barrier);
    let register_thread = thread::spawn(move || {
        register_barrier.wait();
        for _ in 0..64 {
            assert!(matches!(
                register_router.register(register_child.clone(), sink()),
                Ok(CdpSessionRegistration::Registered { .. })
                    | Ok(CdpSessionRegistration::Replaced { .. })
                    | Err(CdpSessionRoutingError::TransportClosed)
            ));
        }
    });

    let dispatch_router = router.clone();
    let dispatch_child = child.clone();
    let dispatch_barrier = Arc::clone(&barrier);
    let dispatch_thread = thread::spawn(move || {
        dispatch_barrier.wait();
        for id in 1..=64 {
            dispatch_router.dispatch_response(
                &dispatch_child,
                id,
                &json!({
                    "id": id,
                    "sessionId": "child",
                    "result": {"race": id},
                }),
            );
            dispatch_router.dispatch_event(
                &dispatch_child,
                &json!({
                    "method": "Runtime.consoleAPICalled",
                    "sessionId": "child",
                }),
            );
        }
    });

    let detach_router = router.clone();
    let detach_child = child.clone();
    let detach_barrier = Arc::clone(&barrier);
    let detach_thread = thread::spawn(move || {
        detach_barrier.wait();
        for _ in 0..64 {
            detach_router.detach(&detach_child);
            assert!(matches!(
                detach_router.register(detach_child.clone(), sink()),
                Ok(CdpSessionRegistration::Registered { .. })
                    | Ok(CdpSessionRegistration::Replaced { .. })
                    | Err(CdpSessionRoutingError::TransportClosed)
            ));
        }
    });

    let close_router = router.clone();
    let close_barrier = Arc::clone(&barrier);
    let close_thread = thread::spawn(move || {
        close_barrier.wait();
        for _ in 0..64 {
            close_router.close_transport();
        }
    });

    barrier.wait();
    register_thread.join().unwrap();
    dispatch_thread.join().unwrap();
    detach_thread.join().unwrap();
    close_thread.join().unwrap();

    let outcome = request.recv_timeout(Duration::from_millis(100));
    assert!(matches!(
        outcome,
        Ok(_)
            | Err(CdpSessionRequestError::Detached)
            | Err(CdpSessionRequestError::Replaced)
            | Err(CdpSessionRequestError::TransportClosed)
    ));
    assert_eq!(
        router.register(child, sink()),
        Err(CdpSessionRoutingError::TransportClosed)
    );
}
