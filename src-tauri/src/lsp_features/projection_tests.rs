use super::*;
use serde_json::json;

#[test]
fn parses_hover_markup_variants() {
    assert_eq!(
        parse_hover_result(&json!({
            "contents": { "kind": "markdown", "value": "**User**" },
            "range": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 8 }
            }
        }))
        .expect("hover"),
        Some(LanguageServerHover {
            contents: vec![hover_projection::LanguageServerHoverContent::Markdown {
                value: "**User**".to_string(),
            }],
            range: Some(LanguageServerRange {
                start: LanguageServerPosition {
                    line: 2,
                    character: 4,
                },
                end: LanguageServerPosition {
                    line: 2,
                    character: 8,
                },
            }),
        })
    );
    let structured = parse_hover_result(&json!({
        "contents": [
            "one",
            { "language": "typescript", "value": "const value = 1;" },
            { "kind": "plaintext", "value": "literal * markdown" }
        ],
    }))
    .expect("hover")
    .expect("hover value");
    assert_eq!(
        structured.contents,
        vec![
            hover_projection::LanguageServerHoverContent::Markdown {
                value: "one".to_string(),
            },
            hover_projection::LanguageServerHoverContent::Code {
                language: "typescript".to_string(),
                value: "const value = 1;".to_string(),
            },
            hover_projection::LanguageServerHoverContent::Plaintext {
                value: "literal * markdown".to_string(),
            },
        ]
    );
    assert_eq!(parse_hover_result(&json!(null)).expect("hover"), None);
}

#[test]
fn rejects_malformed_reversed_and_oversized_hover_payloads() {
    assert!(parse_hover_result(&json!({
        "contents": { "kind": "html", "value": "<script>bad()</script>" }
    }))
    .expect_err("unsupported kind")
    .contains("unsupported"));
    assert!(parse_hover_result(&json!({
        "contents": { "language": "typescript" }
    }))
    .expect_err("missing value")
    .contains("malformed"));
    assert!(parse_hover_result(&json!({
        "contents": "hover",
        "range": {
            "start": { "line": 3, "character": 8 },
            "end": { "line": 3, "character": 2 }
        }
    }))
    .expect_err("reversed range")
    .contains("reversed"));
    assert!(parse_hover_result(&json!({
        "contents": "ž".repeat(hover_projection::MAX_HOVER_CONTENT_ITEM_BYTES / 2 + 1)
    }))
    .expect_err("utf8 byte bound")
    .contains("too large"));
    assert!(parse_hover_result(&json!({
        "contents": vec!["hover"; hover_projection::MAX_HOVER_CONTENT_ITEMS + 1]
    }))
    .expect_err("item bound")
    .contains("too many"));
    assert!(parse_hover_result(&json!({
        "contents": vec!["x".repeat(14 * 1024); 5]
    }))
    .expect_err("total byte bound")
    .contains("too large"));
}

#[test]
fn parses_completion_list_and_array_variants() {
    assert_eq!(
        parse_completion_result(&json!({
            "isIncomplete": true,
            "items": [
                {
                    "label": "User",
                    "detail": "class",
                    "documentation": { "kind": "markdown", "value": "A user" },
                    "filterText": "User",
                    "insertText": "User",
                    "insertTextFormat": 2,
                    "kind": 7,
                    "labelDetails": {
                        "detail": "(id: string)",
                        "description": "Promise<User>"
                    },
                    "preselect": true,
                    "sortText": "11",
                    "data": { "entryNames": ["User"] },
                    "commitCharacters": ["."],
                    "command": {
                        "title": "Apply completion code action",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "source": "completion" }]
                    },
                    "deprecated": true,
                    "tags": [1],
                    "additionalTextEdits": [
                        {
                            "range": {
                                "start": { "line": 0, "character": 0 },
                                "end": { "line": 0, "character": 0 }
                            },
                            "newText": "import { User } from './user';\n"
                        }
                    ],
                    "textEdit": {
                        "range": {
                            "start": { "line": 2, "character": 4 },
                            "end": { "line": 2, "character": 8 }
                        },
                        "newText": "User"
                    }
                },
                { "detail": "missing label" },
            ],
        }))
        .expect("completion"),
        LanguageServerCompletionList {
            is_incomplete: true,
            items: vec![LanguageServerCompletionItem {
                additional_text_edits: vec![LanguageServerTextEdit {
                    range: LanguageServerRange {
                        start: LanguageServerPosition {
                            line: 0,
                            character: 0,
                        },
                        end: LanguageServerPosition {
                            line: 0,
                            character: 0,
                        },
                    },
                    new_text: "import { User } from './user';\n".to_string(),
                }],
                commit_characters: vec![".".to_string()],
                command: Some(LanguageServerCodeActionCommand {
                    title: "Apply completion code action".to_string(),
                    command: "_typescript.applyCompletionCodeAction".to_string(),
                    arguments: Some(vec![json!({ "source": "completion" })]),
                }),
                data: Some(json!({ "entryNames": ["User"] })),
                deprecated: true,
                label: "User".to_string(),
                detail: Some("class".to_string()),
                documentation: Some("A user".to_string()),
                documentation_kind: Some("markdown".to_string()),
                filter_text: Some("User".to_string()),
                insert_text: Some("User".to_string()),
                insert_text_format: Some(2),
                insert_text_mode: None,
                kind: Some(7),
                label_details: Some(LanguageServerCompletionItemLabelDetails {
                    detail: Some("(id: string)".to_string()),
                    description: Some("Promise<User>".to_string()),
                }),
                preselect: true,
                sort_text: Some("11".to_string()),
                tags: vec![1],
                text_edit: Some(LanguageServerCompletionTextEdit {
                    range: Some(LanguageServerRange {
                        start: LanguageServerPosition {
                            line: 2,
                            character: 4,
                        },
                        end: LanguageServerPosition {
                            line: 2,
                            character: 8,
                        },
                    }),
                    insert: None,
                    replace: None,
                    new_text: "User".to_string(),
                }),
                text_edit_text: None,
            }],
        }
    );
    assert_eq!(
        parse_completion_result(&json!([{ "label": "Repository" }]))
            .expect("completion")
            .items[0]
            .label,
        "Repository"
    );
}

#[test]
fn parses_resolved_completion_item_with_markup_edits_and_optional_command() {
    let item = parse_completion_item_result(&json!({
        "label": "User",
        "documentation": {
            "kind": "markdown",
            "value": "Resolved **User** docs"
        },
        "additionalTextEdits": [
            {
                "range": {
                    "start": { "line": 0, "character": 0 },
                    "end": { "line": 0, "character": 0 }
                },
                "newText": "import { User } from './user';\n"
            }
        ],
        "command": {
            "title": "Apply completion code action",
            "command": "_typescript.applyCompletionCodeAction",
            "arguments": [{ "source": "completion" }]
        }
    }))
    .expect("completion item");

    assert_eq!(item.label, "User");
    assert_eq!(
        item.documentation,
        Some("Resolved **User** docs".to_string())
    );
    assert_eq!(item.documentation_kind, Some("markdown".to_string()));
    assert_eq!(
        item.additional_text_edits,
        vec![LanguageServerTextEdit {
            range: LanguageServerRange {
                start: LanguageServerPosition {
                    line: 0,
                    character: 0,
                },
                end: LanguageServerPosition {
                    line: 0,
                    character: 0,
                },
            },
            new_text: "import { User } from './user';\n".to_string(),
        }]
    );
    assert_eq!(
        item.command,
        Some(LanguageServerCodeActionCommand {
            title: "Apply completion code action".to_string(),
            command: "_typescript.applyCompletionCodeAction".to_string(),
            arguments: Some(vec![json!({ "source": "completion" })]),
        })
    );

    let item_without_command =
        parse_completion_item_result(&json!({ "label": "UserWithoutCommand" }))
            .expect("completion item");
    assert_eq!(item_without_command.command, None);
}

#[test]
fn completion_item_resolve_request_serializes_item_data() {
    let factory = LspTextDocumentFeatureRequestFactory;
    let item = LanguageServerCompletionItem {
        additional_text_edits: Vec::new(),
        commit_characters: Vec::new(),
        command: None,
        data: Some(json!({ "entryNames": ["User"] })),
        deprecated: false,
        label: "User".to_string(),
        detail: None,
        documentation: None,
        documentation_kind: None,
        filter_text: None,
        insert_text: Some("User".to_string()),
        insert_text_format: None,
        insert_text_mode: None,
        kind: Some(7),
        label_details: Some(LanguageServerCompletionItemLabelDetails {
            detail: Some("(id: string)".to_string()),
            description: Some("User".to_string()),
        }),
        preselect: false,
        sort_text: None,
        tags: Vec::new(),
        text_edit: None,
        text_edit_text: None,
    };
    let request = factory.resolve_completion_item(&item);

    assert_eq!(request.method, "completionItem/resolve");
    assert_eq!(request.params["label"], "User");
    assert_eq!(request.params["labelDetails"]["detail"], "(id: string)");
    assert_eq!(request.params["data"]["entryNames"], json!(["User"]));
}

#[test]
fn parses_completion_insert_replace_text_edit() {
    let completion = parse_completion_result(&json!({
        "items": [
            {
                "label": "loadUser",
                "textEdit": {
                    "insert": {
                        "start": { "line": 4, "character": 10 },
                        "end": { "line": 4, "character": 14 }
                    },
                    "replace": {
                        "start": { "line": 4, "character": 10 },
                        "end": { "line": 4, "character": 18 }
                    },
                    "newText": "loadUser"
                }
            }
        ]
    }))
    .expect("completion");

    assert_eq!(
        completion.items[0].text_edit,
        Some(LanguageServerCompletionTextEdit {
            range: None,
            insert: Some(LanguageServerRange {
                start: LanguageServerPosition {
                    line: 4,
                    character: 10,
                },
                end: LanguageServerPosition {
                    line: 4,
                    character: 14,
                },
            }),
            replace: Some(LanguageServerRange {
                start: LanguageServerPosition {
                    line: 4,
                    character: 10,
                },
                end: LanguageServerPosition {
                    line: 4,
                    character: 18,
                },
            }),
            new_text: "loadUser".to_string(),
        })
    );
}

#[test]
fn applies_completion_item_defaults_without_overwriting_item_metadata() {
    let completion = parse_completion_result(&json!({
        "itemDefaults": {
            "commitCharacters": [".", ";"],
            "data": { "source": "defaults" },
            "editRange": {
                "insert": {
                    "start": { "line": 4, "character": 10 },
                    "end": { "line": 4, "character": 14 }
                },
                "replace": {
                    "start": { "line": 4, "character": 10 },
                    "end": { "line": 4, "character": 18 }
                }
            },
            "insertTextFormat": 2,
            "insertTextMode": 1
        },
        "items": [
            {
                "label": "loadUser",
                "documentation": {
                    "kind": "plaintext",
                    "value": "Loads a user."
                },
                "textEditText": "loadUser(${1:id})"
            },
            {
                "label": "explicitUser",
                "commitCharacters": ["("],
                "data": { "source": "item" },
                "insertTextFormat": 1,
                "insertTextMode": 2,
                "textEdit": {
                    "range": {
                        "start": { "line": 7, "character": 2 },
                        "end": { "line": 7, "character": 6 }
                    },
                    "newText": "explicitUser"
                }
            }
        ]
    }))
    .expect("completion");

    assert_eq!(completion.items[0].commit_characters, vec![".", ";"]);
    assert_eq!(
        completion.items[0].documentation,
        Some("Loads a user.".to_string())
    );
    assert_eq!(
        completion.items[0].documentation_kind,
        Some("plaintext".to_string())
    );
    assert_eq!(
        completion.items[0].data,
        Some(json!({ "source": "defaults" }))
    );
    assert_eq!(completion.items[0].insert_text_format, Some(2));
    assert_eq!(completion.items[0].insert_text_mode, Some(1));
    assert_eq!(
        completion.items[0].text_edit_text.as_deref(),
        Some("loadUser(${1:id})")
    );
    assert_eq!(
        completion.items[0].text_edit,
        Some(LanguageServerCompletionTextEdit {
            range: None,
            insert: Some(range(4, 10, 4, 14)),
            replace: Some(range(4, 10, 4, 18)),
            new_text: "loadUser(${1:id})".to_string(),
        })
    );

    assert_eq!(completion.items[1].commit_characters, vec!["("]);
    assert_eq!(completion.items[1].data, Some(json!({ "source": "item" })));
    assert_eq!(completion.items[1].insert_text_format, Some(1));
    assert_eq!(completion.items[1].insert_text_mode, Some(2));
    assert_eq!(
        completion.items[1].text_edit,
        Some(LanguageServerCompletionTextEdit {
            range: Some(range(7, 2, 7, 6)),
            insert: None,
            replace: None,
            new_text: "explicitUser".to_string(),
        })
    );
}

#[test]
fn parses_definition_locations_and_location_links() {
    let range = LanguageServerRange {
        start: LanguageServerPosition {
            line: 1,
            character: 2,
        },
        end: LanguageServerPosition {
            line: 1,
            character: 8,
        },
    };

    assert_eq!(
        parse_definition_result(&json!([
            {
                "uri": "file:///tmp/User.php",
                "range": {
                    "start": { "line": 1, "character": 2 },
                    "end": { "line": 1, "character": 8 }
                }
            },
            {
                "targetUri": "file:///tmp/UserRepository.php",
                "targetRange": {
                    "start": { "line": 3, "character": 4 },
                    "end": { "line": 3, "character": 20 }
                }
            }
        ]))
        .expect("definition"),
        vec![
            LanguageServerLocation {
                uri: "file:///tmp/User.php".to_string(),
                range: range.clone(),
            },
            LanguageServerLocation {
                uri: "file:///tmp/UserRepository.php".to_string(),
                range: LanguageServerRange {
                    start: LanguageServerPosition {
                        line: 3,
                        character: 4,
                    },
                    end: LanguageServerPosition {
                        line: 3,
                        character: 20,
                    },
                },
            },
        ]
    );
    assert_eq!(
        parse_definition_result(&json!(null)).expect("definition"),
        []
    );
}

#[test]
fn bounds_reference_locations_before_wire_serialization_and_reports_total() {
    let locations = (0..MAX_INSPECTED_REFERENCE_LOCATIONS + 5)
        .map(|index| {
            json!({
                "uri": format!("file:///workspace/src/reference-{index}.ts"),
                "range": {
                    "start": { "line": index, "character": 0 },
                    "end": { "line": index, "character": 1 }
                }
            })
        })
        .collect::<Vec<_>>();

    let projected =
        parse_bounded_reference_locations_result(&Value::Array(locations)).expect("references");

    assert_eq!(projected.locations.len(), MAX_REFERENCE_LOCATIONS);
    assert_eq!(projected.total_count, MAX_INSPECTED_REFERENCE_LOCATIONS + 5);
    assert!(projected.is_incomplete);
    assert!(
        projected
            .locations
            .iter()
            .map(|location| location.uri.len())
            .sum::<usize>()
            <= MAX_REFERENCE_LOCATION_URI_TOTAL_BYTES
    );
}

#[test]
fn omits_oversized_reference_uris_truthfully() {
    let oversized_uri = format!(
        "file:///workspace/{}.ts",
        "x".repeat(MAX_REFERENCE_LOCATION_URI_BYTES)
    );
    let projected = parse_bounded_reference_locations_result(&json!([
        {
            "uri": oversized_uri,
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 1 }
            }
        },
        {
            "uri": "file:///workspace/src/retained.ts",
            "range": {
                "start": { "line": 1, "character": 0 },
                "end": { "line": 1, "character": 1 }
            }
        }
    ]))
    .expect("references");

    assert_eq!(projected.locations.len(), 1);
    assert_eq!(projected.total_count, 2);
    assert!(projected.is_incomplete);
}

#[test]
fn parses_linked_editing_ranges_and_null_results() {
    let parsed = parse_linked_editing_ranges_result(&json!({
        "ranges": [
            {
                "start": { "line": 2, "character": 8 },
                "end": { "line": 2, "character": 12 }
            },
            {
                "start": { "line": 4, "character": 9 },
                "end": { "line": 4, "character": 13 }
            }
        ],
        "wordPattern": "[A-Za-z]+"
    }))
    .expect("linked editing ranges")
    .expect("linked editing result");

    assert_eq!(parsed.ranges.len(), 2);
    assert_eq!(parsed.ranges[0].start.line, 2);
    assert_eq!(parsed.ranges[1].end.character, 13);
    assert_eq!(parsed.word_pattern.as_deref(), Some("[A-Za-z]+"));
    assert_eq!(
        parse_linked_editing_ranges_result(&json!(null)).expect("null"),
        None
    );
    assert!(parse_linked_editing_ranges_result(&json!({ "ranges": "bad" })).is_err());
}

#[test]
fn parses_workspace_edit_changes_and_document_changes() {
    let edit = parse_workspace_edit_result(&json!({
        "changes": {
            "file:///tmp/User.ts": [
                {
                    "range": {
                        "start": { "line": 1, "character": 2 },
                        "end": { "line": 1, "character": 6 }
                    },
                    "newText": "Account"
                }
            ]
        },
        "documentChanges": [
            {
                "kind": "create",
                "uri": "file:///tmp/Created.ts",
                "options": { "ignoreIfExists": true }
            },
            {
                "kind": "rename",
                "oldUri": "file:///tmp/Old.ts",
                "newUri": "file:///tmp/New.ts",
                "options": { "overwrite": true }
            },
            {
                "kind": "delete",
                "uri": "file:///tmp/Deleted.ts",
                "options": {
                    "ignoreIfNotExists": true,
                    "recursive": true
                }
            },
            {
                "textDocument": { "uri": "file:///tmp/Other.ts", "version": 7 },
                "edits": [
                    {
                        "range": {
                            "start": { "line": 3, "character": 0 },
                            "end": { "line": 3, "character": 0 }
                        },
                        "newText": "import { Account } from './account';\n"
                    }
                ]
            }
        ]
    }))
    .expect("workspace edit")
    .expect("workspace edit result");

    assert_eq!(
        edit.changes["file:///tmp/User.ts"],
        vec![LanguageServerTextEdit {
            range: range(1, 2, 1, 6),
            new_text: "Account".to_string(),
        }]
    );
    assert_eq!(
        edit.changes["file:///tmp/Other.ts"][0].new_text,
        "import { Account } from './account';\n"
    );
    assert_eq!(edit.document_versions["file:///tmp/Other.ts"], Some(7));
    assert_eq!(edit.file_operations.len(), 3);
    assert_eq!(
        edit.file_operations[0],
        LanguageServerWorkspaceFileOperation::Create {
            uri: "file:///tmp/Created.ts".to_string(),
            options: Some(super::LanguageServerWorkspaceFileOperationOptions {
                ignore_if_exists: Some(true),
                ..Default::default()
            }),
        }
    );
    assert_eq!(
        edit.file_operations[1],
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri: "file:///tmp/Old.ts".to_string(),
            new_uri: "file:///tmp/New.ts".to_string(),
            options: Some(super::LanguageServerWorkspaceFileOperationOptions {
                overwrite: Some(true),
                ..Default::default()
            }),
        }
    );
    assert_eq!(
        edit.file_operations[2],
        LanguageServerWorkspaceFileOperation::Delete {
            uri: "file:///tmp/Deleted.ts".to_string(),
            options: Some(super::LanguageServerWorkspaceFileOperationOptions {
                ignore_if_not_exists: Some(true),
                recursive: Some(true),
                ..Default::default()
            }),
        }
    );
    assert_eq!(
        parse_workspace_edit_result(&json!(null)).expect("null edit"),
        None
    );
}

#[test]
fn optional_workspace_edit_ignores_non_edit_command_results() {
    assert_eq!(
        parse_optional_workspace_edit_result(&json!({
            "applied": true,
        }))
        .expect("command result"),
        None
    );
    assert_eq!(
        parse_optional_workspace_edit_result(&json!({
            "changes": {
                "file:///tmp/User.ts": [
                    {
                        "range": {
                            "start": { "line": 1, "character": 2 },
                            "end": { "line": 1, "character": 6 }
                        },
                        "newText": "Account"
                    }
                ]
            }
        }))
        .expect("workspace edit")
        .expect("workspace edit")
        .changes["file:///tmp/User.ts"][0]
            .new_text,
        "Account"
    );
}

#[test]
fn parses_workspace_edit_merges_repeated_text_edits_for_same_uri() {
    let edit = parse_workspace_edit_result(&json!({
        "changes": {
            "file:///tmp/User.ts": [
                {
                    "range": {
                        "start": { "line": 1, "character": 0 },
                        "end": { "line": 1, "character": 4 }
                    },
                    "newText": "User"
                }
            ]
        },
        "documentChanges": [
            {
                "textDocument": { "uri": "file:///tmp/User.ts" },
                "edits": [
                    {
                        "range": {
                            "start": { "line": 2, "character": 0 },
                            "end": { "line": 2, "character": 6 }
                        },
                        "newText": "Account"
                    }
                ]
            },
            {
                "textDocument": { "uri": "file:///tmp/User.ts" },
                "edits": [
                    {
                        "range": {
                            "start": { "line": 3, "character": 0 },
                            "end": { "line": 3, "character": 7 }
                        },
                        "newText": "Profile"
                    }
                ]
            }
        ]
    }))
    .expect("workspace edit")
    .expect("workspace edit result");

    let edits = &edit.changes["file:///tmp/User.ts"];
    assert_eq!(edits.len(), 3);
    assert_eq!(edits[0].new_text, "User");
    assert_eq!(edits[1].new_text, "Account");
    assert_eq!(edits[2].new_text, "Profile");
}

#[test]
fn parses_code_actions_with_workspace_edits() {
    let actions = parse_code_action_result(&json!([
        {
            "title": "Add missing import",
            "kind": "quickfix",
            "isPreferred": true,
            "edit": {
                "changes": {
                    "file:///tmp/User.ts": [
                        {
                            "range": {
                                "start": { "line": 0, "character": 0 },
                                "end": { "line": 0, "character": 0 }
                            },
                            "newText": "import { User } from './user';\n"
                        }
                    ]
                }
            }
        }
    ]))
    .expect("code actions");

    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].title, "Add missing import");
    assert_eq!(actions[0].kind.as_deref(), Some("quickfix"));
    assert!(actions[0].is_preferred);
    assert_eq!(actions[0].command, None);
    assert_eq!(actions[0].data, None);
    assert_eq!(actions[0].disabled, None);
    assert_eq!(
        actions[0].edit.as_ref().expect("edit").changes["file:///tmp/User.ts"][0].new_text,
        "import { User } from './user';\n"
    );
}

#[test]
fn parses_disabled_code_actions_without_edits_or_commands() {
    let actions = parse_code_action_result(&json!([
        {
            "title": "Extract function",
            "kind": "refactor.extract",
            "disabled": {
                "reason": "Cannot extract from this selection."
            }
        }
    ]))
    .expect("code actions");

    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].title, "Extract function");
    assert_eq!(actions[0].kind.as_deref(), Some("refactor.extract"));
    assert_eq!(
        actions[0].disabled.as_ref().expect("disabled").reason,
        "Cannot extract from this selection."
    );
    assert_eq!(actions[0].edit, None);
    assert_eq!(actions[0].command, None);
    assert_eq!(actions[0].data, None);
}

#[test]
fn parses_code_action_commands_and_resolve_data() {
    let actions = parse_code_action_result(&json!([
        {
            "title": "Fix all unused identifiers",
            "kind": "quickfix",
            "data": { "globalId": 1, "providerId": 2 },
            "command": {
                "title": "Fix all unused identifiers",
                "command": "_typescript.applyFixAllCodeAction",
                "arguments": [{ "tsActionId": "unusedIdentifier" }]
            }
        },
        {
            "title": "Organize imports",
            "kind": "source.organizeImports",
            "command": "_typescript.organizeImports",
            "arguments": ["file:///tmp/User.ts"]
        }
    ]))
    .expect("code actions");

    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].data.as_ref().expect("data")["globalId"], 1);
    assert_eq!(
        actions[0].command.as_ref().expect("command").command,
        "_typescript.applyFixAllCodeAction"
    );
    assert_eq!(
        actions[0]
            .command
            .as_ref()
            .expect("command")
            .arguments
            .as_ref()
            .expect("arguments")[0]["tsActionId"],
        "unusedIdentifier"
    );
    assert_eq!(
        actions[1].command.as_ref().expect("command"),
        &LanguageServerCodeActionCommand {
            arguments: Some(vec![json!("file:///tmp/User.ts")]),
            command: "_typescript.organizeImports".to_string(),
            title: "Organize imports".to_string(),
        }
    );
}

#[test]
fn resolved_code_actions_default_missing_optional_flags() {
    let action = serde_json::from_value::<LanguageServerCodeAction>(json!({
        "title": "Organize imports",
        "kind": "source.organizeImports",
        "edit": {
            "changes": {
                "file:///tmp/User.ts": []
            }
        }
    }))
    .expect("resolved action");

    assert!(!action.is_preferred);
    assert_eq!(action.command, None);
    assert_eq!(action.data, None);
}

#[test]
fn parses_formatting_text_edits() {
    assert_eq!(
        parse_formatting_result(&json!([
            {
                "range": {
                    "start": { "line": 2, "character": 0 },
                    "end": { "line": 2, "character": 4 }
                },
                "newText": "  "
            }
        ]))
        .expect("formatting"),
        vec![LanguageServerTextEdit {
            range: range(2, 0, 2, 4),
            new_text: "  ".to_string(),
        }]
    );
    assert_eq!(parse_formatting_result(&json!(null)).expect("null"), []);
}

#[test]
fn parses_inlay_hints_with_string_and_part_labels() {
    let hints = parse_inlay_hints_result(&json!([
        {
            "position": { "line": 2, "character": 10 },
            "label": ": User",
            "kind": 1,
            "data": { "hintId": 1 },
            "paddingLeft": true,
            "textEdits": [
                {
                    "range": {
                        "start": { "line": 2, "character": 10 },
                        "end": { "line": 2, "character": 10 }
                    },
                    "newText": ": User"
                }
            ],
            "tooltip": { "kind": "markdown", "value": "Inferred type" }
        },
        {
            "position": { "line": 3, "character": 6 },
            "label": [
                {
                    "value": "name",
                    "tooltip": "Property name",
                    "command": {
                        "title": "Apply import",
                        "command": "_typescript.applyCompletionCodeAction",
                        "arguments": [{ "file": "/project/src/User.ts" }]
                    },
                    "location": {
                        "uri": "file:///project/src/User.ts",
                        "range": {
                            "start": { "line": 0, "character": 1 },
                            "end": { "line": 0, "character": 5 }
                        }
                    }
                },
                { "value": ":" }
            ],
            "kind": 2,
            "paddingRight": true
        }
    ]))
    .expect("inlay hints");

    assert_eq!(hints.len(), 2);
    assert_eq!(
        hints[0].label,
        LanguageServerInlayHintLabel::Text(": User".to_string())
    );
    assert_eq!(hints[0].data, Some(json!({ "hintId": 1 })));
    assert_eq!(hints[0].kind, Some(1));
    assert!(hints[0].padding_left);
    assert_eq!(
        hints[0].text_edits,
        vec![LanguageServerTextEdit {
            range: LanguageServerRange {
                start: LanguageServerPosition {
                    line: 2,
                    character: 10,
                },
                end: LanguageServerPosition {
                    line: 2,
                    character: 10,
                },
            },
            new_text: ": User".to_string(),
        }]
    );
    assert_eq!(hints[0].tooltip.as_deref(), Some("Inferred type"));
    assert_eq!(
        hints[1].label,
        LanguageServerInlayHintLabel::Parts(vec![
            LanguageServerInlayHintLabelPart {
                command: Some(LanguageServerCodeActionCommand {
                    arguments: Some(vec![json!({ "file": "/project/src/User.ts" })]),
                    command: "_typescript.applyCompletionCodeAction".to_string(),
                    title: "Apply import".to_string(),
                }),
                label: "name".to_string(),
                tooltip: Some("Property name".to_string()),
                location: Some(LanguageServerLocation {
                    uri: "file:///project/src/User.ts".to_string(),
                    range: LanguageServerRange {
                        start: LanguageServerPosition {
                            line: 0,
                            character: 1,
                        },
                        end: LanguageServerPosition {
                            line: 0,
                            character: 5,
                        },
                    },
                }),
            },
            LanguageServerInlayHintLabelPart {
                command: None,
                label: ":".to_string(),
                tooltip: None,
                location: None,
            },
        ])
    );
    assert_eq!(hints[1].kind, Some(2));
    assert!(hints[1].padding_right);
    assert_eq!(parse_inlay_hints_result(&json!(null)).expect("null"), []);
    assert_eq!(
        parse_inlay_hint_result(&json!({
            "position": { "line": 1, "character": 10 },
            "label": ": Resolved",
            "data": { "hintId": 2 }
        }))
        .expect("resolved")
        .data,
        Some(json!({ "hintId": 2 }))
    );
}

#[test]
fn parses_signature_help_with_string_and_range_parameter_labels() {
    let signature = parse_signature_help_result(&json!({
        "activeSignature": 0,
        "activeParameter": 1,
        "signatures": [
            {
                "label": "loadUser(id: string, options?: Options): Promise<User>",
                "documentation": { "kind": "markdown", "value": "Loads a user." },
                "parameters": [
                    {
                        "label": "id: string",
                        "documentation": "User id"
                    },
                    {
                        "label": [21, 38]
                    }
                ]
            }
        ]
    }))
    .expect("signature help")
    .expect("signature");

    assert_eq!(signature.active_signature, 0);
    assert_eq!(signature.active_parameter, 1);
    assert_eq!(
        signature.signatures[0].documentation.as_deref(),
        Some("Loads a user.")
    );
    assert_eq!(signature.signatures[0].parameters[0].label, "id: string");
    assert_eq!(
        signature.signatures[0].parameters[0]
            .documentation
            .as_deref(),
        Some("User id")
    );
    assert_eq!(
        signature.signatures[0].parameters[1].label,
        "options?: Options"
    );
    assert!(parse_signature_help_result(&json!(null))
        .expect("null")
        .is_none());
}

#[test]
fn parses_hierarchical_and_flat_document_symbols() {
    let symbols = parse_document_symbols_result(&json!([
        {
            "name": "UserService",
            "kind": 5,
            "range": {
                "start": { "line": 1, "character": 0 },
                "end": { "line": 6, "character": 1 }
            },
            "selectionRange": {
                "start": { "line": 1, "character": 13 },
                "end": { "line": 1, "character": 24 }
            },
            "tags": [1],
            "children": [
                {
                    "name": "loadUser",
                    "detail": "(id: string)",
                    "kind": 6,
                    "range": {
                        "start": { "line": 2, "character": 2 },
                        "end": { "line": 4, "character": 3 }
                    },
                    "selectionRange": {
                        "start": { "line": 2, "character": 8 },
                        "end": { "line": 2, "character": 16 }
                    }
                }
            ]
        },
        {
            "name": "createUser",
            "kind": 12,
            "containerName": "UserFactory",
            "tags": [1],
            "location": {
                "uri": "file:///tmp/User.ts",
                "range": {
                    "start": { "line": 8, "character": 0 },
                    "end": { "line": 10, "character": 1 }
                }
            }
        }
    ]))
    .expect("symbols");

    assert_eq!(symbols[0].name, "UserService");
    assert_eq!(symbols[0].tags, vec![1]);
    assert_eq!(symbols[0].children[0].name, "loadUser");
    assert_eq!(symbols[0].children[0].tags, Vec::<u32>::new());
    assert_eq!(
        symbols[0].children[0].detail.as_deref(),
        Some("(id: string)")
    );
    assert_eq!(symbols[1].container_name.as_deref(), Some("UserFactory"));
    assert_eq!(symbols[1].selection_range.start.line, 8);
    assert_eq!(symbols[1].tags, vec![1]);
    assert_eq!(
        parse_document_symbols_result(&json!(null)).expect("null"),
        Vec::new()
    );
}

#[test]
fn parses_workspace_symbols_with_and_without_ranges() {
    let symbols = parse_workspace_symbols_result(&json!([
        {
            "name": "UserService",
            "kind": 5,
            "containerName": "App",
            "location": {
                "uri": "file:///tmp/UserService.ts",
                "range": {
                    "start": { "line": 1, "character": 13 },
                    "end": { "line": 6, "character": 1 }
                }
            }
        },
        {
            "name": "UnresolvedSymbol",
            "kind": 5,
            "location": {
                "uri": "file:///tmp/Unresolved.ts"
            }
        }
    ]))
    .expect("symbols");

    assert_eq!(symbols[0].name, "UserService");
    assert_eq!(symbols[0].container_name.as_deref(), Some("App"));
    assert_eq!(
        symbols[0]
            .location
            .as_ref()
            .expect("location")
            .range
            .start
            .line,
        1
    );
    assert!(symbols[1].location.is_none());
    assert_eq!(
        parse_workspace_symbols_result(&json!(null)).expect("null"),
        Vec::new()
    );
}

#[test]
fn parses_document_highlights() {
    let highlights = parse_document_highlights_result(&json!([
        {
            "range": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 8 }
            },
            "kind": 2
        },
        {
            "range": {
                "start": { "line": 5, "character": 1 },
                "end": { "line": 5, "character": 5 }
            }
        }
    ]))
    .expect("highlights");

    assert_eq!(highlights.len(), 2);
    assert_eq!(highlights[0].kind, Some(2));
    assert_eq!(highlights[0].range.start.line, 2);
    assert_eq!(highlights[1].kind, None);
    assert_eq!(
        parse_document_highlights_result(&json!(null)).expect("null"),
        Vec::new()
    );
}

#[test]
fn parses_document_links() {
    let links = parse_document_links_result(&json!([
        {
            "range": {
                "start": { "line": 1, "character": 7 },
                "end": { "line": 1, "character": 15 }
            },
            "target": "file:///tmp/user.ts",
            "tooltip": "Open user module",
            "data": { "source": "typescript" }
        },
        {
            "range": {
                "start": { "line": 3, "character": 0 },
                "end": { "line": 3, "character": 10 }
            }
        }
    ]))
    .expect("links");

    assert_eq!(links.len(), 2);
    assert_eq!(links[0].target.as_deref(), Some("file:///tmp/user.ts"));
    assert_eq!(links[0].tooltip.as_deref(), Some("Open user module"));
    assert_eq!(
        links[0].data.as_ref().expect("data")["source"],
        "typescript"
    );
    assert_eq!(links[1].target, None);
    assert_eq!(parse_document_links_result(&json!(null)).expect("null"), []);
}

#[test]
fn parses_folding_ranges() {
    let ranges = parse_folding_ranges_result(&json!([
        {
            "startLine": 2,
            "startCharacter": 4,
            "endLine": 8,
            "endCharacter": 1,
            "kind": "region"
        },
        {
            "startLine": 12,
            "endLine": 15
        }
    ]))
    .expect("folding ranges");

    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[0].start_line, 2);
    assert_eq!(ranges[0].start_character, Some(4));
    assert_eq!(ranges[0].end_line, 8);
    assert_eq!(ranges[0].end_character, Some(1));
    assert_eq!(ranges[0].kind.as_deref(), Some("region"));
    assert_eq!(ranges[1].start_character, None);
    assert_eq!(ranges[1].kind, None);
    assert_eq!(
        parse_folding_ranges_result(&json!(null)).expect("null"),
        Vec::new()
    );
}

#[test]
fn parses_prepare_rename_variants() {
    let with_placeholder = parse_prepare_rename_result(&json!({
        "range": {
            "start": { "line": 2, "character": 4 },
            "end": { "line": 2, "character": 12 }
        },
        "placeholder": "userName"
    }))
    .expect("prepare rename")
    .expect("result");

    assert!(!with_placeholder.default_behavior);
    assert_eq!(with_placeholder.placeholder.as_deref(), Some("userName"));
    assert_eq!(with_placeholder.range.expect("range").start.character, 4);

    let range_only = parse_prepare_rename_result(&json!({
        "start": { "line": 5, "character": 1 },
        "end": { "line": 5, "character": 4 }
    }))
    .expect("prepare rename")
    .expect("result");

    assert!(!range_only.default_behavior);
    assert_eq!(range_only.placeholder, None);
    assert_eq!(range_only.range.expect("range").end.character, 4);

    let default_behavior = parse_prepare_rename_result(&json!({
        "defaultBehavior": true
    }))
    .expect("prepare rename")
    .expect("result");

    assert!(default_behavior.default_behavior);
    assert_eq!(default_behavior.range, None);
    assert_eq!(
        parse_prepare_rename_result(&json!(null)).expect("null"),
        None
    );
}

#[test]
fn parses_selection_ranges_with_parents() {
    let ranges = parse_selection_ranges_result(&json!([
        {
            "range": {
                "start": { "line": 2, "character": 8 },
                "end": { "line": 2, "character": 16 }
            },
            "parent": {
                "range": {
                    "start": { "line": 2, "character": 2 },
                    "end": { "line": 4, "character": 3 }
                }
            }
        }
    ]))
    .expect("selection ranges");

    assert_eq!(ranges.len(), 1);
    assert_eq!(ranges[0].range.start.character, 8);
    assert_eq!(ranges[0].parent.as_ref().expect("parent").range.end.line, 4);
    assert_eq!(
        parse_selection_ranges_result(&json!(null)).expect("null"),
        Vec::new()
    );
}

#[test]
fn parses_semantic_tokens() {
    let tokens = parse_semantic_tokens_result(&json!({
        "resultId": "semantic-1",
        "data": [0, 6, 4, 8, 0, 1, 2, 3, 9, 1]
    }))
    .expect("semantic tokens")
    .expect("result");

    assert_eq!(tokens.result_id.as_deref(), Some("semantic-1"));
    assert_eq!(tokens.data, vec![0, 6, 4, 8, 0, 1, 2, 3, 9, 1]);
    assert_eq!(
        parse_semantic_tokens_result(&json!(null)).expect("null"),
        None
    );
    assert!(parse_semantic_tokens_result(&json!({ "data": ["bad"] })).is_err());
}

#[test]
fn parses_call_hierarchy_items_and_calls() {
    let item = json!({
        "name": "renderUser",
        "kind": 12,
        "tags": [1],
        "detail": "src/User.ts",
        "uri": "file:///tmp/User.ts",
        "range": json!(range(2, 0, 2, 24)),
        "selectionRange": json!(range(2, 9, 2, 19)),
        "data": { "symbolId": "renderUser" },
    });

    let items =
        parse_call_hierarchy_items_result(&json!([item.clone()])).expect("call hierarchy items");
    let incoming = parse_incoming_calls_result(&json!([{
        "from": item.clone(),
        "fromRanges": [json!(range(8, 4, 8, 14))]
    }]))
    .expect("incoming calls");
    let outgoing = parse_outgoing_calls_result(&json!([{
        "to": item,
        "fromRanges": [json!(range(10, 2, 10, 16))]
    }]))
    .expect("outgoing calls");

    assert_eq!(items[0].name, "renderUser");
    assert_eq!(items[0].selection_range.start.character, 9);
    assert_eq!(incoming[0].from.name, "renderUser");
    assert_eq!(incoming[0].from_ranges[0].start.line, 8);
    assert_eq!(outgoing[0].to.name, "renderUser");
    assert_eq!(outgoing[0].from_ranges[0].end.character, 16);
    assert_eq!(
        parse_call_hierarchy_items_result(&json!(null)).expect("null"),
        Vec::new()
    );
    assert_eq!(
        parse_incoming_calls_result(&json!(null)).expect("null"),
        Vec::new()
    );
    assert_eq!(
        parse_outgoing_calls_result(&json!(null)).expect("null"),
        Vec::new()
    );
    assert!(parse_call_hierarchy_items_result(&json!({})).is_err());
    assert!(parse_incoming_calls_result(&json!({})).is_err());
    assert!(parse_outgoing_calls_result(&json!({})).is_err());
}

#[test]
fn parses_type_hierarchy_items() {
    let item = json!({
        "name": "BaseView",
        "kind": 5,
        "tags": [1],
        "detail": "src/View.ts",
        "uri": "file:///tmp/View.ts",
        "range": json!(range(3, 0, 3, 24)),
        "selectionRange": json!(range(3, 6, 3, 14)),
        "data": { "symbolId": "BaseView" },
    });

    let items = parse_type_hierarchy_items_result(&json!([item])).expect("type hierarchy items");

    assert_eq!(items[0].name, "BaseView");
    assert_eq!(items[0].selection_range.start.character, 6);
    assert_eq!(
        parse_type_hierarchy_items_result(&json!(null)).expect("null"),
        Vec::new()
    );
    assert!(parse_type_hierarchy_items_result(&json!({})).is_err());
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
