use crate::lsp::file_uri;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentPosition {
    pub path: String,
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionContext {
    pub trigger_kind: u32,
    pub trigger_character: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentCompletion {
    pub position: TextDocumentPosition,
    pub context: Option<LanguageServerCompletionContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSignatureHelpContext {
    pub trigger_kind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_character: Option<String>,
    pub is_retrigger: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_signature_help: Option<LanguageServerSignatureHelp>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentSignatureHelp {
    pub position: TextDocumentPosition,
    pub context: Option<LanguageServerSignatureHelpContext>,
}

#[derive(Debug, PartialEq)]
pub struct LanguageServerFeatureRequest {
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerRange {
    pub start: LanguageServerPosition,
    pub end: LanguageServerPosition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerLocation {
    pub uri: String,
    pub range: LanguageServerRange,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerTextEdit {
    pub range: LanguageServerRange,
    pub new_text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionTextEdit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<LanguageServerRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert: Option<LanguageServerRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace: Option<LanguageServerRange>,
    pub new_text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionItemLabelDetails {
    pub detail: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct LanguageServerCompletionItemDefaults {
    commit_characters: Option<Vec<String>>,
    data: Option<Value>,
    edit_range: Option<LanguageServerCompletionEditRange>,
    insert_text_format: Option<u32>,
    insert_text_mode: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
struct LanguageServerCompletionEditRange {
    range: Option<LanguageServerRange>,
    insert: Option<LanguageServerRange>,
    replace: Option<LanguageServerRange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerWorkspaceEdit {
    pub changes: BTreeMap<String, Vec<LanguageServerTextEdit>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_operations: Vec<LanguageServerWorkspaceFileOperation>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerWorkspaceFileOperationOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_if_exists: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_if_not_exists: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LanguageServerWorkspaceFileOperation {
    #[serde(rename_all = "camelCase")]
    Create {
        uri: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<LanguageServerWorkspaceFileOperationOptions>,
    },
    #[serde(rename_all = "camelCase")]
    Rename {
        old_uri: String,
        new_uri: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<LanguageServerWorkspaceFileOperationOptions>,
    },
    #[serde(rename_all = "camelCase")]
    Delete {
        uri: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<LanguageServerWorkspaceFileOperationOptions>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionCommand {
    pub title: String,
    pub command: String,
    pub arguments: Option<Vec<Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionDiagnostic {
    pub range: LanguageServerRange,
    pub message: String,
    pub severity: Option<u32>,
    pub source: Option<String>,
    pub code: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionContext {
    pub diagnostics: Vec<LanguageServerCodeActionDiagnostic>,
    pub only: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_kind: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeAction {
    pub title: String,
    pub kind: Option<String>,
    #[serde(default)]
    pub is_preferred: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<LanguageServerCodeActionDisabled>,
    pub edit: Option<LanguageServerWorkspaceEdit>,
    pub command: Option<LanguageServerCodeActionCommand>,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionDisabled {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeLens {
    pub range: LanguageServerRange,
    pub command: Option<LanguageServerCodeActionCommand>,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCallHierarchyItem {
    pub name: String,
    pub kind: u32,
    pub tags: Option<Vec<u32>>,
    pub detail: Option<String>,
    pub uri: String,
    pub range: LanguageServerRange,
    pub selection_range: LanguageServerRange,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerIncomingCall {
    pub from: LanguageServerCallHierarchyItem,
    pub from_ranges: Vec<LanguageServerRange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerOutgoingCall {
    pub to: LanguageServerCallHierarchyItem,
    pub from_ranges: Vec<LanguageServerRange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerTypeHierarchyItem {
    pub name: String,
    pub kind: u32,
    pub tags: Option<Vec<u32>>,
    pub detail: Option<String>,
    pub uri: String,
    pub range: LanguageServerRange,
    pub selection_range: LanguageServerRange,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentRange {
    pub path: String,
    pub range: LanguageServerRange,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentRename {
    pub path: String,
    pub line: u32,
    pub character: u32,
    pub new_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileRename {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceFileChangeType {
    Created,
    Changed,
    Deleted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChange {
    pub path: String,
    pub change_type: WorkspaceFileChangeType,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentFormatting {
    pub path: String,
    pub options: LanguageServerFormattingOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentRangeFormatting {
    pub path: String,
    pub range: LanguageServerRange,
    pub options: LanguageServerFormattingOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentOnTypeFormatting {
    pub path: String,
    pub position: LanguageServerPosition,
    pub ch: String,
    pub options: LanguageServerFormattingOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentInlayHintRange {
    pub path: String,
    pub range: LanguageServerRange,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentSelectionRange {
    pub path: String,
    pub positions: Vec<LanguageServerPosition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerFormattingOptions {
    pub tab_size: u32,
    pub insert_spaces: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerHover {
    pub contents: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionItem {
    #[serde(default)]
    pub additional_text_edits: Vec<LanguageServerTextEdit>,
    #[serde(default)]
    pub commit_characters: Vec<String>,
    pub command: Option<LanguageServerCodeActionCommand>,
    pub data: Option<Value>,
    #[serde(default)]
    pub deprecated: bool,
    pub label: String,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub documentation_kind: Option<String>,
    pub filter_text: Option<String>,
    pub insert_text: Option<String>,
    pub insert_text_format: Option<u32>,
    pub insert_text_mode: Option<u32>,
    pub kind: Option<u32>,
    pub label_details: Option<LanguageServerCompletionItemLabelDetails>,
    #[serde(default)]
    pub preselect: bool,
    pub sort_text: Option<String>,
    #[serde(default)]
    pub tags: Vec<u32>,
    pub text_edit: Option<LanguageServerCompletionTextEdit>,
    pub text_edit_text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionList {
    pub is_incomplete: bool,
    pub items: Vec<LanguageServerCompletionItem>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInlayHint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    pub kind: Option<u32>,
    pub label: LanguageServerInlayHintLabel,
    pub padding_left: bool,
    pub padding_right: bool,
    pub position: LanguageServerPosition,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_edits: Vec<LanguageServerTextEdit>,
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LanguageServerInlayHintLabel {
    Text(String),
    Parts(Vec<LanguageServerInlayHintLabelPart>),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInlayHintLabelPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<LanguageServerCodeActionCommand>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<LanguageServerLocation>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDocumentSymbol {
    pub children: Vec<LanguageServerDocumentSymbol>,
    pub container_name: Option<String>,
    pub detail: Option<String>,
    pub kind: u32,
    pub name: String,
    pub range: LanguageServerRange,
    pub selection_range: LanguageServerRange,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDocumentHighlight {
    pub kind: Option<u32>,
    pub range: LanguageServerRange,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDocumentLink {
    pub range: LanguageServerRange,
    pub target: Option<String>,
    pub tooltip: Option<String>,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerFoldingRange {
    pub start_line: u32,
    #[serde(default)]
    pub start_character: Option<u32>,
    pub end_line: u32,
    #[serde(default)]
    pub end_character: Option<u32>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSelectionRange {
    pub range: LanguageServerRange,
    pub parent: Option<Box<LanguageServerSelectionRange>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerLinkedEditingRanges {
    pub ranges: Vec<LanguageServerRange>,
    #[serde(default)]
    pub word_pattern: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSemanticTokens {
    pub data: Vec<u32>,
    pub result_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerWorkspaceSymbol {
    pub container_name: Option<String>,
    pub kind: u32,
    pub location: Option<LanguageServerLocation>,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSignatureHelp {
    pub active_parameter: u32,
    pub active_signature: u32,
    pub signatures: Vec<LanguageServerSignature>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSignature {
    pub documentation: Option<String>,
    pub label: String,
    pub parameters: Vec<LanguageServerSignatureParameter>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerSignatureParameter {
    pub documentation: Option<String>,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerPrepareRenameResult {
    pub default_behavior: bool,
    pub placeholder: Option<String>,
    pub range: Option<LanguageServerRange>,
}

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
    fn will_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest;
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

    fn will_rename_files(&self, files: &[WorkspaceFileRename]) -> LanguageServerFeatureRequest {
        LanguageServerFeatureRequest {
            method: "workspace/willRenameFiles".to_string(),
            params: json!({
                "files": files
                    .iter()
                    .map(|file| {
                        json!({
                            "oldUri": file_uri(Path::new(&file.old_path)),
                            "newUri": file_uri(Path::new(&file.new_path)),
                        })
                    })
                .collect::<Vec<_>>(),
            }),
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

fn lsp_file_change_type(change_type: WorkspaceFileChangeType) -> u8 {
    match change_type {
        WorkspaceFileChangeType::Created => 1,
        WorkspaceFileChangeType::Changed => 2,
        WorkspaceFileChangeType::Deleted => 3,
    }
}

pub fn parse_hover_result(value: &Value) -> Result<Option<LanguageServerHover>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let Some(contents) = value.get("contents").and_then(markup_to_string) else {
        return Err("Language server returned a malformed hover response.".to_string());
    };

    if contents.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(LanguageServerHover { contents }))
}

pub fn parse_completion_result(value: &Value) -> Result<LanguageServerCompletionList, String> {
    if value.is_null() {
        return Ok(empty_completion_list());
    }

    if let Some(items) = value.as_array() {
        return Ok(LanguageServerCompletionList {
            is_incomplete: false,
            items: parse_completion_items(items, None),
        });
    }

    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return Err("Language server returned a malformed completion response.".to_string());
    };

    Ok(LanguageServerCompletionList {
        is_incomplete: value
            .get("isIncomplete")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        items: parse_completion_items(
            items,
            value
                .get("itemDefaults")
                .and_then(parse_completion_item_defaults)
                .as_ref(),
        ),
    })
}

pub fn parse_definition_result(value: &Value) -> Result<Vec<LanguageServerLocation>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    if let Some(items) = value.as_array() {
        return items.iter().map(parse_definition_item).collect();
    }

    parse_definition_item(value).map(|location| vec![location])
}

pub fn parse_inlay_hints_result(value: &Value) -> Result<Vec<LanguageServerInlayHint>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned a malformed inlay hints response.".to_string());
    };

    items.iter().map(parse_inlay_hint_item).collect()
}

pub fn parse_inlay_hint_result(value: &Value) -> Result<LanguageServerInlayHint, String> {
    parse_inlay_hint_item(value)
}

pub fn parse_document_symbols_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentSymbol>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed document symbols.".to_string());
    };

    Ok(items
        .iter()
        .filter_map(parse_document_symbol_item)
        .collect())
}

pub fn parse_document_highlights_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed document highlights.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerDocumentHighlight>(item.clone()).map_err(
                |error| format!("Language server returned a malformed document highlight: {error}"),
            )
        })
        .collect()
}

pub fn parse_document_links_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentLink>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed document links.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerDocumentLink>(item.clone()).map_err(|error| {
                format!("Language server returned a malformed document link: {error}")
            })
        })
        .collect()
}

pub fn parse_folding_ranges_result(
    value: &Value,
) -> Result<Vec<LanguageServerFoldingRange>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed folding ranges.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerFoldingRange>(item.clone()).map_err(|error| {
                format!("Language server returned a malformed folding range: {error}")
            })
        })
        .collect()
}

pub fn parse_selection_ranges_result(
    value: &Value,
) -> Result<Vec<LanguageServerSelectionRange>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed selection ranges.".to_string());
    };

    items.iter().map(parse_selection_range_item).collect()
}

pub fn parse_linked_editing_ranges_result(
    value: &Value,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    if value.is_null() {
        return Ok(None);
    }

    serde_json::from_value::<LanguageServerLinkedEditingRanges>(value.clone())
        .map(Some)
        .map_err(|error| {
            format!("Language server returned malformed linked editing ranges: {error}")
        })
}

pub fn parse_semantic_tokens_result(
    value: &Value,
) -> Result<Option<LanguageServerSemanticTokens>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let Some(data) = value.get("data").and_then(Value::as_array) else {
        return Err("Language server returned malformed semantic tokens.".to_string());
    };
    let parsed_data: Result<Vec<u32>, String> = data
        .iter()
        .map(|item| {
            item.as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| {
                    "Language server returned a malformed semantic token integer.".to_string()
                })
        })
        .collect();

    Ok(Some(LanguageServerSemanticTokens {
        data: parsed_data?,
        result_id: value
            .get("resultId")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

pub fn parse_workspace_symbols_result(
    value: &Value,
) -> Result<Vec<LanguageServerWorkspaceSymbol>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed workspace symbols.".to_string());
    };

    Ok(items.iter().filter_map(parse_workspace_symbol).collect())
}

pub fn parse_call_hierarchy_items_result(
    value: &Value,
) -> Result<Vec<LanguageServerCallHierarchyItem>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed call hierarchy items.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerCallHierarchyItem>(item.clone()).map_err(
                |error| {
                    format!("Language server returned a malformed call hierarchy item: {error}")
                },
            )
        })
        .collect()
}

pub fn parse_type_hierarchy_items_result(
    value: &Value,
) -> Result<Vec<LanguageServerTypeHierarchyItem>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed type hierarchy items.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerTypeHierarchyItem>(item.clone()).map_err(
                |error| {
                    format!("Language server returned a malformed type hierarchy item: {error}")
                },
            )
        })
        .collect()
}

pub fn parse_incoming_calls_result(
    value: &Value,
) -> Result<Vec<LanguageServerIncomingCall>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed incoming calls.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerIncomingCall>(item.clone()).map_err(|error| {
                format!("Language server returned a malformed incoming call: {error}")
            })
        })
        .collect()
}

pub fn parse_outgoing_calls_result(
    value: &Value,
) -> Result<Vec<LanguageServerOutgoingCall>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned malformed outgoing calls.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerOutgoingCall>(item.clone()).map_err(|error| {
                format!("Language server returned a malformed outgoing call: {error}")
            })
        })
        .collect()
}

pub fn parse_signature_help_result(
    value: &Value,
) -> Result<Option<LanguageServerSignatureHelp>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let Some(signatures) = value.get("signatures").and_then(Value::as_array) else {
        return Err("Language server returned a malformed signature help response.".to_string());
    };
    let parsed_signatures: Vec<LanguageServerSignature> = signatures
        .iter()
        .filter_map(parse_signature_information)
        .collect();

    if parsed_signatures.is_empty() {
        return Ok(None);
    }

    Ok(Some(LanguageServerSignatureHelp {
        active_parameter: value
            .get("activeParameter")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        active_signature: value
            .get("activeSignature")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        signatures: parsed_signatures,
    }))
}

pub fn parse_prepare_rename_result(
    value: &Value,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    if value.is_null() {
        return Ok(None);
    }

    if value
        .get("defaultBehavior")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(Some(LanguageServerPrepareRenameResult {
            default_behavior: true,
            placeholder: None,
            range: None,
        }));
    }

    if let Ok(range) = serde_json::from_value::<LanguageServerRange>(value.clone()) {
        return Ok(Some(LanguageServerPrepareRenameResult {
            default_behavior: false,
            placeholder: None,
            range: Some(range),
        }));
    }

    let Some(range_value) = value.get("range") else {
        return Err("Language server returned a malformed prepare rename response.".to_string());
    };
    let range = serde_json::from_value::<LanguageServerRange>(range_value.clone())
        .map_err(|error| format!("Language server returned a malformed rename range: {error}"))?;

    Ok(Some(LanguageServerPrepareRenameResult {
        default_behavior: false,
        placeholder: optional_string(value.get("placeholder")),
        range: Some(range),
    }))
}

pub fn parse_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    if value.is_null() {
        return Ok(None);
    }

    parse_workspace_edit(value).map(Some)
}

pub fn parse_optional_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    if value.is_null() || value.get("changes").is_none() && value.get("documentChanges").is_none() {
        return Ok(None);
    }

    parse_workspace_edit(value).map(Some)
}

pub fn parse_code_action_result(value: &Value) -> Result<Vec<LanguageServerCodeAction>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned a malformed code action response.".to_string());
    };

    Ok(items.iter().filter_map(parse_code_action_item).collect())
}

pub fn parse_formatting_result(value: &Value) -> Result<Vec<LanguageServerTextEdit>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    let Some(items) = value.as_array() else {
        return Err("Language server returned a malformed formatting response.".to_string());
    };

    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerTextEdit>(item.clone())
                .map_err(|error| format!("Language server returned a malformed text edit: {error}"))
        })
        .collect()
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

fn markup_to_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    if let Some(items) = value.as_array() {
        let parts: Vec<String> = items.iter().filter_map(markup_to_string).collect();

        if parts.is_empty() {
            return None;
        }

        return Some(parts.join("\n\n"));
    }

    value
        .get("value")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn parse_completion_items(
    items: &[Value],
    defaults: Option<&LanguageServerCompletionItemDefaults>,
) -> Vec<LanguageServerCompletionItem> {
    items
        .iter()
        .filter_map(|item| parse_completion_item(item, defaults))
        .collect()
}

fn parse_completion_item(
    value: &Value,
    defaults: Option<&LanguageServerCompletionItemDefaults>,
) -> Option<LanguageServerCompletionItem> {
    let label = value.get("label").and_then(Value::as_str)?.to_string();
    let additional_text_edits = value
        .get("additionalTextEdits")
        .and_then(Value::as_array)
        .map(|items| parse_text_edits(items).unwrap_or_default())
        .unwrap_or_default();
    let commit_characters = if value.get("commitCharacters").is_some() {
        value
            .get("commitCharacters")
            .and_then(parse_string_array)
            .unwrap_or_default()
    } else {
        defaults
            .and_then(|defaults| defaults.commit_characters.clone())
            .unwrap_or_default()
    };
    let tags = value
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_u64)
                .map(|tag| tag as u32)
                .collect()
        })
        .unwrap_or_default();
    let insert_text = optional_string(value.get("insertText"));
    let text_edit_text = optional_string(value.get("textEditText"));
    let text_edit = if value.get("textEdit").is_some() {
        value.get("textEdit").and_then(parse_completion_text_edit)
    } else {
        defaults
            .and_then(|defaults| defaults.edit_range.as_ref())
            .and_then(|edit_range| {
                completion_text_edit_from_default_edit_range(
                    edit_range,
                    text_edit_text
                        .clone()
                        .or_else(|| insert_text.clone())
                        .unwrap_or_else(|| label.clone()),
                )
            })
    };

    Some(LanguageServerCompletionItem {
        additional_text_edits,
        commit_characters,
        command: parse_code_action_command(value),
        data: value
            .get("data")
            .cloned()
            .or_else(|| defaults.and_then(|defaults| defaults.data.clone())),
        deprecated: value
            .get("deprecated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        label,
        detail: optional_string(value.get("detail")),
        documentation: value.get("documentation").and_then(markup_to_string),
        documentation_kind: value
            .get("documentation")
            .and_then(completion_documentation_kind),
        filter_text: optional_string(value.get("filterText")),
        insert_text,
        insert_text_format: completion_u32_property(value, "insertTextFormat")
            .or_else(|| defaults.and_then(|defaults| defaults.insert_text_format)),
        insert_text_mode: completion_u32_property(value, "insertTextMode")
            .or_else(|| defaults.and_then(|defaults| defaults.insert_text_mode)),
        kind: value
            .get("kind")
            .and_then(Value::as_u64)
            .map(|kind| kind as u32),
        label_details: value
            .get("labelDetails")
            .and_then(parse_completion_label_details),
        preselect: value
            .get("preselect")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        sort_text: optional_string(value.get("sortText")),
        tags,
        text_edit,
        text_edit_text,
    })
}

fn parse_completion_item_defaults(value: &Value) -> Option<LanguageServerCompletionItemDefaults> {
    if !value.is_object() {
        return None;
    }

    Some(LanguageServerCompletionItemDefaults {
        commit_characters: value.get("commitCharacters").and_then(parse_string_array),
        data: value.get("data").cloned(),
        edit_range: value.get("editRange").and_then(parse_completion_edit_range),
        insert_text_format: completion_u32_property(value, "insertTextFormat"),
        insert_text_mode: completion_u32_property(value, "insertTextMode"),
    })
}

fn parse_completion_edit_range(value: &Value) -> Option<LanguageServerCompletionEditRange> {
    if let Ok(range) = serde_json::from_value::<LanguageServerRange>(value.clone()) {
        return Some(LanguageServerCompletionEditRange {
            range: Some(range),
            insert: None,
            replace: None,
        });
    }

    let insert = value
        .get("insert")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok());
    let replace = value
        .get("replace")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok());

    if insert.is_none() || replace.is_none() {
        return None;
    }

    Some(LanguageServerCompletionEditRange {
        range: None,
        insert,
        replace,
    })
}

fn completion_text_edit_from_default_edit_range(
    edit_range: &LanguageServerCompletionEditRange,
    new_text: String,
) -> Option<LanguageServerCompletionTextEdit> {
    if edit_range.range.is_none() && (edit_range.insert.is_none() || edit_range.replace.is_none()) {
        return None;
    }

    Some(LanguageServerCompletionTextEdit {
        range: edit_range.range.clone(),
        insert: edit_range.insert.clone(),
        replace: edit_range.replace.clone(),
        new_text,
    })
}

fn completion_documentation_kind(value: &Value) -> Option<String> {
    value
        .get("kind")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn parse_string_array(value: &Value) -> Option<Vec<String>> {
    Some(
        value
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
    )
}

fn completion_u32_property(value: &Value, property: &str) -> Option<u32> {
    value
        .get(property)
        .and_then(Value::as_u64)
        .map(|value| value as u32)
}

fn parse_completion_label_details(
    value: &Value,
) -> Option<LanguageServerCompletionItemLabelDetails> {
    Some(LanguageServerCompletionItemLabelDetails {
        detail: optional_string(value.get("detail")),
        description: optional_string(value.get("description")),
    })
}

fn parse_completion_text_edit(value: &Value) -> Option<LanguageServerCompletionTextEdit> {
    let new_text = value.get("newText").and_then(Value::as_str)?.to_string();
    let range = value
        .get("range")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok());
    let insert = value
        .get("insert")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok());
    let replace = value
        .get("replace")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok());

    if range.is_none() && insert.is_none() && replace.is_none() {
        return None;
    }

    Some(LanguageServerCompletionTextEdit {
        range,
        insert,
        replace,
        new_text,
    })
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToString::to_string)
}

fn parse_definition_item(value: &Value) -> Result<LanguageServerLocation, String> {
    if value.get("uri").is_some() {
        return serde_json::from_value::<LanguageServerLocation>(value.clone())
            .map_err(|error| format!("Language server returned a malformed location: {error}"));
    }

    if value.get("targetUri").is_some() {
        let link = serde_json::from_value::<LanguageServerLocationLink>(value.clone()).map_err(
            |error| format!("Language server returned a malformed location link: {error}"),
        )?;

        return Ok(LanguageServerLocation {
            uri: link.target_uri,
            range: link.target_range,
        });
    }

    Err("Language server returned a malformed definition response.".to_string())
}

fn parse_inlay_hint_item(value: &Value) -> Result<LanguageServerInlayHint, String> {
    let position = value
        .get("position")
        .and_then(|position| {
            serde_json::from_value::<LanguageServerPosition>(position.clone()).ok()
        })
        .ok_or_else(|| "Language server returned a malformed inlay hint position.".to_string())?;
    let label = value
        .get("label")
        .and_then(parse_inlay_hint_label)
        .ok_or_else(|| "Language server returned a malformed inlay hint label.".to_string())?;

    Ok(LanguageServerInlayHint {
        data: value.get("data").cloned(),
        kind: value
            .get("kind")
            .and_then(Value::as_u64)
            .map(|kind| kind as u32),
        label,
        padding_left: value
            .get("paddingLeft")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        padding_right: value
            .get("paddingRight")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        position,
        text_edits: value
            .get("textEdits")
            .and_then(Value::as_array)
            .map(|items| parse_text_edits(items).unwrap_or_default())
            .unwrap_or_default(),
        tooltip: value.get("tooltip").and_then(markup_to_string),
    })
}

fn parse_inlay_hint_label(value: &Value) -> Option<LanguageServerInlayHintLabel> {
    if let Some(label) = value.as_str() {
        return Some(LanguageServerInlayHintLabel::Text(label.to_string()));
    }

    let items = value.as_array()?;
    let parts: Vec<LanguageServerInlayHintLabelPart> = items
        .iter()
        .filter_map(parse_inlay_hint_label_part)
        .collect();

    if parts.is_empty() {
        return None;
    }

    Some(LanguageServerInlayHintLabel::Parts(parts))
}

fn parse_inlay_hint_label_part(value: &Value) -> Option<LanguageServerInlayHintLabelPart> {
    Some(LanguageServerInlayHintLabelPart {
        command: parse_code_action_command(value),
        label: value.get("value").and_then(Value::as_str)?.to_string(),
        tooltip: value.get("tooltip").and_then(markup_to_string),
        location: value
            .get("location")
            .and_then(|location| serde_json::from_value(location.clone()).ok()),
    })
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

fn parse_document_symbol_item(value: &Value) -> Option<LanguageServerDocumentSymbol> {
    if value.get("selectionRange").is_some() {
        return parse_hierarchical_document_symbol(value);
    }

    parse_symbol_information(value)
}

fn parse_hierarchical_document_symbol(value: &Value) -> Option<LanguageServerDocumentSymbol> {
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let kind = value.get("kind").and_then(Value::as_u64)? as u32;
    let range = serde_json::from_value(value.get("range")?.clone()).ok()?;
    let selection_range = serde_json::from_value(value.get("selectionRange")?.clone()).ok()?;
    let children = value
        .get("children")
        .and_then(Value::as_array)
        .map(|children| {
            children
                .iter()
                .filter_map(parse_document_symbol_item)
                .collect()
        })
        .unwrap_or_default();

    Some(LanguageServerDocumentSymbol {
        children,
        container_name: None,
        detail: value
            .get("detail")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        kind,
        name,
        range,
        selection_range,
    })
}

fn parse_symbol_information(value: &Value) -> Option<LanguageServerDocumentSymbol> {
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let kind = value.get("kind").and_then(Value::as_u64)? as u32;
    let range: LanguageServerRange =
        serde_json::from_value(value.get("location")?.get("range")?.clone()).ok()?;

    Some(LanguageServerDocumentSymbol {
        children: Vec::new(),
        container_name: value
            .get("containerName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        detail: None,
        kind,
        name,
        range: range.clone(),
        selection_range: range,
    })
}

fn parse_workspace_symbol(value: &Value) -> Option<LanguageServerWorkspaceSymbol> {
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let kind = value.get("kind").and_then(Value::as_u64)? as u32;
    let location = parse_workspace_symbol_location(value.get("location")?);

    Some(LanguageServerWorkspaceSymbol {
        container_name: value
            .get("containerName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        kind,
        location,
        name,
    })
}

fn parse_workspace_symbol_location(value: &Value) -> Option<LanguageServerLocation> {
    if value.get("range").is_none() {
        return None;
    }

    serde_json::from_value(value.clone()).ok()
}

fn parse_selection_range_item(value: &Value) -> Result<LanguageServerSelectionRange, String> {
    let range = value
        .get("range")
        .and_then(|range| serde_json::from_value::<LanguageServerRange>(range.clone()).ok())
        .ok_or_else(|| "Language server returned a malformed selection range.".to_string())?;
    let parent = value
        .get("parent")
        .filter(|parent| !parent.is_null())
        .map(parse_selection_range_item)
        .transpose()?
        .map(Box::new);

    Ok(LanguageServerSelectionRange { parent, range })
}

fn parse_signature_information(value: &Value) -> Option<LanguageServerSignature> {
    let label = value.get("label").and_then(Value::as_str)?.to_string();
    let parameters = value
        .get("parameters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|parameter| parse_signature_parameter(parameter, &label))
                .collect()
        })
        .unwrap_or_default();

    Some(LanguageServerSignature {
        documentation: value.get("documentation").and_then(markup_to_string),
        label,
        parameters,
    })
}

fn parse_signature_parameter(
    value: &Value,
    signature_label: &str,
) -> Option<LanguageServerSignatureParameter> {
    let label = value
        .get("label")
        .and_then(|label| signature_parameter_label_to_string(label, signature_label))?;

    Some(LanguageServerSignatureParameter {
        documentation: value.get("documentation").and_then(markup_to_string),
        label,
    })
}

fn signature_parameter_label_to_string(value: &Value, signature_label: &str) -> Option<String> {
    if let Some(label) = value.as_str() {
        return Some(label.to_string());
    }

    let range = value.as_array()?;
    let start = range.first().and_then(Value::as_u64)? as usize;
    let end = range.get(1).and_then(Value::as_u64)? as usize;

    slice_by_char_offsets(signature_label, start, end)
}

fn slice_by_char_offsets(value: &str, start: usize, end: usize) -> Option<String> {
    if start >= end {
        return None;
    }

    let mut start_byte = None;
    let mut end_byte = None;

    for (char_index, (byte_index, _)) in value.char_indices().enumerate() {
        if char_index == start {
            start_byte = Some(byte_index);
        }

        if char_index == end {
            end_byte = Some(byte_index);
            break;
        }
    }

    let start_byte = start_byte?;
    let end_byte = end_byte.unwrap_or(value.len());

    value.get(start_byte..end_byte).map(ToString::to_string)
}

fn parse_workspace_edit(value: &Value) -> Result<LanguageServerWorkspaceEdit, String> {
    let mut changes = BTreeMap::new();
    let mut file_operations = Vec::new();

    if let Some(change_map) = value.get("changes").and_then(Value::as_object) {
        for (uri, edits) in change_map {
            let Some(items) = edits.as_array() else {
                return Err("Language server returned malformed workspace changes.".to_string());
            };

            changes.insert(uri.clone(), parse_text_edits(items)?);
        }
    }

    if let Some(document_changes) = value.get("documentChanges").and_then(Value::as_array) {
        for document_change in document_changes {
            if let Some(text_document) = document_change.get("textDocument") {
                let Some(uri) = text_document.get("uri").and_then(Value::as_str) else {
                    continue;
                };
                let Some(items) = document_change.get("edits").and_then(Value::as_array) else {
                    continue;
                };

                changes.insert(uri.to_string(), parse_text_edits(items)?);
                continue;
            }

            if document_change.get("kind").is_some() {
                file_operations.push(
                    serde_json::from_value::<LanguageServerWorkspaceFileOperation>(
                        document_change.clone(),
                    )
                    .map_err(|error| {
                        format!(
                            "Language server returned a malformed workspace file operation: {error}"
                        )
                    })?,
                );
            }
        }
    }

    Ok(LanguageServerWorkspaceEdit {
        changes,
        file_operations,
    })
}

fn parse_text_edits(items: &[Value]) -> Result<Vec<LanguageServerTextEdit>, String> {
    items
        .iter()
        .map(|item| {
            serde_json::from_value::<LanguageServerTextEdit>(item.clone())
                .map_err(|error| format!("Language server returned a malformed text edit: {error}"))
        })
        .collect()
}

fn parse_code_action_item(value: &Value) -> Option<LanguageServerCodeAction> {
    let title = value.get("title").and_then(Value::as_str)?.to_string();
    let edit = value
        .get("edit")
        .and_then(|edit| parse_workspace_edit(edit).ok());
    let command = parse_code_action_command(value);

    Some(LanguageServerCodeAction {
        title,
        kind: optional_string(value.get("kind")),
        is_preferred: value
            .get("isPreferred")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        disabled: value
            .get("disabled")
            .and_then(|disabled| serde_json::from_value(disabled.clone()).ok()),
        edit,
        command,
        data: value.get("data").cloned(),
    })
}

fn parse_code_action_command(value: &Value) -> Option<LanguageServerCodeActionCommand> {
    let command_value = value.get("command")?;

    if let Some(command) = command_value.as_str() {
        let title = value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(command)
            .to_string();
        let arguments = value
            .get("arguments")
            .and_then(Value::as_array)
            .map(|items| items.to_vec());

        return Some(LanguageServerCodeActionCommand {
            title,
            command: command.to_string(),
            arguments,
        });
    }

    serde_json::from_value::<LanguageServerCodeActionCommand>(command_value.clone()).ok()
}

fn empty_completion_list() -> LanguageServerCompletionList {
    LanguageServerCompletionList {
        is_incomplete: false,
        items: Vec::new(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanguageServerLocationLink {
    target_uri: String,
    target_range: LanguageServerRange,
}

#[cfg(test)]
mod tests {
    use super::{
        parse_call_hierarchy_items_result, parse_code_action_result, parse_completion_result,
        parse_definition_result, parse_document_highlights_result, parse_document_links_result,
        parse_document_symbols_result, parse_folding_ranges_result, parse_formatting_result,
        parse_hover_result, parse_incoming_calls_result, parse_inlay_hint_result,
        parse_inlay_hints_result, parse_linked_editing_ranges_result,
        parse_optional_workspace_edit_result, parse_outgoing_calls_result,
        parse_prepare_rename_result, parse_selection_ranges_result, parse_semantic_tokens_result,
        parse_signature_help_result, parse_type_hierarchy_items_result,
        parse_workspace_edit_result, parse_workspace_symbols_result,
        LanguageServerCallHierarchyItem, LanguageServerCodeAction, LanguageServerCodeActionCommand,
        LanguageServerCodeActionContext, LanguageServerCodeActionDiagnostic,
        LanguageServerCodeLens, LanguageServerCompletionContext, LanguageServerCompletionItem,
        LanguageServerCompletionItemLabelDetails, LanguageServerCompletionList,
        LanguageServerCompletionTextEdit, LanguageServerDocumentLink,
        LanguageServerFormattingOptions, LanguageServerHover, LanguageServerInlayHint,
        LanguageServerInlayHintLabel, LanguageServerInlayHintLabelPart, LanguageServerLocation,
        LanguageServerPosition, LanguageServerRange, LanguageServerSignature,
        LanguageServerSignatureHelp, LanguageServerSignatureHelpContext,
        LanguageServerSignatureParameter, LanguageServerTextEdit, LanguageServerTypeHierarchyItem,
        LanguageServerWorkspaceFileOperation, LspTextDocumentFeatureRequestFactory,
        TextDocumentCompletion, TextDocumentFeatureRequestFactory, TextDocumentFormatting,
        TextDocumentInlayHintRange, TextDocumentOnTypeFormatting, TextDocumentPosition,
        TextDocumentRange, TextDocumentRangeFormatting, TextDocumentRename,
        TextDocumentSelectionRange, TextDocumentSignatureHelp, WorkspaceFileChange,
        WorkspaceFileChangeType, WorkspaceFileRename,
    };
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

    #[test]
    fn parses_hover_markup_variants() {
        assert_eq!(
            parse_hover_result(&json!({
                "contents": { "kind": "markdown", "value": "**User**" },
            }))
            .expect("hover"),
            Some(LanguageServerHover {
                contents: "**User**".to_string(),
            })
        );
        assert_eq!(
            parse_hover_result(&json!({
                "contents": ["one", { "language": "php", "value": "two" }],
            }))
            .expect("hover")
            .expect("hover value")
            .contents,
            "one\n\ntwo"
        );
        assert_eq!(parse_hover_result(&json!(null)).expect("hover"), None);
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
                    "textDocument": { "uri": "file:///tmp/Other.ts" },
                    "edits": [
                        {
                            "range": {
                                "start": { "line": 3, "character": 0 },
                                "end": { "line": 3, "character": 0 }
                            },
                            "newText": "import { Account } from './account';\n"
                        }
                    ]
                },
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
            },
            { "kind": "quickfix" }
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
        assert_eq!(symbols[0].children[0].name, "loadUser");
        assert_eq!(
            symbols[0].children[0].detail.as_deref(),
            Some("(id: string)")
        );
        assert_eq!(symbols[1].container_name.as_deref(), Some("UserFactory"));
        assert_eq!(symbols[1].selection_range.start.line, 8);
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

        let items = parse_call_hierarchy_items_result(&json!([item.clone()]))
            .expect("call hierarchy items");
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

        let items =
            parse_type_hierarchy_items_result(&json!([item])).expect("type hierarchy items");

        assert_eq!(items[0].name, "BaseView");
        assert_eq!(items[0].selection_range.start.character, 6);
        assert_eq!(
            parse_type_hierarchy_items_result(&json!(null)).expect("null"),
            Vec::new()
        );
        assert!(parse_type_hierarchy_items_result(&json!({})).is_err());
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
}
