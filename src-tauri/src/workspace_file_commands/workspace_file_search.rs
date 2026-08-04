use super::file_index::{
    VisitedDirectory, WorkspaceFileIndexBuilder, WorkspaceFileIndexCache, WorkspaceFileIndexKey,
};
use super::search_policy::{load_directory_gitignore, FileMask};
use super::{
    fstat, is_skippable_text_search_candidate_error, open_directory_path, open_regular,
    DescriptorFileSearchResult, DescriptorTextSearchResponse, DescriptorTextSearchResult,
    DirectoryStream, DirectoryStreamEntry, WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
    WORKSPACE_TEXT_SEARCH_FILE_SIZE_LIMIT, WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT,
    WORKSPACE_TEXT_SEARCH_READ_CHUNK_BYTES, WORKSPACE_TEXT_SEARCH_RESPONSE_BYTE_LIMIT,
};
use crate::file_fuzzy_matcher::{compare_ranked_paths, file_match_rank, FileMatchRank};
use crate::workspace_registry::ManagedWorkspaceDescriptor;
use regex::Regex;
use std::{
    cmp::Ordering,
    fs::File,
    io::{self, Read},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::Arc,
};

const WORKSPACE_FILE_SEARCH_RESPONSE_BYTE_LIMIT: usize = 2 * 1024 * 1024;
pub(super) const SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES: usize = 512;
pub(super) const DESCRIPTOR_FILE_SEARCH_NAME_BYTE_LIMIT: usize = 255;
pub(super) const DESCRIPTOR_FILE_SEARCH_RELATIVE_PATH_BYTE_LIMIT: usize = 4_096;

struct IgnoreScope {
    matcher: ignore::gitignore::Gitignore,
    parent: Option<Arc<IgnoreScope>>,
}

#[cfg(test)]
pub(super) fn collect_ranked_files(
    root: &File,
    scope: &Path,
    query: &str,
    limit: usize,
    visited_limit: usize,
    display_root: &Path,
) -> io::Result<Vec<(PathBuf, FileMatchRank)>> {
    collect_ranked_files_with_truncation(
        root,
        scope,
        query,
        limit,
        visited_limit,
        display_root,
        &|| true,
    )
    .map(|(ranked, _)| ranked)
}

#[cfg(test)]
pub(super) fn collect_ranked_files_with_truncation(
    root: &File,
    scope: &Path,
    query: &str,
    limit: usize,
    visited_limit: usize,
    display_root: &Path,
    is_current: &dyn Fn() -> bool,
) -> io::Result<(Vec<(PathBuf, FileMatchRank)>, bool)> {
    let mut sink = RankingWalkSink::new(query, limit, scope, None);
    let walk_truncated = visit_workspace_files(
        root,
        scope,
        visited_limit,
        display_root,
        is_current,
        &mut sink,
    )?;
    let (ranked, result_truncated) = sink.ranked.finish();
    Ok((ranked, walk_truncated || result_truncated))
}

pub(super) trait WorkspaceWalkSink {
    fn visit_file(&mut self, relative: PathBuf) -> io::Result<bool>;

    fn projection_omitted(&mut self) {}

    fn directory_completed(&mut self, _visited: &VisitedDirectory<'_>) -> io::Result<()> {
        Ok(())
    }
}

pub(super) struct FileVisitor<'a> {
    pub(super) visit: &'a mut dyn FnMut(PathBuf) -> io::Result<bool>,
    pub(super) projection_truncated: &'a mut bool,
}

impl WorkspaceWalkSink for FileVisitor<'_> {
    fn visit_file(&mut self, relative: PathBuf) -> io::Result<bool> {
        (self.visit)(relative)
    }

    fn projection_omitted(&mut self) {
        *self.projection_truncated = true;
    }
}

struct RankingWalkSink<'a> {
    query: &'a str,
    projection_scope: &'a Path,
    ranked: RankedPaths,
    index: Option<WorkspaceFileIndexBuilder>,
    projection_truncated: bool,
}

impl<'a> RankingWalkSink<'a> {
    fn new(
        query: &'a str,
        limit: usize,
        projection_scope: &'a Path,
        index: Option<WorkspaceFileIndexBuilder>,
    ) -> Self {
        Self {
            query,
            projection_scope,
            ranked: RankedPaths::new(limit),
            index,
            projection_truncated: false,
        }
    }
}

impl WorkspaceWalkSink for RankingWalkSink<'_> {
    fn visit_file(&mut self, relative: PathBuf) -> io::Result<bool> {
        let projected = relative
            .strip_prefix(self.projection_scope)
            .unwrap_or(&relative);
        if !is_descriptor_file_search_path(projected) {
            self.projection_truncated = true;
            return Ok(true);
        }
        let display = relative
            .to_str()
            .expect("validated descriptor file-search paths are UTF-8");
        self.ranked.offer(&relative, display, self.query);
        if let Some(index) = self.index.as_mut() {
            index.record_file(&relative, display);
        }
        Ok(true)
    }

    fn directory_completed(&mut self, visited: &VisitedDirectory<'_>) -> io::Result<()> {
        let Some(index) = self.index.as_mut() else {
            return Ok(());
        };
        index.record_directory(visited)
    }

    fn projection_omitted(&mut self) {
        self.projection_truncated = true;
    }
}

pub(super) fn is_descriptor_file_search_path(relative: &Path) -> bool {
    let Some(relative_path) = relative.to_str() else {
        return false;
    };
    let Some(name) = relative.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !relative_path.is_empty()
        && relative_path.len() <= DESCRIPTOR_FILE_SEARCH_RELATIVE_PATH_BYTE_LIMIT
        && name.len() <= DESCRIPTOR_FILE_SEARCH_NAME_BYTE_LIMIT
        && !relative_path.chars().any(char::is_control)
        && !relative_path.contains('\\')
        && !is_windows_drive_prefixed(relative_path)
}

fn is_windows_drive_prefixed(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub(super) fn visit_workspace_files(
    root: &File,
    scope: &Path,
    visited_limit: usize,
    display_root: &Path,
    is_current: &dyn Fn() -> bool,
    sink: &mut dyn WorkspaceWalkSink,
) -> io::Result<bool> {
    let mut stack = vec![(scope.to_path_buf(), None::<Arc<IgnoreScope>>)];
    let mut visited = 0usize;
    while let Some((relative, inherited_ignores)) = stack.pop() {
        ensure_current(is_current)?;
        let directory = open_directory_path(root.as_raw_fd(), &relative)?;
        let before = fstat(directory.as_raw_fd())?;
        let mut ignores = inherited_ignores;
        let mut gitignore_stamp = None;
        if let Some((local, stamp)) =
            load_directory_gitignore(&directory, &display_root.join(&relative))?
        {
            gitignore_stamp = Some(stamp);
            ignores = Some(Arc::new(IgnoreScope {
                matcher: local,
                parent: ignores,
            }));
        }
        let mut entries = DirectoryStream::open(&directory)?;
        loop {
            ensure_current(is_current)?;
            if visited >= visited_limit {
                if entries.has_unexamined_entry()? || !stack.is_empty() {
                    return Ok(true);
                }
                break;
            }

            // Charge the raw directory-entry budget before readdir can stat or allocate a name.
            visited += 1;
            let entry = match entries.next_search_entry(&directory)? {
                DirectoryStreamEntry::Entry(entry) => entry,
                DirectoryStreamEntry::Skipped => continue,
                DirectoryStreamEntry::End => {
                    visited -= 1;
                    break;
                }
            };
            let path = relative.join(&entry.name);
            if !entry.name_is_utf8 {
                sink.projection_omitted();
                continue;
            }
            if crate::ignore_matcher::is_default_ignored_name(&entry.name)
                || ignore_chain_ignores(&ignores, &display_root.join(&path), entry.is_directory)
            {
                continue;
            }
            if entry.is_directory {
                stack.push((path, ignores.clone()));
                continue;
            }
            if !sink.visit_file(path)? {
                return Ok(true);
            }
        }
        sink.directory_completed(&VisitedDirectory {
            relative: &relative,
            before,
            after: fstat(directory.as_raw_fd())?,
            gitignore: gitignore_stamp,
        })?;
    }
    Ok(false)
}

pub(super) fn ensure_current(is_current: &dyn Fn() -> bool) -> io::Result<()> {
    if is_current() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "workspace file search was superseded",
        ))
    }
}

struct RankedEntry {
    path: PathBuf,
    display: String,
    rank: FileMatchRank,
}

pub(super) struct RankedPaths {
    entries: Vec<RankedEntry>,
    limit: usize,
    truncated: bool,
}

impl RankedPaths {
    pub(super) fn new(limit: usize) -> Self {
        Self {
            entries: Vec::with_capacity(limit.min(1024)),
            limit,
            truncated: false,
        }
    }

    pub(super) fn offer(&mut self, path: &Path, display: &str, query: &str) {
        let Some(rank) = file_score(display, query) else {
            return;
        };
        if self.entries.len() >= self.limit {
            self.truncated = true;
            let Some(last) = self.entries.last() else {
                return;
            };
            if compare_ranked_paths(&last.display, last.rank, display, rank) != Ordering::Greater {
                return;
            }
        }
        self.insert_ranked(RankedEntry {
            path: path.to_path_buf(),
            display: display.to_owned(),
            rank,
        });
    }

    pub(super) fn absorb(&mut self, other: RankedPaths) {
        self.truncated |= other.truncated;
        for entry in other.entries {
            self.insert_ranked(entry);
        }
    }

    fn insert_ranked(&mut self, entry: RankedEntry) {
        if self.entries.len() >= self.limit {
            self.truncated = true;
            let Some(last) = self.entries.last() else {
                return;
            };
            if compare_ranked_paths(&last.display, last.rank, &entry.display, entry.rank)
                != Ordering::Greater
            {
                return;
            }
        }
        let index = self
            .entries
            .binary_search_by(|existing| {
                compare_ranked_paths(&existing.display, existing.rank, &entry.display, entry.rank)
            })
            .unwrap_or_else(|index| index);
        self.entries.insert(index, entry);
        self.entries.truncate(self.limit);
    }

    pub(super) fn finish(self) -> (Vec<(PathBuf, FileMatchRank)>, bool) {
        (
            self.entries
                .into_iter()
                .map(|entry| (entry.path, entry.rank))
                .collect(),
            self.truncated,
        )
    }
}

pub(super) fn file_score(path: &str, query: &str) -> Option<FileMatchRank> {
    file_match_rank(path, query)
}

fn ignore_chain_ignores(
    scope: &Option<Arc<IgnoreScope>>,
    absolute: &Path,
    is_directory: bool,
) -> bool {
    let mut chain = Vec::new();
    let mut current = scope.as_deref();
    while let Some(node) = current {
        chain.push(&node.matcher);
        current = node.parent.as_deref();
    }
    let mut ignored = false;
    for matcher in chain.into_iter().rev() {
        match matcher.matched_path_or_any_parents(absolute, is_directory) {
            ignore::Match::Ignore(_) => ignored = true,
            ignore::Match::Whitelist(_) => ignored = false,
            ignore::Match::None => {}
        }
    }
    ignored
}

pub(crate) struct PreparedDescriptorFileSearch {
    pub(super) root: File,
    pub(super) descriptor: ManagedWorkspaceDescriptor,
    pub(super) scope: PathBuf,
    pub(super) query: String,
    pub(super) limit: usize,
    pub(super) file_index: WorkspaceFileIndexCache,
}

#[derive(Debug)]
pub(crate) struct DescriptorFileSearchExecution {
    pub(crate) results: Vec<DescriptorFileSearchResult>,
    pub(crate) truncated: bool,
}

impl PreparedDescriptorFileSearch {
    pub(crate) fn descriptor(&self) -> &ManagedWorkspaceDescriptor {
        &self.descriptor
    }

    fn ranked_paths(
        &self,
        visited_limit: usize,
        is_current: &(dyn Fn() -> bool + Sync),
    ) -> io::Result<(Vec<(PathBuf, FileMatchRank)>, bool)> {
        let key =
            WorkspaceFileIndexKey::of(&self.descriptor.workspace_id, &self.root, &self.scope)?;
        if let Some(index) = self.file_index.resolve(&key, &self.root, is_current)? {
            return index.ranked(&self.query, self.limit, is_current);
        }
        self.file_index.record_crawl();
        let mut sink = RankingWalkSink::new(
            &self.query,
            self.limit,
            &self.scope,
            Some(WorkspaceFileIndexBuilder::new(self.file_index.bounds())),
        );
        let walk_truncated = visit_workspace_files(
            &self.root,
            &self.scope,
            visited_limit,
            &self.descriptor.canonical_root_path,
            is_current,
            &mut sink,
        )?;
        let RankingWalkSink {
            ranked,
            index,
            projection_truncated,
            ..
        } = sink;
        if let Some(builder) = index {
            match builder.finish(walk_truncated, projection_truncated) {
                Ok(index) => self.file_index.store(key, index),
                Err(rejection) => self.file_index.record_rejection(rejection),
            }
        }
        let (ranked, result_truncated) = ranked.finish();
        Ok((
            ranked,
            walk_truncated || projection_truncated || result_truncated,
        ))
    }

    pub(crate) fn execute(
        self,
        is_current: &(dyn Fn() -> bool + Sync),
    ) -> io::Result<DescriptorFileSearchExecution> {
        self.execute_with_visited_limit(WORKSPACE_FILE_SEARCH_VISITED_LIMIT, is_current)
    }

    pub(super) fn execute_with_visited_limit(
        self,
        visited_limit: usize,
        is_current: &(dyn Fn() -> bool + Sync),
    ) -> io::Result<DescriptorFileSearchExecution> {
        let (files, walk_truncated) = self.ranked_paths(visited_limit, is_current)?;
        let mut results = Vec::new();
        let mut response_bytes = SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES;
        let mut output_truncated = false;
        for (relative, _) in files {
            let projected = relative.strip_prefix(&self.scope).unwrap_or(&relative);
            if !is_descriptor_file_search_path(projected) {
                output_truncated = true;
                continue;
            }
            let result = DescriptorFileSearchResult {
                name: relative
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("validated descriptor file-search names are UTF-8")
                    .to_owned(),
                relative_path: projected
                    .to_str()
                    .expect("validated descriptor file-search paths are UTF-8")
                    .to_owned(),
            };
            let serialized_bytes = serde_json::to_vec(&result)
                .map_err(|error| io::Error::other(error.to_string()))?
                .len()
                .saturating_add(1);
            if response_bytes.saturating_add(serialized_bytes)
                > WORKSPACE_FILE_SEARCH_RESPONSE_BYTE_LIMIT
            {
                output_truncated = true;
                break;
            }
            response_bytes += serialized_bytes;
            results.push(result);
        }
        let truncated = walk_truncated || output_truncated;
        Ok(DescriptorFileSearchExecution { results, truncated })
    }
}

pub(crate) struct PreparedDescriptorTextSearch {
    pub(super) root: File,
    pub(super) descriptor: ManagedWorkspaceDescriptor,
    pub(super) scope: PathBuf,
    pub(super) matcher: Regex,
    pub(super) masks: Option<FileMask>,
    pub(super) limit: usize,
}

impl PreparedDescriptorTextSearch {
    pub(crate) fn descriptor(&self) -> &ManagedWorkspaceDescriptor {
        &self.descriptor
    }

    pub(crate) fn execute(
        self,
        is_current: &dyn Fn() -> bool,
    ) -> io::Result<DescriptorTextSearchResponse> {
        let mut results = Vec::new();
        let mut response_bytes = SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES;
        let mut output_truncated = false;
        let mut candidate_skipped = false;
        let mut projection_truncated = false;
        let scope = self.scope;
        let root = self.root;
        let matcher = self.matcher;
        let masks = self.masks;
        let limit = self.limit;

        let walk_truncated = visit_workspace_files(
            &root,
            &scope,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &self.descriptor.canonical_root_path,
            is_current,
            &mut FileVisitor {
                visit: &mut |relative| {
                    if let Some(mask) = &masks {
                        let matched = mask.matcher.matched(&relative, false);
                        if matched.is_ignore() || (mask.has_positive && !matched.is_whitelist()) {
                            return Ok(true);
                        }
                    }
                    ensure_search_current(is_current)?;
                    let file = match open_regular(root.as_raw_fd(), &relative, libc::O_RDONLY) {
                        Ok(file) => file,
                        Err(error) if is_skippable_text_search_candidate_error(&error) => {
                            candidate_skipped = true;
                            return Ok(true);
                        }
                        Err(error) => return Err(error),
                    };
                    ensure_search_current(is_current)?;
                    let bytes = match read_bounded_search_file(file, is_current) {
                        Ok(bytes) => bytes,
                        Err(error) if is_skippable_text_search_candidate_error(&error) => {
                            candidate_skipped = true;
                            return Ok(true);
                        }
                        Err(error) => return Err(error),
                    };
                    ensure_search_current(is_current)?;
                    if bytes.len() as u64 > WORKSPACE_TEXT_SEARCH_FILE_SIZE_LIMIT {
                        candidate_skipped = true;
                        return Ok(true);
                    }
                    if bytes.contains(&0) {
                        return Ok(true);
                    }
                    let content = match String::from_utf8(bytes) {
                        Ok(content) => content,
                        Err(_) => return Ok(true),
                    };
                    let relative_path = relative
                        .strip_prefix(&scope)
                        .unwrap_or(&relative)
                        .to_string_lossy()
                        .into_owned();

                    for (line_index, line) in content.lines().enumerate() {
                        ensure_search_current(is_current)?;
                        for found in matcher.find_iter(line) {
                            if results.len() >= limit {
                                output_truncated = true;
                                return Ok(false);
                            }
                            let preview = bounded_match_preview(line, found.start(), found.end());
                            let result = DescriptorTextSearchResult {
                                relative_path: relative_path.clone(),
                                line_number: line_index as u64 + 1,
                                column: line[..found.start()].encode_utf16().count() as u64 + 1,
                                line_text: preview.line_text,
                                match_start: preview.match_start,
                                match_end: preview.match_end,
                                preview_truncated: preview.preview_truncated,
                                match_truncated: preview.match_truncated,
                            };
                            let serialized_bytes = serde_json::to_vec(&result)
                                .map_err(|error| io::Error::other(error.to_string()))?
                                .len()
                                .saturating_add(1);
                            if response_bytes.saturating_add(serialized_bytes)
                                > WORKSPACE_TEXT_SEARCH_RESPONSE_BYTE_LIMIT
                            {
                                output_truncated = true;
                                return Ok(false);
                            }
                            response_bytes += serialized_bytes;
                            results.push(result);
                            if results.len() >= limit {
                                output_truncated = true;
                                return Ok(false);
                            }
                        }
                    }
                    Ok(true)
                },
                projection_truncated: &mut projection_truncated,
            },
        )?;
        ensure_search_current(is_current)?;
        Ok(DescriptorTextSearchResponse {
            results,
            truncated: walk_truncated
                || output_truncated
                || candidate_skipped
                || projection_truncated,
            request_generation: String::new(),
        })
    }
}

fn read_bounded_search_file(mut file: File, is_current: &dyn Fn() -> bool) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; WORKSPACE_TEXT_SEARCH_READ_CHUNK_BYTES];
    loop {
        ensure_search_current(is_current)?;
        let remaining =
            (WORKSPACE_TEXT_SEARCH_FILE_SIZE_LIMIT + 1).saturating_sub(bytes.len() as u64) as usize;
        if remaining == 0 {
            return Ok(bytes);
        }
        let chunk_limit = remaining.min(WORKSPACE_TEXT_SEARCH_READ_CHUNK_BYTES);
        let read = file.read(&mut chunk[..chunk_limit])?;
        if read == 0 {
            return Ok(bytes);
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

struct BoundedMatchPreview {
    line_text: String,
    match_start: u64,
    match_end: u64,
    preview_truncated: bool,
    match_truncated: bool,
}

fn bounded_match_preview(line: &str, match_start: usize, match_end: usize) -> BoundedMatchPreview {
    if line.len() <= WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT {
        return BoundedMatchPreview {
            line_text: line.to_string(),
            match_start: line[..match_start].chars().count() as u64,
            match_end: line[..match_end].chars().count() as u64,
            preview_truncated: false,
            match_truncated: false,
        };
    }

    let match_bytes = match_end.saturating_sub(match_start);
    let desired_prefix = WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT
        .saturating_sub(match_bytes.min(WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT))
        / 2;
    let mut start = match_start.saturating_sub(desired_prefix);
    while start > 0 && !line.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = start
        .saturating_add(WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT)
        .min(line.len());
    while end > start && !line.is_char_boundary(end) {
        end -= 1;
    }
    if match_end <= line.len()
        && match_end > end
        && match_bytes <= WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT
    {
        end = match_end;
        start = end.saturating_sub(WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT);
        while start > 0 && !line.is_char_boundary(start) {
            start -= 1;
        }
    }
    let visible_match_end = match_end.min(end);
    BoundedMatchPreview {
        line_text: line[start..end].to_string(),
        match_start: line[start..match_start.min(end)].chars().count() as u64,
        match_end: line[start..visible_match_end].chars().count() as u64,
        preview_truncated: true,
        match_truncated: match_end > end,
    }
}

fn ensure_search_current(is_current: &dyn Fn() -> bool) -> io::Result<()> {
    if is_current() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "workspace search was superseded",
        ))
    }
}
