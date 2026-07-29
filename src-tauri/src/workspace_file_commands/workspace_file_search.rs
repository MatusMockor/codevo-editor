use super::{
    is_skippable_text_search_candidate_error, load_directory_gitignore, open_directory_path,
    open_regular, DescriptorFileSearchResult, DescriptorTextSearchResponse,
    DescriptorTextSearchResult, DirectoryStream, DirectoryStreamEntry, FileMask,
    WORKSPACE_FILE_SEARCH_VISITED_LIMIT, WORKSPACE_TEXT_SEARCH_FILE_SIZE_LIMIT,
    WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT, WORKSPACE_TEXT_SEARCH_READ_CHUNK_BYTES,
    WORKSPACE_TEXT_SEARCH_RESPONSE_BYTE_LIMIT,
};
use crate::file_fuzzy_matcher::{compare_ranked_paths, file_match_rank, FileMatchRank};
use crate::workspace_registry::ManagedWorkspaceDescriptor;
use regex::Regex;
use std::{
    fs::File,
    io::{self, Read},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::Arc,
};

const WORKSPACE_FILE_SEARCH_RESPONSE_BYTE_LIMIT: usize = 2 * 1024 * 1024;
pub(super) const SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES: usize = 512;

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

pub(super) fn collect_ranked_files_with_truncation(
    root: &File,
    scope: &Path,
    query: &str,
    limit: usize,
    visited_limit: usize,
    display_root: &Path,
    is_current: &dyn Fn() -> bool,
) -> io::Result<(Vec<(PathBuf, FileMatchRank)>, bool)> {
    let mut ranked = Vec::with_capacity(limit);
    let mut result_truncated = false;
    let truncated = visit_workspace_files(
        root,
        scope,
        visited_limit,
        display_root,
        is_current,
        &mut |path| {
            let Some(rank) = file_score(&path.to_string_lossy(), query) else {
                return Ok(true);
            };
            result_truncated |= insert_ranked_path(&mut ranked, path, rank, limit);
            Ok(true)
        },
    )?;
    Ok((ranked, truncated || result_truncated))
}

pub(super) fn visit_workspace_files(
    root: &File,
    scope: &Path,
    visited_limit: usize,
    display_root: &Path,
    is_current: &dyn Fn() -> bool,
    visit_file: &mut dyn FnMut(PathBuf) -> io::Result<bool>,
) -> io::Result<bool> {
    let mut stack = vec![(scope.to_path_buf(), None::<Arc<IgnoreScope>>)];
    let mut visited = 0usize;
    while let Some((relative, inherited_ignores)) = stack.pop() {
        ensure_current(is_current)?;
        let directory = open_directory_path(root.as_raw_fd(), &relative)?;
        let mut ignores = inherited_ignores;
        if let Some(local) = load_directory_gitignore(&directory, &display_root.join(&relative))? {
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
            let entry = match entries.next_entry(&directory)? {
                DirectoryStreamEntry::Entry(entry) => entry,
                DirectoryStreamEntry::Skipped => continue,
                DirectoryStreamEntry::End => {
                    visited -= 1;
                    break;
                }
            };
            let path = relative.join(&entry.name);
            if crate::ignore_matcher::is_default_ignored_name(&entry.name)
                || ignore_chain_ignores(&ignores, &display_root.join(&path), entry.is_directory)
            {
                continue;
            }
            if entry.is_directory {
                stack.push((path, ignores.clone()));
                continue;
            }
            if !visit_file(path)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn ensure_current(is_current: &dyn Fn() -> bool) -> io::Result<()> {
    if is_current() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "workspace file search was superseded",
        ))
    }
}

fn insert_ranked_path(
    ranked: &mut Vec<(PathBuf, FileMatchRank)>,
    path: PathBuf,
    rank: FileMatchRank,
    limit: usize,
) -> bool {
    let discarded = ranked.len() >= limit;
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
    discarded
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
}

impl PreparedDescriptorFileSearch {
    pub(crate) fn descriptor(&self) -> &ManagedWorkspaceDescriptor {
        &self.descriptor
    }

    pub(crate) fn execute(
        self,
        is_current: &dyn Fn() -> bool,
    ) -> io::Result<Vec<DescriptorFileSearchResult>> {
        let (files, walk_truncated) = collect_ranked_files_with_truncation(
            &self.root,
            &self.scope,
            &self.query,
            self.limit,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &self.descriptor.canonical_root_path,
            is_current,
        )?;
        let mut results = Vec::new();
        let mut response_bytes = SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES;
        let mut output_truncated = false;
        for (relative, _) in files {
            let result = DescriptorFileSearchResult {
                name: relative
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                relative_path: relative
                    .strip_prefix(&self.scope)
                    .unwrap_or(&relative)
                    .to_string_lossy()
                    .into_owned(),
                truncated: walk_truncated,
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
        if truncated {
            results
                .iter_mut()
                .for_each(|result| result.truncated = true);
        }
        if truncated && results.is_empty() {
            results.push(DescriptorFileSearchResult {
                name: String::new(),
                relative_path: String::new(),
                truncated: true,
            });
        }
        Ok(results)
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
            &mut |relative| {
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
        )?;
        ensure_search_current(is_current)?;
        Ok(DescriptorTextSearchResponse {
            results,
            truncated: walk_truncated || output_truncated || candidate_skipped,
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
