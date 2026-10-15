use super::reaper::{ReapSignal, TerminalStopCompletion};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

const MAX_TRACKED_ROOT_STOPS: usize = 256;

pub(crate) const TERMINAL_START_SUPERSEDED_ERROR: &str =
    "The terminal start was superseded by a terminal stop.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TerminalStartTicket {
    stop_sequence: u64,
}

struct InFlightStart {
    signal: Arc<ReapSignal>,
    workspace_root: PathBuf,
}

#[derive(Default)]
struct AdmissionState {
    all_stopped_at: u64,
    closed: bool,
    next_start_id: u64,
    roots_stopped_at: HashMap<PathBuf, u64>,
    starts: HashMap<u64, InFlightStart>,
    stop_sequence: u64,
}

impl AdmissionState {
    fn admits(&self, ticket: TerminalStartTicket, root: &Path) -> Result<(), String> {
        let superseded = self.closed
            || self.all_stopped_at > ticket.stop_sequence
            || self
                .roots_stopped_at
                .get(root)
                .is_some_and(|stopped_at| *stopped_at > ticket.stop_sequence);
        if superseded {
            return Err(TERMINAL_START_SUPERSEDED_ERROR.to_string());
        }
        Ok(())
    }

    fn starts_matching(&self, matches: impl Fn(&Path) -> bool) -> Vec<TerminalStopCompletion> {
        self.starts
            .values()
            .filter(|start| matches(&start.workspace_root))
            .map(|start| TerminalStopCompletion::of(Arc::clone(&start.signal)))
            .collect()
    }
}

#[derive(Default)]
pub(super) struct TerminalStartAdmission(Arc<Mutex<AdmissionState>>);

pub(super) struct TerminalStartLease {
    admission: Arc<Mutex<AdmissionState>>,
    signal: Arc<ReapSignal>,
    start_id: u64,
}

impl Drop for TerminalStartLease {
    fn drop(&mut self) {
        self.admission
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .starts
            .remove(&self.start_id);
        self.signal.finish();
    }
}

impl TerminalStartAdmission {
    fn state(&self) -> MutexGuard<'_, AdmissionState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn ticket(&self) -> TerminalStartTicket {
        TerminalStartTicket {
            stop_sequence: self.state().stop_sequence,
        }
    }

    pub(super) fn begin_start(
        &self,
        ticket: TerminalStartTicket,
        root: &Path,
    ) -> Result<TerminalStartLease, String> {
        let mut state = self.state();
        state.admits(ticket, root)?;
        state.next_start_id += 1;
        let start_id = state.next_start_id;
        let signal = Arc::new(ReapSignal::default());
        state.starts.insert(
            start_id,
            InFlightStart {
                signal: Arc::clone(&signal),
                workspace_root: root.to_path_buf(),
            },
        );
        Ok(TerminalStartLease {
            admission: Arc::clone(&self.0),
            signal,
            start_id,
        })
    }

    pub(super) fn admit(&self, ticket: TerminalStartTicket, root: &Path) -> Result<(), String> {
        self.state().admits(ticket, root)
    }

    pub(super) fn invalidate_root(&self, root: &Path) -> Vec<TerminalStopCompletion> {
        let mut state = self.state();
        state.stop_sequence += 1;
        let stopped_at = state.stop_sequence;
        if state.roots_stopped_at.len() >= MAX_TRACKED_ROOT_STOPS
            && !state.roots_stopped_at.contains_key(root)
        {
            state.roots_stopped_at.clear();
            state.all_stopped_at = stopped_at;
        } else {
            state.roots_stopped_at.insert(root.to_path_buf(), stopped_at);
        }
        state.starts_matching(|start_root| start_root == root)
    }

    pub(super) fn invalidate_all(&self) -> Vec<TerminalStopCompletion> {
        let mut state = self.state();
        state.stop_sequence += 1;
        state.all_stopped_at = state.stop_sequence;
        state.roots_stopped_at.clear();
        state.starts_matching(|_| true)
    }

    pub(super) fn close(&self) {
        self.state().closed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_root_stop_supersedes_only_earlier_tickets_for_that_root() {
        let admission = TerminalStartAdmission::default();
        let before = admission.ticket();

        admission.invalidate_root(Path::new("/a"));
        let after = admission.ticket();

        assert!(admission.admit(before, Path::new("/a")).is_err());
        assert!(admission.admit(before, Path::new("/b")).is_ok());
        assert!(admission.admit(after, Path::new("/a")).is_ok());
    }

    #[test]
    fn stop_all_and_close_supersede_every_root() {
        let admission = TerminalStartAdmission::default();
        let before = admission.ticket();

        admission.invalidate_all();
        let after = admission.ticket();
        assert!(admission.admit(before, Path::new("/a")).is_err());
        assert!(admission.admit(after, Path::new("/a")).is_ok());

        admission.close();
        assert!(admission.admit(admission.ticket(), Path::new("/a")).is_err());
    }

    #[test]
    fn root_stop_tracking_is_bounded_and_fails_closed_on_overflow() {
        let admission = TerminalStartAdmission::default();
        let before = admission.ticket();
        for index in 0..MAX_TRACKED_ROOT_STOPS {
            admission.invalidate_root(&PathBuf::from(format!("/root-{index}")));
        }
        let after = admission.ticket();

        admission.invalidate_root(Path::new("/one-more"));

        assert!(admission.state().roots_stopped_at.is_empty());
        assert!(admission.admit(before, Path::new("/untouched")).is_err());
        assert!(admission.admit(after, Path::new("/untouched")).is_err());
        assert!(admission
            .admit(admission.ticket(), Path::new("/untouched"))
            .is_ok());
    }
}
