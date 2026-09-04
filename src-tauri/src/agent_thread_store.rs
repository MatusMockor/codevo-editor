use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use crate::agent_task_spawner::agent_provider::agent_cli_version::parse_agent_cli_version;
use crate::agent_task_spawner::{
    validate_resume_session_id, AgentCliInvocation, MAX_AGENT_PROMPT_BYTES,
};
use crate::agent_task_supervisor::AgentTaskIsolation;
use crate::git_worktree::safe_agent_task_id;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub const AGENT_THREAD_SCHEMA_VERSION: u32 = 1;
pub const MAX_AGENT_THREADS_PER_ROOT: usize = 64;
pub const MAX_AGENT_TURNS_PER_THREAD: usize = 64;
pub const MAX_AGENT_EVENTS_PER_TURN: usize = 512;
pub const MAX_AGENT_EVENT_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_AGENT_TOOL_SUMMARY_BYTES: usize = 512;
pub const MAX_AGENT_THREAD_TITLE_BYTES: usize = 256;
pub const MAX_AGENT_THREAD_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_AGENT_THREAD_ROOT_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_AGENT_STREAM_METRIC_BYTES: u64 = 9_007_199_254_740_991;
pub const MAX_UNREADABLE_REPORTS: usize = 16;
pub const MAX_AGENT_INTEGRATION_REF_BYTES: usize = 512;
pub const MAX_AGENT_EXTERNAL_HISTORY_EXCHANGES: usize = 256;
pub const MAX_AGENT_EXTERNAL_HISTORY_BYTES: usize = 128 * 1024;

pub const AGENT_THREAD_INTEGRATION_OBJECT_ID_ERROR: &str =
    "Agent thread integration object ids must be 40 lowercase hexadecimal characters.";
pub const AGENT_THREAD_INTEGRATION_REF_ERROR: &str =
    "Agent thread integration remote or branch name is out of bounds.";
pub const AGENT_THREAD_EXTERNAL_ORIGIN_PROVIDER_ERROR: &str =
    "Agent thread external origin provider must match the thread provider.";

const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV1A_64_PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadDocument {
    pub schema_version: u32,
    pub thread: AgentThread,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThread {
    pub thread_id: String,
    pub owner: AgentThreadOwner,
    pub target: AgentThreadTarget,
    pub provider: AgentProviderSession,
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    pub created_at_epoch_ms: u64,
    pub updated_at_epoch_ms: u64,
    pub turns: Vec<AgentTurn>,
    pub turns_truncated: bool,
    #[serde(default)]
    pub integration: Option<AgentThreadIntegration>,
    #[serde(default)]
    pub viewed_at_epoch_ms: Option<u64>,
    #[serde(default)]
    pub external_origin: Option<AgentThreadExternalOrigin>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadExternalOrigin {
    pub provider: AgentCliInvocation,
    pub session_id: String,
    pub imported_at_epoch_ms: u64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_external_history"
    )]
    pub history: Option<AgentThreadExternalHistory>,
}

fn deserialize_external_history<'de, D>(
    deserializer: D,
) -> Result<Option<AgentThreadExternalHistory>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    AgentThreadExternalHistory::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadExternalHistory {
    pub provider: AgentCliInvocation,
    pub session_id: String,
    pub exchanges: Vec<AgentThreadExternalExchange>,
    pub exchanges_truncated: bool,
    pub total_preview_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadExternalExchange {
    pub role: AgentThreadExternalExchangeRole,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentThreadExternalExchangeRole {
    User,
    Assistant,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentIntegrationMode {
    FastForward,
    Merge,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadPushReceipt {
    pub remote: String,
    pub branch: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadIntegrationReceipt {
    pub into_branch: String,
    pub merge_sha: String,
    pub mode: AgentIntegrationMode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadIntegration {
    pub last_commit_sha: Option<String>,
    pub pushed: Option<AgentThreadPushReceipt>,
    pub integrated: Option<AgentThreadIntegrationReceipt>,
    pub branch_deleted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadOwner {
    pub root_key: String,
    pub owner_id: String,
    pub repository_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentThreadTarget {
    pub isolation: AgentTaskIsolation,
    pub worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProviderSession {
    pub kind: AgentCliInvocation,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurn {
    pub turn_id: String,
    pub prompt: String,
    pub status: AgentTurnStatus,
    pub started_at_epoch_ms: u64,
    pub ended_at_epoch_ms: Option<u64>,
    pub events: Vec<AgentTurnEvent>,
    pub events_truncated: bool,
    pub last_status_sequence: u64,
    pub last_output_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_metrics: Option<AgentTurnStreamMetrics>,
    #[serde(default)]
    pub launch: Option<AgentLaunchOptions>,
    #[serde(default)]
    pub cli_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnStreamMetrics {
    pub received_utf8_bytes: u64,
    pub complete: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentTurnStatus {
    Pending,
    Running,
    #[serde(rename_all = "camelCase")]
    Exited {
        exit_code: i32,
    },
    Failed {
        message: String,
    },
    Stopped,
    Interrupted,
}

impl AgentTurnStatus {
    pub fn is_terminal(&self) -> bool {
        !matches!(self, Self::Pending | Self::Running)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentTurnEvent {
    AssistantText {
        text: String,
    },
    Reasoning {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        tool_id: String,
        name: String,
        input_summary: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_id: String,
        output_summary: String,
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    Result {
        text: String,
        is_error: bool,
        usage: Option<AgentTurnUsage>,
    },
    Error {
        message: String,
    },
    UnknownLine {
        stream: AgentOutputStream,
        raw: String,
        clipped: bool,
    },
}

pub fn fnv1a64hex(value: &str) -> String {
    let mut hash = FNV1A_64_OFFSET_BASIS;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV1A_64_PRIME);
    }
    format!("{hash:016x}")
}

pub fn agent_root_owner_id(root_key: &str) -> String {
    format!("agent-root:{}", fnv1a64hex(root_key))
}

pub const AGENT_THREAD_STORE_DIR_NAME: &str = "agent-threads";
pub const MAX_AGENT_ROOT_KEY_BYTES: usize = 4096;
pub const MAX_AGENT_REPOSITORY_ROOT_BYTES: usize = 4096;
pub const AGENT_THREAD_STORE_FULL_ERROR: &str =
    "The agent thread store is full and no saved thread can be evicted.";
pub const AGENT_THREAD_OWNER_MISMATCH_ERROR: &str =
    "The saved thread belongs to another agent project root.";

const MAX_AGENT_THREAD_DIRECTORY_ENTRIES: usize = 1024;
const MAX_UNREADABLE_REASON_BYTES: usize = 200;
const MAX_TRACKED_ROOT_LOCKS: usize = 256;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableAgentThread {
    pub thread_id: String,
    pub reason: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct AgentThreadLoadResult {
    pub threads: Vec<AgentThread>,
    pub unreadable: Vec<UnreadableAgentThread>,
    pub evicted: usize,
}

#[derive(Clone, Debug)]
struct StoredThreadFile {
    thread_id: String,
    path: PathBuf,
    size: u64,
    updated_at_epoch_ms: u64,
    evictable: bool,
}

pub struct AgentThreadStore {
    base_dir: PathBuf,
    root_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    temp_nonce: AtomicU64,
}

impl AgentThreadStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            root_locks: Mutex::new(HashMap::new()),
            temp_nonce: AtomicU64::new(0),
        }
    }

    pub fn load(&self, root_key: &str) -> Result<AgentThreadLoadResult, String> {
        let directory = self.root_directory(root_key)?;
        let lock = self.root_lock(root_key);
        let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let entries = root_directory_entries(&directory)?;
        let mut stored = Vec::new();
        let mut threads = HashMap::new();
        let mut unreadable = Vec::new();
        let mut unreadable_count = 0;
        let mut unreadable_bytes = 0;
        for entry in entries {
            match read_thread_file(root_key, &entry) {
                Ok(thread) => {
                    stored.push(StoredThreadFile {
                        thread_id: entry.thread_id.clone(),
                        path: entry.path,
                        size: entry.size,
                        updated_at_epoch_ms: thread.updated_at_epoch_ms,
                        evictable: thread_is_evictable(&thread),
                    });
                    threads.insert(entry.thread_id, thread);
                }
                Err(reason) => {
                    unreadable_count += 1;
                    unreadable_bytes += entry.size;
                    if unreadable.len() < MAX_UNREADABLE_REPORTS {
                        unreadable.push(UnreadableAgentThread {
                            thread_id: entry.thread_id,
                            reason: clip_utf8(&reason, MAX_UNREADABLE_REASON_BYTES),
                        });
                    }
                }
            }
        }
        let (evicted, _) = evict_to_budget(&mut stored, unreadable_count, unreadable_bytes);
        let mut retained: Vec<AgentThread> = stored
            .iter()
            .filter_map(|file| threads.remove(&file.thread_id))
            .collect();
        retained.sort_by(|left, right| {
            left.updated_at_epoch_ms
                .cmp(&right.updated_at_epoch_ms)
                .then_with(|| left.thread_id.cmp(&right.thread_id))
        });
        Ok(AgentThreadLoadResult {
            threads: retained,
            unreadable,
            evicted,
        })
    }

    pub fn save(&self, root_key: &str, document: &AgentThreadDocument) -> Result<(), String> {
        validate_agent_thread_document(root_key, document)?;
        let thread_id = safe_agent_task_id(&document.thread.thread_id)?;
        let payload = serde_json::to_vec(document)
            .map_err(|error| format!("Unable to encode the agent thread: {error}"))?;
        if payload.len() > MAX_AGENT_THREAD_FILE_BYTES {
            return Err(format!(
                "The agent thread exceeds the maximum of {MAX_AGENT_THREAD_FILE_BYTES} bytes."
            ));
        }
        let directory = self.root_directory(root_key)?;
        let lock = self.root_lock(root_key);
        let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        create_private_directory(&directory)?;
        let mut stored: Vec<StoredThreadFile> = root_directory_entries(&directory)?
            .into_iter()
            .filter(|entry| entry.thread_id != thread_id)
            .map(|entry| StoredThreadFile {
                thread_id: entry.thread_id,
                path: entry.path,
                size: entry.size,
                updated_at_epoch_ms: 0,
                evictable: false,
            })
            .collect();
        let incoming_bytes = payload.len() as u64;
        if over_budget(stored.len() + 1, stored_bytes(&stored) + incoming_bytes) {
            classify_evictable(root_key, &mut stored);
            let (_, within_budget) = evict_to_budget(&mut stored, 1, incoming_bytes);
            if !within_budget {
                return Err(AGENT_THREAD_STORE_FULL_ERROR.to_string());
            }
        }
        write_thread_file_atomically(
            &directory.join(format!("{thread_id}.json")),
            &payload,
            self.temp_nonce.fetch_add(1, Ordering::SeqCst),
        )
    }

    pub fn delete(&self, root_key: &str, thread_id: &str) -> Result<(), String> {
        let thread_id = safe_agent_task_id(thread_id)?;
        let directory = self.root_directory(root_key)?;
        let lock = self.root_lock(root_key);
        let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        match fs::remove_file(directory.join(format!("{thread_id}.json"))) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Unable to delete the saved thread: {error}")),
        }
    }

    fn root_directory(&self, root_key: &str) -> Result<PathBuf, String> {
        ensure_root_key_bounds(root_key)?;
        Ok(self
            .base_dir
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(root_key)))
    }

    fn root_lock(&self, root_key: &str) -> Arc<Mutex<()>> {
        let mut locks = self
            .root_locks
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if locks.len() >= MAX_TRACKED_ROOT_LOCKS {
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        }
        Arc::clone(
            locks
                .entry(root_key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }
}

pub fn validate_agent_thread_document(
    root_key: &str,
    document: &AgentThreadDocument,
) -> Result<(), String> {
    ensure_root_key_bounds(root_key)?;
    if document.schema_version != AGENT_THREAD_SCHEMA_VERSION {
        return Err(format!(
            "Agent thread schema version {} is not supported.",
            document.schema_version
        ));
    }
    let thread = &document.thread;
    safe_agent_task_id(&thread.thread_id)?;
    if thread.owner.root_key != root_key {
        return Err(AGENT_THREAD_OWNER_MISMATCH_ERROR.to_string());
    }
    if thread.owner.owner_id != agent_root_owner_id(root_key) {
        return Err(AGENT_THREAD_OWNER_MISMATCH_ERROR.to_string());
    }
    if thread.owner.repository_root.is_empty()
        || thread.owner.repository_root.len() > MAX_AGENT_REPOSITORY_ROOT_BYTES
    {
        return Err("Agent thread repository root is out of bounds.".to_string());
    }
    if thread
        .target
        .worktree_path
        .as_ref()
        .is_some_and(|path| path.is_empty() || path.len() > MAX_AGENT_REPOSITORY_ROOT_BYTES)
    {
        return Err("Agent thread worktree path is out of bounds.".to_string());
    }
    if thread.title.len() > MAX_AGENT_THREAD_TITLE_BYTES {
        return Err("Agent thread title exceeds the supported length.".to_string());
    }
    if let Some(session_id) = thread.provider.session_id.as_deref() {
        validate_resume_session_id(session_id)?;
    }
    if thread.turns.len() > MAX_AGENT_TURNS_PER_THREAD {
        return Err(format!(
            "Agent thread exceeds the maximum of {MAX_AGENT_TURNS_PER_THREAD} turns."
        ));
    }
    if let Some(integration) = thread.integration.as_ref() {
        validate_agent_thread_integration(integration)?;
    }
    if let Some(origin) = thread.external_origin.as_ref() {
        validate_agent_thread_external_origin(origin, thread.provider.kind)?;
    }
    for turn in &thread.turns {
        validate_agent_turn(turn)?;
    }
    Ok(())
}

fn validate_agent_thread_external_origin(
    origin: &AgentThreadExternalOrigin,
    provider_kind: AgentCliInvocation,
) -> Result<(), String> {
    if origin.provider != provider_kind {
        return Err(AGENT_THREAD_EXTERNAL_ORIGIN_PROVIDER_ERROR.to_string());
    }
    validate_resume_session_id(&origin.session_id)?;
    if let Some(history) = origin.history.as_ref() {
        if history.provider != origin.provider || history.session_id != origin.session_id {
            return Err("Agent thread external history must match its origin.".to_string());
        }
        if history.exchanges.len() > MAX_AGENT_EXTERNAL_HISTORY_EXCHANGES {
            return Err("Agent thread external history has too many exchanges.".to_string());
        }
        let mut total_bytes = 0;
        for exchange in &history.exchanges {
            if exchange.text.len() > MAX_AGENT_EVENT_TEXT_BYTES
                || exchange.text.chars().any(|character| {
                    character.is_control() && character != '\n' && character != '\t'
                })
            {
                return Err("Agent thread external history text is out of bounds.".to_string());
            }
            total_bytes += exchange.text.len();
        }
        if total_bytes > MAX_AGENT_EXTERNAL_HISTORY_BYTES
            || history.total_preview_bytes != total_bytes as u64
        {
            return Err("Agent thread external history byte count is out of bounds.".to_string());
        }
    }
    Ok(())
}

fn validate_agent_thread_integration(integration: &AgentThreadIntegration) -> Result<(), String> {
    if let Some(sha) = integration.last_commit_sha.as_deref() {
        ensure_agent_object_id(sha)?;
    }
    if let Some(pushed) = integration.pushed.as_ref() {
        ensure_agent_integration_ref(&pushed.remote)?;
        ensure_agent_integration_ref(&pushed.branch)?;
    }
    if let Some(integrated) = integration.integrated.as_ref() {
        ensure_agent_integration_ref(&integrated.into_branch)?;
        ensure_agent_object_id(&integrated.merge_sha)?;
    }
    Ok(())
}

fn ensure_agent_object_id(candidate: &str) -> Result<(), String> {
    if candidate.len() != 40
        || !candidate
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
    {
        return Err(AGENT_THREAD_INTEGRATION_OBJECT_ID_ERROR.to_string());
    }

    Ok(())
}

fn ensure_agent_integration_ref(candidate: &str) -> Result<(), String> {
    if candidate.is_empty()
        || candidate.len() > MAX_AGENT_INTEGRATION_REF_BYTES
        || candidate.chars().any(char::is_control)
    {
        return Err(AGENT_THREAD_INTEGRATION_REF_ERROR.to_string());
    }

    Ok(())
}

fn validate_agent_turn(turn: &AgentTurn) -> Result<(), String> {
    safe_agent_task_id(&turn.turn_id)?;
    if turn.prompt.len() > MAX_AGENT_PROMPT_BYTES {
        return Err("Agent turn prompt exceeds the supported length.".to_string());
    }
    if turn.events.len() > MAX_AGENT_EVENTS_PER_TURN {
        return Err(format!(
            "Agent turn exceeds the maximum of {MAX_AGENT_EVENTS_PER_TURN} events."
        ));
    }
    for event in &turn.events {
        validate_agent_turn_event(event)?;
    }
    if turn
        .stream_metrics
        .as_ref()
        .is_some_and(|metrics| metrics.received_utf8_bytes > MAX_AGENT_STREAM_METRIC_BYTES)
    {
        return Err("Agent turn stream metrics exceed the supported byte count.".to_string());
    }
    validate_agent_turn_cli_version(turn.cli_version.as_deref())?;
    Ok(())
}

fn validate_agent_turn_cli_version(cli_version: Option<&str>) -> Result<(), String> {
    let Some(cli_version) = cli_version else {
        return Ok(());
    };
    if parse_agent_cli_version(cli_version).as_deref() != Some(cli_version) {
        return Err("Agent turn CLI version is not a supported version string.".to_string());
    }
    Ok(())
}

fn validate_agent_turn_event(event: &AgentTurnEvent) -> Result<(), String> {
    let (text_bytes, summary_bytes) = match event {
        AgentTurnEvent::AssistantText { text } | AgentTurnEvent::Reasoning { text } => {
            (text.len(), 0)
        }
        AgentTurnEvent::ToolCall {
            tool_id,
            name,
            input_summary,
        } => (0, tool_id.len().max(name.len()).max(input_summary.len())),
        AgentTurnEvent::ToolResult {
            tool_id,
            output_summary,
            ..
        } => (0, tool_id.len().max(output_summary.len())),
        AgentTurnEvent::Result { text, .. } => (text.len(), 0),
        AgentTurnEvent::Error { message } => (message.len(), 0),
        AgentTurnEvent::UnknownLine { raw, .. } => (raw.len(), 0),
    };
    if text_bytes > MAX_AGENT_EVENT_TEXT_BYTES {
        return Err("Agent turn event text exceeds the supported length.".to_string());
    }
    if summary_bytes > MAX_AGENT_TOOL_SUMMARY_BYTES {
        return Err("Agent tool summary exceeds the supported length.".to_string());
    }
    Ok(())
}

fn ensure_root_key_bounds(root_key: &str) -> Result<(), String> {
    if root_key.is_empty() {
        return Err("Agent project root key is required.".to_string());
    }
    if root_key.len() > MAX_AGENT_ROOT_KEY_BYTES {
        return Err(format!(
            "Agent project root key must not exceed {MAX_AGENT_ROOT_KEY_BYTES} bytes."
        ));
    }
    Ok(())
}

fn thread_is_evictable(thread: &AgentThread) -> bool {
    !thread.pinned && thread.turns.iter().all(|turn| turn.status.is_terminal())
}

#[derive(Clone, Debug)]
struct RootDirectoryEntry {
    thread_id: String,
    path: PathBuf,
    size: u64,
}

fn root_directory_entries(directory: &Path) -> Result<Vec<RootDirectoryEntry>, String> {
    let reader = match fs::read_dir(directory) {
        Ok(reader) => reader,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to read the agent thread store: {error}")),
    };
    let mut entries = Vec::new();
    for entry in reader.take(MAX_AGENT_THREAD_DIRECTORY_ENTRIES) {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if file_name.contains(".json.tmp-") {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        let Some(thread_id) = file_name.strip_suffix(".json") else {
            continue;
        };
        if safe_agent_task_id(thread_id).is_err() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        entries.push(RootDirectoryEntry {
            thread_id: thread_id.to_string(),
            path: entry.path(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
    Ok(entries)
}

fn read_thread_file(root_key: &str, entry: &RootDirectoryEntry) -> Result<AgentThread, String> {
    if entry.size > MAX_AGENT_THREAD_FILE_BYTES as u64 {
        return Err("The saved thread exceeds the supported file size.".to_string());
    }
    let content = fs::read_to_string(&entry.path)
        .map_err(|error| format!("The saved thread could not be read: {error}"))?;
    let document: AgentThreadDocument = serde_json::from_str(&content)
        .map_err(|error| format!("The saved thread is not valid JSON: {error}"))?;
    validate_agent_thread_document(root_key, &document)?;
    if document.thread.thread_id != entry.thread_id {
        return Err("The saved thread identifier does not match its file name.".to_string());
    }
    Ok(document.thread)
}

fn classify_evictable(root_key: &str, stored: &mut [StoredThreadFile]) {
    for file in stored.iter_mut() {
        let entry = RootDirectoryEntry {
            thread_id: file.thread_id.clone(),
            path: file.path.clone(),
            size: file.size,
        };
        let Ok(thread) = read_thread_file(root_key, &entry) else {
            continue;
        };
        file.updated_at_epoch_ms = thread.updated_at_epoch_ms;
        file.evictable = thread_is_evictable(&thread);
    }
}

fn stored_bytes(stored: &[StoredThreadFile]) -> u64 {
    stored.iter().map(|file| file.size).sum()
}

fn over_budget(count: usize, bytes: u64) -> bool {
    count > MAX_AGENT_THREADS_PER_ROOT || bytes > MAX_AGENT_THREAD_ROOT_BYTES
}

fn evict_to_budget(
    stored: &mut Vec<StoredThreadFile>,
    extra_count: usize,
    extra_bytes: u64,
) -> (usize, bool) {
    let mut evicted = 0;
    loop {
        if !over_budget(
            stored.len() + extra_count,
            stored_bytes(stored) + extra_bytes,
        ) {
            return (evicted, true);
        }
        let Some(index) = evictable_index(stored) else {
            return (evicted, false);
        };
        let victim = stored.remove(index);
        let _ = fs::remove_file(&victim.path);
        evicted += 1;
    }
}

fn evictable_index(stored: &[StoredThreadFile]) -> Option<usize> {
    stored
        .iter()
        .enumerate()
        .filter(|(_, file)| file.evictable)
        .min_by(|(_, left), (_, right)| {
            left.updated_at_epoch_ms
                .cmp(&right.updated_at_epoch_ms)
                .then_with(|| left.thread_id.cmp(&right.thread_id))
        })
        .map(|(index, _)| index)
}

struct TemporaryFileGuard {
    path: PathBuf,
    committed: bool,
}

impl TemporaryFileGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let _ = fs::remove_file(&self.path);
    }
}

fn write_thread_file_atomically(path: &Path, payload: &[u8], nonce: u64) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The agent thread store path has no parent directory.".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The agent thread file name is not representable.".to_string())?;
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let temporary = directory.join(format!("{file_name}.tmp-{elapsed}-{nonce}"));
    let mut guard = TemporaryFileGuard::new(temporary.clone());
    let mut handle = create_private_file(&temporary)?;
    handle
        .write_all(payload)
        .map_err(|error| format!("Unable to write the agent thread: {error}"))?;
    handle
        .sync_all()
        .map_err(|error| format!("Unable to flush the agent thread: {error}"))?;
    drop(handle);
    fs::rename(&temporary, path)
        .map_err(|error| format!("Unable to publish the agent thread: {error}"))?;
    guard.commit();
    sync_directory(directory);
    Ok(())
}

fn create_private_file(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| format!("Unable to create the agent thread file: {error}"))
}

fn create_private_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create the agent thread store: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(directory, fs::Permissions::from_mode(0o700));
        if let Some(parent) = directory.parent() {
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(directory: &Path) {
    if let Ok(handle) = fs::File::open(directory) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) {}

fn clip_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut end = limit;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

#[cfg(test)]
#[path = "agent_thread_store_tests.rs"]
mod tests;
