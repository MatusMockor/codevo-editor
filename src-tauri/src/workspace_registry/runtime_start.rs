use super::{WorkspaceId, WorkspaceRegistry};
use std::io;

#[cfg(any(target_os = "macos", target_os = "linux"))]
use super::lock_error;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{
    collections::{HashMap, HashSet},
    sync::atomic::Ordering,
    time::Duration,
};

#[cfg(any(target_os = "macos", target_os = "linux"))]
const MAX_RUNTIME_STARTS_GLOBAL: usize = 128;
#[cfg(any(target_os = "macos", target_os = "linux"))]
const MAX_RUNTIME_STARTS_PER_WORKSPACE: usize = 16;
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[cfg(not(test))]
const RUNTIME_START_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
const RUNTIME_START_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(50);

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[derive(Default)]
pub(super) struct RuntimeStartReservations {
    tokens: HashMap<WorkspaceId, HashSet<u64>>,
    total: usize,
    shutdown: bool,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) struct WorkspaceRuntimeStartLease<'a> {
    registry: &'a WorkspaceRegistry,
    workspace_id: WorkspaceId,
    token: u64,
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) struct WorkspaceRuntimeStartLease<'a>(std::marker::PhantomData<&'a WorkspaceRegistry>);

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl WorkspaceRegistry {
    pub(crate) fn reserve_runtime_start(
        &self,
        workspace_id: &WorkspaceId,
    ) -> io::Result<WorkspaceRuntimeStartLease<'_>> {
        let _operation = self.lock_operations()?;
        self.descriptor(workspace_id)?;
        let mut reservations = self.runtime_starts.lock().map_err(lock_error)?;
        if reservations.shutdown {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace runtime start admission is closed",
            ));
        }
        if reservations.total >= MAX_RUNTIME_STARTS_GLOBAL {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace runtime start capacity is exhausted",
            ));
        }
        let workspace_count = reservations
            .tokens
            .get(workspace_id)
            .map_or(0, HashSet::len);
        if workspace_count >= MAX_RUNTIME_STARTS_PER_WORKSPACE {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace runtime start capacity is exhausted",
            ));
        }
        let token = self
            .next_runtime_start_token
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| io::Error::other("workspace runtime start token space is exhausted"))?
            + 1;
        reservations
            .tokens
            .entry(workspace_id.clone())
            .or_default()
            .insert(token);
        reservations.total += 1;
        Ok(WorkspaceRuntimeStartLease {
            registry: self,
            workspace_id: workspace_id.clone(),
            token,
        })
    }

    pub(super) fn has_runtime_start(&self, workspace_id: &WorkspaceId) -> io::Result<bool> {
        Ok(self
            .runtime_starts
            .lock()
            .map_err(lock_error)?
            .tokens
            .get(workspace_id)
            .is_some_and(|tokens| !tokens.is_empty()))
    }

    pub(crate) fn begin_runtime_shutdown(&self) -> io::Result<()> {
        self.close_runtime_start_admission()?;
        self.wait_for_runtime_starts()
    }

    fn close_runtime_start_admission(&self) -> io::Result<()> {
        {
            let _operation = self.lock_operations()?;
            self.runtime_starts.lock().map_err(lock_error)?.shutdown = true;
        }
        Ok(())
    }

    fn wait_for_runtime_starts(&self) -> io::Result<()> {
        let reservations = self.runtime_starts.lock().map_err(lock_error)?;
        let (reservations, timeout) = self
            .runtime_start_signal
            .wait_timeout_while(reservations, RUNTIME_START_SHUTDOWN_TIMEOUT, |state| {
                state.total > 0
            })
            .map_err(lock_error)?;
        if timeout.timed_out() && reservations.total > 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "workspace runtime starts did not settle before shutdown",
            ));
        }
        Ok(())
    }

    fn release_runtime_start(&self, workspace_id: &WorkspaceId, token: u64) {
        let Ok(mut reservations) = self.runtime_starts.lock() else {
            return;
        };
        let removed = reservations
            .tokens
            .get_mut(workspace_id)
            .is_some_and(|tokens| tokens.remove(&token));
        if !removed {
            return;
        }
        reservations.total = reservations.total.saturating_sub(1);
        let empty = reservations
            .tokens
            .get(workspace_id)
            .is_some_and(HashSet::is_empty);
        if empty {
            reservations.tokens.remove(workspace_id);
        }
        self.runtime_start_signal.notify_all();
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
impl WorkspaceRegistry {
    pub(crate) fn reserve_runtime_start(
        &self,
        _workspace_id: &WorkspaceId,
    ) -> io::Result<WorkspaceRuntimeStartLease<'_>> {
        Err(super::unsupported_platform())
    }

    pub(crate) fn begin_runtime_shutdown(&self) -> io::Result<()> {
        Err(super::unsupported_platform())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Drop for WorkspaceRuntimeStartLease<'_> {
    fn drop(&mut self) {
        self.registry
            .release_runtime_start(&self.workspace_id, self.token);
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::{
        fs,
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc,
        },
        thread,
    };

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    fn registered_workspace(label: &str) -> (WorkspaceRegistry, WorkspaceId, std::path::PathBuf) {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "workspace-runtime-start-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create workspace");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register workspace");
        (registry, descriptor.workspace_id, root)
    }

    #[test]
    fn lease_blocks_unregister_until_drop() {
        let (registry, workspace_id, root) = registered_workspace("unregister");
        let lease = registry
            .reserve_runtime_start(&workspace_id)
            .expect("reserve runtime start");

        let error = registry
            .unregister(&workspace_id)
            .expect_err("active start blocks unregister");
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        drop(lease);
        registry
            .unregister(&workspace_id)
            .expect("unregister after start");
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn panic_releases_the_exact_runtime_start_lease() {
        let (registry, workspace_id, root) = registered_workspace("panic");
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _lease = registry
                .reserve_runtime_start(&workspace_id)
                .expect("reserve runtime start");
            panic!("stop");
        }));

        assert!(result.is_err());
        registry
            .unregister(&workspace_id)
            .expect("panic releases lease");
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn one_workspace_start_does_not_block_another_workspace() {
        let (registry, workspace_a, root_a) = registered_workspace("workspace-a");
        let root_b = root_a.with_extension("workspace-b");
        fs::create_dir_all(&root_b).expect("create workspace b");
        let workspace_b = registry
            .register(&root_b)
            .expect("register workspace b")
            .workspace_id;
        let _lease = registry
            .reserve_runtime_start(&workspace_a)
            .expect("reserve workspace a");

        registry
            .unregister(&workspace_b)
            .expect("unregister workspace b");
        fs::remove_dir_all(root_a).expect("remove workspace a");
        fs::remove_dir_all(root_b).expect("remove workspace b");
    }

    #[test]
    fn stale_lease_drop_does_not_release_a_new_generation() {
        let (registry, workspace_id, root) = registered_workspace("aba");
        let first = registry
            .reserve_runtime_start(&workspace_id)
            .expect("reserve first start");
        let second = registry
            .reserve_runtime_start(&workspace_id)
            .expect("reserve second start");
        drop(first);

        assert!(registry.unregister(&workspace_id).is_err());
        drop(second);
        registry
            .unregister(&workspace_id)
            .expect("exact second drop releases workspace");
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn shutdown_closes_admission_and_waits_for_the_exact_active_lease() {
        let (registry, workspace_id, root) = registered_workspace("shutdown");
        let registry = Arc::new(registry);
        let lease = registry
            .reserve_runtime_start(&workspace_id)
            .expect("reserve runtime start");
        registry
            .close_runtime_start_admission()
            .expect("close start admission");
        assert!(registry.reserve_runtime_start(&workspace_id).is_err());
        let shutdown_registry = Arc::clone(&registry);
        let (settled_sender, settled_receiver) = mpsc::channel();
        let shutdown = thread::spawn(move || {
            let result = shutdown_registry.wait_for_runtime_starts();
            settled_sender.send(result).expect("send shutdown result");
        });

        assert!(settled_receiver.try_recv().is_err());
        drop(lease);
        settled_receiver
            .recv()
            .expect("receive shutdown")
            .expect("shutdown settles");
        shutdown.join().expect("join shutdown");
        registry
            .begin_runtime_shutdown()
            .expect("repeated shutdown is idempotent");
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn shutdown_timeout_refuses_cleanup_and_retry_settles_after_lease_release() {
        let (registry, workspace_id, root) = registered_workspace("shutdown-timeout");
        let lease = registry
            .reserve_runtime_start(&workspace_id)
            .expect("reserve runtime start");

        let error = registry
            .begin_runtime_shutdown()
            .expect_err("active lease reaches bounded timeout");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(registry.descriptor(&workspace_id).is_ok());
        assert!(registry.reserve_runtime_start(&workspace_id).is_err());
        drop(lease);
        registry
            .begin_runtime_shutdown()
            .expect("retry settles after lease release");
        registry.clear();
        assert!(registry.descriptor(&workspace_id).is_err());
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn runtime_start_reservations_are_bounded_per_workspace() {
        let (registry, workspace_id, root) = registered_workspace("capacity");
        let leases = (0..MAX_RUNTIME_STARTS_PER_WORKSPACE)
            .map(|_| {
                registry
                    .reserve_runtime_start(&workspace_id)
                    .expect("reserve runtime start")
            })
            .collect::<Vec<_>>();

        let error = registry
            .reserve_runtime_start(&workspace_id)
            .err()
            .expect("bounded runtime starts");
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        drop(leases);
        fs::remove_dir_all(root).expect("remove workspace");
    }
}
