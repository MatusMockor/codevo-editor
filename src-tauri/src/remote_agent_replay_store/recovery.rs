use super::{CacheError, CacheResult};
use std::{
    fs::{File, OpenOptions, TryLockError},
    path::Path,
    time::{Duration, Instant},
};

const LOCK_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy)]
enum LockKind {
    Shared,
    Exclusive,
}

pub(super) struct CacheLock {
    file: File,
}

impl CacheLock {
    pub(super) fn shared(directory: &Path) -> CacheResult<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let file = options
            .open(directory.join("cache.lock"))
            .map_err(|_| CacheError::Unavailable)?;
        if !file
            .metadata()
            .map_err(|_| CacheError::Unavailable)?
            .is_file()
        {
            return Err(CacheError::Unavailable);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| CacheError::Unavailable)?;
        }
        let lock = Self { file };
        lock.acquire(LockKind::Shared, LOCK_TIMEOUT)?;
        Ok(lock)
    }

    pub(super) fn exclusive(self) -> CacheResult<Self> {
        self.exclusive_with_timeout(LOCK_TIMEOUT)
    }

    pub(super) fn exclusive_with_timeout(self, timeout: Duration) -> CacheResult<Self> {
        self.file.unlock().map_err(|_| CacheError::Unavailable)?;
        self.acquire(LockKind::Exclusive, timeout)?;
        Ok(self)
    }

    fn acquire(&self, kind: LockKind, timeout: Duration) -> CacheResult<()> {
        let started = Instant::now();
        loop {
            let result = match kind {
                LockKind::Shared => self.file.try_lock_shared(),
                LockKind::Exclusive => self.file.try_lock(),
            };
            match result {
                Ok(()) => return Ok(()),
                Err(TryLockError::WouldBlock) => {}
                Err(TryLockError::Error(_)) => return Err(CacheError::Unavailable),
            }
            let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
                return Err(CacheError::Busy);
            };
            std::thread::sleep(LOCK_POLL_INTERVAL.min(remaining));
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DatabaseIdentity {
    pub(super) nonce: [u8; 16],
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(unix))]
    created: Option<std::time::SystemTime>,
}

pub(super) fn database_identity(
    database: &Path,
    connection: &rusqlite::Connection,
) -> CacheResult<DatabaseIdentity> {
    let metadata = std::fs::symlink_metadata(database).map_err(|_| CacheError::Unavailable)?;
    if !metadata.file_type().is_file() {
        return Err(CacheError::Unavailable);
    }
    let nonce: Vec<u8> = super::sqlite(connection.query_row(
        "SELECT nonce FROM cache_meta WHERE id=1",
        [],
        |row| row.get(0),
    ))?;
    let nonce = nonce.try_into().map_err(|_| CacheError::Corrupt)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(DatabaseIdentity {
            nonce,
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Ok(DatabaseIdentity {
            nonce,
            created: metadata.created().ok(),
        })
    }
}
