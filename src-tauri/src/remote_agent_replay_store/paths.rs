use super::{CacheError, CacheResult};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

const SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];

pub(super) fn directory(base: &Path) -> PathBuf {
    base.join("remote-agent-replay").join("v1")
}

pub(super) fn prepare(directory: &Path) -> CacheResult<PathBuf> {
    let parent = directory.parent().ok_or(CacheError::Unavailable)?;
    ancestor_directory(parent.parent().ok_or(CacheError::Unavailable)?)?;
    private_directory(parent)?;
    private_directory(directory)?;
    prepare_legacy_cleanup(directory)?;
    let database = directory.join("cache.sqlite3");
    private_file(&database)?;
    for suffix in SIDECARS {
        refuse_non_regular(&sidecar(&database, suffix))?;
    }
    let canonical = fs::canonicalize(directory).map_err(|_| CacheError::Unavailable)?;
    Ok(canonical.join("cache.sqlite3"))
}

fn ancestor_directory(path: &Path) -> CacheResult<()> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => return Ok(()),
        Ok(_) => return Err(CacheError::Unavailable),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(CacheError::Unavailable),
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|_| CacheError::Unavailable)?;
    if !fs::metadata(path)
        .map_err(|_| CacheError::Unavailable)?
        .is_dir()
    {
        return Err(CacheError::Unavailable);
    }
    Ok(())
}

fn private_directory(path: &Path) -> CacheResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => return private_mode(path, 0o700),
        Ok(_) => return Err(CacheError::Unavailable),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(CacheError::Unavailable),
    }
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => private_mode(path, 0o700),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path).map_err(|_| CacheError::Unavailable)?;
            if !metadata.file_type().is_dir() {
                return Err(CacheError::Unavailable);
            }
            private_mode(path, 0o700)
        }
        Err(_) => Err(CacheError::Unavailable),
    }
}

fn private_file(path: &Path) -> CacheResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => return private_mode(path, 0o600),
        Ok(_) => return Err(CacheError::Unavailable),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(CacheError::Unavailable),
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    match options.open(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => refuse_non_regular(path),
        Err(_) => Err(CacheError::Unavailable),
    }
}

fn refuse_non_regular(path: &Path) -> CacheResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => private_mode(path, 0o600),
        Ok(_) => Err(CacheError::Unavailable),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(CacheError::Unavailable),
    }
}

#[cfg(unix)]
fn private_mode(path: &Path, mode: u32) -> CacheResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|_| CacheError::Unavailable)
}

#[cfg(not(unix))]
fn private_mode(_path: &Path, _mode: u32) -> CacheResult<()> {
    Ok(())
}

pub(super) fn sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut name = database.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub(super) fn unlink_database(database: &Path) -> CacheResult<()> {
    unlink_regular(database)?;
    for suffix in SIDECARS {
        unlink_regular(&sidecar(database, suffix))?;
    }
    Ok(())
}

fn unlink_regular(path: &Path) -> CacheResult<()> {
    refuse_non_regular(path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(CacheError::Unavailable),
    }
}

pub(super) fn remove_legacy(directory: &Path) -> CacheResult<()> {
    for path in legacy_entries(directory)? {
        unlink_legacy_regular(&path);
    }
    Ok(())
}

fn prepare_legacy_cleanup(directory: &Path) -> CacheResult<()> {
    if legacy_entries(directory)?.next().is_none() {
        return Ok(());
    }
    let _lock = super::recovery::CacheLock::shared(directory)?.exclusive()?;
    remove_legacy(directory)
}

fn legacy_entries(directory: &Path) -> CacheResult<impl Iterator<Item = PathBuf>> {
    let entries = fs::read_dir(directory).map_err(|_| CacheError::Unavailable)?;
    Ok(entries.filter_map(|entry| {
        let entry = entry.ok()?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("cache.sqlite3.corrupt-")
        {
            return None;
        }
        let path = entry.path();
        if !fs::symlink_metadata(&path).ok()?.file_type().is_file() {
            return None;
        }
        Some(path)
    }))
}

fn unlink_legacy_regular(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if !metadata.file_type().is_file() {
        return;
    }
    let _ = fs::remove_file(path);
}
