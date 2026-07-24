use super::debug_completions_wire::DebugCompletionsRequest;
use super::retain_workspace_root;
use crate::debug_adapter::{DebugCompletionResult, DebugSessionRegistry};
use crate::debug_session_registry::DebugWorkspaceAuthority;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub(crate) async fn debug_completions(
    request: DebugCompletionsRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugCompletionResult, String> {
    request.validate()?;
    let retained = retain_workspace_root(&workspace_registry, &request.root_path)?;
    let root = retained.live_path()?;
    let root_key = root.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before completion.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before completion.".to_string());
    }
    ensure_trusted(&trust, &root_key)?;

    let registry = Arc::clone(registry.inner());
    let authority = retained.authority.clone();
    let session_id = request.session_id;
    let adapter_request = request.adapter_request();
    let (result, retained) = crate::run_blocking_command(move || {
        let result =
            registry.mutate_for_session_authorized(session_id, &authority, |adapter| {
                adapter.completions(adapter_request)
            })??;
        Ok((result, retained))
    })
    .await?;

    // Revalidate the retained directory and trust after CDP work. The registry
    // independently fences session authority before and after the adapter call.
    let after_root = retained.live_path()?;
    if after_root.to_string_lossy() != root_key {
        return Err("Debug workspace identity changed during completion.".to_string());
    }
    ensure_trusted(&trust, &root_key)?;
    Ok(result)
}

fn ensure_trusted(trust: &Mutex<WorkspaceTrustService>, root_key: &str) -> Result<(), String> {
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(root_key)
        .trusted
    {
        return Err("Trust this workspace to request debug completions.".to_string());
    }
    Ok(())
}
