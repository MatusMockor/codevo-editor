use crate::agent_command_catalog_domain::validate_repository_root;
use crate::agent_mcp_servers_domain::is_valid_server_name;
use crate::agent_task_spawner::AgentCliInvocation;
use serde::{Deserialize, Serialize};
use std::fmt;

pub const AGENT_MCP_SERVER_INVALID_REQUEST_ERROR: &str = "Agent MCP server request is invalid.";
pub const AGENT_MCP_SERVER_EXISTS_ERROR: &str =
    "An MCP server with this name is already configured.";
pub const AGENT_MCP_SERVER_NOT_FOUND_ERROR: &str = "The MCP server is not configured.";
pub const AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR: &str =
    "This MCP server cannot be changed from Codevo.";
pub const AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR: &str =
    "This MCP server does not support sign-in.";
pub const AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR: &str =
    "The MCP server sign-in is no longer active.";
pub const AGENT_MCP_SERVER_CALLBACK_REJECTED_ERROR: &str =
    "The MCP server sign-in did not accept this address.";
pub const MAX_MCP_CONFIG_NAME_BYTES: usize = 64;
pub const MAX_MCP_LAUNCH_URL_BYTES: usize = 2048;
pub const MAX_MCP_COMMAND_BYTES: usize = 1024;
pub const MAX_MCP_ARGS: usize = 32;
pub const MAX_MCP_ARG_BYTES: usize = 1024;
pub const MAX_MCP_AUTHORIZATION_URL_BYTES: usize = 4096;
pub const MIN_MCP_LOGIN_ID_BYTES: usize = 8;
pub const MAX_MCP_LOGIN_ID_BYTES: usize = 64;
const MCP_MANAGE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerConfigScope {
    User,
    Project,
    Local,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentMcpServerLaunch {
    Http { url: String },
    Sse { url: String },
    Stdio { command: String, args: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentMcpServerChange {
    Add {
        name: String,
        scope: AgentMcpServerConfigScope,
        launch: AgentMcpServerLaunch,
    },
    Remove {
        name: String,
        scope: AgentMcpServerConfigScope,
    },
    SignOut {
        name: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerLoginMode {
    SignIn,
    SignInAgain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerLoginDelivery {
    Automatic,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentMcpServerLoginStep {
    Completed,
    FinishInBrowser {
        authorization_url: String,
    },
    AwaitingCallback {
        login_id: String,
        authorization_url: String,
        delivery: AgentMcpServerLoginDelivery,
    },
}

impl fmt::Debug for AgentMcpServerLoginStep {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Completed => "Completed",
            Self::FinishInBrowser { .. } => "FinishInBrowser",
            Self::AwaitingCallback { .. } => "AwaitingCallback",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerLoginState {
    Pending,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServerChangeRequest {
    pub repository_root: String,
    pub provider: AgentCliInvocation,
    pub change: AgentMcpServerChange,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServerLoginStartRequest {
    pub repository_root: String,
    pub provider: AgentCliInvocation,
    pub name: String,
    pub mode: AgentMcpServerLoginMode,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServerLoginRequest {
    pub login_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpServerAck {
    pub version: u32,
}

impl AgentMcpServerAck {
    pub fn acknowledged() -> Self {
        Self {
            version: MCP_MANAGE_VERSION,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpServerLoginStarted {
    pub version: u32,
    pub step: AgentMcpServerLoginStep,
}

impl AgentMcpServerLoginStarted {
    pub fn new(step: AgentMcpServerLoginStep) -> Self {
        Self {
            version: MCP_MANAGE_VERSION,
            step,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpServerLoginStatus {
    pub version: u32,
    pub state: AgentMcpServerLoginState,
}

impl AgentMcpServerLoginStatus {
    pub fn new(state: AgentMcpServerLoginState) -> Self {
        Self {
            version: MCP_MANAGE_VERSION,
            state,
        }
    }
}

fn invalid_request() -> String {
    AGENT_MCP_SERVER_INVALID_REQUEST_ERROR.to_string()
}

pub fn is_valid_config_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    name.len() <= MAX_MCP_CONFIG_NAME_BYTES
        && (first.is_ascii_alphanumeric() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn has_blank_or_control(value: &str) -> bool {
    value
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
}

fn bounded_http_url(value: &str, max: usize) -> Option<url::Url> {
    if value.is_empty() || value.len() > max || has_blank_or_control(value) {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if url.host_str().is_none_or(str::is_empty) {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url)
}

pub fn is_valid_launch_url(value: &str) -> bool {
    bounded_http_url(value, MAX_MCP_LAUNCH_URL_BYTES).is_some()
}

pub fn is_valid_authorization_url(value: &str) -> bool {
    let Some(url) = bounded_http_url(value, MAX_MCP_AUTHORIZATION_URL_BYTES) else {
        return false;
    };
    if value.starts_with("https://") {
        return url.scheme() == "https";
    }
    value.starts_with("http://") && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
}

fn is_valid_command(command: &str) -> bool {
    !command.is_empty()
        && command.len() <= MAX_MCP_COMMAND_BYTES
        && !command.chars().any(char::is_control)
}

fn is_valid_args(args: &[String]) -> bool {
    args.len() <= MAX_MCP_ARGS
        && args
            .iter()
            .all(|arg| arg.len() <= MAX_MCP_ARG_BYTES && !arg.chars().any(char::is_control))
}

fn is_valid_launch(provider: AgentCliInvocation, launch: &AgentMcpServerLaunch) -> bool {
    match launch {
        AgentMcpServerLaunch::Http { url } => is_valid_launch_url(url),
        AgentMcpServerLaunch::Sse { url } => {
            provider == AgentCliInvocation::ClaudeCode && is_valid_launch_url(url)
        }
        AgentMcpServerLaunch::Stdio { command, args } => {
            is_valid_command(command) && is_valid_args(args)
        }
    }
}

fn is_add_scope(provider: AgentCliInvocation, scope: AgentMcpServerConfigScope) -> bool {
    match provider {
        AgentCliInvocation::ClaudeCode => matches!(
            scope,
            AgentMcpServerConfigScope::User | AgentMcpServerConfigScope::Local
        ),
        AgentCliInvocation::CodexExec => scope == AgentMcpServerConfigScope::User,
    }
}

fn is_remove_scope(provider: AgentCliInvocation, scope: AgentMcpServerConfigScope) -> bool {
    provider == AgentCliInvocation::ClaudeCode || scope == AgentMcpServerConfigScope::User
}

pub fn is_valid_change(provider: AgentCliInvocation, change: &AgentMcpServerChange) -> bool {
    match change {
        AgentMcpServerChange::Add {
            name,
            scope,
            launch,
        } => {
            is_valid_config_name(name)
                && is_add_scope(provider, *scope)
                && is_valid_launch(provider, launch)
        }
        AgentMcpServerChange::Remove { name, scope } => {
            is_valid_config_name(name) && is_remove_scope(provider, *scope)
        }
        AgentMcpServerChange::SignOut { name } => is_valid_server_name(name),
    }
}

pub fn validate_change_request(request: &AgentMcpServerChangeRequest) -> Result<(), String> {
    validate_repository_root(&request.repository_root).map_err(|_| invalid_request())?;
    if !is_valid_change(request.provider, &request.change) {
        return Err(invalid_request());
    }
    Ok(())
}

pub fn validate_login_start_request(
    request: &AgentMcpServerLoginStartRequest,
) -> Result<(), String> {
    validate_repository_root(&request.repository_root).map_err(|_| invalid_request())?;
    if !is_valid_server_name(&request.name) {
        return Err(invalid_request());
    }
    Ok(())
}

pub fn is_valid_login_id(login_id: &str) -> bool {
    (MIN_MCP_LOGIN_ID_BYTES..=MAX_MCP_LOGIN_ID_BYTES).contains(&login_id.len())
        && login_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub fn validate_login_request(request: &AgentMcpServerLoginRequest) -> Result<(), String> {
    if !is_valid_login_id(&request.login_id) {
        return Err(invalid_request());
    }
    Ok(())
}

#[cfg(test)]
#[path = "agent_mcp_server_manage_domain_tests.rs"]
mod tests;
