use crate::workspace_registry::{opened_root_path, WorkspaceRegistry};
use std::fs::File;
use std::path::Path;

/// Stable backend authority for a debug workspace. Production sessions use the
/// retained workspace descriptor identity; the canonical-root variant keeps
/// isolated registry tests and legacy internal callers strictly namespaced.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) enum DebugWorkspaceAuthority {
    RetainedWorkspace {
        workspace_id: String,
        canonical_root: String,
    },
    CanonicalRoot(String),
}

/// Retains the admitted directory object across asynchronous debugger startup.
/// The live path must always be derived from this descriptor immediately before
/// building/spawning an adapter; reopening the user supplied path would allow a
/// renamed workspace to be replaced by a different directory.
#[derive(Debug)]
pub(crate) struct RetainedDebugWorkspaceRoot {
    pub(crate) authority: DebugWorkspaceAuthority,
    root: File,
}

impl RetainedDebugWorkspaceRoot {
    pub(crate) fn live_path(&self) -> Result<std::path::PathBuf, String> {
        opened_root_path(&self.root)
            .map_err(|_| "Debug workspace identity changed during startup.".to_string())
    }

    pub(crate) fn try_clone_directory(&self) -> Result<File, String> {
        self.root
            .try_clone()
            .map_err(|_| "Debug workspace identity changed during startup.".to_string())
    }
}

pub(crate) fn retain_workspace_root(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<RetainedDebugWorkspaceRoot, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|_| "Debug workspace is not registered or its identity changed.".to_string())?;
    let descriptor = registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map_err(|_| "Debug workspace is not registered or its identity changed.".to_string())?;
    let root = registry
        .clone_root(&descriptor.workspace_id)
        .map_err(|_| "Debug workspace is not registered or its identity changed.".to_string())?;
    Ok(RetainedDebugWorkspaceRoot {
        authority: authority_from_descriptor(&descriptor),
        root,
    })
}

pub(crate) fn retained_workspace_authority(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<DebugWorkspaceAuthority, String> {
    let descriptor = registry
        .descriptor_for_registered_path(Path::new(root_path))
        .map_err(|_| "Debug workspace is not registered or its identity changed.".to_string())?;
    Ok(authority_from_descriptor(&descriptor))
}

fn authority_from_descriptor(
    descriptor: &crate::workspace_registry::ManagedWorkspaceDescriptor,
) -> DebugWorkspaceAuthority {
    DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: descriptor.workspace_id.as_str().to_string(),
        canonical_root: descriptor
            .canonical_root_path
            .to_string_lossy()
            .into_owned(),
    }
}

#[cfg(test)]
#[path = "debug_workspace_authority_tests.rs"]
mod tests;
