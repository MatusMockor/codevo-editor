use serde::Serialize;
use serde_json::Value;
use std::{fs, io, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDescriptor {
    pub root_path: String,
    pub php: Option<PhpProjectDescriptor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpProjectDescriptor {
    pub has_composer: bool,
    pub package_name: Option<String>,
    pub psr4_roots: Vec<Psr4Root>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Psr4Root {
    pub namespace: String,
    pub paths: Vec<String>,
    pub dev: bool,
}

pub trait WorkspaceDetector {
    fn detect(&self, root: &Path) -> io::Result<WorkspaceDescriptor>;
}

pub struct ComposerWorkspaceDetector;

impl WorkspaceDetector for ComposerWorkspaceDetector {
    fn detect(&self, root: &Path) -> io::Result<WorkspaceDescriptor> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Workspace root is not a directory",
            ));
        }

        let composer_path = root.join("composer.json");

        if !composer_path.is_file() {
            return Ok(WorkspaceDescriptor {
                root_path: root.to_string_lossy().to_string(),
                php: None,
            });
        }

        let composer = fs::read_to_string(composer_path)?;
        let composer: Value = serde_json::from_str(&composer).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid composer.json: {error}"),
            )
        })?;

        Ok(WorkspaceDescriptor {
            root_path: root.to_string_lossy().to_string(),
            php: Some(PhpProjectDescriptor {
                has_composer: true,
                package_name: composer
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                psr4_roots: collect_psr4_roots(&composer),
            }),
        })
    }
}

fn collect_psr4_roots(composer: &Value) -> Vec<Psr4Root> {
    let mut roots = Vec::new();
    append_psr4_roots(composer, "autoload", false, &mut roots);
    append_psr4_roots(composer, "autoload-dev", true, &mut roots);
    roots
}

fn append_psr4_roots(composer: &Value, key: &str, dev: bool, roots: &mut Vec<Psr4Root>) {
    let Some(psr4) = composer
        .get(key)
        .and_then(|autoload| autoload.get("psr-4"))
        .and_then(Value::as_object)
    else {
        return;
    };

    for (namespace, paths) in psr4 {
        roots.push(Psr4Root {
            namespace: namespace.to_string(),
            paths: normalize_composer_paths(paths),
            dev,
        });
    }
}

fn normalize_composer_paths(value: &Value) -> Vec<String> {
    if let Some(path) = value.as_str() {
        return vec![path.to_string()];
    }

    if let Some(paths) = value.as_array() {
        return paths
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect();
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{ComposerWorkspaceDetector, WorkspaceDetector};
    use std::{fs, time::SystemTime};

    #[test]
    fn detects_absence_of_php_composer_project() {
        let root = create_temp_dir("workspace-no-composer");
        let detector = ComposerWorkspaceDetector;

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
              "autoload": { "psr-4": { "App\\": "src/" } },
              "autoload-dev": { "psr-4": { "Tests\\": ["tests/", "spec/"] } }
            }"#,
        )
        .expect("write composer");

        let detector = ComposerWorkspaceDetector;
        let descriptor = detector.detect(&root).expect("detect workspace");
        let php = descriptor.php.expect("php descriptor");

        assert!(php.has_composer);
        assert_eq!(php.package_name.as_deref(), Some("example/app"));
        assert_eq!(php.psr4_roots.len(), 2);
        assert_eq!(php.psr4_roots[0].namespace, "App\\");
        assert!(!php.psr4_roots[0].dev);
        assert_eq!(php.psr4_roots[1].paths, vec!["tests/", "spec/"]);
        assert!(php.psr4_roots[1].dev);
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
