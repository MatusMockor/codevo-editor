use super::connection::{self, DATABASE_FILE_NAME};
use super::runtime_request_thread_rows::{self, UndecodableRows};
use super::runtime_requests;
use crate::agent_runtime_requests::scopes::HistoryScope;
use crate::agent_runtime_requests::store::{
    AnswerIntent, ApplyReport, IntentReceipt, IntentSettle, RecoveryReport, RootClaim,
    RuntimeRequestStore, StoreError, StoreErrorKind, StoredRequests, ThreadRead, TurnKey,
    TurnObservation, MAX_JOURNALED_ROOTS,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

const SNAPSHOT_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const ROOT_LEASE_FILE_NAME: &str = "runtime-requests.lock";

fn unavailable(detail: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorKind::Unavailable, detail)
}

fn not_claimed() -> StoreError {
    unavailable("this instance has not claimed the request journal of this project")
}

fn remaining(deadline: Instant) -> Result<Duration, StoreError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorKind::DeadlineExceeded,
                "the answer was not recorded before its deadline",
            )
        })
}

#[cfg(unix)]
fn lock_exclusively(path: &Path) -> Result<Option<File>, StoreError> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::io::AsRawFd;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| unavailable(error.to_string()))?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(Some(file));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return Ok(None);
    }
    Err(unavailable(error.to_string()))
}

#[cfg(not(unix))]
fn lock_exclusively(_path: &Path) -> Result<Option<File>, StoreError> {
    Err(unavailable(
        "request journal ownership is unsupported on this platform",
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FileIdentity {
    device: u64,
    inode: u64,
}

impl FileIdentity {
    #[cfg(unix)]
    fn of(metadata: &std::fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }

    #[cfg(not(unix))]
    fn of(_metadata: &std::fs::Metadata) -> Self {
        Self {
            device: 0,
            inode: 0,
        }
    }

    pub(super) fn of_directory(path: &Path) -> Option<Self> {
        let metadata = std::fs::symlink_metadata(path).ok()?;
        metadata.file_type().is_dir().then(|| Self::of(&metadata))
    }

    fn of_regular_file(path: &Path) -> Option<Self> {
        let metadata = std::fs::symlink_metadata(path).ok()?;
        metadata.file_type().is_file().then(|| Self::of(&metadata))
    }
}

pub(super) struct PreparedClaim {
    directory: FileIdentity,
    database: FileIdentity,
}

pub(super) struct RootLease {
    held: File,
    directory: FileIdentity,
    database: FileIdentity,
    lock: FileIdentity,
    lost: bool,
}

impl RootLease {
    pub(super) fn acquire(directory: &Path) -> Result<Option<Self>, StoreError> {
        let Some(held) = lock_exclusively(&directory.join(ROOT_LEASE_FILE_NAME))? else {
            return Ok(None);
        };
        let lock = held
            .metadata()
            .map(|metadata| FileIdentity::of(&metadata))
            .map_err(|error| unavailable(error.to_string()))?;
        let database = FileIdentity::of_regular_file(&directory.join(DATABASE_FILE_NAME))
            .ok_or_else(lease_lost)?;
        let directory = FileIdentity::of_directory(directory).ok_or_else(lease_lost)?;
        Ok(Some(Self {
            held,
            directory,
            database,
            lock,
            lost: false,
        }))
    }

    fn guards(&mut self, directory: &Path) -> bool {
        if self.lost {
            return false;
        }
        self.lost = !self.still_guards(directory);
        !self.lost
    }

    fn guards_the_prepared(&mut self, prepared: &PreparedClaim, directory: &Path) -> bool {
        if self.directory != prepared.directory || self.database != prepared.database {
            self.lost = true;
        }
        self.guards(directory)
    }

    pub(super) fn check(
        &mut self,
        connection: Option<&Connection>,
        directory: &Path,
    ) -> Result<(), StoreError> {
        if !self.guards(directory) {
            return Err(lease_lost());
        }
        let Some(connection) = connection else {
            return Ok(());
        };
        if connection::has_moved(connection).unwrap_or(true) {
            self.lost = true;
        }
        if !self.guards(directory) {
            return Err(lease_lost());
        }
        Ok(())
    }

    fn still_guards(&self, directory: &Path) -> bool {
        let held = self
            .held
            .metadata()
            .map(|metadata| FileIdentity::of(&metadata))
            .ok();
        held == Some(self.lock)
            && FileIdentity::of_directory(directory) == Some(self.directory)
            && FileIdentity::of_regular_file(&directory.join(ROOT_LEASE_FILE_NAME))
                == Some(self.lock)
            && FileIdentity::of_regular_file(&directory.join(DATABASE_FILE_NAME))
                == Some(self.database)
    }
}

fn lease_lost() -> StoreError {
    unavailable("the request journal lease no longer guards this project's history directory")
}

#[derive(Default)]
struct RootCell {
    claiming: Mutex<()>,
    lease: Mutex<Option<RootLease>>,
}

#[derive(Clone, Copy)]
pub(super) enum Patience {
    Snapshot,
    Until(Instant),
}

impl Patience {
    fn busy(self, snapshot: Duration) -> Result<Duration, StoreError> {
        match self {
            Self::Snapshot => Ok(snapshot),
            Self::Until(deadline) => remaining(deadline),
        }
    }
}

pub(super) type LeaseCheck<'a> = dyn FnMut(Option<&Connection>) -> Result<(), StoreError> + 'a;

impl RootCell {
    fn locked(&self) -> MutexGuard<'_, Option<RootLease>> {
        self.lease.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) struct HistoryRuntimeRequestStore {
    base_dir: PathBuf,
    snapshot_busy: Duration,
    roots: Mutex<HashMap<String, Arc<RootCell>>>,
    undecodable: UndecodableRows,
}

impl HistoryRuntimeRequestStore {
    pub(crate) fn new(base_dir: PathBuf) -> Self {
        Self::with_snapshot_busy_timeout(base_dir, SNAPSHOT_BUSY_TIMEOUT)
    }

    pub(crate) fn with_snapshot_busy_timeout(base_dir: PathBuf, snapshot_busy: Duration) -> Self {
        Self {
            base_dir,
            snapshot_busy,
            roots: Mutex::default(),
            undecodable: UndecodableRows::default(),
        }
    }

    fn directory(&self, scope: &HistoryScope) -> PathBuf {
        connection::database_path(&self.base_dir, &scope.root_key)
            .parent()
            .map_or_else(PathBuf::new, Path::to_path_buf)
    }

    fn open(&self, scope: &HistoryScope) -> Result<Connection, StoreError> {
        connection::open_with_busy_timeout(
            &self.base_dir,
            &scope.root_key,
            &scope.owner_id,
            self.snapshot_busy,
        )
        .map_err(unavailable)
    }

    pub(super) fn open_bound(
        &self,
        scope: &HistoryScope,
        patience: Patience,
        check: &mut LeaseCheck<'_>,
    ) -> Result<Connection, StoreError> {
        check(None)?;
        let opened = connection::open_existing(
            &self.base_dir,
            &scope.root_key,
            &scope.owner_id,
            patience.busy(self.snapshot_busy)?,
        )
        .map_err(unavailable);
        check(opened.as_ref().ok())?;
        let connection = opened?;
        let validated =
            connection::validate_existing(&connection, &scope.root_key, &scope.owner_id)
                .map_err(unavailable);
        check(Some(&connection))?;
        validated?;
        connection
            .busy_timeout(patience.busy(self.snapshot_busy)?)
            .map_err(runtime_requests::store_error)?;
        Ok(connection)
    }

    pub(super) fn guarded<T>(
        &self,
        scope: &HistoryScope,
        patience: Patience,
        operation: impl FnOnce(&mut Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let mut connection = self.open_bound(scope, patience, &mut |connection| {
            self.require_bound(scope, connection)
        })?;
        let outcome = operation(&mut connection);
        self.require_bound(scope, Some(&connection))?;
        outcome
    }

    fn known_root(&self, scope: &HistoryScope) -> Option<Arc<RootCell>> {
        self.roots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&scope.root_key)
            .cloned()
    }

    fn root(&self, scope: &HistoryScope) -> Result<Arc<RootCell>, StoreError> {
        let mut roots = self.roots.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(cell) = roots.get(&scope.root_key) {
            return Ok(Arc::clone(cell));
        }
        if roots.len() >= MAX_JOURNALED_ROOTS {
            return Err(unavailable(
                "too many projects journal agent requests in this run",
            ));
        }
        let cell = Arc::new(RootCell::default());
        roots.insert(scope.root_key.clone(), Arc::clone(&cell));
        Ok(cell)
    }

    pub(super) fn require_bound(
        &self,
        scope: &HistoryScope,
        connection: Option<&Connection>,
    ) -> Result<(), StoreError> {
        let Some(cell) = self.known_root(scope) else {
            return Err(not_claimed());
        };
        let mut lease = cell.locked();
        let Some(lease) = lease.as_mut() else {
            return Err(not_claimed());
        };
        lease.check(connection, &self.directory(scope))
    }

    pub(super) fn prepare_claim(&self, scope: &HistoryScope) -> Result<PreparedClaim, StoreError> {
        drop(self.open(scope)?);
        let directory = self.directory(scope);
        let prepared = FileIdentity::of_directory(&directory)
            .zip(FileIdentity::of_regular_file(
                &directory.join(DATABASE_FILE_NAME),
            ))
            .map(|(directory, database)| PreparedClaim {
                directory,
                database,
            });
        prepared.ok_or_else(lease_lost)
    }

    pub(super) fn recover_under(
        &self,
        scope: &HistoryScope,
        lease: &mut RootLease,
        prepared: &PreparedClaim,
        (run_id, now_epoch_ms): (&str, u64),
    ) -> Result<RecoveryReport, StoreError> {
        let directory = self.directory(scope);
        if !lease.guards_the_prepared(prepared, &directory) {
            return Err(lease_lost());
        }
        let mut connection = self.open_bound(scope, Patience::Snapshot, &mut |connection| {
            lease.check(connection, &directory)
        })?;
        let recovered = runtime_requests::recover(&mut connection, run_id, now_epoch_ms);
        lease.check(Some(&connection), &directory)?;
        recovered
    }

    pub(super) fn complete_claim(
        &self,
        scope: &HistoryScope,
        prepared: &PreparedClaim,
        run: (&str, u64),
    ) -> Result<RootClaim, StoreError> {
        let cell = self.root(scope)?;
        let _claiming = cell.claiming.lock().unwrap_or_else(PoisonError::into_inner);
        if self.already_claimed(scope)? {
            return Ok(RootClaim::AlreadyOwned);
        }
        let Some(mut acquired) = RootLease::acquire(&self.directory(scope))? else {
            return Ok(RootClaim::HeldByAnotherInstance);
        };
        let recovered = self.recover_under(scope, &mut acquired, prepared, run);
        if acquired.lost || recovered.is_ok() {
            *cell.locked() = Some(acquired);
        }
        recovered.map(RootClaim::Acquired)
    }

    fn already_claimed(&self, scope: &HistoryScope) -> Result<bool, StoreError> {
        let Some(cell) = self.known_root(scope) else {
            return Ok(false);
        };
        let mut lease = cell.locked();
        let Some(held) = lease.as_mut() else {
            return Ok(false);
        };
        if !held.guards(&self.directory(scope)) {
            return Err(lease_lost());
        }
        Ok(true)
    }
}

impl RuntimeRequestStore for HistoryRuntimeRequestStore {
    fn claim_root(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        now_epoch_ms: u64,
    ) -> Result<RootClaim, StoreError> {
        self.root(scope)?;
        if self.already_claimed(scope)? {
            return Ok(RootClaim::AlreadyOwned);
        }
        let prepared = self.prepare_claim(scope)?;
        self.complete_claim(scope, &prepared, (run_id, now_epoch_ms))
    }

    fn apply_snapshot(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        observation: &TurnObservation,
    ) -> Result<ApplyReport, StoreError> {
        self.guarded(scope, Patience::Snapshot, |connection| {
            runtime_requests::apply_snapshot(connection, run_id, observation)
        })
    }

    fn record_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        intent: &AnswerIntent,
        deadline: Instant,
    ) -> Result<IntentReceipt, StoreError> {
        self.guarded(scope, Patience::Until(deadline), |connection| {
            runtime_requests::record_intent(connection, run_id, intent)
        })
    }

    fn settle_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        settle: &IntentSettle,
        deadline: Instant,
    ) -> Result<bool, StoreError> {
        self.guarded(scope, Patience::Until(deadline), |connection| {
            runtime_requests::settle_intent(connection, run_id, settle)
        })
    }

    fn read(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        limit: usize,
    ) -> Result<StoredRequests, StoreError> {
        self.guarded(scope, Patience::Snapshot, |connection| {
            runtime_requests::read(connection, thread_id, limit)
        })
    }

    fn retain_turn_states(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        known_turns: &[TurnKey],
    ) -> Result<u64, StoreError> {
        self.guarded(scope, Patience::Snapshot, |connection| {
            runtime_requests::retain_turn_states(connection, run_id, known_turns)
        })
    }

    fn holds_root(&self, scope: &HistoryScope) -> Result<bool, StoreError> {
        let Some(cell) = self.known_root(scope) else {
            return Ok(false);
        };
        let mut lease = cell.locked();
        let Some(lease) = lease.as_mut() else {
            return Ok(false);
        };
        lease.check(None, &self.directory(scope)).map(|()| true)
    }

    fn read_thread(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        deadline: Instant,
        read: &mut ThreadRead<'_>,
    ) -> Result<(), StoreError> {
        self.guarded(scope, Patience::Until(deadline), |connection| {
            runtime_request_thread_rows::read_thread(
                connection,
                (&scope.root_key, thread_id),
                &self.undecodable,
                read,
            )
        })
    }
}
