use super::super::super::runtime_request_store::{Patience, RootLease};
use super::*;
use crate::agent_runtime_requests::store::StoreError;
use std::path::{Path, PathBuf};

const OTHER: &str = "/workspace/other";
const LEASE_FILE: &str = "runtime-requests.lock";

fn rows_in(directory: &Path) -> Vec<String> {
    let connection =
        rusqlite::Connection::open(directory.join("history.sqlite3")).expect("open the database");
    connection
        .busy_timeout(Duration::from_secs(5))
        .expect("busy timeout");
    let mut statement = connection
        .prepare(
            "SELECT turn_id||'/'||request_id||':'||status||':'||version
             FROM runtime_requests ORDER BY reg_index",
        )
        .expect("rows statement");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("rows");
    rows.map(|row| row.expect("row")).collect()
}

struct TwoProjects {
    journaled: Journaled,
    other: HistoryScope,
}

impl TwoProjects {
    fn claimed() -> Self {
        let journaled = Journaled::new();
        let other = HistoryScope {
            root_key: OTHER.to_string(),
            owner_id: legacy::agent_root_owner_id(OTHER),
        };
        assert_eq!(
            journaled.store.claim_root(&other, RUN, 0),
            Ok(RootClaim::Acquired(RecoveryReport::default()))
        );
        let listed = snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
            ],
        );
        let projects = Self { journaled, other };
        for scope in [&projects.journaled.scope, &projects.other] {
            let store = &projects.journaled.store;
            assert_eq!(
                store
                    .apply_snapshot(scope, RUN, &listed)
                    .map(|report| report.transitions),
                Ok(2)
            );
            assert_eq!(
                store.record_intent(scope, RUN, &sent("question-2", 2), before_deadline()),
                Ok(IntentReceipt::Recorded)
            );
        }
        projects
    }

    fn directory(&self, root: &str) -> PathBuf {
        connection::database_path(&self.journaled.fixture.base, root)
            .parent()
            .expect("history directory")
            .to_path_buf()
    }

    fn refusals(&self) -> Vec<Result<(), StoreErrorKind>> {
        let store = &self.journaled.store;
        let scope = &self.journaled.scope;
        let closing = snapshot(
            5,
            vec![
                question("question-1", expired()),
                question("question-2", expired()),
            ],
        );
        let settle = IntentSettle {
            key: key(TURN),
            incarnation: INCARNATION,
            request_id: "question-2".to_string(),
            intent_version: 2,
            settlement: IntentSettlement::DeliveryFailed,
            version: 7,
            at_epoch_ms: 9_000,
        };
        [
            store.apply_snapshot(scope, RUN, &closing).map(|_| ()),
            store
                .record_intent(scope, RUN, &sent("question-1", 6), before_deadline())
                .map(|_| ()),
            store
                .settle_intent(scope, RUN, &settle, before_deadline())
                .map(|_| ()),
            store.read(scope, THREAD, 256).map(|_| ()),
            store.retain_turn_states(scope, RUN, &[]).map(|_| ()),
        ]
        .into_iter()
        .map(|outcome| outcome.map_err(|error| error.kind))
        .collect()
    }

    fn reclaimed(&self) -> Result<RootClaim, StoreErrorKind> {
        self.journaled
            .store
            .claim_root(&self.journaled.scope, RUN, 0)
            .map_err(|error| error.kind)
    }

    fn other_still_accepts_its_own_answer(&self) -> bool {
        self.journaled.store.record_intent(
            &self.other,
            RUN,
            &sent("question-1", 8),
            before_deadline(),
        ) == Ok(IntentReceipt::Recorded)
    }
}

fn sent(request_id: &str, version: u64) -> AnswerIntent {
    intent(request_id, answers("Nothing else."), version)
}

fn every_operation_refused() -> Vec<Result<(), StoreErrorKind>> {
    vec![Err(StoreErrorKind::Unavailable); 5]
}

#[test]
fn history_directory_redirected_to_another_project_never_receives_this_projects_writes() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let other = projects.directory(OTHER);
    let moved = own.with_extension("moved");
    let (own_rows, other_rows) = (rows_in(&own), rows_in(&other));
    assert_eq!(own_rows, other_rows);
    fs::rename(&own, &moved).expect("move the history directory away");
    std::os::unix::fs::symlink(&other, &own).expect("redirect the history directory");

    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Err(StoreErrorKind::Unavailable));

    assert_eq!(rows_in(&other), other_rows);
    assert_eq!(rows_in(&moved), own_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

#[test]
fn history_directory_swapped_for_another_projects_directory_never_receives_this_projects_writes() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let other = projects.directory(OTHER);
    let moved = own.with_extension("moved");
    let other_rows = rows_in(&other);
    fs::rename(&own, &moved).expect("move the history directory away");
    fs::rename(&other, &own).expect("move the other project's directory in");

    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Err(StoreErrorKind::Unavailable));

    assert_eq!(rows_in(&own), other_rows);
}

fn checkpoint(directory: &Path) {
    rusqlite::Connection::open(directory.join("history.sqlite3"))
        .and_then(|connection| connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);"))
        .expect("checkpoint the database");
}

#[test]
fn recreated_history_directory_is_refused_even_when_it_links_the_lease_file_that_is_held() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let moved = own.with_extension("moved");
    checkpoint(&own);
    fs::rename(&own, &moved).expect("move the history directory away");
    fs::create_dir(&own).expect("recreate the history directory");
    fs::hard_link(moved.join(LEASE_FILE), own.join(LEASE_FILE)).expect("link the held lease");
    fs::copy(moved.join("history.sqlite3"), own.join("history.sqlite3"))
        .expect("copy the database");
    let recreated_rows = rows_in(&own);
    assert_eq!(recreated_rows, rows_in(&moved));

    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Err(StoreErrorKind::Unavailable));

    assert_eq!(rows_in(&own), recreated_rows);
    assert_eq!(rows_in(&moved), recreated_rows);
}

#[test]
fn database_overwritten_in_place_by_another_projects_database_is_refused_by_its_recorded_owner() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let other = projects.directory(OTHER);
    checkpoint(&other);
    checkpoint(&own);
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(own.join(format!("history.sqlite3{suffix}")));
    }
    let foreign = fs::read(other.join("history.sqlite3")).expect("read the other database");
    fs::write(own.join("history.sqlite3"), foreign).expect("overwrite the database in place");
    let replaced_rows = rows_in(&own);
    assert_eq!(replaced_rows, rows_in(&other));

    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Ok(RootClaim::AlreadyOwned));

    assert_eq!(rows_in(&own), replaced_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

#[test]
fn replaced_lease_file_is_never_trusted_again_by_the_instance_that_held_the_original() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let own_rows = rows_in(&own);
    fs::remove_file(own.join(LEASE_FILE)).expect("remove the lease file");
    fs::write(own.join(LEASE_FILE), b"").expect("plant another lease file");

    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Err(StoreErrorKind::Unavailable));

    assert_eq!(rows_in(&own), own_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

fn every_operation_refused_again(projects: &TwoProjects) {
    assert_eq!(projects.refusals(), every_operation_refused());
    assert_eq!(projects.reclaimed(), Err(StoreErrorKind::Unavailable));
}

#[test]
fn lease_lost_to_a_replaced_lock_file_stays_lost_after_the_original_file_is_restored() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let own_rows = rows_in(&own);
    let kept = own.join("kept.lock");
    fs::rename(own.join(LEASE_FILE), &kept).expect("keep the original lease file");
    fs::write(own.join(LEASE_FILE), b"").expect("plant another lease file");
    assert_eq!(projects.refusals(), every_operation_refused());

    fs::rename(&kept, own.join(LEASE_FILE)).expect("restore the original lease file");

    every_operation_refused_again(&projects);
    assert_eq!(rows_in(&own), own_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

#[test]
fn lease_lost_to_a_replaced_directory_stays_lost_after_the_original_directory_is_restored() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let moved = own.with_extension("moved");
    let own_rows = rows_in(&own);
    fs::rename(&own, &moved).expect("move the history directory away");
    fs::create_dir(&own).expect("plant another directory");
    assert_eq!(projects.refusals(), every_operation_refused());

    fs::remove_dir(&own).expect("remove the planted directory");
    fs::rename(&moved, &own).expect("restore the original directory");

    every_operation_refused_again(&projects);
    assert_eq!(rows_in(&own), own_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

struct Restarted {
    fixture: Fixture,
    scope: HistoryScope,
    store: HistoryRuntimeRequestStore,
    directory: PathBuf,
    rows: Vec<String>,
}

impl Restarted {
    fn after_a_run_that_left_a_pending_request() -> Self {
        let previous = Journaled::new();
        previous.apply(
            RUN,
            &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
        );
        let Journaled {
            fixture,
            store,
            scope,
        } = previous;
        drop(store);
        let directory = connection::database_path(&fixture.base, ROOT)
            .parent()
            .expect("history directory")
            .to_path_buf();
        checkpoint(&directory);
        Self {
            store: HistoryRuntimeRequestStore::new(fixture.base.clone()),
            rows: rows_in(&directory),
            fixture,
            scope,
            directory,
        }
    }

    fn claimed(&self) -> Result<RootClaim, StoreErrorKind> {
        self.store
            .claim_root(&self.scope, NEXT_RUN, 60_000)
            .map_err(|error| error.kind)
    }

    fn recovers_after_another_restart(self) -> bool {
        let Self {
            fixture,
            scope,
            store,
            directory,
            ..
        } = self;
        drop(store);
        let next = HistoryRuntimeRequestStore::new(fixture.base.clone());
        let claimed = next.claim_root(&scope, NEXT_RUN, 60_000);
        let recovered = matches!(claimed, Ok(RootClaim::Acquired(report)) if report.expired == 1);
        recovered && rows_in(&directory) == ["agt-turn-0001/question-1:expired:2"]
    }
}

#[test]
fn directory_replaced_between_preparation_and_lease_acquisition_is_never_recovered() {
    let restarted = Restarted::after_a_run_that_left_a_pending_request();
    let own = restarted.directory.clone();
    let moved = own.with_extension("moved");
    assert_eq!(restarted.rows, ["agt-turn-0001/question-1:pending:1"]);
    let prepared = restarted
        .store
        .prepare_claim(&restarted.scope)
        .expect("prepare the claim");
    fs::rename(&own, &moved).expect("move the history directory away");
    fs::create_dir(&own).expect("recreate the history directory");
    fs::copy(moved.join("history.sqlite3"), own.join("history.sqlite3"))
        .expect("copy the database");

    let claimed = restarted
        .store
        .complete_claim(&restarted.scope, &prepared, (NEXT_RUN, 60_000))
        .map_err(|error| error.kind);

    assert_eq!(claimed, Err(StoreErrorKind::Unavailable));
    assert_eq!(rows_in(&own), restarted.rows);
    assert_eq!(rows_in(&moved), restarted.rows);
    fs::remove_dir_all(&own).expect("remove the planted directory");
    fs::rename(&moved, &own).expect("restore the original directory");
    assert_eq!(restarted.claimed(), Err(StoreErrorKind::Unavailable));
    assert_eq!(rows_in(&own), restarted.rows);
    assert!(restarted.recovers_after_another_restart());
}

#[test]
fn lease_file_replaced_between_acquisition_and_recovery_is_never_recovered() {
    let restarted = Restarted::after_a_run_that_left_a_pending_request();
    let own = restarted.directory.clone();
    let kept = own.join("kept.lock");
    let prepared = restarted
        .store
        .prepare_claim(&restarted.scope)
        .expect("prepare the claim");
    let mut lease = RootLease::acquire(&own)
        .expect("acquire the lease")
        .expect("no other instance holds the lease");
    fs::rename(own.join(LEASE_FILE), &kept).expect("keep the original lease file");
    fs::write(own.join(LEASE_FILE), b"").expect("plant another lease file");
    let recover = |lease: &mut RootLease| {
        restarted
            .store
            .recover_under(&restarted.scope, lease, &prepared, (NEXT_RUN, 60_000))
            .map_err(|error| error.kind)
    };

    assert_eq!(recover(&mut lease), Err(StoreErrorKind::Unavailable));
    assert_eq!(rows_in(&own), restarted.rows);
    fs::rename(&kept, own.join(LEASE_FILE)).expect("restore the original lease file");
    assert_eq!(recover(&mut lease), Err(StoreErrorKind::Unavailable));
    assert_eq!(rows_in(&own), restarted.rows);

    drop(lease);
    assert!(restarted.recovers_after_another_restart());
}

#[test]
fn undisturbed_claim_recovers_the_previous_run_exactly_once() {
    let restarted = Restarted::after_a_run_that_left_a_pending_request();

    let first = restarted.claimed();
    let second = restarted.claimed();

    assert!(matches!(first, Ok(RootClaim::Acquired(report)) if report.expired == 1));
    assert_eq!(second, Ok(RootClaim::AlreadyOwned));
    assert_eq!(
        rows_in(&restarted.directory),
        ["agt-turn-0001/question-1:expired:2"]
    );
}

#[test]
fn database_replaced_by_a_copy_of_another_projects_database_loses_the_lease() {
    let projects = TwoProjects::claimed();
    let own = projects.directory(ROOT);
    let other = projects.directory(OTHER);
    checkpoint(&other);
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(own.join(format!("history.sqlite3{suffix}")));
    }
    fs::copy(other.join("history.sqlite3"), own.join("history.sqlite3"))
        .expect("replace the database");
    let replaced_rows = rows_in(&own);

    every_operation_refused_again(&projects);

    assert_eq!(rows_in(&own), replaced_rows);
    assert!(projects.other_still_accepts_its_own_answer());
}

struct OlderCopy {
    directory: PathBuf,
    bytes: Vec<u8>,
}

impl OlderCopy {
    fn staged_beside(own: &Path) -> Self {
        let directory = own.with_extension("staged");
        checkpoint(own);
        fs::create_dir(&directory).expect("create the staged directory");
        let database = directory.join("history.sqlite3");
        fs::copy(own.join("history.sqlite3"), &database).expect("copy the database");
        rusqlite::Connection::open(&database)
            .and_then(|connection| {
                connection.execute_batch(
                    "PRAGMA journal_mode=DELETE;
                     DROP INDEX runtime_requests_open;
                     DROP INDEX runtime_requests_order;
                     DROP TABLE runtime_requests;
                     DROP TABLE runtime_request_marks;
                     DROP TABLE runtime_request_turns;",
                )
            })
            .expect("downgrade the staged copy");
        Self {
            bytes: fs::read(&database).expect("read the staged copy"),
            directory,
        }
    }

    fn is_untouched_in(&self, directory: &Path) -> bool {
        let mut entries: Vec<String> = fs::read_dir(directory)
            .expect("list the directory")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        entries.sort();
        entries == ["history.sqlite3"]
            && fs::read(directory.join("history.sqlite3")).ok().as_ref() == Some(&self.bytes)
    }
}

#[test]
fn same_owner_copy_with_an_older_schema_swapped_in_during_an_open_is_never_written() {
    let projects = TwoProjects::claimed();
    let (store, scope) = (&projects.journaled.store, &projects.journaled.scope);
    let own = projects.directory(ROOT);
    let moved = own.with_extension("moved");
    let own_rows = rows_in(&own);
    let older = OlderCopy::staged_beside(&own);
    let mut swapped = false;

    let opened = store.open_bound(scope, Patience::Snapshot, &mut |connection| {
        let checked = store.require_bound(scope, connection);
        if !swapped {
            swapped = true;
            fs::rename(&own, &moved).expect("move the history directory away");
            fs::rename(&older.directory, &own).expect("move the older copy in");
        }
        checked
    });

    assert_eq!(
        opened.map(|_| ()).map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert!(older.is_untouched_in(&own));
    fs::rename(&own, &older.directory).expect("move the older copy out");
    fs::rename(&moved, &own).expect("restore the original directory");
    every_operation_refused_again(&projects);
    assert_eq!(rows_in(&own), own_rows);
}

#[test]
fn connection_opened_on_a_swapped_database_file_is_refused_even_after_the_original_is_back() {
    let projects = TwoProjects::claimed();
    let (store, scope) = (&projects.journaled.store, &projects.journaled.scope);
    let own = projects.directory(ROOT);
    let (database, kept, planted) = (
        own.join("history.sqlite3"),
        own.join("kept.sqlite3"),
        own.join("planted.sqlite3"),
    );
    let older = OlderCopy::staged_beside(&own);
    let own_rows = rows_in(&own);
    checkpoint(&own);
    let mut step = 0;

    let opened = store.open_bound(scope, Patience::Snapshot, &mut |connection| {
        if step == 1 {
            fs::rename(&database, &planted).expect("move the planted database out");
            fs::rename(&kept, &database).expect("restore the original database");
        }
        let checked = store.require_bound(scope, connection);
        if step == 0 {
            fs::rename(&database, &kept).expect("keep the original database");
            fs::copy(older.directory.join("history.sqlite3"), &database)
                .expect("plant the older copy");
        }
        step += 1;
        checked
    });

    assert_eq!(
        opened.map(|_| ()).map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert_eq!(fs::read(&planted).ok().as_ref(), Some(&older.bytes));
    every_operation_refused_again(&projects);
    assert_eq!(rows_in(&own), own_rows);
}

#[test]
fn failed_open_under_a_lost_lease_latches_the_loss_instead_of_reporting_the_open_error() {
    let restarted = Restarted::after_a_run_that_left_a_pending_request();
    let own = restarted.directory.clone();
    let moved = own.with_extension("moved");
    let mut lease = RootLease::acquire(&own)
        .expect("acquire the lease")
        .expect("no other instance holds the lease");
    let mut swapped = false;

    let opened =
        restarted
            .store
            .open_bound(&restarted.scope, Patience::Snapshot, &mut |connection| {
                let checked = lease.check(connection, &own);
                if !swapped {
                    swapped = true;
                    fs::rename(&own, &moved).expect("move the history directory away");
                    std::os::unix::fs::symlink(&moved, &own).expect("plant a symlink");
                }
                checked
            });

    let error = opened.map(|_| ()).expect_err("the open is refused");
    assert_eq!(error.kind, StoreErrorKind::Unavailable);
    assert!(error.detail.contains("lease"), "{}", error.detail);
    fs::remove_file(&own).expect("remove the symlink");
    fs::rename(&moved, &own).expect("restore the original directory");
    assert_eq!(
        lease.check(None, &own).map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert_eq!(rows_in(&own), restarted.rows);
}

#[test]
fn operation_that_fails_under_a_lost_lease_latches_the_loss_instead_of_reporting_its_error() {
    let projects = TwoProjects::claimed();
    let (store, scope) = (&projects.journaled.store, &projects.journaled.scope);
    let own = projects.directory(ROOT);
    let moved = own.with_extension("moved");
    let own_rows = rows_in(&own);

    let failed: Result<(), StoreError> = store.guarded(scope, Patience::Snapshot, |_| {
        fs::rename(&own, &moved).expect("move the history directory away");
        fs::create_dir(&own).expect("plant another directory");
        Err(StoreError::new(
            StoreErrorKind::Busy,
            "the operation failed",
        ))
    });

    assert_eq!(
        failed.map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    fs::remove_dir(&own).expect("remove the planted directory");
    fs::rename(&moved, &own).expect("restore the original directory");
    every_operation_refused_again(&projects);
    assert_eq!(rows_in(&own), own_rows);
}
