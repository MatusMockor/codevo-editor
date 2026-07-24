use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetBreakpointsActiveRequest {
    root_path: String,
    session_id: u64,
    active: bool,
}

impl DebugSetBreakpointsActiveRequest {
    fn validate(&self) -> Result<(), String> {
        validate_evaluate_text(
            &self.root_path,
            MAX_DEBUG_EVALUATE_ROOT_BYTES,
            false,
            "Debug workspace root",
        )
        .map_err(|failure| failure.message)?;
        if self.root_path.chars().any(is_unsafe_debug_path_character) {
            return Err("Debug workspace root contains an unsafe character.".to_string());
        }
        if self.session_id == 0 || self.session_id > MAX_JAVASCRIPT_SAFE_INTEGER {
            return Err("Debug session id must be a positive JavaScript-safe integer.".to_string());
        }
        Ok(())
    }
}

fn retain_activation_workspace(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<RetainedDebugWorkspaceRoot, String> {
    let retained = retain_workspace_root(registry, root_path)?;
    let root_key = retained.live_path()?.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before breakpoint activation.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before breakpoint activation.".to_string());
    }
    Ok(retained)
}

#[tauri::command]
pub(crate) async fn debug_set_breakpoints_active(
    request: DebugSetBreakpointsActiveRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<(), String> {
    request.validate()?;
    let retained = retain_activation_workspace(&workspace_registry, &request.root_path)?;
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before breakpoint activation.".to_string());
    };
    let root_key = canonical_root.clone();
    let registry = Arc::clone(registry.inner());
    let authority = retained.authority.clone();
    let session_id = request.session_id;
    let active = request.active;
    super::super::run_blocking_command(move || {
        let _retained = retained;
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(&root_key).trusted {
            return Err("Trust this workspace to control the debugger.".to_string());
        }
        // Retain workspace identity and trust through the exact authorized
        // session mutation and its CDP acknowledgement.
        registry.mutate_for_session_authorized(session_id, &authority, |adapter| {
            adapter.set_breakpoints_active(active)
        })?
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn request_has_a_closed_bounded_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "active": false
        });
        let request =
            serde_json::from_value::<DebugSetBreakpointsActiveRequest>(valid.clone()).unwrap();
        assert!(request.validate().is_ok());

        for missing in ["rootPath", "sessionId", "active"] {
            let mut candidate = valid.clone();
            candidate.as_object_mut().unwrap().remove(missing);
            assert!(
                serde_json::from_value::<DebugSetBreakpointsActiveRequest>(candidate).is_err(),
                "missing field {missing} must be rejected"
            );
        }
        let mut unknown = valid.clone();
        unknown["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugSetBreakpointsActiveRequest>(unknown).is_err());

        for (root_path, session_id) in [
            ("", 7),
            ("/workspace\nother", 7),
            ("/workspace", 0),
            ("/workspace", MAX_JAVASCRIPT_SAFE_INTEGER + 1),
        ] {
            assert!(DebugSetBreakpointsActiveRequest {
                root_path: root_path.to_string(),
                session_id,
                active: true,
            }
            .validate()
            .is_err());
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn activation_authority_rejects_unregister_and_same_path_replacement() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "codevo-breakpoint-activation-authority-{}-{nonce}",
            std::process::id()
        ));
        let workspace = fixture.join("workspace");
        let moved = fixture.join("moved-original");
        fs::create_dir_all(&workspace).expect("create original workspace");

        let registry = WorkspaceRegistry::new();
        let original = registry.register(&workspace).expect("register original");
        let original_authority =
            retain_activation_workspace(&registry, workspace.to_str().expect("UTF-8 path"))
                .expect("retain original")
                .authority;

        fs::rename(&workspace, &moved).expect("move original workspace");
        fs::create_dir_all(&workspace).expect("replace workspace at the same path");
        let replacement_error =
            retain_activation_workspace(&registry, workspace.to_str().expect("UTF-8 path"))
                .expect_err("same-path replacement must not inherit debug authority");
        assert!(replacement_error.contains("identity changed"));

        registry
            .unregister(&original.workspace_id)
            .expect("unregister original");
        assert!(
            retain_activation_workspace(&registry, workspace.to_str().expect("UTF-8 path"))
                .is_err(),
            "an unregistered root must not control a retained debug session"
        );

        registry
            .register(&workspace)
            .expect("register replacement identity");
        let replacement_authority =
            retain_activation_workspace(&registry, workspace.to_str().expect("UTF-8 path"))
                .expect("retain replacement")
                .authority;
        assert_ne!(
            replacement_authority, original_authority,
            "re-registering the same path must issue a distinct workspace authority"
        );

        registry.clear();
        fs::remove_dir_all(fixture).expect("remove authority fixture");
    }
}
