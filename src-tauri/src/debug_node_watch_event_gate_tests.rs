use super::*;
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventSink, DebugOutputStream, DebugScopeInfo,
    DebugStackFrame, DebugStopReason, DebugVariableInfo, StepKind,
};
use crate::debug_session_registry::DebugSessionRegistry;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct CollectingSink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for CollectingSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.0).push(event);
    }
}

#[derive(Default)]
struct ReentrantSink {
    events: Mutex<Vec<DebugEvent>>,
    callback: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl DebugEventSink for ReentrantSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.events).push(event);
        let callback = lock_recover(&self.callback).take();
        if let Some(callback) = callback {
            callback();
        }
    }
}

struct InertAdapter;

impl DebugAdapter for InertAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        Ok(breakpoints.to_vec())
    }

    fn step(&mut self, _kind: StepKind) -> Result<(), String> {
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        Ok(Vec::new())
    }

    fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        Ok(Vec::new())
    }

    fn evaluate(&mut self, _frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: String::new(),
            value_type: None,
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn terminate(&mut self) {}
}

fn fixture(
    root: &str,
) -> (
    DebugSessionRegistry,
    WatchDebugEventGate,
    Arc<CollectingSink>,
    u64,
) {
    let registry = DebugSessionRegistry::new();
    registry.activate_root(root);
    let sink = Arc::new(CollectingSink::default());
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    let session_id = registry
        .start_session(
            root,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&capture) = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("session starts");
    let emitter = lock_recover(&captured).take().expect("captured emitter");
    (
        registry,
        WatchDebugEventGate::new(emitter),
        sink,
        session_id,
    )
}

fn output(text: &str) -> DebugEventPayload {
    DebugEventPayload::Output {
        stream: DebugOutputStream::Stdout,
        text: text.to_string(),
        truncated: false,
    }
}

fn stopped(pause_generation: u64) -> DebugEventPayload {
    DebugEventPayload::Stopped {
        reason: DebugStopReason::Pause,
        frames: Vec::new(),
        pause_generation,
    }
}

fn events(sink: &CollectingSink) -> Vec<DebugEvent> {
    lock_recover(&sink.0).clone()
}

fn function_verification(generation: u64, entries: &[(&str, bool)]) -> DebugEventPayload {
    DebugEventPayload::FunctionBreakpointsVerified {
        generation,
        breakpoints: entries
            .iter()
            .map(
                |(id, verified)| crate::debug_adapter::DebugFunctionBreakpointVerification {
                    id: (*id).to_string(),
                    verified: *verified,
                },
            )
            .collect(),
    }
}

fn function_authority(
    desired_revision: u64,
    function_generation: u64,
    ordered_ids: &[String],
) -> WatchStartupFunctionBreakpointAuthority<'_> {
    WatchStartupFunctionBreakpointAuthority {
        desired_revision,
        function_generation,
        ordered_ids,
    }
}

#[test]
fn startup_function_receipt_is_full_and_ordered_before_late_partial_updates() {
    let (_registry, gate, sink, _session_id) = fixture("/workspace/function-receipt");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let ordered_ids = vec!["resolved".to_string(), "pending".to_string()];

    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        7,
        1,
        &ordered_ids,
        match function_verification(1, &[("resolved", true), ("pending", false)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    assert_eq!(
        gate.emit(&lease, function_verification(1, &[("pending", true)])),
        WatchEventDisposition::Buffered
    );
    assert_eq!(
        gate.emit(&lease, output("not a function update")),
        WatchEventDisposition::DroppedStale
    );
    assert!(gate.begin_publish(&lease).is_none());

    let publication = gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 7, 1, &ordered_ids)
        .expect("exact receipt publication starts");
    let flush = gate.seal_publish(&publication).expect("publication seals");
    assert!(gate.flush_publish(&flush));

    let payloads: Vec<_> = events(&sink)
        .into_iter()
        .filter_map(|event| match event.payload {
            DebugEventPayload::FunctionBreakpointsVerified {
                generation,
                breakpoints,
            } => Some((generation, breakpoints)),
            _ => None,
        })
        .collect();
    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[0].0, 1);
    assert_eq!(
        payloads[0]
            .1
            .iter()
            .map(|entry| (entry.id.as_str(), entry.verified))
            .collect::<Vec<_>>(),
        [("resolved", true), ("pending", false)]
    );
    assert_eq!(
        payloads[1]
            .1
            .iter()
            .map(|entry| (entry.id.as_str(), entry.verified))
            .collect::<Vec<_>>(),
        [("pending", true)]
    );
}

#[test]
fn startup_function_receipt_rejects_stale_order_duplicate_and_oversize_authority() {
    let (_registry, gate, _sink, _session_id) = fixture("/workspace/function-receipt-stale");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let ordered_ids = vec!["a".to_string(), "b".to_string()];
    let mixed = || match function_verification(1, &[("a", true), ("b", false)]) {
        DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
        _ => unreachable!(),
    };

    assert!(!gate.retain_startup_function_breakpoint_receipt(
        &lease,
        2,
        4,
        1,
        &ordered_ids,
        mixed(),
    ));
    assert!(!gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        4,
        1,
        &ordered_ids,
        match function_verification(1, &[("b", false), ("a", true)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    let huge_id = "x".repeat(MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES);
    assert!(!gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        4,
        1,
        std::slice::from_ref(&huge_id),
        vec![crate::debug_adapter::DebugFunctionBreakpointVerification {
            id: huge_id.clone(),
            verified: false,
        }],
    ));
    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        4,
        1,
        &ordered_ids,
        mixed(),
    ));
    assert!(!gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        4,
        1,
        &ordered_ids,
        mixed(),
    ));
    let (_other_registry, other_gate, _other_sink, _other_session_id) =
        fixture("/workspace/function-receipt-foreign");
    let foreign_lease = other_gate
        .prepare_initial()
        .expect("foreign unpublished lease");
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(
            &foreign_lease,
            1,
            4,
            1,
            &ordered_ids,
        )
        .is_none());
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 5, 1, &ordered_ids,)
        .is_none());
    assert!(gate.begin_publish(&lease).is_none());
    let publication = gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 4, 1, &ordered_ids)
        .expect("exact receipt is consumed once");
    assert!(gate.abort_publish(&publication));
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 4, 1, &ordered_ids,)
        .is_none());
    assert!(gate.begin_publish(&lease).is_none());
}

#[test]
fn startup_function_receipt_accepts_the_legal_maximum_without_duplicate_id_retention() {
    let (_registry, gate, _sink, _session_id) = fixture("/workspace/function-receipt-max");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let ordered_ids: Vec<_> = (0..128)
        .map(|index| format!("id-{index:03}-{}", "x".repeat(121)))
        .collect();
    assert!(ordered_ids.iter().all(|id| id.len() == 128));
    let verification = ordered_ids
        .iter()
        .map(
            |id| crate::debug_adapter::DebugFunctionBreakpointVerification {
                id: id.clone(),
                verified: false,
            },
        )
        .collect();

    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        9,
        1,
        &ordered_ids,
        verification,
    ));
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 9, 1, &ordered_ids,)
        .is_some());
}

#[test]
fn startup_function_receipt_replacement_is_atomic_and_discards_old_partial_authority() {
    let (_registry, gate, sink, _session_id) = fixture("/workspace/function-receipt-replace");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let old_ids = vec!["old-a".to_string(), "old-b".to_string()];
    let new_ids = vec!["new-a".to_string(), "new-b".to_string()];

    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        7,
        1,
        &old_ids,
        match function_verification(1, &[("old-a", true), ("old-b", false)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    assert_eq!(
        gate.emit(&lease, function_verification(1, &[("old-b", true)])),
        WatchEventDisposition::Buffered
    );
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(7, 1, &old_ids),
        function_authority(8, 2, &new_ids),
        match function_verification(2, &[("new-b", true), ("new-a", false)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    assert!(gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(7, 1, &old_ids),
        function_authority(8, 2, &new_ids),
        match function_verification(2, &[("new-a", false), ("new-b", true)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));

    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 7, 1, &old_ids)
        .is_none());
    assert_eq!(
        gate.emit(&lease, function_verification(1, &[("old-a", false)])),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(
        gate.emit(&lease, function_verification(2, &[("new-a", true)])),
        WatchEventDisposition::Buffered
    );
    let publication = gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 8, 2, &new_ids)
        .expect("replacement authority publishes");
    let flush = gate.seal_publish(&publication).expect("publication seals");
    assert!(gate.flush_publish(&flush));

    let payloads: Vec<_> = events(&sink)
        .into_iter()
        .filter_map(|event| match event.payload {
            DebugEventPayload::FunctionBreakpointsVerified {
                generation,
                breakpoints,
            } => Some((generation, breakpoints)),
            _ => None,
        })
        .collect();
    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[0].0, 2);
    assert_eq!(
        payloads[0]
            .1
            .iter()
            .map(|entry| (entry.id.as_str(), entry.verified))
            .collect::<Vec<_>>(),
        [("new-a", false), ("new-b", true)]
    );
    assert_eq!(
        payloads[1]
            .1
            .iter()
            .map(|entry| (entry.id.as_str(), entry.verified))
            .collect::<Vec<_>>(),
        [("new-a", true)]
    );
}

#[test]
fn startup_function_receipt_replacement_rejects_stale_foreign_and_invalid_authority() {
    let (_registry, gate, _sink, _session_id) =
        fixture("/workspace/function-receipt-replace-reject");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let old_ids = vec!["old".to_string()];
    let new_ids = vec!["new".to_string()];
    let replacement = || match function_verification(2, &[("new", true)]) {
        DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
        _ => unreachable!(),
    };
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 1, &old_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        10,
        1,
        &old_ids,
        match function_verification(1, &[("old", false)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));

    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(9, 1, &old_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 2, &old_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 1, &new_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        2,
        function_authority(10, 1, &old_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 1, &old_ids),
        function_authority(10, 2, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 1, &old_ids),
        function_authority(11, 1, &new_ids),
        replacement(),
    ));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(10, 1, &old_ids),
        function_authority(11, 2, &new_ids),
        match function_verification(2, &[("wrong", true)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));

    let (_foreign_registry, foreign_gate, _foreign_sink, _foreign_session_id) =
        fixture("/workspace/function-receipt-replace-foreign");
    let foreign_lease = foreign_gate
        .prepare_initial()
        .expect("foreign unpublished lease");
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &foreign_lease,
        1,
        function_authority(10, 1, &old_ids),
        function_authority(11, 2, &new_ids),
        replacement(),
    ));
}

#[test]
fn startup_function_receipt_replacement_rejects_oversize_and_published_state() {
    let (_registry, gate, _sink, _session_id) =
        fixture("/workspace/function-receipt-replace-bounds");
    let lease = gate.prepare_initial().expect("initial unpublished lease");
    let old_ids = vec!["old".to_string()];
    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        12,
        1,
        &old_ids,
        match function_verification(1, &[("old", false)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    let huge_id = "x".repeat(MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES);
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(12, 1, &old_ids),
        function_authority(13, 2, std::slice::from_ref(&huge_id)),
        vec![crate::debug_adapter::DebugFunctionBreakpointVerification {
            id: huge_id.clone(),
            verified: false,
        }],
    ));
    let publication = gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 12, 1, &old_ids)
        .expect("old receipt begins publication");
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(12, 1, &old_ids),
        function_authority(13, 2, &["new".to_string()]),
        match function_verification(2, &[("new", true)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
    let flush = gate.seal_publish(&publication).expect("publication seals");
    assert!(gate.flush_publish(&flush));
    assert!(!gate.replace_startup_function_breakpoint_receipt(
        &lease,
        1,
        function_authority(12, 1, &old_ids),
        function_authority(13, 2, &["new".to_string()]),
        match function_verification(2, &[("new", true)]) {
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } => breakpoints,
            _ => unreachable!(),
        },
    ));
}

#[test]
fn exact_active_generation_preserves_emitter_identity_and_monotonic_sequence() {
    let (_registry, gate, sink, session_id) = fixture("/workspace");
    let lease = gate.activate_initial().expect("initial lease");

    assert_eq!(
        gate.emit(&lease, output("one")),
        WatchEventDisposition::Delivered
    );
    assert_eq!(
        gate.emit(&lease, output("two")),
        WatchEventDisposition::Delivered
    );

    let events = events(&sink);
    assert_eq!(events.len(), 3);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { session_id: started } if started == session_id
    ));
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(events
        .iter()
        .all(|event| event.root_path == "/workspace" && event.session_id == session_id));
}

#[test]
fn accepted_event_observer_commits_before_emergency_generation_revoke() {
    let (_registry, gate, _sink, _session_id) = fixture("/workspace/accepted-observer");
    let gate = Arc::new(gate);
    let lease = gate.activate_initial().expect("initial lease");
    let cached_epoch = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let emit_gate = Arc::clone(&gate);
    let emit_lease = lease.clone();
    let emit_epoch = Arc::clone(&cached_epoch);
    let emit = thread::spawn(move || {
        emit_gate.emit_with_accept(&emit_lease, stopped(9), || {
            emit_epoch.store(9, std::sync::atomic::Ordering::Release);
            entered_tx.send(()).expect("observer entered");
            release_rx.recv().expect("observer released");
        })
    });
    entered_rx.recv().expect("accepted observer entered");

    let close_gate = Arc::clone(&gate);
    let close_lease = lease.clone();
    let (closed_tx, closed_rx) = mpsc::sync_channel(1);
    let close = thread::spawn(move || {
        let ended = close_gate.end_before_transport_close(
            &close_lease,
            WatchTransportEnd::Terminated,
            || (),
        );
        closed_tx.send(ended.is_some()).expect("close result");
    });
    assert_eq!(
        closed_rx.recv_timeout(Duration::from_millis(30)),
        Err(mpsc::RecvTimeoutError::Timeout),
        "generation revoke must wait for the accepted-event observer"
    );

    release_tx.send(()).expect("release observer");
    assert_eq!(emit.join().expect("emit"), WatchEventDisposition::Delivered);
    assert_eq!(closed_rx.recv_timeout(Duration::from_secs(1)), Ok(true));
    close.join().expect("close");
    assert_eq!(cached_epoch.load(std::sync::atomic::Ordering::Acquire), 9);
    assert!(!gate.is_current(&lease));
}

#[test]
fn initial_activation_is_single_use() {
    let (_registry, gate, _, _) = fixture("/workspace");
    assert!(gate.activate_initial().is_some());
    assert!(gate.activate_initial().is_none());
}

#[test]
fn replacement_rejects_old_and_forged_future_generations() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    let second = gate.replace(&first).expect("replacement");
    let future = WatchEventGenerationLease {
        authority: Arc::new(GenerationAuthority),
        generation: second.generation + 1,
    };

    assert_eq!(
        gate.emit(&first, output("old")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(
        gate.emit(&future, output("future")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(
        gate.emit(&second, output("current")),
        WatchEventDisposition::Delivered
    );
    let payloads = events(&sink)
        .into_iter()
        .map(|event| event.payload)
        .collect::<Vec<_>>();
    assert_eq!(payloads.len(), 2);
    assert!(matches!(&payloads[1], DebugEventPayload::Output { text, .. } if text == "current"));
}

#[test]
fn generation_exhaustion_revokes_the_old_authority_fail_closed() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.activate_initial().expect("initial lease");
    lock_recover(&gate.state).next_generation = u64::MAX;

    assert!(gate.replace(&lease).is_none());
    assert!(!gate.is_current(&lease));
    assert_eq!(
        gate.emit(&lease, output("late")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&sink).len(), 1);
}

#[test]
fn lease_from_another_gate_cannot_claim_same_generation_number() {
    let (_first_registry, first_gate, first_sink, _) = fixture("/one");
    let (_second_registry, second_gate, _, _) = fixture("/two");
    let first = first_gate.activate_initial().expect("first lease");
    let foreign = second_gate.activate_initial().expect("foreign lease");

    assert_eq!(first.generation, foreign.generation);
    assert_eq!(
        first_gate.emit(&foreign, output("foreign")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&first_sink).len(), 1);
    assert!(first_gate.is_current(&first));
}

#[test]
fn running_generation_replacement_emits_no_synthetic_transition() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    assert_eq!(
        gate.emit(&first, output("running")),
        WatchEventDisposition::Delivered
    );

    let second = gate.replace(&first).expect("replacement");
    assert!(gate.is_current(&second));
    assert_eq!(events(&sink).len(), 2);
}

#[test]
fn paused_generation_replacement_emits_exactly_one_resumed_invalidation() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    assert_eq!(
        gate.emit(&first, stopped(7)),
        WatchEventDisposition::Delivered
    );

    let second = gate.replace(&first).expect("replacement");
    assert!(gate.replace(&first).is_none());
    assert_eq!(
        gate.emit(&first, stopped(8)),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(
        gate.emit(&second, output("replacement")),
        WatchEventDisposition::Delivered
    );

    let payloads = events(&sink)
        .into_iter()
        .map(|event| event.payload)
        .collect::<Vec<_>>();
    assert_eq!(
        payloads
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count(),
        1
    );
    assert!(matches!(payloads[1], DebugEventPayload::Stopped { .. }));
    assert!(matches!(payloads[2], DebugEventPayload::Resumed));
}

#[test]
fn explicit_resume_makes_later_replacement_silent() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    gate.emit(&first, stopped(1));
    gate.emit(&first, DebugEventPayload::Resumed);

    assert!(gate.replace(&first).is_some());
    assert_eq!(
        events(&sink)
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Resumed))
            .count(),
        1
    );
}

#[test]
fn transport_cannot_emit_child_started_or_terminated_lifecycle() {
    let (_registry, gate, sink, session_id) = fixture("/workspace");
    let lease = gate.activate_initial().expect("initial lease");

    assert_eq!(
        gate.emit(&lease, DebugEventPayload::Started { session_id: 999 }),
        WatchEventDisposition::DroppedLifecycle
    );
    assert_eq!(
        gate.emit(&lease, DebugEventPayload::Terminated { exit_code: Some(0) }),
        WatchEventDisposition::DroppedLifecycle
    );

    let events = events(&sink);
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { session_id: started } if started == session_id
    ));
}

#[test]
fn cancel_revokes_before_transport_close_and_late_events_drop() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.activate_initial().expect("initial lease");
    let closed = gate.end_before_transport_close(&lease, WatchTransportEnd::Cancelled, || {
        (
            !gate.is_current(&lease),
            gate.emit(&lease, output("during close")),
        )
    });

    assert_eq!(closed, Some((true, WatchEventDisposition::DroppedStale)));
    assert_eq!(
        gate.emit(&lease, output("late")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&sink).len(), 1);
}

#[test]
fn terminate_revokes_before_transport_close_and_is_exact_owner_only() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    let current = gate.replace(&first).expect("replacement");
    let mut stale_close_called = false;

    assert_eq!(
        gate.end_before_transport_close(&first, WatchTransportEnd::Terminated, || {
            stale_close_called = true;
        }),
        None
    );
    assert!(!stale_close_called);
    assert_eq!(
        gate.end_before_transport_close(&current, WatchTransportEnd::Terminated, || {
            !gate.is_current(&current)
        }),
        Some(true)
    );
    assert_eq!(
        gate.emit(&current, output("late")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&sink).len(), 1);
}

#[test]
fn prepared_generation_drops_events_until_exact_publish() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared initial lease");

    assert_eq!(
        gate.emit(&lease, output("before publish")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&sink).len(), 1, "only logical Started is visible");
    assert!(gate.publish(&lease));
    assert_eq!(
        gate.emit(&lease, output("after publish")),
        WatchEventDisposition::Delivered
    );
    assert_eq!(events(&sink).len(), 2);
}

#[test]
fn failed_prepared_generation_can_be_revoked_without_becoming_current_again() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared initial lease");

    assert_eq!(
        gate.end_before_transport_close(&lease, WatchTransportEnd::Terminated, || ()),
        Some(())
    );
    assert!(!gate.is_current(&lease));
    assert!(!gate.publish(&lease));
    assert_eq!(
        gate.emit(&lease, output("late failed connect")),
        WatchEventDisposition::DroppedStale
    );
    assert_eq!(events(&sink).len(), 1);
}

#[test]
fn paused_transport_close_emits_one_resume_before_prepared_replacement() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let first = gate.activate_initial().expect("initial lease");
    assert_eq!(
        gate.emit(&first, stopped(9)),
        WatchEventDisposition::Delivered
    );
    assert_eq!(
        gate.end_before_transport_close(&first, WatchTransportEnd::Terminated, || ()),
        Some(())
    );
    let replacement = gate.prepare_replacement().expect("replacement");
    assert_eq!(
        gate.emit(&replacement, output("still staged")),
        WatchEventDisposition::DroppedStale
    );
    assert!(gate.publish(&replacement));

    let payloads = events(&sink)
        .into_iter()
        .map(|event| event.payload)
        .collect::<Vec<_>>();
    assert_eq!(
        payloads
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count(),
        1
    );
    assert!(matches!(payloads[1], DebugEventPayload::Stopped { .. }));
    assert!(matches!(payloads[2], DebugEventPayload::Resumed));
}

#[test]
fn publication_transaction_buffers_then_flushes_exact_order() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");

    assert_eq!(
        gate.emit(&lease, output("one")),
        WatchEventDisposition::Buffered
    );
    assert_eq!(
        gate.emit(&lease, stopped(11)),
        WatchEventDisposition::Buffered
    );
    assert_eq!(
        gate.emit(&lease, output("two")),
        WatchEventDisposition::Buffered
    );
    assert_eq!(events(&sink).len(), 1, "staged events stay invisible");

    let flush = gate.seal_publish(&publication).expect("seal exact");
    assert!(gate.flush_publish(&flush));
    assert!(!gate.flush_publish(&flush), "flush is exact-once");
    let payloads = events(&sink)
        .into_iter()
        .map(|event| event.payload)
        .collect::<Vec<_>>();
    assert!(matches!(&payloads[1], DebugEventPayload::Output { text, .. } if text == "one"));
    assert!(matches!(payloads[2], DebugEventPayload::Stopped { .. }));
    assert!(matches!(&payloads[3], DebugEventPayload::Output { text, .. } if text == "two"));
}

#[test]
fn failed_publication_aborts_without_leaking_staged_events() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    assert_eq!(
        gate.emit(&lease, output("must not leak")),
        WatchEventDisposition::Buffered
    );

    assert!(gate.abort_publish(&publication));
    assert!(!gate.abort_publish(&publication), "abort is exact-once");
    assert!(gate.seal_publish(&publication).is_none());
    assert_eq!(events(&sink).len(), 1, "only logical Started is visible");
    assert_eq!(
        gate.emit(&lease, output("after abort")),
        WatchEventDisposition::DroppedStale
    );
}

#[test]
fn staged_event_overflow_fails_commit_closed_and_emits_nothing() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    for index in 0..MAX_STAGED_EVENTS {
        assert_eq!(
            gate.emit(&lease, output(&format!("buffered-{index}"))),
            WatchEventDisposition::Buffered
        );
    }
    assert_eq!(
        gate.emit(&lease, output("overflow")),
        WatchEventDisposition::DroppedOverflow
    );

    assert!(gate.seal_publish(&publication).is_none());
    assert_eq!(events(&sink).len(), 1, "overflow never partially flushes");
    assert_eq!(
        gate.emit(&lease, output("after overflow")),
        WatchEventDisposition::DroppedStale
    );
}

#[test]
fn staged_payload_byte_overflow_fails_without_retaining_oversized_event() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    let oversized = "x".repeat(MAX_STAGED_EVENT_BYTES);

    assert_eq!(
        gate.emit(&lease, output(&oversized)),
        WatchEventDisposition::DroppedOverflow
    );
    assert!(gate.seal_publish(&publication).is_none());
    assert_eq!(events(&sink).len(), 1, "oversized payload never leaks");
}

#[test]
fn concurrent_transport_events_cannot_overtake_transaction_commit() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let gate = Arc::new(gate);
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    let (staged_tx, staged_rx) = mpsc::sync_channel(1);
    let (continue_tx, continue_rx) = mpsc::sync_channel(1);
    let event_gate = Arc::clone(&gate);
    let event_lease = lease.clone();
    let transport = thread::spawn(move || {
        assert_eq!(
            event_gate.emit(&event_lease, output("before ack")),
            WatchEventDisposition::Buffered
        );
        staged_tx.send(()).expect("staged notification");
        continue_rx.recv().expect("commit notification");
        assert_eq!(
            event_gate.emit(&event_lease, output("after ack")),
            WatchEventDisposition::Delivered
        );
    });

    staged_rx.recv().expect("event staged");
    assert_eq!(events(&sink).len(), 1);
    let flush = gate.seal_publish(&publication).expect("seal publication");
    assert!(gate.flush_publish(&flush));
    continue_tx.send(()).expect("release transport");
    transport.join().expect("transport");

    let texts = events(&sink)
        .into_iter()
        .filter_map(|event| match event.payload {
            DebugEventPayload::Output { text, .. } => Some(text),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(texts, ["before ack", "after ack"]);
}

#[test]
fn sealed_events_remain_buffered_until_flush_and_preserve_fifo() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    assert_eq!(
        gate.emit(&lease, output("before seal")),
        WatchEventDisposition::Buffered
    );
    let flush = gate.seal_publish(&publication).expect("seal");
    assert_eq!(
        gate.emit(&lease, output("after seal")),
        WatchEventDisposition::Buffered
    );
    assert_eq!(events(&sink).len(), 1);

    assert!(gate.flush_publish(&flush));
    let texts = events(&sink)
        .into_iter()
        .filter_map(|event| match event.payload {
            DebugEventPayload::Output { text, .. } => Some(text),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(texts, ["before seal", "after seal"]);
}

#[test]
fn seal_reserves_delivery_capacity_before_control_can_be_activated() {
    let registry = DebugSessionRegistry::new();
    registry.activate_root("/workspace/reservation");
    let sink = Arc::new(ReentrantSink::default());
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    registry
        .start_session(
            "/workspace/reservation",
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&capture) = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("session starts");
    let emitter = lock_recover(&captured).take().expect("captured emitter");
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let first = gate.activate_initial().expect("published first generation");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    *lock_recover(&sink.callback) = Some(Box::new(move || {
        entered_tx.send(()).expect("sink entered");
        release_rx.recv().expect("sink released");
    }));
    let blocked_gate = Arc::clone(&gate);
    let blocked_lease = first.clone();
    let blocked = thread::spawn(move || blocked_gate.emit(&blocked_lease, output("in-flight")));
    entered_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("old delivery blocks");
    for index in 1..MAX_STAGED_EVENTS {
        assert_eq!(
            gate.emit(&first, output(&format!("old-queued-{index}"))),
            WatchEventDisposition::Delivered
        );
    }
    assert_eq!(
        gate.end_before_transport_close(&first, WatchTransportEnd::Terminated, || ()),
        Some(())
    );
    let replacement = gate.prepare_replacement().expect("replacement generation");
    let publication = gate
        .begin_publish(&replacement)
        .expect("replacement publication");
    assert_eq!(
        gate.emit(&replacement, output("replacement")),
        WatchEventDisposition::Buffered
    );

    assert!(
        gate.seal_publish(&publication).is_none(),
        "capacity failure must happen before a flush lease can make control visible"
    );
    release_tx.send(()).expect("release old sink");
    assert_eq!(
        blocked.join().expect("blocked delivery"),
        WatchEventDisposition::Delivered
    );
}

#[test]
fn reentrant_sink_emit_uses_one_lock_free_fifo_drainer() {
    let registry = DebugSessionRegistry::new();
    registry.activate_root("/workspace");
    let sink = Arc::new(ReentrantSink::default());
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    registry
        .start_session(
            "/workspace",
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&capture) = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("session starts");
    let emitter = lock_recover(&captured).take().expect("captured emitter");
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let lease = gate.activate_initial().expect("published generation");
    let callback_gate = Arc::clone(&gate);
    let callback_lease = lease.clone();
    *lock_recover(&sink.callback) = Some(Box::new(move || {
        assert_eq!(
            callback_gate.emit(&callback_lease, output("reentrant")),
            WatchEventDisposition::Delivered
        );
    }));
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let emitting_gate = Arc::clone(&gate);
    let emitting_lease = lease.clone();
    thread::spawn(move || {
        let result = emitting_gate.emit(&emitting_lease, output("outer"));
        let _ = done_tx.send(result);
    });

    assert_eq!(
        done_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("reentrant drain must not deadlock"),
        WatchEventDisposition::Delivered
    );
    let recorded = lock_recover(&sink.events);
    let texts = recorded
        .iter()
        .filter_map(|event| match &event.payload {
            DebugEventPayload::Output { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(texts, ["outer", "reentrant"]);
}

#[test]
fn terminate_does_not_wait_for_a_blocked_event_sink() {
    let registry = DebugSessionRegistry::new();
    registry.activate_root("/workspace");
    let sink = Arc::new(ReentrantSink::default());
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    registry
        .start_session(
            "/workspace",
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&capture) = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("session starts");
    let emitter = lock_recover(&captured).take().expect("captured emitter");
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let lease = gate.activate_initial().expect("published generation");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    *lock_recover(&sink.callback) = Some(Box::new(move || {
        entered_tx.send(()).expect("sink entered");
        release_rx.recv().expect("sink released");
    }));
    let emitting_gate = Arc::clone(&gate);
    let emitting_lease = lease.clone();
    let emitter_thread =
        thread::spawn(move || emitting_gate.emit(&emitting_lease, output("blocked")));
    entered_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("sink blocks");

    assert_eq!(
        gate.end_before_transport_close(&lease, WatchTransportEnd::Terminated, || "closed"),
        Some("closed")
    );
    assert_eq!(
        gate.emit(&lease, output("late")),
        WatchEventDisposition::DroppedStale
    );
    release_tx.send(()).expect("release sink");
    assert_eq!(
        emitter_thread.join().expect("emitter thread"),
        WatchEventDisposition::Delivered
    );
}

#[test]
fn logical_finish_discards_queued_events_without_waiting_for_blocked_sink() {
    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root("/workspace/finish");
    let sink = Arc::new(ReentrantSink::default());
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    let session_id = registry
        .start_session(
            "/workspace/finish",
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&capture) = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("session starts");
    let emitter = lock_recover(&captured).take().expect("captured emitter");
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let finish_gate = gate.logical_finish_gate();
    let lease = gate.activate_initial().expect("published generation");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    *lock_recover(&sink.callback) = Some(Box::new(move || {
        entered_tx.send(()).expect("sink entered");
        release_rx.recv().expect("sink released");
    }));

    let emitting_gate = Arc::clone(&gate);
    let emitting_lease = lease.clone();
    let emitter_thread =
        thread::spawn(move || emitting_gate.emit(&emitting_lease, output("first")));
    entered_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("first event blocks in sink");
    assert_eq!(
        gate.emit(&lease, output("queued")),
        WatchEventDisposition::Delivered
    );

    let finish_registry = Arc::clone(&registry);
    let (finished_tx, finished_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let result = finish_gate.finish(|| finish_registry.finish_session(session_id, Some(0)));
        finished_tx.send(result).expect("finish result");
    });
    assert_eq!(
        finished_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("logical finish must not wait for the blocked sink"),
        Some(true)
    );
    assert_eq!(
        gate.emit(&lease, output("late")),
        WatchEventDisposition::DroppedStale
    );

    release_tx.send(()).expect("release sink");
    assert_eq!(
        emitter_thread.join().expect("emitter thread"),
        WatchEventDisposition::Delivered
    );
    let payloads = lock_recover(&sink.events)
        .iter()
        .map(|event| event.payload.clone())
        .collect::<Vec<_>>();
    assert_eq!(payloads.len(), 3);
    assert!(matches!(
        payloads[0],
        DebugEventPayload::Started { session_id: started } if started == session_id
    ));
    assert!(matches!(
        &payloads[1],
        DebugEventPayload::Output { text, .. } if text == "first"
    ));
    assert!(matches!(
        payloads[2],
        DebugEventPayload::Terminated { exit_code: Some(0) }
    ));
}

#[test]
fn staged_pause_truth_uses_the_last_fifo_transition() {
    let (_registry, gate, sink, _) = fixture("/workspace");
    let lease = gate.prepare_initial().expect("prepared generation");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    assert_eq!(
        gate.emit(&lease, stopped(41)),
        WatchEventDisposition::Buffered
    );
    assert_eq!(
        gate.emit(&lease, DebugEventPayload::Resumed),
        WatchEventDisposition::Buffered
    );
    let flush = gate.seal_publish(&publication).expect("seal");
    assert!(gate.flush_publish(&flush));
    assert!(gate.replace(&lease).is_some());

    let resumed = events(&sink)
        .into_iter()
        .filter(|event| matches!(event.payload, DebugEventPayload::Resumed))
        .count();
    assert_eq!(resumed, 1, "replacement adds no synthetic second resume");
}
