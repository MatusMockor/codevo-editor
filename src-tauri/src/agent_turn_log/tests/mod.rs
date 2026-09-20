use super::agent_thread_store::{agent_root_owner_id, fnv1a64hex, AgentTurnEvent};
use super::errors::AgentTurnLogError;
use super::paths::{AGENT_TURN_LOG_DIR_NAME, AGENT_TURN_LOG_VERSION_DIR};
use super::wire::{
    AgentTurnLogAnchor, AgentTurnLogAnchorAt, AgentTurnLogEntry, AgentTurnLogLoss,
    AgentTurnLogLossKind, AgentTurnLogScope, AppendAgentTurnLogRequest,
    DeleteAgentThreadLogRequest, OpenAgentTurnLogRequest, ReadAgentTurnLogPageRequest,
    SummarizeAgentTurnLogsRequest, AGENT_TURN_LOG_SEQ_BASE,
};
use super::AgentTurnLogStore;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

mod bench;
mod contract_tests;
mod delete_tests;
mod error_contract_tests;
mod loader_interop_tests;
mod metadata_tests;
mod migration_tests;
mod page_tests;
mod quarantine_tests;
mod readonly_tests;
mod safety_tests;
mod store_tests;

pub(super) const ROOT_KEY: &str = "/workspace/alpha";
pub(super) const THREAD_ID: &str = "agt-thread-0001";
pub(super) const TURN_ID: &str = "agt-turn-0001";

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct TempLogStore {
    pub(super) base: PathBuf,
}

impl TempLogStore {
    pub(super) fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!(
            "agent-turn-log-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("create temp base directory");
        Self { base }
    }

    pub(super) fn store(&self) -> AgentTurnLogStore {
        AgentTurnLogStore::new(self.base.clone())
    }

    pub(super) fn root_directory(&self) -> PathBuf {
        self.base
            .join(AGENT_TURN_LOG_DIR_NAME)
            .join(AGENT_TURN_LOG_VERSION_DIR)
            .join(fnv1a64hex(ROOT_KEY))
    }

    pub(super) fn database(&self) -> PathBuf {
        self.root_directory().join(format!("{THREAD_ID}.sqlite3"))
    }

    pub(super) fn write_thread_document(&self, root_key: &str) {
        let directory = self.base.join("agent-threads").join(fnv1a64hex(root_key));
        fs::create_dir_all(&directory).expect("create thread directory");
        let document = json!({
            "schemaVersion": 1,
            "thread": {
                "threadId": THREAD_ID,
                "owner": {
                    "rootKey": root_key,
                    "ownerId": agent_root_owner_id(root_key),
                    "repositoryRoot": "/workspace/alpha"
                },
                "target": { "isolation": "in-place", "worktreePath": null },
                "provider": { "kind": "claudeCode", "sessionId": null },
                "title": "do the thing",
                "pinned": false,
                "archived": false,
                "createdAtEpochMs": 1,
                "updatedAtEpochMs": 2,
                "turns": [],
                "turnsTruncated": false
            }
        });
        fs::write(
            directory.join(format!("{THREAD_ID}.json")),
            document.to_string(),
        )
        .expect("write thread document");
    }
}

impl Drop for TempLogStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

pub(super) fn scope(turn_id: &str) -> AgentTurnLogScope {
    AgentTurnLogScope {
        root_key: ROOT_KEY.to_string(),
        owner_id: agent_root_owner_id(ROOT_KEY),
        thread_id: THREAD_ID.to_string(),
        turn_id: turn_id.to_string(),
    }
}

pub(super) fn text_event(text: &str) -> AgentTurnEvent {
    AgentTurnEvent::AssistantText {
        text: text.to_string(),
        parent_tool_id: None,
    }
}

pub(super) fn entry(seq: i64, text: &str) -> AgentTurnLogEntry {
    AgentTurnLogEntry {
        seq,
        event: text_event(text),
    }
}

pub(super) fn loss(kind: AgentTurnLogLossKind) -> AgentTurnLogLoss {
    AgentTurnLogLoss::of(kind)
}

pub(super) fn tail() -> AgentTurnLogAnchor {
    AgentTurnLogAnchor {
        at: AgentTurnLogAnchorAt::Tail,
        seq: None,
    }
}

pub(super) fn anchored(at: AgentTurnLogAnchorAt, seq: i64) -> AgentTurnLogAnchor {
    AgentTurnLogAnchor { at, seq: Some(seq) }
}

pub(super) fn open_request(turn_id: &str) -> OpenAgentTurnLogRequest {
    OpenAgentTurnLogRequest {
        scope: scope(turn_id),
        prior_loss: loss(AgentTurnLogLossKind::None),
        prompt: None,
    }
}

pub(super) fn prompted_open_request(turn_id: &str, prompt: &str) -> OpenAgentTurnLogRequest {
    OpenAgentTurnLogRequest {
        scope: scope(turn_id),
        prior_loss: loss(AgentTurnLogLossKind::None),
        prompt: Some(prompt.to_string()),
    }
}

pub(super) fn append_request(
    turn_id: &str,
    writer_epoch: i64,
    expected_next_seq: i64,
    ops: Vec<AgentTurnLogEntry>,
) -> AppendAgentTurnLogRequest {
    AppendAgentTurnLogRequest {
        scope: scope(turn_id),
        writer_epoch,
        expected_next_seq,
        ops,
        digest: None,
        seal: false,
        loss: loss(AgentTurnLogLossKind::None),
        lifecycle: None,
    }
}

pub(super) fn lifecycle_append_request(
    turn_id: &str,
    writer_epoch: i64,
    expected_next_seq: i64,
    ops: Vec<AgentTurnLogEntry>,
    lifecycle: Value,
) -> AppendAgentTurnLogRequest {
    AppendAgentTurnLogRequest {
        lifecycle: Some(lifecycle),
        ..append_request(turn_id, writer_epoch, expected_next_seq, ops)
    }
}

pub(super) fn retained_lifecycle() -> Value {
    json!({
        "entries": [
            {
                "batchKey": "spawn:toolu_parent",
                "description": "Running npx vitest run",
                "durationMs": 76099,
                "id": "tool:toolu_parent",
                "lastToolName": "Bash",
                "name": "general-purpose",
                "nestedCount": 1,
                "state": "running",
                "steps": 31,
                "taskId": "task-parent",
                "taskTitle": "Fix subagent view findings",
                "telemetryState": "running",
                "toolId": "toolu_parent",
                "totalTokens": 87253
            },
            {
                "description": "Review slice fixes",
                "id": "tool:toolu_nested",
                "name": "Agent",
                "parentToolId": "toolu_parent",
                "state": "running",
                "taskTitle": "Review slice fixes",
                "toolId": "toolu_nested"
            }
        ],
        "countedNestedToolIds": ["toolu_nested_overflow"],
        "openBatchKey": "spawn:toolu_parent",
        "truncated": false
    })
}

pub(super) fn large_lifecycle() -> Value {
    lifecycle_of(&"\u{1}".repeat(512), None)
}

pub(super) fn oversized_lifecycle() -> Value {
    lifecycle_of(&"\u{1}".repeat(512), Some(&"\u{1}".repeat(480)))
}

fn lifecycle_of(description: &str, task_title: Option<&str>) -> Value {
    let entries: Vec<Value> = (0..32)
        .map(|index| {
            let mut entry = json!({
                "id": format!("tool:toolu_{index:02}"),
                "toolId": format!("toolu_{index:02}"),
                "name": "general-purpose",
                "description": description,
                "state": "running"
            });
            if let Some(task_title) = task_title {
                entry["taskTitle"] = json!(task_title);
            }
            entry
        })
        .collect();
    json!({ "entries": entries, "truncated": false })
}

pub(super) fn legacy_lifecycle(tag: &str) -> Value {
    json!({
        "entries": [
            {
                "description": "Running grep -n export src/domain/example.ts",
                "id": format!("tool:{tag}"),
                "name": "general-purpose",
                "resultState": "completed",
                "state": "completed",
                "telemetryState": "completed",
                "toolId": tag
            }
        ],
        "truncated": false
    })
}

pub(super) fn page_request(
    turn_id: &str,
    anchor: AgentTurnLogAnchor,
    max_events: u32,
    max_bytes: u32,
) -> ReadAgentTurnLogPageRequest {
    ReadAgentTurnLogPageRequest {
        scope: scope(turn_id),
        anchor,
        max_events,
        max_bytes,
    }
}

pub(super) fn summarize_request() -> SummarizeAgentTurnLogsRequest {
    summarize_with(false, false)
}

pub(super) fn prompted_summarize_request(include_prompts: bool) -> SummarizeAgentTurnLogsRequest {
    summarize_with(include_prompts, false)
}

pub(super) fn lifecycle_summarize_request(
    include_lifecycles: bool,
) -> SummarizeAgentTurnLogsRequest {
    summarize_with(false, include_lifecycles)
}

fn summarize_with(
    include_prompts: bool,
    include_lifecycles: bool,
) -> SummarizeAgentTurnLogsRequest {
    SummarizeAgentTurnLogsRequest {
        turn_id: None,
        root_key: ROOT_KEY.to_string(),
        owner_id: agent_root_owner_id(ROOT_KEY),
        thread_id: THREAD_ID.to_string(),
        include_prompts,
        include_lifecycles,
    }
}

pub(super) fn delete_request() -> DeleteAgentThreadLogRequest {
    DeleteAgentThreadLogRequest {
        root_key: ROOT_KEY.to_string(),
        owner_id: agent_root_owner_id(ROOT_KEY),
        thread_id: THREAD_ID.to_string(),
    }
}

pub(super) fn sidecar(database: &std::path::Path, suffix: &str) -> PathBuf {
    let mut name = database.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub(super) fn file_names(directory: &std::path::Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

pub(super) fn seed(store: &AgentTurnLogStore, turn_id: &str, count: i64) -> i64 {
    let lease = store.open(&open_request(turn_id)).expect("open lease");
    let ops = (AGENT_TURN_LOG_SEQ_BASE..AGENT_TURN_LOG_SEQ_BASE + count)
        .map(|seq| entry(seq, &format!("event {seq}")))
        .collect();
    store
        .append(&append_request(
            turn_id,
            lease.writer_epoch,
            AGENT_TURN_LOG_SEQ_BASE,
            ops,
        ))
        .expect("seed events");
    lease.writer_epoch
}

pub(super) fn code(error: AgentTurnLogError) -> &'static str {
    error.code()
}
