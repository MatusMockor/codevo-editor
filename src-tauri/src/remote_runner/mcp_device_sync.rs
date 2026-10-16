use super::{
    commands::{blocking, OperationClass},
    mcp_device_config::{select, DeviceMcpSelection, ProjectKind},
    mcp_device_config_fs::{device_config_path, read_bounded},
    mcp_device_sync_wire::{self, merge, parse_response, request_body, DeviceMcpSyncReport},
    mcp_server_manage::contract_error,
    mcp_servers::{admit_capability, ensure_exact_runner, text},
    project_management::call_lease,
    service::{ConnectionLease, RemoteRunnerState},
    types::id,
    workspace_authority::{is_bounded_root_path, AuthorityMessages, WorkspaceAuthority},
};
use crate::agent_mcp_server_manage_domain::AGENT_MCP_SERVER_INVALID_REQUEST_ERROR as INVALID_REQUEST;
use crate::agent_mcp_servers_domain::AGENT_MCP_SERVERS_SERVER_UNAVAILABLE_ERROR as SERVER_UNAVAILABLE;
use crate::{trust::WorkspaceTrustService, workspace_registry::WorkspaceRegistry};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;

const CAPABILITY: &str = "mcpDeviceSync";
const MAX_RUNNER_ID_BYTES: usize = 128;
pub(super) const SYNC_BUSY: &str = "Claude MCP servers are already being synced to a server.";

const DEVICE_SYNC_AUTHORITY: AuthorityMessages = AuthorityMessages {
    invalid_root: "Invalid MCP server sync workspace root",
    not_registered: "MCP server sync workspace is not registered",
    invalid_path: "Invalid MCP server sync workspace path",
    trust_unavailable: "Workspace trust unavailable",
    untrusted: "Trust this workspace before syncing its MCP servers",
    identity_changed: "MCP server sync workspace identity changed",
    no_longer_registered: "MCP server sync workspace is no longer registered",
    changed: "MCP server sync workspace changed while reading its MCP servers",
    unavailable: "MCP server sync workspace unavailable",
    path_changed: "MCP server sync workspace path changed",
    trust_changed: "Workspace trust changed while reading its MCP servers",
};

static SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

struct SyncPermit;

impl SyncPermit {
    fn acquire() -> Result<Self, &'static str> {
        SYNC_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| SYNC_BUSY)
    }
}

impl Drop for SyncPermit {
    fn drop(&mut self) {
        SYNC_ACTIVE.store(false, Ordering::Release);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceMcpSyncRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    root_path: String,
    project_kind: ProjectKind,
}

impl DeviceMcpSyncRequest {
    fn admitted(&self) -> Result<String, &'static str> {
        if id(&self.server_id).is_err()
            || !text(&self.runner_id, MAX_RUNNER_ID_BYTES)
            || !is_bounded_root_path(&self.root_path)
        {
            return Err(INVALID_REQUEST);
        }
        mcp_device_sync_wire::path(&self.project_id).map_err(|_| INVALID_REQUEST)
    }
}

fn read_device_config() -> Result<Option<Vec<u8>>, &'static str> {
    read_bounded(&device_config_path()?)
}

fn collect<'a>(
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    root_path: &str,
    kind: ProjectKind,
    read: impl FnOnce() -> Result<Option<Vec<u8>>, &'static str>,
) -> Result<(WorkspaceAuthority<'a>, DeviceMcpSelection), String> {
    let authority =
        WorkspaceAuthority::capture(registry, trust, root_path, &DEVICE_SYNC_AUTHORITY)?;
    let selection = match read()? {
        None => DeviceMcpSelection::empty(),
        Some(config) => select(&config, authority.canonical_root(), kind)
            .map_err(|failure| failure.message())?,
    };
    authority.confirm()?;
    Ok((authority, selection))
}

fn synchronize(
    authority: &WorkspaceAuthority<'_>,
    lease: &ConnectionLease,
    path: &str,
    selection: &DeviceMcpSelection,
) -> Result<DeviceMcpSyncReport, String> {
    let body = request_body(selection)?;
    let descriptor = call_lease(lease.clone(), "GET", "/v1/runner", None)
        .map_err(|failure| contract_error(&failure))?;
    admit_capability(descriptor, lease.runner_id(), CAPABILITY)?;
    authority.confirm()?;
    let answer = call_lease(
        lease.clone(),
        mcp_device_sync_wire::METHOD,
        path,
        Some(body),
    )
    .map_err(|failure| contract_error(&failure))?;
    Ok(merge(selection, parse_response(answer)?)?)
}

fn run(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    (root_path, kind): (&str, ProjectKind),
    read: impl FnOnce() -> Result<Option<Vec<u8>>, &'static str>,
    lease: &ConnectionLease,
    path: &str,
) -> Result<DeviceMcpSyncReport, String> {
    let (authority, selection) = collect(registry, trust, root_path, kind, read)?;
    synchronize(&authority, lease, path, &selection)
}

#[tauri::command]
pub async fn remote_runner_sync_device_mcp_servers(
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteRunnerState>,
    request: DeviceMcpSyncRequest,
) -> Result<DeviceMcpSyncReport, String> {
    let path = request.admitted()?;
    let permit = SyncPermit::acquire()?;
    let lease = state
        .connection_lease(&request.server_id)
        .map_err(|_| SERVER_UNAVAILABLE)?;
    ensure_exact_runner(&lease, &request.runner_id)?;
    let work_lease = lease.clone();
    let root_path = request.root_path;
    let kind = request.project_kind;
    let outcome = blocking(OperationClass::Control, move || {
        let _permit = permit;
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        Ok(run(
            &registry,
            &trust,
            (&root_path, kind),
            read_device_config,
            &work_lease,
            &path,
        ))
    })
    .await
    .map_err(|failure| contract_error(&failure))?;
    ensure_exact_runner(&lease, &request.runner_id)?;
    outcome
}

#[cfg(test)]
#[path = "mcp_device_sync_tests.rs"]
mod tests;
