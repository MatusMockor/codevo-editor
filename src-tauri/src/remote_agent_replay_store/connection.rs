use super::{paths, schema, sqlite, CacheError, CacheResult};
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::Duration,
};

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_VERIFIED_DATABASES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
struct VerifiedDatabase {
    path: PathBuf,
    identity: super::recovery::DatabaseIdentity,
}

static VERIFIED: Mutex<VecDeque<VerifiedDatabase>> = Mutex::new(VecDeque::new());

pub(super) struct OpenedConnection {
    connection: Connection,
    lock: super::recovery::CacheLock,
    identity: super::recovery::DatabaseIdentity,
}

impl std::ops::Deref for OpenedConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

impl std::ops::DerefMut for OpenedConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.connection
    }
}

pub(super) fn open(directory: &Path) -> CacheResult<OpenedConnection> {
    let database = paths::prepare(directory)?;
    let lock = super::recovery::CacheLock::shared(directory)?;
    match open_database(&database) {
        Ok(connection) => opened(connection, lock, &database),
        Err(CacheError::Busy | CacheError::Unavailable | CacheError::InvalidIdentifier) => {
            Err(CacheError::Unavailable)
        }
        Err(CacheError::Corrupt) => {
            let lock = lock.exclusive()?;
            match probe_database(&database) {
                Ok(()) => opened(open_database(&database)?, lock, &database),
                Err(CacheError::Busy | CacheError::Unavailable | CacheError::InvalidIdentifier) => {
                    Err(CacheError::Unavailable)
                }
                Err(CacheError::Corrupt) => {
                    forget_verified(&database);
                    paths::unlink_database(&database)?;
                    let database = paths::prepare(directory)?;
                    opened(open_database(&database)?, lock, &database)
                }
            }
        }
    }
}

fn opened(
    connection: Connection,
    lock: super::recovery::CacheLock,
    database: &Path,
) -> CacheResult<OpenedConnection> {
    let identity = super::recovery::database_identity(database, &connection)?;
    Ok(OpenedConnection {
        connection,
        lock,
        identity,
    })
}

pub(super) fn recreate(opened: OpenedConnection, directory: &Path) -> CacheResult<()> {
    let OpenedConnection {
        connection,
        lock,
        identity,
    } = opened;
    drop(connection);
    let _lock = lock.exclusive()?;
    let database = std::fs::canonicalize(directory)
        .map_err(|_| CacheError::Unavailable)?
        .join("cache.sqlite3");
    let current = raw_connection(&database)?;
    let current_identity = super::recovery::database_identity(&database, &current)?;
    drop(current);
    if current_identity != identity {
        return Ok(());
    }
    forget_verified(&database);
    paths::unlink_database(&database)?;
    let database = paths::prepare(directory)?;
    drop(open_database(&database)?);
    Ok(())
}

fn raw_connection(database: &Path) -> CacheResult<Connection> {
    let connection = sqlite(Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    ))?;
    sqlite(connection.busy_timeout(BUSY_TIMEOUT))?;
    Ok(connection)
}

fn probe_database(database: &Path) -> CacheResult<()> {
    probe_connection(&raw_connection(database)?, database)
}

fn probe_connection(connection: &Connection, database: &Path) -> CacheResult<()> {
    verify_integrity(connection, database)?;
    let version: i64 = sqlite(connection.query_row("PRAGMA user_version", [], |row| row.get(0)))?;
    if version == schema::USER_VERSION {
        super::recovery::database_identity(database, connection)?;
        return Ok(());
    }
    if version != 0 {
        return Err(CacheError::Corrupt);
    }
    let tables: i64 = sqlite(connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    ))?;
    if tables != 0 {
        return Err(CacheError::Corrupt);
    }
    Ok(())
}

fn open_database(database: &Path) -> CacheResult<Connection> {
    let mut connection = raw_connection(database)?;
    probe_connection(&connection, database)?;
    migrate(&mut connection)?;
    configure(&connection)?;
    Ok(connection)
}

pub(super) fn configure(connection: &Connection) -> CacheResult<()> {
    sqlite(connection.pragma_update(None, "foreign_keys", "ON"))?;
    sqlite(connection.pragma_update(None, "secure_delete", "ON"))?;
    sqlite(connection.pragma_update(None, "journal_mode", "WAL"))?;
    sqlite(connection.pragma_update(None, "synchronous", "NORMAL"))?;
    Ok(())
}

#[cfg(test)]
impl OpenedConnection {
    pub(super) fn recovery_nonce(&self) -> [u8; 16] {
        self.identity.nonce
    }

    pub(super) fn retain_recovery_nonce(&mut self, nonce: [u8; 16]) {
        self.identity.nonce = nonce;
    }
}

fn migrate(connection: &mut Connection) -> CacheResult<()> {
    let transaction = sqlite(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let version: i64 = sqlite(transaction.query_row("PRAGMA user_version", [], |row| row.get(0)))?;
    if version == schema::USER_VERSION {
        return sqlite(transaction.commit());
    }
    if version != 0 {
        return Err(CacheError::Corrupt);
    }
    let tables: i64 = sqlite(transaction.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    ))?;
    if tables != 0 {
        return Err(CacheError::Corrupt);
    }
    sqlite(transaction.execute_batch(schema::DDL))?;
    sqlite(transaction.pragma_update(None, "user_version", schema::USER_VERSION))?;
    sqlite(transaction.commit())
}

pub(super) fn verify_integrity(connection: &Connection, database: &Path) -> CacheResult<()> {
    let identity = database_identity(database, connection);
    if identity.as_ref().is_some_and(already_verified) {
        return Ok(());
    }
    let verdict: String =
        sqlite(connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0)))?;
    if verdict != "ok" {
        return Err(CacheError::Corrupt);
    }
    if let Some(identity) = identity {
        let mut verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
        verified.retain(|entry| entry.path != identity.path);
        verified.push_back(identity);
        if verified.len() > MAX_VERIFIED_DATABASES {
            verified.pop_front();
        }
    }
    Ok(())
}

fn already_verified(identity: &VerifiedDatabase) -> bool {
    let verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
    verified.contains(identity)
}

pub(super) fn forget_verified(database: &Path) {
    let Ok(database) = std::fs::canonicalize(database) else {
        return;
    };
    let mut verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
    verified.retain(|entry| entry.path != database);
}

fn database_identity(database: &Path, connection: &Connection) -> Option<VerifiedDatabase> {
    Some(VerifiedDatabase {
        path: std::fs::canonicalize(database).ok()?,
        identity: super::recovery::database_identity(database, connection).ok()?,
    })
}

pub(super) fn clear(directory: &Path) -> CacheResult<()> {
    let database = paths::prepare(directory)?;
    let _lock = super::recovery::CacheLock::shared(directory)?.exclusive()?;
    forget_verified(&database);
    paths::unlink_database(&database)?;
    paths::remove_legacy(directory)?;
    let database = paths::prepare(directory)?;
    drop(open_database(&database)?);
    Ok(())
}
