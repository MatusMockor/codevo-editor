//! Descriptor-relative I/O for immutable output artifacts.
use std::{
    ffi::CString,
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
    path::{Component, Path},
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

pub(super) fn source(
    root: &Path,
    root_descriptor: &File,
    reference: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let path = Path::new(reference);
    let relative = if path.is_absolute() {
        path.strip_prefix(root)
            .map_err(|_| "Artifact is outside its workspace.")?
    } else {
        path
    };
    let mut parent = root_descriptor.try_clone().map_err(|e| e.to_string())?;
    let components: Vec<_> = relative.components().collect();
    if components.is_empty() || components.len() > 64 {
        return Err("Invalid artifact path depth.".into());
    }
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
            return read(file, maximum);
        }
        parent = file;
    }
    Err("Invalid artifact path.".into())
}

pub(super) fn read(mut file: File, maximum: u64) -> Result<Vec<u8>, String> {
    use std::os::unix::fs::MetadataExt;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.nlink() != 1 || before.len() > maximum {
        return Err("Artifact must be a bounded regular file without hard links.".into());
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
        return Err("Artifact changed while reading.".into());
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

pub(super) fn lock(directory: &File) -> Result<(), String> {
    if unsafe { libc::flock(directory.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Artifact storage is busy. Try again.".into());
    }
    Ok(())
}

pub(super) fn remove_partial(directory: &File, name: &str) {
    let name = CString::new(format!("{name}.part")).unwrap();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0);
    }
}
