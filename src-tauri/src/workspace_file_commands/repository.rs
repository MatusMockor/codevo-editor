#[cfg(test)]
use super::DescriptorFileSearchResult;
use super::{
    directory_entries, entry_rank, mutation_result, mutation_settlement, open_directory_path,
    DescriptorFileEntry, MutationFailure, MutationResult, PreparedDescriptorFileSearch,
    WorkspaceFileIndexCache, WorkspaceFileRepository,
};
use crate::{
    workspace::FileEntryKind,
    workspace_registry::{validate_relative_path, WorkspaceId, WorkspaceRegistry},
};
use std::{io, os::fd::AsRawFd, path::Path};

impl<'a> WorkspaceFileRepository<'a> {
    pub fn new(registry: &'a WorkspaceRegistry) -> Self {
        Self { registry }
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
            .map(|execution| execution.results)
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
    pub fn create_directory(&self, id: &WorkspaceId, path: &Path) -> MutationResult {
        mutation_result(self.create_directory_inner(id, path))
    }

    fn create_directory_inner(&self, id: &WorkspaceId, path: &Path) -> Result<(), MutationFailure> {
        mutation_settlement::create_directory(self.registry, id, path)
    }
}
