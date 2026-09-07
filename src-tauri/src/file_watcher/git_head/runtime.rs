use super::GitHeadWatch;
use crate::file_watcher::{
    WorkspaceWatchError, WorkspaceWatchEvent, WorkspaceWatchEventBatch, WorkspaceWatchEventSink,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeSet,
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

pub(crate) struct GitHeadWatchEvents {
    state: Arc<Mutex<GitHeadWatch>>,
    refresh: mpsc::SyncSender<()>,
}

impl GitHeadWatchEvents {
    #[cfg(test)]
    pub(super) fn monitors(&self, directory: &Path) -> bool {
        self.state.lock().unwrap().external.contains(directory)
    }

    pub(crate) fn new() -> (Self, mpsc::Receiver<()>) {
        let (refresh, receiver) = mpsc::sync_channel(1);
        (
            Self {
                state: Arc::new(Mutex::new(GitHeadWatch::default())),
                refresh,
            },
            receiver,
        )
    }

    pub(crate) fn rescan_for_paths(
        &self,
        root: &Path,
        paths: &[PathBuf],
    ) -> Option<WorkspaceWatchEvent> {
        if paths.iter().any(|path| {
            path.starts_with(root) && path.file_name().is_some_and(|name| name == ".git")
        }) {
            let _ = self.refresh.try_send(());
        }
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .rescan_for_paths(root, paths)
    }

    pub(crate) fn start(
        &self,
        root: PathBuf,
        watcher: Arc<Mutex<RecommendedWatcher>>,
        receiver: mpsc::Receiver<()>,
        sink: Arc<dyn WorkspaceWatchEventSink>,
    ) -> io::Result<GitHeadWatchSession> {
        let identity = root_identity(&root)?;
        let stop = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::clone(&stop);
        let state = Arc::clone(&self.state);
        let worker = std::thread::Builder::new()
            .name("git-head-watch".into())
            .spawn(move || {
                let mut installed = BTreeSet::new();
                loop {
                    if cancelled.load(Ordering::Acquire)
                        || root_identity(&root).ok() != Some(identity)
                    {
                        return;
                    }
                    let next = GitHeadWatch::discover(&root);
                    let mut desired = next.external;
                    let mut warning = next.warning;
                    let removals = installed.difference(&desired).cloned().collect::<Vec<_>>();
                    for directory in removals {
                        let removed = watcher
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .unwatch(&directory);
                        match removed {
                            Ok(()) => {
                                installed.remove(&directory);
                            }
                            Err(error) => {
                                warning =
                                    Some(format!("Git metadata watch removal failed: {error}"));
                            }
                        }
                    }
                    let additions = desired.difference(&installed).cloned().collect::<Vec<_>>();
                    for directory in additions {
                        if cancelled.load(Ordering::Acquire)
                            || root_identity(&root).ok() != Some(identity)
                        {
                            return;
                        }
                        if installed.len() >= super::MAX_GIT_DIRS {
                            desired.remove(&directory);
                            warning = Some("Git metadata watch repository limit reached.".into());
                            continue;
                        }
                        if let Err(error) = watcher
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .watch(&directory, RecursiveMode::NonRecursive)
                        {
                            desired.remove(&directory);
                            warning = Some(format!("Git metadata watcher unavailable: {error}"));
                        } else {
                            installed.insert(directory);
                        }
                    }
                    if cancelled.load(Ordering::Acquire)
                        || root_identity(&root).ok() != Some(identity)
                    {
                        return;
                    }
                    *state.lock().unwrap_or_else(|error| error.into_inner()) = GitHeadWatch {
                        external: desired,
                        warning: None,
                    };
                    if let Some(message) = warning {
                        sink.error(WorkspaceWatchError { message });
                    }
                    let event = state
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .rescan_for_paths(&root, &[root.join(".git")]);
                    if let Some(event) = event {
                        sink.publish(WorkspaceWatchEventBatch {
                            events: vec![event],
                        });
                    }
                    loop {
                        if cancelled.load(Ordering::Acquire) {
                            return;
                        }
                        match receiver.recv_timeout(Duration::from_millis(100)) {
                            Ok(()) => break,
                            Err(mpsc::RecvTimeoutError::Timeout) => continue,
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }
                }
            })?;
        Ok(GitHeadWatchSession {
            stop,
            worker: Some(worker),
        })
    }
}

pub(crate) struct GitHeadWatchSession {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for GitHeadWatchSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn root_identity(root: &Path) -> io::Result<(u64, u64)> {
    let metadata = std::fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::other("Workspace directory changed."));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        let created = metadata
            .created()?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(io::Error::other)?;
        Ok((created.as_secs(), created.subsec_nanos() as u64))
    }
}
