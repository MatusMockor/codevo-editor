use crate::file_watcher::WorkspaceWatchEventBatch;
use crate::index::{
    commit_index_db_write, IndexCommitOutcome, WorkspaceFileRecord, WorkspaceIndexStore,
};
use crate::index_scan::{
    LocalWorkspaceMetadataScanner, MetadataScanError, WorkspaceMetadataScanner,
};
use crate::job_scheduler::{
    InMemoryIndexJobScheduler, IndexDbWriteOperation, IndexFileMetadata, IndexJobPayload,
    IndexWatchEventRouter, ScheduledIndexJob,
};
use std::{error::Error, fmt, path::Path};

pub trait WorkspaceIndexIncrementalUpdater {
    fn apply_watch_events(
        &mut self,
        batch: WorkspaceWatchEventBatch,
        store: &dyn WorkspaceIndexStore,
    ) -> Result<IndexIncrementalUpdateReport, IndexIncrementalUpdateError>;
}

pub struct LocalWorkspaceIndexIncrementalUpdater {
    metadata_scanner: Box<dyn WorkspaceMetadataScanner>,
    scheduler: InMemoryIndexJobScheduler,
}

impl Default for LocalWorkspaceIndexIncrementalUpdater {
    fn default() -> Self {
        Self::new(
            InMemoryIndexJobScheduler::default(),
            Box::new(LocalWorkspaceMetadataScanner::default()),
        )
    }
}

impl LocalWorkspaceIndexIncrementalUpdater {
    pub fn new(
        scheduler: InMemoryIndexJobScheduler,
        metadata_scanner: Box<dyn WorkspaceMetadataScanner>,
    ) -> Self {
        Self {
            metadata_scanner,
            scheduler,
        }
    }

    fn apply_job(
        &mut self,
        job: &ScheduledIndexJob,
        store: &dyn WorkspaceIndexStore,
        report: &mut IndexIncrementalUpdateReport,
    ) -> Result<(), IndexIncrementalUpdateError> {
        match &job.payload {
            IndexJobPayload::DbWrite { operation } => {
                self.commit_operation(job, store, operation, report)?;
                Ok(())
            }
            IndexJobPayload::MetadataScan { path } => {
                self.apply_metadata_scan(job, store, path, report)?;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn apply_metadata_scan(
        &self,
        job: &ScheduledIndexJob,
        store: &dyn WorkspaceIndexStore,
        path: &str,
        report: &mut IndexIncrementalUpdateReport,
    ) -> Result<(), IndexIncrementalUpdateError> {
        let collection = self
            .metadata_scanner
            .collect_path(Path::new(&job.workspace_root), Path::new(path))?;
        report.metadata_files += collection.report.indexed_files;
        report.scan_errors += collection.report.errored_entries;
        report.skipped_entries += collection.report.skipped_entries;

        for record in collection.records {
            let operation = IndexDbWriteOperation::UpsertFileMetadata {
                metadata: index_file_metadata(record),
            };
            self.commit_operation(job, store, &operation, report)?;
        }

        Ok(())
    }

    fn commit_operation(
        &self,
        job: &ScheduledIndexJob,
        store: &dyn WorkspaceIndexStore,
        operation: &IndexDbWriteOperation,
        report: &mut IndexIncrementalUpdateReport,
    ) -> Result<(), IndexIncrementalUpdateError> {
        match commit_index_db_write(store, &self.scheduler, &job.commit_scope(), operation)? {
            IndexCommitOutcome::Committed => {
                report.committed_writes += 1;
                count_committed_operation(operation, report);
            }
            IndexCommitOutcome::SkippedCancelled => {
                report.skipped_cancelled_writes += 1;
            }
            IndexCommitOutcome::SkippedStale => {
                report.skipped_stale_writes += 1;
            }
        }

        Ok(())
    }
}

impl WorkspaceIndexIncrementalUpdater for LocalWorkspaceIndexIncrementalUpdater {
    fn apply_watch_events(
        &mut self,
        batch: WorkspaceWatchEventBatch,
        store: &dyn WorkspaceIndexStore,
    ) -> Result<IndexIncrementalUpdateReport, IndexIncrementalUpdateError> {
        let jobs = self.scheduler.route_watch_events(batch);
        let mut report = IndexIncrementalUpdateReport {
            scheduled_jobs: jobs.len(),
            ..IndexIncrementalUpdateReport::default()
        };

        for job in jobs {
            self.apply_job(&job, store, &mut report)?;
        }

        Ok(report)
    }
}

#[derive(Debug, Default, Clone, Eq, PartialEq)]
pub struct IndexIncrementalUpdateReport {
    pub committed_writes: usize,
    pub metadata_files: usize,
    pub removed_files: usize,
    pub scheduled_jobs: usize,
    pub scan_errors: usize,
    pub skipped_cancelled_writes: usize,
    pub skipped_entries: usize,
    pub skipped_stale_writes: usize,
    pub upserted_files: usize,
}

#[derive(Debug)]
pub enum IndexIncrementalUpdateError {
    MetadataScan(MetadataScanError),
    Store(rusqlite::Error),
}

impl fmt::Display for IndexIncrementalUpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MetadataScan(error) => {
                write!(formatter, "incremental metadata scan failed: {error}")
            }
            Self::Store(error) => write!(formatter, "incremental index write failed: {error}"),
        }
    }
}

impl Error for IndexIncrementalUpdateError {}

impl From<MetadataScanError> for IndexIncrementalUpdateError {
    fn from(error: MetadataScanError) -> Self {
        Self::MetadataScan(error)
    }
}

impl From<rusqlite::Error> for IndexIncrementalUpdateError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error)
    }
}

fn count_committed_operation(
    operation: &IndexDbWriteOperation,
    report: &mut IndexIncrementalUpdateReport,
) {
    match operation {
        IndexDbWriteOperation::RemoveFile { .. } => report.removed_files += 1,
        IndexDbWriteOperation::UpsertFileMetadata { .. } => report.upserted_files += 1,
    }
}

fn index_file_metadata(record: WorkspaceFileRecord) -> IndexFileMetadata {
    IndexFileMetadata {
        language: record.language,
        modified_at_unix: record.modified_at_unix,
        path: record.path,
        relative_path: record.relative_path,
        size_bytes: record.size_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        IndexIncrementalUpdateReport, LocalWorkspaceIndexIncrementalUpdater,
        WorkspaceIndexIncrementalUpdater,
    };
    use crate::file_watcher::{
        WorkspaceWatchBackend, WorkspaceWatchEvent, WorkspaceWatchEventBatch,
        WorkspaceWatchEventKind, WorkspaceWatchFileKind,
    };
    use crate::index::{SqliteWorkspaceIndex, WorkspaceFileRecord, WorkspaceIndexStore};
    use rusqlite::Connection;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn modified_file_event_upserts_current_metadata() {
        let root = temp_workspace("modify");
        let database_path = temp_database_path("modify");
        let source = root.join("src/User.php");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::write(&source, "<?php").expect("initial file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record(&source, "src/User.php", 5))
            .expect("seed file");
        fs::write(&source, "<?php final class User {}").expect("modified file");

        let report = LocalWorkspaceIndexIncrementalUpdater::default()
            .apply_watch_events(
                WorkspaceWatchEventBatch {
                    events: vec![watch_event(
                        &root,
                        WorkspaceWatchEventKind::Modified,
                        "src/User.php",
                    )],
                },
                &index,
            )
            .expect("apply event");

        assert_eq!(report.upserted_files, 1);
        assert_eq!(record_size(&database_path, "src/User.php"), 25);
    }

    #[test]
    fn delete_event_removes_index_record() {
        let root = temp_workspace("delete");
        let database_path = temp_database_path("delete");
        let source = root.join("src/User.php");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::write(&source, "<?php").expect("source file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record(&source, "src/User.php", 5))
            .expect("seed file");
        fs::remove_file(&source).expect("delete file");

        let report = LocalWorkspaceIndexIncrementalUpdater::default()
            .apply_watch_events(
                WorkspaceWatchEventBatch {
                    events: vec![watch_event(
                        &root,
                        WorkspaceWatchEventKind::Deleted,
                        "src/User.php",
                    )],
                },
                &index,
            )
            .expect("apply event");

        assert_eq!(report.removed_files, 1);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn rename_event_removes_old_record_and_upserts_new_record() {
        let root = temp_workspace("rename");
        let database_path = temp_database_path("rename");
        let old_path = root.join("src/Old.php");
        let new_path = root.join("src/New.php");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::write(&old_path, "<?php").expect("old file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record(&old_path, "src/Old.php", 5))
            .expect("seed file");
        fs::rename(&old_path, &new_path).expect("rename file");

        let report = LocalWorkspaceIndexIncrementalUpdater::default()
            .apply_watch_events(
                WorkspaceWatchEventBatch {
                    events: vec![rename_event(&root, "src/Old.php", "src/New.php")],
                },
                &index,
            )
            .expect("apply event");

        assert_eq!(report.removed_files, 1);
        assert_eq!(report.upserted_files, 1);
        assert_eq!(index.summary().expect("summary").file_count, 1);
        assert_eq!(
            relative_paths(&database_path),
            vec!["src/New.php".to_string()]
        );
    }

    #[test]
    fn ignored_modified_file_does_not_upsert_record() {
        let root = temp_workspace("ignored");
        let database_path = temp_database_path("ignored");
        fs::write(root.join(".gitignore"), "generated/\n").expect("gitignore");
        fs::create_dir_all(root.join("generated")).expect("generated directory");
        fs::write(root.join("generated/User.php"), "<?php").expect("ignored file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let report = LocalWorkspaceIndexIncrementalUpdater::default()
            .apply_watch_events(
                WorkspaceWatchEventBatch {
                    events: vec![watch_event(
                        &root,
                        WorkspaceWatchEventKind::Modified,
                        "generated/User.php",
                    )],
                },
                &index,
            )
            .expect("apply event");

        assert_eq!(
            report,
            IndexIncrementalUpdateReport {
                scheduled_jobs: 1,
                skipped_entries: 1,
                ..IndexIncrementalUpdateReport::default()
            }
        );
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    fn watch_event(
        root: &Path,
        kind: WorkspaceWatchEventKind,
        relative_path: &str,
    ) -> WorkspaceWatchEvent {
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::File),
            kind,
            path: path_string(&root.join(relative_path)),
            previous_path: None,
            previous_relative_path: None,
            relative_path: relative_path.to_string(),
            root_path: path_string(root),
        }
    }

    fn rename_event(
        root: &Path,
        previous_relative_path: &str,
        relative_path: &str,
    ) -> WorkspaceWatchEvent {
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::File),
            kind: WorkspaceWatchEventKind::Renamed,
            path: path_string(&root.join(relative_path)),
            previous_path: Some(path_string(&root.join(previous_relative_path))),
            previous_relative_path: Some(previous_relative_path.to_string()),
            relative_path: relative_path.to_string(),
            root_path: path_string(root),
        }
    }

    fn file_record(path: &Path, relative_path: &str, size_bytes: i64) -> WorkspaceFileRecord {
        WorkspaceFileRecord {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path_string(path),
            relative_path: relative_path.to_string(),
            size_bytes,
        }
    }

    fn record_size(database_path: &Path, relative_path: &str) -> i64 {
        let connection = Connection::open(database_path).expect("open database");
        connection
            .query_row(
                "SELECT size_bytes FROM workspace_files WHERE relative_path = ?1",
                [relative_path],
                |row| row.get(0),
            )
            .expect("record size")
    }

    fn relative_paths(database_path: &Path) -> Vec<String> {
        let connection = Connection::open(database_path).expect("open database");
        let mut statement = connection
            .prepare("SELECT relative_path FROM workspace_files ORDER BY relative_path")
            .expect("prepare paths");
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query paths");

        paths.map(|path| path.expect("path")).collect::<Vec<_>>()
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-update-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
    }

    fn temp_database_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("editor-update-db-{label}-{}", unique_suffix()))
            .join("index.sqlite3")
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
