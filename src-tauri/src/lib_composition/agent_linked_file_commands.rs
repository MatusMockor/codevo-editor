use super::agent_image_source_commands::same_file;
use super::agent_inline_image_commands::{ensure_stored_locally, INLINE_IMAGE_REMOTE_VOLUME_ERROR};
use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::Path,
    sync::atomic::{AtomicUsize, Ordering},
};

pub(crate) const LINKED_FILE_PATH_ERROR: &str =
    "The linked file path must be an absolute local file path.";

pub(crate) const MAX_AGENT_LINKED_FILE_PATH_BYTES: usize = 4096;
pub(crate) const MAX_AGENT_LINKED_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_CONCURRENT_LINKED_FILE_READS: usize = 2;
static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);

struct ReadPermit;

impl ReadPermit {
    fn acquire() -> Option<Self> {
        ACTIVE_READS
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < MAX_CONCURRENT_LINKED_FILE_READS).then_some(value + 1)
            })
            .map(|_| Self)
            .ok()
    }
}

impl Drop for ReadPermit {
    fn drop(&mut self) {
        ACTIVE_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LinkedTextFileRequest {
    path: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum LinkedTextFile {
    #[serde(rename_all = "camelCase")]
    File {
        canonical_path: String,
        content: String,
    },
    DoesNotExist,
    Folder,
    SpecialFile,
    TooLarge,
    NotText,
    NotLocal,
    Unreadable,
    Unavailable,
    Busy,
}

#[tauri::command]
pub(crate) async fn read_agent_linked_text_file(
    request: LinkedTextFileRequest,
) -> Result<LinkedTextFile, String> {
    let Some(permit) = ReadPermit::acquire() else {
        return Ok(LinkedTextFile::Busy);
    };
    run_blocking_command(move || {
        let _permit = permit;
        read_linked_text_file(&request.path)
    })
    .await
}

fn read_linked_text_file(path: &str) -> Result<LinkedTextFile, String> {
    ensure_linked_file_path(path)?;
    Ok(read_canonical_text_file(path).unwrap_or_else(|refusal| refusal))
}

fn ensure_linked_file_path(path: &str) -> Result<(), String> {
    if !is_bounded_path(path) || !Path::new(path).is_absolute() {
        return Err(LINKED_FILE_PATH_ERROR.into());
    }
    Ok(())
}

fn is_bounded_path(path: &str) -> bool {
    path.len() <= MAX_AGENT_LINKED_FILE_PATH_BYTES && !path.chars().any(char::is_control)
}

fn read_canonical_text_file(path: &str) -> Result<LinkedTextFile, LinkedTextFile> {
    let canonical = fs::canonicalize(path).map_err(|error| unresolved(&error))?;
    let before = fs::symlink_metadata(&canonical).map_err(|error| unresolved(&error))?;
    if before.file_type().is_dir() {
        return Err(LinkedTextFile::Folder);
    }
    if !before.file_type().is_file() {
        return Err(LinkedTextFile::SpecialFile);
    }
    if before.len() > MAX_AGENT_LINKED_FILE_BYTES {
        return Err(LinkedTextFile::TooLarge);
    }
    ensure_stored_locally(&canonical, &before).map_err(|reason| not_stored_locally(&reason))?;
    let canonical_path = canonical
        .to_str()
        .filter(|value| is_bounded_path(value))
        .ok_or(LinkedTextFile::Unavailable)?;
    let bytes = read_bound_bytes(&canonical, &before)?;
    let content = String::from_utf8(bytes).map_err(|_| LinkedTextFile::NotText)?;
    if content.contains('\0') {
        return Err(LinkedTextFile::NotText);
    }
    Ok(LinkedTextFile::File {
        canonical_path: canonical_path.to_string(),
        content,
    })
}

fn read_bound_bytes(canonical: &Path, before: &fs::Metadata) -> Result<Vec<u8>, LinkedTextFile> {
    let (mut file, opened) = open_bound_file(canonical, before)?;
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    (&mut file)
        .take(MAX_AGENT_LINKED_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| LinkedTextFile::Unreadable)?;
    let after = file.metadata().map_err(|_| LinkedTextFile::Unreadable)?;
    if bytes.len() as u64 != opened.len()
        || !same_file(&opened, &after)
        || opened.modified().ok() != after.modified().ok()
    {
        return Err(LinkedTextFile::Unreadable);
    }
    Ok(bytes)
}

fn open_bound_file(
    canonical: &Path,
    before: &fs::Metadata,
) -> Result<(File, fs::Metadata), LinkedTextFile> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(canonical)
        .map_err(|_| LinkedTextFile::Unreadable)?;
    let opened = file.metadata().map_err(|_| LinkedTextFile::Unreadable)?;
    if !opened.is_file() || !same_file(before, &opened) {
        return Err(LinkedTextFile::Unreadable);
    }
    Ok((file, opened))
}

fn unresolved(error: &io::Error) -> LinkedTextFile {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => LinkedTextFile::DoesNotExist,
        _ => LinkedTextFile::Unavailable,
    }
}

fn not_stored_locally(reason: &str) -> LinkedTextFile {
    if reason == INLINE_IMAGE_REMOTE_VOLUME_ERROR {
        return LinkedTextFile::NotLocal;
    }
    LinkedTextFile::Unavailable
}

#[cfg(test)]
#[path = "agent_linked_file_commands_tests.rs"]
mod tests;
