use super::*;

#[test]
fn identifier_validation_rejects_empty_nul_and_overlong_before_filesystem() {
    let temp = TempStore::new();
    let store = temp.store();
    for invalid in [
        String::new(),
        "nul\0id".into(),
        "x".repeat(MAX_IDENTIFIER_BYTES + 1),
        "🦀".repeat(129),
    ] {
        assert_eq!(
            validate_identifier(&invalid),
            Err(CacheError::InvalidIdentifier)
        );
        for index in 0..4 {
            let mut key = key("thread");
            let fields = [
                &mut key.server_id,
                &mut key.endpoint,
                &mut key.runner_id,
                &mut key.thread_key,
            ];
            *fields.into_iter().nth(index).expect("identity component") = invalid.clone();
            assert_eq!(
                store.load_thread(&key, 1),
                Err(CacheError::InvalidIdentifier)
            );
            assert_eq!(
                store.remove_thread(&key),
                Err(CacheError::InvalidIdentifier)
            );
            assert_eq!(
                store.put_task(&key, "task", b"{}", 1),
                rejected(RejectionReason::InvalidIdentifier)
            );
        }
        assert_eq!(
            store.put_task(&key("thread"), &invalid, b"{}", 1),
            rejected(RejectionReason::InvalidIdentifier)
        );
        assert_eq!(
            store.remove_server(&invalid),
            Err(CacheError::InvalidIdentifier)
        );
    }
    assert!(!temp.directory().exists());
    assert_eq!(
        validate_identifier(&"x".repeat(MAX_IDENTIFIER_BYTES)),
        Ok(())
    );
}

#[test]
fn records_require_bounded_utf8_json_objects() {
    let temp = TempStore::new();
    let store = temp.store();
    for invalid in [
        b"".as_slice(),
        b"[]",
        b"null",
        b"42",
        b"\"text\"",
        b"{",
        b"{\"x\":\"\xff\"}",
        b"{} {}",
    ] {
        assert_eq!(
            store.put_task(&key("thread"), "task", invalid, 1),
            rejected(RejectionReason::InvalidRecord)
        );
    }
    assert_eq!(
        store.put_task(
            &key("thread"),
            "task",
            &object_of_size(MAX_RECORD_BYTES + 1),
            1
        ),
        rejected(RejectionReason::RecordTooLarge)
    );
    assert!(!temp.directory().exists());
    assert_eq!(
        store.put_task(&key("thread"), "task", &object_of_size(MAX_RECORD_BYTES), 1),
        Ok(PutTaskResponse::Stored {})
    );
}

#[test]
fn thread_bytes_and_task_counts_are_atomic_and_replacement_is_allowed() {
    let temp = TempStore::new();
    let store = temp.store();
    let full = key("full");
    let record = object_of_size(MAX_RECORD_BYTES);
    assert_eq!(
        store.put_task(&full, "a", &record, 1),
        Ok(PutTaskResponse::Stored {})
    );
    assert_eq!(
        store.put_task(&full, "b", &record, 2),
        Ok(PutTaskResponse::Stored {})
    );
    assert_eq!(
        store.put_task(&full, "c", b"{}", 3),
        rejected(RejectionReason::ThreadTooLarge)
    );
    let connection = temp.connection();
    let (bytes, updated, access): (i64, i64, i64) = connection
        .query_row(
            "SELECT bytes,updated_at_ms,last_access_ms FROM threads WHERE thread_key='full'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("metadata");
    assert_eq!((bytes, updated, access), (MAX_THREAD_BYTES, 2, 2));
    drop(connection);
    assert_eq!(
        store.put_task(&full, "a", b"{}", 4),
        Ok(PutTaskResponse::Stored {})
    );
    assert_eq!(
        store.put_task(&full, "c", b"{}", 5),
        Ok(PutTaskResponse::Stored {})
    );
    let many = key("many");
    for index in 0..MAX_TASKS_PER_THREAD {
        put(&store, &many, &format!("task-{index}"), 10);
    }
    assert_eq!(
        store.put_task(&many, "extra", b"{}", 20),
        rejected(RejectionReason::TooManyTasks)
    );
    put(&store, &many, "task-0", 30);
    assert_eq!(
        records(store.load_thread(&many, 30)).len(),
        MAX_TASKS_PER_THREAD
    );
}

#[test]
fn thread_lru_evicts_by_access_then_stable_identity_and_preserves_written_thread() {
    let temp = TempStore::new();
    let store = temp.store();
    for index in 0..MAX_THREADS {
        put(&store, &key(&format!("thread-{index:02}")), "task", 10);
    }
    records(store.load_thread(&key("thread-00"), 20));
    put(&store, &key("written"), "task", 0);
    assert_eq!(
        store.load_thread(&key("thread-01"), 20),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(records(store.load_thread(&key("thread-00"), 20)).len(), 1);
    assert_eq!(records(store.load_thread(&key("written"), 20)).len(), 1);
    assert_eq!(row_count(&temp.connection(), "threads"), MAX_THREADS);
}

#[test]
fn byte_quota_evicts_multiple_oldest_threads_and_never_the_written_thread() {
    let temp = TempStore::new();
    let connection = temp.connection();
    for index in 0..33 {
        connection.execute(
            "INSERT INTO threads(server_id,endpoint,runner_id,thread_key,updated_at_ms,last_access_ms,bytes)
             VALUES('server','endpoint','runner',?1,1,?2,?3)",
            params![format!("thread-{index:02}"), index + 1, MAX_THREAD_BYTES],
        ).expect("seed quota metadata");
    }
    drop(connection);
    put(&temp.store(), &key("written"), "task", 33);
    let connection = temp.connection();
    let (count, bytes): (i64, i64) = connection
        .query_row("SELECT COUNT(*),SUM(bytes) FROM threads", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .expect("quota totals");
    assert_eq!((count, bytes), (32, 31 * MAX_THREAD_BYTES + 2));
    for thread in ["thread-00", "thread-01"] {
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE thread_key=?1",
                [thread],
                |row| row.get(0),
            )
            .expect("evicted identity");
        assert_eq!(count, 0);
    }
    drop(connection);
    assert_eq!(
        records(temp.store().load_thread(&key("written"), 33)).len(),
        1
    );
}
