#![allow(dead_code)] // Node CDP debug adapter awaiting the tauri debugger command wiring slice.

use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugCompletionRequest, DebugCompletionResult,
    DebugEventEmitter, DebugEventPayload, DebugExceptionPauseMode, DebugLaunchTarget,
    DebugOutputStream, DebugScopeInfo, DebugStackFrame, DebugStopReason, DebugVariableInfo,
    StepKind,
};
use crate::debug_cdp_breakpoints::{BreakpointPauseDecision, CdpBreakpointHitRegistry};
use crate::debug_inspector_discovery::redact_inspector_url;
use crate::debug_inspector_startup::{
    arm_startup_entry_probe, StartupEntryProbe, StartupEntryValidation,
};
use crate::debug_logpoint::{
    append_bounded_log_output, render_remote_object, DebugLogSegment, DebugLogTemplate,
};
#[cfg(test)]
use crate::debug_node_launch::{build_launch_arguments, INSPECT_FLAG};
use crate::debug_node_launch::{build_launch_plan, source_map_registry};
use crate::debug_node_process::spawn_node_inspector;
use crate::debug_source_map::SourceMapRegistry;
use crate::debug_support::{
    file_url_from_path, group_breakpoints_by_file, path_from_file_url, DebugProcessHandle,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Error as WsError, Message, WebSocket};

#[path = "debug_cdp_completions.rs"]
mod completions;
#[path = "debug_cdp_disconnect.rs"]
mod disconnect;
#[path = "debug_cdp/event_sink.rs"]
pub(crate) mod event_sink;
pub mod lifecycle;
#[path = "debug_node_attach_orchestrator.rs"]
mod node_attach_orchestrator;
pub(crate) use node_attach_orchestrator::{
    NodeAttachCandidateList, NodeAttachCandidateListClosed, NodeAttachCandidatePickerItem,
    NodeAttachCandidatePublicationRegistry,
};
#[path = "debug_cdp_restart_frame.rs"]
mod restart_frame;
#[path = "debug_cdp_run_to_location.rs"]
mod run_to_location;
#[path = "debug_cdp_scope.rs"]
mod scope;
#[path = "debug_cdp_startup_policy.rs"]
mod startup_policy;
#[path = "debug_cdp_transport.rs"]
pub(crate) mod transport;
#[path = "debug_cdp_variables.rs"]
mod variables;

#[cfg(test)]
use self::transport::{
    apply_breakpoint_resolution, build_pause_inventory, mark_explicit_pause_requested,
    original_breakpoint_line, BreakpointResolutionTarget, CdpShared, GeneratedPosition,
    MAX_PENDING_BREAKPOINT_RESOLUTIONS,
};
use self::transport::{CdpStartupPolicy, DebuggeeOwnership, NodeCdpAdapter, NodeCdpConnectOptions};
use lifecycle::DebugSessionFinish;
pub(crate) use startup_policy::ensure_startup_current;
use startup_policy::loopback_web_socket_port;

const CDP_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(25);
const MAX_CDP_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CDP_FRAME_BYTES: usize = 1024 * 1024;
const MAX_CDP_HANDSHAKE_BYTES: usize = 64 * 1024;

include!("debug_cdp_factory.rs");

fn map_stop_reason(reason: &str) -> DebugStopReason {
    match reason {
        "step" => DebugStopReason::Step,
        "exception" | "promiseRejection" => DebugStopReason::Exception,
        _ => DebugStopReason::Breakpoint,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{
        DebugEvent, DebugEventSink, DebugHitCondition, DebugSessionRegistry,
    };
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicU32;
    use std::time::Instant;

    const MOCK_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
    const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_millis(250);
    const EVENT_WAIT_TIMEOUT: Duration = Duration::from_secs(3);
    const WORKSPACE_KEY: &str = "/workspace/debug";
    const CLOSE_MARKER: &str = "<<close-connection>>";

    #[path = "../../debug_cdp_completion_tests.rs"]
    mod completion_tests;
    mod debug_exception_type_filter_integration_tests;
    #[cfg(target_os = "macos")]
    #[path = "debug_cdp_held_external_attach_tests.rs"]
    mod held_external_attach_tests;
    #[path = "debug_cdp_hit_condition_tests.rs"]
    mod hit_condition_tests;
    #[path = "debug_cdp_inline_breakpoint_tests.rs"]
    mod inline_breakpoint_tests;
    #[path = "debug_cdp_internal_step_filter_tests.rs"]
    mod internal_step_filter_tests;
    #[path = "debug_cdp_logpoint_tests.rs"]
    mod logpoint_tests;
    #[path = "debug_cdp_restart_frame_tests.rs"]
    mod restart_frame_tests;
    #[path = "debug_cdp_run_to_location_tests.rs"]
    mod run_to_location_tests;
    #[path = "debug_cdp_variables_tests.rs"]
    mod variables_tests;

    #[derive(Default)]
    struct CollectingSink {
        events: Mutex<Vec<DebugEvent>>,
    }

    impl CollectingSink {
        fn events(&self) -> Vec<DebugEvent> {
            self.events.lock().expect("events").clone()
        }

        fn payloads(&self) -> Vec<DebugEventPayload> {
            self.events()
                .into_iter()
                .map(|event| event.payload)
                .collect()
        }
    }

    impl DebugEventSink for CollectingSink {
        fn emit(&self, event: DebugEvent) {
            self.events.lock().expect("events").push(event);
        }
    }

    type MockResponder = Box<dyn FnMut(u64, &str, &Value) -> Vec<String> + Send>;

    struct MockCdpServer {
        _handle: JoinHandle<()>,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
        url: String,
    }

    impl MockCdpServer {
        fn start(mut responder: MockResponder) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
            let port = listener.local_addr().expect("mock server addr").port();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let recorded = Arc::clone(&requests);
            let _handle = thread::spawn(move || {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let Ok(mut socket) = tungstenite::accept(stream) else {
                    return;
                };
                loop {
                    let message = match socket.read() {
                        Ok(message) => message,
                        Err(_) => break,
                    };
                    let text = match message {
                        Message::Text(text) => text,
                        Message::Close(_) => break,
                        _ => continue,
                    };
                    let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else {
                        continue;
                    };
                    let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
                    let method = request
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let params = request.get("params").cloned().unwrap_or(Value::Null);
                    recorded
                        .lock()
                        .expect("mock requests")
                        .push((method.clone(), params.clone()));
                    for reply in responder(id, &method, &params) {
                        if reply == CLOSE_MARKER {
                            let _ = socket.close(None);
                            return;
                        }
                        if socket.send(Message::text(reply)).is_err() {
                            return;
                        }
                    }
                }
            });
            Self {
                _handle,
                requests,
                url: format!("ws://127.0.0.1:{port}/mock-session"),
            }
        }

        fn requests(&self) -> Vec<(String, Value)> {
            self.requests.lock().expect("mock requests").clone()
        }

        fn methods(&self) -> Vec<String> {
            self.requests()
                .into_iter()
                .map(|(method, _)| method)
                .collect()
        }

        fn params_for(&self, method: &str) -> Vec<Value> {
            self.requests()
                .into_iter()
                .filter(|(request_method, _)| request_method == method)
                .map(|(_, params)| params)
                .collect()
        }
    }

    fn ok(id: u64) -> String {
        json!({"id": id, "result": {}}).to_string()
    }

    fn result(id: u64, result: Value) -> String {
        json!({"id": id, "result": result}).to_string()
    }

    fn error_reply(id: u64, message: &str) -> String {
        json!({"id": id, "error": {"message": message}}).to_string()
    }

    fn event(method: &str, params: Value) -> String {
        json!({"method": method, "params": params}).to_string()
    }

    fn simple_responder() -> MockResponder {
        Box::new(|id, _method, _params| vec![ok(id)])
    }

    fn breakpoint_paused_params() -> Value {
        json!({
            "reason": "other",
            "callFrames": [
                {
                    "callFrameId": "cf-0",
                    "functionName": "handleRequest",
                    "url": "file:///workspace/demo/src/app.js",
                    "location": {"scriptId": "5", "lineNumber": 41, "columnNumber": 4},
                    "scopeChain": [
                        {"type": "local", "object": {"objectId": "scope-local-1"}},
                        {"type": "global", "object": {"objectId": "scope-global-1"}}
                    ]
                },
                {
                    "callFrameId": "cf-1",
                    "functionName": "",
                    "url": "node:internal/modules/run_main",
                    "location": {"lineNumber": 0, "columnNumber": 0},
                    "scopeChain": []
                },
                {
                    "callFrameId": "cf-2",
                    "functionName": "load",
                    "url": "file:///workspace/demo/my%20module.js",
                    "location": {"lineNumber": 7},
                    "scopeChain": []
                }
            ]
        })
    }

    fn flow_responder() -> MockResponder {
        Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event("Debugger.paused", breakpoint_paused_params()),
            ],
            "Debugger.stepOver" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event(
                    "Debugger.paused",
                    json!({"reason": "step", "callFrames": []}),
                ),
            ],
            "Debugger.stepInto" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event(
                    "Debugger.paused",
                    json!({"reason": "exception", "callFrames": []}),
                ),
            ],
            "Runtime.getProperties" => vec![result(
                id,
                json!({
                    "result": [
                        {"name": "count", "value": {"type": "number", "value": 7, "description": "7"}},
                        {"name": "label", "value": {"type": "string", "value": "ready"}},
                        {
                            "name": "user",
                            "value": {
                                "type": "object",
                                "className": "User",
                                "description": "User",
                                "objectId": "obj-user-1"
                            }
                        },
                        {"name": "hidden"}
                    ]
                }),
            )],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({"result": {"type": "number", "value": 42, "description": "42"}}),
            )],
            _ => vec![ok(id)],
        })
    }

    fn start_session_with_mock(
        server_url: &str,
        initial_breakpoints: Vec<DebugBreakpoint>,
        request_timeout: Duration,
    ) -> (DebugSessionRegistry, Arc<CollectingSink>) {
        start_session_with_mock_and_mode(
            server_url,
            initial_breakpoints,
            DebugExceptionPauseMode::None,
            request_timeout,
        )
    }

    fn start_session_with_mock_and_mode(
        server_url: &str,
        initial_breakpoints: Vec<DebugBreakpoint>,
        exception_pause_mode: DebugExceptionPauseMode,
        request_timeout: Duration,
    ) -> (DebugSessionRegistry, Arc<CollectingSink>) {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = server_url.to_string();
        registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                NodeCdpAdapter::connect(
                    &url,
                    emitter,
                    &initial_breakpoints,
                    exception_pause_mode,
                    request_timeout,
                    None,
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect("start mock session");
        (registry, sink)
    }

    fn wait_for<T>(predicate: impl Fn() -> Option<T>, timeout: Duration, description: &str) -> T {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(value) = predicate() {
                return value;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {description}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_stopped(
        sink: &CollectingSink,
        index: usize,
    ) -> (DebugStopReason, Vec<DebugStackFrame>) {
        wait_for(
            || {
                sink.payloads()
                    .into_iter()
                    .filter_map(|payload| match payload {
                        DebugEventPayload::Stopped { reason, frames, .. } => Some((reason, frames)),
                        _ => None,
                    })
                    .nth(index)
            },
            EVENT_WAIT_TIMEOUT,
            "stopped event",
        )
    }

    fn breakpoint(
        file_path: &str,
        id: &str,
        line_number: u32,
        condition: Option<&str>,
        enabled: bool,
    ) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.to_string(),
            file_path: file_path.to_string(),
            line_number,
            column_number: None,
            condition: condition.map(str::to_string),
            hit_condition: None,
            log_message: None,
            enabled,
            verified: false,
        }
    }

    fn breakpoint_fixture_file(name: &str) -> PathBuf {
        let root = temp_root(name);
        let file = root.join("src").join("app.js");
        write_file(&file, "console.log('breakpoint fixture');");
        file
    }

    fn temp_root(name: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let directory = std::env::temp_dir().join(format!(
            "debug-cdp-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).expect("create temp root");
        directory.canonicalize().expect("canonicalize temp root")
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(path, content).expect("write fixture file");
    }

    #[test]
    fn file_url_round_trip_encodes_and_decodes_special_characters() {
        let url = file_url_from_path("/workspace/demo/my app 100%.js");

        assert_eq!(url, "file:///workspace/demo/my%20app%20100%25.js");
        assert_eq!(
            path_from_file_url(&url),
            Some("/workspace/demo/my app 100%.js".to_string())
        );
        assert_eq!(path_from_file_url("node:internal/modules"), None);
    }

    #[test]
    fn builds_node_script_launch_arguments_with_inspect_brk() {
        let root = temp_root("node-script");
        let script = root.join("index.js");
        write_file(&script, "console.log('hi');");

        let arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: script.to_string_lossy().to_string(),
            },
        )
        .expect("build arguments");

        assert_eq!(
            arguments,
            vec![
                INSPECT_FLAG.to_string(),
                script.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn builds_typescript_launch_from_emitted_source_mapped_output() {
        let root = temp_root("typescript-script");
        let source = root.join("src/index.ts");
        let emitted = root.join("dist/index.js");
        write_file(&source, "console.log('ts');");
        write_file(&emitted, "console.log('ts');");
        write_file(
            &root.join("dist/index.js.map"),
            r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        write_file(
            &root.join("tsconfig.json"),
            r#"{"compilerOptions":{"rootDir":"src","outDir":"dist","sourceMap":true}}"#,
        );

        let arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: source.to_string_lossy().to_string(),
            },
        )
        .expect("typescript arguments");

        assert_eq!(
            arguments,
            vec![
                INSPECT_FLAG.to_string(),
                "--enable-source-maps".to_string(),
                emitted.to_string_lossy().to_string(),
            ]
        );
        source_map_registry(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: source.to_string_lossy().to_string(),
            },
        )
        .expect("preloaded source map");
    }

    #[test]
    fn pause_inventory_reports_original_typescript_location() {
        let root = temp_root("typescript-stack");
        let source = root.join("src/index.ts");
        let emitted = root.join("dist/index.js");
        let map = root.join("dist/index.js.map");
        write_file(&source, "const first = 1;\nconst second = 2;\n");
        write_file(&emitted, "const first = 1;\nconst second = 2;\n");
        write_file(
            &map,
            r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAAA;AACA"}"#,
        );
        let generated_url = file_url_from_path(&emitted.to_string_lossy());
        let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
        source_maps
            .register_script(&generated_url, &file_url_from_path(&map.to_string_lossy()))
            .expect("register source map");
        let mut state = CdpShared::new(Some(source_maps));
        let params = json!({
            "callFrames": [{
                "callFrameId": "frame-1",
                "functionName": "run",
                "url": generated_url,
                "location": {"lineNumber": 1, "columnNumber": 0},
                "scopeChain": []
            }]
        });

        let inventory = build_pause_inventory(&params, &mut state).expect("pause inventory");

        assert_eq!(
            inventory.frames[0].file_path.as_deref(),
            Some(source.to_string_lossy().as_ref())
        );
        assert_eq!(inventory.frames[0].line_number, 2);
        assert_eq!(inventory.frames[0].column, 1);
    }

    #[test]
    fn immediate_and_async_breakpoint_resolutions_report_typescript_line() {
        let root = temp_root("typescript-breakpoint-resolution");
        let source = root.join("src/index.ts");
        let emitted = root.join("dist/index.js");
        let map = root.join("dist/index.js.map");
        write_file(&source, "const first = 1;\nconst second = 2;\n");
        write_file(&emitted, "const first = 1;\nconst second = 2;\n");
        write_file(
            &map,
            r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAAA;AACA"}"#,
        );
        let source_path = source.to_string_lossy().to_string();
        let generated_url = file_url_from_path(&emitted.to_string_lossy());
        let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
        source_maps
            .register_script(&generated_url, &file_url_from_path(&map.to_string_lossy()))
            .expect("source map");
        let mut state = CdpShared::new(Some(source_maps));
        let target = BreakpointResolutionTarget {
            breakpoint_id: "source-bp".to_string(),
            column_number: None,
            file_path: source_path.clone(),
            generated_url: generated_url.clone(),
            source_path: source_path.clone(),
        };
        let generated = GeneratedPosition { line: 1, column: 0 };

        assert_eq!(original_breakpoint_line(&state, &target, generated), 2);

        state.breakpoints_by_file.insert(
            source_path.clone(),
            vec![breakpoint(&source_path, "source-bp", 2, None, true)],
        );
        state.resolution_index.insert("cdp-bp".to_string(), target);
        let (_, resolved) =
            apply_breakpoint_resolution(&mut state, "cdp-bp", generated).expect("async resolution");
        assert!(resolved[0].verified);
        assert_eq!(resolved[0].line_number, 2);
    }

    #[test]
    fn builds_vitest_and_jest_launch_arguments() {
        let root = temp_root("test-runners");
        let vitest_entry = root.join("node_modules/vitest/vitest.mjs");
        let jest_entry = root.join("node_modules/jest/bin/jest.js");
        let test_file = root.join("src/app.test.js");
        write_file(&vitest_entry, "export {}");
        write_file(&jest_entry, "module.exports = {}");
        write_file(&test_file, "test('x', () => {});");

        let vitest_arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "vitest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
                package_root_path: root.to_string_lossy().to_string(),
            },
        )
        .expect("vitest arguments");
        let jest_arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "jest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
                package_root_path: root.to_string_lossy().to_string(),
            },
        )
        .expect("jest arguments");

        assert_eq!(
            vitest_arguments,
            vec![
                INSPECT_FLAG.to_string(),
                vitest_entry.to_string_lossy().to_string(),
                "run".to_string(),
                "--no-file-parallelism".to_string(),
                test_file.to_string_lossy().to_string(),
            ]
        );
        assert_eq!(
            jest_arguments,
            vec![
                INSPECT_FLAG.to_string(),
                jest_entry.to_string_lossy().to_string(),
                "--runInBand".to_string(),
                test_file.to_string_lossy().to_string(),
            ]
        );
    }

    #[test]
    fn nested_package_debug_uses_captured_cwd_and_local_or_hoisted_runner_only() {
        let root = temp_root("nested-test-runner");
        let package_a = root.join("packages/a");
        let package_b = root.join("packages/b");
        let test_file = package_a.join("src/app.test.ts");
        let local_entry = package_a.join("node_modules/vitest/vitest.mjs");
        write_file(&root.join("package.json"), "{}");
        write_file(&package_a.join("package.json"), "{}");
        write_file(&package_b.join("package.json"), "{}");
        write_file(&test_file, "test('a', () => {});");
        write_file(&local_entry, "export {};");
        write_file(
            &package_b.join("node_modules/vitest/vitest.mjs"),
            "export {};",
        );

        let plan = build_launch_plan(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "vitest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
                package_root_path: package_a.to_string_lossy().to_string(),
            },
        )
        .expect("nested package launch plan");

        assert_eq!(
            plan.working_directory,
            package_a.canonicalize().expect("canonical package")
        );
        assert_eq!(
            plan.arguments[1],
            local_entry
                .canonicalize()
                .expect("canonical runner")
                .to_string_lossy()
        );
    }

    #[test]
    fn captured_package_root_cannot_cross_workspace_or_target_context() {
        let root = temp_root("package-context-root");
        let outside = temp_root("package-context-outside");
        let package_a = root.join("packages/a");
        let package_b = root.join("packages/b");
        let test_file = package_a.join("src/app.test.ts");
        write_file(&test_file, "test('a', () => {});");
        write_file(&package_b.join("package.json"), "{}");
        write_file(&outside.join("package.json"), "{}");

        for captured_root in [&package_b, &outside] {
            let error = build_launch_plan(
                &root,
                &DebugLaunchTarget::JsTestFile {
                    runner: "vitest".to_string(),
                    file_path: test_file.to_string_lossy().to_string(),
                    package_root_path: captured_root.to_string_lossy().to_string(),
                },
            )
            .expect_err("foreign package context must fail");
            assert!(error.contains("Package tool root must be an ancestor"));
        }
    }

    #[test]
    fn rejects_launch_targets_outside_the_workspace_root() {
        let root = temp_root("containment-root");
        let outside = temp_root("containment-outside").join("escape.js");
        write_file(&outside, "console.log('nope');");

        let error = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: outside.to_string_lossy().to_string(),
            },
        )
        .expect_err("outside target must fail");

        assert!(error.contains("outside the workspace root"));
    }

    #[test]
    fn rejects_missing_targets_and_uninstalled_runners() {
        let root = temp_root("missing-targets");
        let test_file = root.join("src/app.test.js");
        write_file(&test_file, "test('x', () => {});");

        let missing_script = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: root.join("absent.js").to_string_lossy().to_string(),
            },
        )
        .expect_err("missing script must fail");
        let missing_runner = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "vitest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
                package_root_path: root.to_string_lossy().to_string(),
            },
        )
        .expect_err("missing runner must fail");
        let unsupported_runner = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "mocha".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
                package_root_path: root.to_string_lossy().to_string(),
            },
        )
        .expect_err("unsupported runner must fail");

        assert!(missing_script.contains("was not found"));
        assert!(missing_runner.contains("not installed"));
        assert!(unsupported_runner.contains("Unsupported JavaScript test runner"));
    }

    #[test]
    fn rejects_jsx_and_typescript_declaration_launches() {
        let root = temp_root("unsupported-source-launch");
        let jsx = root.join("view.jsx");
        let declaration = root.join("types.d.ts");
        write_file(&jsx, "export const view = <div />;");
        write_file(&declaration, "export declare const value: string;");

        let jsx_error = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: jsx.to_string_lossy().to_string(),
            },
        )
        .expect_err("jsx needs a transpilation flow");
        let declaration_error = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: declaration.to_string_lossy().to_string(),
            },
        )
        .expect_err("declaration cannot run");

        assert!(jsx_error.contains("JavaScript and TypeScript source files only"));
        assert!(declaration_error.contains("declaration files cannot be launched"));
    }

    #[test]
    fn attached_handshake_never_runs_or_auto_resumes_the_external_target() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setPauseOnExceptions" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason":"other", "callFrames":[]}),
                ),
            ],
            _ => vec![ok(id)],
        }));
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = server.url.clone();
        registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                NodeCdpAdapter::connect_with_source_maps(
                    &url,
                    emitter,
                    &[],
                    NodeCdpConnectOptions {
                        exception_pause_mode: DebugExceptionPauseMode::None,
                        request_timeout: MOCK_REQUEST_TIMEOUT,
                        ownership: DebuggeeOwnership::External,
                        source_maps: None,
                        startup: CdpStartupPolicy::Attached,
                        disconnected: None,
                        startup_is_current: Arc::new(|| true),
                        internal_step_filter: None,
                    },
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect("attach session");

        wait_for(
            || {
                sink.payloads()
                    .iter()
                    .any(|payload| {
                        matches!(
                            payload,
                            DebugEventPayload::Stopped {
                                reason: DebugStopReason::Breakpoint,
                                ..
                            }
                        )
                    })
                    .then_some(())
            },
            EVENT_WAIT_TIMEOUT,
            "attached pause event",
        );
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.disconnect())
            .expect("disconnect attached adapter");
        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable",
                "Debugger.enable",
                "Debugger.setPauseOnExceptions",
                "Runtime.runIfWaitingForDebugger",
                "Debugger.resume",
            ]
        );
    }

    #[test]
    fn stale_attach_startup_stops_before_any_later_cdp_mutation_or_registration() {
        let current = Arc::new(AtomicBool::new(true));
        let responder_current = Arc::clone(&current);
        let server = MockCdpServer::start(Box::new(move |id, method, _params| {
            if method == "Runtime.enable" {
                responder_current.store(false, Ordering::SeqCst);
            }
            vec![ok(id)]
        }));
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = server.url.clone();
        let guard = Arc::clone(&current);
        let error = registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                NodeCdpAdapter::connect_with_source_maps(
                    &url,
                    emitter,
                    &[],
                    NodeCdpConnectOptions {
                        exception_pause_mode: DebugExceptionPauseMode::All,
                        request_timeout: MOCK_REQUEST_TIMEOUT,
                        ownership: DebuggeeOwnership::External,
                        source_maps: None,
                        startup: CdpStartupPolicy::Attached,
                        disconnected: None,
                        startup_is_current: Arc::new(move || guard.load(Ordering::SeqCst)),
                        internal_step_filter: None,
                    },
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect_err("stale startup must fail closed");

        assert!(error.contains("lifecycle changed"));
        assert_eq!(server.methods(), vec!["Runtime.enable".to_string()]);
        assert_eq!(registry.session_id_for_root(WORKSPACE_KEY), None);
    }

    #[test]
    fn attached_socket_close_notifies_a_separate_lifecycle_waiter() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setPauseOnExceptions" => vec![ok(id), CLOSE_MARKER.to_string()],
            _ => vec![ok(id)],
        }));
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        let url = server.url.clone();
        registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                NodeCdpAdapter::connect_with_source_maps(
                    &url,
                    emitter,
                    &[],
                    NodeCdpConnectOptions {
                        exception_pause_mode: DebugExceptionPauseMode::None,
                        request_timeout: MOCK_REQUEST_TIMEOUT,
                        ownership: DebuggeeOwnership::External,
                        source_maps: None,
                        startup: CdpStartupPolicy::Attached,
                        disconnected: Some(disconnected_tx),
                        startup_is_current: Arc::new(|| true),
                        internal_step_filter: None,
                    },
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect("attach session");

        disconnected_rx
            .recv_timeout(EVENT_WAIT_TIMEOUT)
            .expect("disconnect notification");
        assert_eq!(registry.session_id_for_root(WORKSPACE_KEY), Some(1));
        assert!(registry.stop_by_id(1));
    }

    #[test]
    fn websocket_handshake_is_bounded() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind oversized handshake");
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let oversized = vec![b'a'; MAX_CDP_HANDSHAKE_BYTES + 1];
            let _ = stream.write_all(b"HTTP/1.1 101 Switching Protocols\r\nX-Oversized: ");
            let _ = stream.write_all(&oversized);
            let _ = stream.write_all(b"\r\n\r\n");
        });
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = format!("ws://127.0.0.1:{port}/bounded");
        let error = registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                NodeCdpAdapter::connect(
                    &url,
                    emitter,
                    &[],
                    DebugExceptionPauseMode::None,
                    MOCK_REQUEST_TIMEOUT,
                    None,
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect_err("oversized handshake must fail");
        assert!(error.contains("handshake") || error.contains("protocol"));
        server.join().unwrap();
    }

    #[test]
    fn exception_pause_mode_is_applied_before_initial_breakpoints_and_run() {
        let file = breakpoint_fixture_file("exception-pause-order");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setBreakpointByUrl" => vec![result(
                id,
                json!({"breakpointId": "exception-order", "locations": []}),
            )],
            _ => vec![ok(id)],
        }));

        let (_registry, _sink) = start_session_with_mock_and_mode(
            &server.url,
            vec![breakpoint(&file_path, "bp-1", 1, None, true)],
            DebugExceptionPauseMode::Uncaught,
            MOCK_REQUEST_TIMEOUT,
        );

        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Debugger.setPauseOnExceptions".to_string(),
                "Debugger.setBreakpointByUrl".to_string(),
                "Runtime.runIfWaitingForDebugger".to_string(),
            ]
        );
        assert_eq!(
            server.params_for("Debugger.setPauseOnExceptions"),
            vec![json!({ "state": "uncaught" })]
        );
    }

    #[test]
    fn exception_pause_startup_failure_aborts_before_breakpoints_and_run() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.setPauseOnExceptions" {
                vec![error_reply(id, "pause policy rejected")]
            } else {
                vec![ok(id)]
            }
        }));
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = server.url.clone();

        let error = registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                NodeCdpAdapter::connect(
                    &url,
                    emitter,
                    &[],
                    DebugExceptionPauseMode::All,
                    MOCK_REQUEST_TIMEOUT,
                    None,
                )
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect_err("startup must fail closed");

        assert!(error.contains("pause policy rejected"));
        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Debugger.setPauseOnExceptions".to_string(),
            ]
        );
        assert_eq!(registry.session_id_for_root(WORKSPACE_KEY), None);
    }

    #[test]
    fn live_exception_pause_toggle_uses_the_typed_cdp_state() {
        let server = MockCdpServer::start(simple_responder());
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let session_id = registry
            .session_id_for_root(WORKSPACE_KEY)
            .expect("debug session id");

        registry
            .with_session_by_id(session_id, |adapter| {
                adapter.set_exception_pause(DebugExceptionPauseMode::All)
            })
            .expect("known session")
            .expect("live exception pause");

        assert_eq!(
            server.params_for("Debugger.setPauseOnExceptions"),
            vec![json!({ "state": "none" }), json!({ "state": "all" })]
        );
    }

    #[test]
    fn initial_breakpoints_are_set_before_run_and_verified_with_adjusted_lines() {
        let file = breakpoint_fixture_file("initial-bps");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setBreakpointByUrl" => vec![result(
                id,
                json!({
                    "breakpointId": "cdp-bp-1",
                    "locations": [{"scriptId": "1", "lineNumber": 12, "columnNumber": 0}]
                }),
            )],
            _ => vec![ok(id)],
        }));

        let (_registry, sink) = start_session_with_mock(
            &server.url,
            vec![
                breakpoint(&file_path, "bp-1", 12, Some("count > 3"), true),
                breakpoint(&file_path, "bp-2", 20, None, false),
            ],
            MOCK_REQUEST_TIMEOUT,
        );

        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Debugger.setPauseOnExceptions".to_string(),
                "Debugger.setBreakpointByUrl".to_string(),
                "Runtime.runIfWaitingForDebugger".to_string(),
            ]
        );
        let set_params = server.params_for("Debugger.setBreakpointByUrl");
        assert_eq!(set_params.len(), 1);
        assert_eq!(
            set_params[0],
            json!({
                "url": file_url_from_path(&file_path),
                "lineNumber": 11,
                "condition": "count > 3",
            })
        );
        let verified = sink
            .payloads()
            .into_iter()
            .find_map(|payload| match payload {
                DebugEventPayload::BreakpointsVerified {
                    file_path,
                    breakpoints,
                } => Some((file_path, breakpoints)),
                _ => None,
            })
            .expect("breakpoints verified event");
        assert_eq!(verified.0, file_path);
        assert_eq!(verified.1.len(), 2);
        assert!(verified.1[0].verified);
        assert_eq!(verified.1[0].line_number, 13);
        assert_eq!(verified.1[0].condition, Some("count > 3".to_string()));
        assert!(!verified.1[1].verified);
        assert_eq!(verified.1[1].line_number, 20);
    }

    #[test]
    fn set_breakpoints_removes_previous_file_breakpoints_before_setting_new_ones() {
        let file = breakpoint_fixture_file("replace-bps");
        let file_path = file.to_string_lossy().to_string();
        let counter = Arc::new(AtomicU64::new(1));
        let responder_counter = Arc::clone(&counter);
        let server = MockCdpServer::start(Box::new(move |id, method, params| match method {
            "Debugger.setBreakpointByUrl" => {
                let next = responder_counter.fetch_add(1, Ordering::SeqCst);
                let line = params
                    .get("lineNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                vec![result(
                    id,
                    json!({
                        "breakpointId": format!("cdp-bp-{next}"),
                        "locations": [{"scriptId": "1", "lineNumber": line, "columnNumber": 0}]
                    }),
                )]
            }
            _ => vec![ok(id)],
        }));
        let (registry, _sink) = start_session_with_mock(
            &server.url,
            vec![breakpoint(&file_path, "bp-1", 12, None, true)],
            MOCK_REQUEST_TIMEOUT,
        );

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    &file_path,
                    &[breakpoint(&file_path, "bp-2", 30, None, true)],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        let methods = server.methods();
        let remove_position = methods
            .iter()
            .position(|method| method == "Debugger.removeBreakpoint")
            .expect("remove request");
        let second_set_position = methods
            .iter()
            .rposition(|method| method == "Debugger.setBreakpointByUrl")
            .expect("second set request");
        assert!(remove_position < second_set_position);
        assert_eq!(
            server.params_for("Debugger.removeBreakpoint"),
            vec![json!({"breakpointId": "cdp-bp-1"})]
        );
        assert_eq!(updated.len(), 1);
        assert!(updated[0].verified);
        assert_eq!(updated[0].line_number, 30);
    }

    #[test]
    fn set_breakpoints_marks_rejected_breakpoints_as_unverified() {
        let file = breakpoint_fixture_file("rejected-bps");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, params| match method {
            "Debugger.setBreakpointByUrl" => {
                if params.get("lineNumber").and_then(Value::as_u64) == Some(99) {
                    return vec![error_reply(id, "Cannot set breakpoint")];
                }
                vec![result(
                    id,
                    json!({
                        "breakpointId": "cdp-bp-ok",
                        "locations": [{"scriptId": "1", "lineNumber": 9, "columnNumber": 0}]
                    }),
                )]
            }
            _ => vec![ok(id)],
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    &file_path,
                    &[
                        breakpoint(&file_path, "bp-1", 10, None, true),
                        breakpoint(&file_path, "bp-2", 100, None, true),
                    ],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        assert!(updated[0].verified);
        assert_eq!(updated[0].line_number, 10);
        assert!(!updated[1].verified);
    }

    #[test]
    fn set_breakpoints_for_unresolvable_paths_returns_unverified_without_cdp_calls() {
        let server = MockCdpServer::start(simple_responder());
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let missing_file = "/nonexistent/debug-cdp/app.js";

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    missing_file,
                    &[breakpoint(missing_file, "bp-1", 5, None, true)],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        assert_eq!(updated.len(), 1);
        assert!(!updated[0].verified);
        assert!(!server
            .methods()
            .contains(&"Debugger.setBreakpointByUrl".to_string()));
    }

    #[test]
    fn entry_pause_is_auto_resumed_without_events_and_next_pause_emits_mapped_frames() {
        let server = MockCdpServer::start(flow_responder());

        let (_registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (reason, frames) = wait_for_stopped(&sink, 0);

        assert_eq!(reason, DebugStopReason::Breakpoint);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].name, "handleRequest");
        assert_eq!(
            frames[0].file_path,
            Some("/workspace/demo/src/app.js".to_string())
        );
        assert_eq!(frames[0].line_number, 42);
        assert_eq!(frames[0].column, 5);
        assert_eq!(frames[1].name, "(anonymous)");
        assert_eq!(frames[1].file_path, None);
        assert_eq!(frames[1].line_number, 1);
        assert_eq!(frames[1].column, 1);
        assert_eq!(
            frames[2].file_path,
            Some("/workspace/demo/my module.js".to_string())
        );
        assert_eq!(frames[2].line_number, 8);
        assert_eq!(frames[2].column, 1);
        let resume_requests = server
            .methods()
            .into_iter()
            .filter(|method| method == "Debugger.resume")
            .count();
        assert_eq!(resume_requests, 1);
        let resumed_events = sink
            .payloads()
            .into_iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count();
        assert_eq!(resumed_events, 0);
    }

    #[test]
    fn malformed_inbound_messages_are_ignored() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.pause" {
                return vec![
                    "{ this is not json".to_string(),
                    json!({"unexpected": true}).to_string(),
                    ok(id),
                ];
            }
            vec![ok(id)]
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let paused = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session");

        assert_eq!(paused, Ok(()));
    }

    #[test]
    fn socket_close_mid_pending_request_fails_with_connection_closed() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.pause" {
                return vec![CLOSE_MARKER.to_string()];
            }
            vec![ok(id)]
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session")
            .expect_err("request must fail on close");

        assert!(error.contains("connection closed"));
    }

    #[test]
    fn evaluate_uses_the_call_frame_id_without_side_effects() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let evaluated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "count + 1")
            })
            .expect("session")
            .expect("evaluate");

        assert_eq!(
            server.params_for("Debugger.evaluateOnCallFrame"),
            vec![json!({
                "callFrameId": "cf-0",
                "expression": "count + 1",
                "throwOnSideEffect": false,
            })]
        );
        assert_eq!(evaluated.name, "count + 1");
        assert_eq!(evaluated.value, "42");
        assert_eq!(evaluated.value_type, Some("number".to_string()));
        assert_eq!(evaluated.variables_reference, 0);
    }

    #[test]
    fn evaluate_surfaces_exception_details_as_errors() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({
                    "result": {"type": "object", "subtype": "error"},
                    "exceptionDetails": {
                        "text": "Uncaught",
                        "exception": {"description": "ReferenceError: nope is not defined"}
                    }
                }),
            )],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "nope")
            })
            .expect("session")
            .expect_err("evaluation must fail");

        assert_eq!(error, "ReferenceError: nope is not defined");
    }

    #[test]
    fn step_commands_map_to_cdp_methods_and_resume_events_flow_through() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        wait_for_stopped(&sink, 0);

        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
            .expect("session")
            .expect("step over");
        let (step_reason, _) = wait_for_stopped(&sink, 1);
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepInto))
            .expect("session")
            .expect("step into");
        let (exception_reason, _) = wait_for_stopped(&sink, 2);
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOut))
            .expect("session")
            .expect("step out");

        assert_eq!(step_reason, DebugStopReason::Step);
        assert_eq!(exception_reason, DebugStopReason::Exception);
        let methods = server.methods();
        assert!(methods.contains(&"Debugger.stepOver".to_string()));
        assert!(methods.contains(&"Debugger.stepInto".to_string()));
        assert!(methods.contains(&"Debugger.stepOut".to_string()));
        let resumed_events = wait_for(
            || {
                let count = sink
                    .payloads()
                    .into_iter()
                    .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
                    .count();
                (count >= 2).then_some(count)
            },
            EVENT_WAIT_TIMEOUT,
            "resumed events",
        );
        assert_eq!(resumed_events, 2);
    }

    #[test]
    fn resume_clears_the_pause_cache() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
            .expect("session")
            .expect("step over");
        wait_for(
            || {
                sink.payloads()
                    .into_iter()
                    .any(|payload| matches!(payload, DebugEventPayload::Resumed))
                    .then_some(())
            },
            EVENT_WAIT_TIMEOUT,
            "resumed event",
        );
        wait_for_stopped(&sink, 1);

        let stale_scopes = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.scopes(frames[0].frame_id))
            .expect("session");

        assert!(stale_scopes.is_err());
    }
}
