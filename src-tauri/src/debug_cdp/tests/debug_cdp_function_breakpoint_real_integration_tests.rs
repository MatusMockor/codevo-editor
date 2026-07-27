use crate::debug_adapter::{
    DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode,
    DebugFunctionBreakpoint, DebugLaunchTarget, DebugStopReason, StepKind,
};
use crate::debug_session_registry::DebugSessionRegistry;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

const EVENT_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct CapturingSink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for CapturingSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.0).push(event);
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
            "setTimeout(() => {}, 25);\n",
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

    assert!(registry.stop_by_id(session_id));
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
            "setTimeout(() => {}, 25);\n",
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
    let function_stop = wait_for_stopped(&sink, 1);
    assert_eq!(function_stop.reason, DebugStopReason::Breakpoint);
    assert!(
        function_stop
            .frames
            .first()
            .is_some_and(|frame| frame.name == "qaFunction"),
        "expected to stop in qaFunction(), got {:?}",
        function_stop.frames
    );
    let visible_stops = lock_recover(&sink.0)
        .iter()
        .filter(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
        .count();
    assert_eq!(
        visible_stops, 2,
        "the hidden late-binding step must not leak a visible pause"
    );

    assert!(registry.stop_by_id(session_id));
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
            "setTimeout(() => {}, 25);\n",
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
    let events = lock_recover(&sink.0);
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

    assert!(registry.stop_by_id(session_id));
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
            "setTimeout(() => {}, 25);\n",
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
        !lock_recover(&sink.0).iter().any(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::Output { text, .. } if text == "QA_FUNCTION_HIT"
            )
        }),
        "function output must not run before the debugger stops"
    );

    assert!(registry.stop_by_id(session_id));
}

#[derive(Clone, Debug)]
struct StoppedEvent {
    frames: Vec<crate::debug_adapter::DebugStackFrame>,
    reason: DebugStopReason,
}

fn wait_for_stopped(sink: &CapturingSink, stopped_index: usize) -> StoppedEvent {
    let deadline = Instant::now() + EVENT_TIMEOUT;
    loop {
        let stopped: Vec<_> = lock_recover(&sink.0)
            .iter()
            .filter_map(|event| match &event.payload {
                DebugEventPayload::Stopped { frames, reason, .. } => Some(StoppedEvent {
                    frames: frames.clone(),
                    reason: *reason,
                }),
                _ => None,
            })
            .collect();
        if let Some(event) = stopped.get(stopped_index) {
            return event.clone();
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for real function-breakpoint stop: {:?}",
            lock_recover(&sink.0).as_slice()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn wait_for_function_breakpoint_verification(sink: &CapturingSink, expected_id: &str) {
    let deadline = Instant::now() + EVENT_TIMEOUT;
    loop {
        let verified = lock_recover(&sink.0).iter().any(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. }
                    if breakpoints.iter().any(|breakpoint| {
                        breakpoint.id == expected_id && breakpoint.verified
                    })
            )
        });
        if verified {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for late function-breakpoint verification: {:?}",
            lock_recover(&sink.0).as_slice()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
