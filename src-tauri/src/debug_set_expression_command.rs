use super::retain_workspace_root;
use super::set_expression_wire::DebugSetExpressionRequest;
use crate::debug_adapter::{DebugSessionRegistry, DebugSetExpressionResult};
use crate::debug_session_registry::DebugWorkspaceAuthority;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub(crate) async fn debug_set_expression(
    request: DebugSetExpressionRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugSetExpressionResult, String> {
    request.validate()?;
    let retained = retain_workspace_root(&workspace_registry, &request.root_path)?;
    let root = retained.live_path()?;
    let root_key = root.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before expression assignment.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before expression assignment.".to_string());
    }
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_key)
        .trusted
    {
        return Err("Trust this workspace to change debug expressions.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let authority = retained.authority.clone();
    let session_id = request.session_id;
    let expected_reference = request.set_expression_reference;
    let expected_expression = request.expression.clone();
    let adapter_request = request.adapter_request();
    crate::run_blocking_command(move || {
        let _retained = retained;
        let result =
            registry.mutate_for_session_authorized(session_id, &authority, |adapter| {
                adapter.set_expression(adapter_request)
            })??;
        if result.set_expression_reference != expected_reference
            || result.expression != expected_expression
            || result.value.name != expected_expression
            || result.value.can_set_value.is_some()
            || result.value.set_expression_reference.is_some()
        {
            return Err(
                "The debug adapter returned a result for another expression assignment."
                    .to_string(),
            );
        }
        Ok(result)
    })
    .await
}
