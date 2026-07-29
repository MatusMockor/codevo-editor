use super::*;

pub trait TextDocumentFeatureRequestFactory {
    fn hover(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn completion(&self, completion: &TextDocumentCompletion) -> LanguageServerFeatureRequest;
    fn resolve_completion_item(
        &self,
        item: &LanguageServerCompletionItem,
    ) -> LanguageServerFeatureRequest;
    fn definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn declaration(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn document_highlights(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn document_links(&self, path: &str) -> LanguageServerFeatureRequest;
    fn resolve_document_link(
        &self,
        link: &LanguageServerDocumentLink,
    ) -> LanguageServerFeatureRequest;
    fn folding_ranges(&self, path: &str) -> LanguageServerFeatureRequest;
    fn document_symbols(&self, path: &str) -> LanguageServerFeatureRequest;
    fn workspace_symbols(&self, query: &str) -> LanguageServerFeatureRequest;
    fn implementation(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn type_definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn references(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn selection_ranges(&self, range: &TextDocumentSelectionRange) -> LanguageServerFeatureRequest;
    fn linked_editing_ranges(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest;
    fn semantic_tokens(&self, path: &str) -> LanguageServerFeatureRequest;
    fn range_semantic_tokens(&self, range: &TextDocumentRange) -> LanguageServerFeatureRequest;
    fn signature_help(
        &self,
        signature_help: &TextDocumentSignatureHelp,
    ) -> LanguageServerFeatureRequest;
    fn prepare_rename(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn rename(&self, rename: &TextDocumentRename) -> LanguageServerFeatureRequest;
    fn code_actions(
        &self,
        range: &TextDocumentRange,
        context: &LanguageServerCodeActionContext,
    ) -> LanguageServerFeatureRequest;
    fn formatting(&self, formatting: &TextDocumentFormatting) -> LanguageServerFeatureRequest;
    fn on_type_formatting(
        &self,
        formatting: &TextDocumentOnTypeFormatting,
    ) -> LanguageServerFeatureRequest;
    fn range_formatting(
        &self,
        formatting: &TextDocumentRangeFormatting,
    ) -> LanguageServerFeatureRequest;
    fn inlay_hints(&self, range: &TextDocumentInlayHintRange) -> LanguageServerFeatureRequest;
    fn resolve_inlay_hint(&self, hint: &LanguageServerInlayHint) -> LanguageServerFeatureRequest;
    fn resolve_code_action(
        &self,
        action: &LanguageServerCodeAction,
    ) -> LanguageServerFeatureRequest;
    fn code_lenses(&self, path: &str) -> LanguageServerFeatureRequest;
    fn resolve_code_lens(&self, lens: &LanguageServerCodeLens) -> LanguageServerFeatureRequest;
    fn prepare_call_hierarchy(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest;
    fn incoming_calls(
        &self,
        item: &LanguageServerCallHierarchyItem,
    ) -> LanguageServerFeatureRequest;
    fn outgoing_calls(
        &self,
        item: &LanguageServerCallHierarchyItem,
    ) -> LanguageServerFeatureRequest;
    fn prepare_type_hierarchy(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest;
    fn type_hierarchy_supertypes(
        &self,
        item: &LanguageServerTypeHierarchyItem,
    ) -> LanguageServerFeatureRequest;
    fn type_hierarchy_subtypes(
        &self,
        item: &LanguageServerTypeHierarchyItem,
    ) -> LanguageServerFeatureRequest;
    fn typescript_source_definition(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest;
    fn execute_command(
        &self,
        command: &LanguageServerCodeActionCommand,
    ) -> LanguageServerFeatureRequest;
    fn will_create_files(&self, files: &[WorkspaceFileCreate]) -> LanguageServerFeatureRequest;
    fn did_create_files(&self, files: &[WorkspaceFileCreate]) -> LanguageServerFeatureRequest;
    fn will_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest;
    fn did_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest;
    fn will_delete_files(&self, files: &[WorkspaceFileDelete]) -> LanguageServerFeatureRequest;
    fn did_delete_files(&self, files: &[WorkspaceFileDelete]) -> LanguageServerFeatureRequest;
    fn did_change_watched_files(
        &self,
        changes: &[WorkspaceFileChange],
    ) -> LanguageServerFeatureRequest;
    fn did_change_configuration(&self, settings: Value) -> LanguageServerFeatureRequest;
}

pub struct LspTextDocumentFeatureRequestFactory;

impl TextDocumentFeatureRequestFactory for LspTextDocumentFeatureRequestFactory {
    fn hover(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/hover", position)
    }

    fn completion(&self, completion: &TextDocumentCompletion) -> LanguageServerFeatureRequest {
        let mut request = request("textDocument/completion", &completion.position);

        if let Some(context) = &completion.context {
            request.params["context"] = json!(context);
        }

        request
    }

    fn resolve_completion_item(
        &self,
        item: &LanguageServerCompletionItem,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "completionItem/resolve".to_string(),
            params: json!(item),
        }
    }

    fn definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/definition", position)
    }

    fn declaration(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/declaration", position)
    }

    fn document_highlights(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/documentHighlight", position)
    }

    fn document_links(&self, path: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/documentLink".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                },
            }),
        }
    }

    fn resolve_document_link(
        &self,
        link: &LanguageServerDocumentLink,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "documentLink/resolve".to_string(),
            params: json!(link),
        }
    }

    fn folding_ranges(&self, path: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/foldingRange".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                },
            }),
        }
    }

    fn document_symbols(&self, path: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/documentSymbol".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                },
            }),
        }
    }

    fn workspace_symbols(&self, query: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/symbol".to_string(),
            params: json!({
                "query": query,
            }),
        }
    }

    fn implementation(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/implementation", position)
    }

    fn type_definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/typeDefinition", position)
    }

    fn references(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        let mut request = request("textDocument/references", position);
        request.params["context"] = json!({ "includeDeclaration": true });
        request
    }

    fn selection_ranges(&self, range: &TextDocumentSelectionRange) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/selectionRange".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&range.path)),
                },
                "positions": range.positions,
            }),
        }
    }

    fn linked_editing_ranges(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest {
        request("textDocument/linkedEditingRange", position)
    }

    fn semantic_tokens(&self, path: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/semanticTokens/full".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                },
            }),
        }
    }

    fn range_semantic_tokens(&self, range: &TextDocumentRange) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/semanticTokens/range".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&range.path)),
                },
                "range": range.range,
            }),
        }
    }

    fn signature_help(
        &self,
        signature_help: &TextDocumentSignatureHelp,
    ) -> LanguageServerFeatureRequest {
        let mut request = request("textDocument/signatureHelp", &signature_help.position);

        if let Some(context) = &signature_help.context {
            request.params["context"] = json!(context);
        }

        request
    }

    fn prepare_rename(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/prepareRename", position)
    }

    fn rename(&self, rename: &TextDocumentRename) -> LanguageServerFeatureRequest {
        request(
            "textDocument/rename",
            &TextDocumentPosition {
                path: rename.path.clone(),
                line: rename.line,
                character: rename.character,
            },
        )
        .with_extra(json!({
            "newName": rename.new_name.clone(),
        }))
    }

    fn code_actions(
        &self,
        range: &TextDocumentRange,
        context: &LanguageServerCodeActionContext,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/codeAction".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&range.path)),
                },
                "range": range.range,
                "context": context,
            }),
        }
    }

    fn formatting(&self, formatting: &TextDocumentFormatting) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/formatting".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&formatting.path)),
                },
                "options": formatting.options,
            }),
        }
    }

    fn range_formatting(
        &self,
        formatting: &TextDocumentRangeFormatting,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/rangeFormatting".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&formatting.path)),
                },
                "range": formatting.range,
                "options": formatting.options,
            }),
        }
    }

    fn on_type_formatting(
        &self,
        formatting: &TextDocumentOnTypeFormatting,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/onTypeFormatting".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&formatting.path)),
                },
                "position": formatting.position,
                "ch": formatting.ch,
                "options": formatting.options,
            }),
        }
    }

    fn inlay_hints(&self, range: &TextDocumentInlayHintRange) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/inlayHint".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&range.path)),
                },
                "range": range.range,
            }),
        }
    }

    fn resolve_inlay_hint(&self, hint: &LanguageServerInlayHint) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "inlayHint/resolve".to_string(),
            params: inlay_hint_to_lsp_value(hint),
        }
    }

    fn resolve_code_action(
        &self,
        action: &LanguageServerCodeAction,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "codeAction/resolve".to_string(),
            params: json!(action),
        }
    }

    fn code_lenses(&self, path: &str) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "textDocument/codeLens".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                },
            }),
        }
    }

    fn resolve_code_lens(&self, lens: &LanguageServerCodeLens) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "codeLens/resolve".to_string(),
            params: json!(lens),
        }
    }

    fn prepare_call_hierarchy(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest {
        request("textDocument/prepareCallHierarchy", position)
    }

    fn incoming_calls(
        &self,
        item: &LanguageServerCallHierarchyItem,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "callHierarchy/incomingCalls".to_string(),
            params: json!({ "item": item }),
        }
    }

    fn outgoing_calls(
        &self,
        item: &LanguageServerCallHierarchyItem,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "callHierarchy/outgoingCalls".to_string(),
            params: json!({ "item": item }),
        }
    }

    fn prepare_type_hierarchy(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest {
        request("textDocument/prepareTypeHierarchy", position)
    }

    fn type_hierarchy_supertypes(
        &self,
        item: &LanguageServerTypeHierarchyItem,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "typeHierarchy/supertypes".to_string(),
            params: json!({ "item": item }),
        }
    }

    fn type_hierarchy_subtypes(
        &self,
        item: &LanguageServerTypeHierarchyItem,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "typeHierarchy/subtypes".to_string(),
            params: json!({ "item": item }),
        }
    }

    fn typescript_source_definition(
        &self,
        position: &TextDocumentPosition,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/executeCommand".to_string(),
            params: json!({
                "command": "_typescript.goToSourceDefinition",
                "arguments": [
                    file_uri(Path::new(&position.path)),
                    {
                        "line": position.line,
                        "character": position.character,
                    }
                ],
            }),
        }
    }

    fn execute_command(
        &self,
        command: &LanguageServerCodeActionCommand,
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/executeCommand".to_string(),
            params: json!({
                "command": command.command,
                "arguments": command.arguments.clone().unwrap_or_default(),
            }),
        }
    }

    fn will_create_files(&self, files: &[WorkspaceFileCreate]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/willCreateFiles".to_string(),
            params: workspace_file_create_params(files),
        }
    }

    fn did_create_files(&self, files: &[WorkspaceFileCreate]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/didCreateFiles".to_string(),
            params: workspace_file_create_params(files),
        }
    }

    fn will_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/willRenameFiles".to_string(),
            params: workspace_file_rename_params(files),
        }
    }

    fn did_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/didRenameFiles".to_string(),
            params: workspace_file_rename_params(files),
        }
    }

    fn will_delete_files(&self, files: &[WorkspaceFileDelete]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/willDeleteFiles".to_string(),
            params: workspace_file_delete_params(files),
        }
    }

    fn did_delete_files(&self, files: &[WorkspaceFileDelete]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/didDeleteFiles".to_string(),
            params: workspace_file_delete_params(files),
        }
    }

    fn did_change_watched_files(
        &self,
        changes: &[WorkspaceFileChange],
    ) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/didChangeWatchedFiles".to_string(),
            params: json!({
                "changes": changes
                    .iter()
                    .map(|change| {
                        json!({
                            "uri": file_uri(Path::new(&change.path)),
                            "type": lsp_file_change_type(change.change_type),
                        })
                    })
                    .collect::<Vec<_>>(),
            }),
        }
    }

    fn did_change_configuration(&self, settings: Value) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/didChangeConfiguration".to_string(),
            params: json!({
                "settings": settings,
            }),
        }
    }
}

fn workspace_file_create_params(files: &[WorkspaceFileCreate]) -> Value {
    json!({
        "files": files
            .iter()
            .map(|file| {
                json!({
                    "uri": file_uri(Path::new(&file.path)),
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn workspace_file_rename_params(files: &[WorkspaceFileRename]) -> Value {
    json!({
        "files": files
            .iter()
            .map(|file| {
                json!({
                    "oldUri": file_uri(Path::new(&file.old_path)),
                    "newUri": file_uri(Path::new(&file.new_path)),
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn workspace_file_delete_params(files: &[WorkspaceFileDelete]) -> Value {
    json!({
        "files": files
            .iter()
            .map(|file| {
                json!({
                    "uri": file_uri(Path::new(&file.path)),
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn lsp_file_change_type(change_type: WorkspaceFileChangeType) -> u8 {
    match change_type {
        WorkspaceFileChangeType::Created => 1,
        WorkspaceFileChangeType::Changed => 2,
        WorkspaceFileChangeType::Deleted => 3,
    }
}

fn request(method: &str, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
    LanguageServerFeatureRequest {
        method: method.to_string(),
        params: json!({
            "textDocument": {
                "uri": file_uri(Path::new(&position.path)),
            },
            "position": {
                "line": position.line,
                "character": position.character,
            },
        }),
    }
}

impl LanguageServerFeatureRequest {
    fn with_extra(mut self, extra: Value) -> Self {
        if let (Some(params), Some(extra)) = (self.params.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                params.insert(key.clone(), value.clone());
            }
        }

        self
    }
}

fn inlay_hint_to_lsp_value(hint: &LanguageServerInlayHint) -> Value {
    let mut value = serde_json::to_value(hint).unwrap_or(Value::Null);

    if let Some(parts) = value.get_mut("label").and_then(Value::as_array_mut) {
        for part in parts {
            let Some(part_object) = part.as_object_mut() else {
                continue;
            };
            let Some(label) = part_object.remove("label") else {
                continue;
            };

            part_object.insert("value".to_string(), label);
        }
    }

    value
}
