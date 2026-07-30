use crate::lsp::JsonRpcRequest;
use crate::lsp_session::configuration_bounds::{
    serialized_size_with_limit, validate_query_string, validate_settings,
    MAX_CONFIGURATION_QUERY_ITEMS, MAX_CONFIGURATION_RESPONSE_BYTES,
};
use serde_json::{json, Value};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum WorkspaceConfigurationError {
    InvalidParams(String),
    Internal(String),
}

impl fmt::Display for WorkspaceConfigurationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidParams(message) | Self::Internal(message) => formatter.write_str(message),
        }
    }
}

pub(super) fn from_initialize_request(initialize_request: &JsonRpcRequest) -> Value {
    let preferences = initialize_request
        .params
        .pointer("/initializationOptions/preferences")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let formatting_options = initialize_request
        .params
        .pointer("/initializationOptions/formattingOptions")
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "insertSpaces": true,
                "tabSize": 2,
            })
        });
    let auto_imports_enabled = preferences
        .get("includeCompletionsForModuleExports")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let inlay_hints_enabled = preferences
        .get("includeInlayFunctionLikeReturnTypeHints")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let parameter_name_hints = preferences
        .get("includeInlayParameterNameHints")
        .and_then(Value::as_str)
        .unwrap_or("literals");
    let code_lens_enabled = preferences
        .get("mockorCodeLensEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let validation_enabled = preferences
        .get("mockorValidationEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let complete_function_calls = preferences
        .get("completeFunctionCalls")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    json!({
        "format": {
            "enable": true,
            "insertSpaceAfterCommaDelimiter": true,
            "insertSpaceAfterConstructor": false,
            "insertSpaceAfterFunctionKeywordForAnonymousFunctions": true,
            "insertSpaceAfterKeywordsInControlFlowStatements": true,
            "insertSpaceAfterOpeningAndBeforeClosingEmptyBraces": true,
            "insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces": false,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces": true,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets": false,
            "insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis": false,
            "insertSpaceAfterSemicolonInForStatements": true,
            "insertSpaceBeforeAndAfterBinaryOperators": true,
            "insertSpaceBeforeFunctionParenthesis": false,
            "placeOpenBraceOnNewLineForControlBlocks": false,
            "placeOpenBraceOnNewLineForFunctions": false,
            "semicolons": "ignore",
        },
        "formattingOptions": formatting_options,
        "implicitProjectConfiguration": {
            "checkJs": false,
            "experimentalDecorators": false,
            "module": 99,
            "strict": true,
            "strictFunctionTypes": true,
            "strictNullChecks": true,
            "target": 11,
        },
        "preferences": preferences,
        "updateImportsOnFileMove": {
            "enabled": if auto_imports_enabled { "always" } else { "never" },
        },
        "validate": {
            "enable": validation_enabled,
        },
        "implementationsCodeLens": { "enabled": code_lens_enabled },
        "referencesCodeLens": {
            "enabled": code_lens_enabled,
            "showOnAllFunctions": false,
        },
        "suggest": {
            "autoImports": auto_imports_enabled,
            "completeFunctionCalls": complete_function_calls,
            "includeAutomaticOptionalChainCompletions": true,
            "includeCompletionsForImportStatements": auto_imports_enabled,
            "includeCompletionsForModuleExports": auto_imports_enabled,
        },
        "inlayHints": {
            "enumMemberValues": { "enabled": inlay_hints_enabled },
            "functionLikeReturnTypes": { "enabled": inlay_hints_enabled },
            "parameterNames": {
                "enabled": parameter_name_hints,
                "suppressWhenArgumentMatchesName": false,
            },
            "parameterTypes": { "enabled": inlay_hints_enabled },
            "propertyDeclarationTypes": { "enabled": inlay_hints_enabled },
            "variableTypes": {
                "enabled": inlay_hints_enabled,
                "suppressWhenTypeMatchesName": false,
            },
        },
    })
}

pub(super) fn workspace_result(
    params: Option<&Value>,
    server_configuration: &Value,
) -> Result<Value, WorkspaceConfigurationError> {
    let sections = query_sections(params)?;
    validate_settings(server_configuration)
        .map_err(|error| WorkspaceConfigurationError::Internal(error.to_string()))?;

    project_sections(sections, server_configuration)
}

pub(super) fn validate_workspace_query(
    params: Option<&Value>,
) -> Result<(), WorkspaceConfigurationError> {
    query_sections(params).map(|_| ())
}

fn query_sections(
    params: Option<&Value>,
) -> Result<Vec<Option<&str>>, WorkspaceConfigurationError> {
    let params = params.and_then(Value::as_object).ok_or_else(|| {
        invalid_params("Workspace configuration request parameters must be an object.")
    })?;
    if params.keys().any(|key| key != "items") {
        return Err(invalid_params(
            "Workspace configuration request contains an unknown field.",
        ));
    }
    let items = params
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_params("Workspace configuration request items must be an array."))?;
    if items.len() > MAX_CONFIGURATION_QUERY_ITEMS {
        return Err(WorkspaceConfigurationError::InvalidParams(format!(
            "Workspace configuration request exceeds {MAX_CONFIGURATION_QUERY_ITEMS} items."
        )));
    }

    let sections = items
        .iter()
        .map(section_for_item)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(sections)
}

fn project_sections(
    sections: Vec<Option<&str>>,
    server_configuration: &Value,
) -> Result<Value, WorkspaceConfigurationError> {
    let mut projected = Vec::with_capacity(sections.len());
    let mut response_bytes = 2usize;
    for (index, section) in sections.into_iter().enumerate() {
        let value = value_for_section(section, server_configuration);
        response_bytes = response_bytes
            .checked_add(usize::from(index > 0))
            .ok_or_else(response_too_large)?;
        let remaining = MAX_CONFIGURATION_RESPONSE_BYTES
            .checked_sub(response_bytes)
            .ok_or_else(response_too_large)?;
        let value_bytes = match value {
            Some(value) => {
                serialized_size_with_limit(value, remaining).map_err(|()| response_too_large())?
            }
            None => 2,
        };
        response_bytes = response_bytes
            .checked_add(value_bytes)
            .ok_or_else(response_too_large)?;
        projected.push(value);
    }

    Ok(Value::Array(
        projected
            .into_iter()
            .map(|value| value.cloned().unwrap_or_else(|| json!({})))
            .collect(),
    ))
}

fn section_for_item(item: &Value) -> Result<Option<&str>, WorkspaceConfigurationError> {
    let item = item
        .as_object()
        .ok_or_else(|| invalid_params("Workspace configuration item must be an object."))?;
    if item.keys().any(|key| key != "section" && key != "scopeUri") {
        return Err(invalid_params(
            "Workspace configuration item contains an unknown field.",
        ));
    }
    if let Some(scope_uri) = item.get("scopeUri") {
        let scope_uri = scope_uri
            .as_str()
            .ok_or_else(|| invalid_params("Workspace configuration scope URI must be a string."))?;
        validate_query_string(scope_uri).map_err(|()| {
            invalid_params("Workspace configuration scope URI exceeds 16384 bytes.")
        })?;
    }
    let section = match item.get("section") {
        Some(section) => section
            .as_str()
            .ok_or_else(|| invalid_params("Workspace configuration section must be a string."))?,
        None => "",
    };
    validate_query_string(section)
        .map_err(|()| invalid_params("Workspace configuration section exceeds 16384 bytes."))?;
    Ok(javascript_typescript_section(section))
}

fn value_for_section<'a>(
    section: Option<&str>,
    server_configuration: &'a Value,
) -> Option<&'a Value> {
    let section = section?;
    if section.is_empty() {
        return Some(server_configuration);
    }

    server_configuration.get(section)
}

fn javascript_typescript_section(section: &str) -> Option<&str> {
    if section == "formattingOptions" {
        return Some("formattingOptions");
    }

    if section == "typescript" || section == "javascript" {
        return Some("");
    }

    section
        .strip_prefix("typescript.")
        .or_else(|| section.strip_prefix("javascript."))
}

fn invalid_params(message: &str) -> WorkspaceConfigurationError {
    WorkspaceConfigurationError::InvalidParams(message.to_string())
}

fn response_too_large() -> WorkspaceConfigurationError {
    WorkspaceConfigurationError::Internal(format!(
        "Workspace configuration response exceeds {MAX_CONFIGURATION_RESPONSE_BYTES} bytes."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_configuration_rejects_more_than_128_items_before_projection() {
        let params = json!({
            "items": (0..129)
                .map(|_| json!({ "section": "typescript" }))
                .collect::<Vec<_>>(),
        });

        let error = workspace_result(Some(&params), &json!({ "suggest": {} }))
            .expect_err("oversized query must fail closed");

        assert_eq!(
            error.to_string(),
            "Workspace configuration request exceeds 128 items."
        );
    }

    #[test]
    fn workspace_configuration_accepts_exactly_128_items() {
        let params = json!({
            "items": (0..128)
                .map(|_| json!({ "section": "typescript.suggest" }))
                .collect::<Vec<_>>(),
        });

        let result = workspace_result(Some(&params), &json!({ "suggest": { "enabled": true } }))
            .expect("exact item boundary");

        assert_eq!(result.as_array().map(Vec::len), Some(128));
        assert!(result
            .as_array()
            .expect("configuration results")
            .iter()
            .all(|value| value["enabled"] == true));
    }

    #[test]
    fn workspace_configuration_section_uses_exact_utf8_byte_boundaries() {
        let exact_section = "é".repeat(8 * 1024);
        assert_eq!(exact_section.len(), 16 * 1024);
        let exact = json!({
            "items": [{ "section": exact_section }],
        });
        assert_eq!(
            workspace_result(Some(&exact), &json!({})).expect("exact UTF-8 section boundary"),
            json!([{}])
        );

        let overflow = json!({
            "items": [{ "section": format!("{exact_section}x") }],
        });
        assert_eq!(
            workspace_result(Some(&overflow), &json!({}))
                .expect_err("N+1 UTF-8 section must fail")
                .to_string(),
            "Workspace configuration section exceeds 16384 bytes."
        );
    }

    #[test]
    fn workspace_configuration_rejects_unknown_item_fields() {
        let params = json!({
            "items": [{
                "section": "typescript.suggest",
                "unexpected": true,
            }],
        });

        let error = workspace_result(Some(&params), &json!({ "suggest": {} }))
            .expect_err("unknown query fields must fail closed");

        assert_eq!(
            error.to_string(),
            "Workspace configuration item contains an unknown field."
        );
    }

    #[test]
    fn late_invalid_item_is_rejected_before_configuration_validation_or_projection() {
        let params = json!({
            "items": [
                { "section": "typescript" },
                { "section": "typescript" },
                { "section": "typescript" },
                { "section": "typescript" },
                { "section": "typescript" },
                { "section": "typescript" },
                { "section": "typescript" },
                {
                    "section": "typescript",
                    "unexpected": true,
                },
            ],
        });
        let invalid_configuration = json!({
            "payload": "x".repeat(16 * 1024 + 1),
        });

        let error = workspace_result(Some(&params), &invalid_configuration)
            .expect_err("late invalid query item must win before configuration work");

        assert_eq!(
            error.to_string(),
            "Workspace configuration item contains an unknown field."
        );
    }

    #[test]
    fn workspace_configuration_rejects_response_amplification_above_two_mibibytes() {
        let large = "x".repeat(16 * 1024);
        let configuration = json!({
            "payload": (0..15).map(|_| large.clone()).collect::<Vec<_>>(),
        });
        let params = json!({
            "items": (0..9)
                .map(|_| json!({ "section": "typescript" }))
                .collect::<Vec<_>>(),
        });

        let error = workspace_result(Some(&params), &configuration)
            .expect_err("amplified response must fail closed");

        assert_eq!(
            error.to_string(),
            "Workspace configuration response exceeds 2097152 bytes."
        );
    }
}
