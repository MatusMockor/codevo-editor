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

pub(super) fn write_first_build_database(temp: &TempLogStore, turn_ids: &[&str]) {
    fs::create_dir_all(temp.root_directory()).expect("create root directory");
    let connection = rusqlite::Connection::open(temp.database()).expect("create the database");
    connection
        .execute_batch(FIRST_BUILD_DDL)
        .expect("create the first build schema");
    for turn_id in turn_ids {
        connection
            .execute(
                "INSERT INTO turn_meta (turn_id, writer_epoch, next_seq, first_seq, event_count, bytes, loss, sealed, digest, digest_through_seq, digest_version)
                 VALUES (?1, 1, 2, 1, 1, 12, '{\"kind\":\"none\"}', 0, NULL, 0, 1)",
                [turn_id],
            )
            .expect("seed a first build turn");
        connection
            .execute(
                "INSERT INTO events (turn_id, seq, kind, bytes, payload) VALUES (?1, 1, 8, 12, ?2)",
                rusqlite::params![
                    turn_id,
                    serde_json::to_vec(&text_event("first build")).expect("encode an event")
                ],
            )
            .expect("seed a first build event");
    }
    connection
        .pragma_update(None, "user_version", AGENT_TURN_LOG_USER_VERSION)
        .expect("stamp the supported user version");
}

pub(super) fn activity_column_present(temp: &TempLogStore) -> bool {
    let connection = rusqlite::Connection::open(temp.database()).expect("open the database");
    let present: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('turn_meta') WHERE name = 'updated_seq'",
            [],
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
