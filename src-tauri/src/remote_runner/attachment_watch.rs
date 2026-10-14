use super::service::ConnectionLease;
use super::transport::{Revocation, Session};
use std::time::{Duration, Instant};
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Budget {
    deadline: Instant,
}

impl Budget {
    pub(super) fn starting(now: Instant, total: Duration) -> Self {
        Self {
            deadline: now + total,
        }
    }

    pub(super) fn deadline(&self) -> Instant {
        self.deadline
    }

    pub(super) fn bound(&self, now: Instant, patience: Duration) -> Instant {
        self.deadline.min(now + patience)
    }

    pub(super) fn spent(&self, now: Instant) -> bool {
        now >= self.deadline
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Interrupted {
    Cancelled,
    Revoked(String),
    Stalled,
}

pub(super) struct Guard {
    budget: Budget,
    revocation: Revocation,
    cancel: Option<watch::Receiver<bool>>,
}

async fn cancelled(cancel: &mut Option<watch::Receiver<bool>>) {
    let Some(cancel) = cancel else {
        return std::future::pending().await;
    };
    if cancel.wait_for(|cancelled| *cancelled).await.is_err() {
        std::future::pending::<()>().await;
    }
}

impl Guard {
    pub(super) fn new(
        budget: Budget,
        session: &Session,
        cancel: Option<watch::Receiver<bool>>,
    ) -> Self {
        Self {
            budget,
            revocation: session.revocation(),
            cancel,
        }
    }

    pub(super) fn budget(&self) -> Budget {
        self.budget
    }

    pub(super) async fn interrupted(&mut self, patience: Duration) -> Interrupted {
        let until = self.budget.bound(Instant::now(), patience);
        self.interrupted_by(until).await
    }

    pub(super) async fn interrupted_by(&mut self, until: Instant) -> Interrupted {
        tokio::select! {
            biased;
            _ = cancelled(&mut self.cancel) => Interrupted::Cancelled,
            reason = self.revocation.revoked() => Interrupted::Revoked(reason),
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(until)) => Interrupted::Stalled,
        }
    }
}

impl Interrupted {
    pub(super) fn refusal(
        self,
        lease: &ConnectionLease,
        cancelled: &str,
        changed: &str,
        stalled: &str,
    ) -> String {
        match self {
            Self::Cancelled => cancelled.into(),
            Self::Revoked(_) if !lease.is_current() => changed.into(),
            Self::Revoked(reason) => reason,
            Self::Stalled => stalled.into(),
        }
    }
}

#[cfg(all(test, unix))]
#[path = "attachment_watch_tests.rs"]
mod tests;
