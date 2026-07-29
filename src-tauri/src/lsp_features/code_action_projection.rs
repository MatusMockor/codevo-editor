use super::{
    parse_code_action_command, parse_workspace_edit, LanguageServerCodeAction,
    LanguageServerCodeActionCommand, LanguageServerCodeActionContext,
    LanguageServerCodeActionDiagnostic, LanguageServerCodeActionDisabled, LanguageServerPosition,
    LanguageServerRange, LanguageServerTextEdit, LanguageServerWorkspaceEdit,
    LanguageServerWorkspaceFileOperation,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};

pub(super) const MAX_CODE_ACTION_RESULTS: usize = 256;
pub(super) const MAX_CODE_ACTION_RESPONSE_UTF8_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_CODE_ACTION_ITEM_UTF8_BYTES: usize = 256 * 1024;
pub(super) const MAX_CODE_ACTION_DIAGNOSTICS: usize = 256;
pub(super) const MAX_CODE_ACTION_CONTEXT_UTF8_BYTES: usize = 512 * 1024;
const MAX_CODE_ACTION_TITLE_UTF8_BYTES: usize = 4 * 1024;
const MAX_CODE_ACTION_KIND_UTF8_BYTES: usize = 1024;
const MAX_CODE_ACTION_REASON_UTF8_BYTES: usize = 8 * 1024;
const MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES: usize = 16 * 1024;
const MAX_CODE_ACTION_URI_UTF8_BYTES: usize = 16 * 1024;
const MAX_CODE_ACTION_NEW_TEXT_UTF8_BYTES: usize = 64 * 1024;
const MAX_CODE_ACTION_WORKSPACE_FILES: usize = 128;
const MAX_CODE_ACTION_TEXT_EDITS: usize = 512;
const MAX_CODE_ACTION_TEXT_EDITS_PER_FILE: usize = 128;
const MAX_CODE_ACTION_FILE_OPERATIONS: usize = 128;
const MAX_CODE_ACTION_NEW_TEXT_AGGREGATE_UTF8_BYTES: usize = 512 * 1024;
const MAX_CODE_ACTION_COMMAND_ARGUMENTS: usize = 64;
const MAX_CODE_ACTION_ONLY_KINDS: usize = 32;
const MAX_CODE_ACTION_JSON_DEPTH: usize = 16;
const MAX_CODE_ACTION_JSON_NODES: usize = 4_096;
const MAX_CODE_ACTION_JSON_CONTAINER_ITEMS: usize = 256;
const MAX_CODE_ACTION_JSON_UTF8_BYTES: usize = 64 * 1024;
const CODE_ACTION_RESPONSE_ENVELOPE_UTF8_BYTES: usize = 2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct CodeActionProjectionWork {
    pub(super) input_items: usize,
    pub(super) visited_items: usize,
    pub(super) projected_items: usize,
    pub(super) measured_raw_utf8_bytes: usize,
    pub(super) projected_utf8_bytes: usize,
    pub(super) json_nodes: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct WorkspaceEditValidationWork {
    pub(super) workspace_files: usize,
    pub(super) text_edits: usize,
    pub(super) file_operations: usize,
    pub(super) new_text_utf8_bytes: usize,
}

#[derive(Default)]
struct ActionBudget {
    workspace_uris: BTreeSet<String>,
    workspace_edit_counts: BTreeMap<String, usize>,
    workspace_versions: BTreeMap<String, Option<i64>>,
    text_edits: usize,
    file_operations: usize,
    new_text_bytes: usize,
    saw_document_text_edit: bool,
    json: JsonBudget,
}

#[derive(Default)]
struct JsonBudget {
    nodes: usize,
    string_bytes: usize,
    serialized_bytes: usize,
}

pub(super) fn validate_workspace_edit_response_value(
    value: &Value,
) -> (Result<(), String>, WorkspaceEditValidationWork) {
    let mut budget = ActionBudget::default();
    let result = validate_workspace_edit_value(value, &mut budget);
    let work = WorkspaceEditValidationWork {
        workspace_files: budget.workspace_uris.len(),
        text_edits: budget.text_edits,
        file_operations: budget.file_operations,
        new_text_utf8_bytes: budget.new_text_bytes,
    };
    (result, work)
}

pub(super) fn project_code_action_result(
    value: &Value,
) -> Result<Vec<LanguageServerCodeAction>, String> {
    project_code_action_result_with_work(value).0
}

pub(super) fn project_code_action_result_with_work(
    value: &Value,
) -> (
    Result<Vec<LanguageServerCodeAction>, String>,
    CodeActionProjectionWork,
) {
    if value.is_null() {
        return (Ok(Vec::new()), CodeActionProjectionWork::default());
    }
    let Some(items) = value.as_array() else {
        return (
            Err("Language server returned a malformed code action response.".to_string()),
            CodeActionProjectionWork::default(),
        );
    };
    let mut work = CodeActionProjectionWork {
        input_items: items.len(),
        ..CodeActionProjectionWork::default()
    };
    if items.len() > MAX_CODE_ACTION_RESULTS {
        return (
            Err(format!(
                "Language server returned too many code actions (maximum {MAX_CODE_ACTION_RESULTS})."
            )),
            work,
        );
    }

    let mut raw_response_bytes = CODE_ACTION_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut projected_response_bytes = CODE_ACTION_RESPONSE_ENVELOPE_UTF8_BYTES;
    let mut projected = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        work.visited_items += 1;
        let separator_bytes = usize::from(index > 0);
        let raw_cap = MAX_CODE_ACTION_ITEM_UTF8_BYTES.min(
            MAX_CODE_ACTION_RESPONSE_UTF8_BYTES
                .saturating_sub(raw_response_bytes)
                .saturating_sub(separator_bytes),
        );
        let (raw_bytes, raw_oversized) = serialized_len_capped(item, raw_cap);
        work.measured_raw_utf8_bytes = work.measured_raw_utf8_bytes.saturating_add(raw_bytes);
        if raw_oversized {
            return (
                Err(format!(
                    "Language server returned oversized code action {index}."
                )),
                work,
            );
        }
        raw_response_bytes += separator_bytes + raw_bytes;

        let (action_result, json_nodes) = parse_code_action(item);
        work.json_nodes = work.json_nodes.saturating_add(json_nodes);
        let action = match action_result {
            Ok(action) => action,
            Err(reason) => {
                return (
                    Err(format!(
                        "Language server returned malformed code action {index}: {reason}."
                    )),
                    work,
                );
            }
        };

        let projected_cap = MAX_CODE_ACTION_ITEM_UTF8_BYTES.min(
            MAX_CODE_ACTION_RESPONSE_UTF8_BYTES
                .saturating_sub(projected_response_bytes)
                .saturating_sub(separator_bytes),
        );
        let (projected_bytes, projected_oversized) = serialized_len_capped(&action, projected_cap);
        work.projected_utf8_bytes = work.projected_utf8_bytes.saturating_add(projected_bytes);
        if projected_oversized {
            return (
                Err(format!(
                    "Language server returned oversized code action projection {index}."
                )),
                work,
            );
        }
        projected_response_bytes += separator_bytes + projected_bytes;
        projected.push(action);
        work.projected_items += 1;
    }

    (Ok(projected), work)
}

pub(super) fn project_resolved_code_action_result(
    value: &Value,
) -> Result<LanguageServerCodeAction, String> {
    let (raw_bytes, raw_oversized) = serialized_len_capped(value, MAX_CODE_ACTION_ITEM_UTF8_BYTES);
    if raw_oversized {
        return Err(format!(
            "Language server returned an oversized resolved code action after {raw_bytes} bytes."
        ));
    }
    let (action, _) = parse_code_action(value);
    let action = action.map_err(|reason| {
        format!("Language server returned malformed resolved code action: {reason}.")
    })?;
    let (_, projected_oversized) = serialized_len_capped(&action, MAX_CODE_ACTION_ITEM_UTF8_BYTES);
    if projected_oversized {
        return Err("Language server returned an oversized resolved code action.".to_string());
    }
    Ok(action)
}

pub(super) fn validate_code_action_context(
    context: &LanguageServerCodeActionContext,
) -> Result<(), String> {
    validate_code_action_context_with_work(context).map(|_| ())
}

fn validate_code_action_context_with_work(
    context: &LanguageServerCodeActionContext,
) -> Result<CodeActionProjectionWork, String> {
    if context.diagnostics.len() > MAX_CODE_ACTION_DIAGNOSTICS {
        return Err(format!(
            "Code action request contains too many diagnostics (maximum {MAX_CODE_ACTION_DIAGNOSTICS})."
        ));
    }
    if context
        .only
        .as_ref()
        .is_some_and(|only| only.len() > MAX_CODE_ACTION_ONLY_KINDS)
    {
        return Err(format!(
            "Code action request contains too many requested kinds (maximum {MAX_CODE_ACTION_ONLY_KINDS})."
        ));
    }
    if context
        .trigger_kind
        .is_some_and(|trigger_kind| !(1..=2).contains(&trigger_kind))
    {
        return Err("Code action request contains an unsupported trigger kind.".to_string());
    }
    let (_, oversized) = serialized_len_capped(context, MAX_CODE_ACTION_CONTEXT_UTF8_BYTES);
    if oversized {
        return Err("Code action request context exceeds the bounded payload size.".to_string());
    }

    let mut work = CodeActionProjectionWork::default();
    let mut json_budget = JsonBudget::default();
    for diagnostic in &context.diagnostics {
        validate_typed_diagnostic(diagnostic, &mut json_budget)?;
        work.visited_items += 1;
    }
    if let Some(only) = &context.only {
        for kind in only {
            validate_string(kind, MAX_CODE_ACTION_KIND_UTF8_BYTES, "code action kind")?;
        }
    }
    work.json_nodes = json_budget.nodes;
    Ok(work)
}

pub(super) fn validate_code_action_resolve_request(
    action: &LanguageServerCodeAction,
) -> Result<(), String> {
    let (_, oversized) = serialized_len_capped(action, MAX_CODE_ACTION_ITEM_UTF8_BYTES);
    if oversized {
        return Err("Code action resolve request exceeds the bounded payload size.".to_string());
    }
    validate_typed_action(action)?;
    Ok(())
}

pub(super) fn validate_code_action_request_range(
    range: &LanguageServerRange,
) -> Result<(), String> {
    validate_range(range)
}

fn parse_code_action(value: &Value) -> (Result<LanguageServerCodeAction, String>, usize) {
    let mut budget = ActionBudget::default();
    let action = parse_code_action_with_budget(value, &mut budget);
    (action, budget.json.nodes)
}

fn parse_code_action_with_budget(
    value: &Value,
    budget: &mut ActionBudget,
) -> Result<LanguageServerCodeAction, String> {
    let object = value.as_object().ok_or("expected an object")?;
    let title = bounded_required_string(
        object.get("title"),
        MAX_CODE_ACTION_TITLE_UTF8_BYTES,
        "title",
    )?;
    let kind =
        bounded_optional_string(object.get("kind"), MAX_CODE_ACTION_KIND_UTF8_BYTES, "kind")?;
    let is_preferred = optional_bool(object.get("isPreferred"), "isPreferred")?.unwrap_or(false);
    let disabled = parse_disabled(object.get("disabled"))?;
    let edit = match object.get("edit") {
        None | Some(Value::Null) => None,
        Some(edit) => {
            validate_workspace_edit_value(edit, budget)?;
            Some(parse_workspace_edit(edit).map_err(|_| "edit")?)
        }
    };
    validate_command_value(value, &mut budget.json)?;
    let command = match object.get("command") {
        None | Some(Value::Null) => None,
        Some(_) => Some(parse_code_action_command(value).ok_or("command")?),
    };
    let data = match object.get("data") {
        None => None,
        Some(data) => {
            validate_json_value(data, 0, &mut budget.json)?;
            Some(data.clone())
        }
    };

    Ok(LanguageServerCodeAction {
        title,
        kind,
        is_preferred,
        disabled,
        edit,
        command,
        data,
    })
}

fn parse_disabled(
    value: Option<&Value>,
) -> Result<Option<LanguageServerCodeActionDisabled>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or("disabled")?;
    Ok(Some(LanguageServerCodeActionDisabled {
        reason: bounded_required_string(
            object.get("reason"),
            MAX_CODE_ACTION_REASON_UTF8_BYTES,
            "disabled reason",
        )?,
    }))
}

fn validate_command_value(action: &Value, json_budget: &mut JsonBudget) -> Result<(), String> {
    let Some(command_value) = action.get("command") else {
        return Ok(());
    };
    if command_value.is_null() {
        return Ok(());
    }
    let container = if command_value.is_object() {
        command_value
    } else if command_value.is_string() {
        action
    } else {
        return Err("command".to_string());
    };
    bounded_required_str(
        container.get("command"),
        MAX_CODE_ACTION_TITLE_UTF8_BYTES,
        "command",
    )?;
    if command_value.is_object() {
        bounded_required_str(
            container.get("title"),
            MAX_CODE_ACTION_TITLE_UTF8_BYTES,
            "command title",
        )?;
    }
    if let Some(arguments) = container.get("arguments") {
        if arguments.is_null() {
            return Ok(());
        }
        let items = arguments.as_array().ok_or("command arguments")?;
        if items.len() > MAX_CODE_ACTION_COMMAND_ARGUMENTS {
            return Err("command arguments".to_string());
        }
        for argument in items {
            validate_json_value(argument, 0, json_budget)?;
        }
    }
    Ok(())
}

fn validate_workspace_edit_value(value: &Value, budget: &mut ActionBudget) -> Result<(), String> {
    let object = value.as_object().ok_or("edit")?;
    if object.contains_key("changeAnnotations") {
        return Err("unsupported workspace change annotations".to_string());
    }
    if let Some(changes) = object.get("changes") {
        let changes = changes.as_object().ok_or("workspace changes")?;
        for (uri, edits) in changes {
            add_workspace_file(uri, budget)?;
            validate_text_edit_array(uri, edits, budget)?;
        }
    }
    if let Some(document_changes) = object.get("documentChanges") {
        let document_changes = document_changes
            .as_array()
            .ok_or("workspace document changes")?;
        if document_changes.len()
            > MAX_CODE_ACTION_TEXT_EDITS.saturating_add(MAX_CODE_ACTION_FILE_OPERATIONS)
        {
            return Err("workspace document changes".to_string());
        }
        for change in document_changes {
            let change = change.as_object().ok_or("workspace document change")?;
            match (
                change.contains_key("textDocument"),
                change.contains_key("kind"),
            ) {
                (true, false) => {
                    let text_document = change.get("textDocument").ok_or("text document")?;
                    let text_document = text_document.as_object().ok_or("text document")?;
                    let uri = bounded_required_str(
                        text_document.get("uri"),
                        MAX_CODE_ACTION_URI_UTF8_BYTES,
                        "text document uri",
                    )?;
                    add_workspace_file(uri, budget)?;
                    if let Some(version) = text_document.get("version") {
                        let version = if version.is_null() {
                            None
                        } else {
                            Some(
                                version
                                    .as_i64()
                                    .and_then(|version| i32::try_from(version).ok())
                                    .map(i64::from)
                                    .ok_or("text document version")?,
                            )
                        };
                        if budget
                            .workspace_versions
                            .get(uri)
                            .is_some_and(|existing| *existing != version)
                        {
                            return Err("conflicting text document versions".to_string());
                        }
                        budget.workspace_versions.insert(uri.to_string(), version);
                    }
                    validate_text_edit_array(
                        uri,
                        change.get("edits").ok_or("text document edits")?,
                        budget,
                    )?;
                    budget.saw_document_text_edit = true;
                }
                (false, true) => {
                    if budget.saw_document_text_edit {
                        return Err("unrepresentable workspace edit ordering".to_string());
                    }
                    validate_file_operation(change, budget)?;
                }
                _ => return Err("workspace document change union".to_string()),
            }
        }
    }
    Ok(())
}

fn validate_text_edit_array(
    uri: &str,
    value: &Value,
    budget: &mut ActionBudget,
) -> Result<(), String> {
    let edits = value.as_array().ok_or("text edits")?;
    let file_edits = budget
        .workspace_edit_counts
        .entry(uri.to_string())
        .or_default();
    *file_edits = file_edits.saturating_add(edits.len());
    if *file_edits > MAX_CODE_ACTION_TEXT_EDITS_PER_FILE {
        return Err("text edits per file".to_string());
    }
    budget.text_edits = budget.text_edits.saturating_add(edits.len());
    if budget.text_edits > MAX_CODE_ACTION_TEXT_EDITS {
        return Err("total text edits".to_string());
    }
    for edit in edits {
        let edit = edit.as_object().ok_or("text edit")?;
        if edit.contains_key("annotationId") {
            return Err("unsupported annotated text edit".to_string());
        }
        parse_range(edit.get("range").ok_or("text edit range")?)?;
        let new_text = bounded_required_str(
            edit.get("newText"),
            MAX_CODE_ACTION_NEW_TEXT_UTF8_BYTES,
            "newText",
        )?;
        budget.new_text_bytes = budget.new_text_bytes.saturating_add(new_text.len());
        if budget.new_text_bytes > MAX_CODE_ACTION_NEW_TEXT_AGGREGATE_UTF8_BYTES {
            return Err("aggregate newText".to_string());
        }
    }
    Ok(())
}

fn validate_file_operation(
    value: &serde_json::Map<String, Value>,
    budget: &mut ActionBudget,
) -> Result<(), String> {
    if value.contains_key("annotationId") {
        return Err("unsupported annotated file operation".to_string());
    }
    budget.file_operations = budget.file_operations.saturating_add(1);
    if budget.file_operations > MAX_CODE_ACTION_FILE_OPERATIONS {
        return Err("file operations".to_string());
    }
    let kind = bounded_required_str(
        value.get("kind"),
        MAX_CODE_ACTION_KIND_UTF8_BYTES,
        "file operation kind",
    )?;
    match kind {
        "create" | "delete" => {
            let uri = bounded_required_str(
                value.get("uri"),
                MAX_CODE_ACTION_URI_UTF8_BYTES,
                "file operation uri",
            )?;
            add_workspace_file(uri, budget)?;
        }
        "rename" => {
            let old_uri = bounded_required_str(
                value.get("oldUri"),
                MAX_CODE_ACTION_URI_UTF8_BYTES,
                "oldUri",
            )?;
            let new_uri = bounded_required_str(
                value.get("newUri"),
                MAX_CODE_ACTION_URI_UTF8_BYTES,
                "newUri",
            )?;
            add_workspace_file(old_uri, budget)?;
            add_workspace_file(new_uri, budget)?;
        }
        _ => return Err("file operation kind".to_string()),
    }
    if let Some(options) = value.get("options") {
        if !options.is_null() {
            let options = options.as_object().ok_or("file operation options")?;
            for field in [
                "ignoreIfExists",
                "ignoreIfNotExists",
                "overwrite",
                "recursive",
            ] {
                if options
                    .get(field)
                    .is_some_and(|value| !value.is_null() && !value.is_boolean())
                {
                    return Err("file operation option".to_string());
                }
            }
        }
    }
    Ok(())
}

fn add_workspace_file(uri: &str, budget: &mut ActionBudget) -> Result<(), String> {
    validate_string(uri, MAX_CODE_ACTION_URI_UTF8_BYTES, "workspace uri")?;
    budget.workspace_uris.insert(uri.to_string());
    if budget.workspace_uris.len() > MAX_CODE_ACTION_WORKSPACE_FILES {
        return Err("workspace files".to_string());
    }
    Ok(())
}

fn validate_typed_action(action: &LanguageServerCodeAction) -> Result<(), String> {
    validate_string(
        &action.title,
        MAX_CODE_ACTION_TITLE_UTF8_BYTES,
        "code action title",
    )?;
    if let Some(kind) = &action.kind {
        validate_string(kind, MAX_CODE_ACTION_KIND_UTF8_BYTES, "code action kind")?;
    }
    if let Some(disabled) = &action.disabled {
        validate_string(
            &disabled.reason,
            MAX_CODE_ACTION_REASON_UTF8_BYTES,
            "disabled reason",
        )?;
    }
    let mut budget = ActionBudget::default();
    if let Some(edit) = &action.edit {
        validate_typed_workspace_edit(edit, &mut budget)?;
    }
    if let Some(command) = &action.command {
        validate_typed_command(command, &mut budget.json)?;
    }
    if let Some(data) = &action.data {
        validate_json_value(data, 0, &mut budget.json)?;
    }
    Ok(())
}

fn validate_typed_workspace_edit(
    edit: &LanguageServerWorkspaceEdit,
    budget: &mut ActionBudget,
) -> Result<(), String> {
    for (uri, edits) in &edit.changes {
        add_workspace_file(uri, budget)?;
        validate_typed_text_edits(uri, edits, budget)?;
    }
    for (uri, version) in &edit.document_versions {
        add_workspace_file(uri, budget)?;
        if version.is_some_and(|version| i32::try_from(version).is_err()) {
            return Err("Document version exceeds the LSP integer domain.".to_string());
        }
    }
    for operation in &edit.file_operations {
        budget.file_operations = budget.file_operations.saturating_add(1);
        if budget.file_operations > MAX_CODE_ACTION_FILE_OPERATIONS {
            return Err("Too many workspace file operations.".to_string());
        }
        match operation {
            LanguageServerWorkspaceFileOperation::Create { uri, .. }
            | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => {
                add_workspace_file(uri, budget)?;
            }
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri, new_uri, ..
            } => {
                add_workspace_file(old_uri, budget)?;
                add_workspace_file(new_uri, budget)?;
            }
        }
    }
    Ok(())
}

fn validate_typed_text_edits(
    uri: &str,
    edits: &[LanguageServerTextEdit],
    budget: &mut ActionBudget,
) -> Result<(), String> {
    let file_edits = budget
        .workspace_edit_counts
        .entry(uri.to_string())
        .or_default();
    *file_edits = file_edits.saturating_add(edits.len());
    if *file_edits > MAX_CODE_ACTION_TEXT_EDITS_PER_FILE {
        return Err("Too many text edits for one file.".to_string());
    }
    budget.text_edits = budget.text_edits.saturating_add(edits.len());
    if budget.text_edits > MAX_CODE_ACTION_TEXT_EDITS {
        return Err("Too many code action text edits.".to_string());
    }
    for edit in edits {
        validate_range(&edit.range)?;
        validate_string(
            &edit.new_text,
            MAX_CODE_ACTION_NEW_TEXT_UTF8_BYTES,
            "newText",
        )?;
        budget.new_text_bytes = budget.new_text_bytes.saturating_add(edit.new_text.len());
        if budget.new_text_bytes > MAX_CODE_ACTION_NEW_TEXT_AGGREGATE_UTF8_BYTES {
            return Err("Code action replacement text is too large.".to_string());
        }
    }
    Ok(())
}

fn validate_typed_command(
    command: &LanguageServerCodeActionCommand,
    budget: &mut JsonBudget,
) -> Result<(), String> {
    validate_string(
        &command.title,
        MAX_CODE_ACTION_TITLE_UTF8_BYTES,
        "command title",
    )?;
    validate_string(
        &command.command,
        MAX_CODE_ACTION_TITLE_UTF8_BYTES,
        "command",
    )?;
    if let Some(arguments) = &command.arguments {
        if arguments.len() > MAX_CODE_ACTION_COMMAND_ARGUMENTS {
            return Err("Too many code action command arguments.".to_string());
        }
        for argument in arguments {
            validate_json_value(argument, 0, budget)?;
        }
    }
    Ok(())
}

fn validate_typed_diagnostic(
    diagnostic: &LanguageServerCodeActionDiagnostic,
    json_budget: &mut JsonBudget,
) -> Result<(), String> {
    validate_range(&diagnostic.range)?;
    validate_string(
        &diagnostic.message,
        MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
        "diagnostic message",
    )?;
    if diagnostic
        .severity
        .is_some_and(|severity| !(1..=4).contains(&severity))
    {
        return Err("Unsupported diagnostic severity.".to_string());
    }
    if let Some(source) = &diagnostic.source {
        validate_string(source, MAX_CODE_ACTION_KIND_UTF8_BYTES, "diagnostic source")?;
    }
    if let Some(code) = &diagnostic.code {
        match code {
            Value::Null => {}
            Value::Number(code)
                if code
                    .as_i64()
                    .and_then(|code| i32::try_from(code).ok())
                    .is_some() => {}
            Value::Number(_) => return Err("Malformed diagnostic code.".to_string()),
            Value::String(code) => {
                validate_string(code, MAX_CODE_ACTION_TITLE_UTF8_BYTES, "diagnostic code")?;
            }
            _ => return Err("Malformed diagnostic code.".to_string()),
        }
    }
    if let Some(data) = &diagnostic.data {
        validate_json_value(data, 0, json_budget)?;
    }
    Ok(())
}

fn validate_json_value(value: &Value, depth: usize, budget: &mut JsonBudget) -> Result<(), String> {
    validate_json_structure(value, depth, budget)?;
    let remaining = MAX_CODE_ACTION_JSON_UTF8_BYTES
        .saturating_sub(budget.serialized_bytes)
        .saturating_sub(1);
    let (bytes, oversized) = serialized_len_capped(value, remaining);
    if oversized {
        return Err("Code action JSON payload is too large.".to_string());
    }
    budget.serialized_bytes = budget
        .serialized_bytes
        .saturating_add(bytes)
        .saturating_add(1);
    Ok(())
}

fn validate_json_structure(
    value: &Value,
    depth: usize,
    budget: &mut JsonBudget,
) -> Result<(), String> {
    if depth > MAX_CODE_ACTION_JSON_DEPTH {
        return Err("Code action JSON payload is too deeply nested.".to_string());
    }
    budget.nodes = budget.nodes.saturating_add(1);
    if budget.nodes > MAX_CODE_ACTION_JSON_NODES {
        return Err("Code action JSON payload has too many nodes.".to_string());
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
        Value::String(value) => add_json_string_bytes(value.len(), budget)?,
        Value::Array(items) => {
            if items.len() > MAX_CODE_ACTION_JSON_CONTAINER_ITEMS {
                return Err("Code action JSON array is too large.".to_string());
            }
            for item in items {
                validate_json_structure(item, depth + 1, budget)?;
            }
        }
        Value::Object(object) => {
            if object.len() > MAX_CODE_ACTION_JSON_CONTAINER_ITEMS {
                return Err("Code action JSON object is too large.".to_string());
            }
            for (key, value) in object {
                add_json_string_bytes(key.len(), budget)?;
                validate_json_structure(value, depth + 1, budget)?;
            }
        }
    }
    Ok(())
}

fn add_json_string_bytes(bytes: usize, budget: &mut JsonBudget) -> Result<(), String> {
    if bytes > MAX_CODE_ACTION_JSON_UTF8_BYTES {
        return Err("Code action JSON string is too large.".to_string());
    }
    budget.string_bytes = budget.string_bytes.saturating_add(bytes);
    if budget.string_bytes > MAX_CODE_ACTION_JSON_UTF8_BYTES {
        return Err("Code action JSON strings are too large.".to_string());
    }
    Ok(())
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, &'static str> {
    let object = value.as_object().ok_or("range")?;
    let start = parse_position(object.get("start").ok_or("range start")?)?;
    let end = parse_position(object.get("end").ok_or("range end")?)?;
    if (end.line, end.character) < (start.line, start.character) {
        return Err("range ordering");
    }
    Ok(LanguageServerRange { start, end })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, &'static str> {
    let object = value.as_object().ok_or("position")?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line")).ok_or("line")?,
        character: required_u32(object.get("character")).ok_or("character")?,
    })
}

fn validate_range(range: &LanguageServerRange) -> Result<(), String> {
    if [
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
    ]
    .into_iter()
    .any(|value| value > i32::MAX as u32)
    {
        return Err("Range coordinate exceeds the LSP uinteger domain.".to_string());
    }
    if (range.end.line, range.end.character) < (range.start.line, range.start.character) {
        return Err("Range end precedes range start.".to_string());
    }
    Ok(())
}

fn required_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .filter(|value| *value <= i32::MAX as u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn optional_bool(value: Option<&Value>, field: &'static str) -> Result<Option<bool>, &'static str> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_bool().map(Some).ok_or(field),
    }
}

fn bounded_required_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &'static str,
) -> Result<String, &'static str> {
    bounded_required_str(value, maximum_bytes, field).map(str::to_string)
}

fn bounded_required_str<'a>(
    value: Option<&'a Value>,
    maximum_bytes: usize,
    field: &'static str,
) -> Result<&'a str, &'static str> {
    let value = value.and_then(Value::as_str).ok_or(field)?;
    if value.len() > maximum_bytes {
        return Err(field);
    }
    Ok(value)
}

fn bounded_optional_string(
    value: Option<&Value>,
    maximum_bytes: usize,
    field: &'static str,
) -> Result<Option<String>, &'static str> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_required_string(Some(value), maximum_bytes, field).map(Some),
    }
}

fn validate_string(value: &str, maximum_bytes: usize, field: &str) -> Result<(), String> {
    if value.len() > maximum_bytes {
        return Err(format!("{field} exceeds the bounded UTF-8 size."));
    }
    Ok(())
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
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn adversarial_hundred_thousand_actions_fail_before_item_work() {
        let response = Value::Array(vec![action(0); 100_000]);

        let (result, work) = project_code_action_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_items, 100_000);
        assert_eq!(work.visited_items, 0);
        assert_eq!(work.projected_items, 0);
        assert_eq!(work.measured_raw_utf8_bytes, 0);
    }

    #[test]
    fn exact_result_count_boundary_is_accepted_and_overflow_fails_closed() {
        let exact = Value::Array(
            (0..MAX_CODE_ACTION_RESULTS)
                .map(|index| action(index as u32))
                .collect(),
        );
        let overflow = Value::Array(vec![action(0); MAX_CODE_ACTION_RESULTS + 1]);

        let (exact_result, exact_work) = project_code_action_result_with_work(&exact);
        let (overflow_result, overflow_work) = project_code_action_result_with_work(&overflow);

        assert_eq!(
            exact_result.expect("exact maximum").len(),
            MAX_CODE_ACTION_RESULTS
        );
        assert_eq!(exact_work.visited_items, MAX_CODE_ACTION_RESULTS);
        assert_eq!(exact_work.projected_items, MAX_CODE_ACTION_RESULTS);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.visited_items, 0);
    }

    #[test]
    fn huge_unknown_and_oversized_utf8_fail_before_typed_projection() {
        let huge_unknown = json!({
            "a": vec![Value::Null; 100_000],
            "title": "Nested",
            "data": { "id": 1 }
        });
        let oversized_utf8 = json!({
            "title": "😀".repeat(MAX_CODE_ACTION_TITLE_UTF8_BYTES / 4 + 1),
            "data": { "id": 1 }
        });

        let (nested_result, nested_work) =
            project_code_action_result_with_work(&json!([huge_unknown]));
        let (utf8_result, utf8_work) =
            project_code_action_result_with_work(&json!([oversized_utf8]));

        assert!(nested_result.is_err());
        assert_eq!(nested_work.visited_items, 1);
        assert_eq!(nested_work.projected_items, 0);
        assert_eq!(
            nested_work.measured_raw_utf8_bytes,
            MAX_CODE_ACTION_ITEM_UTF8_BYTES + 1
        );
        assert!(utf8_result.is_err());
        assert_eq!(utf8_work.projected_items, 0);
    }

    #[test]
    fn deep_and_wide_opaque_payloads_fail_with_bounded_work() {
        let deep =
            json!([{ "title": "Deep", "data": nested_value(MAX_CODE_ACTION_JSON_DEPTH + 1) }]);
        let wide = json!([{
            "title": "Wide",
            "command": {
                "title": "Apply",
                "command": "editor.apply",
                "arguments": [vec![Value::Null; MAX_CODE_ACTION_JSON_NODES + 1]]
            }
        }]);

        let (deep_result, deep_work) = project_code_action_result_with_work(&deep);
        let (wide_result, wide_work) = project_code_action_result_with_work(&wide);

        assert!(deep_result.is_err());
        assert!(deep_work.json_nodes <= MAX_CODE_ACTION_JSON_DEPTH + 2);
        assert!(wide_result.is_err());
        assert!(wide_work.json_nodes <= MAX_CODE_ACTION_JSON_NODES + 1);
    }

    #[test]
    fn opaque_json_depth_and_node_boundaries_match_frontend_projection() {
        let exact_depth = nested_value(MAX_CODE_ACTION_JSON_DEPTH);
        let excess_depth = nested_value(MAX_CODE_ACTION_JSON_DEPTH + 1);
        let mut exact_nodes = Vec::with_capacity(16);
        for _ in 0..15 {
            exact_nodes.push(Value::Array(vec![Value::Null; 255]));
        }
        exact_nodes.push(Value::Array(vec![Value::Null; 254]));
        let mut excess_nodes = exact_nodes.clone();
        excess_nodes[15] = Value::Array(vec![Value::Null; 255]);

        assert!(project_code_action_result(&json!([
            { "title": "Exact depth", "data": exact_depth },
            { "title": "Exact nodes", "data": exact_nodes }
        ]))
        .is_ok());
        assert!(project_code_action_result(
            &json!([{ "title": "Excess depth", "data": excess_depth }])
        )
        .is_err());
        assert!(project_code_action_result(
            &json!([{ "title": "Excess nodes", "data": excess_nodes }])
        )
        .is_err());
    }

    #[test]
    fn workspace_edit_and_command_limits_fail_the_whole_action() {
        let too_many_edits = vec![text_edit("x"); MAX_CODE_ACTION_TEXT_EDITS_PER_FILE + 1];
        let too_many_arguments = vec![Value::Null; MAX_CODE_ACTION_COMMAND_ARGUMENTS + 1];
        let cases = [
            json!({
                "title": "Too many edits",
                "edit": { "changes": { "file:///project/a.ts": too_many_edits } }
            }),
            json!({
                "title": "Too many arguments",
                "command": {
                    "title": "Apply",
                    "command": "editor.apply",
                    "arguments": too_many_arguments
                }
            }),
            json!({
                "title": "Bad range",
                "edit": {
                    "changes": {
                        "file:///project/a.ts": [{
                            "range": {
                                "start": { "line": 2, "character": 0 },
                                "end": { "line": 1, "character": 0 }
                            },
                            "newText": "x"
                        }]
                    }
                }
            }),
        ];

        for malformed in cases {
            assert!(project_code_action_result(&json!([action(0), malformed])).is_err());
        }
    }

    #[test]
    fn projected_aggregate_budget_stops_at_a_deterministic_prefix() {
        let response = Value::Array(
            (0..MAX_CODE_ACTION_RESULTS)
                .map(|index| {
                    json!({
                        "title": format!("Action {index}"),
                        "data": {
                            "payload": "x".repeat(MAX_CODE_ACTION_JSON_UTF8_BYTES - 128)
                        }
                    })
                })
                .collect(),
        );

        let (first_result, first_work) = project_code_action_result_with_work(&response);
        let (second_result, second_work) = project_code_action_result_with_work(&response);

        assert!(first_result.is_err());
        assert!(first_work.visited_items < MAX_CODE_ACTION_RESULTS);
        assert_eq!(first_work.projected_items + 1, first_work.visited_items);
        assert_eq!(first_work, second_work);
        assert_eq!(first_result, second_result);
    }

    #[test]
    fn resolve_result_uses_the_same_strict_projection() {
        let resolved = json!({
            "title": "Organize imports",
            "kind": "source.organizeImports",
            "edit": {
                "changes": {
                    "file:///project/a.ts": [text_edit("import './a';\n")]
                }
            },
            "data": { "id": 7 }
        });

        let projected =
            project_resolved_code_action_result(&resolved).expect("resolved code action");
        assert_eq!(projected.title, "Organize imports");
        assert!(projected.edit.is_some());
        assert!(project_resolved_code_action_result(&json!({
            "title": "Bad",
            "data": nested_value(MAX_CODE_ACTION_JSON_DEPTH + 1)
        }))
        .is_err());
        assert!(project_resolved_code_action_result(&json!({
            "title": "😀".repeat(MAX_CODE_ACTION_ITEM_UTF8_BYTES / 4 + 1)
        }))
        .is_err());
    }

    #[test]
    fn request_context_caps_diagnostics_before_recursive_payload_guards() {
        let exact = diagnostic_context(MAX_CODE_ACTION_DIAGNOSTICS);
        let overflow = diagnostic_context(MAX_CODE_ACTION_DIAGNOSTICS + 1);
        let mut deep = LanguageServerCodeActionContext {
            diagnostics: vec![diagnostic(0)],
            only: None,
            trigger_kind: Some(2),
        };
        deep.diagnostics[0].data = Some(nested_value(MAX_CODE_ACTION_JSON_DEPTH + 1));

        assert!(validate_code_action_context(&exact).is_ok());
        assert!(validate_code_action_context(&overflow).is_err());
        assert!(validate_code_action_context(&deep).is_err());
    }

    #[test]
    fn resolve_request_caps_arguments_before_workspace_path_traversal() {
        let mut action = typed_action();
        action.command = Some(LanguageServerCodeActionCommand {
            title: "Apply".to_string(),
            command: "editor.apply".to_string(),
            arguments: Some(vec![Value::Null; MAX_CODE_ACTION_COMMAND_ARGUMENTS + 1]),
        });
        assert!(validate_code_action_resolve_request(&action).is_err());

        action.command = None;
        action.data = Some(nested_value(MAX_CODE_ACTION_JSON_DEPTH + 1));
        assert!(validate_code_action_resolve_request(&action).is_err());
    }

    #[test]
    fn resolve_request_counts_document_version_uris_before_workspace_guard() {
        let exact = action_with_document_versions(MAX_CODE_ACTION_WORKSPACE_FILES);
        let overflow = action_with_document_versions(MAX_CODE_ACTION_WORKSPACE_FILES + 1);
        let mut oversized_version = action_with_document_versions(1);
        *oversized_version
            .edit
            .as_mut()
            .expect("workspace edit")
            .document_versions
            .values_mut()
            .next()
            .expect("document version") = Some(i64::from(i32::MAX) + 1);

        assert!(validate_code_action_resolve_request(&exact).is_ok());
        assert!(validate_code_action_resolve_request(&overflow).is_err());
        assert!(validate_code_action_resolve_request(&oversized_version).is_err());
    }

    #[test]
    fn request_context_rejects_fractional_diagnostic_codes() {
        let mut context = diagnostic_context(1);
        context.diagnostics[0].code = Some(json!(1.5));

        assert!(validate_code_action_context(&context).is_err());
    }

    #[test]
    fn request_selection_range_rejects_reversed_positions() {
        let range = LanguageServerRange {
            start: LanguageServerPosition {
                line: 2,
                character: 4,
            },
            end: LanguageServerPosition {
                line: 2,
                character: 3,
            },
        };

        assert!(validate_code_action_request_range(&range).is_err());
    }

    fn action(index: u32) -> Value {
        json!({
            "title": format!("Action {index}"),
            "kind": "quickfix",
            "data": { "id": index }
        })
    }

    fn text_edit(new_text: &str) -> Value {
        json!({
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 0 }
            },
            "newText": new_text
        })
    }

    fn diagnostic(line: u32) -> LanguageServerCodeActionDiagnostic {
        LanguageServerCodeActionDiagnostic {
            range: LanguageServerRange {
                start: LanguageServerPosition { line, character: 0 },
                end: LanguageServerPosition { line, character: 1 },
            },
            message: "Unused identifier".to_string(),
            severity: Some(2),
            source: Some("typescript".to_string()),
            code: Some(json!(6133)),
            data: Some(json!({ "id": line })),
        }
    }

    fn diagnostic_context(count: usize) -> LanguageServerCodeActionContext {
        LanguageServerCodeActionContext {
            diagnostics: (0..count).map(|index| diagnostic(index as u32)).collect(),
            only: Some(vec!["quickfix".to_string()]),
            trigger_kind: Some(2),
        }
    }

    fn typed_action() -> LanguageServerCodeAction {
        LanguageServerCodeAction {
            title: "Fix".to_string(),
            kind: Some("quickfix".to_string()),
            is_preferred: false,
            disabled: None,
            edit: None,
            command: None,
            data: Some(json!({ "id": 1 })),
        }
    }

    fn action_with_document_versions(count: usize) -> LanguageServerCodeAction {
        let mut action = typed_action();
        action.edit = Some(LanguageServerWorkspaceEdit {
            changes: BTreeMap::new(),
            document_versions: (0..count)
                .map(|index| (format!("file:///p/{index}.ts"), None))
                .collect(),
            file_operations: Vec::new(),
        });
        action
    }

    fn nested_value(depth: usize) -> Value {
        let mut value = Value::Null;
        for _ in 0..depth {
            value = json!({ "next": value });
        }
        value
    }
}
