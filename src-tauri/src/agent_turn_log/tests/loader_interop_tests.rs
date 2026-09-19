use super::super::agent_thread_store::AgentThreadStore;
use super::*;

#[test]
fn real_turn_log_activity_is_never_listed_counted_or_evicted_by_the_v1_thread_loader() {
    let temp = TempLogStore::create("loader-interop");
    temp.write_thread_document(ROOT_KEY);
    let store = temp.store();
    seed(&store, TURN_ID, 12);
    store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("read the log back");
    let loader = AgentThreadStore::new(temp.base.clone());

    let loaded = loader.load(ROOT_KEY).expect("load the v1 threads");
    let thread_files = file_names(&temp.base.join("agent-threads").join(fnv1a64hex(ROOT_KEY)));
    let log_files = file_names(&temp.root_directory());

    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(loaded.threads[0].thread_id, THREAD_ID);
    assert!(
        loaded.unreadable.is_empty(),
        "the loader counted a turn log as an unreadable thread: {:?}",
        loaded.unreadable
    );
    assert_eq!(loaded.evicted, 0);
    assert_eq!(thread_files, vec![format!("{THREAD_ID}.json")]);
    assert!(
        log_files.contains(&format!("{THREAD_ID}.sqlite3")),
        "the loader deleted turn log state: {log_files:?}"
    );
}
