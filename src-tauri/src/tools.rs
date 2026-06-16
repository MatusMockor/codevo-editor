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
pub struct ToolLocation {
    pub executable: String,
    pub path: String,
    pub source: ToolSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolSource {
    Managed,
    WorkspaceVendorBin,
    Path,
}

pub trait PhpToolDetector {
    fn detect(&self, workspace_root: Option<&Path>) -> io::Result<PhpToolAvailability>;
}

pub struct LocalPhpToolDetector;

impl PhpToolDetector for LocalPhpToolDetector {
    fn detect(&self, workspace_root: Option<&Path>) -> io::Result<PhpToolAvailability> {
        Ok(PhpToolAvailability {
            phpactor: find_tool("phpactor", workspace_root),
            intelephense: find_tool("intelephense", workspace_root),
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

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Mockor Editor")
                .join("tools")
                .join("phpactor")
                .join("vendor")
                .join("bin"),
        );
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
    use super::{find_tool_with_managed_locations, ToolSource};
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
