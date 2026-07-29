#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn register_workspace_path_preserves_alias_and_returns_canonical_identity() {
    use std::os::unix::fs::symlink;

    let registry = WorkspaceRegistry::new();
    let root = temp_workspace("register-alias");
    let alias = root.with_extension(format!("alias-{}", unique_suffix()));
    symlink(&root, &alias).expect("workspace alias");

    let descriptor =
        register_workspace_path_in_registry(&registry, alias.to_str().expect("UTF-8 alias path"))
            .expect("register aliased workspace");

    assert_eq!(descriptor.selected_root_path, alias);
    assert_eq!(descriptor.canonical_root_path, root);
    assert_eq!(
        registry
            .descriptor(&descriptor.workspace_id)
            .expect("registered descriptor"),
        descriptor
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn register_workspace_path_preserves_lexical_parent_and_returns_canonical_identity() {
    let registry = WorkspaceRegistry::new();
    let root = temp_workspace("register-lexical-parent");
    let child = root.join("child");
    fs::create_dir(&child).expect("workspace child");
    let selected = child.join("..");

    let descriptor = register_workspace_path_in_registry(
        &registry,
        selected.to_str().expect("UTF-8 selected path"),
    )
    .expect("register lexical workspace path");

    assert_eq!(descriptor.selected_root_path, selected);
    assert_eq!(descriptor.canonical_root_path, root);
}

#[test]
fn register_workspace_path_rejects_relative_roots() {
    let registry = WorkspaceRegistry::new();

    let error = register_workspace_path_in_registry(&registry, "relative/workspace")
        .expect_err("relative workspace root must be rejected");

    assert_eq!(error, "Workspace root path must be absolute");
}

#[test]
fn index_path_guard_accepts_workspace_paths() {
    let root = temp_workspace("accepts");
    let source_directory = root.join("src");
    fs::create_dir_all(&source_directory).expect("source directory");
    fs::write(source_directory.join("User.php"), "<?php").expect("source file");

    assert!(ensure_path_in_workspace(&root, &path_string(&root.join("src/User.php"))).is_ok());
    assert!(ensure_path_in_workspace(&root, "src/Missing.php").is_ok());
    assert!(
        ensure_path_in_workspace(&root, &path_string(&root.join(".").join("src/User.php"))).is_ok()
    );
}

#[test]
fn javascript_typescript_configuration_notifications_use_language_namespaces() {
    let settings = json!({
        "format": {
            "insertSpaceAfterCommaDelimiter": true,
        },
        "formattingOptions": {
            "insertSpaces": false,
            "tabSize": 8,
        },
        "implicitProjectConfiguration": {
            "checkJs": false,
            "strict": true,
            "target": 11,
        },
        "implementationsCodeLens": {
            "enabled": true,
        },
        "inlayHints": {
            "functionLikeReturnTypes": { "enabled": false },
            "parameterNames": {
                "enabled": "none",
                "suppressWhenArgumentMatchesName": false,
            },
        },
        "referencesCodeLens": {
            "enabled": true,
            "showOnAllFunctions": false,
        },
        "preferences": {
            "importModuleSpecifierEnding": "minimal",
        },
        "suggest": {
            "autoImports": false,
            "includeCompletionsForModuleExports": false,
        },
        "validate": {
            "enable": false,
        },
    });

    let notification = javascript_typescript_did_change_configuration_settings(&settings);

    for language in ["javascript", "typescript"] {
        assert_eq!(notification[language]["suggest"]["autoImports"], false);
        assert_eq!(
            notification[language]["inlayHints"]["parameterNames"]["enabled"],
            "none"
        );
        assert_eq!(
            notification[language]["implementationsCodeLens"]["enabled"],
            true
        );
        assert_eq!(
            notification[language]["referencesCodeLens"]["enabled"],
            true
        );
        assert_eq!(
            notification[language]["format"]["insertSpaceAfterCommaDelimiter"],
            true
        );
        assert_eq!(
            notification[language]["preferences"]["importModuleSpecifierEnding"],
            "minimal"
        );
        assert_eq!(notification[language]["validate"]["enable"], false);
        assert!(notification[language].get("formattingOptions").is_none());
        assert!(notification[language]
            .get("implicitProjectConfiguration")
            .is_none());
    }
    assert_eq!(notification["implicitProjectConfiguration"]["strict"], true);
    assert_eq!(notification["formattingOptions"]["insertSpaces"], false);
    assert_eq!(notification["formattingOptions"]["tabSize"], 8);
}

#[test]
fn index_path_guard_rejects_paths_outside_workspace() {
    let root = temp_workspace("rejects-root");
    let sibling = root
        .parent()
        .expect("workspace parent")
        .join(format!("{}-sibling", unique_suffix()));
    fs::create_dir_all(&sibling).expect("sibling directory");
    fs::write(sibling.join("User.php"), "<?php").expect("sibling file");

    assert!(ensure_path_in_workspace(&root, &path_string(&sibling.join("User.php"))).is_err());
    assert!(ensure_path_in_workspace(&root, "../outside/User.php").is_err());
}

#[test]
fn lsp_path_guard_rejects_document_paths_outside_workspace_root() {
    let root = temp_workspace("lsp-rejects-root");
    let sibling = root
        .parent()
        .expect("workspace parent")
        .join(format!("{}-sibling", unique_suffix()));
    fs::create_dir_all(&sibling).expect("sibling directory");
    fs::write(sibling.join("App.ts"), "export {};").expect("sibling file");

    assert!(ensure_lsp_path_in_workspace(&path_string(&root), "src/App.ts").is_ok());
    assert!(ensure_lsp_path_in_workspace(
        &path_string(&root),
        &path_string(&sibling.join("App.ts"))
    )
    .is_err());
}

#[test]
fn lsp_document_identity_collapses_dot_segments_and_symlink_aliases() {
    use std::os::unix::fs::symlink;
    let root = temp_workspace("lsp-canonical-identity");
    fs::create_dir_all(root.join("real")).expect("real directory");
    fs::write(root.join("real/App.ts"), "export {};").expect("document");
    symlink(root.join("real"), root.join("alias")).expect("inside symlink");
    let root_path = path_string(&root);
    let canonical =
        canonical_lsp_document_identity(&root_path, &path_string(&root.join("real/App.ts")))
            .expect("canonical identity");
    assert_eq!(
        canonical_lsp_document_identity(
            &root_path,
            &path_string(&root.join("real/../real/App.ts"))
        )
        .expect("dot-segment identity"),
        canonical
    );
    assert_eq!(
        canonical_lsp_document_identity(&root_path, &path_string(&root.join("alias/App.ts")))
            .expect("symlink identity"),
        canonical
    );
}

#[test]
fn lsp_workspace_edit_guard_rejects_paths_outside_workspace_root() {
    let root = temp_workspace("workspace-edit-guard-root");
    let outside = temp_workspace("workspace-edit-guard-outside");
    let mut inside_changes = BTreeMap::new();
    inside_changes.insert(file_uri(&root.join("src/App.ts")), Vec::new());
    let mut outside_changes = BTreeMap::new();
    outside_changes.insert(file_uri(&outside.join("Secret.ts")), Vec::new());
    let mut non_file_changes = BTreeMap::new();
    non_file_changes.insert("untitled:Scratch.ts".to_string(), Vec::new());
    let inside_operations = vec![
        LanguageServerWorkspaceFileOperation::Create {
            uri: file_uri(&root.join("src/Created.ts")),
            options: None,
        },
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri: file_uri(&root.join("src/Old.ts")),
            new_uri: file_uri(&root.join("src/New.ts")),
            options: None,
        },
        LanguageServerWorkspaceFileOperation::Delete {
            uri: file_uri(&root.join("src/Deleted.ts")),
            options: None,
        },
    ];
    let outside_operations = vec![LanguageServerWorkspaceFileOperation::Rename {
        old_uri: file_uri(&root.join("src/Old.ts")),
        new_uri: file_uri(&outside.join("Secret.ts")),
        options: None,
    }];
    let non_file_operations = vec![LanguageServerWorkspaceFileOperation::Create {
        uri: "https://example.test/Created.ts".to_string(),
        options: None,
    }];

    assert!(ensure_lsp_workspace_edit_paths_in_workspace(
        &path_string(&root),
        &LanguageServerWorkspaceEdit {
            changes: inside_changes,
            document_versions: BTreeMap::new(),
            file_operations: inside_operations,
        }
    )
    .is_ok());
    assert!(ensure_lsp_workspace_edit_paths_in_workspace(
        &path_string(&root),
        &LanguageServerWorkspaceEdit {
            changes: outside_changes,
            document_versions: BTreeMap::new(),
            file_operations: Vec::new(),
        }
    )
    .is_err());
    assert!(ensure_lsp_workspace_edit_paths_in_workspace(
        &path_string(&root),
        &LanguageServerWorkspaceEdit {
            changes: BTreeMap::new(),
            document_versions: BTreeMap::new(),
            file_operations: outside_operations,
        }
    )
    .is_err());
    assert!(ensure_lsp_workspace_edit_paths_in_workspace(
        &path_string(&root),
        &LanguageServerWorkspaceEdit {
            changes: non_file_changes,
            document_versions: BTreeMap::new(),
            file_operations: Vec::new(),
        }
    )
    .is_err());
    assert!(ensure_lsp_workspace_edit_paths_in_workspace(
        &path_string(&root),
        &LanguageServerWorkspaceEdit {
            changes: BTreeMap::new(),
            document_versions: BTreeMap::new(),
            file_operations: non_file_operations,
        }
    )
    .is_err());
}

#[test]
fn lsp_response_workspace_edit_filter_drops_outside_file_uris() {
    let root = temp_workspace("response-workspace-edit-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("response-workspace-edit-outside");
    let inside_uri = file_uri(&root.join("src/App.ts"));
    let sibling_uri = file_uri(&sibling.join("src/App.ts"));
    let outside_uri = file_uri(&outside.join("src/App.ts"));
    let inside_created_uri = file_uri(&root.join("src/Created.ts"));
    let sibling_created_uri = file_uri(&sibling.join("src/Created.ts"));
    let inside_old_uri = file_uri(&root.join("src/Old.ts"));
    let inside_new_uri = file_uri(&root.join("src/New.ts"));

    let mut changes = BTreeMap::new();
    changes.insert(inside_uri.clone(), vec![text_edit("inside")]);
    changes.insert(sibling_uri.clone(), vec![text_edit("sibling")]);
    changes.insert(outside_uri.clone(), vec![text_edit("outside")]);
    let mut document_versions = BTreeMap::new();
    document_versions.insert(inside_uri.clone(), Some(7));
    document_versions.insert(sibling_uri.clone(), Some(8));
    document_versions.insert(outside_uri.clone(), Some(9));

    let filtered = filter_lsp_workspace_edit_to_workspace(
        &path_string(&root),
        LanguageServerWorkspaceEdit {
            changes,
            document_versions,
            file_operations: vec![
                LanguageServerWorkspaceFileOperation::Create {
                    uri: inside_created_uri.clone(),
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Create {
                    uri: sibling_created_uri,
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Rename {
                    old_uri: inside_old_uri.clone(),
                    new_uri: inside_new_uri.clone(),
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Rename {
                    old_uri: inside_old_uri.clone(),
                    new_uri: sibling_uri,
                    options: None,
                },
            ],
        },
    )
    .expect("filtered workspace edit")
    .expect("workspace edit with inside changes");

    assert_eq!(filtered.changes.len(), 1);
    assert_eq!(filtered.changes[&inside_uri][0].new_text, "inside");
    assert_eq!(filtered.document_versions.len(), 1);
    assert_eq!(filtered.document_versions[&inside_uri], Some(7));
    assert_eq!(
        filtered.file_operations,
        vec![
            LanguageServerWorkspaceFileOperation::Create {
                uri: inside_created_uri,
                options: None,
            },
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri: inside_old_uri,
                new_uri: inside_new_uri,
                options: None,
            },
        ]
    );
}

#[test]
fn lsp_response_location_filter_drops_outside_file_uris() {
    let root = temp_workspace("response-location-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("response-location-outside");
    let inside_uri = file_uri(&root.join("src/App.ts"));

    let filtered = filter_lsp_locations_to_workspace(
        &path_string(&root),
        vec![
            location(&inside_uri),
            location(&file_uri(&sibling.join("src/App.ts"))),
            location(&file_uri(&outside.join("src/App.ts"))),
        ],
    )
    .expect("filtered locations");

    assert_eq!(filtered, vec![location(&inside_uri)]);
}

#[test]
fn javascript_typescript_navigation_locations_preserve_external_file_uris() {
    let root = temp_workspace("js-ts-navigation-root");
    let external = temp_workspace("js-ts-navigation-external");
    let inside_uri = file_uri(&root.join("src/App.ts"));
    let external_definition_uri = file_uri(&external.join("node_modules/pkg/index.d.ts"));
    let external_type_uri = file_uri(&external.join("typescript/lib/lib.dom.d.ts"));

    let locations = parse_javascript_typescript_navigation_locations_result(&json!([
        {
            "uri": inside_uri,
            "range": lsp_range(),
        },
        {
            "uri": external_definition_uri,
            "range": lsp_range(),
        },
        {
            "targetUri": external_type_uri,
            "targetRange": lsp_range(),
        }
    ]))
    .expect("navigation locations");

    assert_eq!(
        locations,
        vec![
            location(&inside_uri),
            location(&external_definition_uri),
            location(&external_type_uri),
        ]
    );
}

#[test]
fn javascript_typescript_reference_locations_drop_external_file_uris() {
    let root = temp_workspace("js-ts-references-root");
    let external = temp_workspace("js-ts-references-external");
    let inside_uri = file_uri(&root.join("src/App.ts"));
    let external_uri = file_uri(&external.join("node_modules/pkg/index.d.ts"));
    let reference_locations = parse_definition_result(&json!([
        {
            "uri": inside_uri,
            "range": lsp_range(),
        },
        {
            "uri": external_uri,
            "range": lsp_range(),
        }
    ]))
    .expect("reference locations");

    let filtered = filter_lsp_locations_to_workspace(&path_string(&root), reference_locations)
        .expect("filtered reference locations");

    assert_eq!(filtered, vec![location(&inside_uri)]);
}

#[test]
fn lsp_response_workspace_symbol_filter_drops_outside_file_uris() {
    let root = temp_workspace("response-workspace-symbol-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("response-workspace-symbol-outside");
    let inside_uri = file_uri(&root.join("src/App.ts"));

    let filtered = filter_lsp_workspace_symbols_to_workspace(
        &path_string(&root),
        vec![
            workspace_symbol("App", &inside_uri),
            workspace_symbol("SiblingApp", &file_uri(&sibling.join("src/App.ts"))),
            workspace_symbol("OutsideApp", &file_uri(&outside.join("src/App.ts"))),
        ],
    )
    .expect("filtered workspace symbols");

    assert_eq!(filtered, vec![workspace_symbol("App", &inside_uri)]);
}

#[test]
fn lsp_response_call_hierarchy_filter_drops_outside_file_uris() {
    let root = temp_workspace("response-call-hierarchy-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("response-call-hierarchy-outside");
    let inside_uri = file_uri(&root.join("src/App.ts"));
    let sibling_uri = file_uri(&sibling.join("src/App.ts"));
    let outside_uri = file_uri(&outside.join("src/App.ts"));

    let items = filter_lsp_call_hierarchy_items_to_workspace(
        &path_string(&root),
        vec![
            call_hierarchy_item(&inside_uri),
            call_hierarchy_item(&sibling_uri),
            call_hierarchy_item(&outside_uri),
        ],
    )
    .expect("filtered call hierarchy items");
    let incoming = filter_lsp_incoming_calls_to_workspace(
        &path_string(&root),
        vec![
            incoming_call(&inside_uri),
            incoming_call(&sibling_uri),
            incoming_call(&outside_uri),
        ],
    )
    .expect("filtered incoming calls");
    let outgoing = filter_lsp_outgoing_calls_to_workspace(
        &path_string(&root),
        vec![
            outgoing_call(&inside_uri),
            outgoing_call(&sibling_uri),
            outgoing_call(&outside_uri),
        ],
    )
    .expect("filtered outgoing calls");

    assert_eq!(items, vec![call_hierarchy_item(&inside_uri)]);
    assert_eq!(incoming, vec![incoming_call(&inside_uri)]);
    assert_eq!(outgoing, vec![outgoing_call(&inside_uri)]);
}

#[test]
fn lsp_response_type_hierarchy_filter_drops_outside_file_uris() {
    let root = temp_workspace("response-type-hierarchy-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("response-type-hierarchy-outside");
    let inside_uri = file_uri(&root.join("src/App.ts"));

    let filtered = filter_lsp_type_hierarchy_items_to_workspace(
        &path_string(&root),
        vec![
            type_hierarchy_item(&inside_uri),
            type_hierarchy_item(&file_uri(&sibling.join("src/App.ts"))),
            type_hierarchy_item(&file_uri(&outside.join("src/App.ts"))),
        ],
    )
    .expect("filtered type hierarchy items");

    assert_eq!(filtered, vec![type_hierarchy_item(&inside_uri)]);
}

#[test]
fn lsp_path_guard_rejects_php_document_sync_and_feature_paths_outside_workspace_root() {
    let root = temp_workspace("php-lsp-guard-root");
    let outside = temp_workspace("php-lsp-guard-outside");
    let source_directory = root.join("src");
    fs::create_dir_all(&source_directory).expect("source directory");
    fs::write(source_directory.join("User.php"), "<?php").expect("source file");
    fs::write(outside.join("Secret.php"), "<?php").expect("outside file");
    let root_path = path_string(&root);
    let inside_path = path_string(&source_directory.join("User.php"));
    let outside_path = path_string(&outside.join("Secret.php"));

    assert!(ensure_lsp_text_document_content_in_workspace(
        &root_path,
        &php_document_content(&inside_path)
    )
    .is_ok());
    assert!(ensure_lsp_text_document_content_in_workspace(
        &root_path,
        &php_document_content(&outside_path)
    )
    .is_err());
    assert!(ensure_lsp_text_document_path_in_workspace(
        &root_path,
        &TextDocumentPath {
            path: outside_path.clone()
        }
    )
    .is_err());
    assert!(ensure_lsp_position_in_workspace(
        &root_path,
        &TextDocumentPosition {
            path: outside_path,
            line: 0,
            character: 0,
        }
    )
    .is_err());
}

#[test]
fn lsp_completion_resolve_guard_rejects_outside_payload_paths() {
    let root = temp_workspace("completion-resolve-root");
    let outside = temp_workspace("completion-resolve-outside");
    let inside_item = completion_item(json!({ "file": path_string(&root.join("src/App.ts")) }));
    let outside_path_item =
        completion_item(json!({ "file": path_string(&outside.join("Secret.ts")) }));
    let outside_uri_item = completion_item(json!({
        "uri": file_uri(&outside.join("Secret.ts")),
    }));

    assert!(
        ensure_lsp_completion_item_payload_in_workspace(&path_string(&root), &inside_item).is_ok()
    );
    assert!(ensure_lsp_completion_item_payload_in_workspace(
        &path_string(&root),
        &outside_path_item
    )
    .is_err());
    assert!(ensure_lsp_completion_item_payload_in_workspace(
        &path_string(&root),
        &outside_uri_item
    )
    .is_err());
}

#[test]
fn code_action_resolve_is_gated_on_server_resolve_capability() {
    let running_with_resolve = LanguageServerRuntimeStatus::Running {
        session_id: 1,
        capabilities: LanguageServerCapabilities {
            code_action: true,
            code_action_resolve: true,
            ..LanguageServerCapabilities::default()
        },
    };
    assert!(lsp_status_supports_code_action_resolve(
        &running_with_resolve
    ));

    let running_without_resolve = LanguageServerRuntimeStatus::Running {
        session_id: 1,
        capabilities: LanguageServerCapabilities {
            code_action: true,
            code_action_resolve: false,
            ..LanguageServerCapabilities::default()
        },
    };
    assert!(!lsp_status_supports_code_action_resolve(
        &running_without_resolve
    ));

    assert!(!lsp_status_supports_code_action_resolve(
        &LanguageServerRuntimeStatus::Starting { session_id: 1 }
    ));
    assert!(!lsp_status_supports_code_action_resolve(
        &LanguageServerRuntimeStatus::Stopped
    ));
}

#[test]
fn inlay_hint_resolve_is_gated_on_server_resolve_capability() {
    let running_with_resolve = LanguageServerRuntimeStatus::Running {
        session_id: 1,
        capabilities: LanguageServerCapabilities {
            inlay_hint: true,
            inlay_hint_resolve: true,
            ..LanguageServerCapabilities::default()
        },
    };
    assert!(lsp_status_supports_inlay_hint_resolve(
        &running_with_resolve
    ));

    let running_without_resolve = LanguageServerRuntimeStatus::Running {
        session_id: 1,
        capabilities: LanguageServerCapabilities {
            inlay_hint: true,
            inlay_hint_resolve: false,
            ..LanguageServerCapabilities::default()
        },
    };
    assert!(!lsp_status_supports_inlay_hint_resolve(
        &running_without_resolve
    ));

    assert!(!lsp_status_supports_inlay_hint_resolve(
        &LanguageServerRuntimeStatus::Starting { session_id: 1 }
    ));
    assert!(!lsp_status_supports_inlay_hint_resolve(
        &LanguageServerRuntimeStatus::Stopped
    ));
}

#[test]
fn lsp_code_action_resolve_guard_rejects_outside_edit_and_command_paths() {
    let root = temp_workspace("code-action-resolve-root");
    let outside = temp_workspace("code-action-resolve-outside");
    let inside_action = code_action(json!({
        "edit": {
            "changes": {
                file_uri(&root.join("src/App.ts")): []
            }
        }
    }));
    let outside_edit_action = code_action(json!({
        "edit": {
            "changes": {
                file_uri(&outside.join("Secret.ts")): []
            }
        }
    }));
    let outside_command_action = code_action(json!({
        "command": {
            "title": "Organize imports",
            "command": "_typescript.organizeImports",
            "arguments": [file_uri(&outside.join("Secret.ts"))]
        }
    }));

    assert!(
        ensure_lsp_code_action_payload_in_workspace(&path_string(&root), &inside_action).is_ok()
    );
    assert!(
        ensure_lsp_code_action_payload_in_workspace(&path_string(&root), &outside_edit_action)
            .is_err()
    );
    assert!(ensure_lsp_code_action_payload_in_workspace(
        &path_string(&root),
        &outside_command_action
    )
    .is_err());
}

#[test]
fn lsp_code_action_context_guard_rejects_outside_diagnostic_data() {
    let root = temp_workspace("code-action-context-root");
    let outside = temp_workspace("code-action-context-outside");
    let inside_context = code_action_context(json!({
        "file": path_string(&root.join("src/App.ts")),
    }));
    let outside_path_context = code_action_context(json!({
        "file": path_string(&outside.join("Secret.ts")),
    }));
    let outside_uri_context = code_action_context(json!({
        "uri": file_uri(&outside.join("Secret.ts")),
    }));

    assert!(ensure_lsp_code_action_context_payloads_in_workspace(
        &path_string(&root),
        &inside_context
    )
    .is_ok());
    assert!(ensure_lsp_code_action_context_payloads_in_workspace(
        &path_string(&root),
        &outside_path_context
    )
    .is_err());
    assert!(ensure_lsp_code_action_context_payloads_in_workspace(
        &path_string(&root),
        &outside_uri_context
    )
    .is_err());
}

#[test]
fn lsp_code_lens_and_document_link_resolve_guards_reject_outside_paths() {
    let root = temp_workspace("resolve-payload-root");
    let outside = temp_workspace("resolve-payload-outside");
    let inside_lens = code_lens(json!({
        "data": { "file": path_string(&root.join("src/App.ts")) }
    }));
    let outside_lens = code_lens(json!({
        "command": {
            "title": "3 references",
            "command": "editor.action.showReferences",
            "arguments": [file_uri(&outside.join("Secret.ts"))]
        }
    }));
    let outside_target_link = document_link(json!({
        "target": file_uri(&outside.join("Secret.ts"))
    }));
    let outside_data_link = document_link(json!({
        "data": { "file": path_string(&outside.join("Secret.ts")) }
    }));

    assert!(ensure_lsp_code_lens_payload_in_workspace(&path_string(&root), &inside_lens).is_ok());
    assert!(ensure_lsp_code_lens_payload_in_workspace(&path_string(&root), &outside_lens).is_err());
    assert!(ensure_lsp_document_link_payload_in_workspace(
        &path_string(&root),
        &outside_target_link
    )
    .is_err());
    assert!(
        ensure_lsp_document_link_payload_in_workspace(&path_string(&root), &outside_data_link)
            .is_err()
    );
}

#[test]
fn lsp_inlay_hint_resolve_guard_rejects_outside_payload_paths() {
    let root = temp_workspace("inlay-hint-resolve-root");
    let outside = temp_workspace("inlay-hint-resolve-outside");
    let inside_hint = inlay_hint(json!({
        "data": { "file": path_string(&root.join("src/App.ts")) },
        "label": [
            {
                "label": "App",
                "command": {
                    "title": "Apply import",
                    "command": "_typescript.applyCompletionCodeAction",
                    "arguments": [{ "file": path_string(&root.join("src/App.ts")) }],
                },
                "location": location(&file_uri(&root.join("src/App.ts"))),
            },
        ],
    }));
    let outside_data_hint = inlay_hint(json!({
        "data": { "file": path_string(&outside.join("Secret.ts")) },
    }));
    let outside_location_hint = inlay_hint(json!({
        "label": [
            {
                "label": "Secret",
                "location": location(&file_uri(&outside.join("Secret.ts"))),
            },
        ],
    }));
    let outside_command_hint = inlay_hint(json!({
        "label": [
            {
                "label": "Secret",
                "command": {
                    "title": "Apply import",
                    "command": "_typescript.applyCompletionCodeAction",
                    "arguments": [{ "file": path_string(&outside.join("Secret.ts")) }],
                },
            },
        ],
    }));

    assert!(ensure_lsp_inlay_hint_payload_in_workspace(&path_string(&root), &inside_hint).is_ok());
    assert!(
        ensure_lsp_inlay_hint_payload_in_workspace(&path_string(&root), &outside_data_hint,)
            .is_err()
    );
    assert!(ensure_lsp_inlay_hint_payload_in_workspace(
        &path_string(&root),
        &outside_location_hint,
    )
    .is_err());
    assert!(
        ensure_lsp_inlay_hint_payload_in_workspace(&path_string(&root), &outside_command_hint,)
            .is_err()
    );
}

#[test]
fn lsp_response_completion_filter_strips_outside_resolve_payloads() {
    let root = temp_workspace("completion-response-filter-root");
    let outside = temp_workspace("completion-response-filter-outside");
    let root_path = path_string(&root);
    let safe_item = completion_item(json!({
        "file": path_string(&root.join("src/App.ts")),
    }));
    let mut unsafe_item = completion_item(json!({
        "file": path_string(&outside.join("Secret.ts")),
    }));
    unsafe_item.command = Some(command_with_argument(file_uri(&outside.join("Secret.ts"))));

    let filtered = filter_lsp_completion_list_to_workspace(
        &root_path,
        LanguageServerCompletionList {
            is_incomplete: true,
            items: vec![safe_item.clone(), unsafe_item],
        },
    )
    .expect("filtered completion list");

    assert!(filtered.is_incomplete);
    assert_eq!(filtered.items.len(), 2);
    assert_eq!(filtered.items[0].data, safe_item.data);
    assert!(filtered.items[1].data.is_none());
    assert!(filtered.items[1].command.is_none());
}

#[test]
fn lsp_response_code_action_filter_keeps_inside_edits_and_drops_unsafe_payloads() {
    let root = temp_workspace("code-action-response-filter-root");
    let sibling = sibling_prefix_workspace(&root, "sibling");
    let outside = temp_workspace("code-action-response-filter-outside");
    let root_path = path_string(&root);
    let inside_uri = file_uri(&root.join("src/App.ts"));
    let sibling_uri = file_uri(&sibling.join("src/App.ts"));
    let outside_uri = file_uri(&outside.join("Secret.ts"));
    let action = code_action(json!({
        "edit": {
            "changes": {
                inside_uri.clone(): [json_text_edit("inside")],
                sibling_uri: [json_text_edit("sibling")],
                outside_uri: [json_text_edit("outside")],
            }
        },
        "command": {
            "title": "Unsafe command",
            "command": "_typescript.applyFix",
            "arguments": [file_uri(&outside.join("Secret.ts"))],
        },
        "data": {
            "file": path_string(&outside.join("Secret.ts")),
        },
    }));
    let inert_action = code_action(json!({
        "command": {
            "title": "Only unsafe command",
            "command": "_typescript.applyFix",
            "arguments": [file_uri(&outside.join("OnlyUnsafe.ts"))],
        },
    }));

    let filtered = filter_lsp_code_actions_to_workspace(&root_path, vec![action, inert_action])
        .expect("filtered code actions");

    assert_eq!(filtered.len(), 1);
    assert!(filtered[0].command.is_none());
    assert!(filtered[0].data.is_none());
    assert_eq!(
        filtered[0]
            .edit
            .as_ref()
            .expect("inside edit")
            .changes
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec![inside_uri]
    );
}

#[test]
fn lsp_response_code_lens_filter_drops_unsafe_commands_and_data() {
    let root = temp_workspace("code-lens-response-filter-root");
    let outside = temp_workspace("code-lens-response-filter-outside");
    let root_path = path_string(&root);
    let safe_lens = code_lens(json!({
        "command": {
            "title": "Show references",
            "command": "editor.action.showReferences",
            "arguments": [file_uri(&root.join("src/App.ts"))],
        },
    }));
    let unsafe_lens = code_lens(json!({
        "command": {
            "title": "Show references",
            "command": "editor.action.showReferences",
            "arguments": [file_uri(&outside.join("Secret.ts"))],
        },
        "data": {
            "file": path_string(&outside.join("Secret.ts")),
        },
    }));

    let filtered =
        filter_lsp_code_lenses_to_workspace(&root_path, vec![safe_lens.clone(), unsafe_lens])
            .expect("filtered code lenses");

    assert_eq!(filtered, vec![safe_lens]);
}

#[test]
fn lsp_response_document_link_filter_keeps_safe_targets_and_drops_unsafe_paths() {
    let root = temp_workspace("document-link-response-filter-root");
    let outside = temp_workspace("document-link-response-filter-outside");
    let root_path = path_string(&root);
    let safe_file_link = document_link(json!({
        "target": file_uri(&root.join("README.md")),
    }));
    let safe_web_link = document_link(json!({
        "target": "https://example.test/docs",
    }));
    let unsafe_target_link = document_link(json!({
        "target": file_uri(&outside.join("Secret.md")),
    }));
    let unsafe_data_link = document_link(json!({
        "data": {
            "file": path_string(&outside.join("Secret.md")),
        },
    }));

    let filtered = filter_lsp_document_links_to_workspace(
        &root_path,
        vec![
            safe_file_link.clone(),
            safe_web_link.clone(),
            unsafe_target_link,
            unsafe_data_link,
        ],
    )
    .expect("filtered document links");

    assert_eq!(filtered, vec![safe_file_link, safe_web_link]);
}

#[test]
fn lsp_response_inlay_hint_filter_strips_outside_payloads() {
    let root = temp_workspace("inlay-hint-response-filter-root");
    let outside = temp_workspace("inlay-hint-response-filter-outside");
    let root_path = path_string(&root);
    let safe_hint = inlay_hint(json!({
        "data": { "file": path_string(&root.join("src/App.ts")) },
        "label": [
            {
                "label": "App",
                "command": {
                    "title": "Apply import",
                    "command": "_typescript.applyCompletionCodeAction",
                    "arguments": [{ "file": path_string(&root.join("src/App.ts")) }],
                },
                "location": location(&file_uri(&root.join("src/App.ts"))),
                "tooltip": "Inside workspace",
            },
        ],
    }));
    let unsafe_hint = inlay_hint(json!({
        "data": { "file": path_string(&outside.join("Secret.ts")) },
        "label": [
            {
                "label": "Secret",
                "command": {
                    "title": "Apply import",
                    "command": "_typescript.applyCompletionCodeAction",
                    "arguments": [{ "file": path_string(&outside.join("Secret.ts")) }],
                },
                "location": location(&file_uri(&outside.join("Secret.ts"))),
                "tooltip": "Outside workspace",
            },
        ],
    }));

    let filtered =
        filter_lsp_inlay_hints_to_workspace(&root_path, vec![safe_hint.clone(), unsafe_hint]);

    assert_eq!(filtered.len(), 2);
    assert_eq!(filtered[0], safe_hint);
    assert!(filtered[1].data.is_none());
    let LanguageServerInlayHintLabel::Parts(parts) = &filtered[1].label else {
        panic!("expected label parts");
    };
    assert_eq!(parts[0].label, "Secret");
    assert_eq!(parts[0].tooltip.as_deref(), Some("Outside workspace"));
    assert!(parts[0].command.is_none());
    assert!(parts[0].location.is_none());
}

#[test]
fn lsp_hierarchy_follow_up_guards_reject_outside_item_uris() {
    let root = temp_workspace("hierarchy-root");
    let outside = temp_workspace("hierarchy-outside");
    let inside_call = call_hierarchy_item(&file_uri(&root.join("src/App.ts")));
    let outside_call = call_hierarchy_item(&file_uri(&outside.join("Secret.ts")));
    let outside_type = type_hierarchy_item(&file_uri(&outside.join("Secret.ts")));

    assert!(ensure_lsp_call_hierarchy_item_in_workspace(&path_string(&root), &inside_call).is_ok());
    assert!(
        ensure_lsp_call_hierarchy_item_in_workspace(&path_string(&root), &outside_call).is_err()
    );
    assert!(
        ensure_lsp_type_hierarchy_item_in_workspace(&path_string(&root), &outside_type).is_err()
    );
}

#[test]
fn file_uri_paths_are_decoded_for_workspace_edits() {
    assert_eq!(
        path_from_file_uri("file:///tmp/My%20Project/%C4%8Dlovek.ts"),
        Some("/tmp/My Project/človek.ts".to_string()),
    );
    assert_eq!(
        path_from_file_uri("file://localhost/tmp/User.ts"),
        Some("/tmp/User.ts".to_string()),
    );
    assert_eq!(path_from_file_uri("file://server/tmp/User.ts"), None);
    assert_eq!(path_from_file_uri("https://example.com/User.ts"), None);
}

#[test]
fn language_server_workspace_edits_are_converted_to_file_edits() {
    let mut changes = BTreeMap::new();
    changes.insert(
        "file:///tmp/User.ts".to_string(),
        vec![LanguageServerTextEdit {
            range: LanguageServerRange {
                start: LanguageServerPosition {
                    line: 1,
                    character: 2,
                },
                end: LanguageServerPosition {
                    line: 1,
                    character: 5,
                },
            },
            new_text: "Account".to_string(),
        }],
    );

    let edits = workspace_text_edits_from_language_server(LanguageServerWorkspaceEdit {
        changes,
        document_versions: BTreeMap::new(),
        file_operations: Vec::new(),
    })
    .expect("workspace edits");

    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0].path, "/tmp/User.ts");
    assert_eq!(edits[0].new_text, "Account");
    assert_eq!(edits[0].range.start.line, 1);
    assert_eq!(edits[0].range.end.character, 5);
}

#[test]
fn apply_workspace_edit_applies_file_operations_before_text_edits() {
    let root = temp_workspace("workspace-edit-file-operations");
    let source_directory = root.join("src");
    fs::create_dir_all(&source_directory).expect("source directory");
    let created_path = source_directory.join("Created.ts");
    let old_path = source_directory.join("Old.ts");
    let renamed_path = source_directory.join("Renamed.ts");
    let deleted_path = source_directory.join("Deleted.ts");
    fs::write(&old_path, "export const oldName = true;\n").expect("old file");
    fs::write(&deleted_path, "delete me\n").expect("deleted file");

    let mut changes = BTreeMap::new();
    changes.insert(
        file_uri(&created_path),
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
            new_text: "export const created = true;\n".to_string(),
        }],
    );
    let changed_paths = tauri::async_runtime::block_on(apply_workspace_edit(
        path_string(&root),
        LanguageServerWorkspaceEdit {
            changes,
            document_versions: BTreeMap::new(),
            file_operations: vec![
                LanguageServerWorkspaceFileOperation::Create {
                    uri: file_uri(&created_path),
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Rename {
                    old_uri: file_uri(&old_path),
                    new_uri: file_uri(&renamed_path),
                    options: None,
                },
                LanguageServerWorkspaceFileOperation::Delete {
                    uri: file_uri(&deleted_path),
                    options: Some(LanguageServerWorkspaceFileOperationOptions {
                        ignore_if_not_exists: Some(false),
                        ..Default::default()
                    }),
                },
            ],
        },
        Vec::new(),
    ))
    .expect("apply workspace edit");

    assert_eq!(changed_paths, 4);
    assert_eq!(
        fs::read_to_string(&created_path).expect("created file"),
        "export const created = true;\n"
    );
    assert!(!old_path.exists());
    assert!(renamed_path.exists());
    assert!(!deleted_path.exists());
}

#[test]
fn descriptor_workspace_edit_applies_file_operations_before_text_edits_with_counts() {
    let root = temp_workspace("descriptor-workspace-edit-full");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/Old.ts"), "old").unwrap();
    fs::write(root.join("src/Deleted.ts"), "deleted").unwrap();
    fs::write(root.join("src/Other.ts"), "other").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit(
        "src/Created.ts",
        "created",
        vec![
            LanguageServerWorkspaceFileOperation::Create {
                uri: "src/Created.ts".into(),
                options: None,
            },
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri: "src/Old.ts".into(),
                new_uri: "src/Renamed.ts".into(),
                options: None,
            },
            LanguageServerWorkspaceFileOperation::Delete {
                uri: "src/Deleted.ts".into(),
                options: None,
            },
        ],
    );
    edit.changes
        .extend(relative_workspace_edit("src/Other.ts", "changed-", vec![]).changes);
    let result = apply_descriptor_workspace_edit(&registry, &id, edit, &[], |_, _| {});
    assert!(matches!(
        result,
        WorkspaceEditResult::Success {
            applied_file_operations: 3,
            applied_text_files: 2,
            applied_count: 5
        }
    ));
    assert_eq!(
        fs::read_to_string(root.join("src/Created.ts")).unwrap(),
        "created"
    );
    assert_eq!(
        fs::read_to_string(root.join("src/Other.ts")).unwrap(),
        "changed-other"
    );
    assert!(root.join("src/Renamed.ts").exists());
    assert!(!root.join("src/Old.ts").exists());
    assert!(!root.join("src/Deleted.ts").exists());
}

#[test]
fn descriptor_workspace_edit_rejects_symlink_escape_without_mutation() {
    use std::os::unix::fs::symlink;
    let root = temp_workspace("descriptor-workspace-edit-symlink");
    let outside = temp_workspace("descriptor-workspace-edit-outside");
    fs::write(outside.join("value.ts"), "outside").unwrap();
    symlink(&outside, root.join("link")).unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("link/value.ts", "changed", vec![]),
        &[],
        |_, _| {},
    );
    assert!(matches!(result, WorkspaceEditResult::Error { .. }));
    assert_eq!(
        fs::read_to_string(outside.join("value.ts")).unwrap(),
        "outside"
    );
}

#[test]
fn descriptor_workspace_edit_reports_partial_conflict_after_an_earlier_write() {
    let root = temp_workspace("descriptor-workspace-edit-conflict");
    fs::write(root.join("a.ts"), "a").unwrap();
    fs::write(root.join("b.ts"), "b").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("a.ts", "A", vec![]);
    edit.changes
        .extend(relative_workspace_edit("b.ts", "B", vec![]).changes);
    let result = apply_descriptor_workspace_edit(&registry, &id, edit, &[], |path, applied| {
        if applied == 1 && path == Path::new("b.ts") {
            fs::write(root.join("b.ts"), "external").unwrap();
        }
    });
    assert!(
        matches!(result, WorkspaceEditResult::Partial { applied_text_files: 1, applied_count: 1, ref failed_path, .. } if failed_path == "b.ts")
    );
    assert_eq!(fs::read_to_string(root.join("a.ts")).unwrap(), "Aa");
    assert_eq!(fs::read_to_string(root.join("b.ts")).unwrap(), "external");
}

#[test]
fn trusted_transaction_waits_for_operations_before_locking_trust() {
    let root = temp_workspace("transactional-workspace-edit-lock-order");
    fs::write(root.join("value.ts"), "value").unwrap();
    let registry = Arc::new(WorkspaceRegistry::new());
    let descriptor = registry.register(&root).unwrap();
    let workspace_id = descriptor.workspace_id;
    let mut service =
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service");
    service
        .set(&path_string(&root), true)
        .expect("trust workspace");
    let trust = Arc::new(Mutex::new(service));
    let (operations_locked_tx, operations_locked_rx) = mpsc::channel();
    let (attempt_trust_tx, attempt_trust_rx) = mpsc::channel();
    let (trust_acquired_tx, trust_acquired_rx) = mpsc::channel();
    let competing_registry = Arc::clone(&registry);
    let competing_trust = Arc::clone(&trust);
    let competing = thread::spawn(move || {
        let _operation = competing_registry
            .lock_operations()
            .expect("lock competing workspace operation");
        operations_locked_tx.send(()).unwrap();
        attempt_trust_rx.recv().unwrap();
        let _trust = competing_trust.lock().expect("lock trust after operations");
        trust_acquired_tx.send(()).unwrap();
    });
    operations_locked_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("competing operation must hold the registry lock");

    let transaction_registry = Arc::clone(&registry);
    let transaction_trust = Arc::clone(&trust);
    let (operation_lock_acquired_tx, operation_lock_acquired_rx) = mpsc::channel();
    let (continue_to_trust_tx, continue_to_trust_rx) = mpsc::channel();
    let transaction = thread::spawn(move || {
        apply_trusted_transactional_descriptor_workspace_edit_with_hooks(
            &transaction_registry,
            &transaction_trust,
            &workspace_id,
            TransactionalWorkspaceEditRequest {
                edit: relative_workspace_edit("value.ts", "changed-", vec![]),
                expected_states: &BTreeMap::new(),
                file_modes: &BTreeMap::new(),
                skipped_paths: &[],
            },
            || {
                operation_lock_acquired_tx.send(()).unwrap();
                continue_to_trust_rx.recv().unwrap();
            },
            |_, _| {},
        )
    });
    attempt_trust_tx.send(()).unwrap();
    trust_acquired_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("operations-first contender must acquire trust without a lock cycle");
    competing.join().unwrap();
    operation_lock_acquired_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("transaction must acquire operations before reaching the trust boundary");
    let trust_before_transaction_attempt = trust
        .try_lock()
        .expect("transaction must not lock trust before the operation-lock hook");
    continue_to_trust_tx.send(()).unwrap();
    drop(trust_before_transaction_attempt);
    transaction
        .join()
        .unwrap()
        .expect("transaction must finish after the competing operation");
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "changed-value"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn trust_revocation_waits_for_started_transaction_and_blocks_the_next_one() {
    let root = temp_workspace("transactional-workspace-edit-trust-revoke");
    fs::write(root.join("value.ts"), "value").unwrap();
    let registry = Arc::new(WorkspaceRegistry::new());
    let descriptor = registry.register(&root).unwrap();
    let workspace_id = descriptor.workspace_id;
    let mut service =
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service");
    service
        .set(&path_string(&root), true)
        .expect("trust workspace");
    let trust = Arc::new(Mutex::new(service));
    let commit_gate = Arc::new(Barrier::new(2));
    let (release_commit_tx, release_commit_rx) = mpsc::channel();
    let transaction_registry = Arc::clone(&registry);
    let transaction_trust = Arc::clone(&trust);
    let transaction_gate = Arc::clone(&commit_gate);
    let transaction_workspace_id = workspace_id.clone();
    let transaction = thread::spawn(move || {
        apply_trusted_transactional_descriptor_workspace_edit_with_hooks(
            &transaction_registry,
            &transaction_trust,
            &transaction_workspace_id,
            TransactionalWorkspaceEditRequest {
                edit: relative_workspace_edit("value.ts", "changed-", vec![]),
                expected_states: &BTreeMap::new(),
                file_modes: &BTreeMap::new(),
                skipped_paths: &[],
            },
            || {},
            |_, _| {
                transaction_gate.wait();
                release_commit_rx.recv().unwrap();
            },
        )
    });
    commit_gate.wait();

    let revoke_trust = Arc::clone(&trust);
    let revoke_root = path_string(&root);
    let (revoked_tx, revoked_rx) = mpsc::channel();
    let revocation = thread::spawn(move || {
        revoke_trust
            .lock()
            .expect("lock trust for revoke")
            .set(&revoke_root, false)
            .expect("revoke trust");
        revoked_tx.send(()).unwrap();
    });
    assert!(
        revoked_rx.recv_timeout(Duration::from_millis(50)).is_err(),
        "revocation must wait while the authorized transaction is committing"
    );
    release_commit_tx.send(()).unwrap();
    transaction
        .join()
        .unwrap()
        .expect("started transaction must finish");
    revoked_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("revocation must finish after the transaction");
    revocation.join().unwrap();

    let rejected = apply_trusted_transactional_descriptor_workspace_edit(
        &registry,
        &trust,
        &workspace_id,
        TransactionalWorkspaceEditRequest {
            edit: relative_workspace_edit("value.ts", "again-", vec![]),
            expected_states: &BTreeMap::new(),
            file_modes: &BTreeMap::new(),
            skipped_paths: &[],
        },
    );
    assert_eq!(
        rejected.expect_err("revoked workspace must reject the next transaction"),
        "Trust this workspace before applying a workspace edit."
    );
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "changed-value"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn transactional_workspace_edit_rolls_back_first_file_when_second_file_changes() {
    let root = temp_workspace("transactional-workspace-edit-conflict");
    fs::write(root.join("a.ts"), "a").unwrap();
    fs::write(root.join("b.ts"), "b").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("a.ts", "A", vec![]);
    edit.changes
        .extend(relative_workspace_edit("b.ts", "B", vec![]).changes);

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, committed| {
            if committed == 1 && path == Path::new("b.ts") {
                fs::write(root.join("b.ts"), "external").unwrap();
            }
        },
    );

    assert!(result
        .expect_err("second-file conflict must reject the transaction")
        .contains("changed before transaction commit"));
    assert_eq!(fs::read_to_string(root.join("a.ts")).unwrap(), "a");
    assert_eq!(fs::read_to_string(root.join("b.ts")).unwrap(), "external");
    assert!(fs::read_dir(&root).unwrap().all(|entry| {
        let name = entry.unwrap().file_name();
        let name = name.to_string_lossy();
        !name.contains("codevo-") || name.contains("codevo-recovery")
    }));
}

#[test]
fn transactional_workspace_edit_preserves_external_update_during_rollback() {
    let root = temp_workspace("transactional-workspace-edit-update-race");
    fs::write(root.join("a.ts"), "a").unwrap();
    fs::write(root.join("b.ts"), "b").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("a.ts", "A", vec![]);
    edit.changes
        .extend(relative_workspace_edit("b.ts", "B", vec![]).changes);

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, committed| {
            if committed != 1 || path != Path::new("b.ts") {
                return;
            }
            fs::write(root.join("a.ts"), "external-a").unwrap();
            fs::write(root.join("b.ts"), "external-b").unwrap();
        },
    );

    let error = result.expect_err("the second-file conflict must reject the transaction");
    assert!(error.contains("preserved newer data"));
    assert_eq!(fs::read_to_string(root.join("a.ts")).unwrap(), "external-a");
    assert_eq!(fs::read_to_string(root.join("b.ts")).unwrap(), "external-b");
    assert!(fs::read_dir(&root).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry
            .file_name()
            .to_string_lossy()
            .contains("codevo-backup")
            && fs::read_to_string(entry.path()).unwrap() == "a"
    }));
}

#[test]
fn transactional_workspace_edit_preserves_external_replacement_of_created_file() {
    let root = temp_workspace("transactional-workspace-edit-create-race");
    fs::write(root.join("b.ts"), "b").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("b.ts", "B", vec![]);
    edit.file_operations
        .push(LanguageServerWorkspaceFileOperation::Create {
            uri: "a-created.ts".into(),
            options: None,
        });
    edit.changes.insert(
        "a-created.ts".into(),
        relative_workspace_edit("a-created.ts", "created", vec![])
            .changes
            .remove("a-created.ts")
            .unwrap(),
    );

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, committed| {
            if committed != 1 || path != Path::new("b.ts") {
                return;
            }
            fs::write(root.join("a-created.ts"), "external-created").unwrap();
            fs::write(root.join("b.ts"), "external-b").unwrap();
        },
    );

    let error = result.expect_err("the second-file conflict must reject the transaction");
    assert!(error.contains("preserved newer data"));
    assert_eq!(
        fs::read_to_string(root.join("a-created.ts")).unwrap(),
        "external-created"
    );
    assert_eq!(fs::read_to_string(root.join("b.ts")).unwrap(), "external-b");
}
