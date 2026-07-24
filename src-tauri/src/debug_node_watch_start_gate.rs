use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StartGateState {
    Pending,
    Confirmed,
    Cancelled,
}

pub(crate) struct NativeNodeWatchStartGate {
    state: Mutex<StartGateState>,
    changed: Condvar,
    timeout: Duration,
}

impl NativeNodeWatchStartGate {
    pub(crate) fn pending(timeout: Duration) -> Result<Self, &'static str> {
        if timeout.is_zero() {
            return Err("native Node watch confirmation timeout must be positive");
        }
        Ok(Self {
            state: Mutex::new(StartGateState::Pending),
            changed: Condvar::new(),
            timeout,
        })
    }

    pub(crate) fn confirmed() -> Self {
        Self {
            state: Mutex::new(StartGateState::Confirmed),
            changed: Condvar::new(),
            timeout: Duration::from_secs(1),
        }
    }

    pub(crate) fn confirm(&self) -> Result<(), &'static str> {
        let mut state = lock_recover(&self.state);
        if *state != StartGateState::Pending {
            return Err("native Node watch start confirmation is stale");
        }
        *state = StartGateState::Confirmed;
        self.changed.notify_all();
        Ok(())
    }

    pub(crate) fn cancel(&self) {
        let mut state = lock_recover(&self.state);
        if *state == StartGateState::Pending {
            *state = StartGateState::Cancelled;
            self.changed.notify_all();
        }
    }

    pub(crate) fn wait_until_confirmed(&self, is_current: impl Fn() -> bool) -> Result<(), ()> {
        let deadline = Instant::now().checked_add(self.timeout).ok_or(())?;
        let mut state = lock_recover(&self.state);
        loop {
            match *state {
                StartGateState::Confirmed => return is_current().then_some(()).ok_or(()),
                StartGateState::Cancelled => return Err(()),
                StartGateState::Pending => {}
            }
            if !is_current() {
                *state = StartGateState::Cancelled;
                self.changed.notify_all();
                return Err(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                *state = StartGateState::Cancelled;
                self.changed.notify_all();
                return Err(());
            }
            let wait = remaining.min(Duration::from_millis(100));
            let (next, _) = self
                .changed
                .wait_timeout(state, wait)
                .unwrap_or_else(|error| error.into_inner());
            state = next;
        }
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn confirmation_is_single_use_and_unblocks_waiter() {
        let gate =
            Arc::new(NativeNodeWatchStartGate::pending(Duration::from_secs(1)).expect("gate"));
        let waiter = {
            let gate = Arc::clone(&gate);
            thread::spawn(move || gate.wait_until_confirmed(|| true))
        };
        gate.confirm().expect("confirm");
        assert!(gate.confirm().is_err());
        assert_eq!(waiter.join().expect("waiter"), Ok(()));
    }

    #[test]
    fn cancel_and_timeout_fail_closed() {
        let cancelled =
            NativeNodeWatchStartGate::pending(Duration::from_secs(1)).expect("cancelled gate");
        cancelled.cancel();
        assert_eq!(cancelled.wait_until_confirmed(|| true), Err(()));
        assert!(cancelled.confirm().is_err());

        let timeout =
            NativeNodeWatchStartGate::pending(Duration::from_millis(1)).expect("timeout gate");
        assert_eq!(timeout.wait_until_confirmed(|| true), Err(()));
        assert!(timeout.confirm().is_err());
    }
}
