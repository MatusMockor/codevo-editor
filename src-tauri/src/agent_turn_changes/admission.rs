use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

pub(super) struct Admission {
    state: Mutex<State>,
    changed: Condvar,
    max_active: usize,
    max_waiting: usize,
    timeout: Duration,
}

#[derive(Default)]
struct State {
    active: HashSet<String>,
    waiting: VecDeque<Waiting>,
}

struct Waiting {
    ticket: Arc<()>,
    root: String,
}

pub(super) struct Permit<'a> {
    admission: &'a Admission,
    root: String,
}

// Remove a queued request even if its waiting thread unwinds.
struct QueueEntry<'a> {
    admission: &'a Admission,
    ticket: Arc<()>,
}

impl Default for Admission {
    fn default() -> Self {
        Self {
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
            max_active: 2,
            max_waiting: 32,
            timeout: Duration::from_secs(30),
        }
    }
}

impl Admission {
    pub(super) fn acquire(&self, root: &str) -> Result<Permit<'_>, String> {
        let deadline = Instant::now() + self.timeout;
        // Declare before the lock so unwinding releases the mutex before cleanup.
        let entry = QueueEntry {
            admission: self,
            ticket: Arc::new(()),
        };
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.active.len() < self.max_active
            && !state.active.contains(root)
            && state
                .waiting
                .iter()
                .all(|waiting| state.active.contains(&waiting.root))
        {
            state.active.insert(root.to_owned());
            return Ok(Permit {
                admission: self,
                root: root.to_owned(),
            });
        }
        if state.waiting.len() >= self.max_waiting {
            return Err("The turn checkpoint queue is full. Try again shortly.".into());
        }
        state.waiting.push_back(Waiting {
            ticket: Arc::clone(&entry.ticket),
            root: root.to_owned(),
        });
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Timed out waiting to record turn changes.".into());
            }
            // The oldest eligible root wins. A busy root must not block other
            // projects, but requests for the same root retain their FIFO order.
            let eligible = state
                .waiting
                .iter()
                .position(|waiting| !state.active.contains(&waiting.root));
            if state.active.len() < self.max_active {
                if let Some(index) = eligible {
                    if Arc::ptr_eq(&state.waiting[index].ticket, &entry.ticket) {
                        state.waiting.remove(index);
                        state.active.insert(root.to_owned());
                        drop(state);
                        self.changed.notify_all();
                        return Ok(Permit {
                            admission: self,
                            root: root.to_owned(),
                        });
                    }
                }
            }
            state = self
                .changed
                .wait_timeout(state, remaining)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
    }
}

impl Drop for QueueEntry<'_> {
    fn drop(&mut self) {
        self.admission
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .waiting
            .retain(|waiting| !Arc::ptr_eq(&waiting.ticket, &self.ticket));
        self.admission.changed.notify_all();
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.admission
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .active
            .remove(&self.root);
        self.admission.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread};

    fn wait_for_queue(admission: &Admission, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while admission.state.lock().unwrap().waiting.len() != count {
            assert!(Instant::now() < deadline, "request did not enter queue");
            thread::yield_now();
        }
    }

    #[test]
    fn same_root_waits_in_order_while_other_roots_can_run() {
        let admission = Admission::default();
        let first = admission.acquire("a").unwrap();
        thread::scope(|scope| {
            let (sender, receiver) = mpsc::channel();
            let (release, released) = mpsc::channel();
            let admission = &admission;
            let sender_first = sender.clone();
            scope.spawn(move || {
                let _permit = admission.acquire("a").unwrap();
                sender_first.send(1).unwrap();
                released.recv().unwrap();
            });
            wait_for_queue(admission, 1);
            scope.spawn(move || {
                let _permit = admission.acquire("a").unwrap();
                sender.send(2).unwrap();
            });
            wait_for_queue(admission, 2);
            let independent = admission.acquire("b").unwrap();
            assert!(receiver.try_recv().is_err());
            drop(first);
            assert_eq!(receiver.recv_timeout(Duration::from_secs(2)).unwrap(), 1);
            assert!(receiver.try_recv().is_err());
            release.send(()).unwrap();
            assert_eq!(receiver.recv_timeout(Duration::from_secs(2)).unwrap(), 2);
            drop(independent);
        });
        assert!(admission.state.lock().unwrap().active.is_empty());
    }

    #[test]
    fn third_independent_root_waits_until_a_slot_is_released() {
        let admission = Admission::default();
        let first = admission.acquire("a").unwrap();
        let second = admission.acquire("b").unwrap();
        thread::scope(|scope| {
            let (sender, receiver) = mpsc::channel();
            let admission = &admission;
            scope.spawn(move || {
                let _permit = admission.acquire("c").unwrap();
                sender.send(()).unwrap();
            });
            wait_for_queue(admission, 1);
            assert!(receiver.try_recv().is_err());
            drop(first);
            receiver.recv_timeout(Duration::from_secs(2)).unwrap();
            drop(second);
        });
    }

    #[test]
    fn unwinding_capture_releases_its_root() {
        let admission = Admission::default();
        let result = std::panic::catch_unwind(|| {
            let _permit = admission.acquire("a").unwrap();
            panic!("capture failed");
        });
        assert!(result.is_err());
        assert!(admission.state.lock().unwrap().active.is_empty());
        assert!(admission.acquire("a").is_ok());
    }

    #[test]
    fn full_queue_rejects_and_timed_out_entries_are_removed() {
        let admission = Admission {
            max_waiting: 1,
            timeout: Duration::from_millis(200),
            ..Admission::default()
        };
        let first = admission.acquire("a").unwrap();
        let second = admission.acquire("b").unwrap();
        thread::scope(|scope| {
            let admission = &admission;
            let waiter = scope.spawn(move || admission.acquire("c").err().unwrap());
            wait_for_queue(admission, 1);
            assert!(admission
                .acquire("d")
                .err()
                .unwrap()
                .contains("queue is full"));
            assert!(waiter.join().unwrap().contains("Timed out"));
            assert!(admission.state.lock().unwrap().waiting.is_empty());
        });
        drop(first);
        drop(second);
        assert!(admission.acquire("c").is_ok());
    }
}
