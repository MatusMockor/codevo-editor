use super::*;

#[tauri::command]
pub(super) async fn javascript_typescript_text_document_semantic_tokens(
    root_path: String,
    request_id: u64,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens(&path);
    let Some(result) = registry
        .send_request_async_with_id(&root_path, request_id, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
pub(super) fn cancel_lsp_request(
    root_path: String,
    request_id: u64,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) {
    registry.cancel_request(&root_path, request_id);
}
