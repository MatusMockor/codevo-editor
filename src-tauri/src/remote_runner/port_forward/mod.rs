mod wire;

use super::{canonical_wire::Canonical, service::RemoteRunnerState};
use wire::PORT_PREVIEW_UNAVAILABLE;
pub use wire::{
    PortCloseRequest, PortListRequest, PortListing, PortOpenRequest, PortOpenResponse,
    PortReleaseOwnerRequest,
};

fn unavailable<T>(validation: Result<(), String>) -> Result<T, String> {
    validation?;
    Err(PORT_PREVIEW_UNAVAILABLE.into())
}

#[tauri::command]
pub async fn remote_port_list(
    _state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortListRequest>,
) -> Result<PortListing, String> {
    unavailable(request.0.validate())
}

#[tauri::command]
pub async fn remote_port_open(
    _state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortOpenRequest>,
) -> Result<PortOpenResponse, String> {
    unavailable(request.0.validate())
}

#[tauri::command]
pub async fn remote_port_close(
    _state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortCloseRequest>,
) -> Result<(), String> {
    unavailable(request.0.validate())
}

#[tauri::command]
pub async fn remote_port_release_owner(
    _state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<PortReleaseOwnerRequest>,
) -> Result<(), String> {
    request.0.validate()
}

#[cfg(test)]
#[path = "wire_tests.rs"]
mod tests;
