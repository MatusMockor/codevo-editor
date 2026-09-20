use super::{imports, legacy, sql};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
pub(crate) fn database_path(base: &Path, root: &str) -> PathBuf {
    base.join("agent-history")
        .join("v2")
        .join(legacy::fnv1a64hex(root))
        .join("history.sqlite3")
}
fn ensure_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() => Ok(()),
        Ok(_) => Err("The saved history directory is not a regular directory.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    match fs::symlink_metadata(path) {
                        Ok(meta) if meta.file_type().is_dir() => Ok(()),
                        _ => Err("Invalid history directory replacement.".into()),
                    }
                }
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}
pub(super) fn open(base: &Path, root: &str, owner: &str) -> Result<Connection, String> {
    if root.is_empty()
        || root.len() > legacy::MAX_AGENT_ROOT_KEY_BYTES
        || owner != legacy::agent_root_owner_id(root)
    {
        return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
    }
    let first = base.join("agent-history");
    let second = first.join("v2");
    let third = second.join(legacy::fnv1a64hex(root));
    for directory in [&first, &second, &third] {
        ensure_directory(directory)?;
    }
    let path = database_path(base, root);
    match fs::symlink_metadata(&path) {
        Ok(meta) if !meta.file_type().is_file() => {
            return Err("The saved history database must be a regular file.".into())
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => {}
    }
    if !path.exists() {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        match options.open(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let resolved = fs::canonicalize(path.parent().ok_or("Invalid history database path.")?)
        .map_err(|e| e.to_string())?
        .join("history.sqlite3");
    let connection = sql(Connection::open_with_flags(
        &resolved,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ))?;
    sql(connection.busy_timeout(Duration::from_secs(5)))?;
    sql(connection.pragma_update(None, "cache_size", -4000))?;
    let version: i64 = sql(connection.pragma_query_value(None, "user_version", |r| r.get(0)))?;
    if version != 0 && version != 2 {
        return Err("The saved history database has an unsupported version.".into());
    }
    if version == 0 {
        let tables: i64 = sql(connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        ))?;
        if tables != 0 {
            // A concurrent initializer may have committed after our initial version read.
            let current: i64 =
                sql(connection.pragma_query_value(None, "user_version", |row| row.get(0)))?;
            if current != 2 {
                return Err("The saved history database belongs to another application.".into());
            }
            validate_owner(&connection, root, owner)?;
        }
    } else {
        validate_owner(&connection, root, owner)?;
    }
    enable_wal(&connection)?;
    sql(connection.pragma_update(None, "synchronous", "FULL"))?;
    sql(connection.execute_batch("BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS history_owner(root_key TEXT NOT NULL,owner_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS threads(thread_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,last_save_hash TEXT);
        CREATE INDEX IF NOT EXISTS threads_recent ON threads(json_extract(payload,'$.pinned') DESC,updated_at DESC,thread_id DESC);
        CREATE TABLE IF NOT EXISTS import_identity(thread_id TEXT PRIMARY KEY,provider TEXT NOT NULL,session_id TEXT NOT NULL,repository_root TEXT NOT NULL,UNIQUE(provider,session_id,repository_root));
        CREATE TABLE IF NOT EXISTS turns(thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(thread_id,turn_id));
        CREATE UNIQUE INDEX IF NOT EXISTS turns_order ON turns(thread_id,ordinal);
        CREATE TABLE IF NOT EXISTS attachment_cleanup(thread_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS tombstones(thread_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS migrated(thread_id TEXT PRIMARY KEY);"))?;
    if version == 0 {
        sql(connection.execute("INSERT INTO history_owner(root_key,owner_id) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM history_owner)",[root,owner]))?;
    }
    let hash_column: i64 = sql(connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('threads') WHERE name='last_save_hash'",
        [],
        |row| row.get(0),
    ))?;
    if hash_column == 0 {
        sql(connection.execute_batch("ALTER TABLE threads ADD COLUMN last_save_hash TEXT;"))?;
    }
    imports::ensure_schema(&connection)?;
    sql(connection.pragma_update(None, "user_version", 2))?;
    sql(connection.execute_batch("COMMIT"))?;
    validate_owner(&connection, root, owner)?;
    Ok(connection)
}
fn validate_owner(connection: &Connection, root: &str, owner: &str) -> Result<(), String> {
    let found: Option<(String, String)> = sql(connection
        .query_row(
            "SELECT root_key,owner_id FROM history_owner LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional())?;
    if found
        .as_ref()
        .is_none_or(|(stored_root, stored_owner)| stored_root != root || stored_owner != owner)
    {
        return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
    }
    Ok(())
}
pub(crate) fn ownership_status(base: &Path, root: &str, id: &str) -> Result<Option<bool>, String> {
    let path = database_path(base, root);
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    for directory in [
        base.join("agent-history"),
        base.join("agent-history/v2"),
        base.join("agent-history/v2").join(legacy::fnv1a64hex(root)),
    ] {
        if !fs::symlink_metadata(directory)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_dir()
        {
            return Err("The history owner directory is invalid.".into());
        }
    }
    let resolved = fs::canonicalize(path.parent().ok_or("Invalid history database path.")?)
        .map_err(|e| e.to_string())?
        .join("history.sqlite3");
    let connection = sql(Connection::open_with_flags(
        resolved,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ))?;
    validate_owner(&connection, root, &legacy::agent_root_owner_id(root))?;
    let authority:Option<i64>=sql(connection.query_row("SELECT CASE WHEN EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1) THEN 0 WHEN EXISTS(SELECT 1 FROM threads WHERE thread_id=?1) THEN 1 ELSE NULL END",[id],|row|row.get(0)))?;
    Ok(authority.map(|value| value == 1))
}
/// Conservatively preserve attachment directories on uncertain catalog reads.
pub(crate) fn exists_in_any_root(base: &Path, id: &str) -> bool {
    let roots = match fs::read_dir(base.join("agent-history").join("v2")) {
        Ok(roots) => roots,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return false,
        Err(_) => return true,
    };
    for (index, entry) in roots.enumerate() {
        if index >= 256 {
            return true;
        }
        let Ok(entry) = entry else {
            return true;
        };
        let Ok(directory) = fs::canonicalize(entry.path()) else {
            return true;
        };
        let Ok(connection) = Connection::open_with_flags(
            directory.join("history.sqlite3"),
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            return true;
        };
        match connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM threads WHERE thread_id=?1)",
            [id],
            |r| r.get::<_, bool>(0),
        ) {
            Ok(false) => {}
            _ => return true,
        }
    }
    false
}

fn enable_wal(connection: &Connection) -> Result<(), String> {
    // SQLite cannot invoke its busy handler for every journal-mode upgrade race.
    // Initialization runs on the blocking pool and retries only this idempotent pragma.
    for attempt in 0..4 {
        match connection.pragma_update(None, "journal_mode", "WAL") {
            Ok(()) => return Ok(()),
            Err(error)
                if attempt < 3
                    && matches!(
                        error.sqlite_error_code(),
                        Some(
                            rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                        )
                    ) =>
            {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(error) => return sql(Err(error)),
        }
    }
    unreachable!()
}
