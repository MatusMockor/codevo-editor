use crate::debug_adapter::DebugSetExpressionRequest as AdapterRequest;
use serde::Deserialize;

use super::{
    validate_evaluate_text, MAX_DEBUG_EVALUATE_EXPRESSION_BYTES, MAX_DEBUG_EVALUATE_ROOT_BYTES,
    MAX_DEBUG_EVALUATE_VALUE_BYTES, MAX_JAVASCRIPT_SAFE_INTEGER,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetExpressionRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
    pub(crate) set_expression_reference: u64,
    pub(crate) expression: String,
    pub(crate) value: String,
}

impl DebugSetExpressionRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        validate_evaluate_text(
            &self.root_path,
            MAX_DEBUG_EVALUATE_ROOT_BYTES,
            false,
            "Debug workspace root",
        )
        .map_err(|failure| failure.message)?;
        validate_evaluate_text(
            &self.expression,
            MAX_DEBUG_EVALUATE_EXPRESSION_BYTES,
            false,
            "Debug set-expression target",
        )
        .map_err(|failure| failure.message)?;
        validate_set_expression_value(&self.value)?;
        for (value, label) in [
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
            (self.set_expression_reference, "set-expression reference"),
        ] {
            if value == 0 || value > MAX_JAVASCRIPT_SAFE_INTEGER {
                return Err(format!(
                    "Debug {label} must be a positive JavaScript-safe integer."
                ));
            }
        }
        Ok(())
    }

    pub(super) fn adapter_request(&self) -> AdapterRequest {
        AdapterRequest {
            pause_generation: self.pause_generation,
            frame_id: self.frame_id,
            set_expression_reference: self.set_expression_reference,
            expression: self.expression.clone(),
            value: self.value.clone(),
        }
    }
}

fn validate_set_expression_value(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_DEBUG_EVALUATE_VALUE_BYTES {
        return Err(format!(
            "Debug set-expression value must contain 1 to {MAX_DEBUG_EVALUATE_VALUE_BYTES} UTF-8 bytes."
        ));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
    {
        return Err(
            "Debug set-expression value contains a forbidden control character.".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid() -> serde_json::Value {
        json!({
            "rootPath": "/workspace",
            "sessionId": 1,
            "pauseGeneration": 2,
            "frameId": 3,
            "setExpressionReference": 4,
            "expression": "count",
            "value": "nextValue()"
        })
    }

    #[test]
    fn wire_is_closed_bounded_and_safe_integer_owned() {
        let request: DebugSetExpressionRequest = serde_json::from_value(valid()).expect("wire");
        request.validate().expect("valid request");
        let mut unknown = valid();
        unknown["extra"] = json!(true);
        assert!(serde_json::from_value::<DebugSetExpressionRequest>(unknown).is_err());
        for key in [
            "sessionId",
            "pauseGeneration",
            "frameId",
            "setExpressionReference",
        ] {
            let mut invalid = valid();
            invalid[key] = json!(0);
            let request: DebugSetExpressionRequest =
                serde_json::from_value(invalid).expect("wire shape");
            assert!(request.validate().is_err());
        }
    }

    #[test]
    fn rhs_matches_set_variable_multiline_and_control_character_policy() {
        for value in [
            "next\tValue()",
            "({\nvalue: 1 // comment\n})",
            "first\r\nsecond",
        ] {
            let mut request = valid();
            request["value"] = json!(value);
            serde_json::from_value::<DebugSetExpressionRequest>(request)
                .expect("wire shape")
                .validate()
                .expect("tab and line endings are valid RHS text");
        }
        for value in ["bad\0value", "bad\u{000b}value", "bad\u{001f}value"] {
            let mut request = valid();
            request["value"] = json!(value);
            let request: DebugSetExpressionRequest =
                serde_json::from_value(request).expect("wire shape");
            assert!(request.validate().is_err());
        }
    }
}
