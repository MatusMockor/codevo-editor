use serde::Serialize;
use serde_json::Value;
use std::{fs, io, path::Path};

pub trait ComposerMetadataDetector {
    fn detect(&self, root: &Path) -> io::Result<Option<ComposerProjectMetadata>>;
}

pub struct LocalComposerMetadataDetector;

impl ComposerMetadataDetector for LocalComposerMetadataDetector {
    fn detect(&self, root: &Path) -> io::Result<Option<ComposerProjectMetadata>> {
        let manifest_path = root.join("composer.json");

        if !manifest_path.is_file() {
            return Ok(None);
        }

        let manifest = read_json_file(&manifest_path, "composer.json")?;
        let mut packages = Vec::new();
        append_manifest_packages(&manifest, &mut packages);
        append_lock_packages(root, &mut packages)?;
        append_installed_packages(root, &mut packages)?;

        Ok(Some(ComposerProjectMetadata {
            classmap_roots: collect_classmap_roots(&manifest, false),
            packages,
            php_platform_version: composer_php_platform_version(&manifest),
            php_version_constraint: composer_php_version_constraint(&manifest),
            psr4_roots: collect_psr4_roots(&manifest, false),
            root_package_name: manifest
                .get("name")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        }))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerProjectMetadata {
    pub classmap_roots: Vec<ComposerClassmapRoot>,
    pub packages: Vec<ComposerPackageMetadata>,
    pub php_platform_version: Option<String>,
    pub php_version_constraint: Option<String>,
    pub psr4_roots: Vec<ComposerPsr4Root>,
    pub root_package_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerPsr4Root {
    pub dev: bool,
    pub namespace: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerClassmapRoot {
    pub dev: bool,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerPackageMetadata {
    pub classmap_roots: Vec<ComposerClassmapRoot>,
    pub dev: bool,
    pub install_path: Option<String>,
    pub name: String,
    pub package_type: Option<String>,
    pub psr4_roots: Vec<ComposerPsr4Root>,
    pub version: Option<String>,
}

fn append_lock_packages(
    root: &Path,
    packages: &mut Vec<ComposerPackageMetadata>,
) -> io::Result<()> {
    let lock_path = root.join("composer.lock");

    if !lock_path.is_file() {
        return Ok(());
    }

    let lock = read_json_file(&lock_path, "composer.lock")?;
    append_package_array(lock.get("packages"), false, packages);
    append_package_array(lock.get("packages-dev"), true, packages);
    Ok(())
}

fn append_installed_packages(
    root: &Path,
    packages: &mut Vec<ComposerPackageMetadata>,
) -> io::Result<()> {
    let installed_path = root.join("vendor").join("composer").join("installed.json");

    if !installed_path.is_file() {
        return Ok(());
    }

    let installed = read_json_file(&installed_path, "vendor/composer/installed.json")?;

    if installed.as_array().is_some() {
        append_package_array(Some(&installed), false, packages);
        return Ok(());
    }

    append_package_array(installed.get("packages"), false, packages);
    Ok(())
}

fn append_manifest_packages(manifest: &Value, packages: &mut Vec<ComposerPackageMetadata>) {
    append_manifest_package_map(manifest.get("require"), false, packages);
    append_manifest_package_map(manifest.get("require-dev"), true, packages);
}

fn append_manifest_package_map(
    value: Option<&Value>,
    dev: bool,
    packages: &mut Vec<ComposerPackageMetadata>,
) {
    let package_map = match value.and_then(Value::as_object) {
        Some(package_map) => package_map,
        None => return,
    };

    for (name, constraint) in package_map {
        if !is_composer_dependency_package_name(name) {
            continue;
        }

        merge_package(
            packages,
            ComposerPackageMetadata {
                classmap_roots: Vec::new(),
                dev,
                install_path: None,
                name: name.to_string(),
                package_type: None,
                psr4_roots: Vec::new(),
                version: constraint.as_str().map(ToString::to_string),
            },
        );
    }
}

fn is_composer_dependency_package_name(name: &str) -> bool {
    name.contains('/') && !name.starts_with("ext-") && !name.starts_with("lib-")
}

fn append_package_array(
    value: Option<&Value>,
    default_dev: bool,
    packages: &mut Vec<ComposerPackageMetadata>,
) {
    let array = match value.and_then(Value::as_array) {
        Some(array) => array,
        None => return,
    };

    for package in array {
        let metadata = match package_metadata(package, default_dev) {
            Some(metadata) => metadata,
            None => continue,
        };

        merge_package(packages, metadata);
    }
}

fn package_metadata(value: &Value, default_dev: bool) -> Option<ComposerPackageMetadata> {
    let name = match value.get("name").and_then(Value::as_str) {
        Some(name) => name.to_string(),
        None => return None,
    };
    let dev = value
        .get("dev_requirement")
        .and_then(Value::as_bool)
        .unwrap_or(default_dev);

    Some(ComposerPackageMetadata {
        classmap_roots: collect_classmap_roots(value, dev),
        dev,
        install_path: value
            .get("install-path")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        name,
        package_type: value
            .get("type")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        psr4_roots: collect_psr4_roots(value, dev),
        version: value
            .get("version")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn merge_package(packages: &mut Vec<ComposerPackageMetadata>, package: ComposerPackageMetadata) {
    let position = match packages
        .iter()
        .position(|existing| existing.name == package.name)
    {
        Some(position) => position,
        None => {
            packages.push(package);
            return;
        }
    };
    let existing = &mut packages[position];

    if existing.version.is_none() {
        existing.version = package.version.clone();
    }

    if existing.package_type.is_none() {
        existing.package_type = package.package_type.clone();
    }

    if existing.install_path.is_none() {
        existing.install_path = package.install_path.clone();
    }

    if package.dev {
        existing.dev = true;
    }

    if existing.psr4_roots.is_empty() {
        existing.psr4_roots = package.psr4_roots.clone();
    }

    if existing.classmap_roots.is_empty() {
        existing.classmap_roots = package.classmap_roots;
    }
}

fn collect_psr4_roots(composer: &Value, autoload_dev: bool) -> Vec<ComposerPsr4Root> {
    let mut roots = Vec::new();
    append_psr4_roots(composer, "autoload", autoload_dev, &mut roots);
    append_psr4_roots(composer, "autoload-dev", true, &mut roots);
    roots
}

fn append_psr4_roots(composer: &Value, key: &str, dev: bool, roots: &mut Vec<ComposerPsr4Root>) {
    let psr4 = match composer
        .get(key)
        .and_then(|autoload| autoload.get("psr-4"))
        .and_then(Value::as_object)
    {
        Some(psr4) => psr4,
        None => return,
    };

    for (namespace, paths) in psr4 {
        let paths = normalize_composer_paths(paths);

        if paths.is_empty() {
            continue;
        }

        roots.push(ComposerPsr4Root {
            dev,
            namespace: namespace.to_string(),
            paths,
        });
    }
}

fn collect_classmap_roots(composer: &Value, autoload_dev: bool) -> Vec<ComposerClassmapRoot> {
    let mut roots = Vec::new();
    append_classmap_roots(composer, "autoload", autoload_dev, &mut roots);
    append_classmap_roots(composer, "autoload-dev", true, &mut roots);
    roots
}

fn append_classmap_roots(
    composer: &Value,
    key: &str,
    dev: bool,
    roots: &mut Vec<ComposerClassmapRoot>,
) {
    let classmap = match composer
        .get(key)
        .and_then(|autoload| autoload.get("classmap"))
    {
        Some(classmap) => classmap,
        None => return,
    };
    let paths = normalize_composer_paths(classmap);

    if paths.is_empty() {
        return;
    }

    roots.push(ComposerClassmapRoot { dev, paths });
}

fn normalize_composer_paths(value: &Value) -> Vec<String> {
    if let Some(path) = value.as_str() {
        return vec![path.to_string()];
    }

    match value.as_array() {
        Some(paths) => paths
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
        None => Vec::new(),
    }
}

fn composer_php_version_constraint(composer: &Value) -> Option<String> {
    composer
        .get("require")
        .and_then(|require| require.get("php"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn composer_php_platform_version(composer: &Value) -> Option<String> {
    composer
        .get("config")
        .and_then(|config| config.get("platform"))
        .and_then(|platform| platform.get("php"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn read_json_file(path: &Path, label: &str) -> io::Result<Value> {
    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Invalid {label}: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{ComposerMetadataDetector, LocalComposerMetadataDetector};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn returns_none_when_composer_manifest_is_absent() {
        let root = temp_workspace("composer-absent");
        let detector = LocalComposerMetadataDetector;

        let metadata = detector.detect(&root).expect("detect composer");

        assert!(metadata.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_root_psr4_and_classmap_roots() {
        let root = temp_workspace("composer-root");
        fs::write(
            root.join("composer.json"),
            r#"{
              "name": "example/app",
              "require": { "php": "^8.3" },
              "config": { "platform": { "php": "8.3.7" } },
              "autoload": {
                "psr-4": { "App\\": "src/" },
                "classmap": "legacy/"
              },
              "autoload-dev": {
                "psr-4": { "Tests\\": ["tests/", "spec/"] },
                "classmap": ["fixtures/", "stubs/"]
              }
            }"#,
        )
        .expect("write composer");

        let metadata = LocalComposerMetadataDetector
            .detect(&root)
            .expect("detect composer")
            .expect("metadata");

        assert_eq!(metadata.root_package_name.as_deref(), Some("example/app"));
        assert_eq!(metadata.php_version_constraint.as_deref(), Some("^8.3"));
        assert_eq!(metadata.php_platform_version.as_deref(), Some("8.3.7"));
        assert_eq!(metadata.psr4_roots.len(), 2);
        assert_eq!(metadata.psr4_roots[0].namespace, "App\\");
        assert_eq!(metadata.psr4_roots[0].paths, vec!["src/"]);
        assert!(!metadata.psr4_roots[0].dev);
        assert_eq!(metadata.psr4_roots[1].paths, vec!["tests/", "spec/"]);
        assert!(metadata.psr4_roots[1].dev);
        assert_eq!(metadata.classmap_roots[0].paths, vec!["legacy/"]);
        assert_eq!(
            metadata.classmap_roots[1].paths,
            vec!["fixtures/", "stubs/"]
        );
        assert!(metadata.classmap_roots[1].dev);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn includes_root_manifest_require_packages_without_lock_or_vendor_metadata() {
        let root = temp_workspace("composer-root-packages");
        fs::write(
            root.join("composer.json"),
            r#"{
              "name": "custom/api",
              "require": {
                "php": "^8.3",
                "ext-json": "*",
                "laravel/framework": "^11.0"
              },
              "require-dev": {
                "phpunit/phpunit": "^11.0"
              }
            }"#,
        )
        .expect("write composer");

        let metadata = LocalComposerMetadataDetector
            .detect(&root)
            .expect("detect composer")
            .expect("metadata");

        assert_eq!(metadata.packages.len(), 2);
        assert_eq!(metadata.packages[0].name, "laravel/framework");
        assert_eq!(metadata.packages[0].version.as_deref(), Some("^11.0"));
        assert!(!metadata.packages[0].dev);
        assert_eq!(metadata.packages[1].name, "phpunit/phpunit");
        assert!(metadata.packages[1].dev);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_invalid_manifest_json() {
        let root = temp_workspace("composer-invalid");
        fs::write(root.join("composer.json"), "{").expect("write composer");

        let error = LocalComposerMetadataDetector
            .detect(&root)
            .expect_err("invalid composer");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("Invalid composer.json"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_lock_packages_and_dev_packages() {
        let root = temp_workspace("composer-lock");
        fs::write(root.join("composer.json"), r#"{ "name": "example/app" }"#)
            .expect("write composer");
        fs::write(
            root.join("composer.lock"),
            r#"{
              "packages": [
                {
                  "name": "vendor/package",
                  "version": "1.2.3",
                  "type": "library",
                  "autoload": {
                    "psr-4": { "Vendor\\Package\\": "src/" },
                    "classmap": ["legacy/"]
                  }
                }
              ],
              "packages-dev": [
                {
                  "name": "vendor/dev",
                  "version": "dev-main",
                  "autoload": { "psr-4": { "Vendor\\Dev\\": ["tests/", "spec/"] } }
                }
              ]
            }"#,
        )
        .expect("write lock");

        let metadata = LocalComposerMetadataDetector
            .detect(&root)
            .expect("detect composer")
            .expect("metadata");

        assert_eq!(metadata.packages.len(), 2);
        assert_eq!(metadata.packages[0].name, "vendor/package");
        assert_eq!(metadata.packages[0].version.as_deref(), Some("1.2.3"));
        assert_eq!(
            metadata.packages[0].package_type.as_deref(),
            Some("library")
        );
        assert!(!metadata.packages[0].dev);
        assert_eq!(
            metadata.packages[0].psr4_roots[0].namespace,
            "Vendor\\Package\\"
        );
        assert_eq!(
            metadata.packages[0].classmap_roots[0].paths,
            vec!["legacy/"]
        );
        assert_eq!(metadata.packages[1].name, "vendor/dev");
        assert!(metadata.packages[1].dev);
        assert_eq!(
            metadata.packages[1].psr4_roots[0].paths,
            vec!["tests/", "spec/"]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn merges_composer_two_installed_package_metadata() {
        let root = temp_workspace("composer-installed-object");
        fs::write(root.join("composer.json"), r#"{ "name": "example/app" }"#)
            .expect("write composer");
        fs::write(
            root.join("composer.lock"),
            r#"{
              "packages": [
                { "name": "vendor/package", "version": "1.2.3" }
              ]
            }"#,
        )
        .expect("write lock");
        fs::create_dir_all(root.join("vendor").join("composer")).expect("vendor composer");
        fs::write(
            root.join("vendor").join("composer").join("installed.json"),
            r#"{
              "packages": [
                {
                  "name": "vendor/package",
                  "install-path": "../vendor/package",
                  "dev_requirement": true,
                  "autoload": { "psr-4": { "Vendor\\Package\\": "src/" } }
                }
              ]
            }"#,
        )
        .expect("write installed");

        let metadata = LocalComposerMetadataDetector
            .detect(&root)
            .expect("detect composer")
            .expect("metadata");

        assert_eq!(metadata.packages.len(), 1);
        assert_eq!(
            metadata.packages[0].install_path.as_deref(),
            Some("../vendor/package")
        );
        assert!(metadata.packages[0].dev);
        assert_eq!(
            metadata.packages[0].psr4_roots[0].namespace,
            "Vendor\\Package\\"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_legacy_installed_package_array() {
        let root = temp_workspace("composer-installed-array");
        fs::write(root.join("composer.json"), r#"{ "name": "example/app" }"#)
            .expect("write composer");
        fs::create_dir_all(root.join("vendor").join("composer")).expect("vendor composer");
        fs::write(
            root.join("vendor").join("composer").join("installed.json"),
            r#"[
              {
                "name": "legacy/package",
                "version": "2.0.0",
                "install-path": "../legacy/package",
                "autoload": { "classmap": ["src/"] }
              }
            ]"#,
        )
        .expect("write installed");

        let metadata = LocalComposerMetadataDetector
            .detect(&root)
            .expect("detect composer")
            .expect("metadata");

        assert_eq!(metadata.packages.len(), 1);
        assert_eq!(metadata.packages[0].name, "legacy/package");
        assert_eq!(metadata.packages[0].classmap_roots[0].paths, vec!["src/"]);
        assert_eq!(
            metadata.packages[0].install_path.as_deref(),
            Some("../legacy/package")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{label}-{nanos}"));
        fs::create_dir_all(&path).expect("temp workspace");
        path.canonicalize().expect("canonical workspace")
    }
}
