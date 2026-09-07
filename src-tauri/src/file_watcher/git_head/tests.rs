use super::*;
use crate::file_watcher::{
    GitAwareNativeWorkspaceFileWatcher, WorkspaceFileWatcher, WorkspaceWatchError,
    WorkspaceWatchEventBatch, WorkspaceWatchEventSink, WorkspaceWatchRequest,
};
use std::io;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        for _ in 0..128 {
            let path = std::env::temp_dir().join(format!(
                "codevo-head-watch-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self(path.canonicalize().unwrap()),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{error}"),
            }
        }
        panic!("Could not reserve a fresh metadata watcher fixture.");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn nested_head_and_linked_head_are_root_rescans_without_metadata_paths() {
    let fixture = Fixture::new();
    let watch = GitHeadWatch::discover(&fixture.0);
    for relative in [
        ".git/HEAD",
        "product/.git/HEAD",
        "product/.git/worktrees/feature/HEAD",
        "new/.git",
    ] {
        let event = watch
            .rescan_for_paths(&fixture.0, &[fixture.0.join(relative)])
            .unwrap();
        assert_eq!(event.kind, WorkspaceWatchEventKind::RescanRequired);
        assert_eq!(event.path, fixture.0.to_str().unwrap());
        assert_eq!(event.root_path, event.path);
        assert!(event.relative_path.is_empty());
    }
    for relative in [
        "HEAD",
        ".git/config",
        ".git/HEAD.lock",
        "src/file.ts",
        "../other/.git/HEAD",
    ] {
        assert!(watch
            .rescan_for_paths(&fixture.0, &[fixture.0.join(relative)])
            .is_none());
    }
}

#[test]
fn linked_pointer_resolves_external_directory_and_only_its_head() {
    let fixture = Fixture::new();
    let root = fixture.0.join("workspace");
    let repo = root.join("product");
    let metadata = fixture.0.join("metadata");
    fs::create_dir_all(&repo).unwrap();
    fs::create_dir(&metadata).unwrap();
    fs::write(repo.join(".git"), "gitdir: ../../metadata\n").unwrap();
    let watch = GitHeadWatch::discover(&root);
    assert_eq!(
        watch.external_directories().collect::<Vec<_>>(),
        vec![&metadata]
    );
    assert!(watch
        .rescan_for_paths(&root, &[metadata.join("HEAD")])
        .is_some());
    assert!(watch
        .rescan_for_paths(&root, &[fixture.0.join("foreign/HEAD")])
        .is_none());
    assert!(watch
        .rescan_for_paths(&root, &[metadata.join("config")])
        .is_none());
}

#[test]
fn oversized_pointer_and_symlinked_repository_are_not_followed() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join(".git"),
        vec![b'x'; MAX_POINTER_BYTES as usize + 1],
    )
    .unwrap();
    assert!(linked_git_dir(&fixture.0).is_none());
    #[cfg(unix)]
    {
        let external = Fixture::new();
        fs::create_dir(external.0.join("repo")).unwrap();
        std::os::unix::fs::symlink(external.0.join("repo"), fixture.0.join("alias")).unwrap();
        assert_eq!(GitHeadWatch::discover(&fixture.0).external.len(), 0);
    }
}

#[derive(Default)]
struct RecordingSink(Mutex<Vec<WorkspaceWatchEventBatch>>);
impl WorkspaceWatchEventSink for RecordingSink {
    fn error(&self, _error: WorkspaceWatchError) {}
    fn publish(&self, batch: WorkspaceWatchEventBatch) {
        self.0.lock().unwrap().push(batch);
    }
}

#[test]
fn native_watcher_catches_atomic_external_linked_head_replacement() {
    let fixture = Fixture::new();
    let root = fixture.0.join("workspace");
    let repo = root.join("product");
    let metadata = fixture.0.join("metadata");
    fs::create_dir_all(&repo).unwrap();
    fs::create_dir(&metadata).unwrap();
    fs::write(repo.join(".git"), "gitdir: ../../metadata\n").unwrap();
    fs::write(metadata.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let sink = Arc::new(RecordingSink::default());
    let session = GitAwareNativeWorkspaceFileWatcher
        .watch(WorkspaceWatchRequest::new(root.clone()), sink.clone())
        .unwrap();
    wait_for_rescan(&sink, &root);
    sink.0.lock().unwrap().clear();
    fs::write(metadata.join("HEAD.lock"), "ref: refs/heads/feature\n").unwrap();
    fs::rename(metadata.join("HEAD.lock"), metadata.join("HEAD")).unwrap();
    wait_for_rescan(&sink, &root);
    drop(session);
}

fn wait_for_rescan(sink: &RecordingSink, root: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if sink
            .0
            .lock()
            .unwrap()
            .iter()
            .flat_map(|batch| &batch.events)
            .any(|event| {
                event.kind == WorkspaceWatchEventKind::RescanRequired
                    && event.root_path == root.to_str().unwrap()
            })
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "HEAD did not trigger a root rescan"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn discovery_exhaustion_keeps_direct_root_metadata_and_reports_partial_support() {
    let fixture = Fixture::new();
    let root = fixture.0.join("workspace");
    let metadata = fixture.0.join("metadata");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&metadata).unwrap();
    fs::write(root.join(".git"), "gitdir: ../metadata\n").unwrap();
    for i in 0..=MAX_ENTRIES {
        fs::write(root.join(format!("file-{i}")), "").unwrap();
    }
    let watch = GitHeadWatch::discover(&root);
    assert!(watch.warning.is_some());
    assert!(watch.external.contains(&metadata));
    let sink = Arc::new(RecordingSink::default());
    let session = GitAwareNativeWorkspaceFileWatcher
        .watch(WorkspaceWatchRequest::new(root.clone()), sink)
        .unwrap();
    drop(session);
}

#[test]
fn pointer_created_after_start_installs_external_head_watch_and_replacement_removes_old_target() {
    use notify::Watcher;
    let fixture = Fixture::new();
    let root = fixture.0.join("workspace");
    let metadata = fixture.0.join("metadata");
    let replacement = fixture.0.join("replacement");
    for path in [&root, &metadata, &replacement] {
        fs::create_dir(path).unwrap();
    }
    let (events, receiver) = GitHeadWatchEvents::new();
    let events = Arc::new(events);
    let callback_events = Arc::clone(&events);
    let callback_root = root.clone();
    let sink = Arc::new(RecordingSink::default());
    let callback_sink = Arc::clone(&sink);
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            if !matches!(event.kind, notify::EventKind::Access(_)) {
                if let Some(event) = callback_events.rescan_for_paths(&callback_root, &event.paths)
                {
                    callback_sink.publish(WorkspaceWatchEventBatch {
                        events: vec![event],
                    });
                }
            }
        }
    })
    .unwrap();
    watcher
        .watch(&root, notify::RecursiveMode::Recursive)
        .unwrap();
    let watcher = Arc::new(Mutex::new(watcher));
    let session = events
        .start(root.clone(), Arc::clone(&watcher), receiver, sink.clone())
        .unwrap();
    wait_for_rescan(&sink, &root);
    fs::write(root.join(".git"), "gitdir: ../metadata\n").unwrap();
    wait_for(|| events.monitors(&metadata));
    sink.0.lock().unwrap().clear();
    fs::write(metadata.join("HEAD"), "ref: refs/heads/feature\n").unwrap();
    wait_for_rescan(&sink, &root);
    fs::write(root.join(".git"), "gitdir: ../replacement\n").unwrap();
    wait_for(|| events.monitors(&replacement) && !events.monitors(&metadata));
    sink.0.lock().unwrap().clear();
    fs::write(replacement.join("HEAD"), "ref: refs/heads/other\n").unwrap();
    wait_for_rescan(&sink, &root);
    drop(session);
    drop(watcher);
}

fn wait_for(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "metadata watch target did not settle"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}
