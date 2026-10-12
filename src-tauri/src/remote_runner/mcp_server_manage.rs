use super::{
    commands::{blocking, OperationClass, OPERATIONS_BUSY},
    mcp_server_manage_wire::{
        callback_body, change_body, is_valid_callback_url, login_body, parse_ack,
        parse_login_started, parse_login_status, RemoteMcpServerLoginStarted, RunnerRefusal,
    },
    mcp_servers::{
        admit_capability, ensure_exact_runner, http_status, text, Provider, INVALID_RESPONSE,
        OUTPUT_LIMIT_EXCEEDED, REQUEST_TIMED_OUT,
    },
    project_management::call_lease,
    service::{ConnectionLease, RemoteRunnerState},
    types::id,
};
use crate::agent_mcp_server_manage_domain::{
    is_valid_change, is_valid_login_id, AgentMcpServerAck, AgentMcpServerChange,
    AgentMcpServerLoginMode, AgentMcpServerLoginStatus,
    AGENT_MCP_SERVER_INVALID_REQUEST_ERROR as INVALID_REQUEST,
};
use crate::agent_mcp_servers_domain::{
    is_valid_server_name, AGENT_MCP_SERVERS_BUSY_ERROR as BUSY,
    AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR as SERVER_UNAVAILABLE,
    AGENT_MCP_SERVERS_TIMED_OUT_ERROR as TIMED_OUT,
    AGENT_MCP_SERVERS_UNAVAILABLE_ERROR as UNAVAILABLE,
    AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR as UNKNOWN_WORKSPACE,
};
use serde::Deserialize;
use serde_json::Value;

const CAPABILITY: &str = "mcpServerManagement";
const MAX_RUNNER_ID_BYTES: usize = 128;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerChangeRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
    change: AgentMcpServerChange,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerLoginStartRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
    name: String,
    mode: AgentMcpServerLoginMode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerLoginRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
    login_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerLoginCallbackRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
    login_id: String,
    callback_url: String,
}

struct Target<'a> {
    server_id: &'a str,
    runner_id: &'a str,
    project_id: &'a str,
    provider: Provider,
}

struct Call {
    method: &'static str,
    path: String,
    body: Option<Value>,
}

impl Target<'_> {
    fn base(&self) -> Result<String, &'static str> {
        if id(self.server_id).is_err() || id(self.project_id).is_err() {
            return Err(INVALID_REQUEST);
        }
        if !text(self.runner_id, MAX_RUNNER_ID_BYTES) {
            return Err(INVALID_REQUEST);
        }
        Ok(format!(
            "/v1/projects/{}/mcp-servers/{}",
            self.project_id,
            self.provider.segment()
        ))
    }

    fn login(&self, login_id: &str) -> Result<String, &'static str> {
        let base = self.base()?;
        if !is_valid_login_id(login_id) {
            return Err(INVALID_REQUEST);
        }
        Ok(format!("{base}/logins/{login_id}"))
    }
}

macro_rules! targeted {
    ($($request:ty),+ $(,)?) => {$(
        impl $request {
            fn target(&self) -> Target<'_> {
                Target {
                    server_id: &self.server_id,
                    runner_id: &self.runner_id,
                    project_id: &self.project_id,
                    provider: self.provider,
                }
            }
        }
    )+};
}

targeted!(
    McpServerChangeRequest,
    McpServerLoginStartRequest,
    McpServerLoginRequest,
    McpServerLoginCallbackRequest,
);

impl McpServerChangeRequest {
    fn admitted(&self) -> Result<Call, &'static str> {
        let base = self.target().base()?;
        if !is_valid_change(self.provider.local(), &self.change) {
            return Err(INVALID_REQUEST);
        }
        Ok(Call {
            method: "POST",
            path: format!("{base}/changes"),
            body: Some(change_body(&self.change)),
        })
    }
}

impl McpServerLoginStartRequest {
    fn admitted(&self) -> Result<Call, &'static str> {
        let base = self.target().base()?;
        if !is_valid_server_name(&self.name) {
            return Err(INVALID_REQUEST);
        }
        Ok(Call {
            method: "POST",
            path: format!("{base}/logins"),
            body: Some(login_body(&self.name, self.mode)),
        })
    }
}

impl McpServerLoginRequest {
    fn state_read(&self) -> Result<Call, &'static str> {
        Ok(Call {
            method: "GET",
            path: self.target().login(&self.login_id)?,
            body: None,
        })
    }

    fn cancellation(&self) -> Result<Call, &'static str> {
        Ok(Call {
            method: "DELETE",
            path: self.target().login(&self.login_id)?,
            body: None,
        })
    }
}

impl McpServerLoginCallbackRequest {
    fn admitted(&self) -> Result<Call, &'static str> {
        let login = self.target().login(&self.login_id)?;
        if !is_valid_callback_url(&self.callback_url) {
            return Err(INVALID_REQUEST);
        }
        Ok(Call {
            method: "POST",
            path: format!("{login}/callback"),
            body: Some(callback_body(&self.callback_url)),
        })
    }
}

fn contract_error(failure: &str) -> &'static str {
    if let Some(refusal) = RunnerRefusal::from_message(failure) {
        return refusal.contract_error();
    }
    match (failure, http_status(failure)) {
        (OPERATIONS_BUSY, _) => BUSY,
        (REQUEST_TIMED_OUT, _) => TIMED_OUT,
        (_, Some(404)) => UNKNOWN_WORKSPACE,
        (OUTPUT_LIMIT_EXCEEDED | INVALID_RESPONSE, _)
        | (_, Some(400 | 401 | 403 | 405 | 413 | 415)) => UNAVAILABLE,
        _ => SERVER_UNAVAILABLE,
    }
}

fn exchange(lease: &ConnectionLease, call: Call) -> Result<Value, &'static str> {
    let descriptor = call_lease(lease.clone(), "GET", "/v1/runner", None)
        .map_err(|failure| contract_error(&failure))?;
    admit_capability(descriptor, lease.runner_id(), CAPABILITY)?;
    call_lease(lease.clone(), call.method, &call.path, call.body)
        .map_err(|failure| contract_error(&failure))
}

async fn perform<T: Send + 'static>(
    state: &RemoteRunnerState,
    target: Target<'_>,
    class: OperationClass,
    call: Call,
    parse: fn(Value) -> Result<T, &'static str>,
) -> Result<T, String> {
    let lease = state
        .connection_lease(target.server_id)
        .map_err(|_| SERVER_UNAVAILABLE)?;
    ensure_exact_runner(&lease, target.runner_id)?;
    let exchange_lease = lease.clone();
    let outcome = blocking(class, move || {
        Ok(exchange(&exchange_lease, call).and_then(parse))
    })
    .await
    .map_err(|failure| contract_error(&failure))?;
    ensure_exact_runner(&lease, target.runner_id)?;
    Ok(outcome?)
}

#[tauri::command]
pub async fn remote_runner_change_mcp_server(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServerChangeRequest,
) -> Result<AgentMcpServerAck, String> {
    let call = request.admitted()?;
    perform(
        &state,
        request.target(),
        OperationClass::Control,
        call,
        parse_ack,
    )
    .await
}

#[tauri::command]
pub async fn remote_runner_start_mcp_server_login(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServerLoginStartRequest,
) -> Result<RemoteMcpServerLoginStarted, String> {
    let call = request.admitted()?;
    perform(
        &state,
        request.target(),
        OperationClass::Control,
        call,
        parse_login_started,
    )
    .await
}

#[tauri::command]
pub async fn remote_runner_get_mcp_server_login(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServerLoginRequest,
) -> Result<AgentMcpServerLoginStatus, String> {
    let call = request.state_read()?;
    perform(
        &state,
        request.target(),
        OperationClass::Bulk,
        call,
        parse_login_status,
    )
    .await
}

#[tauri::command]
pub async fn remote_runner_submit_mcp_server_login_callback(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServerLoginCallbackRequest,
) -> Result<AgentMcpServerAck, String> {
    let call = request.admitted()?;
    perform(
        &state,
        request.target(),
        OperationClass::Control,
        call,
        parse_ack,
    )
    .await
}

#[tauri::command]
pub async fn remote_runner_cancel_mcp_server_login(
    state: tauri::State<'_, RemoteRunnerState>,
    request: McpServerLoginRequest,
) -> Result<AgentMcpServerAck, String> {
    let call = request.cancellation()?;
    perform(
        &state,
        request.target(),
        OperationClass::Control,
        call,
        parse_ack,
    )
    .await
}

#[cfg(test)]
#[path = "mcp_server_manage_tests.rs"]
mod tests;
