use super::{
    LanguageServerRuntimeStatus, JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
    JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT, JAVASCRIPT_TYPESCRIPT_STATUS_EVENT,
    JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT, PHP_DIAGNOSTICS_EVENT, PHP_REFRESH_EVENT,
    PHP_STATUS_EVENT, PHP_WORKSPACE_EDIT_EVENT,
};
use crate::{
    lsp_diagnostics::LanguageServerDiagnosticEvent, lsp_features::LanguageServerWorkspaceEdit,
    lsp_incremental_document::DocumentChangeAdmissionRegistry,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub trait StatusSink: Send + Sync {
    fn begin_document_session_replacement(&self) -> Result<(), String> {
        Ok(())
    }

    fn begin_exact_session_transition(&self, _session_id: u64) -> Result<(), String> {
        Ok(())
    }

    fn emit_status(&self, status: LanguageServerRuntimeStatus);
}

pub trait DiagnosticsSink: Send + Sync {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent);
}

pub trait RefreshSink: Send + Sync {
    fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool;
}

pub trait WorkspaceEditSink: Send + Sync {
    fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool;
}

pub struct AppHandleEventSink {
    app: tauri::AppHandle,
    diagnostics_event: &'static str,
    document_admission_root: Option<String>,
    refresh_event: &'static str,
    root_path: String,
    status_event: &'static str,
    workspace_edit_event: &'static str,
}

impl AppHandleEventSink {
    pub fn for_workspace(app: tauri::AppHandle, root_path: String) -> Self {
        Self::new_with_events_and_root(
            app,
            PHP_STATUS_EVENT,
            PHP_DIAGNOSTICS_EVENT,
            PHP_REFRESH_EVENT,
            PHP_WORKSPACE_EDIT_EVENT,
            root_path,
            None,
        )
    }

    pub fn javascript_typescript_for_workspace(
        app: tauri::AppHandle,
        root_path: String,
    ) -> Result<Self, String> {
        let document_admission_root = crate::canonicalize_workspace_root(&root_path)?
            .to_string_lossy()
            .into_owned();
        Ok(Self::new_with_events_and_root(
            app,
            JAVASCRIPT_TYPESCRIPT_STATUS_EVENT,
            JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
            JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
            JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
            root_path,
            Some(document_admission_root),
        ))
    }

    fn new_with_events_and_root(
        app: tauri::AppHandle,
        status_event: &'static str,
        diagnostics_event: &'static str,
        refresh_event: &'static str,
        workspace_edit_event: &'static str,
        root_path: String,
        document_admission_root: Option<String>,
    ) -> Self {
        Self {
            app,
            diagnostics_event,
            document_admission_root,
            refresh_event,
            root_path,
            status_event,
            workspace_edit_event,
        }
    }
}

impl StatusSink for AppHandleEventSink {
    fn begin_document_session_replacement(&self) -> Result<(), String> {
        let Some(root_path) = &self.document_admission_root else {
            return Ok(());
        };
        use tauri::Manager;
        self.app
            .state::<DocumentChangeAdmissionRegistry>()
            .purge_root(root_path)
    }

    fn begin_exact_session_transition(&self, session_id: u64) -> Result<(), String> {
        let Some(root_path) = &self.document_admission_root else {
            return Ok(());
        };
        use tauri::Manager;
        self.app
            .state::<DocumentChangeAdmissionRegistry>()
            .begin_exact_session_transition(root_path, session_id)
    }

    fn emit_status(&self, status: LanguageServerRuntimeStatus) {
        use tauri::Emitter;
        let _ = self.app.emit(
            self.status_event,
            status_event_payload(&self.root_path, status),
        );
    }
}

impl DiagnosticsSink for AppHandleEventSink {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent) {
        use tauri::Emitter;
        let _ = self.app.emit(
            self.diagnostics_event,
            diagnostics_event_payload(&self.root_path, &event),
        );
    }
}

impl RefreshSink for AppHandleEventSink {
    fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool {
        use tauri::Emitter;
        self.app
            .emit(
                self.refresh_event,
                refresh_event_payload(&self.root_path, event),
            )
            .is_ok()
    }
}

impl WorkspaceEditSink for AppHandleEventSink {
    fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool {
        use tauri::Emitter;
        self.app
            .emit(
                self.workspace_edit_event,
                workspace_edit_event_payload(&self.root_path, event),
            )
            .is_ok()
    }
}

pub(crate) fn language_server_status_payload(
    root_path: &str,
    status: LanguageServerRuntimeStatus,
) -> Value {
    with_root_path(root_path, status)
}

pub(super) fn status_event_payload(root_path: &str, status: LanguageServerRuntimeStatus) -> Value {
    language_server_status_payload(root_path, status)
}

fn with_root_path(root_path: &str, value: impl Serialize) -> Value {
    let mut value = serde_json::to_value(value).unwrap_or(Value::Null);
    if let Value::Object(object) = &mut value {
        object.insert("rootPath".to_string(), json!(root_path));
    }
    value
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageServerDiagnosticsEventPayload<'a> {
    root_path: &'a str,
    #[serde(flatten)]
    event: &'a LanguageServerDiagnosticEvent,
}

pub(super) fn diagnostics_event_payload<'a>(
    root_path: &'a str,
    event: &'a LanguageServerDiagnosticEvent,
) -> LanguageServerDiagnosticsEventPayload<'a> {
    LanguageServerDiagnosticsEventPayload { root_path, event }
}

pub(super) fn refresh_event_payload(root_path: &str, event: LanguageServerRefreshEvent) -> Value {
    with_root_path(root_path, event)
}

pub(super) fn workspace_edit_event_payload(
    root_path: &str,
    event: LanguageServerWorkspaceEditEvent,
) -> Value {
    with_root_path(root_path, event)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerRefreshFeature {
    CodeLens,
    InlayHint,
    SemanticTokens,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerRefreshEvent {
    pub session_id: u64,
    pub feature: LanguageServerRefreshFeature,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerWorkspaceEditEvent {
    pub session_id: u64,
    pub label: Option<String>,
    pub edit: LanguageServerWorkspaceEdit,
}

#[derive(Clone)]
pub(crate) struct LanguageServerEventSinks {
    pub(super) status: Arc<dyn StatusSink>,
    pub(super) diagnostics: Arc<dyn DiagnosticsSink>,
    pub(super) workspace_edit: Arc<dyn WorkspaceEditSink>,
    pub(super) refresh: Arc<dyn RefreshSink>,
}

impl LanguageServerEventSinks {
    pub(crate) fn new(
        status: Arc<dyn StatusSink>,
        diagnostics: Arc<dyn DiagnosticsSink>,
        workspace_edit: Arc<dyn WorkspaceEditSink>,
        refresh: Arc<dyn RefreshSink>,
    ) -> Self {
        Self {
            status,
            diagnostics,
            workspace_edit,
            refresh,
        }
    }
}

#[cfg(test)]
pub(super) struct NoopWorkspaceEditSink;

#[cfg(test)]
impl WorkspaceEditSink for NoopWorkspaceEditSink {
    fn emit_workspace_edit(&self, _event: LanguageServerWorkspaceEditEvent) -> bool {
        false
    }
}

#[cfg(test)]
pub(super) struct NoopRefreshSink;

#[cfg(test)]
impl RefreshSink for NoopRefreshSink {
    fn emit_refresh(&self, _event: LanguageServerRefreshEvent) -> bool {
        false
    }
}
