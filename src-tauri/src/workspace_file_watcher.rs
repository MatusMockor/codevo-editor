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
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_FILE_CHANGED_EVENT: &str = "workspace://file-changed";

/// Payload forwarded to the frontend for every workspace file-system change so
/// that external mutations (delete / rename / create / modify done outside the
/// editor) are reflected in the UI tree, tabs and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChangedPayload {
    pub watch_generation: u64,
    pub root_path: String,
    pub kind: WorkspaceWatchEventKind,
    pub path: String,
    pub previous_path: Option<String>,
    pub relative_path: String,
    pub previous_relative_path: Option<String>,
    pub file_kind: Option<WorkspaceWatchFileKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileWatchStartReceipt {
    pub root_path: String,
    pub watch_generation: u64,
}

/// Abstraction over the Tauri event channel so the payload mapping and the
/// per-workspace isolation can be exercised without a live `AppHandle`.
pub trait WorkspaceFileChangeEmitter: Send + Sync {
    /// On failure, returns the number of payloads already emitted so a bounded
    /// retry can resume without duplicating earlier frontend events.
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize>;
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
    fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
        for (index, payload) in payloads.iter().enumerate() {
            if self
                .app
                .emit(WORKSPACE_FILE_CHANGED_EVENT, payload)
                .is_err()
            {
                return Err(index);
            }
        }
        Ok(())
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
    next_generation: AtomicU64,
    sessions: Mutex<HashMap<String, WorkspaceFileChangeWatchSession>>,
    recovery_by_root: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

struct WorkspaceFileChangeWatchSession {
    authority: Arc<WorkspaceWatchSinkAuthority>,
    session: Box<dyn WorkspaceWatchSession>,
}

impl WorkspaceFileChangeWatchSession {
    fn stop(&mut self) {
        self.authority.revoke();
        self.session.stop();
    }
}

const MAX_WORKSPACE_WATCH_BATCH_EVENTS: usize = 4_096;
const MAX_SAFE_JAVASCRIPT_WATCH_GENERATION: u64 = 9_007_199_254_740_991;

struct WorkspaceWatchSinkAuthority {
    active: AtomicBool,
    generation: u64,
    recovery_pending: Arc<AtomicBool>,
}

impl WorkspaceWatchSinkAuthority {
    #[cfg(test)]
    fn new(generation: u64) -> Self {
        Self::with_recovery(generation, Arc::new(AtomicBool::new(false)))
    }

    fn with_recovery(generation: u64, recovery_pending: Arc<AtomicBool>) -> Self {
        Self {
            active: AtomicBool::new(true),
            generation,
            recovery_pending,
        }
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    fn revoke(&self) {
        self.active.store(false, Ordering::Release);
    }

    fn publish_if_active(&self, publish: impl FnOnce()) {
        if self.is_active() {
            publish();
        }
    }
}

impl WorkspaceFileChangeWatchRegistry {
    pub fn new() -> Self {
        Self {
            next_generation: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
            recovery_by_root: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(
        &self,
        root_path: &str,
        app: AppHandle,
    ) -> Result<WorkspaceFileWatchStartReceipt, String> {
        let watcher = PreferredWorkspaceFileWatcher::new(
            WatchmanWorkspaceFileWatcher,
            NativeNotifyWorkspaceFileWatcher,
            CommandWatchmanAvailability,
        );

        self.start_with_watcher(root_path, &watcher, |root_key, authority| {
            Arc::new(WorkspaceFileChangeSink {
                authority,
                emitter: Arc::new(AppHandleWorkspaceFileChangeEmitter::new(app)),
                root_path: root_key.to_string(),
            })
        })
    }

    fn start_with_watcher(
        &self,
        root_path: &str,
        watcher: &dyn WorkspaceFileWatcher,
        sink_factory: impl FnOnce(
            &str,
            Arc<WorkspaceWatchSinkAuthority>,
        ) -> Arc<dyn WorkspaceWatchEventSink>,
    ) -> Result<WorkspaceFileWatchStartReceipt, String> {
        let root = PathBuf::from(root_path)
            .canonicalize()
            .map_err(|error| format!("Failed to watch workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;

        if let Some(session) = sessions.get(&root_key) {
            return Ok(WorkspaceFileWatchStartReceipt {
                root_path: root_key,
                watch_generation: session.authority.generation,
            });
        }

        let generation = self
            .next_generation
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |generation| {
                (generation < MAX_SAFE_JAVASCRIPT_WATCH_GENERATION).then_some(generation + 1)
            })
            .map_err(|_| "Workspace watch generation space is exhausted.".to_string())?;
        let recovery_pending = self
            .recovery_by_root
            .lock()
            .map_err(|error| error.to_string())?
            .entry(root_key.clone())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone();
        let authority = Arc::new(WorkspaceWatchSinkAuthority::with_recovery(
            generation,
            recovery_pending,
        ));
        let sink = sink_factory(&root_key, Arc::clone(&authority));
        let session = match watcher.watch(WorkspaceWatchRequest::new(root), Arc::clone(&sink)) {
            Ok(session) => session,
            Err(error) => {
                authority.revoke();
                return Err(format!("Failed to start workspace watcher: {error}"));
            }
        };
        if authority.recovery_pending.load(Ordering::Acquire) {
            sink.publish(WorkspaceWatchEventBatch {
                events: vec![WorkspaceWatchEvent {
                    backend: crate::file_watcher::WorkspaceWatchBackend::Native,
                    file_kind: Some(WorkspaceWatchFileKind::Directory),
                    kind: WorkspaceWatchEventKind::RescanRequired,
                    path: root_key.clone(),
                    previous_path: None,
                    previous_relative_path: None,
                    relative_path: String::new(),
                    root_path: root_key.clone(),
                }],
            });
        }

        sessions.insert(
            root_key.clone(),
            WorkspaceFileChangeWatchSession { authority, session },
        );
        Ok(WorkspaceFileWatchStartReceipt {
            root_path: root_key,
            watch_generation: generation,
        })
    }

    pub fn stop(&self, root_path: &str) {
        let Some(mut watch_session) = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| remove_workspace_watch_session(&mut sessions, root_path))
        else {
            return;
        };

        watch_session.stop();
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

        for mut watch_session in sessions {
            watch_session.stop();
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
    authority: Arc<WorkspaceWatchSinkAuthority>,
    emitter: Arc<dyn WorkspaceFileChangeEmitter>,
    root_path: String,
}

impl WorkspaceWatchEventSink for WorkspaceFileChangeSink {
    fn error(&self, _error: WorkspaceWatchError) {}

    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        if !self.authority.is_active() {
            return;
        }
        let oversized = batch.events.len() > MAX_WORKSPACE_WATCH_BATCH_EVENTS;
        let force_rescan = oversized
            || self
                .authority
                .recovery_pending
                .swap(false, Ordering::AcqRel);
        let events = if oversized {
            &[][..]
        } else {
            batch.events.as_slice()
        };
        let payloads = workspace_file_changed_payloads(
            &self.root_path,
            self.authority.generation,
            events,
            force_rescan,
        );

        if payloads.is_empty() {
            return;
        }

        self.authority.publish_if_active(|| {
            if let Err(published) = self.emitter.emit_file_changes(&payloads) {
                if self
                    .emitter
                    .emit_file_changes(&payloads[published..])
                    .is_err()
                {
                    let recovery = WorkspaceFileChangedPayload {
                        watch_generation: self.authority.generation,
                        root_path: self.root_path.clone(),
                        kind: WorkspaceWatchEventKind::RescanRequired,
                        path: self.root_path.clone(),
                        previous_path: None,
                        relative_path: String::new(),
                        previous_relative_path: None,
                        file_kind: None,
                    };
                    if self.emitter.emit_file_changes(&[recovery]).is_err() {
                        self.authority
                            .recovery_pending
                            .store(true, Ordering::Release);
                    }
                }
            }
        });
    }
}

/// Maps raw watch events to exact-generation frontend payloads. Concrete events
/// outside the watched root and malformed/foreign rescan claims fail closed.
/// A valid rescan is preserved alongside concrete events so consumers can
/// invalidate caches without losing the actionable portion of a mixed batch.
fn workspace_file_changed_payloads(
    root_path: &str,
    watch_generation: u64,
    events: &[WorkspaceWatchEvent],
    force_rescan: bool,
) -> Vec<WorkspaceFileChangedPayload> {
    let mut payloads = events
        .iter()
        .filter(|event| !matches!(event.kind, WorkspaceWatchEventKind::RescanRequired))
        .flat_map(|event| {
            workspace_file_changed_payloads_for_event(root_path, watch_generation, event)
        })
        .collect::<Vec<_>>();
    if force_rescan
        || events.iter().any(|event| {
            matches!(event.kind, WorkspaceWatchEventKind::RescanRequired)
                && rescan_event_matches_root(root_path, event)
        })
    {
        payloads.push(WorkspaceFileChangedPayload {
            watch_generation,
            root_path: root_path.to_string(),
            kind: WorkspaceWatchEventKind::RescanRequired,
            path: root_path.to_string(),
            previous_path: None,
            relative_path: String::new(),
            previous_relative_path: None,
            file_kind: None,
        });
    }
    payloads
}

fn workspace_file_changed_payloads_for_event(
    root_path: &str,
    watch_generation: u64,
    event: &WorkspaceWatchEvent,
) -> Vec<WorkspaceFileChangedPayload> {
    if !matches!(event.kind, WorkspaceWatchEventKind::Renamed) {
        return workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            event.kind,
            &event.path,
            None,
            event.file_kind,
        )
        .into_iter()
        .collect();
    }

    let previous_path = event.previous_path.as_deref();
    let previous_inside = previous_path.is_some_and(|path| is_path_inside_root(root_path, path));
    let current_inside = is_path_inside_root(root_path, &event.path);
    match (previous_inside, current_inside) {
        (true, true) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Renamed,
            &event.path,
            previous_path,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (true, false) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Deleted,
            previous_path.expect("previous path was checked"),
            None,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (false, true) => workspace_file_changed_payload_for_path(
            root_path,
            watch_generation,
            WorkspaceWatchEventKind::Created,
            &event.path,
            None,
            event.file_kind,
        )
        .into_iter()
        .collect(),
        (false, false) => Vec::new(),
    }
}

fn workspace_file_changed_payload_for_path(
    root_path: &str,
    watch_generation: u64,
    kind: WorkspaceWatchEventKind,
    path: &str,
    previous_path: Option<&str>,
    file_kind: Option<WorkspaceWatchFileKind>,
) -> Option<WorkspaceFileChangedPayload> {
    let relative_path = relative_path_inside_root(root_path, path)?;
    let previous_relative_path = match previous_path {
        Some(path) => Some(relative_path_inside_root(root_path, path)?),
        None => None,
    };
    Some(WorkspaceFileChangedPayload {
        watch_generation,
        root_path: root_path.to_string(),
        kind,
        path: path.to_string(),
        previous_path: previous_path.map(str::to_string),
        relative_path,
        previous_relative_path,
        file_kind,
    })
}

fn relative_path_inside_root(root_path: &str, path: &str) -> Option<String> {
    let root = normalize_path(Path::new(root_path));
    let path = normalize_path(Path::new(path));
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn rescan_event_matches_root(root_path: &str, event: &WorkspaceWatchEvent) -> bool {
    normalize_path(Path::new(&event.root_path)) == normalize_path(Path::new(root_path))
        && normalize_path(Path::new(&event.path)) == normalize_path(Path::new(root_path))
        && event.relative_path.is_empty()
        && event.previous_path.is_none()
        && event.previous_relative_path.is_none()
        && event.file_kind == Some(WorkspaceWatchFileKind::Directory)
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
    sessions: &mut HashMap<String, WorkspaceFileChangeWatchSession>,
    root_path: &str,
) -> Option<WorkspaceFileChangeWatchSession> {
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
        WorkspaceFileWatchStartReceipt, WorkspaceWatchSinkAuthority,
    };
    use crate::file_watcher::{
        WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchError, WorkspaceWatchEvent,
        WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
        WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
    };
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    const WORKSPACE_ROOT: &str = "/workspace";

    #[test]
    fn maps_delete_and_modify_events_to_frontend_payloads() {
        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            7,
            &[
                event(WorkspaceWatchEventKind::Deleted, "/workspace/src/User.php"),
                event(WorkspaceWatchEventKind::Modified, "/workspace/src/App.tsx"),
                event(WorkspaceWatchEventKind::Created, "/workspace/src/New.php"),
            ],
            false,
        );

        assert_eq!(payloads.len(), 3);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Deleted);
        assert_eq!(payloads[0].path, "/workspace/src/User.php");
        assert_eq!(payloads[0].relative_path, "src/User.php");
        assert_eq!(payloads[0].root_path, WORKSPACE_ROOT);
        assert_eq!(payloads[0].watch_generation, 7);
        assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Modified);
        assert_eq!(payloads[2].kind, WorkspaceWatchEventKind::Created);
    }

    #[test]
    fn maps_rename_events_with_previous_path() {
        let mut rename = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/src/Account.php",
        );
        rename.previous_path = Some("/workspace/src/User.php".to_string());
        rename.previous_relative_path = Some("src/User.php".to_string());

        let payloads = workspace_file_changed_payloads(WORKSPACE_ROOT, 1, &[rename], false);

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
    fn maps_cross_root_renames_to_only_the_authorized_side() {
        let mut outside_to_inside =
            event(WorkspaceWatchEventKind::Renamed, "/workspace/src/new.ts");
        outside_to_inside.previous_path = Some("/other/src/old.ts".to_string());
        let mut inside_to_outside = event(WorkspaceWatchEventKind::Renamed, "/other/src/moved.ts");
        inside_to_outside.previous_path = Some("/workspace/src/original.ts".to_string());

        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            2,
            &[outside_to_inside, inside_to_outside],
            false,
        );

        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Created);
        assert_eq!(payloads[0].path, "/workspace/src/new.ts");
        assert_eq!(payloads[0].previous_path, None);
        assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Deleted);
        assert_eq!(payloads[1].path, "/workspace/src/original.ts");
        assert_eq!(payloads[1].relative_path, "src/original.ts");
    }

    #[test]
    fn coalesces_rescan_events_and_drops_events_outside_root() {
        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            1,
            &[
                event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT),
                event(WorkspaceWatchEventKind::Deleted, "/other/src/User.php"),
                event(
                    WorkspaceWatchEventKind::Deleted,
                    "/workspace/../other/User.php",
                ),
            ],
            false,
        );

        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(payloads[0].root_path, WORKSPACE_ROOT);
        assert_eq!(payloads[0].path, WORKSPACE_ROOT);
        assert_eq!(payloads[0].relative_path, "");
        assert_eq!(payloads[0].file_kind, None);

        assert!(workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            1,
            &[event(
                WorkspaceWatchEventKind::RescanRequired,
                "/other/src/User.php"
            )],
            false
        )
        .is_empty());
    }

    #[test]
    fn mixed_rescan_batch_preserves_concrete_events() {
        let payloads = workspace_file_changed_payloads(
            WORKSPACE_ROOT,
            3,
            &[
                event(WorkspaceWatchEventKind::Created, "/workspace/src/new.ts"),
                event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT),
                event(WorkspaceWatchEventKind::Deleted, "/workspace/src/old.ts"),
            ],
            false,
        );

        assert_eq!(payloads.len(), 3);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::Created);
        assert_eq!(payloads[1].kind, WorkspaceWatchEventKind::Deleted);
        assert_eq!(payloads[2].kind, WorkspaceWatchEventKind::RescanRequired);
        assert!(payloads.iter().all(|payload| payload.watch_generation == 3));
    }

    #[test]
    fn foreign_rescan_is_not_promoted_to_the_sink_root() {
        let foreign = root_rescan_event("/other");
        assert!(workspace_file_changed_payloads(WORKSPACE_ROOT, 1, &[foreign], false).is_empty());
    }

    #[test]
    fn sink_emits_only_events_for_its_own_root() {
        let recorder = RecordingEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
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
    fn sink_preserves_a_trailing_rescan_after_the_upstream_coalescing_window() {
        let recorder = RecordingEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
            emitter: Arc::new(recorder.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };
        let rescan = event(WorkspaceWatchEventKind::RescanRequired, WORKSPACE_ROOT);

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![rescan.clone()],
        });
        sink.publish(WorkspaceWatchEventBatch {
            events: vec![rescan],
        });

        let emitted = recorder.payloads();
        assert_eq!(emitted.len(), 2);
        assert_eq!(emitted[0].kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(emitted[1].kind, WorkspaceWatchEventKind::RescanRequired);
    }

    #[test]
    fn revoking_a_watch_does_not_wait_for_a_blocking_emitter() {
        let emitter = BlockingEmitter::default();
        let authority = Arc::new(WorkspaceWatchSinkAuthority::new(1));
        let sink = Arc::new(WorkspaceFileChangeSink {
            authority: Arc::clone(&authority),
            emitter: Arc::new(emitter.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        });
        let publisher = Arc::clone(&sink);
        let publish_thread = std::thread::spawn(move || {
            publisher.publish(WorkspaceWatchEventBatch {
                events: vec![event(
                    WorkspaceWatchEventKind::Modified,
                    "/workspace/src/index.ts",
                )],
            });
        });
        emitter.wait_until_entered();

        let started = Instant::now();
        authority.revoke();

        assert!(started.elapsed() < Duration::from_millis(100));
        publish_thread.join().expect("publish thread");
    }

    #[test]
    fn sink_retries_a_failed_frontend_emit_once() {
        let emitter = FlakyEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
            emitter: Arc::new(emitter.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::RescanRequired,
                WORKSPACE_ROOT,
            )],
        });

        assert_eq!(emitter.attempts(), 2);
        assert_eq!(emitter.payloads().len(), 1);
    }

    #[test]
    fn sink_resumes_after_a_partial_emit_without_duplicate_payloads() {
        let emitter = PartialEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(1)),
            emitter: Arc::new(emitter.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![
                event(WorkspaceWatchEventKind::Created, "/workspace/a.ts"),
                event(WorkspaceWatchEventKind::Created, "/workspace/b.ts"),
            ],
        });

        let payloads = emitter.payloads();
        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0].path, "/workspace/a.ts");
        assert_eq!(payloads[1].path, "/workspace/b.ts");
    }

    #[test]
    fn repeated_emit_failure_escalates_to_one_rescan_payload() {
        let emitter = AlwaysFailEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(8)),
            emitter: Arc::new(emitter.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/src/index.ts",
            )],
        });

        let attempts = emitter.attempted_kinds();
        assert_eq!(
            attempts,
            vec![
                WorkspaceWatchEventKind::Modified,
                WorkspaceWatchEventKind::Modified,
                WorkspaceWatchEventKind::RescanRequired,
            ]
        );
    }

    #[test]
    fn failed_recovery_is_retained_and_replayed_on_the_next_event() {
        let emitter = RecoveringEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(11)),
            emitter: Arc::new(emitter.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };
        let batch = || WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/src/index.ts",
            )],
        };

        sink.publish(batch());
        sink.publish(batch());

        let delivered = emitter.delivered();
        assert_eq!(delivered.len(), 2);
        assert_eq!(delivered[0].kind, WorkspaceWatchEventKind::Modified);
        assert_eq!(delivered[1].kind, WorkspaceWatchEventKind::RescanRequired);
    }

    #[test]
    fn oversized_batch_fails_closed_to_one_rescan_without_partial_events() {
        let recorder = RecordingEmitter::default();
        let sink = WorkspaceFileChangeSink {
            authority: Arc::new(WorkspaceWatchSinkAuthority::new(9)),
            emitter: Arc::new(recorder.clone()),
            root_path: WORKSPACE_ROOT.to_string(),
        };
        let events = (0..=super::MAX_WORKSPACE_WATCH_BATCH_EVENTS)
            .map(|index| {
                event(
                    WorkspaceWatchEventKind::Modified,
                    &format!("/workspace/src/{index}.ts"),
                )
            })
            .collect();

        sink.publish(WorkspaceWatchEventBatch { events });

        let emitted = recorder.payloads();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(emitted[0].root_path, WORKSPACE_ROOT);
        assert_eq!(emitted[0].path, WORKSPACE_ROOT);
        assert_eq!(emitted[0].watch_generation, 9);
    }

    #[test]
    fn watch_registry_rejects_a_stale_sink_after_an_a_b_a_replacement() {
        let registry = WorkspaceFileChangeWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let recorder = RecordingEmitter::default();
        let root = temp_workspace("generic-watch-a-b-a");

        for _ in 0..2 {
            registry
                .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
                    Arc::new(WorkspaceFileChangeSink {
                        authority,
                        emitter: Arc::new(recorder.clone()),
                        root_path: root_key.to_string(),
                    })
                })
                .expect("start workspace watch");
            if watcher.started_roots().len() == 1 {
                registry.stop(&path_string(&root));
            }
        }

        let stale = watcher.sink(0);
        let current = watcher.sink(1);
        let batch = WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&root))],
        };
        stale.publish(batch.clone());
        current.publish(batch);

        let emitted = recorder.payloads();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].root_path, path_string(&root));
        assert_eq!(emitted[0].watch_generation, 2);
    }

    #[test]
    fn restarted_watch_replays_retained_recovery_before_returning() {
        let registry = WorkspaceFileChangeWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let failing = AlwaysFailEmitter::default();
        let recovered = RecordingEmitter::default();
        let root = temp_workspace("generic-watch-retained-recovery");
        registry
            .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(failing.clone()),
                    root_path: root_key.to_string(),
                })
            })
            .expect("start failing watch");
        watcher.sink(0).publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                &path_string(&root.join("src/index.ts")),
            )],
        });
        registry.stop(&path_string(&root));

        registry
            .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
                Arc::new(WorkspaceFileChangeSink {
                    authority,
                    emitter: Arc::new(recovered.clone()),
                    root_path: root_key.to_string(),
                })
            })
            .expect("restart recovered watch");

        let payloads = recovered.payloads();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(payloads[0].watch_generation, 2);
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

        let first = start_with_watcher(&registry, &root, &watcher);
        let second = start_with_watcher(&registry, &root, &watcher);

        assert_eq!(watcher.started_roots(), vec![root]);
        assert!(watcher.stopped_roots().is_empty());
        assert_eq!(first, second);
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
        let rescan = matches!(kind, WorkspaceWatchEventKind::RescanRequired);
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(if rescan {
                WorkspaceWatchFileKind::Directory
            } else {
                WorkspaceWatchFileKind::File
            }),
            kind,
            path: path.to_string(),
            previous_path: None,
            previous_relative_path: None,
            relative_path: if rescan {
                String::new()
            } else {
                path.trim_start_matches("/workspace/").to_string()
            },
            root_path: WORKSPACE_ROOT.to_string(),
        }
    }

    fn root_rescan_event(root_path: &str) -> WorkspaceWatchEvent {
        let mut event = event(WorkspaceWatchEventKind::RescanRequired, root_path);
        event.root_path = root_path.to_string();
        event
    }

    fn start_with_watcher(
        registry: &WorkspaceFileChangeWatchRegistry,
        root: &Path,
        watcher: &RecordingWatcher,
    ) -> WorkspaceFileWatchStartReceipt {
        registry
            .start_with_watcher(&path_string(root), watcher, |_, _| {
                Arc::new(NoopWatchSink) as Arc<dyn WorkspaceWatchEventSink>
            })
            .expect("start workspace watch")
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
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
            self.payloads
                .lock()
                .expect("payloads")
                .extend_from_slice(payloads);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FlakyEmitter {
        attempts: Arc<Mutex<usize>>,
        payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
    }

    impl FlakyEmitter {
        fn attempts(&self) -> usize {
            *self.attempts.lock().expect("attempts")
        }

        fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
            self.payloads.lock().expect("payloads").clone()
        }
    }

    impl WorkspaceFileChangeEmitter for FlakyEmitter {
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
            let mut attempts = self.attempts.lock().expect("attempts");
            *attempts += 1;
            if *attempts == 1 {
                return Err(0);
            }
            self.payloads
                .lock()
                .expect("payloads")
                .extend_from_slice(payloads);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct PartialEmitter {
        attempts: Arc<Mutex<usize>>,
        payloads: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
    }

    impl PartialEmitter {
        fn payloads(&self) -> Vec<WorkspaceFileChangedPayload> {
            self.payloads.lock().expect("payloads").clone()
        }
    }

    impl WorkspaceFileChangeEmitter for PartialEmitter {
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
            let mut attempts = self.attempts.lock().expect("attempts");
            *attempts += 1;
            if *attempts == 1 {
                self.payloads
                    .lock()
                    .expect("payloads")
                    .push(payloads[0].clone());
                return Err(1);
            }
            self.payloads
                .lock()
                .expect("payloads")
                .extend_from_slice(payloads);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct BlockingEmitter {
        entered: Arc<AtomicBool>,
    }

    impl BlockingEmitter {
        fn wait_until_entered(&self) {
            for _ in 0..100 {
                if self.entered.load(Ordering::Acquire) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            panic!("blocking emitter was not entered");
        }
    }

    impl WorkspaceFileChangeEmitter for BlockingEmitter {
        fn emit_file_changes(
            &self,
            _payloads: &[WorkspaceFileChangedPayload],
        ) -> Result<(), usize> {
            self.entered.store(true, Ordering::Release);
            std::thread::sleep(Duration::from_millis(250));
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct AlwaysFailEmitter {
        attempted_kinds: Arc<Mutex<Vec<WorkspaceWatchEventKind>>>,
    }

    impl AlwaysFailEmitter {
        fn attempted_kinds(&self) -> Vec<WorkspaceWatchEventKind> {
            self.attempted_kinds
                .lock()
                .expect("attempted kinds")
                .clone()
        }
    }

    impl WorkspaceFileChangeEmitter for AlwaysFailEmitter {
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
            self.attempted_kinds
                .lock()
                .expect("attempted kinds")
                .push(payloads[0].kind);
            Err(0)
        }
    }

    #[derive(Clone, Default)]
    struct RecoveringEmitter {
        attempts: Arc<Mutex<usize>>,
        delivered: Arc<Mutex<Vec<WorkspaceFileChangedPayload>>>,
    }

    impl RecoveringEmitter {
        fn delivered(&self) -> Vec<WorkspaceFileChangedPayload> {
            self.delivered.lock().expect("delivered").clone()
        }
    }

    impl WorkspaceFileChangeEmitter for RecoveringEmitter {
        fn emit_file_changes(&self, payloads: &[WorkspaceFileChangedPayload]) -> Result<(), usize> {
            let mut attempts = self.attempts.lock().expect("attempts");
            *attempts += 1;
            if *attempts <= 3 {
                return Err(0);
            }
            self.delivered
                .lock()
                .expect("delivered")
                .extend_from_slice(payloads);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct RecordingWatcher {
        sinks: Arc<Mutex<Vec<Arc<dyn WorkspaceWatchEventSink>>>>,
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

        fn sink(&self, index: usize) -> Arc<dyn WorkspaceWatchEventSink> {
            Arc::clone(&self.sinks.lock().expect("watch sinks")[index])
        }
    }

    impl WorkspaceFileWatcher for RecordingWatcher {
        fn watch(
            &self,
            request: WorkspaceWatchRequest,
            sink: Arc<dyn WorkspaceWatchEventSink>,
        ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
            self.started
                .lock()
                .expect("started roots")
                .push(request.root_path.clone());
            self.sinks.lock().expect("watch sinks").push(sink);

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
