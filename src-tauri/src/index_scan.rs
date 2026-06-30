use crate::ignore_matcher::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher};
use crate::index::{BatchOutcome, SqliteWorkspaceIndex, WorkspaceFileRecord, WorkspaceIndexStore};
use crate::job_scheduler::WorkspaceIndexLifecycleToken;
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

pub const METADATA_SCAN_COMPLETED_EVENT: &str = "index://metadata-scan-completed";
pub const INDEX_PROGRESS_EVENT: &str = "index://progress";
const MAX_SCAN_HEALTH_DETAILS: usize = 100;
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
    ) -> Result<(), MetadataScanError> {
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
            self.scan_entry(root_path, &entry.path(), matcher, collection)?;
        }

        Ok(())
    }

    fn scan_entry(
        &self,
        root_path: &Path,
        path: &Path,
        matcher: &dyn WorkspaceIgnoreMatcher,
        collection: &mut MetadataScanCollection,
    ) -> Result<(), MetadataScanError> {
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

        if matcher.is_ignored(&path, file_type.is_dir()) {
            collection.report.record_skip(
                scan_detail_path(root_path, path),
                "Ignored by workspace rules.",
            );
            return Ok(());
        }

        if file_type.is_dir() {
            self.scan_directory(root_path, path, matcher, collection)?;
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

impl WorkspaceMetadataScanner for LocalWorkspaceMetadataScanner {
    fn collect_path(
        &self,
        root_path: &Path,
        scan_path: &Path,
    ) -> Result<MetadataScanCollection, MetadataScanError> {
        let root_path = root_path.canonicalize()?;
        let scan_path = absolute_candidate(&root_path, scan_path);
        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root_path)?;
        let mut collection = MetadataScanCollection::default();

        if !scan_path.exists() {
            return Ok(collection);
        }

        self.scan_entry(&root_path, &scan_path, &matcher, &mut collection)?;

        Ok(collection)
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

#[derive(Debug, Clone)]
pub struct WorkspaceMetadataScanRequest {
    pub database_path: PathBuf,
    pub lifecycle_token: Option<WorkspaceIndexLifecycleToken>,
    pub root_path: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialMetadataScanStart {
    pub database_path: String,
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
    pub report: Option<MetadataScanReport>,
    pub root_path: String,
    pub status: MetadataScanCompletionStatus,
}

impl MetadataScanCompletionEvent {
    pub(crate) fn completed(
        root_path: &Path,
        database_path: &Path,
        report: MetadataScanReport,
    ) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: None,
            report: Some(report),
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Completed,
        }
    }

    pub(crate) fn failed(root_path: &Path, database_path: &Path, error: MetadataScanError) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: Some(error.to_string()),
            report: None,
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Failed,
        }
    }

    pub(crate) fn failed_message(root_path: &Path, database_path: &Path, message: String) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: Some(message),
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

/// Incremental progress emitted on batch boundaries during a workspace reindex so the UI can show
/// "X of N files" instead of an indeterminate spinner that looks like a hang. `total_files` is the
/// number of source files queued to parse for `phase`; it is `None` when unknown so the UI degrades
/// to an indeterminate count. Tagged with `root_path` so the frontend drops cross-workspace events.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgressEvent {
    pub phase: String,
    pub processed_files: usize,
    pub root_path: String,
    pub total_files: Option<usize>,
}

impl IndexProgressEvent {
    pub(crate) fn new(
        root_path: &Path,
        phase: impl Into<String>,
        processed_files: usize,
        total_files: Option<usize>,
    ) -> Self {
        Self {
            phase: phase.into(),
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
        let lifecycle_token = request.lifecycle_token;
        let thread_root_path = root_path.clone();
        let thread_database_path = database_path.clone();

        thread::Builder::new()
            .name("workspace-metadata-scan".to_string())
            .spawn(move || {
                run_background_scan(
                    thread_root_path,
                    thread_database_path,
                    lifecycle_token,
                    event_sink,
                )
            })
            .map_err(MetadataScanStartError::Spawn)?;

        Ok(InitialMetadataScanStart {
            database_path: database_path.to_string_lossy().to_string(),
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
    lifecycle_token: Option<WorkspaceIndexLifecycleToken>,
    event_sink: Arc<dyn MetadataScanEventSink>,
) {
    let event =
        match scan_background_workspace(&root_path, &database_path, lifecycle_token.as_ref()) {
            Ok(report) => {
                if !lifecycle_token_is_current(lifecycle_token.as_ref()) {
                    return;
                }

                MetadataScanCompletionEvent::completed(&root_path, &database_path, report)
            }
            Err(MetadataScanError::Cancelled) => return,
            Err(error) => MetadataScanCompletionEvent::failed(&root_path, &database_path, error),
        };

    event_sink.emit_completion(event);
}

fn scan_background_workspace(
    root_path: &Path,
    database_path: &Path,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
) -> Result<MetadataScanReport, MetadataScanError> {
    ensure_scan_current(lifecycle_token)?;
    let index = SqliteWorkspaceIndex::open(database_path)?;
    let scanner = LocalWorkspaceMetadataScanner::default();
    let collection = scanner.collect_path(root_path, root_path)?;
    ensure_scan_current(lifecycle_token)?;

    for batch in collection.records.chunks(SCAN_WRITE_BATCH_SIZE) {
        // Re-check the lifecycle token BEFORE each batch (not just at the end) so a workspace
        // switch cancels the scan promptly; already-committed batches remain a valid partial
        // index, and we never open a transaction past a cancellation point.
        ensure_scan_current(lifecycle_token)?;
        guarded_scan_batch(&index, lifecycle_token, |store| {
            for record in batch {
                store.upsert_file(record)?;
            }
            Ok(())
        })?;
    }

    Ok(collection.report)
}

/// Writes one batch in a single transaction whose COMMIT is gated by the lifecycle token, so the
/// commit is atomic with the current-generation check (no batch can land after a workspace cancel).
/// A cancelled batch is rolled back and surfaced as `Cancelled`.
fn guarded_scan_batch(
    index: &SqliteWorkspaceIndex,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    action: impl FnOnce(&SqliteWorkspaceIndex) -> rusqlite::Result<()>,
) -> Result<(), MetadataScanError> {
    let Some(token) = lifecycle_token else {
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
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
) -> Result<(), MetadataScanError> {
    if lifecycle_token_is_current(lifecycle_token) {
        return Ok(());
    }

    Err(MetadataScanError::Cancelled)
}

fn lifecycle_token_is_current(lifecycle_token: Option<&WorkspaceIndexLifecycleToken>) -> bool {
    match lifecycle_token {
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
    match i64::try_from(metadata.len()) {
        Ok(size) => size,
        Err(_) => i64::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ExtensionMetadataLanguageDetector, LocalWorkspaceMetadataScanner, MetadataLanguageDetector,
        MetadataScanCompletionEvent, MetadataScanCompletionStatus, MetadataScanEventSink,
        MetadataScanReport, WorkspaceMetadataScanRequest, WorkspaceMetadataScanStarter,
        WorkspaceMetadataScanner,
    };
    use crate::index::{SqliteWorkspaceIndex, WorkspaceIndexStore};
    use crate::job_scheduler::WorkspaceIndexLifecycle;
    use rusqlite::Connection;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{mpsc, Arc, Mutex},
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
        let token = lifecycle.begin_workspace_run(&root.to_string_lossy());

        lifecycle.cancel_workspace(token.workspace_root());

        let error = super::scan_background_workspace(&root, &database_path, Some(&token))
            .expect_err("cancelled scan");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        assert!(matches!(error, super::MetadataScanError::Cancelled));
        assert_eq!(index.summary().expect("summary").file_count, 0);
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
    fn starter_emits_completion_event_after_background_scan() {
        let root = temp_workspace("start-complete");
        let database_path = temp_database_path("start-complete");
        fs::write(root.join("User.php"), "<?php").expect("source file");
        let (sink, receiver) = channel_sink();

        super::LocalWorkspaceMetadataScanStarter
            .start(
                WorkspaceMetadataScanRequest {
                    database_path: database_path.clone(),
                    lifecycle_token: None,
                    root_path: root.clone(),
                },
                sink,
            )
            .expect("start scan");

        let event = receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("completion event");

        assert_eq!(event.status, MetadataScanCompletionStatus::Completed);
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

        super::LocalWorkspaceMetadataScanStarter
            .start(
                WorkspaceMetadataScanRequest {
                    database_path,
                    lifecycle_token: None,
                    root_path: root,
                },
                sink,
            )
            .expect("start scan");

        let event = receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("failure event");

        assert_eq!(event.status, MetadataScanCompletionStatus::Failed);
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

    impl MetadataScanEventSink for ChannelMetadataScanEventSink {
        fn emit_completion(&self, event: MetadataScanCompletionEvent) {
            let _ = self.sender.lock().expect("sink lock").send(event);
        }
    }
}
