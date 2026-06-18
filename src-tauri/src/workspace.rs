use crate::ignore_matcher::{GitignoreWorkspaceIgnoreMatcher, WorkspaceIgnoreMatcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Write},
    path::Path,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileEntryKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileEntryKind {
    Directory,
    File,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextRange {
    pub start: WorkspaceTextPosition,
    pub end: WorkspaceTextPosition,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEdit {
    pub path: String,
    pub range: WorkspaceTextRange,
    pub new_text: String,
}

pub trait WorkspaceFileRepository {
    fn create_directory(&self, path: &Path) -> io::Result<()>;
    fn create_text_file(&self, path: &Path) -> io::Result<()>;
    fn delete_path(&self, path: &Path) -> io::Result<()>;
    fn read_directory(&self, path: &Path) -> io::Result<Vec<FileEntry>>;
    fn read_text_file(&self, path: &Path) -> io::Result<String>;
    fn rename_path(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn search_files(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> io::Result<Vec<FileSearchResult>>;
    fn write_text_file(&self, path: &Path, content: &str) -> io::Result<()>;
}

pub fn apply_text_edits_to_files(
    repository: &dyn WorkspaceFileRepository,
    edits: &[WorkspaceTextEdit],
    skipped_paths: &[String],
) -> io::Result<usize> {
    let skipped_paths: BTreeSet<String> = skipped_paths
        .iter()
        .map(|path| normalize_path_string(path))
        .collect();
    let mut edits_by_path: BTreeMap<String, Vec<WorkspaceTextEdit>> = BTreeMap::new();

    for edit in edits {
        let normalized_path = normalize_path_string(&edit.path);

        if skipped_paths.contains(&normalized_path) {
            continue;
        }

        edits_by_path
            .entry(normalized_path)
            .or_default()
            .push(edit.clone());
    }

    let mut changed_files = 0;

    for (path, edits) in edits_by_path {
        let path = Path::new(&path);
        let content = repository.read_text_file(path)?;
        let next_content = apply_text_edits_to_content(&content, &edits)?;

        if next_content != content {
            repository.write_text_file(path, &next_content)?;
            changed_files += 1;
        }
    }

    Ok(changed_files)
}

pub struct LocalWorkspaceFileRepository;

impl WorkspaceFileRepository for LocalWorkspaceFileRepository {
    fn create_directory(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::create_dir(path)
    }

    fn create_text_file(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map(|_| ())
    }

    fn delete_path(&self, path: &Path) -> io::Result<()> {
        if !path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Path does not exist",
            ));
        }

        if path.is_dir() {
            return fs::remove_dir_all(path);
        }

        fs::remove_file(path)
    }

    fn read_directory(&self, path: &Path) -> io::Result<Vec<FileEntry>> {
        if !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path is not a directory",
            ));
        }

        let mut entries = Vec::new();

        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();

            if name == ".git" {
                continue;
            }

            entries.push(FileEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                kind: file_entry_kind(&entry.metadata()?),
            });
        }

        entries.sort_by(|left, right| {
            let left_rank = match left.kind {
                FileEntryKind::Directory => 0,
                FileEntryKind::File => 1,
            };
            let right_rank = match right.kind {
                FileEntryKind::Directory => 0,
                FileEntryKind::File => 1,
            };

            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });

        Ok(entries)
    }

    fn read_text_file(&self, path: &Path) -> io::Result<String> {
        if !path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path is not a file",
            ));
        }

        fs::read_to_string(path)
    }

    fn rename_path(&self, from: &Path, to: &Path) -> io::Result<()> {
        if !from.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Source path does not exist",
            ));
        }

        if to.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Target path already exists",
            ));
        }

        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::rename(from, to)
    }

    fn search_files(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> io::Result<Vec<FileSearchResult>> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Root path is not a directory",
            ));
        }

        let normalized_query = query.trim().to_lowercase();
        let capped_limit = limit.clamp(1, 500);
        let scan_limit = capped_limit.saturating_mul(10).min(5_000);
        let mut results = Vec::new();

        let matcher = GitignoreWorkspaceIgnoreMatcher::load(root)?;
        collect_file_results(
            root,
            root,
            &normalized_query,
            scan_limit,
            &matcher,
            &mut results,
        )?;
        results.sort_by(|left, right| {
            score_result(&left.relative_path, &normalized_query)
                .cmp(&score_result(&right.relative_path, &normalized_query))
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        results.truncate(capped_limit);

        Ok(results)
    }

    fn write_text_file(&self, path: &Path, content: &str) -> io::Result<()> {
        if path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Cannot write text to a directory",
            ));
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)?;

        file.write_all(content.as_bytes())
    }
}

fn file_entry_kind(metadata: &fs::Metadata) -> FileEntryKind {
    if metadata.is_dir() {
        return FileEntryKind::Directory;
    }

    FileEntryKind::File
}

fn collect_file_results(
    root: &Path,
    current: &Path,
    query: &str,
    limit: usize,
    matcher: &dyn WorkspaceIgnoreMatcher,
    results: &mut Vec<FileSearchResult>,
) -> io::Result<()> {
    if results.len() >= limit {
        return Ok(());
    }

    for entry in fs::read_dir(current)? {
        if results.len() >= limit {
            return Ok(());
        }

        let entry = entry?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            continue;
        }

        if matcher.is_ignored(&path, file_type.is_dir()) {
            continue;
        }

        if file_type.is_dir() {
            collect_file_results(root, &path, query, limit, matcher, results)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if !query.is_empty() && !relative_path.to_lowercase().contains(query) {
            continue;
        }

        results.push(FileSearchResult {
            name,
            path: path.to_string_lossy().to_string(),
            relative_path,
        });
    }

    Ok(())
}

fn score_result(relative_path: &str, query: &str) -> usize {
    if query.is_empty() {
        return relative_path.matches('/').count();
    }

    let lower_path = relative_path.to_lowercase();

    if lower_path == query {
        return 0;
    }

    if lower_path.ends_with(query) {
        return 1;
    }

    lower_path.find(query).unwrap_or(usize::MAX - 1) + 2
}

fn apply_text_edits_to_content(content: &str, edits: &[WorkspaceTextEdit]) -> io::Result<String> {
    let mut indexed_edits = edits
        .iter()
        .map(|edit| {
            let start = byte_offset_for_utf16_position(content, &edit.range.start)?;
            let end = byte_offset_for_utf16_position(content, &edit.range.end)?;

            if start > end {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Workspace edit range starts after it ends",
                ));
            }

            Ok((start, end, edit.new_text.as_str()))
        })
        .collect::<io::Result<Vec<_>>>()?;

    indexed_edits.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));

    let mut next_content = content.to_string();
    let mut previous_start = content.len();

    for (start, end, new_text) in indexed_edits {
        if end > previous_start {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Workspace edit ranges overlap",
            ));
        }

        next_content.replace_range(start..end, new_text);
        previous_start = start;
    }

    Ok(next_content)
}

fn byte_offset_for_utf16_position(
    content: &str,
    position: &WorkspaceTextPosition,
) -> io::Result<usize> {
    let mut line = 0_u32;
    let mut character = 0_u32;

    for (byte_index, value) in content.char_indices() {
        if line == position.line && character == position.character {
            return Ok(byte_index);
        }

        if value == '\n' {
            line += 1;
            character = 0;
            continue;
        }

        character += value.len_utf16() as u32;
    }

    if line == position.line && character == position.character {
        return Ok(content.len());
    }

    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "Workspace edit position is outside of the document",
    ))
}

fn normalize_path_string(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_text_edits_to_files, LocalWorkspaceFileRepository, WorkspaceFileRepository,
        WorkspaceTextEdit, WorkspaceTextPosition, WorkspaceTextRange,
    };
    use std::{fs, time::SystemTime};

    #[test]
    fn read_directory_sorts_directories_before_files_and_shows_dependencies() {
        let root = create_temp_dir("workspace-directory");
        fs::create_dir(root.join(".git")).expect("create git");
        fs::create_dir(root.join("node_modules")).expect("create node modules");
        fs::create_dir(root.join("src")).expect("create src");
        fs::create_dir(root.join("vendor")).expect("create vendor");
        fs::write(root.join("README.md"), "hello").expect("write readme");
        fs::write(root.join("src").join("main.php"), "<?php").expect("write php");

        let repository = LocalWorkspaceFileRepository;
        let entries = repository.read_directory(&root).expect("read directory");

        let names = entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["node_modules", "src", "vendor", "README.md"]);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn read_and_write_text_file_round_trip() {
        let root = create_temp_dir("workspace-file");
        let file_path = root.join("note.txt");
        let repository = LocalWorkspaceFileRepository;

        repository
            .write_text_file(&file_path, "saved")
            .expect("write file");

        let content = repository.read_text_file(&file_path).expect("read file");

        assert_eq!(content, "saved");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn create_rename_and_delete_file() {
        let root = create_temp_dir("workspace-mutations");
        let file_path = root.join("draft.txt");
        let renamed_path = root.join("final.txt");
        let repository = LocalWorkspaceFileRepository;

        repository
            .create_text_file(&file_path)
            .expect("create file");
        assert!(file_path.exists());

        repository
            .rename_path(&file_path, &renamed_path)
            .expect("rename file");
        assert!(!file_path.exists());
        assert!(renamed_path.exists());

        repository
            .delete_path(&renamed_path)
            .expect("delete renamed file");
        assert!(!renamed_path.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn create_and_delete_directory() {
        let root = create_temp_dir("workspace-directory-mutations");
        let directory_path = root.join("src").join("Domain");
        let repository = LocalWorkspaceFileRepository;

        repository
            .create_directory(&directory_path)
            .expect("create directory");
        assert!(directory_path.is_dir());

        repository
            .delete_path(&root.join("src"))
            .expect("delete directory tree");
        assert!(!directory_path.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn search_files_filters_by_relative_path_and_skips_hidden_roots() {
        let root = create_temp_dir("workspace-search");
        fs::create_dir_all(root.join("src").join("Domain")).expect("create src");
        fs::create_dir_all(root.join("node_modules")).expect("create node_modules");
        fs::write(root.join("src").join("Domain").join("User.php"), "<?php").expect("write php");
        fs::write(root.join("node_modules").join("User.php"), "<?php").expect("write hidden php");
        fs::write(root.join("README.md"), "hello").expect("write readme");

        let repository = LocalWorkspaceFileRepository;
        let results = repository
            .search_files(&root, "user", 20)
            .expect("search files");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "src/Domain/User.php");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn search_files_respects_gitignore_patterns() {
        let root = create_temp_dir("workspace-search-gitignore");
        fs::write(root.join(".gitignore"), "generated/\n*.cache\n").expect("write gitignore");
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::create_dir_all(root.join("generated")).expect("create generated");
        fs::write(root.join("src").join("User.php"), "<?php").expect("write php");
        fs::write(root.join("generated").join("User.php"), "<?php").expect("write generated php");
        fs::write(root.join("User.cache"), "cache").expect("write cache");

        let repository = LocalWorkspaceFileRepository;
        let results = repository
            .search_files(&root, "user", 20)
            .expect("search files");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "src/User.php");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn apply_text_edits_to_files_updates_closed_files_and_skips_open_paths() {
        let root = create_temp_dir("workspace-text-edits");
        let closed_path = root.join("closed.ts");
        let open_path = root.join("open.ts");
        let repository = LocalWorkspaceFileRepository;
        fs::write(
            &closed_path,
            "const label = \"žena\";\nconsole.log(label);\n",
        )
        .expect("write closed");
        fs::write(&open_path, "const value = 1;\n").expect("write open");

        let changed = apply_text_edits_to_files(
            &repository,
            &[
                edit(&closed_path.to_string_lossy(), 0, 14, 0, 20, "\"človek\""),
                edit(&closed_path.to_string_lossy(), 1, 12, 1, 17, "name"),
                edit(&open_path.to_string_lossy(), 0, 14, 0, 15, "2"),
            ],
            &[open_path.to_string_lossy().to_string()],
        )
        .expect("apply edits");

        assert_eq!(changed, 1);
        assert_eq!(
            fs::read_to_string(&closed_path).expect("read closed"),
            "const label = \"človek\";\nconsole.log(name);\n",
        );
        assert_eq!(
            fs::read_to_string(&open_path).expect("read open"),
            "const value = 1;\n",
        );
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

    fn edit(
        path: &str,
        start_line: u32,
        start_character: u32,
        end_line: u32,
        end_character: u32,
        new_text: &str,
    ) -> WorkspaceTextEdit {
        WorkspaceTextEdit {
            path: path.to_string(),
            range: WorkspaceTextRange {
                start: WorkspaceTextPosition {
                    line: start_line,
                    character: start_character,
                },
                end: WorkspaceTextPosition {
                    line: end_line,
                    character: end_character,
                },
            },
            new_text: new_text.to_string(),
        }
    }
}
