use crate::file_watcher::{
    CommandWatchmanAvailability, NativeNotifyWorkspaceFileWatcher, PreferredWorkspaceFileWatcher,
    WatchmanWorkspaceFileWatcher, WorkspaceFileWatcher, WorkspaceWatchError, WorkspaceWatchEvent,
    WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchFileKind,
    WorkspaceWatchRequest, WorkspaceWatchSession,
};
use crate::lsp::JsonRpcNotification;
use crate::lsp_features::{
    LspTextDocumentFeatureRequestFactory, TextDocumentFeatureRequestFactory, WorkspaceFileChange,
    WorkspaceFileChangeType,
};
use crate::lsp_session::JavaScriptTypeScriptLanguageServerRegistry;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};

pub struct JavaScriptTypeScriptWorkspaceWatchRegistry {
    sessions: Mutex<HashMap<String, Box<dyn WorkspaceWatchSession>>>,
}

impl JavaScriptTypeScriptWorkspaceWatchRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self, root_path: &str, app: AppHandle) -> Result<(), String> {
        let root = PathBuf::from(root_path)
            .canonicalize()
            .map_err(|error| format!("Failed to watch JavaScript/TypeScript workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;

        if sessions.contains_key(&root_key) {
            return Ok(());
        }

        let watcher = PreferredWorkspaceFileWatcher::new(
            WatchmanWorkspaceFileWatcher,
            NativeNotifyWorkspaceFileWatcher,
            CommandWatchmanAvailability,
        );
        let sink = Arc::new(JavaScriptTypeScriptWorkspaceWatchSink {
            app,
            root_path: root_key.clone(),
        });
        let session = watcher
            .watch(WorkspaceWatchRequest::new(root), sink)
            .map_err(|error| {
                format!("Failed to start JavaScript/TypeScript workspace watcher: {error}")
            })?;

        sessions.insert(root_key, session);
        Ok(())
    }

    pub fn stop(&self, root_path: &str) {
        let root_key = workspace_watch_id(&PathBuf::from(root_path));
        let Some(mut session) = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&root_key))
        else {
            return;
        };

        session.stop();
    }

    pub fn stop_all(&self) {
        let sessions = self
            .sessions
            .lock()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(_, session)| session)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        for mut session in sessions {
            session.stop();
        }
    }
}

impl Default for JavaScriptTypeScriptWorkspaceWatchRegistry {
    fn default() -> Self {
        Self::new()
    }
}

struct JavaScriptTypeScriptWorkspaceWatchSink {
    app: AppHandle,
    root_path: String,
}

impl crate::file_watcher::WorkspaceWatchEventSink for JavaScriptTypeScriptWorkspaceWatchSink {
    fn error(&self, _error: WorkspaceWatchError) {}

    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        let changes = watched_file_changes_for_events(&batch.events);

        if changes.is_empty() {
            return;
        }

        let Some(registry) = self
            .app
            .try_state::<JavaScriptTypeScriptLanguageServerRegistry>()
        else {
            return;
        };

        let factory = LspTextDocumentFeatureRequestFactory;
        let request = factory.did_change_watched_files(&changes);
        let _ = registry.send_notification(
            &self.root_path,
            &JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: request.method,
                params: request.params,
            },
        );
    }
}

fn watched_file_changes_for_events(events: &[WorkspaceWatchEvent]) -> Vec<WorkspaceFileChange> {
    events
        .iter()
        .flat_map(watched_file_changes_for_event)
        .collect()
}

fn watched_file_changes_for_event(event: &WorkspaceWatchEvent) -> Vec<WorkspaceFileChange> {
    if event.file_kind == Some(WorkspaceWatchFileKind::Directory) {
        return Vec::new();
    }

    match event.kind {
        WorkspaceWatchEventKind::Created => {
            watched_change(&event.path, WorkspaceFileChangeType::Created)
                .into_iter()
                .collect()
        }
        WorkspaceWatchEventKind::Modified => {
            watched_change(&event.path, WorkspaceFileChangeType::Changed)
                .into_iter()
                .collect()
        }
        WorkspaceWatchEventKind::Deleted => {
            watched_change(&event.path, WorkspaceFileChangeType::Deleted)
                .into_iter()
                .collect()
        }
        WorkspaceWatchEventKind::Renamed => {
            let mut changes = Vec::new();

            if let Some(previous_path) = event.previous_path.as_deref() {
                changes.extend(watched_change(
                    previous_path,
                    WorkspaceFileChangeType::Deleted,
                ));
            }

            changes.extend(watched_change(
                &event.path,
                WorkspaceFileChangeType::Created,
            ));
            changes
        }
        WorkspaceWatchEventKind::RescanRequired => Vec::new(),
    }
}

fn watched_change(path: &str, change_type: WorkspaceFileChangeType) -> Option<WorkspaceFileChange> {
    is_javascript_typescript_watched_path(path).then(|| WorkspaceFileChange {
        path: path.to_string(),
        change_type,
    })
}

fn is_javascript_typescript_watched_path(path: &str) -> bool {
    let Some(extension) = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
    else {
        return false;
    };

    matches!(
        extension.as_str(),
        "cjs" | "cts" | "js" | "json" | "jsx" | "mjs" | "mts" | "ts" | "tsx"
    )
}

fn workspace_watch_id(root_path: &Path) -> String {
    let normalized = root_path
        .canonicalize()
        .unwrap_or_else(|_| root_path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/");

    normalized.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::watched_file_changes_for_events;
    use crate::file_watcher::{
        WorkspaceWatchBackend, WorkspaceWatchEvent, WorkspaceWatchEventKind, WorkspaceWatchFileKind,
    };
    use crate::lsp_features::WorkspaceFileChangeType;

    #[test]
    fn maps_javascript_typescript_file_events_to_lsp_changes() {
        let changes = watched_file_changes_for_events(&[
            event(WorkspaceWatchEventKind::Created, "/workspace/src/User.ts"),
            event(WorkspaceWatchEventKind::Modified, "/workspace/src/App.tsx"),
            event(WorkspaceWatchEventKind::Deleted, "/workspace/src/old.js"),
            event(WorkspaceWatchEventKind::Modified, "/workspace/package.json"),
        ]);

        assert_eq!(changes.len(), 4);
        assert_eq!(changes[0].path, "/workspace/src/User.ts");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Created);
        assert_eq!(changes[1].path, "/workspace/src/App.tsx");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Changed);
        assert_eq!(changes[2].path, "/workspace/src/old.js");
        assert_eq!(changes[2].change_type, WorkspaceFileChangeType::Deleted);
        assert_eq!(changes[3].path, "/workspace/package.json");
        assert_eq!(changes[3].change_type, WorkspaceFileChangeType::Changed);
    }

    #[test]
    fn maps_renames_to_delete_and_create_changes() {
        let mut rename = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/src/Account.ts",
        );
        rename.previous_path = Some("/workspace/src/User.ts".to_string());

        let changes = watched_file_changes_for_events(&[rename]);

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "/workspace/src/User.ts");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Deleted);
        assert_eq!(changes[1].path, "/workspace/src/Account.ts");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Created);
    }

    #[test]
    fn ignores_directories_php_files_and_rescan_events() {
        let mut directory = event(WorkspaceWatchEventKind::Created, "/workspace/src");
        directory.file_kind = Some(WorkspaceWatchFileKind::Directory);

        let changes = watched_file_changes_for_events(&[
            directory,
            event(WorkspaceWatchEventKind::Modified, "/workspace/src/User.php"),
            event(
                WorkspaceWatchEventKind::RescanRequired,
                "/workspace/src/User.ts",
            ),
        ]);

        assert!(changes.is_empty());
    }

    fn event(kind: WorkspaceWatchEventKind, path: &str) -> WorkspaceWatchEvent {
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::File),
            kind,
            path: path.to_string(),
            previous_path: None,
            previous_relative_path: None,
            relative_path: path.trim_start_matches("/workspace/").to_string(),
            root_path: "/workspace".to_string(),
        }
    }
}
