use super::journal::RuntimeRequestJournal;
use super::projection::{ProjectionLimits, RequestProjection};
use super::unserved::MAX_UNSERVED_SCOPES;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, PoisonError, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const MIN_PROBE_WAIT: Duration = Duration::from_millis(1);

pub fn probe_due(
    projection: &RequestProjection,
    clock: &dyn Fn() -> Instant,
    interval: Duration,
    closed: &dyn Fn() -> bool,
) -> Duration {
    for _ in 0..MAX_UNSERVED_SCOPES {
        if closed() {
            return MIN_PROBE_WAIT;
        }
        let probed = catch_unwind(AssertUnwindSafe(|| {
            projection.probe_next(clock(), interval)
        }));
        if !probed.unwrap_or(true) {
            break;
        }
    }
    projection
        .next_probe_in(clock(), interval)
        .max(MIN_PROBE_WAIT)
}

#[derive(Default)]
struct ProbeSignal {
    closed: Mutex<bool>,
    wake: Condvar,
}

impl ProbeSignal {
    fn is_closed(&self) -> bool {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn closed_after(&self, wait: Duration) -> bool {
        let closed = self.closed.lock().unwrap_or_else(PoisonError::into_inner);
        if *closed {
            return true;
        }
        *self
            .wake
            .wait_timeout(closed, wait)
            .unwrap_or_else(PoisonError::into_inner)
            .0
    }

    fn close(&self) {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.wake.notify_all();
    }
}

pub struct ProbeWorker {
    signal: Arc<ProbeSignal>,
    worker: Option<JoinHandle<()>>,
}

fn run(
    signal: &ProbeSignal,
    journal: &Weak<RuntimeRequestJournal>,
    interval: Duration,
    limits: ProjectionLimits,
) {
    while let Some(wait) = journal.upgrade().map(|journal| {
        let projection = RequestProjection::with_limits(journal, limits);
        probe_due(&projection, &Instant::now, interval, &|| signal.is_closed())
    }) {
        if signal.closed_after(wait) {
            return;
        }
    }
}

impl ProbeWorker {
    #[cfg(test)]
    pub(crate) fn shutdown_check(&self) -> impl Fn() -> bool {
        let signal = Arc::clone(&self.signal);
        move || signal.is_closed()
    }

    pub fn start(
        journal: &Arc<RuntimeRequestJournal>,
        interval: Duration,
        limits: ProjectionLimits,
    ) -> Option<Self> {
        let signal = Arc::new(ProbeSignal::default());
        let worker_signal = Arc::clone(&signal);
        let weak = Arc::downgrade(journal);
        let worker = std::thread::Builder::new()
            .name("agent-request-probe".into())
            .spawn(move || run(&worker_signal, &weak, interval, limits))
            .ok()?;
        Some(Self {
            signal,
            worker: Some(worker),
        })
    }
}

impl Drop for ProbeWorker {
    fn drop(&mut self) {
        self.signal.close();
        let Some(worker) = self.worker.take() else {
            return;
        };
        if worker.thread().id() == std::thread::current().id() {
            return;
        }
        let _ = worker.join();
    }
}
