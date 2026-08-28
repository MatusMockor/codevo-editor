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
use crate::lsp_session::{
    ExactSessionNotificationOutcome, JavaScriptTypeScriptLanguageServerRegistry,
    ProjectResyncRequestOutcome,
};
use std::ffi::OsString;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TrySendError},
        Arc, Mutex, Weak,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager};

pub struct JavaScriptTypeScriptWorkspaceWatchRegistry {
    next_generation: AtomicU64,
    sessions: Mutex<HashMap<String, JavaScriptTypeScriptWorkspaceWatchSession>>,
}

struct JavaScriptTypeScriptWorkspaceWatchSession {
    authority: Arc<JavaScriptTypeScriptWatchSinkAuthority>,
    session: Box<dyn WorkspaceWatchSession>,
}

impl JavaScriptTypeScriptWorkspaceWatchSession {
    fn stop(&mut self) {
        self.authority.revoke();
        self.session.stop();
    }
}

const MAX_JS_TS_WATCH_BATCH_EVENTS: usize = 4_096;
const JS_TS_WATCH_DELIVERY_QUEUE_CAPACITY: usize = 64;
const JS_TS_WATCH_RETRY_DELAY: Duration = Duration::from_millis(50);

struct JavaScriptTypeScriptWatchSinkAuthority {
    active: AtomicBool,
    generation: u64,
}

impl JavaScriptTypeScriptWatchSinkAuthority {
    fn new(generation: u64) -> Self {
        Self {
            active: AtomicBool::new(true),
            generation,
        }
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    fn revoke(&self) {
        self.active.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug)]
struct JavaScriptTypeScriptWatchDelivery {
    generation: u64,
    expected_session_id: Option<u64>,
    changes: Vec<WorkspaceFileChange>,
    rescan_required: bool,
}

trait JavaScriptTypeScriptWatchDeliveryTarget: Send + Sync + 'static {
    /// Returns `true` only after the delivery has reached the exact current
    /// language-server session or an exact-session resync has been admitted.
    /// Returning `false` keeps the delivery queued for a bounded retry.
    fn deliver(&self, root_path: &str, delivery: &mut JavaScriptTypeScriptWatchDelivery) -> bool;
}

struct AppHandleJavaScriptTypeScriptWatchDeliveryTarget {
    app: AppHandle,
}

impl JavaScriptTypeScriptWatchDeliveryTarget for AppHandleJavaScriptTypeScriptWatchDeliveryTarget {
    fn deliver(&self, root_path: &str, delivery: &mut JavaScriptTypeScriptWatchDelivery) -> bool {
        let Some(registry) = self
            .app
            .try_state::<JavaScriptTypeScriptLanguageServerRegistry>()
        else {
            return false;
        };
        let session_id = match delivery.expected_session_id {
            Some(session_id) => session_id,
            None => {
                let crate::lsp_session::LanguageServerRuntimeStatus::Running { session_id, .. } =
                    registry.status(root_path)
                else {
                    return false;
                };
                delivery.expected_session_id = Some(session_id);
                session_id
            }
        };

        if !delivery.changes.is_empty() {
            let factory = LspTextDocumentFeatureRequestFactory;
            let request = factory.did_change_watched_files(&delivery.changes);
            match registry.send_notification_for_session_outcome(
                root_path,
                session_id,
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: request.method,
                    params: request.params,
                },
            ) {
                Ok(ExactSessionNotificationOutcome::Admitted) => {}
                Ok(ExactSessionNotificationOutcome::Stale) => {
                    delivery.expected_session_id = None;
                    delivery.changes.clear();
                    delivery.rescan_required = true;
                    return false;
                }
                Err(_) => {
                    return settle_project_resync(
                        registry.request_project_resync(root_path, session_id),
                        delivery,
                    );
                }
            }
        }

        !delivery.rescan_required
            || settle_project_resync(
                registry.request_project_resync(root_path, session_id),
                delivery,
            )
    }
}

fn settle_project_resync(
    outcome: Result<ProjectResyncRequestOutcome, String>,
    delivery: &mut JavaScriptTypeScriptWatchDelivery,
) -> bool {
    match outcome {
        Ok(
            ProjectResyncRequestOutcome::Admitted
            | ProjectResyncRequestOutcome::SupersededByFreshSession,
        ) => true,
        Ok(ProjectResyncRequestOutcome::Unavailable) => {
            delivery.expected_session_id = None;
            delivery.changes.clear();
            delivery.rescan_required = true;
            false
        }
        Err(_) => false,
    }
}

#[derive(Clone)]
struct JavaScriptTypeScriptWatchDispatcher {
    sender: SyncSender<JavaScriptTypeScriptWatchDelivery>,
    overflowed: Arc<AtomicBool>,
}

impl JavaScriptTypeScriptWatchDispatcher {
    fn spawn(
        root_path: String,
        authority: &Arc<JavaScriptTypeScriptWatchSinkAuthority>,
        target: Arc<dyn JavaScriptTypeScriptWatchDeliveryTarget>,
    ) -> Self {
        let (sender, receiver) = sync_channel(JS_TS_WATCH_DELIVERY_QUEUE_CAPACITY);
        let overflowed = Arc::new(AtomicBool::new(false));
        let worker_overflowed = Arc::clone(&overflowed);
        let worker_authority = Arc::downgrade(authority);
        thread::Builder::new()
            .name(format!("js-ts-watch-{}", authority.generation))
            .spawn(move || {
                run_delivery_worker(
                    &root_path,
                    worker_authority,
                    receiver,
                    worker_overflowed,
                    target,
                );
            })
            .expect("failed to start JavaScript/TypeScript watch delivery worker");
        Self { sender, overflowed }
    }

    fn enqueue(&self, mut delivery: JavaScriptTypeScriptWatchDelivery) {
        if delivery.rescan_required {
            self.overflowed.store(true, Ordering::Release);
            delivery.rescan_required = false;
        }
        match self.sender.try_send(delivery) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.overflowed.store(true, Ordering::Release);
            }
            Err(TrySendError::Disconnected(_)) => {}
        }
    }
}

fn run_delivery_worker(
    root_path: &str,
    authority: Weak<JavaScriptTypeScriptWatchSinkAuthority>,
    receiver: Receiver<JavaScriptTypeScriptWatchDelivery>,
    overflowed: Arc<AtomicBool>,
    target: Arc<dyn JavaScriptTypeScriptWatchDeliveryTarget>,
) {
    while let Some(authority) = authority.upgrade() {
        if !authority.is_active() {
            break;
        }
        let mut delivery = match receiver.recv_timeout(JS_TS_WATCH_RETRY_DELAY) {
            Ok(delivery) => delivery,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !overflowed.swap(false, Ordering::AcqRel) {
                    continue;
                }
                JavaScriptTypeScriptWatchDelivery {
                    generation: authority.generation,
                    expected_session_id: None,
                    changes: Vec::new(),
                    rescan_required: true,
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if delivery.generation != authority.generation {
            continue;
        }
        if overflowed.swap(false, Ordering::AcqRel) {
            delivery.rescan_required = true;
        }
        while authority.is_active() {
            if target.deliver(root_path, &mut delivery) {
                if delivery.rescan_required {
                    // One admitted exact-session rebuild covers every event
                    // already queued before admission. Drain those wakeups so
                    // they cannot repeatedly exhaust the auto-restart budget.
                    overflowed.store(false, Ordering::Release);
                    while receiver.try_recv().is_ok() {}
                }
                break;
            }
            thread::sleep(JS_TS_WATCH_RETRY_DELAY);
        }
    }
}

impl JavaScriptTypeScriptWorkspaceWatchRegistry {
    pub fn new() -> Self {
        Self {
            next_generation: AtomicU64::new(0),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self, root_path: &str, app: AppHandle) -> Result<(), String> {
        let watcher = PreferredWorkspaceFileWatcher::new(
            WatchmanWorkspaceFileWatcher,
            NativeNotifyWorkspaceFileWatcher,
            CommandWatchmanAvailability,
        );

        self.start_with_watcher(root_path, &watcher, |root_key, authority| {
            let dispatcher = JavaScriptTypeScriptWatchDispatcher::spawn(
                root_key.to_string(),
                &authority,
                Arc::new(AppHandleJavaScriptTypeScriptWatchDeliveryTarget { app }),
            );
            Arc::new(JavaScriptTypeScriptWorkspaceWatchSink {
                authority,
                dispatcher,
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
            Arc<JavaScriptTypeScriptWatchSinkAuthority>,
        ) -> Arc<dyn WorkspaceWatchEventSink>,
    ) -> Result<(), String> {
        let root = PathBuf::from(root_path)
            .canonicalize()
            .map_err(|error| format!("Failed to watch JavaScript/TypeScript workspace: {error}"))?;
        let root_key = workspace_watch_id(&root);
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;

        if sessions.contains_key(&root_key) {
            return Ok(());
        }

        let generation = self
            .next_generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
                generation.checked_add(1)
            })
            .map_err(|_| "JavaScript/TypeScript watch generation overflowed".to_string())?
            + 1;
        let authority = Arc::new(JavaScriptTypeScriptWatchSinkAuthority::new(generation));
        let sink = sink_factory(&root_key, Arc::clone(&authority));
        let session = match watcher.watch(WorkspaceWatchRequest::new(root), sink) {
            Ok(session) => session,
            Err(error) => {
                authority.revoke();
                return Err(format!(
                    "Failed to start JavaScript/TypeScript workspace watcher: {error}"
                ));
            }
        };

        sessions.insert(
            root_key,
            JavaScriptTypeScriptWorkspaceWatchSession { authority, session },
        );
        Ok(())
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
    authority: Arc<JavaScriptTypeScriptWatchSinkAuthority>,
    dispatcher: JavaScriptTypeScriptWatchDispatcher,
    root_path: String,
}

impl crate::file_watcher::WorkspaceWatchEventSink for JavaScriptTypeScriptWorkspaceWatchSink {
    fn error(&self, _error: WorkspaceWatchError) {}

    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        if !self.authority.is_active() {
            return;
        }
        let force_rescan = batch.events.len() > MAX_JS_TS_WATCH_BATCH_EVENTS;
        let events = if force_rescan {
            &[][..]
        } else {
            batch.events.as_slice()
        };
        let (changes, rescan_required) =
            watched_file_changes_for_events(&self.root_path, events, force_rescan);
        if changes.is_empty() && !rescan_required {
            return;
        }
        self.dispatcher.enqueue(JavaScriptTypeScriptWatchDelivery {
            generation: self.authority.generation,
            expected_session_id: None,
            changes,
            rescan_required,
        });
    }
}

fn watched_file_changes_for_events(
    root_path: &str,
    events: &[WorkspaceWatchEvent],
    force_rescan: bool,
) -> (Vec<WorkspaceFileChange>, bool) {
    let changes = events
        .iter()
        .filter(|event| !matches!(event.kind, WorkspaceWatchEventKind::RescanRequired))
        .flat_map(|event| watched_file_changes_for_event(root_path, event))
        .collect();
    let rescan_required = force_rescan
        || events.iter().any(|event| {
            matches!(event.kind, WorkspaceWatchEventKind::RescanRequired)
                && rescan_event_matches_root(root_path, event)
        });
    (changes, rescan_required)
}

fn watched_file_changes_for_event(
    root_path: &str,
    event: &WorkspaceWatchEvent,
) -> Vec<WorkspaceFileChange> {
    match event.kind {
        WorkspaceWatchEventKind::Created => watched_change(
            root_path,
            event,
            &event.path,
            WorkspaceFileChangeType::Created,
        )
        .into_iter()
        .collect(),
        WorkspaceWatchEventKind::Modified => watched_change(
            root_path,
            event,
            &event.path,
            WorkspaceFileChangeType::Changed,
        )
        .into_iter()
        .collect(),
        WorkspaceWatchEventKind::Deleted => watched_change(
            root_path,
            event,
            &event.path,
            WorkspaceFileChangeType::Deleted,
        )
        .into_iter()
        .collect(),
        WorkspaceWatchEventKind::Renamed => {
            let mut changes = Vec::new();

            if let Some(previous_path) = event.previous_path.as_deref() {
                changes.extend(watched_change(
                    root_path,
                    event,
                    previous_path,
                    WorkspaceFileChangeType::Deleted,
                ));
            }

            changes.extend(watched_change(
                root_path,
                event,
                &event.path,
                WorkspaceFileChangeType::Created,
            ));
            changes
        }
        WorkspaceWatchEventKind::RescanRequired => Vec::new(),
    }
}

fn rescan_event_matches_root(root_path: &str, event: &WorkspaceWatchEvent) -> bool {
    normalize_path(Path::new(&event.root_path)) == normalize_path(Path::new(root_path))
        && normalize_path(Path::new(&event.path)) == normalize_path(Path::new(root_path))
        && event.relative_path.is_empty()
        && event.previous_path.is_none()
        && event.previous_relative_path.is_none()
        && event.file_kind == Some(WorkspaceWatchFileKind::Directory)
}

fn watched_change(
    root_path: &str,
    event: &WorkspaceWatchEvent,
    path: &str,
    change_type: WorkspaceFileChangeType,
) -> Option<WorkspaceFileChange> {
    (is_path_inside_root(root_path, path) && is_javascript_typescript_watched_event(event, path))
        .then(|| WorkspaceFileChange {
            path: path.to_string(),
            change_type,
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

fn is_javascript_typescript_watched_path(path: &str) -> bool {
    if is_javascript_typescript_project_graph_file_name(path) {
        return true;
    }

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

fn is_javascript_typescript_project_graph_file_name(path: &str) -> bool {
    let Some(file_name) = Path::new(path).file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    matches!(
        file_name,
        "bun.lock" | "bun.lockb" | "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock"
    )
}

fn is_javascript_typescript_watched_event(event: &WorkspaceWatchEvent, path: &str) -> bool {
    event.file_kind == Some(WorkspaceWatchFileKind::Directory)
        || is_javascript_typescript_watched_path(path)
}

fn workspace_watch_id(root_path: &Path) -> String {
    workspace_watch_id_candidates(root_path)
        .into_iter()
        .next()
        .unwrap_or_default()
}

fn remove_workspace_watch_session(
    sessions: &mut HashMap<String, JavaScriptTypeScriptWorkspaceWatchSession>,
    root_path: &str,
) -> Option<JavaScriptTypeScriptWorkspaceWatchSession> {
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
        settle_project_resync, watched_file_changes_for_events, JavaScriptTypeScriptWatchDelivery,
        JavaScriptTypeScriptWatchDeliveryTarget, JavaScriptTypeScriptWatchDispatcher,
        JavaScriptTypeScriptWatchSinkAuthority, JavaScriptTypeScriptWorkspaceWatchRegistry,
        JavaScriptTypeScriptWorkspaceWatchSink,
    };
    use crate::file_watcher::{
        WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchError, WorkspaceWatchEvent,
        WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
        WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
    };
    use crate::lsp_features::WorkspaceFileChangeType;
    use crate::lsp_session::ProjectResyncRequestOutcome;
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Condvar, Mutex,
        },
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    const WORKSPACE_ROOT: &str = "/workspace";

    #[test]
    fn unavailable_resync_rebinds_as_rescan_without_replaying_concrete_changes() {
        let mut delivery = JavaScriptTypeScriptWatchDelivery {
            generation: 1,
            expected_session_id: Some(9),
            changes: vec![crate::lsp_features::WorkspaceFileChange {
                path: "/workspace/src/index.ts".to_string(),
                change_type: WorkspaceFileChangeType::Changed,
            }],
            rescan_required: false,
        };

        assert!(!settle_project_resync(
            Ok(ProjectResyncRequestOutcome::Unavailable),
            &mut delivery,
        ));
        assert_eq!(delivery.expected_session_id, None);
        assert!(delivery.changes.is_empty());
        assert!(delivery.rescan_required);
        assert!(settle_project_resync(
            Ok(ProjectResyncRequestOutcome::SupersededByFreshSession),
            &mut delivery,
        ));
    }

    #[test]
    fn maps_javascript_typescript_file_events_to_lsp_changes() {
        let (changes, rescan_required) = watched_file_changes_for_events(
            WORKSPACE_ROOT,
            &[
                event(WorkspaceWatchEventKind::Created, "/workspace/src/User.ts"),
                event(WorkspaceWatchEventKind::Modified, "/workspace/src/App.tsx"),
                event(WorkspaceWatchEventKind::Deleted, "/workspace/src/old.js"),
                event(WorkspaceWatchEventKind::Modified, "/workspace/package.json"),
            ],
            false,
        );

        assert!(!rescan_required);
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
    fn maps_package_lockfile_events_to_lsp_changes() {
        let (changes, rescan_required) = watched_file_changes_for_events(
            WORKSPACE_ROOT,
            &[
                event(
                    WorkspaceWatchEventKind::Modified,
                    "/workspace/package-lock.json",
                ),
                event(
                    WorkspaceWatchEventKind::Modified,
                    "/workspace/pnpm-lock.yaml",
                ),
                event(WorkspaceWatchEventKind::Modified, "/workspace/yarn.lock"),
                event(WorkspaceWatchEventKind::Modified, "/workspace/bun.lockb"),
            ],
            false,
        );

        assert!(!rescan_required);
        assert_eq!(changes.len(), 4);
        assert_eq!(changes[0].path, "/workspace/package-lock.json");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Changed);
        assert_eq!(changes[1].path, "/workspace/pnpm-lock.yaml");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Changed);
        assert_eq!(changes[2].path, "/workspace/yarn.lock");
        assert_eq!(changes[2].change_type, WorkspaceFileChangeType::Changed);
        assert_eq!(changes[3].path, "/workspace/bun.lockb");
        assert_eq!(changes[3].change_type, WorkspaceFileChangeType::Changed);
    }

    #[test]
    fn maps_renames_to_delete_and_create_changes() {
        let mut rename = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/src/Account.ts",
        );
        rename.previous_path = Some("/workspace/src/User.ts".to_string());

        let (changes, rescan_required) =
            watched_file_changes_for_events(WORKSPACE_ROOT, &[rename], false);

        assert!(!rescan_required);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "/workspace/src/User.ts");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Deleted);
        assert_eq!(changes[1].path, "/workspace/src/Account.ts");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Created);
    }

    #[test]
    fn preserves_concrete_changes_and_marks_an_exact_root_rescan() {
        let mut directory = event(WorkspaceWatchEventKind::Created, "/workspace/src");
        directory.file_kind = Some(WorkspaceWatchFileKind::Directory);

        let (changes, rescan_required) = watched_file_changes_for_events(
            WORKSPACE_ROOT,
            &[
                directory,
                event(WorkspaceWatchEventKind::Modified, "/workspace/src/User.php"),
                root_rescan_event(WORKSPACE_ROOT),
            ],
            false,
        );

        assert!(rescan_required);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "/workspace/src");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Created);
    }

    #[test]
    fn rejects_foreign_rescan_without_losing_valid_concrete_changes() {
        let (changes, rescan_required) = watched_file_changes_for_events(
            WORKSPACE_ROOT,
            &[
                event(
                    WorkspaceWatchEventKind::Created,
                    "/workspace/packages/web/src/new.ts",
                ),
                root_rescan_event("/other-workspace"),
            ],
            false,
        );

        assert!(!rescan_required);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "/workspace/packages/web/src/new.ts");
    }

    #[test]
    fn maps_directory_renames_to_delete_and_create_changes() {
        let mut rename = event(WorkspaceWatchEventKind::Renamed, "/workspace/src/features");
        rename.file_kind = Some(WorkspaceWatchFileKind::Directory);
        rename.previous_path = Some("/workspace/src/components".to_string());

        let (changes, rescan_required) =
            watched_file_changes_for_events(WORKSPACE_ROOT, &[rename], false);

        assert!(!rescan_required);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "/workspace/src/components");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Deleted);
        assert_eq!(changes[1].path, "/workspace/src/features");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Created);
    }

    #[test]
    fn ignores_javascript_typescript_events_outside_workspace_root() {
        let (changes, rescan_required) = watched_file_changes_for_events(
            "/workspace/root",
            &[
                event(
                    WorkspaceWatchEventKind::Created,
                    "/workspace/root2/src/User.ts",
                ),
                event(
                    WorkspaceWatchEventKind::Modified,
                    "/workspace/other/src/App.tsx",
                ),
                event(
                    WorkspaceWatchEventKind::Deleted,
                    "/workspace/root/../root2/src/old.js",
                ),
            ],
            false,
        );

        assert!(!rescan_required);
        assert!(changes.is_empty());
    }

    #[test]
    fn maps_cross_root_renames_to_only_the_in_root_side() {
        let mut outside_to_inside = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/root/src/NewUser.ts",
        );
        outside_to_inside.previous_path = Some("/workspace/root2/src/OldUser.ts".to_string());

        let mut inside_to_outside = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/root2/src/MovedUser.ts",
        );
        inside_to_outside.previous_path = Some("/workspace/root/src/User.ts".to_string());

        let mut outside_to_outside = event(
            WorkspaceWatchEventKind::Renamed,
            "/workspace/root2/src/NewOutside.ts",
        );
        outside_to_outside.previous_path = Some("/workspace/other/src/OldOutside.ts".to_string());

        let (changes, rescan_required) = watched_file_changes_for_events(
            "/workspace/root",
            &[outside_to_inside, inside_to_outside, outside_to_outside],
            false,
        );

        assert!(!rescan_required);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "/workspace/root/src/NewUser.ts");
        assert_eq!(changes[0].change_type, WorkspaceFileChangeType::Created);
        assert_eq!(changes[1].path, "/workspace/root/src/User.ts");
        assert_eq!(changes[1].change_type, WorkspaceFileChangeType::Deleted);
    }

    #[test]
    fn oversized_batch_fails_closed_to_an_authoritative_rescan() {
        let target = RecordingDeliveryTarget::default();
        let authority = Arc::new(JavaScriptTypeScriptWatchSinkAuthority::new(4));
        let sink = watch_sink(WORKSPACE_ROOT, &authority, target.clone());
        let events = (0..=super::MAX_JS_TS_WATCH_BATCH_EVENTS)
            .map(|index| {
                event(
                    WorkspaceWatchEventKind::Modified,
                    &format!("/workspace/packages/app-{index}/src/index.ts"),
                )
            })
            .collect();

        sink.publish(WorkspaceWatchEventBatch { events });

        let deliveries = target.wait_for(1);
        assert_eq!(deliveries.len(), 1);
        assert_eq!(deliveries[0].0, WORKSPACE_ROOT);
        assert_eq!(deliveries[0].1.generation, 4);
        assert!(deliveries[0].1.changes.is_empty());
        assert!(deliveries[0].1.rescan_required);
    }

    #[test]
    fn delivery_worker_retries_until_admission_succeeds() {
        let target = RetryDeliveryTarget::new(2);
        let authority = Arc::new(JavaScriptTypeScriptWatchSinkAuthority::new(5));
        let sink = JavaScriptTypeScriptWorkspaceWatchSink {
            authority: Arc::clone(&authority),
            dispatcher: JavaScriptTypeScriptWatchDispatcher::spawn(
                WORKSPACE_ROOT.to_string(),
                &authority,
                Arc::new(target.clone()),
            ),
            root_path: WORKSPACE_ROOT.to_string(),
        };

        sink.publish(WorkspaceWatchEventBatch {
            events: vec![event(
                WorkspaceWatchEventKind::Modified,
                "/workspace/packages/web/src/index.ts",
            )],
        });

        target.wait_for_success();
        assert_eq!(target.attempts.load(Ordering::Acquire), 3);
    }

    #[test]
    fn stopping_a_watch_does_not_wait_for_a_blocking_delivery_target() {
        let registry = Arc::new(JavaScriptTypeScriptWorkspaceWatchRegistry::new());
        let watcher = RecordingWatcher::default();
        let target = GateBlockingDeliveryTarget::default();
        let root = temp_workspace("watch-blocking-target");
        registry
            .start_with_watcher(&path_string(&root), &watcher, |root_key, authority| {
                Arc::new(JavaScriptTypeScriptWorkspaceWatchSink {
                    dispatcher: JavaScriptTypeScriptWatchDispatcher::spawn(
                        root_key.to_string(),
                        &authority,
                        Arc::new(target.clone()),
                    ),
                    authority,
                    root_path: root_key.to_string(),
                })
            })
            .expect("start watch");
        watcher.sink(0).publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&root))],
        });
        target.wait_until_entered();

        let stop_registry = Arc::clone(&registry);
        let stop_root = root.clone();
        let (stopped_tx, stopped_rx) = std::sync::mpsc::channel();
        let stop_thread = std::thread::spawn(move || {
            stop_registry.stop(&path_string(&stop_root));
            stopped_tx.send(()).expect("stop completion");
        });
        let mut stop_thread = TestThreadJoinGuard::new(stop_thread);
        let release_guard = GateBlockingDeliveryReleaseGuard(target.clone());

        stopped_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("watch stop waited for the independently blocked delivery target");
        stop_thread.join("stop thread");
        release_guard.0.release();
    }

    #[test]
    fn admitted_rescan_drains_queued_rescan_storm_without_restart_loop() {
        let target = BlockingDeliveryTarget::default();
        let authority = Arc::new(JavaScriptTypeScriptWatchSinkAuthority::new(6));
        let dispatcher = JavaScriptTypeScriptWatchDispatcher::spawn(
            WORKSPACE_ROOT.to_string(),
            &authority,
            Arc::new(target.clone()),
        );
        let rescan = || JavaScriptTypeScriptWatchDelivery {
            generation: 6,
            expected_session_id: None,
            changes: Vec::new(),
            rescan_required: true,
        };

        dispatcher.enqueue(rescan());
        target.wait_until_entered();
        for _ in 0..64 {
            dispatcher.enqueue(rescan());
        }
        std::thread::sleep(Duration::from_millis(350));

        assert_eq!(target.attempts(), 1);
        authority.revoke();
    }

    #[test]
    fn watch_registry_rejects_stale_a_b_a_sink_and_preserves_exact_root() {
        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let target = RecordingDeliveryTarget::default();
        let root_a = temp_workspace("watch-a-b-a");
        let root_b = temp_workspace("watch-a-b-a-sibling");

        registry
            .start_with_watcher(&path_string(&root_a), &watcher, |root_key, authority| {
                Arc::new(watch_sink(root_key, &authority, target.clone()))
            })
            .expect("start A watch");
        registry
            .start_with_watcher(&path_string(&root_b), &watcher, |root_key, authority| {
                Arc::new(watch_sink(root_key, &authority, target.clone()))
            })
            .expect("start B watch");
        registry.stop(&path_string(&root_a));
        registry
            .start_with_watcher(&path_string(&root_a), &watcher, |root_key, authority| {
                Arc::new(watch_sink(root_key, &authority, target.clone()))
            })
            .expect("restart A watch");

        let stale_a = watcher.sink(0);
        let current_b = watcher.sink(1);
        let current_a = watcher.sink(2);
        stale_a.publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&root_a))],
        });
        current_b.publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&root_b))],
        });
        current_a.publish(WorkspaceWatchEventBatch {
            events: vec![root_rescan_event(&path_string(&root_a))],
        });

        let deliveries = target.wait_for(2);
        assert_eq!(deliveries.len(), 2);
        assert!(deliveries
            .iter()
            .any(|(root, delivery)| root == &path_string(&root_b) && delivery.generation == 2));
        assert!(deliveries
            .iter()
            .any(|(root, delivery)| root == &path_string(&root_a) && delivery.generation == 3));
        assert!(deliveries
            .iter()
            .all(|(_, delivery)| delivery.rescan_required));
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
    fn watch_registry_stop_then_start_replaces_requested_root_only() {
        let registry = JavaScriptTypeScriptWorkspaceWatchRegistry::new();
        let watcher = RecordingWatcher::default();
        let root_a = temp_workspace("watch-stop-restart-a");
        let root_b = temp_workspace("watch-stop-restart-b");

        start_with_watcher(&registry, &root_a, &watcher);
        start_with_watcher(&registry, &root_b, &watcher);

        registry.stop(&path_string(&root_a));
        start_with_watcher(&registry, &root_a, &watcher);

        assert_eq!(
            watcher.started_roots(),
            vec![root_a.clone(), root_b.clone(), root_a.clone()]
        );
        assert_eq!(watcher.stopped_roots(), vec![root_a.clone()]);

        registry.stop_all();

        let stopped = watcher.stopped_roots();
        assert_eq!(stopped.iter().filter(|root| *root == &root_a).count(), 2);
        assert_eq!(stopped.iter().filter(|root| *root == &root_b).count(), 1);
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
        registry: &JavaScriptTypeScriptWorkspaceWatchRegistry,
        root: &Path,
        watcher: &RecordingWatcher,
    ) {
        registry
            .start_with_watcher(&path_string(root), watcher, |_, _| {
                Arc::new(NoopWatchSink) as Arc<dyn WorkspaceWatchEventSink>
            })
            .expect("start workspace watch");
    }

    fn watch_sink(
        root_path: &str,
        authority: &Arc<JavaScriptTypeScriptWatchSinkAuthority>,
        target: RecordingDeliveryTarget,
    ) -> JavaScriptTypeScriptWorkspaceWatchSink {
        JavaScriptTypeScriptWorkspaceWatchSink {
            authority: Arc::clone(authority),
            dispatcher: JavaScriptTypeScriptWatchDispatcher::spawn(
                root_path.to_string(),
                authority,
                Arc::new(target),
            ),
            root_path: root_path.to_string(),
        }
    }

    type RecordedDelivery = (String, JavaScriptTypeScriptWatchDelivery);

    #[derive(Clone, Default)]
    struct RecordingDeliveryTarget {
        deliveries: Arc<Mutex<Vec<RecordedDelivery>>>,
    }

    impl RecordingDeliveryTarget {
        fn wait_for(&self, count: usize) -> Vec<RecordedDelivery> {
            for _ in 0..100 {
                let deliveries = self.deliveries.lock().expect("deliveries").clone();
                if deliveries.len() >= count {
                    return deliveries;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            self.deliveries.lock().expect("deliveries").clone()
        }
    }

    impl JavaScriptTypeScriptWatchDeliveryTarget for RecordingDeliveryTarget {
        fn deliver(
            &self,
            root_path: &str,
            delivery: &mut JavaScriptTypeScriptWatchDelivery,
        ) -> bool {
            self.deliveries
                .lock()
                .expect("deliveries")
                .push((root_path.to_string(), delivery.clone()));
            true
        }
    }

    #[derive(Clone)]
    struct RetryDeliveryTarget {
        failures_remaining: Arc<AtomicUsize>,
        attempts: Arc<AtomicUsize>,
        succeeded: Arc<AtomicBool>,
    }

    impl RetryDeliveryTarget {
        fn new(failures: usize) -> Self {
            Self {
                failures_remaining: Arc::new(AtomicUsize::new(failures)),
                attempts: Arc::new(AtomicUsize::new(0)),
                succeeded: Arc::new(AtomicBool::new(false)),
            }
        }

        fn wait_for_success(&self) {
            for _ in 0..100 {
                if self.succeeded.load(Ordering::Acquire) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            panic!("delivery was not admitted");
        }
    }

    impl JavaScriptTypeScriptWatchDeliveryTarget for RetryDeliveryTarget {
        fn deliver(
            &self,
            _root_path: &str,
            _delivery: &mut JavaScriptTypeScriptWatchDelivery,
        ) -> bool {
            self.attempts.fetch_add(1, Ordering::AcqRel);
            if self
                .failures_remaining
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                return false;
            }
            self.succeeded.store(true, Ordering::Release);
            true
        }
    }

    #[derive(Clone, Default)]
    struct BlockingDeliveryTarget {
        entered: Arc<AtomicBool>,
        attempts: Arc<AtomicUsize>,
    }

    impl BlockingDeliveryTarget {
        fn wait_until_entered(&self) {
            for _ in 0..100 {
                if self.entered.load(Ordering::Acquire) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            panic!("blocking target was not entered");
        }

        fn attempts(&self) -> usize {
            self.attempts.load(Ordering::Acquire)
        }
    }

    #[derive(Default)]
    struct GateBlockingDeliveryState {
        entered: bool,
        released: bool,
    }

    #[derive(Clone, Default)]
    struct GateBlockingDeliveryTarget {
        state: Arc<(Mutex<GateBlockingDeliveryState>, Condvar)>,
    }

    struct GateBlockingDeliveryReleaseGuard(GateBlockingDeliveryTarget);

    impl Drop for GateBlockingDeliveryReleaseGuard {
        fn drop(&mut self) {
            self.0.release();
        }
    }

    struct TestThreadJoinGuard(Option<std::thread::JoinHandle<()>>);

    impl TestThreadJoinGuard {
        fn new(thread: std::thread::JoinHandle<()>) -> Self {
            Self(Some(thread))
        }

        fn join(&mut self, label: &str) {
            if let Some(thread) = self.0.take() {
                thread.join().unwrap_or_else(|_| panic!("{label} panicked"));
            }
        }
    }

    impl Drop for TestThreadJoinGuard {
        fn drop(&mut self) {
            if let Some(thread) = self.0.take() {
                let _ = thread.join();
            }
        }
    }

    impl GateBlockingDeliveryTarget {
        fn wait_until_entered(&self) {
            let (lock, gate) = &*self.state;
            let state = lock.lock().expect("blocking target state");
            let (state, _timeout) = gate
                .wait_timeout_while(state, Duration::from_secs(5), |state| !state.entered)
                .expect("blocking target entered gate");
            assert!(state.entered, "blocking target was not entered");
        }

        fn release(&self) {
            let (lock, gate) = &*self.state;
            {
                let mut state = lock.lock().expect("blocking target state");
                state.released = true;
            }
            gate.notify_all();
        }
    }

    impl JavaScriptTypeScriptWatchDeliveryTarget for GateBlockingDeliveryTarget {
        fn deliver(
            &self,
            _root_path: &str,
            _delivery: &mut JavaScriptTypeScriptWatchDelivery,
        ) -> bool {
            let (lock, gate) = &*self.state;
            let mut state = lock.lock().expect("blocking target state");
            state.entered = true;
            gate.notify_all();
            let _state = gate
                .wait_while(state, |state| !state.released)
                .expect("blocking target release gate");
            true
        }
    }

    impl JavaScriptTypeScriptWatchDeliveryTarget for BlockingDeliveryTarget {
        fn deliver(
            &self,
            _root_path: &str,
            _delivery: &mut JavaScriptTypeScriptWatchDelivery,
        ) -> bool {
            self.attempts.fetch_add(1, Ordering::AcqRel);
            self.entered.store(true, Ordering::Release);
            std::thread::sleep(Duration::from_millis(250));
            true
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
