use super::codex_app_server_host::{CodexAppServerHost, ThreadHandle, TurnHandle};
use super::codex_app_server_protocol::{
    classify_error, CodexRpcErrorKind, ServerNotification, TurnInterruptParams, TurnSteerParams,
    UserInput,
};
use super::codex_app_server_transport::{CodexRpcFailure, TurnFrame, TurnFrameRecvError};
use super::codex_turn_event::{CodexClippedText, CodexTurnEvent, CodexTurnProjection};
use std::io::{self, Cursor, Read};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct CodexAppServerTurnPlan {
    pub host: Arc<CodexAppServerHost>,
    pub validate_authority: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
    pub thread_start: super::codex_app_server_protocol::ThreadStartParams,
    pub thread_resume: Option<super::codex_app_server_protocol::ThreadResumeParams>,
    pub turn_start: super::codex_app_server_protocol::TurnStartParams,
}

impl std::fmt::Debug for CodexAppServerTurnPlan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CodexAppServerTurnPlan")
            .finish_non_exhaustive()
    }
}

impl CodexAppServerTurnPlan {
    pub fn spawn(&self) -> Result<Box<dyn crate::agent_task_spawner::AgentChild>, String> {
        (self.validate_authority)()?;
        let mut resumed_fallback = None;
        let thread = match &self.thread_resume {
            Some(params) => match self.host.resume_thread(params.clone()) {
                Ok(thread) => thread,
                Err(CodexRpcFailure::Rpc(_)) if self.host.is_ready() => {
                    (self.validate_authority)()?;
                    resumed_fallback = Some(params.thread_id.clone());
                    self.host
                        .start_thread(self.thread_start.clone())
                        .map_err(|failure| failure.message())?
                }
                Err(failure) => return Err(failure.message()),
            },
            None => self
                .host
                .start_thread(self.thread_start.clone())
                .map_err(|failure| failure.message())?,
        };
        if let Err(error) = (self.validate_authority)() {
            if self.host.unsubscribe_thread(thread.thread_id()).is_err() {
                self.host
                    .fail("Codex thread authority was revoked during preparation.");
            }
            return Err(error);
        }
        if resumed_fallback.as_deref().is_some_and(|previous| {
            CodexTurnEvent::session_fallback(previous, thread.thread_id()).is_none()
        }) {
            if self.host.unsubscribe_thread(thread.thread_id()).is_err() {
                self.host
                    .fail("Codex fallback thread authority could not be released.");
            }
            return Err("Codex fallback session identity is invalid.".into());
        }
        let mut params = self.turn_start.clone();
        params.thread_id = thread.thread_id().to_string();
        let turn = match self.host.start_turn(&thread, params) {
            Ok(turn) => turn,
            Err(failure) => {
                if self.host.unsubscribe_thread(thread.thread_id()).is_err() {
                    self.host
                        .fail("Codex rejected turn subscription could not be released safely.");
                }
                return Err(failure.message());
            }
        };
        let mut child = CodexTurnChild::new(Arc::clone(&self.host), thread, turn)?;
        if let Err(error) = (self.validate_authority)() {
            child.force_kill();
            let _ = child.reap();
            return Err(error);
        }
        child.resumed_fallback = resumed_fallback;
        if let Some(state) = Arc::get_mut(&mut child.state) {
            state.mode = match self.thread_start.sandbox {
                Some(super::codex_app_server_protocol::SandboxMode::ReadOnly) => "read-only",
                Some(super::codex_app_server_protocol::SandboxMode::WorkspaceWrite) => {
                    "workspace-write"
                }
                Some(super::codex_app_server_protocol::SandboxMode::DangerFullAccess) => {
                    "full-access"
                }
                None => "non-interactive",
            };
        }
        Ok(Box::new(child))
    }
}

const PENDING: i32 = -1;
const FAILED: i32 = 1;
const STOPPED: i32 = 130;
const FRAME_POLL: Duration = Duration::from_millis(10);
const CLEANUP_DEADLINE: Duration = Duration::from_secs(10);
const MAX_PROJECTED_BATCH_BYTES: usize = 256 * 1024;

trait CodexTurnPort: Send + Sync {
    fn receive(&self) -> Result<TurnFrame, TurnFrameRecvError>;
    fn truncated(&self) -> bool;
    fn attach_thread(&self, thread_id: &str) -> bool;
    fn steer(&self, params: TurnSteerParams, timeout: Duration) -> Result<String, CodexRpcFailure>;
    fn cleanup(&self, interrupt: bool) -> Result<(), String>;
    fn stderr(&self) -> String;
    fn confirm_terminal(&self) {}
}

struct HostTurnPort {
    host: Arc<CodexAppServerHost>,
    handles: Mutex<Option<(Arc<ThreadHandle>, TurnHandle)>>,
    terminal_seen: AtomicBool,
    thread_id: String,
    turn_id: String,
}

impl HostTurnPort {
    fn thread(&self) -> Option<Arc<ThreadHandle>> {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|(thread, _)| Arc::clone(thread))
    }
}

fn attach_cleanup_subagent(
    notification: &ServerNotification,
    thread: &ThreadHandle,
    root_thread_id: &str,
    turn_id: &str,
) -> bool {
    let (ServerNotification::ItemStarted(item) | ServerNotification::ItemCompleted(item)) =
        notification
    else {
        return true;
    };
    if item.thread_id != root_thread_id || item.turn_id.as_deref().is_some_and(|id| id != turn_id) {
        return true;
    }
    let super::codex_app_server_protocol::ThreadItem::SubAgentActivity(activity) = &item.item
    else {
        return true;
    };
    thread.frames().attach_thread(&activity.agent_thread_id)
}

impl CodexTurnPort for HostTurnPort {
    fn receive(&self) -> Result<TurnFrame, TurnFrameRecvError> {
        // Register child ownership before exposing a frame to the projector.
        // Cleanup takes this same lock, so Stop cannot miss a dequeued activity.
        let handles = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
        let Some((thread, _)) = handles.as_ref() else {
            return Err(TurnFrameRecvError::Closed {
                reason: "Codex turn was released.".into(),
            });
        };
        let frame = thread.frames().recv_timeout(FRAME_POLL)?;
        if let TurnFrame::Notification(notification) = &frame {
            if !attach_cleanup_subagent(notification, thread, &self.thread_id, &self.turn_id) {
                return Err(TurnFrameRecvError::Closed {
                    reason: "Codex subagent ownership could not be retained.".into(),
                });
            }
        }
        Ok(frame)
    }

    fn truncated(&self) -> bool {
        self.thread()
            .is_some_and(|thread| thread.frames().truncated())
    }

    fn attach_thread(&self, thread_id: &str) -> bool {
        self.thread()
            .is_some_and(|thread| thread.frames().attach_thread(thread_id))
    }

    fn steer(&self, params: TurnSteerParams, timeout: Duration) -> Result<String, CodexRpcFailure> {
        self.host.steer_turn_within(params, timeout)
    }

    fn cleanup(&self, interrupt: bool) -> Result<(), String> {
        let handles = self
            .handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if handles.is_none() {
            return Ok(());
        }
        if interrupt {
            let interrupted = self.host.interrupt_turn_within(
                TurnInterruptParams {
                    thread_id: self.thread_id.clone(),
                    turn_id: self.turn_id.clone(),
                },
                CLEANUP_DEADLINE,
            );
            if interrupted.is_err() {
                self.host
                    .fail("Codex turn interruption could not be confirmed.");
                return Err("Codex turn interruption could not be confirmed.".into());
            }
            if let Some((thread, _)) = &handles {
                let deadline = Instant::now() + Duration::from_secs(1);
                let mut confirmed = false;
                while Instant::now() < deadline {
                    if self.terminal_seen.load(Ordering::SeqCst) {
                        confirmed = true;
                        break;
                    }
                    match thread.frames().recv_timeout(FRAME_POLL) {
                        Ok(TurnFrame::Notification(notification)) => {
                            if !attach_cleanup_subagent(
                                &notification,
                                thread,
                                &self.thread_id,
                                &self.turn_id,
                            ) {
                                self.host
                                    .fail("Codex subagent cleanup authority exceeded its limit.");
                                return Err(
                                    "Codex subagent cleanup authority exceeded its limit.".into()
                                );
                            }
                            if matches!(*notification, ServerNotification::TurnCompleted(payload) if payload.thread_id == self.thread_id && payload.turn.id == self.turn_id)
                            {
                                confirmed = true;
                                break;
                            }
                        }
                        Err(TurnFrameRecvError::Closed { .. }) => break,
                        _ => {}
                    }
                }
                if !confirmed {
                    self.host
                        .fail("Codex turn did not settle after interruption.");
                    return Err("Codex turn did not settle after interruption.".into());
                }
            }
        }
        if interrupt {
            let deadline = Instant::now() + CLEANUP_DEADLINE;
            if let Some((thread, _)) = &handles {
                for thread_id in thread.frames().thread_ids() {
                    if self
                        .host
                        .clean_background_terminals_within(&thread_id, deadline)
                        .is_err()
                    {
                        self.host
                            .fail("Codex background terminal cleanup could not be confirmed.");
                        return Err(
                            "Codex background terminal cleanup could not be confirmed.".into()
                        );
                    }
                }
            }
        }
        if self
            .host
            .unsubscribe_thread_within(&self.thread_id, CLEANUP_DEADLINE)
            .is_err()
        {
            self.host
                .fail("Codex turn subscription could not be released safely.");
            return Err("Codex turn subscription could not be released safely.".into());
        }
        drop(handles);
        Ok(())
    }

    fn stderr(&self) -> String {
        self.host.stderr_tail()
    }
    fn confirm_terminal(&self) {
        self.terminal_seen.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct CleanupState {
    worker: Option<std::thread::JoinHandle<Result<(), String>>>,
    result: Option<Result<(), String>>,
}

struct TurnState {
    port: Arc<dyn CodexTurnPort>,
    thread_id: String,
    turn_id: String,
    mode: &'static str,
    exit: AtomicI32,
    input_closed: Arc<AtomicBool>,
    cleanup_started: AtomicBool,
    cleanup_worker: Mutex<CleanupState>,
}

impl TurnState {
    fn settle(&self, exit: i32) {
        let _ = self
            .exit
            .compare_exchange(PENDING, exit, Ordering::SeqCst, Ordering::SeqCst);
        self.input_closed.store(true, Ordering::SeqCst);
    }

    fn cleanup(&self, interrupt: bool) {
        let mut worker = self
            .cleanup_worker
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if self.cleanup_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let port = Arc::clone(&self.port);
        match std::thread::Builder::new()
            .name("codex-turn-cleanup".into())
            .spawn(move || port.cleanup(interrupt))
        {
            Ok(handle) => worker.worker = Some(handle),
            Err(_) => {
                worker.result = Some(Err("Codex turn cleanup worker could not start.".into()))
            }
        }
    }
}

pub struct CodexTurnChild {
    state: Arc<TurnState>,
    stdout_taken: bool,
    stderr_taken: bool,
    input_taken: bool,
    resumed_fallback: Option<String>,
}

impl CodexTurnChild {
    pub fn new(
        host: Arc<CodexAppServerHost>,
        thread: ThreadHandle,
        turn: TurnHandle,
    ) -> Result<Self, String> {
        if !host.owns_turn_handles(&thread, &turn) {
            return Err("Codex turn belongs to a different thread.".into());
        }
        let thread_id = thread.thread_id().to_string();
        let turn_id = turn.turn_id().to_string();
        let port = Arc::new(HostTurnPort {
            host,
            handles: Mutex::new(Some((Arc::new(thread), turn))),
            terminal_seen: AtomicBool::new(false),
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
        });
        Ok(Self::from_port(port, thread_id, turn_id))
    }

    fn from_port(port: Arc<dyn CodexTurnPort>, thread_id: String, turn_id: String) -> Self {
        Self {
            state: Arc::new(TurnState {
                port,
                thread_id,
                turn_id,
                mode: "non-interactive",
                exit: AtomicI32::new(PENDING),
                input_closed: Arc::new(AtomicBool::new(false)),
                cleanup_started: AtomicBool::new(false),
                cleanup_worker: Mutex::new(CleanupState::default()),
            }),
            stdout_taken: false,
            stderr_taken: false,
            input_taken: false,
            resumed_fallback: None,
        }
    }

    pub fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        if self.stdout_taken {
            return Err("Codex turn output is already attached.".into());
        }
        self.stdout_taken = true;
        let mut projection = CodexTurnProjection::new(Some(self.state.thread_id.clone()));
        let session = projection.adopt_root(&self.state.thread_id);
        let mut initial = match &self.resumed_fallback {
            Some(previous) => CodexTurnEvent::session_fallback(previous, &self.state.thread_id)
                .ok_or_else(|| "Codex fallback session identity is invalid.".to_string())?
                .ndjson_line(),
            None => session
                .iter()
                .map(CodexTurnEvent::ndjson_line)
                .collect::<String>(),
        };
        if self.resumed_fallback.is_some() {
            initial.push_str(&CodexTurnEvent::Error { message: bounded_error("The previous Codex session could not be resumed. A new session was started."), thread_id: Some(self.state.thread_id.clone()) }.ndjson_line());
        }
        Ok(Box::new(CodexTurnReader {
            state: Arc::clone(&self.state),
            projection,
            pending: Cursor::new(initial.into_bytes()),
            declined_reported: false,
        }))
    }

    pub fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        if self.stderr_taken {
            return Err("Codex turn error output is already attached.".into());
        }
        self.stderr_taken = true;
        Ok(Box::new(CodexStderrReader {
            state: Arc::clone(&self.state),
            pending: None,
        }))
    }

    pub fn observe_exit(&self) -> bool {
        self.state.exit.load(Ordering::SeqCst) != PENDING
    }

    pub fn reap(&self) -> Result<i32, String> {
        let exit = self.state.exit.load(Ordering::SeqCst);
        if exit == PENDING {
            return Err("Codex turn is still running.".into());
        }
        self.state.cleanup(exit == STOPPED);
        let mut cleanup = self
            .state
            .cleanup_worker
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        // Keep the exact settlement while joining so every concurrent/repeated
        // reaper waits for, and observes, the same cleanup outcome.
        if let Some(worker) = cleanup.worker.take() {
            cleanup.result = Some(
                worker
                    .join()
                    .unwrap_or_else(|_| Err("Codex turn cleanup failed.".into())),
            );
        }
        match cleanup.result.as_ref() {
            Some(Ok(())) => Ok(exit),
            Some(Err(error)) => {
                self.state.exit.store(FAILED, Ordering::SeqCst);
                Err(error.clone())
            }
            None => Err("Codex turn cleanup did not settle.".into()),
        }
    }

    pub fn force_kill(&self) {
        if self
            .state
            .exit
            .compare_exchange(PENDING, STOPPED, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        self.state.input_closed.store(true, Ordering::SeqCst);
        self.state.cleanup(true);
    }

    pub fn take_turn_input(&mut self) -> Option<CodexTurnInput> {
        if self.input_taken {
            return None;
        }
        self.input_taken = true;
        Some(CodexTurnInput {
            state: Arc::clone(&self.state),
        })
    }
}

impl crate::agent_task_spawner::AgentChild for CodexTurnChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        CodexTurnChild::stdout_reader(self)
    }
    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        CodexTurnChild::stderr_reader(self)
    }
    fn observe_exit(&mut self) -> Result<bool, String> {
        Ok(CodexTurnChild::observe_exit(self))
    }
    fn reap(&mut self) -> Result<i32, String> {
        CodexTurnChild::reap(self)
    }
    fn process_group_id(&self) -> i32 {
        0
    }
    fn ownership(&self) -> crate::agent_task_spawner::AgentTaskProcessOwnership {
        crate::agent_task_spawner::AgentTaskProcessOwnership::SharedSession
    }
    fn force_kill(&mut self) -> Result<(), String> {
        CodexTurnChild::force_kill(self);
        Ok(())
    }
    fn take_input(
        &mut self,
    ) -> Option<Box<dyn crate::agent_task_spawner::agent_task_input::AgentTaskInput>> {
        Some(Box::new(self.take_turn_input()?))
    }
}

impl Drop for CodexTurnChild {
    fn drop(&mut self) {
        let live = !self.observe_exit();
        if live {
            self.state.settle(STOPPED);
        }
        self.state.cleanup(live);
    }
}

pub struct CodexTurnInput {
    state: Arc<TurnState>,
}

impl CodexTurnInput {
    pub fn steer(
        &mut self,
        input: Vec<UserInput>,
        client_user_message_id: Option<String>,
        deadline: Instant,
    ) -> io::Result<()> {
        if self.state.input_closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::ErrorKind::TimedOut.into());
        }
        let params = TurnSteerParams {
            thread_id: self.state.thread_id.clone(),
            expected_turn_id: self.state.turn_id.clone(),
            input,
            client_user_message_id,
        };
        let turn = self
            .state
            .port
            .steer(params, remaining)
            .map_err(|failure| match failure {
                CodexRpcFailure::Timeout => io::Error::from(io::ErrorKind::TimedOut),
                CodexRpcFailure::Rpc(ref error)
                    if classify_error(error) == CodexRpcErrorKind::ActiveTurnNotSteerable =>
                {
                    io::Error::new(
                        io::ErrorKind::WouldBlock,
                        "Codex turn is not currently steerable.",
                    )
                }
                _ => io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "Codex could not accept the steering message.",
                ),
            })?;
        if turn != self.state.turn_id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Codex returned a different turn.",
            ));
        }
        Ok(())
    }

    pub fn close(&mut self) {
        self.state.input_closed.store(true, Ordering::SeqCst);
    }
    pub fn cancellation_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.state.input_closed)
    }
}

impl crate::agent_task_spawner::agent_task_input::AgentTaskInput for CodexTurnInput {
    fn kind(&self) -> crate::agent_task_spawner::agent_task_input::AgentTaskInputKind {
        crate::agent_task_spawner::agent_task_input::AgentTaskInputKind::CodexInput
    }
    fn write_frame(&mut self, _frame: &[u8], _deadline: Instant) -> io::Result<()> {
        Err(io::ErrorKind::InvalidInput.into())
    }
    fn write_input(
        &mut self,
        frame: &crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame,
        deadline: Instant,
    ) -> io::Result<()> {
        match frame {
            crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame::CodexInput {
                input,
                client_user_message_id,
            } => self.steer(input.clone(), client_user_message_id.clone(), deadline),
            _ => Err(io::ErrorKind::InvalidInput.into()),
        }
    }
    fn close(&mut self) {
        CodexTurnInput::close(self);
    }
    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        Some(CodexTurnInput::cancellation_flag(self))
    }
}

struct CodexTurnReader {
    state: Arc<TurnState>,
    projection: CodexTurnProjection,
    pending: Cursor<Vec<u8>>,
    declined_reported: bool,
}

impl CodexTurnReader {
    fn failure(&mut self, reason: &str) {
        self.state.settle(FAILED);
        self.state.cleanup(true);
        let message = bounded_error(reason);
        self.pending = Cursor::new(
            CodexTurnEvent::Error {
                message,
                thread_id: Some(self.state.thread_id.clone()),
            }
            .ndjson_line()
            .into_bytes(),
        );
    }

    fn project(&mut self, frame: TurnFrame) {
        let notification = match frame {
            TurnFrame::Notification(notification) => *notification,
            TurnFrame::UnknownFrame { method } => ServerNotification::Unknown { method },
            TurnFrame::ServerRequestDeclined { .. } => {
                if self.declined_reported {
                    return;
                }
                self.declined_reported = true;
                self.pending = Cursor::new(
                    CodexTurnEvent::Error {
                        message: bounded_error(&format!(
                            "Codex requested interaction, which is unavailable in {} mode.",
                            self.state.mode
                        )),
                        thread_id: Some(self.state.thread_id.clone()),
                    }
                    .ndjson_line()
                    .into_bytes(),
                );
                return;
            }
        };
        if !belongs_to_turn(&notification, &self.state.thread_id, &self.state.turn_id) {
            return;
        }
        if matches!(&notification, ServerNotification::TurnCompleted(payload) if payload.thread_id == self.state.thread_id && payload.turn.id == self.state.turn_id)
        {
            self.state.port.confirm_terminal();
        }
        let events = self.projection.project(notification);
        for thread in self.projection.subagent_threads() {
            if !self.state.port.attach_thread(&thread.thread_id) {
                self.failure("Codex subagent output could not be attached.");
                return;
            }
        }
        let mut bytes = Vec::new();
        let mut terminal = None;
        for event in events {
            if let CodexTurnEvent::Result { is_error, .. } = &event {
                terminal = Some(i32::from(*is_error));
            }
            let line = event.ndjson_line();
            if bytes.len() + line.len() > MAX_PROJECTED_BATCH_BYTES {
                self.failure("Codex projected output exceeded its limit; output is incomplete.");
                return;
            }
            bytes.extend_from_slice(line.as_bytes());
        }
        self.pending = Cursor::new(bytes);
        if let Some(exit) = terminal {
            self.state.settle(exit);
        }
    }
}

impl Read for CodexTurnReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let count = self.pending.read(buffer)?;
        if count != 0 {
            return Ok(count);
        }
        if self.state.exit.load(Ordering::SeqCst) != PENDING {
            return Ok(0);
        }
        if self.state.port.truncated() {
            self.failure("Codex output exceeded its queue limit; output is incomplete.");
            return self.pending.read(buffer);
        }
        match self.state.port.receive() {
            Ok(frame) => self.project(frame),
            Err(TurnFrameRecvError::Timeout) => return Err(io::ErrorKind::WouldBlock.into()),
            Err(TurnFrameRecvError::Closed { reason }) => self.failure(&reason),
        }
        let count = self.pending.read(buffer)?;
        if count != 0 {
            return Ok(count);
        }
        if self.state.exit.load(Ordering::SeqCst) != PENDING {
            return Ok(0);
        }
        Err(io::ErrorKind::WouldBlock.into())
    }
}

struct CodexStderrReader {
    state: Arc<TurnState>,
    pending: Option<Cursor<Vec<u8>>>,
}
impl Read for CodexStderrReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let exit = self.state.exit.load(Ordering::SeqCst);
        if exit == PENDING {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        let pending = self.pending.get_or_insert_with(|| {
            Cursor::new(match exit {
                FAILED => self.state.port.stderr().into_bytes(),
                _ => Vec::new(),
            })
        });
        pending.read(buffer)
    }
}

fn belongs_to_turn(notification: &ServerNotification, thread_id: &str, turn_id: &str) -> bool {
    let authority = match notification {
        ServerNotification::TurnStarted(payload) => {
            Some((payload.thread_id.as_str(), Some(payload.turn.id.as_str())))
        }
        ServerNotification::TurnCompleted(payload) => {
            Some((payload.thread_id.as_str(), Some(payload.turn.id.as_str())))
        }
        ServerNotification::ItemStarted(payload) | ServerNotification::ItemCompleted(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::ThreadTokenUsageUpdated(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::ThreadCompacted(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::Error(payload) => payload
            .thread_id
            .as_deref()
            .map(|thread| (thread, payload.turn_id.as_deref())),
        _ => None,
    };
    !authority.is_some_and(|(thread, turn)| {
        thread == thread_id && turn.is_some_and(|turn| turn != turn_id)
    })
}

fn bounded_error(reason: &str) -> CodexClippedText {
    let mut end = reason.len().min(4096);
    while !reason.is_char_boundary(end) {
        end -= 1;
    }
    CodexClippedText {
        text: reason[..end].to_string(),
        clipped: end != reason.len(),
    }
}

#[cfg(test)]
#[path = "codex_app_server_turn_tests.rs"]
mod tests;
