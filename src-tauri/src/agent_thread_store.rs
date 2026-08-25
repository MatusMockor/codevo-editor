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
pub const MAX_UNREADABLE_REPORTS: usize = 16;
pub const MAX_AGENT_INTEGRATION_REF_BYTES: usize = 512;

pub const AGENT_THREAD_INTEGRATION_OBJECT_ID_ERROR: &str =
    "Agent thread integration object ids must be 40 lowercase hexadecimal characters.";
pub const AGENT_THREAD_INTEGRATION_REF_ERROR: &str =
    "Agent thread integration remote or branch name is out of bounds.";

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
    for turn in &thread.turns {
        validate_agent_turn(turn)?;
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
mod tests {
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
        }
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
                        "lastOutputSequence": 7
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
                        "lastOutputSequence": 0
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
                        "lastOutputSequence": 0
                    }
                ],
                "turnsTruncated": false,
                "integration": null
            }
        })
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
}
