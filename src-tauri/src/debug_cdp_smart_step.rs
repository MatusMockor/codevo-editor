use std::time::{Duration, Instant};

pub(crate) const MAX_SMART_STEP_HOPS: u16 = 256;
pub(crate) const MAX_SMART_STEP_DURATION: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SmartStepDirection {
    Over,
    Into,
    Out,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct StepLease {
    deadline: Instant,
    direction: SmartStepDirection,
    expected_pause_epoch: u64,
    hops: u16,
    internal: bool,
    policy_generation: u64,
    resumed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StepPolicy {
    Disabled,
    Idle { policy_generation: u64 },
    UserStep { lease: StepLease, request_id: u64 },
    InternalRequest { lease: StepLease, request_id: u64 },
    AwaitingPause { lease: StepLease },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct StepRequestReceipt {
    policy_generation: u64,
    request_id: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct HiddenStepRequest {
    pub(crate) direction: SmartStepDirection,
    pub(crate) request_id: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StepPolicyExpiry {
    NotExpired,
    CancelSilently,
    SurfaceHiddenPause,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SmartStepPauseFacts {
    pub(crate) explicit_pause_requested: bool,
    pub(crate) first_pause_seen: bool,
    pub(crate) has_hit_breakpoints: bool,
    pub(crate) has_internal_action: bool,
    pub(crate) has_restart_frame: bool,
    pub(crate) has_startup_validation: bool,
    pub(crate) reason_is_step: bool,
}

pub(crate) fn pause_may_be_hidden(facts: SmartStepPauseFacts) -> bool {
    facts.reason_is_step
        && !facts.has_hit_breakpoints
        && !facts.explicit_pause_requested
        && !facts.has_internal_action
        && !facts.has_restart_frame
        && !facts.has_startup_validation
        && facts.first_pause_seen
}

impl StepPolicy {
    pub(crate) fn new(enabled: bool) -> Self {
        if enabled {
            Self::Idle {
                policy_generation: 0,
            }
        } else {
            Self::Disabled
        }
    }

    pub(crate) fn begin_user_step(
        &mut self,
        direction: SmartStepDirection,
        origin_pause_epoch: u64,
        request_id: u64,
        now: Instant,
    ) -> Option<StepRequestReceipt> {
        let generation = match *self {
            Self::Disabled => return None,
            Self::Idle { policy_generation }
            | Self::UserStep {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::InternalRequest {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::AwaitingPause {
                lease: StepLease {
                    policy_generation, ..
                },
            } => policy_generation.checked_add(1)?,
        };
        let lease = StepLease {
            deadline: now + MAX_SMART_STEP_DURATION,
            direction,
            expected_pause_epoch: origin_pause_epoch.checked_add(1)?,
            hops: 0,
            internal: false,
            policy_generation: generation,
            resumed: false,
        };
        *self = Self::UserStep { lease, request_id };
        Some(StepRequestReceipt {
            policy_generation: generation,
            request_id,
        })
    }

    pub(crate) fn confirm_user_request(
        &mut self,
        receipt: StepRequestReceipt,
        now: Instant,
    ) -> bool {
        let Self::UserStep { lease, request_id } = *self else {
            return false;
        };
        if lease.policy_generation != receipt.policy_generation || request_id != receipt.request_id
        {
            return false;
        }
        if lease.deadline <= now {
            self.cancel();
            return false;
        }
        *self = Self::AwaitingPause { lease };
        true
    }

    pub(crate) fn reject_user_request(&mut self, receipt: StepRequestReceipt) {
        if matches!(
            *self,
            Self::UserStep {
                lease: StepLease {
                    policy_generation,
                    ..
                },
                request_id,
            } if policy_generation == receipt.policy_generation && request_id == receipt.request_id
        ) {
            self.cancel();
        }
    }

    /// Returns true only for an internal smart-step resume that must stay hidden.
    pub(crate) fn observe_resumed(&mut self) -> bool {
        match self {
            Self::UserStep { lease, .. } => {
                // CDP may publish Debugger.resumed before the matching command
                // response. Preserve the exact request receipt and keep this
                // user-visible resume event.
                lease.resumed = true;
                false
            }
            Self::InternalRequest { lease, .. } => {
                // The hidden pause was never published. Preserve the exact
                // request across event/response reordering and hide its resume.
                lease.resumed = true;
                true
            }
            Self::AwaitingPause { lease } => {
                lease.resumed = true;
                lease.internal
            }
            Self::Disabled | Self::Idle { .. } => false,
        }
    }

    pub(crate) fn begin_hidden_step(
        &mut self,
        pause_epoch: u64,
        request_id: u64,
        now: Instant,
    ) -> Option<HiddenStepRequest> {
        let Self::AwaitingPause { lease } = *self else {
            self.cancel();
            return None;
        };
        if !lease.resumed
            || lease.expected_pause_epoch != pause_epoch
            || lease.deadline <= now
            || lease.hops >= MAX_SMART_STEP_HOPS
        {
            self.cancel();
            return None;
        }
        let next = StepLease {
            expected_pause_epoch: pause_epoch.checked_add(1)?,
            hops: lease.hops.checked_add(1)?,
            internal: true,
            resumed: false,
            ..lease
        };
        *self = Self::InternalRequest {
            lease: next,
            request_id,
        };
        Some(HiddenStepRequest {
            direction: lease.direction,
            request_id,
        })
    }

    pub(crate) fn confirm_internal_request(&mut self, request_id: u64, now: Instant) -> bool {
        let Self::InternalRequest {
            lease,
            request_id: expected,
        } = *self
        else {
            return false;
        };
        if request_id != expected || lease.deadline <= now {
            return false;
        }
        *self = Self::AwaitingPause { lease };
        true
    }

    pub(crate) fn reject_internal_request(&mut self, request_id: u64) -> Option<StepPolicyExpiry> {
        let Self::InternalRequest {
            lease,
            request_id: expected,
        } = *self
        else {
            return None;
        };
        if request_id != expected {
            return None;
        }
        let disposition = if lease.resumed {
            StepPolicyExpiry::CancelSilently
        } else {
            StepPolicyExpiry::SurfaceHiddenPause
        };
        self.cancel();
        Some(disposition)
    }

    pub(crate) fn is_internal_request(&self, request_id: u64) -> bool {
        matches!(
            self,
            Self::InternalRequest {
                request_id: expected,
                ..
            } if *expected == request_id
        )
    }

    pub(crate) fn user_request_receipt(&self, request_id: u64) -> Option<StepRequestReceipt> {
        match self {
            Self::UserStep {
                lease,
                request_id: expected,
            } if *expected == request_id => Some(StepRequestReceipt {
                policy_generation: lease.policy_generation,
                request_id,
            }),
            _ => None,
        }
    }

    pub(crate) fn can_consider_pause(&self, pause_epoch: u64, now: Instant) -> bool {
        matches!(
            self,
            Self::AwaitingPause {
                lease:
                    StepLease {
                        expected_pause_epoch,
                        resumed: true,
                        deadline,
                        ..
                    }
            } if *expected_pause_epoch == pause_epoch && *deadline > now
        )
    }

    pub(crate) fn expiry(&self, now: Instant) -> StepPolicyExpiry {
        let lease = match self {
            Self::UserStep { lease, .. }
            | Self::InternalRequest { lease, .. }
            | Self::AwaitingPause { lease } => lease,
            Self::Disabled | Self::Idle { .. } => return StepPolicyExpiry::NotExpired,
        };
        if lease.deadline > now {
            return StepPolicyExpiry::NotExpired;
        }
        if lease.internal && !lease.resumed {
            StepPolicyExpiry::SurfaceHiddenPause
        } else {
            StepPolicyExpiry::CancelSilently
        }
    }

    pub(crate) fn cancel(&mut self) {
        let generation = match *self {
            Self::Disabled => return,
            Self::Idle { policy_generation }
            | Self::UserStep {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::InternalRequest {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::AwaitingPause {
                lease: StepLease {
                    policy_generation, ..
                },
            } => policy_generation,
        };
        *self = Self::Idle {
            policy_generation: generation,
        };
    }

    pub(crate) fn is_active(&self) -> bool {
        matches!(
            self,
            Self::UserStep { .. } | Self::InternalRequest { .. } | Self::AwaitingPause { .. }
        )
    }

    #[cfg(test)]
    pub(crate) fn expire_now_for_test(&mut self) {
        let deadline = Instant::now();
        match self {
            Self::UserStep { lease, .. }
            | Self::InternalRequest { lease, .. }
            | Self::AwaitingPause { lease } => lease.deadline = deadline,
            Self::Disabled | Self::Idle { .. } => {}
        }
    }

    #[cfg(test)]
    fn generation(&self) -> Option<u64> {
        match *self {
            Self::Disabled => None,
            Self::Idle { policy_generation }
            | Self::UserStep {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::InternalRequest {
                lease: StepLease {
                    policy_generation, ..
                },
                ..
            }
            | Self::AwaitingPause {
                lease: StepLease {
                    policy_generation, ..
                },
            } => Some(policy_generation),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_policy_never_arms() {
        let now = Instant::now();
        let mut policy = StepPolicy::new(false);
        assert_eq!(
            policy.begin_user_step(SmartStepDirection::Over, 4, 1, now),
            None
        );
        assert_eq!(policy, StepPolicy::Disabled);
    }

    #[test]
    fn exact_request_resume_and_pause_receipts_are_required() {
        let now = Instant::now();
        let mut policy = StepPolicy::new(true);
        let receipt = policy
            .begin_user_step(SmartStepDirection::Into, 7, 11, now)
            .expect("receipt");
        assert!(!policy.can_consider_pause(8, now));
        assert!(policy.confirm_user_request(receipt, now));
        assert!(!policy.can_consider_pause(8, now));
        assert!(!policy.observe_resumed());
        assert!(!policy.can_consider_pause(7, now));
        assert!(policy.can_consider_pause(8, now));
        let hidden = policy
            .begin_hidden_step(8, 41, now)
            .expect("hidden request");
        assert_eq!(hidden.direction, SmartStepDirection::Into);
        assert!(!policy.confirm_internal_request(42, now));
        assert!(policy.confirm_internal_request(41, now));
        assert!(policy.observe_resumed());
        assert!(policy.can_consider_pause(9, now));
    }

    #[test]
    fn replacement_invalidates_old_receipts_and_timeout_or_cap_surfaces() {
        let now = Instant::now();
        let mut policy = StepPolicy::new(true);
        let old = policy
            .begin_user_step(SmartStepDirection::Over, 1, 1, now)
            .expect("old");
        let fresh = policy
            .begin_user_step(SmartStepDirection::Out, 9, 2, now)
            .expect("fresh");
        assert!(!policy.confirm_user_request(old, now));
        assert!(policy.confirm_user_request(fresh, now));
        assert!(!policy.observe_resumed());
        assert!(!policy.can_consider_pause(10, now + MAX_SMART_STEP_DURATION));
        assert_eq!(policy.generation(), Some(2));

        let mut capped = StepPolicy::new(true);
        let receipt = capped
            .begin_user_step(SmartStepDirection::Over, 0, 3, now)
            .expect("receipt");
        assert!(capped.confirm_user_request(receipt, now));
        assert!(!capped.observe_resumed());
        for hop in 0..MAX_SMART_STEP_HOPS {
            let request = capped
                .begin_hidden_step(u64::from(hop) + 1, u64::from(hop) + 1, now)
                .expect("within cap");
            assert!(capped.confirm_internal_request(request.request_id, now));
            assert!(capped.observe_resumed());
        }
        assert!(capped
            .begin_hidden_step(u64::from(MAX_SMART_STEP_HOPS) + 1, 999, now)
            .is_none());
    }

    #[test]
    fn response_and_resumed_reordering_preserves_the_exact_step_chain() {
        let now = Instant::now();
        let mut user = StepPolicy::new(true);
        let receipt = user
            .begin_user_step(SmartStepDirection::Over, 1, 5, now)
            .expect("receipt");
        assert!(!user.observe_resumed());
        assert!(user.confirm_user_request(receipt, now));
        assert!(user.can_consider_pause(2, now));

        let mut internal = StepPolicy::new(true);
        let receipt = internal
            .begin_user_step(SmartStepDirection::Into, 1, 6, now)
            .expect("receipt");
        assert!(internal.confirm_user_request(receipt, now));
        assert!(!internal.observe_resumed());
        let hidden = internal.begin_hidden_step(2, 7, now).expect("hidden");
        assert_eq!(hidden.request_id, 7);
        assert!(internal.observe_resumed());
        assert!(internal.confirm_internal_request(7, now));
        assert!(internal.can_consider_pause(3, now));
    }

    #[test]
    fn expiry_surfaces_only_a_hidden_pause_while_the_target_is_still_paused() {
        let now = Instant::now();
        let expired = now + MAX_SMART_STEP_DURATION;
        let mut policy = StepPolicy::new(true);
        let receipt = policy
            .begin_user_step(SmartStepDirection::Over, 1, 5, now)
            .expect("receipt");
        assert_eq!(policy.expiry(expired), StepPolicyExpiry::CancelSilently);
        assert!(policy.confirm_user_request(receipt, now));
        assert!(!policy.observe_resumed());
        let hidden = policy.begin_hidden_step(2, 6, now).expect("hidden");
        assert_eq!(policy.expiry(expired), StepPolicyExpiry::SurfaceHiddenPause);
        assert!(policy.confirm_internal_request(hidden.request_id, now));
        assert_eq!(policy.expiry(expired), StepPolicyExpiry::SurfaceHiddenPause);
        assert!(policy.observe_resumed());
        assert_eq!(policy.expiry(expired), StepPolicyExpiry::CancelSilently);
    }

    #[test]
    fn internal_error_surfaces_only_before_a_resume_was_observed() {
        let now = Instant::now();
        let mut paused = StepPolicy::new(true);
        let receipt = paused
            .begin_user_step(SmartStepDirection::Over, 1, 5, now)
            .expect("receipt");
        assert!(paused.confirm_user_request(receipt, now));
        assert!(!paused.observe_resumed());
        let hidden = paused.begin_hidden_step(2, 6, now).expect("hidden");
        assert_eq!(
            paused.reject_internal_request(hidden.request_id),
            Some(StepPolicyExpiry::SurfaceHiddenPause)
        );

        let mut running = StepPolicy::new(true);
        let receipt = running
            .begin_user_step(SmartStepDirection::Over, 1, 7, now)
            .expect("receipt");
        assert!(running.confirm_user_request(receipt, now));
        assert!(!running.observe_resumed());
        let hidden = running.begin_hidden_step(2, 8, now).expect("hidden");
        assert!(running.observe_resumed());
        assert_eq!(
            running.reject_internal_request(hidden.request_id),
            Some(StepPolicyExpiry::CancelSilently)
        );
    }

    #[test]
    fn only_an_unprotected_step_pause_is_a_smart_step_candidate() {
        let eligible = SmartStepPauseFacts {
            explicit_pause_requested: false,
            first_pause_seen: true,
            has_hit_breakpoints: false,
            has_internal_action: false,
            has_restart_frame: false,
            has_startup_validation: false,
            reason_is_step: true,
        };
        assert!(pause_may_be_hidden(eligible));
        for protected in [
            SmartStepPauseFacts {
                reason_is_step: false,
                ..eligible
            },
            SmartStepPauseFacts {
                has_hit_breakpoints: true,
                ..eligible
            },
            SmartStepPauseFacts {
                explicit_pause_requested: true,
                ..eligible
            },
            SmartStepPauseFacts {
                has_internal_action: true,
                ..eligible
            },
            SmartStepPauseFacts {
                has_restart_frame: true,
                ..eligible
            },
            SmartStepPauseFacts {
                has_startup_validation: true,
                ..eligible
            },
            SmartStepPauseFacts {
                first_pause_seen: false,
                ..eligible
            },
        ] {
            assert!(!pause_may_be_hidden(protected));
        }
    }
}
