use super::agent_attachment_commands::{
    agent_attachment_store::{
        agent_attachment_image::{
            agent_image_mime_for_extension, matches_agent_image_signature, verify_agent_image_bytes,
        },
        AgentAttachmentOwner, AgentAttachmentStore,
    },
    agent_thread_store::{AgentImageMime, MAX_AGENT_ATTACHMENT_PATH_BYTES, MAX_AGENT_IMAGE_BYTES},
    resolve_agent_attachment_owner_with,
};
use super::agent_image_source_commands::same_file;
use super::agent_task_commands::agent_root_lease::AgentRootLeaseRegistry;
use crate::git_worktree::safe_agent_task_id;
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use serde::Deserialize;
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager};

pub(crate) const INLINE_IMAGE_BUSY_ERROR: &str = "Another image is being read. Try again shortly.";
pub(crate) const INLINE_IMAGE_PATH_ERROR: &str =
    "The image path must be an absolute local file path.";
pub(crate) const INLINE_IMAGE_OWNER_ERROR: &str =
    "This conversation is not available in the current workspace.";
pub(crate) const INLINE_IMAGE_UNAVAILABLE_ERROR: &str = "The image could not be read.";
pub(crate) const INLINE_IMAGE_NOT_REGULAR_FILE_ERROR: &str =
    "The image path does not point to a regular file.";
pub(crate) const INLINE_IMAGE_TYPE_ERROR: &str =
    "Only PNG, JPEG, GIF and WebP images can be shown.";
pub(crate) const INLINE_IMAGE_SIZE_ERROR: &str = "The image is empty or larger than 10 MB.";
pub(crate) const INLINE_IMAGE_CHANGED_ERROR: &str =
    "The image changed while it was being read. Try again.";
pub(crate) const INLINE_IMAGE_CONTENT_ERROR: &str =
    "The file does not contain the image format its name declares.";
pub(crate) const INLINE_IMAGE_DIMENSIONS_ERROR: &str =
    "The image is damaged or its dimensions are not supported.";
pub(crate) const INLINE_IMAGE_PIXELS_ERROR: &str = "The image is larger than 32 megapixels.";
pub(crate) const INLINE_IMAGE_REMOTE_VOLUME_ERROR: &str =
    "Images on network or offloaded volumes are not shown.";

const MAX_INLINE_IMAGE_PIXELS: u64 = 32_000_000;
#[cfg(target_os = "macos")]
const SF_DATALESS: u32 = 0x4000_0000;
const MAX_CONCURRENT_INLINE_IMAGE_READS: usize = 2;
static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);

struct ReadPermit;

impl ReadPermit {
    fn acquire() -> Result<Self, String> {
        ACTIVE_READS
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < MAX_CONCURRENT_INLINE_IMAGE_READS).then_some(value + 1)
            })
            .map(|_| Self)
            .map_err(|_| INLINE_IMAGE_BUSY_ERROR.to_string())
    }
}

impl Drop for ReadPermit {
    fn drop(&mut self) {
        ACTIVE_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InlineImageRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    path: String,
}

struct InlineImageAuthority<'a> {
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    leases: &'a AgentRootLeaseRegistry,
    attachments: &'a AgentAttachmentStore,
}

impl<'a> InlineImageAuthority<'a> {
    fn from_app<R: tauri::Runtime>(app: &'a AppHandle<R>) -> Self {
        Self {
            registry: app.state::<WorkspaceRegistry>().inner(),
            trust: app.state::<Mutex<WorkspaceTrustService>>().inner(),
            leases: app.state::<Arc<AgentRootLeaseRegistry>>().inner().as_ref(),
            attachments: app.state::<Arc<AgentAttachmentStore>>().inner().as_ref(),
        }
    }

    fn owning_workspace(
        &self,
        workspace_id: &WorkspaceId,
        thread_id: &str,
    ) -> Result<WorkspaceId, String> {
        let thread_id = safe_agent_task_id(thread_id).map_err(|_| INLINE_IMAGE_OWNER_ERROR)?;
        let resolved = resolve_agent_attachment_owner_with(
            self.registry,
            self.trust,
            self.leases,
            workspace_id,
        )?;
        self.attachments
            .ensure_thread_belongs_to_owner(&AgentAttachmentOwner {
                workspace_id: resolved.workspace_id.as_str(),
                thread_id: &thread_id,
                root_keys: &resolved.root_keys,
            })
            .map_err(|_| INLINE_IMAGE_OWNER_ERROR)?;
        Ok(resolved.workspace_id)
    }
}

#[tauri::command]
pub(crate) async fn read_agent_inline_image<R: tauri::Runtime>(
    app: AppHandle<R>,
    request: InlineImageRequest,
) -> Result<tauri::ipc::Response, String> {
    let permit = ReadPermit::acquire()?;
    run_blocking_command(move || {
        let _permit = permit;
        let authority = InlineImageAuthority::from_app(&app);
        read_inline_image(&request.path, || {
            authority.owning_workspace(&request.workspace_id, &request.thread_id)
        })
    })
    .await
    .map(tauri::ipc::Response::new)
}

fn read_inline_image(
    path: &str,
    owning_workspace: impl Fn() -> Result<WorkspaceId, String>,
) -> Result<Vec<u8>, String> {
    ensure_inline_image_path(path)?;
    let owner = owning_workspace()?;
    let bytes = read_canonical_image(path)?;
    if owning_workspace()? != owner {
        return Err(INLINE_IMAGE_OWNER_ERROR.into());
    }
    Ok(bytes)
}

fn ensure_inline_image_path(path: &str) -> Result<(), String> {
    if path.len() > MAX_AGENT_ATTACHMENT_PATH_BYTES
        || path.chars().any(char::is_control)
        || !Path::new(path).is_absolute()
    {
        return Err(INLINE_IMAGE_PATH_ERROR.into());
    }
    Ok(())
}

fn read_canonical_image(path: &str) -> Result<Vec<u8>, String> {
    let canonical = fs::canonicalize(path).map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    let before = fs::symlink_metadata(&canonical).map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    if !before.file_type().is_file() {
        return Err(INLINE_IMAGE_NOT_REGULAR_FILE_ERROR.into());
    }
    let mime = canonical
        .extension()
        .and_then(|value| value.to_str())
        .and_then(|value| agent_image_mime_for_extension(&value.to_ascii_lowercase()))
        .ok_or(INLINE_IMAGE_TYPE_ERROR)?;
    ensure_stored_locally(&canonical, &before)?;
    let (file, opened) = open_bound_image(&canonical, &before)?;
    let bytes = read_stable_bytes(file, &opened)?;
    ensure_image_content(mime, &bytes)?;
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn ensure_stored_locally(canonical: &Path, before: &fs::Metadata) -> Result<(), String> {
    use std::os::macos::fs::MetadataExt;
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(canonical.as_os_str().as_bytes())
        .map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    let mut mount = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(path.as_ptr(), mount.as_mut_ptr()) } != 0 {
        return Err(INLINE_IMAGE_UNAVAILABLE_ERROR.into());
    }
    let mount = unsafe { mount.assume_init() };
    if !is_stored_locally(mount.f_flags, before.st_flags()) {
        return Err(INLINE_IMAGE_REMOTE_VOLUME_ERROR.into());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn ensure_stored_locally(_: &Path, _: &fs::Metadata) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn is_stored_locally(mount_flags: u32, file_flags: u32) -> bool {
    mount_flags & libc::MNT_LOCAL as u32 != 0 && file_flags & SF_DATALESS == 0
}

fn open_bound_image(
    canonical: &Path,
    before: &fs::Metadata,
) -> Result<(File, fs::Metadata), String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(canonical)
        .map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    let opened = file
        .metadata()
        .map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    if !opened.is_file() || !same_file(before, &opened) {
        return Err(INLINE_IMAGE_CHANGED_ERROR.into());
    }
    if opened.len() == 0 || opened.len() > MAX_AGENT_IMAGE_BYTES {
        return Err(INLINE_IMAGE_SIZE_ERROR.into());
    }
    Ok((file, opened))
}

fn read_stable_bytes(mut file: File, opened: &fs::Metadata) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    (&mut file)
        .take(MAX_AGENT_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    let after = file
        .metadata()
        .map_err(|_| INLINE_IMAGE_UNAVAILABLE_ERROR)?;
    if bytes.len() as u64 != opened.len()
        || !same_file(opened, &after)
        || opened.modified().ok() != after.modified().ok()
    {
        return Err(INLINE_IMAGE_CHANGED_ERROR.into());
    }
    Ok(bytes)
}

fn ensure_image_content(mime: AgentImageMime, bytes: &[u8]) -> Result<(), String> {
    if !matches_agent_image_signature(mime, bytes) {
        return Err(INLINE_IMAGE_CONTENT_ERROR.into());
    }
    let dimensions =
        verify_agent_image_bytes(mime, bytes).map_err(|_| INLINE_IMAGE_DIMENSIONS_ERROR)?;
    if u64::from(dimensions.width) * u64::from(dimensions.height) > MAX_INLINE_IMAGE_PIXELS {
        return Err(INLINE_IMAGE_PIXELS_ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "agent_inline_image_commands_tests.rs"]
mod tests;
