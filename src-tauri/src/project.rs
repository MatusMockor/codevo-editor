use crate::composer::{
    ComposerClassmapRoot, ComposerMetadataDetector, ComposerPackageMetadata, ComposerPsr4Root,
    LocalComposerMetadataDetector,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::Path,
};

const NPM_PACKAGE_VERSION_FALLBACK_LIMIT: usize = 512;

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
    pub packages: Vec<NpmPackageDescriptor>,
    pub frameworks: Vec<String>,
    pub type_script_dependency_version: Option<String>,
    pub uses_type_script: bool,
    pub workspace_type_script_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmPackageDescriptor {
    pub name: String,
    pub dev: bool,
    pub declared_range: String,
    pub installed_version: Option<String>,
    pub install_path: Option<String>,
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
    let packages = package_json
        .as_ref()
        .map(|package_json| npm_package_descriptors(root, package_json))
        .unwrap_or_default();

    Some(JavaScriptTypeScriptProjectDescriptor {
        has_package_json,
        has_tsconfig,
        has_jsconfig,
        package_name,
        package_manager,
        packages,
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

fn npm_package_descriptors(root: &Path, package_json: &Value) -> Vec<NpmPackageDescriptor> {
    let node_modules = root.join("node_modules");
    let has_node_modules = node_modules.is_dir();
    let lock_versions = npm_package_lock_versions(&node_modules);
    let mut fallback_reads = 0;
    let mut packages = Vec::new();
    let mut names = BTreeSet::new();

    for (section_name, dev) in [
        ("dependencies", false),
        ("devDependencies", true),
        ("peerDependencies", false),
        ("optionalDependencies", false),
    ] {
        let Some(section) = package_json.get(section_name).and_then(Value::as_object) else {
            continue;
        };

        for (name, declared_range) in section {
            let Some(declared_range) = declared_range.as_str() else {
                continue;
            };
            if !names.insert(name.to_string()) {
                continue;
            }

            if !safe_npm_package_name(name) {
                packages.push(NpmPackageDescriptor {
                    name: name.to_string(),
                    dev,
                    declared_range: declared_range.to_string(),
                    installed_version: None,
                    install_path: None,
                });
                continue;
            }

            let install_directory = node_modules.join(name);
            let install_path = (has_node_modules && install_directory.is_dir())
                .then(|| install_directory.to_string_lossy().to_string());
            let installed_version = install_path.as_ref().and_then(|_| {
                if let Some(version) = lock_versions.get(name) {
                    return Some(version.clone());
                }

                if fallback_reads >= NPM_PACKAGE_VERSION_FALLBACK_LIMIT {
                    return None;
                }

                fallback_reads += 1;
                installed_npm_package_version(&install_directory)
            });

            packages.push(NpmPackageDescriptor {
                name: name.to_string(),
                dev,
                declared_range: declared_range.to_string(),
                installed_version,
                install_path,
            });
        }
    }

    packages
}

fn npm_package_lock_versions(node_modules: &Path) -> BTreeMap<String, String> {
    let Ok(source) = fs::read_to_string(node_modules.join(".package-lock.json")) else {
        return BTreeMap::new();
    };
    let Ok(lock) = serde_json::from_str::<Value>(&source) else {
        return BTreeMap::new();
    };
    let Some(packages) = lock.get("packages").and_then(Value::as_object) else {
        return BTreeMap::new();
    };
    let mut versions = BTreeMap::new();

    for (path, descriptor) in packages {
        let Some(name) = path.strip_prefix("node_modules/") else {
            continue;
        };
        if !safe_npm_package_name(name) {
            continue;
        }
        let Some(version) = descriptor
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|version| !version.is_empty())
        else {
            continue;
        };

        versions.insert(name.to_string(), version.to_string());
    }

    versions
}

fn safe_npm_package_name(name: &str) -> bool {
    if name.is_empty() || name.contains("..") || name.contains('\\') || name.starts_with('/') {
        return false;
    }

    let Some(first) = name.chars().next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() && !matches!(first, '@' | '_' | '.' | '-') {
        return false;
    }

    let slash_count = name.chars().filter(|character| *character == '/').count();
    if !name.starts_with('@') {
        return slash_count == 0;
    }
    if slash_count != 1 {
        return false;
    }

    let mut segments = name.split('/');
    let scope = segments.next().unwrap_or_default();
    let package = segments.next().unwrap_or_default();
    !scope.is_empty() && scope != "@" && !package.is_empty()
}

fn installed_npm_package_version(package_directory: &Path) -> Option<String> {
    let package_json = fs::read_to_string(package_directory.join("package.json")).ok()?;
    let package_json = serde_json::from_str::<Value>(&package_json).ok()?;

    package_json
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
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
    use super::{
        npm_package_descriptors, ComposerWorkspaceDetector, WorkspaceDetector,
        NPM_PACKAGE_VERSION_FALLBACK_LIMIT,
    };
    use serde_json::{json, Map, Value};
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
    fn detects_npm_package_descriptors() {
        let root = create_temp_dir("workspace-npm-packages");
        fs::write(
            root.join("package.json"),
            r#"{
              "dependencies": { "react": "^19.0.0" },
              "devDependencies": { "vitest": "^4.0.0" },
              "peerDependencies": { "typescript": ">=5" },
              "optionalDependencies": { "fsevents": "~2.3.3" }
            }"#,
        )
        .expect("write package");
        fs::create_dir_all(root.join("node_modules").join("react")).expect("create react package");
        fs::write(
            root.join("node_modules").join("react").join("package.json"),
            r#"{ "version": "19.1.0" }"#,
        )
        .expect("write installed package");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let packages = descriptor.js_ts.expect("js ts descriptor").packages;

        assert_eq!(packages.len(), 4);
        assert_eq!(packages[0].name, "react");
        assert!(!packages[0].dev);
        assert_eq!(packages[0].declared_range, "^19.0.0");
        assert_eq!(packages[0].installed_version.as_deref(), Some("19.1.0"));
        assert_eq!(
            packages[0].install_path.as_deref(),
            Some(
                root.join("node_modules")
                    .join("react")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_eq!(packages[1].name, "vitest");
        assert!(packages[1].dev);
        assert_eq!(packages[2].name, "typescript");
        assert!(!packages[2].dev);
        assert_eq!(packages[3].name, "fsevents");
        assert!(!packages[3].dev);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_declared_npm_packages_when_node_modules_is_missing() {
        let root = create_temp_dir("workspace-npm-missing-modules");
        fs::write(
            root.join("package.json"),
            r#"{ "dependencies": { "react": "^19.0.0" } }"#,
        )
        .expect("write package");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let packages = descriptor.js_ts.expect("js ts descriptor").packages;

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].installed_version, None);
        assert_eq!(packages[0].install_path, None);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_npm_dependency_names_that_traverse_outside_node_modules() {
        let root = create_temp_dir("workspace-npm-traversal");
        fs::create_dir_all(root.join("node_modules")).expect("create node modules");
        fs::create_dir_all(root.join("outside")).expect("create outside package");
        fs::write(
            root.join("outside").join("package.json"),
            r#"{ "version": "9.9.9" }"#,
        )
        .expect("write outside package");
        let package_json = json!({ "dependencies": { "../outside": "*" } });

        let packages = npm_package_descriptors(&root, &package_json);

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "../outside");
        assert_eq!(packages[0].installed_version, None);
        assert_eq!(packages[0].install_path, None);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reads_npm_versions_from_hidden_package_lock_then_falls_back_for_missing_names() {
        let root = create_temp_dir("workspace-npm-hidden-lock");
        let node_modules = root.join("node_modules");
        fs::create_dir_all(node_modules.join("locked")).expect("create locked package");
        fs::create_dir_all(node_modules.join("fallback")).expect("create fallback package");
        fs::write(
            node_modules.join(".package-lock.json"),
            r#"{
              "packages": {
                "node_modules/locked": { "version": "2.0.0" }
              }
            }"#,
        )
        .expect("write hidden lock");
        fs::write(
            node_modules.join("fallback").join("package.json"),
            r#"{ "version": "3.0.0" }"#,
        )
        .expect("write fallback package");
        let package_json = json!({
            "dependencies": {
                "fallback": "^3",
                "locked": "^2"
            }
        });

        let packages = npm_package_descriptors(&root, &package_json);

        let locked = packages
            .iter()
            .find(|package| package.name == "locked")
            .unwrap();
        let fallback = packages
            .iter()
            .find(|package| package.name == "fallback")
            .unwrap();
        assert_eq!(locked.installed_version.as_deref(), Some("2.0.0"));
        assert_eq!(fallback.installed_version.as_deref(), Some("3.0.0"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn caps_ordered_npm_package_json_fallback_reads() {
        let root = create_temp_dir("workspace-npm-fallback-cap");
        let node_modules = root.join("node_modules");
        let mut dependencies = Map::new();

        for index in 0..=NPM_PACKAGE_VERSION_FALLBACK_LIMIT {
            let name = format!("package-{index:03}");
            let directory = node_modules.join(&name);
            fs::create_dir_all(&directory).expect("create package directory");
            fs::write(
                directory.join("package.json"),
                format!(r#"{{ "version": "1.0.{index}" }}"#),
            )
            .expect("write package");
            dependencies.insert(name, Value::String("*".to_string()));
        }
        let package_json = json!({ "dependencies": dependencies });

        let packages = npm_package_descriptors(&root, &package_json);

        assert_eq!(
            packages[NPM_PACKAGE_VERSION_FALLBACK_LIMIT - 1]
                .installed_version
                .as_deref(),
            Some("1.0.511")
        );
        assert_eq!(
            packages[NPM_PACKAGE_VERSION_FALLBACK_LIMIT].installed_version,
            None
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_no_npm_packages_for_malformed_package_json() {
        let root = create_temp_dir("workspace-npm-malformed-package");
        fs::write(root.join("package.json"), "{").expect("write package");

        let detector = ComposerWorkspaceDetector::default();
        let descriptor = detector.detect(&root).expect("detect workspace");
        let packages = descriptor.js_ts.expect("js ts descriptor").packages;

        assert!(packages.is_empty());
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
