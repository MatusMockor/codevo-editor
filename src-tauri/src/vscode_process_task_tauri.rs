use crate::{
    vscode_process_task_commands::VscodeProcessTaskCommandService,
    vscode_process_task_events::VscodeProcessTaskOwner,
};
use tauri::State;

#[tauri::command]
pub(crate) async fn workspace_start_vscode_process_task(
    request: VscodeProcessTaskOwner,
    service: State<'_, VscodeProcessTaskCommandService>,
) -> Result<VscodeProcessTaskOwner, String> {
    let service = service.inner().clone();
    crate::run_blocking_command(move || service.start(request)).await
}

#[tauri::command]
pub(crate) fn workspace_acknowledge_vscode_process_task_start(
    request: VscodeProcessTaskOwner,
    service: State<'_, VscodeProcessTaskCommandService>,
) -> Result<(), String> {
    service.acknowledge(request)
}

#[tauri::command]
pub(crate) fn workspace_stop_vscode_process_task(
    request: VscodeProcessTaskOwner,
    service: State<'_, VscodeProcessTaskCommandService>,
) -> Result<(), String> {
    service.stop(request)
}
