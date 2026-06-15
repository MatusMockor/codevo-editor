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
    pub message: String,
    pub severity: LanguageServerDiagnosticSeverity,
    pub source: Option<String>,
    pub line: u64,
    pub character: u64,
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
    let start = value
        .get("range")
        .and_then(|range| range.get("start"))
        .unwrap_or(&Value::Null);

    LanguageServerDiagnostic {
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
        line: start.get("line").and_then(Value::as_u64).unwrap_or(0),
        character: start.get("character").and_then(Value::as_u64).unwrap_or(0),
    }
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
    use super::{parse_publish_diagnostics, LanguageServerDiagnosticSeverity};
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
                            "source": "phpactor",
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
        assert_eq!(event.diagnostics[0].line, 2);
        assert_eq!(event.diagnostics[0].character, 4);
        assert_eq!(event.diagnostics[0].message, "Unexpected token");
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
