use crate::debug_adapter::{
    DebugBreakpoint, DebugExceptionPauseMode, DebugJustMyCodePolicy, DebugSessionRegistry,
    DebugStartResponse,
};
use crate::debug_commands::app_debug_event_sink;
use crate::debug_node_process::{
    start_native_node_watch_intent_for_retained_workspace, NativeNodeWatchIntentWorkspaceStartup,
};
use crate::debug_session_registry::retain_workspace_root;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeNodeWatchStartRequest {
    root_path: String,
    script_path: String,
    watch: bool,
    preserve_output: Option<bool>,
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    just_my_code: Option<DebugJustMyCodePolicy>,
    #[serde(
        default,
        deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
    )]
    source_maps: Option<bool>,
}

#[tauri::command]
pub(crate) async fn debug_start_native_node_watch(
    request: NativeNodeWatchStartRequest,
    app: AppHandle,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<DebugStartResponse, String> {
    let NativeNodeWatchStartRequest {
        root_path,
        script_path,
        watch,
        preserve_output,
        breakpoints,
        exception_pause_mode,
        exception_type_filter,
        just_my_code,
        source_maps,
    } = request;
    validate_native_watch_exception_filter(exception_type_filter)?;
    let preserve_output = validate_closed_intent(watch, preserve_output)?;
    let worker_app = app.clone();
    let worker_registry = Arc::clone(registry.inner());
    crate::run_blocking_command(move || {
        let workspace_registry = worker_app.state::<WorkspaceRegistry>();
        let trust = worker_app.state::<Mutex<WorkspaceTrustService>>();
        start_native_node_watch_intent_for_retained_workspace(
            NativeNodeWatchIntentWorkspaceStartup {
                root_path: &root_path,
                script_path,
                preserve_output,
                breakpoints: &breakpoints,
                exception_pause_mode,
                just_my_code,
                source_maps_enabled: source_maps.unwrap_or(true),
                sink: app_debug_event_sink(worker_app.clone()),
                registry: &worker_registry,
                workspace_registry: workspace_registry.inner(),
                trust: trust.inner(),
            },
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_confirm_native_node_watch(
    root_path: String,
    session_id: u64,
    app: AppHandle,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<(), String> {
    let worker_app = app.clone();
    let worker_registry = Arc::clone(registry.inner());
    crate::run_blocking_command(move || {
        let workspace_registry = worker_app.state::<WorkspaceRegistry>();
        let trust = worker_app.state::<Mutex<WorkspaceTrustService>>();
        confirm_native_node_watch_blocking(
            &root_path,
            session_id,
            workspace_registry.inner(),
            trust.inner(),
            &worker_registry,
        )
    })
    .await
}

fn confirm_native_node_watch_blocking(
    root_path: &str,
    session_id: u64,
    workspace_registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    registry: &DebugSessionRegistry,
) -> Result<(), String> {
    let retained = retain_workspace_root(workspace_registry, root_path)?;
    let root = retained.live_path()?;
    let root_key = root.to_string_lossy().into_owned();
    let trust = trust
        .lock()
        .map_err(|_| "Unable to inspect native Node watch workspace trust.".to_string())?;
    let snapshot = trust.snapshot(&root_key);
    if snapshot.root_path != root_key || !snapshot.trusted {
        return Err("Trust this workspace to confirm native Node watch debugging.".to_string());
    }
    registry.control_for_session(session_id, &root_key, |adapter| adapter.confirm_launch())??;
    Ok(())
}

fn validate_closed_intent(watch: bool, preserve_output: Option<bool>) -> Result<bool, String> {
    if !watch {
        return Err("Native Node watch must be enabled.".to_string());
    }
    match preserve_output {
        None => Ok(false),
        Some(true) => Ok(true),
        Some(false) => Err("Native Node watch preserveOutput must be omitted or true.".to_string()),
    }
}

fn validate_native_watch_exception_filter(
    exception_type_filter: Vec<String>,
) -> Result<(), String> {
    let filter =
        crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(exception_type_filter)?;
    if filter.is_empty() {
        return Ok(());
    }
    Err("Exception type filters are unavailable for native Node watch generations.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        confirm_native_node_watch_blocking, validate_closed_intent,
        validate_native_watch_exception_filter, NativeNodeWatchStartRequest,
    };
    use crate::debug_adapter::{
        DebugAdapter, DebugEvent, DebugEventSink, DebugScopeInfo, DebugStackFrame,
        DebugVariableInfo, StepKind,
    };
    use crate::trust::WorkspaceTrustService;
    use crate::workspace_registry::WorkspaceRegistry;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn closed_intent_accepts_only_enabled_watch_and_true_only_preserve_output() {
        assert_eq!(validate_closed_intent(true, None), Ok(false));
        assert_eq!(validate_closed_intent(true, Some(true)), Ok(true));
        assert!(validate_closed_intent(false, None).is_err());
        assert!(validate_closed_intent(true, Some(false)).is_err());
    }

    #[test]
    fn native_watch_rejects_exception_filters_until_generation_replay_supports_them() {
        assert_eq!(validate_native_watch_exception_filter(Vec::new()), Ok(()));
        assert!(validate_native_watch_exception_filter(vec!["DomainError".to_string()]).is_err());
        assert!(validate_native_watch_exception_filter(vec!["invalid-name".to_string()]).is_err());
    }

    #[test]
    fn native_watch_source_maps_wire_rejects_null_and_non_boolean_values() {
        let request = serde_json::json!({
            "rootPath": "/workspace",
            "scriptPath": "/workspace/server.js",
            "watch": true,
            "breakpoints": [],
            "exceptionPauseMode": "none",
            "exceptionTypeFilter": [],
            "sourceMaps": false
        });
        assert!(serde_json::from_value::<NativeNodeWatchStartRequest>(request.clone()).is_ok());
        for invalid in [serde_json::Value::Null, serde_json::json!("false")] {
            let mut request = request.clone();
            request["sourceMaps"] = invalid;
            assert!(serde_json::from_value::<NativeNodeWatchStartRequest>(request).is_err());
        }
    }

    #[test]
    fn debug_confirm_native_node_watch_is_single_use() {
        let fixture = ConfirmFixture::new();
        let session = fixture.start_session(&fixture.primary_root);

        assert_eq!(fixture.confirm(&fixture.primary_root, session.id), Ok(()));
        assert!(session.released.load(Ordering::SeqCst));
        assert!(fixture.confirm(&fixture.primary_root, session.id).is_err());
    }

    #[test]
    fn debug_confirm_native_node_watch_rejects_foreign_workspace_without_releasing_start_gate() {
        let fixture = ConfirmFixture::new();
        let session = fixture.start_session(&fixture.primary_root);

        assert!(fixture.confirm(&fixture.foreign_root, session.id).is_err());
        assert!(!session.released.load(Ordering::SeqCst));
        assert_eq!(fixture.confirm(&fixture.primary_root, session.id), Ok(()));
        assert!(session.released.load(Ordering::SeqCst));
    }

    #[test]
    fn debug_confirm_native_node_watch_rejects_stopped_session() {
        let fixture = ConfirmFixture::new();
        let session = fixture.start_session(&fixture.primary_root);

        assert!(fixture.registry.stop_by_id(session.id));
        assert!(fixture.confirm(&fixture.primary_root, session.id).is_err());
        assert!(!session.released.load(Ordering::SeqCst));
    }

    #[test]
    fn debug_confirm_native_node_watch_rejects_unknown_session() {
        let fixture = ConfirmFixture::new();

        assert!(fixture.confirm(&fixture.primary_root, u64::MAX).is_err());
    }

    struct ConfirmFixture {
        base: PathBuf,
        primary_root: PathBuf,
        foreign_root: PathBuf,
        workspace_registry: WorkspaceRegistry,
        trust: Mutex<WorkspaceTrustService>,
        registry: crate::debug_adapter::DebugSessionRegistry,
    }

    impl ConfirmFixture {
        fn new() -> Self {
            let fixture_id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
            let base = std::env::temp_dir().join(format!(
                "codevo-native-watch-confirm-{}-{fixture_id}",
                std::process::id()
            ));
            let primary_root = base.join("primary");
            let foreign_root = base.join("foreign");
            fs::create_dir_all(&primary_root).expect("create primary workspace");
            fs::create_dir_all(&foreign_root).expect("create foreign workspace");
            let primary_root = primary_root
                .canonicalize()
                .expect("canonicalize primary workspace");
            let foreign_root = foreign_root
                .canonicalize()
                .expect("canonicalize foreign workspace");
            let workspace_registry = WorkspaceRegistry::new();
            workspace_registry
                .register(&primary_root)
                .expect("register primary workspace");
            workspace_registry
                .register(&foreign_root)
                .expect("register foreign workspace");
            let mut trust =
                WorkspaceTrustService::load(base.join("trust.json")).expect("load workspace trust");
            trust
                .set(&primary_root.to_string_lossy(), true)
                .expect("trust primary workspace");
            trust
                .set(&foreign_root.to_string_lossy(), true)
                .expect("trust foreign workspace");
            let registry = crate::debug_adapter::DebugSessionRegistry::new();
            registry.activate_root(&primary_root.to_string_lossy());
            registry.activate_root(&foreign_root.to_string_lossy());
            Self {
                base,
                primary_root,
                foreign_root,
                workspace_registry,
                trust: Mutex::new(trust),
                registry,
            }
        }

        fn start_session(&self, root: &Path) -> ConfirmSession {
            let pending = Arc::new(AtomicBool::new(true));
            let released = Arc::new(AtomicBool::new(false));
            let adapter_pending = Arc::clone(&pending);
            let adapter_released = Arc::clone(&released);
            let id = self
                .registry
                .start_session(
                    &root.to_string_lossy(),
                    Arc::new(DiscardEvents),
                    move |_| {
                        Ok(Box::new(ConfirmAdapter {
                            pending: adapter_pending,
                            released: adapter_released,
                        }))
                    },
                )
                .expect("start pending watch session");
            ConfirmSession { id, released }
        }

        fn confirm(&self, root: &Path, session_id: u64) -> Result<(), String> {
            confirm_native_node_watch_blocking(
                &root.to_string_lossy(),
                session_id,
                &self.workspace_registry,
                &self.trust,
                &self.registry,
            )
        }
    }

    impl Drop for ConfirmFixture {
        fn drop(&mut self) {
            self.registry.stop_all();
            self.workspace_registry.clear();
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    struct ConfirmSession {
        id: u64,
        released: Arc<AtomicBool>,
    }

    struct ConfirmAdapter {
        pending: Arc<AtomicBool>,
        released: Arc<AtomicBool>,
    }

    impl DebugAdapter for ConfirmAdapter {
        fn confirm_launch(&mut self) -> Result<(), String> {
            if self
                .pending
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return Err("native Node watch start confirmation is stale".to_string());
            }
            self.released.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn set_breakpoints(
            &mut self,
            _file_path: &str,
            _breakpoints: &[crate::debug_adapter::DebugBreakpoint],
        ) -> Result<Vec<crate::debug_adapter::DebugBreakpoint>, String> {
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

        fn evaluate(
            &mut self,
            _frame_id: u64,
            _expression: &str,
        ) -> Result<DebugVariableInfo, String> {
            Err("evaluation is unavailable in the confirm harness".to_string())
        }

        fn terminate(&mut self) {}
    }

    struct DiscardEvents;

    impl DebugEventSink for DiscardEvents {
        fn emit(&self, _event: DebugEvent) {}
    }
}
