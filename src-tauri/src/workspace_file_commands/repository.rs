use super::{
    atomic_save, collect_files, directory_entries, entry_rank, file_mask, mutation_result,
    mutation_settlement, open_directory_path, open_regular, read_all, regular_unlinked_stat,
    replace_text, revision, same_snapshot, text_matcher, CommandFailure, DescriptorFileEntry,
    DescriptorTextSearchResponse, FileCommandResult, FileRevision, LocalHistorySnapshotSink,
    MutationFailure, MutationResult, PreparedDescriptorFileSearch, PreparedDescriptorTextSearch,
    ReplaceFileFailure, ReplaceFileResult, WorkspaceFileIndexCache, WorkspaceFileRepository,
    WorkspaceReplaceResult, WorkspaceTextFile,
};
#[cfg(test)]
use super::{
    read_image_from_root, DescriptorFileSearchResult, DescriptorTextSearchResult,
    WorkspaceImageFile, WorkspaceImageReadError,
};
use crate::{
    search::TextSearchOptions,
    workspace::FileEntryKind,
    workspace_registry::{validate_relative_path, WorkspaceId, WorkspaceRegistry},
};
use std::{
    io::{self, Seek, SeekFrom},
    os::fd::AsRawFd,
    path::Path,
};

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
    pub(super) fn read_image(
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

    #[cfg(test)]
    pub fn search_files(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
    ) -> io::Result<Vec<DescriptorFileSearchResult>> {
        self.prepare_file_search(&WorkspaceFileIndexCache::new(), id, scope, query, limit)?
            .execute(&|| true)
    }

    pub(crate) fn prepare_file_search(
        &self,
        file_index: &WorkspaceFileIndexCache,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
    ) -> io::Result<PreparedDescriptorFileSearch> {
        if !scope.as_os_str().is_empty() {
            validate_relative_path(scope)?;
        }
        let descriptor = self.registry.descriptor(id)?;
        let root = self.registry.clone_root(id)?;
        Ok(PreparedDescriptorFileSearch {
            root,
            descriptor,
            scope: scope.to_path_buf(),
            query: query.trim().to_lowercase(),
            limit: limit.clamp(1, 500),
            file_index: file_index.clone(),
        })
    }

    #[cfg(test)]
    pub fn search_text(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
        options: &TextSearchOptions,
    ) -> io::Result<Vec<DescriptorTextSearchResult>> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .prepare_text_search(id, scope, query, limit, options)?
            .execute(&|| true)?
            .results)
    }

    pub(crate) fn prepare_text_search(
        &self,
        id: &WorkspaceId,
        scope: &Path,
        query: &str,
        limit: usize,
        options: &TextSearchOptions,
    ) -> io::Result<PreparedDescriptorTextSearch> {
        let query = query.trim();
        if !scope.as_os_str().is_empty() {
            validate_relative_path(scope)?;
        }
        let descriptor = self.registry.descriptor(id)?;
        let root = self.registry.clone_root(id)?;
        let matcher = text_matcher(query, options)?;
        let masks = file_mask(
            options.file_mask.as_deref().unwrap_or(""),
            &descriptor.canonical_root_path,
        )?;
        Ok(PreparedDescriptorTextSearch {
            root,
            descriptor,
            scope: scope.to_path_buf(),
            matcher,
            masks,
            limit: limit.clamp(1, 500),
        })
    }

    pub(crate) fn empty_text_search_response(
        request_generation: String,
    ) -> DescriptorTextSearchResponse {
        DescriptorTextSearchResponse {
            results: Vec::new(),
            truncated: false,
            request_generation,
        }
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
        let local_history_root = display_root.clone();
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
        atomic_save::save_text(self.registry, id, path, content, expected)
    }

    pub fn create_directory(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.create_directory_inner(id, path))
    }

    fn create_directory_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        mutation_settlement::create_directory(self.registry, id, path)
    }

    pub fn delete(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.delete_inner(id, path))
    }

    fn delete_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        mutation_settlement::delete(self.registry, id, path)
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
        mutation_settlement::rename(self.registry, id, from, to, overwrite)
    }
}
