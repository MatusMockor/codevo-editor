use super::super::paths::AGENT_TURN_LOG_USER_VERSION;
use super::*;

const FIRST_BUILD_DDL: &str = "
CREATE TABLE IF NOT EXISTS turn_meta (
    turn_id TEXT PRIMARY KEY,
    writer_epoch INTEGER NOT NULL,
    next_seq INTEGER NOT NULL,
    first_seq INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    loss TEXT NOT NULL,
    sealed INTEGER NOT NULL,
    digest BLOB,
    digest_through_seq INTEGER NOT NULL,
    digest_version INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload BLOB NOT NULL,
    PRIMARY KEY(turn_id, seq)
) WITHOUT ROWID;
";

const PROMPT_FREE_DDL: &str = "
CREATE TABLE IF NOT EXISTS turn_meta (
    turn_id TEXT PRIMARY KEY,
    writer_epoch INTEGER NOT NULL,
    next_seq INTEGER NOT NULL,
    first_seq INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    loss TEXT NOT NULL,
    sealed INTEGER NOT NULL,
    digest BLOB,
    digest_through_seq INTEGER NOT NULL,
    digest_version INTEGER NOT NULL,
    updated_seq INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload BLOB NOT NULL,
    PRIMARY KEY(turn_id, seq)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS turn_meta_updated_seq ON turn_meta (updated_seq DESC);
";

const LIFECYCLE_FREE_DDL: &str = "
CREATE TABLE IF NOT EXISTS turn_meta (
    turn_id TEXT PRIMARY KEY,
    writer_epoch INTEGER NOT NULL,
    next_seq INTEGER NOT NULL,
    first_seq INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    loss TEXT NOT NULL,
    sealed INTEGER NOT NULL,
    digest BLOB,
    digest_through_seq INTEGER NOT NULL,
    digest_version INTEGER NOT NULL,
    updated_seq INTEGER NOT NULL DEFAULT 0,
    prompt TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload BLOB NOT NULL,
    PRIMARY KEY(turn_id, seq)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS turn_meta_updated_seq ON turn_meta (updated_seq DESC);
";

pub(super) fn write_first_build_database(temp: &TempLogStore, turn_ids: &[&str]) {
    write_legacy_database(temp, turn_ids, FIRST_BUILD_DDL, "");
}

fn write_prompt_free_database(temp: &TempLogStore, turn_ids: &[&str]) {
    write_legacy_database(temp, turn_ids, PROMPT_FREE_DDL, ", updated_seq");
}

pub(super) fn write_lifecycle_free_database(temp: &TempLogStore, turn_ids: &[&str]) {
    write_legacy_database(temp, turn_ids, LIFECYCLE_FREE_DDL, ", updated_seq");
}

fn write_legacy_database(temp: &TempLogStore, turn_ids: &[&str], ddl: &str, activity_column: &str) {
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    let connection = rusqlite::Connection::open(temp.database()).expect("create the database");
    connection
        .execute_batch(ddl)
        .expect("create the legacy schema");
    let activity_value = match activity_column.is_empty() {
        true => "",
        false => ", 1",
    };
    for turn_id in turn_ids {
        connection
            .execute(
                &format!("INSERT INTO turn_meta (turn_id, writer_epoch, next_seq, first_seq, event_count, bytes, loss, sealed, digest, digest_through_seq, digest_version{activity_column})
                 VALUES (?1, 1, 2, 1, 1, 12, '{{\"kind\":\"none\"}}', 0, NULL, 0, 1{activity_value})"),
                [turn_id],
            )
            .expect("seed a legacy turn");
        connection
            .execute(
                "INSERT INTO events (turn_id, seq, kind, bytes, payload) VALUES (?1, 1, 8, 12, ?2)",
                rusqlite::params![
                    turn_id,
                    serde_json::to_vec(&text_event("first build")).expect("encode an event")
                ],
            )
            .expect("seed a legacy event");
    }
    connection
        .pragma_update(None, "user_version", AGENT_TURN_LOG_USER_VERSION)
        .expect("stamp the supported user version");
}

pub(super) fn activity_column_present(temp: &TempLogStore) -> bool {
    column_present(temp, "updated_seq")
}

pub(super) fn prompt_column_present(temp: &TempLogStore) -> bool {
    column_present(temp, "prompt")
}

pub(super) fn lifecycle_column_present(temp: &TempLogStore) -> bool {
    column_present(temp, "lifecycle")
}

fn lifecycle_column_count(temp: &TempLogStore) -> i64 {
    let connection = rusqlite::Connection::open(temp.database()).expect("open the database");
    connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('turn_meta') WHERE name = 'lifecycle'",
            [],
            |row| row.get(0),
        )
        .expect("read the table info")
}

fn column_present(temp: &TempLogStore, column: &str) -> bool {
    let connection = rusqlite::Connection::open(temp.database()).expect("open the database");
    let present: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('turn_meta') WHERE name = ?1",
            [column],
            |row| row.get(0),
        )
        .expect("read the table info");
    present != 0
}

#[test]
fn a_first_build_database_is_readable_before_any_migration() {
    let temp = TempLogStore::create("first-build-read");
    write_first_build_database(&temp, &["agt-turn-0002", "agt-turn-0001"]);
    let store = temp.store();

    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let page = store
        .read_page(&page_request("agt-turn-0001", tail(), 200, 512 * 1024))
        .expect("tail page");

    assert_eq!(summaries.len(), 2);
    assert_eq!(page.entries.len(), 1);
    assert!(
        !activity_column_present(&temp),
        "a read must not migrate the schema"
    );
}

#[test]
fn a_first_build_database_gains_the_activity_column_on_the_next_write_and_keeps_its_rows() {
    let temp = TempLogStore::create("first-build-write");
    write_first_build_database(&temp, &["agt-turn-0001", "agt-turn-0002"]);
    let store = temp.store();

    let lease = store
        .open(&open_request("agt-turn-0001"))
        .expect("open the oldest turn");
    store
        .append(&append_request(
            "agt-turn-0001",
            lease.writer_epoch,
            2,
            vec![entry(2, "resumed")],
        ))
        .expect("append to a first build turn");
    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let turn_ids: Vec<&str> = summaries
        .iter()
        .map(|summary| summary.turn_id.as_str())
        .collect();

    assert!(activity_column_present(&temp));
    assert_eq!(
        lease.next_seq, 2,
        "the existing rows survived the migration"
    );
    assert_eq!(turn_ids, vec!["agt-turn-0002", "agt-turn-0001"]);
    assert_eq!(summaries[1].event_count, 2);
}

#[test]
fn a_prompt_free_database_gains_the_prompt_column_on_the_next_write_and_stores_a_prompt() {
    let temp = TempLogStore::create("prompt-migration");
    write_prompt_free_database(&temp, &[TURN_ID]);
    let store = temp.store();

    assert!(!prompt_column_present(&temp));

    let lease = store
        .open(&prompted_open_request(TURN_ID, "explain the failing test"))
        .expect("the write open migrates and stores the prompt");
    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");

    assert!(prompt_column_present(&temp));
    assert_eq!(
        lease.next_seq, 2,
        "the existing rows survived the migration"
    );
    assert_eq!(summaries.len(), 1);
    assert_eq!(
        summaries[0].prompt.as_deref(),
        Some("explain the failing test")
    );
    assert!(!summaries[0].prompt_omitted);
    assert_eq!(summaries[0].event_count, 1);
}

#[test]
fn migrating_a_first_build_database_twice_is_a_no_op() {
    let temp = TempLogStore::create("first-build-twice");
    write_first_build_database(&temp, &["agt-turn-0001"]);
    let store = temp.store();
    store
        .open(&open_request("agt-turn-0001"))
        .expect("first open migrates");
    drop(store);
    let reopened = temp.store();

    let lease = reopened
        .open(&open_request("agt-turn-0001"))
        .expect("a second process opens the migrated database");
    let summaries = reopened.summarize(&summarize_request()).expect("summaries");

    assert_eq!(lease.writer_epoch, 3);
    assert_eq!(summaries.len(), 1);
    assert!(activity_column_present(&temp));
}

#[test]
fn a_lifecycle_free_database_gains_the_column_once_on_the_next_write_and_keeps_its_rows() {
    let temp = TempLogStore::create("lifecycle-migration");
    write_lifecycle_free_database(&temp, &[TURN_ID]);
    let store = temp.store();

    assert!(!lifecycle_column_present(&temp));

    let lease = store
        .open(&open_request(TURN_ID))
        .expect("the write open migrates the schema");
    store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            lease.next_seq,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect("store a lifecycle on the migrated turn");
    drop(store);
    let reopened = temp.store();
    reopened
        .open(&open_request(TURN_ID))
        .expect("a second process opens the migrated database");
    let summaries = reopened
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(
        lifecycle_column_count(&temp),
        1,
        "the migration must add the column exactly once"
    );
    assert_eq!(
        lease.next_seq, 2,
        "the existing rows survived the migration"
    );
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].lifecycle, Some(retained_lifecycle()));
    assert!(!summaries[0].lifecycle_omitted);
    assert_eq!(summaries[0].event_count, 1);
}

#[test]
fn a_lifecycle_free_database_is_summarized_read_only_without_being_altered() {
    let temp = TempLogStore::create("lifecycle-read-only");
    write_lifecycle_free_database(&temp, &[TURN_ID]);
    let store = temp.store();

    let summaries = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].lifecycle, None);
    assert!(!summaries[0].lifecycle_omitted);
    assert_eq!(page.entries.len(), 1);
    assert!(
        !lifecycle_column_present(&temp),
        "a read must not migrate the schema"
    );
}
