use crate::git_worktree::safe_agent_task_id;
use std::path::{Component, Path, PathBuf};

pub const AGENT_ATTACHMENT_STORE_DIR_NAME: &str = "agent-attachments";
pub const AGENT_ATTACHMENT_THREADS_DIR_NAME: &str = "threads";
pub const AGENT_ATTACHMENT_PENDING_DIR_NAME: &str = "pending";
pub const AGENT_ATTACHMENT_PART_EXTENSION: &str = "part";
pub const AGENT_ATTACHMENT_ID_PATTERN_LENGTH: usize = 32;
pub const MAX_AGENT_ATTACHMENT_EXTENSION_BYTES: usize = 10;

pub const AGENT_ATTACHMENT_CONTAINMENT_ERROR: &str =
    "The agent attachment path escapes the attachment store root.";
pub const AGENT_ATTACHMENT_FILE_ID_ERROR: &str =
    "Agent attachment ids must be 32 lowercase hexadecimal characters.";
pub const AGENT_ATTACHMENT_EXTENSION_ERROR: &str =
    "Agent attachment file extensions must be 1 to 10 lowercase alphanumeric characters.";

pub fn agent_attachment_root(base_dir: &Path) -> PathBuf {
    base_dir.join(AGENT_ATTACHMENT_STORE_DIR_NAME)
}

pub fn ensure_agent_attachment_file_id(candidate: &str) -> Result<&str, String> {
    if candidate.len() != AGENT_ATTACHMENT_ID_PATTERN_LENGTH
        || !candidate
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AGENT_ATTACHMENT_FILE_ID_ERROR.to_string());
    }
    Ok(candidate)
}

pub fn ensure_agent_attachment_extension(candidate: &str) -> Result<&str, String> {
    if candidate.is_empty()
        || candidate.len() > MAX_AGENT_ATTACHMENT_EXTENSION_BYTES
        || candidate == AGENT_ATTACHMENT_PART_EXTENSION
        || !candidate
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte.is_ascii_lowercase())
    {
        return Err(AGENT_ATTACHMENT_EXTENSION_ERROR.to_string());
    }
    Ok(candidate)
}

pub fn agent_attachment_pending_directory(base_dir: &Path) -> Result<PathBuf, String> {
    let candidate = agent_attachment_root(base_dir).join(AGENT_ATTACHMENT_PENDING_DIR_NAME);
    ensure_within_agent_attachment_root(base_dir, &candidate)?;
    Ok(candidate)
}

pub fn agent_attachment_pending_file(
    base_dir: &Path,
    attachment_id: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let attachment_id = ensure_agent_attachment_file_id(attachment_id)?;
    let extension = ensure_agent_attachment_extension(extension)?;
    let candidate =
        agent_attachment_pending_directory(base_dir)?.join(format!("{attachment_id}.{extension}"));
    ensure_within_agent_attachment_root(base_dir, &candidate)?;
    Ok(candidate)
}

pub fn agent_attachment_pending_part_file(
    base_dir: &Path,
    attachment_id: &str,
) -> Result<PathBuf, String> {
    let attachment_id = ensure_agent_attachment_file_id(attachment_id)?;
    let candidate = agent_attachment_pending_directory(base_dir)?
        .join(format!("{attachment_id}.{AGENT_ATTACHMENT_PART_EXTENSION}"));
    ensure_within_agent_attachment_root(base_dir, &candidate)?;
    Ok(candidate)
}

pub fn agent_attachment_thread_file(
    base_dir: &Path,
    thread_id: &str,
    attachment_id: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let attachment_id = ensure_agent_attachment_file_id(attachment_id)?;
    let extension = ensure_agent_attachment_extension(extension)?;
    let candidate = agent_attachment_thread_directory(base_dir, thread_id)?
        .join(format!("{attachment_id}.{extension}"));
    ensure_within_agent_attachment_root(base_dir, &candidate)?;
    Ok(candidate)
}

pub fn agent_attachment_thread_directory(
    base_dir: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    let thread_id = safe_agent_task_id(thread_id)?;
    let candidate = agent_attachment_root(base_dir)
        .join(AGENT_ATTACHMENT_THREADS_DIR_NAME)
        .join(thread_id);
    ensure_within_agent_attachment_root(base_dir, &candidate)?;
    Ok(candidate)
}

pub fn ensure_within_agent_attachment_root(
    base_dir: &Path,
    candidate: &Path,
) -> Result<(), String> {
    let root = normalize_lexically(&agent_attachment_root(base_dir))
        .ok_or_else(|| AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string())?;
    let normalized = normalize_lexically(candidate)
        .ok_or_else(|| AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string())?;
    if normalized == root || !normalized.starts_with(&root) {
        return Err(AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string());
    }
    let canonical_root = resolve_existing_prefix(&root);
    let canonical = resolve_existing_prefix(&normalized);
    if canonical == canonical_root || !canonical.starts_with(&canonical_root) {
        return Err(AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string());
    }
    Ok(())
}

fn resolve_existing_prefix(path: &Path) -> PathBuf {
    let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
    let mut existing = path;
    loop {
        if let Ok(canonical) = existing.canonicalize() {
            let mut resolved = canonical;
            for segment in missing.iter().rev() {
                resolved.push(segment);
            }
            return resolved;
        }
        let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) else {
            return path.to_path_buf();
        };
        missing.push(name);
        existing = parent;
    }
}

fn normalize_lexically(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Some(normalized)
}
