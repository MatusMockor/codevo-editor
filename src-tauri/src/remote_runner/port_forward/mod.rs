mod local_port;
mod manager;
mod registry;
mod ssh_forward;
mod wire;

use super::{
    canonical_wire::Canonical,
    service::{ConnectionLease, RemoteRunnerState},
};
use crate::workspace_registry::{RegistrationOwner, WorkspaceId, WorkspaceRegistry};
use manager::{ForwardContext, OpenTarget, PortTarget, READY_TIMEOUT};
use registry::{ForwardKey, OwnerAuthority, OwnerLease};
pub(in crate::remote_runner) use registry::{ForwardSet, PortForwardRegistry};
pub(in crate::remote_runner) use ssh_forward::ForwardDestination;
use ssh_forward::SshForwardProgram;
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use wire::{parse_port_list, PortList, PortScope};
pub use wire::{
    PortCloseRequest, PortListRequest, PortListing, PortOpenRequest, PortOpenResponse,
    PortReleaseOwnerRequest,
};

const RUNNER_CHANGED: &str = "Runner identity changed";
const CONNECTION_CHANGED: &str = "Runner connection was superseded";
const INVALID_OUTPUT: &str = "Invalid server port forward state";
const MAX_PORT_OPERATIONS: usize = 4;
static PORT_OPERATIONS: AtomicUsize = AtomicUsize::new(0);

struct PortOperationPermit;

impl PortOperationPermit {
    fn acquire() -> Result<Self, String> {
        PORT_OPERATIONS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_PORT_OPERATIONS).then_some(count + 1)
            })
            .map_err(|_| "Server port forwarding is busy; retry shortly")?;
        Ok(Self)
    }
}

impl Drop for PortOperationPermit {
    fn drop(&mut self) {
        PORT_OPERATIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

async fn run_blocking<T: Send + 'static>(
    permit: Option<PortOperationPermit>,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(|_| "Server port forwarding failed".to_string())?
}

struct WorkspaceOwners<'a>(Option<&'a WorkspaceRegistry>);

impl OwnerAuthority for WorkspaceOwners<'_> {
    fn is_live(&self, owner: &OwnerLease) -> bool {
        let Some(workspaces) = self.0 else {
            return false;
        };
        let Ok(workspace_id) =
            serde_json::from_value::<WorkspaceId>(serde_json::Value::String(owner.id.clone()))
        else {
            return false;
        };
        [RegistrationOwner::Editor, RegistrationOwner::Agent]
            .into_iter()
            .any(|kind| workspaces.holds_admission(&workspace_id, kind, owner.generation))
    }
}

fn owner(id: &str, generation: u64) -> OwnerLease {
    OwnerLease {
        id: id.into(),
        generation,
    }
}

fn ports_path(scope: &PortScope) -> String {
    match scope {
        PortScope::Task { task_id } => format!("/v1/tasks/{task_id}/ports"),
        PortScope::Project { project_id } => format!("/v1/projects/{project_id}/ports"),
    }
}

fn admitted_lease(
    state: &RemoteRunnerState,
    server_id: &str,
    runner_id: &str,
) -> Result<ConnectionLease, String> {
    let lease = state.connection_lease(server_id)?;
    if lease.runner_id() != runner_id {
        return Err(RUNNER_CHANGED.into());
    }
    Ok(lease)
}

fn with_context<T>(
    lease: &ConnectionLease,
    registry: &Arc<PortForwardRegistry>,
    authority: &dyn OwnerAuthority,
    work: impl FnOnce(&ForwardContext<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let session = lease.session()?;
    if !lease.is_current() {
        return Err(CONNECTION_CHANGED.into());
    }
    let connection_current = || lease.is_current() && session.is_alive();
    let listing = |scope: &PortScope| -> Result<PortList, String> {
        let value = session.request(lease.server(), "GET", &ports_path(scope), None, vec![])?;
        if !lease.is_current() {
            return Err(CONNECTION_CHANGED.into());
        }
        parse_port_list(value)
    };
    work(&ForwardContext {
        forwards: session.forwards(),
        registry,
        authority,
        program: &SshForwardProgram,
        connection_current: &connection_current,
        listing: &listing,
        ready_timeout: READY_TIMEOUT,
    })
}

fn release_owner(registry: &PortForwardRegistry, owner_id: &str, generation: u64) {
    if wire::owner(owner_id, generation).is_ok() {
        registry.release(&owner(owner_id, generation));
    }
}

pub(in crate::remote_runner) fn release_retired_owner(
    registry: &PortForwardRegistry,
    workspaces: &WorkspaceRegistry,
    owner_id: &str,
) {
    if wire::owner_id(owner_id).is_ok() {
        registry.release_retired(owner_id, &WorkspaceOwners(Some(workspaces)));
    }
}

#[tauri::command]
pub async fn remote_port_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortListRequest>,
) -> Result<PortListing, String> {
    let request = request.0;
    request.validate()?;
    let lease = admitted_lease(&state, &request.server_id, &request.runner_id)?;
    let registry = state.port_forwards();
    let permit = PortOperationPermit::acquire()?;
    run_blocking(Some(permit), move || {
        let workspaces = app.try_state::<WorkspaceRegistry>();
        let authority = WorkspaceOwners(workspaces.as_ref().map(|state| state.inner()));
        let owner = owner(&request.owner_id, request.owner_generation);
        let target = PortTarget {
            owner: &owner,
            scope: &request.scope,
        };
        let listing = with_context(&lease, &registry, &authority, |ctx| {
            manager::list(ctx, &target, Instant::now())
        })?;
        if !listing.valid() {
            return Err(INVALID_OUTPUT.into());
        }
        Ok(listing)
    })
    .await
}

#[tauri::command]
pub async fn remote_port_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortOpenRequest>,
) -> Result<PortOpenResponse, String> {
    let request = request.0;
    request.validate()?;
    let lease = admitted_lease(&state, &request.server_id, &request.runner_id)?;
    let registry = state.port_forwards();
    let permit = PortOperationPermit::acquire()?;
    run_blocking(Some(permit), move || {
        let workspaces = app.try_state::<WorkspaceRegistry>();
        let authority = WorkspaceOwners(workspaces.as_ref().map(|state| state.inner()));
        let owner = owner(&request.owner_id, request.owner_generation);
        let target = PortTarget {
            owner: &owner,
            scope: &request.scope,
        };
        let open = OpenTarget {
            port: request.port,
            scheme: request.scheme,
            path: &request.path,
        };
        let open_url = |url: &str| {
            app.opener()
                .open_url(url, None::<String>)
                .map_err(|_| "Unable to open the browser.".to_string())
        };
        let local_port = with_context(&lease, &registry, &authority, |ctx| {
            manager::open(ctx, &target, &open, &open_url)
        })?;
        let response = PortOpenResponse { local_port };
        if !response.valid() {
            return Err(INVALID_OUTPUT.into());
        }
        Ok(response)
    })
    .await
}

#[tauri::command]
pub async fn remote_port_close(
    state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortCloseRequest>,
) -> Result<(), String> {
    let request = request.0;
    request.validate()?;
    let registry = state.port_forwards();
    run_blocking(None, move || {
        let key = ForwardKey {
            owner: owner(&request.owner_id, request.owner_generation),
            scope: request.scope,
            port: request.port,
        };
        registry.close_forward(&request.server_id, &key);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remote_port_release_owner(
    state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortReleaseOwnerRequest>,
) -> Result<(), String> {
    let request = request.0;
    request.validate()?;
    let registry = state.port_forwards();
    run_blocking(None, move || {
        release_owner(&registry, &request.owner_id, request.owner_generation);
        Ok(())
    })
    .await
}

#[cfg(test)]
#[path = "wire_tests.rs"]
mod wire_tests;

#[cfg(all(test, unix))]
mod test_support;

#[cfg(all(test, unix))]
mod tests;
