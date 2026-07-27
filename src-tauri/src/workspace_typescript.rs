use crate::workspace_registry::{
    open_file_relative_to, opened_regular_file_path, opened_root_path,
};
use crate::{
    lsp::{
        JavaScriptTypeScriptLanguageServerPlanner, LanguageServerPlan, LanguageServerPlanStatus,
        TypeScriptImportModuleSpecifierEnding, TypeScriptImportModuleSpecifierPreference,
        TypeScriptLanguageServerPlanner, TypeScriptLanguageServerSettings,
        TypeScriptQuotePreference,
    },
    tools::{self, JavaScriptTypeScriptToolPreference},
    trust::{WorkspaceTrustService, WorkspaceTrustSnapshot},
    JavaScriptTypeScriptLanguageServerOptions,
};
use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

pub(super) const WORKSPACE_TYPESCRIPT_MAX_ANCESTOR_DEPTH: usize = 16;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_DIRECTORY_DEPTH: usize = 12;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_DIRECTORY_ENTRIES: usize = 16_384;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_PENDING_DIRECTORIES: usize = 4_096;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_PACKAGE_DIRECTORIES: usize = 64;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_PATH_BYTES: usize = 4_096;
pub(super) const WORKSPACE_TYPESCRIPT_MAX_PROBES: usize = 128;
pub(super) const WORKSPACE_TYPESCRIPT_SEARCH_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Copy)]
struct SearchLimits {
    ancestor_depth: usize,
    directory_depth: usize,
    directory_entries: usize,
    pending_directories: usize,
    package_directories: usize,
    path_bytes: usize,
    probes: usize,
    timeout: Duration,
}

impl SearchLimits {
    const PRODUCTION: Self = Self {
        ancestor_depth: WORKSPACE_TYPESCRIPT_MAX_ANCESTOR_DEPTH,
        directory_depth: WORKSPACE_TYPESCRIPT_MAX_DIRECTORY_DEPTH,
        directory_entries: WORKSPACE_TYPESCRIPT_MAX_DIRECTORY_ENTRIES,
        pending_directories: WORKSPACE_TYPESCRIPT_MAX_PENDING_DIRECTORIES,
        package_directories: WORKSPACE_TYPESCRIPT_MAX_PACKAGE_DIRECTORIES,
        path_bytes: WORKSPACE_TYPESCRIPT_MAX_PATH_BYTES,
        probes: WORKSPACE_TYPESCRIPT_MAX_PROBES,
        timeout: WORKSPACE_TYPESCRIPT_SEARCH_TIMEOUT,
    };
}

#[cfg(test)]
pub(super) fn build_javascript_typescript_language_server_plan(
    trust: &Mutex<WorkspaceTrustService>,
    options: &JavaScriptTypeScriptLanguageServerOptions,
) -> Result<LanguageServerPlan, String> {
    let authority = capture_javascript_typescript_workspace_trust(trust, &options.root_path)?;
    build_javascript_typescript_language_server_plan_with_trust(authority.trusted, options)
}

pub(super) fn build_javascript_typescript_language_server_plan_with_trust(
    trusted: bool,
    options: &JavaScriptTypeScriptLanguageServerOptions,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(&options.root_path);
    let preference = javascript_typescript_tool_preference_from_setting(
        options.type_script_version_preference.as_deref(),
    );
    let settings = TypeScriptLanguageServerSettings {
        auto_imports: options.auto_imports_enabled.unwrap_or(true),
        automatic_type_acquisition: options.automatic_type_acquisition_enabled.unwrap_or(false),
        code_lens: options.code_lens_enabled.unwrap_or(false),
        complete_function_calls: options.complete_function_calls.unwrap_or(false),
        import_module_specifier_ending: TypeScriptImportModuleSpecifierEnding::from_setting(
            options.import_module_specifier_ending.as_deref(),
        ),
        import_module_specifier_preference: TypeScriptImportModuleSpecifierPreference::from_setting(
            options.import_module_specifier_preference.as_deref(),
        ),
        inlay_hints: options.inlay_hints_enabled.unwrap_or(true),
        prefer_type_only_auto_imports: options.prefer_type_only_auto_imports.unwrap_or(false),
        quote_preference: TypeScriptQuotePreference::from_setting(
            options.quote_preference.as_deref(),
        ),
        validation: options.validation_enabled.unwrap_or(true),
    };
    let detection = tools::detect_javascript_typescript_tools(Some(&root), preference)
        .map_err(|error| error.to_string())?;
    let mut plan =
        TypeScriptLanguageServerPlanner::new().plan(&root, trusted, &detection.tools, settings);
    append_workspace_typescript_message(&mut plan, detection.workspace_typescript_message);
    Ok(plan)
}

fn append_workspace_typescript_message(
    plan: &mut LanguageServerPlan,
    workspace_typescript_message: Option<String>,
) {
    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return;
    }
    if let Some(message) = workspace_typescript_message {
        plan.message = format!("{} {message}", plan.message);
    }
}

pub(super) fn capture_javascript_typescript_workspace_trust(
    trust: &Mutex<WorkspaceTrustService>,
    root_path: &str,
) -> Result<WorkspaceTrustSnapshot, String> {
    let service = trust.lock().map_err(|error| error.to_string())?;
    Ok(service.snapshot(root_path))
}

pub(super) fn revalidate_javascript_typescript_workspace_trust(
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceTrustSnapshot,
) -> Result<(), String> {
    let service = trust.lock().map_err(|error| error.to_string())?;
    if service.snapshot(&authority.root_path) != *authority {
        return Err("Workspace trust changed while preparing the language server.".to_string());
    }
    Ok(())
}

fn javascript_typescript_tool_preference_from_setting(
    value: Option<&str>,
) -> JavaScriptTypeScriptToolPreference {
    match value {
        Some("workspace") => JavaScriptTypeScriptToolPreference::Workspace,
        _ => JavaScriptTypeScriptToolPreference::Bundled,
    }
}

struct WorkspaceAuthority {
    identity: PathBuf,
    retained_root: File,
}

impl WorkspaceAuthority {
    fn capture(root: &Path, path_bytes: usize) -> io::Result<Self> {
        if root.as_os_str().len() > path_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "workspace path exceeds resolution limit",
            ));
        }
        let retained_root = File::open(root)?;
        let identity = opened_root_path(&retained_root)?;
        if identity.as_os_str().len() > path_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "workspace identity exceeds resolution limit",
            ));
        }
        Ok(Self {
            identity,
            retained_root,
        })
    }

    fn is_current(&self) -> bool {
        opened_root_path(&self.retained_root).is_ok_and(|path| path == self.identity)
    }
}

enum SearchResult {
    Found(PathBuf),
    Missing,
    LimitReached,
    OutsideRoot,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum WorkspaceTypeScriptResolution {
    Found(PathBuf),
    Absent,
    Truncated,
    OutsideRoot,
}

struct SearchState {
    limits: SearchLimits,
    probed: HashSet<PathBuf>,
    probes: usize,
    started: Instant,
}

impl SearchState {
    fn new(limits: SearchLimits) -> Self {
        Self {
            limits,
            probed: HashSet::new(),
            probes: 0,
            started: Instant::now(),
        }
    }

    fn within_budget(&self) -> bool {
        self.started.elapsed() <= self.limits.timeout
    }

    fn probe(&mut self, authority: &WorkspaceAuthority, package_root: &Path) -> SearchResult {
        if !self.within_budget() {
            return SearchResult::LimitReached;
        }
        if self.probed.contains(package_root) {
            return SearchResult::Missing;
        }
        if self.probes >= self.limits.probes {
            return SearchResult::LimitReached;
        }
        self.probed.insert(package_root.to_path_buf());
        self.probes += 1;
        let candidate = package_root
            .join("node_modules")
            .join("typescript")
            .join("lib")
            .join("tsserver.js");
        if candidate.as_os_str().len() > self.limits.path_bytes {
            return SearchResult::Missing;
        }
        let Ok(canonical_target) = candidate.canonicalize() else {
            return SearchResult::Missing;
        };
        let Ok(relative_target) = canonical_target.strip_prefix(&authority.identity) else {
            return SearchResult::OutsideRoot;
        };
        if !canonical_target.ends_with(Path::new("node_modules/typescript/lib/tsserver.js")) {
            return SearchResult::Missing;
        }
        let Ok(retained_server) = open_file_relative_to(&authority.retained_root, relative_target)
        else {
            return SearchResult::Missing;
        };
        let Ok(opened_path) = opened_regular_file_path(&retained_server) else {
            return SearchResult::Missing;
        };
        if opened_path != canonical_target {
            return SearchResult::Missing;
        }
        if !authority.is_current() {
            return SearchResult::Missing;
        }
        SearchResult::Found(opened_path)
    }
}

pub(super) fn resolve_workspace_typescript(root: &Path) -> WorkspaceTypeScriptResolution {
    resolve_workspace_typescript_with_limits(root, SearchLimits::PRODUCTION)
}

fn resolve_workspace_typescript_with_limits(
    root: &Path,
    limits: SearchLimits,
) -> WorkspaceTypeScriptResolution {
    let Ok(authority) = WorkspaceAuthority::capture(root, limits.path_bytes) else {
        return WorkspaceTypeScriptResolution::Absent;
    };
    let mut state = SearchState::new(limits);
    let mut outside_root = false;
    match state.probe(&authority, &authority.identity) {
        SearchResult::Found(path) => return WorkspaceTypeScriptResolution::Found(path),
        SearchResult::Missing => {}
        SearchResult::LimitReached => return WorkspaceTypeScriptResolution::Truncated,
        SearchResult::OutsideRoot => outside_root = true,
    }
    let package_enumeration = enumerate_package_directories(&authority, &state);

    for package_directory in &package_enumeration.directories {
        match state.probe(&authority, package_directory) {
            SearchResult::Found(path) => return WorkspaceTypeScriptResolution::Found(path),
            SearchResult::Missing => {}
            SearchResult::LimitReached => return WorkspaceTypeScriptResolution::Truncated,
            SearchResult::OutsideRoot => outside_root = true,
        }
    }

    for package_directory in package_enumeration.directories {
        match resolve_from_ancestors(&authority, &package_directory, &mut state) {
            SearchResult::Found(path) => return WorkspaceTypeScriptResolution::Found(path),
            SearchResult::Missing => {}
            SearchResult::LimitReached => return WorkspaceTypeScriptResolution::Truncated,
            SearchResult::OutsideRoot => outside_root = true,
        }
    }

    if !authority.is_current() {
        return WorkspaceTypeScriptResolution::Absent;
    }
    if outside_root {
        return WorkspaceTypeScriptResolution::OutsideRoot;
    }
    if package_enumeration.truncated {
        return WorkspaceTypeScriptResolution::Truncated;
    }
    WorkspaceTypeScriptResolution::Absent
}

fn resolve_from_ancestors(
    authority: &WorkspaceAuthority,
    project: &Path,
    state: &mut SearchState,
) -> SearchResult {
    let Some(parent) = project.parent() else {
        return SearchResult::Missing;
    };
    let mut current = parent.to_path_buf();

    for _ in 0..state.limits.ancestor_depth {
        if current == authority.identity {
            return SearchResult::Missing;
        }
        match state.probe(authority, &current) {
            SearchResult::Found(path) => return SearchResult::Found(path),
            SearchResult::Missing => {}
            SearchResult::LimitReached => return SearchResult::LimitReached,
            SearchResult::OutsideRoot => return SearchResult::OutsideRoot,
        }
        let Some(parent) = current.parent() else {
            return SearchResult::Missing;
        };
        if !parent.starts_with(&authority.identity) {
            return SearchResult::Missing;
        }
        current = parent.to_path_buf();
    }

    if current == authority.identity {
        return SearchResult::Missing;
    }
    SearchResult::LimitReached
}

struct PackageDirectoryEnumeration {
    directories: Vec<PathBuf>,
    truncated: bool,
}

fn enumerate_package_directories(
    authority: &WorkspaceAuthority,
    state: &SearchState,
) -> PackageDirectoryEnumeration {
    let mut directories = Vec::new();
    let mut pending = VecDeque::from([(authority.identity.clone(), 0_usize)]);
    let mut visited_directories = 0_usize;
    let mut truncated = false;

    'walk: while let Some((directory, depth)) = pending.pop_front() {
        if !state.within_budget() {
            truncated = true;
            break;
        }
        let is_package = fs::symlink_metadata(directory.join("package.json"))
            .is_ok_and(|metadata| metadata.file_type().is_file());
        if depth > 0 && is_package {
            if directories.len() >= state.limits.package_directories {
                truncated = true;
                break;
            }
            directories.push(directory.clone());
        }
        if depth >= state.limits.directory_depth {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut children = Vec::new();

        for entry in entries {
            if !state.within_budget() {
                truncated = true;
                break 'walk;
            }
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(
                    "node_modules"
                        | ".git"
                        | "target"
                        | "dist"
                        | "build"
                        | ".next"
                        | "coverage"
                        | ".venv"
                )
            ) {
                continue;
            }
            children.push(entry.path());
        }

        children.sort();
        for child in children {
            if visited_directories >= state.limits.directory_entries {
                truncated = true;
                break;
            }
            visited_directories += 1;
            if child.as_os_str().len() > state.limits.path_bytes {
                continue;
            }
            if pending.len() >= state.limits.pending_directories {
                truncated = true;
                break;
            }
            pending.push_back((child, depth + 1));
        }
    }

    directories.sort_by_key(|directory| {
        (
            directory.components().count(),
            directory.to_string_lossy().to_string(),
        )
    });
    PackageDirectoryEnumeration {
        directories,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_workspace_typescript_message, capture_javascript_typescript_workspace_trust,
        resolve_workspace_typescript, resolve_workspace_typescript_with_limits,
        revalidate_javascript_typescript_workspace_trust, SearchLimits, SearchResult, SearchState,
        WorkspaceAuthority, WorkspaceTypeScriptResolution,
    };
    use crate::lsp::{LanguageServerPlan, LanguageServerPlanStatus, LanguageServerProvider};
    use crate::trust::WorkspaceTrustService;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
        time::SystemTime,
    };

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(label: &str) -> Self {
            let suffix = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("codevo-typescript-{label}-{suffix}"));
            fs::create_dir_all(&root).expect("create fixture");
            Self(root.canonicalize().expect("canonical fixture"))
        }

        fn tsserver(&self, package_root: &Path) -> PathBuf {
            let server = package_root
                .join("node_modules")
                .join("typescript")
                .join("lib")
                .join("tsserver.js");
            fs::create_dir_all(server.parent().expect("tsserver parent"))
                .expect("create TypeScript lib");
            fs::write(&server, "module.exports = {};").expect("write tsserver");
            server
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn trust_snapshot_revalidation_rejects_revoke_regrant_aba() {
        let fixture = Fixture::new("trust-snapshot-aba");
        let trust = Mutex::new(
            WorkspaceTrustService::load(fixture.0.join("trust.json")).expect("load trust service"),
        );
        let authority =
            capture_javascript_typescript_workspace_trust(&trust, &fixture.0.to_string_lossy())
                .expect("capture trust authority");
        {
            let mut service = trust.lock().expect("trust service");
            service
                .set(&fixture.0.to_string_lossy(), true)
                .expect("grant trust");
            service
                .set(&fixture.0.to_string_lossy(), false)
                .expect("revoke trust");
        }

        assert!(revalidate_javascript_typescript_workspace_trust(&trust, &authority).is_err());
    }

    #[test]
    fn npm_workspaces_hoisted_root_typescript_resolves() {
        let fixture = Fixture::new("npm-hoisted");
        fs::write(
            fixture.0.join("package.json"),
            r#"{"private":true,"workspaces":["packages/*"]}"#,
        )
        .expect("write package manifest");
        let server = fixture.tsserver(&fixture.0);

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical tsserver")
            )
        );
    }

    #[test]
    fn nested_workspace_never_resolves_ancestor_typescript_server() {
        let fixture = Fixture::new("nested-no-ancestor");
        fixture.tsserver(&fixture.0);
        let nested_root = fixture.0.join("packages/api");
        fs::create_dir_all(&nested_root).expect("create nested workspace");
        fs::write(nested_root.join("package.json"), r#"{"name":"api"}"#)
            .expect("write nested manifest");

        assert_eq!(
            resolve_workspace_typescript(&nested_root),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[test]
    fn ready_plan_concatenates_workspace_typescript_degraded_reason() {
        let mut plan = LanguageServerPlan {
            provider: LanguageServerProvider::TypeScriptLanguageServer,
            status: LanguageServerPlanStatus::Ready,
            message: "TypeScript language server is ready.".to_string(),
            command: None,
            initialize_request: None,
        };

        append_workspace_typescript_message(
            &mut plan,
            Some(
                "Workspace TypeScript discovery reached its bounded search limit; bundled TypeScript is used."
                    .to_string(),
            ),
        );

        assert_eq!(
            plan.message,
            "TypeScript language server is ready. Workspace TypeScript discovery reached its bounded search limit; bundled TypeScript is used."
        );
    }

    #[cfg(unix)]
    #[test]
    fn pnpm_symlinked_typescript_store_resolves() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("pnpm-symlink");
        let package = fixture
            .0
            .join("node_modules/.pnpm/typescript@5.8.3/node_modules/typescript");
        let server = package.join("lib/tsserver.js");
        fs::create_dir_all(server.parent().expect("store TypeScript lib"))
            .expect("create store TypeScript lib");
        fs::write(&server, "module.exports = {};").expect("write store tsserver");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        symlink(
            ".pnpm/typescript@5.8.3/node_modules/typescript",
            fixture.0.join("node_modules/typescript"),
        )
        .expect("link pnpm TypeScript");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical store tsserver")
            )
        );
    }

    #[test]
    fn package_local_typescript_resolves_for_package_project() {
        let fixture = Fixture::new("package-local");
        let package = fixture.0.join("packages/api");
        fs::create_dir_all(&package).expect("create package");
        fs::write(package.join("package.json"), r#"{"name":"api"}"#)
            .expect("write package manifest");
        let server = fixture.tsserver(&package);

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical package tsserver")
            )
        );
    }

    #[test]
    fn root_typescript_wins_over_alphabetically_first_package_typescript() {
        let fixture = Fixture::new("package-preference");
        let root_server = fixture.tsserver(&fixture.0);
        let legacy_package = fixture.0.join("packages/a-legacy");
        let modern_package = fixture.0.join("packages/b-modern");
        for package in [&legacy_package, &modern_package] {
            fs::create_dir_all(package).expect("create package");
            fs::write(package.join("package.json"), r#"{"name":"package"}"#)
                .expect("write package manifest");
            fixture.tsserver(package);
        }

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Found(
                root_server.canonicalize().expect("canonical root tsserver")
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn typescript_symlink_escaping_workspace_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("escaping-symlink");
        let outside = Fixture::new("escaping-symlink-outside");
        let outside_package = outside.0.join("typescript");
        let outside_server = outside_package.join("lib/tsserver.js");
        fs::create_dir_all(outside_server.parent().expect("outside TypeScript lib"))
            .expect("create outside TypeScript lib");
        fs::write(&outside_server, "module.exports = {};").expect("write outside tsserver");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        symlink(&outside_package, fixture.0.join("node_modules/typescript"))
            .expect("link escaping TypeScript");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[cfg(unix)]
    #[test]
    fn relative_parent_chain_typescript_symlink_escape_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("relative-parent-escape");
        let outside = Fixture::new("relative-parent-escape-outside");
        let outside_package = outside.0.join("typescript");
        let outside_server = outside_package.join("lib/tsserver.js");
        fs::create_dir_all(outside_server.parent().expect("outside TypeScript lib"))
            .expect("create outside TypeScript lib");
        fs::write(&outside_server, "module.exports = {};").expect("write outside tsserver");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        let relative = Path::new("..")
            .join("..")
            .join(outside.0.file_name().expect("outside fixture name"))
            .join("typescript");
        symlink(relative, fixture.0.join("node_modules/typescript"))
            .expect("link relative escaping TypeScript");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[cfg(unix)]
    #[test]
    fn chained_typescript_symlink_escape_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("chained-escape");
        let outside = Fixture::new("chained-escape-outside");
        let outside_package = outside.0.join("typescript");
        let outside_server = outside_package.join("lib/tsserver.js");
        fs::create_dir_all(outside_server.parent().expect("outside TypeScript lib"))
            .expect("create outside TypeScript lib");
        fs::write(&outside_server, "module.exports = {};").expect("write outside tsserver");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        symlink(&outside_package, fixture.0.join("typescript-link")).expect("create outside link");
        symlink(
            fixture.0.join("typescript-link"),
            fixture.0.join("node_modules/typescript"),
        )
        .expect("create chained link");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_typescript_lib_escape_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("lib-escape");
        let outside = Fixture::new("lib-escape-outside");
        let outside_lib = outside.0.join("lib");
        fs::create_dir_all(&outside_lib).expect("create outside lib");
        fs::write(outside_lib.join("tsserver.js"), "module.exports = {};")
            .expect("write outside tsserver");
        let package = fixture.0.join("node_modules/typescript");
        fs::create_dir_all(&package).expect("create TypeScript package");
        symlink(&outside_lib, package.join("lib")).expect("link escaping lib");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_tsserver_file_escape_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("file-escape");
        let outside = Fixture::new("file-escape-outside");
        let outside_server = outside.0.join("tsserver.js");
        fs::write(&outside_server, "module.exports = {};").expect("write outside tsserver");
        let lib = fixture.0.join("node_modules/typescript/lib");
        fs::create_dir_all(&lib).expect("create TypeScript lib");
        symlink(&outside_server, lib.join("tsserver.js")).expect("link escaping tsserver");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[cfg(unix)]
    #[test]
    fn typescript_symlink_to_filesystem_root_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("root-escape");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        symlink("/", fixture.0.join("node_modules/typescript")).expect("link filesystem root");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[cfg(unix)]
    #[test]
    fn tsserver_fifo_fails_closed() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let fixture = Fixture::new("tsserver-fifo");
        let server = fixture.0.join("node_modules/typescript/lib/tsserver.js");
        fs::create_dir_all(server.parent().expect("tsserver parent"))
            .expect("create TypeScript lib");
        let path = CString::new(server.as_os_str().as_bytes()).expect("fifo path");
        let result = unsafe { libc::mkfifo(path.as_ptr(), 0o600) };
        assert_eq!(result, 0);

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[cfg(unix)]
    #[test]
    fn dangling_typescript_symlink_fails_closed() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("dangling-symlink");
        fs::create_dir_all(fixture.0.join("node_modules")).expect("create node_modules");
        symlink(
            ".pnpm/typescript@missing/node_modules/typescript",
            fixture.0.join("node_modules/typescript"),
        )
        .expect("link dangling TypeScript");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[test]
    fn tsserver_directory_fails_closed() {
        let fixture = Fixture::new("tsserver-directory");
        fs::create_dir_all(fixture.0.join("node_modules/typescript/lib/tsserver.js"))
            .expect("create tsserver directory");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_tsserver_fails_closed() {
        use std::os::unix::fs::PermissionsExt;

        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let fixture = Fixture::new("unreadable-tsserver");
        let server = fixture.tsserver(&fixture.0);
        let mut permissions = fs::metadata(&server)
            .expect("tsserver metadata")
            .permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&server, permissions).expect("make tsserver unreadable");

        let resolved = resolve_workspace_typescript(&fixture.0);
        let mut restored_permissions = fs::metadata(&server)
            .expect("tsserver metadata")
            .permissions();
        restored_permissions.set_mode(0o600);
        fs::set_permissions(&server, restored_permissions).expect("restore tsserver reads");

        assert_eq!(resolved, WorkspaceTypeScriptResolution::Absent);
    }

    #[test]
    fn no_workspace_typescript_reports_absent() {
        let fixture = Fixture::new("missing");

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[cfg(unix)]
    #[test]
    fn package_root_with_pnpm_store_above_workspace_reports_bounded_degraded_reason() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("package-root-pnpm-store");
        let package_root = fixture.0.join("packages/api");
        let store_package = fixture
            .0
            .join("node_modules/.pnpm/typescript@5.8.3/node_modules/typescript");
        let store_server = store_package.join("lib/tsserver.js");
        fs::create_dir_all(store_server.parent().expect("store server parent"))
            .expect("create store package");
        fs::write(&store_server, "module.exports = {};").expect("write store server");
        fs::create_dir_all(package_root.join("node_modules")).expect("create package node_modules");
        symlink(
            "../../../node_modules/.pnpm/typescript@5.8.3/node_modules/typescript",
            package_root.join("node_modules/typescript"),
        )
        .expect("link package TypeScript");

        assert_eq!(
            resolve_workspace_typescript(&package_root),
            WorkspaceTypeScriptResolution::OutsideRoot
        );
    }

    #[test]
    fn overlong_probe_candidate_is_missing_without_consuming_search() {
        let fixture = Fixture::new("overlong-probe");
        let authority =
            WorkspaceAuthority::capture(&fixture.0, 4_096).expect("workspace authority");
        let mut state = SearchState::new(SearchLimits {
            path_bytes: fixture.0.as_os_str().len() + 10,
            ..SearchLimits::PRODUCTION
        });

        assert!(matches!(
            state.probe(&authority, &fixture.0),
            SearchResult::Missing
        ));
        assert!(state.within_budget());
    }

    #[test]
    fn ancestor_depth_cap_is_enforced() {
        let fixture = Fixture::new("ancestor-cap");
        let ancestor = fixture.0.join("packages");
        let mut project = ancestor.clone();
        for index in 0..4 {
            project = project.join(format!("level-{index}"));
        }
        fs::create_dir_all(&project).expect("create deep project");
        fs::write(project.join("package.json"), r#"{"name":"deep"}"#)
            .expect("write deep package manifest");
        fixture.tsserver(&ancestor);
        let limits = SearchLimits {
            ancestor_depth: 2,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Truncated
        );
    }

    #[test]
    fn total_probe_cap_is_enforced() {
        let fixture = Fixture::new("probe-cap");
        for index in 0..4 {
            let package = fixture.0.join(format!("packages/package-{index}"));
            fs::create_dir_all(&package).expect("create package");
            fs::write(package.join("package.json"), r#"{"name":"package"}"#)
                .expect("write package manifest");
        }
        let winning_package = fixture.0.join("packages/package-3");
        fixture.tsserver(&winning_package);
        let limits = SearchLimits {
            probes: 3,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Truncated
        );
    }

    #[test]
    fn root_typescript_short_circuits_before_directory_enumeration() {
        let fixture = Fixture::new("directory-cap");
        let root_server = fixture.tsserver(&fixture.0);
        for index in 0..10 {
            fs::create_dir(fixture.0.join(format!("directory-{index}"))).expect("create directory");
        }
        let limits = SearchLimits {
            directory_entries: 1,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Found(
                root_server.canonicalize().expect("canonical root tsserver")
            )
        );
    }

    #[test]
    fn directory_enumeration_cap_preserves_package_found_before_cap() {
        let fixture = Fixture::new("directory-cap-package");
        fs::create_dir(fixture.0.join("z-first")).expect("create first directory");
        fs::create_dir(fixture.0.join("m-second")).expect("create second directory");
        let package = fixture.0.join("a-third");
        fs::create_dir_all(&package).expect("create package");
        fs::write(package.join("package.json"), r#"{"name":"api"}"#)
            .expect("write package manifest");
        let server = fixture.tsserver(&package);
        fs::create_dir(fixture.0.join("b-fourth")).expect("create fourth directory");
        let limits = SearchLimits {
            directory_entries: 1,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical package server")
            )
        );
    }

    #[test]
    fn build_output_directories_are_pruned_from_package_discovery() {
        let fixture = Fixture::new("pruned-build-output");
        let package = fixture.0.join("target/generated-package");
        fs::create_dir_all(&package).expect("create generated package");
        fs::write(package.join("package.json"), r#"{"name":"generated"}"#)
            .expect("write generated package manifest");
        fixture.tsserver(&package);

        assert_eq!(
            resolve_workspace_typescript(&fixture.0),
            WorkspaceTypeScriptResolution::Absent
        );
    }

    #[test]
    fn pending_directory_cap_reports_truncated_resolution() {
        let fixture = Fixture::new("pending-directory-cap");
        fs::create_dir(fixture.0.join("a")).expect("create first directory");
        fs::create_dir(fixture.0.join("b")).expect("create second directory");
        let limits = SearchLimits {
            pending_directories: 1,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Truncated
        );
    }

    #[test]
    fn regular_files_do_not_consume_directory_enumeration_cap() {
        let fixture = Fixture::new("regular-files");
        let package = fixture.0.join("packages/api");
        fs::create_dir_all(&package).expect("create package");
        fs::write(package.join("package.json"), r#"{"name":"api"}"#)
            .expect("write package manifest");
        let server = fixture.tsserver(&package);
        for index in 0..1_200 {
            fs::write(fixture.0.join(format!("sibling-{index}.ts")), "").expect("write sibling");
        }
        let limits = SearchLimits {
            directory_entries: 2,
            ..SearchLimits::PRODUCTION
        };

        assert_eq!(
            resolve_workspace_typescript_with_limits(&fixture.0, limits),
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical package server")
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_directory_is_skipped_without_discarding_discovered_package() {
        use std::os::unix::fs::PermissionsExt;

        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let fixture = Fixture::new("unreadable-directory");
        let denied = fixture.0.join("aaa-denied");
        fs::create_dir_all(&denied).expect("create denied directory");
        let package = fixture.0.join("packages/api");
        fs::create_dir_all(&package).expect("create package");
        fs::write(package.join("package.json"), r#"{"name":"api"}"#)
            .expect("write package manifest");
        let server = fixture.tsserver(&package);
        let mut permissions = fs::metadata(&denied)
            .expect("denied metadata")
            .permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&denied, permissions).expect("deny directory reads");

        let resolved = resolve_workspace_typescript(&fixture.0);
        let mut restored_permissions = fs::metadata(&denied)
            .expect("denied metadata")
            .permissions();
        restored_permissions.set_mode(0o700);
        fs::set_permissions(&denied, restored_permissions).expect("restore directory reads");

        assert_eq!(
            resolved,
            WorkspaceTypeScriptResolution::Found(
                server.canonicalize().expect("canonical package server")
            )
        );
    }

    #[test]
    #[ignore]
    fn current_repository_resolves_root_typescript_with_timing() {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        let expected = repository
            .join("node_modules/typescript/lib/tsserver.js")
            .canonicalize()
            .expect("repository root TypeScript");
        let started = std::time::Instant::now();
        let resolved = resolve_workspace_typescript(repository);
        let elapsed = started.elapsed();

        eprintln!("REAL_REPOSITORY_RESOLUTION={resolved:?} ELAPSED={elapsed:?}");
        assert_eq!(resolved, WorkspaceTypeScriptResolution::Found(expected));
    }
}
