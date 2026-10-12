use super::*;
use std::sync::mpsc;

#[test]
fn reordered_puts_preserve_tasks_neighbors_and_monotonic_thread_timestamps() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "first", 1001);
    put(&store, &key("neighbor"), "neighbor", 1001);
    put(&store, &key("thread"), "second", 1000);
    assert_eq!(thread_timestamps(&temp, "thread"), (1001, 1001));
    assert_eq!(records(store.load_thread(&key("thread"), 1000)).len(), 2);
    assert_eq!(records(store.load_thread(&key("neighbor"), 1000)).len(), 1);
    assert_eq!(thread_timestamps(&temp, "thread"), (1001, 1001));
    records(store.load_thread(&key("thread"), 2000));
    put(&store, &key("thread"), "third", 1500);
    assert_eq!(thread_timestamps(&temp, "thread"), (1500, 2000));
}

#[test]
fn slightly_future_load_preserves_the_thread_permanently() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "task", 2000);
    assert_eq!(records(store.load_thread(&key("thread"), 1999)).len(), 1);
    assert_eq!(thread_timestamps(&temp, "thread"), (2000, 2000));
    assert_eq!(records(store.load_thread(&key("thread"), 2000)).len(), 1);
}

#[test]
fn delayed_large_put_preserves_all_acknowledged_small_tasks_and_neighbor() {
    let temp = TempStore::new();
    let store = temp.store();
    let large_record = object_of_size(MAX_RECORD_BYTES);
    let (started_sender, started_receiver) = mpsc::channel();
    let (release_sender, release_receiver) = mpsc::channel();
    let (large_result, small_results) = std::thread::scope(|scope| {
        let large_store = &store;
        let large_record = &large_record;
        let large = scope.spawn(move || {
            let now_ms = 1000;
            started_sender.send(()).expect("signal large put start");
            release_receiver.recv().expect("release delayed large put");
            large_store.put_task(&key("thread"), "large", large_record, now_ms)
        });
        started_receiver.recv().expect("large put started");
        let workers = (0..5)
            .map(|index| {
                let store = &store;
                scope.spawn(move || {
                    if index == 4 {
                        return store.put_task(&key("neighbor"), "neighbor", b"{}", 1002);
                    }
                    store.put_task(&key("thread"), &format!("small-{index}"), b"{}", 1002)
                })
            })
            .collect::<Vec<_>>();
        let results = workers
            .into_iter()
            .map(|worker| worker.join())
            .collect::<Vec<_>>();
        release_sender.send(()).expect("release large put");
        (large.join().expect("large worker finished"), results)
    });
    assert_eq!(large_result, Ok(PutTaskResponse::Stored {}));
    for result in small_results {
        assert_eq!(
            result.expect("small worker finished"),
            Ok(PutTaskResponse::Stored {})
        );
    }
    let loaded = records(store.load_thread(&key("thread"), 1002));
    assert_eq!(
        loaded
            .iter()
            .map(|record| record.task_id.as_str())
            .collect::<Vec<_>>(),
        ["large", "small-0", "small-1", "small-2", "small-3"]
    );
    assert_eq!(loaded[0].record.as_bytes(), large_record.as_slice());
    assert_eq!(thread_timestamps(&temp, "thread"), (1002, 1002));
    assert_eq!(records(store.load_thread(&key("neighbor"), 1002)).len(), 1);
}

#[test]
fn one_hour_backward_step_between_puts_preserves_every_thread() {
    let temp = TempStore::new();
    let store = temp.store();
    let hour_ms = 60 * 60 * 1000;
    put(&store, &key("thread"), "before", 2 * hour_ms);
    put(&store, &key("neighbor"), "neighbor", 2 * hour_ms);
    put(&store, &key("thread"), "after", hour_ms);
    put(&store, &key("new"), "new", hour_ms);
    assert_eq!(records(store.load_thread(&key("thread"), hour_ms)).len(), 2);
    assert_eq!(
        records(store.load_thread(&key("neighbor"), hour_ms)).len(),
        1
    );
    assert_eq!(records(store.load_thread(&key("new"), hour_ms)).len(), 1);
    assert_eq!(
        thread_timestamps(&temp, "thread"),
        (2 * hour_ms, 2 * hour_ms)
    );
}

#[test]
fn future_tolerance_boundary_is_live_for_load_and_put_sweep() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "first", FUTURE_TOLERANCE_MS);
    assert_eq!(records(store.load_thread(&key("thread"), 0)).len(), 1);
    put(&store, &key("thread"), "second", 0);
    put(&store, &key("neighbor"), "neighbor", 0);
    assert_eq!(records(store.load_thread(&key("thread"), 0)).len(), 2);
    assert_eq!(
        thread_timestamps(&temp, "thread"),
        (FUTURE_TOLERANCE_MS, FUTURE_TOLERANCE_MS)
    );
    assert_eq!(records(store.load_thread(&key("neighbor"), 0)).len(), 1);
}

#[test]
fn more_than_twenty_four_hours_future_is_a_load_miss_and_is_deleted() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "task", FUTURE_TOLERANCE_MS + 1);
    assert_eq!(
        store.load_thread(&key("thread"), 0),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
    assert_eq!(
        store.load_thread(&key("thread"), FUTURE_TOLERANCE_MS + 1),
        Ok(LoadThreadResponse::Miss {})
    );
}

#[test]
fn put_sweeps_rows_more_than_twenty_four_hours_future() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("future"), "task", FUTURE_TOLERANCE_MS + 1);
    put(&store, &key("present"), "task", 0);
    assert_eq!(row_count(&temp.connection(), "threads"), 1);
    assert_eq!(
        store.load_thread(&key("future"), 0),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(records(store.load_thread(&key("present"), 0)).len(), 1);
}

#[test]
fn tolerance_and_expiry_arithmetic_saturate_at_maximum_timestamp() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "first", i64::MAX);
    put(&store, &key("thread"), "second", i64::MAX - 1000);
    assert_eq!(
        records(store.load_thread(&key("thread"), i64::MAX - 1000)).len(),
        2
    );
    assert_eq!(thread_timestamps(&temp, "thread"), (i64::MAX, i64::MAX));
}

#[test]
fn out_of_order_access_and_put_leave_lru_ties_deterministic() {
    let temp = TempStore::new();
    let store = temp.store();
    for index in 0..MAX_THREADS {
        put(&store, &key(&format!("thread-{index:02}")), "task", 10);
    }
    records(store.load_thread(&key("thread-00"), 20));
    records(store.load_thread(&key("thread-00"), 0));
    put(&store, &key("thread-00"), "late", 0);
    assert_eq!(thread_timestamps(&temp, "thread-00"), (10, 20));
    put(&store, &key("written"), "task", 0);
    assert_eq!(
        store.load_thread(&key("thread-01"), 0),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(records(store.load_thread(&key("thread-00"), 0)).len(), 2);
    assert_eq!(records(store.load_thread(&key("thread-02"), 0)).len(), 1);
    assert_eq!(row_count(&temp.connection(), "threads"), MAX_THREADS);
}

fn thread_timestamps(temp: &TempStore, thread: &str) -> (i64, i64) {
    temp.connection()
        .query_row(
            "SELECT updated_at_ms,last_access_ms FROM threads WHERE thread_key=?1",
            [thread],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("thread timestamps")
}
