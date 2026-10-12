use super::*;

const MARKER: &[u8] = b"cache-sensitive-unique-marker-394805";

fn sensitive_record() -> Vec<u8> {
    let mut record = b"{\"text\":\"".to_vec();
    for _ in 0..(2 * 1024 * 1024 / MARKER.len()) {
        record.extend_from_slice(MARKER);
    }
    record.extend_from_slice(b"\"}");
    record
}

fn directory_contains(temp: &TempStore, needle: &[u8]) -> bool {
    fs::read_dir(temp.directory())
        .expect("read cache directory")
        .map(|entry| entry.expect("cache directory entry").path())
        .any(|path| {
            fs::read(path)
                .expect("read cache file")
                .windows(needle.len())
                .any(|window| window == needle)
        })
}

fn put_sensitive(temp: &TempStore) {
    assert_eq!(
        temp.store()
            .put_task(&key("sensitive"), "task", &sensitive_record(), 1),
        Ok(PutTaskResponse::Stored {})
    );
    put(&temp.store(), &key("keep"), "task", 1);
    assert!(directory_contains(temp, MARKER));
}

#[test]
fn clear_erases_record_bytes_and_legacy_corruption_copies() {
    let temp = TempStore::new();
    put_sensitive(&temp);
    for suffix in [
        ".corrupt-123-0",
        ".corrupt-123-0-wal",
        ".corrupt-123-0-shm",
        ".corrupt-123-0-journal",
    ] {
        fs::write(paths::sidecar(&temp.database(), suffix), MARKER).expect("legacy corrupt copy");
    }
    temp.store().clear().expect("clear cache");
    assert!(!directory_contains(&temp, MARKER));
    assert_eq!(
        temp.store().load_thread(&key("keep"), 2),
        Ok(LoadThreadResponse::Miss {})
    );
    assert_eq!(row_count(&temp.connection(), "tasks"), 0);
}

#[test]
fn remove_thread_erases_record_bytes_from_database_and_sidecars() {
    let temp = TempStore::new();
    put_sensitive(&temp);
    let connection = temp.connection();
    temp.store()
        .remove_thread(&key("sensitive"))
        .expect("remove sensitive thread");
    assert!(!directory_contains(&temp, MARKER));
    assert_eq!(
        fs::metadata(paths::sidecar(&temp.database(), "-wal"))
            .expect("live WAL")
            .len(),
        0
    );
    drop(connection);
    assert_eq!(records(temp.store().load_thread(&key("keep"), 2)).len(), 1);
}

#[test]
fn remove_server_erases_record_bytes_from_database_and_sidecars() {
    let temp = TempStore::new();
    put_sensitive(&temp);
    let mut other = key("other");
    other.server_id = "other".into();
    put(&temp.store(), &other, "task", 1);
    let connection = temp.connection();
    temp.store()
        .remove_server("server")
        .expect("remove sensitive server");
    assert!(!directory_contains(&temp, MARKER));
    assert_eq!(
        fs::metadata(paths::sidecar(&temp.database(), "-wal"))
            .expect("live WAL")
            .len(),
        0
    );
    drop(connection);
    assert_eq!(records(temp.store().load_thread(&other, 2)).len(), 1);
}
