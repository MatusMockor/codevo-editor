use super::super::errors::{classify_sqlite_error, AgentTurnLogError};
use super::super::paths::AGENT_TURN_LOG_USER_VERSION;
use super::*;

#[cfg(unix)]
fn mode_of(path: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::symlink_metadata(path)
        .expect("stat path")
        .permissions()
        .mode()
        & 0o777
}

#[test]
fn the_turn_log_store_is_a_sibling_of_the_thread_store() {
    let temp = TempLogStore::create("sibling");
    let store = temp.store();

    store.open(&open_request(TURN_ID)).expect("open lease");

    let threads = temp.base.join("agent-threads");
    assert!(temp.database().exists());
    assert!(!temp.database().starts_with(&threads));
    assert!(temp
        .database()
        .starts_with(temp.base.join("agent-thread-logs").join("v1")));
}

#[test]
#[cfg(unix)]
fn the_database_and_its_write_ahead_sidecars_stay_private() {
    let temp = TempLogStore::create("modes");
    let store = temp.store();
    seed(&store, TURN_ID, 4);

    assert_eq!(mode_of(&temp.database()), 0o600);
    assert_eq!(mode_of(&temp.root_directory()), 0o700);
    assert_eq!(
        mode_of(&temp.base.join("agent-thread-logs").join("v1")),
        0o700
    );
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = temp.database().into_os_string();
        sidecar.push(suffix);
        let sidecar = std::path::PathBuf::from(sidecar);
        assert!(sidecar.exists(), "missing {suffix}");
        assert_eq!(mode_of(&sidecar), 0o600, "{suffix}");
    }
}

#[test]
#[cfg(unix)]
fn a_symlinked_store_directory_is_refused() {
    let temp = TempLogStore::create("symlink-directory");
    let elsewhere = temp.base.join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("create foreign directory");
    std::os::unix::fs::symlink(&elsewhere, temp.base.join("agent-thread-logs"))
        .expect("symlink the store directory");
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("a symlinked store directory is refused");

    assert_eq!(code(refused), "foreign");
}

#[test]
#[cfg(unix)]
fn a_symlinked_database_path_is_refused() {
    let temp = TempLogStore::create("symlink-database");
    let target = temp.base.join("target.sqlite3");
    fs::write(&target, [0u8; 8]).expect("write link target");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    std::os::unix::fs::symlink(&target, temp.database()).expect("symlink the database");
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("a symlinked database is refused");

    assert_eq!(code(refused), "foreign");
    assert!(temp.database().exists(), "the symlink was never deleted");
}

#[test]
fn a_corrupt_database_is_quarantined_and_never_deleted() {
    let temp = TempLogStore::create("corrupt");
    let store = temp.store();
    seed(&store, TURN_ID, 4);
    drop(store);
    let mut content = fs::read(temp.database()).expect("read database");
    let length = content.len();
    content[length / 2..].fill(0x5a);
    fs::write(temp.database(), &content).expect("corrupt database");
    let reopened = temp.store();

    let refused = reopened
        .open(&open_request(TURN_ID))
        .expect_err("a corrupt database is refused");
    let quarantined = fs::read_dir(temp.root_directory())
        .expect("read root directory")
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));

    assert_eq!(code(refused), "unreadable");
    assert!(
        quarantined,
        "the corrupt database must be renamed, not deleted"
    );
}

#[test]
fn a_foreign_user_version_is_never_written_and_never_deleted() {
    let temp = TempLogStore::create("foreign-version");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    let connection = rusqlite::Connection::open(temp.database()).expect("create foreign database");
    connection
        .execute_batch(
            "CREATE TABLE foreign_rows (id INTEGER PRIMARY KEY); PRAGMA user_version = 99;",
        )
        .expect("seed foreign database");
    drop(connection);
    let before = fs::metadata(temp.database()).expect("stat database").len();
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("a foreign database is refused");
    let after = fs::metadata(temp.database()).expect("stat database").len();

    assert_eq!(code(refused), "foreign");
    assert_eq!(before, after);
    let reopened = rusqlite::Connection::open(temp.database()).expect("reopen foreign database");
    let version: i64 = reopened
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read user version");
    assert_eq!(version, 99);
}

#[test]
fn an_unversioned_database_with_foreign_tables_is_refused() {
    let temp = TempLogStore::create("foreign-tables");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    let connection = rusqlite::Connection::open(temp.database()).expect("create foreign database");
    connection
        .execute_batch("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);")
        .expect("seed foreign tables");
    drop(connection);
    let store = temp.store();

    let refused = store
        .open(&open_request(TURN_ID))
        .expect_err("foreign tables are refused");

    assert_eq!(code(refused), "foreign");
}

#[test]
fn a_fresh_database_is_stamped_with_the_supported_user_version() {
    let temp = TempLogStore::create("user-version");
    let store = temp.store();
    store.open(&open_request(TURN_ID)).expect("open lease");
    drop(store);

    let connection = rusqlite::Connection::open(temp.database()).expect("open database");
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read user version");

    assert_eq!(version, AGENT_TURN_LOG_USER_VERSION);
}

#[test]
fn a_transaction_dropped_mid_batch_leaves_nothing_behind() {
    let temp = TempLogStore::create("mid-transaction");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);
    {
        let mut connection = rusqlite::Connection::open(temp.database()).expect("raw connection");
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .expect("begin");
        transaction
            .execute(
                "INSERT INTO events (turn_id, seq, kind, bytes, payload) VALUES (?1, 99, 8, 3, ?2)",
                rusqlite::params![TURN_ID, b"abc".to_vec()],
            )
            .expect("insert inside the transaction");
    }

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");
    store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "c")]))
        .expect("the log still accepts appends");

    assert_eq!(page.entries.len(), 2);
}

#[test]
fn a_foreign_owner_or_thread_identifier_is_refused_before_any_file_is_created() {
    let temp = TempLogStore::create("authority");
    let store = temp.store();
    let mut foreign_owner = open_request(TURN_ID);
    foreign_owner.scope.owner_id = "agent-root:0000000000000000".to_string();
    let mut traversal = open_request(TURN_ID);
    traversal.scope.thread_id = "../../etc/passwd".to_string();
    let mut foreign_turn = open_request(TURN_ID);
    foreign_turn.scope.turn_id = "../escape".to_string();

    let refused_owner = store.open(&foreign_owner).expect_err("foreign owner");
    let refused_thread = store.open(&traversal).expect_err("thread traversal");
    let refused_turn = store.open(&foreign_turn).expect_err("turn traversal");

    assert_eq!(code(refused_owner), "ownerMismatch");
    assert_eq!(code(refused_thread), "ownerMismatch");
    assert_eq!(code(refused_turn), "ownerMismatch");
    assert!(!temp.base.join("agent-thread-logs").exists());
}

#[test]
fn a_thread_document_owned_by_another_root_refuses_the_append() {
    let temp = TempLogStore::create("thread-owner");
    let store = temp.store();
    temp.write_thread_document(ROOT_KEY);
    let epoch = seed(&store, TURN_ID, 1);
    let foreign = temp
        .base
        .join("agent-threads")
        .join(fnv1a64hex(ROOT_KEY))
        .join(format!("{THREAD_ID}.json"));
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&foreign).expect("read document")).expect("parse");
    document["thread"]["owner"]["rootKey"] = serde_json::json!("/workspace/beta");
    fs::write(&foreign, document.to_string()).expect("rewrite document");

    let refused = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "b")]))
        .expect_err("a foreign thread document refuses the append");

    assert_eq!(code(refused), "ownerMismatch");
}

#[test]
fn a_disk_full_failure_maps_to_the_closed_code_and_keeps_the_connection() {
    let full =
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL), None);
    let corrupt = rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
        None,
    );

    let busy =
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY), None);

    assert_eq!(classify_sqlite_error(&full), AgentTurnLogError::DiskFull);
    assert_eq!(code(classify_sqlite_error(&full)), "diskFull");
    assert!(AgentTurnLogError::DiskFull.retains_connection());
    assert_eq!(classify_sqlite_error(&corrupt), AgentTurnLogError::Corrupt);
    assert_eq!(code(classify_sqlite_error(&corrupt)), "unreadable");
    assert_eq!(classify_sqlite_error(&busy), AgentTurnLogError::Busy);
    assert_eq!(code(classify_sqlite_error(&busy)), "busy");
    assert!(classify_sqlite_error(&busy).retains_connection());
    assert!(!AgentTurnLogError::Unreadable.retains_connection());
    assert!(!AgentTurnLogError::Foreign.retains_connection());
}

#[test]
fn a_failed_statement_leaves_the_pooled_connection_usable() {
    let temp = TempLogStore::create("connection-retained");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);

    let refused = store
        .append(&append_request(TURN_ID, epoch, 9, vec![entry(9, "x")]))
        .expect_err("a sequence gap is refused");
    let receipt = store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "c")]))
        .expect("the same connection keeps working");

    assert_eq!(code(refused), "sequenceGap");
    assert_eq!(receipt.next_seq, 4);
}
