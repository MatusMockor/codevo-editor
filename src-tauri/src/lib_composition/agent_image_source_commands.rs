use super::agent_attachment_commands::agent_attachment_store::agent_attachment_image::{
    agent_image_mime_for_extension, matches_agent_image_signature,
};
use crate::run_blocking_command;
use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::Read,
    path::Path,
    sync::atomic::{AtomicUsize, Ordering},
};

const MAX_SOURCE_BYTES: u64 = 50 * 1024 * 1024;
static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);
struct ReadPermit;
impl ReadPermit {
    fn acquire() -> Result<Self, String> {
        ACTIVE_READS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < 2).then_some(value + 1)
            })
            .map(|_| Self)
            .map_err(|_| "Another image is being read. Try again shortly.".to_string())
    }
}
impl Drop for ReadPermit {
    fn drop(&mut self) {
        ACTIVE_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ImageSourceRequest {
    path: String,
}

// An explicit local picker/drop source, independent of the destination workspace.
// Upload ownership is checked by the caller before these bytes can leave the device.
#[tauri::command]
pub(crate) async fn read_agent_attachment_image_source(
    request: ImageSourceRequest,
) -> Result<tauri::ipc::Response, String> {
    let permit = ReadPermit::acquire()?;
    run_blocking_command(move || {
        let _permit = permit;
        read_image_source(&request.path)
    })
    .await
    .map(tauri::ipc::Response::new)
}

fn read_image_source(path: &str) -> Result<Vec<u8>, String> {
    if path.len() > 4096 || path.chars().any(char::is_control) || !Path::new(path).is_absolute() {
        return Err("Choose an image using an absolute local file path.".into());
    }
    let path = Path::new(path);
    let mime = path
        .extension()
        .and_then(|value| value.to_str())
        .and_then(|value| agent_image_mime_for_extension(&value.to_ascii_lowercase()))
        .ok_or("Choose a PNG, JPEG, GIF or WebP image.")?;
    let before = fs::symlink_metadata(path).map_err(|_| "The image could not be read.")?;
    if !before.file_type().is_file() {
        return Err("Choose a regular image file, not a folder or symbolic link.".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "The image could not be read.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "The image could not be read.")?;
    if !metadata.is_file() || !same_file(&before, &metadata) {
        return Err("The selected image changed. Select it again.".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_SOURCE_BYTES {
        return Err("Choose a nonempty image no larger than 50 MB.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut file)
        .take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The image could not be read.")?;
    let after = file
        .metadata()
        .map_err(|_| "The image could not be read.")?;
    if bytes.len() as u64 != metadata.len()
        || !same_file(&metadata, &after)
        || metadata.modified().ok() != after.modified().ok()
    {
        return Err("The selected image changed. Select it again.".into());
    }
    if !matches_agent_image_signature(mime, &bytes) {
        return Err("The file does not contain the selected image format.".into());
    }
    Ok(bytes)
}

fn same_file(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        left.dev() == right.dev() && left.ino() == right.ino() && left.len() == right.len()
    }
    #[cfg(not(unix))]
    {
        left.len() == right.len() && left.modified().ok() == right.modified().ok()
    }
}

#[cfg(test)]
#[path = "agent_image_source_commands_tests.rs"]
mod tests;
