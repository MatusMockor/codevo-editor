use super::workspace_facade::{
    canonicalize_workspace_root, ensure_lsp_call_hierarchy_item_in_workspace,
    ensure_lsp_code_action_context_payloads_in_workspace,
    ensure_lsp_code_action_payload_in_workspace, ensure_lsp_code_lens_payload_in_workspace,
    ensure_lsp_completion_item_payload_in_workspace, ensure_lsp_path_in_workspace,
    ensure_lsp_position_in_workspace, ensure_lsp_text_document_content_in_workspace,
    ensure_lsp_text_document_path_in_workspace, ensure_lsp_type_hierarchy_item_in_workspace,
    filter_bounded_lsp_locations_to_workspace, filter_lsp_call_hierarchy_items_to_workspace,
    filter_lsp_code_action_to_workspace, filter_lsp_code_actions_to_workspace,
    filter_lsp_code_lens_to_workspace, filter_lsp_code_lenses_to_workspace,
    filter_lsp_completion_item_to_workspace, filter_lsp_completion_list_to_workspace,
    filter_lsp_incoming_calls_to_workspace, filter_lsp_locations_to_workspace,
    filter_lsp_outgoing_calls_to_workspace, filter_lsp_type_hierarchy_items_to_workspace,
    filter_optional_lsp_workspace_edit_to_workspace, reveal_path_in_workspace,
    workspace_root_for_disposal,
};
use super::workspace_services::{
    build_php_language_server_plan, JavaScriptTypeScriptLanguageServerRequest,
};
use crate::blocking_command::run_blocking_command;
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::lsp::{JsonRpcRequest, LanguageServerCommand, LanguageServerPlanStatus};
use crate::lsp_capability_support::supports_code_action_resolve as lsp_status_supports_code_action_resolve;
use crate::lsp_document::{
    LspTextDocumentSyncNotificationFactory, TextDocumentContent, TextDocumentPath,
    TextDocumentSyncNotificationFactory,
};
use crate::lsp_features::{
    parse_bounded_reference_locations_result, parse_call_hierarchy_items_result,
    parse_code_action_result, parse_completion_item_result, parse_completion_result,
    parse_definition_result, parse_hover_result, parse_incoming_calls_result,
    parse_outgoing_calls_result, parse_prepare_rename_result, parse_type_hierarchy_items_result,
    parse_workspace_edit_result, BoundedLanguageServerLocations, LanguageServerCallHierarchyItem,
    LanguageServerCodeAction, LanguageServerCodeActionContext, LanguageServerCodeLens,
    LanguageServerCompletionContext, LanguageServerCompletionItem, LanguageServerCompletionList,
    LanguageServerHover, LanguageServerIncomingCall, LanguageServerLocation,
    LanguageServerOutgoingCall, LanguageServerPrepareRenameResult, LanguageServerRange,
    LanguageServerTypeHierarchyItem, LanguageServerWorkspaceEdit,
    LspTextDocumentFeatureRequestFactory, TextDocumentCompletion,
    TextDocumentFeatureRequestFactory, TextDocumentPosition, TextDocumentRange, TextDocumentRename,
};
use crate::lsp_incremental_document::DocumentChangeAdmissionRegistry;
use crate::lsp_session::{
    language_server_status_payload, AppHandleEventSink, ChildServerProcessSpawner, DiagnosticsSink,
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRequestError,
    LanguageServerRuntimeStatus, PhpLanguageServerRegistry, RefreshSink, RestartController,
    StatusSink, WorkspaceEditSink,
};
use crate::managed_javascript_typescript;
use crate::managed_phpactor;
use crate::runtime_observability;
use crate::smart_mode::{IntelligenceMode, SmartModeService, SmartModeState};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use crate::workspace_typescript::{
    build_javascript_typescript_language_server_plan_with_trust,
    capture_javascript_typescript_workspace_trust,
    revalidate_javascript_typescript_workspace_trust,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub(crate) fn set_smart_mode(
    root_path: String,
    mode: IntelligenceMode,
    service: State<'_, Mutex<SmartModeService>>,
    app: AppHandle,
) -> Result<SmartModeState, String> {
    let root = workspace_root_for_disposal(&root_path);
    let root_key = root.to_string_lossy();
    let disables_indexing = matches!(mode, IntelligenceMode::Basic);

    if disables_indexing {
        if let Some(index_lifecycle) = app.try_state::<WorkspaceIndexLifecycle>() {
            index_lifecycle.cancel_workspace(&root_key);
        }
    }

    let mut service = service.lock().map_err(|error| error.to_string())?;
    Ok(service.set_mode(&root_key, mode))
}

pub(crate) fn registered_runtime_root(registry: &WorkspaceRegistry, root_path: &str) -> PathBuf {
    registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map(|descriptor| descriptor.canonical_root_path)
        .unwrap_or_else(|_| workspace_root_for_disposal(root_path))
}

#[tauri::command]
pub(crate) fn get_php_language_server_status(
    root_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.status(&root_path),
    ))
}

#[tauri::command]
pub(crate) fn get_javascript_typescript_language_server_status(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.status(&root_path),
    ))
}

/// Stop a single managed runtime for the active workspace root. Isolation: only
/// the registry keyed to `root_path` and `kind` is touched.
#[tauri::command]
pub(crate) fn stop_language_runtime(
    root_path: String,
    kind: String,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
) -> Result<Value, String> {
    let runtime_kind = runtime_observability::LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;

    let status = match runtime_kind {
        runtime_observability::LanguageRuntimeKind::Phpactor => {
            php_registry.stop_preserving_launch_context(&root_path)
        }
        runtime_observability::LanguageRuntimeKind::Tsserver => {
            watch_registry.stop(&root_path);
            javascript_typescript_registry.stop_preserving_launch_context(&root_path)
        }
    };

    Ok(language_server_status_payload(&root_path, status))
}

/// Restart a single managed runtime for the active workspace root, reusing the
/// launch command last used for that root. The blocking re-spawn (handshake can
/// take seconds) runs off the Tauri main thread via `spawn_blocking`; the owned
/// `AppHandle` re-resolves the managed registry inside the worker so nothing
/// borrows command state across the await. Isolation: only the registry keyed to
/// `root_path` and `kind` is touched.
#[tauri::command]
pub(crate) async fn restart_language_runtime(
    root_path: String,
    kind: String,
    app: AppHandle,
) -> Result<Value, String> {
    let runtime_kind = runtime_observability::LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;

    match runtime_kind {
        runtime_observability::LanguageRuntimeKind::Phpactor => {
            restart_php_runtime_off_thread(app, root_path).await
        }
        runtime_observability::LanguageRuntimeKind::Tsserver => {
            restart_typescript_runtime_off_thread(app, root_path).await
        }
    }
}

pub(crate) async fn restart_php_runtime_off_thread(
    app: AppHandle,
    root_path: String,
) -> Result<Value, String> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let event_sink = Arc::new(AppHandleEventSink::for_workspace(
            app.clone(),
            root_path.clone(),
        ));
        let status_sink: Arc<dyn StatusSink> = event_sink.clone();
        let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
        let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
        let refresh_sink: Arc<dyn RefreshSink> = event_sink;
        let registry = app.state::<PhpLanguageServerRegistry>();

        registry
            .restart_with_auto_restart(
                &root_path,
                Arc::new(ChildServerProcessSpawner),
                status_sink,
                diagnostics_sink,
                workspace_edit_sink,
                refresh_sink,
                Arc::new(RestartController::default()),
            )
            .map(|status| language_server_status_payload(&root_path, status))
    })
    .await
    .map_err(|error| format!("Restart task failed: {error}"))??;

    Ok(status)
}

pub(crate) async fn restart_typescript_runtime_off_thread(
    app: AppHandle,
    root_path: String,
) -> Result<Value, String> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let event_sink = Arc::new(AppHandleEventSink::javascript_typescript_for_workspace(
            app.clone(),
            root_path.clone(),
        )?);
        let status_sink: Arc<dyn StatusSink> = event_sink.clone();
        let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
        let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
        let refresh_sink: Arc<dyn RefreshSink> = event_sink;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();

        let status = registry.restart_with_auto_restart(
            &root_path,
            Arc::new(ChildServerProcessSpawner),
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            Arc::new(RestartController::default()),
        )?;

        if matches!(status, LanguageServerRuntimeStatus::Running { .. }) {
            let watch_registry = app.state::<JavaScriptTypeScriptWorkspaceWatchRegistry>();
            let _ = watch_registry.start(&root_path, app.clone());
        }

        Ok::<Value, String>(language_server_status_payload(&root_path, status))
    })
    .await
    .map_err(|error| format!("Restart task failed: {error}"))??;

    Ok(status)
}

#[tauri::command]
pub(crate) fn reveal_item_in_dir(
    root_path: String,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let target = reveal_path_in_workspace(&root_path, &path)?;

    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|error| format!("Failed to reveal item: {error}"))
}

#[tauri::command]
pub(crate) fn start_php_language_server(
    root_path: String,
    php_backend: Option<String>,
    phpactor_path: Option<String>,
    intelephense_path: Option<String>,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    let plan = build_php_language_server_plan(
        &root_path,
        &trust,
        php_backend.as_deref(),
        phpactor_path.as_deref(),
        intelephense_path.as_deref(),
    )?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }

    let command: LanguageServerCommand = plan
        .command
        .ok_or_else(|| "Language server plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or_else(|| "Language server plan is missing an initialize request.".to_string())?;
    #[cfg(unix)]
    if !matches!(
        registry.status(&root_path),
        LanguageServerRuntimeStatus::Starting { .. } | LanguageServerRuntimeStatus::Running { .. }
    ) {
        managed_phpactor::cleanup_orphaned_managed_phpactor_processes(
            &command,
            &root_path,
            &registry.running_roots(),
        );
    }

    let event_sink = Arc::new(AppHandleEventSink::for_workspace(app, root_path.clone()));
    let status_sink: Arc<dyn StatusSink> = event_sink.clone();
    let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
    let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
    let refresh_sink: Arc<dyn RefreshSink> = event_sink;

    let status = registry.start_with_auto_restart(
        &root_path,
        &command,
        &initialize_request,
        Arc::new(ChildServerProcessSpawner),
        status_sink,
        diagnostics_sink,
        workspace_edit_sink,
        refresh_sink,
        Arc::new(RestartController::default()),
    )?;

    Ok(language_server_status_payload(&root_path, status))
}

#[tauri::command]
pub(crate) async fn start_javascript_typescript_language_server(
    request: JavaScriptTypeScriptLanguageServerRequest,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
    admission: State<'_, DocumentChangeAdmissionRegistry>,
) -> Result<Value, String> {
    let options = request.0;
    let root_path = options.root_path.clone();
    let trust_authority = capture_javascript_typescript_workspace_trust(&trust, &root_path)?;
    let trusted = trust_authority.trusted;
    let plan = run_blocking_command(move || {
        build_javascript_typescript_language_server_plan_with_trust(trusted, &options)
    })
    .await?;
    revalidate_javascript_typescript_workspace_trust(&trust, &trust_authority)?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }
    admission.purge_root(&canonicalize_workspace_root(&root_path)?.to_string_lossy())?;

    let command: LanguageServerCommand = plan
        .command
        .ok_or("Language server plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or("Language server plan is missing an initialize request.".to_string())?;
    let watch_app = app.clone();
    let blocking_root_path = root_path.clone();
    let blocking_trust_authority = trust_authority.clone();
    let status = run_blocking_command(move || {
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        revalidate_javascript_typescript_workspace_trust(&trust, &blocking_trust_authority)?;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();
        let event_sink = Arc::new(AppHandleEventSink::javascript_typescript_for_workspace(
            app.clone(),
            blocking_root_path.clone(),
        )?);
        let status_sink: Arc<dyn StatusSink> = event_sink.clone();
        let diagnostics_sink: Arc<dyn DiagnosticsSink> = event_sink.clone();
        let workspace_edit_sink: Arc<dyn WorkspaceEditSink> = event_sink.clone();
        let refresh_sink: Arc<dyn RefreshSink> = event_sink;
        let start_cleanup_lease =
            registry.reserve_start_cleanup(&blocking_root_path, status_sink.as_ref())?;
        #[cfg(unix)]
        {
            let running_roots = start_cleanup_lease.running_roots()?;
            revalidate_javascript_typescript_workspace_trust(&trust, &blocking_trust_authority)?;
            managed_javascript_typescript::cleanup_orphaned_javascript_typescript_processes(
                &command,
                &initialize_request,
                &blocking_root_path,
                &running_roots,
            );
        }
        revalidate_javascript_typescript_workspace_trust(&trust, &blocking_trust_authority)?;
        start_cleanup_lease.start_with_auto_restart(
            &command,
            &initialize_request,
            Arc::new(ChildServerProcessSpawner),
            status_sink,
            diagnostics_sink,
            workspace_edit_sink,
            refresh_sink,
            Arc::new(RestartController::default()),
        )
    })
    .await?;

    if matches!(status, LanguageServerRuntimeStatus::Running { .. }) {
        if let Err(error) =
            revalidate_javascript_typescript_workspace_trust(&trust, &trust_authority)
        {
            registry.stop(&root_path);
            return Err(error);
        }
        let _ = watch_registry.start(&root_path, watch_app);
    }

    Ok(language_server_status_payload(&root_path, status))
}

#[tauri::command]
pub(crate) fn stop_php_language_server(
    root_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Value, String> {
    Ok(language_server_status_payload(
        &root_path,
        registry.stop(&root_path),
    ))
}

#[tauri::command]
pub(crate) fn stop_javascript_typescript_language_server(
    root_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
    admission: State<'_, DocumentChangeAdmissionRegistry>,
) -> Result<Value, String> {
    watch_registry.stop(&root_path);
    admission.purge_root(&workspace_root_for_disposal(&root_path).to_string_lossy())?;
    Ok(language_server_status_payload(
        &root_path,
        registry.stop(&root_path),
    ))
}

#[tauri::command]
pub(crate) fn stop_all_php_language_servers(
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    Ok(registry.stop_all())
}

#[tauri::command]
pub(crate) fn stop_all_javascript_typescript_language_servers(
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
    watch_registry: State<'_, JavaScriptTypeScriptWorkspaceWatchRegistry>,
    admission: State<'_, DocumentChangeAdmissionRegistry>,
) -> Result<LanguageServerRuntimeStatus, String> {
    watch_registry.stop_all();
    admission.purge_all()?;
    Ok(registry.stop_all())
}

#[tauri::command]
pub(crate) fn text_document_did_open(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_open(&document),
    )
}

#[tauri::command]
pub(crate) fn text_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_change(&document),
    )
}

#[tauri::command]
pub(crate) fn text_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_save(&document),
    )
}

#[tauri::command]
pub(crate) fn text_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    expected_session_id: u64,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_path_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_close(&document),
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_document_did_open(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_open(&document),
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_document_did_change(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_change(&document),
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_document_did_save(
    root_path: String,
    document: TextDocumentContent,
    expected_session_id: u64,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_content_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_save(&document),
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_document_did_close(
    root_path: String,
    document: TextDocumentPath,
    expected_session_id: u64,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_text_document_path_in_workspace(&root_path, &document)?;

    let factory = LspTextDocumentSyncNotificationFactory;
    registry.send_notification_for_session(
        &root_path,
        expected_session_id,
        &factory.did_close(&document),
    )
}

pub(super) async fn send_php_request_with_optional_id(
    registry: &PhpLanguageServerRegistry,
    root_path: &str,
    session_id: Option<u64>,
    request_id: Option<u64>,
    method: &str,
    params: Value,
) -> Result<Option<Value>, String> {
    match (session_id, request_id) {
        (Some(session_id), Some(request_id)) => {
            registry
                .send_request_async_with_id(root_path, session_id, request_id, method, params)
                .await
        }
        (None, None) => registry.send_request_async(root_path, method, params).await,
        _ => Err(
            "Language-server request sessionId and requestId must be provided together."
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod identified_php_request_tests {
    use super::*;

    #[test]
    fn optional_request_identifiers_must_be_supplied_as_an_exact_pair() {
        let registry = PhpLanguageServerRegistry::new();

        for (session_id, request_id) in [(Some(7), None), (None, Some(9))] {
            let error = tauri::async_runtime::block_on(send_php_request_with_optional_id(
                &registry,
                "/tmp/workspace",
                session_id,
                request_id,
                "textDocument/hover",
                Value::Null,
            ))
            .expect_err("partial request authority must fail before dispatch");

            assert_eq!(
                error,
                "Language-server request sessionId and requestId must be provided together."
            );
        }
    }
}

#[tauri::command]
pub(crate) async fn text_document_hover(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_hover(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerHover>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position);
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(None);
    };

    parse_hover_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_completion(
    root_path: String,
    position: TextDocumentPosition,
    context: Option<LanguageServerCompletionContext>,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&TextDocumentCompletion { position, context });
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    filter_lsp_completion_list_to_workspace(&root_path, parse_completion_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_completion(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    context: Option<LanguageServerCompletionContext>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCompletionList, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.completion(&TextDocumentCompletion { position, context });
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: Vec::new(),
        });
    };

    filter_lsp_completion_list_to_workspace(&root_path, parse_completion_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_completion_resolve(
    root_path: String,
    item: LanguageServerCompletionItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCompletionItem, String> {
    ensure_lsp_completion_item_payload_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_completion_item(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(item);
    };

    parse_completion_item_result(&result)
        .map(|item| filter_lsp_completion_item_to_workspace(&root_path, item))
        .map_err(|error| format!("Language server returned a malformed completion item: {error}"))
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_completion_resolve(
    root_path: String,
    session_id: u64,
    request_id: u64,
    item: LanguageServerCompletionItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCompletionItem, String> {
    ensure_lsp_completion_item_payload_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_completion_item(&item);
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(item);
    };

    parse_completion_item_result(&result)
        .map(|item| filter_lsp_completion_item_to_workspace(&root_path, item))
        .map_err(|error| format!("Language server returned a malformed completion item: {error}"))
}

#[tauri::command]
pub(crate) async fn text_document_definition(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.definition(&position);
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_declaration(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.declaration(&position);
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_implementation(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position);
    let result = match send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    {
        Some(result) => result,
        None => return Ok(Vec::new()),
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_type_definition(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_definition(&position);
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_references(
    root_path: String,
    position: TextDocumentPosition,
    session_id: Option<u64>,
    request_id: Option<u64>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<BoundedLanguageServerLocations, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position, true);
    let Some(result) = send_php_request_with_optional_id(
        &registry,
        &root_path,
        session_id,
        request_id,
        &request.method,
        request.params,
    )
    .await?
    else {
        return parse_bounded_reference_locations_result(&serde_json::Value::Null);
    };

    filter_bounded_lsp_locations_to_workspace(
        &root_path,
        parse_bounded_reference_locations_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn text_document_prepare_rename(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_rename(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_prepare_rename_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_prepare_rename(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_rename(&position);
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(None);
    };

    parse_prepare_rename_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_rename(
    root_path: String,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_rename(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    new_name: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        character: position.character,
        line: position.line,
        new_name,
        path: position.path,
    });
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn text_document_code_actions(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, LanguageServerRequestError> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;
    ensure_lsp_code_action_context_payloads_in_workspace(&root_path, &context)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry
        .send_request_async_preserving_response_error(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    Ok(filter_lsp_code_actions_to_workspace(
        &root_path,
        parse_code_action_result(&result)?,
    )?)
}

#[tauri::command]
pub(crate) async fn text_document_code_action_resolve(
    root_path: String,
    action: LanguageServerCodeAction,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, String> {
    ensure_lsp_code_action_payload_in_workspace(&root_path, &action)?;

    if !lsp_status_supports_code_action_resolve(&registry.status(&root_path)) {
        return Ok(action);
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_action(&action);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(action);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeAction>(result)
        .map_err(|error| format!("Language server returned a malformed code action: {error}"))?;

    Ok(filter_lsp_code_action_to_workspace(&root_path, resolved)?.unwrap_or(action))
}

#[tauri::command]
pub(crate) async fn text_document_code_lenses(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_lenses(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    let lenses = serde_json::from_value::<Vec<LanguageServerCodeLens>>(result)
        .map_err(|error| format!("Language server returned malformed code lenses: {error}"))?;

    filter_lsp_code_lenses_to_workspace(&root_path, lenses)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_code_lenses(
    root_path: String,
    session_id: u64,
    request_id: u64,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeLens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_lenses(&path);
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(Vec::new());
    };

    let lenses = serde_json::from_value::<Vec<LanguageServerCodeLens>>(result)
        .map_err(|error| format!("Language server returned malformed code lenses: {error}"))?;

    filter_lsp_code_lenses_to_workspace(&root_path, lenses)
}

#[tauri::command]
pub(crate) async fn text_document_code_lens_resolve(
    root_path: String,
    lens: LanguageServerCodeLens,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerCodeLens, String> {
    ensure_lsp_code_lens_payload_in_workspace(&root_path, &lens)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_lens(&lens);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(lens);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeLens>(result)
        .map_err(|error| format!("Language server returned a malformed code lens: {error}"))?;

    Ok(filter_lsp_code_lens_to_workspace(&root_path, resolved).unwrap_or(lens))
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_code_lens_resolve(
    root_path: String,
    session_id: u64,
    request_id: u64,
    lens: LanguageServerCodeLens,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCodeLens, String> {
    ensure_lsp_code_lens_payload_in_workspace(&root_path, &lens)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_code_lens(&lens);
    let Some(result) = registry
        .send_request_async_with_id(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(lens);
    };

    let resolved = serde_json::from_value::<LanguageServerCodeLens>(result)
        .map_err(|error| format!("Language server returned a malformed code lens: {error}"))?;

    Ok(filter_lsp_code_lens_to_workspace(&root_path, resolved).unwrap_or(lens))
}

#[tauri::command]
pub(crate) async fn text_document_prepare_call_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_call_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_call_hierarchy_items_to_workspace(
        &root_path,
        parse_call_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_prepare_call_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_call_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_call_hierarchy_items_to_workspace(
        &root_path,
        parse_call_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn text_document_incoming_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.incoming_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_incoming_calls_to_workspace(&root_path, parse_incoming_calls_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_incoming_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.incoming_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_incoming_calls_to_workspace(&root_path, parse_incoming_calls_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_outgoing_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.outgoing_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_outgoing_calls_to_workspace(&root_path, parse_outgoing_calls_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_outgoing_calls(
    root_path: String,
    item: LanguageServerCallHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    ensure_lsp_call_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.outgoing_calls(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_outgoing_calls_to_workspace(&root_path, parse_outgoing_calls_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_prepare_type_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_type_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_prepare_type_hierarchy(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_type_hierarchy(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn text_document_type_hierarchy_supertypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_supertypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_type_hierarchy_supertypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_supertypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn text_document_type_hierarchy_subtypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_subtypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_type_hierarchy_subtypes(
    root_path: String,
    item: LanguageServerTypeHierarchyItem,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    ensure_lsp_type_hierarchy_item_in_workspace(&root_path, &item)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_hierarchy_subtypes(&item);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_type_hierarchy_items_to_workspace(
        &root_path,
        parse_type_hierarchy_items_result(&result)?,
    )
}
