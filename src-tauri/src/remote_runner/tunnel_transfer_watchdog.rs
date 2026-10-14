use super::{Failure, TransferPolicy, TIMED_OUT};
use std::time::{Duration, Instant};

pub(super) const TAIL_BYTES: u64 = 4 * 1024 * 1024;
pub(super) const SLOWEST_BYTES_PER_SECOND: u64 = 16 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Signals {
    pub(super) beats: u64,
    pub(super) waiting: bool,
    pub(super) sent: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Observed {
    pub(super) progressed: bool,
    pub(super) tail: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Expiry {
    pub(super) failure: Failure,
    pub(super) suspect: Option<Instant>,
}

pub(super) struct Watchdog {
    policy: TransferPolicy,
    length: u64,
    deadline: Instant,
    opened: Option<Instant>,
    last: Instant,
    beats: u64,
    local: Option<Instant>,
    tail: Option<Instant>,
}

impl Watchdog {
    pub(super) fn new(
        policy: TransferPolicy,
        length: u64,
        deadline: Instant,
        now: Instant,
    ) -> Self {
        Self {
            policy,
            length,
            deadline,
            opened: None,
            last: now,
            beats: 0,
            local: None,
            tail: None,
        }
    }

    pub(super) fn observe(&mut self, signals: Signals, now: Instant) -> Observed {
        let progressed = signals.beats != self.beats;
        self.beats = signals.beats;
        if progressed {
            self.last = now;
            self.opened.get_or_insert(now);
        }
        self.local = match (signals.waiting, self.local) {
            (false, None) => None,
            (false, Some(_)) => {
                self.last = now;
                None
            }
            (true, Some(since)) if !progressed => Some(since),
            (true, _) => Some(now),
        };
        let tail = signals.sent && self.tail.is_none();
        if tail {
            self.tail = Some(now + self.patience(now));
        }
        Observed { progressed, tail }
    }

    fn patience(&self, now: Instant) -> Duration {
        let pending = self.length.min(TAIL_BYTES);
        let drained = self.length - pending;
        let streamed = self.opened.map_or(Duration::ZERO, |opened| {
            now.saturating_duration_since(opened)
        });
        let observed = u128::from(drained) * 1_000 / streamed.as_millis().max(1);
        let slowest = u128::from(SLOWEST_BYTES_PER_SECOND);
        let rate = match drained {
            0 => slowest,
            _ => observed.max(slowest),
        };
        let needed = u128::from(pending) * 1_000 / rate;
        Duration::from_millis(u64::try_from(needed).unwrap_or(u64::MAX)).max(self.policy.idle)
    }

    fn transport_bound(&self) -> Instant {
        let idle = self.last + self.policy.idle;
        self.tail.map_or(idle, |tail| tail.max(idle))
    }

    pub(super) fn tail_until(&self) -> Option<Instant> {
        self.tail.map(|tail| tail.min(self.deadline))
    }

    pub(super) fn wake(&self) -> Instant {
        let bound = self
            .local
            .map_or_else(|| self.transport_bound(), |since| since + self.policy.local);
        bound.min(self.deadline)
    }

    pub(super) fn suspect(&self) -> Option<Instant> {
        match self.local {
            Some(_) => None,
            None => Some(self.last),
        }
    }

    pub(super) fn expired(&self, now: Instant) -> Option<Expiry> {
        if now < self.wake() {
            return None;
        }
        let timed_out = Expiry {
            failure: Failure::Transport(TIMED_OUT.into()),
            suspect: self.suspect(),
        };
        let Some(since) = self.local else {
            return Some(timed_out);
        };
        if now < since + self.policy.local {
            return Some(timed_out);
        }
        Some(Expiry {
            failure: Failure::Local,
            suspect: None,
        })
    }
}

#[cfg(test)]
#[path = "tunnel_transfer_watchdog_tests.rs"]
mod tests;
