use ignore::{
    gitignore::{Gitignore, GitignoreBuilder},
    Match,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const DEFAULT_IGNORED_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
];

pub trait WorkspaceIgnoreMatcher {
    fn is_ignored(&self, path: &Path, is_directory: bool) -> bool;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIgnoreOptions {
    default_ignored_names: Vec<String>,
}

impl Default for WorkspaceIgnoreOptions {
    fn default() -> Self {
        Self::new(
            DEFAULT_IGNORED_NAMES
                .iter()
                .map(|name| name.to_string())
                .collect(),
        )
    }
}

impl WorkspaceIgnoreOptions {
    pub fn new(default_ignored_names: Vec<String>) -> Self {
        Self {
            default_ignored_names,
        }
    }

    pub fn ignores_name(&self, name: &str) -> bool {
        self.default_ignored_names
            .iter()
            .any(|ignored_name| ignored_name == name)
    }
}

pub struct GitignoreWorkspaceIgnoreMatcher {
    options: WorkspaceIgnoreOptions,
    root: PathBuf,
    scopes: Vec<GitignoreScope>,
}

struct GitignoreScope {
    gitignore: Gitignore,
    root: PathBuf,
}

impl GitignoreWorkspaceIgnoreMatcher {
    pub fn load(root: &Path) -> io::Result<Self> {
        Self::load_with_options(root, WorkspaceIgnoreOptions::default())
    }

    pub fn load_with_options(root: &Path, options: WorkspaceIgnoreOptions) -> io::Result<Self> {
        let root = root.canonicalize()?;
        let mut scopes = Vec::new();
        add_gitignore_scopes(&root, &options, &mut scopes)?;

        Ok(Self {
            options,
            root,
            scopes,
        })
    }
}

impl WorkspaceIgnoreMatcher for GitignoreWorkspaceIgnoreMatcher {
    fn is_ignored(&self, path: &Path, is_directory: bool) -> bool {
        let absolute = absolute_candidate(&self.root, path);
        let resolved = resolve_candidate_path(&absolute);
        let relative = match resolved.strip_prefix(&self.root) {
            Ok(relative) => relative,
            Err(_) => return true,
        };

        if has_default_ignored_component(relative, &self.options) {
            return true;
        }

        self.is_gitignored(&resolved, is_directory)
    }
}

impl GitignoreWorkspaceIgnoreMatcher {
    fn is_gitignored(&self, path: &Path, is_directory: bool) -> bool {
        matches_gitignore_scopes(&self.scopes, path, is_directory)
    }
}

pub fn is_default_ignored_name(name: &str) -> bool {
    DEFAULT_IGNORED_NAMES.contains(&name)
}

fn add_gitignore_scopes(
    directory: &Path,
    options: &WorkspaceIgnoreOptions,
    scopes: &mut Vec<GitignoreScope>,
) -> io::Result<()> {
    let gitignore_path = directory.join(".gitignore");

    if gitignore_path.is_file() {
        let mut builder = GitignoreBuilder::new(directory);

        if let Some(error) = builder.add(&gitignore_path) {
            return Err(to_io_error(error));
        }

        scopes.push(GitignoreScope {
            gitignore: builder.build().map_err(to_io_error)?,
            root: directory.to_path_buf(),
        });
    }

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            continue;
        }

        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        if options.ignores_name(&name) {
            continue;
        }

        let child = entry.path();

        // Prune ignored subtrees from the scope-discovery walk. A directory that
        // a parent .gitignore already ignores is excluded from the workspace
        // wholesale, so (1) recursing into it just to collect deeper .gitignore
        // files is wasted work - on large repos the eager walk descended into
        // every storage/cache/build directory and cost ~150ms on a single
        // search_files call - and (2) any .gitignore inside an ignored directory
        // has no authority: git never lets a nested negation resurrect a file
        // whose ancestor directory is excluded. Skipping these subtrees keeps
        // matcher construction instant AND matches git's semantics. We test
        // against the scopes gathered so far, which are exactly the ancestor
        // scopes for this child (parents are always visited before children).
        if matches_gitignore_scopes(scopes, &child, true) {
            continue;
        }

        add_gitignore_scopes(&child, options, scopes)?;
    }

    Ok(())
}

fn matches_gitignore_scopes(
    scopes: &[GitignoreScope],
    path: &Path,
    is_directory: bool,
) -> bool {
    let mut is_ignored = false;

    for scope in scopes {
        if !path.starts_with(&scope.root) {
            continue;
        }

        match scope
            .gitignore
            .matched_path_or_any_parents(path, is_directory)
        {
            Match::Ignore(_) => {
                is_ignored = true;
            }
            Match::Whitelist(_) => {
                is_ignored = false;
            }
            Match::None => {}
        }
    }

    is_ignored
}

fn absolute_candidate(root: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    root.join(path)
}

fn resolve_candidate_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    path.to_path_buf()
}

fn has_default_ignored_component(path: &Path, options: &WorkspaceIgnoreOptions) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        options.ignores_name(&name)
    })
}

fn to_io_error(error: ignore::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn root_gitignore_ignores_files_directories_and_children() {
        let root = temp_workspace("root-gitignore");
        fs::write(root.join(".gitignore"), "cache/\n*.log\n").expect("gitignore");
        fs::create_dir_all(root.join("cache")).expect("cache directory");
        fs::write(root.join("cache/data.php"), "<?php").expect("cache file");
        fs::write(root.join("debug.log"), "debug").expect("log file");
        fs::create_dir_all(root.join("src")).expect("src directory");
        fs::write(root.join("src/User.php"), "<?php").expect("source file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&root.join("cache"), true));
        assert!(matcher.is_ignored(&root.join("cache/data.php"), false));
        assert!(matcher.is_ignored(&root.join("debug.log"), false));
        assert!(!matcher.is_ignored(&root.join("src/User.php"), false));
    }

    #[test]
    fn nested_gitignore_is_scoped_to_nested_directory() {
        let root = temp_workspace("nested-gitignore");
        fs::create_dir_all(root.join("src")).expect("src directory");
        fs::write(root.join("src/.gitignore"), "Generated.php\n").expect("nested gitignore");
        fs::write(root.join("src/Generated.php"), "<?php").expect("generated file");
        fs::write(root.join("Generated.php"), "<?php").expect("root file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&root.join("src/Generated.php"), false));
        assert!(!matcher.is_ignored(&root.join("Generated.php"), false));
    }

    #[test]
    fn gitignore_negation_can_unignore_a_child_file() {
        let root = temp_workspace("negation");
        fs::write(root.join(".gitignore"), "ignored/*\n!ignored/keep.php\n").expect("gitignore");
        fs::create_dir_all(root.join("ignored")).expect("ignored directory");
        fs::write(root.join("ignored/drop.php"), "<?php").expect("drop file");
        fs::write(root.join("ignored/keep.php"), "<?php").expect("keep file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&root.join("ignored/drop.php"), false));
        assert!(!matcher.is_ignored(&root.join("ignored/keep.php"), false));
    }

    #[test]
    fn default_ignored_names_apply_without_gitignore_files() {
        let root = temp_workspace("defaults");
        fs::create_dir_all(root.join("vendor/package")).expect("vendor directory");
        fs::write(root.join("vendor/package/Class.php"), "<?php").expect("vendor file");
        fs::create_dir_all(root.join("src")).expect("src directory");
        fs::write(root.join("src/Class.php"), "<?php").expect("source file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&root.join("vendor"), true));
        assert!(matcher.is_ignored(&root.join("vendor/package/Class.php"), false));
        assert!(!matcher.is_ignored(&root.join("src/Class.php"), false));
    }

    #[test]
    fn nested_gitignore_inside_an_ignored_directory_does_not_resurrect_children() {
        // Performance + correctness guard for the pruned scope discovery: the
        // scope walk must not descend into directories that a parent .gitignore
        // already ignores. A nested .gitignore (even one that negates a child)
        // living inside an ignored directory has no authority - the whole
        // subtree is ignored - so its rules must never flip a child back to
        // visible. This pins both the behaviour and the pruning that keeps
        // matcher load instant on large repos.
        let root = temp_workspace("ignored-subtree-nested-gitignore");
        fs::write(root.join(".gitignore"), "ignored/\n").expect("root gitignore");
        fs::create_dir_all(root.join("ignored/deep")).expect("ignored subtree");
        fs::write(
            root.join("ignored/.gitignore"),
            "!deep/Keep.php\n",
        )
        .expect("nested negation gitignore");
        fs::write(root.join("ignored/deep/Keep.php"), "<?php").expect("nested file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        // The directory and everything under it stays ignored regardless of the
        // nested negation, and the nested .gitignore is never consulted.
        assert!(matcher.is_ignored(&root.join("ignored"), true));
        assert!(matcher.is_ignored(&root.join("ignored/deep/Keep.php"), false));
    }

    #[test]
    fn nested_gitignore_in_a_visible_directory_still_applies() {
        // Counterpart to the pruning guard: a nested .gitignore in a directory
        // that is NOT ignored must still be discovered and applied. Pruning may
        // only skip ignored subtrees.
        let root = temp_workspace("visible-nested-gitignore");
        fs::create_dir_all(root.join("src/sub")).expect("src subtree");
        fs::write(root.join("src/.gitignore"), "sub/Generated.php\n").expect("nested gitignore");
        fs::write(root.join("src/sub/Generated.php"), "<?php").expect("generated file");
        fs::write(root.join("src/sub/Kept.php"), "<?php").expect("kept file");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&root.join("src/sub/Generated.php"), false));
        assert!(!matcher.is_ignored(&root.join("src/sub/Kept.php"), false));
    }

    #[test]
    fn paths_outside_the_workspace_are_ignored() {
        let root = temp_workspace("outside-root");
        let outside = temp_workspace("outside-target");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert!(matcher.is_ignored(&outside.join("Secret.php"), false));
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-ignore-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical workspace")
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }
}
