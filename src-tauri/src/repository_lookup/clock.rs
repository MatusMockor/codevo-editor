use std::time::Instant;

pub(crate) trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

#[derive(Debug, Default)]
pub(crate) struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

#[cfg(test)]
pub(crate) struct TestClock {
    origin: Instant,
    offset_millis: std::sync::atomic::AtomicU64,
}

#[cfg(test)]
impl TestClock {
    pub(crate) fn new() -> Self {
        Self {
            origin: Instant::now(),
            offset_millis: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub(crate) fn advance(&self, amount: std::time::Duration) {
        let millis = u64::try_from(amount.as_millis()).unwrap_or(u64::MAX);
        self.offset_millis
            .fetch_add(millis, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
impl Clock for TestClock {
    fn now(&self) -> Instant {
        let millis = self.offset_millis.load(std::sync::atomic::Ordering::SeqCst);
        self.origin + std::time::Duration::from_millis(millis)
    }
}
