use crate::lsp::file_uri;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
        parse_completion_result, parse_definition_result, parse_hover_result,
        LanguageServerCompletionItem, LanguageServerCompletionList, LanguageServerHover,
        LanguageServerLocation, LanguageServerPosition, LanguageServerRange,
        LspTextDocumentFeatureRequestFactory, TextDocumentFeatureRequestFactory,
        TextDocumentPosition,
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

    fn position() -> TextDocumentPosition {
        TextDocumentPosition {
            path: "/tmp/User.php".to_string(),
            line: 10,
            character: 4,
        }
    }
}
