use crate::composer::{
    ComposerClassmapRoot, ComposerMetadataDetector, ComposerPackageMetadata, ComposerPsr4Root,
    LocalComposerMetadataDetector,
};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeSet, fs, io, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDescriptor {
    pub root_path: String,
    pub php: Option<PhpProjectDescriptor>,
    #[serde(rename = "javaScriptTypeScript")]
    pub js_ts: Option<JavaScriptTypeScriptProjectDescriptor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpProjectDescriptor {
    pub classmap_roots: Vec<ComposerClassmapRoot>,
    pub has_composer: bool,
    pub package_name: Option<String>,
    pub packages: Vec<ComposerPackageMetadata>,
    pub php_platform_version: Option<String>,
    pub php_version_constraint: Option<String>,
    pub psr4_roots: Vec<ComposerPsr4Root>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaScriptTypeScriptProjectDescriptor {
    pub has_package_json: bool,
    pub has_tsconfig: bool,
    pub has_jsconfig: bool,
    pub package_name: Option<String>,
    pub package_manager: Option<String>,
    pub frameworks: Vec<String>,
    pub type_script_dependency_version: Option<String>,
    pub uses_type_script: bool,
    pub workspace_type_script_version: Option<String>,
}

pub trait WorkspaceDetector {
    fn detect(&self, root: &Path) -> io::Result<WorkspaceDescriptor>;
}

pub struct ComposerWorkspaceDetector<D: ComposerMetadataDetector = LocalComposerMetadataDetector> {
    composer_detector: D,
}

impl ComposerWorkspaceDetector<LocalComposerMetadataDetector> {
    pub fn new() -> Self {
        Self {
            composer_detector: LocalComposerMetadataDetector,
        }
    }
}

impl Default for ComposerWorkspaceDetector<LocalComposerMetadataDetector> {
    fn default() -> Self {
        Self::new()
    }
}

impl<D: ComposerMetadataDetector> WorkspaceDetector for ComposerWorkspaceDetector<D> {
    fn detect(&self, root: &Path) -> io::Result<WorkspaceDescriptor> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Workspace root is not a directory",
            ));
        }

        let js_ts = detect_javascript_typescript_project(root);
        let php = self
            .composer_detector
            .detect(root)?
            .map(|metadata| PhpProjectDescriptor {
                classmap_roots: metadata.classmap_roots,
                has_composer: true,
                package_name: metadata.root_package_name,
                packages: metadata.packages,
                php_platform_version: metadata.php_platform_version,
                php_version_constraint: metadata.php_version_constraint,
                psr4_roots: metadata.psr4_roots,
            });

        Ok(WorkspaceDescriptor {
            root_path: root.to_string_lossy().to_string(),
            php,
            js_ts,
        })
    }
}

fn detect_javascript_typescript_project(
    root: &Path,
) -> Option<JavaScriptTypeScriptProjectDescriptor> {
    let package_json_path = root.join("package.json");
    let has_package_json = package_json_path.is_file();
    let has_tsconfig = root.join("tsconfig.json").is_file();
    let has_jsconfig = root.join("jsconfig.json").is_file();

    if !has_package_json && !has_tsconfig && !has_jsconfig {
        return None;
    }

    let package_json = if has_package_json {
        fs::read_to_string(package_json_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
    } else {
        None
    };
    let dependencies = package_json
        .as_ref()
        .map(package_dependency_names)
        .unwrap_or_default();
    let type_script_dependency_version = package_json
        .as_ref()
        .and_then(type_script_dependency_version);
    let workspace_type_script_version = workspace_type_script_version(root);
    let package_name = package_json
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let package_manager = package_json
        .as_ref()
        .and_then(|value| value.get("packageManager"))
        .and_then(Value::as_str)
        .and_then(package_manager_name)
        .or_else(|| package_manager_from_lockfile(root));

    Some(JavaScriptTypeScriptProjectDescriptor {
        has_package_json,
        has_tsconfig,
        has_jsconfig,
        package_name,
        package_manager,
        frameworks: detect_frameworks(&dependencies),
        type_script_dependency_version: type_script_dependency_version.clone(),
        uses_type_script: has_tsconfig
            || workspace_type_script_version.is_some()
            || type_script_dependency_version.is_some()
            || dependencies.contains("typescript")
            || dependencies.iter().any(|name| name.starts_with("@types/")),
        workspace_type_script_version,
    })
}

fn package_dependency_names(package_json: &Value) -> BTreeSet<String> {
    let mut dependencies = BTreeSet::new();

    for key in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(section) = package_json.get(key).and_then(Value::as_object) else {
            continue;
        };

        for name in section.keys() {
            dependencies.insert(name.to_string());
        }
    }

    dependencies
}

fn type_script_dependency_version(package_json: &Value) -> Option<String> {
    for key in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(section) = package_json.get(key).and_then(Value::as_object) else {
            continue;
        };
        let Some(version) = section.get("typescript").and_then(Value::as_str) else {
            continue;
        };
        let version = version.trim();

        if !version.is_empty() {
            return Some(version.to_string());
        }
    }

    None
}

fn workspace_type_script_version(root: &Path) -> Option<String> {
    let package_json_path = root
        .join("node_modules")
        .join("typescript")
        .join("package.json");
    let package_json = fs::read_to_string(package_json_path).ok()?;
    let package_json = serde_json::from_str::<Value>(&package_json).ok()?;
    package_json
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
}

fn package_manager_name(value: &str) -> Option<String> {
    value
        .split('@')
        .next()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn package_manager_from_lockfile(root: &Path) -> Option<String> {
    [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ]
    .into_iter()
    .find_map(|(file_name, package_manager)| {
        root.join(file_name)
            .is_file()
            .then(|| package_manager.to_string())
    })
}

fn detect_frameworks(dependencies: &BTreeSet<String>) -> Vec<String> {
    [
        ("next", "Next.js"),
        ("@remix-run/react", "Remix"),
        ("@sveltejs/kit", "SvelteKit"),
        ("nuxt", "Nuxt"),
        ("@angular/core", "Angular"),
        ("astro", "Astro"),
        ("@nestjs/core", "NestJS"),
        ("react", "React"),
        ("vue", "Vue"),
        ("svelte", "Svelte"),
        ("vite", "Vite"),
        ("express", "Express"),
        ("solid-js", "Solid"),
        ("preact", "Preact"),
    ]
    .into_iter()
    .filter_map(|(package_name, label)| {
        dependencies
            .contains(package_name)
            .then(|| label.to_string())
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::{ComposerWorkspaceDetector, WorkspaceDetector};
    use std::{fs, time::SystemTime};

    #[test]
    fn detects_absence_of_php_composer_project() {
        let root = create_temp_dir("workspace-no-composer");
        let detector = ComposerWorkspaceDetector::default();

        let descriptor = detector.detect(&root).expect("detect workspace");

        assert!(descriptor.php.is_none());
        assert!(descriptor.js_ts.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_composer_package_and_psr4_roots() {
        let root = create_temp_dir("workspace-composer");
        fs::write(
            root.join("composer.json"),
            r#"{
              "name": "example/app",
              "require": { "php": "^8.2" },
              "autoload": { "psr-4": { "App\\": "src/" } },
              "autoload-dev": { "psr-4": { "Tests\\": ["tests/", "spec/"] } }
            }"#,
        )
        .expect("write composer");

        fs::write(
            root.join("composer.lock"),
            r#"{
              "packages": [
                {
                  "name": "vendor/package",
                  "version": "1.2.3",
                  "autoload": { "psr-4": { "Vendor\\Package\\": "src/" } }
                }
              ]
            }"#,
        )
        .expect("write lock");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let php = descriptor.php.expect("php descriptor");

        assert!(descriptor.js_ts.is_none());
        assert!(php.has_composer);
        assert_eq!(php.package_name.as_deref(), Some("example/app"));
        assert_eq!(php.php_version_constraint.as_deref(), Some("^8.2"));
        assert_eq!(php.php_platform_version, None);
        assert_eq!(php.psr4_roots.len(), 2);
        assert_eq!(php.psr4_roots[0].namespace, "App\\");
        assert!(!php.psr4_roots[0].dev);
        assert_eq!(php.psr4_roots[1].paths, vec!["tests/", "spec/"]);
        assert!(php.psr4_roots[1].dev);
        assert_eq!(php.packages[0].name, "vendor/package");
        assert_eq!(php.packages[0].psr4_roots[0].namespace, "Vendor\\Package\\");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_javascript_typescript_package_metadata() {
        let root = create_temp_dir("workspace-js-ts-package");
        fs::write(
            root.join("package.json"),
            r#"{
              "name": "example-web",
              "packageManager": "pnpm@9.12.0",
              "dependencies": {
                "react": "^19.0.0",
                "vite": "^7.0.0"
              },
              "devDependencies": {
                "typescript": "^5.9.0"
              }
            }"#,
        )
        .expect("write package");
        fs::write(root.join("tsconfig.json"), "{}").expect("write tsconfig");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let js_ts = descriptor.js_ts.expect("js ts descriptor");

        assert!(descriptor.php.is_none());
        assert!(js_ts.has_package_json);
        assert!(js_ts.has_tsconfig);
        assert!(!js_ts.has_jsconfig);
        assert_eq!(js_ts.package_name.as_deref(), Some("example-web"));
        assert_eq!(js_ts.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(js_ts.frameworks, vec!["React", "Vite"]);
        assert_eq!(
            js_ts.type_script_dependency_version.as_deref(),
            Some("^5.9.0")
        );
        assert_eq!(js_ts.workspace_type_script_version, None);
        assert!(js_ts.uses_type_script);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_workspace_typescript_version_from_node_modules() {
        let root = create_temp_dir("workspace-js-ts-version");
        fs::write(root.join("package.json"), "{}").expect("write package");
        fs::create_dir_all(root.join("node_modules").join("typescript"))
            .expect("create typescript package");
        fs::write(
            root.join("node_modules")
                .join("typescript")
                .join("package.json"),
            r#"{ "name": "typescript", "version": "5.9.2" }"#,
        )
        .expect("write typescript package");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let js_ts = descriptor.js_ts.expect("js ts descriptor");

        assert_eq!(
            js_ts.workspace_type_script_version.as_deref(),
            Some("5.9.2")
        );
        assert!(js_ts.uses_type_script);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn detects_typescript_config_without_package_json() {
        let root = create_temp_dir("workspace-tsconfig-only");
        fs::write(root.join("tsconfig.json"), "{}").expect("write tsconfig");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let js_ts = descriptor.js_ts.expect("js ts descriptor");

        assert!(descriptor.php.is_none());
        assert!(!js_ts.has_package_json);
        assert!(js_ts.has_tsconfig);
        assert_eq!(js_ts.package_name, None);
        assert_eq!(js_ts.frameworks, Vec::<String>::new());
        assert!(js_ts.uses_type_script);
        fs::remove_dir_all(root).expect("cleanup");
    }

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
