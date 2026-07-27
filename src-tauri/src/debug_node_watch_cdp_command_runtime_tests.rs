use super::*;
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvaluateContext, DebugEvaluateFailure, DebugEvaluatePolicy,
    DebugEvent, DebugEventSink, DebugFunctionBreakpoint, DebugFunctionBreakpointVerification,
    DebugScopeInfo, DebugSetExpressionRequest, DebugSetExpressionResult, DebugSetVariableRequest,
    DebugSetVariableResult, DebugStackFrame, DebugVariableInfo, DebugVariablePage,
    DebugVariablePageRequest, StepKind,
};
use crate::debug_cdp::transport::PauseGenerationFloor;
use crate::debug_node_process::watch_cdp::watch_cdp_event_emitter;
use crate::debug_node_process::watch_control_proxy::WatchSetFunctionBreakpointsRequest;
use crate::debug_node_process::watch_event_gate::WatchDebugEventGate;
use crate::debug_session_registry::DebugSessionRegistry;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tungstenite::Message;

#[derive(Default)]
struct NoopSink;

impl DebugEventSink for NoopSink {
    fn emit(&self, _event: DebugEvent) {}
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

struct FakeSocket {
    _worker: JoinHandle<()>,
    methods: Arc<Mutex<Vec<String>>>,
    url: String,
}

#[derive(Clone, Copy)]
enum FakeSocketBehavior {
    Reply(bool),
    OverflowOnRun,
    FunctionBreakpoint(&'static str),
}

impl FakeSocket {
    fn start(reply: bool) -> Self {
        Self::start_with(FakeSocketBehavior::Reply(reply))
    }

    fn start_with(behavior: FakeSocketBehavior) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake socket");
        let port = listener.local_addr().expect("fake address").port();
        let methods = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&methods);
        let worker = thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let Ok(mut socket) = tungstenite::accept(stream) else {
                return;
            };
            while let Ok(message) = socket.read() {
                let Message::Text(text) = message else {
                    continue;
                };
                let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if let Some(method) = request.get("method").and_then(Value::as_str) {
                    recorded.lock().expect("methods").push(method.to_string());
                }
                if matches!(behavior, FakeSocketBehavior::OverflowOnRun)
                    && request.get("method").and_then(Value::as_str)
                        == Some("Runtime.runIfWaitingForDebugger")
                {
                    for _ in 0..300 {
                        let resumed = json!({
                            "method": "Debugger.resumed",
                            "params": {}
                        });
                        if socket
                            .send(Message::Text(resumed.to_string().into()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    continue;
                }
                if matches!(
                    behavior,
                    FakeSocketBehavior::Reply(true) | FakeSocketBehavior::FunctionBreakpoint(_)
                ) {
                    let result = match (behavior, request.get("method").and_then(Value::as_str)) {
                        (
                            FakeSocketBehavior::FunctionBreakpoint(object_id),
                            Some("Runtime.evaluate"),
                        ) => {
                            json!({"result":{"type":"function","objectId":object_id}})
                        }
                        (
                            FakeSocketBehavior::FunctionBreakpoint(object_id),
                            Some("Debugger.setBreakpointOnFunctionCall"),
                        ) => json!({"breakpointId":format!("breakpoint-{object_id}")}),
                        _ => json!({}),
                    };
                    let response = json!({
                        "id": request.get("id").cloned().unwrap_or(json!(0)),
                        "result": result
                    });
                    if socket
                        .send(Message::Text(response.to_string().into()))
                        .is_err()
                    {
                        break;
                    }
                }
            }
        });
        Self {
            _worker: worker,
            methods,
            url: format!("ws://127.0.0.1:{port}/11111111-1111-1111-1111-111111111111"),
        }
    }

    fn methods(&self) -> Vec<String> {
        self.methods.lock().expect("methods").clone()
    }
}

fn function_request() -> WatchSetFunctionBreakpointsRequest {
    WatchSetFunctionBreakpointsRequest::new(
        vec![DebugFunctionBreakpoint {
            id: "fn-render".to_string(),
            function_name: "app.render".to_string(),
            enabled: true,
        }],
        7,
    )
}

#[test]
fn fresh_watch_generations_resolve_and_install_function_breakpoints_again() {
    for object_id in ["generation-one", "generation-two"] {
        let socket = FakeSocket::start_with(FakeSocketBehavior::FunctionBreakpoint(object_id));
        let (_registry, mut runtime) = runtime(&socket, Duration::from_millis(250));
        let revoked = AtomicBool::new(false);

        assert_eq!(
            runtime.execute(
                WatchDebugControlCommand::SetFunctionBreakpoints(function_request()),
                Instant::now() + Duration::from_millis(500),
                &revoked,
            ),
            Ok(WatchDebugControlResponse::FunctionBreakpointsVerified(
                vec![DebugFunctionBreakpointVerification {
                    id: "fn-render".to_string(),
                    verified: true,
                },]
            ))
        );
        assert_eq!(
            socket.methods(),
            ["Runtime.evaluate", "Debugger.setBreakpointOnFunctionCall"]
        );
        runtime.shutdown(Instant::now() + Duration::from_millis(250), &revoked);
    }
}

#[test]
fn unresolved_function_name_is_unverified_without_rejecting_watch_generation() {
    let socket = FakeSocket::start(true);
    let (_registry, mut runtime) = runtime(&socket, Duration::from_millis(250));
    let revoked = AtomicBool::new(false);

    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::SetFunctionBreakpoints(function_request()),
            Instant::now() + Duration::from_millis(500),
            &revoked,
        ),
        Ok(WatchDebugControlResponse::FunctionBreakpointsVerified(
            vec![DebugFunctionBreakpointVerification {
                id: "fn-render".to_string(),
                verified: false,
            },]
        ))
    );
    assert_eq!(socket.methods(), ["Runtime.evaluate"]);
    runtime.shutdown(Instant::now() + Duration::from_millis(250), &revoked);
}

fn emitter() -> (
    DebugSessionRegistry,
    crate::debug_adapter::DebugEventEmitter,
) {
    let registry = DebugSessionRegistry::new();
    registry.activate_root("/workspace/watch-runtime");
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    registry
        .start_session(
            "/workspace/watch-runtime",
            Arc::new(NoopSink),
            move |emitter| {
                *capture.lock().expect("capture") = Some(emitter);
                Ok(Box::new(InertAdapter))
            },
        )
        .expect("emitter session");
    let emitter = captured
        .lock()
        .expect("capture")
        .take()
        .expect("captured emitter");
    (registry, emitter)
}

fn runtime(
    socket: &FakeSocket,
    timeout: Duration,
) -> (DebugSessionRegistry, NodeCdpCommandRuntime) {
    let (registry, emitter) = emitter();
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let lease = gate.prepare_initial().expect("watch lease");
    let adapter = NodeCdpAdapter::connect_watch_transport_at_pause_generation_floor(
        &socket.url,
        watch_cdp_event_emitter(gate, lease, Arc::new(AtomicU64::new(0))),
        timeout,
        None,
        Arc::new(|| true),
        PauseGenerationFloor::INITIAL,
        None,
    )
    .expect("watch adapter");
    (registry, NodeCdpCommandRuntime::new(adapter))
}

#[test]
fn typed_commands_use_exact_single_cdp_requests_and_owned_epoch_response() {
    let socket = FakeSocket::start(true);
    let (_registry, mut runtime) = runtime(&socket, Duration::from_millis(250));
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(500);

    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::RunIfWaitingForDebugger,
            deadline,
            &revoked
        ),
        Ok(WatchDebugControlResponse::Ack)
    );
    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::CurrentPauseEpoch,
            deadline,
            &revoked
        ),
        Ok(WatchDebugControlResponse::PauseEpoch(0))
    );
    assert_eq!(
        runtime.execute(WatchDebugControlCommand::Pause, deadline, &revoked),
        Ok(WatchDebugControlResponse::Ack)
    );
    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::Step(StepKind::StepOver),
            deadline,
            &revoked
        ),
        Ok(WatchDebugControlResponse::Ack)
    );
    assert_eq!(
        socket.methods(),
        [
            "Runtime.runIfWaitingForDebugger",
            "Debugger.pause",
            "Debugger.stepOver"
        ]
    );
    runtime.shutdown(Instant::now() + Duration::from_millis(250), &revoked);
}

#[test]
fn deadline_and_revocation_prevent_late_or_followup_socket_requests() {
    let socket = FakeSocket::start(false);
    let (_registry, mut runtime) = runtime(&socket, Duration::from_secs(1));
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(40);

    assert_eq!(
        runtime.execute(WatchDebugControlCommand::Pause, deadline, &revoked),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );
    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::Step(StepKind::StepInto),
            deadline,
            &revoked
        ),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );
    revoked.store(true, std::sync::atomic::Ordering::Release);
    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::CurrentPauseEpoch,
            Instant::now() + Duration::from_millis(100),
            &revoked
        ),
        Err(WatchDebugCommandFailure::Revoked)
    );
    assert_eq!(socket.methods(), ["Debugger.pause"]);
    runtime.shutdown(Instant::now() + Duration::from_millis(100), &revoked);
}

#[test]
fn staged_event_overflow_closes_transport_and_notifies_disconnect() {
    let socket = FakeSocket::start_with(FakeSocketBehavior::OverflowOnRun);
    let (registry, emitter) = emitter();
    let gate = Arc::new(WatchDebugEventGate::new(emitter));
    let lease = gate.prepare_initial().expect("watch lease");
    let publication = gate.begin_publish(&lease).expect("publication transaction");
    let (disconnected_tx, disconnected_rx) = std::sync::mpsc::channel();
    let adapter = NodeCdpAdapter::connect_watch_transport_at_pause_generation_floor(
        &socket.url,
        watch_cdp_event_emitter(Arc::clone(&gate), lease, Arc::new(AtomicU64::new(0))),
        Duration::from_secs(1),
        None,
        Arc::new(|| true),
        PauseGenerationFloor::INITIAL,
        Some(disconnected_tx),
    )
    .expect("watch adapter");
    let mut runtime = NodeCdpCommandRuntime::new(adapter);
    let revoked = AtomicBool::new(false);

    assert_eq!(
        runtime.execute(
            WatchDebugControlCommand::RunIfWaitingForDebugger,
            Instant::now() + Duration::from_secs(2),
            &revoked,
        ),
        Err(WatchDebugCommandFailure::TargetRejected)
    );
    disconnected_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("overflow closes transport and publishes disconnect");
    assert!(
        gate.seal_publish(&publication).is_none(),
        "overflowed transaction cannot become visible"
    );
    assert_eq!(
        socket.methods(),
        ["Runtime.runIfWaitingForDebugger"],
        "no follow-up request survives fail-closed transport shutdown"
    );
    runtime.shutdown(Instant::now() + Duration::from_millis(100), &revoked);
    drop(registry);
}

struct FakePausedInspection {
    epochs: Mutex<VecDeque<Option<u64>>>,
    frames: Vec<DebugStackFrame>,
    scopes: Vec<DebugScopeInfo>,
    reads: AtomicUsize,
    revoke_on_read: bool,
    expire_on_read: bool,
}

impl FakePausedInspection {
    fn new(epochs: impl IntoIterator<Item = Option<u64>>) -> Self {
        Self {
            epochs: Mutex::new(epochs.into_iter().collect()),
            frames: vec![DebugStackFrame {
                frame_id: 1,
                name: "main".to_string(),
                file_path: Some("/workspace/app.ts".to_string()),
                line_number: 1,
                column: 1,
            }],
            scopes: vec![DebugScopeInfo {
                name: "Local".to_string(),
                variables_reference: 2,
                expensive: false,
            }],
            reads: AtomicUsize::new(0),
            revoke_on_read: false,
            expire_on_read: false,
        }
    }

    fn before_read(&self, deadline: Instant, revoked: &AtomicBool) {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if self.revoke_on_read {
            revoked.store(true, Ordering::Release);
        }
        if self.expire_on_read {
            while Instant::now() < deadline {
                std::hint::spin_loop();
            }
        }
    }
}

impl WatchPausedInspection for FakePausedInspection {
    fn current_pause_epoch(
        &self,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<Option<u64>, String> {
        Ok(self
            .epochs
            .lock()
            .expect("epochs")
            .pop_front()
            .unwrap_or(None))
    }

    fn read_stack_trace(
        &mut self,
        expected_pause_epoch: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchStackTraceResult, String> {
        self.before_read(deadline, revoked);
        WatchStackTraceResult::new(expected_pause_epoch, self.frames.clone())
            .map_err(|()| "invalid stack".to_string())
    }

    fn read_scopes(
        &mut self,
        expected_pause_epoch: u64,
        frame_id: u64,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchScopesResult, String> {
        self.before_read(deadline, revoked);
        WatchScopesResult::new(expected_pause_epoch, frame_id, self.scopes.clone())
            .map_err(|()| "invalid scopes".to_string())
    }

    fn owns_frame(&mut self, frame_id: u64) -> Result<bool, String> {
        Ok(self.frames.iter().any(|frame| frame.frame_id == frame_id))
    }

    fn read_variables_page(
        &mut self,
        request: WatchVariablesRequest,
    ) -> Result<DebugVariablePage, String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if request.frame_id() != 1 || request.variables_reference() != 2 {
            return Err("wrong variables owner".to_string());
        }
        Ok(DebugVariablePage {
            variables: vec![DebugVariableInfo {
                name: "value".to_string(),
                value: "42".to_string(),
                value_type: Some("number".to_string()),
                evaluate_name: Some("value".to_string()),
                variables_reference: 0,
                can_set_value: None,
                set_expression_reference: None,
            }],
            start: request.request().start,
            returned: 1,
            total: Some(1),
            next_start: None,
            truncated: false,
        })
    }

    fn evaluate_with_policy(
        &mut self,
        request: &WatchEvaluateRequest,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(DebugVariableInfo {
            name: request.expression().to_string(),
            value: "42".to_string(),
            value_type: Some("number".to_string()),
            evaluate_name: Some(request.expression().to_string()),
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn set_variable(
        &mut self,
        request: &WatchSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if request.frame_id() != 1
            || request.variables_reference() != 2
            || request.request().name == "constant"
        {
            return Err("read-only or wrong owner".to_string());
        }
        Ok(DebugSetVariableResult {
            value: DebugVariableInfo {
                name: request.request().name.clone(),
                value: "42".to_string(),
                value_type: Some("number".to_string()),
                evaluate_name: Some(request.request().name.clone()),
                variables_reference: 0,
                can_set_value: Some(true),
                set_expression_reference: None,
            },
        })
    }

    fn set_expression(
        &mut self,
        request: &WatchSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if request.frame_id() != 1 || request.set_expression_reference() != 3 {
            return Err("wrong expression authority".to_string());
        }
        Ok(DebugSetExpressionResult {
            set_expression_reference: request.set_expression_reference(),
            expression: request.request().expression.clone(),
            value: DebugVariableInfo {
                name: request.request().expression.clone(),
                value: "42".to_string(),
                value_type: Some("number".to_string()),
                evaluate_name: Some(request.request().expression.clone()),
                variables_reference: 0,
                can_set_value: None,
                set_expression_reference: None,
            },
        })
    }
}

fn stack_request(epoch: u64) -> WatchStackTraceRequest {
    WatchStackTraceRequest::new(epoch).expect("stack request")
}

fn scopes_request(epoch: u64, frame_id: u64) -> WatchScopesRequest {
    WatchScopesRequest::new(epoch, frame_id).expect("scopes request")
}

fn variables_request(epoch: u64, frame_id: u64, reference: u64) -> WatchVariablesRequest {
    WatchVariablesRequest::new(DebugVariablePageRequest {
        pause_generation: epoch,
        frame_id,
        variables_reference: reference,
        start: 0,
        count: 10,
    })
    .expect("variables request")
}

fn evaluate_request(
    epoch: u64,
    frame_id: u64,
    context: DebugEvaluateContext,
) -> WatchEvaluateRequest {
    WatchEvaluateRequest::new(
        epoch,
        frame_id,
        "value".to_string(),
        DebugEvaluatePolicy {
            context,
            allow_side_effects: context != DebugEvaluateContext::Watch,
        },
    )
    .expect("evaluate request")
}

fn set_variable_request(
    epoch: u64,
    frame_id: u64,
    reference: u64,
    name: &str,
) -> WatchSetVariableRequest {
    WatchSetVariableRequest::new(DebugSetVariableRequest {
        pause_generation: epoch,
        frame_id,
        variables_reference: reference,
        name: name.to_string(),
        value: "42".to_string(),
    })
    .expect("set-variable request")
}

fn set_expression_request(epoch: u64, frame_id: u64, reference: u64) -> WatchSetExpressionRequest {
    WatchSetExpressionRequest::new(DebugSetExpressionRequest {
        pause_generation: epoch,
        frame_id,
        set_expression_reference: reference,
        expression: "value".to_string(),
        value: "42".to_string(),
    })
    .expect("set-expression request")
}

#[test]
fn paused_inventory_reads_succeed_only_for_the_exact_pre_and_post_epoch() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut stack = FakePausedInspection::new([Some(7), Some(7)]);
    stack.frames = (1..=257)
        .map(|frame_id| DebugStackFrame {
            frame_id,
            name: "frame".to_string(),
            file_path: None,
            line_number: 1,
            column: 1,
        })
        .collect();
    let result =
        stack_trace_at_epoch(&mut stack, stack_request(7), deadline, &revoked).expect("stack");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frames().len(), 256);
    assert!(result.truncated());

    let mut scopes = FakePausedInspection::new([Some(7), Some(7)]);
    let result =
        scopes_at_epoch(&mut scopes, scopes_request(7, 1), deadline, &revoked).expect("scopes");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frame_id(), 1);
    assert_eq!(result.scopes().len(), 1);
}

#[test]
fn stale_pause_epoch_is_explicit_before_and_after_inventory_read() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut stale_before = FakePausedInspection::new([Some(6)]);
    assert_eq!(
        stack_trace_at_epoch(&mut stale_before, stack_request(7), deadline, &revoked),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(stale_before.reads.load(Ordering::SeqCst), 0);

    let mut stale_after = FakePausedInspection::new([Some(7), Some(8)]);
    assert_eq!(
        scopes_at_epoch(&mut stale_after, scopes_request(7, 1), deadline, &revoked,),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(stale_after.reads.load(Ordering::SeqCst), 1);
}

#[test]
fn deadline_and_revocation_discard_inventory_read_results() {
    let deadline = Instant::now() + Duration::from_millis(2);
    let revoked = AtomicBool::new(false);
    let mut expired = FakePausedInspection::new([Some(7), Some(7)]);
    expired.expire_on_read = true;
    assert_eq!(
        stack_trace_at_epoch(&mut expired, stack_request(7), deadline, &revoked),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );

    let deadline = Instant::now() + Duration::from_millis(100);
    let revoked = AtomicBool::new(false);
    let mut revoked_during_read = FakePausedInspection::new([Some(7), Some(7)]);
    revoked_during_read.revoke_on_read = true;
    assert_eq!(
        scopes_at_epoch(
            &mut revoked_during_read,
            scopes_request(7, 1),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::Revoked)
    );
}

#[test]
fn variables_and_evaluate_require_the_exact_pre_and_post_pause_epoch() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut variables = FakePausedInspection::new([Some(7), Some(7)]);
    let result = variables_at_epoch(
        &mut variables,
        variables_request(7, 1, 2),
        deadline,
        &revoked,
    )
    .expect("variables");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frame_id(), 1);
    assert_eq!(result.variables_reference(), 2);
    assert_eq!(result.page().variables[0].value, "42");

    let mut evaluation = FakePausedInspection::new([Some(7), Some(7)]);
    let result = evaluate_at_epoch(
        &mut evaluation,
        evaluate_request(7, 1, DebugEvaluateContext::Watch),
        deadline,
        &revoked,
    )
    .expect("evaluation");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frame_id(), 1);
    assert_eq!(result.into_outcome().expect("value").value, "42");
}

#[test]
fn variables_and_evaluate_reject_stale_pause_before_and_after_io() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut variables_before = FakePausedInspection::new([Some(6)]);
    assert_eq!(
        variables_at_epoch(
            &mut variables_before,
            variables_request(7, 1, 2),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(variables_before.reads.load(Ordering::SeqCst), 0);

    let mut variables_after = FakePausedInspection::new([Some(7), Some(8)]);
    assert_eq!(
        variables_at_epoch(
            &mut variables_after,
            variables_request(7, 1, 2),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(variables_after.reads.load(Ordering::SeqCst), 1);

    let mut evaluate_after = FakePausedInspection::new([Some(7), Some(8)]);
    assert_eq!(
        evaluate_at_epoch(
            &mut evaluate_after,
            evaluate_request(7, 1, DebugEvaluateContext::Repl),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(evaluate_after.reads.load(Ordering::SeqCst), 1);
}

#[test]
fn variables_and_evaluate_reject_wrong_reference_or_frame_authority() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut wrong_reference = FakePausedInspection::new([Some(7), Some(7)]);
    assert_eq!(
        variables_at_epoch(
            &mut wrong_reference,
            variables_request(7, 1, 99),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::TargetRejected)
    );

    let mut wrong_frame = FakePausedInspection::new([Some(7)]);
    assert_eq!(
        evaluate_at_epoch(
            &mut wrong_frame,
            evaluate_request(7, 99, DebugEvaluateContext::Watch),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::TargetRejected)
    );
    assert_eq!(wrong_frame.reads.load(Ordering::SeqCst), 0);
}

#[test]
fn variable_and_expression_mutations_are_exact_epoch_owned() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut variable = FakePausedInspection::new([Some(7), Some(7)]);
    let result = set_variable_at_epoch(
        &mut variable,
        set_variable_request(7, 1, 2, "value"),
        deadline,
        &revoked,
    )
    .expect("set variable");
    assert_eq!(result.into_result().value.value, "42");

    let mut expression = FakePausedInspection::new([Some(7), Some(7)]);
    let result = set_expression_at_epoch(
        &mut expression,
        set_expression_request(7, 1, 3),
        deadline,
        &revoked,
    )
    .expect("set expression");
    assert_eq!(result.into_result().expression, "value");
}

#[test]
fn mutations_reject_read_only_authority_and_stale_pause_before_or_after_io() {
    let revoked = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut read_only = FakePausedInspection::new([Some(7), Some(7)]);
    assert_eq!(
        set_variable_at_epoch(
            &mut read_only,
            set_variable_request(7, 1, 2, "constant"),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::TargetRejected)
    );

    let mut stale_before = FakePausedInspection::new([Some(6)]);
    assert_eq!(
        set_expression_at_epoch(
            &mut stale_before,
            set_expression_request(7, 1, 3),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(stale_before.reads.load(Ordering::SeqCst), 0);

    let mut stale_after = FakePausedInspection::new([Some(7), Some(8)]);
    assert_eq!(
        set_variable_at_epoch(
            &mut stale_after,
            set_variable_request(7, 1, 2, "value"),
            deadline,
            &revoked,
        ),
        Err(WatchDebugCommandFailure::StalePauseEpoch)
    );
    assert_eq!(stale_after.reads.load(Ordering::SeqCst), 1);
}
