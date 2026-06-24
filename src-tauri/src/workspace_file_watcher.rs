use crate::file_watcher::{
    CommandWatchmanAvailability, NativeNotifyWorkspaceFileWatcher, PreferredWorkspaceFileWatcher,
    WatchmanWorkspaceFileWatcher, WorkspaceFileWatcher, WorkspaceWatchError, WorkspaceWatchEvent,
    WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
    WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
};
use serde::Serialize;
use std::ffi::OsString;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_FILE_CHANGED_EVENT: &str = "workspace://file-changed";

/// Payload forwarded to the frontend for every workspace file-system change so
/// that external mutations (delete / rename / create / modify done outside the
/// editor) are reflected in the UI tree, tabs and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChangedPayload {
    pub root_path: String,
    pub kind: WorkspaceWatchEventKind,
    pub path: String,
    pub previous_path: Option<String>,
    pub relative_path: String,
    pub previous_relative_path: Option<String>,
    pub file_kind: Option<WorkspaceWatchFileKind>,
}

/// Abstraction over the Tauri event channel so the payload mapping and the
/// per-workspace isolation can be exercised without a live `AppHandle`.
pub trait WorkspaceFileChangeEmitter: Send + Sync {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]);
}

pub struct AppHandleWorkspaceFileChangeEmitter {
    app: AppHandle,
}

impl AppHandleWorkspaceFileChangeEmitter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WorkspaceFileChangeEmitter for AppHandleWorkspaceFileChangeEmitter {
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) {
        for payload in payloads {
            let _ = self.app.emit(WORKSPACE_FILE_CHANGED_EVENT, payload);
        }
    }
}

/// Generic, language-agnostic workspace watcher registry. One native watcher
/// session per open workspace root, forwarding every relevant file-system
/// change to the frontend as a `workspace://file-changed` Tauri event.
///
/// This runs independently of (and in addition to) the JavaScript/TypeScript
/// watcher, which only feeds `didChangeWatchedFiles` into the JS/TS language
/// server and never reaches the frontend.
pub struct WorkspaceFileChangeWatchRegistry {
    sessions: Mutex<HashMap<String, Box<dyn WorkspaceWatchSession>>>,
}

impl WorkspaceFileChangeWatchRegistry {
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
            Arc::new(WorkspaceFileChangeSink {
                emitter: Arc::new(AppHandleWorkspaceFileChangeEmitter::new(app)),
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
            .map_err(|error| format!("Failed to watch workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;

        if sessions.contains_key(&root_key) {
            return Ok(());
        }

        let sink = sink_factory(&root_key);
        let session = watcher
            .watch(WorkspaceWatchRequest::new(root), sink)
            .map_err(|error| format!("Failed to start workspace watcher: {error}"))?;

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

impl Default for WorkspaceFileChangeWatchRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WorkspaceFileChangeWatchRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

struct WorkspaceFileChangeSink {
    emitter: Arc<dyn WorkspaceFileChangeEmitter>,
    root_path: String,
}

impl WorkspaceWatchEventSink for WorkspaceFileChangeSink {
    fn error(&self, _error: WorkspaceWatchError) {}

    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        let payloads = workspace_file_changed_payloads(&self.root_path, &batch.events);

        if payloads.is_empty() {
            return;
        }

        self.emitter.emit_file_changes(&payloads);
    }
}

/// Maps raw watch events to frontend payloads, dropping events that fall
/// outside the watched root so a watcher can never report changes for another
/// workspace. `RescanRequired` carries no actionable path for the tree, so it
/// is dropped here (the frontend reacts to concrete create/delete/rename/modify
/// events only).
fn workspace_file_changed_payloads(
    root_path: &str,
    events: &[WorkspaceWatchEvent],
) -> Vec<WorkspaceFileChangedPayload> {
    events
        .iter()
        .filter_map(|event| workspace_file_changed_payload(root_path, event))
        .collect()
}

fn workspace_file_changed_payload(
    root_path: &str,
    event: &WorkspaceWatchEvent,
) -> Option<WorkspaceFileChangedPayload> {
    if matches!(event.kind, WorkspaceWatchEventKind::RescanRequired) {
        return None;
    }

    if !is_path_inside_root(root_path, &event.path) {
        return None;
    }

    Some(WorkspaceFileChangedPayload {
        root_path: root_path.to_string(),
        kind: event.kind,
        path: event.path.clone(),
        previous_path: event.previous_path.clone(),
        relative_path: event.relative_path.clone(),
        previous_relative_path: event.previous_relative_path.clone(),
        file_kind: event.file_kind,
    })
}

fn is_path_inside_root(root_path: &str, path: &str) -> bool {
    let root = normalize_path(Path::new(root_path));
    let path = normalize_path(Path::new(path));

    if root.as_os_str().is_empty() {
        return false;
    }

    path.starts_with(root)
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
    use super::{
        workspace_file_changed_payloads, WorkspaceFileChangeEmitter, WorkspaceFileChangeSink,
        WorkspaceFileChangeWatchRegistry, WorkspaceFileChangedPayload,
    };
    use crate::file_watcher::{
        WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchError, WorkspaceWatchEvent,
        WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
        WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
    };
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    const WORKSPACE_ROOT: &str = "/workspace";

    #[test]
    fn maps_delete_and_modify_events_to_frontend_payloads() {
        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            &[
                event(WorkspaceWatchEventKind::Deleted, "/workspace/src/User.php"),
                event(WorkspaceWatchEventKind::Modified, "/workspace/src/App.tsx"),
                event(WorkspaceWatchEventKind::Created, "/workspace/src/New.php"),
            ],
        );

        assert_eq!(payloads.len(), 3);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Deleted);
        assert_eq!(payloads[0].path, "/workspace/src/User.php");
        assert_eq!(payloads[0].relative_path, "src/User.php");
        assert_eq!(payloads[0].root_path, WORKSPACE_ROOT);
        assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Modified);
        assert_eq!(payloads[2].kind, WorkspaceWatchEventKind::Created);
    }

    #[test]
    fn maps_rename_events_with_previous_path() {
        let mut rename =
            event(WorkspaceWatchEventKind::Renamed, "/workspace/src/Account.php");
        rename.previous_path = Some("/workspace/src/User.php".to_string());
        rename.previous_relative_path = Some("src/User.php".to_string());

        let payloads = workspace_file_changed_payloads(WORKSPACE_ROOT, &[rename]);

        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Renamed);
        assert_eq!(payloads[0].path, "/workspace/src/Account.php");
        assert_eq!(
            payloads[0].previous_path,
            Some("/workspace/src/User.php".to_string())
        );
        assert_eq!(
            payloads[0].previous_relative_path,
            Some("src/User.php".to_string())
        );
    }

    #[test]
    fn drops_rescan_events_and_events_outside_root() {
        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            &[
                event(
                    WorkspaceWatchEventKind::RescanRequired,
                    "/workspace/src/User.php",
                ),
                event(WorkspaceWatchEventKind::Deleted, "/other/src/User.php"),
                event(
                    WorkspaceWatchEventKind::Deleted,
                    "/workspace/../other/User.php",
                ),
            ],
        );

        assert!(payloads.is_empty());
    }

    #[test]
    fn sink_emits_only_events_for_its_own_root() {
        let recorder = RecordingEmitter::default();
        let sink = WorkspaceFileChangeSink {
            emitter: Arc::new(recorder.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![
                event(WorkspaceWatchEventKind::Deleted, "/workspace/src/User.php"),
                event(WorkspaceWatchEventKind::Deleted, "/elsewhere/src/Other.php"),
            ],
        });

        let emitted = recorder.payloads();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].path, "/workspace/src/User.php");
    }

    #[test]
    fn watch_registry_stop_stops_requested_root_only() {
        let registry = WorkspaceFileChangeWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("generic-watch-stop-a");
        let root_b = temp_workspace("generic-watch-stop-b");

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
    fn watch_registry_start_is_idempotent_for_same_canonical_root() {
        let registry = WorkspaceFileChangeWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root = temp_workspace("generic-watch-start-idempotent");

        start_with_watcher(&registry, &root, &watcher);
        start_with_watcher(&registry, &root, &watcher);

        assert_eq!(watcher.started_roots(), vec![root]);
        assert!(watcher.stopped_roots().is_empty());
    }

    #[test]
    fn watch_registry_drop_stops_all_sessions() {
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("generic-watch-drop-a");
        let root_b = temp_workspace("generic-watch-drop-b");

        {
            let registry = WorkspaceFileChangeWatchRegistry::new();
            start_with_watcher(&registry, &root_a, &watcher);
            start_with_watcher(&registry, &root_b, &watcher);

            assert!(watcher.stopped_roots().is_empty());
        }

        let stopped = watcher.stopped_roots();
        assert_eq!(stopped.len(), 2);
        assert!(stopped.contains(&root_a));
        assert!(stopped.contains(&root_b));
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
            root_path: WORKSPACE_ROOT.to_string(),
        }
    }

    fn start_with_watcher(
        registry: &WorkspaceFileChangeWatchRegistry,
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
    struct RecordingEmitter {
        payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
    }

    impl RecordingEmitter {
        fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
            self.payloads.lock().expect("payloads").clone()
        }
    }

    impl WorkspaceFileChangeEmitter for RecordingEmitter {
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) {
            self.payloads
                .lock()
                .expect("payloads")
                .extend_from_slice(payloads);
        }
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
        let root =
            std::env::temp_dir().join(format!("editor-generic-watch-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical temp workspace")
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
