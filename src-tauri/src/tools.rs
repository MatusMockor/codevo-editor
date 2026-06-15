use serde::Serialize;
use std::{env, fs, io, path::Path};

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
    if let Some(root) = workspace_root {
        if let Some(location) = find_workspace_vendor_tool(name, root) {
            return Some(location);
        }
    }

    find_path_tool(name)
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
    use super::{LocalPhpToolDetector, PhpToolDetector, ToolSource};
    use std::{fs, time::SystemTime};

    #[test]
    fn detects_workspace_vendor_phpactor_before_path() {
        let root = create_temp_dir("workspace-tools");
        let vendor_bin = root.join("vendor").join("bin");
        fs::create_dir_all(&vendor_bin).expect("create vendor bin");
        let phpactor_path = vendor_bin.join("phpactor");
        fs::write(&phpactor_path, "").expect("write phpactor");
        make_executable(&phpactor_path);

        let detector = LocalPhpToolDetector;
        let availability = detector.detect(Some(&root)).expect("detect tools");
        let phpactor = availability.phpactor.expect("phpactor location");

        assert!(phpactor.path.ends_with("vendor/bin/phpactor"));
        assert!(matches!(phpactor.source, ToolSource::WorkspaceVendorBin));
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
