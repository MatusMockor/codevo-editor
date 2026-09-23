use super::{git_process, types::*};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::{
    ffi::CString,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
};
use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path},
    time::{Duration, Instant},
};

pub(super) const TIME_LIMIT: Duration = Duration::from_secs(30);
pub(super) fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.chars().any(char::is_control)
        && path.split('/').count() <= 64
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        && !path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
        })
        && !path.contains('\\')
        && !path.contains(':')
}
pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(unix)]
pub(super) fn root_identity(root: &Path) -> Result<(File, RootIdentity), String> {
    let canonical = fs::canonicalize(root).map_err(|_| "The workspace is unavailable.")?;
    let path = canonical
        .to_str()
        .filter(|path| path.len() <= 4096)
        .ok_or("Invalid workspace path.")?
        .to_owned();
    let handle = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&canonical)
        .map_err(|_| "The workspace is unavailable.")?;
    let metadata = handle
        .metadata()
        .map_err(|_| "The workspace is unavailable.")?;
    Ok((
        handle,
        RootIdentity {
            path,
            device: metadata.dev(),
            inode: metadata.ino(),
        },
    ))
}
#[cfg(not(unix))]
pub(super) fn root_identity(_: &Path) -> Result<(File, RootIdentity), String> {
    Err("Turn changes are unavailable on this platform.".into())
}

pub(super) fn verify_root(identity: &RootIdentity) -> Result<(), String> {
    let (_, current) = root_identity(Path::new(&identity.path))?;
    if &current != identity {
        return Err("The workspace changed while recording turn changes.".into());
    }
    Ok(())
}
pub(super) fn capture(
    root: &File,
    identity: &RootIdentity,
    baseline: Option<&Snapshot>,
) -> Result<Snapshot, String> {
    let started = Instant::now();
    let mut paths: std::collections::BTreeSet<String> =
        git_process::inventory(Path::new(&identity.path))?
            .into_iter()
            .collect();
    if let Some(baseline) = baseline {
        paths.extend(baseline.keys().cloned());
    }
    if paths.len() > 10000 {
        return Err("The repository exceeds the turn snapshot file limit.".into());
    }
    verify_root(identity)?;
    let mut snapshot = Snapshot::new();
    let mut read_bytes = 0;
    let mut text_bytes = 0;
    for path in paths {
        if started.elapsed() > TIME_LIMIT {
            return Err("Recording turn changes exceeded the time limit.".into());
        }
        if !valid_relative(&path) {
            return Err("The repository contains an unsupported file path.".into());
        }
        let Some(entry) = read_entry(root, &path, &mut read_bytes)? else {
            continue;
        };
        text_bytes += entry.text.as_ref().map_or(0, String::len);
        if text_bytes > MAX_SNAPSHOT_BYTES {
            return Err("The repository exceeds the turn snapshot size limit.".into());
        }
        snapshot.insert(path, entry);
    }
    verify_root(identity)?;
    Ok(snapshot)
}

#[cfg(unix)]
pub(super) fn read_raw_entry(
    root: &File,
    path: &str,
    read_bytes: &mut usize,
) -> Result<Option<(Vec<u8>, u32)>, String> {
    let mut parent = root
        .try_clone()
        .map_err(|_| "Unable to read the workspace.")?;
    let parts = path.split('/').collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        let last = index + 1 == parts.len();
        let name = CString::new(*part).map_err(|_| "Invalid file path.")?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | libc::O_NONBLOCK
            | if last { 0 } else { libc::O_DIRECTORY };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            if last && error.raw_os_error() == Some(libc::ELOOP) {
                let mut target = vec![0_u8; 4097];
                let count = unsafe {
                    libc::readlinkat(
                        parent.as_raw_fd(),
                        name.as_ptr(),
                        target.as_mut_ptr().cast(),
                        target.len(),
                    )
                };
                if count < 0 || count as usize >= target.len() {
                    return Err("Unable to record a symbolic link safely.".into());
                }
                target.truncate(count as usize);
                *read_bytes += target.len();
                if *read_bytes > MAX_READ_BYTES {
                    return Err("The repository exceeds the turn snapshot read limit.".into());
                }
                return Ok(Some((target, 0o120000)));
            }
            return Err("A repository file could not be read safely.".into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if !last {
            parent = file;
            continue;
        }
        let metadata = file
            .metadata()
            .map_err(|_| "Unable to inspect a repository file.")?;
        // Gitlinks/submodules require a separate repository snapshot, not a recursive walk.
        if !metadata.is_file() {
            return Err("Turn changes include an unsupported repository entry.".into());
        }
        if metadata.nlink() > 1 {
            return Err("A repository file has unsupported external hard links.".into());
        }
        if metadata.len() > MAX_HASH_FILE_BYTES {
            return Err("A repository file exceeds the turn snapshot size limit.".into());
        }
        let mut reader = &file;
        let mut text_bytes = Vec::new();
        let mut length = 0_u64;
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|_| "Unable to read a repository file.")?;
            if count == 0 {
                break;
            }
            length += count as u64;
            *read_bytes += count;
            if length > MAX_HASH_FILE_BYTES || *read_bytes > MAX_READ_BYTES {
                return Err("The repository exceeds the turn snapshot read limit.".into());
            }
            text_bytes.extend_from_slice(&buffer[..count]);
        }
        let after = file
            .metadata()
            .map_err(|_| "Unable to inspect a repository file.")?;
        if metadata.len() != after.len()
            || metadata.mtime() != after.mtime()
            || metadata.mtime_nsec() != after.mtime_nsec()
            || metadata.ctime() != after.ctime()
            || metadata.ctime_nsec() != after.ctime_nsec()
        {
            return Err("A repository file changed while its snapshot was recorded.".into());
        }
        return Ok(Some((
            text_bytes,
            if metadata.mode() & 0o111 != 0 {
                0o100755
            } else {
                0o100644
            },
        )));
    }
    Err("Invalid repository file path.".into())
}
#[cfg(not(unix))]
pub(super) fn read_raw_entry(
    _: &File,
    _: &str,
    _: &mut usize,
) -> Result<Option<(Vec<u8>, u32)>, String> {
    Err("Turn changes are unavailable on this platform.".into())
}

fn read_entry(root: &File, path: &str, read_bytes: &mut usize) -> Result<Option<Entry>, String> {
    let Some((bytes, mode)) = read_raw_entry(root, path, read_bytes)? else {
        return Ok(None);
    };
    let unavailable = if bytes.len() > MAX_FILE_BYTES {
        Some(DiffUnavailableReason::Large)
    } else if mode == 0o120000 || bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
        Some(DiffUnavailableReason::Binary)
    } else {
        None
    };
    Ok(Some(Entry {
        digest: digest(&bytes),
        executable: mode == 0o100755,
        text: if unavailable.is_none() {
            Some(String::from_utf8(bytes).map_err(|_| "Invalid file text.")?)
        } else {
            None
        },
        unavailable,
    }))
}
