use super::{
    agent_claude_questions::{permission_denial_frame, unsupported_request_frame},
    agent_task_input::{
        claude_lifecycle::{command_id, ClaudeInputLifecycle},
        RetainedAgentStdin, RetainedChildStdin,
    },
    claude_session_policy::{
        ClaudeSessionEndReason, ClaudeSessionFingerprint, ClaudeSessionKey, ClaudeSessionTuning,
        SessionAvailability, CLAUDE_SESSION_BUSY_ERROR,
    },
    claude_session_router::{
        ClaudeBackgroundTasks, ClaudeBackgroundTurn, ClaudeSessionRouter, RouterStep,
    },
    claude_session_task_stop::{stop_task_frame, ClaudeBackgroundTaskStopOutcome},
    claude_session_turn::ClaudeSessionTurnChild,
    configure_agent_output_reader, exit_code_of, observe_exit_without_reaping, reap_child,
    AGENT_STDIN_FRAME_DEADLINE,
};
use crate::agent_task_supervisor::{
    split_output_chunks, terminate_group_survivors, AgentProcessGroupSignalSender,
    KILL_PROCESS_GROUP_SIGNAL, TERMINATE_PROCESS_GROUP_SIGNAL,
};
use std::{
    io::{self, Read},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdout},
    sync::{
        mpsc::{sync_channel, SyncSender, TrySendError},
        Arc, Condvar, Mutex, MutexGuard, PoisonError, TryLockError, Weak,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const SESSION_POLL: Duration = Duration::from_millis(10);
const TURN_CHANNEL_CAPACITY: usize = 64;
const SESSION_OUTPUT_CHUNK_BYTES: usize = 8 * 1024;
const SESSION_READER_FAILED: &str = "Claude session output reader failed.";
const SESSION_INPUT_FAILED: &str = "Claude session input failed.";
const SESSION_ENDED_ERROR: &str = "This thread's Claude session has ended.";
const SESSION_ATTACH_PIN: Duration = Duration::from_secs(30);
const SESSION_COMMAND_CANCELLED: &str = "Claude cancelled this message.";
const BACKGROUND_PERMISSION_DENIAL: &str =
    "Codevo cannot ask for permission during a background turn.";
const UNOWNED_ANSWER_DEADLINE: Duration = Duration::from_secs(5);

pub trait ClaudeSessionOwner: Send + Sync {
    fn session_ended(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        reason: ClaudeSessionEndReason,
        background_tasks_live: bool,
    );

    fn background_turn(&self, key: &ClaudeSessionKey, generation: u64, turn: ClaudeBackgroundTurn);

    fn background_tasks(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        tasks: ClaudeBackgroundTasks,
    ) -> bool;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnOutcome {
    Settled,
    FailedResult,
    Interrupted,
    ProcessExited(i32),
    Failed(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdleTermination {
    Requested,
    NotIdle,
    BackgroundTasks,
}

#[derive(Default)]
pub struct TurnSettlement {
    outcome: Mutex<Option<TurnOutcome>>,
}

impl TurnSettlement {
    pub fn outcome(&self) -> Option<TurnOutcome> {
        *lock(&self.outcome)
    }

    fn settle(&self, outcome: TurnOutcome) {
        lock(&self.outcome).get_or_insert(outcome);
    }
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionIdentity {
    pub key: ClaudeSessionKey,
    pub generation: u64,
    pub fingerprint: ClaudeSessionFingerprint,
    pub repository_root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionFacts {
    pub availability: SessionAvailability,
    pub fingerprint: ClaudeSessionFingerprint,
    pub conversation: Option<String>,
    pub generation: u64,
    pub idle_since: Instant,
    pub last_activity: Instant,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SessionPhase {
    Idle,
    Attached,
    Ending,
    Dead,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SessionStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BackgroundTaskConsent {
    Given,
    Required,
}

#[derive(Clone, Copy)]
enum FrameWrite {
    First,
    Subsequent,
}

enum InterruptPlan {
    AlreadyRequested,
    SettledNaturally(AttachedTurn, TurnOutcome),
    Write(String),
}

struct AttachedTurn {
    turn: u64,
    stdout: SyncSender<Vec<u8>>,
    stderr: SyncSender<Vec<u8>>,
    settlement: Arc<TurnSettlement>,
    lifecycle: Arc<ClaudeInputLifecycle>,
    initial_frame_written: bool,
    interrupt_deadline: Option<Instant>,
}

struct SessionState {
    phase: SessionPhase,
    attached: Option<AttachedTurn>,
    next_turn: u64,
    first_frame_written: bool,
    idle_since: Instant,
    last_activity: Instant,
    end_reason: Option<ClaudeSessionEndReason>,
    ending_since: Option<Instant>,
    force_sent: bool,
    reaping: bool,
    reported: bool,
    stdout_closed_at: Option<Instant>,
    background_tasks_at_end: bool,
    pinned_until: Option<Instant>,
}

impl SessionState {
    fn pinned(&self) -> bool {
        self.pinned_until
            .is_some_and(|until| Instant::now() < until)
    }

    fn idle(&self) -> bool {
        self.phase == SessionPhase::Idle && !self.pinned()
    }

    fn begin_end(&mut self, reason: ClaudeSessionEndReason, background_tasks_live: bool) -> bool {
        if self.phase == SessionPhase::Dead || self.end_reason.is_some() {
            return false;
        }
        self.end_reason = Some(reason);
        self.ending_since = Some(Instant::now());
        self.background_tasks_at_end = background_tasks_live;
        self.phase = SessionPhase::Ending;
        true
    }

    fn release_attached(&mut self) -> Option<AttachedTurn> {
        if self.phase == SessionPhase::Attached {
            self.phase = SessionPhase::Idle;
            self.idle_since = Instant::now();
        }
        self.attached.take()
    }

    fn end_summary(
        &self,
        exit_code: i32,
        tasks_live_at_exit: bool,
    ) -> (ClaudeSessionEndReason, bool) {
        let reason = self.end_reason.unwrap_or(match exit_code {
            0 => ClaudeSessionEndReason::Exited,
            _ => ClaudeSessionEndReason::Crashed,
        });
        (reason, self.background_tasks_at_end || tasks_live_at_exit)
    }
}

pub struct ClaudeThreadSession {
    identity: ClaudeSessionIdentity,
    process_group_id: i32,
    stdin: RetainedChildStdin,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    tuning: ClaudeSessionTuning,
    owner: Weak<dyn ClaudeSessionOwner>,
    state: Mutex<SessionState>,
    dead: Condvar,
    router: Mutex<ClaudeSessionRouter>,
    input_order: Mutex<()>,
    notifications: Mutex<bool>,
}

impl ClaudeThreadSession {
    pub fn start(
        identity: ClaudeSessionIdentity,
        spawned: (Child, i32),
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        tuning: ClaudeSessionTuning,
        owner: Weak<dyn ClaudeSessionOwner>,
    ) -> Result<Arc<Self>, String> {
        let (mut child, process_group_id) = spawned;
        let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
            abandon_child(signals.as_ref(), process_group_id, &mut child);
            return Err("Claude session pipes are unavailable.".to_string());
        };
        let configured = configure_agent_output_reader(&stdout)
            .and_then(|()| configure_agent_output_reader(&stderr));
        if let Err(error) = configured {
            abandon_child(signals.as_ref(), process_group_id, &mut child);
            return Err(error);
        }
        let now = Instant::now();
        let session = Arc::new(Self {
            identity,
            process_group_id,
            stdin: Arc::new(RetainedAgentStdin::new(stdin)),
            signals,
            tuning,
            owner,
            state: Mutex::new(SessionState {
                phase: SessionPhase::Idle,
                attached: None,
                next_turn: 0,
                first_frame_written: false,
                idle_since: now,
                last_activity: now,
                end_reason: None,
                ending_since: None,
                force_sent: false,
                reaping: false,
                reported: false,
                stdout_closed_at: None,
                background_tasks_at_end: false,
                pinned_until: None,
            }),
            dead: Condvar::new(),
            router: Mutex::new(ClaudeSessionRouter::new()),
            input_order: Mutex::new(()),
            notifications: Mutex::new(false),
        });
        let readers = match session.spawn_readers(stdout, stderr) {
            Ok(readers) => readers,
            Err(error) => {
                session.abandon_started(&mut child);
                return Err(error);
            }
        };
        let slot = Arc::new(Mutex::new(Some(child)));
        let waiter_slot = Arc::clone(&slot);
        let waiter = Arc::clone(&session);
        let spawned_waiter = thread::Builder::new()
            .name("claude-session-waiter".to_string())
            .spawn(move || {
                let child = lock(&waiter_slot).take();
                if let Some(child) = child {
                    waiter.run_waiter(child, readers);
                }
            });
        if let Err(error) = spawned_waiter {
            if let Some(mut child) = lock(&slot).take() {
                session.abandon_started(&mut child);
            }
            return Err(format!(
                "Unable to start the Claude session waiter: {error}"
            ));
        }
        Ok(session)
    }

    pub fn attach_turn(self: &Arc<Self>, frame: &[u8]) -> Result<ClaudeSessionTurnChild, String> {
        let lifecycle = Arc::new(ClaudeInputLifecycle::new());
        let (stdout_sender, stdout_receiver) = sync_channel(TURN_CHANNEL_CAPACITY);
        let (stderr_sender, stderr_receiver) = sync_channel(TURN_CHANNEL_CAPACITY);
        let settlement = Arc::new(TurnSettlement::default());
        let (turn, write) = {
            let mut router = lock(&self.router);
            let mut state = self.state();
            if state.end_reason.is_some()
                || matches!(state.phase, SessionPhase::Ending | SessionPhase::Dead)
            {
                return Err(SESSION_ENDED_ERROR.to_string());
            }
            if state.phase != SessionPhase::Idle {
                return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
            }
            state.next_turn += 1;
            let turn = state.next_turn;
            state.phase = SessionPhase::Attached;
            state.pinned_until = None;
            state.last_activity = Instant::now();
            state.attached = Some(AttachedTurn {
                turn,
                stdout: stdout_sender,
                stderr: stderr_sender,
                settlement: Arc::clone(&settlement),
                lifecycle: Arc::clone(&lifecycle),
                initial_frame_written: false,
                interrupt_deadline: None,
            });
            router.attach(Arc::clone(&lifecycle));
            let write = match std::mem::replace(&mut state.first_frame_written, true) {
                false => FrameWrite::First,
                true => FrameWrite::Subsequent,
            };
            (turn, write)
        };
        self.write_initial_frame(turn, lifecycle.initial_frame(frame), write);
        Ok(ClaudeSessionTurnChild::new(
            Arc::clone(self),
            turn,
            settlement,
            stdout_receiver,
            stderr_receiver,
            lifecycle,
        ))
    }

    pub(crate) fn write_turn_frame(
        &self,
        turn: u64,
        frame: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        self.await_initial_frame(turn, deadline, io::ErrorKind::NotConnected)?;
        let _order = lock_before(&self.input_order, deadline)?;
        let attached = self
            .state()
            .attached
            .as_ref()
            .is_some_and(|attached| attached.turn == turn);
        if !attached {
            return Err(io::ErrorKind::NotConnected.into());
        }
        self.write_stdin(turn, frame, deadline)
    }

    pub(crate) fn write_control_frame(
        &self,
        turn: u64,
        frame: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        self.write_stdin(turn, frame, deadline)
    }

    pub(crate) fn interrupt_turn(&self, turn: u64, deadline: Instant) -> io::Result<()> {
        self.await_initial_frame(turn, deadline, io::ErrorKind::WouldBlock)
            .map_err(unavailable_on_timeout)?;
        let _order = lock_before(&self.input_order, deadline).map_err(unavailable_on_timeout)?;
        let request_id = match self.prepare_interrupt(turn)? {
            InterruptPlan::AlreadyRequested => return Ok(()),
            InterruptPlan::SettledNaturally(finished, outcome) => {
                finished.settlement.settle(outcome);
                return Ok(());
            }
            InterruptPlan::Write(request_id) => request_id,
        };
        let written = self.write_stdin(turn, &interrupt_frame(&request_id), deadline);
        match written {
            Err(error) if !self.stdin.is_broken() => {
                self.withdraw_interrupt(turn, &request_id);
                Err(unavailable_on_timeout(error))
            }
            written => written,
        }
    }

    fn withdraw_interrupt(&self, turn: u64, request_id: &str) {
        let mut router = lock(&self.router);
        let mut state = self.state();
        let Some(attached) = state
            .attached
            .as_mut()
            .filter(|attached| attached.turn == turn && router.is_attached_to(&attached.lifecycle))
        else {
            return;
        };
        attached.interrupt_deadline = None;
        attached.lifecycle.withdraw_interrupt();
        router.withdraw_interrupt(request_id);
    }

    fn prepare_interrupt(&self, turn: u64) -> io::Result<InterruptPlan> {
        let mut router = lock(&self.router);
        let mut state = self.state();
        let ending = state.end_reason.is_some();
        let Some(attached) = state
            .attached
            .as_mut()
            .filter(|attached| attached.turn == turn && router.is_attached_to(&attached.lifecycle))
        else {
            return Err(io::ErrorKind::WouldBlock.into());
        };
        if attached.interrupt_deadline.is_some() {
            return Ok(InterruptPlan::AlreadyRequested);
        }
        let natural = (!ending)
            .then(|| router.settle_finished_foreground())
            .flatten();
        if let Some(step) = natural {
            return Ok(state
                .release_attached()
                .map_or(InterruptPlan::AlreadyRequested, |finished| {
                    InterruptPlan::SettledNaturally(finished, settled_outcome(&step))
                }));
        }
        let request_id = command_id();
        attached.interrupt_deadline = Some(Instant::now() + self.tuning.interrupt_deadline);
        attached.lifecycle.begin_interrupt();
        router.interrupt_sent(request_id.clone());
        Ok(InterruptPlan::Write(request_id))
    }

    pub fn stop_background_task(
        &self,
        task_id: &str,
        deadline: Instant,
    ) -> ClaudeBackgroundTaskStopOutcome {
        let Ok(order) = lock_before(&self.input_order, deadline) else {
            return ClaudeBackgroundTaskStopOutcome::Unavailable;
        };
        let request_id = command_id();
        if let Err(refusal) = self.prepare_task_stop(task_id, &request_id) {
            return refusal;
        }
        let written = self
            .stdin
            .write_frame(&stop_task_frame(&request_id, task_id), deadline);
        drop(order);
        if written.is_err() {
            lock(&self.router).withdraw_task_stop(&request_id);
            if self.stdin.is_broken() {
                self.terminate(ClaudeSessionEndReason::InputFailed);
            }
            return ClaudeBackgroundTaskStopOutcome::Unavailable;
        }
        self.await_task_stop_reply(&request_id, deadline)
    }

    fn prepare_task_stop(
        &self,
        task_id: &str,
        request_id: &str,
    ) -> Result<(), ClaudeBackgroundTaskStopOutcome> {
        let mut router = lock(&self.router);
        let state = self.state();
        if state.end_reason.is_some()
            || matches!(state.phase, SessionPhase::Ending | SessionPhase::Dead)
        {
            return Err(ClaudeBackgroundTaskStopOutcome::NoSession);
        }
        if !router.live_background_task(task_id) {
            return Err(ClaudeBackgroundTaskStopOutcome::NotLive);
        }
        if !router.begin_task_stop(request_id.to_string()) {
            return Err(ClaudeBackgroundTaskStopOutcome::Unavailable);
        }
        Ok(())
    }

    fn await_task_stop_reply(
        &self,
        request_id: &str,
        deadline: Instant,
    ) -> ClaudeBackgroundTaskStopOutcome {
        loop {
            if let Some(outcome) = self.poll_task_stop_reply(request_id, deadline) {
                return outcome;
            }
            thread::sleep(SESSION_POLL);
        }
    }

    fn poll_task_stop_reply(
        &self,
        request_id: &str,
        deadline: Instant,
    ) -> Option<ClaudeBackgroundTaskStopOutcome> {
        let mut router = lock(&self.router);
        if let Some(reply) = router.take_task_stop_reply(request_id) {
            return Some(reply.outcome());
        }
        let outcome = match (self.is_ending(), Instant::now() >= deadline) {
            (true, _) => ClaudeBackgroundTaskStopOutcome::NoSession,
            (false, true) => ClaudeBackgroundTaskStopOutcome::Unconfirmed,
            (false, false) => return None,
        };
        router.withdraw_task_stop(request_id);
        Some(outcome)
    }

    pub fn terminate(&self, reason: ClaudeSessionEndReason) {
        if !self.request_end(reason) {
            return;
        }
        self.stdin.request_close();
        self.signal_group(TERMINATE_PROCESS_GROUP_SIGNAL);
    }

    pub fn terminate_turn(&self, turn: u64, reason: ClaudeSessionEndReason) {
        if !self.request_turn_end(turn, reason) {
            return;
        }
        self.stdin.request_close();
        self.signal_group(TERMINATE_PROCESS_GROUP_SIGNAL);
    }

    pub fn pin_for_attach(&self) -> bool {
        let mut state = self.state();
        if !state.idle() || state.end_reason.is_some() {
            return false;
        }
        state.pinned_until = Some(Instant::now() + SESSION_ATTACH_PIN);
        true
    }

    pub fn is_ending(&self) -> bool {
        let state = self.state();
        state.end_reason.is_some() || state.phase == SessionPhase::Dead
    }

    pub fn terminate_if_idle(&self, reason: ClaudeSessionEndReason) -> bool {
        self.terminate_idle(reason, BackgroundTaskConsent::Given) == IdleTermination::Requested
    }

    pub fn terminate_if_idle_without_background_tasks(
        &self,
        reason: ClaudeSessionEndReason,
    ) -> IdleTermination {
        self.terminate_idle(reason, BackgroundTaskConsent::Required)
    }

    fn terminate_idle(
        &self,
        reason: ClaudeSessionEndReason,
        consent: BackgroundTaskConsent,
    ) -> IdleTermination {
        let termination = {
            let router = lock(&self.router);
            let mut state = self.state();
            let background =
                state.phase != SessionPhase::Dead && router.live_background_tasks() > 0;
            if background && consent == BackgroundTaskConsent::Required {
                return IdleTermination::BackgroundTasks;
            }
            if !state.idle() || !state.begin_end(reason, background) {
                return IdleTermination::NotIdle;
            }
            IdleTermination::Requested
        };
        self.stdin.request_close();
        self.signal_group(TERMINATE_PROCESS_GROUP_SIGNAL);
        termination
    }

    pub fn kill_now(&self, reason: ClaudeSessionEndReason) {
        self.request_end(reason);
        self.stdin.request_close();
        self.signal_group(KILL_PROCESS_GROUP_SIGNAL);
    }

    pub fn wait_reaped(&self, timeout: Duration) -> bool {
        let state = self.state();
        let (state, _) = self
            .dead
            .wait_timeout_while(state, timeout, |state| !state.reported)
            .unwrap_or_else(PoisonError::into_inner);
        state.reported
    }

    pub fn facts(&self) -> ClaudeSessionFacts {
        let conversation = lock(&self.router).conversation().map(str::to_string);
        let state = self.state();
        let idle_since = match state.phase {
            SessionPhase::Idle => state.idle_since.max(state.last_activity),
            SessionPhase::Attached | SessionPhase::Ending | SessionPhase::Dead => state.idle_since,
        };
        ClaudeSessionFacts {
            availability: match state.phase {
                SessionPhase::Idle if state.pinned() => SessionAvailability::Attached,
                SessionPhase::Idle => SessionAvailability::Idle,
                SessionPhase::Attached => SessionAvailability::Attached,
                SessionPhase::Ending | SessionPhase::Dead => SessionAvailability::Ending,
            },
            fingerprint: self.identity.fingerprint.clone(),
            conversation,
            generation: self.identity.generation,
            idle_since,
            last_activity: state.last_activity,
        }
    }

    pub fn background_tasks(&self) -> usize {
        let router = lock(&self.router);
        if self.phase() == SessionPhase::Dead {
            return 0;
        }
        router.live_background_tasks()
    }

    pub fn key(&self) -> &ClaudeSessionKey {
        &self.identity.key
    }

    pub fn generation(&self) -> u64 {
        self.identity.generation
    }

    pub fn repository_root(&self) -> &Path {
        &self.identity.repository_root
    }

    pub fn cwd(&self) -> &Path {
        &self.identity.fingerprint.cwd
    }

    fn state(&self) -> MutexGuard<'_, SessionState> {
        lock(&self.state)
    }

    fn phase(&self) -> SessionPhase {
        self.state().phase
    }

    fn end_requested(&self) -> bool {
        self.state().end_reason.is_some()
    }

    fn request_end(&self, reason: ClaudeSessionEndReason) -> bool {
        let router = lock(&self.router);
        let mut state = self.state();
        state.begin_end(reason, router.live_background_tasks() > 0)
    }

    fn request_turn_end(&self, turn: u64, reason: ClaudeSessionEndReason) -> bool {
        let router = lock(&self.router);
        let mut state = self.state();
        let owns_turn = state.attached.as_ref().is_some_and(|attached| {
            attached.turn == turn && router.is_attached_to(&attached.lifecycle)
        });
        owns_turn && state.begin_end(reason, router.live_background_tasks() > 0)
    }

    fn signal_group(&self, signal: i32) {
        let mut state = self.state();
        if signal == KILL_PROCESS_GROUP_SIGNAL {
            state.force_sent = true;
        }
        if state.reaping || state.phase == SessionPhase::Dead || self.process_group_id <= 0 {
            return;
        }
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals.send(self.process_group_id, signal)
        }));
    }

    fn await_initial_frame(
        &self,
        turn: u64,
        deadline: Instant,
        detached: io::ErrorKind,
    ) -> io::Result<()> {
        loop {
            let written = self
                .state()
                .attached
                .as_ref()
                .filter(|attached| attached.turn == turn)
                .map(|attached| attached.initial_frame_written);
            let Some(written) = written else {
                return Err(detached.into());
            };
            if written {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Claude session turn frame",
                ));
            }
            thread::sleep(SESSION_POLL);
        }
    }

    fn settle_turn(&self, turn: u64, outcome: TurnOutcome) {
        let finished = {
            let mut router = lock(&self.router);
            let mut state = self.state();
            if state
                .attached
                .as_ref()
                .is_none_or(|attached| attached.turn != turn)
            {
                return;
            }
            router.detach();
            state.release_attached()
        };
        let Some(finished) = finished else {
            return;
        };
        finished.settlement.settle(outcome);
    }

    fn fail_turn(&self, turn: Option<u64>, reason: ClaudeSessionEndReason, message: &'static str) {
        let (requested, failed) = {
            let mut router = lock(&self.router);
            let mut state = self.state();
            let requested = state.begin_end(reason, router.live_background_tasks() > 0);
            let owns_turn = state
                .attached
                .as_ref()
                .is_some_and(|attached| Some(attached.turn) == turn);
            let failed = match owns_turn {
                true => {
                    router.detach();
                    state.attached.take()
                }
                false => None,
            };
            (requested, failed)
        };
        if requested {
            self.stdin.request_close();
            self.signal_group(TERMINATE_PROCESS_GROUP_SIGNAL);
        }
        if let Some(failed) = failed {
            failed.settlement.settle(TurnOutcome::Failed(message));
        }
    }

    fn mark_initial_frame_written(&self, turn: u64) {
        let mut state = self.state();
        if let Some(attached) = state
            .attached
            .as_mut()
            .filter(|attached| attached.turn == turn)
        {
            attached.initial_frame_written = true;
        }
    }

    fn write_stdin(&self, turn: u64, frame: &[u8], deadline: Instant) -> io::Result<()> {
        let written = self.stdin.write_frame(frame, deadline);
        if written.is_err() && self.stdin.is_broken() {
            self.fail_input(turn);
        }
        written
    }

    fn fail_input(&self, turn: u64) {
        if self.end_requested() {
            return;
        }
        self.fail_turn(
            Some(turn),
            ClaudeSessionEndReason::InputFailed,
            SESSION_INPUT_FAILED,
        );
    }

    fn write_initial_frame(self: &Arc<Self>, turn: u64, frame: Vec<u8>, write: FrameWrite) {
        let session = Arc::clone(self);
        let spawned = thread::Builder::new()
            .name("claude-session-input".to_string())
            .spawn(move || {
                let deadline = Instant::now() + AGENT_STDIN_FRAME_DEADLINE;
                let written = lock_before(&session.input_order, deadline).and_then(|order| {
                    let written = match write {
                        FrameWrite::First => session.stdin.write_first_frame(&frame, deadline),
                        FrameWrite::Subsequent => session.stdin.write_frame(&frame, deadline),
                    };
                    drop(order);
                    written
                });
                if written.is_ok() {
                    session.mark_initial_frame_written(turn);
                    return;
                }
                session.fail_input(turn);
            });
        if spawned.is_ok() {
            return;
        }
        self.fail_input(turn);
    }

    fn enforce_deadlines(&self) {
        let now = Instant::now();
        let (interrupt_overdue, force_due, output_lost) = {
            let state = self.state();
            let overdue = state.end_reason.is_none()
                && state
                    .attached
                    .as_ref()
                    .and_then(|turn| turn.interrupt_deadline)
                    .is_some_and(|deadline| now >= deadline);
            let force_due = !state.force_sent
                && state
                    .ending_since
                    .is_some_and(|since| now.duration_since(since) >= self.tuning.graceful_stop);
            let output_lost = state.end_reason.is_none()
                && state
                    .stdout_closed_at
                    .is_some_and(|since| now.duration_since(since) >= self.tuning.reader_drain);
            (overdue, force_due, output_lost)
        };
        if interrupt_overdue {
            self.terminate(ClaudeSessionEndReason::InterruptTimedOut);
        }
        if output_lost {
            self.terminate(ClaudeSessionEndReason::ProtocolError);
        }
        if force_due {
            self.signal_group(KILL_PROCESS_GROUP_SIGNAL);
        }
    }

    fn wait_for_leader_exit(&self, child: &Child) -> bool {
        loop {
            match observe_exit_without_reaping(child) {
                Ok(true) => return true,
                Ok(false) => {}
                Err(_) => return false,
            }
            self.enforce_deadlines();
            thread::sleep(SESSION_POLL);
        }
    }

    fn run_waiter(self: Arc<Self>, mut child: Child, readers: Vec<JoinHandle<()>>) {
        let observed = catch_unwind(AssertUnwindSafe(|| self.wait_for_leader_exit(&child)));
        if !matches!(observed, Ok(true)) {
            self.kill_now(ClaudeSessionEndReason::Crashed);
            let _ = child.kill();
        }
        let cleaned = catch_unwind(AssertUnwindSafe(|| {
            self.clean_up_group();
            wait_for_readers(&readers, self.tuning.reader_drain);
        }));
        if cleaned.is_err() {
            self.kill_group_before_reap();
        }
        let tasks_live_at_exit = self.background_tasks() > 0;
        self.state().reaping = true;
        let exit_code = reap_child(&mut child).map(exit_code_of).unwrap_or(-1);
        let (reason, background_tasks_live) = catch_unwind(AssertUnwindSafe(|| {
            self.finish_dead(exit_code, tasks_live_at_exit)
        }))
        .unwrap_or_else(|_| self.mark_dead(exit_code, tasks_live_at_exit));
        self.report_ended(reason, background_tasks_live);
    }

    fn kill_group_before_reap(&self) {
        if self.process_group_id <= 0 {
            return;
        }
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send_after_observed_exit(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
    }

    fn report_ended(&self, reason: ClaudeSessionEndReason, background_tasks_live: bool) {
        let mut ended = lock(&self.notifications);
        *ended = true;
        if let Some(owner) = self.owner.upgrade() {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                owner.session_ended(
                    &self.identity.key,
                    self.identity.generation,
                    reason,
                    background_tasks_live,
                )
            }));
        }
        drop(ended);
        self.state().reported = true;
        self.dead.notify_all();
    }

    fn clean_up_group(&self) {
        if self.process_group_id <= 0 {
            return;
        }
        let grace = match self.end_requested() {
            true => Duration::ZERO,
            false => self.tuning.clean_exit_grace,
        };
        let aborted = || self.end_requested();
        terminate_group_survivors(
            self.signals.as_ref(),
            self.process_group_id,
            grace,
            &aborted,
        );
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send_after_observed_exit(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
    }

    fn finish_dead(
        &self,
        exit_code: i32,
        tasks_live_at_exit: bool,
    ) -> (ClaudeSessionEndReason, bool) {
        let (attached, summary) = {
            let mut router = lock(&self.router);
            router.detach();
            self.enter_dead(exit_code, tasks_live_at_exit)
        };
        settle_exited(attached, exit_code);
        summary
    }

    fn mark_dead(
        &self,
        exit_code: i32,
        tasks_live_at_exit: bool,
    ) -> (ClaudeSessionEndReason, bool) {
        let (attached, summary) = self.enter_dead(exit_code, tasks_live_at_exit);
        settle_exited(attached, exit_code);
        summary
    }

    fn enter_dead(
        &self,
        exit_code: i32,
        tasks_live_at_exit: bool,
    ) -> (Option<AttachedTurn>, (ClaudeSessionEndReason, bool)) {
        let mut state = self.state();
        state.phase = SessionPhase::Dead;
        (
            state.attached.take(),
            state.end_summary(exit_code, tasks_live_at_exit),
        )
    }

    fn abandon_started(&self, child: &mut Child) {
        if self.process_group_id > 0 {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                self.signals
                    .send(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL)
            }));
        }
        let _ = child.kill();
        {
            let mut state = self.state();
            state.reaping = true;
            state.phase = SessionPhase::Dead;
        }
        let _ = reap_child(child);
        self.state().reported = true;
        self.dead.notify_all();
    }

    fn spawn_readers(
        self: &Arc<Self>,
        stdout: ChildStdout,
        stderr: ChildStderr,
    ) -> Result<Vec<JoinHandle<()>>, String> {
        let out = Arc::clone(self);
        let stdout_reader = thread::Builder::new()
            .name("claude-session-stdout".to_string())
            .spawn(move || out.pump(stdout, SessionStream::Stdout))
            .map_err(|error| format!("Unable to start the Claude session reader: {error}"))?;
        let err = Arc::clone(self);
        let stderr_reader = thread::Builder::new()
            .name("claude-session-stderr".to_string())
            .spawn(move || err.pump(stderr, SessionStream::Stderr))
            .map_err(|error| format!("Unable to start the Claude session reader: {error}"))?;
        Ok(vec![stdout_reader, stderr_reader])
    }

    fn pump(&self, reader: impl Read, stream: SessionStream) {
        let pumped = catch_unwind(AssertUnwindSafe(|| {
            self.read_stream(reader, stream);
            if stream == SessionStream::Stdout {
                self.route_step(ClaudeSessionRouter::finish);
                self.state().stdout_closed_at = Some(Instant::now());
            }
        }));
        if pumped.is_ok() {
            return;
        }
        let attached = self.state().attached.as_ref().map(|turn| turn.turn);
        self.fail_turn(
            attached,
            ClaudeSessionEndReason::ProtocolError,
            SESSION_READER_FAILED,
        );
    }

    fn read_stream(&self, mut reader: impl Read, stream: SessionStream) {
        let mut buffer = vec![0_u8; SESSION_OUTPUT_CHUNK_BYTES];
        loop {
            if self.phase() == SessionPhase::Dead {
                return;
            }
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => match stream {
                    SessionStream::Stdout => {
                        self.route_step(|router| router.feed(&buffer[..count]))
                    }
                    SessionStream::Stderr => self.route_stderr(&buffer[..count]),
                },
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(SESSION_POLL)
                }
                Err(_) => return,
            }
        }
    }

    fn route_step(&self, advance: impl FnOnce(&mut ClaudeSessionRouter) -> RouterStep) {
        let (step, attached, background) = {
            let mut router = lock(&self.router);
            if self.phase() == SessionPhase::Dead {
                return;
            }
            let mut step = advance(&mut router);
            let background = step.background_tasks.take();
            let mut state = self.state();
            state.last_activity = Instant::now();
            let attached = state
                .attached
                .as_ref()
                .map(|turn| (turn.turn, turn.stdout.clone()));
            (step, attached, background)
        };
        if let Some((_, sender)) = &attached {
            self.send_output(sender, &step.turn_output);
        }
        let turn = attached.map(|(turn, _)| turn);
        if let (true, Some(turn)) = (step.settled, turn) {
            self.settle_turn(turn, settled_outcome(&step));
        }
        if let Some(message) = step.failure {
            self.fail_turn(turn, ClaudeSessionEndReason::ProtocolError, message);
        }
        self.answer_unowned_requests(&step);
        self.deliver_background_turns(step.background_turns);
        self.deliver_background_tasks(background);
        if step.unowned_activity {
            self.terminate(ClaudeSessionEndReason::UnownedActivity);
        }
    }

    fn route_stderr(&self, bytes: &[u8]) {
        let sender = self
            .state()
            .attached
            .as_ref()
            .map(|turn| turn.stderr.clone());
        if let Some(sender) = sender {
            self.send_output(&sender, bytes);
        }
    }

    fn send_output(&self, sender: &SyncSender<Vec<u8>>, bytes: &[u8]) {
        send_output_chunks(bytes, |chunk| self.send_chunk(sender, chunk));
    }

    fn send_chunk(&self, sender: &SyncSender<Vec<u8>>, chunk: Vec<u8>) -> bool {
        let mut pending = chunk;
        let mut abandon_at = None;
        loop {
            match sender.try_send(pending) {
                Ok(()) => return true,
                Err(TrySendError::Disconnected(_)) => return false,
                Err(TrySendError::Full(returned)) => pending = returned,
            }
            if self.phase() == SessionPhase::Dead {
                let deadline = *abandon_at.get_or_insert(Instant::now() + self.tuning.reader_drain);
                if Instant::now() >= deadline {
                    return false;
                }
            }
            thread::sleep(SESSION_POLL);
        }
    }

    fn answer_unowned_requests(&self, step: &RouterStep) {
        let denials = step
            .permission_denials
            .iter()
            .map(|request_id| permission_denial_frame(request_id, BACKGROUND_PERMISSION_DENIAL));
        let unsupported = step
            .unsupported_requests
            .iter()
            .map(|request_id| unsupported_request_frame(request_id));
        for frame in denials.chain(unsupported) {
            let written = frame.ok().map(|frame| {
                self.stdin
                    .write_frame(&frame, Instant::now() + UNOWNED_ANSWER_DEADLINE)
            });
            if !matches!(written, Some(Ok(()))) {
                self.terminate(ClaudeSessionEndReason::InputFailed);
                return;
            }
        }
    }

    fn deliver_background_tasks(&self, tasks: Option<ClaudeBackgroundTasks>) {
        let Some(tasks) = tasks else {
            return;
        };
        if self.offer_background_tasks(tasks) {
            return;
        }
        lock(&self.router).forget_reported_background();
    }

    fn offer_background_tasks(&self, tasks: ClaudeBackgroundTasks) -> bool {
        let Some(owner) = self.owner.upgrade() else {
            return false;
        };
        let ended = lock(&self.notifications);
        if *ended {
            return true;
        }
        let delivered = catch_unwind(AssertUnwindSafe(|| {
            owner.background_tasks(&self.identity.key, self.identity.generation, tasks)
        }));
        drop(ended);
        delivered.unwrap_or(false)
    }

    fn deliver_background_turns(&self, turns: Vec<ClaudeBackgroundTurn>) {
        if turns.is_empty() {
            return;
        }
        let Some(owner) = self.owner.upgrade() else {
            return;
        };
        for turn in turns {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                owner.background_turn(&self.identity.key, self.identity.generation, turn)
            }));
        }
    }
}

impl Drop for ClaudeThreadSession {
    fn drop(&mut self) {
        let state = self.state.get_mut().unwrap_or_else(PoisonError::into_inner);
        if state.phase == SessionPhase::Dead || state.reaping || self.process_group_id <= 0 {
            return;
        }
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
    }
}

fn abandon_child(
    signals: &dyn AgentProcessGroupSignalSender,
    process_group_id: i32,
    child: &mut Child,
) {
    if process_group_id > 0 {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            signals.send(process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
    }
    let _ = child.kill();
    let _ = reap_child(child);
}

fn settled_outcome(step: &RouterStep) -> TurnOutcome {
    if step.interrupted {
        return TurnOutcome::Interrupted;
    }
    if step.cancelled {
        return TurnOutcome::Failed(SESSION_COMMAND_CANCELLED);
    }
    if step.result_failed {
        return TurnOutcome::FailedResult;
    }
    TurnOutcome::Settled
}

fn unavailable_on_timeout(error: io::Error) -> io::Error {
    if error.kind() != io::ErrorKind::TimedOut {
        return error;
    }
    io::ErrorKind::WouldBlock.into()
}

fn settle_exited(attached: Option<AttachedTurn>, exit_code: i32) {
    if let Some(turn) = attached {
        turn.settlement
            .settle(TurnOutcome::ProcessExited(exit_code));
    }
}

fn wait_for_readers(readers: &[JoinHandle<()>], timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if readers.iter().all(JoinHandle::is_finished) {
            return;
        }
        thread::sleep(SESSION_POLL);
    }
}

fn interrupt_frame(request_id: &str) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": {"subtype": "interrupt"}
    }))
    .unwrap_or_default();
    frame.push(b'\n');
    frame
}

fn lock_before<T>(mutex: &Mutex<T>, deadline: Instant) -> io::Result<MutexGuard<'_, T>> {
    loop {
        match mutex.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Claude session input order",
            ));
        }
        thread::sleep(remaining.min(SESSION_POLL));
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn send_output_chunks(bytes: &[u8], mut send: impl FnMut(Vec<u8>) -> bool) {
    if let Ok(text) = std::str::from_utf8(bytes) {
        for chunk in split_output_chunks(text) {
            if !send(chunk.into_bytes()) {
                return;
            }
        }
        return;
    }
    for chunk in bytes.chunks(SESSION_OUTPUT_CHUNK_BYTES) {
        if !send(chunk.to_vec()) {
            return;
        }
    }
}

#[cfg(test)]
#[path = "claude_thread_session_tests.rs"]
mod tests;
