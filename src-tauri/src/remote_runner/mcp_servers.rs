use super::{
    commands::{blocking, OPERATIONS_BUSY},
    project_management::call_lease,
    service::{ConnectionLease, RemoteRunnerState},
    types::id,
};
use crate::agent_mcp_servers_domain::{
    validate_servers, AgentMcpServer, AgentMcpServers, AGENT_MCP_SERVERS_BUSY_ERROR as BUSY,
    AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR as SERVER_UNAVAILABLE,
    AGENT_MCP_SERVERS_TIMED_OUT_ERROR as TIMED_OUT,
    AGENT_MCP_SERVERS_UNAVAILABLE_ERROR as UNAVAILABLE,
    AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR as UNKNOWN_WORKSPACE,
    AGENT_MCP_SERVERS_UNSUPPORTED_RUNNER_ERROR as UNSUPPORTED_RUNNER,
};
use crate::agent_task_spawner::AgentCliInvocation;
use serde::Deserialize;
use serde_json::Value;

const CAPABILITY: &str = "mcpServers";
const RUNNER_BUSY: &str = "Runner MCP server status check is busy.";
const RUNNER_PROBE_FAILED: &str = "Runner MCP server status check failed on the server.";
const REQUEST_TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";
const OUTPUT_LIMIT_EXCEEDED: &str = "Runner response exceeds output limit.";
const INVALID_RESPONSE: &str = "Runner returned an invalid response.";
const HTTP_STATUS_PREFIX: &str = "(HTTP ";
const HTTP_STATUS_SUFFIX: &str = ").";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServersRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Provider {
    Claude,
    Codex,
}

impl Provider {
    fn segment(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn local(self) -> AgentCliInvocation {
        match self {
            Self::Claude => AgentCliInvocation::ClaudeCode,
            Self::Codex => AgentCliInvocation::CodexExec,
        }
    }
}

impl McpServersRequest {
    fn admitted_path(&self) -> Result<String, String> {
        id(&self.server_id)?;
        if !text(&self.runner_id, 128) {
            return Err("Invalid runner identity".into());
        }
        id(&self.project_id)?;
        Ok(format!(
            "/v1/projects/{}/mcp-servers/{}",
            self.project_id,
            self.provider.segment()
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunnerMcpServers {
    version: u32,
    provider: Provider,
    truncated: bool,
    servers: Vec<AgentMcpServer>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RunnerRefusal {
    Busy,
    StorageUnavailable,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerRefusalBody {
    error: RunnerRefusal,
}

impl RunnerRefusal {
    pub(super) fn from_body(body: &[u8]) -> Option<Self> {
        serde_json::from_slice::<RunnerRefusalBody>(body)
            .ok()
            .map(|body| body.error)
    }

    pub(super) fn message(self) -> &'static str {
        match self {
            Self::Busy => RUNNER_BUSY,
            Self::StorageUnavailable => RUNNER_PROBE_FAILED,
        }
    }
}

fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn http_status(failure: &str) -> Option<u16> {
    let (_, rest) = failure.split_once(HTTP_STATUS_PREFIX)?;
    let (status, _) = rest.split_once(HTTP_STATUS_SUFFIX)?;
    status.parse().ok()
}

pub(super) fn contract_error(failure: &str) -> &'static str {
    match (failure, http_status(failure)) {
        (RUNNER_BUSY | OPERATIONS_BUSY, _) => BUSY,
        (REQUEST_TIMED_OUT, _) => TIMED_OUT,
        (_, Some(404)) => UNKNOWN_WORKSPACE,
        (RUNNER_PROBE_FAILED | OUTPUT_LIMIT_EXCEEDED | INVALID_RESPONSE, _)
        | (_, Some(400 | 401 | 403 | 405)) => UNAVAILABLE,
        _ => SERVER_UNAVAILABLE,
    }
}

fn parse_runner_servers(value: Value, provider: Provider) -> Result<AgentMcpServers, &'static str> {
    let runner: RunnerMcpServers = serde_json::from_value(value).map_err(|_| UNAVAILABLE)?;
    if runner.provider != provider {
        return Err(UNAVAILABLE);
    }
    let servers = AgentMcpServers {
        version: runner.version,
        provider: provider.local(),
        truncated: runner.truncated,
        servers: runner.servers,
    };
    validate_servers(&servers).map_err(|_| UNAVAILABLE)?;
    Ok(servers)
}

fn admit_descriptor(descriptor: Value, expected_runner: &str) -> Result<(), &'static str> {
    let runner = super::descriptor::validate(descriptor.clone()).map_err(|_| SERVER_UNAVAILABLE)?;
    if runner != expected_runner {
        return Err(SERVER_UNAVAILABLE);
    }
    if descriptor
        .get("capabilities")
        .and_then(|caps| caps.get(CAPABILITY))
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(UNSUPPORTED_RUNNER);
    }
    Ok(())
}

fn ensure_exact_runner(lease: &ConnectionLease, runner_id: &str) -> Result<(), &'static str> {
    if !lease.is_current() || lease.runner_id() != runner_id {
        return Err(SERVER_UNAVAILABLE);
    }
    Ok(())
}

fn read_servers(
    lease: &ConnectionLease,
    path: &str,
    provider: Provider,
) -> Result<AgentMcpServers, &'static str> {
    let descriptor = call_lease(lease.clone(), "GET", "/v1/runner", None)
        .map_err(|failure| contract_error(&failure))?;
    admit_descriptor(descriptor, lease.runner_id())?;
    let response =
        call_lease(lease.clone(), "GET", path, None).map_err(|failure| contract_error(&failure))?;
    parse_runner_servers(response, provider)
}

#[tauri::command]
pub async fn remote_runner_get_mcp_servers(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServersRequest,
) -> Result<AgentMcpServers, String> {
    let path = request.admitted_path()?;
    let provider = request.provider;
    let lease = state
        .connection_lease(&request.server_id)
        .map_err(|_| SERVER_UNAVAILABLE)?;
    ensure_exact_runner(&lease, &request.runner_id)?;
    let probe_lease = lease.clone();
    let outcome = blocking(move || Ok(read_servers(&probe_lease, &path, provider)))
        .await
        .map_err(|failure| contract_error(&failure))?;
    ensure_exact_runner(&lease, &request.runner_id)?;
    Ok(outcome?)
}

#[cfg(test)]
#[path = "mcp_servers_tests.rs"]
mod tests;
