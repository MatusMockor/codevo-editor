use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

#[derive(Clone, Debug, Eq, PartialEq)]
enum RecordedEvent {
    Connect(PauseGenerationFloor),
    Publish(u64),
    Replay(u64),
    Terminate(u64),
}

#[derive(Clone)]
struct FakeTarget {
    id: u64,
    pause_generation_epoch: u64,
    events: Rc<RefCell<Vec<RecordedEvent>>>,
}

impl WatchTargetHandle for FakeTarget {
    fn pause_generation_epoch(&self) -> Result<u64, ()> {
        (self.pause_generation_epoch != u64::MAX)
            .then_some(self.pause_generation_epoch)
            .ok_or(())
    }

    fn terminate(&mut self) {
        self.events
            .borrow_mut()
            .push(RecordedEvent::Terminate(self.id));
    }
}

struct FakeConnector {
    next_id: u64,
    pause_epochs: VecDeque<u64>,
    failures: VecDeque<bool>,
    events: Rc<RefCell<Vec<RecordedEvent>>>,
}

impl WatchTargetConnector for FakeConnector {
    type Target = FakeTarget;

    fn connect(
        &mut self,
        _generation: TargetGeneration,
        _endpoint: &InspectorEndpointFingerprint,
        pause_generation_floor: PauseGenerationFloor,
    ) -> Result<Self::Target, ()> {
        self.events
            .borrow_mut()
            .push(RecordedEvent::Connect(pause_generation_floor));
        if self.failures.pop_front().unwrap_or(false) {
            return Err(());
        }
        let id = self.next_id;
        self.next_id += 1;
        Ok(FakeTarget {
            id,
            pause_generation_epoch: self.pause_epochs.pop_front().unwrap_or(0),
            events: Rc::clone(&self.events),
        })
    }
}

struct FakeReplay {
    outcomes: VecDeque<Result<WatchReplayOutcome, ()>>,
    events: Rc<RefCell<Vec<RecordedEvent>>>,
}

impl WatchTargetReplay<FakeTarget> for FakeReplay {
    fn replay(&mut self, target: &mut FakeTarget) -> Result<WatchReplayOutcome, ()> {
        self.events
            .borrow_mut()
            .push(RecordedEvent::Replay(target.id));
        self.outcomes
            .pop_front()
            .unwrap_or(Ok(WatchReplayOutcome::Applied))
    }
}

struct FakePublisher {
    fail: bool,
    events: Rc<RefCell<Vec<RecordedEvent>>>,
}

impl WatchTargetPublisher<FakeTarget> for FakePublisher {
    fn publish(
        &mut self,
        generation: TargetGeneration,
        _target: &mut FakeTarget,
    ) -> Result<(), ()> {
        self.events
            .borrow_mut()
            .push(RecordedEvent::Publish(generation.get()));
        if self.fail {
            Err(())
        } else {
            Ok(())
        }
    }
}

type Controller = WatchReconnectController<FakeConnector, FakeReplay, FakePublisher>;

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

fn controller(
    replacement_timeout: u64,
    endpoint_limit: u16,
    grace: u64,
    pause_epochs: impl IntoIterator<Item = u64>,
    connect_failures: impl IntoIterator<Item = bool>,
    replay_outcomes: impl IntoIterator<Item = Result<WatchReplayOutcome, ()>>,
    publish_fails: bool,
) -> (Controller, Rc<RefCell<Vec<RecordedEvent>>>) {
    let events = Rc::new(RefCell::new(Vec::new()));
    (
        WatchReconnectController::new(
            WatchGenerationPolicy::new(replacement_timeout, endpoint_limit)
                .expect("generation policy"),
            WatchReconnectPolicy::new(grace).expect("reconnect policy"),
            FakeConnector {
                next_id: 1,
                pause_epochs: pause_epochs.into_iter().collect(),
                failures: connect_failures.into_iter().collect(),
                events: Rc::clone(&events),
            },
            FakeReplay {
                outcomes: replay_outcomes.into_iter().collect(),
                events: Rc::clone(&events),
            },
            FakePublisher {
                fail: publish_fails,
                events: Rc::clone(&events),
            },
        ),
        events,
    )
}

fn seed(controller: &mut Controller, endpoint: &InspectorEndpointFingerprint) -> TargetGeneration {
    let WatchReconnectEffect::Activated(generation) =
        controller.seed_initial(endpoint.clone(), WatchInstant::from_ticks(1))
    else {
        panic!("initial target must activate");
    };
    generation
}

#[test]
fn policy_bounds_endpoint_before_close_grace() {
    assert!(WatchReconnectPolicy::new(1).is_ok());
    assert!(WatchReconnectPolicy::new(MAX_ENDPOINT_BEFORE_CLOSE_GRACE_TICKS).is_ok());
    assert!(WatchReconnectPolicy::new(0).is_err());
    assert!(WatchReconnectPolicy::new(MAX_ENDPOINT_BEFORE_CLOSE_GRACE_TICKS + 1).is_err());
}

#[test]
fn idle_deadline_ticks_never_terminate_an_active_generation() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);

    for tick in 2..=100 {
        assert_eq!(
            controller.deadline_elapsed(WatchInstant::from_ticks(tick)),
            WatchReconnectEffect::Ignored
        );
    }
    assert_eq!(
        *events.borrow(),
        vec![
            RecordedEvent::Connect(PauseGenerationFloor::INITIAL),
            RecordedEvent::Replay(1),
            RecordedEvent::Publish(1),
        ]
    );
}

#[test]
fn initial_generation_is_seeded_once_and_published_only_after_replay() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [12], [], [Ok(WatchReplayOutcome::Applied)], false);

    let generation = seed(&mut controller, &first);
    assert_eq!(generation.get(), 1);
    assert_eq!(
        *events.borrow(),
        vec![
            RecordedEvent::Connect(PauseGenerationFloor::INITIAL),
            RecordedEvent::Replay(1),
            RecordedEvent::Publish(1),
        ]
    );

    assert_eq!(
        controller.seed_initial(first, WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::Coordinator(WatchGenerationFailure::UnexpectedEvent)
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn confirmed_close_connects_replacement_with_previous_pause_floor() {
    let first = endpoint('1');
    let second = endpoint('2');
    let (mut controller, events) = controller(
        20,
        8,
        5,
        [41, 73],
        [],
        [
            Ok(WatchReplayOutcome::Applied),
            Ok(WatchReplayOutcome::Applied),
        ],
        false,
    );
    let generation = seed(&mut controller, &first);

    assert_eq!(
        controller.target_closed(generation, first, WatchInstant::from_ticks(3)),
        WatchReconnectEffect::AwaitingReplacement(generation)
    );
    assert_eq!(
        controller.observe_endpoint(second, WatchInstant::from_ticks(4)),
        WatchReconnectEffect::Activated(TargetGeneration::from_value_for_test(2))
    );
    assert_eq!(
        *events.borrow(),
        vec![
            RecordedEvent::Connect(PauseGenerationFloor::INITIAL),
            RecordedEvent::Replay(1),
            RecordedEvent::Publish(1),
            RecordedEvent::Terminate(1),
            RecordedEvent::Connect(
                PauseGenerationFloor::try_from_epoch(41).expect("successor floor")
            ),
            RecordedEvent::Replay(2),
            RecordedEvent::Publish(2),
        ]
    );
}

#[test]
fn endpoint_before_close_waits_for_confirmation_then_activates() {
    let first = endpoint('1');
    let second = endpoint('2');
    let (mut controller, events) = controller(
        20,
        8,
        5,
        [6, 9],
        [],
        [
            Ok(WatchReplayOutcome::Applied),
            Ok(WatchReplayOutcome::Applied),
        ],
        false,
    );
    let generation = seed(&mut controller, &first);

    assert_eq!(
        controller.observe_endpoint(second.clone(), WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Ignored
    );
    assert_eq!(events.borrow().len(), 3, "candidate must not connect early");
    assert_eq!(
        controller.observe_endpoint(second, WatchInstant::from_ticks(3)),
        WatchReconnectEffect::Ignored
    );
    assert_eq!(
        controller.target_closed(generation, first, WatchInstant::from_ticks(5)),
        WatchReconnectEffect::Activated(TargetGeneration::from_value_for_test(2))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Publish(2)));
}

#[test]
fn two_distinct_pending_candidates_fail_closed() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);

    assert_eq!(
        controller.observe_endpoint(endpoint('2'), WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Ignored
    );
    assert_eq!(
        controller.observe_endpoint(endpoint('3'), WatchInstant::from_ticks(3)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::AmbiguousPendingEndpoint
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn endpoint_before_close_grace_is_bounded() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);
    assert_eq!(
        controller.observe_endpoint(endpoint('2'), WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Ignored
    );

    assert_eq!(
        controller.deadline_elapsed(WatchInstant::from_ticks(8)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::EndpointBeforeCloseTimedOut
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn endpoint_before_close_path_rejects_non_monotonic_time() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);
    assert_eq!(
        controller.observe_endpoint(endpoint('2'), WatchInstant::from_ticks(5)),
        WatchReconnectEffect::Ignored
    );

    assert_eq!(
        controller.target_closed(
            TargetGeneration::from_value_for_test(1),
            first,
            WatchInstant::from_ticks(4)
        ),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::Coordinator(WatchGenerationFailure::NonMonotonicTime)
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn duplicate_current_endpoints_are_ignored_but_rate_storm_fails_closed() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 3, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);

    for tick in 2..=3 {
        assert_eq!(
            controller.observe_endpoint(first.clone(), WatchInstant::from_ticks(tick)),
            WatchReconnectEffect::Ignored
        );
    }
    assert_eq!(
        controller.observe_endpoint(first, WatchInstant::from_ticks(4)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::Coordinator(WatchGenerationFailure::EndpointEventOverflow)
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn pending_candidate_duplicate_storm_is_bounded() {
    let first = endpoint('1');
    let second = endpoint('2');
    let (mut controller, events) =
        controller(20, 3, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);

    for tick in 2..=4 {
        assert_eq!(
            controller.observe_endpoint(second.clone(), WatchInstant::from_ticks(tick)),
            WatchReconnectEffect::Ignored
        );
    }
    assert_eq!(
        controller.observe_endpoint(second, WatchInstant::from_ticks(5)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::Coordinator(WatchGenerationFailure::EndpointEventOverflow)
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn replacement_timeout_supervisor_exit_and_cancel_are_terminal() {
    let first = endpoint('1');
    let (mut timed_out, timeout_events) =
        controller(3, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    let generation = seed(&mut timed_out, &first);
    assert_eq!(
        timed_out.target_closed(generation, first.clone(), WatchInstant::from_ticks(2)),
        WatchReconnectEffect::AwaitingReplacement(generation)
    );
    assert_eq!(
        timed_out.deadline_elapsed(WatchInstant::from_ticks(6)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::Coordinator(WatchGenerationFailure::ReplacementTimedOut)
        ))
    );
    assert_eq!(
        timeout_events
            .borrow()
            .iter()
            .filter(|event| **event == RecordedEvent::Terminate(1))
            .count(),
        1
    );

    let (mut exited, exit_events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut exited, &first);
    assert_eq!(
        exited.supervisor_exited(),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::SupervisorExited
        ))
    );
    assert_eq!(
        exit_events.borrow().last(),
        Some(&RecordedEvent::Terminate(1))
    );

    let (mut cancelled, cancel_events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut cancelled, &first);
    assert_eq!(
        cancelled.cancel(WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Cancelled)
    );
    assert_eq!(
        cancelled.supervisor_exited(),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Cancelled)
    );
    assert_eq!(
        cancel_events
            .borrow()
            .iter()
            .filter(|event| **event == RecordedEvent::Terminate(1))
            .count(),
        1
    );
}

#[test]
fn failed_or_stale_replay_and_publish_terminate_unpublished_target() {
    for (outcome, expected) in [
        (Err(()), WatchReconnectFailure::ReplayFailed),
        (
            Ok(WatchReplayOutcome::Stale),
            WatchReconnectFailure::StaleConnection,
        ),
    ] {
        let (mut controller, events) = controller(20, 8, 5, [4], [], [outcome], false);
        assert_eq!(
            controller.seed_initial(endpoint('1'), WatchInstant::from_ticks(1)),
            WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(expected))
        );
        assert_eq!(
            *events.borrow(),
            vec![
                RecordedEvent::Connect(PauseGenerationFloor::INITIAL),
                RecordedEvent::Replay(1),
                RecordedEvent::Terminate(1),
            ]
        );
    }

    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], true);
    assert_eq!(
        controller.seed_initial(endpoint('1'), WatchInstant::from_ticks(1)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::PublishFailed
        ))
    );
    assert_eq!(
        *events.borrow(),
        vec![
            RecordedEvent::Connect(PauseGenerationFloor::INITIAL),
            RecordedEvent::Replay(1),
            RecordedEvent::Publish(1),
            RecordedEvent::Terminate(1),
        ]
    );
}

#[test]
fn connect_failure_never_publishes_and_pause_floor_exhaustion_fails_closed() {
    let (mut connect_failed, connect_events) = controller(20, 8, 5, [], [true], [], false);
    assert_eq!(
        connect_failed.seed_initial(endpoint('1'), WatchInstant::from_ticks(1)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::ConnectFailed
        ))
    );
    assert_eq!(
        *connect_events.borrow(),
        vec![RecordedEvent::Connect(PauseGenerationFloor::INITIAL)]
    );

    let first = endpoint('1');
    let (mut exhausted, exhausted_events) = controller(
        20,
        8,
        5,
        [9_007_199_254_740_991],
        [],
        [Ok(WatchReplayOutcome::Applied)],
        false,
    );
    let generation = seed(&mut exhausted, &first);
    assert_eq!(
        exhausted.target_closed(generation, first, WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::PauseGenerationExhausted
        ))
    );
    assert_eq!(
        exhausted_events.borrow().last(),
        Some(&RecordedEvent::Terminate(1))
    );
}

#[test]
fn unavailable_pause_epoch_fails_closed_before_replacement() {
    let first = endpoint('1');
    let (mut controller, events) = controller(
        20,
        8,
        5,
        [u64::MAX],
        [],
        [Ok(WatchReplayOutcome::Applied)],
        false,
    );
    let generation = seed(&mut controller, &first);

    assert_eq!(
        controller.target_closed(generation, first, WatchInstant::from_ticks(2)),
        WatchReconnectEffect::Terminal(WatchReconnectTerminal::Failed(
            WatchReconnectFailure::PauseGenerationUnavailable
        ))
    );
    assert_eq!(events.borrow().last(), Some(&RecordedEvent::Terminate(1)));
}

#[test]
fn stale_close_is_ignored_without_disturbing_active_target() {
    let first = endpoint('1');
    let (mut controller, events) =
        controller(20, 8, 5, [4], [], [Ok(WatchReplayOutcome::Applied)], false);
    seed(&mut controller, &first);

    assert_eq!(
        controller.target_closed(
            TargetGeneration::from_value_for_test(2),
            first.clone(),
            WatchInstant::from_ticks(2)
        ),
        WatchReconnectEffect::Ignored
    );
    assert_eq!(
        controller.observe_endpoint(first, WatchInstant::from_ticks(3)),
        WatchReconnectEffect::Ignored
    );
    assert!(!events.borrow().contains(&RecordedEvent::Terminate(1)));
}
