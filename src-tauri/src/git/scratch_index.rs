use super::{
    bounded_process::CommandError,
    pinned_root::{GitInvocation, PinnedRoot},
};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const GIT_PATH_OUTPUT_BYTES: usize = 8 * 1024;
static NEXT_SCRATCH_INDEX: AtomicU64 = AtomicU64::new(0);

pub(super) struct ScratchIndex {
    path: PathBuf,
}

impl ScratchIndex {
    pub(super) fn create(root: &PinnedRoot, label: &str, trusted: bool) -> io::Result<Self> {
        let unique = NEXT_SCRATCH_INDEX.fetch_add(1, Ordering::SeqCst);
        let name = format!("codevo-{label}-{}-{unique}.index", std::process::id());
        let path = git_path(root, &name, trusted)?;
        let _ = fs::remove_file(&path);
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ScratchIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let mut lock = self.path.clone().into_os_string();
        lock.push(".lock");
        let _ = fs::remove_file(lock);
    }
}

pub(super) fn git_path(root: &PinnedRoot, name: &str, trusted: bool) -> io::Result<PathBuf> {
    let output = root
        .invoke(
            &["rev-parse", "--git-path", name],
            trusted,
            GIT_PATH_OUTPUT_BYTES,
            GitInvocation::default(),
        )
        .map_err(|error: CommandError| io::Error::other(error.into_message()))?;
    let raw = String::from_utf8(output)
        .map_err(|_| io::Error::other("Git returned non-UTF-8 output."))?;
    let path = Path::new(raw.trim_end_matches('\n'));
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Ok(root.path().join(path))
}
