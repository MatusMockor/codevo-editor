use super::*;
use crate::debug_adapter::{
    DebugOutputStream, DebugScopeInfo, DebugSetExpressionRequest, DebugSetVariableRequest,
    DebugStackFrame, DebugVariableInfo, StepKind,
};
use crate::debug_session_registry::DebugWorkspaceAuthority;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<DebugEvent>>,
}

impl DebugEventSink for RecordingSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.events).push(event);
    }
}

struct MinimalAdapter {
    terminated: Arc<AtomicBool>,
}

impl MinimalAdapter {
    fn boxed(terminated: Arc<AtomicBool>) -> Box<dyn DebugAdapter> {
        Box::new(Self { terminated })
    }
}

impl DebugAdapter for MinimalAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        _breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        Ok(Vec::new())
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

    fn terminate(&mut self) {
        self.terminated.store(true, Ordering::SeqCst);
    }
}

#[test]
fn adapters_without_set_variable_support_fail_as_unsupported() {
    let terminated = Arc::new(AtomicBool::new(false));
    let mut adapter = MinimalAdapter { terminated };
    let error = adapter
        .set_variable(DebugSetVariableRequest {
            pause_generation: 1,
            frame_id: 1,
            variables_reference: 1,
            name: "value".to_string(),
            value: "42".to_string(),
        })
        .expect_err("default adapter must reject mutation");
    assert!(error.starts_with("Unsupported:"));

    let error = adapter
        .set_expression(DebugSetExpressionRequest {
            pause_generation: 1,
            frame_id: 1,
            set_expression_reference: 1,
            expression: "value".to_string(),
            value: "42".to_string(),
        })
        .expect_err("default adapter must reject set expression");
    assert!(error.starts_with("Unsupported:"));
}

#[test]
fn authorized_mutation_requires_the_exact_workspace_authority() {
    let root_key = "/workspace/authorized-mutation";
    let registry = DebugSessionRegistry::new();
    let session_id = registry
        .start_session(root_key, Arc::new(RecordingSink::default()), |_emitter| {
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("start session");
    let exact = DebugWorkspaceAuthority::CanonicalRoot(root_key.to_string());
    let wrong = DebugWorkspaceAuthority::CanonicalRoot("/workspace/replacement".to_string());

    assert_eq!(
        registry.mutate_for_session_authorized(session_id, &exact, |adapter| adapter.pause()),
        Ok(Ok(()))
    );
    assert_eq!(
        registry.mutate_for_session_authorized(session_id, &wrong, |adapter| adapter.pause()),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
}

#[test]
fn lifecycle_revocation_between_evaluation_and_assignment_prevents_the_side_effect() {
    let root_key = "/workspace/revoked-mid-mutation".to_string();
    let registry = Arc::new(DebugSessionRegistry::new());
    let permit = registry.begin_start(&root_key).expect("permit");
    let mutation_permit = permit.clone();
    let audit_permit = permit.clone();
    let session_id = registry
        .start_session_with_permit(permit, Arc::new(RecordingSink::default()), |_emitter| {
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("start session");
    let (evaluated_tx, evaluated_rx) = mpsc::channel();
    let (continue_tx, continue_rx) = mpsc::channel();
    let side_effects = Arc::new(AtomicUsize::new(0));
    let worker_effects = Arc::clone(&side_effects);
    let worker_registry = Arc::clone(&registry);
    let authority = DebugWorkspaceAuthority::CanonicalRoot(root_key.clone());
    let worker = thread::spawn(move || {
        let check_registry = Arc::clone(&worker_registry);
        worker_registry.mutate_for_session_authorized(session_id, &authority, |_adapter| {
            evaluated_tx.send(()).expect("evaluated");
            continue_rx.recv().expect("continue");
            if check_registry.startup_is_current(&mutation_permit) {
                worker_effects.fetch_add(1, Ordering::SeqCst);
            }
        })
    });
    evaluated_rx.recv().expect("mutation reached barrier");
    let revoke_registry = Arc::clone(&registry);
    let revoke_root = root_key.clone();
    let revoke = thread::spawn(move || revoke_registry.deactivate_root(&revoke_root));
    while registry.startup_is_current(&audit_permit) {
        thread::yield_now();
    }
    continue_tx.send(()).expect("release mutation");

    assert_eq!(
        worker.join().expect("mutation worker"),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    assert!(revoke.join().expect("revoke worker"));
    assert_eq!(side_effects.load(Ordering::SeqCst), 0);
}

#[test]
fn stale_startup_events_are_discarded_and_latest_events_follow_started() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let first_terminated = Arc::new(AtomicBool::new(false));
    let (emitted_tx, emitted_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first_registry = Arc::clone(&registry);
    let first_sink = Arc::clone(&sink);
    let first_state = Arc::clone(&first_terminated);
    let first = thread::spawn(move || {
        first_registry.start_session("/workspace/one", first_sink, move |emitter| {
            emitter
                .retain_startup_function_breakpoint_verification(
                    1,
                    vec![crate::debug_adapter::DebugFunctionBreakpointVerification {
                        id: "stale-startup".to_string(),
                        verified: true,
                    }],
                )
                .expect("retain stale startup receipt");
            emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text: format!(
                    "stale synchronous output{}",
                    "ž".repeat(MAX_DEBUG_OUTPUT_EVENT_BYTES)
                ),
                truncated: false,
            });
            emitted_tx.send(()).expect("emitted signal");
            release_rx.recv().expect("release stale factory");
            Ok(MinimalAdapter::boxed(first_state))
        })
    });

    emitted_rx.recv().expect("stale factory emitted");
    let latest_permit = registry
        .begin_start("/workspace/one")
        .expect("latest permit");
    release_tx.send(()).expect("release factory");
    assert!(first.join().expect("stale worker").is_err());
    assert!(first_terminated.load(Ordering::SeqCst));

    let latest_id = registry
        .start_session_with_permit(latest_permit, sink.clone(), |emitter| {
            emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text: "latest synchronous output".to_string(),
                truncated: false,
            });
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("latest start");
    let events = lock_recover(&sink.events);
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0].payload,
        DebugEventPayload::Started {
            session_id: latest_id
        }
    );
    assert!(matches!(
        &events[1].payload,
        DebugEventPayload::Output { text, .. } if text == "latest synchronous output"
    ));
}

struct ReentrantSink {
    registry: Arc<DebugSessionRegistry>,
    events: Mutex<Vec<DebugEventPayload>>,
    registered_on_started: AtomicBool,
}

impl DebugEventSink for ReentrantSink {
    fn emit(&self, event: DebugEvent) {
        let started = matches!(event.payload, DebugEventPayload::Started { .. });
        if started {
            self.registered_on_started.store(
                self.registry
                    .owns_session(&event.root_path, event.session_id),
                Ordering::SeqCst,
            );
        }
        lock_recover(&self.events).push(event.payload);
        if started {
            self.registry.stop("/workspace/reentrant");
        }
    }
}

#[test]
fn started_callback_runs_outside_registry_and_delivery_locks() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(ReentrantSink {
        registry: Arc::clone(&registry),
        events: Mutex::new(Vec::new()),
        registered_on_started: AtomicBool::new(false),
    });
    let terminated = Arc::new(AtomicBool::new(false));
    registry
        .start_session("/workspace/reentrant", sink.clone(), {
            let terminated = Arc::clone(&terminated);
            move |_| Ok(MinimalAdapter::boxed(terminated))
        })
        .expect("registered before reentrant stop");
    assert!(terminated.load(Ordering::SeqCst));
    assert!(sink.registered_on_started.load(Ordering::SeqCst));
    assert_eq!(
        *lock_recover(&sink.events),
        [
            DebugEventPayload::Started { session_id: 1 },
            DebugEventPayload::Terminated { exit_code: None },
        ]
    );
}

#[test]
fn replacement_between_commit_and_drain_observes_started_then_terminal() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let (committed_tx, committed_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    registry.set_after_start_commit_hook(Some(Arc::new(move || {
        committed_tx.send(()).expect("commit signal");
        lock_recover(&release_rx).recv().expect("release commit");
    })));
    let worker_registry = Arc::clone(&registry);
    let worker_sink = Arc::clone(&sink);
    let worker = thread::spawn(move || {
        worker_registry.start_session("/workspace/commit-race", worker_sink, |_| {
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
    });

    committed_rx.recv().expect("committed before drain");
    assert_eq!(
        registry.session_id_for_root("/workspace/commit-race"),
        Some(1)
    );
    let replacement = registry
        .begin_start("/workspace/commit-race")
        .expect("replacement permit");
    release_tx.send(()).expect("release drain");
    assert_eq!(worker.join().expect("worker"), Ok(1));
    drop(replacement);
    registry.set_after_start_commit_hook(None);

    let events = lock_recover(&sink.events);
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0].payload,
        DebugEventPayload::Started { session_id: 1 }
    );
    assert_eq!(
        events[1].payload,
        DebugEventPayload::Terminated { exit_code: None }
    );
}

struct ReentrantStartSink {
    registry: Arc<DebugSessionRegistry>,
    result: Mutex<Option<mpsc::Sender<Result<u64, String>>>>,
}

impl DebugEventSink for ReentrantStartSink {
    fn emit(&self, event: DebugEvent) {
        if !matches!(event.payload, DebugEventPayload::Started { .. }) {
            return;
        }
        let Some(result) = lock_recover(&self.result).take() else {
            return;
        };
        let inner = self.registry.start_session(
            "/workspace/reentrant-start",
            Arc::new(RecordingSink::default()),
            |_| Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false)))),
        );
        result.send(inner).expect("inner result");
    }
}

#[test]
fn started_callback_can_start_a_replacement_on_the_same_root() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let (result_tx, result_rx) = mpsc::channel();
    let sink = Arc::new(ReentrantStartSink {
        registry: Arc::clone(&registry),
        result: Mutex::new(Some(result_tx)),
    });
    let worker_registry = Arc::clone(&registry);
    let worker = thread::spawn(move || {
        worker_registry.start_session("/workspace/reentrant-start", sink, |_| {
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
    });

    assert_eq!(
        result_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("reentrant start must not deadlock"),
        Ok(2)
    );
    assert_eq!(worker.join().expect("outer worker"), Ok(1));
    assert_eq!(
        registry.session_id_for_root("/workspace/reentrant-start"),
        Some(2)
    );
}

fn output(text: impl Into<String>) -> DebugEventPayload {
    DebugEventPayload::Output {
        stream: DebugOutputStream::Stdout,
        text: text.into(),
        truncated: false,
    }
}

fn diagnostic_count(events: &[DebugEvent]) -> usize {
    events
        .iter()
        .filter(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text,
                    ..
                } if text == OVERFLOW_DIAGNOSTIC
            )
        })
        .count()
}

#[test]
fn pending_count_overflow_emits_one_marker_after_started() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/count", sink.clone(), |emitter| {
            for index in 0..(MAX_BUFFERED_EVENTS + 64) {
                emitter.emit(output(index.to_string()));
            }
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");
    let events = lock_recover(&sink.events);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { .. }
    ));
    assert_eq!(diagnostic_count(&events), 1);
    assert!(events.len() <= MAX_BUFFERED_EVENTS);
}

#[test]
fn pending_startup_function_receipt_survives_queue_saturation_after_started() {
    const MAX_RECEIPT_BREAKPOINTS: usize = 128;
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/function-receipt", sink.clone(), |emitter| {
            for index in 0..(MAX_BUFFERED_EVENTS + 64) {
                emitter.emit(output(index.to_string()));
            }
            assert!(emitter
                .retain_startup_function_breakpoint_verification(2, Vec::new())
                .is_err());
            assert!(emitter
                .retain_startup_function_breakpoint_verification(
                    1,
                    (0..(MAX_RECEIPT_BREAKPOINTS * 2))
                        .map(|index| {
                            crate::debug_adapter::DebugFunctionBreakpointVerification {
                                id: format!("{index:03}{}", "x".repeat(125)),
                                verified: true,
                            }
                        })
                        .collect(),
                )
                .is_err());
            emitter.retain_startup_function_breakpoint_verification(
                1,
                (0..MAX_RECEIPT_BREAKPOINTS)
                    .map(
                        |index| crate::debug_adapter::DebugFunctionBreakpointVerification {
                            id: format!("function-{index}"),
                            verified: index % 2 == 0,
                        },
                    )
                    .collect(),
            )?;
            assert!(emitter
                .retain_startup_function_breakpoint_verification(1, Vec::new())
                .is_err());
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start with function receipt");

    let events = lock_recover(&sink.events);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { .. }
    ));
    let DebugEventPayload::FunctionBreakpointsVerified {
        generation,
        breakpoints,
    } = &events[1].payload
    else {
        panic!("startup receipt must immediately follow Started");
    };
    assert_eq!(*generation, 1);
    assert_eq!(breakpoints.len(), MAX_RECEIPT_BREAKPOINTS);
    assert_eq!(diagnostic_count(&events), 1);
    assert!(events.len() <= MAX_BUFFERED_EVENTS);
}

#[test]
fn pending_byte_overflow_is_bounded_and_marked_once() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/bytes", sink.clone(), |emitter| {
            for _ in 0..MAX_BUFFERED_EVENTS {
                emitter.emit(output("x".repeat(4 * 1024)));
            }
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");
    let events = lock_recover(&sink.events);
    assert_eq!(diagnostic_count(&events), 1);
    assert!(events.len() > 2);
    assert!(events.len() < MAX_BUFFERED_EVENTS);
}

#[test]
fn bounded_truncated_stop_event_is_delivered_instead_of_the_overflow_diagnostic() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    let frames = (1..=crate::debug_cdp::transport::MAX_CDP_STACK_FRAMES)
        .map(|frame_id| DebugStackFrame {
            frame_id: frame_id as u64,
            name: "f".repeat(256),
            file_path: Some(format!("/workspace/src/frame-{frame_id}.js")),
            line_number: frame_id as u32,
            column: 1,
        })
        .collect::<Vec<_>>();
    let payload = DebugEventPayload::Stopped {
        reason: crate::debug_adapter::DebugStopReason::Breakpoint,
        frames,
        pause_generation: 1,
        frames_truncated: true,
    };
    assert!(
        payload_bytes(&payload) <= MAX_BUFFERED_EVENT_BYTES - RESERVED_DELIVERY_BYTES,
        "the bounded stopped payload must fit the normal delivery budget"
    );

    registry
        .start_session("/workspace/bounded-stop", sink.clone(), |emitter| {
            emitter.emit(payload);
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");

    let events = lock_recover(&sink.events);
    assert_eq!(diagnostic_count(&events), 0);
    assert!(matches!(
        &events[1].payload,
        DebugEventPayload::Stopped {
            frames,
            frames_truncated: true,
            ..
        } if frames.len() == crate::debug_cdp::transport::MAX_CDP_STACK_FRAMES
    ));
}

#[test]
fn oversized_pending_output_is_utf8_bounded_and_truthfully_marked() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/oversized", sink.clone(), |emitter| {
            emitter.emit(output("ž".repeat(MAX_DEBUG_OUTPUT_EVENT_BYTES / 2 + 1)));
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");
    let events = lock_recover(&sink.events);
    assert_eq!(events.len(), 2);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { .. }
    ));
    assert_eq!(diagnostic_count(&events), 0);
    let DebugEventPayload::Output {
        stream,
        text,
        truncated,
    } = &events[1].payload
    else {
        panic!("bounded output event");
    };
    assert_eq!(*stream, DebugOutputStream::Stdout);
    assert!(*truncated);
    assert!(text.len() <= MAX_DEBUG_OUTPUT_EVENT_BYTES);
    assert!(text.capacity() <= MAX_DEBUG_OUTPUT_EVENT_BYTES);
    assert!(text.ends_with(OUTPUT_TRUNCATION_SUFFIX));
    assert!(text.starts_with('ž'));
}

#[test]
fn nul_output_is_replaced_by_one_bounded_diagnostic() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/nul-output", sink.clone(), |emitter| {
            emitter.emit(output("before\0after"));
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");
    let events = lock_recover(&sink.events);
    assert_eq!(events.len(), 2);
    assert!(matches!(
        &events[1].payload,
        DebugEventPayload::Output {
            stream: DebugOutputStream::Stderr,
            text,
            truncated: true,
        } if text == INVALID_OUTPUT_DIAGNOSTIC
    ));
}

#[test]
fn producer_truncation_and_excess_capacity_are_normalized_before_delivery() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/producer-truncation", sink.clone(), |emitter| {
            emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text: "partial output".to_string(),
                truncated: true,
            });
            let mut oversized_capacity = String::with_capacity(MAX_DEBUG_OUTPUT_EVENT_BYTES * 4);
            oversized_capacity.push_str("complete output");
            emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: oversized_capacity,
                truncated: false,
            });
            let mut already_marked = String::with_capacity(MAX_DEBUG_OUTPUT_EVENT_BYTES * 4);
            already_marked.push_str("partial");
            already_marked.push_str(OUTPUT_TRUNCATION_SUFFIX);
            emitter.emit(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text: already_marked,
                truncated: true,
            });
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("bounded start");
    let events = lock_recover(&sink.events);
    let DebugEventPayload::Output {
        text, truncated, ..
    } = &events[1].payload
    else {
        panic!("producer-truncated output");
    };
    assert!(*truncated);
    assert!(text.ends_with(OUTPUT_TRUNCATION_SUFFIX));
    let DebugEventPayload::Output {
        text, truncated, ..
    } = &events[2].payload
    else {
        panic!("complete output");
    };
    assert!(!truncated);
    assert_eq!(text, "complete output");
    assert!(text.capacity() <= MAX_DEBUG_OUTPUT_EVENT_BYTES);
    let DebugEventPayload::Output {
        text, truncated, ..
    } = &events[3].payload
    else {
        panic!("already-marked producer-truncated output");
    };
    assert!(*truncated);
    assert_eq!(text.matches(OUTPUT_TRUNCATION_SUFFIX).count(), 1);
    assert_eq!(text, &format!("partial{OUTPUT_TRUNCATION_SUFFIX}"));
    assert!(text.capacity() <= MAX_DEBUG_OUTPUT_EVENT_BYTES);
}

struct BlockingStartedSink {
    entered: Mutex<Option<mpsc::Sender<()>>>,
    events: Mutex<Vec<DebugEvent>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl DebugEventSink for BlockingStartedSink {
    fn emit(&self, event: DebugEvent) {
        let started = matches!(event.payload, DebugEventPayload::Started { .. });
        lock_recover(&self.events).push(event);
        if started {
            if let Some(entered) = lock_recover(&self.entered).take() {
                entered.send(()).expect("started entered");
            }
            lock_recover(&self.release).recv().expect("release sink");
        }
    }
}

#[test]
fn live_backpressure_is_bounded_and_reserves_exactly_one_terminal_event() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let sink = Arc::new(BlockingStartedSink {
        entered: Mutex::new(Some(entered_tx)),
        events: Mutex::new(Vec::new()),
        release: Mutex::new(release_rx),
    });
    let emitter_slot = Arc::new(Mutex::new(None));
    let worker_registry = Arc::clone(&registry);
    let worker_sink = Arc::clone(&sink);
    let worker_slot = Arc::clone(&emitter_slot);
    let worker = thread::spawn(move || {
        worker_registry.start_session("/workspace/live", worker_sink, |emitter| {
            *lock_recover(&worker_slot) = Some(emitter);
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
    });
    entered_rx.recv().expect("started callback");
    let emitter = lock_recover(&emitter_slot).clone().expect("emitter");
    for index in 0..(MAX_BUFFERED_EVENTS + 64) {
        emitter.emit(output(index.to_string()));
    }
    emitter.emit(DebugEventPayload::Terminated { exit_code: Some(0) });
    emitter.emit(DebugEventPayload::Terminated { exit_code: Some(1) });
    emitter.emit(output("after terminal"));
    release_tx.send(()).expect("release");
    worker.join().expect("worker").expect("start");

    let events = lock_recover(&sink.events);
    assert!(events.len() <= MAX_BUFFERED_EVENTS);
    assert_eq!(diagnostic_count(&events), 1);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
            .count(),
        1
    );
    assert!(!events.iter().any(|event| {
        matches!(&event.payload, DebugEventPayload::Output { text, .. } if text == "after terminal")
    }));
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        (1..=events.len() as u64).collect::<Vec<_>>()
    );
}

#[test]
fn terminal_emitted_during_factory_is_ordered_once_and_rejects_later_events() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    registry
        .start_session("/workspace/terminal", sink.clone(), |emitter| {
            emitter.emit(DebugEventPayload::Terminated { exit_code: Some(7) });
            emitter.emit(DebugEventPayload::Terminated { exit_code: Some(8) });
            emitter.emit(output("late"));
            Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
        })
        .expect("terminal start");
    let events = lock_recover(&sink.events);
    assert_eq!(events.len(), 2);
    assert!(matches!(
        events[0].payload,
        DebugEventPayload::Started { .. }
    ));
    assert_eq!(
        events[1].payload,
        DebugEventPayload::Terminated { exit_code: Some(7) }
    );
}

struct PanickingSink;

impl DebugEventSink for PanickingSink {
    fn emit(&self, _event: DebugEvent) {
        panic!("sink panic");
    }
}

#[test]
fn sink_panic_discards_queue_and_rejects_future_growth() {
    let registry = DebugSessionRegistry::new();
    let emitter_slot = Arc::new(Mutex::new(None));
    registry
        .start_session("/workspace/panic", Arc::new(PanickingSink), {
            let emitter_slot = Arc::clone(&emitter_slot);
            move |emitter| {
                *lock_recover(&emitter_slot) = Some(emitter);
                Ok(MinimalAdapter::boxed(Arc::new(AtomicBool::new(false))))
            }
        })
        .expect("sink panic is contained");
    let emitter = lock_recover(&emitter_slot).clone().expect("emitter");
    for _ in 0..(MAX_BUFFERED_EVENTS * 2) {
        emitter.emit(output("late"));
    }
    let delivery = lock_recover(&emitter.delivery);
    assert!(delivery.phase == DebugEventDeliveryPhase::Discarded);
    assert!(delivery.queued.is_empty());
    assert_eq!(delivery.queued_bytes, 0);
    assert!(!delivery.draining);
}

#[test]
fn poisoned_registry_operation_and_adapter_locks_do_not_skip_termination() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(RecordingSink::default());
    let terminated = Arc::new(AtomicBool::new(false));
    registry
        .start_session("/workspace/poison", sink, {
            let terminated = Arc::clone(&terminated);
            move |_| Ok(MinimalAdapter::boxed(terminated))
        })
        .expect("start");
    let session = {
        let state = lock_recover(&registry.state);
        latest_session_for_root(&state, "/workspace/poison")
            .cloned()
            .expect("session")
    };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = session
            .inspection_operation
            .lock()
            .expect("unpoisoned operation");
        panic!("poison operation lock");
    }));
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = session.adapter.lock().expect("unpoisoned adapter");
        panic!("poison adapter lock");
    }));
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = registry.state.lock().expect("unpoisoned registry");
        panic!("poison registry");
    }));
    assert!(registry.stop("/workspace/poison"));
    assert!(terminated.load(Ordering::SeqCst));
}

#[test]
fn lifecycle_generation_exhaustion_is_fail_closed() {
    let registry = DebugSessionRegistry::new();
    {
        let mut state = lock_recover(&registry.state);
        let lifecycle = state
            .lifecycles
            .entry("/workspace/max".to_string())
            .or_default();
        lifecycle.generation = u64::MAX;
        lifecycle.active = false;
    }
    registry.activate_root("/workspace/max");
    assert!(registry.begin_start("/workspace/max").is_err());

    {
        let mut state = lock_recover(&registry.state);
        let lifecycle = state
            .lifecycles
            .entry("/workspace/deactivate".to_string())
            .or_default();
        lifecycle.generation = u64::MAX;
        lifecycle.active = true;
    }
    registry.deactivate_root("/workspace/deactivate");
    registry.activate_root("/workspace/deactivate");
    assert!(registry.begin_start("/workspace/deactivate").is_err());

    {
        let mut state = lock_recover(&registry.state);
        let lifecycle = state
            .lifecycles
            .entry("/workspace/stop-all".to_string())
            .or_default();
        lifecycle.generation = u64::MAX;
        lifecycle.active = true;
    }
    registry.stop_all();
    assert!(registry.begin_start("/workspace/stop-all").is_err());
}
