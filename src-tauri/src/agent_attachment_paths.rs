use crate::git_worktree::safe_agent_task_id;
use std::path::{Component, Path, PathBuf};

pub const AGENT_ATTACHMENT_STORE_DIR_NAME: &str = "agent-attachments";
pub const AGENT_ATTACHMENT_THREADS_DIR_NAME: &str = "threads";

pub const AGENT_ATTACHMENT_CONTAINMENT_ERROR: &str =
    "The agent attachment path escapes the attachment store root.";

pub fn agent_attachment_root(base_dir: &Path) -> PathBuf {
    base_dir.join(AGENT_ATTACHMENT_STORE_DIR_NAME)
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
    let Ok(canonical_root) = root.canonicalize() else {
        return Ok(());
    };
    let Ok(canonical) = normalized.canonicalize() else {
        return Ok(());
    };
    if canonical == canonical_root || !canonical.starts_with(&canonical_root) {
        return Err(AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string());
    }
    Ok(())
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
