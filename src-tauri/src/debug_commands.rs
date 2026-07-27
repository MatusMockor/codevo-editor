use crate::debug_adapter::variable_name::MAX_DEBUG_VARIABLE_NAME_BYTES;
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvaluateContext, DebugEvaluateErrorKind,
    DebugEvaluateFailure, DebugEvaluatePolicy, DebugEvent, DebugEventSink, DebugExceptionPauseMode,
    DebugFunctionBreakpoint, DebugLaunchTarget, DebugScopeInfo, DebugSessionRegistry,
    DebugStackFrame, DebugStartResponse, DebugStartupPermit, DebugVariableInfo, DebugVariablePage,
    DebugVariablePageRequest, StepKind,
};
use crate::debug_breakpoint_policy::{validate_initial_breakpoints, DebugBreakpointAdapterKind};
use crate::debug_session_registry::{
    retain_workspace_root, DebugSessionMode, DebugWorkspaceAuthority, RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[path = "debug_disconnect_request.rs"]
mod disconnect_request;
use disconnect_request::{validated_disconnect_authority, DebugDisconnectRequest};
#[path = "debug_adapter_factory.rs"]
mod adapter_factory;
pub(crate) use adapter_factory::create_debug_adapter_with_exception_filter;
#[path = "debug_evaluate_wire.rs"]
mod evaluate_wire;
use evaluate_wire::{
    bounded_value as bounded_evaluate_value, failure as failure_response, validate_evaluate_text,
    DebugEvaluateRequest, DebugEvaluateResponse,
};
#[path = "debug_completions_command.rs"]
mod completions_command;
pub(crate) use completions_command::debug_completions;
#[path = "debug_completions_wire.rs"]
mod debug_completions_wire;
#[path = "debug_set_expression_command.rs"]
pub(crate) mod set_expression_command;
pub(crate) use set_expression_command::debug_set_expression;
#[path = "debug_set_breakpoints_active_command.rs"]
mod set_breakpoints_active_command;
pub(crate) use crate::debug_cdp_function_breakpoints::debug_set_function_breakpoints;
pub(crate) use set_breakpoints_active_command::debug_set_breakpoints_active;
#[path = "debug_set_expression_wire.rs"]
mod set_expression_wire;
#[path = "debug_set_variable_command.rs"]
pub(crate) mod set_variable_command;
pub(crate) use set_variable_command::debug_set_variable;
#[path = "debug_set_variable_wire.rs"]
mod set_variable_wire;
#[path = "debug_variable_page.rs"]
mod variable_page;
use variable_page::bound_variable_page;
#[path = "debug_finish_gate.rs"]
mod finish_gate;
use finish_gate::DebugFinishGate;
#[path = "debug_session_factory.rs"]
mod session_factory;
pub(crate) use session_factory::{start_debug_session_with_factory, DebugSessionFactoryStartup};
#[path = "debug_compound_start.rs"]
mod compound_start;
pub(crate) use compound_start::debug_start_compound;
#[path = "debug_commands_wire.rs"]
mod command_wire;
use command_wire::{bound_scopes, is_unsafe_debug_path_character};
pub(crate) use command_wire::{
    DebugRestartFrameRequest, DebugRunToLocationRequest, DebugScopesRequest,
    DebugSetBreakpointsRequest, DebugSetExceptionPauseRequest, DebugVariablesRequest,
};

const DEBUG_EVENT: &str = "debug://event";
const MAX_DEBUG_EVALUATE_EXPRESSION_BYTES: usize = 4_096;
const MAX_DEBUG_EVALUATE_ROOT_BYTES: usize = 4_096;
const MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES: usize = 4_096;
const MAX_DEBUG_EVALUATE_MESSAGE_BYTES: usize = 4_096;
const MAX_DEBUG_EVALUATE_VALUE_BYTES: usize = 64 * 1_024;
const MAX_DEBUG_EVALUATE_TYPE_BYTES: usize = 256;
const MAX_DEBUG_VARIABLE_PAGE_COUNT: u32 = 100;
const MAX_DEBUG_VARIABLE_START: u64 = 1_000_000;
const MAX_DEBUG_SCOPES: usize = 256;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub(crate) struct AppHandleDebugEventSink {
    app: AppHandle,
}

pub(crate) fn app_debug_event_sink(app: AppHandle) -> Arc<dyn DebugEventSink> {
    Arc::new(AppHandleDebugEventSink { app })
}

/// Tauri `emit` queues delivery to webviews without blocking the adapter thread.
impl DebugEventSink for AppHandleDebugEventSink {
    fn emit(&self, event: DebugEvent) {
        let _ = self.app.emit(DEBUG_EVENT, event);
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn debug_start(
    root_path: String,
    launch: DebugLaunchTarget,
    breakpoints: Vec<DebugBreakpoint>,
    function_breakpoints: Vec<DebugFunctionBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    source_maps_enabled: bool,
    stop_on_entry: bool,
    app: AppHandle,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugStartResponse, String> {
    let retained_root = retain_workspace_root(&workspace_registry, &root_path)?;
    debug_start_with_trust_and_authority(
        root_path,
        launch,
        breakpoints,
        function_breakpoints,
        exception_pause_mode,
        exception_type_filter,
        source_maps_enabled,
        stop_on_entry,
        DebugStartBackend {
            sink: app_debug_event_sink(app),
            registry: Arc::clone(registry.inner()),
            trust: &trust,
            workspace_authority: Some(retained_root.authority.clone()),
            retained_root: Some(retained_root),
        },
    )
    .await
}

#[cfg(test)]
pub(crate) async fn debug_start_with_trust(
    root_path: String,
    launch: DebugLaunchTarget,
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    sink: Arc<dyn DebugEventSink>,
    registry: Arc<DebugSessionRegistry>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<DebugStartResponse, String> {
    debug_start_with_trust_and_authority(
        root_path,
        launch,
        breakpoints,
        Vec::new(),
        exception_pause_mode,
        Vec::new(),
        true,
        false,
        DebugStartBackend {
            sink,
            registry,
            trust,
            workspace_authority: None,
            retained_root: None,
        },
    )
    .await
}

struct DebugStartBackend<'a> {
    sink: Arc<dyn DebugEventSink>,
    registry: Arc<DebugSessionRegistry>,
    trust: &'a Mutex<WorkspaceTrustService>,
    workspace_authority: Option<DebugWorkspaceAuthority>,
    retained_root: Option<RetainedDebugWorkspaceRoot>,
}

#[allow(clippy::too_many_arguments)]
async fn debug_start_with_trust_and_authority(
    root_path: String,
    launch: DebugLaunchTarget,
    breakpoints: Vec<DebugBreakpoint>,
    function_breakpoints: Vec<DebugFunctionBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    source_maps_enabled: bool,
    stop_on_entry: bool,
    backend: DebugStartBackend<'_>,
) -> Result<DebugStartResponse, String> {
    let DebugStartBackend {
        sink,
        registry,
        trust,
        workspace_authority,
        retained_root,
    } = backend;
    let (root, root_key) = match retained_root.as_ref() {
        Some(retained) => {
            let root = match retained.live_path() {
                Ok(root) => root,
                Err(message) => return Ok(DebugStartResponse::Error { message }),
            };
            let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } =
                &retained.authority
            else {
                return Ok(DebugStartResponse::Error {
                    message: "Debug workspace identity changed during startup.".to_string(),
                });
            };
            (root, canonical_root.clone())
        }
        None => match super::canonicalize_workspace_root(&root_path) {
            Ok(root) => {
                let root_key = root.to_string_lossy().into_owned();
                (root, root_key)
            }
            Err(message) => return Ok(DebugStartResponse::Error { message }),
        },
    };
    let workspace_authority = workspace_authority
        .unwrap_or_else(|| DebugWorkspaceAuthority::CanonicalRoot(root_key.clone()));
    if matches!(
        &workspace_authority,
        DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. }
            if canonical_root != &root_key
    ) {
        return Ok(DebugStartResponse::Error {
            message: "Debug workspace identity changed during startup.".to_string(),
        });
    }
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_key)
        .trusted;

    if !trusted {
        return Ok(DebugStartResponse::Unavailable {
            message: "Trust this workspace to run the debugger.".to_string(),
        });
    }

    let breakpoint_kind = DebugBreakpointAdapterKind::from_launch(&launch);
    let breakpoints = match validate_initial_breakpoints(&root, breakpoint_kind, &breakpoints) {
        Ok(breakpoints) => breakpoints,
        Err(message) => return Ok(DebugStartResponse::Error { message }),
    };
    if let Err(message) =
        crate::debug_cdp_function_breakpoints::validate_function_breakpoints(&function_breakpoints)
    {
        return Ok(DebugStartResponse::Error { message });
    }
    if !launch.is_node() && !function_breakpoints.is_empty() {
        return Ok(DebugStartResponse::Error {
            message: "Function breakpoints are only available for Node.js debug sessions."
                .to_string(),
        });
    }

    let permit = match registry.begin_start_with_authority(&root_key, workspace_authority) {
        Ok(permit) => permit,
        Err(message) => return Ok(DebugStartResponse::Error { message }),
    };

    super::run_blocking_command(move || {
        Ok(start_debug_session_blocking(
            DebugSessionStartup {
                root: &root,
                permit,
                launch: &launch,
                breakpoints: &breakpoints,
                function_breakpoints: &function_breakpoints,
                exception_pause_mode,
                exception_type_filter,
                sink,
                registry: &registry,
                retained_root,
                stop_on_entry,
            },
            source_maps_enabled,
        ))
    })
    .await
}

struct DebugSessionStartup<'a> {
    root: &'a Path,
    permit: DebugStartupPermit,
    launch: &'a DebugLaunchTarget,
    breakpoints: &'a [DebugBreakpoint],
    function_breakpoints: &'a [DebugFunctionBreakpoint],
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    sink: Arc<dyn DebugEventSink>,
    registry: &'a Arc<DebugSessionRegistry>,
    retained_root: Option<RetainedDebugWorkspaceRoot>,
    stop_on_entry: bool,
}

fn start_debug_session_blocking(
    startup: DebugSessionStartup<'_>,
    source_maps_enabled: bool,
) -> DebugStartResponse {
    let DebugSessionStartup {
        root,
        permit,
        launch,
        breakpoints,
        function_breakpoints,
        exception_pause_mode,
        exception_type_filter,
        sink,
        registry,
        retained_root,
        stop_on_entry,
    } = startup;
    let breakpoint_kind = DebugBreakpointAdapterKind::from_launch(launch);
    let factory_retained_root = retained_root.as_ref();
    start_debug_session_with_factory(
        DebugSessionFactoryStartup {
            permit,
            sink,
            registry,
            breakpoint_kind,
            breakpoints,
            mode: if matches!(launch, DebugLaunchTarget::NodeAttach { .. }) {
                DebugSessionMode::ExternalNodeAttach
            } else {
                DebugSessionMode::OwnedLaunch
            },
        },
        move |emitter, finish, startup_is_current| {
            let adapter_root = match factory_retained_root {
                Some(retained) => retained.live_path()?,
                None => root.to_path_buf(),
            };
            adapter_factory::create_debug_adapter_with_startup_function_breakpoints(
                &adapter_root,
                launch,
                breakpoints,
                function_breakpoints,
                exception_pause_mode,
                &exception_type_filter,
                source_maps_enabled,
                stop_on_entry,
                emitter,
                finish,
                startup_is_current,
            )
        },
    )
    .unwrap_or_else(|message| DebugStartResponse::Error {
        message: public_debug_start_error(launch, message),
    })
}

fn public_debug_start_error(launch: &DebugLaunchTarget, message: String) -> String {
    if matches!(launch, DebugLaunchTarget::NodeNpmScript { .. }) {
        "NPM debug configuration could not be started safely.".to_string()
    } else if launch.just_my_code().is_some() {
        "Node debug configuration could not be started safely.".to_string()
    } else {
        message
    }
}

#[tauri::command]
pub(crate) async fn debug_evaluate(
    request: DebugEvaluateRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugEvaluateResponse, String> {
    Ok(debug_evaluate_request_with_trust(request, Arc::clone(registry.inner()), &trust).await)
}

pub(crate) async fn debug_evaluate_request_with_trust(
    request: DebugEvaluateRequest,
    registry: Arc<DebugSessionRegistry>,
    trust: &Mutex<WorkspaceTrustService>,
) -> DebugEvaluateResponse {
    if let Err(failure) = request.validate() {
        return failure_response(failure);
    }
    let root = match super::canonicalize_workspace_root(&request.root_path) {
        Ok(root) => root,
        Err(message) => return failure_response(DebugEvaluateFailure::unsupported(message)),
    };
    let root_key = root.to_string_lossy().to_string();
    let trusted = match trust.lock() {
        Ok(trust) => trust.get(&root_key).trusted,
        Err(error) => {
            return failure_response(DebugEvaluateFailure::unsupported(error.to_string()))
        }
    };

    if !trusted {
        return failure_response(DebugEvaluateFailure::unsupported(
            "Trust this workspace to evaluate debug expressions.",
        ));
    }
    if !registry.owns_session(&root_key, request.session_id) {
        return failure_response(DebugEvaluateFailure::unsupported(
            "The debug session no longer belongs to this workspace.",
        ));
    }

    let result = super::run_blocking_command(move || {
        registry.evaluate_for_session(request.session_id, &root_key, |adapter| {
            if adapter.current_pause_generation() != Some(request.pause_generation) {
                return Err(DebugEvaluateFailure::exception(
                    "The debugger pause generation is stale.",
                ));
            }
            adapter.evaluate_with_policy(
                request.frame_id,
                &request.expression,
                DebugEvaluatePolicy {
                    context: request.context,
                    allow_side_effects: request.allow_side_effects,
                },
            )
        })
    })
    .await;
    match result {
        Ok(Ok(value)) => bounded_evaluate_value(value),
        Ok(Err(failure)) => failure_response(failure),
        Err(message) => failure_response(DebugEvaluateFailure::exception(message)),
    }
}

#[cfg(test)]
pub(crate) async fn debug_evaluate_with_trust(
    root_path: String,
    session_id: u64,
    frame_id: u64,
    expression: String,
    registry: Arc<DebugSessionRegistry>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<DebugVariableInfo, String> {
    match debug_evaluate_request_with_trust(
        DebugEvaluateRequest {
            root_path,
            session_id,
            frame_id,
            pause_generation: 1,
            expression,
            context: DebugEvaluateContext::Repl,
            allow_side_effects: true,
        },
        registry,
        trust,
    )
    .await
    {
        DebugEvaluateResponse::Ok { value } => Ok(value),
        DebugEvaluateResponse::Error { message, .. } => Err(message),
    }
}

#[tauri::command]
pub(crate) async fn debug_stop(
    session_id: u64,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<(), String> {
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || stop_debug_session_blocking(&registry, session_id)).await
}

#[tauri::command]
pub(crate) async fn debug_disconnect(
    request: DebugDisconnectRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    let workspace_authority = validated_disconnect_authority(&workspace_registry, &request)?;
    debug_disconnect_request_with_authority(
        request,
        Arc::clone(registry.inner()),
        workspace_authority,
    )
    .await
}

#[cfg(test)]
pub(crate) async fn debug_disconnect_request(
    request: DebugDisconnectRequest,
    registry: Arc<DebugSessionRegistry>,
) -> Result<(), String> {
    request.validate()?;
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let workspace_authority =
        DebugWorkspaceAuthority::CanonicalRoot(root.to_string_lossy().into_owned());
    debug_disconnect_request_with_authority(request, registry, workspace_authority).await
}

async fn debug_disconnect_request_with_authority(
    request: DebugDisconnectRequest,
    registry: Arc<DebugSessionRegistry>,
    workspace_authority: DebugWorkspaceAuthority,
) -> Result<(), String> {
    request.validate()?;
    super::run_blocking_command(move || {
        registry
            .disconnect_external_node_attach_authorized(&workspace_authority, request.session_id)
    })
    .await
}

pub(crate) fn stop_debug_session_blocking(
    registry: &DebugSessionRegistry,
    session_id: u64,
) -> Result<(), String> {
    if !registry.stop_by_id(session_id) {
        return Err(format!("No debug session with id {session_id}."));
    }

    Ok(())
}

pub(crate) fn with_debug_session<R>(
    registry: &DebugSessionRegistry,
    session_id: u64,
    operation: impl FnOnce(&mut dyn DebugAdapter) -> Result<R, String>,
) -> Result<R, String> {
    registry.with_session_by_id(session_id, operation)?
}

#[tauri::command]
pub(crate) async fn debug_set_breakpoints(
    request: DebugSetBreakpointsRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<Vec<DebugBreakpoint>, String> {
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || {
        registry.set_breakpoints_for_session(
            request.session_id,
            &root_key,
            &request.file_path,
            &request.breakpoints,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_set_exception_pause(
    request: DebugSetExceptionPauseRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<(), String> {
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(
        request.exception_type_filter.clone(),
    )?;
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || {
        set_exception_pause_for_session(&registry, &root_key, &request)
    })
    .await
}

fn set_exception_pause_for_session(
    registry: &DebugSessionRegistry,
    root_key: &str,
    request: &DebugSetExceptionPauseRequest,
) -> Result<(), String> {
    registry.control_for_session(request.session_id, root_key, |adapter| {
        adapter.set_exception_pause_filter(request.mode, &request.exception_type_filter)
    })?
}

#[tauri::command]
pub(crate) async fn debug_step(
    session_id: u64,
    kind: StepKind,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<(), String> {
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || {
        with_debug_session(&registry, session_id, |adapter| adapter.step(kind))
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_pause(
    session_id: u64,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<(), String> {
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || {
        with_debug_session(&registry, session_id, |adapter| adapter.pause())
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_restart_frame(
    request: DebugRestartFrameRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    app: AppHandle,
) -> Result<(), String> {
    request.validate()?;
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    if !registry.owns_session(&root_key, request.session_id) {
        return Err("The debug session no longer belongs to this workspace.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let session_id = request.session_id;
    let pause_generation = request.pause_generation;
    let frame_id = request.frame_id;
    super::run_blocking_command(move || {
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(&root_key).trusted {
            return Err("Trust this workspace to control the debugger.".to_string());
        }
        registry.control_for_session(session_id, &root_key, |adapter| {
            if adapter.current_pause_generation() != Some(pause_generation) {
                return Err("The debugger pause generation is stale.".to_string());
            }
            adapter.restart_frame(pause_generation, frame_id)
        })?
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_run_to_location(
    request: DebugRunToLocationRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    app: AppHandle,
) -> Result<(), String> {
    let (line_number, column_number) = request.validate()?;
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    let canonical_file = crate::debug_support::validate_workspace_file(&root, &request.file_path)?;
    if !DebugBreakpointAdapterKind::Node.supports(Path::new(&canonical_file)) {
        return Err("Run to location supports JavaScript and TypeScript source files only.".into());
    }
    if !registry.owns_session(&root_key, request.session_id) {
        return Err("The debug session no longer belongs to this workspace.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let session_id = request.session_id;
    let pause_generation = request.pause_generation;
    super::run_blocking_command(move || {
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(&root_key).trusted {
            return Err("Trust this workspace to control the debugger.".to_string());
        }
        // Keep the trust guard through the exact root/session control permit
        // and adapter mutation, so revocation cannot race the CDP request.
        registry.control_for_session(session_id, &root_key, |adapter| {
            if adapter.current_pause_generation() != Some(pause_generation) {
                return Err("The debugger pause generation is stale.".to_string());
            }
            adapter.run_to_location(
                pause_generation,
                &canonical_file,
                line_number,
                column_number,
            )
        })?
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_stack_trace(
    session_id: u64,
    registry: State<'_, Arc<DebugSessionRegistry>>,
) -> Result<Vec<DebugStackFrame>, String> {
    let registry = Arc::clone(registry.inner());
    super::run_blocking_command(move || {
        with_debug_session(&registry, session_id, |adapter| adapter.stack_trace())
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_scopes(
    request: DebugScopesRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<Vec<DebugScopeInfo>, String> {
    request.validate()?;
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_key)
        .trusted
    {
        return Err("Trust this workspace to inspect debug scopes.".to_string());
    }
    if !registry.owns_session(&root_key, request.session_id) {
        return Err("The debug session no longer belongs to this workspace.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let session_id = request.session_id;
    let frame_id = request.frame_id;
    let pause_generation = request.pause_generation;
    super::run_blocking_command(move || {
        let scopes = registry.inspect_for_session(session_id, &root_key, |adapter| {
            if adapter.current_pause_generation() != Some(pause_generation) {
                return Err("The debugger pause generation is stale.".to_string());
            }
            adapter.scopes(frame_id)
        })??;
        bound_scopes(scopes)
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_variables(
    request: DebugVariablesRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugVariablePage, String> {
    request.validate()?;
    let root = super::canonicalize_workspace_root(&request.root_path)?;
    let root_key = root.to_string_lossy().into_owned();
    if !trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_key)
        .trusted
    {
        return Err("Trust this workspace to inspect debug variables.".to_string());
    }
    if !registry.owns_session(&root_key, request.session_id) {
        return Err("The debug session no longer belongs to this workspace.".to_string());
    }
    let registry = Arc::clone(registry.inner());
    let adapter_request = request.adapter_request();
    let session_id = request.session_id;
    super::run_blocking_command(move || {
        let page = registry.inspect_for_session(session_id, &root_key, |adapter| {
            adapter.variables_page(adapter_request)
        })??;
        bound_variable_page(page, adapter_request)
    })
    .await
}

#[cfg(test)]
#[path = "debug_commands_authority_tests.rs"]
mod authority_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;

    fn raw_breakpoint() -> serde_json::Value {
        serde_json::json!({
            "id": "bp-1",
            "filePath": "/workspace/app.ts",
            "lineNumber": 1,
            "condition": null,
            "enabled": true
        })
    }

    fn run_to_location_request() -> DebugRunToLocationRequest {
        DebugRunToLocationRequest {
            root_path: "/workspace".to_string(),
            session_id: 7,
            pause_generation: 3,
            file_path: "/workspace/src/app.ts".to_string(),
            line_number: 12,
            column_number: 5,
        }
    }

    fn restart_frame_request() -> DebugRestartFrameRequest {
        DebugRestartFrameRequest {
            root_path: "/workspace".to_string(),
            session_id: 7,
            pause_generation: 3,
            frame_id: 11,
        }
    }

    #[test]
    fn restart_frame_request_has_a_closed_bounded_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "pauseGeneration": 3,
            "frameId": 11
        });
        assert!(serde_json::from_value::<DebugRestartFrameRequest>(valid.clone()).is_ok());
        for missing in ["rootPath", "sessionId", "pauseGeneration", "frameId"] {
            let mut request = valid.clone();
            request.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugRestartFrameRequest>(request).is_err());
        }
        let mut unknown = valid;
        unknown["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugRestartFrameRequest>(unknown).is_err());

        assert!(restart_frame_request().validate().is_ok());
        for field in ["session", "pause", "frame"] {
            let mut request = restart_frame_request();
            match field {
                "session" => request.session_id = 0,
                "pause" => request.pause_generation = MAX_JAVASCRIPT_SAFE_INTEGER + 1,
                "frame" => request.frame_id = 0,
                _ => unreachable!(),
            }
            assert!(request.validate().is_err(), "{field} must be rejected");
        }
        for root_path in [
            String::new(),
            "x".repeat(MAX_DEBUG_EVALUATE_ROOT_BYTES + 1),
            "/workspace/evil\u{202e}root".to_string(),
            "/workspace/bad\nroot".to_string(),
        ] {
            let mut request = restart_frame_request();
            request.root_path = root_path;
            assert!(request.validate().is_err());
        }
    }

    #[test]
    fn run_to_location_request_has_a_closed_bounded_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "pauseGeneration": 3,
            "filePath": "/workspace/src/app.ts",
            "lineNumber": 12,
            "columnNumber": 5
        });
        assert!(serde_json::from_value::<DebugRunToLocationRequest>(valid.clone()).is_ok());
        for missing in [
            "rootPath",
            "sessionId",
            "pauseGeneration",
            "filePath",
            "lineNumber",
            "columnNumber",
        ] {
            let mut request = valid.clone();
            request.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugRunToLocationRequest>(request).is_err());
        }
        let mut unknown = valid;
        unknown["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugRunToLocationRequest>(unknown).is_err());

        assert!(run_to_location_request().validate().is_ok());
        for field in ["session", "pause", "line", "column"] {
            let mut request = run_to_location_request();
            match field {
                "session" => request.session_id = 0,
                "pause" => request.pause_generation = MAX_JAVASCRIPT_SAFE_INTEGER + 1,
                "line" => request.line_number = 0,
                "column" => request.column_number = u32::MAX as u64 + 1,
                _ => unreachable!(),
            }
            assert!(request.validate().is_err(), "{field} must be rejected");
        }
        for file_path in [
            String::new(),
            "x".repeat(MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES + 1),
            "/workspace/src/evil\u{202e}st".to_string(),
            "/workspace/src/bad\n.ts".to_string(),
        ] {
            let mut request = run_to_location_request();
            request.file_path = file_path;
            assert!(request.validate().is_err());
        }
    }

    #[test]
    fn set_breakpoints_request_has_a_closed_nested_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "filePath": "/workspace/app.ts",
            "breakpoints": [raw_breakpoint()]
        });
        assert!(serde_json::from_value::<DebugSetBreakpointsRequest>(valid.clone()).is_ok());

        let mut unknown_request = valid.clone();
        unknown_request["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugSetBreakpointsRequest>(unknown_request).is_err());

        let mut unknown_breakpoint = valid.clone();
        unknown_breakpoint["breakpoints"][0]["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugSetBreakpointsRequest>(unknown_breakpoint).is_err());

        for missing in ["rootPath", "sessionId", "filePath", "breakpoints"] {
            let mut request = valid.clone();
            request
                .as_object_mut()
                .expect("request object")
                .remove(missing);
            assert!(
                serde_json::from_value::<DebugSetBreakpointsRequest>(request).is_err(),
                "missing field {missing} must be rejected"
            );
        }
    }

    fn evaluate_request() -> DebugEvaluateRequest {
        DebugEvaluateRequest {
            root_path: "/workspace".to_string(),
            session_id: 7,
            frame_id: 11,
            pause_generation: 3,
            expression: "user\t.name".to_string(),
            context: DebugEvaluateContext::Watch,
            allow_side_effects: false,
        }
    }

    #[test]
    fn disconnect_request_has_a_closed_bounded_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7
        });
        assert!(serde_json::from_value::<DebugDisconnectRequest>(valid.clone()).is_ok());
        for missing in ["rootPath", "sessionId"] {
            let mut request = valid.clone();
            request.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugDisconnectRequest>(request).is_err());
        }
        let mut unknown = valid.clone();
        unknown["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugDisconnectRequest>(unknown).is_err());
        let mut wrong_type = valid.clone();
        wrong_type["sessionId"] = serde_json::json!("7");
        assert!(serde_json::from_value::<DebugDisconnectRequest>(wrong_type).is_err());
        for (root_path, session_id) in [
            ("", 7),
            ("/workspace\nother", 7),
            ("/workspace", 0),
            ("/workspace", MAX_JAVASCRIPT_SAFE_INTEGER + 1),
        ] {
            assert!(DebugDisconnectRequest {
                root_path: root_path.to_string(),
                session_id,
            }
            .validate()
            .is_err());
        }
    }

    #[test]
    fn disconnect_canonicalizes_the_root_and_is_safe_after_remote_close() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "codevo-debug-disconnect-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create workspace fixture");
        let registry = Arc::new(DebugSessionRegistry::new());
        let request = DebugDisconnectRequest {
            root_path: root.join(".").to_string_lossy().into_owned(),
            session_id: 7,
        };

        tauri::async_runtime::block_on(debug_disconnect_request(request, registry))
            .expect("already-closed session without a replacement is idempotent");
        std::fs::remove_dir_all(root).expect("remove workspace fixture");
    }

    #[test]
    fn evaluate_request_has_a_closed_nested_wire_contract() {
        let valid = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "frameId": 11,
            "pauseGeneration": 3,
            "expression": "user.name",
            "context": "watch",
            "allowSideEffects": false
        });
        assert!(serde_json::from_value::<DebugEvaluateRequest>(valid.clone()).is_ok());
        let mut clipboard = valid.clone();
        clipboard["context"] = serde_json::json!("clipboard");
        clipboard["allowSideEffects"] = serde_json::json!(true);
        let clipboard_request =
            serde_json::from_value::<DebugEvaluateRequest>(clipboard).expect("clipboard request");
        assert_eq!(clipboard_request.context, DebugEvaluateContext::Clipboard);
        assert!(clipboard_request.validate().is_ok());

        for missing in [
            "rootPath",
            "sessionId",
            "frameId",
            "pauseGeneration",
            "expression",
            "context",
            "allowSideEffects",
        ] {
            let mut request = valid.clone();
            request.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugEvaluateRequest>(request).is_err());
        }
        for (field, value) in [
            ("context", serde_json::json!("hover")),
            ("allowSideEffects", serde_json::json!("false")),
        ] {
            let mut request = valid.clone();
            request[field] = value;
            assert!(serde_json::from_value::<DebugEvaluateRequest>(request).is_err());
        }
        let mut unknown = valid;
        unknown["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugEvaluateRequest>(unknown).is_err());
    }

    #[test]
    fn evaluate_request_enforces_text_id_and_side_effect_bounds() {
        assert!(evaluate_request().validate().is_ok());
        for expression in [
            "({root:\n{child:{value:42}}, list:[1,2,3]})",
            "(() => {\r\n\treturn { nested: true };\r\n})()",
        ] {
            let mut multiline = evaluate_request();
            multiline.expression = expression.to_string();
            assert!(
                multiline.validate().is_ok(),
                "legitimate multiline expression must be accepted"
            );
        }
        let mut request = evaluate_request();
        request.context = DebugEvaluateContext::Repl;
        request.allow_side_effects = true;
        assert!(request.validate().is_ok());
        request.allow_side_effects = false;
        assert_eq!(
            request.validate().unwrap_err().kind,
            DebugEvaluateErrorKind::SideEffect
        );
        request.context = DebugEvaluateContext::Clipboard;
        request.allow_side_effects = true;
        assert!(request.validate().is_ok());
        request.allow_side_effects = false;
        assert_eq!(
            request.validate().unwrap_err().kind,
            DebugEvaluateErrorKind::SideEffect
        );

        for expression in [
            String::new(),
            "x".repeat(MAX_DEBUG_EVALUATE_EXPRESSION_BYTES + 1),
            "ž".repeat((MAX_DEBUG_EVALUATE_EXPRESSION_BYTES / 2) + 1),
            "bad\rexpression".to_string(),
            "bad\u{b}expression".to_string(),
            "bad\u{85}expression".to_string(),
            "bad\0expression".to_string(),
        ] {
            let mut invalid = evaluate_request();
            invalid.expression = expression;
            assert!(invalid.validate().is_err());
        }
        let mut exact = evaluate_request();
        exact.expression = "ž".repeat(MAX_DEBUG_EVALUATE_EXPRESSION_BYTES / 2);
        assert!(exact.validate().is_ok());

        for (session_id, frame_id, pause_generation) in [
            (0, 1, 1),
            (1, 0, 1),
            (1, 1, 0),
            (MAX_JAVASCRIPT_SAFE_INTEGER + 1, 1, 1),
            (1, MAX_JAVASCRIPT_SAFE_INTEGER + 1, 1),
            (1, 1, MAX_JAVASCRIPT_SAFE_INTEGER + 1),
        ] {
            let mut invalid = evaluate_request();
            invalid.session_id = session_id;
            invalid.frame_id = frame_id;
            invalid.pause_generation = pause_generation;
            assert!(invalid.validate().is_err());
        }
        let mut unsafe_watch = evaluate_request();
        unsafe_watch.allow_side_effects = true;
        assert_eq!(
            unsafe_watch.validate().unwrap_err().kind,
            DebugEvaluateErrorKind::SideEffect
        );
        let mut invalid_root = evaluate_request();
        invalid_root.root_path = "/workspace\u{85}/project".to_string();
        assert!(invalid_root.validate().is_err());
    }

    #[test]
    fn evaluate_response_is_the_exact_tagged_union_and_bounds_adapter_values() {
        let value = DebugVariableInfo {
            name: "user.name".to_string(),
            value: "Ada".to_string(),
            value_type: Some("string".to_string()),
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        };
        assert_eq!(
            serde_json::to_value(DebugEvaluateResponse::Ok {
                value: value.clone()
            })
            .unwrap(),
            serde_json::json!({
                "status":"ok",
                "value": {"name":"user.name", "value":"Ada", "type":"string", "variablesReference":0}
            })
        );
        for name in [
            "({root:\n{child:{value:42}}})",
            "(() => {\r\n\treturn 42;\r\n})()",
        ] {
            assert!(matches!(
                bounded_evaluate_value(DebugVariableInfo {
                    name: name.to_string(),
                    ..value.clone()
                }),
                DebugEvaluateResponse::Ok { .. }
            ));
        }
        for name in [
            "before\rafter",
            "before\u{b}after",
            "before\u{85}after",
            "before\0after",
        ] {
            assert!(matches!(
                bounded_evaluate_value(DebugVariableInfo {
                    name: name.to_string(),
                    ..value.clone()
                }),
                DebugEvaluateResponse::Error {
                    kind: DebugEvaluateErrorKind::Unsupported,
                    ..
                }
            ));
        }
        assert_eq!(
            serde_json::to_value(failure_response(DebugEvaluateFailure {
                kind: DebugEvaluateErrorKind::SideEffect,
                message: "Possible side-effect".to_string(),
            }))
            .unwrap(),
            serde_json::json!({"status":"error", "kind":"side-effect", "message":"Possible side-effect"})
        );
        assert!(matches!(
            bounded_evaluate_value(DebugVariableInfo {
                value: "x".repeat(MAX_DEBUG_EVALUATE_VALUE_BYTES + 1),
                ..value.clone()
            }),
            DebugEvaluateResponse::Error {
                kind: DebugEvaluateErrorKind::Unsupported,
                ..
            }
        ));
        let with_evaluate_name = DebugVariableInfo {
            evaluate_name: Some("user.name".to_string()),
            ..value.clone()
        };
        assert_eq!(
            serde_json::to_value(bounded_evaluate_value(with_evaluate_name)).unwrap(),
            serde_json::json!({
                "status":"ok",
                "value": {
                    "name":"user.name", "value":"Ada", "type":"string",
                    "evaluateName":"user.name", "variablesReference":0
                }
            })
        );
        let multiline_evaluate_name = "(\n\tuser\r\n).name";
        let with_multiline_evaluate_name = DebugVariableInfo {
            evaluate_name: Some(multiline_evaluate_name.to_string()),
            ..value.clone()
        };
        assert_eq!(
            serde_json::to_value(bounded_evaluate_value(with_multiline_evaluate_name)).unwrap(),
            serde_json::json!({
                "status":"ok",
                "value": {
                    "name":"user.name", "value":"Ada", "type":"string",
                    "evaluateName":multiline_evaluate_name, "variablesReference":0
                }
            })
        );
        for evaluate_name in [
            String::new(),
            "   ".to_string(),
            "user\rname".to_string(),
            "user\u{000b}name".to_string(),
            "user\u{0085}name".to_string(),
            "user\0name".to_string(),
            "x".repeat(MAX_DEBUG_EVALUATE_EXPRESSION_BYTES + 1),
        ] {
            assert!(matches!(
                bounded_evaluate_value(DebugVariableInfo {
                    evaluate_name: Some(evaluate_name),
                    ..value.clone()
                }),
                DebugEvaluateResponse::Error {
                    kind: DebugEvaluateErrorKind::Unsupported,
                    ..
                }
            ));
        }
    }

    #[test]
    fn scope_and_variable_requests_have_closed_owned_wire_contracts() {
        let scopes = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "pauseGeneration": 3,
            "frameId": 11
        });
        assert!(serde_json::from_value::<DebugScopesRequest>(scopes.clone()).is_ok());
        for missing in ["rootPath", "sessionId", "pauseGeneration", "frameId"] {
            let mut value = scopes.clone();
            value.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugScopesRequest>(value).is_err());
        }
        let mut extra = scopes;
        extra["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugScopesRequest>(extra).is_err());

        let variables = serde_json::json!({
            "rootPath": "/workspace",
            "sessionId": 7,
            "pauseGeneration": 3,
            "frameId": 11,
            "variablesReference": 21,
            "start": 0,
            "count": 100
        });
        assert!(serde_json::from_value::<DebugVariablesRequest>(variables.clone()).is_ok());
        for missing in [
            "rootPath",
            "sessionId",
            "pauseGeneration",
            "frameId",
            "variablesReference",
            "start",
            "count",
        ] {
            let mut value = variables.clone();
            value.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<DebugVariablesRequest>(value).is_err());
        }
        let mut extra = variables;
        extra["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DebugVariablesRequest>(extra).is_err());
    }

    #[test]
    fn scope_and_variable_requests_enforce_owner_and_page_bounds() {
        let valid_scopes = DebugScopesRequest {
            root_path: "/workspace".to_string(),
            session_id: 7,
            pause_generation: 3,
            frame_id: 11,
        };
        assert!(valid_scopes.validate().is_ok());
        for invalid in [
            DebugScopesRequest {
                session_id: 0,
                ..valid_scopes.clone()
            },
            DebugScopesRequest {
                pause_generation: 0,
                ..valid_scopes.clone()
            },
            DebugScopesRequest {
                frame_id: 0,
                ..valid_scopes.clone()
            },
        ] {
            assert!(invalid.validate().is_err());
        }

        let valid = DebugVariablesRequest {
            root_path: "/workspace".to_string(),
            session_id: 7,
            pause_generation: 3,
            frame_id: 11,
            variables_reference: 21,
            start: MAX_DEBUG_VARIABLE_START,
            count: MAX_DEBUG_VARIABLE_PAGE_COUNT,
        };
        assert!(valid.validate().is_ok());
        for invalid in [
            DebugVariablesRequest {
                variables_reference: 0,
                ..valid.clone()
            },
            DebugVariablesRequest {
                start: MAX_DEBUG_VARIABLE_START + 1,
                ..valid.clone()
            },
            DebugVariablesRequest {
                count: 0,
                ..valid.clone()
            },
            DebugVariablesRequest {
                count: MAX_DEBUG_VARIABLE_PAGE_COUNT + 1,
                ..valid.clone()
            },
        ] {
            assert!(invalid.validate().is_err());
        }
    }

    #[test]
    fn variable_page_response_is_exact_and_rejects_out_of_bounds_values() {
        let request = DebugVariablePageRequest {
            pause_generation: 3,
            frame_id: 11,
            variables_reference: 21,
            start: 2,
            count: 10,
        };
        let page = bound_variable_page(
            DebugVariablePage {
                variables: vec![DebugVariableInfo {
                    name: "value".to_string(),
                    value: "1".to_string(),
                    value_type: Some("number".to_string()),
                    evaluate_name: None,
                    variables_reference: 0,
                    can_set_value: None,
                    set_expression_reference: None,
                }],
                start: 2,
                returned: 1,
                total: Some(4),
                next_start: Some(3),
                truncated: false,
            },
            request,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&page).unwrap(),
            serde_json::json!({
                "variables":[{"name":"value","value":"1","type":"number","variablesReference":0}],
                "start":2,"returned":1,"total":4,"nextStart":3,"truncated":false
            })
        );
        let mut invalid_pages = Vec::new();
        let mut invalid = page.clone();
        invalid.returned = 0;
        invalid_pages.push(invalid);
        let mut invalid = page.clone();
        invalid.total = Some(2);
        invalid_pages.push(invalid);
        let mut invalid = page.clone();
        invalid.next_start = Some(2);
        invalid_pages.push(invalid);
        let mut invalid = page.clone();
        invalid.total = Some(3);
        invalid_pages.push(invalid);
        let mut invalid = page.clone();
        invalid.next_start = None;
        invalid_pages.push(invalid);
        let mut invalid = page.clone();
        invalid.total = None;
        invalid.truncated = false;
        invalid_pages.push(invalid);
        for invalid in invalid_pages {
            assert!(bound_variable_page(invalid, request).is_err());
        }
        let mut with_evaluate_name = page.clone();
        with_evaluate_name.variables[0].evaluate_name = Some("value".to_string());
        assert_eq!(
            bound_variable_page(with_evaluate_name, request)
                .unwrap()
                .variables[0]
                .evaluate_name
                .as_deref(),
            Some("value")
        );
        let inspectable_long_name = DebugVariablePage {
            variables: vec![DebugVariableInfo {
                name: "x".repeat(MAX_DEBUG_VARIABLE_NAME_BYTES + 1),
                value: String::new(),
                value_type: None,
                evaluate_name: None,
                variables_reference: 0,
                can_set_value: None,
                set_expression_reference: None,
            }],
            start: 2,
            returned: 1,
            total: None,
            next_start: None,
            truncated: true,
        };
        assert!(bound_variable_page(inspectable_long_name.clone(), request).is_ok());
        let mut falsely_writable = inspectable_long_name;
        falsely_writable.variables[0].can_set_value = Some(true);
        assert!(bound_variable_page(falsely_writable, request).is_err());
        for evaluate_name in [
            " \t ".to_string(),
            "user\u{85}name".to_string(),
            "x".repeat(MAX_DEBUG_EVALUATE_EXPRESSION_BYTES + 1),
        ] {
            assert!(bound_variable_page(
                DebugVariablePage {
                    variables: vec![DebugVariableInfo {
                        name: "value".to_string(),
                        value: "1".to_string(),
                        value_type: None,
                        evaluate_name: Some(evaluate_name),
                        variables_reference: 0,
                        can_set_value: None,
                        set_expression_reference: None,
                    }],
                    start: 2,
                    returned: 1,
                    total: None,
                    next_start: None,
                    truncated: false,
                },
                request,
            )
            .is_err());
        }
    }

    #[test]
    fn unknown_session_operations_preserve_wire_errors() {
        let registry = DebugSessionRegistry::new();

        assert_eq!(
            stop_debug_session_blocking(&registry, 41),
            Err("No debug session with id 41.".to_string())
        );
        assert_eq!(
            with_debug_session(&registry, 42, |adapter| adapter.step(StepKind::Continue)),
            Err("No debug session with id 42.".to_string())
        );
        assert_eq!(
            with_debug_session(&registry, 43, |adapter| adapter.stack_trace()),
            Err("No debug session with id 43.".to_string())
        );
        assert_eq!(
            with_debug_session(&registry, 44, |adapter| {
                adapter.set_exception_pause(DebugExceptionPauseMode::Uncaught)
            }),
            Err("No debug session with id 44.".to_string())
        );
    }

    #[test]
    fn npm_start_errors_never_expose_configured_private_fields() {
        let private_script = "private:script";
        let private_path = "/workspace/private/package";
        let private_argument = "--token=private";
        let private_environment = "PRIVATE_TOKEN";
        let launch = DebugLaunchTarget::NodeNpmScript {
            script: private_script.to_string(),
            package_root_path: private_path.to_string(),
            args: vec![private_argument.to_string()],
            cwd: Some("/workspace/private/cwd".to_string()),
            env: HashMap::from([(private_environment.to_string(), "private-value".to_string())]),
            just_my_code: Some(crate::debug_adapter::DebugJustMyCodePolicy::NodeInternals),
        };
        let message = public_debug_start_error(
            &launch,
            format!(
                "failed {private_script} at {private_path} {private_argument} {private_environment}"
            ),
        );

        assert_eq!(
            message,
            "NPM debug configuration could not be started safely."
        );
        let wire = serde_json::to_string(&DebugStartResponse::Error {
            message: message.clone(),
        })
        .unwrap();
        for private in [
            private_script,
            private_path,
            private_argument,
            private_environment,
            "private-value",
        ] {
            assert!(!message.contains(private));
            assert!(!wire.contains(private));
        }
        assert_eq!(
            public_debug_start_error(
                &DebugLaunchTarget::NodeScript {
                    script_path: "/workspace/index.js".to_string(),
                },
                "specific non-NPM error".to_string(),
            ),
            "specific non-NPM error"
        );
    }

    #[test]
    fn node_internal_step_filter_start_errors_are_generic_on_the_public_wire() {
        let launch = DebugLaunchTarget::NodeConfiguredScript {
            script_path: "/workspace/private/server.js".to_string(),
            args: vec!["--private-token".to_string()],
            cwd: Some("/workspace/private".to_string()),
            env: HashMap::from([("PRIVATE_TOKEN".to_string(), "private-value".to_string())]),
            just_my_code: Some(crate::debug_adapter::DebugJustMyCodePolicy::NodeInternals),
        };
        let raw =
            "CDP Debugger.setBlackboxPatterns rejected ^(?:node:|internal/) at /workspace/private";
        let message = public_debug_start_error(&launch, raw.to_string());

        assert_eq!(
            message,
            "Node debug configuration could not be started safely."
        );
        let wire = serde_json::to_string(&DebugStartResponse::Error { message }).unwrap();
        for private in [
            "CDP",
            "setBlackboxPatterns",
            "node:",
            "internal/",
            "/workspace/private",
        ] {
            assert!(!wire.contains(private));
        }
    }

    #[test]
    fn finish_gate_holds_early_disconnect_until_registration_completes() {
        let gate = Arc::new(DebugFinishGate::default());
        let waiter = Arc::clone(&gate);
        let (sent, received) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            sent.send(waiter.wait_until_registered()).unwrap();
        });
        assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
        gate.complete(true);
        assert_eq!(received.recv_timeout(Duration::from_secs(1)), Ok(true));
        handle.join().unwrap();
    }
}
