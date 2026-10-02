use super::{
    canonical_wire::Canonical,
    git_sync_wire::{RemoteGitRequest, RemoteGitResponse, GIT_SYNC_UNAVAILABLE},
    service::RemoteRunnerState,
};

pub(super) fn unavailable(request: &RemoteGitRequest) -> Result<RemoteGitResponse, String> {
    request.validate()?;
    Err(GIT_SYNC_UNAVAILABLE.into())
}

#[tauri::command]
pub async fn remote_runner_git(
    _state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<RemoteGitRequest>,
) -> Result<RemoteGitResponse, String> {
    unavailable(&request.0)
}
