use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

const RESTART_MAX_ATTEMPTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const RESTART_BASE_DELAY: Duration = Duration::from_secs(1);
const RESTART_MAX_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub struct RestartPolicy {
    max_attempts: usize,
    window: Duration,
    base_delay: Duration,
    attempts: Vec<Instant>,
}

impl RestartPolicy {
    pub fn new(max_attempts: usize, window: Duration, base_delay: Duration) -> Self {
        Self {
            max_attempts,
            window,
            base_delay,
            attempts: Vec::new(),
        }
    }

    fn prune(&mut self, now: Instant) {
        let window = self.window;
        self.attempts
            .retain(|attempt| now.saturating_duration_since(*attempt) < window);
    }

    pub(super) fn next_attempt_index(&mut self, now: Instant) -> usize {
        self.prune(now);
        self.attempts.len()
    }

    pub(super) fn should_restart(&mut self, now: Instant) -> bool {
        self.next_attempt_index(now) < self.max_attempts
    }

    pub(super) fn record_attempt(&mut self, now: Instant) {
        self.prune(now);
        self.attempts.push(now);
    }

    pub(super) fn backoff_delay(&self, attempt_index: usize) -> Duration {
        let Some(shift) = u32::try_from(attempt_index)
            .ok()
            .filter(|shift| *shift < u64::BITS)
        else {
            return RESTART_MAX_DELAY;
        };
        let factor = 1_u64 << shift;
        let base_millis = self.base_delay.as_millis() as u64;
        let delay = base_millis
            .checked_mul(factor)
            .map(Duration::from_millis)
            .unwrap_or(RESTART_MAX_DELAY);
        delay.min(RESTART_MAX_DELAY)
    }

    #[cfg(test)]
    pub(super) fn reset(&mut self) {
        self.attempts.clear();
    }

    pub(super) fn attempt_count(&self) -> usize {
        self.attempts.len()
    }
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self::new(RESTART_MAX_ATTEMPTS, RESTART_WINDOW, RESTART_BASE_DELAY)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RestartOutcome {
    Restart { delay: Duration },
    GiveUp,
}

#[allow(dead_code)]
pub(super) struct RestartDecision;

impl RestartDecision {
    #[allow(dead_code)]
    pub(super) fn for_shutdown(_policy: &RestartPolicy) -> bool {
        false
    }
}

pub struct RestartController {
    policy: Mutex<RestartPolicy>,
}

impl RestartController {
    pub fn new(policy: RestartPolicy) -> Self {
        Self {
            policy: Mutex::new(policy),
        }
    }

    pub(super) fn evaluate_crash(&self, stop_requested: bool) -> RestartOutcome {
        if stop_requested {
            return RestartOutcome::GiveUp;
        }

        let Ok(mut policy) = self.policy.lock() else {
            return RestartOutcome::GiveUp;
        };
        let now = Instant::now();
        if !policy.should_restart(now) {
            return RestartOutcome::GiveUp;
        }

        let attempt_index = policy.attempt_count();
        let delay = policy.backoff_delay(attempt_index);
        policy.record_attempt(now);
        RestartOutcome::Restart { delay }
    }
}

impl Default for RestartController {
    fn default() -> Self {
        Self::new(RestartPolicy::default())
    }
}
