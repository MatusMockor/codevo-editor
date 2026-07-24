use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageToolContext {
    root: PathBuf,
    target: PathBuf,
    target_directory: PathBuf,
}

impl PackageToolContext {
    pub fn resolve(root_path: &str, target_path: &str) -> Result<Self, String> {
        let root = fs::canonicalize(root_path)
            .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
        let requested = Path::new(target_path);
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            root.join(requested)
        };
        let target = resolve_target(&candidate)?;

        if target.strip_prefix(&root).is_err() {
            return Err("Tool target must stay inside the workspace root.".to_string());
        }

        let target_directory = target
            .parent()
            .ok_or_else(|| "Tool target has no parent directory.".to_string())?
            .to_path_buf();

        Ok(Self {
            root,
            target,
            target_directory,
        })
    }

    pub fn workspace_root(&self) -> &Path {
        &self.root
    }

    pub fn target(&self) -> &Path {
        &self.target
    }

    pub fn nearest_package_root(&self) -> &Path {
        self.ancestors()
            .find(|directory| directory.join("package.json").is_file())
            .unwrap_or(&self.root)
    }

    pub fn nearest_config_root<F>(&self, names: &[&str], manifest_matches: F) -> Option<&Path>
    where
        F: Fn(&Path) -> bool,
    {
        self.ancestors().find(|directory| {
            names.iter().any(|name| directory.join(name).is_file())
                || manifest_matches(&directory.join("package.json"))
        })
    }

    pub fn nearest_executable(&self, name: &str) -> Result<Option<PathBuf>, String> {
        let candidate = self
            .ancestors()
            .map(|directory| directory.join("node_modules").join(".bin").join(name))
            .find(|candidate| is_executable_file(candidate));
        let Some(candidate) = candidate else {
            return Ok(None);
        };

        let resolved = candidate
            .canonicalize()
            .map_err(|error| format!("Failed to resolve {name} binary: {error}"))?;
        if resolved.strip_prefix(&self.root).is_err() {
            return Err(format!(
                "Resolved {name} binary escapes the workspace root."
            ));
        }
        Ok(Some(resolved))
    }

    pub fn validated_ancestor_directory(&self, path: &str) -> Result<PathBuf, String> {
        let requested = Path::new(path);
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.root.join(requested)
        };
        let directory = candidate
            .canonicalize()
            .map_err(|error| format!("Failed to resolve package tool root: {error}"))?;
        if !directory.is_dir()
            || directory.strip_prefix(&self.root).is_err()
            || self.target.strip_prefix(&directory).is_err()
        {
            return Err(
                "Package tool root must be an ancestor of the target inside the workspace."
                    .to_string(),
            );
        }
        Ok(directory)
    }

    pub fn nearest_file_from(
        &self,
        start: &Path,
        relative_path: &Path,
    ) -> Result<Option<PathBuf>, String> {
        if start.strip_prefix(&self.root).is_err()
            || self.target.strip_prefix(start).is_err()
            || relative_path.is_absolute()
            || !relative_path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
        {
            return Err("Package dependency lookup is outside its safe context.".to_string());
        }

        for directory in start.ancestors() {
            if directory.strip_prefix(&self.root).is_err() {
                break;
            }
            let candidate = directory.join(relative_path);
            if candidate.is_file() {
                let resolved = candidate.canonicalize().map_err(|error| {
                    format!("Failed to resolve package dependency entry: {error}")
                })?;
                if resolved.strip_prefix(&self.root).is_err() {
                    return Err(
                        "Resolved package dependency entry escapes the workspace.".to_string()
                    );
                }
                return Ok(Some(resolved));
            }
            if directory == self.root {
                break;
            }
        }
        Ok(None)
    }

    pub fn target_relative_to(&self, directory: &Path) -> Result<PathBuf, String> {
        self.target
            .strip_prefix(directory)
            .map(Path::to_path_buf)
            .map_err(|_| "Tool target must stay inside its package context.".to_string())
    }

    fn ancestors(&self) -> impl Iterator<Item = &Path> {
        let root = self.root.as_path();
        self.target_directory
            .ancestors()
            .take_while(move |directory| directory.starts_with(root))
    }
}

fn resolve_target(candidate: &Path) -> Result<PathBuf, String> {
    if candidate.exists() {
        return candidate
            .canonicalize()
            .map_err(|error| format!("Failed to resolve tool target: {error}"));
    }

    let mut existing = candidate;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| "Tool target has no existing ancestor.".to_string())?;
    }
    let unresolved = candidate
        .strip_prefix(existing)
        .map_err(|_| "Tool target could not be resolved safely.".to_string())?;
    if !unresolved
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Tool target contains an unsafe path component.".to_string());
    }
    let existing = existing
        .canonicalize()
        .map_err(|error| format!("Failed to resolve tool target ancestor: {error}"))?;
    Ok(existing.join(unresolved))
}

pub fn safe_workspace_relative_target(path: &str) -> bool {
    !path.trim().is_empty()
        && !Path::new(path).is_absolute()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::PackageToolContext;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn workspace(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-tool-context-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("workspace");
        root
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().expect("parent")).expect("directory");
        fs::write(path, content).expect("file");
    }

    #[cfg(unix)]
    fn executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        write(path, "#!/bin/sh\n");
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("permissions");
    }

    #[test]
    fn resolves_sibling_and_nested_packages_without_crossing_contexts() {
        let root = workspace("siblings");
        write(&root.join("package.json"), "{}");
        write(&root.join("packages/a/package.json"), "{}");
        write(&root.join("packages/b/package.json"), "{}");
        write(&root.join("packages/a/nested/package.json"), "{}");
        write(&root.join("packages/a/nested/src/test.ts"), "");

        let context = PackageToolContext::resolve(
            root.to_str().expect("root"),
            "packages/a/nested/src/test.ts",
        )
        .expect("context");

        assert_eq!(
            context.nearest_package_root(),
            root.join("packages/a/nested")
                .canonicalize()
                .expect("canonical package")
        );
        assert_ne!(context.nearest_package_root(), root.join("packages/b"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn prefers_package_binary_and_falls_back_to_hoisted_root_binary() {
        let root = workspace("binary");
        write(&root.join("packages/a/package.json"), "{}");
        write(&root.join("packages/a/src/test.ts"), "");
        executable(&root.join("node_modules/.bin/vitest"));
        executable(&root.join("packages/a/node_modules/.bin/vitest"));

        let context =
            PackageToolContext::resolve(root.to_str().expect("root"), "packages/a/src/test.ts")
                .expect("context");
        assert_eq!(
            context.nearest_executable("vitest").expect("binary"),
            Some(
                root.join("packages/a/node_modules/.bin/vitest")
                    .canonicalize()
                    .expect("canonical")
            )
        );

        fs::remove_file(root.join("packages/a/node_modules/.bin/vitest")).expect("remove");
        assert_eq!(
            context.nearest_executable("vitest").expect("fallback"),
            Some(
                root.join("node_modules/.bin/vitest")
                    .canonicalize()
                    .expect("canonical")
            )
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_target_and_binary_symlinks_that_escape_the_workspace() {
        use std::os::unix::fs::symlink;

        let root = workspace("escape");
        let outside = workspace("outside");
        write(&outside.join("target.ts"), "");
        executable(&outside.join("eslint"));
        fs::create_dir_all(root.join("src")).expect("src");
        symlink(outside.join("target.ts"), root.join("src/target.ts")).expect("target link");
        assert!(
            PackageToolContext::resolve(root.to_str().expect("root"), "src/target.ts").is_err()
        );

        write(&root.join("src/inside.ts"), "");
        fs::create_dir_all(root.join("node_modules/.bin")).expect("bin");
        symlink(
            outside.join("eslint"),
            root.join("node_modules/.bin/eslint"),
        )
        .expect("binary link");
        let context = PackageToolContext::resolve(root.to_str().expect("root"), "src/inside.ts")
            .expect("context");
        assert!(context.nearest_executable("eslint").is_err());

        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }
}
