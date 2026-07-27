use super::*;
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventSink, DebugExceptionPauseMode,
    DebugFunctionBreakpoint, DebugFunctionBreakpointVerification, DebugJustMyCodePolicy,
    DebugScopeInfo, DebugStackFrame, DebugVariableInfo, StepKind,
};
use crate::debug_exception_type_filter::DebugExceptionTypeFilter;
use crate::debug_session_registry::DebugSessionRegistry;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct DiscardingSink;

impl DebugEventSink for DiscardingSink {
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

#[derive(Default)]
struct RecordingProtocol {
    function_generations: Vec<u64>,
    last_function_generation: Option<u64>,
}

impl WatchCdpProtocol for RecordingProtocol {
    fn enable_runtime(&mut self) -> Result<(), ()> {
        Ok(())
    }

    fn enable_debugger(&mut self) -> Result<(), ()> {
        Ok(())
    }

    fn apply_internal_step_filter(
        &mut self,
        _policy: Option<DebugJustMyCodePolicy>,
    ) -> Result<(), ()> {
        Ok(())
    }

    fn set_exception_pause(&mut self, _mode: DebugExceptionPauseMode) -> Result<(), ()> {
        Ok(())
    }

    fn set_breakpoints_active(&mut self, _active: bool) -> Result<(), ()> {
        Ok(())
    }

    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        _breakpoints: &[DebugBreakpoint],
    ) -> Result<(), ()> {
        Ok(())
    }

    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[DebugFunctionBreakpoint],
        generation: u64,
        publish: &mut dyn FnMut(
            u64,
            Vec<DebugFunctionBreakpointVerification>,
        ) -> Result<(), String>,
    ) -> Result<(), ()> {
        if self
            .last_function_generation
            .is_some_and(|installed| generation <= installed)
        {
            return Err(());
        }
        self.last_function_generation = Some(generation);
        self.function_generations.push(generation);
        publish(
            generation,
            breakpoints
                .iter()
                .map(|breakpoint| DebugFunctionBreakpointVerification {
                    id: breakpoint.id.clone(),
                    verified: true,
                })
                .collect(),
        )
        .map_err(|_| ())
    }
}

fn gate_fixture(root: &str) -> (DebugSessionRegistry, WatchDebugEventGate) {
    let registry = DebugSessionRegistry::new();
    registry.activate_root(root);
    let captured = Arc::new(Mutex::new(None));
    let capture = Arc::clone(&captured);
    registry
        .start_session(root, Arc::new(DiscardingSink), move |emitter| {
            *capture.lock().unwrap_or_else(|error| error.into_inner()) = Some(emitter);
            Ok(Box::new(InertAdapter))
        })
        .expect("debug session");
    let emitter = captured
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
        .expect("captured emitter");
    (registry, WatchDebugEventGate::new(emitter))
}

fn plan(
    revision: u64,
    function_generation: u64,
    id: &str,
    exception_mode: DebugExceptionPauseMode,
) -> DesiredDebuggerReplayPlan {
    DesiredDebuggerReplayPlan::from_steps_for_test(
        revision,
        vec![
            DesiredDebuggerReplayStep::EnableRuntime,
            DesiredDebuggerReplayStep::EnableDebugger,
            DesiredDebuggerReplayStep::ApplyInternalStepFilter(None),
            DesiredDebuggerReplayStep::SetExceptionPause {
                mode: exception_mode,
                exception_type_filter: DebugExceptionTypeFilter::default(),
            },
            DesiredDebuggerReplayStep::SetBreakpointsActive(true),
            DesiredDebuggerReplayStep::SetFunctionBreakpoints {
                breakpoints: vec![DebugFunctionBreakpoint {
                    id: id.to_string(),
                    function_name: "target".to_string(),
                    enabled: true,
                }],
                generation: function_generation,
            },
            DesiredDebuggerReplayStep::RunIfWaitingForDebugger,
        ],
    )
}

fn verification(id: &str) -> Vec<DebugFunctionBreakpointVerification> {
    vec![DebugFunctionBreakpointVerification {
        id: id.to_string(),
        verified: true,
    }]
}

#[test]
fn non_function_drift_reuses_only_the_exact_existing_receipt_authority() {
    let (_registry, gate) = gate_fixture("/workspace/non-function-drift");
    let lease = gate.prepare_initial().expect("initial lease");
    let old_ids = vec!["same".to_string()];
    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        7,
        1,
        &old_ids,
        verification("same"),
    ));
    let replayed = plan(7, 1, "same", DebugExceptionPauseMode::None);
    let current = plan(8, 1, "same", DebugExceptionPauseMode::All);
    let mut protocol = RecordingProtocol {
        last_function_generation: Some(1),
        ..RecordingProtocol::default()
    };

    let authority = reconcile_replayed_plan(
        &mut protocol,
        &gate,
        &lease,
        TargetGeneration::from_value_for_test(1),
        &replayed,
        &current,
        || true,
    )
    .expect("reconciled")
    .expect("startup receipt authority");

    assert_eq!(authority, (7, 1, old_ids.clone()));
    assert!(
        protocol.function_generations.is_empty(),
        "non-function drift must preserve the already-installed generation"
    );
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 8, 1, &old_ids)
        .is_none());
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 7, 1, &old_ids)
        .is_some());
}

#[test]
fn function_drift_atomically_replaces_receipt_with_current_full_verification() {
    let (_registry, gate) = gate_fixture("/workspace/function-drift");
    let lease = gate.prepare_initial().expect("initial lease");
    let old_ids = vec!["old".to_string()];
    let current_ids = vec!["current".to_string()];
    assert!(gate.retain_startup_function_breakpoint_receipt(
        &lease,
        1,
        11,
        1,
        &old_ids,
        verification("old"),
    ));
    let replayed = plan(11, 1, "old", DebugExceptionPauseMode::None);
    let current = plan(12, 2, "current", DebugExceptionPauseMode::None);
    let mut protocol = RecordingProtocol {
        last_function_generation: Some(1),
        ..RecordingProtocol::default()
    };

    let authority = reconcile_replayed_plan(
        &mut protocol,
        &gate,
        &lease,
        TargetGeneration::from_value_for_test(1),
        &replayed,
        &current,
        || true,
    )
    .expect("reconciled")
    .expect("startup receipt authority");

    assert_eq!(authority, (12, 2, current_ids.clone()));
    assert_eq!(protocol.function_generations, [2]);
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 11, 1, &old_ids)
        .is_none());
    assert!(gate
        .begin_publish_with_startup_function_breakpoint_receipt(&lease, 1, 12, 2, &current_ids,)
        .is_some());
}

#[test]
fn replacement_target_non_function_drift_preserves_installed_function_generation() {
    let (_registry, gate) = gate_fixture("/workspace/replacement-non-function-drift");
    let lease = gate.prepare_initial().expect("test lease");
    let replayed = plan(21, 1, "same", DebugExceptionPauseMode::None);
    let current = plan(22, 1, "same", DebugExceptionPauseMode::All);
    let mut protocol = RecordingProtocol {
        last_function_generation: Some(1),
        ..RecordingProtocol::default()
    };

    assert_eq!(
        reconcile_replayed_plan(
            &mut protocol,
            &gate,
            &lease,
            TargetGeneration::from_value_for_test(2),
            &replayed,
            &current,
            || true,
        ),
        Ok(None)
    );
    assert!(protocol.function_generations.is_empty());
}

#[test]
fn replacement_target_function_drift_applies_only_the_newer_generation() {
    let (_registry, gate) = gate_fixture("/workspace/replacement-function-drift");
    let lease = gate.prepare_initial().expect("test lease");
    let replayed = plan(31, 1, "old", DebugExceptionPauseMode::None);
    let current = plan(32, 2, "current", DebugExceptionPauseMode::None);
    let mut protocol = RecordingProtocol {
        last_function_generation: Some(1),
        ..RecordingProtocol::default()
    };

    assert_eq!(
        reconcile_replayed_plan(
            &mut protocol,
            &gate,
            &lease,
            TargetGeneration::from_value_for_test(2),
            &replayed,
            &current,
            || true,
        ),
        Ok(None)
    );
    assert_eq!(protocol.function_generations, [2]);
}
