use super::{cstring, open_directory_at, run_test_hook, sync_after_commit, MutationFailure};
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
