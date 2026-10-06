use super::{
    agent_launch::AgentLaunchOptions,
    claude_session_policy::{
        choose_eviction, decide_session_disposition, idle_retirement_due, inspect_session,
        ClaudeSessionBackgroundReply, ClaudeSessionBackgroundTask, ClaudeSessionBackgroundTaskType,
        ClaudeSessionBackgroundTasksEvent, ClaudeSessionBackgroundTurnEvent,
        ClaudeSessionDisposition, ClaudeSessionEndReason, ClaudeSessionEndedEvent,
        ClaudeSessionFingerprint, ClaudeSessionInspection, ClaudeSessionKey,
        ClaudeSessionRestartPolicy, ClaudeSessionTuning, EvictionCandidate, LiveSessionFacts,
        RequestedSessionFacts, SessionAvailability, CLAUDE_SESSION_BUSY_ERROR,
        CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR, CLAUDE_SESSION_STOP_TIMEOUT_ERROR,
    },
    claude_session_router::{
        BackgroundTaskKind, ClaudeBackgroundReply, ClaudeBackgroundTasks, ClaudeBackgroundTurn,
        LiveBackgroundTask,
    },
    claude_session_task_stop::ClaudeBackgroundTaskStopOutcome,
    claude_thread_session::{
        ClaudeSessionIdentity, ClaudeSessionOwner, ClaudeThreadSession, IdleTermination,
    },
};
use crate::agent_task_supervisor::AgentProcessGroupSignalSender;
use std::{
    collections::HashMap,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::Child,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard, PoisonError, Weak,
    },
    time::{Duration, Instant},
};

pub const CLAUDE_SESSION_ADMISSION_CLOSED_ERROR: &str = "Agent task startup is closed.";
pub const CLAUDE_SESSION_ENDED_DURING_START_ERROR: &str =
    "Claude exited while its thread session was starting.";
const REUSE_DECISION_ATTEMPTS: usize = 2;

pub trait ClaudeSessionEventSink: Send + Sync {
    fn ended(&self, event: ClaudeSessionEndedEvent);

    fn background_turn(&self, event: ClaudeSessionBackgroundTurnEvent);

    fn background_tasks(&self, event: ClaudeSessionBackgroundTasksEvent);
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionRequest {
    pub key: ClaudeSessionKey,
    pub repository_root: PathBuf,
    pub fingerprint: ClaudeSessionFingerprint,
    pub resume_session_id: Option<String>,
    pub restart: ClaudeSessionRestartPolicy,
}

type SessionSnapshot = (
    Option<Arc<ClaudeThreadSession>>,
    Vec<Arc<ClaudeThreadSession>>,
);

pub enum ClaudeSessionLease {
    Session(Arc<ClaudeThreadSession>),
    Ephemeral,
}

pub struct ClaudeSessionRegistry {
    inner: Arc<RegistryInner>,
}

struct RegistryInner {
    state: Mutex<RegistryState>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    events: Arc<dyn ClaudeSessionEventSink>,
    tuning: ClaudeSessionTuning,
    next_generation: AtomicU64,
}

#[derive(Default)]
struct RegistryState {
    sessions: HashMap<ClaudeSessionKey, Arc<ClaudeThreadSession>>,
    starting: HashMap<ClaudeSessionKey, StartingSlot>,
    closed: bool,
}

#[derive(Default)]
struct StartingSlot {
    generation: Option<u64>,
    ended: bool,
}

struct StartingGuard {
    inner: Arc<RegistryInner>,
    key: ClaudeSessionKey,
}

impl StartingGuard {
    fn assign(&self, generation: u64) {
        if let Some(slot) = self.inner.state().starting.get_mut(&self.key) {
            slot.generation = Some(generation);
        }
    }
}

impl Drop for StartingGuard {
    fn drop(&mut self) {
        self.inner.state().starting.remove(&self.key);
    }
}

impl ClaudeSessionRegistry {
    pub fn new(
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        events: Arc<dyn ClaudeSessionEventSink>,
    ) -> Self {
        Self::with_tuning(signals, events, ClaudeSessionTuning::default())
    }

    pub fn with_tuning(
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        events: Arc<dyn ClaudeSessionEventSink>,
        tuning: ClaudeSessionTuning,
    ) -> Self {
        Self {
            inner: Arc::new(RegistryInner {
                state: Mutex::new(RegistryState::default()),
                signals,
                events,
                tuning,
                next_generation: AtomicU64::new(0),
            }),
        }
    }

    pub fn acquire(
        &self,
        request: &ClaudeSessionRequest,
        spawn: impl FnOnce() -> Result<(Child, i32), String>,
    ) -> Result<ClaudeSessionLease, String> {
        let (existing, displaced) = self.inner.snapshot(&request.key)?;
        for session in displaced {
            self.inner
                .end_and_wait(&session, ClaudeSessionEndReason::Released)?;
        }
        if let Some(session) = existing {
            if self.inner.keep_or_end(&session, request)? {
                self.inner.ensure_open()?;
                return Ok(ClaudeSessionLease::Session(session));
            }
        }
        let Some(starting) = self.inner.reserve_slot(&request.key)? else {
            return Ok(ClaudeSessionLease::Ephemeral);
        };
        let spawned = spawn()?;
        let generation = self.inner.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
        starting.assign(generation);
        let owner: Weak<RegistryInner> = Arc::downgrade(&self.inner);
        let owner: Weak<dyn ClaudeSessionOwner> = owner;
        let session = ClaudeThreadSession::start(
            ClaudeSessionIdentity {
                key: request.key.clone(),
                generation,
                fingerprint: request.fingerprint.clone(),
                repository_root: request.repository_root.clone(),
            },
            spawned,
            Arc::clone(&self.inner.signals),
            self.inner.tuning,
            owner,
        )?;
        session.pin_for_attach();
        self.inner.insert(&request.key, &session)?;
        drop(starting);
        Ok(ClaudeSessionLease::Session(session))
    }

    pub fn end_for_thread(
        &self,
        workspace_id: &str,
        thread_id: &str,
        reason: ClaudeSessionEndReason,
    ) -> bool {
        let key = ClaudeSessionKey {
            workspace_id: workspace_id.to_string(),
            thread_id: thread_id.to_string(),
        };
        let session = self.inner.state().sessions.get(&key).cloned();
        let Some(session) = session else {
            return false;
        };
        session.terminate(reason);
        true
    }

    pub fn stop_background_task(
        &self,
        workspace_id: &str,
        thread_id: &str,
        task_id: &str,
        deadline: Instant,
    ) -> ClaudeBackgroundTaskStopOutcome {
        let key = ClaudeSessionKey {
            workspace_id: workspace_id.to_string(),
            thread_id: thread_id.to_string(),
        };
        let session = self.inner.state().sessions.get(&key).cloned();
        let Some(session) = session else {
            return ClaudeBackgroundTaskStopOutcome::NoSession;
        };
        if !self.inner.is_current(&key, session.generation()) {
            return ClaudeBackgroundTaskStopOutcome::NoSession;
        }
        session.stop_background_task(task_id, deadline)
    }

    pub fn end_for_thread_under_root(
        &self,
        thread_id: &str,
        root: &Path,
        reason: ClaudeSessionEndReason,
    ) -> bool {
        let sessions: Vec<Arc<ClaudeThreadSession>> = self
            .inner
            .state()
            .sessions
            .values()
            .filter(|session| {
                session.key().thread_id == thread_id
                    && (session.repository_root().starts_with(root)
                        || session.cwd().starts_with(root))
            })
            .cloned()
            .collect();
        for session in &sessions {
            session.terminate(reason);
        }
        !sessions.is_empty()
    }

    pub fn end_for_root(
        &self,
        workspace_id: Option<&str>,
        root: &Path,
        reason: ClaudeSessionEndReason,
    ) {
        for session in self.inner.matching(workspace_id, root) {
            session.terminate(reason);
        }
    }

    pub fn end_for_workspace(&self, workspace_id: &str, reason: ClaudeSessionEndReason) {
        let sessions: Vec<Arc<ClaudeThreadSession>> = self
            .inner
            .state()
            .sessions
            .values()
            .filter(|session| session.key().workspace_id == workspace_id)
            .cloned()
            .collect();
        for session in sessions {
            session.terminate(reason);
        }
    }

    pub fn end_for_root_and_reap(&self, root: &Path, timeout: Duration) -> bool {
        let sessions = self.inner.matching(None, root);
        for session in &sessions {
            session.terminate(ClaudeSessionEndReason::Released);
        }
        wait_all_reaped(&sessions, Instant::now() + timeout)
    }

    pub fn close_admission(&self) {
        self.inner.state().closed = true;
    }

    pub fn shutdown_all(&self) -> bool {
        self.close_admission();
        let sessions = self.inner.all();
        for session in &sessions {
            session.terminate(ClaudeSessionEndReason::Shutdown);
        }
        wait_all_reaped(&sessions, Instant::now() + self.inner.tuning.end_timeout())
    }

    pub fn retire_idle(&self, now: Instant) {
        for session in self.inner.all() {
            let facts = session.facts();
            let due = idle_retirement_due(
                &self.inner.tuning,
                facts.availability,
                session.background_tasks() > 0,
                facts.idle_since,
                now,
            );
            if due {
                session.terminate_if_idle(ClaudeSessionEndReason::IdleTimeout);
            }
        }
    }

    pub fn retire_idle_for_update(&self) {
        for session in self.inner.all() {
            session.terminate_if_idle(ClaudeSessionEndReason::ProviderUpdated);
        }
    }

    pub fn inspect(
        &self,
        workspace_id: &str,
        thread_id: &str,
        launch: &AgentLaunchOptions,
        resume_session_id: Option<&str>,
        provider_generation: u64,
    ) -> ClaudeSessionInspection {
        let key = ClaudeSessionKey {
            workspace_id: workspace_id.to_string(),
            thread_id: thread_id.to_string(),
        };
        let session = self.inner.state().sessions.get(&key).cloned();
        let Some(session) = session else {
            return ClaudeSessionInspection::None;
        };
        let facts = session.facts();
        let background = session.background_tasks() > 0;
        inspect_session(
            Some((
                LiveSessionFacts {
                    fingerprint: &facts.fingerprint,
                    conversation: facts.conversation.as_deref(),
                    availability: facts.availability,
                },
                background,
            )),
            launch,
            resume_session_id,
            provider_generation,
        )
    }

    pub fn live_sessions(&self) -> usize {
        self.inner.state().sessions.len()
    }

    #[cfg(test)]
    pub fn deliver_background_turn_for_tests(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        turn: ClaudeBackgroundTurn,
    ) {
        self.inner.background_turn(key, generation, turn);
    }

    #[cfg(test)]
    pub fn deliver_background_tasks_for_tests(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        tasks: ClaudeBackgroundTasks,
    ) {
        let _ = self.inner.background_tasks(key, generation, tasks);
    }
}

impl Drop for ClaudeSessionRegistry {
    fn drop(&mut self) {
        self.close_admission();
        for session in self.inner.all() {
            session.kill_now(ClaudeSessionEndReason::Shutdown);
        }
    }
}

impl RegistryInner {
    fn state(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn all(&self) -> Vec<Arc<ClaudeThreadSession>> {
        self.state().sessions.values().cloned().collect()
    }

    fn ensure_open(&self) -> Result<(), String> {
        if self.state().closed {
            return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
        }
        Ok(())
    }

    fn matching(&self, workspace_id: Option<&str>, root: &Path) -> Vec<Arc<ClaudeThreadSession>> {
        self.state()
            .sessions
            .values()
            .filter(|session| {
                workspace_id.is_none_or(|expected| session.key().workspace_id == expected)
                    && (session.repository_root() == root || session.cwd().starts_with(root))
            })
            .cloned()
            .collect()
    }

    fn snapshot(&self, key: &ClaudeSessionKey) -> Result<SessionSnapshot, String> {
        let state = self.state();
        if state.closed {
            return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
        }
        if state.starting.contains_key(key) {
            return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
        }
        let displaced = state
            .sessions
            .iter()
            .filter(|(candidate, _)| {
                candidate.thread_id == key.thread_id && candidate.workspace_id != key.workspace_id
            })
            .map(|(_, session)| Arc::clone(session))
            .collect();
        Ok((state.sessions.get(key).cloned(), displaced))
    }

    fn keep_or_end(
        &self,
        session: &Arc<ClaudeThreadSession>,
        request: &ClaudeSessionRequest,
    ) -> Result<bool, String> {
        for _ in 0..REUSE_DECISION_ATTEMPTS {
            let facts = session.facts();
            let disposition = decide_session_disposition(
                Some(LiveSessionFacts {
                    fingerprint: &facts.fingerprint,
                    conversation: facts.conversation.as_deref(),
                    availability: facts.availability,
                }),
                RequestedSessionFacts {
                    fingerprint: &request.fingerprint,
                    resume_session_id: request.resume_session_id.as_deref(),
                },
            );
            match disposition {
                ClaudeSessionDisposition::Reuse => {
                    if session.pin_for_attach() {
                        return Ok(true);
                    }
                }
                ClaudeSessionDisposition::Busy => return Err(CLAUDE_SESSION_BUSY_ERROR.to_string()),
                ClaudeSessionDisposition::Spawn => return Ok(false),
                ClaudeSessionDisposition::Restart(reason) => {
                    return self.restart(session, request, reason.needs_confirmation())
                }
            }
        }
        Err(CLAUDE_SESSION_BUSY_ERROR.to_string())
    }

    fn restart(
        &self,
        session: &Arc<ClaudeThreadSession>,
        request: &ClaudeSessionRequest,
        needs_confirmation: bool,
    ) -> Result<bool, String> {
        let consent_required =
            needs_confirmation && request.restart == ClaudeSessionRestartPolicy::RefuseIfBackground;
        let termination = match consent_required {
            true => session
                .terminate_if_idle_without_background_tasks(ClaudeSessionEndReason::Restarted),
            false => match session.terminate_if_idle(ClaudeSessionEndReason::Restarted) {
                true => IdleTermination::Requested,
                false => IdleTermination::NotIdle,
            },
        };
        if termination == IdleTermination::BackgroundTasks {
            return Err(CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR.to_string());
        }
        if termination == IdleTermination::NotIdle && !session.is_ending() {
            return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
        }
        self.wait_and_remove(session)?;
        Ok(false)
    }

    fn reserve_slot(
        self: &Arc<Self>,
        key: &ClaudeSessionKey,
    ) -> Result<Option<StartingGuard>, String> {
        for _ in 0..self.tuning.max_live_sessions.max(1) {
            let sessions = {
                let mut state = self.state();
                if state.closed {
                    return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
                }
                if state.starting.contains_key(key) || state.sessions.contains_key(key) {
                    return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
                }
                if state.sessions.len() + state.starting.len() < self.tuning.max_live_sessions {
                    state.starting.insert(key.clone(), StartingSlot::default());
                    return Ok(Some(StartingGuard {
                        inner: Arc::clone(self),
                        key: key.clone(),
                    }));
                }
                state.sessions.values().cloned().collect::<Vec<_>>()
            };
            let candidates: Vec<EvictionCandidate> = sessions
                .iter()
                .map(|session| {
                    let facts = session.facts();
                    EvictionCandidate {
                        key: session.key().clone(),
                        generation: facts.generation,
                        attached: facts.availability != SessionAvailability::Idle,
                        background: session.background_tasks() > 0,
                        last_activity: facts.last_activity,
                    }
                })
                .collect();
            let victim = choose_eviction(&candidates)
                .and_then(|key| sessions.iter().find(|session| session.key() == key));
            let Some(victim) = victim else {
                return Ok(None);
            };
            self.retire_and_wait(victim, ClaudeSessionEndReason::Evicted)?;
        }
        Ok(None)
    }

    fn insert(
        &self,
        key: &ClaudeSessionKey,
        session: &Arc<ClaudeThreadSession>,
    ) -> Result<(), String> {
        let refusal = {
            let mut state = self.state();
            let ended = state.starting.get(key).is_some_and(|slot| slot.ended);
            match (state.closed, ended, state.sessions.contains_key(key)) {
                (true, _, _) => Some(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR),
                (false, true, _) => Some(CLAUDE_SESSION_ENDED_DURING_START_ERROR),
                (false, false, true) => Some(CLAUDE_SESSION_BUSY_ERROR),
                (false, false, false) => {
                    state.sessions.insert(key.clone(), Arc::clone(session));
                    None
                }
            }
        };
        let Some(error) = refusal else {
            return Ok(());
        };
        session.kill_now(ClaudeSessionEndReason::Shutdown);
        Err(error.to_string())
    }

    fn end_and_wait(
        &self,
        session: &Arc<ClaudeThreadSession>,
        reason: ClaudeSessionEndReason,
    ) -> Result<(), String> {
        session.terminate(reason);
        self.wait_and_remove(session)
    }

    fn retire_and_wait(
        &self,
        session: &Arc<ClaudeThreadSession>,
        reason: ClaudeSessionEndReason,
    ) -> Result<(), String> {
        if !session.terminate_if_idle(reason) {
            return Ok(());
        }
        self.wait_and_remove(session)
    }

    fn wait_and_remove(&self, session: &Arc<ClaudeThreadSession>) -> Result<(), String> {
        if !session.wait_reaped(self.tuning.end_timeout()) {
            return Err(CLAUDE_SESSION_STOP_TIMEOUT_ERROR.to_string());
        }
        let mut state = self.state();
        if state
            .sessions
            .get(session.key())
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            state.sessions.remove(session.key());
        }
        Ok(())
    }

    fn is_current(&self, key: &ClaudeSessionKey, generation: u64) -> bool {
        self.state()
            .sessions
            .get(key)
            .is_some_and(|session| session.generation() == generation)
    }
}

impl ClaudeSessionOwner for RegistryInner {
    fn session_ended(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        reason: ClaudeSessionEndReason,
        background_tasks_live: bool,
    ) {
        let admitted = {
            let mut state = self.state();
            let admitted = state
                .sessions
                .get(key)
                .is_some_and(|session| session.generation() == generation);
            if admitted {
                state.sessions.remove(key);
            }
            if let Some(slot) = state
                .starting
                .get_mut(key)
                .filter(|slot| slot.generation == Some(generation))
            {
                slot.ended = true;
            }
            admitted
        };
        if !admitted {
            return;
        }
        let event = ClaudeSessionEndedEvent {
            workspace_id: key.workspace_id.clone(),
            thread_id: key.thread_id.clone(),
            reason,
            background_tasks_live,
        };
        let _ = catch_unwind(AssertUnwindSafe(|| self.events.ended(event)));
    }

    fn background_turn(&self, key: &ClaudeSessionKey, generation: u64, turn: ClaudeBackgroundTurn) {
        if !self.is_current(key, generation) {
            return;
        }
        let event = ClaudeSessionBackgroundTurnEvent::from_output(
            key,
            turn.output,
            turn.truncated,
            turn.complete,
        );
        let _ = catch_unwind(AssertUnwindSafe(|| self.events.background_turn(event)));
    }

    fn background_tasks(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        tasks: ClaudeBackgroundTasks,
    ) -> bool {
        if !self.is_current(key, generation) {
            return false;
        }
        let event = ClaudeSessionBackgroundTasksEvent {
            workspace_id: key.workspace_id.clone(),
            thread_id: key.thread_id.clone(),
            total: tasks.total,
            agents: tasks.agents,
            tasks: tasks.tasks.into_iter().map(wire_background_task).collect(),
            reply: wire_background_reply(tasks.reply),
        };
        let _ = catch_unwind(AssertUnwindSafe(|| self.events.background_tasks(event)));
        true
    }
}

fn wire_background_task(task: LiveBackgroundTask) -> ClaudeSessionBackgroundTask {
    ClaudeSessionBackgroundTask {
        task_id: task.task_id,
        task_type: match task.kind {
            BackgroundTaskKind::Agent => ClaudeSessionBackgroundTaskType::Agent,
            BackgroundTaskKind::Shell => ClaudeSessionBackgroundTaskType::Shell,
            BackgroundTaskKind::Monitor => ClaudeSessionBackgroundTaskType::Monitor,
            BackgroundTaskKind::Other => ClaudeSessionBackgroundTaskType::Other,
        },
        description: task.description,
    }
}

fn wire_background_reply(reply: ClaudeBackgroundReply) -> ClaudeSessionBackgroundReply {
    match reply {
        ClaudeBackgroundReply::None => ClaudeSessionBackgroundReply::None,
        ClaudeBackgroundReply::InProgress => ClaudeSessionBackgroundReply::InProgress,
    }
}

fn wait_all_reaped(sessions: &[Arc<ClaudeThreadSession>], deadline: Instant) -> bool {
    sessions
        .iter()
        .all(|session| session.wait_reaped(deadline.saturating_duration_since(Instant::now())))
}
