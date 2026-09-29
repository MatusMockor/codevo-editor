use super::{
    agent_claude_questions::{ClaudeControlInput, ClaudeQuestionReader},
    agent_launch::AgentLaunchOptions,
    agent_task_input::{claude_lifecycle::ClaudeInputLifecycle, AgentTaskInput},
    claude_session_policy::{
        args_without_resume, ClaudeSessionEndReason, ClaudeSessionFingerprint,
        ExecutableFingerprint,
    },
    claude_session_registry::{ClaudeSessionLease, ClaudeSessionRegistry, ClaudeSessionRequest},
    claude_thread_session::{ClaudeThreadSession, TurnOutcome, TurnSettlement},
    reap_failure_message, spawn_bound_process, spawn_per_turn_process, AgentChild,
    AgentTaskProcessOwnership, AgentTaskSpawnPlan,
};
use crate::agent_questions::AgentQuestionSession;
use std::{
    io::{self, Read},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, RecvTimeoutError},
        Arc,
    },
    time::{Duration, Instant},
};

const TURN_READ_POLL: Duration = Duration::from_millis(10);
const CLAUDE_FAILED_RESULT_EXIT_CODE: i32 = 1;
const TURN_REAPED_BEFORE_SETTLEMENT: &str = "Claude turn was reaped before it settled.";

pub struct TurnOutputReader {
    receiver: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    offset: usize,
}

impl TurnOutputReader {
    pub fn new(receiver: Receiver<Vec<u8>>) -> Self {
        Self {
            receiver,
            pending: Vec::new(),
            offset: 0,
        }
    }
}

impl Read for TurnOutputReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.offset >= self.pending.len() {
            match self.receiver.recv_timeout(TURN_READ_POLL) {
                Ok(chunk) => {
                    self.pending = chunk;
                    self.offset = 0;
                }
                Err(RecvTimeoutError::Timeout) => return Err(io::ErrorKind::WouldBlock.into()),
                Err(RecvTimeoutError::Disconnected) => return Ok(0),
            }
        }
        let count = buffer.len().min(self.pending.len() - self.offset);
        buffer[..count].copy_from_slice(&self.pending[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}

pub struct ClaudeSessionTurnChild {
    session: Arc<ClaudeThreadSession>,
    turn: u64,
    settlement: Arc<TurnSettlement>,
    stdout: Option<Receiver<Vec<u8>>>,
    stderr: Option<Receiver<Vec<u8>>>,
    questions: Arc<AgentQuestionSession>,
    input: Option<ClaudeSessionTurnInput>,
}

impl ClaudeSessionTurnChild {
    pub(crate) fn new(
        session: Arc<ClaudeThreadSession>,
        turn: u64,
        settlement: Arc<TurnSettlement>,
        stdout: Receiver<Vec<u8>>,
        stderr: Receiver<Vec<u8>>,
        lifecycle: Arc<ClaudeInputLifecycle>,
    ) -> Self {
        let input = ClaudeSessionTurnInput {
            session: Arc::clone(&session),
            turn,
            lifecycle,
            closed: Arc::new(AtomicBool::new(false)),
        };
        Self {
            session,
            turn,
            settlement,
            stdout: Some(stdout),
            stderr: Some(stderr),
            questions: Arc::new(AgentQuestionSession::new()),
            input: Some(input),
        }
    }

    pub fn outcome(&self) -> Option<TurnOutcome> {
        self.settlement.outcome()
    }
}

impl AgentChild for ClaudeSessionTurnChild {
    fn take_questions(&mut self) -> Option<Arc<AgentQuestionSession>> {
        Some(Arc::clone(&self.questions))
    }

    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let receiver = self
            .stdout
            .take()
            .ok_or_else(|| "Agent stdout pipe is unavailable.".to_string())?;
        Ok(Box::new(ClaudeQuestionReader::new(
            TurnOutputReader::new(receiver),
            Arc::clone(&self.questions),
            Arc::new(SessionControlInput {
                session: Arc::clone(&self.session),
                turn: self.turn,
            }),
        )))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let receiver = self
            .stderr
            .take()
            .ok_or_else(|| "Agent stderr pipe is unavailable.".to_string())?;
        Ok(Box::new(TurnOutputReader::new(receiver)))
    }

    fn observe_exit(&mut self) -> Result<bool, String> {
        if let Some(error) = self.questions.failure() {
            self.session
                .terminate(ClaudeSessionEndReason::ProtocolError);
            return Err(error);
        }
        Ok(self.settlement.outcome().is_some())
    }

    fn reap(&mut self) -> Result<i32, String> {
        match self.settlement.outcome() {
            Some(TurnOutcome::Settled | TurnOutcome::Interrupted) => Ok(0),
            Some(TurnOutcome::FailedResult) => Ok(CLAUDE_FAILED_RESULT_EXIT_CODE),
            Some(TurnOutcome::ProcessExited(code)) => Ok(code),
            Some(TurnOutcome::Failed(message)) => Err(message.to_string()),
            None => Err(TURN_REAPED_BEFORE_SETTLEMENT.to_string()),
        }
    }

    fn reap_failure_message(&self, error: &str) -> String {
        let Some(TurnOutcome::Failed(message)) = self.settlement.outcome() else {
            return reap_failure_message(error);
        };
        message.to_string()
    }

    fn process_group_id(&self) -> i32 {
        0
    }

    fn ownership(&self) -> AgentTaskProcessOwnership {
        AgentTaskProcessOwnership::SharedSession
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.session
            .terminate_turn(self.turn, ClaudeSessionEndReason::Stopped);
        Ok(())
    }

    fn take_input(&mut self) -> Option<Box<dyn AgentTaskInput>> {
        self.input
            .take()
            .map(|input| Box::new(input) as Box<dyn AgentTaskInput>)
    }

    fn settled_by_interrupt(&self) -> Option<bool> {
        match self.settlement.outcome() {
            Some(TurnOutcome::Interrupted) => Some(true),
            Some(TurnOutcome::Settled | TurnOutcome::FailedResult) => Some(false),
            Some(TurnOutcome::ProcessExited(_) | TurnOutcome::Failed(_)) | None => None,
        }
    }
}

struct SessionControlInput {
    session: Arc<ClaudeThreadSession>,
    turn: u64,
}

impl ClaudeControlInput for SessionControlInput {
    fn write_control_frame(&self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        self.session.write_control_frame(self.turn, frame, deadline)
    }
}

pub struct ClaudeSessionTurnInput {
    session: Arc<ClaudeThreadSession>,
    turn: u64,
    lifecycle: Arc<ClaudeInputLifecycle>,
    closed: Arc<AtomicBool>,
}

impl AgentTaskInput for ClaudeSessionTurnInput {
    fn claude_lifecycle(&self) -> Option<Arc<ClaudeInputLifecycle>> {
        Some(Arc::clone(&self.lifecycle))
    }

    fn provider_owns_settlement(&self) -> bool {
        true
    }

    fn write_frame(&mut self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::NotConnected.into());
        }
        self.session.write_turn_frame(self.turn, frame, deadline)
    }

    fn interrupt(&mut self, deadline: Instant) -> io::Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        self.session.interrupt_turn(self.turn, deadline)
    }

    fn close(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
    }

    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        Some(Arc::clone(&self.closed))
    }
}

pub type ClaudeSessionAuthority = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

#[derive(Clone)]
pub struct ClaudeSessionTurnPlan {
    registry: Arc<ClaudeSessionRegistry>,
    request: ClaudeSessionRequest,
    validate_authority: ClaudeSessionAuthority,
}

impl std::fmt::Debug for ClaudeSessionTurnPlan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClaudeSessionTurnPlan")
            .field("thread_id", &self.request.key.thread_id)
            .finish_non_exhaustive()
    }
}

impl ClaudeSessionTurnPlan {
    pub fn new(
        registry: Arc<ClaudeSessionRegistry>,
        request: ClaudeSessionRequest,
        validate_authority: ClaudeSessionAuthority,
    ) -> Self {
        Self {
            registry,
            request,
            validate_authority,
        }
    }

    pub(crate) fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let Some(frame) = plan.stdin_frame_bytes() else {
            return spawn_per_turn_process(plan);
        };
        (self.validate_authority)()?;
        let lease = self
            .registry
            .acquire(&self.request, || spawn_bound_process(plan, Stdio::piped()))?;
        let ClaudeSessionLease::Session(session) = lease else {
            return spawn_per_turn_process(plan);
        };
        if let Err(error) = (self.validate_authority)() {
            session.terminate(ClaudeSessionEndReason::Released);
            return Err(error);
        }
        session
            .attach_turn(frame)
            .map(|turn| Box::new(turn) as Box<dyn AgentChild>)
    }
}

pub fn session_fingerprint(
    plan: &AgentTaskSpawnPlan,
    launch: AgentLaunchOptions,
    provider_generation: u64,
) -> ClaudeSessionFingerprint {
    ClaudeSessionFingerprint {
        executable: executable_fingerprint(plan.executable_identity()),
        provider_generation,
        launch,
        args_without_resume: args_without_resume(plan.args()),
        env: plan.env().to_vec(),
        cwd: plan.cwd().to_path_buf(),
        cwd_identity: cwd_identity(plan),
    }
}

#[cfg(unix)]
fn executable_fingerprint(
    identity: &super::agent_provider::process::ExecutableIdentity,
) -> ExecutableFingerprint {
    ExecutableFingerprint {
        path: identity.canonical_path.clone(),
        size_bytes: identity.size_bytes,
        modified_epoch_ms: identity.modified_epoch_ms,
        device: identity.device,
        inode: identity.inode,
    }
}

#[cfg(not(unix))]
fn executable_fingerprint(
    identity: &super::agent_provider::process::ExecutableIdentity,
) -> ExecutableFingerprint {
    ExecutableFingerprint {
        path: identity.canonical_path.clone(),
        size_bytes: identity.size_bytes,
        modified_epoch_ms: identity.modified_epoch_ms,
        device: 0,
        inode: 0,
    }
}

#[cfg(unix)]
fn cwd_identity(plan: &AgentTaskSpawnPlan) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    plan.retained_cwd_authority()
        .and_then(|directory| directory.metadata().ok())
        .map(|metadata| (metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn cwd_identity(_plan: &AgentTaskSpawnPlan) -> Option<(u64, u64)> {
    None
}
