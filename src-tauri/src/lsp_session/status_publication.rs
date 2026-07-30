use super::{LanguageServerRuntimeStatus, StatusSink};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const MAX_STATUS_PUBLISHERS: usize = 64;
const MAX_CALLBACK_ATTEMPTS: usize = 2;
const MAX_CALLBACK_RETRY_ROUNDS: usize = 6;
const CALLBACK_RETRY_DELAY: Duration = Duration::from_millis(10);
static ACTIVE_STATUS_PUBLISHERS: AtomicUsize = AtomicUsize::new(0);

struct PublisherPermit;

impl PublisherPermit {
    fn reserve() -> Result<Self, String> {
        ACTIVE_STATUS_PUBLISHERS
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |active| {
                (active < MAX_STATUS_PUBLISHERS).then_some(active + 1)
            })
            .map(|_| Self)
            .map_err(|_| {
                format!(
                    "Language server status publisher capacity ({MAX_STATUS_PUBLISHERS}) was reached."
                )
            })
    }
}

impl Drop for PublisherPermit {
    fn drop(&mut self) {
        ACTIVE_STATUS_PUBLISHERS.fetch_sub(1, Ordering::SeqCst);
    }
}

struct StatusPublication {
    sink: Arc<dyn StatusSink>,
    status: LanguageServerRuntimeStatus,
}

#[derive(Default)]
struct PublicationState {
    active_sinks: Vec<Arc<dyn StatusSink>>,
    leased_sinks: Vec<(Arc<dyn StatusSink>, PublisherPermit)>,
    pending: VecDeque<StatusPublication>,
    tasks: Vec<JoinHandle<()>>,
}

pub(super) struct StatusPublicationQueue {
    authoritative: Arc<Mutex<LanguageServerRuntimeStatus>>,
    state: Arc<Mutex<PublicationState>>,
}

pub(super) struct StatusSinkAdmission {
    state: Arc<Mutex<PublicationState>>,
    sink: Arc<dyn StatusSink>,
    newly_admitted: bool,
    committed: bool,
}

impl StatusSinkAdmission {
    pub(super) fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for StatusSinkAdmission {
    fn drop(&mut self) {
        if !self.newly_admitted || self.committed {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .leased_sinks
            .retain(|(leased, _)| !Arc::ptr_eq(leased, &self.sink));
    }
}

impl StatusPublicationQueue {
    pub(super) fn new(authoritative: Arc<Mutex<LanguageServerRuntimeStatus>>) -> Self {
        Self {
            authoritative,
            state: Arc::new(Mutex::new(PublicationState::default())),
        }
    }

    pub(super) fn admit_sink(
        &self,
        sink: &Arc<dyn StatusSink>,
    ) -> Result<StatusSinkAdmission, String> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state
            .leased_sinks
            .iter()
            .any(|(leased, _)| Arc::ptr_eq(leased, sink))
        {
            return Ok(StatusSinkAdmission {
                state: Arc::clone(&self.state),
                sink: Arc::clone(sink),
                newly_admitted: false,
                committed: false,
            });
        }
        let permit = PublisherPermit::reserve()?;
        state.leased_sinks.push((Arc::clone(sink), permit));
        Ok(StatusSinkAdmission {
            state: Arc::clone(&self.state),
            sink: Arc::clone(sink),
            newly_admitted: true,
            committed: false,
        })
    }

    pub(super) fn publish(
        &self,
        sink: Arc<dyn StatusSink>,
        status: LanguageServerRuntimeStatus,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        harvest_finished_tasks(&mut state);
        let newly_admitted = !state
            .leased_sinks
            .iter()
            .any(|(leased, _)| Arc::ptr_eq(leased, &sink));
        if newly_admitted {
            let permit = PublisherPermit::reserve()?;
            state.leased_sinks.push((Arc::clone(&sink), permit));
        }

        if state
            .active_sinks
            .iter()
            .any(|active| Arc::ptr_eq(active, &sink))
        {
            if let Some(existing) = state
                .pending
                .iter_mut()
                .find(|queued| Arc::ptr_eq(&queued.sink, &sink))
            {
                existing.status = status;
            } else {
                state.pending.push_back(StatusPublication { sink, status });
            }
            return Ok(());
        }
        state
            .pending
            .retain(|queued| !Arc::ptr_eq(&queued.sink, &sink));

        state.active_sinks.push(Arc::clone(&sink));
        let shared_state = Arc::clone(&self.state);
        let authoritative = Arc::clone(&self.authoritative);
        let task_sink = Arc::clone(&sink);
        let task = std::thread::Builder::new()
            .name("lsp-status-publisher".to_string())
            .spawn(move || {
                publish_for_sink(shared_state, authoritative, task_sink, status);
            });
        match task {
            Ok(task) => {
                state.tasks.push(task);
                Ok(())
            }
            Err(error) => {
                state
                    .active_sinks
                    .retain(|active| !Arc::ptr_eq(active, &sink));
                if newly_admitted {
                    state
                        .leased_sinks
                        .retain(|(leased, _)| !Arc::ptr_eq(leased, &sink));
                }
                Err(format!(
                    "Failed to start language server status publisher: {error}"
                ))
            }
        }
    }
}

fn harvest_finished_tasks(state: &mut PublicationState) {
    let mut index = 0;
    while index < state.tasks.len() {
        if state.tasks[index].is_finished() {
            let task = state.tasks.swap_remove(index);
            let _ = task.join();
        } else {
            index += 1;
        }
    }
}

fn publish_for_sink(
    state: Arc<Mutex<PublicationState>>,
    authoritative: Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: Arc<dyn StatusSink>,
    mut status: LanguageServerRuntimeStatus,
) {
    let mut failed_rounds = 0;
    loop {
        let current = authoritative
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut delivered = status != current;
        if !delivered {
            for _ in 0..MAX_CALLBACK_ATTEMPTS {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    sink.emit_status(status.clone());
                }))
                .is_ok()
                {
                    delivered = true;
                    break;
                }
            }
        }
        if !delivered {
            failed_rounds += 1;
            if failed_rounds >= MAX_CALLBACK_RETRY_ROUNDS {
                let latest = authoritative
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone();
                let mut publication_state = state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if !publication_state
                    .pending
                    .iter()
                    .any(|queued| Arc::ptr_eq(&queued.sink, &sink))
                {
                    publication_state.pending.push_back(StatusPublication {
                        sink: Arc::clone(&sink),
                        status: latest,
                    });
                }
                publication_state
                    .active_sinks
                    .retain(|active| !Arc::ptr_eq(active, &sink));
                return;
            }
            std::thread::sleep(CALLBACK_RETRY_DELAY.saturating_mul(1 << (failed_rounds - 1)));
            continue;
        }
        failed_rounds = 0;

        let latest = authoritative
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut publication_state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(index) = publication_state
            .pending
            .iter()
            .position(|queued| Arc::ptr_eq(&queued.sink, &sink))
        {
            status = publication_state
                .pending
                .remove(index)
                .expect("pending status publication")
                .status;
            continue;
        }
        if latest != status {
            status = latest;
            continue;
        }
        publication_state
            .active_sinks
            .retain(|active| !Arc::ptr_eq(active, &sink));
        if matches!(
            latest,
            LanguageServerRuntimeStatus::Stopped | LanguageServerRuntimeStatus::Crashed { .. }
        ) {
            publication_state
                .leased_sinks
                .retain(|(leased, _)| !Arc::ptr_eq(leased, &sink));
        }
        return;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Barrier, Condvar, OnceLock};
    use std::time::{Duration, Instant};

    struct BlockingSink {
        entered: Arc<Barrier>,
        events: Arc<Mutex<Vec<LanguageServerRuntimeStatus>>>,
        release: Arc<Barrier>,
    }

    impl StatusSink for BlockingSink {
        fn emit_status(&self, status: LanguageServerRuntimeStatus) {
            self.events.lock().expect("events").push(status.clone());
            if matches!(status, LanguageServerRuntimeStatus::Crashed { .. }) {
                self.entered.wait();
                self.release.wait();
            }
        }
    }

    struct GateSink {
        entered: Arc<AtomicUsize>,
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    struct TogglePanicSink {
        calls: Arc<AtomicUsize>,
        panic: Arc<std::sync::atomic::AtomicBool>,
    }

    struct FinalFailureGateSink {
        calls: AtomicUsize,
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    impl StatusSink for FinalFailureGateSink {
        fn emit_status(&self, _status: LanguageServerRuntimeStatus) {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if call == MAX_CALLBACK_ATTEMPTS * MAX_CALLBACK_RETRY_ROUNDS {
                self.entered.wait();
                self.release.wait();
            }
            panic!("injected terminal callback failure");
        }
    }

    impl StatusSink for TogglePanicSink {
        fn emit_status(&self, _status: LanguageServerRuntimeStatus) {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert!(
                !self.panic.load(Ordering::SeqCst),
                "injected status callback panic"
            );
        }
    }

    fn status_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
        GUARD
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn wait_for_test_publishers_to_settle() {
        let deadline = Instant::now() + Duration::from_secs(1);
        while ACTIVE_STATUS_PUBLISHERS.load(Ordering::SeqCst) != 0 {
            assert!(
                Instant::now() < deadline,
                "status publisher permits did not settle"
            );
            std::thread::yield_now();
        }
    }

    impl StatusSink for GateSink {
        fn emit_status(&self, _status: LanguageServerRuntimeStatus) {
            self.entered.fetch_add(1, Ordering::SeqCst);
            let (released, settled) = &*self.gate;
            let mut released = released.lock().expect("publisher gate");
            while !*released {
                released = settled.wait(released).expect("publisher wait");
            }
        }
    }

    #[test]
    fn paused_crash_publication_drains_authoritative_stop_last() {
        let _guard = status_test_guard();
        let crashed = LanguageServerRuntimeStatus::Crashed {
            message: "boom".to_string(),
        };
        let authoritative = Arc::new(Mutex::new(crashed.clone()));
        let queue = StatusPublicationQueue::new(Arc::clone(&authoritative));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink: Arc<dyn StatusSink> = Arc::new(BlockingSink {
            entered: Arc::clone(&entered),
            events: Arc::clone(&events),
            release: Arc::clone(&release),
        });
        queue
            .publish(Arc::clone(&sink), crashed)
            .expect("crash publication");
        entered.wait();

        *authoritative.lock().expect("authoritative") = LanguageServerRuntimeStatus::Stopped;
        queue
            .publish(sink, LanguageServerRuntimeStatus::Stopped)
            .expect("stop publication");
        release.wait();

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            if matches!(
                events.lock().expect("events").last(),
                Some(LanguageServerRuntimeStatus::Stopped)
            ) {
                break;
            }
            assert!(Instant::now() < deadline, "stopped publication timed out");
            std::thread::yield_now();
        }
        drop(queue);
        wait_for_test_publishers_to_settle();
    }

    #[test]
    fn sixty_four_blocked_sinks_isolate_and_the_next_sink_fails_explicitly() {
        let _guard = status_test_guard();
        let status = LanguageServerRuntimeStatus::Stopped;
        let entered = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let mut queues = Vec::new();
        for _ in 0..MAX_STATUS_PUBLISHERS {
            let queue = StatusPublicationQueue::new(Arc::new(Mutex::new(status.clone())));
            let sink: Arc<dyn StatusSink> = Arc::new(GateSink {
                entered: Arc::clone(&entered),
                gate: Arc::clone(&gate),
            });
            queue
                .publish(sink, status.clone())
                .expect("publisher within capacity");
            queues.push(queue);
        }
        let overflow = StatusPublicationQueue::new(Arc::new(Mutex::new(status.clone())));
        assert!(overflow
            .publish(
                Arc::new(GateSink {
                    entered: Arc::clone(&entered),
                    gate: Arc::clone(&gate),
                }),
                status,
            )
            .is_err());

        let (released, settled) = &*gate;
        *released.lock().expect("publisher gate") = true;
        settled.notify_all();
        drop(queues);
        drop(overflow);
        wait_for_test_publishers_to_settle();
    }

    #[test]
    fn callback_panics_back_off_then_remain_dirty_until_a_later_retry() {
        let _guard = status_test_guard();
        let status = LanguageServerRuntimeStatus::Running {
            session_id: 7,
            capabilities: Default::default(),
        };
        let queue = StatusPublicationQueue::new(Arc::new(Mutex::new(status.clone())));
        let calls = Arc::new(AtomicUsize::new(0));
        let panic = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let sink: Arc<dyn StatusSink> = Arc::new(TogglePanicSink {
            calls: Arc::clone(&calls),
            panic: Arc::clone(&panic),
        });
        queue
            .publish(Arc::clone(&sink), status.clone())
            .expect("initial publication");
        let deadline = Instant::now() + Duration::from_secs(2);
        while calls.load(Ordering::SeqCst) < MAX_CALLBACK_ATTEMPTS * MAX_CALLBACK_RETRY_ROUNDS {
            assert!(Instant::now() < deadline, "panic retry rounds timed out");
            std::thread::yield_now();
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            MAX_CALLBACK_ATTEMPTS * MAX_CALLBACK_RETRY_ROUNDS
        );

        panic.store(false, Ordering::SeqCst);
        queue.publish(sink, status).expect("dirty retry");
        let deadline = Instant::now() + Duration::from_secs(1);
        while calls.load(Ordering::SeqCst) == MAX_CALLBACK_ATTEMPTS * MAX_CALLBACK_RETRY_ROUNDS {
            assert!(
                Instant::now() < deadline,
                "dirty publication was not retried"
            );
            std::thread::yield_now();
        }
        drop(queue);
        wait_for_test_publishers_to_settle();
    }

    #[test]
    fn dropped_provisional_admissions_release_global_capacity() {
        let _guard = status_test_guard();
        let queue =
            StatusPublicationQueue::new(Arc::new(Mutex::new(LanguageServerRuntimeStatus::Stopped)));
        for _ in 0..(MAX_STATUS_PUBLISHERS * 2) {
            let sink: Arc<dyn StatusSink> = Arc::new(GateSink {
                entered: Arc::new(AtomicUsize::new(0)),
                gate: Arc::new((Mutex::new(true), Condvar::new())),
            });
            drop(queue.admit_sink(&sink).expect("provisional admission"));
        }
        assert_eq!(ACTIVE_STATUS_PUBLISHERS.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn final_callback_failure_preserves_a_newer_pending_terminal_status() {
        let _guard = status_test_guard();
        let running = LanguageServerRuntimeStatus::Running {
            session_id: 9,
            capabilities: Default::default(),
        };
        let authoritative = Arc::new(Mutex::new(running.clone()));
        let queue = StatusPublicationQueue::new(Arc::clone(&authoritative));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let sink: Arc<dyn StatusSink> = Arc::new(FinalFailureGateSink {
            calls: AtomicUsize::new(0),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        });
        queue
            .publish(Arc::clone(&sink), running)
            .expect("running publication");
        entered.wait();
        *authoritative.lock().expect("authoritative") = LanguageServerRuntimeStatus::Stopped;
        queue
            .publish(sink, LanguageServerRuntimeStatus::Stopped)
            .expect("newer stopped publication");
        release.wait();

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let state = queue
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.active_sinks.is_empty() {
                drop(state);
                assert!(Instant::now() < deadline, "publisher did not become dirty");
                std::thread::yield_now();
                continue;
            }
            assert!(state
                .pending
                .iter()
                .any(|queued| { matches!(queued.status, LanguageServerRuntimeStatus::Stopped) }));
            break;
        }
        drop(queue);
        wait_for_test_publishers_to_settle();
    }
}
