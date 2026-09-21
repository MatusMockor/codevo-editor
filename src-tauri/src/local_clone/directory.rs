#[cfg(unix)]
use std::{
    ffi::CString,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{MetadataExt, OpenOptionsExt},
            process::CommandExt,
        },
    },
};
use std::{fs::File, path::PathBuf, process::Command};

pub(super) struct Destination {
    pub path: String,
    directory: File,
    parent: File,
    parent_path: PathBuf,
}
impl Destination {
    #[cfg(unix)]
    pub fn reserve(parent: &str, name: &str) -> Result<Self, String> {
        let parent_path =
            std::fs::canonicalize(parent).map_err(|_| "The destination folder is unavailable.")?;
        let parent = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&parent_path)
            .map_err(|_| "The destination folder is unavailable.")?;
        if name.is_empty() || name == "." || name == ".." || name.contains('/') {
            return Err("Invalid folder name.".into());
        }
        let path = parent_path
            .join(name)
            .into_os_string()
            .into_string()
            .map_err(|_| "The destination path must be valid UTF-8.")?;
        if path.len() > 4096 {
            return Err("The destination path is too long.".into());
        }
        let name_c = CString::new(name).map_err(|_| "Invalid folder name.")?;
        let staging_name = reservation::staging_name()?;
        let staging = reservation::reserve_staging(&parent, &staging_name)?;
        let directory = staging
            .directory
            .try_clone()
            .map_err(|_| "The clone folder could not be retained.")?;
        reservation::publish_staging(&parent, &staging_name, &name_c)?;
        drop(staging);
        let result = Self {
            path,
            directory,
            parent,
            parent_path,
        };
        result.verify()?;
        Ok(result)
    }
    #[cfg(not(unix))]
    pub fn reserve(_parent: &str, _name: &str) -> Result<Self, String> {
        Err("Local cloning is not supported on this platform.".into())
    }
    #[cfg(unix)]
    pub fn verify(&self) -> Result<(), String> {
        for (path, file) in [
            (self.parent_path.as_path(), &self.parent),
            (std::path::Path::new(&self.path), &self.directory),
        ] {
            let actual =
                std::fs::symlink_metadata(path).map_err(|_| "The clone destination changed.")?;
            let expected = file
                .metadata()
                .map_err(|_| "The clone destination changed.")?;
            if !actual.is_dir() || actual.dev() != expected.dev() || actual.ino() != expected.ino()
            {
                return Err("The clone destination changed.".into());
            }
        }
        Ok(())
    }
    #[cfg(not(unix))]
    pub fn verify(&self) -> Result<(), String> {
        Err("Unsupported platform.".into())
    }
    #[cfg(unix)]
    pub fn anchor(&self, command: &mut Command) {
        let fd = self.directory.as_raw_fd();
        // SAFETY: only async-signal-safe fchdir is executed in the child; self is
        // retained through spawning, and the descriptor closes on exec.
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(fd) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }
    #[cfg(not(unix))]
    pub fn anchor(&self, _command: &mut Command) {}
}

#[cfg(unix)]
impl Destination {
    /// Remove only the held, still registered partial destination after its child exits.
    pub fn cleanup(&self) -> Result<(), String> {
        self.verify()?;
        let name = std::path::Path::new(&self.path)
            .file_name()
            .ok_or("The clone destination changed.")?;
        use std::os::unix::ffi::OsStrExt;
        let name = CString::new(name.as_bytes()).map_err(|_| "Invalid clone destination.")?;
        let mut budget = CleanupBudget {
            remaining: 100_000,
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(10),
        };
        clear_directory(&self.directory, 0, &mut budget)?;
        self.verify()?;
        unlink_entry(self.parent.as_raw_fd(), &name, libc::AT_REMOVEDIR)
    }
}
#[cfg(not(unix))]
impl Destination {
    pub fn cleanup(&self) -> Result<(), String> {
        Err("Local clone cleanup is unsupported on this platform.".into())
    }
}

#[cfg(unix)]
struct CleanupBudget {
    remaining: usize,
    deadline: std::time::Instant,
}
#[cfg(unix)]
impl CleanupBudget {
    fn spend(&mut self, depth: usize) -> Result<(), String> {
        if depth > 64 || self.remaining == 0 || std::time::Instant::now() >= self.deadline {
            return Err(
                "Partial clone cleanup reached its limit; the remaining folder was preserved."
                    .into(),
            );
        }
        self.remaining -= 1;
        Ok(())
    }
}
#[cfg(unix)]
struct DirectoryStream(*mut libc::DIR);
#[cfg(unix)]
impl Drop for DirectoryStream {
    fn drop(&mut self) {
        // SAFETY: fdopendir transferred this stream into this unique guard.
        unsafe {
            libc::closedir(self.0);
        }
    }
}
#[cfg(unix)]
fn clear_directory(
    directory: &File,
    depth: usize,
    budget: &mut CleanupBudget,
) -> Result<(), String> {
    budget.spend(depth)?;
    // A separately opened descriptor avoids sharing a directory iteration offset.
    // SAFETY: the directory descriptor and NUL-terminated component are valid.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(cleanup_error());
    }
    // SAFETY: fd is an owned descriptor, transferred on success.
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() {
        // SAFETY: fdopendir did not take ownership on failure.
        unsafe {
            libc::close(fd);
        }
        return Err(cleanup_error());
    }
    let stream = DirectoryStream(stream);
    loop {
        // SAFETY: errno is thread-local, and stream is exclusively owned here.
        let entry = unsafe {
            *errno_pointer() = 0;
            libc::readdir(stream.0)
        };
        if entry.is_null() {
            // SAFETY: reading this thread's errno immediately after readdir.
            return if unsafe { *errno_pointer() } == 0 {
                Ok(())
            } else {
                Err(cleanup_error())
            };
        }
        // SAFETY: readdir supplies a NUL-terminated name valid until the next call.
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        if name.to_bytes() == b"." || name.to_bytes() == b".." {
            continue;
        }
        budget.spend(depth)?;
        let stat = entry_stat(directory.as_raw_fd(), name)?;
        if stat.st_mode & libc::S_IFMT == libc::S_IFDIR {
            // SAFETY: name belongs to the live stream; never follow a replacement symlink.
            let child_fd = unsafe {
                libc::openat(
                    directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child_fd < 0 {
                return Err(cleanup_error());
            }
            // SAFETY: child_fd is newly owned.
            let child = unsafe { File::from_raw_fd(child_fd) };
            let held = child.metadata().map_err(|_| cleanup_error())?;
            if held.dev() != stat.st_dev as u64 || held.ino() != stat.st_ino {
                return Err(cleanup_error());
            }
            clear_directory(&child, depth + 1, budget)?;
            let current = entry_stat(directory.as_raw_fd(), name)?;
            if current.st_dev != stat.st_dev || current.st_ino != stat.st_ino {
                return Err(cleanup_error());
            }
            unlink_entry(directory.as_raw_fd(), name, libc::AT_REMOVEDIR)?;
        } else {
            unlink_entry(directory.as_raw_fd(), name, 0)?;
        }
    }
}
#[cfg(unix)]
fn entry_stat(fd: std::os::fd::RawFd, name: &std::ffi::CStr) -> Result<libc::stat, String> {
    let mut stat = std::mem::MaybeUninit::uninit();
    // SAFETY: stat is writable, name valid, and no symlink is followed.
    if unsafe {
        libc::fstatat(
            fd,
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(cleanup_error());
    }
    // SAFETY: fstatat initialized stat successfully.
    Ok(unsafe { stat.assume_init() })
}
#[cfg(unix)]
fn unlink_entry(fd: std::os::fd::RawFd, name: &std::ffi::CStr, flags: i32) -> Result<(), String> {
    // SAFETY: descriptor and component are retained by the caller. unlinkat does not follow symlinks.
    if unsafe { libc::unlinkat(fd, name.as_ptr(), flags) } == 0 {
        Ok(())
    } else {
        Err(cleanup_error())
    }
}
#[cfg(unix)]
fn cleanup_error() -> String {
    "Partial clone cleanup could not finish safely; the remaining folder was preserved.".into()
}
#[cfg(target_os = "macos")]
unsafe fn errno_pointer() -> *mut libc::c_int {
    libc::__error()
}
#[cfg(target_os = "linux")]
unsafe fn errno_pointer() -> *mut libc::c_int {
    libc::__errno_location()
}

#[cfg(all(test, unix))]
#[path = "directory_tests.rs"]
mod tests;

#[cfg(unix)]
#[path = "directory_reservation.rs"]
mod reservation;
