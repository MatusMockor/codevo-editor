use std::sync::atomic::{AtomicU8, Ordering};

const PENDING: u8 = 0;
const SENDING: u8 = 1;
const CANCELLED: u8 = 2;

pub(in crate::remote_runner) struct SendGate(AtomicU8);

impl Default for SendGate {
    fn default() -> Self {
        Self(AtomicU8::new(PENDING))
    }
}

impl SendGate {
    pub(in crate::remote_runner) fn claim(&self) -> bool {
        self.0
            .compare_exchange(PENDING, SENDING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(in crate::remote_runner) fn cancel(&self) -> bool {
        self.0
            .compare_exchange(PENDING, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            || self.0.load(Ordering::Acquire) == CANCELLED
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn sending_and_cancelling_exclude_each_other() {
        let sent = SendGate::default();
        assert!(sent.claim());
        assert!(!sent.cancel());
        assert!(!sent.claim());
        let cancelled = SendGate::default();
        assert!(cancelled.cancel());
        assert!(cancelled.cancel());
        assert!(!cancelled.claim());
    }

    #[test]
    fn a_racing_timeout_never_declares_unsent_what_the_dispatcher_sent() {
        for _ in 0..2_000 {
            let gate = Arc::new(SendGate::default());
            let start = Arc::new(Barrier::new(2));
            let dispatcher = {
                let gate = Arc::clone(&gate);
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    gate.claim()
                })
            };
            start.wait();
            let unsent = gate.cancel();
            let sent = dispatcher.join().expect("dispatcher");
            assert!(sent != unsent, "sent {sent} unsent {unsent}");
        }
    }
}
