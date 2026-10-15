use crate::workspace_registry::{open_file_relative_to, validate_relative_path};
use serde::Serialize;
use std::{
    fs::{File, OpenOptions},
    io::{self, Read},
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::Path,
};

pub(crate) const FILE_PREVIEW_MAX_BYTES: usize = 1024 * 1024;
const FILE_PREVIEW_BINARY_SNIFF_BYTES: usize = 8 * 1024;
const FILE_PREVIEW_READ_ATTEMPTS: usize = 3;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WorkspaceFilePreview {
    #[serde(rename_all = "camelCase")]
    Text {
        relative_path: String,
        contents: String,
        byte_length: u64,
        truncated: bool,
    },
    #[serde(rename_all = "camelCase")]
    Binary {
        relative_path: String,
        byte_length: u64,
    },
}

pub(crate) fn resolve_preview_root(
    registered: io::Result<File>,
    workspace_root: &Path,
) -> io::Result<File> {
    match registered {
        Ok(root) => Ok(root),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            open_unregistered_root(workspace_root)
        }
        Err(error) => Err(error),
    }
}

fn open_unregistered_root(workspace_root: &Path) -> io::Result<File> {
    if !workspace_root.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root must be absolute",
        ));
    }
    let root = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open(workspace_root)?;
    if !root.metadata()?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root is not a directory",
        ));
    }
    Ok(root)
}

pub(crate) fn read_file_preview_from_root(
    root: &File,
    relative_path: &str,
) -> io::Result<WorkspaceFilePreview> {
    let path = Path::new(relative_path);
    validate_relative_path(path)?;
    for _ in 0..FILE_PREVIEW_READ_ATTEMPTS {
        let mut file = open_file_relative_to(root, path)?;
        let before = single_link_regular_stat(&file)?;
        let byte_length = u64::try_from(before.st_size).unwrap_or(0);
        let capacity = usize::try_from(byte_length)
            .unwrap_or(usize::MAX)
            .min(FILE_PREVIEW_MAX_BYTES + 1);
        let mut bytes = Vec::with_capacity(capacity);
        (&mut file)
            .take(FILE_PREVIEW_MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        let after = single_link_regular_stat(&file)?;
        let truncated = byte_length > FILE_PREVIEW_MAX_BYTES as u64;
        let consistent_length = if truncated {
            bytes.len() > FILE_PREVIEW_MAX_BYTES
        } else {
            bytes.len() as u64 == byte_length
        };
        if same_snapshot(&before, &after) && consistent_length {
            return Ok(classify_preview(
                relative_path.to_owned(),
                bytes,
                byte_length,
                truncated,
            ));
        }
    }
    Err(io::Error::new(
        io::ErrorKind::WouldBlock,
        "file changed repeatedly while it was being read",
    ))
}

pub(crate) fn classify_preview(
    relative_path: String,
    mut bytes: Vec<u8>,
    byte_length: u64,
    truncated: bool,
) -> WorkspaceFilePreview {
    bytes.truncate(FILE_PREVIEW_MAX_BYTES);
    let sniff_end = bytes.len().min(FILE_PREVIEW_BINARY_SNIFF_BYTES);
    if bytes[..sniff_end].contains(&0) {
        return WorkspaceFilePreview::Binary {
            relative_path,
            byte_length,
        };
    }
    let contents = match String::from_utf8(bytes) {
        Ok(contents) => contents,
        Err(error) => {
            let utf8 = error.utf8_error();
            if !truncated || utf8.error_len().is_some() {
                return WorkspaceFilePreview::Binary {
                    relative_path,
                    byte_length,
                };
            }
            let mut bytes = error.into_bytes();
            bytes.truncate(utf8.valid_up_to());
            match String::from_utf8(bytes) {
                Ok(contents) => contents,
                Err(_) => {
                    return WorkspaceFilePreview::Binary {
                        relative_path,
                        byte_length,
                    }
                }
            }
        }
    };
    WorkspaceFilePreview::Text {
        relative_path,
        contents,
        byte_length,
        truncated,
    }
}

fn single_link_regular_stat(file: &File) -> io::Result<libc::stat> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(file.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let stat = unsafe { stat.assume_init() };
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
    Ok(stat)
}

fn same_snapshot(a: &libc::stat, b: &libc::stat) -> bool {
    a.st_dev == b.st_dev
        && a.st_ino == b.st_ino
        && a.st_size == b.st_size
        && a.st_mtime == b.st_mtime
        && a.st_mtime_nsec == b.st_mtime_nsec
}

#[cfg(test)]
#[path = "workspace_file_preview_tests.rs"]
mod tests;
