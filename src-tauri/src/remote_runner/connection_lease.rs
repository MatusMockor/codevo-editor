use super::{transport::Session, Server};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

/// A connection generation, independent of a reusable server identifier.
pub(in crate::remote_runner) struct ConnectionLease(Arc<Owner>);
struct Owner {
    server: Server,
    revoked: AtomicBool,
    publication: Mutex<()>,
    session: Mutex<Option<Arc<Session>>>,
}
impl ConnectionLease {
    pub(in crate::remote_runner) fn new(server: Server, session: Arc<Session>) -> Self {
        Self(Arc::new(Owner {
            server,
            revoked: AtomicBool::new(false),
            publication: Mutex::new(()),
            session: Mutex::new(Some(session)),
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
    pub(in crate::remote_runner) fn session(&self) -> Result<Arc<Session>, String> {
        self.session_with_cancellation(|| false)
    }
    pub(in crate::remote_runner) fn session_with_cancellation(
        &self,
        canceled: impl Fn() -> bool,
    ) -> Result<Arc<Session>, String> {
        if !self.is_current() || canceled() {
            return Err("Runner connection was superseded.".into());
        }
        // Single-flight startup, scoped to this exact connection generation.
        let mut slot = loop {
            if !self.is_current() || canceled() {
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
        if !self.is_current() || canceled() {
            return Err("Runner connection was superseded.".into());
        }
        if slot.as_ref().is_none_or(|session| !session.is_alive()) {
            slot.take();
            let session = Arc::new(Session::connect_with_cancellation(&self.0.server, || {
                !self.is_current() || canceled()
            })?);
            if !self.is_current() || canceled() {
                return Err("Runner connection was superseded.".into());
            }
            *slot = Some(session);
        }
        slot.as_ref()
            .cloned()
            .ok_or("Runner connection unavailable.".into())
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
}
