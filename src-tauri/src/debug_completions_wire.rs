use crate::debug_adapter::{
    DebugCompletionQuery as AdapterQuery, DebugCompletionRequest as AdapterRequest,
    DebugCompletionRoot as AdapterRoot,
};
use serde::{Deserialize, Serialize};

use super::{MAX_DEBUG_EVALUATE_ROOT_BYTES, MAX_JAVASCRIPT_SAFE_INTEGER};

const MAX_COMPLETION_QUERY_BYTES: usize = 4_096;
const MAX_COMPLETION_TEXT_BYTES: usize = 1_024;
const MAX_COMPLETION_PATH_SEGMENTS: usize = 8;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugCompletionsRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
    pub(crate) query: DebugCompletionsQuery,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum DebugCompletionsQuery {
    Lexical {
        prefix: String,
    },
    Member {
        root: DebugCompletionsRoot,
        path: Vec<String>,
        prefix: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum DebugCompletionsRoot {
    Binding { name: String },
    This,
}

impl DebugCompletionsRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        super::validate_evaluate_text(
            &self.root_path,
            MAX_DEBUG_EVALUATE_ROOT_BYTES,
            false,
            "Debug workspace root",
        )
        .map_err(|failure| failure.message)?;
        for (value, label) in [
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
        ] {
            if value == 0 || value > MAX_JAVASCRIPT_SAFE_INTEGER {
                return Err(format!(
                    "Debug completion {label} must be a positive JavaScript-safe integer."
                ));
            }
        }
        let encoded = serde_json::to_vec(&self.query)
            .map_err(|_| "Unable to encode the debug completion query.".to_string())?;
        if encoded.len() > MAX_COMPLETION_QUERY_BYTES {
            return Err(format!(
                "Debug completion query may contain at most {MAX_COMPLETION_QUERY_BYTES} UTF-8 bytes."
            ));
        }
        match &self.query {
            DebugCompletionsQuery::Lexical { prefix } => validate_prefix(prefix),
            DebugCompletionsQuery::Member { root, path, prefix } => {
                validate_prefix(prefix)?;
                if path.len() > MAX_COMPLETION_PATH_SEGMENTS {
                    return Err("Debug completion paths may contain at most 8 segments.".into());
                }
                for segment in path {
                    validate_property_name(segment)?;
                }
                if let DebugCompletionsRoot::Binding { name } = root {
                    if name.is_empty()
                        || name.len() > MAX_COMPLETION_TEXT_BYTES
                        || name.chars().any(char::is_control)
                    {
                        return Err("Debug completion binding root is invalid.".into());
                    }
                }
                Ok(())
            }
        }
    }

    pub(super) fn adapter_request(&self) -> AdapterRequest {
        AdapterRequest {
            pause_generation: self.pause_generation,
            frame_id: self.frame_id,
            query: match &self.query {
                DebugCompletionsQuery::Lexical { prefix } => AdapterQuery::Lexical {
                    prefix: prefix.clone(),
                },
                DebugCompletionsQuery::Member { root, path, prefix } => AdapterQuery::Member {
                    root: match root {
                        DebugCompletionsRoot::Binding { name } => {
                            AdapterRoot::Binding(name.clone())
                        }
                        DebugCompletionsRoot::This => AdapterRoot::This,
                    },
                    path: path.clone(),
                    prefix: prefix.clone(),
                },
            },
        }
    }
}

fn validate_prefix(prefix: &str) -> Result<(), String> {
    if prefix.len() > MAX_COMPLETION_TEXT_BYTES || prefix.chars().any(char::is_control) {
        return Err(format!(
            "Debug completion prefixes may contain at most {MAX_COMPLETION_TEXT_BYTES} UTF-8 bytes and no control characters."
        ));
    }
    Ok(())
}

fn validate_property_name(name: &str) -> Result<(), String> {
    if name.len() > MAX_COMPLETION_QUERY_BYTES || name.chars().any(char::is_control) {
        return Err(format!(
            "Debug completion property names may contain at most {MAX_COMPLETION_QUERY_BYTES} UTF-8 bytes and no control characters."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid() -> serde_json::Value {
        json!({
            "rootPath":"/workspace",
            "sessionId":1,
            "pauseGeneration":2,
            "frameId":3,
            "query":{
                "kind":"member",
                "root":{"kind":"binding","name":"repository"},
                "path":["current", ""],
                "prefix":"fi"
            }
        })
    }

    #[test]
    fn exact_structured_wire_accepts_no_expression_text_or_unknown_fields() {
        serde_json::from_value::<DebugCompletionsRequest>(valid())
            .expect("wire")
            .validate()
            .expect("valid request");
        let mut unknown = valid();
        unknown["query"]["expression"] = json!("runArbitraryCode()");
        assert!(serde_json::from_value::<DebugCompletionsRequest>(unknown).is_err());
        let mut empty_root = valid();
        empty_root["query"]["root"] = json!({"kind":"binding","name":""});
        assert!(
            serde_json::from_value::<DebugCompletionsRequest>(empty_root)
                .expect("shape")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn wire_enforces_safe_integer_depth_utf8_and_control_bounds() {
        for key in ["sessionId", "pauseGeneration", "frameId"] {
            let mut value = valid();
            value[key] = json!(0);
            assert!(serde_json::from_value::<DebugCompletionsRequest>(value)
                .expect("shape")
                .validate()
                .is_err());
        }
        let mut deep = valid();
        deep["query"]["path"] = json!(vec!["x"; 9]);
        assert!(serde_json::from_value::<DebugCompletionsRequest>(deep)
            .expect("shape")
            .validate()
            .is_err());
        let mut oversized = valid();
        oversized["query"]["prefix"] = json!("é".repeat(513));
        assert!(serde_json::from_value::<DebugCompletionsRequest>(oversized)
            .expect("shape")
            .validate()
            .is_err());
    }

    #[test]
    fn structured_wire_does_not_reinterpret_ecmascript_unicode_identifiers() {
        let mut other_id_start = valid();
        other_id_start["query"]["root"]["name"] = json!("\u{2118}oot");
        other_id_start["query"]["prefix"] = json!("\u{2118}");
        serde_json::from_value::<DebugCompletionsRequest>(other_id_start)
            .expect("wire shape")
            .validate()
            .expect("Other_ID_Start is already validated by the structured-query parser");
    }
}
