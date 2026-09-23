use super::{checkpoint, read_errors, record_validation, snapshot, types::*};
#[cfg(unix)]
use std::os::unix::{
    fs::{MetadataExt, OpenOptionsExt},
    io::{AsRawFd, FromRawFd},
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NONCE: AtomicU64 = AtomicU64::new(0);

// Every component is opened relative to its already-owned parent. Symlinks
// cannot redirect publication or retention outside the selected storage tree.
pub(super) fn directory(path: &Path, create: bool) -> std::io::Result<File> {
    use std::path::Component;
    if !path.is_absolute() {
        return Err(std::io::Error::other("absolute storage path required"));
    }
    let mut directory = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open("/")?;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => directory = child_directory(&directory, name, create)?,
            _ => return Err(std::io::Error::other("invalid storage component")),
        }
    }
    Ok(directory)
}
fn c_name(name: &std::ffi::OsStr) -> std::io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    if name.as_bytes().contains(&b'/') || name == "." || name == ".." {
        return Err(std::io::Error::other("invalid storage name"));
    }
    std::ffi::CString::new(name.as_bytes()).map_err(std::io::Error::other)
}
fn child_directory(parent: &File, name: &std::ffi::OsStr, create: bool) -> std::io::Result<File> {
    let name = c_name(name)?;
    if create {
        // SAFETY: parent is an owned live directory and name is a single component.
        let result = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
        if result != 0
            && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(std::io::Error::last_os_error());
        }
    }
    // SAFETY: parent remains alive for the call; no symlink is followed.
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: successful openat transfers a fresh descriptor to this File.
    Ok(unsafe { File::from_raw_fd(fd) })
}
pub(super) fn child_file(
    parent: &File,
    name: &std::ffi::OsStr,
    flags: i32,
) -> std::io::Result<File> {
    let name = c_name(name)?;
    // SAFETY: parent is retained and name is NUL terminated and one component.
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: successful openat returns a uniquely owned descriptor.
    Ok(unsafe { File::from_raw_fd(fd) })
}
pub(super) fn unlink(parent: &File, name: &std::ffi::OsStr, flags: i32) -> std::io::Result<()> {
    let name = c_name(name)?;
    // SAFETY: retained directory descriptor and validated single component.
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), flags) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(target_os = "macos")]
unsafe fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__error() }
}
#[cfg(not(target_os = "macos"))]
unsafe fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__errno_location() }
}

pub(super) fn names(directory: &File, limit: usize) -> Result<Vec<std::ffi::OsString>, String> {
    use std::os::unix::ffi::OsStringExt;
    // Open a fresh description so enumeration does not share directory offsets.
    let dot = std::ffi::CString::new(".").unwrap();
    // SAFETY: directory is retained and dot is a valid NUL terminated string.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            dot.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err("Unable to enumerate turn history.".into());
    }
    // SAFETY: fd is a newly opened directory; fdopendir takes ownership on success.
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() {
        // SAFETY: fdopendir failed, so we still own fd.
        unsafe {
            libc::close(fd);
        }
        return Err("Unable to enumerate turn history.".into());
    }
    struct Dir(*mut libc::DIR);
    impl Drop for Dir {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    let stream = Dir(stream);
    let mut result = Vec::new();
    loop {
        // SAFETY: this function owns the stream and reads each entry before advancing.
        unsafe {
            *errno_pointer() = 0;
        }
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            if unsafe { *errno_pointer() } != 0 {
                return Err("Unable to enumerate turn history.".into());
            }
            break;
        }
        // SAFETY: readdir supplies a NUL terminated name valid until its next call.
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name == b"." || name == b".." {
            continue;
        }
        if result.len() >= limit {
            return Err("Turn history storage exceeds its entry limit.".into());
        }
        result.push(std::ffi::OsString::from_vec(name.to_vec()));
    }
    Ok(result)
}
pub(super) fn hash_name(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub(super) fn private_directory(path: &Path) -> Result<(), String> {
    directory(path, true)
        .map(|_| ())
        .map_err(|_| "Unable to create safe turn history storage.".into())
}
pub(super) fn record_path(base: &Path, root: &RootIdentity, turn_id: &str) -> PathBuf {
    base.join(snapshot::digest(root.path.as_bytes()))
        .join(format!("{}.json", snapshot::digest(turn_id.as_bytes())))
}
pub(super) fn read(path: &Path) -> Result<Option<Record>, String> {
    let parent = path.parent().ok_or("Invalid turn history path.")?;
    let name = path.file_name().ok_or("Invalid turn history path.")?;
    let parent = match directory(parent, false) {
        Ok(parent) => parent,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Saved turn changes cannot be read safely.".into()),
    };
    let file = match child_file(&parent, name, libc::O_RDONLY) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Saved turn changes cannot be read safely.".into()),
    };
    let metadata = file
        .metadata()
        .map_err(|_| read_errors::RECORD_UNAVAILABLE)?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
        return Err("Saved turn changes exceed the supported size.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| read_errors::RECORD_READ_FAILED)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("Saved turn changes exceed the supported size.".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "Saved turn changes are invalid.".into())
}
struct LimitedWriter {
    file: File,
    bytes: u64,
}
impl Write for LimitedWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.bytes + bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(std::io::Error::other("snapshot limit"));
        }
        let count = self.file.write(bytes)?;
        self.bytes += count as u64;
        Ok(count)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}
pub(super) struct TemporaryDirectory(pub PathBuf, File, File, std::ffi::OsString);
impl TemporaryDirectory {
    pub(super) fn verify_identity(&self) -> Result<(), String> {
        let current =
            directory(&self.0, false).map_err(|_| "Turn comparison directory changed.")?;
        let old = self
            .2
            .metadata()
            .map_err(|_| "Turn comparison directory unavailable.")?;
        let new = current
            .metadata()
            .map_err(|_| "Turn comparison directory unavailable.")?;
        if old.dev() != new.dev() || old.ino() != new.ino() {
            return Err("Turn comparison directory changed.".into());
        }
        Ok(())
    }
    pub(super) fn open_read(&self, name: &str) -> Result<File, String> {
        child_file(&self.2, std::ffi::OsStr::new(name), libc::O_RDONLY)
            .map_err(|_| "Unable to read private checkpoint input.".into())
    }
    pub(super) fn write_relative(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        if path.is_absolute() || path.as_os_str().len() > 4096 {
            return Err("Invalid comparison path.".into());
        }
        let mut parent = self
            .2
            .try_clone()
            .map_err(|_| "Comparison directory unavailable.")?;
        let mut parts = path.components().peekable();
        while let Some(part) = parts.next() {
            let std::path::Component::Normal(name) = part else {
                return Err("Invalid comparison path.".into());
            };
            if parts.peek().is_some() {
                parent = child_directory(&parent, name, true)
                    .map_err(|_| "Cannot prepare comparison directory.")?;
            } else {
                child_file(&parent, name, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL)
                    .and_then(|mut file| file.write_all(bytes))
                    .map_err(|_| "Cannot write comparison file.")?;
                return Ok(());
            }
        }
        Err("Invalid comparison path.".into())
    }
    pub fn new(base: &Path) -> Result<Self, String> {
        let parent =
            directory(base, true).map_err(|_| "Unable to prepare turn history storage.")?;
        let mut random = [0_u8; 16];
        File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut random))
            .map_err(|_| "Unable to allocate private turn directory.")?;
        let name = std::ffi::OsString::from(format!(
            "temporary-{}",
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let c = c_name(&name).map_err(|_| "Invalid temporary name.")?;
        // SAFETY: parent is retained and the name is a validated single component.
        if unsafe { libc::mkdirat(parent.as_raw_fd(), c.as_ptr(), 0o700) } != 0 {
            return Err("Unable to prepare turn changes.".into());
        }
        let child =
            child_directory(&parent, &name, false).map_err(|_| "Unable to open turn changes.")?;
        Ok(Self(base.join(&name), parent, child, name))
    }
}
fn remove_contents(directory: &File, depth: usize, budget: &mut usize) -> Result<(), String> {
    if depth > 128 {
        return Err("Temporary turn directory exceeds depth limit.".into());
    }
    for name in names(directory, 10_002)? {
        *budget = budget
            .checked_sub(1)
            .ok_or("Temporary directory exceeds cleanup limit.")?;
        if let Ok(child) = child_directory(directory, &name, false) {
            remove_contents(&child, depth + 1, budget)?;
            unlink(directory, &name, libc::AT_REMOVEDIR)
                .map_err(|_| "Cannot remove temporary directory.")?;
        } else {
            unlink(directory, &name, 0).map_err(|_| "Cannot remove temporary file.")?;
        }
    }
    Ok(())
}
impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = remove_contents(&self.2, 0, &mut 30_000);
        if let Ok(current) = child_directory(&self.1, &self.3, false) {
            if let (Ok(old), Ok(new)) = (self.2.metadata(), current.metadata()) {
                if old.dev() == new.dev() && old.ino() == new.ino() {
                    let _ = unlink(&self.1, &self.3, libc::AT_REMOVEDIR);
                }
            }
        }
    }
}
pub(super) fn write(path: &Path, record: &Record) -> Result<(), String> {
    let parent_path = path.parent().ok_or("Invalid turn history storage.")?;
    let parent =
        directory(parent_path, true).map_err(|_| "Unable to open safe turn history storage.")?;
    let target_name = c_name(path.file_name().ok_or("Invalid turn history filename.")?)
        .map_err(|_| "Invalid turn history filename.")?;
    let temp_name = std::ffi::OsString::from(format!(
        "pending-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::Relaxed)
    ));
    struct Pending<'a>(&'a File, &'a std::ffi::OsStr);
    impl Drop for Pending<'_> {
        fn drop(&mut self) {
            let _ = unlink(self.0, self.1, 0);
        }
    }
    let file = child_file(
        &parent,
        &temp_name,
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
    )
    .map_err(|_| "Unable to save turn changes.")?;
    let _pending = Pending(&parent, &temp_name);
    let mut writer = LimitedWriter { file, bytes: 0 };
    serde_json::to_writer(&mut writer, record)
        .map_err(|_| "Unable to save turn changes within the size limit.")?;
    writer
        .file
        .sync_all()
        .map_err(|_| "Unable to save turn changes.")?;
    let temp_name = c_name(&temp_name).map_err(|_| "Invalid temporary filename.")?;
    // SAFETY: both names are validated and both endpoints use the same retained parent.
    if unsafe {
        libc::renameat(
            parent.as_raw_fd(),
            temp_name.as_ptr(),
            parent.as_raw_fd(),
            target_name.as_ptr(),
        )
    } != 0
    {
        return Err("Unable to publish turn changes.".into());
    }
    parent
        .sync_all()
        .map_err(|_| "Unable to synchronize turn changes.")?;
    Ok(())
}
/// Oldest records are removed first. Retention is 32 turns per root and 256 MiB overall.
pub(super) fn prune(base: &Path, current: &Path) -> Result<(), String> {
    let base_fd = directory(base, false).map_err(|_| "Turn history storage is unavailable.")?;
    let mut roots = Vec::new();
    let mut records = Vec::new();
    let mut total = 0_u64;
    for root_name in names(&base_fd, 1024)? {
        if !hash_name(&root_name) {
            continue;
        }
        let root = child_directory(&base_fd, &root_name, false)
            .map_err(|_| "Unsafe turn history root.")?;
        let root_index = roots.len();
        for name in names(&root, 1024)? {
            let path = Path::new(&name);
            if path.file_stem().is_none_or(|stem| !hash_name(stem))
                || path.extension().is_none_or(|ext| ext != "json")
            {
                continue;
            }
            if records.len() >= 32768 {
                return Err("Turn history storage exceeds the record limit.".into());
            }
            let file = child_file(&root, &name, libc::O_RDONLY)
                .map_err(|_| "Unsafe turn history record.")?;
            let metadata = file
                .metadata()
                .map_err(|_| "Turn history storage is unavailable.")?;
            if !metadata.is_file() {
                return Err("Unsafe turn history record.".into());
            }
            total = total.saturating_add(metadata.len());
            let protected = base.join(&root_name).join(&name) == current;
            records.push((
                metadata.modified().ok(),
                root_index,
                name,
                metadata.len(),
                protected,
            ));
        }
        roots.push(root);
    }
    records.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.2.cmp(&b.2))
    });
    let mut counts = vec![0_usize; roots.len()];
    for (_, root, _, _, _) in &records {
        counts[*root] += 1;
    }
    for (_, root, name, bytes, protected) in records {
        if !protected && (total > MAX_STORAGE_BYTES || counts[root] > MAX_TURNS) {
            // Read through the retained directory, then only remove exact-owner refs.
            // A missing/replaced repository cannot authorize touching its replacement.
            let mut saved_bytes = Vec::new();
            child_file(&roots[root], &name, libc::O_RDONLY)
                .and_then(|file| {
                    file.take(MAX_RECORD_BYTES + 1)
                        .read_to_end(&mut saved_bytes)
                })
                .map_err(|_| "Unable to read expired turn metadata.")?;
            if saved_bytes.len() as u64 <= MAX_RECORD_BYTES {
                if let Ok(record) = serde_json::from_slice::<Record>(&saved_bytes) {
                    if record_validation::validate_record(&record, &record.root, &record.turn_id)
                        .is_ok()
                        && snapshot::verify_root(&record.root).is_ok()
                    {
                        if let Some(checkpoints) = &record.checkpoints {
                            for saved in checkpoints.before.iter().chain(checkpoints.after.iter()) {
                                let _ = checkpoint::delete(&record.root, saved);
                            }
                        }
                    }
                }
            }
            unlink(&roots[root], &name, 0)
                .map_err(|_| "Unable to enforce turn history retention.")?;
            total = total.saturating_sub(bytes);
            counts[root] -= 1;
        }
    }
    if total > MAX_STORAGE_BYTES || counts.iter().any(|count| *count > MAX_TURNS) {
        return Err("Turn history storage exceeds retention bounds.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn temporary_writes_and_cleanup_retain_original_directory_after_replacement() {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let outer = TemporaryDirectory::new(&parent).unwrap();
        let temp = TemporaryDirectory::new(&outer.0).unwrap();
        temp.write_relative(Path::new("nested/original"), b"original")
            .unwrap();
        let foreign = outer.0.join("foreign");
        fs::create_dir(&foreign).unwrap();
        fs::write(foreign.join("protected"), b"preserved").unwrap();
        let moved = outer.0.join("moved");
        fs::rename(&temp.0, &moved).unwrap();
        symlink(&foreign, &temp.0).unwrap();
        assert!(temp.verify_identity().is_err());
        temp.write_relative(Path::new("retained"), b"safe").unwrap();
        assert!(moved.join("retained").exists());
        assert!(!foreign.join("retained").exists());
        drop(temp);
        assert_eq!(fs::read(foreign.join("protected")).unwrap(), b"preserved");
        assert!(!moved.join("retained").exists());
    }

    #[test]
    fn anchored_directory_rejects_symlink_components_and_relative_paths() {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let outer = TemporaryDirectory::new(&parent).unwrap();
        fs::create_dir(outer.0.join("actual")).unwrap();
        symlink(outer.0.join("actual"), outer.0.join("alias")).unwrap();
        assert!(private_directory(&outer.0.join("alias/nested")).is_err());
        assert!(!outer.0.join("actual/nested").exists());
        assert!(directory(Path::new("relative/path"), true).is_err());
        assert!(outer
            .write_relative(Path::new("../escape"), b"bad")
            .is_err());
    }
}
