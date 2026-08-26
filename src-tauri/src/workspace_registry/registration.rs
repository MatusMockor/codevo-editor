#[cfg(not(any(target_os = "macos", target_os = "linux")))]
use super::unsupported_platform;
use super::{
    detect_case_sensitivity, detect_unicode_policy, lock_error, normalize_registered_path,
    open_selected_root, opened_root_path, random_workspace_id, unknown_workspace, ManagedWorkspace,
    ManagedWorkspaceDescriptor, RegisteredPathOwner, RegisteredRootIdentity, RegistrationAdmission,
    WorkspaceId, WorkspaceRegistrationAuthority, WorkspaceRegistry, MAX_REGISTERED_PATHS_GLOBAL,
    MAX_REGISTERED_PATHS_PER_WORKSPACE,
};
use serde::Serialize;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::os::unix::fs::MetadataExt;
use std::{
    collections::BTreeSet,
    io,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const MAX_ACTIVE_REGISTRATION_ADMISSIONS: usize = 128;
const RETAINED_REGISTRATION_ADMISSION: u64 = 0;

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceRegistration {
    pub(crate) descriptor: ManagedWorkspaceDescriptor,
    pub(crate) receipt: WorkspaceRegistrationReceipt,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceRegistrationReceipt {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) admission_token: u64,
    pub(crate) created_identity: bool,
}

pub(crate) struct WorkspaceRegistrationRollback<'a> {
    registry: &'a WorkspaceRegistry,
    pub(crate) descriptor: ManagedWorkspaceDescriptor,
    pub(crate) removed_identity: bool,
    admission_token: u64,
    pending_generation: Option<u64>,
    cleanup_started: bool,
    settled: bool,
}

impl WorkspaceRegistrationRollback<'_> {
    pub(crate) fn begin_cleanup(&mut self) {
        if self.removed_identity {
            self.cleanup_started = true;
        }
    }

    pub(crate) fn finalize(mut self) -> io::Result<()> {
        if let Some(generation) = self.pending_generation {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                self.registry.finalize_registration_rollback(
                    &self.descriptor.workspace_id,
                    self.admission_token,
                    generation,
                )?;
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            {
                let _ = generation;
                return Err(unsupported_platform());
            }
        }
        self.settled = true;
        Ok(())
    }
}

impl Drop for WorkspaceRegistrationRollback<'_> {
    fn drop(&mut self) {
        if !self.settled {
            if let Some(generation) = self.pending_generation {
                #[cfg(any(target_os = "macos", target_os = "linux"))]
                {
                    if self.cleanup_started {
                        let _ = self.registry.finalize_registration_rollback(
                            &self.descriptor.workspace_id,
                            self.admission_token,
                            generation,
                        );
                    } else {
                        let _ = self.registry.cancel_registration_rollback(
                            &self.descriptor.workspace_id,
                            generation,
                        );
                    }
                }
                #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                let _ = generation;
            }
        }
    }
}

impl WorkspaceRegistry {
    pub(crate) fn claim_latest_registration(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<WorkspaceRegistrationAuthority<'_>> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (workspace_id, admission_token);
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let operation = self.lock_operations()?;
            let workspaces = self.workspaces.lock().map_err(lock_error)?;
            let workspace = workspaces
                .get(workspace_id)
                .filter(|workspace| workspace.unregister_generation.is_none())
                .ok_or_else(unknown_workspace)?;
            if workspace.latest_admission_token != admission_token
                || !workspace
                    .registration_admissions
                    .contains_key(&admission_token)
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "workspace registration admission is stale",
                ));
            }
            let descriptor = workspace.descriptor.clone();
            drop(workspaces);
            Ok(WorkspaceRegistrationAuthority {
                descriptor,
                _operation: operation,
            })
        }
    }

    pub(crate) fn register(
        &self,
        selected_root: impl AsRef<Path>,
    ) -> io::Result<ManagedWorkspaceDescriptor> {
        let registration = self.register_with_receipt(selected_root)?;
        self.retain_registration(
            &registration.receipt.workspace_id,
            registration.receipt.admission_token,
        )?;
        Ok(registration.descriptor)
    }

    pub(crate) fn register_with_receipt(
        &self,
        selected_root: impl AsRef<Path>,
    ) -> io::Result<WorkspaceRegistration> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = selected_root;
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            self.register_with_receipt_and_hook(selected_root.as_ref(), || Ok(()))
        }
    }

    #[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
    pub(crate) fn register_with_hook<F>(
        &self,
        selected_root: &Path,
        post_open: F,
    ) -> io::Result<ManagedWorkspaceDescriptor>
    where
        F: FnOnce() -> io::Result<()>,
    {
        self.register_with_receipt_and_hook(selected_root, post_open)
            .map(|registration| registration.descriptor)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn register_with_receipt_and_hook<F>(
        &self,
        selected_root: &Path,
        post_open: F,
    ) -> io::Result<WorkspaceRegistration>
    where
        F: FnOnce() -> io::Result<()>,
    {
        // Following the selected root is allowed only here. Every later access starts at this FD.
        // Opening and the test hook stay outside the global registry operation gate.
        let root = open_selected_root(selected_root)?;
        post_open()?;
        let canonical_root_path = opened_root_path(&root)?;
        let root_metadata = root.metadata()?;
        let root_identity = RegisteredRootIdentity {
            device: root_metadata.dev(),
            inode: root_metadata.ino(),
        };
        if selected_root.to_str().is_none() || canonical_root_path.to_str().is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "workspace root path is not valid UTF-8",
            ));
        }
        let selected_path = normalize_registered_path(selected_root)?;
        let canonical_path = normalize_registered_path(&canonical_root_path)?;
        let requested_paths = BTreeSet::from([selected_path, canonical_path]);

        let operation = self.lock_operations()?;
        let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
        let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
        if workspaces.values().any(|workspace| {
            workspace.unregister_generation.is_some()
                && workspace.descriptor.canonical_root_path == canonical_root_path
        }) {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace root is being unregistered",
            ));
        }
        let existing = workspaces.iter().find(|(_, workspace)| {
            workspace.unregister_generation.is_none()
                && workspace.descriptor.canonical_root_path == canonical_root_path
        });
        if existing.is_some_and(|(_, workspace)| workspace.root_identity != root_identity) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "canonical workspace path is retained by a different root identity",
            ));
        }
        let existing_id = existing.map(|(workspace_id, _)| workspace_id.clone());
        let created_identity = existing_id.is_none();
        let workspace_id = match existing_id {
            Some(workspace_id) => workspace_id,
            None => random_workspace_id()?,
        };
        if workspaces.get(&workspace_id).is_some_and(|workspace| {
            workspace.registration_admissions.len() >= MAX_ACTIVE_REGISTRATION_ADMISSIONS
        }) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "workspace active registration admission limit exceeded",
            ));
        }
        let mut assigned_paths = requested_paths.clone();
        if let Some(existing) = workspaces.get(&workspace_id) {
            assigned_paths.extend(existing.registered_paths.iter().cloned());
        }
        if assigned_paths.len() > MAX_REGISTERED_PATHS_PER_WORKSPACE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "workspace registered-path limit exceeded",
            ));
        }
        let new_global_paths = assigned_paths
            .iter()
            .filter(|path| !path_owners.contains_key(*path))
            .count();
        if path_owners.len().saturating_add(new_global_paths) > MAX_REGISTERED_PATHS_GLOBAL {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "global workspace registered-path limit exceeded",
            ));
        }
        for path in &requested_paths {
            let Some(previous_owner) = path_owners.get(path) else {
                continue;
            };
            if previous_owner.workspace_id == workspace_id {
                continue;
            }
            let previous = workspaces
                .get(&previous_owner.workspace_id)
                .ok_or_else(unknown_workspace)?;
            if previous.unregister_generation.is_none()
                && normalize_registered_path(&previous.descriptor.canonical_root_path)? == *path
            {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "canonical workspace path is already owned by another retained identity",
                ));
            }
        }
        let admission_token = self.next_registration_token()?;
        let added_registered_paths = requested_paths
            .iter()
            .filter(|path| {
                !workspaces
                    .get(&workspace_id)
                    .is_some_and(|workspace| workspace.registered_paths.contains(*path))
            })
            .cloned()
            .collect::<BTreeSet<_>>();

        for path in &requested_paths {
            let previous_owner = path_owners.insert(
                path.clone(),
                RegisteredPathOwner {
                    workspace_id: workspace_id.clone(),
                    admission_token,
                },
            );
            let Some(previous_owner) = previous_owner else {
                continue;
            };
            if let Some(previous) = workspaces.get_mut(&previous_owner.workspace_id) {
                remove_path_from_admission(
                    previous,
                    previous_owner.admission_token,
                    path,
                    previous_owner.workspace_id != workspace_id,
                );
            }
        }

        let descriptor = if let Some(existing) = workspaces.get_mut(&workspace_id) {
            existing.registered_paths = assigned_paths;
            existing.latest_admission_token = admission_token;
            existing.registration_admissions.insert(
                admission_token,
                RegistrationAdmission {
                    added_registered_paths,
                },
            );
            ManagedWorkspaceDescriptor {
                workspace_id: workspace_id.clone(),
                selected_root_path: selected_root.to_path_buf(),
                canonical_root_path,
                case_sensitive: existing.descriptor.case_sensitive,
                unicode_normalization_policy: existing
                    .descriptor
                    .unicode_normalization_policy
                    .clone(),
            }
        } else {
            let descriptor = ManagedWorkspaceDescriptor {
                workspace_id: workspace_id.clone(),
                selected_root_path: selected_root.to_path_buf(),
                canonical_root_path,
                case_sensitive: detect_case_sensitivity(&root),
                unicode_normalization_policy: detect_unicode_policy(&root),
            };
            let registration_admissions = [(
                admission_token,
                RegistrationAdmission {
                    added_registered_paths,
                },
            )]
            .into_iter()
            .collect();
            workspaces.insert(
                descriptor.workspace_id.clone(),
                ManagedWorkspace {
                    descriptor: descriptor.clone(),
                    registered_paths: assigned_paths,
                    registration_admissions,
                    latest_admission_token: admission_token,
                    root,
                    root_identity,
                    unregister_generation: None,
                    #[cfg(test)]
                    drop_hook: None,
                },
            );
            descriptor
        };
        let transition = self
            .registration_operations
            .begin_transition(&workspace_id)?;
        drop(path_owners);
        drop(workspaces);
        drop(operation);
        transition.wait()?;
        let _operation = self.lock_operations()?;
        let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
        let current = workspaces.get(&workspace_id).is_some_and(|workspace| {
            workspace.unregister_generation.is_none()
                && workspace.latest_admission_token == admission_token
                && workspace
                    .registration_admissions
                    .contains_key(&admission_token)
        });
        if !current {
            let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
            remove_losing_registration_admission(
                &mut workspaces,
                &mut path_owners,
                &workspace_id,
                admission_token,
            );
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "workspace registration admission was replaced before publication",
            ));
        }
        self.registration_operations
            .publish_latest(&workspace_id, admission_token)?;
        Ok(WorkspaceRegistration {
            receipt: WorkspaceRegistrationReceipt {
                workspace_id,
                admission_token,
                created_identity,
            },
            descriptor,
        })
    }

    pub(crate) fn rollback_registration(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<Option<WorkspaceRegistrationRollback<'_>>> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (workspace_id, admission_token);
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let operation = self.lock_operations()?;
            let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
            let Some(workspace) = workspaces.get_mut(workspace_id) else {
                return Ok(None);
            };
            if workspace.unregister_generation.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "workspace unregister is in progress",
                ));
            }
            if !workspace
                .registration_admissions
                .contains_key(&admission_token)
            {
                return Ok(None);
            }
            let descriptor = workspace.descriptor.clone();
            if workspace.registration_admissions.len() == 1 {
                let generation = self
                    .next_unregister_generation
                    .fetch_add(1, Ordering::Relaxed)
                    .wrapping_add(1);
                workspace.unregister_generation = Some(generation);
                let transition = self
                    .registration_operations
                    .begin_transition(workspace_id)?;
                drop(workspaces);
                drop(operation);
                transition.wait()?;
                return Ok(Some(WorkspaceRegistrationRollback {
                    registry: self,
                    descriptor,
                    removed_identity: true,
                    admission_token,
                    pending_generation: Some(generation),
                    cleanup_started: false,
                    settled: false,
                }));
            }
            let Some(admission) = workspace.registration_admissions.remove(&admission_token) else {
                return Ok(None);
            };
            let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
            for path in admission.added_registered_paths {
                if path_owners.get(&path).is_some_and(|owner| {
                    owner.workspace_id == *workspace_id && owner.admission_token == admission_token
                }) {
                    path_owners.remove(&path);
                    workspace.registered_paths.remove(&path);
                }
            }
            workspace.latest_admission_token = *workspace
                .registration_admissions
                .keys()
                .max()
                .expect("non-empty admission registry");
            let latest_admission_token = workspace.latest_admission_token;
            let transition = self
                .registration_operations
                .begin_transition(workspace_id)?;
            drop(path_owners);
            drop(workspaces);
            drop(operation);
            transition.wait()?;
            self.publish_registration_if_latest(workspace_id, latest_admission_token)?;
            Ok(Some(WorkspaceRegistrationRollback {
                registry: self,
                descriptor,
                removed_identity: false,
                admission_token,
                pending_generation: None,
                cleanup_started: false,
                settled: true,
            }))
        }
    }

    fn retain_registration(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<()> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (workspace_id, admission_token);
            Err(unsupported_platform())
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let operation = self.lock_operations()?;
            let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
            let workspace = workspaces
                .get_mut(workspace_id)
                .ok_or_else(unknown_workspace)?;
            workspace
                .registration_admissions
                .remove(&admission_token)
                .ok_or_else(|| io::Error::other("workspace registration admission is stale"))?;
            workspace
                .registration_admissions
                .entry(RETAINED_REGISTRATION_ADMISSION)
                .or_insert_with(|| RegistrationAdmission {
                    added_registered_paths: BTreeSet::new(),
                });
            workspace.latest_admission_token = *workspace
                .registration_admissions
                .keys()
                .max()
                .expect("retained registration admission");
            let latest_admission_token = workspace.latest_admission_token;
            let transition = self
                .registration_operations
                .begin_transition(workspace_id)?;
            drop(workspaces);
            drop(operation);
            transition.wait()?;
            self.publish_registration_if_latest(workspace_id, latest_admission_token)?;
            Ok(())
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn publish_registration_if_latest(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<()> {
        let _operation = self.lock_operations()?;
        let workspaces = self.workspaces.lock().map_err(lock_error)?;
        let current = workspaces.get(workspace_id).is_some_and(|workspace| {
            workspace.unregister_generation.is_none()
                && workspace.latest_admission_token == admission_token
                && workspace
                    .registration_admissions
                    .contains_key(&admission_token)
        });
        if !current {
            return Ok(());
        }
        self.registration_operations
            .publish_latest(workspace_id, admission_token)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn finalize_registration_rollback(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
        generation: u64,
    ) -> io::Result<()> {
        let operation = self.lock_operations()?;
        let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
        let matches_reservation = workspaces.get(workspace_id).is_some_and(|workspace| {
            workspace.unregister_generation == Some(generation)
                && workspace.registration_admissions.len() == 1
                && workspace
                    .registration_admissions
                    .contains_key(&admission_token)
        });
        if !matches_reservation {
            return Err(io::Error::other(
                "workspace registration rollback reservation is stale",
            ));
        }
        let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
        let removed = workspaces
            .remove(workspace_id)
            .ok_or_else(unknown_workspace)?;
        self.registration_operations
            .revoke_workspace(workspace_id)?;
        for path in &removed.registered_paths {
            if path_owners
                .get(path)
                .is_some_and(|owner| owner.workspace_id == *workspace_id)
            {
                path_owners.remove(path);
            }
        }
        drop(path_owners);
        drop(workspaces);
        drop(operation);
        drop(removed);
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn cancel_registration_rollback(
        &self,
        workspace_id: &WorkspaceId,
        generation: u64,
    ) -> io::Result<()> {
        let _operation = self.lock_operations()?;
        let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
        if let Some(workspace) = workspaces.get_mut(workspace_id) {
            if workspace.unregister_generation == Some(generation) {
                workspace.unregister_generation = None;
                self.registration_operations
                    .replace_latest(workspace_id, workspace.latest_admission_token)?;
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn next_registration_token(&self) -> io::Result<u64> {
        let previous = self.next_registration_token.fetch_add(1, Ordering::Relaxed);
        if previous >= MAX_JAVASCRIPT_SAFE_INTEGER {
            return Err(io::Error::other(
                "workspace registration admission token space exhausted",
            ));
        }
        Ok(previous + 1)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn remove_path_from_admission(
    workspace: &mut ManagedWorkspace,
    admission_token: u64,
    path: &PathBuf,
    remove_registered_path: bool,
) {
    if remove_registered_path {
        workspace.registered_paths.remove(path);
    }
    if let Some(admission) = workspace.registration_admissions.get_mut(&admission_token) {
        admission.added_registered_paths.remove(path);
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn remove_losing_registration_admission(
    workspaces: &mut std::collections::HashMap<WorkspaceId, ManagedWorkspace>,
    path_owners: &mut std::collections::HashMap<PathBuf, RegisteredPathOwner>,
    workspace_id: &WorkspaceId,
    admission_token: u64,
) {
    let Some(workspace) = workspaces.get_mut(workspace_id) else {
        return;
    };
    let Some(admission) = workspace.registration_admissions.remove(&admission_token) else {
        return;
    };
    if workspace.registration_admissions.is_empty() {
        workspace.registration_admissions.insert(
            RETAINED_REGISTRATION_ADMISSION,
            RegistrationAdmission {
                added_registered_paths: BTreeSet::new(),
            },
        );
        workspace.latest_admission_token = RETAINED_REGISTRATION_ADMISSION;
        for path in workspace.registered_paths.iter() {
            let Some(owner) = path_owners.get_mut(path) else {
                continue;
            };
            if owner.workspace_id == *workspace_id && owner.admission_token == admission_token {
                owner.admission_token = RETAINED_REGISTRATION_ADMISSION;
            }
        }
        return;
    }
    workspace.latest_admission_token = *workspace
        .registration_admissions
        .keys()
        .max()
        .expect("non-empty admission registry");
    for path in admission.added_registered_paths {
        let owned_by_loser = path_owners.get(&path).is_some_and(|owner| {
            owner.workspace_id == *workspace_id && owner.admission_token == admission_token
        });
        if !owned_by_loser {
            continue;
        }
        path_owners.remove(&path);
        workspace.registered_paths.remove(&path);
    }
    for path in workspace.registered_paths.iter() {
        let Some(owner) = path_owners.get_mut(path) else {
            continue;
        };
        if owner.workspace_id == *workspace_id && owner.admission_token == admission_token {
            owner.admission_token = workspace.latest_admission_token;
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::symlink,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-workspace-registration-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn exact_created_receipt_rolls_back_late_registration() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("created");
        let registration = registry.register_with_receipt(&root).unwrap();

        let rollback = registry
            .rollback_registration(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap()
            .expect("exact receipt");

        assert!(registration.receipt.created_identity);
        assert!(rollback.removed_identity);
        assert_eq!(rollback.descriptor, registration.descriptor);
        rollback.finalize().unwrap();
        assert!(registry
            .descriptor(&registration.descriptor.workspace_id)
            .is_err());
    }

    #[test]
    fn existing_alias_rollback_removes_only_the_exact_alias() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("alias-root").canonicalize().unwrap();
        let alias_parent = temp_root("alias-parent");
        let alias = alias_parent.join("alias");
        symlink(&root, &alias).unwrap();
        let original = registry.register_with_receipt(&root).unwrap();
        let alias_registration = registry.register_with_receipt(&alias).unwrap();

        let rollback = registry
            .rollback_registration(
                &alias_registration.receipt.workspace_id,
                alias_registration.receipt.admission_token,
            )
            .unwrap()
            .expect("alias receipt");

        assert!(!alias_registration.receipt.created_identity);
        assert!(!rollback.removed_identity);
        rollback.finalize().unwrap();
        assert_eq!(
            registry
                .descriptor(&original.descriptor.workspace_id)
                .unwrap()
                .workspace_id,
            original.descriptor.workspace_id
        );
        assert!(registry.descriptor_for_registered_path(&alias).is_err());
        assert_eq!(
            registry
                .descriptor_for_registered_path(&root)
                .unwrap()
                .workspace_id,
            original.descriptor.workspace_id
        );
    }

    #[test]
    fn both_same_owner_receipts_rollback_without_leaving_an_unowned_identity() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("aba");
        let first = registry.register_with_receipt(&root).unwrap();
        let second = registry.register_with_receipt(&root).unwrap();

        let rollback = registry
            .rollback_registration(&first.receipt.workspace_id, first.receipt.admission_token)
            .unwrap()
            .expect("retained creation receipt");

        assert!(!rollback.removed_identity);
        rollback.finalize().unwrap();
        assert_eq!(
            first.descriptor.workspace_id,
            second.descriptor.workspace_id
        );
        assert_eq!(
            registry
                .descriptor(&second.descriptor.workspace_id)
                .unwrap()
                .workspace_id,
            second.descriptor.workspace_id
        );
        let second_rollback = registry
            .rollback_registration(&second.receipt.workspace_id, second.receipt.admission_token)
            .unwrap()
            .expect("newer receipt");
        assert!(second_rollback.removed_identity);
        second_rollback.finalize().unwrap();
        assert!(registry
            .descriptor(&second.descriptor.workspace_id)
            .is_err());
    }

    #[test]
    fn latest_registration_claim_rejects_same_root_aba_predecessor() {
        let registry = WorkspaceRegistry::new();
        let root_a = temp_root("claim-aba-a");
        let root_b = temp_root("claim-aba-b");
        let first_a = registry.register_with_receipt(&root_a).unwrap();
        let _workspace_b = registry.register_with_receipt(&root_b).unwrap();
        let replacement_a = registry.register_with_receipt(&root_a).unwrap();

        let stale = registry.claim_latest_registration(
            &first_a.receipt.workspace_id,
            first_a.receipt.admission_token,
        );
        let error = match stale {
            Ok(_) => panic!("predecessor admission must be stale"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);

        let current = registry
            .claim_latest_registration(
                &replacement_a.receipt.workspace_id,
                replacement_a.receipt.admission_token,
            )
            .unwrap();
        assert_eq!(current.descriptor(), &replacement_a.descriptor);
    }

    #[test]
    fn path_replacement_cannot_reuse_a_retained_root_identity() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("inode-replacement");
        let moved_root = root.with_extension("moved");
        let original = registry.register_with_receipt(&root).unwrap();
        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir(&root).unwrap();

        assert_eq!(
            registry.register_with_receipt(&root).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        let workspaces = registry.workspaces.lock().unwrap();
        let retained = workspaces.get(&original.receipt.workspace_id).unwrap();
        assert_eq!(retained.registration_admissions.len(), 1);
        assert_eq!(
            retained.latest_admission_token,
            original.receipt.admission_token
        );
        drop(workspaces);

        registry.unregister(&original.receipt.workspace_id).unwrap();
        let replacement = registry.register_with_receipt(&root).unwrap();
        assert_ne!(
            replacement.receipt.workspace_id,
            original.receipt.workspace_id
        );
    }

    #[test]
    fn reverse_order_same_owner_rollbacks_remove_identity_only_after_last_admission() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("reverse");
        let first = registry.register_with_receipt(&root).unwrap();
        let second = registry.register_with_receipt(&root).unwrap();

        let second_rollback = registry
            .rollback_registration(&second.receipt.workspace_id, second.receipt.admission_token)
            .unwrap()
            .expect("newer receipt");
        assert!(!second_rollback.removed_identity);
        second_rollback.finalize().unwrap();
        let first_rollback = registry
            .rollback_registration(&first.receipt.workspace_id, first.receipt.admission_token)
            .unwrap()
            .expect("creation receipt");
        assert!(first_rollback.removed_identity);
        first_rollback.finalize().unwrap();
        assert!(registry.descriptor(&first.descriptor.workspace_id).is_err());
    }

    #[test]
    fn rollback_is_fenced_while_unregister_is_in_flight_and_authority_is_restored_on_error() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("unregister-race");
        let registration = registry.register_with_receipt(&root).unwrap();

        let cleanup_error = registry
            .unregister_after(&registration.descriptor.workspace_id, |_| {
                assert_eq!(
                    registry
                        .rollback_registration(
                            &registration.receipt.workspace_id,
                            registration.receipt.admission_token,
                        )
                        .err()
                        .expect("rollback must be fenced")
                        .kind(),
                    io::ErrorKind::WouldBlock
                );
                Err(io::Error::other("cleanup failed"))
            })
            .unwrap_err();

        assert_eq!(cleanup_error.to_string(), "cleanup failed");
        assert_eq!(
            registry
                .descriptor_for_registered_path(&root)
                .unwrap()
                .workspace_id,
            registration.descriptor.workspace_id
        );
    }

    #[test]
    fn last_admission_rollback_fences_same_root_replacement_until_runtime_cleanup_finishes() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("rollback-fence");
        let registration = registry.register_with_receipt(&root).unwrap();
        let rollback = registry
            .rollback_registration(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap()
            .expect("last admission rollback reservation");

        assert!(rollback.removed_identity);
        assert_eq!(
            registry.register_with_receipt(&root).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        rollback.finalize().unwrap();
        let replacement = registry.register_with_receipt(&root).unwrap();
        assert_ne!(
            replacement.descriptor.workspace_id,
            registration.descriptor.workspace_id
        );
        assert_eq!(
            registry
                .descriptor(&replacement.descriptor.workspace_id)
                .unwrap()
                .workspace_id,
            replacement.descriptor.workspace_id
        );
    }

    #[test]
    fn dropped_last_admission_rollback_restores_full_authority() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("rollback-drop");
        let registration = registry.register_with_receipt(&root).unwrap();
        let rollback = registry
            .rollback_registration(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap()
            .expect("last admission rollback reservation");

        assert!(registry
            .descriptor(&registration.descriptor.workspace_id)
            .is_err());
        drop(rollback);
        assert_eq!(
            registry
                .descriptor_for_registered_path(&root)
                .unwrap()
                .workspace_id,
            registration.descriptor.workspace_id
        );
    }

    #[test]
    fn dropped_rollback_after_runtime_cleanup_begins_finalizes_identity_removal() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("rollback-cleanup-panic");
        let registration = registry.register_with_receipt(&root).unwrap();
        let mut rollback = registry
            .rollback_registration(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap()
            .expect("last admission rollback reservation");

        rollback.begin_cleanup();
        drop(rollback);

        assert!(registry
            .descriptor(&registration.descriptor.workspace_id)
            .is_err());
        let replacement = registry.register_with_receipt(&root).unwrap();
        assert_ne!(
            replacement.descriptor.workspace_id,
            registration.descriptor.workspace_id
        );
    }

    #[test]
    fn accepts_128_active_admissions_and_rejects_the_129th() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("admission-cap");
        assert_eq!(MAX_ACTIVE_REGISTRATION_ADMISSIONS, 128);
        for _ in 0..128 {
            registry.register_with_receipt(&root).unwrap();
        }
        assert_eq!(
            registry.register_with_receipt(&root).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn alias_cap_rejection_does_not_consume_an_admission_token() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("cap-root").canonicalize().unwrap();
        let aliases = temp_root("cap-aliases");
        let original = registry.register_with_receipt(&root).unwrap();
        let mut last_alias = None;
        for index in 0..(MAX_REGISTERED_PATHS_PER_WORKSPACE - 1) {
            let alias = aliases.join(format!("alias-{index}"));
            symlink(&root, &alias).unwrap();
            last_alias = Some(registry.register_with_receipt(&alias).unwrap());
        }
        let rejected_alias = aliases.join("rejected");
        symlink(&root, &rejected_alias).unwrap();
        assert_eq!(
            registry
                .register_with_receipt(&rejected_alias)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );

        let last_alias = last_alias.unwrap();
        registry
            .rollback_registration(
                &last_alias.receipt.workspace_id,
                last_alias.receipt.admission_token,
            )
            .unwrap()
            .expect("last alias rollback")
            .finalize()
            .unwrap();
        let admitted_after_rejection = registry.register_with_receipt(&rejected_alias).unwrap();
        assert_eq!(
            admitted_after_rejection.receipt.admission_token,
            last_alias.receipt.admission_token + 1
        );
        assert_eq!(
            admitted_after_rejection.descriptor.workspace_id,
            original.descriptor.workspace_id
        );
    }
}
