use serde::{Deserialize, Serialize};

pub const TERMINAL_OUTPUT_EVENT: &str = "terminal://output";
pub const TERMINAL_STATUS_EVENT: &str = "terminal://status";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSize {
    pub fn normalized(self) -> Self {
        Self {
            cols: self.cols.max(1),
            rows: self.rows.max(1),
        }
    }
}

impl Default for TerminalSize {
    fn default() -> Self {
        Self { cols: 80, rows: 24 }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalRuntimeStatus {
    Starting {
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Running {
        cols: u16,
        cwd: String,
        rows: u16,
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Stopped {
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Exited {
        #[serde(rename = "exitCode")]
        exit_code: Option<u32>,
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Crashed {
        message: String,
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub data: String,
    pub session_id: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    pub command: Option<String>,
    pub id: String,
    pub label: String,
}

pub trait TerminalEventSink: Send + Sync {
    fn emit_output(&self, event: TerminalOutputEvent);
    fn emit_status(&self, status: TerminalRuntimeStatus);
}

pub struct AppHandleTerminalEventSink {
    app: tauri::AppHandle,
}

impl AppHandleTerminalEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl TerminalEventSink for AppHandleTerminalEventSink {
    fn emit_output(&self, event: TerminalOutputEvent) {
        use tauri::Emitter;

        let _ = self.app.emit(TERMINAL_OUTPUT_EVENT, event);
    }

    fn emit_status(&self, status: TerminalRuntimeStatus) {
        use tauri::Emitter;

        let _ = self.app.emit(TERMINAL_STATUS_EVENT, status);
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalRuntimeStatus;
    use serde_json::json;

    #[test]
    fn runtime_status_serializes_frontend_session_fields() {
        assert_eq!(
            serde_json::to_value(TerminalRuntimeStatus::Running {
                cols: 80,
                cwd: "/workspace".to_string(),
                rows: 24,
                session_id: 1,
            })
            .expect("terminal status should serialize"),
            json!({
                "cols": 80,
                "cwd": "/workspace",
                "kind": "running",
                "rows": 24,
                "sessionId": 1,
            }),
        );
        assert_eq!(
            serde_json::to_value(TerminalRuntimeStatus::Exited {
                exit_code: Some(7),
                session_id: 2,
            })
            .expect("terminal status should serialize"),
            json!({
                "exitCode": 7,
                "kind": "exited",
                "sessionId": 2,
            }),
        );
        assert_eq!(
            serde_json::to_value(TerminalRuntimeStatus::Starting { session_id: 3 })
                .expect("terminal status should serialize"),
            json!({
                "kind": "starting",
                "sessionId": 3,
            }),
        );
    }
}
