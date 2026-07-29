use super::*;
use serde_json::json;

#[test]
fn hover_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.hover(&position());

    assert_eq!(request.method, "textDocument/hover");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn implementation_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.implementation(&position());

    assert_eq!(request.method, "textDocument/implementation");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn declaration_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.declaration(&position());

    assert_eq!(request.method, "textDocument/declaration");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn type_definition_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.type_definition(&position());

    assert_eq!(request.method, "textDocument/typeDefinition");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn linked_editing_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.linked_editing_ranges(&position());

    assert_eq!(request.method, "textDocument/linkedEditingRange");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn completion_request_can_include_trigger_context() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let plain = factory.completion(&TextDocumentCompletion {
        position: position(),
        context: None,
    });
    let triggered = factory.completion(&TextDocumentCompletion {
        position: position(),
        context: Some(LanguageServerCompletionContext {
            trigger_kind: 2,
            trigger_character: Some(".".to_string()),
        }),
    });

    assert_eq!(plain.method, "textDocument/completion");
    assert!(plain.params.get("context").is_none());
    assert_eq!(triggered.method, "textDocument/completion");
    assert_eq!(triggered.params["context"]["triggerKind"], 2);
    assert_eq!(triggered.params["context"]["triggerCharacter"], ".");
}

#[test]
fn document_highlight_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_highlights(&position());

    assert_eq!(request.method, "textDocument/documentHighlight");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn document_link_request_contains_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_links("/tmp/User.ts");

    assert_eq!(request.method, "textDocument/documentLink");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
}

#[test]
fn folding_range_request_contains_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.folding_ranges("/tmp/User.ts");

    assert_eq!(request.method, "textDocument/foldingRange");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
}

#[test]
fn semantic_tokens_request_contains_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.semantic_tokens("/tmp/User.ts");

    assert_eq!(request.method, "textDocument/semanticTokens/full");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
}

#[test]
fn range_semantic_tokens_request_contains_document_uri_and_range() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let text_range = TextDocumentRange {
        path: "/tmp/User.ts".to_string(),
        range: range(1, 2, 4, 8),
    };
    let request = factory.range_semantic_tokens(&text_range);

    assert_eq!(request.method, "textDocument/semanticTokens/range");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["range"]["start"]["line"], 1);
    assert_eq!(request.params["range"]["end"]["character"], 8);
}

#[test]
fn document_link_resolve_request_serializes_link_data() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let link = LanguageServerDocumentLink {
        range: range(1, 2, 1, 18),
        target: None,
        tooltip: Some("Open user module".to_string()),
        data: Some(json!({ "file": "/tmp/user.ts" })),
    };
    let request = factory.resolve_document_link(&link);

    assert_eq!(request.method, "documentLink/resolve");
    assert_eq!(request.params["tooltip"], "Open user module");
    assert_eq!(request.params["data"]["file"], "/tmp/user.ts");
}

#[test]
fn references_request_includes_declarations() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.references(&position());

    assert_eq!(request.method, "textDocument/references");
    assert_eq!(request.params["context"]["includeDeclaration"], true);
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn prepare_rename_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_rename(&position());

    assert_eq!(request.method, "textDocument/prepareRename");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn selection_range_request_contains_document_uri_and_positions() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.selection_ranges(&TextDocumentSelectionRange {
        path: "/tmp/User.ts".to_string(),
        positions: vec![
            LanguageServerPosition {
                line: 2,
                character: 8,
            },
            LanguageServerPosition {
                line: 4,
                character: 12,
            },
        ],
    });

    assert_eq!(request.method, "textDocument/selectionRange");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(
        request.params["positions"],
        json!([
            { "line": 2, "character": 8 },
            { "line": 4, "character": 12 }
        ])
    );
}

#[test]
fn signature_help_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp {
        position: position(),
        context: None,
    });

    assert_eq!(request.method, "textDocument/signatureHelp");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
    assert!(request.params.get("context").is_none());
}

#[test]
fn signature_help_request_can_include_trigger_context() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.signature_help(&TextDocumentSignatureHelp {
        position: position(),
        context: Some(LanguageServerSignatureHelpContext {
            active_signature_help: Some(LanguageServerSignatureHelp {
                active_parameter: 1,
                active_signature: 0,
                signatures: vec![LanguageServerSignature {
                    documentation: Some("Loads a user.".to_string()),
                    label: "loadUser(id: string, options?: Options)".to_string(),
                    parameters: vec![
                        LanguageServerSignatureParameter {
                            documentation: Some("User id".to_string()),
                            label: "id: string".to_string(),
                        },
                        LanguageServerSignatureParameter {
                            documentation: None,
                            label: "options?: Options".to_string(),
                        },
                    ],
                }],
            }),
            is_retrigger: true,
            trigger_character: Some(",".to_string()),
            trigger_kind: 2,
        }),
    });

    assert_eq!(request.method, "textDocument/signatureHelp");
    assert_eq!(
        request.params["context"],
        json!({
            "triggerKind": 2,
            "triggerCharacter": ",",
            "isRetrigger": true,
            "activeSignatureHelp": {
                "activeParameter": 1,
                "activeSignature": 0,
                "signatures": [
                    {
                        "documentation": "Loads a user.",
                        "label": "loadUser(id: string, options?: Options)",
                        "parameters": [
                            {
                                "documentation": "User id",
                                "label": "id: string"
                            },
                            {
                                "documentation": null,
                                "label": "options?: Options"
                            }
                        ]
                    }
                ]
            }
        })
    );
}

#[test]
fn document_symbols_request_contains_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.document_symbols("/tmp/User.ts");

    assert_eq!(request.method, "textDocument/documentSymbol");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
}

#[test]
fn workspace_symbols_request_contains_query() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.workspace_symbols("User");

    assert_eq!(request.method, "workspace/symbol");
    assert_eq!(request.params["query"], "User");
}

#[test]
fn rename_request_contains_new_name() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.rename(&TextDocumentRename {
        path: "/tmp/User.ts".to_string(),
        line: 2,
        character: 8,
        new_name: "Account".to_string(),
    });

    assert_eq!(request.method, "textDocument/rename");
    assert_eq!(request.params["newName"], "Account");
    assert_eq!(request.params["position"]["line"], 2);
    assert_eq!(request.params["position"]["character"], 8);
}

#[test]
fn code_action_request_contains_range_context_and_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let range = range(2, 4, 2, 10);
    let request = factory.code_actions(
        &TextDocumentRange {
            path: "/tmp/User.ts".to_string(),
            range: range.clone(),
        },
        &LanguageServerCodeActionContext {
            diagnostics: vec![LanguageServerCodeActionDiagnostic {
                code: Some(json!("TS2304")),
                data: Some(json!({ "fixId": "fixMissingImport" })),
                message: "Cannot find name 'User'.".to_string(),
                range: range.clone(),
                severity: Some(1),
                source: Some("typescript".to_string()),
            }],
            only: Some(vec!["quickfix".to_string()]),
            trigger_kind: Some(1),
        },
    );

    assert_eq!(request.method, "textDocument/codeAction");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["range"], json!(range));
    assert_eq!(request.params["context"]["only"], json!(["quickfix"]));
    assert_eq!(request.params["context"]["triggerKind"], json!(1));
    assert_eq!(
        request.params["context"]["diagnostics"][0]["data"],
        json!({ "fixId": "fixMissingImport" })
    );
}

#[test]
fn formatting_request_contains_options() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.formatting(&TextDocumentFormatting {
        path: "/tmp/User.ts".to_string(),
        options: LanguageServerFormattingOptions {
            tab_size: 2,
            insert_spaces: true,
        },
    });

    assert_eq!(request.method, "textDocument/formatting");
    assert_eq!(request.params["options"]["tabSize"], 2);
    assert_eq!(request.params["options"]["insertSpaces"], true);
}

#[test]
fn range_formatting_request_contains_range_and_options() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let selected = range(2, 0, 5, 8);
    let request = factory.range_formatting(&TextDocumentRangeFormatting {
        path: "/tmp/User.ts".to_string(),
        range: selected.clone(),
        options: LanguageServerFormattingOptions {
            tab_size: 4,
            insert_spaces: false,
        },
    });

    assert_eq!(request.method, "textDocument/rangeFormatting");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["range"], json!(selected));
    assert_eq!(request.params["options"]["tabSize"], 4);
    assert_eq!(request.params["options"]["insertSpaces"], false);
}

#[test]
fn on_type_formatting_request_contains_position_trigger_and_options() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.on_type_formatting(&TextDocumentOnTypeFormatting {
        path: "/tmp/User.ts".to_string(),
        position: LanguageServerPosition {
            line: 5,
            character: 2,
        },
        ch: "}".to_string(),
        options: LanguageServerFormattingOptions {
            tab_size: 2,
            insert_spaces: true,
        },
    });

    assert_eq!(request.method, "textDocument/onTypeFormatting");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 5);
    assert_eq!(request.params["position"]["character"], 2);
    assert_eq!(request.params["ch"], "}");
    assert_eq!(request.params["options"]["tabSize"], 2);
    assert_eq!(request.params["options"]["insertSpaces"], true);
}

#[test]
fn inlay_hint_request_contains_range_and_document_uri() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let range = range(2, 0, 8, 20);
    let request = factory.inlay_hints(&TextDocumentInlayHintRange {
        path: "/tmp/User.ts".to_string(),
        range: range.clone(),
    });

    assert_eq!(request.method, "textDocument/inlayHint");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["range"], json!(range));
}

#[test]
fn inlay_hint_resolve_request_serializes_hint_data() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let hint = LanguageServerInlayHint {
        data: Some(json!({ "hintId": 7 })),
        kind: Some(1),
        label: LanguageServerInlayHintLabel::Parts(vec![LanguageServerInlayHintLabelPart {
            command: Some(LanguageServerCodeActionCommand {
                arguments: Some(vec![json!({ "file": "/tmp/User.ts" })]),
                command: "_typescript.applyCompletionCodeAction".to_string(),
                title: "Apply import".to_string(),
            }),
            label: "user".to_string(),
            tooltip: Some("User symbol".to_string()),
            location: None,
        }]),
        padding_left: true,
        padding_right: false,
        position: LanguageServerPosition {
            line: 2,
            character: 4,
        },
        text_edits: vec![LanguageServerTextEdit {
            range: LanguageServerRange {
                start: LanguageServerPosition {
                    line: 2,
                    character: 4,
                },
                end: LanguageServerPosition {
                    line: 2,
                    character: 4,
                },
            },
            new_text: ": User".to_string(),
        }],
        tooltip: None,
    };
    let request = factory.resolve_inlay_hint(&hint);

    assert_eq!(request.method, "inlayHint/resolve");
    assert_eq!(request.params["data"], json!({ "hintId": 7 }));
    assert_eq!(request.params["label"][0]["value"], "user");
    assert_eq!(request.params["label"][0]["tooltip"], "User symbol");
    assert_eq!(
        request.params["label"][0]["command"]["command"],
        "_typescript.applyCompletionCodeAction"
    );
    assert!(request.params["label"][0].get("label").is_none());
    assert_eq!(request.params["textEdits"][0]["newText"], ": User");
    assert_eq!(request.params["position"]["line"], 2);
}

#[test]
fn code_action_resolve_and_execute_command_requests_are_serialized() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let action = code_action();
    let resolve = factory.resolve_code_action(&action);

    assert_eq!(resolve.method, "codeAction/resolve");
    assert_eq!(resolve.params["title"], "Fix all unused identifiers");
    assert_eq!(resolve.params["data"]["globalId"], 1);

    let execute = factory.execute_command(action.command.as_ref().expect("command"));

    assert_eq!(execute.method, "workspace/executeCommand");
    assert_eq!(
        execute.params["command"],
        "_typescript.applyFixAllCodeAction"
    );
    assert_eq!(
        execute.params["arguments"][0]["tsActionId"],
        "unusedIdentifier"
    );

    let execute_without_arguments = factory.execute_command(&LanguageServerCodeActionCommand {
        arguments: None,
        command: "_typescript.organizeImports".to_string(),
        title: "Organize imports".to_string(),
    });

    assert_eq!(execute_without_arguments.params["arguments"], json!([]));
}

#[test]
fn typescript_source_definition_request_uses_execute_command() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.typescript_source_definition(&position());

    assert_eq!(request.method, "workspace/executeCommand");
    assert_eq!(
        request.params["command"],
        "_typescript.goToSourceDefinition"
    );
    assert_eq!(
        request.params["arguments"],
        json!([
            "file:///tmp/User.php",
            {
                "line": 10,
                "character": 4,
            }
        ])
    );
}

#[test]
fn will_rename_files_request_contains_old_and_new_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_rename_files(&[WorkspaceFileRename {
        old_path: "/tmp/src/User.ts".to_string(),
        new_path: "/tmp/src/Account.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/willRenameFiles");
    assert_eq!(
        request.params["files"][0]["oldUri"],
        "file:///tmp/src/User.ts"
    );
    assert_eq!(
        request.params["files"][0]["newUri"],
        "file:///tmp/src/Account.ts"
    );
}

#[test]
fn will_create_files_request_contains_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_create_files(&[WorkspaceFileCreate {
        path: "/tmp/src/User.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/willCreateFiles");
    assert_eq!(request.params["files"][0]["uri"], "file:///tmp/src/User.ts");
}

#[test]
fn did_create_files_notification_contains_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_create_files(&[WorkspaceFileCreate {
        path: "/tmp/src/User.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/didCreateFiles");
    assert_eq!(request.params["files"][0]["uri"], "file:///tmp/src/User.ts");
}

#[test]
fn did_rename_files_notification_contains_old_and_new_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_rename_files(&[WorkspaceFileRename {
        old_path: "/tmp/src/User.ts".to_string(),
        new_path: "/tmp/src/Account.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/didRenameFiles");
    assert_eq!(
        request.params["files"][0]["oldUri"],
        "file:///tmp/src/User.ts"
    );
    assert_eq!(
        request.params["files"][0]["newUri"],
        "file:///tmp/src/Account.ts"
    );
}

#[test]
fn will_delete_files_request_contains_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.will_delete_files(&[WorkspaceFileDelete {
        path: "/tmp/src/User.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/willDeleteFiles");
    assert_eq!(request.params["files"][0]["uri"], "file:///tmp/src/User.ts");
}

#[test]
fn did_delete_files_notification_contains_file_uris() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_delete_files(&[WorkspaceFileDelete {
        path: "/tmp/src/User.ts".to_string(),
    }]);

    assert_eq!(request.method, "workspace/didDeleteFiles");
    assert_eq!(request.params["files"][0]["uri"], "file:///tmp/src/User.ts");
}

#[test]
fn did_change_watched_files_request_contains_lsp_file_change_types() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_watched_files(&[
        WorkspaceFileChange {
            path: "/tmp/src/User.ts".to_string(),
            change_type: WorkspaceFileChangeType::Created,
        },
        WorkspaceFileChange {
            path: "/tmp/src/Account.ts".to_string(),
            change_type: WorkspaceFileChangeType::Changed,
        },
        WorkspaceFileChange {
            path: "/tmp/src/Old.ts".to_string(),
            change_type: WorkspaceFileChangeType::Deleted,
        },
    ]);

    assert_eq!(request.method, "workspace/didChangeWatchedFiles");
    assert_eq!(
        request.params["changes"][0]["uri"],
        "file:///tmp/src/User.ts"
    );
    assert_eq!(request.params["changes"][0]["type"], 1);
    assert_eq!(
        request.params["changes"][1]["uri"],
        "file:///tmp/src/Account.ts"
    );
    assert_eq!(request.params["changes"][1]["type"], 2);
    assert_eq!(
        request.params["changes"][2]["uri"],
        "file:///tmp/src/Old.ts"
    );
    assert_eq!(request.params["changes"][2]["type"], 3);
}

#[test]
fn did_change_configuration_request_contains_settings() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.did_change_configuration(json!({
        "suggest": {
            "autoImports": false,
        },
    }));

    assert_eq!(request.method, "workspace/didChangeConfiguration");
    assert_eq!(request.params["settings"]["suggest"]["autoImports"], false);
}

#[test]
fn code_lens_requests_are_serialized() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.code_lenses("/tmp/User.ts");

    assert_eq!(request.method, "textDocument/codeLens");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));

    let lens = LanguageServerCodeLens {
        range: range(2, 4, 2, 10),
        command: Some(LanguageServerCodeActionCommand {
            title: "3 references".to_string(),
            command: "editor.action.showReferences".to_string(),
            arguments: Some(vec![json!("file:///tmp/User.ts")]),
        }),
        data: Some(json!({ "kind": "references" })),
    };
    let resolve = factory.resolve_code_lens(&lens);

    assert_eq!(resolve.method, "codeLens/resolve");
    assert_eq!(resolve.params["data"]["kind"], "references");
    assert_eq!(
        resolve.params["command"]["command"],
        "editor.action.showReferences"
    );
}

#[test]
fn prepare_call_hierarchy_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_call_hierarchy(&position());

    assert_eq!(request.method, "textDocument/prepareCallHierarchy");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn incoming_call_request_serializes_call_hierarchy_item() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.incoming_calls(&call_hierarchy_item("renderUser"));

    assert_eq!(request.method, "callHierarchy/incomingCalls");
    assert_eq!(request.params["item"]["name"], "renderUser");
    assert_eq!(request.params["item"]["uri"], "file:///tmp/User.ts");
    assert_eq!(request.params["item"]["data"]["symbolId"], "renderUser");
}

#[test]
fn outgoing_call_request_serializes_call_hierarchy_item() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.outgoing_calls(&call_hierarchy_item("renderUser"));

    assert_eq!(request.method, "callHierarchy/outgoingCalls");
    assert_eq!(request.params["item"]["name"], "renderUser");
    assert_eq!(request.params["item"]["selectionRange"]["start"]["line"], 2);
}

#[test]
fn prepare_type_hierarchy_request_contains_document_uri_and_position() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let request = factory.prepare_type_hierarchy(&position());

    assert_eq!(request.method, "textDocument/prepareTypeHierarchy");
    assert!(request.params["textDocument"]["uri"]
        .as_str()
        .expect("uri")
        .starts_with("file://"));
    assert_eq!(request.params["position"]["line"], 10);
    assert_eq!(request.params["position"]["character"], 4);
}

#[test]
fn type_hierarchy_requests_serialize_type_hierarchy_item() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let item = type_hierarchy_item("BaseView");
    let supertypes = factory.type_hierarchy_supertypes(&item);
    let subtypes = factory.type_hierarchy_subtypes(&item);

    assert_eq!(supertypes.method, "typeHierarchy/supertypes");
    assert_eq!(supertypes.params["item"]["name"], "BaseView");
    assert_eq!(supertypes.params["item"]["uri"], "file:///tmp/View.ts");
    assert_eq!(subtypes.method, "typeHierarchy/subtypes");
    assert_eq!(
        subtypes.params["item"]["selectionRange"]["start"]["line"],
        3
    );
}

fn position() -> TextDocumentPosition {
    TextDocumentPosition {
        path: "/tmp/User.php".to_string(),
        line: 10,
        character: 4,
    }
}

fn range(
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
) -> LanguageServerRange {
    LanguageServerRange {
        start: LanguageServerPosition {
            line: start_line,
            character: start_character,
        },
        end: LanguageServerPosition {
            line: end_line,
            character: end_character,
        },
    }
}

fn code_action() -> LanguageServerCodeAction {
    LanguageServerCodeAction {
        title: "Fix all unused identifiers".to_string(),
        kind: Some("quickfix".to_string()),
        is_preferred: false,
        disabled: None,
        edit: None,
        command: Some(LanguageServerCodeActionCommand {
            title: "Fix all unused identifiers".to_string(),
            command: "_typescript.applyFixAllCodeAction".to_string(),
            arguments: Some(vec![json!({
                "tsActionId": "unusedIdentifier",
            })]),
        }),
        data: Some(json!({
            "globalId": 1,
            "providerId": 2,
        })),
    }
}

fn call_hierarchy_item(name: &str) -> LanguageServerCallHierarchyItem {
    LanguageServerCallHierarchyItem {
        name: name.to_string(),
        kind: 12,
        tags: Some(vec![1]),
        detail: Some("src/User.ts".to_string()),
        uri: "file:///tmp/User.ts".to_string(),
        range: range(2, 0, 2, 24),
        selection_range: range(2, 9, 2, 19),
        data: Some(json!({ "symbolId": name })),
    }
}

fn type_hierarchy_item(name: &str) -> LanguageServerTypeHierarchyItem {
    LanguageServerTypeHierarchyItem {
        name: name.to_string(),
        kind: 5,
        tags: Some(vec![1]),
        detail: Some("src/View.ts".to_string()),
        uri: "file:///tmp/View.ts".to_string(),
        range: range(3, 0, 3, 24),
        selection_range: range(3, 6, 3, 14),
        data: Some(json!({ "symbolId": name })),
    }
}
