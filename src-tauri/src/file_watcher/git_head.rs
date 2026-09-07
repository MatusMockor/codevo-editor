use super::{
    WorkspaceWatchBackend, WorkspaceWatchEvent, WorkspaceWatchEventKind, WorkspaceWatchFileKind,
};
use crate::ignore_matcher::is_default_ignored_name;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 8192;
const MAX_GIT_DIRS: usize = 128;
const MAX_DEPTH: usize = 4;
const MAX_POINTER_BYTES: u64 = 8192;

#[derive(Default)]
pub(super) struct GitHeadWatch {
    external: BTreeSet<PathBuf>,
    warning: Option<String>,
}

impl GitHeadWatch {
    pub(super) fn discover(root: &Path) -> Self {
        let mut external = BTreeSet::new();
        let mut pending = vec![(root.to_path_buf(), 0)];
        let mut entries = 0;
        let deadline = Instant::now() + Duration::from_secs(2);
        while let Some((directory, depth)) = pending.pop() {
            if let Some(git_dir) = linked_git_dir(&directory) {
                if !git_dir.starts_with(root) {
                    external.insert(git_dir);
                    if external.len() >= MAX_GIT_DIRS {
                        return Self {
                            external,
                            warning: Some("Git metadata watch repository limit reached.".into()),
                        };
                    }
                }
            }
            if depth >= MAX_DEPTH {
                continue;
            }
            let Ok(children) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in children {
                entries += 1;
                if entries > MAX_ENTRIES || Instant::now() >= deadline {
                    return Self {
                        external,
                        warning: Some("Git metadata watch discovery limit reached.".into()),
                    };
                }
                let Ok(entry) = entry else {
                    continue;
                };
                let name = entry.file_name();
                if is_default_ignored_name(&name.to_string_lossy()) {
                    continue;
                }
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_dir() && !kind.is_symlink() {
                    pending.push((entry.path(), depth + 1));
                }
            }
        }
        Self {
            external,
            warning: None,
        }
    }

    #[cfg(test)]
    pub(super) fn external_directories(&self) -> impl Iterator<Item = &PathBuf> {
        self.external.iter()
    }

    pub(super) fn rescan_for_paths(
        &self,
        root: &Path,
        paths: &[PathBuf],
    ) -> Option<WorkspaceWatchEvent> {
        if !paths.iter().any(|path| self.is_head_metadata(root, path)) {
            return None;
        }
        let root_path = root.to_string_lossy().replace('\\', "/");
        Some(WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::Directory),
            kind: WorkspaceWatchEventKind::RescanRequired,
            path: root_path.clone(),
            previous_path: None,
            previous_relative_path: None,
            relative_path: String::new(),
            root_path,
        })
    }

    fn is_head_metadata(&self, root: &Path, path: &Path) -> bool {
        if path.file_name().is_some_and(|name| name == "HEAD")
            && path
                .parent()
                .is_some_and(|parent| self.external.contains(parent))
        {
            return true;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            return false;
        };
        if relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return false;
        }
        if path.file_name().is_some_and(|name| name == ".git") {
            return true;
        }
        path.file_name().is_some_and(|name| name == "HEAD")
            && relative.components().any(|part| part.as_os_str() == ".git")
    }
}

fn linked_git_dir(directory: &Path) -> Option<PathBuf> {
    let marker = directory.join(".git");
    let metadata = fs::symlink_metadata(&marker).ok()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_POINTER_BYTES
    {
        return None;
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(marker).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_POINTER_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_POINTER_BYTES {
        return None;
    }
    let pointer = std::str::from_utf8(&bytes).ok()?.trim_end();
    let path = pointer.strip_prefix("gitdir: ")?;
    if path.is_empty() || path.contains(['\n', '\r', '\0']) {
        return None;
    }
    let target = directory.join(path).canonicalize().ok()?;
    target.is_dir().then_some(target)
}

mod runtime;
pub(super) use runtime::{GitHeadWatchEvents, GitHeadWatchSession};

#[cfg(test)]
mod tests;
