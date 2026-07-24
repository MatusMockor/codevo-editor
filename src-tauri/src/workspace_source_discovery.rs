use crate::workspace_registry::{
    opened_root_path, validate_relative_path, WorkspaceId, WorkspaceRegistry,
};
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs::{File, Metadata};
use std::io::{self, Read};
use std::path::Path;
use tauri::State;

const MAX_FILES_CAP: usize = 2_000;
const MAX_VISITED_CAP: usize = 50_000;
const MAX_TEXT_BYTES_CAP: usize = 2 * 1024 * 1024;
const JAVASCRIPT_EXTENSIONS: &[&str] = &["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
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
pub(crate) struct WorkspaceJavaScriptSourceFileEnumeration {
    files: Vec<String>,
    truncated: bool,
    visited: usize,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum BoundedWorkspaceSourceRead {
    Ok { content: String },
    TooLarge,
    Changed,
}

#[tauri::command]
pub(crate) fn workspace_enumerate_js_source_files(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    max_files: usize,
    max_visited: usize,
) -> Result<WorkspaceJavaScriptSourceFileEnumeration, String> {
    let max_files = require_positive_limit(max_files, "maxFiles")?;
    let max_visited = require_positive_limit(max_visited, "maxVisited")?;
    let root = registry
        .clone_root(&workspace_id)
        .map_err(|error| error.to_string())?;
    enumerate_registered_js_source_files(&root, max_files, max_visited)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn workspace_read_source_text_bounded(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    max_bytes: usize,
) -> Result<BoundedWorkspaceSourceRead, String> {
    let max_bytes = require_positive_limit(max_bytes, "maxBytes")?;
    let path = Path::new(&relative_path);
    validate_relative_path(path).map_err(|error| error.to_string())?;
    let file = registry
        .open_descendant(&workspace_id, path)
        .map_err(|error| error.to_string())?;
    read_source_text_bounded(file, max_bytes).map_err(|error| error.to_string())
}

fn require_positive_limit(value: usize, field: &str) -> Result<usize, String> {
    if value == 0 {
        return Err(format!("{field} must be a positive integer."));
    }
    Ok(value)
}

fn enumerate_registered_js_source_files(
    root: &File,
    max_files: usize,
    max_visited: usize,
) -> io::Result<WorkspaceJavaScriptSourceFileEnumeration> {
    let root_path = opened_root_path(root)?;
    ensure_registered_root_identity(root, &root_path)?;
    let result = enumerate_js_source_files(&root_path, max_files, max_visited)?;
    if opened_root_path(root)? != root_path {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root moved during source discovery",
        ));
    }
    ensure_registered_root_identity(root, &root_path)?;
    Ok(result)
}

fn enumerate_js_source_files(
    root: &Path,
    requested_max_files: usize,
    requested_max_visited: usize,
) -> io::Result<WorkspaceJavaScriptSourceFileEnumeration> {
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

    let mut entries = builder.build();
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut exhausted = false;
    let mut truncated_by_files = false;
    while visited < max_visited {
        let Some(entry) = entries.next() else {
            exhausted = true;
            break;
        };
        let entry = entry.map_err(|error| io::Error::other(error.to_string()))?;
        visited += 1;
        if !entry.file_type().is_some_and(|kind| kind.is_file())
            || !is_javascript_source_file(entry.path())
        {
            continue;
        }
        if files.len() >= max_files {
            truncated_by_files = true;
            continue;
        }
        let relative = entry.path().strip_prefix(root).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "source file escaped workspace root",
            )
        })?;
        files.push(relative_path_string(relative)?);
    }

    let truncated_by_visits = !exhausted && entries.next().is_some();
    files.sort();
    Ok(WorkspaceJavaScriptSourceFileEnumeration {
        files,
        truncated: truncated_by_visits || truncated_by_files,
        visited,
    })
}

fn read_source_text_bounded(
    file: File,
    requested_max_bytes: usize,
) -> io::Result<BoundedWorkspaceSourceRead> {
    read_source_text_bounded_with_hook(file, requested_max_bytes, || {})
}

fn read_source_text_bounded_with_hook<F>(
    mut file: File,
    requested_max_bytes: usize,
    after_metadata: F,
) -> io::Result<BoundedWorkspaceSourceRead>
where
    F: FnOnce(),
{
    let max_bytes = requested_max_bytes.clamp(1, MAX_TEXT_BYTES_CAP);
    let before = file.metadata()?;
    if before.len() > max_bytes as u64 {
        return Ok(BoundedWorkspaceSourceRead::TooLarge);
    }
    after_metadata();

    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    if bytes.len() > max_bytes || after.len() > max_bytes as u64 {
        return Ok(BoundedWorkspaceSourceRead::TooLarge);
    }
    if !same_file_snapshot(&before, &after) {
        return Ok(BoundedWorkspaceSourceRead::Changed);
    }

    let content = String::from_utf8(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(BoundedWorkspaceSourceRead::Ok { content })
}

fn ensure_registered_root_identity(root: &File, path: &Path) -> io::Result<()> {
    let registered = root.metadata()?;
    let current = std::fs::metadata(path)?;
    if !same_file_identity(&registered, &current) || !current.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root identity changed",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn same_file_identity(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file_identity(_left: &Metadata, _right: &Metadata) -> bool {
    false
}

#[cfg(unix)]
fn same_file_snapshot(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    same_file_identity(left, right)
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_file_snapshot(_left: &Metadata, _right: &Metadata) -> bool {
    false
}

fn is_javascript_source_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") {
        return false;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| JAVASCRIPT_EXTENSIONS.contains(&extension))
}

fn relative_path_string(path: &Path) -> io::Result<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value.split('/').any(|part| part == "." || part == "..")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid workspace-relative source path",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Seek, SeekFrom, Write};
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
            "workspace-source-discovery-{name}-{}-{}",
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
    fn enumerates_all_supported_sources_deterministically_and_honors_ignore() {
        let root = fixture("order-ignore");
        write(&root, ".gitignore", "ignored/\n");
        for (index, extension) in JAVASCRIPT_EXTENSIONS.iter().enumerate() {
            write(&root, &format!("src/{index}.{extension}"), "export {};");
        }
        write(&root, "src/types.d.ts", "declare const value: string;");
        write(&root, "src/types.d.mts", "declare const value: string;");
        write(&root, "ignored/no.ts", "export {};");
        write(&root, "node_modules/pkg/no.js", "module.exports = {};");
        write(&root, "dist/no.js", "export {};");
        write(&root, "src/no.json", "{}");

        let result = enumerate_js_source_files(&root, 20, 100).expect("enumeration");

        assert_eq!(result.files.len(), JAVASCRIPT_EXTENSIONS.len());
        assert!(result.files.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(!result.truncated);
    }

    #[test]
    fn reports_file_and_visit_truncation_truthfully() {
        let root = fixture("truncation");
        write(&root, "only.ts", "export {};");
        let exact = enumerate_js_source_files(&root, 1, 100).expect("exact file cap");
        assert_eq!(exact.files, ["only.ts"]);
        assert!(!exact.truncated);

        write(&root, "two.ts", "export {};");
        let files = enumerate_js_source_files(&root, 1, 100).expect("file cap");
        assert_eq!(files.files.len(), 1);
        assert!(files.truncated);

        let visits = enumerate_js_source_files(&root, 20, 1).expect("visit cap");
        assert_eq!(visits.visited, 1);
        assert!(visits.truncated);
    }

    #[test]
    fn command_limits_reject_zero_instead_of_drifting_to_one() {
        assert_eq!(
            require_positive_limit(0, "maxFiles").unwrap_err(),
            "maxFiles must be a positive integer."
        );
        assert_eq!(require_positive_limit(1, "maxFiles").unwrap(), 1);
    }

    #[test]
    fn bounded_read_returns_ok_too_large_and_changed_without_overreading() {
        let root = fixture("bounded-read");
        write(&root, "small.ts", "1234");
        write(&root, "large.ts", "12345");
        assert_eq!(
            read_source_text_bounded(File::open(root.join("small.ts")).unwrap(), 4).unwrap(),
            BoundedWorkspaceSourceRead::Ok {
                content: "1234".to_string()
            }
        );
        assert_eq!(
            read_source_text_bounded(File::open(root.join("large.ts")).unwrap(), 4).unwrap(),
            BoundedWorkspaceSourceRead::TooLarge
        );

        let changed_path = root.join("small.ts");
        let changed = File::open(&changed_path).unwrap();
        assert_eq!(
            read_source_text_bounded_with_hook(changed, 4, || {
                let mut writer = File::options().write(true).open(&changed_path).unwrap();
                writer.seek(SeekFrom::Start(0)).unwrap();
                writer.write_all(b"5678").unwrap();
                writer.sync_all().unwrap();
            })
            .unwrap(),
            BoundedWorkspaceSourceRead::Changed
        );
    }

    #[cfg(unix)]
    #[test]
    fn enumeration_does_not_follow_directory_symlinks() {
        use std::os::unix::fs::symlink;
        let root = fixture("symlink");
        let outside = fixture("outside");
        write(&outside, "secret.ts", "export const secret = true;");
        symlink(&*outside, root.join("linked")).expect("symlink");
        assert!(enumerate_js_source_files(&root, 20, 100)
            .expect("enumeration")
            .files
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn registered_enumeration_stays_bound_to_the_retained_root() {
        let selected = fixture("selected");
        write(&selected, "original.ts", "export {};");
        let retained = File::open(&*selected).expect("open root");
        let moved = selected.with_extension("moved");
        fs::rename(&*selected, &moved).expect("move original root");
        fs::create_dir(&*selected).expect("replace selected path");
        write(&selected, "replacement.ts", "export {};");

        let result = enumerate_registered_js_source_files(&retained, 20, 100)
            .expect("registered enumeration");
        assert_eq!(result.files, ["original.ts"]);

        fs::remove_dir_all(&*selected).expect("remove replacement");
        fs::rename(&moved, &*selected).expect("restore selected root");
    }
}
