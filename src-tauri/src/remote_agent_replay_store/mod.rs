mod connection;
mod paths;
mod recovery;
mod schema;
mod store;
pub(crate) mod wire;

pub(crate) use store::RemoteAgentReplayStore;

pub(crate) const MAX_IDENTIFIER_BYTES: usize = 512;
pub(crate) const MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_THREAD_BYTES: i64 = 8 * 1024 * 1024;
pub(crate) const MAX_TASKS_PER_THREAD: usize = 64;
pub(crate) const MAX_THREADS: i64 = 64;
pub(crate) const MAX_TOTAL_BYTES: i64 = 256 * 1024 * 1024;
pub(crate) const EXPIRY_MS: i64 = 7 * 24 * 60 * 60 * 1000;
pub(crate) const FUTURE_TOLERANCE_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CacheError {
    Busy,
    Unavailable,
    Corrupt,
    InvalidIdentifier,
}

pub(crate) type CacheResult<T> = Result<T, CacheError>;

pub(super) fn sqlite<T>(result: rusqlite::Result<T>) -> CacheResult<T> {
    result.map_err(|error| match error {
        rusqlite::Error::SqliteFailure(error, _) => match error.extended_code & 0xff {
            rusqlite::ffi::SQLITE_CORRUPT
            | rusqlite::ffi::SQLITE_NOTADB
            | rusqlite::ffi::SQLITE_ERROR
            | rusqlite::ffi::SQLITE_MISMATCH
            | rusqlite::ffi::SQLITE_CONSTRAINT => CacheError::Corrupt,
            _ => CacheError::Unavailable,
        },
        _ => CacheError::Corrupt,
    })
}

#[cfg(test)]
mod tests;
