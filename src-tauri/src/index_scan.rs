use crate::ignore_matcher::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher};
use crate::index::{SqliteWorkspaceIndex, WorkspaceFileRecord, WorkspaceIndexStore};
use serde::Serialize;
use std::{
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

pub const METADATA_SCAN_COMPLETED_EVENT: &str = "index://metadata-scan-completed";

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
            "js" | "jsx" => "javascript".to_string(),
            "json" => "json".to_string(),
            "md" => "markdown".to_string(),
            "php" => "php".to_string(),
            "rs" => "rust".to_string(),
            "ts" | "tsx" => "typescript".to_string(),
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
                collection.report.errored_entries += 1;
                return Ok(());
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    collection.report.errored_entries += 1;
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
                collection.report.errored_entries += 1;
                return Ok(());
            }
        };
        let file_type = file_type.file_type();

        if file_type.is_symlink() {
            collection.report.skipped_entries += 1;
            return Ok(());
        }

        if matcher.is_ignored(&path, file_type.is_dir()) {
            collection.report.skipped_entries += 1;
            return Ok(());
        }

        if file_type.is_dir() {
            self.scan_directory(root_path, path, matcher, collection)?;
            return Ok(());
        }

        if !file_type.is_file() {
            collection.report.skipped_entries += 1;
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
                collection.report.errored_entries += 1;
                return Ok(());
            }
        };
        let canonical_path = match path.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                collection.report.errored_entries += 1;
                return Ok(());
            }
        };
        let relative_path = match relative_path(root_path, &canonical_path) {
            Some(path) => path,
            None => {
                collection.report.skipped_entries += 1;
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
    pub errored_entries: usize,
    pub indexed_files: usize,
    pub skipped_entries: usize,
}

#[derive(Debug, Default, Clone, Eq, PartialEq)]
pub struct MetadataScanCollection {
    pub records: Vec<WorkspaceFileRecord>,
    pub report: MetadataScanReport,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct WorkspaceMetadataScanRequest {
    pub database_path: PathBuf,
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
    fn completed(root_path: &Path, database_path: &Path, report: MetadataScanReport) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: None,
            report: Some(report),
            root_path: root_path.to_string_lossy().to_string(),
            status: MetadataScanCompletionStatus::Completed,
        }
    }

    fn failed(root_path: &Path, database_path: &Path, error: MetadataScanError) -> Self {
        Self {
            database_path: database_path.to_string_lossy().to_string(),
            message: Some(error.to_string()),
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

pub trait MetadataScanEventSink: Send + Sync {
    fn emit_completion(&self, event: MetadataScanCompletionEvent);
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
        let thread_root_path = root_path.clone();
        let thread_database_path = database_path.clone();

        thread::Builder::new()
            .name("workspace-metadata-scan".to_string())
            .spawn(move || run_background_scan(thread_root_path, thread_database_path, event_sink))
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
    Io(io::Error),
    Store(rusqlite::Error),
}

impl fmt::Display for MetadataScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
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
    event_sink: Arc<dyn MetadataScanEventSink>,
) {
    let event = match scan_background_workspace(&root_path, &database_path) {
        Ok(report) => MetadataScanCompletionEvent::completed(&root_path, &database_path, report),
        Err(error) => MetadataScanCompletionEvent::failed(&root_path, &database_path, error),
    };

    event_sink.emit_completion(event);
}

fn scan_background_workspace(
    root_path: &Path,
    database_path: &Path,
) -> Result<MetadataScanReport, MetadataScanError> {
    let index = SqliteWorkspaceIndex::open(database_path)?;
    let scanner = LocalWorkspaceMetadataScanner::default();

    scanner.scan(root_path, &index)
}

fn relative_path(root_path: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root_path)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
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
                errored_entries: 0,
                indexed_files: 2,
                skipped_entries: 0,
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
        assert_eq!(detector.language_for_path(Path::new("README")), "plaintext");
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
