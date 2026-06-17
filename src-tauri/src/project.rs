use crate::composer::{
    ComposerClassmapRoot, ComposerMetadataDetector, ComposerPackageMetadata, ComposerPsr4Root,
    LocalComposerMetadataDetector,
};
use serde::Serialize;
use std::{io, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDescriptor {
    pub root_path: String,
    pub php: Option<PhpProjectDescriptor>,
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

        let metadata = match self.composer_detector.detect(root)? {
            Some(metadata) => metadata,
            None => {
                return Ok(WorkspaceDescriptor {
                    root_path: root.to_string_lossy().to_string(),
                    php: None,
                })
            }
        };

        Ok(WorkspaceDescriptor {
            root_path: root.to_string_lossy().to_string(),
            php: Some(PhpProjectDescriptor {
                classmap_roots: metadata.classmap_roots,
                has_composer: true,
                package_name: metadata.root_package_name,
                packages: metadata.packages,
                php_platform_version: metadata.php_platform_version,
                php_version_constraint: metadata.php_version_constraint,
                psr4_roots: metadata.psr4_roots,
            }),
        })
    }
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
