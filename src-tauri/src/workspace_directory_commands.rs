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
use tauri::{AppHandle, Manager};

#[path = "workspace_directory_commands/admission.rs"]
mod admission;

use admission::reserve_directory_read;

pub const WORKSPACE_DIRECTORY_ENTRY_LIMIT: usize = 50_000;
pub const WORKSPACE_DIRECTORY_NAME_BYTE_LIMIT: usize = 1_024;
pub const WORKSPACE_DIRECTORY_RELATIVE_PATH_BYTE_LIMIT: usize = 32_768;
pub const WORKSPACE_DIRECTORY_TOTAL_BYTE_LIMIT: usize = 4 * 1024 * 1024;
pub const WORKSPACE_DIRECTORY_WORKSPACE_ID_BYTE_LIMIT: usize = 1_024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedDirectoryEntries {
    pub entries: Vec<DescriptorFileEntry>,
    pub truncated: bool,
}

#[cfg(test)]
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
        registry.open_directory_descendant(id, path)?
    };
    read_open_directory_bounded(directory, max_entries)
}

fn read_open_directory_bounded(
    directory: File,
    max_entries: usize,
) -> io::Result<BoundedDirectoryEntries> {
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
    let mut total_bytes = 0_usize;
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
        if name.to_bytes().len() > WORKSPACE_DIRECTORY_NAME_BYTE_LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "workspace directory entry name exceeds byte limit",
            ));
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
        if name.len() > WORKSPACE_DIRECTORY_NAME_BYTE_LIMIT
            || name.len() > WORKSPACE_DIRECTORY_RELATIVE_PATH_BYTE_LIMIT
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "workspace directory entry projection exceeds byte limit",
            ));
        }
        let projected_bytes = name.len().saturating_mul(2);
        if total_bytes.saturating_add(projected_bytes) > WORKSPACE_DIRECTORY_TOTAL_BYTE_LIMIT {
            return Ok((entries, true));
        }
        total_bytes += projected_bytes;
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
pub(crate) async fn workspace_read_directory_bounded(
    app: AppHandle,
    workspace_id: WorkspaceId,
    relative_path: String,
    max_entries: usize,
) -> Result<BoundedDirectoryEntries, String> {
    if workspace_id.as_str().len() > WORKSPACE_DIRECTORY_WORKSPACE_ID_BYTE_LIMIT
        || relative_path.len() > WORKSPACE_DIRECTORY_RELATIVE_PATH_BYTE_LIMIT
    {
        return Err("Workspace directory request exceeds byte limits.".to_string());
    }
    if max_entries == 0 || max_entries > WORKSPACE_DIRECTORY_ENTRY_LIMIT {
        return Err(format!(
            "max_entries must be between 1 and {WORKSPACE_DIRECTORY_ENTRY_LIMIT}"
        ));
    }
    if !relative_path.is_empty() {
        validate_relative_path(Path::new(&relative_path)).map_err(|error| error.to_string())?;
    }
    let admission =
        reserve_directory_read(&workspace_id, &relative_path).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Keep admission until the physical read completes even if the awaiting IPC is cancelled.
        let _admission = admission;
        let registry = app.state::<WorkspaceRegistry>();
        let directory = if relative_path.is_empty() {
            reopen_directory(
                &registry
                    .clone_root(&workspace_id)
                    .map_err(|error| error.to_string())?,
            )
        } else {
            registry.open_directory_descendant(&workspace_id, Path::new(&relative_path))
        }
        .map_err(|error| error.to_string())?;
        read_open_directory_bounded(directory, max_entries).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Workspace directory worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::symlink,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "mockor-bounded-directory-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn enforces_cap_and_reports_truncation() {
        let root = temp_root("root-cap");
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

    #[test]
    fn reads_nested_directory_and_sorts_directories_before_files() {
        let root = temp_root("nested-sorted");
        fs::create_dir_all(root.join("src/zeta")).unwrap();
        fs::create_dir(root.join("src/Alpha")).unwrap();
        fs::write(root.join("src/z.ts"), "z").unwrap();
        fs::write(root.join("src/A.ts"), "a").unwrap();
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;

        assert!(
            registry.open_descendant(&id, Path::new("src")).is_err(),
            "regular-file admission must continue rejecting directories"
        );
        let result = read_directory_bounded(&registry, &id, Path::new("src"), 10).unwrap();

        assert!(!result.truncated);
        assert_eq!(
            result
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["Alpha", "zeta", "A.ts", "z.ts"]
        );
        assert!(matches!(result.entries[0].kind, FileEntryKind::Directory));
        assert!(matches!(result.entries[2].kind, FileEntryKind::File));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_regular_file_when_directory_is_required() {
        let root = temp_root("file-as-directory");
        fs::write(root.join("src"), "not a directory").unwrap();
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;

        assert!(read_directory_bounded(&registry, &id, Path::new("src"), 10).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_leaf_intermediate_and_outside_directory_symlinks() {
        let root = temp_root("directory-symlinks");
        let outside = temp_root("directory-symlinks-outside");
        fs::create_dir_all(root.join("real/nested")).unwrap();
        fs::create_dir(outside.join("secret")).unwrap();
        symlink("real", root.join("intermediate")).unwrap();
        symlink("real/nested", root.join("leaf")).unwrap();
        symlink(outside.join("secret"), root.join("outside")).unwrap();
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;

        for path in ["intermediate/nested", "leaf", "outside"] {
            assert!(
                read_directory_bounded(&registry, &id, Path::new(path), 10).is_err(),
                "{path} must fail closed"
            );
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn nested_directory_read_stays_bound_to_registered_root_identity() {
        let root = temp_root("retained-root");
        let displaced = root.with_extension("displaced");
        let replacement = root.with_extension("replacement");
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/original.ts"), "original").unwrap();
        fs::create_dir_all(replacement.join("src")).unwrap();
        fs::write(replacement.join("src/replacement.ts"), "replacement").unwrap();
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;
        fs::rename(&root, &displaced).unwrap();
        fs::rename(&replacement, &root).unwrap();

        let result = read_directory_bounded(&registry, &id, Path::new("src"), 10).unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].name, "original.ts");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(displaced).unwrap();
    }

    #[test]
    fn nested_directory_enforces_cap_and_reports_truncation() {
        let root = temp_root("nested-cap");
        fs::create_dir(root.join("src")).unwrap();
        for name in ["one.ts", "two.ts", "three.ts"] {
            fs::write(root.join("src").join(name), name).unwrap();
        }
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&root).unwrap().workspace_id;

        let result = read_directory_bounded(&registry, &id, Path::new("src"), 2).unwrap();

        assert_eq!(result.entries.len(), 2);
        assert!(result.truncated);
        fs::remove_dir_all(root).unwrap();
    }
}
