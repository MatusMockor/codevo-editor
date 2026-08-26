use crate::ignore_matcher::{
    is_default_ignored_name, GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher,
};
use crate::index::{BatchOutcome, SqliteWorkspaceIndex, WorkspaceFileRecord, WorkspaceIndexStore};
pub(crate) mod operation_authority;

use self::operation_authority::{run_if_index_operation_current, WorkspaceIndexOperationAuthority};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs,
    io::{self, Read},
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{ffi::CStr, os::unix::ffi::OsStringExt};

pub const METADATA_SCAN_COMPLETED_EVENT: &str = "index://metadata-scan-completed";
pub const INDEX_PROGRESS_EVENT: &str = "index://progress";
const MAX_SCAN_HEALTH_DETAILS: usize = 100;
const MAX_REGISTERED_SCAN_ENTRIES: usize = 1_000_000;
const MAX_REGISTERED_SCAN_DIRECTORIES: usize = 100_000;
const MAX_REGISTERED_SCAN_DEPTH: usize = 256;
const MAX_GITIGNORE_FILES: usize = 4_096;
const MAX_GITIGNORE_FILE_BYTES: u64 = 1_048_576;
const MAX_GITIGNORE_TOTAL_BYTES: usize = 8_388_608;
/// Number of file metadata rows written per batched SQLite transaction during the initial scan.
/// One commit (one WAL fsync) per batch instead of per file is the main indexing speedup; the
/// bound keeps the transaction short enough to honour lifecycle cancellation between batches.
const SCAN_WRITE_BATCH_SIZE: usize = 500;

pub trait MetadataLanguageDetector: Send + Sync {
    fn language_for_path(&self, path: &Path) -> String;
}

pub struct ExtensionMetadataLanguageDetector;

impl MetadataLanguageDetector for ExtensionMetadataLanguageDetector {
    fn language_for_path(&self, path: &Path) -> String {
        let extension = match path.extension().and_then(|value| value.to_str()) {
            Some(extension) => extension.to_ascii_lowercase(),
            None => return "plaintext".to_string(),
        };

        match extension.as_str() {
            "css" => "css".to_string(),
            "html" => "html".to_string(),
            "cjs" | "js" | "jsx" | "mjs" => "javascript".to_string(),
            "json" => "json".to_string(),
            "md" => "markdown".to_string(),
            "php" => "php".to_string(),
            "rs" => "rust".to_string(),
            "cts" | "mts" | "ts" | "tsx" => "typescript".to_string(),
            "xml" => "xml".to_string(),
            "yaml" | "yml" => "yaml".to_string(),
            _ => "plaintext".to_string(),
        }
    }
}

pub trait WorkspaceMetadataScanner {
    fn collect_path(
        &self,
        root_path: &Path,
        scan_path: &Path,
    ) -> Result<MetadataScanCollection, MetadataScanError>;

    fn scan(
        &self,
        root_path: &Path,
        store: &dyn WorkspaceIndexStore,
    ) -> Result<MetadataScanReport, MetadataScanError>;
}

pub struct LocalWorkspaceMetadataScanner {
    language_detector: Box<dyn MetadataLanguageDetector>,
}

struct RegisteredScanContext<'a> {
    authority: &'a WorkspaceIndexOperationAuthority,
    collection: &'a mut MetadataScanCollection,
    is_cancelled: &'a dyn Fn() -> bool,
    matcher: &'a dyn WorkspaceIgnoreMatcher,
    root_path: &'a Path,
    budget: &'a mut RegisteredScanBudget,
}

#[derive(Default)]
struct RegisteredScanBudget {
    directories: usize,
    entries: usize,
    gitignore_bytes: usize,
    gitignore_files: usize,
}

impl Default for LocalWorkspaceMetadataScanner {
    fn default() -> Self {
        Self::new(Box::new(ExtensionMetadataLanguageDetector))
    }
}

impl LocalWorkspaceMetadataScanner {
    pub fn new(language_detector: Box<dyn MetadataLanguageDetector>) -> Self {
        Self { language_detector }
    }

    fn scan_directory(
        &self,
        root_path: &Path,
        directory: &Path,
        matcher: &dyn WorkspaceIgnoreMatcher,
        collection: &mut MetadataScanCollection,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<(), MetadataScanError> {
        ensure_collection_current(is_cancelled)?;
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => {
                collection.report.record_error(
                    scan_detail_path(root_path, directory),
                    "Directory could not be read.",
                );
                return Ok(());
            }
        };

        for entry in entries {
            ensure_collection_current(is_cancelled)?;
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    collection.report.record_error(
                        scan_detail_path(root_path, directory),
                        "Directory entry could not be read.",
                    );
                    continue;
                }
            };
            self.scan_entry(root_path, &entry.path(), matcher, collection, is_cancelled)?;
        }

        Ok(())
    }

    fn scan_entry(
        &self,
        root_path: &Path,
        path: &Path,
        matcher: &dyn WorkspaceIgnoreMatcher,
        collection: &mut MetadataScanCollection,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<(), MetadataScanError> {
        ensure_collection_current(is_cancelled)?;
        let file_type = match fs::symlink_metadata(path) {
            Ok(file_type) => file_type,
            Err(_) => {
                collection.report.record_error(
                    scan_detail_path(root_path, path),
                    "Metadata could not be read.",
                );
                return Ok(());
            }
        };
        let file_type = file_type.file_type();

        if file_type.is_symlink() {
            collection
                .report
                .record_skip(scan_detail_path(root_path, path), "Symlink skipped.");
            return Ok(());
        }

        if matcher.is_ignored(path, file_type.is_dir()) {
            collection.report.record_skip(
                scan_detail_path(root_path, path),
                "Ignored by workspace rules.",
            );
            return Ok(());
        }

        if file_type.is_dir() {
            self.scan_directory(root_path, path, matcher, collection, is_cancelled)?;
            return Ok(());
        }

        if !file_type.is_file() {
            collection.report.record_skip(
                scan_detail_path(root_path, path),
                "Unsupported file type skipped.",
            );
            return Ok(());
        }

        self.scan_file(root_path, path, collection)
    }

    pub(crate) fn collect_path_with_cancellation(
        &self,
        root_path: &Path,
        scan_path: &Path,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<MetadataScanCollection, MetadataScanError> {
        ensure_collection_current(is_cancelled)?;
        let root_path = root_path.canonicalize()?;
        let scan_path = absolute_candidate(&root_path, scan_path);
        let matcher =
            match GitignoreWorkspaceIgnoreMatcher::load_with_cancellation(&root_path, is_cancelled)
            {
                Ok(matcher) => matcher,
                Err(error) if error.kind() == io::ErrorKind::Interrupted && is_cancelled() => {
                    return Err(MetadataScanError::Cancelled);
                }
                Err(error) => return Err(MetadataScanError::Io(error)),
            };
        let mut collection = MetadataScanCollection::default();

        ensure_collection_current(is_cancelled)?;
        if !scan_path.exists() {
            return Ok(collection);
        }

        self.scan_entry(
            &root_path,
            &scan_path,
            &matcher,
            &mut collection,
            is_cancelled,
        )?;

        Ok(collection)
    }

    pub(crate) fn collect_registered_root_with_cancellation(
        &self,
        root_path: &Path,
        authority: &WorkspaceIndexOperationAuthority,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<MetadataScanCollection, MetadataScanError> {
        ensure_collection_current(is_cancelled)?;
        let mut gitignores = Vec::new();
        let mut budget = RegisteredScanBudget::default();
        self.collect_registered_gitignores(
            authority,
            Path::new(""),
            0,
            &mut budget,
            &mut gitignores,
            is_cancelled,
        )?;
        let matcher =
            GitignoreWorkspaceIgnoreMatcher::from_gitignore_contents(root_path, gitignores)?;
        let root = authority.try_clone_root()?;
        let mut collection = MetadataScanCollection::default();
        let mut context = RegisteredScanContext {
            authority,
            collection: &mut collection,
            is_cancelled,
            matcher: &matcher,
            root_path,
            budget: &mut budget,
        };
        self.scan_registered_directory(&mut context, Path::new(""), root, 0)?;
        Ok(collection)
    }

    fn collect_registered_gitignores(
        &self,
        authority: &WorkspaceIndexOperationAuthority,
        relative_directory: &Path,
        depth: usize,
        budget: &mut RegisteredScanBudget,
        contents: &mut Vec<(PathBuf, String)>,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<(), MetadataScanError> {
        ensure_collection_current(is_cancelled)?;
        let directory = if relative_directory.as_os_str().is_empty() {
            authority.try_clone_root()?
        } else {
            authority.open_directory(relative_directory)?
        };
        register_directory(budget, depth)?;
        visit_directory_entries(&directory, is_cancelled, |name| {
            ensure_collection_current(is_cancelled)?;
            register_entry(budget)?;
            let name_text = name.to_string_lossy();
            if is_default_ignored_name(&name_text) {
                return Ok(());
            }
            let relative = relative_directory.join(&name);
            if name_text == ".gitignore" {
                if let Ok(mut file) = authority.open_file(&relative) {
                    if budget.gitignore_files >= MAX_GITIGNORE_FILES {
                        return Err(limit_error("gitignore file limit exceeded").into());
                    }
                    let mut content = String::new();
                    file.by_ref()
                        .take(MAX_GITIGNORE_FILE_BYTES + 1)
                        .read_to_string(&mut content)?;
                    if content.len() as u64 > MAX_GITIGNORE_FILE_BYTES
                        || budget.gitignore_bytes.saturating_add(content.len())
                            > MAX_GITIGNORE_TOTAL_BYTES
                    {
                        return Err(limit_error("gitignore byte limit exceeded").into());
                    }
                    ensure_collection_current(is_cancelled)?;
                    budget.gitignore_files += 1;
                    budget.gitignore_bytes += content.len();
                    contents.push((relative_directory.to_path_buf(), content));
                }
                return Ok(());
            }
            if authority.open_directory(&relative).is_err() {
                return Ok(());
            }
            self.collect_registered_gitignores(
                authority,
                &relative,
                depth + 1,
                budget,
                contents,
                is_cancelled,
            )
        })
    }

    fn scan_registered_directory(
        &self,
        context: &mut RegisteredScanContext<'_>,
        relative_directory: &Path,
        directory: fs::File,
        depth: usize,
    ) -> Result<(), MetadataScanError> {
        ensure_collection_current(context.is_cancelled)?;
        register_directory(context.budget, depth)?;
        visit_directory_entries(&directory, context.is_cancelled, |name| {
            ensure_collection_current(context.is_cancelled)?;
            register_entry(context.budget)?;
            let relative = relative_directory.join(name);
            let logical_path = context.root_path.join(&relative);
            if let Ok(child_directory) = context.authority.open_directory(&relative) {
                if context.matcher.is_ignored(&logical_path, true) {
                    context.collection.report.record_skip(
                        relative.to_string_lossy().to_string(),
                        "Ignored by workspace rules.",
                    );
                    return Ok(());
                }
                return self.scan_registered_directory(
                    context,
                    &relative,
                    child_directory,
                    depth + 1,
                );
            }
            let file = match context.authority.open_file(&relative) {
                Ok(file) => file,
                Err(_) => {
                    context.collection.report.record_skip(
                        relative.to_string_lossy().to_string(),
                        "Symlink or unsupported file type skipped.",
                    );
                    return Ok(());
                }
            };
            if context.matcher.is_ignored(&logical_path, false) {
                context.collection.report.record_skip(
                    relative.to_string_lossy().to_string(),
                    "Ignored by workspace rules.",
                );
                return Ok(());
            }
            let metadata = file.metadata()?;
            context.collection.records.push(WorkspaceFileRecord {
                language: self.language_detector.language_for_path(&logical_path),
                modified_at_unix: modified_at_unix(&metadata),
                path: logical_path.to_string_lossy().to_string(),
                relative_path: relative.to_string_lossy().to_string(),
                size_bytes: size_bytes(&metadata),
            });
            context.collection.report.indexed_files += 1;
            Ok(())
        })
    }

    fn scan_file(
        &self,
        root_path: &Path,
        path: &Path,
        collection: &mut MetadataScanCollection,
    ) -> Result<(), MetadataScanError> {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(_) => {
                collection.report.record_error(
                    scan_detail_path(root_path, path),
                    "File metadata could not be read.",
                );
                return Ok(());
            }
        };
        let canonical_path = match path.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                collection.report.record_error(
                    scan_detail_path(root_path, path),
                    "Path could not be resolved.",
                );
                return Ok(());
            }
        };
        let relative_path = match relative_path(root_path, &canonical_path) {
            Some(path) => path,
            None => {
                collection.report.record_skip(
                    canonical_path.to_string_lossy().to_string(),
                    "Path is outside the workspace.",
                );
                return Ok(());
            }
        };

        collection.records.push(WorkspaceFileRecord {
            language: self.language_detector.language_for_path(&canonical_path),
            modified_at_unix: modified_at_unix(&metadata),
            path: canonical_path.to_string_lossy().to_string(),
            relative_path,
            size_bytes: size_bytes(&metadata),
        });
        collection.report.indexed_files += 1;

        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct DirectoryStream(*mut libc::DIR);

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Drop for DirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn visit_directory_entries(
    directory: &fs::File,
    is_cancelled: &dyn Fn() -> bool,
    mut visit: impl FnMut(std::ffi::OsString) -> Result<(), MetadataScanError>,
) -> Result<(), MetadataScanError> {
    use std::os::fd::AsRawFd;

    let relative = c".";
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            relative.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(io::Error::last_os_error().into());
    }
    let stream = unsafe { libc::fdopendir(descriptor) };
    if stream.is_null() {
        unsafe {
            libc::close(descriptor);
        }
        return Err(io::Error::last_os_error().into());
    }
    let stream = DirectoryStream(stream);
    loop {
        ensure_collection_current(is_cancelled)?;
        set_directory_errno(0);
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            let error = directory_errno();
            if error == 0 {
                return Ok(());
            }
            return Err(io::Error::from_raw_os_error(error).into());
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name == b"." || name == b".." {
            continue;
        }
        visit(std::ffi::OsString::from_vec(name.to_vec()))?;
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn visit_directory_entries(
    _directory: &fs::File,
    _is_cancelled: &dyn Fn() -> bool,
    _visit: impl FnMut(std::ffi::OsString) -> Result<(), MetadataScanError>,
) -> Result<(), MetadataScanError> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "descriptor-backed index traversal is unsupported",
    )
    .into())
}

#[cfg(target_os = "macos")]
fn set_directory_errno(value: i32) {
    unsafe {
        *libc::__error() = value;
    }
}

#[cfg(target_os = "linux")]
fn set_directory_errno(value: i32) {
    unsafe {
        *libc::__errno_location() = value;
    }
}

#[cfg(target_os = "macos")]
fn directory_errno() -> i32 {
    unsafe { *libc::__error() }
}

#[cfg(target_os = "linux")]
fn directory_errno() -> i32 {
    unsafe { *libc::__errno_location() }
}

fn register_directory(
    budget: &mut RegisteredScanBudget,
    depth: usize,
) -> Result<(), MetadataScanError> {
    if depth > MAX_REGISTERED_SCAN_DEPTH || budget.directories >= MAX_REGISTERED_SCAN_DIRECTORIES {
        return Err(limit_error("directory traversal limit exceeded").into());
    }
    budget.directories += 1;
    Ok(())
}

fn register_entry(budget: &mut RegisteredScanBudget) -> Result<(), MetadataScanError> {
    if budget.entries >= MAX_REGISTERED_SCAN_ENTRIES {
        return Err(limit_error("directory entry limit exceeded").into());
    }
    budget.entries += 1;
    Ok(())
}

fn limit_error(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

impl WorkspaceMetadataScanner for LocalWorkspaceMetadataScanner {
    fn collect_path(
        &self,
        root_path: &Path,
        scan_path: &Path,
    ) -> Result<MetadataScanCollection, MetadataScanError> {
        self.collect_path_with_cancellation(root_path, scan_path, &|| false)
    }

    fn scan(
        &self,
        root_path: &Path,
        store: &dyn WorkspaceIndexStore,
    ) -> Result<MetadataScanReport, MetadataScanError> {
        let collection = self.collect_path(root_path, root_path)?;

        for record in &collection.records {
            store.upsert_file(record)?;
        }

        Ok(collection.report)
    }
}

#[derive(Debug, Default, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataScanReport {
    pub changed_files: usize,
    pub error_details: Vec<MetadataScanHealthDetail>,
    pub errored_entries: usize,
    pub indexed_files: usize,
    pub parsed_files: usize,
    pub removed_files: usize,
    pub skipped_details: Vec<MetadataScanHealthDetail>,
    pub skipped_entries: usize,
    pub symbols_indexed: usize,
}

impl MetadataScanReport {
    pub fn record_error(&mut self, path: String, reason: &str) {
        self.errored_entries += 1;
        push_health_detail(&mut self.error_details, path, reason);
    }

    pub fn record_skip(&mut self, path: String, reason: &str) {
        self.skipped_entries += 1;
        push_health_detail(&mut self.skipped_details, path, reason);
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataScanHealthDetail {
    pub path: String,
    pub reason: String,
}

fn push_health_detail(details: &mut Vec<MetadataScanHealthDetail>, path: String, reason: &str) {
    if details.len() >= MAX_SCAN_HEALTH_DETAILS {
        return;
    }

    details.push(MetadataScanHealthDetail {
        path,
        reason: reason.to_string(),
    });
}

#[derive(Debug, Default, Clone, Eq, PartialEq)]
pub struct MetadataScanCollection {
    pub records: Vec<WorkspaceFileRecord>,
    pub report: MetadataScanReport,
}

#[derive(Clone)]
pub struct WorkspaceMetadataScanRequest {
    pub database_path: PathBuf,
    pub operation_authority: Option<WorkspaceIndexOperationAuthority>,
    pub operation_generation: NonZeroU32,
    pub root_path: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialMetadataScanStart {
    pub database_path: String,
    pub operation_generation: NonZeroU32,
    pub root_path: String,
    pub status: InitialMetadataScanStartStatus,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InitialMetadataScanStartStatus {
    Started,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceReindexMode {
    Hard,
    Language,
    Soft,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataScanCompletionEvent {
    pub database_path: String,
    pub message: Option<String>,
    pub operation_generation: NonZeroU32,
    pub report: Option<MetadataScanReport>,
    pub root_path: String,
    pub status: MetadataScanCompletionStatus,
}

impl MetadataScanCompletionEvent {
    pub(crate) fn completed(
        root_path: &Path,
        database_path: &Path,
        operation_generation: NonZeroU32,
        report: MetadataScanReport,
    ) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: None,
            operation_generation,
            report: Some(report),
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Completed,
        }
    }

    pub(crate) fn failed(
        root_path: &Path,
        database_path: &Path,
        operation_generation: NonZeroU32,
        error: MetadataScanError,
    ) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: Some(error.to_string()),
            operation_generation,
            report: None,
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Failed,
        }
    }

    pub(crate) fn failed_message(
        root_path: &Path,
        database_path: &Path,
        operation_generation: NonZeroU32,
        message: String,
    ) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: Some(message),
            operation_generation,
            report: None,
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Failed,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MetadataScanCompletionStatus {
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexProgressPhase {
    Parsing,
    Scanning,
}

/// Incremental progress emitted on batch boundaries during a workspace reindex so the UI can show
/// "X of N files" instead of an indeterminate spinner that looks like a hang. `total_files` is the
/// number of source files queued to parse for `phase`; it is `None` when unknown so the UI degrades
/// to an indeterminate count. Tagged with `root_path` so the frontend drops cross-workspace events.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgressEvent {
    pub operation_generation: NonZeroU32,
    pub phase: IndexProgressPhase,
    pub processed_files: usize,
    pub root_path: String,
    pub total_files: Option<usize>,
}

impl IndexProgressEvent {
    pub(crate) fn new(
        root_path: &Path,
        operation_generation: NonZeroU32,
        phase: IndexProgressPhase,
        processed_files: usize,
        total_files: Option<usize>,
    ) -> Self {
        Self {
            operation_generation,
            phase,
            processed_files,
            root_path: root_path.to_string_lossy().to_string(),
            total_files,
        }
    }
}

pub trait MetadataScanEventSink: Send + Sync {
    fn emit_completion(&self, event: MetadataScanCompletionEvent);

    /// Incremental progress during indexing. Defaulted to a no-op so non-progress sinks (initial
    /// scan, tests) opt in only when they care; progress is best-effort and never blocks the index.
    fn emit_progress(&self, _event: IndexProgressEvent) {}
}

pub trait WorkspaceMetadataScanStarter {
    fn start(
        &self,
        request: WorkspaceMetadataScanRequest,
        event_sink: Arc<dyn MetadataScanEventSink>,
    ) -> Result<InitialMetadataScanStart, MetadataScanStartError>;
}

pub struct LocalWorkspaceMetadataScanStarter;

impl WorkspaceMetadataScanStarter for LocalWorkspaceMetadataScanStarter {
    fn start(
        &self,
        request: WorkspaceMetadataScanRequest,
        event_sink: Arc<dyn MetadataScanEventSink>,
    ) -> Result<InitialMetadataScanStart, MetadataScanStartError> {
        let root_path = request.root_path;
        let database_path = request.database_path;
        let operation_authority = request.operation_authority;
        let operation_generation = request.operation_generation;
        let thread_root_path = root_path.clone();
        let thread_database_path = database_path.clone();

        thread::Builder::new()
            .name("workspace-metadata-scan".to_string())
            .spawn(move || {
                run_background_scan(
                    thread_root_path,
                    thread_database_path,
                    operation_authority,
                    operation_generation,
                    event_sink,
                )
            })
            .map_err(MetadataScanStartError::Spawn)?;

        Ok(InitialMetadataScanStart {
            database_path: database_path.to_string_lossy().to_string(),
            operation_generation,
            root_path: root_path.to_string_lossy().to_string(),
            status: InitialMetadataScanStartStatus::Started,
        })
    }
}

#[derive(Debug)]
pub enum MetadataScanError {
    Cancelled,
    Io(io::Error),
    Store(rusqlite::Error),
}

impl fmt::Display for MetadataScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => write!(formatter, "metadata scan cancelled"),
            Self::Io(error) => write!(formatter, "metadata scan IO failed: {error}"),
            Self::Store(error) => write!(formatter, "metadata scan DB write failed: {error}"),
        }
    }
}

impl Error for MetadataScanError {}

impl From<io::Error> for MetadataScanError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for MetadataScanError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error)
    }
}

#[derive(Debug)]
pub enum MetadataScanStartError {
    Spawn(io::Error),
}

impl fmt::Display for MetadataScanStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(error) => write!(formatter, "failed to start metadata scan: {error}"),
        }
    }
}

impl Error for MetadataScanStartError {}

fn run_background_scan(
    root_path: PathBuf,
    database_path: PathBuf,
    operation_authority: Option<WorkspaceIndexOperationAuthority>,
    operation_generation: NonZeroU32,
    event_sink: Arc<dyn MetadataScanEventSink>,
) {
    let progress_sink = Arc::clone(&event_sink);
    let progress_authority = operation_authority.clone();
    let mut on_progress = move |event: IndexProgressEvent| {
        run_if_index_operation_current(progress_authority.as_ref(), || {
            progress_sink.emit_progress(event)
        });
    };
    let event = match scan_background_workspace_with_progress(
        &root_path,
        &database_path,
        operation_authority.as_ref(),
        operation_generation,
        &mut on_progress,
    ) {
        Ok(report) => {
            if !operation_authority_is_current(operation_authority.as_ref()) {
                return;
            }

            MetadataScanCompletionEvent::completed(
                &root_path,
                &database_path,
                operation_generation,
                report,
            )
        }
        Err(MetadataScanError::Cancelled) => return,
        Err(error) => MetadataScanCompletionEvent::failed(
            &root_path,
            &database_path,
            operation_generation,
            error,
        ),
    };

    run_if_index_operation_current(operation_authority.as_ref(), || {
        event_sink.emit_completion(event)
    });
}

#[cfg(test)]
fn scan_background_workspace(
    root_path: &Path,
    database_path: &Path,
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
) -> Result<MetadataScanReport, MetadataScanError> {
    scan_background_workspace_with_progress(
        root_path,
        database_path,
        operation_authority,
        NonZeroU32::MIN,
        &mut |_event| {},
    )
}

fn scan_background_workspace_with_progress(
    root_path: &Path,
    database_path: &Path,
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
    operation_generation: NonZeroU32,
    on_progress: &mut dyn FnMut(IndexProgressEvent),
) -> Result<MetadataScanReport, MetadataScanError> {
    ensure_scan_current(operation_authority)?;
    let index = SqliteWorkspaceIndex::open(database_path)?;
    let scanner = LocalWorkspaceMetadataScanner::default();
    let is_cancelled = || !operation_authority_is_current(operation_authority);
    let collection = match operation_authority {
        Some(authority) => scanner.collect_registered_root_with_cancellation(
            root_path,
            authority,
            &is_cancelled,
        )?,
        None => scanner.collect_path_with_cancellation(root_path, root_path, &is_cancelled)?,
    };
    ensure_scan_current(operation_authority)?;

    let total_files = collection.records.len();
    let mut processed_files = 0;

    for batch in collection.records.chunks(SCAN_WRITE_BATCH_SIZE) {
        // Re-check the lifecycle token BEFORE each batch (not just at the end) so a workspace
        // switch cancels the scan promptly; already-committed batches remain a valid partial
        // index, and we never open a transaction past a cancellation point.
        ensure_scan_current(operation_authority)?;
        guarded_scan_batch(&index, operation_authority, |store| {
            for record in batch {
                store.upsert_file(record)?;
            }
            Ok(())
        })?;
        processed_files += batch.len();
        on_progress(IndexProgressEvent::new(
            root_path,
            operation_generation,
            IndexProgressPhase::Scanning,
            processed_files,
            Some(total_files),
        ));
    }

    Ok(collection.report)
}

/// Writes one batch in a single transaction whose COMMIT is gated by the lifecycle token, so the
/// commit is atomic with the current-generation check (no batch can land after a workspace cancel).
/// A cancelled batch is rolled back and surfaced as `Cancelled`.
fn guarded_scan_batch(
    index: &SqliteWorkspaceIndex,
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
    action: impl FnOnce(&SqliteWorkspaceIndex) -> rusqlite::Result<()>,
) -> Result<(), MetadataScanError> {
    let Some(token) = operation_authority else {
        return index
            .with_batch_transaction(action)
            .map_err(MetadataScanError::Store);
    };

    let outcome = index
        .with_guarded_batch_transaction(action, |commit| token.run_if_current(commit))
        .map_err(MetadataScanError::Store)?;

    match outcome {
        BatchOutcome::Committed(()) => Ok(()),
        BatchOutcome::RolledBack => Err(MetadataScanError::Cancelled),
    }
}

fn ensure_scan_current(
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
) -> Result<(), MetadataScanError> {
    if operation_authority_is_current(operation_authority) {
        return Ok(());
    }

    Err(MetadataScanError::Cancelled)
}

fn ensure_collection_current(is_cancelled: &dyn Fn() -> bool) -> Result<(), MetadataScanError> {
    if !is_cancelled() {
        return Ok(());
    }

    Err(MetadataScanError::Cancelled)
}

fn operation_authority_is_current(
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
) -> bool {
    match operation_authority {
        Some(token) => token.is_current(),
        None => true,
    }
}

fn relative_path(root_path: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root_path)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn scan_detail_path(root_path: &Path, path: &Path) -> String {
    match relative_path(root_path, path) {
        Some(path) => path,
        None => path.to_string_lossy().to_string(),
    }
}

fn absolute_candidate(root_path: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    root_path.join(path)
}

fn modified_at_unix(metadata: &fs::Metadata) -> i64 {
    match metadata.modified() {
        Ok(modified) => system_time_unix(modified),
        Err(_) => 0,
    }
}

fn system_time_unix(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => 0,
    }
}

fn size_bytes(metadata: &fs::Metadata) -> i64 {
    i64::try_from(metadata.len()).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        ExtensionMetadataLanguageDetector, IndexProgressEvent, IndexProgressPhase,
        InitialMetadataScanStart, InitialMetadataScanStartStatus, LocalWorkspaceMetadataScanner,
        MetadataLanguageDetector, MetadataScanCompletionEvent, MetadataScanCompletionStatus,
        MetadataScanEventSink, MetadataScanReport, WorkspaceIndexOperationAuthority,
        WorkspaceMetadataScanRequest, WorkspaceMetadataScanStarter, WorkspaceMetadataScanner,
    };
    use crate::index::{SqliteWorkspaceIndex, WorkspaceIndexStore};
    use crate::job_scheduler::WorkspaceIndexLifecycle;
    use crate::workspace_registry::WorkspaceRegistry;
    use rusqlite::Connection;
    use std::{
        fs,
        num::NonZeroU32,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            mpsc, Arc, Mutex,
        },
        time::Duration,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn records_eligible_workspace_files_into_sqlite_index() {
        let root = temp_workspace("records");
        let database_path = temp_database_path("records");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::write(root.join("src/User.php"), "<?php final class User {}").expect("php file");
        fs::write(root.join("README.md"), "# Project").expect("markdown file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let report = LocalWorkspaceMetadataScanner::default()
            .scan(&root, &index)
            .expect("scan workspace");

        assert_eq!(
            report,
            MetadataScanReport {
                changed_files: 0,
                error_details: Vec::new(),
                errored_entries: 0,
                indexed_files: 2,
                parsed_files: 0,
                removed_files: 0,
                skipped_details: Vec::new(),
                skipped_entries: 0,
                symbols_indexed: 0,
            }
        );
        assert_eq!(index.summary().expect("summary").file_count, 2);
        drop(index);

        let records = indexed_records(&database_path);
        assert_eq!(
            records,
            vec![
                ("README.md".to_string(), "markdown".to_string(), 9),
                ("src/User.php".to_string(), "php".to_string(), 25),
            ]
        );
    }

    #[test]
    fn index_operation_events_serialize_exact_generation_contract() {
        let generation = NonZeroU32::new(4_294_967_295).expect("generation");
        let root = Path::new("/workspace");
        let database = Path::new("/config/index.sqlite3");
        let start = InitialMetadataScanStart {
            database_path: database.to_string_lossy().to_string(),
            operation_generation: generation,
            root_path: root.to_string_lossy().to_string(),
            status: InitialMetadataScanStartStatus::Started,
        };
        let progress =
            IndexProgressEvent::new(root, generation, IndexProgressPhase::Parsing, 3, Some(5));
        let completion = MetadataScanCompletionEvent::completed(
            root,
            database,
            generation,
            MetadataScanReport::default(),
        );

        assert_eq!(
            serde_json::to_value(start).expect("serialize start"),
            serde_json::json!({
                "databasePath": "/config/index.sqlite3",
                "operationGeneration": 4_294_967_295_u64,
                "rootPath": "/workspace",
                "status": "started"
            })
        );
        assert_eq!(
            serde_json::to_value(progress).expect("serialize progress"),
            serde_json::json!({
                "operationGeneration": 4_294_967_295_u64,
                "phase": "parsing",
                "processedFiles": 3,
                "rootPath": "/workspace",
                "totalFiles": 5
            })
        );
        let completion = serde_json::to_value(completion).expect("serialize completion");
        assert_eq!(completion["operationGeneration"], 4_294_967_295_u64);
        assert_eq!(completion["rootPath"], "/workspace");
        assert_eq!(completion["status"], "completed");
    }

    #[test]
    fn respects_gitignore_and_default_ignored_directories() {
        let root = temp_workspace("ignores");
        let database_path = temp_database_path("ignores");
        fs::write(root.join(".gitignore"), "generated/\n*.log\n").expect("gitignore");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::create_dir_all(root.join("generated")).expect("generated directory");
        fs::create_dir_all(root.join("vendor/package")).expect("vendor directory");
        fs::write(root.join("src/User.php"), "<?php").expect("source file");
        fs::write(root.join("debug.log"), "debug").expect("log file");
        fs::write(root.join("generated/Generated.php"), "<?php").expect("generated file");
        fs::write(root.join("vendor/package/Package.php"), "<?php").expect("vendor file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let report = LocalWorkspaceMetadataScanner::default()
            .scan(&root, &index)
            .expect("scan workspace");

        assert_eq!(report.errored_entries, 0);
        assert_eq!(report.indexed_files, 2);
        assert_eq!(report.skipped_entries, 3);
        let mut skipped_details = report
            .skipped_details
            .iter()
            .map(|detail| (detail.path.as_str(), detail.reason.as_str()))
            .collect::<Vec<_>>();
        skipped_details.sort();
        assert_eq!(
            skipped_details,
            vec![
                ("debug.log", "Ignored by workspace rules."),
                ("generated", "Ignored by workspace rules."),
                ("vendor", "Ignored by workspace rules."),
            ]
        );
        drop(index);

        let relative_paths: Vec<String> = indexed_records(&database_path)
            .into_iter()
            .map(|record| record.0)
            .collect();
        assert_eq!(
            relative_paths,
            vec![".gitignore".to_string(), "src/User.php".to_string()]
        );
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinked_files_and_directories() {
        use std::os::unix::fs::symlink;

        let root = temp_workspace("symlinks");
        let outside = temp_workspace("outside");
        let database_path = temp_database_path("symlinks");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::write(root.join("src/User.php"), "<?php").expect("source file");
        fs::write(outside.join("Secret.php"), "<?php").expect("outside file");
        symlink(outside.join("Secret.php"), root.join("Secret.php")).expect("file symlink");
        symlink(&outside, root.join("outside")).expect("directory symlink");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let report = LocalWorkspaceMetadataScanner::default()
            .scan(&root, &index)
            .expect("scan workspace");

        assert_eq!(report.errored_entries, 0);
        assert_eq!(report.indexed_files, 1);
        assert_eq!(report.skipped_entries, 2);
        assert_eq!(
            report
                .skipped_details
                .iter()
                .map(|detail| detail.reason.as_str())
                .collect::<Vec<_>>(),
            vec!["Symlink skipped.", "Symlink skipped."]
        );
        drop(index);

        let relative_paths: Vec<String> = indexed_records(&database_path)
            .into_iter()
            .map(|record| record.0)
            .collect();
        assert_eq!(relative_paths, vec!["src/User.php".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn registered_scan_stays_bound_to_admitted_root_after_path_replacement() {
        let root = temp_workspace("registered-root-replacement");
        fs::write(root.join("Original.php"), "<?php").expect("original source");
        let moved = root.with_extension("admitted");
        let registry = WorkspaceRegistry::new();
        let registration = registry.register_with_receipt(&root).expect("registration");
        let lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .expect("operation lease");
        let root_key = registration
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .to_string();
        let authority = WorkspaceIndexOperationAuthority::new(
            WorkspaceIndexLifecycle::new().begin_workspace_run(&root_key),
            lease,
        )
        .expect("operation authority");

        fs::rename(&root, &moved).expect("move admitted root");
        fs::create_dir_all(&root).expect("replacement root");
        fs::write(root.join("Replacement.php"), "<?php").expect("replacement source");

        let collection = LocalWorkspaceMetadataScanner::default()
            .collect_registered_root_with_cancellation(&root, &authority, &|| false)
            .expect("registered scan");
        let relative_paths = collection
            .records
            .into_iter()
            .map(|record| record.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(relative_paths, vec!["Original.php"]);
        fs::remove_dir_all(root).expect("replacement cleanup");
        fs::remove_dir_all(moved).expect("admitted cleanup");
    }

    #[test]
    fn detects_metadata_languages_by_extension() {
        let detector = ExtensionMetadataLanguageDetector;

        assert_eq!(detector.language_for_path(Path::new("User.php")), "php");
        assert_eq!(
            detector.language_for_path(Path::new("app.tsx")),
            "typescript"
        );
        assert_eq!(
            detector.language_for_path(Path::new("server.mjs")),
            "javascript"
        );
        assert_eq!(
            detector.language_for_path(Path::new("server.cts")),
            "typescript"
        );
        assert_eq!(detector.language_for_path(Path::new("README")), "plaintext");
    }

    #[test]
    fn health_details_are_capped_while_counts_keep_growing() {
        let mut report = MetadataScanReport::default();

        for index in 0..105 {
            report.record_skip(format!("vendor/{index}.php"), "Ignored by workspace rules.");
            report.record_error(format!("broken/{index}.php"), "Metadata could not be read.");
        }

        assert_eq!(report.skipped_entries, 105);
        assert_eq!(report.errored_entries, 105);
        assert_eq!(report.skipped_details.len(), 100);
        assert_eq!(report.error_details.len(), 100);
        assert_eq!(report.skipped_details[99].path, "vendor/99.php");
        assert_eq!(report.error_details[99].path, "broken/99.php");
    }

    #[test]
    fn cancelled_background_scan_does_not_write_records() {
        let root = temp_workspace("cancelled-background");
        let database_path = temp_database_path("cancelled-background");
        fs::write(root.join("User.php"), "<?php").expect("source file");
        let lifecycle = WorkspaceIndexLifecycle::new();
        let root_key = root.to_string_lossy().to_string();
        let token = lifecycle.begin_workspace_run(&root_key);
        let authority = WorkspaceIndexOperationAuthority::lifecycle(token);

        lifecycle.cancel_workspace(&root_key);

        let error = super::scan_background_workspace(&root, &database_path, Some(&authority))
            .expect_err("cancelled scan");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        assert!(matches!(error, super::MetadataScanError::Cancelled));
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn cancellation_interrupts_ignore_scope_discovery_before_metadata_traversal() {
        let root = wide_workspace("cancel-ignore-scopes", 300);
        let cancelled = Arc::new(AtomicBool::new(false));
        let observed_files = Arc::new(AtomicUsize::new(0));
        let scanner =
            LocalWorkspaceMetadataScanner::new(Box::new(CancellationAwareLanguageDetector {
                cancelled: Arc::clone(&cancelled),
                observed_files: Arc::clone(&observed_files),
            }));
        let probe_count = AtomicUsize::new(0);
        let cancellation_probe = || {
            let should_cancel = probe_count.fetch_add(1, Ordering::SeqCst) >= 40;
            if should_cancel {
                cancelled.store(true, Ordering::SeqCst);
            }
            should_cancel
        };

        let error = scanner
            .collect_path_with_cancellation(&root, &root, &cancellation_probe)
            .expect_err("collection cancelled during traversal");

        assert!(matches!(error, super::MetadataScanError::Cancelled));
        assert!(cancelled.load(Ordering::SeqCst));
        assert!(probe_count.load(Ordering::SeqCst) <= 42);
        assert_eq!(observed_files.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn cancellation_interrupts_metadata_traversal_without_classifying_later_files() {
        let root = wide_workspace("cancel-metadata-traversal", 300);
        let cancelled = Arc::new(AtomicBool::new(false));
        let observed_files = Arc::new(AtomicUsize::new(0));
        let scanner =
            LocalWorkspaceMetadataScanner::new(Box::new(CancellationAwareLanguageDetector {
                cancelled: Arc::clone(&cancelled),
                observed_files: Arc::clone(&observed_files),
            }));
        let cancellation_probe = || {
            let should_cancel = observed_files.load(Ordering::SeqCst) >= 20;
            if should_cancel {
                cancelled.store(true, Ordering::SeqCst);
            }
            should_cancel
        };

        let error = scanner
            .collect_path_with_cancellation(&root, &root, &cancellation_probe)
            .expect_err("collection cancelled during metadata traversal");

        assert!(matches!(error, super::MetadataScanError::Cancelled));
        assert!(cancelled.load(Ordering::SeqCst));
        assert_eq!(observed_files.load(Ordering::SeqCst), 20);
    }

    #[test]
    fn background_scan_writes_all_files_across_batch_boundaries() {
        // More files than one write batch (SCAN_WRITE_BATCH_SIZE): the batched scan must still
        // persist every metadata row across batch boundaries.
        let file_count = super::SCAN_WRITE_BATCH_SIZE + 25;
        let root = temp_workspace("scan-batch-boundary");
        let database_path = temp_database_path("scan-batch-boundary");
        for index in 0..file_count {
            fs::write(root.join(format!("File{index}.php")), "<?php").expect("source file");
        }

        let report =
            super::scan_background_workspace(&root, &database_path, None).expect("background scan");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        assert_eq!(report.indexed_files, file_count);
        assert_eq!(
            index.summary().expect("summary").file_count as usize,
            file_count
        );
    }

    #[test]
    fn background_scan_emits_incremental_progress_on_batch_boundaries() {
        // Cold initial indexing must not look hung on a large workspace: emit
        // progress after each committed metadata batch, with the total known.
        let file_count = super::SCAN_WRITE_BATCH_SIZE + 25;
        let root = temp_workspace("scan-progress-batches");
        let database_path = temp_database_path("scan-progress-batches");
        for index in 0..file_count {
            fs::write(root.join(format!("File{index}.php")), "<?php").expect("source file");
        }
        let mut events = Vec::new();

        let report = super::scan_background_workspace_with_progress(
            &root,
            &database_path,
            None,
            NonZeroU32::new(7).expect("generation"),
            &mut |event| events.push(event),
        )
        .expect("background scan");

        assert_eq!(report.indexed_files, file_count);
        assert_eq!(events.len(), 2);
        assert_eq!(
            events
                .iter()
                .map(|event| event.processed_files)
                .collect::<Vec<_>>(),
            vec![super::SCAN_WRITE_BATCH_SIZE, file_count]
        );
        assert!(events
            .iter()
            .all(|event| event.root_path == root.to_string_lossy()));
        assert!(events
            .iter()
            .all(|event| event.operation_generation.get() == 7));
        assert!(events
            .iter()
            .all(|event| event.phase == IndexProgressPhase::Scanning
                && event.total_files == Some(file_count)));
    }

    #[test]
    fn starter_emits_completion_event_after_background_scan() {
        let root = temp_workspace("start-complete");
        let database_path = temp_database_path("start-complete");
        fs::write(root.join("User.php"), "<?php").expect("source file");
        let (sink, receiver) = channel_sink();

        let start = super::LocalWorkspaceMetadataScanStarter
            .start(
                WorkspaceMetadataScanRequest {
                    database_path: database_path.clone(),
                    operation_authority: None,
                    operation_generation: NonZeroU32::new(7).expect("generation"),
                    root_path: root.clone(),
                },
                sink,
            )
            .expect("start scan");

        assert_eq!(start.operation_generation.get(), 7);

        let event = receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("completion event");

        assert_eq!(event.status, MetadataScanCompletionStatus::Completed);
        assert_eq!(event.operation_generation.get(), 7);
        assert_eq!(event.report.expect("scan report").indexed_files, 1);
        assert_eq!(indexed_records(&database_path).len(), 1);
    }

    #[test]
    fn starter_emits_failure_event_when_background_scan_fails() {
        let root = temp_workspace("start-failure");
        let blocked_parent = root.join("blocked");
        fs::write(&blocked_parent, "not a directory").expect("blocked parent");
        let database_path = blocked_parent.join("index.sqlite3");
        let (sink, receiver) = channel_sink();

        let start = super::LocalWorkspaceMetadataScanStarter
            .start(
                WorkspaceMetadataScanRequest {
                    database_path,
                    operation_authority: None,
                    operation_generation: NonZeroU32::new(7).expect("generation"),
                    root_path: root,
                },
                sink,
            )
            .expect("start scan");

        assert_eq!(start.operation_generation.get(), 7);

        let event = receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("failure event");

        assert_eq!(event.status, MetadataScanCompletionStatus::Failed);
        assert_eq!(event.operation_generation.get(), 7);
        assert!(event
            .message
            .expect("error message")
            .contains("metadata scan"));
        assert!(event.report.is_none());
    }

    fn indexed_records(database_path: &Path) -> Vec<(String, String, i64)> {
        let connection = Connection::open(database_path).expect("open database");
        let mut statement = connection
            .prepare(
                "
                SELECT relative_path, language, size_bytes
                FROM workspace_files
                ORDER BY relative_path
                ",
            )
            .expect("prepare records");
        let records = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .expect("query records");

        records
            .map(|record| record.expect("record"))
            .collect::<Vec<_>>()
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-scan-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
    }

    fn wide_workspace(label: &str, file_count: usize) -> PathBuf {
        let root = temp_workspace(label);
        let source_directory = root.join("src");
        fs::create_dir_all(&source_directory).expect("source directory");
        for index in 0..file_count {
            fs::write(source_directory.join(format!("File{index}.php")), "<?php")
                .expect("source file");
        }
        root
    }

    fn temp_database_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("editor-scan-db-{label}-{}", unique_suffix()))
            .join("index.sqlite3")
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn channel_sink() -> (
        Arc<dyn MetadataScanEventSink>,
        mpsc::Receiver<MetadataScanCompletionEvent>,
    ) {
        let (sender, receiver) = mpsc::channel();

        (
            Arc::new(ChannelMetadataScanEventSink {
                sender: Mutex::new(sender),
            }),
            receiver,
        )
    }

    struct ChannelMetadataScanEventSink {
        sender: Mutex<mpsc::Sender<MetadataScanCompletionEvent>>,
    }

    struct CancellationAwareLanguageDetector {
        cancelled: Arc<AtomicBool>,
        observed_files: Arc<AtomicUsize>,
    }

    impl MetadataLanguageDetector for CancellationAwareLanguageDetector {
        fn language_for_path(&self, _path: &Path) -> String {
            assert!(
                !self.cancelled.load(Ordering::SeqCst),
                "no file may be classified after cancellation"
            );
            self.observed_files.fetch_add(1, Ordering::SeqCst);
            "php".to_string()
        }
    }

    impl MetadataScanEventSink for ChannelMetadataScanEventSink {
        fn emit_completion(&self, event: MetadataScanCompletionEvent) {
            let _ = self.sender.lock().expect("sink lock").send(event);
        }
    }
}
