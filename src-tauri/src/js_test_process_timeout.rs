use std::time::{Duration, Instant};

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct JsTestTimeoutTrigger(std::sync::Arc<std::sync::atomic::AtomicBool>);

#[cfg(test)]
impl JsTestTimeoutTrigger {
    pub(crate) fn new() -> Self {
        Self(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
            false,
        )))
    }

    pub(crate) fn expire(&self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn expire_after_fixture_ready(&self, ready: &std::path::Path) -> Result<(), String> {
        let watchdog = Instant::now();
        while !ready.is_file() {
            if watchdog.elapsed() >= Duration::from_secs(10) {
                self.expire();
                return Err("JavaScript timeout fixture did not become ready.".to_string());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        self.expire();
        Ok(())
    }
}

pub(crate) enum JsTestProcessTimeout {
    Elapsed(Duration),
    #[cfg(test)]
    Triggered {
        reported_duration: Duration,
        trigger: JsTestTimeoutTrigger,
    },
}

impl JsTestProcessTimeout {
    pub(crate) fn elapsed(duration: Duration) -> Self {
        Self::Elapsed(duration)
    }

    #[cfg(test)]
    pub(crate) fn triggered(reported_duration: Duration, trigger: JsTestTimeoutTrigger) -> Self {
        Self::Triggered {
            reported_duration,
            trigger,
        }
    }

    pub(crate) fn duration(&self) -> Duration {
        match self {
            Self::Elapsed(duration) => *duration,
            #[cfg(test)]
            Self::Triggered {
                reported_duration, ..
            } => *reported_duration,
        }
    }

    pub(crate) fn has_expired(&self, started_at: Instant) -> bool {
        match self {
            Self::Elapsed(duration) => started_at.elapsed() >= *duration,
            #[cfg(test)]
            Self::Triggered { trigger, .. } => trigger.0.load(std::sync::atomic::Ordering::SeqCst),
        }
    }
}
