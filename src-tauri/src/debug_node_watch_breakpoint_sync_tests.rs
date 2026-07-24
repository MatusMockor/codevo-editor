use super::super::watch_control_proxy::{
    WatchDebugCommandFailure, WatchDebugControlPort, WatchSetBreakpointsRequest,
};
use super::super::watch_desired_policy::{
    DesiredDebuggerPolicySnapshot, DesiredDebuggerReplayStep,
};
use super::super::watch_generation::TargetGeneration;
use super::*;
use crate::debug_adapter::{
    DebugExceptionPauseMode, DebugFunctionBreakpoint, DebugFunctionBreakpointVerification,
    DebugJustMyCodePolicy,
};
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;

static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: PathBuf,
    file: String,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-watch-breakpoint-sync-{}-{}",
            std::process::id(),
            NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("fixture root");
        let root = root.canonicalize().expect("canonical root");
        let file = root.join("app.js");
        fs::write(&file, "const value = 1;\nconsole.log(value);\n").expect("fixture script");
        Self {
            root,
            file: file.to_string_lossy().into_owned(),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Default)]
struct EchoPort {
    closed: AtomicBool,
}

impl WatchDebugControlPort for EchoPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        match command {
            WatchDebugControlCommand::SetBreakpoints(request) => Ok(verified(request)),
            WatchDebugControlCommand::SetFunctionBreakpoints(request) => {
                Ok(WatchDebugControlResponse::FunctionBreakpointsVerified(
                    request
                        .breakpoints()
                        .iter()
                        .map(|breakpoint| DebugFunctionBreakpointVerification {
                            id: breakpoint.id.clone(),
                            verified: breakpoint.enabled,
                        })
                        .collect(),
                ))
            }
            WatchDebugControlCommand::SetBreakpointsActive(_)
            | WatchDebugControlCommand::SetExceptionPause(_) => Ok(WatchDebugControlResponse::Ack),
            _ => Err(WatchDebugCommandFailure::TargetRejected),
        }
    }

    fn revoke(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

fn verified(request: WatchSetBreakpointsRequest) -> WatchDebugControlResponse {
    let mut breakpoints = request.breakpoints().to_vec();
    for breakpoint in &mut breakpoints {
        breakpoint.verified = breakpoint.enabled;
    }
    WatchDebugControlResponse::BreakpointsVerified {
        file_path: request.file_path().to_string(),
        breakpoints,
    }
}

fn breakpoint(file_path: &str, id: &str, line_number: u32, enabled: bool) -> DebugBreakpoint {
    DebugBreakpoint {
        id: id.to_string(),
        file_path: file_path.to_string(),
        line_number,
        column_number: None,
        condition: None,
        hit_condition: None,
        log_message: None,
        enabled,
        verified: false,
    }
}

fn setup(
    fixture: &Fixture,
    port: Arc<dyn WatchDebugControlPort>,
) -> (
    Arc<Mutex<DesiredDebuggerPolicy>>,
    Arc<WatchBreakpointSynchronizer>,
    WatchDebugControlProxy,
) {
    let desired = Arc::new(Mutex::new(DesiredDebuggerPolicy::new(
        DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            Vec::new(),
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .expect("desired policy"),
    )));
    let control = WatchDebugControlProxy::new();
    control
        .install(TargetGeneration::from_value_for_test(1), port)
        .expect("generation one");
    let synchronizer = Arc::new(WatchBreakpointSynchronizer::new(
        fixture.root.clone(),
        DebugBreakpointAdapterKind::Node,
        Arc::clone(&desired),
        control.clone(),
        Arc::new(Mutex::new(())),
    ));
    (desired, synchronizer, control)
}

fn desired_breakpoints(desired: &Mutex<DesiredDebuggerPolicy>) -> Vec<DebugBreakpoint> {
    lock_recover(desired)
        .replay_plan()
        .steps()
        .iter()
        .find_map(|step| match step {
            DesiredDebuggerReplayStep::SetBreakpoints { breakpoints, .. } => {
                Some(breakpoints.clone())
            }
            _ => None,
        })
        .unwrap_or_default()
}

fn function_breakpoint(id: &str, function_name: &str, enabled: bool) -> DebugFunctionBreakpoint {
    DebugFunctionBreakpoint {
        id: id.to_string(),
        function_name: function_name.to_string(),
        enabled,
    }
}

fn desired_function_breakpoints(
    desired: &Mutex<DesiredDebuggerPolicy>,
) -> Vec<DebugFunctionBreakpoint> {
    lock_recover(desired)
        .replay_plan()
        .steps()
        .iter()
        .find_map(|step| match step {
            DesiredDebuggerReplayStep::SetFunctionBreakpoints { breakpoints } => {
                Some(breakpoints.clone())
            }
            _ => None,
        })
        .unwrap_or_default()
}

#[test]
fn initial_function_breakpoint_install_commits_verified_replay_state() {
    let fixture = Fixture::new();
    let (desired, synchronizer, _control) = setup(&fixture, Arc::new(EchoPort::default()));
    let requested = vec![
        function_breakpoint("fn-one", "app.one", true),
        function_breakpoint("fn-two", "app.two", false),
    ];

    let verified = synchronizer
        .set_function_breakpoints(&requested)
        .expect("install function breakpoints");

    assert_eq!(
        verified,
        vec![
            DebugFunctionBreakpointVerification {
                id: "fn-one".to_string(),
                verified: true,
            },
            DebugFunctionBreakpointVerification {
                id: "fn-two".to_string(),
                verified: false,
            },
        ]
    );
    assert_eq!(desired_function_breakpoints(&desired), requested);
}

#[test]
fn active_toggle_and_exception_mode_commit_into_replacement_replay_state() {
    let fixture = Fixture::new();
    let (desired, synchronizer, _control) = setup(&fixture, Arc::new(EchoPort::default()));

    synchronizer
        .set_breakpoints_active(false)
        .expect("disable breakpoints");
    synchronizer
        .set_exception_pause(DebugExceptionPauseMode::All)
        .expect("exception mode");

    let plan = lock_recover(&desired).replay_plan();
    assert!(plan
        .steps()
        .contains(&DesiredDebuggerReplayStep::SetBreakpointsActive(false)));
    assert!(plan
        .steps()
        .contains(&DesiredDebuggerReplayStep::SetExceptionPause(
            DebugExceptionPauseMode::All
        )));
}

#[test]
fn generation_one_add_update_disable_and_remove_commit_exact_desired_snapshot() {
    let fixture = Fixture::new();
    let (desired, synchronizer, _control) = setup(&fixture, Arc::new(EchoPort::default()));

    let added = breakpoint(&fixture.file, "one", 1, true);
    let applied = synchronizer
        .set_breakpoints(&fixture.file, std::slice::from_ref(&added))
        .expect("add breakpoint");
    assert!(applied[0].verified);
    assert_eq!(desired_breakpoints(&desired), vec![added.clone()]);

    let updated = breakpoint(&fixture.file, "one", 2, true);
    synchronizer
        .set_breakpoints(&fixture.file, std::slice::from_ref(&updated))
        .expect("update breakpoint");
    assert_eq!(desired_breakpoints(&desired), vec![updated.clone()]);

    let disabled = breakpoint(&fixture.file, "one", 2, false);
    let applied = synchronizer
        .set_breakpoints(&fixture.file, std::slice::from_ref(&disabled))
        .expect("disable breakpoint");
    assert!(!applied[0].verified);
    assert_eq!(desired_breakpoints(&desired), vec![disabled]);

    synchronizer
        .set_breakpoints(&fixture.file, &[])
        .expect("remove breakpoint");
    assert!(desired_breakpoints(&desired).is_empty());
}

struct BlockingPort {
    entered: Arc<Barrier>,
    release: Arc<Barrier>,
}

impl WatchDebugControlPort for BlockingPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        let WatchDebugControlCommand::SetBreakpoints(request) = command else {
            return Err(WatchDebugCommandFailure::TargetRejected);
        };
        self.entered.wait();
        self.release.wait();
        Ok(verified(request))
    }
}

#[test]
fn replacement_before_ack_revokes_response_without_committing_desired_state() {
    let fixture = Fixture::new();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (desired, synchronizer, control) = setup(
        &fixture,
        Arc::new(BlockingPort {
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        }),
    );
    let requested = breakpoint(&fixture.file, "one", 1, true);
    let worker = {
        let synchronizer = Arc::clone(&synchronizer);
        let file = fixture.file.clone();
        thread::spawn(move || synchronizer.set_breakpoints(&file, &[requested]))
    };
    entered.wait();
    control
        .install(
            TargetGeneration::from_value_for_test(2),
            Arc::new(EchoPort::default()),
        )
        .expect("replacement generation");
    release.wait();

    assert_eq!(
        worker.join().expect("mutation thread"),
        Err(WatchBreakpointSyncFailure::Revoked)
    );
    assert!(desired_breakpoints(&desired).is_empty());
}

struct StaleAfterAckPort {
    closed: AtomicBool,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    root: PathBuf,
}

impl WatchDebugControlPort for StaleAfterAckPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        match command {
            WatchDebugControlCommand::SetBreakpoints(request) => {
                lock_recover(&self.desired)
                    .replace(
                        &self.root,
                        DebugBreakpointAdapterKind::Node,
                        Vec::new(),
                        DebugExceptionPauseMode::All,
                        true,
                        Some(DebugJustMyCodePolicy::NodeInternals),
                    )
                    .expect("adversarial desired revision");
                Ok(verified(request))
            }
            WatchDebugControlCommand::SetFunctionBreakpoints(request) => {
                lock_recover(&self.desired)
                    .replace(
                        &self.root,
                        DebugBreakpointAdapterKind::Node,
                        Vec::new(),
                        DebugExceptionPauseMode::All,
                        true,
                        Some(DebugJustMyCodePolicy::NodeInternals),
                    )
                    .expect("adversarial desired revision");
                Ok(WatchDebugControlResponse::FunctionBreakpointsVerified(
                    request
                        .breakpoints()
                        .iter()
                        .map(|breakpoint| DebugFunctionBreakpointVerification {
                            id: breakpoint.id.clone(),
                            verified: true,
                        })
                        .collect(),
                ))
            }
            _ => Err(WatchDebugCommandFailure::TargetRejected),
        }
    }

    fn revoke(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

#[test]
fn stale_commit_after_ack_closes_exact_generation_and_never_publishes_ghost_policy() {
    let fixture = Fixture::new();
    let desired = Arc::new(Mutex::new(DesiredDebuggerPolicy::new(
        DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            Vec::new(),
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .expect("desired policy"),
    )));
    let port = Arc::new(StaleAfterAckPort {
        closed: AtomicBool::new(false),
        desired: Arc::clone(&desired),
        root: fixture.root.clone(),
    });
    let control = WatchDebugControlProxy::new();
    control
        .install(TargetGeneration::from_value_for_test(1), port.clone())
        .expect("generation one");
    let synchronizer = WatchBreakpointSynchronizer::new(
        fixture.root.clone(),
        DebugBreakpointAdapterKind::Node,
        Arc::clone(&desired),
        control.clone(),
        Arc::new(Mutex::new(())),
    );

    assert_eq!(
        synchronizer.set_breakpoints(&fixture.file, &[breakpoint(&fixture.file, "one", 1, true)]),
        Err(WatchBreakpointSyncFailure::StaleAuthority)
    );
    assert!(port.closed.load(Ordering::Acquire));
    assert_eq!(
        control.pause(),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
    assert!(desired_breakpoints(&desired).is_empty());
}

#[test]
fn stale_function_commit_closes_generation_without_orphaning_desired_state() {
    let fixture = Fixture::new();
    let desired = Arc::new(Mutex::new(DesiredDebuggerPolicy::new(
        DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            Vec::new(),
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .expect("desired policy"),
    )));
    let port = Arc::new(StaleAfterAckPort {
        closed: AtomicBool::new(false),
        desired: Arc::clone(&desired),
        root: fixture.root.clone(),
    });
    let control = WatchDebugControlProxy::new();
    control
        .install(TargetGeneration::from_value_for_test(1), port.clone())
        .expect("generation one");
    let synchronizer = WatchBreakpointSynchronizer::new(
        fixture.root.clone(),
        DebugBreakpointAdapterKind::Node,
        Arc::clone(&desired),
        control.clone(),
        Arc::new(Mutex::new(())),
    );

    assert_eq!(
        synchronizer.set_function_breakpoints(&[function_breakpoint("fn-one", "app.one", true)]),
        Err(WatchBreakpointSyncFailure::StaleAuthority)
    );
    assert!(port.closed.load(Ordering::Acquire));
    assert_eq!(
        control.pause(),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
    assert!(desired_function_breakpoints(&desired).is_empty());
}

struct FailingPort(WatchDebugCommandFailure);

impl WatchDebugControlPort for FailingPort {
    fn execute(
        &self,
        _command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        Err(self.0)
    }
}

struct UncertainPolicyMutationPort {
    failure: WatchDebugCommandFailure,
    closed: AtomicBool,
}

impl WatchDebugControlPort for UncertainPolicyMutationPort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        assert!(matches!(
            command,
            WatchDebugControlCommand::SetBreakpointsActive(_)
                | WatchDebugControlCommand::SetExceptionPause(_)
        ));
        Err(self.failure)
    }

    fn revoke(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

#[test]
fn uncertain_policy_mutations_revoke_without_committing_replay_state() {
    for (failure, mutate, expected) in [
        (
            WatchDebugCommandFailure::StalePauseEpoch,
            false,
            WatchBreakpointSyncFailure::StalePauseEpoch,
        ),
        (
            WatchDebugCommandFailure::ResponseMismatch,
            true,
            WatchBreakpointSyncFailure::ResponseMismatch,
        ),
    ] {
        let fixture = Fixture::new();
        let port = Arc::new(UncertainPolicyMutationPort {
            failure,
            closed: AtomicBool::new(false),
        });
        let (desired, synchronizer, control) = setup(&fixture, port.clone());

        let result = if mutate {
            synchronizer.set_exception_pause(DebugExceptionPauseMode::All)
        } else {
            synchronizer.set_breakpoints_active(false)
        };
        assert_eq!(result, Err(expected));
        assert!(port.closed.load(Ordering::Acquire));
        assert_eq!(
            control.pause(),
            Err(WatchDebugControlFailure::NoActiveTarget)
        );

        let plan = lock_recover(&desired).replay_plan();
        assert!(plan
            .steps()
            .contains(&DesiredDebuggerReplayStep::SetBreakpointsActive(true)));
        assert!(plan
            .steps()
            .contains(&DesiredDebuggerReplayStep::SetExceptionPause(
                DebugExceptionPauseMode::None
            )));
    }
}

#[test]
fn bounded_transport_failures_are_typed_and_leave_desired_state_unchanged() {
    for (command_failure, expected) in [
        (
            WatchDebugCommandFailure::QueueFull,
            WatchBreakpointSyncFailure::QueueFull,
        ),
        (
            WatchDebugCommandFailure::ResponseTimeout,
            WatchBreakpointSyncFailure::ResponseTimeout,
        ),
        (
            WatchDebugCommandFailure::StaleAuthority,
            WatchBreakpointSyncFailure::StaleAuthority,
        ),
        (
            WatchDebugCommandFailure::TargetRejected,
            WatchBreakpointSyncFailure::TargetRejected,
        ),
        (
            WatchDebugCommandFailure::WorkerStopped,
            WatchBreakpointSyncFailure::WorkerStopped,
        ),
    ] {
        let fixture = Fixture::new();
        let (desired, synchronizer, _control) =
            setup(&fixture, Arc::new(FailingPort(command_failure)));
        assert_eq!(
            synchronizer
                .set_breakpoints(&fixture.file, &[breakpoint(&fixture.file, "one", 1, true)]),
            Err(expected)
        );
        assert!(desired_breakpoints(&desired).is_empty());
    }
}

#[derive(Default)]
struct MismatchedResponsePort {
    closed: AtomicBool,
}

impl WatchDebugControlPort for MismatchedResponsePort {
    fn execute(
        &self,
        command: WatchDebugControlCommand,
    ) -> Result<WatchDebugControlResponse, WatchDebugCommandFailure> {
        let _ = command;
        Ok(WatchDebugControlResponse::Ack)
    }

    fn revoke(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

#[test]
fn mismatched_post_mutation_response_closes_generation_without_ghost_commit() {
    let fixture = Fixture::new();
    let port = Arc::new(MismatchedResponsePort::default());
    let (desired, synchronizer, control) = setup(&fixture, port.clone());
    assert_eq!(
        synchronizer.set_breakpoints(&fixture.file, &[breakpoint(&fixture.file, "one", 1, true)]),
        Err(WatchBreakpointSyncFailure::ResponseMismatch)
    );
    assert!(port.closed.load(Ordering::Acquire));
    assert_eq!(
        control.pause(),
        Err(WatchDebugControlFailure::NoActiveTarget)
    );
    assert!(desired_breakpoints(&desired).is_empty());
}
