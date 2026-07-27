use super::installation::validate_function_breakpoints;
use crate::debug_adapter::{
    DebugFunctionBreakpoint, DebugFunctionBreakpointVerification, DebugSessionRegistry,
};
use crate::debug_session_registry::{
    retain_workspace_root, DebugWorkspaceAuthority, RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetFunctionBreakpointsRequest {
    root_path: String,
    session_id: u64,
    generation: u64,
    breakpoints: Vec<DebugFunctionBreakpoint>,
}

impl DebugSetFunctionBreakpointsRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.root_path.is_empty()
            || self.root_path.len() > 4_096
            || self.root_path.chars().any(char::is_control)
        {
            return Err("Debug workspace root is invalid.".to_string());
        }
        if self.session_id == 0 || self.session_id > 9_007_199_254_740_991 {
            return Err("Debug session id must be a positive JavaScript-safe integer.".to_string());
        }
        if self.generation == 0 || self.generation > 9_007_199_254_740_991 {
            return Err(
                "Function breakpoint generation must be a positive JavaScript-safe integer."
                    .to_string(),
            );
        }
        validate_function_breakpoints(&self.breakpoints)
    }
}

fn retain_function_breakpoint_workspace(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<RetainedDebugWorkspaceRoot, String> {
    let retained = retain_workspace_root(registry, root_path)?;
    let root_key = retained.live_path()?.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    }
    Ok(retained)
}

#[tauri::command]
pub(crate) async fn debug_set_function_breakpoints(
    request: DebugSetFunctionBreakpointsRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
    request.validate()?;
    let retained = retain_function_breakpoint_workspace(&workspace_registry, &request.root_path)?;
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    };
    let root_key = canonical_root.clone();
    let authority = retained.authority.clone();
    let registry = Arc::clone(registry.inner());
    crate::run_blocking_command(move || {
        let _retained = retained;
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(&root_key).trusted {
            return Err("Trust this workspace to control the debugger.".to_string());
        }
        registry.mutate_for_session_authorized(request.session_id, &authority, |adapter| {
            adapter.set_function_breakpoints(&request.breakpoints, request.generation)
        })?
    })
    .await
}
