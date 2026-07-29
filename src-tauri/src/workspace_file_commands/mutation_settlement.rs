use super::{
    cstring, delete_entry, ensure_supported_entry, open_directory_at, open_parent, rename_at,
    rename_overwrite, run_test_hook, same_entry_snapshot, split_path, stat_at, sync_after_commit,
    MutationFailure,
};
use crate::workspace_registry::{validate_relative_path, WorkspaceId, WorkspaceRegistry};
use std::{io, os::fd::AsRawFd, path::Path};

pub(super) fn create_directory(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    path: &Path,
) -> Result<(), MutationFailure> {
    let _operation = registry.lock_operations()?;
    let root = registry.clone_root(id)?;
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

pub(super) fn delete(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    path: &Path,
) -> Result<(), MutationFailure> {
    let _operation = registry.lock_operations()?;
    let root = registry.clone_root(id)?;
    let (parent_path, name) = split_path(path)?;
    let parent = open_parent(root.as_raw_fd(), parent_path)?;
    let expected = stat_at(parent.as_raw_fd(), &name)?;
    delete_entry(parent.as_raw_fd(), &name, &expected)?;
    sync_after_commit(&parent, "path was deleted")
}

pub(super) fn rename(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    from: &Path,
    to: &Path,
    overwrite: bool,
) -> Result<(), MutationFailure> {
    let _operation = registry.lock_operations()?;
    let root = registry.clone_root(id)?;
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
