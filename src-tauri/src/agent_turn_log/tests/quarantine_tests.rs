use super::*;

fn replace_database(temp: &TempLogStore, bytes: &[u8]) {
    let replacement = temp.base.join("replacement.sqlite3");
    fs::write(&replacement, bytes).expect("write the replacement database");
    fs::rename(&replacement, temp.database()).expect("replace the database");
}

fn quarantined(names: &[String]) -> bool {
    names.iter().any(|name| name.contains(".corrupt-"))
}

#[test]
fn a_garbage_header_database_is_quarantined_with_its_sidecars() {
    let temp = TempLogStore::create("garbage-header");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    fs::write(temp.database(), vec![0x5a; 4096]).expect("write a garbage header");
    fs::write(sidecar(&temp.database(), "-wal"), vec![0x5a; 64]).expect("write a stale sidecar");
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("a garbage header is refused");
    let names = file_names(&temp.root_directory());

    assert_eq!(code(refused), "unreadable");
    assert!(
        !temp.database().exists(),
        "the unreadable database must be renamed out of the way: {names:?}"
    );
    assert!(
        names.iter().any(|name| name.contains(".corrupt-")),
        "the unreadable database must be quarantined, not deleted: {names:?}"
    );
    assert!(
        names
            .iter()
            .any(|name| name.contains(".corrupt-") && name.ends_with("-wal")),
        "the sidecar must be renamed alongside, never deleted: {names:?}"
    );
}

#[test]
fn a_full_database_reports_disk_full_and_keeps_the_pooled_connection() {
    let temp = TempLogStore::create("disk-full");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    cap_pages(&store);
    let heavy: Vec<AgentTurnLogEntry> = (2..=12)
        .map(|seq| entry(seq, &"y".repeat(16 * 1024)))
        .collect();

    let refused = store
        .append(&append_request(TURN_ID, epoch, 2, heavy.clone()))
        .expect_err("a full database refuses the batch");
    let refused_again = store
        .append(&append_request(TURN_ID, epoch, 2, heavy))
        .expect_err("the page ceiling still holds on the pooled connection");
    raise_pages(&store);
    let receipt = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "after")]))
        .expect("the same connection works once there is room again");
    let names = file_names(&temp.root_directory());

    assert_eq!(code(refused), "diskFull");
    assert_eq!(code(refused_again), "diskFull");
    assert_eq!(receipt.next_seq, 3);
    assert!(
        !names.iter().any(|name| name.contains(".corrupt-")),
        "a full database must never be quarantined: {names:?}"
    );
}

#[cfg(unix)]
#[test]
fn an_unreadable_shared_index_never_quarantines_a_healthy_database() {
    use std::os::unix::fs::PermissionsExt;
    let temp = TempLogStore::create("unreadable-shared-index");
    let writer = temp.store();
    seed(&writer, TURN_ID, 4);
    drop(writer);
    let healthy = fs::read(temp.database()).expect("read the healthy database");
    replace_database(&temp, &healthy);
    let shared_index = sidecar(&temp.database(), "-shm");
    fs::write(&shared_index, []).expect("create a shared index");
    fs::set_permissions(&shared_index, fs::Permissions::from_mode(0o000))
        .expect("seal the shared index");
    let reader = temp.store();

    let refused = reader
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect_err("an unreadable shared index refuses the read");
    let names = file_names(&temp.root_directory());
    fs::set_permissions(&shared_index, fs::Permissions::from_mode(0o600))
        .expect("unseal the shared index");
    fs::remove_file(&shared_index).expect("remove the shared index");
    let recovered = temp
        .store()
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("the healthy database still reads");

    assert_eq!(code(refused), "unreadable");
    assert!(
        !quarantined(&names),
        "an io error must never quarantine a healthy database: {names:?}"
    );
    assert_eq!(
        fs::read(temp.database()).expect("read the database"),
        healthy,
        "a failed read replaced the healthy database"
    );
    assert_eq!(recovered.entries.len(), 4);
}

#[cfg(unix)]
#[test]
fn an_io_error_during_verification_stays_retryable_instead_of_corrupt() {
    use super::super::integrity::verify_integrity_once;
    use std::os::unix::fs::PermissionsExt;
    let temp = TempLogStore::create("verification-io-error");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    let database = temp.database();
    let writer = rusqlite::Connection::open(&database).expect("create the database");
    writer
        .pragma_update(None, "journal_mode", "WAL")
        .expect("switch to the write ahead log");
    writer
        .execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (1);")
        .expect("seed a page");
    drop(writer);
    let shared_index = sidecar(&database, "-shm");
    fs::write(&shared_index, []).expect("create a shared index");
    fs::set_permissions(&shared_index, fs::Permissions::from_mode(0o000))
        .expect("seal the shared index");
    let reader = rusqlite::Connection::open_with_flags(
        &database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("open the database read only");

    let refused = verify_integrity_once(&reader, &database)
        .expect_err("a sealed shared index refuses verification");

    fs::set_permissions(&shared_index, fs::Permissions::from_mode(0o600))
        .expect("unseal the shared index");
    assert_eq!(
        refused,
        AgentTurnLogError::Unreadable,
        "an io error during verification must stay retryable"
    );
    assert!(database.exists(), "verification deleted the database");
}

#[test]
fn a_failing_integrity_verdict_still_quarantines_the_database() {
    let temp = TempLogStore::create("failing-verdict");
    let writer = temp.store();
    seed(&writer, TURN_ID, 64);
    drop(writer);
    let mut bytes = fs::read(temp.database()).expect("read the database");
    assert!(
        bytes.len() > 8192,
        "the seeded database needs several pages"
    );
    bytes[4096..8192].fill(0x5a);
    replace_database(&temp, &bytes);
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("a failing verdict is refused");
    let names = file_names(&temp.root_directory());

    assert_eq!(code(refused), "unreadable");
    assert!(
        !temp.database().exists(),
        "a corrupt database must be renamed out of the way: {names:?}"
    );
    assert!(
        quarantined(&names),
        "a failing verdict must quarantine, not delete: {names:?}"
    );
}

#[test]
fn a_quarantine_never_returns_a_checked_out_connection_to_the_pool() {
    let temp = TempLogStore::create("quarantine-pool");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);

    let refused = store
        .with_pooled_connection(&scope(TURN_ID), |_held| {
            replace_database(&temp, &[0x5a; 4096]);
            for suffix in ["-wal", "-shm"] {
                fs::remove_file(sidecar(&temp.database(), suffix)).expect("drop the sidecar");
            }
            store
                .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "during")]))
                .expect_err("a garbage database refuses the second connection")
        })
        .expect("reach the pooled connection")
        .expect("the pooled connection was reachable");
    let after_quarantine = store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "after")]))
        .err();
    let names = file_names(&temp.root_directory());

    assert_eq!(code(refused), "unreadable");
    assert!(
        quarantined(&names),
        "the garbage database must be quarantined: {names:?}"
    );
    assert_eq!(
        after_quarantine.map(code),
        Some("supersededWriter"),
        "a pooled connection to the quarantined database survived: {names:?}"
    );
}

fn cap_pages(store: &AgentTurnLogStore) {
    store
        .with_pooled_connection(&scope(TURN_ID), |connection| {
            let pages: i64 = connection
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .expect("read the page count");
            connection
                .pragma_update(None, "max_page_count", pages)
                .expect("cap the database size");
        })
        .expect("reach the pooled connection");
}

fn raise_pages(store: &AgentTurnLogStore) {
    store
        .with_pooled_connection(&scope(TURN_ID), |connection| {
            connection
                .pragma_update(None, "max_page_count", 1_000_000i64)
                .expect("raise the database ceiling");
        })
        .expect("reach the pooled connection");
}

#[test]
fn a_write_lock_held_elsewhere_reports_a_retryable_busy_without_quarantine() {
    let temp = TempLogStore::create("busy");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    let mut blocker = rusqlite::Connection::open(temp.database()).expect("blocking connection");
    let held = blocker
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("hold the write lock");
    held.execute(
        "INSERT INTO events (turn_id, seq, kind, bytes, payload) VALUES (?1, 900, 8, 3, ?2)",
        rusqlite::params![TURN_ID, b"abc".to_vec()],
    )
    .expect("write inside the held transaction");

    let refused = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "b")]))
        .expect_err("a held write lock refuses the append");
    drop(held);
    drop(blocker);
    let receipt = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "b")]))
        .expect("the same connection keeps working once the lock is released");
    let names = file_names(&temp.root_directory());

    assert_eq!(code(refused), "busy");
    assert_eq!(receipt.next_seq, 3);
    assert!(
        !names.iter().any(|name| name.contains(".corrupt-")),
        "a busy database must never be quarantined: {names:?}"
    );
}
