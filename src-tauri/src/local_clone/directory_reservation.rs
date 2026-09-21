use super::*;

// A random private reservation avoids opening a predictable user-controlled replacement.
#[cfg(unix)]
pub(super) fn staging_name() -> Result<CString, String> {
    use std::io::Read;
    let mut random = [0_u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut random))
        .map_err(|_| "A private clone folder could not be reserved.")?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    CString::new(format!(".codevo-clone-{suffix}")).map_err(|_| "Invalid clone reservation.".into())
}
#[cfg(unix)]
pub(super) struct Staging<'a> {
    parent: &'a File,
    name: &'a std::ffi::CStr,
    pub(super) directory: File,
    owned: bool,
}
#[cfg(unix)]
impl Drop for Staging<'_> {
    fn drop(&mut self) {
        if !self.owned {
            return;
        }
        // Only an empty unpublished staging entry with the held identity may be removed.
        let Ok(named) = entry_stat(self.parent.as_raw_fd(), self.name) else {
            return;
        };
        let Ok(held) = self.directory.metadata() else {
            return;
        };
        if named.st_dev as u64 == held.dev() && named.st_ino == held.ino() {
            let _ = unlink_entry(self.parent.as_raw_fd(), self.name, libc::AT_REMOVEDIR);
        }
    }
}
#[cfg(unix)]
pub(super) fn reserve_staging<'a>(
    parent: &'a File,
    name: &'a std::ffi::CStr,
) -> Result<Staging<'a>, String> {
    // SAFETY: parent and validated random component are live; mode restricts access.
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
        return Err("A private clone folder could not be reserved.".into());
    }
    let expected = entry_stat(parent.as_raw_fd(), name)?;
    // SAFETY: open only this private directory, never a symlink.
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err("The private clone folder changed; its remaining entry was preserved.".into());
    }
    // SAFETY: this newly opened descriptor is uniquely owned.
    let mut staging = Staging {
        parent,
        name,
        directory: unsafe { File::from_raw_fd(fd) },
        owned: true,
    };
    let held = staging
        .directory
        .metadata()
        .map_err(|_| "The private clone folder changed.")?;
    if expected.st_dev as u64 != held.dev() || expected.st_ino != held.ino() {
        // Do not remove an entry that changed between inspection and descriptor acquisition.
        staging.owned = false;
        return Err("The private clone folder changed; its remaining entry was preserved.".into());
    }
    Ok(staging)
}
#[cfg(unix)]
pub(super) fn publish_staging(
    parent: &File,
    from: &std::ffi::CStr,
    to: &std::ffi::CStr,
) -> Result<(), String> {
    // SAFETY: both single components and the parent descriptor are live; exclusive
    // rename never replaces an existing directory, file, or symlink.
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            parent.as_raw_fd(),
            from.as_ptr(),
            parent.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            parent.as_raw_fd(),
            from.as_ptr(),
            parent.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(
            "The clone folder already exists or cannot be created. Choose another folder name."
                .into(),
        )
    }
}
