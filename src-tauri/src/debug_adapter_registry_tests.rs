use crate::debug_adapter::*;
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use crate::debug_session_registry::DebugSessionMode;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
struct FakeAdapterState {
    calls: Arc<Mutex<Vec<String>>>,
    terminated: Arc<AtomicBool>,
}

impl FakeAdapterState {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls").clone()
    }

    fn record(&self, call: String) {
        self.calls.lock().expect("calls").push(call);
    }

    fn is_terminated(&self) -> bool {
        self.terminated.load(Ordering::SeqCst)
    }
}

struct FakeAdapter {
    breakpoint_response: Result<Vec<DebugBreakpoint>, String>,
    state: FakeAdapterState,
}

impl FakeAdapter {
    fn new(state: FakeAdapterState) -> Self {
        Self {
            breakpoint_response: Ok(Vec::new()),
            state,
        }
    }

    fn with_breakpoint_response(
        state: FakeAdapterState,
        response: Result<Vec<DebugBreakpoint>, String>,
    ) -> Self {
        Self {
            breakpoint_response: response,
            state,
        }
    }
}

impl DebugAdapter for FakeAdapter {
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        self.state
            .record(format!("set_breakpoints:{file_path}:{}", breakpoints.len()));
        self.breakpoint_response.clone()
    }

    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        self.state.record(format!("step:{kind:?}"));
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        self.state.record("pause".to_string());
        Ok(())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        self.state.record("stack_trace".to_string());
        Ok(Vec::new())
    }

    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        self.state.record(format!("scopes:{frame_id}"));
        Ok(Vec::new())
    }

    fn variables(&mut self, reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
        self.state.record(format!("variables:{reference}"));
        Ok(Vec::new())
    }

    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        self.state
            .record(format!("evaluate:{frame_id}:{expression}"));
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: "42".to_string(),
            value_type: Some("number".to_string()),
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn terminate(&mut self) {
        self.state.record("terminate".to_string());
        self.state.terminated.store(true, Ordering::SeqCst);
    }
}

#[test]
fn default_adapter_policy_explicitly_rejects_clipboard_evaluation() {
    let state = FakeAdapterState::default();
    let mut adapter = FakeAdapter::new(state.clone());
    let failure = adapter
        .evaluate_with_policy(
            7,
            "value",
            DebugEvaluatePolicy {
                context: DebugEvaluateContext::Clipboard,
                allow_side_effects: true,
            },
        )
        .expect_err("default clipboard policy must fail closed");
    assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
    assert!(failure.message.contains("Clipboard"));
    assert!(state.calls().is_empty());
}

struct BlockingBreakpointAdapter {
    entered: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
    state: FakeAdapterState,
}

struct BlockingEvaluationAdapter {
    calls: Arc<AtomicUsize>,
    entered: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
}

impl DebugAdapter for BlockingEvaluationAdapter {
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

    fn variables(&mut self, _reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
        Ok(Vec::new())
    }

    fn current_pause_generation(&self) -> Option<u64> {
        Some(1)
    }

    fn variables_page(
        &mut self,
        request: DebugVariablePageRequest,
    ) -> Result<DebugVariablePage, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.send(()).expect("announce variable I/O");
        self.release.recv().expect("release variable I/O");
        Ok(DebugVariablePage {
            variables: Vec::new(),
            start: request.start,
            returned: 0,
            total: Some(0),
            next_start: None,
            truncated: false,
        })
    }

    fn evaluate(&mut self, _frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.send(()).expect("announce evaluation I/O");
        self.release.recv().expect("release evaluation I/O");
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: "late".to_string(),
            value_type: Some("string".to_string()),
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn terminate(&mut self) {}
}

impl DebugAdapter for BlockingBreakpointAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        self.entered.send(()).expect("announce breakpoint I/O");
        self.release.recv().expect("release breakpoint I/O");
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

    fn variables(&mut self, _reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
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
        self.state.terminated.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct CollectingSink {
    events: Mutex<Vec<DebugEvent>>,
}

impl CollectingSink {
    fn events(&self) -> Vec<DebugEvent> {
        self.events.lock().expect("events").clone()
    }
}

impl DebugEventSink for CollectingSink {
    fn emit(&self, event: DebugEvent) {
        self.events.lock().expect("events").push(event);
    }
}

fn start_fake_session(
    registry: &DebugSessionRegistry,
    root_key: &str,
    sink: Arc<CollectingSink>,
) -> (u64, FakeAdapterState) {
    let state = FakeAdapterState::default();
    let adapter_state = state.clone();
    let session_id = registry
        .start_session(root_key, sink, move |_emitter| {
            Ok(Box::new(FakeAdapter::new(adapter_state)))
        })
        .expect("start session");
    (session_id, state)
}

fn terminated_events(sink: &CollectingSink) -> Vec<DebugEvent> {
    sink.events()
        .into_iter()
        .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
        .collect()
}

fn breakpoint(file_path: &str, id: &str, line_number: u32) -> DebugBreakpoint {
    DebugBreakpoint {
        id: id.to_string(),
        file_path: file_path.to_string(),
        line_number,
        column_number: None,
        condition: None,
        hit_condition: None,
        log_message: None,
        enabled: true,
        verified: false,
    }
}

fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
    let deadline = Instant::now() + timeout;
    while !predicate() {
        assert!(Instant::now() < deadline, "condition timed out");
        thread::yield_now();
    }
}

fn start_group_member(
    registry: &DebugSessionRegistry,
    permit: DebugStartupPermit,
    sink: Arc<CollectingSink>,
) -> (u64, FakeAdapterState) {
    let state = FakeAdapterState::default();
    let adapter_state = state.clone();
    let session_id = registry
        .start_session_with_permit(permit, sink, move |_emitter| {
            Ok(Box::new(FakeAdapter::new(adapter_state)))
        })
        .expect("start grouped session");
    (session_id, state)
}

#[path = "debug_adapter_registry_lifecycle_tests.rs"]
mod lifecycle_tests;

#[path = "debug_adapter_registry_compound_tests.rs"]
mod compound_tests;

#[path = "debug_adapter_registry_session_tests.rs"]
mod session_tests;

#[path = "debug_adapter_registry_wire_tests.rs"]
mod wire_tests;
