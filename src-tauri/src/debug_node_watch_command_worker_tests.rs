use super::super::watch_inspection_contract::{
    WatchEvaluateResult, WatchScopesRequest, WatchScopesResult, WatchSetExpressionResult,
    WatchSetVariableResult, WatchStackTraceRequest, WatchStackTraceResult, WatchVariablesResult,
};
use super::*;
use crate::debug_adapter::{
    DebugFunctionBreakpointVerification, DebugSetExpressionResult, DebugSetVariableResult,
    DebugVariableInfo, DebugVariablePage, StepKind,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Barrier};

fn policy(capacity: usize, timeout_ms: u64) -> WatchDebugCommandWorkerPolicy {
    WatchDebugCommandWorkerPolicy::new(capacity, Duration::from_millis(timeout_ms))
        .expect("worker policy")
}

fn runtime_response(command: WatchDebugControlCommand) -> WatchDebugControlResponse {
    match command {
        WatchDebugControlCommand::Pause
        | WatchDebugControlCommand::Step(_)
        | WatchDebugControlCommand::RunIfWaitingForDebugger
        | WatchDebugControlCommand::SetBreakpointsActive(_)
        | WatchDebugControlCommand::SetExceptionPause(_) => WatchDebugControlResponse::Ack,
        WatchDebugControlCommand::CurrentPauseEpoch => WatchDebugControlResponse::PauseEpoch(41),
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
                    limit_reason: None,
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

struct RecordingRuntime {
    calls: Arc<Mutex<Vec<WatchDebugControlCommand>>>,
}

impl WatchDebugCommandRuntime for RecordingRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        lock_recover(&self.calls).push(command.clone());
        Ok(runtime_response(command))
    }
}

#[test]
fn policy_bounds_queue_and_response_timeout() {
    assert!(WatchDebugCommandWorkerPolicy::new(1, Duration::from_millis(1)).is_ok());
    assert!(WatchDebugCommandWorkerPolicy::new(0, Duration::from_millis(1)).is_err());
    assert!(WatchDebugCommandWorkerPolicy::new(33, Duration::from_millis(1)).is_err());
    assert!(WatchDebugCommandWorkerPolicy::new(1, Duration::ZERO).is_err());
    assert!(WatchDebugCommandWorkerPolicy::new(1, Duration::from_secs(6)).is_err());
}

#[test]
fn worker_serializes_closed_pause_and_step_commands() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let port = WatchDebugCommandWorkerPort::spawn(
        RecordingRuntime {
            calls: Arc::clone(&calls),
        },
        || true,
        policy(4, 500),
    );

    port.execute_bounded(WatchDebugControlCommand::Pause)
        .expect("pause");
    port.execute_bounded(WatchDebugControlCommand::Step(StepKind::StepOver))
        .expect("step");
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::CurrentPauseEpoch),
        Ok(WatchDebugControlResponse::PauseEpoch(41))
    );
    let stack_request = WatchStackTraceRequest::new(41).expect("stack request");
    assert!(matches!(
        port.execute_bounded(WatchDebugControlCommand::StackTrace(stack_request)),
        Ok(WatchDebugControlResponse::StackTrace(_))
    ));
    let scopes_request = WatchScopesRequest::new(41, 1).expect("scopes request");
    assert!(matches!(
        port.execute_bounded(WatchDebugControlCommand::Scopes(scopes_request)),
        Ok(WatchDebugControlResponse::Scopes(_))
    ));
    port.revoke();

    assert_eq!(
        lock_recover(&calls).as_slice(),
        [
            WatchDebugControlCommand::Pause,
            WatchDebugControlCommand::Step(StepKind::StepOver),
            WatchDebugControlCommand::CurrentPauseEpoch,
            WatchDebugControlCommand::StackTrace(stack_request),
            WatchDebugControlCommand::Scopes(scopes_request),
        ]
    );
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::CurrentPauseEpoch),
        Err(WatchDebugCommandFailure::Revoked)
    );
}

struct MismatchedRuntime;

impl WatchDebugCommandRuntime for MismatchedRuntime {
    fn execute(
        &mut self,
        _command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        Ok(WatchDebugControlResponse::PauseEpoch(99))
    }
}

#[test]
fn worker_rejects_runtime_response_variant_mismatch() {
    let port = WatchDebugCommandWorkerPort::spawn(MismatchedRuntime, || true, policy(1, 100));
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::Pause),
        Err(WatchDebugCommandFailure::ResponseMismatch)
    );
    port.revoke();
}

struct WrongScopeFrameRuntime;

impl WatchDebugCommandRuntime for WrongScopeFrameRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        let WatchDebugControlCommand::Scopes(request) = command else {
            return Ok(runtime_response(command));
        };
        Ok(WatchDebugControlResponse::Scopes(
            WatchScopesResult::new(
                request.expected_pause_epoch(),
                request.frame_id() + 1,
                Vec::new(),
            )
            .expect("wrong-frame scopes"),
        ))
    }
}

#[test]
fn worker_rejects_scopes_from_a_different_frame() {
    let port = WatchDebugCommandWorkerPort::spawn(WrongScopeFrameRuntime, || true, policy(1, 100));
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::Scopes(
            WatchScopesRequest::new(41, 9).expect("scopes request"),
        )),
        Err(WatchDebugCommandFailure::ResponseMismatch)
    );
    port.revoke();
}

struct DeadlineRuntime {
    remaining: mpsc::SyncSender<Duration>,
}

impl WatchDebugCommandRuntime for DeadlineRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.remaining
            .send(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| WatchDebugCommandFailure::TargetRejected)?;
        Ok(runtime_response(command))
    }
}

#[test]
fn runtime_receives_the_exact_short_policy_deadline() {
    let (remaining_tx, remaining_rx) = mpsc::sync_channel(1);
    let port = WatchDebugCommandWorkerPort::spawn(
        DeadlineRuntime {
            remaining: remaining_tx,
        },
        || true,
        policy(1, 40),
    );

    port.execute_bounded(WatchDebugControlCommand::Pause)
        .expect("bounded command");
    let remaining = remaining_rx.recv().expect("deadline observation");
    assert!(remaining > Duration::ZERO);
    assert!(remaining <= Duration::from_millis(40));
    port.revoke();
}

struct BlockingRuntime {
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
    calls: Arc<AtomicUsize>,
}

impl WatchDebugCommandRuntime for BlockingRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let _ = self.entered.send(());
        while Instant::now() < deadline && !revoked.load(Ordering::Acquire) {
            match self.release.recv_timeout(Duration::from_millis(5)) {
                Ok(()) => return Ok(runtime_response(command)),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(WatchDebugCommandFailure::TargetRejected)
                }
            }
        }
        Err(WatchDebugCommandFailure::TargetRejected)
    }
}

struct HoldingRuntime {
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
    calls: Arc<AtomicUsize>,
}

impl WatchDebugCommandRuntime for HoldingRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let _ = self.entered.send(());
        self.release
            .recv()
            .map_err(|_| WatchDebugCommandFailure::TargetRejected)?;
        Ok(runtime_response(command))
    }
}

#[test]
fn bounded_queue_rejects_overflow_without_dispatch() {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let calls = Arc::new(AtomicUsize::new(0));
    let port = WatchDebugCommandWorkerPort::spawn(
        BlockingRuntime {
            entered: entered_tx,
            release: release_rx,
            calls: Arc::clone(&calls),
        },
        || true,
        policy(1, 500),
    );
    let first_port = port.clone();
    let first = thread::spawn(move || first_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("first entered");
    let queued_port = port.clone();
    let queued =
        thread::spawn(move || queued_port.execute_bounded(WatchDebugControlCommand::Pause));
    thread::sleep(Duration::from_millis(20));
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::Pause),
        Err(WatchDebugCommandFailure::QueueFull)
    );
    release_tx.send(()).expect("release first");
    release_tx.send(()).expect("release queued");
    assert_eq!(
        first.join().expect("first"),
        Ok(WatchDebugControlResponse::Ack)
    );
    assert_eq!(
        queued.join().expect("queued"),
        Ok(WatchDebugControlResponse::Ack)
    );
    port.revoke();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn queued_command_revalidates_exact_authority_immediately_before_dispatch() {
    let current = Arc::new(AtomicBool::new(true));
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let calls = Arc::new(AtomicUsize::new(0));
    let authority = Arc::clone(&current);
    let port = WatchDebugCommandWorkerPort::spawn(
        BlockingRuntime {
            entered: entered_tx,
            release: release_rx,
            calls: Arc::clone(&calls),
        },
        move || authority.load(Ordering::Acquire),
        policy(2, 500),
    );
    let first_port = port.clone();
    let first = thread::spawn(move || first_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx.recv().expect("first entered");
    let queued_port = port.clone();
    let queued = thread::spawn(move || {
        queued_port.execute_bounded(WatchDebugControlCommand::Step(StepKind::Continue))
    });
    thread::sleep(Duration::from_millis(20));
    current.store(false, Ordering::Release);
    release_tx.send(()).expect("release first");

    assert_eq!(
        first.join().expect("first"),
        Ok(WatchDebugControlResponse::Ack)
    );
    assert_eq!(
        queued.join().expect("queued"),
        Err(WatchDebugCommandFailure::StaleAuthority)
    );
    port.revoke();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn queued_command_that_expires_is_never_dispatched_late() {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let calls = Arc::new(AtomicUsize::new(0));
    let port = WatchDebugCommandWorkerPort::spawn(
        HoldingRuntime {
            entered: entered_tx,
            release: release_rx,
            calls: Arc::clone(&calls),
        },
        || true,
        policy(2, 40),
    );
    let first_port = port.clone();
    let first = thread::spawn(move || first_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx.recv().expect("first entered");
    let queued_port = port.clone();
    let queued =
        thread::spawn(move || queued_port.execute_bounded(WatchDebugControlCommand::Pause));

    assert_eq!(
        first.join().expect("first"),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );
    assert_eq!(
        queued.join().expect("queued"),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );
    release_tx.send(()).expect("release expired first command");
    let probe_port = port.clone();
    let probe = thread::spawn(move || probe_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("worker skipped expired queued command and entered fresh probe");
    release_tx.send(()).expect("release fresh probe");
    assert_eq!(
        probe.join().expect("probe"),
        Ok(WatchDebugControlResponse::Ack)
    );
    port.revoke();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "only the first command and fresh probe may reach the runtime"
    );
}

#[test]
fn caller_response_is_bounded_and_revoke_cancels_runtime() {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (_release_tx, release_rx) = mpsc::sync_channel(1);
    let port = WatchDebugCommandWorkerPort::spawn(
        BlockingRuntime {
            entered: entered_tx,
            release: release_rx,
            calls: Arc::new(AtomicUsize::new(0)),
        },
        || true,
        policy(1, 40),
    );
    let command_port = port.clone();
    let command =
        thread::spawn(move || command_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx.recv().expect("entered");
    assert_eq!(
        command.join().expect("command"),
        Err(WatchDebugCommandFailure::ResponseTimeout)
    );

    let stopped = Arc::new(Barrier::new(2));
    let stop_signal = Arc::clone(&stopped);
    let revoke_port = port.clone();
    let revoke = thread::spawn(move || {
        revoke_port.revoke();
        stop_signal.wait();
    });
    stopped.wait();
    revoke.join().expect("bounded revoke");
    assert_eq!(
        port.execute_bounded(WatchDebugControlCommand::Pause),
        Err(WatchDebugCommandFailure::Revoked)
    );
}

struct ShutdownRuntime {
    stopped: mpsc::SyncSender<()>,
}

impl WatchDebugCommandRuntime for ShutdownRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        Ok(runtime_response(command))
    }

    fn shutdown(&mut self, _deadline: Instant, _revoked: &AtomicBool) {
        let _ = self.stopped.send(());
    }
}

#[test]
fn dropping_the_last_port_stops_and_joins_the_worker() {
    let (stopped_tx, stopped_rx) = mpsc::sync_channel(1);
    let port = WatchDebugCommandWorkerPort::spawn(
        ShutdownRuntime {
            stopped: stopped_tx,
        },
        || true,
        policy(1, 100),
    );

    drop(port);
    assert_eq!(
        stopped_rx.recv_timeout(Duration::from_secs(1)),
        Ok(()),
        "last-port Drop must complete worker shutdown"
    );
}

struct DrainBeforeShutdownRuntime {
    entered: mpsc::SyncSender<()>,
    shutdown_entered: mpsc::SyncSender<()>,
}

impl WatchDebugCommandRuntime for DrainBeforeShutdownRuntime {
    fn execute(
        &mut self,
        _command: WatchDebugControlCommand,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        let _ = self.entered.send(());
        while Instant::now() < deadline && !revoked.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(2));
        }
        Err(WatchDebugCommandFailure::TargetRejected)
    }

    fn shutdown(&mut self, deadline: Instant, _revoked: &AtomicBool) {
        let _ = self.shutdown_entered.send(());
        while Instant::now() < deadline {
            thread::sleep(Duration::from_millis(2));
        }
    }
}

#[test]
fn revoke_rejects_in_flight_and_queued_responses_before_shutdown() {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (shutdown_tx, shutdown_rx) = mpsc::sync_channel(1);
    let port = WatchDebugCommandWorkerPort::spawn(
        DrainBeforeShutdownRuntime {
            entered: entered_tx,
            shutdown_entered: shutdown_tx,
        },
        || true,
        policy(2, 100),
    );
    let first_port = port.clone();
    let first = thread::spawn(move || first_port.execute_bounded(WatchDebugControlCommand::Pause));
    entered_rx.recv().expect("first entered");
    let queued_port = port.clone();
    let queued =
        thread::spawn(move || queued_port.execute_bounded(WatchDebugControlCommand::Pause));
    thread::sleep(Duration::from_millis(10));
    let revoke_port = port.clone();
    let revoke = thread::spawn(move || revoke_port.revoke());

    shutdown_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("shutdown entered");
    assert_eq!(
        first.join().expect("first"),
        Err(WatchDebugCommandFailure::Revoked)
    );
    assert_eq!(
        queued.join().expect("queued"),
        Err(WatchDebugCommandFailure::Revoked)
    );
    revoke.join().expect("revoke");
}

struct NonCooperativeShutdownRuntime;

impl WatchDebugCommandRuntime for NonCooperativeShutdownRuntime {
    fn execute(
        &mut self,
        command: WatchDebugControlCommand,
        _deadline: Instant,
        _revoked: &AtomicBool,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        Ok(runtime_response(command))
    }

    fn shutdown(&mut self, _deadline: Instant, _revoked: &AtomicBool) {
        thread::sleep(Duration::from_millis(200));
    }
}

#[test]
fn non_cooperative_shutdown_cannot_block_last_port_drop_past_policy_bound() {
    let port =
        WatchDebugCommandWorkerPort::spawn(NonCooperativeShutdownRuntime, || true, policy(1, 30));
    let started = Instant::now();
    drop(port);
    assert!(
        started.elapsed() < Duration::from_millis(120),
        "stuck runtime must be detached after the caller bound"
    );
}
