use crate::debug_adapter::{DebugEventEmitter, DebugEventPayload};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpEventDropReason {
    StaleAuthority,
    LifecycleOwnedElsewhere,
    CapacityExceeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpEventDisposition {
    Delivered,
    Buffered,
    Dropped(CdpEventDropReason),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CdpEventHealth {
    Healthy,
    FailedClosed,
}

impl CdpEventHealth {
    pub(crate) fn is_failed_closed(self) -> bool {
        self == Self::FailedClosed
    }
}

pub(crate) trait CdpEventSinkPort: Send + Sync {
    fn emit(&self, payload: DebugEventPayload) -> CdpEventDisposition;
}

/// Cloneable CDP-side handle around an injected event sink. Cloning and
/// construction share one allocation-backed port, while the event hot path
/// only moves the existing payload, performs one virtual call and conditionally
/// latches the capacity failure flag.
#[derive(Clone)]
pub(crate) struct CdpEventEmitter {
    sink: Arc<dyn CdpEventSinkPort>,
    failed_closed: Arc<AtomicBool>,
}

impl CdpEventEmitter {
    pub(crate) fn new(sink: Arc<dyn CdpEventSinkPort>) -> Self {
        Self {
            sink,
            failed_closed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(super) fn emit(&self, payload: DebugEventPayload) -> CdpEventDisposition {
        let disposition = self.sink.emit(payload);
        if matches!(
            disposition,
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded)
        ) {
            self.failed_closed.store(true, Ordering::Release);
        }
        disposition
    }

    pub(super) fn health(&self) -> CdpEventHealth {
        if self.failed_closed.load(Ordering::Acquire) {
            CdpEventHealth::FailedClosed
        } else {
            CdpEventHealth::Healthy
        }
    }
}

struct DirectCdpEventSink(DebugEventEmitter);

impl CdpEventSinkPort for DirectCdpEventSink {
    fn emit(&self, payload: DebugEventPayload) -> CdpEventDisposition {
        self.0.emit(payload);
        CdpEventDisposition::Delivered
    }
}

impl From<DebugEventEmitter> for CdpEventEmitter {
    fn from(emitter: DebugEventEmitter) -> Self {
        Self::new(Arc::new(DirectCdpEventSink(emitter)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugOutputStream, DebugStopReason};
    use std::collections::VecDeque;
    use std::sync::{Mutex, MutexGuard};

    struct FakeSink(Mutex<VecDeque<CdpEventDisposition>>);

    impl CdpEventSinkPort for FakeSink {
        fn emit(&self, _payload: DebugEventPayload) -> CdpEventDisposition {
            lock_recover(&self.0)
                .pop_front()
                .expect("one fake disposition per event")
        }
    }

    fn output() -> DebugEventPayload {
        DebugEventPayload::Output {
            stream: DebugOutputStream::Stdout,
            text: "event".to_string(),
        }
    }

    #[test]
    fn clone_shares_an_irreversible_capacity_failure_latch() {
        let emitter = CdpEventEmitter::new(Arc::new(FakeSink(Mutex::new(VecDeque::from([
            CdpEventDisposition::Dropped(CdpEventDropReason::StaleAuthority),
            CdpEventDisposition::Dropped(CdpEventDropReason::LifecycleOwnedElsewhere),
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded),
            CdpEventDisposition::Delivered,
        ])))));
        let clone = emitter.clone();

        assert_eq!(
            emitter.emit(output()),
            CdpEventDisposition::Dropped(CdpEventDropReason::StaleAuthority)
        );
        assert_eq!(clone.health(), CdpEventHealth::Healthy);
        assert_eq!(
            clone.emit(DebugEventPayload::Resumed),
            CdpEventDisposition::Dropped(CdpEventDropReason::LifecycleOwnedElsewhere)
        );
        assert_eq!(emitter.health(), CdpEventHealth::Healthy);
        assert_eq!(
            emitter.emit(DebugEventPayload::Stopped {
                reason: DebugStopReason::Pause,
                frames: Vec::new(),
                pause_generation: 1,
            }),
            CdpEventDisposition::Dropped(CdpEventDropReason::CapacityExceeded)
        );
        assert_eq!(clone.health(), CdpEventHealth::FailedClosed);
        assert_eq!(clone.emit(output()), CdpEventDisposition::Delivered);
        assert_eq!(emitter.health(), CdpEventHealth::FailedClosed);
    }

    #[test]
    fn transport_source_does_not_depend_on_the_node_watch_layer() {
        let source = include_str!("../debug_cdp_transport.rs");
        assert!(!source.contains("debug_node_process"));
        assert!(!source.contains("watch_event_gate"));
        assert!(!source.contains("WatchDebugEventGate"));
        assert!(!source.contains("WatchEventGenerationLease"));
    }

    fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|error| error.into_inner())
    }
}
