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
use crate::lsp_session::configuration_bounds::{
    serialized_size_with_limit, MAX_CONFIGURATION_RESPONSE_BYTES,
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

    let result = if method == "workspace/configuration" {
        workspace_configuration_result(value.get("params"), server_configuration)
    } else {
        server_request_result(
            method,
            value.get("params"),
            workspace_edit_sink,
            refresh_sink,
            session_id,
            workspace_root,
        )
    };
    let response = server_request_response(id, result);
    let Ok(bytes) = serde_json::to_vec(&response) else {
        return Err(());
    };

    write_with_session_stdin(stdin, &bytes).map_err(|_| ())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ServerRequestError {
    code: i64,
    message: String,
}

impl ServerRequestError {
    fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: -32603,
            message: message.into(),
        }
    }

    fn method_not_found(method: &str) -> Self {
        Self {
            code: -32601,
            message: format!("Unsupported language server request method: {method}."),
        }
    }
}

impl From<super::server_configuration::WorkspaceConfigurationError> for ServerRequestError {
    fn from(error: super::server_configuration::WorkspaceConfigurationError) -> Self {
        match error {
            super::server_configuration::WorkspaceConfigurationError::InvalidParams(message) => {
                Self::invalid_params(message)
            }
            super::server_configuration::WorkspaceConfigurationError::Internal(message) => {
                Self::internal(message)
            }
        }
    }
}

fn workspace_configuration_result(
    params: Option<&Value>,
    server_configuration: &Mutex<Value>,
) -> Result<Value, ServerRequestError> {
    super::server_configuration::validate_workspace_query(params)
        .map_err(ServerRequestError::from)?;
    let configuration = server_configuration.lock().map_err(|_| {
        ServerRequestError::internal("Language server configuration state is unavailable.")
    })?;
    super::server_configuration::workspace_result(params, &configuration)
        .map_err(ServerRequestError::from)
}

fn server_request_response(id: Value, result: Result<Value, ServerRequestError>) -> Value {
    let response = match result {
        Ok(result) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }),
        Err(error) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": error.code,
                "message": error.message,
            },
        }),
    };
    if serialized_size_with_limit(&response, MAX_CONFIGURATION_RESPONSE_BYTES).is_ok() {
        return response;
    }

    let error = json!({
        "jsonrpc": "2.0",
        "id": response.get("id").cloned().unwrap_or(Value::Null),
        "error": {
            "code": -32603,
            "message": format!(
                "Language server response exceeds {MAX_CONFIGURATION_RESPONSE_BYTES} bytes."
            ),
        },
    });
    if serialized_size_with_limit(&error, MAX_CONFIGURATION_RESPONSE_BYTES).is_ok() {
        error
    } else {
        json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": {
                "code": -32603,
                "message": format!(
                    "Language server response exceeds {MAX_CONFIGURATION_RESPONSE_BYTES} bytes."
                ),
            },
        })
    }
}

fn server_request_result(
    method: &str,
    params: Option<&Value>,
    workspace_edit_sink: &dyn WorkspaceEditSink,
    refresh_sink: &dyn RefreshSink,
    session_id: u64,
    workspace_root: &str,
) -> Result<Value, ServerRequestError> {
    match method {
        "workspace/workspaceFolders" => Ok(workspace_folders_result(workspace_root)),
        "workspace/applyEdit" => Ok(workspace_apply_edit_result(
            params,
            workspace_edit_sink,
            session_id,
            workspace_root,
        )),
        "workspace/codeLens/refresh" => Ok(refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::CodeLens,
        )),
        "workspace/inlayHint/refresh" => Ok(refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::InlayHint,
        )),
        "workspace/semanticTokens/refresh" => Ok(refresh_result(
            refresh_sink,
            session_id,
            LanguageServerRefreshFeature::SemanticTokens,
        )),
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/showMessageRequest" => Ok(Value::Null),
        _ => Err(ServerRequestError::method_not_found(method)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp_session::event_sinks::{NoopRefreshSink, NoopWorkspaceEditSink};

    #[test]
    fn invalid_workspace_configuration_query_becomes_a_truthful_json_rpc_error() {
        let result = workspace_configuration_result(
            Some(&json!({
                "items": [{
                    "section": "typescript.suggest",
                    "unknown": true,
                }],
            })),
            &Mutex::new(json!({ "suggest": {} })),
        );

        let response = server_request_response(Value::from(91), result);

        assert_eq!(response["id"], 91);
        assert_eq!(response["error"]["code"], -32602);
        assert_eq!(
            response["error"]["message"],
            "Workspace configuration item contains an unknown field."
        );
        assert!(response.get("result").is_none());
    }

    #[test]
    fn oversized_server_response_is_replaced_before_serialization() {
        let response = server_request_response(
            Value::from(92),
            Ok::<_, ServerRequestError>(json!({
                "payload": "x".repeat(MAX_CONFIGURATION_RESPONSE_BYTES),
            })),
        );

        assert_eq!(response["id"], 92);
        assert_eq!(response["error"]["code"], -32603);
        assert_eq!(
            response["error"]["message"],
            "Language server response exceeds 2097152 bytes."
        );
        assert!(response.get("result").is_none());
    }

    #[test]
    fn final_json_rpc_envelope_accepts_exact_two_mibibytes_and_rejects_n_plus_one() {
        let base = server_request_response(
            Value::from(95),
            Ok::<_, ServerRequestError>(json!({ "payload": "" })),
        );
        let base_bytes = serde_json::to_vec(&base)
            .expect("serialize base response")
            .len();
        let filler_bytes = MAX_CONFIGURATION_RESPONSE_BYTES - base_bytes;

        let exact = server_request_response(
            Value::from(95),
            Ok::<_, ServerRequestError>(json!({
                "payload": "x".repeat(filler_bytes),
            })),
        );
        assert_eq!(
            serde_json::to_vec(&exact)
                .expect("serialize exact response")
                .len(),
            MAX_CONFIGURATION_RESPONSE_BYTES
        );
        assert!(exact.get("result").is_some());

        let overflow = server_request_response(
            Value::from(95),
            Ok::<_, ServerRequestError>(json!({
                "payload": "x".repeat(filler_bytes + 1),
            })),
        );
        assert_eq!(overflow["id"], 95);
        assert_eq!(overflow["error"]["code"], -32603);
        assert!(overflow.get("result").is_none());
    }

    #[test]
    fn response_amplification_is_an_internal_error_and_keeps_the_request_id() {
        let large = "x".repeat(16 * 1024);
        let result = workspace_configuration_result(
            Some(&json!({
                "items": (0..9)
                    .map(|_| json!({ "section": "typescript" }))
                    .collect::<Vec<_>>(),
            })),
            &Mutex::new(json!({
                "payload": (0..15).map(|_| large.clone()).collect::<Vec<_>>(),
            })),
        );

        let response = server_request_response(Value::from(93), result);

        assert_eq!(response["id"], 93);
        assert_eq!(response["error"]["code"], -32603);
        assert_eq!(
            response["error"]["message"],
            "Workspace configuration response exceeds 2097152 bytes."
        );
    }

    #[test]
    fn unknown_server_request_method_is_rejected_truthfully() {
        let result = server_request_result(
            "workspace/unknown",
            None,
            &NoopWorkspaceEditSink,
            &NoopRefreshSink,
            7,
            "/tmp/workspace",
        );

        let response = server_request_response(Value::from(94), result);

        assert_eq!(response["id"], 94);
        assert_eq!(response["error"]["code"], -32601);
        assert_eq!(
            response["error"]["message"],
            "Unsupported language server request method: workspace/unknown."
        );
    }

    #[test]
    fn poisoned_configuration_state_is_a_correlated_internal_error() {
        let configuration = Mutex::new(json!({}));
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = configuration.lock().expect("configuration");
            panic!("poison configuration");
        }));
        assert!(poisoned.is_err());

        let result = workspace_configuration_result(Some(&json!({ "items": [] })), &configuration);
        let response = server_request_response(Value::from(96), result);

        assert_eq!(response["id"], 96);
        assert_eq!(response["error"]["code"], -32603);
        assert_eq!(
            response["error"]["message"],
            "Language server configuration state is unavailable."
        );
    }
}
