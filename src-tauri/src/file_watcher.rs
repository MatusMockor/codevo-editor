use crate::ignore_matcher::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher};
use notify::{
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    Event as NotifyEvent, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceWatchBackend {
    Native,
    Watchman,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceWatchEventKind {
    Created,
    Deleted,
    Modified,
    Renamed,
    RescanRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceWatchFileKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWatchEvent {
    pub backend: WorkspaceWatchBackend,
    pub file_kind: Option<WorkspaceWatchFileKind>,
    pub kind: WorkspaceWatchEventKind,
    pub path: String,
    pub previous_path: Option<String>,
    pub previous_relative_path: Option<String>,
    pub relative_path: String,
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceWatchError {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceWatchEventBatch {
    pub events: Vec<WorkspaceWatchEvent>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceWatchRequest {
    pub root_path: PathBuf,
}

impl WorkspaceWatchRequest {
    pub fn new(root_path: PathBuf) -> Self {
        Self { root_path }
    }
}

pub trait WorkspaceWatchEventSink: Send + Sync {
    fn error(&self, error: WorkspaceWatchError);
    fn publish(&self, batch: WorkspaceWatchEventBatch);
}

pub trait WorkspaceWatchSession: Send {
    fn stop(&mut self) {}
}

pub trait WorkspaceFileWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>>;
}

pub trait WatchmanAvailability {
    fn is_available(&self) -> bool;
}

pub struct CommandWatchmanAvailability;

impl WatchmanAvailability for CommandWatchmanAvailability {
    fn is_available(&self) -> bool {
        match Command::new("watchman").arg("--version").output() {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }
}

pub struct PreferredWorkspaceFileWatcher<W, N, A> {
    native: N,
    watchman: W,
    watchman_availability: A,
}

impl<W, N, A> PreferredWorkspaceFileWatcher<W, N, A> {
    pub fn new(watchman: W, native: N, watchman_availability: A) -> Self {
        Self {
            native,
            watchman,
            watchman_availability,
        }
    }
}

impl<W, N, A> WorkspaceFileWatcher for PreferredWorkspaceFileWatcher<W, N, A>
where
    W: WorkspaceFileWatcher,
    N: WorkspaceFileWatcher,
    A: WatchmanAvailability,
{
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        if self.watchman_availability.is_available() {
            if let Ok(session) = self.watchman.watch(request.clone(), Arc::clone(&sink)) {
                return Ok(session);
            }
        }

        self.native.watch(request, sink)
    }
}

pub struct NativeNotifyWorkspaceFileWatcher;

pub struct NotifyWorkspaceWatchSession {
    _watcher: RecommendedWatcher,
}

impl WorkspaceWatchSession for NotifyWorkspaceWatchSession {}

impl WorkspaceFileWatcher for NativeNotifyWorkspaceFileWatcher {
    fn watch(
        &self,
        request: WorkspaceWatchRequest,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        let root = request.root_path.canonicalize()?;
        let matcher = Arc::new(GitignoreWorkspaceIgnoreMatcher::load(&root)?);
        let event_root = root.clone();
        let event_sink = Arc::clone(&sink);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<NotifyEvent>| match result {
                Ok(event) => {
                    let events = normalize_notify_event(&event_root, &event, matcher.as_ref());

                    if events.is_empty() {
                        return;
                    }

                    event_sink.publish(WorkspaceWatchEventBatch { events });
                }
                Err(error) => event_sink.error(WorkspaceWatchError {
                    message: error.to_string(),
                }),
            })
            .map_err(to_io_error)?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(to_io_error)?;

        Ok(Box::new(NotifyWorkspaceWatchSession { _watcher: watcher }))
    }
}

pub struct WatchmanWorkspaceFileWatcher;

impl WorkspaceFileWatcher for WatchmanWorkspaceFileWatcher {
    fn watch(
        &self,
        _request: WorkspaceWatchRequest,
        _sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Watchman subscriptions are not implemented yet.",
        ))
    }
}

pub fn normalize_notify_event(
    root: &Path,
    event: &NotifyEvent,
    matcher: &dyn WorkspaceIgnoreMatcher,
) -> Vec<WorkspaceWatchEvent> {
    let file_kind = notify_event_file_kind(&event.kind);

    match &event.kind {
        EventKind::Create(_) => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Created,
            file_kind,
            true,
            matcher,
        ),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => normalize_rename_paths(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            file_kind,
            matcher,
        ),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Deleted,
            file_kind,
            false,
            matcher,
        ),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Created,
            file_kind,
            true,
            matcher,
        ),
        EventKind::Modify(_) => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Modified,
            file_kind,
            true,
            matcher,
        ),
        EventKind::Remove(_) => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Deleted,
            file_kind,
            false,
            matcher,
        ),
        EventKind::Any => normalize_each_path(
            root,
            WorkspaceWatchBackend::Native,
            &event.paths,
            WorkspaceWatchEventKind::Modified,
            file_kind,
            true,
            matcher,
        ),
        EventKind::Access(_) | EventKind::Other => Vec::new(),
    }
}

pub fn parse_watchman_subscription(
    root: &Path,
    payload: &Value,
    matcher: &dyn WorkspaceIgnoreMatcher,
) -> io::Result<Vec<WorkspaceWatchEvent>> {
    if watchman_requires_rescan(payload) {
        return Ok(vec![rescan_event(root, WorkspaceWatchBackend::Watchman)]);
    }

    let files = payload
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Missing Watchman files."))?;
    let mut events = Vec::new();

    for file in files {
        let name = match file.get("name").and_then(Value::as_str) {
            Some(name) => name,
            None => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Watchman file entry is missing a name.",
                ));
            }
        };
        let exists = file.get("exists").and_then(Value::as_bool).unwrap_or(true);
        let is_new = file.get("new").and_then(Value::as_bool).unwrap_or(false);
        let file_kind = watchman_file_kind(file);
        let path = root.join(name);
        let is_directory = file_kind == Some(WorkspaceWatchFileKind::Directory);

        if matcher.is_ignored(&path, is_directory) {
            continue;
        }

        events.push(workspace_event(
            root,
            WorkspaceWatchBackend::Watchman,
            watchman_event_kind(exists, is_new),
            &path,
            None,
            file_kind,
        ));
    }

    Ok(events)
}

fn normalize_each_path(
    root: &Path,
    backend: WorkspaceWatchBackend,
    paths: &[PathBuf],
    kind: WorkspaceWatchEventKind,
    file_kind_hint: Option<WorkspaceWatchFileKind>,
    probe_file_system: bool,
    matcher: &dyn WorkspaceIgnoreMatcher,
) -> Vec<WorkspaceWatchEvent> {
    let mut events = Vec::new();

    for path in paths {
        let file_kind = effective_file_kind(path, file_kind_hint, probe_file_system);
        let is_directory = file_kind == Some(WorkspaceWatchFileKind::Directory);

        if matcher.is_ignored(path, is_directory) {
            continue;
        }

        events.push(workspace_event(root, backend, kind, path, None, file_kind));
    }

    events
}

fn normalize_rename_paths(
    root: &Path,
    backend: WorkspaceWatchBackend,
    paths: &[PathBuf],
    file_kind_hint: Option<WorkspaceWatchFileKind>,
    matcher: &dyn WorkspaceIgnoreMatcher,
) -> Vec<WorkspaceWatchEvent> {
    if paths.len() < 2 {
        return normalize_each_path(
            root,
            backend,
            paths,
            WorkspaceWatchEventKind::Modified,
            file_kind_hint,
            true,
            matcher,
        );
    }

    let previous_path = &paths[0];
    let path = &paths[1];
    let current_file_kind = effective_file_kind(path, file_kind_hint, true);
    let previous_file_kind = current_file_kind.or(file_kind_hint);
    let previous_is_directory = previous_file_kind == Some(WorkspaceWatchFileKind::Directory);
    let current_is_directory = current_file_kind == Some(WorkspaceWatchFileKind::Directory);
    let previous_ignored = matcher.is_ignored(previous_path, previous_is_directory);
    let current_ignored = matcher.is_ignored(path, current_is_directory);

    if previous_ignored && current_ignored {
        return Vec::new();
    }

    if previous_ignored {
        return vec![workspace_event(
            root,
            backend,
            WorkspaceWatchEventKind::Created,
            path,
            None,
            current_file_kind,
        )];
    }

    if current_ignored {
        return vec![workspace_event(
            root,
            backend,
            WorkspaceWatchEventKind::Deleted,
            previous_path,
            None,
            previous_file_kind,
        )];
    }

    vec![workspace_event(
        root,
        backend,
        WorkspaceWatchEventKind::Renamed,
        path,
        Some(previous_path),
        current_file_kind,
    )]
}

fn notify_event_file_kind(kind: &EventKind) -> Option<WorkspaceWatchFileKind> {
    match kind {
        EventKind::Create(CreateKind::File) | EventKind::Remove(RemoveKind::File) => {
            Some(WorkspaceWatchFileKind::File)
        }
        EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder) => {
            Some(WorkspaceWatchFileKind::Directory)
        }
        _ => None,
    }
}

fn effective_file_kind(
    path: &Path,
    file_kind_hint: Option<WorkspaceWatchFileKind>,
    probe_file_system: bool,
) -> Option<WorkspaceWatchFileKind> {
    if file_kind_hint.is_some() {
        return file_kind_hint;
    }

    if !probe_file_system {
        return None;
    }

    file_kind(path)
}

fn workspace_event(
    root: &Path,
    backend: WorkspaceWatchBackend,
    kind: WorkspaceWatchEventKind,
    path: &Path,
    previous_path: Option<&Path>,
    file_kind: Option<WorkspaceWatchFileKind>,
) -> WorkspaceWatchEvent {
    WorkspaceWatchEvent {
        backend,
        file_kind,
        kind,
        path: watch_path(path),
        previous_path: previous_path.map(watch_path),
        previous_relative_path: previous_path.map(|path| relative_path(root, path)),
        relative_path: relative_path(root, path),
        root_path: watch_path(root),
    }
}

fn rescan_event(root: &Path, backend: WorkspaceWatchBackend) -> WorkspaceWatchEvent {
    workspace_event(
        root,
        backend,
        WorkspaceWatchEventKind::RescanRequired,
        root,
        None,
        Some(WorkspaceWatchFileKind::Directory),
    )
}

fn watchman_requires_rescan(payload: &Value) -> bool {
    if payload
        .get("is_fresh_instance")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }

    payload.get("recrawl").is_some()
}

fn watchman_event_kind(exists: bool, is_new: bool) -> WorkspaceWatchEventKind {
    if !exists {
        return WorkspaceWatchEventKind::Deleted;
    }

    if is_new {
        return WorkspaceWatchEventKind::Created;
    }

    WorkspaceWatchEventKind::Modified
}

fn watchman_file_kind(file: &Value) -> Option<WorkspaceWatchFileKind> {
    match file.get("type").and_then(Value::as_str) {
        Some("d") => Some(WorkspaceWatchFileKind::Directory),
        Some("f") => Some(WorkspaceWatchFileKind::File),
        _ => None,
    }
}

fn file_kind(path: &Path) -> Option<WorkspaceWatchFileKind> {
    if path.is_dir() {
        return Some(WorkspaceWatchFileKind::Directory);
    }

    if path.is_file() {
        return Some(WorkspaceWatchFileKind::File);
    }

    None
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn watch_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn to_io_error(error: notify::Error) -> io::Error {
    io::Error::new(io::ErrorKind::Other, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_notify_event, parse_watchman_subscription, PreferredWorkspaceFileWatcher,
        WatchmanAvailability, WorkspaceFileWatcher, WorkspaceWatchBackend, WorkspaceWatchEvent,
        WorkspaceWatchEventBatch, WorkspaceWatchEventKind, WorkspaceWatchEventSink,
        WorkspaceWatchFileKind, WorkspaceWatchRequest, WorkspaceWatchSession,
    };
    use crate::ignore_matcher::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreOptions};
    use notify::{
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
        Event as NotifyEvent, EventKind,
    };
    use serde_json::json;
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn notify_create_modify_and_remove_events_are_normalized() {
        let root = temp_workspace("notify-basic");
        let file = root.join("src/User.php");
        fs::create_dir_all(file.parent().expect("file parent")).expect("src directory");
        fs::write(&file, "<?php").expect("source file");
        let matcher = matcher_without_defaults(&root);

        let created = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Create(CreateKind::File)).add_path(file.clone()),
            &matcher,
        );
        let modified = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content,
            )))
            .add_path(file.clone()),
            &matcher,
        );
        let removed = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Remove(RemoveKind::File)).add_path(file.clone()),
            &matcher,
        );

        assert_eq!(created[0].kind, WorkspaceWatchEventKind::Created);
        assert_eq!(created[0].backend, WorkspaceWatchBackend::Native);
        assert_eq!(created[0].relative_path, "src/User.php");
        assert_eq!(created[0].file_kind, Some(WorkspaceWatchFileKind::File));
        assert_eq!(modified[0].kind, WorkspaceWatchEventKind::Modified);
        assert_eq!(removed[0].kind, WorkspaceWatchEventKind::Deleted);
    }

    #[test]
    fn notify_rename_events_preserve_previous_path() {
        let root = temp_workspace("notify-rename");
        let previous = root.join("src/Old.php");
        let current = root.join("src/New.php");
        fs::create_dir_all(current.parent().expect("file parent")).expect("src directory");
        fs::write(&current, "<?php").expect("source file");
        let matcher = matcher_without_defaults(&root);

        let events = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(previous.clone())
                .add_path(current.clone()),
            &matcher,
        );

        assert_eq!(
            events,
            vec![WorkspaceWatchEvent {
                backend: WorkspaceWatchBackend::Native,
                file_kind: Some(WorkspaceWatchFileKind::File),
                kind: WorkspaceWatchEventKind::Renamed,
                path: path_string(&current),
                previous_path: Some(path_string(&previous)),
                previous_relative_path: Some("src/Old.php".to_string()),
                relative_path: "src/New.php".to_string(),
                root_path: path_string(&root),
            }]
        );
    }

    #[test]
    fn ignored_notify_events_are_dropped() {
        let root = temp_workspace("notify-ignore");
        fs::write(root.join(".gitignore"), "generated/\n").expect("gitignore");
        fs::create_dir_all(root.join("generated")).expect("generated directory");
        fs::write(root.join("generated/User.php"), "<?php").expect("generated file");
        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        let events = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Create(CreateKind::File))
                .add_path(root.join("generated/User.php")),
            &matcher,
        );

        assert!(events.is_empty());
    }

    #[test]
    fn removed_directory_events_use_event_kind_for_ignore_matching() {
        let root = temp_workspace("notify-removed-directory");
        fs::write(root.join(".gitignore"), "generated/\n").expect("gitignore");
        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        let events = normalize_notify_event(
            &root,
            &NotifyEvent::new(EventKind::Remove(RemoveKind::Folder))
                .add_path(root.join("generated")),
            &matcher,
        );

        assert!(events.is_empty());
    }

    #[test]
    fn watchman_subscription_changes_are_normalized() {
        let root = temp_workspace("watchman-basic");
        let matcher = matcher_without_defaults(&root);
        let payload = json!({
            "files": [
                { "name": "src/New.php", "exists": true, "new": true, "type": "f" },
                { "name": "src/Changed.php", "exists": true, "new": false, "type": "f" },
                { "name": "src/Deleted.php", "exists": false, "type": "f" }
            ]
        });

        let events =
            parse_watchman_subscription(&root, &payload, &matcher).expect("watchman events");

        assert_eq!(
            events.iter().map(|event| event.kind).collect::<Vec<_>>(),
            vec![
                WorkspaceWatchEventKind::Created,
                WorkspaceWatchEventKind::Modified,
                WorkspaceWatchEventKind::Deleted,
            ]
        );
        assert_eq!(events[0].backend, WorkspaceWatchBackend::Watchman);
        assert_eq!(events[0].relative_path, "src/New.php");
        assert_eq!(events[0].file_kind, Some(WorkspaceWatchFileKind::File));
    }

    #[test]
    fn watchman_subscription_can_request_rescan() {
        let root = temp_workspace("watchman-rescan");
        let matcher = matcher_without_defaults(&root);
        let payload = json!({ "is_fresh_instance": true });

        let events =
            parse_watchman_subscription(&root, &payload, &matcher).expect("watchman events");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(events[0].backend, WorkspaceWatchBackend::Watchman);
        assert_eq!(events[0].relative_path, "");
    }

    #[test]
    fn watchman_subscription_applies_ignore_matcher() {
        let root = temp_workspace("watchman-ignore");
        fs::write(root.join(".gitignore"), "generated/\n").expect("gitignore");
        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");
        let payload = json!({
            "files": [
                { "name": "src/User.php", "exists": true, "new": true, "type": "f" },
                { "name": "generated/User.php", "exists": true, "new": true, "type": "f" }
            ]
        });

        let events =
            parse_watchman_subscription(&root, &payload, &matcher).expect("watchman events");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].relative_path, "src/User.php");
    }

    #[test]
    fn preferred_watcher_uses_watchman_when_available() {
        let root = temp_workspace("preferred-watchman");
        let batches = Arc::new(Mutex::new(Vec::new()));
        let sink: Arc<dyn WorkspaceWatchEventSink> = Arc::new(RecordingSink {
            batches: Arc::clone(&batches),
        });
        let watcher = PreferredWorkspaceFileWatcher::new(
            PublishingWatcher {
                backend: WorkspaceWatchBackend::Watchman,
            },
            PublishingWatcher {
                backend: WorkspaceWatchBackend::Native,
            },
            StaticAvailability(true),
        );

        let _session = watcher
            .watch(WorkspaceWatchRequest::new(root), sink)
            .expect("watch session");

        assert_eq!(
            batches.lock().expect("batches")[0].events[0].backend,
            WorkspaceWatchBackend::Watchman
        );
    }

    #[test]
    fn preferred_watcher_falls_back_to_native() {
        let root = temp_workspace("preferred-native");
        let batches = Arc::new(Mutex::new(Vec::new()));
        let sink: Arc<dyn WorkspaceWatchEventSink> = Arc::new(RecordingSink {
            batches: Arc::clone(&batches),
        });
        let watcher = PreferredWorkspaceFileWatcher::new(
            PublishingWatcher {
                backend: WorkspaceWatchBackend::Watchman,
            },
            PublishingWatcher {
                backend: WorkspaceWatchBackend::Native,
            },
            StaticAvailability(false),
        );

        let _session = watcher
            .watch(WorkspaceWatchRequest::new(root), sink)
            .expect("watch session");

        assert_eq!(
            batches.lock().expect("batches")[0].events[0].backend,
            WorkspaceWatchBackend::Native
        );
    }

    struct FakeSession;

    impl WorkspaceWatchSession for FakeSession {}

    struct PublishingWatcher {
        backend: WorkspaceWatchBackend,
    }

    impl WorkspaceFileWatcher for PublishingWatcher {
        fn watch(
            &self,
            request: WorkspaceWatchRequest,
            sink: Arc<dyn WorkspaceWatchEventSink>,
        ) -> io::Result<Box<dyn WorkspaceWatchSession>> {
            sink.publish(WorkspaceWatchEventBatch {
                events: vec![WorkspaceWatchEvent {
                    backend: self.backend,
                    file_kind: Some(WorkspaceWatchFileKind::Directory),
                    kind: WorkspaceWatchEventKind::RescanRequired,
                    path: path_string(&request.root_path),
                    previous_path: None,
                    previous_relative_path: None,
                    relative_path: String::new(),
                    root_path: path_string(&request.root_path),
                }],
            });

            Ok(Box::new(FakeSession))
        }
    }

    struct StaticAvailability(bool);

    impl WatchmanAvailability for StaticAvailability {
        fn is_available(&self) -> bool {
            self.0
        }
    }

    struct RecordingSink {
        batches: Arc<Mutex<Vec<WorkspaceWatchEventBatch>>>,
    }

    impl WorkspaceWatchEventSink for RecordingSink {
        fn error(&self, _error: super::WorkspaceWatchError) {}

        fn publish(&self, batch: WorkspaceWatchEventBatch) {
            self.batches.lock().expect("batches").push(batch);
        }
    }

    fn matcher_without_defaults(root: &Path) -> GitignoreWorkspaceIgnoreMatcher {
        GitignoreWorkspaceIgnoreMatcher::load_with_options(
            root,
            WorkspaceIgnoreOptions::new(Vec::new()),
        )
        .expect("matcher")
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-watch-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
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
