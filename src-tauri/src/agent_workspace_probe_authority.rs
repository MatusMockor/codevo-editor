use crate::trust::{WorkspaceTrustLaunchLease, WorkspaceTrustService, WorkspaceTrustSnapshot};
use crate::workspace_registry::{
    opened_root_path, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
};
use std::{
    fs::File,
    marker::PhantomData,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub(crate) trait WorkspaceProbeAuthorityErrors {
    const UNKNOWN_WORKSPACE: &'static str;
    const UNTRUSTED_WORKSPACE: &'static str;
    const TRUST_BUSY: &'static str;
    const UNAVAILABLE: &'static str;
}

pub(crate) struct WorkspaceProbeAuthority<E> {
    pub(crate) descriptor: ManagedWorkspaceDescriptor,
    pub(crate) repository_root: PathBuf,
    pub(crate) repository_authority: Arc<File>,
    pub(crate) trust: WorkspaceTrustSnapshot,
    errors: PhantomData<fn() -> E>,
}

fn registered_ancestor<E: WorkspaceProbeAuthorityErrors>(
    registry: &WorkspaceRegistry,
    canonical_root: &Path,
) -> Result<ManagedWorkspaceDescriptor, String> {
    canonical_root
        .ancestors()
        .find_map(|ancestor| registry.descriptor_for_registered_path(ancestor).ok())
        .ok_or_else(|| E::UNKNOWN_WORKSPACE.to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_descendant_directory<E: WorkspaceProbeAuthorityErrors>(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    relative_path: &Path,
) -> Result<File, String> {
    registry
        .open_directory_descendant(workspace_id, relative_path)
        .map_err(|_| E::UNKNOWN_WORKSPACE.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_descendant_directory<E: WorkspaceProbeAuthorityErrors>(
    _registry: &WorkspaceRegistry,
    _workspace_id: &WorkspaceId,
    _relative_path: &Path,
) -> Result<File, String> {
    Err(E::UNKNOWN_WORKSPACE.to_string())
}

fn open_repository_authority<E: WorkspaceProbeAuthorityErrors>(
    registry: &WorkspaceRegistry,
    descriptor: &ManagedWorkspaceDescriptor,
    canonical_root: &Path,
) -> Result<File, String> {
    let relative_path = canonical_root
        .strip_prefix(&descriptor.canonical_root_path)
        .map_err(|_| E::UNKNOWN_WORKSPACE.to_string())?;
    if relative_path.as_os_str().is_empty() {
        return registry
            .clone_root(&descriptor.workspace_id)
            .map_err(|_| E::UNKNOWN_WORKSPACE.to_string());
    }
    open_descendant_directory::<E>(registry, &descriptor.workspace_id, relative_path)
}

#[cfg(unix)]
fn retained_directory_matches_path(retained: &File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    match (retained.metadata(), path.metadata()) {
        (Ok(retained_metadata), Ok(path_metadata)) => {
            retained_metadata.dev() == path_metadata.dev()
                && retained_metadata.ino() == path_metadata.ino()
        }
        _ => false,
    }
}

#[cfg(not(unix))]
fn retained_directory_matches_path(_retained: &File, _path: &Path) -> bool {
    false
}

fn trust_snapshot<E: WorkspaceProbeAuthorityErrors>(
    trust: &Mutex<WorkspaceTrustService>,
    descriptor: &ManagedWorkspaceDescriptor,
) -> Result<WorkspaceTrustSnapshot, String> {
    Ok(trust
        .lock()
        .map_err(|_| E::UNAVAILABLE.to_string())?
        .snapshot_canonical(&descriptor.canonical_root_path.to_string_lossy()))
}

impl<E: WorkspaceProbeAuthorityErrors> WorkspaceProbeAuthority<E> {
    pub(crate) fn capture(
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
        repository_root: &str,
    ) -> Result<Self, String> {
        let canonical_root = crate::canonicalize_workspace_root(repository_root)
            .map_err(|_| E::UNKNOWN_WORKSPACE.to_string())?;
        let descriptor = registered_ancestor::<E>(registry, &canonical_root)?;
        let repository_authority =
            open_repository_authority::<E>(registry, &descriptor, &canonical_root)?;
        let opened_root = opened_root_path(&repository_authority)
            .map_err(|_| E::UNKNOWN_WORKSPACE.to_string())?;
        if opened_root != canonical_root
            || !retained_directory_matches_path(&repository_authority, &canonical_root)
        {
            return Err(E::UNKNOWN_WORKSPACE.to_string());
        }
        let trust = trust_snapshot::<E>(trust, &descriptor)?;
        if !trust.trusted {
            return Err(E::UNTRUSTED_WORKSPACE.to_string());
        }
        Ok(Self {
            descriptor,
            repository_root: canonical_root,
            repository_authority: Arc::new(repository_authority),
            trust,
            errors: PhantomData,
        })
    }

    pub(crate) fn reserve_trust(
        &self,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<WorkspaceTrustLaunchLease, String> {
        trust
            .lock()
            .map_err(|_| E::UNAVAILABLE.to_string())?
            .reserve_launch(&self.trust)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    return E::UNTRUSTED_WORKSPACE.to_string();
                }
                E::TRUST_BUSY.to_string()
            })
    }

    pub(crate) fn revalidate(
        &self,
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<(), String> {
        let current = Self::capture(registry, trust, &self.repository_root.to_string_lossy())?;
        let unchanged = current.descriptor == self.descriptor
            && current.repository_root == self.repository_root
            && current.trust == self.trust
            && retained_directory_matches_path(
                &self.repository_authority,
                &current.repository_root,
            );
        if !unchanged {
            return Err(E::UNKNOWN_WORKSPACE.to_string());
        }
        Ok(())
    }

    pub(crate) fn revalidate_registration(
        &self,
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<(), String> {
        let descriptor = registry
            .descriptor(&self.descriptor.workspace_id)
            .map_err(|_| E::UNKNOWN_WORKSPACE.to_string())?;
        if descriptor != self.descriptor {
            return Err(E::UNKNOWN_WORKSPACE.to_string());
        }
        let trust = trust_snapshot::<E>(trust, &self.descriptor)?;
        if !trust.trusted {
            return Err(E::UNTRUSTED_WORKSPACE.to_string());
        }
        if trust != self.trust {
            return Err(E::UNKNOWN_WORKSPACE.to_string());
        }
        Ok(())
    }
}
