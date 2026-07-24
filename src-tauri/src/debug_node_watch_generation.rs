use std::net::SocketAddr;

const MAX_REPLACEMENT_TIMEOUT_TICKS: u64 = 300_000;
const MAX_ENDPOINT_EVENTS: u16 = 64;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct WatchInstant(u64);

impl WatchInstant {
    pub(crate) const fn from_ticks(ticks: u64) -> Self {
        Self(ticks)
    }

    pub(crate) const fn checked_add(self, ticks: u64) -> Option<Self> {
        match self.0.checked_add(ticks) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TargetGeneration(u64);

impl TargetGeneration {
    pub(crate) const fn get(self) -> u64 {
        self.0
    }

    #[cfg(test)]
    pub(crate) const fn from_value_for_test(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InspectorEndpointFingerprint {
    authority: SocketAddr,
    uuid: String,
}

impl InspectorEndpointFingerprint {
    pub(crate) fn parse(authority: &str, uuid: &str) -> Result<Self, EndpointFingerprintError> {
        let authority = authority
            .parse::<SocketAddr>()
            .map_err(|_| EndpointFingerprintError::Authority)?;
        if authority.port() == 0
            || !matches!(
                authority.ip(),
                std::net::IpAddr::V4(address) if address.octets() == [127, 0, 0, 1]
            )
        {
            return Err(EndpointFingerprintError::Authority);
        }
        if !is_canonical_uuid(uuid) {
            return Err(EndpointFingerprintError::Uuid);
        }
        Ok(Self {
            authority,
            uuid: uuid.to_ascii_lowercase(),
        })
    }

    pub(crate) fn parse_ws_url(value: &str) -> Result<Self, EndpointFingerprintError> {
        let remainder = value
            .strip_prefix("ws://")
            .ok_or(EndpointFingerprintError::Scheme)?;
        let (authority, uuid) = remainder
            .split_once('/')
            .ok_or(EndpointFingerprintError::Uuid)?;
        if uuid.contains('/') {
            return Err(EndpointFingerprintError::Uuid);
        }
        Self::parse(authority, uuid)
    }

    #[allow(dead_code)] // Consumed by the internal CDP connector before its public watch wiring.
    pub(crate) fn web_socket_url(&self) -> String {
        format!("ws://{}/{}", self.authority, self.uuid)
    }
}

fn is_canonical_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EndpointFingerprintError {
    Authority,
    Scheme,
    Uuid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WatchGenerationPolicy {
    replacement_timeout_ticks: u64,
    maximum_endpoint_events: u16,
}

impl WatchGenerationPolicy {
    pub(crate) fn new(
        replacement_timeout_ticks: u64,
        maximum_endpoint_events: u16,
    ) -> Result<Self, WatchGenerationPolicyError> {
        if replacement_timeout_ticks == 0
            || replacement_timeout_ticks > MAX_REPLACEMENT_TIMEOUT_TICKS
        {
            return Err(WatchGenerationPolicyError::InvalidReplacementTimeout);
        }
        if maximum_endpoint_events == 0 || maximum_endpoint_events > MAX_ENDPOINT_EVENTS {
            return Err(WatchGenerationPolicyError::InvalidEndpointEventLimit);
        }
        Ok(Self {
            replacement_timeout_ticks,
            maximum_endpoint_events,
        })
    }

    pub(crate) const fn maximum_endpoint_events(self) -> u16 {
        self.maximum_endpoint_events
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchGenerationPolicyError {
    InvalidReplacementTimeout,
    InvalidEndpointEventLimit,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WatchGenerationEvent {
    EndpointObserved(InspectorEndpointFingerprint),
    TargetClosed {
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
    },
    DeadlineElapsed,
    Cancel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchGenerationFailure {
    AmbiguousActiveEndpoint,
    EndpointEventOverflow,
    EndpointMismatch,
    GenerationExhausted,
    NonMonotonicTime,
    ReplacementDeadlineExhausted,
    ReplacementTimedOut,
    UnexpectedEvent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchGenerationTerminal {
    Cancelled,
    Failed(WatchGenerationFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchGenerationEffect {
    Activated(TargetGeneration),
    AwaitingReplacement {
        closed_generation: TargetGeneration,
        deadline: WatchInstant,
    },
    DeadlinePending {
        deadline: WatchInstant,
    },
    IgnoredCurrentEndpoint(TargetGeneration),
    RejectedStaleGeneration {
        current: TargetGeneration,
        received: TargetGeneration,
    },
    Terminal(WatchGenerationTerminal),
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum WatchGenerationState {
    WaitingForInitial,
    Active {
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        endpoint_events: u16,
    },
    AwaitingReplacement {
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        deadline: WatchInstant,
        endpoint_events: u16,
    },
    Terminal(WatchGenerationTerminal),
}

/// Pure state owner for Node watch target replacement. Transport discovery and
/// CDP attachment stay outside this type; callers feed bounded, validated events.
pub(crate) struct WatchGenerationCoordinator {
    policy: WatchGenerationPolicy,
    state: WatchGenerationState,
    last_event_at: Option<WatchInstant>,
}

impl WatchGenerationCoordinator {
    pub(crate) fn new(policy: WatchGenerationPolicy) -> Self {
        Self {
            policy,
            state: WatchGenerationState::WaitingForInitial,
            last_event_at: None,
        }
    }

    pub(crate) fn handle(
        &mut self,
        event: WatchGenerationEvent,
        now: WatchInstant,
    ) -> WatchGenerationEffect {
        if let WatchGenerationState::Terminal(terminal) = self.state {
            return WatchGenerationEffect::Terminal(terminal);
        }
        if self.last_event_at.is_some_and(|last| now < last) {
            return self.fail(WatchGenerationFailure::NonMonotonicTime);
        }
        self.last_event_at = Some(now);

        if matches!(event, WatchGenerationEvent::Cancel) {
            return self.terminate(WatchGenerationTerminal::Cancelled);
        }
        if self.deadline_has_expired(now) {
            return self.fail(WatchGenerationFailure::ReplacementTimedOut);
        }

        match event {
            WatchGenerationEvent::EndpointObserved(endpoint) => {
                self.observe_endpoint(endpoint, now)
            }
            WatchGenerationEvent::TargetClosed {
                generation,
                endpoint,
            } => self.close_target(generation, endpoint, now),
            WatchGenerationEvent::DeadlineElapsed => self.deadline_elapsed(now),
            WatchGenerationEvent::Cancel => unreachable!("cancel is handled before state dispatch"),
        }
    }

    fn observe_endpoint(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchGenerationEffect {
        match self.state.clone() {
            WatchGenerationState::WaitingForInitial => {
                self.activate(TargetGeneration(1), endpoint, 1)
            }
            WatchGenerationState::Active {
                generation,
                endpoint: current,
                endpoint_events,
            } => {
                if current != endpoint {
                    return self.fail(WatchGenerationFailure::AmbiguousActiveEndpoint);
                }
                let Some(endpoint_events) = self.next_endpoint_event_count(endpoint_events) else {
                    return self.fail(WatchGenerationFailure::EndpointEventOverflow);
                };
                self.state = WatchGenerationState::Active {
                    generation,
                    endpoint,
                    endpoint_events,
                };
                WatchGenerationEffect::IgnoredCurrentEndpoint(generation)
            }
            WatchGenerationState::AwaitingReplacement {
                generation,
                endpoint: closed_endpoint,
                deadline,
                endpoint_events,
            } => {
                if now > deadline {
                    return self.fail(WatchGenerationFailure::ReplacementTimedOut);
                }
                let Some(endpoint_events) = self.next_endpoint_event_count(endpoint_events) else {
                    return self.fail(WatchGenerationFailure::EndpointEventOverflow);
                };
                if closed_endpoint == endpoint {
                    self.state = WatchGenerationState::AwaitingReplacement {
                        generation,
                        endpoint,
                        deadline,
                        endpoint_events,
                    };
                    return WatchGenerationEffect::IgnoredCurrentEndpoint(generation);
                }
                let Some(next_generation) = generation.0.checked_add(1) else {
                    return self.fail(WatchGenerationFailure::GenerationExhausted);
                };
                self.activate(TargetGeneration(next_generation), endpoint, endpoint_events)
            }
            WatchGenerationState::Terminal(_) => unreachable!("terminal state returned earlier"),
        }
    }

    fn close_target(
        &mut self,
        received_generation: TargetGeneration,
        received_endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchGenerationEffect {
        let WatchGenerationState::Active {
            generation,
            endpoint,
            ..
        } = &self.state
        else {
            return match &self.state {
                WatchGenerationState::AwaitingReplacement { generation, .. } => {
                    WatchGenerationEffect::RejectedStaleGeneration {
                        current: *generation,
                        received: received_generation,
                    }
                }
                WatchGenerationState::WaitingForInitial => {
                    self.fail(WatchGenerationFailure::UnexpectedEvent)
                }
                WatchGenerationState::Terminal(_) => unreachable!("terminal returned earlier"),
                WatchGenerationState::Active { .. } => unreachable!("matched above"),
            };
        };
        if received_generation != *generation {
            return WatchGenerationEffect::RejectedStaleGeneration {
                current: *generation,
                received: received_generation,
            };
        }
        if received_endpoint != *endpoint {
            return self.fail(WatchGenerationFailure::EndpointMismatch);
        }
        let Some(deadline_ticks) = now.0.checked_add(self.policy.replacement_timeout_ticks) else {
            return self.fail(WatchGenerationFailure::ReplacementDeadlineExhausted);
        };
        let generation = *generation;
        let endpoint = endpoint.clone();
        let deadline = WatchInstant(deadline_ticks);
        self.state = WatchGenerationState::AwaitingReplacement {
            generation,
            endpoint,
            deadline,
            endpoint_events: 0,
        };
        WatchGenerationEffect::AwaitingReplacement {
            closed_generation: generation,
            deadline,
        }
    }

    fn deadline_elapsed(&mut self, now: WatchInstant) -> WatchGenerationEffect {
        match &self.state {
            WatchGenerationState::AwaitingReplacement { deadline, .. } if now <= *deadline => {
                WatchGenerationEffect::DeadlinePending {
                    deadline: *deadline,
                }
            }
            WatchGenerationState::AwaitingReplacement { .. } => {
                self.fail(WatchGenerationFailure::ReplacementTimedOut)
            }
            WatchGenerationState::WaitingForInitial | WatchGenerationState::Active { .. } => {
                self.fail(WatchGenerationFailure::UnexpectedEvent)
            }
            WatchGenerationState::Terminal(_) => unreachable!("terminal returned earlier"),
        }
    }

    fn deadline_has_expired(&self, now: WatchInstant) -> bool {
        matches!(
            &self.state,
            WatchGenerationState::AwaitingReplacement { deadline, .. } if now > *deadline
        )
    }

    fn next_endpoint_event_count(&self, current: u16) -> Option<u16> {
        let next = current.checked_add(1)?;
        (next <= self.policy.maximum_endpoint_events).then_some(next)
    }

    fn activate(
        &mut self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        endpoint_events: u16,
    ) -> WatchGenerationEffect {
        self.state = WatchGenerationState::Active {
            generation,
            endpoint,
            endpoint_events,
        };
        WatchGenerationEffect::Activated(generation)
    }

    fn fail(&mut self, failure: WatchGenerationFailure) -> WatchGenerationEffect {
        self.terminate(WatchGenerationTerminal::Failed(failure))
    }

    fn terminate(&mut self, terminal: WatchGenerationTerminal) -> WatchGenerationEffect {
        self.state = WatchGenerationState::Terminal(terminal);
        WatchGenerationEffect::Terminal(terminal)
    }

    #[cfg(test)]
    fn force_active_generation_for_test(
        &mut self,
        generation: u64,
        endpoint: InspectorEndpointFingerprint,
    ) {
        self.state = WatchGenerationState::Active {
            generation: TargetGeneration(generation),
            endpoint,
            endpoint_events: 1,
        };
    }
}

#[cfg(test)]
#[path = "debug_node_watch_generation_tests.rs"]
mod tests;
