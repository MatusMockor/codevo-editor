use super::errors::{sqlite, AgentTurnLogError, AgentTurnLogResult};
use super::integrity::verify_integrity_once;
use super::paths::{
    prepare_database_file, resolved_database, sidecar_path, AgentTurnLogLocation,
    AGENT_TURN_LOG_USER_VERSION, WRITE_AHEAD_LOG_SUFFIX,
};
use super::schema::{ensure_activity_column, DDL};
use rusqlite::{Connection, OpenFlags};
use std::{fs, io::ErrorKind, time::Duration};

#[cfg(not(test))]
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
const BUSY_TIMEOUT: Duration = Duration::from_millis(50);
const CACHE_SIZE_KIB: i64 = -4_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TurnLogAccess {
    ReadWrite,
    ReadOnly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Readiness {
    Ready,
    Absent,
}

#[derive(Debug)]
pub(crate) enum OpenedTurnLog {
    Ready(Connection),
    Absent,
    Corrupt(Connection),
}

const WRITE_AHEAD_LOG_HEADER_BYTES: u64 = 32;

pub(crate) fn open_turn_log(
    location: &AgentTurnLogLocation,
    access: TurnLogAccess,
) -> AgentTurnLogResult<OpenedTurnLog> {
    if access == TurnLogAccess::ReadOnly && !database_is_present(location)? {
        return Ok(OpenedTurnLog::Absent);
    }
    if access == TurnLogAccess::ReadWrite {
        prepare_database_file(location)?;
    }
    let connection = sqlite(Connection::open_with_flags(
        resolved_database(location)?,
        flags_for(access),
    ))?;
    opened(connection, |connection| {
        prepare(connection, location, access)
    })
}

pub(crate) fn recover_write_ahead_log(
    location: &AgentTurnLogLocation,
) -> AgentTurnLogResult<OpenedTurnLog> {
    if !database_is_present(location)? {
        return Ok(OpenedTurnLog::Absent);
    }
    if !stale_write_ahead_log_is_present(location) {
        return Err(AgentTurnLogError::Unreadable);
    }
    let connection = sqlite(Connection::open_with_flags(
        resolved_database(location)?,
        flags_for(TurnLogAccess::ReadWrite),
    ))?;
    opened(connection, |connection| {
        sqlite(connection.busy_timeout(BUSY_TIMEOUT))?;
        sqlite(connection.pragma_update(None, "cache_size", CACHE_SIZE_KIB))?;
        verify_integrity_once(connection, &location.database)?;
        migrate(connection, TurnLogAccess::ReadOnly)
    })
}

fn opened(
    connection: Connection,
    prepare: impl FnOnce(&Connection) -> AgentTurnLogResult<Readiness>,
) -> AgentTurnLogResult<OpenedTurnLog> {
    match prepare(&connection) {
        Ok(Readiness::Ready) => Ok(OpenedTurnLog::Ready(connection)),
        Ok(Readiness::Absent) => Ok(OpenedTurnLog::Absent),
        Err(AgentTurnLogError::Corrupt) => Ok(OpenedTurnLog::Corrupt(connection)),
        Err(error) => Err(error),
    }
}

fn stale_write_ahead_log_is_present(location: &AgentTurnLogLocation) -> bool {
    sidecar_path(&location.database, WRITE_AHEAD_LOG_SUFFIX)
        .symlink_metadata()
        .is_ok_and(|metadata| {
            metadata.file_type().is_file() && metadata.len() >= WRITE_AHEAD_LOG_HEADER_BYTES
        })
}

fn flags_for(access: TurnLogAccess) -> OpenFlags {
    let shared = OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    match access {
        TurnLogAccess::ReadWrite => OpenFlags::SQLITE_OPEN_READ_WRITE | shared,
        TurnLogAccess::ReadOnly => OpenFlags::SQLITE_OPEN_READ_ONLY | shared,
    }
}

fn database_is_present(location: &AgentTurnLogLocation) -> AgentTurnLogResult<bool> {
    match fs::symlink_metadata(&location.database) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err(AgentTurnLogError::Foreign),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(AgentTurnLogError::Unreadable),
    }
}

fn prepare(
    connection: &Connection,
    location: &AgentTurnLogLocation,
    access: TurnLogAccess,
) -> AgentTurnLogResult<Readiness> {
    configure(connection, access)?;
    verify_integrity_once(connection, &location.database)?;
    migrate(connection, access)
}

fn configure(connection: &Connection, access: TurnLogAccess) -> AgentTurnLogResult<()> {
    sqlite(connection.busy_timeout(BUSY_TIMEOUT))?;
    sqlite(connection.pragma_update(None, "cache_size", CACHE_SIZE_KIB))?;
    if access == TurnLogAccess::ReadOnly {
        return sqlite(connection.pragma_update(None, "query_only", true));
    }
    sqlite(connection.pragma_update(None, "temp_store", "MEMORY"))?;
    sqlite(connection.pragma_update(None, "journal_mode", "WAL"))?;
    sqlite(connection.pragma_update(None, "synchronous", "NORMAL"))
}

fn migrate(connection: &Connection, access: TurnLogAccess) -> AgentTurnLogResult<Readiness> {
    let user_version: i64 =
        sqlite(connection.query_row("PRAGMA user_version", [], |row| row.get(0)))?;
    if user_version == AGENT_TURN_LOG_USER_VERSION {
        if access == TurnLogAccess::ReadOnly {
            return Ok(Readiness::Ready);
        }
        ensure_activity_column(connection)?;
        return Ok(Readiness::Ready);
    }
    if user_version != 0 {
        return Err(AgentTurnLogError::Foreign);
    }
    if has_foreign_tables(connection)? {
        return Err(AgentTurnLogError::Foreign);
    }
    if access == TurnLogAccess::ReadOnly {
        return Ok(Readiness::Absent);
    }
    sqlite(connection.execute_batch(DDL))?;
    sqlite(connection.pragma_update(None, "user_version", AGENT_TURN_LOG_USER_VERSION))?;
    Ok(Readiness::Ready)
}

fn has_foreign_tables(connection: &Connection) -> AgentTurnLogResult<bool> {
    let tables: i64 = sqlite(connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    ))?;
    Ok(tables != 0)
}
