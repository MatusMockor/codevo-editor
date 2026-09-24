use crate::ignore_matcher::is_default_ignored_name;
use crate::workspace::protected_paths::ProtectedPathPolicy;
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
    detect_git_repositories_with_protected_paths(root, max_depth, ProtectedPathPolicy::current())
}

pub(crate) fn detect_git_repositories_with_protected_paths(
    root: &Path,
    max_depth: usize,
    protected_paths: &ProtectedPathPolicy,
) -> io::Result<Vec<String>> {
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

    let walk = GitRepositoryWalk {
        max_depth,
        protected_paths,
        root,
    };
    walk.visit(root, 0, &mut discovered);
    discovered.sort();

    Ok(discovered)
}

struct GitRepositoryWalk<'a> {
    max_depth: usize,
    protected_paths: &'a ProtectedPathPolicy,
    root: &'a Path,
}

impl GitRepositoryWalk<'_> {
    fn visit(&self, directory: &Path, depth: usize, discovered: &mut Vec<String>) {
        if depth >= self.max_depth {
            return;
        }

        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };

            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }

            let name = entry.file_name();
            let name = name.to_string_lossy();

            if is_discovery_skipped_directory(directory, &name) {
                continue;
            }

            if self.protected_paths.is_protected_directory(&path) {
                continue;
            }

            if has_git_marker(&path) {
                if let Ok(relative) = path.strip_prefix(self.root) {
                    discovered.push(relative.to_string_lossy().to_string());
                }
            }

            self.visit(&path, depth + 1, discovered);
        }
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::detect_git_repositories_with_protected_paths;
    use crate::workspace::protected_paths::ProtectedPathPolicy;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_home(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("codevo-git-discovery-{label}-{suffix}"));
        fs::create_dir_all(&home).expect("temp home");
        home.canonicalize().expect("canonical home")
    }

    #[test]
    fn home_root_discovery_skips_privacy_protected_children() {
        let home = temp_home("home");
        fs::create_dir_all(home.join("Music/band/.git")).expect("protected repository");
        fs::create_dir_all(home.join("code/app/.git")).expect("regular repository");
        let policy = ProtectedPathPolicy::for_home(Some(&home));

        let repositories =
            detect_git_repositories_with_protected_paths(&home, 4, &policy).expect("discovery");

        assert_eq!(repositories, vec!["code/app".to_string()]);
    }

    #[test]
    fn discovery_rooted_at_a_protected_home_child_finds_nested_repositories() {
        let home = temp_home("documents");
        let documents = home.join("Documents");
        fs::create_dir_all(documents.join("Music/app/.git")).expect("nested repository");
        let policy = ProtectedPathPolicy::for_home(Some(&home));

        let repositories = detect_git_repositories_with_protected_paths(&documents, 4, &policy)
            .expect("discovery");

        assert_eq!(repositories, vec!["Music/app".to_string()]);
    }
}
