//! Descriptor-relative I/O for immutable output artifacts.
use super::super::errors;
use std::{
    ffi::CString,
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
    path::{Component, Path},
    thread::sleep,
    time::Duration,
};

pub(super) fn directory(path: &Path) -> Result<File, String> {
    let mut current = File::open("/").map_err(|e| e.to_string())?;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => {
                current = open(
                    &current,
                    Path::new(name),
                    libc::O_RDONLY | libc::O_DIRECTORY,
                )?
            }
            _ => return Err("Artifact root must be an absolute path without aliases.".into()),
        }
    }
    Ok(current)
}

pub(super) fn open(parent: &File, name: &Path, flags: i32) -> Result<File, String> {
    let name = CString::new(name.as_os_str().as_bytes()).map_err(|_| "Invalid artifact path.")?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            0o600,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(super) fn workspace_relative<'a>(root: &Path, reference: &'a str) -> Result<&'a Path, String> {
    if reference.is_empty() || reference.len() > 4096 || reference.contains('\0') {
        return Err("Invalid artifact reference.".into());
    }
    let path = Path::new(reference);
    if !path.is_absolute() {
        return Ok(path);
    }
    path.strip_prefix(root)
        .map_err(|_| "Artifact is outside its workspace.".into())
}

fn descend(root_descriptor: &File, relative: &Path) -> Result<File, String> {
    let components: Vec<_> = relative.components().collect();
    if components.is_empty() || components.len() > 64 {
        return Err("Invalid artifact path depth.".into());
    }
    let mut parent = root_descriptor.try_clone().map_err(|e| e.to_string())?;
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err("Artifact path aliases are not allowed.".into());
        };
        let last = index + 1 == components.len();
        let file = open(
            &parent,
            Path::new(name),
            libc::O_RDONLY | if last { 0 } else { libc::O_DIRECTORY },
        )?;
        if last {
            return Ok(file);
        }
        parent = file;
    }
    Err("Invalid artifact path.".into())
}

pub(super) fn source(
    root: &Path,
    root_descriptor: &File,
    reference: &str,
    maximum: u64,
    max_source_mtime_ms: Option<u64>,
) -> Result<Vec<u8>, String> {
    let relative = workspace_relative(root, reference)?;
    let file = descend(root_descriptor, relative)?;
    if let Some(limit) = max_source_mtime_ms {
        modified_no_later_than(&file, limit)?;
    }
    read(file, maximum)
}

fn modified_no_later_than(file: &File, limit_epoch_ms: u64) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let modified_ms =
        i128::from(metadata.mtime()) * 1_000 + i128::from(metadata.mtime_nsec()) / 1_000_000;
    if modified_ms > i128::from(limit_epoch_ms) {
        return Err(errors::CHANGED_AFTER_TURN_ENDED.into());
    }
    Ok(())
}

pub(super) fn locate(root: &Path, root_descriptor: &File, reference: &str) -> Result<(), String> {
    let relative = workspace_relative(root, reference)?;
    let file = descend(root_descriptor, relative)?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err(errors::NOT_A_REGULAR_FILE.into());
    }
    Ok(())
}

pub(super) fn read(mut file: File, maximum: u64) -> Result<Vec<u8>, String> {
    use std::os::unix::fs::MetadataExt;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.nlink() != 1 || before.len() > maximum {
        return Err(errors::UNBOUNDED_OR_LINKED_FILE.into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(errors::CHANGED_WHILE_READING.into());
    }
    Ok(bytes)
}

pub(super) fn write(parent: &File, name: &str, bytes: &[u8]) -> Result<(), String> {
    let temporary = format!("{name}.part");
    // The store lock owns this deterministic partial file; a crashed writer cannot
    // still be using it after restart. Unlink never follows a stale symlink.
    let stale = CString::new(temporary.as_str()).unwrap();
    unsafe {
        libc::unlinkat(parent.as_raw_fd(), stale.as_ptr(), 0);
    }
    let mut file = open(
        parent,
        Path::new(&temporary),
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
    )?;
    let result = (|| {
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        let from = CString::new(temporary.as_str()).unwrap();
        let to = CString::new(name).unwrap();
        if unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                from.as_ptr(),
                parent.as_raw_fd(),
                to.as_ptr(),
            )
        } != 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        parent.sync_all().map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let temporary = CString::new(temporary).unwrap();
        unsafe {
            libc::unlinkat(parent.as_raw_fd(), temporary.as_ptr(), 0);
        }
    }
    result
}

const LOCK_BACKOFF_MS: [u64; 4] = [10, 20, 40, 80];

#[derive(Debug)]
pub(super) struct DirectoryLock<'a>(&'a File);

impl Drop for DirectoryLock<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn acquire(directory: &File) -> bool {
    unsafe { libc::flock(directory.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 }
}

pub(super) fn lock(directory: &File) -> Result<DirectoryLock<'_>, String> {
    for backoff in LOCK_BACKOFF_MS {
        if acquire(directory) {
            return Ok(DirectoryLock(directory));
        }
        sleep(Duration::from_millis(backoff));
    }
    if acquire(directory) {
        return Ok(DirectoryLock(directory));
    }
    Err(errors::STORAGE_BUSY.into())
}

pub(super) fn remove_partial(directory: &File, name: &str) {
    let name = CString::new(format!("{name}.part")).unwrap();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0);
    }
}
