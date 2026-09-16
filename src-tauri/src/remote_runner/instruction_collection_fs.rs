//! Descriptor-relative reads keep instruction collection inside its captured root.
use std::ffi::{CStr, CString, OsString};
use std::fs::{File, Metadata};
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

pub(super) fn open_root(path: &Path) -> Result<File, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot locate instruction root: {e}"))?;
    let name =
        CString::new(canonical.as_os_str().as_bytes()).map_err(|_| "Invalid instruction root")?;
    let fd = unsafe {
        libc::open(
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(format!(
            "Cannot open instruction root: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(super) fn open_child(parent: &File, name: &std::ffi::OsStr) -> Result<File, String> {
    let name = CString::new(name.as_bytes()).map_err(|_| "Invalid instruction filename")?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err(format!(
            "Cannot safely open instruction entry: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(super) fn names(dir: &File, remaining: usize) -> Result<Vec<OsString>, String> {
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            c".".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err("Cannot duplicate instruction directory".into());
    }
    let ptr = unsafe { libc::fdopendir(fd) };
    if ptr.is_null() {
        unsafe { libc::close(fd) };
        return Err("Cannot scan instruction directory".into());
    }
    struct Directory(*mut libc::DIR);
    impl Drop for Directory {
        fn drop(&mut self) {
            unsafe { libc::closedir(self.0) };
        }
    }
    let directory = Directory(ptr);
    unsafe { libc::rewinddir(directory.0) };
    let mut result = Vec::new();
    loop {
        set_errno(0);
        let entry = unsafe { libc::readdir(directory.0) };
        if entry.is_null() {
            if errno() != 0 {
                return Err("Cannot finish scanning instruction directory".into());
            }
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        if result.len() >= remaining {
            return Err("Instruction directory scan exceeds 50000 entries".into());
        }
        result.push(OsString::from_vec(bytes.to_vec()));
    }
    result.sort();
    Ok(result)
}

pub(super) fn metadata_at(parent: &File, name: &std::ffi::OsStr) -> Result<libc::mode_t, String> {
    let name = CString::new(name.as_bytes()).map_err(|_| "Invalid instruction filename")?;
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err("Instruction directory changed during collection; retry the message".into());
    }
    Ok(unsafe { stat.assume_init() }.st_mode & libc::S_IFMT)
}

fn same(a: &Metadata, b: &Metadata) -> bool {
    a.dev() == b.dev()
        && a.ino() == b.ino()
        && a.len() == b.len()
        && a.mtime() == b.mtime()
        && a.mtime_nsec() == b.mtime_nsec()
        && a.ctime() == b.ctime()
        && a.ctime_nsec() == b.ctime_nsec()
}

pub(super) fn read(root: &Arc<File>, path: &Path) -> Result<(String, Stamp), String> {
    let mut file = root.try_clone().map_err(|e| e.to_string())?;
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err("Unsafe instruction path".into());
        };
        file = open_child(&file, name)?;
    }
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > 65536 {
        return Err("Instruction must be a regular UTF-8 file no larger than 64 KiB".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if bytes.len() > 65536 || !same(&before, &after) {
        return Err("Instruction changed during collection; retry the message".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "Instruction file is not UTF-8")?;
    Ok((
        content,
        Stamp {
            target: Target::File {
                file,
                root: root.clone(),
                path: path.to_owned(),
            },
            before,
        },
    ))
}

#[cfg(target_os = "macos")]
fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__error() }
}
#[cfg(not(target_os = "macos"))]
fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__errno_location() }
}
fn set_errno(value: libc::c_int) {
    unsafe {
        *errno_pointer() = value;
    }
}
fn errno() -> libc::c_int {
    unsafe { *errno_pointer() }
}

enum Target {
    File {
        file: File,
        root: Arc<File>,
        path: PathBuf,
    },
    Directory {
        root: Arc<File>,
        path: PathBuf,
    },
}
pub(super) struct Stamp {
    target: Target,
    before: Metadata,
}
impl Stamp {
    pub(super) fn capture_directory(
        root: &Arc<File>,
        path: &Path,
        file: &File,
    ) -> Result<Self, String> {
        Ok(Self {
            target: Target::Directory {
                root: root.clone(),
                path: path.to_owned(),
            },
            before: file.metadata().map_err(|e| e.to_string())?,
        })
    }
    pub(super) fn validate(&self) -> Result<(), String> {
        let after = match &self.target {
            Target::File { file, root, path } => {
                let current = reopen(root, path)?.metadata().map_err(|e| e.to_string())?;
                let retained = file.metadata().map_err(|e| e.to_string())?;
                if !same(&retained, &current) {
                    return Err(
                        "Instruction import path changed during collection; retry the message"
                            .into(),
                    );
                }
                retained
            }
            Target::Directory { root, path } => {
                reopen(root, path)?.metadata().map_err(|e| e.to_string())?
            }
        };
        if !same(&self.before, &after) {
            return Err("Instruction files changed during collection; retry the message".into());
        }
        Ok(())
    }
}

fn reopen(root: &File, path: &Path) -> Result<File, String> {
    let mut file = root.try_clone().map_err(|e| e.to_string())?;
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err("Unsafe instruction path".into());
        };
        file = open_child(&file, name)?;
    }
    Ok(file)
}
