use super::*;
use crate::agent_task_spawner::AgentTaskProcessOwnership;

struct NoProcessSignals;

impl AgentProcessGroupSignalSender for NoProcessSignals {
    fn send(&self, _: i32, _: i32) -> Result<(), String> {
        panic!("a shared session must never receive an OS process-group signal")
    }

    fn send_after_observed_exit(&self, _: i32, _: i32) -> Result<(), String> {
        panic!("reaping a shared session must never signal its host process")
    }
}

struct SessionChild {
    exited: bool,
    exit_code: i32,
    force_calls: usize,
    reap_calls: usize,
    observe_calls: usize,
}

impl SessionChild {
    fn new(exited: bool, exit_code: i32) -> Self {
        Self {
            exited,
            exit_code,
            force_calls: 0,
            reap_calls: 0,
            observe_calls: 0,
        }
    }
}

impl AgentChild for SessionChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }

    fn observe_exit(&mut self) -> Result<bool, String> {
        self.observe_calls += 1;
        if !self.exited && self.observe_calls > 3 {
            return Err("turn stop was not dispatched".to_string());
        }
        Ok(self.exited)
    }

    fn reap(&mut self) -> Result<i32, String> {
        assert!(self.exited, "must observe the turn exit before reaping");
        self.reap_calls += 1;
        Ok(self.exit_code)
    }

    fn process_group_id(&self) -> i32 {
        panic!("shared-session ownership must not consult a process group id")
    }

    fn ownership(&self) -> AgentTaskProcessOwnership {
        AgentTaskProcessOwnership::SharedSession
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.force_calls += 1;
        self.exited = true;
        Ok(())
    }
}

#[test]
fn shared_session_signals_request_turn_stop_without_signalling_the_host() {
    for signal in [TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL] {
        let child = SessionChild::new(false, 0);
        let group = AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals));
        assert!(!group.force_requested());
        group.signal(signal).unwrap();
        assert!(group.force_requested());
        assert_eq!(child.force_calls, 0, "the waiter owns the child operation");
        assert!(!group.is_reaped());
    }
}

#[test]
fn shared_session_force_stop_never_signals_the_host() {
    let child = SessionChild::new(false, 0);
    let group = AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals));
    group.force_stop().unwrap();
    assert!(group.force_requested());
    assert_eq!(child.force_calls, 0);
    assert!(!group.is_reaped());
}

#[test]
fn shared_session_cleanup_after_observed_exit_does_not_kill_the_host() {
    let mut child = SessionChild::new(true, 0);
    let group = AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals));
    assert!(group.observe_exit(&mut child).unwrap());
    group.force_stop_after_observed_exit().unwrap();
    assert!(group.cleanup_verified.load(Ordering::SeqCst));
    assert_eq!(child.force_calls, 0);
    assert_eq!(group.reap(&mut child).unwrap(), 0);
    assert!(group.is_reaped());
}

#[test]
fn shared_session_normal_reap_preserves_turn_exit_code() {
    for exit_code in [0, 73] {
        let mut child = SessionChild::new(true, exit_code);
        let group = AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals));
        assert_eq!(group.try_wait(&mut child).unwrap(), Some(exit_code));
        assert!(group.cleanup_verified.load(Ordering::SeqCst));
        assert!(group.is_reaped());
        assert_eq!(child.force_calls, 0);
        assert_eq!(child.reap_calls, 1);
        group.signal(TERMINATE_PROCESS_GROUP_SIGNAL).unwrap();
        group.force_stop_after_observed_exit().unwrap();
        assert_eq!(child.reap_calls, 1);
    }
}

struct NoEvents;

impl AgentTaskEventSink for NoEvents {
    fn status(&self, _: AgentTaskStatusEvent) {}
    fn output(&self, _: AgentTaskOutputEvent) {}
}

#[test]
fn shared_session_waiter_dispatches_stop_to_child_and_reaps_the_turn() {
    let mut child = SessionChild::new(false, 0);
    let group = AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals));
    let shared = Arc::new(AgentTaskShared {
        sink: Arc::new(NoEvents),
        signals: Arc::new(NoProcessSignals),
        tuning: AgentTaskRuntimeTuning::default(),
        live_worker_threads: Arc::new(AtomicUsize::new(0)),
        output_emission_order: Mutex::new(()),
        state: Mutex::new(AgentTaskRegistryState::default()),
        fail_next_waiter_start: AtomicBool::new(false),
    });
    let mut pumps = AgentOutputPumps::new(Arc::new(AtomicBool::new(false)), Vec::new());
    group.signal(TERMINATE_PROCESS_GROUP_SIGNAL).unwrap();
    assert_eq!(child.force_calls, 0);
    run_waiter_inner(&shared, "session-turn", &mut child, &group, &mut pumps);
    assert_eq!(
        child.observe_calls, 1,
        "stop must precede the first exit poll"
    );
    assert_eq!(child.force_calls, 1);
    assert_eq!(child.reap_calls, 1);
    assert!(group.is_reaped());
    assert!(group.cleanup_verified.load(Ordering::SeqCst));
}
