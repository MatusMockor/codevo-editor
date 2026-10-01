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
#[path = "ordering_tests.rs"]
mod ordering_tests;

fn artifact_turn(
    index: usize,
    status: serde_json::Value,
    started: u64,
    ended: Option<u64>,
) -> AgentTurn {
    serde_json::from_value(json!({"turnId":format!("agt-turn-{index:04}"),"prompt":"question","status":status,"startedAtEpochMs":started,"endedAtEpochMs":ended,"events":[],"eventsTruncated":false,"lastStatusSequence":0,"lastOutputSequence":0,"launch":null,"cliVersion":null})).unwrap()
}

fn artifact_fact(
    index: usize,
    status: legacy::AgentTurnStatus,
    started: u64,
    ended: Option<u64>,
) -> artifact_turns::ArtifactTurnFact {
    artifact_turns::ArtifactTurnFact {
        turn_id: format!("agt-turn-{index:04}"),
        status,
        started_at_epoch_ms: started,
        ended_at_epoch_ms: ended,
    }
}

#[test]
fn artifact_facts_come_from_durable_history_that_the_retired_thread_files_never_see() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![
        artifact_turn(1, json!({"kind":"exited","exitCode":0}), 10, Some(20)),
        artifact_turn(2, json!({"kind":"running"}), 30, None),
        artifact_turn(3, json!({"kind":"pending"}), 0, None),
    ];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();

    let retired = legacy::AgentThreadStore::new(fixture.base.clone())
        .load(ROOT)
        .unwrap();
    assert!(retired.threads.is_empty());

    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
        .unwrap()
        .expect("the thread saved to durable history");
    assert_eq!(facts.thread_id, saved.thread_id);
    assert_eq!(facts.owner, saved.owner);
    assert_eq!(facts.target, saved.target);
    assert!(!facts.successors_truncated);
    assert_eq!(
        facts.turns,
        vec![
            artifact_fact(
                1,
                legacy::AgentTurnStatus::Exited { exit_code: 0 },
                10,
                Some(20)
            ),
            artifact_fact(2, legacy::AgentTurnStatus::Running, 30, None),
            artifact_fact(3, legacy::AgentTurnStatus::Pending, 0, None),
        ]
    );
    let later = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0002")
        .unwrap()
        .expect("the thread saved to durable history");
    assert_eq!(
        later.turns.first().map(|turn| turn.turn_id.as_str()),
        Some("agt-turn-0002")
    );
    assert_eq!(later.turns.len(), 2);
}

#[test]
fn artifact_facts_report_an_unknown_turn_and_thread_without_inventing_them() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![artifact_turn(
        1,
        json!({"kind":"exited","exitCode":0}),
        10,
        Some(20),
    )];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();

    let unknown_turn = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0099")
        .unwrap()
        .expect("the thread exists");
    assert!(unknown_turn.turns.is_empty());
    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, "agt-thread-9999", "agt-turn-0001")
            .unwrap(),
        None
    );
}

#[test]
fn artifact_facts_hide_a_deleted_thread() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![artifact_turn(
        1,
        json!({"kind":"exited","exitCode":0}),
        10,
        Some(20),
    )];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    fixture
        .store
        .delete(ROOT, &owner(), &saved.thread_id)
        .unwrap();

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
            .unwrap(),
        None
    );
}

fn save_artifact_turns(fixture: &Fixture, saved: &mut AgentThread, range: std::ops::Range<usize>) {
    for index in range {
        let status = if index == 0 {
            json!({"kind":"exited","exitCode":0})
        } else {
            json!({"kind":"pending"})
        };
        let ended = if index == 0 { Some(20) } else { None };
        saved.turns = vec![artifact_turn(index, status, 10, ended)];
        fixture
            .store
            .save(ROOT, &owner(), saved, index as u64)
            .unwrap();
    }
}

#[test]
fn artifact_facts_accept_exactly_the_later_turn_cap_and_fail_closed_past_it() {
    let fixture = Fixture::new();
    let mut saved = thread();
    let cap = artifact_turns::MAX_ARTIFACT_LATER_TURNS;
    save_artifact_turns(&fixture, &mut saved, 0..cap + 1);

    let at_cap = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0000")
        .unwrap()
        .expect("the saved thread");
    assert_eq!(at_cap.turns.len(), cap + 1);
    assert!(!at_cap.successors_truncated);

    save_artifact_turns(&fixture, &mut saved, cap + 1..cap + 2);
    let past_cap = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0000")
        .unwrap()
        .expect("the saved thread");
    assert_eq!(past_cap.turns.len(), cap + 1);
    assert!(past_cap.successors_truncated);
}

fn raw_history(fixture: &Fixture) -> rusqlite::Connection {
    let connection =
        rusqlite::Connection::open(connection::database_path(&fixture.base, ROOT)).unwrap();
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    connection
}

fn saved_artifact_thread(fixture: &Fixture) -> AgentThread {
    let mut saved = thread();
    saved.turns = vec![
        artifact_turn(1, json!({"kind":"exited","exitCode":0}), 10, Some(20)),
        artifact_turn(2, json!({"kind":"running"}), 30, None),
    ];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    saved
}

#[test]
fn artifact_facts_treat_a_tombstoned_thread_row_as_deleted() {
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    let raw = raw_history(&fixture);
    raw.execute(
        "INSERT INTO tombstones(thread_id) VALUES (?1)",
        [&saved.thread_id],
    )
    .unwrap();
    let rows: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM threads WHERE thread_id=?1",
            [&saved.thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1);
    drop(raw);

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
            .unwrap(),
        None
    );
}

fn strip_turn_start(fixture: &Fixture, turn_id: &str) {
    let raw = raw_history(fixture);
    let changed = raw
        .execute(
            "UPDATE turns SET payload=json_remove(payload,'$.startedAtEpochMs') WHERE turn_id=?1",
            [turn_id],
        )
        .unwrap();
    assert_eq!(changed, 1);
}

#[test]
fn artifact_facts_refuse_a_turn_row_without_a_recorded_start() {
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    strip_turn_start(&fixture, "agt-turn-0001");

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
            .unwrap_err(),
        artifact_turns::ArtifactFactsError::MalformedTurn
    );
}

#[test]
fn artifact_facts_refuse_a_successor_row_without_a_recorded_start() {
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    strip_turn_start(&fixture, "agt-turn-0002");

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
            .unwrap_err(),
        artifact_turns::ArtifactFactsError::MalformedTurn
    );
}

#[cfg(unix)]
#[test]
fn artifact_facts_read_leaves_the_history_database_untouched() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    let path = connection::database_path(&fixture.base, ROOT);
    let before = fs::metadata(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();

    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001");

    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let after = fs::metadata(&path).unwrap();
    assert_eq!(
        facts
            .unwrap()
            .expect("the saved thread")
            .turns
            .first()
            .map(|turn| turn.turn_id.clone()),
        Some("agt-turn-0001".to_string())
    );
    assert_eq!(after.len(), before.len());
    assert_eq!(after.modified().unwrap(), before.modified().unwrap());
}

#[test]
fn artifact_facts_read_does_not_wait_for_a_concurrent_history_writer() {
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    let writer = raw_history(&fixture);
    writer
        .execute_batch("BEGIN IMMEDIATE; UPDATE turns SET payload=json_set(payload,'$.startedAtEpochMs',99) WHERE turn_id='agt-turn-0002';")
        .unwrap();

    let started = std::time::Instant::now();
    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001");
    let elapsed = started.elapsed();
    writer.execute_batch("ROLLBACK").unwrap();

    let facts = facts.unwrap().expect("the committed thread");
    assert_eq!(facts.turns[1].started_at_epoch_ms, 30);
    assert!(
        elapsed < std::time::Duration::from_secs(1),
        "the reader waited {elapsed:?} for the writer"
    );
}

#[test]
fn artifact_facts_refuse_an_unsupported_history_version() {
    let fixture = Fixture::new();
    let saved = saved_artifact_thread(&fixture);
    raw_history(&fixture)
        .pragma_update(None, "user_version", 3)
        .unwrap();

    assert!(fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
        .is_err());
}

#[test]
fn artifact_facts_for_an_unknown_root_do_not_create_a_history_database() {
    let fixture = Fixture::new();
    let other = "/workspace/alias";

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(other, "agt-thread-0001", "agt-turn-0001")
            .unwrap(),
        None
    );
    assert!(!connection::database_path(&fixture.base, other).exists());
}
fn running_turn(index: usize) -> AgentTurn {
    serde_json::from_value(json!({"turnId":format!("agt-turn-{index:04}"),"prompt":"lead","status":{"kind":"running"},"startedAtEpochMs":1,"endedAtEpochMs":null,"events":[],"eventsTruncated":false,"lastStatusSequence":1,"lastOutputSequence":0,"launch":null,"cliVersion":null})).unwrap()
}
fn saved_order(store: &AgentHistoryStore, thread_id: &str) -> Vec<String> {
    store
        .read_turns(ROOT, &owner(), thread_id, None)
        .unwrap()
        .turns
        .into_iter()
        .map(|turn| turn.turn_id)
        .collect()
}
#[test]
fn settled_turns_saved_while_the_last_turn_runs_are_ordered_before_it() {
    let fixture = Fixture::new();
    let mut saved = thread();
    let mut revision = 0;
    let mut save = |turns: Vec<AgentTurn>| {
        saved.turns = turns;
        fixture
            .store
            .save(ROOT, &owner(), &saved, revision)
            .unwrap();
        revision += 1;
    };
    save(vec![turn(0)]);
    save(vec![running_turn(1)]);
    for index in 2..27 {
        save(vec![turn(index)]);
    }
    let mut expected: Vec<String> = std::iter::once(0)
        .chain(2..27)
        .chain(std::iter::once(1))
        .map(|index| format!("agt-turn-{index:04}"))
        .collect();
    let reopened = AgentHistoryStore::new(fixture.base.clone());
    let mut all = Vec::new();
    let mut before = None;
    loop {
        let page = reopened
            .read_turns(ROOT, &owner(), "agt-thread-0001", before.as_deref())
            .unwrap();
        let mut ids: Vec<String> = page.turns.iter().map(|turn| turn.turn_id.clone()).collect();
        ids.extend(all);
        all = ids;
        if !page.has_earlier {
            break;
        }
        before = page.before_turn_id;
    }
    assert_eq!(all, expected);
    let mut settled = running_turn(1);
    settled.status = legacy::AgentTurnStatus::Exited { exit_code: 0 };
    save(vec![settled]);
    save(vec![turn(27)]);
    save(vec![running_turn(28)]);
    save(vec![turn(29)]);
    expected.extend((27..30).map(|index| format!("agt-turn-{index:04}")));
    expected.swap(28, 29);
    let reloaded = saved_order(&reopened, "agt-thread-0001");
    assert_eq!(reloaded, expected[expected.len() - reloaded.len()..]);
}
