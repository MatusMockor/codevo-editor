use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, DebugSessionDisposer,
    WorkspaceRuntimeDisposal,
};
use std::io;

pub(super) fn unregister_workspace_with_runtime_cleanup<F>(
    workspace_registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    runtime: WorkspaceRuntimeDisposal<'_>,
    before_runtime_cleanup: impl FnOnce(&ManagedWorkspaceDescriptor),
    after_runtime_cleanup: F,
) -> io::Result<Vec<String>>
where
    F: FnOnce(&ManagedWorkspaceDescriptor, &mut Vec<String>),
{
    let mut errors = Vec::new();
    let mut reservation = match workspace_registry.reserve_unregister(workspace_id) {
        Ok(reservation) => reservation,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(errors),
        Err(error) => return Err(error),
    };
    reservation.begin_cleanup();
    let descriptor = reservation.descriptor();
    before_runtime_cleanup(descriptor);
    if let Err(error) = dispose_workspace_runtime_root(&descriptor.canonical_root_path, runtime) {
        errors.push(format!("Workspace runtime cleanup failed: {error}"));
    }
    after_runtime_cleanup(descriptor, &mut errors);
    reservation.finalize()?;
    Ok(errors)
}

pub(super) struct NoopDebugSessionDisposer;

impl DebugSessionDisposer for NoopDebugSessionDisposer {
    fn stop_debug_session(&self, _root_path: &str) {}
}
