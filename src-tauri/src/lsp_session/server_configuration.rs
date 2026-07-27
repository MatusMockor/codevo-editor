use crate::lsp::JsonRpcRequest;
use serde_json::{json, Value};

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

pub(super) fn workspace_result(params: Option<&Value>, server_configuration: &Value) -> Value {
    let Some(items) = params
        .and_then(|params| params.get("items"))
        .and_then(Value::as_array)
    else {
        return Value::Array(Vec::new());
    };

    Value::Array(
        items
            .iter()
            .map(|item| value_for_item(item, server_configuration))
            .collect(),
    )
}

fn value_for_item(item: &Value, server_configuration: &Value) -> Value {
    let section = item.get("section").and_then(Value::as_str).unwrap_or("");
    let Some(section) = javascript_typescript_section(section) else {
        return json!({});
    };

    if section.is_empty() {
        return server_configuration.clone();
    }

    server_configuration
        .get(section)
        .cloned()
        .unwrap_or_else(|| json!({}))
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
