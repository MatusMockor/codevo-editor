use super::{AgentProcessGroupSignalSender, KILL_PROCESS_GROUP_SIGNAL};
use super::{TERMINATE_PROCESS_GROUP_SIGNAL, WAIT_POLL_INTERVAL};
use crate::agent_task_spawner::{
    agent_task_input::{AgentTaskInputSlot, AgentTaskInputState},
    AgentChild,
};
use std::{
    cell::Cell,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
pub(super) enum AgentProcessGroupState {
    Active { process_group_id: i32 },
    Reaping,
    SharedSession,
    Released,
    CleanupUncertain,
}

pub(super) struct AgentProcessGroup {
    state: Mutex<AgentProcessGroupState>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    force_requested: AtomicBool,
    stop_signalled: AtomicBool,
    clean_exit_grace: Duration,
    pub(super) cleanup_verified: AtomicBool,
    pub(super) input: std::sync::OnceLock<Arc<AgentTaskInputSlot>>,
}

impl AgentProcessGroup {
    pub(super) fn new(
        process_group_id: i32,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        clean_exit_grace: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(AgentProcessGroupState::Active { process_group_id }),
            signals,
            force_requested: AtomicBool::new(false),
            stop_signalled: AtomicBool::new(false),
            clean_exit_grace,
            cleanup_verified: AtomicBool::new(false),
            input: std::sync::OnceLock::new(),
        })
    }

    pub(super) fn signal(&self, signal: i32) -> Result<(), String> {
        self.stop_signalled.store(true, Ordering::SeqCst);
        self.close_input();
        let state = self.state();
        let process_group_id = match *state {
            AgentProcessGroupState::Active { process_group_id } => process_group_id,
            AgentProcessGroupState::SharedSession => {
                self.force_requested.store(true, Ordering::SeqCst);
                return Ok(());
            }
            AgentProcessGroupState::Reaping
            | AgentProcessGroupState::Released
            | AgentProcessGroupState::CleanupUncertain => return Ok(()),
        };
        if process_group_id <= 0 {
            return Err("Agent process-group authority is invalid.".to_string());
        }
        catch_unwind(AssertUnwindSafe(|| {
            self.signals.send(process_group_id, signal)
        }))
        .map_err(|_| "Agent process-group signal sender panicked.".to_string())?
    }

    pub(super) fn force_stop(&self) -> Result<(), String> {
        self.force_requested.store(true, Ordering::SeqCst);
        let result = self.signal(KILL_PROCESS_GROUP_SIGNAL);
        if result.is_ok() {
            self.cleanup_verified.store(true, Ordering::SeqCst);
        }
        result
    }

    fn close_input(&self) {
        if let Some(input) = self.input.get() {
            input.close(AgentTaskInputState::ClosedByStop);
        }
    }

    pub(super) fn force_stop_after_observed_exit(&self) -> Result<(), String> {
        self.close_input();
        self.force_requested.store(true, Ordering::SeqCst);
        let process_group_id = match *self.state() {
            AgentProcessGroupState::Active { process_group_id } if process_group_id > 0 => {
                process_group_id
            }
            AgentProcessGroupState::SharedSession => {
                self.cleanup_verified.store(true, Ordering::SeqCst);
                return Ok(());
            }
            AgentProcessGroupState::Active { .. } => {
                return Err("Agent process-group authority is invalid.".to_string())
            }
            AgentProcessGroupState::Reaping
            | AgentProcessGroupState::Released
            | AgentProcessGroupState::CleanupUncertain => return Ok(()),
        };
        let result = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send_after_observed_exit(process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }))
        .map_err(|_| "Agent process-group signal sender panicked.".to_string())?;
        if result.is_ok() {
            self.cleanup_verified.store(true, Ordering::SeqCst);
        }
        result
    }

    pub(super) fn force_requested(&self) -> bool {
        self.force_requested.load(Ordering::SeqCst)
    }

    pub(super) fn observe_exit(&self, child: &mut dyn AgentChild) -> Result<bool, String> {
        child.observe_exit()
    }

    pub(super) fn kill_unreaped(&self) {
        let state = self.state();
        let AgentProcessGroupState::Active { process_group_id } = *state else {
            return;
        };
        if process_group_id <= 0 {
            return;
        }
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send(process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
    }

    pub(super) fn reap(&self, child: &mut dyn AgentChild) -> Result<i32, String> {
        // The unreaped leader is the identity anchor that makes this group signal safe.
        // Clean the whole group before surrendering that anchor on every exit path.
        let cleanup = if self.cleanup_verified.load(Ordering::SeqCst) {
            Ok(())
        } else {
            self.cleanup_after_observed_exit()
        };
        let reaping = self.begin_reaping();
        let reaped = child.reap();
        if reaped.is_err() {
            self.abandon_reaping(reaping);
        }
        match (cleanup, reaped) {
            (Ok(()), Ok(exit_code)) => {
                *self.state() = AgentProcessGroupState::Released;
                Ok(exit_code)
            }
            (Err(cleanup_error), Ok(_)) => {
                *self.state() = AgentProcessGroupState::CleanupUncertain;
                Err(format!(
                    "Agent process-group cleanup failed: {cleanup_error}"
                ))
            }
            (_, Err(reap_error)) => Err(reap_error),
        }
    }

    pub(super) fn try_wait(&self, child: &mut dyn AgentChild) -> Result<Option<i32>, String> {
        if !self.observe_exit(child)? {
            return Ok(None);
        }
        self.reap(child).map(Some)
    }

    pub(super) fn is_reaped(&self) -> bool {
        matches!(*self.state(), AgentProcessGroupState::Released)
    }

    pub(super) fn state(&self) -> MutexGuard<'_, AgentProcessGroupState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl AgentProcessGroup {
    fn begin_reaping(&self) -> Option<i32> {
        let mut state = self.state();
        let AgentProcessGroupState::Active { process_group_id } = *state else {
            return None;
        };
        *state = AgentProcessGroupState::Reaping;
        Some(process_group_id)
    }

    fn abandon_reaping(&self, reaping: Option<i32>) {
        let Some(process_group_id) = reaping else {
            return;
        };
        let mut state = self.state();
        if matches!(*state, AgentProcessGroupState::Reaping) {
            *state = AgentProcessGroupState::Active { process_group_id };
        }
    }

    fn cleanup_after_observed_exit(&self) -> Result<(), String> {
        let state = *self.state();
        if let AgentProcessGroupState::Active { process_group_id } = state {
            let aborted = || self.force_requested() || self.stop_signalled.load(Ordering::SeqCst);
            terminate_group_survivors(
                self.signals.as_ref(),
                process_group_id,
                self.clean_exit_grace,
                &aborted,
            );
        }
        self.force_stop_after_observed_exit()
    }
}

pub(crate) fn terminate_group_survivors(
    signals: &dyn AgentProcessGroupSignalSender,
    process_group_id: i32,
    grace: Duration,
    aborted: &dyn Fn() -> bool,
) {
    if grace.is_zero() || process_group_id <= 0 || aborted() {
        return;
    }
    let probe_panicked = Cell::new(false);
    let members = || {
        if probe_panicked.get() {
            return None;
        }
        catch_unwind(AssertUnwindSafe(|| {
            signals.group_has_members_besides_leader(process_group_id)
        }))
        .unwrap_or_else(|_| {
            probe_panicked.set(true);
            None
        })
    };
    if members() == Some(false) {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        signals.send_after_observed_exit(process_group_id, TERMINATE_PROCESS_GROUP_SIGNAL)
    }));
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if aborted() || members() == Some(false) {
            return;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}

#[cfg(test)]
#[path = "agent_task_process_group_tests.rs"]
mod tests;
