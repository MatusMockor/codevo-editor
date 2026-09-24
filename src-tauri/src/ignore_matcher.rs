use crate::workspace::protected_paths::ProtectedPathPolicy;
use ignore::{
    gitignore::{Gitignore, GitignoreBuilder},
    Match,
};
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const DEFAULT_SCOPE_DISCOVERY_MAX_DEPTH: usize = 64;
const DEFAULT_SCOPE_DISCOVERY_MAX_DIRECTORIES: usize = 20_000;
const DEFAULT_SCOPE_DISCOVERY_MAX_ENTRIES: usize = 400_000;
const DEFAULT_SCOPE_DISCOVERY_SAFETY_TIME_LIMIT: Duration = Duration::from_secs(10);

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IgnoreRulesTruncation {
    DepthLimit,
    DirectoryLimit,
    EntryLimit,
    TimeLimit,
    UnreadableDirectory,
}

impl IgnoreRulesTruncation {
    pub fn description(self) -> &'static str {
        match self {
            Self::DepthLimit => "Ignore rules are incomplete: directory depth limit reached.",
            Self::DirectoryLimit => "Ignore rules are incomplete: directory count limit reached.",
            Self::EntryLimit => "Ignore rules are incomplete: directory entry limit reached.",
            Self::TimeLimit => "Ignore rules are incomplete: discovery time limit reached.",
            Self::UnreadableDirectory => {
                "Ignore rules are incomplete: a directory could not be read."
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum IgnoreRulesCompleteness {
    Complete,
    Truncated { reason: IgnoreRulesTruncation },
}

impl IgnoreRulesCompleteness {
    pub fn truncation(self) -> Option<IgnoreRulesTruncation> {
        match self {
            Self::Complete => None,
            Self::Truncated { reason } => Some(reason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScopeDiscoveryLimits {
    pub max_depth: usize,
    pub max_directories: usize,
    pub max_entries: usize,
    pub safety_time_limit: Duration,
}

impl Default for ScopeDiscoveryLimits {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_SCOPE_DISCOVERY_MAX_DEPTH,
            max_directories: DEFAULT_SCOPE_DISCOVERY_MAX_DIRECTORIES,
            max_entries: DEFAULT_SCOPE_DISCOVERY_MAX_ENTRIES,
            safety_time_limit: DEFAULT_SCOPE_DISCOVERY_SAFETY_TIME_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIgnoreOptions {
    default_ignored_names: Vec<String>,
    discovery_limits: ScopeDiscoveryLimits,
    protected_paths: ProtectedPathPolicy,
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
            discovery_limits: ScopeDiscoveryLimits::default(),
            protected_paths: ProtectedPathPolicy::current().clone(),
        }
    }

    pub fn with_discovery_limits(mut self, discovery_limits: ScopeDiscoveryLimits) -> Self {
        self.discovery_limits = discovery_limits;
        self
    }

    pub fn with_protected_paths(mut self, protected_paths: ProtectedPathPolicy) -> Self {
        self.protected_paths = protected_paths;
        self
    }

    pub fn ignores_name(&self, name: &str) -> bool {
        self.default_ignored_names
            .iter()
            .any(|ignored_name| ignored_name == name)
    }
}

pub struct GitignoreWorkspaceIgnoreMatcher {
    completeness: IgnoreRulesCompleteness,
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

    pub fn load_with_cancellation(
        root: &Path,
        is_cancelled: &dyn Fn() -> bool,
    ) -> io::Result<Self> {
        Self::load_with_options_and_cancellation(
            root,
            WorkspaceIgnoreOptions::default(),
            is_cancelled,
        )
    }

    pub fn load_with_options(root: &Path, options: WorkspaceIgnoreOptions) -> io::Result<Self> {
        Self::load_with_options_and_cancellation(root, options, &|| false)
    }

    pub(crate) fn from_gitignore_contents(
        root: &Path,
        contents: Vec<(PathBuf, String)>,
    ) -> io::Result<Self> {
        let mut scopes = Vec::with_capacity(contents.len());
        for (relative_directory, content) in contents {
            let directory = root.join(relative_directory);
            let source = directory.join(".gitignore");
            let mut builder = GitignoreBuilder::new(&directory);
            for line in content.lines() {
                builder
                    .add_line(Some(source.clone()), line)
                    .map_err(to_io_error)?;
            }
            scopes.push(GitignoreScope {
                gitignore: builder.build().map_err(to_io_error)?,
                root: directory,
            });
        }
        Ok(Self {
            completeness: IgnoreRulesCompleteness::Complete,
            options: WorkspaceIgnoreOptions::default(),
            root: root.to_path_buf(),
            scopes,
        })
    }

    pub fn load_with_options_and_cancellation(
        root: &Path,
        options: WorkspaceIgnoreOptions,
        is_cancelled: &dyn Fn() -> bool,
    ) -> io::Result<Self> {
        ensure_load_current(is_cancelled)?;
        let root = root.canonicalize()?;
        let (scopes, completeness) = discover_gitignore_scopes(&root, &options, is_cancelled)?;

        Ok(Self {
            completeness,
            options,
            root,
            scopes,
        })
    }

    pub fn completeness(&self) -> IgnoreRulesCompleteness {
        self.completeness
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
    #[cfg(test)]
    pub(crate) fn scope_roots(&self) -> impl Iterator<Item = &Path> {
        self.scopes.iter().map(|scope| scope.root.as_path())
    }

    fn is_gitignored(&self, path: &Path, is_directory: bool) -> bool {
        matches_gitignore_scopes(&self.scopes, path, is_directory)
    }
}

pub fn is_default_ignored_name(name: &str) -> bool {
    DEFAULT_IGNORED_NAMES.contains(&name)
}

fn discover_gitignore_scopes(
    root: &Path,
    options: &WorkspaceIgnoreOptions,
    is_cancelled: &dyn Fn() -> bool,
) -> io::Result<(Vec<GitignoreScope>, IgnoreRulesCompleteness)> {
    let mut walk = ScopeDiscoveryWalk {
        deadline: Instant::now().checked_add(options.discovery_limits.safety_time_limit),
        entries: 0,
        is_cancelled,
        options,
        truncation: None,
        unreadable: false,
    };
    let mut scopes = Vec::new();
    let mut pending = Vec::new();
    add_directory_scope(root, &mut scopes)?;
    walk.push_child_directories(root, fs::read_dir(root)?, 0, &scopes, &mut pending)?;
    let mut visited = 1;

    while walk.truncation.is_none() {
        let Some((directory, depth)) = pending.pop() else {
            break;
        };
        walk.ensure_current()?;
        if visited >= options.discovery_limits.max_directories {
            walk.truncate(IgnoreRulesTruncation::DirectoryLimit);
            break;
        }
        if walk.is_past_deadline() {
            walk.truncate(IgnoreRulesTruncation::TimeLimit);
            break;
        }
        visited += 1;
        add_directory_scope(&directory, &mut scopes)?;
        let Ok(entries) = fs::read_dir(&directory) else {
            walk.unreadable = true;
            continue;
        };
        walk.push_child_directories(&directory, entries, depth, &scopes, &mut pending)?;
    }

    Ok((scopes, walk.completeness()))
}

struct ScopeDiscoveryWalk<'a> {
    deadline: Option<Instant>,
    entries: usize,
    is_cancelled: &'a dyn Fn() -> bool,
    options: &'a WorkspaceIgnoreOptions,
    truncation: Option<IgnoreRulesTruncation>,
    unreadable: bool,
}

impl ScopeDiscoveryWalk<'_> {
    fn ensure_current(&self) -> io::Result<()> {
        ensure_load_current(self.is_cancelled)
    }

    fn is_past_deadline(&self) -> bool {
        self.deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    fn truncate(&mut self, reason: IgnoreRulesTruncation) {
        self.truncation.get_or_insert(reason);
    }

    fn completeness(&self) -> IgnoreRulesCompleteness {
        if let Some(reason) = self.truncation {
            return IgnoreRulesCompleteness::Truncated { reason };
        }
        if self.unreadable {
            return IgnoreRulesCompleteness::Truncated {
                reason: IgnoreRulesTruncation::UnreadableDirectory,
            };
        }
        IgnoreRulesCompleteness::Complete
    }

    fn push_child_directories(
        &mut self,
        directory: &Path,
        entries: fs::ReadDir,
        depth: usize,
        scopes: &[GitignoreScope],
        pending: &mut Vec<(PathBuf, usize)>,
    ) -> io::Result<()> {
        for entry in entries {
            self.ensure_current()?;
            self.entries += 1;
            if self.entries > self.options.discovery_limits.max_entries {
                self.truncate(IgnoreRulesTruncation::EntryLimit);
                return Ok(());
            }
            if self.is_past_deadline() {
                self.truncate(IgnoreRulesTruncation::TimeLimit);
                return Ok(());
            }
            let Some(child) = self.discoverable_child(directory, entry, scopes) else {
                continue;
            };
            if depth >= self.options.discovery_limits.max_depth {
                self.truncate(IgnoreRulesTruncation::DepthLimit);
                return Ok(());
            }
            pending.push((child, depth + 1));
        }

        Ok(())
    }

    fn discoverable_child(
        &self,
        directory: &Path,
        entry: io::Result<fs::DirEntry>,
        scopes: &[GitignoreScope],
    ) -> Option<PathBuf> {
        let entry = entry.ok()?;
        let file_type = entry.file_type().ok()?;
        if file_type.is_symlink() || !file_type.is_dir() {
            return None;
        }
        if self
            .options
            .ignores_name(&entry.file_name().to_string_lossy())
        {
            return None;
        }
        let child = directory.join(entry.file_name());
        if self.options.protected_paths.is_protected_directory(&child) {
            return None;
        }
        if matches_gitignore_scopes(scopes, &child, true) {
            return None;
        }
        Some(child)
    }
}

fn add_directory_scope(directory: &Path, scopes: &mut Vec<GitignoreScope>) -> io::Result<()> {
    let gitignore_path = directory.join(".gitignore");
    if !gitignore_path.is_file() {
        return Ok(());
    }

    let mut builder = GitignoreBuilder::new(directory);
    if let Some(error) = builder.add(&gitignore_path) {
        return Err(to_io_error(error));
    }

    scopes.push(GitignoreScope {
        gitignore: builder.build().map_err(to_io_error)?,
        root: directory.to_path_buf(),
    });
    Ok(())
}

fn ensure_load_current(is_cancelled: &dyn Fn() -> bool) -> io::Result<()> {
    if !is_cancelled() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::Interrupted,
        "workspace ignore matcher load cancelled",
    ))
}

fn matches_gitignore_scopes(scopes: &[GitignoreScope], path: &Path, is_directory: bool) -> bool {
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
    use super::{
        GitignoreWorkspaceIgnoreMatcher, IgnoreRulesCompleteness, IgnoreRulesTruncation,
        ScopeDiscoveryLimits, WorkspaceIgnoreMatcher, WorkspaceIgnoreOptions,
    };
    use crate::workspace::protected_paths::ProtectedPathPolicy;
    use std::{
        fs, io,
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
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
        fs::write(root.join("ignored/.gitignore"), "!deep/Keep.php\n")
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

    #[test]
    fn complete_discovery_reports_complete_ignore_rules() {
        let root = temp_workspace("complete");
        fs::create_dir_all(root.join("src/nested")).expect("nested directories");
        fs::write(root.join("src/.gitignore"), "Generated.ts\n").expect("nested gitignore");

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("matcher");

        assert_eq!(matcher.completeness(), IgnoreRulesCompleteness::Complete);
    }

    #[test]
    fn scope_discovery_stops_at_the_directory_limit_and_reports_truncation() {
        let root = temp_workspace("directory-limit");
        fs::write(root.join(".gitignore"), "*.log\n").expect("root gitignore");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("src/.gitignore"), "Generated.ts\n").expect("nested gitignore");
        let options = WorkspaceIgnoreOptions::default().with_discovery_limits(limits(64, 1, 1_000));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&root, options).expect("matcher");

        assert!(matcher.is_ignored(&root.join("debug.log"), false));
        assert_eq!(
            matcher.scope_roots().collect::<Vec<_>>(),
            vec![root.as_path()]
        );
        assert_eq!(
            matcher.completeness(),
            truncated(IgnoreRulesTruncation::DirectoryLimit)
        );
    }

    #[test]
    fn scope_discovery_stops_at_the_depth_limit_and_reports_truncation() {
        let root = temp_workspace("depth-limit");
        fs::create_dir_all(root.join("a/b")).expect("nested directories");
        fs::write(root.join("a/.gitignore"), "A.ts\n").expect("depth one gitignore");
        fs::write(root.join("a/b/.gitignore"), "B.ts\n").expect("depth two gitignore");
        let options =
            WorkspaceIgnoreOptions::default().with_discovery_limits(limits(1, 1_000, 1_000));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&root, options).expect("matcher");

        assert!(matcher.is_ignored(&root.join("a/A.ts"), false));
        assert!(!matcher.is_ignored(&root.join("a/b/B.ts"), false));
        assert_eq!(
            matcher.completeness(),
            truncated(IgnoreRulesTruncation::DepthLimit)
        );
    }

    #[test]
    fn depth_limit_without_deeper_directories_stays_complete() {
        let root = temp_workspace("depth-limit-leaf");
        fs::create_dir_all(root.join("a")).expect("leaf directory");
        fs::write(root.join("a/file.ts"), "export {};").expect("leaf file");
        let options =
            WorkspaceIgnoreOptions::default().with_discovery_limits(limits(1, 1_000, 1_000));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&root, options).expect("matcher");

        assert_eq!(matcher.completeness(), IgnoreRulesCompleteness::Complete);
    }

    #[test]
    fn scope_discovery_stops_at_the_entry_limit_and_reports_truncation() {
        let root = temp_workspace("entry-limit");
        for index in 0..4 {
            fs::create_dir_all(root.join(format!("dir-{index}"))).expect("directory");
        }
        let options = WorkspaceIgnoreOptions::default().with_discovery_limits(limits(64, 1_000, 2));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&root, options).expect("matcher");

        assert_eq!(
            matcher.completeness(),
            truncated(IgnoreRulesTruncation::EntryLimit)
        );
    }

    #[test]
    fn exhausted_safety_time_limit_is_reported_as_truncated() {
        let root = temp_workspace("time-limit");
        fs::write(root.join(".gitignore"), "*.log\n").expect("root gitignore");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("src/.gitignore"), "Generated.ts\n").expect("nested gitignore");
        let options =
            WorkspaceIgnoreOptions::default().with_discovery_limits(ScopeDiscoveryLimits {
                safety_time_limit: Duration::ZERO,
                ..limits(64, 1_000, 1_000)
            });

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&root, options).expect("matcher");

        assert!(matcher.is_ignored(&root.join("debug.log"), false));
        assert!(!matcher.is_ignored(&root.join("src/Generated.ts"), false));
        assert_eq!(
            matcher.completeness(),
            truncated(IgnoreRulesTruncation::TimeLimit)
        );
    }

    #[cfg(unix)]
    #[test]
    fn permission_denied_subdirectory_is_skipped_without_failing_the_load() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_workspace("permission-denied");
        fs::create_dir_all(root.join("locked")).expect("locked directory");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("src/.gitignore"), "Generated.ts\n").expect("nested gitignore");
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o000))
            .expect("lock directory");

        let result = GitignoreWorkspaceIgnoreMatcher::load(&root);
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o755))
            .expect("unlock directory");

        let matcher = result.expect("matcher");
        assert!(matcher.is_ignored(&root.join("src/Generated.ts"), false));
        assert_eq!(
            matcher.completeness(),
            truncated(IgnoreRulesTruncation::UnreadableDirectory)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn home_root_discovery_skips_privacy_protected_children() {
        let home = temp_workspace("privacy-home");
        fs::create_dir_all(home.join("Music")).expect("protected directory");
        fs::write(home.join("Music/.gitignore"), "*\n").expect("protected gitignore");
        fs::create_dir_all(home.join("code")).expect("regular directory");
        fs::write(home.join("code/.gitignore"), "*.log\n").expect("regular gitignore");
        let options = WorkspaceIgnoreOptions::default()
            .with_protected_paths(ProtectedPathPolicy::for_home(Some(&home)));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&home, options).expect("matcher");

        assert!(matcher.is_ignored(&home.join("code/debug.log"), false));
        assert!(!matcher
            .scope_roots()
            .any(|scope| scope == home.join("Music").as_path()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn root_equal_to_a_protected_home_child_is_discovered() {
        let home = temp_workspace("privacy-documents-root");
        let documents = home.join("Documents");
        fs::create_dir_all(documents.join("src")).expect("documents tree");
        fs::write(documents.join("src/.gitignore"), "Generated.ts\n").expect("nested gitignore");
        let options = WorkspaceIgnoreOptions::default()
            .with_protected_paths(ProtectedPathPolicy::for_home(Some(&home)));

        let matcher = GitignoreWorkspaceIgnoreMatcher::load_with_options(&documents, options)
            .expect("matcher");

        assert!(matcher.is_ignored(&documents.join("src/Generated.ts"), false));
        assert_eq!(matcher.completeness(), IgnoreRulesCompleteness::Complete);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn root_inside_a_protected_home_child_is_discovered() {
        let home = temp_workspace("privacy-documents-project");
        let project = home.join("Documents/project");
        fs::create_dir_all(project.join("Music")).expect("project tree");
        fs::write(project.join("Music/.gitignore"), "Generated.ts\n").expect("nested gitignore");
        let options = WorkspaceIgnoreOptions::default()
            .with_protected_paths(ProtectedPathPolicy::for_home(Some(&home)));

        let matcher =
            GitignoreWorkspaceIgnoreMatcher::load_with_options(&project, options).expect("matcher");

        assert!(matcher.is_ignored(&project.join("Music/Generated.ts"), false));
    }

    #[test]
    fn cancelled_discovery_reports_interrupted() {
        let root = temp_workspace("cancelled");

        let error = match GitignoreWorkspaceIgnoreMatcher::load_with_cancellation(&root, &|| true) {
            Ok(_) => io::Error::other("unexpected success"),
            Err(error) => error,
        };

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }

    fn limits(
        max_depth: usize,
        max_directories: usize,
        max_entries: usize,
    ) -> ScopeDiscoveryLimits {
        ScopeDiscoveryLimits {
            max_depth,
            max_directories,
            max_entries,
            safety_time_limit: Duration::from_secs(60),
        }
    }

    fn truncated(reason: IgnoreRulesTruncation) -> IgnoreRulesCompleteness {
        IgnoreRulesCompleteness::Truncated { reason }
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
