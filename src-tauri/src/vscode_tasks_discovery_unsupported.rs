use crate::vscode_tasks_discovery::{
    VscodeTaskDiagnosticSeverity, VscodeTaskDiscoveryDiagnostic, VscodeTasksDiscoveryRequest,
    VscodeTasksDiscoveryResponse,
};

const EMPTY_CONFIG_REVISION: &str =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";

#[tauri::command]
pub(crate) fn workspace_discover_vscode_process_tasks(
    _request: VscodeTasksDiscoveryRequest,
) -> Result<VscodeTasksDiscoveryResponse, String> {
    Ok(VscodeTasksDiscoveryResponse {
        config_revision: EMPTY_CONFIG_REVISION.to_string(),
        tasks: Vec::new(),
        diagnostics: vec![VscodeTaskDiscoveryDiagnostic {
            severity: VscodeTaskDiagnosticSeverity::Error,
            message: "VS Code process tasks are not supported on this platform.".to_string(),
        }],
        truncated: false,
    })
}
