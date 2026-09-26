use super::{
    file_discard::{command_error, invalid, DISCARD_PATH_BLOCKED_ERROR},
    pinned_root::{EntryKind, GitInvocation, PinnedRoot},
    scratch_index::{git_path, ScratchIndex},
};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub(crate) const DISCARD_UNSUPPORTED_ENTRY_ERROR: &str =
    "This kind of file can't be restored here. Restore it with Git directly.";
const COMMAND_OUTPUT_BYTES: usize = 64 * 1024;
const SYMLINK_MODE: &str = "120000";
const RESTORABLE_MODES: [&str; 3] = ["100644", "100755", SYMLINK_MODE];
static NEXT_STAGING_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct StagingDirectory {
    path: PathBuf,
}

impl StagingDirectory {
    fn create(root: &PinnedRoot, trusted: bool) -> io::Result<Self> {
        let unique = NEXT_STAGING_DIRECTORY.fetch_add(1, Ordering::SeqCst);
        let name = format!("codevo-restore-{}-{unique}", std::process::id());
        let path = git_path(root, &name, trusted)?;
        let _ = fs::remove_dir_all(&path);
        fs::create_dir(&path)?;
        Ok(Self { path })
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(super) fn restore_without_clobbering(
    root: &PinnedRoot,
    path: &str,
    trusted: bool,
) -> io::Result<()> {
    let (mode, object) = head_entry(root, path, trusted)?;
    let scratch = ScratchIndex::create(root, "discard", trusted)?;
    let staging = StagingDirectory::create(root, trusted)?;
    let index = Some(scratch.path());
    run(
        root,
        &["update-index", "--add", "--cacheinfo", &mode, &object, path],
        index,
        trusted,
    )?;
    let mut prefix = staging.path.clone().into_os_string();
    prefix.push("/");
    let prefix = format!("--prefix={}", prefix.to_string_lossy());
    run(
        root,
        &["checkout-index", "--force", &prefix, "--", path],
        index,
        trusted,
    )?;
    let staged = staging.path.join(path);
    create_missing_parents(root, path)?;
    rename_no_clobber(&staged, &root.path().join(path), mode == SYMLINK_MODE)?;
    run(
        root,
        &[
            "--literal-pathspecs",
            "restore",
            "--source=HEAD",
            "--staged",
            "--",
            path,
        ],
        None,
        trusted,
    )
}

fn head_entry(root: &PinnedRoot, path: &str, trusted: bool) -> io::Result<(String, String)> {
    let output = root
        .run(
            &["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", path],
            trusted,
            COMMAND_OUTPUT_BYTES,
        )
        .map_err(command_error)?;
    let text = String::from_utf8(output)
        .map_err(|_| io::Error::other("Git returned non-UTF-8 output."))?;
    let entry = text
        .split('\0')
        .next()
        .and_then(|record| record.split_once('\t'))
        .filter(|(_, entry_path)| *entry_path == path)
        .map(|(meta, _)| meta.split(' ').collect::<Vec<_>>());
    let Some([mode, "blob", object]) = entry.as_deref() else {
        return Err(invalid(DISCARD_UNSUPPORTED_ENTRY_ERROR));
    };
    if !RESTORABLE_MODES.contains(mode) {
        return Err(invalid(DISCARD_UNSUPPORTED_ENTRY_ERROR));
    }
    Ok(((*mode).to_string(), (*object).to_string()))
}

fn create_missing_parents(root: &PinnedRoot, path: &str) -> io::Result<()> {
    for (index, _) in path.match_indices('/') {
        let ancestor = &path[..index];
        match root.entry_kind(ancestor)? {
            Some(EntryKind::Directory) => {}
            None => fs::create_dir(root.path().join(ancestor))?,
            Some(_) => return Err(invalid(DISCARD_PATH_BLOCKED_ERROR)),
        }
    }
    Ok(())
}

fn rename_no_clobber(from: &Path, to: &Path, symlink: bool) -> io::Result<()> {
    place_no_clobber(from, to, symlink, exclusive_rename)
}

fn place_no_clobber(
    from: &Path,
    to: &Path,
    symlink: bool,
    rename: fn(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    match rename(from, to) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(invalid(DISCARD_PATH_BLOCKED_ERROR))
        }
        Err(_) if symlink => symlink_no_clobber(from, to),
        Err(_) => copy_no_clobber(from, to),
    }
}

fn symlink_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    let target = fs::read_link(from)?;
    match std::os::unix::fs::symlink(target, to) {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(invalid(DISCARD_PATH_BLOCKED_ERROR))
        }
        result => result,
    }
}

fn copy_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut source = fs::File::open(from)?;
    let mode = source.metadata()?.permissions().mode() & 0o777;
    let mut target = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .mode(mode)
        .open(to)
    {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(invalid(DISCARD_PATH_BLOCKED_ERROR))
        }
        result => result?,
    };
    let copied = io::copy(&mut source, &mut target).and_then(|_| target.sync_all());
    if let Err(error) = copied {
        drop(target);
        let _ = fs::remove_file(to);
        return Err(error);
    }
    Ok(())
}

#[cfg(target_vendor = "apple")]
fn exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    let (from, to) = (c_path(from)?, c_path(to)?);
    // SAFETY: both arguments are valid NUL-terminated paths that outlive the call.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        return Ok(());
    }
    Err(io::Error::last_os_error())
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    let (from, to) = (c_path(from)?, c_path(to)?);
    // SAFETY: both arguments are valid NUL-terminated paths that outlive the call.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        return Ok(());
    }
    Err(io::Error::last_os_error())
}

#[cfg(not(any(target_vendor = "apple", all(target_os = "linux", target_env = "gnu"))))]
fn exclusive_rename(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

#[cfg(any(target_vendor = "apple", all(target_os = "linux", target_env = "gnu")))]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| invalid("Git path is invalid."))
}

fn run(root: &PinnedRoot, args: &[&str], index: Option<&Path>, trusted: bool) -> io::Result<()> {
    root.invoke(
        args,
        trusted,
        COMMAND_OUTPUT_BYTES,
        GitInvocation {
            index_file: index,
            ..GitInvocation::default()
        },
    )
    .map(|_| ())
    .map_err(command_error)
}

#[cfg(test)]
#[path = "discard_restore_tests.rs"]
mod tests;
