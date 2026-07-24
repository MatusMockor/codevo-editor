use super::*;
use crate::debug_adapter::{
    DebugFunctionBreakpoint, DebugFunctionBreakpointVerification, DebugSetExpressionResult,
    DebugSetVariableRequest, DebugSetVariableResult, DebugVariableInfo, DebugVariablePage,
    DebugVariablePageRequest,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Barrier};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct RecordingPort {
    calls: Mutex<Vec<WatchDebugControlCommand>>,
    reject: AtomicBool,
}

impl WatchDebugControlPort for RecordingPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        lock_recover(&self.calls).push(command.clone());
        if self.reject.load(Ordering::Acquire) {
            Err(WatchDebugCommandFailure::TargetRejected)
        } else {
            Ok(response_for(command))
        }
    }
}

fn response_for(command: WatchDebugControlCommand) -> WatchDebugControlResponse {
    match command {
        WatchDebugControlCommand::Pause
        | WatchDebugControlCommand::Step(_)
        | WatchDebugControlCommand::RunIfWaitingForDebugger
        | WatchDebugControlCommand::SetBreakpointsActive(_)
        | WatchDebugControlCommand::SetExceptionPause(_) => WatchDebugControlResponse::Ack,
        WatchDebugControlCommand::CurrentPauseEpoch => WatchDebugControlResponse::PauseEpoch(73),
        WatchDebugControlCommand::StackTrace(request) => WatchDebugControlResponse::StackTrace(
            WatchStackTraceResult::new(request.expected_pause_epoch(), Vec::new())
                .expect("stack response"),
        ),
        WatchDebugControlCommand::Scopes(request) => WatchDebugControlResponse::Scopes(
            WatchScopesResult::new(
                request.expected_pause_epoch(),
                request.frame_id(),
                Vec::new(),
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
        WatchDebugControlCommand::SetVariable(request) => WatchDebugControlResponse::VariableSet(
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
        ),
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
    }
}

#[test]
fn function_breakpoint_response_matching_is_closed_and_ordered() {
    let request = WatchSetFunctionBreakpointsRequest::new(vec![
        DebugFunctionBreakpoint {
            id: "fn-one".to_string(),
            function_name: "app.one".to_string(),
            enabled: true,
        },
        DebugFunctionBreakpoint {
            id: "fn-two".to_string(),
            function_name: "app.two".to_string(),
            enabled: false,
        },
    ]);
    let command = WatchDebugControlCommand::SetFunctionBreakpoints(request);
    let matching = WatchDebugControlResponse::FunctionBreakpointsVerified(vec![
        DebugFunctionBreakpointVerification {
            id: "fn-one".to_string(),
            verified: true,
        },
        DebugFunctionBreakpointVerification {
            id: "fn-two".to_string(),
            verified: false,
        },
    ]);
    let reordered = WatchDebugControlResponse::FunctionBreakpointsVerified(vec![
        DebugFunctionBreakpointVerification {
            id: "fn-two".to_string(),
            verified: false,
        },
        DebugFunctionBreakpointVerification {
            id: "fn-one".to_string(),
            verified: true,
        },
    ]);

    assert!(matching.matches(&command));
    assert!(!reordered.matches(&command));
    assert!(!WatchDebugControlResponse::Ack.matches(&command));
}

fn generation(value: u64) -> TargetGeneration {
    TargetGeneration::from_value_for_test(value)
}

#[test]
fn no_active_target_fails_closed_without_dispatch() {
    let proxy = WatchDebugControlProxy::new();
    assert_eq!(
        proxy.execute(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
}

#[test]
fn install_routes_only_to_current_generation_and_rejects_reuse() {
    let proxy = WatchDebugControlProxy::new();
    let first = Arc::new(RecordingPort::default());
    let first_lease = proxy
        .install(generation(1), first.clone())
        .expect("install first");
    proxy
        .execute(WatchDebugControlCommand::Step(StepKind::Continue))
        .expect("first command");

    let second = Arc::new(RecordingPort::default());
    let second_lease = proxy
        .install(generation(2), second.clone())
        .expect("install replacement");
    assert!(!proxy.is_current(&first_lease));
    assert!(proxy.is_current(&second_lease));
    assert!(matches!(
        proxy.install(generation(2), Arc::new(RecordingPort::default())),
        Err(WatchDebugControlInstallFailure::StaleGeneration)
    ));
    proxy
        .execute(WatchDebugControlCommand::Pause)
        .expect("replacement command");

    assert_eq!(
        lock_recover(&first.calls).as_slice(),
        &[WatchDebugControlCommand::Step(StepKind::Continue)]
    );
    assert_eq!(
        lock_recover(&second.calls).as_slice(),
        &[WatchDebugControlCommand::Pause]
    );
}

#[test]
fn prepared_target_is_invisible_and_does_not_revoke_current() {
    let proxy = WatchDebugControlProxy::new();
    let current_port = Arc::new(RecordingPort::default());
    let current = proxy
        .install(generation(1), current_port.clone())
        .expect("current");
    let pending_port = Arc::new(RecordingPort::default());
    let pending = proxy
        .prepare_install(generation(2), pending_port.clone())
        .expect("prepare replacement");

    assert!(proxy.is_current(&current));
    proxy.pause().expect("old target remains visible");
    assert_eq!(lock_recover(&current_port.calls).len(), 1);
    assert!(lock_recover(&pending_port.calls).is_empty());

    let replacement = proxy.activate_exact(&pending).expect("activate exact");
    assert!(!proxy.is_current(&current));
    assert!(proxy.is_current(&replacement));
    proxy
        .execute(WatchDebugControlCommand::RunIfWaitingForDebugger)
        .expect("closed startup command");
    assert_eq!(
        lock_recover(&pending_port.calls).as_slice(),
        &[WatchDebugControlCommand::RunIfWaitingForDebugger]
    );
}

#[test]
fn failed_before_visible_barrier_preserves_old_target_and_aborts_pending() {
    let proxy = WatchDebugControlProxy::new();
    let old_port = Arc::new(RecordingPort::default());
    let old = proxy
        .install(generation(1), old_port.clone())
        .expect("old target");
    let new_port = Arc::new(RecordingPort::default());
    let pending = proxy
        .prepare_install(generation(2), new_port.clone())
        .expect("pending");

    assert!(matches!(
        proxy.activate_exact_with(&pending, || Err("publish rejected")),
        Err(WatchDebugControlActivationFailure::BeforeVisible(
            "publish rejected"
        ))
    ));
    assert!(proxy.is_current(&old));
    proxy.pause().expect("old target survives failed barrier");
    assert!(lock_recover(&new_port.calls).is_empty());

    assert!(matches!(
        proxy.activate_exact_with(&pending, || Ok::<(), &str>(())),
        Err(WatchDebugControlActivationFailure::Install(
            WatchDebugControlInstallFailure::InvalidPending
        ))
    ));
    assert!(!proxy.abort_pending(&pending));
    assert!(proxy.is_current(&old));
}

#[test]
fn abort_cannot_win_after_activation_barrier_has_started() {
    let proxy = WatchDebugControlProxy::new();
    let pending = proxy
        .prepare_install(generation(1), Arc::new(RecordingPort::default()))
        .expect("pending");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let activating_proxy = proxy.clone();
    let activating_pending = pending.clone();
    let activation = thread::spawn(move || {
        activating_proxy.activate_exact_with(&activating_pending, || {
            entered_tx.send(()).expect("barrier entered");
            release_rx.recv().expect("release barrier");
            Ok::<(), ()>(())
        })
    });

    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("activation barrier");
    assert!(
        !proxy.abort_pending(&pending),
        "abort must lose once exact activation owns the token"
    );
    release_tx.send(()).expect("release activation");
    let lease = activation
        .join()
        .expect("activation thread")
        .expect("activation wins exactly");
    assert!(proxy.is_current(&lease));
    assert!(!proxy.abort_pending(&pending));
}

#[test]
fn exact_pending_abort_is_idempotent_and_activation_fails_closed() {
    let proxy = WatchDebugControlProxy::new();
    let pending = proxy
        .prepare_install(generation(1), Arc::new(RecordingPort::default()))
        .expect("pending");

    assert!(proxy.abort_pending(&pending));
    assert!(!proxy.abort_pending(&pending));
    assert!(matches!(
        proxy.activate_exact(&pending),
        Err(WatchDebugControlInstallFailure::InvalidPending)
    ));
    assert_eq!(
        proxy.execute(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
}

#[test]
fn foreign_and_replayed_pending_tokens_fail_closed() {
    let owner = WatchDebugControlProxy::new();
    let foreign_proxy = WatchDebugControlProxy::new();
    let pending = owner
        .prepare_install(generation(1), Arc::new(RecordingPort::default()))
        .expect("pending");

    assert!(matches!(
        foreign_proxy.activate_exact(&pending),
        Err(WatchDebugControlInstallFailure::InvalidPending)
    ));
    assert!(!foreign_proxy.abort_pending(&pending));
    let lease = owner
        .activate_exact(&pending)
        .expect("exact owner activates");
    assert!(matches!(
        owner.activate_exact(&pending),
        Err(WatchDebugControlInstallFailure::InvalidPending)
    ));
    assert!(!owner.abort_pending(&pending));
    assert!(owner.is_current(&lease));
}

#[test]
fn two_prepares_from_one_base_allow_only_one_activation() {
    let proxy = WatchDebugControlProxy::new();
    proxy
        .install(generation(1), Arc::new(RecordingPort::default()))
        .expect("base");
    let second = proxy
        .prepare_install(generation(2), Arc::new(RecordingPort::default()))
        .expect("second");
    let third = proxy
        .prepare_install(generation(3), Arc::new(RecordingPort::default()))
        .expect("third");
    let start = Arc::new(Barrier::new(3));

    let second_proxy = proxy.clone();
    let second_start = Arc::clone(&start);
    let second_worker = thread::spawn(move || {
        second_start.wait();
        second_proxy.activate_exact(&second)
    });
    let third_proxy = proxy.clone();
    let third_start = Arc::clone(&start);
    let third_worker = thread::spawn(move || {
        third_start.wait();
        third_proxy.activate_exact(&third)
    });
    start.wait();

    let results = [
        second_worker.join().expect("second activation"),
        third_worker.join().expect("third activation"),
    ];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| {
                matches!(
                    result,
                    Err(WatchDebugControlInstallFailure::StaleGeneration)
                )
            })
            .count(),
        1
    );
}

#[test]
fn pending_debug_is_redacted() {
    let proxy = WatchDebugControlProxy::new();
    let pending = proxy
        .prepare_install(generation(9), Arc::new(RecordingPort::default()))
        .expect("pending");
    let diagnostic = format!("{pending:?}");

    assert!(diagnostic.contains("generation"));
    assert!(!diagnostic.contains("authority"));
    assert!(!diagnostic.contains("port"));
    assert!(!diagnostic.contains("0x"));
}

#[test]
fn stale_and_foreign_opaque_leases_cannot_revoke_current_target() {
    let proxy = WatchDebugControlProxy::new();
    let first = proxy
        .install(generation(1), Arc::new(RecordingPort::default()))
        .expect("first");
    let current_port = Arc::new(RecordingPort::default());
    let current = proxy
        .install(generation(2), current_port.clone())
        .expect("current");
    let foreign = WatchDebugControlLease {
        authority: Arc::new(ControlAuthority {
            current: AtomicBool::new(true),
        }),
        generation: generation(2),
    };

    assert!(!proxy.revoke(&first));
    assert!(!proxy.revoke(&foreign));
    assert!(proxy.is_current(&current));
    proxy
        .execute(WatchDebugControlCommand::Pause)
        .expect("still current");
    assert_eq!(lock_recover(&current_port.calls).len(), 1);
}

#[test]
fn exact_revoke_is_idempotent_and_commands_fail_closed_afterward() {
    let proxy = WatchDebugControlProxy::new();
    let lease = proxy
        .install(generation(7), Arc::new(RecordingPort::default()))
        .expect("install");

    assert!(proxy.revoke(&lease));
    assert!(!proxy.revoke(&lease));
    assert!(!proxy.is_current(&lease));
    assert_eq!(
        proxy.execute(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
}

struct ReentrantPort {
    proxy: WatchDebugControlProxy,
    lease: Mutex<Option<WatchDebugControlLease>>,
    returned: mpsc::SyncSender<bool>,
}

impl WatchDebugControlPort for ReentrantPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        let lease = lock_recover(&self.lease).take().expect("lease");
        self.returned
            .send(self.proxy.revoke(&lease))
            .expect("report revoke");
        Ok(response_for(command))
    }
}

#[test]
fn reentrant_target_callback_can_revoke_without_proxy_deadlock() {
    let proxy = WatchDebugControlProxy::new();
    let (returned_tx, returned_rx) = mpsc::sync_channel(1);
    let port = Arc::new(ReentrantPort {
        proxy: proxy.clone(),
        lease: Mutex::new(None),
        returned: returned_tx,
    });
    let lease = proxy
        .install(generation(1), port.clone())
        .expect("install reentrant");
    *lock_recover(&port.lease) = Some(lease);

    let worker_proxy = proxy.clone();
    let worker = thread::spawn(move || worker_proxy.execute(WatchDebugControlCommand::Pause));
    assert_eq!(
        returned_rx.recv_timeout(Duration::from_secs(1)),
        Ok(true),
        "callback must not block on proxy state"
    );
    assert_eq!(
        worker.join().expect("join command"),
        Err(WatchDebugControlFailure::Revoked)
    );
    assert_eq!(
        proxy.execute(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
}

struct BlockingPort {
    entered: Arc<Barrier>,
    release: Arc<Barrier>,
    calls: AtomicUsize,
}

impl WatchDebugControlPort for BlockingPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.wait();
        self.release.wait();
        Ok(response_for(command))
    }
}

#[test]
fn swap_discards_an_in_flight_response_from_the_old_target() {
    let proxy = WatchDebugControlProxy::new();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let old = Arc::new(BlockingPort {
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
        calls: AtomicUsize::new(0),
    });
    proxy
        .install(generation(1), old.clone())
        .expect("old target");

    let command_proxy = proxy.clone();
    let in_flight = thread::spawn(move || {
        command_proxy.execute(WatchDebugControlCommand::Variables(
            WatchVariablesRequest::new(DebugVariablePageRequest {
                pause_generation: 7,
                frame_id: 1,
                variables_reference: 2,
                start: 0,
                count: 10,
            })
            .expect("variables request"),
        ))
    });
    entered.wait();

    let current = Arc::new(RecordingPort::default());
    proxy
        .install(generation(2), current.clone())
        .expect("swap target");
    proxy
        .execute(WatchDebugControlCommand::Step(StepKind::StepOver))
        .expect("new command");
    release.wait();
    assert_eq!(
        in_flight.join().expect("join old command"),
        Err(WatchDebugControlFailure::Revoked)
    );

    assert_eq!(old.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        lock_recover(&current.calls).as_slice(),
        &[WatchDebugControlCommand::Step(StepKind::StepOver)]
    );
}

#[test]
fn replacement_during_variable_mutation_discards_the_old_generation_result() {
    let proxy = WatchDebugControlProxy::new();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    proxy
        .install(
            generation(1),
            Arc::new(BlockingPort {
                entered: Arc::clone(&entered),
                release: Arc::clone(&release),
                calls: AtomicUsize::new(0),
            }),
        )
        .expect("old target");

    let command_proxy = proxy.clone();
    let worker = thread::spawn(move || {
        command_proxy.set_variable(DebugSetVariableRequest {
            pause_generation: 7,
            frame_id: 1,
            variables_reference: 2,
            name: "value".to_string(),
            value: "42".to_string(),
        })
    });
    entered.wait();
    proxy
        .install(generation(2), Arc::new(RecordingPort::default()))
        .expect("replacement");
    release.wait();

    assert_eq!(
        worker.join().expect("mutation thread"),
        Err(WatchDebugControlFailure::Revoked)
    );
}

#[test]
fn selection_before_swap_is_rejected_when_install_wins_before_admission() {
    let proxy = WatchDebugControlProxy::new();
    let old = Arc::new(RecordingPort::default());
    proxy
        .install(generation(1), old.clone())
        .expect("old target");
    let selected = proxy.select_current().expect("select old target");

    proxy
        .install(generation(2), Arc::new(RecordingPort::default()))
        .expect("swap before admission");
    assert_eq!(
        selected.dispatch(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::Revoked)
    );
    assert!(lock_recover(&old.calls).is_empty());
}

#[test]
fn target_failure_is_closed_and_does_not_revoke_exact_owner() {
    let proxy = WatchDebugControlProxy::new();
    let port = Arc::new(RecordingPort::default());
    port.reject.store(true, Ordering::Release);
    let lease = proxy.install(generation(1), port).expect("install target");

    assert_eq!(
        proxy.execute(WatchDebugControlCommand::Pause),
        Err(WatchDebugControlFailure::TargetRejected)
    );
    assert!(proxy.is_current(&lease));
}

struct FixedPort(Result<WatchDebugControlResponse, WatchDebugCommandFailure>);

impl WatchDebugControlPort for FixedPort {
    fn execute(
        &self,
        _command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.0.clone()
    }
}

struct MutationFailurePort {
    failure: WatchDebugCommandFailure,
    mutation_reached_target: AtomicBool,
    revoked: AtomicBool,
}

impl MutationFailurePort {
    fn new(failure: WatchDebugCommandFailure) -> Self {
        Self {
            failure,
            mutation_reached_target: AtomicBool::new(false),
            revoked: AtomicBool::new(false),
        }
    }
}

impl WatchDebugControlPort for MutationFailurePort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        assert!(matches!(command, WatchDebugControlCommand::SetVariable(_)));
        if self.failure != WatchDebugCommandFailure::QueueFull {
            self.mutation_reached_target.store(true, Ordering::Release);
        }
        Err(self.failure)
    }

    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }
}

fn set_variable_request() -> DebugSetVariableRequest {
    DebugSetVariableRequest {
        pause_generation: 7,
        frame_id: 1,
        variables_reference: 2,
        name: "value".to_string(),
        value: "42".to_string(),
    }
}

#[test]
fn stale_after_mutation_io_revokes_exact_generation_and_requires_fresh_replacement() {
    let proxy = WatchDebugControlProxy::new();
    let port = Arc::new(MutationFailurePort::new(
        WatchDebugCommandFailure::StalePauseEpoch,
    ));
    let lease = proxy
        .install(generation(1), port.clone())
        .expect("uncertain target");

    assert_eq!(
        proxy.set_variable(set_variable_request()),
        Err(WatchDebugControlFailure::StalePauseEpoch)
    );
    assert!(port.mutation_reached_target.load(Ordering::Acquire));
    assert!(port.revoked.load(Ordering::Acquire));
    assert!(!proxy.is_current(&lease));
    assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));

    let replacement = proxy
        .install(generation(2), Arc::new(RecordingPort::default()))
        .expect("fresh replacement");
    assert!(proxy.is_current(&replacement));
    assert_eq!(proxy.pause(), Ok(()));
}

#[test]
fn worker_produced_mutation_mismatch_revokes_exact_generation() {
    let proxy = WatchDebugControlProxy::new();
    let port = Arc::new(MutationFailurePort::new(
        WatchDebugCommandFailure::ResponseMismatch,
    ));
    let lease = proxy
        .install(generation(1), port.clone())
        .expect("mismatching worker target");

    assert_eq!(
        proxy.set_variable(set_variable_request()),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );
    assert!(port.mutation_reached_target.load(Ordering::Acquire));
    assert!(port.revoked.load(Ordering::Acquire));
    assert!(!proxy.is_current(&lease));
    assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
}

#[test]
fn uncertain_mutation_transport_failures_revoke_exact_generation() {
    for (index, failure) in [
        WatchDebugCommandFailure::ResponseTimeout,
        WatchDebugCommandFailure::TargetRejected,
        WatchDebugCommandFailure::WorkerStopped,
    ]
    .into_iter()
    .enumerate()
    {
        let proxy = WatchDebugControlProxy::new();
        let port = Arc::new(MutationFailurePort::new(failure));
        let lease = proxy
            .install(generation(index as u64 + 1), port.clone())
            .expect("uncertain target");

        assert!(proxy.set_variable(set_variable_request()).is_err());
        assert!(port.mutation_reached_target.load(Ordering::Acquire));
        assert!(port.revoked.load(Ordering::Acquire));
        assert!(!proxy.is_current(&lease));
        assert_eq!(proxy.pause(), Err(WatchDebugControlFailure::NoActiveTarget));
    }
}

#[test]
fn queue_rejection_before_mutation_dispatch_keeps_exact_generation_current() {
    let proxy = WatchDebugControlProxy::new();
    let port = Arc::new(MutationFailurePort::new(
        WatchDebugCommandFailure::QueueFull,
    ));
    let lease = proxy
        .install(generation(1), port.clone())
        .expect("busy target");

    assert_eq!(
        proxy.set_variable(set_variable_request()),
        Err(WatchDebugControlFailure::QueueFull)
    );
    assert!(!port.mutation_reached_target.load(Ordering::Acquire));
    assert!(!port.revoked.load(Ordering::Acquire));
    assert!(proxy.is_current(&lease));
}

#[test]
fn typed_helpers_preserve_pause_epoch_and_reject_response_mismatch() {
    let proxy = WatchDebugControlProxy::new();
    proxy
        .install(generation(1), Arc::new(RecordingPort::default()))
        .expect("typed target");
    assert_eq!(proxy.pause(), Ok(()));
    assert_eq!(proxy.step(StepKind::StepInto), Ok(()));
    assert_eq!(proxy.current_pause_epoch(), Ok(73));
    assert_eq!(
        proxy.stack_trace(73),
        Ok(WatchStackTraceResult::new(73, Vec::new()).expect("stack result"))
    );
    assert_eq!(
        proxy.scopes(73, 9),
        Ok(WatchScopesResult::new(73, 9, Vec::new()).expect("scopes result"))
    );
    assert_eq!(
        proxy.stack_trace(0),
        Err(WatchDebugControlFailure::TargetRejected)
    );
    assert_eq!(
        proxy.scopes(73, 0),
        Err(WatchDebugControlFailure::TargetRejected)
    );

    let mismatch = WatchDebugControlProxy::new();
    mismatch
        .install(
            generation(1),
            Arc::new(FixedPort(Ok(WatchDebugControlResponse::PauseEpoch(7)))),
        )
        .expect("mismatch target");
    assert_eq!(
        mismatch.pause(),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );
    assert_eq!(
        mismatch.stack_trace(7),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );

    let mutation_mismatch = WatchDebugControlProxy::new();
    let mutation_mismatch_lease = mutation_mismatch
        .install(
            generation(1),
            Arc::new(FixedPort(Ok(WatchDebugControlResponse::Ack))),
        )
        .expect("mutation mismatch target");
    assert_eq!(
        mutation_mismatch.set_variable(set_variable_request()),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );
    assert!(!mutation_mismatch.is_current(&mutation_mismatch_lease));
    assert_eq!(
        mutation_mismatch.pause(),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );

    let stale_payload = WatchDebugControlProxy::new();
    stale_payload
        .install(
            generation(1),
            Arc::new(FixedPort(Ok(WatchDebugControlResponse::StackTrace(
                WatchStackTraceResult::new(8, Vec::new()).expect("stale stack"),
            )))),
        )
        .expect("stale payload target");
    assert_eq!(
        stale_payload.stack_trace(7),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );

    let wrong_frame = WatchDebugControlProxy::new();
    wrong_frame
        .install(
            generation(1),
            Arc::new(FixedPort(Ok(WatchDebugControlResponse::Scopes(
                WatchScopesResult::new(7, 10, Vec::new()).expect("wrong-frame scopes"),
            )))),
        )
        .expect("wrong-frame target");
    assert_eq!(
        wrong_frame.scopes(7, 9),
        Err(WatchDebugControlFailure::ResponseMismatch)
    );
}

#[test]
fn structured_port_failures_are_preserved_by_closed_proxy_mapping() {
    let cases = [
        (
            WatchDebugCommandFailure::QueueFull,
            WatchDebugControlFailure::QueueFull,
        ),
        (
            WatchDebugCommandFailure::ResponseTimeout,
            WatchDebugControlFailure::ResponseTimeout,
        ),
        (
            WatchDebugCommandFailure::Revoked,
            WatchDebugControlFailure::Revoked,
        ),
        (
            WatchDebugCommandFailure::StaleAuthority,
            WatchDebugControlFailure::StaleAuthority,
        ),
        (
            WatchDebugCommandFailure::TargetRejected,
            WatchDebugControlFailure::TargetRejected,
        ),
        (
            WatchDebugCommandFailure::WorkerStopped,
            WatchDebugControlFailure::WorkerStopped,
        ),
        (
            WatchDebugCommandFailure::ResponseMismatch,
            WatchDebugControlFailure::ResponseMismatch,
        ),
        (
            WatchDebugCommandFailure::StalePauseEpoch,
            WatchDebugControlFailure::StalePauseEpoch,
        ),
    ];
    for (index, (command_failure, proxy_failure)) in cases.into_iter().enumerate() {
        let proxy = WatchDebugControlProxy::new();
        proxy
            .install(
                generation(index as u64 + 1),
                Arc::new(FixedPort(Err(command_failure))),
            )
            .expect("failure target");
        assert_eq!(
            proxy.execute(WatchDebugControlCommand::Pause),
            Err(proxy_failure)
        );
    }
}
