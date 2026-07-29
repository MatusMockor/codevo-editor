use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentSyncChangeKind {
    #[default]
    None,
    Full,
    Incremental,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentSyncSaveCapability {
    #[default]
    Unsupported,
    Supported {
        #[serde(rename = "includeText")]
        include_text: bool,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSyncCapability {
    pub change_kind: DocumentSyncChangeKind,
    pub open_close: bool,
    pub save: DocumentSyncSaveCapability,
}

pub(super) fn parse_document_sync_capability(value: Option<&Value>) -> DocumentSyncCapability {
    let Some(value) = value else {
        return DocumentSyncCapability::default();
    };
    if let Some(change) = value.as_u64() {
        return DocumentSyncCapability {
            change_kind: parse_change_kind(change).unwrap_or_default(),
            ..DocumentSyncCapability::default()
        };
    }
    let Some(value) = value.as_object() else {
        return DocumentSyncCapability::default();
    };
    let Some(change_kind) = parse_optional_change_kind(value.get("change")) else {
        return DocumentSyncCapability::default();
    };
    let Some(open_close) = parse_optional_bool(value.get("openClose")) else {
        return DocumentSyncCapability::default();
    };
    let Some(save) = parse_save(value.get("save")) else {
        return DocumentSyncCapability::default();
    };

    DocumentSyncCapability {
        change_kind,
        open_close,
        save,
    }
}

fn parse_optional_change_kind(value: Option<&Value>) -> Option<DocumentSyncChangeKind> {
    match value {
        None => Some(DocumentSyncChangeKind::None),
        Some(value) => parse_change_kind(value.as_u64()?),
    }
}

fn parse_change_kind(value: u64) -> Option<DocumentSyncChangeKind> {
    match value {
        0 => Some(DocumentSyncChangeKind::None),
        1 => Some(DocumentSyncChangeKind::Full),
        2 => Some(DocumentSyncChangeKind::Incremental),
        _ => None,
    }
}

fn parse_optional_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        None => Some(false),
        Some(value) => value.as_bool(),
    }
}

fn parse_save(value: Option<&Value>) -> Option<DocumentSyncSaveCapability> {
    match value {
        None | Some(Value::Bool(false)) => Some(DocumentSyncSaveCapability::Unsupported),
        Some(Value::Bool(true)) => Some(DocumentSyncSaveCapability::Supported {
            include_text: false,
        }),
        Some(Value::Object(options)) => {
            let include_text = parse_optional_bool(options.get("includeText"))?;
            Some(DocumentSyncSaveCapability::Supported { include_text })
        }
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_numeric_change_kinds() {
        assert_eq!(
            parse_document_sync_capability(Some(&json!(0))).change_kind,
            DocumentSyncChangeKind::None
        );
        assert_eq!(
            parse_document_sync_capability(Some(&json!(1))).change_kind,
            DocumentSyncChangeKind::Full
        );
        assert_eq!(
            parse_document_sync_capability(Some(&json!(2))).change_kind,
            DocumentSyncChangeKind::Incremental
        );
    }

    #[test]
    fn parses_object_open_close_change_and_save_options() {
        assert_eq!(
            parse_document_sync_capability(Some(&json!({
                "change": 2,
                "openClose": true,
                "save": { "includeText": true },
                "willSave": true
            }))),
            DocumentSyncCapability {
                change_kind: DocumentSyncChangeKind::Incremental,
                open_close: true,
                save: DocumentSyncSaveCapability::Supported { include_text: true },
            }
        );
        assert_eq!(
            parse_document_sync_capability(Some(&json!({
                "change": 1,
                "save": true
            })))
            .save,
            DocumentSyncSaveCapability::Supported {
                include_text: false
            }
        );
    }

    #[test]
    fn malformed_known_fields_fail_closed() {
        for value in [
            json!(null),
            json!(3),
            json!("incremental"),
            json!({ "change": "2" }),
            json!({ "openClose": "yes" }),
            json!({ "save": "yes" }),
            json!({ "save": { "includeText": "yes" } }),
        ] {
            assert_eq!(
                parse_document_sync_capability(Some(&value)),
                DocumentSyncCapability::default()
            );
        }
    }
}
