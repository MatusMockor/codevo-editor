use super::codex_app_server_protocol::{
    ClientMethod, ClientNotificationMethod, ThreadBackgroundTerminalsCleanParams,
    ThreadBackgroundTerminalsListParams, ThreadResumeParams, ThreadSnapshot, ThreadStartParams,
    ThreadUnsubscribeParams, TurnInterruptParams, TurnSnapshot, TurnStartParams, TurnSteerParams,
};
use super::codex_app_server_transport::{
    CodexAppServerStreams, CodexAppServerTransport, CodexRpcFailure, CodexServerRequestHandler,
    TurnFrameReceiver,
};
use crate::agent_task_spawner::agent_provider::process::{
    BoundExecutableSpawnFailure, ExecutableIdentity,
};
use crate::agent_task_spawner::inherited_environment;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

pub const MAX_CODEX_APP_SERVER_HOSTS: usize = 4;
pub const CODEX_HOST_IDLE_SHUTDOWN: Duration = Duration::from_secs(300);
pub const CODEX_HOST_START_TIMEOUT: Duration = Duration::from_secs(20);
pub const CODEX_INITIALIZE_DEADLINE: Duration = Duration::from_secs(20);
pub const CODEX_THREAD_DEADLINE: Duration = Duration::from_secs(30);
pub const CODEX_TURN_START_DEADLINE: Duration = Duration::from_secs(30);
pub const CODEX_TURN_INTERRUPT_DEADLINE: Duration = Duration::from_secs(10);
pub const CODEX_HOST_GRACEFUL_STOP: Duration = Duration::from_millis(500);
pub const CODEX_HOST_FORCE_STOP: Duration = Duration::from_millis(500);
pub const CODEX_HOST_STOP_POLL_INTERVAL: Duration = Duration::from_millis(10);
pub const MAX_CODEX_APP_SERVER_ARGS: usize = 16;
pub const MAX_CODEX_APP_SERVER_ARG_BYTES: usize = 256;
pub const MAX_CODEX_HOST_STDERR_BYTES: usize = 4 * 1024;

pub const CODEX_APP_SERVER_CLIENT_NAME: &str = "codevo-editor";
pub const CODEX_APP_SERVER_ARGS: [&str; 3] = ["app-server", "--listen", "stdio://"];
pub const CODEX_APP_SERVER_REJECTED_FLAGS: [&str; 3] =
    ["--listen", "--code-mode-host", "--strict-config"];

pub const CODEX_HOST_ARG_COUNT_ERROR: &str =
    "Codex app-server arguments exceed the supported count.";
pub const CODEX_HOST_ARG_SIZE_ERROR: &str = "A Codex app-server argument is empty or too long.";
pub const CODEX_HOST_ARG_CHARSET_ERROR: &str =
    "Codex app-server arguments must be printable ASCII without newlines.";
pub const CODEX_HOST_ARG_REJECTED_ERROR: &str =
    "Codex app-server transport arguments are reserved.";
pub const CODEX_HOST_ROOT_ERROR: &str = "Codex app-server requires an absolute repository root.";
pub const CODEX_HOST_IDENTITY_ERROR: &str =
    "The Codex CLI executable identity changed before launch.";
pub const CODEX_HOST_LIMIT_ERROR: &str = "Every Codex app-server host is busy with a live turn.";
pub const CODEX_HOST_HANDSHAKE_ERROR: &str = "Codex app-server did not complete its handshake.";
pub const CODEX_HOST_THREAD_ID_ERROR: &str = "Codex app-server returned an unusable thread id.";
pub const CODEX_HOST_TURN_ID_ERROR: &str = "Codex app-server returned an unusable turn id.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexHostState {
    Ready,
    Failed { reason: String },
}

#[derive(Clone)]
pub struct CodexHostKey {
    repository_root: PathBuf,
    generation: u64,
    identity: ExecutableIdentity,
}

impl CodexHostKey {
    pub fn new(repository_root: PathBuf, generation: u64, identity: ExecutableIdentity) -> Self {
        Self {
            repository_root,
            generation,
            identity,
        }
    }

    pub fn repository_root(&self) -> &Path {
        self.repository_root.as_path()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn identity(&self) -> &ExecutableIdentity {
        &self.identity
    }

    pub fn matches(&self, other: &Self) -> bool {
        self.repository_root == other.repository_root
            && self.generation == other.generation
            && self.identity == other.identity
    }
}

#[derive(Clone)]
pub struct CodexHostLaunchPlan {
    identity: ExecutableIdentity,
    repository_root: PathBuf,
    cwd_authority: Option<Arc<File>>,
    args: Vec<String>,
    env: Vec<(String, String)>,
}

impl CodexHostLaunchPlan {
    pub fn new(
        identity: ExecutableIdentity,
        repository_root: &Path,
        model_args: &[&str],
        extra_args: &[String],
    ) -> Result<Self, String> {
        if !repository_root.is_absolute() {
            return Err(CODEX_HOST_ROOT_ERROR.to_string());
        }
        let mut args: Vec<String> = CODEX_APP_SERVER_ARGS
            .iter()
            .chain(model_args.iter())
            .map(|argument| (*argument).to_string())
            .collect();
        args.extend(validate_codex_app_server_args(extra_args)?);
        Ok(Self {
            identity,
            repository_root: repository_root.to_path_buf(),
            cwd_authority: None,
            args,
            env: inherited_environment(),
        })
    }

    pub fn with_cwd_authority(mut self, authority: Arc<File>) -> Self {
        self.cwd_authority = Some(authority);
        self
    }

    pub fn with_env(mut self, env: Vec<(String, String)>) -> Self {
        self.env = env;
        self
    }

    pub fn identity(&self) -> &ExecutableIdentity {
        &self.identity
    }

    pub fn repository_root(&self) -> &Path {
        self.repository_root.as_path()
    }

    pub fn args(&self) -> &[String] {
        self.args.as_slice()
    }

    pub fn env(&self) -> &[(String, String)] {
        self.env.as_slice()
    }

    pub fn cwd_authority(&self) -> Option<&Arc<File>> {
        self.cwd_authority.as_ref()
    }
}

pub fn validate_codex_app_server_args(raw: &[String]) -> Result<Vec<String>, String> {
    if raw.len() > MAX_CODEX_APP_SERVER_ARGS {
        return Err(CODEX_HOST_ARG_COUNT_ERROR.to_string());
    }
    let mut validated = Vec::with_capacity(raw.len());
    for argument in raw {
        if argument.is_empty() || argument.len() > MAX_CODEX_APP_SERVER_ARG_BYTES {
            return Err(CODEX_HOST_ARG_SIZE_ERROR.to_string());
        }
        if !argument.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
            return Err(CODEX_HOST_ARG_CHARSET_ERROR.to_string());
        }
        if rejects_codex_app_server_argument(argument.as_str()) {
            return Err(CODEX_HOST_ARG_REJECTED_ERROR.to_string());
        }
        validated.push(argument.clone());
    }
    Ok(validated)
}

fn rejects_codex_app_server_argument(argument: &str) -> bool {
    CODEX_APP_SERVER_REJECTED_FLAGS
        .iter()
        .any(|flag| argument == *flag || argument.starts_with(format!("{flag}=").as_str()))
}

fn validated_directory_identity(plan: &CodexHostLaunchPlan) -> Result<Option<(u64, u64)>, String> {
    let Some(authority) = plan.cwd_authority() else {
        return Ok(None);
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let retained = authority.metadata().map_err(|error| error.to_string())?;
        let current = plan
            .repository_root()
            .metadata()
            .map_err(|error| error.to_string())?;
        if !retained.is_dir()
            || !current.is_dir()
            || retained.dev() != current.dev()
            || retained.ino() != current.ino()
        {
            return Err("Codex repository identity changed before launch.".into());
        }
        Ok(Some((retained.dev(), retained.ino())))
    }
    #[cfg(not(unix))]
    {
        let _ = authority;
        Err("Codex repository identity is unavailable on this platform.".into())
    }
}

pub trait CodexHostProcess: Send {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String>;
    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>>;
    fn stop(&mut self, graceful: Duration, force: Duration);
}

pub trait CodexHostProcessSpawner: Send + Sync {
    fn spawn(&self, plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String>;
}

pub struct StdCodexHostProcessSpawner;

impl CodexHostProcessSpawner for StdCodexHostProcessSpawner {
    fn spawn(&self, plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        let mut bound = plan
            .identity()
            .bound_command()
            .map_err(|_| CODEX_HOST_IDENTITY_ERROR.to_string())?;
        let command = bound.command_mut();
        command
            .args(plan.args())
            .env_clear()
            .envs(plan.env().iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::process::CommandExt;

            if let Some(authority) = plan.cwd_authority() {
                let cwd_fd = authority.as_raw_fd();
                unsafe {
                    command.pre_exec(move || {
                        if libc::fchdir(cwd_fd) == 0 {
                            return Ok(());
                        }
                        Err(std::io::Error::last_os_error())
                    });
                }
            }
            if plan.cwd_authority().is_none() {
                command.current_dir(plan.repository_root());
            }
            command.process_group(0);
        }
        #[cfg(not(unix))]
        command.current_dir(plan.repository_root());
        let child = match bound.spawn() {
            Ok(child) => child,
            Err(BoundExecutableSpawnFailure::IdentityChanged) => {
                return Err(CODEX_HOST_IDENTITY_ERROR.to_string())
            }
            Err(BoundExecutableSpawnFailure::Spawn(error)) => {
                return Err(format!("Unable to launch the Codex app-server: {error}"))
            }
        };
        StdCodexHostProcess::adopt(child)
            .map(|process| Box::new(process) as Box<dyn CodexHostProcess>)
    }
}

pub struct StdCodexHostProcess {
    child: Child,
    process_group_id: i32,
    stopped: bool,
}

impl StdCodexHostProcess {
    fn adopt(mut child: Child) -> Result<Self, String> {
        let Ok(process_group_id) = i32::try_from(child.id()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The Codex app-server process identifier is not addressable.".to_string());
        };
        Ok(Self {
            child,
            process_group_id,
            stopped: false,
        })
    }

    #[cfg(unix)]
    fn signal_group(&self, signal: i32) {
        if self.process_group_id <= 0 {
            return;
        }
        unsafe {
            libc::kill(-self.process_group_id, signal);
        }
    }

    #[cfg(unix)]
    fn exited(&self) -> bool {
        crate::agent_task_spawner::observe_exit_without_reaping(&self.child).unwrap_or(true)
    }

    #[cfg(unix)]
    fn wait_for_exit(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.exited() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(CODEX_HOST_STOP_POLL_INTERVAL);
        }
    }
}

impl CodexHostProcess for StdCodexHostProcess {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        let input = self
            .child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin pipe is unavailable.".to_string())?;
        let output = self
            .child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout pipe is unavailable.".to_string())?;
        Ok(CodexAppServerStreams {
            input: Box::new(input),
            output: Box::new(output),
        })
    }

    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        let stderr = self.child.stderr.take()?;
        Some(Box::new(stderr))
    }

    #[cfg(unix)]
    fn stop(&mut self, graceful: Duration, force: Duration) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        self.signal_group(libc::SIGTERM);
        self.wait_for_exit(graceful);
        self.signal_group(libc::SIGKILL);
        self.wait_for_exit(force);
        let _ = self.child.wait();
    }

    #[cfg(not(unix))]
    fn stop(&mut self, _graceful: Duration, _force: Duration) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for StdCodexHostProcess {
    fn drop(&mut self) {
        self.stop(CODEX_HOST_GRACEFUL_STOP, CODEX_HOST_FORCE_STOP);
    }
}

#[derive(Default)]
pub struct CodexHostStderrRing {
    bytes: Mutex<VecDeque<u8>>,
}

impl CodexHostStderrRing {
    fn push(&self, chunk: &[u8]) {
        let mut bytes = self.bytes.lock().unwrap_or_else(PoisonError::into_inner);
        for byte in chunk {
            if bytes.len() >= MAX_CODEX_HOST_STDERR_BYTES {
                bytes.pop_front();
            }
            bytes.push_back(*byte);
        }
    }

    pub fn snapshot(&self) -> String {
        let bytes = self.bytes.lock().unwrap_or_else(PoisonError::into_inner);
        String::from_utf8_lossy(bytes.iter().copied().collect::<Vec<u8>>().as_slice()).into_owned()
    }
}

pub struct CodexApprovalDecliner;

impl CodexServerRequestHandler for CodexApprovalDecliner {
    fn decline(&self, method: &str, _params: &Value) -> Option<Value> {
        match method {
            "item/commandExecution/requestApproval" => Some(json!({ "decision": "decline" })),
            "item/fileChange/requestApproval" => Some(json!({ "decision": "decline" })),
            "execCommandApproval" => Some(json!({ "decision": "denied" })),
            "applyPatchApproval" => Some(json!({ "decision": "denied" })),
            "item/permissions/requestApproval" => {
                Some(json!({ "permissions": {}, "scope": "turn" }))
            }
            "item/tool/requestUserInput" => Some(json!({ "answers": {} })),
            "mcpServer/elicitation/request" => Some(json!({ "action": "decline" })),
            "item/tool/call" => Some(json!({
                "success": false,
                "contentItems": [{
                    "type": "inputText",
                    "text": "Codevo runs Codex without interactive approvals.",
                }],
            })),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveTurnRoute {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Default)]
struct LiveTurns {
    entries: Mutex<Vec<(u64, LiveTurnRoute)>>,
    next: AtomicU64,
}

impl LiveTurns {
    fn locked(&self) -> MutexGuard<'_, Vec<(u64, LiveTurnRoute)>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn acquire(self: &Arc<Self>, route: LiveTurnRoute) -> LiveTurnLease {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.locked().push((id, route));
        LiveTurnLease {
            turns: Arc::clone(self),
            id,
        }
    }

    fn routes(&self) -> Vec<LiveTurnRoute> {
        self.locked()
            .iter()
            .map(|(_, route)| route.clone())
            .collect()
    }

    fn count(&self) -> usize {
        self.locked().len()
    }
}

pub struct LiveTurnLease {
    turns: Arc<LiveTurns>,
    id: u64,
}

impl Drop for LiveTurnLease {
    fn drop(&mut self) {
        self.turns.locked().retain(|(id, _)| *id != self.id);
    }
}

#[derive(Default)]
struct HostActivity {
    users: usize,
    retired: bool,
    last_release: Option<Instant>,
}

struct HostActivityLease(Arc<Mutex<HostActivity>>);

impl Drop for HostActivityLease {
    fn drop(&mut self) {
        let mut activity = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        activity.users = activity.users.saturating_sub(1);
        activity.last_release = Some(Instant::now());
    }
}

pub struct ThreadHandle {
    thread_id: String,
    _activity: HostActivityLease,
    frames: TurnFrameReceiver,
}

impl ThreadHandle {
    pub fn thread_id(&self) -> &str {
        self.thread_id.as_str()
    }

    pub fn frames(&self) -> &TurnFrameReceiver {
        &self.frames
    }
}

pub struct TurnHandle {
    thread_id: String,
    turn_id: String,
    _lease: LiveTurnLease,
    _activity: HostActivityLease,
}

impl TurnHandle {
    pub fn thread_id(&self) -> &str {
        self.thread_id.as_str()
    }

    pub fn turn_id(&self) -> &str {
        self.turn_id.as_str()
    }
}

#[derive(Deserialize)]
struct ThreadResponse {
    thread: ThreadSnapshot,
}

#[derive(Deserialize)]
struct TurnStartResponse {
    turn: TurnSnapshot,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnSteerResponse {
    turn_id: String,
}

pub struct CodexAppServerHost {
    key: CodexHostKey,
    directory_identity: Option<(u64, u64)>,
    transport: CodexAppServerTransport,
    process: Mutex<Box<dyn CodexHostProcess>>,
    stderr: Arc<CodexHostStderrRing>,
    turns: Arc<LiveTurns>,
    activity: Arc<Mutex<HostActivity>>,
}

impl CodexAppServerHost {
    pub fn start(
        key: CodexHostKey,
        plan: &CodexHostLaunchPlan,
        spawner: &dyn CodexHostProcessSpawner,
    ) -> Result<Arc<Self>, String> {
        Self::start_within(key, plan, spawner, CODEX_HOST_START_TIMEOUT)
    }

    pub fn start_within(
        key: CodexHostKey,
        plan: &CodexHostLaunchPlan,
        spawner: &dyn CodexHostProcessSpawner,
        start_timeout: Duration,
    ) -> Result<Arc<Self>, String> {
        if key.repository_root() != plan.repository_root() || key.identity() != plan.identity() {
            return Err("Codex host launch authority does not match its registry key.".to_string());
        }
        let directory_identity = validated_directory_identity(plan)?;
        let started = Instant::now();
        let mut process = spawner.spawn(plan)?;
        let stderr = Arc::new(CodexHostStderrRing::default());
        if let Some(reader) = process.take_stderr() {
            pump_stderr(reader, Arc::clone(&stderr));
        }
        let streams = process.take_streams()?;
        let transport = CodexAppServerTransport::connect(streams, Arc::new(CodexApprovalDecliner));
        let host = Arc::new(Self {
            key,
            directory_identity,
            transport,
            process: Mutex::new(process),
            stderr,
            turns: Arc::new(LiveTurns::default()),
            activity: Arc::new(Mutex::new(HostActivity::default())),
        });
        host.handshake(started, start_timeout)?;
        if validated_directory_identity(plan)? != directory_identity {
            return Err("Codex repository identity changed during startup.".into());
        }
        let weak = Arc::downgrade(&host);
        thread::Builder::new()
            .name("codex-host-failure-reaper".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_millis(50));
                let Some(host) = weak.upgrade() else {
                    return;
                };
                if let Some(reason) = host.transport.failure() {
                    host.shutdown(&reason);
                    return;
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(host)
    }

    fn handshake(&self, started: Instant, start_timeout: Duration) -> Result<(), String> {
        let remaining = start_timeout
            .checked_sub(started.elapsed())
            .ok_or_else(|| CODEX_HOST_HANDSHAKE_ERROR.to_string())?;
        let deadline = CODEX_INITIALIZE_DEADLINE.min(remaining);
        let params = json!({
            "capabilities": { "experimentalApi": true },
            "clientInfo": {
                "name": CODEX_APP_SERVER_CLIENT_NAME,
                "version": env!("CARGO_PKG_VERSION"),
            },
        });
        self.transport
            .request(ClientMethod::Initialize, params, deadline)
            .map_err(|failure| handshake_error(&failure))?;
        self.transport
            .notify(ClientNotificationMethod::Initialized, json!({}))
            .map_err(|failure| handshake_error(&failure))?;
        Ok(())
    }

    pub fn key(&self) -> &CodexHostKey {
        &self.key
    }

    pub fn state(&self) -> CodexHostState {
        match self.transport.failure() {
            Some(reason) => CodexHostState::Failed { reason },
            None => CodexHostState::Ready,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.transport.failure().is_none()
    }

    pub fn live_turns(&self) -> usize {
        self.turns.count()
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr.snapshot()
    }

    pub fn transport(&self) -> &CodexAppServerTransport {
        &self.transport
    }

    pub fn fail(&self, reason: &str) {
        self.shutdown(reason);
    }

    fn acquire_activity(&self) -> Result<HostActivityLease, CodexRpcFailure> {
        let mut activity = self.activity.lock().unwrap_or_else(PoisonError::into_inner);
        if activity.retired || !self.is_ready() {
            return Err(CodexRpcFailure::HostFailed {
                reason: "Codex session is unavailable.".into(),
            });
        }
        if activity.users >= 128 {
            return Err(CodexRpcFailure::HostFailed {
                reason: "Codex session activity limit reached.".into(),
            });
        }
        activity.users += 1;
        Ok(HostActivityLease(Arc::clone(&self.activity)))
    }

    fn reserve_retirement(&self, cutoff: Option<Instant>) -> bool {
        let mut activity = self.activity.lock().unwrap_or_else(PoisonError::into_inner);
        if activity.users != 0
            || cutoff.is_some_and(|cutoff| activity.last_release.is_some_and(|last| last > cutoff))
        {
            return false;
        }
        activity.retired = true;
        true
    }

    pub fn start_thread(&self, params: ThreadStartParams) -> Result<ThreadHandle, CodexRpcFailure> {
        self.open_thread(ClientMethod::ThreadStart, encode(&params)?)
    }

    pub fn resume_thread(
        &self,
        params: ThreadResumeParams,
    ) -> Result<ThreadHandle, CodexRpcFailure> {
        self.open_thread(ClientMethod::ThreadResume, encode(&params)?)
    }

    fn open_thread(
        &self,
        method: ClientMethod,
        params: Value,
    ) -> Result<ThreadHandle, CodexRpcFailure> {
        let activity = self.acquire_activity()?;
        let expected_id = (method == ClientMethod::ThreadResume).then(|| {
            params
                .get("threadId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        });
        let expected_cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_string);
        let result = self
            .transport
            .request(method, params, CODEX_THREAD_DEADLINE)?;
        if expected_id.as_ref().is_some_and(|id| {
            result.pointer("/thread/id").and_then(Value::as_str) != Some(id.as_str())
        }) || expected_cwd.as_ref().is_some_and(|cwd| {
            result
                .get("cwd")
                .and_then(Value::as_str)
                .is_some_and(|actual| actual != cwd)
        }) {
            return Err(CodexRpcFailure::HostFailed {
                reason: "Codex returned a different thread authority.".into(),
            });
        }
        let decoded: ThreadResponse =
            serde_json::from_value(result).map_err(|_| CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_THREAD_ID_ERROR.to_string(),
            })?;
        if decoded.thread.id.is_empty() || decoded.thread.id.len() > 128 {
            return Err(CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_THREAD_ID_ERROR.to_string(),
            });
        }
        let frames = self.transport.subscribe(decoded.thread.id.as_str());
        if let Some(reason) = frames.closed() {
            return Err(CodexRpcFailure::HostFailed { reason });
        }
        Ok(ThreadHandle {
            thread_id: decoded.thread.id,
            _activity: activity,
            frames,
        })
    }

    pub fn owns_turn_handles(&self, thread: &ThreadHandle, turn: &TurnHandle) -> bool {
        Arc::ptr_eq(&self.activity, &thread._activity.0)
            && Arc::ptr_eq(&self.activity, &turn._activity.0)
            && thread.thread_id == turn.thread_id
    }

    pub fn start_turn(
        &self,
        thread: &ThreadHandle,
        params: TurnStartParams,
    ) -> Result<TurnHandle, CodexRpcFailure> {
        self.start_turn_within(thread, params, CODEX_TURN_START_DEADLINE)
    }

    pub fn start_turn_within(
        &self,
        thread: &ThreadHandle,
        params: TurnStartParams,
        deadline: Duration,
    ) -> Result<TurnHandle, CodexRpcFailure> {
        if !Arc::ptr_eq(&thread._activity.0, &self.activity) || params.thread_id != thread.thread_id
        {
            return Err(CodexRpcFailure::HostFailed {
                reason: "Codex turn belongs to a different host or thread.".into(),
            });
        }
        let activity = self.acquire_activity()?;
        let result = self
            .transport
            .request(
                ClientMethod::TurnStart,
                encode(&params)?,
                deadline.min(CODEX_TURN_START_DEADLINE),
            )
            .map_err(|failure| {
                if !matches!(failure, CodexRpcFailure::Rpc(_)) {
                    self.shutdown("Codex turn start did not settle reliably.");
                }
                failure
            })?;
        let decoded: TurnStartResponse = serde_json::from_value(result).map_err(|_| {
            self.shutdown(CODEX_HOST_TURN_ID_ERROR);
            CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_TURN_ID_ERROR.to_string(),
            }
        })?;
        if decoded.turn.id.is_empty() || decoded.turn.id.len() > 256 {
            self.shutdown(CODEX_HOST_TURN_ID_ERROR);
            return Err(CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_TURN_ID_ERROR.to_string(),
            });
        }
        let route = LiveTurnRoute {
            thread_id: thread.thread_id.clone(),
            turn_id: decoded.turn.id.clone(),
        };
        Ok(TurnHandle {
            thread_id: route.thread_id.clone(),
            turn_id: decoded.turn.id,
            _lease: self.turns.acquire(route),
            _activity: activity,
        })
    }

    pub fn steer_turn(&self, params: TurnSteerParams) -> Result<String, CodexRpcFailure> {
        self.steer_turn_within(params, CODEX_TURN_START_DEADLINE)
    }

    pub fn steer_turn_within(
        &self,
        params: TurnSteerParams,
        deadline: Duration,
    ) -> Result<String, CodexRpcFailure> {
        let result = self.transport.request(
            ClientMethod::TurnSteer,
            encode(&params)?,
            deadline.min(CODEX_TURN_START_DEADLINE),
        )?;
        let decoded: TurnSteerResponse =
            serde_json::from_value(result).map_err(|_| CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_TURN_ID_ERROR.to_string(),
            })?;
        if decoded.turn_id != params.expected_turn_id {
            return Err(CodexRpcFailure::HostFailed {
                reason: CODEX_HOST_TURN_ID_ERROR.into(),
            });
        }
        Ok(decoded.turn_id)
    }

    pub fn interrupt_turn(&self, params: TurnInterruptParams) -> Result<(), CodexRpcFailure> {
        self.interrupt_turn_within(params, CODEX_TURN_INTERRUPT_DEADLINE)
    }

    pub fn interrupt_turn_within(
        &self,
        params: TurnInterruptParams,
        deadline: Duration,
    ) -> Result<(), CodexRpcFailure> {
        self.transport
            .request(
                ClientMethod::TurnInterrupt,
                encode(&params)?,
                deadline.min(CODEX_TURN_INTERRUPT_DEADLINE),
            )
            .map(|_| ())
    }

    pub fn unsubscribe_thread(&self, thread_id: &str) -> Result<(), CodexRpcFailure> {
        self.unsubscribe_thread_within(thread_id, CODEX_TURN_INTERRUPT_DEADLINE)
    }

    pub fn unsubscribe_thread_within(
        &self,
        thread_id: &str,
        deadline: Duration,
    ) -> Result<(), CodexRpcFailure> {
        let params = ThreadUnsubscribeParams {
            thread_id: thread_id.to_string(),
        };
        self.transport
            .request(
                ClientMethod::ThreadUnsubscribe,
                encode(&params)?,
                deadline.min(CODEX_TURN_INTERRUPT_DEADLINE),
            )
            .map(|_| ())
    }

    pub fn clean_background_terminals_within(
        &self,
        thread_id: &str,
        deadline: Instant,
    ) -> Result<(), CodexRpcFailure> {
        let remaining = || {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                Err(CodexRpcFailure::Timeout)
            } else {
                Ok(remaining)
            }
        };
        let cleaned = self.transport.request(
            ClientMethod::ThreadBackgroundTerminalsClean,
            encode(&ThreadBackgroundTerminalsCleanParams {
                thread_id: thread_id.into(),
            })?,
            remaining()?,
        )?;
        if !cleaned.is_object() {
            return Err(CodexRpcFailure::HostFailed {
                reason: "Codex terminal cleanup response is invalid.".into(),
            });
        }
        loop {
            let result = self.transport.request(
                ClientMethod::ThreadBackgroundTerminalsList,
                encode(&ThreadBackgroundTerminalsListParams {
                    thread_id: thread_id.into(),
                    limit: 1,
                })?,
                remaining()?,
            )?;
            let Some(data) = result.get("data").and_then(Value::as_array) else {
                return Err(CodexRpcFailure::HostFailed {
                    reason: "Codex terminal cleanup verification is invalid.".into(),
                });
            };
            if data.is_empty() && result.get("nextCursor").is_none_or(Value::is_null) {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(10).min(remaining()?));
        }
    }

    pub fn interrupt_live_turns(&self) {
        for route in self.turns.routes() {
            let _ = self.interrupt_turn(TurnInterruptParams {
                thread_id: route.thread_id,
                turn_id: route.turn_id,
            });
        }
    }

    fn shutdown(&self, reason: &str) {
        self.activity
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retired = true;
        self.transport.fail(reason);
        self.process
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .stop(CODEX_HOST_GRACEFUL_STOP, CODEX_HOST_FORCE_STOP);
    }
}

impl Drop for CodexAppServerHost {
    fn drop(&mut self) {
        self.shutdown("Codex app-server host was retired.");
    }
}

fn handshake_error(failure: &CodexRpcFailure) -> String {
    format!("{CODEX_HOST_HANDSHAKE_ERROR} {}", failure.message())
}

fn encode<T: serde::Serialize>(params: &T) -> Result<Value, CodexRpcFailure> {
    serde_json::to_value(params).map_err(|_| CodexRpcFailure::HostFailed {
        reason: "Codex app-server parameters could not be encoded.".to_string(),
    })
}

fn pump_stderr(mut reader: Box<dyn Read + Send>, ring: Arc<CodexHostStderrRing>) {
    let _ = thread::Builder::new()
        .name("codex-app-server-stderr".to_string())
        .spawn(move || {
            let mut chunk = [0u8; 1024];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => return,
                    Ok(read) => ring.push(&chunk[..read]),
                }
            }
        });
}

struct HostSlot {
    key: CodexHostKey,
    host: Arc<CodexAppServerHost>,
    last_used: Instant,
    cancelled: Arc<AtomicBool>,
}

impl HostSlot {
    fn retire(self) -> Arc<CodexAppServerHost> {
        self.cancelled.store(true, Ordering::SeqCst);
        self.host
    }
}

#[derive(Default)]
struct RegistryState {
    slots: Vec<HostSlot>,
    starting: Vec<(PathBuf, Arc<AtomicBool>)>,
    disposed: bool,
}

pub struct CodexAppServerHostRegistry {
    spawner: Arc<dyn CodexHostProcessSpawner>,
    state: Mutex<RegistryState>,
    changed: Condvar,
    pending_reaps: Arc<AtomicUsize>,
    reaper: std::sync::mpsc::SyncSender<HostReapBatch>,
    startup_failure: Option<String>,
    cleanup_failed: Arc<AtomicBool>,
    start_timeout: Duration,
}

struct HostReapBatch {
    hosts: Vec<Arc<CodexAppServerHost>>,
    _completion: BackgroundReapCompletion,
}

struct BackgroundReapCompletion {
    pending: Arc<AtomicUsize>,
    count: usize,
}

impl Drop for BackgroundReapCompletion {
    fn drop(&mut self) {
        self.pending.fetch_sub(self.count, Ordering::SeqCst);
    }
}

struct StartReservation<'a> {
    registry: &'a CodexAppServerHostRegistry,
    root: PathBuf,
}

impl Drop for StartReservation<'_> {
    fn drop(&mut self) {
        self.registry
            .locked()
            .starting
            .retain(|(root, _)| root != &self.root);
        self.registry.changed.notify_all();
    }
}

impl CodexAppServerHostRegistry {
    pub fn new(spawner: Arc<dyn CodexHostProcessSpawner>) -> Self {
        let (reaper, incoming) =
            std::sync::mpsc::sync_channel::<HostReapBatch>(MAX_CODEX_APP_SERVER_HOSTS);
        let cleanup_failed = Arc::new(AtomicBool::new(false));
        let worker_failed = Arc::clone(&cleanup_failed);
        let startup_failure = thread::Builder::new()
            .name("codex-repository-reaper".into())
            .spawn(move || {
                while let Ok(mut batch) = incoming.recv() {
                    for host in batch.hosts.drain(..) {
                        let stopped =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                host.shutdown("Codex repository was disposed.");
                            }));
                        if stopped.is_err()
                            && std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                host.shutdown("Codex cleanup is recovering from a failure.")
                            }))
                            .is_err()
                        {
                            worker_failed.store(true, Ordering::SeqCst);
                        }
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(host)))
                            .is_err()
                        {
                            worker_failed.store(true, Ordering::SeqCst);
                        }
                    }
                }
            })
            .err()
            .map(|error| format!("Unable to initialize the Codex host cleanup worker: {error}"));
        Self {
            spawner,
            state: Mutex::new(RegistryState::default()),
            changed: Condvar::new(),
            pending_reaps: Arc::new(AtomicUsize::new(0)),
            reaper,
            startup_failure,
            cleanup_failed,
            start_timeout: CODEX_HOST_START_TIMEOUT,
        }
    }

    pub fn with_start_timeout(mut self, start_timeout: Duration) -> Self {
        self.start_timeout = start_timeout;
        self
    }

    pub fn standard() -> Self {
        Self::new(Arc::new(StdCodexHostProcessSpawner))
    }

    fn locked(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn host_count(&self) -> usize {
        self.locked().slots.len()
    }

    pub fn host_for(
        &self,
        key: CodexHostKey,
        plan: &CodexHostLaunchPlan,
    ) -> Result<Arc<CodexAppServerHost>, String> {
        if self.cleanup_failed.load(Ordering::SeqCst) {
            return Err("Codex session cleanup failed. Restart the editor before launching another session.".into());
        }
        if let Some(reason) = &self.startup_failure {
            return Err(reason.clone());
        }
        if key.repository_root() != plan.repository_root() || key.identity() != plan.identity() {
            return Err("Codex host launch authority does not match its registry key.".into());
        }
        let directory_identity = validated_directory_identity(plan)?;
        let mut retired = Vec::new();
        let reservation;
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut state = self.locked();
            let waiting_deadline = Instant::now() + self.start_timeout;
            while state
                .starting
                .iter()
                .any(|(root, _)| root == key.repository_root())
                && !state.disposed
            {
                let remaining = waiting_deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(CODEX_HOST_HANDSHAKE_ERROR.into());
                }
                let starting_cancelled = state
                    .starting
                    .iter()
                    .find(|(root, _)| root == key.repository_root())
                    .map(|(_, cancelled)| Arc::clone(cancelled));
                let (next, _) = self
                    .changed
                    .wait_timeout(state, remaining)
                    .unwrap_or_else(PoisonError::into_inner);
                state = next;
                if starting_cancelled.is_some_and(|cancelled| cancelled.load(Ordering::SeqCst)) {
                    return Err("Codex repository was disposed during startup.".into());
                }
            }
            if state.disposed {
                return Err("Codex host registry has been disposed.".into());
            }
            if let Some(slot) = state.slots.iter_mut().find(|slot| {
                slot.key.matches(&key)
                    && slot.host.directory_identity == directory_identity
                    && slot.host.is_ready()
            }) {
                slot.last_used = Instant::now();
                let existing = Arc::clone(&slot.host);
                drop(state);
                validated_directory_identity(plan)?;
                return Ok(existing);
            }
            let mut index = 0;
            while index < state.slots.len() {
                let slot = &state.slots[index];
                let same_root = slot.key.repository_root() == key.repository_root();
                if !slot.host.is_ready() || (same_root && slot.host.reserve_retirement(None)) {
                    retired.push(state.slots.remove(index).retire());
                    continue;
                }
                if same_root {
                    return Err(CODEX_HOST_LIMIT_ERROR.into());
                }
                index += 1;
            }
            if state.slots.len() + state.starting.len() + self.pending_reaps.load(Ordering::SeqCst)
                >= MAX_CODEX_APP_SERVER_HOSTS
            {
                let mut candidates: Vec<usize> = (0..state.slots.len()).collect();
                candidates.sort_by_key(|index| state.slots[*index].last_used);
                let Some(index) = candidates
                    .into_iter()
                    .find(|index| state.slots[*index].host.reserve_retirement(None))
                else {
                    return Err(CODEX_HOST_LIMIT_ERROR.into());
                };
                retired.push(state.slots.remove(index).retire());
            }
            state
                .starting
                .push((key.repository_root().to_path_buf(), Arc::clone(&cancelled)));
            reservation = StartReservation {
                registry: self,
                root: key.repository_root().to_path_buf(),
            };
        }
        for host in retired {
            host.shutdown("Codex host identity or capacity changed.");
        }
        let host = CodexAppServerHost::start_within(
            key.clone(),
            plan,
            self.spawner.as_ref(),
            self.start_timeout,
        )?;
        {
            let mut state = self.locked();
            if state.disposed || cancelled.load(Ordering::SeqCst) {
                drop(state);
                host.shutdown("Codex host registry was disposed during startup.");
                return Err("Codex host registry has been disposed.".into());
            }
            state.slots.push(HostSlot {
                key,
                host: Arc::clone(&host),
                last_used: Instant::now(),
                cancelled: Arc::clone(&cancelled),
            });
        }
        drop(reservation);
        Ok(host)
    }

    pub fn retire_idle(&self) {
        let Some(cutoff) = Instant::now().checked_sub(CODEX_HOST_IDLE_SHUTDOWN) else {
            return;
        };
        self.retire_idle_before(cutoff);
    }

    pub fn retire_idle_before(&self, cutoff: Instant) {
        let retired = {
            let mut state = self.locked();
            let mut retired = Vec::new();
            let mut index = 0;
            while index < state.slots.len() {
                let slot = &state.slots[index];
                if !slot.host.is_ready()
                    || (slot.last_used <= cutoff && slot.host.reserve_retirement(Some(cutoff)))
                {
                    retired.push(state.slots.remove(index).retire());
                    continue;
                }
                index += 1;
            }
            retired
        };
        for host in retired {
            host.shutdown("Codex idle host was retired.");
        }
    }

    pub fn retire_for_repository(&self, repository_root: &Path) {
        let retired = {
            let mut state = self.locked();
            for (root, cancelled) in &state.starting {
                if root == repository_root {
                    cancelled.store(true, Ordering::SeqCst);
                }
            }
            let mut retired = Vec::new();
            let mut index = 0;
            while index < state.slots.len() {
                if state.slots[index].key.repository_root() == repository_root {
                    retired.push(state.slots.remove(index).retire());
                    continue;
                }
                index += 1;
            }
            self.pending_reaps
                .fetch_add(retired.len(), Ordering::SeqCst);
            retired
        };
        if retired.is_empty() {
            return;
        }
        for host in &retired {
            host.activity
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .retired = true;
            host.transport.fail("Codex repository was disposed.");
        }
        let pending = Arc::clone(&self.pending_reaps);
        let completion = BackgroundReapCompletion {
            pending,
            count: retired.len(),
        };
        self.reaper
            .send(HostReapBatch {
                hosts: retired,
                _completion: completion,
            })
            .expect("Codex host cleanup worker stopped unexpectedly.");
    }

    pub fn retire_all_idle_for_update(&self) -> Result<(), String> {
        if self.cleanup_failed.load(Ordering::SeqCst)
            || self.pending_reaps.load(Ordering::SeqCst) != 0
        {
            return Err("Codex sessions are still stopping.".into());
        }
        let drained = {
            let mut state = self.locked();
            if !state.starting.is_empty() || self.pending_reaps.load(Ordering::SeqCst) != 0 {
                return Err("Codex sessions are still active.".into());
            }
            let mut activities: Vec<_> = state
                .slots
                .iter()
                .map(|slot| {
                    slot.host
                        .activity
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                })
                .collect();
            if activities.iter().any(|activity| activity.users != 0) {
                return Err("Codex sessions are still active.".into());
            }
            for activity in &mut activities {
                activity.retired = true;
            }
            for slot in &state.slots {
                slot.cancelled.store(true, Ordering::SeqCst);
            }
            drop(activities);
            std::mem::take(&mut state.slots)
        };
        for slot in drained {
            slot.retire().shutdown("Codex provider is being updated.");
        }
        Ok(())
    }

    pub fn drain_for_dispose(&self) {
        let drained = {
            let mut state = self.locked();
            state.disposed = true;
            self.changed.notify_all();
            std::mem::take(&mut state.slots)
        };
        for slot in drained {
            slot.cancelled.store(true, Ordering::SeqCst);
            let deadline = Instant::now() + CODEX_HOST_GRACEFUL_STOP;
            for route in slot.host.turns.routes() {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let _ = slot.host.interrupt_turn_within(
                    TurnInterruptParams {
                        thread_id: route.thread_id,
                        turn_id: route.turn_id,
                    },
                    remaining,
                );
            }
            slot.host.shutdown("Codex host registry was disposed.");
        }
        let deadline = Instant::now()
            + (CODEX_HOST_GRACEFUL_STOP + CODEX_HOST_FORCE_STOP)
                * MAX_CODEX_APP_SERVER_HOSTS as u32;
        while self.pending_reaps.load(Ordering::SeqCst) != 0 && Instant::now() < deadline {
            thread::sleep(CODEX_HOST_STOP_POLL_INTERVAL);
        }
    }
}

impl Drop for CodexAppServerHostRegistry {
    fn drop(&mut self) {
        self.drain_for_dispose();
    }
}

#[cfg(test)]
#[path = "codex_app_server_host_tests.rs"]
mod tests;
