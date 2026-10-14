use super::{transport::Session, Server};
use crate::remote_runner::interactions_ledger::InteractionLedger;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

type Connect = dyn Fn(&Server, &dyn Fn() -> bool) -> Result<Session, String> + Send + Sync;

struct Failure {
    attempt: u64,
    error: String,
}

#[derive(Default)]
struct Slot {
    session: Option<Arc<Session>>,
    failure: Option<Failure>,
}

/// A connection generation, independent of a reusable server identifier.
pub(in crate::remote_runner) struct ConnectionLease(Arc<Owner>);
struct Owner {
    server: Server,
    revoked: AtomicBool,
    publication: Mutex<()>,
    session: Mutex<Slot>,
    failures: AtomicU64,
    connect: Box<Connect>,
    interactions: InteractionLedger,
}
impl ConnectionLease {
    pub(in crate::remote_runner) fn new(server: Server, session: Arc<Session>) -> Self {
        Self::with_connect(
            server,
            session,
            Box::new(|server, canceled| Session::connect_with_cancellation(server, canceled)),
        )
    }
    pub(in crate::remote_runner) fn with_connect(
        server: Server,
        session: Arc<Session>,
        connect: Box<Connect>,
    ) -> Self {
        Self(Arc::new(Owner {
            server,
            revoked: AtomicBool::new(false),
            publication: Mutex::new(()),
            session: Mutex::new(Slot {
                session: Some(session),
                failure: None,
            }),
            failures: AtomicU64::new(0),
            connect,
            interactions: InteractionLedger::default(),
        }))
    }
    pub(in crate::remote_runner) fn is_current(&self) -> bool {
        !self.0.revoked.load(Ordering::Acquire)
    }
    pub(in crate::remote_runner) fn runner_id(&self) -> &str {
        self.0.server.runner_id.as_deref().unwrap_or("")
    }
    pub(in crate::remote_runner) fn server(&self) -> &Server {
        &self.0.server
    }
    pub(in crate::remote_runner) fn interaction_ledger(&self) -> &InteractionLedger {
        &self.0.interactions
    }
    pub(in crate::remote_runner) fn session(&self) -> Result<Arc<Session>, String> {
        self.session_with_cancellation(|| false)
    }
    pub(in crate::remote_runner) fn session_with_cancellation(
        &self,
        canceled: impl Fn() -> bool,
    ) -> Result<Arc<Session>, String> {
        let abandoned = || !self.is_current() || canceled();
        if abandoned() {
            return Err("Runner connection was superseded.".into());
        }
        let witnessed = self.0.failures.load(Ordering::Acquire);
        // Single-flight startup, scoped to this exact connection generation.
        let mut slot = loop {
            if abandoned() {
                return Err("Runner connection was superseded.".into());
            }
            match self.0.session.try_lock() {
                Ok(slot) => break slot,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Runner connection unavailable.".into()),
            }
        };
        if abandoned() {
            return Err("Runner connection was superseded.".into());
        }
        if let Some(session) = slot.session.as_ref().filter(|session| session.is_alive()) {
            return Ok(Arc::clone(session));
        }
        slot.session.take();
        if let Some(failure) = slot
            .failure
            .as_ref()
            .filter(|failure| failure.attempt > witnessed)
        {
            return Err(failure.error.clone());
        }
        let session = match (self.0.connect)(&self.0.server, &abandoned) {
            Ok(session) => Arc::new(session),
            Err(error) => {
                if !abandoned() {
                    slot.failure = Some(Failure {
                        attempt: self.0.failures.fetch_add(1, Ordering::AcqRel) + 1,
                        error: error.clone(),
                    });
                }
                return Err(error);
            }
        };
        if abandoned() {
            return Err("Runner connection was superseded.".into());
        }
        slot.failure = None;
        slot.session = Some(Arc::clone(&session));
        Ok(session)
    }
    pub(in crate::remote_runner) fn publish_if_current(&self, publish: impl FnOnce()) {
        let _guard = self.0.publication.lock().unwrap_or_else(|e| e.into_inner());
        if self.is_current() {
            publish();
        }
    }
    pub(in crate::remote_runner) fn revoke(&self) {
        {
            let _guard = self.0.publication.lock().unwrap_or_else(|e| e.into_inner());
            self.0.revoked.store(true, Ordering::Release);
        }
        let session = self
            .0
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .take();
        if let Some(session) = session {
            session.close();
        }
    }
}
impl Clone for ConnectionLease {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        if let Some(session) = self
            .session
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .take()
        {
            session.close();
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn server() -> Server {
        Server {
            id: "same-id".into(),
            name: "Test".into(),
            host: "127.0.0.1".into(),
            username: "codex".into(),
            port: 22,
            connected: true,
            runner_id: Some("pinned".into()),
        }
    }
    #[test]
    fn session_reused_and_revoked_generation_cannot_reopen() {
        let original = Arc::new(Session::fixture());
        let pid = original.pid().unwrap();
        let lease = ConnectionLease::new(server(), original.clone());
        let stale = lease.clone();
        assert!(Arc::ptr_eq(
            &lease.session().unwrap(),
            &lease.session().unwrap()
        ));
        lease.revoke();
        assert!(!stale.is_current());
        assert!(stale.session().is_err());
        assert!(!original.is_alive());
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        let replacement = ConnectionLease::new(server(), Arc::new(Session::fixture()));
        assert!(replacement.is_current());
        assert!(!stale.is_current());
        let mut emitted = false;
        stale.publish_if_current(|| emitted = true);
        assert!(!emitted);
    }
    #[test]
    fn revoke_settles_after_inflight_publication_and_blocks_later_publication() {
        let lease = ConnectionLease::new(server(), Arc::new(Session::fixture()));
        let publisher = lease.clone();
        let revoker = lease.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let publishing = std::thread::spawn(move || {
            publisher.publish_if_current(|| {
                entered_tx.send(()).unwrap();
                finish_rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
            })
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        let (revoked_tx, revoked_rx) = std::sync::mpsc::channel();
        let revoking = std::thread::spawn(move || {
            revoker.revoke();
            revoked_tx.send(()).unwrap();
        });
        assert!(revoked_rx.try_recv().is_err());
        finish_tx.send(()).unwrap();
        publishing.join().unwrap();
        revoked_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        revoking.join().unwrap();
        let mut emitted = false;
        lease.publish_if_current(|| emitted = true);
        assert!(!emitted);
    }
    #[test]
    fn final_owner_drop_closes_session_even_if_session_arc_is_retained() {
        let session = Arc::new(Session::fixture());
        {
            let _lease = ConnectionLease::new(server(), session.clone());
        }
        assert!(!session.is_alive());
    }

    struct Connector {
        attempts: std::sync::atomic::AtomicUsize,
        entered: std::sync::mpsc::Sender<()>,
        outcomes: Mutex<std::sync::mpsc::Receiver<Result<Session, String>>>,
    }
    impl Connector {
        fn connect(&self, canceled: &dyn Fn() -> bool) -> Result<Session, String> {
            self.attempts.fetch_add(1, Ordering::SeqCst);
            self.entered.send(()).unwrap();
            let outcomes = self.outcomes.lock().unwrap();
            let started = std::time::Instant::now();
            loop {
                if canceled() {
                    return Err("Runner connection was canceled.".into());
                }
                if let Ok(outcome) = outcomes.try_recv() {
                    return outcome;
                }
                assert!(started.elapsed() < std::time::Duration::from_secs(5));
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
    }
    struct Reconnecting {
        lease: ConnectionLease,
        connector: Arc<Connector>,
        entered: std::sync::mpsc::Receiver<()>,
        outcomes: std::sync::mpsc::Sender<Result<Session, String>>,
    }
    impl Reconnecting {
        fn attempts(&self) -> usize {
            self.connector.attempts.load(Ordering::SeqCst)
        }
        fn await_attempt(&self) {
            self.entered
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
        }
        fn waiter(&self) -> std::thread::JoinHandle<Result<Arc<Session>, String>> {
            let lease = self.lease.clone();
            let (waiting, waited) = std::sync::mpsc::channel();
            let waiter = std::thread::spawn(move || {
                let checks = std::cell::Cell::new(0);
                lease.session_with_cancellation(|| {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        waiting.send(()).unwrap();
                    }
                    false
                })
            });
            waited
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            waiter
        }
    }
    fn reconnecting() -> Reconnecting {
        let (entered_tx, entered) = std::sync::mpsc::channel();
        let (outcomes, outcomes_rx) = std::sync::mpsc::channel();
        let connector = Arc::new(Connector {
            attempts: std::sync::atomic::AtomicUsize::new(0),
            entered: entered_tx,
            outcomes: Mutex::new(outcomes_rx),
        });
        let lost = Arc::new(Session::fixture());
        lost.close();
        let connect = Arc::clone(&connector);
        let lease = ConnectionLease::with_connect(
            server(),
            lost,
            Box::new(move |_, canceled| connect.connect(canceled)),
        );
        Reconnecting {
            lease,
            connector,
            entered,
            outcomes,
        }
    }
    const UNREACHABLE: &str = "SSH tunnel host is unreachable.";

    #[test]
    fn operations_waiting_on_a_failed_connect_share_its_failure_without_reconnecting() {
        let h = reconnecting();
        let first = {
            let lease = h.lease.clone();
            std::thread::spawn(move || lease.session())
        };
        h.await_attempt();
        let waiters: Vec<_> = (0..7).map(|_| h.waiter()).collect();
        let started = std::time::Instant::now();
        h.outcomes.send(Err(UNREACHABLE.into())).unwrap();
        assert_eq!(first.join().unwrap().err(), Some(UNREACHABLE.to_string()));
        for waiter in waiters {
            assert_eq!(waiter.join().unwrap().err(), Some(UNREACHABLE.to_string()));
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        assert_eq!(h.attempts(), 1);
        assert!(h.lease.is_current());
    }

    #[test]
    fn an_operation_arriving_after_a_failure_starts_a_fresh_attempt() {
        let h = reconnecting();
        h.outcomes.send(Err(UNREACHABLE.into())).unwrap();
        assert_eq!(h.lease.session().err(), Some(UNREACHABLE.to_string()));
        h.outcomes
            .send(Err("SSH tunnel connection timed out.".into()))
            .unwrap();
        assert_eq!(
            h.lease.session().err(),
            Some("SSH tunnel connection timed out.".to_string())
        );
        assert_eq!(h.attempts(), 2);
        let recovering = {
            let lease = h.lease.clone();
            std::thread::spawn(move || lease.session())
        };
        h.await_attempt();
        h.await_attempt();
        h.await_attempt();
        let waiters: Vec<_> = (0..3).map(|_| h.waiter()).collect();
        h.outcomes.send(Ok(Session::fixture())).unwrap();
        let session = recovering.join().unwrap().unwrap();
        for waiter in waiters {
            assert!(Arc::ptr_eq(&waiter.join().unwrap().unwrap(), &session));
        }
        assert!(Arc::ptr_eq(&h.lease.session().unwrap(), &session));
        assert_eq!(h.attempts(), 3);
    }

    #[test]
    fn a_revoked_generation_answers_superseded_instead_of_a_shared_failure() {
        let h = reconnecting();
        let first = {
            let lease = h.lease.clone();
            std::thread::spawn(move || lease.session())
        };
        h.await_attempt();
        let waiters: Vec<_> = (0..3).map(|_| h.waiter()).collect();
        h.lease.revoke();
        assert_eq!(
            first.join().unwrap().err(),
            Some("Runner connection was canceled.".to_string())
        );
        for waiter in waiters {
            assert_eq!(
                waiter.join().unwrap().err(),
                Some("Runner connection was superseded.".to_string())
            );
        }
        assert_eq!(h.attempts(), 1);
        assert_eq!(
            h.lease.session().err(),
            Some("Runner connection was superseded.".to_string())
        );
        let replacement = ConnectionLease::new(server(), Arc::new(Session::fixture()));
        assert!(replacement.session().is_ok());
    }

    #[test]
    fn a_canceled_attempt_does_not_speak_for_the_operations_behind_it() {
        let h = reconnecting();
        let cancel = Arc::new(AtomicBool::new(false));
        let first = {
            let (lease, cancel) = (h.lease.clone(), Arc::clone(&cancel));
            std::thread::spawn(move || {
                lease.session_with_cancellation(|| cancel.load(Ordering::SeqCst))
            })
        };
        h.await_attempt();
        let waiter = h.waiter();
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            first.join().unwrap().err(),
            Some("Runner connection was canceled.".to_string())
        );
        h.await_attempt();
        h.outcomes.send(Err(UNREACHABLE.into())).unwrap();
        assert_eq!(waiter.join().unwrap().err(), Some(UNREACHABLE.to_string()));
        assert_eq!(h.attempts(), 2);
    }
}
