use super::mcp_device_config::{
    DeviceMcpHint, DeviceMcpLaunch, DeviceMcpSelection, DeviceMcpTransport, Disposition,
};
use super::types::id;
use crate::agent_mcp_server_manage_domain::is_valid_config_name;
use crate::agent_mcp_servers_domain::AGENT_MCP_SERVERS_UNAVAILABLE_ERROR as UNAVAILABLE;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;

const VERSION: u32 = 1;
const ROUTE_PREFIX: &str = "/v1/projects/";
const ROUTE_SUFFIX: &str = "/mcp-servers/claude/device-sync";
pub(super) const METHOD: &str = "PUT";
pub(super) const SYNC_TIMEOUT: Duration = Duration::from_secs(45);
pub(super) const MAX_OUTPUT: usize = 16 * 1024;
pub(super) const MAX_REQUEST_BYTES: usize = 256 * 1024;
pub(super) const MAX_RUNNER_RESULTS: usize = 96;
pub(super) const MAX_REPORTED_RESULTS: usize = 128;
pub(super) const REQUEST_TOO_LARGE: &str =
    "The Claude MCP servers on this Mac are too large to sync.";

pub(super) fn path(project_id: &str) -> Result<String, String> {
    id(project_id)?;
    Ok(format!("{ROUTE_PREFIX}{project_id}{ROUTE_SUFFIX}"))
}

pub(super) fn is_route(method: &str, path: &str) -> bool {
    method == METHOD
        && path
            .strip_prefix(ROUTE_PREFIX)
            .and_then(|rest| rest.strip_suffix(ROUTE_SUFFIX))
            .is_some_and(|project| id(project).is_ok())
}

#[derive(Serialize)]
struct SyncBody<'a> {
    version: u32,
    servers: Vec<SyncServer<'a>>,
    retain: Vec<&'a str>,
}

#[derive(Serialize)]
struct SyncServer<'a> {
    name: &'a str,
    launch: SyncLaunch<'a>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SyncLaunch<'a> {
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

impl<'a> SyncLaunch<'a> {
    fn of(launch: &'a DeviceMcpLaunch) -> Self {
        match launch {
            DeviceMcpLaunch::Stdio { command, args, env } => Self::Stdio { command, args, env },
            DeviceMcpLaunch::Http { url, headers } => Self::Http { url, headers },
            DeviceMcpLaunch::Sse { url, headers } => Self::Sse { url, headers },
        }
    }
}

pub(super) fn request_body(selection: &DeviceMcpSelection) -> Result<Value, &'static str> {
    let body = SyncBody {
        version: VERSION,
        servers: selection
            .transferable()
            .map(|(name, launch)| SyncServer {
                name,
                launch: SyncLaunch::of(launch),
            })
            .collect(),
        retain: selection.retained().collect(),
    };
    let encoded = serde_json::to_vec(&body).map_err(|_| REQUEST_TOO_LARGE)?;
    if encoded.len() > MAX_REQUEST_BYTES {
        return Err(REQUEST_TOO_LARGE);
    }
    serde_json::from_slice(&encoded).map_err(|_| REQUEST_TOO_LARGE)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RunnerOutcome {
    Added,
    Updated,
    Unchanged,
    Removed,
    KeptServerEntry,
    CommandMissing,
    Failed,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerSyncResult {
    name: String,
    outcome: RunnerOutcome,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerSyncResponse {
    version: u32,
    results: Vec<RunnerSyncResult>,
}

pub(super) fn parse_response(
    value: Value,
) -> Result<BTreeMap<String, RunnerOutcome>, &'static str> {
    let response: RunnerSyncResponse = serde_json::from_value(value).map_err(|_| UNAVAILABLE)?;
    if response.version != VERSION || response.results.len() > MAX_RUNNER_RESULTS {
        return Err(UNAVAILABLE);
    }
    let mut outcomes = BTreeMap::new();
    for result in response.results {
        if !is_valid_config_name(&result.name)
            || outcomes.insert(result.name, result.outcome).is_some()
        {
            return Err(UNAVAILABLE);
        }
    }
    Ok(outcomes)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceMcpSyncOutcome {
    Added,
    Updated,
    Unchanged,
    Removed,
    KeptServerEntry,
    CommandMissing,
    Failed,
    Skipped,
    Conflict,
}

impl From<RunnerOutcome> for DeviceMcpSyncOutcome {
    fn from(outcome: RunnerOutcome) -> Self {
        match outcome {
            RunnerOutcome::Added => Self::Added,
            RunnerOutcome::Updated => Self::Updated,
            RunnerOutcome::Unchanged => Self::Unchanged,
            RunnerOutcome::Removed => Self::Removed,
            RunnerOutcome::KeptServerEntry => Self::KeptServerEntry,
            RunnerOutcome::CommandMissing => Self::CommandMissing,
            RunnerOutcome::Failed => Self::Failed,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMcpSyncResult {
    name: String,
    transport: DeviceMcpTransport,
    outcome: DeviceMcpSyncOutcome,
    hints: Vec<DeviceMcpHint>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMcpSyncReport {
    version: u32,
    results: Vec<DeviceMcpSyncResult>,
    omitted: usize,
}

fn local_outcome(disposition: &Disposition) -> Option<DeviceMcpSyncOutcome> {
    match disposition {
        Disposition::Transfer(_) => None,
        Disposition::Skip(_) => Some(DeviceMcpSyncOutcome::Skipped),
        Disposition::Conflict => Some(DeviceMcpSyncOutcome::Conflict),
    }
}

fn is_sent_outcome(outcome: RunnerOutcome) -> bool {
    !matches!(outcome, RunnerOutcome::Removed)
}

fn is_runner_only_outcome(outcome: RunnerOutcome) -> bool {
    matches!(
        outcome,
        RunnerOutcome::Removed | RunnerOutcome::KeptServerEntry | RunnerOutcome::Failed
    )
}

pub(super) fn merge(
    selection: &DeviceMcpSelection,
    mut runner: BTreeMap<String, RunnerOutcome>,
) -> Result<DeviceMcpSyncReport, &'static str> {
    let mut results = Vec::with_capacity(selection.entries.len());
    for entry in &selection.entries {
        let reported = runner.remove(&entry.name);
        let outcome = match local_outcome(&entry.disposition) {
            Some(outcome) => outcome,
            None => match reported {
                Some(outcome) if !is_sent_outcome(outcome) => return Err(UNAVAILABLE),
                Some(outcome) => outcome.into(),
                None => DeviceMcpSyncOutcome::Failed,
            },
        };
        results.push(DeviceMcpSyncResult {
            name: entry.name.clone(),
            transport: entry.transport,
            outcome,
            hints: entry.hints.iter().copied().collect(),
        });
    }
    for (name, outcome) in runner {
        if !is_runner_only_outcome(outcome) {
            return Err(UNAVAILABLE);
        }
        results.push(DeviceMcpSyncResult {
            name,
            transport: DeviceMcpTransport::Unknown,
            outcome: outcome.into(),
            hints: Vec::new(),
        });
    }
    if results.len() > MAX_REPORTED_RESULTS {
        return Err(UNAVAILABLE);
    }
    results.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(DeviceMcpSyncReport {
        version: VERSION,
        results,
        omitted: selection.omitted,
    })
}

#[cfg(test)]
#[path = "mcp_device_sync_wire_tests.rs"]
mod tests;
