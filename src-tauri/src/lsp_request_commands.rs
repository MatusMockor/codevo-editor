use super::*;
use crate::lsp_features::{
    parse_bounded_reference_locations_result, BoundedLanguageServerLocations,
};
use serde::Deserialize;

const MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub(super) enum LanguageServerRequestServerKind {
    #[serde(rename = "php")]
    Php,
    #[serde(rename = "javascriptTypeScript")]
    JavaScriptTypeScript,
}

fn resolved_request_server_kind(
    server_kind: Option<LanguageServerRequestServerKind>,
) -> LanguageServerRequestServerKind {
    server_kind.unwrap_or(LanguageServerRequestServerKind::JavaScriptTypeScript)
}

fn cancel_request_for_server_kind(
    server_kind: Option<LanguageServerRequestServerKind>,
    cancel_php: impl FnOnce() -> Result<(), String>,
    cancel_javascript_typescript: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    match resolved_request_server_kind(server_kind) {
        LanguageServerRequestServerKind::Php => cancel_php(),
        LanguageServerRequestServerKind::JavaScriptTypeScript => cancel_javascript_typescript(),
    }
}

#[tauri::command]
pub(super) async fn javascript_typescript_workspace_symbols(
    root_path: String,
    session_id: u64,
    request_id: u64,
    query: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, LanguageServerRequestError> {
    validate_workspace_symbol_query(&query)?;
    let request = LspTextDocumentFeatureRequestFactory.workspace_symbols(&query);
    let Some(result) = registry
        .send_request_async_with_id_preserving_response_error(
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

    Ok(filter_lsp_workspace_symbols_to_workspace(
        &root_path,
        parse_workspace_symbols_result(&result)?,
    )?)
}

fn validate_workspace_symbol_query(query: &str) -> Result<(), String> {
    if query.len() > MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES {
        return Err(format!(
            "Workspace symbol query exceeds {MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES} UTF-8 bytes."
        ));
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_code_actions(
    root_path: String,
    session_id: u64,
    request_id: u64,
    path: String,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerCodeAction>, LanguageServerRequestError> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;
    validate_code_action_request_range(&range)?;
    validate_code_action_context(&context)?;
    ensure_lsp_code_action_context_payloads_in_workspace(&root_path, &context)?;

    let request = LspTextDocumentFeatureRequestFactory
        .code_actions(&TextDocumentRange { path, range }, &context);
    let Some(result) = registry
        .send_request_async_with_id_preserving_response_error(
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

    Ok(filter_lsp_code_actions_to_workspace(
        &root_path,
        parse_code_action_result(&result)?,
    )?)
}

#[cfg(test)]
mod workspace_symbol_tests {
    use super::*;

    #[test]
    fn workspace_symbol_query_accepts_exact_utf8_boundary_and_rejects_overflow() {
        assert!(validate_workspace_symbol_query(
            &"😀".repeat(MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES / 4)
        )
        .is_ok());
        assert!(validate_workspace_symbol_query(
            &"😀".repeat(MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES / 4 + 1)
        )
        .is_err());
    }
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_code_action_resolve(
    root_path: String,
    session_id: u64,
    request_id: u64,
    action: LanguageServerCodeAction,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerCodeAction, LanguageServerRequestError> {
    validate_code_action_resolve_request(&action)?;
    ensure_lsp_code_action_payload_in_workspace(&root_path, &action)?;

    if !lsp_status_supports_code_action_resolve(&registry.status(&root_path)) {
        return Ok(action);
    }

    let request = LspTextDocumentFeatureRequestFactory.resolve_code_action(&action);
    let Some(result) = registry
        .send_request_async_with_id_preserving_response_error(
            &root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(action);
    };

    let resolved = parse_resolved_code_action_result(&result)?;
    Ok(filter_lsp_code_action_to_workspace(&root_path, resolved)?.unwrap_or(action))
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_linked_editing_ranges(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let request = LspTextDocumentFeatureRequestFactory.linked_editing_ranges(&position);
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

    parse_linked_editing_ranges_result(&result)
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_document_highlights(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let request = LspTextDocumentFeatureRequestFactory.document_highlights(&position);
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

    parse_document_highlights_result(&result)
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_semantic_tokens(
    root_path: String,
    session_id: u64,
    request_id: u64,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens(&path);
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

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
pub(super) async fn cancel_lsp_request(
    root_path: String,
    session_id: u64,
    request_id: u64,
    server_kind: Option<LanguageServerRequestServerKind>,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    cancel_request_for_server_kind(
        server_kind,
        || php_registry.cancel_request(&root_path, session_id, request_id),
        || javascript_typescript_registry.cancel_request(&root_path, session_id, request_id),
    )
}

#[cfg(test)]
mod cancellation_command_tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn cancellation_kind_is_closed_and_legacy_calls_keep_javascript_typescript_routing() {
        assert_eq!(
            resolved_request_server_kind(None),
            LanguageServerRequestServerKind::JavaScriptTypeScript
        );
        assert_eq!(
            serde_json::from_value::<LanguageServerRequestServerKind>(serde_json::json!("php"))
                .unwrap(),
            LanguageServerRequestServerKind::Php
        );
        assert_eq!(
            serde_json::from_value::<LanguageServerRequestServerKind>(serde_json::json!(
                "javascriptTypeScript"
            ))
            .unwrap(),
            LanguageServerRequestServerKind::JavaScriptTypeScript
        );
        assert!(
            serde_json::from_value::<LanguageServerRequestServerKind>(serde_json::json!("unknown"))
                .is_err()
        );
    }

    #[test]
    fn explicit_php_cancellation_dispatches_only_to_the_php_registry_branch() {
        let php_cancellations = Cell::new(0);
        let javascript_typescript_cancellations = Cell::new(0);

        cancel_request_for_server_kind(
            Some(LanguageServerRequestServerKind::Php),
            || {
                php_cancellations.set(php_cancellations.get() + 1);
                Ok(())
            },
            || {
                javascript_typescript_cancellations
                    .set(javascript_typescript_cancellations.get() + 1);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(php_cancellations.get(), 1);
        assert_eq!(javascript_typescript_cancellations.get(), 0);
    }
}

async fn navigation_locations_request(
    root_path: &str,
    session_id: u64,
    request_id: u64,
    request: crate::lsp_features::LanguageServerFeatureRequest,
    registry: &JavaScriptTypeScriptLanguageServerRegistry,
) -> Result<Vec<LanguageServerLocation>, String> {
    let Some(result) = registry
        .send_request_async_with_id(
            root_path,
            session_id,
            request_id,
            &request.method,
            request.params,
        )
        .await?
    else {
        return Ok(Vec::new());
    };
    parse_javascript_typescript_navigation_locations_result(&result)
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_definition(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.definition(&position);
    navigation_locations_request(&root_path, session_id, request_id, request, &registry).await
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_declaration(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.declaration(&position);
    navigation_locations_request(&root_path, session_id, request_id, request, &registry).await
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_source_definition(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.typescript_source_definition(&position);
    navigation_locations_request(&root_path, session_id, request_id, request, &registry).await
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_implementation(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.implementation(&position);
    navigation_locations_request(&root_path, session_id, request_id, request, &registry).await
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_type_definition(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.type_definition(&position);
    navigation_locations_request(&root_path, session_id, request_id, request, &registry).await
}

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_references(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<BoundedLanguageServerLocations, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;
    let request = LspTextDocumentFeatureRequestFactory.references(&position);
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
        return parse_bounded_reference_locations_result(&serde_json::Value::Null);
    };
    filter_bounded_lsp_locations_to_workspace(
        &root_path,
        parse_bounded_reference_locations_result(&result)?,
    )
}
