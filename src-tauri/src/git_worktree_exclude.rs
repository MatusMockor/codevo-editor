use super::{
    read_bounded_stream, run_worktree_command, worktree_lock_owner_token,
    AgentWorktreeCreationLock, MAX_WORKTREE_PATH_BYTES, WORKTREE_LOCK_CONFLICT_ERROR,
};
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

pub(super) const WORKTREE_EXCLUDE_PATTERN: &[u8] = b"/.worktrees/";
const WORKTREE_EXCLUDE_LOCK_NAME: &str = ".codevo-worktree-exclude.lock";
pub(super) const MAX_GIT_INFO_EXCLUDE_BYTES: usize = 1024 * 1024;
const EXCLUDE_LOCK_ATTEMPTS: usize = 50;
const EXCLUDE_LOCK_RETRY_MILLIS: u64 = 10;

pub(super) fn ensure_agent_worktree_excluded(repository_root: &Path) -> Result<(), String> {
    let exclude_path = resolved_git_info_exclude_path(repository_root)?;
    let info_directory = exclude_path
        .parent()
        .ok_or_else(|| "Git reported an invalid local exclude path.".to_string())?;
    let lock_path = info_directory.join(WORKTREE_EXCLUDE_LOCK_NAME);
    let _lock = acquire_exclude_lock(&lock_path)?;

    let (original, original_permissions, existed) = match exclude_path.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(
                "The local Git exclude file must be a regular non-symbolic-link file.".to_string(),
            );
        }
        Ok(metadata) => (
            read_bounded_file(&exclude_path, MAX_GIT_INFO_EXCLUDE_BYTES)?,
            Some(metadata.permissions()),
            true,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Vec::new(), None, false),
        Err(error) => {
            return Err(format!(
                "Failed to inspect the local Git exclude file: {error}"
            ))
        }
    };

    if contains_exclude_pattern(&original) {
        return Ok(());
    }

    let separator_bytes = usize::from(!original.is_empty() && !original.ends_with(b"\n"));
    let updated_bytes = original
        .len()
        .saturating_add(separator_bytes)
        .saturating_add(WORKTREE_EXCLUDE_PATTERN.len())
        .saturating_add(1);
    if updated_bytes > MAX_GIT_INFO_EXCLUDE_BYTES {
        return Err(format!(
            "The local Git exclude file cannot exceed {MAX_GIT_INFO_EXCLUDE_BYTES} bytes."
        ));
    }

    let mut updated = Vec::with_capacity(updated_bytes);
    updated.extend_from_slice(&original);
    if separator_bytes == 1 {
        updated.push(b'\n');
    }
    updated.extend_from_slice(WORKTREE_EXCLUDE_PATTERN);
    updated.push(b'\n');

    atomic_replace_exclude(
        &exclude_path,
        &original,
        original_permissions,
        existed,
        &updated,
    )
}

fn acquire_exclude_lock(lock_path: &Path) -> Result<AgentWorktreeCreationLock, String> {
    for attempt in 0..EXCLUDE_LOCK_ATTEMPTS {
        match AgentWorktreeCreationLock::acquire_path(lock_path.to_path_buf()) {
            Ok(lock) => return Ok(lock),
            Err(error)
                if error == WORKTREE_LOCK_CONFLICT_ERROR && attempt + 1 < EXCLUDE_LOCK_ATTEMPTS =>
            {
                thread::sleep(Duration::from_millis(EXCLUDE_LOCK_RETRY_MILLIS));
            }
            Err(error) => return Err(error),
        }
    }
    Err("The local Git exclude update lock could not be acquired.".to_string())
}

fn resolved_git_info_exclude_path(repository_root: &Path) -> Result<PathBuf, String> {
    let reported = run_worktree_command(
        repository_root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--git-path"),
            OsStr::new("info/exclude"),
        ],
    )?;
    let reported = reported.trim();
    if reported.is_empty() || reported.len() > MAX_WORKTREE_PATH_BYTES {
        return Err("Git reported an unusable local exclude path.".to_string());
    }
    let reported_path = PathBuf::from(reported);
    let candidate = if reported_path.is_absolute() {
        reported_path
    } else {
        repository_root.join(reported_path)
    };
    let parent = candidate
        .parent()
        .ok_or_else(|| "Git reported an invalid local exclude path.".to_string())?;
    let parent_metadata = parent
        .symlink_metadata()
        .map_err(|error| format!("Failed to inspect the local Git info directory: {error}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(
            "The local Git info path must be a regular non-symbolic-link directory.".to_string(),
        );
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve the local Git info directory: {error}"))?;
    Ok(canonical_parent.join("exclude"))
}

pub(super) fn contains_exclude_pattern(content: &[u8]) -> bool {
    content.split(|byte| *byte == b'\n').any(|line| {
        line.strip_suffix(b"\r")
            .unwrap_or(line)
            .eq(WORKTREE_EXCLUDE_PATTERN)
    })
}

fn atomic_replace_exclude(
    exclude_path: &Path,
    original: &[u8],
    original_permissions: Option<fs::Permissions>,
    existed: bool,
    updated: &[u8],
) -> Result<(), String> {
    let parent = exclude_path
        .parent()
        .ok_or_else(|| "Git reported an invalid local exclude path.".to_string())?;
    let token = worktree_lock_owner_token();
    let temporary_path = parent.join(format!(".exclude.codevo-{token}.tmp"));
    let result = (|| {
        let mut temporary_options = OpenOptions::new();
        temporary_options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            temporary_options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        }
        let mut temporary = temporary_options
            .open(&temporary_path)
            .map_err(|error| format!("Failed to create the local Git exclude update: {error}"))?;
        temporary
            .write_all(updated)
            .map_err(|error| format!("Failed to write the local Git exclude update: {error}"))?;
        if let Some(permissions) = original_permissions {
            temporary.set_permissions(permissions).map_err(|error| {
                format!("Failed to preserve local Git exclude permissions: {error}")
            })?;
        }
        temporary
            .sync_all()
            .map_err(|error| format!("Failed to sync the local Git exclude update: {error}"))?;
        drop(temporary);

        let unchanged = if existed {
            read_bounded_file(exclude_path, MAX_GIT_INFO_EXCLUDE_BYTES)? == original
        } else {
            exclude_path
                .symlink_metadata()
                .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        };
        if !unchanged {
            return Err(
                "The local Git exclude file changed while it was being updated.".to_string(),
            );
        }
        fs::rename(&temporary_path, exclude_path)
            .map_err(|error| format!("Failed to install the local Git exclude update: {error}"))?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn read_bounded_file(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("Failed to read the local Git exclude file: {error}"))?;
    read_bounded_stream(file, limit)
        .map_err(|error| format!("Failed to read the local Git exclude file: {error}"))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Failed to sync the local Git info directory: {error}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}
