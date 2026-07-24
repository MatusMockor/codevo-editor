//! Closed debug-evaluation request/response contract and adapter output bounds.

use super::{
    DebugEvaluateContext, DebugEvaluateErrorKind, DebugEvaluateFailure, DebugVariableInfo,
    MAX_DEBUG_EVALUATE_EXPRESSION_BYTES, MAX_DEBUG_EVALUATE_MESSAGE_BYTES,
    MAX_DEBUG_EVALUATE_ROOT_BYTES, MAX_DEBUG_EVALUATE_TYPE_BYTES, MAX_DEBUG_EVALUATE_VALUE_BYTES,
    MAX_JAVASCRIPT_SAFE_INTEGER,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugEvaluateRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) frame_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) expression: String,
    pub(crate) context: DebugEvaluateContext,
    pub(crate) allow_side_effects: bool,
}

impl DebugEvaluateRequest {
    pub(super) fn validate(&self) -> Result<(), DebugEvaluateFailure> {
        validate_evaluate_text(
            &self.root_path,
            MAX_DEBUG_EVALUATE_ROOT_BYTES,
            false,
            "Debug workspace root",
        )?;
        validate_evaluate_text(
            &self.expression,
            MAX_DEBUG_EVALUATE_EXPRESSION_BYTES,
            true,
            "Debug expression",
        )?;
        for (value, label) in [
            (self.session_id, "session"),
            (self.frame_id, "frame"),
            (self.pause_generation, "pause generation"),
        ] {
            if value == 0 || value > MAX_JAVASCRIPT_SAFE_INTEGER {
                return Err(DebugEvaluateFailure::unsupported(format!(
                    "Debug {label} id must be a positive JavaScript-safe integer."
                )));
            }
        }
        let requires_side_effects = matches!(
            self.context,
            DebugEvaluateContext::Repl | DebugEvaluateContext::Clipboard
        );
        if self.allow_side_effects != requires_side_effects {
            return Err(DebugEvaluateFailure {
                kind: DebugEvaluateErrorKind::SideEffect,
                message: "REPL and Clipboard evaluation must allow side effects; Watch evaluation must disable them."
                    .to_string(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub(crate) enum DebugEvaluateResponse {
    Ok {
        value: DebugVariableInfo,
    },
    Error {
        kind: DebugEvaluateErrorKind,
        message: String,
    },
}

pub(super) fn validate_evaluate_text(
    value: &str,
    maximum_bytes: usize,
    allow_tab: bool,
    label: &str,
) -> Result<(), DebugEvaluateFailure> {
    if value.is_empty() || value.len() > maximum_bytes {
        return Err(DebugEvaluateFailure::unsupported(format!(
            "{label} must contain 1 to {maximum_bytes} UTF-8 bytes."
        )));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !(allow_tab && character == '\t'))
    {
        return Err(DebugEvaluateFailure::unsupported(format!(
            "{label} contains a forbidden control character."
        )));
    }
    Ok(())
}

pub(super) fn bounded_value(value: DebugVariableInfo) -> DebugEvaluateResponse {
    let valid_type = value.value_type.as_ref().is_none_or(|value_type| {
        !value_type.is_empty()
            && value_type.len() <= MAX_DEBUG_EVALUATE_TYPE_BYTES
            && !value_type.chars().any(char::is_control)
    });
    if value.name.len() > MAX_DEBUG_EVALUATE_EXPRESSION_BYTES
        || value.value.len() > MAX_DEBUG_EVALUATE_VALUE_BYTES
        || value.variables_reference > MAX_JAVASCRIPT_SAFE_INTEGER
        || !valid_type
        || !valid_optional_evaluate_name(value.evaluate_name.as_deref())
    {
        return failure(DebugEvaluateFailure::unsupported(
            "The debug adapter returned an out-of-bounds evaluation value.",
        ));
    }
    DebugEvaluateResponse::Ok { value }
}

pub(super) fn valid_optional_evaluate_name(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        !value.trim().is_empty()
            && value.len() <= MAX_DEBUG_EVALUATE_EXPRESSION_BYTES
            && !value.chars().any(char::is_control)
    })
}

pub(super) fn failure(failure: DebugEvaluateFailure) -> DebugEvaluateResponse {
    let mut message: String = failure
        .message
        .chars()
        .map(|character| {
            if character.is_control() && character != '\t' {
                ' '
            } else {
                character
            }
        })
        .collect();
    while message.len() > MAX_DEBUG_EVALUATE_MESSAGE_BYTES {
        message.pop();
    }
    if message.is_empty() {
        message = "Debug evaluation failed.".to_string();
    }
    DebugEvaluateResponse::Error {
        kind: failure.kind,
        message,
    }
}
