use super::mcp_servers_plan::{validate_mcp_workspace_root, McpSessionPlan};
use super::{
    execute_agent_provider_plan_cancellable, validate_effective_path, AgentProviderProcessFailure,
    AgentProviderProcessPlan, ExecutableIdentity, InteractiveProbe,
};
use crate::agent_mcp_server_login_protocol::{
    McpLoginEvents, McpLoginFailure, McpLoginProtocol, McpLoginRequest,
};
use crate::agent_mcp_server_manage_domain::AgentMcpServerLoginMode;
use crate::agent_mcp_server_manage_protocol::{
    McpChangeCommand, McpChangeExchange, McpChangeFailure, McpChangeOperation, McpCommandCompletion,
};
use crate::agent_mcp_servers_protocol::{
    McpProbeStep, MAX_CLAUDE_MCP_STATUS_STREAM_BYTES, MAX_CODEX_MCP_STATUS_STREAM_BYTES,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    fmt, fs,
    io::{self, Write},
    path::Path,
    process::ChildStdin,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const AGENT_PROVIDER_MCP_CHANGE_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_COMMAND_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_CLAUDE_MCP_LOGIN_STREAM_BYTES: usize = 8 * MAX_CLAUDE_MCP_STATUS_STREAM_BYTES;
const PROBE_STATE_ERROR: &str = "Provider MCP server session state is unavailable.";
const INPUT_UNAVAILABLE_ERROR: &str = "Provider input pipe was unavailable.";
const INPUT_WRITE_ERROR: &str = "Provider input pipe could not be written.";

pub struct McpManageLaunch<'a> {
    pub identity: ExecutableIdentity,
    pub provider: AgentCliInvocation,
    pub workspace_root: &'a Path,
    pub cwd_authority: Arc<fs::File>,
    pub effective_path: &'a str,
}

impl McpManageLaunch<'_> {
    fn session(&self, timeout: Duration, output_limit: usize) -> McpSessionPlan<'_> {
        McpSessionPlan {
            identity: self.identity.clone(),
            provider: self.provider,
            workspace_root: self.workspace_root,
            cwd_authority: Arc::clone(&self.cwd_authority),
            effective_path: self.effective_path,
            timeout,
            output_limit,
        }
    }
}

fn status_stream_limit(provider: AgentCliInvocation) -> usize {
    match provider {
        AgentCliInvocation::ClaudeCode => MAX_CLAUDE_MCP_STATUS_STREAM_BYTES,
        AgentCliInvocation::CodexExec => MAX_CODEX_MCP_STATUS_STREAM_BYTES,
    }
}

fn login_stream_limit(provider: AgentCliInvocation) -> usize {
    match provider {
        AgentCliInvocation::ClaudeCode => MAX_CLAUDE_MCP_LOGIN_STREAM_BYTES,
        AgentCliInvocation::CodexExec => MAX_CODEX_MCP_STATUS_STREAM_BYTES,
    }
}

#[cfg(unix)]
fn set_nonblocking(stdin: &ChildStdin) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let descriptor = stdin.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 {
        return Err(INPUT_WRITE_ERROR.to_string());
    }
    if unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(INPUT_WRITE_ERROR.to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_nonblocking(_stdin: &ChildStdin) -> Result<(), String> {
    Ok(())
}

#[derive(Default)]
struct PendingInput {
    bytes: Vec<u8>,
    written: usize,
    nonblocking: bool,
}

impl PendingInput {
    fn is_drained(&self) -> bool {
        self.written >= self.bytes.len()
    }

    fn queue(&mut self, request: Vec<u8>) {
        self.bytes = request;
        self.written = 0;
    }

    fn flush(&mut self, stdin: Option<&mut ChildStdin>) -> Result<(), String> {
        if self.is_drained() {
            return Ok(());
        }
        let stdin = stdin.ok_or_else(|| INPUT_UNAVAILABLE_ERROR.to_string())?;
        if !self.nonblocking {
            set_nonblocking(stdin)?;
            self.nonblocking = true;
        }
        match stdin.write(&self.bytes[self.written..]) {
            Ok(0) => Err(INPUT_WRITE_ERROR.to_string()),
            Ok(count) => {
                self.written = self.written.saturating_add(count);
                if self.is_drained() {
                    self.queue(Vec::new());
                }
                Ok(())
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) =>
            {
                Ok(())
            }
            Err(_) => Err(INPUT_WRITE_ERROR.to_string()),
        }
    }
}

fn pending_input(input: &Mutex<PendingInput>) -> Result<MutexGuard<'_, PendingInput>, String> {
    input.lock().map_err(|_| PROBE_STATE_ERROR.to_string())
}

fn advance_input(
    input: &mut PendingInput,
    stdin: Option<&mut ChildStdin>,
    step: McpProbeStep,
) -> Result<bool, String> {
    match step {
        McpProbeStep::Done => Ok(true),
        McpProbeStep::Failed(error) => Err(error),
        McpProbeStep::Wait => input.flush(stdin).map(|()| false),
        McpProbeStep::Write(request) => {
            input.queue(request);
            input.flush(stdin).map(|()| false)
        }
    }
}

impl AgentProviderProcessPlan {
    pub fn mcp_command_with_effective_path(
        launch: &McpManageLaunch<'_>,
        args: Vec<String>,
        timeout: Duration,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(launch.effective_path)?;
        validate_mcp_workspace_root(launch.workspace_root)?;
        let mut plan = Self::new_strings(
            launch.identity.clone(),
            args,
            effective_path,
            timeout,
            MCP_COMMAND_OUTPUT_BYTES,
            false,
        );
        plan.cwd = launch.workspace_root.to_path_buf();
        plan.cwd_authority = Some(Arc::clone(&launch.cwd_authority));
        Ok(plan)
    }
}

struct McpChangeProbe {
    exchange: Mutex<McpChangeExchange>,
    input: Mutex<PendingInput>,
}

impl fmt::Debug for McpChangeProbe {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("McpChangeProbe")
    }
}

impl McpChangeProbe {
    fn exchange(&self) -> Result<MutexGuard<'_, McpChangeExchange>, String> {
        self.exchange
            .lock()
            .map_err(|_| PROBE_STATE_ERROR.to_string())
    }

    fn outcome(&self) -> Option<Result<(), McpChangeFailure>> {
        self.exchange().ok()?.outcome()
    }
}

impl InteractiveProbe for McpChangeProbe {
    fn observe(&self, bytes: &[u8]) {
        if let Ok(mut exchange) = self.exchange() {
            exchange.observe(bytes);
        }
    }

    fn advance(&self, stdin: Option<&mut ChildStdin>, _now: Instant) -> Result<bool, String> {
        let mut input = pending_input(&self.input)?;
        let mut exchange = self.exchange()?;
        let step = match (input.is_drained(), exchange.outcome()) {
            (true, _) => exchange.step(),
            (false, Some(_)) => McpProbeStep::Done,
            (false, None) => McpProbeStep::Wait,
        };
        drop(exchange);
        advance_input(&mut input, stdin, step)
    }

    fn is_complete(&self) -> bool {
        self.outcome().is_some()
    }
}

fn execute_change_command(
    launch: &McpManageLaunch<'_>,
    command: &McpChangeCommand,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<(), McpChangeFailure> {
    let plan =
        AgentProviderProcessPlan::mcp_command_with_effective_path(launch, command.args(), timeout)
            .map_err(|_| McpChangeFailure::Unavailable)?;
    match execute_agent_provider_plan_cancellable(&plan, cancelled) {
        Ok(output) => command.outcome(McpCommandCompletion::Succeeded {
            stdout: &output.stdout,
        }),
        Err(AgentProviderProcessFailure::Exited { stderr, .. }) => {
            command.outcome(McpCommandCompletion::Failed { stderr: &stderr })
        }
        Err(AgentProviderProcessFailure::TimedOut { .. }) => Err(McpChangeFailure::TimedOut),
        Err(_) => Err(McpChangeFailure::Unavailable),
    }
}

fn execute_change_exchange(
    launch: &McpManageLaunch<'_>,
    exchange: McpChangeExchange,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<(), McpChangeFailure> {
    let probe = Arc::new(McpChangeProbe {
        exchange: Mutex::new(exchange),
        input: Mutex::default(),
    });
    let session = launch.session(timeout, status_stream_limit(launch.provider));
    let plan = AgentProviderProcessPlan::mcp_session(session, Arc::clone(&probe) as _)
        .map_err(|_| McpChangeFailure::Unavailable)?;
    let missing = match execute_agent_provider_plan_cancellable(&plan, cancelled) {
        Err(AgentProviderProcessFailure::TimedOut { .. }) => McpChangeFailure::TimedOut,
        _ => McpChangeFailure::Unavailable,
    };
    probe.outcome().unwrap_or(Err(missing))
}

pub fn execute_mcp_change(
    launch: &McpManageLaunch<'_>,
    operation: McpChangeOperation,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<(), McpChangeFailure> {
    match operation {
        McpChangeOperation::Command(command) => {
            execute_change_command(launch, &command, timeout, cancelled)
        }
        McpChangeOperation::Exchange(exchange) => {
            execute_change_exchange(launch, exchange, timeout, cancelled)
        }
    }
}

struct McpLoginProbe {
    protocol: Mutex<McpLoginProtocol>,
    input: Mutex<PendingInput>,
    events: Arc<dyn McpLoginEvents>,
}

impl fmt::Debug for McpLoginProbe {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("McpLoginProbe")
    }
}

impl McpLoginProbe {
    fn protocol(&self) -> Result<MutexGuard<'_, McpLoginProtocol>, String> {
        self.protocol
            .lock()
            .map_err(|_| PROBE_STATE_ERROR.to_string())
    }

    fn succeeded(&self) -> bool {
        self.protocol().is_ok_and(|protocol| protocol.succeeded())
    }
}

impl InteractiveProbe for McpLoginProbe {
    fn observe(&self, bytes: &[u8]) {
        if let Ok(mut protocol) = self.protocol() {
            protocol.observe(bytes);
        }
    }

    fn advance(&self, stdin: Option<&mut ChildStdin>, now: Instant) -> Result<bool, String> {
        let mut input = pending_input(&self.input)?;
        let mut protocol = self.protocol()?;
        let step = match (input.is_drained(), protocol.is_ended()) {
            (true, _) => protocol.step(now),
            (false, true) => McpProbeStep::Done,
            (false, false) => McpProbeStep::Wait,
        };
        let announcement = protocol.take_announcement();
        drop(protocol);
        if let Some(announcement) = announcement {
            self.events.step_known(announcement);
        }
        advance_input(&mut input, stdin, step)
    }

    fn is_complete(&self) -> bool {
        self.protocol().is_ok_and(|protocol| protocol.is_ended())
    }
}

fn clear_codex_credentials(
    launch: &McpManageLaunch<'_>,
    login: &McpLoginRequest,
    cancelled: impl Fn() -> bool,
) {
    if launch.provider != AgentCliInvocation::CodexExec
        || login.mode != AgentMcpServerLoginMode::SignInAgain
    {
        return;
    }
    let command = McpChangeCommand::CodexSignOut {
        name: login.name.clone(),
    };
    let _ = execute_change_command(launch, &command, login.timing.sign_out_timeout, cancelled);
}

pub fn execute_mcp_login(
    launch: &McpManageLaunch<'_>,
    login: &McpLoginRequest,
    events: Arc<dyn McpLoginEvents>,
    cancelled: impl Fn() -> bool,
) -> bool {
    let started = Instant::now();
    clear_codex_credentials(launch, login, &cancelled);
    let probe = Arc::new(McpLoginProbe {
        protocol: Mutex::new(McpLoginProtocol::new(launch.provider, login)),
        input: Mutex::default(),
        events: Arc::clone(&events),
    });
    let session = launch.session(
        login.timing.deadline.saturating_sub(started.elapsed()),
        login_stream_limit(launch.provider),
    );
    let Ok(plan) = AgentProviderProcessPlan::mcp_session(session, Arc::clone(&probe) as _) else {
        events.step_known(Err(McpLoginFailure::Unavailable));
        return false;
    };
    let executed = execute_agent_provider_plan_cancellable(&plan, cancelled);
    let unsettled = match &executed {
        Err(AgentProviderProcessFailure::TimedOut { .. }) => McpLoginFailure::TimedOut,
        _ => McpLoginFailure::Unavailable,
    };
    let announced = probe
        .protocol()
        .ok()
        .and_then(|mut protocol| protocol.take_announcement());
    events.step_known(announced.unwrap_or(Err(unsettled)));
    executed.is_ok() && probe.succeeded()
}

#[cfg(all(test, unix))]
#[path = "agent_provider_mcp_manage_plan_tests.rs"]
mod tests;
