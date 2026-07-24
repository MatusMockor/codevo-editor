use crate::debug_adapter::variable_name::{
    is_valid_debug_variable_name, MAX_DEBUG_VARIABLE_NAME_BYTES,
};
use crate::debug_adapter::DebugSetVariableRequest as AdapterRequest;
use serde::Deserialize;

use super::{
    validate_evaluate_text, MAX_DEBUG_EVALUATE_EXPRESSION_BYTES, MAX_DEBUG_EVALUATE_ROOT_BYTES,
    MAX_JAVASCRIPT_SAFE_INTEGER,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetVariableRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
    pub(crate) variables_reference: u64,
    pub(crate) name: String,
    pub(crate) value: String,
}

impl DebugSetVariableRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        validate_evaluate_text(
            &self.root_path,
            MAX_DEBUG_EVALUATE_ROOT_BYTES,
            false,
            "Debug workspace root",
        )
        .map_err(|failure| failure.message)?;
        if !is_valid_debug_variable_name(&self.name) {
            return Err(format!(
                "Debug variable name must contain 1 to {MAX_DEBUG_VARIABLE_NAME_BYTES} UTF-8 bytes without control characters."
            ));
        }
        if self.value.is_empty() || self.value.len() > MAX_DEBUG_EVALUATE_EXPRESSION_BYTES {
            return Err(format!(
                "Debug variable value must contain 1 to {MAX_DEBUG_EVALUATE_EXPRESSION_BYTES} UTF-8 bytes."
            ));
        }
        if self
            .value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
        {
            return Err("Debug variable value contains a forbidden control character.".to_string());
        }
        for (value, label) in [
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
            (self.variables_reference, "variables reference"),
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
            variables_reference: self.variables_reference,
            name: self.name.clone(),
            value: self.value.clone(),
        }
    }
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
            "variablesReference": 4,
            "name": "value",
            "value": "({ nested: true })"
        })
    }

    #[test]
    fn set_variable_wire_is_exact_and_bounded() {
        let request: DebugSetVariableRequest =
            serde_json::from_value(valid()).expect("exact request");
        request.validate().expect("valid request");

        let mut unknown = valid();
        unknown["extra"] = json!(true);
        assert!(serde_json::from_value::<DebugSetVariableRequest>(unknown).is_err());

        for key in [
            "sessionId",
            "pauseGeneration",
            "frameId",
            "variablesReference",
        ] {
            let mut invalid = valid();
            invalid[key] = json!(0);
            let request: DebugSetVariableRequest =
                serde_json::from_value(invalid).expect("wire shape");
            assert!(request.validate().is_err());
        }
        let mut multiline = valid();
        multiline["value"] = json!("({\nvalue: 1 // comment\n})");
        serde_json::from_value::<DebugSetVariableRequest>(multiline)
            .expect("multiline wire")
            .validate()
            .expect("multiline value");
    }
}
