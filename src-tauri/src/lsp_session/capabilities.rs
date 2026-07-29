use super::document_sync_capability::parse_document_sync_capability;
use super::DocumentSyncCapability;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCapabilities {
    pub call_hierarchy: bool,
    pub code_action: bool,
    pub code_action_resolve: bool,
    pub code_lens: bool,
    pub declaration: bool,
    pub hover: bool,
    pub completion: bool,
    pub definition: bool,
    pub document_highlight: bool,
    pub document_link: bool,
    pub document_symbol: bool,
    pub document_sync: DocumentSyncCapability,
    pub did_create_files: bool,
    pub did_delete_files: bool,
    pub did_rename_files: bool,
    pub folding_range: bool,
    pub formatting: bool,
    pub implementation: bool,
    pub inlay_hint: bool,
    pub inlay_hint_resolve: bool,
    pub linked_editing_range: bool,
    pub on_type_formatting: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_type_formatting_trigger_characters: Option<Vec<String>>,
    pub prepare_rename: bool,
    pub range_formatting: bool,
    pub references: bool,
    pub rename: bool,
    pub selection_range: bool,
    pub semantic_tokens: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_tokens_legend: Option<SemanticTokensLegend>,
    pub signature_help: bool,
    pub source_definition: bool,
    pub type_definition: bool,
    pub type_hierarchy: bool,
    pub will_create_files: bool,
    pub will_delete_files: bool,
    pub will_rename_files: bool,
    pub workspace_symbol: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticTokensLegend {
    pub token_types: Vec<String>,
    pub token_modifiers: Vec<String>,
}

pub(super) fn parse_capabilities(value: &Value) -> Result<LanguageServerCapabilities, String> {
    let Some(capabilities) = value
        .get("result")
        .and_then(|result| result.get("capabilities"))
    else {
        return Err("missing server capabilities".to_string());
    };

    if !capabilities.is_object() {
        return Err("server capabilities must be an object".to_string());
    }

    Ok(LanguageServerCapabilities {
        call_hierarchy: is_capability_enabled(capabilities.get("callHierarchyProvider")),
        code_action: is_capability_enabled(capabilities.get("codeActionProvider")),
        code_action_resolve: capabilities
            .get("codeActionProvider")
            .and_then(|provider| provider.get("resolveProvider"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        code_lens: is_capability_enabled(capabilities.get("codeLensProvider")),
        declaration: is_capability_enabled(capabilities.get("declarationProvider")),
        hover: is_capability_enabled(capabilities.get("hoverProvider")),
        completion: is_capability_enabled(capabilities.get("completionProvider")),
        definition: is_capability_enabled(capabilities.get("definitionProvider")),
        document_highlight: is_capability_enabled(capabilities.get("documentHighlightProvider")),
        document_link: is_capability_enabled(capabilities.get("documentLinkProvider")),
        document_symbol: is_capability_enabled(capabilities.get("documentSymbolProvider")),
        document_sync: parse_document_sync_capability(capabilities.get("textDocumentSync")),
        did_create_files: file_operation(capabilities, "didCreate"),
        did_delete_files: file_operation(capabilities, "didDelete"),
        did_rename_files: file_operation(capabilities, "didRename"),
        folding_range: is_capability_enabled(capabilities.get("foldingRangeProvider")),
        formatting: is_capability_enabled(capabilities.get("documentFormattingProvider")),
        implementation: is_capability_enabled(capabilities.get("implementationProvider")),
        inlay_hint: is_capability_enabled(capabilities.get("inlayHintProvider")),
        inlay_hint_resolve: capabilities
            .get("inlayHintProvider")
            .and_then(|provider| provider.get("resolveProvider"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        linked_editing_range: is_capability_enabled(capabilities.get("linkedEditingRangeProvider")),
        on_type_formatting: is_capability_enabled(
            capabilities.get("documentOnTypeFormattingProvider"),
        ),
        on_type_formatting_trigger_characters: parse_on_type_formatting_trigger_characters(
            capabilities.get("documentOnTypeFormattingProvider"),
        ),
        prepare_rename: capabilities
            .get("renameProvider")
            .and_then(|provider| provider.get("prepareProvider"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        range_formatting: is_capability_enabled(
            capabilities.get("documentRangeFormattingProvider"),
        ),
        references: is_capability_enabled(capabilities.get("referencesProvider")),
        rename: is_capability_enabled(capabilities.get("renameProvider")),
        selection_range: is_capability_enabled(capabilities.get("selectionRangeProvider")),
        semantic_tokens: is_capability_enabled(capabilities.get("semanticTokensProvider")),
        semantic_tokens_legend: parse_semantic_tokens_legend(
            capabilities.get("semanticTokensProvider"),
        ),
        signature_help: is_capability_enabled(capabilities.get("signatureHelpProvider")),
        source_definition: execute_command_provider_contains(
            capabilities,
            "_typescript.goToSourceDefinition",
        ),
        type_definition: is_capability_enabled(capabilities.get("typeDefinitionProvider")),
        type_hierarchy: is_capability_enabled(capabilities.get("typeHierarchyProvider")),
        will_create_files: file_operation(capabilities, "willCreate"),
        will_delete_files: file_operation(capabilities, "willDelete"),
        will_rename_files: file_operation(capabilities, "willRename"),
        workspace_symbol: is_capability_enabled(capabilities.get("workspaceSymbolProvider")),
    })
}

fn file_operation(capabilities: &Value, operation: &str) -> bool {
    capabilities
        .get("workspace")
        .and_then(|workspace| workspace.get("fileOperations"))
        .and_then(|file_operations| file_operations.get(operation))
        .is_some()
}

fn parse_semantic_tokens_legend(provider: Option<&Value>) -> Option<SemanticTokensLegend> {
    let legend = provider?.get("legend")?;
    let token_types = parse_string_array(legend.get("tokenTypes")?)?;
    let token_modifiers = parse_string_array(legend.get("tokenModifiers")?)?;

    if token_types.is_empty() {
        return None;
    }

    Some(SemanticTokensLegend {
        token_types,
        token_modifiers,
    })
}

fn parse_on_type_formatting_trigger_characters(provider: Option<&Value>) -> Option<Vec<String>> {
    let provider = provider?.as_object()?;
    let mut trigger_characters = Vec::new();

    if let Some(first_trigger_character) = provider
        .get("firstTriggerCharacter")
        .and_then(Value::as_str)
    {
        trigger_characters.push(first_trigger_character.to_string());
    }

    if let Some(more_trigger_characters) = provider
        .get("moreTriggerCharacter")
        .and_then(Value::as_array)
    {
        trigger_characters.extend(
            more_trigger_characters
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string),
        );
    }

    (!trigger_characters.is_empty()).then_some(trigger_characters)
}

fn execute_command_provider_contains(capabilities: &Value, command: &str) -> bool {
    capabilities
        .get("executeCommandProvider")
        .and_then(|provider| provider.get("commands"))
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands
                .iter()
                .any(|candidate| candidate.as_str() == Some(command))
        })
}

fn parse_string_array(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_string))
        .collect()
}

fn is_capability_enabled(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return false;
    };

    if let Some(enabled) = value.as_bool() {
        return enabled;
    }

    value.is_object()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capability_values_are_normalized() {
        let capabilities = parse_capabilities(&json!({
            "result": { "capabilities": {
                "hoverProvider": false,
                "completionProvider": null,
                "declarationProvider": true,
                "definitionProvider": {},
                "documentHighlightProvider": true,
                "documentLinkProvider": { "resolveProvider": true },
                "documentSymbolProvider": true,
                "textDocumentSync": {
                    "change": 2,
                    "openClose": true,
                    "save": { "includeText": true }
                },
                "foldingRangeProvider": true,
                "callHierarchyProvider": true,
                "implementationProvider": true,
                "inlayHintProvider": true,
                "linkedEditingRangeProvider": true,
                "documentOnTypeFormattingProvider": {
                    "firstTriggerCharacter": "}",
                    "moreTriggerCharacter": [";", "\n"]
                },
                "referencesProvider": true,
                "renameProvider": { "prepareProvider": true },
                "selectionRangeProvider": true,
                "semanticTokensProvider": {
                    "full": true,
                    "legend": { "tokenModifiers": ["readonly"], "tokenTypes": ["class"] }
                },
                "signatureHelpProvider": { "triggerCharacters": ["(", ","] },
                "executeCommandProvider": {
                    "commands": ["_typescript.organizeImports", "_typescript.goToSourceDefinition"]
                },
                "typeDefinitionProvider": true,
                "typeHierarchyProvider": true,
                "codeLensProvider": {},
                "workspaceSymbolProvider": true,
                "codeActionProvider": { "codeActionKinds": ["quickfix"], "resolveProvider": true },
                "documentFormattingProvider": true,
                "documentRangeFormattingProvider": true,
                "workspace": { "fileOperations": {
                    "didCreate": { "filters": [] }, "didDelete": { "filters": [] },
                    "didRename": { "filters": [] }, "willCreate": { "filters": [] },
                    "willDelete": { "filters": [] }, "willRename": { "filters": [] }
                }}
            }}
        }))
        .expect("capabilities");

        assert!(capabilities.call_hierarchy);
        assert!(capabilities.code_action_resolve);
        assert!(!capabilities.hover);
        assert!(!capabilities.completion);
        assert!(capabilities.source_definition);
        assert!(capabilities.did_create_files);
        assert!(capabilities.will_rename_files);
        assert_eq!(
            serde_json::to_value(&capabilities.document_sync).expect("document sync"),
            json!({
                "changeKind": "incremental",
                "openClose": true,
                "save": { "kind": "supported", "includeText": true }
            })
        );
        assert_eq!(
            capabilities.on_type_formatting_trigger_characters,
            Some(vec!["}".to_string(), ";".to_string(), "\n".to_string()])
        );
        assert_eq!(
            capabilities.semantic_tokens_legend,
            Some(SemanticTokensLegend {
                token_types: vec!["class".to_string()],
                token_modifiers: vec!["readonly".to_string()],
            })
        );
    }

    #[test]
    fn code_action_resolve_requires_the_object_flag() {
        for (provider, expected) in [
            (json!({ "resolveProvider": true }), true),
            (json!({ "resolveProvider": false }), false),
            (json!({ "codeActionKinds": ["quickfix"] }), false),
            (json!(true), false),
        ] {
            let capabilities = parse_capabilities(&json!({
                "result": { "capabilities": { "codeActionProvider": provider } }
            }))
            .expect("capabilities");
            assert!(capabilities.code_action);
            assert_eq!(capabilities.code_action_resolve, expected);
        }
    }

    #[test]
    fn inlay_hint_resolve_requires_the_object_flag() {
        for (provider, expected_provider, expected_resolve) in [
            (json!({ "resolveProvider": true }), true, true),
            (json!({ "resolveProvider": false }), true, false),
            (json!({}), true, false),
            (json!(true), true, false),
            (json!(false), false, false),
            (json!(null), false, false),
        ] {
            let capabilities = parse_capabilities(&json!({
                "result": { "capabilities": { "inlayHintProvider": provider } }
            }))
            .expect("capabilities");

            assert_eq!(capabilities.inlay_hint, expected_provider);
            assert_eq!(capabilities.inlay_hint_resolve, expected_resolve);
        }
    }

    #[test]
    fn on_type_trigger_characters_keep_only_strings() {
        let capabilities = parse_capabilities(&json!({
            "result": { "capabilities": { "documentOnTypeFormattingProvider": {
                "firstTriggerCharacter": "}",
                "moreTriggerCharacter": [false, ";", 12, "\n", ","]
            }}}
        }))
        .expect("capabilities");

        assert_eq!(
            capabilities.on_type_formatting_trigger_characters,
            Some(vec!["}".into(), ";".into(), "\n".into(), ",".into()])
        );
    }

    #[test]
    fn malformed_on_type_trigger_characters_are_omitted() {
        for provider in [
            json!(true),
            json!({}),
            json!({ "firstTriggerCharacter": false, "moreTriggerCharacter": [false, null, 12] }),
            json!({ "firstTriggerCharacter": false, "moreTriggerCharacter": false }),
        ] {
            let capabilities = parse_capabilities(&json!({
                "result": { "capabilities": { "documentOnTypeFormattingProvider": provider } }
            }))
            .expect("capabilities");
            assert!(capabilities.on_type_formatting);
            assert_eq!(capabilities.on_type_formatting_trigger_characters, None);
        }
    }

    #[test]
    fn malformed_initialize_capabilities_are_rejected() {
        assert_eq!(
            parse_capabilities(&json!({})),
            Err("missing server capabilities".to_string())
        );
        assert_eq!(
            parse_capabilities(&json!({ "result": { "capabilities": true } })),
            Err("server capabilities must be an object".to_string())
        );
    }
}
