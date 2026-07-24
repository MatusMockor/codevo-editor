use crate::workspace::FileEntryKind;
use crate::workspace_file_commands::DescriptorFileEntry;
use crate::workspace_registry::{validate_relative_path, WorkspaceId, WorkspaceRegistry};
use serde::Serialize;
use std::{
    ffi::CStr,
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd, IntoRawFd},
    path::Path,
};
use tauri::State;

pub const WORKSPACE_DIRECTORY_ENTRY_LIMIT: usize = 50_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedDirectoryEntries {
    pub entries: Vec<DescriptorFileEntry>,
    pub truncated: bool,
}

pub fn read_directory_bounded(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    path: &Path,
    max_entries: usize,
) -> io::Result<BoundedDirectoryEntries> {
    if max_entries == 0 || max_entries > WORKSPACE_DIRECTORY_ENTRY_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("max_entries must be between 1 and {WORKSPACE_DIRECTORY_ENTRY_LIMIT}"),
        ));
    }
    if !path.as_os_str().is_empty() {
        validate_relative_path(path)?;
    }
    let directory = if path.as_os_str().is_empty() {
        reopen_directory(&registry.clone_root(id)?)?
    } else {
        registry.open_descendant(id, path)?
    };
    let (mut entries, truncated) = enumerate(&directory, max_entries)?;
    entries.sort_by(|left, right| {
        rank(&left.kind)
            .cmp(&rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(BoundedDirectoryEntries { entries, truncated })
}

fn reopen_directory(directory: &File) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}

fn enumerate(directory: &File, max_entries: usize) -> io::Result<(Vec<DescriptorFileEntry>, bool)> {
    let stream = unsafe { libc::fdopendir(directory.try_clone()?.into_raw_fd()) };
    if stream.is_null() {
        return Err(io::Error::last_os_error());
    }
    let stream = DirectoryStream(stream);
    let mut entries = Vec::with_capacity(max_entries.min(256));
    loop {
        clear_errno();
        let raw = unsafe { libc::readdir(stream.0) };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(0) {
                Ok((entries, false))
            } else {
                Err(error)
            };
        }
        let name = unsafe { CStr::from_ptr((*raw).d_name.as_ptr()) };
        if matches!(name.to_bytes(), b"." | b".." | b".git") {
            continue;
        }
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe {
            libc::fstatat(
                directory.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        let kind = unsafe { stat.assume_init() }.st_mode & libc::S_IFMT;
        let kind = match kind {
            libc::S_IFDIR => FileEntryKind::Directory,
            libc::S_IFREG => FileEntryKind::File,
            _ => continue,
        };
        if entries.len() == max_entries {
            return Ok((entries, true));
        }
        let name = String::from_utf8_lossy(name.to_bytes()).into_owned();
        entries.push(DescriptorFileEntry {
            relative_path: name.clone(),
            name,
            kind,
        });
    }
}

struct DirectoryStream(*mut libc::DIR);

impl Drop for DirectoryStream {
    fn drop(&mut self) {
        unsafe { libc::closedir(self.0) };
    }
}

#[cfg(target_os = "macos")]
fn clear_errno() {
    unsafe { *libc::__error() = 0 };
}

#[cfg(target_os = "linux")]
fn clear_errno() {
    unsafe { *libc::__errno_location() = 0 };
}

fn rank(kind: &FileEntryKind) -> u8 {
    match kind {
        FileEntryKind::Directory => 0,
        FileEntryKind::File => 1,
    }
}

#[tauri::command]
pub(crate) fn workspace_read_directory_bounded(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    max_entries: usize,
) -> Result<BoundedDirectoryEntries, String> {
    read_directory_bounded(
        &registry,
        &workspace_id,
        Path::new(&relative_path),
        max_entries,
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn enforces_cap_and_reports_truncation() {
        let root =
            std::env::temp_dir().join(format!("mockor-bounded-directory-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for name in ["one.php", "two.php", "three.php"] {
            fs::write(root.join(name), name).unwrap();
        }
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;

        let bounded = read_directory_bounded(&registry, &id, Path::new(""), 2).unwrap();
        assert_eq!(bounded.entries.len(), 2);
        assert!(bounded.truncated);
        let complete = read_directory_bounded(&registry, &id, Path::new(""), 3).unwrap();
        assert_eq!(complete.entries.len(), 3);
        assert!(!complete.truncated);
        assert!(read_directory_bounded(&registry, &id, Path::new(""), 0).is_err());
        assert!(read_directory_bounded(
            &registry,
            &id,
            Path::new(""),
            WORKSPACE_DIRECTORY_ENTRY_LIMIT + 1,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
