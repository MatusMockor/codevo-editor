use super::*;
use root_budget::ROOT_USAGE_RESCAN_SAVES;

fn stored_thread_files(temp: &TempStore) -> usize {
    fs::read_dir(temp.root_directory(ROOT_KEY))
        .expect("read root directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".json"))
        .count()
}

fn save_thread(store: &AgentThreadStore, index: usize, updated_at_epoch_ms: u64) {
    store
        .save(
            ROOT_KEY,
            &thread_document(ROOT_KEY, &thread_id_at(index), updated_at_epoch_ms),
        )
        .expect("save thread");
}

fn plant_stray_temporary_file(temp: &TempStore) -> PathBuf {
    let stray = temp
        .root_directory(ROOT_KEY)
        .join("agt-thread-0002.json.tmp-1234-0");
    fs::write(&stray, "partial").expect("write stray temp file");
    stray
}

#[test]
fn a_warm_cache_still_evicts_at_the_count_budget() {
    let temp = TempStore::create("root-usage-warm-evict");
    let store = temp.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        save_thread(&store, index, 100 + index as u64);
    }
    store.load(ROOT_KEY).expect("load invalidates the cache");
    save_thread(&store, 63, 1_000);

    save_thread(&store, 9_999, 9_999);

    assert_eq!(stored_thread_files(&temp), MAX_AGENT_THREADS_PER_ROOT);
    assert!(!temp.thread_path(ROOT_KEY, &thread_id_at(0)).exists());
    assert!(temp.thread_path(ROOT_KEY, &thread_id_at(9_999)).exists());
}

#[test]
fn cached_saves_skip_the_directory_scan_until_the_rescan_threshold() {
    let temp = TempStore::create("root-usage-rescan");
    let store = temp.store();
    save_thread(&store, 1, 10);
    let stray = plant_stray_temporary_file(&temp);

    for revision in 1..ROOT_USAGE_RESCAN_SAVES {
        save_thread(&store, 1, 10 + u64::from(revision));
    }
    assert!(stray.exists(), "a cached save must not re-list the root");

    save_thread(&store, 1, 1_000);
    assert!(!stray.exists(), "the periodic rescan must re-list the root");
}

#[test]
fn a_new_thread_after_a_delete_is_admitted_by_a_full_scan_without_eviction() {
    let temp = TempStore::create("root-usage-delete");
    let store = temp.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        save_thread(&store, index, 100 + index as u64);
    }

    store.load(ROOT_KEY).expect("load invalidates the cache");
    save_thread(&store, 0, 1);
    let stray = plant_stray_temporary_file(&temp);

    store
        .delete(ROOT_KEY, &thread_id_at(5))
        .expect("delete thread");
    save_thread(&store, 9_999, 9_999);
    assert!(
        !stray.exists(),
        "a new thread file must be admitted by a full scan"
    );
    let loaded = store.load(ROOT_KEY).expect("load threads");
    let retained: HashSet<String> = loaded
        .threads
        .iter()
        .map(|thread| thread.thread_id.clone())
        .collect();

    assert_eq!(loaded.evicted, 0);
    assert_eq!(retained.len(), MAX_AGENT_THREADS_PER_ROOT);
    assert!(!retained.contains(&thread_id_at(5)));
    assert!(
        retained.contains(&thread_id_at(0)),
        "nothing may be evicted"
    );
    assert!(retained.contains(&thread_id_at(9_999)));
}

#[test]
fn concurrent_saves_and_deletes_never_exceed_the_count_budget() {
    let temp = TempStore::create("root-usage-concurrent");
    let store = Arc::new(temp.store());
    for index in 0..16 {
        save_thread(&store, 500 + index, 1);
    }
    let mut workers = Vec::new();
    for worker in 0..4 {
        let store = Arc::clone(&store);
        workers.push(thread::spawn(move || {
            for offset in 0..32 {
                let index = worker * 32 + offset;
                save_thread(&store, index, 100 + index as u64);
            }
        }));
    }
    let deleter = {
        let store = Arc::clone(&store);
        thread::spawn(move || {
            for index in 0..16 {
                store
                    .delete(ROOT_KEY, &thread_id_at(500 + index))
                    .expect("delete thread");
            }
        })
    };
    for worker in workers {
        worker.join().expect("join saver");
    }
    deleter.join().expect("join deleter");

    assert_eq!(stored_thread_files(&temp), MAX_AGENT_THREADS_PER_ROOT);
    let loaded = store.load(ROOT_KEY).expect("load threads");
    assert_eq!(loaded.evicted, 0);
    assert_eq!(loaded.threads.len(), MAX_AGENT_THREADS_PER_ROOT);
    assert!(loaded
        .threads
        .iter()
        .all(|thread| !thread.thread_id.starts_with("agt-thread-05")));
}

#[test]
fn external_additions_are_brought_back_within_budget_by_the_rescan() {
    let temp = TempStore::create("root-usage-external-add");
    let store = temp.store();
    for index in 0..60 {
        save_thread(&store, index, 100 + index as u64);
    }
    let external = temp.store();
    for index in 0..10 {
        save_thread(&external, 200 + index, 300 + index as u64);
    }

    for revision in 0..=ROOT_USAGE_RESCAN_SAVES {
        save_thread(&store, 0, 1_000 + u64::from(revision));
    }

    assert_eq!(stored_thread_files(&temp), MAX_AGENT_THREADS_PER_ROOT);
    let loaded = store.load(ROOT_KEY).expect("load threads");
    assert_eq!(loaded.evicted, 0);
    assert!(loaded
        .threads
        .iter()
        .any(|thread| thread.thread_id == thread_id_at(0)));
}

#[test]
fn external_deletions_never_cause_an_eviction_from_a_stale_cache() {
    let temp = TempStore::create("root-usage-external-delete");
    let store = temp.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        save_thread(&store, index, 100 + index as u64);
    }
    for index in 54..MAX_AGENT_THREADS_PER_ROOT {
        fs::remove_file(temp.thread_path(ROOT_KEY, &thread_id_at(index)))
            .expect("remove thread externally");
    }

    save_thread(&store, 9_999, 9_999);

    assert_eq!(stored_thread_files(&temp), 55);
    assert!(temp.thread_path(ROOT_KEY, &thread_id_at(0)).exists());
}

#[test]
fn externally_grown_files_are_counted_after_a_load_rescan() {
    let temp = TempStore::create("root-usage-external-grow");
    let store = temp.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        save_thread(&store, index, 100 + index as u64);
    }
    store.load(ROOT_KEY).expect("load invalidates the cache");
    save_thread(&store, 1, 1_000);
    let unreadable_bytes = (MAX_AGENT_THREAD_ROOT_BYTES / 2) as usize - 20 * 1024;
    for index in [62, 63] {
        fs::write(
            temp.thread_path(ROOT_KEY, &thread_id_at(index)),
            "0".repeat(unreadable_bytes).into_bytes(),
        )
        .expect("grow thread externally");
    }
    store.load(ROOT_KEY).expect("load invalidates the cache");

    save_thread(&store, 0, 9_999);

    assert!(stored_thread_files(&temp) < MAX_AGENT_THREADS_PER_ROOT);
    assert!(temp.thread_path(ROOT_KEY, &thread_id_at(0)).exists());
}

#[test]
fn a_second_writer_never_lets_a_new_thread_exceed_the_count_budget() {
    let temp = TempStore::create("root-usage-second-writer");
    let store = temp.store();
    for index in 0..60 {
        save_thread(&store, index, 100 + index as u64);
    }
    store.load(ROOT_KEY).expect("load invalidates the cache");
    save_thread(&store, 59, 1_000);
    let second = temp.store();
    for index in 0..4 {
        save_thread(&second, 200 + index, 300 + index as u64);
    }

    save_thread(&store, 9_999, 9_999);

    assert_eq!(stored_thread_files(&temp), MAX_AGENT_THREADS_PER_ROOT);
    assert!(!temp.thread_path(ROOT_KEY, &thread_id_at(0)).exists());
    assert!(temp.thread_path(ROOT_KEY, &thread_id_at(9_999)).exists());
}
