#[cfg(unix)]
use super::*;

#[cfg(unix)]
use std::process::Command;

#[cfg(unix)]
fn child(test: &str, mode: &str, temp: &TempStore) {
    let test = test.split_once("::").expect("crate-qualified test name").1;
    let output = Command::new(std::env::current_exe().expect("test executable"))
        .args(["--exact", test, "--nocapture"])
        .env("CODEVO_REPLAY_TEST_MODE", mode)
        .env("CODEVO_REPLAY_TEST_BASE", &temp.base)
        .output()
        .expect("run child test");
    assert!(
        output.status.success(),
        "child failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("1 passed"),
        "child ran no test: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[cfg(unix)]
fn child_base(mode: &str) -> Option<PathBuf> {
    if std::env::var("CODEVO_REPLAY_TEST_MODE").ok().as_deref() != Some(mode) {
        return None;
    }
    Some(PathBuf::from(
        std::env::var_os("CODEVO_REPLAY_TEST_BASE").expect("child store path"),
    ))
}

#[cfg(unix)]
#[test]
fn write_exclusion_survives_prepare_during_immediate_transaction() {
    if let Some(base) = child_base("write-lock") {
        let database = paths::directory(&base).join("cache.sqlite3");
        let mut connection = Connection::open(database).expect("open child writer");
        connection
            .busy_timeout(std::time::Duration::ZERO)
            .expect("disable child lock wait");
        let result = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate);
        assert!(matches!(
            result,
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == rusqlite::ErrorCode::DatabaseBusy
        ));
        return;
    }
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "initial", 1);
    let mut connection = temp.connection();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("hold parent write lock");
    transaction
        .execute("UPDATE threads SET last_access_ms=2", [])
        .expect("write within parent transaction");
    paths::prepare(&temp.directory()).expect("prepare during parent transaction");
    child(
        concat!(
            module_path!(),
            "::write_exclusion_survives_prepare_during_immediate_transaction"
        ),
        "write-lock",
        &temp,
    );
    transaction.commit().expect("commit parent writer");
    drop(connection);
    put(&temp.store(), &key("thread"), "after", 3);
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 4)).len(),
        2
    );
}

#[cfg(unix)]
#[test]
fn write_io_failure_preserves_existing_threads() {
    if let Some(base) = child_base("write-io") {
        let limit = libc::rlimit {
            rlim_cur: 128 * 1024,
            rlim_max: 128 * 1024,
        };
        unsafe {
            assert_ne!(libc::signal(libc::SIGXFSZ, libc::SIG_IGN), libc::SIG_ERR);
            assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
        }
        let result = RemoteAgentReplayStore::new(base).put_task(
            &key("failed"),
            "oversized-write",
            &object_of_size(2 * 1024 * 1024),
            2,
        );
        assert_eq!(result, Err(CacheError::Unavailable));
        return;
    }
    let temp = TempStore::new();
    for thread in ["first", "second", "third"] {
        put(&temp.store(), &key(thread), "task", 1);
    }
    let original = fs::metadata(temp.database()).expect("original database metadata");
    child(
        concat!(
            module_path!(),
            "::write_io_failure_preserves_existing_threads"
        ),
        "write-io",
        &temp,
    );
    for thread in ["first", "second", "third"] {
        assert_eq!(records(temp.store().load_thread(&key(thread), 3)).len(), 1);
    }
    use std::os::unix::fs::MetadataExt;
    let current = fs::metadata(temp.database()).expect("preserved database metadata");
    assert_eq!(
        (original.dev(), original.ino()),
        (current.dev(), current.ino())
    );
    assert_eq!(
        temp.store().load_thread(&key("failed"), 3),
        Ok(LoadThreadResponse::Miss {})
    );
}

#[cfg(unix)]
#[test]
fn hot_creation_journal_is_recovered_on_next_operation() {
    if let Some(base) = child_base("hot-journal") {
        let database = paths::directory(&base).join("cache.sqlite3");
        let mut connection = Connection::open(database).expect("open creation writer");
        connection
            .execute_batch(
                "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=1;",
            )
            .expect("configure rollback writer");
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .expect("begin creation");
        transaction
            .execute_batch(schema::DDL)
            .expect("create schema");
        transaction
            .execute_batch(
                "INSERT INTO threads VALUES('s','e','r','t',1,1,65536);
                 INSERT INTO tasks VALUES('s','e','r','t','task',65536,1,zeroblob(65536));
                 PRAGMA user_version=1;",
            )
            .expect("spill creation pages");
        std::mem::forget(transaction);
        std::mem::forget(connection);
        return;
    }
    let temp = TempStore::new();
    let database = paths::prepare(&temp.directory()).expect("prepare creation database");
    Connection::open(&database)
        .expect("initialize blank database")
        .execute_batch("VACUUM;")
        .expect("persist blank database header");
    child(
        concat!(
            module_path!(),
            "::hot_creation_journal_is_recovered_on_next_operation"
        ),
        "hot-journal",
        &temp,
    );
    let journal = fs::read(paths::sidecar(&database, "-journal")).expect("hot rollback journal");
    assert_eq!(
        &journal[..8],
        &[0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]
    );
    let probe = Connection::open_with_flags(&database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("read-only hot-journal probe");
    let result = probe.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0));
    assert!(matches!(
        result,
        Err(rusqlite::Error::SqliteFailure(error, _))
            if error.code == rusqlite::ErrorCode::ReadOnly
    ));
    drop(probe);
    put(&temp.store(), &key("thread"), "recovered", 1);
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 2)).len(),
        1
    );
}
