use super::{
    create_unique_file, mutation_result, open_parent, regular_unlinked_stat, rename_at, revision,
    same_entry_snapshot, same_identity, split_path, stat_at, sync_after_commit, sync_dir,
    CommandFailure, FileCommandResult, FileRevision, MutationFailure, MutationResult, TempCleanup,
    WorkspaceFileRepository,
};
use crate::workspace_registry::WorkspaceId;
use std::{
    fs::File,
    io::{self, Write},
    os::fd::{AsRawFd, FromRawFd},
    path::Path,
};

impl WorkspaceFileRepository<'_> {
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

    pub fn create_text_with_content(
        &self,
        id: &WorkspaceId,
        path: &Path,
        content: &str,
    ) -> FileCommandResult {
        match self.create_text_with_content_inner(id, path, content) {
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

    fn create_text_with_content_inner(
        &self,
        id: &WorkspaceId,
        path: &Path,
        content: &str,
    ) -> Result<FileRevision, CommandFailure> {
        let _operation = self.registry.lock_operations()?;
        let root = self.registry.clone_root(id)?;
        let (parent_path, name) = split_path(path)?;
        let parent = open_parent(root.as_raw_fd(), parent_path)?;
        let (mut staged, staged_name) = create_unique_file(parent.as_raw_fd(), &name, 0o666)?;
        let staged_identity = regular_unlinked_stat(staged.as_raw_fd())?;
        let mut cleanup = TempCleanup {
            parent: parent.as_raw_fd(),
            name: staged_name.clone(),
            expected: staged_identity,
            armed: true,
        };

        if let Err(error) = staged
            .write_all(content.as_bytes())
            .and_then(|()| staged.sync_all())
        {
            if let Err(message) = cleanup.finish_before_return() {
                return Err(CommandFailure::Partial(message, None));
            }
            return Err(error.into());
        }
        let staged_stat = regular_unlinked_stat(staged.as_raw_fd())?;
        if !same_identity(&staged_identity, &staged_stat) {
            return Err(CommandFailure::Conflict(
                "temporary create file changed before commit".into(),
            ));
        }

        if let Err(error) = rename_at(
            parent.as_raw_fd(),
            &staged_name,
            parent.as_raw_fd(),
            &name,
            true,
        ) {
            let failure = if error.kind() == io::ErrorKind::AlreadyExists {
                CommandFailure::Conflict("file already exists; it was not overwritten".into())
            } else {
                CommandFailure::Io(error)
            };
            if let Err(message) = cleanup.finish_before_return() {
                return Err(CommandFailure::Partial(message, None));
            }
            return Err(failure);
        }
        cleanup.armed = false;
        let created_revision = revision(&staged_stat, content.as_bytes());
        let live_target = stat_at(parent.as_raw_fd(), &name).map_err(|error| {
            CommandFailure::Partial(
                format!("file was created, but its target could not be revalidated: {error}"),
                Some(created_revision.clone()),
            )
        })?;
        if !same_entry_snapshot(&staged_stat, &live_target) {
            return Err(CommandFailure::Partial(
                "created file target changed immediately after commit".into(),
                Some(created_revision),
            ));
        }
        if let Err(error) = sync_dir(&parent) {
            return Err(CommandFailure::Partial(
                format!("file was created but its directory could not be synced: {error}"),
                Some(created_revision),
            ));
        }
        Ok(created_revision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_registry::WorkspaceRegistry;
    use std::{
        ffi::OsString,
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    };

    #[test]
    fn commits_exact_content_and_revision() {
        let (registry, id, root) = fixture("content");
        let result = WorkspaceFileRepository::new(&registry).create_text_with_content(
            &id,
            Path::new("launch.json"),
            "{\"version\":1}\n",
        );
        let FileCommandResult::Success {
            revision: Some(created),
        } = result
        else {
            panic!("expected successful create");
        };
        assert_eq!(
            fs::read_to_string(root.join("launch.json")).unwrap(),
            "{\"version\":1}\n"
        );
        let snapshot = WorkspaceFileRepository::new(&registry)
            .read_text(&id, Path::new("launch.json"))
            .unwrap();
        assert_eq!(snapshot.revision, created);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_overwrites_an_existing_target() {
        let (registry, id, root) = fixture("conflict");
        fs::write(root.join("launch.json"), "original").unwrap();
        let result = WorkspaceFileRepository::new(&registry).create_text_with_content(
            &id,
            Path::new("launch.json"),
            "replacement",
        );
        assert!(matches!(result, FileCommandResult::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(root.join("launch.json")).unwrap(),
            "original"
        );
        let leftovers = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(leftovers, vec![OsString::from("launch.json")]);
        fs::remove_dir_all(root).unwrap();
    }

    fn fixture(label: &str) -> (Arc<WorkspaceRegistry>, WorkspaceId, PathBuf) {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let root = std::env::temp_dir().join(format!(
            "mockor-atomic-create-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let registry = Arc::new(WorkspaceRegistry::new());
        let id = registry.register(&root).unwrap().workspace_id;
        (registry, id, root)
    }
}
