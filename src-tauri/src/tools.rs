use serde::Serialize;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpToolAvailability {
    pub phpactor: Option<ToolLocation>,
    pub intelephense: Option<ToolLocation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaScriptTypeScriptToolAvailability {
    pub typescript_language_server: Option<ToolLocation>,
    pub typescript_server: Option<ToolLocation>,
    /// Location of the optional `@vue/typescript-plugin` package directory. When
    /// present it is loaded into the existing tsserver so `.vue` `<script>`
    /// blocks gain TypeScript intelligence; when absent `.vue` files keep
    /// highlighting only (no language-server features, no crash).
    pub vue_typescript_plugin: Option<ToolLocation>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JavaScriptTypeScriptToolPreference {
    Bundled,
    Workspace,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolLocation {
    pub executable: String,
    pub path: String,
    pub source: ToolSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolSource {
    BundledNodeModulesBin,
    Managed,
    WorkspaceNodeModulesBin,
    WorkspaceVendorBin,
    Path,
}

pub trait PhpToolDetector {
    fn detect(&self, workspace_root: Option<&Path>) -> io::Result<PhpToolAvailability>;
}

pub trait JavaScriptTypeScriptToolDetector {
    fn detect(
        &self,
        workspace_root: Option<&Path>,
        preference: JavaScriptTypeScriptToolPreference,
    ) -> io::Result<JavaScriptTypeScriptToolAvailability>;
}

pub struct LocalPhpToolDetector;
pub struct LocalJavaScriptTypeScriptToolDetector;

const MOCKOR_EDITOR_PHP_PATH: &str = "MOCKOR_EDITOR_PHP_PATH";

/// Resolves an absolute path to a `php` interpreter for launching the managed
/// PHPactor engine. Prefers an explicit `MOCKOR_EDITOR_PHP_PATH` override (so a
/// bundled/pinned PHP can be wired in later), then falls back to the first `php`
/// on `PATH`. Returns `None` when no interpreter can be resolved, letting callers
/// degrade to launching PHPactor directly.
pub fn php_executable_path() -> Option<String> {
    if let Some(path) = env::var_os(MOCKOR_EDITOR_PHP_PATH).map(PathBuf::from) {
        if is_executable_file(&path) {
            return Some(path.to_string_lossy().to_string());
        }
    }

    find_path_tool("php").map(|location| location.path)
}

impl PhpToolDetector for LocalPhpToolDetector {
    fn detect(&self, workspace_root: Option<&Path>) -> io::Result<PhpToolAvailability> {
        Ok(PhpToolAvailability {
            phpactor: find_tool("phpactor", workspace_root),
            intelephense: find_tool("intelephense", workspace_root),
        })
    }
}

impl JavaScriptTypeScriptToolDetector for LocalJavaScriptTypeScriptToolDetector {
    fn detect(
        &self,
        workspace_root: Option<&Path>,
        preference: JavaScriptTypeScriptToolPreference,
    ) -> io::Result<JavaScriptTypeScriptToolAvailability> {
        Ok(JavaScriptTypeScriptToolAvailability {
            typescript_language_server: find_javascript_typescript_tool(
                "typescript-language-server",
                workspace_root,
                preference,
            ),
            typescript_server: find_typescript_server(workspace_root, preference),
            vue_typescript_plugin: find_vue_typescript_plugin(workspace_root),
        })
    }
}

fn find_tool(name: &str, workspace_root: Option<&Path>) -> Option<ToolLocation> {
    let managed_override = env::var_os(managed_tool_env_var(name)).map(PathBuf::from);
    let managed_roots = managed_tool_roots();

    find_tool_with_managed_locations(
        name,
        workspace_root,
        managed_override.as_deref(),
        &managed_roots,
    )
}

fn find_javascript_typescript_tool(
    name: &str,
    workspace_root: Option<&Path>,
    preference: JavaScriptTypeScriptToolPreference,
) -> Option<ToolLocation> {
    let managed_override = env::var_os(managed_tool_env_var(name)).map(PathBuf::from);

    if matches!(preference, JavaScriptTypeScriptToolPreference::Workspace) {
        if let Some(root) = workspace_root {
            if let Some(location) = find_workspace_node_modules_tool(name, root) {
                return Some(location);
            }
        }
    }

    if let Some(location) = find_managed_tool(
        name,
        managed_override.as_deref(),
        &javascript_typescript_managed_tool_roots(),
    ) {
        return Some(location);
    }

    if let Some(location) = find_bundled_node_modules_tool(name) {
        return Some(location);
    }

    if matches!(preference, JavaScriptTypeScriptToolPreference::Bundled) {
        if let Some(root) = workspace_root {
            if let Some(location) = find_workspace_node_modules_tool(name, root) {
                return Some(location);
            }
        }
    }

    find_path_tool(name)
}

/// Locates the `@vue/typescript-plugin` package directory so it can be loaded
/// into the existing tsserver for `.vue` `<script>` TypeScript intelligence.
/// Prefers the workspace `node_modules` (so a project-pinned Vue toolchain wins)
/// and falls back to the bundled `node_modules`. Returns `None` when the plugin
/// is not installed, in which case `.vue` files degrade to highlighting only.
fn find_vue_typescript_plugin(workspace_root: Option<&Path>) -> Option<ToolLocation> {
    let mut candidates = Vec::new();

    if let Some(root) = workspace_root {
        candidates.push((
            root.join("node_modules"),
            ToolSource::WorkspaceNodeModulesBin,
        ));
    }

    candidates.extend(
        bundled_node_modules_roots()
            .into_iter()
            .map(|node_modules| (node_modules, ToolSource::BundledNodeModulesBin)),
    );

    candidates
        .into_iter()
        .find_map(|(node_modules, source)| {
            find_vue_typescript_plugin_in_node_modules(&node_modules, source)
        })
}

fn find_vue_typescript_plugin_in_node_modules(
    node_modules: &Path,
    source: ToolSource,
) -> Option<ToolLocation> {
    let plugin_dir = node_modules.join("@vue").join("typescript-plugin");

    plugin_dir
        .join("package.json")
        .is_file()
        .then(|| ToolLocation {
            // The plugin is a package directory loaded via `location`, not an
            // executable; `executable` is unused for plugin entries and only
            // carries the package name for provenance/debugging.
            executable: "@vue/typescript-plugin".to_string(),
            path: plugin_dir.to_string_lossy().to_string(),
            source,
        })
}

fn find_typescript_server(
    workspace_root: Option<&Path>,
    preference: JavaScriptTypeScriptToolPreference,
) -> Option<ToolLocation> {
    match preference {
        JavaScriptTypeScriptToolPreference::Workspace => workspace_root
            .and_then(find_workspace_typescript_server)
            .or_else(find_bundled_typescript_server),
        JavaScriptTypeScriptToolPreference::Bundled => find_bundled_typescript_server()
            .or_else(|| workspace_root.and_then(find_workspace_typescript_server)),
    }
}

fn find_tool_with_managed_locations(
    name: &str,
    workspace_root: Option<&Path>,
    managed_override: Option<&Path>,
    managed_roots: &[PathBuf],
) -> Option<ToolLocation> {
    if let Some(location) = find_managed_tool(name, managed_override, managed_roots) {
        return Some(location);
    }

    if let Some(root) = workspace_root {
        if let Some(location) = find_workspace_vendor_tool(name, root) {
            return Some(location);
        }
    }

    find_path_tool(name)
}

fn find_managed_tool(
    name: &str,
    managed_override: Option<&Path>,
    managed_roots: &[PathBuf],
) -> Option<ToolLocation> {
    if let Some(path) = managed_override {
        if is_executable_file(path) {
            return Some(tool_location(name, path.to_path_buf(), ToolSource::Managed));
        }
    }

    managed_roots.iter().find_map(|root| {
        executable_names(name).into_iter().find_map(|executable| {
            let path = root.join(&executable);

            is_executable_file(&path).then(|| ToolLocation {
                executable,
                path: path.to_string_lossy().to_string(),
                source: ToolSource::Managed,
            })
        })
    })
}

fn managed_tool_env_var(name: &str) -> String {
    format!(
        "MOCKOR_EDITOR_{}_PATH",
        name.replace('-', "_").to_ascii_uppercase()
    )
}

fn managed_tool_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    for home in managed_home_dirs() {
        if cfg!(unix) {
            roots.push(
                home.join("Library")
                    .join("Application Support")
                    .join("Mockor Editor")
                    .join("tools")
                    .join("phpactor")
                    .join("vendor")
                    .join("bin"),
            );
        }

        roots.push(
            home.join(".mockor-editor")
                .join("tools")
                .join("phpactor")
                .join("vendor")
                .join("bin"),
        );
    }

    roots
}

fn managed_home_dirs() -> Vec<PathBuf> {
    let mut homes = Vec::new();

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        homes.push(home);
    }

    if let Some(home) = env::var_os("USERPROFILE").map(PathBuf::from) {
        if !homes.contains(&home) {
            homes.push(home);
        }
    }

    homes
}

fn javascript_typescript_managed_tool_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Mockor Editor")
                .join("tools")
                .join("typescript-language-server")
                .join("node_modules")
                .join(".bin"),
        );
        roots.push(
            home.join(".mockor-editor")
                .join("tools")
                .join("typescript-language-server")
                .join("node_modules")
                .join(".bin"),
        );
    }

    roots
}

fn find_bundled_node_modules_tool(name: &str) -> Option<ToolLocation> {
    bundled_node_modules_bin_roots()
        .into_iter()
        .find_map(|root| {
            executable_names(name).into_iter().find_map(|executable| {
                let path = root.join(&executable);

                is_executable_file(&path).then(|| ToolLocation {
                    executable,
                    path: path.to_string_lossy().to_string(),
                    source: ToolSource::BundledNodeModulesBin,
                })
            })
        })
}

fn find_bundled_typescript_server() -> Option<ToolLocation> {
    bundled_node_modules_roots().into_iter().find_map(|root| {
        find_typescript_server_in_node_modules(&root, ToolSource::BundledNodeModulesBin)
    })
}

fn find_workspace_typescript_server(root: &Path) -> Option<ToolLocation> {
    find_typescript_server_in_node_modules(
        &root.join("node_modules"),
        ToolSource::WorkspaceNodeModulesBin,
    )
}

fn find_typescript_server_in_node_modules(
    node_modules_root: &Path,
    source: ToolSource,
) -> Option<ToolLocation> {
    let path = node_modules_root
        .join("typescript")
        .join("lib")
        .join("tsserver.js");

    path.is_file()
        .then(|| tool_location("tsserver.js", path, source))
}

fn bundled_node_modules_bin_roots() -> Vec<PathBuf> {
    bundled_node_modules_roots()
        .into_iter()
        .map(|root| root.join(".bin"))
        .collect()
}

fn bundled_node_modules_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        roots.push(current_dir.join("node_modules"));
    }

    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(workspace_root) = manifest_root.parent() {
        roots.push(workspace_root.join("node_modules"));
    }

    if let Ok(executable) = env::current_exe() {
        for ancestor in executable.ancestors().take(8) {
            roots.push(ancestor.join("node_modules"));
        }
    }

    roots
}

fn find_workspace_node_modules_tool(name: &str, root: &Path) -> Option<ToolLocation> {
    executable_names(name).into_iter().find_map(|executable| {
        let path = root.join("node_modules").join(".bin").join(&executable);

        is_executable_file(&path).then(|| ToolLocation {
            executable,
            path: path.to_string_lossy().to_string(),
            source: ToolSource::WorkspaceNodeModulesBin,
        })
    })
}

fn find_workspace_vendor_tool(name: &str, root: &Path) -> Option<ToolLocation> {
    executable_names(name).into_iter().find_map(|executable| {
        let path = root.join("vendor").join("bin").join(&executable);

        is_executable_file(&path).then(|| ToolLocation {
            executable,
            path: path.to_string_lossy().to_string(),
            source: ToolSource::WorkspaceVendorBin,
        })
    })
}

fn find_path_tool(name: &str) -> Option<ToolLocation> {
    let path_var = env::var_os("PATH")?;

    env::split_paths(&path_var).find_map(|directory| {
        executable_names(name).into_iter().find_map(|executable| {
            let path = directory.join(&executable);

            is_executable_file(&path).then(|| ToolLocation {
                executable,
                path: path.to_string_lossy().to_string(),
                source: ToolSource::Path,
            })
        })
    })
}

fn tool_location(name: &str, path: PathBuf, source: ToolSource) -> ToolLocation {
    ToolLocation {
        executable: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(name)
            .to_string(),
        path: path.to_string_lossy().to_string(),
        source,
    }
}

fn executable_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        return env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string())
            .split(';')
            .map(|extension| format!("{name}{extension}"))
            .chain(std::iter::once(name.to_string()))
            .collect();
    }

    vec![name.to_string()]
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };

    if !metadata.is_file() {
        return false;
    }

    is_executable_metadata(&metadata)
}

#[cfg(unix)]
fn is_executable_metadata(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_metadata(_metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{
        find_javascript_typescript_tool, find_tool_with_managed_locations, find_typescript_server,
        find_vue_typescript_plugin, find_vue_typescript_plugin_in_node_modules,
        JavaScriptTypeScriptToolPreference, ToolSource,
    };
    use std::{fs, time::SystemTime};

    #[test]
    fn detects_workspace_vendor_phpactor_when_managed_tools_are_absent() {
        let root = create_temp_dir("workspace-tools");
        let vendor_bin = root.join("vendor").join("bin");
        fs::create_dir_all(&vendor_bin).expect("create vendor bin");
        let phpactor_path = vendor_bin.join("phpactor");
        fs::write(&phpactor_path, "").expect("write phpactor");
        make_executable(&phpactor_path);

        let phpactor = find_tool_with_managed_locations("phpactor", Some(&root), None, &[])
            .expect("phpactor location");

        assert!(phpactor.path.ends_with("vendor/bin/phpactor"));
        assert!(matches!(phpactor.source, ToolSource::WorkspaceVendorBin));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_managed_phpactor_before_workspace_vendor_tool() {
        let root = create_temp_dir("workspace-tools-managed");
        let managed = create_temp_dir("managed-tools");
        let vendor_bin = root.join("vendor").join("bin");
        fs::create_dir_all(&vendor_bin).expect("create vendor bin");
        let vendor_phpactor_path = vendor_bin.join("phpactor");
        fs::write(&vendor_phpactor_path, "").expect("write vendor phpactor");
        make_executable(&vendor_phpactor_path);

        let managed_phpactor_path = managed.join("phpactor");
        fs::write(&managed_phpactor_path, "").expect("write managed phpactor");
        make_executable(&managed_phpactor_path);

        let phpactor = find_tool_with_managed_locations(
            "phpactor",
            Some(&root),
            Some(&managed_phpactor_path),
            &[],
        )
        .expect("phpactor location");

        assert_eq!(
            phpactor.path,
            managed_phpactor_path.to_string_lossy().to_string()
        );
        assert!(matches!(phpactor.source, ToolSource::Managed));

        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(managed).expect("cleanup managed");
    }

    #[test]
    fn workspace_preference_detects_workspace_typescript_language_server_first() {
        let root = create_temp_dir("workspace-typescript-language-server");
        let node_modules_bin = root.join("node_modules").join(".bin");
        fs::create_dir_all(&node_modules_bin).expect("create node_modules bin");
        let server_path = node_modules_bin.join("typescript-language-server");
        fs::write(&server_path, "").expect("write typescript language server");
        make_executable(&server_path);

        let server = find_javascript_typescript_tool(
            "typescript-language-server",
            Some(&root),
            JavaScriptTypeScriptToolPreference::Workspace,
        )
        .expect("typescript language server location");

        assert_eq!(server.path, server_path.to_string_lossy().to_string());
        assert!(matches!(server.source, ToolSource::WorkspaceNodeModulesBin));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn workspace_preference_detects_workspace_typescript_server_first() {
        let root = create_temp_dir("workspace-typescript-server");
        let typescript_lib = root.join("node_modules").join("typescript").join("lib");
        fs::create_dir_all(&typescript_lib).expect("create typescript lib");
        let server_path = typescript_lib.join("tsserver.js");
        fs::write(&server_path, "").expect("write tsserver");

        let server =
            find_typescript_server(Some(&root), JavaScriptTypeScriptToolPreference::Workspace)
                .expect("typescript server location");

        assert_eq!(server.path, server_path.to_string_lossy().to_string());
        assert!(matches!(server.source, ToolSource::WorkspaceNodeModulesBin));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_workspace_vue_typescript_plugin_directory() {
        let root = create_temp_dir("workspace-vue-typescript-plugin");
        let plugin_dir = root
            .join("node_modules")
            .join("@vue")
            .join("typescript-plugin");
        fs::create_dir_all(&plugin_dir).expect("create vue plugin dir");
        fs::write(plugin_dir.join("package.json"), "{}").expect("write plugin package.json");

        let plugin = find_vue_typescript_plugin(Some(&root)).expect("vue plugin location");

        assert_eq!(plugin.path, plugin_dir.to_string_lossy().to_string());
        assert!(matches!(plugin.source, ToolSource::WorkspaceNodeModulesBin));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn vue_typescript_plugin_keeps_bundled_provenance_source() {
        let bundled = create_temp_dir("bundled-vue-typescript-plugin");
        let plugin_dir = bundled.join("@vue").join("typescript-plugin");
        fs::create_dir_all(&plugin_dir).expect("create bundled vue plugin dir");
        fs::write(plugin_dir.join("package.json"), "{}").expect("write plugin package.json");

        let plugin =
            find_vue_typescript_plugin_in_node_modules(&bundled, ToolSource::BundledNodeModulesBin)
                .expect("bundled vue plugin location");

        assert_eq!(plugin.path, plugin_dir.to_string_lossy().to_string());
        assert!(matches!(plugin.source, ToolSource::BundledNodeModulesBin));
        fs::remove_dir_all(bundled).expect("cleanup");
    }

    #[test]
    fn missing_vue_typescript_plugin_in_node_modules_resolves_to_none() {
        let root = create_temp_dir("workspace-without-vue-plugin");
        let node_modules = root.join("node_modules");
        fs::create_dir_all(&node_modules).expect("create node_modules");

        // A node_modules tree without the plugin yields no location, so `.vue`
        // files degrade to highlighting only rather than crashing.
        assert!(find_vue_typescript_plugin_in_node_modules(
            &node_modules,
            ToolSource::WorkspaceNodeModulesBin,
        )
        .is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).expect("read metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("set executable permissions");
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &std::path::Path) {}

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{nanos}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }
}
