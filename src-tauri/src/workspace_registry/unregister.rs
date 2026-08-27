#[cfg(not(any(target_os = "macos", target_os = "linux")))]
use super::unsupported_platform;
use super::{
    lock_error, unknown_workspace, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
};
use std::{io, path::Path, sync::atomic::Ordering};

pub(crate) struct WorkspaceUnregisterReservation<'a> {
    registry: &'a WorkspaceRegistry,
    descriptor: ManagedWorkspaceDescriptor,
    generation: u64,
    cleanup_started: bool,
    settled: bool,
}

impl WorkspaceUnregisterReservation<'_> {
    pub(crate) fn descriptor(&self) -> &ManagedWorkspaceDescriptor {
        &self.descriptor
    }

    pub(crate) fn begin_cleanup(&mut self) {
        self.cleanup_started = true;
    }

    pub(crate) fn cancel(mut self) -> io::Result<()> {
        self.registry.cancel_unregister(&self)?;
        self.settled = true;
        Ok(())
    }

    pub(crate) fn finalize(mut self) -> io::Result<()> {
        self.registry.finalize_unregister(&self)?;
        self.settled = true;
        Ok(())
    }
}

impl Drop for WorkspaceUnregisterReservation<'_> {
    fn drop(&mut self) {
        if !self.settled {
            if self.cleanup_started {
                let _ = self.registry.finalize_unregister(self);
            } else {
                let _ = self.registry.cancel_unregister(self);
            }
        }
    }
}

impl WorkspaceRegistry {
    pub fn unregister(&self, workspace_id: &WorkspaceId) -> io::Result<()> {
        self.reserve_unregister(workspace_id)?.finalize()
    }

    pub(crate) fn unregister_after<F>(
        &self,
        workspace_id: &WorkspaceId,
        before_remove: F,
    ) -> io::Result<()>
    where
        F: FnOnce(&ManagedWorkspaceDescriptor) -> io::Result<()>,
    {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (workspace_id, before_remove);
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let mut reservation = self.reserve_unregister(workspace_id)?;
            reservation.begin_cleanup();
            if let Err(error) = before_remove(reservation.descriptor()) {
                reservation.cancel()?;
                return Err(error);
            }
            reservation.finalize()
        }
    }

    pub(crate) fn reserve_unregister(
        &self,
        workspace_id: &WorkspaceId,
    ) -> io::Result<WorkspaceUnregisterReservation<'_>> {
        self.reserve_unregister_matching(workspace_id, |_| true)
    }

    pub(crate) fn reserve_unregister_exact(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
        selected_root_path: &Path,
        canonical_root_path: &Path,
    ) -> io::Result<WorkspaceUnregisterReservation<'_>> {
        self.reserve_unregister_matching(workspace_id, |workspace| {
            workspace.latest_admission_token == admission_token
                && workspace
                    .registration_admissions
                    .contains_key(&admission_token)
                && workspace.descriptor.selected_root_path == selected_root_path
                && workspace.descriptor.canonical_root_path == canonical_root_path
        })
    }

    fn reserve_unregister_matching(
        &self,
        workspace_id: &WorkspaceId,
        matches_expected: impl FnOnce(&super::ManagedWorkspace) -> bool,
    ) -> io::Result<WorkspaceUnregisterReservation<'_>> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = workspace_id;
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let operation = self.lock_operations()?;
            if self.has_runtime_start(workspace_id)? {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "workspace runtime start is in progress",
                ));
            }
            let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
            let Some(workspace) = workspaces.get_mut(workspace_id) else {
                return Err(unknown_workspace());
            };
            if !matches_expected(workspace) {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "workspace close identity is stale",
                ));
            }
            if workspace.unregister_generation.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "workspace unregister is already in progress",
                ));
            }
            let generation = self
                .next_unregister_generation
                .fetch_add(1, Ordering::Relaxed)
                .wrapping_add(1);
            workspace.unregister_generation = Some(generation);
            let descriptor = workspace.descriptor.clone();
            let transition = self
                .registration_operations
                .begin_transition(workspace_id)?;
            drop(workspaces);
            drop(operation);
            transition.wait()?;
            Ok(WorkspaceUnregisterReservation {
                registry: self,
                descriptor,
                generation,
                cleanup_started: false,
                settled: false,
            })
        }
    }

    fn finalize_unregister(
        &self,
        reservation: &WorkspaceUnregisterReservation<'_>,
    ) -> io::Result<()> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = reservation;
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let operation = self.lock_operations()?;
            let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
            let matches_reservation = workspaces
                .get(&reservation.descriptor.workspace_id)
                .is_some_and(|workspace| {
                    workspace.unregister_generation == Some(reservation.generation)
                });
            if !matches_reservation {
                return Ok(());
            }
            let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
            let removed = workspaces
                .remove(&reservation.descriptor.workspace_id)
                .ok_or_else(unknown_workspace)?;
            for path in &removed.registered_paths {
                if path_owners
                    .get(path)
                    .is_some_and(|owner| owner.workspace_id == reservation.descriptor.workspace_id)
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
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn cancel_unregister(
        &self,
        reservation: &WorkspaceUnregisterReservation<'_>,
    ) -> io::Result<()> {
        let operation = self.lock_operations()?;
        let mut workspaces = self.workspaces.lock().map_err(lock_error)?;
        let has_replacement = workspaces.values().any(|workspace| {
            workspace.unregister_generation.is_none()
                && workspace.descriptor.workspace_id != reservation.descriptor.workspace_id
                && workspace.descriptor.canonical_root_path
                    == reservation.descriptor.canonical_root_path
        });
        let Some(workspace) = workspaces.get_mut(&reservation.descriptor.workspace_id) else {
            return Ok(());
        };
        if workspace.unregister_generation != Some(reservation.generation) {
            return Ok(());
        }
        if has_replacement {
            drop(workspaces);
            drop(operation);
            return self.finalize_unregister(reservation);
        }
        workspace.unregister_generation = None;
        self.registration_operations.replace_latest(
            &reservation.descriptor.workspace_id,
            workspace.latest_admission_token,
        )?;
        let registered_paths = workspace.registered_paths.clone();
        let workspace_id = workspace.descriptor.workspace_id.clone();
        let mut path_owners = self.path_owners.lock().map_err(lock_error)?;
        for path in registered_paths {
            path_owners
                .entry(path)
                .or_insert_with(|| super::RegisteredPathOwner {
                    workspace_id: workspace_id.clone(),
                    admission_token: workspace.latest_admission_token,
                });
        }
        Ok(())
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc,
        },
        thread,
        time::Duration,
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-workspace-unregister-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn blocked_cleanup_releases_global_gate_and_fences_same_root_replacement_until_finalize() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root_a = temp_root("root-a");
        let root_b = temp_root("root-b");
        let descriptor_a = registry.register(&root_a).unwrap();
        let descriptor_b = registry.register(&root_b).unwrap();
        let (cleanup_started_tx, cleanup_started_rx) = mpsc::sync_channel(0);
        let (release_cleanup_tx, release_cleanup_rx) = mpsc::sync_channel(0);
        let unregister_registry = Arc::clone(&registry);
        let unregister_id = descriptor_a.workspace_id.clone();
        let unregister = thread::spawn(move || {
            unregister_registry.unregister_after(&unregister_id, |_| {
                cleanup_started_tx.send(()).unwrap();
                release_cleanup_rx.recv().unwrap();
                Ok(())
            })
        });

        cleanup_started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("cleanup must start");
        let root_b_operation = registry
            .register(&root_b)
            .expect("root B registration must not wait for root A cleanup");
        assert_eq!(root_b_operation.workspace_id, descriptor_b.workspace_id);
        assert_eq!(
            registry
                .unregister(&descriptor_a.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::WouldBlock
        );

        assert_eq!(
            registry.register(&root_a).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        release_cleanup_tx.send(()).unwrap();
        unregister.join().unwrap().unwrap();

        assert!(registry.descriptor(&descriptor_a.workspace_id).is_err());
        let replacement = registry
            .register(&root_a)
            .expect("same-root replacement after cleanup finalization");
        assert_ne!(replacement.workspace_id, descriptor_a.workspace_id);
        assert_eq!(
            registry
                .descriptor(&replacement.workspace_id)
                .unwrap()
                .workspace_id,
            replacement.workspace_id
        );
        assert_eq!(
            registry
                .descriptor_for_registered_path(&root_a)
                .unwrap()
                .workspace_id,
            replacement.workspace_id
        );
    }

    #[test]
    fn panicking_destructive_cleanup_finalizes_identity_removal() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("panic");
        let descriptor = registry.register(&root).unwrap();

        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = registry.unregister_after(&descriptor.workspace_id, |_| -> io::Result<()> {
                panic!("cleanup panic")
            });
        }));

        assert!(panic.is_err());
        assert!(registry.descriptor(&descriptor.workspace_id).is_err());
        assert!(registry.descriptor_for_registered_path(&root).is_err());
    }
}
