use super::*;

#[test]
fn deleting_a_thread_log_removes_the_database_with_its_sidecars_and_is_idempotent() {
    let temp = TempLogStore::create("delete-files");
    let writer = temp.store();
    seed(&writer, TURN_ID, 3);
    let before = file_names(&temp.root_directory());
    let remover = temp.store();

    let first = remover
        .delete_thread_log(&delete_request())
        .expect("delete the thread log");
    let second = remover
        .delete_thread_log(&delete_request())
        .expect("delete the same thread log again");
    let after = file_names(&temp.root_directory());

    assert_eq!(
        before,
        vec![
            format!("{THREAD_ID}.sqlite3"),
            format!("{THREAD_ID}.sqlite3-shm"),
            format!("{THREAD_ID}.sqlite3-wal"),
        ]
    );
    assert!(first.deleted);
    assert!(!second.deleted);
    assert!(after.is_empty(), "the thread log must be gone: {after:?}");
}

#[test]
fn deleting_a_thread_log_touches_no_other_thread() {
    let temp = TempLogStore::create("delete-neighbour");
    let store = temp.store();
    seed(&store, TURN_ID, 2);
    let neighbour = temp.root_directory().join("agt-thread-0002.sqlite3");
    fs::write(&neighbour, [0u8; 32]).expect("write a neighbouring log");

    store
        .delete_thread_log(&delete_request())
        .expect("delete the thread log");

    assert!(neighbour.exists(), "a neighbouring thread log was removed");
    assert!(!temp.database().exists());
}

#[test]
fn deleting_a_thread_log_drops_the_pooled_connection_and_starts_the_log_over() {
    let temp = TempLogStore::create("delete-pool");
    let store = temp.store();
    seed(&store, TURN_ID, 2);

    let removed = store
        .delete_thread_log(&delete_request())
        .expect("delete the thread log");
    let lease = store
        .open(&open_request(TURN_ID))
        .expect("reopen after the delete");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert!(removed.deleted);
    assert_eq!(lease.writer_epoch, 1, "a stale pooled connection survived");
    assert_eq!(lease.next_seq, AGENT_TURN_LOG_SEQ_BASE);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].event_count, 0);
}

#[test]
#[cfg(unix)]
fn deleting_refuses_a_symlinked_database_and_keeps_its_target() {
    let temp = TempLogStore::create("delete-symlink");
    let target = temp.base.join("target.sqlite3");
    fs::write(&target, [7u8; 16]).expect("write the link target");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    std::os::unix::fs::symlink(&target, temp.database()).expect("symlink the database");
    let store = temp.store();

    let refused = store
        .delete_thread_log(&delete_request())
        .expect_err("a symlinked database is refused");

    assert_eq!(code(refused), "foreign");
    assert!(target.exists(), "the link target was deleted");
    assert!(
        fs::symlink_metadata(temp.database()).is_ok(),
        "the symlink itself was deleted"
    );
}

#[test]
fn deleting_a_thread_without_a_log_reports_nothing_deleted_and_creates_nothing() {
    let temp = TempLogStore::create("delete-absent");
    let store = temp.store();

    let removed = store
        .delete_thread_log(&delete_request())
        .expect("an absent thread log is not an error");

    assert!(!removed.deleted);
    assert!(
        !temp.base.join(AGENT_TURN_LOG_DIR_NAME).exists(),
        "a delete must not create the turn log store directory"
    );
}

#[test]
fn a_foreign_owner_or_thread_identifier_is_refused_before_any_delete() {
    let temp = TempLogStore::create("delete-authority");
    let store = temp.store();
    seed(&store, TURN_ID, 1);
    let mut foreign_owner = delete_request();
    foreign_owner.owner_id = "agent-root:0000000000000000".to_string();
    let mut traversal = delete_request();
    traversal.thread_id = "../../etc/passwd".to_string();

    let refused_owner = store
        .delete_thread_log(&foreign_owner)
        .expect_err("a foreign owner is refused");
    let refused_thread = store
        .delete_thread_log(&traversal)
        .expect_err("a traversing thread id is refused");

    assert_eq!(code(refused_owner), "ownerMismatch");
    assert_eq!(code(refused_thread), "ownerMismatch");
    assert!(temp.database().exists());
}

#[test]
fn the_orphan_sweep_reports_logs_without_a_live_thread_and_removes_nothing() {
    let temp = TempLogStore::create("orphan-sweep");
    let store = temp.store();
    seed(&store, TURN_ID, 1);
    let orphan = temp.root_directory().join("agt-thread-0009.sqlite3");
    let unrelated = temp.root_directory().join("notes.txt");
    fs::write(&orphan, [0u8; 16]).expect("write an orphan log");
    fs::write(&unrelated, [0u8; 16]).expect("write an unrelated file");

    let swept = store
        .sweep_orphan_logs(
            ROOT_KEY,
            &agent_root_owner_id(ROOT_KEY),
            &[THREAD_ID.to_string()],
        )
        .expect("sweep the root directory");

    assert_eq!(swept, vec![orphan.clone()]);
    assert!(orphan.exists(), "the sweep must not delete anything");
    assert!(unrelated.exists());
    assert!(temp.database().exists());
}
