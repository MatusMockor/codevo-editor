use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs::{DirEntry, FileType};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MAX_DIRECTORY_PATH_BYTES: usize = 4096;
const MAX_ENTRY_NAME_BYTES: usize = 255;
const MAX_DIRECTORY_ENTRIES: usize = 2000;
const MAX_SCANNED_DIRECTORY_ENTRIES: usize = MAX_DIRECTORY_ENTRIES * 20;

pub(crate) const HOME_DIRECTORY_UNAVAILABLE_ERROR: &str = "Home directory is not available.";
pub(crate) const DIRECTORY_PATH_TOO_LONG_ERROR: &str = "Directory path is too long.";
pub(crate) const DIRECTORY_PATH_NOT_ABSOLUTE_ERROR: &str = "Directory path must be absolute.";
pub(crate) const DIRECTORY_MISSING_ERROR: &str = "Directory does not exist.";
pub(crate) const DIRECTORY_NOT_A_DIRECTORY_ERROR: &str = "Path is not a directory.";
pub(crate) const DIRECTORY_PATH_NOT_UTF8_ERROR: &str = "Directory path is not valid UTF-8.";
pub(crate) const DIRECTORY_READ_FAILED_ERROR: &str = "Failed to read the directory.";
pub(crate) const DIRECTORY_OPEN_FAILED_ERROR: &str =
    "Failed to open the directory in the file manager.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListDirectoryEntriesRequest {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    include_files: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenDirectoryRequest {
    path: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DirectoryEntryKind {
    Directory,
    File,
    Symlink,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryEntry {
    name: String,
    kind: DirectoryEntryKind,
    hidden: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirectoryEntry>,
    truncated: bool,
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| DIRECTORY_PATH_NOT_UTF8_ERROR.to_string())
}

fn home_directory() -> Result<PathBuf, String> {
    let home =
        std::env::var_os("HOME").ok_or_else(|| HOME_DIRECTORY_UNAVAILABLE_ERROR.to_string())?;
    if home.is_empty() {
        return Err(HOME_DIRECTORY_UNAVAILABLE_ERROR.to_string());
    }

    Ok(PathBuf::from(home))
}

fn resolve_directory(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().len() > MAX_DIRECTORY_PATH_BYTES {
        return Err(DIRECTORY_PATH_TOO_LONG_ERROR.to_string());
    }

    if !path.is_absolute() {
        return Err(DIRECTORY_PATH_NOT_ABSOLUTE_ERROR.to_string());
    }

    let canonical = std::fs::canonicalize(path).map_err(|_| DIRECTORY_MISSING_ERROR.to_string())?;
    if !canonical.is_dir() {
        return Err(DIRECTORY_NOT_A_DIRECTORY_ERROR.to_string());
    }

    Ok(canonical)
}

fn entry_kind(file_type: &FileType) -> DirectoryEntryKind {
    if file_type.is_symlink() {
        return DirectoryEntryKind::Symlink;
    }

    if file_type.is_dir() {
        return DirectoryEntryKind::Directory;
    }

    DirectoryEntryKind::File
}

fn listable_entry_name(name: &OsStr) -> Option<String> {
    let name = name.to_str()?;
    if name.len() > MAX_ENTRY_NAME_BYTES {
        return None;
    }

    Some(name.to_string())
}

fn describe_entry(entry: &DirEntry, include_files: bool) -> Option<DirectoryEntry> {
    let name = listable_entry_name(&entry.file_name())?;
    let kind = entry_kind(&entry.file_type().ok()?);
    if !include_files && matches!(kind, DirectoryEntryKind::File) {
        return None;
    }

    Some(DirectoryEntry {
        hidden: name.starts_with('.'),
        name,
        kind,
    })
}

fn list_directory(path: Option<&Path>, include_files: bool) -> Result<DirectoryListing, String> {
    let requested = match path {
        Some(value) => value.to_path_buf(),
        None => home_directory()?,
    };
    let directory = resolve_directory(&requested)?;
    let reader =
        std::fs::read_dir(&directory).map_err(|_| DIRECTORY_READ_FAILED_ERROR.to_string())?;

    let mut entries: Vec<DirectoryEntry> = Vec::new();
    let mut truncated = false;
    for (scanned, entry) in reader.enumerate() {
        if scanned >= MAX_SCANNED_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|_| DIRECTORY_READ_FAILED_ERROR.to_string())?;
        let Some(described) = describe_entry(&entry, include_files) else {
            continue;
        };

        if entries.len() >= MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }

        entries.push(described);
    }

    entries.sort_by_cached_key(|entry| (entry.name.to_lowercase(), entry.name.clone()));

    let parent = match directory.parent() {
        Some(parent) => Some(path_to_string(parent)?),
        None => None,
    };

    Ok(DirectoryListing {
        path: path_to_string(&directory)?,
        parent,
        entries,
        truncated,
    })
}

#[tauri::command]
pub(crate) async fn list_directory_entries(
    request: ListDirectoryEntriesRequest,
) -> Result<DirectoryListing, String> {
    run_blocking_command(move || {
        list_directory(
            request.path.as_deref().map(Path::new),
            request.include_files,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn open_directory_in_file_manager(
    request: OpenDirectoryRequest,
    app: AppHandle,
) -> Result<(), String> {
    let target = run_blocking_command(move || {
        let directory = resolve_directory(Path::new(&request.path))?;
        path_to_string(&directory)
    })
    .await?;

    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|_| DIRECTORY_OPEN_FAILED_ERROR.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TempDirectory {
        path: PathBuf,
    }

    impl TempDirectory {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default();
            let sequence = TEMP_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "codevo-directory-listing-{label}-{}-{nanos}-{sequence}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create temp directory");

            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn child(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn entry_names(listing: &DirectoryListing) -> Vec<String> {
        listing
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect()
    }

    fn entry_kind_of(listing: &DirectoryListing, name: &str) -> DirectoryEntryKind {
        listing
            .entries
            .iter()
            .find(|entry| entry.name == name)
            .map(|entry| entry.kind)
            .expect("entry is present")
    }

    #[test]
    fn directories_are_listed_and_files_are_hidden_by_default() {
        let temp = TempDirectory::new("defaults");
        std::fs::create_dir(temp.child("beta")).expect("create directory");
        std::fs::create_dir(temp.child("Alpha")).expect("create directory");
        std::fs::write(temp.child("notes.txt"), b"x").expect("create file");

        let directories = list_directory(Some(temp.path()), false).expect("list directories");
        let everything = list_directory(Some(temp.path()), true).expect("list everything");

        assert_eq!(entry_names(&directories), vec!["Alpha", "beta"]);
        assert_eq!(entry_names(&everything), vec!["Alpha", "beta", "notes.txt"]);
        assert_eq!(
            entry_kind_of(&everything, "notes.txt"),
            DirectoryEntryKind::File
        );
        assert_eq!(
            entry_kind_of(&everything, "Alpha"),
            DirectoryEntryKind::Directory
        );
        assert!(!directories.truncated, "small directory is not truncated");
    }

    #[test]
    fn dot_prefixed_names_are_reported_as_hidden() {
        let temp = TempDirectory::new("hidden");
        std::fs::create_dir(temp.child(".config")).expect("create directory");
        std::fs::create_dir(temp.child("visible")).expect("create directory");

        let listing = list_directory(Some(temp.path()), false).expect("list directories");
        let hidden: Vec<(String, bool)> = listing
            .entries
            .iter()
            .map(|entry| (entry.name.clone(), entry.hidden))
            .collect();

        assert_eq!(
            hidden,
            vec![
                (".config".to_string(), true),
                ("visible".to_string(), false)
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_reported_without_following_their_target() {
        let temp = TempDirectory::new("symlink");
        let target = temp.child("target");
        std::fs::create_dir(&target).expect("create directory");
        std::fs::create_dir(target.join("inner")).expect("create nested directory");
        std::os::unix::fs::symlink(&target, temp.child("link")).expect("create symlink");
        std::os::unix::fs::symlink(temp.child("nowhere"), temp.child("broken"))
            .expect("create broken symlink");

        let listing = list_directory(Some(temp.path()), false).expect("list directories");

        assert_eq!(entry_names(&listing), vec!["broken", "link", "target"]);
        assert_eq!(entry_kind_of(&listing, "link"), DirectoryEntryKind::Symlink);
        assert_eq!(
            entry_kind_of(&listing, "broken"),
            DirectoryEntryKind::Symlink
        );
        assert!(
            !entry_names(&listing).contains(&"inner".to_string()),
            "symlink target contents must not be read"
        );
    }

    #[test]
    fn entry_collection_stops_at_the_bounded_maximum() {
        let temp = TempDirectory::new("bounded");
        for index in 0..(MAX_DIRECTORY_ENTRIES + 5) {
            std::fs::create_dir(temp.child(&format!("dir-{index:05}"))).expect("create directory");
        }

        let listing = list_directory(Some(temp.path()), false).expect("list directories");

        assert_eq!(listing.entries.len(), MAX_DIRECTORY_ENTRIES);
        assert!(listing.truncated, "excess entries must report truncation");
    }

    #[test]
    fn invalid_directory_paths_are_rejected() {
        let temp = TempDirectory::new("invalid");
        let file = temp.child("notes.txt");
        std::fs::write(&file, b"x").expect("create file");

        let missing = list_directory(Some(&temp.child("nowhere")), false)
            .expect_err("missing directory is refused");
        let relative = list_directory(Some(Path::new("relative/path")), false)
            .expect_err("relative path is refused");
        let file_path = list_directory(Some(&file), false).expect_err("file path is refused");
        let too_long = list_directory(
            Some(&PathBuf::from(format!("/{}", "a".repeat(5000)))),
            false,
        )
        .expect_err("oversized path is refused");

        assert_eq!(missing, DIRECTORY_MISSING_ERROR);
        assert_eq!(relative, DIRECTORY_PATH_NOT_ABSOLUTE_ERROR);
        assert_eq!(file_path, DIRECTORY_NOT_A_DIRECTORY_ERROR);
        assert_eq!(too_long, DIRECTORY_PATH_TOO_LONG_ERROR);
    }

    #[test]
    fn oversized_and_non_utf8_entry_names_are_skipped() {
        let oversized = "a".repeat(MAX_ENTRY_NAME_BYTES + 1);
        let limit = "a".repeat(MAX_ENTRY_NAME_BYTES);

        assert_eq!(
            listable_entry_name(OsStr::new(&limit)),
            Some(limit.clone()),
            "names at the limit stay listable"
        );
        assert_eq!(listable_entry_name(OsStr::new(&oversized)), None);

        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;

            assert_eq!(listable_entry_name(OsStr::from_bytes(&[0xff, 0xfe])), None);
        }
    }

    #[test]
    fn parent_is_present_below_the_root_and_absent_at_the_root() {
        let temp = TempDirectory::new("parent");
        let nested = temp.child("nested");
        std::fs::create_dir(&nested).expect("create directory");

        let root = list_directory(Some(Path::new("/")), false).expect("list root");
        let listing = list_directory(Some(&nested), false).expect("list nested directory");
        let canonical_parent = std::fs::canonicalize(temp.path()).expect("canonicalize temp");

        assert_eq!(root.parent, None);
        assert_eq!(
            listing.parent,
            Some(canonical_parent.to_string_lossy().to_string())
        );
        assert!(
            listing.path.ends_with("nested"),
            "listing reports the canonical path"
        );
    }

    #[test]
    fn a_missing_path_resolves_the_home_directory() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        if home.is_empty() {
            return;
        }
        let Ok(expected) = std::fs::canonicalize(PathBuf::from(&home)) else {
            return;
        };

        let listing = list_directory(None, false).expect("list home directory");

        assert_eq!(listing.path, expected.to_string_lossy().to_string());
    }

    #[test]
    fn requests_use_the_camel_case_wire_shape_and_reject_unknown_fields() {
        let listing = serde_json::from_value::<ListDirectoryEntriesRequest>(json!({
            "path": "/workspace/alpha",
            "includeFiles": true
        }))
        .expect("deserialize listing request");
        let defaulted = serde_json::from_value::<ListDirectoryEntriesRequest>(json!({}))
            .expect("deserialize defaulted request");
        let unknown = serde_json::from_value::<ListDirectoryEntriesRequest>(json!({
            "path": "/workspace/alpha",
            "extra": 1
        }));
        let open_unknown = serde_json::from_value::<OpenDirectoryRequest>(json!({
            "path": "/workspace/alpha",
            "extra": 1
        }));

        assert_eq!(listing.path.as_deref(), Some("/workspace/alpha"));
        assert!(listing.include_files, "includeFiles maps to include_files");
        assert_eq!(defaulted.path, None);
        assert!(!defaulted.include_files, "include_files defaults to false");
        assert!(unknown.is_err(), "unknown listing field must be rejected");
        assert!(open_unknown.is_err(), "unknown open field must be rejected");
    }

    #[test]
    fn listings_serialize_with_the_camel_case_wire_shape() {
        let listing = DirectoryListing {
            path: "/workspace/alpha".to_string(),
            parent: Some("/workspace".to_string()),
            entries: vec![DirectoryEntry {
                name: ".git".to_string(),
                kind: DirectoryEntryKind::Symlink,
                hidden: true,
            }],
            truncated: true,
        };

        let encoded = serde_json::to_value(&listing).expect("serialize listing");

        assert_eq!(encoded["path"], json!("/workspace/alpha"));
        assert_eq!(encoded["parent"], json!("/workspace"));
        assert_eq!(encoded["truncated"], json!(true));
        assert_eq!(encoded["entries"][0]["kind"], json!("symlink"));
        assert_eq!(encoded["entries"][0]["hidden"], json!(true));
    }
}
