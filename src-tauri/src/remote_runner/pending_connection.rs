use super::{transport::Session, Server};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};

pub(super) struct PendingConnection {
    canceled: AtomicBool,
    session: Mutex<Option<Arc<Session>>>,
    settled: Mutex<bool>,
    finished: Condvar,
}
pub(super) struct Completion(Arc<PendingConnection>);
impl PendingConnection {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self {
            canceled: AtomicBool::new(false),
            session: Mutex::new(None),
            settled: Mutex::new(false),
            finished: Condvar::new(),
        })
    }
    pub(super) fn completion(self: &Arc<Self>) -> Completion {
        Completion(Arc::clone(self))
    }
    pub(super) fn start(&self, server: &Server) -> Result<Arc<Session>, String> {
        self.start_with(|| {
            Session::connect_with_cancellation(server, || self.canceled.load(Ordering::Acquire))
        })
    }
    fn start_with(
        &self,
        create: impl FnOnce() -> Result<Session, String>,
    ) -> Result<Arc<Session>, String> {
        if self.canceled.load(Ordering::Acquire) {
            return Err("Runner connection was superseded.".into());
        }
        let session = Arc::new(create()?);
        let mut slot = self.session.lock().unwrap_or_else(|e| e.into_inner());
        if self.canceled.load(Ordering::Acquire) {
            return Err("Runner connection was superseded.".into());
        }
        *slot = Some(Arc::clone(&session));
        Ok(session)
    }
    pub(super) fn cancel_and_wait(&self) {
        self.canceled.store(true, Ordering::Release);
        let session = self
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(session) = session {
            session.close();
        }
        let mut settled = self.settled.lock().unwrap_or_else(|e| e.into_inner());
        while !*settled {
            settled = self
                .finished
                .wait(settled)
                .unwrap_or_else(|e| e.into_inner());
        }
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        let session = self
            .0
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        drop(session);
        *self.0.settled.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.0.finished.notify_all();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn cancellation_waits_for_provisional_process_cleanup_and_blocks_late_install() {
        let pending = PendingConnection::new();
        let completion = pending.completion();
        let worker_pending = Arc::clone(&pending);
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = worker_pending.start_with(|| {
                let session = Session::fixture();
                entered_tx.send(session.pid().unwrap()).unwrap();
                finish_rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
                Ok(session)
            });
            assert!(result.is_err());
            drop(completion);
        });
        let pid = entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        let cancel = Arc::clone(&pending);
        let canceler = std::thread::spawn(move || cancel.cancel_and_wait());
        let started = std::time::Instant::now();
        while !pending.canceled.load(Ordering::Acquire) {
            assert!(started.elapsed() < std::time::Duration::from_secs(2));
            std::thread::yield_now();
        }
        finish_tx.send(()).unwrap();
        canceler.join().unwrap();
        worker.join().unwrap();
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert!(pending
            .start_with(|| panic!("canceled startup must not execute"))
            .is_err());
    }
}
