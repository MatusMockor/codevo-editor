use crate::job_scheduler::WorkspaceIndexLifecycleToken;
use crate::workspace_registry::{
    open_directory_relative_to, open_file_relative_to, WorkspaceRegistrationOperationLease,
};
use std::{fs::File, io, path::Path, sync::Arc};

#[derive(Clone)]
pub struct WorkspaceIndexOperationAuthority {
    lifecycle: WorkspaceIndexLifecycleToken,
    registration: Option<Arc<WorkspaceRegistrationOperationLease>>,
    root: Option<Arc<File>>,
}

impl WorkspaceIndexOperationAuthority {
    pub(crate) fn new(
        lifecycle: WorkspaceIndexLifecycleToken,
        registration: WorkspaceRegistrationOperationLease,
    ) -> io::Result<Self> {
        let root = registration.try_clone_root()?;
        Ok(Self {
            lifecycle,
            registration: Some(Arc::new(registration)),
            root: Some(Arc::new(root)),
        })
    }

    #[cfg(test)]
    pub(crate) fn lifecycle(lifecycle: WorkspaceIndexLifecycleToken) -> Self {
        Self {
            lifecycle,
            registration: None,
            root: None,
        }
    }

    pub(crate) fn is_current(&self) -> bool {
        if !self.lifecycle.is_current() {
            return false;
        }
        let Some(registration) = &self.registration else {
            return true;
        };
        registration.is_current()
    }

    pub(crate) fn run_if_current<T>(&self, action: impl FnOnce() -> T) -> Option<T> {
        let Some(registration) = &self.registration else {
            return self.lifecycle.run_if_current(action);
        };
        registration
            .with_current_commit(|| self.lifecycle.run_if_current(action))
            .ok()
            .flatten()
    }

    pub(crate) fn open_directory(&self, relative_path: &Path) -> io::Result<File> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| io::Error::other("index root capability is unavailable"))?;
        open_directory_relative_to(root, relative_path)
    }

    pub(crate) fn open_file(&self, relative_path: &Path) -> io::Result<File> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| io::Error::other("index root capability is unavailable"))?;
        open_file_relative_to(root, relative_path)
    }

    pub(crate) fn try_clone_root(&self) -> io::Result<File> {
        self.root
            .as_deref()
            .ok_or_else(|| io::Error::other("index root capability is unavailable"))?
            .try_clone()
    }
}

pub(crate) fn run_if_index_operation_current(
    operation_authority: Option<&WorkspaceIndexOperationAuthority>,
    action: impl FnOnce(),
) {
    let Some(authority) = operation_authority else {
        action();
        return;
    };
    let _ = authority.run_if_current(action);
}

#[cfg(all(test, unix))]
mod tests {
    use super::{run_if_index_operation_current, WorkspaceIndexOperationAuthority};
    use crate::job_scheduler::WorkspaceIndexLifecycle;
    use crate::workspace_registry::WorkspaceRegistry;
    use std::{
        fs,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn replacement_registration_revokes_old_index_operation() {
        let root = temporary_workspace("index-authority-replacement");
        let registry = WorkspaceRegistry::new();
        let first = registry
            .register_with_receipt(&root)
            .expect("first registration");
        let lease = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .expect("operation lease");
        let root_key = first
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .to_string();
        let lifecycle = WorkspaceIndexLifecycle::new();
        let authority =
            WorkspaceIndexOperationAuthority::new(lifecycle.begin_workspace_run(&root_key), lease)
                .expect("index authority");
        let committed = AtomicBool::new(false);

        assert!(authority.is_current());
        registry
            .register_with_receipt(&root)
            .expect("replacement registration");
        assert!(!authority.is_current());
        assert!(authority
            .run_if_current(|| committed.store(true, Ordering::SeqCst))
            .is_none());
        run_if_index_operation_current(Some(&authority), || {
            committed.store(true, Ordering::SeqCst)
        });
        assert!(!committed.load(Ordering::SeqCst));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn replacement_waits_for_entered_index_commit() {
        let root = temporary_workspace("index-authority-commit");
        let registry = Arc::new(WorkspaceRegistry::new());
        let first = registry
            .register_with_receipt(&root)
            .expect("first registration");
        let lease = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .expect("operation lease");
        let root_key = first
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .to_string();
        let authority = WorkspaceIndexOperationAuthority::new(
            WorkspaceIndexLifecycle::new().begin_workspace_run(&root_key),
            lease,
        )
        .expect("index authority");
        let (entered_sender, entered_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let commit = thread::spawn(move || {
            authority.run_if_current(|| {
                entered_sender.send(()).expect("entered");
                release_receiver.recv().expect("release");
                7
            })
        });
        entered_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("commit entered");
        let replacement_registry = Arc::clone(&registry);
        let replacement_root = root.clone();
        let (replaced_sender, replaced_receiver) = mpsc::channel();
        let replacement = thread::spawn(move || {
            let registration = replacement_registry
                .register_with_receipt(replacement_root)
                .expect("replacement registration");
            replaced_sender.send(registration).expect("replaced");
        });

        assert!(replaced_receiver
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_sender.send(()).expect("release commit");
        assert_eq!(commit.join().expect("commit thread"), Some(7));
        replaced_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("replacement completes");
        replacement.join().expect("replacement thread");

        fs::remove_dir_all(root).expect("cleanup");
    }

    fn temporary_workspace(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }
}
