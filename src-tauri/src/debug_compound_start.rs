use super::{create_debug_adapter_with_exception_filter, AppHandleDebugEventSink, DebugFinishGate};
use crate::debug_adapter::{
    DebugBreakpoint, DebugEventSink, DebugExceptionPauseMode, DebugLaunchTarget,
    DebugSessionRegistry, DebugStartupPermit,
};
use crate::debug_breakpoint_policy::{
    breakpoints_by_file, validate_initial_breakpoints, DebugBreakpointAdapterKind,
};
use crate::debug_session_registry::{
    retain_workspace_root, DebugSessionMode, DebugStartupGroup, DebugWorkspaceAuthority,
    RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, State};

const MIN_DEBUG_COMPOUND_MEMBERS: usize = 2;
const MAX_DEBUG_COMPOUND_MEMBERS: usize = 4;
const MAX_DEBUG_COMPOUND_REQUEST_BYTES: usize = 1024 * 1024;
const COMPOUND_START_ERROR: &str = "Compound debug configuration could not be started safely.";
const COMPOUND_START_UNTRUSTED: &str = "Trust this workspace to run the debugger.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugCompoundStartRequest {
    root_path: String,
    members: Vec<DebugCompoundStartMember>,
    stop_all: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DebugCompoundStartMember {
    launch: DebugCompoundLaunchTarget,
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum DebugCompoundLaunchTarget {
    #[serde(rename = "node-script", rename_all = "camelCase")]
    Script {
        script_path: String,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        source_maps: Option<bool>,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        stop_on_entry: Option<bool>,
    },
    #[serde(rename = "node-configured-script", rename_all = "camelCase")]
    ConfiguredScript {
        script_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        #[serde(default)]
        just_my_code: Option<crate::debug_adapter::DebugJustMyCodePolicy>,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        source_maps: Option<bool>,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        stop_on_entry: Option<bool>,
    },
    #[serde(rename = "node-npm-script", rename_all = "camelCase")]
    NpmScript {
        script: String,
        package_root_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        #[serde(default)]
        just_my_code: Option<crate::debug_adapter::DebugJustMyCodePolicy>,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        source_maps: Option<bool>,
        #[serde(
            default,
            deserialize_with = "crate::debug_node_env_file::deserialize_optional_bool"
        )]
        stop_on_entry: Option<bool>,
    },
}

impl DebugCompoundLaunchTarget {
    fn into_launch(self) -> (DebugLaunchTarget, bool, bool) {
        match self {
            Self::Script {
                script_path,
                source_maps,
                stop_on_entry,
            } => (
                DebugLaunchTarget::NodeScript { script_path },
                source_maps.unwrap_or(true),
                stop_on_entry.unwrap_or(false),
            ),
            Self::ConfiguredScript {
                script_path,
                args,
                cwd,
                env,
                just_my_code,
                source_maps,
                stop_on_entry,
            } => (
                DebugLaunchTarget::NodeConfiguredScript {
                    script_path,
                    args,
                    cwd,
                    env,
                    just_my_code,
                },
                source_maps.unwrap_or(true),
                stop_on_entry.unwrap_or(false),
            ),
            Self::NpmScript {
                script,
                package_root_path,
                args,
                cwd,
                env,
                just_my_code,
                source_maps,
                stop_on_entry,
            } => (
                DebugLaunchTarget::NodeNpmScript {
                    script,
                    package_root_path,
                    args,
                    cwd,
                    env,
                    just_my_code,
                },
                source_maps.unwrap_or(true),
                stop_on_entry.unwrap_or(false),
            ),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum DebugCompoundStartResponse {
    #[serde(rename_all = "camelCase")]
    Ok {
        session_ids: Vec<u64>,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub(crate) async fn debug_start_compound(
    request: DebugCompoundStartRequest,
    app: AppHandle,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugCompoundStartResponse, String> {
    if !valid_request_shape(&request) {
        return Ok(compound_start_error());
    }

    let retained_root = match retain_workspace_root(&workspace_registry, &request.root_path) {
        Ok(retained) => Arc::new(retained),
        Err(_) => return Ok(compound_start_error()),
    };
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } =
        &retained_root.authority
    else {
        return Ok(compound_start_error());
    };
    let root_key = canonical_root.clone();
    match workspace_is_trusted(&trust, &root_key) {
        Ok(true) => {}
        Ok(false) => return Ok(compound_untrusted()),
        Err(()) => return Ok(compound_start_error()),
    }

    let registry = Arc::clone(registry.inner());
    let group = match registry
        .begin_start_group_with_authority(&root_key, retained_root.authority.clone())
    {
        Ok(group) => group,
        Err(_) => return Ok(compound_start_error()),
    };
    let context = CompoundStartContext {
        registry: &registry,
        group: &group,
        retained_root: &retained_root,
        root_key: &root_key,
        trust: &trust,
    };
    let sink: Arc<dyn DebugEventSink> = Arc::new(AppHandleDebugEventSink { app });
    let member_count = request.members.len();
    let mut session_ids = Vec::with_capacity(member_count);

    for member in request.members {
        let session_id = match start_member(&context, member, Arc::clone(&sink)).await {
            Ok(session_id) => session_id,
            Err(response) => {
                registry.abort_start_group(&group);
                return Ok(response);
            }
        };
        session_ids.push(session_id);
    }

    if let Err(response) = validate_compound_start_commit(
        DebugCompoundCommitContext {
            group: &group,
            registry: &registry,
            retained_root: &retained_root,
            root_key: &root_key,
            trust: &trust,
            workspace_registry: &workspace_registry,
        },
        &session_ids,
        member_count,
    ) {
        return Ok(response);
    }
    Ok(DebugCompoundStartResponse::Ok { session_ids })
}

fn valid_request_shape(request: &DebugCompoundStartRequest) -> bool {
    request.stop_all
        && (MIN_DEBUG_COMPOUND_MEMBERS..=MAX_DEBUG_COMPOUND_MEMBERS)
            .contains(&request.members.len())
        && request.members.iter().all(|member| {
            crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(
                member.exception_type_filter.clone(),
            )
            .is_ok()
        })
        && serde_json::to_vec(request)
            .is_ok_and(|encoded| encoded.len() <= MAX_DEBUG_COMPOUND_REQUEST_BYTES)
}

struct CompoundStartContext<'a> {
    registry: &'a Arc<DebugSessionRegistry>,
    group: &'a DebugStartupGroup,
    retained_root: &'a Arc<RetainedDebugWorkspaceRoot>,
    root_key: &'a str,
    trust: &'a Mutex<WorkspaceTrustService>,
}

async fn start_member(
    context: &CompoundStartContext<'_>,
    member: DebugCompoundStartMember,
    sink: Arc<dyn DebugEventSink>,
) -> Result<u64, DebugCompoundStartResponse> {
    let trusted = workspace_is_trusted(context.trust, context.root_key);
    if trusted != Ok(true) || !context.registry.startup_group_is_current(context.group) {
        return Err(match trusted {
            Ok(false) => compound_untrusted(),
            Ok(true) | Err(()) => compound_start_error(),
        });
    }
    let root = context
        .retained_root
        .live_path()
        .map_err(|_| compound_start_error())?;
    let breakpoints =
        validate_initial_breakpoints(&root, DebugBreakpointAdapterKind::Node, &member.breakpoints)
            .map_err(|_| compound_start_error())?;
    let permit = context
        .registry
        .begin_start_in_group(context.group)
        .map_err(|_| compound_start_error())?;
    let member_root = Arc::clone(context.retained_root);
    let member_registry = Arc::clone(context.registry);
    let member_group = context.group.clone();
    let (launch, source_maps_enabled, stop_on_entry) = member.launch.into_launch();
    let result = crate::run_blocking_command(move || {
        Ok(start_compound_member_blocking(
            member_root,
            permit,
            member_group,
            launch,
            breakpoints,
            member.exception_pause_mode,
            member.exception_type_filter,
            source_maps_enabled,
            stop_on_entry,
            sink,
            member_registry,
        ))
    })
    .await
    .map_err(|_| compound_start_error())?;
    let session_id = result.map_err(|()| compound_start_error())?;
    context
        .registry
        .owns_session_in_group(context.group, session_id)
        .then_some(session_id)
        .ok_or_else(compound_start_error)
}

struct DebugCompoundCommitContext<'a> {
    group: &'a DebugStartupGroup,
    registry: &'a DebugSessionRegistry,
    retained_root: &'a RetainedDebugWorkspaceRoot,
    root_key: &'a str,
    trust: &'a Mutex<WorkspaceTrustService>,
    workspace_registry: &'a WorkspaceRegistry,
}

fn validate_compound_start_commit(
    context: DebugCompoundCommitContext<'_>,
    session_ids: &[u64],
    member_count: usize,
) -> Result<(), DebugCompoundStartResponse> {
    let DebugCompoundCommitContext {
        group,
        registry,
        retained_root,
        root_key,
        trust,
        workspace_registry,
    } = context;
    // Linearize the final identity check with unregister/re-register. A retained
    // directory descriptor deliberately survives unregister, so `live_path`
    // alone cannot prove that the same workspace identity still owns this root.
    let workspace_operation = match workspace_registry.lock_operations() {
        Ok(operation) => operation,
        Err(_) => {
            registry.abort_start_group(group);
            return Err(compound_start_error());
        }
    };
    let exact_workspace = match &retained_root.authority {
        DebugWorkspaceAuthority::RetainedWorkspace {
            workspace_id,
            canonical_root,
        } if canonical_root == root_key => workspace_registry
            .descriptor_for_registered_path(Path::new(root_key))
            .is_ok_and(|descriptor| {
                descriptor.workspace_id.as_str() == workspace_id
                    && descriptor.canonical_root_path.to_string_lossy() == canonical_root.as_str()
            }),
        DebugWorkspaceAuthority::RetainedWorkspace { .. }
        | DebugWorkspaceAuthority::CanonicalRoot(_) => false,
    };
    let exact_group = registry.startup_group_is_current(group)
        && session_ids.len() == member_count
        && session_ids
            .iter()
            .all(|session_id| registry.owns_session_in_group(group, *session_id));
    if !exact_workspace || retained_root.live_path().is_err() || !exact_group {
        drop(workspace_operation);
        registry.abort_start_group(group);
        return Err(compound_start_error());
    }

    let trusted = workspace_is_trusted(trust, root_key);
    if trusted == Ok(true) {
        return Ok(());
    }
    drop(workspace_operation);
    reject_compound_commit_trust(trusted, registry, group)
}

fn reject_compound_commit_trust(
    trusted: Result<bool, ()>,
    registry: &DebugSessionRegistry,
    group: &DebugStartupGroup,
) -> Result<(), DebugCompoundStartResponse> {
    match trusted {
        Ok(true) => Ok(()),
        Ok(false) => {
            registry.abort_start_group(group);
            Err(compound_untrusted())
        }
        Err(()) => {
            registry.abort_start_group(group);
            Err(compound_start_error())
        }
    }
}

fn workspace_is_trusted(trust: &Mutex<WorkspaceTrustService>, root_key: &str) -> Result<bool, ()> {
    Ok(trust.lock().map_err(|_| ())?.get(root_key).trusted)
}

fn compound_untrusted() -> DebugCompoundStartResponse {
    DebugCompoundStartResponse::Unavailable {
        message: COMPOUND_START_UNTRUSTED.to_string(),
    }
}

fn compound_start_error() -> DebugCompoundStartResponse {
    DebugCompoundStartResponse::Error {
        message: COMPOUND_START_ERROR.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn start_compound_member_blocking(
    retained_root: Arc<RetainedDebugWorkspaceRoot>,
    permit: DebugStartupPermit,
    group: DebugStartupGroup,
    launch: DebugLaunchTarget,
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    source_maps_enabled: bool,
    stop_on_entry: bool,
    sink: Arc<dyn DebugEventSink>,
    registry: Arc<DebugSessionRegistry>,
) -> Result<u64, ()> {
    let finish_gate = Arc::new(DebugFinishGate::default());
    let finish_registry = Arc::clone(&registry);
    let finish_group = group.clone();
    let finish_wait = Arc::clone(&finish_gate);
    let startup_registry = Arc::clone(&registry);
    let startup_permit = permit.clone();
    let started = registry.start_session_with_permit_breakpoints_and_mode(
        permit,
        sink,
        DebugBreakpointAdapterKind::Node,
        breakpoints_by_file(&breakpoints),
        DebugSessionMode::OwnedLaunch,
        move |emitter| {
            let adapter_root = retained_root.live_path()?;
            let session_id = emitter.session_id();
            let finish = Box::new(move |exit_code| {
                if finish_wait.wait_until_registered() {
                    finish_registry.finish_group_session(&finish_group, session_id, exit_code);
                }
            });
            let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> =
                Arc::new(move || startup_registry.startup_is_current(&startup_permit));
            create_debug_adapter_with_exception_filter(
                &adapter_root,
                &launch,
                &breakpoints,
                exception_pause_mode,
                &exception_type_filter,
                source_maps_enabled,
                stop_on_entry,
                emitter,
                finish,
                startup_is_current,
            )
        },
    );
    match started {
        Ok(session_id) => {
            finish_gate.complete(true);
            registry
                .owns_session_in_group(&group, session_id)
                .then_some(session_id)
                .ok_or(())
        }
        Err(_) => {
            finish_gate.complete(false);
            Err(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{
        DebugAdapter, DebugEvent, DebugScopeInfo, DebugStackFrame, DebugVariableInfo, StepKind,
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Default)]
    struct CompoundCommitTestSink;

    impl DebugEventSink for CompoundCommitTestSink {
        fn emit(&self, _event: DebugEvent) {}
    }

    struct CompoundCommitTestAdapter {
        terminated: Arc<AtomicBool>,
    }

    impl DebugAdapter for CompoundCommitTestAdapter {
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

        fn evaluate(
            &mut self,
            _frame_id: u64,
            _expression: &str,
        ) -> Result<DebugVariableInfo, String> {
            Err("unused".to_string())
        }

        fn terminate(&mut self) {
            self.terminated.store(true, Ordering::SeqCst);
        }
    }

    fn start_compound_commit_test_member(
        registry: &DebugSessionRegistry,
        group: &DebugStartupGroup,
        sink: Arc<CompoundCommitTestSink>,
    ) -> (u64, Arc<AtomicBool>) {
        let permit = registry
            .begin_start_in_group(group)
            .expect("member startup permit");
        let terminated = Arc::new(AtomicBool::new(false));
        let adapter_terminated = Arc::clone(&terminated);
        let session_id = registry
            .start_session_with_permit(permit, sink, move |_emitter| {
                Ok(Box::new(CompoundCommitTestAdapter {
                    terminated: adapter_terminated,
                }))
            })
            .expect("start compound member");
        (session_id, terminated)
    }

    #[test]
    fn compound_wire_is_exact_and_cannot_carry_attach_or_task_metadata() {
        let member = serde_json::json!({
            "launch": {
                "kind": "node-configured-script",
                "scriptPath": "/workspace/a.js",
                "args": [],
                "env": {}
            },
            "breakpoints": [],
            "exceptionPauseMode": "none",
            "exceptionTypeFilter": ["DomainError"]
        });
        let request = serde_json::json!({
            "rootPath": "/workspace",
            "members": [member.clone(), member],
            "stopAll": true
        });
        let decoded: DebugCompoundStartRequest =
            serde_json::from_value(request.clone()).expect("exact compound request");
        assert_eq!(decoded.members.len(), 2);
        assert!(decoded.stop_all);

        for malformed in [
            serde_json::json!({
                "rootPath": "/workspace",
                "members": request["members"].clone(),
                "stopAll": true,
                "preLaunchTask": "private"
            }),
            serde_json::json!({
                "rootPath": "/workspace",
                "members": [{
                    "launch": {"kind": "node-attach", "port": 9229},
                    "breakpoints": [],
                    "exceptionPauseMode": "none",
                    "exceptionTypeFilter": []
                }, request["members"][0].clone()],
                "stopAll": true
            }),
            serde_json::json!({
                "rootPath": "/workspace",
                "members": [{
                    "launch": {
                        "kind": "node-script",
                        "scriptPath": "/workspace/a.js",
                        "preLaunchTask": "private"
                    },
                    "breakpoints": [],
                    "exceptionPauseMode": "none",
                    "exceptionTypeFilter": []
                }, request["members"][0].clone()],
                "stopAll": true
            }),
            serde_json::json!({
                "rootPath": "/workspace",
                "members": [{
                    "launch": {
                        "kind": "node-script",
                        "scriptPath": "/workspace/a.js"
                    },
                    "breakpoints": [],
                    "exceptionPauseMode": "none"
                }, request["members"][0].clone()],
                "stopAll": true
            }),
        ] {
            assert!(serde_json::from_value::<DebugCompoundStartRequest>(malformed).is_err());
        }
    }

    #[test]
    fn compound_source_maps_defaults_enabled_preserves_false_and_is_typed() {
        for (source_maps, expected) in [
            (serde_json::Value::Null, true),
            (serde_json::json!(true), true),
            (serde_json::json!(false), false),
        ] {
            let mut launch = serde_json::json!({
                "kind": "node-script",
                "scriptPath": "/workspace/a.js"
            });
            if !source_maps.is_null() {
                launch["sourceMaps"] = source_maps;
            }
            let decoded: DebugCompoundLaunchTarget =
                serde_json::from_value(launch).expect("compound launch");
            let (_, source_maps_enabled, _) = decoded.into_launch();
            assert_eq!(source_maps_enabled, expected);
        }

        assert!(
            serde_json::from_value::<DebugCompoundLaunchTarget>(serde_json::json!({
                "kind": "node-npm-script",
                "script": "dev",
                "packageRootPath": "/workspace",
                "args": [],
                "env": {},
                "sourceMaps": "false"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DebugCompoundLaunchTarget>(serde_json::json!({
                "kind": "node-script",
                "scriptPath": "/workspace/a.js",
                "sourceMaps": null
            }))
            .is_err()
        );
    }

    #[test]
    fn compound_stop_on_entry_defaults_disabled_preserves_boolean_and_is_typed() {
        for (stop_on_entry, expected) in [
            (None, false),
            (Some(serde_json::json!(false)), false),
            (Some(serde_json::json!(true)), true),
        ] {
            let mut launch = serde_json::json!({
                "kind": "node-script",
                "scriptPath": "/workspace/a.js"
            });
            if let Some(value) = stop_on_entry {
                launch["stopOnEntry"] = value;
            }
            let decoded: DebugCompoundLaunchTarget =
                serde_json::from_value(launch).expect("compound launch");
            let (_, _, decoded) = decoded.into_launch();
            assert_eq!(decoded, expected);
        }

        for invalid in [serde_json::Value::Null, serde_json::json!("true")] {
            assert!(
                serde_json::from_value::<DebugCompoundLaunchTarget>(serde_json::json!({
                    "kind": "node-script",
                    "scriptPath": "/workspace/a.js",
                    "stopOnEntry": invalid
                }))
                .is_err()
            );
        }
    }

    #[test]
    fn compound_response_exposes_only_generic_status_or_exact_ids() {
        assert_eq!(
            serde_json::to_value(DebugCompoundStartResponse::Ok {
                session_ids: vec![3, 4]
            })
            .unwrap(),
            serde_json::json!({"status": "ok", "sessionIds": [3, 4]})
        );
        let wire = serde_json::to_string(&compound_start_error()).unwrap();
        assert_eq!(
            wire,
            r#"{"status":"error","message":"Compound debug configuration could not be started safely."}"#
        );
        for private in ["args", "env", "/workspace", "npm", "node"] {
            assert!(!wire.contains(private));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn final_compound_commit_rejects_trust_revoked_after_last_member_preflight() {
        use std::fs;
        use std::sync::Barrier;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "codevo-compound-final-trust-{}-{nonce}",
            std::process::id()
        ));
        let workspace_path = fixture.join("workspace");
        fs::create_dir_all(&workspace_path).expect("create workspace");

        let workspace_registry = WorkspaceRegistry::new();
        workspace_registry
            .register(&workspace_path)
            .expect("register workspace");
        let retained_root = Arc::new(
            retain_workspace_root(
                &workspace_registry,
                workspace_path.to_str().expect("UTF-8 workspace"),
            )
            .expect("retain workspace"),
        );
        let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } =
            &retained_root.authority
        else {
            panic!("production authority must be retained");
        };
        let root_key = canonical_root.clone();

        let mut trust_service =
            WorkspaceTrustService::load(fixture.join("trust.json")).expect("load trust");
        trust_service.set(&root_key, true).expect("trust workspace");
        let trust = Arc::new(Mutex::new(trust_service));
        assert_eq!(workspace_is_trusted(&trust, &root_key), Ok(true));

        let registry = Arc::new(DebugSessionRegistry::new());
        let group = registry
            .begin_start_group_with_authority(&root_key, retained_root.authority.clone())
            .expect("begin exact compound group");

        let barrier = Arc::new(Barrier::new(2));
        let revoke_barrier = Arc::clone(&barrier);
        let revoke_trust = Arc::clone(&trust);
        let revoke_root = root_key.clone();
        let revoke = std::thread::spawn(move || {
            revoke_barrier.wait();
            revoke_trust
                .lock()
                .expect("lock trust")
                .set(&revoke_root, false)
                .expect("revoke trust");
        });
        barrier.wait();
        revoke.join().expect("revoke worker");

        assert_eq!(
            reject_compound_commit_trust(
                workspace_is_trusted(&trust, &root_key),
                &registry,
                &group,
            ),
            Err(compound_untrusted())
        );
        assert!(!registry.startup_group_is_current(&group));

        drop(retained_root);
        workspace_registry.clear();
        fs::remove_dir_all(fixture).expect("remove fixture");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn final_compound_commit_rejects_reregistered_workspace_identity_and_preserves_new_owner() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "codevo-compound-final-authority-{}-{nonce}",
            std::process::id()
        ));
        let workspace_path = fixture.join("workspace");
        fs::create_dir_all(&workspace_path).expect("create workspace");

        let workspace_registry = WorkspaceRegistry::new();
        let original_descriptor = workspace_registry
            .register(&workspace_path)
            .expect("register original workspace");
        let retained_root = retain_workspace_root(
            &workspace_registry,
            workspace_path.to_str().expect("UTF-8 workspace"),
        )
        .expect("retain original workspace");
        let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } =
            &retained_root.authority
        else {
            panic!("production authority must be retained");
        };
        let root_key = canonical_root.clone();

        let mut trust_service =
            WorkspaceTrustService::load(fixture.join("trust.json")).expect("load trust");
        trust_service.set(&root_key, true).expect("trust workspace");
        let trust = Mutex::new(trust_service);
        let registry = DebugSessionRegistry::new();
        let stale_group = registry
            .begin_start_group_with_authority(&root_key, retained_root.authority.clone())
            .expect("begin original compound group");
        let sink = Arc::new(CompoundCommitTestSink);
        let (first_id, first_terminated) =
            start_compound_commit_test_member(&registry, &stale_group, Arc::clone(&sink));
        let (second_id, second_terminated) =
            start_compound_commit_test_member(&registry, &stale_group, Arc::clone(&sink));

        workspace_registry
            .unregister(&original_descriptor.workspace_id)
            .expect("unregister original identity after member preflight");
        let replacement_descriptor = workspace_registry
            .register(&workspace_path)
            .expect("register replacement identity");
        assert_ne!(
            replacement_descriptor.workspace_id,
            original_descriptor.workspace_id
        );

        assert_eq!(
            validate_compound_start_commit(
                DebugCompoundCommitContext {
                    group: &stale_group,
                    registry: &registry,
                    retained_root: &retained_root,
                    root_key: &root_key,
                    trust: &trust,
                    workspace_registry: &workspace_registry,
                },
                &[first_id, second_id],
                2,
            ),
            Err(compound_start_error())
        );
        assert!(first_terminated.load(Ordering::SeqCst));
        assert!(second_terminated.load(Ordering::SeqCst));
        assert!(!registry.owns_session(&root_key, first_id));
        assert!(!registry.owns_session(&root_key, second_id));

        let replacement_root = retain_workspace_root(
            &workspace_registry,
            workspace_path.to_str().expect("UTF-8 workspace"),
        )
        .expect("retain replacement workspace");
        let replacement_group = registry
            .begin_start_group_with_authority(&root_key, replacement_root.authority.clone())
            .expect("begin replacement compound group");
        let (replacement_id, replacement_terminated) =
            start_compound_commit_test_member(&registry, &replacement_group, sink);
        assert!(!registry.abort_start_group(&stale_group));
        assert!(registry.owns_session_in_group(&replacement_group, replacement_id));
        assert!(!replacement_terminated.load(Ordering::SeqCst));

        registry.stop_all();
        drop(replacement_root);
        drop(retained_root);
        workspace_registry.clear();
        fs::remove_dir_all(fixture).expect("remove fixture");
    }
}
