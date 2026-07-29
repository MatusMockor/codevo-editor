use super::{CommandFailure, FileRevision, MutationFailure};
use crate::workspace_registry::validate_relative_path;
use std::{
    ffi::{CStr, CString, OsStr},
    fs::File,
    io::{self, Read},
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};

pub(super) fn open_directory_path(root: RawFd, path: &Path) -> io::Result<File> {
    if path.as_os_str().is_empty() {
        return open_directory_at(root, c".");
    }
    let mut current = unsafe_dup(root)?;
    for component in path.components() {
        let name = CString::new(component.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
        current = open_directory_at(current.as_raw_fd(), &name)?;
    }
    Ok(current)
}

pub(super) fn unsafe_dup(fd: RawFd) -> io::Result<File> {
    let cloned = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if cloned < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(cloned) })
}

pub(super) fn split_path(path: &Path) -> io::Result<(&Path, CString)> {
    validate_relative_path(path)?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    Ok((path.parent().unwrap_or(Path::new("")), cstring(name)?))
}

pub(super) fn cstring(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes()).map_err(io::Error::other)
}

pub(super) fn open_parent(root: RawFd, path: &Path) -> io::Result<File> {
    if path.as_os_str().is_empty() {
        let fd = unsafe { libc::fcntl(root, libc::F_DUPFD_CLOEXEC, 0) };
        return fd_result(fd);
    }
    open_directory_path(root, path)
}

pub(super) fn open_regular(root: RawFd, path: &Path, flags: libc::c_int) -> io::Result<File> {
    validate_relative_path(path)?;
    let path = cstring(path.as_os_str())?;
    let fd = open_regular_beneath(root, &path, flags)?;
    let file = fd_result(fd)?;
    regular_unlinked_stat(file.as_raw_fd())?;
    Ok(file)
}

#[cfg(target_os = "macos")]
fn open_regular_beneath(root: RawFd, path: &CStr, flags: libc::c_int) -> io::Result<libc::c_int> {
    Ok(unsafe {
        libc::openat(
            root,
            path.as_ptr(),
            flags
                | libc::O_NONBLOCK
                | libc::O_CLOEXEC
                | libc::O_NOFOLLOW_ANY
                | super::O_RESOLVE_BENEATH,
        )
    })
}

#[cfg(target_os = "linux")]
fn open_regular_beneath(root: RawFd, path: &CStr, flags: libc::c_int) -> io::Result<libc::c_int> {
    let mut how: libc::open_how = unsafe { std::mem::zeroed() };
    how.flags = (flags | libc::O_NONBLOCK | libc::O_CLOEXEC) as u64;
    how.resolve = libc::RESOLVE_BENEATH | libc::RESOLVE_NO_SYMLINKS;
    let mut attempts = 0;
    loop {
        let fd = unsafe {
            libc::syscall(
                libc::SYS_openat2,
                root,
                path.as_ptr(),
                &how,
                std::mem::size_of::<libc::open_how>(),
            ) as libc::c_int
        };
        if fd >= 0
            || io::Error::last_os_error().raw_os_error() != Some(libc::EAGAIN)
            || attempts == 2
        {
            return Ok(fd);
        }
        attempts += 1;
    }
}

pub(super) fn open_regular_at(parent: RawFd, name: &CStr, flags: libc::c_int) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            flags | libc::O_NONBLOCK | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    let file = fd_result(fd)?;
    regular_unlinked_stat(file.as_raw_fd())?;
    Ok(file)
}

pub(super) fn open_directory_at(parent: RawFd, name: &CStr) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    fd_result(fd)
}

fn fd_result(fd: libc::c_int) -> io::Result<File> {
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}

pub(super) fn regular_unlinked_stat(fd: RawFd) -> io::Result<libc::stat> {
    let stat = fstat(fd)?;
    ensure_regular_single_link(&stat)?;
    Ok(stat)
}

pub(super) fn ensure_regular_single_link(stat: &libc::stat) -> io::Result<()> {
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path is not a regular file",
        ));
    }
    if stat.st_nlink != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "hard-linked files are not supported",
        ));
    }
    Ok(())
}

pub(super) fn ensure_supported_entry(stat: &libc::stat) -> io::Result<()> {
    match stat.st_mode & libc::S_IFMT {
        libc::S_IFREG => ensure_regular_single_link(stat),
        libc::S_IFDIR => Ok(()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symlinks and special files are not supported",
        )),
    }
}

pub(super) fn fstat(fd: RawFd) -> io::Result<libc::stat> {
    let mut value = std::mem::MaybeUninit::uninit();
    if unsafe { libc::fstat(fd, value.as_mut_ptr()) } != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { value.assume_init() })
    }
}

pub(super) fn stat_at(parent: RawFd, name: &CStr) -> io::Result<libc::stat> {
    let mut value = std::mem::MaybeUninit::uninit();
    if unsafe {
        libc::fstatat(
            parent,
            name.as_ptr(),
            value.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { value.assume_init() })
    }
}

pub(super) fn revision(stat: &libc::stat, content: &[u8]) -> FileRevision {
    FileRevision {
        device: stat.st_dev as u64,
        inode: stat.st_ino,
        size: stat.st_size,
        modified_seconds: stat.st_mtime,
        modified_nanoseconds: stat.st_mtime_nsec,
        content_hash: content_hash(content),
    }
}

pub(super) fn same_snapshot(a: &libc::stat, b: &libc::stat) -> bool {
    same_identity(a, b)
        && a.st_size == b.st_size
        && a.st_mtime == b.st_mtime
        && a.st_mtime_nsec == b.st_mtime_nsec
}

pub(super) fn content_hash(content: &[u8]) -> u64 {
    content.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

pub(super) fn read_all(file: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub(super) fn same_identity(a: &libc::stat, b: &libc::stat) -> bool {
    a.st_dev == b.st_dev
        && a.st_ino == b.st_ino
        && a.st_mode & libc::S_IFMT == b.st_mode & libc::S_IFMT
}

pub(super) fn same_entry_snapshot(a: &libc::stat, b: &libc::stat) -> bool {
    if a.st_mode & libc::S_IFMT == libc::S_IFREG {
        return same_snapshot(a, b);
    }
    same_identity(a, b)
}

pub(super) fn sync_dir(dir: &File) -> io::Result<()> {
    if unsafe { libc::fsync(dir.as_raw_fd()) } != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub(super) fn sync_after_commit(dir: &File, action: &str) -> Result<(), MutationFailure> {
    sync_dir(dir).map_err(|error| {
        MutationFailure::Partial(format!(
            "{action}, but its parent directory could not be synced: {error}"
        ))
    })
}

impl From<io::Error> for CommandFailure {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}
