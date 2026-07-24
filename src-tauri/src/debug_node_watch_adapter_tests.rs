use super::*;
use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluatePolicy, DebugFunctionBreakpointVerification, DebugScopeInfo,
    DebugSetExpressionResult, DebugSetVariableResult, DebugStackFrame, DebugVariableInfo,
    DebugVariablePage, DebugVariablePageRequest,
};
use crate::debug_node_process::watch_control_proxy::{
    WatchDebugCommandFailure, WatchDebugControlCommand, WatchDebugControlPort,
    WatchDebugControlResponse,
};
use crate::debug_node_process::watch_generation::TargetGeneration;
use crate::debug_node_process::watch_inspection_contract::{
    WatchEvaluateResult, WatchSetExpressionResult, WatchSetVariableResult, WatchVariablesResult,
};
use std::sync::{Arc, Mutex};

struct RecordingPort {
    commands: Mutex<Vec<WatchDebugControlCommand>>,
    outcome: Mutex<Result<u64, WatchDebugCommandFailure>>,
}

impl RecordingPort {
    fn accepting(pause_epoch: u64) -> Self {
        Self {
            commands: Mutex::new(Vec::new()),
            outcome: Mutex::new(Ok(pause_epoch)),
        }
    }

    fn rejecting(failure: WatchDebugCommandFailure) -> Self {
        Self {
            commands: Mutex::new(Vec::new()),
            outcome: Mutex::new(Err(failure)),
        }
    }
}

impl WatchDebugControlPort for RecordingPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.commands
            .lock()
            .expect("commands")
            .push(command.clone());
        let pause_epoch = *self.outcome.lock().expect("outcome");
        pause_epoch.map(|epoch| match command {
            WatchDebugControlCommand::CurrentPauseEpoch => {
                WatchDebugControlResponse::PauseEpoch(epoch)
            }
            WatchDebugControlCommand::Pause
            | WatchDebugControlCommand::Step(_)
            | WatchDebugControlCommand::RunIfWaitingForDebugger
            | WatchDebugControlCommand::SetBreakpointsActive(_)
            | WatchDebugControlCommand::SetExceptionPause(_) => WatchDebugControlResponse::Ack,
            WatchDebugControlCommand::StackTrace(request) => WatchDebugControlResponse::StackTrace(
                WatchStackTraceResult::new(
                    request.expected_pause_epoch(),
                    vec![DebugStackFrame {
                        frame_id: 9,
                        name: "main".to_string(),
                        file_path: Some("/workspace/app.ts".to_string()),
                        line_number: 4,
                        column: 2,
                    }],
                )
                .expect("stack response"),
            ),
            WatchDebugControlCommand::Scopes(request) => WatchDebugControlResponse::Scopes(
                WatchScopesResult::new(
                    request.expected_pause_epoch(),
                    request.frame_id(),
                    vec![DebugScopeInfo {
                        name: "Local".to_string(),
                        variables_reference: 11,
                        expensive: false,
                    }],
                )
                .expect("scopes response"),
            ),
            WatchDebugControlCommand::Variables(request) => WatchDebugControlResponse::Variables(
                WatchVariablesResult::new(
                    request,
                    DebugVariablePage {
                        variables: Vec::new(),
                        start: request.request().start,
                        returned: 0,
                        total: Some(0),
                        next_start: None,
                        truncated: false,
                    },
                )
                .expect("variables response"),
            ),
            WatchDebugControlCommand::Evaluate(request) => WatchDebugControlResponse::Evaluate(
                WatchEvaluateResult::new(
                    &request,
                    Ok(DebugVariableInfo {
                        name: request.expression().to_string(),
                        value: "42".to_string(),
                        value_type: Some("number".to_string()),
                        evaluate_name: Some(request.expression().to_string()),
                        variables_reference: 0,
                        can_set_value: None,
                        set_expression_reference: None,
                    }),
                )
                .expect("evaluate response"),
            ),
            WatchDebugControlCommand::SetVariable(request) => {
                WatchDebugControlResponse::VariableSet(
                    WatchSetVariableResult::new(
                        &request,
                        DebugSetVariableResult {
                            value: DebugVariableInfo {
                                name: request.request().name.clone(),
                                value: "42".to_string(),
                                value_type: Some("number".to_string()),
                                evaluate_name: Some(request.request().name.clone()),
                                variables_reference: 0,
                                can_set_value: Some(true),
                                set_expression_reference: None,
                            },
                        },
                    )
                    .expect("set-variable response"),
                )
            }
            WatchDebugControlCommand::SetExpression(request) => {
                WatchDebugControlResponse::ExpressionSet(
                    WatchSetExpressionResult::new(
                        &request,
                        DebugSetExpressionResult {
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
                        },
                    )
                    .expect("set-expression response"),
                )
            }
            WatchDebugControlCommand::SetBreakpoints(request) => {
                WatchDebugControlResponse::BreakpointsVerified {
                    file_path: request.file_path().to_string(),
                    breakpoints: request.breakpoints().to_vec(),
                }
            }
            WatchDebugControlCommand::SetFunctionBreakpoints(request) => {
                WatchDebugControlResponse::FunctionBreakpointsVerified(
                    request
                        .breakpoints()
                        .iter()
                        .map(|breakpoint| DebugFunctionBreakpointVerification {
                            id: breakpoint.id.clone(),
                            verified: breakpoint.enabled,
                        })
                        .collect(),
                )
            }
        })
    }
}

fn active_adapter(port: Arc<RecordingPort>) -> WatchNodeDebugAdapter {
    let control = WatchDebugControlProxy::new();
    control
        .install(TargetGeneration::from_value_for_test(1), port)
        .expect("active generation");
    WatchNodeDebugAdapter::new(control)
}

#[test]
fn facade_exposes_only_active_session_controls() {
    let port = Arc::new(RecordingPort::accepting(41));
    let adapter = active_adapter(Arc::clone(&port));

    adapter.pause().expect("pause");
    adapter.step(StepKind::StepOver).expect("step");
    assert_eq!(adapter.current_pause_epoch(), Ok(41));
    assert_eq!(
        adapter.stack_trace(41).expect("stack trace").frames()[0].frame_id,
        9
    );
    assert_eq!(
        adapter.scopes(41, 9).expect("scopes").scopes()[0].name,
        "Local"
    );
    let variables_request = DebugVariablePageRequest {
        pause_generation: 41,
        frame_id: 9,
        variables_reference: 11,
        start: 0,
        count: 10,
    };
    assert!(adapter
        .variables_page(variables_request)
        .expect("variables")
        .variables
        .is_empty());
    assert_eq!(
        adapter
            .evaluate(
                41,
                9,
                "value".to_string(),
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
            .expect("control")
            .expect("evaluation")
            .value,
        "42"
    );
    assert_eq!(
        port.commands.lock().expect("commands").as_slice(),
        &[
            WatchDebugControlCommand::Pause,
            WatchDebugControlCommand::Step(StepKind::StepOver),
            WatchDebugControlCommand::CurrentPauseEpoch,
            WatchDebugControlCommand::StackTrace(
                crate::debug_node_process::watch_inspection_contract::WatchStackTraceRequest::new(
                    41
                )
                .expect("stack request")
            ),
            WatchDebugControlCommand::Scopes(
                crate::debug_node_process::watch_inspection_contract::WatchScopesRequest::new(
                    41, 9
                )
                .expect("scopes request")
            ),
            WatchDebugControlCommand::Variables(
                crate::debug_node_process::watch_inspection_contract::WatchVariablesRequest::new(
                    variables_request
                )
                .expect("variables request")
            ),
            WatchDebugControlCommand::Evaluate(
                crate::debug_node_process::watch_inspection_contract::WatchEvaluateRequest::new(
                    41,
                    9,
                    "value".to_string(),
                    DebugEvaluatePolicy {
                        context: DebugEvaluateContext::Watch,
                        allow_side_effects: false,
                    },
                )
                .expect("evaluate request")
            ),
        ]
    );
}

#[test]
fn facade_rejects_invalid_page_and_evaluation_policies_before_dispatch() {
    let port = Arc::new(RecordingPort::accepting(41));
    let adapter = active_adapter(Arc::clone(&port));

    assert_eq!(
        adapter.variables_page(DebugVariablePageRequest {
            pause_generation: 41,
            frame_id: 9,
            variables_reference: 11,
            start: 0,
            count: 101,
        }),
        Err(WatchNodeDebugAdapterFailure::TargetRejected)
    );
    assert_eq!(
        adapter.evaluate(
            41,
            9,
            "mutate()".to_string(),
            DebugEvaluatePolicy {
                context: DebugEvaluateContext::Watch,
                allow_side_effects: true,
            },
        ),
        Err(WatchNodeDebugAdapterFailure::TargetRejected)
    );
    assert!(port.commands.lock().expect("commands").is_empty());
}

#[test]
fn no_active_generation_fails_closed() {
    let adapter = WatchNodeDebugAdapter::new(WatchDebugControlProxy::new());

    assert_eq!(
        adapter.pause(),
        Err(WatchNodeDebugAdapterFailure::NoActiveTarget)
    );
    assert_eq!(
        adapter.current_pause_epoch(),
        Err(WatchNodeDebugAdapterFailure::NoActiveTarget)
    );
}

#[test]
fn facade_preserves_structured_target_failure() {
    let port = Arc::new(RecordingPort::rejecting(
        WatchDebugCommandFailure::TargetRejected,
    ));
    let adapter = active_adapter(port);

    assert_eq!(
        adapter.step(StepKind::StepInto),
        Err(WatchNodeDebugAdapterFailure::TargetRejected)
    );
}

#[test]
fn facade_preserves_stale_pause_epoch_failure() {
    let adapter = active_adapter(Arc::new(RecordingPort::rejecting(
        WatchDebugCommandFailure::StalePauseEpoch,
    )));

    assert_eq!(
        adapter.stack_trace(7),
        Err(WatchNodeDebugAdapterFailure::StalePauseEpoch)
    );
}
