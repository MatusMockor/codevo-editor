use super::*;

#[test]
fn schema_is_versioned_and_records_are_ordered_and_replaced() {
    let temp = TempStore::new();
    let store = temp.store();
    let key = key("thread");
    assert_eq!(store.load_thread(&key, 0), Ok(LoadThreadResponse::Miss {}));
    put(&store, &key, "z", 1);
    put(&store, &key, "a", 2);
    assert_eq!(
        store.put_task(&key, "z", "{\"unicode\":\"🦀\"}".as_bytes(), 3),
        Ok(PutTaskResponse::Stored {})
    );
    let loaded = records(store.load_thread(&key, 4));
    assert_eq!(
        loaded
            .iter()
            .map(|record| record.task_id.as_str())
            .collect::<Vec<_>>(),
        ["a", "z"]
    );
    assert_eq!(loaded[1].record, "{\"unicode\":\"🦀\"}");
    let connection = temp.connection();
    let (version, journal, synchronous): (i64, String, i64) = (
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version"),
        connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode"),
        connection
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .expect("synchronous"),
    );
    assert_eq!((version, journal.as_str(), synchronous), (1, "wal", 1));
    let (updated, access, bytes): (i64, i64, i64) = connection
        .query_row(
            "SELECT updated_at_ms,last_access_ms,bytes FROM threads",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("thread metadata");
    assert_eq!(
        (updated, access, bytes),
        (3, 4, 2 + loaded[1].record.len() as i64)
    );
}

#[test]
fn expiry_uses_updated_time_and_expires_strictly_after_seven_days() {
    let temp = TempStore::new();
    let store = temp.store();
    let key = key("thread");
    put(&store, &key, "task", 100);
    assert_eq!(records(store.load_thread(&key, 100 + EXPIRY_MS)).len(), 1);
    assert_eq!(
        store.load_thread(&key, 101 + EXPIRY_MS),
        Ok(LoadThreadResponse::Miss {})
    );
    let connection = temp.connection();
    assert_eq!(row_count(&connection, "threads"), 0);
    assert_eq!(row_count(&connection, "tasks"), 0);
}

#[test]
fn thread_server_and_clear_delete_tasks_by_cascade() {
    let temp = TempStore::new();
    let store = temp.store();
    let first = key("first");
    let second = key("second");
    let mut other = key("third");
    other.server_id = "other".into();
    put(&store, &first, "task", 1);
    put(&store, &second, "task", 1);
    put(&store, &other, "task", 1);
    store.remove_thread(&first).expect("remove thread");
    assert_eq!(row_count(&temp.connection(), "tasks"), 2);
    store.remove_server("server").expect("remove server");
    assert_eq!(row_count(&temp.connection(), "tasks"), 1);
    assert_eq!(records(store.load_thread(&other, 2)).len(), 1);
    store.clear().expect("clear cache");
    assert_eq!(row_count(&temp.connection(), "threads"), 0);
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
    store.clear().expect("empty clear");
    store.remove_thread(&first).expect("absent thread removal");
}

#[test]
fn every_remote_key_component_is_part_of_identity() {
    let temp = TempStore::new();
    let store = temp.store();
    let original = key("thread");
    put(&store, &original, "task", 1);
    for index in 0..4 {
        let mut foreign = original.clone();
        let fields = [
            &mut foreign.server_id,
            &mut foreign.endpoint,
            &mut foreign.runner_id,
            &mut foreign.thread_key,
        ];
        fields
            .into_iter()
            .nth(index)
            .expect("identity component")
            .push('x');
        assert_eq!(
            store.load_thread(&foreign, 2),
            Ok(LoadThreadResponse::Miss {})
        );
    }
}

#[test]
fn malformed_stored_rows_fail_as_a_whole_and_recreate_the_database() {
    let temp = TempStore::new();
    let store = temp.store();
    let key = key("thread");
    put(&store, &key, "a", 1);
    put(&store, &key, "z", 1);
    temp.connection()
        .execute("UPDATE tasks SET record=x'ffff' WHERE task_id='z'", [])
        .expect("corrupt record");
    assert_eq!(store.load_thread(&key, 2), Ok(LoadThreadResponse::Miss {}));
    assert_eq!(store.load_thread(&key, 2), Ok(LoadThreadResponse::Miss {}));
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
}

#[test]
fn put_sweeps_expired_threads_without_loading_them() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("expired"), "old", 1);
    put(&store, &key("boundary"), "retained", 2);
    put(&store, &key("new"), "new", EXPIRY_MS + 2);
    let connection = temp.connection();
    let expired: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM threads WHERE thread_key='expired'",
            [],
            |row| row.get(0),
        )
        .expect("expired thread count");
    assert_eq!(expired, 0);
    assert_eq!(row_count(&connection, "tasks"), 2);
    drop(connection);
    assert_eq!(
        records(store.load_thread(&key("boundary"), EXPIRY_MS + 2)).len(),
        1
    );
}

#[test]
fn putting_to_an_expired_thread_starts_with_only_the_new_task() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "old", 1);
    put(&store, &key("thread"), "new", EXPIRY_MS + 2);
    let loaded = records(store.load_thread(&key("thread"), EXPIRY_MS + 2));
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].task_id, "new");
}

#[test]
fn future_thread_timestamps_expire_on_load_and_put_sweep() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("loaded"), "future", EXPIRY_MS + 10);
    assert_eq!(
        store.load_thread(&key("loaded"), 1),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
    put(&store, &key("swept"), "future", EXPIRY_MS + 10);
    put(&store, &key("new"), "present", 1);
    let connection = temp.connection();
    let swept: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM threads WHERE thread_key='swept'",
            [],
            |row| row.get(0),
        )
        .expect("future thread count");
    assert_eq!(swept, 0);
    assert_eq!(row_count(&connection, "tasks"), 1);
    drop(connection);
    assert_eq!(records(store.load_thread(&key("new"), 1)).len(), 1);
}

#[test]
fn load_returns_size_checked_utf8_without_reparsing_json() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    temp.connection()
        .execute("UPDATE tasks SET record=x'6f6b' WHERE task_id='task'", [])
        .expect("replace stored text with non-json utf8 of equal size");
    let loaded = records(temp.store().load_thread(&key("thread"), 2));
    assert_eq!(loaded[0].record, "ok");
}
