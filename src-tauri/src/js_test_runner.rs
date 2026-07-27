use crate::test_run_support::is_executable_file;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub(super) const MAX_PACKAGE_JSON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ANCESTORS: usize = 16;
const VITEST_CONFIG_FILES: [&str; 6] = [
    "vitest.config.ts",
    "vitest.config.js",
    "vitest.config.mts",
    "vitest.config.mjs",
    "vitest.config.cts",
    "vitest.config.cjs",
];
const JEST_CONFIG_FILES: [&str; 5] = [
    "jest.config.js",
    "jest.config.ts",
    "jest.config.cjs",
    "jest.config.mjs",
    "jest.config.json",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum JsTestRunner {
    Vitest(PathBuf),
    Jest(PathBuf),
}

#[cfg(test)]
pub(super) fn detect_runner(root: &Path) -> Result<Option<JsTestRunner>, String> {
    detect_runner_in_workspace(root, root, root)
}

pub(super) fn detect_runner_in_workspace(
    configuration_root: &Path,
    package_root_path: &Path,
    workspace_root: &Path,
) -> Result<Option<JsTestRunner>, String> {
    let package = read_package_json(configuration_root)?;
    if has_config_file(configuration_root, &VITEST_CONFIG_FILES) {
        return resolve_binary_in_workspace(
            configuration_root,
            package_root_path,
            workspace_root,
            "vitest",
        )
        .map(|binary| binary.map(JsTestRunner::Vitest));
    }
    if has_config_file(configuration_root, &JEST_CONFIG_FILES)
        || package
            .as_ref()
            .is_some_and(|package| package.get("jest").is_some())
    {
        return resolve_binary_in_workspace(
            configuration_root,
            package_root_path,
            workspace_root,
            "jest",
        )
        .map(|binary| binary.map(JsTestRunner::Jest));
    }
    if has_dependency(package.as_ref(), "vitest") {
        return resolve_binary_in_workspace(
            configuration_root,
            package_root_path,
            workspace_root,
            "vitest",
        )
        .map(|binary| binary.map(JsTestRunner::Vitest));
    }
    if has_dependency(package.as_ref(), "jest") {
        return resolve_binary_in_workspace(
            configuration_root,
            package_root_path,
            workspace_root,
            "jest",
        )
        .map(|binary| binary.map(JsTestRunner::Jest));
    }
    Ok(None)
}

fn read_package_json(root: &Path) -> Result<Option<Value>, String> {
    let path = root.join("package.json");
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to open package.json: {error}")),
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect package.json: {error}"))?;
    if metadata.len() > MAX_PACKAGE_JSON_BYTES {
        return Err(format!(
            "package.json exceeds the {MAX_PACKAGE_JSON_BYTES} byte safety limit."
        ));
    }
    let mut contents = Vec::with_capacity((metadata.len() as usize).min(64 * 1024));
    file.take(MAX_PACKAGE_JSON_BYTES + 1)
        .read_to_end(&mut contents)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    if contents.len() as u64 > MAX_PACKAGE_JSON_BYTES {
        return Err(format!(
            "package.json grew past the {MAX_PACKAGE_JSON_BYTES} byte safety limit while being read."
        ));
    }
    Ok(serde_json::from_slice(&contents).ok())
}

fn has_config_file(root: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| root.join(name).is_file())
}

fn has_dependency(package: Option<&Value>, name: &str) -> bool {
    let Some(package) = package else {
        return false;
    };
    ["dependencies", "devDependencies"].iter().any(|section| {
        package
            .get(section)
            .and_then(|dependencies| dependencies.get(name))
            .is_some()
    })
}

fn resolve_binary_in_workspace(
    configuration_root: &Path,
    package_root_path: &Path,
    workspace_root: &Path,
    name: &str,
) -> Result<Option<PathBuf>, String> {
    let canonical_workspace = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Failed to resolve JavaScript test workspace: {error}"))?;
    let canonical_configuration = fs::canonicalize(package_root_path)
        .map_err(|error| format!("Failed to resolve JavaScript test package root: {error}"))?;
    if !canonical_configuration.starts_with(&canonical_workspace) {
        return Err("JavaScript test package root escaped its workspace.".to_string());
    }
    let local_candidate = configuration_root
        .join("node_modules")
        .join(".bin")
        .join(name);
    if is_executable_file(&local_candidate) {
        return validated_runner_binary(&local_candidate, &canonical_workspace, name).map(Some);
    }
    if canonical_configuration == canonical_workspace {
        return Ok(None);
    }
    let mut current = canonical_configuration.parent().map(Path::to_path_buf);
    for _ in 0..MAX_ANCESTORS {
        let Some(root) = current else {
            return Ok(None);
        };
        let canonical_root = fs::canonicalize(&root)
            .map_err(|error| format!("Failed to resolve JavaScript test package root: {error}"))?;
        if !canonical_root.starts_with(&canonical_workspace) {
            return Ok(None);
        }
        let candidate = root.join("node_modules").join(".bin").join(name);
        if is_executable_file(&candidate) {
            return validated_runner_binary(&candidate, &canonical_workspace, name).map(Some);
        }
        if canonical_root == canonical_workspace {
            return Ok(None);
        }
        current = canonical_root.parent().map(Path::to_path_buf);
    }
    Err("JavaScript test runner lookup exceeded its workspace ancestor limit.".to_string())
}

fn validated_runner_binary(
    candidate: &Path,
    canonical_workspace: &Path,
    name: &str,
) -> Result<PathBuf, String> {
    let binary = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {name} binary: {error}"))?;
    if !binary.starts_with(canonical_workspace) {
        return Err("JavaScript test runner escaped its workspace.".to_string());
    }
    Ok(binary)
}
