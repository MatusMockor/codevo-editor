#[path = "../src/debug_node_child_target_multiplexer.rs"]
mod debug_node_child_target_multiplexer;
#[path = "../src/debug_node_child_target_registry.rs"]
mod debug_node_child_target_registry;

use debug_node_child_target_multiplexer::{
    child_target_multiplex_readiness, BoundedChildTargetResponse, ChildTargetConnectionStrategy,
    ChildTargetMultiplexReadiness, ChildTargetResponseSource, ChildTargetTransport,
    ChildTargetTransportRequest, NodeChildTargetMultiplexer,
};
use debug_node_child_target_registry::{
    ChildInspectorEndpoint, ChildProcessIdentity, LoopbackInspectorHost, NodeChildTargetRegistry,
    OwnedNodeProcessGroup, OwnedNodeProcessGroupReaper, VerifiedChildInspectorObservation,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};
use std::{
    thread,
    time::{Duration, Instant},
};

struct PanicPayloadWithPanickingDrop;

impl Drop for PanicPayloadWithPanickingDrop {
    fn drop(&mut self) {
        panic!("panic payload was dropped");
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum FakeEvent {
    Connected {
        connection: usize,
        endpoint: ChildInspectorEndpoint,
        response_source: ChildTargetResponseSource,
    },
    Disconnected {
        connection: usize,
    },
    Sent {
        connection: usize,
        request_id: u64,
        request: ChildTargetTransportRequest,
    },
}

#[derive(Default)]
struct FakeTransportState {
    disconnect_gate: Option<Arc<DisconnectGate>>,
    events: Vec<FakeEvent>,
    fail_next_connect: bool,
    panic_next_connect: bool,
    panic_next_disconnect: bool,
    panic_next_send: bool,
    next_connection: usize,
    on_send: Option<Arc<dyn Fn(ChildTargetResponseSource, u64) + Send + Sync>>,
}

#[derive(Default)]
struct DisconnectGate {
    entered: AtomicUsize,
    released: Mutex<bool>,
    wake: Condvar,
}

struct FakeStrategy {
    state: Arc<Mutex<FakeTransportState>>,
}

struct FakeTransport {
    connection: usize,
    disconnected: bool,
    response_source: ChildTargetResponseSource,
    state: Arc<Mutex<FakeTransportState>>,
}

impl ChildTargetConnectionStrategy for FakeStrategy {
    type Transport = FakeTransport;

    fn connect(
        &mut self,
        _target: &debug_node_child_target_registry::ChildTargetAuthority,
        endpoint: &ChildInspectorEndpoint,
        response_source: ChildTargetResponseSource,
    ) -> Result<Self::Transport, String> {
        let mut state = self.state.lock().expect("fake transport state");
        if state.panic_next_connect {
            state.panic_next_connect = false;
            drop(state);
            std::panic::panic_any(PanicPayloadWithPanickingDrop);
        }
        if state.fail_next_connect {
            state.fail_next_connect = false;
            return Err("injected connect failure".to_string());
        }
        state.next_connection += 1;
        let connection = state.next_connection;
        state.events.push(FakeEvent::Connected {
            connection,
            endpoint: endpoint.clone(),
            response_source: response_source.clone(),
        });
        Ok(FakeTransport {
            connection,
            disconnected: false,
            response_source,
            state: Arc::clone(&self.state),
        })
    }
}

fn response_source(
    state: &Arc<Mutex<FakeTransportState>>,
    connection: usize,
) -> ChildTargetResponseSource {
    state
        .lock()
        .expect("fake transport state")
        .events
        .iter()
        .find_map(|event| match event {
            FakeEvent::Connected {
                connection: candidate,
                response_source,
                ..
            } if *candidate == connection => Some(response_source.clone()),
            _ => None,
        })
        .expect("response source")
}

impl ChildTargetTransport for FakeTransport {
    fn send(
        &mut self,
        request_id: u64,
        request: ChildTargetTransportRequest,
    ) -> Result<(), String> {
        if self.disconnected {
            return Err("fake transport is disconnected".to_string());
        }
        {
            let mut state = self.state.lock().expect("fake transport state");
            if state.panic_next_send {
                state.panic_next_send = false;
                drop(state);
                std::panic::panic_any(PanicPayloadWithPanickingDrop);
            }
        }
        self.state
            .lock()
            .expect("fake transport state")
            .events
            .push(FakeEvent::Sent {
                connection: self.connection,
                request_id,
                request,
            });
        let callback = self
            .state
            .lock()
            .expect("fake transport state")
            .on_send
            .clone();
        if let Some(callback) = callback {
            callback(self.response_source.clone(), request_id);
        }
        Ok(())
    }

    fn disconnect(&mut self) -> Result<(), String> {
        if self.disconnected {
            return Err("fake transport disconnected twice".to_string());
        }
        self.disconnected = true;
        let panic_after_gate = {
            let mut state = self.state.lock().expect("fake transport state");
            let panic = state.panic_next_disconnect;
            state.panic_next_disconnect = false;
            panic
        };
        self.state
            .lock()
            .expect("fake transport state")
            .events
            .push(FakeEvent::Disconnected {
                connection: self.connection,
            });
        let gate = self
            .state
            .lock()
            .expect("fake transport state")
            .disconnect_gate
            .clone();
        if let Some(gate) = gate {
            gate.entered.fetch_add(1, Ordering::SeqCst);
            let mut released = gate.released.lock().expect("disconnect gate");
            while !*released {
                released = gate.wake.wait(released).expect("disconnect gate wait");
            }
        }
        if panic_after_gate {
            std::panic::panic_any(PanicPayloadWithPanickingDrop);
        }
        Ok(())
    }
}

struct FakeReaper {
    calls: Arc<AtomicUsize>,
}

impl OwnedNodeProcessGroupReaper for FakeReaper {
    fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn endpoint(port: u16, target: &str) -> ChildInspectorEndpoint {
    ChildInspectorEndpoint::new(LoopbackInspectorHost::Ipv4, port, target).expect("endpoint")
}

fn observation(
    child_pid: u32,
    child_start_token: u64,
    endpoint: ChildInspectorEndpoint,
) -> VerifiedChildInspectorObservation {
    VerifiedChildInspectorObservation::new(
        vec![
            ChildProcessIdentity::new(100, 1, 100, 10).expect("root identity"),
            ChildProcessIdentity::new(child_pid, 100, 100, child_start_token)
                .expect("child identity"),
        ],
        endpoint,
    )
    .expect("observation")
}

fn harness() -> (
    NodeChildTargetMultiplexer<FakeReaper, FakeStrategy>,
    Arc<Mutex<FakeTransportState>>,
    Arc<AtomicUsize>,
) {
    let transport_state = Arc::new(Mutex::new(FakeTransportState::default()));
    let reaper_calls = Arc::new(AtomicUsize::new(0));
    let registry = NodeChildTargetRegistry::new(
        7,
        100,
        100,
        10,
        FakeReaper {
            calls: Arc::clone(&reaper_calls),
        },
    )
    .expect("registry");
    (
        NodeChildTargetMultiplexer::new(
            registry,
            FakeStrategy {
                state: Arc::clone(&transport_state),
            },
        ),
        transport_state,
        reaper_calls,
    )
}

#[test]
fn readiness_is_private_and_explicitly_blocked_without_a_kernel_authorized_connector() {
    assert_eq!(
        child_target_multiplex_readiness(),
        ChildTargetMultiplexReadiness::Blocked {
            reason:
                "Child-target multiplexing needs a private kernel-authorized CDP connection strategy."
        }
    );
}

#[test]
fn target_pending_request_and_response_inventories_are_bounded() {
    let (multiplexer, transport_state, _reaper) = harness();
    let oversized_inventory = (0..33)
        .map(|index| {
            observation(
                101 + index,
                11 + u64::from(index),
                endpoint(9229 + index as u16, &format!("child-{index}")),
            )
        })
        .collect();
    assert!(multiplexer.reconcile(1, oversized_inventory).is_err());
    assert!(transport_state.lock().expect("events").events.is_empty());

    let target = multiplexer
        .reconcile(2, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("bounded inventory")
        .remove(0);
    let mut requests = Vec::new();
    for _ in 0..4_096 {
        requests.push(
            multiplexer
                .request_pause(&target)
                .expect("bounded pending request"),
        );
    }
    assert!(multiplexer.request_pause(&target).is_err());
    let source = response_source(&transport_state, 1);
    assert!(multiplexer
        .accept_response(
            &source,
            requests.remove(0).request_id(),
            &"x".repeat(1024 * 1024 + 1),
        )
        .is_err());
    assert!(multiplexer.request_pause(&target).is_ok());
}

#[test]
fn failed_partial_connect_is_invalidated_and_retried_with_a_fresh_target_generation() {
    let (multiplexer, transport_state, _reaper) = harness();
    transport_state
        .lock()
        .expect("transport state")
        .fail_next_connect = true;
    assert!(multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .is_err());

    let target = multiplexer
        .reconcile(2, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("retry inventory")
        .remove(0);
    let pause = multiplexer.begin_pause(&target).expect("pause");
    let frame = multiplexer.admit_frame(&pause, "frame").expect("frame");
    assert!(multiplexer.request_frame(&frame).is_ok());
    assert_eq!(
        transport_state
            .lock()
            .expect("transport state")
            .events
            .iter()
            .filter(|event| matches!(event, FakeEvent::Connected { .. }))
            .count(),
        1
    );
}

#[test]
fn same_backend_frame_and_variable_ids_are_isolated_per_target_connection() {
    let (multiplexer, transport_state, _reaper) = harness();
    let targets = multiplexer
        .reconcile(
            1,
            vec![
                observation(101, 11, endpoint(9229, "child-a")),
                observation(102, 12, endpoint(9230, "child-b")),
            ],
        )
        .expect("reconcile");
    assert_eq!(targets.len(), 2);

    let pause_a = multiplexer.begin_pause(&targets[0]).expect("pause a");
    let pause_b = multiplexer.begin_pause(&targets[1]).expect("pause b");
    let frame_a = multiplexer
        .admit_frame(&pause_a, "same-frame")
        .expect("frame a");
    let frame_b = multiplexer
        .admit_frame(&pause_b, "same-frame")
        .expect("frame b");
    let variable_a = multiplexer
        .admit_variable(&frame_a, 77)
        .expect("variable a");
    let variable_b = multiplexer
        .admit_variable(&frame_b, 77)
        .expect("variable b");

    let frame_request_a = multiplexer
        .request_frame(&frame_a)
        .expect("request frame a");
    let frame_request_b = multiplexer
        .request_frame(&frame_b)
        .expect("request frame b");
    let variable_request_a = multiplexer
        .request_variables(&variable_a)
        .expect("request variables a");
    let variable_request_b = multiplexer
        .request_variables(&variable_b)
        .expect("request variables b");
    let source_a = response_source(&transport_state, 1);
    let source_b = response_source(&transport_state, 2);

    assert_eq!(
        multiplexer
            .accept_response(&source_b, frame_request_a.request_id(), "wrong child")
            .expect("reject wrong child"),
        None
    );
    assert_eq!(
        multiplexer
            .accept_response(&source_a, frame_request_a.request_id(), "frame-a")
            .expect("accept frame a"),
        Some(BoundedChildTargetResponse {
            payload: "frame-a".into()
        })
    );
    assert_eq!(
        multiplexer
            .accept_response(&source_a, frame_request_a.request_id(), "duplicate")
            .expect("reject duplicate frame a"),
        None
    );
    assert_eq!(
        multiplexer
            .accept_response(&source_b, frame_request_b.request_id(), "frame-b")
            .expect("accept frame b"),
        Some(BoundedChildTargetResponse {
            payload: "frame-b".into()
        })
    );
    assert!(multiplexer
        .accept_response(&source_a, variable_request_a.request_id(), "variables-a")
        .expect("accept variables a")
        .is_some());
    assert!(multiplexer
        .accept_response(&source_b, variable_request_b.request_id(), "variables-b")
        .expect("accept variables b")
        .is_some());

    let events = &transport_state.lock().expect("events").events;
    assert!(events.iter().any(|event| matches!(
        event,
        FakeEvent::Sent {
            connection: 1,
            request: ChildTargetTransportRequest::Frame { backend_frame_id },
            ..
        } if backend_frame_id.as_ref() == "same-frame"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        FakeEvent::Sent {
            connection: 2,
            request: ChildTargetTransportRequest::Frame { backend_frame_id },
            ..
        } if backend_frame_id.as_ref() == "same-frame"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        FakeEvent::Sent {
            connection: 1,
            request: ChildTargetTransportRequest::Variables {
                backend_frame_id,
                backend_variable_reference: 77
            },
            ..
        } if backend_frame_id.as_ref() == "same-frame"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        FakeEvent::Sent {
            connection: 2,
            request: ChildTargetTransportRequest::Variables {
                backend_frame_id,
                backend_variable_reference: 77
            },
            ..
        } if backend_frame_id.as_ref() == "same-frame"
    )));
}

#[test]
fn target_replacement_disconnects_the_old_transport_and_rejects_its_late_response() {
    let (multiplexer, transport_state, _reaper) = harness();
    let original = multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("original inventory")
        .remove(0);
    let pause = multiplexer.begin_pause(&original).expect("pause");
    let frame = multiplexer.admit_frame(&pause, "frame").expect("frame");
    let stale_request = multiplexer.request_frame(&frame).expect("request");
    let stale_source = response_source(&transport_state, 1);

    let replacement = multiplexer
        .reconcile(
            2,
            vec![observation(101, 11, endpoint(9339, "child-a-replacement"))],
        )
        .expect("replacement inventory")
        .remove(0);
    assert_ne!(original, replacement);
    assert_eq!(
        multiplexer
            .accept_response(&stale_source, stale_request.request_id(), "late")
            .expect("late response"),
        None
    );

    let pause = multiplexer
        .begin_pause(&replacement)
        .expect("replacement pause");
    let frame = multiplexer
        .admit_frame(&pause, "frame")
        .expect("replacement frame");
    let request = multiplexer
        .request_frame(&frame)
        .expect("replacement request");
    let fresh_source = response_source(&transport_state, 2);
    assert!(multiplexer
        .accept_response(&fresh_source, request.request_id(), "fresh")
        .expect("fresh response")
        .is_some());

    let events = &transport_state.lock().expect("events").events;
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, FakeEvent::Disconnected { connection: 1 }))
            .count(),
        1
    );
    assert!(events
        .iter()
        .any(|event| matches!(event, FakeEvent::Connected { connection: 2, .. })));
}

#[test]
fn resume_and_disconnect_invalidate_all_late_pause_lineage_responses() {
    let (multiplexer, transport_state, _reaper) = harness();
    let target = multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("inventory")
        .remove(0);
    let pause = multiplexer.begin_pause(&target).expect("pause");
    let frame = multiplexer.admit_frame(&pause, "frame").expect("frame");
    let variable = multiplexer.admit_variable(&frame, 41).expect("variable");
    let frame_request = multiplexer.request_frame(&frame).expect("frame request");
    let variable_request = multiplexer
        .request_variables(&variable)
        .expect("variable request");
    let source = response_source(&transport_state, 1);

    multiplexer.resume(&pause).expect("resume");
    assert_eq!(
        multiplexer
            .accept_response(&source, frame_request.request_id(), "late frame")
            .expect("late frame"),
        None
    );
    assert_eq!(
        multiplexer
            .accept_response(&source, variable_request.request_id(), "late variables")
            .expect("late variables"),
        None
    );

    let pending_pause = multiplexer.request_pause(&target).expect("pause request");
    multiplexer
        .disconnect_target(&target)
        .expect("disconnect target");
    assert_eq!(
        multiplexer
            .accept_response(&source, pending_pause.request_id(), "late pause")
            .expect("late pause"),
        None
    );
    let reconnected = multiplexer
        .reconcile(2, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("reconnect inventory")
        .remove(0);
    assert_ne!(target, reconnected);
    assert!(multiplexer.request_frame(&frame).is_err());
    assert!(multiplexer.request_variables(&variable).is_err());
    let fresh_pause = multiplexer.begin_pause(&reconnected).expect("fresh pause");
    let fresh_frame = multiplexer
        .admit_frame(&fresh_pause, "frame")
        .expect("fresh frame");
    assert!(multiplexer.request_frame(&fresh_frame).is_ok());

    let events = &transport_state.lock().expect("events").events;
    assert!(events.iter().any(|event| matches!(
        event,
        FakeEvent::Sent {
            request: ChildTargetTransportRequest::Resume,
            ..
        }
    )));
}

#[test]
fn transport_send_can_deliver_a_reentrant_response_without_holding_the_lifecycle_lock() {
    let (multiplexer, transport_state, _reaper) = harness();
    let multiplexer = Arc::new(multiplexer);
    let target = multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("inventory")
        .remove(0);
    let pause = multiplexer.begin_pause(&target).expect("pause");
    let frame = multiplexer.admit_frame(&pause, "frame").expect("frame");
    let accepted = Arc::new(AtomicUsize::new(0));
    let weak = Arc::downgrade(&multiplexer);
    let accepted_for_callback = Arc::clone(&accepted);
    transport_state.lock().expect("transport state").on_send =
        Some(Arc::new(move |source, request_id| {
            let result = weak
                .upgrade()
                .expect("multiplexer")
                .accept_response(&source, request_id, "inline")
                .expect("reentrant response");
            if result.is_some() {
                accepted_for_callback.fetch_add(1, Ordering::SeqCst);
            }
        }));

    let request = multiplexer.request_frame(&frame).expect("request");
    assert_eq!(accepted.load(Ordering::SeqCst), 1);
    let source = response_source(&transport_state, 1);
    assert_eq!(
        multiplexer
            .accept_response(&source, request.request_id(), "duplicate")
            .expect("duplicate"),
        None
    );
}

#[test]
fn a_hung_transport_disconnect_cannot_delay_owned_process_group_reap() {
    let (multiplexer, transport_state, reaper_calls) = harness();
    let multiplexer = Arc::new(multiplexer);
    multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("inventory");
    let gate = Arc::new(DisconnectGate::default());
    transport_state
        .lock()
        .expect("transport state")
        .disconnect_gate = Some(Arc::clone(&gate));

    let stopping = Arc::clone(&multiplexer);
    let stop = thread::spawn(move || stopping.stop_and_reap());
    let deadline = Instant::now() + Duration::from_secs(2);
    while gate.entered.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        thread::yield_now();
    }
    assert_eq!(gate.entered.load(Ordering::SeqCst), 1);
    assert_eq!(
        reaper_calls.load(Ordering::SeqCst),
        1,
        "process group must be reaped before transport cleanup can block"
    );
    assert!(!stop.is_finished());

    *gate.released.lock().expect("disconnect gate") = true;
    gate.wake.notify_all();
    assert_eq!(stop.join().expect("stop thread"), Ok(()));
    assert_eq!(multiplexer.stop_and_reap(), Ok(()));
    assert_eq!(reaper_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn stop_fans_out_disconnect_and_process_reap_exactly_once() {
    let (multiplexer, transport_state, reaper_calls) = harness();
    multiplexer
        .reconcile(
            1,
            vec![
                observation(101, 11, endpoint(9229, "child-a")),
                observation(102, 12, endpoint(9230, "child-b")),
            ],
        )
        .expect("inventory");
    assert_eq!(multiplexer.stop_and_reap(), Ok(()));
    assert_eq!(multiplexer.stop_and_reap(), Ok(()));
    drop(multiplexer);

    assert_eq!(reaper_calls.load(Ordering::SeqCst), 1);
    let events = &transport_state.lock().expect("events").events;
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, FakeEvent::Disconnected { connection: 1 }))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, FakeEvent::Disconnected { connection: 2 }))
            .count(),
        1
    );
}

#[test]
fn panicking_disconnect_publishes_one_terminal_error_to_concurrent_stops() {
    let (multiplexer, transport_state, reaper_calls) = harness();
    let multiplexer = Arc::new(multiplexer);
    multiplexer
        .reconcile(1, vec![observation(101, 11, endpoint(9229, "child-a"))])
        .expect("inventory");
    let gate = Arc::new(DisconnectGate::default());
    {
        let mut state = transport_state.lock().expect("transport state");
        state.disconnect_gate = Some(Arc::clone(&gate));
        state.panic_next_disconnect = true;
    }

    let first = {
        let multiplexer = Arc::clone(&multiplexer);
        thread::spawn(move || multiplexer.stop_and_reap())
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    while gate.entered.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        thread::yield_now();
    }
    assert_eq!(gate.entered.load(Ordering::SeqCst), 1);
    assert_eq!(reaper_calls.load(Ordering::SeqCst), 1);
    let concurrent = {
        let multiplexer = Arc::clone(&multiplexer);
        thread::spawn(move || multiplexer.stop_and_reap())
    };
    thread::sleep(Duration::from_millis(25));
    assert!(!concurrent.is_finished(), "concurrent stop must wait");
    *gate.released.lock().expect("disconnect gate") = true;
    gate.wake.notify_all();

    let expected = Err("Child target transport panicked during disconnect.".to_string());
    assert_eq!(first.join().expect("first stop"), expected);
    assert_eq!(concurrent.join().expect("concurrent stop"), expected);
    assert_eq!(multiplexer.stop_and_reap(), expected);
}

#[test]
fn panicking_connect_restores_strategy_and_retries_with_a_fresh_generation() {
    let (multiplexer, transport_state, _reaper) = harness();
    transport_state
        .lock()
        .expect("transport state")
        .panic_next_connect = true;
    let inventory = vec![observation(101, 11, endpoint(9229, "child-a"))];
    assert_eq!(
        multiplexer.reconcile(1, inventory.clone()),
        Err("Child-target connection strategy panicked.".to_string())
    );

    let fresh = multiplexer
        .reconcile(2, inventory)
        .expect("retry inventory")
        .remove(0);
    assert!(multiplexer.begin_pause(&fresh).is_ok());
    assert_eq!(
        transport_state
            .lock()
            .expect("transport state")
            .events
            .iter()
            .filter(|event| matches!(event, FakeEvent::Connected { .. }))
            .count(),
        1
    );
}

#[test]
fn panicking_send_retires_transport_and_requires_fresh_exact_authority() {
    let (multiplexer, transport_state, _reaper) = harness();
    let inventory = vec![observation(101, 11, endpoint(9229, "child-a"))];
    let stale = multiplexer
        .reconcile(1, inventory.clone())
        .expect("inventory")
        .remove(0);
    let pause = multiplexer.begin_pause(&stale).expect("pause");
    let frame = multiplexer.admit_frame(&pause, "frame").expect("frame");
    transport_state
        .lock()
        .expect("transport state")
        .panic_next_send = true;

    assert_eq!(
        multiplexer.request_frame(&frame),
        Err("Child target transport panicked during send.".to_string())
    );
    assert!(
        multiplexer.begin_pause(&stale).is_err(),
        "send panic must invalidate the exact old target authority"
    );

    let fresh = multiplexer
        .reconcile(2, inventory)
        .expect("fresh inventory")
        .remove(0);
    assert_ne!(fresh, stale);
    let fresh_pause = multiplexer.begin_pause(&fresh).expect("fresh pause");
    let fresh_frame = multiplexer
        .admit_frame(&fresh_pause, "frame")
        .expect("fresh frame");
    assert!(multiplexer.request_frame(&fresh_frame).is_ok());
}
