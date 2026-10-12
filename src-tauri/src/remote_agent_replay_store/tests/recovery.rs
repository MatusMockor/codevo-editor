use super::*;
use std::time::{Duration, Instant};

#[test]
fn missing_tasks_table_at_current_version_is_recreated() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    temp.connection()
        .execute_batch("DROP TABLE tasks;")
        .expect("remove tasks table");
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    put(&temp.store(), &key("thread"), "recovered", 3);
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 4)).len(),
        1
    );
}

#[test]
fn real_thread_bytes_are_recreated() {
    let temp = TempStore::new();
    put(&temp.store(), &key("thread"), "task", 1);
    temp.connection()
        .execute("UPDATE threads SET bytes=2.5", [])
        .expect("store real bytes");
    assert_eq!(
        temp.store().load_thread(&key("thread"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    put(&temp.store(), &key("thread"), "recovered", 3);
    assert_eq!(
        records(temp.store().load_thread(&key("thread"), 4)).len(),
        1
    );
}

#[test]
fn stale_recreation_nonce_preserves_replacement_even_with_reused_file_identity() {
    let temp = TempStore::new();
    put(&temp.store(), &key("original"), "task", 1);
    let opened = temp.connection();
    let nonce = opened.recovery_nonce();
    connection::recreate(opened, &temp.directory()).expect("first recreation");
    put(&temp.store(), &key("replacement"), "task", 2);
    let mut replacement = temp.connection();
    assert_ne!(replacement.recovery_nonce(), nonce);
    replacement.retain_recovery_nonce(nonce);
    connection::recreate(replacement, &temp.directory()).expect("stale second recreation");
    assert_eq!(
        records(temp.store().load_thread(&key("replacement"), 3)).len(),
        1
    );
}

#[test]
fn recovery_lock_wait_is_bounded_and_returns_busy() {
    let temp = TempStore::new();
    drop(temp.connection());
    let holder =
        super::super::recovery::CacheLock::shared(&temp.directory()).expect("shared holder");
    let waiter =
        super::super::recovery::CacheLock::shared(&temp.directory()).expect("shared waiter");
    let bound = Duration::from_millis(25);
    let started = Instant::now();
    assert!(matches!(
        waiter.exclusive_with_timeout(bound),
        Err(CacheError::Busy)
    ));
    let elapsed = started.elapsed();
    assert!(elapsed >= bound);
    assert!(elapsed < bound + Duration::from_millis(200), "{elapsed:?}");
    drop(holder);
    super::super::recovery::CacheLock::shared(&temp.directory())
        .expect("shared lock after timeout")
        .exclusive_with_timeout(bound)
        .expect("exclusive lock after timeout");
}
