use crate::debug_adapter::{
    DebugBreakpoint, DebugExceptionPauseMode, DebugJustMyCodePolicy, DebugStartResponse,
};
#[cfg(target_os = "macos")]
use crate::debug_breakpoint_policy::{validate_initial_breakpoints, DebugBreakpointAdapterKind};
use crate::debug_cdp::NodeAttachCandidatePublicationRegistry;
#[cfg(target_os = "macos")]
use crate::debug_commands::{
    app_debug_event_sink, start_debug_session_with_factory, DebugSessionFactoryStartup,
};
#[cfg(target_os = "macos")]
use crate::debug_session_registry::{
    retain_workspace_root, retained_workspace_authority, DebugSessionMode, DebugWorkspaceAuthority,
    RetainedDebugWorkspaceRoot,
};
#[cfg(target_os = "macos")]
use crate::trust::{WorkspaceTrustService, WorkspaceTrustSnapshot};
#[cfg(target_os = "macos")]
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, State};

const MAX_ROOT_PATH_BYTES: usize = 32 * 1024;
const CANDIDATE_LEASE_ID_BYTES: usize = 32;
const START_CLOSED: &str = "Node attach candidate could not be started safely.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct NodeDebugAttachCandidateStartRequest {
    root_path: String,
    candidate_lease_id: String,
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    just_my_code: Option<DebugJustMyCodePolicy>,
}

#[tauri::command]
pub(crate) async fn debug_start_node_attach_candidate(
    request: NodeDebugAttachCandidateStartRequest,
    app: AppHandle,
    registry: State<'_, Arc<crate::debug_adapter::DebugSessionRegistry>>,
    publications: State<'_, Arc<NodeAttachCandidatePublicationRegistry>>,
) -> Result<DebugStartResponse, String> {
    if !valid_root_path(&request.root_path) || !valid_lease_id(&request.candidate_lease_id) {
        return Ok(closed());
    }
    if crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(
        request.exception_type_filter.clone(),
    )
    .is_err()
    {
        return Ok(closed());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, registry, publications);
        return Ok(DebugStartResponse::Unavailable {
            message: "Node attach candidate discovery is unavailable on this platform.".to_string(),
        });
    }

    #[cfg(target_os = "macos")]
    {
        let worker_app = app.clone();
        let worker_registry = Arc::clone(registry.inner());
        let worker_publications = Arc::clone(publications.inner());
        crate::run_blocking_command(move || {
            Ok(start_candidate_blocking(
                request,
                worker_app,
                worker_registry,
                worker_publications,
            ))
        })
        .await
    }
}

#[cfg(target_os = "macos")]
fn start_candidate_blocking(
    request: NodeDebugAttachCandidateStartRequest,
    app: AppHandle,
    registry: Arc<crate::debug_adapter::DebugSessionRegistry>,
    publications: Arc<NodeAttachCandidatePublicationRegistry>,
) -> DebugStartResponse {
    let workspace_registry = app.state::<WorkspaceRegistry>();
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let retained = match retain_workspace_root(&workspace_registry, &request.root_path) {
        Ok(retained) => Arc::new(retained),
        Err(_) => return closed(),
    };
    let root = match exact_retained_root(&workspace_registry, &request.root_path, &retained) {
        Ok(root) => root,
        Err(_) => {
            publications.revoke_authority(&retained.authority);
            return closed();
        }
    };
    let trust_snapshot = match trusted_snapshot(&trust, &root) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            publications.revoke_authority(&retained.authority);
            return closed();
        }
    };
    let breakpoints = match validate_initial_breakpoints(
        &root,
        DebugBreakpointAdapterKind::Node,
        &request.breakpoints,
    ) {
        Ok(breakpoints) => breakpoints,
        Err(_) => {
            publications.revoke_authority(&retained.authority);
            return closed();
        }
    };
    let permit = match registry
        .begin_start_with_authority(&trust_snapshot.root_path, retained.authority.clone())
    {
        Ok(permit) => permit,
        Err(_) => {
            publications.revoke_authority(&retained.authority);
            return closed();
        }
    };

    let authority = retained.authority.clone();
    let root_path = request.root_path;
    let lease_id = request.candidate_lease_id;
    let exception_pause_mode = request.exception_pause_mode;
    let exception_type_filter = request.exception_type_filter;
    let just_my_code = request.just_my_code;
    let factory_app = app.clone();
    let factory_retained = Arc::clone(&retained);
    let factory_breakpoints = breakpoints.clone();
    let response = start_debug_session_with_factory(
        DebugSessionFactoryStartup {
            permit,
            sink: app_debug_event_sink(app),
            registry: &registry,
            breakpoint_kind: DebugBreakpointAdapterKind::Node,
            breakpoints: &breakpoints,
            mode: DebugSessionMode::ExternalNodeAttach,
        },
        move |emitter, finish, registry_startup_is_current| {
            let authority_app = factory_app.clone();
            let authority_root_path = root_path.clone();
            let authority_retained = Arc::clone(&factory_retained);
            let authority_trust = trust_snapshot.clone();
            let authority_is_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || {
                registry_startup_is_current()
                    && candidate_authority_current(
                        &authority_app,
                        &authority_root_path,
                        &authority_retained,
                        &authority_trust,
                    )
            });
            if !authority_is_current() {
                return Err(START_CLOSED.to_string());
            }
            let live_root = factory_retained
                .live_path()
                .map_err(|_| START_CLOSED.to_string())?;
            let terminals = factory_app.state::<crate::terminal_session::TerminalSupervisor>();
            crate::debug_cdp::create_node_attach_candidate_adapter_with_exception_filter(
                &publications,
                &authority,
                &lease_id,
                &terminals,
                &live_root,
                &factory_breakpoints,
                exception_pause_mode,
                &exception_type_filter,
                just_my_code,
                emitter,
                finish,
                authority_is_current,
            )
            .map_err(|_| START_CLOSED.to_string())
        },
    );
    match response {
        Ok(response) => response,
        Err(_) => closed(),
    }
}

#[cfg(target_os = "macos")]
fn exact_retained_root(
    registry: &WorkspaceRegistry,
    root_path: &str,
    retained: &RetainedDebugWorkspaceRoot,
) -> Result<std::path::PathBuf, ()> {
    let root = retained.live_path().map_err(|_| ())?;
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err(());
    };
    if root.to_str() != Some(canonical_root)
        || retained_workspace_authority(registry, root_path).map_err(|_| ())? != retained.authority
    {
        return Err(());
    }
    Ok(root)
}

#[cfg(target_os = "macos")]
fn trusted_snapshot(
    trust: &Mutex<WorkspaceTrustService>,
    root: &std::path::Path,
) -> Result<WorkspaceTrustSnapshot, ()> {
    let root = root.to_str().ok_or(())?;
    let snapshot = trust.lock().map_err(|_| ())?.snapshot(root);
    if snapshot.trusted && snapshot.root_path == root {
        Ok(snapshot)
    } else {
        Err(())
    }
}

#[cfg(target_os = "macos")]
fn candidate_authority_current(
    app: &AppHandle,
    root_path: &str,
    retained: &RetainedDebugWorkspaceRoot,
    trust_snapshot: &WorkspaceTrustSnapshot,
) -> bool {
    let workspace_registry = app.state::<WorkspaceRegistry>();
    if exact_retained_root(&workspace_registry, root_path, retained)
        .ok()
        .as_deref()
        .and_then(std::path::Path::to_str)
        != Some(trust_snapshot.root_path.as_str())
    {
        return false;
    }
    app.state::<Mutex<WorkspaceTrustService>>()
        .lock()
        .ok()
        .is_some_and(|trust| {
            let current = trust.snapshot(&trust_snapshot.root_path);
            current.trusted && current == *trust_snapshot
        })
}

fn valid_root_path(root_path: &str) -> bool {
    !root_path.is_empty()
        && root_path.len() <= MAX_ROOT_PATH_BYTES
        && !root_path.chars().any(char::is_control)
}

fn valid_lease_id(lease_id: &str) -> bool {
    lease_id.len() == CANDIDATE_LEASE_ID_BYTES
        && lease_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn closed() -> DebugStartResponse {
    DebugStartResponse::Error {
        message: START_CLOSED.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_wire_is_exact_and_contains_no_process_or_endpoint_authority() {
        let breakpoint = json!({
            "id": "bp",
            "filePath": "/workspace/server.ts",
            "lineNumber": 1,
            "condition": null,
            "logMessage": null,
            "enabled": true,
            "verified": false
        });
        let request = json!({
            "rootPath": "/workspace",
            "candidateLeaseId": "0123456789abcdef0123456789abcdef",
            "breakpoints": [breakpoint],
            "exceptionPauseMode": "uncaught",
            "exceptionTypeFilter": ["DomainError"],
            "justMyCode": "nodeInternalsAndDependencies"
        });
        assert!(
            serde_json::from_value::<NodeDebugAttachCandidateStartRequest>(request.clone()).is_ok()
        );
        for forbidden in ["pid", "port", "webSocketDebuggerUrl", "extra"] {
            let mut changed = request.clone();
            changed
                .as_object_mut()
                .expect("request object")
                .insert(forbidden.to_string(), json!(1));
            assert!(
                serde_json::from_value::<NodeDebugAttachCandidateStartRequest>(changed).is_err(),
                "{forbidden}"
            );
        }

        let mut missing_filter = request;
        missing_filter
            .as_object_mut()
            .expect("request object")
            .remove("exceptionTypeFilter");
        assert!(
            serde_json::from_value::<NodeDebugAttachCandidateStartRequest>(missing_filter).is_err()
        );
    }

    #[test]
    fn root_and_lease_syntax_are_bounded_and_canonical() {
        assert!(valid_root_path("/workspace"));
        assert!(!valid_root_path(""));
        assert!(!valid_root_path("/workspace\nother"));
        assert!(!valid_root_path(&"x".repeat(MAX_ROOT_PATH_BYTES + 1)));

        assert!(valid_lease_id("0123456789abcdef0123456789abcdef"));
        for invalid in [
            "",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdeg",
            "0123456789abcdef0123456789abcde",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(!valid_lease_id(invalid), "{invalid}");
        }
    }
}
