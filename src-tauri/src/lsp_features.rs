use crate::lsp::file_uri;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

mod code_action_projection;
mod completion_projection;
mod document_highlight_projection;
mod document_symbol_projection;
mod linked_editing_projection;
mod rename_projection;
mod workspace_symbol_projection;

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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub document_versions: BTreeMap<String, Option<i64>>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileCreate {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileDelete {
    pub path: String,
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
    pub tags: Vec<u32>,
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

mod request_factory;
pub use request_factory::{
    LspTextDocumentFeatureRequestFactory, TextDocumentFeatureRequestFactory,
};
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
    completion_projection::project_completion_result(value)
}

pub fn parse_completion_item_result(value: &Value) -> Result<LanguageServerCompletionItem, String> {
    completion_projection::project_completion_item_result(value)
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
    document_symbol_projection::project_document_symbols_result(value)
}

pub fn parse_document_highlights_result(
    value: &Value,
) -> Result<Vec<LanguageServerDocumentHighlight>, String> {
    document_highlight_projection::project_document_highlights_result(value)
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
    linked_editing_projection::project_linked_editing_ranges_result(value)
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
    workspace_symbol_projection::project_workspace_symbols_result(value)
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
    rename_projection::project_prepare_rename_result(value)
}

pub fn parse_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    rename_projection::project_workspace_edit_result(value)
}

pub fn parse_optional_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    if value.is_null() || value.get("changes").is_none() && value.get("documentChanges").is_none() {
        return Ok(None);
    }

    rename_projection::project_workspace_edit_result(value)
}

pub fn parse_code_action_result(value: &Value) -> Result<Vec<LanguageServerCodeAction>, String> {
    code_action_projection::project_code_action_result(value)
}

pub fn parse_resolved_code_action_result(
    value: &Value,
) -> Result<LanguageServerCodeAction, String> {
    code_action_projection::project_resolved_code_action_result(value)
}

pub fn validate_code_action_context(
    context: &LanguageServerCodeActionContext,
) -> Result<(), String> {
    code_action_projection::validate_code_action_context(context)
}

pub fn validate_code_action_resolve_request(
    action: &LanguageServerCodeAction,
) -> Result<(), String> {
    code_action_projection::validate_code_action_resolve_request(action)
}

pub fn validate_code_action_request_range(range: &LanguageServerRange) -> Result<(), String> {
    code_action_projection::validate_code_action_request_range(range)
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

pub(super) fn parse_workspace_edit(value: &Value) -> Result<LanguageServerWorkspaceEdit, String> {
    let mut changes = BTreeMap::new();
    let mut document_versions = BTreeMap::new();
    let mut file_operations = Vec::new();

    if let Some(change_map) = value.get("changes").and_then(Value::as_object) {
        for (uri, edits) in change_map {
            let Some(items) = edits.as_array() else {
                return Err("Language server returned malformed workspace changes.".to_string());
            };

            append_workspace_text_edits(&mut changes, uri.clone(), parse_text_edits(items)?);
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
                if let Some(version_value) = text_document.get("version") {
                    let version = if version_value.is_null() {
                        None
                    } else {
                        Some(
                            version_value
                                .as_i64()
                                .and_then(|version| i32::try_from(version).ok())
                                .map(i64::from)
                                .ok_or_else(|| {
                                    "Language server returned a malformed workspace document version."
                                        .to_string()
                                })?,
                        )
                    };
                    document_versions.insert(uri.to_string(), version);
                }

                append_workspace_text_edits(
                    &mut changes,
                    uri.to_string(),
                    parse_text_edits(items)?,
                );
                continue;
            }

            if document_change.get("kind").is_some() {
                file_operations.push(parse_workspace_file_operation(document_change)?);
            }
        }
    }

    Ok(LanguageServerWorkspaceEdit {
        changes,
        document_versions,
        file_operations,
    })
}

fn parse_text_edits(items: &[Value]) -> Result<Vec<LanguageServerTextEdit>, String> {
    items
        .iter()
        .map(|item| {
            let object = item.as_object().ok_or_else(|| {
                "Language server returned a malformed text edit: expected object.".to_string()
            })?;
            Ok(LanguageServerTextEdit {
                range: parse_workspace_range(object.get("range").ok_or_else(|| {
                    "Language server returned a malformed text edit: missing range.".to_string()
                })?)?,
                new_text: object
                    .get("newText")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        "Language server returned a malformed text edit: missing newText."
                            .to_string()
                    })?
                    .to_string(),
            })
        })
        .collect()
}

fn parse_workspace_range(value: &Value) -> Result<LanguageServerRange, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Language server returned a malformed workspace range.".to_string())?;
    let parse_position = |field: &str| -> Result<LanguageServerPosition, String> {
        let position = object
            .get(field)
            .and_then(Value::as_object)
            .ok_or_else(|| {
                format!("Language server returned a malformed workspace range {field}.")
            })?;
        Ok(LanguageServerPosition {
            line: workspace_u32(position.get("line"), "line")?,
            character: workspace_u32(position.get("character"), "character")?,
        })
    };
    let start = parse_position("start")?;
    let end = parse_position("end")?;
    if (end.line, end.character) < (start.line, start.character) {
        return Err("Language server returned an inverted workspace range.".to_string());
    }
    Ok(LanguageServerRange { start, end })
}

fn workspace_u32(value: Option<&Value>, field: &str) -> Result<u32, String> {
    value
        .and_then(Value::as_u64)
        .filter(|value| *value <= i32::MAX as u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("Language server returned a malformed workspace {field}."))
}

fn parse_workspace_file_operation(
    value: &Value,
) -> Result<LanguageServerWorkspaceFileOperation, String> {
    let object = value.as_object().ok_or_else(|| {
        "Language server returned a malformed workspace file operation.".to_string()
    })?;
    let options = parse_workspace_file_operation_options(object.get("options"))?;
    let required_uri = |field: &str| -> Result<String, String> {
        object
            .get(field)
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| {
                format!("Language server returned a malformed workspace file operation {field}.")
            })
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("create") => Ok(LanguageServerWorkspaceFileOperation::Create {
            uri: required_uri("uri")?,
            options,
        }),
        Some("rename") => Ok(LanguageServerWorkspaceFileOperation::Rename {
            old_uri: required_uri("oldUri")?,
            new_uri: required_uri("newUri")?,
            options,
        }),
        Some("delete") => Ok(LanguageServerWorkspaceFileOperation::Delete {
            uri: required_uri("uri")?,
            options,
        }),
        _ => Err("Language server returned an unsupported workspace file operation.".to_string()),
    }
}

fn parse_workspace_file_operation_options(
    value: Option<&Value>,
) -> Result<Option<LanguageServerWorkspaceFileOperationOptions>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or_else(|| {
        "Language server returned malformed workspace file operation options.".to_string()
    })?;
    let optional_bool = |field: &str| -> Result<Option<bool>, String> {
        match object.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value.as_bool().map(Some).ok_or_else(|| {
                format!("Language server returned malformed workspace option {field}.")
            }),
        }
    };
    Ok(Some(LanguageServerWorkspaceFileOperationOptions {
        ignore_if_exists: optional_bool("ignoreIfExists")?,
        ignore_if_not_exists: optional_bool("ignoreIfNotExists")?,
        overwrite: optional_bool("overwrite")?,
        recursive: optional_bool("recursive")?,
    }))
}

fn append_workspace_text_edits(
    changes: &mut BTreeMap<String, Vec<LanguageServerTextEdit>>,
    uri: String,
    edits: Vec<LanguageServerTextEdit>,
) {
    changes.entry(uri).or_default().extend(edits);
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanguageServerLocationLink {
    target_uri: String,
    target_range: LanguageServerRange,
}

#[cfg(test)]
mod projection_tests;
#[cfg(test)]
mod request_factory_tests;
