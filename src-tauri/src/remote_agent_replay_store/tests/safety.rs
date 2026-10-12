use super::*;
use std::{sync::mpsc, time::Duration};

fn quarantined(temp: &TempStore) -> Vec<PathBuf> {
    fs::read_dir(temp.directory())
        .expect("read cache directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .expect("file name")
                .to_string_lossy()
                .contains(".corrupt-")
        })
        .collect()
}

#[test]
fn unsupported_version_is_unlinked_and_recreated_empty() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    temp.connection()
        .pragma_update(None, "user_version", 99)
        .expect("change version");
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    assert!(quarantined(&temp).is_empty());
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
    let version: i64 = temp
        .connection()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("new version");
    assert_eq!(version, 1);
}

#[test]
fn corrupt_database_and_all_sidecars_are_unlinked() {
    let temp = TempStore::new();
    drop(temp.connection());
    fs::write(temp.database(), b"not a sqlite database").expect("corrupt main database");
    for suffix in ["-wal", "-shm", "-journal"] {
        fs::write(paths::sidecar(&temp.database(), suffix), [0; 512])
            .expect("write corrupt sidecar");
    }
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    assert!(quarantined(&temp).is_empty());
    put(&temp.store(), &key("thread"), "task", 3);
}

#[test]
fn valid_sqlite_with_damaged_pages_fails_quick_check_and_is_recreated() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    connection::forget_verified(&fs::canonicalize(temp.database()).expect("canonical database"));
    let mut bytes = fs::read(temp.database()).expect("read database");
    bytes[4096..].fill(0x5a);
    fs::write(temp.database(), bytes).expect("damage pages");
    let canonical = fs::canonicalize(temp.database()).expect("canonical damaged database");
    let damaged = Connection::open(&canonical).expect("open damaged database");
    assert_eq!(
        connection::verify_integrity(&damaged, &canonical),
        Err(CacheError::Corrupt)
    );
    drop(damaged);
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    assert!(quarantined(&temp).is_empty());
}

#[test]
fn unversioned_foreign_tables_are_recreated() {
    let temp = TempStore::new();
    fs::create_dir_all(temp.directory()).expect("create directory");
    let connection = Connection::open(temp.database()).expect("create foreign database");
    connection
        .execute("CREATE TABLE foreign_data(value TEXT)", [])
        .expect("create foreign table");
    drop(connection);
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    assert!(quarantined(&temp).is_empty());
}

#[cfg(unix)]
#[test]
fn private_permissions_cover_directories_database_and_live_sidecars() {
    use std::os::unix::fs::PermissionsExt;
    let temp = TempStore::new();
    let connection = temp.connection();
    connection
        .execute("INSERT INTO threads VALUES('s','e','r','t',0,0,0)", [])
        .expect("write database");
    for path in [
        temp.directory(),
        temp.directory().parent().expect("parent").to_path_buf(),
    ] {
        assert_eq!(
            fs::metadata(path)
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    for path in [
        temp.database(),
        temp.directory().join("cache.lock"),
        paths::sidecar(&temp.database(), "-wal"),
        paths::sidecar(&temp.database(), "-shm"),
    ] {
        assert_eq!(
            fs::metadata(path)
                .expect("file metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[cfg(unix)]
#[test]
fn symlink_directories_database_and_sidecars_are_refused_without_touching_targets() {
    use std::os::unix::fs::symlink;
    for location in [
        "remote-agent-replay",
        "remote-agent-replay/v1",
        "remote-agent-replay/v1/cache.sqlite3",
        "remote-agent-replay/v1/cache.sqlite3-wal",
        "remote-agent-replay/v1/cache.sqlite3-shm",
        "remote-agent-replay/v1/cache.sqlite3-journal",
        "remote-agent-replay/v1/cache.lock",
    ] {
        let temp = TempStore::new();
        let target = temp.base.join("target");
        fs::write(&target, b"untouched").expect("write target");
        let link = temp.base.join(location);
        fs::create_dir_all(link.parent().expect("link parent")).expect("create link parent");
        symlink(&target, &link).expect("create symlink");
        assert_eq!(
            temp.store().put_task(&key("thread"), "task", b"{}", 1),
            Err(CacheError::Unavailable)
        );
        assert_eq!(fs::read(&target).expect("read target"), b"untouched");
        assert!(fs::symlink_metadata(&link)
            .expect("link metadata")
            .file_type()
            .is_symlink());
    }
}

#[test]
fn a_second_connection_waits_for_immediate_transaction_and_succeeds() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "first", 1);
    let mut connection = temp.connection();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("lock writer");
    let base = temp.base.clone();
    let (started_sender, started_receiver) = mpsc::channel();
    let (done_sender, done_receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        started_sender.send(()).expect("signal writer start");
        let result = RemoteAgentReplayStore::new(base).put_task(&key("thread"), "second", b"{}", 2);
        done_sender.send(result).expect("send writer result");
    });
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("writer started");
    assert!(matches!(
        done_receiver.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    transaction.commit().expect("release writer lock");
    assert_eq!(
        done_receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("writer completed"),
        Ok(PutTaskResponse::Stored {})
    );
    worker.join().expect("join writer");
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 3)).len(),
        2
    );
    let verdict: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .expect("integrity check");
    assert_eq!(verdict, "ok");
}

#[test]
fn sqlite_errors_distinguish_corruption_from_operational_failure() {
    for code in [
        rusqlite::ffi::SQLITE_BUSY,
        rusqlite::ffi::SQLITE_LOCKED,
        rusqlite::ffi::SQLITE_IOERR,
        rusqlite::ffi::SQLITE_FULL,
        rusqlite::ffi::SQLITE_READONLY,
        rusqlite::ffi::SQLITE_PERM,
        rusqlite::ffi::SQLITE_CANTOPEN,
    ] {
        let result: rusqlite::Result<()> = Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(code),
            None,
        ));
        assert_eq!(sqlite(result), Err(CacheError::Unavailable));
    }
    for code in [
        rusqlite::ffi::SQLITE_CORRUPT,
        rusqlite::ffi::SQLITE_NOTADB,
        rusqlite::ffi::SQLITE_ERROR,
        rusqlite::ffi::SQLITE_MISMATCH,
        rusqlite::ffi::SQLITE_CONSTRAINT,
        rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY,
    ] {
        let result: rusqlite::Result<()> = Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(code),
            None,
        ));
        assert_eq!(sqlite(result), Err(CacheError::Corrupt));
    }
    for error in [
        rusqlite::Error::InvalidColumnIndex(0),
        rusqlite::Error::InvalidColumnName("missing".into()),
        rusqlite::Error::InvalidColumnType(0, "bytes".into(), rusqlite::types::Type::Real),
        rusqlite::Error::QueryReturnedNoRows,
    ] {
        assert_eq!(sqlite::<()>(Err(error)), Err(CacheError::Corrupt));
    }
}

#[test]
fn concurrent_recovery_never_unlinks_a_replacement_or_loses_successful_writes() {
    let temp = TempStore::new();
    let connection = temp.connection();
    connection
        .pragma_update(None, "user_version", 99)
        .expect("unsupported version fixture");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let mut workers = Vec::new();
    let (done_sender, done_receiver) = mpsc::channel();
    for index in 0..8 {
        let base = temp.base.clone();
        let barrier = barrier.clone();
        let done_sender = done_sender.clone();
        workers.push(std::thread::spawn(move || {
            let store = RemoteAgentReplayStore::new(base);
            let key = key(&format!("worker-{index}"));
            barrier.wait();
            assert_eq!(store.load_thread(&key, 1), Ok(LoadThreadResponse::Miss {}));
            put(&store, &key, "task", 2);
            done_sender.send(()).expect("signal recovery completion");
        }));
    }
    assert!(matches!(
        done_receiver.recv_timeout(Duration::from_millis(200)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    drop(connection);
    for worker in workers {
        worker.join().expect("join concurrent recovery writer");
    }
    assert!(quarantined(&temp).is_empty());
    for index in 0..8 {
        assert_eq!(
            records(
                temp.store()
                    .load_thread(&key(&format!("worker-{index}")), 3)
            )
            .len(),
            1
        );
    }
}

#[test]
fn repeated_corruption_leaves_only_live_database_and_lock() {
    let temp = TempStore::new();
    for _ in 0..4 {
        put(&temp.store(), &key("thread"), "task", 1);
        fs::write(temp.database(), b"invalid sqlite database").expect("corrupt cache");
        for suffix in ["-wal", "-shm", "-journal"] {
            fs::write(paths::sidecar(&temp.database(), suffix), [0; 512]).expect("corrupt sidecar");
        }
        assert_eq!(
            temp.store().load_thread(&key("thread"), 2),
            Ok(LoadThreadResponse::Miss {})
        );
        let mut names = fs::read_dir(temp.directory())
            .expect("cache directory")
            .map(|entry| entry.expect("cache file").file_name())
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(names, ["cache.lock", "cache.sqlite3"]);
    }
    let open = temp.connection();
    open.execute("INSERT INTO threads VALUES('s','e','r','t',0,0,0)", [])
        .expect("open WAL sidecars");
    let mut names = fs::read_dir(temp.directory())
        .expect("open cache directory")
        .map(|entry| entry.expect("open cache file").file_name())
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(
        names,
        [
            "cache.lock",
            "cache.sqlite3",
            "cache.sqlite3-shm",
            "cache.sqlite3-wal"
        ]
    );
}

#[test]
fn prepare_removes_legacy_corruption_copies() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    for suffix in [
        ".corrupt-123-0",
        ".corrupt-123-0-wal",
        ".corrupt-123-0-shm",
        ".corrupt-123-0-journal",
    ] {
        fs::write(paths::sidecar(&temp.database(), suffix), b"legacy copy")
            .expect("write legacy corrupt file");
    }
    paths::prepare(&temp.directory()).expect("prepare legacy directory");
    assert!(quarantined(&temp).is_empty());
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 2)).len(),
        1
    );
}

#[test]
fn store_creates_missing_application_data_directory() {
    let temp = TempStore::new();
    let base = temp.base.join("missing").join("app-data");
    let store = RemoteAgentReplayStore::new(base);
    put(&store, &key("thread"), "task", 1);
    assert_eq!(records(store.load_thread(&key("thread"), 2)).len(), 1);
}

#[test]
fn opened_connections_enable_foreign_keys_and_secure_delete() {
    let temp = TempStore::new();
    for _ in 0..2 {
        let connection = temp.connection();
        connection
            .execute_batch("PRAGMA foreign_keys=OFF; PRAGMA secure_delete=OFF;")
            .expect("disable connection protections");
        let disabled: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("disabled foreign keys");
        assert_eq!(disabled, 0);
        connection::configure(&connection).expect("configure connection protections");
        let foreign_keys: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign key pragma");
        let secure_delete: i64 = connection
            .query_row("PRAGMA secure_delete", [], |row| row.get(0))
            .expect("secure delete pragma");
        assert_eq!((foreign_keys, secure_delete), (1, 1));
    }
}
