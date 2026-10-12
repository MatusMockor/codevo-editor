use super::*;

#[cfg(unix)]
#[test]
fn symlinked_application_data_and_ancestors_allow_first_write() {
    use std::os::unix::fs::symlink;
    for suffix in ["", "missing/app-data"] {
        let temp = TempStore::new();
        let target = temp.base.join("target");
        let link = temp.base.join("linked-data");
        fs::create_dir(&target).expect("create app-data target");
        symlink(&target, &link).expect("symlink app-data directory");
        let store = RemoteAgentReplayStore::new(link.join(suffix));
        put(&store, &key("thread"), "task", 1);
        assert_eq!(records(store.load_thread(&key("thread"), 2)).len(), 1);
        assert_eq!(store.clear(), Ok(()));
        assert!(fs::symlink_metadata(&link)
            .expect("app-data symlink metadata")
            .file_type()
            .is_symlink());
    }
}

#[test]
fn legacy_corrupt_directory_does_not_block_operations_or_clear() {
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "first", 1);
    let leftover = temp.directory().join("cache.sqlite3.corrupt-directory");
    fs::create_dir(&leftover).expect("create legacy directory");
    let regular = temp.directory().join("cache.sqlite3.corrupt-regular");
    fs::write(&regular, b"legacy copy").expect("write legacy file");
    assert_eq!(records(store.load_thread(&key("thread"), 2)).len(), 1);
    assert!(!regular.exists());
    let connection = temp.connection();
    put(&store, &key("thread"), "second", 3);
    assert_eq!(records(store.load_thread(&key("thread"), 3)).len(), 2);
    drop(connection);
    assert_eq!(store.remove_thread(&key("thread")), Ok(()));
    put(&store, &key("thread"), "third", 4);
    assert_eq!(store.remove_server("server"), Ok(()));
    put(&store, &key("thread"), "fourth", 5);
    assert_eq!(store.clear(), Ok(()));
    assert!(leftover.is_dir());
    assert_eq!(
        store.load_thread(&key("thread"), 6),
        Ok(LoadThreadResponse::Miss {})
    );
}

#[cfg(unix)]
#[test]
fn legacy_corrupt_symlink_is_skipped_without_touching_target() {
    use std::os::unix::fs::symlink;
    let temp = TempStore::new();
    let store = temp.store();
    put(&store, &key("thread"), "task", 1);
    let target = temp.base.join("target");
    fs::write(&target, b"untouched").expect("write legacy symlink target");
    let link = temp.directory().join("cache.sqlite3.corrupt-symlink");
    symlink(&target, &link).expect("create legacy symlink");
    assert_eq!(records(store.load_thread(&key("thread"), 2)).len(), 1);
    assert_eq!(store.clear(), Ok(()));
    assert_eq!(
        fs::read(&target).expect("read symlink target"),
        b"untouched"
    );
    assert!(fs::symlink_metadata(&link)
        .expect("legacy symlink metadata")
        .file_type()
        .is_symlink());
}
