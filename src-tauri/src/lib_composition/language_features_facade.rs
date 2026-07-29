use super::*;

#[tauri::command]
pub(crate) async fn language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn language_server_execute_command_locations(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_language_server_execute_command(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_language_server_execute_command_locations(
    root_path: String,
    command: LanguageServerCodeActionCommand,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerLocation>, String> {
    ensure_lsp_command_payload_paths_in_workspace(&root_path, &command)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.execute_command(&command);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_locations_to_workspace(&root_path, parse_definition_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_workspace_will_create_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_create_files(&[WorkspaceFileCreate { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_workspace_did_create_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_create_files(&[WorkspaceFileCreate { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_workspace_will_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_rename_files(&[WorkspaceFileRename { old_path, new_path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_workspace_did_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_rename_files(&[WorkspaceFileRename { old_path, new_path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) async fn javascript_typescript_workspace_will_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_delete_files(&[WorkspaceFileDelete { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_workspace_did_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_delete_files(&[WorkspaceFileDelete { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) async fn text_document_will_create_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_create_files(&[WorkspaceFileCreate { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn workspace_did_create_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_create_files(&[WorkspaceFileCreate { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) async fn text_document_will_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_rename_files(&[WorkspaceFileRename { old_path, new_path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn workspace_did_rename_files(
    root_path: String,
    old_path: String,
    new_path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &old_path)?;
    ensure_lsp_path_in_workspace(&root_path, &new_path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_rename_files(&[WorkspaceFileRename { old_path, new_path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) async fn text_document_will_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_delete_files(&[WorkspaceFileDelete { path }]);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    filter_optional_lsp_workspace_edit_to_workspace(
        &root_path,
        parse_optional_workspace_edit_result(&result)?,
    )
}

#[tauri::command]
pub(crate) fn workspace_did_delete_files(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_delete_files(&[WorkspaceFileDelete { path }]);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) fn workspace_did_change_watched_files(
    root_path: String,
    changes: Vec<WorkspaceFileChange>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    for change in &changes {
        ensure_lsp_path_in_workspace(&root_path, &change.path)?;
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_watched_files(&changes);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) fn workspace_did_change_configuration(
    root_path: String,
    settings: Value,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_configuration(settings);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_workspace_did_change_watched_files(
    root_path: String,
    changes: Vec<WorkspaceFileChange>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    for change in &changes {
        ensure_lsp_path_in_workspace(&root_path, &change.path)?;
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_watched_files(&changes);

    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

#[tauri::command]
pub(crate) fn javascript_typescript_workspace_did_change_configuration(
    root_path: String,
    settings: Value,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<(), String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_configuration(
        javascript_typescript_did_change_configuration_settings(&settings),
    );

    registry.update_server_configuration(&root_path, settings)?;
    registry.send_notification(
        &root_path,
        &JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: request.method,
            params: request.params,
        },
    )
}

pub(crate) fn javascript_typescript_did_change_configuration_settings(settings: &Value) -> Value {
    let mut language_settings = settings.clone();

    if let Some(object) = language_settings.as_object_mut() {
        object.remove("formattingOptions");
        object.remove("implicitProjectConfiguration");
    }

    let mut notification_settings = json!({
        "javascript": language_settings.clone(),
        "typescript": language_settings,
    });

    if let Some(object) = notification_settings.as_object_mut() {
        if let Some(value) = settings.get("formattingOptions") {
            object.insert("formattingOptions".to_string(), value.clone());
        }

        if let Some(value) = settings.get("implicitProjectConfiguration") {
            object.insert("implicitProjectConfiguration".to_string(), value.clone());
        }
    }

    notification_settings
}

#[tauri::command]
pub(crate) async fn text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_formatting(
    root_path: String,
    path: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting { path, options });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_on_type_formatting(
    root_path: String,
    path: String,
    position: LanguageServerPosition,
    ch: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.on_type_formatting(&TextDocumentOnTypeFormatting {
        path,
        position,
        ch,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_on_type_formatting(
    root_path: String,
    path: String,
    position: LanguageServerPosition,
    ch: String,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.on_type_formatting(&TextDocumentOnTypeFormatting {
        path,
        position,
        ch,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_range_formatting(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    options: LanguageServerFormattingOptions,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_formatting(&TextDocumentRangeFormatting {
        path,
        range,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_range_formatting(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    options: LanguageServerFormattingOptions,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerTextEdit>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_formatting(&TextDocumentRangeFormatting {
        path,
        range,
        options,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_formatting_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_inlay_hints(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerInlayHint>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.inlay_hints(&TextDocumentInlayHintRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    Ok(filter_lsp_inlay_hints_to_workspace(
        &root_path,
        parse_inlay_hints_result(&result)?,
    ))
}

#[tauri::command]
pub(crate) async fn text_document_inlay_hint_resolve(
    root_path: String,
    hint: LanguageServerInlayHint,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerInlayHint, String> {
    ensure_lsp_inlay_hint_payload_in_workspace(&root_path, &hint)?;

    if !lsp_status_supports_inlay_hint_resolve(&registry.status(&root_path)) {
        return Ok(hint);
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_inlay_hint(&hint);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(hint);
    };

    Ok(filter_lsp_inlay_hint_to_workspace(
        &root_path,
        parse_inlay_hint_result(&result)?,
    ))
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_inlay_hints(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerInlayHint>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.inlay_hints(&TextDocumentInlayHintRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    Ok(filter_lsp_inlay_hints_to_workspace(
        &root_path,
        parse_inlay_hints_result(&result)?,
    ))
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_inlay_hint_resolve(
    root_path: String,
    hint: LanguageServerInlayHint,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerInlayHint, String> {
    ensure_lsp_inlay_hint_payload_in_workspace(&root_path, &hint)?;

    if !lsp_status_supports_inlay_hint_resolve(&registry.status(&root_path)) {
        return Ok(hint);
    }

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_inlay_hint(&hint);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(hint);
    };

    Ok(filter_lsp_inlay_hint_to_workspace(
        &root_path,
        parse_inlay_hint_result(&result)?,
    ))
}

#[tauri::command]
pub(crate) async fn text_document_document_symbols(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_symbols(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_symbols_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_document_symbols(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_symbols(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_symbols_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_document_highlights(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_highlights(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_document_highlights_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_document_links(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_links(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_document_links_to_workspace(&root_path, parse_document_links_result(&result)?)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_document_links(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_links(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_document_links_to_workspace(&root_path, parse_document_links_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_document_link_resolve(
    root_path: String,
    link: LanguageServerDocumentLink,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<LanguageServerDocumentLink, String> {
    ensure_lsp_document_link_payload_in_workspace(&root_path, &link)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_document_link(&link);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(link);
    };

    let resolved = serde_json::from_value::<LanguageServerDocumentLink>(result)
        .map_err(|error| format!("Language server returned a malformed document link: {error}"))?;

    Ok(filter_lsp_document_link_to_workspace(&root_path, resolved).unwrap_or(link))
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_document_link_resolve(
    root_path: String,
    link: LanguageServerDocumentLink,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<LanguageServerDocumentLink, String> {
    ensure_lsp_document_link_payload_in_workspace(&root_path, &link)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.resolve_document_link(&link);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(link);
    };

    let resolved = serde_json::from_value::<LanguageServerDocumentLink>(result)
        .map_err(|error| format!("Language server returned a malformed document link: {error}"))?;

    Ok(filter_lsp_document_link_to_workspace(&root_path, resolved).unwrap_or(link))
}

#[tauri::command]
pub(crate) async fn text_document_folding_ranges(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerFoldingRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.folding_ranges(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_folding_ranges_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_folding_ranges(
    root_path: String,
    path: String,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerFoldingRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.folding_ranges(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_folding_ranges_result(&result)
}

#[tauri::command]
pub(crate) async fn workspace_symbols(
    root_path: String,
    query: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.workspace_symbols(&query);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    filter_lsp_workspace_symbols_to_workspace(&root_path, parse_workspace_symbols_result(&result)?)
}

#[tauri::command]
pub(crate) async fn text_document_selection_ranges(
    root_path: String,
    path: String,
    positions: Vec<LanguageServerPosition>,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Vec<LanguageServerSelectionRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.selection_ranges(&TextDocumentSelectionRange { path, positions });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_selection_ranges_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_selection_ranges(
    root_path: String,
    path: String,
    positions: Vec<LanguageServerPosition>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Vec<LanguageServerSelectionRange>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.selection_ranges(&TextDocumentSelectionRange { path, positions });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(Vec::new());
    };

    parse_selection_ranges_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_linked_editing_ranges(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.linked_editing_ranges(&position);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_linked_editing_ranges_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_semantic_tokens(
    root_path: String,
    path: String,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens(&path);
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
pub(crate) async fn text_document_range_semantic_tokens(
    root_path: String,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_semantic_tokens(&TextDocumentRange { path, range });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_semantic_tokens_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_range_semantic_tokens(
    root_path: String,
    session_id: u64,
    request_id: u64,
    path: String,
    range: LanguageServerRange,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    ensure_lsp_path_in_workspace(&root_path, &path)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.range_semantic_tokens(&TextDocumentRange { path, range });
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
pub(crate) async fn text_document_signature_help(
    root_path: String,
    position: TextDocumentPosition,
    registry: State<'_, PhpLanguageServerRegistry>,
) -> Result<Option<LanguageServerSignatureHelp>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp {
        position,
        context: None,
    });
    let Some(result) = registry
        .send_request_async(&root_path, &request.method, request.params)
        .await?
    else {
        return Ok(None);
    };

    parse_signature_help_result(&result)
}

#[tauri::command]
pub(crate) async fn javascript_typescript_text_document_signature_help(
    root_path: String,
    session_id: u64,
    request_id: u64,
    position: TextDocumentPosition,
    context: Option<LanguageServerSignatureHelpContext>,
    registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Option<LanguageServerSignatureHelp>, String> {
    ensure_lsp_position_in_workspace(&root_path, &position)?;

    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp { position, context });
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

    parse_signature_help_result(&result)
}
