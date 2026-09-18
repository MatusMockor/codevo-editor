use serde::{Deserialize, Serialize};
use std::{
    io,
    process::ChildStdin,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, MutexGuard, PoisonError, TryLockError,
    },
    time::{Duration, Instant},
};

pub const MAX_AGENT_STEERS_PER_TURN: u32 = 32;
pub const MAX_AGENT_STEER_FRAME_BYTES: usize =
    (40 * 1024 * 1024_usize).div_ceil(3) * 4 + 32 * 1024 * 6 + 64 * 1024;

#[derive(Clone, Debug)]
pub enum AgentTaskInputFrame {
    Bytes(Arc<[u8]>),
    CodexInput {
        input: Vec<crate::agent_task_spawner::codex_app_server_protocol::UserInput>,
        client_user_message_id: Option<String>,
    },
}

impl AgentTaskInputFrame {
    pub fn bounded(&self) -> bool {
        match self {
            Self::Bytes(bytes) => bytes.len() <= MAX_AGENT_STEER_FRAME_BYTES,
            Self::CodexInput {
                input,
                client_user_message_id,
            } => {
                input.len() <= 33
                    && client_user_message_id
                        .as_ref()
                        .is_none_or(|id| !id.is_empty() && id.len() <= 128)
                    && input.iter().all(|item| {
                        match item {
                    crate::agent_task_spawner::codex_app_server_protocol::UserInput::Text {
                        text,
                        ..
                    } => text.len() <= 32 * 1024,
                    crate::agent_task_spawner::codex_app_server_protocol::UserInput::LocalImage {
                        path,
                    } => path.len() <= 4096,
                    _ => false,
                }
                    })
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentTaskInputKind {
    Bytes,
    CodexInput,
}

pub trait AgentTaskInput: Send {
    fn kind(&self) -> AgentTaskInputKind {
        AgentTaskInputKind::Bytes
    }
    fn write_frame(&mut self, frame: &[u8], deadline: Instant) -> io::Result<()>;
    fn write_input(&mut self, frame: &AgentTaskInputFrame, deadline: Instant) -> io::Result<()> {
        match frame {
            AgentTaskInputFrame::Bytes(bytes) => self.write_frame(bytes, deadline),
            AgentTaskInputFrame::CodexInput { .. } => Err(io::ErrorKind::InvalidInput.into()),
        }
    }
    fn close(&mut self);
    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        None
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Clone, Copy)]
#[serde(tag = "reason", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentTaskSteerRejection {
    NotRegistered,
    NotRunning,
    NotSteerable,
    Stopping,
    InputClosed,
    InputUnavailable,
    LimitExceeded,
    WriteTimedOut,
    WriteFailed,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum AgentTaskInputState {
    Open,
    ClosedAfterResult,
    ClosedByStop,
    Detached,
}

impl AgentTaskInputState {
    fn rejection(self) -> Option<AgentTaskSteerRejection> {
        match self {
            Self::Open => None,
            Self::ClosedAfterResult => Some(AgentTaskSteerRejection::InputClosed),
            Self::ClosedByStop => Some(AgentTaskSteerRejection::Stopping),
            Self::Detached => Some(AgentTaskSteerRejection::InputUnavailable),
        }
    }
}

pub struct AgentTaskInputSlot {
    state: Mutex<AgentTaskInputState>,
    writer: Mutex<Option<Box<dyn AgentTaskInput>>>,
    frames_written: AtomicU32,
    cancellation: Option<Arc<AtomicBool>>,
    kind: AgentTaskInputKind,
    background_failure: Mutex<Option<&'static str>>,
}

impl AgentTaskInputSlot {
    pub fn new(writer: Box<dyn AgentTaskInput>) -> Self {
        let cancellation = writer.cancellation_flag();
        let kind = writer.kind();
        Self {
            cancellation,
            kind,
            background_failure: Mutex::new(None),
            state: Mutex::new(AgentTaskInputState::Open),
            writer: Mutex::new(Some(writer)),
            frames_written: AtomicU32::new(0),
        }
    }

    pub(crate) fn fail_background(&self, message: &'static str) {
        self.background_failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert(message);
    }

    pub(crate) fn background_failure(&self) -> Option<&'static str> {
        *self
            .background_failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn kind(&self) -> AgentTaskInputKind {
        self.kind
    }

    pub fn state(&self) -> AgentTaskInputState {
        *self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn frames_written(&self) -> u32 {
        self.frames_written.load(Ordering::SeqCst)
    }

    pub fn close(&self, state: AgentTaskInputState) {
        if !self.mark_closed(state) {
            return;
        }
        if let Some(cancellation) = &self.cancellation {
            cancellation.store(true, Ordering::SeqCst);
        }
        match self.writer.try_lock() {
            Ok(mut writer) => release_writer(&mut writer),
            Err(TryLockError::Poisoned(poisoned)) => release_writer(&mut poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
    }

    pub fn write(
        &self,
        frame: &[u8],
        deadline: Instant,
        limit: u32,
    ) -> Result<(), AgentTaskSteerRejection> {
        self.write_input(
            &AgentTaskInputFrame::Bytes(Arc::from(frame)),
            deadline,
            limit,
        )
    }

    pub fn write_input(
        &self,
        frame: &AgentTaskInputFrame,
        deadline: Instant,
        limit: u32,
    ) -> Result<(), AgentTaskSteerRejection> {
        if let Some(rejection) = self.state().rejection() {
            return Err(rejection);
        }
        if !frame.bounded() {
            return Err(AgentTaskSteerRejection::LimitExceeded);
        }
        let mut writer = lock_before(&self.writer, deadline)
            .map_err(|_| AgentTaskSteerRejection::WriteTimedOut)?;
        if let Some(rejection) = self.state().rejection() {
            release_writer(&mut writer);
            return Err(rejection);
        }
        if self.frames_written.load(Ordering::SeqCst) >= limit {
            return Err(AgentTaskSteerRejection::LimitExceeded);
        }
        let Some(handle) = writer.as_mut() else {
            return Err(AgentTaskSteerRejection::InputUnavailable);
        };
        if let Err(error) = handle.write_input(frame, deadline) {
            if error.kind() == io::ErrorKind::WouldBlock {
                return Err(AgentTaskSteerRejection::NotSteerable);
            }
            self.mark_closed(AgentTaskInputState::Detached);
            release_writer(&mut writer);
            if error.kind() == io::ErrorKind::TimedOut {
                return Err(AgentTaskSteerRejection::WriteTimedOut);
            }
            return Err(AgentTaskSteerRejection::WriteFailed);
        }
        self.frames_written.fetch_add(1, Ordering::SeqCst);
        if self.state().rejection().is_some() {
            release_writer(&mut writer);
        }
        Ok(())
    }

    fn mark_closed(&self, state: AgentTaskInputState) -> bool {
        let mut current = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if current.rejection().is_some() {
            return false;
        }
        *current = state;
        true
    }
}

fn release_writer(writer: &mut Option<Box<dyn AgentTaskInput>>) {
    let Some(mut handle) = writer.take() else {
        return;
    };
    handle.close();
}

fn lock_before<T>(mutex: &Mutex<T>, deadline: Instant) -> io::Result<MutexGuard<'_, T>> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "agent stdin lock"));
        }
        match mutex.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {
                std::thread::sleep(remaining.min(FIRST_FRAME_POLL_INTERVAL));
            }
        }
    }
}

const FIRST_FRAME_POLL_INTERVAL: Duration = Duration::from_millis(10);

struct RetainedStdinState {
    stdin: Option<ChildStdin>,
    first_frame_pending: bool,
}

pub struct RetainedAgentStdin {
    state: Mutex<RetainedStdinState>,
    closed: Arc<AtomicBool>,
}

pub type RetainedChildStdin = Arc<RetainedAgentStdin>;

impl RetainedAgentStdin {
    pub fn new(stdin: ChildStdin) -> Self {
        Self {
            state: Mutex::new(RetainedStdinState {
                stdin: Some(stdin),
                first_frame_pending: true,
            }),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn write_first_frame(&self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        let mut state = lock_before(&self.state, deadline)?;
        let outcome = self.write_frame_locked(&mut state, frame, deadline);
        state.first_frame_pending = false;
        drop(state);
        outcome
    }

    pub fn write_frame(&self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        let mut state = lock_before(&self.state, deadline)?;
        while state.first_frame_pending {
            if self.closed.load(Ordering::SeqCst) {
                state.stdin.take();
                return Err(io::Error::from(io::ErrorKind::BrokenPipe));
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "agent stdin frame"));
            }
            drop(state);
            std::thread::sleep(remaining.min(FIRST_FRAME_POLL_INTERVAL));
            state = lock_before(&self.state, deadline)?;
        }
        self.write_frame_locked(&mut state, frame, deadline)
    }

    fn write_frame_locked(
        &self,
        state: &mut RetainedStdinState,
        frame: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            state.stdin.take();
            return Err(io::Error::from(io::ErrorKind::BrokenPipe));
        }
        let Some(stdin) = state.stdin.as_mut() else {
            return Err(io::Error::from(io::ErrorKind::BrokenPipe));
        };
        let outcome = write_frame_before_cancelled(stdin, frame, deadline, &self.closed);
        if outcome.is_err() || self.closed.load(Ordering::SeqCst) {
            state.stdin.take();
        }
        outcome
    }

    pub fn request_close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        match self.state.try_lock() {
            Ok(mut state) => {
                state.stdin.take();
            }
            Err(TryLockError::Poisoned(poisoned)) => {
                poisoned.into_inner().stdin.take();
            }
            Err(TryLockError::WouldBlock) => {}
        }
    }
}

pub struct StdAgentTaskInput {
    stdin: RetainedChildStdin,
}

impl StdAgentTaskInput {
    pub fn new(stdin: RetainedChildStdin) -> Self {
        Self { stdin }
    }
}

impl AgentTaskInput for StdAgentTaskInput {
    fn write_frame(&mut self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        self.stdin.write_frame(frame, deadline)
    }

    fn close(&mut self) {
        self.stdin.request_close();
    }

    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        Some(Arc::clone(&self.stdin.closed))
    }
}

#[cfg(unix)]
fn write_frame_before_cancelled(
    stdin: &mut ChildStdin,
    frame: &[u8],
    deadline: Instant,
    closed: &AtomicBool,
) -> io::Result<()> {
    use std::io::Write;
    use std::os::fd::AsRawFd;

    let descriptor = stdin.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut written = 0;
    while written < frame.len() {
        if closed.load(Ordering::SeqCst) {
            return Err(io::Error::from(io::ErrorKind::BrokenPipe));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "agent stdin frame"));
        }
        match stdin.write(&frame[written..]) {
            Ok(0) => return Err(io::Error::from(io::ErrorKind::WriteZero)),
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_until_writable(descriptor, remaining.min(FIRST_FRAME_POLL_INTERVAL))
            }
            Err(error) => return Err(error),
        }
    }
    stdin.flush()
}

#[cfg(unix)]
fn wait_until_writable(descriptor: std::os::fd::RawFd, remaining: std::time::Duration) {
    let mut poll_descriptor = libc::pollfd {
        fd: descriptor,
        events: libc::POLLOUT,
        revents: 0,
    };
    let milliseconds = i32::try_from(remaining.as_millis())
        .unwrap_or(i32::MAX)
        .max(1);
    unsafe {
        libc::poll(&mut poll_descriptor, 1, milliseconds);
    }
}

#[cfg(not(unix))]
fn write_frame_before_cancelled(
    stdin: &mut ChildStdin,
    frame: &[u8],
    _deadline: Instant,
    _closed: &AtomicBool,
) -> io::Result<()> {
    let _ = (stdin, frame);
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "bounded agent stdin requires Unix",
    ))
}

#[cfg(test)]
#[path = "agent_task_input_tests.rs"]
mod tests;
