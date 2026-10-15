use super::{fstat, open_regular_at};
use crate::workspace::FileEntryKind;
use ignore::gitignore::GitignoreBuilder;
use std::{
    fs::File,
    io::{self, Read},
    os::fd::AsRawFd,
    path::Path,
};

const WORKSPACE_GITIGNORE_BYTE_LIMIT: u64 = 1024 * 1024;

pub(super) fn load_directory_gitignore(
    directory: &File,
    display_directory: &Path,
) -> io::Result<Option<(ignore::gitignore::Gitignore, libc::stat)>> {
    let file = match open_regular_at(directory.as_raw_fd(), c".gitignore", libc::O_RDONLY) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let stamp = fstat(file.as_raw_fd())?;
    let mut bytes = Vec::new();
    file.take(WORKSPACE_GITIGNORE_BYTE_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > WORKSPACE_GITIGNORE_BYTE_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            ".gitignore exceeds the 1 MiB workspace-search limit",
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut builder = GitignoreBuilder::new(display_directory);
    for line in content.lines() {
        builder.add_line(None, line).map_err(io::Error::other)?;
    }
    builder
        .build()
        .map(|matcher| Some((matcher, stamp)))
        .map_err(io::Error::other)
}

pub(super) fn entry_rank(kind: &FileEntryKind) -> u8 {
    if matches!(kind, FileEntryKind::Directory) {
        0
    } else {
        1
    }
}
