use super::workspace_file_search::{ensure_current, RankedPaths};
use super::{fstat, open_directory_path, stat_at};
use crate::file_fuzzy_matcher::FileMatchRank;
use crate::workspace_registry::WorkspaceId;
use std::{
    collections::HashMap,
    ffi::CString,
    fs::File,
    io,
    os::fd::{AsRawFd, RawFd},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

const WORKSPACE_FILE_INDEX_FILE_LIMIT: usize = 50_000;
const WORKSPACE_FILE_INDEX_DIRECTORY_LIMIT: usize = 20_000;
const WORKSPACE_FILE_INDEX_PATH_BYTE_LIMIT: usize = 6 * 1024 * 1024;
const WORKSPACE_FILE_INDEX_CACHE_CAPACITY: usize = 4;
const WORKSPACE_FILE_INDEX_CANCELLATION_STRIDE: usize = 512;
const WORKSPACE_FILE_INDEX_PARALLEL_RANK_THRESHOLD: usize = 1_024;
const WORKSPACE_FILE_INDEX_MAX_RANK_WORKERS: usize = 8;
const WORKSPACE_FILE_INDEX_MTIME_SETTLE_NANOSECONDS: i128 = 2_000_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceFileIndexBounds {
    files: usize,
    directories: usize,
    path_bytes: usize,
    cached_indexes: usize,
    mtime_settle_nanoseconds: i128,
}

impl Default for WorkspaceFileIndexBounds {
    fn default() -> Self {
        Self {
            files: WORKSPACE_FILE_INDEX_FILE_LIMIT,
            directories: WORKSPACE_FILE_INDEX_DIRECTORY_LIMIT,
            path_bytes: WORKSPACE_FILE_INDEX_PATH_BYTE_LIMIT,
            cached_indexes: WORKSPACE_FILE_INDEX_CACHE_CAPACITY,
            mtime_settle_nanoseconds: WORKSPACE_FILE_INDEX_MTIME_SETTLE_NANOSECONDS,
        }
    }
}

#[cfg(test)]
impl WorkspaceFileIndexBounds {
    pub(crate) fn with_files(self, files: usize) -> Self {
        Self { files, ..self }
    }

    pub(crate) fn with_directories(self, directories: usize) -> Self {
        Self {
            directories,
            ..self
        }
    }

    pub(crate) fn with_cached_indexes(self, cached_indexes: usize) -> Self {
        Self {
            cached_indexes,
            ..self
        }
    }

    pub(crate) fn with_mtime_settle_nanoseconds(self, mtime_settle_nanoseconds: i128) -> Self {
        Self {
            mtime_settle_nanoseconds,
            ..self
        }
    }

    pub(crate) fn with_path_bytes(self, path_bytes: usize) -> Self {
        Self { path_bytes, ..self }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct WorkspaceFileIndexKey {
    workspace_id: WorkspaceId,
    root_device: u64,
    root_inode: u64,
    scope: PathBuf,
}

impl WorkspaceFileIndexKey {
    pub(crate) fn of(workspace_id: &WorkspaceId, root: &File, scope: &Path) -> io::Result<Self> {
        let root_stat = fstat(root.as_raw_fd())?;
        Ok(Self {
            workspace_id: workspace_id.clone(),
            root_device: root_stat.st_dev as u64,
            root_inode: root_stat.st_ino,
            scope: scope.to_path_buf(),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NodeStamp {
    device: u64,
    inode: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    size: i64,
}

impl NodeStamp {
    fn of(stat: &libc::stat) -> Self {
        let (modified_seconds, modified_nanoseconds) = modified_time(stat);
        Self {
            device: stat.st_dev as u64,
            inode: stat.st_ino,
            modified_seconds,
            modified_nanoseconds,
            size: stat.st_size,
        }
    }

    fn is_settled_at(&self, observed: RealtimeInstant, settle_nanoseconds: i128) -> bool {
        observed.nanoseconds_since(self.modified_seconds, self.modified_nanoseconds)
            >= settle_nanoseconds
    }
}

fn modified_time(stat: &libc::stat) -> (i64, i64) {
    (stat.st_mtime, stat.st_mtime_nsec)
}

#[derive(Clone, Copy, Debug)]
struct RealtimeInstant {
    seconds: i64,
    nanoseconds: i64,
}

impl RealtimeInstant {
    fn now() -> io::Result<Self> {
        let mut value = std::mem::MaybeUninit::<libc::timespec>::uninit();
        if unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, value.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let value = unsafe { value.assume_init() };
        Ok(Self {
            seconds: value.tv_sec,
            nanoseconds: value.tv_nsec,
        })
    }

    fn nanoseconds_since(&self, seconds: i64, nanoseconds: i64) -> i128 {
        (i128::from(self.seconds) - i128::from(seconds)) * 1_000_000_000
            + (i128::from(self.nanoseconds) - i128::from(nanoseconds))
    }
}

pub(super) struct VisitedDirectory<'a> {
    pub(super) relative: &'a Path,
    pub(super) before: libc::stat,
    pub(super) after: libc::stat,
    pub(super) gitignore: Option<libc::stat>,
}

struct IndexedFile {
    relative: PathBuf,
    display: String,
    lowered_ascii: Option<Box<[u8]>>,
}

fn lowered_ascii_bytes(display: &str) -> Option<Box<[u8]>> {
    if !display.is_ascii() {
        return None;
    }
    Some(
        display
            .bytes()
            .map(|byte| byte.to_ascii_lowercase())
            .collect(),
    )
}

struct AsciiSubsequencePrefilter {
    tokens: Option<Vec<Box<[u8]>>>,
}

impl AsciiSubsequencePrefilter {
    fn of(query: &str) -> Self {
        let mut tokens = Vec::new();
        for token in query.split_whitespace() {
            if !token.is_ascii() {
                return Self { tokens: None };
            }
            tokens.push(
                token
                    .bytes()
                    .map(|byte| byte.to_ascii_lowercase())
                    .collect(),
            );
        }
        Self {
            tokens: Some(tokens),
        }
    }

    fn rejects(&self, lowered: Option<&[u8]>) -> bool {
        let Some(tokens) = &self.tokens else {
            return false;
        };
        if tokens.is_empty() {
            return false;
        }
        let Some(lowered) = lowered else {
            return false;
        };
        !tokens
            .iter()
            .all(|token| contains_byte_subsequence(lowered, token))
    }
}

fn contains_byte_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    let mut position = 0usize;
    'needle: for &wanted in needle {
        while position < haystack.len() {
            let candidate = haystack[position];
            position += 1;
            if candidate == wanted {
                continue 'needle;
            }
        }
        return false;
    }
    true
}

struct IndexedDirectory {
    relative: PathBuf,
    stamp: NodeStamp,
    gitignore: Option<NodeStamp>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum IndexRejection {
    FileLimit,
    DirectoryLimit,
    PathByteLimit,
    UnstableDirectory,
    WalkTruncated,
}

pub(super) struct WorkspaceFileIndexBuilder {
    bounds: WorkspaceFileIndexBounds,
    files: Vec<IndexedFile>,
    directories: Vec<IndexedDirectory>,
    path_bytes: usize,
    rejection: Option<IndexRejection>,
}

impl WorkspaceFileIndexBuilder {
    pub(super) fn new(bounds: WorkspaceFileIndexBounds) -> Self {
        Self {
            bounds,
            files: Vec::new(),
            directories: Vec::new(),
            path_bytes: 0,
            rejection: None,
        }
    }

    pub(super) fn record_file(&mut self, relative: &Path, display: &str) {
        if self.rejection.is_some() {
            return;
        }
        if self.files.len() >= self.bounds.files {
            self.reject(IndexRejection::FileLimit);
            return;
        }
        let lowered_ascii = lowered_ascii_bytes(display);
        let bytes = display.len()
            + relative.as_os_str().len()
            + lowered_ascii.as_ref().map_or(0, |lowered| lowered.len());
        if self.path_bytes.saturating_add(bytes) > self.bounds.path_bytes {
            self.reject(IndexRejection::PathByteLimit);
            return;
        }
        self.path_bytes += bytes;
        self.files.push(IndexedFile {
            relative: relative.to_path_buf(),
            display: display.to_owned(),
            lowered_ascii,
        });
    }

    pub(super) fn record_directory(&mut self, visited: &VisitedDirectory<'_>) -> io::Result<()> {
        if self.rejection.is_some() {
            return Ok(());
        }
        if self.directories.len() >= self.bounds.directories {
            self.reject(IndexRejection::DirectoryLimit);
            return Ok(());
        }
        let before = NodeStamp::of(&visited.before);
        let after = NodeStamp::of(&visited.after);
        let observed = RealtimeInstant::now()?;
        if before != after || !after.is_settled_at(observed, self.bounds.mtime_settle_nanoseconds) {
            self.reject(IndexRejection::UnstableDirectory);
            return Ok(());
        }
        let bytes = visited.relative.as_os_str().len();
        if self.path_bytes.saturating_add(bytes) > self.bounds.path_bytes {
            self.reject(IndexRejection::PathByteLimit);
            return Ok(());
        }
        self.path_bytes += bytes;
        self.directories.push(IndexedDirectory {
            relative: visited.relative.to_path_buf(),
            stamp: after,
            gitignore: visited.gitignore.as_ref().map(NodeStamp::of),
        });
        Ok(())
    }

    fn reject(&mut self, rejection: IndexRejection) {
        self.rejection = Some(rejection);
        self.files = Vec::new();
        self.directories = Vec::new();
        self.path_bytes = 0;
    }

    pub(super) fn finish(
        mut self,
        walk_truncated: bool,
    ) -> Result<WorkspaceFileIndex, IndexRejection> {
        if walk_truncated {
            self.reject(IndexRejection::WalkTruncated);
        }
        if let Some(rejection) = self.rejection {
            return Err(rejection);
        }
        Ok(WorkspaceFileIndex {
            files: self.files,
            directories: self.directories,
        })
    }
}

pub(super) struct WorkspaceFileIndex {
    files: Vec<IndexedFile>,
    directories: Vec<IndexedDirectory>,
}

impl WorkspaceFileIndex {
    fn is_valid(&self, root: &File, is_current: &dyn Fn() -> bool) -> io::Result<bool> {
        for (position, directory) in self.directories.iter().enumerate() {
            if position % WORKSPACE_FILE_INDEX_CANCELLATION_STRIDE == 0 {
                ensure_current(is_current)?;
            }
            let Some(stat) = stat_relative(root.as_raw_fd(), &directory.relative) else {
                return Ok(false);
            };
            if NodeStamp::of(&stat) != directory.stamp {
                return Ok(false);
            }
            let Some(expected) = &directory.gitignore else {
                continue;
            };
            let Some(gitignore) =
                stat_relative(root.as_raw_fd(), &directory.relative.join(".gitignore"))
            else {
                return Ok(false);
            };
            if *expected != NodeStamp::of(&gitignore) {
                return Ok(false);
            }
        }
        ensure_current(is_current)?;
        Ok(true)
    }

    pub(super) fn ranked(
        &self,
        query: &str,
        limit: usize,
        is_current: &(dyn Fn() -> bool + Sync),
    ) -> io::Result<(Vec<(PathBuf, FileMatchRank)>, bool)> {
        let prefilter = AsciiSubsequencePrefilter::of(query);
        let workers = rank_worker_count(self.files.len());
        if workers > 1 {
            return self.ranked_parallel(&prefilter, query, limit, workers, is_current);
        }
        let ranked = rank_files(&self.files, &prefilter, query, limit, is_current)?;
        ensure_current(is_current)?;
        Ok(ranked.finish())
    }

    fn ranked_parallel(
        &self,
        prefilter: &AsciiSubsequencePrefilter,
        query: &str,
        limit: usize,
        workers: usize,
        is_current: &(dyn Fn() -> bool + Sync),
    ) -> io::Result<(Vec<(PathBuf, FileMatchRank)>, bool)> {
        ensure_current(is_current)?;
        let chunk_size = self.files.len().div_ceil(workers);
        let merged = std::thread::scope(|scope| {
            let handles: Vec<_> = self
                .files
                .chunks(chunk_size)
                .map(|files| {
                    scope.spawn(move || rank_files(files, prefilter, query, limit, is_current))
                })
                .collect();
            let mut merged = RankedPaths::new(limit);
            for handle in handles {
                let Ok(partition) = handle.join() else {
                    return Err(io::Error::other("workspace file rank worker panicked"));
                };
                merged.absorb(partition?);
            }
            Ok(merged)
        })?;
        ensure_current(is_current)?;
        Ok(merged.finish())
    }

    #[cfg(test)]
    pub(super) fn file_count(&self) -> usize {
        self.files.len()
    }
}

fn rank_files(
    files: &[IndexedFile],
    prefilter: &AsciiSubsequencePrefilter,
    query: &str,
    limit: usize,
    is_current: &(dyn Fn() -> bool + Sync),
) -> io::Result<RankedPaths> {
    let mut ranked = RankedPaths::new(limit);
    for (position, file) in files.iter().enumerate() {
        if position % WORKSPACE_FILE_INDEX_CANCELLATION_STRIDE == 0 {
            ensure_current(is_current)?;
        }
        if prefilter.rejects(file.lowered_ascii.as_deref()) {
            continue;
        }
        ranked.offer(&file.relative, &file.display, query);
    }
    Ok(ranked)
}

fn rank_worker_count(files: usize) -> usize {
    if files < WORKSPACE_FILE_INDEX_PARALLEL_RANK_THRESHOLD {
        return 1;
    }
    std::thread::available_parallelism()
        .map_or(1, |value| value.get())
        .min(WORKSPACE_FILE_INDEX_MAX_RANK_WORKERS)
}

fn scope_ancestors_are_intact(root: &File, scope: &Path) -> bool {
    scope.as_os_str().is_empty() || open_directory_path(root.as_raw_fd(), scope).is_ok()
}

fn stat_relative(root: RawFd, relative: &Path) -> Option<libc::stat> {
    if relative.as_os_str().is_empty() {
        return stat_at(root, c".").ok();
    }
    let name = CString::new(relative.as_os_str().as_bytes()).ok()?;
    stat_at(root, &name).ok()
}

struct CachedIndex {
    index: Arc<WorkspaceFileIndex>,
    last_used: u64,
}

#[derive(Default)]
struct WorkspaceFileIndexCacheState {
    indexes: HashMap<WorkspaceFileIndexKey, CachedIndex>,
    next_use: u64,
}

struct WorkspaceFileIndexCacheInner {
    bounds: WorkspaceFileIndexBounds,
    state: Mutex<WorkspaceFileIndexCacheState>,
    crawls: AtomicUsize,
    index_hits: AtomicUsize,
    last_rejection: Mutex<Option<IndexRejection>>,
}

#[derive(Clone)]
pub struct WorkspaceFileIndexCache {
    inner: Arc<WorkspaceFileIndexCacheInner>,
}

impl Default for WorkspaceFileIndexCache {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceFileIndexCache {
    pub fn new() -> Self {
        Self::with_bounds(WorkspaceFileIndexBounds::default())
    }

    pub(crate) fn with_bounds(bounds: WorkspaceFileIndexBounds) -> Self {
        Self {
            inner: Arc::new(WorkspaceFileIndexCacheInner {
                bounds,
                state: Mutex::new(WorkspaceFileIndexCacheState::default()),
                crawls: AtomicUsize::new(0),
                index_hits: AtomicUsize::new(0),
                last_rejection: Mutex::new(None),
            }),
        }
    }

    pub(super) fn bounds(&self) -> WorkspaceFileIndexBounds {
        self.inner.bounds
    }

    pub(super) fn resolve(
        &self,
        key: &WorkspaceFileIndexKey,
        root: &File,
        is_current: &dyn Fn() -> bool,
    ) -> io::Result<Option<Arc<WorkspaceFileIndex>>> {
        let Some(index) = self.snapshot(key) else {
            return Ok(None);
        };
        if !scope_ancestors_are_intact(root, &key.scope) {
            self.invalidate(key);
            return Ok(None);
        }
        if index.is_valid(root, is_current)? {
            self.inner.index_hits.fetch_add(1, Ordering::Relaxed);
            return Ok(Some(index));
        }
        self.invalidate(key);
        Ok(None)
    }

    pub(super) fn record_crawl(&self) {
        self.inner.crawls.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) fn record_rejection(&self, rejection: IndexRejection) {
        if let Ok(mut last) = self.inner.last_rejection.lock() {
            *last = Some(rejection);
        }
    }

    pub(super) fn store(&self, key: WorkspaceFileIndexKey, index: WorkspaceFileIndex) {
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };
        state.next_use += 1;
        let last_used = state.next_use;
        state.indexes.insert(
            key,
            CachedIndex {
                index: Arc::new(index),
                last_used,
            },
        );
        while state.indexes.len() > self.inner.bounds.cached_indexes {
            let Some(evicted) = state
                .indexes
                .iter()
                .min_by_key(|(_, cached)| cached.last_used)
                .map(|(key, _)| key.clone())
            else {
                return;
            };
            state.indexes.remove(&evicted);
        }
    }

    fn snapshot(&self, key: &WorkspaceFileIndexKey) -> Option<Arc<WorkspaceFileIndex>> {
        let mut state = self.inner.state.lock().ok()?;
        state.next_use += 1;
        let last_used = state.next_use;
        let cached = state.indexes.get_mut(key)?;
        cached.last_used = last_used;
        Some(Arc::clone(&cached.index))
    }

    fn invalidate(&self, key: &WorkspaceFileIndexKey) {
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };
        state.indexes.remove(key);
    }

    #[cfg(test)]
    pub(crate) fn crawl_count(&self) -> usize {
        self.inner.crawls.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(crate) fn index_hit_count(&self) -> usize {
        self.inner.index_hits.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(crate) fn retained_index_count(&self) -> usize {
        self.inner
            .state
            .lock()
            .map(|state| state.indexes.len())
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub(crate) fn last_rejection(&self) -> Option<IndexRejection> {
        self.inner
            .last_rejection
            .lock()
            .ok()
            .and_then(|rejection| *rejection)
    }

    #[cfg(test)]
    pub(crate) fn retained_file_count(&self, key: &WorkspaceFileIndexKey) -> Option<usize> {
        let state = self.inner.state.lock().ok()?;
        state
            .indexes
            .get(key)
            .map(|cached| cached.index.file_count())
    }
}
