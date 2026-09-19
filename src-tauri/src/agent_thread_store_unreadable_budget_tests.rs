use super::*;

fn write_unreadable(temp: &TempStore, thread_id: &str, bytes: usize) {
    fs::write(
        temp.thread_path(ROOT_KEY, thread_id),
        "0".repeat(bytes).into_bytes(),
    )
    .expect("write unreadable thread");
}

#[test]
fn unreadable_threads_never_push_readable_ones_out_of_the_count_budget() {
    let temp = TempStore::create("unreadable-count-budget");
    let store = temp.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        store
            .save(
                ROOT_KEY,
                &thread_document(ROOT_KEY, &thread_id_at(index), 100 + index as u64),
            )
            .expect("seed readable thread");
    }
    for index in 0..8 {
        write_unreadable(&temp, &thread_id_at(900 + index), 16);
    }

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.evicted, 0);
    assert_eq!(loaded.threads.len(), MAX_AGENT_THREADS_PER_ROOT);
    assert_eq!(loaded.unreadable.len(), 8);
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        assert!(
            temp.thread_path(ROOT_KEY, &thread_id_at(index)).exists(),
            "readable thread {index} was deleted for an unreadable neighbour"
        );
    }
}

#[test]
fn unreadable_bytes_never_push_readable_threads_out_of_the_byte_budget() {
    let temp = TempStore::create("unreadable-byte-budget");
    let store = temp.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, &thread_id_at(1), 10))
        .expect("seed readable thread");
    let oversize = MAX_AGENT_THREAD_FILE_BYTES + 1;
    let files = (MAX_AGENT_THREAD_ROOT_BYTES as usize / oversize) + 1;
    for index in 0..files {
        write_unreadable(&temp, &thread_id_at(900 + index), oversize);
    }

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.evicted, 0);
    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(loaded.threads[0].thread_id, thread_id_at(1));
    assert!(temp.thread_path(ROOT_KEY, &thread_id_at(1)).exists());
    assert!(!loaded.unreadable.is_empty());
}
