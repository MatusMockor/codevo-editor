use super::set_variable_wire::DebugSetVariableRequest;
use super::{bound_variable_page, retain_workspace_root};
use crate::debug_adapter::{
    DebugSessionRegistry, DebugSetVariableResult, DebugVariablePage, DebugVariablePageRequest,
};
use crate::debug_session_registry::DebugWorkspaceAuthority;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub(crate) async fn debug_set_variable(
    request: DebugSetVariableRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugSetVariableResult, String> {
    request.validate()?;
    let retained = retain_workspace_root(&workspace_registry, &request.root_path)?;
    let root = retained.live_path()?;
    let root_key = root.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before variable assignment.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before variable assignment.".to_string());
    }
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_key)
        .trusted
    {
        return Err("Trust this workspace to change debug variables.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let authority = retained.authority.clone();
    let session_id = request.session_id;
    let expected_name = request.name.clone();
    let adapter_request = request.adapter_request();
    crate::run_blocking_command(move || {
        let _retained = retained;
        let result =
            registry.mutate_for_session_authorized(session_id, &authority, |adapter| {
                adapter.set_variable(adapter_request)
            })??;
        bound_result(result, &expected_name)
    })
    .await
}

fn bound_result(
    result: DebugSetVariableResult,
    expected_name: &str,
) -> Result<DebugSetVariableResult, String> {
    let page = bound_variable_page(
        DebugVariablePage {
            variables: vec![result.value],
            start: 0,
            returned: 1,
            total: Some(1),
            next_start: None,
            truncated: false,
        },
        DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 1,
            variables_reference: 1,
            start: 0,
            count: 1,
        },
    )?;
    let value = page
        .variables
        .into_iter()
        .next()
        .ok_or_else(|| "The debug adapter returned no assigned variable.".to_string())?;
    if value.name != expected_name {
        return Err("The debug adapter returned a variable for another assignment.".to_string());
    }
    Ok(DebugSetVariableResult { value })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::DebugVariableInfo;

    fn result(name: &str) -> DebugSetVariableResult {
        DebugSetVariableResult {
            value: DebugVariableInfo {
                name: name.to_string(),
                value: "42".to_string(),
                value_type: Some("number".to_string()),
                evaluate_name: Some(name.to_string()),
                variables_reference: 0,
                can_set_value: Some(true),
                set_expression_reference: None,
            },
        }
    }

    #[test]
    fn set_variable_result_is_bound_to_the_exact_requested_name() {
        assert_eq!(
            bound_result(result("count"), "count")
                .expect("matching result")
                .value
                .name,
            "count"
        );
        let error = bound_result(result("other"), "count")
            .expect_err("mismatched adapter result must fail closed");
        assert!(error.contains("another assignment"));
    }
}
