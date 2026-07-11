use crate::file_fuzzy_matcher::{compare_ranked_paths, file_match_rank, FileMatchRank};
use crate::local_history::LocalHistoryStore;
use crate::workspace_registry::{validate_relative_path, WorkspaceId, WorkspaceRegistry};
use crate::{search::TextSearchOptions, workspace::FileEntryKind};
use ignore::{gitignore::GitignoreBuilder, overrides::OverrideBuilder, Match};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    ffi::{CStr, CString, OsStr},
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    os::{
        fd::{AsRawFd, FromRawFd, IntoRawFd, RawFd},
        unix::ffi::OsStrExt,
    },
    path::{Path, PathBuf},
    sync::Arc,
};

const O_RESOLVE_BENEATH: libc::c_int = 0x0000_1000;
const RENAME_EXCL: libc::c_uint = 0x0000_0004;
const RENAME_SWAP: libc::c_uint = 0x0000_0002;
const WORKSPACE_FILE_SEARCH_VISITED_LIMIT: usize = 200_000;
pub const WORKSPACE_IMAGE_FILE_SIZE_LIMIT: usize = 20 * 1024 * 1024;

struct DirectoryEntry {
    name: String,
    is_directory: bool,
}

struct DirectoryStream(*mut libc::DIR);

impl Drop for DirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

fn open_directory_path(root: RawFd, path: &Path) -> io::Result<File> {
    if path.as_os_str().is_empty() {
        return open_directory_at(root, c".");
    }
    let mut current = unsafe_dup(root)?;
    for component in path.components() {
        let name = CString::new(component.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
        current = open_directory_at(current.as_raw_fd(), &name)?;
    }
    Ok(current)
}

fn unsafe_dup(fd: RawFd) -> io::Result<File> {
    let cloned = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if cloned < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(cloned) })
}

fn directory_entries(directory: &File) -> io::Result<Vec<DirectoryEntry>> {
    let cloned = unsafe_dup(directory.as_raw_fd())?;
    let stream = unsafe { libc::fdopendir(cloned.into_raw_fd()) };
    if stream.is_null() {
        return Err(io::Error::last_os_error());
    }
    let stream = DirectoryStream(stream);
    let mut entries = Vec::new();
    loop {
        unsafe {
            *libc::__error() = 0;
        }
        let raw = unsafe { libc::readdir(stream.0) };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(0) {
                return Ok(entries);
            }
            return Err(error);
        }
        let name = unsafe { CStr::from_ptr((*raw).d_name.as_ptr()) };
        if name.to_bytes() == b"." || name.to_bytes() == b".." {
            continue;
        }
        run_test_hook(
            "directory-entries-before-stat",
            directory.as_raw_fd(),
            name,
            name,
        );
        let stat = stat_at(directory.as_raw_fd(), name)?;
        let kind = stat.st_mode & libc::S_IFMT;
        if kind != libc::S_IFDIR && kind != libc::S_IFREG {
            continue;
        }
        entries.push(DirectoryEntry {
            name: String::from_utf8_lossy(name.to_bytes()).into_owned(),
            is_directory: kind == libc::S_IFDIR,
        });
    }
}

fn collect_files(
    root: &File,
    scope: &Path,
    scan_limit: usize,
    display_root: &Path,
) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let start = open_directory_path(root.as_raw_fd(), scope)?;
    let mut stack = vec![(
        scope.to_path_buf(),
        start,
        Vec::<Arc<ignore::gitignore::Gitignore>>::new(),
    )];
    let mut materialized = 0usize;
    while let Some((relative, directory, inherited_ignores)) = stack.pop() {
        let mut ignores = inherited_ignores;
        if let Some(local) = load_directory_gitignore(&directory, &display_root.join(&relative))? {
            ignores.push(Arc::new(local));
        }
        for entry in directory_entries(&directory)? {
            let path = relative.join(&entry.name);
            if crate::ignore_matcher::is_default_ignored_name(&entry.name)
                || gitignore_stack_ignores(&ignores, &display_root.join(&path), entry.is_directory)
            {
                continue;
            }
            materialized += 1;
            if materialized > 100_000 {
                return Err(io::Error::other(
                    "workspace search exceeded the 100000-entry safety limit",
                ));
            }
            if entry.is_directory {
                let name = CString::new(entry.name).unwrap();
                let child = open_directory_at(directory.as_raw_fd(), &name)?;
                stack.push((path, child, ignores.clone()));
            } else {
                files.push(path);
                if files.len() >= scan_limit {
                    return Ok(files);
                }
            }
        }
    }
    Ok(files)
}

fn collect_ranked_files(
    root: &File,
    scope: &Path,
    query: &str,
    limit: usize,
    visited_limit: usize,
    display_root: &Path,
) -> io::Result<Vec<(PathBuf, FileMatchRank)>> {
    let start = open_directory_path(root.as_raw_fd(), scope)?;
    let mut stack = vec![(
        scope.to_path_buf(),
        start,
        Vec::<Arc<ignore::gitignore::Gitignore>>::new(),
    )];
    let mut ranked = Vec::with_capacity(limit);
    let mut visited = 0usize;
    while let Some((relative, directory, inherited_ignores)) = stack.pop() {
        let mut ignores = inherited_ignores;
        if let Some(local) = load_directory_gitignore(&directory, &display_root.join(&relative))? {
            ignores.push(Arc::new(local));
        }
        for entry in directory_entries(&directory)? {
            let path = relative.join(&entry.name);
            if crate::ignore_matcher::is_default_ignored_name(&entry.name)
                || gitignore_stack_ignores(&ignores, &display_root.join(&path), entry.is_directory)
            {
                continue;
            }
            if visited >= visited_limit {
                return Ok(ranked);
            }
            visited += 1;
            if entry.is_directory {
                let name = CString::new(entry.name).unwrap();
                let child = open_directory_at(directory.as_raw_fd(), &name)?;
                stack.push((path, child, ignores.clone()));
                continue;
            }
            let Some(rank) = file_score(&path.to_string_lossy(), query) else {
                continue;
            };
            insert_ranked_path(&mut ranked, path, rank, limit);
        }
    }
    Ok(ranked)
}

fn insert_ranked_path(
    ranked: &mut Vec<(PathBuf, FileMatchRank)>,
    path: PathBuf,
    rank: FileMatchRank,
    limit: usize,
) {
    let index = ranked
        .binary_search_by(|(existing_path, existing_rank)| {
            compare_ranked_paths(
                &existing_path.to_string_lossy(),
                *existing_rank,
                &path.to_string_lossy(),
                rank,
            )
        })
        .unwrap_or_else(|index| index);
    ranked.insert(index, (path, rank));
    ranked.truncate(limit);
}

fn load_directory_gitignore(
    directory: &File,
    display_directory: &Path,
) -> io::Result<Option<ignore::gitignore::Gitignore>> {
    let mut file = match open_regular_at(directory.as_raw_fd(), c".gitignore", libc::O_RDONLY) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    let mut builder = GitignoreBuilder::new(display_directory);
    for line in content.lines() {
        builder.add_line(None, line).map_err(io::Error::other)?;
    }
    builder.build().map(Some).map_err(io::Error::other)
}

fn gitignore_stack_ignores(
    scopes: &[Arc<ignore::gitignore::Gitignore>],
    absolute: &Path,
    is_directory: bool,
) -> bool {
    let mut ignored = false;
    for scope in scopes {
        match scope.matched_path_or_any_parents(absolute, is_directory) {
            Match::Ignore(_) => ignored = true,
            Match::Whitelist(_) => ignored = false,
            Match::None => {}
        }
    }
    ignored
}

fn entry_rank(kind: &FileEntryKind) -> u8 {
    if matches!(kind, FileEntryKind::Directory) {
        0
    } else {
        1
    }
}
fn file_score(path: &str, query: &str) -> Option<FileMatchRank> {
    file_match_rank(path, query)
}
fn text_matcher(query: &str, options: &TextSearchOptions) -> io::Result<Regex> {
    let pattern = if options.is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if options.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

fn replace_text(
    matcher: &Regex,
    content: &str,
    replacement: &str,
    options: &TextSearchOptions,
) -> String {
    if !options.preserve_case {
        return replace_text_without_case_preservation(matcher, content, replacement, options);
    }

    if options.is_regex {
        return matcher
            .replace_all(content, |captures: &regex::Captures<'_>| {
                let mut expanded = String::new();
                captures.expand(replacement, &mut expanded);
                adapt_replacement_case(captures.get(0).unwrap().as_str(), &expanded)
            })
            .into_owned();
    }

    matcher
        .replace_all(content, |captures: &regex::Captures<'_>| {
            adapt_replacement_case(captures.get(0).unwrap().as_str(), replacement)
        })
        .into_owned()
}

fn replace_text_without_case_preservation(
    matcher: &Regex,
    content: &str,
    replacement: &str,
    options: &TextSearchOptions,
) -> String {
    if options.is_regex {
        return matcher.replace_all(content, replacement).into_owned();
    }

    matcher
        .replace_all(content, NoExpand(replacement))
        .into_owned()
}

fn adapt_replacement_case(matched: &str, replacement: &str) -> String {
    if is_all_upper(matched) {
        return replacement.to_uppercase();
    }

    if is_title_case(matched) {
        return capitalize_first_letter(replacement);
    }

    replacement.to_string()
}

fn is_all_upper(value: &str) -> bool {
    let letters: Vec<char> = value.chars().filter(|value| is_cased(*value)).collect();

    !letters.is_empty() && letters.iter().all(|value| value.is_uppercase())
}

fn is_title_case(value: &str) -> bool {
    let letters: Vec<char> = value.chars().filter(|value| is_cased(*value)).collect();
    if letters.is_empty() {
        return false;
    }

    letters[0].is_uppercase() && letters[1..].iter().all(|value| value.is_lowercase())
}

fn is_cased(value: char) -> bool {
    value.is_lowercase() || value.is_uppercase()
}

fn capitalize_first_letter(value: &str) -> String {
    let mut result = String::new();
    let mut capitalized = false;

    for character in value.chars() {
        if !capitalized && is_cased(character) {
            result.extend(character.to_uppercase());
            capitalized = true;
            continue;
        }

        result.push(character);
    }

    result
}
struct FileMask {
    matcher: ignore::overrides::Override,
    has_positive: bool,
}
fn file_mask(mask: &str, root: &Path) -> io::Result<Option<FileMask>> {
    let mut builder = OverrideBuilder::new(root);
    let mut any = false;
    let mut has_positive = false;
    for owned in split_file_masks(mask) {
        let item = owned.trim();
        any = true;
        has_positive |= !item.starts_with('!');
        builder.add(item).map_err(io::Error::other)?;
    }
    if any {
        builder
            .build()
            .map(|matcher| {
                Some(FileMask {
                    matcher,
                    has_positive,
                })
            })
            .map_err(io::Error::other)
    } else {
        Ok(None)
    }
}

fn split_file_masks(mask: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut brace_depth = 0usize;
    let mut escaped = false;
    for character in mask.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            current.push(character);
            escaped = true;
            continue;
        }
        if character == '{' {
            brace_depth += 1;
        }
        if character == '}' {
            brace_depth = brace_depth.saturating_sub(1);
        }
        if (character == ',' && brace_depth == 0) || character == '\n' {
            if !current.trim().is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(character);
    }
    if !current.trim().is_empty() {
        parts.push(current);
    }
    parts
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    device: u64,
    inode: u64,
    size: i64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    content_hash: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextFile {
    pub content: String,
    pub revision: FileRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImageFile {
    pub base64: String,
    pub byte_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkspaceImageReadError {
    Io { message: String },
    TooLarge { size: u64, max_bytes: usize },
}

impl From<io::Error> for WorkspaceImageReadError {
    fn from(error: io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFileEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileEntryKind,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFileSearchResult {
    pub name: String,
    pub relative_path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorTextSearchResult {
    pub relative_path: String,
    pub line_number: u64,
    pub column: u64,
    pub line_text: String,
    pub match_start: u64,
    pub match_end: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFileResult {
    pub relative_path: String,
    pub replacements: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFileFailure {
    pub relative_path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceReplaceResult {
    Success {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
    },
    Conflict {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        conflicts: Vec<ReplaceFileFailure>,
        message: String,
    },
    Partial {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        conflicts: Vec<ReplaceFileFailure>,
        errors: Vec<ReplaceFileFailure>,
        message: String,
    },
    Error {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        errors: Vec<ReplaceFileFailure>,
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FileCommandResult {
    Success {
        revision: Option<FileRevision>,
    },
    Conflict {
        message: String,
    },
    Partial {
        message: String,
        revision: Option<FileRevision>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MutationResult {
    Success,
    Partial { message: String },
    Error { message: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceEditResult {
    Success {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
    },
    Conflict {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    Partial {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    Error {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    NotFound {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
}

pub struct WorkspaceFileRepository<'a> {
    registry: &'a WorkspaceRegistry,
}

pub trait LocalHistorySnapshotSink {
    fn record_snapshot(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<(), String>;
}

impl LocalHistorySnapshotSink for LocalHistoryStore {
    fn record_snapshot(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<(), String> {
        LocalHistoryStore::record_snapshot(self, workspace_root, relative_path, content).map(|_| ())
    }
}

impl<'a> WorkspaceFileRepository<'a> {
    pub fn new(registry: &'a WorkspaceRegistry) -> Self {
        Self { registry }
    }

    pub fn read_text(&self, id: &WorkspaceId, path: &Path) -> io::Result<WorkspaceTextFile> {
        let root = self.registry.clone_root(id)?;
        for _ in 0..3 {
            let mut file = open_regular(root.as_raw_fd(), path, libc::O_RDONLY)?;
            let before = regular_unlinked_stat(file.as_raw_fd())?;
            let first = read_all(&mut file)?;
            let middle = regular_unlinked_stat(file.as_raw_fd())?;
            file.seek(SeekFrom::Start(0))?;
            let second = read_all(&mut file)?;
            let after = regular_unlinked_stat(file.as_raw_fd())?;
            if same_snapshot(&before, &middle) && same_snapshot(&middle, &after) && first == second
            {
                let content = String::from_utf8(first)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                return Ok(WorkspaceTextFile {
                    revision: revision(&after, content.as_bytes()),
                    content,
                });
            }
        }
        Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "file changed repeatedly while it was being read",
        ))
    }

    #[cfg(test)]
    fn read_image(
        &self,
        id: &WorkspaceId,
        path: &Path,
    ) -> Result<WorkspaceImageFile, WorkspaceImageReadError> {
        let root = self.registry.clone_root(id)?;
        read_image_from_root(&root, path)
    }

    pub fn read_directory(
        &self,
        id: &WorkspaceId,
        path: &Path,
    ) -> io::Result<Vec<DescriptorFileEntry>> {
        if !path.as_os_str().is_empty() {
            validate_relative_path(path)?;
        }
        let root = self.registry.clone_root(id)?;
        let directory = open_directory_path(root.as_raw_fd(), path)?;
        let mut entries = directory_entries(&directory)?
            .into_iter()
            .filter(|entry| entry.name != ".git")
            .map(|entry| DescriptorFileEntry {
                relative_path: entry.name.clone(),
                name: entry.name,
                kind: if entry.is_directory {
                    FileEntryKind::Directory
                } else {
                    FileEntryKind::File
                },
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            entry_rank(&left.kind)
                .cmp(&entry_rank(&right.kind))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn search_files(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
    ) -> io::Result<Vec<DescriptorFileSearchResult>> {
        let root = self.registry.clone_root(id)?;
        let display_root = self.registry.descriptor(id)?.canonical_root_path;
        let query = query.trim().to_lowercase();
        let limit = limit.clamp(1, 500);
        if !scope.as_os_str().is_empty() {
            validate_relative_path(scope)?;
        }
        let files = collect_ranked_files(
            &root,
            scope,
            &query,
            limit,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &display_root,
        )?;
        Ok(files
            .into_iter()
            .map(|(relative, _)| DescriptorFileSearchResult {
                name: relative
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                relative_path: relative
                    .strip_prefix(scope)
                    .unwrap_or(&relative)
                    .to_string_lossy()
                    .into_owned(),
            })
            .collect())
    }

    pub fn search_text(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
        options: &TextSearchOptions,
    ) -> io::Result<Vec<DescriptorTextSearchResult>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let matcher = text_matcher(query, options)?;
        let root = self.registry.clone_root(id)?;
        let display_root = self.registry.descriptor(id)?.canonical_root_path;
        if !scope.as_os_str().is_empty() {
            validate_relative_path(scope)?;
        }
        let limit = limit.clamp(1, 500);
        let masks = file_mask(options.file_mask.as_deref().unwrap_or(""), &display_root)?;
        let mut results = Vec::new();
        for relative in collect_files(&root, scope, 100_000, &display_root)? {
            if results.len() >= limit {
                break;
            }
            if let Some(mask) = &masks {
                let matched = mask.matcher.matched(&relative, false);
                if matched.is_ignore() || (mask.has_positive && !matched.is_whitelist()) {
                    continue;
                }
            }
            let file = open_regular(root.as_raw_fd(), &relative, libc::O_RDONLY)?;
            let mut bytes = Vec::new();
            if file
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .is_err()
                || bytes.len() > 4 * 1024 * 1024
                || bytes.contains(&0)
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "text search encountered an unreadable, binary, or oversized file",
                ));
            }
            let content = String::from_utf8(bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            for (index, line) in content.lines().enumerate() {
                if let Some(found) = matcher.find(line) {
                    results.push(DescriptorTextSearchResult {
                        relative_path: relative
                            .strip_prefix(scope)
                            .unwrap_or(&relative)
                            .to_string_lossy()
                            .into_owned(),
                        line_number: index as u64 + 1,
                        column: line[..found.start()].chars().count() as u64 + 1,
                        line_text: line.to_string(),
                        match_start: line[..found.start()].chars().count() as u64,
                        match_end: line[..found.end()].chars().count() as u64,
                    });
                    if results.len() >= limit {
                        return Ok(results);
                    }
                }
            }
        }
        Ok(results)
    }

    pub fn replace_in_path(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        replacement: &str,
        options: &TextSearchOptions,
    ) -> WorkspaceReplaceResult {
        match self.replace_candidates(id, scope, query, replacement, options, None) {
            Ok(result) => result,
            Err(error) => WorkspaceReplaceResult::Error {
                files: Vec::new(),
                total_replacements: 0,
                errors: Vec::new(),
                message: error.to_string(),
            },
        }
    }

    pub fn replace_in_path_with_snapshot_sink(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        replacement: &str,
        options: &TextSearchOptions,
        snapshot_sink: &dyn LocalHistorySnapshotSink,
    ) -> WorkspaceReplaceResult {
        match self.replace_candidates(id, scope, query, replacement, options, Some(snapshot_sink)) {
            Ok(result) => result,
            Err(error) => WorkspaceReplaceResult::Error {
                files: Vec::new(),
                total_replacements: 0,
                errors: Vec::new(),
                message: error.to_string(),
            },
        }
    }

    fn replace_candidates(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        replacement: &str,
        options: &TextSearchOptions,
        snapshot_sink: Option<&dyn LocalHistorySnapshotSink>,
    ) -> io::Result<WorkspaceReplaceResult> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(WorkspaceReplaceResult::Success {
                files: Vec::new(),
                total_replacements: 0,
            });
        }
        if !scope.as_os_str().is_empty() {
            validate_relative_path(scope)?;
        }
        let matcher = text_matcher(query, options)?;
        let root = self.registry.clone_root(id)?;
        let descriptor = self.registry.descriptor(id)?;
        let display_root = descriptor.canonical_root_path;
        let local_history_root = descriptor.selected_root_path;
        let exact_file = open_regular(root.as_raw_fd(), scope, libc::O_RDONLY).is_ok();
        let candidates = if exact_file {
            vec![scope.to_path_buf()]
        } else {
            // Ask for one beyond the traversal ceiling so a bounded batch never
            // silently reports success after changing only a prefix.
            collect_files(&root, scope, 100_001, &display_root)?
        };
        if candidates.len() > 100_000 {
            return Err(io::Error::other(
                "workspace replacement exceeded the 100000-file safety limit before making changes",
            ));
        }
        let masks = file_mask(options.file_mask.as_deref().unwrap_or(""), &display_root)?;
        let mut files = Vec::new();
        let mut conflicts = Vec::new();
        let mut errors = Vec::new();
        let mut total_replacements = 0u64;
        for relative in candidates {
            if !exact_file {
                if let Some(mask) = &masks {
                    let matched = mask.matcher.matched(&relative, false);
                    if matched.is_ignore() || (mask.has_positive && !matched.is_whitelist()) {
                        continue;
                    }
                }
            }
            let snapshot = match self.read_text(id, &relative) {
                Ok(snapshot)
                    if snapshot.content.len() <= 4 * 1024 * 1024
                        && !snapshot.content.as_bytes().contains(&0) =>
                {
                    snapshot
                }
                Ok(_) => {
                    errors.push(ReplaceFileFailure {
                        relative_path: relative.to_string_lossy().into_owned(),
                        message: "file is binary or exceeds the 4 MiB replacement limit".into(),
                    });
                    continue;
                }
                Err(error) => {
                    errors.push(ReplaceFileFailure {
                        relative_path: relative.to_string_lossy().into_owned(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let replacement_count = matcher.find_iter(&snapshot.content).count() as u64;
            if replacement_count == 0 {
                continue;
            }
            let updated = replace_text(&matcher, &snapshot.content, replacement, options);
            if updated == snapshot.content {
                continue;
            }
            match self.save_text(id, &relative, &updated, &snapshot.revision) {
                FileCommandResult::Success { .. } => {
                    if let Some(snapshot_sink) = snapshot_sink {
                        let workspace_root = local_history_root.to_string_lossy();
                        let relative_path = relative.to_string_lossy();
                        if let Err(error) = snapshot_sink.record_snapshot(
                            &workspace_root,
                            &relative_path,
                            &snapshot.content,
                        ) {
                            eprintln!("Local History snapshot failed: {error}");
                        }
                    }
                    total_replacements += replacement_count;
                    files.push(ReplaceFileResult {
                        relative_path: relative.to_string_lossy().into_owned(),
                        replacements: replacement_count,
                    });
                }
                FileCommandResult::Conflict { message } => conflicts.push(ReplaceFileFailure {
                    relative_path: relative.to_string_lossy().into_owned(),
                    message,
                }),
                FileCommandResult::Partial { message, .. }
                | FileCommandResult::Error { message } => errors.push(ReplaceFileFailure {
                    relative_path: relative.to_string_lossy().into_owned(),
                    message,
                }),
            }
        }
        if errors.is_empty() && conflicts.is_empty() {
            return Ok(WorkspaceReplaceResult::Success {
                files,
                total_replacements,
            });
        }
        if files.is_empty() && errors.is_empty() {
            return Ok(WorkspaceReplaceResult::Conflict {
                files,
                total_replacements,
                message: format!(
                    "{} file(s) changed concurrently; no conflicting file was overwritten",
                    conflicts.len()
                ),
                conflicts,
            });
        }
        if files.is_empty() && conflicts.is_empty() {
            return Ok(WorkspaceReplaceResult::Error {
                files,
                total_replacements,
                message: format!("replacement failed in {} file(s)", errors.len()),
                errors,
            });
        }
        Ok(WorkspaceReplaceResult::Partial {
            files,
            total_replacements,
            message: format!(
                "replacement completed partially: {} conflict(s), {} error(s)",
                conflicts.len(),
                errors.len()
            ),
            conflicts,
            errors,
        })
    }

    pub fn save_text(
        &self,
        id: &WorkspaceId,
        path: &Path,
        content: &str,
        expected: &FileRevision,
    ) -> FileCommandResult {
        match self.save_text_inner(id, path, content, expected) {
            Ok(revision) => FileCommandResult::Success {
                revision: Some(revision),
            },
            Err(CommandFailure::Conflict(message)) => FileCommandResult::Conflict { message },
            Err(CommandFailure::Partial(message, revision)) => {
                FileCommandResult::Partial { message, revision }
            }
            Err(CommandFailure::Io(error)) => FileCommandResult::Error {
                message: error.to_string(),
            },
        }
    }

    fn save_text_inner(
        &self,
        id: &WorkspaceId,
        path: &Path,
        content: &str,
        expected: &FileRevision,
    ) -> Result<FileRevision, CommandFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        let (parent_path, name) = split_path(path)?;
        let parent = open_parent(root.as_raw_fd(), parent_path)?;
        let target = open_regular_at(parent.as_raw_fd(), &name, libc::O_RDONLY)?;
        let original = regular_unlinked_stat(target.as_raw_fd())?;
        let original_bytes = read_all(&mut &target)?;
        if revision(&original, &original_bytes) != *expected {
            return Err(CommandFailure::Conflict(
                "file changed since it was read".into(),
            ));
        }

        let (mut staged, staged_name) =
            create_unique_file(parent.as_raw_fd(), &name, original.st_mode as libc::mode_t)?;
        let staged_identity = regular_unlinked_stat(staged.as_raw_fd())?;
        let mut cleanup = TempCleanup {
            parent: parent.as_raw_fd(),
            name: staged_name.clone(),
            expected: staged_identity,
            armed: true,
        };
        run_test_hook(
            "save-after-temp-create",
            parent.as_raw_fd(),
            &name,
            &staged_name,
        );
        let preparation = (|| -> Result<(), CommandFailure> {
            staged.write_all(content.as_bytes())?;
            copy_metadata(target.as_raw_fd(), staged.as_raw_fd())?;
            staged.sync_all()?;
            let current = stat_at(parent.as_raw_fd(), &name)?;
            if !same_identity(&original, &current) {
                return Err(CommandFailure::Conflict(
                    "file changed while it was being saved".into(),
                ));
            }
            let staged_name_stat = stat_at(parent.as_raw_fd(), &staged_name)?;
            if !same_identity(&staged_identity, &staged_name_stat) {
                return Err(CommandFailure::Conflict(
                    "temporary save file changed before the atomic swap".into(),
                ));
            }
            Ok(())
        })();
        if let Err(failure) = preparation {
            if let Err(message) = cleanup.finish_before_return() {
                return Err(CommandFailure::Partial(message, None));
            }
            return Err(failure);
        }
        if let Err(error) = rename_swap(parent.as_raw_fd(), &staged_name, &name) {
            if let Err(message) = cleanup.finish_before_return() {
                return Err(CommandFailure::Partial(message, None));
            }
            return Err(error.into());
        }
        let saved = regular_unlinked_stat(staged.as_raw_fd()).map_err(|error| {
            cleanup.armed = false;
            CommandFailure::Partial(
                format!(
                    "file was swapped, but the staged capability could not be validated: {error}"
                ),
                None,
            )
        })?;
        run_test_hook("save-after-swap", parent.as_raw_fd(), &name, &staged_name);
        let displaced = stat_at(parent.as_raw_fd(), &staged_name).map_err(|error| {
            cleanup.armed = false;
            CommandFailure::Partial(
                format!(
                    "file was swapped, but the displaced version could not be inspected: {error}"
                ),
                Some(revision(&saved, content.as_bytes())),
            )
        })?;
        let displaced_file = open_regular_at(parent.as_raw_fd(), &staged_name, libc::O_RDONLY)
            .map_err(|error| {
                cleanup.armed = false;
                CommandFailure::Partial(
                    format!(
                        "file was swapped, but the displaced version could not be opened: {error}"
                    ),
                    Some(revision(&saved, content.as_bytes())),
                )
            })?;
        let displaced_bytes = read_all(&mut &displaced_file).map_err(|error| {
            cleanup.armed = false;
            CommandFailure::Partial(
                format!("file was swapped, but the displaced version could not be read: {error}"),
                Some(revision(&saved, content.as_bytes())),
            )
        })?;
        if !same_identity(&original, &displaced)
            || revision(&displaced, &displaced_bytes) != *expected
        {
            let current_target = stat_at(parent.as_raw_fd(), &name);
            let current_displaced = stat_at(parent.as_raw_fd(), &staged_name);
            let target_revision_matches =
                open_regular_at(parent.as_raw_fd(), &name, libc::O_RDONLY)
                    .and_then(|file| {
                        let stat = regular_unlinked_stat(file.as_raw_fd())?;
                        let bytes = read_all(&mut &file)?;
                        Ok(revision(&stat, &bytes) == revision(&saved, content.as_bytes()))
                    })
                    .unwrap_or(false);
            let displaced_revision_matches =
                open_regular_at(parent.as_raw_fd(), &staged_name, libc::O_RDONLY)
                    .and_then(|file| {
                        let stat = regular_unlinked_stat(file.as_raw_fd())?;
                        let bytes = read_all(&mut &file)?;
                        Ok(revision(&stat, &bytes) == *expected)
                    })
                    .unwrap_or(false);
            let safe_to_rollback = current_target
                .as_ref()
                .is_ok_and(|current| same_identity(&saved, current))
                && current_displaced
                    .as_ref()
                    .is_ok_and(|current| same_identity(&original, current))
                && target_revision_matches
                && displaced_revision_matches;
            if !safe_to_rollback {
                cleanup.armed = false;
                return Err(CommandFailure::Partial(
                    "save race was detected and rollback was unsafe; all reachable versions were retained".into(),
                    None,
                ));
            }
            if let Err(error) = rename_swap(parent.as_raw_fd(), &staged_name, &name) {
                cleanup.armed = false;
                return Err(CommandFailure::Partial(
                    format!("save race was detected but rollback failed; both versions were retained: {error}"),
                    None,
                ));
            }
            let restored = stat_at(parent.as_raw_fd(), &name).map_err(|error| {
                cleanup.armed = false;
                CommandFailure::Partial(
                    format!("save rollback completed, but the restored target could not be validated: {error}"),
                    None,
                )
            })?;
            let replacement = stat_at(parent.as_raw_fd(), &staged_name).map_err(|error| {
                cleanup.armed = false;
                CommandFailure::Partial(
                    format!("save rollback completed, but the replacement could not be validated: {error}"),
                    None,
                )
            })?;
            if !same_identity(&original, &restored) || !same_identity(&saved, &replacement) {
                cleanup.armed = false;
                return Err(CommandFailure::Partial(
                    "save rollback completed with unexpected identities; versions were retained"
                        .into(),
                    None,
                ));
            }
            cleanup_owned_entry(
                parent.as_raw_fd(),
                &staged_name,
                &saved,
                0,
                "save-rollback-before-cleanup-isolation",
            )
            .map_err(|message| {
                cleanup.armed = false;
                CommandFailure::Partial(message, None)
            })?;
            cleanup.armed = false;
            if let Err(error) = sync_dir(&parent) {
                return Err(CommandFailure::Partial(
                    format!("save was rolled back and cleaned up, but its directory could not be synced: {error}"),
                    None,
                ));
            }
            return Err(CommandFailure::Conflict(
                "file changed during the atomic save; replacement was rolled back".into(),
            ));
        }
        drop(displaced_file);
        run_test_hook(
            "save-before-target-revalidation",
            parent.as_raw_fd(),
            &name,
            &staged_name,
        );
        let live_target = stat_at(parent.as_raw_fd(), &name).map_err(|error| {
            cleanup.armed = false;
            CommandFailure::Partial(
                format!("file was replaced, but its live target could not be revalidated: {error}"),
                Some(revision(&saved, content.as_bytes())),
            )
        })?;
        if !same_entry_snapshot(&saved, &live_target) {
            cleanup.armed = false;
            return Err(CommandFailure::Partial(
                "save target changed after the atomic swap; reachable versions were retained"
                    .into(),
                Some(revision(&saved, content.as_bytes())),
            ));
        }
        cleanup_owned_entry(
            parent.as_raw_fd(),
            &staged_name,
            &original,
            0,
            "save-before-cleanup-isolation",
        )
        .map_err(|message| {
            cleanup.armed = false;
            CommandFailure::Partial(message, Some(revision(&saved, content.as_bytes())))
        })?;
        cleanup.armed = false;
        if unsafe { libc::fsync(parent.as_raw_fd()) } != 0 {
            return Err(CommandFailure::Partial(
                "file was replaced but its directory could not be synced".into(),
                Some(revision(&saved, content.as_bytes())),
            ));
        }
        Ok(revision(&saved, content.as_bytes()))
    }

    pub fn create_file(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.create_file_inner(id, path))
    }

    fn create_file_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        let (parent_path, name) = split_path(path)?;
        let parent = open_parent(root.as_raw_fd(), parent_path)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o666,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error().into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        file.sync_all()?;
        sync_after_commit(&parent, "file was created")
    }

    pub fn create_directory(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.create_directory_inner(id, path))
    }

    fn create_directory_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        validate_relative_path(path)?;
        let mut parent = root;
        let mut committed = false;
        for component in path.components() {
            let name = cstring(component.as_os_str())?;
            match open_directory_at(parent.as_raw_fd(), &name) {
                Ok(next) => parent = next,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o777) } != 0 {
                        return Err(io::Error::last_os_error().into());
                    }
                    committed = true;
                    run_test_hook(
                        "create-directory-after-mkdir",
                        parent.as_raw_fd(),
                        &name,
                        &name,
                    );
                    sync_after_commit(&parent, "directory was created")?;
                    parent = open_directory_at(parent.as_raw_fd(), &name).map_err(|error| {
                        MutationFailure::Partial(format!(
                            "directory was partially created before opening the new component failed: {error}"
                        ))
                    })?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        if committed {
            Ok(())
        } else {
            Err(io::Error::new(io::ErrorKind::AlreadyExists, "directory already exists").into())
        }
    }

    pub fn delete(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.delete_inner(id, path))
    }

    fn delete_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        let (parent_path, name) = split_path(path)?;
        let parent = open_parent(root.as_raw_fd(), parent_path)?;
        let expected = stat_at(parent.as_raw_fd(), &name)?;
        delete_entry(parent.as_raw_fd(), &name, &expected)?;
        sync_after_commit(&parent, "path was deleted")
    }

    pub fn rename(
        &self,
        id: &WorkspaceId,
        from: &Path,
        to: &Path,
        overwrite: bool,
    ) -> MutationResult {
        mutation_result(self.rename_inner(id, from, to, overwrite))
    }

    fn rename_inner(
        &self,
        id: &WorkspaceId,
        from: &Path,
        to: &Path,
        overwrite: bool,
    ) -> Result<(), MutationFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        let (from_parent_path, from_name) = split_path(from)?;
        let (to_parent_path, to_name) = split_path(to)?;
        let from_parent = open_parent(root.as_raw_fd(), from_parent_path)?;
        let to_parent = open_parent(root.as_raw_fd(), to_parent_path)?;
        let source = stat_at(from_parent.as_raw_fd(), &from_name)?;
        ensure_supported_entry(&source)?;
        let destination = if overwrite {
            match stat_at(to_parent.as_raw_fd(), &to_name) {
                Ok(stat) => {
                    ensure_supported_entry(&stat)?;
                    Some(stat)
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.into()),
            }
        } else {
            None
        };
        let revalidated = stat_at(from_parent.as_raw_fd(), &from_name)?;
        if !same_entry_snapshot(&source, &revalidated) {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "rename source changed before commit",
            )
            .into());
        }
        if let Some(destination) = destination {
            return rename_overwrite(
                &from_parent,
                &from_name,
                &source,
                &to_parent,
                &to_name,
                &destination,
            );
        }
        rename_at(
            from_parent.as_raw_fd(),
            &from_name,
            to_parent.as_raw_fd(),
            &to_name,
            !overwrite,
        )?;
        sync_after_commit(&from_parent, "path was renamed")?;
        if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
            sync_after_commit(&to_parent, "path was renamed")?;
        }
        Ok(())
    }
}

pub fn read_image_from_root(
    root: &File,
    path: &Path,
) -> Result<WorkspaceImageFile, WorkspaceImageReadError> {
    for _ in 0..3 {
        let mut file = open_regular(root.as_raw_fd(), path, libc::O_RDONLY)?;
        let before = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&before)?;
        let first = read_image_bytes(&mut file)?;
        let middle = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&middle)?;
        file.seek(SeekFrom::Start(0))?;
        let second = read_image_bytes(&mut file)?;
        let after = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&after)?;
        if same_snapshot(&before, &middle) && same_snapshot(&middle, &after) && first == second {
            return Ok(WorkspaceImageFile {
                byte_length: first.len(),
                base64: encode_base64(&first),
            });
        }
    }
    Err(io::Error::new(
        io::ErrorKind::WouldBlock,
        "file changed repeatedly while it was being read",
    )
    .into())
}

fn ensure_image_size(stat: &libc::stat) -> Result<(), WorkspaceImageReadError> {
    let size = u64::try_from(stat.st_size).unwrap_or(u64::MAX);
    if size <= WORKSPACE_IMAGE_FILE_SIZE_LIMIT as u64 {
        return Ok(());
    }
    Err(WorkspaceImageReadError::TooLarge {
        size,
        max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
    })
}

fn read_image_bytes(file: &mut impl Read) -> Result<Vec<u8>, WorkspaceImageReadError> {
    let mut bytes = Vec::new();
    file.take((WORKSPACE_IMAGE_FILE_SIZE_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() <= WORKSPACE_IMAGE_FILE_SIZE_LIMIT {
        return Ok(bytes);
    }
    Err(WorkspaceImageReadError::TooLarge {
        size: bytes.len() as u64,
        max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
    })
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

enum CommandFailure {
    Conflict(String),
    Partial(String, Option<FileRevision>),
    Io(io::Error),
}

enum MutationFailure {
    Partial(String),
    Io(io::Error),
}
impl From<io::Error> for MutationFailure {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}
fn mutation_result(result: Result<(), MutationFailure>) -> MutationResult {
    match result {
        Ok(()) => MutationResult::Success,
        Err(MutationFailure::Partial(message)) => MutationResult::Partial { message },
        Err(MutationFailure::Io(error)) => MutationResult::Error {
            message: error.to_string(),
        },
    }
}
impl From<io::Error> for CommandFailure {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

fn split_path(path: &Path) -> io::Result<(&Path, CString)> {
    validate_relative_path(path)?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    Ok((path.parent().unwrap_or(Path::new("")), cstring(name)?))
}
fn cstring(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes()).map_err(io::Error::other)
}

fn open_parent(root: RawFd, path: &Path) -> io::Result<File> {
    if path.as_os_str().is_empty() {
        let fd = unsafe { libc::fcntl(root, libc::F_DUPFD_CLOEXEC, 0) };
        return fd_result(fd);
    }
    validate_relative_path(path)?;
    let path = cstring(path.as_os_str())?;
    let fd = unsafe {
        libc::openat(
            root,
            path.as_ptr(),
            libc::O_RDONLY
                | libc::O_DIRECTORY
                | libc::O_CLOEXEC
                | libc::O_NOFOLLOW_ANY
                | O_RESOLVE_BENEATH,
        )
    };
    fd_result(fd)
}
fn open_regular(root: RawFd, path: &Path, flags: libc::c_int) -> io::Result<File> {
    validate_relative_path(path)?;
    let path = cstring(path.as_os_str())?;
    let fd = unsafe {
        libc::openat(
            root,
            path.as_ptr(),
            flags | libc::O_NONBLOCK | libc::O_CLOEXEC | libc::O_NOFOLLOW_ANY | O_RESOLVE_BENEATH,
        )
    };
    let file = fd_result(fd)?;
    regular_unlinked_stat(file.as_raw_fd())?;
    Ok(file)
}
fn open_regular_at(parent: RawFd, name: &CStr, flags: libc::c_int) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            flags | libc::O_NONBLOCK | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    let file = fd_result(fd)?;
    regular_unlinked_stat(file.as_raw_fd())?;
    Ok(file)
}
fn open_directory_at(parent: RawFd, name: &CStr) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    fd_result(fd)
}
fn fd_result(fd: libc::c_int) -> io::Result<File> {
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}
fn regular_unlinked_stat(fd: RawFd) -> io::Result<libc::stat> {
    let stat = fstat(fd)?;
    ensure_regular_single_link(&stat)?;
    Ok(stat)
}
fn ensure_regular_single_link(stat: &libc::stat) -> io::Result<()> {
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path is not a regular file",
        ));
    }
    if stat.st_nlink != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "hard-linked files are not supported",
        ));
    }
    Ok(())
}
fn ensure_supported_entry(stat: &libc::stat) -> io::Result<()> {
    match stat.st_mode & libc::S_IFMT {
        libc::S_IFREG => ensure_regular_single_link(stat),
        libc::S_IFDIR => Ok(()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symlinks and special files are not supported",
        )),
    }
}
fn fstat(fd: RawFd) -> io::Result<libc::stat> {
    let mut value = std::mem::MaybeUninit::uninit();
    if unsafe { libc::fstat(fd, value.as_mut_ptr()) } != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { value.assume_init() })
    }
}
fn stat_at(parent: RawFd, name: &CStr) -> io::Result<libc::stat> {
    let mut value = std::mem::MaybeUninit::uninit();
    if unsafe {
        libc::fstatat(
            parent,
            name.as_ptr(),
            value.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { value.assume_init() })
    }
}
fn revision(stat: &libc::stat, content: &[u8]) -> FileRevision {
    FileRevision {
        device: stat.st_dev as u64,
        inode: stat.st_ino,
        size: stat.st_size,
        modified_seconds: stat.st_mtime,
        modified_nanoseconds: stat.st_mtime_nsec,
        content_hash: content_hash(content),
    }
}
fn same_snapshot(a: &libc::stat, b: &libc::stat) -> bool {
    same_identity(a, b)
        && a.st_size == b.st_size
        && a.st_mtime == b.st_mtime
        && a.st_mtime_nsec == b.st_mtime_nsec
}
fn content_hash(content: &[u8]) -> u64 {
    content.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}
fn read_all(file: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}
fn same_identity(a: &libc::stat, b: &libc::stat) -> bool {
    a.st_dev == b.st_dev
        && a.st_ino == b.st_ino
        && a.st_mode & libc::S_IFMT == b.st_mode & libc::S_IFMT
}
fn same_entry_snapshot(a: &libc::stat, b: &libc::stat) -> bool {
    if a.st_mode & libc::S_IFMT == libc::S_IFREG {
        return same_snapshot(a, b);
    }
    same_identity(a, b)
}
fn sync_dir(dir: &File) -> io::Result<()> {
    if unsafe { libc::fsync(dir.as_raw_fd()) } != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
fn sync_after_commit(dir: &File, action: &str) -> Result<(), MutationFailure> {
    sync_dir(dir).map_err(|error| {
        MutationFailure::Partial(format!(
            "{action}, but its parent directory could not be synced: {error}"
        ))
    })
}

fn rename_overwrite(
    from_parent: &File,
    from_name: &CStr,
    source: &libc::stat,
    to_parent: &File,
    to_name: &CStr,
    destination: &libc::stat,
) -> Result<(), MutationFailure> {
    let current_destination = stat_at(to_parent.as_raw_fd(), to_name)?;
    if !same_entry_snapshot(destination, &current_destination) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "rename destination changed before commit",
        )
        .into());
    }
    rename_swap_at(
        from_parent.as_raw_fd(),
        from_name,
        to_parent.as_raw_fd(),
        to_name,
    )?;
    run_test_hook(
        "rename-after-swap",
        to_parent.as_raw_fd(),
        to_name,
        from_name,
    );
    let current_source = stat_at(to_parent.as_raw_fd(), to_name);
    let displaced_destination = stat_at(from_parent.as_raw_fd(), from_name);
    let committed_identities_match = current_source
        .as_ref()
        .is_ok_and(|current| same_entry_snapshot(source, current))
        && displaced_destination
            .as_ref()
            .is_ok_and(|current| same_entry_snapshot(destination, current));
    if !committed_identities_match {
        let rollback_safe = current_source
            .as_ref()
            .is_ok_and(|current| same_identity(source, current))
            && displaced_destination
                .as_ref()
                .is_ok_and(|current| same_identity(destination, current));
        if rollback_safe
            && rename_swap_at(
                from_parent.as_raw_fd(),
                from_name,
                to_parent.as_raw_fd(),
                to_name,
            )
            .is_ok()
        {
            sync_dir(from_parent).map_err(|error| {
                MutationFailure::Partial(format!(
                    "rename race was rolled back, but its directory could not be synced: {error}"
                ))
            })?;
            if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
                sync_dir(to_parent).map_err(|error| {
                    MutationFailure::Partial(format!(
                        "rename race was rolled back, but its destination directory could not be synced: {error}"
                    ))
                })?;
            }
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "rename destination changed during commit; operation was rolled back",
            )
            .into());
        }
        return Err(MutationFailure::Partial(
            "rename destination changed during commit and rollback was unsafe; reachable versions were retained".into(),
        ));
    }

    let quarantine = unique_quarantine_name(from_parent.as_raw_fd(), from_name)?;
    rename_at(
        from_parent.as_raw_fd(),
        from_name,
        from_parent.as_raw_fd(),
        &quarantine,
        true,
    )
    .map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the displaced destination could not be quarantined: {error}"
        ))
    })?;
    let quarantined = stat_at(from_parent.as_raw_fd(), &quarantine).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the quarantined destination could not be inspected: {error}"
        ))
    })?;
    let committed_source = stat_at(to_parent.as_raw_fd(), to_name).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the destination could not be revalidated: {error}"
        ))
    })?;
    if !same_entry_snapshot(destination, &quarantined)
        || !same_entry_snapshot(source, &committed_source)
    {
        return Err(MutationFailure::Partial(
            "rename committed with unexpected identities; quarantined data was retained".into(),
        ));
    }
    delete_entry(from_parent.as_raw_fd(), &quarantine, &quarantined).map_err(|error| {
        MutationFailure::Partial(match error {
            MutationFailure::Partial(message) => message,
            MutationFailure::Io(error) => format!(
                "rename committed, but removing the quarantined destination failed: {error}"
            ),
        })
    })?;
    sync_after_commit(from_parent, "path was renamed")?;
    if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
        sync_after_commit(to_parent, "path was renamed")?;
    }
    Ok(())
}

fn delete_entry(parent: RawFd, name: &CStr, expected: &libc::stat) -> Result<(), MutationFailure> {
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "delete target changed before commit",
        )
        .into());
    }
    match current.st_mode & libc::S_IFMT {
        libc::S_IFREG => {
            ensure_regular_single_link(&current)?;
            cleanup_owned_entry(parent, name, expected, 0, "delete-before-cleanup-isolation")
                .map_err(MutationFailure::Partial)
        }
        libc::S_IFDIR => delete_directory_tree(parent, name, &current),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symlinks and special files are not supported",
        )
        .into()),
    }
}

fn delete_directory_tree(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
) -> Result<(), MutationFailure> {
    let directory = open_directory_at(parent, name)?;
    let mut committed = false;
    let duplicate = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error().into());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(io::Error::last_os_error().into());
    }
    let stream = DirectoryStream(stream);
    loop {
        unsafe {
            *libc::__error() = 0;
        }
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error().unwrap_or(0) != 0 {
                return Err(if committed {
                    MutationFailure::Partial(format!(
                        "directory was partially deleted before enumeration failed: {error}"
                    ))
                } else {
                    error.into()
                });
            }
            break;
        }
        let child_name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if child_name.to_bytes() == b"." || child_name.to_bytes() == b".." {
            continue;
        }
        let child = stat_at(directory.as_raw_fd(), child_name).map_err(|error| {
            if committed {
                MutationFailure::Partial(format!(
                    "directory was partially deleted before a child could be inspected: {error}"
                ))
            } else {
                error.into()
            }
        })?;
        if let Err(error) = delete_entry(directory.as_raw_fd(), child_name, &child) {
            return Err(if committed {
                MutationFailure::Partial("directory was only partially deleted".into())
            } else {
                error
            });
        }
        committed = true;
        run_test_hook(
            "delete-directory-after-child",
            directory.as_raw_fd(),
            child_name,
            child_name,
        );
    }
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(if committed {
            MutationFailure::Partial(
                "directory contents were deleted, but the directory identity changed".into(),
            )
        } else {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "directory changed before removal",
            )
            .into()
        });
    }
    cleanup_owned_entry(
        parent,
        name,
        expected,
        libc::AT_REMOVEDIR,
        "delete-directory-before-cleanup-isolation",
    )
    .map_err(|message| {
        if committed {
            MutationFailure::Partial(format!(
                "directory contents were deleted, but removing the directory failed: {message}"
            ))
        } else {
            MutationFailure::Partial(message)
        }
    })
}

fn cleanup_owned_entry(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, true)
}

fn cleanup_owned_entry_by_identity(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, false)
}

fn cleanup_owned_entry_with_validation(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
    validate_snapshot: bool,
) -> Result<(), String> {
    let quarantine = unique_quarantine_name(parent, name).map_err(|error| error.to_string())?;
    run_test_hook(hook_event, parent, name, &quarantine);
    rename_at(parent, name, parent, &quarantine, true).map_err(|error| {
        format!("cleanup target could not be atomically isolated; it was retained: {error}")
    })?;
    let isolated = stat_at(parent, &quarantine).map_err(|error| {
        format!("isolated cleanup target could not be validated and was retained: {error}")
    })?;
    let owns_isolated = if validate_snapshot {
        same_entry_snapshot(expected, &isolated)
    } else {
        same_identity(expected, &isolated)
    };
    if !owns_isolated {
        return Err(
            "cleanup target changed before atomic isolation; the foreign entry was retained".into(),
        );
    }
    if unsafe { libc::unlinkat(parent, quarantine.as_ptr(), unlink_flags) } != 0 {
        return Err(format!(
            "isolated cleanup target could not be removed and was retained: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn copy_metadata(source: RawFd, destination: RawFd) -> io::Result<()> {
    let state = unsafe { libc::copyfile_state_alloc() };
    if state.is_null() {
        return Err(io::Error::last_os_error());
    }
    let result = unsafe { libc::fcopyfile(source, destination, state, libc::COPYFILE_METADATA) };
    let error = if result == 0 {
        None
    } else {
        Some(io::Error::last_os_error())
    };
    unsafe {
        libc::copyfile_state_free(state);
    }
    error.map_or(Ok(()), Err)
}

fn rename_swap(parent: RawFd, from: &CStr, to: &CStr) -> io::Result<()> {
    let result =
        unsafe { libc::renameatx_np(parent, from.as_ptr(), parent, to.as_ptr(), RENAME_SWAP) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn rename_swap_at(from_parent: RawFd, from: &CStr, to_parent: RawFd, to: &CStr) -> io::Result<()> {
    let result = unsafe {
        libc::renameatx_np(
            from_parent,
            from.as_ptr(),
            to_parent,
            to.as_ptr(),
            RENAME_SWAP,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn unique_quarantine_name(parent: RawFd, target: &CStr) -> io::Result<CString> {
    for _ in 0..128_u32 {
        let mut random = [0_u8; 16];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = CString::new(format!(
            ".{}.rename-{token}",
            String::from_utf8_lossy(target.to_bytes())
        ))
        .unwrap();
        match stat_at(parent, &name) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(name),
            Ok(_) => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique rename quarantine",
    ))
}

#[cfg(not(test))]
fn run_test_hook(_event: &str, _parent: RawFd, _first: &CStr, _second: &CStr) {}

#[cfg(test)]
thread_local! {
    static TEST_HOOK: std::cell::RefCell<Option<(&'static str, Box<dyn FnOnce(&str, RawFd, &CStr, &CStr)>)>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn run_test_hook(event: &str, parent: RawFd, first: &CStr, second: &CStr) {
    TEST_HOOK.with(|hook| {
        if !hook
            .borrow()
            .as_ref()
            .is_some_and(|(expected, _)| *expected == event)
        {
            return;
        }
        if let Some((_, callback)) = hook.borrow_mut().take() {
            callback(event, parent, first, second);
        }
    });
}

fn create_unique_file(
    parent: RawFd,
    target: &CStr,
    mode: libc::mode_t,
) -> io::Result<(File, CString)> {
    for _ in 0..128_u32 {
        let mut random = [0_u8; 16];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = CString::new(format!(
            ".{}.save-{token}",
            String::from_utf8_lossy(target.to_bytes()),
        ))
        .unwrap();
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                (mode & 0o7777) as libc::c_uint,
            )
        };
        if fd >= 0 {
            return Ok((unsafe { File::from_raw_fd(fd) }, name));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(error);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique save file",
    ))
}

fn rename_at(
    from_parent: RawFd,
    from: &CStr,
    to_parent: RawFd,
    to: &CStr,
    exclusive: bool,
) -> io::Result<()> {
    let result = if exclusive {
        unsafe {
            libc::renameatx_np(
                from_parent,
                from.as_ptr(),
                to_parent,
                to.as_ptr(),
                RENAME_EXCL,
            )
        }
    } else {
        unsafe { libc::renameat(from_parent, from.as_ptr(), to_parent, to.as_ptr()) }
    };
    if result != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct TempCleanup {
    parent: RawFd,
    name: CString,
    expected: libc::stat,
    armed: bool,
}
impl TempCleanup {
    fn finish_before_return(&mut self) -> Result<(), String> {
        self.armed = false;
        cleanup_owned_entry_by_identity(
            self.parent,
            &self.name,
            &self.expected,
            0,
            "temporary-save-before-cleanup-isolation",
        )
    }
}
impl Drop for TempCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = cleanup_owned_entry_by_identity(
                self.parent,
                &self.name,
                &self.expected,
                0,
                "temporary-save-before-cleanup-isolation",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_history::LocalHistoryStore;
    use std::{
        fs,
        os::unix::fs::symlink,
        path::PathBuf,
        sync::{Arc, Barrier},
        thread,
    };

    fn fixture(label: &str) -> (Arc<WorkspaceRegistry>, WorkspaceId, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "mockor-file-commands-{label}-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&root).unwrap();
        let registry = Arc::new(WorkspaceRegistry::new());
        let id = registry.register(&root).unwrap().workspace_id;
        (registry, id, root)
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    fn history_store(label: &str) -> LocalHistoryStore {
        let base = std::env::temp_dir().join(format!(
            "mockor-replace-history-{label}-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&base).unwrap();
        LocalHistoryStore::new(base)
    }

    struct FailingSnapshotSink;

    impl LocalHistorySnapshotSink for FailingSnapshotSink {
        fn record_snapshot(
            &self,
            _workspace_root: &str,
            _relative_path: &str,
            _content: &str,
        ) -> Result<(), String> {
            Err("snapshot store unavailable".into())
        }
    }

    #[test]
    fn descriptor_file_search_supports_and_ranks_fuzzy_queries() {
        let cases = [
            (
                "uc",
                vec![
                    "src/Http/Controllers/UserController.php",
                    "src/ProductController.php",
                ],
            ),
            ("usrctrl", vec!["src/Http/Controllers/UserController.php"]),
            (
                "user controller",
                vec!["src/Http/Controllers/UserController.php"],
            ),
            ("USER", vec!["src/Http/Controllers/UserController.php"]),
            ("*.php", vec![]),
            (
                "controller",
                vec![
                    "src/Http/Controllers/UserController.php",
                    "very/deep/AdminController.php",
                    "src/ProductController.php",
                    "controller/a.php",
                ],
            ),
        ];

        for (index, (query, expected)) in cases.into_iter().enumerate() {
            let (registry, id, root) = fixture(&format!("fuzzy-search-{index}"));
            fs::create_dir_all(root.join("src/Http/Controllers")).unwrap();
            fs::create_dir_all(root.join("very/deep")).unwrap();
            fs::create_dir_all(root.join("controller")).unwrap();
            fs::write(root.join("src/Http/Controllers/UserController.php"), "").unwrap();
            fs::write(root.join("src/ProductController.php"), "").unwrap();
            fs::write(root.join("very/deep/AdminController.php"), "").unwrap();
            fs::write(root.join("controller/a.php"), "").unwrap();
            let repository = WorkspaceFileRepository::new(&registry);

            let paths = repository
                .search_files(&id, Path::new(""), query, 20)
                .unwrap()
                .into_iter()
                .map(|result| result.relative_path)
                .collect::<Vec<_>>();

            assert_eq!(paths, expected, "query={query:?}");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn descriptor_file_search_keeps_empty_query_and_shallow_ordering() {
        let (registry, id, root) = fixture("fuzzy-search-empty");
        fs::create_dir_all(root.join("deep/path")).unwrap();
        fs::write(root.join("a.php"), "").unwrap();
        fs::write(root.join("deep/path/a.php"), "").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let paths = repository
            .search_files(&id, Path::new(""), "", 20)
            .unwrap()
            .into_iter()
            .map(|result| result.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["a.php", "deep/path/a.php"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn descriptor_file_search_scores_matches_beyond_the_initial_scan_window() {
        let (registry, id, root) = fixture("fuzzy-search-full-traversal");
        for index in 0..11 {
            fs::write(root.join(format!("unrelated-{index:02}.txt")), "").unwrap();
        }
        fs::create_dir_all(root.join("deep/path")).unwrap();
        fs::write(root.join("deep/path/needle"), "").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let paths = repository
            .search_files(&id, Path::new(""), "needle", 1)
            .unwrap()
            .into_iter()
            .map(|result| result.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["deep/path/needle"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_descriptor_file_search_matches_exhaustive_ranking() {
        let (registry, id, root) = fixture("fuzzy-search-bounded-ranking");
        let paths = [
            "ControllerGuide.php",
            "ProductController.php",
            "UserController.php",
            "controller/a.php",
            "docs/controller-notes.md",
            "src/AdminController.php",
            "src/Http/Controllers/UserController.php",
            "src/unrelated.txt",
            "very/deep/AdminController.php",
        ];
        for relative in paths {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        let root_file = registry.clone_root(&id).unwrap();
        let display_root = registry.descriptor(&id).unwrap().canonical_root_path;

        let actual = collect_ranked_files(
            &root_file,
            Path::new(""),
            "controller",
            4,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &display_root,
        )
        .unwrap();
        let mut expected = paths
            .into_iter()
            .filter_map(|path| Some((PathBuf::from(path), file_score(path, "controller")?)))
            .collect::<Vec<_>>();
        expected.sort_by(|(left_path, left_rank), (right_path, right_rank)| {
            compare_ranked_paths(
                &left_path.to_string_lossy(),
                *left_rank,
                &right_path.to_string_lossy(),
                *right_rank,
            )
        });
        expected.truncate(4);

        assert_eq!(actual, expected);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ranked_file_search_counts_directories_toward_the_visited_limit() {
        let (registry, id, root) = fixture("fuzzy-search-directory-cap");
        fs::create_dir_all(root.join("a/b/c/d/e")).unwrap();
        fs::write(root.join("a/b/c/d/e/needle.php"), "").unwrap();
        let root_file = registry.clone_root(&id).unwrap();
        let display_root = registry.descriptor(&id).unwrap().canonical_root_path;

        let capped =
            collect_ranked_files(&root_file, Path::new(""), "needle", 10, 3, &display_root)
                .unwrap();
        assert!(capped.is_empty());

        let uncapped = collect_ranked_files(
            &root_file,
            Path::new(""),
            "needle",
            10,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &display_root,
        )
        .unwrap();
        assert_eq!(uncapped.len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn descriptor_file_score_preserves_exact_and_prefix_tiers() {
        let cases = [
            (
                "very/deep/UserController.php",
                "UserController.php.bak",
                "UserController.php",
            ),
            (
                "very/deep/ControllerGuide.php",
                "a/AdminController.php",
                "controller",
            ),
        ];

        for (better, worse, query) in cases {
            assert!(
                compare_ranked_paths(
                    better,
                    file_score(better, query).unwrap(),
                    worse,
                    file_score(worse, query).unwrap(),
                )
                .is_lt(),
                "expected {better:?} to outrank {worse:?} for {query:?}"
            );
        }
    }

    fn install_hook(
        event: &'static str,
        callback: impl FnOnce(&str, RawFd, &CStr, &CStr) + 'static,
    ) {
        TEST_HOOK.with(|hook| *hook.borrow_mut() = Some((event, Box::new(callback))));
    }

    fn count_descriptors_for(file: &File) -> usize {
        let expected = fstat(file.as_raw_fd()).unwrap();
        (0..unsafe { libc::getdtablesize() })
            .filter(|fd| {
                let mut current = unsafe { std::mem::zeroed() };
                (unsafe { libc::fstat(*fd, &mut current) == 0 })
                    && same_identity(&expected, &current)
            })
            .count()
    }

    #[test]
    fn directory_entries_closes_stream_when_child_disappears_before_stat() {
        let (_, _, root) = fixture("directory-entries-stat-failure");
        fs::write(root.join("child"), "value").unwrap();
        let directory = File::open(&root).unwrap();
        let descriptors_before = count_descriptors_for(&directory);
        install_hook(
            "directory-entries-before-stat",
            |event, parent, child, _| {
                assert_eq!(event, "directory-entries-before-stat");
                assert_eq!(unsafe { libc::unlinkat(parent, child.as_ptr(), 0) }, 0);
            },
        );

        let error = match directory_entries(&directory) {
            Ok(_) => panic!("directory enumeration unexpectedly succeeded"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(count_descriptors_for(&directory), descriptors_before);
    }

    #[test]
    fn retained_root_and_intermediate_symlink_cannot_escape() {
        let (registry, id, root) = fixture("containment");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("value"), "retained").unwrap();
        fs::write(outside.join("value"), "outside").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let displaced = root.with_extension("displaced");
        fs::rename(&root, &displaced).unwrap();
        fs::create_dir(&root).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert_eq!(
            repository
                .read_text(&id, Path::new("value"))
                .unwrap()
                .content,
            "retained"
        );
        assert!(repository.read_text(&id, Path::new("link/value")).is_err());
    }

    #[test]
    fn image_read_round_trips_bytes_and_isolates_workspace_identity() {
        let (registry_a, id_a, root_a) = fixture("image-read-a");
        let (registry_b, id_b, root_b) = fixture("image-read-b");
        fs::write(root_a.join("image.png"), [0, 1, 2, 0xff]).unwrap();
        fs::write(root_b.join("image.png"), [9, 8, 7]).unwrap();

        let image_a = WorkspaceFileRepository::new(&registry_a)
            .read_image(&id_a, Path::new("image.png"))
            .unwrap();
        let image_b = WorkspaceFileRepository::new(&registry_b)
            .read_image(&id_b, Path::new("image.png"))
            .unwrap();

        assert_eq!(image_a.base64, "AAEC/w==");
        assert_eq!(image_a.byte_length, 4);
        assert_eq!(image_b.base64, "CQgH");
        assert_eq!(image_b.byte_length, 3);
    }

    #[test]
    fn image_read_rejects_symlink_escape_and_reports_size_limit() {
        let (registry, id, root) = fixture("image-read-guards");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("image.png"), [1, 2, 3]).unwrap();
        symlink(outside.join("image.png"), root.join("linked.png")).unwrap();
        fs::write(
            root.join("large.png"),
            vec![0; WORKSPACE_IMAGE_FILE_SIZE_LIMIT + 1],
        )
        .unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        assert!(matches!(
            repository.read_image(&id, Path::new("linked.png")),
            Err(WorkspaceImageReadError::Io { .. })
        ));
        assert!(matches!(
            repository.read_image(&id, Path::new("large.png")),
            Err(WorkspaceImageReadError::TooLarge {
                max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
                ..
            })
        ));
    }

    #[test]
    fn image_read_rejects_unknown_workspace() {
        let (registry, id, root) = fixture("image-read-unknown");
        fs::write(root.join("image.png"), [1, 2, 3]).unwrap();
        registry.unregister(&id).unwrap();

        assert!(matches!(
            WorkspaceFileRepository::new(&registry).read_image(&id, Path::new("image.png")),
            Err(WorkspaceImageReadError::Io { .. })
        ));
    }

    #[test]
    fn stale_save_preserves_existing_data() {
        let (registry, id, root) = fixture("preserve");
        fs::write(root.join("value"), "first").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let read = repository.read_text(&id, Path::new("value")).unwrap();
        fs::write(root.join("value"), "newer and different").unwrap();
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "stale", &read.revision),
            FileCommandResult::Conflict { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "newer and different"
        );
    }

    #[test]
    fn pre_swap_failure_never_cleans_up_a_foreign_temp_replacement() {
        let (registry, id, root) = fixture("temp-cleanup-capability");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook("save-after-temp-create", |event, parent, _, temp| {
            assert_eq!(event, "save-after-temp-create");
            let rescued = CString::new("rescued-owned-temp").unwrap();
            assert_eq!(
                unsafe { libc::renameat(parent, temp.as_ptr(), parent, rescued.as_ptr()) },
                0
            );
            let fd = unsafe {
                libc::openat(
                    parent,
                    temp.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut foreign = unsafe { File::from_raw_fd(fd) };
            foreign.write_all(b"foreign-temp").unwrap();
        });
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(fs::read_to_string(root.join("value")).unwrap(), "original");
        assert!(fs::read_dir(&root).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            path.is_file() && fs::read_to_string(path).is_ok_and(|value| value == "foreign-temp")
        }));
    }

    #[test]
    fn concurrent_saves_from_one_revision_allow_only_one_winner() {
        let (registry, id, root) = fixture("concurrent");
        fs::write(root.join("value"), "initial").unwrap();
        let revision = WorkspaceFileRepository::new(&registry)
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        let barrier = Arc::new(Barrier::new(3));
        let mut joins = Vec::new();
        for content in ["one", "two"] {
            let registry = Arc::clone(&registry);
            let id = id.clone();
            let revision = revision.clone();
            let barrier = Arc::clone(&barrier);
            joins.push(thread::spawn(move || {
                barrier.wait();
                WorkspaceFileRepository::new(&registry).save_text(
                    &id,
                    Path::new("value"),
                    content,
                    &revision,
                )
            }));
        }
        barrier.wait();
        let results: Vec<_> = joins.into_iter().map(|join| join.join().unwrap()).collect();
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, FileCommandResult::Success { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, FileCommandResult::Conflict { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn save_race_retains_foreign_replacement_without_unsafe_rollback() {
        let (registry, id, root) = fixture("save-rollback-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook("save-after-swap", |event, parent, _target, displaced| {
            assert_eq!(event, "save-after-swap");
            assert_eq!(unsafe { libc::unlinkat(parent, displaced.as_ptr(), 0) }, 0);
            let fd = unsafe {
                libc::openat(
                    parent,
                    displaced.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut file = unsafe { File::from_raw_fd(fd) };
            file.write_all(b"foreign").unwrap();
        });
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "replacement"
        );
        let retained = fs::read_dir(&root)
            .unwrap()
            .find(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".value.save-")
            })
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(retained.path()).unwrap(), "foreign");
    }

    #[test]
    fn save_revalidates_live_target_before_reporting_success() {
        let (registry, id, root) = fixture("save-live-target-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook(
            "save-before-target-revalidation",
            |event, parent, target, _| {
                assert_eq!(event, "save-before-target-revalidation");
                let rescued = CString::new("rescued-replacement").unwrap();
                assert_eq!(
                    unsafe { libc::renameat(parent, target.as_ptr(), parent, rescued.as_ptr()) },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        target.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"foreign-target").unwrap();
            },
        );
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "foreign-target"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-replacement")).unwrap(),
            "replacement"
        );
        assert!(fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".value.save-")));
    }

    #[test]
    fn cleanup_isolation_never_unlinks_a_foreign_replacement() {
        let (registry, id, root) = fixture("save-cleanup-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook(
            "save-before-cleanup-isolation",
            |event, parent, displaced, _quarantine| {
                assert_eq!(event, "save-before-cleanup-isolation");
                let rescued = CString::new("rescued-original").unwrap();
                assert_eq!(
                    unsafe { libc::renameat(parent, displaced.as_ptr(), parent, rescued.as_ptr()) },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        displaced.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"foreign-cleanup").unwrap();
            },
        );
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "replacement"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-original")).unwrap(),
            "original"
        );
        assert!(fs::read_dir(&root).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            path.is_file()
                && fs::read_to_string(path).is_ok_and(|content| content == "foreign-cleanup")
        }));
    }

    #[test]
    fn overwrite_rename_race_never_deletes_concurrent_destination() {
        let (registry, id, root) = fixture("rename-overwrite-race");
        fs::write(root.join("source"), "source").unwrap();
        fs::write(root.join("destination"), "destination").unwrap();
        install_hook(
            "rename-after-swap",
            |event, parent, destination, _displaced| {
                assert_eq!(event, "rename-after-swap");
                let rescued = CString::new("rescued-source").unwrap();
                assert_eq!(
                    unsafe {
                        libc::renameat(parent, destination.as_ptr(), parent, rescued.as_ptr())
                    },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        destination.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"concurrent").unwrap();
            },
        );
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.rename(&id, Path::new("source"), Path::new("destination"), true),
            MutationResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "concurrent"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-source")).unwrap(),
            "source"
        );
        assert_eq!(
            fs::read_to_string(root.join("source")).unwrap(),
            "destination"
        );
    }

    #[test]
    fn create_collision_rename_failure_and_delete_are_nondestructive() {
        let (registry, id, root) = fixture("mutations");
        fs::write(root.join("source"), "source").unwrap();
        fs::write(root.join("destination"), "destination").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.create_file(&id, Path::new("source")),
            MutationResult::Error { .. }
        ));
        assert!(matches!(
            repository.rename(&id, Path::new("source"), Path::new("destination"), false),
            MutationResult::Error { .. }
        ));
        assert_eq!(fs::read_to_string(root.join("source")).unwrap(), "source");
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "destination"
        );
        assert!(matches!(
            repository.delete(&id, Path::new("source")),
            MutationResult::Success
        ));
        assert!(!root.join("source").exists());
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "destination"
        );
    }

    #[test]
    fn recursive_directories_delete_without_following_hardlinks() {
        let (registry, id, root) = fixture("delete-guards");
        fs::create_dir_all(root.join("directory/nested")).unwrap();
        fs::write(root.join("directory/nested/value"), "value").unwrap();
        fs::write(root.join("linked"), "content").unwrap();
        fs::hard_link(root.join("linked"), root.join("alias")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.delete(&id, Path::new("directory")),
            MutationResult::Success
        ));
        assert!(matches!(
            repository.delete(&id, Path::new("linked")),
            MutationResult::Error { .. }
        ));
        assert!(!root.join("directory").exists());
        assert_eq!(fs::read_to_string(root.join("alias")).unwrap(), "content");
    }

    #[test]
    fn recursive_delete_reports_partial_after_first_mutation() {
        let (registry, id, root) = fixture("delete-partial");
        fs::create_dir(root.join("directory")).unwrap();
        fs::write(root.join("directory/first"), "first").unwrap();
        install_hook("delete-directory-after-child", |event, parent, _, _| {
            assert_eq!(event, "delete-directory-after-child");
            let value = CString::new("z-value").unwrap();
            let alias = CString::new("z-alias").unwrap();
            let fd = unsafe {
                libc::openat(
                    parent,
                    value.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            drop(unsafe { File::from_raw_fd(fd) });
            assert_eq!(
                unsafe { libc::linkat(parent, value.as_ptr(), parent, alias.as_ptr(), 0) },
                0
            );
        });
        assert!(matches!(
            WorkspaceFileRepository::new(&registry).delete(&id, Path::new("directory")),
            MutationResult::Partial { .. }
        ));
        let retained_directory = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.path().is_dir())
            .unwrap();
        assert!(
            fs::read_dir(retained_directory.path())
                .unwrap()
                .filter_map(Result::ok)
                .count()
                >= 2
        );
    }

    #[test]
    fn recursively_creates_directories() {
        let (registry, id, root) = fixture("mkdirs");
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.create_directory(&id, Path::new("one/two/three")),
            MutationResult::Success
        ));
        assert!(root.join("one/two/three").is_dir());
    }

    #[test]
    fn recursive_create_reports_partial_after_first_mutation() {
        let (registry, id, root) = fixture("mkdir-partial");
        install_hook(
            "create-directory-after-mkdir",
            |event, parent, created, _| {
                assert_eq!(event, "create-directory-after-mkdir");
                assert_eq!(
                    unsafe { libc::unlinkat(parent, created.as_ptr(), libc::AT_REMOVEDIR) },
                    0
                );
            },
        );
        assert!(matches!(
            WorkspaceFileRepository::new(&registry).create_directory(&id, Path::new("one/two")),
            MutationResult::Partial { .. }
        ));
        assert!(!root.join("one").exists());
    }

    #[test]
    fn reads_are_self_consistent_during_in_place_writes() {
        let (registry, id, root) = fixture("read-race");
        let a = "a".repeat(256 * 1024);
        let b = "b".repeat(256 * 1024);
        fs::write(root.join("value"), &a).unwrap();
        let path = root.join("value");
        let writer = thread::spawn({
            let a = a.clone();
            let b = b.clone();
            move || {
                for index in 0..100 {
                    fs::write(&path, if index % 2 == 0 { &b } else { &a }).unwrap();
                }
            }
        });
        let repository = WorkspaceFileRepository::new(&registry);
        for _ in 0..20 {
            if let Ok(read) = repository.read_text(&id, Path::new("value")) {
                assert_eq!(
                    read.revision.content_hash,
                    content_hash(read.content.as_bytes())
                );
                assert_eq!(read.revision.size, read.content.len() as i64);
            }
        }
        writer.join().unwrap();
    }

    #[test]
    fn descriptor_reads_skip_symlinks_and_respect_limits() {
        use std::os::unix::fs::symlink;
        let (registry, id, root) = fixture("scoped-reads");
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/one.php"), "needle one").unwrap();
        fs::write(root.join("src/two.php"), "needle two").unwrap();
        let (_outside_registry, _outside_id, outside) = fixture("scoped-reads-outside");
        fs::write(outside.join("secret.php"), "needle secret").unwrap();
        symlink(outside.join("secret.php"), root.join("linked.php")).unwrap();
        symlink(&outside, root.join("linked-dir")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let listing = repository.read_directory(&id, Path::new("")).unwrap();
        let payload = serde_json::to_string(&listing).unwrap();
        assert!(!payload.contains(&root.to_string_lossy().to_string()));
        assert!(payload.contains("relativePath"));
        assert_eq!(
            listing
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["src"]
        );
        let files = repository
            .search_files(&id, Path::new(""), "php", 1)
            .unwrap();
        assert_eq!(files.len(), 1);
        assert!(!files[0].relative_path.contains("linked"));
        let text = repository
            .search_text(
                &id,
                Path::new(""),
                "needle",
                1,
                &TextSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(text.len(), 1);
        assert!(!text[0].line_text.contains("secret"));
    }

    #[test]
    fn descriptor_reads_reject_unknown_and_do_not_cross_workspaces() {
        let (first_registry, first_id, first_root) = fixture("read-first");
        let (_second_registry, second_id, second_root) = fixture("read-second");
        fs::write(first_root.join("first.txt"), "first").unwrap();
        fs::write(second_root.join("second.txt"), "second").unwrap();
        let first = WorkspaceFileRepository::new(&first_registry);
        assert!(first.read_directory(&second_id, Path::new("")).is_err());
        assert!(first
            .search_files(&second_id, Path::new(""), "second", 10)
            .is_err());
        assert!(first
            .search_text(
                &second_id,
                Path::new(""),
                "second",
                10,
                &TextSearchOptions::default()
            )
            .is_err());
        assert_eq!(
            first
                .search_files(&first_id, Path::new(""), "second", 10)
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn scoped_search_honors_gitignore_globs_and_one_result_per_line() {
        let (registry, id, root) = fixture("scoped-search-options");
        fs::create_dir_all(root.join("src/nested")).unwrap();
        fs::create_dir(root.join("ignored")).unwrap();
        fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
        fs::write(root.join("ignored/secret.php"), "needle").unwrap();
        fs::write(root.join("outside.php"), "needle").unwrap();
        fs::write(root.join("src/nested/match-a.php"), "needle needle needle").unwrap();
        fs::write(root.join("src/nested/match-b.ts"), "needle").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let files = repository
            .search_files(&id, Path::new("src"), "match", 20)
            .unwrap();
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .all(|result| !result.relative_path.starts_with("src/")));
        assert!(repository
            .search_files(&id, Path::new("../outside"), "", 20)
            .is_err());

        let options = TextSearchOptions {
            file_mask: Some("**/match-{a,b}.php".into()),
            ..Default::default()
        };
        let results = repository
            .search_text(&id, Path::new("src"), "needle", 5_000, &options)
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "nested/match-a.php");
        assert_eq!(results[0].line_text, "needle needle needle");
        assert!(repository
            .search_text(
                &id,
                Path::new(""),
                "secret",
                500,
                &TextSearchOptions::default()
            )
            .unwrap()
            .is_empty());
    }

    #[test]
    fn nested_gitignore_is_descriptor_read_and_invalid_content_fails_closed() {
        let (registry, id, root) = fixture("nested-ignore");
        fs::create_dir_all(root.join("src/cache")).unwrap();
        fs::write(root.join("src/.gitignore"), "cache/\n*.secret\n").unwrap();
        fs::write(root.join("src/cache/hidden.php"), "needle").unwrap();
        fs::write(root.join("src/hidden.secret"), "needle").unwrap();
        fs::write(root.join("src/visible.php"), "needle").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let results = repository
            .search_files(&id, Path::new("src"), "", 20)
            .unwrap();
        let paths = results
            .iter()
            .map(|result| result.relative_path.as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"visible.php"));
        assert!(!paths
            .iter()
            .any(|path| path.contains("cache") || path.ends_with(".secret")));

        fs::write(root.join("src/.gitignore"), [0xff, 0xfe]).unwrap();
        assert!(repository
            .search_files(&id, Path::new("src"), "", 20)
            .is_err());
        assert!(repository
            .search_text(
                &id,
                Path::new("src"),
                "needle",
                20,
                &TextSearchOptions::default()
            )
            .is_err());
    }

    #[test]
    fn save_preserves_mode_and_extended_attributes() {
        use std::os::unix::fs::PermissionsExt;
        let (registry, id, root) = fixture("metadata");
        let path = root.join("value");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let file = File::options().read(true).write(true).open(&path).unwrap();
        let key = CString::new("user.mockor-test").unwrap();
        let value = b"preserved";
        assert_eq!(
            unsafe {
                libc::fsetxattr(
                    file.as_raw_fd(),
                    key.as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            },
            0
        );
        let repository = WorkspaceFileRepository::new(&registry);
        let read = repository.read_text(&id, Path::new("value")).unwrap();
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "new", &read.revision),
            FileCommandResult::Success { .. }
        ));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let saved = File::open(path).unwrap();
        let mut buffer = [0_u8; 32];
        let length = unsafe {
            libc::fgetxattr(
                saved.as_raw_fd(),
                key.as_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                0,
                0,
            )
        };
        assert_eq!(&buffer[..length as usize], value);
    }

    #[test]
    fn replace_is_scoped_and_isolated_by_workspace_identity() {
        let (registry_a, id_a, root_a) = fixture("replace-a");
        let (registry_b, id_b, root_b) = fixture("replace-b");
        for root in [&root_a, &root_b] {
            fs::create_dir_all(root.join("src/nested")).unwrap();
            fs::write(root.join("src/a.txt"), "Needle needle\n").unwrap();
            fs::write(root.join("src/nested/b.txt"), "needle\n").unwrap();
            fs::write(root.join("outside.txt"), "needle\n").unwrap();
        }
        let options = TextSearchOptions {
            case_sensitive: false,
            ..Default::default()
        };
        let result = WorkspaceFileRepository::new(&registry_a).replace_in_path(
            &id_a,
            Path::new("src"),
            "needle",
            "thread",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 3,
                ..
            }
        ));
        assert_eq!(
            fs::read(root_a.join("src/a.txt")).unwrap(),
            b"thread thread\n"
        );
        assert_eq!(fs::read(root_a.join("outside.txt")).unwrap(), b"needle\n");
        assert_eq!(
            fs::read(root_b.join("src/a.txt")).unwrap(),
            b"Needle needle\n"
        );
        assert_eq!(
            fs::read(root_b.join("src/nested/b.txt")).unwrap(),
            b"needle\n"
        );
        assert_eq!(
            WorkspaceFileRepository::new(&registry_b)
                .read_text(&id_b, Path::new("src/a.txt"))
                .unwrap()
                .content,
            "Needle needle\n"
        );
    }

    #[test]
    fn replace_records_pre_replace_history_for_changed_files_only() {
        let (registry_a, id_a, root_a) = fixture("replace-history-a");
        let (_registry_b, _id_b, root_b) = fixture("replace-history-b");
        fs::create_dir(root_a.join("src")).unwrap();
        fs::write(root_a.join("a.txt"), "needle one\n").unwrap();
        fs::write(root_a.join("src/b.txt"), "needle two\n").unwrap();
        fs::write(root_a.join("unchanged.txt"), "no match\n").unwrap();
        let store = history_store("changed-only");
        let canonical_root_a = root_a.canonicalize().unwrap();
        assert_ne!(root_a, canonical_root_a);
        let workspace_a = root_a.to_string_lossy();
        let canonical_workspace_a = canonical_root_a.to_string_lossy();
        let workspace_b = root_b.to_string_lossy();

        let result = WorkspaceFileRepository::new(&registry_a).replace_in_path_with_snapshot_sink(
            &id_a,
            Path::new(""),
            "needle",
            "thread",
            &TextSearchOptions::default(),
            &store,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 2,
                ..
            }
        ));
        for (path, expected) in [("a.txt", "needle one\n"), ("src/b.txt", "needle two\n")] {
            let versions = store.list_versions(&workspace_a, path).unwrap();
            assert_eq!(versions.len(), 1);
            assert_eq!(
                store
                    .read_version(&workspace_a, path, &versions[0].id)
                    .unwrap(),
                expected
            );
            assert!(store.list_versions(&workspace_b, path).unwrap().is_empty());
            assert!(store
                .list_versions(&canonical_workspace_a, path)
                .unwrap()
                .is_empty());
        }
        assert!(store
            .list_versions(&workspace_a, "unchanged.txt")
            .unwrap()
            .is_empty());

        let no_op = WorkspaceFileRepository::new(&registry_a).replace_in_path_with_snapshot_sink(
            &id_a,
            Path::new(""),
            "thread",
            "thread",
            &TextSearchOptions::default(),
            &store,
        );
        assert!(matches!(
            no_op,
            WorkspaceReplaceResult::Success {
                total_replacements: 0,
                ..
            }
        ));
        assert_eq!(store.list_versions(&workspace_a, "a.txt").unwrap().len(), 1);
        assert_eq!(
            store
                .list_versions(&workspace_a, "src/b.txt")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn snapshot_failure_does_not_fail_replace() {
        let (registry, id, root) = fixture("replace-history-failure");
        fs::write(root.join("a.txt"), "needle\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path_with_snapshot_sink(
            &id,
            Path::new("a.txt"),
            "needle",
            "thread",
            &TextSearchOptions::default(),
            &FailingSnapshotSink,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "thread\n");
    }

    #[test]
    fn replace_exact_file_supports_regex_captures_and_ignores_wider_mask() {
        use std::os::unix::fs::PermissionsExt;
        let (registry, id, root) = fixture("replace-regex");
        fs::write(root.join("a.txt"), "user-42 user42\n").unwrap();
        fs::set_permissions(root.join("a.txt"), fs::Permissions::from_mode(0o640)).unwrap();
        fs::write(root.join("b.txt"), "user-42\n").unwrap();
        let options = TextSearchOptions {
            case_sensitive: true,
            whole_word: true,
            is_regex: true,
            preserve_case: false,
            file_mask: Some("*.php".into()),
        };
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            r"user-(\d+)",
            "member-$1",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "member-42 user42\n"
        );
        assert_eq!(
            fs::metadata(root.join("a.txt"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        assert_eq!(fs::read_to_string(root.join("b.txt")).unwrap(), "user-42\n");
    }

    #[test]
    fn replace_literal_preserves_named_dollar_replacement_verbatim() {
        let (registry, id, root) = fixture("replace-literal-named-dollar");
        fs::write(root.join("a.php"), "x\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.php"),
            "x",
            "$user = 5",
            &TextSearchOptions::default(),
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.php")).unwrap(),
            "$user = 5\n"
        );
    }

    #[test]
    fn replace_literal_preserves_numeric_dollar_replacement_verbatim() {
        let (registry, id, root) = fixture("replace-literal-numeric-dollar");
        fs::write(root.join("a.txt"), "x\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "x",
            "$100",
            &TextSearchOptions::default(),
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "$100\n");
    }

    #[test]
    fn replace_literal_preserves_whole_word_and_case_options() {
        let (registry, id, root) = fixture("replace-literal-options");
        fs::write(root.join("a.txt"), "User username user\n").unwrap();
        let options = TextSearchOptions {
            case_sensitive: false,
            whole_word: true,
            ..Default::default()
        };

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "user",
            "$user = 5",
            &options,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 2,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "$user = 5 username $user = 5\n"
        );
    }

    #[test]
    fn replace_preserve_case_uses_whole_match_rules_in_literal_and_regex_modes() {
        let cases = [
            ("upper", "FOO", "foo", "next", false, "NEXT"),
            ("title", "Foo", "foo", "next value", false, "Next value"),
            ("lower", "foo", "foo", "NextValue", false, "NextValue"),
            ("mixed", "fOO", "foo", "NextValue", false, "NextValue"),
            (
                "mixed-separated-whole-match",
                "FOO-bar",
                "foo-bar",
                "next-value",
                false,
                "next-value",
            ),
            (
                "regex-expanded-first",
                "FOO-FOO",
                "(foo)-(foo)",
                "${1}bar",
                true,
                "FOOBAR",
            ),
            ("literal-dollar", "FOO", "foo", "$text", false, "$TEXT"),
        ];

        for (name, content, query, replacement, is_regex, expected) in cases {
            let (registry, id, root) = fixture(name);
            fs::write(root.join("a.txt"), content).unwrap();
            let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
                "caseSensitive": false,
                "isRegex": is_regex,
                "preserveCase": true
            }))
            .unwrap();

            WorkspaceFileRepository::new(&registry).replace_in_path(
                &id,
                Path::new("a.txt"),
                query,
                replacement,
                &options,
            );

            assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), expected);
        }
    }

    #[test]
    fn replace_preserve_case_is_a_no_op_for_an_exact_case_sensitive_match() {
        let (registry, id, root) = fixture("preserve-case-sensitive");
        fs::write(root.join("a.txt"), "foo").unwrap();
        let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
            "caseSensitive": true,
            "preserveCase": true
        }))
        .unwrap();

        WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "foo",
            "NextValue",
            &options,
        );

        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "NextValue");
    }

    #[test]
    fn replace_preserve_case_applies_unconditionally_to_an_upper_case_sensitive_match() {
        let (registry, id, root) = fixture("preserve-upper-case-sensitive");
        fs::write(root.join("a.txt"), "FOO").unwrap();
        let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
            "caseSensitive": true,
            "preserveCase": true
        }))
        .unwrap();

        WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "FOO",
            "NextValue",
            &options,
        );

        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "NEXTVALUE");
    }

    #[test]
    fn replace_honors_nested_gitignore_and_file_masks() {
        let (registry, id, root) = fixture("replace-ignore");
        fs::create_dir_all(root.join("src/generated")).unwrap();
        fs::write(root.join("src/.gitignore"), "generated/\n").unwrap();
        fs::write(root.join("src/a.php"), "needle").unwrap();
        fs::write(root.join("src/a.txt"), "needle").unwrap();
        fs::write(root.join("src/generated/a.php"), "needle").unwrap();
        let options = TextSearchOptions {
            file_mask: Some("*.php".into()),
            ..Default::default()
        };
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("src"),
            "needle",
            "thread",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("src/a.php")).unwrap(),
            "thread"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/a.txt")).unwrap(),
            "needle"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/generated/a.php")).unwrap(),
            "needle"
        );
    }

    #[test]
    fn replace_rejects_escape_and_symlink_scope() {
        let (registry, id, root) = fixture("replace-reject");
        let outside = root.with_extension("replace-outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("a.txt"), "needle").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.replace_in_path(
                &id,
                Path::new("../a.txt"),
                "needle",
                "x",
                &Default::default()
            ),
            WorkspaceReplaceResult::Error { .. }
        ));
        assert!(matches!(
            repository.replace_in_path(&id, Path::new("link"), "needle", "x", &Default::default()),
            WorkspaceReplaceResult::Error { .. }
        ));
        assert_eq!(fs::read_to_string(outside.join("a.txt")).unwrap(), "needle");
    }

    #[test]
    fn replace_reports_concurrent_target_swap_as_conflict_without_overwrite() {
        let (registry, id, root) = fixture("replace-conflict");
        fs::write(root.join("a.txt"), "needle").unwrap();
        install_hook("save-after-temp-create", move |_, parent, target, _| {
            assert_eq!(unsafe { libc::unlinkat(parent, target.as_ptr(), 0) }, 0);
            let fd = unsafe {
                libc::openat(
                    parent,
                    target.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut replacement = unsafe { File::from_raw_fd(fd) };
            replacement.write_all(b"concurrent").unwrap();
        });
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "needle",
            "thread",
            &Default::default(),
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Conflict {
                total_replacements: 0,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "concurrent"
        );
    }
}
