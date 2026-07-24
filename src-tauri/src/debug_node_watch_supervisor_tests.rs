use super::super::watch_controller::{WatchReconnectFailure, WatchReconnectTerminal};
use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
#[cfg(unix)]
use std::{os::unix::process::CommandExt, process::Command, time::Instant};

#[derive(Clone, Debug, Eq, PartialEq)]
enum Event {
    Seed,
    Endpoint,
    Closed(u64),
    Deadline,
    Cancel,
    SupervisorExited,
    EndpointCancel,
    TerminateGroup,
    KillGroup,
    Wait,
}

struct FakeController {
    events: Rc<RefCell<Vec<Event>>>,
    terminals: VecDeque<&'static str>,
}

impl FakeController {
    fn effect(&mut self, name: &'static str) -> WatchReconnectEffect {
        if self.terminals.front() == Some(&name) {
            self.terminals.pop_front();
            WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
                WatchReconnectFailure::SupervisorExited,
            ))
        } else {
            WatchReconnectEffect::Ignored
        }
    }
}

impl WatchSupervisorController for FakeController {
    fn seed_initial(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.events.borrow_mut().push(Event::Seed);
        self.effect("seed")
    }

    fn observe_endpoint(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.events.borrow_mut().push(Event::Endpoint);
        self.effect("endpoint")
    }

    fn target_closed(
        &mut self,
        generation: TargetGeneration,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.events
            .borrow_mut()
            .push(Event::Closed(generation.get()));
        self.effect("closed")
    }

    fn deadline_elapsed(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        self.events.borrow_mut().push(Event::Deadline);
        self.effect("deadline")
    }

    fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        self.events.borrow_mut().push(Event::SupervisorExited);
        self.effect("supervisor")
    }

    fn cancel(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        self.events.borrow_mut().push(Event::Cancel);
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Cancelled)
    }
}

struct FakeEndpoints {
    results: RefCell<VecDeque<Result<InspectorEndpointFingerprint, InspectorEndpointFeedError>>>,
    events: Rc<RefCell<Vec<Event>>>,
}

impl WatchEndpointSource for FakeEndpoints {
    fn receive(
        &self,
        _timeout: Duration,
    ) -> Result<InspectorEndpointFingerprint, InspectorEndpointFeedError> {
        self.results
            .borrow_mut()
            .pop_front()
            .unwrap_or(Err(InspectorEndpointFeedError::Timeout))
    }

    fn cancel(&self) {
        self.events.borrow_mut().push(Event::EndpointCancel);
    }
}

struct FakeDisconnects {
    results: RefCell<VecDeque<DisconnectPoll>>,
}

impl WatchDisconnectSource for FakeDisconnects {
    fn poll(&self) -> DisconnectPoll {
        self.results
            .borrow_mut()
            .pop_front()
            .unwrap_or(DisconnectPoll::Empty)
    }
}

struct FakeProcess {
    polls: VecDeque<SupervisorPoll>,
    events: Rc<RefCell<Vec<Event>>>,
    wait_code: Option<i32>,
}

impl WatchSupervisorProcess for FakeProcess {
    fn poll(&mut self) -> SupervisorPoll {
        self.polls.pop_front().unwrap_or(SupervisorPoll::Running)
    }

    fn terminate_group(&mut self) {
        self.events.borrow_mut().push(Event::TerminateGroup);
    }

    fn kill_group(&mut self) {
        self.events.borrow_mut().push(Event::KillGroup);
    }

    fn wait(&mut self) -> Option<i32> {
        self.events.borrow_mut().push(Event::Wait);
        self.wait_code
    }
}

struct FakeClock {
    ticks: u64,
}

impl WatchSupervisorClock for FakeClock {
    fn now(&self) -> WatchInstant {
        WatchInstant::from_ticks(self.ticks)
    }

    fn sleep(&mut self, duration: Duration) {
        self.ticks = self
            .ticks
            .saturating_add(u64::try_from(duration.as_millis()).unwrap_or(u64::MAX));
    }
}

fn endpoint(uuid_digit: char) -> InspectorEndpointFingerprint {
    InspectorEndpointFingerprint::parse(
        "127.0.0.1:9229",
        &format!(
            "{0}{0}{0}{0}{0}{0}{0}{0}-{0}{0}{0}{0}-{0}{0}{0}{0}-{0}{0}{0}{0}-{0}{0}{0}{0}{0}{0}{0}{0}{0}{0}{0}{0}",
            uuid_digit
        ),
    )
    .expect("valid endpoint")
}

fn harness(
    terminals: impl IntoIterator<Item = &'static str>,
    endpoint_results: impl IntoIterator<
        Item = Result<InspectorEndpointFingerprint, InspectorEndpointFeedError>,
    >,
    disconnect_results: impl IntoIterator<Item = DisconnectPoll>,
    process_polls: impl IntoIterator<Item = SupervisorPoll>,
) -> (
    FakeController,
    FakeEndpoints,
    FakeDisconnects,
    FakeProcess,
    FakeClock,
    Rc<RefCell<Vec<Event>>>,
) {
    let events = Rc::new(RefCell::new(Vec::new()));
    (
        FakeController {
            events: Rc::clone(&events),
            terminals: terminals.into_iter().collect(),
        },
        FakeEndpoints {
            results: RefCell::new(endpoint_results.into_iter().collect()),
            events: Rc::clone(&events),
        },
        FakeDisconnects {
            results: RefCell::new(disconnect_results.into_iter().collect()),
        },
        FakeProcess {
            polls: process_polls.into_iter().collect(),
            events: Rc::clone(&events),
            wait_code: None,
        },
        FakeClock { ticks: 1 },
        events,
    )
}

#[test]
fn seeds_once_then_routes_endpoint_and_disconnect_before_terminal_cleanup() {
    let replacement = endpoint('2');
    let disconnect = WatchTargetDisconnect {
        generation: TargetGeneration::from_value_for_test(1),
        endpoint: endpoint('1'),
    };
    let (controller, endpoints, disconnects, mut process, mut clock, events) = harness(
        ["closed"],
        [Ok(replacement)],
        [DisconnectPoll::Empty, DisconnectPoll::Event(disconnect)],
        [SupervisorPoll::Running; 4],
    );

    let result = run_watch_supervisor(
        controller,
        endpoints,
        disconnects,
        &mut process,
        &mut clock,
        &AtomicBool::new(false),
        endpoint('1'),
    );

    assert_eq!(
        result,
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::ReconnectFailed(
                WatchReconnectFailure::SupervisorExited
            ),
            exit_code: None,
        }
    );
    let events = events.borrow();
    assert_eq!(
        events.iter().filter(|event| **event == Event::Seed).count(),
        1
    );
    assert!(events.starts_with(&[Event::Seed, Event::Endpoint, Event::Closed(1)]));
    assert!(events.contains(&Event::TerminateGroup));
}

#[test]
fn cancellation_revokes_controller_then_terminates_and_hard_kills_group() {
    let (controller, endpoints, disconnects, mut process, mut clock, events) =
        harness([], [], [], [SupervisorPoll::Running; 64]);
    process.wait_code = Some(143);
    let cancelled = AtomicBool::new(true);

    assert_eq!(
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            &mut process,
            &mut clock,
            &cancelled,
            endpoint('1'),
        ),
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::Cancelled,
            exit_code: Some(143),
        }
    );

    let events = events.borrow();
    let cancel = events
        .iter()
        .position(|event| *event == Event::Cancel)
        .unwrap();
    let terminate = events
        .iter()
        .position(|event| *event == Event::TerminateGroup)
        .unwrap();
    let kill = events
        .iter()
        .position(|event| *event == Event::KillGroup)
        .unwrap();
    let wait = events
        .iter()
        .position(|event| *event == Event::Wait)
        .unwrap();
    assert!(cancel < terminate && terminate < kill && kill < wait);
}

#[test]
fn observed_supervisor_exit_finishes_after_process_generation_is_owned() {
    let (controller, endpoints, disconnects, mut process, mut clock, events) =
        harness(["supervisor"], [], [], [SupervisorPoll::Exited(Some(17))]);

    assert_eq!(
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            &mut process,
            &mut clock,
            &AtomicBool::new(false),
            endpoint('1'),
        ),
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::SupervisorExited,
            exit_code: Some(17),
        }
    );

    assert_eq!(
        *events.borrow(),
        vec![Event::Seed, Event::SupervisorExited, Event::EndpointCancel]
    );
}

#[cfg(unix)]
#[test]
fn natural_leader_exit_kills_descendants_before_reaping_generation() {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "sleep 30 & exit 17"]).process_group(0);
    let child = command.spawn().expect("spawn natural-exit process group");
    let process_group_id = i32::try_from(child.id()).expect("process group");
    let mut process = SpawnedWatchProcess::new(child);
    let deadline = Instant::now() + Duration::from_secs(2);

    let exit_code = loop {
        match process.poll() {
            SupervisorPoll::Exited(exit_code) => break exit_code,
            SupervisorPoll::Running if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(10));
            }
            outcome => panic!("process generation did not exit cleanly: {outcome:?}"),
        }
    };

    assert_eq!(exit_code, Some(17));
    let group_deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let result = unsafe { libc::kill(-process_group_id, 0) };
        if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            break;
        }
        assert!(
            Instant::now() < group_deadline,
            "descendant process group remained observable after leader reap"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn close_grace_ticks_controller_during_idle_feed() {
    let (controller, endpoints, disconnects, mut process, mut clock, events) = harness(
        ["deadline"],
        [Err(InspectorEndpointFeedError::Timeout)],
        [],
        [SupervisorPoll::Running, SupervisorPoll::Exited(Some(0))],
    );

    assert_eq!(
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            &mut process,
            &mut clock,
            &AtomicBool::new(false),
            endpoint('1'),
        ),
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::ReconnectFailed(
                WatchReconnectFailure::SupervisorExited
            ),
            exit_code: Some(0),
        }
    );
    assert!(events.borrow().contains(&Event::Deadline));
}

#[test]
fn disconnect_feed_fails_closed_on_overflow() {
    let (publisher, feed) = watch_target_disconnect_feed();
    for index in 0..=DISCONNECT_FEED_CAPACITY {
        publisher.publish(
            TargetGeneration::from_value_for_test(index as u64 + 1),
            endpoint('1'),
        );
    }
    assert!(matches!(feed.poll(), DisconnectPoll::Failed));
}

#[test]
fn endpoint_overflow_fails_closed_through_the_controller() {
    let (controller, endpoints, disconnects, mut process, mut clock, events) = harness(
        ["supervisor"],
        [Err(InspectorEndpointFeedError::Overflow)],
        [],
        [SupervisorPoll::Running, SupervisorPoll::Exited(None)],
    );

    assert_eq!(
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            &mut process,
            &mut clock,
            &AtomicBool::new(false),
            endpoint('1'),
        ),
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::ReconnectFailed(
                WatchReconnectFailure::SupervisorExited
            ),
            exit_code: None,
        }
    );
    assert!(events.borrow().contains(&Event::SupervisorExited));
}

struct CancellingEndpoints<'a> {
    cancelled: &'a AtomicBool,
    events: Rc<RefCell<Vec<Event>>>,
}

impl WatchEndpointSource for CancellingEndpoints<'_> {
    fn receive(
        &self,
        _timeout: Duration,
    ) -> Result<InspectorEndpointFingerprint, InspectorEndpointFeedError> {
        self.cancelled.store(true, Ordering::Release);
        Err(InspectorEndpointFeedError::Cancelled)
    }

    fn cancel(&self) {
        self.events.borrow_mut().push(Event::EndpointCancel);
    }
}

#[test]
fn cancellation_while_endpoint_receive_is_in_flight_revokes_before_cleanup() {
    let (controller, _, disconnects, mut process, mut clock, events) = harness(
        [],
        [],
        [],
        [SupervisorPoll::Running, SupervisorPoll::Exited(None)],
    );
    let cancelled = AtomicBool::new(false);
    let endpoints = CancellingEndpoints {
        cancelled: &cancelled,
        events: Rc::clone(&events),
    };

    assert_eq!(
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            &mut process,
            &mut clock,
            &cancelled,
            endpoint('1'),
        ),
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::Cancelled,
            exit_code: None,
        }
    );
    let events = events.borrow();
    let cancel = events
        .iter()
        .position(|event| *event == Event::Cancel)
        .unwrap();
    let endpoint_cancel = events
        .iter()
        .position(|event| *event == Event::EndpointCancel)
        .unwrap();
    assert!(cancel < endpoint_cancel);
}

struct PanickingController;

impl WatchSupervisorController for PanickingController {
    fn seed_initial(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        panic!("fake controller panic");
    }

    fn observe_endpoint(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        unreachable!()
    }

    fn target_closed(
        &mut self,
        _generation: TargetGeneration,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        unreachable!()
    }

    fn deadline_elapsed(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        unreachable!()
    }

    fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        unreachable!()
    }

    fn cancel(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        unreachable!()
    }
}

#[test]
fn controller_panic_still_reaps_and_finishes_logical_session_once() {
    let (_, endpoints, disconnects, mut process, mut clock, events) =
        harness([], [], [], [SupervisorPoll::Running; 64]);
    process.wait_code = Some(137);
    let finish_count = Arc::new(AtomicUsize::new(0));
    let observed_finish_count = Arc::clone(&finish_count);
    let observed_outcome = Arc::new(std::sync::Mutex::new(None));
    let finish_outcome = Arc::clone(&observed_outcome);

    run_watch_supervisor_and_finish(
        PanickingController,
        endpoints,
        disconnects,
        &mut process,
        &mut clock,
        &AtomicBool::new(false),
        endpoint('1'),
        move |outcome| {
            *finish_outcome.lock().expect("finish outcome") = Some(outcome);
            observed_finish_count.fetch_add(1, Ordering::SeqCst);
        },
    );

    assert_eq!(finish_count.load(Ordering::SeqCst), 1);
    assert_eq!(
        *observed_outcome.lock().expect("observed outcome"),
        Some(WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::Panicked,
            exit_code: Some(137),
        })
    );
    let events = events.borrow();
    assert!(events.contains(&Event::TerminateGroup));
    assert!(events.contains(&Event::KillGroup));
    assert!(events.contains(&Event::Wait));
}

struct ExactFailureController(WatchReconnectFailure);

impl WatchSupervisorController for ExactFailureController {
    fn seed_initial(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(self.0))
    }

    fn observe_endpoint(
        &mut self,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        unreachable!()
    }

    fn target_closed(
        &mut self,
        _generation: TargetGeneration,
        _endpoint: InspectorEndpointFingerprint,
        _now: WatchInstant,
    ) -> WatchReconnectEffect {
        unreachable!()
    }

    fn deadline_elapsed(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        unreachable!()
    }

    fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        unreachable!()
    }

    fn cancel(&mut self, _now: WatchInstant) -> WatchReconnectEffect {
        unreachable!()
    }
}

#[test]
fn reconnect_outcome_preserves_exact_closed_failure_without_sensitive_context() {
    let (_, endpoints, disconnects, mut process, mut clock, _) =
        harness([], [], [], [SupervisorPoll::Exited(Some(9))]);
    let outcome = run_watch_supervisor(
        ExactFailureController(WatchReconnectFailure::EndpointBeforeCloseTimedOut),
        endpoints,
        disconnects,
        &mut process,
        &mut clock,
        &AtomicBool::new(false),
        endpoint('1'),
    );

    assert_eq!(
        outcome,
        WatchSupervisorOutcome {
            termination: WatchSupervisorTermination::ReconnectFailed(
                WatchReconnectFailure::EndpointBeforeCloseTimedOut
            ),
            exit_code: Some(9),
        }
    );
    assert_eq!(
        outcome.termination(),
        WatchSupervisorTermination::ReconnectFailed(
            WatchReconnectFailure::EndpointBeforeCloseTimedOut
        )
    );
    assert_eq!(outcome.exit_code(), Some(9));
    let diagnostic = format!("{outcome:?}");
    assert!(!diagnostic.contains("ws://"));
    assert!(!diagnostic.contains("/workspace"));
}

#[test]
fn handle_drop_revokes_endpoint_feed_and_joins_owner_worker() {
    assert_handle_revokes_and_joins(false);
}

#[test]
fn explicit_stop_has_the_same_revoke_and_join_contract_as_drop() {
    assert_handle_revokes_and_joins(true);
}

#[test]
fn owner_thread_spawn_failure_drops_the_captured_process_owner() {
    struct DropProbe(Arc<AtomicBool>);

    impl Drop for DropProbe {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }

    let dropped = Arc::new(AtomicBool::new(false));
    let owner = DropProbe(Arc::clone(&dropped));
    let result = spawn_supervisor_owner_with(Box::new(move || drop(owner)), |_job| {
        Err(std::io::Error::other("injected owner spawn failure"))
    });

    assert!(result.is_err());
    assert!(dropped.load(Ordering::Acquire));
}

fn assert_handle_revokes_and_joins(stop_explicitly: bool) {
    let (_publisher, endpoints) = crate::debug_inspector_discovery::inspector_endpoint_feed();
    let endpoint_cancellation = endpoints.cancellation_handle();
    let cancellation = WatchSupervisorCancellation::new();
    let worker_cancellation = cancellation.clone();
    let joined = Arc::new(AtomicBool::new(false));
    let worker_joined = Arc::clone(&joined);
    let worker = thread::spawn(move || {
        while !worker_cancellation.is_revoked() {
            thread::yield_now();
        }
        worker_joined.store(true, Ordering::Release);
    });
    let handle = WatchSupervisorHandle {
        cancellation,
        endpoint_cancellation,
        worker: Some(worker),
    };

    if stop_explicitly {
        handle.stop();
    } else {
        drop(handle);
    }

    assert!(joined.load(Ordering::Acquire));
    assert_eq!(
        endpoints.receive_fingerprint(Duration::from_millis(1)),
        Err(InspectorEndpointFeedError::Cancelled)
    );
}

#[test]
fn owner_worker_never_attempts_to_join_itself() {
    let (worker_sender, worker_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let own_handle = worker_receiver.recv().expect("receive own join handle");
        join_owner_worker(own_handle);
        finished_sender
            .send(())
            .expect("report detached completion");
    });
    worker_sender.send(worker).expect("send own join handle");

    assert_eq!(
        finished_receiver.recv_timeout(Duration::from_secs(1)),
        Ok(())
    );
}
