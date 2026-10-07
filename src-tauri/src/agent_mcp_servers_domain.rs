use crate::agent_command_catalog_domain::{sanitized_text, validate_repository_root};
use crate::agent_task_spawner::AgentCliInvocation;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const MAX_MCP_SERVERS: usize = 128;
pub const MAX_MCP_SERVER_NAME_BYTES: usize = 128;
pub const MAX_MCP_ENDPOINT_ORIGIN_BYTES: usize = 256;
pub const MAX_MCP_DETAIL_BYTES: usize = 256;
pub const MAX_MCP_TOOL_COUNT: u32 = 4096;
pub const AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR: &str =
    "Agent MCP server status workspace is not registered or its identity changed.";
pub const AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR: &str =
    "Agent MCP server status requires a trusted repository.";
pub const AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR: &str =
    "Agent MCP server status provider is disabled.";
pub const AGENT_MCP_SERVERS_BUSY_ERROR: &str = "Agent MCP server status check is already running.";
pub const AGENT_MCP_SERVERS_TIMED_OUT_ERROR: &str = "Agent MCP server status check timed out.";
pub const AGENT_MCP_SERVERS_UNAVAILABLE_ERROR: &str = "Agent MCP server status is unavailable.";
pub const AGENT_MCP_SERVERS_UNSUPPORTED_RUNNER_ERROR: &str =
    "The server runner does not support MCP server status. Update the runner on the server.";
pub const AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR: &str =
    "Server MCP server status could not be loaded. Check the connection and try again.";
pub const INVALID_REQUEST_ERROR: &str =
    "Agent MCP server status requests need a bounded normalized absolute repository root.";
const MCP_SERVERS_VERSION: u32 = 1;
const MAX_RAW_DETAIL_BYTES: usize = 4096;
const MIN_REDACTED_TOKEN_RUN: usize = 16;
const MIN_REDACTED_LETTER_RUN: usize = 32;
const REDACTED: &str = "[redacted]";
const INVALID_ENVELOPE_ERROR: &str = "Unsupported agent MCP server status envelope.";
const INVALID_SERVER_ERROR: &str = "Invalid agent MCP server status entry.";
const INVALID_PROVIDER_PAYLOAD_ERROR: &str = "Provider MCP server status payload is invalid.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerStatus {
    Connected,
    Connecting,
    NeedsAuth,
    Failed,
    Disabled,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerScope {
    User,
    Project,
    Local,
    Account,
    Plugin,
    Managed,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMcpServerTransport {
    Stdio,
    Http,
    Sse,
    Unknown,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServer {
    pub name: String,
    pub status: AgentMcpServerStatus,
    pub scope: AgentMcpServerScope,
    pub transport: AgentMcpServerTransport,
    #[serde(deserialize_with = "required_nullable")]
    pub endpoint_origin: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub tool_count: Option<u32>,
    #[serde(deserialize_with = "required_nullable")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServers {
    pub version: u32,
    pub provider: AgentCliInvocation,
    pub truncated: bool,
    pub servers: Vec<AgentMcpServer>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpServersRequest {
    pub repository_root: String,
    pub provider: AgentCliInvocation,
}

pub fn validate_request(request: &AgentMcpServersRequest) -> Result<(), String> {
    validate_repository_root(&request.repository_root)
        .map_err(|_| INVALID_REQUEST_ERROR.to_string())
}

fn is_bidi_control(character: char) -> bool {
    matches!(
        character,
        '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
    )
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

pub fn is_valid_server_name(value: &str) -> bool {
    bounded_text(value, MAX_MCP_SERVER_NAME_BYTES) && !value.chars().any(is_bidi_control)
}

fn is_host_name(host: &str) -> bool {
    !host.is_empty()
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_'))
}

fn is_port(port: &str) -> bool {
    (1..=5).contains(&port.len())
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|port| port != 0)
}

fn is_optional_port(suffix: &str) -> bool {
    suffix.is_empty() || suffix.strip_prefix(':').is_some_and(is_port)
}

fn is_ipv6_literal(address: &str) -> bool {
    !address.is_empty()
        && address
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || matches!(byte, b':' | b'.'))
}

fn is_valid_authority(authority: &str) -> bool {
    if let Some(bracketed) = authority.strip_prefix('[') {
        return bracketed
            .split_once(']')
            .is_some_and(|(address, port)| is_ipv6_literal(address) && is_optional_port(port));
    }
    match authority.rsplit_once(':') {
        Some((host, port)) => is_host_name(host) && is_port(port),
        None => is_host_name(authority),
    }
}

pub fn is_valid_endpoint_origin(value: &str) -> bool {
    if value.len() > MAX_MCP_ENDPOINT_ORIGIN_BYTES {
        return false;
    }
    value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .is_some_and(is_valid_authority)
}

fn http_scheme(url: &str) -> Option<(&'static str, &str)> {
    ["https", "http"].into_iter().find_map(|scheme| {
        let prefix = url.get(..scheme.len() + 3)?;
        let (head, separator) = prefix.split_at(scheme.len());
        (head.eq_ignore_ascii_case(scheme) && separator == "://")
            .then(|| (scheme, &url[prefix.len()..]))
    })
}

pub fn endpoint_origin(url: &str) -> Option<String> {
    let (scheme, rest) = http_scheme(url)?;
    let authority = rest.split(['/', '?', '#', '\\']).next()?;
    let host = authority.rsplit('@').next()?;
    let origin = format!("{scheme}://{}", host.to_ascii_lowercase());
    is_valid_endpoint_origin(&origin).then_some(origin)
}

fn is_valid_endpoint(server: &AgentMcpServer) -> bool {
    match (&server.endpoint_origin, server.transport) {
        (None, _) => true,
        (Some(_), AgentMcpServerTransport::Stdio) => false,
        (Some(origin), _) => is_valid_endpoint_origin(origin),
    }
}

fn is_valid_detail_text(detail: &str) -> bool {
    bounded_text(detail, MAX_MCP_DETAIL_BYTES) && !detail.chars().any(is_bidi_control)
}

fn is_valid_detail(server: &AgentMcpServer) -> bool {
    match (&server.detail, server.status) {
        (None, _) => true,
        (Some(detail), AgentMcpServerStatus::Failed) => is_valid_detail_text(detail),
        (Some(_), _) => false,
    }
}

fn is_valid_server(server: &AgentMcpServer) -> bool {
    is_valid_server_name(&server.name)
        && is_valid_endpoint(server)
        && server
            .tool_count
            .is_none_or(|count| count <= MAX_MCP_TOOL_COUNT)
        && is_valid_detail(server)
}

pub fn validate_servers(snapshot: &AgentMcpServers) -> Result<(), String> {
    if snapshot.version != MCP_SERVERS_VERSION || snapshot.servers.len() > MAX_MCP_SERVERS {
        return Err(INVALID_ENVELOPE_ERROR.into());
    }
    let mut names = HashSet::new();
    if snapshot
        .servers
        .iter()
        .any(|server| !is_valid_server(server) || !names.insert(server.name.as_str()))
    {
        return Err(INVALID_SERVER_ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
pub fn parse_mcp_servers(value: Value) -> Result<AgentMcpServers, String> {
    let snapshot: AgentMcpServers =
        serde_json::from_value(value).map_err(|_| INVALID_ENVELOPE_ERROR)?;
    validate_servers(&snapshot)?;
    Ok(snapshot)
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn present<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|field| !field.is_null())
}

fn bounded_tool_count(count: usize) -> Option<u32> {
    u32::try_from(count)
        .ok()
        .filter(|count| *count <= MAX_MCP_TOOL_COUNT)
}

fn prefix_on_char_boundary(value: &str, max: usize) -> &str {
    if value.len() <= max {
        return value;
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn is_scheme_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
}

fn is_word_separator(character: char) -> bool {
    character.is_whitespace() || character.is_control()
}

fn is_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '+' | '-')
}

fn is_wrapping_punctuation(character: char) -> bool {
    matches!(
        character,
        '"' | '\''
            | '`'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '<'
            | '>'
            | ','
            | ';'
            | ':'
            | '.'
            | '!'
            | '?'
    )
}

fn is_sensitive_run(run: &str) -> bool {
    if run.len() < MIN_REDACTED_TOKEN_RUN {
        return false;
    }
    run.len() >= MIN_REDACTED_LETTER_RUN || run.bytes().any(|byte| byte.is_ascii_digit())
}

fn is_sensitive_text(text: &str) -> bool {
    text.contains(['/', '\\', '=', '@'])
        || text
            .split(|character: char| !is_token_character(character))
            .any(is_sensitive_run)
}

fn is_negative_number(word: &str) -> bool {
    word.strip_prefix('-').is_some_and(|digits| {
        digits.bytes().any(|byte| byte.is_ascii_digit())
            && digits
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
    })
}

fn is_option_word(word: &str) -> bool {
    let bare = word.trim_matches(is_wrapping_punctuation);
    bare.starts_with('-')
        && !is_negative_number(bare)
        && bare
            .trim_start_matches('-')
            .starts_with(|character: char| character.is_ascii_alphanumeric())
}

fn redacted_word(word: &str) -> String {
    let Some(separator) = word.find("://") else {
        return redacted_plain_word(word);
    };
    let scheme_start = word[..separator]
        .char_indices()
        .rev()
        .find(|(_, character)| !is_scheme_character(*character))
        .map_or(0, |(index, character)| index + character.len_utf8());
    let (prefix, url) = word.split_at(scheme_start);
    if is_sensitive_text(prefix) {
        return REDACTED.to_string();
    }
    let replacement = endpoint_origin(url).unwrap_or_else(|| REDACTED.to_string());
    format!("{prefix}{replacement}")
}

fn redacted_plain_word(word: &str) -> String {
    if is_sensitive_text(word) {
        return REDACTED.to_string();
    }
    word.to_string()
}

#[derive(Default)]
struct DetailRedaction {
    words: Vec<String>,
    redact_next: bool,
}

impl DetailRedaction {
    fn replacement(&self, word: &str, option: bool) -> String {
        if self.redact_next || option {
            return REDACTED.to_string();
        }
        redacted_word(word)
    }

    fn push(mut self, word: &str) -> Self {
        let option = is_option_word(word);
        let replacement = self.replacement(word, option);
        self.redact_next = option;
        let repeated =
            replacement == REDACTED && self.words.last().is_some_and(|last| last == REDACTED);
        if !repeated {
            self.words.push(replacement);
        }
        self
    }
}

fn bounded_raw_detail(raw: &str) -> &str {
    let prefix = prefix_on_char_boundary(raw, MAX_RAW_DETAIL_BYTES);
    if prefix.len() == raw.len() {
        return prefix;
    }
    prefix
        .rfind(is_word_separator)
        .map_or("", |end| &prefix[..end])
}

fn failure_detail(status: AgentMcpServerStatus, raw: Option<&str>) -> Option<String> {
    if status != AgentMcpServerStatus::Failed {
        return None;
    }
    let visible: String = bounded_raw_detail(raw?)
        .chars()
        .filter(|character| !is_bidi_control(*character))
        .collect();
    let redacted = visible
        .split(is_word_separator)
        .filter(|word| !word.is_empty())
        .fold(DetailRedaction::default(), DetailRedaction::push)
        .words
        .join(" ");
    sanitized_text(Some(&redacted), MAX_MCP_DETAIL_BYTES)
}

fn remote_origin(transport: AgentMcpServerTransport, url: Option<&str>) -> Option<String> {
    if transport == AgentMcpServerTransport::Stdio {
        return None;
    }
    url.and_then(endpoint_origin)
}

fn assemble(
    provider: AgentCliInvocation,
    candidates: impl Iterator<Item = Option<AgentMcpServer>>,
    incomplete: bool,
) -> Result<AgentMcpServers, String> {
    let mut names = HashSet::new();
    let mut servers = Vec::new();
    let mut truncated = incomplete;
    for candidate in candidates {
        let Some(server) = candidate.filter(|server| is_valid_server_name(&server.name)) else {
            truncated = true;
            continue;
        };
        if !names.insert(server.name.clone()) {
            truncated = true;
            continue;
        }
        if servers.len() == MAX_MCP_SERVERS {
            truncated = true;
            break;
        }
        servers.push(server);
    }
    servers.sort_by(|left, right| left.name.as_bytes().cmp(right.name.as_bytes()));
    let snapshot = AgentMcpServers {
        version: MCP_SERVERS_VERSION,
        provider,
        truncated,
        servers,
    };
    validate_servers(&snapshot)?;
    Ok(snapshot)
}

fn claude_status(status: Option<&str>) -> AgentMcpServerStatus {
    match status {
        Some("connected") => AgentMcpServerStatus::Connected,
        Some("pending") => AgentMcpServerStatus::Connecting,
        Some("needs-auth") => AgentMcpServerStatus::NeedsAuth,
        Some("failed") => AgentMcpServerStatus::Failed,
        Some("disabled") => AgentMcpServerStatus::Disabled,
        _ => AgentMcpServerStatus::Unknown,
    }
}

fn claude_scope(scope: Option<&str>) -> AgentMcpServerScope {
    match scope {
        Some("user") => AgentMcpServerScope::User,
        Some("project") => AgentMcpServerScope::Project,
        Some("local") => AgentMcpServerScope::Local,
        Some("claudeai") => AgentMcpServerScope::Account,
        Some("managed" | "enterprise") => AgentMcpServerScope::Managed,
        _ => AgentMcpServerScope::Unknown,
    }
}

fn claude_transport(config: Option<&Value>) -> AgentMcpServerTransport {
    let Some(kind) = config.and_then(|config| present(config, "type")) else {
        return AgentMcpServerTransport::Stdio;
    };
    match kind.as_str() {
        Some("stdio") => AgentMcpServerTransport::Stdio,
        Some("http" | "claudeai-proxy") => AgentMcpServerTransport::Http,
        Some("sse") => AgentMcpServerTransport::Sse,
        _ => AgentMcpServerTransport::Unknown,
    }
}

fn claude_server(entry: &Value) -> Option<AgentMcpServer> {
    let name = text_field(entry, "name")?.to_string();
    let status = claude_status(text_field(entry, "status"));
    let config = entry.get("config");
    let transport = claude_transport(config);
    Some(AgentMcpServer {
        name,
        status,
        scope: claude_scope(text_field(entry, "scope")),
        transport,
        endpoint_origin: remote_origin(
            transport,
            config.and_then(|config| text_field(config, "url")),
        ),
        tool_count: entry
            .get("tools")
            .and_then(Value::as_array)
            .and_then(|tools| bounded_tool_count(tools.len())),
        detail: failure_detail(status, text_field(entry, "error")),
    })
}

pub fn claude_mcp_servers(response: &Value) -> Result<AgentMcpServers, String> {
    let servers = response
        .get("mcpServers")
        .and_then(Value::as_array)
        .ok_or(INVALID_PROVIDER_PAYLOAD_ERROR)?;
    assemble(
        AgentCliInvocation::ClaudeCode,
        servers.iter().map(claude_server),
        false,
    )
}

fn codex_runtime_status(runtime: &Value) -> AgentMcpServerStatus {
    match runtime.as_str() {
        Some("connected") => AgentMcpServerStatus::Connected,
        Some("starting") => AgentMcpServerStatus::Connecting,
        Some("authenticationRequired") => AgentMcpServerStatus::NeedsAuth,
        Some("failed" | "cancelled") => AgentMcpServerStatus::Failed,
        Some("disabled") => AgentMcpServerStatus::Disabled,
        _ => AgentMcpServerStatus::Unknown,
    }
}

fn codex_status(entry: &Value) -> AgentMcpServerStatus {
    if let Some(runtime) = present(entry, "runtimeStatus") {
        return codex_runtime_status(runtime);
    }
    if text_field(entry, "authStatus") == Some("notLoggedIn") {
        return AgentMcpServerStatus::NeedsAuth;
    }
    if text_field(entry, "toolsError").is_some_and(|error| !error.trim().is_empty()) {
        return AgentMcpServerStatus::Failed;
    }
    if present(entry, "serverInfo").is_some() {
        return AgentMcpServerStatus::Connected;
    }
    AgentMcpServerStatus::Unknown
}

fn codex_scope(entry: &Value) -> AgentMcpServerScope {
    match present(entry, "pluginId") {
        Some(_) => AgentMcpServerScope::Plugin,
        None => AgentMcpServerScope::Unknown,
    }
}

fn codex_transport(entry: &Value) -> AgentMcpServerTransport {
    match present(entry, "httpOrigin") {
        Some(_) => AgentMcpServerTransport::Http,
        None => AgentMcpServerTransport::Stdio,
    }
}

fn codex_server(entry: &Value) -> Option<AgentMcpServer> {
    let name = text_field(entry, "name")?.to_string();
    let status = codex_status(entry);
    let transport = codex_transport(entry);
    Some(AgentMcpServer {
        name,
        status,
        scope: codex_scope(entry),
        transport,
        endpoint_origin: remote_origin(transport, text_field(entry, "httpOrigin")),
        tool_count: entry
            .get("tools")
            .and_then(Value::as_object)
            .and_then(|tools| bounded_tool_count(tools.len())),
        detail: failure_detail(status, text_field(entry, "toolsError")),
    })
}

pub fn codex_mcp_servers(result: &Value) -> Result<AgentMcpServers, String> {
    let data = result
        .get("data")
        .and_then(Value::as_array)
        .ok_or(INVALID_PROVIDER_PAYLOAD_ERROR)?;
    let incomplete = present(result, "nextCursor").is_some();
    assemble(
        AgentCliInvocation::CodexExec,
        data.iter().map(codex_server),
        incomplete,
    )
}

fn is_disabled_in_codex_config(config: &Value, name: &str) -> bool {
    config
        .get("config")
        .and_then(|config| config.get("mcp_servers"))
        .and_then(|servers| servers.get(name))
        .and_then(|server| server.get("enabled"))
        .and_then(Value::as_bool)
        == Some(false)
}

fn has_live_codex_status(server: &AgentMcpServer) -> bool {
    matches!(
        server.status,
        AgentMcpServerStatus::Connected | AgentMcpServerStatus::Connecting
    )
}

pub fn mark_codex_disabled_servers(snapshot: &mut AgentMcpServers, config: &Value) {
    snapshot
        .servers
        .iter_mut()
        .filter(|server| !has_live_codex_status(server))
        .filter(|server| is_disabled_in_codex_config(config, &server.name))
        .for_each(|server| {
            server.status = AgentMcpServerStatus::Disabled;
            server.detail = None;
        });
}

#[cfg(test)]
#[path = "agent_mcp_servers_domain_tests.rs"]
mod tests;
