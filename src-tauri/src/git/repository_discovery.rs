use crate::ignore_matcher::is_default_ignored_name;
use std::{fs, io, path::Path};

const ADDITIONAL_DISCOVERY_SKIPPED_NAMES: &[&str] =
    &["tmp", "temp", "log", "logs", "storage", "cache"];
const GIT_MARKER: &str = ".git";

/// Default bound for [`detect_git_repositories`]'s walk. Multi-repo
/// workspaces nest their repositories a handful of levels deep, so four
/// levels covers common layouts without an unbounded walk.
pub const DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH: usize = 4;

/// Finds every git repository nested inside `root`, returning root-relative,
/// sorted paths. `root` itself is represented by an empty string when it is a
/// repository.
///
/// A repository is recognized by a `.git` directory or file. The bounded walk
/// skips ignored, symlinked, and repository-owned Codevo `.worktrees`
/// directories. A `.worktrees` directory in a plain non-repository workspace
/// remains discoverable.
pub fn detect_git_repositories(root: &Path, max_depth: usize) -> io::Result<Vec<String>> {
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Workspace root is not a directory.",
        ));
    }

    let mut discovered = Vec::new();

    if has_git_marker(root) {
        discovered.push(String::new());
    }

    walk_for_git_repositories(root, root, 0, max_depth, &mut discovered);
    discovered.sort();

    Ok(discovered)
}

fn walk_for_git_repositories(
    root: &Path,
    directory: &Path,
    depth: usize,
    max_depth: usize,
    discovered: &mut Vec<String>,
) {
    if depth >= max_depth {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }

        let name = entry.file_name();
        let name = name.to_string_lossy();

        if is_discovery_skipped_directory(directory, &name) {
            continue;
        }

        if has_git_marker(&path) {
            if let Ok(relative) = path.strip_prefix(root) {
                discovered.push(relative.to_string_lossy().to_string());
            }
        }

        walk_for_git_repositories(root, &path, depth + 1, max_depth, discovered);
    }
}

fn has_git_marker(directory: &Path) -> bool {
    fs::symlink_metadata(directory.join(GIT_MARKER)).is_ok()
}

fn is_discovery_skipped_directory(directory: &Path, name: &str) -> bool {
    if name == crate::git_worktree::WORKTREE_BASE_DIR_NAME && has_git_marker(directory) {
        return true;
    }

    is_default_ignored_name(name) || ADDITIONAL_DISCOVERY_SKIPPED_NAMES.contains(&name)
}
