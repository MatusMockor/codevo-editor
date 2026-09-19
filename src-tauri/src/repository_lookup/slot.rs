use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::clock::Clock;
use super::process_guard::ProcessKillSwitch;

pub(crate) const SUPERSEDE_WAIT: Duration = Duration::from_secs(30);
pub(crate) const MIN_SPAWN_INTERVAL: Duration = Duration::from_millis(250);

pub(crate) struct ProviderSlot {
    clock: Arc<dyn Clock>,
    min_spawn_interval: Duration,
    state: Mutex<SlotState>,
    settled: Condvar,
}

#[derive(Default)]
struct SlotState {
    next_generation: u64,
    running: Option<RunningJob>,
    waiting: bool,
    last_started: Option<Instant>,
}

struct RunningJob {
    generation: u64,
    cancelled: Arc<AtomicBool>,
    kill: Arc<ProcessKillSwitch>,
}

pub(crate) struct SlotLease<'a> {
    slot: &'a ProviderSlot,
    generation: u64,
    cancelled: Arc<AtomicBool>,
    kill: Arc<ProcessKillSwitch>,
}

impl SlotLease<'_> {
    pub(crate) fn kill_switch(&self) -> &ProcessKillSwitch {
        &self.kill
    }

    pub(crate) fn superseded(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

impl Drop for SlotLease<'_> {
    fn drop(&mut self) {
        let mut state = self.slot.lock();
        if state
            .running
            .as_ref()
            .is_some_and(|running| running.generation == self.generation)
        {
            state.running = None;
        }
        drop(state);
        self.slot.settled.notify_all();
    }
}

impl ProviderSlot {
    pub(crate) fn new(clock: Arc<dyn Clock>, min_spawn_interval: Duration) -> Self {
        Self {
            clock,
            min_spawn_interval,
            state: Mutex::new(SlotState::default()),
            settled: Condvar::new(),
        }
    }

    pub(crate) fn acquire(&self) -> Option<SlotLease<'_>> {
        let state = self.lock();
        if state.waiting {
            return None;
        }
        if state.running.is_none() && self.remaining_interval(&state).is_zero() {
            return Some(self.start(state));
        }
        self.admit_as_waiter(state)
    }

    pub(crate) fn try_acquire(&self) -> Option<SlotLease<'_>> {
        let state = self.lock();
        if state.waiting || state.running.is_some() {
            return None;
        }
        if !self.remaining_interval(&state).is_zero() {
            return None;
        }
        Some(self.start(state))
    }

    fn admit_as_waiter<'a>(
        &'a self,
        mut state: MutexGuard<'a, SlotState>,
    ) -> Option<SlotLease<'a>> {
        state.waiting = true;
        let state = self.await_spawn_interval(state);
        let (mut state, settled) = self.supersede_running(state);
        state.waiting = false;
        if !settled {
            drop(state);
            self.settled.notify_all();
            return None;
        }
        Some(self.start(state))
    }

    fn remaining_interval(&self, state: &SlotState) -> Duration {
        let Some(last) = state.last_started else {
            return Duration::ZERO;
        };
        self.min_spawn_interval
            .saturating_sub(self.clock.now().saturating_duration_since(last))
    }

    fn await_spawn_interval<'a>(
        &'a self,
        mut state: MutexGuard<'a, SlotState>,
    ) -> MutexGuard<'a, SlotState> {
        let deadline = Instant::now() + self.min_spawn_interval;
        loop {
            let remaining = self
                .remaining_interval(&state)
                .min(deadline.saturating_duration_since(Instant::now()));
            if remaining.is_zero() {
                return state;
            }
            let (guard, _) = self
                .settled
                .wait_timeout(state, remaining)
                .unwrap_or_else(PoisonError::into_inner);
            state = guard;
        }
    }

    fn supersede_running<'a>(
        &'a self,
        state: MutexGuard<'a, SlotState>,
    ) -> (MutexGuard<'a, SlotState>, bool) {
        let Some(running) = state.running.as_ref() else {
            return (state, true);
        };
        running.cancelled.store(true, Ordering::SeqCst);
        let kill = Arc::clone(&running.kill);
        drop(state);
        kill.kill();
        self.await_release()
    }

    fn await_release(&self) -> (MutexGuard<'_, SlotState>, bool) {
        let deadline = Instant::now() + SUPERSEDE_WAIT;
        let mut state = self.lock();
        while state.running.is_some() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return (state, false);
            }
            let (guard, _) = self
                .settled
                .wait_timeout(state, remaining)
                .unwrap_or_else(PoisonError::into_inner);
            state = guard;
        }
        (state, true)
    }

    fn start<'a>(&'a self, mut state: MutexGuard<'a, SlotState>) -> SlotLease<'a> {
        let generation = state.next_generation;
        state.next_generation = generation.wrapping_add(1);
        state.last_started = Some(self.clock.now());
        let cancelled = Arc::new(AtomicBool::new(false));
        let kill = Arc::new(ProcessKillSwitch::default());
        state.running = Some(RunningJob {
            generation,
            cancelled: Arc::clone(&cancelled),
            kill: Arc::clone(&kill),
        });
        SlotLease {
            slot: self,
            generation,
            cancelled,
            kill,
        }
    }

    #[cfg(test)]
    pub(super) fn has_waiter(&self) -> bool {
        self.lock().waiting
    }

    fn lock(&self) -> MutexGuard<'_, SlotState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
