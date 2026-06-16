use crate::job_scheduler::{
    IndexCommitGate, IndexCommitPermission, IndexCommitScope, IndexDbWriteOperation,
    IndexFileMetadata,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

const CURRENT_SCHEMA_VERSION: i64 = 1;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexSummary {
    pub database_path: String,
    pub file_count: i64,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileRecord {
    pub path: String,
    pub relative_path: String,
    pub language: String,
    pub size_bytes: i64,
    pub modified_at_unix: i64,
}

pub trait WorkspaceIndexStore {
    fn remove_file(&self, path: &str) -> rusqlite::Result<()>;
    fn summary(&self) -> rusqlite::Result<WorkspaceIndexSummary>;
    fn upsert_file(&self, record: &WorkspaceFileRecord) -> rusqlite::Result<()>;
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum IndexCommitOutcome {
    Committed,
    SkippedCancelled,
    SkippedStale,
}

pub fn commit_index_db_write(
    store: &dyn WorkspaceIndexStore,
    gate: &dyn IndexCommitGate,
    scope: &IndexCommitScope,
    operation: &IndexDbWriteOperation,
) -> rusqlite::Result<IndexCommitOutcome> {
    match gate.check(scope) {
        IndexCommitPermission::Cancelled => Ok(IndexCommitOutcome::SkippedCancelled),
        IndexCommitPermission::Stale => Ok(IndexCommitOutcome::SkippedStale),
        IndexCommitPermission::Current => {
            apply_index_db_write(store, operation)?;
            Ok(IndexCommitOutcome::Committed)
        }
    }
}

pub struct SqliteWorkspaceIndex {
    connection: Connection,
    database_path: PathBuf,
}

impl SqliteWorkspaceIndex {
    pub fn open(database_path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(to_sqlite_error)?;
        }

        let connection = Connection::open(database_path)?;
        configure_connection(&connection)?;
        apply_migrations(&connection)?;

        Ok(Self {
            connection,
            database_path: database_path.to_path_buf(),
        })
    }

    #[cfg(test)]
    fn connection(&self) -> &Connection {
        &self.connection
    }
}

impl WorkspaceIndexStore for SqliteWorkspaceIndex {
    fn remove_file(&self, path: &str) -> rusqlite::Result<()> {
        self.connection
            .execute("DELETE FROM workspace_files WHERE path = ?1", [path])?;
        Ok(())
    }

    fn summary(&self) -> rusqlite::Result<WorkspaceIndexSummary> {
        let file_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM workspace_files", [], |row| {
                    row.get::<_, i64>(0)
                })?;

        Ok(WorkspaceIndexSummary {
            database_path: self.database_path.to_string_lossy().to_string(),
            file_count,
            schema_version: CURRENT_SCHEMA_VERSION,
        })
    }

    fn upsert_file(&self, record: &WorkspaceFileRecord) -> rusqlite::Result<()> {
        self.connection.execute(
            "
            INSERT INTO workspace_files (
                path,
                relative_path,
                language,
                size_bytes,
                modified_at_unix,
                indexed_at_unix
            )
            VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
            ON CONFLICT(path) DO UPDATE SET
                relative_path = excluded.relative_path,
                language = excluded.language,
                size_bytes = excluded.size_bytes,
                modified_at_unix = excluded.modified_at_unix,
                indexed_at_unix = excluded.indexed_at_unix
            ",
            params![
                record.path,
                record.relative_path,
                record.language,
                record.size_bytes,
                record.modified_at_unix,
            ],
        )?;
        Ok(())
    }
}

pub fn workspace_index_path(config_dir: &Path, root_path: &Path) -> PathBuf {
    let normalized = root_path.to_string_lossy().replace('\\', "/");
    let hash = stable_workspace_hash(&normalized);

    config_dir
        .join("workspace-indexes")
        .join(format!("{hash:016x}.sqlite3"))
}

fn configure_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    Ok(())
}

fn apply_migrations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_files (
            path TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            language TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            modified_at_unix INTEGER NOT NULL,
            indexed_at_unix INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_files_relative_path
            ON workspace_files(relative_path);

        INSERT INTO schema_migrations(version, name, applied_at_unix)
        VALUES (1, 'initial_workspace_files', strftime('%s', 'now'))
        ON CONFLICT(version) DO NOTHING;

        PRAGMA user_version = 1;
        ",
    )?;
    Ok(())
}

fn to_sqlite_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn apply_index_db_write(
    store: &dyn WorkspaceIndexStore,
    operation: &IndexDbWriteOperation,
) -> rusqlite::Result<()> {
    match operation {
        IndexDbWriteOperation::RemoveFile { path } => store.remove_file(path),
        IndexDbWriteOperation::UpsertFileMetadata { metadata } => {
            store.upsert_file(&workspace_file_record(metadata))
        }
    }
}

fn workspace_file_record(metadata: &IndexFileMetadata) -> WorkspaceFileRecord {
    WorkspaceFileRecord {
        language: metadata.language.clone(),
        modified_at_unix: metadata.modified_at_unix,
        path: metadata.path.clone(),
        relative_path: metadata.relative_path.clone(),
        size_bytes: metadata.size_bytes,
    }
}

fn stable_workspace_hash(value: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

#[cfg(test)]
mod tests {
    use super::{
        commit_index_db_write, workspace_index_path, IndexCommitOutcome, SqliteWorkspaceIndex,
        WorkspaceFileRecord, WorkspaceIndexStore,
    };
    use crate::job_scheduler::{
        InMemoryIndexJobScheduler, IndexCommitGate, IndexCommitPermission, IndexCommitScope,
        IndexDbWriteOperation, IndexFileMetadata, IndexGenerationGuard, IndexJobPayload,
        IndexJobScheduler, ScheduleIndexJobRequest,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn opens_database_with_migrations_and_pragmas() {
        let database_path = temp_database_path("migrations");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let journal_mode: String = index
            .connection()
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        let busy_timeout: i64 = index
            .connection()
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .expect("busy timeout");
        let migration_count: i64 = index
            .connection()
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");

        assert_eq!(journal_mode.to_lowercase(), "wal");
        assert_eq!(busy_timeout, 5_000);
        assert_eq!(migration_count, 1);
        assert_eq!(index.summary().expect("summary").schema_version, 1);
    }

    #[test]
    fn upserts_and_removes_workspace_files() {
        let database_path = temp_database_path("files");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let record = WorkspaceFileRecord {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: "/project/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
            size_bytes: 128,
        };

        index.upsert_file(&record).expect("upsert file");
        assert_eq!(index.summary().expect("summary").file_count, 1);

        index
            .upsert_file(&WorkspaceFileRecord {
                size_bytes: 256,
                ..record
            })
            .expect("update file");
        assert_eq!(index.summary().expect("summary").file_count, 1);

        index
            .remove_file("/project/src/User.php")
            .expect("remove file");
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn guarded_db_write_commits_current_generation() {
        let database_path = temp_database_path("guard-current");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let gate = StaticCommitGate(IndexCommitPermission::Current);
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("commit write");

        assert_eq!(outcome, IndexCommitOutcome::Committed);
        assert_eq!(index.summary().expect("summary").file_count, 1);
    }

    #[test]
    fn guarded_upsert_does_not_replace_newer_record_when_stale() {
        let database_path = temp_database_path("guard-stale-upsert");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let current = file_record("/project/src/User.php", 256);
        index.upsert_file(&current).expect("seed current file");
        let gate = StaticCommitGate(IndexCommitPermission::Stale);
        let stale_operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &stale_operation)
            .expect("skip stale write");
        let size_bytes: i64 = index
            .connection()
            .query_row(
                "SELECT size_bytes FROM workspace_files WHERE path = ?1",
                ["/project/src/User.php"],
                |row| row.get(0),
            )
            .expect("file size");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(size_bytes, 256);
    }

    #[test]
    fn guarded_remove_does_not_delete_when_stale() {
        let database_path = temp_database_path("guard-stale-remove");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        let gate = StaticCommitGate(IndexCommitPermission::Stale);
        let operation = IndexDbWriteOperation::RemoveFile {
            path: "/project/src/User.php".to_string(),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("skip stale remove");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(index.summary().expect("summary").file_count, 1);
    }

    #[test]
    fn guarded_db_write_skips_cancelled_generation() {
        let database_path = temp_database_path("guard-cancelled");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let gate = StaticCommitGate(IndexCommitPermission::Cancelled);
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("skip cancelled write");

        assert_eq!(outcome, IndexCommitOutcome::SkippedCancelled);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn scheduler_generation_gate_skips_stale_sqlite_write() {
        let database_path = temp_database_path("scheduler-gate");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let mut scheduler = InMemoryIndexJobScheduler::default();
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };
        let job = scheduler.enqueue(ScheduleIndexJobRequest {
            payload: IndexJobPayload::DbWrite {
                operation: operation.clone(),
            },
            workspace_root: "/project".to_string(),
        });

        scheduler.cancel_workspace("/project");
        let outcome = commit_index_db_write(&index, &scheduler, &job.commit_scope(), &operation)
            .expect("guarded write");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn workspace_index_paths_are_stable_per_root() {
        let config_dir = Path::new("/tmp/editor-config");

        assert_eq!(
            workspace_index_path(config_dir, Path::new("/project")),
            workspace_index_path(config_dir, Path::new("/project")),
        );
        assert_ne!(
            workspace_index_path(config_dir, Path::new("/project-a")),
            workspace_index_path(config_dir, Path::new("/project-b")),
        );
    }

    #[test]
    fn workspace_index_paths_normalize_path_separators() {
        let config_dir = Path::new("/tmp/editor-config");

        assert_eq!(
            workspace_index_path(config_dir, Path::new("C:\\project\\app")),
            workspace_index_path(config_dir, Path::new("C:/project/app")),
        );
    }

    fn temp_database_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("editor-index-{label}-{nanos}"));
        fs::create_dir_all(&directory).expect("temp dir");
        directory.join("workspace.sqlite3")
    }

    fn file_record(path: &str, size_bytes: i64) -> WorkspaceFileRecord {
        WorkspaceFileRecord {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            size_bytes,
        }
    }

    fn file_metadata(path: &str, size_bytes: i64) -> IndexFileMetadata {
        IndexFileMetadata {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            size_bytes,
        }
    }

    fn commit_scope(generation: u64) -> IndexCommitScope {
        IndexCommitScope {
            generation,
            workspace_root: "/project".to_string(),
        }
    }

    struct StaticCommitGate(IndexCommitPermission);

    impl IndexCommitGate for StaticCommitGate {
        fn check(&self, _scope: &IndexCommitScope) -> IndexCommitPermission {
            self.0
        }
    }
}
