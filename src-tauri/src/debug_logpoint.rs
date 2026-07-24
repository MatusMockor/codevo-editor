use serde_json::Value;

pub(crate) const MAX_DEBUG_LOG_MESSAGE_BYTES: usize = 4_096;
pub(crate) const MAX_DEBUG_LOG_EXPRESSIONS: usize = 32;
pub(crate) const MAX_DEBUG_LOGPOINTS_PER_PAUSE: usize = 32;
pub(crate) const MAX_DEBUG_LOG_EXPRESSION_BYTES: usize = 1_024;
pub(crate) const MAX_DEBUG_LOG_OUTPUT_BYTES: usize = 16 * 1_024;
pub(crate) const PHP_LOGPOINT_UNSUPPORTED_ERROR: &str =
    "Logpoints are only available for Node.js breakpoints.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DebugLogSegment {
    Literal(String),
    Expression(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DebugLogTemplate {
    pub(crate) segments: Vec<DebugLogSegment>,
}

pub(crate) fn parse_debug_log_template(message: &str) -> Result<DebugLogTemplate, String> {
    if message.trim().is_empty() {
        return Err("Logpoint message must not be empty.".into());
    }
    if message.contains('\0') {
        return Err("Logpoint message must not contain a NUL character.".into());
    }
    if message.len() > MAX_DEBUG_LOG_MESSAGE_BYTES {
        return Err(format!(
            "Logpoint message must be at most {MAX_DEBUG_LOG_MESSAGE_BYTES} UTF-8 bytes."
        ));
    }

    let mut segments = Vec::new();
    let mut literal = String::new();
    let mut characters = message.char_indices().peekable();
    let mut expression_count = 0usize;
    while let Some((_, character)) = characters.next() {
        match character {
            '{' if characters.peek().is_some_and(|(_, next)| *next == '{') => {
                characters.next();
                literal.push('{');
            }
            '}' if characters.peek().is_some_and(|(_, next)| *next == '}') => {
                characters.next();
                literal.push('}');
            }
            '{' => {
                if !literal.is_empty() {
                    segments.push(DebugLogSegment::Literal(std::mem::take(&mut literal)));
                }
                let mut expression = String::new();
                let mut closed = false;
                for (_, next) in characters.by_ref() {
                    if next == '}' {
                        closed = true;
                        break;
                    }
                    if next == '{' {
                        return Err("Logpoint expressions cannot contain braces.".into());
                    }
                    expression.push(next);
                }
                if !closed {
                    return Err("Logpoint message contains an unmatched opening brace.".into());
                }
                let expression = expression.trim();
                if expression.is_empty() {
                    return Err("Logpoint expressions must not be empty.".into());
                }
                if expression.len() > MAX_DEBUG_LOG_EXPRESSION_BYTES {
                    return Err(format!(
                        "Logpoint expressions must be at most {MAX_DEBUG_LOG_EXPRESSION_BYTES} UTF-8 bytes."
                    ));
                }
                expression_count += 1;
                if expression_count > MAX_DEBUG_LOG_EXPRESSIONS {
                    return Err(format!(
                        "Logpoint messages may contain at most {MAX_DEBUG_LOG_EXPRESSIONS} expressions."
                    ));
                }
                segments.push(DebugLogSegment::Expression(expression.to_string()));
            }
            '}' => return Err("Logpoint message contains an unmatched closing brace.".into()),
            other => literal.push(other),
        }
    }
    if !literal.is_empty() {
        segments.push(DebugLogSegment::Literal(literal));
    }
    Ok(DebugLogTemplate { segments })
}

pub(crate) fn render_remote_object(response: &Value) -> Result<String, String> {
    if response.get("exceptionDetails").is_some() {
        return Err("Logpoint expression threw an exception.".into());
    }
    let object = response
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| "Logpoint evaluation returned an invalid CDP result.".to_string())?;
    if let Some(value) = object.get("unserializableValue").and_then(Value::as_str) {
        return Ok(value.to_string());
    }
    if object.get("subtype").and_then(Value::as_str) == Some("null") {
        return Ok("null".into());
    }
    if let Some(value) = object.get("value") {
        return match value {
            Value::String(value) => Ok(value.clone()),
            other => Ok(other.to_string()),
        };
    }
    match object.get("type").and_then(Value::as_str) {
        Some("undefined") => Ok("undefined".into()),
        _ => object
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Logpoint evaluation result cannot be rendered.".to_string()),
    }
}

pub(crate) fn append_bounded_log_output(target: &mut String, value: &str) {
    const MARKER: &str = "…[truncated]";
    if target.len() >= MAX_DEBUG_LOG_OUTPUT_BYTES {
        return;
    }
    let available = MAX_DEBUG_LOG_OUTPUT_BYTES - target.len();
    if value.len() <= available {
        target.push_str(value);
        return;
    }
    let content_bytes = available.saturating_sub(MARKER.len());
    let mut boundary = content_bytes.min(value.len());
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    target.push_str(&value[..boundary]);
    if MARKER.len() <= MAX_DEBUG_LOG_OUTPUT_BYTES - target.len() {
        target.push_str(MARKER);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parser_is_bounded_and_supports_escaped_braces() {
        assert_eq!(
            parse_debug_log_template("count={{ { count } }}")
                .unwrap()
                .segments,
            vec![
                DebugLogSegment::Literal("count={ ".into()),
                DebugLogSegment::Expression("count".into()),
                DebugLogSegment::Literal(" }".into()),
            ]
        );
        for invalid in ["", "   ", "{", "}", "{}", "{a{b}}", "hello\0world"] {
            assert!(parse_debug_log_template(invalid).is_err(), "{invalid:?}");
        }
        assert!(parse_debug_log_template(&"x".repeat(MAX_DEBUG_LOG_MESSAGE_BYTES + 1)).is_err());
        assert!(parse_debug_log_template(&format!(
            "{{{}}}",
            "x".repeat(MAX_DEBUG_LOG_EXPRESSION_BYTES + 1)
        ))
        .is_err());
        assert!(parse_debug_log_template(&"{x}".repeat(MAX_DEBUG_LOG_EXPRESSIONS + 1)).is_err());
    }

    #[test]
    fn parser_unicode_whitespace_matches_frontend_edge_fixtures() {
        for whitespace_only in ["\u{0085}", "{\u{0085}}"] {
            assert!(parse_debug_log_template(whitespace_only).is_err());
        }
        assert_eq!(
            parse_debug_log_template("\u{feff}").unwrap().segments,
            vec![DebugLogSegment::Literal("\u{feff}".into())]
        );
        assert_eq!(
            parse_debug_log_template("{\u{feff}}").unwrap().segments,
            vec![DebugLogSegment::Expression("\u{feff}".into())]
        );
    }

    #[test]
    fn remote_values_render_without_recursive_property_fetches() {
        for (value, expected) in [
            (json!({"result":{"type":"undefined"}}), "undefined"),
            (
                json!({"result":{"type":"object","subtype":"null","value":null}}),
                "null",
            ),
            (
                json!({"result":{"type":"bigint","unserializableValue":"42n"}}),
                "42n",
            ),
            (json!({"result":{"type":"string","value":"ready"}}), "ready"),
            (
                json!({"result":{"type":"object","description":"User"}}),
                "User",
            ),
        ] {
            assert_eq!(render_remote_object(&value).unwrap(), expected);
        }
        assert!(render_remote_object(&json!({"exceptionDetails":{},"result":{}})).is_err());
    }

    #[test]
    fn output_truncation_is_utf8_safe_and_bounded() {
        let mut output = "x".repeat(MAX_DEBUG_LOG_OUTPUT_BYTES - 20);
        append_bounded_log_output(&mut output, &"ž".repeat(100));
        assert!(output.len() <= MAX_DEBUG_LOG_OUTPUT_BYTES);
        assert!(output.ends_with("…[truncated]"));
    }
}
