use super::super::{
    canonical_wire::canonical,
    git_sync_wire::{blank, runner_id, timestamp},
    types::{id, uuid},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

const MIN_PORT: u16 = 1024;
const MAX_PORTS: usize = 32;
const MAX_PROCESS_BYTES: usize = 15;
const MAX_OWNER_ID_BYTES: usize = 1024;
const MAX_PATH_BYTES: usize = 2048;
const MAX_OWNER_GENERATION: u64 = (1 << 53) - 1;
const INVALID: &str = "Invalid runner port listing";

fn required<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}

pub(super) fn port(value: u16) -> bool {
    value >= MIN_PORT
}

fn process_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PROCESS_BYTES
        && value.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

pub(super) fn owner_id(value: &str) -> Result<(), String> {
    if blank(value) || value.len() > MAX_OWNER_ID_BYTES || value.chars().any(char::is_control) {
        return Err("Invalid port forward owner".into());
    }
    Ok(())
}

pub(super) fn owner(value: &str, generation: u64) -> Result<(), String> {
    owner_id(value)?;
    if !(1..=MAX_OWNER_GENERATION).contains(&generation) {
        return Err("Invalid port forward owner generation".into());
    }
    Ok(())
}

pub(super) fn url_path(value: &str) -> Result<(), String> {
    if !value.starts_with('/')
        || value.len() > MAX_PATH_BYTES
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        return Err("Invalid server port path".into());
    }
    Ok(())
}

fn connection(server_id: &str, runner: &str) -> Result<(), String> {
    id(server_id)?;
    if !runner_id(runner) {
        return Err("Invalid runner identity".into());
    }
    Ok(())
}

fn listed_port(value: u16) -> Result<(), String> {
    if !port(value) {
        return Err("Invalid server port".into());
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum PortAddress {
    LoopbackV4,
    LoopbackV6,
    AnyV4,
    AnyV6,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum PortSource {
    Agent,
    Terminal,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ListeningPort {
    pub(super) port: u16,
    pub(super) address: PortAddress,
    pub(super) source: PortSource,
    pub(super) process: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortList {
    pub(super) ports: Vec<ListeningPort>,
    pub(super) truncated: bool,
    pub(super) scanned_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ForwardState {
    Opening,
    Open,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortForward {
    pub(super) local_port: u16,
    pub(super) state: ForwardState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ListedPort {
    pub(super) port: u16,
    pub(super) address: PortAddress,
    pub(super) source: PortSource,
    pub(super) process: String,
    #[serde(deserialize_with = "required")]
    pub(super) forward: Option<PortForward>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortListing {
    pub(super) ports: Vec<ListedPort>,
    pub(super) truncated: bool,
    pub(super) scanned_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PortScope {
    Task { task_id: String },
    Project { project_id: String },
}

impl PortScope {
    pub(super) fn validate(&self) -> Result<(), String> {
        match self {
            Self::Task { task_id } => uuid(task_id),
            Self::Project { project_id } => id(project_id),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PortScheme {
    Http,
    Https,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortListRequest {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) owner_id: String,
    pub(super) owner_generation: u64,
    pub(super) scope: PortScope,
}

impl PortListRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        connection(&self.server_id, &self.runner_id)?;
        owner(&self.owner_id, self.owner_generation)?;
        self.scope.validate()
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortOpenRequest {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) owner_id: String,
    pub(super) owner_generation: u64,
    pub(super) scope: PortScope,
    pub(super) port: u16,
    pub(super) scheme: PortScheme,
    pub(super) path: String,
}

impl PortOpenRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        connection(&self.server_id, &self.runner_id)?;
        owner(&self.owner_id, self.owner_generation)?;
        self.scope.validate()?;
        listed_port(self.port)?;
        url_path(&self.path)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortCloseRequest {
    pub(super) server_id: String,
    pub(super) owner_id: String,
    pub(super) owner_generation: u64,
    pub(super) scope: PortScope,
    pub(super) port: u16,
}

impl PortCloseRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        id(&self.server_id)?;
        owner(&self.owner_id, self.owner_generation)?;
        self.scope.validate()?;
        listed_port(self.port)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortReleaseOwnerRequest {
    pub(super) owner_id: String,
    pub(super) owner_generation: u64,
}

impl PortReleaseOwnerRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        owner(&self.owner_id, self.owner_generation)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortOpenResponse {
    pub(super) local_port: u16,
}

fn listed(port_value: u16, process: &str) -> bool {
    port(port_value) && process_name(process)
}

fn strictly_ordered<T>(items: &[T], key: fn(&T) -> (u16, PortAddress, PortSource)) -> bool {
    items.windows(2).all(|pair| key(&pair[0]) < key(&pair[1]))
}

impl PortList {
    pub(super) fn valid(&self) -> bool {
        self.ports.len() <= MAX_PORTS
            && timestamp(&self.scanned_at)
            && self.ports.iter().all(|p| listed(p.port, &p.process))
            && strictly_ordered(&self.ports, |p| (p.port, p.address, p.source))
    }
}

impl PortListing {
    pub(super) fn valid(&self) -> bool {
        self.ports.len() <= MAX_PORTS
            && timestamp(&self.scanned_at)
            && self
                .ports
                .iter()
                .all(|p| listed(p.port, &p.process) && p.forward.is_none_or(|f| port(f.local_port)))
            && strictly_ordered(&self.ports, |p| (p.port, p.address, p.source))
    }
}

impl PortOpenResponse {
    pub(super) fn valid(&self) -> bool {
        port(self.local_port)
    }
}

pub(super) fn parse_port_list(value: Value) -> Result<PortList, String> {
    let list: PortList = canonical(value).ok_or(INVALID)?;
    if !list.valid() {
        return Err(INVALID.into());
    }
    Ok(list)
}
