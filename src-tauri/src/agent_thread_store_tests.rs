use super::*;
use serde_json::{json, Value};
use std::{
    sync::{atomic::AtomicU64, mpsc},
    thread,
    time::Duration,
};

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

struct TempStore {
    base: PathBuf,
}

impl TempStore {
    fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!(
            "agent-thread-store-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("create temp store directory");
        Self { base }
    }

    fn store(&self) -> AgentThreadStore {
        AgentThreadStore::new(self.base.clone())
    }

    fn root_directory(&self, root_key: &str) -> PathBuf {
        self.base
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(root_key))
    }

    fn thread_path(&self, root_key: &str, thread_id: &str) -> PathBuf {
        self.root_directory(root_key)
            .join(format!("{thread_id}.json"))
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

const ROOT_KEY: &str = "/workspace/alpha";

fn settled_turn(turn_id: &str) -> AgentTurn {
    AgentTurn {
        turn_id: turn_id.to_string(),
        prompt: "do it".to_string(),
        status: AgentTurnStatus::Exited { exit_code: 0 },
        started_at_epoch_ms: 1,
        ended_at_epoch_ms: Some(2),
        events: vec![AgentTurnEvent::AssistantText {
            text: "done".to_string(),
        }],
        events_truncated: false,
        last_status_sequence: 1,
        last_output_sequence: 1,
        stream_metrics: None,
        launch: None,
        cli_version: None,
    }
}

#[test]
fn stream_metrics_are_backward_compatible_exact_and_bounded() {
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.turns[0].stream_metrics = Some(AgentTurnStreamMetrics {
        received_utf8_bytes: 7,
        complete: false,
    });
    let encoded = serde_json::to_value(&document).expect("serialize metrics");
    let decoded: AgentThreadDocument =
        serde_json::from_value(encoded.clone()).expect("deserialize metrics");
    assert_eq!(decoded, document);

    let mut legacy = encoded.clone();
    legacy["thread"]["turns"][0]
        .as_object_mut()
        .expect("turn object")
        .remove("streamMetrics");
    let legacy: AgentThreadDocument =
        serde_json::from_value(legacy).expect("deserialize legacy turn");
    assert_eq!(legacy.thread.turns[0].stream_metrics, None);

    let mut unknown = encoded;
    unknown["thread"]["turns"][0]["streamMetrics"]["extra"] = json!(true);
    assert!(serde_json::from_value::<AgentThreadDocument>(unknown).is_err());

    document.thread.turns[0].stream_metrics = Some(AgentTurnStreamMetrics {
        received_utf8_bytes: MAX_AGENT_STREAM_METRIC_BYTES + 1,
        complete: true,
    });
    assert!(validate_agent_thread_document(ROOT_KEY, &document).is_err());
}

fn running_turn(turn_id: &str) -> AgentTurn {
    AgentTurn {
        status: AgentTurnStatus::Running,
        ended_at_epoch_ms: None,
        ..settled_turn(turn_id)
    }
}

fn thread_document(
    root_key: &str,
    thread_id: &str,
    updated_at_epoch_ms: u64,
) -> AgentThreadDocument {
    AgentThreadDocument {
        schema_version: AGENT_THREAD_SCHEMA_VERSION,
        thread: AgentThread {
            thread_id: thread_id.to_string(),
            owner: AgentThreadOwner {
                root_key: root_key.to_string(),
                owner_id: agent_root_owner_id(root_key),
                repository_root: "/workspace/alpha".to_string(),
            },
            target: AgentThreadTarget {
                isolation: AgentTaskIsolation::Worktree,
                worktree_path: Some(format!("/workspace/alpha/.worktrees/{thread_id}")),
            },
            provider: AgentProviderSession {
                kind: AgentCliInvocation::ClaudeCode,
                session_id: Some("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string()),
            },
            title: "do the thing".to_string(),
            pinned: false,
            archived: false,
            created_at_epoch_ms: 1,
            updated_at_epoch_ms,
            turns: vec![settled_turn("agt-turn-0001")],
            turns_truncated: false,
            viewed_at_epoch_ms: None,
            integration: None,
        },
    }
}

fn thread_id_at(index: usize) -> String {
    format!("agt-thread-{index:04}")
}

#[test]
fn saves_and_loads_a_thread_through_the_hashed_root_directory() {
    let workspace = TempStore::create("round-trip");
    let store = workspace.store();
    let document = thread_document(ROOT_KEY, "agt-thread-0001", 10);

    store.save(ROOT_KEY, &document).expect("save thread");
    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(workspace.thread_path(ROOT_KEY, "agt-thread-0001").is_file());
    assert_eq!(loaded.threads, vec![document.thread]);
    assert!(loaded.unreadable.is_empty());
    assert_eq!(loaded.evicted, 0);
}

#[test]
fn loading_an_unknown_root_returns_an_empty_snapshot() {
    let workspace = TempStore::create("empty-root");

    let loaded = workspace.store().load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded, AgentThreadLoadResult::default());
}

#[test]
fn thread_identifiers_are_validated_before_any_path_use() {
    let workspace = TempStore::create("traversal");
    let store = workspace.store();
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.thread_id = "../../escape".to_string();

    let save = store.save(ROOT_KEY, &document).expect_err("traversal save");
    let delete = store
        .delete(ROOT_KEY, "../../escape")
        .expect_err("traversal delete");

    assert!(save.contains("task id"), "got: {save}");
    assert!(delete.contains("task id"), "got: {delete}");
}

#[test]
fn an_empty_root_key_is_refused() {
    let workspace = TempStore::create("empty-root-key");
    let store = workspace.store();

    assert!(store.load("").is_err());
    assert!(store.delete("", "agt-thread-0001").is_err());
}

#[test]
fn publishing_failure_leaves_no_temporary_file_behind() {
    let workspace = TempStore::create("atomic-failure");
    let store = workspace.store();
    let directory = workspace.root_directory(ROOT_KEY);
    fs::create_dir_all(directory.join("agt-thread-0001.json"))
        .expect("occupy the destination with a directory");

    let error = store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect_err("rename onto a directory must fail");

    assert!(error.contains("publish"), "got: {error}");
    let leftovers: Vec<String> = fs::read_dir(&directory)
        .expect("read root directory")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
}

#[test]
fn a_corrupt_file_is_reported_and_never_deleted() {
    let workspace = TempStore::create("corrupt");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save readable thread");
    let corrupt = workspace.thread_path(ROOT_KEY, "agt-thread-0002");
    fs::write(&corrupt, "{ not json").expect("write corrupt file");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(loaded.unreadable.len(), 1);
    assert_eq!(loaded.unreadable[0].thread_id, "agt-thread-0002");
    assert!(
        loaded.unreadable[0].reason.contains("JSON"),
        "got: {}",
        loaded.unreadable[0].reason
    );
    assert!(corrupt.is_file(), "corrupt files must be retained");
}

#[test]
fn a_thread_with_an_unknown_launch_mode_is_reported_unreadable_and_never_deleted() {
    let workspace = TempStore::create("unknown-launch-mode");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save readable thread");
    let path = workspace.thread_path(ROOT_KEY, "agt-thread-0002");
    let mut encoded: Value = serde_json::to_value(thread_document(ROOT_KEY, "agt-thread-0002", 20))
        .expect("encode thread document");
    encoded["thread"]["turns"][0]["launch"] =
        json!({ "provider": "claudeCode", "model": "opus", "mode": "yolo" });
    fs::write(&path, encoded.to_string()).expect("write unknown launch mode");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(loaded.unreadable.len(), 1);
    assert_eq!(loaded.unreadable[0].thread_id, "agt-thread-0002");
    assert!(path.is_file(), "unknown launch values must be retained");
}

#[test]
fn a_launch_stamped_thread_survives_a_save_and_load_round_trip() {
    let workspace = TempStore::create("launch-round-trip");
    let store = workspace.store();
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.viewed_at_epoch_ms = Some(2500);
    document.thread.turns[0].launch = Some(AgentLaunchOptions::ClaudeCode {
        model: crate::agent_task_spawner::agent_launch::ClaudeModelChoice::Sonnet,
        mode: crate::agent_task_spawner::agent_launch::ClaudePermissionMode::AcceptEdits,
        effort: crate::agent_task_spawner::agent_launch::ClaudeEffortChoice::Xhigh,
    });

    store
        .save(ROOT_KEY, &document)
        .expect("save stamped thread");
    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.threads, vec![document.thread]);
    assert!(loaded.unreadable.is_empty());
}

#[test]
fn a_pre_launch_file_on_disk_loads_with_absent_launch_and_viewed_at() {
    let workspace = TempStore::create("pre-launch-file");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save thread");
    let path = workspace.thread_path(ROOT_KEY, "agt-thread-0001");
    let mut encoded: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("read saved thread"))
            .expect("decode saved thread");
    let thread = encoded["thread"].as_object_mut().expect("thread object");
    thread.remove("viewedAtEpochMs");
    for turn in thread["turns"].as_array_mut().expect("turns array") {
        turn.as_object_mut().expect("turn object").remove("launch");
    }
    fs::write(&path, encoded.to_string()).expect("write pre-launch document");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(loaded.unreadable.is_empty());
    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(loaded.threads[0].viewed_at_epoch_ms, None);
    assert!(loaded.threads[0]
        .turns
        .iter()
        .all(|turn| turn.launch.is_none()));
}

#[test]
fn a_schema_version_mismatch_is_skipped_and_reported() {
    let workspace = TempStore::create("schema-mismatch");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save readable thread");
    let path = workspace.thread_path(ROOT_KEY, "agt-thread-0001");
    let mut encoded: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("read saved thread"))
            .expect("decode saved thread");
    encoded["schemaVersion"] = json!(2);
    fs::write(&path, encoded.to_string()).expect("write future schema version");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(loaded.threads.is_empty());
    assert_eq!(loaded.unreadable.len(), 1);
    assert!(
        loaded.unreadable[0].reason.contains("schema version 2"),
        "got: {}",
        loaded.unreadable[0].reason
    );
    assert!(path.is_file(), "schema mismatches must be retained");
}

#[test]
fn a_foreign_owner_is_rejected_on_save_and_skipped_on_load() {
    let workspace = TempStore::create("owner-mismatch");
    let store = workspace.store();
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.owner.owner_id = agent_root_owner_id("/workspace/beta");

    let rejected = store
        .save(ROOT_KEY, &document)
        .expect_err("foreign owner id");

    assert_eq!(rejected, AGENT_THREAD_OWNER_MISMATCH_ERROR);

    let mut foreign = thread_document("/workspace/beta", "agt-thread-0001", 10);
    foreign.thread.thread_id = "agt-thread-0001".to_string();
    fs::create_dir_all(workspace.root_directory(ROOT_KEY)).expect("create root directory");
    fs::write(
        workspace.thread_path(ROOT_KEY, "agt-thread-0001"),
        serde_json::to_string(&foreign).expect("encode foreign document"),
    )
    .expect("write foreign document");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(loaded.threads.is_empty());
    assert_eq!(loaded.unreadable.len(), 1);
    assert_eq!(
        loaded.unreadable[0].reason,
        AGENT_THREAD_OWNER_MISMATCH_ERROR
    );
}

#[test]
fn an_oversize_document_is_rejected_before_it_reaches_the_disk() {
    let workspace = TempStore::create("oversize");
    let store = workspace.store();
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.turns = (0..MAX_AGENT_TURNS_PER_THREAD)
        .map(|index| {
            let mut turn = settled_turn(&format!("agt-turn-{index:04}"));
            turn.events = vec![AgentTurnEvent::AssistantText {
                text: "a".repeat(MAX_AGENT_EVENT_TEXT_BYTES),
            }];
            turn
        })
        .collect();

    let error = store
        .save(ROOT_KEY, &document)
        .expect_err("oversize document");

    assert!(error.contains("maximum"), "got: {error}");
    assert!(!workspace.thread_path(ROOT_KEY, "agt-thread-0001").exists());
}

#[test]
fn out_of_bounds_turn_and_event_payloads_are_rejected() {
    let workspace = TempStore::create("bounds");
    let store = workspace.store();
    let mut too_many_turns = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    too_many_turns.thread.turns = (0..=MAX_AGENT_TURNS_PER_THREAD)
        .map(|index| settled_turn(&format!("agt-turn-{index:04}")))
        .collect();
    let mut too_much_text = thread_document(ROOT_KEY, "agt-thread-0002", 10);
    too_much_text.thread.turns[0].events = vec![AgentTurnEvent::AssistantText {
        text: "a".repeat(MAX_AGENT_EVENT_TEXT_BYTES + 1),
    }];
    let mut too_long_summary = thread_document(ROOT_KEY, "agt-thread-0003", 10);
    too_long_summary.thread.turns[0].events = vec![AgentTurnEvent::ToolCall {
        tool_id: "t1".to_string(),
        name: "Bash".to_string(),
        input_summary: "a".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES + 1),
    }];
    let mut flag_like_session = thread_document(ROOT_KEY, "agt-thread-0004", 10);
    flag_like_session.thread.provider.session_id = Some("--resume-me".to_string());

    assert!(store.save(ROOT_KEY, &too_many_turns).is_err());
    assert!(store.save(ROOT_KEY, &too_much_text).is_err());
    assert!(store.save(ROOT_KEY, &too_long_summary).is_err());
    assert!(store.save(ROOT_KEY, &flag_like_session).is_err());
}

#[test]
fn eviction_removes_the_oldest_unpinned_settled_thread_first() {
    let workspace = TempStore::create("eviction-order");
    let store = workspace.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        let mut document = thread_document(ROOT_KEY, &thread_id_at(index), 100 + index as u64);
        if index == 0 {
            document.thread.pinned = true;
            document.thread.updated_at_epoch_ms = 1;
        }
        if index == 1 {
            document.thread.turns = vec![running_turn("agt-turn-0001")];
            document.thread.updated_at_epoch_ms = 2;
        }
        store.save(ROOT_KEY, &document).expect("seed thread");
    }

    store
        .save(
            ROOT_KEY,
            &thread_document(ROOT_KEY, "agt-thread-9999", 9_999),
        )
        .expect("save over the thread cap");
    let loaded = store.load(ROOT_KEY).expect("load threads");
    let retained: Vec<String> = loaded
        .threads
        .iter()
        .map(|thread| thread.thread_id.clone())
        .collect();

    assert_eq!(retained.len(), MAX_AGENT_THREADS_PER_ROOT);
    assert!(retained.contains(&thread_id_at(0)), "pinned thread evicted");
    assert!(
        retained.contains(&thread_id_at(1)),
        "running thread evicted"
    );
    assert!(
        !retained.contains(&thread_id_at(2)),
        "the oldest settled unpinned thread must be evicted first"
    );
    assert!(retained.contains(&"agt-thread-9999".to_string()));
}

#[test]
fn a_full_store_with_nothing_evictable_refuses_the_save() {
    let workspace = TempStore::create("eviction-full");
    let store = workspace.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        let mut document = thread_document(ROOT_KEY, &thread_id_at(index), 100 + index as u64);
        document.thread.pinned = true;
        store.save(ROOT_KEY, &document).expect("seed pinned thread");
    }

    let error = store
        .save(
            ROOT_KEY,
            &thread_document(ROOT_KEY, "agt-thread-9999", 9_999),
        )
        .expect_err("nothing is evictable");

    assert_eq!(error, AGENT_THREAD_STORE_FULL_ERROR);
    assert!(!workspace.thread_path(ROOT_KEY, "agt-thread-9999").exists());
}

#[test]
fn updating_a_thread_at_the_cap_does_not_evict_anything() {
    let workspace = TempStore::create("eviction-update");
    let store = workspace.store();
    for index in 0..MAX_AGENT_THREADS_PER_ROOT {
        store
            .save(
                ROOT_KEY,
                &thread_document(ROOT_KEY, &thread_id_at(index), 100 + index as u64),
            )
            .expect("seed thread");
    }

    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, &thread_id_at(0), 999))
        .expect("update the oldest thread in place");
    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.threads.len(), MAX_AGENT_THREADS_PER_ROOT);
    assert_eq!(loaded.evicted, 0);
}

#[test]
fn stray_temporary_files_are_removed_on_load() {
    let workspace = TempStore::create("stray-temp");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save thread");
    let stray = workspace
        .root_directory(ROOT_KEY)
        .join("agt-thread-0002.json.tmp-1234-0");
    fs::write(&stray, "partial").expect("write stray temp file");

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert_eq!(loaded.threads.len(), 1);
    assert!(loaded.unreadable.is_empty());
    assert!(!stray.exists(), "stray temp files must be cleaned up");
}

#[test]
fn unreadable_reports_are_bounded() {
    let workspace = TempStore::create("unreadable-bounds");
    let store = workspace.store();
    fs::create_dir_all(workspace.root_directory(ROOT_KEY)).expect("create root directory");
    for index in 0..(MAX_UNREADABLE_REPORTS + 4) {
        fs::write(
            workspace.thread_path(ROOT_KEY, &thread_id_at(index)),
            "{ nope",
        )
        .expect("write corrupt file");
    }

    let loaded = store.load(ROOT_KEY).expect("load threads");

    assert!(loaded.threads.is_empty());
    assert_eq!(loaded.unreadable.len(), MAX_UNREADABLE_REPORTS);
}

#[test]
fn delete_removes_the_file_and_is_idempotent() {
    let workspace = TempStore::create("delete");
    let store = workspace.store();
    store
        .save(ROOT_KEY, &thread_document(ROOT_KEY, "agt-thread-0001", 10))
        .expect("save thread");

    store.delete(ROOT_KEY, "agt-thread-0001").expect("delete");
    store
        .delete(ROOT_KEY, "agt-thread-0001")
        .expect("delete is idempotent");

    assert!(!workspace.thread_path(ROOT_KEY, "agt-thread-0001").exists());
    assert!(store
        .load(ROOT_KEY)
        .expect("load threads")
        .threads
        .is_empty());
}

#[test]
fn two_roots_do_not_serialise_on_the_global_lock_map() {
    let workspace = TempStore::create("parallel-roots");
    let store = Arc::new(workspace.store());
    let alpha = store.root_lock(ROOT_KEY);
    let held = alpha.lock().unwrap_or_else(PoisonError::into_inner);
    let (sender, receiver) = mpsc::channel();
    let worker_store = Arc::clone(&store);
    let worker = thread::spawn(move || {
        let outcome = worker_store.save(
            "/workspace/beta",
            &thread_document("/workspace/beta", "agt-thread-0001", 10),
        );
        let _ = sender.send(outcome);
    });

    let outcome = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("a save for another root must not wait on a held root lock");

    outcome.expect("save the other root");
    drop(held);
    worker.join().expect("join the worker");
    assert!(workspace
        .thread_path("/workspace/beta", "agt-thread-0001")
        .is_file());
}

fn document_json() -> Value {
    json!({
        "schemaVersion": 1,
        "thread": {
            "threadId": "agt-t1-0001",
            "owner": {
                "rootKey": "/workspace",
                "ownerId": "agent-root:85944171f73967e8",
                "repositoryRoot": "/repo"
            },
            "target": {
                "isolation": "worktree",
                "worktreePath": "/repo/.worktrees/agt-t1-0001"
            },
            "provider": { "kind": "codex", "sessionId": "session-0001" },
            "title": "do the thing",
            "pinned": true,
            "archived": false,
            "createdAtEpochMs": 1000,
            "updatedAtEpochMs": 2000,
            "turns": [
                {
                    "turnId": "agt-1-0a1b",
                    "prompt": "do the thing",
                    "status": { "kind": "exited", "exitCode": 0 },
                    "startedAtEpochMs": 1000,
                    "endedAtEpochMs": 2000,
                    "events": [
                        { "kind": "assistantText", "text": "hi" },
                        { "kind": "reasoning", "text": "why" },
                        { "kind": "toolCall", "toolId": "t1", "name": "Bash", "inputSummary": "ls" },
                        { "kind": "toolResult", "toolId": "t1", "outputSummary": "ok", "isError": false },
                        { "kind": "result", "text": "done", "isError": false, "usage": { "inputTokens": 1, "outputTokens": 2 } },
                        { "kind": "result", "text": "", "isError": true, "usage": null },
                        { "kind": "error", "message": "e" },
                        { "kind": "unknownLine", "stream": "stderr", "raw": "raw", "clipped": true }
                    ],
                    "eventsTruncated": true,
                    "lastStatusSequence": 3,
                    "lastOutputSequence": 7,
                    "launch": null,
                    "cliVersion": null
                },
                {
                    "turnId": "agt-2-0a1b",
                    "prompt": "again",
                    "status": { "kind": "failed", "message": "boom" },
                    "startedAtEpochMs": 1500,
                    "endedAtEpochMs": null,
                    "events": [],
                    "eventsTruncated": false,
                    "lastStatusSequence": 0,
                    "lastOutputSequence": 0,
                    "launch": null,
                    "cliVersion": null
                },
                {
                    "turnId": "agt-3-0a1b",
                    "prompt": "again",
                    "status": { "kind": "interrupted" },
                    "startedAtEpochMs": 1600,
                    "endedAtEpochMs": null,
                    "events": [],
                    "eventsTruncated": false,
                    "lastStatusSequence": 0,
                    "lastOutputSequence": 0,
                    "launch": null,
                    "cliVersion": null
                }
            ],
            "turnsTruncated": false,
            "integration": null,
            "viewedAtEpochMs": null
        }
    })
}

#[test]
fn a_pre_launch_document_loads_with_absent_launch_and_viewed_at() {
    let mut source = document_json();
    let thread = source
        .get_mut("thread")
        .and_then(serde_json::Value::as_object_mut)
        .expect("thread object");
    thread.remove("viewedAtEpochMs");
    for turn in thread
        .get_mut("turns")
        .and_then(serde_json::Value::as_array_mut)
        .expect("turns array")
    {
        turn.as_object_mut().expect("turn object").remove("launch");
    }

    let document: AgentThreadDocument =
        serde_json::from_value(source).expect("v1 document still loads");

    assert_eq!(document.thread.viewed_at_epoch_ms, None);
    assert!(document
        .thread
        .turns
        .iter()
        .all(|turn| turn.launch.is_none()));
}

#[test]
fn a_pre_cli_version_document_loads_with_an_absent_cli_version() {
    let mut source = document_json();
    for turn in source
        .pointer_mut("/thread/turns")
        .and_then(serde_json::Value::as_array_mut)
        .expect("turns array")
    {
        turn.as_object_mut()
            .expect("turn object")
            .remove("cliVersion");
    }

    let document: AgentThreadDocument =
        serde_json::from_value(source).expect("pre-cli-version document still loads");

    assert!(document
        .thread
        .turns
        .iter()
        .all(|turn| turn.cli_version.is_none()));
}

#[test]
fn a_cli_version_stamped_document_round_trips_and_is_bounds_checked() {
    let mut source = document_json();
    source["thread"]["owner"]["ownerId"] = json!(agent_root_owner_id("/workspace"));
    source["thread"]["turns"][0]["cliVersion"] = json!("2.1.245");

    let document: AgentThreadDocument =
        serde_json::from_value(source.clone()).expect("stamped document loads");

    assert_eq!(
        document.thread.turns[0].cli_version.as_deref(),
        Some("2.1.245")
    );
    assert_eq!(
        serde_json::to_value(&document).expect("serialize document"),
        source
    );
    validate_agent_thread_document("/workspace", &document)
        .expect("a bounded cli version is accepted");

    for rejected in [
        String::new(),
        "garbage".to_string(),
        "2.1.245 (Claude Code)".to_string(),
        "v2.1.245".to_string(),
        "9".repeat(65),
    ] {
        let mut invalid = document.clone();
        invalid.thread.turns[0].cli_version = Some(rejected.clone());

        assert!(
            validate_agent_thread_document("/workspace", &invalid).is_err(),
            "cli version {rejected:?} must be refused"
        );
    }
}

#[test]
fn a_document_with_an_unknown_launch_mode_is_refused_by_the_contract() {
    let mut source = document_json();
    let turn = source
        .pointer_mut("/thread/turns/0")
        .and_then(serde_json::Value::as_object_mut)
        .expect("first turn");
    turn.insert(
        "launch".to_string(),
        serde_json::json!({ "provider": "codex", "model": "default", "mode": "yolo" }),
    );

    assert!(serde_json::from_value::<AgentThreadDocument>(source).is_err());
}

#[test]
fn a_launch_stamped_document_round_trips_both_new_fields() {
    let mut source = document_json();
    let thread = source
        .get_mut("thread")
        .and_then(serde_json::Value::as_object_mut)
        .expect("thread object");
    thread.insert("viewedAtEpochMs".to_string(), serde_json::json!(2500));
    thread
        .get_mut("turns")
        .and_then(serde_json::Value::as_array_mut)
        .expect("turns array")[0]
        .as_object_mut()
        .expect("turn object")
        .insert(
            "launch".to_string(),
            serde_json::json!({
                "provider": "codex",
                "model": "gpt-5.5",
                "mode": "workspaceWrite"
            }),
        );

    let document: AgentThreadDocument =
        serde_json::from_value(source.clone()).expect("stamped document loads");

    assert_eq!(document.thread.viewed_at_epoch_ms, Some(2500));
    assert_eq!(
        document.thread.turns[0].launch,
        Some(AgentLaunchOptions::Codex {
            model: crate::agent_task_spawner::agent_launch::CodexModelChoice::Gpt55,
            mode: crate::agent_task_spawner::agent_launch::CodexExecutionMode::WorkspaceWrite,
        })
    );
    assert_eq!(
        serde_json::to_value(&document).expect("serialize document"),
        source
    );
}

#[test]
fn agent_thread_document_round_trips_the_exact_wire_shape() {
    let source = document_json();
    let document: AgentThreadDocument =
        serde_json::from_value(source.clone()).expect("deserialize document");
    assert_eq!(document.schema_version, AGENT_THREAD_SCHEMA_VERSION);
    assert_eq!(document.thread.turns.len(), 3);
    assert_eq!(
        document.thread.provider.session_id.as_deref(),
        Some("session-0001")
    );
    assert!(matches!(
        document.thread.turns[0].status,
        AgentTurnStatus::Exited { exit_code: 0 }
    ));
    assert!(document.thread.turns[2].status.is_terminal());
    assert!(matches!(
        document.thread.turns[0].events[7],
        AgentTurnEvent::UnknownLine {
            stream: AgentOutputStream::Stderr,
            clipped: true,
            ..
        }
    ));
    let reserialized = serde_json::to_value(&document).expect("serialize document");
    assert_eq!(reserialized, source);
}

#[test]
fn an_absent_integration_receipt_parses_as_none() {
    let mut without_integration = document_json();
    without_integration["thread"]
        .as_object_mut()
        .expect("thread object")
        .remove("integration");

    let document: AgentThreadDocument =
        serde_json::from_value(without_integration).expect("deserialize document");

    assert_eq!(document.thread.integration, None);
}

#[test]
fn a_populated_integration_receipt_round_trips_and_is_bounds_checked() {
    let mut source = document_json();
    source["thread"]["owner"]["ownerId"] = json!(agent_root_owner_id("/workspace"));
    source["thread"]["integration"] = json!({
        "lastCommitSha": "0123456789abcdef0123456789abcdef01234567",
        "pushed": { "remote": "origin", "branch": "agent/agt-t1-0001" },
        "integrated": {
            "intoBranch": "main",
            "mergeSha": "89abcdef0123456789abcdef0123456789abcdef",
            "mode": "fastForward"
        },
        "branchDeleted": true
    });
    let document: AgentThreadDocument =
        serde_json::from_value(source.clone()).expect("deserialize document");
    let reserialized = serde_json::to_value(&document).expect("serialize document");

    assert_eq!(reserialized, source);
    validate_agent_thread_document("/workspace", &document).expect("bounded receipt");

    let mut bad_sha = source.clone();
    bad_sha["thread"]["integration"]["lastCommitSha"] = json!("nope");
    let bad_document: AgentThreadDocument =
        serde_json::from_value(bad_sha).expect("deserialize document");

    assert_eq!(
        validate_agent_thread_document("/workspace", &bad_document)
            .expect_err("malformed object id must be refused"),
        AGENT_THREAD_INTEGRATION_OBJECT_ID_ERROR
    );

    let mut unknown_field = source;
    unknown_field["thread"]["integration"]["extra"] = json!(1);

    assert!(serde_json::from_value::<AgentThreadDocument>(unknown_field).is_err());
}

#[test]
fn agent_thread_document_rejects_unknown_fields_everywhere() {
    let mut with_top_level = document_json();
    with_top_level["extra"] = json!(1);
    assert!(serde_json::from_value::<AgentThreadDocument>(with_top_level).is_err());

    let mut with_status = document_json();
    with_status["thread"]["turns"][0]["status"]["extra"] = json!(1);
    assert!(serde_json::from_value::<AgentThreadDocument>(with_status).is_err());

    let mut with_event = document_json();
    with_event["thread"]["turns"][0]["events"][0]["extra"] = json!(1);
    assert!(serde_json::from_value::<AgentThreadDocument>(with_event).is_err());

    let mut with_unknown_kind = document_json();
    with_unknown_kind["thread"]["turns"][0]["events"][0]["kind"] = json!("magic");
    assert!(serde_json::from_value::<AgentThreadDocument>(with_unknown_kind).is_err());

    let mut with_unknown_status = document_json();
    with_unknown_status["thread"]["turns"][0]["status"] = json!({ "kind": "paused" });
    assert!(serde_json::from_value::<AgentThreadDocument>(with_unknown_status).is_err());
}

#[test]
fn fnv1a64hex_matches_the_typescript_port() {
    assert_eq!(fnv1a64hex(""), "cbf29ce484222325");
    assert_eq!(fnv1a64hex("a"), "af63dc4c8601ec8c");
    assert_eq!(fnv1a64hex("foobar"), "85944171f73967e8");
    assert_eq!(agent_root_owner_id("foobar"), "agent-root:85944171f73967e8");
}
