use super::{
    execute_agent_provider_plan_cancellable, validate_effective_path, AgentProviderProcessFailure,
    AgentProviderProcessPlan, ExecutableIdentity, InteractiveProbe, CODEX_APP_SERVER_HANDSHAKE,
};
use crate::agent_mcp_servers_domain::AgentMcpServers;
use crate::agent_mcp_servers_protocol::{
    ClaudeMcpStatusPoll, CodexMcpStatusRequest, McpProbeStep, McpServersProbeFailure,
    McpStatusTiming, CLAUDE_MCP_INITIALIZE_REQUEST, MAX_CLAUDE_MCP_STATUS_STREAM_BYTES,
    MAX_CODEX_MCP_STATUS_STREAM_BYTES,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    fs,
    io::Write,
    path::Path,
    process::ChildStdin,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const AGENT_PROVIDER_MCP_SERVERS_TIMEOUT: Duration = Duration::from_secs(25);
const CLAUDE_MCP_STATUS_ARGS: [&str; 9] = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--settings",
    "{\"disableAllHooks\":true}",
    "--no-session-persistence",
];
const CODEX_APP_SERVER_ARGS: [&str; 2] = ["app-server", "--stdio"];
const CLAUDE_MCP_STATUS_ENVIRONMENT: [(&str, &str); 2] = [
    ("CLAUDE_CODE_AUTO_CONNECT_IDE", "0"),
    ("CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL", "1"),
];
const INVALID_WORKSPACE_ROOT_ERROR: &str = "Provider MCP server status workspace root is invalid.";
const PROBE_STATE_ERROR: &str = "Provider MCP server status probe state is unavailable.";

#[derive(Debug)]
enum McpStatusProtocol {
    Claude(ClaudeMcpStatusPoll),
    Codex(CodexMcpStatusRequest),
}

#[derive(Debug)]
pub struct McpServersProbe {
    protocol: Mutex<McpStatusProtocol>,
}

impl McpServersProbe {
    pub fn new(provider: AgentCliInvocation) -> Arc<Self> {
        Self::with_timing(provider, McpStatusTiming::PRODUCTION)
    }

    fn with_timing(provider: AgentCliInvocation, timing: McpStatusTiming) -> Arc<Self> {
        let protocol = match provider {
            AgentCliInvocation::ClaudeCode => {
                McpStatusProtocol::Claude(ClaudeMcpStatusPoll::new(timing))
            }
            AgentCliInvocation::CodexExec => McpStatusProtocol::Codex(CodexMcpStatusRequest::new()),
        };
        Arc::new(Self {
            protocol: Mutex::new(protocol),
        })
    }

    fn protocol(&self) -> Result<MutexGuard<'_, McpStatusProtocol>, String> {
        self.protocol
            .lock()
            .map_err(|_| PROBE_STATE_ERROR.to_string())
    }

    fn take_snapshot(&self) -> Option<AgentMcpServers> {
        let mut protocol = self.protocol().ok()?;
        match &mut *protocol {
            McpStatusProtocol::Claude(poll) => poll.take_snapshot(),
            McpStatusProtocol::Codex(request) => request.take_snapshot(),
        }
    }
}

impl InteractiveProbe for McpServersProbe {
    fn observe(&self, bytes: &[u8]) {
        let Ok(mut protocol) = self.protocol() else {
            return;
        };
        match &mut *protocol {
            McpStatusProtocol::Claude(poll) => poll.observe(bytes, Instant::now()),
            McpStatusProtocol::Codex(request) => request.observe(bytes),
        }
    }

    fn advance(&self, stdin: Option<&mut ChildStdin>, now: Instant) -> Result<bool, String> {
        let mut protocol = self.protocol()?;
        let step = match &mut *protocol {
            McpStatusProtocol::Claude(poll) => poll.step(now),
            McpStatusProtocol::Codex(request) => request.step(),
        };
        drop(protocol);
        match step {
            McpProbeStep::Wait => Ok(false),
            McpProbeStep::Done => Ok(true),
            McpProbeStep::Failed(error) => Err(error),
            McpProbeStep::Write(request) => {
                stdin
                    .ok_or_else(|| "Provider input pipe was unavailable.".to_string())?
                    .write_all(&request)
                    .map_err(|_| "Provider input pipe could not be written.".to_string())?;
                Ok(false)
            }
        }
    }

    fn is_complete(&self) -> bool {
        self.protocol().is_ok_and(|protocol| match &*protocol {
            McpStatusProtocol::Claude(poll) => poll.is_done(),
            McpStatusProtocol::Codex(request) => request.is_done(),
        })
    }
}

impl AgentProviderProcessPlan {
    pub fn mcp_servers_with_effective_path(
        identity: ExecutableIdentity,
        provider: AgentCliInvocation,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
        effective_path: &str,
        probe: Arc<McpServersProbe>,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(effective_path)?;
        if workspace_root.to_str().is_none() || !workspace_root.is_absolute() {
            return Err(INVALID_WORKSPACE_ROOT_ERROR.to_string());
        }
        let (args, stdin, output_limit): (&[&str], &str, usize) = match provider {
            AgentCliInvocation::ClaudeCode => (
                CLAUDE_MCP_STATUS_ARGS.as_slice(),
                CLAUDE_MCP_INITIALIZE_REQUEST,
                MAX_CLAUDE_MCP_STATUS_STREAM_BYTES,
            ),
            AgentCliInvocation::CodexExec => (
                CODEX_APP_SERVER_ARGS.as_slice(),
                CODEX_APP_SERVER_HANDSHAKE,
                MAX_CODEX_MCP_STATUS_STREAM_BYTES,
            ),
        };
        let mut plan = Self::new(
            identity,
            args.to_vec(),
            effective_path,
            AGENT_PROVIDER_MCP_SERVERS_TIMEOUT,
            output_limit,
            false,
        );
        plan.cwd = workspace_root.to_path_buf();
        plan.cwd_authority = Some(cwd_authority);
        plan.stdin_payload = Some(stdin.as_bytes().into());
        plan.interactive_probe = Some(probe);
        if provider == AgentCliInvocation::ClaudeCode {
            let mut env = std::mem::take(&mut plan.env).into_vec();
            env.extend(
                CLAUDE_MCP_STATUS_ENVIRONMENT
                    .iter()
                    .map(|(key, value)| ((*key).to_string(), (*value).to_string())),
            );
            plan.env = env.into_boxed_slice();
        }
        Ok(plan)
    }
}

pub fn execute_mcp_servers_plan(
    plan: &AgentProviderProcessPlan,
    probe: &McpServersProbe,
    cancelled: impl Fn() -> bool,
) -> Result<AgentMcpServers, McpServersProbeFailure> {
    let missing = match execute_agent_provider_plan_cancellable(plan, cancelled) {
        Ok(_) => McpServersProbeFailure::Unavailable,
        Err(AgentProviderProcessFailure::TimedOut { .. }) => McpServersProbeFailure::TimedOut,
        Err(_) => return Err(McpServersProbeFailure::Unavailable),
    };
    probe.take_snapshot().ok_or(missing)
}

#[cfg(all(test, unix))]
#[path = "agent_provider_mcp_servers_plan_tests.rs"]
mod tests;
