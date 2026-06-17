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
pub struct LanguageServerWorkspaceEdit {
    pub changes: BTreeMap<String, Vec<LanguageServerTextEdit>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionDiagnostic {
    pub range: LanguageServerRange,
    pub message: String,
    pub severity: Option<u32>,
    pub source: Option<String>,
    pub code: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeActionContext {
    pub diagnostics: Vec<LanguageServerCodeActionDiagnostic>,
    pub only: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCodeAction {
    pub title: String,
    pub kind: Option<String>,
    pub is_preferred: bool,
    pub edit: Option<LanguageServerWorkspaceEdit>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentFormatting {
    pub path: String,
    pub options: LanguageServerFormattingOptions,
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionItem {
    pub label: String,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub insert_text: Option<String>,
    pub kind: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCompletionList {
    pub is_incomplete: bool,
    pub items: Vec<LanguageServerCompletionItem>,
}

pub trait TextDocumentFeatureRequestFactory {
    fn hover(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn completion(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn implementation(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn references(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest;
    fn rename(&self, rename: &TextDocumentRename) -> LanguageServerFeatureRequest;
    fn code_actions(
        &self,
        range: &TextDocumentRange,
        context: &LanguageServerCodeActionContext,
    ) -> LanguageServerFeatureRequest;
    fn formatting(&self, formatting: &TextDocumentFormatting) -> LanguageServerFeatureRequest;
}

pub struct LspTextDocumentFeatureRequestFactory;

impl TextDocumentFeatureRequestFactory for LspTextDocumentFeatureRequestFactory {
    fn hover(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/hover", position)
    }

    fn completion(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/completion", position)
    }

    fn definition(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/definition", position)
    }

    fn implementation(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        request("textDocument/implementation", position)
    }

    fn references(&self, position: &TextDocumentPosition) -> LanguageServerFeatureRequest {
        let mut request = request("textDocument/references", position);
        request.params["context"] = json!({ "includeDeclaration": true });
        request
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
                "context": {
                    "diagnostics": context.diagnostics,
                    "only": context.only,
                },
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
            items: parse_completion_items(items),
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
        items: parse_completion_items(items),
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

pub fn parse_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    if value.is_null() {
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

fn parse_completion_items(items: &[Value]) -> Vec<LanguageServerCompletionItem> {
    items.iter().filter_map(parse_completion_item).collect()
}

fn parse_completion_item(value: &Value) -> Option<LanguageServerCompletionItem> {
    let label = value.get("label").and_then(Value::as_str)?.to_string();

    Some(LanguageServerCompletionItem {
        label,
        detail: optional_string(value.get("detail")),
        documentation: value.get("documentation").and_then(markup_to_string),
        insert_text: optional_string(value.get("insertText")),
        kind: value
            .get("kind")
            .and_then(Value::as_u64)
            .map(|kind| kind as u32),
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

fn parse_workspace_edit(value: &Value) -> Result<LanguageServerWorkspaceEdit, String> {
    let mut changes = BTreeMap::new();

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
            let Some(text_document) = document_change.get("textDocument") else {
                continue;
            };
            let Some(uri) = text_document.get("uri").and_then(Value::as_str) else {
                continue;
            };
            let Some(items) = document_change.get("edits").and_then(Value::as_array) else {
                continue;
            };

            changes.insert(uri.to_string(), parse_text_edits(items)?);
        }
    }

    Ok(LanguageServerWorkspaceEdit { changes })
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

    Some(LanguageServerCodeAction {
        title,
        kind: optional_string(value.get("kind")),
        is_preferred: value
            .get("isPreferred")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        edit,
    })
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
        parse_code_action_result, parse_completion_result, parse_definition_result,
        parse_formatting_result, parse_hover_result, parse_workspace_edit_result,
        LanguageServerCodeActionContext, LanguageServerCompletionItem,
        LanguageServerCompletionList, LanguageServerFormattingOptions, LanguageServerHover,
        LanguageServerLocation, LanguageServerPosition, LanguageServerRange,
        LanguageServerTextEdit, LspTextDocumentFeatureRequestFactory,
        TextDocumentFeatureRequestFactory, TextDocumentFormatting, TextDocumentPosition,
        TextDocumentRange, TextDocumentRename,
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
    fn references_request_includes_declarations() {
        let factory = LspTextDocumentFeatureRequestFactory;
        let request = factory.references(&position());

        assert_eq!(request.method, "textDocument/references");
        assert_eq!(request.params["context"]["includeDeclaration"], true);
        assert_eq!(request.params["position"]["line"], 10);
        assert_eq!(request.params["position"]["character"], 4);
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
                diagnostics: Vec::new(),
                only: Some(vec!["quickfix".to_string()]),
            },
        );

        assert_eq!(request.method, "textDocument/codeAction");
        assert!(request.params["textDocument"]["uri"]
            .as_str()
            .expect("uri")
            .starts_with("file://"));
        assert_eq!(request.params["range"], json!(range));
        assert_eq!(request.params["context"]["only"], json!(["quickfix"]));
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
                        "insertText": "User",
                        "kind": 7,
                    },
                    { "detail": "missing label" },
                ],
            }))
            .expect("completion"),
            LanguageServerCompletionList {
                is_incomplete: true,
                items: vec![LanguageServerCompletionItem {
                    label: "User".to_string(),
                    detail: Some("class".to_string()),
                    documentation: Some("A user".to_string()),
                    insert_text: Some("User".to_string()),
                    kind: Some(7),
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
        assert_eq!(
            parse_workspace_edit_result(&json!(null)).expect("null edit"),
            None
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
        assert_eq!(
            actions[0].edit.as_ref().expect("edit").changes["file:///tmp/User.ts"][0].new_text,
            "import { User } from './user';\n"
        );
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
}
