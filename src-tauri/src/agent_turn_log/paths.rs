use super::agent_thread_store::{
    agent_root_owner_id, fnv1a64hex, AGENT_THREAD_STORE_DIR_NAME, MAX_AGENT_ROOT_KEY_BYTES,
};
use super::errors::{AgentTurnLogError, AgentTurnLogResult};
use crate::git_worktree::safe_agent_task_id;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) const AGENT_TURN_LOG_DIR_NAME: &str = "agent-thread-logs";
pub(crate) const AGENT_TURN_LOG_VERSION_DIR: &str = "v1";
pub(crate) const AGENT_TURN_LOG_USER_VERSION: i64 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentTurnLogLocation {
    pub(crate) database: PathBuf,
    pub(crate) thread_document: PathBuf,
    pub(crate) owned_directories: Vec<PathBuf>,
    pub(crate) key: String,
}

pub(crate) fn ensure_scope_authority(root_key: &str, owner_id: &str) -> AgentTurnLogResult<()> {
    if root_key.is_empty() || root_key.len() > MAX_AGENT_ROOT_KEY_BYTES {
        return Err(AgentTurnLogError::OwnerMismatch);
    }
    if owner_id != agent_root_owner_id(root_key) {
        return Err(AgentTurnLogError::OwnerMismatch);
    }
    Ok(())
}

pub(crate) fn locate(
    base_dir: &Path,
    root_key: &str,
    owner_id: &str,
    thread_id: &str,
) -> AgentTurnLogResult<AgentTurnLogLocation> {
    ensure_scope_authority(root_key, owner_id)?;
    let thread_id = safe_agent_task_id(thread_id).map_err(|_| AgentTurnLogError::OwnerMismatch)?;
    let root_hash = fnv1a64hex(root_key);
    let store = base_dir.join(AGENT_TURN_LOG_DIR_NAME);
    let versioned = store.join(AGENT_TURN_LOG_VERSION_DIR);
    let root_directory = versioned.join(&root_hash);
    Ok(AgentTurnLogLocation {
        database: root_directory.join(format!("{thread_id}.sqlite3")),
        thread_document: base_dir
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(&root_hash)
            .join(format!("{thread_id}.json")),
        owned_directories: vec![store, versioned, root_directory],
        key: format!("{root_hash}/{thread_id}"),
    })
}

pub(crate) fn prepare_database_file(location: &AgentTurnLogLocation) -> AgentTurnLogResult<()> {
    for directory in &location.owned_directories {
        create_private_directory(directory)?;
    }
    match fs::symlink_metadata(&location.database) {
        Ok(metadata) if metadata.file_type().is_file() => return Ok(()),
        Ok(_) => return Err(AgentTurnLogError::Foreign),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(AgentTurnLogError::Unreadable),
    }
    create_private_file(&location.database)
}

pub(crate) fn resolved_database(location: &AgentTurnLogLocation) -> AgentTurnLogResult<PathBuf> {
    let directory = location
        .database
        .parent()
        .ok_or(AgentTurnLogError::Unreadable)?;
    let file_name = location
        .database
        .file_name()
        .ok_or(AgentTurnLogError::Unreadable)?;
    let canonical = fs::canonicalize(directory).map_err(|_| AgentTurnLogError::Unreadable)?;
    Ok(canonical.join(file_name))
}

fn create_private_directory(directory: &Path) -> AgentTurnLogResult<()> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            apply_private_mode(directory, 0o700);
            return Ok(());
        }
        Ok(_) => return Err(AgentTurnLogError::Foreign),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(AgentTurnLogError::Unreadable),
    }
    match fs::create_dir(directory) {
        Ok(()) => {
            apply_private_mode(directory, 0o700);
            Ok(())
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(storage_error(&error)),
    }
}

fn create_private_file(path: &Path) -> AgentTurnLogResult<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    match options.open(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(storage_error(&error)),
    }
}

#[cfg(unix)]
fn storage_error(error: &std::io::Error) -> AgentTurnLogError {
    if error.raw_os_error() == Some(libc::ENOSPC) {
        return AgentTurnLogError::DiskFull;
    }
    AgentTurnLogError::Unreadable
}

#[cfg(not(unix))]
fn storage_error(_error: &std::io::Error) -> AgentTurnLogError {
    AgentTurnLogError::Unreadable
}

#[cfg(unix)]
fn apply_private_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn apply_private_mode(_path: &Path, _mode: u32) {}

pub(crate) const WRITE_AHEAD_LOG_SUFFIX: &str = "-wal";
pub(crate) const DATABASE_SIDECARS: [&str; 2] = [WRITE_AHEAD_LOG_SUFFIX, "-shm"];

pub(crate) fn sidecar_path(database: &Path, suffix: &str) -> PathBuf {
    let mut name = database.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub(crate) fn quarantine_corrupt_database(database: &Path) -> AgentTurnLogError {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let quarantined = sidecar_path(database, &format!(".corrupt-{stamp}"));
    let _ = fs::rename(database, &quarantined);
    for suffix in DATABASE_SIDECARS {
        let _ = fs::rename(
            sidecar_path(database, suffix),
            sidecar_path(&quarantined, suffix),
        );
    }
    AgentTurnLogError::Unreadable
}

pub(crate) fn delete_database_files(location: &AgentTurnLogLocation) -> AgentTurnLogResult<bool> {
    for directory in &location.owned_directories {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => return Err(AgentTurnLogError::Foreign),
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(AgentTurnLogError::Unreadable),
        }
    }
    let deleted = unlink_regular_file(&location.database)?;
    for suffix in DATABASE_SIDECARS {
        unlink_regular_file(&sidecar_path(&location.database, suffix))?;
    }
    Ok(deleted)
}

fn unlink_regular_file(path: &Path) -> AgentTurnLogResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {}
        Ok(_) => return Err(AgentTurnLogError::Foreign),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(AgentTurnLogError::Unreadable),
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(storage_error(&error)),
    }
}

pub(crate) fn orphan_database_paths(
    base_dir: &Path,
    root_key: &str,
    owner_id: &str,
    live_thread_ids: &[String],
    limit: usize,
) -> AgentTurnLogResult<Vec<PathBuf>> {
    ensure_scope_authority(root_key, owner_id)?;
    let root_directory = base_dir
        .join(AGENT_TURN_LOG_DIR_NAME)
        .join(AGENT_TURN_LOG_VERSION_DIR)
        .join(fnv1a64hex(root_key));
    let Ok(entries) = fs::read_dir(&root_directory) else {
        return Ok(Vec::new());
    };
    let mut orphans = Vec::new();
    for entry in entries.filter_map(Result::ok).take(limit) {
        let path = entry.path();
        let Some(thread_id) = database_thread_id(&path) else {
            continue;
        };
        if live_thread_ids.iter().any(|live| live == &thread_id) {
            continue;
        }
        orphans.push(path);
    }
    Ok(orphans)
}

fn database_thread_id(path: &Path) -> Option<String> {
    if !path.symlink_metadata().is_ok_and(|meta| meta.is_file()) {
        return None;
    }
    if path.extension()? != "sqlite3" {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    safe_agent_task_id(stem).ok()
}
