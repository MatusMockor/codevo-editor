use super::diagnostic_authority::is_file_uri_in_workspace;
use super::event_sinks::{
    LanguageServerRefreshEvent, LanguageServerRefreshFeature, LanguageServerWorkspaceEditEvent,
    RefreshSink, WorkspaceEditSink,
};
use super::session_writer::SessionMessageWriter;
use super::workspace_runtime_identity::resolve_existing_or_parent_path;
use super::write_with_session_stdin;
use crate::lsp::file_uri;
use crate::lsp_features::{
    parse_workspace_edit_result, LanguageServerWorkspaceEdit, LanguageServerWorkspaceFileOperation,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(super) struct ServerWindowMessage {
    pub(super) chunk: String,
    pub(super) requires_response: bool,
}

pub(super) fn server_window_message(
    value: &Value,
    server_label: &str,
) -> Option<ServerWindowMessage> {
    let method = value.get("method").and_then(Value::as_str)?;
    let (method_label, requires_response) = match method {
        "window/logMessage" => ("logMessage", false),
        "window/showMessage" => ("showMessage", false),
        "window/showMessageRequest" => ("showMessageRequest", true),
        _ => return None,
    };
    let params = value.get("params")?;
    let message = params.get("message").and_then(Value::as_str)?;

    if message.trim().is_empty() {
        return None;
    }

    let severity = message_type_label(params.get("type").and_then(Value::as_u64));
    Some(ServerWindowMessage {
        chunk: format!("[{server_label} {method_label} {severity}] {message}\n"),
        requires_response,
    })
}

fn message_type_label(message_type: Option<u64>) -> &'static str {
    match message_type {
        Some(1) => "error",
        Some(2) => "warning",
        Some(3) => "info",
        Some(4) => "log",
        _ => "message",
    }
}

pub(super) fn respond_to_server_request(
    stdin: &Arc<SessionMessageWriter>,
    value: &Value,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    server_configuration: &Arc<Mutex<Value>>,
    workspace_root: &str,
) -> Result<(), ()> {
    let Some(id) = value.get("id").cloned() else {
        return Err(());
    };
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Err(());
    };

    let configuration = server_configuration
        .lock()
        .map(|configuration| configuration.clone())
        .unwrap_or_else(|_| json!({}));
    let result = server_request_result(
        method,
        value.get("params"),
        workspace_edit_sink,
        refresh_sink,
        session_id,
        &configuration,
        workspace_root,
    );
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    });
    let Ok(bytes) = serde_json::to_vec(&response) else {
        return Err(());
    };

    write_with_session_stdin(stdin, &bytes).map_err(|_| ())
}

fn server_request_result(
    method: &str,
    params: Option<&Value>,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    server_configuration: &Value,
    workspace_root: &str,
) -> Value {
    match method {
        "workspace/configuration" => {
            super::server_configuration::workspace_result(params, server_configuration)
        }
        "workspace/workspaceFolders" => workspace_folders_result(workspace_root),
        "workspace/applyEdit" => {
            workspace_apply_edit_result(params, workspace_edit_sink, session_id, workspace_root)
        }
        "workspace/codeLens/refresh" => refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::CodeLens,
        ),
        "workspace/inlayHint/refresh" => refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::InlayHint,
        ),
        "workspace/semanticTokens/refresh" => refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::SemanticTokens,
        ),
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/showMessageRequest" => Value::Null,
        _ => Value::Null,
    }
}

fn refresh_result(
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    feature: LanguageServerRefreshFeature,
) -> Value {
    let _ = refresh_sink.emit_refresh(LanguageServerRefreshEvent {
        session_id,
        feature,
    });
    Value::Null
}

fn workspace_folders_result(workspace_root: &str) -> Value {
    let root_path = PathBuf::from(workspace_root);
    let name = root_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(workspace_root);

    json!([{
        "uri": file_uri(&root_path),
        "name": name,
    }])
}

fn workspace_apply_edit_result(
    params: Option<&Value>,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    session_id: u64,
    workspace_root: &str,
) -> Value {
    let Some(params) = params else {
        return workspace_apply_edit_failure("Missing workspace edit parameters.");
    };
    let label = params
        .get("label")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let Some(edit_value) = params.get("edit") else {
        return workspace_apply_edit_failure("Missing workspace edit payload.");
    };

    let edit = match parse_workspace_edit_result(edit_value) {
        Ok(Some(edit)) => edit,
        Ok(None) => return workspace_apply_edit_failure("Workspace edit payload was empty."),
        Err(error) => return workspace_apply_edit_failure(&error),
    };
    if let Err(error) = ensure_workspace_edit_paths_in_workspace(workspace_root, &edit) {
        return workspace_apply_edit_failure(&error);
    }

    let applied = workspace_edit_sink.emit_workspace_edit(LanguageServerWorkspaceEditEvent {
        session_id,
        label,
        edit,
    });
    if applied {
        json!({ "applied": true })
    } else {
        workspace_apply_edit_failure("Workspace edit could not be delivered to the editor.")
    }
}

fn workspace_apply_edit_failure(reason: &str) -> Value {
    json!({
        "applied": false,
        "failureReason": reason,
    })
}

fn ensure_workspace_edit_paths_in_workspace(
    workspace_root: &str,
    edit: &LanguageServerWorkspaceEdit,
) -> Result<(), String> {
    for uri in edit.changes.keys() {
        ensure_workspace_edit_uri_in_workspace(workspace_root, uri)?;
    }
    for operation in &edit.file_operations {
        for uri in workspace_file_operation_uris(operation) {
            ensure_workspace_edit_uri_in_workspace(workspace_root, uri)?;
        }
    }
    Ok(())
}

fn workspace_file_operation_uris(operation: &LanguageServerWorkspaceFileOperation) -> Vec<&str> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, .. }
        | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => vec![uri.as_str()],
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri, new_uri, ..
        } => vec![old_uri.as_str(), new_uri.as_str()],
    }
}

fn ensure_workspace_edit_uri_in_workspace(workspace_root: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Err("Workspace edit URI must be a file URI.".to_string());
    }
    if is_file_uri_in_workspace(workspace_root, uri) {
        Ok(())
    } else {
        Err("Workspace edit path is outside the workspace root.".to_string())
    }
}

pub(super) fn workspace_guard_path(workspace_root: &str) -> Result<PathBuf, String> {
    resolve_existing_or_parent_path(Path::new(workspace_root))
        .ok_or_else(|| "Workspace root could not be resolved.".to_string())
}
