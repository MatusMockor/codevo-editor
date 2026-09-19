use super::errors::{sqlite, AgentTurnLogError, AgentTurnLogResult};
use rusqlite::Connection;
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
};

const MAX_VERIFIED_DATABASES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
struct VerifiedDatabase {
    path: PathBuf,
    device: u64,
    inode: u64,
}

static VERIFIED: Mutex<VecDeque<VerifiedDatabase>> = Mutex::new(VecDeque::new());

pub(crate) fn verify_integrity_once(
    connection: &Connection,
    database: &Path,
) -> AgentTurnLogResult<()> {
    let identity = identity_of(database);
    if identity.as_ref().is_some_and(already_verified) {
        return Ok(());
    }
    record_verification(database);
    run_quick_check(connection)?;
    let Some(identity) = identity else {
        return Ok(());
    };
    remember(identity);
    Ok(())
}

pub(crate) fn forget_verified_database(database: &Path) {
    let mut verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
    verified.retain(|entry| entry.path != database);
}

fn run_quick_check(connection: &Connection) -> AgentTurnLogResult<()> {
    let verdict =
        sqlite(connection.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0)))?;
    if verdict != "ok" {
        return Err(AgentTurnLogError::Corrupt);
    }
    Ok(())
}

fn already_verified(identity: &VerifiedDatabase) -> bool {
    let verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
    verified.contains(identity)
}

fn remember(identity: VerifiedDatabase) {
    let mut verified = VERIFIED.lock().unwrap_or_else(PoisonError::into_inner);
    verified.retain(|entry| entry.path != identity.path);
    verified.push_back(identity);
    if verified.len() > MAX_VERIFIED_DATABASES {
        verified.pop_front();
    }
}

#[cfg(unix)]
fn identity_of(database: &Path) -> Option<VerifiedDatabase> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::symlink_metadata(database).ok()?;
    if !metadata.file_type().is_file() {
        return None;
    }
    Some(VerifiedDatabase {
        path: database.to_path_buf(),
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn identity_of(database: &Path) -> Option<VerifiedDatabase> {
    let metadata = fs::symlink_metadata(database).ok()?;
    if !metadata.file_type().is_file() {
        return None;
    }
    Some(VerifiedDatabase {
        path: database.to_path_buf(),
        device: 0,
        inode: metadata.len(),
    })
}

#[cfg(test)]
static VERIFICATIONS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

#[cfg(test)]
fn record_verification(database: &Path) {
    let mut verifications = VERIFICATIONS.lock().unwrap_or_else(PoisonError::into_inner);
    verifications.push(database.to_path_buf());
}

#[cfg(not(test))]
fn record_verification(_database: &Path) {}

#[cfg(test)]
pub(crate) fn verifications_under(directory: &Path) -> usize {
    let verifications = VERIFICATIONS.lock().unwrap_or_else(PoisonError::into_inner);
    verifications
        .iter()
        .filter(|path| path.starts_with(directory))
        .count()
}
