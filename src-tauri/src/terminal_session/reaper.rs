use super::*;
use std::sync::{Condvar, MutexGuard, PoisonError};

const TERMINAL_STOP_COMPLETION_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
pub(super) struct ReapSignal {
    done: Mutex<bool>,
    changed: Condvar,
}

impl ReapSignal {
    pub(super) fn finish(&self) {
        *self.done.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.changed.notify_all();
    }

    fn wait_until(&self, deadline: Instant) -> bool {
        let mut done = self.done.lock().unwrap_or_else(PoisonError::into_inner);
        while !*done {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            done = self
                .changed
                .wait_timeout(done, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        true
    }
}

struct InFlightReap {
    signal: Arc<ReapSignal>,
    workspace_root: PathBuf,
}

#[derive(Default)]
pub(super) struct TerminalReaperTracker {
    in_flight: Mutex<HashMap<u64, InFlightReap>>,
}

impl TerminalReaperTracker {
    fn in_flight(&self) -> MutexGuard<'_, HashMap<u64, InFlightReap>> {
        self.in_flight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn admit(
        self: &Arc<Self>,
        session_id: u64,
        workspace_root: PathBuf,
    ) -> (PendingTerminalReap, TerminalStopCompletion) {
        let signal = Arc::new(ReapSignal::default());
        self.in_flight().insert(
            session_id,
            InFlightReap {
                signal: Arc::clone(&signal),
                workspace_root,
            },
        );
        (
            PendingTerminalReap {
                session_id,
                signal: Arc::clone(&signal),
                tracker: Arc::clone(self),
            },
            TerminalStopCompletion(Some(signal)),
        )
    }

    fn completions_matching(
        &self,
        matches: impl Fn(u64, &Path) -> bool,
    ) -> Vec<TerminalStopCompletion> {
        self.in_flight()
            .iter()
            .filter(|(session_id, reap)| matches(**session_id, &reap.workspace_root))
            .map(|(_, reap)| TerminalStopCompletion(Some(Arc::clone(&reap.signal))))
            .collect()
    }

    #[cfg(test)]
    pub(super) fn is_tracking(&self, session_id: u64) -> bool {
        self.in_flight().contains_key(&session_id)
    }
}

struct PendingTerminalReap {
    session_id: u64,
    signal: Arc<ReapSignal>,
    tracker: Arc<TerminalReaperTracker>,
}

impl Drop for PendingTerminalReap {
    fn drop(&mut self) {
        let mut in_flight = self.tracker.in_flight();
        if in_flight
            .get(&self.session_id)
            .is_some_and(|reap| Arc::ptr_eq(&reap.signal, &self.signal))
        {
            in_flight.remove(&self.session_id);
        }
        drop(in_flight);
        self.signal.finish();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TerminalStopNotice {
    EmitStopped,
    Silent,
}

pub(crate) struct TerminalSessionReaper {
    session: Option<RunningTerminalSession>,
    session_id: u64,
    notice: TerminalStopNotice,
    _pending: PendingTerminalReap,
}

impl Drop for TerminalSessionReaper {
    fn drop(&mut self) {
        let Some(session) = self.session.take() else {
            return;
        };
        let sink = Arc::clone(&session.sink);
        terminate_session(session);
        if self.notice == TerminalStopNotice::EmitStopped {
            sink.emit_status(TerminalRuntimeStatus::Stopped {
                session_id: self.session_id,
            });
        }
    }
}

#[must_use]
pub(crate) struct TerminalStopCompletion(Option<Arc<ReapSignal>>);

impl TerminalStopCompletion {
    pub(super) fn of(signal: Arc<ReapSignal>) -> Self {
        Self(Some(signal))
    }

    pub(crate) fn wait(self) -> bool {
        wait_for_all(vec![self])
    }
}

fn wait_for_all(completions: Vec<TerminalStopCompletion>) -> bool {
    let deadline = Instant::now() + TERMINAL_STOP_COMPLETION_TIMEOUT;
    completions
        .into_iter()
        .filter_map(|completion| completion.0)
        .map(|signal| signal.wait_until(deadline))
        .filter(|settled| !settled)
        .count()
        == 0
}

fn spawn_reaper(reaper: TerminalSessionReaper) {
    let _ = thread::Builder::new()
        .name("terminal-reaper".to_string())
        .spawn(move || drop(reaper));
}

struct DetachedSessions {
    completions: Vec<TerminalStopCompletion>,
    reapers: Vec<TerminalSessionReaper>,
}

impl DetachedSessions {
    fn reap(self) -> bool {
        for reaper in self.reapers {
            spawn_reaper(reaper);
        }
        wait_for_all(self.completions)
    }
}

impl TerminalSupervisor {
    pub(crate) fn start_ticket(&self) -> TerminalStartTicket {
        self.admission.ticket()
    }

    pub fn stop(&self, session_id: u64) -> Result<TerminalRuntimeStatus, String> {
        if self.begin_stop(session_id).wait() {
            Ok(TerminalRuntimeStatus::Stopped { session_id })
        } else {
            Err("The terminal session did not stop in time.".to_string())
        }
    }

    pub(crate) fn begin_stop(&self, session_id: u64) -> TerminalStopCompletion {
        match self.detach_reaper(session_id) {
            Detached::Reaper(reaper, completion) => {
                spawn_reaper(*reaper);
                completion
            }
            Detached::InFlight(completion) => completion,
        }
    }

    pub fn stop_root(&self, root: &Path) -> Result<(), String> {
        let detached = {
            let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            let starts = self.admission.invalidate_root(root);
            let mut detached =
                self.detach_matching(&mut sessions, TerminalStopNotice::EmitStopped, |session| {
                    session == root
                });
            detached.completions.extend(starts);
            detached
        };

        if detached.reap() {
            Ok(())
        } else {
            Err("Terminal sessions did not stop in time.".to_string())
        }
    }

    pub fn stop_all(&self) {
        let detached = {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let starts = self.admission.invalidate_all();
            let mut detached =
                self.detach_matching(&mut sessions, TerminalStopNotice::Silent, |_| true);
            detached.completions.extend(starts);
            detached
        };

        detached.reap();
    }

    pub fn shutdown(&self) {
        self.admission.close();
        self.stop_all();
    }

    pub(super) fn detach_reaper(&self, session_id: u64) -> Detached {
        let Ok(mut sessions) = self.sessions.lock() else {
            return Detached::InFlight(TerminalStopCompletion(None));
        };
        let Some(session) = sessions.remove(&session_id) else {
            let mut completions = self
                .reapers
                .completions_matching(|in_flight_id, _| in_flight_id == session_id);
            return Detached::InFlight(completions.pop().unwrap_or(TerminalStopCompletion(None)));
        };
        let (reaper, completion) =
            self.reaper_for(session_id, session, TerminalStopNotice::EmitStopped);
        drop(sessions);
        Detached::Reaper(Box::new(reaper), completion)
    }

    fn detach_matching(
        &self,
        sessions: &mut HashMap<u64, RunningTerminalSession>,
        notice: TerminalStopNotice,
        matches: impl Fn(&Path) -> bool,
    ) -> DetachedSessions {
        let mut completions = self
            .reapers
            .completions_matching(|_, workspace_root| matches(workspace_root));
        let session_ids = sessions
            .iter()
            .filter(|(_, session)| matches(&session.workspace_root))
            .map(|(session_id, _)| *session_id)
            .collect::<Vec<_>>();
        let mut reapers = Vec::with_capacity(session_ids.len());
        for session_id in session_ids {
            if let Some(session) = sessions.remove(&session_id) {
                let (reaper, completion) = self.reaper_for(session_id, session, notice);
                reapers.push(reaper);
                completions.push(completion);
            }
        }
        DetachedSessions {
            completions,
            reapers,
        }
    }

    fn reaper_for(
        &self,
        session_id: u64,
        session: RunningTerminalSession,
        notice: TerminalStopNotice,
    ) -> (TerminalSessionReaper, TerminalStopCompletion) {
        let (pending, completion) = self
            .reapers
            .admit(session_id, session.workspace_root.clone());
        let reaper = TerminalSessionReaper {
            session: Some(session),
            session_id,
            notice,
            _pending: pending,
        };
        (reaper, completion)
    }
}

pub(super) enum Detached {
    Reaper(Box<TerminalSessionReaper>, TerminalStopCompletion),
    InFlight(TerminalStopCompletion),
}
