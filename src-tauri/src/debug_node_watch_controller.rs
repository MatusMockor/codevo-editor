use super::watch_generation::{
    InspectorEndpointFingerprint, TargetGeneration, WatchGenerationCoordinator,
    WatchGenerationEffect, WatchGenerationEvent, WatchGenerationFailure, WatchGenerationPolicy,
    WatchGenerationTerminal, WatchInstant,
};
use crate::debug_cdp::transport::PauseGenerationFloor;

const MAX_ENDPOINT_BEFORE_CLOSE_GRACE_TICKS: u64 = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WatchReconnectPolicy {
    endpoint_before_close_grace_ticks: u64,
}

impl WatchReconnectPolicy {
    pub(crate) fn new(endpoint_before_close_grace_ticks: u64) -> Result<Self, &'static str> {
        if endpoint_before_close_grace_ticks == 0
            || endpoint_before_close_grace_ticks > MAX_ENDPOINT_BEFORE_CLOSE_GRACE_TICKS
        {
            return Err("invalid endpoint-before-close grace");
        }
        Ok(Self {
            endpoint_before_close_grace_ticks,
        })
    }
}

pub(crate) trait WatchTargetHandle {
    fn pause_generation_epoch(&self) -> Result<u64, ()>;
    fn terminate(&mut self);
}

pub(crate) trait WatchTargetConnector {
    type Target: WatchTargetHandle;

    fn connect(
        &mut self,
        generation: TargetGeneration,
        endpoint: &InspectorEndpointFingerprint,
        pause_generation_floor: PauseGenerationFloor,
    ) -> Result<Self::Target, ()>;
}

pub(crate) trait WatchTargetReplay<Target> {
    fn replay(&mut self, target: &mut Target) -> Result<WatchReplayOutcome, ()>;
}

pub(crate) trait WatchTargetPublisher<Target> {
    fn publish(&mut self, generation: TargetGeneration, target: &mut Target) -> Result<(), ()>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchReplayOutcome {
    Applied,
    Stale,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchReconnectFailure {
    AmbiguousPendingEndpoint,
    ConnectFailed,
    Coordinator(WatchGenerationFailure),
    EndpointBeforeCloseTimedOut,
    PauseGenerationExhausted,
    PauseGenerationUnavailable,
    PublishFailed,
    ReplayFailed,
    StaleConnection,
    SupervisorExited,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchReconnectTerminal {
    Cancelled,
    Failed(WatchReconnectFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchReconnectEffect {
    Activated(TargetGeneration),
    AwaitingReplacement(TargetGeneration),
    Ignored,
    Terminal(WatchReconnectTerminal),
}

struct ActiveTarget<Target> {
    endpoint: InspectorEndpointFingerprint,
    generation: TargetGeneration,
    target: Target,
}

struct PendingEndpoint {
    endpoint: InspectorEndpointFingerprint,
    deadline: WatchInstant,
}

/// Internal lifecycle owner for one logical native Node watch session.
///
/// The controller deliberately has no command or launch-surface integration.
/// Real process, CDP, desired-state and event-gate adapters can implement the
/// narrow traits once their contracts settle.
pub(crate) struct WatchReconnectController<Connector, Replay, Publisher>
where
    Connector: WatchTargetConnector,
    Replay: WatchTargetReplay<Connector::Target>,
    Publisher: WatchTargetPublisher<Connector::Target>,
{
    coordinator: WatchGenerationCoordinator,
    reconnect_policy: WatchReconnectPolicy,
    connector: Connector,
    replay: Replay,
    publisher: Publisher,
    active: Option<ActiveTarget<Connector::Target>>,
    pending_endpoint: Option<PendingEndpoint>,
    pending_endpoint_events: u16,
    maximum_endpoint_events: u16,
    replacement_floor: Option<PauseGenerationFloor>,
    seeded: bool,
    last_event_at: Option<WatchInstant>,
    terminal: Option<WatchReconnectTerminal>,
}

impl<Connector, Replay, Publisher> WatchReconnectController<Connector, Replay, Publisher>
where
    Connector: WatchTargetConnector,
    Replay: WatchTargetReplay<Connector::Target>,
    Publisher: WatchTargetPublisher<Connector::Target>,
{
    pub(crate) fn new(
        generation_policy: WatchGenerationPolicy,
        reconnect_policy: WatchReconnectPolicy,
        connector: Connector,
        replay: Replay,
        publisher: Publisher,
    ) -> Self {
        let maximum_endpoint_events = generation_policy.maximum_endpoint_events();
        Self {
            coordinator: WatchGenerationCoordinator::new(generation_policy),
            reconnect_policy,
            connector,
            replay,
            publisher,
            active: None,
            pending_endpoint: None,
            pending_endpoint_events: 0,
            maximum_endpoint_events,
            replacement_floor: None,
            seeded: false,
            last_event_at: None,
            terminal: None,
        }
    }

    pub(crate) fn seed_initial(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        if let Some(effect) = self.reject_if_terminal() {
            return effect;
        }
        if self.seeded {
            return self.fail(WatchReconnectFailure::Coordinator(
                WatchGenerationFailure::UnexpectedEvent,
            ));
        }
        self.seeded = true;
        self.last_event_at = Some(now);
        let effect = self.coordinator.handle(
            WatchGenerationEvent::EndpointObserved(endpoint.clone()),
            now,
        );
        self.activate_from_effect(effect, endpoint, PauseGenerationFloor::INITIAL)
    }

    pub(crate) fn observe_endpoint(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        if let Some(effect) = self.before_event(now) {
            return effect;
        }
        if !self.seeded {
            return self.fail(WatchReconnectFailure::Coordinator(
                WatchGenerationFailure::UnexpectedEvent,
            ));
        }
        if let Some(active) = self.active.as_ref() {
            if active.endpoint == endpoint {
                let effect = self
                    .coordinator
                    .handle(WatchGenerationEvent::EndpointObserved(endpoint), now);
                return self.map_coordinator(effect);
            }
            return self.buffer_endpoint_before_close(endpoint, now);
        }
        let Some(floor) = self.replacement_floor else {
            return self.fail(WatchReconnectFailure::Coordinator(
                WatchGenerationFailure::UnexpectedEvent,
            ));
        };
        let effect = self.coordinator.handle(
            WatchGenerationEvent::EndpointObserved(endpoint.clone()),
            now,
        );
        self.activate_from_effect(effect, endpoint, floor)
    }

    pub(crate) fn target_closed(
        &mut self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        if let Some(effect) = self.before_event(now) {
            return effect;
        }
        let Some(active) = self.active.as_ref() else {
            let effect = self.coordinator.handle(
                WatchGenerationEvent::TargetClosed {
                    generation,
                    endpoint,
                },
                now,
            );
            return self.map_coordinator(effect);
        };
        if active.generation != generation || active.endpoint != endpoint {
            let effect = self.coordinator.handle(
                WatchGenerationEvent::TargetClosed {
                    generation,
                    endpoint,
                },
                now,
            );
            return self.map_coordinator(effect);
        }
        let pause_generation_epoch = match active.target.pause_generation_epoch() {
            Ok(epoch) => epoch,
            Err(()) => return self.fail(WatchReconnectFailure::PauseGenerationUnavailable),
        };
        let floor = match PauseGenerationFloor::try_from_epoch(pause_generation_epoch) {
            Ok(floor) => floor,
            Err(_) => return self.fail(WatchReconnectFailure::PauseGenerationExhausted),
        };
        let effect = self.coordinator.handle(
            WatchGenerationEvent::TargetClosed {
                generation,
                endpoint,
            },
            now,
        );
        if !matches!(effect, WatchGenerationEffect::AwaitingReplacement { .. }) {
            return self.map_coordinator(effect);
        }
        if let Some(mut active) = self.active.take() {
            active.target.terminate();
        }
        self.replacement_floor = Some(floor);

        if let Some(pending) = self.pending_endpoint.take() {
            let activation = self.coordinator.handle(
                WatchGenerationEvent::EndpointObserved(pending.endpoint.clone()),
                now,
            );
            return self.activate_from_effect(activation, pending.endpoint, floor);
        }
        WatchReconnectEffect::AwaitingReplacement(generation)
    }

    pub(crate) fn deadline_elapsed(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        if let Some(effect) = self.before_event(now) {
            return effect;
        }
        if self.active.is_some() {
            return WatchReconnectEffect::Ignored;
        }
        let effect = self
            .coordinator
            .handle(WatchGenerationEvent::DeadlineElapsed, now);
        self.map_coordinator(effect)
    }

    pub(crate) fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        if let Some(effect) = self.reject_if_terminal() {
            return effect;
        }
        self.fail(WatchReconnectFailure::SupervisorExited)
    }

    pub(crate) fn cancel(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        if let Some(effect) = self.reject_if_terminal() {
            return effect;
        }
        let _ = self.coordinator.handle(WatchGenerationEvent::Cancel, now);
        self.terminate(WatchReconnectTerminal::Cancelled)
    }

    fn buffer_endpoint_before_close(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        if let Some(pending) = self.pending_endpoint.as_ref() {
            let Some(next_count) = self.pending_endpoint_events.checked_add(1) else {
                return self.fail(WatchReconnectFailure::Coordinator(
                    WatchGenerationFailure::EndpointEventOverflow,
                ));
            };
            if next_count > self.maximum_endpoint_events {
                return self.fail(WatchReconnectFailure::Coordinator(
                    WatchGenerationFailure::EndpointEventOverflow,
                ));
            }
            self.pending_endpoint_events = next_count;
            if pending.endpoint == endpoint {
                return WatchReconnectEffect::Ignored;
            }
            return self.fail(WatchReconnectFailure::AmbiguousPendingEndpoint);
        }
        let Some(deadline) =
            now.checked_add(self.reconnect_policy.endpoint_before_close_grace_ticks)
        else {
            return self.fail(WatchReconnectFailure::EndpointBeforeCloseTimedOut);
        };
        self.pending_endpoint = Some(PendingEndpoint { endpoint, deadline });
        self.pending_endpoint_events = 1;
        WatchReconnectEffect::Ignored
    }

    fn activate_from_effect(
        &mut self,
        effect: WatchGenerationEffect,
        endpoint: InspectorEndpointFingerprint,
        floor: PauseGenerationFloor,
    ) -> WatchReconnectEffect {
        let WatchGenerationEffect::Activated(generation) = effect else {
            return self.map_coordinator(effect);
        };
        let mut target = match self.connector.connect(generation, &endpoint, floor) {
            Ok(target) => target,
            Err(()) => return self.fail(WatchReconnectFailure::ConnectFailed),
        };
        match self.replay.replay(&mut target) {
            Ok(WatchReplayOutcome::Applied) => {}
            Ok(WatchReplayOutcome::Stale) => {
                target.terminate();
                return self.fail(WatchReconnectFailure::StaleConnection);
            }
            Err(()) => {
                target.terminate();
                return self.fail(WatchReconnectFailure::ReplayFailed);
            }
        }
        self.active = Some(ActiveTarget {
            endpoint,
            generation,
            target,
        });
        let publish_result = self
            .active
            .as_mut()
            .ok_or(())
            .and_then(|active| self.publisher.publish(generation, &mut active.target));
        if publish_result.is_err() {
            if let Some(mut active) = self.active.take() {
                active.target.terminate();
            }
            return self.fail(WatchReconnectFailure::PublishFailed);
        }
        self.pending_endpoint = None;
        self.pending_endpoint_events = 0;
        self.replacement_floor = None;
        WatchReconnectEffect::Activated(generation)
    }

    fn before_event(&mut self, now: WatchInstant) -> Option<WatchReconnectEffect> {
        if let Some(effect) = self.reject_if_terminal() {
            return Some(effect);
        }
        if self.last_event_at.is_some_and(|last| now < last) {
            return Some(self.fail(WatchReconnectFailure::Coordinator(
                WatchGenerationFailure::NonMonotonicTime,
            )));
        }
        self.last_event_at = Some(now);
        if self
            .pending_endpoint
            .as_ref()
            .is_some_and(|pending| now > pending.deadline)
        {
            return Some(self.fail(WatchReconnectFailure::EndpointBeforeCloseTimedOut));
        }
        None
    }

    fn map_coordinator(&mut self, effect: WatchGenerationEffect) -> WatchReconnectEffect {
        match effect {
            WatchGenerationEffect::Activated(generation) => {
                WatchReconnectEffect::Activated(generation)
            }
            WatchGenerationEffect::AwaitingReplacement {
                closed_generation, ..
            } => WatchReconnectEffect::AwaitingReplacement(closed_generation),
            WatchGenerationEffect::DeadlinePending { .. }
            | WatchGenerationEffect::IgnoredCurrentEndpoint(_)
            | WatchGenerationEffect::RejectedStaleGeneration { .. } => {
                WatchReconnectEffect::Ignored
            }
            WatchGenerationEffect::Terminal(WatchGenerationTerminal::Cancelled) => {
                self.terminate(WatchReconnectTerminal::Cancelled)
            }
            WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(failure)) => self
                .terminate(WatchReconnectTerminal::Failed(
                    WatchReconnectFailure::Coordinator(failure),
                )),
        }
    }

    fn fail(&mut self, failure: WatchReconnectFailure) -> WatchReconnectEffect {
        self.terminate(WatchReconnectTerminal::Failed(failure))
    }

    fn terminate(&mut self, terminal: WatchReconnectTerminal) -> WatchReconnectEffect {
        if let Some(existing) = self.terminal {
            return WatchReconnectEffect::Terminal(existing);
        }
        if let Some(mut active) = self.active.take() {
            active.target.terminate();
        }
        self.pending_endpoint = None;
        self.pending_endpoint_events = 0;
        self.replacement_floor = None;
        self.terminal = Some(terminal);
        WatchReconnectEffect::Terminal(terminal)
    }

    fn reject_if_terminal(&self) -> Option<WatchReconnectEffect> {
        self.terminal.map(WatchReconnectEffect::Terminal)
    }
}

impl<Connector, Replay, Publisher> Drop for WatchReconnectController<Connector, Replay, Publisher>
where
    Connector: WatchTargetConnector,
    Replay: WatchTargetReplay<Connector::Target>,
    Publisher: WatchTargetPublisher<Connector::Target>,
{
    fn drop(&mut self) {
        if let Some(active) = self.active.as_mut() {
            active.target.terminate();
        }
    }
}

#[cfg(test)]
#[path = "debug_node_watch_controller_tests.rs"]
mod tests;
