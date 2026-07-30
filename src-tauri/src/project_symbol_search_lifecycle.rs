use rusqlite::InterruptHandle;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

const MAX_ACTIVE_PROJECT_SYMBOL_SEARCHES: usize = 32;
const PROJECT_SYMBOL_SEARCH_RESERVATION_TTL: Duration = Duration::from_secs(15);
const MAX_PROJECT_SYMBOL_SEARCH_OWNER_BYTES: usize = 64;
const MAX_PROJECT_SYMBOL_SEARCH_ROOT_BYTES: usize = 16 * 1024;

#[derive(Clone, Default)]
pub(crate) struct ProjectSymbolSearchLifecycle {
    state: Arc<Mutex<ProjectSymbolSearchState>>,
}

#[derive(Default)]
struct ProjectSymbolSearchState {
    entries: HashMap<ProjectSymbolSearchAuthority, Arc<ProjectSymbolSearchEntry>>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ProjectSymbolSearchAuthority {
    owner_id: String,
    request_id: u64,
    root: String,
}

struct ProjectSymbolSearchEntry {
    canceled: AtomicBool,
    claimed: AtomicBool,
    interrupt: Mutex<Option<InterruptHandle>>,
    registered_at: Instant,
}

pub(crate) struct ProjectSymbolSearchLease {
    authority: ProjectSymbolSearchAuthority,
    entry: Arc<ProjectSymbolSearchEntry>,
    lifecycle: ProjectSymbolSearchLifecycle,
}

impl ProjectSymbolSearchLifecycle {
    pub(crate) fn register(
        &self,
        root: &str,
        owner_id: &str,
        request_id: u64,
    ) -> Result<(), String> {
        self.register_at(root, owner_id, request_id, Instant::now())
    }

    fn register_at(
        &self,
        root: &str,
        owner_id: &str,
        request_id: u64,
        now: Instant,
    ) -> Result<(), String> {
        let authority = authority(root, owner_id, request_id)?;
        let entry = Arc::new(ProjectSymbolSearchEntry {
            canceled: AtomicBool::new(false),
            claimed: AtomicBool::new(false),
            interrupt: Mutex::new(None),
            registered_at: now,
        });
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Project-symbol search registry is unavailable.".to_string())?;
        state.entries.retain(|_, entry| {
            entry.claimed.load(Ordering::Acquire)
                || now.saturating_duration_since(entry.registered_at)
                    < PROJECT_SYMBOL_SEARCH_RESERVATION_TTL
        });
        if state.entries.len() >= MAX_ACTIVE_PROJECT_SYMBOL_SEARCHES {
            return Err("Too many project-symbol searches are active.".to_string());
        }
        if state.entries.contains_key(&authority) {
            return Err("Project-symbol search request identifier is already active.".to_string());
        }
        state.entries.insert(authority, entry);
        Ok(())
    }

    pub(crate) fn claim(
        &self,
        root: &str,
        owner_id: &str,
        request_id: u64,
    ) -> Result<ProjectSymbolSearchLease, String> {
        let authority = authority(root, owner_id, request_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Project-symbol search registry is unavailable.".to_string())?;
        let entry = state
            .entries
            .get(&authority)
            .cloned()
            .ok_or_else(|| "Project-symbol search is not registered.".to_string())?;
        if !entry.claimed.load(Ordering::Acquire)
            && Instant::now().saturating_duration_since(entry.registered_at)
                >= PROJECT_SYMBOL_SEARCH_RESERVATION_TTL
        {
            state.entries.remove(&authority);
            return Err("Project-symbol search registration expired.".to_string());
        }
        entry
            .claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Project-symbol search was already claimed.".to_string())?;
        drop(state);
        Ok(ProjectSymbolSearchLease {
            authority,
            entry,
            lifecycle: self.clone(),
        })
    }

    pub(crate) fn cancel(
        &self,
        root: &str,
        owner_id: &str,
        request_id: u64,
    ) -> Result<bool, String> {
        let authority = authority(root, owner_id, request_id)?;
        let entry = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Project-symbol search registry is unavailable.".to_string())?;
            let entry = state.entries.get(&authority).cloned();
            if entry
                .as_ref()
                .is_some_and(|entry| !entry.claimed.load(Ordering::Acquire))
            {
                state.entries.remove(&authority);
            }
            entry
        };
        let Some(entry) = entry else {
            return Ok(false);
        };
        entry.canceled.store(true, Ordering::Release);
        if let Some(interrupt) = entry
            .interrupt
            .lock()
            .map_err(|_| "Project-symbol search cancellation is unavailable.".to_string())?
            .as_ref()
        {
            interrupt.interrupt();
        }
        Ok(true)
    }
}

fn authority(
    root: &str,
    owner_id: &str,
    request_id: u64,
) -> Result<ProjectSymbolSearchAuthority, String> {
    if root.is_empty() || root.len() > MAX_PROJECT_SYMBOL_SEARCH_ROOT_BYTES {
        return Err("Project-symbol search root is invalid.".to_string());
    }
    if request_id == 0 || request_id > 9_007_199_254_740_991 {
        return Err("Project-symbol search request identifier is invalid.".to_string());
    }
    if owner_id.is_empty() || owner_id.len() > MAX_PROJECT_SYMBOL_SEARCH_OWNER_BYTES {
        return Err("Project-symbol search owner is invalid.".to_string());
    }
    Ok(ProjectSymbolSearchAuthority {
        owner_id: owner_id.to_string(),
        request_id,
        root: root.to_string(),
    })
}

impl ProjectSymbolSearchLease {
    pub(crate) fn install_interrupt(&self, interrupt: InterruptHandle) -> Result<(), String> {
        let mut installed = self
            .entry
            .interrupt
            .lock()
            .map_err(|_| "Project-symbol search cancellation is unavailable.".to_string())?;
        if self.is_canceled() {
            interrupt.interrupt();
        } else {
            *installed = Some(interrupt);
        }
        Ok(())
    }

    pub(crate) fn ensure_current(&self) -> Result<(), String> {
        if self.is_canceled() {
            Err("Project-symbol search was cancelled.".to_string())
        } else {
            Ok(())
        }
    }

    fn is_canceled(&self) -> bool {
        self.entry.canceled.load(Ordering::Acquire)
    }
}

impl Drop for ProjectSymbolSearchLease {
    fn drop(&mut self) {
        let Ok(mut state) = self.lifecycle.state.lock() else {
            return;
        };
        if state
            .entries
            .get(&self.authority)
            .is_some_and(|entry| Arc::ptr_eq(entry, &self.entry))
        {
            state.entries.remove(&self.authority);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{functions::FunctionFlags, Connection, ErrorCode};
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn cancellation_is_exact_and_late_cancellation_is_idempotent() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        lifecycle
            .register("/project-a", "owner-a", 7)
            .expect("register");
        let lease = lifecycle.claim("/project-a", "owner-a", 7).expect("claim");

        assert!(!lifecycle
            .cancel("/project-b", "owner-a", 7)
            .expect("foreign cancel"));
        lease.ensure_current().expect("foreign root cannot cancel");
        assert!(lifecycle
            .cancel("/project-a", "owner-a", 7)
            .expect("exact cancel"));
        assert!(lease.ensure_current().is_err());
        drop(lease);
        assert!(!lifecycle
            .cancel("/project-a", "owner-a", 7)
            .expect("late cancel"));
    }

    #[test]
    fn aba_requests_cannot_reuse_an_active_identifier() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        lifecycle
            .register("/project", "owner-a", 11)
            .expect("first register");
        let lease = lifecycle
            .claim("/project", "owner-a", 11)
            .expect("first claim");

        lifecycle
            .register("/project", "owner-b", 11)
            .expect("other owner has an independent generation");
        drop(lease);
        lifecycle
            .register("/project", "owner-a", 11)
            .expect("completed request releases exact identifier");
    }

    #[test]
    fn active_searches_are_bounded() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        for request_id in 1..=MAX_ACTIVE_PROJECT_SYMBOL_SEARCHES as u64 {
            lifecycle
                .register("/project", "owner-a", request_id)
                .expect("within cap");
        }

        assert!(lifecycle.register("/project", "owner-a", 100).is_err());
        assert!(lifecycle
            .cancel("/project", "owner-a", 1)
            .expect("reserved request is canceled"));
        lifecycle
            .register("/project", "owner-a", 100)
            .expect("capacity is reclaimed");
    }

    #[test]
    fn cancel_before_worker_claim_is_consumed_by_the_exact_request() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();

        lifecycle
            .register("/project", "owner-a", 19)
            .expect("register");
        assert!(lifecycle
            .cancel("/project", "owner-a", 19)
            .expect("cancel before claim"));
        assert!(lifecycle.claim("/project", "owner-a", 19).is_err());
        lifecycle
            .register("/project", "owner-b", 19)
            .expect("other owner is not poisoned");
    }

    #[test]
    fn registration_handshake_reclaims_a_thousand_canceled_requests() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();

        for request_id in 1..=1_000 {
            lifecycle
                .register("/project", "owner-a", request_id)
                .expect("registration is acknowledged before cancellation");
            assert!(lifecycle
                .cancel("/project", "owner-a", request_id)
                .expect("cancel registered request"));
        }

        lifecycle
            .register("/project", "owner-a", 1_001)
            .expect("storm leaves no retained reservation");
    }

    #[test]
    fn abandoned_reservations_expire_before_capacity_admission() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        let now = Instant::now();
        let expired = now - PROJECT_SYMBOL_SEARCH_RESERVATION_TTL;
        for request_id in 1..=MAX_ACTIVE_PROJECT_SYMBOL_SEARCHES as u64 {
            lifecycle
                .register_at("/project", "owner-a", request_id, expired)
                .expect("fill with abandoned reservation");
        }

        lifecycle
            .register_at("/project", "owner-b", 100, now)
            .expect("new admission reaps expired reservations");
    }

    #[test]
    fn delayed_claim_fails_closed_after_reservation_expiry() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        let expired = Instant::now() - PROJECT_SYMBOL_SEARCH_RESERVATION_TTL;
        lifecycle
            .register_at("/project", "owner-a", 101, expired)
            .expect("register expired request");

        assert!(lifecycle.claim("/project", "owner-a", 101).is_err());
        lifecycle
            .register("/project", "owner-b", 101)
            .expect("expired claim releases capacity");
    }

    #[test]
    fn claimed_request_cannot_be_reaped_as_an_expired_reservation() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        let registered_at = Instant::now();
        lifecycle
            .register_at("/project", "owner-a", 102, registered_at)
            .expect("register");
        let lease = lifecycle
            .claim("/project", "owner-a", 102)
            .expect("claim atomically");

        lifecycle
            .register_at(
                "/project",
                "owner-b",
                103,
                registered_at + PROJECT_SYMBOL_SEARCH_RESERVATION_TTL,
            )
            .expect("admission keeps claimed entry");
        assert!(lifecycle
            .state
            .lock()
            .expect("registry")
            .entries
            .contains_key(&authority("/project", "owner-a", 102).expect("authority")));
        drop(lease);
    }

    #[test]
    fn cancellation_interrupts_a_live_sqlite_query() {
        let lifecycle = ProjectSymbolSearchLifecycle::default();
        let connection = Connection::open_in_memory().expect("open sqlite");
        lifecycle
            .register("/project", "owner-a", 31)
            .expect("register");
        let lease = lifecycle.claim("/project", "owner-a", 31).expect("claim");
        lease
            .install_interrupt(connection.get_interrupt_handle())
            .expect("install interrupt");
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let query_entry = Mutex::new(Some((started_tx, release_rx)));
        connection
            .create_scalar_function(
                "await_project_symbol_cancel",
                0,
                FunctionFlags::default(),
                move |_| {
                    if let Some((started_tx, release_rx)) =
                        query_entry.lock().expect("query entry proof").take()
                    {
                        let _ = started_tx.send(());
                        let _ = release_rx.recv();
                    }
                    Ok(0)
                },
            )
            .expect("install query-entry proof");
        let worker = thread::spawn(move || {
            let result = (|| -> rusqlite::Result<Vec<i64>> {
                let mut statement = connection.prepare(
                    "SELECT await_project_symbol_cancel()
                     FROM (SELECT 1 UNION SELECT 2 UNION SELECT 3)",
                )?;
                let result = statement.query_map([], |row| row.get(0))?.collect();
                result
            })();
            drop(lease);
            result
        });
        let entered_sqlite = started_rx.recv_timeout(Duration::from_secs(1)).is_ok();

        assert!(lifecycle
            .cancel("/project", "owner-a", 31)
            .expect("cancel live query"));
        let _ = release_tx.send(());
        let error = worker
            .join()
            .expect("query worker")
            .expect_err("query is interrupted");
        assert!(
            entered_sqlite,
            "SQLite progress callback must run before cancel"
        );
        assert_eq!(
            error.sqlite_error_code(),
            Some(ErrorCode::OperationInterrupted)
        );
    }
}
