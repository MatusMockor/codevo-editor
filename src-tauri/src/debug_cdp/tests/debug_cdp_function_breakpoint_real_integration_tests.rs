use crate::debug_adapter::{
    DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode,
    DebugFunctionBreakpoint, DebugLaunchTarget, DebugStopReason, StepKind,
};
use crate::debug_session_registry::DebugSessionRegistry;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

const EVENT_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct CapturingSink {
    events: Mutex<Vec<DebugEvent>>,
    event_ready: Condvar,
}

impl DebugEventSink for CapturingSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.events).push(event);
        self.event_ready.notify_all();
    }
}

struct TempWorkspace(PathBuf);

impl TempWorkspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-function-breakpoint-proof-{}-{}",
            std::process::id(),
            NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create function-breakpoint workspace");
        Self(
            root.canonicalize()
                .expect("canonical function-breakpoint workspace"),
        )
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct OwnedDebugSession<'a> {
    registry: &'a DebugSessionRegistry,
    session_id: Option<u64>,
}

impl<'a> OwnedDebugSession<'a> {
    fn new(registry: &'a DebugSessionRegistry, session_id: u64) -> Self {
        Self {
            registry,
            session_id: Some(session_id),
        }
    }

    fn stop(mut self) {
        let session_id = self.session_id.take().expect("owned debug session");
        assert!(self.registry.stop_by_id(session_id));
    }
}

impl Drop for OwnedDebugSession<'_> {
    fn drop(&mut self) {
        let Some(session_id) = self.session_id.take() else {
            return;
        };
        self.registry.stop_by_id(session_id);
    }
}

#[test]
fn real_node_global_dotted_function_breakpoint_verifies_and_pauses() {
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real function-breakpoint proof requires the managed Node.js runtime in CI");
        }
        eprintln!(
            "skipping real function-breakpoint proof: no managed Node.js runtime is available"
        );
        return;
    }

    let workspace = TempWorkspace::new();
    let script = workspace.0.join("function-breakpoint.js");
    fs::write(
        &script,
        concat!(
            "globalThis.codevoQa = { target() { console.log('FUNCTION_BREAKPOINT_HIT'); } };\n",
            "debugger;\n",
            "globalThis.codevoQa.target();\n",
            "setInterval(() => {}, 1000);\n",
        ),
    )
    .expect("write function-breakpoint target");
    let script = script.canonicalize().expect("canonical target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let startup_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
                    &workspace.0,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    startup_current,
                )
            },
        )
        .expect("start real function-breakpoint session");
    let session = OwnedDebugSession::new(&registry, session_id);

    let first_stop = wait_for_stopped(&sink, 0);
    assert_eq!(first_stop.reason, DebugStopReason::Breakpoint);

    let verification = registry
        .with_session(&root_key, |adapter| {
            adapter.set_function_breakpoints(
                &[DebugFunctionBreakpoint {
                    id: "qa-global-function".to_string(),
                    function_name: "globalThis.codevoQa.target".to_string(),
                    enabled: true,
                }],
                2,
            )
        })
        .expect("registered function-breakpoint session")
        .expect("set global dotted function breakpoint");
    assert_eq!(verification.len(), 1);
    assert_eq!(verification[0].id, "qa-global-function");
    assert!(verification[0].verified);

    registry
        .with_session(&root_key, |adapter| adapter.step(StepKind::Continue))
        .expect("registered function-breakpoint session")
        .expect("continue to function call");
    let function_stop = wait_for_stopped(&sink, 1);
    assert_eq!(function_stop.reason, DebugStopReason::Breakpoint);
    assert!(
        function_stop
            .frames
            .first()
            .is_some_and(|frame| frame.name == "target"),
        "expected to stop in target(), got {:?}",
        function_stop.frames
    );

    session.stop();
}

#[test]
fn real_node_late_defined_function_breakpoint_verifies_before_immediate_call() {
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!(
                "real late function-breakpoint proof requires the managed Node.js runtime in CI"
            );
        }
        eprintln!(
            "skipping real late function-breakpoint proof: no managed Node.js runtime is available"
        );
        return;
    }

    let workspace = TempWorkspace::new();
    let script = workspace.0.join("late-function-breakpoint.js");
    fs::write(
        &script,
        concat!(
            "globalThis.qaFunction = function qaFunction() { console.log('LATE_FUNCTION_HIT'); };\n",
            "globalThis.qaFunction();\n",
            "setInterval(() => {}, 1000);\n",
        ),
    )
    .expect("write late function-breakpoint target");
    let script = script.canonicalize().expect("canonical late target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
                    &workspace.0,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    true,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("start real late function-breakpoint session");
    let session = OwnedDebugSession::new(&registry, session_id);

    let entry = wait_for_stopped(&sink, 0);
    assert_eq!(entry.reason, DebugStopReason::Entry);
    let initial = registry
        .with_session(&root_key, |adapter| {
            adapter.set_function_breakpoints(
                &[DebugFunctionBreakpoint {
                    id: "qa-late-function".to_string(),
                    function_name: "globalThis.qaFunction".to_string(),
                    enabled: true,
                }],
                2,
            )
        })
        .expect("registered late function-breakpoint session")
        .expect("set unresolved late function breakpoint");
    assert_eq!(
        initial,
        vec![crate::debug_adapter::DebugFunctionBreakpointVerification {
            id: "qa-late-function".to_string(),
            verified: false,
        }]
    );

    registry
        .with_session(&root_key, |adapter| adapter.step(StepKind::Continue))
        .expect("registered late function-breakpoint session")
        .expect("continue through late definition");
    wait_for_function_breakpoint_verification(&sink, "qa-late-function");
    let function_stop = wait_for_late_function_stop(&sink, 1);
    assert_eq!(function_stop.reason, DebugStopReason::Breakpoint);
    assert!(
        function_stop
            .frames
            .first()
            .is_some_and(|frame| frame.name == "qaFunction"),
        "expected to stop in qaFunction(), got {:?}",
        function_stop.frames
    );
    let visible_stops = lock_recover(&sink.events)
        .iter()
        .filter(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
        .count();
    assert_eq!(
        visible_stops, 2,
        "the hidden late-binding step must not leak a visible pause"
    );

    session.stop();
}

#[test]
fn real_node_preloaded_late_function_breakpoint_hits_without_visible_entry_pause() {
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real preloaded function-breakpoint proof requires managed Node.js in CI");
        }
        return;
    }

    let workspace = TempWorkspace::new();
    let script = workspace.0.join("preloaded-late-function-breakpoint.js");
    fs::write(
        &script,
        concat!(
            "globalThis.qaFunction = function qaFunction() { console.log('PRELOADED_HIT'); };\n",
            "(function qaFunction() { console.log('FOREIGN_SAME_NAME'); })();\n",
            "globalThis.qaFunction();\n",
            "setInterval(() => {}, 1000);\n",
        ),
    )
    .expect("write preloaded function-breakpoint target");
    let script = script.canonicalize().expect("canonical preloaded target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let desired = vec![DebugFunctionBreakpoint {
        id: "qa-preloaded-function".to_string(),
        function_name: "globalThis.qaFunction".to_string(),
        enabled: true,
    }];
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_startup_function_breakpoints(
                    &workspace.0,
                    &launch,
                    &[],
                    &desired,
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("start preloaded function-breakpoint session");
    let session = OwnedDebugSession::new(&registry, session_id);

    wait_for_function_breakpoint_verification(&sink, "qa-preloaded-function");
    let function_stop = wait_for_stopped(&sink, 0);
    assert_eq!(function_stop.reason, DebugStopReason::Breakpoint);
    assert!(
        function_stop
            .frames
            .first()
            .is_some_and(|frame| frame.name == "qaFunction"),
        "expected to stop in preloaded qaFunction(), got {:?}",
        function_stop.frames
    );
    let events = lock_recover(&sink.events);
    let visible_stops = events
        .iter()
        .filter(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
        .count();
    assert_eq!(visible_stops, 1, "startup entry must remain hidden");
    let foreign_output_index = events
        .iter()
        .position(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::Output { text, .. } if text == "FOREIGN_SAME_NAME"
            )
        })
        .expect("foreign same-name function ran without becoming the visible breakpoint");
    let stop_index = events
        .iter()
        .position(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
        .expect("desired function breakpoint stop");
    assert!(
        foreign_output_index < stop_index,
        "same-name foreign pause must remain hidden until the exact desired function"
    );
    drop(events);

    session.stop();
}

#[test]
fn real_node_preloaded_same_line_definition_and_immediate_call_hits_function_breakpoint() {
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real same-line function-breakpoint proof requires managed Node.js in CI");
        }
        return;
    }

    let workspace = TempWorkspace::new();
    let script = workspace
        .0
        .join("preloaded-same-line-function-breakpoint.js");
    fs::write(
        &script,
        concat!(
            "const http = require('http'); ",
            "const marker = 'boot'; ",
            "const large = Array.from({length: 5000}, (_, i) => ({i})); ",
            "globalThis.qaFunction = function qaFunction() { ",
            "const localLarge = large; return localLarge.length; }; ",
            "globalThis.qaFunction(); ",
            "console.log('QA_FUNCTION_HIT', marker, typeof http); ",
            "setInterval(() => {}, 1000);\n",
        ),
    )
    .expect("write same-line function-breakpoint target");
    let script = script.canonicalize().expect("canonical same-line target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let desired = vec![DebugFunctionBreakpoint {
        id: "qa-same-line-function".to_string(),
        function_name: "globalThis.qaFunction".to_string(),
        enabled: true,
    }];
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_startup_function_breakpoints(
                    &workspace.0,
                    &launch,
                    &[],
                    &desired,
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("start same-line function-breakpoint session");
    let session = OwnedDebugSession::new(&registry, session_id);

    wait_for_function_breakpoint_verification(&sink, "qa-same-line-function");
    let function_stop = wait_for_stopped(&sink, 0);
    assert_eq!(function_stop.reason, DebugStopReason::Breakpoint);
    assert!(
        function_stop
            .frames
            .first()
            .is_some_and(|frame| frame.name == "qaFunction"),
        "expected to stop in same-line qaFunction(), got {:?}",
        function_stop.frames
    );
    assert!(
        !lock_recover(&sink.events).iter().any(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::Output { text, .. } if text == "QA_FUNCTION_HIT"
            )
        }),
        "function output must not run before the debugger stops"
    );

    session.stop();
}

#[derive(Clone, Debug)]
struct StoppedEvent {
    frames: Vec<crate::debug_adapter::DebugStackFrame>,
    reason: DebugStopReason,
}

fn wait_for_stopped(sink: &CapturingSink, stopped_index: usize) -> StoppedEvent {
    wait_for_event(sink, "real function-breakpoint stop", |events| {
        events
            .iter()
            .filter_map(|event| match &event.payload {
                DebugEventPayload::Stopped { frames, reason, .. } => Some(StoppedEvent {
                    frames: frames.clone(),
                    reason: *reason,
                }),
                _ => None,
            })
            .nth(stopped_index)
    })
}

fn wait_for_late_function_stop(sink: &CapturingSink, stopped_index: usize) -> StoppedEvent {
    wait_for_event(sink, "late function-breakpoint stop", |events| {
        let mut stopped_count = 0;
        let stopped = events.iter().enumerate().find_map(|(event_index, event)| {
            let DebugEventPayload::Stopped { frames, reason, .. } = &event.payload else {
                return None;
            };
            if stopped_count != stopped_index {
                stopped_count += 1;
                return None;
            }
            Some((
                event_index,
                StoppedEvent {
                    frames: frames.clone(),
                    reason: *reason,
                },
            ))
        });
        let body_output_index = events.iter().position(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::Output { text, .. } if text == "LATE_FUNCTION_HIT"
            )
        });
        let termination_index = events
            .iter()
            .position(|event| matches!(&event.payload, DebugEventPayload::Terminated { .. }));
        if let Some((stopped_event_index, stopped)) = stopped {
            assert!(
                body_output_index.is_none_or(|event_index| event_index > stopped_event_index),
                "late function body ran before its breakpoint stop: {events:?}"
            );
            assert!(
                termination_index.is_none_or(|event_index| event_index > stopped_event_index),
                "late function session terminated before its breakpoint stop: {events:?}"
            );
            return Some(stopped);
        }
        assert!(
            body_output_index.is_none(),
            "late function body ran without its breakpoint stop: {events:?}"
        );
        assert!(
            termination_index.is_none(),
            "late function session terminated without its breakpoint stop: {events:?}"
        );
        None
    })
}

fn wait_for_function_breakpoint_verification(sink: &CapturingSink, expected_id: &str) {
    wait_for_event(sink, "late function-breakpoint verification", |events| {
        events
            .iter()
            .any(|event| {
                matches!(
                    &event.payload,
                    DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. }
                        if breakpoints.iter().any(|breakpoint| {
                            breakpoint.id == expected_id && breakpoint.verified
                        })
                )
            })
            .then_some(())
    });
}

fn wait_for_event<T>(
    sink: &CapturingSink,
    description: &str,
    inspect: impl Fn(&[DebugEvent]) -> Option<T>,
) -> T {
    let deadline = Instant::now() + EVENT_TIMEOUT;
    let mut events = lock_recover(&sink.events);
    loop {
        if let Some(result) = inspect(events.as_slice()) {
            return result;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out waiting for {description}: {:?}",
            events.as_slice()
        );
        let waited = sink
            .event_ready
            .wait_timeout(events, remaining)
            .unwrap_or_else(|error| error.into_inner());
        events = waited.0;
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
