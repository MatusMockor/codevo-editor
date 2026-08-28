use super::{RecordingProcessGroupSignalSender, RecordingTerminalChild};
use crate::{terminal_process_tree::ProcessTreeTerminator, terminal_session::TerminalChild};
use std::{
    sync::{mpsc, Arc, Condvar, Mutex},
    thread,
    time::Duration,
};

#[test]
fn process_tree_terminator_escalates_without_blocking_on_stuck_waiter() {
    let child = RecordingTerminalChild::blocking();
    let killed = child.killed();
    let signals = Arc::new(Mutex::new(Vec::new()));
    let signal_sender = RecordingProcessGroupSignalSender {
        signals: Arc::clone(&signals),
    };
    let mut terminator = ProcessTreeTerminator::with_dependencies(
        42,
        child.clone_killer(),
        Box::new(signal_sender),
        Duration::from_millis(10),
        Duration::from_millis(10),
    );
    let waiter_gate = Arc::new((Mutex::new(false), Condvar::new()));
    let waiter_thread_gate = Arc::clone(&waiter_gate);
    let waiter = thread::spawn(move || {
        let (lock, gate) = &*waiter_thread_gate;
        let released = lock.lock().expect("waiter gate");
        let _released = gate
            .wait_while(released, |released| !*released)
            .expect("waiter release gate");
    });
    let (terminated_tx, terminated_rx) = mpsc::channel();
    let termination_thread = thread::spawn(move || {
        terminator.terminate(Some(&waiter));
        terminated_tx.send(()).expect("termination completion");
        waiter.join().expect("waiter");
    });
    let mut termination_thread = TestThreadJoinGuard::new(termination_thread);
    let waiter_release = WaiterGateReleaseGuard(Arc::clone(&waiter_gate));

    terminated_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("termination remained blocked on the independently gated waiter");
    assert_eq!(
        signals.lock().expect("signals").as_slice(),
        &[(42, libc::SIGTERM), (42, libc::SIGKILL)]
    );
    assert_eq!(*killed.lock().expect("killed"), 0);
    waiter_release.release();
    termination_thread.join("termination thread");
}

struct WaiterGateReleaseGuard(Arc<(Mutex<bool>, Condvar)>);

impl WaiterGateReleaseGuard {
    fn release(&self) {
        let (lock, gate) = &*self.0;
        *lock.lock().expect("waiter gate") = true;
        gate.notify_all();
    }
}

impl Drop for WaiterGateReleaseGuard {
    fn drop(&mut self) {
        self.release();
    }
}

struct TestThreadJoinGuard(Option<thread::JoinHandle<()>>);

impl TestThreadJoinGuard {
    fn new(thread: thread::JoinHandle<()>) -> Self {
        Self(Some(thread))
    }

    fn join(&mut self, label: &str) {
        if let Some(thread) = self.0.take() {
            thread.join().unwrap_or_else(|_| panic!("{label} panicked"));
        }
    }
}

impl Drop for TestThreadJoinGuard {
    fn drop(&mut self) {
        if let Some(thread) = self.0.take() {
            let _ = thread.join();
        }
    }
}
