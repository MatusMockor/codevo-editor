use super::smart_step::SmartStepDirection;
use super::smart_step_runtime::{
    commit_smart_step_dispatch, expire_smart_step_request, finish_smart_step_dispatch,
    handle_smart_step_response,
};
use super::{
    begin_smart_step_pause, fail_closed_socket_loop, CdpShared, DisconnectNotifier,
    PauseGenerationFloor, PendingCdpRequests, SocketLoopContext,
};
use crate::debug_adapter::DebugEventPayload;
use crate::debug_cdp::event_sink::{CdpEventDisposition, CdpEventEmitter, CdpEventSinkPort};
use crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState;
use crate::debug_exception_type_filter::ExceptionFilterState;
use crate::debug_source_map::SourceMapRegistry;
use crate::debug_support::file_url_from_path;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct CapturingSink(Mutex<Vec<DebugEventPayload>>);

impl CdpEventSinkPort for CapturingSink {
    fn emit(&self, payload: DebugEventPayload) -> CdpEventDisposition {
        self.0.lock().expect("capture sink").push(payload);
        CdpEventDisposition::Delivered
    }
}

impl CapturingSink {
    fn stopped_count(&self) -> usize {
        self.0
            .lock()
            .expect("capture sink")
            .iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Stopped { .. }))
            .count()
    }
}

struct RuntimeFixture {
    context: SocketLoopContext,
    generated_url: String,
    root: std::path::PathBuf,
    sink: Arc<CapturingSink>,
}

impl Drop for RuntimeFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn runtime_fixture() -> RuntimeFixture {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "codevo-smart-step-runtime-{}-{nonce}",
        std::process::id()
    ));
    let dist = root.join("dist");
    let src = root.join("src");
    fs::create_dir_all(&dist).expect("dist");
    fs::create_dir_all(&src).expect("src");
    let root = fs::canonicalize(root).expect("canonical root");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    fs::write(&generated, "compiled();\nsecond();\n").expect("generated");
    fs::write(&source, "source();\n").expect("source");
    fs::write(
        &map,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
    )
    .expect("map");
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let prepared = registry
        .loader()
        .prepare_script(
            "script",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("prepare");
    registry.commit_script(prepared).expect("commit");

    let mut shared =
        CdpShared::new_with_smart_step(Some(registry), PauseGenerationFloor::INITIAL, true);
    let now = Instant::now();
    let receipt = shared
        .smart_step_policy
        .begin_user_step(SmartStepDirection::Over, 0, 50, now)
        .expect("user step");
    assert!(shared.smart_step_policy.confirm_user_request(receipt, now));
    assert!(!shared.smart_step_policy.observe_resumed());
    assert_eq!(shared.advance_pause_generation(), Some(1));
    shared.first_pause_seen = true;

    let sink = Arc::new(CapturingSink(Mutex::new(Vec::new())));
    let emitter = CdpEventEmitter::new(sink.clone());
    let (_outgoing, outgoing) = mpsc::sync_channel(1);
    let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
    let (function_breakpoint_trigger, _function_breakpoint_triggers) = mpsc::sync_channel(1);
    RuntimeFixture {
        context: SocketLoopContext {
            disconnect_notifier: DisconnectNotifier::new(None),
            emitter,
            exception_filter: Arc::new(Mutex::new(ExceptionFilterState::default())),
            next_request_id: Arc::new(AtomicU64::new(100)),
            outgoing,
            pending,
            request_timeout: Duration::from_secs(1),
            shared: Arc::new(Mutex::new(shared)),
            shutdown: Arc::new(AtomicBool::new(false)),
            mutation_is_allowed: Arc::new(|| true),
            function_breakpoint_trigger,
            function_breakpoints: Arc::new(FunctionBreakpointSessionState::default()),
        },
        generated_url,
        root,
        sink,
    }
}

fn hidden_pause(generated_url: &str) -> Value {
    json!({
        "reason": "step",
        "hitBreakpoints": [],
        "callFrames": [{
            "callFrameId": "frame",
            "functionName": "compiled",
            "url": generated_url,
            "location": {
                "scriptId": "script",
                "lineNumber": 1,
                "columnNumber": 0
            },
            "scopeChain": []
        }]
    })
}

fn dispatch_hidden_pause(fixture: &RuntimeFixture) -> u64 {
    let request = begin_smart_step_pause(&hidden_pause(&fixture.generated_url), &fixture.context)
        .expect("hidden step request");
    let request_id = serde_json::from_str::<Value>(&request)
        .expect("request json")
        .get("id")
        .and_then(Value::as_u64)
        .expect("request id");
    let lease = commit_smart_step_dispatch(&fixture.context).expect("dispatch admitted");
    finish_smart_step_dispatch(&fixture.context, lease);
    request_id
}

fn assert_session_settled(fixture: &RuntimeFixture) {
    let mut shared = fixture.context.shared.lock().expect("shared");
    assert!(!shared.smart_step_policy.is_active());
    assert!(shared.smart_step_fallback.is_none());
    assert!(shared.smart_step_dispatch_lease.is_none());
    let receipt = shared
        .smart_step_policy
        .begin_user_step(SmartStepDirection::Into, 10, 500, Instant::now())
        .expect("fresh step after settlement");
    shared.smart_step_policy.reject_user_request(receipt);
    assert!(!shared.smart_step_policy.is_active());
}

#[test]
fn internal_error_publishes_the_hidden_pause_exactly_once_and_settles() {
    let fixture = runtime_fixture();
    let request_id = dispatch_hidden_pause(&fixture);
    let error = json!({"id": request_id, "error": {"message": "step failed"}});

    assert!(handle_smart_step_response(
        request_id,
        &error,
        &fixture.context
    ));
    assert!(!handle_smart_step_response(
        request_id,
        &error,
        &fixture.context
    ));
    assert_eq!(fixture.sink.stopped_count(), 1);
    assert_session_settled(&fixture);
}

#[test]
fn internal_timeout_publishes_the_hidden_pause_exactly_once_and_settles() {
    let fixture = runtime_fixture();
    let _request_id = dispatch_hidden_pause(&fixture);
    fixture
        .context
        .shared
        .lock()
        .expect("shared")
        .smart_step_policy
        .expire_now_for_test();

    expire_smart_step_request(&fixture.context);
    expire_smart_step_request(&fixture.context);
    assert_eq!(fixture.sink.stopped_count(), 1);
    assert_session_settled(&fixture);
}

#[test]
fn map_replacement_before_dispatch_publishes_the_hidden_pause_once_and_settles() {
    let fixture = runtime_fixture();
    let _request = begin_smart_step_pause(&hidden_pause(&fixture.generated_url), &fixture.context)
        .expect("hidden step request");
    fixture
        .context
        .shared
        .lock()
        .expect("shared")
        .source_maps
        .as_mut()
        .expect("source maps")
        .evict_exact_script("script", &fixture.generated_url);

    assert!(commit_smart_step_dispatch(&fixture.context).is_none());
    let second = commit_smart_step_dispatch(&fixture.context).expect("ordinary dispatch");
    assert!(second.is_none());
    assert_eq!(fixture.sink.stopped_count(), 1);
    assert_session_settled(&fixture);
}

#[test]
fn disconnect_cancels_an_in_flight_hidden_step_without_publishing_a_stale_pause() {
    let fixture = runtime_fixture();
    let _request_id = dispatch_hidden_pause(&fixture);

    fail_closed_socket_loop(&fixture.context);
    fail_closed_socket_loop(&fixture.context);

    assert_eq!(fixture.sink.stopped_count(), 0);
    assert_session_settled(&fixture);
}
