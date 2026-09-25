//! Bounded local clone jobs. The destination is reserved before acknowledging a job.
mod directory;
mod failure;
mod progress;
#[cfg(test)]
#[path = "progress_tests.rs"]
mod progress_tests;
#[cfg(unix)]
use crate::repository_process_support::{pipes, process_guard};
#[cfg(unix)]
mod git_environment;
#[cfg(unix)]
mod process;

mod service;
mod trust_revocation;
mod wire;

pub(crate) use service::LocalCloneState;
use tauri::Manager;
use wire::{CloneRequest, JobRequest, Snapshot};

#[tauri::command]
pub(crate) async fn local_clone_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalCloneState>,
    request: CloneRequest,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    crate::blocking_command::run_blocking_command(move || {
        let trust = app
            .try_state::<std::sync::Mutex<crate::trust::WorkspaceTrustService>>()
            .ok_or("Workspace trust is unavailable.")?;
        state.start(trust.inner(), request)
    })
    .await
}
#[tauri::command]
pub(crate) async fn local_get_project_clone(
    state: tauri::State<'_, LocalCloneState>,
    request: JobRequest,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    crate::blocking_command::run_blocking_command(move || state.get(&request.clone_id)).await
}
#[tauri::command]
pub(crate) async fn local_cancel_project_clone(
    state: tauri::State<'_, LocalCloneState>,
    request: JobRequest,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    crate::blocking_command::run_blocking_command(move || state.cancel(&request.clone_id)).await
}
