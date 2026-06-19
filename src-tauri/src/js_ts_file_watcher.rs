use crate::file_watcher::{
    CommandWatchmanAvailability, NativeNotifyWorkspaceFileWatcher, PreferredWorkspaceFileWatcher,
    WatchmanWorkspaceFileWatcher, WorkspaceFileWatcher, WorkspaceWatchError, WorkspaceWatchEvent,
    WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
    WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
};
use crate::lsp::JsonRpcNotification;
use crate::lsp_features::{
    LspTextDocumentFeatureRequestFactory, TextDocumentFeatureRequestFactory, WorkspaceFileChange,
    WorkspaceFileChangeType,
};
use crate::lsp_session::JavaScriptTypeScriptLanguageServerRegistry;
use std::ffi::OsString;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
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
        let watcher = PreferredWorkspaceFileWatcher::new(
            WatchmanWorkspaceFileWatcher,
            NativeNotifyWorkspaceFileWatcher,
            CommandWatchmanAvailability,
        );

        self.start_with_watcher(root_path, &watcher, |root_key| {
            Arc::new(JavaScriptTypeScriptWorkspaceWatchSink {
                app,
                root_path: root_key.to_string(),
            })
        })
    }

    fn start_with_watcher(
        &self,
        root_path: &str,
        watcher: &dyn WorkspaceFileWatcher,
        sink_factory: impl FnOnce(&str) -> Arc<dyn WorkspaceWatchEventSink>,
    ) -> Result<(), String> {
        let root = PathBuf::from(root_path)
            .canonicalize()
            .map_err(|error| format!("Failed to watch JavaScript/TypeScript workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;

        if sessions.contains_key(&root_key) {
            return Ok(());
        }

        let sink = sink_factory(&root_key);
        let session = watcher
            .watch(WorkspaceWatchRequest::new(root), sink)
            .map_err(|error| {
                format!("Failed to start JavaScript/TypeScript workspace watcher: {error}")
            })?;

        sessions.insert(root_key, session);
        Ok(())
    }

    pub fn stop(&self, root_path: &str) {
        let Some(mut session) = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| remove_workspace_watch_session(&mut sessions, root_path))
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

impl Drop for JavaScriptTypeScriptWorkspaceWatchRegistry {
    fn drop(&mut self) {
        self.stop_all();
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
    workspace_watch_id_candidates(root_path)
        .into_iter()
        .next()
        .unwrap_or_default()
}

fn remove_workspace_watch_session(
    sessions: &mut HashMap<String, Box<dyn WorkspaceWatchSession>>,
    root_path: &str,
) -> Option<Box<dyn WorkspaceWatchSession>> {
    for root_key in workspace_watch_id_candidates(&PathBuf::from(root_path)) {
        if let Some(session) = sessions.remove(&root_key) {
            return Some(session);
        }
    }

    None
}

fn workspace_watch_id_candidates(root_path: &Path) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(canonical) = root_path.canonicalize() {
        push_unique_path_key(&mut candidates, &canonical);
    }

    if let Some(resolved) = resolve_existing_or_parent_path(root_path) {
        push_unique_path_key(&mut candidates, &resolved);
    }

    push_unique_path_key(&mut candidates, &normalize_path(root_path));
    candidates
}

fn resolve_existing_or_parent_path(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components: Vec<OsString> = Vec::new();

    while !cursor.exists() {
        missing_components.push(cursor.file_name()?.to_os_string());

        if !cursor.pop() {
            return None;
        }
    }

    let mut resolved = cursor.canonicalize().ok()?;

    while let Some(component) = missing_components.pop() {
        resolved.push(component);
    }

    Some(normalize_path(&resolved))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn push_unique_path_key(candidates: &mut Vec<String>, path: &Path) {
    let key = path_key(path);

    if !candidates.contains(&key) {
        candidates.push(key);
    }
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{watched_file_changes_for_events, JavaScriptTypeScriptWorkspaceWatchRegistry};
    use crate::file_watcher::{
        WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchError, WorkspaceWatchEvent,
        WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
        WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
    };
    use crate::lsp_features::WorkspaceFileChangeType;
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

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

    #[test]
    fn watch_registry_stop_stops_requested_root_only() {
        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("watch-stop-a");
        let root_b = temp_workspace("watch-stop-b");

        start_with_watcher(&registry, &root_a, &watcher);
        start_with_watcher(&registry, &root_b, &watcher);

        registry.stop(&path_string(&root_a));
        registry.stop(&path_string(&root_a));

        assert_eq!(watcher.started_roots().len(), 2);
        assert_eq!(watcher.stopped_roots(), vec![root_a.clone()]);

        registry.stop_all();

        let stopped = watcher.stopped_roots();
        assert_eq!(stopped.len(), 2);
        assert!(stopped.contains(&root_a));
        assert!(stopped.contains(&root_b));
    }

    #[test]
    fn watch_registry_stop_all_is_idempotent() {
        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("watch-stop-all-a");
        let root_b = temp_workspace("watch-stop-all-b");

        start_with_watcher(&registry, &root_a, &watcher);
        start_with_watcher(&registry, &root_b, &watcher);

        registry.stop_all();
        registry.stop_all();

        let stopped = watcher.stopped_roots();
        assert_eq!(stopped.len(), 2);
        assert!(stopped.contains(&root_a));
        assert!(stopped.contains(&root_b));
    }

    #[test]
    fn watch_registry_drop_stops_all_sessions() {
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("watch-drop-a");
        let root_b = temp_workspace("watch-drop-b");

        {
            let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
            start_with_watcher(&registry, &root_a, &watcher);
            start_with_watcher(&registry, &root_b, &watcher);

            assert!(watcher.stopped_roots().is_empty());
        }

        let stopped = watcher.stopped_roots();
        assert_eq!(stopped.len(), 2);
        assert!(stopped.contains(&root_a));
        assert!(stopped.contains(&root_b));
    }

    #[test]
    fn watch_registry_start_is_idempotent_for_same_canonical_root() {
        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root = temp_workspace("watch-start-idempotent");

        start_with_watcher(&registry, &root, &watcher);
        start_with_watcher(&registry, &root, &watcher);

        assert_eq!(watcher.started_roots(), vec![root]);
        assert!(watcher.stopped_roots().is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn watch_registry_start_is_idempotent_for_symlink_alias_root() {
        use std::os::unix::fs::symlink;

        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let parent = temp_workspace("watch-start-alias-parent");
        let root = parent.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");
        let root = root.canonicalize().expect("canonical workspace root");
        let alias_parent = temp_path("watch-start-alias-link");
        symlink(&parent, &alias_parent).expect("workspace parent symlink");
        let alias_root = alias_parent.join("workspace");

        start_with_watcher(&registry, &root, &watcher);
        start_with_watcher(&registry, &alias_root, &watcher);

        assert_eq!(watcher.started_roots(), vec![root]);
    }

    #[test]
    #[cfg(unix)]
    fn watch_registry_stop_resolves_missing_symlink_alias_root() {
        use std::os::unix::fs::symlink;

        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let parent = temp_workspace("watch-stop-alias-parent");
        let root = parent.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");
        let root = root.canonicalize().expect("canonical workspace root");
        let alias_parent = temp_path("watch-stop-alias-link");
        symlink(&parent, &alias_parent).expect("workspace parent symlink");
        let alias_root = alias_parent.join("workspace");

        start_with_watcher(&registry, &root, &watcher);
        fs::remove_dir_all(&root).expect("remove workspace root");

        registry.stop(&path_string(&alias_root));

        assert_eq!(watcher.stopped_roots(), vec![root]);
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

    fn start_with_watcher(
        registry: &JavaScriptTypeScriptWorkspaceWatchRegistry,
        root: &Path,
        watcher: &RecordingWatcher,
    ) {
        registry
            .start_with_watcher(&path_string(root), watcher, |_| {
                Arc::new(NoopWatchSink) as Arc<dyn WorkspaceWatchEventSink>
            })
            .expect("start workspace watch");
    }

    #[derive(Clone, Default)]
    struct RecordingWatcher {
        started: Arc<Mutex<Vec<PathBuf>>>,
        stopped: Arc<Mutex<Vec<PathBuf>>>,
    }

    impl RecordingWatcher {
        fn started_roots(&self) -> Vec<PathBuf> {
            self.started.lock().expect("started roots").clone()
        }

        fn stopped_roots(&self) -> Vec<PathBuf> {
            self.stopped.lock().expect("stopped roots").clone()
        }
    }

    impl WorkspaceFileWatcher for RecordingWatcher {
        fn watch(
            &self,
            request: WorkspaceWatchRequest,
            _sink: Arc<dyn WorkspaceWatchEventSink>,
        ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
            self.started
                .lock()
                .expect("started roots")
                .push(request.root_path.clone());

            Ok(Box::new(RecordingWatchSession {
                root_path: request.root_path,
                stopped: Arc::clone(&self.stopped),
            }))
        }
    }

    struct RecordingWatchSession {
        root_path: PathBuf,
        stopped: Arc<Mutex<Vec<PathBuf>>>,
    }

    impl WorkspaceWatchSession for RecordingWatchSession {
        fn stop(&mut self) {
            self.stopped
                .lock()
                .expect("stopped roots")
                .push(self.root_path.clone());
        }
    }

    struct NoopWatchSink;

    impl WorkspaceWatchEventSink for NoopWatchSink {
        fn error(&self, _error: WorkspaceWatchError) {}

        fn publish(&self, _batch: WorkspaceWatchEventBatch) {}
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = temp_path(label);
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical temp workspace")
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("editor-watch-{label}-{}", unique_suffix()))
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }
}
