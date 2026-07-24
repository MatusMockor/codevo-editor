use crate::workspace_registry::{
    opened_root_path, validate_relative_path, WorkspaceId, WorkspaceRegistry,
};
use ignore::WalkBuilder;
use serde::Serialize;
use std::io::{self, Read};
use std::path::Path;
use tauri::State;

const MAX_FILES_CAP: usize = 500;
const MAX_VISITED_CAP: usize = 50_000;
const MAX_TEXT_BYTES_CAP: usize = 2 * 1024 * 1024;
const EXCLUDED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    "coverage",
];

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTestFileEnumeration {
    files: Vec<String>,
    truncated: bool,
    visited: usize,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum BoundedWorkspaceTextRead {
    Ok { content: String },
    TooLarge,
}

#[tauri::command]
pub(crate) fn workspace_enumerate_js_test_files(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    max_files: usize,
    max_visited: usize,
) -> Result<WorkspaceTestFileEnumeration, String> {
    let root = registry
        .clone_root(&workspace_id)
        .map_err(|error| error.to_string())?;
    enumerate_registered_js_test_files(&root, max_files, max_visited)
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn enumerate_registered_js_test_files(
    root: &std::fs::File,
    max_files: usize,
    max_visited: usize,
) -> io::Result<WorkspaceTestFileEnumeration> {
    let before = opened_root_path(root)?;
    let result = enumerate_js_test_files(&before, max_files, max_visited)?;
    if opened_root_path(root)? != before {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root moved during test discovery",
        ));
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn workspace_read_text_file_bounded(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    max_bytes: usize,
) -> Result<BoundedWorkspaceTextRead, String> {
    let path = Path::new(&relative_path);
    validate_relative_path(path).map_err(|error| error.to_string())?;
    let file = registry
        .open_descendant(&workspace_id, path)
        .map_err(|error| error.to_string())?;
    read_text_bounded(file, max_bytes).map_err(|error| error.to_string())
}

fn enumerate_js_test_files(
    root: &Path,
    requested_max_files: usize,
    requested_max_visited: usize,
) -> io::Result<WorkspaceTestFileEnumeration> {
    let max_files = requested_max_files.clamp(1, MAX_FILES_CAP);
    let max_visited = requested_max_visited.clamp(1, MAX_VISITED_CAP);
    let mut builder = WalkBuilder::new(root);
    builder
        .follow_links(false)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(true)
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_some_and(|kind| kind.is_dir())
                || !entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| EXCLUDED_DIRECTORY_NAMES.contains(&name))
        })
        .sort_by_file_path(|left, right| left.cmp(right));
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut truncated = false;

    for entry in builder.build() {
        if visited >= max_visited {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|error| io::Error::other(error.to_string()))?;
        visited += 1;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) || !is_js_test_file(entry.path()) {
            continue;
        }
        if files.len() >= max_files {
            truncated = true;
            continue;
        }
        let relative = entry.path().strip_prefix(root).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "test file escaped workspace root",
            )
        })?;
        files.push(relative_path_string(relative)?);
    }
    files.sort();
    Ok(WorkspaceTestFileEnumeration {
        files,
        truncated,
        visited,
    })
}

fn read_text_bounded(
    mut file: std::fs::File,
    requested_max_bytes: usize,
) -> io::Result<BoundedWorkspaceTextRead> {
    let max_bytes = requested_max_bytes.clamp(1, MAX_TEXT_BYTES_CAP);
    if file.metadata()?.len() > max_bytes as u64 {
        return Ok(BoundedWorkspaceTextRead::TooLarge);
    }
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Ok(BoundedWorkspaceTextRead::TooLarge);
    }
    let content = String::from_utf8(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(BoundedWorkspaceTextRead::Ok { content })
}

fn is_js_test_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    const EXTENSIONS: &[&str] = &["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
    EXTENSIONS.iter().any(|extension| {
        name.ends_with(&format!(".test.{extension}"))
            || name.ends_with(&format!(".spec.{extension}"))
            || path
                .components()
                .any(|component| component.as_os_str() == "__tests__")
                && name.ends_with(&format!(".{extension}"))
    })
}

fn relative_path_string(path: &Path) -> io::Result<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.is_empty() || value.starts_with('/') || value.split('/').any(|part| part == "..") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid workspace-relative test path",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct Fixture(PathBuf);

    impl std::ops::Deref for Fixture {
        type Target = Path;

        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(name: &str) -> Fixture {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "workspace-test-discovery-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create fixture");
        Fixture(root)
    }

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, content).expect("write fixture");
    }

    #[test]
    fn enumerates_test_files_in_deterministic_order_and_honors_ignore() {
        let root = fixture("order-ignore");
        write(&root, ".gitignore", "ignored/\n");
        write(&root, "z/b.spec.ts", "test('b', () => {})");
        write(&root, "a/a.test.js", "test('a', () => {})");
        write(&root, "src/__tests__/plain.mjs", "test('plain', () => {})");
        write(&root, "ignored/no.test.js", "test('no', () => {})");
        write(&root, "node_modules/pkg/no.test.js", "test('no', () => {})");
        write(&root, "vendor/pkg/no.spec.js", "test('no', () => {})");
        write(&root, "dist/no.test.js", "test('no', () => {})");
        write(&root, "src/app.ts", "export {};");

        let result = enumerate_js_test_files(&root, 20, 100).expect("enumeration");

        assert_eq!(
            result.files,
            ["a/a.test.js", "src/__tests__/plain.mjs", "z/b.spec.ts"]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn reports_truthful_file_and_visit_truncation() {
        let root = fixture("truncation");
        for index in 0..5 {
            write(&root, &format!("{index}.test.js"), "test('x', () => {})");
        }
        let files = enumerate_js_test_files(&root, 2, 100).expect("file cap");
        assert_eq!(files.files.len(), 2);
        assert!(files.truncated);
        let visits = enumerate_js_test_files(&root, 20, 2).expect("visit cap");
        assert!(visits.truncated);
        assert_eq!(visits.visited, 2);
    }

    #[test]
    fn bounded_read_never_returns_content_past_the_hard_limit() {
        let root = fixture("bounded-read");
        write(&root, "small.test.js", "1234");
        write(&root, "large.test.js", "12345");
        let small = std::fs::File::open(root.join("small.test.js")).expect("small");
        let large = std::fs::File::open(root.join("large.test.js")).expect("large");
        assert_eq!(
            read_text_bounded(small, 4).expect("read"),
            BoundedWorkspaceTextRead::Ok {
                content: "1234".to_string()
            }
        );
        assert_eq!(
            read_text_bounded(large, 4).expect("read"),
            BoundedWorkspaceTextRead::TooLarge
        );
    }

    #[cfg(unix)]
    #[test]
    fn enumeration_does_not_follow_directory_symlinks() {
        use std::os::unix::fs::symlink;
        let root = fixture("symlink");
        let outside = fixture("outside");
        write(&outside, "secret.test.js", "test('secret', () => {})");
        symlink(&*outside, root.join("linked")).expect("symlink");
        assert!(enumerate_js_test_files(&root, 20, 100)
            .expect("enumeration")
            .files
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn registered_fd_enumeration_ignores_a_path_replacement() {
        let parent = fixture("replaced-parent");
        let original = parent.join("workspace");
        let moved = parent.join("moved-workspace");
        fs::create_dir_all(&original).expect("create workspace");
        write(&original, "original.test.js", "test('original', () => {})");
        let root_fd = std::fs::File::open(&original).expect("open registered root");
        fs::rename(&original, &moved).expect("move registered root");
        fs::create_dir_all(&original).expect("replace path");
        write(
            &original,
            "replacement.test.js",
            "test('replacement', () => {})",
        );

        let result = enumerate_registered_js_test_files(&root_fd, 20, 100).expect("fd enumeration");

        assert_eq!(result.files, ["original.test.js"]);
    }
}
