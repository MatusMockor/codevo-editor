use super::*;
use serde_json::json;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    store: AgentHistoryStore,
}
impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "codevo-history-{}-{nonce}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        Self {
            store: AgentHistoryStore::new(base.clone()),
            base,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
const ROOT: &str = "/workspace/history";
fn owner() -> String {
    legacy::agent_root_owner_id(ROOT)
}
fn thread() -> AgentThread {
    serde_json::from_value(json!({"threadId":"agt-thread-0001","owner":{"rootKey":ROOT,"ownerId":owner(),"repositoryRoot":ROOT},"target":{"isolation":"in-place","worktreePath":null},"provider":{"kind":"claudeCode","sessionId":null},"title":"History","pinned":false,"archived":false,"createdAtEpochMs":1,"updatedAtEpochMs":2,"turns":[],"turnsTruncated":false})).unwrap()
}
fn turn(index: usize) -> AgentTurn {
    serde_json::from_value(json!({"turnId":format!("agt-turn-{index:04}"),"prompt":"question","status":{"kind":"interrupted"},"startedAtEpochMs":1,"endedAtEpochMs":2,"events":[],"eventsTruncated":false,"lastStatusSequence":0,"lastOutputSequence":0,"launch":null,"cliVersion":null})).unwrap()
}
#[test]
fn history_beyond_sixty_four_turns_survives_restart_and_partial_save() {
    let fixture = Fixture::new();
    let mut saved = thread();
    for index in 0..140 {
        saved.turns = vec![turn(index)];
        fixture
            .store
            .save(ROOT, &owner(), &saved, index as u64)
            .unwrap();
    }
    let reopened = AgentHistoryStore::new(fixture.base.clone());
    let latest = reopened.load(ROOT, &owner()).unwrap();
    assert_eq!(latest.threads[0].turns.len(), 32);
    assert!(latest.threads[0].turns_truncated);
    let mut before = None;
    let mut all = Vec::new();
    loop {
        let page = reopened
            .read_turns(ROOT, &owner(), &saved.thread_id, before.as_deref())
            .unwrap();
        all.extend(page.turns.iter().map(|turn| turn.turn_id.clone()));
        if !page.has_earlier {
            break;
        }
        before = page.before_turn_id;
    }
    all.sort();
    all.dedup();
    assert_eq!(all.len(), 140);
}
#[test]
fn aggregate_history_larger_than_legacy_document_is_durable() {
    let fixture = Fixture::new();
    let mut saved = thread();
    for index in 0..80 {
        let mut item = turn(index);
        item.prompt = "p".repeat(24 * 1024);
        saved.turns = vec![item];
        fixture
            .store
            .save(ROOT, &owner(), &saved, index as u64)
            .unwrap();
    }
    let count = fixture
        .store
        .with_connection(ROOT, &owner(), |connection| {
            sql(
                connection.query_row("SELECT SUM(length(payload)) FROM turns", [], |r| {
                    r.get::<_, i64>(0)
                }),
            )
        })
        .unwrap();
    assert!(count > 1024 * 1024);
    assert_eq!(fixture.store.load(ROOT, &owner()).unwrap().threads.len(), 1);
}
#[test]
fn migration_preserves_original_and_tombstone_prevents_resurrection() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![turn(0)];
    let directory = fixture
        .base
        .join("agent-threads")
        .join(legacy::fnv1a64hex(ROOT));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("{}.json", saved.thread_id));
    let original = serde_json::to_vec(&AgentThreadDocument {
        schema_version: 1,
        thread: saved.clone(),
    })
    .unwrap();
    fs::write(&path, &original).unwrap();
    assert_eq!(fixture.store.load(ROOT, &owner()).unwrap().threads.len(), 1);
    assert_eq!(
        fixture.store.load(ROOT, &owner()).unwrap().threads[0]
            .turns
            .len(),
        1
    );
    fixture
        .store
        .delete(ROOT, &owner(), &saved.thread_id)
        .unwrap();
    assert!(fixture
        .store
        .load(ROOT, &owner())
        .unwrap()
        .threads
        .is_empty());
    assert_eq!(fs::read(path).unwrap(), original);
    assert!(fixture.store.save(ROOT, &owner(), &saved, 0).is_err());
}
#[test]
fn copied_catalog_cannot_claim_another_owner() {
    let fixture = Fixture::new();
    fixture.store.save(ROOT, &owner(), &thread(), 0).unwrap();
    fixture
        .store
        .with_connection(ROOT, &owner(), |connection| {
            sql(connection.execute("UPDATE history_owner SET root_key='/foreign'", []))?;
            Ok(())
        })
        .unwrap();
    assert!(fixture.store.load(ROOT, &owner()).is_err());
}
#[test]
fn foreign_cursor_does_not_return_an_unrelated_page() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![turn(0)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    assert!(fixture
        .store
        .read_turns(ROOT, &owner(), &saved.thread_id, Some("agt-turn-9999"))
        .is_err());
}
#[test]
fn stale_writer_cannot_replace_newer_revision_or_recreate_deleted_thread() {
    let fixture = Fixture::new();
    let mut saved = thread();
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &saved, 0)
            .unwrap()
            .revision,
        1
    );
    saved.title = "new title".into();
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &saved, 1)
            .unwrap()
            .revision,
        2
    );
    saved.title = "stale title".into();
    assert!(fixture.store.save(ROOT, &owner(), &saved, 1).is_err());
    let snapshot = fixture.store.load(ROOT, &owner()).unwrap();
    assert_eq!(snapshot.threads[0].title, "new title");
    assert_eq!(snapshot.revisions[&saved.thread_id], 2);
    fixture
        .store
        .delete(ROOT, &owner(), &saved.thread_id)
        .unwrap();
    assert_eq!(
        connection::ownership_status(&fixture.base, ROOT, &saved.thread_id).unwrap(),
        Some(false)
    );
    assert!(fixture.store.save(ROOT, &owner(), &saved, 0).is_err());
}
#[test]
fn catalog_pages_keep_threads_beyond_initial_sixty_four() {
    let fixture = Fixture::new();
    for index in 0..75 {
        let mut saved = thread();
        saved.thread_id = format!("agt-thread-{index:04}");
        fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    }
    assert_eq!(
        fixture.store.load(ROOT, &owner()).unwrap().threads.len(),
        64
    );
    let mut before = None;
    let mut ids = Vec::new();
    loop {
        let page = fixture
            .store
            .read_threads(ROOT, &owner(), before.as_deref())
            .unwrap();
        assert!(page.threads.len() <= 32);
        assert_eq!(page.revisions.len(), page.threads.len());
        ids.extend(page.threads.iter().map(|thread| thread.thread_id.clone()));
        if !page.has_earlier {
            break;
        }
        before = page.before_thread_id;
    }
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 75);
}
#[test]
fn payload_budget_never_publishes_empty_execution_state() {
    let fixture = Fixture::new();
    for index in 0..3 {
        let mut saved = thread();
        saved.thread_id = format!("agt-thread-{index:04}");
        let mut item = turn(index);
        item.events = (0..180)
            .map(|_| legacy::AgentTurnEvent::AssistantText {
                text: "a".repeat(16 * 1024),
                parent_tool_id: None,
            })
            .collect();
        saved.turns = vec![item];
        fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    }
    let snapshot = fixture.store.load(ROOT, &owner()).unwrap();
    assert_eq!(snapshot.threads.len(), 1);
    assert_eq!(snapshot.threads[0].turns.len(), 1);
    assert!(serde_json::to_vec(&snapshot).unwrap().len() <= MAX_PAGE_BYTES);
    for index in 0..3 {
        let page = fixture
            .store
            .read_turns(ROOT, &owner(), &format!("agt-thread-{index:04}"), None)
            .unwrap();
        assert_eq!(page.turns.len(), 1);
    }
}
#[test]
fn concurrent_catalog_creation_does_not_claim_foreign_ownership() {
    let fixture = Fixture::new();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let base = fixture.base.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                AgentHistoryStore::new(base).load(ROOT, &owner())
            })
        })
        .collect();
    for handle in handles {
        if let Err(error) = handle.join().unwrap() {
            panic!("Concurrent load failed: {error}");
        }
    }
}
#[cfg(unix)]
#[test]
fn symlink_database_is_never_followed() {
    let fixture = Fixture::new();
    fixture.store.load(ROOT, &owner()).unwrap();
    let path = connection::database_path(&fixture.base, ROOT);
    let outside = fixture.base.join("outside.sqlite3");
    fs::rename(&path, &outside).unwrap();
    std::os::unix::fs::symlink(&outside, &path).unwrap();
    assert!(fixture.store.load(ROOT, &owner()).is_err());
}
#[test]
fn page_row_identifier_must_match_serialized_turn() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![turn(0)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    fixture
        .store
        .with_connection(ROOT, &owner(), |connection| {
            sql(connection.execute("UPDATE turns SET turn_id='agt-turn-9999'", []))?;
            Ok(())
        })
        .unwrap();
    assert!(fixture
        .store
        .read_turns(ROOT, &owner(), &saved.thread_id, None)
        .is_err());
}
#[test]
fn committed_save_with_lost_receipt_can_only_replay_the_exact_payload() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![turn(0)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &saved, 0)
            .unwrap()
            .revision,
        1
    );
    saved.title = "different payload".into();
    assert!(fixture.store.save(ROOT, &owner(), &saved, 0).is_err());
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &saved, 1)
            .unwrap()
            .revision,
        2
    );
    assert_eq!(
        fixture
            .store
            .save(ROOT, &owner(), &saved, 1)
            .unwrap()
            .revision,
        2
    );
    assert!(fixture.store.save(ROOT, &owner(), &thread(), 0).is_err());
}

#[path = "management_tests.rs"]
mod management_tests;
