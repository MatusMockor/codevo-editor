use super::types::id;
use crate::agent_mcp_server_manage_domain::{
    is_valid_authorization_url, is_valid_login_id, AgentMcpServerAck, AgentMcpServerChange,
    AgentMcpServerConfigScope, AgentMcpServerLaunch, AgentMcpServerLoginMode,
    AgentMcpServerLoginState, AgentMcpServerLoginStatus,
    AGENT_MCP_SERVER_CALLBACK_REJECTED_ERROR as CALLBACK_REJECTED,
    AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR as CHANGE_UNSUPPORTED,
    AGENT_MCP_SERVER_EXISTS_ERROR as SERVER_EXISTS,
    AGENT_MCP_SERVER_INVALID_REQUEST_ERROR as INVALID_REQUEST,
    AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR as LOGIN_INACTIVE,
    AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR as LOGIN_UNSUPPORTED,
    AGENT_MCP_SERVER_NOT_FOUND_ERROR as SERVER_NOT_FOUND,
};
use crate::agent_mcp_servers_domain::{
    AGENT_MCP_SERVERS_BUSY_ERROR as BUSY, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR as UNAVAILABLE,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const VERSION: u32 = 1;
const HTTP_PREFIX: &str = "http://";
const ROUTE_PREFIX: &str = "/v1/projects/";
const PROVIDER_PREFIX: &str = "mcp-servers/";
const LOGIN_PREFIX: &str = "logins/";
pub(super) const MAX_CALLBACK_URL_BYTES: usize = 8192;
pub(super) const MAX_OUTPUT: usize = 16 * 1024;
pub(super) const CHANGE_TIMEOUT: Duration = Duration::from_secs(35);
pub(super) const LOGIN_START_TIMEOUT: Duration = Duration::from_secs(40);

const REFUSED_SERVER_EXISTS: &str = "Runner MCP server change found the name already configured.";
const REFUSED_SERVER_NOT_FOUND: &str = "Runner MCP server is not configured on the server.";
const REFUSED_CHANGE_UNSUPPORTED: &str = "Runner MCP server change is not supported.";
const REFUSED_LOGIN_UNSUPPORTED: &str = "Runner MCP server sign-in is not supported.";
const REFUSED_LOGIN_INACTIVE: &str = "Runner MCP server sign-in is no longer active.";
const REFUSED_CALLBACK: &str = "Runner MCP server sign-in did not accept the address.";
const REFUSED_INPUT: &str = "Runner MCP server management request was invalid.";
const REFUSED_BUSY: &str = "Runner MCP server management is busy.";
const REFUSED_STORAGE: &str = "Runner MCP server management failed on the server.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Route {
    Change,
    LoginStart,
    LoginState,
    LoginCallback,
    LoginCancel,
}

impl Route {
    pub(super) fn of(method: &str, path: &str) -> Option<Self> {
        let (project, rest) = path.strip_prefix(ROUTE_PREFIX)?.split_once('/')?;
        id(project).ok()?;
        let (provider, action) = rest.strip_prefix(PROVIDER_PREFIX)?.split_once('/')?;
        if !matches!(provider, "claude" | "codex") {
            return None;
        }
        match (method, action) {
            ("POST", "changes") => Some(Self::Change),
            ("POST", "logins") => Some(Self::LoginStart),
            _ => Self::of_login(method, action.strip_prefix(LOGIN_PREFIX)?),
        }
    }

    fn of_login(method: &str, login: &str) -> Option<Self> {
        let (login_id, action) = match login.split_once('/') {
            Some((login_id, action)) => (login_id, Some(action)),
            None => (login, None),
        };
        if !is_valid_login_id(login_id) {
            return None;
        }
        match (method, action) {
            ("GET", None) => Some(Self::LoginState),
            ("DELETE", None) => Some(Self::LoginCancel),
            ("POST", Some("callback")) => Some(Self::LoginCallback),
            _ => None,
        }
    }

    pub(super) fn timeout(self) -> Option<Duration> {
        match self {
            Self::Change => Some(CHANGE_TIMEOUT),
            Self::LoginStart => Some(LOGIN_START_TIMEOUT),
            Self::LoginState | Self::LoginCallback | Self::LoginCancel => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RunnerRefusal {
    McpServerExists,
    McpServerNotFound,
    McpChangeUnsupported,
    McpLoginUnsupported,
    McpLoginInactive,
    McpCallbackRejected,
    InvalidInput,
    Busy,
    StorageUnavailable,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerRefusalBody {
    error: RunnerRefusal,
}

impl RunnerRefusal {
    pub(super) const ALL: [Self; 9] = [
        Self::McpServerExists,
        Self::McpServerNotFound,
        Self::McpChangeUnsupported,
        Self::McpLoginUnsupported,
        Self::McpLoginInactive,
        Self::McpCallbackRejected,
        Self::InvalidInput,
        Self::Busy,
        Self::StorageUnavailable,
    ];

    pub(super) fn from_body(body: &[u8]) -> Option<Self> {
        serde_json::from_slice::<RunnerRefusalBody>(body)
            .ok()
            .map(|body| body.error)
    }

    pub(super) fn from_message(failure: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|refusal| refusal.message() == failure)
    }

    pub(super) fn message(self) -> &'static str {
        match self {
            Self::McpServerExists => REFUSED_SERVER_EXISTS,
            Self::McpServerNotFound => REFUSED_SERVER_NOT_FOUND,
            Self::McpChangeUnsupported => REFUSED_CHANGE_UNSUPPORTED,
            Self::McpLoginUnsupported => REFUSED_LOGIN_UNSUPPORTED,
            Self::McpLoginInactive => REFUSED_LOGIN_INACTIVE,
            Self::McpCallbackRejected => REFUSED_CALLBACK,
            Self::InvalidInput => REFUSED_INPUT,
            Self::Busy => REFUSED_BUSY,
            Self::StorageUnavailable => REFUSED_STORAGE,
        }
    }

    pub(super) fn contract_error(self) -> &'static str {
        match self {
            Self::McpServerExists => SERVER_EXISTS,
            Self::McpServerNotFound => SERVER_NOT_FOUND,
            Self::McpChangeUnsupported => CHANGE_UNSUPPORTED,
            Self::McpLoginUnsupported => LOGIN_UNSUPPORTED,
            Self::McpLoginInactive => LOGIN_INACTIVE,
            Self::McpCallbackRejected => CALLBACK_REJECTED,
            Self::InvalidInput => INVALID_REQUEST,
            Self::Busy => BUSY,
            Self::StorageUnavailable => UNAVAILABLE,
        }
    }
}

fn scope_name(scope: AgentMcpServerConfigScope) -> &'static str {
    match scope {
        AgentMcpServerConfigScope::User => "user",
        AgentMcpServerConfigScope::Project => "project",
        AgentMcpServerConfigScope::Local => "local",
    }
}

fn launch_value(launch: &AgentMcpServerLaunch) -> Value {
    match launch {
        AgentMcpServerLaunch::Http { url } => json!({ "kind": "http", "url": url }),
        AgentMcpServerLaunch::Sse { url } => json!({ "kind": "sse", "url": url }),
        AgentMcpServerLaunch::Stdio { command, args } => {
            json!({ "kind": "stdio", "command": command, "args": args })
        }
    }
}

fn change_value(change: &AgentMcpServerChange) -> Value {
    match change {
        AgentMcpServerChange::Add {
            name,
            scope,
            launch,
        } => json!({
            "kind": "add",
            "name": name,
            "scope": scope_name(*scope),
            "launch": launch_value(launch),
        }),
        AgentMcpServerChange::Remove { name, scope } => {
            json!({ "kind": "remove", "name": name, "scope": scope_name(*scope) })
        }
        AgentMcpServerChange::SignOut { name } => json!({ "kind": "signOut", "name": name }),
    }
}

fn mode_name(mode: AgentMcpServerLoginMode) -> &'static str {
    match mode {
        AgentMcpServerLoginMode::SignIn => "signIn",
        AgentMcpServerLoginMode::SignInAgain => "signInAgain",
    }
}

pub(super) fn change_body(change: &AgentMcpServerChange) -> Value {
    json!({ "change": change_value(change) })
}

pub(super) fn login_body(name: &str, mode: AgentMcpServerLoginMode) -> Value {
    json!({ "name": name, "mode": mode_name(mode) })
}

pub(super) fn callback_body(callback_url: &str) -> Value {
    json!({ "callbackUrl": callback_url })
}

pub(super) fn is_valid_callback_url(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_CALLBACK_URL_BYTES {
        return false;
    }
    if value
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return false;
    }
    if !value
        .get(..HTTP_PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(HTTP_PREFIX))
    {
        return false;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url
            .query_pairs()
            .any(|(key, _)| matches!(key.as_ref(), "code" | "error"))
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum RunnerLoginDelivery {
    Paste,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum RunnerLoginStep {
    Completed {},
    FinishInBrowser {
        authorization_url: String,
    },
    AwaitingCallback {
        login_id: String,
        authorization_url: String,
        delivery: RunnerLoginDelivery,
    },
}

impl RunnerLoginStep {
    fn is_valid(&self) -> bool {
        match self {
            Self::Completed {} => true,
            Self::FinishInBrowser { authorization_url } => {
                is_valid_authorization_url(authorization_url)
            }
            Self::AwaitingCallback {
                login_id,
                authorization_url,
                delivery: RunnerLoginDelivery::Paste,
            } => is_valid_login_id(login_id) && is_valid_authorization_url(authorization_url),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteMcpServerLoginStarted {
    version: u32,
    step: RunnerLoginStep,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerAck {
    version: u32,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum RunnerLoginState {
    Pending,
    Succeeded,
    Failed,
}

impl RunnerLoginState {
    fn local(self) -> AgentMcpServerLoginState {
        match self {
            Self::Pending => AgentMcpServerLoginState::Pending,
            Self::Succeeded => AgentMcpServerLoginState::Succeeded,
            Self::Failed => AgentMcpServerLoginState::Failed,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerLoginStatus {
    version: u32,
    state: RunnerLoginState,
}

pub(super) fn parse_ack(value: Value) -> Result<AgentMcpServerAck, &'static str> {
    let ack: RunnerAck = serde_json::from_value(value).map_err(|_| UNAVAILABLE)?;
    if ack.version != VERSION {
        return Err(UNAVAILABLE);
    }
    Ok(AgentMcpServerAck::acknowledged())
}

pub(super) fn parse_login_started(
    value: Value,
) -> Result<RemoteMcpServerLoginStarted, &'static str> {
    let started: RemoteMcpServerLoginStarted =
        serde_json::from_value(value).map_err(|_| UNAVAILABLE)?;
    if started.version != VERSION || !started.step.is_valid() {
        return Err(UNAVAILABLE);
    }
    Ok(started)
}

pub(super) fn parse_login_status(value: Value) -> Result<AgentMcpServerLoginStatus, &'static str> {
    let status: RunnerLoginStatus = serde_json::from_value(value).map_err(|_| UNAVAILABLE)?;
    if status.version != VERSION {
        return Err(UNAVAILABLE);
    }
    Ok(AgentMcpServerLoginStatus::new(status.state.local()))
}

#[cfg(test)]
#[path = "mcp_server_manage_wire_tests.rs"]
mod tests;
