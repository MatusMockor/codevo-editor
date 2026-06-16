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
        session_id: u64,
    },
    Running {
        cols: u16,
        cwd: String,
        rows: u16,
        session_id: u64,
    },
    Stopped {
        session_id: u64,
    },
    Exited {
        exit_code: Option<u32>,
        session_id: u64,
    },
    Crashed {
        message: String,
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
