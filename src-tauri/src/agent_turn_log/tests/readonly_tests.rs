use super::super::connection::{recover_write_ahead_log, OpenedTurnLog};
use super::super::integrity::verifications_under;
use super::super::paths::{locate, AgentTurnLogLocation};
use super::migration_tests::{
    activity_column_present, prompt_column_present, write_first_build_database,
};
use super::*;

fn log_location(temp: &TempLogStore) -> AgentTurnLogLocation {
    locate(
        &temp.base,
        ROOT_KEY,
        &agent_root_owner_id(ROOT_KEY),
        THREAD_ID,
    )
    .expect("locate the turn log")
}

#[test]
fn reading_a_thread_without_a_log_creates_nothing_on_disk() {
    let temp = TempLogStore::create("read-only-missing");
    let store = temp.store();

    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert!(summaries.is_empty());
    assert!(page.entries.is_empty());
    assert!(!page.has_earlier);
    assert!(!page.has_later);
    assert_eq!(page.loss, loss(AgentTurnLogLossKind::None));
    assert!(
        !temp.base.join(AGENT_TURN_LOG_DIR_NAME).exists(),
        "a read must not create the turn log store directory"
    );
    assert!(file_names(&temp.base).is_empty(), "a read created a file");
}

#[test]
fn reading_an_existing_log_creates_no_database_and_changes_no_byte() {
    let temp = TempLogStore::create("read-only-existing");
    let writer = temp.store();
    seed(&writer, TURN_ID, 6);
    drop(writer);
    let before = file_names(&temp.root_directory());
    let bytes_before = fs::read(temp.database()).expect("read the database");
    let reader = temp.store();

    let page = reader
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");
    let summaries = reader.summarize(&summarize_request()).expect("summaries");
    let after = file_names(&temp.root_directory());
    let bytes_after = fs::read(temp.database()).expect("read the database");

    let appeared: Vec<&String> = after.iter().filter(|name| !before.contains(name)).collect();
    let sidecars = [
        format!("{THREAD_ID}.sqlite3-wal"),
        format!("{THREAD_ID}.sqlite3-shm"),
    ];

    assert_eq!(page.entries.len(), 6);
    assert_eq!(summaries.len(), 1);
    assert_eq!(before, vec![format!("{THREAD_ID}.sqlite3")]);
    assert!(
        appeared.iter().all(|name| sidecars.contains(name)),
        "a read created more than sqlite's own write ahead index: {appeared:?}"
    );
    assert!(
        before.iter().all(|name| after.contains(name)),
        "a read removed a file: {after:?}"
    );
    assert_eq!(bytes_before, bytes_after, "a read rewrote the database");
}

#[test]
fn a_read_only_store_never_upgrades_an_unmigrated_database() {
    let temp = TempLogStore::create("read-only-unmigrated");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    fs::write(temp.database(), []).expect("create an empty database file");
    let store = temp.store();

    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert!(summaries.is_empty());
    assert!(page.entries.is_empty());
    assert_eq!(
        fs::metadata(temp.database()).expect("stat database").len(),
        0,
        "a read migrated an empty database"
    );
}

#[test]
fn a_read_only_store_reports_no_prompt_for_a_database_without_the_prompt_column() {
    let temp = TempLogStore::create("read-only-promptless");
    write_first_build_database(&temp, &[TURN_ID]);
    let store = temp.store();

    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].prompt, None);
    assert!(!summaries[0].prompt_omitted);
    assert_eq!(page.entries.len(), 1);
    assert!(
        !prompt_column_present(&temp),
        "a read must not migrate the schema"
    );
}

#[test]
fn each_database_is_verified_once_per_process_and_again_when_its_identity_changes() {
    let temp = TempLogStore::create("verify-once");
    let store = temp.store();
    seed(&store, TURN_ID, 2);
    drop(store);
    let reopened = temp.store();

    reopened
        .open(&open_request(TURN_ID))
        .expect("reopen the same database");
    let after_reopen = verifications_under(&temp.base);
    drop(reopened);
    let replacement = temp.base.join("replacement.sqlite3");
    fs::copy(temp.database(), &replacement).expect("copy the database");
    fs::rename(&replacement, temp.database()).expect("replace the database");
    let replaced = temp.store();
    replaced
        .open(&open_request(TURN_ID))
        .expect("open the replaced database");

    assert_eq!(
        after_reopen, 1,
        "the same database was verified more than once in this process"
    );
    assert_eq!(
        verifications_under(&temp.base),
        2,
        "a replaced database must be verified again"
    );
}

#[test]
fn the_read_recovery_never_recreates_a_database_that_vanished() {
    let temp = TempLogStore::create("recovery-vanished");
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    fs::write(sidecar(&temp.database(), "-wal"), [0u8; 32]).expect("write a stale sidecar");

    let recovered =
        recover_write_ahead_log(&log_location(&temp)).expect("a vanished database reads empty");

    assert!(
        matches!(recovered, OpenedTurnLog::Absent),
        "a vanished database must never be recreated by a read"
    );
    assert!(!temp.database().exists(), "a read created the database");
}

#[test]
fn the_read_recovery_is_refused_without_a_stale_write_ahead_log() {
    let temp = TempLogStore::create("recovery-without-log");
    write_first_build_database(&temp, &[TURN_ID]);
    let before = file_names(&temp.root_directory());

    let refused = recover_write_ahead_log(&log_location(&temp))
        .expect_err("a database with nothing to recover stays unreadable");

    assert_eq!(code(refused), "unreadable");
    assert_eq!(
        file_names(&temp.root_directory()),
        before,
        "a refused read changed the directory"
    );
    assert!(
        !activity_column_present(&temp),
        "a refused read migrated the schema"
    );
}

#[test]
fn the_read_recovery_serves_an_unmigrated_database_without_migrating_it() {
    let temp = TempLogStore::create("recovery-unmigrated");
    write_first_build_database(&temp, &[TURN_ID]);
    fs::write(sidecar(&temp.database(), "-wal"), [0u8; 32]).expect("write a stale sidecar");

    let recovered = recover_write_ahead_log(&log_location(&temp))
        .expect("a stale write ahead log is recovered");

    assert!(
        matches!(recovered, OpenedTurnLog::Ready(_)),
        "an unmigrated database still serves the read"
    );
    assert!(
        !activity_column_present(&temp),
        "the read fallback migrated the schema"
    );
}
