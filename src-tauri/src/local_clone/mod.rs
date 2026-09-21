//! Bounded local clone jobs. The destination is reserved before acknowledging a job.
mod directory;
#[cfg(unix)]
use crate::repository_process_support::{pipes, process_guard};
#[cfg(unix)]
mod process;

mod service;
mod wire;

pub(crate) use service::LocalCloneState;
use wire::{CloneRequest, JobRequest, Snapshot};

#[tauri::command]
pub(crate) async fn local_clone_project(
    state: tauri::State<'_, LocalCloneState>,
    request: CloneRequest,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    crate::blocking_command::run_blocking_command(move || state.start(request)).await
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
