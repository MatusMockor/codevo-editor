use crate::workspace_registry::{opened_root_path, ManagedWorkspaceDescriptor, WorkspaceRegistry};
use std::fs::File;
use std::path::{Path, PathBuf};

const UNREGISTERED_WORKSPACE_ERROR: &str = "Workspace is not registered or its identity changed.";
const CHANGED_WORKSPACE_ERROR: &str = "Workspace identity changed.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceAuthority {
    pub(crate) workspace_id: String,
    pub(crate) canonical_root: String,
}

impl WorkspaceAuthority {
    pub(crate) fn from_descriptor(descriptor: &ManagedWorkspaceDescriptor) -> Self {
        Self {
            workspace_id: descriptor.workspace_id.as_str().to_string(),
            canonical_root: descriptor
                .canonical_root_path
                .to_string_lossy()
                .into_owned(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct RetainedWorkspaceRoot {
    pub(crate) authority: WorkspaceAuthority,
    root: File,
}

impl RetainedWorkspaceRoot {
    pub(crate) fn live_path(&self) -> Result<PathBuf, String> {
        opened_root_path(&self.root).map_err(|_| CHANGED_WORKSPACE_ERROR.to_string())
    }

    pub(crate) fn try_clone_directory(&self) -> Result<File, String> {
        self.root
            .try_clone()
            .map_err(|_| CHANGED_WORKSPACE_ERROR.to_string())
    }
}

pub(crate) fn retain_workspace_root(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<RetainedWorkspaceRoot, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|_| UNREGISTERED_WORKSPACE_ERROR.to_string())?;
    let descriptor = registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map_err(|_| UNREGISTERED_WORKSPACE_ERROR.to_string())?;
    let root = registry
        .clone_root(&descriptor.workspace_id)
        .map_err(|_| UNREGISTERED_WORKSPACE_ERROR.to_string())?;
    Ok(RetainedWorkspaceRoot {
        authority: WorkspaceAuthority::from_descriptor(&descriptor),
        root,
    })
}

#[cfg(test)]
#[path = "retained_workspace_root_tests.rs"]
mod tests;
