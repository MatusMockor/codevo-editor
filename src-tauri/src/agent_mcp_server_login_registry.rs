use crate::agent_mcp_server_login_protocol::{
    McpLoginAnnouncement, McpLoginEvents, McpLoginFailure,
};
use crate::agent_mcp_server_manage_domain::{
    AgentMcpServerLoginState, AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR,
};
use std::{
    fs,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, MutexGuard, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};

pub const MCP_LOGIN_RETENTION: Duration = Duration::from_secs(60);
const MCP_LOGIN_REAP_TIMEOUT: Duration = Duration::from_secs(5);
const MCP_LOGIN_ID_ENTROPY_BYTES: usize = 16;
const MCP_LOGIN_THREAD_NAME: &str = "codevo-mcp-login";

enum LoginStepSlot {
    Unknown,
    Known(McpLoginAnnouncement),
    Taken,
}

struct LoginProgress {
    step: LoginStepSlot,
    finished: Option<(bool, Instant)>,
    settled: bool,
}

pub type McpLoginOwner = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

pub struct McpLoginSession {
    login_id: String,
    owner: McpLoginOwner,
    cancelled: AtomicBool,
    progress: Mutex<LoginProgress>,
    changed: Condvar,
}

impl McpLoginSession {
    fn new(login_id: String, owner: McpLoginOwner) -> Self {
        Self {
            login_id,
            owner,
            cancelled: AtomicBool::new(false),
            progress: Mutex::new(LoginProgress {
                step: LoginStepSlot::Unknown,
                finished: None,
                settled: false,
            }),
            changed: Condvar::new(),
        }
    }

    fn progress(&self) -> MutexGuard<'_, LoginProgress> {
        self.progress.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn login_id(&self) -> &str {
        &self.login_id
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn owner_is_current(&self) -> Result<(), String> {
        (self.owner)()
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        let progress = self.progress();
        self.changed.notify_all();
        drop(progress);
    }

    fn finish(&self, succeeded: bool) {
        self.progress()
            .finished
            .get_or_insert((succeeded, Instant::now()));
    }

    fn settle(&self) {
        let mut progress = self.progress();
        if matches!(progress.step, LoginStepSlot::Unknown) {
            progress.step = LoginStepSlot::Known(Err(McpLoginFailure::Unavailable));
        }
        progress.finished.get_or_insert((false, Instant::now()));
        progress.settled = true;
        self.changed.notify_all();
    }

    fn wait_settled(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut progress = self.progress();
        while !progress.settled {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            progress = self
                .changed
                .wait_timeout(progress, remaining)
                .map_or_else(|poisoned| poisoned.into_inner().0, |(guard, _)| guard);
        }
        true
    }

    pub fn wait_step(&self, timeout: Duration) -> McpLoginAnnouncement {
        let deadline = Instant::now() + timeout;
        let mut progress = self.progress();
        loop {
            if self.is_cancelled() {
                return Err(McpLoginFailure::Inactive);
            }
            match std::mem::replace(&mut progress.step, LoginStepSlot::Taken) {
                LoginStepSlot::Known(step) => return step,
                LoginStepSlot::Taken => return Err(McpLoginFailure::Unavailable),
                LoginStepSlot::Unknown => progress.step = LoginStepSlot::Unknown,
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(McpLoginFailure::TimedOut);
            }
            progress = self
                .changed
                .wait_timeout(progress, remaining)
                .map_or_else(|poisoned| poisoned.into_inner().0, |(guard, _)| guard);
        }
    }

    fn state(&self, now: Instant, retention: Duration) -> Option<AgentMcpServerLoginState> {
        match self.progress().finished {
            None => Some(AgentMcpServerLoginState::Pending),
            Some((_, at)) if now.saturating_duration_since(at) >= retention => None,
            Some((true, _)) => Some(AgentMcpServerLoginState::Succeeded),
            Some((false, _)) => Some(AgentMcpServerLoginState::Failed),
        }
    }
}

impl McpLoginEvents for McpLoginSession {
    fn step_known(&self, step: McpLoginAnnouncement) {
        let mut progress = self.progress();
        if !matches!(progress.step, LoginStepSlot::Unknown) {
            return;
        }
        progress.step = LoginStepSlot::Known(step);
        self.changed.notify_all();
    }
}

struct SettleOnExit(Arc<McpLoginSession>);

impl Drop for SettleOnExit {
    fn drop(&mut self) {
        self.0.settle();
    }
}

fn run_session<B>(session: Arc<McpLoginSession>, body: B)
where
    B: FnOnce(Arc<McpLoginSession>) -> bool,
{
    let settle = SettleOnExit(Arc::clone(&session));
    let succeeded = body(Arc::clone(&session));
    session.finish(succeeded);
    drop(settle);
}

struct LoginSlot {
    session: Arc<McpLoginSession>,
}

impl Drop for LoginSlot {
    fn drop(&mut self) {
        self.session.cancel();
        self.session.wait_settled(MCP_LOGIN_REAP_TIMEOUT);
    }
}

fn mint_login_id() -> Option<String> {
    let mut entropy = [0_u8; MCP_LOGIN_ID_ENTROPY_BYTES];
    fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut entropy))
        .ok()?;
    Some(entropy.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub struct AgentMcpLoginRegistry {
    slot: Mutex<Option<LoginSlot>>,
    retention: Duration,
    closed: AtomicBool,
}

impl Default for AgentMcpLoginRegistry {
    fn default() -> Self {
        Self::with_retention(MCP_LOGIN_RETENTION)
    }
}

impl AgentMcpLoginRegistry {
    pub fn with_retention(retention: Duration) -> Self {
        Self {
            slot: Mutex::new(None),
            retention,
            closed: AtomicBool::new(false),
        }
    }

    fn slot(&self) -> MutexGuard<'_, Option<LoginSlot>> {
        self.slot.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn replace(&self, next: Option<LoginSlot>) -> Option<LoginSlot> {
        std::mem::replace(&mut *self.slot(), next)
    }

    fn take_if(&self, matches: impl Fn(&McpLoginSession) -> bool) -> Option<LoginSlot> {
        let mut slot = self.slot();
        if !slot.as_ref().is_some_and(|slot| matches(&slot.session)) {
            return None;
        }
        slot.take()
    }

    pub fn begin<B>(
        &self,
        owner: McpLoginOwner,
        body: B,
    ) -> Result<Arc<McpLoginSession>, McpLoginFailure>
    where
        B: FnOnce(Arc<McpLoginSession>) -> bool + Send + 'static,
    {
        if self.closed.load(Ordering::Acquire) {
            return Err(McpLoginFailure::Unavailable);
        }
        let login_id = mint_login_id().ok_or(McpLoginFailure::Unavailable)?;
        let session = Arc::new(McpLoginSession::new(login_id, owner));
        let previous = self.replace(Some(LoginSlot {
            session: Arc::clone(&session),
        }));
        drop(previous);
        if session.is_cancelled() || self.closed.load(Ordering::Acquire) {
            session.settle();
            self.discard(&session);
            return Err(McpLoginFailure::Inactive);
        }
        let worker = Arc::clone(&session);
        let spawned = thread::Builder::new()
            .name(MCP_LOGIN_THREAD_NAME.to_string())
            .spawn(move || run_session(worker, body));
        if spawned.is_err() {
            session.settle();
            self.discard(&session);
            return Err(McpLoginFailure::Unavailable);
        }
        Ok(session)
    }

    fn current(&self, login_id: &str) -> Option<Arc<McpLoginSession>> {
        self.slot()
            .as_ref()
            .filter(|slot| slot.session.login_id == login_id)
            .map(|slot| Arc::clone(&slot.session))
    }

    fn recorded_state(
        &self,
        session: &Arc<McpLoginSession>,
    ) -> Result<AgentMcpServerLoginState, String> {
        let state = session.state(Instant::now(), self.retention);
        if state.is_none() {
            self.discard(session);
        }
        state
            .filter(|_| !session.is_cancelled())
            .ok_or_else(|| AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR.to_string())
    }

    pub fn state(&self, login_id: &str) -> Result<AgentMcpServerLoginState, String> {
        let session = self
            .current(login_id)
            .ok_or_else(|| AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR.to_string())?;
        if let Err(error) = session.owner_is_current() {
            self.discard(&session);
            return Err(error);
        }
        self.recorded_state(&session)
    }

    #[cfg(test)]
    pub fn state_without_owner_check(
        &self,
        login_id: &str,
    ) -> Result<AgentMcpServerLoginState, String> {
        let session = self
            .current(login_id)
            .ok_or_else(|| AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR.to_string())?;
        self.recorded_state(&session)
    }

    pub fn cancel(&self, login_id: &str) {
        let cancelled = self.take_if(|session| session.login_id == login_id);
        drop(cancelled);
    }

    pub fn discard(&self, session: &Arc<McpLoginSession>) {
        let discarded = self.take_if(|current| std::ptr::eq(current, Arc::as_ptr(session)));
        drop(discarded);
    }

    #[cfg(test)]
    pub fn is_idle(&self) -> bool {
        self.slot().is_none()
    }

    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        let active = self.replace(None);
        drop(active);
    }
}

#[cfg(test)]
#[path = "agent_mcp_server_login_registry_tests.rs"]
mod tests;
