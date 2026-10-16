use crate::agent_mcp_server_manage_domain::{
    is_valid_change, is_valid_config_name, is_valid_launch_url, AgentMcpServerChange,
    AgentMcpServerConfigScope, AgentMcpServerLaunch, MAX_MCP_ARGS, MAX_MCP_ARG_BYTES,
    MAX_MCP_COMMAND_BYTES,
};
use crate::agent_mcp_servers_domain::is_valid_server_name;
use crate::agent_task_spawner::AgentCliInvocation;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub(super) const MAX_DEVICE_CONFIG_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_SYNCED_SERVERS: usize = 32;
pub(super) const MAX_RETAINED_NAMES: usize = 64;
pub(super) const MAX_DESCENDANT_PROJECTS: usize = 64;
pub(super) const MAX_SOURCE_ENTRIES: usize = 128;
pub(super) const MAX_CANDIDATES: usize = MAX_SYNCED_SERVERS + MAX_RETAINED_NAMES;
pub(super) const MAX_ENV_ENTRIES: usize = 64;
pub(super) const MAX_ENV_KEY_BYTES: usize = 128;
pub(super) const MAX_HEADERS: usize = 32;
pub(super) const MAX_HEADER_NAME_BYTES: usize = 128;
pub(super) const MAX_VALUE_BYTES: usize = 8 * 1024;
pub(super) const MAX_ADD_JSON_BYTES: usize = 32 * 1024;
const MAC_HOME_PREFIX: &str = "/Users/";
const EXPANSION_MARKER: &str = "${";
const STDIO_KEYS: [&str; 4] = ["type", "command", "args", "env"];
const REMOTE_KEYS: [&str; 5] = ["type", "url", "headers", "headersHelper", "oauth"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ProjectKind {
    Folder,
    Git,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum DeviceMcpHint {
    MayNeedSignIn,
    EnvExpansion,
    MacPath,
    UnsupportedTransport,
    HeadersHelper,
    OauthClient,
    InvalidName,
    InvalidConfig,
    OverLimit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum DeviceMcpTransport {
    Stdio,
    Http,
    Sse,
    Unknown,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) enum DeviceMcpLaunch {
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Http {
        url: String,
        headers: BTreeMap<String, String>,
    },
    Sse {
        url: String,
        headers: BTreeMap<String, String>,
    },
}

impl fmt::Debug for DeviceMcpLaunch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Stdio { .. } => "Stdio",
            Self::Http { .. } => "Http",
            Self::Sse { .. } => "Sse",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SkipReason {
    InvalidName,
    UnsupportedTransport,
    HeadersHelper,
    InvalidConfig,
    OverLimit,
}

impl SkipReason {
    fn hint(self) -> DeviceMcpHint {
        match self {
            Self::InvalidName => DeviceMcpHint::InvalidName,
            Self::UnsupportedTransport => DeviceMcpHint::UnsupportedTransport,
            Self::HeadersHelper => DeviceMcpHint::HeadersHelper,
            Self::InvalidConfig => DeviceMcpHint::InvalidConfig,
            Self::OverLimit => DeviceMcpHint::OverLimit,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Disposition {
    Transfer(DeviceMcpLaunch),
    Skip(SkipReason),
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DeviceMcpEntry {
    pub(super) name: String,
    pub(super) transport: DeviceMcpTransport,
    pub(super) hints: BTreeSet<DeviceMcpHint>,
    pub(super) disposition: Disposition,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct DeviceMcpSelection {
    pub(super) entries: Vec<DeviceMcpEntry>,
    pub(super) omitted: usize,
}

impl DeviceMcpSelection {
    pub(super) fn empty() -> Self {
        Self {
            entries: Vec::new(),
            omitted: 0,
        }
    }

    pub(super) fn transferable(&self) -> impl Iterator<Item = (&str, &DeviceMcpLaunch)> {
        self.entries
            .iter()
            .filter_map(|entry| match &entry.disposition {
                Disposition::Transfer(launch) => Some((entry.name.as_str(), launch)),
                Disposition::Skip(_) | Disposition::Conflict => None,
            })
    }

    pub(super) fn retained(&self) -> impl Iterator<Item = &str> {
        self.entries
            .iter()
            .filter(|entry| {
                !matches!(entry.disposition, Disposition::Transfer(_))
                    && is_valid_config_name(&entry.name)
            })
            .map(|entry| entry.name.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DeviceConfigError {
    TooLarge,
    Invalid,
    TooManyServers,
}

impl DeviceConfigError {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::TooLarge => "The Claude configuration on this Mac is too large to read.",
            Self::Invalid => "The Claude configuration on this Mac is not valid JSON.",
            Self::TooManyServers => "This Mac has too many Claude MCP servers to sync.",
        }
    }
}

#[derive(Deserialize)]
struct DeviceConfigFile {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: Option<Value>,
    #[serde(default)]
    projects: Option<BTreeMap<String, DeviceProject>>,
}

#[derive(Deserialize)]
struct DeviceProject {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: Option<Value>,
}

type Source<'a> = Vec<(&'a str, &'a Value)>;

pub(super) fn select(
    config: &[u8],
    local_root: &str,
    kind: ProjectKind,
) -> Result<DeviceMcpSelection, DeviceConfigError> {
    if config.len() > MAX_DEVICE_CONFIG_BYTES {
        return Err(DeviceConfigError::TooLarge);
    }
    if config.trim_ascii_start().first() != Some(&b'{') {
        return Err(DeviceConfigError::Invalid);
    }
    let file: DeviceConfigFile =
        serde_json::from_slice(config).map_err(|_| DeviceConfigError::Invalid)?;
    let user = source(file.mcp_servers.as_ref())?;
    let projects = file.projects.unwrap_or_default();
    let root = source(
        projects
            .get(local_root)
            .and_then(|project| project.mcp_servers.as_ref()),
    )?;
    let descendants = match kind {
        ProjectKind::Git => Vec::new(),
        ProjectKind::Folder => descendant_sources(&projects, local_root)?,
    };
    let mut merged: BTreeMap<String, DeviceMcpEntry> = BTreeMap::new();
    for (name, entry) in user {
        merged.insert(name.to_owned(), classify(name, entry));
    }
    for (name, entry) in merge_descendants(descendants) {
        merged.insert(name, entry);
    }
    for (name, entry) in root {
        merged.insert(name.to_owned(), classify(name, entry));
    }
    if merged.len() > MAX_CANDIDATES {
        return Err(DeviceConfigError::TooManyServers);
    }
    finish(merged)
}

fn source(servers: Option<&Value>) -> Result<Source<'_>, DeviceConfigError> {
    let Some(servers) = servers.filter(|servers| !servers.is_null()) else {
        return Ok(Vec::new());
    };
    let servers = servers.as_object().ok_or(DeviceConfigError::Invalid)?;
    if servers.len() > MAX_SOURCE_ENTRIES {
        return Err(DeviceConfigError::TooManyServers);
    }
    Ok(servers
        .iter()
        .map(|(name, entry)| (name.as_str(), entry))
        .collect())
}

fn is_strict_descendant(key: &str, root: &str) -> bool {
    let prefix = if root == "/" {
        String::from("/")
    } else {
        format!("{root}/")
    };
    let Some(rest) = key.strip_prefix(&prefix) else {
        return false;
    };
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    !rest.is_empty()
        && rest
            .split('/')
            .all(|segment| !matches!(segment, "" | "." | ".."))
}

fn descendant_sources<'a>(
    projects: &'a BTreeMap<String, DeviceProject>,
    root: &str,
) -> Result<Vec<Source<'a>>, DeviceConfigError> {
    let mut sources = Vec::new();
    for (_, project) in projects
        .iter()
        .filter(|(key, _)| is_strict_descendant(key, root))
    {
        let servers = source(project.mcp_servers.as_ref())?;
        if servers.is_empty() {
            continue;
        }
        if sources.len() == MAX_DESCENDANT_PROJECTS {
            return Err(DeviceConfigError::TooManyServers);
        }
        sources.push(servers);
    }
    Ok(sources)
}

fn same_descendant_config(
    existing: &DeviceMcpEntry,
    existing_raw: &Value,
    entry: &DeviceMcpEntry,
    raw: &Value,
) -> bool {
    match (&existing.disposition, &entry.disposition) {
        (Disposition::Transfer(left), Disposition::Transfer(right)) => left == right,
        (left, right) => left == right && existing_raw == raw,
    }
}

fn merge_descendants(sources: Vec<Source<'_>>) -> BTreeMap<String, DeviceMcpEntry> {
    let mut merged: BTreeMap<String, (DeviceMcpEntry, &Value)> = BTreeMap::new();
    for (name, value) in sources.into_iter().flatten() {
        let entry = classify(name, value);
        let Some((existing, raw)) = merged.get_mut(name) else {
            merged.insert(name.to_owned(), (entry, value));
            continue;
        };
        if existing.disposition == Disposition::Conflict {
            continue;
        }
        if same_descendant_config(existing, raw, &entry, value) {
            existing.hints.extend(entry.hints);
            continue;
        }
        existing.hints.clear();
        existing.disposition = Disposition::Conflict;
    }
    merged
        .into_iter()
        .map(|(name, (entry, _))| (name, entry))
        .collect()
}

fn finish(
    merged: BTreeMap<String, DeviceMcpEntry>,
) -> Result<DeviceMcpSelection, DeviceConfigError> {
    let mut selection = DeviceMcpSelection::empty();
    let mut transferable = 0;
    for (_, mut entry) in merged {
        if !is_displayable_name(&entry.name) {
            selection.omitted += 1;
            continue;
        }
        if matches!(entry.disposition, Disposition::Transfer(_)) {
            transferable += 1;
            if transferable > MAX_SYNCED_SERVERS {
                entry.disposition = Disposition::Skip(SkipReason::OverLimit);
                entry.hints = BTreeSet::from([DeviceMcpHint::OverLimit]);
            }
        }
        selection.entries.push(entry);
    }
    if selection.retained().count() > MAX_RETAINED_NAMES {
        return Err(DeviceConfigError::TooManyServers);
    }
    Ok(selection)
}

fn is_script_trimmed(character: char) -> bool {
    character.is_whitespace() || character == '\u{feff}'
}

pub(super) fn is_displayable_name(name: &str) -> bool {
    is_valid_server_name(name) && name.trim_matches(is_script_trimmed) == name
}

fn skipped(name: &str, transport: DeviceMcpTransport, reason: SkipReason) -> DeviceMcpEntry {
    DeviceMcpEntry {
        name: name.to_owned(),
        transport,
        hints: BTreeSet::from([reason.hint()]),
        disposition: Disposition::Skip(reason),
    }
}

fn declared_transport(object: &Map<String, Value>) -> Option<DeviceMcpTransport> {
    match object.get("type") {
        None => Some(DeviceMcpTransport::Stdio),
        Some(Value::String(kind)) => Some(match kind.as_str() {
            "stdio" => DeviceMcpTransport::Stdio,
            "http" => DeviceMcpTransport::Http,
            "sse" => DeviceMcpTransport::Sse,
            _ => DeviceMcpTransport::Unknown,
        }),
        Some(_) => None,
    }
}

pub(super) fn classify(name: &str, value: &Value) -> DeviceMcpEntry {
    let object = value.as_object();
    let transport = object.and_then(declared_transport);
    if !is_valid_config_name(name) {
        let shown = transport.unwrap_or(DeviceMcpTransport::Unknown);
        return skipped(name, shown, SkipReason::InvalidName);
    }
    let (Some(object), Some(transport)) = (object, transport) else {
        return skipped(name, DeviceMcpTransport::Unknown, SkipReason::InvalidConfig);
    };
    let parsed = match transport {
        DeviceMcpTransport::Unknown => {
            return skipped(name, transport, SkipReason::UnsupportedTransport);
        }
        DeviceMcpTransport::Stdio => stdio(object),
        DeviceMcpTransport::Http | DeviceMcpTransport::Sse => {
            if object.contains_key("headersHelper") {
                return skipped(name, transport, SkipReason::HeadersHelper);
            }
            remote(object, transport)
        }
    };
    let Some(launch) = parsed.filter(fits_add_json) else {
        return skipped(name, transport, SkipReason::InvalidConfig);
    };
    DeviceMcpEntry {
        name: name.to_owned(),
        transport,
        hints: hints(object, &launch),
        disposition: Disposition::Transfer(launch),
    }
}

fn only_keys(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    let items = value.as_array()?;
    if items.len() > MAX_MCP_ARGS {
        return None;
    }
    items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|text| text.len() <= MAX_MCP_ARG_BYTES)
                .map(str::to_owned)
        })
        .collect()
}

fn string_map(
    value: Option<&Value>,
    max: usize,
    admit: fn(&str, &str) -> bool,
) -> Option<BTreeMap<String, String>> {
    let Some(value) = value else {
        return Some(BTreeMap::new());
    };
    let object = value.as_object()?;
    if object.len() > max {
        return None;
    }
    object
        .iter()
        .map(|(key, value)| {
            let value = value.as_str()?;
            admit(key, value).then(|| (key.clone(), value.to_owned()))
        })
        .collect()
}

fn is_env_entry(key: &str, value: &str) -> bool {
    is_env_key(key) && is_env_value(value)
}

fn is_header_entry(name: &str, value: &str) -> bool {
    is_header_name(name) && is_header_value(value)
}

fn is_env_key(key: &str) -> bool {
    let mut bytes = key.bytes();
    bytes
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
        && key.len() <= MAX_ENV_KEY_BYTES
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn is_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_HEADER_NAME_BYTES
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
}

fn is_env_value(value: &str) -> bool {
    value.len() <= MAX_VALUE_BYTES && !value.contains('\0')
}

fn is_header_value(value: &str) -> bool {
    value.len() <= MAX_VALUE_BYTES && !value.contains(['\r', '\n', '\0'])
}

fn stdio(object: &Map<String, Value>) -> Option<DeviceMcpLaunch> {
    if !only_keys(object, &STDIO_KEYS) {
        return None;
    }
    let command = object
        .get("command")?
        .as_str()
        .filter(|command| command.len() <= MAX_MCP_COMMAND_BYTES)?
        .to_owned();
    let args = strings(object.get("args"))?;
    let env = string_map(object.get("env"), MAX_ENV_ENTRIES, is_env_entry)?;
    let admitted = AgentMcpServerChange::Add {
        name: "device".into(),
        scope: AgentMcpServerConfigScope::Local,
        launch: AgentMcpServerLaunch::Stdio {
            command: command.clone(),
            args: args.clone(),
        },
    };
    if !is_valid_change(AgentCliInvocation::ClaudeCode, &admitted) {
        return None;
    }
    Some(DeviceMcpLaunch::Stdio { command, args, env })
}

fn remote(object: &Map<String, Value>, transport: DeviceMcpTransport) -> Option<DeviceMcpLaunch> {
    if !only_keys(object, &REMOTE_KEYS) {
        return None;
    }
    let url = object
        .get("url")?
        .as_str()
        .filter(|url| is_valid_launch_url(url))?
        .to_owned();
    let headers = string_map(object.get("headers"), MAX_HEADERS, is_header_entry)?;
    match transport {
        DeviceMcpTransport::Http => Some(DeviceMcpLaunch::Http { url, headers }),
        DeviceMcpTransport::Sse => Some(DeviceMcpLaunch::Sse { url, headers }),
        DeviceMcpTransport::Stdio | DeviceMcpTransport::Unknown => None,
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AddJson<'a> {
    Stdio {
        command: &'a str,
        args: &'a [String],
        env: &'a BTreeMap<String, String>,
    },
    Http {
        url: &'a str,
        headers: &'a BTreeMap<String, String>,
    },
    Sse {
        url: &'a str,
        headers: &'a BTreeMap<String, String>,
    },
}

pub(super) fn add_json_bytes(launch: &DeviceMcpLaunch) -> Option<usize> {
    let shape = match launch {
        DeviceMcpLaunch::Stdio { command, args, env } => AddJson::Stdio { command, args, env },
        DeviceMcpLaunch::Http { url, headers } => AddJson::Http { url, headers },
        DeviceMcpLaunch::Sse { url, headers } => AddJson::Sse { url, headers },
    };
    serde_json::to_vec(&shape).ok().map(|encoded| encoded.len())
}

fn fits_add_json(launch: &DeviceMcpLaunch) -> bool {
    add_json_bytes(launch).is_some_and(|bytes| bytes <= MAX_ADD_JSON_BYTES)
}

fn hints(object: &Map<String, Value>, launch: &DeviceMcpLaunch) -> BTreeSet<DeviceMcpHint> {
    let mut hints = BTreeSet::new();
    let (located, values): (Vec<&str>, Vec<&str>) = match launch {
        DeviceMcpLaunch::Stdio { command, args, env } => {
            let located: Vec<&str> = std::iter::once(command.as_str())
                .chain(args.iter().map(String::as_str))
                .collect();
            let values = located
                .iter()
                .copied()
                .chain(env.values().map(String::as_str))
                .collect();
            (located, values)
        }
        DeviceMcpLaunch::Http { url, headers } | DeviceMcpLaunch::Sse { url, headers } => {
            if object.contains_key("oauth") {
                hints.insert(DeviceMcpHint::OauthClient);
                hints.insert(DeviceMcpHint::MayNeedSignIn);
            }
            if !headers
                .keys()
                .any(|name| name.eq_ignore_ascii_case("authorization"))
            {
                hints.insert(DeviceMcpHint::MayNeedSignIn);
            }
            let values = std::iter::once(url.as_str())
                .chain(headers.values().map(String::as_str))
                .collect();
            (vec![url.as_str()], values)
        }
    };
    if values.iter().any(|value| value.contains(EXPANSION_MARKER)) {
        hints.insert(DeviceMcpHint::EnvExpansion);
    }
    if located
        .iter()
        .any(|value| value.starts_with(MAC_HOME_PREFIX))
    {
        hints.insert(DeviceMcpHint::MacPath);
    }
    hints
}

#[cfg(test)]
#[path = "mcp_device_config_tests.rs"]
mod tests;
