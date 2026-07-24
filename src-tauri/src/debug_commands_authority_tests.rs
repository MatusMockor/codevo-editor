use super::*;
use crate::debug_adapter::DebugEventSink;
use crate::debug_session_registry::retained_workspace_authority;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
struct TestSink;

impl DebugEventSink for TestSink {
    fn emit(&self, _event: DebugEvent) {}
}

struct ExceptionPauseAdapter {
    updated: Arc<AtomicBool>,
}

impl DebugAdapter for ExceptionPauseAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        _breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        Ok(Vec::new())
    }

    fn step(&mut self, _kind: StepKind) -> Result<(), String> {
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        Ok(Vec::new())
    }

    fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        Ok(Vec::new())
    }

    fn evaluate(&mut self, _frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: String::new(),
            value_type: None,
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn set_exception_pause_filter(
        &mut self,
        _mode: DebugExceptionPauseMode,
        _filter: &[String],
    ) -> Result<(), String> {
        self.updated.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn terminate(&mut self) {}
}

#[test]
fn set_exception_pause_request_has_a_closed_root_owned_wire_contract() {
    let valid = serde_json::json!({
        "rootPath": "/workspace",
        "sessionId": 7,
        "mode": "all",
        "exceptionTypeFilter": ["TypeError"]
    });
    assert!(serde_json::from_value::<DebugSetExceptionPauseRequest>(valid.clone()).is_ok());
    for missing in ["rootPath", "sessionId", "mode", "exceptionTypeFilter"] {
        let mut request = valid.clone();
        request.as_object_mut().unwrap().remove(missing);
        assert!(
            serde_json::from_value::<DebugSetExceptionPauseRequest>(request).is_err(),
            "missing field {missing} must be rejected"
        );
    }
    let mut unknown = valid;
    unknown["unexpected"] = serde_json::json!(true);
    assert!(serde_json::from_value::<DebugSetExceptionPauseRequest>(unknown).is_err());
}

#[test]
fn set_exception_pause_requires_exact_root_session_ownership() {
    let registry = DebugSessionRegistry::new();
    let updated = Arc::new(AtomicBool::new(false));
    let adapter_updated = Arc::clone(&updated);
    let session_id = registry
        .start_session("/workspace/one", Arc::new(TestSink), move |_emitter| {
            Ok(Box::new(ExceptionPauseAdapter {
                updated: adapter_updated,
            }))
        })
        .expect("start session");
    let request = DebugSetExceptionPauseRequest {
        root_path: "/workspace/one".to_string(),
        session_id,
        mode: DebugExceptionPauseMode::All,
        exception_type_filter: vec!["TypeError".to_string()],
    };
    let foreign_session = DebugSetExceptionPauseRequest {
        session_id: session_id + 1,
        ..DebugSetExceptionPauseRequest {
            root_path: request.root_path.clone(),
            session_id: request.session_id,
            mode: request.mode,
            exception_type_filter: request.exception_type_filter.clone(),
        }
    };

    assert_eq!(
        set_exception_pause_for_session(&registry, "/workspace/one", &foreign_session),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    assert!(!updated.load(Ordering::SeqCst));
    assert_eq!(
        set_exception_pause_for_session(&registry, "/workspace/two", &request),
        Err("The debug session no longer belongs to this workspace.".to_string())
    );
    assert!(!updated.load(Ordering::SeqCst));
    assert_eq!(
        set_exception_pause_for_session(&registry, "/workspace/one", &request),
        Ok(())
    );
    assert!(updated.load(Ordering::SeqCst));
}

#[test]
fn disconnect_rejects_hostile_roots_before_workspace_authority_lookup() {
    let registry = WorkspaceRegistry::new();
    for (root_path, expected) in [
        (
            "x".repeat(MAX_DEBUG_EVALUATE_ROOT_BYTES + 1),
            "must contain",
        ),
        ("/workspace\nother".to_string(), "forbidden control"),
    ] {
        let error = validated_disconnect_authority(
            &registry,
            &DebugDisconnectRequest {
                root_path,
                session_id: 7,
            },
        )
        .expect_err("invalid root must fail before registry lookup");
        assert!(
            error.contains(expected),
            "unexpected validation error: {error}"
        );
        assert!(!error.contains("not registered"));
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn retained_disconnect_authority_survives_path_loss_but_rejects_alias_reownership() {
    use std::os::unix::fs::symlink;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-debug-authority-{}-{nonce}",
        std::process::id()
    ));
    let original = fixture.join("original");
    let renamed = fixture.join("renamed");
    let replacement = fixture.join("replacement");
    let alias = fixture.join("workspace");
    std::fs::create_dir_all(&original).expect("create original workspace");
    std::fs::create_dir_all(&replacement).expect("create replacement workspace");
    symlink(&original, &alias).expect("create workspace alias");
    let registry = WorkspaceRegistry::new();
    registry
        .register(&alias)
        .expect("register original workspace");
    let original_authority =
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("original retained authority");

    std::fs::remove_file(&alias).expect("remove workspace alias");
    std::fs::rename(&original, &renamed).expect("rename original workspace");
    assert_eq!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("authority after root loss"),
        original_authority
    );

    symlink(&replacement, &alias).expect("retarget workspace alias");
    assert_eq!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("retained authority after retarget"),
        original_authority
    );
    registry
        .register(&alias)
        .expect("register replacement workspace identity");
    assert_ne!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("replacement authority"),
        original_authority
    );

    registry.clear();
    std::fs::remove_file(alias).expect("remove retargeted alias");
    std::fs::remove_dir_all(fixture).expect("remove authority fixture");
}
