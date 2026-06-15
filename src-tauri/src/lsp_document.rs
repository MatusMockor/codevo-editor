use crate::lsp::{file_uri, JsonRpcNotification};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentContent {
    pub path: String,
    pub language_id: String,
    pub version: i32,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentPath {
    pub path: String,
}

pub trait TextDocumentSyncNotificationFactory {
    fn did_open(&self, document: &TextDocumentContent) -> JsonRpcNotification;
    fn did_change(&self, document: &TextDocumentContent) -> JsonRpcNotification;
    fn did_save(&self, document: &TextDocumentContent) -> JsonRpcNotification;
    fn did_close(&self, document: &TextDocumentPath) -> JsonRpcNotification;
}

pub struct LspTextDocumentSyncNotificationFactory;

impl TextDocumentSyncNotificationFactory for LspTextDocumentSyncNotificationFactory {
    fn did_open(&self, document: &TextDocumentContent) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didOpen".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&document.path)),
                    "languageId": document.language_id,
                    "version": document.version,
                    "text": document.text,
                }
            }),
        }
    }

    fn did_change(&self, document: &TextDocumentContent) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didChange".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&document.path)),
                    "version": document.version,
                },
                "contentChanges": [
                    {
                        "text": document.text,
                    }
                ],
            }),
        }
    }

    fn did_save(&self, document: &TextDocumentContent) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didSave".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&document.path)),
                },
                "text": document.text,
            }),
        }
    }

    fn did_close(&self, document: &TextDocumentPath) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didClose".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(&document.path)),
                },
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        LspTextDocumentSyncNotificationFactory, TextDocumentContent, TextDocumentPath,
        TextDocumentSyncNotificationFactory,
    };

    #[test]
    fn did_open_contains_text_document_item() {
        let factory = LspTextDocumentSyncNotificationFactory;
        let notification = factory.did_open(&content());

        assert_eq!(notification.method, "textDocument/didOpen");
        assert_eq!(notification.params["textDocument"]["languageId"], "php");
        assert_eq!(notification.params["textDocument"]["version"], 3);
        assert_eq!(notification.params["textDocument"]["text"], "<?php echo 1;");
        assert!(notification.params["textDocument"]["uri"]
            .as_str()
            .expect("uri")
            .starts_with("file://"));
    }

    #[test]
    fn did_change_uses_full_text_sync_payload() {
        let factory = LspTextDocumentSyncNotificationFactory;
        let notification = factory.did_change(&content());

        assert_eq!(notification.method, "textDocument/didChange");
        assert_eq!(notification.params["textDocument"]["version"], 3);
        assert_eq!(
            notification.params["contentChanges"][0]["text"],
            "<?php echo 1;"
        );
    }

    #[test]
    fn did_save_and_close_reference_document_uri() {
        let factory = LspTextDocumentSyncNotificationFactory;
        let save = factory.did_save(&content());
        let close = factory.did_close(&TextDocumentPath {
            path: "/tmp/User.php".to_string(),
        });

        assert_eq!(save.method, "textDocument/didSave");
        assert_eq!(save.params["text"], "<?php echo 1;");
        assert_eq!(close.method, "textDocument/didClose");
        assert_eq!(
            close.params["textDocument"]["uri"],
            save.params["textDocument"]["uri"]
        );
    }

    fn content() -> TextDocumentContent {
        TextDocumentContent {
            path: "/tmp/User.php".to_string(),
            language_id: "php".to_string(),
            version: 3,
            text: "<?php echo 1;".to_string(),
        }
    }
}
