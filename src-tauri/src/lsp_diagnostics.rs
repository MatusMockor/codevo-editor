use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnosticEvent {
    pub session_id: u64,
    pub uri: String,
    pub version: Option<i64>,
    pub diagnostics: Vec<LanguageServerDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnostic {
    pub code: Option<LanguageServerDiagnosticCode>,
    pub message: String,
    pub severity: LanguageServerDiagnosticSeverity,
    pub source: Option<String>,
    pub tags: Vec<u64>,
    pub line: u64,
    pub character: u64,
    pub end_line: u64,
    pub end_character: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LanguageServerDiagnosticCode {
    Number(i64),
    String(String),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerDiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

pub fn parse_publish_diagnostics(
    value: &Value,
    session_id: u64,
) -> Option<LanguageServerDiagnosticEvent> {
    if value.get("method").and_then(Value::as_str) != Some("textDocument/publishDiagnostics") {
        return None;
    }

    let params = value.get("params")?;
    let uri = params.get("uri").and_then(Value::as_str)?.to_string();
    let version = params.get("version").and_then(Value::as_i64);
    let diagnostics = params
        .get("diagnostics")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_diagnostic).collect())
        .unwrap_or_default();

    Some(LanguageServerDiagnosticEvent {
        session_id,
        uri,
        version,
        diagnostics,
    })
}

fn parse_diagnostic(value: &Value) -> LanguageServerDiagnostic {
    let range = value.get("range").unwrap_or(&Value::Null);
    let (line, character) = parse_position(range.get("start")).unwrap_or((0, 0));
    let (end_line, end_character) =
        parse_position(range.get("end")).unwrap_or((line, character.saturating_add(1)));

    LanguageServerDiagnostic {
        code: parse_code(value.get("code")),
        message: value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Language server diagnostic.")
            .to_string(),
        severity: parse_severity(value.get("severity").and_then(Value::as_u64)),
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string),
        tags: parse_tags(value.get("tags")),
        line,
        character,
        end_line,
        end_character,
    }
}

fn parse_position(value: Option<&Value>) -> Option<(u64, u64)> {
    let value = value?;

    Some((
        value.get("line").and_then(Value::as_u64)?,
        value.get("character").and_then(Value::as_u64)?,
    ))
}

fn parse_tags(value: Option<&Value>) -> Vec<u64> {
    value
        .and_then(Value::as_array)
        .map(|tags| {
            tags.iter()
                .filter_map(Value::as_u64)
                .filter(|tag| *tag == 1 || *tag == 2)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_code(value: Option<&Value>) -> Option<LanguageServerDiagnosticCode> {
    let value = value?;

    if let Some(code) = value.as_i64() {
        return Some(LanguageServerDiagnosticCode::Number(code));
    }

    value
        .as_str()
        .map(str::to_string)
        .map(LanguageServerDiagnosticCode::String)
}

fn parse_severity(value: Option<u64>) -> LanguageServerDiagnosticSeverity {
    if value == Some(1) {
        return LanguageServerDiagnosticSeverity::Error;
    }

    if value == Some(2) {
        return LanguageServerDiagnosticSeverity::Warning;
    }

    if value == Some(4) {
        return LanguageServerDiagnosticSeverity::Hint;
    }

    LanguageServerDiagnosticSeverity::Information
}

#[cfg(test)]
mod tests {
    use super::{
        parse_publish_diagnostics, LanguageServerDiagnosticCode, LanguageServerDiagnosticSeverity,
    };
    use serde_json::json;

    #[test]
    fn parses_publish_diagnostics_notification() {
        let event = parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.php",
                    "version": 7,
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 2, "character": 4 },
                                "end": { "line": 2, "character": 8 }
                            },
                            "severity": 1,
                            "code": "worse.docblock_missing_param",
                            "source": "phpactor",
                            "tags": [1, 2, 99, "bad"],
                            "message": "Unexpected token",
                        }
                    ]
                }
            }),
            42,
        )
        .expect("diagnostics event");

        assert_eq!(event.session_id, 42);
        assert_eq!(event.uri, "file:///tmp/User.php");
        assert_eq!(event.version, Some(7));
        assert_eq!(
            event.diagnostics[0].severity,
            LanguageServerDiagnosticSeverity::Error
        );
        assert_eq!(
            event.diagnostics[0].code,
            Some(LanguageServerDiagnosticCode::String(
                "worse.docblock_missing_param".to_string()
            ))
        );
        assert_eq!(event.diagnostics[0].line, 2);
        assert_eq!(event.diagnostics[0].character, 4);
        assert_eq!(event.diagnostics[0].end_line, 2);
        assert_eq!(event.diagnostics[0].end_character, 8);
        assert_eq!(event.diagnostics[0].tags, vec![1, 2]);
        assert_eq!(event.diagnostics[0].message, "Unexpected token");
    }

    #[test]
    fn falls_back_to_one_character_range_when_end_position_is_malformed() {
        let event = parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.ts",
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 3, "character": 12 },
                                "end": { "line": 3 }
                            },
                            "message": "Unexpected token",
                        }
                    ]
                }
            }),
            42,
        )
        .expect("diagnostics event");

        assert_eq!(event.diagnostics[0].line, 3);
        assert_eq!(event.diagnostics[0].character, 12);
        assert_eq!(event.diagnostics[0].end_line, 3);
        assert_eq!(event.diagnostics[0].end_character, 13);
    }

    #[test]
    fn ignores_other_messages() {
        assert!(parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "window/logMessage"
            }),
            1
        )
        .is_none());
    }
}
