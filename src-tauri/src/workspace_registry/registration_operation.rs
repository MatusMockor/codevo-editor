use super::{
    lock_error, unknown_workspace, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
};
use std::{
    collections::HashMap,
    fs::File,
    io,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

const MAX_OPERATIONS_GLOBAL: usize = 128;
const MAX_OPERATIONS_PER_WORKSPACE: usize = 16;

#[derive(Default)]
pub(super) struct RegistrationOperationRegistry {
    next_token: AtomicU64,
    state: Mutex<RegistrationOperationState>,
}

pub(super) struct RegistrationOperationTransition {
    entries: Vec<Arc<RegistrationOperationEntry>>,
}

#[derive(Default)]
struct RegistrationOperationState {
    latest_admissions: HashMap<WorkspaceId, u64>,
    leases: HashMap<u64, Arc<RegistrationOperationEntry>>,
    workspace_counts: HashMap<WorkspaceId, usize>,
}

struct RegistrationOperationEntry {
    admission_token: u64,
    commit_gate: Mutex<()>,
    revoked: AtomicBool,
    workspace_id: WorkspaceId,
}

pub(crate) struct WorkspaceRegistrationOperationLease {
    admission_token: u64,
    descriptor: ManagedWorkspaceDescriptor,
    entry: Arc<RegistrationOperationEntry>,
    registry: Arc<RegistrationOperationRegistry>,
    root: File,
    token: u64,
    workspace_id: WorkspaceId,
}

impl WorkspaceRegistry {
    pub(crate) fn reserve_latest_registration_operation(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<super::WorkspaceRegistrationOperationLease> {
        let _operation = self.lock_operations()?;
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
            return Err(stale_admission());
        }
        self.registration_operations.reserve(
            workspace_id,
            admission_token,
            workspace.descriptor.clone(),
            workspace.root.try_clone()?,
        )
    }
}

impl RegistrationOperationRegistry {
    pub(super) fn replace_latest(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<()> {
        self.begin_transition(workspace_id)?.wait()?;
        self.publish_latest(workspace_id, admission_token)?;
        Ok(())
    }

    pub(super) fn revoke_workspace(&self, workspace_id: &WorkspaceId) -> io::Result<()> {
        self.begin_transition(workspace_id)?.wait()
    }

    pub(super) fn begin_transition(
        &self,
        workspace_id: &WorkspaceId,
    ) -> io::Result<RegistrationOperationTransition> {
        let mut state = self.state.lock().map_err(lock_error)?;
        state.latest_admissions.remove(workspace_id);
        Ok(RegistrationOperationTransition {
            entries: revoke_workspace_entries(&mut state, workspace_id),
        })
    }

    pub(super) fn publish_latest(
        &self,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) -> io::Result<()> {
        self.state
            .lock()
            .map_err(lock_error)?
            .latest_admissions
            .insert(workspace_id.clone(), admission_token);
        Ok(())
    }

    fn reserve(
        self: &Arc<Self>,
        workspace_id: &WorkspaceId,
        admission_token: u64,
        descriptor: ManagedWorkspaceDescriptor,
        root: File,
    ) -> io::Result<WorkspaceRegistrationOperationLease> {
        let mut state = self.state.lock().map_err(lock_error)?;
        if state.latest_admissions.get(workspace_id) != Some(&admission_token) {
            return Err(stale_admission());
        }
        if state.leases.len() >= MAX_OPERATIONS_GLOBAL
            || state
                .workspace_counts
                .get(workspace_id)
                .copied()
                .unwrap_or(0)
                >= MAX_OPERATIONS_PER_WORKSPACE
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace registration operation capacity is exhausted",
            ));
        }
        let token = self
            .next_token
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| io::Error::other("workspace registration operation tokens exhausted"))?
            + 1;
        let entry = Arc::new(RegistrationOperationEntry {
            admission_token,
            commit_gate: Mutex::new(()),
            revoked: AtomicBool::new(false),
            workspace_id: workspace_id.clone(),
        });
        state.leases.insert(token, Arc::clone(&entry));
        *state
            .workspace_counts
            .entry(workspace_id.clone())
            .or_default() += 1;
        Ok(WorkspaceRegistrationOperationLease {
            admission_token,
            descriptor,
            entry,
            registry: Arc::clone(self),
            root,
            token,
            workspace_id: workspace_id.clone(),
        })
    }
}

impl RegistrationOperationTransition {
    pub(super) fn wait(self) -> io::Result<()> {
        wait_for_commits(self.entries)
    }
}

impl WorkspaceRegistrationOperationLease {
    pub(crate) fn descriptor(&self) -> &ManagedWorkspaceDescriptor {
        &self.descriptor
    }

    pub(crate) fn is_current(&self) -> bool {
        if self.entry.revoked.load(Ordering::Acquire) {
            return false;
        }
        let Ok(state) = self.registry.state.lock() else {
            return false;
        };
        state.latest_admissions.get(&self.workspace_id) == Some(&self.admission_token)
            && state.leases.get(&self.token).is_some_and(|entry| {
                entry.workspace_id == self.workspace_id
                    && entry.admission_token == self.admission_token
                    && !entry.revoked.load(Ordering::Acquire)
            })
    }

    pub(crate) fn try_clone_root(&self) -> io::Result<File> {
        self.root.try_clone()
    }

    pub(crate) fn with_current_commit<Result>(
        &self,
        commit: impl FnOnce() -> Result,
    ) -> io::Result<Result> {
        let _commit = self
            .entry
            .commit_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = self.registry.state.lock().map_err(lock_error)?;
        let current = state.latest_admissions.get(&self.workspace_id)
            == Some(&self.admission_token)
            && state.leases.get(&self.token).is_some_and(|entry| {
                entry.workspace_id == self.workspace_id
                    && entry.admission_token == self.admission_token
                    && !entry.revoked.load(Ordering::Acquire)
            });
        if !current {
            return Err(stale_admission());
        }
        drop(state);
        Ok(commit())
    }
}

impl Drop for WorkspaceRegistrationOperationLease {
    fn drop(&mut self) {
        let Ok(mut state) = self.registry.state.lock() else {
            return;
        };
        let _ = remove_lease(&mut state, self.token);
    }
}

fn revoke_workspace_entries(
    state: &mut RegistrationOperationState,
    workspace_id: &WorkspaceId,
) -> Vec<Arc<RegistrationOperationEntry>> {
    let tokens = state
        .leases
        .iter()
        .filter_map(|(token, entry)| (entry.workspace_id == *workspace_id).then_some(*token))
        .collect::<Vec<_>>();
    tokens
        .into_iter()
        .filter_map(|token| {
            let entry = remove_lease(state, token)?;
            entry.revoked.store(true, Ordering::Release);
            Some(entry)
        })
        .collect()
}

fn remove_lease(
    state: &mut RegistrationOperationState,
    token: u64,
) -> Option<Arc<RegistrationOperationEntry>> {
    let entry = state.leases.remove(&token)?;
    let Some(count) = state.workspace_counts.get_mut(&entry.workspace_id) else {
        return Some(entry);
    };
    *count = count.saturating_sub(1);
    if *count == 0 {
        state.workspace_counts.remove(&entry.workspace_id);
    }
    Some(entry)
}

fn wait_for_commits(entries: Vec<Arc<RegistrationOperationEntry>>) -> io::Result<()> {
    for entry in entries {
        let _commit = entry
            .commit_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
    Ok(())
}

fn stale_admission() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "workspace registration admission is stale",
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::MetadataExt,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-registration-operation-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn replacement_revokes_send_lease_after_bounded_commit_finishes() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("replacement");
        let registration = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let (lease_tx, lease_rx) = mpsc::channel();
        let commit = std::thread::spawn(move || {
            lease
                .with_current_commit(|| {
                    commit_entered_tx.send(()).unwrap();
                    release_commit_rx.recv().unwrap();
                })
                .unwrap();
            lease_tx.send(lease).unwrap();
        });
        commit_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let replacement_registry = Arc::clone(&registry);
        let replacement_root = root.clone();
        let (replacement_done_tx, replacement_done_rx) = mpsc::channel();
        let replacement = std::thread::spawn(move || {
            let result = replacement_registry.register_with_receipt(&replacement_root);
            replacement_done_tx.send(result).unwrap();
        });

        assert!(replacement_done_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_commit_tx.send(()).unwrap();
        let successor = replacement_done_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        let lease = lease_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!lease.is_current());
        assert!(lease.with_current_commit(|| ()).is_err());
        assert!(successor.receipt.admission_token > registration.receipt.admission_token);
        commit.join().unwrap();
        replacement.join().unwrap();
    }

    #[test]
    fn unregister_revokes_send_lease_before_returning() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("unregister");
        let registration = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap();

        registry
            .unregister(&registration.receipt.workspace_id)
            .unwrap();

        assert!(!lease.is_current());
        assert!(lease.with_current_commit(|| ()).is_err());
    }

    #[test]
    fn replacement_settles_after_a_commit_panics() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("panic");
        let registration = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap();

        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            lease.with_current_commit(|| panic!("commit panicked"))
        }));
        assert!(panic.is_err());

        let replacement = registry.register_with_receipt(&root).unwrap();
        assert!(replacement.receipt.admission_token > registration.receipt.admission_token);
        assert!(!lease.is_current());
    }

    #[test]
    fn lease_retains_the_registered_root_inode_after_path_replacement() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("root-capability");
        let moved_root = root.with_extension("moved");
        let registration = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .unwrap();
        let retained_inode = lease.try_clone_root().unwrap().metadata().unwrap().ino();

        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir(&root).unwrap();

        assert_eq!(
            lease.try_clone_root().unwrap().metadata().unwrap().ino(),
            retained_inode
        );
        assert_ne!(fs::metadata(&root).unwrap().ino(), retained_inode);
    }

    #[test]
    fn rollback_does_not_publish_over_a_concurrent_successor() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("rollback-publication");
        let first = registry.register_with_receipt(&root).unwrap();
        let second = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &second.receipt.workspace_id,
                second.receipt.admission_token,
            )
            .unwrap();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let commit = std::thread::spawn(move || {
            lease
                .with_current_commit(|| {
                    commit_entered_tx.send(()).unwrap();
                    release_commit_rx.recv().unwrap();
                })
                .unwrap();
        });
        commit_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let rollback_registry = Arc::clone(&registry);
        let rollback_workspace_id = second.receipt.workspace_id.clone();
        let rollback_admission_token = second.receipt.admission_token;
        let rollback = std::thread::spawn(move || {
            rollback_registry
                .rollback_registration(&rollback_workspace_id, rollback_admission_token)
                .unwrap()
                .unwrap()
                .finalize()
        });
        wait_until_stale(
            &registry,
            &second.receipt.workspace_id,
            second.receipt.admission_token,
        );

        let successor = registry.register_with_receipt(&root).unwrap();
        release_commit_tx.send(()).unwrap();
        rollback.join().unwrap().unwrap();
        commit.join().unwrap();

        let successor_lease = registry
            .reserve_latest_registration_operation(
                &successor.receipt.workspace_id,
                successor.receipt.admission_token,
            )
            .unwrap();
        assert!(successor_lease.is_current());
        assert!(successor.receipt.admission_token > first.receipt.admission_token);
    }

    #[test]
    fn losing_concurrent_registration_removes_its_unreachable_admission() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("losing-registration");
        let first = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .unwrap();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let commit = std::thread::spawn(move || {
            lease
                .with_current_commit(|| {
                    commit_entered_tx.send(()).unwrap();
                    release_commit_rx.recv().unwrap();
                })
                .unwrap();
        });
        commit_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let losing_registry = Arc::clone(&registry);
        let losing_root = root.clone();
        let (loser_done_tx, loser_done_rx) = mpsc::channel();
        let loser = std::thread::spawn(move || {
            loser_done_tx
                .send(losing_registry.register_with_receipt(&losing_root))
                .unwrap();
        });
        wait_until_stale(
            &registry,
            &first.receipt.workspace_id,
            first.receipt.admission_token,
        );

        let winner = registry.register_with_receipt(&root).unwrap();
        release_commit_tx.send(()).unwrap();
        assert_eq!(
            loser_done_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        loser.join().unwrap();
        commit.join().unwrap();

        let workspaces = registry.workspaces.lock().unwrap();
        let workspace = workspaces.get(&winner.receipt.workspace_id).unwrap();
        assert_eq!(workspace.registration_admissions.len(), 2);
        assert!(workspace
            .registration_admissions
            .contains_key(&first.receipt.admission_token));
        assert!(workspace
            .registration_admissions
            .contains_key(&winner.receipt.admission_token));
    }

    #[test]
    fn unregister_cancellation_restores_authority_after_losing_registration_cleanup() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("unregister-cancel");
        let first = registry.register_with_receipt(&root).unwrap();
        let lease = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .unwrap();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let commit = std::thread::spawn(move || {
            lease
                .with_current_commit(|| {
                    commit_entered_tx.send(()).unwrap();
                    release_commit_rx.recv().unwrap();
                })
                .unwrap();
        });
        commit_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let losing_registry = Arc::clone(&registry);
        let losing_root = root.clone();
        let (loser_done_tx, loser_done_rx) = mpsc::channel();
        let loser = std::thread::spawn(move || {
            loser_done_tx
                .send(losing_registry.register_with_receipt(&losing_root))
                .unwrap();
        });
        wait_until_stale(
            &registry,
            &first.receipt.workspace_id,
            first.receipt.admission_token,
        );
        let unregister_registry = Arc::clone(&registry);
        let unregister_workspace_id = first.receipt.workspace_id.clone();
        let (unregister_entered_tx, unregister_entered_rx) = mpsc::channel();
        let (release_unregister_tx, release_unregister_rx) = mpsc::channel();
        let (unregister_done_tx, unregister_done_rx) = mpsc::channel();
        let unregister = std::thread::spawn(move || {
            unregister_done_tx
                .send(
                    unregister_registry.unregister_after(&unregister_workspace_id, |_| {
                        unregister_entered_tx.send(()).unwrap();
                        release_unregister_rx.recv().unwrap();
                        Err(io::Error::other("cleanup failed"))
                    }),
                )
                .unwrap();
        });

        unregister_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        release_commit_tx.send(()).unwrap();
        assert_eq!(
            loser_done_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        release_unregister_tx.send(()).unwrap();
        assert_eq!(
            unregister_done_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err()
                .to_string(),
            "cleanup failed"
        );
        loser.join().unwrap();
        unregister.join().unwrap();
        commit.join().unwrap();

        let restored = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .unwrap();
        assert!(restored.is_current());
    }

    fn wait_until_stale(
        registry: &WorkspaceRegistry,
        workspace_id: &WorkspaceId,
        admission_token: u64,
    ) {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if registry
                .reserve_latest_registration_operation(workspace_id, admission_token)
                .is_err()
            {
                return;
            }
            std::thread::yield_now();
        }
        panic!("registration transition did not revoke predecessor");
    }
}
