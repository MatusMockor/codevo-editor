use super::code_action_projection::{
    validate_workspace_edit_response_value, WorkspaceEditValidationWork,
};
use super::{
    parse_workspace_edit, LanguageServerPosition, LanguageServerPrepareRenameResult,
    LanguageServerRange, LanguageServerWorkspaceEdit,
};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

const MAX_PREPARE_RENAME_PLACEHOLDER_UTF8_BYTES: usize = 1024;
const MAX_PREPARE_RENAME_RESPONSE_UTF8_BYTES: usize = 8 * 1024;
const MAX_RENAME_WORKSPACE_EDIT_RESPONSE_UTF8_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct PrepareRenameProjectionWork {
    pub(super) inspected_objects: usize,
    pub(super) placeholder_utf8_bytes: usize,
    pub(super) projected_utf8_bytes: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct RenameWorkspaceEditProjectionWork {
    pub(super) input_change_files: usize,
    pub(super) input_document_changes: usize,
    pub(super) validation: WorkspaceEditValidationWork,
    pub(super) projected_utf8_bytes: usize,
}

pub(super) fn project_prepare_rename_result(
    value: &Value,
) -> Result<Option<LanguageServerPrepareRenameResult>, String> {
    project_prepare_rename_result_with_work(value).0
}

pub(super) fn project_prepare_rename_result_with_work(
    value: &Value,
) -> (
    Result<Option<LanguageServerPrepareRenameResult>, String>,
    PrepareRenameProjectionWork,
) {
    if value.is_null() {
        return (Ok(None), PrepareRenameProjectionWork::default());
    }
    let mut work = PrepareRenameProjectionWork {
        inspected_objects: 1,
        ..PrepareRenameProjectionWork::default()
    };
    let result = parse_prepare_rename(value, &mut work).and_then(|result| {
        let (bytes, oversized) =
            serialized_len_capped(&result, MAX_PREPARE_RENAME_RESPONSE_UTF8_BYTES);
        work.projected_utf8_bytes = bytes;
        if oversized {
            return Err(
                "Language server returned an oversized prepare rename response.".to_string(),
            );
        }
        Ok(Some(result))
    });
    (result, work)
}

pub(super) fn project_workspace_edit_result(
    value: &Value,
) -> Result<Option<LanguageServerWorkspaceEdit>, String> {
    project_workspace_edit_result_with_work(value).0
}

pub(super) fn project_workspace_edit_result_with_work(
    value: &Value,
) -> (
    Result<Option<LanguageServerWorkspaceEdit>, String>,
    RenameWorkspaceEditProjectionWork,
) {
    if value.is_null() {
        return (Ok(None), RenameWorkspaceEditProjectionWork::default());
    }
    let mut work = RenameWorkspaceEditProjectionWork {
        input_change_files: value
            .get("changes")
            .and_then(Value::as_object)
            .map_or(0, serde_json::Map::len),
        input_document_changes: value
            .get("documentChanges")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        ..RenameWorkspaceEditProjectionWork::default()
    };
    let (validation, validation_work) = validate_workspace_edit_response_value(value);
    work.validation = validation_work;
    if let Err(reason) = validation {
        return (
            Err(format!(
                "Language server returned a malformed or oversized rename workspace edit: {reason}."
            )),
            work,
        );
    }
    let projected = match parse_workspace_edit(value) {
        Ok(projected) => projected,
        Err(reason) => return (Err(reason), work),
    };
    let (bytes, oversized) =
        serialized_len_capped(&projected, MAX_RENAME_WORKSPACE_EDIT_RESPONSE_UTF8_BYTES);
    work.projected_utf8_bytes = bytes;
    if oversized {
        return (
            Err("Language server returned an oversized rename workspace edit.".to_string()),
            work,
        );
    }
    (Ok(Some(projected)), work)
}

fn parse_prepare_rename(
    value: &Value,
    work: &mut PrepareRenameProjectionWork,
) -> Result<LanguageServerPrepareRenameResult, String> {
    let object = value.as_object().ok_or_else(malformed_prepare_rename)?;
    let has_default = object.contains_key("defaultBehavior");
    let has_wrapped_range = object.contains_key("range");
    let has_start = object.contains_key("start");
    let has_end = object.contains_key("end");
    let has_placeholder = object.contains_key("placeholder");

    match (
        has_default,
        has_wrapped_range,
        has_start || has_end,
        has_placeholder,
    ) {
        (true, false, false, false) => {
            if object.get("defaultBehavior").and_then(Value::as_bool) != Some(true) {
                return Err(malformed_prepare_rename());
            }
            Ok(LanguageServerPrepareRenameResult {
                default_behavior: true,
                placeholder: None,
                range: None,
            })
        }
        (false, true, false, placeholder_present) => {
            let placeholder = if placeholder_present {
                let placeholder = object
                    .get("placeholder")
                    .and_then(Value::as_str)
                    .ok_or_else(malformed_prepare_rename)?;
                if placeholder.len() > MAX_PREPARE_RENAME_PLACEHOLDER_UTF8_BYTES {
                    return Err(
                        "Language server returned an oversized rename placeholder.".to_string()
                    );
                }
                work.placeholder_utf8_bytes = placeholder.len();
                Some(placeholder.to_string())
            } else {
                None
            };
            Ok(LanguageServerPrepareRenameResult {
                default_behavior: false,
                placeholder,
                range: Some(parse_range(
                    object.get("range").ok_or_else(malformed_prepare_rename)?,
                )?),
            })
        }
        (false, false, true, false) if has_start && has_end => {
            Ok(LanguageServerPrepareRenameResult {
                default_behavior: false,
                placeholder: None,
                range: Some(parse_range(value)?),
            })
        }
        _ => Err(malformed_prepare_rename()),
    }
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, String> {
    let object = value.as_object().ok_or_else(malformed_prepare_rename)?;
    let start = parse_position(object.get("start").ok_or_else(malformed_prepare_rename)?)?;
    let end = parse_position(object.get("end").ok_or_else(malformed_prepare_rename)?)?;
    if (end.line, end.character) < (start.line, start.character) {
        return Err("Language server returned an inverted prepare rename range.".to_string());
    }
    Ok(LanguageServerRange { start, end })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, String> {
    let object = value.as_object().ok_or_else(malformed_prepare_rename)?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line"))?,
        character: required_u32(object.get("character"))?,
    })
}

fn required_u32(value: Option<&Value>) -> Result<u32, String> {
    value
        .and_then(Value::as_u64)
        .filter(|value| *value <= i32::MAX as u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(malformed_prepare_rename)
}

fn malformed_prepare_rename() -> String {
    "Language server returned a malformed prepare rename response.".to_string()
}

fn serialized_len_capped(value: &impl Serialize, maximum_bytes: usize) -> (usize, bool) {
    let mut counter = ByteCounter {
        bytes: 0,
        maximum_bytes,
    };
    let oversized = serde_json::to_writer(&mut counter, value).is_err();
    (counter.bytes, oversized)
}

struct ByteCounter {
    bytes: usize,
    maximum_bytes: usize,
}

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next_bytes = self.bytes.saturating_add(bytes.len());
        if next_bytes > self.maximum_bytes {
            self.bytes = self.maximum_bytes.saturating_add(1);
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "serialized value exceeds projection limit",
            ));
        }
        self.bytes = next_bytes;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};

    #[test]
    fn prepare_rename_exact_union_and_utf8_boundaries() {
        let placeholder = "😀".repeat(MAX_PREPARE_RENAME_PLACEHOLDER_UTF8_BYTES / 4);
        let wrapped = json!({ "range": range(2), "placeholder": placeholder });
        let direct = range(4);
        let default_behavior = json!({ "defaultBehavior": true });

        let (wrapped_result, wrapped_work) = project_prepare_rename_result_with_work(&wrapped);
        assert_eq!(
            wrapped_result
                .expect("wrapped")
                .expect("wrapped result")
                .placeholder
                .as_deref()
                .map(str::len),
            Some(MAX_PREPARE_RENAME_PLACEHOLDER_UTF8_BYTES)
        );
        assert_eq!(
            wrapped_work.placeholder_utf8_bytes,
            MAX_PREPARE_RENAME_PLACEHOLDER_UTF8_BYTES
        );
        assert!(project_prepare_rename_result(&direct).is_ok());
        assert!(project_prepare_rename_result(&default_behavior).is_ok());
        assert!(project_prepare_rename_result(&json!({
            "start": position(i32::MAX as u32, i32::MAX as u32),
            "end": position(i32::MAX as u32, i32::MAX as u32)
        }))
        .is_ok());
        assert!(project_prepare_rename_result(&json!({
            "start": position(i32::MAX as u32 + 1, 0),
            "end": position(i32::MAX as u32 + 1, 0)
        }))
        .is_err());
        assert!(project_prepare_rename_result(&json!({
            "range": range(0),
            "placeholder": format!("{placeholder}😀")
        }))
        .is_err());
    }

    #[test]
    fn prepare_rename_ambiguous_and_malformed_variants_fail_closed() {
        let malformed = [
            json!({ "defaultBehavior": false }),
            json!({ "defaultBehavior": true, "range": range(0) }),
            json!({ "range": range(0), "start": position(0, 0), "end": position(0, 1) }),
            json!({ "range": range(0), "placeholder": null }),
            json!({ "start": position(0, 0) }),
            json!({
                "start": position(2, 0),
                "end": position(1, 0)
            }),
        ];
        for value in malformed {
            let (result, work) = project_prepare_rename_result_with_work(&value);
            assert!(result.is_err());
            assert_eq!(work.inspected_objects, 1);
        }
    }

    #[test]
    fn hundred_thousand_unknown_fields_and_deep_unknown_value_do_constant_known_work() {
        let mut object = Map::new();
        object.insert("defaultBehavior".to_string(), Value::Bool(true));
        for index in 0..100_000 {
            object.insert(format!("unknown{index}"), Value::Null);
        }
        let mut deep = Value::Null;
        for _ in 0..100 {
            deep = json!({ "nested": deep });
        }
        object.insert("deepUnknown".to_string(), deep);

        let (result, work) = project_prepare_rename_result_with_work(&Value::Object(object));

        assert!(result.is_ok());
        assert_eq!(work.inspected_objects, 1);
    }

    #[test]
    fn hundred_thousand_workspace_files_fail_after_bounded_validation_work() {
        let mut changes = Map::new();
        for index in 0..100_000 {
            changes.insert(format!("file:///project/{index}.ts"), json!([]));
        }
        let response = json!({ "changes": changes });

        let (result, work) = project_workspace_edit_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_change_files, 100_000);
        assert_eq!(work.validation.workspace_files, 129);
        assert_eq!(work.validation.text_edits, 0);
    }

    #[test]
    fn workspace_edit_limits_and_malformed_known_fields_fail_closed() {
        let oversized_edits = json!({
            "changes": {
                "file:///project/a.ts": vec![text_edit(0, "x"); 129]
            }
        });
        let oversized_text = json!({
            "changes": {
                "file:///project/a.ts": [text_edit(0, &"😀".repeat(16_385))]
            }
        });
        let malformed_range = json!({
            "changes": {
                "file:///project/a.ts": [{
                    "range": {
                        "start": position(2, 0),
                        "end": position(1, 0)
                    },
                    "newText": "x"
                }]
            }
        });
        let ambiguous_document_change = json!({
            "documentChanges": [{
                "kind": "create",
                "uri": "file:///project/a.ts",
                "textDocument": {
                    "uri": "file:///project/a.ts",
                    "version": 1
                },
                "edits": []
            }]
        });
        let unsupported_annotations = json!({
            "changes": {
                "file:///project/a.ts": [{
                    "range": range(0),
                    "newText": "x",
                    "annotationId": "confirm"
                }]
            },
            "changeAnnotations": {
                "confirm": { "label": "Confirm rename" }
            }
        });
        let oversized_uri = json!({
            "changes": {
                format!("file:///{}", "😀".repeat(4_096)): []
            }
        });
        let too_many_operations = json!({
            "documentChanges": (0..129)
                .map(|_| json!({
                    "kind": "create",
                    "uri": "file:///project/same.ts"
                }))
                .collect::<Vec<_>>()
        });

        assert!(project_workspace_edit_result(&oversized_edits).is_err());
        assert!(project_workspace_edit_result(&oversized_text).is_err());
        assert!(project_workspace_edit_result(&malformed_range).is_err());
        assert!(project_workspace_edit_result(&ambiguous_document_change).is_err());
        assert!(project_workspace_edit_result(&unsupported_annotations).is_err());
        assert!(project_workspace_edit_result(&oversized_uri).is_err());
        let (operations_result, operations_work) =
            project_workspace_edit_result_with_work(&too_many_operations);
        assert!(operations_result.is_err());
        assert_eq!(operations_work.validation.workspace_files, 1);
        assert_eq!(operations_work.validation.file_operations, 129);
    }

    #[test]
    fn hundred_thousand_text_edits_fail_before_item_work() {
        let response = json!({
            "changes": {
                "file:///project/a.ts": vec![text_edit(0, "x"); 100_000]
            }
        });

        let (result, work) = project_workspace_edit_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_change_files, 1);
        assert_eq!(work.validation.workspace_files, 1);
        assert_eq!(work.validation.text_edits, 0);
    }

    #[test]
    fn repeated_document_uri_cannot_bypass_per_file_edit_cap() {
        let response = json!({
            "changes": {
                "file:///project/a.ts": vec![text_edit(0, "x"); 64]
            },
            "documentChanges": [{
                "textDocument": {
                    "uri": "file:///project/a.ts",
                    "version": 1
                },
                "edits": vec![text_edit(1, "y"); 65]
            }]
        });

        let (result, work) = project_workspace_edit_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.validation.workspace_files, 1);
        assert_eq!(work.validation.text_edits, 64);
    }

    #[test]
    fn unrepresentable_operation_order_and_conflicting_versions_fail_closed() {
        let text_before_rename = json!({
            "documentChanges": [
                {
                    "textDocument": {
                        "uri": "file:///project/old.ts",
                        "version": 1
                    },
                    "edits": [text_edit(0, "x")]
                },
                {
                    "kind": "rename",
                    "oldUri": "file:///project/old.ts",
                    "newUri": "file:///project/new.ts"
                }
            ]
        });
        let conflicting_versions = json!({
            "documentChanges": [
                {
                    "textDocument": {
                        "uri": "file:///project/a.ts",
                        "version": 1
                    },
                    "edits": [text_edit(0, "x")]
                },
                {
                    "textDocument": {
                        "uri": "file:///project/a.ts",
                        "version": 2
                    },
                    "edits": [text_edit(1, "y")]
                }
            ]
        });
        let operations_before_text = json!({
            "documentChanges": [
                {
                    "kind": "create",
                    "uri": "file:///project/a.ts"
                },
                {
                    "textDocument": {
                        "uri": "file:///project/a.ts",
                        "version": null
                    },
                    "edits": [text_edit(0, "x")]
                }
            ]
        });

        assert!(project_workspace_edit_result(&text_before_rename).is_err());
        assert!(project_workspace_edit_result(&conflicting_versions).is_err());
        assert!(project_workspace_edit_result(&operations_before_text).is_ok());
    }

    #[test]
    fn workspace_coordinates_and_versions_honor_exact_lsp_integer_domains() {
        let exact = json!({
            "documentChanges": [{
                "textDocument": {
                    "uri": "file:///project/a.ts",
                    "version": i32::MAX
                },
                "edits": [{
                    "range": {
                        "start": position(i32::MAX as u32, i32::MAX as u32),
                        "end": position(i32::MAX as u32, i32::MAX as u32)
                    },
                    "newText": "x"
                }]
            }]
        });
        let oversized_coordinate = json!({
            "changes": {
                "file:///project/a.ts": [{
                    "range": {
                        "start": position(i32::MAX as u32 + 1, 0),
                        "end": position(i32::MAX as u32 + 1, 0)
                    },
                    "newText": "x"
                }]
            }
        });
        let oversized_version = json!({
            "documentChanges": [{
                "textDocument": {
                    "uri": "file:///project/a.ts",
                    "version": i64::from(i32::MAX) + 1
                },
                "edits": []
            }]
        });

        assert!(project_workspace_edit_result(&exact).is_ok());
        assert!(project_workspace_edit_result(&oversized_coordinate).is_err());
        assert!(project_workspace_edit_result(&oversized_version).is_err());
    }

    #[test]
    fn unknown_deep_workspace_fields_are_not_cloned_or_traversed() {
        let mut deep = Value::Null;
        for _ in 0..100 {
            deep = json!({ "nested": deep });
        }
        let response = json!({
            "changes": {
                "file:///project/a.ts": [{
                    "range": {
                        "start": { "line": 0, "character": 0, "unknown": deep },
                        "end": position(0, 1)
                    },
                    "newText": "renamed"
                }]
            }
        });

        let (result, work) = project_workspace_edit_result_with_work(&response);

        assert!(result.is_ok());
        assert_eq!(work.validation.workspace_files, 1);
        assert_eq!(work.validation.text_edits, 1);
        assert_eq!(work.validation.new_text_utf8_bytes, 7);
    }

    #[test]
    fn projected_workspace_response_cap_is_deterministic() {
        let uri_tail = "u".repeat(16_360);
        let mut changes = Map::new();
        for index in 0..128 {
            changes.insert(
                format!("file:///{index:03}/{uri_tail}"),
                json!([text_edit(index, "x")]),
            );
        }
        let response = json!({ "changes": changes });

        let (first_result, first_work) = project_workspace_edit_result_with_work(&response);
        let (second_result, second_work) = project_workspace_edit_result_with_work(&response);

        assert!(first_result.is_err());
        assert_eq!(first_result, second_result);
        assert_eq!(first_work, second_work);
        assert_eq!(
            first_work.projected_utf8_bytes,
            MAX_RENAME_WORKSPACE_EDIT_RESPONSE_UTF8_BYTES + 1
        );
    }

    fn text_edit(line: usize, new_text: &str) -> Value {
        json!({
            "range": range(line as u32),
            "newText": new_text
        })
    }

    fn range(line: u32) -> Value {
        json!({
            "start": position(line, 0),
            "end": position(line, 1)
        })
    }

    fn position(line: u32, character: u32) -> Value {
        json!({ "line": line, "character": character })
    }
}
