use super::*;

fn unreadable_lifecycles() -> Vec<Value> {
    let oversized_title = "é".repeat(241);
    vec![
        json!({"entries":[{"id":"tool:t","toolId":"t","name":"Agent","description":"work","state":"running","unknownEntryKey":true}],"truncated":false}),
        json!({"entries":[],"truncated":false,"unknownRootKey":1}),
        json!({"entries":[{"id":"tool:t","toolId":"t","name":"Agent","description":"work","state":"running","taskTitle":oversized_title}],"truncated":false}),
        json!({"entries":[],"truncated":"no"}),
        Value::Null,
    ]
}

#[test]
fn additive_lifecycle_metadata_never_condemns_a_stored_thread() {
    let temp = TempStore::create("lifecycle-lenient-read");
    let store = temp.store();
    let document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    store.save(ROOT_KEY, &document).expect("save thread");
    let path = temp.thread_path(ROOT_KEY, "agt-thread-0001");

    for lifecycle in unreadable_lifecycles() {
        let mut encoded = serde_json::to_value(&document).expect("encode thread");
        encoded["thread"]["turns"][0]["subagentLifecycle"] = lifecycle.clone();
        fs::write(&path, encoded.to_string()).expect("write lifecycle thread");

        let loaded = store.load(ROOT_KEY).expect("load thread");

        assert!(loaded.unreadable.is_empty(), "{lifecycle}");
        assert_eq!(loaded.threads.len(), 1, "{lifecycle}");
        let turn = &loaded.threads[0].turns[0];
        assert_eq!(turn.subagent_lifecycle, None, "{lifecycle}");
        assert_eq!(turn.prompt, "do it", "{lifecycle}");
        assert_eq!(turn.events.len(), 1, "{lifecycle}");
    }
}

#[test]
fn additive_lifecycle_metadata_does_not_evict_readable_threads() {
    let temp = TempStore::create("lifecycle-lenient-budget");
    let store = temp.store();
    let directory = temp.root_directory(ROOT_KEY);
    fs::create_dir_all(&directory).expect("create root directory");
    let count = MAX_AGENT_THREADS_PER_ROOT + 1;
    for index in 1..=count {
        let thread_id = thread_id_at(index);
        let mut encoded = serde_json::to_value(thread_document(ROOT_KEY, &thread_id, index as u64))
            .expect("encode thread");
        if index == count {
            encoded["thread"]["turns"][0]["subagentLifecycle"] =
                json!({"entries":[],"truncated":false,"unknownRootKey":1});
        }
        fs::write(temp.thread_path(ROOT_KEY, &thread_id), encoded.to_string())
            .expect("write thread");
    }

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(loaded.unreadable.is_empty());
    assert_eq!(loaded.evicted, 1);
    assert_eq!(loaded.threads.len(), MAX_AGENT_THREADS_PER_ROOT);
    let newest = loaded.threads.last().expect("newest thread");
    assert_eq!(newest.thread_id, thread_id_at(count));
    assert_eq!(newest.turns[0].subagent_lifecycle, None);
}

#[test]
fn saving_rejects_the_lifecycle_shapes_dropped_on_read() {
    let temp = TempStore::create("lifecycle-strict-write");
    let store = temp.store();

    for lifecycle in unreadable_lifecycles() {
        if lifecycle.is_null() {
            continue;
        }
        let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
        document.thread.turns[0].subagent_lifecycle = Some(lifecycle.clone());

        assert_eq!(
            store.save(ROOT_KEY, &document),
            Err("Invalid subagent lifecycle metadata".to_string()),
            "{lifecycle}"
        );
    }
}
